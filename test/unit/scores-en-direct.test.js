'use strict';

/**
 * Le direct poussé par Socket.IO (lib/scoresEnDirect.js, services/
 * scoresEnDirect.js) : l'accueil ne sonde plus /live-games toutes les cinq
 * secondes ; le serveur relève la LNH une fois et ne pousse que ce qui change.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { comparer, chronoAEnvoyer, chronoDe, DERIVE_MAX_S } = require('../../lib/scoresEnDirect.js');
const { creerScoresEnDirect, SALLE } = require('../../services/scoresEnDirect.js');

function match(id, { away = 1, home = 0, period = 2, secondes = 600, tourne = true, entracte = false, events = [] } = {}) {
    const mm = String(Math.floor(secondes / 60)).padStart(2, '0');
    const ss = String(secondes % 60).padStart(2, '0');
    return {
        id, state: 'LIVE', period, periodType: 'REG',
        clock: { timeRemaining: `${mm}:${ss}`, secondsRemaining: secondes, running: tourne, inIntermission: entracte },
        away: { abbrev: 'MTL', name: 'Canadiens', score: away },
        home: { abbrev: 'TOR', name: 'Leafs', score: home },
        events
    };
}

describe('ce qui part vers les pages', () => {
    test('le premier relevé, ou une liste de matchs qui change, part en entier', () => {
        const premier = comparer(null, [match(1), match(2)], 0);
        assert.equal(premier.tout, true);

        const meme = comparer(premier.etat, [match(1), match(2)], 5000);
        assert.equal(meme.tout, false);

        const nouveau = comparer(meme.etat, [match(1), match(2), match(3)], 10000);
        assert.equal(nouveau.tout, true, 'un match commence');
        const fini = comparer(nouveau.etat, [match(1), match(3)], 15000);
        assert.equal(fini.tout, true, 'un match se termine');
    });

    test('une horloge qui s’écoule normalement ne part pas : la page la fait avancer', () => {
        const a = comparer(null, [match(1, { secondes: 600 })], 0);
        const b = comparer(a.etat, [match(1, { secondes: 595 })], 5000);
        assert.deepEqual([b.matchs.length, b.chronos.length], [0, 0]);
        const c = comparer(b.etat, [match(1, { secondes: 590 })], 10000);
        assert.deepEqual([c.matchs.length, c.chronos.length], [0, 0], 'toujours rien : l’écart se mesure depuis le dernier envoi');
    });

    test('un arrêt de jeu, une reprise, un entracte partent — en quelques octets', () => {
        const a = comparer(null, [match(1, { secondes: 600 })], 0);
        const arret = comparer(a.etat, [match(1, { secondes: 596, tourne: false })], 5000);
        assert.equal(arret.matchs.length, 0);
        assert.equal(arret.chronos.length, 1);
        assert.deepEqual(Object.keys(arret.chronos[0]).sort(), ['clock', 'id']);

        const toujoursArrete = comparer(arret.etat, [match(1, { secondes: 596, tourne: false })], 10000);
        assert.equal(toujoursArrete.chronos.length, 0);

        const reprise = comparer(toujoursArrete.etat, [match(1, { secondes: 594, tourne: true })], 15000);
        assert.equal(reprise.chronos.length, 1);

        const entracte = comparer(reprise.etat, [match(1, { secondes: 0, tourne: false, entracte: true })], 20000);
        assert.equal(entracte.chronos.length, 1);
    });

    test('une horloge qui dérive de plus de deux secondes est recalée', () => {
        const a = comparer(null, [match(1, { secondes: 600 })], 0);
        const juste = comparer(a.etat, [match(1, { secondes: 590 - DERIVE_MAX_S })], 10000);
        assert.equal(juste.chronos.length, 0);
        const loin = comparer(juste.etat, [match(1, { secondes: 580 })], 15000);
        assert.equal(loin.chronos.length, 1, 'attendu 585, la LNH dit 580');
    });

    test('un but, une période, un pointage : le match entier part', () => {
        const a = comparer(null, [match(1), match(2)], 0);
        // L'horloge du match 2 s'écoule normalement pendant ce temps.
        const but = comparer(a.etat, [match(1, { away: 2, events: [{ team: 'MTL', scorer: 'Suzuki' }] }), match(2, { secondes: 595 })], 5000);
        assert.equal(but.matchs.length, 1);
        assert.equal(but.matchs[0].id, 1);
        assert.equal(but.chronos.length, 0, 'l’horloge du match 1 voyage avec lui, celle du 2 s’écoule');

        const periode = comparer(but.etat, [match(1, { away: 2, period: 3, events: [{ team: 'MTL', scorer: 'Suzuki' }] }), match(2, { secondes: 590 })], 10000);
        assert.equal(periode.matchs.length, 1);
    });

    test('sans « running », chaque changement d’horloge part', () => {
        const sans = (s) => { const m = match(1, { secondes: s }); delete m.clock.running; return m; };
        const a = comparer(null, [sans(600)], 0);
        assert.equal(comparer(a.etat, [sans(600)], 5000).chronos.length, 0);
        assert.equal(comparer(a.etat, [sans(595)], 5000).chronos.length, 1);
    });

    test('chronoAEnvoyer : sans horloge, rien ; première fois, tout', () => {
        assert.equal(chronoAEnvoyer(null, 0, null, 0), false);
        assert.equal(chronoAEnvoyer(null, 0, chronoDe(match(1)), 0), true);
    });
});

describe('le service', () => {
    function fauxIo() {
        const salle = new Set();
        const envois = [];
        return {
            salle, envois,
            sockets: { adapter: { rooms: { get: (nom) => (nom === SALLE && salle.size ? salle : undefined) } } },
            to: (nom) => ({ emit: (evt, charge) => envois.push({ nom, evt, charge }) })
        };
    }
    function fauxSocket(io, id) {
        const ecoutes = new Map();
        const recus = [];
        return {
            recus,
            on: (evt, fn) => ecoutes.set(evt, fn),
            emit: (evt, charge) => recus.push({ evt, charge }),
            join: () => io.salle.add(id),
            leave: () => io.salle.delete(id),
            declencher: (evt) => ecoutes.get(evt)()
        };
    }
    function fausseMinuterie() {
        const poses = [];
        return { poses, repeter: (fn, ms) => { const p = { fn, ms, arrete: false }; poses.push(p); return p; }, arreter: (p) => { p.arrete = true; } };
    }

    test('personne ne suit : aucun relevé de la LNH', async () => {
        const io = fauxIo();
        let releves = 0;
        const minuterie = fausseMinuterie();
        const service = creerScoresEnDirect({ io, lire: async () => { releves += 1; return { games: [] }; }, minuterie });
        await service.tic();
        assert.equal(releves, 0);
        assert.equal(minuterie.poses.length, 0);
    });

    test('suivre : l’état complet tout de suite, puis seulement les changements', async () => {
        const io = fauxIo();
        let t = 1_000_000;
        let jeux = [match(1, { secondes: 600 })];
        const minuterie = fausseMinuterie();
        const service = creerScoresEnDirect({
            io, minuterie, horloge: () => t,
            lire: async () => ({ games: jeux, generatedAt: 'x', lu: t - 1000 })
        });
        const socket = fauxSocket(io, 'a');
        service.brancher(socket);
        await socket.declencher('scores:suivre');

        assert.equal(socket.recus[0].evt, 'scores:tout');
        assert.equal(socket.recus[0].charge.ageMs, 1000);
        assert.equal(minuterie.poses.length, 1, 'le relevé périodique démarre');

        await service.tic();                       // même relevé que l'arrivée : rien
        assert.deepEqual(io.envois.map(e => e.evt), [], 'l’état complet de l’arrivée n’est pas renvoyé');
        t += 5000; jeux = [match(1, { secondes: 595 })];
        await service.tic();                       // l'horloge s'écoule : rien
        assert.deepEqual(io.envois.map(e => e.evt), []);

        t += 5000; jeux = [match(1, { secondes: 590, away: 2 })];
        await service.tic();
        assert.deepEqual(io.envois.map(e => e.evt), ['scores:match']);

        jeux = [match(1, { secondes: 590, away: 2 }), match(2)];
        await service.tic();
        assert.deepEqual(io.envois.map(e => e.evt), ['scores:match', 'scores:tout'], 'un match commence : tout repart');

        socket.declencher('scores:arreter');
        await service.tic();
        assert.equal(minuterie.poses[0].arrete, true, 'plus personne : le relevé s’arrête');
    });

    test('une LNH muette ne pousse rien et ne casse rien', async () => {
        const io = fauxIo();
        const service = creerScoresEnDirect({
            io, minuterie: fausseMinuterie(), logger: { error() {} },
            lire: async () => { throw new Error('LNH indisponible'); }
        });
        const socket = fauxSocket(io, 'a');
        service.brancher(socket);
        await socket.declencher('scores:suivre');
        await service.tic();
        assert.equal(socket.recus.length, 0);
        assert.equal(io.envois.length, 0);
    });
});
