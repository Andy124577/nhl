/**
 * Connexion avec Google — la partie qui décide, sans réseau ni Express.
 *
 * Le parcours est le flux « code d'autorisation » d'OpenID Connect, côté
 * serveur : le navigateur part chez Google, revient sur /auth/google/callback
 * avec un code, et c'est le SERVEUR qui échange ce code contre le jeton
 * d'identité. Aucun script de Google n'est chargé dans nos pages, aucune
 * dépendance n'est ajoutée, et le secret du client ne quitte jamais le
 * serveur.
 *
 * Ce module fabrique et vérifie ; routes/google.js enchaîne. Tout ce qui est
 * ici se teste sans Google (test/unit/google-auth.test.js).
 */

'use strict';

const crypto = require('crypto');

const URL_AUTORISATION = 'https://accounts.google.com/o/oauth2/v2/auth';
const URL_JETON = 'https://oauth2.googleapis.com/token';
const EMETTEURS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** Cookie d'aller-retour : l'état anti-CSRF et le vérificateur PKCE. */
const COOKIE_ETAT = 'fz_google_etat';
/** Cookie d'attente : une identité Google reconnue, sans compte Fantazy encore. */
const COOKIE_ATTENTE = 'fz_google_attente';
/** Les deux ne servent qu'aux routes /auth/google : inutile de les envoyer ailleurs. */
const CHEMIN_COOKIES = '/auth/google';

const DUREE_ETAT_S = 10 * 60;
const DUREE_ATTENTE_S = 15 * 60;

/** Même règle que le formulaire d'inscription (signup.html). */
const MOTIF_NOM = /^[A-Za-z0-9_]{3,20}$/;

function base64url(tampon) {
    return Buffer.from(tampon).toString('base64url');
}

/** Hasard non devinable, pour l'état et le vérificateur PKCE. */
function aleatoire() {
    return base64url(crypto.randomBytes(32));
}

/**
 * PKCE (RFC 7636). Le secret du client suffirait à lui seul, mais PKCE lie en
 * plus le code à CE navigateur : un code intercepté ne s'échange pas ailleurs.
 */
function genererPkce() {
    const verificateur = aleatoire();
    const defi = base64url(crypto.createHash('sha256').update(verificateur).digest());
    return { verificateur, defi };
}

function urlAutorisation({ clientId, redirectUri, etat, defi }) {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state: etat,
        code_challenge: defi,
        code_challenge_method: 'S256',
        // Laisser choisir le compte : sur un poste partagé, la personne
        // connectée à Google n'est pas forcément celle qui veut jouer.
        prompt: 'select_account'
    });
    return `${URL_AUTORISATION}?${params}`;
}

/** Corps de la requête d'échange du code contre les jetons. */
function corpsEchange({ code, clientId, clientSecret, redirectUri, verificateur }) {
    return new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verificateur
    }).toString();
}

/**
 * Lit et contrôle le jeton d'identité rendu par Google.
 *
 * La signature n'est pas vérifiée, et c'est voulu : le jeton arrive dans la
 * réponse de l'échange, reçue directement de oauth2.googleapis.com en TLS.
 * OpenID Connect Core §3.1.3.7 (point 6) admet ce cas — la connexion
 * authentifie l'émetteur. Un jeton qui transiterait par le navigateur, lui,
 * devrait être vérifié contre les clés publiques de Google.
 *
 * Les revendications restent contrôlées : émetteur, audience (notre client, pas
 * un autre site), expiration, et un `sub` présent. Renvoie null si l'une
 * manque.
 */
function lireJetonIdentite(idToken, { clientId, maintenant = Date.now() } = {}) {
    if (typeof idToken !== 'string') return null;
    const parties = idToken.split('.');
    if (parties.length !== 3) return null;

    let revendications;
    try {
        revendications = JSON.parse(Buffer.from(parties[1], 'base64url').toString('utf8'));
    } catch {
        return null;
    }
    if (!revendications || typeof revendications !== 'object') return null;

    if (!EMETTEURS.has(revendications.iss)) return null;
    const audiences = Array.isArray(revendications.aud) ? revendications.aud : [revendications.aud];
    if (!clientId || !audiences.includes(clientId)) return null;
    // Une minute de tolérance pour une horloge serveur un peu en retard.
    if (!Number.isFinite(revendications.exp) || revendications.exp * 1000 + 60000 <= maintenant) return null;
    if (typeof revendications.sub !== 'string' || !revendications.sub) return null;

    return {
        sub: revendications.sub,
        email: typeof revendications.email === 'string' ? revendications.email : '',
        nom: typeof revendications.name === 'string' ? revendications.name : '',
        prenom: typeof revendications.given_name === 'string' ? revendications.given_name : ''
    };
}

// ─────────────────────────── Identité en attente ───────────────────────────

function signature(charge, secret) {
    return crypto.createHmac('sha256', `fz-google-attente:${secret}`).update(charge).digest('base64url');
}

/**
 * Scelle l'identité Google d'une personne qui n'a pas encore de compte
 * Fantazy, le temps qu'elle choisisse son nom d'utilisateur.
 *
 * Signée plutôt que gardée en mémoire : un redémarrage du serveur entre le
 * retour de Google et le choix du nom ne doit pas perdre la personne en
 * route. La signature empêche d'y écrire le `sub` de quelqu'un d'autre.
 */
function scellerAttente(profil, secret, maintenant = Date.now()) {
    const charge = base64url(JSON.stringify({
        sub: profil.sub,
        email: profil.email || '',
        nom: profil.nom || '',
        prenom: profil.prenom || '',
        exp: maintenant + DUREE_ATTENTE_S * 1000
    }));
    return `${charge}.${signature(charge, secret)}`;
}

/** L'identité scellée, ou null si le sceau est faux, abîmé ou périmé. */
function lireAttente(valeur, secret, maintenant = Date.now()) {
    if (typeof valeur !== 'string' || !secret) return null;
    const point = valeur.lastIndexOf('.');
    if (point <= 0) return null;
    const charge = valeur.slice(0, point);
    const recue = Buffer.from(valeur.slice(point + 1));
    const attendue = Buffer.from(signature(charge, secret));
    if (recue.length !== attendue.length || !crypto.timingSafeEqual(recue, attendue)) return null;

    let profil;
    try { profil = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8')); } catch { return null; }
    if (!profil || typeof profil.sub !== 'string' || !profil.sub) return null;
    if (!Number.isFinite(profil.exp) || profil.exp <= maintenant) return null;
    return profil;
}

// ───────────────────────────── Nom d'utilisateur ─────────────────────────────

/** Message d'erreur pour un nom refusé, ou null s'il convient. */
function erreurNom(nom) {
    if (!nom) return "Choisissez un nom d'utilisateur.";
    if (nom.length < 3) return "Le nom d'utilisateur doit contenir au moins 3 caractères.";
    if (nom.length > 20) return "Le nom d'utilisateur ne peut pas dépasser 20 caractères.";
    if (!MOTIF_NOM.test(nom)) return "Lettres, chiffres et underscores uniquement.";
    return null;
}

/**
 * Première proposition de nom, tirée du prénom puis du nom complet.
 *
 * Jamais de l'adresse courriel : le nom d'utilisateur est vu par tous les
 * membres des pools, et suggérer « jean.tremblay84 » pousserait la personne à
 * publier son adresse sans l'avoir décidé. Renvoie '' si rien ne convient.
 */
function nomPropose(profil) {
    for (const source of [profil && profil.prenom, profil && profil.nom]) {
        const nettoye = String(source || '')
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^A-Za-z0-9_]/g, '')
            .slice(0, 20);
        if (nettoye.length >= 3) return nettoye;
    }
    return '';
}

/**
 * Un nom libre à partir de la proposition : tel quel s'il est libre, sinon
 * suffixé d'un nombre. `estPris` est asynchrone (lecture de la base).
 */
async function nomDisponible(base, estPris, { essais = 8, hasard = Math.random } = {}) {
    if (!base) return '';
    if (!(await estPris(base))) return base;
    const racine = base.slice(0, 16);
    for (let i = 0; i < essais; i++) {
        const candidat = `${racine}${Math.floor(10 + hasard() * 990)}`;
        if (!(await estPris(candidat))) return candidat;
    }
    return '';
}

// ─────────────────────────────── Cookies ───────────────────────────────

function cookie(nom, valeur, { maxAge, secure }) {
    const parties = [
        `${nom}=${valeur}`,
        `Path=${CHEMIN_COOKIES}`,
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${maxAge}`
    ];
    if (secure) parties.push('Secure');
    return parties.join('; ');
}

module.exports = {
    URL_JETON,
    COOKIE_ETAT,
    COOKIE_ATTENTE,
    DUREE_ETAT_S,
    DUREE_ATTENTE_S,
    aleatoire,
    genererPkce,
    urlAutorisation,
    corpsEchange,
    lireJetonIdentite,
    scellerAttente,
    lireAttente,
    erreurNom,
    nomPropose,
    nomDisponible,
    cookie
};
