/**
 * Photos téléversées — optimisées, puis rangées dans la base.
 *
 * Render (offre gratuite) efface son disque à chaque redémarrage : une photo
 * écrite dans uploads/ disparaissait au déploiement suivant, et la base
 * gardait l'adresse d'un fichier qui n'existait plus. Les photos vivent donc
 * dans PostgreSQL (table `photos`, migration 0011) et sont servies par
 * `/photos/<id>.webp`.
 *
 * Ce qui les rend assez légères pour la base : chaque image est ramenée à
 * 512 px sur son plus grand côté — sans recadrage, la photo entière reste —,
 * tournée selon l'orientation de l'appareil, débarrassée de ses métadonnées
 * (EXIF, position GPS d'un téléphone) et réencodée en WebP. Une photo de
 * téléphone de plusieurs Mo tombe à quelques dizaines de Ko.
 *
 * Quota de transfert Neon : une photo ne sort de la base qu'une fois par
 * démarrage du serveur (mémoire bornée ci-dessous), et le navigateur la garde
 * un an. Son adresse change à chaque nouvelle photo : elle n'a jamais besoin
 * d'être revalidée.
 *
 * Sans DATABASE_URL (développement local), les photos vont sur le disque,
 * dans uploads/, comme avant.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { typeReel } = require('./moderationImage.js');

/** Plus grand côté, en pixels : net jusqu'à 256 px affichés sur un écran rétina. */
const COTE_MAX = 512;
const QUALITE_WEBP = 80;

/** Mémoire des photos déjà servies, en octets. */
const MEMOIRE_MAX = 32 * 1024 * 1024;

const DOSSIERS = ['avatars', 'pools'];
const MOTIF_PHOTO = /^\/photos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/;
const MOTIF_FICHIER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

/** L'identifiant d'une photo rangée en base, ou null. */
function idDe(url) {
    const trouve = typeof url === 'string' ? MOTIF_PHOTO.exec(url) : null;
    return trouve ? trouve[1] : null;
}

function creerMagasinPhotos({ db, usePostgres, racine, logger = console, optimiseur = null } = {}) {
    const memoire = new Map();   // id -> { contentType, data }, dans l'ordre d'usage
    let octetsEnMemoire = 0;

    function retenir(id, photo) {
        if (photo.data.length > MEMOIRE_MAX) return;
        if (memoire.has(id)) oublier(id);
        memoire.set(id, photo);
        octetsEnMemoire += photo.data.length;
        while (octetsEnMemoire > MEMOIRE_MAX) oublier(memoire.keys().next().value);
    }

    function oublier(id) {
        const photo = memoire.get(id);
        if (!photo) return;
        memoire.delete(id);
        octetsEnMemoire -= photo.data.length;
    }

    /**
     * sharp est chargé à la première photo, pas au démarrage : un module
     * natif absent ou incompatible refuse les téléversements, il ne doit pas
     * empêcher le site entier de démarrer.
     */
    let sharp = null;
    function chargerSharp() {
        if (!sharp) sharp = require('sharp');
        return sharp;
    }

    async function reencoder(tampon) {
        if (optimiseur) return optimiseur(tampon);
        return chargerSharp()(tampon, { failOn: 'error' })
            .rotate()
            .resize({ width: COTE_MAX, height: COTE_MAX, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: QUALITE_WEBP, effort: 5 })
            .toBuffer();
    }

    /**
     * Vérifie que c'est bien une image, puis l'optimise.
     * Renvoie `{ ok: true, tampon, contentType }` ou `{ ok: false, code, message }`.
     */
    async function preparer(tampon) {
        if (!typeReel(tampon)) {
            return { ok: false, code: 400, message: "Ce fichier n'est pas une image JPEG, PNG ou WebP valide." };
        }
        try {
            return { ok: true, tampon: await reencoder(tampon), contentType: 'image/webp' };
        } catch (erreur) {
            if (erreur && erreur.code === 'MODULE_NOT_FOUND') {
                logger.error('❌ sharp introuvable : les photos ne peuvent pas être optimisées.', erreur.message);
                return { ok: false, code: 503, message: "Le téléversement de photos est momentanément indisponible." };
            }
            logger.warn?.('⚠️ Image illisible :', erreur && erreur.message);
            return { ok: false, code: 400, message: "Cette image est illisible ou endommagée. Choisissez-en une autre." };
        }
    }

    /** Range une photo déjà préparée et renvoie son adresse publique. */
    async function enregistrer({ tampon, dossier }) {
        if (!DOSSIERS.includes(dossier)) throw new Error(`Dossier de photo inconnu : ${dossier}`);
        const id = crypto.randomUUID();
        if (usePostgres) {
            await db.insertPhoto(id, 'image/webp', tampon);
            return `/photos/${id}.webp`;
        }
        const chemin = path.join(racine, 'uploads', dossier, `${id}.webp`);
        await fs.promises.mkdir(path.dirname(chemin), { recursive: true });
        await fs.promises.writeFile(chemin, tampon);
        return `/uploads/${dossier}/${id}.webp`;
    }

    /**
     * Le fichier d'une ancienne adresse `/uploads/<dossier>/<nom>`, ou null.
     * L'adresse vient de la base, mais c'est elle qui décide quoi supprimer :
     * un `..` n'y passe pas.
     */
    function fichierDe(url, dossier) {
        const prefixe = `/uploads/${dossier}/`;
        if (typeof url !== 'string' || !url.startsWith(prefixe)) return null;
        const nom = url.slice(prefixe.length);
        if (!nom || nom !== path.basename(nom) || nom.startsWith('.')) return null;
        return path.join(racine, 'uploads', dossier, nom);
    }

    /** Une adresse de photo téléversée, rangée en base ou sur le disque. */
    function estTeleversee(url, dossier) {
        return !!idDe(url) || !!fichierDe(url, dossier);
    }

    /** Supprime une photo. Une photo déjà absente n'est pas une erreur. */
    async function supprimer(url) {
        const id = idDe(url);
        if (id) {
            oublier(id);
            if (usePostgres) await db.deletePhoto(id);
            return;
        }
        for (const dossier of DOSSIERS) {
            const chemin = fichierDe(url, dossier);
            if (!chemin) continue;
            try { await fs.promises.unlink(chemin); }
            catch (erreur) {
                if (erreur.code !== 'ENOENT') logger.warn('⚠️ Photo non supprimée du disque :', erreur.message);
            }
            return;
        }
    }

    /** Parmi ces adresses, celles dont la photo existe encore. */
    async function presentes(urls) {
        const trouvees = new Set();
        const ids = [];
        for (const url of urls) {
            const id = idDe(url);
            if (id) { ids.push(id); continue; }
            const chemin = DOSSIERS.map(d => fichierDe(url, d)).find(Boolean);
            try { if (chemin && fs.statSync(chemin).isFile()) trouvees.add(url); }
            catch { /* absente */ }
        }
        if (ids.length && usePostgres) {
            const existants = new Set(await db.existingPhotoIds(ids));
            for (const url of urls) if (existants.has(idDe(url))) trouvees.add(url);
        }
        return trouvees;
    }

    /** GET /photos/:fichier — monté avant la session : une image ne lit pas de compte. */
    async function servir(req, res) {
        const fichier = req.params && req.params.fichier;
        const id = MOTIF_FICHIER.test(fichier || '') ? fichier.slice(0, -'.webp'.length) : null;
        const absente = () => {
            res.setHeader('Cache-Control', 'no-store');
            res.status(404).type('text/plain').send('Not found');
        };
        if (!id || !usePostgres) return absente();

        try {
            let photo = memoire.get(id);
            if (photo) {
                memoire.delete(id);
                memoire.set(id, photo);   // la plus récemment servie
            } else {
                photo = await db.getPhoto(id);
                if (!photo) return absente();
                retenir(id, photo);
            }
            res.setHeader('Content-Type', photo.contentType);
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.status(200).send(photo.data);
        } catch (erreur) {
            logger.error('Erreur /photos :', erreur);
            res.setHeader('Cache-Control', 'no-store');
            res.status(500).type('text/plain').send('Erreur');
        }
    }

    return { preparer, enregistrer, supprimer, presentes, estTeleversee, servir };
}

module.exports = { creerMagasinPhotos, idDe, COTE_MAX };
