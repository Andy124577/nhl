/**
 * Repêchage instantané : la file d'attente, le salon, le départ.
 *
 * Une seule porte : « Rejoindre un repêchage instantané ». Le serveur trouve
 * le salon qui attend, ou en ouvre un. Personne ne nomme rien, ne choisit
 * rien, ne saisit aucun code — c'est tout l'intérêt.
 *
 * Toute la difficulté tient dans le « ou ». Entre le moment où on lit les
 * salons et celui où on en écrit un, une autre requête peut lire les mêmes
 * données et conclure la même chose : deux personnes cliquant à la même
 * seconde ouvriraient deux salons vides au lieu de se retrouver ensemble, ce
 * que la file existe précisément pour éviter.
 *
 * La version précédente prenait un verrou consultatif de session plus une file
 * en mémoire, et retombait sur la file seule quand le verrou était
 * indisponible — c'est-à-dire qu'elle abandonnait silencieusement la
 * protection multi-instances au moment où elle comptait. Ici :
 *
 *   - lecture, décision et écriture tiennent dans UNE transaction ;
 *   - le verrou est un `pg_advisory_xact_lock`, relâché par le COMMIT ou le
 *     ROLLBACK, donc impossible à oublier ;
 *   - le verrou couvre le cas qu'aucun verrou de ligne ne peut couvrir —
 *     « aucun salon ne correspond, il faut en créer un » : on ne verrouille pas
 *     une ligne qui n'existe pas encore ;
 *   - un verrou indisponible renvoie une erreur réessayable, pas un succès
 *     obtenu sans protection.
 *
 * Le départ appartient au même contrat : entre la lecture et l'écriture, un
 * arrivant peut remplir le salon et lancer le repêchage. Sans la transaction,
 * ce départ effacerait une équipe dont l'ordre de sélection vient d'être tiré.
 */

'use strict';

const instantDraft = require('../lib/instantDraft.js');
const authz = require('../lib/authz.js');
const evenements = require('../lib/events.js');
const { generateSnakeOrder } = require('../lib/draft.js');

function monter(app, ctx) {
    const { auth, store, diffusion, presence, saisonCourante, logger = console } = ctx;
    const { ErreurMetier, CLE_VERROU_INSTANTANE } = store;

    function repondreErreur(res, erreur, contexte) {
        if (erreur.name === 'ErreurMetier' || erreur.name === 'ErreurConflit') {
            return res.status(erreur.code || 400).json({ message: erreur.message, ...(erreur.extra || {}) });
        }
        // Un verrou indisponible est une panne temporaire, pas un refus : le
        // client peut réessayer, et doit le savoir.
        if (erreur.code === '55P03' || erreur.code === '40P01' || erreur.code === '40001') {
            logger.error(`Verrou indisponible (${contexte}) :`, erreur.message);
            return res.status(503).json({
                message: "La file est momentanément occupée. Réessayez dans un instant.",
                code: 'verrou_indisponible',
                retryable: true
            });
        }
        logger.error(`Erreur ${contexte} :`, erreur);
        return res.status(500).json({ message: "Erreur interne du serveur." });
    }

    /** Vue complète d'un salon, présence comprise. */
    function vueSalon(nom, data) {
        const membres = instantDraft.membres(data);
        const compte = presence.compteEnCours(nom);
        return instantDraft.vueSalon(nom, data, {
            presence: presence.etatSalon(nom, membres),
            demarrageDemande: !!compte
        });
    }

    /** Diffuse l'état du salon à ses membres. Après le COMMIT, toujours. */
    async function diffuserSalon(nom) {
        const frais = await store.lire(nom);
        if (!frais) {
            diffusion.versPool(nom, 'salonFerme', { poolName: nom });
            presence.oublier(nom);
            return null;
        }
        diffusion.poolMisAJour(nom, frais.data, frais.revision);
        diffusion.versPool(nom, 'salonMisAJour', { pool: nom, ...vueSalon(nom, frais.data) });
        return frais;
    }

    /**
     * Tire l'ordre de sélection d'un salon complet.
     *
     * Appelé uniquement sous verrou, après revalidation : c'est le seul endroit
     * où un salon passe de « en attente » à « en repêchage ».
     */
    function lancerRepechage(data) {
        const equipes = instantDraft.equipesEligibles(data);
        if (equipes.length < 2) return false;
        const ordreInitial = [...equipes].sort(() => Math.random() - 0.5);
        data.draftOrder = generateSnakeOrder(ordreInitial, instantDraft.totalSelections(data));
        data.currentPickIndex = 0;
        data.lastPickIndex = -1;
        // Même horloge que /start-draft : celle du serveur, pour que tous les
        // écrans comptent la même durée de tour.
        data.turnStartedAt = Date.now();
        return true;
    }

    /**
     * Le départ effectif du repêchage, revalidé sous verrou.
     *
     * Le compte à rebours annonce une intention ; ce sont ces lignes qui
     * décident. Quelqu'un a pu partir pendant les dix secondes, ou le salon
     * avoir déjà démarré par une autre requête : les deux cas sortent sans
     * rien écrire.
     */
    async function demarrerSiPret(nom) {
        try {
            const { valeur } = await store.transaction(async (tx) => {
                await tx.verrouConsultatif(CLE_VERROU_INSTANTANE);
                const verrouille = await tx.verrouillerPool(nom);
                if (!verrouille) return { demarre: false, raison: 'disparu' };

                const data = verrouille.data;
                if (instantDraft.repechageCommence(data)) return { demarre: false, raison: 'deja' };
                if (!instantDraft.doitDemarrer(data)) return { demarre: false, raison: 'incomplet' };

                const membres = instantDraft.membres(data);
                if (!presence.tousPresents(nom, membres)) return { demarre: false, raison: 'absent' };

                if (!lancerRepechage(data)) return { demarre: false, raison: 'equipes' };

                tx.journal.evenement({
                    poolId: verrouille.id,
                    type: evenements.ACTIVITE.REPECHAGE_DEMARRE,
                    actorUserId: null,
                    subject: { poolName: nom, participants: membres.length },
                    dedupKey: evenements.clesActivite.repechageDemarre(verrouille.id)
                });
                for (const membre of membres) {
                    tx.journal.notifier({
                        recipient: membre,
                        poolId: verrouille.id,
                        type: evenements.NOTIFICATION.REPECHAGE_DEMARRE,
                        subject: { poolName: nom },
                        dedupKey: evenements.clesNotification.repechageDemarre(verrouille.id)
                    });
                }

                await tx.sauvegarderPool(nom, data);
                return { demarre: true, premierTour: data.draftOrder[0] };
            }, { scope: 'instantane:demarrage' });

            if (valeur.demarre) {
                presence.oublier(nom);
                await diffuserSalon(nom);
                diffusion.versPool(nom, 'draftDemarre', { poolName: nom, premierTour: valeur.premierTour });
                logger.log(`🏁 Repêchage instantané démarré : ${nom}`);
            } else {
                presence.annulerCompte(nom);
                await diffuserSalon(nom);
            }
            return valeur;
        } catch (erreur) {
            logger.error('Démarrage instantané impossible :', erreur.message);
            presence.annulerCompte(nom);
            return { demarre: false, raison: 'erreur' };
        }
    }

    /**
     * Arme le compte à rebours si le salon est complet et tout le monde présent.
     *
     * Deux conditions, pas une : un salon complet dont un participant a fermé
     * son onglet démarrerait un repêchage à trois joueurs actifs et un absent
     * dont le tour reviendrait sans que personne puisse le jouer.
     */
    function armerDemarrage(nom, data) {
        if (instantDraft.repechageCommence(data)) return null;
        if (!instantDraft.doitDemarrer(data)) { presence.annulerCompte(nom); return null; }

        const membres = instantDraft.membres(data);
        if (!presence.tousPresents(nom, membres)) { presence.annulerCompte(nom); return null; }

        const deja = presence.compteEnCours(nom);
        if (deja) return deja;

        const compte = presence.lancerCompte(nom, () => demarrerSiPret(nom));
        diffusion.versPool(nom, 'salonDemarrage', { pool: nom, finit: compte.finit, dureeMs: compte.dureeMs });
        return compte;
    }

    ctx.armerDemarrageInstantane = armerDemarrage;
    ctx.vueSalonInstantane = vueSalon;

    // ───────────────────────────── Rejoindre ─────────────────────────────

    app.post('/join-instant-draft', auth.requireAuth, async (req, res) => {
        try {
            const username = req.auth.username;
            const saison = saisonCourante ? saisonCourante() : null;

            const { valeur } = await store.transaction(async (tx) => {
                // Le verrou de coordination d'abord, les verrous de ligne
                // ensuite : un ordre unique et global, donc pas d'interblocage.
                await tx.verrouConsultatif(CLE_VERROU_INSTANTANE);

                const pools = await tx.listerPools();
                const plat = {};
                for (const [nom, enveloppe] of Object.entries(pools)) plat[nom] = enveloppe.data;

                // 1. Déjà en plein repêchage instantané : on l'y ramène.
                const enCours = instantDraft.poolEnRepechage(plat, username);
                if (enCours) {
                    return {
                        poolName: enCours,
                        teamName: authz.equipeDe(plat[enCours], username),
                        created: false, joined: false, started: true,
                        salon: instantDraft.vueSalon(enCours, plat[enCours])
                    };
                }

                // 2. Déjà dans un salon en attente : on lui redonne l'adresse.
                const deja = instantDraft.poolDejaRejoint(plat, username);
                if (deja) {
                    return {
                        poolName: deja,
                        teamName: authz.equipeDe(plat[deja], username),
                        created: false, joined: false, started: false,
                        salon: instantDraft.vueSalon(deja, plat[deja])
                    };
                }

                // 3. Un salon compatible attend : on le verrouille et on entre.
                const attente = instantDraft.salonCompatible(plat, {
                    versionFormat: instantDraft.VERSION_FORMAT,
                    saison
                });

                if (attente) {
                    const verrouille = await tx.verrouillerPool(attente);
                    // Revérifié APRÈS le verrou : entre la liste et le verrou,
                    // la dernière place a pu partir ou le salon démarrer.
                    if (verrouille && instantDraft.compatible(attente, verrouille.data, {
                        versionFormat: instantDraft.VERSION_FORMAT, saison
                    })) {
                        const teamName = instantDraft.inscrire(verrouille.data, username);
                        if (teamName) {
                            await tx.sauvegarderPool(attente, verrouille.data);
                            return {
                                poolName: attente,
                                teamName,
                                created: false, joined: true, started: false,
                                salon: instantDraft.vueSalon(attente, verrouille.data)
                            };
                        }
                    }
                }

                // 4. Aucun salon : on en ouvre un. Le nom se choisit contre
                //    TOUS les pools, pas seulement les instantanés — le nom est
                //    la clé primaire, et écraser un pool créé à la main serait
                //    irréparable.
                const nom = instantDraft.prochainNom(plat);
                const data = instantDraft.creerPool(username, {
                    season: saison,
                    formatVersion: instantDraft.VERSION_FORMAT
                });
                const cree = await tx.creerPool(nom, data);
                if (!cree) throw new ErreurMetier(409, "La file est occupée. Réessayez.", { retryable: true });

                return {
                    poolName: nom,
                    teamName: 'Équipe 1',
                    created: true, joined: true, started: false,
                    salon: instantDraft.vueSalon(nom, data)
                };
            }, { scope: 'instantane:rejoindre', userId: req.auth.userId });

            await diffusion.resynchroniserUtilisateur(username);
            const frais = await diffuserSalon(valeur.poolName);
            if (frais) armerDemarrage(valeur.poolName, frais.data);

            const salon = frais ? vueSalon(valeur.poolName, frais.data) : valeur.salon;
            const restantes = salon ? salon.placesRestantes : 0;

            const message = valeur.started
                ? "Votre repêchage est déjà en cours. On vous y ramène."
                : valeur.created
                    ? `Nouveau repêchage instantané ouvert. En attente de ${restantes} joueur${restantes > 1 ? 's' : ''}.`
                    : valeur.joined
                        ? (restantes > 0
                            ? `Vous avez rejoint ${valeur.poolName}. Il manque ${restantes} joueur${restantes > 1 ? 's' : ''}.`
                            : `Vous avez rejoint ${valeur.poolName}. Le salon est complet.`)
                        : `Vous êtes déjà dans ${valeur.poolName}.`;

            res.json({ ...valeur, salon, message });
        } catch (erreur) {
            repondreErreur(res, erreur, '/join-instant-draft');
        }
    });

    // ───────────────────────────── Quitter ─────────────────────────────

    app.post('/leave-instant-draft', auth.requireAuth, async (req, res) => {
        try {
            const username = req.auth.username;

            const { valeur } = await store.transaction(async (tx) => {
                await tx.verrouConsultatif(CLE_VERROU_INSTANTANE);

                const pools = await tx.listerPools();
                const plat = {};
                for (const [nom, enveloppe] of Object.entries(pools)) plat[nom] = enveloppe.data;

                const nomPool = instantDraft.poolDejaRejoint(plat, username);
                if (!nomPool) {
                    // Deux façons de n'être dans aucune file, et elles ne se
                    // disent pas pareil : n'y avoir jamais été, ou en être
                    // sorti parce que le repêchage est parti pendant qu'on
                    // hésitait. Dans le second cas, la sortie n'existe plus —
                    // c'est la salle de repêchage qu'il faut proposer.
                    const enCours = instantDraft.poolEnRepechage(plat, username);
                    if (enCours) {
                        throw new ErreurMetier(409,
                            "Le repêchage a déjà commencé : impossible de quitter maintenant.",
                            { poolName: enCours, action: 'reprendre' });
                    }
                    throw new ErreurMetier(400, "Vous n'êtes dans aucun repêchage instantané.");
                }

                const verrouille = await tx.verrouillerPool(nomPool);
                if (!verrouille) throw new ErreurMetier(404, "Ce salon n'existe plus.");

                // Revérifié sous verrou : le repêchage a pu partir entre la
                // liste et le verrou. Partir maintenant laisserait une équipe
                // fantôme à qui son tour reviendrait quand même.
                if (instantDraft.repechageCommence(verrouille.data)) {
                    throw new ErreurMetier(409,
                        "Le repêchage vient de commencer : impossible de quitter maintenant.",
                        { poolName: nomPool, action: 'reprendre' });
                }

                const teamName = instantDraft.retirer(verrouille.data, username);
                if (!teamName) throw new ErreurMetier(409, "Impossible de quitter ce salon.");

                // Le rôle de créateur suit, sinon les autres se retrouvent avec
                // un administrateur injoignable — celui qui vient de partir.
                const nouveauCreateur = instantDraft.transfererCreateur(verrouille.data, username);

                const restants = instantDraft.participants(verrouille.data);
                if (restants === 0) {
                    // Le dernier qui part emporte le salon : le laisser vide en
                    // ferait le plus « ancien » candidat de la file, donc celui
                    // qu'on rouvrirait au prochain clic — un salon fantôme de
                    // plus à chaque aller-retour.
                    await tx.supprimerPool(nomPool);
                } else {
                    await tx.sauvegarderPool(nomPool, verrouille.data);
                }

                return {
                    poolName: nomPool,
                    teamName,
                    participants: restants,
                    deleted: restants === 0,
                    nouveauCreateur
                };
            }, { scope: 'instantane:quitter', userId: req.auth.userId });

            presence.retirer(valeur.poolName, username);
            // Un départ annule le compte à rebours : on ne démarre pas à trois.
            presence.annulerCompte(valeur.poolName);
            await diffusion.resynchroniserUtilisateur(username);
            const frais = await diffuserSalon(valeur.poolName);
            if (frais) armerDemarrage(valeur.poolName, frais.data);

            res.json({
                ...valeur,
                message: valeur.deleted
                    ? "Vous avez quitté la file. Le salon s'est refermé, personne n'y attendait plus."
                    : `Vous avez quitté ${valeur.poolName}.`
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/leave-instant-draft');
        }
    });

    // ───────────────────────────── Salon ─────────────────────────────

    /**
     * L'état du salon : qui est là, combien il en manque, depuis quand.
     *
     * Aucune estimation de délai. Personne ne peut savoir quand trois inconnus
     * vont cliquer ; annoncer « environ deux minutes » serait une invention.
     * Le temps écoulé, lui, est un fait.
     */
    app.get('/instant-draft/lobby', auth.requireAuth, async (req, res) => {
        try {
            const username = req.auth.username;
            const pools = await store.lireTous();
            const plat = {};
            for (const [nom, enveloppe] of Object.entries(pools)) plat[nom] = enveloppe.data;

            const enAttente = instantDraft.poolDejaRejoint(plat, username);
            const enCours = instantDraft.poolEnRepechage(plat, username);
            const nom = enAttente || enCours;

            if (!nom) return res.json({ inQueue: false, state: null });

            const salon = vueSalon(nom, plat[nom]);
            const compte = presence.compteEnCours(nom);

            res.json({
                inQueue: true,
                ...salon,
                teamName: authz.equipeDe(plat[nom], username),
                moi: {
                    username,
                    connecte: presence.estPresent(nom, username)
                },
                compteARebours: compte ? { finit: compte.finit, resteMs: compte.resteMs } : null
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/instant-draft/lobby');
        }
    });

    return { vueSalon, armerDemarrage, demarrerSiPret, diffuserSalon };
}

module.exports = { monter };
