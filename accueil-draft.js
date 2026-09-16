/* Draft-state homepage. NHL content and pool state remain owned by the existing feeds. */
let fzhNewsPromise = null;
let fzhNewsIndex = 0;
let fzhActivePool = null;
let fzhCalTeam = 'all';

function fzhReset() {
    if (!document.getElementById('fzDraftHome')) return;
    fzdRestoreCalendar();
    document.getElementById('fzDraftHome').remove();
    document.getElementById('fzDashSection')?.classList.remove('is-drafting');
    document.body.classList.remove('fz-draft-page');
    fzhActivePool = null;
}

function fzhIcon(name, size = 22) {
    const paths = {
        calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 11h18"/>',
        users: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3ZM17 3a4 4 0 0 1 0 8M19 14a5 5 0 0 1 3 5v2"/>',
        'arrow-right': '<path d="M3 12h18m-7-7 7 7-7 7"/>',
        'chevron-right': '<path d="m9 5 7 7-7 7"/>',
        'chevron-left': '<path d="m15 5-7 7 7 7"/>',
        zap: '<path d="m13 2-9 12h7l-1 8 10-13h-8Z"/>',
        chart: '<path d="M4 20V11M10 20V4M16 20V8M22 20V2"/>'
    };
    const svg = paths[name] ? `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>` : getIcon(name, size);
    return `<span class="fzh-icon" aria-hidden="true">${svg}</span>`;
}

function fzhHeading(icon, text, action = '') {
    return `<header class="fzh-heading"><h2>${fzhIcon(icon)}${text}</h2>${action}</header>`;
}

function renderDraftHome({ tonight, activeName }) {
    const state = fzdHeroState(tonight);
    if (!state || state.mode !== 'draft') { fzhReset(); return false; }
    fzsReset();
    fzdRestoreCalendar();
    fzdStopHeroTimer('fzDashHero');
    fzdStopHeroTimer('fzmHeroSlot');
    document.getElementById('fzMobileHome').innerHTML = '';
    if (fzhActivePool !== activeName) {
        fzhCalTeam = 'all';
        fzhActivePool = activeName;
    }
    const section = document.getElementById('fzDashSection');
    section.classList.add('is-drafting');
    document.body.classList.add('fz-draft-page');
    let root = document.getElementById('fzDraftHome');
    if (!root) {
        root = document.createElement('div');
        root.id = 'fzDraftHome'; root.className = 'fzh';
        section.querySelector('.fz-dash').appendChild(root);
    }
    const { poolData, team } = state;
    const order = poolData.draftOrder || [];
    const pick = poolData.currentPickIndex || 0;
    const teams = new Set(order).size || 1;
    const round = Math.floor(pick / teams) + 1;
    const rounds = Math.ceil(order.length / teams);
    const next = order.indexOf(team.name, pick);
    const away = next < 0 ? null : next - pick;
    const participants = [...new Set(Object.values(poolData.teams || {}).flatMap(t => t.members || []))];
    const config = poolData.config || {};
    const slots = ['numOffensive', 'numDefensive', 'numRookies', 'numGoalies', 'numTeams'].reduce((n, k) => n + (Number(config[k]) || 0), 0) || order.filter(t => t === team.name).length;
    const drafted = fzdNombreDeChoix(team.data);
    const progress = slots ? Math.min(100, drafted / slots * 100) : 0;
    const url = `draftActif.html?pool=${encodeURIComponent(activeName)}`;
    const today = todayISO();
    const season = calData?.regularSeasonStartDate;
    const camp = calData?.preSeasonStartDate;
    const target = camp && today < camp ? camp : season && today < season ? season : null;
    const days = target ? Math.max(0, Math.ceil((Date.parse(target + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000)) : null;
    const year = season?.slice(0, 4);
    const seasonLabel = year ? `${year}-${String(Number(year) + 1).slice(-2)}` : '';
    const liveGames = fzhLiveGames(tonight);
    root.innerHTML = `
        <section class="fzh-draft fzh-panel${away === 0 ? ' is-my-turn' : ''}" aria-labelledby="fzhDraftTitle">
            <span class="fzh-status"><i></i>${away === 0 ? 'À vous de jouer' : 'En cours'}</span>
            <div class="fzh-draft-main"><div class="fzh-puck" aria-hidden="true"><i></i></div>
                <div class="fzh-draft-copy"><p class="fzh-eyebrow" role="status">${away === 0 ? 'C’est votre tour' : away === null ? 'Tous vos choix sont faits' : `Votre tour dans ${away} choix`}</p><h1 id="fzhDraftTitle">Repêchage en cours</h1><p class="fzh-draft-description">${poolData.instant ? 'Repêchage instantané' : escapeHTML(activeName)} <span>•</span> ${teams} équipes <span>•</span> ${rounds} rondes</p></div>
                <dl class="fzh-draft-stats"><div><dt>Ronde</dt><dd>${round} / ${rounds}</dd></div><div><dt>Choix actuel</dt><dd>${pick + 1} / ${order.length}</dd></div><div><dt>Tour estimé</dt><dd class="fzh-estimate">${away === 0 ? 'Maintenant' : away === null ? 'Terminé' : 'À déterminer'} <span title="Le délai dépend du rythme des prochains choix.">${fzhIcon('info', 17)}</span></dd></div></dl>
            </div>
            <div class="fzh-draft-bottom"><div class="fzh-participants"><span class="fzh-eyebrow">Participants (${participants.length})</span><div class="fzh-participant-track">${participants.map(name => `<span class="fzh-participant${name === userData.username ? ' is-me' : ''}"><i>${escapeHTML(name.charAt(0).toUpperCase())}</i><span>${escapeHTML(name)}</span>${name === userData.username ? '<b>Toi</b>' : ''}</span>`).join('')}</div></div><a class="fzh-cta" href="${url}">${away === 0 ? 'Faire mon choix' : 'Aller au repêchage'} ${fzhIcon('arrow-right', 26)}</a></div>
        </section>
        <button type="button" class="fzh-camp fzh-panel fzh-summary" data-fzh-calendar>${fzhIcon('calendar', 40)}<span><span class="fzh-eyebrow">${target === camp && target ? 'Camp d’entraînement' : target ? 'Début de saison' : 'Calendrier LNH'}</span><strong>${days === null ? 'La saison est en cours' : `Dans ${days} jour${days > 1 ? 's' : ''}`}</strong><small>${target ? `La saison ${seasonLabel} commence bientôt.` : 'Chaque match compte.'}</small></span>${fzhIcon('chevron-right', 19)}<img class="fzh-nhl" src="https://assets.nhle.com/logos/nhl/svg/NHL_dark.svg" alt=""></button>
        <button type="button" class="fzh-team fzh-panel fzh-summary" data-fz-reglages="equipes">${fzhIcon('users', 38)}<span><span class="fzh-eyebrow">Mon équipe</span><strong>${drafted} / ${slots}</strong><span class="fzh-team-progress"><span class="fzh-progress" role="progressbar" aria-label="Joueurs repêchés" aria-valuenow="${drafted}" aria-valuemin="0" aria-valuemax="${Math.max(slots, drafted)}"><i style="width:${progress}%"></i></span><small>joueurs repêchés</small></span></span>${fzhIcon('chevron-right', 19)}</button>
        ${liveGames.length ? `<section class="fzh-scores fzh-panel">${fzhHeading('zap', 'Matchs en direct', '<button type="button" class="fzh-link" data-fzh-calendar>Voir tous <span aria-hidden="true">→</span></button>')}<div class="fzh-score-track">${fzhGamesHTML(liveGames)}</div></section>` : ''}
        <section class="fzh-moves fzh-panel">${fzmLeagueSectionHTML(false).replace('Dans la LNH', 'Mouvements récents')}</section>
        <section class="fzh-watch fzh-panel" data-watch-panel>${fzhWatchHTML()}</section>
        <section class="fzh-calendar fzh-panel" aria-labelledby="fzhCalTitle">${fzhCalendarHTML(Boolean(target))}</section>
        <section class="fzh-news fzh-panel" id="fzhNews" aria-label="Actualités LNH"><div class="fzh-news-copy"><span class="fzh-news-badge">LNH</span><h2>Le hockey n’attend pas.</h2><p>Préparez votre prochain choix.</p><small>Chargement des actualités…</small></div></section>`;
    fzhRenderWatch(root);
    // Le calendrier est déroulé en permanence : les raccourcis (« Camp
    // d'entraînement », « Voir tous ») n'ont plus qu'à l'amener à l'écran.
    root.querySelectorAll('[data-fzh-calendar]').forEach(button => button.addEventListener('click', () => {
        root.querySelector('.fzh-calendar').scrollIntoView({ behavior: offseasonScrollBehavior(), block:'start' });
    }));
    root.querySelectorAll('[data-cal-week]').forEach(button => button.addEventListener('click', () => {
        if (Number(button.dataset.calWeek) < 0) calGoPrevWeek(); else calGoNextWeek();
    }));
    if (participants.length > 6) {
        const track = root.querySelector('.fzh-participant-track');
        const more = document.createElement('button');
        more.type = 'button'; more.className = 'fzh-participant-more';
        more.textContent = `+${participants.length - 6}`;
        more.setAttribute('aria-label', 'Afficher tous les participants');
        more.setAttribute('aria-expanded', 'false');
        more.addEventListener('click', () => {
            const expanded = track.classList.toggle('is-expanded');
            more.setAttribute('aria-expanded', String(expanded));
            more.setAttribute('aria-label', expanded ? 'Réduire les participants' : 'Afficher tous les participants');
            more.textContent = expanded ? '−' : `+${participants.length - 6}`;
        });
        track.appendChild(more);
    }
    const moves = root.querySelector('.fzh-moves');
    const movesTitle = moves.querySelector('.fzm-section-title');
    if (movesTitle) movesTitle.innerHTML = `${fzhIcon('swap')} Mouvements récents`;
    renderCalendar();
    fzmLoadLeague();
    fzhLoadNews(root);
    return true;
}

function fzhLiveGames(tonight) {
    return (tonight.games || []).filter(g => ['LIVE', 'CRIT'].includes(g.state));
}

function fzhGamesHTML(games) {
    return games.map(g => `<article class="fzh-game"><p>${periodLabel(g.period, g.periodType)} période · ${escapeHTML(g.clock?.timeRemaining || '')}</p>${[g.away, g.home].map(t => `<div>${teamLogoImg(t.abbrev)}<strong>${escapeHTML(t.abbrev)}</strong><b>${t.score ?? '–'}</b></div>`).join('')}<span class="fzh-game-badge is-live">En direct</span></article>`).join('');
}

async function fzhLoadNews(root) {
    const slot = root.querySelector('#fzhNews');
    if (!fzhNewsPromise) fzhNewsPromise = fetchNhlNews().catch(() => []);
    const articles = (await fzhNewsPromise).slice(0, 5);
    if (!slot.isConnected) return;
    if (!articles.length) {
        slot.classList.add('is-empty');
        slot.innerHTML = `<div class="fzh-news-copy"><span class="fzh-news-badge">Votre prochain choix</span><h2>Les grandes équipes se bâtissent ici.</h2><p>Explorez les joueurs. Préparez votre liste. Faites votre marque.</p><a class="fzh-link" href="stats.html">Explorer les joueurs <span aria-hidden="true">→</span></a></div>`;
        return;
    }
    const render = () => {
        fzhNewsIndex = (fzhNewsIndex + articles.length) % articles.length;
        const a = articles[fzhNewsIndex];
        slot.innerHTML = `${a.image ? `<img class="fzh-news-image" src="${escapeHTML(a.image)}" alt="" onerror="this.remove()">` : ''}<div class="fzh-news-copy"><span class="fzh-news-badge">${escapeHTML(a.source || 'Actualité')}</span><h2><a href="${escapeHTML(a.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(a.title)}</a></h2>${a.description ? `<p>${escapeHTML(a.description)}</p>` : ''}<small>${escapeHTML(a.source || 'LNH')}${a.publishedAt ? ` <span>•</span> ${relativeTimeFr(a.publishedAt)}` : ''}</small></div>${articles.length > 1 ? `<div class="fzh-news-controls"><div class="fzh-news-dots">${articles.map((_, i) => `<button type="button" data-fzh-slide="${i}" aria-label="Actualité ${i + 1}" aria-pressed="${i === fzhNewsIndex}"></button>`).join('')}</div><button type="button" data-fzh-step="-1" aria-label="Actualité précédente">${fzhIcon('chevron-left', 24)}</button><button type="button" data-fzh-step="1" aria-label="Actualité suivante">${fzhIcon('chevron-right', 24)}</button></div>` : ''}`;
        slot.querySelectorAll('[data-fzh-step]').forEach(b => b.addEventListener('click', () => { const step = b.dataset.fzhStep; fzhNewsIndex += Number(step); render(); slot.querySelector(`[data-fzh-step="${step}"]`)?.focus({ preventScroll:true }); }));
        slot.querySelectorAll('[data-fzh-slide]').forEach(b => b.addEventListener('click', () => { fzhNewsIndex = Number(b.dataset.fzhSlide); render(); slot.querySelector(`[data-fzh-slide="${fzhNewsIndex}"]`)?.focus({ preventScroll:true }); }));
    };
    render();
}

// ============================================================
// CALENDRIER PRÉSAISON — maquette Claude Design « Canvas-2 » : bandeau de
// jours, journée sélectionnée avec son filtre par équipe, puis les matchs
// de la journée en carrousel, chaque carte portant vos joueurs à l'horaire.
// Mêmes données que le calendrier du tableau de bord (GET /schedule/:date,
// calData / calSelectedDate) ; pendant un repêchage ce panneau le remplace
// à l'écran, et renderCalendar() se branche ici (voir accueil-dash.js).
// ============================================================
function fzhCalendarHTML(preseason) {
    return `<header class="fzh-heading fzh-cal-head"><h2 id="fzhCalTitle">${fzhIcon('calendar')}Calendrier${preseason ? ' présaison' : ' LNH'}</h2><span class="fzh-cal-range" data-cal-range></span><div class="fzh-cal-nav"><button type="button" data-cal-week="-1" aria-label="Semaine précédente">‹</button><button type="button" data-cal-week="1" aria-label="Semaine suivante">›</button></div></header>
        <div class="fzh-cal-strip" data-cal-strip></div>
        <div class="fzh-cal-dayhead"><strong class="fzh-cal-dayname" data-cal-dayname></strong><div class="fzh-cal-filter"><select data-cal-team aria-label="Filtrer par équipe"></select></div><span class="fzh-cal-daycount" data-cal-count role="status"></span><div class="fzh-cal-nav"><button type="button" data-cal-games="-1" aria-label="Matchs précédents">‹</button><button type="button" data-cal-games="1" aria-label="Matchs suivants">›</button></div></div>
        <div class="fzh-cal-track" data-cal-track></div>
        <div class="fzh-cal-controls"><div class="fzd-off-dots" data-cal-dots></div></div>`;
}

/** Rend le calendrier de la home de repêchage. Faux s'il n'est pas à l'écran. */
function fzhRenderCalendar() {
    const panel = document.querySelector('#fzDraftHome .fzh-calendar');
    if (!panel) return false;
    const days = (calData && calData.days) || [];
    fzhCalHead(panel, days);
    fzhCalStrip(panel, days);
    fzhCalDay(panel, days);
    return true;
}

/** « 15 – 21 sept. · 32 matchs » : la semaine que /schedule/:date a renvoyée. */
function fzhCalHead(panel, days) {
    const total = days.reduce((n, d) => n + (d.games || []).length, 0);
    const mon = iso => FR_MONTH_SHORT[Number(iso.slice(5, 7)) - 1];
    const first = days[0]?.date, last = days[days.length - 1]?.date;
    const range = !first ? '' : mon(first) === mon(last)
        ? `${dayNum(first)} – ${dayNum(last)} ${mon(last)}`
        : `${dayNum(first)} ${mon(first)} – ${dayNum(last)} ${mon(last)}`;
    panel.querySelector('[data-cal-range]').textContent = range ? `${range} · ${total} match${total > 1 ? 's' : ''}` : '';
    panel.querySelector('[data-cal-week="-1"]').disabled = !calData?.previousStartDate;
    panel.querySelector('[data-cal-week="1"]').disabled = !calData?.nextStartDate;
}

function fzhCalStrip(panel, days) {
    const strip = panel.querySelector('[data-cal-strip]');
    const today = todayISO();
    strip.innerHTML = days.map(d => {
        const games = (d.games || []).length;
        const isToday = d.date === today;
        // Le mot est dans son propre <span> : au téléphone la case ne fait que
        // 58 px de large et la CSS n'y garde que le chiffre.
        const meta = games
            ? `<span class="fzh-cal-day-n">${games}</span><span class="fzh-cal-day-w"> match${games > 1 ? 's' : ''}</span>`
            : `<span class="fzh-cal-day-n is-none">—</span><span class="fzh-cal-day-w">aucun match</span>`;
        const label = `${FR_DOW_LONG[new Date(d.date + 'T00:00:00Z').getUTCDay()]} ${dayNum(d.date)} ${FR_MONTH[Number(d.date.slice(5, 7)) - 1]} · ${games} match${games > 1 ? 's' : ''}`;
        return `<button type="button" class="fzh-cal-day${isToday ? ' is-today' : ''}${d.date === calSelectedDate ? ' is-selected' : ''}" data-cal-date="${d.date}" aria-pressed="${d.date === calSelectedDate}" aria-label="${label}"><span class="fzh-cal-day-dow">${isToday ? 'Auj' : dowLabel(d.date)}</span><span class="fzh-cal-day-num">${dayNum(d.date)}</span><span class="fzh-cal-day-meta">${meta}</span></button>`;
    }).join('');
    strip.querySelectorAll('[data-cal-date]').forEach(button =>
        button.addEventListener('click', () => selectCalendarDay(button.dataset.calDate)));
    // Centrer la journée choisie à la main : scrollIntoView() ferait aussi
    // sauter la page entière, à chaque rendu du tableau de bord.
    const selected = strip.querySelector('.is-selected'), first = strip.firstElementChild;
    if (selected && first) strip.scrollLeft = Math.max(0, selected.offsetLeft - first.offsetLeft - (strip.clientWidth - selected.offsetWidth) / 2);
}

function fzhCalDay(panel, days) {
    const iso = calSelectedDate || todayISO();
    const d = new Date(iso + 'T00:00:00Z');
    // Deux libellés, un par format : « MERCREDI 17 SEPTEMBRE » ne tient pas
    // sur la ligne du téléphone, qui porte aussi le filtre et les flèches.
    panel.querySelector('[data-cal-dayname]').innerHTML = `<span class="fzh-cal-dayname-full">${FR_DOW_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${FR_MONTH[d.getUTCMonth()].toLowerCase()}</span><span class="fzh-cal-dayname-short">${dowLabel(iso)} ${d.getUTCDate()} ${FR_MONTH_SHORT[d.getUTCMonth()]}</span>`;

    const games = (days.find(x => x.date === iso)?.games) || [];
    const select = panel.querySelector('[data-cal-team]');
    const teams = [...new Set(games.flatMap(g => [g.away.abbrev, g.home.abbrev]))]
        .map(abbrev => [abbrev, teamName(abbrev)])
        .sort((a, b) => a[1].localeCompare(b[1], 'fr'));
    // Un club filtré qui ne joue pas la journée choisie laisserait une page
    // vide sans rien dire : le filtre retombe alors sur « toutes les équipes ».
    if (!teams.some(([abbrev]) => abbrev === fzhCalTeam)) fzhCalTeam = 'all';
    select.innerHTML = `<option value="all">Toutes les équipes (${games.length})</option>`
        + teams.map(([abbrev, name]) => `<option value="${abbrev}">${escapeHTML(name)}</option>`).join('');
    select.value = fzhCalTeam;
    select.onchange = () => { fzhCalTeam = select.value; fzhCalDay(panel, days); };

    const shown = games.filter(g => fzhCalTeam === 'all' || g.away.abbrev === fzhCalTeam || g.home.abbrev === fzhCalTeam);
    panel.querySelector('[data-cal-count]').textContent = `${shown.length} match${shown.length > 1 ? 's' : ''}`;
    const track = panel.querySelector('[data-cal-track]');
    track.classList.toggle('is-empty', !shown.length);
    track.innerHTML = shown.length
        ? shown.map(g => fzhCalGameHTML(g, iso)).join('')
        : `<p class="fzh-empty">${games.length ? 'Aucun match pour cette équipe.' : 'Aucun match cette journée.'}</p>`;
    track.scrollLeft = 0;
    fzhCalDots(panel, true);
}

function fzhCalGameHTML(game, iso) {
    const live = ['LIVE', 'CRIT'].includes(game.state);
    const started = live || ['FINAL', 'OFF'].includes(game.state);
    const mine = fzhCalRosterInGame(game);
    // VIS / DOM tant que le match n'est pas commencé : le pointage prend leur
    // place à la mise au jeu, la carte garde la même hauteur.
    const side = (team, label) => `<div class="fzh-cal-team">${teamLogoImg(team.abbrev)}<span class="fzh-cal-team-name">${escapeHTML(teamName(team.abbrev))}</span>${started ? `<b class="fzh-cal-score">${team.score ?? 0}</b>` : `<span class="fzh-cal-side">${label}</span>`}</div>`;
    const date = `${dowLabel(iso).toUpperCase()} ${dayNum(iso)} ${FR_MONTH_SHORT[Number(iso.slice(5, 7)) - 1].toUpperCase()}`;
    return `<article class="fzh-cal-game${live ? ' is-live' : ''}">
        <div class="fzh-cal-game-head"><span class="fzh-cal-game-date">${date}</span><span class="fzh-cal-game-time${live ? ' is-live' : ''}">${live ? 'En direct' : started ? 'Final' : gameTimeLabel(game.startTimeUTC)}</span></div>
        <div class="fzh-cal-game-teams">${side(game.away, 'VIS')}${side(game.home, 'DOM')}</div>
        ${mine.length ? `<div class="fzh-cal-mine"><span class="fzh-cal-mine-label">${mine.length} de mes joueurs</span><div class="fzh-cal-mine-track">${mine.map(p => `<span class="fzh-cal-chip"><strong>${escapeHTML(p.name)}</strong><small>${escapeHTML(p.meta)}</small></span>`).join('')}</div></div>` : ''}
    </article>`;
}

/** Vos joueurs à l'horaire de ce match, avec leur position et leur club. */
function fzhCalRosterInGame(game) {
    const abbrevs = [game.away.abbrev, game.home.abbrev];
    return activeRosterNames().map(name => {
        const info = getPlayerStats(name);
        if (!info || !abbrevs.includes(info.teamAbbrev)) return null;
        const pos = info.position && info.position !== 'N/A' ? info.position : '';
        return { name, meta: [pos, info.teamAbbrev].filter(Boolean).join(' · ') };
    }).filter(Boolean);
}

function fzhCalDots(panel = document.querySelector('#fzDraftHome .fzh-calendar'), bind = false) {
    if (!panel) return;
    const args = [panel.querySelector('[data-cal-track]'), panel.querySelector('[data-cal-dots]'),
        panel.querySelector('[data-cal-games="-1"]'), panel.querySelector('[data-cal-games="1"]')];
    if (bind) bindOffseasonCarousel(...args);
    renderOffseasonDots(...args);
}
