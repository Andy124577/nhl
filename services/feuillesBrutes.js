/**
 * Les feuilles de match brutes de la LNH (/gamecenter/{id}/boxscore),
 * partagées par tout ce qui les lit un soir de match.
 *
 * Les points en direct (services/pointsEnDirect.js) et « Mes joueurs ce
 * soir » (/tonight-boxscores) lisaient chacun les mêmes feuilles de leur
 * côté — /tonight-boxscores toutes celles de la journée, matchs finis depuis
 * des heures compris, toutes les 25 secondes. Ils passent maintenant par ici :
 * une feuille lue pour l'un sert à l'autre, et chaque appelant dit l'âge
 * qu'il tolère (`ageMaxMs`). Deux demandes simultanées du même match
 * partagent la même requête.
 *
 * La LNH ne répond pas : la dernière copie connue, plutôt qu'un trou.
 */

'use strict';

const URL_MATCH = 'https://api-web.nhle.com/v1/gamecenter';

/** Seize matchs un soir chargé, et ceux de la veille : de la marge. */
const TAILLE_MAX = 64;
const DELAI_MS = 8000;

/**
 * L'âge qu'une page peut tolérer, selon l'état du match : en jeu, une
 * feuille bouge à chaque tir ; finie, elle n'attend plus que d'être
 * officielle ; officielle, seules les corrections tardives de la LNH la
 * changent encore.
 */
const AGE_PAR_ETAT = { LIVE: 20 * 1000, CRIT: 20 * 1000, FINAL: 60 * 1000, OFF: 30 * 60 * 1000 };
const AGE_DEFAUT_MS = 20 * 1000;

function ageTolere(etat) {
    return AGE_PAR_ETAT[etat] ?? AGE_DEFAUT_MS;
}

function creerFeuillesBrutes({ fetchImpl = null, maintenant = () => Date.now(), delaiMs = DELAI_MS } = {}) {
    const recuperer = fetchImpl || ((...args) => fetch(...args));
    const cache = new Map();   // id → { box, lu }
    const enVol = new Map();   // id → Promise

    async function charger(id) {
        const reponse = await recuperer(`${URL_MATCH}/${id}/boxscore`, { signal: AbortSignal.timeout(delaiMs) });
        if (!reponse.ok) return null;
        const box = await reponse.json();
        cache.delete(id);
        cache.set(id, { box, lu: maintenant() });
        while (cache.size > TAILLE_MAX) cache.delete(cache.keys().next().value);
        return box;
    }

    /**
     * La feuille du match `gameId`, lue il y a moins de `ageMaxMs`, sinon
     * relue. null si la LNH ne l'a jamais rendue.
     */
    async function lire(gameId, { ageMaxMs = 0 } = {}) {
        const id = String(gameId);
        const connue = cache.get(id);
        if (connue && maintenant() - connue.lu < ageMaxMs) return connue.box;
        if (enVol.has(id)) return enVol.get(id);

        const requete = charger(id)
            .then(box => box || (connue ? connue.box : null))
            .catch(erreur => {
                if (connue) return connue.box;
                throw erreur;
            })
            .finally(() => enVol.delete(id));
        enVol.set(id, requete);
        return requete;
    }

    /** L'instant où la feuille en main a été lue (ms), 0 sans feuille. */
    function luLe(gameId) {
        const connue = cache.get(String(gameId));
        return connue ? connue.lu : 0;
    }

    return { lire, luLe };
}

module.exports = { creerFeuillesBrutes, ageTolere, AGE_PAR_ETAT, TAILLE_MAX };
