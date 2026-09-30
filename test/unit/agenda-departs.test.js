'use strict';

/**
 * L'agenda des départs prévus (services/agendaDeparts.js) : ce qui décide si
 * la passe de chaque minute doit lire la base, pour que Neon puisse dormir.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { creerAgendaDeparts, instantPrevu } = require('../../services/agendaDeparts.js');

const MAINTENANT = Date.parse('2026-10-03T23:30:00.000Z');
const date = (decalageMs) => new Date(MAINTENANT + decalageMs).toISOString();

test('seul un pool qui attend encore son départ figure à l’agenda', () => {
    assert.equal(instantPrevu({ draftScheduledAt: date(0) }), MAINTENANT);
    assert.equal(instantPrevu({ draftScheduledAt: date(0), draftOrder: [] }), MAINTENANT, 'un ordre vide n’est pas un départ');
    assert.equal(instantPrevu({ draftScheduledAt: date(0), draftOrder: ['A', 'B'] }), null, 'déjà parti');
    assert.equal(instantPrevu({ draftScheduledAt: date(0), instant: true }), null, 'un salon instantané part autrement');
    assert.equal(instantPrevu({ draftScheduledAt: 'pas une date' }), null);
    assert.equal(instantPrevu({}), null);
    assert.equal(instantPrevu(null), null);
});

test('la passe ne lit la base que lorsqu’un départ connu est arrivé', () => {
    const agenda = creerAgendaDeparts({ lireDepartsPrevus: async () => ({}) });
    assert.equal(agenda.echu(MAINTENANT), false, 'agenda vide : rien à lire');

    agenda.noter('Ligue', { draftScheduledAt: date(5 * 60 * 1000) });
    assert.equal(agenda.echu(MAINTENANT), false, 'dans cinq minutes : pas encore');
    assert.equal(agenda.echu(MAINTENANT + 5 * 60 * 1000), true, 'à l’heure dite');

    // Le départ est parti : l’écriture qui le lance le retire.
    agenda.noter('Ligue', { draftScheduledAt: date(5 * 60 * 1000), draftOrder: ['A', 'B'] });
    assert.equal(agenda.echu(MAINTENANT + 60 * 60 * 1000), false);
    assert.deepEqual(agenda.etat(), {});
});

test('une date retirée ou changée suit l’écriture du pool', () => {
    const agenda = creerAgendaDeparts({ lireDepartsPrevus: async () => ({}) });
    agenda.noter('Ligue', { draftScheduledAt: date(0) });
    agenda.noter('Ligue', { draftScheduledAt: date(60 * 60 * 1000) });
    assert.deepEqual(agenda.etat(), { Ligue: MAINTENANT + 60 * 60 * 1000 });
    agenda.noter('Ligue', {});
    assert.deepEqual(agenda.etat(), {});
});

test('le rechargement remplace l’agenda par la base : un pool supprimé en sort', async () => {
    let enBase = {
        Ligue: { draftScheduledAt: date(0), instant: null, draftOrder: null },
        Autre: { draftScheduledAt: date(60 * 1000), instant: null, draftOrder: null }
    };
    const agenda = creerAgendaDeparts({ lireDepartsPrevus: async () => enBase });

    assert.equal(await agenda.recharger(), 2);
    assert.equal(agenda.echu(MAINTENANT), true);

    agenda.noter('Fantome', { draftScheduledAt: date(0) });
    enBase = { Autre: enBase.Autre };
    assert.equal(await agenda.recharger(), 1, 'ce que la base ne connaît plus quitte l’agenda');
    assert.deepEqual(agenda.etat(), { Autre: MAINTENANT + 60 * 1000 });
});

test('une écriture validée pendant la lecture n’est pas perdue', async () => {
    let liberer;
    const lecture = new Promise(r => { liberer = r; });
    const agenda = creerAgendaDeparts({ lireDepartsPrevus: () => lecture });

    const enCours = agenda.recharger();
    assert.equal(agenda.recharger(), enCours, 'un seul rechargement à la fois');

    // La base a été lue avant cette écriture : sa réponse ne la porte pas.
    agenda.noter('Nouveau', { draftScheduledAt: date(0) });
    liberer({ Ancien: { draftScheduledAt: date(0), instant: null, draftOrder: null } });
    await enCours;

    assert.deepEqual(agenda.etat(), { Ancien: MAINTENANT, Nouveau: MAINTENANT });
});

test('une base indisponible laisse l’agenda tel quel', async () => {
    const agenda = creerAgendaDeparts({ lireDepartsPrevus: async () => { throw new Error('base indisponible'); } });
    agenda.noter('Ligue', { draftScheduledAt: date(0) });
    await assert.rejects(agenda.recharger(), /base indisponible/);
    assert.deepEqual(agenda.etat(), { Ligue: MAINTENANT }, 'le départ reste, la passe suivante le retentera');
    await assert.rejects(agenda.recharger(), /base indisponible/, 'un échec ne bloque pas le rechargement suivant');
});
