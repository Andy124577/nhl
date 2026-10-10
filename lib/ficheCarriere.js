/**
 * La fiche de carrière (/player-career) : gardée, et relancée quand la LNH
 * limite.
 *
 * La LNH refuse par moments les appels de notre serveur (429). Render sort
 * par des adresses partagées entre ses clients : notre propre collecte, ou
 * le trafic d'un service voisin, suffit à faire limiter l'adresse quelques
 * dizaines de secondes. La route rappelait la LNH à chaque ouverture, sans
 * relance ni copie : toute fiche ouverte à ce moment-là tombait en « erreur
 * 502 ». Vérifié le 5 octobre 2026 : six fiches de suite en 502 (amont 429),
 * toutes à 200 quarante secondes plus tard, alors que la LNH répondait
 * normalement à une autre adresse.
 *
 * D'où trois parades :
 *   - une fiche se garde `fraicheMs` : la rouvrir ne rappelle pas la LNH, et
 *     la collecte des statistiques, qui lit déjà la même page pour chaque
 *     joueur suivi, la range au passage ;
 *   - un refus passager (429, 5xx, réseau) est relancé une fois, après le
 *     délai que la LNH demande (Retry-After), borné : quelqu'un attend ;
 *   - si la LNH refuse encore, la dernière fiche connue sert, même vieille :
 *     une saison en cours en retard d'un jour vaut mieux qu'une erreur.
 */

'use strict';

const RELANCE_DEFAUT_MS = 1500;
const RELANCE_MAX_MS = 3000;
const DELAI_APPEL_MS = 5000;

function creerMemoireFiches({ fraicheMs = 30 * 60 * 1000, max = 1000, horloge = () => Date.now() } = {}) {
    /** id → { le, fiche } — dans l'ordre d'usage, pour la borne. */
    const entrees = new Map();

    function ranger(id, fiche) {
        const cle = String(id);
        entrees.delete(cle);
        entrees.set(cle, { le: horloge(), fiche });
        while (entrees.size > max) entrees.delete(entrees.keys().next().value);
    }

    /** { fiche, fraiche } ou null. Une fiche périmée reste lisible : c'est le repli. */
    function lire(id) {
        const cle = String(id);
        const entree = entrees.get(cle);
        if (!entree) return null;
        entrees.delete(cle);
        entrees.set(cle, entree);
        return { fiche: entree.fiche, fraiche: horloge() - entree.le < fraicheMs };
    }

    return { ranger, lire, taille: () => entrees.size };
}

/** Un refus qui peut passer : limite, panne de la LNH, réseau (0). Pas un 404. */
function passager(status) {
    return status === 0 || status === 429 || status >= 500;
}

/** Le délai de Retry-After (secondes ou date HTTP), borné à RELANCE_MAX_MS. */
function delaiDeRelance(entete, maintenant = Date.now()) {
    if (entete === null || entete === undefined || entete === '') return RELANCE_DEFAUT_MS;
    const secondes = Number(entete);
    const ms = Number.isFinite(secondes) ? secondes * 1000 : Date.parse(entete) - maintenant;
    if (!Number.isFinite(ms)) return RELANCE_DEFAUT_MS;
    return Math.min(Math.max(ms, 0), RELANCE_MAX_MS);
}

/**
 * Lit une page de la LNH, relancée une fois si le refus est passager.
 * Ne lève jamais : { status, data } en cas de succès, { status } sinon
 * (0 quand la LNH n'a pas répondu du tout).
 */
async function lireAvecRelance(url, {
    lire = (u, options) => fetch(u, options),
    attendre = ms => new Promise(r => setTimeout(r, ms)),
    delaiAppelMs = DELAI_APPEL_MS
} = {}) {
    let echec = null;
    for (let essai = 0; essai < 2; essai += 1) {
        if (echec) await attendre(delaiDeRelance(echec.retryAfter));
        try {
            const reponse = await lire(url, { signal: AbortSignal.timeout(delaiAppelMs) });
            if (reponse.ok) return { status: reponse.status, data: await reponse.json() };
            echec = { status: reponse.status, retryAfter: reponse.headers?.get?.('retry-after') ?? null };
        } catch (erreur) {
            echec = { status: 0, retryAfter: null };
        }
        if (!passager(echec.status)) break;
    }
    return { status: echec.status };
}

/**
 * Ce que /player-career répond, { status, corps } : la fiche gardée si elle
 * est fraîche, sinon celle de la LNH, sinon la fiche gardée même vieille.
 * Un 404 de la LNH dit que le joueur n'existe pas : aucune copie ne le
 * contredit.
 */
async function obtenirFiche(playerId, { memoire, mettreEnForme, lire = lireAvecRelance, journal = console }) {
    const gardee = memoire.lire(playerId);
    if (gardee && gardee.fraiche) return { status: 200, corps: gardee.fiche };

    const { status, data } = await lire(`https://api-web.nhle.com/v1/player/${playerId}/landing`);
    if (data) {
        const fiche = mettreEnForme(playerId, data);
        memoire.ranger(playerId, fiche);
        return { status: 200, corps: fiche };
    }
    if (status === 404) return { status: 404, corps: { message: 'Player not found' } };

    const cause = status || 'injoignable';
    if (gardee) {
        journal.warn(`⚠️ NHL API ${cause} for player ${playerId} — fiche gardée servie`);
        return { status: 200, corps: gardee.fiche };
    }
    journal.error(`❌ NHL API ${cause} for player ${playerId}`);
    return { status: 502, corps: { message: 'NHL API unavailable', upstreamStatus: status } };
}

module.exports = { creerMemoireFiches, lireAvecRelance, obtenirFiche, delaiDeRelance, passager };
