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
const FR_DOW_LONG = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const FR_MONTH = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const FR_MONTH_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juill.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/* Nom court d'équipe, en français là où l'usage l'est (Sénateurs, Canadiens).
   /current-teams ne renvoie que le nom complet anglais : cette table est la
   seule source des libellés que la maquette Canvas-12 met sur les cartes de
   match. Le repli shortTeamName() couvre une équipe ajoutée à la ligue avant
   qu'on pense à l'inscrire ici. */
const NHL_TEAM_SHORT = {
    ANA: 'Ducks', ARI: 'Coyotes', BOS: 'Bruins', BUF: 'Sabres', CAR: 'Hurricanes',
    CBJ: 'Blue Jackets', CGY: 'Flames', CHI: 'Blackhawks', COL: 'Avalanche',
    DAL: 'Stars', DET: 'Red Wings', EDM: 'Oilers', FLA: 'Panthers', LAK: 'Kings',
    MIN: 'Wild', MTL: 'Canadiens', NJD: 'Devils', NSH: 'Predators', NYI: 'Islanders',
    NYR: 'Rangers', OTT: 'Sénateurs', PHI: 'Flyers', PIT: 'Penguins', SEA: 'Kraken',
    SJS: 'Sharks', STL: 'Blues', TBL: 'Lightning', TOR: 'Maple Leafs', UTA: 'Mammoth',
    VAN: 'Canucks', VGK: 'Golden Knights', WPG: 'Jets', WSH: 'Capitals'
};

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
// Feuilles de match du soir (GET /tonight-boxscores), posées par renderDash :
// les cartes joueur du calendrier montrent la ligne EN DIRECT quand elle
// existe, et retombent sur les totaux de la saison sinon.
let calTonight = { players: [], games: [] };
// Bureau : 4 cartes puis « Voir les N autres matchs ». Au téléphone les
// matchs défilent, donc ce repli ne s'applique pas.
let calGamesExpanded = false;
const CAL_GAMES_COLLAPSED = 4;
// abbrev → { name, record }, construit une fois depuis /current-teams.
let nhlTeamIndex = null;

const calIsPhone = () => window.matchMedia('(max-width: 768px)').matches;

async function loadNhlTeams() {
    if (nhlTeamIndex) return;
    nhlTeamIndex = {};
    try {
        const res = await fetch(`${BASE_URL}/current-teams`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        (data.teams || []).forEach(t => {
            if (!t.teamAbbrev) return;
            nhlTeamIndex[t.teamAbbrev] = {
                name: NHL_TEAM_SHORT[t.teamAbbrev] || shortTeamName(t.teamFullName),
                record: `${t.wins || 0}-${t.losses || 0}-${t.otLosses || 0}`
            };
        });
    } catch (err) {
        console.warn('Could not load team standings:', err);
    }
}

function shortTeamName(full) {
    const parts = String(full || '').trim().split(/\s+/);
    if (parts.length <= 1) return parts[0] || '';
    return parts.length > 2 ? parts.slice(-2).join(' ') : parts[parts.length - 1];
}

function teamName(abbrev) {
    return (nhlTeamIndex && nhlTeamIndex[abbrev]?.name) || NHL_TEAM_SHORT[abbrev] || abbrev;
}

function teamRecord(abbrev) {
    return (nhlTeamIndex && nhlTeamIndex[abbrev]?.record) || '';
}

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
    const [schedule] = await Promise.all([fetchSchedule(today), loadNhlTeams()]);
    calData = schedule;
    calSelectedDate = calData.days.find(d => d.date === today) ? today : (calData.days[0]?.date || today);
    renderCalendar();
    renderOffseasonPanel();
}

function renderCalendar() {
    renderCalRange();
    renderDayStrip();
    renderDayHead();
    renderDayGames();
}

/** « 18 – 24 oct. » : la semaine que /schedule/:date vient de renvoyer. */
function renderCalRange() {
    const el = document.getElementById('fzdCalRange');
    if (!el || !calData || !calData.days.length) return;
    const first = calData.days[0].date;
    const last = calData.days[calData.days.length - 1].date;
    const mon = iso => FR_MONTH_SHORT[Number(iso.slice(5, 7)) - 1];
    el.textContent = mon(first) === mon(last)
        ? `${dayNum(first)} – ${dayNum(last)} ${mon(last)}`
        : `${dayNum(first)} ${mon(first)} – ${dayNum(last)} ${mon(last)}`;
}

function renderDayStrip() {
    const strip = document.getElementById('fzdCalStrip');
    if (!strip || !calData) return;
    const today = todayISO();

    strip.innerHTML = calData.days.map(d => {
        const isToday = d.date === today;
        const isSelected = d.date === calSelectedDate;
        const games = d.games || [];
        const live = games.filter(g => g.state === 'LIVE' || g.state === 'CRIT').length;
        // Le mot est dans un <span> à part : au téléphone la case ne fait
        // qu'un septième d'écran, la CSS n'y garde que le chiffre.
        const count = live
            ? `<span class="fzd-day-chip-count is-live"><i class="fzd-live-dot"></i><span class="fzd-count-n">${live}</span><span class="fzd-count-w"> en direct</span></span>`
            : `<span class="fzd-day-chip-count"><span class="fzd-count-n">${games.length}</span><span class="fzd-count-w"> match${games.length > 1 ? 's' : ''}</span></span>`;
        return `
            <button type="button" class="fzd-day-chip${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}" data-date="${d.date}" aria-pressed="${isSelected}">
                <span class="fzd-day-chip-top">
                    <span class="fzd-day-chip-num">${dayNum(d.date)}</span>
                    <span class="fzd-day-chip-dow">${isToday ? 'Auj' : dowLabel(d.date)}</span>
                </span>
                ${count}
            </button>`;
    }).join('');

    strip.querySelectorAll('.fzd-day-chip').forEach(btn => {
        btn.addEventListener('click', () => selectCalendarDay(btn.dataset.date));
    });
}

/** « Mercredi 21 octobre · 5 de vos joueurs à l'horaire ». */
function renderDayHead() {
    const el = document.getElementById('fzdCalDayHead');
    if (!el) return;
    const iso = calSelectedDate || todayISO();
    const d = new Date(iso + 'T00:00:00Z');
    const label = `${FR_DOW_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${FR_MONTH[d.getUTCMonth()].toLowerCase()}`;

    const day = calData && calData.days.find(x => x.date === iso);
    const games = (day && day.games) || [];
    const counts = rosterTeamCounts();
    const mine = games.reduce((sum, g) => sum + rosterCountForGame(counts, g), 0);

    el.innerHTML = `
        <span class="fzd-cal-dayname">${escapeHTML(label)}</span>
        ${mine ? `<span class="fzd-cal-daysub">${mine} de vos joueur${mine > 1 ? 's' : ''} à l'horaire</span>` : ''}`;
}

function renderDayGames() {
    const wrap = document.getElementById('fzdCalGames');
    const dots = document.getElementById('fzdCalDots');
    const more = document.getElementById('fzdCalMore');
    if (!wrap || !calData) return;

    const day = calData.days.find(d => d.date === calSelectedDate);
    const games = (day && day.games) || [];

    if (!games.length) {
        wrap.innerHTML = `<p class="fzd-cal-empty">Aucun match cette journée.</p>`;
        if (dots) dots.innerHTML = '';
        if (more) more.style.display = 'none';
        return;
    }

    // Téléphone : tous les matchs, ils défilent horizontalement (un par écran)
    // au lieu de s'empiler. Bureau : grille de deux colonnes repliée à quatre
    // cartes, le reste derrière « Voir les N autres matchs ».
    const phone = calIsPhone();
    const shown = (phone || calGamesExpanded) ? games : games.slice(0, CAL_GAMES_COLLAPSED);

    const counts = rosterTeamCounts();
    wrap.innerHTML = shown.map(g => gameCardHTML(g, counts)).join('');
    wrap.scrollLeft = 0;

    if (dots) {
        dots.innerHTML = shown.length > 1
            ? shown.map((_, i) => `<i class="fzd-cal-dot${i === 0 ? ' is-on' : ''}"></i>`).join('')
            : '';
    }

    const rest = games.length - shown.length;
    if (more) {
        if (phone || (!rest && !calGamesExpanded)) {
            more.style.display = 'none';
        } else {
            more.style.display = '';
            more.textContent = calGamesExpanded
                ? '← Voir moins'
                : `Voir les ${rest} autre${rest > 1 ? 's' : ''} match${rest > 1 ? 's' : ''} →`;
        }
    }

    bindPlayerTracks(wrap);
}

function gameCardHTML(game, rosterCounts) {
    const isFinal = game.state === 'FINAL' || game.state === 'OFF';
    const isLive = game.state === 'LIVE' || game.state === 'CRIT';
    const isScheduled = !isFinal && !isLive;

    let badge, when = '';
    if (isLive) {
        badge = `<span class="fzd-game-badge is-live"><i class="fzd-live-dot"></i>En direct</span>`;
        when = `${periodLabel(game.period, game.periodType)} · ${escapeHTML(game.clock?.timeRemaining || '')}`;
    } else if (isFinal) {
        badge = `<span class="fzd-game-badge is-final">Final</span>`;
    } else {
        badge = `<span class="fzd-game-badge">${gameTimeLabel(game.startTimeUTC)}</span>`;
        // « Dans 1 h 12 » n'a de sens qu'à quelques heures de la mise au jeu :
        // à trois jours de là, countdownLabel écrirait « Dans 74 h 05 ».
        const inMs = new Date(game.startTimeUTC) - Date.now();
        if (inMs > 0 && inMs < 12 * 3600 * 1000) when = `Dans ${countdownLabel(game.startTimeUTC)}`;
    }

    const teamRow = (side, opponent) => {
        const trailing = !isScheduled && (side.score ?? 0) < (opponent.score ?? 0);
        const record = teamRecord(side.abbrev);
        return `
            <div class="fzd-game-row">
                ${teamLogoImg(side.abbrev)}
                <div class="fzd-team-id">
                    <div class="fzd-team-name${trailing ? ' is-trailing' : ''}">${escapeHTML(teamName(side.abbrev))}</div>
                    <div class="fzd-team-rec">${escapeHTML(record || side.abbrev)}</div>
                </div>
                ${isScheduled ? '' : `<div class="fzd-team-score${trailing ? ' is-trailing' : ''}">${side.score ?? 0}</div>`}
            </div>`;
    };

    return `
        <article class="fzd-game-card${isScheduled ? ' is-scheduled' : ''}${isFinal ? ' is-final' : ''}${isLive ? ' is-live' : ''}">
            <header class="fzd-game-head">
                ${badge}
                ${when ? `<span class="fzd-game-when">${when}</span>` : ''}
            </header>
            <div class="fzd-game-teams">
                ${teamRow(game.away, game.home)}
                ${teamRow(game.home, game.away)}
            </div>
            ${gamePlayersHTML(game)}
        </article>`;
}

/**
 * Le carrousel « Vos joueurs » sous chaque match — ce que la maquette
 * Canvas-12 met à la place des meneurs par équipe. Pendant le match la ligne
 * vient de /tonight-boxscores (calTonight) ; sinon ce sont les totaux de la
 * saison de /current-stats. Rien n'est rendu si aucun de vos joueurs n'est
 * dans ce match : mieux vaut pas de bandeau qu'un bandeau vide.
 */
function gamePlayersHTML(game) {
    const abbrevs = [game.away.abbrev, game.home.abbrev];
    const started = ['LIVE', 'CRIT', 'FINAL', 'OFF'].includes(game.state);

    const tonightByName = {};
    (calTonight.players || []).forEach(p => { tonightByName[p.playerName] = p; });

    const rows = [];
    activeRosterNames().forEach(name => {
        const info = getPlayerStats(name);
        if (!info || !abbrevs.includes(info.teamAbbrev)) return;
        // Les feuilles de match ne couvrent que la journée en cours : pour un
        // match d'un autre jour, tonightByName est vide et on retombe tout
        // seul sur les totaux de la saison.
        const live = started ? tonightByName[name] : null;
        rows.push({ name, info, live });
    });
    if (!rows.length) return '';

    const inPlay = rows.filter(r => r.live).length;
    const sub = inPlay ? `${inPlay} en jeu` : 'Totaux de la saison';

    return `
        <footer class="fzd-game-players">
            <div class="fzd-gp-head">
                <span class="fzd-gp-title">Vos joueurs</span>
                <span class="fzd-gp-sub">${sub}</span>
            </div>
            <div class="fzd-gp-track">${rows.map(r => playerCardHTML(r.name, r.info, r.live)).join('')}</div>
            ${rows.length > 1 ? `<div class="fzd-gp-dots" aria-hidden="true">${rows.map((_, i) => `<i class="fzd-gp-dot${i === 0 ? ' is-on' : ''}"></i>`).join('')}</div>` : ''}
        </footer>`;
}

function playerCardHTML(name, info, live) {
    const pos = info.position && info.position !== 'N/A' ? info.position : '';
    let meta, num, label, hot = false;

    if (live) {
        meta = [info.teamAbbrev, pos, live.toi].filter(Boolean).join(' · ');
        if (live.position === 'G') {
            const faced = live.shotsAgainst || ((live.saves || 0) + (live.goalsAgainst || 0));
            num = faced ? (live.saves / faced).toFixed(3).replace(/^0/, '') : '—';
            label = '%Arr';
        } else if ((live.goals || 0) > 0) {
            num = live.goals; label = live.goals > 1 ? 'Buts' : 'But'; hot = true;
        } else if ((live.assists || 0) > 0) {
            num = live.assists; label = 'Pass'; hot = true;
        } else {
            num = live.shots || 0; label = 'Tirs';
        }
    } else {
        meta = [info.teamAbbrev, pos].filter(Boolean).join(' · ');
        if (pos === 'G') { num = info.wins || 0; label = 'Vict'; }
        else { num = info.points || 0; label = 'Pts'; }
    }

    const initials = name.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
    const avatar = info.headshot
        ? `<img class="fzd-gp-photo" src="${escapeHTML(info.headshot)}" alt="" loading="lazy" onerror="this.remove()">`
        : `<span class="fzd-gp-photo is-initials">${escapeHTML(initials)}</span>`;

    return `
        <div class="fzd-gp-card">
            ${avatar}
            <div class="fzd-gp-id">
                <div class="fzd-gp-name">${escapeHTML(name)}</div>
                <div class="fzd-gp-meta">${escapeHTML(meta)}</div>
            </div>
            <div class="fzd-gp-stat">
                <div class="fzd-gp-num${hot ? ' is-hot' : ''}">${escapeHTML(String(num))}</div>
                <div class="fzd-gp-lbl">${escapeHTML(label)}</div>
            </div>
        </div>`;
}

/** Puces du carrousel « Vos joueurs », une piste par carte de match. */
function bindPlayerTracks(root) {
    root.querySelectorAll('.fzd-gp-track').forEach(track => {
        const dots = track.parentElement.querySelector('.fzd-gp-dots');
        if (!dots || !dots.children.length) return;
        track.addEventListener('scroll', () => {
            const card = track.firstElementChild;
            if (!card) return;
            const step = card.offsetWidth + 8;
            const i = Math.min(dots.children.length - 1, Math.round(track.scrollLeft / step));
            Array.from(dots.children).forEach((d, k) => d.classList.toggle('is-on', k === i));
        }, { passive: true });
    });
}

/** Puces du carrousel des matchs — téléphone seulement : au bureau c'est une
 *  grille et #fzdCalDots est masqué en CSS. */
function updateCalGameDots() {
    const wrap = document.getElementById('fzdCalGames');
    const dots = document.getElementById('fzdCalDots');
    if (!wrap || !dots || !dots.children.length) return;
    const card = wrap.firstElementChild;
    if (!card) return;
    const step = card.offsetWidth + 12;
    const i = Math.min(dots.children.length - 1, Math.round(wrap.scrollLeft / step));
    Array.from(dots.children).forEach((d, k) => d.classList.toggle('is-on', k === i));
}

/**
 * Le calendrier est UN seul nœud, pas deux rendus. Au bureau il vit à sa
 * place dans .fz-dash ; au téléphone renderMobileHome() lui réserve
 * #fzmCalSlot et on l'y déplace, pour qu'il tombe entre le classement et
 * « Vos joueurs ce soir » plutôt qu'à la toute fin de l'écran. Le retour
 * arrière évite qu'un simple redimensionnement le laisse coincé dans la home
 * mobile, masquée au-dessus de 768px.
 */
function fzdPlaceCalendar() {
    const cal = document.getElementById('fzDashCalendarWrap');
    if (!cal) return;
    const slot = document.getElementById('fzmCalSlot');
    if (calIsPhone() && slot) {
        if (cal.parentElement !== slot) slot.appendChild(cal);
    } else {
        fzdRestoreCalendar();
    }
}

/**
 * Ramène le calendrier à sa place bureau. renderMobileHome() l'appelle AVANT
 * de réécrire son innerHTML : le nœud vit peut-être dans #fzmCalSlot, et une
 * réécriture l'effacerait pour de bon — plus de calendrier jusqu'au prochain
 * chargement de page.
 */
function fzdRestoreCalendar() {
    const cal = document.getElementById('fzDashCalendarWrap');
    const anchor = document.getElementById('fzDashOffseason');
    if (!cal || !anchor || cal.nextElementSibling === anchor) return;
    anchor.parentElement.insertBefore(cal, anchor);
}

async function selectCalendarDay(dateStr) {
    // Changer de journée replie les cartes de match : le « Voir les N autres »
    // parlait du nombre de matchs de la journée qu'on vient de quitter.
    calGamesExpanded = false;
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
    calGamesExpanded = false;
    calData = await fetchSchedule(calData.previousStartDate);
    calSelectedDate = calData.days[calData.days.length - 1]?.date || calData.previousStartDate;
    renderCalendar();
}

async function calGoNextWeek() {
    if (!calData || !calData.nextStartDate) return;
    calGamesExpanded = false;
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
/**
 * Lien vers la liste de tous les joueurs qu'on a repêchés : classement.html
 * ouvre directement la fiche de l'équipe sur ce paramètre (voir
 * loadAllUserPools dans classement.js). C'est ce que remplace le lien
 * « Repêchage » une fois celui-ci terminé — l'onglet disparaît alors des
 * barres de navigation et ses écrans se referment (navbar.js, activePool.js).
 */
function fzdMonEffectifHref(activeName, teamName) {
    return `classement.html?pool=${encodeURIComponent(activeName)}`
         + `&equipe=${encodeURIComponent(teamName)}`;
}

/* ---- Récapitulatif de repêchage rouvert depuis l'accueil ----
   Le popup est celui de la salle de repêchage (draftFinPopup.js) : même
   cartes, même mise en page. Il y lit des globales que l'accueil n'a pas,
   d'où la source explicite posée ici avant l'ouverture.

   nhl_filtered_stats.json (position, équipe, photo de chaque joueur) n'est
   chargé qu'au premier clic, et une seule fois : la home n'a aucune raison
   de le télécharger pour un bouton qu'on ne pressera peut-être jamais. */
let fzdBassinJoueurs = null;
let fzdBassinEnCours = null;

function fzdChargerBassinJoueurs() {
    if (fzdBassinJoueurs) return Promise.resolve(fzdBassinJoueurs);
    if (fzdBassinEnCours) return fzdBassinEnCours;
    fzdBassinEnCours = fetch('nhl_filtered_stats.json')
        .then(r => r.json())
        .then(d => {
            fzdBassinJoueurs = {
                skaters: [].concat(d.Top_50_Defenders || [], d.Top_100_Offensive_Players || [], d.Top_Rookies || []),
                goalies: d.Top_50_Goalies || [],
                teams: d.Teams || []
            };
            return fzdBassinJoueurs;
        })
        .catch(err => {
            console.warn('Récapitulatif : bassin de joueurs indisponible', err);
            // Sans photos ni positions, le récapitulatif reste lisible (noms
            // et ordre viennent du pool) : mieux vaut l'ouvrir dégradé que
            // laisser le bouton sans effet.
            fzdBassinJoueurs = { skaters: [], goalies: [], teams: [] };
            return fzdBassinJoueurs;
        })
        .finally(() => { fzdBassinEnCours = null; });
    return fzdBassinEnCours;
}

async function fzdOuvrirRecapRepechage() {
    if (typeof window.fzShowDraftEndPopup !== 'function') return;
    const poolData = FZPool.data();
    const team = FZPool.team();
    const activeName = FZPool.get();
    if (!poolData || !team || !activeName) return;

    const bassin = await fzdChargerBassinJoueurs();
    window.fzSetDraftEndSource({
        draftData: poolData,
        teamName: team.name,
        clanName: activeName,
        complete: FZPool.draftState(poolData).etat === 'termine',
        skaters: bassin.skaters,
        goalies: bassin.goalies,
        teams: bassin.teams,
        // Le résolveur de photos de la salle de repêchage lit des globales
        // que l'accueil n'a pas ; on passe le sien, celui-là même qui donne
        // déjà leur visage aux cartes du carrousel de choix.
        headshot: fzdHeadshotByName
    });
    window.fzShowDraftEndPopup();
}

// La bannière est reconstruite à chaque rendu, et elle existe en double
// (#fzDashHero au bureau, #fzmHeroSlot sur téléphone) : un seul écouteur
// délégué vaut mieux qu'un rebranchement après chaque innerHTML.
document.addEventListener('click', event => {
    const bouton = event.target.closest('[data-fzd-recap]');
    if (!bouton) return;
    event.preventDefault();
    fzdOuvrirRecapRepechage();
});

/** Tous les choix d'une équipe, l'équipe LNH repêchée comprise. */
function fzdNombreDeChoix(teamData) {
    const td = teamData || {};
    return (td.offensive || []).length + (td.defensive || []).length
         + (td.goalie || []).length + (td.rookie || []).length
         + (td.teams || []).length;
}

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
    // Repêchage terminé : repechage.html renverrait maintenant à l'accueil
    // (activePool.js). La tuile mène plutôt là où le repêchage a abouti —
    // l'effectif qu'on en a tiré.
    const draftHref = action ? action.href
        : state.etat === 'termine' ? fzdMonEffectifHref(activeName, team.name)
        : `repechage.html?pool=${encodeURIComponent(activeName)}`;
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
    const draftDone = draftState.etat === 'termine';
    const today = todayISO();
    const seasonStart = calData?.regularSeasonStartDate;
    const isPreseason = !isDraft && !!seasonStart && today < seasonStart;

    if (isDraft) {
        // `myTurn` pilote la bascule de la bannière : neutre quand le tour est
        // à quelqu'un d'autre, rouge de marque quand c'est le vôtre (voir
        // .fz-dash-hero.is-myturn dans accueil-dash.css).
        const ordre = Array.isArray(poolData.draftOrder) ? poolData.draftOrder : [];
        const pick = poolData.currentPickIndex || 0;
        return { mode: 'draft', poolData, team, activeName, pick, myTurn: ordre[pick] === team.name };
    }

    if (isPreseason) {
        const campStart = calData?.preSeasonStartDate;
        const beforeCamp = !!campStart && today < campStart;
        // `draftDone` ne change pas le décompte, seulement ce vers quoi la
        // bannière renvoie : l'effectif qu'on vient de repêcher plutôt que la
        // gestion d'équipe.
        return {
            mode: 'preseason', target: beforeCamp ? campStart : seasonStart, beforeCamp,
            draftDone, activeName, teamName: team.name
        };
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

    // Repêchage terminé, rien de plus pressant à l'écran : la bannière —
    // autrement masquée — sert de porte vers l'effectif repêché. Placée
    // APRÈS 'live' : des joueurs sur la glace ce soir passent avant.
    if (draftDone) {
        return {
            mode: 'draftdone', activeName, teamName: team.name,
            picks: fzdNombreDeChoix(team.data)
        };
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

/* Les deux boutons de la bannière une fois le repêchage terminé : le
   récapitulatif en cartes (le même popup qu'à la fin du repêchage, ouvert
   ici sans quitter l'accueil) et, à côté, le classement. Le premier est un
   <button> et non un lien : il n'y a pas de page à ouvrir. */
function fzdCtasRepechageFini(activeName) {
    return `
        <div class="fzd-hero-ctas">
            <button type="button" class="fzd-hero-cta" data-fzd-recap>
                <span class="fzd-hero-cta-bar" aria-hidden="true"></span>
                <span class="fzd-hero-cta-label">Voir mes joueurs repêchés</span>
                <span class="fzd-hero-cta-chev" aria-hidden="true">›</span>
            </button>
            <a class="fzd-hero-cta fzd-hero-cta--ghost" href="classement.html?pool=${encodeURIComponent(activeName)}">
                <span class="fzd-hero-cta-bar" aria-hidden="true"></span>
                <span class="fzd-hero-cta-label">Classement</span>
                <span class="fzd-hero-cta-chev" aria-hidden="true">›</span>
            </a>
        </div>`;
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
                <div class="fzd-hero-stat"><span class="fzd-hero-stat-lbl">Attente</span><span class="fzd-hero-stat-val fzd-hero-elapsed">${elapsed}</span></div>
            </div>
            <a class="fzd-hero-cta" href="draftActif.html?pool=${encodeURIComponent(activeName)}">
                <span class="fzd-hero-cta-bar" aria-hidden="true"></span>
                <span class="fzd-hero-cta-label">Aller au repêchage</span>
                <span class="fzd-hero-cta-chev" aria-hidden="true">›</span>
            </a>`;
    }

    if (state.mode === 'preseason') {
        // Repêchage terminé : le décompte reste, mais l'action utile n'est
        // plus la gestion d'équipe — c'est de revoir qui on vient de repêcher.
        const fait = state.draftDone && state.activeName && state.teamName;
        return `
            <span class="fzd-hero-shield" aria-hidden="true">F</span>
            <div class="fzd-hero-copy">
                <div class="fzd-hero-eyebrow">${fait ? 'Repêchage terminé' : (state.beforeCamp ? "Avant le camp d'entraînement" : 'Avant le début de la saison')}</div>
                <h2 class="fzd-hero-headline">${fait ? 'Votre équipe est au complet' : 'Saison en préparation'}</h2>
            </div>
            <div class="fzd-hero-stats">${fzdCountdownStatsHTML(state.target)}</div>
            ${fait ? fzdCtasRepechageFini(state.activeName) : `
            <a class="fzd-hero-cta" href="mes-pools.html">
                <span class="fzd-hero-cta-bar" aria-hidden="true"></span>
                <span class="fzd-hero-cta-label">Gérer mon équipe</span>
                <span class="fzd-hero-cta-chev" aria-hidden="true">›</span>
            </a>`}`;
    }

    if (state.mode === 'draftdone') {
        return `
            <span class="fzd-hero-shield" aria-hidden="true">F</span>
            <div class="fzd-hero-copy">
                <div class="fzd-hero-eyebrow">Repêchage terminé</div>
                <h2 class="fzd-hero-headline">Votre équipe est au complet</h2>
            </div>
            <div class="fzd-hero-stats">
                <div class="fzd-hero-stat"><span class="fzd-hero-stat-lbl">Choix</span><span class="fzd-hero-stat-val">${state.picks}</span></div>
            </div>
            ${fzdCtasRepechageFini(state.activeName)}`;
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

// Un minuteur par conteneur : bureau (#fzDashHero) et téléphone
// (#fzmHeroSlot, accueil-mobile.js) rendent chacun leur propre copie de la
// même bannière et tournent chacun leur propre intervalle, sinon rendre
// l'un arrêterait le tic-tac de l'autre.
const fzdHeroTimers = {};

function fzdStopHeroTimer(containerId) {
    if (fzdHeroTimers[containerId]) { clearInterval(fzdHeroTimers[containerId]); delete fzdHeroTimers[containerId]; }
}

/**
 * Rend la bannière d'état dans le conteneur donné. Appelée depuis
 * renderDash() pour #fzDashHero (bureau) et depuis renderMobileHome()
 * (accueil-mobile.js) pour #fzmHeroSlot — même état, même balisage, même
 * contenu des deux côtés ; seul accueil-dash.css les met en page
 * différemment selon la largeur d'écran.
 */
function renderHero(tonight, containerId = 'fzDashHero') {
    const container = document.getElementById(containerId);
    if (!container) return;
    fzdStopHeroTimer(containerId);

    const state = fzdHeroState(tonight);
    if (!state || state.mode === 'regular') {
        container.style.display = 'none';
        container.innerHTML = '';
        container.classList.remove('is-draft', 'is-myturn');
        return;
    }

    container.style.display = 'flex';
    container.innerHTML = fzdHeroHTML(state);

    // Bascule neutre → rouge de marque quand le tour devient le vôtre. La
    // lecture forcée du layout entre les deux classes garantit que le calque
    // rouge parte bien de sa position hors-champ : sans elle, le navigateur
    // fond les deux états en un seul calcul et le balayage ne joue pas.
    container.classList.toggle('is-draft', state.mode === 'draft');
    const myTurn = state.mode === 'draft' && !!state.myTurn;
    if (myTurn !== container.classList.contains('is-myturn')) void container.offsetWidth;
    container.classList.toggle('is-myturn', myTurn);

    // Avant-saison : le compte à rebours se contente d'un rendu complet.
    if (state.mode === 'preseason') {
        fzdHeroTimers[containerId] = setInterval(() => {
            const fresh = fzdHeroState(tonight);
            if (!fresh || fresh.mode !== 'preseason') { renderHero(tonight, containerId); return; }
            container.innerHTML = fzdHeroHTML(fresh);
        }, 1000);
        return;
    }

    // Repêchage : seule l'attente avance à la seconde, et on ne retouche que
    // ce texte-là. Reconstruire toute la bannière chaque seconde effaçait le
    // balayage rouge en pleine course. Un vrai changement — tour, choix,
    // mode — repasse par un rendu complet, animation comprise.
    if (state.mode === 'draft') {
        const signature = `${state.pick}|${myTurn ? 1 : 0}`;
        fzdHeroTimers[containerId] = setInterval(() => {
            const fresh = fzdHeroState(tonight);
            if (!fresh || fresh.mode !== 'draft'
                || `${fresh.pick}|${fresh.myTurn ? 1 : 0}` !== signature) {
                renderHero(tonight, containerId);
                return;
            }
            const el = container.querySelector('.fzd-hero-elapsed');
            if (!el) return;
            const started = Number(fresh.poolData.turnStartedAt) || 0;
            el.textContent = started ? fzdFormatElapsed(Date.now() - started) : '—';
        }, 1000);
    }
}

// ============================================================
// CARROUSEL DES CHOIX — repêchage en cours. Une seule bande qui
// remplace « Prochains choix » + « Choix récents » : on défile des
// choix déjà faits (estompés) vers le choix EN COURS (centré, en
// rouge) puis les choix à venir (les vôtres surlignés). Rendu à
// l'identique sous la bannière au bureau (#fzDashDraftBoard) et dans
// la home téléphone (#fzmDraftBoard, appelé depuis accueil-mobile.js)
// — même fonction, comme renderHero, pour que les deux ne divergent
// jamais. accueil-dash.css le met en page selon la largeur d'écran.
// Maquette : handoff premium, Canvas-11.
// ============================================================
const FZD_POS_FR = { offensive: 'ATT', defensive: 'DÉF', goalie: 'GAR', rookie: 'REC', teams: 'ÉQ' };
const fzdDraftBoardTimers = {};

// Photo d'un joueur par son nom : picksHistory ne garde que le nom, sans
// identifiant pour viser le CDN de la LNH directement. On la retrouve dans
// les stats déjà chargées (userData.statsData, voir loadCurrentStats dans
// accueil.js). Index construit une fois, reconstruit si la liste change.
const fzdHeadshotByName = (() => {
    let map = null;
    return name => {
        if (!name) return '';
        const players = (typeof userData !== 'undefined' && userData.statsData && userData.statsData.players) || null;
        if (!players) return '';
        if (!map || map._n !== players.length) {
            map = { _n: players.length };
            players.forEach(p => { if (p.playerName) map[p.playerName.trim().toLowerCase()] = p.headshot || ''; });
        }
        return map[name.trim().toLowerCase()] || '';
    };
})();

function fzdDraftFaceHTML(name) {
    const src = fzdHeadshotByName(name);
    return src
        ? `<img class="fzd-db-face" src="${escapeHTML(src)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
        : `<span class="fzd-db-face is-empty">${escapeHTML((name || '?').trim().charAt(0) || '?')}</span>`;
}

function fzdStopDraftBoardTimer(containerId) {
    if (fzdDraftBoardTimers[containerId]) { clearInterval(fzdDraftBoardTimers[containerId]); delete fzdDraftBoardTimers[containerId]; }
}

function fzdFormatClock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// État par piste, gardé hors du DOM pour survivre à la reconstruction du
// conteneur : sur téléphone, renderMobileHome recrée #fzmDraftBoard à chaque
// rafraîchissement, donc on ne peut pas relire l'ancienne position dans le
// DOM — d'où `scroll` mémorisé ici.
//   pick   — dernier index de choix rendu (a-t-il bougé = un choix est tombé)
//   scroll — dernière position de défilement connue de l'utilisateur
//   reveal — dernier choix déjà mis en avant (une seule fois par choix : le
//            serveur émet plusieurs « draftUpdated » pour un même choix, et
//            le filet de 20 s en rejoue d'autres par-dessus)
const fzdDraftBoardPick = {};
const fzdDraftBoardScroll = {};
const fzdDraftBoardReveal = {};
const fzdDraftBoardRevealTimers = {};

// Temps pendant lequel le choix qui vient de tomber reste au centre avant
// que la piste glisse au choix suivant. Doit rester aligné sur les keyframes
// fzd-db-* d'accueil-dash.css : c'est la durée de l'animation plus le temps
// de la lire.
const FZD_DB_REVEAL_MS = 1600;

/** Le système demande-t-il moins d'animation ? On saute alors la mise en
 *  avant et on va droit au choix en cours, comme avant. */
function fzdMoinsDAnimation() {
    return typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function fzdStopDraftBoardReveal(containerId) {
    clearTimeout(fzdDraftBoardRevealTimers[containerId]);
    delete fzdDraftBoardRevealTimers[containerId];
}

/**
 * Un choix vient de tomber : on amène le joueur repêché au centre, sa photo
 * et son nom entrent (classe .is-reveal, animée en CSS), puis la piste glisse
 * au choix en cours. Deux temps plutôt qu'un seul saut : sinon la carte du
 * joueur défile hors champ au moment même où elle apparaît, et on ne voit
 * jamais qui vient d'être pris.
 */
function fzdRevelerChoix(containerId, track, carte) {
    fzdStopDraftBoardReveal(containerId);

    const cible = fzdCenterDraftCard(track, carte, true);
    if (cible != null) fzdDraftBoardScroll[containerId] = cible;

    // Retirée puis reposée : sans ce cycle, réappliquer la classe sur une
    // carte qui la porte déjà ne relance pas l'animation.
    carte.classList.remove('is-reveal');
    void carte.offsetWidth;
    carte.classList.add('is-reveal');

    fzdDraftBoardRevealTimers[containerId] = setTimeout(() => {
        delete fzdDraftBoardRevealTimers[containerId];
        // La piste est relue dans le DOM plutôt que capturée : un
        // rafraîchissement a pu la reconstruire pendant l'animation.
        const box = document.getElementById(containerId);
        const piste = box && box.querySelector('.fzd-db-track');
        const montre = piste && piste.querySelector('.fzd-db-card.is-reveal');
        if (montre) montre.classList.remove('is-reveal');
        const encours = piste && piste.querySelector('.fzd-db-card.is-current');
        if (!piste || !encours) return;
        const suivant = fzdCenterDraftCard(piste, encours, true);
        if (suivant != null) fzdDraftBoardScroll[containerId] = suivant;
    }, FZD_DB_REVEAL_MS);
}

// Centre une carte dans sa piste et renvoie la position visée. scrollTo ne
// touche que la piste, jamais le défilement de la page. clientWidth vaut 0
// tant que le panneau n'est pas posé : on repasse alors à la frame suivante.
function fzdCenterDraftCard(track, card, smooth) {
    if (!track || !card) return null;
    if (!track.clientWidth) {
        requestAnimationFrame(() => fzdCenterDraftCard(track, card, false));
        return null;
    }
    const left = Math.max(0, card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2);
    track.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
    return left;
}

// Glisser-déposer à la souris pour faire défiler la piste (le tactile la
// fait déjà défiler nativement). Rebranché à chaque rendu : la piste est un
// nœud neuf, donc aucun écouteur ne s'empile.
function fzdBindDragScroll(track) {
    let down = false, startX = 0, startScroll = 0, moved = 0;

    track.addEventListener('pointerdown', e => {
        if (e.pointerType === 'touch' || e.button !== 0) return;
        down = true; moved = 0;
        startX = e.clientX; startScroll = track.scrollLeft;
        track.classList.add('is-dragging');
        track.setPointerCapture(e.pointerId);
    });
    track.addEventListener('pointermove', e => {
        if (!down) return;
        const dx = e.clientX - startX;
        moved += Math.abs(dx);
        track.scrollLeft = startScroll - dx;
    });
    const end = e => {
        if (!down) return;
        down = false;
        track.classList.remove('is-dragging');
        try { track.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    // Un vrai glisser ne doit pas déclencher le clic d'un élément sous le
    // curseur (lien futur dans une carte, etc.).
    track.addEventListener('click', e => {
        if (moved > 6) { e.preventDefault(); e.stopPropagation(); }
    }, true);
}

function fzdRenderDraftBoard(containerId, poolData, team, activeName) {
    const box = document.getElementById(containerId);
    if (!box) return;
    fzdStopDraftBoardTimer(containerId);

    const draftState = poolData ? FZPool.draftState(poolData) : { etat: null };
    const draftOrder = Array.isArray(poolData?.draftOrder) ? poolData.draftOrder : [];
    if (draftState.etat !== 'encours' || !draftOrder.length) {
        box.style.display = 'none';
        box.innerHTML = '';
        fzdStopDraftBoardReveal(containerId);
        delete fzdDraftBoardPick[containerId];
        delete fzdDraftBoardScroll[containerId];
        delete fzdDraftBoardReveal[containerId];
        return;
    }

    const numTeams = new Set(draftOrder).size || 1;
    const total = draftOrder.length;
    const idx = Math.min(Math.max(poolData.currentPickIndex || 0, 0), total - 1);
    const history = Array.isArray(poolData.picksHistory) ? poolData.picksHistory : [];
    const myName = team && team.name;
    const started = Number(poolData.turnStartedAt) || 0;

    // Prochain choix qui est le vôtre (parmi ceux à venir) — reçoit le libellé
    // « Prochain » plutôt que « Dans N choix ».
    let nextMine = -1;
    for (let i = idx + 1; i < total; i++) { if (draftOrder[i] === myName) { nextMine = i; break; } }

    let awayFromMine = -1;
    for (let i = idx; i < total; i++) { if (draftOrder[i] === myName) { awayFromMine = i - idx; break; } }
    const headsub = awayFromMine === 0 ? "C'est votre tour"
        : awayFromMine > 0 ? `Votre tour dans ${awayFromMine} choix`
        : 'Vous avez fait tous vos choix';

    const cards = draftOrder.map((teamName, i) => {
        const rc = `R${Math.floor(i / numTeams) + 1} · C${(i % numTeams) + 1}`;
        const mine = teamName === myName;
        const n = i + 1;

        if (i < idx) {
            const h = history[i] || {};
            const isLast = i === idx - 1;
            const pos = FZD_POS_FR[h.position] || '';
            return `
                <article class="fzd-db-card is-done${isLast ? ' is-last' : ''}">
                    <div class="fzd-db-card-top">
                        <span class="fzd-db-num">Choix ${n}</span>
                        <span class="fzd-db-rc">${rc}</span>
                    </div>
                    <div class="fzd-db-card-body has-face">
                        ${fzdDraftFaceHTML(h.player)}
                        <span class="fzd-db-ident">
                            <span class="fzd-db-name">${escapeHTML(h.player || '—')}</span>
                            <span class="fzd-db-sub">${pos ? escapeHTML(pos) + ' · ' : ''}${escapeHTML(h.team || teamName)}</span>
                        </span>
                    </div>
                    <div class="fzd-db-card-foot">
                        <span>${escapeHTML(teamName)}${mine ? ' · vous' : ''}</span>
                        ${isLast ? '<span class="fzd-db-foot-tag">Dernier</span>' : ''}
                    </div>
                </article>`;
        }

        if (i === idx) {
            const pct = Math.min(100, Math.round((idx / total) * 100));
            return `
                <article class="fzd-db-card is-current">
                    <div class="fzd-db-card-top">
                        <span class="fzd-db-tag">En cours</span>
                        <span class="fzd-db-rc">${rc}</span>
                    </div>
                    <div class="fzd-db-current-head">
                        <span class="fzd-db-num-lg">Choix ${n}</span>
                        <span class="fzd-db-current-team">${escapeHTML(teamName)}${mine ? ' · vous' : ''}</span>
                    </div>
                    <div class="fzd-db-bar"><i style="width:${pct}%"></i></div>
                    <div class="fzd-db-clock-row">
                        <span class="fzd-db-clock">${started ? fzdFormatClock(Date.now() - started) : '—:—'}</span>
                        <span class="fzd-db-clock-lbl">Temps écoulé</span>
                    </div>
                </article>`;
        }

        const away = i - idx;
        if (mine) {
            const soonest = i === nextMine;
            return `
                <article class="fzd-db-card is-mine">
                    <div class="fzd-db-card-top">
                        <span class="fzd-db-num">Choix ${n}</span>
                        <span class="fzd-db-rc is-accent">Vous</span>
                    </div>
                    <div class="fzd-db-card-body">
                        <span class="fzd-db-name">${escapeHTML(teamName)}</span>
                        <span class="fzd-db-sub">${soonest ? 'Préparez votre liste' : 'Votre choix'}</span>
                    </div>
                    <div class="fzd-db-card-foot">
                        <span class="fzd-db-foot-tag is-accent">${soonest ? 'Prochain' : `Dans ${away} choix`}</span>
                    </div>
                </article>`;
        }
        return `
            <article class="fzd-db-card is-future">
                <div class="fzd-db-card-top">
                    <span class="fzd-db-num">Choix ${n}</span>
                    <span class="fzd-db-rc">${rc}</span>
                </div>
                <div class="fzd-db-card-body">
                    <span class="fzd-db-name is-faint">${escapeHTML(teamName)}</span>
                    <span class="fzd-db-sub">À venir</span>
                </div>
                <div class="fzd-db-card-foot"><span>Dans ${away} choix</span></div>
            </article>`;
    }).join('');

    const pct = Math.round((idx / total) * 100);
    const remaining = total - idx;

    // Position d'avant le re-rendu. On la lit d'abord dans le DOM (bureau :
    // le conteneur survit), sinon dans l'état mémorisé (téléphone :
    // renderMobileHome vient de recréer #fzmDraftBoard vide, le DOM ne sait
    // plus rien — c'est ce trou qui renvoyait la piste au début).
    const prevPick = fzdDraftBoardPick[containerId];
    const prevTrack = box.querySelector('.fzd-db-track');
    const prevScroll = prevTrack ? prevTrack.scrollLeft : fzdDraftBoardScroll[containerId];

    box.style.display = '';
    box.innerHTML = `
        <div class="fzd-db-inner">
            <div class="fzd-db-head">
                <div class="fzd-db-head-copy">
                    <span class="fzd-db-eyebrow">Ordre des choix</span>
                    <h2 class="fzd-db-title">En direct — choix ${idx + 1} / ${total}</h2>
                    <span class="fzd-db-headsub">${escapeHTML(headsub)}</span>
                </div>
                <div class="fzd-db-nav">
                    <button type="button" class="fzd-db-nav-btn" data-dir="-1" aria-label="Choix précédents">‹</button>
                    <button type="button" class="fzd-db-nav-btn" data-dir="1" aria-label="Choix suivants">›</button>
                </div>
            </div>
            <div class="fzd-db-track">${cards}</div>
            <div class="fzd-db-foot">
                <div class="fzd-db-progress"><i style="width:${pct}%"></i><b style="left:${pct}%"></b></div>
                <span class="fzd-db-progress-lbl">${idx} choix fait${idx > 1 ? 's' : ''} · ${remaining} restant${remaining > 1 ? 's' : ''}</span>
                <a class="fzd-db-full" href="draftActif.html?pool=${encodeURIComponent(activeName || '')}">Tableau complet →</a>
            </div>
            <p class="fzd-db-note">Le classement s'ouvre une fois le repêchage terminé.</p>
        </div>`;

    const track = box.querySelector('.fzd-db-track');
    fzdBindDragScroll(track);

    // Premier rendu → on centre le choix en cours d'un placement sec.
    // Un choix vient de tomber (l'index a bougé) → on montre d'abord le
    // joueur repêché, puis on glisse au choix en cours (fzdRevelerChoix).
    // Sinon → on rend la position que l'utilisateur avait avant le re-rendu.
    const current = track.querySelector('.is-current');
    const dernier = track.querySelector('.fzd-db-card.is-last');
    const pickChanged = prevPick != null && prevPick !== idx;
    // Rejouée aussi quand un rafraîchissement tombe au milieu de la mise en
    // avant (le serveur en émet plusieurs par choix) : les cartes sont
    // neuves, la classe et le minutage d'avant sont partis avec les
    // anciennes. Toute la séquence repart, plutôt que de recoller la classe
    // sur le minuteur déjà lancé — sinon l'animation redémarrerait de zéro
    // pour être coupée net une fraction de seconde plus tard.
    const aReveler = dernier && !fzdMoinsDAnimation()
        && (!!fzdDraftBoardRevealTimers[containerId]
            || (pickChanged && fzdDraftBoardReveal[containerId] !== idx));

    if (aReveler) {
        fzdDraftBoardReveal[containerId] = idx;
        fzdRevelerChoix(containerId, track, dernier);
    } else if (current && (prevPick == null || pickChanged)) {
        // La cible est mémorisée tout de suite : si un second rafraîchissement
        // arrive pendant le glissement (le serveur en émet plusieurs par
        // choix), il restaure le choix en cours et non la position d'avant.
        const target = fzdCenterDraftCard(track, current, pickChanged);
        if (target != null) fzdDraftBoardScroll[containerId] = target;
    } else if (prevScroll != null) {
        track.scrollLeft = prevScroll;
    }
    fzdDraftBoardPick[containerId] = idx;

    // Mémorise ce que l'utilisateur fait défiler, pour le lui rendre au
    // prochain rendu même si le conteneur a été recréé entre-temps.
    let scrollSave;
    track.addEventListener('scroll', () => {
        clearTimeout(scrollSave);
        scrollSave = setTimeout(() => { fzdDraftBoardScroll[containerId] = track.scrollLeft; }, 120);
    });

    box.querySelectorAll('.fzd-db-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const card = track.querySelector('.fzd-db-card');
            const step = ((card && card.offsetWidth) || 180) + 12;
            track.scrollBy({ left: step * 2 * Number(btn.dataset.dir), behavior: 'smooth' });
        });
    });

    // Pendule du tour : on ne remplace que le texte, jamais tout le carrousel
    // (sinon la position de défilement sauterait à chaque seconde).
    if (started) {
        fzdDraftBoardTimers[containerId] = setInterval(() => {
            const el = document.getElementById(containerId);
            const clock = el && el.querySelector('.fzd-db-clock');
            if (!clock) { fzdStopDraftBoardTimer(containerId); return; }
            clock.textContent = fzdFormatClock(Date.now() - started);
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
let offseasonTab = 'all';
const OFFSEASON_TABS = ['all', 'trade', 'signing', 'injury'];
const OFFSEASON_TAB_LABELS = { all: 'Tout', trade: 'Échanges', signing: 'Signatures', injury: 'Blessés' };
let offseasonCarouselBound = false;

async function loadOffseasonTransactions() {
    const wrap = document.getElementById('fzdOffTransactions');
    if (!wrap) return;

    // On demande tout le journal (TRANSACTIONS_KEEP=250, cap blessés=300) :
    // le carrousel montre chaque onglet en entier, donc chaque liste doit
    // être complète en main — et groupTrades voit ainsi tout l'échange,
    // pas une moitié tronquée par la fenêtre.
    const [tx, inj] = await Promise.all([
        fetch('/nhl-transactions?limit=250').then(r => r.json()).catch(() => null),
        fetch('/nhl-injuries?limit=300').then(r => r.json()).catch(() => null)
    ]);

    const moves = tx?.transactions || [];
    const deals = groupTrades(moves.filter(t => t.type === 'trade'));
    const signings = moves.filter(t => t.type === 'signing');
    const injuries = inj?.injuries || [];

    // « Tout » : les trois flux fondus et retriés du plus récent au plus
    // ancien. Chaque entrée garde sa forme d'origine, `kind` dit quelle
    // carte rendre. Échange → date jour ; signature → date jour ; blessé →
    // `since` (date de déclaration ESPN).
    const stamp = iso => (iso ? new Date(iso).getTime() : 0) || 0;
    const all = [
        ...deals.map(d => ({ kind: 'trade', item: d, ts: stamp(d.date) })),
        ...signings.map(s => ({ kind: 'signing', item: s, ts: stamp(s.date) })),
        ...injuries.map(i => ({ kind: 'injury', item: i, ts: stamp(i.since) }))
    ].sort((a, b) => b.ts - a.ts);

    offseasonLeague = {
        all,
        trade: deals,
        signing: signings,
        injury: injuries,
        counts: {
            // Échanges : un décompte d'opérations (après regroupement). Pour
            // signatures/blessés, le total serveur (peut dépasser la fenêtre
            // demandée). « Tout » : la somme des trois.
            trade: deals.length,
            signing: tx?.counts?.signing || 0,
            injury: inj?.total || 0
        },
        tracking: !!tx?.tracking
    };
    offseasonLeague.counts.all = offseasonLeague.counts.trade
        + offseasonLeague.counts.signing + offseasonLeague.counts.injury;

    // Ouvrir sur un onglet qui a de quoi montrer plutôt que sur un onglet
    // vide un lendemain de journée calme.
    const firstFilled = OFFSEASON_TABS.find(k => offseasonLeague[k].length);
    if (firstFilled && !offseasonLeague[offseasonTab].length) offseasonTab = firstFilled;

    renderOffseasonFilters();
    if (!offseasonCarouselBound) { offseasonCarouselBound = true; bindOffseasonCarousel(); }
    renderOffseasonLeague();
}

// Barre de filtres « Tout / Échanges / Signatures / Blessés » avec compteur,
// re-rendue à chaque changement d'onglet pour l'état actif et les nombres.
function renderOffseasonFilters() {
    const bar = document.getElementById('fzdOffTabs');
    if (!bar || !offseasonLeague) return;
    bar.innerHTML = OFFSEASON_TABS.map(k => {
        const n = offseasonLeague.counts[k] || 0;
        return `<button type="button" class="fzd-off-filter${k === offseasonTab ? ' is-active' : ''}" data-tab="${k}">`
            + `${OFFSEASON_TAB_LABELS[k]}<span class="fzd-off-filter-count">${n}</span></button>`;
    }).join('');
    bar.querySelectorAll('.fzd-off-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab === offseasonTab) return;
            offseasonTab = btn.dataset.tab;
            renderOffseasonFilters();
            renderOffseasonLeague();
        });
    });
}

// Flèches précédent/suivant + points de progression du carrousel. Câblé une
// seule fois (garde offseasonCarouselBound) : le contenu de la piste change,
// pas ses contrôles.
function bindOffseasonCarousel() {
    const track = document.getElementById('fzdOffTransactions');
    const prev = document.getElementById('fzdOffPrev');
    const next = document.getElementById('fzdOffNext');
    if (!track) return;

    const step = () => {
        const card = track.querySelector('.fzd-off-card');
        // Un cran = une carte (gap compris) ; repli sur ~90 % de la fenêtre.
        return card ? card.getBoundingClientRect().width + 12 : track.clientWidth * 0.9;
    };
    prev?.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
    next?.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }));

    let raf = 0;
    track.addEventListener('scroll', () => {
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; updateOffseasonCarousel(); });
    });
    window.addEventListener('resize', () => {
        clearTimeout(bindOffseasonCarousel._t);
        bindOffseasonCarousel._t = setTimeout(renderOffseasonDots, 150);
    });
}

function renderOffseasonLeague() {
    const track = document.getElementById('fzdOffTransactions');
    if (!track || !offseasonLeague) return;

    const rows = offseasonLeague[offseasonTab] || [];
    if (!rows.length) {
        track.classList.add('is-empty');
        track.innerHTML = `<p class="fzd-off-empty">${offseasonEmptyText()}</p>`;
        renderOffseasonDots();
        return;
    }

    track.classList.remove('is-empty');
    track.innerHTML = rows.map(row => offseasonTab === 'all'
        ? offseasonCardHTML(row.kind, row.item)
        : offseasonCardHTML(offseasonTab, row)).join('');
    track.scrollLeft = 0;
    renderOffseasonDots();
}

// Points de progression — un par « page » de défilement (largeur de piste),
// pas un par carte : une centaine de blessés donnerait une centaine de points.
function renderOffseasonDots() {
    const track = document.getElementById('fzdOffTransactions');
    const dots = document.getElementById('fzdOffDots');
    if (!track || !dots) return;

    const pages = track.classList.contains('is-empty')
        ? 0
        : Math.max(1, Math.round(track.scrollWidth / track.clientWidth));
    if (pages < 2) { dots.innerHTML = ''; updateOffseasonCarousel(); return; }
    dots.innerHTML = Array.from({ length: pages }, (_, i) =>
        `<button type="button" class="fzd-off-dot" data-page="${i}" aria-label="Page ${i + 1}"></button>`).join('');
    dots.querySelectorAll('.fzd-off-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            track.scrollTo({ left: dot.dataset.page * track.clientWidth, behavior: 'smooth' });
        });
    });
    updateOffseasonCarousel();
}

// Reflète la position de défilement : point actif + flèches grisées aux bouts.
function updateOffseasonCarousel() {
    const track = document.getElementById('fzdOffTransactions');
    const dots = document.getElementById('fzdOffDots');
    const prev = document.getElementById('fzdOffPrev');
    const next = document.getElementById('fzdOffNext');
    if (!track) return;

    const max = track.scrollWidth - track.clientWidth - 1;
    if (prev) prev.disabled = track.scrollLeft <= 0;
    if (next) next.disabled = track.scrollLeft >= max;

    if (dots && dots.children.length) {
        const active = Math.round(track.scrollLeft / track.clientWidth);
        [...dots.children].forEach((d, i) => d.classList.toggle('is-active', i === active));
    }
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

// Une carte de carrousel selon le type de mouvement. `kind` vient soit de
// l'onglet actif, soit de l'entrée fondue de l'onglet « Tout ».
function offseasonCardHTML(kind, item) {
    if (kind === 'trade') return offDealCardHTML(item);
    if (kind === 'signing') return offSigningCardHTML(item);
    return offInjuryCardHTML(item);
}

// Échange : les deux clubs empilés, ce que chacun reçoit dessous, séparés
// par un filet — même lecture qu'avant (dealRowHTML), repliée dans une
// carte de largeur fixe. Le club qui reçoit quelque chose passe en tête :
// sur un échange à sens unique, « Rien en retour » finit en bas.
function offDealCardHTML(d) {
    const sideHTML = team => {
        const club = d.names[team] || team;
        const players = d.gets[team] || [];
        const gets = players.length
            ? players.map(p => `<li class="fzd-off-deal-get">${escapeHTML(p.name)}`
                + `${p.pos ? ` <span class="fzd-off-pos">${escapeHTML(p.pos)}</span>` : ''}</li>`).join('')
            : '<li class="fzd-off-deal-get is-empty">Rien en retour</li>';
        return `
            <div class="fzd-off-deal-side">
                <div class="fzd-off-deal-club">
                    ${teamLogoImg(team)}
                    <span class="fzd-off-deal-club-name">${escapeHTML(club)}</span>
                    <span class="fzd-off-deal-acq">Acquiert</span>
                </div>
                <ul class="fzd-off-deal-gets">${gets}</ul>
            </div>`;
    };
    const [first, second] = [d.teamA, d.teamB]
        .sort((x, y) => (d.gets[y]?.length || 0) - (d.gets[x]?.length || 0));
    return `
        <article class="fzd-off-card is-trade">
            <div class="fzd-off-card-top">
                <span class="fzd-off-tag is-trade">Échange</span>
                <span class="fzd-off-card-date">${dayLabelFr(d.date)}</span>
            </div>
            <div class="fzd-off-deal">
                ${sideHTML(first)}
                <div class="fzd-off-deal-rule" aria-hidden="true"></div>
                ${sideHTML(second)}
            </div>
        </article>`;
}

function offSigningCardHTML(t) {
    const club = [t.toTeamName || t.toTeam || '?', t.pos].filter(Boolean).join(' · ');
    return `
        <article class="fzd-off-card is-signing">
            <div class="fzd-off-card-top">
                <span class="fzd-off-tag is-signing">Signature</span>
                <span class="fzd-off-card-date">${dayLabelFr(t.date)}</span>
            </div>
            <div class="fzd-off-card-name fzd-display">${escapeHTML(t.playerName)}</div>
            <div class="fzd-off-card-club">
                ${teamLogoImg(t.toTeam || '')}
                <span>${escapeHTML(club)}</span>
            </div>
        </article>`;
}

function offInjuryCardHTML(i) {
    const club = [i.teamName || i.team, i.pos].filter(Boolean).join(' · ');
    const detail = [i.injuryType, i.injuryDetail].filter(Boolean).join(' / ');
    const back = i.returnDate ? dayLabelFr(i.returnDate) : (i.statusFr || '—');
    return `
        <article class="fzd-off-card is-injury">
            <div class="fzd-off-card-top">
                <span class="fzd-off-tag is-injury">Blessé</span>
                <span class="fzd-off-card-date">${dayLabelFr(i.since)}</span>
            </div>
            <div class="fzd-off-card-name fzd-display">${escapeHTML(i.playerName)}</div>
            <div class="fzd-off-card-club">
                ${teamLogoImg(i.team || '')}
                <span>${escapeHTML(club)}</span>
            </div>
            <div class="fzd-off-card-stats">
                <div class="fzd-off-stat">
                    <span class="fzd-off-stat-lbl">Blessure</span>
                    <span class="fzd-off-stat-val" data-status="${escapeHTML(i.status || '')}">${escapeHTML(detail || i.statusFr || '—')}</span>
                </div>
                <div class="fzd-off-stat">
                    <span class="fzd-off-stat-lbl">Retour</span>
                    <span class="fzd-off-stat-val">${escapeHTML(back)}</span>
                </div>
            </div>
        </article>`;
}

function offseasonEmptyText() {
    if (offseasonTab === 'injury') return 'Aucun blessé signalé.';
    // Tant que le serveur n'a pas deux photos d'alignements à comparer, il n'a
    // rien à dire — ce qui n'est pas la même chose qu'une ligue tranquille.
    if (!offseasonLeague?.tracking) return 'Le suivi des mouvements démarre à la prochaine mise à jour des alignements.';
    if (offseasonTab === 'trade') return 'Aucun échange récent.';
    if (offseasonTab === 'signing') return 'Aucune signature récente.';
    return 'Aucun mouvement récent.';
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

    document.getElementById('fzdCalMore')?.addEventListener('click', () => {
        calGamesExpanded = !calGamesExpanded;
        renderDayGames();
    });
    document.getElementById('fzdCalGames')?.addEventListener('scroll', updateCalGameDots, { passive: true });

    // Le même DOM sert la grille bureau et le carrousel téléphone, mais pas
    // avec le même nombre de cartes (repli à 4 d'un côté, tout de l'autre) ni
    // au même endroit dans la page : franchir 768px demande donc un re-rendu,
    // pas seulement un changement de CSS.
    let lastPhone = calIsPhone();
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const phone = calIsPhone();
            if (phone === lastPhone) return;
            lastPhone = phone;
            fzdPlaceCalendar();
            if (calData) renderDayGames();
        }, 150);
    });
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
    if (!hasPool && hero) { fzdStopHeroTimer('fzDashHero'); hero.style.display = 'none'; hero.innerHTML = ''; }
    if (!hasPool) fzdRenderDraftBoard('fzDashDraftBoard', null, null, null);
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
    fzdPlaceCalendar();
    renderQuickActions();
    renderMyPoolsList();
    renderActivityFeed();

    const dash = await loadDashData();
    if (dash) {
        // Les cartes joueur du calendrier lisent calTonight : on le pose AVANT
        // renderMobileHome (qui redessine le calendrier une fois déplacé), pour
        // que les stats en direct arrivent du premier coup.
        calTonight = dash.tonight || { players: [], games: [] };
        renderHero(dash.tonight);
        fzdRenderDraftBoard('fzDashDraftBoard', FZPool.data(), FZPool.team(), dash.activeName);
        renderLivePanel(dash.tonight, dash.movement, dash.activeName);
        renderMobileHome(dash.tonight, dash.movement, dash.activeName);
    } else {
        renderHero(null);
        fzdRenderDraftBoard('fzDashDraftBoard', FZPool.data(), FZPool.team(), FZPool.get());
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
