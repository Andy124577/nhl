/**
 * Sessions — jetons, cookies, et la vérification d'origine qui va avec.
 *
 * Tout ce qui se décide sans base ni requête Express vit ici : fabriquer un
 * jeton, l'empreindre, écrire l'en-tête Set-Cookie, relire un en-tête Cookie,
 * dire si une origine a le droit d'envoyer une requête authentifiée par
 * cookie. Aucune primitive maison : le hasard vient de crypto.randomBytes et
 * l'empreinte de SHA-256.
 *
 * Pourquoi un cookie plutôt que le nom d'utilisateur dans le corps de la
 * requête : le navigateur l'attache seul, HttpOnly le met hors de portée d'un
 * script injecté, et le serveur peut le révoquer. localStorage ne fait aucune
 * des trois — il ne prouve rien, il se souvient.
 */

'use strict';

const crypto = require('crypto');

const NOM_COOKIE = 'fz_session';

/** Trente jours. Assez pour ne pas reconnecter un habitué chaque semaine. */
const DUREE_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Au-delà de ce délai sans activité, la session est traitée comme morte même
 * si sa date d'expiration est lointaine. Un poste public oublié ouvert ne doit
 * pas rester ouvert un mois.
 */
const INACTIVITE_MAX_MS = 14 * 24 * 60 * 60 * 1000;

/** 32 octets de hasard, en base64url : rien de devinable, rien à parser. */
function genererJeton() {
    return crypto.randomBytes(32).toString('base64url');
}

/**
 * Ce qui est stocké en base. Le jeton lui-même ne quitte jamais le cookie :
 * une copie de cette table ne permet donc d'usurper aucune session.
 */
function empreinteJeton(jeton) {
    return crypto.createHash('sha256').update(String(jeton || ''), 'utf8').digest('hex');
}

/**
 * Comparaison à temps constant des empreintes. Les deux sont de la même
 * longueur par construction ; la garde couvre une entrée malformée.
 */
function empreintesEgales(a, b) {
    const ta = Buffer.from(String(a || ''), 'utf8');
    const tb = Buffer.from(String(b || ''), 'utf8');
    if (ta.length !== tb.length) return false;
    return crypto.timingSafeEqual(ta, tb);
}

/**
 * Relit un en-tête `Cookie`.
 *
 * Volontairement tolérant : un cookie tiers malformé ne doit pas faire
 * disparaître le nôtre. Les valeurs sont décodées, sauf si le décodage échoue
 * — auquel cas la valeur brute est gardée plutôt que l'entrée perdue.
 */
function lireCookies(entete) {
    const cookies = {};
    if (!entete || typeof entete !== 'string') return cookies;

    for (const morceau of entete.split(';')) {
        const separateur = morceau.indexOf('=');
        if (separateur < 0) continue;
        const nom = morceau.slice(0, separateur).trim();
        if (!nom) continue;
        const brute = morceau.slice(separateur + 1).trim();
        let valeur = brute;
        try { valeur = decodeURIComponent(brute); } catch { /* valeur brute */ }
        cookies[nom] = valeur;
    }
    return cookies;
}

/**
 * En-tête Set-Cookie de la session.
 *
 * HttpOnly : hors de portée de tout script de la page.
 * Secure en production : jamais envoyé en clair.
 * SameSite=Lax : le cookie n'accompagne pas une requête POST venue d'un autre
 *   site, ce qui coupe la forme la plus courante de CSRF sans casser l'arrivée
 *   par un lien externe.
 */
function cookieSession(jeton, options = {}) {
    const secure = options.secure !== false;
    const dureeMs = Number.isFinite(options.dureeMs) ? options.dureeMs : DUREE_SESSION_MS;
    const parties = [
        `${NOM_COOKIE}=${encodeURIComponent(jeton)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${Math.floor(dureeMs / 1000)}`
    ];
    if (secure) parties.push('Secure');
    return parties.join('; ');
}

/** Le même cookie, vidé et périmé : c'est ainsi qu'on se déconnecte. */
function cookieEfface(options = {}) {
    const secure = options.secure !== false;
    const parties = [`${NOM_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (secure) parties.push('Secure');
    return parties.join('; ');
}

/** Session lisible : ni révoquée, ni expirée, ni dormante depuis trop longtemps. */
function sessionValide(session, maintenant = Date.now()) {
    if (!session) return false;
    if (session.revokedAt) return false;

    const expire = session.expiresAt instanceof Date ? session.expiresAt.getTime() : Date.parse(session.expiresAt);
    if (!Number.isFinite(expire) || expire <= maintenant) return false;

    const vue = session.lastSeenAt instanceof Date ? session.lastSeenAt.getTime() : Date.parse(session.lastSeenAt);
    if (Number.isFinite(vue) && (maintenant - vue) > INACTIVITE_MAX_MS) return false;

    return true;
}

/**
 * Hôte d'une URL d'origine, ou null.
 *
 * `Origin: null` (sandbox, redirection cross-origin) n'est pas une origine
 * exploitable : il ne doit surtout pas être pris pour « même site ».
 */
function hoteDe(origine) {
    if (!origine || origine === 'null') return null;
    try { return new URL(origine).host.toLowerCase(); } catch { return null; }
}

/**
 * Cette requête mutante a-t-elle le droit d'utiliser le cookie ?
 *
 * SameSite=Lax bloque déjà le cas courant ; cette vérification est la seconde
 * serrure, celle qui ne dépend pas du navigateur. Règle : si une origine est
 * annoncée, elle doit correspondre à l'hôte servi ou figurer dans la liste
 * explicite. Une requête sans origine du tout (client non navigateur, ancien
 * navigateur) est acceptée — le cookie ne s'y attache pas tout seul.
 */
function origineAutorisee({ origin, referer, host, autorisees = [] } = {}) {
    const hoteServi = String(host || '').toLowerCase();
    const permises = new Set(
        [...autorisees].map(o => hoteDe(o)).filter(Boolean)
    );
    if (hoteServi) permises.add(hoteServi);

    const annoncee = hoteDe(origin) || hoteDe(referer);
    if (!annoncee) return !origin && !referer;

    return permises.has(annoncee);
}

module.exports = {
    NOM_COOKIE,
    DUREE_SESSION_MS,
    INACTIVITE_MAX_MS,
    genererJeton,
    empreinteJeton,
    empreintesEgales,
    lireCookies,
    cookieSession,
    cookieEfface,
    sessionValide,
    hoteDe,
    origineAutorisee
};
