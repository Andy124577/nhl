'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { estRecrueCalder } = require('../../lib/recrueCalder.js');

const SAISON = 20262027;
const nhl = (season, gamesPlayed, extra = {}) => ({ season, gamesPlayed, gameTypeId: 2, leagueAbbrev: 'NHL', ...extra });

describe('estRecrueCalder', () => {
    test('Lekkerimäki : 6 matchs ou plus dans deux saisons précédentes, pas une recrue', () => {
        const fiche = {
            birthDate: '2004-07-24',
            seasonTotals: [nhl(20232024, 1), nhl(20242025, 24), nhl(20252026, 13), nhl(20262027, 10)]
        };
        assert.equal(estRecrueCalder(fiche, SAISON), false);
    });

    test('jamais joué dans la LNH, jeune : recrue', () => {
        const fiche = { birthDate: '2007-12-22', seasonTotals: [{ season: 20252026, gamesPlayed: 60, gameTypeId: 2, leagueAbbrev: 'OHL' }] };
        assert.equal(estRecrueCalder(fiche, SAISON), true);
    });

    test('plus de 25 matchs dans une saison précédente : pas une recrue', () => {
        assert.equal(estRecrueCalder({ birthDate: '2005-01-01', seasonTotals: [nhl(20252026, 26)] }, SAISON), false);
        assert.equal(estRecrueCalder({ birthDate: '2005-01-01', seasonTotals: [nhl(20252026, 25)] }, SAISON), true);
    });

    test('un club échangé : les matchs de la saison s’additionnent', () => {
        const fiche = { birthDate: '2005-01-01', seasonTotals: [nhl(20252026, 15), nhl(20252026, 12)] };
        assert.equal(estRecrueCalder(fiche, SAISON), false);
    });

    test('une seule saison de 6 matchs ou plus : encore une recrue', () => {
        const fiche = { birthDate: '2004-01-01', seasonTotals: [nhl(20242025, 5), nhl(20252026, 20)] };
        assert.equal(estRecrueCalder(fiche, SAISON), true);
    });

    test('les séries et les autres ligues ne comptent pas', () => {
        const fiche = {
            birthDate: '2003-05-01',
            seasonTotals: [
                { season: 20242025, gamesPlayed: 54, gameTypeId: 2, leagueAbbrev: 'KHL' },
                nhl(20252026, 10), nhl(20252026, 12, { gameTypeId: 3 })
            ]
        };
        assert.equal(estRecrueCalder(fiche, SAISON), true);
    });

    test('26 ans au 15 septembre : plus admissible', () => {
        assert.equal(estRecrueCalder({ birthDate: '2000-09-15', seasonTotals: [] }, SAISON), false);
        assert.equal(estRecrueCalder({ birthDate: '2000-09-16', seasonTotals: [] }, SAISON), true);
    });

    test('la saison en cours ne compte pas contre lui', () => {
        assert.equal(estRecrueCalder({ birthDate: '2006-01-01', seasonTotals: [nhl(20262027, 40)] }, SAISON), true);
    });

    test('âge inconnu : les matchs décident seuls', () => {
        assert.equal(estRecrueCalder({ seasonTotals: [] }, SAISON), true);
    });
});
