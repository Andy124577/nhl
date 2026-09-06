/**
 * Échanges : présence d'un joueur, transfert entre équipes, annulation.
 *
 * Manipulations de rosters uniquement — la persistance et les routes
 * restent dans server.js.
 *
 * Extrait de server.js — le corps des fonctions est inchangé. Le serveur les
 * réimporte en haut de server.js ; les tests unitaires (test/unit/) les
 * chargent directement, ce qui était impossible depuis server.js : le
 * require déclenchait Express, Socket.IO, les tâches cron et le pool
 * Postgres.
 */

'use strict';

// Helper: Check if team has a specific player
function teamHasPlayer(team, item) {
    const arrays = {
        'offensive': 'offensive',
        'defensive': 'defensive',
        'goalie': 'goalie',
        'rookie': 'rookie',
        'team': 'teams'
    };

    const arrayName = arrays[item.type];
    if (!team[arrayName]) return false;

    const index = team[arrayName].findIndex(p => {
        const name = p.skaterFullName || p.goalieFullName || p.teamFullName || p;
        return name === item.name;
    });

    return index !== -1;
}

// Helper: Invalidate conflicting pending trades after a trade is accepted
function invalidateConflictingTrades(trades, acceptedTrade, draftData) {
    if (!trades.pending || trades.pending.length === 0) return 0;

    const involvedPlayers = new Set();

    // Collect all player names involved in the accepted trade
    acceptedTrade.offering.forEach(item => {
        involvedPlayers.add(item.name);
    });
    acceptedTrade.receiving.forEach(item => {
        involvedPlayers.add(item.name);
    });

    // Find trades that involve any of these players
    const invalidTrades = [];
    trades.pending.forEach(trade => {
        if (trade.draftName !== acceptedTrade.draftName) return; // Different pool

        let hasConflict = false;

        // Check if any player in this trade was involved in the accepted trade
        trade.offering.forEach(item => {
            if (involvedPlayers.has(item.name)) {
                hasConflict = true;
            }
        });
        trade.receiving.forEach(item => {
            if (involvedPlayers.has(item.name)) {
                hasConflict = true;
            }
        });

        if (hasConflict) {
            invalidTrades.push(trade.id);
        }
    });

    // Remove invalid trades
    if (invalidTrades.length > 0) {
        trades.pending = trades.pending.filter(t => !invalidTrades.includes(t.id));
        console.log(`🗑️ Cancelled ${invalidTrades.length} conflicting trade(s) after trade acceptance`);
    }

    return invalidTrades.length;
}

// Helper: Remove item from team
function removeFromTeam(team, item) {
    const arrays = {
        'offensive': 'offensive',
        'defensive': 'defensive',
        'goalie': 'goalie',
        'rookie': 'rookie',
        'team': 'teams'
    };

    const arrayName = arrays[item.type];
    if (!team[arrayName]) return;

    const index = team[arrayName].findIndex(p => {
        const name = p.skaterFullName || p.goalieFullName || p.teamFullName || p;
        return name === item.name;
    });

    if (index !== -1) {
        team[arrayName].splice(index, 1);
    }
}

// Helper: Add item to team
function addToTeam(team, item) {
    const arrays = {
        'offensive': 'offensive',
        'defensive': 'defensive',
        'goalie': 'goalie',
        'rookie': 'rookie',
        'team': 'teams'
    };

    const arrayName = arrays[item.type];
    if (!team[arrayName]) {
        team[arrayName] = [];
    }

    // Add the full player object to preserve stats
    if (item.playerData) {
        team[arrayName].push(item.playerData);
    } else {
        // Fallback for simple strings (team names, etc.)
        team[arrayName].push(item.name);
    }
}

// Helper function to get position label for error messages
function getPositionLabel(type) {
    const labels = {
        'offensive': 'Attaquant',
        'defensive': 'Défenseur',
        'goalie': 'Gardien',
        'rookie': 'Rookie',
        'team': 'Équipe NHL'
    };
    return labels[type] || type;
}
module.exports = {
    teamHasPlayer,
    invalidateConflictingTrades,
    removeFromTeam,
    addToTeam,
    getPositionLabel
};
