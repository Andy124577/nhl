/**
 * Feuilles de match de la LNH, lues à la demande et gardées en cache.
 *
 * Une feuille coûte trois appels à `gamecenter/{id}` (voir lib/boxscore.js).
 * Ils partent en parallèle, et seul `boxscore` est indispensable : si
 * `right-rail` ou `landing` échoue, la feuille sort quand même, sans le
 * pointage par période ou sans le résumé — mieux vaut la ligne des joueurs
 * seule qu'une page d'erreur.
 *
 * Le cache suit l'état du match (`dureeDeVie`) : quelques secondes en
 * direct, six heures une fois la feuille officielle. Deux visiteurs qui
 * ouvrent le même match en même temps partagent la même requête en vol.
 */

'use strict';

const { formerFeuille, dureeDeVie } = require('../lib/boxscore.js');

const URL_MATCH = 'https://api-web.nhle.com/v1/gamecenter';

/** Au-delà, les feuilles les plus anciennes sortent du cache. */
const TAILLE_MAX = 300;

/** Un identifiant de match de la LNH : saison, type, numéro — dix chiffres. */
const FORMAT_ID = /^\d{10}$/;

class MatchIntrouvable extends Error {}

function creerFeuillesDeMatch({ fetchImpl = null, logger = console, maintenant = () => Date.now() } = {}) {
    const recuperer = fetchImpl || ((...args) => fetch(...args));
    const cache = new Map();   // id → { donnees, lu }
    const enVol = new Map();   // id → Promise

    async function lireJSON(id, section, { requis = false } = {}) {
        let reponse;
        try {
            reponse = await recuperer(`${URL_MATCH}/${id}/${section}`);
        } catch (erreur) {
            if (requis) throw erreur;
            logger.warn?.(`⚠️ Feuille ${id} : ${section} injoignable (${erreur.message})`);
            return null;
        }
        if (reponse.status === 404 && requis) throw new MatchIntrouvable(`match ${id} inconnu de la LNH`);
        if (!reponse.ok) {
            if (requis) throw new Error(`feuille ${id} : ${section} HTTP ${reponse.status}`);
            logger.warn?.(`⚠️ Feuille ${id} : ${section} HTTP ${reponse.status}`);
            return null;
        }
        return reponse.json();
    }

    async function charger(id) {
        const [boxscore, rightRail, landing] = await Promise.all([
            lireJSON(id, 'boxscore', { requis: true }),
            lireJSON(id, 'right-rail'),
            lireJSON(id, 'landing')
        ]);
        const donnees = formerFeuille({ boxscore, rightRail, landing });
        cache.delete(id);
        cache.set(id, { donnees, lu: maintenant() });
        while (cache.size > TAILLE_MAX) cache.delete(cache.keys().next().value);
        return donnees;
    }

    /**
     * La feuille d'un match. Rejette `MatchIntrouvable` pour un identifiant
     * mal formé ou inconnu de la LNH, une autre erreur si la LNH ne répond pas.
     */
    async function lire(gameId) {
        const id = String(gameId || '');
        if (!FORMAT_ID.test(id)) throw new MatchIntrouvable(`identifiant de match invalide : ${id}`);

        const range = cache.get(id);
        if (range && (maintenant() - range.lu) < dureeDeVie(range.donnees.state)) return range.donnees;

        if (enVol.has(id)) return enVol.get(id);
        const requete = charger(id).finally(() => enVol.delete(id));
        enVol.set(id, requete);
        return requete;
    }

    function oublier() { cache.clear(); }

    return { lire, oublier };
}

module.exports = { creerFeuillesDeMatch, MatchIntrouvable, FORMAT_ID, TAILLE_MAX };
