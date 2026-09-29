/**
 * Le magasin de photos (services/magasinPhotos.js).
 *
 * Ce qu'on vérifie : une photo est réduite sans être recadrée, redressée,
 * débarrassée de ses métadonnées et réencodée en WebP ; elle est rangée en
 * base (ou sur le disque sans base) ; elle est servie avec un cache d'un an
 * et ne sort de la base qu'une fois ; une adresse inconnue ou tordue ne
 * sert rien et ne supprime rien.
 */

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const { creerMagasinPhotos, idDe, COTE_MAX } = require('../../services/magasinPhotos.js');
const { creerBaseSimulee, creerReponse } = require('../fixtures/routeHarness.js');

const silencieux = { log() {}, warn() {}, error() {} };

let racine;
beforeEach(() => { racine = fs.mkdtempSync(path.join(os.tmpdir(), 'fz-magasin-')); });
afterEach(() => fs.rmSync(racine, { recursive: true, force: true }));

function magasin(options = {}) {
    const { db, etat } = creerBaseSimulee({}, []);
    return { etat, db, photos: creerMagasinPhotos({ db, usePostgres: true, racine, logger: silencieux, ...options }) };
}

const image = (largeur, hauteur, format = 'png', extra = {}) =>
    sharp({ create: { width: largeur, height: hauteur, channels: extra.alpha ? 4 : 3, background: extra.alpha ? { r: 0, g: 0, b: 0, alpha: 0.5 } : '#1d4ed8' } })[format]().toBuffer();

async function servir(photos, fichier) {
    const res = creerReponse();
    await photos.servir({ params: { fichier } }, res);
    return res;
}

describe('préparer une photo', () => {
    test('réduite à 512 px sur le plus grand côté, sans recadrage, en WebP', async () => {
        const { photos } = magasin();
        const r = await photos.preparer(await image(3000, 1200, 'png'));
        assert.equal(r.ok, true);
        assert.equal(r.contentType, 'image/webp');
        const info = await sharp(r.tampon).metadata();
        assert.deepEqual([info.format, info.width, info.height], ['webp', COTE_MAX, 205]);
    });

    test('redressée selon l appareil, et sans métadonnées', async () => {
        const { photos } = magasin();
        // Une photo de téléphone tenu à la verticale : pixels couchés, EXIF « tourner de 90° ».
        const telephone = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#888' } })
            .jpeg().withMetadata({ orientation: 6 }).toBuffer();
        const r = await photos.preparer(telephone);
        const info = await sharp(r.tampon).metadata();
        assert.deepEqual([info.width, info.height], [288, 512], 'debout, comme on la voit');
        assert.equal(info.exif, undefined, 'plus d EXIF — ni orientation, ni position GPS');
        assert.equal(info.orientation, undefined);
    });

    test('une petite image n est pas agrandie ; la transparence reste', async () => {
        const { photos } = magasin();
        const r = await photos.preparer(await image(120, 80, 'png', { alpha: true }));
        const info = await sharp(r.tampon).metadata();
        assert.deepEqual([info.width, info.height, info.hasAlpha], [120, 80, true]);
    });

    test('une photo lourde devient légère', async () => {
        const { photos } = magasin();
        // Du bruit : le pire cas pour la compression, comme une vraie photo détaillée.
        const bruit = Buffer.alloc(2400 * 1800 * 3);
        for (let i = 0; i < bruit.length; i++) bruit[i] = (i * 2654435761) >>> 24;
        const lourde = await sharp(bruit, { raw: { width: 2400, height: 1800, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
        const r = await photos.preparer(lourde);
        assert.ok(lourde.length > 1024 * 1024, 'plus de 1 Mo au départ');
        assert.ok(r.tampon.length < lourde.length / 10, `${r.tampon.length} octets à l arrivée`);
    });

    test('ce qui n est pas une image est refusé ; une image endommagée aussi', async () => {
        const { photos } = magasin();
        const texte = await photos.preparer(Buffer.from('ceci n est pas une image, promis'));
        assert.deepEqual([texte.ok, texte.code], [false, 400]);

        const png = await image(50, 50, 'png');
        const tronquee = await photos.preparer(png.subarray(0, 40));
        assert.deepEqual([tronquee.ok, tronquee.code], [false, 400]);
        assert.match(tronquee.message, /illisible/);
    });

    test('sans sharp, les téléversements sont refusés proprement', async () => {
        const erreur = Object.assign(new Error("Cannot find module 'sharp'"), { code: 'MODULE_NOT_FOUND' });
        const { photos } = magasin({ optimiseur: async () => { throw erreur; } });
        const r = await photos.preparer(await image(10, 10));
        assert.deepEqual([r.ok, r.code], [false, 503]);
    });
});

describe('ranger, servir, supprimer', () => {
    test('rangée en base, servie avec un cache d un an, lue une seule fois', async () => {
        const { photos, etat } = magasin();
        const { tampon } = await photos.preparer(await image(800, 600));
        const url = await photos.enregistrer({ tampon, dossier: 'avatars' });
        assert.match(url, /^\/photos\/[0-9a-f-]{36}\.webp$/);
        assert.equal(etat.photos.size, 1);

        const fichier = url.slice('/photos/'.length);
        const premiere = await servir(photos, fichier);
        assert.equal(premiere.statusCode, 200);
        assert.equal(premiere.entetes['Content-Type'], 'image/webp');
        assert.equal(premiere.entetes['Cache-Control'], 'public, max-age=31536000, immutable');
        assert.ok(Buffer.from(premiere.body).equals(tampon));

        await servir(photos, fichier);
        await servir(photos, fichier);
        assert.equal(etat.lecturesPhotos, 1, 'les suivantes viennent de la mémoire');
    });

    test('une adresse inconnue ou tordue : 404, sans cache', async () => {
        const { photos, etat } = magasin();
        for (const fichier of ['0f8fad5b-d9cb-469f-a165-70867728950e.webp', '../db.js', 'x.webp', '']) {
            const r = await servir(photos, fichier);
            assert.equal(r.statusCode, 404, fichier);
            assert.equal(r.entetes['Cache-Control'], 'no-store');
        }
        assert.equal(etat.lecturesPhotos, 1, 'seule l adresse bien formée interroge la base');
    });

    test('supprimée de la base et de la mémoire', async () => {
        const { photos, etat } = magasin();
        const { tampon } = await photos.preparer(await image(40, 40));
        const url = await photos.enregistrer({ tampon, dossier: 'pools' });
        const fichier = url.slice('/photos/'.length);
        assert.equal((await servir(photos, fichier)).statusCode, 200);

        await photos.supprimer(url);
        assert.equal(etat.photos.size, 0);
        assert.equal((await servir(photos, fichier)).statusCode, 404, 'plus servie depuis la mémoire');
        await photos.supprimer(url);   // déjà partie : pas une erreur
    });

    test('les anciennes photos sur disque : supprimées, mais jamais hors de leur dossier', async () => {
        const { photos } = magasin();
        fs.mkdirSync(path.join(racine, 'uploads', 'avatars'), { recursive: true });
        fs.writeFileSync(path.join(racine, 'uploads', 'avatars', 'vieille.png'), 'x');
        fs.writeFileSync(path.join(racine, 'secret.txt'), 'x');

        assert.equal(photos.estTeleversee('/uploads/avatars/../../secret.txt', 'avatars'), false);
        await photos.supprimer('/uploads/avatars/../../secret.txt');
        assert.ok(fs.existsSync(path.join(racine, 'secret.txt')));

        await photos.supprimer('/uploads/avatars/vieille.png');
        assert.equal(fs.existsSync(path.join(racine, 'uploads', 'avatars', 'vieille.png')), false);
    });

    test('lesquelles existent encore, sans lire les images', async () => {
        const { photos, etat } = magasin();
        const { tampon } = await photos.preparer(await image(40, 40));
        const enBase = await photos.enregistrer({ tampon, dossier: 'avatars' });
        const perdueEnBase = '/photos/11111111-2222-4333-8444-555555555555.webp';
        fs.mkdirSync(path.join(racine, 'uploads', 'pools'), { recursive: true });
        fs.writeFileSync(path.join(racine, 'uploads', 'pools', 'la.jpg'), 'x');

        const presentes = await photos.presentes([enBase, perdueEnBase, '/uploads/pools/la.jpg', '/uploads/pools/partie.jpg']);
        assert.deepEqual([...presentes].sort(), [enBase, '/uploads/pools/la.jpg'].sort());
        assert.equal(etat.lecturesPhotos, 0);
    });

    test('sans base (développement local), sur le disque comme avant', async () => {
        const photos = creerMagasinPhotos({ db: null, usePostgres: false, racine, logger: silencieux });
        const { tampon } = await photos.preparer(await image(40, 40));
        const url = await photos.enregistrer({ tampon, dossier: 'avatars' });
        assert.match(url, /^\/uploads\/avatars\/[0-9a-f-]{36}\.webp$/);
        assert.ok(fs.existsSync(path.join(racine, url)));
        assert.ok((await photos.presentes([url])).has(url));
        await photos.supprimer(url);
        assert.equal(fs.existsSync(path.join(racine, url)), false);
    });

    test('idDe ne reconnaît que les adresses de la base', () => {
        assert.equal(idDe('/photos/0f8fad5b-d9cb-469f-a165-70867728950e.webp'), '0f8fad5b-d9cb-469f-a165-70867728950e');
        assert.equal(idDe('/photos/0f8fad5b-d9cb-469f-a165-70867728950e.png'), null);
        assert.equal(idDe('/uploads/avatars/0f8fad5b-d9cb-469f-a165-70867728950e.webp'), null);
        assert.equal(idDe(null), null);
    });
});
