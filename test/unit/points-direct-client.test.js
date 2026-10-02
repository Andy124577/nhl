'use strict';

/**
 * Le côté page des points du soir (pointsDirect.js) : les suivis se
 * comptent — la fiche d'un joueur peut suivre le temps d'être ouverte sans
 * couper la page —, et de nouveaux relevés de minuit sont relus par la page
 * AVANT que le direct qui les complète ne s'y applique.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const FZLive = require('../../lib/pointsEnDirect.js');
const { chargerModuleNavigateur } = require('../fixtures/helpers.js');

function fauxSocket() {
    const ecoutes = new Map();
    const emis = [];
    return {
        connected: true, emis,
        on: (evt, fn) => ecoutes.set(evt, fn),
        emit: evt => emis.push(evt),
        pousser: (evt, charge) => ecoutes.get(evt)(charge)
    };
}

function charger() {
    const socket = fauxSocket();
    const window = {
        location: { hostname: 'fantazy.ca', origin: 'https://fantazy.ca' },
        fzSocketPartage: () => socket,
        FZLive
    };
    const document = { visibilityState: 'visible', hidden: false, addEventListener() {} };
    chargerModuleNavigateur('pointsDirect.js', {
        window, document, FZLive, setInterval, clearInterval, Promise,
        fetch: async () => { throw new Error('pas de sondage attendu'); }
    });
    return { direct: window.FZPointsDirect, socket };
}

const attendre = () => new Promise(r => setImmediate(r));

describe('les suivis se comptent', () => {
    test('la fiche d’un joueur qui se ferme ne coupe pas le direct de la page', () => {
        const { direct, socket } = charger();
        direct.suivre();                        // la page
        direct.suivre();                        // la fiche ouverte
        assert.deepEqual(socket.emis, ['points:suivre'], 'un seul abonnement au serveur');

        direct.arreter();                       // la fiche se ferme
        assert.ok(!socket.emis.includes('points:arreter'), 'la page suit encore');

        direct.arreter();
        assert.equal(socket.emis.at(-1), 'points:arreter');
    });

    test('un arreter() de trop ne rend pas le compte négatif', () => {
        const { direct, socket } = charger();
        direct.arreter();
        direct.suivre();
        assert.equal(socket.emis.at(-1), 'points:suivre');
    });
});

describe('nouveaux relevés de minuit', () => {
    const MCDAVID = { playerId: 8478402, playerName: 'Connor McDavid', position: 'C', goals: 5, assists: 10, points: 15 };

    function monter({ relecture = async () => {} } = {}) {
        const { direct, socket } = charger();
        const page = { base: [MCDAVID], journal: [] };
        direct.surNouveauReleve(async () => {
            page.journal.push('relecture');
            await relecture(page);
        });
        direct.surChangement(() => {
            page.journal.push('changement');
            page.vu = direct.joueurs(page.base)[0].points;
        });
        direct.suivre();
        return { direct, socket, page };
    }

    test('premier envoi : appliqué tel quel, rien à relire', async () => {
        const { socket, page } = monter();
        socket.pousser('points:direct', { releve: 'r1', joueurs: { [MCDAVID.playerId]: { b: 1 } }, clubs: {} });
        await attendre();
        assert.deepEqual(page.journal, ['changement']);
        assert.equal(page.vu, 16);
    });

    test('la page relit ses relevés avant d’y ajouter le nouveau direct', async () => {
        const { socket, page } = monter({
            // Le relevé de minuit a pris le but de la veille : 16 points au
            // relevé, plus rien au direct.
            relecture: async p => { await attendre(); p.base = [{ ...MCDAVID, goals: 6, points: 16 }]; }
        });
        socket.pousser('points:direct', { releve: 'r1', joueurs: { [MCDAVID.playerId]: { b: 1 } }, clubs: {} });
        await attendre();
        assert.equal(page.vu, 16);

        socket.pousser('points:direct', { releve: 'r2', joueurs: {}, clubs: {} });
        await attendre(); await attendre();
        assert.deepEqual(page.journal, ['changement', 'relecture', 'changement']);
        assert.equal(page.vu, 16, 'le but de la veille ne disparaît pas du total');
    });

    test('un envoi plus récent pendant la relecture : relu une fois, appliqué une fois, le plus récent', async () => {
        let liberer;
        const { socket, page } = monter({
            relecture: p => new Promise(r => { liberer = () => { p.base = [{ ...MCDAVID, goals: 6, points: 16 }]; r(); }; })
        });
        socket.pousser('points:direct', { releve: 'r1', joueurs: {}, clubs: {} });
        await attendre();

        socket.pousser('points:direct', { releve: 'r2', joueurs: {}, clubs: {} });
        socket.pousser('points:direct', { releve: 'r2', joueurs: { [MCDAVID.playerId]: { p: 1 } }, clubs: {} });
        await attendre();
        liberer();
        await attendre(); await attendre();

        assert.deepEqual(page.journal, ['changement', 'relecture', 'changement']);
        assert.equal(page.vu, 17, 'le relevé relu, plus l’aide de ce soir');
    });

    test('même relevé : rien à relire', async () => {
        const { socket, page } = monter();
        socket.pousser('points:direct', { releve: 'r1', joueurs: {}, clubs: {} });
        socket.pousser('points:direct', { releve: 'r1', joueurs: { [MCDAVID.playerId]: { b: 1 } }, clubs: {} });
        await attendre();
        assert.deepEqual(page.journal, ['changement', 'changement']);
    });
});
