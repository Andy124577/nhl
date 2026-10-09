'use strict';

/**
 * La mémoire de lectures (lib/memoireLectures.js) et le compteur d'écritures
 * de db.js : ce qui permet à une page ouverte de ne plus réveiller Neon, sans
 * jamais servir une valeur que la base aurait pu changer.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { creerMemoireLectures } = require('../../lib/memoireLectures.js');
const db = require('../../db.js');

function compteur() {
    let g = 0;
    return { generation: () => g, ecrire: () => { g += 1; } };
}

function horloge(depart = 1_000_000) {
    let t = depart;
    return { maintenant: () => t, avancer: (ms) => { t += ms; } };
}

describe('mémoire de lectures', () => {
    test('sans compteur ni durée, rien n’est gardé', async () => {
        let calculs = 0;
        for (const options of [{}, { generation: () => 0 }, { dureeMs: 1000 }]) {
            const m = creerMemoireLectures(options);
            await m.obtenir('a', async () => ++calculs);
            await m.obtenir('a', async () => ++calculs);
        }
        assert.equal(calculs, 6);
    });

    test('tant que rien n’est écrit, la base n’est lue qu’une fois', async () => {
        const c = compteur();
        const m = creerMemoireLectures({ generation: c.generation, dureeMs: 60_000 });
        let calculs = 0;
        const lire = async () => { calculs += 1; return { total: calculs }; };

        assert.deepEqual(await m.obtenir('duel', lire), { total: 1 });
        assert.deepEqual(await m.obtenir('duel', lire), { total: 1 });
        assert.equal(calculs, 1);

        c.ecrire();
        assert.deepEqual(await m.obtenir('duel', lire), { total: 2 }, 'une écriture, n’importe laquelle, fait relire');
        assert.equal(calculs, 2);
    });

    test('la durée borne ce que le compteur ne voit pas (console, script)', async () => {
        const c = compteur();
        const h = horloge();
        const m = creerMemoireLectures({ generation: c.generation, dureeMs: 60_000, horloge: h.maintenant });
        let calculs = 0;
        await m.obtenir('a', async () => ++calculs);
        h.avancer(59_999);
        await m.obtenir('a', async () => ++calculs);
        assert.equal(calculs, 1);
        h.avancer(1);
        await m.obtenir('a', async () => ++calculs);
        assert.equal(calculs, 2);
    });

    test('une écriture terminée pendant la lecture ne laisse rien de périmé', async () => {
        const c = compteur();
        const m = creerMemoireLectures({ generation: c.generation, dureeMs: 60_000 });
        let calculs = 0;
        await m.obtenir('a', async () => {
            calculs += 1;
            c.ecrire(); // la valeur lue peut précéder cette écriture
            return 'ancienne';
        });
        assert.equal(await m.obtenir('a', async () => { calculs += 1; return 'fraiche'; }), 'fraiche');
        assert.equal(calculs, 2);
    });

    test('chacun reçoit sa copie : modifier ce qu’on a lu n’abîme pas le suivant', async () => {
        const m = creerMemoireLectures({ generation: () => 0, dureeMs: 60_000 });
        const premier = await m.obtenir('a', async () => ({ lignes: [{ points: 1 }] }));
        premier.lignes[0].points = 99;
        const second = await m.obtenir('a', async () => { throw new Error('ne doit pas relire'); });
        assert.equal(second.lignes[0].points, 1);
        second.lignes.push({ points: 5 });
        assert.equal((await m.obtenir('a', async () => null)).lignes.length, 1);
    });

    test('une rafale simultanée ne lance qu’une lecture', async () => {
        const m = creerMemoireLectures({ generation: () => 0, dureeMs: 60_000 });
        let calculs = 0;
        let liberer;
        const attente = new Promise(r => { liberer = r; });
        const lire = async () => { calculs += 1; await attente; return { v: 1 }; };
        const trois = Promise.all([m.obtenir('a', lire), m.obtenir('a', lire), m.obtenir('a', lire)]);
        liberer();
        const [a, b, c] = await trois;
        assert.equal(calculs, 1);
        assert.deepEqual([a, b, c], [{ v: 1 }, { v: 1 }, { v: 1 }]);
        a.v = 7;
        assert.equal(b.v, 1, 'même la rafale reçoit des copies distinctes');
    });

    test('un échec n’est pas gardé', async () => {
        const m = creerMemoireLectures({ generation: () => 0, dureeMs: 60_000 });
        await assert.rejects(m.obtenir('a', async () => { throw new Error('base indisponible'); }));
        assert.equal(await m.obtenir('a', async () => 'ok'), 'ok');
    });

    test('la mémoire est bornée', async () => {
        const m = creerMemoireLectures({ generation: () => 0, dureeMs: 60_000, max: 2 });
        for (const cle of ['a', 'b', 'c']) await m.obtenir(cle, async () => cle);
        assert.equal(m.taille(), 2);
        let relu = false;
        await m.obtenir('a', async () => { relu = true; return 'a'; });
        assert.equal(relu, true, 'la plus ancienne est repartie');
    });
});

describe('compteur d’écritures de db.js', () => {
    function fauxClient({ echec = false, resultat = { rows: [] } } = {}) {
        const appels = [];
        return {
            appels,
            query(config, valeurs, rappel) {
                appels.push(typeof config === 'string' ? config : config.text);
                const cb = typeof valeurs === 'function' ? valeurs : rappel;
                if (cb) { setImmediate(() => cb(echec ? new Error('x') : null, echec ? undefined : resultat)); return undefined; }
                return echec ? Promise.reject(new Error('x')) : Promise.resolve(resultat);
            }
        };
    }

    test('une lecture ne compte pas ; une écriture compte une fois terminée', async () => {
        let n = 0;
        const client = db.instrumenterClient(fauxClient(), () => { n += 1; });

        await client.query('SELECT 1');
        await client.query('\n   select * from pools');
        await client.query({ text: 'SELECT id FROM pools FOR UPDATE' });
        assert.equal(n, 0);

        const ecriture = client.query('UPDATE pools SET revision = revision + 1');
        assert.equal(n, 0, 'pas avant la fin de l’écriture');
        await ecriture;
        await new Promise(r => setImmediate(r));
        assert.equal(n, 1);

        await client.query('COMMIT');
        await new Promise(r => setImmediate(r));
        assert.equal(n, 2, 'le COMMIT d’une transaction compte');
    });

    test('pool.query passe un rappel : il compte aussi, à la fin', async () => {
        let n = 0;
        const client = db.instrumenterClient(fauxClient(), () => { n += 1; });
        await new Promise((resolve) => {
            client.query('INSERT INTO notifications VALUES ($1)', [1], () => {
                assert.equal(n, 1, 'compté avant que l’appelant reprenne la main');
                resolve();
            });
            assert.equal(n, 0);
        });
    });

    test('une écriture en échec compte quand même (conservateur)', async () => {
        let n = 0;
        const client = db.instrumenterClient(fauxClient({ echec: true }), () => { n += 1; });
        await assert.rejects(client.query('DELETE FROM sessions'));
        await new Promise(r => setImmediate(r));
        assert.equal(n, 1);
    });

    test('une écriture qui ne touche aucune ligne ne compte pas', async () => {
        let n = 0;
        const sansEffet = db.instrumenterClient(
            fauxClient({ resultat: { command: 'UPDATE', rowCount: 0, rows: [] } }), () => { n += 1; });
        await sansEffet.query("DELETE FROM sessions WHERE expires_at < NOW()");
        await new Promise(r => setImmediate(r));
        assert.equal(n, 0, 'promesse : rien purgé, rien compté');

        await new Promise((resolve) => {
            sansEffet.query('UPDATE sessions SET last_seen_at = NOW() WHERE id = $1', [1], (erreur, res) => {
                assert.equal(erreur, null);
                assert.equal(res.rowCount, 0, 'le rappel reçoit le résultat intact');
                resolve();
            });
        });
        assert.equal(n, 0, 'rappel : rien changé, rien compté');

        const avecEffet = db.instrumenterClient(
            fauxClient({ resultat: { command: 'INSERT', rowCount: 3, rows: [] } }), () => { n += 1; });
        await avecEffet.query('INSERT INTO player_game_logs VALUES ($1)', [1]);
        await new Promise(r => setImmediate(r));
        assert.equal(n, 1, 'des lignes écrites comptent');
    });

    test('rowCount 0 ne dispense que les INSERT, UPDATE, DELETE, MERGE', async () => {
        let n = 0;
        // Un WITH … DELETE … SELECT annonce SELECT : il compte, même vide.
        const cte = db.instrumenterClient(
            fauxClient({ resultat: { command: 'SELECT', rowCount: 0, rows: [] } }), () => { n += 1; });
        await cte.query('WITH x AS (DELETE FROM a RETURNING *) SELECT * FROM x');
        // Un COMMIT n'a pas de rowCount : il compte.
        const commit = db.instrumenterClient(
            fauxClient({ resultat: { command: 'COMMIT', rowCount: null, rows: [] } }), () => { n += 1; });
        await commit.query('COMMIT');
        // Plusieurs instructions d'un coup : un tableau de résultats, il compte.
        const multiple = db.instrumenterClient(
            fauxClient({ resultat: [{ command: 'UPDATE', rowCount: 0 }, { command: 'UPDATE', rowCount: 0 }] }),
            () => { n += 1; });
        await multiple.query('UPDATE a SET x = 1; UPDATE b SET y = 2');
        await new Promise(r => setImmediate(r));
        assert.equal(n, 3);
    });

    test('ecritureSansEffet', () => {
        assert.equal(db.ecritureSansEffet({ command: 'MERGE', rowCount: 0 }), true);
        assert.equal(db.ecritureSansEffet({ command: 'DELETE', rowCount: 1 }), false);
        assert.equal(db.ecritureSansEffet({ command: 'BEGIN', rowCount: null }), false);
        assert.equal(db.ecritureSansEffet(undefined), false);
        assert.equal(db.ecritureSansEffet([{ command: 'UPDATE', rowCount: 0 }]), false);
    });

    test('estLecture ne prend pour lecture que SELECT, SHOW, EXPLAIN', () => {
        assert.equal(db.estLecture('SELECT 1'), true);
        assert.equal(db.estLecture('  explain select 1'), true);
        assert.equal(db.estLecture('WITH x AS (DELETE FROM a RETURNING *) SELECT * FROM x'), false);
        assert.equal(db.estLecture('BEGIN'), false);
        assert.equal(db.estLecture(undefined), false);
    });

    test('noterEcritureExterne fait avancer le compteur', () => {
        const avant = db.generationDonnees();
        db.noterEcritureExterne();
        assert.equal(db.generationDonnees(), avant + 1);
    });
});
