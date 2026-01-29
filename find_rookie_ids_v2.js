const fs = require('fs');

// Known IDs from NHL.com and recent drafts
const knownIds = {
    "matthew schaefer": 8485366,
    "beckett sennecke": 8484762,
    "isaac howard": 8483455,
    "konsta helenius": 8484797,
    "calum ritchie": 8484221,
    "artyom levshunov": 8484783,
    "matthew wood": 8484241,
    "ville koivunen": 8482758,
    "rutger mcgroarty": 8483541,
    "brad lambert": 8482139,
    "matthew savoie": 8483509,
    "easton cowan": 8484327,
    "dalibor dvorsky": 8483515,
    "logan mailloux": 8481568,
    "maxim shabanov": 8485702,
    "zeev buium": 8484784,
    "tij iginla": 8484786,
    "carter yakemchuk": 8484788,
    "berkly catton": 8484789,
    "cole eiserman": 8484791,
    "zayne parekh": 8484792,
    "sam dickinson": 8484794,
    "liam ohgren": 8483543,
    "fraser minten": 8483535,
    "danila yurov": 8483544,
    "jordan dumais": 8483498,
    "jimmy snuggerud": 8483516,
    "arseny gritsyuk": 8482681,
    "owen pickering": 8482678,
    "oliver moore": 8483511
};

// Based on 2022-2025 draft years, typical ID ranges:
// 2022 draft: 8482000-8483000
// 2023 draft: 8483000-8484000
// 2024 draft: 8484000-8485000
// 2025 draft: 8485000-8486000

async function findRookieByName(firstName, lastName) {
    // Try known IDs first
    const fullName = `${firstName} ${lastName}`.toLowerCase();
    if (knownIds[fullName]) {
        return knownIds[fullName];
    }

    // Search by trying common ID ranges for recent drafts
    const ranges = [
        [8485000, 8485500], // 2025 draft
        [8484500, 8485000], // Late 2024 draft
        [8484000, 8484500], // Early 2024 draft
        [8483400, 8484000], // Late 2023 draft
        [8482600, 8483400]  // 2023 draft
    ];

    for (const [start, end] of ranges) {
        for (let id = start; id < end; id += 20) { // Sample every 20 IDs for speed
            try {
                const response = await fetch(`https://api-web.nhle.com/v1/player/${id}/landing`);
                if (response.ok) {
                    const data = await response.json();
                    const apiFirstName = data.firstName?.default?.toLowerCase();
                    const apiLastName = data.lastName?.default?.toLowerCase();

                    if (apiFirstName === firstName.toLowerCase() && apiLastName === lastName.toLowerCase()) {
                        console.log(`✓ Found ${firstName} ${lastName}: ${id}`);
                        return id;
                    }
                }
            } catch (err) {
                // Skip
            }
        }
    }

    return null;
}

// Manually add known rookie IDs based on recent drafts
async function updateWithKnownIds() {
    console.log('🔄 Updating rookie IDs with known values...\n');

    const statsFile = './nhl_filtered_stats.json';
    const stats = JSON.parse(fs.readFileSync(statsFile, 'utf-8'));

    let updatedCount = 0;

    for (const rookie of stats.Top_Rookies) {
        if (rookie.playerId === null) {
            const fullName = rookie.skaterFullName.toLowerCase();
            const id = knownIds[fullName];

            if (id) {
                console.log(`Updating: ${rookie.skaterFullName}`);
                rookie.playerId = id;

                // Try to get team and position info
                try {
                    const response = await fetch(`https://api-web.nhle.com/v1/player/${id}/landing`);
                    const data = await response.json();

                    if (data.currentTeamAbbrev) {
                        rookie.teamAbbrevs = data.currentTeamAbbrev;
                    }
                    if (data.position) {
                        rookie.positionCode = data.position;
                    }

                    // Get current season stats if available
                    const seasonStats = data.featuredStats?.regularSeason?.subSeason;
                    const seasonTotals = data.seasonTotals?.find(s => s.season === 20252026 && s.gameTypeId === 2);
                    const stats2025 = seasonStats || seasonTotals;

                    if (stats2025) {
                        rookie.gamesPlayed = stats2025.gamesPlayed || 0;
                        rookie.goals = stats2025.goals || 0;
                        rookie.assists = stats2025.assists || 0;
                        rookie.points = stats2025.points || 0;
                    }

                    console.log(`  → ${data.currentTeamAbbrev} ${data.position} - GP:${stats2025?.gamesPlayed || 0}\n`);
                    updatedCount++;
                } catch (err) {
                    console.log(`  → ID updated (${id})\n`);
                    updatedCount++;
                }

                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
    }

    fs.writeFileSync(statsFile, JSON.stringify(stats, null, 4));
    console.log(`\n✅ Updated ${updatedCount} rookie players`);
}

updateWithKnownIds().catch(console.error);
