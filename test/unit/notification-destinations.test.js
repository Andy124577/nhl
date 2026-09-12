'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chargerFonctions } = require('../fixtures/helpers.js');

// Les routes d'echange ne vivent plus dans server.js : elles sont montees sur
// un faux Express, au-dessus du VRAI contrat d'ecriture (banc d'essai dans
// test/fixtures/routeHarness.js). Les tests precedents decoupaient le corps des
// routes dans server.js avec indexOf() — ce qui cassait des qu'on deplacait une
// route, sans que rien ne soit casse dans le produit.
const routesEchanges = require('../../routes/trades.js');
const { monterRoutes, poolTermine } = require('../fixtures/routeHarness.js');

const ALICE = { username: 'alice', userId: 'alice', isAdmin: false };
const BOB = { username: 'bob', userId: 'bob', isAdmin: false };
const CARL = { username: 'carl', userId: 'carl', isAdmin: false };

function banc(pools) {
    return monterRoutes(routesEchanges, { pools: pools || { Pool: poolTermine() } });
}

const offre = [{ name: 'Joueur A', type: 'offensive' }];
const retour = [{ name: 'Joueur B', type: 'offensive' }];

async function proposer(h) {
    const res = await h.appeler('POST', '/trade/propose', {
        auth: ALICE,
        body: {
            draftName: 'Pool', fromTeam: 'Équipe 1', toTeam: 'Équipe 2',
            offering: offre, receiving: retour
        }
    });
    return res;
}

test('une proposition ne previent personne avant que la base ait accepte', async () => {
    const h = banc();
    try {
        const res = await proposer(h);
        assert.equal(res.statusCode, 200);
        assert.ok(res.body.tradeId);

        // La notification durable est ecrite DANS la transaction, donc avant
        // toute diffusion — et le detail de l'offre ne part pas au pool entier,
        // seulement au destinataire.
        assert.equal(h.etat.notifications.length, 1);
        assert.equal(h.etat.notifications[0].recipientUserId, 'bob');
        const versTous = h.etat.emissions.filter(e => String(e[1]).startsWith('pool:'));
        assert.ok(versTous.every(e => !JSON.stringify(e[2] || {}).includes('Joueur A')),
            "le detail d'une offre en attente ne doit pas etre diffuse au pool");
    } finally { h.nettoyer(); }
});

test('une proposition refusee par la validation ne laisse ni trace ni notification', async () => {
    const h = banc();
    try {
        // Alice propose un joueur qu'elle ne possede pas.
        const res = await h.appeler('POST', '/trade/propose', {
            auth: ALICE,
            body: {
                draftName: 'Pool', fromTeam: 'Équipe 1', toTeam: 'Équipe 2',
                offering: [{ name: 'Fantome', type: 'offensive' }], receiving: retour
            }
        });
        assert.equal(res.statusCode, 409);
        assert.equal(h.etat.trades.length, 0);
        assert.equal(h.etat.notifications.length, 0);
        assert.deepEqual(h.etat.emissions, []);
    } finally { h.nettoyer(); }
});

test("seule l'equipe destinataire peut accepter une proposition", async () => {
    const h = banc();
    try {
        await proposer(h);
        const tradeId = h.etat.trades[0].id;

        // Celle qui a propose ne peut pas accepter sa propre offre.
        let res = await h.appeler('POST', '/trade/accept', { auth: ALICE, body: { tradeId } });
        assert.equal(res.statusCode, 403);

        // Quelqu'un d'etranger au pool non plus.
        res = await h.appeler('POST', '/trade/accept', { auth: CARL, body: { tradeId } });
        assert.equal(res.statusCode, 403);

        assert.equal(h.etat.trades[0].status, 'pending');
        assert.deepEqual(h.lirePool('Pool').teams['Équipe 1'].offensive, ['Joueur A']);
    } finally { h.nettoyer(); }
});

test('une acceptation echange les alignements, annule les concurrentes et retire les annonces', async () => {
    const h = banc();
    try {
        await proposer(h);
        const tradeId = h.etat.trades[0].id;

        // Une deuxieme proposition porte sur le meme joueur : elle devient
        // impossible des que la premiere est conclue.
        h.etat.trades.push({
            id: 99, poolName: 'Pool', status: 'pending', createdAt: new Date(),
            data: { fromTeam: 'Équipe 1', toTeam: 'Équipe 2', offering: offre, receiving: retour }
        });
        h.etat.listings.push({
            id: 7, poolName: 'Pool', teamName: 'Équipe 1', playerName: 'Joueur A',
            category: 'offensive', listedBy: 'alice', status: 'active'
        });

        const res = await h.appeler('POST', '/trade/accept', { auth: BOB, body: { tradeId } });
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.cancelledConflictingTrades, 1);

        const pool = h.lirePool('Pool');
        assert.deepEqual(pool.teams['Équipe 1'].offensive, ['Joueur B']);
        assert.deepEqual(pool.teams['Équipe 2'].offensive, ['Joueur A']);

        assert.equal(h.etat.trades.find(t => t.id === tradeId).status, 'completed');
        assert.equal(h.etat.trades.find(t => t.id === 99).status, 'cancelled');
        assert.equal(h.etat.listings.find(l => l.id === 7).status, 'removed');

        // L'offre cesse d'etre en attente : c'est l'action qui se resout, pas
        // la lecture. Les deux notions restent separees.
        const offreRecue = h.etat.notifications.find(n => n.type === 'trade_received');
        assert.ok(offreRecue.resolvedAt, "l'offre acceptee doit cesser d'etre en attente");
        assert.ok(!offreRecue.readAt, 'accepter ne marque pas la notification comme lue');
    } finally { h.nettoyer(); }
});

test("accepter deux fois n'echange pas deux fois", async () => {
    const h = banc();
    try {
        await proposer(h);
        const tradeId = h.etat.trades[0].id;

        assert.equal((await h.appeler('POST', '/trade/accept', { auth: BOB, body: { tradeId } })).statusCode, 200);
        const res = await h.appeler('POST', '/trade/accept', { auth: BOB, body: { tradeId } });
        assert.equal(res.statusCode, 409);

        const pool = h.lirePool('Pool');
        assert.deepEqual(pool.teams['Équipe 1'].offensive, ['Joueur B']);
        assert.deepEqual(pool.teams['Équipe 2'].offensive, ['Joueur A']);
    } finally { h.nettoyer(); }
});

test('refuser une proposition deja traitee ne diffuse aucune fausse mise a jour', async () => {
    const h = banc();
    try {
        await proposer(h);
        const tradeId = h.etat.trades[0].id;

        assert.equal((await h.appeler('POST', '/trade/decline', { auth: BOB, body: { tradeId } })).statusCode, 200);
        h.etat.emissions.length = 0;

        const res = await h.appeler('POST', '/trade/decline', { auth: BOB, body: { tradeId } });
        assert.equal(res.statusCode, 409);
        assert.deepEqual(h.etat.emissions, []);
    } finally { h.nettoyer(); }
});

test('la liste des offres recues est celle du compte connecte, pas celle demandee', async () => {
    const h = banc();
    try {
        await proposer(h);

        const sienne = await h.appeler('GET', '/trades/pending/bob', { auth: BOB });
        assert.equal(sienne.statusCode, 200);
        assert.equal(sienne.body.length, 1);

        const autre = await h.appeler('GET', '/trades/pending/bob', { auth: ALICE });
        assert.equal(autre.statusCode, 403, "lire les offres de quelqu'un d'autre doit etre refuse");
    } finally { h.nettoyer(); }
});

test('/trades/all est atteignable et ne deborde pas sur les pools des autres', async () => {
    const h = monterRoutes(routesEchanges, {
        pools: {
            Pool: poolTermine(),
            Autre: poolTermine({
                creator: 'carl',
                teams: {
                    'Équipe 1': { members: ['carl'], offensive: ['Joueur C'], defensive: [], goalie: [], rookie: [], teams: [] },
                    'Équipe 2': { members: ['dora'], offensive: ['Joueur D'], defensive: [], goalie: [], rookie: [], teams: [] }
                }
            })
        }
    });
    try {
        h.etat.trades.push({
            id: 1, poolName: 'Autre', status: 'completed', createdAt: new Date(),
            data: { fromTeam: 'Équipe 1', toTeam: 'Équipe 2', offering: offre, receiving: retour }
        });
        // La route existe bel et bien : declaree apres /trades/:draftName, elle
        // etait capturee par le parametre et jamais atteinte.
        const res = await h.appeler('GET', '/trades/all', { auth: ALICE });
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, [], "Alice n'est pas membre du pool « Autre »");
    } finally { h.nettoyer(); }
});

test('archived notification destinations focus the correct card and respect reduced motion', async () => {
    for (const status of ['completed', 'declined', 'cancelled']) {
        const focused = [];
        const scrolled = [];
        const container = {
            html: '',
            set innerHTML(value) { this.html = value; },
            get innerHTML() { return this.html; },
            querySelectorAll() {
                return Array.from(this.html.matchAll(/data-trade-id="([^"]+)"/g), match => ({
                    dataset: { tradeId: match[1] },
                    focus() { focused.push(match[1]); },
                    scrollIntoView(options) { scrolled.push(options.behavior); }
                }));
            }
        };
        const trade = {
            id: 42, draftName: 'Pool', fromTeam: 'Sender', toTeam: 'Recipient', status,
            date: '2026-09-01T12:00:00Z',
            offering: [{ name: 'Player A', type: 'offensive' }],
            receiving: [{ name: 'Player B', type: 'offensive' }]
        };
        const { loadHistory } = chargerFonctions('trade.js', [
            'loadHistory', 'focusTradeTarget', 'getCategory', 'getCategoryLabel'
        ], {
            BASE_URL: '', currentUsername: 'recipient',
            document: { getElementById: () => container },
            window: { matchMedia: () => ({ matches: true }) },
            FZPool: { get: () => 'Pool' },
            fetch: async () => ({ ok: true, json: async () => [
                { ...trade, id: 99, draftName: 'Other pool' },
                { ...trade, id: 41 }, trade
            ] })
        });
        assert.equal(await loadHistory('42'), true);
        assert.deepEqual(focused, ['42']);
        assert.deepEqual(scrolled, ['auto']);
        assert.doesNotMatch(container.html, /data-trade-id="99"/);
        assert.match(container.html, status === 'completed' ? /Complété/ : status === 'declined' ? /Refusé/ : /Annulé/);
        focused.length = 0;
        assert.equal(await loadHistory('missing'), false);
        assert.deepEqual(focused, []);
    }
});
