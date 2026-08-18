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

    // The pool-glance/roster card, "Mes classements", and the Activité tab
    // are now rendered by accueil-dash.js (new dashboard design) — this
    // file just keeps the stories carousel gated the same way it always was.
    maybeLoadStories();

    // Live draft state (e.g. "it's your turn") already flows through FZPool
    // via the socket connection activePool.js sets up — just listen for it.
    if (userData.username) FZPool.onData(maybeLoadStories);
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

        // Update active button and label to reflect actual range shown.
        // Scoped to this section: the Activité tab's leaderboard reuses the
        // same .time-filter class for its own, independent window picker.
        document.querySelectorAll('.top-players-section .time-filter').forEach(btn => {
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

// The pool-glance/roster card and its "no pool yet" onboarding fallback
// now live in accueil-dash.js/accueil-dash.css (the new dashboard design).
// This just keeps the live-game/news stories carousel gated the same way
// that card used to gate it: member-only, active pool required.
function maybeLoadStories() {
    if (FZPool.get() && !storiesLoaded) { storiesLoaded = true; loadStories(); }
}

// ============================================================
// STORIES — auto-advancing real NHL live-game / news slides, above
// "Mes classements". One image area, one progress bar underneath;
// when it fills, the slide advances. Never a placeholder: a slide
// type with nothing real to show is simply left out, and the whole
// section stays hidden when there's nothing at all (see /live-games
// and /nhl-news in server.js — both return an honest empty list
// rather than inventing content).
// ============================================================
let storiesLoaded = false;
const STORY_SLIDE_MS = 7000;
let storySlides = [];
let storyIndex = 0;
let storyTimer = null;
let storyElapsed = 0;
let storyPaused = false;

async function loadStories() {
    const section = document.getElementById('storiesSection');
    if (!section) return;
    stopStoryTimer();

    const [liveGames, news] = await Promise.all([fetchLiveGames(), fetchNhlNews()]);

    storySlides = [
        ...liveGames.map(game => ({ type: 'live', game })),
        ...news.map(article => ({ type: 'news', article }))
    ];

    // Always show the section once a member has a pool — a quiet "nothing
    // right now" beats vanishing outright, which reads as broken rather
    // than as "no games today." Re-check in a minute so a game that goes
    // live while this tab is open appears without a refresh.
    section.style.display = '';

    if (!storySlides.length) {
        renderStoriesEmpty();
        storyTimer = setTimeout(loadStories, 60000);
        return;
    }

    storyIndex = 0;
    renderStorySlide();
    startStoryTimer();
}

function renderStoriesEmpty() {
    const card = document.getElementById('storiesCard');
    const track = document.querySelector('.stories-progress-track');
    if (track) track.style.display = 'none';
    if (!card) return;

    card.innerHTML = `
        <div class="stories-empty">
            <span class="stories-empty-icon" data-icon="hockey" data-icon-size="22"></span>
            <span class="stories-empty-text">Aucun match en direct pour l’instant.</span>
            <span class="stories-empty-sub">Revenez pendant un soir de match pour voir les pointages en direct.</span>
        </div>`;
    if (typeof getIcon === 'function') {
        card.querySelectorAll('[data-icon]').forEach(el => {
            el.innerHTML = getIcon(el.getAttribute('data-icon'), parseInt(el.getAttribute('data-icon-size') || '20'));
        });
    }
}

async function fetchLiveGames() {
    try {
        const res = await fetch(`${BASE_URL}/live-games`, { cache: 'no-store' });
        const data = res.ok ? await res.json() : null;
        return (data && data.games) || [];
    } catch (err) {
        console.warn('Could not load live games:', err);
        return [];
    }
}

async function fetchNhlNews() {
    try {
        const res = await fetch(`${BASE_URL}/nhl-news`, { cache: 'no-store' });
        const data = res.ok ? await res.json() : null;
        return (data && data.articles) || [];
    } catch (err) {
        console.warn('Could not load NHL news:', err);
        return [];
    }
}

const STORY_STRENGTH_LABEL = { pp: 'AN', sh: 'DN' };
const STORY_PERIOD_LABEL = { OT: 'Prolongation', SO: 'Tirs de barrage' };

function renderStorySlide() {
    const card = document.getElementById('storiesCard');
    if (!card || !storySlides.length) return;

    const slide = storySlides[storyIndex];

    if (slide.type === 'news') {
        const a = slide.article;
        card.innerHTML = `
            <a class="stories-news" href="${a.url}" target="_blank" rel="noopener noreferrer" style="background-image:url('${a.image}')">
                <span class="stories-scrim"></span>
                <span class="stories-badge">Actualité</span>
                <span class="stories-caption">
                    <span class="stories-source">${escapeHTML(a.source)}</span>
                    <span class="stories-title">${escapeHTML(a.title)}</span>
                </span>
            </a>`;
        return;
    }

    const g = slide.game;
    const periodLabel = STORY_PERIOD_LABEL[g.periodType] || `${g.period}e période`;
    const clockLabel = (g.clock && g.clock.inIntermission) ? 'Entracte' : ((g.clock && g.clock.timeRemaining) || '');
    const events = (g.events || []).map(e => `
        <div class="stories-live-event">
            <span class="sle-team">${escapeHTML(e.team)}</span>
            <span class="sle-scorer">${escapeHTML(e.scorer)}${STORY_STRENGTH_LABEL[e.strength] ? ' · ' + STORY_STRENGTH_LABEL[e.strength] : ''}</span>
            <span class="sle-time">P${e.period} ${escapeHTML(e.timeInPeriod)}</span>
        </div>`).join('');

    card.innerHTML = `
        <div class="stories-live">
            <span class="stories-badge stories-badge-live"><span class="stories-live-dot"></span> En direct</span>
            <div class="stories-live-teams">
                <span class="stories-live-team">
                    <img src="teams/${escapeHTML(g.away.abbrev)}.png" alt="" onerror="this.style.display='none'">
                    <span class="stories-live-abbrev">${escapeHTML(g.away.abbrev)}</span>
                    <span class="stories-live-score">${g.away.score}</span>
                </span>
                <span class="stories-live-mid">
                    <span class="stories-live-period">${periodLabel}</span>
                    <span class="stories-live-clock">${escapeHTML(clockLabel)}</span>
                </span>
                <span class="stories-live-team">
                    <img src="teams/${escapeHTML(g.home.abbrev)}.png" alt="" onerror="this.style.display='none'">
                    <span class="stories-live-abbrev">${escapeHTML(g.home.abbrev)}</span>
                    <span class="stories-live-score">${g.home.score}</span>
                </span>
            </div>
            <div class="stories-live-events">${events || '<p class="activity-empty">Aucun but pour l’instant.</p>'}</div>
        </div>`;
}

function startStoryTimer() {
    stopStoryTimer();
    storyElapsed = 0;
    storyPaused = false;
    const track = document.querySelector('.stories-progress-track');
    if (track) track.style.display = '';
    const fill = document.getElementById('storiesProgressFill');
    if (fill) fill.style.width = '0%';

    storyTimer = setInterval(() => {
        if (storyPaused) return;
        storyElapsed += 100;
        const pct = Math.min(100, (storyElapsed / STORY_SLIDE_MS) * 100);
        if (fill) fill.style.width = `${pct}%`;

        if (storyElapsed >= STORY_SLIDE_MS) {
            storyElapsed = 0;
            if (fill) fill.style.width = '0%';
            storyIndex++;
            if (storyIndex >= storySlides.length) {
                loadStories(); // completed a full loop — refresh with live data
            } else {
                renderStorySlide();
            }
        }
    }, 100);

    const card = document.getElementById('storiesCard');
    if (card && !card.dataset.hoverBound) {
        card.dataset.hoverBound = '1';
        card.addEventListener('mouseenter', () => { storyPaused = true; });
        card.addEventListener('mouseleave', () => { storyPaused = false; });
    }
}

function stopStoryTimer() {
    if (storyTimer) { clearInterval(storyTimer); storyTimer = null; }
}

// The old homepage Activity tab (for-sale listings, windowed best-team
// leaderboard, trade feed) is gone — for-sale moved to trade.js/trade.html,
// the windowed leaderboard moved to classement.js/classement.html, and the
// trade feed lives on in accueil-dash.js as the new dashboard's "Activité
// de la ligue". See the plan for why: this app has no claims/waivers
// feature and no timestamped join log, so those two mockup item types
// were dropped rather than invented.

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
    // Update active button (scoped — see the note in loadStats above)
    document.querySelectorAll('.top-players-section .time-filter').forEach(btn => {
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
