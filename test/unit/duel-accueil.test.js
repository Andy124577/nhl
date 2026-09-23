'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { duelAAfficher } = require('../../lib/duelAccueil.js');

const semaine = (n, status, duel) => ({
    weekNumber: n, status,
    weekStart: `2026-10-${String(5 + (n - 1) * 7).padStart(2, '0')}`,
    weekLastDay: `2026-10-${String(11 + (n - 1) * 7).padStart(2, '0')}`,
    matchups: [duel]
});

test('le duel en cours passe devant tout, avec le résultat de la semaine d’avant', () => {
    const semaines = [
        semaine(1, 'completed', { team1: 'A', team2: 'B', team1Points: 80, team2Points: 60, winner: 'A' }),
        semaine(2, 'ongoing', { team1: 'C', team2: 'A', team1Points: 0, team2Points: 0, winner: null }),
        semaine(3, 'upcoming', { team1: 'A', team2: 'D' })
    ];
    const duel = duelAAfficher(semaines, 'A');
    assert.equal(duel.mode, 'encours');
    assert.equal(duel.semaine, 2);
    assert.equal(duel.adversaire.nom, 'C', 'vu depuis son équipe, même inscrite en second');
    assert.equal(duel.precedent.semaine, 1);
    assert.equal(duel.precedent.issue, 'victoire');
});

test('sans duel en cours, le prochain ; sans prochain, le dernier joué', () => {
    const avantSaison = [semaine(1, 'upcoming', { team1: 'A', team2: 'B' })];
    assert.equal(duelAAfficher(avantSaison, 'A').mode, 'avenir');
    assert.equal(duelAAfficher(avantSaison, 'A').precedent, null);

    const finDeSaison = [
        semaine(1, 'completed', { team1: 'A', team2: 'B', team1Points: 50, team2Points: 70, winner: 'B' }),
        semaine(2, 'pending_finalization', { team1: 'B', team2: 'A', team1Points: 40, team2Points: 40, winner: null })
    ];
    const dernier = duelAAfficher(finDeSaison, 'A');
    assert.equal(dernier.mode, 'termine');
    assert.equal(dernier.semaine, 2);
    assert.equal(dernier.issue, 'nulle');
    assert.equal(dernier.finalise, false, 'une semaine pas encore finalisée le dit');
});

test('une égalité enregistrée « tie » se lit comme une nulle, pas comme une défaite', () => {
    const s = [semaine(1, 'completed', { team1: 'A', team2: 'B', team1Points: 30, team2Points: 30, winner: 'tie' })];
    assert.equal(duelAAfficher(s, 'A').issue, 'nulle');
});

test('une équipe absente du calendrier ne reçoit rien', () => {
    assert.equal(duelAAfficher([semaine(1, 'ongoing', { team1: 'A', team2: 'B' })], 'Z'), null);
    assert.equal(duelAAfficher(null, 'A'), null);
});
