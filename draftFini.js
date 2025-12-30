let fullPlayerData = [];
let goalieData = [];
let teamData = [];
let imageList = [];
let currentStats = null;
const BASE_URL = window.location.hostname.includes("localhost")
  ? "http://localhost:3000"
  : "https://goondraft.onrender.com";

// Admin functionality
function initializeAdminUI() {
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    const username = localStorage.getItem("username");
    const isAdmin = localStorage.getItem("isAdmin") === "true";

    if (isLoggedIn) {
        if (isAdmin) {
            document.getElementById("admin-users-link").style.display = 'block';
            document.getElementById("admin-users-link").innerHTML = `
                <div class="admin-dropdown-container">
                    <a href="#" class="admin-dropdown-toggle" onclick="toggleAdminDropdown(event)">
                        Utilisateur ▼
                    </a>
                    <div class="admin-dropdown-menu" id="adminDropdown">
                        <div class="admin-dropdown-header">Changer d'utilisateur</div>
                        <div id="adminUserList" class="admin-user-list">Chargement...</div>
                    </div>
                </div>
            `;
            document.getElementById("login-link").innerHTML = `<a href="#" onclick="logout(event)">Déconnexion (${username})</a>`;
            loadAdminUsers();
        } else {
            document.getElementById("login-link").innerHTML = `<a href="#" onclick="logout(event)">Déconnexion (${username})</a>`;
        }
    }
}

function toggleAdminDropdown(event) {
    event.preventDefault();
    event.stopPropagation();
    const dropdown = document.getElementById('adminDropdown');
    dropdown.classList.toggle('show');
}

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

async function fetchImageData() {
    try {
        const cachedImages = localStorage.getItem("imageList");
        if (cachedImages) {
            imageList = JSON.parse(cachedImages);
            console.log("✅ Images chargées depuis le cache local.");
            return;
        }

        const response = await fetch("images.json", { cache: "no-store" });
        imageList = await response.json();
        localStorage.setItem("imageList", JSON.stringify(imageList));
        console.log("✅ Images chargées depuis le serveur et mises en cache.");
    } catch (error) {
        console.error("❌ Erreur chargement images :", error);
    }
}

function getMatchingImage(skaterName) {
    const formattedName = skaterName.replace(/\s/g, "_");
    return imageList.find(imagePath => {
        const baseName = imagePath.replace(/^faces\//, "").replace(/_\d{1,2}_\d{1,2}_\d{4}|_away/g, "").replace(".png", "");
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

function getTeamAbbreviation(teamFullName) {
    const team = teamData.find(t => t.teamFullName === teamFullName);
    return team ? team.teamAbbrevs : null;
}

// Helper function to get current stats for a player
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

document.addEventListener("DOMContentLoaded", async () => {
    initializeAdminUI();

    const clanName = localStorage.getItem("draftClan");
    if (!clanName) {
        alert("Aucun clan sélectionné.");
        window.location.href = "draft.html";
        return;
    }

    try {
        // Load image data first
        await fetchImageData();

        // Load player data (for metadata like names, positions)
        const statsResponse = await fetch("nhl_filtered_stats.json");
        const statsData = await statsResponse.json();
        fullPlayerData = [...statsData.Top_50_Defenders, ...statsData.Top_100_Offensive_Players, ...statsData.Top_Rookies];
        goalieData = statsData.Top_50_Goalies;
        teamData = statsData.Teams;

        // Load current season stats from API
        try {
            const currentStatsResponse = await fetch(`${BASE_URL}/current-stats`, { cache: "no-store" });
            currentStats = await currentStatsResponse.json();
            console.log(`✅ Current stats loaded: ${currentStats.players.length} players, last updated: ${currentStats.lastUpdated}`);
        } catch (error) {
            console.warn("⚠️ Could not load current stats, using cached data:", error);
        }

        // Load draft data
        const draftResponse = await fetch(`${BASE_URL}/draft`, { cache: "no-store" });
        const draftData = await draftResponse.json();
        const clan = draftData[clanName];

        if (!clan) {
            alert("Clan introuvable.");
            return;
        }

        document.getElementById("clanTitle").textContent = `Classement Final : ${clanName}`;
        renderTeamStatsTable(clan.teams);
    } catch (error) {
        console.error("Erreur lors du chargement :", error);
    }

    // Modal close handlers
    const modal = document.getElementById("playerDetailsModal");
    const closeBtn = document.querySelector(".close");

    closeBtn.onclick = function() {
        modal.classList.remove('show');
    }

    window.onclick = function(event) {
        if (event.target == modal) {
            modal.classList.remove('show');
        }
    }
});

function renderTeamStatsTable(teams) {
    const tbody = document.getElementById("teamStatsBody");
    tbody.innerHTML = "";

    // Calculate stats for each team
    const teamStats = Object.entries(teams)
        .filter(([_, team]) => team.members.length > 0)
        .map(([teamName, team]) => {
            const allPlayers = [
                ...(team.offensive || []),
                ...(team.defensive || []),
                ...(team.rookie || [])
            ];

            let totalGP = 0, totalG = 0, totalA = 0, totalPTS = 0;
            const playerDetails = [];

            // Calculate stats from skaters
            allPlayers.forEach(playerName => {
                const player = fullPlayerData.find(p => p.skaterFullName === playerName);
                if (player) {
                    // Try to get current stats, fallback to cached stats
                    const currentPlayerStats = getCurrentPlayerStats(playerName, player.playerId);

                    const gp = currentPlayerStats?.gamesPlayed ?? player.gamesPlayed ?? 0;
                    const g = currentPlayerStats?.goals ?? player.goals ?? 0;
                    const a = currentPlayerStats?.assists ?? player.assists ?? 0;
                    const pts = currentPlayerStats?.points ?? player.points ?? 0;
                    const todayPts = currentPlayerStats?.todayPoints ?? 0;

                    totalGP += gp;
                    totalG += g;
                    totalA += a;
                    totalPTS += pts;

                    playerDetails.push({
                        name: player.skaterFullName,
                        position: player.positionCode || 'F',
                        gp: gp,
                        g: g,
                        a: a,
                        pts: pts,
                        todayPoints: todayPts,
                        playerId: player.playerId,
                        teamAbbrev: player.teamAbbrevs,
                        type: 'player'
                    });
                }
            });

            // Add goalies
            (team.goalie || []).forEach(goalieName => {
                const goalie = goalieData.find(g => g.goalieFullName === goalieName);
                if (goalie) {
                    // Try to get current stats for goalie
                    const currentGoalieStats = getCurrentPlayerStats(goalieName, goalie.playerId);

                    const gp = currentGoalieStats?.gamesPlayed ?? goalie.gamesPlayed ?? 0;

                    // Calculate goalie points: shutouts * 5 + wins * 2 + OTL * 1
                    let pts;
                    let wins, shutouts, otl;

                    if (currentGoalieStats) {
                        wins = currentGoalieStats.wins || 0;
                        shutouts = currentGoalieStats.shutouts || 0;
                        otl = currentGoalieStats.otLosses || 0;
                        pts = (shutouts * 5) + (wins * 2) + (otl * 1);
                    } else {
                        wins = goalie.wins || 0;
                        shutouts = goalie.shutouts || 0;
                        otl = goalie.otLosses || 0;
                        pts = goalie.points || ((shutouts * 5) + (wins * 2) + (otl * 1));
                    }

                    const todayPts = currentGoalieStats?.todayPoints ?? 0;

                    totalGP += gp;
                    totalPTS += pts;

                    playerDetails.push({
                        name: goalie.goalieFullName,
                        position: 'G',
                        gp: gp,
                        g: wins,
                        a: shutouts,
                        pts: pts,
                        todayPoints: todayPts,
                        playerId: goalie.playerId,
                        teamAbbrev: goalie.teamAbbrevs,
                        type: 'goalie'
                    });
                }
            });

            // Add teams
            (team.teams || []).forEach(teamName => {
                const nhlTeam = teamData.find(t => t.teamFullName === teamName);
                if (nhlTeam) {
                    // Teams use cached data (no current stats from player API)
                    // Calculate team points: wins * 2 + OTL * 1
                    const gp = nhlTeam.gamesPlayed || 0;
                    const wins = nhlTeam.wins || 0;
                    const otl = nhlTeam.otLosses || 0;
                    const pts = (wins * 2) + (otl * 1);

                    totalGP += gp;
                    totalPTS += pts;

                    playerDetails.push({
                        name: nhlTeam.teamFullName,
                        position: 'TEAM',
                        gp: gp,
                        g: wins,
                        a: otl,
                        pts: pts,
                        todayPoints: 0, // Teams don't have daily updates
                        teamAbbrev: nhlTeam.teamAbbrevs,
                        type: 'team'
                    });
                }
            });

            return {
                teamName,
                members: team.members,
                totalGP,
                totalG,
                totalA,
                totalPTS,
                playerDetails
            };
        });

    // Sort by total points
    teamStats.sort((a, b) => b.totalPTS - a.totalPTS);

    // Render rows
    teamStats.forEach((team, index) => {
        const position = index + 1;
        let badgeClass = 'position-badge';
        if (position === 1) badgeClass += ' first';
        else if (position === 2) badgeClass += ' second';
        else if (position === 3) badgeClass += ' third';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><span class="${badgeClass}">${position}</span></td>
            <td><span class="team-name" onclick="showPlayerDetails('${team.teamName}', ${index})">${team.teamName}</span></td>
            <td>${team.members.join(', ')}</td>
            <td>${team.totalGP}</td>
            <td>${team.totalG}</td>
            <td>${team.totalA}</td>
            <td class="stats-pts">${team.totalPTS}</td>
        `;

        // Store player details on the row for later access
        row.dataset.playerDetails = JSON.stringify(team.playerDetails);
        row.dataset.teamName = team.teamName;

        tbody.appendChild(row);
    });
}

function showPlayerDetails(teamName, rowIndex) {
    const tbody = document.getElementById("teamStatsBody");
    const row = tbody.rows[rowIndex];
    const playerDetails = JSON.parse(row.dataset.playerDetails);

    // Set modal title
    document.getElementById("modalTeamName").textContent = `${teamName} - Détails des joueurs`;

    // Populate player details list
    const playerDetailsList = document.getElementById("playerDetailsList");
    playerDetailsList.innerHTML = "";

    playerDetails.forEach((player, index) => {
        const pickNumber = index + 1;

        // Get photo and logo using local images
        let imagePath;
        let logoPath;

        if (player.type === 'team') {
            // For teams, use team logo as main image
            const abbrev = getTeamAbbreviation(player.name);
            imagePath = abbrev ? `teams/${abbrev}.png` : null;
            logoPath = null; // No secondary logo for teams
        } else {
            // For players and goalies, get player photo and team logo
            imagePath = getMatchingImage(player.name);
            logoPath = getTeamLogoPath(player.teamAbbrev);
        }

        const playerCard = document.createElement('div');
        playerCard.className = 'player-card';

        // Build image HTML
        let imageHTML = '';
        if (imagePath) {
            imageHTML = `<img src="${imagePath}" alt="${player.name}" class="player-face">`;
        }
        if (logoPath && player.type !== 'team') {
            imageHTML += `<img src="${logoPath}" alt="Team logo" class="player-team-logo-overlay">`;
        }

        // Determine stat labels based on player type
        let statLabel1, statLabel2;
        if (player.type === 'goalie') {
            statLabel1 = 'W';  // Wins
            statLabel2 = 'SO'; // Shutouts
        } else if (player.type === 'team') {
            statLabel1 = 'W';   // Wins
            statLabel2 = 'OTL'; // Overtime Losses
        } else {
            statLabel1 = 'G'; // Goals
            statLabel2 = 'A'; // Assists
        }

        playerCard.innerHTML = `
            <div class="pick-number">${pickNumber}</div>
            <div class="player-photo">
                ${imageHTML || `<div class="no-photo">${player.position}</div>`}
            </div>
            <div class="player-info">
                <div class="player-name-row">
                    <span class="player-name">${player.name}</span>
                    ${logoPath && player.type !== 'team' ? `<img src="${logoPath}" class="nhl-team-logo" alt="${player.teamAbbrev}">` : ''}
                    <span class="player-position">${player.position}</span>
                </div>
                <div class="player-stats-row">
                    <span>GP: ${player.gp}</span>
                    <span>${statLabel1}: ${player.g}</span>
                    <span>${statLabel2}: ${player.a}</span>
                    <span>PTS: ${player.pts}</span>
                </div>
            </div>
            <div class="player-points">
                <span class="today-points">${player.todayPoints > 0 ? '+' : ''}${player.todayPoints || 0}</span>
                <span class="total-points">${player.pts}</span>
            </div>
        `;
        playerDetailsList.appendChild(playerCard);
    });

    // Show modal
    const modal = document.getElementById("playerDetailsModal");
    modal.classList.add('show');
}
