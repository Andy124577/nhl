const { Pool } = require('pg');

// PostgreSQL connection pool
// Use DATABASE_URL from environment (Render will provide this)
// Or fallback to local development config
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Test connection
pool.on('connect', () => {
    console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ Unexpected error on idle PostgreSQL client', err);
});

// Initialize database tables
async function initializeDatabase() {
    const client = await pool.connect();
    try {
        console.log('🔧 Initializing database schema...');

        // Create users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                is_admin BOOLEAN DEFAULT FALSE,
                avatar_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // Add avatar_url column to existing deployments that predate this migration
        await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
        `);
        console.log('✅ Users table ready');

        // Create pools table (stores draft/pool data)
        await client.query(`
            CREATE TABLE IF NOT EXISTS pools (
                id SERIAL PRIMARY KEY,
                pool_name VARCHAR(255) UNIQUE NOT NULL,
                pool_data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Pools table ready');

        // Create trades table
        await client.query(`
            CREATE TABLE IF NOT EXISTS trades (
                id SERIAL PRIMARY KEY,
                pool_name VARCHAR(255) NOT NULL,
                trade_data JSONB NOT NULL,
                status VARCHAR(50) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Trades table ready');

        // Create index on pool_name for faster queries
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_trades_pool_name ON trades(pool_name);
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
        `);

        // Create trade_listings table — players a pool member has flagged as
        // open to offers. A pure visibility signal: it does not change the
        // 1-for-1 same-category rule trades themselves enforce.
        await client.query(`
            CREATE TABLE IF NOT EXISTS trade_listings (
                id SERIAL PRIMARY KEY,
                pool_name VARCHAR(255) NOT NULL,
                team_name VARCHAR(255) NOT NULL,
                player_name VARCHAR(255) NOT NULL,
                category VARCHAR(20) NOT NULL,
                listed_by VARCHAR(255) NOT NULL,
                status VARCHAR(20) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                removed_at TIMESTAMP
            );
        `);
        console.log('✅ Trade listings table ready');

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_trade_listings_pool_name ON trade_listings(pool_name);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_trade_listings_status ON trade_listings(status);
        `);
        // A player can only be listed once at a time.
        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_listings_active_unique
                ON trade_listings(pool_name, team_name, player_name) WHERE status = 'active';
        `);

        // Create cached_stats table for storing NHL API stats
        await client.query(`
            CREATE TABLE IF NOT EXISTS cached_stats (
                id SERIAL PRIMARY KEY,
                cache_key VARCHAR(100) UNIQUE NOT NULL,
                data JSONB NOT NULL,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Cached stats table ready');

        // Create pool_rank_snapshots table — one row per team per day, taken
        // just after the midnight stats refresh (see snapshotAllPoolRanks in
        // server.js). Lets the homepage show real "▲2 places since this
        // morning" movement instead of inventing a trend with nothing to
        // diff against.
        await client.query(`
            CREATE TABLE IF NOT EXISTS pool_rank_snapshots (
                id SERIAL PRIMARY KEY,
                pool_name VARCHAR(255) NOT NULL,
                team_name VARCHAR(255) NOT NULL,
                rank INT NOT NULL,
                points NUMERIC NOT NULL,
                snapshot_date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(pool_name, team_name, snapshot_date)
            );
        `);
        console.log('✅ Pool rank snapshots table ready');

        console.log('✅ Database initialization complete');
    } catch (error) {
        console.error('❌ Error initializing database:', error);
        throw error;
    } finally {
        client.release();
    }
}

// =============================================
// USER OPERATIONS
// =============================================

async function getAllUsers() {
    const result = await pool.query('SELECT username, is_admin FROM users ORDER BY username');
    return result.rows.map(row => ({
        username: row.username,
        isAdmin: row.is_admin
    }));
}

async function getUserByUsername(username) {
    const result = await pool.query(
        'SELECT username, password, is_admin, avatar_url FROM users WHERE username = $1',
        [username]
    );
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
        username: row.username,
        password: row.password,
        isAdmin: row.is_admin,
        avatarUrl: row.avatar_url || ''
    };
}

async function updateUserAvatar(username, avatarUrl) {
    await pool.query(
        'UPDATE users SET avatar_url = $1 WHERE username = $2',
        [avatarUrl, username]
    );
}

async function createUser(username, hashedPassword, isAdmin = false) {
    try {
        const result = await pool.query(
            'INSERT INTO users (username, password, is_admin) VALUES ($1, $2, $3) RETURNING username, is_admin',
            [username, hashedPassword, isAdmin]
        );
        return {
            username: result.rows[0].username,
            isAdmin: result.rows[0].is_admin
        };
    } catch (error) {
        if (error.code === '23505') { // Unique violation
            throw new Error('Username already exists');
        }
        throw error;
    }
}

async function deleteUser(username) {
    const result = await pool.query(
        'DELETE FROM users WHERE username = $1 RETURNING username',
        [username]
    );
    return result.rowCount > 0;
}

// =============================================
// POOL/DRAFT OPERATIONS
// =============================================

async function getAllPools() {
    const result = await pool.query('SELECT pool_name, pool_data FROM pools ORDER BY created_at DESC');
    const pools = {};
    result.rows.forEach(row => {
        pools[row.pool_name] = row.pool_data;
    });
    return pools;
}

async function getPoolByName(poolName) {
    const result = await pool.query(
        'SELECT pool_data FROM pools WHERE pool_name = $1',
        [poolName]
    );
    return result.rows.length > 0 ? result.rows[0].pool_data : null;
}

async function createOrUpdatePool(poolName, poolData) {
    const result = await pool.query(`
        INSERT INTO pools (pool_name, pool_data, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (pool_name)
        DO UPDATE SET
            pool_data = $2,
            updated_at = CURRENT_TIMESTAMP
        RETURNING pool_name
    `, [poolName, JSON.stringify(poolData)]);

    return result.rows[0].pool_name;
}

async function deletePool(poolName) {
    const result = await pool.query(
        'DELETE FROM pools WHERE pool_name = $1 RETURNING pool_name',
        [poolName]
    );
    return result.rowCount > 0;
}

// =============================================
// TRADE OPERATIONS
// =============================================

async function getAllTrades(poolName = null) {
    let query, params;

    if (poolName) {
        query = 'SELECT id, trade_data, status, created_at FROM trades WHERE pool_name = $1 ORDER BY created_at DESC';
        params = [poolName];
    } else {
        query = 'SELECT id, trade_data, status, created_at FROM trades ORDER BY created_at DESC';
        params = [];
    }

    const result = await pool.query(query, params);
    return result.rows.map(row => ({
        id: row.id,
        ...row.trade_data,
        status: row.status,
        createdAt: row.created_at
    }));
}

async function getPendingTrades(poolName) {
    const result = await pool.query(
        'SELECT id, trade_data FROM trades WHERE pool_name = $1 AND status = $2 ORDER BY created_at DESC',
        [poolName, 'pending']
    );
    return result.rows.map(row => ({
        id: row.id,
        ...row.trade_data
    }));
}

async function getCompletedTrades(poolName) {
    const result = await pool.query(
        'SELECT id, trade_data FROM trades WHERE pool_name = $1 AND status = $2 ORDER BY created_at DESC',
        [poolName, 'completed']
    );
    return result.rows.map(row => ({
        id: row.id,
        ...row.trade_data
    }));
}

async function createTrade(poolName, tradeData) {
    const result = await pool.query(
        'INSERT INTO trades (pool_name, trade_data, status) VALUES ($1, $2, $3) RETURNING id',
        [poolName, JSON.stringify(tradeData), 'pending']
    );
    return result.rows[0].id;
}

async function updateTradeStatus(tradeId, status) {
    const result = await pool.query(
        'UPDATE trades SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id',
        [status, tradeId]
    );
    return result.rowCount > 0;
}

async function deleteTrade(tradeId) {
    const result = await pool.query(
        'DELETE FROM trades WHERE id = $1 RETURNING id',
        [tradeId]
    );
    return result.rowCount > 0;
}

async function deleteTradesByPoolName(poolName) {
    const result = await pool.query(
        'DELETE FROM trades WHERE pool_name = $1',
        [poolName]
    );
    return result.rowCount;
}

// =============================================
// TRADE LISTING OPERATIONS
// =============================================

async function getActiveListingsForPool(poolName) {
    const result = await pool.query(
        `SELECT id, team_name, player_name, category, listed_by, created_at
         FROM trade_listings WHERE pool_name = $1 AND status = 'active'
         ORDER BY created_at DESC`,
        [poolName]
    );
    return result.rows.map(row => ({
        id: row.id,
        teamName: row.team_name,
        playerName: row.player_name,
        category: row.category,
        listedBy: row.listed_by,
        createdAt: row.created_at
    }));
}

async function getTradeListingById(id) {
    const result = await pool.query(
        `SELECT id, pool_name, team_name, player_name, category, listed_by, status
         FROM trade_listings WHERE id = $1`,
        [id]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
        id: row.id,
        poolName: row.pool_name,
        teamName: row.team_name,
        playerName: row.player_name,
        category: row.category,
        listedBy: row.listed_by,
        status: row.status
    };
}

// Returns the new row's id, or null if this player is already listed
// (the partial unique index rejects the insert).
async function createTradeListing(poolName, teamName, playerName, category, listedBy) {
    try {
        const result = await pool.query(
            `INSERT INTO trade_listings (pool_name, team_name, player_name, category, listed_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [poolName, teamName, playerName, category, listedBy]
        );
        return result.rows[0].id;
    } catch (error) {
        if (error.code === '23505') return null; // unique_violation — already listed
        throw error;
    }
}

async function removeTradeListing(id, poolName, teamName) {
    const result = await pool.query(
        `UPDATE trade_listings SET status = 'removed', removed_at = NOW()
         WHERE id = $1 AND pool_name = $2 AND team_name = $3 AND status = 'active'
         RETURNING id`,
        [id, poolName, teamName]
    );
    return result.rowCount > 0;
}

// Auto-expires a listing when its player changes teams via a completed trade.
async function removeTradeListingByPlayer(poolName, playerName) {
    const result = await pool.query(
        `UPDATE trade_listings SET status = 'removed', removed_at = NOW()
         WHERE pool_name = $1 AND player_name = $2 AND status = 'active'
         RETURNING id`,
        [poolName, playerName]
    );
    return result.rowCount;
}

// =============================================
// EXPORTS
// =============================================

// ==================== CACHED STATS FUNCTIONS ====================

// Save or update cached stats
async function saveCachedStats(cacheKey, data) {
    const client = await pool.connect();
    try {
        await client.query(`
            INSERT INTO cached_stats (cache_key, data, last_updated)
            VALUES ($1, $2, NOW())
            ON CONFLICT (cache_key)
            DO UPDATE SET data = $2, last_updated = NOW()
        `, [cacheKey, JSON.stringify(data)]);
        console.log(`✅ Cached stats saved: ${cacheKey}`);
    } catch (error) {
        console.error(`❌ Error saving cached stats for ${cacheKey}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

// Load cached stats
async function loadCachedStats(cacheKey) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT data, last_updated FROM cached_stats WHERE cache_key = $1',
            [cacheKey]
        );

        if (result.rows.length > 0) {
            return {
                ...result.rows[0].data,
                lastUpdated: result.rows[0].last_updated
            };
        }
        return null;
    } catch (error) {
        console.error(`❌ Error loading cached stats for ${cacheKey}:`, error);
        return null;
    } finally {
        client.release();
    }
}

// Helper function for direct queries (used by migration and fetch scripts)
const query = (text, params) => pool.query(text, params);

module.exports = {
    pool,
    query, // Export query function for direct database access
    initializeDatabase,
    // Users
    getAllUsers,
    getUserByUsername,
    createUser,
    deleteUser,
    updateUserAvatar,
    // Pools
    getAllPools,
    getPoolByName,
    createOrUpdatePool,
    deletePool,
    // Trades
    getAllTrades,
    getPendingTrades,
    getCompletedTrades,
    createTrade,
    updateTradeStatus,
    deleteTrade,
    deleteTradesByPoolName,
    // Trade listings
    getActiveListingsForPool,
    getTradeListingById,
    createTradeListing,
    removeTradeListing,
    removeTradeListingByPlayer,
    // Cached Stats
    saveCachedStats,
    loadCachedStats
};
