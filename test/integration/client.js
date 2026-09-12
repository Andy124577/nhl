/**
 * Client HTTP des essais d'intégration, conscient des sessions.
 *
 * Les trois scripts d'intégration envoyaient `username` dans le corps de
 * chaque requête et le serveur le croyait. Il ne le croit plus : l'identité
 * vient d'un cookie de session, et un nom qui ne correspond pas à la session
 * est refusé plutôt qu'ignoré. Sans adaptation, ces scripts échoueraient
 * partout — non parce que le produit est cassé, mais parce qu'ils prouvaient
 * quelque chose qui n'a plus lieu d'être.
 *
 * Ce client fait donc deux choses :
 *
 *   1. il garde un pot de cookies PAR COMPTE, et bascule automatiquement sur
 *      celui du `username` que la requête mentionne. Les scripts n'ont donc
 *      pas à s'ouvrir une session à la main avant chaque appel ;
 *   2. il refuse de démarrer contre autre chose qu'un serveur d'essai. Ces
 *      scripts créent, modifient et suppriment des pools : les pointer vers
 *      une base de développement ou de production effacerait le travail de
 *      vraies personnes.
 *
 * ┌─ Pour les exécuter ──────────────────────────────────────────────────────┐
 * │ TEST_SERVER_URL=http://localhost:3999 npm run test:integration           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

'use strict';

/**
 * L'adresse du serveur d'essai.
 *
 * Aucune valeur par défaut sur le port 3000 : c'est celui du serveur de
 * développement, et un script de mutation lancé par erreur contre lui
 * détruirait des données réelles. L'adresse doit être fournie.
 */
const BASE = process.env.TEST_SERVER_URL || null;

/**
 * Mot de passe des comptes d'essai.
 *
 * Configurable, parce que les trois scripts n'ont pas choisi la même
 * convention. Le client doit pouvoir OUVRIR une session, pas seulement en
 * créer une : un compte laissé par une exécution précédente ne se reconnecte
 * qu'avec le mot de passe qui a servi à le créer.
 */
let convention = (compte) => `${compte}Pass1`;
const MOT_DE_PASSE = (compte) => convention(compte);

/** Change la convention de mot de passe. À appeler avant le premier appel. */
function configurer({ motDePasse } = {}) {
    if (typeof motDePasse === 'function') convention = motDePasse;
}

function exigerServeurDEssai() {
    if (!BASE) {
        console.error('\n❌ TEST_SERVER_URL absent.');
        console.error('   Ces essais créent et suppriment des pools. Ils exigent un serveur');
        console.error('   jetable, dont l’adresse doit être donnée explicitement :');
        console.error('\n   TEST_SERVER_URL=http://localhost:3999 npm run test:integration\n');
        process.exit(1);
    }
}

/** Un pot de cookies par compte : deux comptes ne partagent jamais de session. */
const pots = new Map();
let compteCourant = null;

function pot(compte) {
    if (!pots.has(compte)) pots.set(compte, { cookie: null });
    return pots.get(compte);
}

async function requete(methode, chemin, corps, compte) {
    const entetes = { 'Content-Type': 'application/json', Origin: BASE };
    const jar = compte ? pot(compte) : null;
    if (jar && jar.cookie) entetes.Cookie = jar.cookie;

    try {
        const reponse = await fetch(`${BASE}${chemin}`, {
            method: methode,
            headers: entetes,
            body: corps === undefined ? undefined : JSON.stringify(corps)
        });

        if (jar) {
            for (const c of (reponse.headers.getSetCookie ? reponse.headers.getSetCookie() : [])) {
                if (c.startsWith('fz_session=')) {
                    jar.cookie = c.split(';')[0];
                    // Un cookie vidé est une déconnexion : on ne le garde pas.
                    if (jar.cookie === 'fz_session=') jar.cookie = null;
                }
            }
        }

        let json;
        try { json = await reponse.json(); } catch { json = {}; }
        return { status: reponse.status, ok: reponse.ok, body: json };
    } catch (erreur) {
        return { status: 0, ok: false, body: {}, error: erreur.message };
    }
}

/**
 * Ouvre une session pour ce compte, en le créant s'il n'existe pas.
 *
 * Mémorisée : une fois la session ouverte, les appels suivants réutilisent son
 * cookie. Un cookie périmé se reconnaît à un 401 et provoque une reconnexion.
 */
async function identifier(compte) {
    const jar = pot(compte);
    if (jar.cookie) return true;

    let r = await requete('POST', '/login', { username: compte, password: MOT_DE_PASSE(compte) }, compte);
    if (!r.ok) {
        await requete('POST', '/signup', { username: compte, password: MOT_DE_PASSE(compte) }, compte);
        if (!pot(compte).cookie) {
            r = await requete('POST', '/login', { username: compte, password: MOT_DE_PASSE(compte) }, compte);
        }
    }
    return !!pot(compte).cookie;
}

/**
 * Appelle une route, en se plaçant d'office sous l'identité que la requête
 * mentionne.
 *
 * `username` dans le corps, `listedBy`, ou un `:username` dans le chemin : le
 * client s'en sert pour choisir la session, puis laisse le champ en place. Le
 * serveur le compare à la session — et c'est exactement le contrôle qu'on
 * veut exercer.
 */
async function api(methode, chemin, corps, options = {}) {
    exigerServeurDEssai();

    const compte = options.as
        || (corps && typeof corps.username === 'string' ? corps.username : null)
        || (corps && typeof corps.listedBy === 'string' ? corps.listedBy : null)
        || compteCourant;

    if (compte && !options.anonyme) {
        await identifier(compte);
        compteCourant = compte;
    }

    const reponse = await requete(methode, chemin, corps, options.anonyme ? null : compte);

    // Session expirée en cours d'essai : une seule reconnexion, puis on
    // réessaie. Au-delà, l'échec est réel et doit se voir.
    if (reponse.status === 401 && compte && !options.anonyme && !options.dejaReessaye) {
        pot(compte).cookie = null;
        await identifier(compte);
        return requete(methode, chemin, corps, compte);
    }

    return reponse;
}

/** Appel volontairement anonyme : sert à vérifier qu'une route est fermée. */
const apiAnonyme = (methode, chemin, corps) => api(methode, chemin, corps, { anonyme: true });

/** Ferme toutes les sessions ouvertes. À appeler en fin d'essai. */
async function deconnecterTout() {
    for (const compte of [...pots.keys()]) {
        if (pot(compte).cookie) await requete('POST', '/logout', {}, compte);
        pots.delete(compte);
    }
    compteCourant = null;
}

module.exports = { BASE, MOT_DE_PASSE, configurer, api, apiAnonyme, identifier, deconnecterTout, exigerServeurDEssai };
