/* ============================================================ */
/* ACCUEIL — Home page JS                                       */
/* ============================================================ */

const BASE_URL = window.location.hostname.includes('localhost')
    ? 'http://localhost:3000'
    : window.location.origin;

let userData = {
    username: null,
    userPools: [],
    pendingTrades: [],
    statsData: null,
    hotPlayers: null,
    statsLeaders: null
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

    // Fetch pools, stats and pending trades in parallel
    await Promise.all([
        FZPool.ready(), loadPools(), loadCurrentStats(), loadStats(), loadStatsLeaders(), loadPendingTrades()
    ]);

    // Render all sections
    renderMyRankings();   // all pools you're in, with your position in each
    renderDashHeader();   // draft/trade/consult/join/create grid, or an onboarding card if you have no pools

    // Live draft state (e.g. "it's your turn") already flows through FZPool
    // via the socket connection activePool.js sets up — just listen for it.
    if (userData.username) FZPool.onData(renderDashHeader);
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
// STATS LEADERS LOADING (hero, logged-in members only)
// ============================================================
async function loadStatsLeaders() {
    if (!userData.username) return;
    try {
        const res = await fetch(`${BASE_URL}/stats-leaders`, { cache: 'no-store' });
        userData.statsLeaders = await res.json();
    } catch (err) {
        console.warn('Could not load stats leaders:', err);
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
// DRAFT ACTION — is there something to do in the given pool right now?
// Shared by the pool-glance card below (active pool only).
// ============================================================
function draftActionFor(pool) {
    const state = FZPool.draftState(pool.data);
    const href = kind => (kind === 'encours' ? 'draftActif.html' : 'repechage.html') + `?pool=${encodeURIComponent(pool.name)}`;

    if (state.etat === 'encours') {
        return state.equipeAuTour === pool.teamName
            ? { kind: 'your-turn', label: "C'est votre tour", href: href('encours') }
            : { kind: 'live', label: `En direct — choix ${state.choixFait}/${state.choixTotal}`, href: href('encours') };
    }
    if (state.etat === 'pret') {
        return pool.teamData.nhlClub
            ? { kind: 'ready', label: 'Prêt à démarrer', href: href('pret') }
            : { kind: 'choose-club', label: 'Choisir votre club', href: href('pret') };
    }
    // attente / termine: nothing actionable here — attente has no action
    // for a regular member, and termine's rank/points live in the card itself.
    return null;
}

async function loadPendingTrades() {
    if (!userData.username) { userData.pendingTrades = []; return; }
    try {
        const res = await fetch(`${BASE_URL}/trades/pending/${encodeURIComponent(userData.username)}`, { cache: 'no-store' });
        userData.pendingTrades = res.ok ? await res.json() : [];
    } catch (err) {
        console.warn('Could not load pending trades:', err);
        userData.pendingTrades = [];
    }
}

// A signed-up user with no active pool has nothing to show here — the
// onboarding card (create/join) replaces the glance card entirely instead
// of leaving an empty rank/roster shell on screen.
function renderDashHeader() {
    const card = document.getElementById('poolGlance');
    const onboard = document.getElementById('dashOnboard');
    if (!card || !onboard || !userData.username) return;

    if (FZPool.get()) {
        card.style.display = '';
        onboard.style.display = 'none';
        renderPoolGlance();
        return;
    }

    card.style.display = 'none';
    onboard.style.display = '';
}

// ============================================================
// POOL GLANCE — rank, draft/trade status, and top roster names for the
// ACTIVE pool only (see poolNav.js / activePool.js for what "active"
// means). Deliberately not a full stats view: "Mes classements" below
// already covers every pool in depth, and repeating that here would just
// be the same numbers twice. A team's full-season rank/points, the
// pool's real draft state, and a real "hot" flag (from the same
// hot-players data the "Meilleurs joueurs" section already loads) are
// the only figures shown — no invented trend line or percentile, since
// nothing in this codebase tracks either yet.
// ============================================================
function renderPoolGlance() {
    if (!userData.username) return;

    const activeName = FZPool.get();
    const poolData = FZPool.data();
    const team = FZPool.team();
    if (!activeName || !poolData || !team) return;

    // ---- Rank + points, this pool only ----
    const allScores = buildTeamScores({ allTeams: poolData.teams || {} });
    const claimed = allScores.filter(t => t.memberCount > 0);
    const scores = claimed.length ? claimed : allScores;
    const idx = scores.findIndex(t => t.isCurrentUser);

    document.getElementById('pgRankNum').textContent = idx >= 0 ? String(idx + 1) : '—';
    document.getElementById('pgRankTotal').textContent = scores.length ? `/${scores.length}` : '';
    document.getElementById('pgRankPool').textContent = activeName;
    document.getElementById('pgRankPts').textContent = idx >= 0 ? `${scores[idx].score} PTS` : '—';

    // ---- Draft status ----
    const state = FZPool.draftState(poolData);
    const action = draftActionFor({ data: poolData, name: activeName, teamName: team.name, teamData: team.data });
    const draftFallback = { attente: 'En attente de joueurs', termine: 'Terminé' };
    const draftTile = document.getElementById('pgDraftTile');
    document.getElementById('pgDraftValue').textContent = action ? action.label : (draftFallback[state.etat] || '—');
    draftTile.href = action ? action.href : `repechage.html?pool=${encodeURIComponent(activeName)}`;
    draftTile.classList.toggle('pg-status-live', action?.kind === 'your-turn');

    // ---- Pending trades, this pool only (same filter navbar.js's badge uses) ----
    const activeTrades = (userData.pendingTrades || []).filter(t => t.draftName === activeName);
    const tradeTile = document.getElementById('pgTradeTile');
    document.getElementById('pgTradeValue').textContent = activeTrades.length
        ? `${activeTrades.length} en attente` : 'Aucun';
    tradeTile.href = activeTrades.length
        ? `trade.html?trade=${encodeURIComponent(activeTrades[0].id)}` : 'trade.html';
    tradeTile.classList.toggle('pg-status-live', activeTrades.length > 0);

    renderPoolGlanceRoster(team.data);
}

/** A skater's or goalie's season fantasy points, same formula as elsewhere on this page. */
function fantasyPoints(stats) {
    if (!stats) return 0;
    return stats.position === 'G'
        ? (stats.shutouts || 0) * 5 + (stats.wins || 0) * 2 + (stats.otLosses || 0) * 1
        : (stats.points || 0);
}

/** Real "hot streak" flag, cross-referenced against the same data "Meilleurs joueurs" uses — never invented. */
function isPlayerHot(name) {
    const hot = userData.hotPlayers && userData.hotPlayers.topPlayers;
    return !!(hot && hot.some(p => p.playerName === name && p.isHot));
}

function renderPoolGlanceRoster(teamData) {
    const list = document.getElementById('pgRosterList');
    if (!list) return;

    const names = [
        ...(teamData.offensive || []),
        ...(teamData.defensive || []),
        ...(teamData.goalie || []),
        ...(teamData.rookie || [])
    ];

    if (!names.length) {
        list.innerHTML = `
            <div class="pg-roster-empty">
                <p>Aucun joueur sélectionné pour l'instant.</p>
                <a href="repechage.html">Aller au repêchage →</a>
            </div>`;
        return;
    }

    const topThree = names
        .map(name => ({ name, stats: getPlayerStats(name) }))
        .sort((a, b) => fantasyPoints(b.stats) - fantasyPoints(a.stats))
        .slice(0, 3);

    list.innerHTML = topThree.map(({ name, stats }) => {
        const pos = stats?.position || '—';
        const team = stats?.teamAbbrev || 'N/A';
        const pts = fantasyPoints(stats);
        const headshot = stats?.headshot ||
            (stats?.playerId && stats?.teamAbbrev
                ? `https://assets.nhle.com/mugs/nhl/20252026/${stats.teamAbbrev}/${stats.playerId}.png`
                : '');
        const fallbackLabel = escapeHTML((pos !== '—' ? pos : name.charAt(0) || '?').slice(0, 2).toUpperCase());

        return `
            <div class="pg-roster-row">
                <span class="pg-roster-photo">
                    ${headshot ? `<img src="${headshot}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">` : ''}
                    <span class="pg-roster-fallback"${headshot ? ' style="display:none"' : ''}>${fallbackLabel}</span>
                </span>
                <span class="pg-roster-id">
                    <span class="pg-roster-name">${escapeHTML(name)}</span>
                    <span class="pg-roster-meta">${escapeHTML(team)} · ${escapeHTML(pos)}</span>
                </span>
                <span class="pg-roster-stats">
                    <span class="pg-roster-pts">${pts} pts</span>
                    ${isPlayerHot(name) ? '<span class="pg-hot" title="En feu!">🔥</span>' : ''}
                </span>
            </div>`;
    }).join('');
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
