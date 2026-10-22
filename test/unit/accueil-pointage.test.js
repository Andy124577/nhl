'use strict';

/**
 * Le rang de l'accueil (« Ma position », buildTeamScores dans accueil.js)
 * doit être celui de la page de classement (calculateTeamPoints). Par le nom
 * exact seul, l'accueil ne retrouvait pas les joueurs que la trousse et le
 * relevé n'écrivent pas pareil : ils comptaient zéro, et l'accueil disait
 * « 3e sur 7 » quand le classement disait 4e.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chargerFonctions } = require('../fixtures/helpers.js');
const { cleDeNom, CLUBS_RENOMMES, goaliePoolPoints, clubPoolPoints } = require('../../lib/scoring.js');

const TROUSSE = {
    donnees: {
        skaters: [
            { fullName: 'Yegor Chinakhov', playerId: 8481520 },
            { fullName: 'Tim Stützle', playerId: 8482116 }
        ],
        goalies: [{ fullName: 'Sam Montembeault', playerId: 8478470 }]
    },
    nomCanonique: nom => nom
};

const RELEVE = [
    { playerId: 8481520, playerName: 'Egor Chinakhov', position: 'R', points: 10 },
    { playerId: 8482116, playerName: 'Tim Stutzle', position: 'C', points: 20 },
    // Ligne mal étiquetée : un attaquant sous le nom du gardien.
    { playerId: 8484821, playerName: 'Sam Montembeault', position: 'C', points: 0 },
    { playerId: 8478470, playerName: 'Sam Montembeault', position: 'G', wins: 3, shutouts: 1, otLosses: 1, points: 0 }
];

function charger({ trousse = TROUSSE } = {}) {
    return chargerFonctions('accueil.js', ['idDansLaTrousse', 'indexerReleve', 'buildTeamScores'], {
        userData: {
            username: 'moi',
            statsData: { seasonStarted: true, players: RELEVE },
            teamsData: { teams: [{ teamFullName: 'Utah Hockey Club', wins: 4, otLosses: 1 }] }
        },
        idsTrousse: { donnees: null },
        cleDeNom, CLUBS_RENOMMES, goaliePoolPoints, clubPoolPoints,
        FZDraftKit: trousse,
        window: { FZDraftKit: trousse, FZ_IDS_ERRONES: [] }
    });
}

const POOL = {
    allTeams: {
        Moi: {
            members: ['moi'],
            offensive: ['Yegor Chinakhov', 'Tim Stützle'],
            goalie: ['Sam Montembeault'],
            teams: ['Utah Mammoth']
        }
    }
};

test('chaque choix retrouve sa ligne du relevé comme sur le classement', () => {
    const [moi] = charger().buildTeamScores(POOL);
    // 10 (par l'identifiant de la trousse) + 20 (sans accent)
    // + 10 (le gardien, par son identifiant : 1 blanchissage ×5, 2 autres
    // victoires ×2, 1 DP — la ligne mal étiquetée vaudrait 0)
    // + 9 (le club renommé : 4 victoires ×2, 1 DP).
    assert.equal(moi.score, 10 + 20 + 10 + 9);
});

test('sans la trousse, le nom sans accent suffit encore', () => {
    const [moi] = charger({ trousse: { donnees: null, nomCanonique: n => n } }).buildTeamScores({
        allTeams: { Moi: { members: ['moi'], offensive: ['Tim Stützle'] } }
    });
    assert.equal(moi.score, 20);
});
