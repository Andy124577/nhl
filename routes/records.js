/**
 * Palmarès et records d'un pool.
 *
 * Deux surfaces vivaient ici avec le même défaut : elles recopiaient le barème,
 * découpaient les journées en UTC, et l'une remplaçait une fenêtre glissante
 * manquante par les totaux de saison — des cumuls depuis octobre présentés à
 * côté de pointages de sept jours, dans le même tableau.
 *
 * Ce qui change :
 *
 *   - un seul barème (lib/scoring.js) et un seul calendrier (lib/dates.js) ;
 *   - plus de substitution. Une fenêtre sans données donne `points: null` et
 *     un état de complétude, pas un nombre d'une autre unité ;
 *   - la base d'alignement est ÉCRITE sur chaque réponse. Ces records appliquent
 *     l'alignement du jour à des matchs passés : c'est la règle en vigueur, elle
 *     a une conséquence — un échange de mardi change ce que janvier valait — et
 *     l'annoncer vaut mieux que la laisser deviner ;
 *   - les records d'un pool sont réservés à ses membres.
 */

'use strict';

const authz = require('../lib/authz.js');
const dates = require('../lib/dates.js');
const scoring = require('../lib/scoring.js');

/** Fenêtres glissantes proposées par le palmarès. */
const FENETRES = [1, 7, 14, 30, 90, 180, 365];

function monter(app, ctx) {
    const { auth, store, db, pointage, saisonCourante, fenetreSaison,
            saisonCommencee, serviceRecap, logger = console } = ctx;

    function repondreErreur(res, erreur, contexte) {
        if (erreur.name === 'ErreurMetier' || erreur.name === 'ErreurConflit') {
            return res.status(erreur.code || 400).json({ message: erreur.message, ...(erreur.extra || {}) });
        }
        logger.error(`Erreur ${contexte} :`, erreur);
        return res.status(500).json({ message: "Erreur interne du serveur." });
    }

    /** Charge un pool dont la personne connectée est membre. */
    async function poolMembre(req, res, nomPool) {
        const enveloppe = await store.lire(nomPool);
        if (!enveloppe) { res.status(404).json({ message: "Pool introuvable." }); return null; }
        if (!req.auth.isAdmin && !authz.estMembre(enveloppe.data, req.auth.username)) {
            res.status(403).json({ message: "Vous n'êtes pas membre de ce pool." });
            return null;
        }
        return enveloppe;
    }

    /** Les équipes qui ont au moins un participant. */
    const equipesActives = (poolData) => Object.entries(poolData.teams || {})
        .filter(([, td]) => (td?.members || []).length > 0);

    // ───────────────────────────── Palmarès glissant ─────────────────────────────

    /**
     * La meilleure équipe sur les N derniers jours.
     *
     * La fenêtre est semi-ouverte et se ferme à AUJOURD'HUI inclus : `[il y a
     * N-1 jours, demain)`. Sans cette précision, « 7 derniers jours » désignait
     * parfois six journées, parfois huit, selon l'heure de la requête.
     */
    app.get('/pool-leaderboard/:poolName', auth.requireAuth, async (req, res) => {
        try {
            const nomPool = req.params.poolName;
            const enveloppe = await poolMembre(req, res, nomPool);
            if (!enveloppe) return;

            let jours = parseInt(req.query.days, 10);
            if (!FENETRES.includes(jours)) jours = 7;

            const fenetre = fenetreSaison ? await fenetreSaison() : null;
            if (saisonCommencee && !saisonCommencee(fenetre)) {
                // Avant le premier match, il n'y a rien à classer. L'ancienne
                // version retombait alors sur les totaux de saison, qui sont
                // encore ceux de l'an passé pour un pool tout neuf.
                return res.json({
                    poolName: nomPool, days: jours, generatedAt: new Date().toISOString(),
                    seasonStarted: false, teams: []
                });
            }

            const aujourdhui = dates.journeeLocale();
            const debut = dates.ajouterJours(aujourdhui, -(jours - 1));
            const fin = dates.ajouterJours(aujourdhui, 1);
            const saison = saisonCourante();

            const contexte = {
                debut, fin, saison, mode: 'cumulative',
                baseAlignement: pointage.BASE_ALIGNEMENT.COURANT
            };
            const ingestion = await pointage.etatIngestion(contexte);

            const equipes = [];
            for (const [nomEquipe, teamData] of equipesActives(enveloppe.data)) {
                const resultat = await pointage.pointsEquipe(teamData, { ...contexte, ingestion });
                equipes.push({
                    teamName: nomEquipe,
                    members: teamData.members || [],
                    points: resultat.points,
                    completude: resultat.completude
                });
            }

            // Une équipe sans données passe derrière celles qui en ont, mais son
            // absence reste lisible : `points: null`, pas un zéro inventé.
            equipes.sort((a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity));
            equipes.forEach((equipe, i) => { equipe.rank = i + 1; });

            res.json({
                poolName: nomPool,
                days: jours,
                periode: { debut, fin, dernierJour: aujourdhui },
                generatedAt: new Date().toISOString(),
                seasonStarted: true,
                season: saison,
                scoringVersion: scoring.VERSION_BAREME,
                rosterBasis: pointage.BASE_ALIGNEMENT.COURANT,
                completude: ingestion.completude,
                teams: equipes
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/pool-leaderboard');
        }
    });

    // ───────────────────────────── Temple de la renommée ─────────────────────────────

    /**
     * Meilleure et pire journée, semaine et mois du pool cette saison.
     *
     * Deux corrections de fond :
     *
     *   - les journées sont celles d'`America/Toronto`, pas celles d'UTC. Un
     *     match du dimanche soir tombait en lundi UTC, donc dans la semaine
     *     suivante, et le « meilleur dimanche » du pool changeait de semaine ;
     *   - les semaines sont semi-ouvertes `[lundi, lundi suivant)`, la même
     *     définition que partout ailleurs.
     *
     * Ce qui ne change pas, et qui est assumé : l'alignement d'aujourd'hui est
     * appliqué aux matchs passés. C'est la règle du produit, elle est annoncée
     * dans `rosterBasis`, et elle interdit d'en tirer un exploit personnel —
     * un joueur acquis mardi n'a pas gagné le duel de la semaine dernière.
     */
    app.get('/pool-hall-of-fame/:poolName', auth.requireAuth, async (req, res) => {
        try {
            const nomPool = req.params.poolName;
            const enveloppe = await poolMembre(req, res, nomPool);
            if (!enveloppe) return;

            const saison = saisonCourante();
            const vide = {
                poolName: nomPool,
                generatedAt: new Date().toISOString(),
                season: saison,
                scoringVersion: scoring.VERSION_BAREME,
                rosterBasis: pointage.BASE_ALIGNEMENT.COURANT,
                seasonStarted: true,
                bestDay: null, worstDay: null,
                bestWeek: null, worstWeek: null,
                bestMonth: null, worstMonth: null
            };

            const fenetre = fenetreSaison ? await fenetreSaison() : null;
            if (saisonCommencee && !saisonCommencee(fenetre)) {
                // Un pool repêché l'été ouvrait sur un temple déjà bâti : les
                // joueurs venaient d'être choisis, mais leurs matchs de la
                // saison précédente étaient encore en base.
                return res.json({ ...vide, seasonStarted: false });
            }

            const equipeDuJoueur = new Map();
            const membresDEquipe = new Map();
            for (const [nomEquipe, teamData] of equipesActives(enveloppe.data)) {
                membresDEquipe.set(nomEquipe, teamData.members || []);
                for (const joueur of pointage.alignementDe(teamData).joueurs) {
                    equipeDuJoueur.set(joueur.nom, nomEquipe);
                }
            }

            const noms = [...equipeDuJoueur.keys()];
            if (noms.length === 0) return res.json(vide);

            const lignes = await db.query(`
                SELECT player_name, game_date, position,
                       goals, assists, shots, plus_minus,
                       power_play_goals, power_play_points,
                       shorthanded_goals, shorthanded_points, game_winning_goals,
                       decision, saves, goals_against, shutouts
                  FROM player_game_logs
                 WHERE season = $1 AND player_name = ANY($2)
            `, [saison, noms]);

            if (lignes.rows.length === 0) return res.json(vide);

            // équipe → journée locale → points
            const parEquipe = new Map();
            for (const ligne of lignes.rows) {
                const nomEquipe = equipeDuJoueur.get(ligne.player_name);
                if (!nomEquipe) continue;
                const journee = dates.journeeDe(ligne.game_date);
                if (!journee) continue;

                if (!parEquipe.has(nomEquipe)) parEquipe.set(nomEquipe, new Map());
                const journees = parEquipe.get(nomEquipe);
                journees.set(journee, (journees.get(journee) || 0) + scoring.pointsFeuilleDeMatch(ligne));
            }

            const journees = [];
            const semaines = new Map();
            const mois = new Map();

            for (const [nomEquipe, parJour] of parEquipe) {
                for (const [journee, points] of parJour) {
                    journees.push({ teamName: nomEquipe, date: journee, points: scoring.arrondi(points) });
                    const cleSemaine = `${nomEquipe}|${dates.lundiDe(journee)}`;
                    semaines.set(cleSemaine, (semaines.get(cleSemaine) || 0) + points);
                    const cleMois = `${nomEquipe}|${journee.slice(0, 7)}`;
                    mois.set(cleMois, (mois.get(cleMois) || 0) + points);
                }
            }

            const separer = (totaux, suffixe = '') => [...totaux.entries()].map(([cle, points]) => {
                const coupe = cle.lastIndexOf('|');
                return {
                    teamName: cle.slice(0, coupe),
                    date: cle.slice(coupe + 1) + suffixe,
                    points: scoring.arrondi(points)
                };
            });

            const meilleur = (liste) => liste.length ? liste.reduce((a, b) => (b.points > a.points ? b : a)) : null;
            const pire = (liste) => liste.length ? liste.reduce((a, b) => (b.points < a.points ? b : a)) : null;
            const enrichir = (entree) => !entree ? null : {
                teamName: entree.teamName,
                members: membresDEquipe.get(entree.teamName) || [],
                points: entree.points,
                date: entree.date
            };

            const entreesSemaines = separer(semaines);
            const entreesMois = separer(mois, '-01');

            res.json({
                ...vide,
                bestDay: enrichir(meilleur(journees)),
                worstDay: enrichir(pire(journees)),
                bestWeek: enrichir(meilleur(entreesSemaines)),
                worstWeek: enrichir(pire(entreesSemaines)),
                bestMonth: enrichir(meilleur(entreesMois)),
                worstMonth: enrichir(pire(entreesMois))
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/pool-hall-of-fame');
        }
    });


    // ───────────────────────────── Récapitulatifs ─────────────────────────────

    /**
     * Le récap d'une semaine, ou le plus récent.
     *
     * Lecture seule : le récap est produit après la finalisation, à partir des
     * résultats figés. Le régénérer à la demande ferait dépendre son contenu du
     * moment où on le consulte — un échange de mardi changerait ce que la
     * semaine dernière raconte.
     */
    app.get('/api/pools/:poolName/recap', auth.requireAuth, async (req, res) => {
        try {
            const nomPool = req.params.poolName;
            const enveloppe = await poolMembre(req, res, nomPool);
            if (!enveloppe) return;

            if (!serviceRecap) {
                return res.json({ disponible: false, raison: 'postgres_requis', recap: null });
            }

            const numero = req.query.week ? Number(req.query.week) : null;
            const ligne = await serviceRecap.lire(nomPool, numero);

            if (!ligne) {
                return res.json({
                    disponible: true,
                    recap: null,
                    // Aucun récap n'est pas une panne : c'est l'état normal
                    // avant la première semaine close.
                    raison: 'aucune_semaine_finalisee'
                });
            }

            res.json({
                disponible: true,
                recap: ligne.payload,
                weekNumber: Number(ligne.week_number),
                resultRevision: Number(ligne.result_revision),
                poolMode: ligne.pool_mode,
                generatedAt: ligne.generated_at
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/pools/recap');
        }
    });

    return { FENETRES, poolMembre, equipesActives, repondreErreur };
}

module.exports = { monter, FENETRES };
