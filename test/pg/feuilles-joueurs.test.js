/**
 * Feuilles de match contre un vrai PostgreSQL : un match inchangé n'est pas
 * réécrit, une correction l'est, et le compteur d'écritures de db.js ne bouge
 * que dans le second cas.
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

// Un identifiant de joueur qu'aucun vrai joueur ne porte.
const JOUEUR = 999000001;
const MAJ = ['goals', 'assists', 'points', 'shots', 'saves', 'save_pct', 'game_date'];

function ligne(gameId, { buts = 1, savePct = null } = {}) {
    const v = {
        player_id: JOUEUR, player_name: 'ZZTest Joueur', position: 'C', season: '20252026',
        game_id: gameId, game_date: '2025-10-08', home_road_flag: 'H', opponent_abbrev: 'MTL',
        team_abbrev: 'TOR', game_result: 'W', goals: buts, assists: 0, points: buts,
        plus_minus: 0, pim: 0, shots: 3, power_play_goals: 0, power_play_points: 0,
        shorthanded_goals: 0, shorthanded_points: 0, game_winning_goals: 0, toi: '18:02',
        games_started: 0, decision: null, shots_against: 0, goals_against: 0, saves: 0,
        save_pct: savePct, shutouts: 0
    };
    return COLONNES.map(c => v[c]);
}

describe('feuilles de match PostgreSQL', { skip: RAISON || false }, () => {
    let db;
    const executer = (texte, valeurs) => db.query(texte, valeurs);

    before(async () => {
        process.env.DATABASE_URL = URL_TEST;
        delete require.cache[require.resolve('../../db.js')];
        db = require('../../db.js');
        await db.runMigrations({ dossier: path.join(__dirname, '../../migrations'), silencieux: true });
        await db.query('DELETE FROM player_game_logs WHERE player_id = $1', [JOUEUR]);
    });

    after(async () => {
        try { await db.query('DELETE FROM player_game_logs WHERE player_id = $1', [JOUEUR]); }
        finally { await db.pool.end(); }
    });

    test('nouveaux matchs écrits en une requête, puis rien quand rien ne change', async () => {
        assert.equal(await enregistrerFeuilles(executer, [ligne(1), ligne(2)], MAJ), 2);

        const avant = db.generationDonnees();
        assert.equal(await enregistrerFeuilles(executer, [ligne(1), ligne(2)], MAJ), 0);
        assert.equal(db.generationDonnees(), avant, 'rien changé : la mémoire des lectures reste');
    });

    test('une correction est enregistrée, et seulement elle', async () => {
        const vu = await db.query('SELECT last_updated FROM player_game_logs WHERE player_id = $1 AND game_id = 2', [JOUEUR]);
        const avant = db.generationDonnees();

        assert.equal(await enregistrerFeuilles(executer, [ligne(1, { buts: 2 }), ligne(2)], MAJ), 1);
        assert.ok(db.generationDonnees() > avant, 'une vraie écriture compte');

        const r = await db.query('SELECT game_id, goals, last_updated FROM player_game_logs WHERE player_id = $1 ORDER BY game_id', [JOUEUR]);
        assert.equal(r.rows[0].goals, 2);
        assert.deepEqual(r.rows[1].last_updated, vu.rows[0].last_updated, 'le match inchangé n’est pas réécrit');
    });

    test('un arrondi de colonne (save_pct DECIMAL(5,3)) ne passe pas pour un changement', async () => {
        assert.equal(await enregistrerFeuilles(executer, [ligne(3, { savePct: 0.9117647 })], MAJ), 1);
        assert.equal(await enregistrerFeuilles(executer, [ligne(3, { savePct: 0.9117647 })], MAJ), 0);
    });

    test('un match en double dans le même lot ne fait pas échouer la requête', async () => {
        assert.equal(await enregistrerFeuilles(executer, [ligne(4), ligne(4, { buts: 3 })], MAJ), 1);
        const r = await db.query('SELECT goals FROM player_game_logs WHERE player_id = $1 AND game_id = 4', [JOUEUR]);
        assert.equal(r.rows[0].goals, 3);
    });
});
