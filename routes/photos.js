/**
 * Photos téléversées — l'écran de vérification de l'administration.
 *
 * L'analyse automatique (services/moderationImage.js) ne regarde une image
 * que si ANTHROPIC_API_KEY est posée ; sans elle, ou pendant une panne, la
 * photo est publiée sans avoir été vue. Cet écran liste toutes les photos en
 * ligne — photos de profil et images de pool — avec qui les a téléversées,
 * quand, et si l'analyse les a vues, pour qu'une personne les passe en revue.
 * « Retirer » supprime la photo et remet l'image par défaut.
 *
 * La liste se lit là où les photos sont référencées (`users.avatar_url`,
 * `imageUrl` dans les données du pool) : une photo remplacée, ou dont le
 * compte ou le pool a disparu, n'y figure plus, sans registre à tenir à jour.
 * Elle n'est lue qu'à la demande (un clic de l'administration), et en
 * PostgreSQL les images de pool sont extraites dans la base plutôt que de
 * relire chaque pool_data (quota de transfert Neon). Les photos elles-mêmes
 * ne sont pas lues : on demande seulement lesquelles existent encore.
 *
 * Le stockage (base, ou disque en développement) est l'affaire de
 * services/magasinPhotos.js.
 */

'use strict';

const authz = require('../lib/authz.js');

/** Le type affiché à l'écran -> le dossier du magasin de photos. */
const DOSSIER = { avatar: 'avatars', pool: 'pools' };

/** Vrai / faux si on le sait ; null pour une photo antérieure au suivi. */
const etatVerification = (valeur) => (typeof valeur === 'boolean' ? valeur : null);

function monter(app, ctx) {
    const { auth, store, db, usePostgres, chargerUtilisateurs, sauvegarderUtilisateurs,
            photos, diffusion, logger = console } = ctx;
    const { ErreurMetier } = store;

    async function avatars() {
        if (usePostgres) return db.listUploadedAvatars();
        const comptes = await chargerUtilisateurs();
        return comptes
            .filter(c => photos.estTeleversee(c.avatarUrl, DOSSIER.avatar))
            .map(c => ({
                username: c.username,
                url: c.avatarUrl,
                le: c.avatarUploadedAt || null,
                verifiee: etatVerification(c.avatarChecked)
            }));
    }

    async function imagesDePool() {
        if (usePostgres) return db.listPoolImages();
        const tous = await store.lireTous();
        return Object.entries(tous)
            .filter(([, enveloppe]) => enveloppe && enveloppe.data &&
                photos.estTeleversee(enveloppe.data.imageUrl, DOSSIER.pool))
            .map(([nom, enveloppe]) => ({
                pool: nom,
                url: enveloppe.data.imageUrl,
                meta: enveloppe.data.imageMeta || null,
                createur: authz.createurDuPool(enveloppe.data)
            }));
    }

    app.get('/admin/photos', auth.requireAdmin, async (req, res) => {
        try {
            const [profils, pools] = await Promise.all([avatars(), imagesDePool()]);
            const liste = [
                ...profils.map(a => ({
                    type: 'avatar',
                    url: a.url,
                    username: a.username,
                    pool: null,
                    par: a.username,
                    le: a.le || null,
                    verifiee: etatVerification(a.verifiee)
                })),
                ...pools.map(p => {
                    const meta = p.meta || {};
                    return {
                        type: 'pool',
                        url: p.url,
                        username: p.createur || null,
                        pool: p.pool,
                        par: meta.par || null,
                        le: meta.le || null,
                        verifiee: etatVerification(meta.verifiee)
                    };
                })
            ];

            const presentes = await photos.presentes(liste.map(p => p.url));
            for (const photo of liste) photo.fichierPresent = presentes.has(photo.url);

            // La plus récente d'abord ; les photos d'avant le suivi, sans date, à la fin.
            const temps = (photo) => (photo.le ? new Date(photo.le).getTime() || 0 : 0);
            liste.sort((a, b) => temps(b) - temps(a));

            res.json({
                photos: liste,
                analyseActive: !!(ctx.moderationImages && ctx.moderationImages.actif)
            });
        } catch (erreur) {
            logger.error('Erreur /admin/photos :', erreur);
            res.status(500).json({ message: "Erreur interne du serveur." });
        }
    });

    /**
     * Retire une photo. Le corps nomme la photo (`url`) ET sa place
     * (`username` ou `pool`) : on ne retire que si elle y est encore. Une
     * photo remplacée entre l'affichage de la liste et le clic n'emporte
     * pas la nouvelle.
     */
    app.post('/admin/photos/retirer', auth.requireAdmin, async (req, res) => {
        const corps = req.body || {};
        const type = corps.type;
        const url = typeof corps.url === 'string' ? corps.url : '';
        const DEJA_PARTIE = "Cette photo a déjà été retirée ou remplacée. Rechargez la liste.";

        try {
            if (type === 'avatar') {
                const username = typeof corps.username === 'string' ? corps.username.trim() : '';
                if (!username || !photos.estTeleversee(url, DOSSIER.avatar)) {
                    return res.status(400).json({ message: "Photo de profil invalide." });
                }

                let retiree = false;
                if (usePostgres) {
                    retiree = await db.clearUserAvatar(username, url);
                } else {
                    const comptes = await chargerUtilisateurs();
                    const compte = comptes.find(c => c.username === username);
                    if (compte && compte.avatarUrl === url) {
                        compte.avatarUrl = '';
                        delete compte.avatarUploadedAt;
                        delete compte.avatarChecked;
                        await sauvegarderUtilisateurs(comptes);
                        retiree = true;
                    }
                }
                if (!retiree) return res.status(409).json({ message: DEJA_PARTIE });

                // La session en mémoire porte l'ancienne photo.
                auth.oublierUtilisateur(username);
                await photos.supprimer(url);
                logger.warn(`🧹 Photo de profil retirée par ${req.auth.username} : ${username}`);
                return res.json({ message: "Photo retirée." });
            }

            if (type === 'pool') {
                const nom = typeof corps.pool === 'string' ? corps.pool.trim() : '';
                if (!nom || !photos.estTeleversee(url, DOSSIER.pool)) {
                    return res.status(400).json({ message: "Image de pool invalide." });
                }

                await store.muterPool(nom, {
                    scope: 'admin:photo',
                    userId: req.auth.userId,
                    appliquer: async ({ data }) => {
                        if (data.imageUrl !== url) throw new ErreurMetier(409, DEJA_PARTIE);
                        delete data.imageUrl;
                        delete data.imageMeta;
                        return { valeur: {} };
                    }
                });

                await photos.supprimer(url);
                const frais = await store.lire(nom);
                if (frais) diffusion.poolMisAJour(nom, frais.data, frais.revision);
                logger.warn(`🧹 Image de pool retirée par ${req.auth.username} : ${nom}`);
                return res.json({ message: "Image retirée." });
            }

            return res.status(400).json({ message: "Type de photo inconnu." });
        } catch (erreur) {
            if (erreur instanceof ErreurMetier || erreur.name === 'ErreurMetier') {
                return res.status(erreur.code || 400).json({ message: erreur.message });
            }
            logger.error('Erreur /admin/photos/retirer :', erreur);
            res.status(500).json({ message: "Erreur interne du serveur." });
        }
    });
}

module.exports = { monter };
