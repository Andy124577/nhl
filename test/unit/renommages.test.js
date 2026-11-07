'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { remplacerNomEquipe, motifRecherche, noterAncienNom, ANCIENS_NOMS_MAX } = require('../../lib/renommages.js');

test('remplacerNomEquipe : champs d’équipe, tableaux de noms et clés', () => {
    const avant = {
        tradeId: 4, fromTeam: 'Les Bleus', toTeam: 'Rouges',
        offering: [{ name: 'Les Bleus', type: 'offensive' }],
        equipes: ['Les Bleus', 'Rouges'],
        standings: { 'Les Bleus': { wins: 2 } },
        duels: [{ team1: 'Les Bleus', team2: 'Rouges', winner: 'Les Bleus', club: 'Les Bleus' }]
    };
    const { valeur, change } = remplacerNomEquipe(avant, 'Les Bleus', 'Bleuets');
    assert.equal(change, true);
    assert.equal(valeur.fromTeam, 'Bleuets');
    assert.equal(valeur.toTeam, 'Rouges');
    assert.deepEqual(valeur.equipes, ['Bleuets', 'Rouges']);
    assert.deepEqual(Object.keys(valeur.standings), ['Bleuets']);
    assert.equal(valeur.duels[0].team1, 'Bleuets');
    assert.equal(valeur.duels[0].winner, 'Bleuets');
    // Un joueur ou un club au même nom n'est pas une équipe du pool.
    assert.equal(valeur.offering[0].name, 'Les Bleus');
    assert.equal(valeur.duels[0].club, 'Les Bleus');
    // L'original n'est pas modifié.
    assert.equal(avant.fromTeam, 'Les Bleus');
});

test('remplacerNomEquipe : rien à faire, même objet rendu', () => {
    const avant = { fromTeam: 'A', toTeam: 'B' };
    const r = remplacerNomEquipe(avant, 'C', 'D');
    assert.equal(r.change, false);
    assert.equal(r.valeur, avant);
});

test('motifRecherche : nom en chaîne JSON, jokers LIKE échappés', () => {
    assert.equal(motifRecherche('Équipe 3'), '%"Équipe 3"%');
    assert.equal(motifRecherche('a_b%c'), '%"a\\_b\\%c"%');
});

test('noterAncienNom : le plus récent en tête, sans doublon ni le nom actuel', () => {
    assert.deepEqual(noterAncienNom(undefined, 'A', 'B'), ['A']);
    assert.deepEqual(noterAncienNom(['A'], 'B', 'C'), ['B', 'A']);
    // Revenir à un ancien nom le retire de la liste.
    assert.deepEqual(noterAncienNom(['B', 'A'], 'C', 'A'), ['C', 'B']);
    const longue = noterAncienNom(['1', '2', '3', '4', '5', '6'], 'X', 'Y');
    assert.equal(longue.length, ANCIENS_NOMS_MAX);
    assert.equal(longue[0], 'X');
});
