'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const routesNotifications = require('../../routes/notifications.js');
const evenements = require('../../lib/events.js');
const { monterRoutes, poolTermine } = require('../fixtures/routeHarness.js');

const ALICE = { username: 'alice', userId: 'alice', isAdmin: false };
const BOB = { username: 'bob', userId: 'bob', isAdmin: false };
const CARL = { username: 'carl', userId: 'carl', isAdmin: false };

function banc() {
    return monterRoutes(routesNotifications, { pools: { Ligue: poolTermine() } });
}

function poser(h, options = {}) {
    const id = h.etat.notifications.length + 1;
    h.etat.notifications.push({
        id,
        recipientUserId: options.pour || 'alice',
        type: options.type || evenements.NOTIFICATION.ECHANGE_RECU,
        poolId: 1,
        poolName: 'Ligue',
        subject: options.subject || { tradeId: 42, poolName: 'Ligue', fromTeam: 'Équipe 2' },
        occurredAt: options.occurredAt || new Date(),
        readAt: options.readAt || null,
        resolvedAt: options.resolvedAt || null,
        expiresAt: options.expiresAt || null
    });
    return id;
}

test('la liste arrive prête à afficher : texte, urgence et destination viennent du serveur', async () => {
    const h = banc();
    poser(h);

    const res = await h.appeler('GET', '/api/notifications', { auth: ALICE });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.disponible, true);

    const notification = res.body.notifications[0];
    assert.equal(notification.id, 'trade:42', "l'identifiant reprend le schéma que la cloche connaît déjà");
    assert.ok(notification.titre);
    assert.ok(notification.action);
    assert.match(notification.href, /trade\.html\?pool=Ligue/);
    assert.equal(notification.urgent, true);
    assert.equal(res.body.nonLues, 1);
});

test('on ne voit que ses propres notifications', async () => {
    const h = banc();
    poser(h, { pour: 'alice' });
    poser(h, { pour: 'bob', subject: { tradeId: 99, poolName: 'Ligue' } });

    const res = await h.appeler('GET', '/api/notifications', { auth: BOB });
    assert.equal(res.body.notifications.length, 1);
    assert.equal(res.body.notifications[0].id, 'trade:99');
});

test('sans session, rien', async () => {
    const h = banc();
    assert.equal((await h.appeler('GET', '/api/notifications', { auth: null })).statusCode, 401);
    assert.equal((await h.appeler('POST', '/api/notifications/read', { auth: null })).statusCode, 401);
});

test('une alerte de tour expirée sort de la pastille sans disparaître de la liste', async () => {
    const h = banc();
    poser(h, {
        type: evenements.NOTIFICATION.VOTRE_TOUR,
        subject: { poolName: 'Ligue', pickIndex: 4 },
        expiresAt: new Date(Date.now() - 1000)
    });

    const res = await h.appeler('GET', '/api/notifications', { auth: ALICE });
    assert.equal(res.body.nonLues, 0,
        'la pastille ne doit pas réclamer indéfiniment une action qui n existe plus');
    assert.equal(res.body.notifications.length, 1, "elle reste consultable dans l'historique");
    assert.equal(res.body.notifications[0].expiree, true);
    assert.equal(res.body.notifications[0].urgent, false);
});

test('marquer comme lu est volontaire et ciblé', async () => {
    const h = banc();
    const un = poser(h);
    poser(h, { subject: { tradeId: 43, poolName: 'Ligue' } });

    // Consulter la liste ne marque rien.
    await h.appeler('GET', '/api/notifications', { auth: ALICE });
    assert.equal((await h.appeler('GET', '/api/notifications/count', { auth: ALICE })).body.nonLues, 2);

    const res = await h.appeler('POST', '/api/notifications/read', { auth: ALICE, body: { ids: [String(un)] } });
    assert.equal(res.body.marquees, 1);
    assert.equal(res.body.nonLues, 1);
});

test('lire ne résout pas : l offre attend toujours une réponse', async () => {
    const h = banc();
    const un = poser(h);
    await h.appeler('POST', '/api/notifications/read', { auth: ALICE, body: { ids: [String(un)] } });

    const res = await h.appeler('GET', '/api/notifications', { auth: ALICE });
    assert.equal(res.body.notifications[0].read, true);
    assert.equal(res.body.notifications[0].resolue, false,
        'la lecture est un geste de la personne, la résolution est un fait du monde');
});

test('une notification résolue le dit, et change de texte', async () => {
    const h = banc();
    poser(h, { resolvedAt: new Date() });

    const res = await h.appeler('GET', '/api/notifications', { auth: ALICE });
    assert.equal(res.body.notifications[0].resolue, true);
    assert.equal(res.body.notifications[0].urgent, false);
    assert.match(res.body.notifications[0].detail, /ne demande plus/);
});

test('marquer les identifiants de quelqu un d autre ne fait rien', async () => {
    const h = banc();
    const celui_de_bob = poser(h, { pour: 'bob' });

    const res = await h.appeler('POST', '/api/notifications/read', {
        auth: ALICE, body: { ids: [String(celui_de_bob)] }
    });
    assert.equal(res.body.marquees, 0);
    assert.equal(h.etat.notifications[0].readAt, null);
});

test('des identifiants malformés sont ignorés sans faire échouer la requête', async () => {
    const h = banc();
    poser(h);
    const res = await h.appeler('POST', '/api/notifications/read', {
        auth: ALICE, body: { ids: ['abc', null, { x: 1 }, '  '] }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.marquees, 0);
});

test('« tout marquer comme lu » vide la pastille', async () => {
    const h = banc();
    poser(h);
    poser(h, { subject: { tradeId: 43, poolName: 'Ligue' } });

    const res = await h.appeler('POST', '/api/notifications/read-all', { auth: ALICE });
    assert.equal(res.body.marquees, 2);
    assert.equal(res.body.nonLues, 0);
});

// ─────────────────────── Activité de pool ───────────────────────

test('le fil d activité est réservé aux membres', async () => {
    const h = banc();
    assert.equal((await h.appeler('GET', '/api/pools/Ligue/activity', { auth: CARL })).statusCode, 403);
    assert.equal((await h.appeler('GET', '/api/pools/Ligue/activity', { auth: ALICE })).statusCode, 200);
});

test('le fil décrit ce qui s est passé, sans détail d offre en attente', async () => {
    const h = banc();
    h.etat.activity.push(
        { id: 1, poolId: 1, type: evenements.ACTIVITE.CHOIX, actorUserId: 'alice',
          subject: { team: 'Équipe 1', player: 'Joueur A', pickIndex: 0 },
          occurredAt: new Date(Date.now() - 3000), dedupKey: 'a' },
        { id: 2, poolId: 1, type: evenements.ACTIVITE.ECHANGE_CONCLU, actorUserId: 'bob',
          subject: { tradeId: 7, fromTeam: 'Équipe 1', toTeam: 'Équipe 2',
                     offering: ['Joueur A'], receiving: ['Joueur B'] },
          occurredAt: new Date(Date.now() - 1000), dedupKey: 'b' }
    );

    const res = await h.appeler('GET', '/api/pools/Ligue/activity', { auth: ALICE });
    assert.equal(res.body.disponible, true);
    assert.equal(res.body.evenements.length, 2);
    assert.match(res.body.evenements[0].texte, /échange/i);
    assert.match(res.body.evenements[1].texte, /Joueur A/);

    const texte = JSON.stringify(res.body);
    assert.ok(!texte.includes('trade_received'),
        "une proposition en attente ne concerne que ses deux équipes");
});

test('la pagination est par curseur et annonce sa suite', async () => {
    const h = banc();
    for (let i = 1; i <= 5; i++) {
        h.etat.activity.push({
            id: i, poolId: 1, type: evenements.ACTIVITE.CHOIX, actorUserId: 'alice',
            subject: { team: 'Équipe 1', player: 'Joueur ' + i, pickIndex: i - 1 },
            occurredAt: new Date(Date.now() - (10 - i) * 1000), dedupKey: 'k' + i
        });
    }

    const page = await h.appeler('GET', '/api/pools/Ligue/activity', { auth: ALICE, query: { limit: '2' } });
    assert.equal(page.body.evenements.length, 2);
    assert.ok(page.body.suite, 'une page suivante existe');
    assert.ok(page.body.suite.before);
    assert.ok(page.body.suite.beforeId);
});

test('une semaine révisée est signalée comme telle dans le fil', async () => {
    const h = banc();
    h.etat.activity.push({
        id: 1, poolId: 1, type: evenements.ACTIVITE.SEMAINE_FINALISEE, actorUserId: null,
        subject: { weekNumber: 3, season: '20262027', revision: 2, revise: true },
        occurredAt: new Date(), dedupKey: 'w'
    });

    const res = await h.appeler('GET', '/api/pools/Ligue/activity', { auth: ALICE });
    assert.match(res.body.evenements[0].texte, /révisé/);
    assert.equal(res.body.evenements[0].revisee, true);
});

test('une rafale de choix se regroupe pour ne pas chasser le reste du fil', () => {
    const h = banc();
    const { regrouper } = routesNotifications.monter(h.app, h.ctx);

    const rafale = Array.from({ length: 8 }, (_, i) => ({
        id: i + 1, type: 'pick', groupe: 'choix', occurredAt: new Date(1000 - i),
        texte: 'choix ' + i
    }));
    const autre = { id: 99, type: 'trade_completed', occurredAt: new Date(500), texte: 'échange' };

    const groupe = regrouper([...rafale, autre]);
    assert.equal(groupe.length, 2);
    assert.equal(groupe[0].nombre, 8);
    assert.match(groupe[0].texte, /8 choix/);
    assert.equal(groupe[1].id, 99);
});

test('deux ou trois choix isolés ne se regroupent pas inutilement', () => {
    const h = banc();
    const { regrouper } = routesNotifications.monter(h.app, h.ctx);

    const seul = [{ id: 1, type: 'pick', groupe: 'choix', occurredAt: new Date(), texte: 'un choix' }];
    assert.equal(regrouper(seul).length, 1);
    assert.equal(regrouper(seul)[0].id, 1);
});
