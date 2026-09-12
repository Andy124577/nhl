'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { creerServiceAujourdhui } = require('../../services/today.js');
const { creerServiceH2H } = require('../../services/h2h.js');
const { creerServicePointage } = require('../../services/scoring.js');
const priorite = require('../../lib/priority.js');
const dates = require('../../lib/dates.js');
const { monterRoutes, poolNeuf } = require('../fixtures/routeHarness.js');
const routesAujourdhui = require('../../routes/today.js');

const SAISON = '20262027';
const DEPART = dates.ajouterJours(dates.lundiDe(dates.journeeLocale()), -7);

/** Depart place cette semaine : la semaine 1 est alors la semaine EN COURS. */
const DEPART_COURANT = dates.lundiDe(dates.journeeLocale());

function poolEnRepechage({ tourA = 'Équipe 1' } = {}) {
    return {
        creator: 'alice',
        poolMode: 'cumulative',
        createdAt: '2026-09-01T00:00:00.000Z',
        draftOrder: [tourA, 'Équipe 2', 'Équipe 2', 'Équipe 1'],
        currentPickIndex: 0,
        lastPickIndex: -1,
        turnStartedAt: Date.now() - 60000,
        config: { numOffensive: 2, numDefensive: 0, numGoalies: 0, numRookies: 0, numTeams: 0 },
        teams: {
            'Équipe 1': { members: ['alice'], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] },
            'Équipe 2': { members: ['bob'], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] }
        }
    };
}

function poolDuel({ depart = DEPART } = {}) {
    return {
        creator: 'alice',
        poolMode: 'head-to-head',
        createdAt: '2026-09-01T00:00:00.000Z',
        draftOrder: ['Équipe 1', 'Équipe 2'],
        currentPickIndex: 0,
        config: { numOffensive: 1, numDefensive: 0, numGoalies: 0, numRookies: 0, numTeams: 0 },
        teams: {
            'Équipe 1': { members: ['alice'], offensive: ['Attaquant A'], defensive: [], goalie: [], rookie: [], teams: [] },
            'Équipe 2': { members: ['bob'], offensive: ['Attaquant B'], defensive: [], goalie: [], rookie: [], teams: [] }
        },
        h2hData: {
            season: SAISON, currentWeek: 1,
            seasonStart: depart, weekStart: depart, seasonWeeks: 4,
            matchups: [[{ team1: 'Équipe 1', team2: 'Équipe 2', team1Points: 0, team2Points: 0, winner: null, weekNumber: 1 }]],
            standings: {}, matchupHistory: []
        }
    };
}

function banc({ pools = {}, feuilles = [], calendrier = async () => 1, presence = null } = {}) {
    let aujourdhui = null;

    const h = monterRoutes(routesAujourdhui, {
        pools,
        ctxExtra: (ctx) => {
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

            const pointage = creerServicePointage({ db: ctx.db, calendrierDuJour: calendrier });
            const serviceH2H = creerServiceH2H({
                store: ctx.store, db: ctx.db, pointage, diffusion: ctx.diffusion,
                saisonCourante: () => SAISON, logger: { log() {}, warn() {}, error() {} }
            });
            aujourdhui = creerServiceAujourdhui({
                store: ctx.store, db: ctx.db, usePostgres: true, pointage, serviceH2H,
                saisonCourante: () => SAISON,
                calendrierLNH: { matchsTermines: async () => 5 },
                logger: { log() {}, warn() {}, error() {} }
            });
            return { pointage, serviceH2H, aujourdhui, presence };
        }
    });

    h.aujourdhui = aujourdhui;
    return h;
}

const ALICE = { username: 'alice', userId: 'alice', isAdmin: false };

test('le tour de repêchage est la vedette, sans échéance inventée', async () => {
    const h = banc({ pools: { Ligue: poolEnRepechage() } });
    const charge = await h.aujourdhui.pour('alice');

    assert.equal(charge.vedette.urgence, priorite.URGENCE.VOTRE_TOUR);
    assert.match(charge.vedette.titre, /votre tour/i);
    assert.equal(charge.vedette.echeance, null,
        'Fantazy ne chronomètre personne : un tour n a pas d échéance');
    assert.equal(charge.vedette.pool, 'Ligue');
});

test('le tour de quelqu un d autre devient un repêchage à suivre, moins urgent', async () => {
    const h = banc({ pools: { Ligue: poolEnRepechage({ tourA: 'Équipe 2' }) } });
    const charge = await h.aujourdhui.pour('alice');

    assert.equal(charge.vedette.urgence, priorite.URGENCE.REPECHAGE);
    assert.equal(charge.vedette.donnees.equipeDuTour, 'Équipe 2');
});

test('un tour dans un autre pool reste visible depuis le pool actif', async () => {
    const h = banc({
        pools: {
            Actif: poolDuel(),
            Autre: poolEnRepechage()
        }
    });
    const charge = await h.aujourdhui.pour('alice', { poolActif: 'Actif' });

    assert.equal(charge.vedette.pool, 'Autre',
        'un tour ailleurs est plus urgent que le duel du pool affiché');
    assert.equal(charge.vedette.urgence, priorite.URGENCE.VOTRE_TOUR);
});

test('une offre en attente passe devant le duel de la semaine', async () => {
    const h = banc({ pools: { Ligue: poolDuel() } });
    h.etat.notifications.push({
        id: 1, recipientUserId: 'alice', type: 'trade_received',
        poolId: 1, subject: { tradeId: 42, poolName: 'Ligue', fromTeam: 'Équipe 2' },
        occurredAt: new Date(), readAt: null, resolvedAt: null, expiresAt: null
    });

    const charge = await h.aujourdhui.pour('alice');
    assert.equal(charge.vedette.urgence, priorite.URGENCE.ECHANGE);
    assert.equal(charge.vedette.donnees.tradeId, 42);
    assert.match(charge.vedette.href, /trade\.html/);
});

test('une offre déjà résolue ne réclame plus rien', async () => {
    const h = banc({ pools: { Ligue: poolDuel() } });
    h.etat.notifications.push({
        id: 1, recipientUserId: 'alice', type: 'trade_received',
        poolId: 1, subject: { tradeId: 42, poolName: 'Ligue' },
        occurredAt: new Date(), readAt: null, resolvedAt: new Date(), expiresAt: null
    });

    const charge = await h.aujourdhui.pour('alice');
    assert.notEqual(charge.vedette.urgence, priorite.URGENCE.ECHANGE);
});

test('lire une offre ne la retire pas de la liste des choses à faire', async () => {
    const h = banc({ pools: { Ligue: poolDuel() } });
    h.etat.notifications.push({
        id: 1, recipientUserId: 'alice', type: 'trade_received',
        poolId: 1, subject: { tradeId: 42, poolName: 'Ligue' },
        // Lue, mais pas résolue : la réponse est toujours attendue.
        occurredAt: new Date(), readAt: new Date(), resolvedAt: null, expiresAt: null
    });

    const charge = await h.aujourdhui.pour('alice');
    assert.equal(charge.vedette.urgence, priorite.URGENCE.ECHANGE,
        'la lecture est un geste, la résolution est un fait : les deux sont distincts');
});

test('le duel de la semaine porte son adversaire et sa fin de semaine', async () => {
    const h = banc({ pools: { Ligue: poolDuel() }, calendrier: async () => 0 });
    const charge = await h.aujourdhui.pour('alice');

    const duel = [charge.vedette, ...charge.secondaires].find(e => e.urgence === priorite.URGENCE.DUEL);
    assert.ok(duel);
    assert.equal(duel.donnees.adversaire, 'Équipe 2');
    assert.equal(duel.donnees.monEquipe, 'Équipe 1');
    assert.ok(Number.isFinite(duel.echeance), 'la fin de semaine est une vraie échéance');
});

test('un duel qui bouge est annoncé comme provisoire', async () => {
    const journee = dates.journeeLocale();
    const feuilles = [{
        player_name: 'Attaquant A', player_id: 1, team_abbrev: 'MTL', position: 'C',
        season: SAISON, game_id: 'g1', game_date: journee,
        goals: 2, assists: 0, shots: 0, plus_minus: 0,
        power_play_goals: 0, power_play_points: 0, shorthanded_goals: 0,
        shorthanded_points: 0, game_winning_goals: 0,
        decision: null, saves: 0, goals_against: 0, shutouts: 0
    }];
    const h = banc({
        pools: { Ligue: poolDuel({ depart: DEPART_COURANT }) },
        feuilles, calendrier: async () => 1
    });

    const charge = await h.aujourdhui.pour('alice');
    const duel = [charge.vedette, ...charge.secondaires].find(e => e.urgence === priorite.URGENCE.DUEL);
    assert.equal(duel.donnees.scores.moi, 6);
    assert.equal(duel.donnees.scores.provisoire, true);
    assert.match(duel.detail, /provisoire/);
});

test('sans pool, l accueil propose les portes d entrée plutôt qu un vide', async () => {
    const h = banc({ pools: {} });
    const charge = await h.aujourdhui.pour('alice');

    assert.equal(charge.vedette, null);
    assert.equal(charge.vide.cas, 'aucun_pool');
    assert.ok(charge.vide.actions.length >= 2);
});

test('une section en panne ne vide pas les autres', async () => {
    const h = banc({ pools: { Ligue: poolEnRepechage() } });
    h.db.getNotificationsForUser = async () => { throw new Error('base indisponible'); };

    const charge = await h.aujourdhui.pour('alice');
    assert.equal(charge.vedette.urgence, priorite.URGENCE.VOTRE_TOUR, 'le tour reste affiché');
    assert.equal(charge.sources.notifications.etat, 'indisponible');
    assert.equal(charge.sources.pools.etat, 'ok');
});

test('la réponse reste bornée : une vedette et au plus trois lignes', async () => {
    const pools = {};
    for (let i = 1; i <= 6; i++) pools['Pool ' + i] = poolEnRepechage({ tourA: 'Équipe 2' });
    const h = banc({ pools });

    const charge = await h.aujourdhui.pour('alice');
    assert.ok(charge.vedette);
    assert.ok(charge.secondaires.length <= 3);
    assert.ok(charge.total >= 6);
});

test('la réponse ne porte ni alignement complet ni historique', async () => {
    const h = banc({ pools: { Ligue: poolDuel() }, calendrier: async () => 0 });
    const charge = await h.aujourdhui.pour('alice');

    const texte = JSON.stringify(charge);
    assert.ok(!texte.includes('matchupHistory'), "l'historique a sa propre route");
    assert.ok(!texte.includes('picksHistory'));
    assert.ok(charge.pools.every(p => !p.teams), 'les alignements ne voyagent pas ici');
});

test('le cache est par compte, jamais partagé', async () => {
    const h = banc({ pools: { Ligue: poolEnRepechage() } });

    const pourAlice = await h.aujourdhui.pourAvecCache('alice');
    const pourBob = await h.aujourdhui.pourAvecCache('bob');

    assert.equal(pourAlice.vedette.urgence, priorite.URGENCE.VOTRE_TOUR);
    assert.notEqual(pourBob.vedette && pourBob.vedette.urgence, priorite.URGENCE.VOTRE_TOUR);

    const encore = await h.aujourdhui.pourAvecCache('alice');
    assert.equal(encore.cache, true);
});

test('la route exige une session et répond à la personne connectée', async () => {
    const h = banc({ pools: { Ligue: poolEnRepechage() } });

    assert.equal((await h.appeler('GET', '/api/me/today', { auth: null })).statusCode, 401);

    const res = await h.appeler('GET', '/api/me/today', { auth: ALICE });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.vedette.pool, 'Ligue');
    assert.ok(res.body.generatedAt);
    assert.ok(res.body.asOf);
});

test('le client peut annoncer sa vedette pour qu elle ne se dérobe pas', async () => {
    const h = banc({ pools: { A: poolEnRepechage({ tourA: 'Équipe 2' }), B: poolEnRepechage({ tourA: 'Équipe 2' }) } });

    const libre = await h.appeler('GET', '/api/me/today', { auth: ALICE });
    const autre = libre.body.secondaires[0].id;

    const fige = await h.appeler('GET', '/api/me/today', { auth: ALICE, query: { current: autre } });
    assert.equal(fige.body.vedette.id, autre);
});
