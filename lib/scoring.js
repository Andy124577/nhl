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

/**
 * Pointage de pool d'un gardien : blanchissages ×5, victoires ×2, défaites en
 * prolongation ×1.
 *
 * Source unique. Cette formule vivait recopiée à QUATRE endroits — le
 * constructeur du cache de statistiques (server.js), le classement de saison
 * ci-dessous, calculateTeamPoints() dans classement.js et buildTeamScores()
 * dans accueil.js. Les quatre s'accordaient par entretien, pas par
 * construction : changer un poids à un seul endroit faisait diverger le total
 * affiché du rang enregistré, sans que rien ne le signale.
 *
 * Ce fichier est maintenant chargé aussi par le navigateur (voir le pied
 * d'export), pour que les quatre appelants lisent la même ligne.
 */
function goaliePoolPoints(g) {
    return (g?.shutouts || 0) * 5 + (g?.wins || 0) * 2 + (g?.otLosses || 0) * 1;
}

/**
 * Pointage de pool d'un club de la LNH repêché : victoires ×2, défaites en
 * prolongation ×1 — le barème de la LNH elle-même, sans les défaites.
 */
function clubPoolPoints(t) {
    return (t?.wins || 0) * 2 + (t?.otLosses || 0) * 1;
}

/**
 * Classement cumulatif d'un pool. Jumeau serveur de buildTeamScores()
 * (accueil.js) et de calculateTeamPoints() (classement.js) : même formule de
 * saison, pour qu'un rang calculé ici corresponde à ce que les deux pages
 * affichent. C'est avec lui que sont calculés l'instantané quotidien
 * (pool_rank_snapshots) et le côté « en direct » de /pool-rank-movement.
 *
 * `teamStandings` porte les fiches de clubs (current_teams.json). Sans lui, le
 * club repêché par chaque équipe compte pour 0 — ce qui était le cas avant :
 * le total affiché par classement.js incluait le club, le rang calculé ici ne
 * l'incluait pas, et les flèches d'évolution, posées sur cette même ligne,
 * pouvaient donc annoncer un mouvement qui n'avait pas eu lieu.
 */
function computeTeamSeasonScores(poolData, statsPlayers, teamStandings = []) {
    const playerPts = {};
    (statsPlayers || []).forEach(p => {
        const name = p.playerName;
        if (!name) return;
        playerPts[name] = p.position === 'G' ? goaliePoolPoints(p) : (p.points || 0);
    });

    const clubPts = {};
    (teamStandings || []).forEach(t => {
        const name = t?.teamFullName;
        if (!name) return;
        clubPts[name] = clubPoolPoints(t);
    });

    const nomDe = p => (typeof p === 'string') ? p : (p?.skaterFullName || p?.goalieFullName || p?.teamFullName || p);

    const rows = Object.entries(poolData.teams || {})
        .filter(([, td]) => (td.members || []).length > 0)
        .map(([teamName, td]) => {
            const names = [
                ...(td.offensive || []),
                ...(td.defensive || []),
                ...(td.goalie || []),
                ...(td.rookie || [])
            ].map(nomDe);
            const clubs = (td.teams || []).map(nomDe);

            const score = names.reduce((s, n) => s + (playerPts[n] || 0), 0)
                + clubs.reduce((s, n) => s + (clubPts[n] || 0), 0);
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

        // `?.` : un roster peut contenir un trou (null) après un échange mal
        // appliqué. Sans la garde, un seul trou faisait échouer le calcul de
        // toute la semaine — alors qu'une chaîne vide, elle, passait déjà.
        const playerName = playerData?.skaterFullName || playerData?.goalieFullName || playerData;
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
/* ────────────────────────────────────────────────────────────────────────
 * Export double — même motif que profanity.js. Le serveur fait un require(),
 * le navigateur reçoit les fonctions sur window : classement.js et accueil.js
 * appellent goaliePoolPoints() / clubPoolPoints() au lieu de recopier les
 * formules. Aucun de ces noms n'existait déjà côté client (vérifié).
 * ──────────────────────────────────────────────────────────────────────── */
(function () {
    const api = {
        FANTASY_SCORING,
        goaliePoolPoints,
        clubPoolPoints,
        computeTeamSeasonScores,
        getTeamWeeklyPoints,
        skaterFantasyPointsTonight,
        goalieFantasyPointsTonight
    };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;                 // serveur + tests (CommonJS)
    } else if (typeof window !== 'undefined') {
        Object.assign(window, api);           // navigateur
    }
})();
