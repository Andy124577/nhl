'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const poolOps = require('../../lib/poolOps.js');

function pool(options = {}) {
    const teams = {};
    for (let i = 1; i <= (options.nbEquipes || 3); i++) {
        teams[`Équipe ${i}`] = { members: [], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] };
    }
    for (const [nom, membres] of Object.entries(options.membres || { 'Équipe 1': ['alice'], 'Équipe 2': ['bob'] })) {
        teams[nom] = teams[nom] || { members: [], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] };
        teams[nom].members = membres.slice();
    }
    return {
        creator: options.creator || 'alice',
        draftOrder: options.draftOrder || [],
        currentPickIndex: options.currentPickIndex || 0,
        lastPickIndex: options.lastPickIndex ?? -1,
        turnStartedAt: options.turnStartedAt,
        config: options.config || { numOffensive: 2, numDefensive: 1, numGoalies: 1, numRookies: 1, numTeams: 1 },
        teams
    };
}

// ───────────────────────────── Appartenance ─────────────────────────────

test('rejoindre une équipe retire de la précédente, sans jamais laisser deux places occupées', () => {
    const p = pool();
    const resultat = poolOps.rejoindreEquipe(p, { username: 'alice', teamName: 'Équipe 3' });
    assert.equal(resultat.ok, true);
    assert.equal(resultat.equipePrecedente, 'Équipe 1');
    assert.deepEqual(p.teams['Équipe 1'].members, []);
    assert.deepEqual(p.teams['Équipe 3'].members, ['alice']);
});

test('les équipes sont figées dès que l ordre de sélection existe', () => {
    const p = pool({ draftOrder: ['Équipe 1', 'Équipe 2'] });
    const resultat = poolOps.rejoindreEquipe(p, { username: 'carl', teamName: 'Équipe 3' });
    assert.equal(resultat.ok, false);
    assert.equal(resultat.code, 409);
    assert.deepEqual(p.teams['Équipe 3'].members, []);
});

test('une équipe pleine refuse, et l état ne bouge pas', () => {
    const p = pool({ membres: { 'Équipe 1': ['a', 'b', 'c', 'd', 'e'], 'Équipe 2': ['bob'] } });
    const resultat = poolOps.rejoindreEquipe(p, { username: 'bob', teamName: 'Équipe 1' });
    assert.equal(resultat.ok, false);
    assert.equal(resultat.code, 409);
    assert.deepEqual(p.teams['Équipe 2'].members, ['bob'], "bob n'a pas quitté son équipe pour rien");
});

test('quitter laisse les sélections à l équipe', () => {
    const p = pool();
    p.teams['Équipe 1'].offensive = ['Joueur A'];
    const resultat = poolOps.quitterEquipe(p, 'alice');
    assert.equal(resultat.ok, true);
    assert.deepEqual(p.teams['Équipe 1'].members, []);
    assert.deepEqual(p.teams['Équipe 1'].offensive, ['Joueur A'],
        'effacer les choix fausserait le classement de tous les autres');
});

test('renommer une équipe la suit dans l ordre, le classement et l historique', () => {
    const p = pool({ draftOrder: ['Équipe 1', 'Équipe 2', 'Équipe 2', 'Équipe 1'] });
    p.h2hData = {
        standings: { 'Équipe 1': { wins: 2 }, 'Équipe 2': { wins: 1 } },
        matchups: [[{ team1: 'Équipe 1', team2: 'Équipe 2', winner: 'Équipe 1' }]],
        matchupHistory: [{ weekNumber: 1, matchups: [{ team1: 'Équipe 2', team2: 'Équipe 1', winner: 'Équipe 1' }] }]
    };

    const resultat = poolOps.renommerEquipe(p, { ancien: 'Équipe 1', nouveau: 'Les Fusées', username: 'alice' });
    assert.equal(resultat.ok, true);
    assert.deepEqual(p.draftOrder, ['Les Fusées', 'Équipe 2', 'Équipe 2', 'Les Fusées']);
    assert.equal(p.h2hData.standings['Les Fusées'].wins, 2);
    assert.equal(p.h2hData.standings['Équipe 1'], undefined);
    assert.equal(p.h2hData.matchups[0][0].team1, 'Les Fusées');
    assert.equal(p.h2hData.matchups[0][0].winner, 'Les Fusées');
    assert.equal(p.h2hData.matchupHistory[0].matchups[0].team2, 'Les Fusées');
    assert.equal(p.h2hData.matchupHistory[0].matchups[0].winner, 'Les Fusées');
});

test('on ne renomme que son équipe, et pas vers un nom déjà pris', () => {
    const p = pool();
    assert.equal(poolOps.renommerEquipe(p, { ancien: 'Équipe 2', nouveau: 'X', username: 'alice' }).code, 403);
    assert.equal(poolOps.renommerEquipe(p, { ancien: 'Équipe 1', nouveau: 'Équipe 2', username: 'alice' }).code, 409);
    assert.equal(poolOps.renommerEquipe(p, { ancien: 'Équipe 2', nouveau: 'X', username: 'admin', estAdmin: true }).ok, true);
});

// ───────────────────────────── Repêchage ─────────────────────────────

test('le démarrage tire un serpentin couvrant tous les tours de toutes les équipes', () => {
    const p = pool();
    const resultat = poolOps.demarrerRepechage(p);
    assert.equal(resultat.ok, true);
    // 2 équipes actives × 6 sélections chacune (2+1+1+1+1)
    assert.equal(p.draftOrder.length, 12);
    assert.equal(p.currentPickIndex, 0);
    assert.equal(p.lastPickIndex, -1);
});

test('le démarrage refuse à moins de deux équipes, et refuse de recommencer', () => {
    const seule = pool({ membres: { 'Équipe 1': ['alice'] } });
    assert.equal(poolOps.demarrerRepechage(seule).code, 400);

    const partie = pool({ draftOrder: ['Équipe 1'] });
    assert.equal(poolOps.demarrerRepechage(partie).code, 409);
});

test('le démarrage vide la case « club LNH » héritée des anciens pools', () => {
    const p = pool();
    p.teams['Équipe 1'].teams = ['Canadiens de Montréal'];
    poolOps.demarrerRepechage(p);
    assert.deepEqual(p.teams['Équipe 1'].teams, [],
        'sinon le choix du club serait impossible à faire, sa case étant déjà pleine');
});

test('un choix avance le tour, s inscrit dans l historique et redémarre la pendule', () => {
    const p = pool({ draftOrder: ['Équipe 1', 'Équipe 2'], turnStartedAt: 1000 });
    const resultat = poolOps.choisirJoueur(p, {
        username: 'alice', playerName: 'Joueur A', position: 'offensive', maintenant: 5000
    });
    assert.equal(resultat.ok, true);
    assert.equal(resultat.teamName, 'Équipe 1');
    assert.equal(p.currentPickIndex, 1);
    assert.equal(p.lastPickIndex, 0);
    assert.equal(p.turnStartedAt, 5000);
    assert.equal(p.picksHistory.length, 1);
    assert.equal(p.picksHistory[0].pickIndex, 0);
    assert.equal(resultat.tourSuivant, 'Équipe 2');
});

test('choisir hors de son tour est refusé et ne touche à rien', () => {
    const p = pool({ draftOrder: ['Équipe 1', 'Équipe 2'] });
    const resultat = poolOps.choisirJoueur(p, { username: 'bob', playerName: 'Joueur A', position: 'offensive' });
    assert.equal(resultat.ok, false);
    assert.equal(resultat.code, 403);
    assert.equal(p.currentPickIndex, 0);
    assert.equal(p.picksHistory, undefined);
});

test('un joueur déjà pris par une autre équipe ne peut pas être repris', () => {
    const p = pool({ draftOrder: ['Équipe 1', 'Équipe 2'] });
    p.teams['Équipe 2'].offensive = ['Joueur A'];
    const resultat = poolOps.choisirJoueur(p, { username: 'alice', playerName: 'Joueur A', position: 'offensive' });
    assert.equal(resultat.code, 409);
});

test('le quota de la catégorie est respecté, et le refus nomme la bonne catégorie', () => {
    const p = pool({ draftOrder: ['Équipe 1', 'Équipe 1'] });
    p.teams['Équipe 1'].goalie = ['Gardien A'];
    const resultat = poolOps.choisirJoueur(p, { username: 'alice', playerName: 'Gardien B', position: 'goalie' });
    assert.equal(resultat.ok, false);
    assert.match(resultat.message, /gardien/);
});

test('le renversement du serpentin laisse la même équipe choisir deux fois de suite', () => {
    // C'est le cas qui piège : lastPickIndex seul ne distingue pas un second
    // choix légitime d'une requête rejouée.
    const p = pool({ draftOrder: ['Équipe 1', 'Équipe 2', 'Équipe 2', 'Équipe 1'], currentPickIndex: 1 });

    const premier = poolOps.choisirJoueur(p, {
        username: 'bob', playerName: 'Joueur A', position: 'offensive', tourAttendu: 1
    });
    assert.equal(premier.ok, true);
    assert.equal(p.currentPickIndex, 2);

    const second = poolOps.choisirJoueur(p, {
        username: 'bob', playerName: 'Joueur B', position: 'offensive', tourAttendu: 2
    });
    assert.equal(second.ok, true, 'le second choix du renversement est légitime');
    assert.equal(p.currentPickIndex, 3);
    assert.equal(p.picksHistory.length, 2);
});

test('un écran resté sur un tour périmé reçoit un conflit, pas le tour de quelqu un d autre', () => {
    const p = pool({ draftOrder: ['Équipe 1', 'Équipe 2'], currentPickIndex: 1 });
    const resultat = poolOps.choisirJoueur(p, {
        username: 'bob', playerName: 'Joueur A', position: 'offensive', tourAttendu: 0
    });
    assert.equal(resultat.ok, false);
    assert.equal(resultat.code, 409);
    assert.equal(resultat.conflit.tourActuel, 1);
    assert.equal(p.picksHistory, undefined);
});

test('le dernier tour ne fait pas déborder l index', () => {
    const p = pool({ draftOrder: ['Équipe 1'], currentPickIndex: 0 });
    const resultat = poolOps.choisirJoueur(p, { username: 'alice', playerName: 'Joueur A', position: 'offensive' });
    assert.equal(resultat.ok, true);
    assert.equal(resultat.tourSuivant, null);
    assert.equal(p.currentPickIndex, 0);
});

// ───────────────────────────── Saut de tour ─────────────────────────────

test('un tour ne se saute qu après le délai', () => {
    const debut = Date.parse('2026-09-11T12:00:00Z');
    const p = pool({ draftOrder: ['Équipe 1', 'Équipe 2'], turnStartedAt: debut });
    const trop = poolOps.sauterTour(p, { username: 'bob', maintenant: debut + 60000, delaiMs: 180000 });
    assert.equal(trop.ok, false);
    assert.match(trop.message, /2 min/);

    const apres = poolOps.sauterTour(p, { username: 'bob', maintenant: debut + 200000, delaiMs: 180000 });
    assert.equal(apres.ok, true);
    assert.equal(apres.saute, 'Équipe 1');
    assert.equal(p.currentPickIndex, 1);
    assert.equal(p.picksHistory, undefined,
        'aucune entrée : c est ainsi que le client reconnaît un tour sauté');
});

test('on ne saute pas son propre tour pour repousser son choix', () => {
    const p = pool({ draftOrder: ['Équipe 1', 'Équipe 2'], turnStartedAt: Date.parse('2026-09-11T12:00:00Z') });
    const resultat = poolOps.sauterTour(p, { username: 'alice', maintenant: 999999 });
    assert.equal(resultat.code, 403);
});

test('un pool sans pendule ne se saute pas : l absence d heure de départ n est pas une heure ancienne', () => {
    const p = pool({ draftOrder: ['Équipe 1', 'Équipe 2'] });
    assert.equal(poolOps.sauterTour(p, { username: 'bob', maintenant: Date.now() }).ok, false);
});

test('le dernier tour et un repêchage non commencé n offrent rien à sauter', () => {
    assert.equal(poolOps.sauterTour(pool(), { username: 'bob' }).code, 400);
    const dernier = pool({ draftOrder: ['Équipe 1'], currentPickIndex: 0, turnStartedAt: Date.parse('2026-09-11T12:00:00Z') });
    assert.equal(poolOps.sauterTour(dernier, { username: 'bob', maintenant: 999999 }).code, 400);
});

// ───────────────────────────── Ménage ─────────────────────────────

test('le nettoyage retire les équipes vides et jamais servies', () => {
    const p = pool();
    p.teams['Équipe 2'].offensive = ['Joueur A'];
    p.teams['Équipe 2'].members = [];
    const resultat = poolOps.nettoyerEquipesVides(p);
    assert.equal(resultat.ok, true);
    assert.deepEqual(resultat.retirees, ['Équipe 3']);
    assert.ok(p.teams['Équipe 2'], 'une équipe avec des choix garde sa place');
});

test('le nettoyage est refusé une fois le repêchage lancé', () => {
    const p = pool({ draftOrder: ['Équipe 1'] });
    assert.equal(poolOps.nettoyerEquipesVides(p).code, 409);
});

test('la dissociation retire une personne de tous ses pools sans effacer ses choix', () => {
    const pools = { A: pool(), B: pool({ membres: { 'Équipe 2': ['alice'] } }), C: pool({ membres: { 'Équipe 1': ['zoe'] } }) };
    pools.A.teams['Équipe 1'].offensive = ['Joueur A'];

    const touches = poolOps.dissocierPartout(pools, 'alice');
    assert.deepEqual(touches.sort(), ['A', 'B']);
    assert.deepEqual(pools.A.teams['Équipe 1'].members, []);
    assert.deepEqual(pools.A.teams['Équipe 1'].offensive, ['Joueur A']);
});
