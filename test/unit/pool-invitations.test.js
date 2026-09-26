'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const routesPools = require('../../routes/pools.js');
const routesInvitations = require('../../routes/invitations.js');
const poolOps = require('../../lib/poolOps.js');
const authz = require('../../lib/authz.js');
const { creerCoffre, clesDepuisEnvironnement, deriverCle } = require('../../lib/poolSecret.js');
const { monterRoutes, poolNeuf, poolTermine } = require('../fixtures/routeHarness.js');

const ALICE = { username: 'alice', userId: 'alice', isAdmin: false };
const BOB = { username: 'bob', userId: 'bob', isAdmin: false };
const CARL = { username: 'carl', userId: 'carl', isAdmin: false };
const DORA = { username: 'dora', userId: 'dora', isAdmin: false };

const coffre = creerCoffre([deriverCle('cle-de-test')]);

function banc(pools, options = {}) {
    return monterRoutes([routesPools, routesInvitations], {
        pools,
        users: options.users,
        ctxExtra: { coffre }
    });
}

// ───────────────────────────── Coffre ─────────────────────────────

test('le coffre relit ce qu il a chiffré, et rien d autre', () => {
    const jeton = coffre.chiffrer('hockey2026');
    assert.notEqual(jeton, 'hockey2026');
    assert.ok(!jeton.includes('hockey'), 'le clair ne doit pas transparaître');
    assert.equal(coffre.dechiffrer(jeton), 'hockey2026');
    assert.notEqual(coffre.chiffrer('hockey2026'), jeton, 'un vecteur neuf à chaque chiffrement');

    const altere = jeton.slice(0, -4) + (jeton.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    assert.equal(coffre.dechiffrer(altere), null, 'un jeton modifié est refusé');
    assert.equal(coffre.dechiffrer('n importe quoi'), null);
    assert.equal(coffre.dechiffrer(null), null);
});

test('une nouvelle clé en tête ne rend pas illisibles les anciens mots de passe', () => {
    const ancien = creerCoffre([deriverCle('ancienne')]);
    const jeton = ancien.chiffrer('secret');
    const rotation = creerCoffre([deriverCle('nouvelle'), deriverCle('ancienne')]);
    assert.equal(rotation.dechiffrer(jeton), 'secret');
    assert.equal(creerCoffre([deriverCle('autre')]).dechiffrer(jeton), null);
});

test('les clés viennent de l environnement, sinon d un fichier écrit une fois', () => {
    assert.equal(clesDepuisEnvironnement({ POOL_PASSWORD_KEY: 'k', DATABASE_URL: 'postgres://x' }).length, 2);
    assert.equal(clesDepuisEnvironnement({ DATABASE_URL: 'postgres://x' }).length, 1);

    let disque = null;
    const acces = {
        cheminFichier: 'k.key',
        lireFichier: () => disque,
        ecrireFichier: (_chemin, contenu) => { disque = contenu; }
    };
    const premiere = clesDepuisEnvironnement({}, acces);
    assert.ok(disque, 'la clé locale est conservée');
    const seconde = clesDepuisEnvironnement({}, acces);
    assert.ok(premiere[0].equals(seconde[0]), 'le redémarrage relit la même clé');
});

test('la vue des membres ne porte ni l empreinte ni la copie chiffrée', () => {
    const vue = authz.vueMembre('Ligue', { ...poolNeuf(), passwordHash: 'h', passwordSecret: 's' });
    assert.equal(vue.passwordHash, undefined);
    assert.equal(vue.passwordSecret, undefined);
    assert.equal(vue.hasPassword, true);
});

// ───────────────────────────── Mot de passe du pool ─────────────────────────────

test('la personne qui crée le pool relit son mot de passe ; personne d autre', async () => {
    const h = banc({});
    const cree = await h.appeler('POST', '/create-clan', {
        auth: ALICE, body: { name: 'Les Élans', maxPlayers: 4, password: 'glace123' }
    });
    assert.equal(cree.statusCode, 200);
    assert.ok(h.lirePool('Les Élans').passwordHash);
    assert.ok(h.lirePool('Les Élans').passwordSecret);
    assert.ok(!JSON.stringify(cree.body).includes('passwordSecret'));

    const lu = await h.appeler('GET', '/api/pools/Les Élans/password', { auth: ALICE });
    assert.equal(lu.statusCode, 200);
    assert.deepEqual(lu.body, { hasPassword: true, recuperable: true, password: 'glace123' });
    assert.equal(lu.entetes['Cache-Control'], 'no-store');

    await h.appeler('POST', '/join-team', { auth: BOB, body: { name: 'Les Élans', teamName: 'Bob', password: 'glace123' } });
    const membre = await h.appeler('GET', '/api/pools/Les Élans/password', { auth: BOB });
    assert.equal(membre.statusCode, 403, 'un simple membre ne relit pas le mot de passe');
});

test('un pool protégé avant la copie chiffrée dit qu il n y a rien à relire', async () => {
    const h = banc({ Ligue: { ...poolNeuf(), passwordHash: '$2a$10$ancienneempreinte' } });
    const lu = await h.appeler('GET', '/api/pools/Ligue/password', { auth: ALICE });
    assert.deepEqual(lu.body, { hasPassword: true, recuperable: false, password: null });
});

test('changer le mot de passe ferme l ancien ; le retirer ouvre le pool', async () => {
    const h = banc({ Ligue: poolNeuf() });

    const refuse = await h.appeler('POST', '/api/pools/Ligue/password', { auth: BOB, body: { password: 'volé1' } });
    assert.equal(refuse.statusCode, 403);

    const court = await h.appeler('POST', '/api/pools/Ligue/password', { auth: ALICE, body: { password: 'abc' } });
    assert.equal(court.statusCode, 400);

    const pose = await h.appeler('POST', '/api/pools/Ligue/password', { auth: ALICE, body: { password: 'nouveau1' } });
    assert.equal(pose.statusCode, 200);
    assert.equal(pose.body.recuperable, true);
    assert.equal((await h.appeler('GET', '/api/pools/Ligue/password', { auth: ALICE })).body.password, 'nouveau1');

    const mauvais = await h.appeler('POST', '/join-team', { auth: BOB, body: { name: 'Ligue', teamName: 'Bob', password: 'autre' } });
    assert.equal(mauvais.statusCode, 401);

    const retire = await h.appeler('POST', '/api/pools/Ligue/password', { auth: ALICE, body: { password: '' } });
    assert.equal(retire.statusCode, 200);
    assert.equal(h.lirePool('Ligue').passwordHash, undefined);
    assert.equal(h.lirePool('Ligue').passwordSecret, undefined);
    const libre = await h.appeler('POST', '/join-team', { auth: BOB, body: { name: 'Ligue', teamName: 'Bob' } });
    assert.equal(libre.statusCode, 200);
});

// ───────────────────────────── Règles d'invitation ─────────────────────────────

test('on n invite ni un membre, ni deux fois, ni dans un pool complet ou déjà repêché', () => {
    const pool = poolNeuf({ maxPlayers: 3 });
    assert.equal(poolOps.inviter(pool, { username: 'alice', invitedBy: 'alice' }).ok, false);
    assert.equal(poolOps.inviter(pool, { username: 'bob', invitedBy: 'alice', maintenant: 0 }).ok, true);
    assert.equal(poolOps.inviter(pool, { username: 'bob', invitedBy: 'alice' }).code, 409);
    assert.equal(pool.invitations[0].invitedAt, new Date(0).toISOString());

    const plein = poolNeuf({ maxPlayers: 2, membres: { 'Équipe 1': ['alice'], 'Équipe 2': ['bob'] } });
    assert.equal(poolOps.inviter(plein, { username: 'carl', invitedBy: 'alice' }).code, 409);

    const repeche = poolTermine();
    assert.equal(poolOps.inviter(repeche, { username: 'carl', invitedBy: 'alice' }).code, 409);
});

test('les invitations en attente sont plafonnées', () => {
    const pool = poolNeuf({ maxPlayers: 10 });
    for (let i = 0; i < poolOps.INVITATIONS_MAX; i++) {
        assert.equal(poolOps.inviter(pool, { username: `u${i}`, invitedBy: 'alice' }).ok, true);
    }
    assert.equal(poolOps.inviter(pool, { username: 'deTrop', invitedBy: 'alice' }).code, 409);
});

test('entrer dans le pool, par l invitation ou par la porte, consomme l invitation', () => {
    const pool = poolNeuf();
    poolOps.inviter(pool, { username: 'bob', invitedBy: 'alice' });
    poolOps.inviter(pool, { username: 'carl', invitedBy: 'alice' });
    assert.equal(poolOps.inscrireParticipant(pool, { username: 'bob', teamName: 'Bob' }).ok, true);
    assert.deepEqual(pool.invitations.map(i => i.username), ['carl']);
    poolOps.retirerInvitation(pool, 'carl');
    assert.equal(pool.invitations, undefined, 'plus rien à garder : le champ part');
});

// ───────────────────────────── Recherche ─────────────────────────────

test('seule l administration du pool cherche des comptes, et le début du nom passe devant', async () => {
    const users = ['alice', 'bob', 'Bobette', 'jimbo', 'Élodie', 'carl'].map(n => ({ username: n, id: n }));
    const h = banc({ Ligue: poolNeuf({ membres: { 'Équipe 1': ['alice'], 'Équipe 2': ['bob'] } }) }, { users });

    assert.equal((await h.appeler('GET', '/api/pools/Ligue/invite-search', { auth: BOB, query: { q: 'bo' } })).statusCode, 403);
    assert.equal((await h.appeler('GET', '/api/pools/Ligue/invite-search', { query: { q: 'bo' } })).statusCode, 401);

    const court = await h.appeler('GET', '/api/pools/Ligue/invite-search', { auth: ALICE, query: { q: 'b' } });
    assert.deepEqual(court.body.resultats, [], 'une lettre listerait tout le site');

    const res = await h.appeler('GET', '/api/pools/Ligue/invite-search', { auth: ALICE, query: { q: 'BO' } });
    assert.deepEqual(res.body.resultats.map(r => r.username), ['bob', 'Bobette', 'jimbo']);
    assert.equal(res.body.resultats[0].statut, 'membre');
    assert.equal(res.body.resultats[1].statut, null);

    const accents = await h.appeler('GET', '/api/pools/Ligue/invite-search', { auth: ALICE, query: { q: 'elo' } });
    assert.deepEqual(accents.body.resultats.map(r => r.username), ['Élodie']);

    const soi = await h.appeler('GET', '/api/pools/Ligue/invite-search', { auth: ALICE, query: { q: 'ali' } });
    assert.deepEqual(soi.body.resultats, [], 'on ne se trouve pas soi-même');
    assert.ok(!JSON.stringify(res.body).includes('password'));
});

// ───────────────────────────── Parcours complet ─────────────────────────────

test('inviter prévient la personne, qui voit l invitation et entre sans le mot de passe', async () => {
    const h = banc({ Ligue: { ...poolNeuf(), passwordHash: '$2a$10$empreinte' } });

    const refuse = await h.appeler('POST', '/api/pools/Ligue/invitations', { auth: BOB, body: { username: 'carl' } });
    assert.equal(refuse.statusCode, 403);
    const inconnu = await h.appeler('POST', '/api/pools/Ligue/invitations', { auth: ALICE, body: { username: 'zoe' } });
    assert.equal(inconnu.statusCode, 404);

    const envoi = await h.appeler('POST', '/api/pools/Ligue/invitations', { auth: ALICE, body: { username: 'carl' } });
    assert.equal(envoi.statusCode, 200);
    assert.ok(h.etat.emissions.some(([evt, salle, charge]) =>
        evt === 'poolInvitation' && salle === 'user:carl' && charge.poolName === 'Ligue'),
        'la fenêtre d invitation surgit en direct chez la personne invitée');
    assert.equal((await h.appeler('POST', '/api/pools/Ligue/invitations', { auth: ALICE, body: { username: 'carl' } })).statusCode, 409);

    const miennes = await h.appeler('GET', '/api/invitations', { auth: CARL });
    assert.equal(miennes.body.invitations.length, 1);
    assert.equal(miennes.body.invitations[0].poolName, 'Ligue');
    assert.equal(miennes.body.invitations[0].invitedBy, 'alice');
    assert.equal(miennes.body.invitations[0].nomSuggere, 'carl');
    assert.equal((await h.appeler('GET', '/api/invitations', { auth: DORA })).body.invitations.length, 0);

    const intrus = await h.appeler('POST', '/api/invitations/accept', { auth: DORA, body: { poolName: 'Ligue' } });
    assert.equal(intrus.statusCode, 404, 'sans invitation, pas d entrée sans mot de passe');

    const grossier = await h.appeler('POST', '/api/invitations/accept', { auth: CARL, body: { poolName: 'Ligue', teamName: 'nom<>' } });
    assert.equal(grossier.statusCode, 400);

    const accepte = await h.appeler('POST', '/api/invitations/accept', { auth: CARL, body: { poolName: 'Ligue', teamName: 'Les Castors' } });
    assert.equal(accepte.statusCode, 200);
    assert.equal(accepte.body.teamName, 'Les Castors');
    assert.deepEqual(h.lirePool('Ligue').teams['Les Castors'].members, ['carl']);
    assert.equal(h.lirePool('Ligue').invitations, undefined);
    assert.equal((await h.appeler('GET', '/api/invitations', { auth: CARL })).body.invitations.length, 0);
});

test('refuser ou annuler retire l invitation des deux côtés', async () => {
    const h = banc({ Ligue: poolNeuf() });
    await h.appeler('POST', '/api/pools/Ligue/invitations', { auth: ALICE, body: { username: 'bob' } });
    await h.appeler('POST', '/api/pools/Ligue/invitations', { auth: ALICE, body: { username: 'carl' } });

    const refus = await h.appeler('POST', '/api/invitations/decline', { auth: BOB, body: { poolName: 'Ligue' } });
    assert.equal(refus.statusCode, 200);
    assert.deepEqual(h.lirePool('Ligue').invitations.map(i => i.username), ['carl']);
    const revision = h.revisionDe('Ligue');
    assert.equal((await h.appeler('POST', '/api/invitations/decline', { auth: BOB, body: { poolName: 'Ligue' } })).statusCode, 200);
    assert.equal(h.revisionDe('Ligue'), revision, 'un deuxième refus ne réécrit rien');

    assert.equal((await h.appeler('POST', '/api/pools/Ligue/invitations/cancel', { auth: CARL, body: { username: 'carl' } })).statusCode, 403);
    const annule = await h.appeler('POST', '/api/pools/Ligue/invitations/cancel', { auth: ALICE, body: { username: 'carl' } });
    assert.equal(annule.statusCode, 200);
    assert.ok(h.etat.emissions.some(([evt, salle, charge]) =>
        evt === 'poolInvitation' && salle === 'user:carl' && charge.action === 'annulee'));
    assert.equal((await h.appeler('GET', '/api/invitations', { auth: CARL })).body.invitations.length, 0);
    assert.equal((await h.appeler('POST', '/api/pools/Ligue/invitations/cancel', { auth: ALICE, body: { username: 'carl' } })).statusCode, 404);
});

test('une invitation vers un pool dont le repêchage a commencé n est plus servie', async () => {
    const pool = poolTermine();
    pool.invitations = [{ username: 'carl', invitedBy: 'alice', invitedAt: '2026-09-01T00:00:00.000Z' }];
    const h = banc({ Ligue: pool });
    assert.equal((await h.appeler('GET', '/api/invitations', { auth: CARL })).body.invitations.length, 0);
    assert.equal((await h.appeler('POST', '/api/invitations/accept', { auth: CARL, body: { poolName: 'Ligue' } })).statusCode, 409);
});

test('les membres voient les invitations en attente dans /draft', async () => {
    const h = banc({ Ligue: poolNeuf() });
    await h.appeler('POST', '/api/pools/Ligue/invitations', { auth: ALICE, body: { username: 'bob' } });
    const vue = await h.appeler('GET', '/draft', { auth: ALICE });
    assert.deepEqual(vue.body.Ligue.invitations.map(i => i.username), ['bob']);
    const etranger = await h.appeler('GET', '/draft', { auth: BOB });
    assert.equal(etranger.body.Ligue.invitations, undefined, 'la personne invitée n est pas encore membre');
});
