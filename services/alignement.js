/**
 * Alignements des clubs de la LNH, lus à la demande et gardés en cache.
 *
 * Trois sources par club, lues en parallèle (voir lib/alignement.js) :
 *
 *   - les trios de Daily Faceoff : dix minutes de cache, parce que c'est la
 *     raison d'être de la page — un trio changé à l'entraînement du matin
 *     doit se voir avant le match du soir ;
 *   - l'effectif officiel de la LNH : trente minutes ; un rappel du club
 *     école s'y voit dans la demi-heure ;
 *   - les statistiques de saison de toute la ligue : trente minutes, une
 *     seule copie pour les 32 clubs.
 *
 * Seuls les trios sont précieux. Chaque lecture réussie est rangée en base
 * (quand l'heure de mise à jour de Daily Faceoff a changé), si bien qu'un
 * redémarrage du serveur, ou un Daily Faceoff qui refuse de répondre, sert
 * encore les derniers trios connus — marqués `stale`, avec leur heure réelle.
 * Après un échec, on attend deux minutes avant de redemander, pour ne pas
 * frapper à chaque visite une page qui nous refuse.
 *
 * Deux visiteurs qui ouvrent le même club en même temps partagent les mêmes
 * requêtes en vol.
 */

'use strict';

const {
    SLUGS_DFO, urlDFO, extraireCombinaisons, lireEffectif, lireStats, formerAlignement
} = require('../lib/alignement.js');

const TTL_TRIOS_MS = 10 * 60 * 1000;
const TTL_EFFECTIF_MS = 30 * 60 * 1000;
const TTL_STATS_MS = 30 * 60 * 1000;
const RELANCE_APRES_ECHEC_MS = 2 * 60 * 1000;
const DELAI_MAX_MS = 10 * 1000;

const URL_EFFECTIF = code => `https://api-web.nhle.com/v1/roster/${code}/current`;
const URL_STATS = (type, saison) => 'https://api.nhle.com/stats/rest/en/' +
    `${type}/summary?limit=-1&cayenneExp=seasonId=${saison}%20and%20gameTypeId=2`;

/**
 * Daily Faceoff passe par Cloudflare, qui renvoie une page « Attention
 * Required » à une requête sans en-têtes de navigateur (vérifié le 25
 * septembre 2026). Avec eux, la page complète.
 */
const ENTETES_DFO = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9'
};

/** Clé de la dernière lecture réussie en base, une par club. */
const CLE_BASE = code => `lineup_${code}`;

class EquipeInconnue extends Error {}

function creerAlignements({
    db = null, fetchImpl = null, logger = console,
    maintenant = () => Date.now(), saison = async () => null
} = {}) {
    const recuperer = fetchImpl || ((...args) => fetch(...args));
    const trios = new Map();      // club → { donnees, lu, echec }
    const effectifs = new Map();  // club → { donnees, lu }
    let stats = null;             // { saison, donnees, lu }
    const enVol = new Map();      // clé → Promise

    function uneSeuleFois(cle, travail) {
        if (enVol.has(cle)) return enVol.get(cle);
        const requete = Promise.resolve().then(travail).finally(() => enVol.delete(cle));
        enVol.set(cle, requete);
        return requete;
    }

    async function lire(url, { format = 'json', headers } = {}) {
        const reponse = await recuperer(url, { headers, signal: AbortSignal.timeout(DELAI_MAX_MS) });
        if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
        return format === 'json' ? reponse.json() : reponse.text();
    }

    async function depuisLaBase(code) {
        if (!db || !db.loadCachedStats) return null;
        try {
            const range = await db.loadCachedStats(CLE_BASE(code));
            if (!range || !Array.isArray(range.players) || !range.players.length) return null;
            return {
                updatedAt: range.updatedAt || null,
                sourceName: range.sourceName || null,
                sourceUrl: range.sourceUrl || null,
                players: range.players
            };
        } catch (erreur) {
            logger.error?.(`⚠️ Trios ${code} illisibles en base :`, erreur.message);
            return null;
        }
    }

    function versLaBase(code, donnees) {
        if (!db || !db.saveCachedStats) return;
        Promise.resolve(db.saveCachedStats(CLE_BASE(code), donnees)).catch(erreur =>
            logger.error?.(`⚠️ Trios ${code} non rangés en base :`, erreur.message));
    }

    /** Les trios d'un club, et s'ils sont périmés. */
    async function combinaisons(code) {
        const range = trios.get(code);
        const t = maintenant();
        if (range && range.donnees && !range.echec && t - range.lu < TTL_TRIOS_MS) {
            return { donnees: range.donnees, perime: false };
        }
        if (range && range.echec && t - range.echec < RELANCE_APRES_ECHEC_MS) {
            return { donnees: range.donnees, perime: !!range.donnees };
        }

        return uneSeuleFois(`trios:${code}`, async () => {
            const avant = trios.get(code);
            try {
                const html = await lire(urlDFO(code), { format: 'texte', headers: ENTETES_DFO });
                const donnees = extraireCombinaisons(html);
                if (!donnees) throw new Error('page sans trios lisibles');
                trios.set(code, { donnees, lu: maintenant(), echec: 0 });
                if (!avant || !avant.donnees || avant.donnees.updatedAt !== donnees.updatedAt) versLaBase(code, donnees);
                return { donnees, perime: false };
            } catch (erreur) {
                logger.warn?.(`⚠️ Trios ${code} indisponibles chez Daily Faceoff (${erreur.message})`);
                const connus = (avant && avant.donnees) || await depuisLaBase(code);
                trios.set(code, { donnees: connus, lu: avant ? avant.lu : 0, echec: maintenant() });
                return { donnees: connus, perime: !!connus };
            }
        });
    }

    /** L'effectif officiel d'un club ; le dernier connu si la LNH ne répond pas. */
    async function effectif(code) {
        const range = effectifs.get(code);
        if (range && maintenant() - range.lu < TTL_EFFECTIF_MS) return range.donnees;

        return uneSeuleFois(`effectif:${code}`, async () => {
            try {
                const donnees = lireEffectif(await lire(URL_EFFECTIF(code)));
                if (!donnees.length) throw new Error('effectif vide');
                effectifs.set(code, { donnees, lu: maintenant() });
                return donnees;
            } catch (erreur) {
                logger.warn?.(`⚠️ Effectif ${code} indisponible (${erreur.message})`);
                return range ? range.donnees : [];
            }
        });
    }

    /** Les statistiques de la saison pour toute la ligue, ou null. */
    async function statistiques(idSaison) {
        if (!idSaison) return null;
        if (stats && stats.saison === idSaison && maintenant() - stats.lu < TTL_STATS_MS) return stats.donnees;

        return uneSeuleFois(`stats:${idSaison}`, async () => {
            try {
                const [patineurs, gardiens] = await Promise.all([
                    lire(URL_STATS('skater', idSaison)),
                    lire(URL_STATS('goalie', idSaison))
                ]);
                const donnees = lireStats(patineurs, gardiens);
                stats = { saison: idSaison, donnees, lu: maintenant() };
                return donnees;
            } catch (erreur) {
                logger.warn?.(`⚠️ Statistiques ${idSaison} indisponibles (${erreur.message})`);
                return stats && stats.saison === idSaison ? stats.donnees : null;
            }
        });
    }

    /**
     * L'alignement d'un club. Rejette `EquipeInconnue` pour un code hors de
     * la LNH, une autre erreur si aucune source n'a rien donné.
     */
    async function alignement(equipe) {
        const code = String(equipe || '').trim().toUpperCase();
        if (!Object.prototype.hasOwnProperty.call(SLUGS_DFO, code)) {
            throw new EquipeInconnue(`club inconnu : ${equipe}`);
        }

        const infoSaison = await Promise.resolve().then(saison).catch(() => null);
        const [lues, joueurs, chiffres] = await Promise.all([
            combinaisons(code),
            effectif(code),
            statistiques(infoSaison && infoSaison.seasonId)
        ]);
        if (!lues.donnees && !joueurs.length) throw new Error(`ni trios ni effectif pour ${code}`);

        return formerAlignement({
            equipe: code,
            combinaisons: lues.donnees,
            perime: lues.perime,
            effectif: joueurs,
            stats: chiffres,
            saison: infoSaison,
            genereLe: new Date(maintenant()).toISOString()
        });
    }

    function oublier() {
        trios.clear();
        effectifs.clear();
        stats = null;
    }

    return { lire: alignement, oublier };
}

module.exports = {
    creerAlignements, EquipeInconnue,
    TTL_TRIOS_MS, TTL_EFFECTIF_MS, TTL_STATS_MS, RELANCE_APRES_ECHEC_MS
};
