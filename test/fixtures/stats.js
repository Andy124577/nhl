/**
 * Fabriques de statistiques.
 *
 * Le format est celui de current_stats.json : { season, lastUpdated, players }
 * où chaque entrée porte playerName, position et les totaux de la saison.
 */

'use strict';

/** Une ligne de patineur. `points` est ce que lisent les deux agrégats. */
function makeSkaterStat(playerName, over = {}) {
    return {
        playerName,
        playerId: 8400000 + playerName.length,
        position: 'C',
        teamAbbrev: 'MTL',
        gamesPlayed: 82,
        goals: 30,
        assists: 40,
        points: 70,
        ...over
    };
}

/**
 * Une ligne de gardien. computeTeamSeasonScores lit shutouts/wins/otLosses,
 * getTeamWeeklyPoints lit points — d'où les deux jeux de champs.
 */
function makeGoalieStat(playerName, over = {}) {
    return {
        playerName,
        playerId: 8470000 + playerName.length,
        position: 'G',
        teamAbbrev: 'MTL',
        gamesPlayed: 60,
        wins: 30,
        otLosses: 6,
        shutouts: 4,
        points: 0,
        ...over
    };
}

/** Le cache complet. */
function makeStats(players = [], over = {}) {
    return {
        season: 20252026,
        lastUpdated: '2026-01-15T12:00:00.000Z',
        players,
        ...over
    };
}

/** Une ligne de sommaire de match, pour les points « ce soir ». */
function makeBoxscoreSkater(over = {}) {
    return { goals: 0, assists: 0, shots: 0, plusMinus: 0, ...over };
}

function makeBoxscoreGoalie(over = {}) {
    return { decision: null, shutout: false, saves: 0, goalsAgainst: 0, ...over };
}

module.exports = { makeSkaterStat, makeGoalieStat, makeStats, makeBoxscoreSkater, makeBoxscoreGoalie };
