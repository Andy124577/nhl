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
    renderMyRankings();      // all pools you're in, with your position in each
    renderHeroLeaderboard();
    adaptHeroForUser();      // auth-aware primary CTA (Jakob's Law)
    renderResumeBanner();    // open-task pull (Zeigarnik Effect)
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
const SIX_MONTHS_DAYS = 180;

function timeRangeText(days) {
    return days === SIX_MONTHS_DAYS ? '6 derniers mois' : `${days} derniers jours`;
}

function hasHotPlayers(data) {
    return !!(data && Array.isArray(data.topPlayers) && data.topPlayers.length);
}

async function fetchHotPlayers(days) {
    const res = await fetch(`${BASE_URL}/hot-players-last${days}days`);
    return await res.json();
}

async function loadStats(days = 7) {
    try {
        let data = await fetchHotPlayers(days);

        // Off-season / empty DB: if nothing happened in the last 30 days, reveal the
        // 6-month filter and open on it instead of showing an empty section.
        if (days === 7 && !hasHotPlayers(data)) {
            const last30 = await fetchHotPlayers(30);
            if (!hasHotPlayers(last30)) {
                const sixMonthBtn = document.getElementById('timeFilter6M');
                if (sixMonthBtn) sixMonthBtn.style.display = '';
                days = SIX_MONTHS_DAYS;
                data = await fetchHotPlayers(SIX_MONTHS_DAYS);
            }
        }

        currentTimeRange = days;
        userData.hotPlayers = data;

        // Update active button and label to reflect actual range shown
        document.querySelectorAll('.time-filter').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.days == currentTimeRange);
        });
        const label = document.getElementById('timeRangeLabel');
        if (label) label.textContent = timeRangeText(currentTimeRange);
        const viewAllLink = document.getElementById('viewAllPlayersLink');
        if (viewAllLink) viewAllLink.href = `stats.html?days=${currentTimeRange}`;

        renderTopPlayers();
    } catch (err) {
        console.error('Error loading stats:', err);
        renderTopPlayersError();
    }
}

// ============================================================
// RESUME BANNER (Zeigarnik Effect — pull users back to open loops)
// ============================================================
function findResumableDraft() {
    // A draft is resumable when its order has started but it isn't finished.
    return userData.userPools.find(p =>
        Array.isArray(p.data.draftOrder) && p.data.draftOrder.length > 0 && !p.isDraftComplete
    ) || null;
}

async function fetchPendingTradeCount() {
    if (!userData.username) return 0;
    try {
        const res = await fetch(`${BASE_URL}/trades/pending/${encodeURIComponent(userData.username)}`, { cache: 'no-store' });
        if (!res.ok) return 0;
        const trades = await res.json();
        return Array.isArray(trades) ? trades.length : 0;
    } catch { return 0; }
}

async function renderResumeBanner() {
    const banner = document.getElementById('homeResumeBanner');
    if (!banner || !userData.username) return;

    const items = [];

    const resumable = findResumableDraft();
    if (resumable) {
        items.push(`
            <a class="resume-item draft" href="draftActif.html?pool=${encodeURIComponent(resumable.name)}">
                <span class="resume-icon">🏒</span>
                <span class="resume-text">Repêchage en cours — <strong>${resumable.name}</strong></span>
                <span class="resume-cta">Reprendre →</span>
            </a>
        `);
    }

    const pendingTrades = await fetchPendingTradeCount();
    if (pendingTrades > 0) {
        items.push(`
            <a class="resume-item trade" href="trade.html">
                <span class="resume-icon">🔄</span>
                <span class="resume-text">${pendingTrades} échange${pendingTrades > 1 ? 's' : ''} en attente de votre réponse</span>
                <span class="resume-cta">Voir →</span>
            </a>
        `);
    }

    banner.innerHTML = items.join('');
    banner.classList.toggle('has-items', items.length > 0);
}

// ============================================================
// HERO CTA — auth-aware (Jakob's Law: returning users want to resume)
// ============================================================
function adaptHeroForUser() {
    if (!userData.username) return;
    const actions = document.querySelector('.hero-actions');
    if (!actions) return;

    const resumable = findResumableDraft();
    let primary;
    if (resumable) {
        primary = `<a href="draftActif.html?pool=${encodeURIComponent(resumable.name)}" class="btn-hero-primary"><span data-icon="hockey" data-icon-size="16"></span> Reprendre le repêchage</a>`;
    } else if (userData.primaryPool) {
        primary = `<a href="classement.html" class="btn-hero-primary"><span data-icon="trophy" data-icon-size="16"></span> Voir mon classement</a>`;
    } else {
        primary = `<a href="creer-pool.html" class="btn-hero-primary"><span data-icon="rocket" data-icon-size="16"></span> Créer un pool</a>`;
    }

    // Occam's Razor: returning users who already have a pool don't need the
    // marketing "Comment ça marche" walkthrough — hide it and drop its CTA.
    const isReturning = userData.userPools.length > 0;
    const tertiary = isReturning
        ? ''
        : `<button onclick="scrollToHowItWorks()" class="btn-hero-tertiary">Comment ça marche ?</button>`;

    actions.innerHTML = `
        ${primary}
        <a href="mes-pools.html" class="btn-hero-secondary">Mes pools →</a>
        ${tertiary}
    `;
    // The global icon scan only runs once on load; process the freshly-inserted icons.
    if (typeof getIcon === 'function') {
        actions.querySelectorAll('[data-icon]').forEach(el => {
            el.innerHTML = getIcon(el.getAttribute('data-icon'), parseInt(el.getAttribute('data-icon-size') || '20'));
        });
    }

    if (isReturning) {
        const howItWorks = document.getElementById('comment-ca-marche');
        if (howItWorks) howItWorks.style.display = 'none';
    }
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
// MY RANKINGS SECTION (every pool the user is in, expandable)
// ============================================================
function renderMyRankings() {
    const section = document.getElementById('myRankingsSection');
    const list    = document.getElementById('myRankingsList');
    if (!section || !list) return;

    // Nothing to rank for logged-out visitors or users without pools
    if (!userData.username || !userData.userPools.length) {
        section.style.display = 'none';
        return;
    }

    // Pools are created with 10 empty "Équipe N" slots — rank against the
    // teams that actually have members, not the unclaimed placeholders.
    // Order is left as-is (not re-sorted by rank): the server already hands
    // back userData.userPools most-recently-created first (see db.js'
    // `getAllPools`, ORDER BY created_at DESC), so the newest pool lands
    // at the top of the list.
    const entries = userData.userPools.map(pool => {
        const allScores = buildTeamScores(pool);
        const claimed   = allScores.filter(t => t.memberCount > 0);
        const scores    = claimed.length ? claimed : allScores;
        const idx       = scores.findIndex(t => t.isCurrentUser);
        return {
            pool,
            rank:  idx >= 0 ? idx + 1 : null,
            total: scores.length,
            score: idx >= 0 ? scores[idx].score : 0
        };
    });

    const count = document.getElementById('myRankingsCount');
    if (count) count.textContent = `${entries.length} pool${entries.length > 1 ? 's' : ''}`;

    const rankCls = r => r === 1 ? 'gold' : r === 2 ? 'silver' : r === 3 ? 'bronze' : '';

    // Keep the list compact by default; pools past this count are hidden
    // behind a "Voir plus" button instead of forcing an inner scrollbar.
    const VISIBLE_LIMIT = 5;

    const rows = entries.map(({ pool, rank, total, score }, i) => {
        const mode = !pool.isDraftComplete
            ? '<span class="rk-pool-mode pending">Repêchage en cours</span>'
            : `<span class="rk-pool-mode">${pool.mode === 'head-to-head' ? 'Tête-à-tête' : 'Cumulatif'} · ${escapeHTML(pool.userTeam)}</span>`;
        const hidden = i >= VISIBLE_LIMIT;

        return `
        <div class="ranking-item${hidden ? ' rk-extra' : ''}" data-pool="${escapeHTML(pool.name)}"${hidden ? ' style="display:none;"' : ''}>
            <button class="ranking-row" type="button" aria-expanded="false"
                    onclick="togglePoolRanking(this)">
                <span class="rk-pool">
                    <span class="rk-pool-name">${escapeHTML(pool.name)}</span>
                    ${mode}
                </span>
                <span class="rk-rank">
                    <span class="rk-rank-pos ${rankCls(rank)}">${rank || '—'}</span><span class="rk-rank-total">/${total}</span>
                </span>
                <span class="rk-pts">
                    <span class="rk-pts-value">${score}</span><span class="rk-pts-label">PTS</span>
                </span>
                <span class="rk-chevron">▼</span>
            </button>
            <div class="ranking-detail"></div>
        </div>`;
    }).join('');

    const moreCount = entries.length - VISIBLE_LIMIT;
    const moreBtn = moreCount > 0
        ? `<button type="button" class="rk-more-btn" onclick="revealAllRankings(this)">Voir plus (${moreCount})</button>`
        : '';

    list.innerHTML = rows + moreBtn;

    section.style.display = '';
}

// Reveals pools past VISIBLE_LIMIT in the "Mes classements" list, in place
// of an inner scrollbar.
function revealAllRankings(btn) {
    const list = document.getElementById('myRankingsList');
    list.querySelectorAll('.ranking-item.rk-extra').forEach(item => {
        item.style.display = '';
    });
    btn.remove();
}

// Expand/collapse a pool row to reveal the roster the user drafted in it.
// Detail markup is built on first open to keep the initial render light.
function togglePoolRanking(rowBtn) {
    const item   = rowBtn.parentElement;
    const detail = item.querySelector('.ranking-detail');
    const isOpen = item.classList.contains('open');

    if (isOpen) {
        detail.style.maxHeight = '0px';
        item.classList.remove('open');
        rowBtn.setAttribute('aria-expanded', 'false');
        return;
    }

    if (!detail.innerHTML.trim()) {
        detail.innerHTML = buildPoolRosterHTML(item.dataset.pool);
    }
    item.classList.add('open');
    rowBtn.setAttribute('aria-expanded', 'true');
    detail.style.maxHeight = `${detail.scrollHeight}px`;
}

// Player name → current-season stats, built once from /current-stats
let playerStatsIndex = null;
function getPlayerStats(name) {
    if (!playerStatsIndex) {
        playerStatsIndex = {};
        const players = userData.statsData?.players || [];
        players.forEach(p => { if (p.playerName) playerStatsIndex[p.playerName] = p; });
    }
    return playerStatsIndex[name] || null;
}

function buildPoolRosterHTML(poolName) {
    const pool = userData.userPools.find(p => p.name === poolName);
    if (!pool) return '<div class="rk-detail-empty">Pool introuvable</div>';

    const td = pool.userTeamData || {};
    const groups = [
        ['Attaquants', td.offensive || []],
        ['Défenseurs', td.defensive || []],
        ['Gardiens',   td.goalie    || []],
        ['Recrues',    td.rookie    || []]
    ].filter(([, names]) => names.length);

    if (!groups.length) {
        return `
            <div class="rk-detail-inner">
                <div class="rk-detail-empty">Aucun joueur sélectionné pour ce pool.</div>
                <a class="rk-detail-link" href="draftActif.html?pool=${encodeURIComponent(pool.name)}">Aller au repêchage →</a>
            </div>`;
    }

    const body = groups.map(([title, names]) => `
        <div class="rk-group-title">${title}</div>
        ${names.map(name => renderRosterPlayer(name)).join('')}
    `).join('');

    return `
        <div class="rk-detail-inner">
            ${body}
            <a class="rk-detail-link" href="classement.html">Voir le classement complet →</a>
        </div>`;
}

function renderRosterPlayer(name) {
    const s        = getPlayerStats(name);
    const pos      = s?.position || '—';
    const team     = s?.teamAbbrev || 'N/A';
    const games    = s?.gamesPlayed || 0;
    const headshot = s?.headshot ||
        (s?.playerId && s?.teamAbbrev
            ? `https://assets.nhle.com/mugs/nhl/20252026/${s.teamAbbrev}/${s.playerId}.png`
            : '');

    const stats = pos === 'G'
        ? [['pts', s?.points || 0, 'PTS'], ['', s?.wins || 0, 'VIC'], ['', s?.shutouts || 0, 'BL']]
        : [['pts', s?.points || 0, 'PTS'], ['', s?.goals || 0, 'BTS'], ['', s?.assists || 0, 'ASS']];

    return `
        <div class="rk-player">
            ${headshot
                ? `<img class="rk-player-photo" src="${headshot}" alt="${escapeHTML(name)}" loading="lazy"
                        onerror="this.style.visibility='hidden'">`
                : '<span class="rk-player-photo"></span>'}
            <span class="rk-player-id">
                <span class="rk-player-name">${escapeHTML(name)}</span>
                <span class="rk-player-meta">${team} · ${pos} · ${games} PJ</span>
            </span>
            <span class="rk-player-stats">
                ${stats.map(([cls, val, label]) => `
                    <span class="rk-stat">
                        <span class="rk-stat-val ${cls}">${val}</span>
                        <span class="rk-stat-label">${label}</span>
                    </span>`).join('')}
            </span>
        </div>`;
}

function escapeHTML(str) {
    return String(str ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
                <a href="mes-pools.html" style="margin-top:12px;display:inline-block;">→ Gérer les pools</a>
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

// Le classement de démonstration servi aux visiteurs a disparu avec la
// carte qu'il remplissait : le héros leur montre désormais un repêchage
// en cours, qui dit mieux ce que le site permet de faire.

// ============================================================
// HERO LEADERBOARD PREVIEW (floating card)
// ============================================================
function renderHeroLeaderboard() {
    const el = document.getElementById('heroLeaderboardPreview');
    if (!el) return;

    // Visiteur : cette carte est masquée, c'est le repêchage animé qui
    // occupe le héros (demos.js). Rien à peupler ici.
    if (!userData.username) return;

    // Update header to show pool name
    const headerSpan = document.querySelector('#heroCardStandings .hfc-header > span:nth-child(2)');
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

    // Clear the inline display so .players-grid decides the layout — it's a grid
    // on desktop and a horizontal snap-scroller on phones.
    content.style.display = '';

    const hotPlayers = userData.hotPlayers;
    if (!hotPlayers || !hotPlayers.topPlayers) {
        renderTopPlayersError();
        return;
    }

    const performers = hotPlayers.topPlayers.slice(0, 10);

    if (!performers.length) {
        content.innerHTML = `<p style="grid-column:1/-1;width:100%;text-align:center;
            padding:48px;color:var(--text-secondary);">Aucun joueur trouvé dans les ${timeRangeText(currentTimeRange)}</p>`;
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
    content.style.display = '';
    content.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:48px;width:100%;">
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
        window.location.href = `stats.html?viewPlayer=${playerId}`;
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
        label.textContent = timeRangeText(days);
    }

    // Update "Voir tout" link to preserve time range
    const viewAllLink = document.getElementById('viewAllPlayersLink');
    if (viewAllLink) {
        viewAllLink.href = `stats.html?days=${days}`;
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
