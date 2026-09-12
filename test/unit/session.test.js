'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const session = require('../../lib/session.js');

test('un jeton est imprévisible et ne se retrouve pas dans son empreinte', () => {
    const jetons = new Set();
    for (let i = 0; i < 200; i++) jetons.add(session.genererJeton());
    assert.equal(jetons.size, 200, 'deux jetons identiques en 200 tirages');

    const jeton = session.genererJeton();
    const empreinte = session.empreinteJeton(jeton);
    assert.equal(empreinte.length, 64);
    assert.ok(!empreinte.includes(jeton.slice(0, 12)),
        "l'empreinte ne doit rien laisser transparaître du jeton");
    assert.equal(session.empreinteJeton(jeton), empreinte, 'empreinte stable');
    assert.notEqual(session.empreinteJeton(jeton + 'x'), empreinte);
});

test('la comparaison d empreintes accepte l identique et refuse le reste', () => {
    const a = session.empreinteJeton('un');
    assert.equal(session.empreintesEgales(a, a), true);
    assert.equal(session.empreintesEgales(a, session.empreinteJeton('deux')), false);
    assert.equal(session.empreintesEgales(a, ''), false);
    assert.equal(session.empreintesEgales(null, undefined), true, 'deux vides sont égaux');
});

test('la lecture de cookies survit à un voisin malformé', () => {
    const cookies = session.lireCookies('theme=dark; brise; fz_session=abc%3Ddef; =vide; autre=1');
    assert.equal(cookies.fz_session, 'abc=def');
    assert.equal(cookies.theme, 'dark');
    assert.equal(cookies.autre, '1');
    assert.deepEqual(session.lireCookies(''), {});
    assert.deepEqual(session.lireCookies(null), {});
});

test('une valeur de cookie mal encodée est conservée telle quelle plutôt que perdue', () => {
    const cookies = session.lireCookies('fz_session=%E0%A4%A');
    assert.equal(cookies.fz_session, '%E0%A4%A');
});

test('le cookie de session est HttpOnly, SameSite=Lax, et Secure seulement quand demandé', () => {
    const secure = session.cookieSession('jeton');
    assert.match(secure, /HttpOnly/);
    assert.match(secure, /SameSite=Lax/);
    assert.match(secure, /Secure/);
    assert.match(secure, /Path=\//);

    const local = session.cookieSession('jeton', { secure: false });
    assert.doesNotMatch(local, /Secure/,
        'en développement le serveur répond en clair : un cookie Secure ne reviendrait jamais');
});

test('la déconnexion périme le cookie', () => {
    const efface = session.cookieEfface({ secure: false });
    assert.match(efface, /fz_session=;/);
    assert.match(efface, /Max-Age=0/);
});

test('une session est invalide si elle est révoquée, expirée, ou dormante', () => {
    const maintenant = Date.parse('2026-09-11T12:00:00Z');
    const vivante = {
        expiresAt: new Date(maintenant + 86400000),
        lastSeenAt: new Date(maintenant - 60000),
        revokedAt: null
    };
    assert.equal(session.sessionValide(vivante, maintenant), true);

    assert.equal(session.sessionValide({ ...vivante, revokedAt: new Date() }, maintenant), false);
    assert.equal(session.sessionValide({ ...vivante, expiresAt: new Date(maintenant - 1) }, maintenant), false);
    assert.equal(session.sessionValide({
        ...vivante,
        lastSeenAt: new Date(maintenant - session.INACTIVITE_MAX_MS - 1000)
    }, maintenant), false, 'un poste oublié ouvert ne reste pas ouvert un mois');
    assert.equal(session.sessionValide(null, maintenant), false);
});

test('une session sans dernière visite connue reste valable tant qu elle n a pas expiré', () => {
    const maintenant = Date.parse('2026-09-11T12:00:00Z');
    assert.equal(session.sessionValide({
        expiresAt: new Date(maintenant + 1000), lastSeenAt: null, revokedAt: null
    }, maintenant), true);
});

test('une requête mutante venue d un autre site est refusée', () => {
    const hote = 'fantazy.example';
    assert.equal(session.origineAutorisee({ origin: 'https://fantazy.example', host: hote }), true);
    assert.equal(session.origineAutorisee({ origin: 'https://mechant.example', host: hote }), false);
    assert.equal(session.origineAutorisee({ referer: 'https://mechant.example/x', host: hote }), false);
    assert.equal(session.origineAutorisee({
        origin: 'https://app.fantazy.example', host: hote,
        autorisees: ['https://app.fantazy.example']
    }), true, 'une origine explicitement listée passe');
});

test('une origine « null » ne compte jamais pour « même site »', () => {
    // Un iframe en bac à sable, ou une redirection entre origines, envoie
    // littéralement `Origin: null`. Le prendre pour une absence d'origine
    // rouvrirait exactement la porte que ce contrôle ferme.
    assert.equal(session.origineAutorisee({ origin: 'null', host: 'fantazy.example' }), false);
    assert.equal(session.hoteDe('null'), null);
});

test('une requête sans aucune origine annoncée passe, puisqu aucun cookie ne s y attache seul', () => {
    assert.equal(session.origineAutorisee({ host: 'fantazy.example' }), true);
    // Mais une origine illisible n'est pas une absence d'origine.
    assert.equal(session.origineAutorisee({ origin: 'pas-une-url', host: 'fantazy.example' }), false);
});

test('le contrôle d origine couvre aussi la connexion elle-même', () => {
    // Sans lui, une page tierce peut poster des identifiants et connecter la
    // personne au compte de l'attaquant : le cookie n'y est pas encore, mais
    // il y sera au retour, et tout ce qu'elle fera ensuite ira dans ce compte.
    const { creerAuth } = require('../../middleware/auth.js');
    const auth = creerAuth({ usePostgres: false, secure: false });

    const appeler = (entetes, identite = null) => {
        const req = { method: 'POST', path: '/login', headers: entetes, auth: identite };
        const res = {
            statusCode: 200, corps: null,
            status(code) { this.statusCode = code; return this; },
            json(c) { this.corps = c; return this; }
        };
        let suivant = false;
        auth.csrfGuard(req, res, () => { suivant = true; });
        return { suivant, statut: res.statusCode, corps: res.corps };
    };

    const etrangere = appeler({ origin: 'https://mechant.example', host: 'fantazy.example' });
    assert.equal(etrangere.suivant, false);
    assert.equal(etrangere.statut, 403);
    assert.equal(etrangere.corps.code, 'origine_refusee');

    assert.equal(appeler({ origin: 'http://fantazy.example', host: 'fantazy.example' }).suivant, true);
    assert.equal(appeler({ host: 'fantazy.example' }).suivant, true,
        'un client sans origine annoncée passe : aucun cookie ne s y attache seul');
});

test('une lecture ne passe pas par le contrôle d origine', () => {
    const { creerAuth } = require('../../middleware/auth.js');
    const auth = creerAuth({ usePostgres: false, secure: false });
    let suivant = false;
    auth.csrfGuard(
        { method: 'GET', headers: { origin: 'https://mechant.example', host: 'fantazy.example' }, auth: {} },
        { status() { return this; }, json() { return this; } },
        () => { suivant = true; }
    );
    assert.equal(suivant, true, 'une lecture ne change rien : rien à protéger de ce côté');
});
