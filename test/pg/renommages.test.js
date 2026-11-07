/**
 * Renommer une équipe ou un pool, contre un vrai PostgreSQL : les copies du
 * nom gardées hors du pool suivent (db.renameTeamInTx, db.renamePool).
 *
 *   TEST_DATABASE_URL=postgres://…/fantazy_test npm run test:pg
 */

'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const URL_TEST = process.env.TEST_DATABASE_URL;
const RAISON = !URL_TEST
    ? 'TEST_DATABASE_URL absent : ces tests écrivent, ils exigent une base jetable'
    : (URL_TEST === process.env.DATABASE_URL ? 'TEST_DATABASE_URL identique à DATABASE_URL' : null);

describe('renommages PostgreSQL', { skip: RAISON || false }, () => {
    let db;
    let pool;
    const NOM = 'ZZTestRenommage';

    async function nettoyer() {
        for (const nom of [NOM, NOM + ' 2']) {
            await pool.query('DELETE FROM trades WHERE pool_name = $1', [nom]);
            await pool.query('DELETE FROM trade_listings WHERE pool_name = $1', [nom]);
            await pool.query('DELETE FROM pool_rank_snapshots WHERE pool_name = $1', [nom]);
            await pool.query('DELETE FROM pools WHERE pool_name = $1', [nom]);
        }
        await pool.query("DELETE FROM users WHERE username = 'zztest_renom'");
    }

    before(async () => {
        process.env.DATABASE_URL = URL_TEST;
        delete require.cache[require.resolve('../../db.js')];
        db = require('../../db.js');
        pool = db.pool;
        await db.runMigrations({ dossier: path.join(__dirname, '../../migrations'), silencieux: true });
        await nettoyer();
    });

    after(async () => {
        try { await nettoyer(); } finally { if (pool) await pool.end(); }
    });

    test('renameTeamInTx : échanges, annonces, relevés, notifications, bilans', async () => {
        const poolId = (await pool.query(
            'INSERT INTO pools (pool_name, pool_data) VALUES ($1, $2) RETURNING id',
            [NOM, JSON.stringify({ teams: {} })])).rows[0].id;
        const userId = (await pool.query(
            "INSERT INTO users (username, password) VALUES ('zztest_renom', 'x') RETURNING id")).rows[0].id;

        await pool.query("INSERT INTO trades (pool_name, trade_data, status) VALUES ($1, $2, 'pending')",
            [NOM, JSON.stringify({ draftName: NOM, fromTeam: 'Rouges', toTeam: 'Les Bleus', offering: [], receiving: [] })]);
        await pool.query("INSERT INTO trades (pool_name, trade_data, status) VALUES ($1, $2, 'pending')",
            [NOM, JSON.stringify({ draftName: NOM, fromTeam: 'Rouges', toTeam: 'Verts' })]);
        await pool.query(
            "INSERT INTO trade_listings (pool_name, team_name, player_name, category, listed_by) VALUES ($1, 'Les Bleus', 'Joueur', 'offensive', 'x')",
            [NOM]);
        await pool.query(
            "INSERT INTO pool_rank_snapshots (pool_name, team_name, rank, points, snapshot_date) VALUES ($1, 'Les Bleus', 1, 10, CURRENT_DATE)",
            [NOM]);
        await pool.query(
            "INSERT INTO notifications (recipient_user_id, type, pool_id, subject, dedup_key) VALUES ($1, 'trade_received', $2, $3, 'zz1')",
            [userId, poolId, JSON.stringify({ fromTeam: 'Les Bleus', toTeam: 'Rouges' })]);
        await pool.query(
            "INSERT INTO weekly_recaps (pool_id, season, week_number, pool_mode, payload) VALUES ($1, '20262027', 1, 'head-to-head', $2)",
            [poolId, JSON.stringify({ sections: [{ duels: [{ team1: 'Les Bleus', team2: 'Rouges' }] }] })]);

        const client = await pool.connect();
        let compte;
        try {
            await client.query('BEGIN');
            compte = await db.renameTeamInTx(client, { poolName: NOM, poolId, ancien: 'Les Bleus', nouveau: 'Bleuets' });
            await client.query('COMMIT');
        } finally { client.release(); }

        assert.equal(compte.echanges, 1);
        const echanges = (await pool.query('SELECT trade_data FROM trades WHERE pool_name = $1 ORDER BY id', [NOM])).rows;
        assert.equal(echanges[0].trade_data.toTeam, 'Bleuets');
        assert.equal(echanges[1].trade_data.toTeam, 'Verts');
        assert.equal((await pool.query('SELECT team_name FROM trade_listings WHERE pool_name = $1', [NOM])).rows[0].team_name, 'Bleuets');
        assert.equal((await pool.query('SELECT team_name FROM pool_rank_snapshots WHERE pool_name = $1', [NOM])).rows[0].team_name, 'Bleuets');
        assert.equal((await pool.query('SELECT subject FROM notifications WHERE pool_id = $1', [poolId])).rows[0].subject.fromTeam, 'Bleuets');
        assert.equal((await pool.query('SELECT payload FROM weekly_recaps WHERE pool_id = $1', [poolId])).rows[0].payload.sections[0].duels[0].team1, 'Bleuets');
    });

    test('renamePool garde l’ancien nom dans le pool', async () => {
        const r = await db.renamePool(NOM, NOM + ' 2');
        assert.equal(r.ok, true);
        const ligne = (await pool.query('SELECT pool_data, revision FROM pools WHERE pool_name = $1', [NOM + ' 2'])).rows[0];
        assert.deepEqual(ligne.pool_data.anciensNoms, [NOM]);
        assert.equal(Number(ligne.revision), 2);
    });
});
