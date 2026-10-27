'use strict';

/**
 * Le compteur de tentatives de mot de passe (lib/limiteTentatives.js).
 *
 * Aucune route ne comptait les échecs : `/login` acceptait autant d'essais
 * qu'on voulait en envoyer.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { creerLimiteTentatives, adresseClient, refuserTropDeTentatives, OUBLI_MS } = require('../../lib/limiteTentatives.js');
const { creerReponse } = require('../fixtures/routeHarness.js');

const MINUTE = 60 * 1000;

function banc() {
    let maintenant = 1_000_000;
    const limite = creerLimiteTentatives({ horloge: () => maintenant });
    return { limite, avancer: (ms) => { maintenant += ms; } };
}

test('cinq essais libres par compte, puis une attente qui double jusqu au plafond', () => {
    const { limite, avancer } = banc();
    const qui = { compte: 'alice', adresse: '1.1.1.1' };

    for (let i = 0; i < 5; i++) {
        assert.equal(limite.attente('connexion', qui), 0, `essai ${i + 1} permis`);
        limite.echec('connexion', qui);
    }
    assert.equal(limite.attente('connexion', qui), 0, 'le sixième essai est encore permis');
    limite.echec('connexion', qui);
    assert.equal(limite.attente('connexion', qui), MINUTE, 'sixième échec : une minute');

    const attentes = [];
    for (let i = 0; i < 6; i++) {
        avancer(limite.attente('connexion', qui));
        limite.echec('connexion', qui);
        attentes.push(limite.attente('connexion', qui) / MINUTE);
    }
    assert.deepEqual(attentes, [2, 4, 8, 15, 15, 15]);
});

test('changer d adresse ne rend aucun essai sur le compte visé', () => {
    const { limite } = banc();
    for (let i = 0; i < 6; i++) limite.echec('connexion', { compte: 'Alice', adresse: `10.0.0.${i}` });
    assert.ok(limite.attente('connexion', { compte: 'alice', adresse: '10.0.0.99' }) > 0, 'casse ignorée, adresse neuve');
});

test('une adresse qui essaie tous les comptes est arrêtée, sans bloquer les autres adresses', () => {
    const { limite } = banc();
    for (let i = 0; i < 30; i++) limite.echec('connexion', { compte: `compte${i}`, adresse: '6.6.6.6' });
    assert.equal(limite.attente('connexion', { compte: 'neuf', adresse: '6.6.6.6' }), 0, 'trente essais libres');
    limite.echec('connexion', { compte: 'neuf', adresse: '6.6.6.6' });
    assert.equal(limite.attente('connexion', { compte: 'autre', adresse: '6.6.6.6' }), 15 * MINUTE);
    assert.equal(limite.attente('connexion', { compte: 'autre', adresse: '7.7.7.7' }), 0);
});

test('une réussite efface le compteur du compte, pas celui de l adresse', () => {
    const { limite } = banc();
    for (let i = 0; i < 31; i++) limite.echec('connexion', { compte: `c${i % 3}`, adresse: '5.5.5.5' });
    limite.reussite('connexion', { compte: 'c0', adresse: '5.5.5.5' });
    assert.ok(limite.attente('connexion', { compte: 'c0', adresse: '5.5.5.5' }) > 0, 'l adresse reste bloquée');
    assert.equal(limite.attente('connexion', { compte: 'c0', adresse: '8.8.8.8' }), 0, 'le compte est libéré');
});

test('un compteur oublié depuis une heure repart de zéro', () => {
    const { limite, avancer } = banc();
    const qui = { compte: 'bob', adresse: '2.2.2.2' };
    for (let i = 0; i < 6; i++) limite.echec('connexion', qui);
    assert.ok(limite.attente('connexion', qui) > 0);
    avancer(OUBLI_MS + 1);
    assert.equal(limite.attente('connexion', qui), 0);
    limite.echec('connexion', qui);
    assert.equal(limite.attente('connexion', qui), 0, 'le premier échec suivant est de nouveau libre');
});

test('les espaces ne se mélangent pas : un pool ne bloque pas une connexion', () => {
    const { limite } = banc();
    for (let i = 0; i < 12; i++) limite.echec('pool', { compte: 'mon pool', adresse: '3.3.3.3' });
    assert.ok(limite.attente('pool', { compte: 'mon pool', adresse: '4.4.4.4' }) > 0);
    assert.equal(limite.attente('connexion', { compte: 'mon pool', adresse: '3.3.3.3' }), 0);
    assert.throws(() => limite.attente('inconnu', { compte: 'x' }), /Espace de tentatives inconnu/);
});

test('l adresse vient de CF-Connecting-IP avant X-Forwarded-For, que le client peut falsifier', () => {
    assert.equal(adresseClient({ headers: { 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } }), '9.9.9.9');
    assert.equal(adresseClient({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } }), '1.2.3.4');
    assert.equal(adresseClient({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
    assert.equal(adresseClient({ headers: {} }), 'inconnue');
});

test('le refus dit combien de minutes attendre, et le pose dans Retry-After', () => {
    const res = creerReponse();
    refuserTropDeTentatives(res, 61 * 1000);
    assert.equal(res.statusCode, 429);
    assert.equal(res.entetes['Retry-After'], '61');
    assert.equal(res.body.code, 'trop_de_tentatives');
    assert.match(res.body.message, /2 minutes/);
});
