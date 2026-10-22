'use strict';

/**
 * Repêchage automatique : une option choisie à la création du pool
 * (`draftAuto`). Au départ — au clic ou à l'heure prévue —, Fantazy joue
 * tous les tours pour toutes les équipes, dans la transaction du départ
 * (lib/poolOps.js repecherToutDOffice, routes/pools.js repecherDOffice).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const poolOps = require('../../lib/poolOps.js');
const choixAuto = require('../../lib/choixAuto.js');
const evenements = require('../../lib/events.js');
const { checkIfDraftComplete } = require('../../lib/draft.js');
const routesPools = require('../../routes/pools.js');
const routesRepechage = require('../../routes/draft.js');
const { monterRoutes, poolNeuf } = require('../fixtures/routeHarness.js');

const ALICE = { username: 'alice', userId: 'alice', isAdmin: false };

const TROUSSE = {
    skaters: [
        { fullName: 'Connor McDavid', position: 'C', rookie: false, projection: { points: 135 } },
        { fullName: 'Mitch Marner', position: 'R', rookie: false, projection: { points: 100 } },
        { fullName: 'Cale Makar', position: 'D', rookie: false, projection: { points: 95 } },
        { fullName: 'Tim Stützle', position: 'C', rookie: false, projection: { points: 85 } },
        { fullName: 'Quinn Hughes', position: 'D', rookie: false, projection: { points: 80 } },
        { fullName: 'Jack Hughes', position: 'C', rookie: false, projection: { points: 78 } },
        { fullName: 'Adam Fox', position: 'D', rookie: false, projection: { points: 70 } },
        { fullName: 'Miro Heiskanen', position: 'D', rookie: false, projection: { points: 65 } },
        { fullName: 'Ivan Demidov', position: 'R', rookie: true, projection: { points: 60 } }
    ],
    goalies: [
        { fullName: 'Andrei Vasilevskiy', rookie: false, projection: { wins: 38 } },
        { fullName: 'Igor Shesterkin', rookie: false, projection: { wins: 36 } }
    ],
    teams: [
        { fullName: 'Carolina Hurricanes', projection: { wins: 54 } },
        { fullName: 'Colorado Avalanche', projection: { wins: 51 } }
    ]
};
const BASSIN = choixAuto.bassinDepuisTrousse(TROUSSE);
const CONFIG = { numOffensive: 2, numDefensive: 2, numGoalies: 1, numRookies: 0, numTeams: 1 };

function deuxEquipes(options = {}) {
    return poolNeuf({ membres: { 'Équipe 1': ['alice'], 'Équipe 2': ['bob'] }, nbEquipes: 2, config: CONFIG, ...options });
}

function banc(pools) {
    return monterRoutes([routesPools, routesRepechage], { pools, ctxExtra: { trousse: TROUSSE } });
}

test('tous les tours se jouent d’un coup, chaque choix marqué automatique', () => {
    const pool = deuxEquipes();
    assert.equal(poolOps.demarrerRepechage(pool).ok, true);
    const r = poolOps.repecherToutDOffice(pool, { bassin: BASSIN, maintenant: 1000 });

    assert.equal(r.ok, true);
    assert.equal(r.choix, pool.draftOrder.length);
    assert.equal(r.sautes, 0);
    assert.equal(r.draftComplet, true);
    assert.equal(checkIfDraftComplete(pool), true);
    assert.equal(pool.picksHistory.length, pool.draftOrder.length);
    assert.ok(pool.picksHistory.every(c => c.auto === true));
    assert.deepEqual(pool.picksHistory.map(c => c.pickIndex), pool.draftOrder.map((_, i) => i));
    // Le meilleur disponible, en serpentin : McDavid au premier choix, Marner au second.
    assert.deepEqual(pool.picksHistory.slice(0, 2).map(c => [c.team, c.player]),
        [['Équipe 1', 'Connor McDavid'], ['Équipe 2', 'Mitch Marner']]);
    assert.equal(new Set(pool.picksHistory.map(c => c.player)).size, pool.picksHistory.length, 'personne deux fois');
});

test('sans assez de joueurs, les tours manquants passent et rien ne boucle', () => {
    const pool = deuxEquipes();
    poolOps.demarrerRepechage(pool);
    const r = poolOps.repecherToutDOffice(pool, { bassin: BASSIN.slice(0, 3), maintenant: 1000 });
    assert.equal(r.ok, true);
    assert.equal(r.choix, 3);
    assert.equal(r.sautes, pool.draftOrder.length - 3);
    assert.equal(r.draftComplet, false);
    assert.equal(pool.lastPickIndex, pool.draftOrder.length - 1, 'le dernier tour est consommé');
});

test('avant le départ, rien ne se joue', () => {
    assert.equal(poolOps.repecherToutDOffice(deuxEquipes(), { bassin: BASSIN }).ok, false);
});

test('la création garde l’option seulement quand elle est cochée', async () => {
    const h = banc({});
    await h.appeler('POST', '/create-clan', { auth: ALICE, body: { name: 'Les Robots', teamName: 'Robots', draftAuto: true } });
    await h.appeler('POST', '/create-clan', { auth: ALICE, body: { name: 'Les Hiboux', teamName: 'Hiboux' } });
    await h.appeler('POST', '/create-clan', { auth: ALICE, body: { name: 'Les Chats', teamName: 'Chats', draftAuto: 'oui' } });
    assert.equal(h.lirePool('Les Robots').draftAuto, true);
    assert.equal('draftAuto' in h.lirePool('Les Hiboux'), false);
    assert.equal('draftAuto' in h.lirePool('Les Chats'), false);
});

test('« Commencer » sur un pool automatique termine le repêchage dans la même requête', async () => {
    const pool = deuxEquipes();
    pool.draftAuto = true;
    const h = banc({ Ligue: pool });

    const res = await h.appeler('POST', '/start-draft', { auth: ALICE, body: { clanName: 'Ligue' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.draftComplet, true);
    assert.match(res.body.message, /automatique/);

    const apres = h.lirePool('Ligue');
    assert.equal(checkIfDraftComplete(apres), true);
    assert.ok(apres.picksHistory.every(c => c.auto === true));

    const types = h.etat.notifications.map(n => n.type);
    assert.equal(types.includes('turn_current'), false, 'aucun « C’est votre tour »');
    const departs = h.etat.notifications.filter(n => n.type === 'draft_started');
    assert.deepEqual(departs.map(n => n.recipientUserId).sort(), ['alice', 'bob']);
    assert.ok(departs.every(n => n.subject.auto === true));
    assert.ok(h.etat.activity.some(a => a.type === 'draft_complete'));
    assert.ok(h.etat.emissions.some(([evenement]) => evenement === 'draftComplete'));

    const vue = evenements.vueNotification({ type: 'draft_started', poolName: 'Ligue', subject: departs[0].subject });
    assert.equal(vue.titre, 'Repêchage automatique terminé');
    assert.equal(vue.href, 'classement.html?pool=Ligue&recap=1');
});

test('à l’heure prévue, un pool automatique se repêche tout seul', async () => {
    const MAINTENANT = Date.parse('2026-10-22T20:00:00.000Z');
    const pool = deuxEquipes();
    pool.draftAuto = true;
    pool.draftScheduledAt = new Date(MAINTENANT - 60000).toISOString();
    const h = banc({ Ligue: pool });

    const bilan = await h.ctx.demarrerRepechagesPrevus(MAINTENANT);
    assert.deepEqual(bilan.map(b => [b.pool, b.demarre, b.termine]), [['Ligue', true, true]]);
    assert.equal(checkIfDraftComplete(h.lirePool('Ligue')), true);
    assert.ok(h.etat.emissions.some(([evenement]) => evenement === 'draftComplete'));
});

test('sans l’option, le départ reste un repêchage joué à la main', async () => {
    const h = banc({ Ligue: deuxEquipes() });
    const res = await h.appeler('POST', '/start-draft', { auth: ALICE, body: { clanName: 'Ligue' } });
    assert.equal(res.body.draftComplet, false);
    const pool = h.lirePool('Ligue');
    assert.equal(pool.currentPickIndex, 0);
    assert.equal((pool.picksHistory || []).length, 0);
    assert.ok(h.etat.notifications.some(n => n.type === 'turn_current'));
});
