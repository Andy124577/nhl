/**
 * Web Push, sans dépendance : de quoi faire apparaître une alerte sur un
 * téléphone ou un ordinateur quand Fantazy n'y est pas ouvert.
 *
 * Le navigateur s'abonne auprès du service de son fabricant (Google pour
 * Chrome et Android, Apple pour Safari, Mozilla pour Firefox, Microsoft pour
 * Edge) et nous remet trois choses : une adresse chez ce service, et deux clés.
 * Pour prévenir la personne, le serveur envoie un message à cette adresse ; le
 * service le relaie au navigateur, qui réveille notre service worker (sw.js).
 *
 * Deux normes suffisent, et Node les couvre avec `crypto` seul :
 *
 *   - RFC 8292 (VAPID) : le serveur signe chaque envoi avec SA clé. Le service
 *     n'accepte que les messages signés par la clé qui a servi à l'abonnement —
 *     une adresse volée ne permet pas d'écrire à la personne ;
 *   - RFC 8291 : le message est chiffré pour le navigateur seul. Le service
 *     qui le relaie ne voit qu'un bloc opaque : ni le nom du pool, ni le texte.
 *
 * Pur : ni base, ni réseau, ni horloge. L'envoi lui-même vit dans
 * services/push.js ; la résolution de la clé depuis l'environnement est
 * séparée (`clesDepuisEnvironnement`), comme dans lib/poolSecret.js.
 */

'use strict';

const crypto = require('crypto');

/** Ordre de la courbe P-256 : une clé privée est un entier dans [1, n-1]. */
const ORDRE_P256 = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

/** Taille d'un enregistrement aes128gcm. Un message tient dans un seul. */
const TAILLE_ENREGISTREMENT = 4096;

/**
 * Le plus long texte qu'on accepte de chiffrer.
 *
 * Les services refusent un corps de plus de 4096 octets : 86 d'en-tête, le
 * texte, un octet de délimiteur et 16 d'étiquette d'authentification.
 */
const TAILLE_MAX_TEXTE = TAILLE_ENREGISTREMENT - 86 - 1 - 16;

/** Durée de validité de la signature VAPID. La norme plafonne à 24 h. */
const DUREE_JETON_S = 12 * 60 * 60;

/** Contact annoncé aux services de push, qui s'en servent en cas d'abus. */
const SUJET_PAR_DEFAUT = 'mailto:fantazyhockey@outlook.com';

const base64url = (octets) => Buffer.from(octets).toString('base64url');
const depuisBase64url = (texte) => Buffer.from(String(texte || ''), 'base64url');

/** Une clé privée P-256 brute (32 octets) est-elle utilisable ? */
function scalaireValide(octets) {
    if (!Buffer.isBuffer(octets) || octets.length !== 32) return false;
    const n = BigInt('0x' + octets.toString('hex'));
    return n > 0n && n < ORDRE_P256;
}

/**
 * Une clé publique de navigateur (`p256dh`) : un point P-256 non compressé.
 *
 * Vérifié à l'abonnement plutôt qu'au premier envoi : un point invalide ferait
 * échouer chaque alerte en silence, au moment où elle compte.
 */
function clePubliqueValide(octets) {
    if (!Buffer.isBuffer(octets) || octets.length !== 65 || octets[0] !== 0x04) return false;
    try {
        const essai = crypto.createECDH('prime256v1');
        essai.generateKeys();
        essai.computeSecret(octets);
        return true;
    } catch {
        return false;
    }
}

/**
 * Les clés VAPID du serveur à partir de la clé privée brute.
 *
 * La publique s'en déduit : c'est elle que le navigateur reçoit pour
 * s'abonner (`applicationServerKey`), et elle accompagne chaque signature.
 */
function clesDepuisPrive(prive) {
    if (!scalaireValide(prive)) throw new Error('Clé VAPID invalide : 32 octets attendus, dans l’ordre de la courbe P-256.');
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(prive);
    const publique = ecdh.getPublicKey(null, 'uncompressed');
    const clePrivee = crypto.createPrivateKey({
        format: 'jwk',
        key: {
            kty: 'EC',
            crv: 'P-256',
            d: base64url(prive),
            x: base64url(publique.subarray(1, 33)),
            y: base64url(publique.subarray(33))
        }
    });
    return { clePrivee, publique, clePublique: base64url(publique) };
}

/**
 * Une clé privée stable tirée d'un secret quelconque.
 *
 * scrypt, comme lib/poolSecret.js : la clé publique qui en sort est publique,
 * et ne doit pas permettre de remonter au secret par force brute. Un résultat
 * hors de la courbe (une chance sur quatre milliards) passe au suivant.
 */
function deriverPrive(materiau, contexte) {
    for (let essai = 0; essai < 8; essai++) {
        const sel = essai === 0 ? contexte : `${contexte}:${essai}`;
        const brut = crypto.scryptSync(String(materiau), sel, 32);
        if (scalaireValide(brut)) return brut;
    }
    throw new Error('Clé VAPID : dérivation impossible.');
}

/** Une clé brute en base64url (celle que produit `web-push generate-vapid-keys`). */
function lireCleBrute(texte) {
    const propre = String(texte || '').trim();
    if (!/^[A-Za-z0-9_\-+/]{43}=?$/.test(propre)) return null;
    const octets = depuisBase64url(propre);
    return scalaireValide(octets) ? octets : null;
}

/**
 * Les clés du serveur, de la plus souhaitable à la moins souhaitable.
 *
 *   1. VAPID_PRIVATE_KEY — une clé brute en base64url, ou n'importe quel
 *      secret dont on la dérive (la valeur que Render génère, par exemple) ;
 *   2. DATABASE_URL — repli stable en production, comme pour les mots de
 *      passe de pool : l'adresse de la base porte son mot de passe ;
 *   3. rien — les alertes sont indisponibles. Elles exigent PostgreSQL de
 *      toute façon : les abonnements vivent dans la base.
 *
 * La clé doit rester la même d'un déploiement à l'autre : un abonnement est lié
 * à la clé publique qui l'a créé. Si elle change quand même, chaque navigateur
 * se réabonne à sa prochaine visite (pushNotifications.js compare les clés).
 *
 * Renvoie `{ ...clés, sujet, source }`, ou null.
 */
function clesDepuisEnvironnement(env) {
    const sujet = String(env.VAPID_SUBJECT || '').trim() || SUJET_PAR_DEFAUT;

    if (env.VAPID_PRIVATE_KEY) {
        const brute = lireCleBrute(env.VAPID_PRIVATE_KEY);
        const prive = brute || deriverPrive(env.VAPID_PRIVATE_KEY, 'fantazy:vapid');
        return { ...clesDepuisPrive(prive), sujet, source: 'VAPID_PRIVATE_KEY' };
    }
    if (env.DATABASE_URL) {
        return { ...clesDepuisPrive(deriverPrive(env.DATABASE_URL, 'fantazy:vapid:db')), sujet, source: 'DATABASE_URL' };
    }
    return null;
}

/**
 * L'en-tête Authorization d'un envoi (RFC 8292).
 *
 * Le jeton désigne le service visé (`aud`, l'origine de l'adresse) : il ne
 * vaut que là. `maintenantS` est l'heure en secondes, fournie par l'appelant.
 */
function autorisationVapid({ endpoint, cles, sujet = cles.sujet || SUJET_PAR_DEFAUT, maintenantS }) {
    const entete = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const charge = base64url(JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(maintenantS) + DUREE_JETON_S,
        sub: sujet
    }));
    const signature = crypto.sign('sha256', Buffer.from(`${entete}.${charge}`), {
        key: cles.clePrivee,
        dsaEncoding: 'ieee-p1363'
    });
    return `vapid t=${entete}.${charge}.${base64url(signature)}, k=${cles.clePublique}`;
}

const hkdf = (sel, materiau, info, longueur) =>
    Buffer.from(crypto.hkdfSync('sha256', materiau, sel, info, longueur));

/**
 * Chiffre un message pour UN navigateur (RFC 8291, codage aes128gcm).
 *
 * Chaque envoi tire une paire de clés éphémère et un sel neufs : deux envois du
 * même texte ne se ressemblent pas. `ephemere` et `sel` ne sont fixés que par
 * les tests, pour retrouver octet pour octet l'exemple de la RFC.
 */
function chiffrer({ texte, p256dh, auth, ephemere = null, sel = null }) {
    const clair = Buffer.from(texte, 'utf8');
    if (clair.length > TAILLE_MAX_TEXTE) {
        throw new Error(`Message trop long pour une alerte : ${clair.length} octets (${TAILLE_MAX_TEXTE} au plus).`);
    }

    const publiqueNavigateur = depuisBase64url(p256dh);
    const secretAuth = depuisBase64url(auth);

    const ecdh = crypto.createECDH('prime256v1');
    if (ephemere) ecdh.setPrivateKey(ephemere);
    else ecdh.generateKeys();
    const publiqueServeur = ecdh.getPublicKey(null, 'uncompressed');
    const secretPartage = ecdh.computeSecret(publiqueNavigateur);
    const selMessage = sel || crypto.randomBytes(16);

    const infoCle = Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), publiqueNavigateur, publiqueServeur]);
    const materiau = hkdf(secretAuth, secretPartage, infoCle, 32);
    const cle = hkdf(selMessage, materiau, Buffer.from('Content-Encoding: aes128gcm\0', 'latin1'), 16);
    const nonce = hkdf(selMessage, materiau, Buffer.from('Content-Encoding: nonce\0', 'latin1'), 12);

    // Un seul enregistrement, donc le délimiteur du dernier (0x02), sans bourrage.
    const chiffreur = crypto.createCipheriv('aes-128-gcm', cle, nonce);
    const corps = Buffer.concat([chiffreur.update(clair), chiffreur.update(Buffer.from([0x02])), chiffreur.final()]);

    const taille = Buffer.alloc(4);
    taille.writeUInt32BE(TAILLE_ENREGISTREMENT);
    return Buffer.concat([
        selMessage, taille, Buffer.from([publiqueServeur.length]), publiqueServeur,
        corps, chiffreur.getAuthTag()
    ]);
}

/**
 * La requête HTTP d'un envoi, prête pour fetch.
 *
 * `ttl` : combien de secondes le service garde le message si l'appareil est
 * éteint — au-delà, l'alerte ne dirait plus rien de vrai. `urgence` : « high »
 * réveille un téléphone en économie d'énergie (RFC 8030). `sujet` : deux
 * messages de même sujet en attente, seul le dernier est livré.
 */
function requete({ abonnement, charge, cles, maintenantS, ttl = 60 * 60, urgence = 'normal', sujet = null }) {
    const entetes = {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        TTL: String(Math.max(0, Math.floor(ttl))),
        Urgency: urgence,
        Authorization: autorisationVapid({ endpoint: abonnement.endpoint, cles, maintenantS })
    };
    if (sujet) entetes.Topic = sujetCourt(sujet);
    return {
        url: abonnement.endpoint,
        options: {
            method: 'POST',
            headers: entetes,
            body: chiffrer({ texte: JSON.stringify(charge), p256dh: abonnement.p256dh, auth: abonnement.auth })
        }
    };
}

/** Un sujet RFC 8030 : 32 caractères base64url au plus. Dérivé, donc opaque. */
function sujetCourt(texte) {
    return crypto.createHash('sha256').update(String(texte)).digest('base64url').slice(0, 32);
}

/**
 * Les services de push connus.
 *
 * Le serveur envoie une requête à l'adresse que le navigateur lui a remise. Sans
 * liste, un compte pourrait enregistrer n'importe quelle adresse — un service
 * interne, par exemple — et faire écrire le serveur dessus à chaque tour.
 */
const SERVICES_PUSH = [
    'fcm.googleapis.com',               // Chrome, Android, Edge (Android), Opera, Samsung
    'android.googleapis.com',           // anciens abonnements Chrome
    'push.services.mozilla.com',        // Firefox
    'push.apple.com',                   // Safari (macOS, iPhone et iPad)
    'notify.windows.com'                // Edge (Windows)
];

/**
 * Valide un abonnement remis par le navigateur.
 *
 * Renvoie `{ ok: true, abonnement }` normalisé, ou `{ ok: false, message }`.
 */
function validerAbonnement(brut) {
    const endpoint = typeof brut?.endpoint === 'string' ? brut.endpoint.trim() : '';
    const p256dh = typeof brut?.keys?.p256dh === 'string' ? brut.keys.p256dh.trim() : '';
    const auth = typeof brut?.keys?.auth === 'string' ? brut.keys.auth.trim() : '';

    if (!endpoint || endpoint.length > 2048) return { ok: false, message: 'Adresse d’abonnement invalide.' };
    let adresse;
    try { adresse = new URL(endpoint); } catch { return { ok: false, message: 'Adresse d’abonnement invalide.' }; }
    if (adresse.protocol !== 'https:' || adresse.username || adresse.password || adresse.port) {
        return { ok: false, message: 'Adresse d’abonnement invalide.' };
    }
    const hote = adresse.hostname.toLowerCase();
    if (!SERVICES_PUSH.some(service => hote === service || hote.endsWith(`.${service}`))) {
        return { ok: false, message: 'Service de notifications non reconnu.' };
    }

    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(p256dh) || !clePubliqueValide(depuisBase64url(p256dh))) {
        return { ok: false, message: 'Clé d’abonnement invalide.' };
    }
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(auth) || depuisBase64url(auth).length !== 16) {
        return { ok: false, message: 'Clé d’abonnement invalide.' };
    }

    // L'adresse est gardée telle que le navigateur l'a donnée : c'est elle qu'on
    // appelle, et elle qui identifie l'abonnement.
    return {
        ok: true,
        abonnement: {
            endpoint,
            p256dh: base64url(depuisBase64url(p256dh)),
            auth: base64url(depuisBase64url(auth))
        }
    };
}

module.exports = {
    TAILLE_MAX_TEXTE,
    DUREE_JETON_S,
    SUJET_PAR_DEFAUT,
    SERVICES_PUSH,
    scalaireValide,
    clePubliqueValide,
    clesDepuisPrive,
    clesDepuisEnvironnement,
    autorisationVapid,
    chiffrer,
    requete,
    sujetCourt,
    validerAbonnement
};
