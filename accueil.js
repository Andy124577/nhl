const BASE_URL = window.location.hostname.includes('localhost') ? 'http://localhost:3000' : window.location.origin;

let userData = {
    username: null,
    userPools: [],
    hasH2H: false,
    hasCumulative: false,
    primaryPool: null
};

// ==================== INITIALIZATION ====================
async function loadDashboard() {
    await Promise.all([
        loadAllUserPools(),
        loadTodaysGames(),
        loadActivityFeed(),
        loadTopPerformers()
    ]);
}

// ==================== POOL LOADING ====================
async function loadAllUserPools() {
    const username = localStorage.getItem('username');
    if (!username) return;

    try {
        const response = await fetch(`${BASE_URL}/draft`, { cache: 'no-store' });
        const allPools = await response.json();

        userData.userPools = [];
        userData.hasH2H = false;
        userData.hasCumulative = false;

        Object.entries(allPools).forEach(([poolName, poolData]) => {
            const userTeam = Object.entries(poolData.teams || {}).find(([teamName, teamData]) =>
                teamData.members && teamData.members.includes(username)
            );

            if (userTeam) {
                const poolMode = poolData.poolMode || 'cumulative';
                const teamInfo = userTeam[1];

                // Check if draft is complete (has roster)
                const hasRoster = (teamInfo.offensive && teamInfo.offensive.length > 0) ||
                                 (teamInfo.defensive && teamInfo.defensive.length > 0) ||
                                 (teamInfo.goalie && teamInfo.goalie.length > 0);

                const isDraftComplete = poolData.draftComplete ||
                                       poolData.isDraftComplete ||
                                       poolData.draftStatus === 'completed' ||
                                       poolData.draftStatus === 'done' ||
                                       hasRoster;

                const pool = {
                    name: poolName,
                    data: poolData,
                    userTeam: userTeam[0],
                    userTeamData: teamInfo,
                    mode: poolMode,
                    isDraftComplete: isDraftComplete,
                    hasRoster: hasRoster
                };

                userData.userPools.push(pool);

                if (poolMode === 'head-to-head') userData.hasH2H = true;
                else userData.hasCumulative = true;
            }
        });

        // Set primary pool (prefer H2H with completed draft, then cumulative)
        const completedPools = userData.userPools.filter(p => p.isDraftComplete);
        userData.primaryPool = completedPools.find(p => p.mode === 'head-to-head') ||
                              completedPools[0] ||
                              userData.userPools[0] || null;

        updateHomeDisplay();
    } catch (error) {
        console.error('Error loading user pools:', error);
    }
}

// ==================== ADAPTIVE HOME DISPLAY ====================
function updateHomeDisplay() {
    // Hide skeletons
    const skeletons = ['activePoolSkeleton', 'scoreboardSkeleton', 'poolsOverviewSkeleton', 'alertsSkeleton'];
    skeletons.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // Show content
    ['activePoolContent', 'scoreboardContent', 'poolsOverviewContent', 'alertsContent'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'block';
    });

    if (userData.userPools.length === 0) {
        renderNoPoolsState();
        return;
    }

    // Render alerts (pending drafts, trade offers)
    renderAlerts();

    // Render primary pool section based on type
    if (userData.primaryPool && userData.primaryPool.mode === 'head-to-head' && userData.primaryPool.isDraftComplete) {
        renderH2HHome();
    } else if (userData.primaryPool && userData.primaryPool.isDraftComplete) {
        renderCumulativeHome();
    } else {
        renderPendingDraftHome();
    }

    // Render matchup section
    renderMatchupSection();

    // Render all pools overview at bottom
    renderPoolsOverview();
}

// ==================== NO POOLS STATE ====================
function renderNoPoolsState() {
    const activePoolContent = document.getElementById('activePoolContent');
    if (activePoolContent) {
        activePoolContent.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🏒</div>
                <h4>Bienvenue sur Fantazy!</h4>
                <p>Créez ou rejoignez un pool pour commencer votre aventure de fantasy hockey</p>
                <a href="pool.html" class="btn-primary">Gérer mes pools</a>
            </div>
        `;
    }

    // Hide matchup section
    const scoreboardContent = document.getElementById('scoreboardContent');
    if (scoreboardContent) {
        scoreboardContent.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📅</div>
                <h4>Aucun duel cette semaine</h4>
                <p>Rejoignez un pool Head-to-Head pour affronter d'autres joueurs</p>
                <a href="pool.html" class="btn-secondary">Rejoindre un pool</a>
            </div>
        `;
    }
}

// ==================== ALERTS ====================
function renderAlerts() {
    const alertsContent = document.getElementById('alertsContent');
    if (!alertsContent) return;

    let alertsHTML = '';

    // Check for pending drafts
    const pendingDrafts = userData.userPools.filter(p => !p.isDraftComplete);
    pendingDrafts.forEach(pool => {
        alertsHTML += `
            <div class="alert alert-warning" onclick="window.location.href='pool.html?tab=draft'">
                <span class="alert-icon">🎯</span>
                <span class="alert-message">Repêchage en attente pour "${pool.name}" - Cliquez pour y accéder</span>
            </div>
        `;
    });

    alertsContent.innerHTML = alertsHTML;
}

// ==================== H2H HOME (Mon Équipe) ====================
function renderH2HHome() {
    const pool = userData.primaryPool;
    const activePoolContent = document.getElementById('activePoolContent');
    if (!activePoolContent || !pool) return;

    const teamInfo = pool.userTeamData;
    const totalPlayers = (teamInfo.offensive?.length || 0) +
                        (teamInfo.defensive?.length || 0) +
                        (teamInfo.goalie?.length || 0) +
                        (teamInfo.rookie?.length || 0) +
                        (teamInfo.teams?.length || 0);

    activePoolContent.innerHTML = `
        <div class="pool-actif-card card">
            <div class="pool-header-gradient">
                <h3 class="pool-name-truncate" title="${pool.name}">Mon Équipe - ${pool.name}</h3>
                <div class="pool-meta">
                    <span>⚔️ Head-to-Head</span>
                    <span>📅 Semaine en cours</span>
                    <span><a href="classement.html" class="btn-secondary" style="padding: 6px 12px; font-size: 0.85rem;">Voir classement →</a></span>
                </div>
            </div>

            <div style="padding: 20px;">
                <div class="stats-grid">
                    <div class="stat-cell">
                        <div class="stat-cell-value">${totalPlayers}</div>
                        <div class="stat-cell-label">Joueurs</div>
                    </div>
                    <div class="stat-cell">
                        <div class="stat-cell-value">${teamInfo.offensive?.length || 0}</div>
                        <div class="stat-cell-label">ATT</div>
                    </div>
                    <div class="stat-cell">
                        <div class="stat-cell-value">${teamInfo.defensive?.length || 0}</div>
                        <div class="stat-cell-label">DÉF</div>
                    </div>
                    <div class="stat-cell">
                        <div class="stat-cell-value">${teamInfo.goalie?.length || 0}</div>
                        <div class="stat-cell-label">G</div>
                    </div>
                </div>

            <div style="display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto;">
                ${renderMiniRoster(teamInfo)}
            </div>
        </div>
    `;
}

function renderMiniRoster(teamInfo) {
    let html = '';
    const allPlayers = [
        ...(teamInfo.offensive || []).map(p => ({ name: p, type: 'ATT' })),
        ...(teamInfo.defensive || []).map(p => ({ name: p, type: 'DÉF' })),
        ...(teamInfo.goalie || []).map(p => ({ name: p, type: 'G' })),
        ...(teamInfo.rookie || []).map(p => ({ name: p, type: 'REC' })),
        ...(teamInfo.teams || []).map(p => ({ name: p, type: 'ÉQ' }))
    ];

    allPlayers.forEach(player => {
        const badgeClass = player.type === 'ATT' ? 'att' :
                          player.type === 'DÉF' ? 'def' :
                          player.type === 'G' ? 'g' : 'rec';
        html += `
            <div class="player-row">
                <span class="position-badge ${badgeClass}">${player.type}</span>
                <div class="player-info">
                    <span class="player-name">${player.name}</span>
                </div>
            </div>
        `;
    });

    return html || '<p style="color: #A8B5D1; text-align: center; padding: 10px;">Aucun joueur</p>';
}

// ==================== CUMULATIVE HOME ====================
function renderCumulativeHome() {
    const activePoolContent = document.getElementById('activePoolContent');
    if (!activePoolContent) return;

    if (userData.userPools.length === 0) return;

    const completedPools = userData.userPools.filter(p => p.isDraftComplete);

    activePoolContent.innerHTML = `
        <div style="padding: 20px;">
            <h3 style="margin: 0 0 20px 0; color: #192168; font-size: 20px;">Mes Pools (${completedPools.length})</h3>
            <div style="display: flex; flex-direction: column; gap: 16px;">
                ${completedPools.map(pool => {
                    const poolMode = pool.mode;
                    return `
                        <div style="background: rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 16px; border: 1px solid rgba(255, 255, 255, 0.1);">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                                <div>
                                    <h4 style="margin: 0 0 4px 0; color: #ff2e2e; font-size: 16px;">${pool.name}</h4>
                                    <p style="margin: 0; font-size: 13px; color: #8897B5;">
                                        ${poolMode === 'head-to-head' ? '⚔️ Head-to-Head' : '📊 Cumulatif'}
                                    </p>
                                </div>
                                <a href="classement.html" style="padding: 6px 12px; background: rgba(255, 46, 46, 0.2); color: #ff2e2e; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: bold; border: 1px solid rgba(255, 46, 46, 0.3);">Voir</a>
                            </div>
                            <div style="font-size: 14px; color: #192168;">
                                <strong>Votre équipe:</strong> ${pool.userTeam}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

// ==================== PENDING DRAFT HOME ====================
function renderPendingDraftHome() {
    const activePoolContent = document.getElementById('activePoolContent');
    if (!activePoolContent) return;

    const pool = userData.primaryPool;
    if (!pool) {
        renderNoPoolsState();
        return;
    }

    activePoolContent.innerHTML = `
        <div style="text-align: center; padding: 30px 20px;">
            <div style="font-size: 48px; margin-bottom: 16px;">🎯</div>
            <h3 style="margin: 0 0 8px 0; color: #192168;">Repêchage en attente</h3>
            <p style="margin: 0 0 8px 0; color: #ff2e2e; font-weight: 700; font-size: 1.1rem;">${pool.name}</p>
            <p style="margin: 0 0 20px 0; color: #5A6B8C;">Le repêchage de votre pool n'est pas encore terminé</p>
            <a href="pool.html?tab=draft" style="display: inline-block; padding: 12px 24px; background: #ff2e2e; color: #192168; text-decoration: none; border-radius: 8px; font-weight: bold;">Voir le repêchage</a>
        </div>
    `;
}

// ==================== MATCHUP SECTION ====================
function renderMatchupSection() {
    const scoreboardContent = document.getElementById('scoreboardContent');
    if (!scoreboardContent) return;

    // Find H2H pool with completed draft
    const h2hPool = userData.userPools.find(p => p.mode === 'head-to-head' && p.isDraftComplete);

    if (!h2hPool) {
        // No H2H pool - show cumulative standings preview
        const cumulativePool = userData.userPools.find(p => p.isDraftComplete);
        if (cumulativePool) {
            scoreboardContent.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📊</div>
                    <h4>Pool cumulatif</h4>
                    <p>Pas de duel hebdomadaire - Mode classement général</p>
                    <a href="classement.html" class="btn-secondary">Voir le classement complet</a>
                </div>
            `;
        } else {
            scoreboardContent.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🎯</div>
                    <h4>Repêchage en cours</h4>
                    <p>Complétez votre repêchage pour commencer à jouer</p>
                    <a href="pool.html?tab=draft" class="btn-secondary">Aller au repêchage</a>
                </div>
            `;
        }

        // Update the header label
        const scoreboardCard = document.querySelector('.scoreboard-card .card-header h2');
        if (scoreboardCard && !h2hPool) {
            scoreboardCard.textContent = 'Aperçu du classement';
        }
        // Hide LIVE indicator for non-H2H
        const liveIndicator = document.querySelector('.live-indicator');
        if (liveIndicator && !h2hPool) {
            liveIndicator.style.display = 'none';
        }
        return;
    }

    // H2H matchup display
    const h2hData = h2hPool.data.h2hData || {};
    const currentWeek = h2hData.currentWeek || 1;
    const schedule = h2hData.schedule || [];
    const weekMatchups = schedule[currentWeek - 1] || [];

    const username = localStorage.getItem('username');
    const userMatchup = weekMatchups.find(m =>
        m.team1 === h2hPool.userTeam || m.team2 === h2hPool.userTeam
    );

    if (userMatchup) {
        const isTeam1 = userMatchup.team1 === h2hPool.userTeam;
        const myTeam = isTeam1 ? userMatchup.team1 : userMatchup.team2;
        const oppTeam = isTeam1 ? userMatchup.team2 : userMatchup.team1;
        const myScore = isTeam1 ? (userMatchup.score1 || 0) : (userMatchup.score2 || 0);
        const oppScore = isTeam1 ? (userMatchup.score2 || 0) : (userMatchup.score1 || 0);
        const isWinning = myScore > oppScore;

        scoreboardContent.innerHTML = `
            <div class="matchup-display">
                <div class="matchup-team ${isWinning ? 'winning' : ''}">
                    <div class="team-name">${myTeam}</div>
                    <div class="team-score">${myScore}</div>
                </div>
                <div class="matchup-vs">VS</div>
                <div class="matchup-team ${!isWinning && oppScore > myScore ? 'winning' : ''}">
                    <div class="team-name">${oppTeam}</div>
                    <div class="team-score">${oppScore}</div>
                </div>
            </div>
            <div style="text-align: center; color: #8897B5; font-size: 0.85rem;">
                Semaine ${currentWeek}
            </div>
        `;
    } else {
        scoreboardContent.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📅</div>
                <h4>Aucun duel prévu cette semaine</h4>
                <p>Les matchups seront mis à jour chaque semaine</p>
            </div>
        `;
    }
}

// ==================== POOLS OVERVIEW ====================
function renderPoolsOverview() {
    const poolsContent = document.getElementById('allPoolsList');
    if (!poolsContent) return;

    if (userData.userPools.length === 0) {
        poolsContent.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🏒</div>
                <h4>Aucun pool actif</h4>
                <p>Créez ou rejoignez un pool pour commencer</p>
                <a href="pool.html" class="btn-secondary">Gérer les pools</a>
            </div>
        `;
        return;
    }

    poolsContent.innerHTML = userData.userPools.map(pool => {
        const poolMode = pool.mode;
        const totalPlayers = (pool.userTeamData.offensive?.length || 0) +
                            (pool.userTeamData.defensive?.length || 0) +
                            (pool.userTeamData.goalie?.length || 0) +
                            (pool.userTeamData.rookie?.length || 0) +
                            (pool.userTeamData.teams?.length || 0);

        return `
            <div class="pool-mini-card" onclick="window.location.href='classement.html'">
                <div class="pool-mini-header">
                    <h4>${pool.name}</h4>
                    <span class="pool-mini-badge">${poolMode === 'head-to-head' ? '⚔️ H2H' : '📊 Cumulatif'}</span>
                </div>
                <div class="pool-mini-stats">
                    <div class="mini-stat">
                        <span class="mini-stat-label">Votre équipe</span>
                        <span class="mini-stat-value">${pool.userTeam}</span>
                    </div>
                    <div class="mini-stat">
                        <span class="mini-stat-label">Joueurs</span>
                        <span class="mini-stat-value">${totalPlayers}</span>
                    </div>
                    <div class="mini-stat">
                        <span class="mini-stat-label">Statut</span>
                        <span class="mini-stat-value" style="color: ${pool.isDraftComplete ? '#4caf50' : '#ff9800'};">${pool.isDraftComplete ? 'Actif' : 'Repêchage'}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ==================== TODAY'S GAMES ====================
async function loadTodaysGames() {
    const skeleton = document.getElementById('gamesSkeleton');
    const content = document.getElementById('gamesContent');
    const gamesList = document.getElementById('todaysGamesList');

    try {
        const games = [];
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';

        document.getElementById('gamesCount').textContent = games.length;

        if (games.length === 0) {
            gamesList.innerHTML = '<p class="empty-message">Aucun match aujourd\'hui</p>';
        } else {
            gamesList.innerHTML = games.map(game => `
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
        gamesList.innerHTML = '<p class="empty-message">Aucun match aujourd\'hui</p>';
    }
}

// ==================== ACTIVITY FEED ====================
async function loadActivityFeed() {
    const skeleton = document.getElementById('activitySkeleton');
    const content = document.getElementById('activityContent');
    const feed = document.getElementById('activityFeed');

    try {
        const activities = [];
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';

        if (activities.length === 0) {
            feed.innerHTML = '<p class="empty-message">Aucune activité récente</p>';
        } else {
            feed.innerHTML = activities.map(a => `
                <div class="activity-item">
                    <span class="activity-icon">${a.icon}</span>
                    <div class="activity-content">
                        <span class="activity-text">${a.text}</span>
                        <span class="activity-time">${a.time}</span>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading activity:', error);
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';
        feed.innerHTML = '<p class="empty-message">Aucune activité récente</p>';
    }
}

// ==================== TOP PERFORMERS ====================
async function loadTopPerformers() {
    const skeleton = document.getElementById('performersSkeleton');
    const content = document.getElementById('performersContent');
    const list = document.getElementById('topPerformersList');

    try {
        const response = await fetch(`${BASE_URL}/stats`);
        const data = await response.json();
        const performers = [...(data.Top_Offensive || []), ...(data.Top_Rookies || [])]
            .sort((a, b) => (b.points || 0) - (a.points || 0))
            .slice(0, 5);

        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';

        if (performers.length === 0) {
            list.innerHTML = '<p class="empty-message">Aucune donnée</p>';
        } else {
            list.innerHTML = performers.map((p, i) => `
                <div class="performer-item" onclick="viewPlayer(${p.playerId})">
                    <div class="performer-rank">${i + 1}</div>
                    <div class="performer-info">
                        <div class="performer-name">${p.skaterFullName || p.firstName + ' ' + p.lastName}</div>
                        <div class="performer-team">${p.teamAbbrevs || 'N/A'}</div>
                    </div>
                    <div class="performer-stats">${p.points || 0} PTS</div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading performers:', error);
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';
        list.innerHTML = `
            <div class="error-state">
                <div class="error-icon">⚠️</div>
                <h4>Impossible de charger les données</h4>
                <button class="btn-retry" onclick="location.reload()">
                    <span>🔄</span>
                    <span>Réessayer</span>
                </button>
            </div>
        `;
    }
}

// ==================== UTILITY ====================
function viewPlayer(playerId) {
    if (playerId) {
        localStorage.setItem('viewPlayerId', playerId);
        window.location.href = 'index.html';
    }
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    userData.username = localStorage.getItem('username');
    loadDashboard();
});
