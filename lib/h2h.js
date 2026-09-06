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

// Monday (UTC) of the ISO week containing a 'YYYY-MM-DD' date string.
function mondayOfWeek(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    const day = d.getUTCDay(); // 0 = Sunday
    d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
    return d.toISOString().slice(0, 10);
}

/* ────────────────────────────────────────────────────────────────────────
 * CALENDRIER DE SAISON
 *
 * generateWeeklyMatchups() ne voit qu'une semaine à la fois : elle brasse
 * les équipes et évite les redites récentes. C'est ce qu'il faut pour
 * rattraper une semaine manquante, mais on ne peut rien annoncer d'avance —
 * personne ne sait contre qui il joue dans trois semaines tant que la
 * semaine n'est pas finalisée.
 *
 * generateSeasonSchedule() tire tout le calendrier d'un coup, à la fin du
 * repêchage : chaque équipe sait dès le premier jour qui elle affronte
 * jusqu'en avril. La bannière d'accueil y lit le prochain duel, le
 * carrousel du classement y lit la saison entière.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Repli quand les dates de saison manquent, et garde-fou absolu. Une saison
 * régulière de la LNH tient en 27 ou 28 semaines ; 40 laisse de la marge à
 * un calendrier décalé sans jamais laisser une date aberrante engendrer des
 * milliers de semaines.
 */
const DEFAULT_SEASON_WEEKS = 26;
const MAX_SEASON_WEEKS = 40;

/**
 * Nombre de semaines entre deux bornes ('YYYY-MM-DD' ou Date).
 *
 * Arrondi au SUPÉRIEUR : une saison qui se termine un mercredi se joue quand
 * même cette semaine-là, et mieux vaut une semaine de calendrier en trop —
 * jamais atteinte — qu'une équipe sans adversaire en fin de parcours. Sans
 * dates exploitables on retombe sur DEFAULT_SEASON_WEEKS plutôt que sur
 * zéro : un calendrier vide priverait le pool de tout duel.
 */
function seasonWeekCount(seasonStart, seasonEnd) {
    const debut = seasonStart ? new Date(seasonStart) : null;
    const fin = seasonEnd ? new Date(seasonEnd) : null;

    if (!debut || !fin || Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime())) {
        return DEFAULT_SEASON_WEEKS;
    }

    const semaines = Math.ceil((fin.getTime() - debut.getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (!Number.isFinite(semaines) || semaines < 1) return 1;
    return Math.min(semaines, MAX_SEASON_WEEKS);
}

/**
 * Calendrier complet : un tableau de `weekCount` semaines, chacune étant la
 * liste des duels de cette semaine-là — même forme que
 * generateWeeklyMatchups(), `weekNumber` compris.
 *
 * Méthode du cercle (round-robin) : une équipe reste fixe, les autres
 * tournent d'un cran chaque semaine. En N-1 semaines tout le monde a
 * affronté tout le monde exactement une fois, sans le hasard de
 * generateWeeklyMatchups — donc sans les répétitions qu'il faut ensuite
 * rattraper. Seul l'ordre de départ est brassé : deux pools composés des
 * mêmes équipes n'auraient sinon jamais un calendrier différent.
 *
 * Au-delà de N-1 semaines le cycle recommence ; un cycle sur deux inverse
 * les côtés, pour que la carte du duel ne présente pas éternellement la même
 * équipe à gauche.
 */
function generateSeasonSchedule(teams, weekCount = DEFAULT_SEASON_WEEKS) {
    const teamNames = teams.filter(t => t.members && t.members.length > 0).map(t => t.name);

    if (teamNames.length === 0) {
        console.error("⚠️ Cannot build season schedule: no active teams!");
        return [];
    }

    if (teamNames.length % 2 !== 0) {
        console.error("⚠️ Cannot build season schedule: odd number of teams!");
        return [];
    }

    const semaines = Math.max(1, Math.min(Math.floor(weekCount) || DEFAULT_SEASON_WEEKS, MAX_SEASON_WEEKS));

    const brasse = [...teamNames].sort(() => Math.random() - 0.5);
    const fixe = brasse[0];
    const rotatifs = brasse.slice(1);
    const duelsParSemaine = teamNames.length / 2;
    const semainesParCycle = teamNames.length - 1;

    const calendrier = [];

    for (let semaine = 1; semaine <= semaines; semaine++) {
        // Un cycle sur deux : on renvoie les équipes de l'autre côté du « vs ».
        const inverser = Math.floor((semaine - 1) / semainesParCycle) % 2 === 1;

        const duels = [];
        const apparier = (a, b) => {
            const [team1, team2] = inverser ? [b, a] : [a, b];
            duels.push({
                team1,
                team2,
                team1Points: 0,
                team2Points: 0,
                winner: null,
                weekNumber: semaine
            });
        };

        apparier(fixe, rotatifs[0]);
        for (let i = 1; i < duelsParSemaine; i++) {
            apparier(rotatifs[i], rotatifs[rotatifs.length - i]);
        }

        calendrier.push(duels);

        // Rotation d'un cran : le dernier rotatif repasse en tête.
        rotatifs.unshift(rotatifs.pop());
    }

    return calendrier;
}

module.exports = {
    DEFAULT_SEASON_WEEKS,
    MAX_SEASON_WEEKS,
    generateWeeklyMatchups,
    generateSeasonSchedule,
    seasonWeekCount,
    ensureStandingsEntry,
    mondayOfWeek
};
