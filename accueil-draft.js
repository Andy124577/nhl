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
        <div class="fzh-slot" data-fz-bloc="surveiller"></div>
        ${fzhLinesHTML()}
        ${liveGames.length ? `<section class="fzh-scores fzh-panel">${fzhHeading('zap', 'Matchs en direct', '<a class="fzh-link" href="calendrier.html">Calendrier complet <span aria-hidden="true">→</span></a>')}<div class="fzh-score-track">${fzhGamesHTML(liveGames)}</div></section>` : ''}
        ${started ? '<section class="fzh-picks fzh-panel" id="fzhPicks" aria-labelledby="fzhPicksTitle">' + fzhHeading('users', '<span id="fzhPicksTitle">Sélections</span>') + '<div class="fzh-picks-tabs" role="group" aria-label="Équipes du pool"></div><div class="fzh-picks-body" aria-live="polite"></div></section>' : ''}
        <div class="fzh-slot" data-fz-bloc="horssaison"></div>
        <div class="fzh-slot" data-fz-bloc="mouvements"></div>
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

/* ---- Alignements (maquette « Accueil v2 ») ----
   Un joueur vaut aussi par sa place dans son club : au premier trio et à la
   première vague de l'avantage numérique, il récolte plus de points qu'au
   quatrième trio. La carte mène aux alignements des 32 clubs, dans l'onglet
   « Alignements » de stats.html ; chaque tuile ouvre directement celui de
   son club (?equipe=, statsLineup.js).

   Au survol, les tuiles se soulèvent en arc, de gauche à droite, avec un
   léger décalage par rangée : --arc et --delai sont calculés ici, une fois,
   pour que la feuille de style n'ait qu'à les lire. */
const FZH_LINES_URL = 'stats.html?onglet=alignements';

/** [code, nom, couleur de la tuile, couleur du code] — les couleurs de la maquette. */
const FZH_AL_CLUBS = [
    ['ANA', 'Anaheim Ducks', '#F47A38', '#000'], ['BOS', 'Boston Bruins', '#FFB81C', '#000'],
    ['BUF', 'Buffalo Sabres', '#003087', '#FFB81C'], ['CGY', 'Calgary Flames', '#C8102E', '#F1BE48'],
    ['CAR', 'Caroline Hurricanes', '#CE1126', '#fff'], ['CHI', 'Chicago Blackhawks', '#CF0A2C', '#fff'],
    ['COL', 'Colorado Avalanche', '#6F263D', '#fff'], ['CBJ', 'Columbus Blue Jackets', '#002654', '#fff'],
    ['DAL', 'Dallas Stars', '#006847', '#fff'], ['DET', 'Détroit Red Wings', '#CE1126', '#fff'],
    ['EDM', 'Edmonton Oilers', '#041E42', '#FF7A3D'], ['FLA', 'Floride Panthers', '#C8102E', '#fff'],
    ['LAK', 'Los Angeles Kings', '#111111', '#fff'], ['MIN', 'Minnesota Wild', '#154734', '#DDCBA4'],
    ['MTL', 'Montréal Canadiens', '#AF1E2D', '#fff'], ['NSH', 'Nashville Predators', '#FFB81C', '#041E42'],
    ['NJD', 'New Jersey Devils', '#CE1126', '#000'], ['NYI', 'New York Islanders', '#00539B', '#F47D30'],
    ['NYR', 'New York Rangers', '#0038A8', '#fff'], ['OTT', 'Ottawa Sénateurs', '#C52032', '#fff'],
    ['PHI', 'Philadelphie Flyers', '#F74902', '#000'], ['PIT', 'Pittsburgh Penguins', '#FCB514', '#000'],
    ['SJS', 'San Jose Sharks', '#006D75', '#fff'], ['SEA', 'Seattle Kraken', '#001628', '#99D9D9'],
    ['STL', 'St. Louis Blues', '#002F87', '#FCB514'], ['TBL', 'Tampa Bay Lightning', '#002868', '#fff'],
    ['TOR', 'Toronto Maple Leafs', '#00205B', '#fff'], ['UTA', 'Utah Mammoth', '#71AFE5', '#090909'],
    ['VAN', 'Vancouver Canucks', '#00205B', '#fff'], ['VGK', 'Vegas Golden Knights', '#B4975A', '#333F42'],
    ['WSH', 'Washington Capitals', '#C8102E', '#fff'], ['WPG', 'Winnipeg Jets', '#041E42', '#fff']
];

/** Huit tuiles par rangée : l'arc va de 0 aux bords à 3 px au centre. */
function fzhAlTuileHTML([code, nom, fond, encre], i) {
    const rangee = Math.floor(i / 8), colonne = i % 8;
    // `|| 0` : aux bords, le sinus rend -0, qui s'écrirait « -0px ».
    const arc = Math.round(-300 * Math.sin((colonne / 7) * Math.PI)) / 100 || 0;
    const style = `--fond:${fond};--encre:${encre};--arc:${arc}px;--delai:${(rangee + colonne) * 25}ms`;
    return `<li><a class="fzh-al-club${colonne % 2 === rangee % 2 ? '' : ' is-ombre'}" href="${FZH_LINES_URL}&amp;equipe=${code}" style="${style}" aria-label="Alignement : ${nom}" title="${nom}">${code}</a></li>`;
}

function fzhLinesHTML() {
    return `<section class="fzh-al" aria-labelledby="fzhAlTitre">
            <a class="fzh-al-lien" href="${FZH_LINES_URL}">
                <span class="fzh-al-tete"><span class="fzh-al-sur">32 clubs · LNH</span><h2 id="fzhAlTitre">Alignements</h2></span>
                <span class="fzh-al-fleche" aria-hidden="true">→</span>
            </a>
            <ul class="fzh-al-clubs" aria-label="Alignement d’un club">${FZH_AL_CLUBS.map(fzhAlTuileHTML).join('')}</ul>
            <p class="fzh-al-note">Trios, paires et unités spéciales de chaque équipe</p>
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
