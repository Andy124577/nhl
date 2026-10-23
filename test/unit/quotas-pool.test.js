'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const quotasPool = require('../../lib/quotasPool.js');
const poolOps = require('../../lib/poolOps.js');
const draftkit = require('../../draftkit.json');

const { maximumsPour, OFFRE, PARTICIPANTS_MAX } = quotasPool;

test('les maximums baissent quand le pool grandit', () => {
    const lignes = {
        10: [20, 12, 3, 2, 3],
        12: [20, 10, 2, 2, 2],
        14: [17, 8, 2, 1, 2],
        16: [15, 7, 2, 1, 2],
        18: [13, 6, 1, 1, 1],
        20: [12, 6, 1, 1, 1]
    };
    for (const [n, [att, def, gar, rec, eq]] of Object.entries(lignes)) {
        const m = maximumsPour(Number(n));
        assert.deepEqual(
            [m.numOffensive, m.numDefensive, m.numGoalies, m.numRookies, m.numTeams],
            [att, def, gar, rec, eq], `${n} participants`);
    }
});

test('un petit pool garde les bornes du formulaire', () => {
    assert.deepEqual(maximumsPour(2), {
        numOffensive: 20, numDefensive: 20, numGoalies: 10, numRookies: 10, numTeams: 10, numBench: 5
    });
});

test('à aucune taille un pool plein ne demande plus que la réserve', () => {
    for (let n = 2; n <= PARTICIPANTS_MAX; n++) {
        const m = maximumsPour(n);
        for (const cle of Object.keys(OFFRE)) {
            assert.ok(m[cle] * n <= OFFRE[cle], `${n} participants × ${m[cle]} ${cle}`);
        }
    }
});

test("l'alignement par défaut passe à toutes les tailles", () => {
    for (let n = 2; n <= PARTICIPANTS_MAX; n++) {
        const m = maximumsPour(n);
        for (const [cle, valeur] of Object.entries(poolOps.CONFIG_PAR_DEFAUT)) {
            assert.ok(valeur <= m[cle], `${n} participants : ${cle} ${valeur} > ${m[cle]}`);
        }
    }
});

test('le banc descend à 3 places à partir de 18 participants', () => {
    assert.equal(maximumsPour(16).numBench, 5);
    assert.equal(maximumsPour(18).numBench, 3);
    assert.equal(maximumsPour(20).numBench, 3);
});

test('une taille hors bornes ou illisible est ramenée entre 2 et 20', () => {
    assert.deepEqual(maximumsPour(40), maximumsPour(20));
    assert.deepEqual(maximumsPour(0), maximumsPour(2));
    assert.deepEqual(maximumsPour('abc'), maximumsPour(20));
    assert.deepEqual(maximumsPour('14'), maximumsPour(14));
});

test('la réserve supposée tient dans la trousse de repêchage de la saison', () => {
    const points = p => (p.projection && p.projection.points) || 0;
    const matchs = p => (p.projection && p.projection.gamesPlayed) || 0;
    const attaquants = draftkit.skaters.filter(p => p.position !== 'D' && points(p) >= 29).length;
    const defenseurs = draftkit.skaters.filter(p => p.position === 'D' && points(p) >= 19).length;
    const recrues = draftkit.skaters.filter(p => p.rookie && points(p) >= 10).length;
    const gardiens = draftkit.goalies.filter(p => matchs(p) >= 40).length;

    assert.ok(attaquants >= OFFRE.numOffensive, `${attaquants} attaquants utiles`);
    assert.ok(defenseurs >= OFFRE.numDefensive, `${defenseurs} défenseurs utiles`);
    assert.ok(recrues >= OFFRE.numRookies, `${recrues} recrues utiles`);
    assert.ok(gardiens >= OFFRE.numGoalies, `${gardiens} gardiens partants`);
    assert.equal(draftkit.teams.length, OFFRE.numTeams);
});

test("un ancien pool sans plafond garde ses dix places, quel que soit le plafond permis", () => {
    assert.equal(poolOps.PARTICIPANTS_MAX, 20);
    assert.equal(poolOps.capacite({ teams: {} }), 10);
    assert.equal(poolOps.capacite({ maxPlayers: 20 }), 20);
});
