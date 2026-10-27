'use strict';

/**
 * Le mot de passe d'un pool se devinait sans limite : /join-team et
 * /join-clan comparaient chaque essai, autant qu'on en envoyait. Il tient en
 * quatre caractères. Ils passent maintenant par le compteur de tentatives
 * (lib/limiteTentatives.js, espace « pool »).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const routesPools = require('../../routes/pools.js');
const { monterRoutes, poolNeuf } = require('../fixtures/routeHarness.js');

const CARL = { username: 'carl', userId: 'carl', isAdmin: false };
const DORA = { username: 'dora', userId: 'dora', isAdmin: false };

async function poolProtege() {
    return { ...poolNeuf({ maxPlayers: 6 }), passwordHash: await bcrypt.hash('ours', 4) };
}

for (const route of ['/join-team', '/join-clan']) {
    test(`${route} : dix essais libres, un onzième raté, puis 429 — même avec le bon mot de passe`, async () => {
        const h = monterRoutes(routesPools, { pools: { Protege: await poolProtege() } });
        const entrer = (password, auth = CARL, adresse = '1.1.1.1') => h.appeler('POST', route, {
            body: { name: 'Protege', teamName: 'Les Visiteurs', password },
            auth,
            headers: { 'cf-connecting-ip': adresse }
        });

        for (let i = 0; i < 11; i++) {
            const res = await entrer(`faux${i}`);
            assert.equal(res.statusCode, 401, `essai ${i + 1}`);
        }
        const bloque = await entrer('ours');
        assert.equal(bloque.statusCode, 429);
        assert.equal(bloque.body.code, 'trop_de_tentatives');

        const autreCompte = await entrer('ours', DORA, '2.2.2.2');
        assert.equal(autreCompte.statusCode, 429, 'compté par pool : ni le compte ni l adresse ne rachètent des essais');
        const membres = Object.values(h.lirePool('Protege').teams).flatMap(e => e.members || []);
        assert.deepEqual(membres, ['alice'], 'personne n est entré');
    });
}

test('le bon mot de passe ouvre le pool tant que la limite n est pas atteinte', async () => {
    const h = monterRoutes(routesPools, { pools: { Protege: await poolProtege() } });
    for (let i = 0; i < 3; i++) {
        await h.appeler('POST', '/join-team', { body: { name: 'Protege', teamName: 'Les Visiteurs', password: 'non' }, auth: CARL });
    }
    const res = await h.appeler('POST', '/join-team', { body: { name: 'Protege', teamName: 'Les Visiteurs', password: 'ours' }, auth: CARL });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
});
