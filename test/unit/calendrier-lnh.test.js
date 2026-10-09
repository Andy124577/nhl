'use strict';

/**
 * Le calendrier de la LNH (services/calendrierLNH.js) : relire la journée en
 * cours ne doit pas réécrire en base, à chaque fois, les jours passés de la
 * même semaine — une écriture toutes les cinq minutes gardait Neon éveillé.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { creerCalendrierLNH } = require('../../services/calendrierLNH.js');

const AUJOURDHUI = new Date('2026-10-08T18:00:00-04:00');

function semaine({ hier = 3 } = {}) {
    const match = (etat) => ({ gameState: etat, gameType: 2 });
    return {
        ok: true,
        json: async () => ({
            gameWeek: [
                { date: '2026-10-06', games: [match('OFF'), match('OFF')] },
                { date: '2026-10-07', games: Array.from({ length: hier }, () => match('OFF')) },
                { date: '2026-10-08', games: [match('OFF'), match('LIVE'), match('FUT')] }
            ]
        })
    };
}

function fausseDb() {
    const ecrits = [];
    return {
        ecrits,
        async loadCachedStats() { return null; },
        async saveCachedStats(cle, valeur) { ecrits.push([cle, valeur.matchs]); }
    };
}

test('les jours passés ne se réécrivent que si leur compte change', async () => {
    const db = fausseDb();
    let reponse = semaine();
    const calendrier = creerCalendrierLNH({ db, fetchImpl: async () => reponse, maintenant: () => AUJOURDHUI, logger: { error() {} } });

    assert.equal(await calendrier.matchsTermines('2026-10-08'), 1);
    assert.equal(db.ecrits.length, 2, 'les deux jours passés, une fois');

    // La relecture du jour, cinq minutes plus tard : rien n'a changé derrière.
    calendrier.oublier();
    assert.equal(await calendrier.matchsTermines('2026-10-08'), 1);
    assert.equal(db.ecrits.length, 2, 'aucune écriture de plus');

    // Une correction de la LNH sur hier : celle-là s'écrit.
    reponse = semaine({ hier: 4 });
    calendrier.oublier();
    await calendrier.matchsTermines('2026-10-08');
    assert.deepEqual(db.ecrits.slice(2), [[db.ecrits[1][0], 4]]);
});

test('une écriture en échec sera retentée', async () => {
    let echoue = true;
    const ecrits = [];
    const db = {
        async loadCachedStats() { return null; },
        async saveCachedStats(cle, valeur) {
            if (echoue) throw new Error('base indisponible');
            ecrits.push([cle, valeur.matchs]);
        }
    };
    const calendrier = creerCalendrierLNH({ db, fetchImpl: async () => semaine(), maintenant: () => AUJOURDHUI, logger: { error() {} } });

    await calendrier.matchsTermines('2026-10-08');
    assert.equal(ecrits.length, 0);
    echoue = false;
    calendrier.oublier();
    await calendrier.matchsTermines('2026-10-08');
    assert.equal(ecrits.length, 2, 'rien n’avait été noté comme rangé');
});

test('des journées demandées en même temps ne rappellent pas la LNH pour la même semaine', async () => {
    const db = fausseDb();
    let appels = 0;
    const calendrier = creerCalendrierLNH({
        db,
        fetchImpl: async () => { appels += 1; await new Promise(r => setImmediate(r)); return semaine(); },
        maintenant: () => AUJOURDHUI,
        logger: { error() {} }
    });

    const comptes = await Promise.all(['2026-10-06', '2026-10-07', '2026-10-08'].map(j => calendrier.matchsTermines(j)));

    assert.deepEqual(comptes, [2, 3, 1]);
    assert.equal(appels, 1, 'la semaine du premier appel a servi aux deux autres');
});

test('un appel en échec ne bloque pas la file des suivants', async () => {
    let appels = 0;
    const calendrier = creerCalendrierLNH({
        fetchImpl: async () => { appels += 1; if (appels === 1) throw new Error('réseau'); return semaine(); },
        maintenant: () => AUJOURDHUI,
        logger: { error() {} }
    });

    const [premier, second] = await Promise.all([calendrier.matchsTermines('2026-10-08'), calendrier.matchsTermines('2026-10-07')]);
    assert.equal(premier, null, 'on ne sait pas, plutôt que zéro');
    assert.equal(second, 3);
});
