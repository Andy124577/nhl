/**
 * La mémoire courte des sessions (middleware/auth.js).
 *
 * Chaque requête qui portait le cookie relisait sa session en base puis
 * tentait d'écrire `last_seen_at` — la requête la plus fréquente du site, sur
 * une base qui facture ce qui en sort (Neon, septembre 2026).
 *
 * Ce qu'on vérifie : une session lue n'est pas relue à chaque requête, mais
 * une déconnexion, une déconnexion partout ou une nouvelle photo se voient
 * tout de suite ; et une lecture partie avant une révocation ne ressuscite pas
 * la session en revenant après.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { creerAuth, avecMemoireCourte } = require('../../middleware/auth.js');
const session = require('../../lib/session.js');

const HEURE = 60 * 60 * 1000;

/** Un magasin qui compte ses allers-retours vers la « base ». */
function faux(lignesInitiales = {}) {
    const lignes = new Map(Object.entries(lignesInitiales));
    const appels = { lire: 0, toucher: 0 };
    return {
        lignes,
        appels,
        async lire(empreinte) {
            appels.lire += 1;
            const ligne = lignes.get(empreinte);
            return ligne ? { ...ligne } : null;
        },
        async toucher(id) {
            appels.toucher += 1;
            for (const ligne of lignes.values()) if (ligne.id === id) ligne.lastSeenAt = new Date();
        },
        async revoquer(empreinte) {
            const ligne = lignes.get(empreinte);
            if (!ligne || ligne.revokedAt) return false;
            ligne.revokedAt = new Date();
            return true;
        },
        async revoquerTout(userId) {
            let n = 0;
            for (const ligne of lignes.values()) {
                if (ligne.userId === userId && !ligne.revokedAt) { ligne.revokedAt = new Date(); n++; }
            }
            return n;
        },
        async purger() { return 0; }
    };
}

function ligne(extra = {}) {
    return {
        id: 1, userId: 7, username: 'alice', isAdmin: false, avatarUrl: '',
        lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 86400000), revokedAt: null,
        ...extra
    };
}

/** Une horloge qu'on avance à la main. */
function horloge(depart = Date.parse('2026-10-01T12:00:00Z')) {
    let t = depart;
    return { maintenant: () => t, avancer: (ms) => { t += ms; } };
}

describe('mémoire courte des sessions', () => {
    test('une session lue est resservie de mémoire, puis relue passé le délai', async () => {
        const base = faux({ h1: ligne() });
        const h = horloge();
        const magasin = avecMemoireCourte(base, { dureeMs: 60000, maintenant: h.maintenant });

        await magasin.lire('h1');
        await magasin.lire('h1');
        await magasin.lire('h1');
        assert.equal(base.appels.lire, 1);

        h.avancer(60001);
        await magasin.lire('h1');
        assert.equal(base.appels.lire, 2);
    });

    test('un jeton inconnu est retenu aussi : un vieux cookie ne coûte pas une requête par appel', async () => {
        const base = faux();
        const magasin = avecMemoireCourte(base);
        assert.equal(await magasin.lire('inconnu'), null);
        assert.equal(await magasin.lire('inconnu'), null);
        assert.equal(base.appels.lire, 1);
    });

    test('une déconnexion se voit à la requête suivante, pas une minute plus tard', async () => {
        const base = faux({ h1: ligne() });
        const magasin = avecMemoireCourte(base);

        assert.equal(session.sessionValide(await magasin.lire('h1')), true);
        await magasin.revoquer('h1');
        assert.equal(session.sessionValide(await magasin.lire('h1')), false);
    });

    test('déconnecter partout efface les sessions de ce compte, et seulement celles-là', async () => {
        const base = faux({
            a1: ligne({ id: 1, userId: 7 }),
            a2: ligne({ id: 2, userId: 7 }),
            b1: ligne({ id: 3, userId: 8, username: 'bob' })
        });
        const magasin = avecMemoireCourte(base);
        for (const cle of ['a1', 'a2', 'b1']) await magasin.lire(cle);

        await magasin.revoquerTout(7);
        const lectures = base.appels.lire;
        assert.equal(session.sessionValide(await magasin.lire('a1')), false);
        assert.equal(session.sessionValide(await magasin.lire('a2')), false);
        assert.equal(session.sessionValide(await magasin.lire('b1')), true);
        assert.equal(base.appels.lire, lectures + 2, 'la session de bob reste en mémoire');
    });

    test('un compte modifié (photo, droits) est relu à la requête suivante', async () => {
        const base = faux({ h1: ligne() });
        const magasin = avecMemoireCourte(base);
        await magasin.lire('h1');

        base.lignes.get('h1').avatarUrl = '/uploads/avatars/neuve.webp';
        magasin.oublierUtilisateur('alice');
        assert.equal((await magasin.lire('h1')).avatarUrl, '/uploads/avatars/neuve.webp');
    });

    test('une lecture partie avant une révocation ne ressuscite pas la session en revenant', async () => {
        const base = faux({ h1: ligne() });
        let relacher;
        const lireLent = base.lire.bind(base);
        base.lire = async (empreinte) => {
            const lu = await lireLent(empreinte);   // lue AVANT la révocation
            await new Promise(r => { relacher = r; });
            return lu;
        };
        const magasin = avecMemoireCourte(base);

        const enVol = magasin.lire('h1');
        await new Promise(r => setImmediate(r));
        await magasin.revoquer('h1');
        relacher();
        assert.equal(session.sessionValide(await enVol), true, 'la requête en vol garde ce qu elle a lu');

        base.lire = lireLent;
        assert.equal(session.sessionValide(await magasin.lire('h1')), false,
            'mais la lecture périmée n a pas été rangée');
    });

    test("last_seen_at ne s'écrit qu'une fois toutes les six heures, et pas à chaque requête", async () => {
        const h = horloge();
        const base = faux({ h1: ligne({ lastSeenAt: new Date(h.maintenant() - 10 * 60000) }) });
        const magasin = avecMemoireCourte(base, { maintenant: h.maintenant });

        let lu = await magasin.lire('h1');
        await magasin.toucher(lu.id, lu);
        assert.equal(base.appels.toucher, 0, 'vue il y a 10 minutes : rien à écrire');

        h.avancer(HEURE);
        lu = await magasin.lire('h1');
        await magasin.toucher(lu.id, lu);
        assert.equal(base.appels.toucher, 0, 'vue il y a 70 minutes : toujours rien — chaque écriture réveille Neon');

        h.avancer(5 * HEURE);
        lu = await magasin.lire('h1');
        await magasin.toucher(lu.id, lu);
        assert.equal(base.appels.toucher, 1);

        lu = await magasin.lire('h1');
        await magasin.toucher(lu.id, lu);
        assert.equal(base.appels.toucher, 1, 'la mémoire sait déjà que la visite est notée');
    });

    test('la mémoire est bornée : la plus ancienne entrée part', async () => {
        const base = faux({ h1: ligne({ id: 1 }), h2: ligne({ id: 2 }), h3: ligne({ id: 3 }) });
        const magasin = avecMemoireCourte(base, { max: 2 });
        await magasin.lire('h1');
        await magasin.lire('h2');
        await magasin.lire('h3');

        const lectures = base.appels.lire;
        await magasin.lire('h3');
        await magasin.lire('h2');
        assert.equal(base.appels.lire, lectures, 'les deux plus récentes restent');
        await magasin.lire('h1');
        assert.equal(base.appels.lire, lectures + 1, 'la première est repartie en base');
    });
});

describe('creerAuth branché sur PostgreSQL', () => {
    /** Juste ce que magasinPostgres demande à db.js. */
    function fausseDb() {
        const sessions = new Map();
        let prochain = 1;
        const db = {
            lectures: 0,
            async createSession(userId, tokenHash, expiresAt) {
                const ligne = { id: prochain++, user_id: userId, created_at: new Date(), expires_at: expiresAt, impersonated_by: null };
                sessions.set(tokenHash, { ...ligne, token_hash: tokenHash, revoked_at: null, last_seen_at: new Date() });
                return ligne;
            },
            async getSessionByTokenHash(tokenHash) {
                db.lectures += 1;
                const s = sessions.get(tokenHash);
                if (!s) return null;
                return {
                    id: s.id, userId: s.user_id, tokenHash, createdAt: s.created_at, lastSeenAt: s.last_seen_at,
                    expiresAt: s.expires_at, revokedAt: s.revoked_at, username: 'alice', isAdmin: false,
                    avatarUrl: '', impersonatedBy: null, impersonatorUsername: null
                };
            },
            async touchSession() {},
            async revokeSession(tokenHash) {
                const s = sessions.get(tokenHash);
                if (!s || s.revoked_at) return false;
                s.revoked_at = new Date();
                return true;
            },
            async revokeAllSessionsForUser() { return 0; },
            async purgeExpiredSessions() { return 0; }
        };
        return db;
    }

    function reponse() {
        return { entetes: {}, setHeader(nom, valeur) { this.entetes[nom] = valeur; } };
    }

    test('une rafale de requêtes ne lit la session qu une fois ; la déconnexion coupe aussitôt', async () => {
        const db = fausseDb();
        const auth = creerAuth({ db, usePostgres: true, secure: false });

        const ouverture = reponse();
        await auth.ouvrirSession(ouverture, { id: 7, username: 'alice' }, { headers: {} });
        const cookie = String(ouverture.entetes['Set-Cookie']).split(';')[0];

        for (let i = 0; i < 5; i++) {
            const req = { headers: { cookie } };
            await auth.sessionMiddleware(req, reponse(), () => {});
            assert.equal(req.auth.username, 'alice');
        }
        assert.equal(await auth.identifierSocket({ headers: { cookie } }).then(i => i.username), 'alice');
        assert.equal(db.lectures, 1, 'cinq requêtes et un socket, une seule lecture');

        await auth.fermerSession({ headers: { cookie } }, reponse());
        const apres = { headers: { cookie } };
        await auth.sessionMiddleware(apres, reponse(), () => {});
        assert.equal(apres.auth, null);
    });
});

test('server.js sert les fichiers statiques avant de résoudre la session', () => {
    // Chaque script, feuille de style ou photo d'une page coûtait une lecture
    // de session en base. L'ordre des montages est ce qui l'évite.
    const source = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
    const statique = source.indexOf('app.use(express.static(__dirname');
    const televersements = source.indexOf("app.use('/uploads', express.static(");
    const sessionResolue = source.indexOf('auth.sessionMiddleware(req, res, next)');
    assert.ok(statique > 0 && televersements > 0 && sessionResolue > 0, 'montages introuvables');
    assert.ok(sessionResolue > statique && sessionResolue > televersements);
});
