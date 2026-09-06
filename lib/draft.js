/**
 * Ordre du repêchage et condition de fin.
 *
 * Deux fonctions, aucune dépendance : l'ordre en serpentin et le test
 * « toutes les équipes ont-elles rempli leur quota ? ».
 *
 * Extrait de server.js — le corps des fonctions est inchangé. Le serveur les
 * réimporte en haut de server.js ; les tests unitaires (test/unit/) les
 * chargent directement, ce qui était impossible depuis server.js : le
 * require déclenchait Express, Socket.IO, les tâches cron et le pool
 * Postgres.
 */

'use strict';

  // Fonction pour générer un ordre de draft en serpentin (snake draft)
// ✅ Fonction centrale pour générer un ordre de draft en serpentin
function generateSnakeOrder(teams, rounds = 15) {
    const order = [];

    if (teams.length === 2) {
        // Simple alternating draft for 2 teams
        for (let i = 0; i < rounds * teams.length; i++) {
            order.push(teams[i % 2]);
        }
    } else {
        // Snake draft for 3+ teams
        for (let i = 0; i < rounds; i++) {
            const round = i % 2 === 0 ? [...teams] : [...teams].reverse();
            order.push(...round);
        }
    }

    return order;
}

function checkIfDraftComplete(clan) {
    // Check only teams with members (active teams in the draft)
    const activeTeams = Object.values(clan.teams).filter(team =>
        team.members && team.members.length > 0
    );

    if (activeTeams.length === 0) return false;

    // Get pool configuration, fallback to defaults if not set
    const config = clan.config || {
        numOffensive: 6,
        numDefensive: 4,
        numGoalies: 1,
        numRookies: 1,
        numTeams: 1
    };

    return activeTeams.every(team =>
        team.offensive.length === config.numOffensive &&
        team.defensive.length === config.numDefensive &&
        team.rookie?.length === config.numRookies &&
        team.goalie?.length === config.numGoalies &&
        team.teams?.length === config.numTeams
    );
}
module.exports = {
    generateSnakeOrder,
    checkIfDraftComplete
};
