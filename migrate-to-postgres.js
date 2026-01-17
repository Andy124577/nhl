// Migration script to transfer data from JSON files to PostgreSQL
// Run this once: node migrate-to-postgres.js

const fs = require('fs');
const db = require('./db');

async function migrate() {
    console.log('🚀 Starting migration from JSON to PostgreSQL...\n');

    try {
        // Initialize database tables
        await db.initializeDatabase();
        console.log('');

        // ========== MIGRATE USERS ==========
        console.log('👥 Migrating users...');
        try {
            const usersData = JSON.parse(fs.readFileSync('./users.json', 'utf-8'));
            let userCount = 0;

            for (const user of usersData) {
                try {
                    await db.createUser(user.username, user.password, user.isAdmin || false);
                    userCount++;
                    console.log(`  ✓ Migrated user: ${user.username}`);
                } catch (error) {
                    if (error.message === 'Username already exists') {
                        console.log(`  ⊙ User already exists: ${user.username}`);
                    } else {
                        console.error(`  ✗ Error migrating user ${user.username}:`, error.message);
                    }
                }
            }
            console.log(`✅ Migrated ${userCount} users\n`);
        } catch (error) {
            console.error('❌ Error reading users.json:', error.message, '\n');
        }

        // ========== MIGRATE POOLS/DRAFTS ==========
        console.log('🏒 Migrating pools/drafts...');
        try {
            const draftData = JSON.parse(fs.readFileSync('./draft.json', 'utf-8'));
            let poolCount = 0;

            for (const [poolName, poolData] of Object.entries(draftData)) {
                try {
                    await db.createOrUpdatePool(poolName, poolData);
                    poolCount++;
                    console.log(`  ✓ Migrated pool: ${poolName}`);
                } catch (error) {
                    console.error(`  ✗ Error migrating pool ${poolName}:`, error.message);
                }
            }
            console.log(`✅ Migrated ${poolCount} pools\n`);
        } catch (error) {
            console.error('❌ Error reading draft.json:', error.message, '\n');
        }

        // ========== MIGRATE TRADES ==========
        console.log('🔄 Migrating trades...');
        try {
            const tradesData = JSON.parse(fs.readFileSync('./trades.json', 'utf-8'));
            let tradeCount = 0;

            for (const [poolName, poolTrades] of Object.entries(tradesData)) {
                if (!poolTrades.pending && !poolTrades.completed) continue;

                // Migrate pending trades
                if (poolTrades.pending && Array.isArray(poolTrades.pending)) {
                    for (const trade of poolTrades.pending) {
                        try {
                            const tradeId = await db.createTrade(poolName, trade);
                            await db.updateTradeStatus(tradeId, 'pending');
                            tradeCount++;
                            console.log(`  ✓ Migrated pending trade for pool: ${poolName}`);
                        } catch (error) {
                            console.error(`  ✗ Error migrating pending trade:`, error.message);
                        }
                    }
                }

                // Migrate completed trades
                if (poolTrades.completed && Array.isArray(poolTrades.completed)) {
                    for (const trade of poolTrades.completed) {
                        try {
                            const tradeId = await db.createTrade(poolName, trade);
                            await db.updateTradeStatus(tradeId, 'completed');
                            tradeCount++;
                            console.log(`  ✓ Migrated completed trade for pool: ${poolName}`);
                        } catch (error) {
                            console.error(`  ✗ Error migrating completed trade:`, error.message);
                        }
                    }
                }
            }
            console.log(`✅ Migrated ${tradeCount} trades\n`);
        } catch (error) {
            console.error('❌ Error reading trades.json:', error.message, '\n');
        }

        console.log('🎉 Migration completed successfully!');
        console.log('\n📝 Next steps:');
        console.log('  1. Verify your data in PostgreSQL');
        console.log('  2. Update your server.js to use the database');
        console.log('  3. Backup your JSON files (users.json, draft.json, trades.json)');
        console.log('  4. Deploy to Render.com\n');

    } catch (error) {
        console.error('💥 Migration failed:', error);
        process.exit(1);
    } finally {
        // Close database connection
        await db.pool.end();
        console.log('👋 Database connection closed');
    }
}

// Run migration
migrate();
