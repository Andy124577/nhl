'use strict';

/**
 * L'aperçu d'un match à venir au calendrier (lib/apercuMatchs.js) : la fiche
 * des deux clubs et leurs meneurs, tirés de /v1/score/{jour}.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { apercuDeScore, meneur } = require('../../lib/apercuMatchs.js');

const lnh = (category, value, extra = {}) => ({
    id: 8478427, firstName: { default: 'Sebastian' }, lastName: { default: 'Aho', fi: 'Aho' },
    headshot: 'https://assets.nhle.com/mugs/nhl/20262027/CAR/8478427.png', teamAbbrev: 'CAR',
    sweaterNumber: 20, position: 'C', category, value, ...extra
});

test('un match à venir : la fiche des deux clubs et ses meneurs, dans l’ordre de la LNH', () => {
    const apercu = apercuDeScore([{
        id: 2026020053, gameState: 'FUT',
        awayTeam: { abbrev: 'CAR', record: '1-1-1' }, homeTeam: { abbrev: 'MTL', record: '1-0-1' },
        teamLeaders: [lnh('goals', 3), lnh('assists', 4), lnh('wins', 2)]
    }]);
    assert.deepEqual(Object.keys(apercu), ['2026020053']);
    const m = apercu[2026020053];
    assert.deepEqual(m.away, { fiche: '1-1-1' });
    assert.deepEqual(m.home, { fiche: '1-0-1' });
    assert.deepEqual(m.meneurs.map(l => [l.cat, l.val]), [['goals', 3], ['assists', 4], ['wins', 2]]);
    assert.deepEqual(m.meneurs[0], {
        id: 8478427, prenom: 'Sebastian', nom: 'Aho',
        photo: 'https://assets.nhle.com/mugs/nhl/20262027/CAR/8478427.png',
        club: 'CAR', numero: 20, pos: 'C', cat: 'goals', val: 3
    });
});

test('un match commencé ou fini n’a pas d’aperçu ; une journée illisible non plus', () => {
    const apercu = apercuDeScore([
        { id: 1, gameState: 'LIVE', awayTeam: { record: '1-0-0' }, teamLeaders: [lnh('goals', 1)] },
        { id: 2, gameState: 'OFF' },
        { id: 3, gameState: 'PRE' },
        { gameState: 'FUT' },
        null
    ]);
    assert.deepEqual(Object.keys(apercu), ['3']);
    assert.deepEqual(apercu[3], { away: { fiche: null }, home: { fiche: null }, meneurs: [] });
    assert.deepEqual(apercuDeScore(null), {});
    assert.deepEqual(apercuDeScore({ games: [] }), {});
});

test('un meneur sans catégorie connue ou sans valeur ne fait pas de carte', () => {
    assert.equal(meneur(lnh('points', 5)), null);
    assert.equal(meneur(lnh('goals', null)), null);
    assert.equal(meneur(lnh('goals', 'beaucoup')), null);
    assert.equal(meneur(null), null);
    assert.equal(meneur(lnh('goals', '2')).val, 2, 'une valeur en texte se lit');
});

test('les noms en texte simple et les champs manquants restent lisibles', () => {
    const l = meneur({ category: 'wins', value: 0, firstName: 'Sam', lastName: { default: '' } });
    assert.deepEqual(l, { id: null, prenom: 'Sam', nom: '', photo: '', club: '', numero: null, pos: '', cat: 'wins', val: 0 });
});
