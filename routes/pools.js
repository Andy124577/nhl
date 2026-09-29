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

const { contientGrossierete } = require('../profanity.js');
const authz = require('../lib/authz.js');
const poolOps = require('../lib/poolOps.js');
const evenements = require('../lib/events.js');
const { checkIfDraftComplete } = require('../lib/draft.js');
const { seasonIdForDate } = require('../lib/season.js');
const calendrier = require('../lib/calendrier.js');

/** Fisher-Yates : `sort(() => Math.random() - 0.5)` ne brasse pas uniformément. */
function melangerEquipes(liste) {
    const copie = [...liste];
    for (let i = copie.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copie[i], copie[j]] = [copie[j], copie[i]];
    }
    return copie;
}

/** Équipes préparées d'avance à la création. */
const EQUIPES_PAR_POOL = 10;

/** Nom de pool : lettres, chiffres, espaces, tiret, apostrophe, souligné. */
const NOM_VALIDE = /^[\p{L}\p{N}\s'\-_]+$/u;

/** Comparaison insensible à la casse ET aux accents : « Élan » et « Elan »
 *  seraient impossibles à distinguer au téléphone. */
const reduire = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Bornes du mot de passe d'un pool. La haute vient de bcrypt, qui ignore
 *  tout octet au-delà du 72e. */
const MOT_DE_PASSE_MIN = 4;
const MOT_DE_PASSE_MAX = 72;

/**
 * Le nom d'une équipe, validé comme au renommage. Renvoie un message
 * d'erreur, ou null si le nom passe.
 */
function refusNomEquipe(nomEquipe) {
    if (!nomEquipe || nomEquipe.length > poolOps.NOM_EQUIPE_MAX) {
        return `Le nom d'équipe doit contenir entre 1 et ${poolOps.NOM_EQUIPE_MAX} caractères.`;
    }
    if (!NOM_VALIDE.test(nomEquipe)) return "Nom d'équipe invalide. Caractères non autorisés.";
    if (contientGrossierete(nomEquipe)) {
        return "Ce nom d'équipe contient un terme inapproprié. Choisissez-en un autre.";
    }
    return null;
}

function monter(app, ctx) {
    const { auth, store, diffusion, uploadPool, photos, logger = console } = ctx;
    // Chiffre la copie lisible du mot de passe (lib/poolSecret.js). Absent,
    // le pool garde sa seule empreinte, comme avant.
    const coffre = ctx.coffre || null;
    const { ErreurMetier } = store;

    /**
     * L'empreinte qui ouvre la porte, et la copie que seule la personne qui a
     * créé le pool peut relire. Renvoie un message de refus, ou les deux champs.
     */
    async function protegerMotDePasse(motDePasse) {
        if (motDePasse.length < MOT_DE_PASSE_MIN || motDePasse.length > MOT_DE_PASSE_MAX) {
            return { refus: `Le mot de passe du pool doit contenir entre ${MOT_DE_PASSE_MIN} et ${MOT_DE_PASSE_MAX} caractères.` };
        }
        let passwordSecret = null;
        if (coffre) {
            try { passwordSecret = coffre.chiffrer(motDePasse); }
            catch (erreur) { logger.error('Chiffrement du mot de passe de pool impossible :', erreur.message); }
        }
        return { passwordHash: await bcrypt.hash(motDePasse, 10), passwordSecret };
    }
    // Remplaçable pour les tests : l'ordre tiré doit y être prévisible.
    const melanger = ctx.melangerEquipes || melangerEquipes;

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
     * Tout le monde voit la même chose : le nom des équipes, qui s'y trouve
     * déjà, et combien de places restent. On choisit une équipe pour y
     * retrouver quelqu'un — masquer les noms à qui n'est pas encore entré
     * revenait à faire choisir à l'aveugle, dans une application de pools
     * entre amis où ces noms circulent de toute façon par ailleurs.
     *
     * Ce qui reste fermé : cette route ne sert que des noms et des places.
     * Les alignements, l'historique des choix et le classement restent
     * derrière vueMembre() — /draft continue de n'en rien dire à un
     * non-membre.
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
            // Les cases « Équipe N » jamais servies des anciens pools ne sont
            // pas des équipes : les montrer ferait croire à des adversaires.
            const equipes = Object.entries(data.teams || {})
                .filter(([, equipe]) => !poolOps.equipeInutilisee(equipe));
            const quotas = poolOps.config(data);

            res.json({
                poolName: nom,
                isMember: !!membre,
                hasPassword: !!data.passwordHash,
                imageUrl: data.imageUrl || '',
                draftStarted: Array.isArray(data.draftOrder) && data.draftOrder.length > 0,
                draftScheduledAt: data.draftScheduledAt || null,
                maxParTeam: poolOps.MEMBRES_PAR_EQUIPE,
                maxPlayers: poolOps.capacite(data),
                participantCount: poolOps.nombreParticipants(data),
                poolMode: data.poolMode || 'cumulative',
                creator: authz.createurDuPool(data),
                totalPicks: poolOps.totalSelections(data),
                config: quotas,
                monEquipe: req.auth ? authz.equipeDe(data, req.auth.username) : null,
                nomSuggere: req.auth ? poolOps.nomEquipeLibre(data, req.auth.username) : null,
                revision: enveloppe.revision,
                teams: equipes.map(([nomEquipe, equipe]) => {
                    const membres = equipe.members || [];
                    return {
                        name: nomEquipe,
                        members: membres,
                        memberCount: membres.length,
                        full: membres.length >= poolOps.MEMBRES_PAR_EQUIPE,
                        clubs: equipe.teams || []
                    };
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
            const { maxPlayers, config, poolMode, allowTrades, password, draftScheduledAt } = req.body || {};
            const username = req.auth.username;
            const nomEquipe = typeof req.body?.teamName === 'string' && req.body.teamName.trim()
                ? req.body.teamName.trim()
                : poolOps.nomEquipeLibre({}, username);

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

            // Le mot de passe du pool est vérifié comme celui d'un compte :
            // même algorithme, même coût, jamais conservé en clair. Sa copie
            // lisible est chiffrée avec une clé qui ne quitte pas le serveur.
            let protection = null;
            if (typeof password === 'string' && password.length > 0) {
                protection = await protegerMotDePasse(password);
                if (protection.refus) return res.status(400).json({ message: protection.refus });
            }

            const refusEquipe = refusNomEquipe(nomEquipe);
            if (refusEquipe) return res.status(400).json({ message: refusEquipe });

            // Repêcher quand on le décide (rien d'envoyé), ou à une date fixée
            // d'avance : le serveur lancera alors le repêchage lui-même.
            const datePrevue = poolOps.lireDateRepechage(draftScheduledAt);
            if (!datePrevue.ok) return res.status(400).json({ message: datePrevue.message });

            const mode = poolMode === 'head-to-head' ? 'head-to-head' : 'cumulative';
            // Un plafond, pas un quota : le repêchage peut partir avant qu'il
            // soit atteint. Borné comme le formulaire, 2 à 10.
            const plafond = Math.min(poolOps.PARTICIPANTS_MAX,
                Math.max(2, parseInt(maxPlayers, 10) || poolOps.PARTICIPANTS_MAX));

            const quotas = { ...poolOps.CONFIG_PAR_DEFAUT, ...(config || {}) };
            if (quotas.numTeams == null) quotas.numTeams = 1;
            // Le banc n'existe qu'en tête-à-tête : il n'y a rien à remplacer
            // dans un cumulatif, où chaque point de la saison compte déjà.
            const banc = parseInt(quotas.numBench, 10);
            if (mode === 'head-to-head' && Number.isFinite(banc) && banc > 0) {
                quotas.numBench = Math.min(banc, 5);
            } else {
                delete quotas.numBench;
            }

            // Une seule équipe à la naissance du pool : celle de la personne
            // qui le crée. Les autres arrivent avec la leur.
            const teams = { [nomEquipe]: poolOps.equipeVide([username]) };

            const poolData = {
                maxPlayers: plafond,
                creator: username,
                draftOrder: [],
                currentPickIndex: 0,
                lastPickIndex: -1,
                config: quotas,
                poolMode: mode,
                allowTrades: allowTrades !== false,
                createdAt: new Date().toISOString(),
                teams
            };
            if (datePrevue.date) poolData.draftScheduledAt = datePrevue.date;
            if (protection) {
                poolData.passwordHash = protection.passwordHash;
                if (protection.passwordSecret) poolData.passwordSecret = protection.passwordSecret;
            }
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
                message: `Pool « ${nom} » créé avec votre équipe « ${nomEquipe} ».`,
                teamName: nomEquipe,
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

            let image = null;
            const { valeur: membres } = await store.transaction(async (tx) => {
                const verrouille = await tx.verrouillerPool(nom);
                if (!verrouille) throw new ErreurMetier(404, "Ce pool n'existe pas.");
                if (!authz.peutAdministrer(verrouille.data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                    throw new ErreurMetier(403, "Seule la personne qui a créé le pool peut le supprimer.");
                }
                const noms = authz.membresDuPool(verrouille.data);
                image = verrouille.data.imageUrl || null;
                await tx.supprimerPool(nom);
                return noms;
            }, { scope: 'pool:suppression', userId: req.auth.userId });

            // Après le COMMIT : l'image du pool part avec lui.
            if (image) await photos.supprimer(image);

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
     * Entrer dans un pool en nommant son équipe.
     *
     * `teamName` est le nom que la personne donne à SON équipe, pas une case
     * existante à rejoindre : une personne, une équipe.
     *
     * La vérification bcrypt a lieu AVANT la transaction — elle prend du
     * temps, et tenir un verrou de ligne pendant ce temps ferait attendre tout
     * le pool.
     */
    app.post('/join-team', auth.requireAuth, async (req, res) => {
        try {
            const nom = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
            const teamName = typeof req.body?.teamName === 'string' ? req.body.teamName.trim() : '';
            const username = req.auth.username;

            if (!nom || !teamName) return res.status(400).json({ message: "Pool et nom d'équipe requis." });
            const refusEquipe = refusNomEquipe(teamName);
            if (refusEquipe) return res.status(400).json({ message: refusEquipe });

            const enveloppe = await store.lire(nom);
            if (!enveloppe) return res.status(404).json({ message: "Pool introuvable." });

            const dejaMembre = authz.estMembre(enveloppe.data, username);
            if (dejaMembre) {
                return res.status(400).json({ message: "Vous êtes déjà dans ce pool.", teamName: authz.equipeDe(enveloppe.data, username) });
            }
            if (enveloppe.data.passwordHash) {
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
                    if (data.passwordHash && data.passwordHash !== enveloppe.data.passwordHash) {
                        throw new ErreurMetier(401, "Le mot de passe de ce pool vient de changer.", { passwordRequired: true });
                    }
                    const resultat = poolOps.inscrireParticipant(data, { username, teamName });
                    if (!resultat.ok) throw refus(resultat);
                    return { valeur: { teamName: resultat.teamName } };
                }
            });

            const frais = await store.lire(nom);
            await diffusion.resynchroniserUtilisateur(username);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);

            res.json({
                message: `Vous avez rejoint ${nom} avec l'équipe « ${valeur.teamName} ».`,
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
                    if (data.passwordHash && data.passwordHash !== enveloppe.data.passwordHash) {
                        throw new ErreurMetier(401, "Le mot de passe de ce pool vient de changer.", { passwordRequired: true });
                    }
                    // Pas de nom fourni : l'équipe prend celui de la personne,
                    // qu'elle pourra renommer ensuite.
                    const resultat = poolOps.inscrireParticipant(data, {
                        username, teamName: poolOps.nomEquipeLibre(data, username)
                    });
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
                    : `Vous avez rejoint ${nom} avec l'équipe « ${valeur.teamName} ».`,
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

    /**
     * Ce qui accompagne tout départ de repêchage, au clic comme à l'heure
     * prévue : la pendule du premier tour, la saison repêchée, et l'alerte à
     * chaque membre. Écrit dans la transaction du départ, jamais à côté.
     */
    function annoncerDepart({ data, poolId, journal, nom, equipes, acteur = null, maintenant = Date.now() }) {
        data.turnStartedAt = maintenant;
        data.saisonRepechage = seasonIdForDate(new Date(maintenant));

        journal.evenement({
            poolId,
            type: evenements.ACTIVITE.REPECHAGE_DEMARRE,
            actorUserId: acteur,
            subject: { equipes },
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
    }

    /**
     * Fixer, déplacer ou retirer la date du repêchage. Réservé à la personne
     * qui a créé le pool, tant que le repêchage n'est pas parti.
     *
     * Une date nouvelle est annoncée aux autres membres : c'est un rendez-vous,
     * il ne doit pas se découvrir en ouvrant la salle trop tard.
     */
    app.post('/api/pools/:poolName/draft-schedule', auth.requireAuth, async (req, res) => {
        try {
            const nom = req.params.poolName;
            const { valeur } = await store.muterPool(nom, {
                scope: 'pool:date-repechage',
                userId: req.auth.userId,
                appliquer: async ({ data, poolId, journal }) => {
                    if (!authz.peutAdministrer(data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                        throw new ErreurMetier(403, "Seule la personne qui a créé le pool peut choisir la date du repêchage.");
                    }
                    const resultat = poolOps.programmerRepechage(data, { date: req.body?.draftScheduledAt });
                    if (!resultat.ok) throw refus(resultat);

                    if (resultat.date && resultat.change) {
                        for (const membre of authz.membresDuPool(data)) {
                            if (membre === req.auth.username) continue;
                            journal.notifier({
                                recipient: membre,
                                poolId,
                                type: evenements.NOTIFICATION.REPECHAGE_PREVU,
                                subject: { poolName: nom, date: resultat.date },
                                dedupKey: evenements.clesNotification.repechagePrevu(poolId, resultat.date)
                            });
                        }
                    }
                    return { valeur: { draftScheduledAt: resultat.date } };
                }
            });

            const frais = await store.lire(nom);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);

            res.json({
                message: valeur.draftScheduledAt ? "Date du repêchage enregistrée." : "Date du repêchage retirée.",
                draftScheduledAt: valeur.draftScheduledAt,
                revision: valeur.revision
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/draft-schedule');
        }
    });

    /**
     * Le repêchage prévu, à ajouter à son agenda : le fichier .ics (iPhone,
     * Mac, Outlook) ou Google Agenda (Android), selon l'appareil ou
     * `?app=google|ics` (lib/calendrier.js).
     *
     * Sans session : le lien se partage tel quel dans une conversation de
     * groupe, et la date est déjà publique (authz.resumePublic). Rien d'autre
     * du pool n'en sort. Une lecture d'un seul pool par clic ; un agenda ne
     * revient pas le relire.
     */
    app.get('/api/pools/:poolName/calendar', async (req, res) => {
        try {
            const nom = req.params.poolName;
            const enveloppe = await store.lire(nom);
            const date = enveloppe && enveloppe.data.instant !== true ? enveloppe.data.draftScheduledAt : null;
            if (!date) {
                return res.status(404).json({ message: "Ce pool n'a pas de date de repêchage." });
            }

            const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
            const hote = req.headers.host || 'fantazy.ca';
            const rendezVous = {
                nom,
                date,
                url: `${proto}://${hote}/draftActif.html?pool=${encodeURIComponent(nom)}`,
                // Un repêchage daté part chronométré (poolOps.demarrerRepechage).
                limiteMs: poolOps.LIMITE_CHOIX_MS
            };

            if (calendrier.sortiePour(req.headers['user-agent'], req.query && req.query.app) === 'google') {
                return res.redirect(302, calendrier.lienGoogle(rendezVous));
            }

            // L'identifiant de la ligne survit à un renommage ; en mode
            // fichier, il n'y en a pas, et le nom en tient lieu.
            const identifiant = enveloppe.id != null
                ? `pool-${enveloppe.id}`
                : calendrier.nomFichier(nom).replace(/^repechage-?|\.ics$/g, '') || 'pool';
            res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
            res.setHeader('Content-Disposition', `inline; filename="${calendrier.nomFichier(nom)}"`);
            res.setHeader('Cache-Control', 'no-store');
            res.send(calendrier.fichierIcs({ ...rendezVous, uid: `repechage-${identifiant}@${hote.replace(/:\d+$/, '')}` }));
        } catch (erreur) {
            repondreErreur(res, erreur, '/calendar');
        }
    });

    /**
     * Lance les repêchages dont l'heure est venue. Appelé par server.js au
     * début de chaque minute — les dates sont arrondies à la minute.
     *
     * La lecture des départs prévus ne fait que trier les candidats : chaque
     * départ se revalide sous le verrou de SON pool (poolOps.
     * demarrerRepechagePrevu), si bien qu'un clic « Commencer » simultané, ou
     * une deuxième instance du serveur, ne peut pas lancer deux fois le même
     * repêchage.
     *
     * Un départ impossible (une seule équipe, un nombre impair en tête-à-tête)
     * retire la date et le dit à la personne qui a créé le pool.
     */
    async function demarrerRepechagesPrevus(maintenant = Date.now()) {
        const prevus = await store.lireDepartsPrevus();
        const candidats = Object.entries(prevus)
            .filter(([, extrait]) => poolOps.repechagePrevuEchu(extrait, maintenant))
            .map(([nom]) => nom);

        const bilan = [];
        for (const nom of candidats) {
            try {
                const { valeur } = await store.muterPool(nom, {
                    scope: 'pool:depart-prevu',
                    appliquer: async ({ data, poolId, journal }) => {
                        if (!poolOps.repechagePrevuEchu(data, maintenant)) {
                            return { sauvegarder: false, valeur: { demarre: false, raison: 'deja' } };
                        }
                        const resultat = poolOps.demarrerRepechagePrevu(data, { maintenant, melanger });
                        if (resultat.ok) {
                            annoncerDepart({ data, poolId, journal, nom, equipes: resultat.equipes, maintenant });
                            return { valeur: { demarre: true, premierTour: data.draftOrder[0] } };
                        }

                        const createur = authz.createurDuPool(data);
                        if (createur) {
                            journal.notifier({
                                recipient: createur,
                                poolId,
                                type: evenements.NOTIFICATION.REPECHAGE_MANQUE,
                                subject: { poolName: nom, date: resultat.prevu, raison: resultat.message },
                                dedupKey: evenements.clesNotification.repechageManque(poolId, resultat.prevu)
                            });
                        }
                        return { valeur: { demarre: false, raison: 'manque', message: resultat.message } };
                    }
                });

                if (valeur.demarre || valeur.raison === 'manque') {
                    const frais = await store.lire(nom);
                    diffusion.poolMisAJour(nom, frais.data, frais.revision);
                }
                if (valeur.demarre) {
                    diffusion.versPool(nom, 'draftDemarre', { poolName: nom, premierTour: valeur.premierTour });
                    logger.log(`Repêchage démarré à l'heure prévue : ${nom}`);
                } else if (valeur.raison === 'manque') {
                    logger.log(`Repêchage prévu non démarré (${nom}) : ${valeur.message}`);
                }
                bilan.push({ pool: nom, ...valeur });
            } catch (erreur) {
                // Un pool en panne ne doit pas retenir les autres départs.
                logger.error(`Départ prévu impossible (${nom}) :`, erreur.message);
                bilan.push({ pool: nom, demarre: false, raison: 'erreur' });
            }
        }
        return bilan;
    }
    ctx.demarrerRepechagesPrevus = demarrerRepechagesPrevus;

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
                    // L'écran d'attente annonce un ordre tiré au hasard — sauf
                    // après une saison, où le dernier au classement ouvre le
                    // bal (poolOps.ordreDeDepart).
                    const resultat = poolOps.demarrerRepechage(data, { melanger });
                    if (!resultat.ok) throw refus(resultat);

                    annoncerDepart({ data, poolId, journal, nom, equipes: resultat.equipes, acteur: req.auth.userId });

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

    /**
     * Faire tourner la roue de l'ordre : la prochaine place du premier tour,
     * ou toutes celles qui restent (`tout`). Même droit que /start-draft.
     *
     * Le serveur tire ; le salon ne fait que jouer l'animation vers l'équipe
     * sortie, à l'arrivée de l'état relu (repechage.js). Tout le monde voit
     * donc la même roue s'arrêter sur la même équipe.
     */
    app.post('/api/pools/:poolName/draft-wheel', auth.requireAuth, async (req, res) => {
        try {
            const nom = req.params.poolName;
            const { valeur } = await store.muterPool(nom, {
                scope: 'pool:roue',
                userId: req.auth.userId,
                appliquer: async ({ data }) => {
                    if (!authz.peutAdministrer(data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                        throw new ErreurMetier(403, "Seule la personne qui a créé le pool peut faire tourner la roue.");
                    }
                    const resultat = poolOps.tournerRoue(data, { tout: req.body?.tout === true, aleatoire: ctx.aleatoire });
                    if (!resultat.ok) throw refus(resultat);
                    return { valeur: { tirees: resultat.tirees, ordre: resultat.ordre, restantes: resultat.restantes.length } };
                }
            });

            const frais = await store.lire(nom);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);

            res.json({
                message: valeur.tirees.length === 1
                    ? `${valeur.tirees[0]} choisira au rang ${valeur.ordre.length}.`
                    : "L'ordre du premier tour est tiré.",
                ...valeur
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/pools/draft-wheel');
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
                    const resultat = poolOps.demarrerRepechage(data, { melanger });
                    if (!resultat.ok) throw refus(resultat);
                    data.turnStartedAt = Date.now();
                    data.saisonRepechage = seasonIdForDate(new Date());
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

    /**
     * Clore la saison et préparer la suivante.
     *
     * Le classement final est calculé ici, puis archivé dans le pool : c'est
     * lui qui ordonnera le prochain repêchage, le dernier choisissant en
     * premier. Les participants restent, leurs alignements repartent de zéro.
     *
     * Le calcul du cumulatif lit les statistiques de la saison ; il se fait
     * avant la transaction, qui ne doit jamais attendre un fichier ou le
     * réseau.
     */
    app.post('/pool/new-season', auth.requireAuth, async (req, res) => {
        try {
            const nom = typeof req.body?.clanName === 'string' ? req.body.clanName.trim() : '';
            if (!nom) return res.status(400).json({ message: "Nom du pool requis." });

            const enveloppe = await store.lire(nom);
            if (!enveloppe) return res.status(404).json({ message: "Pool introuvable." });

            const fenetre = ctx.fenetreSaison ? await ctx.fenetreSaison() : null;
            const maintenant = new Date();
            const aujourdhui = maintenant.toISOString().slice(0, 10);
            const saisonCourante = seasonIdForDate(maintenant);

            const precalcul = enveloppe.data.poolMode === 'head-to-head'
                ? null
                : (ctx.scoresSaison ? await ctx.scoresSaison(enveloppe.data) : []);

            const { valeur } = await store.muterPool(nom, {
                scope: 'pool:nouvelle-saison',
                userId: req.auth.userId,
                appliquer: async ({ data }) => {
                    if (!authz.peutAdministrer(data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                        throw new ErreurMetier(403, "Seule la personne qui a créé le pool peut ouvrir une nouvelle saison.");
                    }
                    if (!req.auth.isAdmin) {
                        const permis = poolOps.peutOuvrirNouvelleSaison(data, { fenetre, aujourdhui, saisonCourante });
                        if (!permis.ok) throw refus(permis);
                    }

                    const classement = data.poolMode === 'head-to-head'
                        ? poolOps.classementFinalH2H(data)
                        : (precalcul || [])
                            .filter(ligne => data.teams[ligne.teamName])
                            .map(ligne => ({ equipe: ligne.teamName, points: ligne.score }));

                    const resultat = poolOps.nouvelleSaison(data, {
                        classement,
                        saison: data.saisonRepechage || null,
                        maintenant: maintenant.getTime()
                    });
                    if (!resultat.ok) throw refus(resultat);
                    return { valeur: { archivee: resultat.archivee } };
                }
            });

            const frais = await store.lire(nom);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);

            logger.log(`🔁 Nouvelle saison ouverte : ${nom} par ${req.auth.username}`);
            res.json({
                message: "Nouvelle saison prête. Le prochain repêchage suivra le classement inversé : le dernier choisit en premier.",
                classement: valeur.archivee.classement,
                revision: valeur.revision
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/pool/new-season');
        }
    });

    // ───────────────────────────── Mot de passe du pool ─────────────────────────────

    /**
     * Relire le mot de passe du pool. Réservé à la personne qui l'a créé (et à
     * l'administration du site) : c'est elle qui le donne à ses amis.
     *
     * `recuperable` est faux pour un pool protégé avant que la copie chiffrée
     * existe, ou dont la clé a changé : il n'y a alors rien à relire, seulement
     * un nouveau mot de passe à choisir.
     */
    app.get('/api/pools/:poolName/password', auth.requireAuth, async (req, res) => {
        try {
            const enveloppe = await store.lire(req.params.poolName);
            if (!enveloppe) return res.status(404).json({ message: "Pool introuvable." });
            if (!authz.peutAdministrer(enveloppe.data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                return res.status(403).json({ message: "Seule la personne qui a créé le pool peut voir son mot de passe." });
            }
            const data = enveloppe.data;
            const password = data.passwordHash && data.passwordSecret && coffre
                ? coffre.dechiffrer(data.passwordSecret)
                : null;
            res.setHeader('Cache-Control', 'no-store');
            res.json({
                hasPassword: !!data.passwordHash,
                recuperable: password !== null,
                password
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/pools/password');
        }
    });

    /**
     * Poser, changer ou retirer le mot de passe du pool. Un mot de passe vide
     * ouvre le pool à tout le monde.
     *
     * Les membres déjà inscrits ne le repassent jamais : il ne garde que la
     * porte d'entrée.
     */
    app.post('/api/pools/:poolName/password', auth.requireAuth, async (req, res) => {
        try {
            const nom = req.params.poolName;
            const brut = req.body?.password;
            if (brut != null && typeof brut !== 'string') {
                return res.status(400).json({ message: "Mot de passe invalide." });
            }
            const motDePasse = brut || '';

            let protection = null;
            if (motDePasse.length > 0) {
                protection = await protegerMotDePasse(motDePasse);
                if (protection.refus) return res.status(400).json({ message: protection.refus });
            }

            await store.muterPool(nom, {
                scope: 'pool:mot-de-passe',
                userId: req.auth.userId,
                appliquer: async ({ data }) => {
                    if (!authz.peutAdministrer(data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                        throw new ErreurMetier(403, "Seule la personne qui a créé le pool peut changer son mot de passe.");
                    }
                    delete data.passwordHash;
                    delete data.passwordSecret;
                    if (protection) {
                        data.passwordHash = protection.passwordHash;
                        if (protection.passwordSecret) data.passwordSecret = protection.passwordSecret;
                    }
                    return { valeur: {} };
                }
            });

            const frais = await store.lire(nom);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);

            logger.log(`🔑 Mot de passe ${protection ? 'changé' : 'retiré'} : ${nom} par ${req.auth.username}`);
            res.json({
                message: protection ? "Mot de passe du pool enregistré." : "Le pool est maintenant ouvert, sans mot de passe.",
                hasPassword: !!protection,
                recuperable: !!(protection && protection.passwordSecret)
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/pools/password');
        }
    });

    // ───────────────────────────── Image du pool ─────────────────────────────

    app.post('/upload/pool-image', auth.requireAuth, uploadPool.single('image'), async (req, res) => {
        // L'image arrive en mémoire (multer) ; seule sa version optimisée est
        // rangée, par ctx.photos (services/magasinPhotos.js).
        let imageUrl = null;
        let enPlace = false;
        try {
            const nom = typeof req.body?.poolName === 'string' ? req.body.poolName.trim() : '';
            if (!req.file) return res.status(400).json({ message: "Aucune image reçue." });
            if (!nom) return res.status(400).json({ message: "Nom du pool requis." });

            // Le droit d'abord : on n'envoie pas à l'analyse l'image de
            // quelqu'un qui ne pourrait de toute façon pas la poser.
            const avant = await store.lire(nom);
            if (!avant) return res.status(404).json({ message: "Pool introuvable." });
            if (!authz.peutAdministrer(avant.data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                return res.status(403).json({ message: "Seule la personne qui a créé le pool peut changer son image." });
            }

            // Optimisée d'abord : c'est cette version qui sera publiée, donc
            // celle qu'on vérifie.
            const image = await photos.preparer(req.file.buffer);
            if (!image.ok) return res.status(image.code).json({ message: image.message });

            let verifiee = false;
            if (ctx.moderationImages) {
                const verification = await ctx.moderationImages.verifier({ tampon: image.tampon, mimetype: image.contentType });
                if (!verification.ok) return res.status(verification.code).json({ message: verification.message });
                verifiee = !!verification.verifiee;
            }

            imageUrl = await photos.enregistrer({ tampon: image.tampon, dossier: 'pools' });
            // Pour l'écran « Photos téléversées » de l'administration (routes/photos.js).
            const imageMeta = { par: req.auth.username, le: new Date().toISOString(), verifiee };
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
                    data.imageMeta = imageMeta;
                    return { valeur: { imageUrl } };
                }
            });
            enPlace = true;

            // Après le COMMIT seulement : supprimer l'ancienne avant aurait
            // effacé une image encore référencée si la transaction échouait.
            if (ancienne && ancienne !== imageUrl) await photos.supprimer(ancienne);

            const frais = await store.lire(nom);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);

            res.json({ imageUrl });
        } catch (erreur) {
            // Rangée mais jamais posée sur le pool : elle ne resterait qu'orpheline.
            if (imageUrl && !enPlace) await photos.supprimer(imageUrl).catch(() => {});
            repondreErreur(res, erreur, '/upload/pool-image');
        }
    });

    return { repondreErreur, refus, checkIfDraftComplete };
}

module.exports = { monter, EQUIPES_PAR_POOL, NOM_VALIDE, reduire, refusNomEquipe };
