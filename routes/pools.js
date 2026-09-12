/**
 * Pools : création, appartenance, configuration, démarrage du repêchage.
 *
 * Toutes les écritures passent par le contrat de mutation
 * (services/poolStore.js) : une transaction, un verrou sur la ligne du pool,
 * une validation à partir de l'état réel, puis COMMIT avant tout accusé de
 * réception. Plus aucune route ne recharge tous les pools pour en réécrire un.
 *
 * Trois routes vivaient en double dans server.js — `/delete-clan`,
 * `/join-clan`, `/draft-order/:clanName`. La seconde définition ne servait
 * jamais, et les deux versions ne faisaient pas la même chose : ici chacune
 * n'existe qu'une fois, celle qui vérifie les droits.
 */

'use strict';

const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const { contientGrossierete } = require('../profanity.js');
const authz = require('../lib/authz.js');
const poolOps = require('../lib/poolOps.js');
const evenements = require('../lib/events.js');
const { checkIfDraftComplete } = require('../lib/draft.js');

/** Équipes préparées d'avance à la création. */
const EQUIPES_PAR_POOL = 10;

/** Nom de pool : lettres, chiffres, espaces, tiret, apostrophe, souligné. */
const NOM_VALIDE = /^[\p{L}\p{N}\s'\-_]+$/u;

/** Comparaison insensible à la casse ET aux accents : « Élan » et « Elan »
 *  seraient impossibles à distinguer au téléphone. */
const reduire = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function monter(app, ctx) {
    const { auth, store, diffusion, racine, uploadPool, logger = console } = ctx;
    const { ErreurMetier } = store;

    /** Traduit une erreur du contrat en réponse HTTP. */
    function repondreErreur(res, erreur, contexte) {
        if (erreur instanceof ErreurMetier || erreur.name === 'ErreurMetier' || erreur.name === 'ErreurConflit') {
            return res.status(erreur.code || 400).json({ message: erreur.message, ...(erreur.extra || {}) });
        }
        logger.error(`Erreur ${contexte} :`, erreur);
        return res.status(500).json({ message: "Erreur interne du serveur." });
    }

    /** Refus métier renvoyé par lib/poolOps : `{ ok:false, code, message }`. */
    function refus(resultat) {
        return new ErreurMetier(resultat.code || 400, resultat.message, resultat.conflit ? { conflit: resultat.conflit } : {});
    }

    // ───────────────────────────── Lectures ─────────────────────────────

    /**
     * L'état des pools, cadré sur l'identité.
     *
     * Avant, cette route renvoyait l'état complet de TOUS les pools à qui le
     * demandait — alignements, historiques de choix, classements, membres.
     * Maintenant : le détail pour les pools dont on est membre, un résumé de
     * découverte pour les autres.
     */
    app.get('/draft', async (req, res) => {
        try {
            const pools = await store.lireTous();
            const sortie = {};
            for (const [nom, enveloppe] of Object.entries(pools)) {
                const membre = req.auth && (req.auth.isAdmin || authz.estMembre(enveloppe.data, req.auth.username));
                sortie[nom] = membre
                    ? authz.vueMembre(nom, enveloppe.data, enveloppe.revision)
                    : authz.resumePublic(nom, enveloppe.data);
            }
            res.json(sortie);
        } catch (erreur) {
            repondreErreur(res, erreur, '/draft');
        }
    });

    /** Les pools dont la personne connectée est membre. */
    app.get('/active-drafts', auth.requireAuth, async (req, res) => {
        try {
            const pools = await store.lireTous();
            const activeDrafts = Object.entries(pools)
                .filter(([, enveloppe]) => authz.estMembre(enveloppe.data, req.auth.username))
                .map(([nom]) => nom);
            res.json({ activeDrafts });
        } catch (erreur) {
            repondreErreur(res, erreur, '/active-drafts');
        }
    });

    /** L'ordre de sélection. Réservé aux membres : il décrit la partie en cours. */
    app.get('/draft-order/:clanName', auth.requireAuth, async (req, res) => {
        try {
            const enveloppe = await store.lire(req.params.clanName);
            if (!enveloppe) return res.status(404).json({ message: "Pool introuvable." });
            if (!req.auth.isAdmin && !authz.estMembre(enveloppe.data, req.auth.username)) {
                return res.status(403).json({ message: "Vous n'êtes pas membre de ce pool." });
            }
            res.json({ draftOrder: enveloppe.data.draftOrder || [], revision: enveloppe.revision });
        } catch (erreur) {
            repondreErreur(res, erreur, '/draft-order');
        }
    });


    /**
     * Les équipes d'un pool : ce qu'il faut pour en choisir une.
     *
     * Deux vues selon qui demande. Un membre voit ses coéquipiers, comme avant.
     * Quelqu'un qui envisage d'entrer voit le nom des équipes, combien de
     * places sont prises, et lesquelles sont pleines — assez pour choisir, sans
     * la liste des participants. Savoir QUI est dans une équipe est déjà une
     * information de membre.
     *
     * C'est cette route que la page « Rejoindre un pool » interroge : /draft ne
     * livre plus les alignements des pools qu'on n'a pas rejoints.
     */
    app.get('/pool-teams/:poolName', async (req, res) => {
        try {
            const nom = req.params.poolName;
            const enveloppe = await store.lire(nom);
            if (!enveloppe) return res.status(404).json({ message: "Pool introuvable." });

            const data = enveloppe.data;
            const membre = req.auth && (req.auth.isAdmin || authz.estMembre(data, req.auth.username));
            const equipes = Object.entries(data.teams || {});

            res.json({
                poolName: nom,
                isMember: !!membre,
                hasPassword: !!data.passwordHash,
                imageUrl: data.imageUrl || '',
                draftStarted: Array.isArray(data.draftOrder) && data.draftOrder.length > 0,
                maxParTeam: poolOps.MEMBRES_PAR_EQUIPE,
                monEquipe: req.auth ? authz.equipeDe(data, req.auth.username) : null,
                revision: enveloppe.revision,
                teams: equipes.map(([nomEquipe, equipe]) => {
                    const membres = equipe.members || [];
                    const commun = {
                        name: nomEquipe,
                        memberCount: membres.length,
                        full: membres.length >= poolOps.MEMBRES_PAR_EQUIPE,
                        clubs: equipe.teams || []
                    };
                    return membre ? { ...commun, members: membres } : commun;
                })
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/pool-teams');
        }
    });

    // ───────────────────────────── Création ─────────────────────────────

    app.post('/create-clan', auth.requireAuth, async (req, res) => {
        try {
            const nom = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
            const { maxPlayers, config, poolMode, allowTrades, password } = req.body || {};
            const username = req.auth.username;

            if (!nom) return res.status(400).json({ message: "Nom de pool requis." });
            if (nom.length < 3 || nom.length > 30) {
                return res.status(400).json({ message: "Le nom du pool doit contenir entre 3 et 30 caractères." });
            }
            if (!NOM_VALIDE.test(nom)) {
                return res.status(400).json({ message: "Nom invalide. Caractères non autorisés." });
            }
            if (contientGrossierete(nom)) {
                return res.status(400).json({ message: "Ce nom de pool contient un terme inapproprié. Choisissez-en un autre." });
            }

            // Le mot de passe du pool est traité comme celui d'un compte :
            // même algorithme, même coût, jamais conservé en clair. La borne
            // haute vient de bcrypt, qui ignore tout octet au-delà du 72e.
            let passwordHash = null;
            if (typeof password === 'string' && password.length > 0) {
                if (password.length < 4 || password.length > 72) {
                    return res.status(400).json({ message: "Le mot de passe du pool doit contenir entre 4 et 72 caractères." });
                }
                passwordHash = await bcrypt.hash(password, 10);
            }

            const quotas = { ...poolOps.CONFIG_PAR_DEFAUT, ...(config || {}) };
            if (quotas.numTeams == null) quotas.numTeams = 1;

            const teams = {};
            for (let i = 1; i <= EQUIPES_PAR_POOL; i++) {
                teams[`Équipe ${i}`] = { members: [], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] };
            }
            teams['Équipe 1'].members.push(username);

            const poolData = {
                maxPlayers: parseInt(maxPlayers, 10) || EQUIPES_PAR_POOL,
                creator: username,
                draftOrder: [],
                currentPickIndex: 0,
                lastPickIndex: -1,
                config: quotas,
                poolMode: poolMode === 'head-to-head' ? 'head-to-head' : 'cumulative',
                allowTrades: allowTrades !== false,
                createdAt: new Date().toISOString(),
                teams
            };
            if (passwordHash) poolData.passwordHash = passwordHash;
            if (poolData.poolMode === 'head-to-head') {
                poolData.h2hData = {
                    currentWeek: 1,
                    seasonStart: null,
                    weekStart: null,
                    matchups: [],
                    standings: {},
                    matchupHistory: []
                };
            }

            // Création et contrôle d'unicité dans la MÊME transaction : deux
            // requêtes simultanées avec le même nom ne peuvent pas toutes deux
            // passer le contrôle avant d'écrire.
            const { valeur } = await store.transaction(async (tx) => {
                const existants = await store.lireTous();
                const collision = Object.keys(existants).some(autre => reduire(autre) === reduire(nom));
                if (collision) throw new ErreurMetier(409, "Un pool porte déjà ce nom.");

                const cree = await tx.creerPool(nom, poolData);
                if (!cree) throw new ErreurMetier(409, "Un pool porte déjà ce nom.");
                return { poolName: nom, revision: cree.revision };
            }, { scope: 'pool:creation', userId: req.auth.userId });

            await diffusion.resynchroniserUtilisateur(username);
            diffusion.poolMisAJour(nom, poolData, valeur.revision);

            logger.log(`🆕 Pool créé : ${nom} par ${username}`);
            res.json({
                message: `Pool « ${nom} » créé. Vous avez été ajouté à l'Équipe 1.`,
                poolName: nom,
                revision: valeur.revision,
                pool: authz.vueMembre(nom, poolData, valeur.revision),
                autoJoined: true
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/create-clan');
        }
    });

    /** Supprimer un pool. Réservé à la personne qui l'a créé (ou à l'administration). */
    app.post('/delete-clan', auth.requireAuth, async (req, res) => {
        try {
            const nom = typeof req.body?.clanName === 'string' ? req.body.clanName.trim() : '';
            if (!nom) return res.status(400).json({ message: "Nom du pool requis." });

            const { valeur: membres } = await store.transaction(async (tx) => {
                const verrouille = await tx.verrouillerPool(nom);
                if (!verrouille) throw new ErreurMetier(404, "Ce pool n'existe pas.");
                if (!authz.peutAdministrer(verrouille.data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                    throw new ErreurMetier(403, "Seule la personne qui a créé le pool peut le supprimer.");
                }
                const noms = authz.membresDuPool(verrouille.data);
                await tx.supprimerPool(nom);
                return noms;
            }, { scope: 'pool:suppression', userId: req.auth.userId });

            // Les lignes rattachées au nom du pool partent avec lui : sinon
            // un pool recréé sous le même nom hériterait des échanges et des
            // annonces du précédent.
            if (ctx.nettoyerDependances) {
                try { await ctx.nettoyerDependances(nom); }
                catch (erreur) { logger.error('Nettoyage des dépendances impossible :', erreur.message); }
            }

            diffusion.versPool(nom, 'poolSupprime', { poolName: nom });
            for (const membre of membres) {
                await diffusion.resynchroniserUtilisateur(membre);
            }

            logger.log(`🗑️ Pool supprimé : ${nom} par ${req.auth.username}`);
            res.json({ message: `Pool « ${nom} » supprimé.` });
        } catch (erreur) {
            repondreErreur(res, erreur, '/delete-clan');
        }
    });

    // ───────────────────────────── Appartenance ─────────────────────────────

    /**
     * Entrer dans un pool, ou changer d'équipe.
     *
     * Le mot de passe n'est exigé qu'à l'entrée : un membre a déjà franchi la
     * porte, la lui refermer au nez à chaque changement d'équipe n'ajouterait
     * rien. La vérification bcrypt a lieu AVANT la transaction — elle prend du
     * temps, et tenir un verrou de ligne pendant ce temps ferait attendre tout
     * le pool.
     */
    app.post('/join-team', auth.requireAuth, async (req, res) => {
        try {
            const nom = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
            const teamName = req.body?.teamName;
            const username = req.auth.username;

            if (!nom || !teamName) return res.status(400).json({ message: "Pool et équipe requis." });

            const enveloppe = await store.lire(nom);
            if (!enveloppe) return res.status(404).json({ message: "Pool introuvable." });

            const dejaMembre = authz.estMembre(enveloppe.data, username);
            if (enveloppe.data.passwordHash && !dejaMembre) {
                const fourni = req.body?.password;
                if (typeof fourni !== 'string' || fourni.length === 0) {
                    return res.status(401).json({ message: "Ce pool est protégé par un mot de passe.", passwordRequired: true });
                }
                const correspond = await bcrypt.compare(fourni, enveloppe.data.passwordHash);
                if (!correspond) {
                    return res.status(401).json({ message: "Mot de passe incorrect.", passwordRequired: true });
                }
            }

            const { valeur } = await store.muterPool(nom, {
                scope: 'pool:rejoindre',
                userId: req.auth.userId,
                appliquer: async ({ data }) => {
                    // Revérifié sous verrou : le mot de passe a pu changer, ou
                    // la dernière place partir, entre la lecture et l'écriture.
                    if (data.passwordHash && !authz.estMembre(data, username) && !enveloppe.data.passwordHash) {
                        throw new ErreurMetier(401, "Ce pool est maintenant protégé par un mot de passe.");
                    }
                    const resultat = poolOps.rejoindreEquipe(data, { username, teamName });
                    if (!resultat.ok) throw refus(resultat);
                    return { valeur: { teamName: resultat.teamName, equipePrecedente: resultat.equipePrecedente } };
                }
            });

            const frais = await store.lire(nom);
            await diffusion.resynchroniserUtilisateur(username);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);

            res.json({
                message: `Vous avez rejoint ${valeur.teamName} dans ${nom}.`,
                teamName: valeur.teamName,
                revision: valeur.revision,
                pool: authz.vueMembre(nom, frais.data, frais.revision)
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/join-team');
        }
    });

    /**
     * Entrer dans un pool sans choisir son équipe : le serveur place dans la
     * première équipe libre.
     *
     * Une seule définition — server.js en avait deux, dont la première ne
     * faisait rien d'autre que répondre.
     */
    app.post('/join-clan', auth.requireAuth, async (req, res) => {
        try {
            const nom = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
            const username = req.auth.username;
            if (!nom) return res.status(400).json({ message: "Nom du pool requis." });

            const enveloppe = await store.lire(nom);
            if (!enveloppe) return res.status(404).json({ message: "Pool introuvable." });

            if (enveloppe.data.passwordHash && !authz.estMembre(enveloppe.data, username)) {
                const fourni = req.body?.password;
                if (typeof fourni !== 'string' || fourni.length === 0) {
                    return res.status(401).json({ message: "Ce pool est protégé par un mot de passe.", passwordRequired: true });
                }
                if (!await bcrypt.compare(fourni, enveloppe.data.passwordHash)) {
                    return res.status(401).json({ message: "Mot de passe incorrect.", passwordRequired: true });
                }
            }

            const { valeur } = await store.muterPool(nom, {
                scope: 'pool:entrer',
                userId: req.auth.userId,
                appliquer: async ({ data }) => {
                    if (authz.estMembre(data, username)) {
                        return { sauvegarder: false, valeur: { teamName: authz.equipeDe(data, username), deja: true } };
                    }
                    const libre = Object.entries(data.teams || {})
                        .find(([, equipe]) => (equipe.members || []).length < poolOps.MEMBRES_PAR_EQUIPE);
                    if (!libre) throw new ErreurMetier(409, "Toutes les équipes de ce pool sont complètes.");

                    const resultat = poolOps.rejoindreEquipe(data, { username, teamName: libre[0] });
                    if (!resultat.ok) throw refus(resultat);
                    return { valeur: { teamName: resultat.teamName, deja: false } };
                }
            });

            const frais = await store.lire(nom);
            await diffusion.resynchroniserUtilisateur(username);
            if (!valeur.deja) diffusion.poolMisAJour(nom, frais.data, frais.revision);

            res.json({
                message: valeur.deja
                    ? `Vous êtes déjà membre de ${nom}.`
                    : `Vous avez rejoint ${nom}. Choisissez votre équipe.`,
                teamName: valeur.teamName,
                revision: valeur.revision,
                pool: authz.vueMembre(nom, frais.data, frais.revision)
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/join-clan');
        }
    });

    /** Changer d'équipe dans un pool qu'on a déjà rejoint. */
    app.post('/change-team', auth.requireAuth, async (req, res) => {
        try {
            const nom = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
            const teamName = req.body?.newTeamNumber || req.body?.teamName;
            const username = req.auth.username;
            if (!nom || !teamName) return res.status(400).json({ message: "Pool et équipe requis." });

            const { valeur } = await store.muterPool(nom, {
                scope: 'pool:changer-equipe',
                userId: req.auth.userId,
                appliquer: async ({ data }) => {
                    if (!authz.estMembre(data, username)) {
                        throw new ErreurMetier(403, "Vous n'êtes membre d'aucune équipe de ce pool.");
                    }
                    const resultat = poolOps.rejoindreEquipe(data, { username, teamName });
                    if (!resultat.ok) throw refus(resultat);
                    return { valeur: { teamName: resultat.teamName } };
                }
            });

            const frais = await store.lire(nom);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);

            res.json({ message: `Vous avez rejoint ${valeur.teamName}.`, teamName: valeur.teamName, revision: valeur.revision });
        } catch (erreur) {
            repondreErreur(res, erreur, '/change-team');
        }
    });

    /** Quitter son équipe. Les sélections restent à l'équipe. */
    app.post('/leave-team', auth.requireAuth, async (req, res) => {
        try {
            const nom = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
            const username = req.auth.username;
            if (!nom) return res.status(400).json({ message: "Nom du pool requis." });

            const { valeur } = await store.muterPool(nom, {
                scope: 'pool:quitter',
                userId: req.auth.userId,
                appliquer: async ({ data }) => {
                    const resultat = poolOps.quitterEquipe(data, username);
                    if (!resultat.ok) throw refus(resultat);
                    return { valeur: { teamName: resultat.teamName } };
                }
            });

            const frais = await store.lire(nom);
            await diffusion.resynchroniserUtilisateur(username);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);

            res.json({ message: `Vous avez quitté ${valeur.teamName}.`, revision: valeur.revision });
        } catch (erreur) {
            repondreErreur(res, erreur, '/leave-team');
        }
    });

    /** Renommer son équipe. */
    app.post('/rename-team', auth.requireAuth, async (req, res) => {
        try {
            const nom = typeof req.body?.clanName === 'string' ? req.body.clanName.trim() : '';
            const ancien = req.body?.oldTeamName;
            const propose = typeof req.body?.newTeamName === 'string' ? req.body.newTeamName.trim() : '';

            if (!nom || !ancien || !propose) return res.status(400).json({ message: "Paramètres manquants." });
            if (propose.length === 0 || propose.length > 20) {
                return res.status(400).json({ message: "Le nom doit contenir entre 1 et 20 caractères." });
            }
            if (!NOM_VALIDE.test(propose)) {
                return res.status(400).json({ message: "Nom invalide. Caractères non autorisés." });
            }
            if (contientGrossierete(propose)) {
                return res.status(400).json({ message: "Ce nom d'équipe contient un terme inapproprié. Choisissez-en un autre." });
            }

            const { valeur } = await store.muterPool(nom, {
                scope: 'pool:renommer-equipe',
                userId: req.auth.userId,
                appliquer: async ({ data }) => {
                    const resultat = poolOps.renommerEquipe(data, {
                        ancien, nouveau: propose,
                        username: req.auth.username, estAdmin: req.auth.isAdmin
                    });
                    if (!resultat.ok) throw refus(resultat);
                    return { valeur: { newTeamName: resultat.teamName } };
                }
            });

            const frais = await store.lire(nom);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);

            res.json({ message: `Équipe renommée en « ${valeur.newTeamName} ».`, newTeamName: valeur.newTeamName, revision: valeur.revision });
        } catch (erreur) {
            repondreErreur(res, erreur, '/rename-team');
        }
    });

    /**
     * Renommer un pool.
     *
     * Le nom d'un pool n'est pas une étiquette : c'est la clé sous laquelle
     * vivent ses données, et la clé étrangère de tout ce qui s'y rattache —
     * échanges, annonces, relevés de rang. Le renommage les suit tous, dans
     * une seule transaction : un renommage à moitié fait ferait disparaître
     * l'historique d'échanges du pool.
     */
    app.post('/rename-pool', auth.requireAuth, async (req, res) => {
        try {
            const ancien = typeof req.body?.oldName === 'string' ? req.body.oldName.trim() : '';
            const propose = typeof req.body?.newName === 'string' ? req.body.newName.trim() : '';
            if (!ancien || !propose) return res.status(400).json({ message: "Paramètres manquants." });
            if (propose === ancien) return res.status(400).json({ message: "Le nouveau nom est identique à l'ancien." });
            if (propose.length < 3 || propose.length > 30) {
                return res.status(400).json({ message: "Le nom du pool doit contenir entre 3 et 30 caractères." });
            }
            if (!NOM_VALIDE.test(propose)) {
                return res.status(400).json({ message: "Nom invalide. Caractères non autorisés." });
            }
            if (contientGrossierete(propose)) {
                return res.status(400).json({ message: "Ce nom de pool contient un terme inapproprié. Choisissez-en un autre." });
            }

            const membres = await ctx.renommerPool({
                ancien, propose,
                auth: req.auth,
                reduire
            });

            for (const membre of membres) await diffusion.resynchroniserUtilisateur(membre);
            const frais = await store.lire(propose);
            if (frais) diffusion.poolMisAJour(propose, frais.data, frais.revision);
            diffusion.versPool(ancien, 'poolRenomme', { ancien, nouveau: propose });

            logger.log(`✏️ Pool renommé : ${ancien} → ${propose}`);
            res.json({ message: `Pool renommé en « ${propose} ».`, newName: propose });
        } catch (erreur) {
            repondreErreur(res, erreur, '/rename-pool');
        }
    });

    // ───────────────────────────── Repêchage ─────────────────────────────

    /** Lancer le repêchage. Réservé à la personne qui a créé le pool. */
    app.post('/start-draft', auth.requireAuth, async (req, res) => {
        try {
            const nom = typeof req.body?.clanName === 'string' ? req.body.clanName.trim() : '';
            if (!nom) return res.status(400).json({ message: "Nom du pool requis." });

            const { valeur } = await store.muterPool(nom, {
                scope: 'pool:demarrer',
                userId: req.auth.userId,
                operationId: req.body?.operationId,
                requete: { pool: nom, action: 'start' },
                appliquer: async ({ data, poolId, journal }) => {
                    if (!authz.peutAdministrer(data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                        throw new ErreurMetier(403, "Seule la personne qui a créé le pool peut lancer le repêchage.");
                    }
                    const resultat = poolOps.demarrerRepechage(data);
                    if (!resultat.ok) throw refus(resultat);

                    data.turnStartedAt = Date.now();

                    journal.evenement({
                        poolId,
                        type: evenements.ACTIVITE.REPECHAGE_DEMARRE,
                        actorUserId: req.auth.userId,
                        subject: { equipes: resultat.equipes },
                        dedupKey: evenements.clesActivite.repechageDemarre(poolId)
                    });

                    for (const membre of authz.membresDuPool(data)) {
                        journal.notifier({
                            recipient: membre,
                            poolId,
                            type: evenements.NOTIFICATION.REPECHAGE_DEMARRE,
                            subject: { poolName: nom },
                            dedupKey: evenements.clesNotification.repechageDemarre(poolId)
                        });
                    }

                    return { valeur: { draftOrder: data.draftOrder, premierTour: data.draftOrder[0] } };
                }
            });

            const frais = await store.lire(nom);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);
            diffusion.versPool(nom, 'draftDemarre', { poolName: nom, premierTour: valeur.premierTour });

            res.json({
                message: "Repêchage démarré avec l'ordre en serpentin.",
                draftOrder: valeur.draftOrder,
                revision: valeur.revision
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/start-draft');
        }
    });

    /** Tirer un ordre aléatoire avant le départ. Même droit que /start-draft. */
    app.post('/randomize-draft-order', auth.requireAuth, async (req, res) => {
        try {
            const nom = typeof req.body?.clanName === 'string' ? req.body.clanName.trim() : '';
            if (!nom) return res.status(400).json({ message: "Nom du pool requis." });

            const { valeur } = await store.muterPool(nom, {
                scope: 'pool:ordre-aleatoire',
                userId: req.auth.userId,
                appliquer: async ({ data }) => {
                    if (!authz.peutAdministrer(data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                        throw new ErreurMetier(403, "Seule la personne qui a créé le pool peut tirer l'ordre.");
                    }
                    const resultat = poolOps.demarrerRepechage(data, {
                        melanger: (equipes) => equipes.sort(() => Math.random() - 0.5)
                    });
                    if (!resultat.ok) throw refus(resultat);
                    data.turnStartedAt = Date.now();
                    return { valeur: { draftOrder: data.draftOrder } };
                }
            });

            const frais = await store.lire(nom);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);

            res.json({ message: "Ordre de repêchage tiré en serpentin.", draftOrder: valeur.draftOrder, revision: valeur.revision });
        } catch (erreur) {
            repondreErreur(res, erreur, '/randomize-draft-order');
        }
    });

    /** Retirer les équipes restées vides avant le départ du repêchage. */
    app.post('/cleanup-draft', auth.requireAuth, async (req, res) => {
        try {
            const nom = typeof req.body?.clanName === 'string' ? req.body.clanName.trim() : '';
            if (!nom) return res.status(400).json({ message: "Nom du pool requis." });

            const { valeur } = await store.muterPool(nom, {
                scope: 'pool:nettoyage',
                userId: req.auth.userId,
                appliquer: async ({ data }) => {
                    if (!authz.peutAdministrer(data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                        throw new ErreurMetier(403, "Seule la personne qui a créé le pool peut le nettoyer.");
                    }
                    const resultat = poolOps.nettoyerEquipesVides(data);
                    if (!resultat.ok) throw refus(resultat);
                    return { valeur: { retirees: resultat.retirees } };
                }
            });

            const frais = await store.lire(nom);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);

            res.json({
                message: `Nettoyage effectué : ${valeur.retirees.length} équipe(s) retirée(s).`,
                retirees: valeur.retirees,
                pool: authz.vueMembre(nom, frais.data, frais.revision)
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/cleanup-draft');
        }
    });

    // ───────────────────────────── Image du pool ─────────────────────────────

    app.post('/upload/pool-image', auth.requireAuth, uploadPool.single('image'), async (req, res) => {
        try {
            const nom = typeof req.body?.poolName === 'string' ? req.body.poolName.trim() : '';
            if (!req.file) return res.status(400).json({ message: "Aucune image reçue." });
            if (!nom) return res.status(400).json({ message: "Nom du pool requis." });

            const imageUrl = `/uploads/pools/${req.file.filename}`;
            let ancienne = null;

            await store.muterPool(nom, {
                scope: 'pool:image',
                userId: req.auth.userId,
                appliquer: async ({ data }) => {
                    if (!authz.peutAdministrer(data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                        throw new ErreurMetier(403, "Seule la personne qui a créé le pool peut changer son image.");
                    }
                    ancienne = data.imageUrl || null;
                    data.imageUrl = imageUrl;
                    return { valeur: { imageUrl } };
                }
            });

            // Après le COMMIT seulement : supprimer l'ancienne avant aurait
            // effacé une image encore référencée si la transaction échouait.
            if (ancienne && ancienne.startsWith('/uploads/')) {
                const chemin = path.join(racine, ancienne.replace(/^\//, ''));
                try { if (fs.existsSync(chemin)) fs.unlinkSync(chemin); }
                catch (erreur) { logger.warn('⚠️ Ancienne image non supprimée :', erreur.message); }
            }

            const frais = await store.lire(nom);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);

            res.json({ imageUrl });
        } catch (erreur) {
            repondreErreur(res, erreur, '/upload/pool-image');
        }
    });

    return { repondreErreur, refus, checkIfDraftComplete };
}

module.exports = { monter, EQUIPES_PAR_POOL, NOM_VALIDE, reduire };
