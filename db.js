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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
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
        'SELECT username, password, is_admin FROM users WHERE username = $1',
        [username]
    );
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
        username: row.username,
        password: row.password,
        isAdmin: row.is_admin
    };
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
// EXPORTS
// =============================================

module.exports = {
    pool,
    initializeDatabase,
    // Users
    getAllUsers,
    getUserByUsername,
    createUser,
    deleteUser,
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
    deleteTradesByPoolName
};
