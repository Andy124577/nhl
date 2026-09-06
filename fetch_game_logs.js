const fs = require('fs');
const path = require('path');
const db = require('./db');
const { currentSeasonString } = require('./lib/season.js');

// Configuration
const CURRENT_SEASON = currentSeasonString();
const GAME_TYPE = '2'; // Regular season
const STATS_FILE = path.join(__dirname, 'nhl_filtered_stats.json');
const DELAY_BETWEEN_REQUESTS = 100; // ms to avoid rate limiting
const MAX_CONCURRENT = 10; // Max concurrent requests

// Utility: Delay function
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Save games to PostgreSQL
async function saveGamesToDatabase(playerData) {
    const { playerId, playerName, position, gameLog } = playerData;

    if (!gameLog || gameLog.length === 0) {
        console.log(`⚠️  No games to save for ${playerName}`);
        return 0;
    }

    try {
        // Use upsert (INSERT ... ON CONFLICT UPDATE) for each game
        const queries = gameLog.map(game => {
            return db.query(`
                INSERT INTO player_game_logs (
                    player_id, player_name, position, season, game_id, game_date,
                    home_road_flag, opponent_abbrev, team_abbrev, game_result,
                    goals, assists, points, plus_minus, pim, shots,
                    power_play_goals, power_play_points, shorthanded_goals, shorthanded_points,
                    game_winning_goals, toi,
                    games_started, decision, shots_against, goals_against, saves, save_pct, shutouts,
                    last_updated
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6,
                    $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16,
                    $17, $18, $19, $20,
                    $21, $22,
                    $23, $24, $25, $26, $27, $28, $29,
                    NOW()
                )
                ON CONFLICT (player_id, game_id)
                DO UPDATE SET
                    player_name = EXCLUDED.player_name,
                    position = EXCLUDED.position,
                    game_date = EXCLUDED.game_date,
                    home_road_flag = EXCLUDED.home_road_flag,
                    opponent_abbrev = EXCLUDED.opponent_abbrev,
                    team_abbrev = EXCLUDED.team_abbrev,
                    game_result = EXCLUDED.game_result,
                    goals = EXCLUDED.goals,
                    assists = EXCLUDED.assists,
                    points = EXCLUDED.points,
                    plus_minus = EXCLUDED.plus_minus,
                    pim = EXCLUDED.pim,
                    shots = EXCLUDED.shots,
                    power_play_goals = EXCLUDED.power_play_goals,
                    power_play_points = EXCLUDED.power_play_points,
                    shorthanded_goals = EXCLUDED.shorthanded_goals,
                    shorthanded_points = EXCLUDED.shorthanded_points,
                    game_winning_goals = EXCLUDED.game_winning_goals,
                    toi = EXCLUDED.toi,
                    games_started = EXCLUDED.games_started,
                    decision = EXCLUDED.decision,
                    shots_against = EXCLUDED.shots_against,
                    goals_against = EXCLUDED.goals_against,
                    saves = EXCLUDED.saves,
                    save_pct = EXCLUDED.save_pct,
                    shutouts = EXCLUDED.shutouts,
                    last_updated = NOW()
            `, [
                playerId, playerName, position, CURRENT_SEASON, game.gameId, game.gameDate,
                game.homeRoadFlag, game.opponentAbbrev, game.teamAbbrev, game.gameResult,
                game.goals, game.assists, game.points, game.plusMinus, game.pim, game.shots,
                game.powerPlayGoals, game.powerPlayPoints, game.shorthandedGoals, game.shorthandedPoints,
                game.gameWinningGoals, game.toi,
                game.gamesStarted, game.decision, game.shotsAgainst, game.goalsAgainst,
                game.saves, game.savePct, game.shutouts
            ]);
        });

        await Promise.all(queries);
        console.log(`💾 Saved ${gameLog.length} games for ${playerName} to database`);
        return gameLog.length;

    } catch (error) {
        console.error(`❌ Error saving ${playerName} to database:`, error.message);
        return 0;
    }
}

// Fetch game log for a single player
async function fetchPlayerGameLog(playerId, playerName, position) {
    const url = `https://api-web.nhle.com/v1/player/${playerId}/game-log/${CURRENT_SEASON}/${GAME_TYPE}`;

    try {
        const response = await fetch(url);

        if (!response.ok) {
            console.log(`⚠️  No game log for ${playerName} (${playerId})`);
            return null;
        }

        const data = await response.json();

        if (!data || !data.gameLog || data.gameLog.length === 0) {
            console.log(`⚠️  Empty game log for ${playerName}`);
            return null;
        }

        console.log(`✅ Fetched ${data.gameLog.length} games for ${playerName}`);

        return {
            playerId,
            playerName,
            position,
            season: CURRENT_SEASON,
            gameType: GAME_TYPE,
            totalGames: data.gameLog.length,
            gameLog: data.gameLog.map(game => ({
                gameId: game.gameId,
                gameDate: game.gameDate,
                homeRoadFlag: game.homeRoadFlag,
                opponentAbbrev: game.opponentAbbrev,
                teamAbbrev: game.teamAbbrev,
                gameResult: game.gameResult,
                // Skater stats
                goals: game.goals || 0,
                assists: game.assists || 0,
                points: game.points || 0,
                plusMinus: game.plusMinus || 0,
                pim: game.pim || 0,
                shots: game.shots || 0,
                powerPlayGoals: game.powerPlayGoals || 0,
                powerPlayPoints: game.powerPlayPoints || 0,
                shorthandedGoals: game.shorthandedGoals || 0,
                shorthandedPoints: game.shorthandedPoints || 0,
                gameWinningGoals: game.gameWinningGoals || 0,
                toi: game.toi || '0:00',
                // Goalie stats - calculate saves and save percentage
                gamesStarted: game.gamesStarted || 0,
                decision: game.decision || null,
                shotsAgainst: game.shotsAgainst || 0,
                goalsAgainst: game.goalsAgainst || 0,
                // Calculate saves from shots against and goals against
                saves: game.saves || (game.shotsAgainst && game.goalsAgainst !== undefined ? game.shotsAgainst - game.goalsAgainst : 0),
                // Calculate save percentage from saves and shots against
                savePct: (() => {
                    if (game.savePct && game.savePct > 0) return game.savePct;
                    const shotsAgainst = game.shotsAgainst || 0;
                    const goalsAgainst = game.goalsAgainst || 0;
                    if (shotsAgainst > 0) {
                        const saves = shotsAgainst - goalsAgainst;
                        return saves / shotsAgainst;
                    }
                    return null;
                })(),
                shutouts: game.shutouts || 0
            }))
        };

    } catch (error) {
        console.error(`❌ Error fetching ${playerName}:`, error.message);
        return null;
    }
}

// Process players in batches
async function processBatch(players, batchSize = MAX_CONCURRENT) {
    let totalGamesSaved = 0;

    for (let i = 0; i < players.length; i += batchSize) {
        const batch = players.slice(i, i + batchSize);
        console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(players.length / batchSize)} (${batch.length} players)`);

        const batchResults = await Promise.all(
            batch.map(async (player, index) => {
                await delay(index * DELAY_BETWEEN_REQUESTS); // Stagger requests
                return fetchPlayerGameLog(player.playerId, player.playerName, player.position);
            })
        );

        // Save to database
        for (const playerData of batchResults.filter(r => r !== null)) {
            const gamesSaved = await saveGamesToDatabase(playerData);
            totalGamesSaved += gamesSaved;
        }

        // Delay between batches
        if (i + batchSize < players.length) {
            console.log(`⏳ Waiting before next batch...`);
            await delay(2000);
        }
    }

    return totalGamesSaved;
}

// Main function
async function main() {
    console.log('🏒 NHL Game Logs Fetcher (PostgreSQL)');
    console.log('=====================================\n');
    console.log(`Season: ${CURRENT_SEASON.substring(0, 4)}-${CURRENT_SEASON.substring(4)}`);
    console.log(`Game Type: Regular Season`);
    console.log(`Database: PostgreSQL (NeonTech)\n`);

    // Check database connection
    try {
        await db.query('SELECT NOW()');
        console.log('✅ Database connected\n');
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.log('💡 Make sure you have run the migration: node run_migration.js');
        process.exit(1);
    }

    // Load player list from nhl_filtered_stats.json
    if (!fs.existsSync(STATS_FILE)) {
        console.error(`❌ ${STATS_FILE} not found!`);
        console.log('Please run the api.py script first to generate player stats.');
        process.exit(1);
    }

    const statsData = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));

    // Collect all players
    const players = [];

    // Add offensive players (forwards)
    const offensivePlayers = statsData.Top_100_Offensive_Players || [];
    offensivePlayers.forEach(p => {
        players.push({
            playerId: p.playerId,
            playerName: p.skaterFullName,
            position: p.positionCode
        });
    });

    // Add defenders
    const defenders = statsData.Top_50_Defenders || [];
    defenders.forEach(p => {
        if (!players.find(pl => pl.playerId === p.playerId)) {
            players.push({
                playerId: p.playerId,
                playerName: p.skaterFullName,
                position: p.positionCode
            });
        }
    });

    // Add rookies
    const rookies = statsData.Top_Rookies || [];
    rookies.forEach(p => {
        if (!players.find(pl => pl.playerId === p.playerId) && p.positionCode !== 'G') {
            players.push({
                playerId: p.playerId,
                playerName: p.skaterFullName,
                position: p.positionCode
            });
        }
    });

    // Add goalies
    const goalies = statsData.Top_50_Goalies || [];
    goalies.forEach(p => {
        players.push({
            playerId: p.playerId,
            playerName: p.goalieFullName,
            position: 'G'
        });
    });

    console.log(`📊 Total players to fetch: ${players.length}`);
    console.log(`   - Forwards: ${offensivePlayers.length}`);
    console.log(`   - Defenders: ${defenders.length}`);
    console.log(`   - Rookies: ${rookies.length}`);
    console.log(`   - Goalies: ${goalies.length}\n`);

    // Fetch game logs and save to database
    const startTime = Date.now();
    const totalGamesSaved = await processBatch(players);
    const endTime = Date.now();

    console.log(`\n✅ Completed in ${((endTime - startTime) / 1000).toFixed(1)}s`);
    console.log(`💾 Total games saved to database: ${totalGamesSaved}`);

    // Get database stats
    try {
        const statsResult = await db.query(`
            SELECT
                COUNT(DISTINCT player_id) as total_players,
                COUNT(*) as total_games,
                MAX(last_updated) as last_updated
            FROM player_game_logs
            WHERE season = $1
        `, [CURRENT_SEASON]);

        const stats = statsResult.rows[0];
        console.log(`\n📊 Database Statistics:`);
        console.log(`   - Total players: ${stats.total_players}`);
        console.log(`   - Total games: ${stats.total_games}`);
        console.log(`   - Last updated: ${new Date(stats.last_updated).toLocaleString()}`);
    } catch (error) {
        console.error('⚠️  Could not fetch database stats:', error.message);
    }

    console.log('\n🎉 Done!');
    process.exit(0);
}

// Run
main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
