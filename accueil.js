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
    teamsData: null,
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
    // loadCurrentTeamsData() : buildTeamScores() compte le club repêché par
    // chaque équipe, il lui faut donc les fiches de clubs. Chargé ici, avec
    // le reste, plutôt qu'à l'usage — la fonction de pointage est synchrone.
    await Promise.all([
        FZPool.ready(), loadPools(), loadCurrentStats(), loadCurrentTeamsData(),
        loadStatsLeaders(), loadPendingTrades()
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

// Fiches de clubs : buildTeamScores() en a besoin pour compter le club
// repêché par chaque équipe. Échec sans conséquence — les clubs valent
// alors 0, comme avant.
async function loadCurrentTeamsData() {
    try {
        const res = await fetch(`${BASE_URL}/current-teams`, { cache: 'no-store' });
        userData.teamsData = await res.json();
    } catch (err) {
        console.warn('Could not load current teams:', err);
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
    // « Choisir votre club » vivait ici : le repêchage ne pouvait pas démarrer
    // tant que chaque équipe n'avait pas pris une identité LNH. L'étape a été
    // retirée — l'équipe de la LNH se repêche comme les autres positions —,
    // il ne reste donc qu'un seul état possible.
    if (state.etat === 'pret') {
        return { kind: 'ready', label: 'Prêt à démarrer', href: href('pret') };
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
            // Formule partagée (lib/scoring.js), plus recopiée ici.
            playerPts[name] = p.position === 'G' ? goaliePoolPoints(p) : (p.points || 0);
        });
    }

    // Le club repêché compte lui aussi (2×V + DP), comme sur la page de
    // classement et comme dans le rang enregistré par le serveur. Sans
    // lui, l'aperçu de la page d'accueil pouvait classer deux équipes
    // dans un autre ordre que le classement lui-même.
    const clubPts = {};
    ((userData.teamsData && userData.teamsData.teams) || []).forEach(t => {
        if (t && t.teamFullName) clubPts[t.teamFullName] = clubPoolPoints(t);
    });

    // Compute each team's score
    const rows = Object.entries(teams).map(([teamName, td]) => {
        const players = [
            ...(td.offensive || []),
            ...(td.defensive || []),
            ...(td.goalie    || []),
            ...(td.rookie    || [])
        ];
        const score = players.reduce((s, n) => s + (playerPts[n] || 0), 0)
            + (td.teams || []).reduce((s, n) => s + (clubPts[n] || 0), 0);
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
// SMOOTH SCROLL
// ============================================================
function scrollToHowItWorks() {
    const section = document.getElementById('comment-ca-marche');
    if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}
