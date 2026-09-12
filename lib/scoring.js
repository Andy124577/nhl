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

/**
 * Pointage « en direct » d'un patineur, a partir d'un sommaire de match.
 *
 * Meme bareme que les feuilles de match : la fonction delegue a
 * pointsFeuillePatineur(). Les sommaires en direct ne portent pas toujours les
 * bonus — bonusManquants() dit lesquels — et le total est alors PROVISOIRE.
 * Il bouge pendant la soiree et sert a suivre un match ; ce n'est pas le total
 * hebdomadaire exact, et rien ne doit le presenter comme tel.
 */
function skaterFantasyPointsTonight(s) {
    return pointsFeuillePatineur(s || {});
}

/** Pointage « en direct » d'un gardien. Meme bareme, meme fonction. */
function goalieFantasyPointsTonight(s) {
    return pointsFeuilleGardien(s || {});
}

/* ════════════════════════════════════════════════════════════════════════
 * POINTAGE CANONIQUE D'UNE FEUILLE DE MATCH
 *
 * Le même barème était appliqué à trois endroits : la finalisation
 * hebdomadaire, le détail par joueur, et le tableau de bord. Les trois
 * recopiaient la formule, et les trois ne l'appliquaient pas tout à fait
 * pareil — le pointage « en direct » d'un patineur oubliait les bonus
 * d'avantage numérique, d'infériorité et de but gagnant, que le pointage
 * issu des feuilles de match, lui, comptait. Deux surfaces affichaient donc
 * deux totaux pour la même semaine, sans que rien ne le signale.
 *
 * Une seule fonction désormais. Elle accepte les deux nommages qui circulent
 * dans le projet : les colonnes de la base (`power_play_goals`) et les champs
 * de l'API (`powerPlayGoals`).
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Version du barème.
 *
 * Un résultat de pointage doit dire selon quelles règles il a été calculé :
 * sans cela, une correction du barème réécrirait l'histoire en silence, et
 * personne ne saurait qu'un total de novembre et un total de mars ne sont
 * plus comparables. Elle est écrite sur chaque résultat finalisé.
 */
const VERSION_BAREME = '1.0.0';

/**
 * États de complétude d'un résultat.
 *
 * Zéro n'est une réponse valable que si les données confirment zéro. L'absence
 * de lignes ne distingue pas « n'a pas joué » de « pas encore ingéré » : c'est
 * exactement la confusion qui faisait finaliser des semaines sur des feuilles
 * manquantes.
 */
const COMPLETUDE = {
    DISPONIBLE: 'available',
    PARTIEL: 'partial',
    INDISPONIBLE: 'unavailable',
    SANS_OBJET: 'not_applicable'
};

/** Arrondi à la décimale, une seule fois, au même endroit pour tout le monde. */
function arrondi(valeur) {
    return Math.round((Number(valeur) || 0) * 10) / 10;
}

/** Lit un champ quel que soit son nommage (colonne de base ou champ d'API). */
function champ(ligne, ...noms) {
    for (const nom of noms) {
        if (ligne && ligne[nom] != null) return ligne[nom];
    }
    return 0;
}

/**
 * Une feuille de match de gardien, ou de patineur ?
 *
 * La position fait foi quand elle est là, et elle l'est toujours en base.
 * C'est important : les colonnes de gardien ont un DÉFAUT À ZÉRO, pas à NULL.
 * Une ligne de patineur porte donc `saves: 0`, et « a-t-il un champ d'arrêts ? »
 * répondrait oui pour tout le monde — chaque patineur serait pointé comme un
 * gardien, donc à 0 point plus 0,2 par arrêt inexistant.
 *
 * Le repli ne sert que si la position manque, et il exige alors un signe
 * POSITIF de gardien : une décision, des arrêts, ou des tirs reçus.
 */
function estGardien(ligne) {
    if (!ligne) return false;

    const position = ligne.position ?? ligne.positionCode;
    if (position != null && position !== '') return String(position).toUpperCase() === 'G';

    const decision = ligne.decision;
    const arrets = Number(ligne.saves) || 0;
    const tirsRecus = Number(ligne.shots_against ?? ligne.shotsAgainst) || 0;
    return (decision === 'W' || decision === 'L' || decision === 'O') || arrets > 0 || tirsRecus > 0;
}

/**
 * Points d'une feuille de match de patineur — bonus compris.
 *
 * L'avantage numérique, l'infériorité et le but gagnant s'ajoutent au but
 * lui-même : ce sont des bonus, pas des catégories séparées. Les oublier
 * sous-évaluait les patineurs les plus utilisés, et seulement sur certaines
 * surfaces.
 */
function pointsFeuillePatineur(ligne) {
    return arrondi(
        champ(ligne, 'goals') * FANTASY_SCORING.goal +
        champ(ligne, 'assists') * FANTASY_SCORING.assist +
        champ(ligne, 'shots') * FANTASY_SCORING.shot +
        champ(ligne, 'plus_minus', 'plusMinus') * FANTASY_SCORING.plusMinus +
        champ(ligne, 'power_play_goals', 'powerPlayGoals') * FANTASY_SCORING.powerPlayGoal +
        champ(ligne, 'power_play_points', 'powerPlayPoints') * FANTASY_SCORING.powerPlayPoint +
        champ(ligne, 'shorthanded_goals', 'shorthandedGoals') * FANTASY_SCORING.shorthandedGoal +
        champ(ligne, 'shorthanded_points', 'shorthandedPoints') * FANTASY_SCORING.shorthandedPoint +
        champ(ligne, 'game_winning_goals', 'gameWinningGoals') * FANTASY_SCORING.gameWinningGoal
    );
}

/** Points d'une feuille de match de gardien. */
function pointsFeuilleGardien(ligne) {
    const decision = champ(ligne, 'decision');
    const blanchissages = champ(ligne, 'shutouts', 'shutout');
    return arrondi(
        (decision === 'W' ? FANTASY_SCORING.win : 0) +
        (blanchissages ? Number(blanchissages) : 0) * FANTASY_SCORING.shutout +
        champ(ligne, 'saves') * FANTASY_SCORING.save +
        champ(ligne, 'goals_against', 'goalsAgainst') * FANTASY_SCORING.goalsAgainst
    );
}

/** Points d'une feuille de match, quel que soit le poste. */
function pointsFeuilleDeMatch(ligne) {
    return estGardien(ligne) ? pointsFeuilleGardien(ligne) : pointsFeuillePatineur(ligne);
}

/**
 * Les champs de bonus absents d'une ligne de patineur.
 *
 * Le tableau de bord « ce soir » lit des sommaires de match qui ne portent pas
 * toujours les bonus. Le total reste utile — il bouge en direct — mais il n'est
 * pas le total hebdomadaire exact, et doit être annoncé comme provisoire
 * plutôt que présenté comme définitif.
 */
function bonusManquants(ligne) {
    const attendus = [
        ['power_play_goals', 'powerPlayGoals'],
        ['power_play_points', 'powerPlayPoints'],
        ['shorthanded_goals', 'shorthandedGoals'],
        ['shorthanded_points', 'shorthandedPoints'],
        ['game_winning_goals', 'gameWinningGoals']
    ];
    return attendus
        .filter(noms => noms.every(nom => !ligne || ligne[nom] == null))
        .map(noms => noms[0]);
}

/**
 * Assemble un résultat de pointage avec tout ce qui permet de le comparer.
 *
 * Un nombre seul ne veut rien dire : 42 points, sur quelle saison, quel mode,
 * quelle période, quel alignement, et sur des données complètes ou non ? Deux
 * chiffres identiques calculés sur deux bases différentes ne sont pas égaux,
 * et deux chiffres différents calculés sur la même base sont comparables.
 */
function resultatPointage({
    points, saison, mode, periode, baseAlignement,
    completude = COMPLETUDE.DISPONIBLE, sourceLe = null, detail = null,
    matchsAttendus = null, matchsRecus = null
}) {
    return {
        points: points == null ? null : arrondi(points),
        saison: saison || null,
        mode: mode || null,
        versionBareme: VERSION_BAREME,
        periode: periode || null,
        baseAlignement: baseAlignement || null,
        completude,
        matchsAttendus,
        matchsRecus,
        sourceLe: sourceLe || null,
        detail
    };
}

/**
 * Décide de l'état de complétude à partir de ce qu'on attendait et de ce qu'on
 * a reçu.
 *
 * `attendus` vient du calendrier de la LNH, pas des lignes reçues : compter
 * les lignes reçues pour décider si elles sont toutes là serait circulaire.
 * Sans calendrier connu, on ne prétend pas savoir — `unavailable` plutôt qu'un
 * zéro qui aurait l'air d'un résultat.
 */
function completudeDe({ attendus, recus }) {
    if (attendus === 0) return COMPLETUDE.SANS_OBJET;
    if (attendus == null) return recus > 0 ? COMPLETUDE.PARTIEL : COMPLETUDE.INDISPONIBLE;
    if (recus >= attendus) return COMPLETUDE.DISPONIBLE;
    if (recus > 0) return COMPLETUDE.PARTIEL;
    return COMPLETUDE.INDISPONIBLE;
}

/** Un résultat peut-il servir de base à une finalisation ? */
function finalisable(resultat) {
    return !!resultat && (resultat.completude === COMPLETUDE.DISPONIBLE ||
                          resultat.completude === COMPLETUDE.SANS_OBJET);
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
        VERSION_BAREME,
        COMPLETUDE,
        arrondi,
        estGardien,
        pointsFeuillePatineur,
        pointsFeuilleGardien,
        pointsFeuilleDeMatch,
        bonusManquants,
        resultatPointage,
        completudeDe,
        finalisable,
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
