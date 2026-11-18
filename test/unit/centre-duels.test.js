/**
 * Le centre des duels du classement (classement.js) : une semaine close se lit
 * dans son résultat figé, avec les faits saillants du récap.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { chargerFonctions } = require('../fixtures/helpers.js');

const allPoolsData = {
    Ligue: {
        teams: {
            'Équipe 2': { members: ['bruno'] },
            '<b>Rouge</b>': { members: ['alice'] }
        },
        h2hData: { currentWeek: 4, matchups: [[], [], [], [], []], standings: {} }
    }
};

function charger() {
    return chargerFonctions('classement.js', [
        'getDisplayName', 'escapeHtmlText', 'escapeAttr', 'fmtH2HPts',
        'h2hBornesSemaines', 'h2hFaitsSaillantsHTML', 'buildMatchupCardHTML',
        'H2H_POSTES', 'nomCourtJoueur', 'h2hSousLigne', 'h2hCelluleJoueur', 'h2hRangeesFaceAFace', 'h2hDuelRepliHTML'
    ], {
        allPoolsData,
        getTeamLogoHTML: () => '',
        initialsFromName: n => String(n).slice(0, 2),
        clubDuJoueur: j => j.teamAbbrev || null,
        localStorage: { getItem: () => 'alice' }
    });
}

describe('faits saillants d’une semaine close', () => {
    test('chaque catégorie du récap devient une ligne, et rien d’autre', () => {
        const { h2hFaitsSaillantsHTML } = charger();
        const html = h2hFaitsSaillantsHTML({
            sections: [
                { categorie: 'resultats', duels: [] },
                { categorie: 'meilleur_score', points: 92.3, equipes: ['Équipe 2'], partage: false },
                { categorie: 'joueur_semaine', points: 36.9, joueurs: [{ name: 'David Pastrnak', equipe: 'Équipe 2' }] }
            ]
        }, 'Ligue');

        assert.match(html, /Meilleur score/);
        assert.match(html, /bruno · 92\.3/, 'une équipe auto-nommée paraît sous le nom de ses membres');
        assert.match(html, /David Pastrnak \(bruno\) · 36\.9/);
        assert.doesNotMatch(html, /Duel le plus serré|Séries/, 'une catégorie absente du récap reste absente');
    });

    test('un nom d’équipe saisi est échappé', () => {
        const { h2hFaitsSaillantsHTML } = charger();
        const html = h2hFaitsSaillantsHTML({
            sections: [{ categorie: 'meilleur_score', points: 10, equipes: ['<b>Rouge</b>'] }]
        }, 'Ligue');
        assert.match(html, /&lt;b&gt;Rouge&lt;\/b&gt;/);
    });

    test('un récap sans catégorie affichable ne dessine rien', () => {
        const { h2hFaitsSaillantsHTML } = charger();
        assert.equal(h2hFaitsSaillantsHTML({ sections: [{ categorie: 'resultats', duels: [] }] }, 'Ligue'), '');
    });
});

describe('carte de duel', () => {
    const duel = (extra) => ({ team1: 'Équipe 2', team2: '<b>Rouge</b>', team1Points: 55.1, team2Points: 54.8, ...extra });

    test('une semaine figée montre ses meilleurs pointeurs et le dit', () => {
        const { buildMatchupCardHTML } = charger();
        const html = buildMatchupCardHTML(duel({
            team1Top: [{ name: 'Nikita Kucherov', fantasyPoints: 22, matchs: 3 }],
            team2Top: [{ name: 'Leon Draisaitl', fantasyPoints: 21.9, matchs: 3 }]
        }), 'Ligue', false);

        assert.match(html, /Nikita Kucherov/);
        assert.match(html, /3 PJ/);
        assert.match(html, /Résultat final/);
        assert.doesNotMatch(html, /undefined/);
    });

    test('une semaine en cours garde l’alignement entier, sans la mention', () => {
        const { buildMatchupCardHTML } = charger();
        const html = buildMatchupCardHTML(duel({
            team1Players: [{ name: 'A', position: 'C', goals: 1, assists: 2, fantasyPoints: 5 }],
            team2Players: [{ name: 'G', position: 'G', wins: 1, saves: 30, shutouts: 0, fantasyPoints: 4 }]
        }), 'Ligue', false);

        assert.match(html, /1 B · 2 A/);
        assert.match(html, /1 V · 30 arr\./);
        assert.doesNotMatch(html, /Résultat final/);
    });

    test('face à face : mon équipe à gauche, les joueurs appariés par poste', () => {
        const { buildMatchupCardHTML } = charger();
        const html = buildMatchupCardHTML(duel({
            team1Players: [
                { name: 'Nick Suzuki', categorie: 'offensive', teamAbbrev: 'MTL', goals: 1, assists: 1, fantasyPoints: 8, enDirect: 3 },
                { name: 'Lane Hutson', categorie: 'defensive', teamAbbrev: 'MTL', goals: 0, assists: 2, fantasyPoints: 4 }
            ],
            team2Players: [
                { name: 'Cale Makar', categorie: 'defensive', teamAbbrev: 'COL', goals: 1, assists: 0, fantasyPoints: 5 },
                { name: 'Nathan MacKinnon', categorie: 'offensive', teamAbbrev: 'COL', goals: 2, assists: 0, fantasyPoints: 7 }
            ]
        }), 'Ligue', true);

        // alice (team2, « <b>Rouge</b> ») est à gauche : son pointage vient en premier.
        assert.ok(html.indexOf('54,8') < html.indexOf('55,1'), 'mon équipe est à gauche');
        const rangees = html.split('class="fa-rangee"').slice(1);
        assert.equal(rangees.length, 2);
        assert.match(rangees[0], /N\. MacKinnon[\s\S]*ATT[\s\S]*N\. Suzuki/);
        assert.match(rangees[1], /C\. Makar[\s\S]*DÉF[\s\S]*L\. Hutson/);
        assert.match(html, /\+3 en direct/);
        assert.match(html, /teams\/MTL\.png/);
        assert.match(html, /&lt;b&gt;Rouge&lt;\/b&gt;/, 'le nom saisi reste échappé');
    });

    test('un nom à un seul mot reste entier', () => {
        const { nomCourtJoueur } = charger();
        assert.equal(nomCourtJoueur('Nick Suzuki'), 'N. Suzuki');
        assert.equal(nomCourtJoueur('Pierre-Luc Dubois'), 'P. Dubois');
        assert.equal(nomCourtJoueur('Canadiens'), 'Canadiens');
    });
});

test('les bornes de navigation suivent le calendrier du pool', () => {
    const { h2hBornesSemaines } = charger();
    assert.deepEqual({ ...h2hBornesSemaines('Ligue') }, { enCours: 4, total: 5 });
    assert.deepEqual({ ...h2hBornesSemaines('Inconnu') }, { enCours: 1, total: 1 });
});
