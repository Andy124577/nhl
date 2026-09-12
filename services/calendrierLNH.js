/**
 * Combien de matchs la LNH a-t-elle réellement joués ce jour-là ?
 *
 * C'est la question dont dépend toute la notion de « données complètes ».
 * Compter les feuilles de match reçues pour décider si elles sont toutes là
 * serait circulaire : zéro feuille signifierait « aucun match », et une semaine
 * entièrement manquante ressemblerait à une semaine sans hockey. Il faut donc
 * une référence extérieure — le calendrier de la LNH.
 *
 * Ce que ce module compte : les matchs de saison régulière TERMINÉS. Pas les
 * matchs prévus, pas ceux en cours. Une rencontre encore en troisième période
 * n'a pas de feuille de match, et l'attendre ferait déclarer incomplète une
 * journée qui se déroule normalement. Un match reporté, lui, disparaît du
 * calendrier de sa date d'origine, donc cesse d'être attendu.
 *
 * Deux niveaux de cache, parce que les deux besoins sont différents :
 *
 *   - une journée passée ne change plus. Son compte est rangé en base, et
 *     survit au redémarrage ;
 *   - une journée en cours change toutes les quelques minutes. Son compte reste
 *     en mémoire avec une courte durée de vie.
 *
 * Aucun appel réseau n'est fait pendant qu'une transaction est ouverte : le
 * service est interrogé avant, et son résultat passé au calcul.
 */

'use strict';

const dates = require('../lib/dates.js');

const URL_CALENDRIER = 'https://api-web.nhle.com/v1/schedule';

/** Une journée close ne bouge plus : on la garde longtemps. */
const TTL_PASSE_MS = 7 * 24 * 60 * 60 * 1000;

/** Une journée en cours change sans cesse : on la garde peu. */
const TTL_COURANT_MS = 5 * 60 * 1000;

/** Clé de cache en base, une par journée. */
const CLE_CACHE = (journee) => `nhl_games_done_${journee}`;

/** États que la LNH donne à un match dont la feuille existe. */
const ETATS_TERMINES = new Set(['FINAL', 'OFF']);

/**
 * Types de match qui comptent pour un pool.
 *
 * 2 = saison régulière. La présaison (1) ne compte dans aucun pool, et les
 * séries (3) ne sont pas couvertes par les règles actuelles. Compter la
 * présaison ferait déclarer une semaine d'octobre incomplète pour des matchs
 * dont aucune feuille n'est attendue.
 */
const TYPES_COMPTES = new Set([2]);

function creerCalendrierLNH({ db = null, fetchImpl = null, logger = console, maintenant = () => new Date() } = {}) {
    const memoire = new Map(); // journée → { matchs, lu }

    const recuperer = fetchImpl || ((...args) => fetch(...args));

    /** Cette journée est-elle déjà derrière nous ? */
    function estPassee(journee) {
        return journee < dates.journeeLocale(maintenant());
    }

    /** Lit le compte rangé en base, ou null. */
    async function depuisLaBase(journee) {
        if (!db || !db.loadCachedStats) return null;
        try {
            const range = await db.loadCachedStats(CLE_CACHE(journee));
            if (range && Number.isFinite(range.matchs)) return range.matchs;
        } catch (erreur) {
            logger.error?.('⚠️ Cache de calendrier illisible :', erreur.message);
        }
        return null;
    }

    async function versLaBase(journee, matchs) {
        if (!db || !db.saveCachedStats) return;
        try { await db.saveCachedStats(CLE_CACHE(journee), { journee, matchs }); }
        catch (erreur) { logger.error?.('⚠️ Cache de calendrier non écrit :', erreur.message); }
    }

    /**
     * Interroge la LNH et compte les matchs terminés de cette journée.
     *
     * L'API renvoie une semaine entière autour de la date demandée ; on en
     * profite pour ranger les autres journées au passage, ce qui évite sept
     * appels réseau pour évaluer une semaine.
     */
    async function interroger(journee) {
        const reponse = await recuperer(`${URL_CALENDRIER}/${journee}`);
        if (!reponse.ok) throw new Error(`calendrier LNH : HTTP ${reponse.status}`);
        const brut = await reponse.json();

        const comptes = new Map();
        for (const jour of (brut.gameWeek || [])) {
            const termines = (jour.games || []).filter(
                match => ETATS_TERMINES.has(match.gameState) && TYPES_COMPTES.has(match.gameType)
            ).length;
            comptes.set(jour.date, termines);
        }
        return comptes;
    }

    /**
     * Nombre de matchs terminés une journée donnée, ou null si on ne sait pas.
     *
     * `null` est une réponse à part entière : il vaut mieux dire « je ne sais
     * pas » que renvoyer zéro, qu'un appelant prendrait pour « aucun match » et
     * donc pour une journée complète.
     */
    async function matchsTermines(journee) {
        const jour = dates.journeeDe(journee);
        if (!jour) return null;

        const ttl = estPassee(jour) ? TTL_PASSE_MS : TTL_COURANT_MS;
        const enMemoire = memoire.get(jour);
        if (enMemoire && (Date.now() - enMemoire.lu) < ttl) return enMemoire.matchs;

        if (estPassee(jour)) {
            const range = await depuisLaBase(jour);
            if (range != null) {
                memoire.set(jour, { matchs: range, lu: Date.now() });
                return range;
            }
        }

        try {
            const comptes = await interroger(jour);
            const maintenantMs = Date.now();
            for (const [date, matchs] of comptes) {
                memoire.set(date, { matchs, lu: maintenantMs });
                if (estPassee(date)) await versLaBase(date, matchs);
            }
            return comptes.has(jour) ? comptes.get(jour) : 0;
        } catch (erreur) {
            logger.error?.(`⚠️ Calendrier LNH indisponible pour ${jour} :`, erreur.message);
            return null;
        }
    }

    /** Le total d'une période semi-ouverte, ou null si une journée manque. */
    async function matchsSurPeriode(debut, fin) {
        let total = 0;
        for (const journee of dates.journeesDe(debut, fin)) {
            const matchs = await matchsTermines(journee);
            if (matchs == null) return null;
            total += matchs;
        }
        return total;
    }

    /** Vide les caches — utile aux tests et après un changement de saison. */
    function oublier() { memoire.clear(); }

    return { matchsTermines, matchsSurPeriode, oublier, URL_CALENDRIER };
}

module.exports = { creerCalendrierLNH, ETATS_TERMINES, TYPES_COMPTES, TTL_PASSE_MS, TTL_COURANT_MS };
