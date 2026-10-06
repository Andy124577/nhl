'use strict';

/**
 * La fiche de carrière (lib/ficheCarriere.js) : quand la LNH limite notre
 * adresse (429), la fiche s'ouvre quand même — relancée une fois, ou servie
 * depuis la dernière copie connue.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { creerMemoireFiches, lireAvecRelance, obtenirFiche, delaiDeRelance, passager } = require('../../lib/ficheCarriere.js');

function horloge(depart = 1_000_000) {
    let t = depart;
    return { maintenant: () => t, avancer: (ms) => { t += ms; } };
}

/** Une LNH qui rend, dans l'ordre, les réponses données ; une Error est levée. */
function lnh(...reponses) {
    const appels = [];
    const lire = async (url, options) => {
        appels.push({ url, options });
        const r = reponses.shift();
        if (r instanceof Error) throw r;
        return {
            ok: r.status >= 200 && r.status < 300,
            status: r.status,
            headers: { get: nom => (nom === 'retry-after' ? (r.retryAfter ?? null) : null) },
            json: async () => r.corps
        };
    };
    return { lire, appels };
}

function sansAttente() {
    const attentes = [];
    return { attendre: async ms => { attentes.push(ms); }, attentes };
}

describe('mémoire des fiches', () => {
    test('une fiche rangée est fraîche, puis périmée mais toujours lisible', () => {
        const h = horloge();
        const m = creerMemoireFiches({ fraicheMs: 1000, horloge: h.maintenant });
        assert.equal(m.lire(8478402), null);

        m.ranger(8478402, { playerName: 'Connor McDavid' });
        assert.deepEqual(m.lire('8478402'), { fiche: { playerName: 'Connor McDavid' }, fraiche: true },
            'le nombre de la collecte et la chaîne de la route désignent le même joueur');

        h.avancer(1000);
        assert.deepEqual(m.lire(8478402), { fiche: { playerName: 'Connor McDavid' }, fraiche: false });
    });

    test('ranger de nouveau rafraîchit la fiche', () => {
        const h = horloge();
        const m = creerMemoireFiches({ fraicheMs: 1000, horloge: h.maintenant });
        m.ranger(1, { v: 1 });
        h.avancer(5000);
        m.ranger(1, { v: 2 });
        assert.deepEqual(m.lire(1), { fiche: { v: 2 }, fraiche: true });
        assert.equal(m.taille(), 1);
    });

    test('au-delà de la borne, la fiche la moins récemment servie part', () => {
        const m = creerMemoireFiches({ max: 2 });
        m.ranger(1, 'a');
        m.ranger(2, 'b');
        m.lire(1);
        m.ranger(3, 'c');
        assert.equal(m.taille(), 2);
        assert.equal(m.lire(2), null);
        assert.equal(m.lire(1).fiche, 'a');
        assert.equal(m.lire(3).fiche, 'c');
    });

    test('réglages par défaut : une fiche rangée à l’instant est fraîche', () => {
        const m = creerMemoireFiches();
        m.ranger(7, 'x');
        assert.equal(m.lire(7).fraiche, true);
    });
});

describe('délai de relance', () => {
    test('Retry-After en secondes, borné à 3 s', () => {
        assert.equal(delaiDeRelance('1'), 1000);
        assert.equal(delaiDeRelance('0'), 0);
        assert.equal(delaiDeRelance('60'), 3000, 'quelqu’un attend la fiche');
        assert.equal(delaiDeRelance('-5'), 0);
    });

    test('Retry-After en date HTTP', () => {
        const maintenant = Date.parse('Tue, 06 Oct 2026 01:32:43 GMT');
        assert.equal(delaiDeRelance('Tue, 06 Oct 2026 01:32:45 GMT', maintenant), 2000);
        assert.equal(delaiDeRelance('Tue, 06 Oct 2026 01:00:00 GMT', maintenant), 0);
    });

    test('absent ou illisible : le délai par défaut', () => {
        for (const entete of [null, undefined, '', 'bientôt']) {
            assert.equal(delaiDeRelance(entete), 1500);
        }
    });
});

describe('lecture avec relance', () => {
    test('les refus passagers : limite, panne, réseau — pas un 404 ni un 400', () => {
        assert.equal(passager(429), true);
        assert.equal(passager(503), true);
        assert.equal(passager(0), true);
        assert.equal(passager(404), false);
        assert.equal(passager(400), false);
    });

    test('une réponse du premier coup ne fait pas attendre', async () => {
        const n = lnh({ status: 200, corps: { id: 1 } });
        const a = sansAttente();
        assert.deepEqual(await lireAvecRelance('u', { lire: n.lire, attendre: a.attendre }), { status: 200, data: { id: 1 } });
        assert.equal(n.appels.length, 1);
        assert.equal(a.attentes.length, 0);
        assert.ok(n.appels[0].options.signal, 'un appel qui pend ne bloque pas la fiche indéfiniment');
    });

    test('un 429 est relancé une fois, après le délai demandé', async () => {
        const n = lnh({ status: 429, retryAfter: '2' }, { status: 200, corps: { id: 1 } });
        const a = sansAttente();
        assert.deepEqual(await lireAvecRelance('u', { lire: n.lire, attendre: a.attendre }), { status: 200, data: { id: 1 } });
        assert.equal(n.appels.length, 2);
        assert.deepEqual(a.attentes, [2000]);
    });

    test('une erreur réseau est relancée aussi', async () => {
        const n = lnh(new Error('ECONNRESET'), { status: 200, corps: { id: 1 } });
        const a = sansAttente();
        assert.deepEqual(await lireAvecRelance('u', { lire: n.lire, attendre: a.attendre }), { status: 200, data: { id: 1 } });
        assert.deepEqual(a.attentes, [1500]);
    });

    test('deux refus : le dernier statut, sans troisième appel', async () => {
        const n = lnh({ status: 429 }, { status: 502 });
        const a = sansAttente();
        assert.deepEqual(await lireAvecRelance('u', { lire: n.lire, attendre: a.attendre }), { status: 502 });
        assert.equal(n.appels.length, 2);
    });

    test('la LNH muette deux fois : statut 0', async () => {
        const n = lnh(new Error('timeout'), new Error('timeout'));
        const a = sansAttente();
        assert.deepEqual(await lireAvecRelance('u', { lire: n.lire, attendre: a.attendre }), { status: 0 });
    });

    test('un 404 n’est pas relancé : le joueur n’existe pas', async () => {
        const n = lnh({ status: 404 });
        const a = sansAttente();
        assert.deepEqual(await lireAvecRelance('u', { lire: n.lire, attendre: a.attendre }), { status: 404 });
        assert.equal(n.appels.length, 1);
        assert.equal(a.attentes.length, 0);
    });

    test('une réponse sans en-têtes lisibles garde le délai par défaut', async () => {
        const reponses = [{ ok: false, status: 503 }, { ok: true, status: 200, json: async () => 'ok' }];
        const a = sansAttente();
        const r = await lireAvecRelance('u', { lire: async () => reponses.shift(), attendre: a.attendre });
        assert.deepEqual(r, { status: 200, data: 'ok' });
        assert.deepEqual(a.attentes, [1500]);
    });

    test('réglages par défaut : fetch et une vraie attente', async (t) => {
        const original = globalThis.fetch;
        const appels = [];
        globalThis.fetch = async (url) => {
            appels.push(url);
            return appels.length === 1
                ? { ok: false, status: 429, headers: { get: () => '0' } }
                : { ok: true, status: 200, json: async () => ({ id: 2 }) };
        };
        t.after(() => { globalThis.fetch = original; });
        assert.deepEqual(await lireAvecRelance('https://exemple.test/x'), { status: 200, data: { id: 2 } });
        assert.deepEqual(appels, ['https://exemple.test/x', 'https://exemple.test/x']);
    });
});

describe('ce que /player-career répond', () => {
    /** La route, avec une LNH qui rend `reponses` dans l'ordre. */
    function route({ reponses = [], fraicheMs = 1000 } = {}) {
        const h = horloge();
        const memoire = creerMemoireFiches({ fraicheMs, horloge: h.maintenant });
        const appels = [];
        const journal = { avertis: [], erreurs: [], warn(m) { this.avertis.push(m); }, error(m) { this.erreurs.push(m); } };
        const options = {
            memoire,
            mettreEnForme: (id, data) => ({ playerId: String(id), nom: data.nom }),
            lire: async (url) => { appels.push(url); return reponses.shift(); },
            journal
        };
        return { h, memoire, appels, journal, demander: id => obtenirFiche(id, options) };
    }

    test('la LNH répond : la fiche mise en forme, gardée pour la suivante', async () => {
        const r = route({ reponses: [{ status: 200, data: { nom: 'Connor McDavid' } }] });
        assert.deepEqual(await r.demander('8478402'), { status: 200, corps: { playerId: '8478402', nom: 'Connor McDavid' } });
        assert.deepEqual(r.appels, ['https://api-web.nhle.com/v1/player/8478402/landing']);

        assert.deepEqual(await r.demander('8478402'), { status: 200, corps: { playerId: '8478402', nom: 'Connor McDavid' } });
        assert.equal(r.appels.length, 1, 'rouvrir la fiche ne rappelle pas la LNH');
    });

    test('la fiche rangée par la collecte sert sans appel', async () => {
        const r = route();
        r.memoire.ranger(8478402, { nom: 'de la collecte' });
        assert.deepEqual(await r.demander('8478402'), { status: 200, corps: { nom: 'de la collecte' } });
        assert.equal(r.appels.length, 0);
    });

    test('périmée, la fiche est relue à la LNH', async () => {
        const r = route({ reponses: [{ status: 200, data: { nom: 'neuve' } }] });
        r.memoire.ranger(1, { nom: 'vieille' });
        r.h.avancer(1000);
        assert.deepEqual((await r.demander('1')).corps, { playerId: '1', nom: 'neuve' });
        assert.equal(r.memoire.lire(1).fraiche, true);
    });

    test('la LNH limite : la fiche gardée sert, même vieille — l’incident du 5 octobre', async () => {
        const r = route({ reponses: [{ status: 429 }] });
        r.memoire.ranger(1, { nom: 'd’hier' });
        r.h.avancer(24 * 60 * 60 * 1000);
        assert.deepEqual(await r.demander('1'), { status: 200, corps: { nom: 'd’hier' } });
        assert.equal(r.journal.avertis.length, 1);
        assert.match(r.journal.avertis[0], /429/);
    });

    test('la LNH limite et rien n’est gardé : 502, avec le statut de la LNH', async () => {
        const r = route({ reponses: [{ status: 429 }] });
        assert.deepEqual(await r.demander('1'), { status: 502, corps: { message: 'NHL API unavailable', upstreamStatus: 429 } });
        assert.match(r.journal.erreurs[0], /429/);
    });

    test('la LNH injoignable : le journal le dit, plutôt que « 0 »', async () => {
        const r = route({ reponses: [{ status: 0 }] });
        assert.equal((await r.demander('1')).status, 502);
        assert.match(r.journal.erreurs[0], /injoignable/);
    });

    test('un 404 reste un 404, même avec une fiche gardée', async () => {
        const r = route({ reponses: [{ status: 404 }] });
        r.memoire.ranger(1, { nom: 'vieille' });
        r.h.avancer(1000);
        assert.deepEqual(await r.demander('1'), { status: 404, corps: { message: 'Player not found' } });
    });

    test('lecture et journal par défaut', async (t) => {
        const original = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: false, status: 404 });
        t.after(() => { globalThis.fetch = original; });
        const memoire = creerMemoireFiches();
        assert.equal((await obtenirFiche('1', { memoire, mettreEnForme: () => null })).status, 404);
    });
});
