'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const recap = require('../../lib/recap.js');

const semaine = (numero, duels) => ({
    weekNumber: numero,
    weekStart: '2026-11-02',
    weekEnd: '2026-11-09',
    matchups: duels
});

const duel = (a, b, pa, pb, extra = {}) => ({
    team1: a, team2: b, team1Points: pa, team2Points: pb,
    winner: pa === pb ? 'tie' : (pa > pb ? a : b),
    ...extra
});

test('les résultats gardent les égalités telles quelles', () => {
    const section = recap.resultats(semaine(1, [duel('A', 'B', 30, 30), duel('C', 'D', 22, 15)]));
    assert.equal(section.duels[0].egalite, true);
    assert.deepEqual(section.duels[0].gagnants, ['A', 'B'],
        'deux meneurs partagent la victoire : rien ne désigne un vainqueur au hasard');
    assert.deepEqual(section.duels[1].gagnants, ['C']);
});

test('le meilleur score est partagé quand deux équipes sont à égalité', () => {
    const section = recap.meilleurScore(semaine(1, [duel('A', 'B', 40, 10), duel('C', 'D', 40, 12)]));
    assert.equal(section.points, 40);
    assert.deepEqual(section.equipes.sort(), ['A', 'C']);
    assert.equal(section.partage, true);
});

test('les scores négatifs comptent au lieu d être traités comme zéro', () => {
    const section = recap.meilleurScore(semaine(1, [duel('A', 'B', -2, -8)]));
    assert.equal(section.points, -2);
    assert.deepEqual(section.equipes, ['A']);
});

test('le duel le plus serré reconnaît une égalité parfaite', () => {
    const section = recap.duelSerre(semaine(1, [duel('A', 'B', 30, 30), duel('C', 'D', 22, 15)]));
    assert.equal(section.ecart, 0);
    assert.equal(section.egalite, true);
});

test('le plus gros écart se retire quand tous les duels sont nuls', () => {
    assert.equal(recap.plusGrosEcart(semaine(1, [duel('A', 'B', 20, 20)])), null,
        "il n'y a pas d'écart à annoncer, et zéro serait une réponse trompeuse");
    const section = recap.plusGrosEcart(semaine(1, [duel('A', 'B', 40, 10)]));
    assert.equal(section.ecart, 30);
    assert.equal(section.duels[0].gagnant, 'A');
});

test('le joueur de la semaine vient des contributions figées, ou se retire', () => {
    // Sans détail figé, la catégorie sort plutôt que d'être recalculée depuis
    // les alignements du jour.
    assert.equal(recap.joueurDeLaSemaine(semaine(1, [duel('A', 'B', 30, 20)])), null);

    const avecDetail = semaine(1, [duel('A', 'B', 30, 20, {
        team1Top: [{ name: 'Joueur A', team: 'A', fantasyPoints: 18, matchs: 3 }],
        team2Top: [{ name: 'Joueur B', team: 'B', fantasyPoints: 12, matchs: 2 }]
    })]);
    const section = recap.joueurDeLaSemaine(avecDetail);
    assert.equal(section.points, 18);
    assert.deepEqual(section.joueurs[0], { name: 'Joueur A', equipe: 'A', matchs: 3 });
});

test('un joueur de la semaine à zéro point n en est pas un', () => {
    const nul = semaine(1, [duel('A', 'B', 0, 0, {
        team1Top: [{ name: 'Joueur A', team: 'A', fantasyPoints: 0, matchs: 1 }],
        team2Top: []
    })]);
    assert.equal(recap.joueurDeLaSemaine(nul), null);
});

test('une série exige des semaines consécutives et s arrête sur un trou', () => {
    const consecutives = [
        semaine(3, [duel('A', 'B', 30, 20)]),
        semaine(2, [duel('A', 'B', 25, 20)]),
        semaine(1, [duel('A', 'B', 22, 20)])
    ];
    const section = recap.series(consecutives);
    const serieA = section.series.find(s => s.equipe === 'A');
    assert.equal(serieA.longueur, 3);
    assert.equal(serieA.issue, 'victoire');

    // La semaine 2 manque : le compte s'arrête à la semaine 3.
    const avecTrou = [semaine(3, [duel('A', 'B', 30, 20)]), semaine(1, [duel('A', 'B', 22, 20)])];
    assert.equal(recap.series(avecTrou), null, 'une série ne saute pas par-dessus une semaine absente');
});

test('une égalité interrompt une série, et la règle est annoncée', () => {
    const avecNul = [
        semaine(3, [duel('A', 'B', 20, 20)]),
        semaine(2, [duel('A', 'B', 30, 20)]),
        semaine(1, [duel('A', 'B', 28, 20)])
    ];
    const section = recap.series(avecNul);
    assert.equal(section, null, 'la série de A est coupée à la semaine 3');

    const sansNul = [
        semaine(3, [duel('A', 'B', 31, 20)]),
        semaine(2, [duel('A', 'B', 30, 20)])
    ];
    assert.match(recap.series(sansNul).regleEgalite, /égalité/);
});

test('la variation du total ne se dit pas « points marqués »', () => {
    const ouverture = {
        season: '20262027', scoringBasis: 'cumulative', date: '2026-11-02',
        teams: [{ teamName: 'A', rank: 3, points: 100 }, { teamName: 'B', rank: 1, points: 140 }]
    };
    const fermeture = {
        season: '20262027', scoringBasis: 'cumulative', date: '2026-11-09',
        teams: [{ teamName: 'A', rank: 1, points: 155 }, { teamName: 'B', rank: 2, points: 148 }]
    };

    const section = recap.variationDuTotal(ouverture, fermeture);
    assert.equal(section.libelle, 'variation du total du pool');
    assert.match(section.avertissement, /échanges/);
    assert.equal(section.plusGrosseRemontee.equipes[0], 'A');
    assert.equal(section.plusGrosseRemontee.places, 2);
    assert.equal(section.lignes.find(l => l.teamName === 'A').variation, 55);
});

test('deux relevés incomparables ne produisent aucune variation', () => {
    const base = { season: '20262027', scoringBasis: 'cumulative', date: '2026-11-02', teams: [] };
    assert.equal(recap.variationDuTotal(base, { ...base, season: '20252026' }), null);
    assert.equal(recap.variationDuTotal(base, { ...base, scoringBasis: 'h2h' }), null);
    assert.equal(recap.variationDuTotal(null, base), null);
});

test('une équipe absente d un des deux relevés est écartée plutôt que devinée', () => {
    const ouverture = {
        season: 'S', scoringBasis: 'cumulative', date: 'd1',
        teams: [{ teamName: 'A', rank: 1, points: 10 }]
    };
    const fermeture = {
        season: 'S', scoringBasis: 'cumulative', date: 'd2',
        teams: [{ teamName: 'A', rank: 2, points: 12 }, { teamName: 'Nouvelle', rank: 1, points: 30 }]
    };
    const section = recap.variationDuTotal(ouverture, fermeture);
    assert.equal(section.lignes.length, 1);
    assert.equal(section.lignes[0].teamName, 'A');
});

test('un récap complet dit ce qu il omet, et pourquoi', () => {
    const construit = recap.construire({
        pool: 'Ligue', saison: '20262027', mode: 'head-to-head',
        semaine: semaine(1, [duel('A', 'B', 20, 20)]),
        semainesFinalisees: [semaine(1, [duel('A', 'B', 20, 20)])]
    });

    const categories = construit.sections.map(s => s.categorie);
    assert.ok(categories.includes(recap.CATEGORIE.RESULTATS));
    assert.ok(categories.includes(recap.CATEGORIE.MEILLEUR_SCORE));

    const omises = construit.categoriesOmises.map(o => o.categorie);
    assert.ok(omises.includes(recap.CATEGORIE.PLUS_GROS_ECART), 'tous les duels sont nuls');
    assert.ok(omises.includes(recap.CATEGORIE.JOUEUR_SEMAINE), 'aucune contribution figée');
    assert.ok(omises.includes(recap.CATEGORIE.SERIE), 'une seule semaine finalisée');
    assert.ok(construit.categoriesOmises.every(o => o.raison), 'une omission sans raison ressemble à un bogue');
});

test('une seule semaine finalisée ne fait pas une histoire', () => {
    const une = recap.construire({
        pool: 'L', saison: 'S', mode: 'head-to-head',
        semaine: semaine(1, [duel('A', 'B', 30, 20)]),
        semainesFinalisees: [semaine(1, [duel('A', 'B', 30, 20)])]
    });
    assert.equal(une.portee, 'cette_semaine');

    const deux = recap.construire({
        pool: 'L', saison: 'S', mode: 'head-to-head',
        semaine: semaine(2, [duel('A', 'B', 30, 20)]),
        semainesFinalisees: [semaine(2, [duel('A', 'B', 30, 20)]), semaine(1, [duel('A', 'B', 28, 20)])]
    });
    assert.equal(deux.portee, 'depuis_le_debut_du_suivi',
        "« de tous les temps » n'est jamais annoncé");
});

test('un pool cumulatif ne reçoit ni duel ni adversaire', () => {
    const construit = recap.construire({ pool: 'L', saison: 'S', mode: 'cumulative' });
    const categories = construit.sections.map(s => s.categorie);
    assert.ok(!categories.includes(recap.CATEGORIE.RESULTATS));
    assert.ok(!categories.includes(recap.CATEGORIE.SERIE));
    assert.deepEqual(construit.categoriesOmises.map(o => o.categorie), [recap.CATEGORIE.VARIATION_TOTAL]);
});

test('un tête-à-tête sans semaine finalisée n a rien à raconter', () => {
    const construit = recap.construire({ pool: 'L', saison: 'S', mode: 'head-to-head', semaine: null });
    assert.deepEqual(construit.sections, []);
    assert.equal(construit.categoriesOmises[0].raison, 'aucune semaine finalisée');
});
