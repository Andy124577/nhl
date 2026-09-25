'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const google = require('../../lib/googleAuth.js');
const routesGoogle = require('../../routes/google.js');
const routesIdentite = require('../../routes/identity.js');

const CLIENT_ID = 'client-test.apps.googleusercontent.com';
const SECRET = 'secret-de-test';
const MAINTENANT = Date.parse('2026-09-25T12:00:00Z');

/** Un jeton d'identité tel que Google le rend (signature factice : non lue). */
function jeton(revendications = {}) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return [
        b64({ alg: 'RS256', typ: 'JWT' }),
        b64({
            iss: 'https://accounts.google.com',
            aud: CLIENT_ID,
            sub: '1100220033',
            email: 'jean@example.com',
            name: 'Jérôme Tremblay',
            given_name: 'Jérôme',
            exp: Math.floor(MAINTENANT / 1000) + 3600,
            ...revendications
        }),
        'signature'
    ].join('.');
}

// ───────────────────────────── Module pur ─────────────────────────────

test('PKCE : le défi est le SHA-256 base64url du vérificateur', () => {
    const { verificateur, defi } = google.genererPkce();
    const attendu = crypto.createHash('sha256').update(verificateur).digest('base64url');
    assert.equal(defi, attendu);
    assert.ok(verificateur.length >= 43, 'RFC 7636 : au moins 43 caractères');
});

test("l'adresse d'autorisation porte l'état, le défi et les portées OpenID", () => {
    const url = new URL(google.urlAutorisation({
        clientId: CLIENT_ID, redirectUri: 'https://fz.test/auth/google/callback', etat: 'ETAT', defi: 'DEFI'
    }));
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('state'), 'ETAT');
    assert.equal(url.searchParams.get('code_challenge'), 'DEFI');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.match(url.searchParams.get('scope'), /\bopenid\b/);
});

test("le jeton d'identité : accepté quand émetteur, audience et expiration concordent", () => {
    const profil = google.lireJetonIdentite(jeton(), { clientId: CLIENT_ID, maintenant: MAINTENANT });
    assert.deepEqual(profil, { sub: '1100220033', email: 'jean@example.com', nom: 'Jérôme Tremblay', prenom: 'Jérôme' });
});

test("le jeton d'identité : refusé pour un autre client, un autre émetteur, expiré, sans sub ou abîmé", () => {
    const lire = (j) => google.lireJetonIdentite(j, { clientId: CLIENT_ID, maintenant: MAINTENANT });
    assert.equal(lire(jeton({ aud: 'autre-site.apps.googleusercontent.com' })), null, 'audience');
    assert.equal(lire(jeton({ iss: 'https://evil.example' })), null, 'émetteur');
    assert.equal(lire(jeton({ exp: Math.floor(MAINTENANT / 1000) - 120 })), null, 'expiré');
    assert.equal(lire(jeton({ sub: '' })), null, 'sub vide');
    assert.equal(lire('pas.un-jeton'), null, 'malformé');
    assert.equal(lire(undefined), null);
});

test("l'identité en attente : relue telle quelle, refusée falsifiée, périmée ou sous un autre secret", () => {
    const profil = { sub: '42', email: 'a@b.c', nom: 'A', prenom: 'A' };
    const sceau = google.scellerAttente(profil, SECRET, MAINTENANT);

    assert.equal(google.lireAttente(sceau, SECRET, MAINTENANT + 1000).sub, '42');
    assert.equal(google.lireAttente(sceau, 'autre-secret', MAINTENANT), null);
    assert.equal(google.lireAttente(sceau, SECRET, MAINTENANT + google.DUREE_ATTENTE_S * 1000 + 1), null);

    // Réécrire le sub sans pouvoir resigner.
    const [, signature] = sceau.split('.');
    const faux = Buffer.from(JSON.stringify({ sub: 'victime', exp: MAINTENANT + 60000 })).toString('base64url');
    assert.equal(google.lireAttente(`${faux}.${signature}`, SECRET, MAINTENANT), null);
    assert.equal(google.lireAttente('', SECRET, MAINTENANT), null);
});

test('le nom proposé vient du prénom, sans accents, jamais du courriel', () => {
    assert.equal(google.nomPropose({ prenom: 'Jérôme', nom: 'Jérôme Tremblay', email: 'jt@x.com' }), 'Jerome');
    assert.equal(google.nomPropose({ prenom: 'Al', nom: 'Al Côté' }), 'AlCote', 'prénom trop court : nom complet');
    assert.equal(google.nomPropose({ prenom: '', nom: '', email: 'jean.tremblay@x.com' }), '');
});

test('le nom proposé est suffixé quand il est pris', async () => {
    const pris = new Set(['Jerome']);
    const nom = await google.nomDisponible('Jerome', async (n) => pris.has(n), { hasard: () => 0.5 });
    assert.match(nom, /^Jerome\d{2,3}$/);
    assert.equal(await google.nomDisponible('Libre', async () => false), 'Libre');
});

test("les règles du nom d'utilisateur sont celles du formulaire d'inscription", () => {
    assert.equal(google.erreurNom('abc_123'), null);
    assert.ok(google.erreurNom('ab'));
    assert.ok(google.erreurNom('a'.repeat(21)));
    assert.ok(google.erreurNom('pas bon'));
    assert.ok(google.erreurNom(''));
});

// ───────────────────────────── Routes ─────────────────────────────

/** Faux Express, faux magasin de comptes (mode fichier), faux Google. */
function banc({ utilisateurs = [], config = { clientId: CLIENT_ID, clientSecret: SECRET }, reponseGoogle } = {}) {
    const routes = [];
    const app = {};
    for (const m of ['get', 'post']) {
        app[m] = (chemin, ...gestionnaires) => routes.push({ methode: m.toUpperCase(), chemin, gestionnaires });
    }

    const sessions = [];
    const auth = {
        async ouvrirSession(res, compte) {
            sessions.push(compte);
            res.setHeader('Set-Cookie', 'fz_session=jeton; Path=/; HttpOnly');
        },
        async fermerSession() {},
        async revoquerTout() {},
        requireAuth: (req, res, next) => (req.auth ? next() : res.status(401).json({})),
        requireBascule: (req, res, next) => next()
    };
    const echanges = [];
    const ctx = {
        auth,
        usePostgres: false,
        chargerUtilisateurs: async () => utilisateurs,
        sauvegarderUtilisateurs: async (liste) => { utilisateurs = liste; },
        store: { lireTous: async () => ({}) },
        diffusion: { resynchroniserUtilisateur: async () => {} },
        racine: '.',
        logger: { log() {}, warn() {}, error() {} }
    };

    const identite = routesIdentite.monter(app, ctx);
    routesGoogle.monter(app, {
        ...ctx,
        identite,
        secure: false,
        config,
        fetch: async (url, options) => {
            echanges.push({ url, options });
            return reponseGoogle || { ok: true, json: async () => ({ id_token: jeton({ exp: Math.floor(Date.now() / 1000) + 3600 }) }) };
        }
    });

    async function appeler(methode, cheminComplet, { cookies = {}, body = {}, auth: session = null } = {}) {
        const [chemin, qs] = cheminComplet.split('?');
        const route = routes.find(r => r.methode === methode && r.chemin === chemin);
        assert.ok(route, `route absente : ${methode} ${chemin}`);
        const entetes = {};
        const res = {
            statusCode: 200, body: undefined, redirection: null,
            status(c) { this.statusCode = c; return this; },
            json(b) { this.body = b; return this; },
            redirect(url) { this.statusCode = 302; this.redirection = url; return this; },
            setHeader(n, v) { entetes[n.toLowerCase()] = v; },
            getHeader(n) { return entetes[n.toLowerCase()]; },
            cookies() { return [].concat(entetes['set-cookie'] || []); }
        };
        const req = {
            method: methode,
            query: Object.fromEntries(new URLSearchParams(qs || '')),
            body,
            auth: session,
            protocol: 'http',
            headers: {
                host: 'fz.test',
                cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
            }
        };
        for (const g of route.gestionnaires) {
            let suite = false;
            await g(req, res, () => { suite = true; });
            if (!suite) break;
        }
        return res;
    }

    const valeurCookie = (res, nom) => {
        const ligne = res.cookies().find(c => c.startsWith(`${nom}=`));
        return ligne ? ligne.split(';')[0].slice(nom.length + 1) : undefined;
    };

    return { appeler, valeurCookie, sessions, echanges, utilisateurs: () => utilisateurs };
}

/** Le cookie d'aller tel que /auth/google le pose. */
async function aller(h, depuis = '') {
    const res = await h.appeler('GET', `/auth/google${depuis ? `?depuis=${depuis}` : ''}`);
    const etatCookie = h.valeurCookie(res, google.COOKIE_ETAT);
    const etat = new URL(res.redirection).searchParams.get('state');
    return { res, etatCookie, etat };
}

test('sans clés Google, la connexion Google est annoncée inactive et renvoie vers la page', async () => {
    const h = banc({ config: {} });
    assert.deepEqual((await h.appeler('GET', '/auth/google/config')).body, { enabled: false });
    const res = await h.appeler('GET', '/auth/google?depuis=signup');
    assert.equal(res.redirection, '/signup.html?google=indisponible');
});

test("l'aller pose l'état en cookie et part chez Google avec ce même état", async () => {
    const h = banc();
    const { res, etatCookie, etat } = await aller(h);
    assert.match(res.redirection, /^https:\/\/accounts\.google\.com\//);
    assert.equal(etatCookie.split('.')[0], etat);
    assert.equal(new URL(res.redirection).searchParams.get('redirect_uri'), 'http://fz.test/auth/google/callback');
    assert.match(res.cookies()[0], /HttpOnly/);
    assert.match(res.cookies()[0], /Path=\/auth\/google/);
});

test('un retour dont l\'état ne correspond pas est refusé, sans échange de code', async () => {
    const h = banc();
    const { etatCookie } = await aller(h);
    const res = await h.appeler('GET', '/auth/google/callback?state=autre&code=abc',
        { cookies: { [google.COOKIE_ETAT]: etatCookie } });
    assert.equal(res.redirection, '/login.html?google=expire');
    assert.equal(h.echanges.length, 0);
    assert.equal(h.sessions.length, 0);
});

test('un refus chez Google ramène à la page de départ avec « annulé »', async () => {
    const h = banc();
    const { etatCookie, etat } = await aller(h, 'signup');
    const res = await h.appeler('GET', `/auth/google/callback?state=${etat}&error=access_denied`,
        { cookies: { [google.COOKIE_ETAT]: etatCookie } });
    assert.equal(res.redirection, '/signup.html?google=annule');
});

test('compte Google connu : la session est ouverte et le cookie d\'état effacé', async () => {
    const h = banc({ utilisateurs: [{ username: 'jerome', password: null, isAdmin: false, googleSub: '1100220033' }] });
    const { etatCookie, etat } = await aller(h);
    const res = await h.appeler('GET', `/auth/google/callback?state=${etat}&code=CODE`,
        { cookies: { [google.COOKIE_ETAT]: etatCookie } });

    assert.equal(res.redirection, '/login.html?google=ok');
    assert.equal(h.sessions[0].username, 'jerome');
    assert.ok(h.valeurCookie(res, 'fz_session'), 'la session est posée');
    assert.equal(h.valeurCookie(res, google.COOKIE_ETAT), '', "et l'état est effacé, pas écrasé par la session");

    const corps = new URLSearchParams(h.echanges[0].options.body);
    assert.equal(corps.get('code'), 'CODE');
    assert.equal(corps.get('code_verifier'), etatCookie.split('.')[1], 'PKCE : le vérificateur accompagne le code');
});

test('compte Google inconnu : identité mise en attente, puis nom proposé à partir du prénom', async () => {
    const h = banc({ utilisateurs: [{ username: 'Jerome', password: 'x', isAdmin: false }] });
    const { etatCookie, etat } = await aller(h);
    const retour = await h.appeler('GET', `/auth/google/callback?state=${etat}&code=CODE`,
        { cookies: { [google.COOKIE_ETAT]: etatCookie } });

    assert.equal(retour.redirection, '/signup.html?google=nouveau');
    assert.equal(h.sessions.length, 0, 'aucune session avant le choix du nom');
    const attente = h.valeurCookie(retour, google.COOKIE_ATTENTE);
    assert.ok(attente);

    const res = await h.appeler('GET', '/auth/google/attente', { cookies: { [google.COOKIE_ATTENTE]: attente } });
    assert.equal(res.body.email, 'jean@example.com');
    assert.match(res.body.suggestion, /^Jerome\d+$/, '« Jerome » est pris : un suffixe est ajouté');
});

function attenteValide(sub = '1100220033') {
    return google.scellerAttente({ sub, email: 'jean@example.com', nom: 'Jérôme', prenom: 'Jérôme' }, SECRET);
}

test('créer : le compte naît sans mot de passe, rattaché à Google, et la session s\'ouvre', async () => {
    const h = banc();
    const res = await h.appeler('POST', '/auth/google/creer', {
        cookies: { [google.COOKIE_ATTENTE]: attenteValide() },
        body: { username: 'Jerome_7' }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.username, 'Jerome_7');
    assert.deepEqual(h.utilisateurs(), [{ username: 'Jerome_7', password: null, isAdmin: false, googleSub: '1100220033' }]);
    assert.equal(h.sessions[0].username, 'Jerome_7');
    assert.equal(h.valeurCookie(res, google.COOKIE_ATTENTE), '', "l'attente est consommée");
});

test('créer : refusé sans attente valide, avec un nom invalide ou déjà pris', async () => {
    const h = banc({ utilisateurs: [{ username: 'pris', password: 'x', isAdmin: false }] });
    const cookies = { [google.COOKIE_ATTENTE]: attenteValide() };

    assert.equal((await h.appeler('POST', '/auth/google/creer', { body: { username: 'libre' } })).statusCode, 401);
    assert.equal((await h.appeler('POST', '/auth/google/creer', { cookies, body: { username: 'a b' } })).statusCode, 400);
    assert.equal((await h.appeler('POST', '/auth/google/creer', { cookies, body: { username: 'pris' } })).statusCode, 409);
    assert.equal(h.sessions.length, 0);
});

test('lier : le mot de passe du compte existant est exigé, puis Google suffit', async () => {
    const empreinte = await bcrypt.hash('secret1', 4);
    const h = banc({ utilisateurs: [{ username: 'andy', password: empreinte, isAdmin: false }] });
    const cookies = { [google.COOKIE_ATTENTE]: attenteValide() };

    const refus = await h.appeler('POST', '/auth/google/lier', { cookies, body: { username: 'andy', password: 'faux' } });
    assert.equal(refus.statusCode, 401);
    assert.equal(h.utilisateurs()[0].googleSub, undefined);

    const res = await h.appeler('POST', '/auth/google/lier', { cookies, body: { username: 'andy', password: 'secret1' } });
    assert.equal(res.statusCode, 200);
    assert.equal(h.utilisateurs()[0].googleSub, '1100220033');
    assert.equal(h.utilisateurs()[0].password, empreinte, 'le mot de passe reste valable');
    assert.equal(h.sessions[0].username, 'andy');
});

test('lier : un compte déjà lié à un autre compte Google est refusé', async () => {
    const empreinte = await bcrypt.hash('secret1', 4);
    const h = banc({ utilisateurs: [{ username: 'andy', password: empreinte, isAdmin: false, googleSub: 'autre' }] });
    const res = await h.appeler('POST', '/auth/google/lier', {
        cookies: { [google.COOKIE_ATTENTE]: attenteValide() },
        body: { username: 'andy', password: 'secret1' }
    });
    assert.equal(res.statusCode, 409);
    assert.equal(h.utilisateurs()[0].googleSub, 'autre');
});

test('un compte sans mot de passe ne s\'ouvre par aucun mot de passe', async () => {
    const h = banc({ utilisateurs: [{ username: 'jerome', password: null, isAdmin: false, googleSub: 'g' }] });
    for (const password of ['', 'null', 'undefined', 'x']) {
        const res = await h.appeler('POST', '/login', { body: { username: 'jerome', password } });
        assert.equal(res.statusCode, 401, `mot de passe « ${password} »`);
    }
});

test('compte Google : la suppression se confirme par le nom du compte, et /session le signale', async () => {
    const h = banc({ utilisateurs: [{ username: 'jerome', password: null, isAdmin: false, googleSub: 'g' }] });
    const auth = { username: 'jerome', userId: 'jerome', isAdmin: false };

    assert.equal((await h.appeler('GET', '/session', { auth })).body.hasPassword, false);

    const refus = await h.appeler('POST', '/account/delete', { auth, body: { confirmation: 'autre' } });
    assert.equal(refus.statusCode, 401);
    assert.equal(h.utilisateurs().length, 1);

    const res = await h.appeler('POST', '/account/delete', { auth, body: { confirmation: 'jerome' } });
    assert.equal(res.statusCode, 200);
    assert.equal(h.utilisateurs().length, 0);
});
