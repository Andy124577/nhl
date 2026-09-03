/* ============================================================ */
/* ACCUEIL DASHBOARD — "Éditorial calme" (2A bureau / 1A téléphone) */
/* Replaces the old .dash-header / home-tabs / my-rankings /       */
/* activity sections. Loaded after activePool.js and accueil.js:   */
/* classic scripts share one global scope, so userData, FZPool,    */
/* getPlayerStats, buildTeamScores, escapeHTML, BASE_URL,          */
/* loadCurrentStats, loadPendingTrades and draftActionFor below    */
/* are all already defined by the time this file runs.             */
/* ============================================================ */

const FR_DOW = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const FR_MONTH = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function dowLabel(dateISO) {
    return FR_DOW[new Date(dateISO + 'T00:00:00Z').getUTCDay()];
}

function dayNum(dateISO) {
    return Number(dateISO.slice(8, 10));
}

function gameTimeLabel(iso) {
    return new Date(iso).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function periodLabel(period, periodType) {
    if (periodType === 'SO') return 'TB';
    if (periodType === 'OT') return 'Prol';
    if (period === 1) return '1<sup>re</sup>';
    return `${period}<sup>e</sup>`;
}

function ordinalHTML(n) {
    return n === 1 ? '1<sup>re</sup>' : `${n}<sup>e</sup>`;
}

function relativeTimeFr(dateStr) {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return 'À l’instant';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} h`;
    return `${Math.floor(h / 24)} j`;
}

/**
 * Journée d'un mouvement ou d'un retour de blessure.
 *
 * Une chaîne « AAAA-MM-JJ » se parse en UTC, pas en heure locale : à
 * Montréal, minuit UTC tombe la veille à 20 h, et le 25 août s'affichait
 * donc « 24 août ». On reconstruit la date à la main pour ces chaînes-là.
 * Les horodatages complets (ESPN, avec heure et fuseau) gardent le
 * parsing normal, qui est correct pour eux.
 */
function dayLabelFr(iso) {
    if (!iso) return '';
    const d = /^\d{4}-\d{2}-\d{2}$/.test(iso)
        ? new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
        : new Date(iso);
    if (isNaN(d)) return '';

    const sameDay = (a, b) => a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const today = new Date();
    if (sameDay(d, today)) return 'Aujourd’hui';
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (sameDay(d, yesterday)) return 'Hier';

    return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
}

function countdownLabel(startISO) {
    const diffMs = new Date(startISO) - new Date();
    if (diffMs <= 0) return '0 h 00';
    const totalMin = Math.floor(diffMs / 60000);
    return `${Math.floor(totalMin / 60)} h ${String(totalMin % 60).padStart(2, '0')}`;
}

function teamLogoImg(abbrev) {
    return `<img class="fzd-team-logo" src="teams/${abbrev}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
}

/** All player names on the active pool's roster, flattened. */
function activeRosterNames() {
    const team = FZPool.team();
    if (!team) return [];
    const td = team.data || {};
    return [...(td.offensive || []), ...(td.defensive || []), ...(td.goalie || []), ...(td.rookie || [])];
}

/** Roster names grouped by their current NHL team abbrev, for calendar game-card counts. */
function rosterTeamCounts() {
    const counts = {};
    activeRosterNames().forEach(name => {
        const abbr = getPlayerStats(name)?.teamAbbrev;
        if (abbr) counts[abbr] = (counts[abbr] || 0) + 1;
    });
    return counts;
}

function rosterCountForGame(counts, game) {
    return (counts[game.away.abbrev] || 0) + (counts[game.home.abbrev] || 0);
}

// ============================================================
// CALENDAR — full-season, backed by GET /schedule/:date (paged via
// nextStartDate/previousStartDate) rather than one hardcoded week.
// ============================================================
let calData = null;
let calSelectedDate = null;
let calMonthOpen = false;
let calMonthCursor = null;

async function fetchSchedule(date) {
    try {
        const res = await fetch(`${BASE_URL}/schedule/${date}`, { cache: 'no-store' });
        if (!res.ok) return { days: [], nextStartDate: null, previousStartDate: null };
        return await res.json();
    } catch (err) {
        console.warn('Could not load schedule:', err);
        return { days: [], nextStartDate: null, previousStartDate: null };
    }
}

async function initCalendar() {
    const today = todayISO();
    calData = await fetchSchedule(today);
    calSelectedDate = calData.days.find(d => d.date === today) ? today : (calData.days[0]?.date || today);
    renderCalendar();
    renderOffseasonPanel();
}

function renderCalendar() {
    renderCalEyebrow();
    renderDayStrip();
    renderDayGames();
}

function renderCalEyebrow() {
    const eyebrow = document.getElementById('fzdCalEyebrow');
    if (!eyebrow) return;
    const d = new Date((calSelectedDate || todayISO()) + 'T00:00:00Z');
    eyebrow.textContent = `Calendrier — ${FR_MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function renderDayStrip() {
    const strip = document.getElementById('fzdCalStrip');
    if (!strip || !calData) return;
    const today = todayISO();

    strip.innerHTML = calData.days.map(d => {
        const isToday = d.date === today;
        const isSelected = d.date === calSelectedDate;
        return `
            <button type="button" class="fzd-day-chip${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}" data-date="${d.date}">
                <div class="fzd-day-chip-dow">${isToday ? 'Auj' : dowLabel(d.date)}</div>
                <div class="fzd-day-chip-num">${dayNum(d.date)}</div>
            </button>`;
    }).join('');

    strip.querySelectorAll('.fzd-day-chip').forEach(btn => {
        btn.addEventListener('click', () => selectCalendarDay(btn.dataset.date));
    });
}

function renderDayGames() {
    const wrap = document.getElementById('fzdCalGames');
    if (!wrap || !calData) return;

    const day = calData.days.find(d => d.date === calSelectedDate);
    const games = (day && day.games) || [];

    if (!games.length) {
        wrap.innerHTML = `<p class="fzd-cal-empty">Aucun match cette journée.</p>`;
        return;
    }

    const counts = rosterTeamCounts();
    wrap.innerHTML = games.map(g => gameCardHTML(g, counts)).join('');
}

function gameCardHTML(game, rosterCounts) {
    const isFinal = game.state === 'FINAL' || game.state === 'OFF';
    const isLive = game.state === 'LIVE' || game.state === 'CRIT';
    const isScheduled = !isFinal && !isLive;
    const count = rosterCountForGame(rosterCounts, game);

    let statusHTML;
    if (isLive) {
        statusHTML = `<div class="fzd-game-status"><span class="fzd-live-dot"></span>${periodLabel(game.period, game.periodType)} ${escapeHTML(game.clock?.timeRemaining || '')}</div>`;
    } else if (isFinal) {
        statusHTML = `<div class="fzd-game-status">Final</div>`;
    } else {
        statusHTML = `<div class="fzd-game-status">${gameTimeLabel(game.startTimeUTC)}</div>`;
    }

    const teamRow = (side, opponent) => {
        const trailing = !isScheduled && (side.score ?? 0) < (opponent.score ?? 0);
        const scoreCell = isScheduled
            ? `<div class="fzd-team-score is-dash">—</div>`
            : `<div class="fzd-team-score${trailing ? ' is-trailing' : ''}">${side.score ?? 0}</div>`;
        return `
            <div class="fzd-game-row">
                <div class="fzd-game-team">${teamLogoImg(side.abbrev)}<div class="fzd-team-abbr${trailing ? ' is-trailing' : ''}">${side.abbrev}</div></div>
                ${scoreCell}
            </div>`;
    };

    return `
        <div class="fzd-game-card${isScheduled ? ' is-scheduled' : ''}${isFinal ? ' is-final' : ''}">
            ${statusHTML}
            ${teamRow(game.away, game.home)}
            ${teamRow(game.home, game.away)}
            <div class="fzd-game-foot">${count > 0 ? `${count} de vos joueurs` : 'Aucun joueur'}</div>
        </div>`;
}

async function selectCalendarDay(dateStr) {
    if (calData && calData.days.some(d => d.date === dateStr)) {
        calSelectedDate = dateStr;
        renderCalendar();
        return;
    }
    calData = await fetchSchedule(dateStr);
    calSelectedDate = (calData.days.find(d => d.date === dateStr) || calData.days[0] || {}).date || dateStr;
    renderCalendar();
}

async function calGoPrevWeek() {
    if (!calData || !calData.previousStartDate) return;
    calData = await fetchSchedule(calData.previousStartDate);
    calSelectedDate = calData.days[calData.days.length - 1]?.date || calData.previousStartDate;
    renderCalendar();
}

async function calGoNextWeek() {
    if (!calData || !calData.nextStartDate) return;
    calData = await fetchSchedule(calData.nextStartDate);
    calSelectedDate = calData.days[0]?.date || calData.nextStartDate;
    renderCalendar();
}

// ---- Month picker: replaces the mockup's dead "saison complète" link
// with a real jump-to-any-date panel, still backed by /schedule/:date. ----
function toggleMonthPicker() {
    calMonthOpen = !calMonthOpen;
    const panel = document.getElementById('fzdCalMonth');
    if (!panel) return;
    panel.classList.toggle('is-open', calMonthOpen);
    if (calMonthOpen) {
        const base = new Date((calSelectedDate || todayISO()) + 'T00:00:00Z');
        calMonthCursor = { year: base.getUTCFullYear(), month: base.getUTCMonth() };
        renderMonthGrid();
    }
}

function renderMonthGrid() {
    const grid = document.getElementById('fzdMonthGrid');
    const label = document.getElementById('fzdMonthLabel');
    if (!grid || !calMonthCursor) return;

    const { year, month } = calMonthCursor;
    if (label) label.textContent = `${FR_MONTH[month]} ${year}`;

    const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const today = todayISO();

    let cells = FR_DOW.map(d => `<div class="fzd-month-dow">${d}</div>`).join('');
    for (let i = 0; i < firstDow; i++) cells += `<div class="fzd-month-cell is-empty"></div>`;
    for (let day = 1; day <= daysInMonth; day++) {
        const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cls = ['fzd-month-cell'];
        if (iso === today) cls.push('is-today');
        if (iso === calSelectedDate) cls.push('is-selected');
        cells += `<button type="button" class="${cls.join(' ')}" data-date="${iso}">${day}</button>`;
    }

    grid.innerHTML = cells;
    grid.querySelectorAll('.fzd-month-cell[data-date]').forEach(btn => {
        btn.addEventListener('click', async () => {
            await selectCalendarDay(btn.dataset.date);
            toggleMonthPicker();
        });
    });
}

function monthPrev() {
    calMonthCursor.month -= 1;
    if (calMonthCursor.month < 0) { calMonthCursor.month = 11; calMonthCursor.year -= 1; }
    renderMonthGrid();
}

function monthNext() {
    calMonthCursor.month += 1;
    if (calMonthCursor.month > 11) { calMonthCursor.month = 0; calMonthCursor.year += 1; }
    renderMonthGrid();
}

// ============================================================
// TONIGHT — real per-player live/final stat lines (GET /tonight-boxscores)
// and real rank movement (GET /pool-rank-movement/:poolName).
// ============================================================
async function fetchTonightBoxscores() {
    try {
        const res = await fetch(`${BASE_URL}/tonight-boxscores`, { cache: 'no-store' });
        return res.ok ? await res.json() : { players: [], games: [] };
    } catch (err) {
        console.warn('Could not load tonight boxscores:', err);
        return { players: [], games: [] };
    }
}

async function fetchRankMovement(poolName) {
    try {
        const res = await fetch(`${BASE_URL}/pool-rank-movement/${encodeURIComponent(poolName)}`, { cache: 'no-store' });
        return res.ok ? await res.json() : { hasSnapshot: false, teams: [] };
    } catch (err) {
        console.warn('Could not load rank movement:', err);
        return { hasSnapshot: false, teams: [] };
    }
}

/** Fetches tonight's boxscores + rank movement once; shared by the desktop
 *  live panel and the phone home (renderMobileHome, accueil-mobile.js) so a
 *  page load never fires the same two requests twice. */
async function loadDashData() {
    const team = FZPool.team();
    const activeName = FZPool.get();
    if (!team || !activeName) return null;
    const [tonight, movement] = await Promise.all([fetchTonightBoxscores(), fetchRankMovement(activeName)]);
    return { tonight, movement, activeName };
}

function renderLivePanel(tonight, movement, activeName) {
    const liveContainer = document.getElementById('fzdLivePanel');
    const playersContainer = document.getElementById('fzdPlayersList');
    if (!liveContainer || !playersContainer) return;

    const rosterNames = new Set(activeRosterNames());
    const myLines = (tonight.players || [])
        .filter(p => rosterNames.has(p.playerName))
        .sort((a, b) => (b.fantasyPointsTonight || 0) - (a.fantasyPointsTonight || 0));

    renderPlayersList(playersContainer, myLines, tonight.games || []);

    if ((tonight.games || []).length > 0) {
        renderLiveActive(liveContainer, myLines, tonight.games, movement, activeName);
    } else {
        renderPregame(liveContainer);
    }
}

function gameLineFor(playerLine, games) {
    const g = games.find(x => x.id === playerLine.gameId);
    if (!g) return '';
    const state = g.state;
    const scoreLine = `${g.away.abbrev} ${g.away.score} – ${g.home.abbrev} ${g.home.score}`;
    if (state === 'LIVE' || state === 'CRIT') {
        return `${scoreLine} · ${periodLabel(g.period, g.periodType)} ${escapeHTML(g.clock?.timeRemaining || '')}`;
    }
    if (state === 'FINAL' || state === 'OFF') return `${scoreLine} · Final`;
    return scoreLine;
}

function renderPlayersList(container, myLines, games) {
    if (!myLines.length) {
        container.innerHTML = `<p class="fzd-players-empty">Aucun de vos joueurs n'est à l'horaire aujourd'hui.</p>`;
        return;
    }

    container.innerHTML = myLines.map(p => {
        const pts = p.fantasyPointsTonight || 0;
        return `
            <div class="fzd-player-row">
                <div class="fzd-player-badge">${teamLogoImg(p.teamAbbrev)}</div>
                <div class="fzd-player-id">
                    <div class="fzd-player-name">${escapeHTML(p.playerName)}</div>
                    <div class="fzd-player-meta">${gameLineFor(p, games)}</div>
                </div>
                <div class="fzd-player-pts${pts === 0 ? ' is-zero' : ''}">${pts > 0 ? '+' : ''}${pts}</div>
            </div>`;
    }).join('');
}

function renderLiveActive(container, myLines, games, movement, activeName) {
    const totalPts = myLines.reduce((s, p) => s + (p.fantasyPointsTonight || 0), 0);
    const playersInAction = myLines.filter(p => {
        const g = games.find(x => x.id === p.gameId);
        return g && (g.state === 'LIVE' || g.state === 'CRIT');
    }).length;
    const gamesInProgress = games.filter(g => g.state === 'LIVE' || g.state === 'CRIT').length;

    let rankHTML = '';
    const teamRow = movement.teams?.find(t => t.teamName === FZPool.team()?.name);
    if (teamRow) {
        if (movement.hasSnapshot && teamRow.rankToday != null && teamRow.rankToday !== teamRow.rankNow) {
            const moved = teamRow.rankToday - teamRow.rankNow; // positive = moved up
            const arrow = moved > 0 ? '▲' : '▼';
            rankHTML = `
                <div class="fzd-live-rank">
                    <span class="fzd-live-rank-move">${arrow} ${Math.abs(moved)} place${Math.abs(moved) > 1 ? 's' : ''}</span>
                    <span> · ${ordinalHTML(teamRow.rankToday)} → ${ordinalHTML(teamRow.rankNow)} dans ${escapeHTML(activeName)}</span>
                </div>`;
        } else {
            rankHTML = `<div class="fzd-live-rank">${ordinalHTML(teamRow.rankNow)} dans ${escapeHTML(activeName)}</div>`;
        }
    }

    container.innerHTML = `
        <div class="fzd-live-head">
            <span class="fzd-live-dot"></span>
            <span class="fzd-live-badge">En direct</span>
            <span class="fzd-live-rule"></span>
            <span class="fzd-live-updated">Mis à jour à l'instant</span>
        </div>
        <div class="fzd-live-hero">
            <div class="fzd-live-score fzd-display">${totalPts > 0 ? '+' : ''}${totalPts}</div>
            <div class="fzd-live-score-lbl fzd-display">pts<br>ce soir</div>
        </div>
        ${rankHTML}
        <div class="fzd-live-stats">
            <div class="fzd-live-stat"><div class="fzd-live-stat-num fzd-display">${playersInAction}</div><div class="fzd-live-stat-lbl">joueurs en action</div></div>
            <div class="fzd-live-stat"><div class="fzd-live-stat-num fzd-display">${gamesInProgress}</div><div class="fzd-live-stat-lbl">matchs en cours</div></div>
        </div>`;
}

function renderPregame(container) {
    const today = calData?.days.find(d => d.date === todayISO());
    const upcoming = (today?.games || []).filter(g => g.state === 'FUT' || g.state === 'PRE');

    if (!upcoming.length) {
        container.innerHTML = `<p class="fzd-live-empty">Aucun match à votre horaire aujourd'hui.</p>`;
        return;
    }

    const counts = rosterTeamCounts();
    const next = upcoming.slice().sort((a, b) => new Date(a.startTimeUTC) - new Date(b.startTimeUTC))[0];
    const rosterPlayersToday = Object.entries(counts)
        .filter(([abbr]) => upcoming.some(g => g.away.abbrev === abbr || g.home.abbrev === abbr))
        .reduce((s, [, n]) => s + n, 0);

    container.innerHTML = `
        <div class="fzd-pregame-lbl">Prochains matchs</div>
        <div class="fzd-pregame-clock fzd-display">${countdownLabel(next.startTimeUTC)}</div>
        <div class="fzd-pregame-sub">Avant la mise au jeu${rosterPlayersToday ? ` · ${rosterPlayersToday} de vos joueurs sont à l'horaire` : ''}</div>
        <div class="fzd-pregame-list">
            ${upcoming.map(g => {
                const count = rosterCountForGame(counts, g);
                return `
                    <div class="fzd-pregame-row">
                        <span class="fzd-pregame-time fzd-display">${gameTimeLabel(g.startTimeUTC)}</span>
                        <span>${g.away.abbrev} – ${g.home.abbrev}</span>
                        <span class="fzd-pregame-sep">·</span>
                        <span class="fzd-pregame-count">${count > 0 ? `${count} joueur${count > 1 ? 's' : ''}` : 'Aucun joueur'}</span>
                    </div>`;
            }).join('')}
        </div>`;
}

// ============================================================
// REPÊCHAGE / ÉCHANGES — quick-action tiles, same logic
// renderPoolGlance used to drive (accueil.js's draftActionFor).
// ============================================================
function draftTileDetail(state, activeName) {
    if (state.etat === 'encours') return `${escapeHTML(activeName)} · choix ${(state.choixFait || 0) + 1}/${state.choixTotal || '—'}`;
    if (state.etat === 'termine') return 'Saison en cours';
    if (state.etat === 'pret') return `${escapeHTML(activeName)} · prêt à démarrer`;
    return `${escapeHTML(activeName)} · en attente de joueurs`;
}

function renderQuickActions() {
    const container = document.getElementById('fzdQuickActions');
    const activeName = FZPool.get();
    const poolData = FZPool.data();
    const team = FZPool.team();
    if (!container || !activeName || !poolData || !team) return;

    const state = FZPool.draftState(poolData);
    const action = draftActionFor({ data: poolData, name: activeName, teamName: team.name, teamData: team.data });
    const draftFallback = { attente: 'En attente de joueurs', termine: 'Terminé' };

    const draftValue = action ? action.label : (draftFallback[state.etat] || '—');
    const draftHref = action ? action.href : `repechage.html?pool=${encodeURIComponent(activeName)}`;
    const draftLive = action?.kind === 'your-turn';

    const activeTrades = (userData.pendingTrades || []).filter(t => t.draftName === activeName);
    const tradeValue = activeTrades.length ? `${activeTrades.length} offre${activeTrades.length > 1 ? 's' : ''} reçue${activeTrades.length > 1 ? 's' : ''}` : 'Aucune offre en attente';
    const tradeHref = activeTrades.length ? `trade.html?trade=${encodeURIComponent(activeTrades[0].id)}` : 'trade.html';
    const tradeDetail = activeTrades.length ? `${escapeHTML(activeTrades[0].fromTeam || '')} propose un échange` : `${escapeHTML(activeName)} · rien à traiter`;

    container.innerHTML = `
        <div class="fzd-actions-grid">
            <a class="fzd-action-tile${draftLive ? ' is-attention' : ''}" href="${draftHref}">
                <div class="fzd-action-eyebrow">Repêchage</div>
                <div class="fzd-action-value fzd-display">${escapeHTML(draftValue)}</div>
                <div class="fzd-action-detail">${draftTileDetail(state, activeName)}</div>
            </a>
            <a class="fzd-action-tile${activeTrades.length ? ' is-attention' : ''}" href="${tradeHref}">
                <div class="fzd-action-eyebrow">Échanges</div>
                <div class="fzd-action-value fzd-display">${escapeHTML(tradeValue)}</div>
                <div class="fzd-action-detail">${tradeDetail}</div>
            </a>
        </div>`;
}

// ============================================================
// HERO — bannière d'état pleine largeur (Canvas-9, Tour 2 : 2A
// bureau). Repêchage en cours / avant-saison / en direct ; masquée
// en saison régulière normale (fz-dash-live plus bas couvre déjà ce
// cas). Bureau seulement — accueil-mobile.js détecte les 4 mêmes
// états pour son propre écran, indépendamment de celui-ci.
// ============================================================
function fzdFormatElapsed(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m > 0 ? `${m} min` : `${s} s`;
}

function fzdHeroState(tonight) {
    const poolData = FZPool.data();
    const team = FZPool.team();
    const activeName = FZPool.get();
    if (!poolData || !team || !activeName) return null;

    const draftState = FZPool.draftState(poolData);
    const isDraft = draftState.etat === 'encours';
    const today = todayISO();
    const seasonStart = calData?.regularSeasonStartDate;
    const isPreseason = !isDraft && !!seasonStart && today < seasonStart;

    if (isDraft) return { mode: 'draft', poolData, team, activeName };

    if (isPreseason) {
        const campStart = calData?.preSeasonStartDate;
        const beforeCamp = !!campStart && today < campStart;
        return { mode: 'preseason', target: beforeCamp ? campStart : seasonStart, beforeCamp };
    }

    const rosterNames = new Set(activeRosterNames());
    const myLines = (tonight?.players || []).filter(p => rosterNames.has(p.playerName));
    const liveCount = myLines.filter(p => {
        const g = (tonight?.games || []).find(x => x.id === p.gameId);
        return g && (g.state === 'LIVE' || g.state === 'CRIT');
    }).length;
    if (liveCount > 0) {
        const totalPts = myLines.reduce((s, p) => s + (p.fantasyPointsTonight || 0), 0);
        return { mode: 'live', liveCount, totalPts };
    }

    return { mode: 'regular' };
}

function fzdCountdownStatsHTML(targetISO) {
    const diff = Math.max(0, new Date(targetISO + 'T00:00:00Z').getTime() - Date.now());
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    return `
        <div class="fzd-hero-stat"><span class="fzd-hero-stat-lbl">Jours</span><span class="fzd-hero-stat-val">${d}</span></div>
        <div class="fzd-hero-stat-sep" aria-hidden="true"></div>
        <div class="fzd-hero-stat"><span class="fzd-hero-stat-lbl">Heures</span><span class="fzd-hero-stat-val">${String(h).padStart(2, '0')}</span></div>`;
}

function fzdHeroHTML(state) {
    if (state.mode === 'draft') {
        const { poolData, team, activeName } = state;
        const draftOrder = Array.isArray(poolData.draftOrder) ? poolData.draftOrder : [];
        const numTeams = new Set(draftOrder).size || 1;
        const idx = poolData.currentPickIndex || 0;
        const round = Math.floor(idx / numTeams) + 1;
        const totalRounds = Math.max(round, Math.round(draftOrder.length / numTeams) || round);
        const started = Number(poolData.turnStartedAt) || 0;
        const elapsed = started ? fzdFormatElapsed(Date.now() - started) : '—';

        let away = -1;
        for (let i = idx; i < draftOrder.length; i++) {
            if (draftOrder[i] === team.name) { away = i - idx; break; }
        }
        const eyebrow = away === 0 ? "C'est votre tour"
            : away > 0 ? `Votre tour dans ${away} choix`
            : 'Repêchage en cours';

        return `
            <span class="fzd-hero-shield" aria-hidden="true">F</span>
            <div class="fzd-hero-copy">
                <div class="fzd-hero-eyebrow">${escapeHTML(eyebrow)}</div>
                <h2 class="fzd-hero-headline">Repêchage en cours</h2>
            </div>
            <div class="fzd-hero-stats">
                <div class="fzd-hero-stat"><span class="fzd-hero-stat-lbl">Ronde</span><span class="fzd-hero-stat-val">${round} / ${totalRounds}</span></div>
                <div class="fzd-hero-stat-sep" aria-hidden="true"></div>
                <div class="fzd-hero-stat"><span class="fzd-hero-stat-lbl">Attente</span><span class="fzd-hero-stat-val">${elapsed}</span></div>
            </div>
            <a class="fzd-hero-cta" href="draftActif.html?pool=${encodeURIComponent(activeName)}">
                <span class="fzd-hero-cta-bar" aria-hidden="true"></span>
                <span class="fzd-hero-cta-label">Aller au repêchage</span>
                <span class="fzd-hero-cta-chev" aria-hidden="true">›</span>
            </a>`;
    }

    if (state.mode === 'preseason') {
        return `
            <span class="fzd-hero-shield" aria-hidden="true">F</span>
            <div class="fzd-hero-copy">
                <div class="fzd-hero-eyebrow">${state.beforeCamp ? "Avant le camp d'entraînement" : 'Avant le début de la saison'}</div>
                <h2 class="fzd-hero-headline">Saison en préparation</h2>
            </div>
            <div class="fzd-hero-stats">${fzdCountdownStatsHTML(state.target)}</div>
            <a class="fzd-hero-cta" href="mes-pools.html">
                <span class="fzd-hero-cta-bar" aria-hidden="true"></span>
                <span class="fzd-hero-cta-label">Gérer mon équipe</span>
                <span class="fzd-hero-cta-chev" aria-hidden="true">›</span>
            </a>`;
    }

    // 'live'
    return `
        <span class="fzd-hero-shield" aria-hidden="true">F</span>
        <div class="fzd-hero-copy">
            <div class="fzd-hero-eyebrow"><span class="fzd-hero-live-dot" aria-hidden="true"></span>En direct</div>
            <h2 class="fzd-hero-headline">${state.liveCount} de vos joueurs ${state.liveCount > 1 ? 'sont' : 'est'} sur la glace</h2>
        </div>
        <div class="fzd-hero-stats">
            <div class="fzd-hero-stat"><span class="fzd-hero-stat-lbl">Points</span><span class="fzd-hero-stat-val">${state.totalPts > 0 ? '+' : ''}${state.totalPts}</span></div>
            <div class="fzd-hero-stat-sep" aria-hidden="true"></div>
            <div class="fzd-hero-stat"><span class="fzd-hero-stat-lbl">En action</span><span class="fzd-hero-stat-val">${state.liveCount}</span></div>
        </div>
        <a class="fzd-hero-cta" href="#fzdPlayersList">
            <span class="fzd-hero-cta-bar" aria-hidden="true"></span>
            <span class="fzd-hero-cta-label">Voir les pointages</span>
            <span class="fzd-hero-cta-chev" aria-hidden="true">›</span>
        </a>`;
}

let fzdHeroTimer = null;

function fzdStopHeroTimer() {
    if (fzdHeroTimer) { clearInterval(fzdHeroTimer); fzdHeroTimer = null; }
}

/** Called from renderDash() with the same tonight-boxscores it already loaded. */
function renderHero(tonight) {
    const container = document.getElementById('fzDashHero');
    if (!container) return;
    fzdStopHeroTimer();

    const state = fzdHeroState(tonight);
    if (!state || state.mode === 'regular') {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    container.style.display = '';
    container.innerHTML = fzdHeroHTML(state);

    // Repêchage : le temps d'attente avance à la seconde. Avant-saison : le
    // compte à rebours suffit à l'heure. Les deux se recalculent depuis la
    // même source de vérité (fzdHeroState) plutôt que de dériver localement,
    // pour ne jamais désynchroniser d'un tour de repêchage ou d'un minuit.
    if (state.mode === 'draft' || state.mode === 'preseason') {
        fzdHeroTimer = setInterval(() => {
            const fresh = fzdHeroState(tonight);
            if (!fresh || fresh.mode !== state.mode) { renderHero(tonight); return; }
            container.innerHTML = fzdHeroHTML(fresh);
        }, 1000);
    }
}

// ============================================================
// MES POOLS — every pool the user is in, same ranking data
// buildTeamScores already computes for classement.html parity.
// ============================================================
function renderMyPoolsList() {
    const container = document.getElementById('fzdMyPoolsList');
    const countEl = document.getElementById('fzdMyPoolsCount');
    const seeAll = document.getElementById('fzdMyPoolsSeeAll');
    if (!container) return;

    const pools = userData.userPools || [];
    if (countEl) countEl.textContent = pools.length ? `${pools.length} au total` : '';
    if (seeAll) seeAll.textContent = pools.length > 1 ? `Voir les ${pools.length} pools →` : (pools.length === 1 ? 'Voir mon pool →' : '');

    if (!pools.length) {
        container.innerHTML = `<p class="fzd-players-empty">Vous n'êtes dans aucun pool.</p>`;
        return;
    }

    container.innerHTML = pools.slice(0, 3).map(pool => {
        const scores = buildTeamScores(pool);
        const claimed = scores.filter(t => t.memberCount > 0);
        const list = claimed.length ? claimed : scores;
        const idx = list.findIndex(t => t.isCurrentUser);
        const mine = idx >= 0 ? list[idx] : null;
        const trendCls = mine ? (mine.trend === 'up' ? 'fzd-pool-trend-up' : mine.trend === 'down' ? 'fzd-pool-trend-down' : 'fzd-pool-trend-flat') : 'fzd-pool-trend-flat';
        const trendGlyph = mine ? (mine.trend === 'up' ? '▲' : mine.trend === 'down' ? '▼' : '–') : '–';

        return `
            <div class="fzd-pool-row">
                <div class="fzd-pool-icon"></div>
                <div class="fzd-pool-id">
                    <div class="fzd-pool-name">${escapeHTML(pool.name)}</div>
                    <div class="fzd-pool-meta">${mine ? Math.round(mine.score) : 0} pts<span class="fzd-pool-sep"> · </span><span class="${trendCls}">${trendGlyph}</span></div>
                </div>
                <div class="fzd-pool-rank">
                    <div class="fzd-pool-rank-num fzd-display">${idx >= 0 ? idx + 1 : '—'}</div>
                    <div class="fzd-pool-rank-total fzd-display">/${list.length}</div>
                </div>
            </div>`;
    }).join('');
}

// ============================================================
// ACTIVITÉ DE LA LIGUE — real completed trades only (see the plan:
// this app has no waiver-claim feature and no timestamped join log,
// so those mockup item types are dropped rather than invented).
// ============================================================
async function renderActivityFeed() {
    const container = document.getElementById('fzdActivityList');
    const activeName = FZPool.get();
    if (!container || !activeName) return;

    try {
        const res = await fetch(`${BASE_URL}/trades/${encodeURIComponent(activeName)}`, { cache: 'no-store' });
        const trades = res.ok ? await res.json() : [];

        if (!trades.length) {
            container.innerHTML = `<p class="fzd-activity-empty">Aucun échange complété dans ce pool.</p>`;
            return;
        }

        container.innerHTML = trades.slice(0, 8).map(trade => {
            const offering = trade.offering && trade.offering[0];
            const receiving = trade.receiving && trade.receiving[0];
            const dateRaw = trade.completedDate || trade.date;
            const timeLabel = dateRaw ? relativeTimeFr(dateRaw) : '';
            const text = offering && receiving
                ? `Échange complété : <strong>${escapeHTML(offering.name)}</strong> ↔ <strong>${escapeHTML(receiving.name)}</strong> (${escapeHTML(trade.fromTeam)} ⇄ ${escapeHTML(trade.toTeam)}).`
                : `Échange complété entre <strong>${escapeHTML(trade.fromTeam)}</strong> et <strong>${escapeHTML(trade.toTeam)}</strong>.`;
            return `<div class="fzd-activity-row"><div class="fzd-activity-time fzd-display">${timeLabel}</div><div class="fzd-activity-text">${text}</div></div>`;
        }).join('');
    } catch (err) {
        console.warn('Could not load activity feed:', err);
        container.innerHTML = `<p class="fzd-activity-empty">Impossible de charger l'activité.</p>`;
    }
}

// ============================================================
// HORS-SAISON — countdown to camp/season start plus real trade &
// signing headlines. Shown under the calendar only while the coming
// regular season hasn't started (see renderOffseasonPanel); computed
// from the same /schedule/:date response that already backs the
// calendar, which the NHL API keeps pointed at the *next* season's
// dates throughout the off-season (verified: it flips over the day
// after playoffEndDate, so this never fires mid-playoffs).
// ============================================================

// Manually curated, updated by hand each off-season — there is no
// live API for an editorial "watch" pick, and this app never invents
// content to fill a gap (see the real trades used above instead of a
// fabricated waiver-wire feed). Leave empty to hide the section.
const OFFSEASON_WATCHLIST = [
    // { name: 'Nom Joueur', team: 'MTL', note: 'Recrue attendue au camp d\'entraînement.' },
];

let offseasonNewsLoaded = false;

function renderOffseasonPanel() {
    const panel = document.getElementById('fzDashOffseason');
    if (!panel || !calData) return;

    const today = todayISO();
    const seasonStart = calData.regularSeasonStartDate;

    if (!seasonStart || today >= seasonStart) {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = '';

    const campStart = calData.preSeasonStartDate;
    const beforeCamp = !!campStart && today < campStart;
    const target = beforeCamp ? campStart : seasonStart;
    const days = Math.max(0, Math.ceil((new Date(target + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000));

    document.getElementById('fzdOffDays').textContent = `${days} j`;
    document.getElementById('fzdOffSub').textContent = beforeCamp ? "Avant le camp d'entraînement" : 'Avant le début de la saison';

    renderOffseasonWatchlist();
    if (!offseasonNewsLoaded) {
        offseasonNewsLoaded = true;
        loadOffseasonTransactions();
    }
}

// Mouvements réels déduits des alignements officiels côté serveur
// (/nhl-transactions) plutôt que titres de presse : le journal nomme le
// joueur, les deux clubs et la date en clair, là où un titre NewsAPI
// laissait au lecteur le soin de décoder la phrase — et attrape les
// mouvements discrets dont aucun média ne parle. Les blessés viennent
// d'ESPN (/nhl-injuries), api-web n'en publiant aucun.
let offseasonLeague = null;
let offseasonTab = 'trade';
const OFFSEASON_TABS = ['trade', 'signing', 'injury'];

// Pages du panneau : 6 lignes par page, position mémorisée par onglet pour
// qu'un aller-retour Échanges → Blessés → Échanges ne renvoie pas au début.
const OFFSEASON_PAGE_SIZE = 6;
const offseasonPages = { trade: 0, signing: 0, injury: 0 };

async function loadOffseasonTransactions() {
    const wrap = document.getElementById('fzdOffTransactions');
    if (!wrap) return;

    // On demande tout le journal (TRANSACTIONS_KEEP=250, cap blessés=300) :
    // le panneau se feuillette page par page, donc chaque onglet doit avoir
    // sa liste complète en main — et groupTrades voit ainsi tout l'échange,
    // pas une moitié tronquée par la fenêtre.
    const [tx, inj] = await Promise.all([
        fetch('/nhl-transactions?limit=250').then(r => r.json()).catch(() => null),
        fetch('/nhl-injuries?limit=300').then(r => r.json()).catch(() => null)
    ]);

    const moves = tx?.transactions || [];
    const deals = groupTrades(moves.filter(t => t.type === 'trade'));
    offseasonLeague = {
        trade: deals,
        signing: moves.filter(t => t.type === 'signing'),
        injury: inj?.injuries || [],
        counts: {
            // Échanges : un décompte d'opérations (après regroupement), pas de
            // lignes-joueur — c'est ce que le panneau affiche désormais. Pour
            // signatures/blessés, le total serveur permet le « et N autres ».
            trade: deals.length,
            signing: tx?.counts?.signing || 0,
            injury: inj?.total || 0
        },
        tracking: !!tx?.tracking
    };

    // Ouvrir sur un onglet qui a de quoi montrer plutôt que sur « Échanges »
    // vide un lendemain de journée calme.
    const firstFilled = OFFSEASON_TABS.find(k => offseasonLeague[k].length);
    if (firstFilled && !offseasonLeague[offseasonTab].length) offseasonTab = firstFilled;

    // Appelé une seule fois (garde offseasonNewsLoaded), donc pas de
    // risque d'empiler les écouteurs.
    document.querySelectorAll('#fzdOffTabs .fzd-off-tab').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.tab === offseasonTab);
        btn.addEventListener('click', () => {
            offseasonTab = btn.dataset.tab;
            document.querySelectorAll('#fzdOffTabs .fzd-off-tab')
                .forEach(b => b.classList.toggle('is-active', b === btn));
            renderOffseasonLeague();
        });
    });

    renderOffseasonLeague();
}

function renderOffseasonLeague() {
    const wrap = document.getElementById('fzdOffTransactions');
    if (!wrap || !offseasonLeague) return;

    const rows = offseasonLeague[offseasonTab] || [];
    if (!rows.length) {
        wrap.innerHTML = `<p class="fzd-off-empty">${offseasonEmptyText()}</p>`;
        return;
    }

    // Le panneau est une carte de tableau de bord, pas une page de
    // rapport : 96 blessés à la file l'étiraient sur plusieurs écrans et
    // noyaient « À surveiller » dessous. On les découpe en pages de six
    // qu'on feuillette sur place, sans quitter l'index.
    const pageCount = Math.ceil(rows.length / OFFSEASON_PAGE_SIZE);
    let page = offseasonPages[offseasonTab] || 0;
    if (page > pageCount - 1) page = pageCount - 1;
    if (page < 0) page = 0;
    offseasonPages[offseasonTab] = page;

    const start = page * OFFSEASON_PAGE_SIZE;
    const shown = rows.slice(start, start + OFFSEASON_PAGE_SIZE);

    // Ce qui reste au-delà de ce que le serveur a renvoyé (fenêtre limit) :
    // impossible à feuilleter, on le signale sur la dernière page.
    const total = offseasonLeague.counts?.[offseasonTab] || rows.length;
    const beyond = page === pageCount - 1 ? Math.max(0, total - rows.length) : 0;

    const rowHTML = offseasonTab === 'injury' ? injuryRowHTML
        : offseasonTab === 'trade' ? dealRowHTML
        : movementRowHTML;
    wrap.innerHTML = shown.map(rowHTML).join('')
        + (beyond ? `<p class="fzd-move-more">et ${beyond} autre${beyond > 1 ? 's' : ''}</p>` : '')
        + offseasonPagerHTML(page, pageCount);

    const pager = wrap.querySelector('.fzd-move-pager');
    if (pager) {
        pager.addEventListener('click', e => {
            const btn = e.target.closest('button[data-page]');
            if (!btn || btn.disabled) return;
            offseasonPages[offseasonTab] = Number(btn.dataset.page);
            renderOffseasonLeague();
            wrap.scrollIntoView({ block: 'nearest' });
        });
    }
}

function offseasonPagerHTML(page, pageCount) {
    if (pageCount < 2) return '';
    const first = page === 0;
    const last = page === pageCount - 1;
    return `
        <div class="fzd-move-pager">
            <button type="button" class="fzd-pager-btn" data-page="${page - 1}"${first ? ' disabled' : ''} aria-label="Page précédente">‹</button>
            <span class="fzd-pager-info">Page ${page + 1} / ${pageCount}</span>
            <button type="button" class="fzd-pager-btn" data-page="${page + 1}"${last ? ' disabled' : ''} aria-label="Page suivante">›</button>
        </div>`;
}

// Regroupe les lignes-joueur d'un même échange (même date + même paire de
// clubs) en une seule opération à deux côtés — « X ⇄ Y : X reçoit…, Y
// reçoit… ». Une opération à trois clubs se scinde en paires, comme sur
// NHL.com. L'ordre d'arrivée (déjà trié du plus récent au plus ancien par
// le serveur) est préservé.
function groupTrades(list) {
    const deals = new Map();
    (list || []).forEach(t => {
        const to = t.toTeam || '?';
        const from = t.fromTeam || '?';
        const [a, b] = [from, to].sort();
        const key = `${t.date}|${a}-${b}`;
        let d = deals.get(key);
        if (!d) { d = { date: t.date, teamA: a, teamB: b, gets: {}, names: {} }; deals.set(key, d); }
        // L'abréviation reste la clé (et la source du logo) ; le nom complet
        // sert d'en-tête de colonne, la carte ayant désormais la place de
        // l'écrire.
        if (t.toTeamName) d.names[to] = t.toTeamName;
        if (t.fromTeamName) d.names[from] = t.fromTeamName;
        (d.gets[to] = d.gets[to] || []).push({ name: t.playerName, pos: t.pos || '' });
    });
    return [...deals.values()];
}

/**
 * Un échange : les deux clubs côte à côte, ce que chacun reçoit dessous.
 *
 * Remplace la ligne compacte « ABC ⇄ XYZ » suivie de deux lignes de noms,
 * qui obligeait à relire l'abréviation en tête de chaque ligne pour savoir
 * qui obtenait quoi. Deux colonnes le disent d'un coup d'œil, et c'est la
 * seule disposition qui tienne encore sur un téléphone : la ligne compacte
 * y repliait les noms sous une abréviation orpheline.
 *
 * Le nom complet du club et son abréviation sont rendus tous les deux ;
 * c'est le CSS qui choisit selon la largeur, pas une mesure en JS.
 */
function dealRowHTML(d) {
    const colHTML = team => {
        const club = d.names[team] || team;
        const players = d.gets[team] || [];
        const assets = players.length
            ? players.map(p => `
                <li class="fzd-deal-asset">
                    <span class="fzd-deal-asset-name">${escapeHTML(p.name)}</span>
                    ${p.pos ? `<span class="fzd-move-pos">${escapeHTML(p.pos)}</span>` : ''}
                </li>`).join('')
            : '<li class="fzd-deal-asset is-empty">Rien en retour</li>';
        return `
            <section class="fzd-deal-col">
                <div class="fzd-deal-club">
                    ${teamLogoImg(team)}
                    <span class="fzd-deal-club-name">${escapeHTML(club)}</span>
                    <span class="fzd-deal-club-abbr" title="${escapeHTML(club)}">${escapeHTML(team)}</span>
                </div>
                <p class="fzd-deal-acq">Acquiert</p>
                <ul class="fzd-deal-assets">${assets}</ul>
            </section>`;
    };
    // Le club qui reçoit quelque chose passe à gauche : sur un échange à sens
    // unique (le cas courant dans ce journal), « Rien en retour » finit à
    // droite plutôt qu'en tête.
    const [first, second] = [d.teamA, d.teamB]
        .sort((x, y) => (d.gets[y]?.length || 0) - (d.gets[x]?.length || 0));
    return `
        <article class="fzd-deal">
            <div class="fzd-deal-date">${dayLabelFr(d.date)}</div>
            <div class="fzd-deal-grid">
                ${colHTML(first)}
                <div class="fzd-deal-swap" aria-hidden="true">⇄</div>
                ${colHTML(second)}
            </div>
        </article>`;
}

function offseasonEmptyText() {
    if (offseasonTab === 'injury') return 'Aucun blessé signalé.';
    // Tant que le serveur n'a pas deux photos d'alignements à comparer, il n'a
    // rien à dire — ce qui n'est pas la même chose qu'une ligue tranquille.
    if (!offseasonLeague?.tracking) return 'Le suivi des mouvements démarre à la prochaine mise à jour des alignements.';
    return offseasonTab === 'trade' ? 'Aucun échange récent.' : 'Aucune signature récente.';
}

function movementRowHTML(t) {
    const route = t.type === 'trade'
        ? `${escapeHTML(t.fromTeamName || t.fromTeam || '?')} → ${escapeHTML(t.toTeamName || t.toTeam || '?')}`
        : `→ ${escapeHTML(t.toTeamName || t.toTeam || '?')}`;
    return `
        <div class="fzd-move-row">
            <div class="fzd-move-main">
                <div class="fzd-move-name">${escapeHTML(t.playerName)}${t.pos ? ` <span class="fzd-move-pos">${escapeHTML(t.pos)}</span>` : ''}</div>
                <div class="fzd-move-route">${route}</div>
            </div>
            <div class="fzd-move-date">${dayLabelFr(t.date)}</div>
        </div>`;
}

function injuryRowHTML(i) {
    const detail = [i.injuryType, i.injuryDetail].filter(Boolean).join(' / ');
    const back = i.returnDate ? `Retour prévu ${dayLabelFr(i.returnDate)}` : '';
    return `
        <div class="fzd-move-row">
            <div class="fzd-move-main">
                <div class="fzd-move-name">${escapeHTML(i.playerName)}${i.pos ? ` <span class="fzd-move-pos">${escapeHTML(i.pos)}</span>` : ''}</div>
                <div class="fzd-move-route">${escapeHTML([i.teamName || i.team, detail].filter(Boolean).join(' · '))}</div>
            </div>
            <div class="fzd-move-date">
                <span class="fzd-move-status" data-status="${escapeHTML(i.status || '')}">${escapeHTML(i.statusFr || '')}</span>
                ${back ? `<span class="fzd-move-back">${escapeHTML(back)}</span>` : ''}
            </div>
        </div>`;
}

function renderOffseasonWatchlist() {
    const wrap = document.getElementById('fzdOffWatchlist');
    if (!wrap) return;

    if (!OFFSEASON_WATCHLIST.length) {
        wrap.innerHTML = `<p class="fzd-off-empty">Liste à venir.</p>`;
        return;
    }

    wrap.innerHTML = OFFSEASON_WATCHLIST.map(p => `
        <div class="fzd-watch-row">
            <span class="fzd-watch-name">${escapeHTML(p.name)}</span>
            <span class="fzd-watch-team">(${escapeHTML(p.team)})</span>
            ${p.note ? `<span class="fzd-watch-note">${escapeHTML(p.note)}</span>` : ''}
        </div>`).join('');
}

// ============================================================
// ORCHESTRATION
// ============================================================
function bindCalendarControls() {
    document.getElementById('fzdCalPrev')?.addEventListener('click', calGoPrevWeek);
    document.getElementById('fzdCalNext')?.addEventListener('click', calGoNextWeek);
    document.getElementById('fzdCalMonthToggle')?.addEventListener('click', toggleMonthPicker);
    document.getElementById('fzdMonthPrevBtn')?.addEventListener('click', monthPrev);
    document.getElementById('fzdMonthNextBtn')?.addEventListener('click', monthNext);
}

// ============================================================
// ÉTAT VIDE — les trois cartes « En attendant » (Canvas-9)
// ============================================================

// Le calendrier est masqué tant qu'aucun pool n'est actif ; la carte
// « Calendrier LNH » le rouvre. renderDash() relit ce drapeau, sinon le
// prochain FZPool.onData() refermerait le panneau sous le visiteur.
let calRevealedNoPool = false;

/**
 * Déplie une section et amène le regard dessus.
 *
 * Les trois démos de #comment-ca-marche démarrent sur un IntersectionObserver
 * à seuil .2 (voir boucler() dans demos.js) : il ne se déclenche pas tant que
 * la section est en display:none, et se déclenche tout seul une fois qu'elle
 * entre dans le champ. Rien à relancer à la main ici.
 */
function toggleReveal(bouton, cible, ouvrir, classeOuverture) {
    if (!cible) return;
    if (classeOuverture) cible.classList.toggle(classeOuverture, ouvrir);
    else cible.style.display = ouvrir ? '' : 'none';
    bouton.setAttribute('aria-expanded', String(ouvrir));
    if (!ouvrir) return;
    // scrollIntoView est ignoré sur un élément encore masqué : on laisse la
    // mise en page se faire d'abord.
    requestAnimationFrame(() => {
        cible.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

function bindOnboardCards() {
    const how = document.getElementById('fzoHowCard');
    const hiw = document.getElementById('comment-ca-marche');
    how?.addEventListener('click', () => {
        toggleReveal(how, hiw, how.getAttribute('aria-expanded') !== 'true', 'fzo-revealed');
    });

    const calBtn = document.getElementById('fzoCalCard');
    const calWrap = document.getElementById('fzDashCalendarWrap');
    calBtn?.addEventListener('click', async () => {
        calRevealedNoPool = calBtn.getAttribute('aria-expanded') !== 'true';
        toggleReveal(calBtn, calWrap, calRevealedNoPool);
        // Le calendrier et le panneau hors-saison ne tirent que sur
        // /schedule/:date, /nhl-transactions et /nhl-injuries : aucune donnée
        // de pool, donc ils se remplissent aussi bien sans pool actif.
        if (calRevealedNoPool && !calData) await initCalendar();
    });

    loadOpenPoolsCount();
}

/**
 * « Ligues ouvertes » : le nombre de pools encore rejoignables.
 *
 * La maquette affiche « 14 pools » en dur ; on compte les vrais, à la même
 * source que rejoindre-pool.html (GET /draft, filtré par loadClans/updateUI).
 * En cas d'échec la carte garde sa phrase générique — pas de chiffre inventé.
 */
async function loadOpenPoolsCount() {
    const cible = document.getElementById('fzoOpenPools');
    if (!cible) return;
    try {
        const res = await fetch(`${BASE_URL}/draft?timestamp=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const clans = await res.json();
        const moi = localStorage.getItem('username');
        const ouverts = Object.values(clans || {}).filter(clan => {
            const equipes = Object.values(clan?.teams || {});
            if (!equipes.length) return false;
            // Déjà membre, ou repêchage commencé : plus rejoignable.
            if (equipes.some(e => (e.members || []).includes(moi))) return false;
            return !clan.draftStarted;
        }).length;
        if (!ouverts) {
            cible.textContent = 'Aucune ligue ouverte pour le moment.';
            return;
        }
        cible.textContent = ouverts === 1
            ? '1 pool cherche des joueurs cette semaine.'
            : `${ouverts} pools cherchent des joueurs cette semaine.`;
    } catch (err) {
        console.warn('Could not count open pools:', err);
    }
}

async function renderDash() {
    const section = document.getElementById('fzDashSection');
    const body = document.getElementById('fzDashBody');
    const hero = document.getElementById('fzDashHero');
    const calWrap = document.getElementById('fzDashCalendarWrap');
    const onboard = document.getElementById('fzDashOnboard');
    const mobileHome = document.getElementById('fzMobileHome');
    if (!section || !userData.username) return;

    const hasPool = !!FZPool.get();
    section.style.display = 'block';
    // Lu par accueil-mobile.css : sur téléphone, la home mobile remplace le
    // calendrier — mais elle n'existe qu'avec un pool. Sans pool, la carte
    // « Calendrier LNH » de l'état vide doit pouvoir l'ouvrir.
    section.classList.toggle('is-poolless', !hasPool);
    if (body) body.style.display = hasPool ? '' : 'none';
    if (!hasPool && hero) { fzdStopHeroTimer(); hero.style.display = 'none'; hero.innerHTML = ''; }
    // calRevealedNoPool : le visiteur sans pool a ouvert le calendrier depuis
    // la carte « Calendrier LNH » — ne pas le refermer sous lui au prochain
    // rafraîchissement de FZPool.
    if (calWrap) calWrap.style.display = (hasPool || calRevealedNoPool) ? '' : 'none';
    // .fz-mobile-home defaults to display:none in CSS (hidden until a pool
    // is active, and force-hidden on desktop via @media min-width:769px) —
    // an explicit 'block' is required here, an empty string would just fall
    // back to that same CSS default instead of overriding it.
    if (mobileHome) mobileHome.style.display = hasPool ? 'block' : 'none';
    if (onboard) onboard.style.display = hasPool ? 'none' : 'flex';

    if (!hasPool) return;

    if (!calData) await initCalendar(); else renderCalendar();
    renderQuickActions();
    renderMyPoolsList();
    renderActivityFeed();

    const dash = await loadDashData();
    if (dash) {
        renderHero(dash.tonight);
        renderLivePanel(dash.tonight, dash.movement, dash.activeName);
        renderMobileHome(dash.tonight, dash.movement, dash.activeName);
    } else {
        renderHero(null);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!userData.username) userData.username = localStorage.getItem('username');
    if (!userData.username) return;

    bindCalendarControls();
    bindOnboardCards();
    await Promise.all([FZPool.ready(), loadCurrentStats(), loadPendingTrades()]);
    renderDash();
    FZPool.onData(renderDash);
});
