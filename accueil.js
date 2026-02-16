// Dashboard - Fantasy Pool Homepage

const BASE_URL = window.location.hostname.includes("localhost")
    ? "http://localhost:3000"
    : window.location.origin;

let userData = {
    username: null,
    userPools: []
};

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
    userData.username = localStorage.getItem("username");
    loadDashboard();
});

// Load all dashboard components
async function loadDashboard() {
    await Promise.all([
        loadAllUserPools(),
        loadTodaysGames(),
        loadActivityFeed(),
        loadTopPerformers()
    ]);
}

// Load all user pools
async function loadAllUserPools() {
    const username = localStorage.getItem("username");
    if (!username) {
        return;
    }

    try {
        const response = await fetch(`${BASE_URL}/draft`, { cache: "no-store" });
        const draftData = await response.json();

        // Find all pools where user is a member
        userData.userPools = [];
        Object.entries(draftData).forEach(([poolName, poolData]) => {
            const userTeam = Object.entries(poolData.teams || {}).find(
                ([teamName, teamData]) =>
                    teamData.members && teamData.members.includes(username)
            );
            if (userTeam) {
                userData.userPools.push({
                    name: poolName,
                    data: poolData,
                    userTeam: userTeam[0],
                    userTeamData: userTeam[1]
                });
            }
        });

        // Update dashboard with pool info
        updatePoolsDisplay();
    } catch (error) {
        console.error('Error loading user pools:', error);
    }
}

// Update pools display on dashboard
function updatePoolsDisplay() {
    const container = document.getElementById('activePoolContent') || document.querySelector('.dashboard-left .card.primary-card');

    if (!container) return;

    if (userData.userPools.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 20px;">
                <div style="font-size: 48px; margin-bottom: 16px;">📊</div>
                <h3 style="margin: 0 0 8px 0; color: #ffffff;">Aucun pool actif</h3>
                <p style="margin: 0 0 20px 0; color: rgba(255, 255, 255, 0.6);">Créez ou rejoignez un pool pour commencer</p>
                <a href="pool.html" style="display: inline-block; padding: 12px 24px; background: #ff2e2e; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Gérer mes pools</a>
            </div>
        `;
        return;
    }

    // Show summary of all pools
    container.innerHTML = `
        <div style="padding: 20px;">
            <h3 style="margin: 0 0 20px 0; color: #ffffff; font-size: 20px;">Mes Pools (${userData.userPools.length})</h3>
            <div style="display: flex; flex-direction: column; gap: 16px;">
                ${userData.userPools.map(pool => {
                    const poolMode = pool.data.poolMode || 'cumulative';
                    return `
                        <div style="background: rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 16px; border: 1px solid rgba(255, 255, 255, 0.1);">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                                <div>
                                    <h4 style="margin: 0 0 4px 0; color: #ff2e2e; font-size: 16px;">${pool.name}</h4>
                                    <p style="margin: 0; font-size: 13px; color: rgba(255, 255, 255, 0.5);">
                                        ${poolMode === 'head-to-head' ? '⚔️ Head-to-Head' : '📊 Cumulatif'}
                                    </p>
                                </div>
                                <a href="classement.html" style="padding: 6px 12px; background: rgba(255, 46, 46, 0.2); color: #ff2e2e; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: bold; border: 1px solid rgba(255, 46, 46, 0.3);">Voir</a>
                            </div>
                            <div style="font-size: 14px; color: rgba(255, 255, 255, 0.7);">
                                <strong>Votre équipe:</strong> ${pool.userTeam}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
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

// View player details
function viewPlayer(playerId) {
    if (!playerId) return;
    localStorage.setItem('viewPlayerId', playerId);
    window.location.href = 'index.html';
}
