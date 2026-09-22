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

    // Guest hero actions are authored in index.html, ready before JS loads.

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
// Le match choisi à la main dans le sélecteur (null = rotation libre). La
// carte s'arrête dessus et continue de se mettre à jour toute seule.
const STORY_PINNED_REFRESH_MS = 20000;
let storyPinnedGameId = null;

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
        storyPinnedGameId = null;
        renderStoryPicker();
        renderStoriesEmpty();
        storyTimer = setTimeout(loadStories, 60000);
        return;
    }

    renderStoryPicker();
    bindStoryHover();

    // Un match épinglé le reste d'un rafraîchissement à l'autre, tant qu'il
    // est encore en cours — c'est tout l'intérêt de l'avoir choisi. Dès
    // qu'il se termine il quitte le flux, et la rotation reprend seule.
    const epingle = storyPinnedGameId === null ? -1
        : storySlides.findIndex(s => s.type === 'live' && String(s.game.id) === storyPinnedGameId);
    if (epingle < 0) storyPinnedGameId = null;

    storyIndex = epingle < 0 ? 0 : epingle;
    renderStorySlide();

    if (storyPinnedGameId === null) startStoryTimer();
    else startStoryPinnedRefresh();
}

// ---- Sélecteur de match -------------------------------------------------
// Plusieurs matchs sont souvent en cours au même moment, et le carrousel les
// fait défiler à son rythme : on ne pouvait pas choisir celui qu'on regarde.
// Les jetons donnent ce choix — « Auto » laisse tourner, un match l'épingle.

function renderStoryPicker() {
    const picker = document.getElementById('storiesPicker');
    if (!picker) return;

    const matchs = storySlides.filter(s => s.type === 'live').map(s => s.game);

    // Rien à choisir : aucun match en cours, ou un seul écran en tout.
    if (!matchs.length || storySlides.length < 2) {
        picker.style.display = 'none';
        picker.innerHTML = '';
        return;
    }

    picker.style.display = '';
    picker.innerHTML = `
        <button type="button" class="stories-chip stories-chip-auto" data-story-pick="auto">Auto</button>
        ${matchs.map(g => `
        <button type="button" class="stories-chip" data-story-pick="${escapeHTML(String(g.id))}">
            <img src="teams/${escapeHTML(g.away.abbrev)}.png" alt="" onerror="this.style.display='none'">
            <span class="stories-chip-team">${escapeHTML(g.away.abbrev)}</span>
            <span class="stories-chip-score">${g.away.score}<i>-</i>${g.home.score}</span>
            <span class="stories-chip-team">${escapeHTML(g.home.abbrev)}</span>
            <img src="teams/${escapeHTML(g.home.abbrev)}.png" alt="" onerror="this.style.display='none'">
        </button>`).join('')}`;

    if (!picker.dataset.bound) {
        picker.dataset.bound = '1';
        picker.addEventListener('click', ev => {
            const btn = ev.target.closest('[data-story-pick]');
            if (btn) pickStory(btn.getAttribute('data-story-pick'));
        });
    }

    updateStoryPickerActive();
}

/** « Auto » relâche l'épingle et relance la rotation ; un match l'épingle. */
function pickStory(valeur) {
    if (valeur === 'auto') {
        storyPinnedGameId = null;
        updateStoryPickerActive();
        startStoryTimer();
        return;
    }

    const i = storySlides.findIndex(s => s.type === 'live' && String(s.game.id) === valeur);
    if (i < 0) return;

    storyPinnedGameId = valeur;
    storyIndex = i;
    renderStorySlide();
    startStoryPinnedRefresh();
}

/**
 * Deux états distincts : `is-on` marque le choix du membre (« Auto », ou le
 * match épinglé), `is-current` le match qui passe à l'écran quand la rotation
 * est libre. Sans cette différence, « Auto » et un match s'allumeraient pareil
 * et on ne saurait plus lequel est épinglé.
 */
function updateStoryPickerActive() {
    const picker = document.getElementById('storiesPicker');
    if (!picker) return;

    const slide = storySlides[storyIndex];
    const aEcran = (slide && slide.type === 'live') ? String(slide.game.id) : null;

    picker.querySelectorAll('[data-story-pick]').forEach(btn => {
        const v = btn.getAttribute('data-story-pick');
        const choisi = v === 'auto' ? storyPinnedGameId === null : v === storyPinnedGameId;
        btn.classList.toggle('is-on', choisi);
        btn.classList.toggle('is-current', !choisi && v !== 'auto' && v === aEcran);
        btn.setAttribute('aria-pressed', choisi ? 'true' : 'false');
    });
}

function renderStoriesEmpty() {
    const card = document.getElementById('storiesCard');
    const track = document.querySelector('.stories-progress-track');
    if (track) track.style.display = 'none';
    if (!card) return;

    // La carte reprend sa hauteur fixe : le message vide est posé en absolu,
    // il ne porte pas la carte comme le fait le tableau indicateur.
    card.classList.remove('is-live');

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
// Capitales d'affichage, sauf l'ordinal : « 1re PÉRIODE » s'écrit ainsi en
// français, et un text-transform sur toute la ligne donnerait « 1RE ».
const STORY_PERIOD_LABEL = { OT: 'PROLONGATION', SO: 'TIRS DE BARRAGE' };

// Surnoms en deux mots : partout ailleurs le dernier mot du nom complet suffit
// (« San Jose Sharks » → « Sharks »), sauf pour ces cinq-là.
const STORY_NICKNAMES_2_MOTS = ['Maple Leafs', 'Blue Jackets', 'Red Wings', 'Golden Knights', 'Hockey Club'];

/**
 * Ville + surnom + fiche (V-D-DP) d'un club, pour le tableau indicateur.
 * Les fiches viennent du classement déjà chargé (/current-teams) : le flux
 * des matchs en direct ne les porte pas. Sans classement, la ligne de fiche
 * est simplement absente — jamais un « 0 - 0 - 0 » inventé.
 */
function storyTeamIdentity(abbrev, nomDeSecours) {
    const code = String(abbrev || '').trim().toUpperCase();
    const fiches = (userData.teamsData && userData.teamsData.teams) || [];
    const fiche = fiches.find(t => String(t.teamAbbrev || '').toUpperCase() === code);

    const complet = (fiche && fiche.teamFullName) || nomDeSecours || code;
    const surnomDouble = STORY_NICKNAMES_2_MOTS.find(n => complet.endsWith(n));
    const surnom = surnomDouble || complet.split(' ').pop() || code;
    const ville = complet.slice(0, complet.length - surnom.length).trim();

    return {
        ville: ville || code,
        surnom,
        fiche: fiche ? `${fiche.wins} - ${fiche.losses} - ${fiche.otLosses}` : ''
    };
}

/**
 * Couleur d'accent d'un club pour une surface sombre. La couleur principale
 * gagne, sauf quand elle est quasi noire (Los Angeles, Seattle, Toronto) :
 * elle ne teinterait alors rien du tout, et c'est la seconde couleur —
 * toujours la plus claire de la paire — qui porte l'identité.
 */
function storyTeamAccent(abbrev) {
    const paire = (typeof getTeamColors === 'function') ? getTeamColors(abbrev) : ['#3A414D', '#171A20'];
    const lum = (typeof hexLuminance === 'function') ? hexLuminance : () => 1;
    const [principale, seconde] = paire;
    return (lum(principale) >= 0.03 || lum(seconde) <= lum(principale)) ? principale : seconde;
}

/** « #006D75 » → « 0, 109, 117 », pour les rgba() du CSS. */
function storyHexToRgb(hex) {
    const clean = String(hex).replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const num = parseInt(full, 16);
    if (Number.isNaN(num)) return '58, 65, 77';
    return `${(num >> 16) & 0xff}, ${(num >> 8) & 0xff}, ${num & 0xff}`;
}

/** Les variables CSS d'un camp : teinte de fond, pastille, chiffre. */
function storyTeamVars(cote, abbrev) {
    const accent = storyTeamAccent(abbrev);
    const teinter = (typeof shadeHex === 'function') ? shadeHex : (h => h);
    const melanger = (typeof mixHex === 'function') ? mixHex : (a => a);
    return [
        `--sl-${cote}: ${accent}`,
        `--sl-${cote}-rgb: ${storyHexToRgb(accent)}`,
        // Les chiffres de pointage montent d'un cran : la couleur brute d'un
        // club sombre (Toronto, Vancouver) ne se lit pas en petit sur du noir.
        `--sl-${cote}-vif: ${teinter(accent, 0.22)}`,
        `--sl-${cote}-puce: ${melanger(accent, '#0C1318', 0.45)}`
    ].join('; ');
}

/**
 * Les surnoms les plus longs (GOLDEN KNIGHTS, BLUE JACKETS, MAPLE LEAFS)
 * viendraient toucher le pointage géant à la taille du dessin : ils passent
 * d'un cran, puis de deux. Tous les autres gardent la taille d'origine.
 */
function storyNomLong(surnom) {
    const n = String(surnom || '').length;
    if (n >= 13) return ' is-xlong';
    if (n >= 10) return ' is-long';
    return '';
}

/**
 * Les aides d'un but. Le flux les portait déjà (voir /live-games dans
 * server.js) ; elles n'étaient simplement jamais affichées. Un but sans aide
 * le dit : « Sans aide » est une vraie information, pas un remplissage.
 */
function storyAssistsHTML(e) {
    const aides = (Array.isArray(e.assists) ? e.assists : []).filter(Boolean);
    if (!aides.length) return '<span class="sl-goal-assists is-none">Sans aide</span>';
    const liste = aides.join(', ');
    return `<span class="sl-goal-assists" title="${escapeHTML(liste)}"><i>A</i>${escapeHTML(liste)}</span>`;
}

/** Un chiffre de pointage : blanc à zéro, couleur du club dès le premier but. */
function storyGoalScore(valeur, cote) {
    const n = Number(valeur);
    const style = n > 0 ? ` style="color: var(--sl-${cote}-vif)"` : '';
    return `<b${style}>${Number.isFinite(n) ? n : 0}</b>`;
}

function renderStorySlide() {
    const card = document.getElementById('storiesCard');
    if (!card || !storySlides.length) return;

    const slide = storySlides[storyIndex];
    card.classList.toggle('is-live', slide.type === 'live');
    updateStoryPickerActive();

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

    card.innerHTML = storyLiveHTML(slide.game);
}

/**
 * Le tableau indicateur d'un match en cours : bandeau des deux clubs
 * (crest, ville, surnom, fiche, pointage, période et chrono) puis la liste
 * des buts, du plus récent au plus ancien. Fonction pure — elle ne lit que
 * le match reçu et le classement déjà en mémoire.
 */
function storyLiveHTML(g) {
    const entracte = !!(g.clock && g.clock.inIntermission);
    const periode = STORY_PERIOD_LABEL[g.periodType]
        || `${g.period}${Number(g.period) === 1 ? 're' : 'e'} PÉRIODE`;
    const chrono = entracte ? 'ENTRACTE' : ((g.clock && g.clock.timeRemaining) || '');
    const pastilles = Array.from({ length: Math.max(3, Number(g.period) || 3) }, (_, i) =>
        `<i${i + 1 === Number(g.period) ? ' class="is-on"' : ''}></i>`).join('');

    const visiteur = storyTeamIdentity(g.away.abbrev, g.away.name);
    const local = storyTeamIdentity(g.home.abbrev, g.home.name);

    const camp = (cote, equipe, identite) => `
                <div class="sl-side sl-side-${cote}">
                    <img class="sl-crest" src="teams/${escapeHTML(equipe.abbrev)}.png" alt="" onerror="this.style.visibility='hidden'">
                    <span class="sl-ident">
                        <span class="sl-place">${escapeHTML(identite.ville)}</span>
                        <span class="sl-name${storyNomLong(identite.surnom)}">${escapeHTML(identite.surnom)}</span>
                        ${identite.fiche ? `<span class="sl-record">${escapeHTML(identite.fiche)}</span>` : ''}
                    </span>
                </div>`;

    const buts = (g.events || []).map(e => `
                <div class="sl-goal">
                    <span class="sl-goal-time">${escapeHTML(e.timeInPeriod)}</span>
                    <span class="sl-goal-team sl-goal-team-${e.team === g.home.abbrev ? 'home' : 'away'}">${escapeHTML(e.team)}</span>
                    <span class="sl-goal-scorer">${escapeHTML(e.scorer)}</span>
                    <span class="sl-goal-sep"></span>
                    <span class="sl-goal-tag">But</span>
                    ${STORY_STRENGTH_LABEL[e.strength] ? `<span class="sl-goal-strength">${STORY_STRENGTH_LABEL[e.strength]}</span>` : ''}
                    ${storyAssistsHTML(e)}
                    <span class="sl-goal-score">${storyGoalScore(e.awayScore, 'away')}<i>-</i>${storyGoalScore(e.homeScore, 'home')}</span>
                    <span class="sl-goal-period">P${escapeHTML(e.period)}</span>
                </div>`).join('');

    return `
        <div class="sl-live" style="${storyTeamVars('away', g.away.abbrev)}; ${storyTeamVars('home', g.home.abbrev)}">
            <div class="sl-top">
                <span class="sl-badge"><span class="sl-badge-dot"></span>En direct</span>
                <span class="sl-league">LNH</span>
            </div>

            <div class="sl-board">
                <img class="sl-mark sl-mark-away" src="teams/${escapeHTML(g.away.abbrev)}.png" alt="" aria-hidden="true" onerror="this.style.display='none'">
                <img class="sl-mark sl-mark-home" src="teams/${escapeHTML(g.home.abbrev)}.png" alt="" aria-hidden="true" onerror="this.style.display='none'">
                <span class="sl-edge sl-edge-away"></span>
                <span class="sl-edge sl-edge-home"></span>
                <span class="sl-rule sl-rule-away"></span>
                <span class="sl-rule sl-rule-home"></span>
${camp('away', g.away, visiteur)}
                <div class="sl-center">
                    <span class="sl-score">${g.away.score}</span>
                    <span class="sl-state">
                        <span class="sl-period">${escapeHTML(periode)}</span>
                        <span class="sl-clock${entracte ? ' is-word' : ''}">${escapeHTML(chrono)}</span>
                        <span class="sl-dots">${pastilles}</span>
                    </span>
                    <span class="sl-score">${g.home.score}</span>
                </div>
${camp('home', g.home, local)}
            </div>

            <div class="sl-goals">${buts || '<div class="sl-goal sl-goal-none">Aucun but pour l’instant.</div>'}</div>
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

    bindStoryHover();
}

/**
 * Mode épinglé : plus de rotation, donc plus de barre de progression — mais
 * la carte doit continuer de suivre le match. On redemande simplement le flux
 * en direct, et loadStories() retombe d'elle-même sur le match épinglé.
 */
function startStoryPinnedRefresh() {
    stopStoryTimer();
    const track = document.querySelector('.stories-progress-track');
    if (track) track.style.display = 'none';
    storyTimer = setTimeout(loadStories, STORY_PINNED_REFRESH_MS);
}

function bindStoryHover() {
    const card = document.getElementById('storiesCard');
    if (!card || card.dataset.hoverBound) return;
    card.dataset.hoverBound = '1';
    card.addEventListener('mouseenter', () => { storyPaused = true; });
    card.addEventListener('mouseleave', () => { storyPaused = false; });
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
    //
    // Hors saison, /current-stats sert les totaux de la dernière saison
    // complétée : c'est ce qu'il faut pour la page Stats, jamais pour un
    // pointage de pool. Un pool repêché en septembre afficherait sinon les
    // points de l'an dernier comme s'ils avaient été marqués pour lui —
    // le même garde-fou existe déjà dans classement.js (seasonStat).
    const playerPts = {};
    if (stats && stats.players && stats.seasonStarted !== false) {
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
    if (!stats || stats.seasonStarted !== false) {
        ((userData.teamsData && userData.teamsData.teams) || []).forEach(t => {
            if (t && t.teamFullName) clubPts[t.teamFullName] = clubPoolPoints(t);
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
