/**
 * Comptes et sessions.
 *
 * `/login` vérifiait un mot de passe puis renvoyait un nom d'utilisateur que
 * le navigateur rangeait dans localStorage : une identité que le client
 * fabriquait lui-même. `/admin-login` comparait à un mot de passe écrit dans
 * le code, et `/admin-users` s'ouvrait à quiconque envoyait
 * `?adminToken=admin`. Ces trois portes sont fermées ici.
 *
 * Ce qui remplace : une session serveur. `/login` en ouvre une, le navigateur
 * ne porte qu'un cookie opaque HttpOnly, et `req.auth` devient la seule source
 * d'identité. L'administration se décide sur la colonne `is_admin` de la base,
 * jamais sur un champ envoyé par le client.
 */

'use strict';

const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const { contientGrossierete } = require('../profanity.js');
const poolOps = require('../lib/poolOps.js');

/**
 * Réponse volontairement identique pour « compte inconnu » et « mot de passe
 * incorrect ». Distinguer les deux dit à un inconnu quels noms existent.
 */
const ECHEC_CONNEXION = "Nom d'utilisateur ou mot de passe incorrect.";

function monter(app, ctx) {
    const { auth, store, db, usePostgres, chargerUtilisateurs, sauvegarderUtilisateurs,
            racine, diffusion, logger = console } = ctx;

    /** Récupère un compte avec son empreinte, quel que soit le magasin. */
    async function lireCompte(username) {
        if (usePostgres) return db.getUserByUsername(username);
        const utilisateurs = await chargerUtilisateurs();
        return utilisateurs.find(u => u.username === username) || null;
    }

    /** Vérifie nom + mot de passe. Renvoie le compte, ou null. */
    async function verifier(username, password) {
        if (!username || !password) return null;
        const compte = await lireCompte(username);
        if (!compte) {
            // Comparaison malgré tout : sans elle, un compte inexistant
            // répondrait nettement plus vite qu'un mot de passe faux, ce qui
            // suffit à énumérer les comptes.
            await bcrypt.compare(String(password), '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
            return null;
        }
        const correspond = await bcrypt.compare(String(password), compte.password);
        return correspond ? compte : null;
    }

    /** L'identifiant relationnel du compte, nécessaire aux nouvelles tables. */
    async function identifiantDe(username) {
        if (!usePostgres) return username;
        return db.getUserId(username);
    }

    // ───────────────────────────── Inscription ─────────────────────────────

    app.post('/signup', async (req, res) => {
        try {
            const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
            const password = req.body?.password;

            if (!username || !password) {
                return res.status(400).json({ message: "Nom d'utilisateur et mot de passe requis." });
            }
            if (username.length > 40) {
                return res.status(400).json({ message: "Le nom d'utilisateur ne peut pas dépasser 40 caractères." });
            }
            // bcrypt ignore silencieusement tout octet au-delà du 72e : mieux
            // vaut refuser que tronquer sans le dire.
            if (String(password).length < 6 || String(password).length > 72) {
                return res.status(400).json({ message: "Le mot de passe doit contenir entre 6 et 72 caractères." });
            }
            // Le contrôle vit ici et pas seulement dans le formulaire : la
            // route est ouverte, un client n'est pas obligé d'y passer.
            if (contientGrossierete(username)) {
                return res.status(400).json({
                    message: "Ce nom d'utilisateur contient un terme inapproprié. Choisissez-en un autre."
                });
            }

            const empreinte = await bcrypt.hash(String(password), 10);

            if (usePostgres) {
                if (await db.getUserByUsername(username)) {
                    return res.status(409).json({ message: "Ce nom d'utilisateur est déjà pris." });
                }
                await db.createUser(username, empreinte, false);
            } else {
                const utilisateurs = await chargerUtilisateurs();
                if (utilisateurs.some(u => u.username === username)) {
                    return res.status(409).json({ message: "Ce nom d'utilisateur est déjà pris." });
                }
                utilisateurs.push({ username, password: empreinte, isAdmin: false });
                await sauvegarderUtilisateurs(utilisateurs);
            }

            // Inscription = connexion : demander de se reconnecter aussitôt
            // après avoir créé son compte n'apporte rien.
            const compte = { id: await identifiantDe(username), username, isAdmin: false, avatarUrl: '' };
            await auth.ouvrirSession(res, compte, req);

            logger.log(`✅ Compte créé : ${username}`);
            res.json({ message: "Inscription réussie.", username, avatarUrl: '', isAdmin: false });
        } catch (erreur) {
            logger.error("Erreur à l'inscription :", erreur);
            res.status(500).json({ message: "Erreur interne du serveur." });
        }
    });

    // ───────────────────────────── Connexion ─────────────────────────────

    app.post('/login', async (req, res) => {
        try {
            const { username, password } = req.body || {};
            const compte = await verifier(username, password);
            if (!compte) return res.status(401).json({ message: ECHEC_CONNEXION });

            const identifiant = usePostgres ? await db.getUserId(compte.username) : compte.username;
            await auth.ouvrirSession(res, {
                id: identifiant,
                username: compte.username,
                isAdmin: !!compte.isAdmin,
                avatarUrl: compte.avatarUrl || ''
            }, req);

            res.json({
                message: "Connexion réussie.",
                username: compte.username,
                avatarUrl: compte.avatarUrl || '',
                isAdmin: !!compte.isAdmin
            });
        } catch (erreur) {
            logger.error('Erreur à la connexion :', erreur);
            res.status(500).json({ message: "Erreur interne du serveur." });
        }
    });

    /**
     * Connexion d'administration.
     *
     * Même vérification que tout le monde, plus la colonne `is_admin`. Le mot
     * de passe codé en dur qui vivait ici acceptait n'importe qui le
     * connaissait — et il était lisible dans le dépôt.
     */
    app.post('/admin-login', async (req, res) => {
        try {
            const { username, password } = req.body || {};
            const compte = await verifier(username, password);
            if (!compte || !compte.isAdmin) {
                return res.status(401).json({ message: "Identifiants d'administration invalides." });
            }

            const identifiant = usePostgres ? await db.getUserId(compte.username) : compte.username;
            await auth.ouvrirSession(res, {
                id: identifiant,
                username: compte.username,
                isAdmin: true,
                avatarUrl: compte.avatarUrl || ''
            }, req);

            res.json({ message: "Connexion d'administration réussie.", username: compte.username, isAdmin: true });
        } catch (erreur) {
            logger.error("Erreur à la connexion d'administration :", erreur);
            res.status(500).json({ message: "Erreur interne du serveur." });
        }
    });

    /** Déconnexion : la session est révoquée côté serveur, pas seulement oubliée. */
    app.post('/logout', async (req, res) => {
        try {
            await auth.fermerSession(req, res);
            res.json({ message: "Déconnecté." });
        } catch (erreur) {
            logger.error('Erreur à la déconnexion :', erreur);
            res.status(500).json({ message: "Erreur interne du serveur." });
        }
    });

    /**
     * Qui suis-je ?
     *
     * La page appelle cette route au chargement au lieu de croire son propre
     * localStorage. Une session expirée ou révoquée renvoie donc immédiatement
     * un état déconnecté, au lieu d'un écran qui se croit connecté jusqu'au
     * premier refus.
     */
    app.get('/session', async (req, res) => {
        if (!req.auth) return res.json({ authenticated: false });

        let avatarUrl = req.auth.avatarUrl || '';
        try {
            const compte = await lireCompte(req.auth.username);
            if (compte) avatarUrl = compte.avatarUrl || '';
        } catch { /* l'avatar est cosmétique : son échec n'invalide pas la session */ }

        res.json({
            authenticated: true,
            username: req.auth.username,
            isAdmin: req.auth.isAdmin,
            avatarUrl,
            // Non nul quand une administration est en train de dépanner sous
            // cette identité : c'est ce qui permet à la page de garder le menu
            // de bascule et d'offrir le retour.
            impersonatedBy: req.auth.impersonatorUsername || null
        });
    });

    // ───────────────────── Droits Loi 25 : export, suppression ─────────────────────

    /**
     * Portabilité. Exige la session ET le mot de passe : une session volée ne
     * doit pas suffire à télécharger l'ensemble des données d'une personne.
     */
    app.post('/account/export', auth.requireAuth, async (req, res) => {
        try {
            const compte = await verifier(req.auth.username, req.body?.password);
            if (!compte) return res.status(401).json({ message: "Mot de passe incorrect." });

            const username = req.auth.username;
            const tousLesPools = await store.lireTous();

            const pools = [];
            for (const [nomPool, enveloppe] of Object.entries(tousLesPools)) {
                for (const [nomEquipe, equipe] of Object.entries(enveloppe.data.teams || {})) {
                    if ((equipe.members || []).includes(username)) {
                        pools.push({
                            pool: nomPool,
                            equipe: nomEquipe,
                            membres: equipe.members,
                            offensive: equipe.offensive || [],
                            defensive: equipe.defensive || [],
                            goalie: equipe.goalie || [],
                            rookie: equipe.rookie || [],
                            teams: equipe.teams || []
                        });
                    }
                }
            }

            let notifications = [];
            if (usePostgres) {
                try {
                    const identifiant = await db.getUserId(username);
                    if (identifiant) notifications = await db.exportNotificationsForUser(identifiant);
                } catch (erreur) {
                    logger.error('Export des notifications impossible :', erreur.message);
                }
            }

            res.json({
                genereLe: new Date().toISOString(),
                compte: { username, avatarUrl: compte.avatarUrl || '' },
                pools,
                notifications
            });
        } catch (erreur) {
            logger.error("Erreur à l'export du compte :", erreur);
            res.status(500).json({ message: "Erreur interne du serveur." });
        }
    });

    /**
     * Suppression de compte.
     *
     * L'ordre compte : on dissocie des pools DANS une transaction par pool
     * (donc sans écraser les modifications d'autrui), puis on supprime le
     * compte, puis on révoque les sessions. Les lignes rattachées à
     * `users.id` — sessions, notifications — partent par cascade ; l'activité
     * garde ses événements mais perd son acteur (`ON DELETE SET NULL`), ce qui
     * conserve l'historique de compétition sans conserver de profil.
     */
    app.post('/account/delete', auth.requireAuth, async (req, res) => {
        try {
            const compte = await verifier(req.auth.username, req.body?.password);
            if (!compte) return res.status(401).json({ message: "Mot de passe incorrect." });

            const username = req.auth.username;
            const identifiant = usePostgres ? await db.getUserId(username) : username;

            const tousLesPools = await store.lireTous();
            const concernes = Object.entries(tousLesPools)
                .filter(([, enveloppe]) => poolOps.estMembre(enveloppe.data, username))
                .map(([nom]) => nom);

            for (const nomPool of concernes) {
                try {
                    await store.muterPool(nomPool, {
                        scope: 'compte:suppression',
                        appliquer: async ({ data }) => {
                            poolOps.quitterEquipe(data, username);
                            return { valeur: { pool: nomPool } };
                        }
                    });
                } catch (erreur) {
                    logger.error(`Dissociation impossible pour ${nomPool} :`, erreur.message);
                }
            }

            if (compte.avatarUrl && compte.avatarUrl.startsWith('/uploads/avatars/')) {
                const chemin = path.join(racine, compte.avatarUrl.replace(/^\//, ''));
                try { if (fs.existsSync(chemin)) fs.unlinkSync(chemin); }
                catch (erreur) { logger.warn('⚠️ Photo de profil non supprimée :', erreur.message); }
            }

            if (usePostgres) {
                await db.deleteUser(username);
            } else {
                const utilisateurs = await chargerUtilisateurs();
                await sauvegarderUtilisateurs(utilisateurs.filter(u => u.username !== username));
            }

            await auth.revoquerTout(identifiant);
            await auth.fermerSession(req, res);

            for (const nomPool of concernes) {
                try {
                    const frais = await store.lire(nomPool);
                    if (frais) diffusion.poolMisAJour(nomPool, frais.data, frais.revision);
                    await diffusion.resynchroniserPool(nomPool);
                } catch { /* diffusion : le prochain rafraîchissement rattrape */ }
            }
            await diffusion.resynchroniserUtilisateur(username);

            logger.log(`🗑️ Compte supprimé : ${username} (dissocié de ${concernes.length} pool(s))`);
            res.json({ message: "Compte supprimé définitivement.", poolsTouches: concernes.length });
        } catch (erreur) {
            logger.error('Erreur à la suppression du compte :', erreur);
            res.status(500).json({ message: "Erreur interne du serveur." });
        }
    });

    // ───────────────────────────── Administration ─────────────────────────────

    /**
     * Le pilote d'une session de bascule est-il encore administrateur ?
     *
     * `requireBascule` ne lit que la session, et la session porte l'identité
     * du pilote telle qu'elle était à l'ouverture. Si ses droits lui ont été
     * retirés depuis, la session de bascule continuerait sinon de circuler
     * d'un compte à l'autre jusqu'à son expiration. On relit donc la colonne,
     * comme partout ailleurs : `is_admin` vient de la base, jamais d'un
     * souvenir.
     *
     * Une session d'administration ordinaire ne coûte aucune lecture : son
     * `isAdmin` sort déjà de la jointure sur `users`.
     */
    async function piloteEncoreAdmin(req) {
        if (!req.auth || !req.auth.impersonatedBy) return true;
        const pilote = await lireCompte(req.auth.impersonatorUsername);
        return !!(pilote && pilote.isAdmin);
    }

    /** Refus commun aux deux routes de bascule. */
    async function refuserPiloteDechu(req, res) {
        if (await piloteEncoreAdmin(req)) return false;
        res.status(403).json({
            message: "La session d'administration qui a ouvert cette bascule n'est plus valable. Reconnectez-vous.",
            code: 'bascule_perimee'
        });
        return true;
    }

    app.get('/admin-users', auth.requireBascule, async (req, res) => {
        if (await refuserPiloteDechu(req, res)) return;
        try {
            const utilisateurs = await chargerUtilisateurs();
            res.json({ users: utilisateurs.map(u => u.username) });
        } catch (erreur) {
            logger.error('Erreur à la lecture des comptes :', erreur);
            res.status(500).json({ message: "Erreur interne du serveur." });
        }
    });

    /**
     * Basculer vers un autre compte, pour le dépannage.
     *
     * Ouvre réellement une session AU NOM de la personne visée : avant, la
     * route renvoyait simplement le nom demandé et le client le recopiait dans
     * localStorage — autant dire que n'importe qui pouvait « basculer » sans
     * rien demander à personne. Le basculement est journalisé : usurper une
     * identité, même pour aider, doit laisser une trace.
     */
    app.post('/admin-switch-user', auth.requireBascule, async (req, res) => {
        try {
            if (await refuserPiloteDechu(req, res)) return;

            const cible = typeof req.body?.targetUsername === 'string' ? req.body.targetUsername.trim() : '';
            if (!cible) return res.status(400).json({ message: "Compte cible requis." });

            const compte = await lireCompte(cible);
            if (!compte) return res.status(404).json({ message: "Compte introuvable." });

            // La racine de la chaîne, pas le maillon précédent. Sur
            // admin → fza → fzb, c'est toujours `admin` qui pilote : retenir
            // `fza` ferait d'une bascule un moyen de se donner un billet de
            // retour vers un compte qu'on n'a jamais possédé.
            const pilote = req.auth.impersonatedBy
                ? { id: req.auth.impersonatedBy, username: req.auth.impersonatorUsername }
                : { id: req.auth.userId, username: req.auth.username };

            // Revenir chez soi n'est pas une bascule : la session redevient
            // pleinement celle de l'administration, sans billet de retour.
            const retourChezSoi = compte.username === pilote.username;

            const identifiant = usePostgres ? await db.getUserId(cible) : cible;
            await auth.ouvrirSession(res, {
                id: identifiant,
                username: compte.username,
                isAdmin: !!compte.isAdmin,
                avatarUrl: compte.avatarUrl || ''
            }, req, retourChezSoi ? null : { impersonatedBy: pilote.id, impersonatorUsername: pilote.username });

            logger.warn(
                retourChezSoi
                    ? `🔐 Fin de bascule : ${req.auth.username} → ${cible} (retour)`
                    : `🔐 Bascule d'administration : ${pilote.username} → ${cible}`
            );
            res.json({
                message: retourChezSoi ? `Retour au compte ${cible}.` : `Basculé vers ${cible}.`,
                username: cible,
                isAdmin: !!compte.isAdmin,
                impersonatedBy: retourChezSoi ? null : pilote.username
            });
        } catch (erreur) {
            logger.error('Erreur au changement de compte :', erreur);
            res.status(500).json({ message: "Erreur interne du serveur." });
        }
    });

    /** Profil public : le nom et l'avatar, rien d'autre. */
    app.get('/user-profile/:username', async (req, res) => {
        try {
            const compte = await lireCompte(req.params.username);
            if (!compte) return res.status(404).json({ message: "Utilisateur non trouvé." });
            res.json({ username: compte.username, avatarUrl: compte.avatarUrl || '' });
        } catch (erreur) {
            logger.error('Erreur /user-profile :', erreur);
            res.status(500).json({ message: "Erreur interne." });
        }
    });

    return { verifier, lireCompte, identifiantDe };
}

module.exports = { monter, ECHEC_CONNEXION };
