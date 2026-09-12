'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { creerServiceH2H, deltaDeSemaine, appliquerDelta, issueDuDuel } = require('../../services/h2h.js');
const { creerServicePointage } = require('../../services/scoring.js');
const scoring = require('../../lib/scoring.js');
const dates = require('../../lib/dates.js');
const { monterRoutes, creerBaseSimulee } = require('../fixtures/routeHarness.js');
const routesH2H = require('../../routes/h2h.js');

const SAISON = '20262027';

/**
 * Depart de saison calcule par rapport a aujourd'hui : quatre semaines en
 * arriere. Une date fixe rendrait ces tests vrais un mois et faux le suivant —
 * « la semaine 1 est-elle terminee ? » depend de la date du jour.
 */
const DEPART = dates.ajouterJours(dates.lundiDe(dates.journeeLocale()), -28);

// ─────────────────────── Parties pures ───────────────────────

test('une égalité est une égalité, et les scores négatifs comptent', () => {
    assert.equal(issueDuDuel(10, 4), 'team1');
    assert.equal(issueDuDuel(4, 10), 'team2');
    assert.equal(issueDuDuel(7, 7), 'tie');
    assert.equal(issueDuDuel(-3, -8), 'team1', 'moins mauvais reste gagnant');
    assert.equal(issueDuDuel(-5, -5), 'tie');
});

test('le delta d une semaine décrit exactement ce qu elle ajoute au classement', () => {
    const delta = deltaDeSemaine([
        { team1: 'A', team2: 'B', team1Points: 30, team2Points: 20, winner: 'A' },
        { team1: 'C', team2: 'D', team1Points: 15, team2Points: 15, winner: 'tie' }
    ]);

    assert.deepEqual(delta.A, { wins: 1, losses: 0, ties: 0, pointsFor: 30, pointsAgainst: 20 });
    assert.deepEqual(delta.B, { wins: 0, losses: 1, ties: 0, pointsFor: 20, pointsAgainst: 30 });
    assert.deepEqual(delta.C, { wins: 0, losses: 0, ties: 1, pointsFor: 15, pointsAgainst: 15 });
    assert.deepEqual(delta.D, { wins: 0, losses: 0, ties: 1, pointsFor: 15, pointsAgainst: 15 });
});

test('retirer un delta puis en appliquer un autre corrige sans doubler la victoire', () => {
    // C'est tout l'intérêt de garder le delta : une correction officielle ne
    // doit pas ajouter la victoire une seconde fois.
    const classement = {};
    const ancien = deltaDeSemaine([{ team1: 'A', team2: 'B', team1Points: 30, team2Points: 20, winner: 'A' }]);
    appliquerDelta(classement, ancien, 1);
    assert.deepEqual(classement.A, { wins: 1, losses: 0, ties: 0, pointsFor: 30, pointsAgainst: 20 });

    const corrige = deltaDeSemaine([{ team1: 'A', team2: 'B', team1Points: 18, team2Points: 20, winner: 'B' }]);
    appliquerDelta(classement, ancien, -1);
    appliquerDelta(classement, corrige, 1);

    assert.deepEqual(classement.A, { wins: 0, losses: 1, ties: 0, pointsFor: 18, pointsAgainst: 20 });
    assert.deepEqual(classement.B, { wins: 1, losses: 0, ties: 0, pointsFor: 20, pointsAgainst: 18 });
});

// ─────────────────────── Service complet ───────────────────────

function poolH2H(options = {}) {
    return {
        creator: 'alice',
        poolMode: 'head-to-head',
        allowTrades: true,
        createdAt: '2026-09-01T00:00:00.000Z',
        draftOrder: ['Équipe 1', 'Équipe 2'],
        currentPickIndex: 0,
        config: { numOffensive: 1, numDefensive: 0, numGoalies: 0, numRookies: 0, numTeams: 0 },
        teams: {
            'Équipe 1': { members: ['alice'], offensive: ['Attaquant A'], defensive: [], goalie: [], rookie: [], teams: [] },
            'Équipe 2': { members: ['bob'], offensive: ['Attaquant B'], defensive: [], goalie: [], rookie: [], teams: [] }
        },
        h2hData: {
            season: SAISON,
            currentWeek: options.currentWeek || 1,
            seasonStart: options.seasonStart || DEPART,
            weekStart: options.seasonStart || DEPART,
            seasonWeeks: 4,
            matchups: options.matchups || [
                [{ team1: 'Équipe 1', team2: 'Équipe 2', team1Points: 0, team2Points: 0, winner: null, weekNumber: 1 }],
                [{ team1: 'Équipe 2', team2: 'Équipe 1', team1Points: 0, team2Points: 0, winner: null, weekNumber: 2 }]
            ],
            standings: {},
            matchupHistory: []
        }
    };
}

/**
 * Banc complet : base simulée, vrai contrat d'écriture, vrai service de
 * pointage au-dessus de feuilles de match en mémoire, vrai service H2H.
 */
function banc({ feuilles = [], calendrier = async () => 1, pool = poolH2H() } = {}) {
    let pointage = null;
    let serviceH2H = null;

    const h = monterRoutes(routesH2H, {
        pools: { Ligue: pool },
        ctxExtra: (ctx) => {
            // Le service de pointage interroge la base ; on greffe les deux
            // requêtes qu'il émet sur les feuilles fournies par le test.
            const dbOriginal = ctx.db.query.bind(ctx.db);
            ctx.db.query = async (sql, params = []) => {
                if (sql.includes('COUNT(DISTINCT game_id)')) {
                    const [saison, debut, fin] = params;
                    const parJour = new Map();
                    for (const l of feuilles) {
                        if (l.season !== saison || l.game_date < debut || l.game_date >= fin) continue;
                        if (!parJour.has(l.game_date)) parJour.set(l.game_date, new Set());
                        parJour.get(l.game_date).add(l.game_id);
                    }
                    return { rows: [...parJour].map(([game_date, jeux]) => ({ game_date, matchs: jeux.size })) };
                }
                if (sql.includes('FROM player_game_logs')) {
                    const [saison, debut, fin, noms] = params;
                    return {
                        rows: feuilles.filter(l => l.season === saison && l.game_date >= debut &&
                                                   l.game_date < fin && noms.includes(l.player_name))
                    };
                }
                return dbOriginal(sql, params);
            };

            pointage = creerServicePointage({ db: ctx.db, calendrierDuJour: calendrier });
            serviceH2H = creerServiceH2H({
                store: ctx.store, db: ctx.db, pointage, diffusion: ctx.diffusion,
                saisonCourante: () => SAISON,
                logger: { log() {}, warn() {}, error() {} }
            });

            return { pointage, serviceH2H, fenetreSaison: async () => null };
        }
    });

    h.pointage = pointage;
    h.serviceH2H = serviceH2H;
    return h;
}

function feuille(nom, journee, points) {
    return {
        player_name: nom, player_id: 1, team_abbrev: 'MTL', position: 'C',
        season: SAISON, game_id: journee + '-' + nom, game_date: journee,
        goals: points, assists: 0, shots: 0, plus_minus: 0,
        power_play_goals: 0, power_play_points: 0,
        shorthanded_goals: 0, shorthanded_points: 0, game_winning_goals: 0,
        decision: null, saves: 0, goals_against: 0, shutouts: 0
    };
}

/** Semaine 1 de la saison qui part le 5 octobre : du 5 au 11 inclus. */
const S1 = dates.semaineNumero(DEPART, 1);

test('une semaine en cours ne se finalise pas', async () => {
    // La semaine 1 n'est terminée que le 12 octobre ; sans horloge truquée,
    // « aujourd'hui » est bien après, donc on prend une semaine future.
    const futur = dates.lundiDe(dates.journeeLocale());
    const h = banc({ pool: poolH2H({ seasonStart: futur }) });

    await assert.rejects(
        () => h.serviceH2H.finaliserSemaine('Ligue'),
        (erreur) => {
            assert.equal(erreur.extra.code, 'semaine_en_cours');
            return true;
        }
    );
    assert.deepEqual(h.lirePool('Ligue').h2hData.standings, {});
});

test('une semaine dont les feuilles manquent reste en attente, sans repli sur les totaux de saison', async () => {
    const h = banc({ feuilles: [], calendrier: async () => 2 });

    await assert.rejects(
        () => h.serviceH2H.finaliserSemaine('Ligue'),
        (erreur) => {
            assert.equal(erreur.code, 503);
            assert.equal(erreur.extra.code, 'donnees_incompletes');
            return true;
        }
    );
    assert.equal(h.lirePool('Ligue').h2hData.currentWeek, 1, 'la semaine ne doit pas avancer');
    assert.deepEqual(h.lirePool('Ligue').h2hData.matchupHistory, []);
    assert.equal(h.etat.activity.length, 0, 'un refus ne laisse aucun événement');
});

test('une semaine complète se finalise, fige son résultat et avance le classement une fois', async () => {
    const feuilles = [feuille('Attaquant A', S1.debut, 2), feuille('Attaquant B', S1.debut, 1)];
    const calendrier = async (journee) => (journee === S1.debut ? 1 : 0);
    const h = banc({ feuilles, calendrier });

    const resultat = await h.serviceH2H.finaliserSemaine('Ligue');

    assert.equal(resultat.weekNumber, 1);
    assert.equal(resultat.currentWeek, 2);
    assert.equal(resultat.results[0].team1Points, 6);
    assert.equal(resultat.results[0].team2Points, 3);
    assert.equal(resultat.results[0].winner, 'Équipe 1');

    const h2h = h.lirePool('Ligue').h2hData;
    assert.equal(h2h.standings['Équipe 1'].wins, 1);
    assert.equal(h2h.standings['Équipe 2'].losses, 1);
    assert.equal(h2h.matchupHistory.length, 1);
    assert.equal(h2h.matchupHistory[0].scoringVersion, scoring.VERSION_BAREME);
    assert.equal(h2h.matchupHistory[0].rosterBasis, 'current_roster');

    // Le résultat est FIGÉ en base : c'est lui qui fait foi ensuite.
    assert.equal(h.etat.pools.get('Ligue').data.h2hData.currentWeek, 2);
    assert.equal(h.etat.activity.filter(a => a.type === 'h2h_week_finalized').length, 1);
    assert.equal(h.etat.notifications.filter(n => n.type === 'week_new').length, 2);
});

test('finaliser deux fois n inscrit pas deux victoires', async () => {
    const feuilles = [feuille('Attaquant A', S1.debut, 2), feuille('Attaquant B', S1.debut, 1)];
    const calendrier = async (journee) => (journee === S1.debut ? 1 : 0);
    const h = banc({ feuilles, calendrier });

    await h.serviceH2H.finaliserSemaine('Ligue');

    // Deuxième appel : le pool en est maintenant à la semaine 2, et la
    // semaine 1 est close.
    await assert.rejects(
        () => h.serviceH2H.finaliserSemaine('Ligue', { numeroAttendu: 1 }),
        (erreur) => { assert.equal(erreur.code, 409); return true; }
    );

    assert.equal(h.lirePool('Ligue').h2hData.standings['Équipe 1'].wins, 1);
    assert.equal(h.lirePool('Ligue').h2hData.matchupHistory.length, 1);
});

test('finaliser en nommant la mauvaise semaine est refusé plutôt que redirigé', async () => {
    const h = banc();
    await assert.rejects(
        () => h.serviceH2H.finaliserSemaine('Ligue', { numeroAttendu: 5 }),
        (erreur) => {
            assert.equal(erreur.code, 409);
            assert.match(erreur.message, /semaine 1/);
            return true;
        }
    );
});

test('la fenêtre d une semaine se dérive du départ de saison, sans dériver au changement d heure', () => {
    const h = banc();
    const h2h = h.lirePool('Ligue').h2hData;

    for (let numero = 1; numero <= 28; numero++) {
        const fenetre = h.serviceH2H.fenetreDeSemaine(h2h, numero);
        assert.equal(dates.jourDeSemaine(fenetre.debut), 1, `semaine ${numero}`);
        assert.equal(dates.nombreDeJours(fenetre.debut, fenetre.fin), 7, `semaine ${numero}`);
    }
});

test('un pool sans date de départ ne peut pas situer une semaine', async () => {
    const pool = poolH2H();
    pool.h2hData.seasonStart = null;
    pool.h2hData.weekStart = null;
    const h = banc({ pool });

    await assert.rejects(() => h.serviceH2H.finaliserSemaine('Ligue'),
        (erreur) => { assert.equal(erreur.code, 409); return true; });
});

test('le rattrapage est borné et s arrête sur la première semaine incomplète', async () => {
    // Seule la semaine 1 a des feuilles ; la 2 n'en a aucune.
    const feuilles = [feuille('Attaquant A', S1.debut, 2), feuille('Attaquant B', S1.debut, 1)];
    const calendrier = async (journee) => (journee === S1.debut ? 1 : 0);
    const h = banc({ feuilles, calendrier });

    // Le depart est a quatre semaines : les quatre sont echues, et le
    // rattrapage s'arrete sur sa borne, pas sur la fin de la saison.
    const closes = await h.serviceH2H.rattraper('Ligue', { maxSemaines: 2 });
    assert.deepEqual(closes, [1, 2], 'la borne doit tenir');

    const h2h = h.lirePool('Ligue').h2hData;
    assert.equal(h2h.currentWeek, 3);
    assert.equal(h2h.matchupHistory.length, 2);

    // La semaine 1 avait des feuilles, la 2 aucun match au calendrier : les
    // deux se ferment, mais avec des scores differents.
    assert.equal(h2h.matchupHistory[0].matchups[0].team1Points, 6);
    assert.equal(h2h.matchupHistory[1].matchups[0].team1Points, 0);
});

test('une semaine sans match au calendrier se ferme à zéro partout, ce qui est une égalité', async () => {
    const h = banc({ feuilles: [], calendrier: async () => 0 });
    const resultat = await h.serviceH2H.finaliserSemaine('Ligue');

    assert.equal(resultat.results[0].team1Points, 0);
    assert.equal(resultat.results[0].winner, 'tie');
    assert.equal(h.lirePool('Ligue').h2hData.standings['Équipe 1'].ties, 1);
});

test('une révision corrige le classement par la différence, sans doubler', async () => {
    const feuilles = [feuille('Attaquant A', S1.debut, 2), feuille('Attaquant B', S1.debut, 1)];
    const calendrier = async (journee) => (journee === S1.debut ? 1 : 0);
    const h = banc({ feuilles, calendrier });

    await h.serviceH2H.finaliserSemaine('Ligue');
    assert.equal(h.lirePool('Ligue').h2hData.standings['Équipe 1'].wins, 1);
    assert.equal(h.lirePool('Ligue').h2hData.standings['Équipe 2'].wins, 0);

    // Correction officielle : le but de l'attaquant A est retiré, celui de B
    // est doublé. Le duel change de vainqueur.
    feuilles[0].goals = 0;
    feuilles[1].goals = 3;

    const revision = await h.serviceH2H.reviserSemaine('Ligue', 1);
    assert.equal(revision.revision, 2);

    const h2h = h.lirePool('Ligue').h2hData;
    assert.equal(h2h.standings['Équipe 1'].wins, 0);
    assert.equal(h2h.standings['Équipe 1'].losses, 1);
    assert.equal(h2h.standings['Équipe 2'].wins, 1);
    assert.equal(h2h.matchupHistory[0].revision, 2);
    assert.ok(h2h.matchupHistory[0].revisedDate);
});

test('réviser une semaine jamais finalisée est refusé', async () => {
    const h = banc();
    await assert.rejects(() => h.serviceH2H.reviserSemaine('Ligue', 1),
        (erreur) => { assert.equal(erreur.code, 404); return true; });
});

test('un échange après la finalisation ne réécrit pas la semaine close', async () => {
    const feuilles = [feuille('Attaquant A', S1.debut, 2), feuille('Attaquant B', S1.debut, 1)];
    const calendrier = async (journee) => (journee === S1.debut ? 1 : 0);
    const h = banc({ feuilles, calendrier });

    await h.serviceH2H.finaliserSemaine('Ligue');
    const avant = JSON.stringify(h.lirePool('Ligue').h2hData.matchupHistory[0].matchups);

    // Les deux équipes échangent leurs attaquants.
    await h.store.muterPool('Ligue', {
        scope: 'test:echange',
        appliquer: async ({ data }) => {
            data.teams['Équipe 1'].offensive = ['Attaquant B'];
            data.teams['Équipe 2'].offensive = ['Attaquant A'];
            return { valeur: {} };
        }
    });

    const apres = JSON.stringify(h.lirePool('Ligue').h2hData.matchupHistory[0].matchups);
    assert.equal(apres, avant,
        'un résultat inscrit est un résultat inscrit : un échange de mardi ne le réécrit pas');
    assert.equal(h.lirePool('Ligue').h2hData.standings['Équipe 1'].wins, 1);
});

// ─────────────────────── Routes ───────────────────────

const ALICE = { username: 'alice', userId: 'alice', isAdmin: false };
const CARL = { username: 'carl', userId: 'carl', isAdmin: false };

test('un non-membre ne voit pas le duel d un pool', async () => {
    const h = banc();
    const res = await h.appeler('GET', '/h2h/current-week-scores', { auth: CARL, query: { poolName: 'Ligue' } });
    assert.equal(res.statusCode, 403);
});

test('la carte d un duel nomme le meneur, l écart, et l égalité sans trancher au hasard', async () => {
    const feuilles = [feuille('Attaquant A', S1.debut, 2), feuille('Attaquant B', S1.debut, 2)];
    const h = banc({ feuilles, calendrier: async (j) => (j === S1.debut ? 1 : 0) });

    const res = await h.appeler('GET', '/h2h/current-week-scores', { auth: ALICE, query: { poolName: 'Ligue' } });
    assert.equal(res.statusCode, 200);

    const carte = res.body.matchups[0];
    assert.equal(carte.team1Points, 6);
    assert.equal(carte.team2Points, 6);
    assert.equal(carte.egalite, true);
    assert.equal(carte.meneur, null, 'un meneur choisi par l ordre du tableau serait une invention');
    assert.equal(carte.ecart, 0);
    assert.deepEqual(carte.team1Info.members, ['alice'],
        'une équipe est une équipe : son adversaire n est pas « un nom d utilisateur »');
    assert.equal(carte.club.inclus, false);
});

test('la semaine en cours est annoncée comme provisoire et dit jusqu où elle est pointée', async () => {
    const futur = dates.lundiDe(dates.journeeLocale());
    const h = banc({ pool: poolH2H({ seasonStart: futur }), calendrier: async () => 0 });

    const res = await h.appeler('GET', '/h2h/current-week-scores', { auth: ALICE, query: { poolName: 'Ligue' } });
    assert.equal(res.body.weekStatus, 'ongoing');
    assert.equal(res.body.provisoire, true);
    assert.equal(res.body.scoredThrough, dates.ajouterJours(dates.journeeLocale(), 1),
        'la borne exclusive est demain : aujourd hui compte');
    assert.equal(res.body.scoringVersion, scoring.VERSION_BAREME);
});

test('une semaine échue mais non pointée est « en attente de finalisation », pas « terminée »', async () => {
    const h = banc({ calendrier: async () => 0 });
    const res = await h.appeler('GET', '/h2h/season-schedule', { auth: ALICE, query: { poolName: 'Ligue' } });

    assert.equal(res.statusCode, 200);
    const semaine1 = res.body.weeks.find(s => s.weekNumber === 1);
    assert.equal(semaine1.status, 'pending_finalization',
        'annoncer « terminée » une semaine sans résultat afficherait un score final qui n existe pas');
});

test('le centre des duels sert une semaine close depuis son résultat figé', async () => {
    const feuilles = [feuille('Attaquant A', S1.debut, 2), feuille('Attaquant B', S1.debut, 1)];
    const h = banc({ feuilles, calendrier: async (j) => (j === S1.debut ? 1 : 0) });
    await h.serviceH2H.finaliserSemaine('Ligue');

    const res = await h.appeler('GET', '/h2h/matchup', { auth: ALICE, query: { poolName: 'Ligue', week: '1' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.fige, true);
    assert.equal(res.body.weekStatus, 'completed');
    assert.equal(res.body.revision, 1);
    assert.equal(res.body.matchups[0].team1Points, 6);
    assert.equal(res.body.monEquipe, 'Équipe 1');
});

test('seule la personne qui a créé le pool finalise une semaine', async () => {
    const h = banc({ calendrier: async () => 0 });
    const bob = { username: 'bob', userId: 'bob', isAdmin: false };
    const res = await h.appeler('POST', '/h2h/finalize-week', { auth: bob, body: { poolName: 'Ligue' } });
    assert.equal(res.statusCode, 403);
});

test('un pool cumulatif n’entre jamais dans la finalisation tête-à-tête', async () => {
    const cumulatif = poolH2H();
    cumulatif.poolMode = 'cumulative';
    delete cumulatif.h2hData;
    const h = banc({ pool: cumulatif });

    await assert.rejects(
        () => h.serviceH2H.finaliserSemaine('Ligue'),
        (erreur) => {
            assert.equal(erreur.code, 400);
            assert.match(erreur.message, /tête-à-tête/);
            return true;
        }
    );

    // Et le rattrapage ne l'essaie même pas.
    const closes = await h.serviceH2H.rattraper('Ligue', { maxSemaines: 4 });
    assert.deepEqual(closes, []);
});

test('la somme des contributions par joueur égale le total du duel', async () => {
    const feuilles = [
        feuille('Attaquant A', S1.debut, 2),
        feuille('Attaquant A', dates.ajouterJours(S1.debut, 1), 1),
        feuille('Attaquant B', S1.debut, 3)
    ];
    const h = banc({ feuilles, calendrier: async (j) => (j <= dates.ajouterJours(S1.debut, 1) && j >= S1.debut ? 1 : 0) });

    const res = await h.appeler('GET', '/h2h/matchup', {
        auth: { username: 'alice', userId: 'alice', isAdmin: false },
        query: { poolName: 'Ligue', week: '1' }
    });
    assert.equal(res.statusCode, 200);

    const carte = res.body.matchups[0];
    const sommeUn = carte.team1Players.reduce((s, j) => s + j.fantasyPoints, 0);
    const sommeDeux = carte.team2Players.reduce((s, j) => s + j.fantasyPoints, 0);

    assert.equal(scoring.arrondi(sommeUn), carte.team1Points,
        'le détail doit se réconcilier avec le total affiché');
    assert.equal(scoring.arrondi(sommeDeux), carte.team2Points);

    // Le club est nommé explicitement : sa contribution vaut zéro et le dit.
    assert.equal(carte.club.inclus, false);
    assert.equal(carte.club.points, 0);
});

test('les scores figés survivent à un renommage d’équipe', async () => {
    const feuilles = [feuille('Attaquant A', S1.debut, 2), feuille('Attaquant B', S1.debut, 1)];
    const h = banc({ feuilles, calendrier: async (j) => (j === S1.debut ? 1 : 0) });
    await h.serviceH2H.finaliserSemaine('Ligue');

    const avantPoints = h.lirePool('Ligue').h2hData.matchupHistory[0].matchups[0].team1Points;

    const poolOps = require('../../lib/poolOps.js');
    await h.store.muterPool('Ligue', {
        scope: 'test:renommage',
        appliquer: async ({ data }) => {
            const r = poolOps.renommerEquipe(data, {
                ancien: 'Équipe 1', nouveau: 'Les Fusées', username: 'alice'
            });
            assert.equal(r.ok, true);
            return { valeur: {} };
        }
    });

    const apres = h.lirePool('Ligue').h2hData.matchupHistory[0].matchups[0];
    assert.equal(apres.team1Points, avantPoints, 'le pointage inscrit ne change pas');
    assert.equal(apres.team1, 'Les Fusées', 'mais le nom suit, sinon l’équipe disparaît de son propre passé');
    assert.ok(h.lirePool('Ligue').h2hData.standings['Les Fusées']);
});
