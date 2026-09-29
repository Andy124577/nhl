'use strict';

/**
 * Un échange conclu par équipe et par mois (lib/trades.js, routes/trades.js).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const echanges = require('../../lib/trades.js');
const poolOps = require('../../lib/poolOps.js');
const routesEchanges = require('../../routes/trades.js');
const { monterRoutes, poolTermine } = require('../fixtures/routeHarness.js');

const ALICE = { username: 'alice', userId: 'alice', isAdmin: false };
const BOB = { username: 'bob', userId: 'bob', isAdmin: false };

const offre = [{ name: 'Joueur A', type: 'offensive' }];
const retour = [{ name: 'Joueur B', type: 'offensive' }];

const proposer = (h, auth = ALICE, de = 'Équipe 1', vers = 'Équipe 2', o = offre, r = retour) =>
    h.appeler('POST', '/trade/propose', {
        auth, body: { draftName: 'Pool', fromTeam: de, toTeam: vers, offering: o, receiving: r }
    });

// ───────────────────────────── Les règles ─────────────────────────────

test('le mois se lit à l heure du pool, pas en UTC', () => {
    // 22 h à Toronto le 30 septembre, déjà le 1er octobre en UTC.
    assert.equal(echanges.moisDe('2026-10-01T02:00:00Z'), '2026-09');
    assert.equal(echanges.moisDe('2026-10-01T05:00:00Z'), '2026-10');
    assert.equal(echanges.moisDe('pas une date'), null);
});

test('une équipe qui a échangé ce mois-ci attend le 1er du mois suivant', () => {
    const maintenant = Date.parse('2026-09-28T15:00:00Z');
    const pool = { echangesConclus: { 'Équipe 1': '2026-09-03T12:00:00Z', 'Équipe 3': '2026-08-31T12:00:00Z' } };
    assert.equal(echanges.aEchangeCeMois(pool, 'Équipe 1', maintenant), true);
    assert.equal(echanges.aEchangeCeMois(pool, 'Équipe 3', maintenant), false, 'août est passé');
    assert.equal(echanges.aEchangeCeMois(pool, 'Équipe 2', maintenant), false);
    assert.equal(echanges.aEchangeCeMois({}, 'Équipe 1', maintenant), false);

    assert.equal(echanges.refusEchangeDuMois(pool, { fromTeam: 'Équipe 1', toTeam: 'Équipe 2', moi: 'Équipe 1', maintenant }),
        'Votre équipe a déjà conclu son échange du mois. Prochain échange possible le 1er octobre.');
    assert.equal(echanges.refusEchangeDuMois(pool, { fromTeam: 'Équipe 2', toTeam: 'Équipe 1', moi: 'Équipe 2', maintenant }),
        'Équipe 1 a déjà conclu son échange du mois. Prochain échange possible le 1er octobre.');
    assert.equal(echanges.refusEchangeDuMois(pool, { fromTeam: 'Équipe 2', toTeam: 'Équipe 3', maintenant }), null);
    assert.match(echanges.refusEchangeDuMois({ echangesConclus: { A: '2026-12-10T12:00:00Z' } },
        { fromTeam: 'A', toTeam: 'B', maintenant: Date.parse('2026-12-20T12:00:00Z') }), /1er janvier/);
});

test('un échange conclu compte pour les deux équipes, et suit un renommage', () => {
    const pool = poolTermine();
    const maintenant = Date.parse('2026-09-28T15:00:00Z');
    echanges.noterEchangeConclu(pool, { fromTeam: 'Équipe 1', toTeam: 'Équipe 2', maintenant });
    assert.deepEqual(pool.echangesConclus, { 'Équipe 1': '2026-09-28T15:00:00.000Z', 'Équipe 2': '2026-09-28T15:00:00.000Z' });

    assert.equal(poolOps.renommerEquipe(pool, { ancien: 'Équipe 1', nouveau: 'Les Castors', username: 'alice' }).ok, true);
    assert.equal(echanges.aEchangeCeMois(pool, 'Les Castors', maintenant), true, 'un nouveau nom ne rouvre pas le mois');
    assert.equal(pool.echangesConclus['Équipe 1'], undefined);
});

// ───────────────────────────── Les routes ─────────────────────────────

test('après un échange conclu, aucune des deux équipes ne peut en proposer un autre ce mois-ci', async () => {
    const h = monterRoutes(routesEchanges, { pools: { Pool: poolTermine() } });
    try {
        assert.equal((await proposer(h)).statusCode, 200);
        const accepte = await h.appeler('POST', '/trade/accept', { auth: BOB, body: { tradeId: h.etat.trades[0].id } });
        assert.equal(accepte.statusCode, 200, JSON.stringify(accepte.body));
        const pool = h.lirePool('Pool');
        assert.ok(pool.echangesConclus['Équipe 1'] && pool.echangesConclus['Équipe 2']);

        // Les joueurs ont changé de camp : Alice a maintenant Joueur B.
        const encore = await proposer(h, ALICE, 'Équipe 1', 'Équipe 2', retour, offre);
        assert.equal(encore.statusCode, 409);
        assert.match(encore.body.message, /Votre équipe a déjà conclu son échange du mois/);
        assert.equal(encore.body.code, 'echange_du_mois');

        const lui = await proposer(h, BOB, 'Équipe 2', 'Équipe 1', offre, retour);
        assert.equal(lui.statusCode, 409, 'Bob aussi a joué le sien');
        assert.equal(h.etat.trades.filter(t => t.status === 'pending').length, 0);
    } finally { h.nettoyer(); }
});

test('une proposition en attente ne se conclut pas si une équipe a échangé entre-temps', async () => {
    const h = monterRoutes(routesEchanges, { pools: { Pool: poolTermine() } });
    try {
        assert.equal((await proposer(h)).statusCode, 200);
        const pool = h.lirePool('Pool');
        pool.echangesConclus = { 'Équipe 1': new Date().toISOString() };
        h.etat.pools.get('Pool').data = pool;

        const refus = await h.appeler('POST', '/trade/accept', { auth: BOB, body: { tradeId: h.etat.trades[0].id } });
        assert.equal(refus.statusCode, 409);
        assert.match(refus.body.message, /^Équipe 1 a déjà conclu son échange du mois/);
        assert.deepEqual(h.lirePool('Pool').teams['Équipe 1'].offensive, ['Joueur A'], 'rien n a bougé');
        assert.equal(h.etat.trades[0].status, 'pending', 'la proposition attend le mois prochain');
    } finally { h.nettoyer(); }
});

test("l'échange du mois dernier ne compte plus", async () => {
    const pool = poolTermine();
    pool.echangesConclus = { 'Équipe 1': '2000-01-15T12:00:00Z', 'Équipe 2': '2000-01-15T12:00:00Z' };
    const h = monterRoutes(routesEchanges, { pools: { Pool: pool } });
    try {
        assert.equal((await proposer(h)).statusCode, 200);
    } finally { h.nettoyer(); }
});
