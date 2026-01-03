let fullPlayerData = [];
let goalieData = [];
let teamData = [];
let imageList = [];
let currentStats = null;
let currentTeams = null;
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

// Helper function to get current team standings
function getCurrentTeamStats(teamFullName) {
    if (!currentTeams || !currentTeams.teams) {
        return null;
    }

    // Try to find by full name
    return currentTeams.teams.find(t => t.teamFullName === teamFullName);
}

document.addEventListener("DOMContentLoaded", async () => {
    initializeAdminUI();

    // Load static data first
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

    // Load current team standings from API
    try {
        const currentTeamsResponse = await fetch(`${BASE_URL}/current-teams`, { cache: "no-store" });
        currentTeams = await currentTeamsResponse.json();
        console.log(`✅ Current team standings loaded: ${currentTeams.teams.length} teams, last updated: ${currentTeams.lastUpdated}`);
    } catch (error) {
        console.warn("⚠️ Could not load current team standings, using cached data:", error);
    }

    // Listen for active pool changes
    $(document).on('activePoolChanged', async (event, poolName) => {
        await loadClassementForPool(poolName);
    });

    // Load classement for initially selected pool
    const activePool = getActivePool();
    if (activePool) {
        await loadClassementForPool(activePool);
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

// Load classement for a specific pool
async function loadClassementForPool(poolName) {
    if (!poolName) {
        // Show empty state
        document.getElementById("noPoolSelected").style.display = "block";
        document.getElementById("cumulativeContent").style.display = "none";
        document.getElementById("h2hContent").style.display = "none";
        document.getElementById("poolNameDisplay").textContent = "Sélectionnez un pool actif pour voir le classement";
        return;
    }

    try {
        // Load draft data
        const draftResponse = await fetch(`${BASE_URL}/draft`, { cache: "no-store" });
        const draftData = await draftResponse.json();
        const clan = draftData[poolName];

        if (!clan) {
            document.getElementById("noPoolSelected").style.display = "block";
            document.getElementById("cumulativeContent").style.display = "none";
            document.getElementById("h2hContent").style.display = "none";
            document.getElementById("poolNameDisplay").textContent = "Pool introuvable";
            return;
        }

        // Hide empty state
        document.getElementById("noPoolSelected").style.display = "none";
        document.getElementById("poolNameDisplay").textContent = `Classement du pool : ${poolName}`;

        // Display based on pool mode
        const poolMode = clan.poolMode || 'cumulative';

        if (poolMode === 'head-to-head') {
            // Show H2H interface
            document.getElementById("cumulativeContent").style.display = "none";
            document.getElementById("h2hContent").style.display = "block";
            renderH2HInterface(clan, poolName);
        } else {
            // Show cumulative interface (default)
            document.getElementById("h2hContent").style.display = "none";
            document.getElementById("cumulativeContent").style.display = "block";
            renderTeamStatsTable(clan.teams);
        }

    } catch (error) {
        console.error("Erreur lors du chargement du classement:", error);
        document.getElementById("noPoolSelected").style.display = "block";
        document.getElementById("cumulativeContent").style.display = "none";
        document.getElementById("h2hContent").style.display = "none";
        document.getElementById("poolNameDisplay").textContent = "Erreur lors du chargement";
    }
}

// Head-to-Head Tab Switching
function showH2HTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.h2h-tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    // Remove active class from all buttons
    document.querySelectorAll('#h2hContent .sub-nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected tab
    document.getElementById(`${tabName}-h2h-tab`).classList.add('active');

    // Add active class to clicked button
    event.target.classList.add('active');
}

// Render H2H Interface
function renderH2HInterface(clan, poolName) {
    const h2hData = clan.h2hData;

    if (!h2hData) {
        document.getElementById("currentMatchupsList").innerHTML = '<p class="empty-state">Données Head-to-Head non disponibles</p>';
        return;
    }

    // Render current matchups
    renderCurrentMatchups(h2hData, clan.teams);

    // Render standings
    renderH2HStandings(h2hData.standings, clan.teams);

    // Render history
    renderMatchupHistory(h2hData.matchupHistory || []);
}

// Render current week matchups
function renderCurrentMatchups(h2hData, teams) {
    const currentWeek = h2hData.currentWeek || 1;
    const matchups = h2hData.matchups && h2hData.matchups[currentWeek - 1] ? h2hData.matchups[currentWeek - 1] : [];

    document.getElementById("currentWeekTitle").textContent = `Semaine ${currentWeek}`;

    const container = document.getElementById("currentMatchupsList");

    if (matchups.length === 0) {
        container.innerHTML = '<p class="empty-state">Aucun duel pour cette semaine</p>';
        return;
    }

    container.innerHTML = matchups.map(matchup => {
        const team1Points = calculateTeamPoints(teams[matchup.team1]);
        const team2Points = calculateTeamPoints(teams[matchup.team2]);

        const team1Leading = team1Points > team2Points;
        const team2Leading = team2Points > team1Points;

        return `
            <div class="matchup-card">
                <div class="matchup-team ${team1Leading ? 'leading' : ''}">
                    <div class="team-name">${matchup.team1}</div>
                    <div class="team-score">${team1Points}</div>
                </div>
                <div class="matchup-vs">VS</div>
                <div class="matchup-team ${team2Leading ? 'leading' : ''}">
                    <div class="team-name">${matchup.team2}</div>
                    <div class="team-score">${team2Points}</div>
                </div>
            </div>
        `;
    }).join('');
}

// Render H2H Standings
function renderH2HStandings(standings, teams) {
    const tbody = document.getElementById("h2hStandingsBody");
    tbody.innerHTML = "";

    if (!standings || Object.keys(standings).length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Aucune donnée de classement</td></tr>';
        return;
    }

    // Convert to array and calculate player details for each team
    const standingsArray = Object.entries(standings).map(([teamName, stats]) => {
        const team = teams[teamName];
        let playerDetails = [];

        if (team) {
            // Calculate player details for this team (same logic as renderTeamStatsTable)
            const allPlayers = [
                ...(team.offensive || []),
                ...(team.defensive || []),
                ...(team.rookie || [])
            ];

            // Add skaters
            allPlayers.forEach(playerName => {
                const player = fullPlayerData.find(p => p.skaterFullName === playerName);
                if (player) {
                    const currentPlayerStats = getCurrentPlayerStats(playerName, player.playerId);

                    const gp = currentPlayerStats?.gamesPlayed ?? player.gamesPlayed ?? 0;
                    const g = currentPlayerStats?.goals ?? player.goals ?? 0;
                    const a = currentPlayerStats?.assists ?? player.assists ?? 0;
                    const pts = currentPlayerStats?.points ?? player.points ?? 0;
                    const todayPts = currentPlayerStats?.todayPoints ?? 0;

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
                    const currentGoalieStats = getCurrentPlayerStats(goalieName, goalie.playerId);

                    const gp = currentGoalieStats?.gamesPlayed ?? goalie.gamesPlayed ?? 0;

                    let pts, wins, shutouts, otl;
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
                    const currentTeamStats = getCurrentTeamStats(teamName, nhlTeam.teamId);

                    const gp = currentTeamStats?.gamesPlayed ?? nhlTeam.gamesPlayed ?? 0;
                    const wins = currentTeamStats?.wins ?? nhlTeam.wins ?? 0;
                    const otl = currentTeamStats?.otLosses ?? nhlTeam.otLosses ?? 0;
                    const pts = currentTeamStats?.points ?? nhlTeam.points ?? ((wins * 2) + otl);

                    playerDetails.push({
                        name: nhlTeam.teamFullName,
                        position: 'TEAM',
                        gp: gp,
                        g: wins,
                        a: otl,
                        pts: pts,
                        todayPoints: 0,
                        teamAbbrev: currentTeamStats?.teamAbbrev || nhlTeam.teamAbbrevs,
                        type: 'team'
                    });
                }
            });
        }

        return {
            teamName,
            ...stats,
            diff: stats.pointsFor - stats.pointsAgainst,
            playerDetails
        };
    }).sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.diff - a.diff;
    });

    // Render rows
    standingsArray.forEach((team, index) => {
        const position = index + 1;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${position}</td>
            <td class="team-name-col"><span class="team-name" onclick="showPlayerDetails('${team.teamName}', ${index})">${team.teamName}</span></td>
            <td>${team.wins}</td>
            <td>${team.losses}</td>
            <td>${team.ties || 0}</td>
            <td>${team.pointsFor}</td>
            <td>${team.pointsAgainst}</td>
            <td class="${team.diff > 0 ? 'positive' : team.diff < 0 ? 'negative' : ''}">${team.diff > 0 ? '+' : ''}${team.diff}</td>
        `;

        // Store player details on the row for later access
        row.dataset.playerDetails = JSON.stringify(team.playerDetails);
        row.dataset.teamName = team.teamName;

        tbody.appendChild(row);
    });
}

// Render Matchup History
function renderMatchupHistory(history) {
    const container = document.getElementById("matchupHistoryList");

    if (!history || history.length === 0) {
        container.innerHTML = '<p class="empty-state">Aucun historique de duels</p>';
        return;
    }

    container.innerHTML = history.reverse().map(week => `
        <div class="week-history-card">
            <h4>Semaine ${week.weekNumber}</h4>
            <div class="week-matchups">
                ${week.matchups.map(matchup => `
                    <div class="history-matchup ${matchup.winner ? 'completed' : 'in-progress'}">
                        <div class="history-team ${matchup.winner === matchup.team1 ? 'winner' : ''}">
                            <span class="team-name">${matchup.team1}</span>
                            <span class="team-score">${matchup.team1Points || 0}</span>
                        </div>
                        <div class="history-vs">vs</div>
                        <div class="history-team ${matchup.winner === matchup.team2 ? 'winner' : ''}">
                            <span class="team-name">${matchup.team2}</span>
                            <span class="team-score">${matchup.team2Points || 0}</span>
                        </div>
                        ${matchup.winner && matchup.winner !== 'tie' ? `<div class="winner-badge">🏆</div>` : ''}
                        ${matchup.winner === 'tie' ? `<div class="tie-badge">🤝 Égalité</div>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

// Helper: Calculate total points for a team
function calculateTeamPoints(teamData) {
    if (!teamData) return 0;

    let totalPoints = 0;

    // Sum all player points
    ['offensive', 'defensive', 'rookie'].forEach(position => {
        if (teamData[position]) {
            teamData[position].forEach(playerName => {
                const player = fullPlayerData.find(p => p.skaterFullName === playerName);
                if (player) {
                    const currentPlayerStats = getCurrentPlayerStats(playerName, player.playerId);
                    totalPoints += currentPlayerStats?.points ?? player.points ?? 0;
                }
            });
        }
    });

    // Add goalie stats if applicable
    if (teamData.goalies) {
        teamData.goalies.forEach(goalieName => {
            const goalie = goalieData.find(g => g.goalieFullName === goalieName);
            if (goalie) {
                // For goalies, we can use wins or saves as points
                // For now, let's use wins * 2
                const currentGoalieStats = getCurrentPlayerStats(goalieName, goalie.playerId);
                const wins = currentGoalieStats?.wins ?? goalie.wins ?? 0;
                totalPoints += wins * 2;
            }
        });
    }

    return totalPoints;
}

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
                    // Try to get current team standings
                    const currentTeamStats = getCurrentTeamStats(teamName);

                    let gp, wins, otl, pts;

                    if (currentTeamStats) {
                        // Use current season standings
                        gp = currentTeamStats.gamesPlayed || 0;
                        wins = currentTeamStats.wins || 0;
                        otl = currentTeamStats.otLosses || 0;
                        pts = currentTeamStats.points || ((wins * 2) + (otl * 1));
                    } else {
                        // Fallback to cached data
                        gp = nhlTeam.gamesPlayed || 0;
                        wins = nhlTeam.wins || 0;
                        otl = nhlTeam.otLosses || 0;
                        pts = (wins * 2) + (otl * 1);
                    }

                    totalGP += gp;
                    totalPTS += pts;

                    playerDetails.push({
                        name: teamName,
                        position: 'TEAM',
                        gp: gp,
                        g: wins,
                        a: otl,
                        pts: pts,
                        todayPoints: 0, // Teams don't have daily updates
                        teamAbbrev: currentTeamStats?.teamAbbrev || nhlTeam.teamAbbrevs,
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
    // Try to find the row in cumulative standings first, then in H2H standings
    let tbody = document.getElementById("teamStatsBody");
    let row = tbody ? tbody.rows[rowIndex] : null;

    // If row not found in cumulative table, try H2H table
    if (!row || !row.dataset.playerDetails) {
        tbody = document.getElementById("h2hStandingsBody");
        row = tbody ? tbody.rows[rowIndex] : null;
    }

    if (!row || !row.dataset.playerDetails) {
        console.error("Could not find team data");
        return;
    }

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
                <div>
                    <span class="today-points">${player.todayPoints > 0 ? '+' : ''}${player.todayPoints || 0}</span>
                    <span class="today-label">Today</span>
                </div>
                <div>
                    <span class="total-points">${player.pts}</span>
                    <span class="pts-label">PTS</span>
                </div>
            </div>
        `;
        playerDetailsList.appendChild(playerCard);
    });

    // Show modal
    const modal = document.getElementById("playerDetailsModal");
    modal.classList.add('show');
}
