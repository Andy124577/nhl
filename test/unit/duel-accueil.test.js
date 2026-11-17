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

const { coteVersus } = require('../../lib/duelAccueil.js');

test('Versus : un match en cours s’ajoute au total, un match fini seulement à « ce soir »', () => {
    const joueurs = [
        { name: 'X', goals: 2, assists: 1, matchs: 3 },
        { name: 'Y', goals: 0, assists: 4, matchs: 2 }
    ];
    const soir = [
        { pts: 3.5, goals: 1, assists: 0, enCours: true },
        { pts: 2, goals: 0, assists: 1, enCours: false }
    ];
    const cote = coteVersus(40, joueurs, soir);
    assert.equal(cote.points, 43.5, 'le match fini est déjà en base (ou le sera dans le quart d’heure)');
    assert.equal(cote.ceSoir, 5.5);
    assert.deepEqual([cote.buts, cote.aides, cote.pj], [3, 5, 6]);
});

test('Versus : sans détail ni soirée, des zéros, jamais NaN', () => {
    assert.deepEqual(coteVersus(undefined, null, null), { points: 0, ceSoir: 0, buts: 0, aides: 0, pj: 0 });
});

const { rythmeJoueur, disponibilite, partRestante, chancesVersus } = require('../../lib/duelAccueil.js');

test('Chances : à égalité de tout, 50–50 ; plus de matchs restants, plus de chances', () => {
    const j = { moyenne: 3, variance: 7.6, matchs: 3 };
    assert.deepEqual([chancesVersus({ points: 20, joueurs: [j] }, { points: 20, joueurs: [j] }).moi], [50]);
    const plus = chancesVersus({ points: 20, joueurs: [{ ...j, matchs: 6 }] }, { points: 20, joueurs: [j] });
    assert.ok(plus.moi > 60 && plus.moi + plus.lui === 100);
});

test('Chances : la semaine finie tranche à 100–0, une avance jamais certaine avant', () => {
    assert.equal(chancesVersus({ points: 41, joueurs: [] }, { points: 40, joueurs: [] }).moi, 100);
    const serre = chancesVersus({ points: 60, joueurs: [] }, { points: 40, joueurs: [{ moyenne: 3, variance: 8, matchs: 2 }] });
    assert.ok(serre.moi >= 90 && serre.moi <= 99);
});

test('Rythme : un blessé absent ne compte plus, au jour le jour à moitié', () => {
    assert.equal(disponibilite({ status: 'Out' }), 0);
    assert.equal(disponibilite({ status: 'Injured Reserve' }), 0);
    assert.equal(disponibilite({ status: 'Day-To-Day' }), 0.5);
    assert.equal(disponibilite(null), 1);
});

test('Rythme : un attaquant productif dépasse la moyenne, un gardien ne joue que sa part', () => {
    const vedette = rythmeJoueur({ position: 'C', gamesPlayed: 20, goals: 12, assists: 18 });
    const moyen = rythmeJoueur({ position: 'C', gamesPlayed: 0 });
    assert.ok(vedette.moyenne > moyen.moyenne);
    const partant = rythmeJoueur({ position: 'G', gamesPlayed: 15, wins: 10, shutouts: 1, savePct: 0.915 }, 18);
    const adjoint = rythmeJoueur({ position: 'G', gamesPlayed: 4, wins: 2, shutouts: 0, savePct: 0.9 }, 18);
    assert.ok(partant.moyenne > adjoint.moyenne);
});

test('Match en cours : seul le temps qui reste compte', () => {
    assert.equal(partRestante({ state: 'FUT' }), 1);
    assert.equal(partRestante({ state: 'OFF' }), 0);
    const mi = partRestante({ state: 'LIVE', period: 2, clock: { timeRemaining: '10:00' } });
    assert.ok(Math.abs(mi - 0.5) < 0.01);
});
