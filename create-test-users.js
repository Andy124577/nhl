// Script to create test users for the admin to switch between
const bcrypt = require('bcryptjs');
const db = require('./db');

const testUsers = [
    { username: 'alex', password: 'test123', isAdmin: false },
    { username: 'marie', password: 'test123', isAdmin: false },
    { username: 'jean', password: 'test123', isAdmin: false },
    { username: 'sophie', password: 'test123', isAdmin: false },
    { username: 'thomas', password: 'test123', isAdmin: false },
    { username: 'emma', password: 'test123', isAdmin: false },
];

async function createTestUsers() {
    try {
        console.log('🔧 Initializing database...');
        await db.initializeDatabase();

        console.log('👥 Creating test users...');

        for (const user of testUsers) {
            try {
                // Check if user already exists
                const existing = await db.getUserByUsername(user.username);
                if (existing) {
                    console.log(`⚠️  User "${user.username}" already exists, skipping...`);
                    continue;
                }

                // Hash password
                const hashedPassword = await bcrypt.hash(user.password, 10);

                // Create user
                await db.createUser(user.username, hashedPassword, user.isAdmin);
                console.log(`✅ Created user: ${user.username}`);
            } catch (error) {
                console.error(`❌ Error creating user ${user.username}:`, error.message);
            }
        }

        console.log('\n🎉 Test users created successfully!');
        console.log('\n📝 Login credentials for all test users:');
        console.log('   Username: alex, marie, jean, sophie, thomas, emma');
        console.log('   Password: test123');
        console.log('\nYou can now use these users to test the admin user switching feature.');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    createTestUsers();
}

module.exports = createTestUsers;
