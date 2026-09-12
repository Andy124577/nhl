/* Draft-state homepage. NHL content and pool state remain owned by the existing feeds. */
let fzhNewsPromise = null;
let fzhNewsIndex = 0;
let fzhWatchExpanded = false;
let fzhCalendarOpen = false;
let fzhActivePool = null;

function fzhReset() {
    if (!document.getElementById('fzDraftHome')) return;
    fzdRestoreCalendar();
    document.getElementById('fzDraftHome').remove();
    document.getElementById('fzDashSection')?.classList.remove('is-drafting');
    document.body.classList.remove('fz-draft-page');
    document.querySelectorAll('[data-fzh-nav]').forEach(el => el.remove());
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
        fzhWatchExpanded = false;
        fzhCalendarOpen = false;
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
    const seasonText = season && today < season ? `La saison régulière commence le ${new Date(season + 'T12:00:00').toLocaleDateString('fr-CA', { day:'numeric', month:'long', year:'numeric' })}.` : 'Consultez les prochains matchs de la LNH.';
    const weekGames = (calData?.days || []).reduce((n, d) => n + (d.games || []).length, 0);
    root.innerHTML = `
        <section class="fzh-news fzh-panel" id="fzhNews" aria-label="Actualités LNH"><div class="fzh-news-copy"><span class="fzh-news-badge">LNH</span><h2>Le hockey n’attend pas.</h2><p>Préparez votre prochain choix.</p><small>Chargement des actualités…</small></div></section>
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
        <section class="fzh-scores fzh-panel">${fzhHeading('zap', 'Matchs en direct', '<button type="button" class="fzh-link" data-fzh-calendar>Voir tous <span aria-hidden="true">→</span></button>')}<div class="fzh-score-track">${fzhGamesHTML(tonight)}</div></section>
        <section class="fzh-moves fzh-panel">${fzmLeagueSectionHTML(false).replace('Dans la LNH', 'Mouvements récents')}</section>
        <section class="fzh-watch fzh-panel">${fzhHeading('star', 'À surveiller', `<button class="fzh-link" id="fzhWatchMore" type="button" aria-expanded="${fzhWatchExpanded}" aria-controls="fzhWatchRows">${fzhWatchExpanded ? 'Réduire' : `Voir les ${OFFSEASON_WATCHLIST.length} joueurs`} <span aria-hidden="true">→</span></button>`)}<div id="fzhWatchRows"></div></section>
        <section class="fzh-calendar fzh-panel"><div class="fzh-calendar-summary">${fzhIcon('calendar', 32)}<h2>Calendrier${target ? ' présaison' : ''}</h2><div><strong>${weekGames ? `${weekGames} match${weekGames > 1 ? 's' : ''} cette semaine.` : 'Aucun match cette semaine.'}</strong><p>${escapeHTML(seasonText)}</p></div><button type="button" class="fzh-calendar-button" data-fzh-calendar aria-expanded="${fzhCalendarOpen}" aria-controls="fzhCalendarSlot">${fzhCalendarOpen ? 'Fermer' : 'Voir le calendrier'} <span aria-hidden="true">→</span></button></div><div id="fzhCalendarSlot"${fzhCalendarOpen ? '' : ' hidden'}></div></section>`;
    fzhRenderWatch(root);
    root.querySelector('#fzhWatchMore').addEventListener('click', e => {
        fzhWatchExpanded = !fzhWatchExpanded;
        e.currentTarget.setAttribute('aria-expanded', String(fzhWatchExpanded));
        e.currentTarget.innerHTML = `${fzhWatchExpanded ? 'Réduire' : `Voir les ${OFFSEASON_WATCHLIST.length} joueurs`} <span aria-hidden="true">→</span>`;
        fzhRenderWatch(root);
    });
    root.querySelectorAll('[data-fzh-calendar]').forEach(button => button.addEventListener('click', () => {
        fzhCalendarOpen = button.classList.contains('fzh-calendar-button') ? !fzhCalendarOpen : true;
        const slot = root.querySelector('#fzhCalendarSlot'); slot.hidden = !fzhCalendarOpen;
        const toggle = root.querySelector('.fzh-calendar-button');
        toggle.setAttribute('aria-expanded', String(fzhCalendarOpen));
        toggle.innerHTML = `${fzhCalendarOpen ? 'Fermer' : 'Voir le calendrier'} <span aria-hidden="true">→</span>`;
        if (fzhCalendarOpen) { renderCalendar(); slot.scrollIntoView({ behavior:'smooth', block:'nearest' }); }
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
    const movesHead = moves.querySelector('.fzm-league-head');
    if (movesHead) {
        const more = document.createElement('button');
        more.type = 'button'; more.className = 'fzh-link';
        more.innerHTML = 'Voir tout <span aria-hidden="true">→</span>';
        more.setAttribute('aria-expanded', 'false');
        more.addEventListener('click', () => {
            const expanded = moves.classList.toggle('is-expanded');
            more.setAttribute('aria-expanded', String(expanded));
            more.innerHTML = `${expanded ? 'Réduire' : 'Voir tout'} <span aria-hidden="true">→</span>`;
        });
        movesHead.appendChild(more);
    }
    fzdPlaceCalendar();
    renderCalendar();
    fzmLoadLeague();
    fzhLoadNews(root);
    fzhEnsureNav();
    return true;
}

function fzhGamesHTML(tonight) {
    const started = tonight.games || [];
    const scheduled = calData?.days.find(d => d.date === todayISO())?.games || [];
    const games = [...started, ...scheduled.filter(g => !started.some(x => x.id === g.id))];
    if (!games.length) return '<p class="fzh-empty">Aucun match aujourd’hui. Retrouvez les prochains matchs dans le calendrier.</p>';
    return games.map(g => {
        const live = ['LIVE', 'CRIT'].includes(g.state);
        const upcoming = ['FUT', 'PRE'].includes(g.state);
        return `<article class="fzh-game"><p>${live ? `${periodLabel(g.period, g.periodType)} période · ${escapeHTML(g.clock?.timeRemaining || '')}` : upcoming && g.startTimeUTC ? gameTimeLabel(g.startTimeUTC) : 'Terminé'}</p>${[g.away, g.home].map(t => `<div>${teamLogoImg(t.abbrev)}<strong>${escapeHTML(t.abbrev)}</strong><b>${upcoming ? '–' : t.score ?? '–'}</b></div>`).join('')}<span class="fzh-game-badge${live ? ' is-live' : ''}">${live ? 'En direct' : upcoming ? 'À venir' : 'Final'}</span></article>`;
    }).join('');
}

function fzhRenderWatch(root) {
    loadOffWatchFavorites();
    const shown = fzhWatchExpanded ? OFFSEASON_WATCHLIST : OFFSEASON_WATCHLIST.slice(0, 4);
    const wrap = root.querySelector('#fzhWatchRows');
    wrap.innerHTML = shown.length ? shown.map(p => {
        const saved = offWatchFavorites.has(p.name);
        return `<div class="fzh-watch-row">${offPlayerFaceHTML(p.name, p.team, p.playerId)}<div class="fzh-watch-name"><strong>${escapeHTML(p.name)}</strong><small>${escapeHTML(p.team)} · ${escapeHTML(p.position || '—')}</small></div><span class="fzh-watch-status">${fzhIcon('eye', 17)}<span>${escapeHTML(p.note || 'Surveillance')}</span></span><button type="button" class="fzh-watch-star${saved ? ' is-saved' : ''}" data-fzh-player="${escapeHTML(p.name)}" aria-label="${saved ? 'Retirer' : 'Ajouter'} ${escapeHTML(p.name)} ${saved ? 'des' : 'aux'} favoris" aria-pressed="${saved}">${fzhIcon('star', 22)}</button></div>`;
    }).join('') : '<p class="fzh-empty">La liste des joueurs à surveiller sera disponible prochainement.</p>';
    wrap.querySelectorAll('[data-fzh-player]').forEach(button => button.addEventListener('click', () => {
        const name = button.dataset.fzhPlayer;
        if (offWatchFavorites.has(name)) offWatchFavorites.delete(name);
        else offWatchFavorites.set(name, new Date().toISOString());
        try { localStorage.setItem(offWatchStorageKey(), JSON.stringify([...offWatchFavorites])); } catch (_) { /* Keep the session favorite in memory. */ }
        const saved = offWatchFavorites.has(name);
        button.classList.toggle('is-saved', saved);
        button.setAttribute('aria-pressed', String(saved));
        button.setAttribute('aria-label', `${saved ? 'Retirer' : 'Ajouter'} ${name} ${saved ? 'des' : 'aux'} favoris`);
    }));
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

function fzhEnsureNav() {
    // Reuse the existing delegated team-settings action; draft rosters cannot open standings.
    for (const [selector, cls, labelCls, iconCls] of [['.nav-links','nav-link','nav-text','nav-icon'], ['.bottom-nav','bottom-nav-item','bottom-nav-label','bottom-nav-icon']]) {
        const nav = document.querySelector(selector);
        if (!nav || nav.querySelector('[data-fzh-nav]')) continue;
        const button = document.createElement('button');
        button.type = 'button'; button.className = cls;
        button.setAttribute('data-fzh-nav',''); button.setAttribute('data-fz-reglages','equipes');
        button.innerHTML = `<span class="${iconCls}">${getIcon('person',22)}</span><span class="${labelCls}">Mon équipe</span>`;
        nav.firstElementChild?.after(button);
    }
    const desktop = document.querySelector('.nav-links');
    if (desktop && !desktop.querySelector('.fzh-nav-extra')) {
        for (const [label, icon, action] of [['Calendrier', 'calendar', 'calendar'], ['Classements', 'chart', 'standings'], ['Actualités', 'scroll', 'news']]) {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'nav-link fzh-nav-extra';
            button.setAttribute('data-fzh-nav', '');
            button.innerHTML = `<span class="nav-icon">${fzhIcon(icon)}</span><span class="nav-text">${label}</span>`;
            if (action === 'standings') {
                button.disabled = true;
                button.title = 'Classements disponibles après le repêchage';
            } else button.addEventListener('click', () => {
                if (action === 'calendar') document.querySelector('#fzDraftHome .fzh-camp')?.click();
                else document.getElementById('fzhNews')?.scrollIntoView({ behavior:'smooth', block:'center' });
            });
            desktop.appendChild(button);
        }
    }
    const rail = document.querySelector('.fz-sidebar');
    if (rail && !rail.querySelector('.fzh-rail-season')) {
        const badge = document.createElement('div');
        badge.className = 'fzh-rail-season'; badge.setAttribute('data-fzh-nav', '');
        badge.innerHTML = `<img src="https://assets.nhle.com/logos/nhl/svg/NHL_dark.svg" alt="LNH"><span><strong>${fzdSeasonStarted() === true ? 'La saison est en cours' : 'La saison approche'}</strong><small>${fzdSeasonStarted() === true ? 'Suivez chaque match.' : 'Le compte à rebours est lancé.'}</small></span>`;
        rail.appendChild(badge);
    }
}
