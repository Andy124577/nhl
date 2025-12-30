let fullPlayerData = [];
let goalieData = [];
let teamData = [];
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

document.addEventListener("DOMContentLoaded", async () => {
    initializeAdminUI();

    const clanName = localStorage.getItem("draftClan");
    if (!clanName) {
        alert("Aucun clan sélectionné.");
        window.location.href = "draft.html";
        return;
    }

    try {
        // Load player data
        const statsResponse = await fetch("nhl_filtered_stats.json");
        const statsData = await statsResponse.json();
        fullPlayerData = [...statsData.Top_50_Defenders, ...statsData.Top_100_Offensive_Players, ...statsData.Top_Rookies];
        goalieData = statsData.Top_50_Goalies;
        teamData = statsData.Teams;

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
                    totalGP += player.gamesPlayed || 0;
                    totalG += player.goals || 0;
                    totalA += player.assists || 0;
                    totalPTS += player.points || 0;

                    playerDetails.push({
                        name: player.skaterFullName,
                        position: player.positionCode || 'F',
                        gp: player.gamesPlayed || 0,
                        g: player.goals || 0,
                        a: player.assists || 0,
                        pts: player.points || 0,
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
                    totalGP += goalie.gamesPlayed || 0;
                    totalPTS += goalie.points || 0;

                    playerDetails.push({
                        name: goalie.goalieFullName,
                        position: 'G',
                        gp: goalie.gamesPlayed || 0,
                        g: goalie.wins || 0,
                        a: goalie.shutouts || 0,
                        pts: goalie.points || 0,
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
                    totalGP += nhlTeam.gamesPlayed || 0;
                    totalPTS += nhlTeam.points || 0;

                    playerDetails.push({
                        name: nhlTeam.teamFullName,
                        position: 'TEAM',
                        gp: nhlTeam.gamesPlayed || 0,
                        g: nhlTeam.wins || 0,
                        a: nhlTeam.losses || 0,
                        pts: nhlTeam.points || 0,
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

        // Get photo URL
        let photoUrl;
        if (player.type === 'team') {
            photoUrl = `https://assets.nhle.com/logos/nhl/svg/${player.teamAbbrev}_light.svg`;
        } else {
            photoUrl = `https://assets.nhle.com/mugs/nhl/20242025/${player.playerId}.png`;
        }

        // Get NHL team logo URL (small)
        const teamLogoUrl = player.teamAbbrev
            ? `https://assets.nhle.com/logos/nhl/svg/${player.teamAbbrev}_light.svg`
            : '';

        const playerCard = document.createElement('div');
        playerCard.className = 'player-card';
        playerCard.innerHTML = `
            <div class="pick-number">${pickNumber}</div>
            <div class="player-photo">
                <img src="${photoUrl}" alt="${player.name}" onerror="this.style.display='none'">
            </div>
            <div class="player-info">
                <div class="player-name-row">
                    <span class="player-name">${player.name}</span>
                    ${teamLogoUrl ? `<img src="${teamLogoUrl}" class="nhl-team-logo" alt="${player.teamAbbrev}">` : ''}
                    <span class="player-position">${player.position}</span>
                </div>
                <div class="player-stats-row">
                    <span>GP: ${player.gp}</span>
                    <span>G: ${player.g}</span>
                    <span>A: ${player.a}</span>
                    <span>PTS: ${player.pts}</span>
                </div>
            </div>
            <div class="player-points">
                <span class="today-points">+0</span>
                <span class="total-points">${player.pts}</span>
            </div>
        `;
        playerDetailsList.appendChild(playerCard);
    });

    // Show modal
    const modal = document.getElementById("playerDetailsModal");
    modal.classList.add('show');
}
