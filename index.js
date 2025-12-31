let fullPlayerData = [];
let teamData = [];
let imageList = [];
let goalieData = [];
let currentStats = null; // Stats actuelles de la saison 2024-2025 depuis l'API
let currentTeams = null; // Standings actuels des équipes depuis l'API

const BASE_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://nhl-draft.onrender.com';

// Helper function to get current player stats from API data
function getCurrentPlayerStats(playerName, playerId) {
    if (!currentStats || !currentStats.players) {
        return null;
    }

    // Try to find by playerId first (most reliable)
    if (playerId) {
        const stats = currentStats.players.find(p => p.playerId === playerId);
        if (stats) return stats;
    }

    // Fallback: try to find by name
    return currentStats.players.find(p => p.playerName === playerName);
}

// Helper function to get current team standings
function getCurrentTeamStats(teamFullName) {
    if (!currentTeams || !currentTeams.teams) {
        return null;
    }

    // Try to find by full name
    return currentTeams.teams.find(t => t.teamFullName === teamFullName);
}


// Charger les métadonnées des joueurs et les stats actuelles de la saison 2024-2025
async function fetchPlayerData() {
    try {
        // Load player metadata (names, positions, etc.)
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

        // Load current season stats from API (2024-2025)
        try {
            const currentStatsResponse = await fetch(`${BASE_URL}/current-stats`, { cache: "no-store" });
            currentStats = await currentStatsResponse.json();
            console.log(`✅ Current stats loaded: ${currentStats.players.length} players, last updated: ${currentStats.lastUpdated}`);
        } catch (error) {
            console.warn("⚠️ Could not load current stats, using cached data:", error);
        }

        // Load current team standings from API (2024-2025)
        try {
            const currentTeamsResponse = await fetch(`${BASE_URL}/current-teams`, { cache: "no-store" });
            currentTeams = await currentTeamsResponse.json();
            console.log(`✅ Current team standings loaded: ${currentTeams.teams.length} teams, last updated: ${currentTeams.lastUpdated}`);
        } catch (error) {
            console.warn("⚠️ Could not load current team standings, using cached data:", error);
        }

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
    const lastTeam = teamAbbrevs.split(",").pop().trim();
    return `teams/${lastTeam}.png`;
}

function updateTable() {
    const filter = document.getElementById("playerFilter").value;
    const sortBy = document.getElementById("sortBy").value;
    const searchTerm = document.getElementById("searchInput").value.toLowerCase();

    if (filter === "teams") {
        // Sort teams by current season standings
        const sortedTeams = [...teamData].sort((a, b) => {
            const statsA = getCurrentTeamStats(a.teamFullName);
            const statsB = getCurrentTeamStats(b.teamFullName);

            const pointsA = statsA ? statsA.points : a.points;
            const pointsB = statsB ? statsB.points : b.points;

            return pointsB - pointsA;
        });
        populateTeamTable(sortedTeams);
        return;
    }


    if (filter === "goalies") {
        // Sort goalies by current season stats
        const sortedGoalies = [...goalieData].sort((a, b) => {
            const statsA = getCurrentPlayerStats(a.goalieFullName, a.playerId);
            const statsB = getCurrentPlayerStats(b.goalieFullName, b.playerId);

            let aVal = 0;
            let bVal = 0;

            if (sortBy === "points") {
                // Calculate points for goalies: shutouts * 5 + wins * 2 + OTL * 1
                if (statsA) {
                    aVal = (statsA.shutouts * 5) + (statsA.wins * 2) + (statsA.otLosses * 1);
                } else {
                    aVal = a.points || 0;
                }
                if (statsB) {
                    bVal = (statsB.shutouts * 5) + (statsB.wins * 2) + (statsB.otLosses * 1);
                } else {
                    bVal = b.points || 0;
                }
            } else {
                aVal = statsA ? (statsA[sortBy] || 0) : (a[sortBy] || 0);
                bVal = statsB ? (statsB[sortBy] || 0) : (b[sortBy] || 0);
            }

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

    // Sort by current season stats
    filteredData.sort((a, b) => {
        const statsA = getCurrentPlayerStats(a.skaterFullName, a.playerId);
        const statsB = getCurrentPlayerStats(b.skaterFullName, b.playerId);

        const valueA = statsA ? (statsA[sortBy] || 0) : (a[sortBy] || 0);
        const valueB = statsB ? (statsB[sortBy] || 0) : (b[sortBy] || 0);

        return valueB - valueA;
    });

    populatePlayerTable(filteredData);
}

async function populatePlayerTable(playerData) {
    await fetchImageData();

    const table = document.getElementById("playerTable");
    table.innerHTML = `
        <tr>
            <th>Photo</th>
            <th>Joueur</th>
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

        // Get current season stats from API
        const currentPlayerStats = getCurrentPlayerStats(skaterName, player.playerId);

        let gp, goals, assists, points;
        if (currentPlayerStats) {
            // Use current season stats (2024-2025)
            gp = currentPlayerStats.gamesPlayed || 0;
            goals = currentPlayerStats.goals || 0;
            assists = currentPlayerStats.assists || 0;
            points = currentPlayerStats.points || 0;
        } else {
            // Fallback to cached data
            gp = player.gamesPlayed || 0;
            goals = player.goals || 0;
            assists = player.assists || 0;
            points = player.points || 0;
        }

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
            <td>${gp}</td>
            <td>${goals}</td>
            <td>${assists}</td>
            <td class="points-column">${points}</td>
        `;

        // Add click handler to show last year stats
        row.style.cursor = 'pointer';
        row.onclick = () => showLastYearStats(player, 'player');

        table.appendChild(row);
    });
}

function populateGoalieTable(goalies) {
    const table = document.getElementById("playerTable");
    table.innerHTML = `
        <tr>
            <th>Photo</th>
            <th>Gardien</th>
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

        // Get current season stats from API
        const currentGoalieStats = getCurrentPlayerStats(name, goalie.playerId);

        let gp, wins, losses, otLosses, savePct, shutouts, points;
        if (currentGoalieStats) {
            // Use current season stats (2024-2025)
            gp = currentGoalieStats.gamesPlayed || 0;
            wins = currentGoalieStats.wins || 0;
            losses = currentGoalieStats.losses || 0;
            otLosses = currentGoalieStats.otLosses || 0;
            savePct = currentGoalieStats.savePct || 0;
            shutouts = currentGoalieStats.shutouts || 0;
            // Calculate points using custom scoring: shutouts * 5 + wins * 2 + OTL * 1
            points = (shutouts * 5) + (wins * 2) + (otLosses * 1);
        } else {
            // Fallback to cached data
            gp = goalie.gamesPlayed || 0;
            wins = goalie.wins || 0;
            losses = goalie.losses || 0;
            otLosses = goalie.otLosses || 0;
            savePct = goalie.savePct || 0;
            shutouts = goalie.shutouts || 0;
            points = goalie.points || 0;
        }

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
            <td>${gp}</td>
            <td>${wins}</td>
            <td>${losses}</td>
            <td>${otLosses}</td>
            <td>${savePct?.toFixed(3)}</td>
            <td>${shutouts}</td>
            <td>${points}</td>
        `;

        // Add click handler to show last year stats
        row.style.cursor = 'pointer';
        row.onclick = () => showLastYearStats(goalie, 'goalie');

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
            <th>Équipe</th>
            <th>GP</th>
            <th>V</th>
            <th>D</th>
            <th>DP</th>
            <th>Points</th>
        </tr>
    `;

    teamStats.forEach(team => {
        const abbrev = getTeamAbbreviation(team.teamFullName);
        const logoPath = `teams/${abbrev}.png`;

        // Get current season team standings from API
        const currentTeamStats = getCurrentTeamStats(team.teamFullName);

        let gp, wins, losses, otLosses, points;
        if (currentTeamStats) {
            // Use current season standings (2024-2025)
            gp = currentTeamStats.gamesPlayed || 0;
            wins = currentTeamStats.wins || 0;
            losses = currentTeamStats.losses || 0;
            otLosses = currentTeamStats.otLosses || 0;
            // Points already calculated by server with custom scoring: wins * 2 + OTL * 1
            points = currentTeamStats.points || ((wins * 2) + (otLosses * 1));
        } else {
            // Fallback to cached data
            gp = team.gamesPlayed || 0;
            wins = team.wins || 0;
            losses = team.losses || 0;
            otLosses = team.otLosses || 0;
            points = team.points || 0;
        }

        const row = document.createElement("tr");
        row.innerHTML = `
            <td><img src="${logoPath}" alt="${team.teamFullName}" class="logo" style="width:40px;"></td>
            <td>${team.teamFullName}</td>
            <td>${gp}</td>
            <td>${wins}</td>
            <td>${losses}</td>
            <td>${otLosses}</td>
            <td>${points}</td>
        `;

        // Add click handler to show last year stats
        row.style.cursor = 'pointer';
        row.onclick = () => showLastYearStats(team, 'team');

        table.appendChild(row);
    });
}




// Modal functions to show base season stats (2024-2025 from JSON)
function showLastYearStats(currentData, type) {
    const modal = document.getElementById('lastYearModal');
    const modalPlayerName = document.getElementById('modalPlayerName');
    const modalStats = document.getElementById('modalStats');

    let baseSeasonPlayer = null;
    let playerName = '';

    // Find the player/goalie/team in base season data (from JSON file)
    if (type === 'player') {
        playerName = currentData.skaterFullName;
        baseSeasonPlayer = fullPlayerData.find(p => p.skaterFullName === playerName);
    } else if (type === 'goalie') {
        playerName = currentData.goalieFullName;
        baseSeasonPlayer = goalieData.find(g => g.goalieFullName === playerName);
    } else if (type === 'team') {
        playerName = currentData.teamFullName;
        baseSeasonPlayer = teamData.find(t => t.teamFullName === playerName);
    }

    modalPlayerName.textContent = playerName;

    if (!baseSeasonPlayer) {
        modalStats.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Aucune statistique disponible</p>';
    } else {
        let statsHTML = '';

        if (type === 'player') {
            statsHTML = `
                <div class="stat-item">
                    <div class="stat-label">Matchs joués</div>
                    <div class="stat-value">${baseSeasonPlayer.gamesPlayed || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Buts</div>
                    <div class="stat-value">${baseSeasonPlayer.goals || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Passes</div>
                    <div class="stat-value">${baseSeasonPlayer.assists || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Points</div>
                    <div class="stat-value">${baseSeasonPlayer.points || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">+/-</div>
                    <div class="stat-value">${baseSeasonPlayer.plusMinus || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">PIM</div>
                    <div class="stat-value">${baseSeasonPlayer.penaltyMinutes || 0}</div>
                </div>
            `;
        } else if (type === 'goalie') {
            const points = baseSeasonPlayer.points || 0;
            statsHTML = `
                <div class="stat-item">
                    <div class="stat-label">Matchs joués</div>
                    <div class="stat-value">${baseSeasonPlayer.gamesPlayed || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Victoires</div>
                    <div class="stat-value">${baseSeasonPlayer.wins || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Défaites</div>
                    <div class="stat-value">${baseSeasonPlayer.losses || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Prol.</div>
                    <div class="stat-value">${baseSeasonPlayer.otLosses || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">% Arrêts</div>
                    <div class="stat-value">${baseSeasonPlayer.savePct?.toFixed(3) || '0.000'}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Blanchissages</div>
                    <div class="stat-value">${baseSeasonPlayer.shutouts || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Points</div>
                    <div class="stat-value">${points}</div>
                </div>
            `;
        } else if (type === 'team') {
            statsHTML = `
                <div class="stat-item">
                    <div class="stat-label">Matchs joués</div>
                    <div class="stat-value">${baseSeasonPlayer.gamesPlayed || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Victoires</div>
                    <div class="stat-value">${baseSeasonPlayer.wins || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Défaites</div>
                    <div class="stat-value">${baseSeasonPlayer.losses || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Prol.</div>
                    <div class="stat-value">${baseSeasonPlayer.otLosses || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Points</div>
                    <div class="stat-value">${baseSeasonPlayer.points || 0}</div>
                </div>
            `;
        }

        modalStats.innerHTML = statsHTML;
    }

    modal.style.display = 'block';
}

function closeLastYearModal() {
    document.getElementById('lastYearModal').style.display = 'none';
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('lastYearModal');
    if (event.target === modal) {
        closeLastYearModal();
    }
}

document.getElementById("searchInput").addEventListener("input", updateTable);
document.getElementById("playerFilter").addEventListener("change", updateTable);
document.getElementById("sortBy").addEventListener("change", updateTable);

// Load data
fetchPlayerData(); // Load current season data

$(document).ready(function () {
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    const username = localStorage.getItem("username");
    const isAdmin = localStorage.getItem("isAdmin") === "true";

    if (isLoggedIn) {
        if (isAdmin) {
            // Admin mode - show Utilisateur dropdown and normal logout
            $("#admin-users-link").css('display', 'block').html(`
                <div class="admin-dropdown-container">
                    <a href="#" class="admin-dropdown-toggle" onclick="toggleAdminDropdown(event)">
                        Utilisateur ▼
                    </a>
                    <div class="admin-dropdown-menu" id="adminDropdown">
                        <div class="admin-dropdown-header">Changer d'utilisateur</div>
                        <div id="adminUserList" class="admin-user-list">Chargement...</div>
                    </div>
                </div>
            `);
            $("#login-link").html(`<a href="#" onclick="logout(event)">Déconnexion (${username})</a>`);
            loadAdminUsers();
        } else {
            // Regular user - show normal logout
            $("#login-link").html(`<a href="#" onclick="logout(event)">Déconnexion (${username})</a>`);
        }
    }
});

function toggleAdminDropdown(event) {
    event.preventDefault();
    event.stopPropagation();
    const dropdown = document.getElementById('adminDropdown');
    dropdown.classList.toggle('show');
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('adminDropdown');
    if (dropdown && !event.target.closest('.admin-dropdown-container')) {
        dropdown.classList.remove('show');
    }
});

async function loadAdminUsers() {
    try {
        const response = await fetch(`${BASE_URL}/admin-users?adminToken=admin`);
        const data = await response.json();

        if (response.ok) {
            const regularUsers = data.users.filter(u => u !== 'admin').slice(0, 4);
            const userListEl = document.getElementById('adminUserList');

            if (regularUsers.length === 0) {
                userListEl.innerHTML = '<div class="admin-no-users">Aucun utilisateur</div>';
            } else {
                userListEl.innerHTML = regularUsers.map(username => `
                    <a href="#" class="admin-dropdown-item" onclick="switchToUser(event, '${username}')">
                        <span class="user-avatar">${username.charAt(0).toUpperCase()}</span>
                        <span class="user-name">${username}</span>
                    </a>
                `).join('');
            }
        }
    } catch (error) {
        console.error('Error loading users:', error);
        document.getElementById('adminUserList').innerHTML = '<div class="admin-no-users">Erreur</div>';
    }
}

async function switchToUser(event, username) {
    event.preventDefault();
    event.stopPropagation();

    try {
        const response = await fetch(`${BASE_URL}/admin-switch-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                adminToken: 'admin',
                targetUsername: username
            })
        });

        if (response.ok) {
            localStorage.setItem('username', username);
            localStorage.setItem('activeUser', username);
            // Keep isAdmin flag - admin privileges persist across user switches
            window.location.reload();
        } else {
            alert('Erreur lors du changement d\'utilisateur');
        }
    } catch (error) {
        console.error('Error switching user:', error);
        alert('Erreur de connexion');
    }
}

function logout(event) {
    if (event) event.preventDefault();
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("username");
    localStorage.removeItem("isAdmin");
    localStorage.removeItem("activeUser");
    location.reload();
}
