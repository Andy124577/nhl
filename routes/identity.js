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
const crypto = require('crypto');

const { contientGrossierete } = require('../profanity.js');
const poolOps = require('../lib/poolOps.js');
const { erreurNom, erreurMotDePasse } = require('../lib/reglesCompte.js');
const { creerLimiteTentatives, adresseClient, refuserTropDeTentatives } = require('../lib/limiteTentatives.js');

/**
 * Réponse volontairement identique pour « compte inconnu » et « mot de passe
 * incorrect ». Distinguer les deux dit à un inconnu quels noms existent.
 */
const ECHEC_CONNEXION = "Nom d'utilisateur ou mot de passe incorrect.";

/** Coût bcrypt des empreintes de comptes. */
const TOURS_BCRYPT = 10;

/**
 * Une vraie empreinte, au même coût que celles des comptes, à comparer quand
 * le compte n'existe pas. La constante qui en tenait lieu n'en était pas une
 * (66 caractères au lieu de 60) : bcrypt la rejetait sans rien calculer, et un
 * nom inconnu répondait des centaines de fois plus vite qu'un mot de passe
 * faux. Calculée au premier besoin, une fois par processus.
 */
let empreinteFictive = null;
function empreinteDeComparaison() {
    if (!empreinteFictive) empreinteFictive = bcrypt.hash(crypto.randomBytes(18).toString('base64'), TOURS_BCRYPT);
    return empreinteFictive;
}

function monter(app, ctx) {
    const { auth, store, db, usePostgres, chargerUtilisateurs, sauvegarderUtilisateurs,
            photos, diffusion, logger = console } = ctx;
    // Partagé avec routes/google.js et routes/pools.js par server.js : un
    // compte visé par /login et par /auth/google/lier n'a qu'un compteur.
    const tentatives = ctx.tentatives || creerLimiteTentatives();
    const adresseDe = ctx.adresseClient || adresseClient;

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
        // Un compte ouvert par Google n'a pas de mot de passe : aucun mot de
        // passe ne doit l'ouvrir, pas même une chaîne vide.
        if (!compte || !compte.password) {
            // Comparaison malgré tout : sans elle, un compte inexistant
            // répondrait nettement plus vite qu'un mot de passe faux, ce qui
            // suffit à énumérer les comptes.
            await bcrypt.compare(String(password), await empreinteDeComparaison());
            return null;
        }
        const correspond = await bcrypt.compare(String(password), compte.password);
        return correspond ? compte : null;
    }

    /**
     * `verifier`, derrière le compteur de tentatives (lib/limiteTentatives.js).
     *
     * Renvoie { compte } — null si refusé — ou { attenteMs } quand il faut
     * patienter : la vérification n'a alors même pas lieu. Un appel sans nom
     * ou sans mot de passe n'est pas un essai et ne compte pas.
     */
    async function verifierAvecLimite(req, username, password) {
        const qui = { compte: username, adresse: adresseDe(req) };
        const attenteMs = tentatives.attente('connexion', qui);
        if (attenteMs > 0) return { compte: null, attenteMs };

        const compte = await verifier(username, password);
        if (compte) tentatives.reussite('connexion', qui);
        else if (username && password) tentatives.echec('connexion', qui);
        return { compte, attenteMs: 0 };
    }

    /**
     * Confirme l'identité avant un geste lourd (export, suppression).
     *
     * Compte à mot de passe : le mot de passe. Compte ouvert par Google : il
     * n'y a rien à redemander, on exige alors le nom du compte retapé — une
     * barrière contre le geste réflexe, à défaut d'une preuve de possession.
     */
    async function confirmer(req) {
        const compte = await lireCompte(req.auth.username);
        if (compte && !compte.password) {
            const confirmation = typeof req.body?.confirmation === 'string' ? req.body.confirmation.trim() : '';
            return confirmation === compte.username
                ? { compte }
                : { message: "Le nom d'utilisateur saisi ne correspond pas." };
        }
        // Compté comme une connexion : une session volée ne doit pas servir à
        // deviner le mot de passe par l'export ou la suppression.
        const { compte: verifie, attenteMs } = await verifierAvecLimite(req, req.auth.username, req.body?.password);
        if (attenteMs) return { attenteMs };
        return verifie ? { compte: verifie } : { message: "Mot de passe incorrect." };
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
            // Les contrôles vivent ici et pas seulement dans le formulaire : la
            // route est ouverte, un client n'est pas obligé d'y passer. Un nom
            // limité à lettres, chiffres et « _ » ne peut pas porter de HTML.
            const refusNom = erreurNom(username);
            if (refusNom) return res.status(400).json({ message: refusNom });
            if (contientGrossierete(username)) {
                return res.status(400).json({
                    message: "Ce nom d'utilisateur contient un terme inapproprié. Choisissez-en un autre."
                });
            }
            const refusMotDePasse = erreurMotDePasse(password, { username });
            if (refusMotDePasse) return res.status(400).json({ message: refusMotDePasse });

            const empreinte = await bcrypt.hash(password, TOURS_BCRYPT);

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
            const { compte, attenteMs } = await verifierAvecLimite(req, username, password);
            if (attenteMs) return refuserTropDeTentatives(res, attenteMs);
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
            const { compte, attenteMs } = await verifierAvecLimite(req, username, password);
            if (attenteMs) return refuserTropDeTentatives(res, attenteMs);
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
        let hasPassword = true;
        try {
            const compte = await lireCompte(req.auth.username);
            if (compte) {
                avatarUrl = compte.avatarUrl || '';
                hasPassword = !!compte.password;
            }
        } catch { /* l'avatar est cosmétique : son échec n'invalide pas la session */ }

        res.json({
            authenticated: true,
            username: req.auth.username,
            isAdmin: req.auth.isAdmin,
            avatarUrl,
            // Faux pour un compte ouvert par Google : l'export et la
            // suppression demandent alors le nom du compte, pas un mot de passe.
            hasPassword,
            // Non nul quand une administration est en train de dépanner sous
            // cette identité : c'est ce qui permet à la page de garder le menu
            // de bascule et d'offrir le retour.
            impersonatedBy: req.auth.impersonatorUsername || null
        });
    });

    // ───────────────────────────── Mot de passe ─────────────────────────────

    /**
     * Changer son mot de passe.
     *
     * Le mot de passe actuel est exigé, et compté comme une tentative de
     * connexion : une session volée ne doit ni suffire à le changer, ni servir
     * à le deviner. Le changement ferme toutes les sessions du compte — c'est
     * ce qu'on attend en changeant un mot de passe qu'on croit connu d'autrui —
     * puis rouvre celle de ce navigateur.
     *
     * Refusé pendant une bascule d'administration : dépanner un compte n'est
     * pas en prendre possession.
     */
    app.post('/account/password', auth.requireAuth, async (req, res) => {
        try {
            if (req.auth.impersonatedBy) {
                return res.status(403).json({
                    message: "Impossible de changer le mot de passe d'un compte pendant une bascule d'administration.",
                    code: 'bascule'
                });
            }
            const username = req.auth.username;
            const actuel = req.body?.currentPassword;
            const nouveau = req.body?.newPassword;

            const existant = await lireCompte(username);
            if (!existant) return res.status(404).json({ message: "Compte introuvable." });
            if (!existant.password) {
                return res.status(400).json({
                    message: "Ce compte se connecte avec Google : il n'a pas de mot de passe à changer.",
                    code: 'compte_google'
                });
            }
            if (typeof actuel !== 'string' || !actuel) {
                return res.status(400).json({ message: "Saisissez votre mot de passe actuel." });
            }

            // Le nouveau d'abord : une faute de frappe dans le nouveau mot de
            // passe ne doit pas coûter un essai sur l'actuel.
            const refus = erreurMotDePasse(nouveau, { username });
            if (refus) return res.status(400).json({ message: refus });
            if (nouveau === actuel) {
                return res.status(400).json({ message: "Le nouveau mot de passe doit être différent de l'actuel." });
            }

            const { compte, attenteMs } = await verifierAvecLimite(req, username, actuel);
            if (attenteMs) return refuserTropDeTentatives(res, attenteMs);
            if (!compte) return res.status(401).json({ message: "Mot de passe actuel incorrect." });

            const empreinte = await bcrypt.hash(nouveau, TOURS_BCRYPT);
            let ecrit = false;
            if (usePostgres) {
                ecrit = await db.updateUserPassword(username, empreinte);
            } else {
                const utilisateurs = await chargerUtilisateurs();
                const ligne = utilisateurs.find(u => u.username === username);
                if (ligne && ligne.password) {
                    ligne.password = empreinte;
                    await sauvegarderUtilisateurs(utilisateurs);
                    ecrit = true;
                }
            }
            if (!ecrit) return res.status(404).json({ message: "Compte introuvable." });

            // Toutes les sessions tombent, celle-ci comprise, puis celle-ci est
            // rouverte : ce navigateur reste connecté, les autres non.
            await auth.revoquerTout(req.auth.userId);
            await auth.ouvrirSession(res, {
                id: req.auth.userId,
                username,
                isAdmin: !!compte.isAdmin,
                avatarUrl: compte.avatarUrl || ''
            }, req);

            logger.log(`🔑 Mot de passe changé : ${username}`);
            res.json({ message: "Mot de passe changé. Vos autres appareils ont été déconnectés." });
        } catch (erreur) {
            logger.error('Erreur au changement de mot de passe :', erreur);
            res.status(500).json({ message: "Erreur interne du serveur." });
        }
    });

    // ───────────────────── Droits Loi 25 : export, suppression ─────────────────────

    /**
     * Portabilité. Exige la session ET le mot de passe : une session volée ne
     * doit pas suffire à télécharger l'ensemble des données d'une personne.
     */
    app.post('/account/export', auth.requireAuth, async (req, res) => {
        try {
            const { compte, message, attenteMs } = await confirmer(req);
            if (attenteMs) return refuserTropDeTentatives(res, attenteMs);
            if (!compte) return res.status(401).json({ message });

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
            // Les navigateurs abonnés aux alertes : lequel, et depuis quand.
            // Pas leurs clés, qui ne servent qu'à chiffrer pour eux.
            let appareilsAlertes = [];
            if (usePostgres) {
                try {
                    const identifiant = await db.getUserId(username);
                    if (identifiant) {
                        notifications = await db.exportNotificationsForUser(identifiant);
                        if (typeof db.exportPushSubscriptionsForUser === 'function') {
                            appareilsAlertes = (await db.exportPushSubscriptionsForUser(identifiant))
                                .map(a => ({ navigateur: a.user_agent || null, depuis: a.created_at }));
                        }
                    }
                } catch (erreur) {
                    logger.error('Export des notifications impossible :', erreur.message);
                }
            }

            res.json({
                genereLe: new Date().toISOString(),
                compte: { username, avatarUrl: compte.avatarUrl || '', connexionGoogle: !!compte.googleSub },
                pools,
                notifications,
                appareilsAlertes
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
            const { compte, message, attenteMs } = await confirmer(req);
            if (attenteMs) return refuserTropDeTentatives(res, attenteMs);
            if (!compte) return res.status(401).json({ message });

            const username = req.auth.username;
            const identifiant = usePostgres ? await db.getUserId(username) : username;

            const tousLesPools = await store.lireTous();
            // Une invitation en attente porte aussi le nom de la personne :
            // elle part avec le compte, comme l'appartenance.
            const concernes = Object.entries(tousLesPools)
                .filter(([, enveloppe]) => poolOps.estMembre(enveloppe.data, username) ||
                    !!poolOps.invitationPour(enveloppe.data, username))
                .map(([nom]) => nom);

            for (const nomPool of concernes) {
                try {
                    await store.muterPool(nomPool, {
                        scope: 'compte:suppression',
                        appliquer: async ({ data }) => {
                            if (poolOps.estMembre(data, username)) poolOps.quitterEquipe(data, username);
                            poolOps.retirerInvitation(data, username);
                            return { valeur: { pool: nomPool } };
                        }
                    });
                } catch (erreur) {
                    logger.error(`Dissociation impossible pour ${nomPool} :`, erreur.message);
                }
            }

            if (compte.avatarUrl) await photos.supprimer(compte.avatarUrl);

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

    return { verifier, verifierAvecLimite, lireCompte, identifiantDe };
}

module.exports = { monter, ECHEC_CONNEXION };
