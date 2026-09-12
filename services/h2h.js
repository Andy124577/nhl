/**
 * Tête-à-tête : finaliser une semaine, une fois, et pour de bon.
 *
 * Il y avait deux chemins de finalisation, et ils ne donnaient pas le même
 * résultat. Le manuel remplaçait les feuilles de match manquantes par les
 * totaux de saison — des cumuls depuis octobre opposés à une semaine, donc une
 * comparaison entre deux unités différentes. L'automatique, lui, attendait. La
 * même semaine pouvait donc être close de deux façons selon le bouton pressé.
 *
 * Un seul service ici, appelé par les deux. Et quatre garanties :
 *
 *   1. **Une semaine précise.** La finalisation nomme sa saison et son numéro
 *      de semaine. Un réessai ne peut pas finaliser la suivante par accident.
 *   2. **Des données complètes.** Une semaine dont les feuilles manquent reste
 *      en attente. Il n'existe aucun repli valable : mieux vaut une semaine en
 *      suspens qu'un classement faux.
 *   3. **Une seule fois.** Le résultat est écrit dans la même transaction que
 *      le classement, sous une identité unique `(pool, saison, semaine,
 *      révision)`. Deux travaux de fond concurrents ne peuvent pas inscrire
 *      deux victoires.
 *   4. **Figé.** Le résultat est conservé tel qu'il a été calculé. Un échange
 *      conclu plus tard ne réécrit pas l'histoire — c'est la différence entre
 *      un classement et un recalcul permanent.
 *
 * Une correction officielle de statistiques ne s'ajoute pas : elle crée une
 * RÉVISION. Le classement est corrigé par la différence entre l'ancienne
 * révision et la nouvelle, jamais en additionnant la victoire une seconde fois.
 */

'use strict';

const scoring = require('../lib/scoring.js');
const dates = require('../lib/dates.js');
const evenements = require('../lib/events.js');
const { ensureStandingsEntry, generateWeeklyMatchups } = require('../lib/h2h.js');

/** Résultat d'un duel : qui gagne, ou égalité. Les scores négatifs comptent. */
function issueDuDuel(pointsA, pointsB) {
    if (pointsA > pointsB) return 'team1';
    if (pointsB > pointsA) return 'team2';
    return 'tie';
}

/**
 * Ce qu'une semaine ajoute au classement.
 *
 * Isolé et pur pour une raison précise : c'est exactement ce qu'il faudra
 * RETIRER si une correction officielle produit une nouvelle révision. Sans
 * cette trace, corriger une semaine voudrait dire recalculer toute la saison,
 * ou pire, ajouter la victoire une deuxième fois.
 */
function deltaDeSemaine(resultats) {
    const delta = {};
    const entree = (equipe) => {
        if (!delta[equipe]) delta[equipe] = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
        return delta[equipe];
    };

    for (const duel of resultats) {
        const a = entree(duel.team1);
        const b = entree(duel.team2);

        if (duel.winner === duel.team1) { a.wins++; b.losses++; }
        else if (duel.winner === duel.team2) { b.wins++; a.losses++; }
        else { a.ties++; b.ties++; }

        a.pointsFor += duel.team1Points;
        a.pointsAgainst += duel.team2Points;
        b.pointsFor += duel.team2Points;
        b.pointsAgainst += duel.team1Points;
    }
    return delta;
}

/** Applique un delta au classement, dans un sens ou dans l'autre. */
function appliquerDelta(standings, delta, signe = 1) {
    for (const [equipe, valeurs] of Object.entries(delta || {})) {
        ensureStandingsEntry(standings, equipe);
        const fiche = standings[equipe];
        fiche.wins += signe * valeurs.wins;
        fiche.losses += signe * valeurs.losses;
        fiche.ties += signe * valeurs.ties;
        fiche.pointsFor = scoring.arrondi(fiche.pointsFor + signe * valeurs.pointsFor);
        fiche.pointsAgainst = scoring.arrondi(fiche.pointsAgainst + signe * valeurs.pointsAgainst);
    }
    return standings;
}

function creerServiceH2H({ store, db, pointage, diffusion, saisonCourante, logger = console }) {
    const { ErreurMetier } = store;

    /**
     * La fenêtre d'une semaine, dérivée de la date de départ de la saison.
     *
     * Dérivée et non stockée : `weekStart` avançait par additions successives
     * de sept fois vingt-quatre heures, ce qui décale la frontière d'une heure
     * à chaque changement d'heure. Le départ de saison, lui, ne bouge jamais.
     */
    function fenetreDeSemaine(h2hData, numero) {
        const depart = h2hData && (h2hData.seasonStart || h2hData.weekStart);
        if (!depart) return null;
        return dates.semaineNumero(depart, numero);
    }

    /** Les duels d'une semaine, tirés si le calendrier ne les portait pas. */
    function duelsDeSemaine(poolData, numero) {
        const h2h = poolData.h2hData;
        const existants = (h2h.matchups || [])[numero - 1];
        if (Array.isArray(existants) && existants.length > 0) return existants;

        const equipes = Object.entries(poolData.teams || {})
            .filter(([, td]) => (td.members || []).length > 0)
            .map(([nom, td]) => ({ name: nom, members: td.members }));

        const duels = generateWeeklyMatchups(equipes, h2h.matchups || [])
            .map(d => ({ ...d, weekNumber: numero }));

        if (!Array.isArray(h2h.matchups)) h2h.matchups = [];
        h2h.matchups[numero - 1] = duels;
        return duels;
    }

    /**
     * Calcule une semaine sans rien écrire.
     *
     * Sépare délibérément le calcul de l'écriture : le calcul interroge les
     * feuilles de match, ce qui prend du temps, et on ne tient jamais un verrou
     * de pool ouvert pendant ce temps-là — tout le pool attendrait.
     */
    async function calculerSemaine(poolData, numero, { saison }) {
        const h2h = poolData.h2hData;
        if (!h2h) throw new ErreurMetier(400, "Ce pool n'est pas en mode tête-à-tête.");

        const fenetre = fenetreDeSemaine(h2h, numero);
        if (!fenetre) {
            throw new ErreurMetier(409,
                "La saison de ce pool n'a pas de date de départ : impossible de situer une semaine.");
        }

        const duels = duelsDeSemaine(poolData, numero);
        if (!duels || duels.length === 0) {
            throw new ErreurMetier(409, `Aucun duel au calendrier pour la semaine ${numero}.`);
        }

        const contexte = {
            debut: fenetre.debut, fin: fenetre.fin, saison,
            mode: 'head-to-head',
            baseAlignement: pointage.BASE_ALIGNEMENT.COURANT
        };

        const ingestion = await pointage.etatIngestion(contexte);
        const resultats = [];

        for (const duel of duels) {
            const equipe1 = poolData.teams[duel.team1];
            const equipe2 = poolData.teams[duel.team2];
            const [p1, p2] = await Promise.all([
                pointage.pointsEquipe(equipe1, { ...contexte, ingestion }),
                pointage.pointsEquipe(equipe2, { ...contexte, ingestion })
            ]);

            const pointsA = p1.points == null ? 0 : p1.points;
            const pointsB = p2.points == null ? 0 : p2.points;
            const issue = issueDuDuel(pointsA, pointsB);

            // Les meilleurs pointeurs sont FIGES avec le resultat.
            //
            // C'est ce qui rend « joueur de la semaine » defendable : il est
            // calcule sur l'alignement qui etait en place a la finalisation, et
            // conserve tel quel. Le recalculer plus tard depuis l'alignement du
            // jour ferait gagner la semaine derniere a un joueur acquis mardi.
            const meilleurs = (resultat, equipe) => (resultat.detail?.joueurs || [])
                .filter(j => j.matchs > 0)
                .sort((a, b) => b.fantasyPoints - a.fantasyPoints)
                .slice(0, 3)
                .map(j => ({ name: j.name, team: equipe, fantasyPoints: j.fantasyPoints, matchs: j.matchs }));

            resultats.push({
                team1: duel.team1,
                team2: duel.team2,
                team1Points: scoring.arrondi(pointsA),
                team2Points: scoring.arrondi(pointsB),
                winner: issue === 'tie' ? 'tie' : duel[issue],
                weekNumber: numero,
                club: p1.detail && p1.detail.club,
                team1Top: meilleurs(p1, duel.team1),
                team2Top: meilleurs(p2, duel.team2)
            });
        }

        return { numero, fenetre, resultats, ingestion, contexte };
    }

    /**
     * Finalise une semaine — le seul chemin, manuel comme automatique.
     *
     * `attendu` nomme la semaine que l'appelant croit finaliser. Si le pool a
     * avancé entre-temps, on refuse au lieu de fermer la suivante par accident.
     */
    async function finaliserSemaine(nomPool, { numeroAttendu = null, saison = null, acteur = null } = {}) {
        // Le pointage hebdomadaire lit les feuilles de match, qui vivent dans
        // une table PostgreSQL. En mode fichier, l'operation n'existe pas ; le
        // dire est plus honnete que de finaliser sur des donnees absentes.
        if (!store.estPostgres()) {
            throw new ErreurMetier(503,
                "La finalisation hebdomadaire exige PostgreSQL : les feuilles de match y vivent.",
                { code: 'postgres_requis' });
        }

        const enveloppe = await store.lire(nomPool);
        if (!enveloppe) throw new ErreurMetier(404, "Pool introuvable.");

        const poolData = enveloppe.data;
        if (poolData.poolMode !== 'head-to-head' || !poolData.h2hData) {
            throw new ErreurMetier(400, "Ce pool n'est pas en mode tête-à-tête.");
        }

        const saisonEffective = saison || poolData.h2hData.season || saisonCourante();
        const numero = numeroAttendu != null ? Number(numeroAttendu) : Number(poolData.h2hData.currentWeek);

        if (numeroAttendu != null && Number(numeroAttendu) !== Number(poolData.h2hData.currentWeek)) {
            throw new ErreurMetier(409,
                `Ce pool en est à la semaine ${poolData.h2hData.currentWeek}, pas ${numeroAttendu}.`,
                { semaineCourante: poolData.h2hData.currentWeek });
        }

        const fenetre = fenetreDeSemaine(poolData.h2hData, numero);
        if (!fenetre) throw new ErreurMetier(409, "La saison de ce pool n'a pas de date de départ.");

        // Une semaine ne se ferme pas avant d'être finie. `dernierJour` inclus,
        // borne `fin` exclue : le lundi suivant appartient à la semaine d'après.
        if (!dates.semaineTerminee(fenetre)) {
            throw new ErreurMetier(409,
                `La semaine ${numero} n'est pas terminée (elle court jusqu'au ${fenetre.dernierJour}).`,
                { finLe: fenetre.fin, code: 'semaine_en_cours' });
        }

        // Calcul hors transaction : il interroge les feuilles de match.
        const calcul = await calculerSemaine(poolData, numero, { saison: saisonEffective });

        if (!scoring.finalisable({ completude: calcul.ingestion.completude })) {
            throw new ErreurMetier(503,
                `Semaine ${numero} non finalisée : les feuilles de match sont incomplètes. ` +
                `Elles arrivent par lots ; réessayez plus tard.`,
                {
                    code: 'donnees_incompletes',
                    completude: calcul.ingestion.completude,
                    matchsAttendus: calcul.ingestion.attendus,
                    matchsRecus: calcul.ingestion.recus
                });
        }

        const delta = deltaDeSemaine(calcul.resultats);

        const { valeur } = await store.muterPool(nomPool, {
            scope: 'h2h:finalisation',
            userId: acteur && acteur.userId,
            appliquer: async ({ data, poolId, tx, journal }) => {
                const h2h = data.h2hData;

                // Revérifié sous verrou : un autre travail de fond a pu fermer
                // cette semaine entre le calcul et l'écriture.
                if (Number(h2h.currentWeek) !== numero) {
                    throw new ErreurMetier(409,
                        `La semaine ${numero} a déjà été finalisée.`,
                        { semaineCourante: h2h.currentWeek, code: 'deja_finalisee' });
                }

                const fige = await db.insertFinalizedWeekInTx(tx.client, {
                    poolId,
                    season: saisonEffective,
                    weekNumber: numero,
                    revision: 1,
                    weekStart: calcul.fenetre.debut,
                    weekEnd: calcul.fenetre.fin,
                    scoringVersion: scoring.VERSION_BAREME,
                    rosterBasis: pointage.BASE_ALIGNEMENT.COURANT,
                    results: calcul.resultats,
                    standingsDelta: delta
                });

                // La contrainte d'unicité a refusé : cette semaine est déjà
                // close à cette révision. Deux travaux concurrents ne peuvent
                // donc pas inscrire deux fois la même victoire.
                if (!fige) {
                    throw new ErreurMetier(409,
                        `La semaine ${numero} est déjà finalisée.`, { code: 'deja_finalisee' });
                }

                h2h.standings = h2h.standings || {};
                appliquerDelta(h2h.standings, delta, 1);

                // Le calendrier porte les résultats, pour les écrans qui le
                // lisent directement.
                h2h.matchups[numero - 1] = calcul.resultats;

                h2h.matchupHistory = h2h.matchupHistory || [];
                h2h.matchupHistory.push({
                    weekNumber: numero,
                    season: saisonEffective,
                    revision: 1,
                    weekStart: calcul.fenetre.debut,
                    weekEnd: calcul.fenetre.fin,
                    scoringVersion: scoring.VERSION_BAREME,
                    rosterBasis: pointage.BASE_ALIGNEMENT.COURANT,
                    matchups: calcul.resultats,
                    completedDate: new Date().toISOString()
                });

                h2h.currentWeek = numero + 1;
                h2h.season = saisonEffective;

                const suivante = fenetreDeSemaine(h2h, h2h.currentWeek);
                h2h.weekStart = suivante ? suivante.debutInstant.toISOString() : h2h.weekStart;
                duelsDeSemaine(data, h2h.currentWeek);

                journal.evenement({
                    poolId,
                    type: evenements.ACTIVITE.SEMAINE_FINALISEE,
                    actorUserId: acteur && acteur.userId,
                    subject: {
                        weekNumber: numero, season: saisonEffective, revision: 1,
                        resultats: calcul.resultats.map(r => ({
                            team1: r.team1, team2: r.team2,
                            team1Points: r.team1Points, team2Points: r.team2Points,
                            winner: r.winner
                        }))
                    },
                    dedupKey: evenements.clesActivite.semaineFinalisee(poolId, saisonEffective, numero, 1)
                });

                const membres = new Set();
                for (const equipe of Object.values(data.teams || {})) {
                    for (const membre of (equipe.members || [])) membres.add(membre);
                }
                for (const membre of membres) {
                    journal.notifier({
                        recipient: membre,
                        poolId,
                        type: evenements.NOTIFICATION.NOUVELLE_SEMAINE,
                        subject: { poolName: nomPool, weekNumber: h2h.currentWeek, season: saisonEffective },
                        dedupKey: evenements.clesNotification.nouvelleSemaine(poolId, saisonEffective, h2h.currentWeek)
                    });
                }

                return {
                    valeur: {
                        weekNumber: numero,
                        season: saisonEffective,
                        currentWeek: h2h.currentWeek,
                        results: calcul.resultats,
                        standings: h2h.standings
                    }
                };
            }
        });

        const frais = await store.lire(nomPool);
        if (frais && diffusion) {
            diffusion.poolMisAJour(nomPool, frais.data, frais.revision);
            diffusion.versPool(nomPool, 'h2hWeekFinalized', {
                poolName: nomPool, weekNumber: numero, newWeek: valeur.currentWeek
            });
        }

        logger.log?.(`✅ Semaine ${numero} finalisée pour ${nomPool} (saison ${saisonEffective})`);
        return valeur;
    }

    /**
     * Rattrape les semaines terminées mais jamais closes, avec un travail borné.
     *
     * Borné, parce qu'un redémarrage après une longue absence pourrait sinon
     * essayer de fermer quinze semaines d'un coup, en interrogeant les feuilles
     * de match de chacune, pendant que le site répond aux visiteurs.
     */
    async function rattraper(nomPool, { maxSemaines = 4, saison = null } = {}) {
        const closes = [];
        for (let i = 0; i < maxSemaines; i++) {
            try {
                const resultat = await finaliserSemaine(nomPool, { saison });
                closes.push(resultat.weekNumber);
            } catch (erreur) {
                if (erreur.name === 'ErreurMetier') {
                    // Semaine en cours ou données incomplètes : on s'arrête, ce
                    // n'est pas une panne. Toute autre erreur remonte.
                    if (['semaine_en_cours', 'donnees_incompletes', 'deja_finalisee'].includes(erreur.extra?.code)) break;
                    logger.warn?.(`⏸️ Rattrapage arrêté pour ${nomPool} : ${erreur.message}`);
                    break;
                }
                throw erreur;
            }
        }
        return closes;
    }

    /**
     * Corrige une semaine déjà close, à la suite d'une correction officielle.
     *
     * Le classement est ajusté par la DIFFÉRENCE entre l'ancienne révision et
     * la nouvelle : on retire ce que l'ancienne avait ajouté, puis on ajoute la
     * nouvelle. Additionner simplement donnerait deux victoires pour un seul
     * match gagné.
     */
    async function reviserSemaine(nomPool, numero, { saison = null, acteur = null } = {}) {
        const enveloppe = await store.lire(nomPool);
        if (!enveloppe) throw new ErreurMetier(404, "Pool introuvable.");
        if (!enveloppe.id) throw new ErreurMetier(503, "La révision d'une semaine exige PostgreSQL.");

        const saisonEffective = saison || enveloppe.data.h2hData?.season || saisonCourante();
        const precedent = await db.getFinalizedWeek(null, enveloppe.id, saisonEffective, numero);
        if (!precedent) throw new ErreurMetier(404, `La semaine ${numero} n'a jamais été finalisée.`);

        const calcul = await calculerSemaine(enveloppe.data, numero, { saison: saisonEffective });
        if (!scoring.finalisable({ completude: calcul.ingestion.completude })) {
            throw new ErreurMetier(503, "Les feuilles de match sont encore incomplètes pour cette semaine.",
                { code: 'donnees_incompletes' });
        }

        const ancienDelta = precedent.standings_delta;
        const nouveauDelta = deltaDeSemaine(calcul.resultats);
        const nouvelleRevision = Number(precedent.revision) + 1;

        const { valeur } = await store.muterPool(nomPool, {
            scope: 'h2h:revision',
            userId: acteur && acteur.userId,
            appliquer: async ({ data, poolId, tx, journal }) => {
                const fige = await db.insertFinalizedWeekInTx(tx.client, {
                    poolId,
                    season: saisonEffective,
                    weekNumber: numero,
                    revision: nouvelleRevision,
                    weekStart: calcul.fenetre.debut,
                    weekEnd: calcul.fenetre.fin,
                    scoringVersion: scoring.VERSION_BAREME,
                    rosterBasis: pointage.BASE_ALIGNEMENT.COURANT,
                    results: calcul.resultats,
                    standingsDelta: nouveauDelta
                });
                if (!fige) throw new ErreurMetier(409, "Cette révision existe déjà.");

                await db.supersedeFinalizedWeekInTx(tx.client, poolId, saisonEffective, numero, nouvelleRevision);

                const h2h = data.h2hData;
                h2h.standings = h2h.standings || {};
                appliquerDelta(h2h.standings, ancienDelta, -1);
                appliquerDelta(h2h.standings, nouveauDelta, 1);

                const entree = (h2h.matchupHistory || []).find(s => Number(s.weekNumber) === numero);
                if (entree) {
                    entree.matchups = calcul.resultats;
                    entree.revision = nouvelleRevision;
                    entree.revisedDate = new Date().toISOString();
                }
                if (Array.isArray(h2h.matchups) && h2h.matchups[numero - 1]) {
                    h2h.matchups[numero - 1] = calcul.resultats;
                }

                journal.evenement({
                    poolId,
                    type: evenements.ACTIVITE.SEMAINE_FINALISEE,
                    actorUserId: acteur && acteur.userId,
                    subject: { weekNumber: numero, season: saisonEffective, revision: nouvelleRevision, revise: true },
                    dedupKey: evenements.clesActivite.semaineFinalisee(poolId, saisonEffective, numero, nouvelleRevision)
                });

                return { valeur: { weekNumber: numero, revision: nouvelleRevision, results: calcul.resultats } };
            }
        });

        const frais = await store.lire(nomPool);
        if (frais && diffusion) diffusion.poolMisAJour(nomPool, frais.data, frais.revision);
        return valeur;
    }

    return {
        fenetreDeSemaine,
        duelsDeSemaine,
        calculerSemaine,
        finaliserSemaine,
        rattraper,
        reviserSemaine,
        deltaDeSemaine,
        appliquerDelta,
        issueDuDuel
    };
}

module.exports = { creerServiceH2H, deltaDeSemaine, appliquerDelta, issueDuDuel };
