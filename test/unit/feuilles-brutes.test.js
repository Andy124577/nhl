'use strict';

/**
 * Les feuilles de match brutes partagées par le direct des points et
 * /tonight-boxscores (services/feuillesBrutes.js) : une feuille lue pour
 * l'un sert à l'autre, à l'âge que chacun tolère.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { creerFeuillesBrutes, ageTolere, TAILLE_MAX } = require('../../services/feuillesBrutes.js');

function monter({ reponse = id => ({ ok: true, json: async () => ({ id }) }) } = {}) {
    let t = 1_000_000;
    const appels = [];
    const feuilles = creerFeuillesBrutes({
        maintenant: () => t,
        fetchImpl: async (url) => {
            const id = Number(url.match(/gamecenter\/(\d+)\/boxscore$/)[1]);
            appels.push(id);
            return reponse(id);
        }
    });
    return { feuilles, appels, avancer: ms => { t += ms; } };
}

describe('feuilles brutes partagées', () => {
    test('une feuille assez fraîche pour l’appelant ne rappelle pas la LNH', async () => {
        const { feuilles, appels, avancer } = monter();
        await feuilles.lire(2026020050, { ageMaxMs: 20000 });
        avancer(10000);
        await feuilles.lire(2026020050, { ageMaxMs: 20000 });
        assert.deepEqual(appels, [2026020050]);

        avancer(15000);
        await feuilles.lire(2026020050, { ageMaxMs: 20000 });
        assert.equal(appels.length, 2, 'plus vieille que toléré : relue');
    });

    test('chaque appelant dit son âge : le direct veut plus frais que la page du soir', async () => {
        const { feuilles, appels, avancer } = monter();
        await feuilles.lire(1, { ageMaxMs: 20000 });   // /tonight-boxscores
        avancer(3000);
        await feuilles.lire(1, { ageMaxMs: 5000 });    // direct des points : sert la même
        assert.equal(appels.length, 1);
        avancer(3000);
        await feuilles.lire(1, { ageMaxMs: 5000 });
        assert.equal(appels.length, 2);
    });

    test('deux demandes simultanées partagent la même requête', async () => {
        const { feuilles, appels } = monter();
        const [a, b] = await Promise.all([feuilles.lire(7), feuilles.lire(7)]);
        assert.equal(appels.length, 1);
        assert.equal(a, b);
    });

    test('la LNH ne répond pas : la dernière copie plutôt qu’un trou', async () => {
        let panne = false;
        const { feuilles, avancer } = monter({
            reponse: id => {
                if (panne) throw new Error('réseau');
                return { ok: true, json: async () => ({ id, copie: 'ancienne' }) };
            }
        });
        await feuilles.lire(9);
        panne = true;
        avancer(60000);
        assert.deepEqual(await feuilles.lire(9), { id: 9, copie: 'ancienne' });
    });

    test('une erreur HTTP garde aussi la copie ; sans copie, null', async () => {
        let statut = 200;
        const { feuilles } = monter({
            reponse: id => ({ ok: statut === 200, json: async () => ({ id }) })
        });
        statut = 503;
        assert.equal(await feuilles.lire(3), null);
        statut = 200;
        await feuilles.lire(3);
        statut = 503;
        assert.deepEqual(await feuilles.lire(3), { id: 3 });
    });

    test('jamais lue, et la LNH muette : l’erreur remonte', async () => {
        const { feuilles } = monter({ reponse: () => { throw new Error('réseau'); } });
        await assert.rejects(feuilles.lire(4), /réseau/);
    });

    test('luLe dit quand la feuille en main a été lue', async () => {
        const { feuilles, avancer } = monter();
        assert.equal(feuilles.luLe(5), 0);
        avancer(1234);
        await feuilles.lire(5);
        assert.equal(feuilles.luLe(5), 1_001_234);
    });

    test('le cache garde au plus TAILLE_MAX feuilles, les plus récentes', async () => {
        const { feuilles, appels } = monter();
        for (let id = 1; id <= TAILLE_MAX + 1; id++) await feuilles.lire(id, { ageMaxMs: 60000 });
        await feuilles.lire(TAILLE_MAX + 1, { ageMaxMs: 60000 });
        assert.equal(appels.length, TAILLE_MAX + 1, 'la plus récente est restée');
        await feuilles.lire(1, { ageMaxMs: 60000 });
        assert.equal(appels.length, TAILLE_MAX + 2, 'la plus ancienne est sortie');
    });

    test('l’âge toléré suit l’état du match', () => {
        assert.equal(ageTolere('LIVE'), 20000);
        assert.equal(ageTolere('CRIT'), 20000);
        assert.equal(ageTolere('FINAL'), 60000);
        assert.equal(ageTolere('OFF'), 30 * 60 * 1000);
        assert.equal(ageTolere('FUT'), 20000);
    });
});
