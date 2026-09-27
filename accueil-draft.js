/* Draft-state homepage. NHL content and pool state remain owned by the existing feeds. */
let fzhNewsPromise = null;
let fzhNewsIndex = 0;

function fzhReset() {
    if (!document.getElementById('fzDraftHome')) return;
    if (typeof fzhHeroArreter === 'function') fzhHeroArreter();
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

/**
 * L'accueil du repêchage, du pool tout juste créé à la fin des choix : le
 * héros (accueil-draft-hero.js) en haut, puis les blocs partagés. Avant le
 * départ, le panneau « Sélections » n'a rien à montrer et reste absent.
 */
function renderDraftHome({ tonight, activeName }) {
    const state = fzdHeroState(tonight);
    if (!state || (state.mode !== 'draft' && state.mode !== 'predraft')) { fzhReset(); return false; }
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
    const started = state.mode === 'draft';
    const liveGames = fzhLiveGames(tonight);
    root.innerHTML = `
        <div class="fzh-barre-place" data-fzh-barre></div>
        <div class="fzh-hero-place" data-fzh-hero></div>
        <div class="fzh-slot" data-fz-bloc="horssaison"></div>
        ${fzhLinesHTML()}
        ${liveGames.length ? `<section class="fzh-scores fzh-panel">${fzhHeading('zap', 'Matchs en direct', '<a class="fzh-link" href="calendrier.html">Calendrier complet <span aria-hidden="true">→</span></a>')}<div class="fzh-score-track">${fzhGamesHTML(liveGames)}</div></section>` : ''}
        ${started ? '<section class="fzh-picks fzh-panel" id="fzhPicks" aria-labelledby="fzhPicksTitle">' + fzhHeading('users', '<span id="fzhPicksTitle">Sélections</span>') + '<div class="fzh-picks-tabs" role="group" aria-label="Équipes du pool"></div><div class="fzh-picks-body" aria-live="polite"></div></section>' : ''}
        <div class="fzh-slot" data-fz-bloc="mouvements"></div>
        <div class="fzh-slot" data-fz-bloc="surveiller"></div>
        <section class="fzh-news fzh-panel" id="fzhNews" aria-label="Actualités LNH"><div class="fzh-news-copy"><span class="fzh-news-badge">LNH</span><h2>Le hockey n’attend pas.</h2><p>Préparez votre prochain choix.</p><small>Chargement des actualités…</small></div></section>`;
    fzhHeroBrancher(root);
    fzhHeroRendre(root, { poolData, poolName: activeName, teamName: team.name });
    // Les panneaux partagés arrivent d'index.html : on les met en place avant
    // de les remplir (voir fzdPlaceCalendar, accueil-dash.js). Le calendrier
    // n'a pas d'emplacement ici — rien ne se joue avant la fin du repêchage —
    // et reste donc masqué à sa place d'origine.
    fzdPlaceCalendar();
    if (started) fzhRenderPicks(root, poolData, team.name);
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

/* ---- Alignement ----
   Un joueur vaut aussi par sa place dans son club : au premier trio et à la
   première vague de l'avantage numérique, il récolte plus de points qu'au
   quatrième trio. La carte montre d'un coup d'œil ce qu'est un alignement
   (trio, paire, gardien) et mène à ceux des 32 clubs, dans l'onglet
   « Alignements » de stats.html. Le schéma est décoratif : le texte dit la
   même chose aux lecteurs d'écran. */
const FZH_LINES_URL = 'stats.html?onglet=alignements';

const FZH_LINES_ROWS = [{ label: '1er trio', slots: ['AG', 'C', 'AD'] }, { label: '1re paire', slots: ['D', 'D'] }, { label: 'Gardien', slots: ['G'] }];

function fzhLinesHTML() {
    const rows = FZH_LINES_ROWS.map(r => `<span class="fzh-lines-row">${r.slots.map(s => `<i>${s}</i>`).join('')}</span>`).join('');
    const legend = FZH_LINES_ROWS.map(r => `<li>${r.label}</li>`).join('');
    return `<section class="fzh-lines fzh-panel" aria-labelledby="fzhLinesTitle">
            <div class="fzh-lines-copy"><p class="fzh-eyebrow">Alignement</p><h2 id="fzhLinesTitle">Qui joue avec qui ?</h2><p class="fzh-lines-text">Trios, paires et unités spéciales des 32 clubs de la LNH.</p></div>
            <div class="fzh-lines-visual" aria-hidden="true"><div class="fzh-lines-rink">${rows}</div><ul class="fzh-lines-legend">${legend}</ul></div>
            <a class="fzh-lines-cta" href="${FZH_LINES_URL}">Voir les alignements ${fzhIcon('arrow-right', 18)}</a>
        </section>`;
}

/* ---- Sélections ----
   Ce que les autres ont pris décide souvent du prochain choix : une pastille
   par équipe du pool, et les sélections de celle qu'on choisit en dessous,
   catégorie par catégorie. Même lecture que le rail de la salle de
   repêchage (draftDesk.js), sans les places vides. */
let fzhPicksTeam = null;

const FZH_POSITIONS = { C: 'C', L: 'AG', R: 'AD', D: 'D', G: 'G' };

/** Les équipes qui repêchent, dans l'ordre du premier tour. */
function fzhPicksTeams(poolData) {
    const teams = poolData.teams || {};
    const names = [...new Set(poolData.draftOrder || [])];
    Object.entries(teams).forEach(([name, t]) => {
        if (!names.includes(name) && (t?.members || []).length) names.push(name);
    });
    return names.filter(name => teams[name]);
}

/** Les catégories d'une équipe, chacune avec la limite fixée par le pool. */
function fzhPicksGroups(teamData, config, benchMax) {
    const td = teamData || {};
    const cfg = config || {};
    return [
        { label: 'Attaquants', names: td.offensive, max: cfg.numOffensive },
        { label: 'Défenseurs', names: td.defensive, max: cfg.numDefensive },
        { label: 'Gardiens', names: td.goalie, max: cfg.numGoalies },
        { label: 'Recrues', names: td.rookie, max: cfg.numRookies },
        { label: 'Équipes LNH', names: td.teams, max: cfg.numTeams, club: true },
        // Le banc du tête-à-tête garde parfois des fiches, pas des noms.
        { label: 'Banc', names: (td.bench || []).map(b => (typeof b === 'string' ? b : b?.nom)), max: benchMax }
    ].map(g => ({ ...g, names: (g.names || []).filter(Boolean), max: Number(g.max) || 0 }))
     .filter(g => g.max > 0 || g.names.length);
}

function fzhClubAbbrev(name) {
    const fiches = (userData.teamsData && userData.teamsData.teams) || [];
    return fiches.find(t => t.teamFullName === name)?.teamAbbrev || '';
}

function fzhPicksPlayerHTML(name, club) {
    if (club) {
        return `<li class="fzh-picks-player is-club">${offPlayerFaceHTML(name, fzhClubAbbrev(name))}<span><strong>${escapeHTML(name)}</strong></span></li>`;
    }
    const stats = getPlayerStats(name);
    const meta = [stats?.teamAbbrev, FZH_POSITIONS[stats?.position]].filter(Boolean).join(' · ');
    return `<li class="fzh-picks-player">${offPlayerFaceHTML(name, stats?.teamAbbrev)}<span><strong>${escapeHTML(name)}</strong>${meta ? `<small>${escapeHTML(meta)}</small>` : ''}</span></li>`;
}

function fzhPicksBodyHTML(groups) {
    if (!groups.some(g => g.names.length)) return '<p class="fzh-empty">Aucun choix pour l’instant.</p>';
    return groups.map(g => {
        const count = g.max ? `${g.names.length} / ${g.max}` : g.names.length;
        const players = g.names.length
            ? `<ul class="fzh-picks-players">${g.names.map(name => fzhPicksPlayerHTML(name, g.club)).join('')}</ul>`
            : '<p class="fzh-picks-none">Aucun choix</p>';
        return `<div class="fzh-picks-group"><p class="fzh-picks-label">${g.label}<span>${count}</span></p>${players}</div>`;
    }).join('');
}

function fzhPicksTabHTML(name, i, state) {
    const { pressed, mine, onClock } = state;
    const label = [name + (mine ? ' (vous)' : ''), onClock ? 'au choix' : ''].filter(Boolean).join(', ');
    return `<button type="button" class="fzh-picks-tab${onClock ? ' is-on-clock' : ''}" data-fzh-pick="${i}" aria-pressed="${pressed}" aria-label="${escapeHTML(label)}">${onClock ? '<i aria-hidden="true"></i>' : ''}<span>${escapeHTML(name)}</span>${mine ? '<b aria-hidden="true">Toi</b>' : ''}</button>`;
}

function fzhRenderPicks(root, poolData, myTeam) {
    const panel = root.querySelector('#fzhPicks');
    if (!panel) return;
    const teams = fzhPicksTeams(poolData);
    if (!teams.length) { panel.remove(); return; }
    // Le choix survit aux rafraîchissements (un par choix repêché), pas à un
    // changement de pool où l'équipe vue n'existe plus.
    if (!teams.includes(fzhPicksTeam)) fzhPicksTeam = teams.includes(myTeam) ? myTeam : teams[0];
    const onClock = (poolData.draftOrder || [])[poolData.currentPickIndex || 0];
    const benchMax = typeof window.fzQuotaBanc === 'function' ? window.fzQuotaBanc(poolData) : 0;
    const tabs = panel.querySelector('.fzh-picks-tabs');
    const body = panel.querySelector('.fzh-picks-body');
    const show = () => {
        body.innerHTML = fzhPicksBodyHTML(fzhPicksGroups(poolData.teams[fzhPicksTeam], poolData.config, benchMax));
    };
    tabs.innerHTML = teams.map((name, i) => fzhPicksTabHTML(name, i, {
        pressed: name === fzhPicksTeam, mine: name === myTeam, onClock: name === onClock
    })).join('');
    tabs.querySelectorAll('[data-fzh-pick]').forEach(button => button.addEventListener('click', () => {
        fzhPicksTeam = teams[Number(button.dataset.fzhPick)];
        tabs.querySelectorAll('[data-fzh-pick]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
        show();
    }));
    show();
    // La rangée défile de côté au téléphone : l'équipe vue doit y rester en
    // vue après un rafraîchissement. Pas de scrollIntoView, qui ferait aussi
    // défiler la page.
    const active = tabs.querySelector('[aria-pressed="true"]');
    if (active && active.offsetLeft + active.offsetWidth > tabs.clientWidth) tabs.scrollLeft = active.offsetLeft - 16;
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
