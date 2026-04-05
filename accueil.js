/* ============================================================ */
/* ACCUEIL — Home page JS                                       */
/* ============================================================ */

const BASE_URL = window.location.hostname.includes('localhost')
    ? 'http://localhost:3000'
    : window.location.origin;

let userData = {
    username: null,
    userPools: [],
    primaryPool: null,
    statsData: null,
    hotPlayers: null
};

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    userData.username = localStorage.getItem('username');

    // Adapt hero CTAs for logged-out visitors
    if (!userData.username) {
        const actions = document.querySelector('.hero-actions');
        if (actions) {
            actions.innerHTML = `
                <a href="signup.html" class="btn-hero-primary">🚀 Commencer gratuitement</a>
                <a href="login.html" class="btn-hero-secondary">Se connecter →</a>
                <button onclick="scrollToHowItWorks()" class="btn-hero-tertiary">Comment ça marche ?</button>
            `;
        }
    }

    // Show quick-nav pills if logged in
    if (userData.username) {
        const nav = document.getElementById('heroQuickNav');
        if (nav) nav.style.display = 'flex';
    }

    // Fetch pools and stats in parallel
    await Promise.all([loadPools(), loadCurrentStats(), loadStats()]);

    // Render all sections
    renderHeroLeaderboard();
});

// ============================================================
// POOL LOADING
// ============================================================
async function loadPools() {
    if (!userData.username) return;

    try {
        const res = await fetch(`${BASE_URL}/draft`, { cache: 'no-store' });
        const allPools = await res.json();

        userData.userPools = [];

        Object.entries(allPools).forEach(([poolName, poolData]) => {
            const userTeamEntry = Object.entries(poolData.teams || {}).find(
                ([, td]) => td.members && td.members.includes(userData.username)
            );
            if (!userTeamEntry) return;

            const [userTeamName, userTeamData] = userTeamEntry;
            const hasRoster = (userTeamData.offensive?.length || 0) +
                              (userTeamData.defensive?.length || 0) +
                              (userTeamData.goalie?.length || 0) > 0;

            const isDraftComplete =
                poolData.draftComplete || poolData.isDraftComplete ||
                poolData.draftStatus === 'completed' || poolData.draftStatus === 'done' ||
                hasRoster;

            userData.userPools.push({
                name: poolName,
                data: poolData,
                userTeam: userTeamName,
                userTeamData,
                mode: poolData.poolMode || 'cumulative',
                isDraftComplete,
                allTeams: poolData.teams || {}
            });
        });

        // Primary pool: prefer H2H with completed draft
        const completed = userData.userPools.filter(p => p.isDraftComplete);
        userData.primaryPool =
            completed.find(p => p.mode === 'head-to-head') ||
            completed[0] ||
            userData.userPools[0] ||
            null;

    } catch (err) {
        console.error('Error loading pools:', err);
    }
}

// ============================================================
// CURRENT STATS LOADING (for leaderboard)
// ============================================================
async function loadCurrentStats() {
    try {
        const res = await fetch(`${BASE_URL}/current-stats`, { cache: 'no-store' });
        userData.statsData = await res.json();
    } catch (err) {
        console.warn('Could not load current stats:', err);
    }
}

// ============================================================
// STATS LOADING (hot players)
// ============================================================
let currentTimeRange = 7; // Default to 7 days

async function loadStats(days = 7) {
    try {
        currentTimeRange = days;

        const hotPlayersRes = await fetch(`${BASE_URL}/hot-players-last${days}days`);
        userData.hotPlayers = await hotPlayersRes.json();

        // Update active button and label to reflect actual range shown
        document.querySelectorAll('.time-filter').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.days == currentTimeRange);
        });
        const label = document.getElementById('timeRangeLabel');
        if (label) label.textContent = `${currentTimeRange} derniers jours`;

        renderTopPlayers();
    } catch (err) {
        console.error('Error loading stats:', err);
        renderTopPlayersError();
    }
}

// ============================================================
// ALERTS (pending drafts)
// ============================================================
function renderAlerts() {
    const strip = document.getElementById('actionAlerts');
    if (!strip || !userData.userPools.length) return;

    const pending = userData.userPools.filter(p => !p.isDraftComplete);
    if (!pending.length) return;

    strip.innerHTML = pending.map(pool => `
        <div class="alert" onclick="window.location.href='pool.html?tab=draft'">
            <span class="alert-icon">🎯</span>
            <span class="alert-message">Repêchage en attente pour <strong>"${pool.name}"</strong> — Cliquez pour y accéder</span>
        </div>
    `).join('');
}

// ============================================================
// BUILD TEAM SCORES  (from pool + stats data)
// ============================================================
function buildTeamScores(pool) {
    const teams  = pool.allTeams || {};
    const stats  = userData.statsData;

    // Build player→points lookup from current-stats API
    const playerPts = {};
    if (stats && stats.players) {
        stats.players.forEach(p => {
            const name = p.playerName;
            if (!name) return;
            if (p.position === 'G') {
                // Goalie fantasy points: shutouts*5 + wins*2 + otLosses*1
                playerPts[name] = (p.shutouts || 0) * 5 + (p.wins || 0) * 2 + (p.otLosses || 0) * 1;
            } else {
                // Skater: use points from API
                playerPts[name] = p.points || 0;
            }
        });
    }

    // Compute each team's score
    const rows = Object.entries(teams).map(([teamName, td]) => {
        const players = [
            ...(td.offensive || []),
            ...(td.defensive || []),
            ...(td.goalie    || []),
            ...(td.rookie    || [])
        ];
        const score = players.reduce((s, n) => s + (playerPts[n] || 0), 0);
        const isCurrentUser = !!td.members && td.members.includes(userData.username);
        return { teamName, score, isCurrentUser, memberCount: (td.members || []).length };
    });

    rows.sort((a, b) => b.score - a.score);

    // Compute trends relative to average
    const avg = rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : 0;
    rows.forEach(r => {
        r.trend = r.score > avg * 1.05 ? 'up' : r.score < avg * 0.95 ? 'down' : 'neutral';
    });

    return rows;
}

// ============================================================
// LEADERBOARD SECTION
// ============================================================
function renderLeaderboard() {
    const skeleton = document.getElementById('leaderboardSkeleton');
    const content  = document.getElementById('leaderboardList');

    if (skeleton) skeleton.style.display = 'none';
    if (content)  content.style.display  = 'block';

    if (!userData.primaryPool) {
        content.innerHTML = `
            <div class="lb-empty">
                <p>Rejoignez un pool pour voir le classement</p>
                <a href="pool.html" style="margin-top:12px;display:inline-block;">→ Gérer les pools</a>
            </div>`;
        return;
    }

    // Set pool name badge
    const poolNameEl = document.getElementById('leaderboardPoolName');
    if (poolNameEl) poolNameEl.textContent = userData.primaryPool.name;

    const scores = buildTeamScores(userData.primaryPool);
    const rankCls = i => i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    const trendHTML = t =>
        t === 'up'   ? '<span class="lb-trend" style="color:var(--success)">▲</span>' :
        t === 'down' ? '<span class="lb-trend" style="color:var(--danger)">▼</span>' :
                       '<span class="lb-trend" style="color:var(--text-gray)">—</span>';

    content.innerHTML = scores.map((team, i) => `
        <div class="leaderboard-row ${team.isCurrentUser ? 'user-row' : ''}"
             onclick="window.location.href='classement.html'"
             style="animation-delay:${i * 0.06}s">
            <div class="lb-rank ${rankCls(i)}">${i + 1}</div>
            <div class="lb-team">
                <div class="lb-team-name">
                    ${team.teamName}
                    ${team.isCurrentUser ? '<span class="lb-you-badge">VOUS</span>' : ''}
                </div>
                <div class="lb-team-members">${team.memberCount} membre${team.memberCount !== 1 ? 's' : ''}</div>
            </div>
            ${trendHTML(team.trend)}
            <div class="lb-pts">
                <span class="lb-pts-value">${team.score}</span>
                <span class="lb-pts-label">PTS</span>
            </div>
        </div>
    `).join('');
}

// ============================================================
// DEMO LEADERBOARD DATA (shown to logged-out visitors)
// ============================================================
const DEMO_TEAMS = [
    { teamName: 'Les Glorieux',      score: 214 },
    { teamName: 'Ice Storm MTL',     score: 189 },
    { teamName: 'Nordiques Revival', score: 163 },
    { teamName: 'Bleu Blanc Rouge',  score: 147 },
    { teamName: 'Hockey Royale',     score: 121 },
];

// ============================================================
// HERO LEADERBOARD PREVIEW (floating card)
// ============================================================
function renderHeroLeaderboard() {
    const el = document.getElementById('heroLeaderboardPreview');
    if (!el) return;

    // Logged-out: show demo data with an "Aperçu" label
    if (!userData.username) {
        const headerSpan = document.querySelector('.hfc-header > span:nth-child(2)');
        if (headerSpan) headerSpan.textContent = 'Aperçu du classement';

        const rankCls = i => i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
        el.innerHTML = DEMO_TEAMS.map((team, i) => `
            <div class="hfc-row">
                <div class="hfc-rank ${rankCls(i)}">${i + 1}</div>
                <div class="hfc-team">${team.teamName}</div>
                <div class="hfc-pts">${team.score} <span style="font-size:.72rem;opacity:.7">PTS</span></div>
            </div>
        `).join('') + `
            <div style="text-align:center;margin-top:10px;">
                <a href="signup.html" style="font-size:.78rem;color:var(--primary);font-weight:700;text-decoration:none;">
                    Créer votre équipe →
                </a>
            </div>`;
        return;
    }

    // Update header to show pool name
    const headerSpan = document.querySelector('.hfc-header > span:nth-child(2)');
    if (headerSpan && userData.primaryPool) {
        headerSpan.textContent = `Classement en direct · ${userData.primaryPool.name}`;
    }

    if (!userData.primaryPool) {
        el.innerHTML = `<p style="color:var(--text-secondary);font-size:.85rem;text-align:center;padding:12px 0;">
            Rejoignez un pool pour voir le classement</p>`;
        return;
    }

    const scores  = buildTeamScores(userData.primaryPool).slice(0, 5);
    const rankCls = i => i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';

    el.innerHTML = scores.map((team, i) => `
        <div class="hfc-row ${team.isCurrentUser ? 'current-user' : ''}">
            <div class="hfc-rank ${rankCls(i)}">${i + 1}</div>
            <div class="hfc-team">${team.teamName}${team.isCurrentUser ? ' <span style="color:var(--primary);font-size:.82rem;">(moi)</span>' : ''}</div>
            <div class="hfc-pts">${team.score} <span style="font-size:.72rem;opacity:.7">PTS</span></div>
        </div>
    `).join('');
}

// ============================================================
// TOP PLAYERS SECTION - LAST 7 DAYS
// ============================================================
function renderTopPlayers() {
    const skeleton = document.getElementById('topPlayersSkeleton');
    const content  = document.getElementById('topPlayersList');

    if (skeleton) skeleton.style.display = 'none';
    if (!content) return;

    content.style.display = 'grid';

    const hotPlayers = userData.hotPlayers;
    if (!hotPlayers || !hotPlayers.topPlayers) {
        renderTopPlayersError();
        return;
    }

    const performers = hotPlayers.topPlayers.slice(0, 10);

    if (!performers.length) {
        content.innerHTML = `<p style="grid-column:1/-1;text-align:center;
            padding:48px;color:var(--text-secondary);">Aucun joueur trouvé dans les 7 derniers jours</p>`;
        return;
    }

    const rankCls = i => i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'normal';

    content.innerHTML = performers.map((p, i) => {
        const name    = p.playerName || 'Unknown';
        const team    = p.teamAbbrev || 'N/A';
        const pos     = p.position || 'F';
        const fantasyPts = Math.round(p.totalFantasyPoints || 0);
        const gamesPlayed = p.gamesPlayed || 0;
        const isHot   = p.isHot || false;

        // Display goals/assists for skaters, wins/saves for goalies
        const goals   = p.goals || 0;
        const assists = p.assists || 0;
        const pts     = p.points || 0;
        const wins    = p.wins || 0;
        const saves   = p.saves || 0;

        const headshot = p.headshot || `https://assets.nhle.com/mugs/nhl/20252026/${team}/${p.playerId}.png`;

        return `
        <div class="player-card" onclick="viewPlayer(${p.playerId || ''})"
             style="animation-delay:${i * 0.07}s">
            <div class="player-rank-badge ${rankCls(i)}">${i + 1}</div>
            ${isHot ? '<span class="hot-streak" title="En feu!">🔥</span>' : ''}
            <div class="player-card-photo">
                <img src="${headshot}" alt="${name}"
                     onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display='flex';"
                     loading="lazy">
                <span class="no-photo" style="display:none">🏒</span>
            </div>
            <div class="player-card-name">${name}</div>
            <div class="player-card-team">${team} · ${gamesPlayed} matchs</div>
            <div class="player-card-stats">
                ${pos === 'G' ? `
                    <div class="pc-stat">
                        <span class="pc-stat-val pts">${fantasyPts}</span>
                        <span class="pc-stat-label">FPTS</span>
                    </div>
                    <div class="pc-stat">
                        <span class="pc-stat-val">${wins}</span>
                        <span class="pc-stat-label">VIC</span>
                    </div>
                    <div class="pc-stat">
                        <span class="pc-stat-val">${saves}</span>
                        <span class="pc-stat-label">ARR</span>
                    </div>
                ` : `
                    <div class="pc-stat">
                        <span class="pc-stat-val pts">${fantasyPts}</span>
                        <span class="pc-stat-label">FPTS</span>
                    </div>
                    <div class="pc-stat">
                        <span class="pc-stat-val">${goals}</span>
                        <span class="pc-stat-label">BTS</span>
                    </div>
                    <div class="pc-stat">
                        <span class="pc-stat-val">${assists}</span>
                        <span class="pc-stat-label">ASS</span>
                    </div>
                `}
            </div>
        </div>`;
    }).join('');
}

function renderTopPlayersError() {
    const skeleton = document.getElementById('topPlayersSkeleton');
    const content  = document.getElementById('topPlayersList');
    if (skeleton) skeleton.style.display = 'none';
    if (!content) return;
    content.style.display = 'grid';
    content.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:48px;">
            <p style="color:var(--text-secondary);margin-bottom:12px;font-size:1.1rem;">
                📊 Aucune donnée disponible</p>
            <p style="color:var(--text-gray);margin-bottom:18px;font-size:0.9rem;">
                Les statistiques des joueurs seront disponibles une fois les logs de parties chargés dans la base de données.</p>
            <button onclick="location.reload()"
                style="padding:11px 24px;background:var(--primary);color:var(--bg);
                       border:none;border-radius:10px;font-weight:800;cursor:pointer;
                       font-size:.95rem;box-shadow:var(--glow-primary);">
                🔄 Réessayer
            </button>
        </div>`;
}

// ============================================================
// UTILITY
// ============================================================
function viewPlayer(playerId) {
    if (playerId) {
        window.location.href = `index.html?viewPlayer=${playerId}`;
    }
}

// ============================================================
// TIME RANGE FILTER
// ============================================================
function changeTimeRange(days) {
    // Update active button
    document.querySelectorAll('.time-filter').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.days == days);
    });

    // Update label
    const label = document.getElementById('timeRangeLabel');
    if (label) {
        label.textContent = `${days} derniers jours`;
    }

    // Update "Voir tout" link to preserve time range
    const viewAllLink = document.getElementById('viewAllPlayersLink');
    if (viewAllLink) {
        viewAllLink.href = `index.html?days=${days}`;
    }

    // Reload stats with new range
    loadStats(days);
}

// ============================================================
// SMOOTH SCROLL
// ============================================================
function scrollToHowItWorks() {
    const section = document.getElementById('comment-ca-marche');
    if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}
