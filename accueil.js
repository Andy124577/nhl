// Dashboard - Fantasy Pool Homepage

const BASE_URL = window.location.hostname.includes("localhost")
    ? "http://localhost:3000"
    : window.location.origin;

let userData = {
    username: null,
    activePools: [],
    activePool: null
};

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
    userData.username = localStorage.getItem("username");
    loadDashboard();
});

// Load all dashboard components
async function loadDashboard() {
    await Promise.all([
        loadActionAlerts(),
        loadActivePool(),
        loadTodaysGames(),
        loadLiveScoreboard(),
        loadActivityFeed(),
        loadTopPerformers(),
        loadAllPools()
    ]);
}

// Load action alerts (Zeigarnik Effect - incomplete tasks)
async function loadActionAlerts() {
    const skeleton = document.getElementById('alertsSkeleton');
    const content = document.getElementById('alertsContent');

    try {
        const alerts = [];
        const activePoolName = localStorage.getItem('activePool');

        if (!activePoolName) {
            alerts.push({
                type: 'warning',
                message: 'Sélectionnez un pool actif pour commencer',
                action: () => window.location.href = 'pool.html'
            });
        }

        // Check for draft status, pending trades, etc.
        // This would be populated from your backend

        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';

        if (alerts.length > 0) {
            content.innerHTML = alerts.map(alert => `
                <div class="alert alert-${alert.type}" onclick="${alert.action ? 'this.onclick = ' + alert.action : ''}">
                    <span class="alert-icon">⚠️</span>
                    <span class="alert-message">${alert.message}</span>
                </div>
            `).join('');
        } else {
            content.innerHTML = '';
            document.getElementById('actionAlerts').style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading alerts:', error);
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'none';
    }
}

// Load active pool info
async function loadActivePool() {
    const skeleton = document.getElementById('activePoolSkeleton');
    const content = document.getElementById('activePoolContent');

    try {
        const activePoolName = localStorage.getItem('activePool');

        if (!activePoolName) {
            if (skeleton) skeleton.style.display = 'none';
            if (content) content.style.display = 'block';
            return;
        }

        const response = await fetch(`${BASE_URL}/draft`, { cache: "no-store" });
        const draftData = await response.json();
        const pool = draftData[activePoolName];

        if (!pool) {
            if (skeleton) skeleton.style.display = 'none';
            if (content) content.style.display = 'block';
            return;
        }

        userData.activePool = pool;

        // Get user's team
        const userTeam = Object.entries(pool.teams).find(([teamName, team]) =>
            team.members.includes(userData.username)
        );

        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';

        document.getElementById('activePoolName').textContent = activePoolName;
        document.getElementById('activePoolMeta').textContent =
            `${pool.poolMode === 'head-to-head' ? 'Head-to-Head' : 'Cumulatif'} • ${Object.keys(pool.teams).length} équipes`;

        if (userTeam) {
            const [teamName, teamData] = userTeam;
            const allTeams = Object.entries(pool.teams)
                .map(([name, team]) => ({
                    name,
                    points: calculateTeamPoints(team, pool)
                }))
                .sort((a, b) => b.points - a.points);

            const rank = allTeams.findIndex(t => t.name === teamName) + 1;
            const userPoints = allTeams.find(t => t.name === teamName)?.points || 0;

            document.getElementById('activePoolStats').innerHTML = `
                <div class="stat-row">
                    <span class="stat-label">Votre équipe</span>
                    <span class="stat-value">${teamName}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Position</span>
                    <span class="stat-value highlight">#${rank}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Points</span>
                    <span class="stat-value highlight">${userPoints}</span>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading active pool:', error);
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';
    }
}

// Calculate team points
function calculateTeamPoints(team, pool) {
    // Simplified calculation - adjust based on your actual scoring
    let totalPoints = 0;

    const allPlayers = [
        ...(team.offensive || []),
        ...(team.defensive || []),
        ...(team.rookie || [])
    ];

    // This should use actual player stats from your data
    allPlayers.forEach(playerName => {
        totalPoints += Math.floor(Math.random() * 50); // Placeholder
    });

    return totalPoints;
}

// Load today's NHL games
async function loadTodaysGames() {
    const skeleton = document.getElementById('gamesSkeleton');
    const content = document.getElementById('gamesContent');
    const container = document.getElementById('todaysGamesList');

    try {
        // This would fetch from NHL API or your backend
        const todaysGames = [
            // Placeholder data
        ];

        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';

        document.getElementById('gamesCount').textContent = todaysGames.length;

        if (todaysGames.length === 0) {
            container.innerHTML = '<p class="empty-message">Aucun match aujourd\'hui</p>';
        } else {
            container.innerHTML = todaysGames.map(game => `
                <div class="game-item">
                    <div class="game-teams">
                        <span class="team">${game.awayTeam}</span>
                        <span class="vs">@</span>
                        <span class="team">${game.homeTeam}</span>
                    </div>
                    <div class="game-time">${game.time}</div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading games:', error);
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';
        container.innerHTML = '<p class="empty-message">Aucun match aujourd\'hui</p>';
    }
}

// Load live H2H scoreboard
async function loadLiveScoreboard() {
    const skeleton = document.getElementById('scoreboardSkeleton');
    const content = document.getElementById('scoreboardContent');
    const matchupDisplay = document.getElementById('matchupDisplay');
    const matchupStats = document.getElementById('matchupStats');

    try {
        const activePoolName = localStorage.getItem('activePool');

        if (!activePoolName || !userData.activePool) {
            if (skeleton) skeleton.style.display = 'none';
            if (content) content.style.display = 'block';
            matchupDisplay.innerHTML = '<p class="empty-message">Sélectionnez un pool actif</p>';
            matchupStats.innerHTML = '';
            return;
        }

        const pool = userData.activePool;

        if (pool.poolMode === 'head-to-head') {
            // Get current week's matchup
            const h2hData = pool.h2hData;
            if (h2hData && h2hData.matchups) {
                const currentWeek = h2hData.currentWeek || 1;
                const currentMatchups = h2hData.matchups[currentWeek - 1] || [];

                // Find user's matchup
                const userMatchup = currentMatchups.find(m =>
                    (pool.teams[m.team1]?.members.includes(userData.username)) ||
                    (pool.teams[m.team2]?.members.includes(userData.username))
                );

                if (userMatchup) {
                    const team1Points = calculateTeamPoints(pool.teams[userMatchup.team1], pool);
                    const team2Points = calculateTeamPoints(pool.teams[userMatchup.team2], pool);

                    matchupDisplay.innerHTML = `
                        <div class="matchup-display">
                            <div class="matchup-team ${team1Points > team2Points ? 'winning' : ''}">
                                <div class="team-name">${userMatchup.team1}</div>
                                <div class="team-score">${team1Points}</div>
                            </div>
                            <div class="matchup-vs">VS</div>
                            <div class="matchup-team ${team2Points > team1Points ? 'winning' : ''}">
                                <div class="team-name">${userMatchup.team2}</div>
                                <div class="team-score">${team2Points}</div>
                            </div>
                        </div>
                    `;

                    matchupStats.innerHTML = `
                        <div class="stats-breakdown">
                            <div class="stat-category">
                                <span>Buts</span>
                                <span class="stat-numbers">12 - 15</span>
                            </div>
                            <div class="stat-category">
                                <span>Passes</span>
                                <span class="stat-numbers">18 - 16</span>
                            </div>
                            <div class="stat-category">
                                <span>Points</span>
                                <span class="stat-numbers">30 - 31</span>
                            </div>
                        </div>
                    `;
                } else {
                    matchupDisplay.innerHTML = '<p class="empty-message">Pas de duel cette semaine</p>';
                    matchupStats.innerHTML = '';
                }
            } else {
                matchupDisplay.innerHTML = '<p class="empty-message">Pas de duel cette semaine</p>';
                matchupStats.innerHTML = '';
            }
        } else {
            // Cumulative mode - show standings
            const allTeams = Object.entries(pool.teams)
                .map(([name, team]) => ({
                    name,
                    points: calculateTeamPoints(team, pool)
                }))
                .sort((a, b) => b.points - a.points)
                .slice(0, 3);

            matchupDisplay.innerHTML = `
                <div class="standings-preview">
                    <h4>Top 3</h4>
                    ${allTeams.map((team, idx) => `
                        <div class="standing-item">
                            <span class="rank">${idx + 1}</span>
                            <span class="team-name">${team.name}</span>
                            <span class="points">${team.points} pts</span>
                        </div>
                    `).join('')}
                </div>
            `;
            matchupStats.innerHTML = '';
        }

        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';
    } catch (error) {
        console.error('Error loading scoreboard:', error);
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';
        matchupDisplay.innerHTML = '<p class="empty-message">Erreur de chargement</p>';
        matchupStats.innerHTML = '';
    }
}

// Load activity feed
async function loadActivityFeed() {
    const skeleton = document.getElementById('activitySkeleton');
    const content = document.getElementById('activityContent');
    const container = document.getElementById('activityFeed');

    try {
        // This would come from your backend
        const activities = [
            // Placeholder - would include trades, waiver pickups, etc.
        ];

        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';

        if (activities.length === 0) {
            container.innerHTML = '<p class="empty-message">Aucune activité récente</p>';
        } else {
            container.innerHTML = activities.map(activity => `
                <div class="activity-item">
                    <span class="activity-icon">${activity.icon}</span>
                    <div class="activity-content">
                        <span class="activity-text">${activity.text}</span>
                        <span class="activity-time">${activity.time}</span>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading activity:', error);
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';
        container.innerHTML = '<p class="empty-message">Aucune activité récente</p>';
    }
}

// Load top performers
async function loadTopPerformers() {
    const skeleton = document.getElementById('performersSkeleton');
    const content = document.getElementById('performersContent');
    const container = document.getElementById('topPerformersList');

    try {
        const response = await fetch(`${BASE_URL}/stats`);
        const stats = await response.json();

        const topPlayers = [...(stats.Top_Offensive || []), ...(stats.Top_Rookies || [])]
            .sort((a, b) => (b.points || 0) - (a.points || 0))
            .slice(0, 5);

        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';

        if (topPlayers.length === 0) {
            container.innerHTML = '<p class="empty-message">Aucune donnée</p>';
        } else {
            container.innerHTML = topPlayers.map((player, idx) => `
                <div class="performer-item" onclick="viewPlayer(${player.playerId})">
                    <div class="performer-rank">${idx + 1}</div>
                    <div class="performer-info">
                        <div class="performer-name">${player.skaterFullName || player.firstName + ' ' + player.lastName}</div>
                        <div class="performer-team">${player.teamAbbrevs || 'N/A'}</div>
                    </div>
                    <div class="performer-stats">${player.points || 0} PTS</div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading performers:', error);
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';
        container.innerHTML = '<p class="empty-message">Erreur de chargement</p>';
    }
}

// Load all pools overview
async function loadAllPools() {
    const skeleton = document.getElementById('poolsOverviewSkeleton');
    const content = document.getElementById('poolsOverviewContent');
    const container = document.getElementById('allPoolsList');

    try {
        const response = await fetch(`${BASE_URL}/draft`, { cache: "no-store" });
        const draftData = await response.json();

        const userPools = Object.entries(draftData).filter(([poolName, pool]) => {
            return Object.values(pool.teams).some(team => team.members.includes(userData.username));
        });

        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';

        if (userPools.length === 0) {
            container.innerHTML = '<p class="empty-message">Aucun pool. <a href="pool.html">Créez-en un!</a></p>';
        } else {
            container.innerHTML = userPools.map(([poolName, pool]) => {
                const userTeam = Object.entries(pool.teams).find(([teamName, team]) =>
                    team.members.includes(userData.username)
                );

                if (!userTeam) return '';

                const [teamName, teamData] = userTeam;
                const allTeams = Object.entries(pool.teams)
                    .map(([name, team]) => ({
                        name,
                        points: calculateTeamPoints(team, pool)
                    }))
                    .sort((a, b) => b.points - a.points);

                const rank = allTeams.findIndex(t => t.name === teamName) + 1;

                return `
                    <div class="pool-mini-card" onclick="selectPool('${poolName}')">
                        <div class="pool-mini-header">
                            <h4>${poolName}</h4>
                            <span class="pool-mini-badge">${pool.poolMode === 'head-to-head' ? 'H2H' : 'Cumul'}</span>
                        </div>
                        <div class="pool-mini-stats">
                            <div class="mini-stat">
                                <span class="mini-stat-label">Position</span>
                                <span class="mini-stat-value">#${rank}</span>
                            </div>
                            <div class="mini-stat">
                                <span class="mini-stat-label">Équipe</span>
                                <span class="mini-stat-value">${teamName}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (error) {
        console.error('Error loading pools:', error);
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';
        container.innerHTML = '<p class="empty-message">Erreur de chargement</p>';
    }
}

// Select a pool
function selectPool(poolName) {
    localStorage.setItem('activePool', poolName);
    window.location.reload();
}

// View player details
function viewPlayer(playerId) {
    if (!playerId) return;
    localStorage.setItem('viewPlayerId', playerId);
    window.location.href = 'index.html';
}
