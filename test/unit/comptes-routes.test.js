'use strict';

/**
 * Les routes de compte (routes/identity.js) : inscription, connexion,
 * changement de mot de passe.
 *
 * Trois failles épinglées ici :
 *   1. `/signup` acceptait n'importe quel nom de 40 caractères ou moins — un
 *      nom porteur de HTML s'affichait ensuite chez les autres membres ;
 *   2. aucune route ne comptait les échecs de mot de passe ;
 *   3. il n'existait aucun moyen de changer un mot de passe.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const routesIdentite = require('../../routes/identity.js');
const { monterRoutes } = require('../fixtures/routeHarness.js');

const MOT_DE_PASSE = 'Rondelle-Bleue-27';

/** Un faux `auth` qui retient les sessions ouvertes et révoquées. */
function fauxAuth() {
    const journal = { ouvertes: [], revoquees: [] };
    return {
        journal,
        requireAuth: (req, res, next) => (req.auth ? next() : res.status(401).json({ code: 'non_authentifie' })),
        requireBascule: (req, res, next) => next(),
        async ouvrirSession(res, compte) { journal.ouvertes.push(compte); },
        async fermerSession() {},
        async revoquerTout(userId) { journal.revoquees.push(userId); }
    };
}

/** Le module d'identité en mode fichier, sur une liste de comptes en mémoire. */
async function banc({ comptes = null } = {}) {
    let utilisateurs = comptes || [
        // Coût 4 : la comparaison reste rapide dans les tests.
        { username: 'alice', password: await bcrypt.hash(MOT_DE_PASSE, 4), isAdmin: false },
        { username: 'gina', password: null, isAdmin: false, googleSub: 'g-1' }
    ];
    const auth = fauxAuth();
    const h = monterRoutes(routesIdentite, {
        ctxExtra: {
            auth,
            usePostgres: false,
            chargerUtilisateurs: async () => utilisateurs,
            sauvegarderUtilisateurs: async (liste) => { utilisateurs = liste; }
        }
    });
    const depuis = (adresse) => ({ 'cf-connecting-ip': adresse });
    return {
        ...h,
        journal: auth.journal,
        utilisateurs: () => utilisateurs,
        connexion: (username, password, adresse = '1.1.1.1') =>
            h.appeler('POST', '/login', { body: { username, password }, headers: depuis(adresse) }),
        depuis
    };
}

// ───────────────────────────── Inscription ─────────────────────────────

test('/signup refuse un nom porteur de HTML, même envoyé sans passer par le formulaire', async () => {
    const h = await banc();
    const res = await h.appeler('POST', '/signup', { body: { username: '<b>salut</b>', password: MOT_DE_PASSE } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Lettres, chiffres et underscores/);
    assert.equal(h.utilisateurs().length, 2, 'aucun compte créé');
});

test('/signup refuse un mot de passe courant ou trop long en octets', async () => {
    const h = await banc();
    let res = await h.appeler('POST', '/signup', { body: { username: 'nouveau', password: 'Hockey' } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /trop courant/);

    res = await h.appeler('POST', '/signup', { body: { username: 'nouveau', password: 'é'.repeat(40) } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /72 octets/);
});

test('/signup crée le compte quand le nom et le mot de passe passent', async () => {
    const h = await banc();
    const res = await h.appeler('POST', '/signup', { body: { username: 'nouveau_1', password: MOT_DE_PASSE } });
    assert.equal(res.statusCode, 200);
    const cree = h.utilisateurs().find(u => u.username === 'nouveau_1');
    assert.ok(cree && await bcrypt.compare(MOT_DE_PASSE, cree.password));
});

// ───────────────────────────── Tentatives ─────────────────────────────

test('/login : cinq essais libres, un sixième raté, puis 429 — même avec le bon mot de passe', async () => {
    const h = await banc();
    for (let i = 0; i < 6; i++) {
        const res = await h.connexion('alice', `faux-${i}`);
        assert.equal(res.statusCode, 401, `essai ${i + 1}`);
    }
    const bloque = await h.connexion('alice', MOT_DE_PASSE);
    assert.equal(bloque.statusCode, 429);
    assert.equal(bloque.body.code, 'trop_de_tentatives');
    assert.ok(Number(bloque.entetes['Retry-After']) > 0);

    const ailleurs = await h.connexion('alice', MOT_DE_PASSE, '2.2.2.2');
    assert.equal(ailleurs.statusCode, 429, 'une autre adresse ne rend aucun essai');
});

test('/login : un nom inexistant est limité de la même façon — le refus ne dit pas qui existe', async () => {
    const h = await banc();
    const statuts = [];
    for (let i = 0; i < 7; i++) statuts.push((await h.connexion('personne', 'n-importe')).statusCode);
    assert.deepEqual(statuts, [401, 401, 401, 401, 401, 401, 429]);
});

test('/login : une réussite remet le compteur du compte à zéro', async () => {
    const h = await banc();
    for (let i = 0; i < 5; i++) await h.connexion('alice', 'faux');
    assert.equal((await h.connexion('alice', MOT_DE_PASSE)).statusCode, 200);
    for (let i = 0; i < 5; i++) {
        assert.equal((await h.connexion('alice', 'faux')).statusCode, 401, `essai libre ${i + 1} après la réussite`);
    }
});

test('/account/export compte ses confirmations ratées comme des connexions', async () => {
    const h = await banc();
    const session = { username: 'alice', userId: 'alice', isAdmin: false };
    const statuts = [];
    for (let i = 0; i < 7; i++) {
        const res = await h.appeler('POST', '/account/export', {
            body: { password: 'faux' }, auth: session, headers: h.depuis('3.3.3.3')
        });
        statuts.push(res.statusCode);
    }
    assert.deepEqual(statuts, [401, 401, 401, 401, 401, 401, 429]);
});

// ───────────────────────────── Changer de mot de passe ─────────────────────────────

const ALICE = { username: 'alice', userId: 'alice', isAdmin: false };

test('changer son mot de passe ferme toutes les sessions et rouvre celle-ci', async () => {
    const h = await banc();
    const nouveau = 'Patinoire-Ouverte-9';
    const res = await h.appeler('POST', '/account/password', {
        body: { currentPassword: MOT_DE_PASSE, newPassword: nouveau }, auth: ALICE
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(h.journal.revoquees, ['alice']);
    assert.equal(h.journal.ouvertes.at(-1).username, 'alice');

    assert.equal((await h.connexion('alice', MOT_DE_PASSE)).statusCode, 401, 'l ancien ne passe plus');
    assert.equal((await h.connexion('alice', nouveau)).statusCode, 200, 'le nouveau passe');
});

test('changer son mot de passe exige l actuel, et refuse un nouveau trop faible', async () => {
    const h = await banc();
    let res = await h.appeler('POST', '/account/password', {
        body: { currentPassword: 'faux', newPassword: 'Patinoire-Ouverte-9' }, auth: ALICE
    });
    assert.equal(res.statusCode, 401);

    res = await h.appeler('POST', '/account/password', {
        body: { currentPassword: MOT_DE_PASSE, newPassword: '123456' }, auth: ALICE
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /trop courant/);

    res = await h.appeler('POST', '/account/password', {
        body: { currentPassword: MOT_DE_PASSE, newPassword: MOT_DE_PASSE }, auth: ALICE
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /différent/);
    assert.deepEqual(h.journal.revoquees, [], 'aucune session fermée');
});

test('un compte Google n a pas de mot de passe à changer', async () => {
    const h = await banc();
    const res = await h.appeler('POST', '/account/password', {
        body: { currentPassword: 'x', newPassword: 'Patinoire-Ouverte-9' },
        auth: { username: 'gina', userId: 'gina', isAdmin: false }
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'compte_google');
});

test('pas de changement de mot de passe pendant une bascule d administration', async () => {
    const h = await banc();
    const res = await h.appeler('POST', '/account/password', {
        body: { currentPassword: MOT_DE_PASSE, newPassword: 'Patinoire-Ouverte-9' },
        auth: { ...ALICE, impersonatedBy: 'admin-1', impersonatorUsername: 'admin' }
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'bascule');
});

test('sans session, la route est fermée', async () => {
    const h = await banc();
    const res = await h.appeler('POST', '/account/password', { body: { currentPassword: 'a', newPassword: 'b' } });
    assert.equal(res.statusCode, 401);
});
