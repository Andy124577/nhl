/**
 * Une colonne DATE se lit comme la journée écrite, quel que soit le fuseau
 * du serveur.
 *
 * pg transformait `game_date` en Date à minuit dans le fuseau du serveur
 * (UTC sur Render). Relue dans l'Est, cette minuit tombait la VEILLE : les
 * matchs du lundi glissaient au dimanche précédent, hors de leur semaine. Le
 * contrôle de complétude d'une semaine tête-à-tête comptait donc toujours un
 * lundi vide, et toute semaine commençant par un lundi de matchs restait « en
 * attente » pour toujours.
 *
 * ┌─ Pour les exécuter ──────────────────────────────────────────────────────┐
 * │ TEST_DATABASE_URL=postgres://…/fantazy_test npm run test:pg              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const URL_TEST = process.env.TEST_DATABASE_URL;
const RAISON = !URL_TEST
    ? 'TEST_DATABASE_URL absent : ces tests écrivent, ils exigent une base jetable'
    : (URL_TEST === process.env.DATABASE_URL
        ? 'TEST_DATABASE_URL est identique à DATABASE_URL : refus d’écrire dans la base applicative'
        : null);

const { COLONNES, enregistrerFeuilles } = require('../../lib/feuillesJoueurs.js');
const { creerServicePointage } = require('../../services/scoring.js');
const scoring = require('../../lib/scoring.js');

const JOUEUR = 999000101;
const SAISON = '20992100';

function ligne(gameId, jour) {
    const v = {
        player_id: JOUEUR, player_name: 'ZZTest Lundi', position: 'C', season: SAISON,
        game_id: gameId, game_date: jour, home_road_flag: 'H', opponent_abbrev: 'MTL',
        team_abbrev: 'TOR', game_result: 'W', goals: 1, assists: 0, points: 1,
        plus_minus: 0, pim: 0, shots: 3, power_play_goals: 0, power_play_points: 0,
        shorthanded_goals: 0, shorthanded_points: 0, game_winning_goals: 0, toi: '18:02',
        games_started: 0, decision: null, shots_against: 0, goals_against: 0, saves: 0,
        save_pct: null, shutouts: 0
    };
    return COLONNES.map(c => v[c]);
}

describe('journées des feuilles de match', { skip: RAISON || false }, () => {
    let db;

    before(async () => {
        process.env.DATABASE_URL = URL_TEST;
        delete require.cache[require.resolve('../../db.js')];
        db = require('../../db.js');
        await db.runMigrations({ dossier: path.join(__dirname, '../../migrations'), silencieux: true });
        await db.query('DELETE FROM player_game_logs WHERE player_id = $1', [JOUEUR]);
        // Un match le lundi qui ouvre la semaine, un autre le dimanche qui la ferme.
        await enregistrerFeuilles((t, v) => db.query(t, v),
            [ligne(2099020001, '2099-10-05'), ligne(2099020002, '2099-10-11')], ['goals']);
    });

    after(async () => {
        try { await db.query('DELETE FROM player_game_logs WHERE player_id = $1', [JOUEUR]); }
        finally { await db.pool.end(); }
    });

    test('une DATE revient telle qu’écrite, sans fuseau', async () => {
        const { rows } = await db.query(
            'SELECT game_date FROM player_game_logs WHERE player_id = $1 ORDER BY game_date', [JOUEUR]);
        assert.deepEqual(rows.map(r => r.game_date), ['2099-10-05', '2099-10-11']);
    });

    test('une semaine dont le lundi a des matchs est complète une fois tout reçu', async () => {
        const calendrier = { '2099-10-05': 1, '2099-10-11': 1 };
        const pointage = creerServicePointage({
            db, calendrierDuJour: async (jour) => calendrier[jour] || 0, logger: { error() {} }
        });
        const etat = await pointage.etatIngestion({ debut: '2099-10-05', fin: '2099-10-12', saison: SAISON });
        assert.equal(etat.attendus, 2);
        assert.equal(etat.recus, 2);
        assert.equal(etat.completude, scoring.COMPLETUDE.DISPONIBLE);
        assert.ok(scoring.finalisable(etat));
        const lundi = etat.journees.find(j => j.journee === '2099-10-05');
        assert.deepEqual(lundi, { journee: '2099-10-05', prevus: 1, recus: 1 });
    });
});
