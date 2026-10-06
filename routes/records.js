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
            saisonCommencee, serviceRecap, resultatsClubs = null, etatDeLaJournee = null,
            logger = console } = ctx;

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

    /** Le mode d'un pool ; un pool sans mode est cumulatif (le défaut). */
    const modeDuPool = (poolData) => (poolData && poolData.poolMode === scoring.MODES.H2H)
        ? scoring.MODES.H2H : scoring.MODES.CUMULATIF;

    // ───────────────────────────── Palmarès glissant ─────────────────────────────

    /** La journée entamée ou non (etatDeLaJournee) ; null si l'on ne sait pas. */
    async function lireJournee() {
        if (!etatDeLaJournee) return null;
        return Promise.resolve().then(etatDeLaJournee).catch(() => null);
    }

    /**
     * La fenêtre semi-ouverte des N derniers jours, `[il y a N-1 jours,
     * demain)`. Avec l'état de la journée (l'ancre « soirée »), elle se ferme
     * à la dernière soirée : hier tant qu'aucun match du jour n'est commencé,
     * et `bascule` dit quand le premier commence.
     */
    function fenetreGlissante(jours, journee = null) {
        const aujourdhui = dates.journeeLocale();
        const avantLesMatchs = Boolean(journee && !journee.entamee);
        const dernierJour = avantLesMatchs ? dates.ajouterJours(aujourdhui, -1) : aujourdhui;
        return {
            debut: dates.ajouterJours(dernierJour, -(jours - 1)),
            fin: dates.ajouterJours(dernierJour, 1),
            dernierJour,
            bascule: avantLesMatchs ? (journee.bascule || null) : null
        };
    }

    /**
     * Les périodes de « Ma position » (accueil). 7 j et 30 j sont les colonnes
     * du classement à l'identique — 7 j avec son ancre. « 24 h » prend l'ancre
     * elle aussi : comptée depuis minuit comme la colonne 24 h, elle
     * afficherait zéro chaque matin, au moment où l'on vient voir sa soirée
     * de la veille.
     */
    const PERIODES_ACCUEIL = [
        { jours: 1, ancre: true },
        { jours: 7, ancre: true },
        { jours: 30, ancre: false }
    ];

    /**
     * Ce que l'équipe de la personne connectée a marqué sur 24 h, 7 jours et
     * 30 jours.
     *
     * Le calcul des colonnes du classement, pour la seule équipe de la
     * personne : l'accueil, la page la plus ouverte, ne relit pas les
     * feuilles de match de tout le pool pour trois nombres. Toujours au
     * barème cumulatif, même en tête-à-tête : ce sont les mêmes points que le
     * total affiché au-dessus d'eux (buildTeamScores, accueil.js), pas des
     * points fantasy à côté de vrais points.
     */
    app.get('/pool-my-points/:poolName', auth.requireAuth, async (req, res) => {
        try {
            const nomPool = req.params.poolName;
            const enveloppe = await poolMembre(req, res, nomPool);
            if (!enveloppe) return;
            const nomEquipe = authz.equipeDe(enveloppe.data, req.auth.username);
            if (!nomEquipe) return res.status(404).json({ message: "Aucune équipe à votre nom dans ce pool." });

            const fenetre = fenetreSaison ? await fenetreSaison() : null;
            if (saisonCommencee && !saisonCommencee(fenetre)) {
                return res.json({ poolName: nomPool, teamName: nomEquipe, seasonStarted: false, periods: {} });
            }

            const journee = await lireJournee();
            const saison = saisonCourante();
            const mode = scoring.MODES.CUMULATIF;
            const teamData = enveloppe.data.teams[nomEquipe];
            let bascule = null;
            const periods = {};
            await Promise.all(PERIODES_ACCUEIL.map(async ({ jours, ancre }) => {
                const periode = fenetreGlissante(jours, ancre ? journee : null);
                if (periode.bascule) bascule = periode.bascule;
                const resultat = await pointage.pointsEquipe(teamData, {
                    debut: periode.debut, fin: periode.fin, saison, mode,
                    baseAlignement: pointage.BASE_ALIGNEMENT.COURANT
                });
                periods[jours] = {
                    points: resultat.points,
                    completude: resultat.completude,
                    debut: periode.debut,
                    dernierJour: periode.dernierJour
                };
            }));

            res.json({
                poolName: nomPool,
                teamName: nomEquipe,
                seasonStarted: true,
                season: saison,
                mode,
                ...(bascule ? { bascule } : {}),
                periods
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/pool-my-points');
        }
    });

    /**
     * La meilleure équipe sur les N derniers jours.
     *
     * La fenêtre est semi-ouverte et se ferme à AUJOURD'HUI inclus : `[il y a
     * N-1 jours, demain)`. Sans cette précision, « 7 derniers jours » désignait
     * parfois six journées, parfois huit, selon l'heure de la requête.
     *
     * `?ancre=soiree` (la tendance du classement) : la fenêtre se ferme à la
     * dernière soirée — HIER tant qu'aucun match du jour n'est commencé —, et
     * `bascule` dit quand le premier commence. Sans quoi la tendance changeait
     * à minuit, sans un match joué. Si l'on ne sait pas, aujourd'hui.
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

            const journee = req.query.ancre === 'soiree' ? await lireJournee() : null;
            const { debut, fin, dernierJour, bascule } = fenetreGlissante(jours, journee);
            const saison = saisonCourante();
            // Le barème du pool : les vrais points (buts + aides, gardiens,
            // clubs) pour un cumulatif — les mêmes que son Total —, les points
            // fantasy pour un tête-à-tête, comme avant.
            const mode = modeDuPool(enveloppe.data);

            const contexte = {
                debut, fin, saison, mode,
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
                periode: { debut, fin, dernierJour },
                ...(bascule ? { bascule } : {}),
                generatedAt: new Date().toISOString(),
                seasonStarted: true,
                season: saison,
                mode,
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

            // Même barème que le classement du pool : une « meilleure
            // journée » en points fantasy à côté d'un Total en buts + aides
            // comparait deux unités.
            const mode = modeDuPool(enveloppe.data);

            // équipe → journée locale → points
            const parEquipe = new Map();
            const crediter = (nomEquipe, journee, points) => {
                if (!parEquipe.has(nomEquipe)) parEquipe.set(nomEquipe, new Map());
                const journees = parEquipe.get(nomEquipe);
                journees.set(journee, (journees.get(journee) || 0) + points);
            };
            for (const ligne of lignes.rows) {
                const nomEquipe = equipeDuJoueur.get(ligne.player_name);
                if (!nomEquipe) continue;
                const journee = dates.journeeDe(ligne.game_date);
                if (!journee) continue;
                crediter(nomEquipe, journee, scoring.pointsFeuilleSelonMode(ligne, mode));
            }

            // Au cumulatif, le club repêché compte ses soirs de victoire,
            // comme au Total.
            if (mode === scoring.MODES.CUMULATIF && resultatsClubs) {
                const clubsDe = new Map();
                for (const [nomEquipe, teamData] of equipesActives(enveloppe.data)) {
                    for (const club of pointage.alignementDe(teamData).clubs) {
                        if (!clubsDe.has(club)) clubsDe.set(club, []);
                        clubsDe.get(club).push(nomEquipe);
                    }
                }
                if (clubsDe.size) {
                    const debutSaison = (fenetre && fenetre.regularSeasonStartDate) || '0000-01-01';
                    const resultats = await resultatsClubs({
                        clubs: [...clubsDe.keys()], saison,
                        debut: debutSaison, fin: dates.ajouterJours(dates.journeeLocale(), 1)
                    }).catch(() => null);
                    for (const [club, equipes] of clubsDe) {
                        const parJour = (resultats && resultats[club] && resultats[club].parJour) || {};
                        for (const [journee, points] of Object.entries(parJour)) {
                            equipes.forEach(nomEquipe => crediter(nomEquipe, journee, points));
                        }
                    }
                }
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

            if (!serviceRecap || serviceRecap.disponible() === false) {
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
