const fs = require('fs');
const path = require('path');
const db = require('./db');

async function runMigration(migrationFile) {
    try {
        console.log('🔄 Running migration:', migrationFile);

        const migrationPath = path.join(__dirname, 'migrations', migrationFile);

        if (!fs.existsSync(migrationPath)) {
            console.error('❌ Migration file not found:', migrationPath);
            process.exit(1);
        }

        const sql = fs.readFileSync(migrationPath, 'utf-8');

        console.log('📄 Executing SQL migration...');
        await db.query(sql);

        console.log('✅ Migration completed successfully!');
        console.log('');

    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    }
}

async function main() {
    console.log('🗄️  NHL Database Migration Runner');
    console.log('================================\n');

    const migrationFile = process.argv[2] || 'create_player_game_logs.sql';

    try {
        await runMigration(migrationFile);
        console.log('🎉 All migrations completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('💥 Migration failed:', error.message);
        process.exit(1);
    }
}

main();
