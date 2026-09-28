/**
 * Sondage de secours de la salle de repêchage (draftRefresh.js).
 *
 * Il relisait /draft toutes les sept secondes, onglet caché compris ; avec
 * d'autres lectures du même genre, ça a épuisé le transfert réseau mensuel
 * de la base (septembre 2026). Il ne tourne plus que là où il sert : onglet
 * visible, et à pleine cadence seulement quand le socket est tombé.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { chargerFonctions } = require('../fixtures/helpers.js');

const NOMS = ['DRAFT_POLL_TICK_MS', 'DRAFT_POLL_SOCKET_OK_MS', 'draftPollDue', 'startDraftPoll'];

describe('draftPollDue', () => {
    const { draftPollDue } = chargerFonctions('draftRefresh.js', NOMS);

    test('onglet caché : jamais', () => {
        assert.equal(draftPollDue({ hidden: true, socketConnected: false, sinceLastMs: 60000 }), false);
    });

    test('socket tombé : à chaque tic', () => {
        assert.equal(draftPollDue({ hidden: false, socketConnected: false, sinceLastMs: 0 }), true);
    });

    test('socket en ligne : toutes les trente secondes', () => {
        assert.equal(draftPollDue({ hidden: false, socketConnected: true, sinceLastMs: 29999 }), false);
        assert.equal(draftPollDue({ hidden: false, socketConnected: true, sinceLastMs: 30000 }), true);
    });
});

describe('startDraftPoll', () => {
    function monter({ connecte }) {
        let maintenant = 0;
        let tic = null;
        let delai = null;
        const ecouteurs = {};
        const document = {
            hidden: false,
            addEventListener(type, fn) { ecouteurs[type] = fn; }
        };
        const { startDraftPoll } = chargerFonctions('draftRefresh.js', NOMS, {
            Date: { now: () => maintenant },
            setInterval(fn, ms) { tic = fn; delai = ms; return 1; },
            document
        });
        const socket = { connected: connecte };
        let chargements = 0;
        startDraftPoll(() => { chargements += 1; }, socket);
        return {
            document, socket, delai,
            get chargements() { return chargements; },
            avancer(ms) { maintenant += ms; tic(); },
            revenir() { document.hidden = false; ecouteurs.visibilitychange(); }
        };
    }

    test('socket en ligne : un chargement toutes les trente secondes, pas toutes les sept', () => {
        const s = monter({ connecte: true });
        assert.equal(s.delai, 7000);
        for (let i = 0; i < 4; i++) s.avancer(7000);
        assert.equal(s.chargements, 0, '28 s');
        s.avancer(7000);
        assert.equal(s.chargements, 1, '35 s');
    });

    test('socket tombé : sept secondes, comme avant', () => {
        const s = monter({ connecte: false });
        s.avancer(7000);
        s.avancer(7000);
        assert.equal(s.chargements, 2);
    });

    test("onglet caché : rien, puis un chargement dès qu'on revient", () => {
        const s = monter({ connecte: false });
        s.document.hidden = true;
        for (let i = 0; i < 10; i++) s.avancer(7000);
        assert.equal(s.chargements, 0);
        s.revenir();
        assert.equal(s.chargements, 1);
    });
});

test('la salle de repêchage passe par startDraftPoll', () => {
    const racine = path.join(__dirname, '..', '..');
    const salle = fs.readFileSync(path.join(racine, 'draftActif.js'), 'utf8');
    assert.match(salle, /startDraftPoll\(loadDraftData,socket\)/);

    // draftRefresh.js doit précéder draftActif.js : sinon startDraftPoll
    // n'existe pas encore et la salle retombe sur l'ancien sondage.
    const page = fs.readFileSync(path.join(racine, 'draftActif.html'), 'utf8');
    const refresh = page.indexOf('src="draftRefresh.js');
    const salleSrc = page.indexOf('src="draftActif.js');
    assert.ok(refresh > 0 && salleSrc > refresh);
});
