'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const routesInstantane = require('../../routes/instantDraft.js');
const instantDraft = require('../../lib/instantDraft.js');
const { monterRoutes } = require('../fixtures/routeHarness.js');
const { creerPresence } = require('../../services/presence.js');

const compte = (nom) => ({ username: nom, userId: nom, isAdmin: false });

/**
 * Banc avec une horloge et une minuterie contrôlées : le compte à rebours du
 * salon se déclenche sur commande, jamais en attendant vraiment dix secondes.
 */
function banc(pools = {}) {
    let horloge = Date.parse('2026-09-11T12:00:00Z');
    const minuteurs = new Map();
    let prochain = 1;

    const presence = creerPresence({
        maintenant: () => horloge,
        minuterie: (fonction, delai) => {
            const id = prochain++;
            minuteurs.set(id, { fonction, echeance: horloge + delai });
            return id;
        },
        annuler: (id) => minuteurs.delete(id)
    });

    const h = monterRoutes(routesInstantane, {
        pools,
        users: ['a', 'b', 'c', 'd', 'e'].map(n => ({ username: n, id: n })),
        ctxExtra: { presence, saisonCourante: () => '20262027' }
    });

    h.presence = presence;
    h.avancer = (ms) => { horloge += ms; };
    h.declencher = async () => {
        for (const [id, m] of [...minuteurs]) {
            if (m.echeance <= horloge) { minuteurs.delete(id); m.fonction(); }
        }
        // Le minuteur enchaîne son travail sur la file de microtâches, comme en
        // production ; on la laisse se vider avant de constater le résultat.
        await new Promise(resoudre => setImmediate(resoudre));
        await new Promise(resoudre => setImmediate(resoudre));
    };
    /** Simule la connexion socket de tout le monde dans un salon. */
    h.connecter = (salon, noms) => noms.forEach((n, i) => presence.arrive(salon, n, `socket-${n}-${i}`));
    return h;
}

test('le premier arrivant ouvre un salon ; les suivants le remplissent', async () => {
    const h = banc();

    const premier = await h.appeler('POST', '/join-instant-draft', { auth: compte('a') });
    assert.equal(premier.statusCode, 200);
    assert.equal(premier.body.created, true);
    const salon = premier.body.poolName;

    for (const nom of ['b', 'c']) {
        const res = await h.appeler('POST', '/join-instant-draft', { auth: compte(nom) });
        assert.equal(res.body.poolName, salon, 'la file converge sur un seul salon');
        assert.equal(res.body.created, false);
        assert.equal(res.body.joined, true);
    }

    assert.equal(h.etat.pools.size, 1);
    assert.equal(instantDraft.participants(h.lirePool(salon)), 3);
});

test('un deuxième clic ramène au même salon sans réécrire quoi que ce soit', async () => {
    const h = banc();
    const premier = await h.appeler('POST', '/join-instant-draft', { auth: compte('a') });
    const revision = h.revisionDe(premier.body.poolName);

    const second = await h.appeler('POST', '/join-instant-draft', { auth: compte('a') });
    assert.equal(second.body.poolName, premier.body.poolName);
    assert.equal(second.body.joined, false);
    assert.equal(h.revisionDe(premier.body.poolName), revision);
    assert.equal(instantDraft.participants(h.lirePool(premier.body.poolName)), 1);
});

test('un cinquième arrivant ouvre un second salon plutôt que de déborder le premier', async () => {
    const h = banc();
    const premier = await h.appeler('POST', '/join-instant-draft', { auth: compte('a') });
    const salon = premier.body.poolName;
    for (const nom of ['b', 'c', 'd']) {
        await h.appeler('POST', '/join-instant-draft', { auth: compte(nom) });
    }
    assert.equal(instantDraft.participants(h.lirePool(salon)), 4);

    const cinquieme = await h.appeler('POST', '/join-instant-draft', { auth: compte('e') });
    assert.notEqual(cinquieme.body.poolName, salon);
    assert.equal(cinquieme.body.created, true);
    assert.equal(h.etat.pools.size, 2);
});

test('le salon ne démarre pas tant que tout le monde n est pas connecté', async () => {
    const h = banc();
    const premier = await h.appeler('POST', '/join-instant-draft', { auth: compte('a') });
    const salon = premier.body.poolName;
    for (const nom of ['b', 'c', 'd']) {
        await h.appeler('POST', '/join-instant-draft', { auth: compte(nom) });
    }

    // Personne n'a de socket : le compte à rebours ne doit pas s'armer.
    h.avancer(30000);
    await h.declencher();
    assert.equal(instantDraft.repechageCommence(h.lirePool(salon)), false);
    assert.equal(h.presence.compteEnCours(salon), null);
});

test('quatre présents arment le compte à rebours, qui démarre le repêchage à son terme', async () => {
    const h = banc();
    const premier = await h.appeler('POST', '/join-instant-draft', { auth: compte('a') });
    const salon = premier.body.poolName;
    h.connecter(salon, ['a']);

    for (const nom of ['b', 'c', 'd']) {
        h.connecter(salon, [nom]);
        await h.appeler('POST', '/join-instant-draft', { auth: compte(nom) });
    }

    assert.ok(h.presence.compteEnCours(salon), 'le compte à rebours doit être armé');
    assert.equal(instantDraft.repechageCommence(h.lirePool(salon)), false,
        'le compte à rebours annonce une intention, il ne démarre rien lui-même');

    h.avancer(10000);
    await h.declencher();

    const pool = h.lirePool(salon);
    assert.equal(instantDraft.repechageCommence(pool), true);
    assert.equal(pool.draftOrder.length, 4 * instantDraft.totalSelections(pool));
    assert.equal(h.etat.activity.filter(a => a.type === 'draft_started').length, 1);
    assert.equal(h.etat.notifications.filter(n => n.type === 'draft_started').length, 4);
});

test('un départ pendant le compte à rebours annule le démarrage', async () => {
    const h = banc();
    const premier = await h.appeler('POST', '/join-instant-draft', { auth: compte('a') });
    const salon = premier.body.poolName;
    h.connecter(salon, ['a']);
    for (const nom of ['b', 'c', 'd']) {
        h.connecter(salon, [nom]);
        await h.appeler('POST', '/join-instant-draft', { auth: compte(nom) });
    }
    assert.ok(h.presence.compteEnCours(salon));

    await h.appeler('POST', '/leave-instant-draft', { auth: compte('d') });
    assert.equal(h.presence.compteEnCours(salon), null);

    h.avancer(20000);
    await h.declencher();
    assert.equal(instantDraft.repechageCommence(h.lirePool(salon)), false,
        'on ne lance pas un repêchage à quatre dont l un vient de partir');
});

test('quitter un salon parti en repêchage est refusé : l équipe ne peut pas devenir fantôme', async () => {
    const h = banc();
    const premier = await h.appeler('POST', '/join-instant-draft', { auth: compte('a') });
    const salon = premier.body.poolName;
    h.connecter(salon, ['a']);
    for (const nom of ['b', 'c', 'd']) {
        h.connecter(salon, [nom]);
        await h.appeler('POST', '/join-instant-draft', { auth: compte(nom) });
    }
    h.avancer(10000);
    await h.declencher();

    const res = await h.appeler('POST', '/leave-instant-draft', { auth: compte('b') });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.action, 'reprendre', 'on propose de reprendre, pas de partir');
});

test('rejoindre pendant son propre repêchage y ramène au lieu d en ouvrir un autre', async () => {
    const h = banc();
    const premier = await h.appeler('POST', '/join-instant-draft', { auth: compte('a') });
    const salon = premier.body.poolName;
    h.connecter(salon, ['a']);
    for (const nom of ['b', 'c', 'd']) {
        h.connecter(salon, [nom]);
        await h.appeler('POST', '/join-instant-draft', { auth: compte(nom) });
    }
    h.avancer(10000);
    await h.declencher();

    const retour = await h.appeler('POST', '/join-instant-draft', { auth: compte('a') });
    assert.equal(retour.body.poolName, salon);
    assert.equal(retour.body.started, true);
    assert.equal(h.etat.pools.size, 1, 'aucun second salon ne doit s ouvrir');
});

test('le dernier qui part referme le salon', async () => {
    const h = banc();
    const premier = await h.appeler('POST', '/join-instant-draft', { auth: compte('a') });
    const res = await h.appeler('POST', '/leave-instant-draft', { auth: compte('a') });
    assert.equal(res.body.deleted, true);
    assert.equal(h.etat.pools.size, 0,
        'un salon vide deviendrait le plus « ancien » candidat, donc un fantôme à chaque aller-retour');
});

test('le rôle de créateur suit quand son porteur s en va', async () => {
    const h = banc();
    const premier = await h.appeler('POST', '/join-instant-draft', { auth: compte('a') });
    const salon = premier.body.poolName;
    await h.appeler('POST', '/join-instant-draft', { auth: compte('b') });
    assert.equal(h.lirePool(salon).creator, 'a');

    const res = await h.appeler('POST', '/leave-instant-draft', { auth: compte('a') });
    assert.equal(res.body.nouveauCreateur, 'b');
    assert.equal(h.lirePool(salon).creator, 'b',
        'sinon les autres restent avec un administrateur injoignable');
});

test('quitter sans être en file le dit clairement', async () => {
    const h = banc();
    const res = await h.appeler('POST', '/leave-instant-draft', { auth: compte('a') });
    assert.equal(res.statusCode, 400);
});

test('le salon annonce le temps écoulé, jamais une estimation d attente', async () => {
    const h = banc();
    const premier = await h.appeler('POST', '/join-instant-draft', { auth: compte('a') });
    const salon = premier.body.poolName;
    h.connecter(salon, ['a']);
    h.avancer(120000);

    const res = await h.appeler('GET', '/instant-draft/lobby', { auth: compte('a') });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.inQueue, true);
    assert.equal(res.body.state, 'waiting');
    assert.equal(res.body.placesRestantes, 3);
    assert.deepEqual(res.body.membres, ['a']);
    assert.equal(res.body.moi.connecte, true);
    assert.equal(res.body.compteARebours, null);

    const texte = JSON.stringify(res.body);
    assert.ok(!/estimat|environ|minutes? restantes/i.test(texte),
        'personne ne peut savoir quand trois inconnus vont cliquer');
});

test('hors file, le salon répond sans inventer d état', async () => {
    const h = banc();
    const res = await h.appeler('GET', '/instant-draft/lobby', { auth: compte('a') });
    assert.deepEqual(res.body, { inQueue: false, state: null });
});

test('un salon d une autre saison n accueille pas les arrivants de celle-ci', async () => {
    const ancien = instantDraft.creerPool('z', { season: '20252026' });
    const h = banc({ 'Repêchage instantané #1': ancien });

    const res = await h.appeler('POST', '/join-instant-draft', { auth: compte('a') });
    assert.notEqual(res.body.poolName, 'Repêchage instantané #1');
    assert.equal(res.body.created, true,
        'un salon oublié depuis le printemps ne doit pas servir de rendez-vous en octobre');
});

test('un salon d une autre version de format n accueille pas non plus', async () => {
    const autre = instantDraft.creerPool('z', { season: '20262027', formatVersion: 99 });
    const h = banc({ 'Repêchage instantané #1': autre });

    const res = await h.appeler('POST', '/join-instant-draft', { auth: compte('a') });
    assert.equal(res.body.created, true);
});
