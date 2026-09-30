/**
 * Un navigateur abonné aux alertes, simulé par sa paire de clés.
 *
 * Il fait ce que fait un vrai navigateur à la réception d'un message (RFC 8291,
 * côté agent utilisateur) : c'est ce qui permet de vérifier qu'une alerte
 * envoyée par le serveur se lit bien à l'arrivée, sans réseau.
 */

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const b64 = (texte) => Buffer.from(String(texte).replace(/\s+/g, ''), 'base64url');

let numero = 0;

/** Un navigateur : sa clé privée et l'abonnement que pushManager.subscribe() remettrait. */
function navigateur({ endpoint = null } = {}) {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    numero++;
    return {
        prive: ecdh.getPrivateKey(),
        abonnement: {
            endpoint: endpoint || `https://fcm.googleapis.com/fcm/send/appareil-${numero}:APA91b`,
            p256dh: ecdh.getPublicKey(null, 'uncompressed').toString('base64url'),
            auth: crypto.randomBytes(16).toString('base64url')
        }
    };
}

/** Déchiffre un corps aes128gcm reçu par ce navigateur. */
function dechiffrer(corps, prive, p256dh, auth) {
    const sel = corps.subarray(0, 16);
    const longueurCle = corps[20];
    const publiqueServeur = corps.subarray(21, 21 + longueurCle);
    const chiffre = corps.subarray(21 + longueurCle, corps.length - 16);
    const etiquette = corps.subarray(corps.length - 16);

    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(prive);
    const secret = ecdh.computeSecret(publiqueServeur);
    const hkdf = (s, m, info, n) => Buffer.from(crypto.hkdfSync('sha256', m, s, info, n));
    const info = Buffer.concat([Buffer.from('WebPush: info\0'), b64(p256dh), publiqueServeur]);
    const materiau = hkdf(b64(auth), secret, info, 32);
    const cle = hkdf(sel, materiau, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
    const nonce = hkdf(sel, materiau, Buffer.from('Content-Encoding: nonce\0'), 12);

    const dechiffreur = crypto.createDecipheriv('aes-128-gcm', cle, nonce);
    dechiffreur.setAuthTag(etiquette);
    const clair = Buffer.concat([dechiffreur.update(chiffre), dechiffreur.final()]);
    assert.equal(clair[clair.length - 1], 0x02, 'délimiteur du dernier enregistrement');
    return clair.subarray(0, -1).toString('utf8');
}

/** Ce que ce navigateur lit d'un envoi capturé : le message JSON. */
function lire(appareil, envoi) {
    return JSON.parse(dechiffrer(envoi.options.body, appareil.prive, appareil.abonnement.p256dh, appareil.abonnement.auth));
}

/** Lit l'en-tête VAPID et vérifie sa signature comme le ferait le service de push. */
function verifierVapid(entete) {
    const [, jeton, cle] = /^vapid t=([^,]+), k=(.+)$/.exec(entete);
    const [tete, charge, signature] = jeton.split('.');
    const publique = b64(cle);
    const clePublique = crypto.createPublicKey({
        format: 'jwk',
        key: {
            kty: 'EC', crv: 'P-256',
            x: publique.subarray(1, 33).toString('base64url'),
            y: publique.subarray(33).toString('base64url')
        }
    });
    const valide = crypto.verify('sha256', Buffer.from(`${tete}.${charge}`),
        { key: clePublique, dsaEncoding: 'ieee-p1363' }, b64(signature));
    return {
        valide,
        cle,
        tete: JSON.parse(b64(tete).toString()),
        charge: JSON.parse(b64(charge).toString())
    };
}

module.exports = { b64, navigateur, dechiffrer, lire, verifierVapid };
