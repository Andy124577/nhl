/**
 * L'écran « Photos téléversées » de l'administration (routes/photos.js).
 *
 * Ce qu'on vérifie : seule l'administration y entre ; la liste montre chaque
 * photo en ligne avec qui l'a posée, quand, et si l'analyse l'a vue ; un
 * fichier effacé du disque est signalé ; « Retirer » efface la référence ET
 * le fichier, mais jamais une photo posée entre-temps, ni un fichier hors
 * du dossier des téléversements.
 */

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sharp = require('sharp');

const routesPhotos = require('../../routes/photos.js');
const routesPools = require('../../routes/pools.js');
const { monterRoutes, poolNeuf } = require('../fixtures/routeHarness.js');

const ADMIN = { username: 'admin', userId: 'admin', isAdmin: true };
const ALICE = { username: 'alice', userId: 'alice', isAdmin: false };

let racine;

beforeEach(() => {
    racine = fs.mkdtempSync(path.join(os.tmpdir(), 'fz-photos-'));
    fs.mkdirSync(path.join(racine, 'uploads', 'avatars'), { recursive: true });
    fs.mkdirSync(path.join(racine, 'uploads', 'pools'), { recursive: true });
});
afterEach(() => fs.rmSync(racine, { recursive: true, force: true }));

/** Pose un faux fichier téléversé et renvoie son URL publique. */
function poser(dossier, nom) {
    fs.writeFileSync(path.join(racine, 'uploads', dossier, nom), 'image');
    return `/uploads/${dossier}/${nom}`;
}
const existe = (url) => fs.existsSync(path.join(racine, url));

function banc({ users, pools = {}, ctxExtra = {} } = {}) {
    return monterRoutes([routesPools, routesPhotos], {
        pools,
        users: users || [
            { username: 'admin', id: 'admin', isAdmin: true },
            { username: 'alice', id: 'alice' },
            { username: 'bob', id: 'bob' }
        ],
        ctxExtra: { racine, ...ctxExtra }
    });
}

describe('GET /admin/photos', () => {
    test('réservé à l administration', async () => {
        const h = banc();
        assert.equal((await h.appeler('GET', '/admin/photos')).statusCode, 401);
        assert.equal((await h.appeler('GET', '/admin/photos', { auth: ALICE })).statusCode, 403);
        assert.equal((await h.appeler('GET', '/admin/photos', { auth: ADMIN })).statusCode, 200);
    });

    test('chaque photo avec son auteur, sa date et son état ; la plus récente d abord', async () => {
        const photoAlice = poser('avatars', 'alice.png');
        const imagePool = poser('pools', 'loups.jpg');
        const h = banc({
            users: [
                { username: 'admin', id: 'admin', isAdmin: true },
                { username: 'alice', id: 'alice', avatarUrl: photoAlice, avatarUploadedAt: '2026-09-20T10:00:00.000Z', avatarChecked: true },
                // Posée avant le suivi, et effacée depuis par un redémarrage.
                { username: 'bob', id: 'bob', avatarUrl: '/uploads/avatars/perdue.webp' },
                // Pas une photo téléversée : rien à vérifier.
                { username: 'carl', id: 'carl', avatarUrl: 'Icons/grayUser.png' }
            ],
            pools: {
                Loups: { ...poolNeuf(), imageUrl: imagePool, imageMeta: { par: 'alice', le: '2026-09-25T08:00:00.000Z', verifiee: false } },
                SansImage: poolNeuf()
            }
        });

        const r = await h.appeler('GET', '/admin/photos', { auth: ADMIN });
        assert.equal(r.statusCode, 200);
        assert.deepEqual(r.body.photos.map(p => p.url), [imagePool, photoAlice, '/uploads/avatars/perdue.webp']);

        const [pool, alice, bob] = r.body.photos;
        assert.deepEqual(pool, {
            type: 'pool', url: imagePool, username: 'alice', pool: 'Loups',
            par: 'alice', le: '2026-09-25T08:00:00.000Z', verifiee: false, fichierPresent: true
        });
        assert.equal(alice.type, 'avatar');
        assert.equal(alice.par, 'alice');
        assert.equal(alice.verifiee, true);
        assert.equal(alice.fichierPresent, true);
        assert.equal(bob.verifiee, null, 'antérieure au suivi : on ne sait pas');
        assert.equal(bob.le, null);
        assert.equal(bob.fichierPresent, false, 'le disque a été effacé');
    });

    test('dit si l analyse automatique est en marche', async () => {
        const sans = await banc().appeler('GET', '/admin/photos', { auth: ADMIN });
        assert.equal(sans.body.analyseActive, false);

        const avec = await banc({ ctxExtra: { moderationImages: { actif: true, verifier: async () => ({ ok: true, verifiee: true }) } } })
            .appeler('GET', '/admin/photos', { auth: ADMIN });
        assert.equal(avec.body.analyseActive, true);
    });
});

describe('POST /admin/photos/retirer', () => {
    test('une photo de profil : la référence, le fichier et la session en mémoire', async () => {
        const url = poser('avatars', 'alice.png');
        const h = banc({ users: [
            { username: 'admin', id: 'admin', isAdmin: true },
            { username: 'alice', id: 'alice', avatarUrl: url, avatarUploadedAt: '2026-09-20T10:00:00.000Z', avatarChecked: false }
        ] });

        assert.equal((await h.appeler('POST', '/admin/photos/retirer', {
            auth: ALICE, body: { type: 'avatar', username: 'alice', url }
        })).statusCode, 403);
        assert.ok(existe(url), 'un refus ne touche à rien');

        const r = await h.appeler('POST', '/admin/photos/retirer', { auth: ADMIN, body: { type: 'avatar', username: 'alice', url } });
        assert.equal(r.statusCode, 200);
        const alice = h.etat.users.find(u => u.username === 'alice');
        assert.equal(alice.avatarUrl, '');
        assert.equal(alice.avatarChecked, undefined);
        assert.equal(existe(url), false);
        assert.deepEqual(h.auth.oublis, ['alice']);

        const liste = await h.appeler('GET', '/admin/photos', { auth: ADMIN });
        assert.equal(liste.body.photos.length, 0);

        const encore = await h.appeler('POST', '/admin/photos/retirer', { auth: ADMIN, body: { type: 'avatar', username: 'alice', url } });
        assert.equal(encore.statusCode, 409);
    });

    test('une photo rangée en base : signalée présente ou non, et retirée de la base', async () => {
        const h = banc();
        const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
        await h.db.insertPhoto(id, 'image/webp', Buffer.from('x'));
        const url = `/photos/${id}.webp`;
        h.etat.users.find(u => u.username === 'alice').avatarUrl = url;
        h.etat.users.find(u => u.username === 'bob').avatarUrl = '/photos/11111111-2222-4333-8444-555555555555.webp';

        const liste = await h.appeler('GET', '/admin/photos', { auth: ADMIN });
        const presence = Object.fromEntries(liste.body.photos.map(p => [p.username, p.fichierPresent]));
        assert.deepEqual(presence, { alice: true, bob: false });

        const r = await h.appeler('POST', '/admin/photos/retirer', { auth: ADMIN, body: { type: 'avatar', username: 'alice', url } });
        assert.equal(r.statusCode, 200);
        assert.equal(h.etat.photos.has(id), false);
    });

    test('une photo remplacée entre la liste et le clic n emporte pas la nouvelle', async () => {
        const ancienne = '/uploads/avatars/ancienne.png';
        const neuve = poser('avatars', 'neuve.png');
        const h = banc({ users: [
            { username: 'admin', id: 'admin', isAdmin: true },
            { username: 'alice', id: 'alice', avatarUrl: neuve }
        ] });

        const r = await h.appeler('POST', '/admin/photos/retirer', { auth: ADMIN, body: { type: 'avatar', username: 'alice', url: ancienne } });
        assert.equal(r.statusCode, 409);
        assert.equal(h.etat.users.find(u => u.username === 'alice').avatarUrl, neuve);
        assert.ok(existe(neuve));
    });

    test('un fichier retiré alors qu il avait déjà disparu du disque : la référence part quand même', async () => {
        const h = banc({ users: [
            { username: 'admin', id: 'admin', isAdmin: true },
            { username: 'bob', id: 'bob', avatarUrl: '/uploads/avatars/perdue.webp' }
        ] });
        const r = await h.appeler('POST', '/admin/photos/retirer', {
            auth: ADMIN, body: { type: 'avatar', username: 'bob', url: '/uploads/avatars/perdue.webp' }
        });
        assert.equal(r.statusCode, 200);
        assert.equal(h.etat.users.find(u => u.username === 'bob').avatarUrl, '');
    });

    test('une adresse qui sort du dossier des téléversements est refusée', async () => {
        fs.writeFileSync(path.join(racine, 'secret.txt'), 'x');
        const piege = '/uploads/avatars/../../secret.txt';
        const h = banc({ users: [
            { username: 'admin', id: 'admin', isAdmin: true },
            { username: 'alice', id: 'alice', avatarUrl: piege }
        ] });
        const r = await h.appeler('POST', '/admin/photos/retirer', { auth: ADMIN, body: { type: 'avatar', username: 'alice', url: piege } });
        assert.equal(r.statusCode, 400);
        assert.ok(fs.existsSync(path.join(racine, 'secret.txt')));
        assert.equal(h.etat.users.find(u => u.username === 'alice').avatarUrl, piege);
    });

    test('une image de pool : retirée des données du pool, du disque, et annoncée aux membres', async () => {
        const url = poser('pools', 'loups.jpg');
        const h = banc({ pools: {
            Loups: { ...poolNeuf(), imageUrl: url, imageMeta: { par: 'alice', le: '2026-09-25T08:00:00.000Z', verifiee: false } }
        } });

        const faux = await h.appeler('POST', '/admin/photos/retirer', {
            auth: ADMIN, body: { type: 'pool', pool: 'Loups', url: '/uploads/pools/autre.jpg' }
        });
        assert.equal(faux.statusCode, 409);
        assert.equal(h.lirePool('Loups').imageUrl, url);

        const r = await h.appeler('POST', '/admin/photos/retirer', { auth: ADMIN, body: { type: 'pool', pool: 'Loups', url } });
        assert.equal(r.statusCode, 200);
        assert.equal(h.lirePool('Loups').imageUrl, undefined);
        assert.equal(h.lirePool('Loups').imageMeta, undefined);
        assert.equal(existe(url), false);
        assert.ok(h.diffusion.emissions.some(([evt, salle]) => evt === 'poolMisAJour' && salle === 'pool:Loups'));

        const absent = await h.appeler('POST', '/admin/photos/retirer', { auth: ADMIN, body: { type: 'pool', pool: 'Fantome', url } });
        assert.equal(absent.statusCode, 404);
    });

    test('un type inconnu est refusé', async () => {
        const r = await banc().appeler('POST', '/admin/photos/retirer', { auth: ADMIN, body: { type: 'banniere', url: '/uploads/x.png' } });
        assert.equal(r.statusCode, 400);
    });
});

describe('le téléversement d une image de pool note qui, quand, et si elle a été vue', () => {
    function televersement(moderationImages, pool = poolNeuf({ creator: 'alice' })) {
        const png = async () => sharp({ create: { width: 1200, height: 800, channels: 3, background: '#c8102e' } }).png().toBuffer();
        let tampon = null;
        const h = banc({
            pools: { Loups: pool },
            ctxExtra: {
                moderationImages,
                uploadPool: { single: () => async (req, res, next) => {
                    tampon = tampon || await png();
                    req.file = { buffer: tampon, mimetype: 'image/png', size: tampon.length };
                    next();
                } }
            }
        });
        return h;
    }

    test('vue par l analyse — et c est la version optimisée qui est analysée', async () => {
        let analysee = null;
        const h = televersement({ actif: true, verifier: async ({ tampon, mimetype }) => { analysee = { tampon, mimetype }; return { ok: true, verifiee: true }; } });
        const r = await h.appeler('POST', '/upload/pool-image', { auth: ALICE, body: { poolName: 'Loups' } });
        assert.equal(r.statusCode, 200);
        assert.match(r.body.imageUrl, /^\/photos\/[0-9a-f-]{36}\.webp$/);
        const meta = h.lirePool('Loups').imageMeta;
        assert.equal(meta.par, 'alice');
        assert.equal(meta.verifiee, true);
        assert.ok(!Number.isNaN(Date.parse(meta.le)));

        assert.equal(analysee.mimetype, 'image/webp');
        const info = await sharp(analysee.tampon).metadata();
        assert.deepEqual([info.format, info.width, info.height], ['webp', 512, 341], 'réduite, proportions gardées');
        assert.equal(h.etat.photos.size, 1, 'rangée en base, pas sur le disque');
        assert.deepEqual(fs.readdirSync(path.join(racine, 'uploads', 'pools')), []);
    });

    test('refusée par l analyse : rien n est rangé', async () => {
        const h = televersement({ actif: true, verifier: async () => ({ ok: false, code: 422, message: 'Non.' }) });
        const r = await h.appeler('POST', '/upload/pool-image', { auth: ALICE, body: { poolName: 'Loups' } });
        assert.equal(r.statusCode, 422);
        assert.equal(h.etat.photos.size, 0);
        assert.equal(h.lirePool('Loups').imageUrl, undefined);
    });

    test('la nouvelle image remplace l ancienne, qui part de la base', async () => {
        const h = televersement({ actif: true, verifier: async () => ({ ok: true, verifiee: true }) });
        const premiere = await h.appeler('POST', '/upload/pool-image', { auth: ALICE, body: { poolName: 'Loups' } });
        const seconde = await h.appeler('POST', '/upload/pool-image', { auth: ALICE, body: { poolName: 'Loups' } });
        assert.notEqual(premiere.body.imageUrl, seconde.body.imageUrl);
        assert.equal(h.etat.photos.size, 1);
        assert.equal(h.lirePool('Loups').imageUrl, seconde.body.imageUrl);
    });

    test('supprimer le pool supprime son image', async () => {
        const h = televersement({ actif: true, verifier: async () => ({ ok: true, verifiee: true }) });
        await h.appeler('POST', '/upload/pool-image', { auth: ALICE, body: { poolName: 'Loups' } });
        assert.equal(h.etat.photos.size, 1);
        const r = await h.appeler('POST', '/delete-clan', { auth: ALICE, body: { clanName: 'Loups' } });
        assert.equal(r.statusCode, 200);
        assert.equal(h.etat.photos.size, 0);
    });

    test('publiée sans analyse (clé absente ou panne)', async () => {
        const h = televersement({ actif: false, verifier: async () => ({ ok: true, verifiee: false }) });
        await h.appeler('POST', '/upload/pool-image', { auth: ALICE, body: { poolName: 'Loups' } });
        assert.equal(h.lirePool('Loups').imageMeta.verifiee, false);

        const liste = await h.appeler('GET', '/admin/photos', { auth: ADMIN });
        assert.equal(liste.body.photos[0].verifiee, false);
        assert.equal(liste.body.photos[0].par, 'alice');
    });
});
