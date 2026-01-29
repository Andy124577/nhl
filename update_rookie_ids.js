const fs = require('fs');

// List of rookies to update
const rookieNames = [
    "ivan demidov", "michael misa", "alexander nikishin", "jimmy snuggerud", "ryan leonard",
    "zeev buium", "zayne parekh", "ville koivunen", "gabriel perreault", "sam dickinson",
    "sam rinzel", "james hagens", "rutger mcgroarty", "matthew savoie", "calum ritchie",
    "matthew schaefer", "maxim shabanov", "anton frondell", "brad lambert", "artyom levshunov",
    "tij iginla", "konsta helenius", "cole eiserman", "beckett sennecke", "axel sandin pellikka",
    "kasper halttunen", "daniil but", "jordan dumais", "fraser minten", "matej blumel",
    "oliver moore", "nikita prishchepov", "isaac howard", "liam ohgren", "danila yurov",
    "matthew wood", "arseny gritsyuk", "owen pickering", "jani nyman",
    "logan mailloux", "justin sourdif", "easton cowan", "berkly catton",
    "caleb desnoyers", "carter yakemchuk", "dalibor dvorsky", "bradly nadeau",
    "ty mueller", "luca cagnoni", "quinn hutson", "cole hutson"
];

// Known IDs from user
const knownIds = {
    "matthew schaefer": 8485366,
    "beckett sennecke": 8484762,
    "isaac howard": 8483455,
    "konsta helenius": 8484797
};

// Function to search for player ID
async function findPlayerId(playerName) {
    try {
        // Check if we already know the ID
        if (knownIds[playerName.toLowerCase()]) {
            return knownIds[playerName.toLowerCase()];
        }

        // Search NHL API
        const searchQuery = encodeURIComponent(playerName);
        const searchUrl = `https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=5&q=${searchQuery}`;

        const response = await fetch(searchUrl);
        const data = await response.json();

        if (data && data.length > 0) {
            // Find best match (exact name match, case-insensitive)
            const exactMatch = data.find(p =>
                p.name.toLowerCase() === playerName.toLowerCase()
            );

            if (exactMatch) {
                console.log(`✓ Found ${playerName}: ${exactMatch.playerId}`);
                return exactMatch.playerId;
            }

            // If no exact match, take first result
            console.log(`⚠ Approximate match for ${playerName}: ${data[0].playerId} (${data[0].name})`);
            return data[0].playerId;
        }

        console.log(`❌ Could not find player ID for: ${playerName}`);
        return null;
    } catch (error) {
        console.error(`Error searching for ${playerName}:`, error.message);
        return null;
    }
}

// Function to update the stats file
async function updateRookieIds() {
    console.log('🔄 Starting rookie ID update...\n');

    // Load the stats file
    const statsFile = './nhl_filtered_stats.json';
    const stats = JSON.parse(fs.readFileSync(statsFile, 'utf-8'));

    if (!stats.Top_Rookies) {
        console.error('❌ No Top_Rookies section found in stats file');
        return;
    }

    let updatedCount = 0;

    // Update each rookie
    for (const rookie of stats.Top_Rookies) {
        if (rookie.playerId === null) {
            const playerName = rookie.skaterFullName.toLowerCase();

            // Check if this rookie is in our list
            if (rookieNames.includes(playerName)) {
                console.log(`Searching for: ${rookie.skaterFullName}`);
                const playerId = await findPlayerId(playerName);

                if (playerId) {
                    rookie.playerId = playerId;
                    updatedCount++;

                    // Also try to get basic info from NHL API
                    try {
                        const playerUrl = `https://api-web.nhle.com/v1/player/${playerId}/landing`;
                        const playerResponse = await fetch(playerUrl);
                        const playerData = await playerResponse.json();

                        if (playerData.currentTeamAbbrev) {
                            rookie.teamAbbrevs = playerData.currentTeamAbbrev;
                        }
                        if (playerData.position) {
                            rookie.positionCode = playerData.position;
                        }

                        console.log(`  → Updated: ${rookie.skaterFullName} (${playerId}, ${playerData.currentTeamAbbrev}, ${playerData.position})\n`);
                    } catch (err) {
                        console.log(`  → Updated ID only: ${rookie.skaterFullName} (${playerId})\n`);
                    }
                }

                // Delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }
    }

    // Save updated file
    fs.writeFileSync(statsFile, JSON.stringify(stats, null, 4));
    console.log(`\n✅ Updated ${updatedCount} rookie player IDs`);
    console.log(`📁 File saved: ${statsFile}`);
}

// Run the update
updateRookieIds().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
