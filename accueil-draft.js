/* Draft-state homepage. NHL content and pool state remain owned by the existing feeds. */
let fzhNewsPromise = null;
let fzhNewsIndex = 0;

function fzhReset() {
    if (!document.getElementById('fzDraftHome')) return;
    fzdRestoreCalendar();
    document.getElementById('fzDraftHome').remove();
    document.getElementById('fzDashSection')?.classList.remove('is-drafting');
    document.body.classList.remove('fz-draft-page');
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
    const slots = (['numOffensive', 'numDefensive', 'numRookies', 'numGoalies', 'numTeams'].reduce((n, k) => n + (Number(config[k]) || 0), 0)
        + (typeof window.fzQuotaBanc === 'function' ? window.fzQuotaBanc(poolData) : 0)) || order.filter(t => t === team.name).length;
    const drafted = fzdNombreDeChoix(team.data);
    const progress = slots ? Math.min(100, drafted / slots * 100) : 0;
    const url = `draftActif.html?pool=${encodeURIComponent(activeName)}`;
    const liveGames = fzhLiveGames(tonight);
    root.innerHTML = `
        <section class="fzh-draft fzh-panel${away === 0 ? ' is-my-turn' : ''}" aria-labelledby="fzhDraftTitle">
            <img class="fzh-ice" src="assets/hero/fantazy-ice-reference.png" alt="">
            <span class="fzh-status"><i></i>${away === 0 ? 'À vous de jouer' : 'En cours'}</span>
            <div class="fzh-draft-main"><div class="fzh-puck" aria-hidden="true"><i></i></div>
                <div class="fzh-draft-copy"><p class="fzh-eyebrow" role="status">${away === 0 ? 'C’est votre tour' : away === null ? 'Tous vos choix sont faits' : `Votre tour dans ${away} choix`}</p><h1 id="fzhDraftTitle">Repêchage en cours</h1><p class="fzh-draft-description">${poolData.instant ? 'Pool rapide' : escapeHTML(activeName)} <span>•</span> ${teams} équipes <span>•</span> ${rounds} rondes</p></div>
                <dl class="fzh-draft-stats"><div><dt>Ronde</dt><dd>${round} / ${rounds}</dd></div><div><dt>Choix actuel</dt><dd>${pick + 1} / ${order.length}</dd></div><div><dt>Tour estimé</dt><dd class="fzh-estimate">${away === 0 ? 'Maintenant' : away === null ? 'Terminé' : 'À déterminer'} <span title="Le délai dépend du rythme des prochains choix.">${fzhIcon('info', 17)}</span></dd></div></dl>
            </div>
            <div class="fzh-draft-bottom"><div class="fzh-participants"><span class="fzh-eyebrow">Participants (${participants.length})</span><div class="fzh-participant-track">${participants.map(name => `<span class="fzh-participant${name === userData.username ? ' is-me' : ''}"><i>${escapeHTML(name.charAt(0).toUpperCase())}</i><span>${escapeHTML(name)}</span>${name === userData.username ? '<b>Toi</b>' : ''}</span>`).join('')}</div></div><a class="fzh-cta" href="${url}">${away === 0 ? 'Faire mon choix' : 'Aller au repêchage'} ${fzhIcon('arrow-right', 26)}</a></div>
        </section>
        <div class="fzh-slot" data-fz-bloc="horssaison"></div>
        <button type="button" class="fzh-team fzh-panel fzh-summary" data-fz-reglages="equipes">${fzhIcon('users', 38)}<span><span class="fzh-eyebrow">Mes choix</span><strong>${drafted} / ${slots}</strong><span class="fzh-team-progress"><span class="fzh-progress" role="progressbar" aria-label="Joueurs repêchés" aria-valuenow="${drafted}" aria-valuemin="0" aria-valuemax="${Math.max(slots, drafted)}"><i style="width:${progress}%"></i></span><small>joueurs repêchés</small></span></span>${fzhIcon('chevron-right', 19)}</button>
        ${liveGames.length ? `<section class="fzh-scores fzh-panel">${fzhHeading('zap', 'Matchs en direct', '<a class="fzh-link" href="calendrier.html">Calendrier complet <span aria-hidden="true">→</span></a>')}<div class="fzh-score-track">${fzhGamesHTML(liveGames)}</div></section>` : ''}
        <div class="fzh-slot" data-fz-bloc="mouvements"></div>
        <div class="fzh-slot" data-fz-bloc="surveiller"></div>
        <div class="fzh-slot" data-fz-bloc="calendrier"></div>
        <section class="fzh-news fzh-panel" id="fzhNews" aria-label="Actualités LNH"><div class="fzh-news-copy"><span class="fzh-news-badge">LNH</span><h2>Le hockey n’attend pas.</h2><p>Préparez votre prochain choix.</p><small>Chargement des actualités…</small></div></section>`;
    // Les quatre panneaux partagés arrivent d'index.html : on les met en place
    // avant de les remplir (voir fzdPlaceCalendar, accueil-dash.js).
    fzdPlaceCalendar();
    // « Voir tous » n'a plus qu'à amener le calendrier à l'écran : il est
    // déroulé en permanence, juste plus bas.
    root.querySelectorAll('[data-fzh-calendar]').forEach(button => button.addEventListener('click', () => {
        document.getElementById('fzDashCalendarWrap')?.scrollIntoView({ behavior: offseasonScrollBehavior(), block:'start' });
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
    renderCalendar();
    fzdRendreSurveiller();
    fzdRendreMouvements();
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
