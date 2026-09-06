/**
 * Fraîcheur du cache de statistiques.
 *
 * Décide s'il faut rappeler l'API de la LNH, et dit pourquoi.
 *
 * Extrait de server.js — le corps des fonctions est inchangé. Le serveur les
 * réimporte en haut de server.js ; les tests unitaires (test/unit/) les
 * chargent directement, ce qui était impossible depuis server.js : le
 * require déclenchait Express, Socket.IO, les tâches cron et le pool
 * Postgres.
 */

'use strict';

/** Saison en cours. Vivait en dur dans la condition de rafraîchissement. */
const CURRENT_SEASON = 20252026;

// Checks whether the cached stats are missing, stale (>24h), for the wrong
// season, or suspiciously incomplete. Shared by the /current-stats route and
// the startup warm-up so both use the same staleness rule.
function getStatsRefreshStatus(stats, expectedPlayerCount, season = CURRENT_SEASON, now = Date.now()) {
    const ageHours = stats.lastUpdated
        ? (now - new Date(stats.lastUpdated).getTime()) / 3600000
        : Infinity;
    const cacheIsIncomplete = stats.players.length < Math.min(expectedPlayerCount * 0.5, 200);
    const needsRefresh = !stats.lastUpdated || stats.season !== season || ageHours > 24 || cacheIsIncomplete;
    const reason = !stats.lastUpdated
        ? 'no local cache yet'
        : cacheIsIncomplete
            ? `incomplete cache (${stats.players.length}/${expectedPlayerCount} players)`
            : stats.season !== season ? `wrong season (${stats.season})` : `cache is ${ageHours.toFixed(1)}h old`;
    return { needsRefresh, cacheIsIncomplete, expectedPlayerCount, ageHours, reason };
}
module.exports = {
    CURRENT_SEASON,
    getStatsRefreshStatus
};
