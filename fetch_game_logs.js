const fs = require('fs');
const path = require('path');

// Configuration
const CURRENT_SEASON = '20252026';
const GAME_TYPE = '2'; // Regular season
const OUTPUT_FILE = path.join(__dirname, 'nhl_game_logs.json');
const STATS_FILE = path.join(__dirname, 'nhl_filtered_stats.json');
const DELAY_BETWEEN_REQUESTS = 100; // ms to avoid rate limiting
const MAX_CONCURRENT = 10; // Max concurrent requests

// Utility: Delay function
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
                // Goalie stats
                gamesStarted: game.gamesStarted || 0,
                decision: game.decision || null,
                shotsAgainst: game.shotsAgainst || 0,
                goalsAgainst: game.goalsAgainst || 0,
                saves: game.saves || 0,
                savePct: game.savePct || null,
                shutouts: game.shutouts || 0
            })),
            lastUpdated: new Date().toISOString()
        };

    } catch (error) {
        console.error(`❌ Error fetching ${playerName}:`, error.message);
        return null;
    }
}

// Process players in batches
async function processBatch(players, batchSize = MAX_CONCURRENT) {
    const results = [];

    for (let i = 0; i < players.length; i += batchSize) {
        const batch = players.slice(i, i + batchSize);
        console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(players.length / batchSize)} (${batch.length} players)`);

        const batchResults = await Promise.all(
            batch.map(async (player, index) => {
                await delay(index * DELAY_BETWEEN_REQUESTS); // Stagger requests
                return fetchPlayerGameLog(player.playerId, player.playerName, player.position);
            })
        );

        results.push(...batchResults.filter(r => r !== null));

        // Delay between batches
        if (i + batchSize < players.length) {
            console.log(`⏳ Waiting before next batch...`);
            await delay(2000);
        }
    }

    return results;
}

// Main function
async function main() {
    console.log('🏒 NHL Game Logs Fetcher');
    console.log('========================\n');
    console.log(`Season: ${CURRENT_SEASON.substring(0, 4)}-${CURRENT_SEASON.substring(4)}`);
    console.log(`Game Type: Regular Season\n`);

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
    console.log(`   - Skaters: ${players.filter(p => p.position !== 'G').length}`);
    console.log(`   - Goalies: ${players.filter(p => p.position === 'G').length}\n`);

    // Fetch game logs
    const startTime = Date.now();
    const gameLogs = await processBatch(players);
    const endTime = Date.now();

    console.log(`\n✅ Completed in ${((endTime - startTime) / 1000).toFixed(1)}s`);
    console.log(`📊 Successfully fetched: ${gameLogs.length}/${players.length} players`);

    // Calculate total games
    const totalGames = gameLogs.reduce((sum, p) => sum + p.totalGames, 0);
    console.log(`🎮 Total games cached: ${totalGames}`);

    // Save to file
    const output = {
        lastUpdated: new Date().toISOString(),
        season: CURRENT_SEASON,
        gameType: GAME_TYPE,
        totalPlayers: gameLogs.length,
        totalGames: totalGames,
        players: gameLogs
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\n💾 Saved to: ${OUTPUT_FILE}`);

    // Calculate file size
    const stats = fs.statSync(OUTPUT_FILE);
    const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`📦 File size: ${fileSizeInMB} MB`);

    console.log('\n🎉 Done!');
}

// Run
main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
