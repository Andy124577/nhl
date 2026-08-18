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
}

function renderCalendar() {
    renderDayStrip();
    renderDayGames();
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

async function loadLivePanel() {
    const liveContainer = document.getElementById('fzdLivePanel');
    const playersContainer = document.getElementById('fzdPlayersList');
    const team = FZPool.team();
    const activeName = FZPool.get();
    if (!liveContainer || !playersContainer || !team || !activeName) return;

    const [tonight, movement] = await Promise.all([fetchTonightBoxscores(), fetchRankMovement(activeName)]);
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

    container.innerHTML = pools.map(pool => {
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
// ORCHESTRATION
// ============================================================
function bindCalendarControls() {
    document.getElementById('fzdCalPrev')?.addEventListener('click', calGoPrevWeek);
    document.getElementById('fzdCalNext')?.addEventListener('click', calGoNextWeek);
    document.getElementById('fzdCalMonthToggle')?.addEventListener('click', toggleMonthPicker);
    document.getElementById('fzdMonthPrevBtn')?.addEventListener('click', monthPrev);
    document.getElementById('fzdMonthNextBtn')?.addEventListener('click', monthNext);
}

async function renderDash() {
    const section = document.getElementById('fzDashSection');
    const body = document.getElementById('fzDashBody');
    const calWrap = document.getElementById('fzDashCalendarWrap');
    const onboard = document.getElementById('fzDashOnboard');
    if (!section || !userData.username) return;

    const hasPool = !!FZPool.get();
    section.style.display = 'block';
    if (body) body.style.display = hasPool ? '' : 'none';
    if (calWrap) calWrap.style.display = hasPool ? '' : 'none';
    if (onboard) onboard.style.display = hasPool ? 'none' : 'block';

    if (!hasPool) return;

    if (!calData) await initCalendar(); else renderCalendar();
    renderQuickActions();
    renderMyPoolsList();
    renderActivityFeed();
    loadLivePanel();
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!userData.username) userData.username = localStorage.getItem('username');
    if (!userData.username) return;

    bindCalendarControls();
    await Promise.all([FZPool.ready(), loadCurrentStats(), loadPendingTrades()]);
    renderDash();
    FZPool.onData(renderDash);
});
