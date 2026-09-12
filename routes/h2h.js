/**
 * Tête-à-tête : le duel de la semaine, le calendrier, le centre des duels.
 *
 * Toutes les surfaces lisent maintenant le même service de pointage et le même
 * module de calendrier. Avant, chacune recalculait à sa façon : l'une fermait
 * la semaine au lundi inclus, l'autre au lundi exclu, et la troisième
 * substituait les totaux de saison quand les feuilles de match manquaient. Le
 * même duel pouvait donc afficher trois scores.
 *
 * Ce que ces routes ne font plus :
 *
 *   - écrire pendant une lecture. `/h2h/current-week-scores` réparait le
 *     calendrier au passage, en réécrivant le pool depuis une lecture qui
 *     n'était pas verrouillée ;
 *   - présenter un total provisoire comme définitif. Chaque réponse porte son
 *     état de complétude, et une semaine en cours est annoncée comme telle ;
 *   - inventer un « depuis hier ». Il demande des relevés comparables ; tant
 *     qu'ils n'existent pas, la donnée est absente plutôt qu'approchée.
 */

'use strict';

const authz = require('../lib/authz.js');
const dates = require('../lib/dates.js');
const scoring = require('../lib/scoring.js');
const { generateSeasonSchedule } = require('../lib/h2h.js');

function monter(app, ctx) {
    const { auth, store, db, pointage, serviceH2H, saisonCourante,
            fenetreSaison, usePostgres, logger = console } = ctx;
    const { ErreurMetier } = store;

    function repondreErreur(res, erreur, contexte) {
        if (erreur.name === 'ErreurMetier' || erreur.name === 'ErreurConflit') {
            return res.status(erreur.code || 400).json({ message: erreur.message, ...(erreur.extra || {}) });
        }
        logger.error(`Erreur ${contexte} :`, erreur);
        return res.status(500).json({ message: "Erreur interne du serveur." });
    }

    /** Charge un pool tête-à-tête dont la personne connectée est membre. */
    async function poolH2H(req, res, nomPool) {
        if (!nomPool) {
            res.status(400).json({ message: "Nom du pool requis." });
            return null;
        }
        const enveloppe = await store.lire(nomPool);
        if (!enveloppe) {
            res.status(404).json({ message: "Pool introuvable." });
            return null;
        }
        if (!req.auth.isAdmin && !authz.estMembre(enveloppe.data, req.auth.username)) {
            res.status(403).json({ message: "Vous n'êtes pas membre de ce pool." });
            return null;
        }
        if (enveloppe.data.poolMode !== 'head-to-head' || !enveloppe.data.h2hData) {
            res.status(400).json({ message: "Ce pool n'est pas en mode tête-à-tête." });
            return null;
        }
        return enveloppe;
    }

    /**
     * Le pointage d'un duel, ou son absence annoncée.
     *
     * Les feuilles de match vivent dans une table PostgreSQL. Sans elle, le
     * CALENDRIER reste lisible — il vit dans le pool — mais les points ne le
     * sont pas. Renvoyer zéro serait pire que ne rien renvoyer : personne ne
     * distinguerait « ce duel est à 0-0 » de « on ne sait pas ».
     */
    async function pointerDuel(duel, teams, contexte, ingestion) {
        if (!usePostgres) {
            const vide = {
                points: null,
                completude: scoring.COMPLETUDE.INDISPONIBLE,
                detail: { joueurs: [], club: null }
            };
            return [vide, vide];
        }
        return Promise.all([
            pointage.pointsEquipe(teams[duel.team1], { ...contexte, ingestion }),
            pointage.pointsEquipe(teams[duel.team2], { ...contexte, ingestion })
        ]);
    }

    /** L'état d'ingestion, ou un état « indisponible » assumé. */
    async function etatIngestion(contexte) {
        if (!usePostgres) {
            return { completude: scoring.COMPLETUDE.INDISPONIBLE, attendus: null, recus: 0, journees: [] };
        }
        return pointage.etatIngestion(contexte);
    }

    /**
     * État d'une semaine par rapport à maintenant.
     *
     * « Terminée » veut dire finalisée, pas seulement passée : une semaine
     * échue mais non pointée reste en attente tant que le rattrapage n'a pas
     * écrit ses résultats. Confondre les deux annoncerait un résultat final
     * là où il n'y en a pas encore.
     */
    function etatDeSemaine(fenetre, numero, semaineCourante, finalisee) {
        if (finalisee) return 'completed';
        if (numero < semaineCourante) return 'pending_finalization';
        const aujourdhui = dates.journeeLocale();
        if (aujourdhui < fenetre.debut) return 'upcoming';
        if (aujourdhui >= fenetre.fin) return 'pending_finalization';
        return 'ongoing';
    }

    // ─────────────────────── Semaine en cours ───────────────────────

    /**
     * Le duel de la semaine en cours, avec le détail par joueur.
     *
     * Lecture pure : aucune écriture, aucune réparation de calendrier. Une
     * semaine en cours est pointée du lundi à MAINTENANT, et le dit — c'est un
     * total qui bouge encore, pas le résultat de la semaine.
     */
    app.get('/h2h/current-week-scores', auth.requireAuth, async (req, res) => {
        try {
            const nomPool = req.query.poolName;
            const enveloppe = await poolH2H(req, res, nomPool);
            if (!enveloppe) return;

            const h2h = enveloppe.data.h2hData;
            const numero = Number(h2h.currentWeek) || 1;
            const saison = h2h.season || saisonCourante();
            const fenetre = serviceH2H.fenetreDeSemaine(h2h, numero);

            const duels = (h2h.matchups || [])[numero - 1] || [];
            if (!fenetre || duels.length === 0) {
                return res.json({
                    currentWeek: numero,
                    weekStatus: fenetre ? 'no_matchups' : 'awaiting_draft_completion',
                    weekStart: fenetre ? fenetre.debut : null,
                    weekEnd: fenetre ? fenetre.fin : null,
                    matchups: [],
                    standings: h2h.standings || {},
                    matchupHistory: h2h.matchupHistory || [],
                    revision: enveloppe.revision
                });
            }

            const aujourdhui = dates.journeeLocale();
            const etat = etatDeSemaine(fenetre, numero, numero, false);

            // Une semaine en cours se pointe jusqu'à aujourd'hui INCLUS : la
            // borne exclusive est donc demain, pas aujourd'hui.
            const finEffective = etat === 'upcoming'
                ? fenetre.debut
                : (aujourdhui < fenetre.fin ? dates.ajouterJours(aujourdhui, 1) : fenetre.fin);

            const contexte = {
                debut: fenetre.debut, fin: finEffective, saison,
                mode: 'head-to-head', baseAlignement: pointage.BASE_ALIGNEMENT.COURANT
            };
            const ingestion = await etatIngestion(contexte);

            const affichage = [];
            for (const duel of duels) {
                const [p1, p2] = await pointerDuel(duel, enveloppe.data.teams, contexte, ingestion);
                affichage.push(carteDeDuel(duel, p1, p2, enveloppe.data));
            }

            res.json({
                currentWeek: numero,
                season: saison,
                weekStart: fenetre.debut,
                weekEnd: fenetre.fin,
                weekLastDay: fenetre.dernierJour,
                weekStatus: etat,
                scoredThrough: finEffective,
                completude: ingestion.completude,
                // Le calendrier reste lisible sans PostgreSQL ; les points, non.
                pointageDisponible: !!usePostgres,
                provisoire: etat === 'ongoing',
                scoringVersion: scoring.VERSION_BAREME,
                rosterBasis: pointage.BASE_ALIGNEMENT.COURANT,
                matchups: affichage,
                standings: h2h.standings || {},
                matchupHistory: h2h.matchupHistory || [],
                revision: enveloppe.revision
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/h2h/current-week-scores');
        }
    });

    /**
     * La carte d'un duel : score, meneur, écart, détail, meilleurs pointeurs.
     *
     * Une équipe est présentée comme une ÉQUIPE, avec ses membres. Prendre un
     * nom d'utilisateur pour l'adversaire complet se voyait dès qu'une équipe
     * comptait deux personnes.
     */
    function carteDeDuel(duel, p1, p2, poolData) {
        const points1 = p1.points == null ? 0 : p1.points;
        const points2 = p2.points == null ? 0 : p2.points;
        const ecart = scoring.arrondi(Math.abs(points1 - points2));
        const meneur = points1 === points2 ? null : (points1 > points2 ? duel.team1 : duel.team2);

        const contributeurs = (resultat) => (resultat.detail?.joueurs || [])
            .filter(j => j.matchs > 0)
            .sort((a, b) => b.fantasyPoints - a.fantasyPoints)
            .slice(0, 3)
            .map(j => ({ name: j.name, fantasyPoints: j.fantasyPoints, matchs: j.matchs }));

        const equipe = (nom) => ({
            name: nom,
            members: (poolData.teams?.[nom]?.members) || []
        });

        return {
            team1: duel.team1,
            team2: duel.team2,
            team1Info: equipe(duel.team1),
            team2Info: equipe(duel.team2),
            team1Points: scoring.arrondi(points1),
            team2Points: scoring.arrondi(points2),
            // Égalité assumée : `meneur: null` et `egalite: true`, plutôt qu'un
            // meneur arbitraire choisi par l'ordre du tableau.
            meneur,
            egalite: points1 === points2,
            ecart,
            winner: duel.winner || null,
            team1Players: p1.detail?.joueurs || [],
            team2Players: p2.detail?.joueurs || [],
            team1Top: contributeurs(p1),
            team2Top: contributeurs(p2),
            // Le club repêché : sa contribution au duel est nommée, pas devinée.
            club: p1.detail?.club || null,
            completude: p1.completude
        };
    }

    // ─────────────────────── Centre des duels ───────────────────────

    /**
     * Une semaine précise d'un pool précis — la destination directe du centre
     * des duels.
     *
     * Un lien de notification doit pouvoir viser une semaine, pas seulement
     * « la semaine en cours » : sinon, cliquer sur « semaine 3 terminée » le
     * jeudi de la semaine 4 ouvre la mauvaise page.
     */
    app.get('/h2h/matchup', auth.requireAuth, async (req, res) => {
        try {
            const nomPool = req.query.poolName;
            const enveloppe = await poolH2H(req, res, nomPool);
            if (!enveloppe) return;

            const h2h = enveloppe.data.h2hData;
            const numero = Number(req.query.week) || Number(h2h.currentWeek) || 1;
            const saison = h2h.season || saisonCourante();
            const fenetre = serviceH2H.fenetreDeSemaine(h2h, numero);
            if (!fenetre) return res.status(409).json({ message: "Cette saison n'a pas de date de départ." });

            // Une semaine close se relit dans son résultat FIGÉ : le recalculer
            // depuis les alignements du jour laisserait un échange de mardi
            // réécrire le pointage de la semaine dernière.
            const archive = (h2h.matchupHistory || []).find(s => Number(s.weekNumber) === numero);
            if (archive) {
                return res.json({
                    poolName: nomPool,
                    weekNumber: numero,
                    season: archive.season || saison,
                    weekStart: fenetre.debut,
                    weekEnd: fenetre.fin,
                    weekStatus: 'completed',
                    fige: true,
                    revision: archive.revision || 1,
                    scoringVersion: archive.scoringVersion || null,
                    rosterBasis: archive.rosterBasis || null,
                    revisedDate: archive.revisedDate || null,
                    matchups: archive.matchups || [],
                    standings: h2h.standings || {},
                    monEquipe: authz.equipeDe(enveloppe.data, req.auth.username)
                });
            }

            const aujourdhui = dates.journeeLocale();
            const etat = etatDeSemaine(fenetre, numero, Number(h2h.currentWeek) || 1, false);
            const finEffective = etat === 'upcoming'
                ? fenetre.debut
                : (aujourdhui < fenetre.fin ? dates.ajouterJours(aujourdhui, 1) : fenetre.fin);

            const contexte = {
                debut: fenetre.debut, fin: finEffective, saison,
                mode: 'head-to-head', baseAlignement: pointage.BASE_ALIGNEMENT.COURANT
            };
            const ingestion = await pointage.etatIngestion(contexte);
            const duels = (h2h.matchups || [])[numero - 1] || [];

            const affichage = [];
            for (const duel of duels) {
                const [p1, p2] = await Promise.all([
                    pointage.pointsEquipe(enveloppe.data.teams[duel.team1], { ...contexte, ingestion }),
                    pointage.pointsEquipe(enveloppe.data.teams[duel.team2], { ...contexte, ingestion })
                ]);
                affichage.push(carteDeDuel(duel, p1, p2, enveloppe.data));
            }

            res.json({
                poolName: nomPool,
                weekNumber: numero,
                season: saison,
                weekStart: fenetre.debut,
                weekEnd: fenetre.fin,
                weekLastDay: fenetre.dernierJour,
                weekStatus: etat,
                fige: false,
                provisoire: etat === 'ongoing',
                scoredThrough: finEffective,
                completude: ingestion.completude,
                scoringVersion: scoring.VERSION_BAREME,
                rosterBasis: pointage.BASE_ALIGNEMENT.COURANT,
                matchups: affichage,
                standings: h2h.standings || {},
                monEquipe: authz.equipeDe(enveloppe.data, req.auth.username),
                revision: enveloppe.revision
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/h2h/matchup');
        }
    });

    // ─────────────────────── Aujourd'hui ───────────────────────

    /**
     * Ce que les duels ont marqué AUJOURD'HUI.
     *
     * La journée est celle d'`America/Toronto`, pas celle du serveur : un match
     * terminé à 00 h 30 appartient à la soirée qu'on vient de regarder, et
     * c'est la date que la LNH lui a donnée qui tranche.
     */
    app.get('/h2h/today-scores', auth.requireAuth, async (req, res) => {
        try {
            const nomPool = req.query.poolName;
            const enveloppe = await poolH2H(req, res, nomPool);
            if (!enveloppe) return;

            const h2h = enveloppe.data.h2hData;
            const numero = Number(h2h.currentWeek) || 1;
            const saison = h2h.season || saisonCourante();
            const duels = (h2h.matchups || [])[numero - 1] || [];
            if (duels.length === 0) {
                return res.json({ currentWeek: numero, matchups: [], weekStatus: 'no_matchups' });
            }

            const aujourdhui = dates.journeeLocale();
            const contexte = {
                debut: aujourdhui, fin: dates.ajouterJours(aujourdhui, 1), saison,
                mode: 'head-to-head', baseAlignement: pointage.BASE_ALIGNEMENT.COURANT
            };
            const ingestion = await etatIngestion(contexte);

            const affichage = [];
            for (const duel of duels) {
                const [p1, p2] = await pointerDuel(duel, enveloppe.data.teams, contexte, ingestion);
                affichage.push(carteDeDuel(duel, p1, p2, enveloppe.data));
            }

            res.json({
                currentWeek: numero,
                date: aujourdhui,
                completude: ingestion.completude,
                provisoire: true,
                matchups: affichage,
                standings: h2h.standings || {}
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/h2h/today-scores');
        }
    });

    // ─────────────────────── Calendrier de saison ───────────────────────

    app.get('/h2h/season-schedule', auth.requireAuth, async (req, res) => {
        try {
            const nomPool = req.query.poolName;
            const enveloppe = await poolH2H(req, res, nomPool);
            if (!enveloppe) return;

            const h2h = enveloppe.data.h2hData;
            const depart = h2h.seasonStart || h2h.weekStart || null;

            if (!depart) {
                return res.json({
                    poolName: nomPool, currentWeek: h2h.currentWeek || 1,
                    seasonStart: null, seasonEnd: null,
                    status: 'awaiting_draft_completion', weeks: [], teams: []
                });
            }

            let fin = h2h.seasonEnd || null;
            if (!fin && fenetreSaison) {
                const fenetre = await fenetreSaison();
                fin = (fenetre && fenetre.regularSeasonEndDate) || null;
            }

            const lundiDepart = dates.lundiDe(dates.journeeDe(depart));
            const totalSemaines = h2h.seasonWeeks || dates.nombreDeSemaines(lundiDepart, fin);

            // Un calendrier trop court se complète — dans sa PROPRE transaction,
            // et jamais au milieu d'une lecture. L'ancienne version réécrivait
            // le pool depuis une lecture non verrouillée, ce qui pouvait
            // effacer une modification faite entre-temps.
            if ((h2h.matchups || []).length < totalSemaines) {
                try { await completerCalendrier(nomPool, totalSemaines, fin); }
                catch (erreur) { logger.error('Complément de calendrier impossible :', erreur.message); }
            }

            const frais = await store.lire(nomPool);
            const h2hFrais = frais.data.h2hData;
            const archives = new Map(
                (h2hFrais.matchupHistory || [])
                    .filter(s => s && s.weekNumber)
                    .map(s => [Number(s.weekNumber), s])
            );
            const semaineCourante = Number(h2hFrais.currentWeek) || 1;

            const semaines = (h2hFrais.matchups || []).map((duels, index) => {
                const numero = index + 1;
                const fenetre = dates.semaineNumero(lundiDepart, numero);
                const archive = archives.get(numero);
                const source = (archive && Array.isArray(archive.matchups) && archive.matchups.length)
                    ? archive.matchups : (duels || []);

                return {
                    weekNumber: numero,
                    weekStart: fenetre.debut,
                    weekEnd: fenetre.fin,
                    weekLastDay: fenetre.dernierJour,
                    status: etatDeSemaine(fenetre, numero, semaineCourante, !!archive),
                    revision: archive ? (archive.revision || 1) : null,
                    matchups: source.map(m => ({
                        team1: m.team1,
                        team2: m.team2,
                        team1Points: scoring.arrondi(m.team1Points || 0),
                        team2Points: scoring.arrondi(m.team2Points || 0),
                        winner: m.winner || null
                    }))
                };
            });

            const equipes = Object.entries(frais.data.teams || {})
                .filter(([, td]) => (td?.members || []).length > 0)
                .map(([nom, td]) => ({
                    name: nom,
                    members: td.members,
                    record: (h2hFrais.standings && h2hFrais.standings[nom]) || null
                }));

            res.json({
                poolName: nomPool,
                currentWeek: semaineCourante,
                season: h2hFrais.season || saisonCourante(),
                seasonStart: lundiDepart,
                seasonEnd: fin,
                totalWeeks: semaines.length,
                status: 'ok',
                weeks: semaines,
                teams: equipes,
                monEquipe: authz.equipeDe(frais.data, req.auth.username),
                revision: frais.revision
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/h2h/season-schedule');
        }
    });

    /** Ajoute les semaines manquantes sans jamais toucher à celles déjà jouées. */
    async function completerCalendrier(nomPool, totalSemaines, finSaison) {
        return store.muterPool(nomPool, {
            scope: 'h2h:complement-calendrier',
            appliquer: async ({ data }) => {
                const h2h = data.h2hData;
                const deja = Array.isArray(h2h.matchups) ? h2h.matchups.length : 0;
                if (deja >= totalSemaines) return { sauvegarder: false, valeur: { ajoutees: 0 } };

                const equipes = Object.entries(data.teams)
                    .filter(([, td]) => (td.members || []).length > 0)
                    .map(([nom, td]) => ({ name: nom, members: td.members }));

                const complement = generateSeasonSchedule(equipes, totalSemaines - deja);
                if (complement.length === 0) return { sauvegarder: false, valeur: { ajoutees: 0 } };

                if (!Array.isArray(h2h.matchups)) h2h.matchups = [];
                complement.forEach((duels, i) => {
                    h2h.matchups.push(duels.map(d => ({ ...d, weekNumber: deja + i + 1 })));
                });
                h2h.seasonWeeks = h2h.matchups.length;
                h2h.seasonEnd = h2h.seasonEnd || finSaison;
                return { valeur: { ajoutees: complement.length } };
            }
        });
    }

    // ─────────────────────── Finalisation ───────────────────────

    /**
     * Finalise une semaine à la main.
     *
     * Même service que le travail de fond, donc même résultat. Réservée à la
     * personne qui a créé le pool : fermer une semaine change le classement de
     * tout le monde.
     */
    app.post('/h2h/finalize-week', auth.requireAuth, async (req, res) => {
        try {
            const nomPool = req.body?.poolName;
            const enveloppe = await poolH2H(req, res, nomPool);
            if (!enveloppe) return;

            if (!authz.peutAdministrer(enveloppe.data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                return res.status(403).json({
                    message: "Seule la personne qui a créé le pool peut finaliser une semaine."
                });
            }

            const resultat = await serviceH2H.finaliserSemaine(nomPool, {
                numeroAttendu: req.body?.weekNumber,
                acteur: req.auth
            });

            res.json({
                message: `Semaine ${resultat.weekNumber} finalisée.`,
                previousWeek: resultat.weekNumber,
                currentWeek: resultat.currentWeek,
                season: resultat.season,
                results: resultat.results,
                standings: resultat.standings
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/h2h/finalize-week');
        }
    });

    /**
     * Recalcule une semaine close après une correction officielle.
     *
     * Crée une révision : le classement est ajusté par la différence, jamais en
     * additionnant la victoire une deuxième fois.
     */
    app.post('/h2h/revise-week', auth.requireAuth, async (req, res) => {
        try {
            const nomPool = req.body?.poolName;
            const enveloppe = await poolH2H(req, res, nomPool);
            if (!enveloppe) return;

            if (!authz.peutAdministrer(enveloppe.data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                return res.status(403).json({ message: "Action réservée à la personne qui a créé le pool." });
            }

            const numero = Number(req.body?.weekNumber);
            if (!Number.isInteger(numero) || numero < 1) {
                return res.status(400).json({ message: "Numéro de semaine requis." });
            }

            const resultat = await serviceH2H.reviserSemaine(nomPool, numero, { acteur: req.auth });
            res.json({
                message: `Semaine ${numero} révisée (révision ${resultat.revision}).`,
                ...resultat
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/h2h/revise-week');
        }
    });

    return { carteDeDuel, etatDeSemaine, completerCalendrier };
}

module.exports = { monter };
