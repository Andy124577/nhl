/**
 * Fabriques de données de pool.
 *
 * Des fonctions, jamais des objets partagés : les fonctions testées mutent
 * leur argument (calculateWeeklyResults écrit dans standings, addToTeam pousse
 * dans un roster). Un objet partagé entre deux cas ferait passer la suite dans
 * l'ordre du fichier et échouer un test lancé seul — voir UNIT_TESTS_REVIEW.md
 * §3, « Shared mutable fixture ».
 *
 * Chaque fabrique accepte un fragment qui écrase les valeurs par défaut, pour
 * qu'un cas n'affiche que le champ qui l'intéresse.
 */

'use strict';

/** Une équipe de pool complète, au quota par défaut (6/4/1/1/1). */
function makeTeam(over = {}) {
    return {
        members: ['joueur1'],
        offensive: [],
        defensive: [],
        rookie: [],
        goalie: [],
        teams: [],
        ...over
    };
}

/** Une équipe pleine : exactement le quota par défaut dans chaque case. */
function makeFullTeam(prefixe = 'T', over = {}) {
    return makeTeam({
        offensive: [1, 2, 3, 4, 5, 6].map(n => `${prefixe}-att${n}`),
        defensive: [1, 2, 3, 4].map(n => `${prefixe}-def${n}`),
        rookie: [`${prefixe}-recrue`],
        goalie: [`${prefixe}-gardien`],
        teams: [`${prefixe}-club`],
        ...over
    });
}

/** Un pool. `teams` est un objet nom → équipe, comme dans draft.json. */
function makePool(over = {}) {
    return {
        teams: { Rouge: makeTeam(), Bleu: makeTeam({ members: ['joueur2'] }) },
        config: { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1, numTeams: 1 },
        ...over
    };
}

/**
 * Un pool en mode tête-à-tête. `matchups` est indexé par semaine - 1, comme
 * dans server.js.
 */
function makeH2HPool(over = {}) {
    const pool = makePool(over);
    pool.h2hData = {
        matchups: [[makeMatchup()]],
        standings: {},
        matchupHistory: [],
        ...(over.h2hData || {})
    };
    return pool;
}

function makeMatchup(over = {}) {
    return {
        team1: 'Rouge',
        team2: 'Bleu',
        team1Points: 0,
        team2Points: 0,
        winner: null,
        weekNumber: null,
        ...over
    };
}

/** Le format attendu par generateWeeklyMatchups : une liste, pas un objet. */
function makeTeamList(noms, actives = null) {
    return noms.map(nom => ({
        name: nom,
        members: actives && !actives.includes(nom) ? [] : ['joueur-' + nom]
    }));
}

/** Une entrée de classement H2H vierge. */
function makeStanding(over = {}) {
    return { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, ...over };
}

module.exports = { makeTeam, makeFullTeam, makePool, makeH2HPool, makeMatchup, makeTeamList, makeStanding };
