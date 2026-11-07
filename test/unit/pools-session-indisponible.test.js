/**
 * « Tu n'as pas de pool » affiché à un membre.
 *
 * Quand la base se réveille (Neon), la lecture de la session pouvait échouer
 * en silence : la requête passait alors pour celle d'un visiteur, /draft
 * renvoyait les vues publiques, et l'accueil montrait « Ton premier pool
 * commence ici » à quelqu'un qui en avait. Ce qu'on vérifie : la lecture est
 * réessayée une fois ; si elle échoue encore, /draft refuse (503) au lieu de
 * répondre comme à un visiteur ; et /draft dit à la page si la requête était
 * connectée, pour qu'un cookie expiré ne passe pas pour « aucun pool ».
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { creerAuth } = require('../../middleware/auth.js');
const routesPools = require('../../routes/pools.js');
const { monterRoutes, poolNeuf } = require('../fixtures/routeHarness.js');

function fausseDb(echecs) {
    const sessions = new Map();
    let prochain = 1;
    const db = {
        lectures: 0,
        async createSession(userId, tokenHash, expiresAt) {
            const ligne = { id: prochain++, user_id: userId, created_at: new Date(), expires_at: expiresAt };
            sessions.set(tokenHash, { ...ligne, last_seen_at: new Date() });
            return ligne;
        },
        async getSessionByTokenHash(tokenHash) {
            db.lectures += 1;
            if (db.lectures <= echecs) throw new Error('Connection terminated unexpectedly');
            const s = sessions.get(tokenHash);
            if (!s) return null;
            return {
                id: s.id, userId: s.user_id, tokenHash, createdAt: s.created_at, lastSeenAt: s.last_seen_at,
                expiresAt: s.expires_at, revokedAt: null, username: 'alice', isAdmin: false,
                avatarUrl: '', impersonatedBy: null, impersonatorUsername: null
            };
        },
        async touchSession() {},
        async revokeSession() { return false; },
        async revokeAllSessionsForUser() { return 0; },
        async purgeExpiredSessions() { return 0; }
    };
    return db;
}

const reponse = () => ({ entetes: {}, setHeader(nom, valeur) { this.entetes[nom] = valeur; } });

async function requeteAvecCookie(echecs) {
    const db = fausseDb(echecs);
    const auth = creerAuth({ db, usePostgres: true, secure: false });
    const ouverture = reponse();
    await auth.ouvrirSession(ouverture, { id: 7, username: 'alice' }, { headers: {} });
    const cookie = String(ouverture.entetes['Set-Cookie']).split(';')[0];
    const req = { headers: { cookie } };
    const erreurConsole = console.error;
    console.error = () => {};
    try { await auth.sessionMiddleware(req, reponse(), () => {}); }
    finally { console.error = erreurConsole; }
    return { req, db };
}

test('une lecture de session ratée (base en réveil) est réessayée une fois', async () => {
    const { req, db } = await requeteAvecCookie(1);
    assert.equal(req.auth?.username, 'alice');
    assert.equal(req.authIndisponible, false);
    assert.equal(db.lectures, 2);
});

test('deux lectures ratées : la requête le dit au lieu de passer pour un visiteur', async () => {
    const { req } = await requeteAvecCookie(2);
    assert.equal(req.auth, null);
    assert.equal(req.authIndisponible, true);
});

test('sans cookie, rien n est signalé : c est un vrai visiteur', async () => {
    const auth = creerAuth({ db: fausseDb(5), usePostgres: true, secure: false });
    const req = { headers: {} };
    await auth.sessionMiddleware(req, reponse(), () => {});
    assert.equal(req.auth, null);
    assert.equal(req.authIndisponible, false);
});

test('/draft refuse (503) quand la session n a pas pu être vérifiée', async () => {
    const h = monterRoutes([routesPools], { pools: { Ligue: poolNeuf() } });
    const res = await h.appeler('GET', '/draft', { authIndisponible: true });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.Ligue, undefined, 'aucune vue publique servie à la place');
});

test('/draft dit à la page si la requête était connectée', async () => {
    const h = monterRoutes([routesPools], { pools: { Ligue: poolNeuf() } });
    const visiteur = await h.appeler('GET', '/draft');
    assert.equal(visiteur.entetes['X-Fz-Connecte'], '0');
    const membre = await h.appeler('GET', '/draft', { auth: { username: 'alice', userId: 'alice', isAdmin: false } });
    assert.equal(membre.entetes['X-Fz-Connecte'], '1');
});
