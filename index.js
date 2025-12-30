let fullPlayerData = [];
let teamData = [];
let imageList = [];
let goalieData = [];
let lastYearData = {}; // Données de l'année passée

const BASE_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://nhl-draft.onrender.com';

// Charger les stats de l'année passée (2023-2024)
async function fetchLastYearData() {
    try {
        const response = await fetch("nhl_filtered_stats.json");
        if (!response.ok) throw new Error(`Error: ${response.status} - ${response.statusText}`);
        const data = await response.json();

        lastYearData = {
            players: [
                ...data.Top_50_Defenders,
                ...data.Top_100_Offensive_Players,
                ...data.Top_Rookies
            ],
            teams: data.Teams,
            goalies: data.Top_50_Goalies
        };
    } catch (error) {
        console.error("Failed to fetch last year data:", error);
    }
}

// Charger les stats de la saison en cours
async function fetchPlayerData() {
    try {
        const response = await fetch(`${BASE_URL}/current-stats`);
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
        console.error("Failed to fetch current player data:", error);
        // Fallback to last year data if current stats fail
        try {
            const response = await fetch("nhl_filtered_stats.json");
            const data = await response.json();
            fullPlayerData = [
                ...data.Top_50_Defenders,
                ...data.Top_100_Offensive_Players,
                ...data.Top_Rookies
            ];
            teamData = data.Teams;
            goalieData = data.Top_50_Goalies;
            updateTable();
        } catch (fallbackError) {
            console.error("Failed to fetch fallback data:", fallbackError);
        }
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

        // Add click handler to show last year stats
        row.style.cursor = 'pointer';
        row.onclick = () => showLastYearStats(team, 'team');

        table.appendChild(row);
    });
}




// Modal functions for last year stats
function showLastYearStats(currentData, type) {
    const modal = document.getElementById('lastYearModal');
    const modalPlayerName = document.getElementById('modalPlayerName');
    const modalStats = document.getElementById('modalStats');

    let lastYearPlayer = null;
    let playerName = '';

    // Find the player/goalie/team in last year's data
    if (type === 'player') {
        playerName = currentData.skaterFullName;
        lastYearPlayer = lastYearData.players?.find(p => p.skaterFullName === playerName);
    } else if (type === 'goalie') {
        playerName = currentData.goalieFullName;
        lastYearPlayer = lastYearData.goalies?.find(g => g.goalieFullName === playerName);
    } else if (type === 'team') {
        playerName = currentData.teamFullName;
        lastYearPlayer = lastYearData.teams?.find(t => t.teamFullName === playerName);
    }

    modalPlayerName.textContent = playerName;

    if (!lastYearPlayer) {
        modalStats.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Aucune statistique disponible pour 2023-2024</p>';
    } else {
        let statsHTML = '';

        if (type === 'player') {
            statsHTML = `
                <div class="stat-item">
                    <div class="stat-label">Matchs joués</div>
                    <div class="stat-value">${lastYearPlayer.gamesPlayed || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Buts</div>
                    <div class="stat-value">${lastYearPlayer.goals || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Passes</div>
                    <div class="stat-value">${lastYearPlayer.assists || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Points</div>
                    <div class="stat-value">${lastYearPlayer.points || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">+/-</div>
                    <div class="stat-value">${lastYearPlayer.plusMinus || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">PIM</div>
                    <div class="stat-value">${lastYearPlayer.penaltyMinutes || 0}</div>
                </div>
            `;
        } else if (type === 'goalie') {
            statsHTML = `
                <div class="stat-item">
                    <div class="stat-label">Matchs joués</div>
                    <div class="stat-value">${lastYearPlayer.gamesPlayed || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Victoires</div>
                    <div class="stat-value">${lastYearPlayer.wins || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Défaites</div>
                    <div class="stat-value">${lastYearPlayer.losses || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Prol.</div>
                    <div class="stat-value">${lastYearPlayer.otLosses || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">% Arrêts</div>
                    <div class="stat-value">${lastYearPlayer.savePct?.toFixed(3) || '0.000'}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Blanchissages</div>
                    <div class="stat-value">${lastYearPlayer.shutouts || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Points</div>
                    <div class="stat-value">${lastYearPlayer.points || 0}</div>
                </div>
            `;
        } else if (type === 'team') {
            statsHTML = `
                <div class="stat-item">
                    <div class="stat-label">Matchs joués</div>
                    <div class="stat-value">${lastYearPlayer.gamesPlayed || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Victoires</div>
                    <div class="stat-value">${lastYearPlayer.wins || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Défaites</div>
                    <div class="stat-value">${lastYearPlayer.losses || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Prol.</div>
                    <div class="stat-value">${lastYearPlayer.otLosses || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Points</div>
                    <div class="stat-value">${lastYearPlayer.points || 0}</div>
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
fetchLastYearData(); // Load last year data for modal
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
