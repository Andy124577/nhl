/**
 * Mode tête-à-tête : appariements, résultats hebdomadaires, calendrier.
 *
 * Les fonctions qui décident qui affronte qui, qui gagne, et de quelle
 * semaine il s'agit.
 *
 * Extrait de server.js — le corps des fonctions est inchangé. Le serveur les
 * réimporte en haut de server.js ; les tests unitaires (test/unit/) les
 * chargent directement, ce qui était impossible depuis server.js : le
 * require déclenchait Express, Socket.IO, les tâches cron et le pool
 * Postgres.
 */

'use strict';

const { getTeamWeeklyPoints } = require('./scoring.js');

// Generate random matchups for a week (avoid repeats if possible)
function generateWeeklyMatchups(teams, previousMatchups = []) {
    const teamNames = teams.filter(t => t.members && t.members.length > 0).map(t => t.name);

    if (teamNames.length % 2 !== 0) {
        console.error("⚠️ Cannot generate matchups: odd number of teams!");
        return [];
    }

    if (teamNames.length === 0) {
        console.error("⚠️ Cannot generate matchups: no active teams!");
        return [];
    }

    // Special case: 2 teams always play each other
    if (teamNames.length === 2) {
        return [{
            team1: teamNames[0],
            team2: teamNames[1],
            team1Points: 0,
            team2Points: 0,
            winner: null,
            weekNumber: null // Will be set when saved
        }];
    }

    // For >2 teams: try to avoid immediate repetition
    // Build a set of recent pairings from last 2-3 weeks
    const recentPairings = new Set();
    const recentWeeks = previousMatchups.slice(-3); // Last 3 weeks
    recentWeeks.forEach(weekMatchups => {
        if (Array.isArray(weekMatchups)) {
            weekMatchups.forEach(m => {
                if (m.team1 && m.team2) {
                    const pair1 = [m.team1, m.team2].sort().join('|');
                    recentPairings.add(pair1);
                }
            });
        }
    });

    // Try up to 10 shuffles to find a set of matchups with minimal repetition
    let bestMatchups = null;
    let bestScore = Infinity;

    for (let attempt = 0; attempt < 10; attempt++) {
        // Shuffle teams randomly
        const shuffled = [...teamNames].sort(() => Math.random() - 0.5);

        // Create pairs
        const matchups = [];
        let repetitionScore = 0;

        for (let i = 0; i < shuffled.length; i += 2) {
            const team1 = shuffled[i];
            const team2 = shuffled[i + 1];
            const pairKey = [team1, team2].sort().join('|');

            // Count if this pairing was recent
            if (recentPairings.has(pairKey)) {
                repetitionScore++;
            }

            matchups.push({
                team1,
                team2,
                team1Points: 0,
                team2Points: 0,
                winner: null,
                weekNumber: null // Will be set when saved
            });
        }

        // Keep track of best matchups (fewest repetitions)
        if (repetitionScore < bestScore) {
            bestScore = repetitionScore;
            bestMatchups = matchups;
        }

        // If we found a perfect solution (no repetitions), use it
        if (repetitionScore === 0) {
            break;
        }
    }

    return bestMatchups || [];
}

// Helper to ensure standings entry exists for a team
function ensureStandingsEntry(standings, teamName) {
    if (!standings[teamName]) {
        standings[teamName] = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
    }
}

// Calculate results for completed week and update standings
function calculateWeeklyResults(poolData, weekNumber, currentStats) {
    if (!poolData.h2hData || !poolData.h2hData.matchups[weekNumber - 1]) {
        console.error("⚠️ No matchup data for week", weekNumber);
        return;
    }

    const weekMatchups = poolData.h2hData.matchups[weekNumber - 1];
    const standings = poolData.h2hData.standings || {};

    weekMatchups.forEach(matchup => {
        const team1Data = poolData.teams[matchup.team1];
        const team2Data = poolData.teams[matchup.team2];

        if (!team1Data || !team2Data) return;

        // Calculate points for each team
        matchup.team1Points = getTeamWeeklyPoints(team1Data, currentStats);
        matchup.team2Points = getTeamWeeklyPoints(team2Data, currentStats);

        // Determine winner
        if (matchup.team1Points > matchup.team2Points) {
            matchup.winner = matchup.team1;
        } else if (matchup.team2Points > matchup.team1Points) {
            matchup.winner = matchup.team2;
        } else {
            matchup.winner = 'tie'; // Tie
        }

        // Update standings
        if (!standings[matchup.team1]) {
            standings[matchup.team1] = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
        }
        if (!standings[matchup.team2]) {
            standings[matchup.team2] = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
        }

        // Update wins/losses
        if (matchup.winner === matchup.team1) {
            standings[matchup.team1].wins++;
            standings[matchup.team2].losses++;
        } else if (matchup.winner === matchup.team2) {
            standings[matchup.team2].wins++;
            standings[matchup.team1].losses++;
        } else {
            standings[matchup.team1].ties++;
            standings[matchup.team2].ties++;
        }

        // Update points for/against
        standings[matchup.team1].pointsFor += matchup.team1Points;
        standings[matchup.team1].pointsAgainst += matchup.team2Points;
        standings[matchup.team2].pointsFor += matchup.team2Points;
        standings[matchup.team2].pointsAgainst += matchup.team1Points;
    });

    poolData.h2hData.standings = standings;

    // Save to history
    if (!poolData.h2hData.matchupHistory) {
        poolData.h2hData.matchupHistory = [];
    }
    poolData.h2hData.matchupHistory.push({
        weekNumber: weekNumber,
        matchups: weekMatchups,
        completedDate: new Date().toISOString()
    });

    return poolData;
}

// Get current week number based on season start date
function getCurrentWeekNumber(seasonStart, now = new Date()) {
    if (!seasonStart) return 1;
    const start = new Date(seasonStart);
    const diffMs = now - start;
    if (diffMs < 0) return 1;
    return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}

// Monday (UTC) of the ISO week containing a 'YYYY-MM-DD' date string.
function mondayOfWeek(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    const day = d.getUTCDay(); // 0 = Sunday
    d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
    return d.toISOString().slice(0, 10);
}
module.exports = {
    generateWeeklyMatchups,
    ensureStandingsEntry,
    calculateWeeklyResults,
    getCurrentWeekNumber,
    mondayOfWeek
};
