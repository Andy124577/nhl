/**
 * Le repêchage : choisir un joueur, et choisir à la place d'une équipe dont
 * le tour traîne (la personne qui a créé le pool) ou dont le temps est écoulé
 * (repêchage à date fixe).
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

const fs = require('node:fs');
const path = require('node:path');

const authz = require('../lib/authz.js');
const poolOps = require('../lib/poolOps.js');
const evenements = require('../lib/events.js');
const choixAuto = require('../lib/choixAuto.js');
const { checkIfDraftComplete } = require('../lib/draft.js');

/** Délai avant qu'on puisse choisir à la place d'une équipe. Même seuil que côté client. */
const SAUT_APRES_MS = 180000;

function monter(app, ctx) {
    const { auth, store, diffusion, construireCalendrierH2H, logger = console } = ctx;
    const { ErreurMetier } = store;

    /**
     * La trousse rangée pour le choix automatique, lue au premier besoin
     * seulement : un serveur sans repêchage chronométré ne la charge jamais.
     * `ctx.trousse` la remplace dans les tests.
     */
    let bassin = null;
    function bassinTrousse() {
        if (!bassin) {
            const trousse = ctx.trousse ||
                JSON.parse(fs.readFileSync(path.join(ctx.racine || process.cwd(), 'draftkit.json'), 'utf8'));
            bassin = choixAuto.bassinDepuisTrousse(trousse);
        }
        return bassin;
    }

    /**
     * Ce qu'un choix laisse derrière lui, dans SA transaction : l'activité,
     * l'alerte du tour joué qui s'éteint, celle de l'équipe suivante qui
     * s'allume, et la fin du repêchage. Commun au choix d'une personne et au
     * choix automatique — les deux doivent raconter la même chose.
     */
    function journaliserChoix({ journal, data, poolId, nom, resultat, actorUserId }) {
        if (resultat.playerName) {
            journal.evenement({
                poolId,
                type: evenements.ACTIVITE.CHOIX,
                actorUserId,
                subject: {
                    team: resultat.teamName,
                    player: resultat.playerName,
                    position: resultat.position,
                    pickIndex: resultat.pickIndex,
                    ...(resultat.auto ? { auto: true } : {})
                },
                dedupKey: evenements.clesActivite.choix(poolId, resultat.pickIndex)
            });
        }

        // Le tour qui vient d'être joué ne réclame plus rien : son
        // « C'est votre tour » quitte la cloche au lieu d'y rester jusqu'à
        // expiration, un par tour.
        journal.resoudre(evenements.clesNotification.votreTour(poolId, resultat.pickIndex));

        // L'équipe qui vient de prendre la main est prévenue — dans la cloche,
        // et sur ses appareils abonnés une fois le COMMIT fait (services/push.js).
        if (resultat.tourSuivant) {
            for (const alerte of evenements.alertesTour({ data, poolId, poolName: nom })) journal.notifier(alerte);
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
    }

    /**
     * Après le COMMIT d'un choix : l'état relu part aux membres, et la fin du
     * repêchage déclenche ce qui en dépend.
     *
     * Le calendrier de saison du tête-à-tête se construit à la fin du
     * repêchage, dans SA propre transaction. Il ne peut pas tenir dans celle
     * du choix : il lit la fenêtre de saison sur le réseau, et on ne garde
     * jamais un verrou ouvert pendant un appel réseau.
     */
    async function diffuserChoix(nom, { draftComplet, rejouee = false }) {
        const frais = await store.lire(nom);
        diffusion.poolMisAJour(nom, frais.data, frais.revision);

        if (draftComplet && !rejouee) {
            diffusion.versPool(nom, 'draftComplete', { clanName: nom });
            if (frais.data.poolMode === 'head-to-head' && frais.data.h2hData) {
                construireCalendrierH2H(nom).catch(erreur =>
                    logger.error('Construction du calendrier impossible :', erreur.message));
            }
        }
    }

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
     * réessai sûr : la salle de repêchage (draftActif.js) envoie les deux,
     * l'accueil (accueil-draft-hero.js) le tour attendu.
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

                    journaliserChoix({ journal, data, poolId, nom, resultat, actorUserId: req.auth.userId });

                    return {
                        valeur: {
                            teamName: resultat.teamName,
                            playerName,
                            position,
                            pickIndex: resultat.pickIndex,
                            banc: !!resultat.banc,
                            tourSuivant: resultat.tourSuivant,
                            draftComplet: resultat.draftComplet
                        }
                    };
                }
            });

            await diffuserChoix(nom, { draftComplet: valeur.draftComplet, rejouee });

            res.json({
                message: `${playerName} a été sélectionné par ${valeur.teamName}${valeur.banc ? ' (au banc)' : ''}.`,
                ...valeur,
                rejouee: !!rejouee
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/pick-player');
        }
    });

    /**
     * Un choix joué à la place de l'équipe, par le minuteur ou par la
     * personne qui a créé le pool : il se raconte comme un autre choix, et
     * les membres de l'équipe apprennent ce qui a été pris pour eux — ils
     * n'étaient pas là pour le voir.
     */
    function journaliserChoixAuto({ journal, data, poolId, nom, resultat, actorUserId, parCreateur = false }) {
        journaliserChoix({ journal, data, poolId, nom, resultat, actorUserId });

        for (const membre of (data.teams[resultat.teamName]?.members || [])) {
            journal.notifier({
                recipient: membre,
                poolId,
                type: evenements.NOTIFICATION.CHOIX_AUTO,
                subject: {
                    poolName: nom,
                    teamName: resultat.teamName,
                    pickIndex: resultat.pickIndex,
                    ...(resultat.playerName ? { player: resultat.playerName } : {}),
                    ...(parCreateur ? { parCreateur: true } : {})
                },
                dedupKey: evenements.clesNotification.choixAuto(poolId, resultat.pickIndex)
            });
        }
    }

    /**
     * Choisir à la place d'une équipe dont le tour traîne.
     *
     * Dans un repêchage lancé au clic, sans limite de temps, le serveur ne
     * choisit jamais de lui-même. Ceci est le recours quand une salle reste
     * figée sur quelqu'un qui a perdu son réseau : l'équipe reçoit le joueur
     * que le minuteur lui aurait donné, au lieu de perdre son tour. Réservé à
     * la personne qui a créé le pool, ouvert seulement après un délai, et
     * refusé sur son propre tour (poolOps.choisirALaPlace). Un repêchage
     * chronométré le refuse : il choisit lui-même à la fin du temps
     * (choisirAutomatiquement, plus bas).
     *
     * `/skip-turn` est l'ancien nom : une salle restée ouverte pendant la mise
     * en ligne l'appelle encore, et obtient le même choix.
     */
    async function choisirPourEquipe(req, res) {
        try {
            const nom = typeof req.body?.clanName === 'string' ? req.body.clanName.trim() : '';
            if (!nom) return res.status(400).json({ message: "Nom du pool requis." });

            const { valeur, rejouee } = await store.muterPool(nom, {
                scope: 'repechage:choix-a-la-place',
                userId: req.auth.userId,
                operationId: req.body?.operationId,
                requete: { pool: nom, action: 'autopick', username: req.auth.username },
                appliquer: async ({ data, poolId, journal }) => {
                    if (!authz.peutAdministrer(data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                        throw new ErreurMetier(403, "Seule la personne qui a créé le pool peut choisir à la place d'une équipe.");
                    }
                    const resultat = poolOps.choisirALaPlace(data, {
                        bassin: bassinTrousse(),
                        username: req.auth.username,
                        delaiMs: SAUT_APRES_MS
                    });
                    if (!resultat.ok) throw refus(resultat);

                    journaliserChoixAuto({ journal, data, poolId, nom, resultat, actorUserId: req.auth.userId, parCreateur: true });

                    return {
                        valeur: {
                            teamName: resultat.teamName,
                            playerName: resultat.playerName || null,
                            position: resultat.position || null,
                            pickIndex: resultat.pickIndex,
                            tourSuivant: resultat.tourSuivant,
                            draftComplet: !!resultat.draftComplet
                        }
                    };
                }
            });

            await diffuserChoix(nom, { draftComplet: valeur.draftComplet, rejouee });

            res.json({
                message: valeur.playerName
                    ? `${valeur.playerName} a été choisi pour ${valeur.teamName}.`
                    : `Il ne restait rien à prendre pour ${valeur.teamName} : son tour est passé.`,
                ...valeur,
                rejouee: !!rejouee
            });
        } catch (erreur) {
            repondreErreur(res, erreur, req.path || '/autopick-turn');
        }
    }
    app.post('/autopick-turn', auth.requireAuth, choisirPourEquipe);
    app.post('/skip-turn', auth.requireAuth, choisirPourEquipe);

    /**
     * Le temps d'un choix est écoulé : Fantazy choisit pour l'équipe.
     *
     * Appelé par le minuteur (services/minuteurChoix.js), jamais par une
     * requête. Le minuteur ne fait qu'annoncer l'échéance qu'il attendait ;
     * tout se revalide ici, sous le verrou du pool (poolOps.
     * choisirAutomatiquement) : un choix arrivé à la dernière seconde, un
     * deuxième minuteur ou un redémarrage ne peuvent pas jouer deux fois le
     * même tour. Rien n'est écrit quand il n'y a rien à faire.
     *
     * Les membres de l'équipe apprennent ce qui a été pris pour eux : ils
     * n'étaient pas là pour le voir.
     */
    async function choisirAutomatiquement(nom, { pickIndex = null, maintenant = Date.now() } = {}) {
        const { valeur } = await store.muterPool(nom, {
            scope: 'repechage:choix-auto',
            appliquer: async ({ data, poolId, journal }) => {
                const resultat = poolOps.choisirAutomatiquement(data, { bassin: bassinTrousse(), pickIndex, maintenant });
                if (!resultat.ok) {
                    return { sauvegarder: false, valeur: { fait: false, raison: resultat.message, echeance: resultat.echeance || null } };
                }

                journaliserChoixAuto({ journal, data, poolId, nom, resultat, actorUserId: null });

                return {
                    valeur: {
                        fait: true,
                        teamName: resultat.teamName,
                        playerName: resultat.playerName || null,
                        pickIndex: resultat.pickIndex,
                        draftComplet: !!resultat.draftComplet
                    }
                };
            }
        });

        if (valeur.fait) {
            await diffuserChoix(nom, { draftComplet: valeur.draftComplet });
            logger.log(`Choix automatique (${nom}, choix ${valeur.pickIndex + 1}) : ${valeur.playerName || 'tour passé'} pour ${valeur.teamName}`);
        }
        return valeur;
    }
    ctx.choisirAutomatiquement = choisirAutomatiquement;

    return { SAUT_APRES_MS, checkIfDraftComplete, choisirAutomatiquement };
}

module.exports = { monter, SAUT_APRES_MS };
