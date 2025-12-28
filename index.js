let fullPlayerData = [];
let teamData = [];
let imageList = [];
let goalieData = [];

async function fetchPlayerData() {
    try {
        const response = await fetch("nhl_filtered_stats.json");
        if (!response.ok) throw new Error(`Error: ${response.status} - ${response.statusText}`);
        const data = await response.json();

        fullPlayerData = [
            ...data.Top_50_Defenders,
            ...data.Top_100_Offensive_Players,
            ...data.Top_Rookies
        ];
        teamData = data.Teams;
        goalieData = data.Top_50_Goalies;

        updateTable();
    } catch (error) {
        console.error("Failed to fetch player data:", error);
    }
}

async function fetchImageData() {
    try {
        const response = await fetch("images.json");
        if (!response.ok) throw new Error(`Error: ${response.status} - ${response.statusText}`);
        imageList = await response.json();
    } catch (error) {
        console.error("Failed to fetch image data:", error);
    }
}

function getMatchingImage(skaterName) {
    const formattedName = skaterName.replace(/\s/g, "_");
    return imageList.find(imagePath => {
        const baseName = imagePath
            .replace(/^faces\//, "")
            .replace(/_\d{1,2}_\d{1,2}_\d{4}|_away/g, "")
            .replace(".png", "");
        return baseName === formattedName;
    }) || null;
}

function getTeamLogoPath(teamAbbrevs) {
    if (!teamAbbrevs || teamAbbrevs === "null") {
        return null;
    }
    const firstTeam = teamAbbrevs.split(",")[0].trim();
    return `teams/${firstTeam}.png`;
}

function updateTable() {
    const filter = document.getElementById("playerFilter").value;
    const sortBy = document.getElementById("sortBy").value;
    const searchTerm = document.getElementById("searchInput").value.toLowerCase();

    if (filter === "teams") {
        const sortedTeams = [...teamData].sort((a, b) => b.points - a.points);
        populateTeamTable(sortedTeams);
        return;
    }

    
    if (filter === "goalies") {
        const sortedGoalies = [...goalieData].sort((a, b) => {
        const aVal = a[sortBy] ?? 0;
        const bVal = b[sortBy] ?? 0;
        return bVal - aVal;
        });
        populateGoalieTable(sortedGoalies);
        return;
    }



    let filteredData = fullPlayerData;

    if (filter === "offensive") {
        filteredData = filteredData.filter(player => ["C", "R", "L"].includes(player.positionCode));
    } else if (filter === "defensive") {
        filteredData = filteredData.filter(player => player.positionCode === "D");
    } else if (filter === "rookies") {
        filteredData = filteredData.filter(player =>
            player.gamesPlayed <= 27 || player.playerId === null || player.teamAbbrevs === null
        );
    }

    if (searchTerm) {
        filteredData = filteredData.filter(player =>
            player.skaterFullName.toLowerCase().includes(searchTerm)
        );
    }

    filteredData.sort((a, b) => b[sortBy] - a[sortBy]);

    populatePlayerTable(filteredData);
}

async function populatePlayerTable(playerData) {
    await fetchImageData();

    const table = document.getElementById("playerTable");
    table.innerHTML = `
        <tr>
            <th>Photo</th>
            <th>Player</th>
            <th>GP</th>
            <th>G</th>
            <th>AST</th>
            <th class="points-column">PTS</th>
        </tr>
    `;

    playerData.forEach(player => {
        const skaterName = player.skaterFullName;
        const matchingImage = getMatchingImage(skaterName);
        const logoPath = getTeamLogoPath(player.teamAbbrevs);

        const imageHTML = matchingImage && logoPath
            ? `
            <div class="player-photo">
                <img src="${matchingImage}" alt="${skaterName}" class="face">
                <img src="${logoPath}" alt="${player.teamAbbrevs}" class="logo">
            </div>
            `
            : "";

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${imageHTML}</td>
            <td>${skaterName}, ${player.positionCode || "N/A"}</td>
            <td>${player.gamesPlayed}</td>
            <td>${player.goals}</td>
            <td>${player.assists}</td>
            <td class="points-column">${player.points}</td>
        `;
        table.appendChild(row);
    });
}

function populateGoalieTable(goalies) {
    const table = document.getElementById("playerTable");
    table.innerHTML = `
        <tr>
            <th>Photo</th>
            <th>Goalie</th>
            <th>GP</th>
            <th>W</th>
            <th>L</th>
            <th>OTL</th>
            <th>SV%</th>
            <th>SO</th>
            <th>PTS</th>
        </tr>
    `;

    goalies.forEach(goalie => {
        const name = goalie.goalieFullName;
        const imagePath = getMatchingImage(name);
        const logoPath = getTeamLogoPath(goalie.teamAbbrevs);

        const imageHTML = imagePath && logoPath
            ? `<div class="player-photo">
                    <img src="${imagePath}" alt="${name}" class="face">
                    <img src="${logoPath}" alt="${goalie.teamAbbrevs}" class="logo">
               </div>`
            : "";

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${imageHTML}</td>
            <td>${name}</td>
            <td>${goalie.gamesPlayed}</td>
            <td>${goalie.wins}</td>
            <td>${goalie.losses}</td>
            <td>${goalie.otLosses}</td>
            <td>${goalie.savePct?.toFixed(3)}</td>
            <td>${goalie.shutouts}</td>
            <td>${goalie.points}</td>
        `;
        table.appendChild(row);
    });
}


function getTeamAbbreviation(teamName) {
    const specialCases = {
        "Florida": "FLA",
        "Calgary": "CGY",
        "Montr\u00e9al": "MTL",
        "Nashville": "NSH",
        "Louis": "STL",
        "Washington": "WSH",
        "Toronto": "TOR",
        "Winnipeg": "WPG",
        "Utah": "UTA",
        "Detroit": "DET"
    };

    const words = teamName.split(" ");
    if (specialCases[words[0]]) {
        return specialCases[words[0]];
    }

    if (words.length === 3) {
        return words.map(w => w[0]).join("").toUpperCase(); // e.g., New Jersey Devils → NJD
    }

    return words[0].substring(0, 3).toUpperCase(); // e.g., Boston Bruins → BOS
}

function populateTeamTable(teamStats) {
    const table = document.getElementById("playerTable");
    table.innerHTML = `
        <tr>
            <th>Logo</th>
            <th>Team</th>
            <th>GP</th>
            <th>Wins</th>
            <th>Losses</th>
            <th>OTL</th>
            <th>Points</th>
        </tr>
    `;

    teamStats.forEach(team => {
        const abbrev = getTeamAbbreviation(team.teamFullName);
        const logoPath = `teams/${abbrev}.png`;

        const row = document.createElement("tr");
        row.innerHTML = `
            <td><img src="${logoPath}" alt="${team.teamFullName}" class="logo" style="width:40px;"></td>
            <td>${team.teamFullName}</td>
            <td>${team.gamesPlayed}</td>
            <td>${team.wins}</td>
            <td>${team.losses}</td>
            <td>${team.otLosses}</td>
            <td>${team.points}</td>
        `;
        table.appendChild(row);
    });
}




document.getElementById("searchInput").addEventListener("input", updateTable);
document.getElementById("playerFilter").addEventListener("change", updateTable);
document.getElementById("sortBy").addEventListener("change", updateTable);

fetchPlayerData();

$(document).ready(function () {
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    const username = localStorage.getItem("username");

    if (isLoggedIn) {
        $("#login-link").html(`<a href="#" onclick="logout()">Déconnexion (${username})</a>`);
    }
});

function logout() {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("username");
    location.reload();
}
