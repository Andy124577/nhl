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
        'h2hBornesSemaines', 'h2hFaitsSaillantsHTML', 'buildMatchupCardHTML'
    ], { allPoolsData, h2hPlayerPhotoHTML: () => '' });
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

        assert.match(html, /1B 2A/);
        assert.match(html, /1V 30ARR/);
        assert.doesNotMatch(html, /Résultat final/);
    });
});

test('les bornes de navigation suivent le calendrier du pool', () => {
    const { h2hBornesSemaines } = charger();
    assert.deepEqual({ ...h2hBornesSemaines('Ligue') }, { enCours: 4, total: 5 });
    assert.deepEqual({ ...h2hBornesSemaines('Inconnu') }, { enCours: 1, total: 1 });
});
