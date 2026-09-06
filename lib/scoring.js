/**
 * Barème de pointage et totaux d'équipe.
 *
 * Toute la conversion « statistiques LNH → points de pool » vit ici : le
 * barème quotidien (FANTASY_SCORING) et les deux agrégats de saison.
 *
 * Extrait de server.js — le corps des fonctions est inchangé. Le serveur les
 * réimporte en haut de server.js ; les tests unitaires (test/unit/) les
 * chargent directement, ce qui était impossible depuis server.js : le
 * require déclenchait Express, Socket.IO, les tâches cron et le pool
 * Postgres.
 */

'use strict';

// Fantasy scoring rules
const FANTASY_SCORING = {
    goal: 3,
    assist: 2,
    shot: 0.5,
    powerPlayGoal: 1,  // Bonus on top of goal
    powerPlayPoint: 0.5,
    shorthandedGoal: 2, // Bonus on top of goal
    shorthandedPoint: 1,
    gameWinningGoal: 1,
    plusMinus: 0.5,
    // Goalie stats
    win: 5,
    shutout: 3,
    save: 0.2,
    goalsAgainst: -1
};

// Server-side twin of buildTeamScores in accueil.js (client, ~line 681) —
// same season-cumulative formula (skater: NHL "points" stat; goalie:
// shutouts*5 + wins*2 + otLosses*1), so a rank computed here matches what
// the homepage's own "current rank" already shows. Kept in lockstep with
// accueil.js on purpose: this is what both the daily snapshot and the live
// side of /pool-rank-movement are computed with.
function computeTeamSeasonScores(poolData, statsPlayers) {
    const playerPts = {};
    (statsPlayers || []).forEach(p => {
        const name = p.playerName;
        if (!name) return;
        playerPts[name] = p.position === 'G'
            ? (p.shutouts || 0) * 5 + (p.wins || 0) * 2 + (p.otLosses || 0) * 1
            : (p.points || 0);
    });

    const rows = Object.entries(poolData.teams || {})
        .filter(([, td]) => (td.members || []).length > 0)
        .map(([teamName, td]) => {
            const names = [
                ...(td.offensive || []),
                ...(td.defensive || []),
                ...(td.goalie || []),
                ...(td.rookie || [])
            ].map(p => (typeof p === 'string') ? p : (p.skaterFullName || p.goalieFullName || p));
            const score = names.reduce((s, n) => s + (playerPts[n] || 0), 0);
            return { teamName, score };
        });

    rows.sort((a, b) => b.score - a.score);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
}

// Calculate total points for a team for a given week
function getTeamWeeklyPoints(teamData, currentStats) {
    if (!teamData) return 0;
    let totalPoints = 0;

    // Helper function to get current player stats
    function getPlayerPoints(playerData) {
        if (!currentStats || !currentStats.players) return 0;

        const playerName = playerData.skaterFullName || playerData.goalieFullName || playerData;
        if (!playerName) return 0;

        const stats = currentStats.players.find(p => p.playerName === playerName);
        return stats ? (stats.points || 0) : 0;
    }

    // Sum points from all positions (use correct pool key names)
    ['offensive', 'defensive', 'rookie', 'goalie'].forEach(position => {
        if (teamData[position]) {
            teamData[position].forEach(player => {
                totalPoints += getPlayerPoints(player);
            });
        }
    });

    return totalPoints;
}

function skaterFantasyPointsTonight(s) {
    let fp = (s.goals || 0) * FANTASY_SCORING.goal + (s.assists || 0) * FANTASY_SCORING.assist +
        (s.shots || 0) * FANTASY_SCORING.shot + (s.plusMinus || 0) * FANTASY_SCORING.plusMinus;
    return Math.round(fp * 10) / 10;
}

function goalieFantasyPointsTonight(s) {
    let fp = (s.decision === 'W' ? FANTASY_SCORING.win : 0) +
        (s.shutout ? FANTASY_SCORING.shutout : 0) +
        (s.saves || 0) * FANTASY_SCORING.save +
        (s.goalsAgainst || 0) * FANTASY_SCORING.goalsAgainst;
    return Math.round(fp * 10) / 10;
}
module.exports = {
    FANTASY_SCORING,
    computeTeamSeasonScores,
    getTeamWeeklyPoints,
    skaterFantasyPointsTonight,
    goalieFantasyPointsTonight
};
