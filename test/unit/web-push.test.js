'use strict';

/**
 * Web Push (lib/webPush.js) : le chiffrement doit retrouver octet pour octet
 * l'exemple de la RFC 8291, et ce qu'un navigateur reçoit doit se déchiffrer.
 * Aucun réseau : un navigateur est simulé par sa paire de clés.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const webPush = require('../../lib/webPush.js');
const { b64, navigateur, dechiffrer, verifierVapid } = require('../fixtures/navigateurPush.js');

// RFC 8291, section 5 et annexe A.
const RFC = {
    texte: 'When I grow up, I want to be a watermelon',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    uaPrive: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    asPrive: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    sel: 'DGv6ra1nlYgDCS1FRnbzlw',
    corps: `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
            mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
            pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`
};

test('le chiffrement retrouve octet pour octet l’exemple de la RFC 8291', () => {
    const corps = webPush.chiffrer({
        texte: RFC.texte,
        p256dh: RFC.uaPublic,
        auth: RFC.auth,
        ephemere: b64(RFC.asPrive),
        sel: b64(RFC.sel)
    });
    assert.equal(corps.toString('base64url'), b64(RFC.corps).toString('base64url'));
});

test('ce que le navigateur reçoit se déchiffre, et deux envois ne se ressemblent pas', () => {
    const { prive, abonnement } = navigateur();
    const texte = JSON.stringify({ titre: "C'est à votre tour de choisir", corps: 'Ligue des Rois · 3 minutes' });

    const a = webPush.chiffrer({ texte, p256dh: abonnement.p256dh, auth: abonnement.auth });
    const b = webPush.chiffrer({ texte, p256dh: abonnement.p256dh, auth: abonnement.auth });

    assert.equal(dechiffrer(a, prive, abonnement.p256dh, abonnement.auth), texte, 'accents compris');
    assert.notDeepEqual(a, b, 'clé éphémère et sel neufs à chaque envoi');
    assert.throws(() => dechiffrer(a, navigateur().prive, abonnement.p256dh, abonnement.auth),
        'un autre navigateur ne peut pas le lire');
});

test('un message trop long pour une alerte est refusé avant l’envoi', () => {
    const { abonnement } = navigateur();
    const texte = 'x'.repeat(webPush.TAILLE_MAX_TEXTE);
    const corps = webPush.chiffrer({ texte, p256dh: abonnement.p256dh, auth: abonnement.auth });
    assert.equal(corps.length, 4096, 'le plus long message tient pile dans ce que les services acceptent');
    assert.throws(() => webPush.chiffrer({ texte: texte + 'x', p256dh: abonnement.p256dh, auth: abonnement.auth }), /trop long/);
});

test('la signature VAPID vaut pour le service visé, et porte notre clé publique', () => {
    const cles = webPush.clesDepuisPrive(b64(RFC.asPrive));
    assert.equal(cles.clePublique, RFC.asPublic, 'la publique se déduit de la privée');

    const entete = webPush.autorisationVapid({
        endpoint: 'https://web.push.apple.com/QGuQyavXutnMH2Ro5nU:tjbV4ROHq',
        cles,
        sujet: 'mailto:fantazyhockey@outlook.com',
        maintenantS: 1_800_000_000
    });
    const lu = verifierVapid(entete);
    assert.equal(lu.valide, true);
    assert.equal(lu.cle, RFC.asPublic);
    assert.deepEqual(lu.tete, { typ: 'JWT', alg: 'ES256' });
    assert.equal(lu.charge.aud, 'https://web.push.apple.com', 'l’origine seule, sans chemin');
    assert.equal(lu.charge.sub, 'mailto:fantazyhockey@outlook.com');
    assert.equal(lu.charge.exp, 1_800_000_000 + webPush.DUREE_JETON_S);
    assert.ok(webPush.DUREE_JETON_S <= 24 * 60 * 60, 'la norme plafonne la validité à 24 h');
});

test('la requête d’envoi porte le chiffrement, la durée de vie et l’urgence', () => {
    const { prive, abonnement } = navigateur();
    const cles = webPush.clesDepuisPrive(b64(RFC.asPrive));
    const { url, options } = webPush.requete({
        abonnement,
        charge: { titre: 'Essai' },
        cles: { ...cles, sujet: webPush.SUJET_PAR_DEFAUT },
        maintenantS: 1_800_000_000,
        ttl: 180.7,
        urgence: 'high',
        sujet: 'tour:Ligue'
    });

    assert.equal(url, abonnement.endpoint);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Encoding'], 'aes128gcm');
    assert.equal(options.headers.TTL, '180');
    assert.equal(options.headers.Urgency, 'high');
    assert.match(options.headers.Topic, /^[A-Za-z0-9_-]{32}$/, 'un sujet RFC 8030 : 32 caractères base64url');
    assert.equal(options.headers.Topic, webPush.sujetCourt('tour:Ligue'), 'le même sujet remplace le message en attente');
    assert.equal(verifierVapid(options.headers.Authorization).charge.aud, 'https://fcm.googleapis.com');
    assert.deepEqual(JSON.parse(dechiffrer(options.body, prive, abonnement.p256dh, abonnement.auth)), { titre: 'Essai' });
});

test('les clés du serveur : clé posée, sinon dérivée de la base, sinon aucune', () => {
    const brute = webPush.clesDepuisEnvironnement({ VAPID_PRIVATE_KEY: RFC.asPrive });
    assert.equal(brute.clePublique, RFC.asPublic, 'une clé de `web-push generate-vapid-keys` sert telle quelle');
    assert.equal(brute.source, 'VAPID_PRIVATE_KEY');
    assert.equal(brute.sujet, webPush.SUJET_PAR_DEFAUT);

    const phrase = webPush.clesDepuisEnvironnement({ VAPID_PRIVATE_KEY: 'n’importe quel secret', VAPID_SUBJECT: 'https://fantazy.ca' });
    assert.equal(phrase.clePublique, webPush.clesDepuisEnvironnement({ VAPID_PRIVATE_KEY: 'n’importe quel secret' }).clePublique,
        'un secret quelconque donne toujours la même clé');
    assert.equal(phrase.sujet, 'https://fantazy.ca');

    const base = { DATABASE_URL: 'postgresql://u:secret@hote.neon.tech/db' };
    const a = webPush.clesDepuisEnvironnement(base);
    assert.equal(a.source, 'DATABASE_URL');
    assert.equal(a.clePublique, webPush.clesDepuisEnvironnement(base).clePublique,
        'stable d’un démarrage à l’autre : un abonnement est lié à cette clé');
    assert.notEqual(a.clePublique, webPush.clesDepuisEnvironnement({ DATABASE_URL: base.DATABASE_URL + 'x' }).clePublique);
    assert.equal(webPush.clesDepuisEnvironnement({ ...base, VAPID_PRIVATE_KEY: RFC.asPrive }).source, 'VAPID_PRIVATE_KEY',
        'la clé posée l’emporte');

    assert.equal(webPush.clesDepuisEnvironnement({}), null, 'sans base, pas d’alertes');

    // `generateValue: true` de Render : 32 octets en base64 standard (+, / et =).
    const octetsRender = Buffer.concat([Buffer.from([0x7b, 0xef, 0xbf]), Buffer.alloc(29, 1)]);
    const render = octetsRender.toString('base64');
    assert.match(render, /\+/);
    assert.match(render, /\//);
    assert.match(render, /=$/);
    assert.equal(webPush.clesDepuisEnvironnement({ VAPID_PRIVATE_KEY: render }).clePublique,
        webPush.clesDepuisPrive(octetsRender).clePublique, 'la valeur générée par Render sert telle quelle');
});

test('une clé privée hors de la courbe est refusée', () => {
    assert.equal(webPush.scalaireValide(Buffer.alloc(32)), false, 'zéro');
    assert.equal(webPush.scalaireValide(Buffer.alloc(32, 0xff)), false, 'au-delà de l’ordre');
    assert.equal(webPush.scalaireValide(Buffer.alloc(31, 1)), false, '31 octets');
    assert.throws(() => webPush.clesDepuisPrive(Buffer.alloc(32)), /invalide/);
});

test('seuls les services de push connus sont acceptés comme adresse', () => {
    const { abonnement } = navigateur();
    const cles = { p256dh: abonnement.p256dh, auth: abonnement.auth };
    const accepte = (endpoint) => webPush.validerAbonnement({ endpoint, keys: cles }).ok;

    for (const endpoint of [
        'https://fcm.googleapis.com/fcm/send/cXyz:APA91bHun4MxP5',
        'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk',
        'https://web.push.apple.com/QGuQyavXutnMH2Ro5nU:tjbV4ROHq',
        'https://wns2-bl2p.notify.windows.com/w/?token=BQYAAAB%2b'
    ]) {
        assert.equal(accepte(endpoint), true, endpoint);
    }

    for (const endpoint of [
        'http://fcm.googleapis.com/fcm/send/abc',             // en clair
        'https://fcm.googleapis.com.evil.example/fcm/send/a', // sosie
        'https://evilfcm.googleapis.com/fcm/send/a',          // suffixe sans point
        'https://localhost/push',
        'https://10.0.0.5/push',
        'https://fcm.googleapis.com:8443/fcm/send/a',         // port
        'https://user:pw@fcm.googleapis.com/fcm/send/a',
        'pas une adresse',
        'https://fcm.googleapis.com/' + 'a'.repeat(2048)
    ]) {
        assert.equal(accepte(endpoint), false, endpoint);
    }
});

test('l’abonnement garde l’adresse exacte, et refuse des clés qui ne sont pas celles d’un navigateur', () => {
    const { abonnement } = navigateur();
    const endpoint = 'https://wns2-bl2p.notify.windows.com/w/?token=BQYAAAB%2b';
    const ok = webPush.validerAbonnement({ endpoint, keys: { p256dh: abonnement.p256dh, auth: abonnement.auth } });
    assert.equal(ok.ok, true);
    assert.equal(ok.abonnement.endpoint, endpoint, 'appelée telle quelle');

    const refuse = (keys) => webPush.validerAbonnement({ endpoint: abonnement.endpoint, keys }).ok;
    assert.equal(refuse({ p256dh: abonnement.p256dh, auth: 'AAAA' }), false, 'secret de 3 octets');
    assert.equal(refuse({ p256dh: abonnement.p256dh }), false, 'secret absent');
    assert.equal(refuse({ p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: abonnement.auth }), false,
        'un point hors de la courbe');
    assert.equal(refuse({ p256dh: abonnement.p256dh.slice(0, 40), auth: abonnement.auth }), false, 'clé tronquée');
    assert.equal(refuse({ p256dh: '<script>', auth: abonnement.auth }), false);
    assert.equal(webPush.validerAbonnement(null).ok, false);
});
