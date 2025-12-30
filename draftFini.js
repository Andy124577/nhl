let fullPlayerData = [];
let imageList = [];
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
            // Admin mode - show Utilisateur dropdown and normal logout
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
            // Regular user - show normal logout
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

document.addEventListener("DOMContentLoaded", async () => {
    // Initialize admin UI first
    initializeAdminUI();
    const clanName = localStorage.getItem("draftClan");
    if (!clanName) {
        alert("Aucun clan sélectionné.");
        window.location.href = "draft.html";
        return;
    }

    try {
        const statsResponse = await fetch("nhl_filtered_stats.json");
        const statsData = await statsResponse.json();
        fullPlayerData = [...statsData.Top_50_Defenders, ...statsData.Top_100_Offensive_Players];

        const imageResponse = await fetch("images.json");
        imageList = await imageResponse.json();

        const draftResponse = await fetch(`${BASE_URL}/draft`, { cache: "no-store" });
        const draftData = await draftResponse.json();
        const clan = draftData[clanName];

        if (!clan) {
            alert("Clan introuvable.");
            return;
        }

        document.getElementById("clanTitle").textContent = `Draft terminé : ${clanName}`;
        renderTeamLeaderboard(clan.teams);
    } catch (error) {
        console.error("Erreur lors du chargement :", error);
    }
});



function renderTeams(teams) {
    const container = document.getElementById("teamsContainer");
    container.innerHTML = "";

    Object.entries(teams).forEach(([teamName, teamData]) => {
        if (teamData.members.length === 0) return;

        const teamDiv = document.createElement("div");
        teamDiv.className = "team-card";

        const members = teamData.members.join(", ") || "Aucun membre";

        const allPlayers = [...teamData.offensive, ...teamData.defensive];
        let totalPoints = 0;

        const offensiveList = teamData.offensive.map(name => {
            const stats = fullPlayerData.find(p => p.skaterFullName === name);
            const pts = stats?.points ?? "-";
            const ast = stats?.assists ?? "-";
            const g = stats?.goals ?? "-";
            totalPoints += stats?.points ?? 0;
            return `<li>${name} – ${g} G, ${ast} A, ${pts} PTS</li>`;
        }).join("");

        const defensiveList = teamData.defensive.map(name => {
            const stats = fullPlayerData.find(p => p.skaterFullName === name);
            const pts = stats?.points ?? "-";
            const ast = stats?.assists ?? "-";
            const g = stats?.goals ?? "-";
            totalPoints += stats?.points ?? 0;
            return `<li>${name} – ${g} G, ${ast} A, ${pts} PTS</li>`;
        }).join("");

        teamDiv.innerHTML = `
            <div class="team-header">
                <h3>${teamName}</h3>
                <div class="team-points">Total: ${totalPoints} PTS</div>
            </div>
            <p><strong>Membres :</strong> ${members}</p>
            <div class="team-section">
                <h4>🟥 Joueurs offensifs</h4>
                <ul>${offensiveList}</ul>
            </div>
            <div class="team-section">
                <h4>🟦 Défenseurs</h4>
                <ul>${defensiveList}</ul>
            </div>
        `;

        container.appendChild(teamDiv);
    });
}


function renderTeamLeaderboard(teams) {
    const container = document.getElementById("teamStatsContainer");
    const podiumContainer = document.getElementById("podiumContainer");
    container.innerHTML = "";
    podiumContainer.innerHTML = "";

    const teamStats = Object.entries(teams)
        .filter(([_, team]) => team.members.length > 0)
        .map(([teamName, team]) => {
            const players = [...team.offensive, ...team.defensive];
            let totalPoints = 0, totalGoals = 0, totalAssists = 0, totalGames = 0;

            const playerStats = players.map(name => {
                const stats = fullPlayerData.find(p => p.skaterFullName === name);
                if (!stats) return null;

                totalPoints += stats.points ?? 0;
                totalGoals += stats.goals ?? 0;
                totalAssists += stats.assists ?? 0;
                totalGames += stats.gamesPlayed ?? 0;

                return {
                    name,
                    position: stats.positionCode,
                    team: stats.teamAbbrevs,
                    games: stats.gamesPlayed,
                    goals: stats.goals,
                    assists: stats.assists,
                    points: stats.points,
                    image: getMatchingImage(name)
                };
            }).filter(Boolean);

            return {
                teamName,
                members: team.members,
                totalPoints,
                totalGoals,
                totalAssists,
                totalGames,
                playerStats
            };
        });

    // Sort by total points
    teamStats.sort((a, b) => b.totalPoints - a.totalPoints);

    // Render Podium (Top 3)
    teamStats.slice(0, 3).forEach((team, index) => {
        const rank = index + 1;
        const medals = ['🥇', '🥈', '🥉'];

        const podiumCard = document.createElement("div");
        podiumCard.className = `podium-card rank-${rank}`;

        podiumCard.innerHTML = `
            <div class="podium-rank">${medals[index]}</div>
            <div class="podium-team-name">${team.teamName}</div>
            <div class="podium-members">${team.members.join(", ")}</div>
            <div class="podium-stats">
                <div class="podium-stat">
                    <div class="podium-stat-label">Points</div>
                    <div class="podium-stat-value">${team.totalPoints}</div>
                </div>
                <div class="podium-stat">
                    <div class="podium-stat-label">Buts</div>
                    <div class="podium-stat-value">${team.totalGoals}</div>
                </div>
                <div class="podium-stat">
                    <div class="podium-stat-label">Passes</div>
                    <div class="podium-stat-value">${team.totalAssists}</div>
                </div>
                <div class="podium-stat">
                    <div class="podium-stat-label">Matchs</div>
                    <div class="podium-stat-value">${team.totalGames}</div>
                </div>
            </div>
        `;

        podiumContainer.appendChild(podiumCard);
    });

    // Render All Teams
    teamStats.forEach((team, index) => {
        const teamCard = document.createElement("div");
        teamCard.className = "team-card";

        const playerList = team.playerStats.map(p => {
            const teamLogo = p.team ? p.team.split(',').pop().trim() : '';
            return `
            <div class="player-row">
                <div class="player-photo">
                    ${p.image ? `<img src="${p.image}" class="face" alt="${p.name}">` : ''}
                    ${teamLogo ? `<img src="teams/${teamLogo}.png" class="logo" alt="${teamLogo}" onerror="this.style.display='none'">` : ''}
                </div>
                <div class="player-info">
                    <strong>${p.name}</strong> <span style="color: #ff2e2e;">(${p.position})</span>
                    <div class="player-stats">
                        <span class="stat-badge">GP: ${p.games}</span>
                        <span class="stat-badge">G: ${p.goals}</span>
                        <span class="stat-badge">A: ${p.assists}</span>
                        <span class="stat-badge">PTS: ${p.points}</span>
                    </div>
                </div>
            </div>
        `}).join("");

        teamCard.innerHTML = `
            <div class="team-header" onclick="toggleTeamDetails(this)">
                <div class="team-rank">${index + 1}</div>
                <h3>${team.teamName}</h3>
                <div class="team-meta">
                    <p><strong>Membres:</strong> ${team.members.join(", ")}</p>
                    <p><strong>Total PTS:</strong> ${team.totalPoints} | <strong>G:</strong> ${team.totalGoals} | <strong>A:</strong> ${team.totalAssists}</p>
                </div>
            </div>
            <div class="expand-indicator">Cliquez pour voir les joueurs ▼</div>
            <div class="team-details">
                ${playerList}
            </div>
        `;

        container.appendChild(teamCard);
    });
}

function toggleTeamDetails(header) {
    const details = header.parentElement.querySelector('.team-details');
    const indicator = header.parentElement.querySelector('.expand-indicator');
    details.classList.toggle('expanded');

    if (details.classList.contains('expanded')) {
        indicator.textContent = 'Cliquez pour masquer ▲';
    } else {
        indicator.textContent = 'Cliquez pour voir les joueurs ▼';
    }
}



function getMatchingImage(skaterName) {
    const formattedName = skaterName.replace(/\s/g, "_");
    return imageList.find(imagePath => {
        const baseName = imagePath.replace(/^faces\//, "").replace(/_\d{1,2}_\d{1,2}_\d{4}|_away/g, "").replace(".png", "");
        return baseName === formattedName;
    }) || null;
}

