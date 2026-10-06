'use strict';

/**
 * Les colonnes 24 h / 7 j / 30 j du classement (/pool-leaderboard) et le
 * temple de la renommée (/pool-hall-of-fame) comptent au barème du POOL :
 * les vrais points pour un cumulatif — les mêmes que son Total —, les points
 * fantasy pour un tête-à-tête, comme avant.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const routesRecords = require('../../routes/records.js');
const { creerServicePointage } = require('../../services/scoring.js');
const dates = require('../../lib/dates.js');

const SAISON = '20262027';
const AUJ = dates.journeeLocale();
const IL_Y_A_3_JOURS = dates.ajouterJours(AUJ, -3);
const IL_Y_A_20_JOURS = dates.ajouterJours(AUJ, -20);

function ligne(jour, gameId, stats, joueur = 'Evan Bouchard', id = 8480803) {
    return {
        player_name: joueur, player_id: id, team_abbrev: 'EDM', position: 'D', season: SAISON,
        game_id: String(gameId), game_date: jour, goals: 0, assists: 0, points: 0, shots: 0, plus_minus: 0,
        power_play_goals: 0, power_play_points: 0, shorthanded_goals: 0, shorthanded_points: 0,
        game_winning_goals: 0, decision: null, saves: 0, goals_against: 0, shutouts: 0, ...stats
    };
}

// Bouchard : 3 buts, 2 aides, 6 tirs, +2 aujourd'hui (5 pts / 17 fantasy),
// 1 but il y a trois jours, 1 aide il y a vingt jours.
const LIGNES = [
    ligne(AUJ, 101, { goals: 3, assists: 2, points: 5, shots: 6, plus_minus: 2 }),
    ligne(IL_Y_A_3_JOURS, 102, { goals: 1, points: 1 }),
    ligne(IL_Y_A_20_JOURS, 103, { assists: 1, points: 1 })
];

function creerDb(lignes) {
    return {
        async query(sql, params) {
            if (sql.includes('COUNT(DISTINCT game_id)')) return { rows: [] };
            if (sql.includes('game_date >= $2')) {
                const [saison, debut, fin, noms] = params;
                return { rows: lignes.filter(l => l.season === saison && l.game_date >= debut && l.game_date < fin && noms.includes(l.player_name)) };
            }
            const [saison, noms] = params;
            return { rows: lignes.filter(l => l.season === saison && noms.includes(l.player_name)) };
        }
    };
}

function pool(poolMode) {
    return {
        poolMode,
        teams: {
            'Les Huiles': { members: ['moi'], offensive: [], defensive: ['Evan Bouchard'], goalie: [], rookie: [], teams: ['Edmonton Oilers'] },
            'Vide': { members: [], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] }
        }
    };
}

function monter(poolMode, { clubs = null, etatDeLaJournee = null, saisonCommencee = () => true } = {}) {
    const routes = new Map();
    const app = { get: (chemin, ...gestionnaires) => routes.set(chemin, gestionnaires.at(-1)) };
    const resultatsClubs = clubs ? async ({ debut, fin }) => ({
        'Edmonton Oilers': {
            points: Object.entries(clubs).filter(([j]) => j >= debut && j < fin).reduce((n, [, p]) => n + p, 0),
            parJour: Object.fromEntries(Object.entries(clubs).filter(([j]) => j >= debut && j < fin))
        }
    }) : null;
    const db = creerDb(LIGNES);
    routesRecords.monter(app, {
        auth: { requireAuth: (req, res, next) => next() },
        store: { lire: async () => ({ data: pool(poolMode) }) },
        db,
        pointage: creerServicePointage({ db, calendrierDuJour: async () => 0, resultatsClubs, apportsEnDirect: async () => [] }),
        saisonCourante: () => SAISON,
        fenetreSaison: async () => ({ regularSeasonStartDate: IL_Y_A_20_JOURS }),
        saisonCommencee,
        resultatsClubs,
        etatDeLaJournee,
        logger: { error() {} }
    });
    const appeler = async (chemin, req) => {
        let corps = null, statut = 200;
        const res = { status(c) { statut = c; return this; }, json(b) { corps = b; return this; } };
        await routes.get(chemin)({ auth: { username: 'moi', isAdmin: true }, ...req }, res);
        return { statut, corps };
    };
    return {
        leaderboard: (days, query = {}) => appeler('/pool-leaderboard/:poolName', { params: { poolName: 'P' }, query: { days: String(days), ...query } }),
        hallOfFame: () => appeler('/pool-hall-of-fame/:poolName', { params: { poolName: 'P' }, query: {} }),
        mesPoints: (req = {}) => appeler('/pool-my-points/:poolName', { params: { poolName: 'P' }, query: {}, ...req })
    };
}

describe('/pool-leaderboard suit le mode du pool', () => {
    test('cumulatif : 24 h = 5 (3 buts + 2 aides), 7 j = 6, 30 j = 7 — pas 17', async () => {
        const r = monter('cumulative', { clubs: {} });
        const points = async d => (await r.leaderboard(d)).corps.teams.find(t => t.teamName === 'Les Huiles').points;
        assert.equal(await points(1), 5);
        assert.equal(await points(7), 6);
        assert.equal(await points(30), 7);
        const { corps } = await r.leaderboard(1);
        assert.equal(corps.mode, 'cumulative');
        assert.equal(corps.teams.length, 1, 'une équipe sans participant n’est pas classée');
    });

    test('cumulatif : le club repêché compte sur la période, comme au Total', async () => {
        const r = monter('cumulative', { clubs: { [IL_Y_A_3_JOURS]: 2, [IL_Y_A_20_JOURS]: 1 } });
        const points = async d => (await r.leaderboard(d)).corps.teams[0].points;
        assert.equal(await points(1), 5);
        assert.equal(await points(7), 6 + 2);
        assert.equal(await points(30), 7 + 3);
    });

    test('ancre=soiree : la semaine finit hier jusqu’au premier match du jour, puis aujourd’hui', async () => {
        const HIER = dates.ajouterJours(AUJ, -1);
        const BASCULE = '2026-10-15T23:00:00Z';
        let journee = { entamee: false, bascule: BASCULE };
        const r = monter('cumulative', { clubs: {}, etatDeLaJournee: async () => journee });

        const avant = (await r.leaderboard(7, { ancre: 'soiree' })).corps;
        assert.equal(avant.teams[0].points, 1, 'les 5 points d’aujourd’hui ne comptent pas encore');
        assert.deepEqual(avant.periode, { debut: dates.ajouterJours(HIER, -6), fin: AUJ, dernierJour: HIER });
        assert.equal(avant.bascule, BASCULE);

        journee = { entamee: true, bascule: null };
        const apres = (await r.leaderboard(7, { ancre: 'soiree' })).corps;
        assert.equal(apres.teams[0].points, 6);
        assert.equal(apres.periode.dernierJour, AUJ);
        assert.equal(apres.bascule, undefined);
    });

    test('ancre=soiree : sans réponse sur la journée, ou sans ancre, la fenêtre finit aujourd’hui', async () => {
        const inconnue = monter('cumulative', { clubs: {}, etatDeLaJournee: async () => null });
        assert.equal((await inconnue.leaderboard(7, { ancre: 'soiree' })).corps.periode.dernierJour, AUJ);
        const enPanne = monter('cumulative', { clubs: {}, etatDeLaJournee: async () => { throw new Error('LNH'); } });
        assert.equal((await enPanne.leaderboard(7, { ancre: 'soiree' })).corps.periode.dernierJour, AUJ);
        const sansAncre = monter('cumulative', { clubs: {}, etatDeLaJournee: async () => ({ entamee: false, bascule: null }) });
        assert.equal((await sansAncre.leaderboard(7)).corps.teams[0].points, 6, 'les colonnes 24 h et 30 j ne bougent pas');
    });

    test('un pool sans mode est cumulatif', async () => {
        const { corps } = await monter(undefined, { clubs: {} }).leaderboard(1);
        assert.equal(corps.teams[0].points, 5);
    });

    test('tête-à-tête : les points fantasy, inchangés', async () => {
        const { corps } = await monter('head-to-head').leaderboard(1);
        assert.equal(corps.mode, 'head-to-head');
        assert.equal(corps.teams[0].points, 17);
    });

    test('une fenêtre inconnue retombe sur 7 jours', async () => {
        const { corps } = await monter('cumulative', { clubs: {} }).leaderboard(5);
        assert.equal(corps.days, 7);
    });
});

describe('/pool-hall-of-fame suit le mode du pool', () => {
    test('cumulatif : la meilleure journée vaut 5 points ; un soir de victoire du club compte', async () => {
        // Journées : aujourd'hui 5 ; il y a 3 jours 1 but + victoire du club (2) = 3 ; il y a 20 jours 1.
        const { corps } = await monter('cumulative', { clubs: { [IL_Y_A_3_JOURS]: 2 } }).hallOfFame();
        assert.equal(corps.bestDay.points, 5);
        assert.equal(corps.bestDay.date, AUJ);
        assert.equal(corps.worstDay.points, 1);
        assert.equal(corps.worstDay.date, IL_Y_A_20_JOURS);
        const sansClub = (await monter('cumulative', { clubs: {} }).hallOfFame()).corps;
        const total = c => [c.bestMonth, c.worstMonth].reduce((n, e) => n + (e ? e.points : 0), 0);
        assert.ok(total(corps) > total(sansClub), 'la victoire du club s’ajoute aux mois');
    });

    test('tête-à-tête : points fantasy, et aucun club', async () => {
        const { corps } = await monter('head-to-head').hallOfFame();
        assert.equal(corps.bestDay.points, 17);
    });
});

describe('/pool-my-points : « Ma position » de l’accueil', () => {
    const HIER = dates.ajouterJours(AUJ, -1);
    const valeurs = corps => Object.fromEntries(Object.entries(corps.periods).map(([j, p]) => [j, p.points]));

    test('soirée entamée : 24 h, 7 j et 30 j de MON équipe, comme les colonnes du classement', async () => {
        const r = monter('cumulative', { clubs: {}, etatDeLaJournee: async () => ({ entamee: true, bascule: null }) });
        const { statut, corps } = await r.mesPoints();
        assert.equal(statut, 200);
        assert.equal(corps.teamName, 'Les Huiles');
        assert.deepEqual(valeurs(corps), { 1: 5, 7: 6, 30: 7 });
        assert.equal(corps.periods[1].dernierJour, AUJ);
        assert.equal(corps.bascule, undefined);
    });

    test('avant le premier match : 24 h et 7 j finissent hier, 30 j aujourd’hui — et la bascule est dite', async () => {
        const BASCULE = '2026-10-15T23:00:00Z';
        const r = monter('cumulative', { clubs: {}, etatDeLaJournee: async () => ({ entamee: false, bascule: BASCULE }) });
        const { corps } = await r.mesPoints();
        assert.deepEqual(valeurs(corps), { 1: 0, 7: 1, 30: 7 });
        assert.equal(corps.periods[1].dernierJour, HIER);
        assert.equal(corps.periods[7].debut, dates.ajouterJours(HIER, -6));
        assert.equal(corps.periods[30].dernierJour, AUJ, '30 j : la colonne du classement, sans ancre');
        assert.equal(corps.bascule, BASCULE);
    });

    test('tête-à-tête : les vrais points, ceux du total affiché au-dessus — pas 17', async () => {
        const r = monter('head-to-head', { clubs: {}, etatDeLaJournee: async () => ({ entamee: true }) });
        const { corps } = await r.mesPoints();
        assert.equal(corps.mode, 'cumulative');
        assert.equal(corps.periods[1].points, 5);
    });

    test('sans équipe à son nom : 404, même pour un administrateur', async () => {
        const { statut } = await monter('cumulative', { clubs: {} }).mesPoints({ auth: { username: 'admin', isAdmin: true } });
        assert.equal(statut, 404);
    });

    test('saison pas commencée : aucune période', async () => {
        const { corps } = await monter('cumulative', { clubs: {}, saisonCommencee: () => false }).mesPoints();
        assert.equal(corps.seasonStarted, false);
        assert.deepEqual(corps.periods, {});
    });
});
