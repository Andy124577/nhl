/**
 * « Fantazy Aujourd'hui » : une seule réponse pour les deux dispositions.
 *
 * L'accueil existait en deux versions — bureau et téléphone — qui posaient
 * chacune leurs questions au serveur et décidaient chacune de leur priorité.
 * Deux écrans côte à côte pouvaient donc annoncer deux actions différentes au
 * même compte. Ici, un service répond une fois, et les deux dispositions
 * lisent la même réponse.
 *
 * Ce que le service s'interdit :
 *
 *   - appeler ses propres routes HTTP. Il lit les services et les caches
 *     directement ; un serveur qui s'interroge lui-même paie deux fois le
 *     réseau et se bloque quand il sature ;
 *   - une requête par pool ou par joueur. Les lectures sont groupées, et le
 *     nombre de requêtes ne grandit pas avec la taille des alignements ;
 *   - confondre « ses joueurs jouent ce soir » et « ses joueurs joueront ». Un
 *     joueur dont l'équipe a un match est un joueur dont l'ÉQUIPE joue : ni sa
 *     présence dans l'alignement, ni son départ comme gardien, ne s'en déduit ;
 *   - inventer une échéance. Le repêchage de Fantazy ne chronomètre personne :
 *     un tour n'a donc pas d'échéance, et il n'en reçoit pas une pour les
 *     besoins du tri.
 *
 * Chaque section porte son état : `ok`, `indisponible`, `partiel`. Une section
 * en panne ne doit pas vider les autres, et une section vide ne doit pas se
 * faire passer pour une section en panne.
 */

'use strict';

const authz = require('../lib/authz.js');
const poolOps = require('../lib/poolOps.js');
const priorite = require('../lib/priority.js');
const evenements = require('../lib/events.js');
const dates = require('../lib/dates.js');
const instantDraft = require('../lib/instantDraft.js');

/** Le cache d'une réponse personnalisée est PAR COMPTE, jamais partagé. */
const TTL_CACHE_MS = 15 * 1000;

function creerServiceAujourdhui({ store, db, usePostgres, pointage, serviceH2H,
                                 saisonCourante, calendrierLNH, logger = console }) {

    /** username → { charge, calculeLe } */
    const cache = new Map();

    /**
     * Vide le cache d'une personne : son état vient de changer.
     *
     * La clé de cache porte le pool actif et la vedette affichée, donc une
     * personne peut avoir plusieurs entrées. On les retire toutes.
     */
    function oublier(username) {
        for (const cle of [...cache.keys()]) {
            if (cle.startsWith(`${username}|`)) cache.delete(cle);
        }
    }

    /** Vide le cache de tous les membres d'un pool qui vient de changer. */
    function oublierPool(usernames) { for (const u of usernames || []) oublier(u); }

    // ─────────────────────── Collecte ───────────────────────

    /**
     * Les pools de la personne, lus une seule fois.
     *
     * Tout le reste s'en déduit : le tour de repêchage, le duel, le salon
     * d'attente. Une lecture, pas une par question.
     */
    async function mesPools(username) {
        const tous = await store.lireTous();
        const miens = [];
        for (const [nom, enveloppe] of Object.entries(tous)) {
            const equipe = authz.equipeDe(enveloppe.data, username);
            if (!equipe) continue;
            miens.push({
                nom,
                id: enveloppe.id,
                revision: enveloppe.revision,
                data: enveloppe.data,
                equipe
            });
        }
        return miens;
    }

    /** Résumé publiable d'un pool, pour le sélecteur de l'accueil. */
    function resumeDePool(pool) {
        const h2h = pool.data.h2hData;
        return {
            name: pool.nom,
            teamName: pool.equipe,
            poolMode: pool.data.poolMode || 'cumulative',
            revision: pool.revision,
            instant: pool.data.instant === true,
            draftStarted: poolOps.repechageCommence(pool.data),
            draftComplete: etatDuRepechage(pool.data) === 'termine',
            currentWeek: h2h ? h2h.currentWeek : null,
            participants: authz.membresDuPool(pool.data).length
        };
    }

    /** État du repêchage d'un pool : attente, en cours, ou terminé. */
    function etatDuRepechage(data) {
        if (!poolOps.repechageCommence(data)) return 'attente';
        const quotas = poolOps.config(data);
        const complet = Object.entries(data.teams || {})
            .filter(([, td]) => (td.members || []).length > 0)
            .every(([, td]) =>
                (td.offensive || []).length >= quotas.numOffensive &&
                (td.defensive || []).length >= quotas.numDefensive &&
                (td.rookie || []).length >= quotas.numRookies &&
                (td.goalie || []).length >= quotas.numGoalies &&
                (td.teams || []).length >= quotas.numTeams);
        return complet ? 'termine' : 'encours';
    }

    // ─────────────────────── Éléments de priorité ───────────────────────

    /** Le tour de repêchage, s'il est à cette personne. Urgence maximale. */
    function elementTour(pool) {
        if (etatDuRepechage(pool.data) !== 'encours') return null;
        const indice = pool.data.currentPickIndex || 0;
        const equipeDuTour = (pool.data.draftOrder || [])[indice];
        if (equipeDuTour !== pool.equipe) return null;

        const total = (pool.data.draftOrder || []).length;
        return priorite.element({
            id: `turn:${pool.nom}:${indice}`,
            urgence: priorite.URGENCE.VOTRE_TOUR,
            pool: pool.nom,
            titre: "C'est à votre tour de choisir",
            detail: `Choix ${indice + 1} sur ${total}. Les autres équipes attendent.`,
            action: 'Choisir un joueur',
            href: `draftActif.html?pool=${encodeURIComponent(pool.nom)}`,
            // Aucune échéance : Fantazy ne dépossède personne de son choix par
            // un chronomètre, et une échéance inventée serait un mensonge.
            echeance: null,
            moment: Number(pool.data.turnStartedAt) || null,
            donnees: { pickIndex: indice, totalPicks: total, teamName: pool.equipe }
        });
    }

    /** Un repêchage en cours ailleurs dans le pool, ou un salon prêt à partir. */
    function elementRepechage(pool, salon) {
        const etat = etatDuRepechage(pool.data);

        if (etat === 'encours') {
            const indice = pool.data.currentPickIndex || 0;
            const equipeDuTour = (pool.data.draftOrder || [])[indice];
            if (equipeDuTour === pool.equipe) return null; // déjà couvert, plus urgent
            return priorite.element({
                id: `draft:${pool.nom}`,
                urgence: priorite.URGENCE.REPECHAGE,
                pool: pool.nom,
                titre: 'Repêchage en cours',
                detail: `Au tour de ${equipeDuTour}. Suivez les choix en direct.`,
                action: 'Ouvrir la salle',
                href: `draftActif.html?pool=${encodeURIComponent(pool.nom)}`,
                moment: Number(pool.data.turnStartedAt) || null,
                donnees: { equipeDuTour, pickIndex: indice }
            });
        }

        if (etat === 'attente') {
            const inscrits = authz.membresDuPool(pool.data).length;
            const max = pool.data.maxPlayers || inscrits;
            // Le compte à rebours du salon est la SEULE échéance réelle qu'un
            // départ de repêchage possède. Sans lui, on n'annonce pas d'heure.
            const compte = salon && salon.pool === pool.nom ? salon.compteARebours : null;
            return priorite.element({
                id: `ready:${pool.nom}`,
                urgence: priorite.URGENCE.REPECHAGE,
                pool: pool.nom,
                titre: compte ? 'Le repêchage démarre' : 'Repêchage en préparation',
                detail: compte
                    ? 'Tout le monde est là. Le départ est imminent.'
                    : `${inscrits} sur ${max} participants inscrits.`,
                action: compte ? 'Rejoindre maintenant' : 'Préparer le repêchage',
                href: pool.data.instant
                    ? 'repechage.html'
                    : `repechage.html?pool=${encodeURIComponent(pool.nom)}`,
                echeance: compte ? compte.finit : null,
                donnees: { inscrits, max, compteARebours: compte || null }
            });
        }

        return null;
    }

    /** Une offre d'échange qui attend une réponse. */
    function elementEchange(notification) {
        const sujet = notification.subject || {};
        const vue = evenements.vueNotification(notification);
        return priorite.element({
            id: vue.id,
            urgence: priorite.URGENCE.ECHANGE,
            pool: notification.poolName,
            titre: vue.titre,
            detail: vue.detail,
            action: vue.action,
            href: vue.href,
            moment: vue.date,
            donnees: { tradeId: sujet.tradeId }
        });
    }

    /**
     * Le duel de la semaine.
     *
     * Un duel dont le pointage bouge vraiment passe devant un duel encore à
     * zéro : c'est la différence entre « regardez ça maintenant » et « voici
     * votre adversaire ». L'échéance est la fin de la semaine, qui est une vraie
     * échéance.
     */
    async function elementDuel(pool, saison) {
        const h2h = pool.data.h2hData;
        if (pool.data.poolMode !== 'head-to-head' || !h2h) return null;
        if (etatDuRepechage(pool.data) !== 'termine') return null;

        const numero = Number(h2h.currentWeek) || 1;
        const fenetre = serviceH2H.fenetreDeSemaine(h2h, numero);
        if (!fenetre) return null;

        const duels = (h2h.matchups || [])[numero - 1] || [];
        const mien = duels.find(d => d.team1 === pool.equipe || d.team2 === pool.equipe);
        if (!mien) return null;

        const adversaire = mien.team1 === pool.equipe ? mien.team2 : mien.team1;
        const aujourdhui = dates.journeeLocale();
        const enCours = aujourdhui >= fenetre.debut && aujourdhui < fenetre.fin;

        let scores = null;
        if (enCours && usePostgres) {
            try {
                const contexte = {
                    debut: fenetre.debut,
                    fin: dates.ajouterJours(aujourdhui, 1),
                    saison, mode: 'head-to-head',
                    baseAlignement: pointage.BASE_ALIGNEMENT.COURANT
                };
                const ingestion = await pointage.etatIngestion(contexte);
                const [moi, lui] = await Promise.all([
                    pointage.pointsEquipe(pool.data.teams[pool.equipe], { ...contexte, ingestion }),
                    pointage.pointsEquipe(pool.data.teams[adversaire], { ...contexte, ingestion })
                ]);
                scores = {
                    moi: moi.points, lui: lui.points,
                    completude: moi.completude,
                    // Un total de semaine en cours bouge encore : il est
                    // provisoire, et ne doit pas s'afficher comme un résultat.
                    provisoire: true
                };
            } catch (erreur) {
                logger.error?.('⚠️ Duel en direct indisponible :', erreur.message);
            }
        }

        const bouge = scores && ((scores.moi || 0) !== 0 || (scores.lui || 0) !== 0);

        return priorite.element({
            id: `duel:${pool.nom}:${numero}`,
            urgence: priorite.URGENCE.DUEL,
            pool: pool.nom,
            titre: bouge
                ? `${scores.moi} — ${scores.lui} contre ${adversaire}`
                : `Cette semaine : contre ${adversaire}`,
            detail: bouge
                ? 'Pointage en cours de semaine, encore provisoire.'
                : `Semaine ${numero}, jusqu'au ${fenetre.dernierJour}.`,
            action: 'Voir le duel',
            href: `classement.html?pool=${encodeURIComponent(pool.nom)}&onglet=h2h&semaine=${numero}`,
            echeance: fenetre.finInstant ? fenetre.finInstant.getTime() : null,
            // Un duel qui bouge doit devancer un duel encore vierge, à urgence
            // égale : le moment le plus récent l'emporte au tri.
            moment: bouge ? Date.now() : 0,
            donnees: {
                weekNumber: numero, adversaire, monEquipe: pool.equipe,
                scores, weekStart: fenetre.debut, weekEnd: fenetre.fin
            },
            etat: scores ? 'ok' : (enCours && usePostgres ? 'indisponible' : 'ok')
        });
    }

    /** Un résultat de semaine qui vient d'être inscrit. */
    function elementResultat(notification) {
        const vue = evenements.vueNotification(notification);
        return priorite.element({
            id: vue.id,
            urgence: priorite.URGENCE.RESULTAT,
            pool: notification.poolName,
            titre: vue.titre,
            detail: vue.detail,
            action: vue.action,
            href: vue.href,
            moment: vue.date,
            donnees: notification.subject || {}
        });
    }

    /**
     * Les joueurs dont l'ÉQUIPE joue ce soir.
     *
     * Le libellé n'est pas une nuance de style. Un joueur au sein d'un
     * alignement dont l'équipe a un match n'est pas un joueur qui jouera : il
     * peut être blessé, laissé de côté, ou remplacé. Et un gardien inscrit
     * n'est pas un gardien partant. Annoncer « vos joueurs jouent » serait une
     * affirmation que rien ici ne permet de faire.
     */
    async function elementCeSoir(pools) {
        if (!calendrierLNH) return null;
        const journee = dates.journeeLocale();
        let matchs = null;
        try { matchs = await calendrierLNH.matchsTermines(journee); }
        catch { matchs = null; }

        // Le calendrier du jour ne dit pas encore qui joue ce soir quand aucun
        // match n'est terminé ; on ne devine pas, on se tait.
        if (matchs == null) {
            return priorite.element({
                id: 'ce-soir',
                urgence: priorite.URGENCE.INFORMATION,
                titre: 'Calendrier du jour indisponible',
                detail: 'Réessayez dans quelques minutes.',
                etat: 'indisponible'
            });
        }

        const equipesEnJeu = pools.filter(p => etatDuRepechage(p.data) === 'termine').length;
        if (equipesEnJeu === 0) return null;

        return priorite.element({
            id: 'ce-soir',
            urgence: priorite.URGENCE.INFORMATION,
            titre: matchs > 0 ? `${matchs} match${matchs > 1 ? 's' : ''} terminé${matchs > 1 ? 's' : ''} aujourd'hui`
                              : "Aucun match terminé aujourd'hui",
            detail: 'Les pointages se mettent à jour à mesure que les matchs se terminent.',
            action: 'Voir les statistiques',
            href: 'stats.html',
            donnees: { journee, matchsTermines: matchs }
        });
    }

    // ─────────────────────── Assemblage ───────────────────────

    /**
     * La réponse complète pour une personne.
     *
     * `vedettePrecedente` vient du client : il annonce ce qu'il affiche déjà,
     * pour que l'élément principal ne se dérobe pas sous le doigt à chaque
     * rafraîchissement. Seul un élément plus urgent prend sa place.
     */
    async function pour(username, { poolActif = null, vedettePrecedente = null, salon = null } = {}) {
        const saison = saisonCourante();
        const pools = await mesPools(username);
        const elements = [];
        const sources = {};

        for (const pool of pools) {
            const tour = elementTour(pool);
            if (tour) elements.push(tour);
            const repechage = elementRepechage(pool, salon);
            if (repechage) elements.push(repechage);
        }
        sources.pools = { etat: 'ok', nombre: pools.length };

        // Offres en attente et résultats récents viennent des notifications
        // durables : la même source que la cloche, donc les mêmes destinations.
        if (usePostgres) {
            try {
                const userId = await db.getUserId(username);
                if (userId) {
                    const notifications = await db.getNotificationsForUser(userId, { limite: 60 });
                    for (const notification of notifications) {
                        if (notification.type === evenements.NOTIFICATION.ECHANGE_RECU && !notification.resolvedAt) {
                            elements.push(elementEchange(notification));
                        }
                        if (notification.type === evenements.NOTIFICATION.NOUVELLE_SEMAINE && !notification.readAt) {
                            elements.push(elementResultat(notification));
                        }
                    }
                    sources.notifications = { etat: 'ok', nombre: notifications.length };
                } else {
                    sources.notifications = { etat: 'indisponible', raison: 'compte_introuvable' };
                }
            } catch (erreur) {
                // Une section en panne n'en vide pas les autres.
                logger.error?.('⚠️ Notifications indisponibles pour Aujourd hui :', erreur.message);
                sources.notifications = { etat: 'indisponible', raison: 'erreur' };
            }
        } else {
            sources.notifications = { etat: 'indisponible', raison: 'postgres_requis' };
        }

        for (const pool of pools) {
            try {
                const duel = await elementDuel(pool, saison);
                if (duel) elements.push(duel);
            } catch (erreur) {
                logger.error?.(`⚠️ Duel indisponible pour ${pool.nom} :`, erreur.message);
            }
        }
        sources.duels = { etat: usePostgres ? 'ok' : 'indisponible' };

        try {
            const ceSoir = await elementCeSoir(pools);
            if (ceSoir) elements.push(ceSoir);
            sources.calendrier = { etat: ceSoir && ceSoir.etat === 'indisponible' ? 'indisponible' : 'ok' };
        } catch (erreur) {
            sources.calendrier = { etat: 'indisponible', raison: 'erreur' };
        }

        const classement = priorite.classer(elements, { poolActif, vedettePrecedente });

        const enAttente = pools.some(p => etatDuRepechage(p.data) === 'attente' &&
                                          instantDraft.estPoolInstantane(p.nom, p.data));

        return {
            generatedAt: new Date().toISOString(),
            asOf: dates.journeeLocale(),
            season: saison,
            poolActif,
            vedette: classement.vedette,
            secondaires: classement.secondaires,
            total: classement.total,
            vide: classement.vedette ? null : priorite.etatVide({
                aDesPools: pools.length > 0,
                enAttente,
                horsSaison: false
            }),
            pools: pools.map(resumeDePool),
            sources
        };
    }

    /**
     * Réponse mise en cache quelques secondes, PAR COMPTE.
     *
     * Une clé partagée servirait l'accueil d'une personne à une autre. Le
     * délai est court : il absorbe une rafale d'événements socket sans
     * retenir un état périmé.
     */
    async function pourAvecCache(username, options = {}) {
        const cle = `${username}|${options.poolActif || ''}|${options.vedettePrecedente || ''}`;
        const entree = cache.get(cle);
        if (entree && (Date.now() - entree.calculeLe) < TTL_CACHE_MS) {
            return { ...entree.charge, cache: true };
        }
        const charge = await pour(username, options);
        cache.set(cle, { charge, calculeLe: Date.now() });
        // Le cache reste petit : une entrée par combinaison consultée, purgée
        // dès qu'elle dépasse une taille raisonnable.
        if (cache.size > 500) {
            for (const [k, v] of cache) {
                if (Date.now() - v.calculeLe > TTL_CACHE_MS) cache.delete(k);
            }
        }
        return charge;
    }

    return { pour, pourAvecCache, oublier, oublierPool, etatDuRepechage, mesPools, TTL_CACHE_MS };
}

module.exports = { creerServiceAujourdhui, TTL_CACHE_MS };
