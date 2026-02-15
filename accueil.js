// Accueil page - Challenge your friends

const BASE_URL = window.location.hostname.includes("localhost")
    ? "http://localhost:3000"
    : window.location.origin;

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    loadActivePools();
    loadLeaderboard();
});

// Load active pools for the current user
async function loadActivePools() {
    try {
        const username = localStorage.getItem("username");
        if (!username) {
            showNoActivePools();
            return;
        }

        const response = await fetch(`${BASE_URL}/draft`, { cache: "no-store" });
        if (!response.ok) throw new Error('Failed to fetch pools');

        const draftData = await response.json();

        // Hide skeleton and show content
        const skeleton = document.getElementById('activePoolsSkeleton');
        const content = document.getElementById('activePoolsContent');
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';

        // Filter pools where user is a member
        const userPools = Object.entries(draftData).filter(([poolName, pool]) => {
            return Object.values(pool.teams).some(team => team.members.includes(username));
        });

        if (userPools.length === 0) {
            showNoActivePools();
            return;
        }

        displayActivePools(userPools);

    } catch (error) {
        console.error('Error loading active pools:', error);
        showNoActivePools();
    }
}

// Display active pools
function displayActivePools(pools) {
    const container = document.getElementById('activePoolsList');
    const emptyState = document.getElementById('noActivePools');

    if (emptyState) emptyState.style.display = 'none';

    const username = localStorage.getItem("username");

    container.innerHTML = pools.map(([poolName, pool]) => {
        // Get user's team
        const userTeam = Object.entries(pool.teams).find(([teamName, team]) =>
            team.members.includes(username)
        );

        if (!userTeam) return '';

        const [userTeamName, userTeamData] = userTeam;

        // Calculate total points for user's team
        const totalPoints = calculateTeamPoints(userTeamData);

        // Get all teams sorted by points
        const allTeams = Object.entries(pool.teams)
            .map(([name, team]) => ({
                name,
                points: calculateTeamPoints(team)
            }))
            .sort((a, b) => b.points - a.points);

        const userRank = allTeams.findIndex(t => t.name === userTeamName) + 1;
        const totalTeams = allTeams.length;

        return `
            <div class="pool-card" onclick="viewPool('${poolName}')">
                <div class="pool-card-header">
                    <h3>${poolName}</h3>
                    <span class="pool-mode-badge">${pool.poolMode === 'head-to-head' ? 'H2H' : 'Cumulatif'}</span>
                </div>
                <div class="pool-card-body">
                    <div class="pool-stat">
                        <span class="stat-label">Votre équipe</span>
                        <span class="stat-value">${userTeamName}</span>
                    </div>
                    <div class="pool-stat">
                        <span class="stat-label">Position</span>
                        <span class="stat-value ranking">${userRank}/${totalTeams}</span>
                    </div>
                    <div class="pool-stat">
                        <span class="stat-label">Points</span>
                        <span class="stat-value points">${totalPoints}</span>
                    </div>
                </div>
                <div class="pool-card-footer">
                    <button class="btn-link" onclick="event.stopPropagation(); viewClassement('${poolName}')">Voir le classement</button>
                </div>
            </div>
        `;
    }).join('');
}

// Calculate team points
function calculateTeamPoints(team) {
    // This is a simplified calculation - you may need to adjust based on your actual scoring
    let totalPoints = 0;

    // Add skater points
    if (team.offensive) totalPoints += team.offensive.length * 10;
    if (team.defensive) totalPoints += team.defensive.length * 8;
    if (team.rookie) totalPoints += team.rookie.length * 5;

    return totalPoints;
}

// Show no active pools state
function showNoActivePools() {
    const skeleton = document.getElementById('activePoolsSkeleton');
    const content = document.getElementById('activePoolsContent');
    const list = document.getElementById('activePoolsList');
    const emptyState = document.getElementById('noActivePools');

    if (skeleton) skeleton.style.display = 'none';
    if (content) content.style.display = 'block';
    if (list) list.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
}

// View pool (redirect to pool page)
function viewPool(poolName) {
    localStorage.setItem('activePool', poolName);
    window.location.href = 'pool.html?tab=mypools';
}

// View classement (redirect to classement page)
function viewClassement(poolName) {
    localStorage.setItem('activePool', poolName);
    window.location.href = 'classement.html';
}

// Load global leaderboard
async function loadLeaderboard() {
    try {
        const response = await fetch(`${BASE_URL}/stats`);
        if (!response.ok) throw new Error('Failed to fetch leaderboard');

        const stats = await response.json();

        // Hide skeleton and show content
        const skeleton = document.getElementById('leaderboardSkeleton');
        const content = document.getElementById('leaderboardContent');
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';

        displayLeaderboard(stats);

    } catch (error) {
        console.error('Error loading leaderboard:', error);
        showLeaderboardError();
    }
}

// Display leaderboard
function displayLeaderboard(stats) {
    const container = document.getElementById('leaderboardList');

    // Get top 5 skaters by points
    const topPlayers = [...(stats.Top_Offensive || []), ...(stats.Top_Rookies || [])]
        .sort((a, b) => (b.points || 0) - (a.points || 0))
        .slice(0, 5);

    if (topPlayers.length === 0) {
        container.innerHTML = '<p class="empty-message">Aucune donnée disponible</p>';
        return;
    }

    container.innerHTML = topPlayers.map((player, index) => `
        <div class="leaderboard-item" onclick="viewPlayer(${player.playerId})">
            <div class="leaderboard-rank ${index < 3 ? 'top-three' : ''}">${index + 1}</div>
            <div class="leaderboard-player">
                <div class="player-name">${player.skaterFullName || player.firstName + ' ' + player.lastName}</div>
                <div class="player-team">${player.teamAbbrevs || 'N/A'} • ${player.positionCode || 'F'}</div>
            </div>
            <div class="leaderboard-stats">
                <span class="stat-highlight">${player.points || 0} PTS</span>
            </div>
        </div>
    `).join('');
}

// Show leaderboard error
function showLeaderboardError() {
    const skeleton = document.getElementById('leaderboardSkeleton');
    const content = document.getElementById('leaderboardContent');
    const list = document.getElementById('leaderboardList');

    if (skeleton) skeleton.style.display = 'none';
    if (content) content.style.display = 'block';
    if (list) list.innerHTML = '<p class="empty-message">Erreur de chargement</p>';
}

// View player details
function viewPlayer(playerId) {
    if (!playerId) return;
    localStorage.setItem('viewPlayerId', playerId);
    window.location.href = 'index.html';
}
