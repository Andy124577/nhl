'use strict';

/**
 * Les notifications dépassées (lib/notificationsPerimees.js), type par type.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { estPerimee, filtrerActuelles, etatRepechage } = require('../../lib/notificationsPerimees.js');
const { NOTIFICATION } = require('../../lib/events.js');
const { poolTermine, poolNeuf } = require('../fixtures/routeHarness.js');

const MOI = { username: 'alice' };

/** Un repêchage en cours : Équipe 1 a choisi, c'est au tour de l'Équipe 2. */
function poolEnCours() {
    return poolTermine({
        draftOrder: ['Équipe 1', 'Équipe 2', 'Équipe 2', 'Équipe 1'],
        currentPickIndex: 1,
        config: { numOffensive: 2, numDefensive: 0, numGoalies: 0, numRookies: 0, numTeams: 0 }
    });
}

const notif = (type, subject = {}, extra = {}) => ({ type, subject, poolName: 'Ligue', ...extra });

test('etatRepechage distingue attente, en cours et terminé', () => {
    assert.equal(etatRepechage(poolNeuf()), 'attente');
    assert.equal(etatRepechage(poolEnCours()), 'encours');
    assert.equal(etatRepechage(poolTermine()), 'termine');
});

test('« Repêchage commencé » reste pendant le repêchage, disparaît après', () => {
    const n = notif(NOTIFICATION.REPECHAGE_DEMARRE);
    assert.equal(estPerimee(n, poolEnCours(), MOI), false);
    assert.equal(estPerimee(n, poolTermine(), MOI), true);
    assert.equal(estPerimee(n, poolNeuf(), MOI), true, 'nouvelle saison : ce repêchage-là est loin');
});

test('« Repêchage automatique terminé » reste jusqu’à la saison suivante', () => {
    const n = notif(NOTIFICATION.REPECHAGE_DEMARRE, { auto: true });
    assert.equal(estPerimee(n, poolTermine(), MOI), false);
    assert.equal(estPerimee(n, poolNeuf(), MOI), true);
});

test('« C’est votre tour » disparaît dès que le tour est joué', () => {
    const pool = poolEnCours();
    assert.equal(estPerimee(notif(NOTIFICATION.VOTRE_TOUR, { pickIndex: 1 }), pool, { username: 'bob' }), false);
    assert.equal(estPerimee(notif(NOTIFICATION.VOTRE_TOUR, { pickIndex: 0 }), pool, MOI), true);
    assert.equal(estPerimee(notif(NOTIFICATION.VOTRE_TOUR, { pickIndex: 3 }), poolTermine(), MOI), true);
    assert.equal(estPerimee(notif(NOTIFICATION.VOTRE_TOUR, { pickIndex: 1 }, { resolvedAt: new Date() }), pool, MOI), true);
    assert.equal(estPerimee(notif(NOTIFICATION.VOTRE_TOUR, { pickIndex: 1 },
        { expiresAt: new Date(Date.now() - 1) }), pool, MOI), true);
});

test('« Fantazy a choisi pour vous » disparaît à la fin du repêchage', () => {
    const n = notif(NOTIFICATION.CHOIX_AUTO, { pickIndex: 0 });
    assert.equal(estPerimee(n, poolEnCours(), MOI), false);
    assert.equal(estPerimee(n, poolTermine(), MOI), true);
});

test('« Date du repêchage fixée » : remplacée, retirée ou dépassée par le départ', () => {
    const date = '2026-11-01T00:00:00.000Z';
    const n = notif(NOTIFICATION.REPECHAGE_PREVU, { date });
    assert.equal(estPerimee(n, { ...poolNeuf(), draftScheduledAt: date }, MOI), false);
    assert.equal(estPerimee(n, { ...poolNeuf(), draftScheduledAt: '2026-11-02T00:00:00.000Z' }, MOI), true);
    assert.equal(estPerimee(n, poolNeuf(), MOI), true, 'date retirée');
    assert.equal(estPerimee(n, { ...poolEnCours(), draftScheduledAt: date }, MOI), true, 'repêchage parti');
});

test('« Le repêchage prévu n’a pas démarré » : réglé par une nouvelle date ou un départ', () => {
    const n = notif(NOTIFICATION.REPECHAGE_MANQUE, { date: '2026-11-01T00:00:00.000Z' });
    assert.equal(estPerimee(n, poolNeuf(), MOI), false);
    assert.equal(estPerimee(n, { ...poolNeuf(), draftScheduledAt: '2026-11-05T00:00:00.000Z' }, MOI), true);
    assert.equal(estPerimee(n, poolEnCours(), MOI), true);
});

test('une offre reçue disparaît une fois réglée ; l’issue d’un échange reste', () => {
    const pool = poolTermine();
    assert.equal(estPerimee(notif(NOTIFICATION.ECHANGE_RECU, { tradeId: 1 }), pool, MOI), false);
    assert.equal(estPerimee(notif(NOTIFICATION.ECHANGE_RECU, { tradeId: 1 }, { resolvedAt: new Date() }), pool, MOI), true);
    assert.equal(estPerimee(notif(NOTIFICATION.ECHANGE_RESULTAT, { tradeId: 1, resultat: 'accepte' }), pool, MOI), false);
});

test('« Semaine N commencée » disparaît quand la semaine suivante commence', () => {
    const pool = { ...poolTermine({ poolMode: 'head-to-head' }), h2hData: { currentWeek: 4 } };
    assert.equal(estPerimee(notif(NOTIFICATION.NOUVELLE_SEMAINE, { weekNumber: 4 }), pool, MOI), false);
    assert.equal(estPerimee(notif(NOTIFICATION.NOUVELLE_SEMAINE, { weekNumber: 3 }), pool, MOI), true);
    pool.h2hData.currentWeek = 1; // nouvelle saison
    assert.equal(estPerimee(notif(NOTIFICATION.NOUVELLE_SEMAINE, { weekNumber: 20 }), pool, MOI), true);
});

test('pool supprimé ou quitté : tout disparaît ; pool inconnu : dans le doute, on garde', () => {
    const n = notif(NOTIFICATION.ECHANGE_RESULTAT, { tradeId: 1 });
    assert.equal(estPerimee(n, null, MOI), true);
    assert.equal(estPerimee(n, poolTermine(), { username: 'carl' }), true);
    assert.equal(estPerimee(n, undefined, MOI), false);
});

test('filtrerActuelles lit chaque pool une seule fois, et garde ce qu’une lecture ratée ne permet pas de juger', async () => {
    const lus = [];
    const liste = [
        notif(NOTIFICATION.REPECHAGE_DEMARRE),
        notif(NOTIFICATION.ECHANGE_RESULTAT, { tradeId: 1 }),
        { type: NOTIFICATION.ECHANGE_RESULTAT, subject: {}, poolName: 'Panne' }
    ];
    const actuelles = await filtrerActuelles(liste, {
        username: 'alice',
        lirePool: async nom => {
            lus.push(nom);
            if (nom === 'Panne') throw new Error('base injoignable');
            return { data: poolTermine() };
        }
    });
    assert.deepEqual(lus, ['Ligue', 'Panne']);
    assert.deepEqual(actuelles.map(n => n.poolName), ['Ligue', 'Panne']);
    assert.equal(actuelles[0].type, NOTIFICATION.ECHANGE_RESULTAT);
});
