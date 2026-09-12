/**
 * Le repêchage : choisir un joueur, sauter un tour qui traîne.
 *
 * C'est la route la plus sensible du site. Elle avait trois faiblesses :
 * l'identité venait du corps de la requête (donc on pouvait choisir à la place
 * d'un autre), la lecture-modification-écriture n'était pas verrouillée (deux
 * choix simultanés pouvaient s'écraser), et un réessai réseau pouvait consommer
 * deux tours.
 *
 * Les trois se règlent ici : session, verrou de ligne, et identifiant
 * d'opération enregistré dans la même transaction que l'effet.
 *
 * Le cas qui piège tout le monde est le renversement du serpentin : au retour,
 * la même équipe choisit deux fois de suite. `lastPickIndex` seul ne distingue
 * pas « deuxième choix légitime » de « requête rejouée » — d'où le couple
 * (identifiant d'opération, tour attendu), qui lève l'ambiguïté sans interdire
 * le choix double légitime.
 */

'use strict';

const authz = require('../lib/authz.js');
const poolOps = require('../lib/poolOps.js');
const evenements = require('../lib/events.js');
const { checkIfDraftComplete } = require('../lib/draft.js');

/** Délai avant qu'un tour puisse être sauté. Même seuil que côté client. */
const SAUT_APRES_MS = 180000;

function monter(app, ctx) {
    const { auth, store, diffusion, construireCalendrierH2H, logger = console } = ctx;
    const { ErreurMetier } = store;

    function repondreErreur(res, erreur, contexte) {
        if (erreur.name === 'ErreurMetier' || erreur.name === 'ErreurConflit') {
            return res.status(erreur.code || 400).json({ message: erreur.message, ...(erreur.extra || {}) });
        }
        logger.error(`Erreur ${contexte} :`, erreur);
        return res.status(500).json({ message: "Erreur interne du serveur." });
    }

    function refus(resultat) {
        return new ErreurMetier(resultat.code || 400, resultat.message, resultat.conflit ? { conflit: resultat.conflit } : {});
    }

    /**
     * Faire un choix.
     *
     * `operationId` et `expectedPickIndex` sont facultatifs : un client qui ne
     * les envoie pas garde le comportement d'avant, protégé par le verrou mais
     * sans la garantie de non-répétition. Les envoyer est ce qui rend le
     * réessai sûr, et le client de Fantazy les envoie.
     */
    app.post('/pick-player', auth.requireAuth, async (req, res) => {
        try {
            const nom = typeof req.body?.clanName === 'string' ? req.body.clanName.trim() : '';
            const playerName = typeof req.body?.playerName === 'string' ? req.body.playerName.trim() : '';
            const position = req.body?.position;
            const operationId = req.body?.operationId;
            const tourAttendu = req.body?.expectedPickIndex;

            if (!nom || !playerName || !position) {
                return res.status(400).json({ message: "Données incomplètes." });
            }

            const { valeur, rejouee } = await store.muterPool(nom, {
                scope: 'repechage:choix',
                userId: req.auth.userId,
                operationId,
                requete: { pool: nom, playerName, position, username: req.auth.username },
                appliquer: async ({ data, poolId, journal }) => {
                    const resultat = poolOps.choisirJoueur(data, {
                        username: req.auth.username,
                        playerName,
                        position,
                        tourAttendu,
                        estAdmin: req.auth.isAdmin
                    });
                    if (!resultat.ok) throw refus(resultat);

                    journal.evenement({
                        poolId,
                        type: evenements.ACTIVITE.CHOIX,
                        actorUserId: req.auth.userId,
                        subject: {
                            team: resultat.teamName,
                            player: playerName,
                            position,
                            pickIndex: resultat.pickIndex
                        },
                        dedupKey: evenements.clesActivite.choix(poolId, resultat.pickIndex)
                    });

                    // L'équipe qui vient de prendre la main est prévenue. La
                    // clé porte l'indice du tour : au renversement du serpentin
                    // la même équipe est alertée deux fois, mais pour deux
                    // tours différents — ce qui est exact.
                    if (resultat.tourSuivant) {
                        const prochainIndice = data.currentPickIndex;
                        const equipeSuivante = data.teams[resultat.tourSuivant];
                        for (const membre of (equipeSuivante?.members || [])) {
                            journal.notifier({
                                recipient: membre,
                                poolId,
                                type: evenements.NOTIFICATION.VOTRE_TOUR,
                                subject: { poolName: nom, teamName: resultat.tourSuivant, pickIndex: prochainIndice },
                                expiresAt: new Date(Date.now() + evenements.EXPIRATION_TOUR_MS),
                                dedupKey: evenements.clesNotification.votreTour(poolId, prochainIndice)
                            });
                        }
                    }

                    if (resultat.draftComplet) {
                        journal.evenement({
                            poolId,
                            type: evenements.ACTIVITE.REPECHAGE_TERMINE,
                            actorUserId: null,
                            subject: { poolName: nom },
                            dedupKey: evenements.clesActivite.repechageTermine(poolId)
                        });
                    }

                    return {
                        valeur: {
                            teamName: resultat.teamName,
                            playerName,
                            position,
                            pickIndex: resultat.pickIndex,
                            tourSuivant: resultat.tourSuivant,
                            draftComplet: resultat.draftComplet
                        }
                    };
                }
            });

            const frais = await store.lire(nom);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);

            // Le calendrier de saison du tête-à-tête se construit à la fin du
            // repêchage, dans SA propre transaction. Il ne peut pas tenir dans
            // celle du choix : il lit la fenêtre de saison sur le réseau, et on
            // ne garde jamais un verrou ouvert pendant un appel réseau.
            if (valeur.draftComplet && !rejouee) {
                diffusion.versPool(nom, 'draftComplete', { clanName: nom });
                if (frais.data.poolMode === 'head-to-head' && frais.data.h2hData) {
                    construireCalendrierH2H(nom).catch(erreur =>
                        logger.error('Construction du calendrier impossible :', erreur.message));
                }
            }

            res.json({
                message: `${playerName} a été sélectionné par ${valeur.teamName}.`,
                ...valeur,
                rejouee: !!rejouee
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/pick-player');
        }
    });

    /**
     * Sauter un tour qui traîne.
     *
     * Il n'y a pas de chronomètre dans Fantazy : le serveur ne saute jamais un
     * tour de lui-même. Ceci est le recours quand une salle reste figée sur
     * quelqu'un qui a perdu son réseau. Réservé à la personne qui a créé le
     * pool, ouvert seulement après un délai, et impossible à utiliser sur son
     * propre tour.
     */
    app.post('/skip-turn', auth.requireAuth, async (req, res) => {
        try {
            const nom = typeof req.body?.clanName === 'string' ? req.body.clanName.trim() : '';
            if (!nom) return res.status(400).json({ message: "Nom du pool requis." });

            const { valeur } = await store.muterPool(nom, {
                scope: 'repechage:saut',
                userId: req.auth.userId,
                operationId: req.body?.operationId,
                requete: { pool: nom, action: 'skip', username: req.auth.username },
                appliquer: async ({ data, poolId, journal }) => {
                    if (!authz.peutAdministrer(data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                        throw new ErreurMetier(403, "Seule la personne qui a créé le pool peut sauter un tour.");
                    }
                    const resultat = poolOps.sauterTour(data, {
                        username: req.auth.username,
                        delaiMs: SAUT_APRES_MS,
                        estAdmin: false // sauter son propre tour reste interdit, admin ou non
                    });
                    if (!resultat.ok) throw refus(resultat);

                    const prochainIndice = data.currentPickIndex;
                    const equipeSuivante = data.teams[resultat.tourSuivant];
                    for (const membre of (equipeSuivante?.members || [])) {
                        journal.notifier({
                            recipient: membre,
                            poolId,
                            type: evenements.NOTIFICATION.VOTRE_TOUR,
                            subject: { poolName: nom, teamName: resultat.tourSuivant, pickIndex: prochainIndice },
                            expiresAt: new Date(Date.now() + evenements.EXPIRATION_TOUR_MS),
                            dedupKey: evenements.clesNotification.votreTour(poolId, prochainIndice)
                        });
                    }

                    return { valeur: { skipped: resultat.saute, tourSuivant: resultat.tourSuivant } };
                }
            });

            const frais = await store.lire(nom);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);

            res.json({ message: `Tour de ${valeur.skipped} sauté.`, ...valeur });
        } catch (erreur) {
            repondreErreur(res, erreur, '/skip-turn');
        }
    });

    return { SAUT_APRES_MS, checkIfDraftComplete };
}

module.exports = { monter, SAUT_APRES_MS };
