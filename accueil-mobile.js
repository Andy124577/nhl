/* ============================================================ */
/* ACCUEIL MOBILE HOME — téléphone uniquement (≤768px, accueil-   */
/* mobile.css force le display). Remplace le calendrier/hors-     */
/* saison/corps du dashboard bureau par un écran à 4 modes réels : */
/*   - repêchage en cours (encours)                                */
/*   - avant-saison (saison régulière pas commencée)               */
/*   - match en direct (un de mes joueurs joue en ce moment)       */
/*   - saison régulière (par défaut)                               */
/* Chargé après accueil.js/accueil-dash.js/activePool.js : classic */
/* scripts, même portée globale (voir l'en-tête d'accueil-dash.js) */
/* — réutilise FZPool, userData, calData, escapeHTML, buildTeamScores, */
/* activeRosterNames, rosterTeamCounts, teamLogoImg, gameTimeLabel, */
/* periodLabel, todayISO, relativeTimeFr, fetchNhlNews tels quels.  */
/* Appelé depuis renderDash() (accueil-dash.js), qui lui passe les  */
/* mêmes tonight-boxscores/rank-movement déjà chargés pour le panneau */
/* bureau — jamais un second aller-retour réseau pour la même donnée. */
/* ============================================================ */

function frOrdinal(n) {
    return n === 1 ? '1er' : `${n}e`;
}

function fzmElapsedClock(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function fzmDraftHeroHTML(state) {
    const order = state.poolData.draftOrder || [];
    const teams = new Set(order).size || 1;
    const round = Math.floor(state.pick / teams) + 1;
    const rounds = Math.max(round, Math.ceil(order.length / teams));
    const next = order.indexOf(state.team.name, state.pick);
    const headline = state.myTurn ? 'C’est votre tour'
        : next >= 0 ? `Votre tour dans ${next - state.pick} choix` : 'Repêchage en cours';
    const started = Number(state.poolData.turnStartedAt) || 0;
    const portrait = fzdHeadshotByName('Mark Scheifele');
    return `
        ${portrait ? `<img class="fzm-draft-portrait" src="${escapeHTML(portrait)}" alt="" onerror="this.remove()">` : ''}
        <div class="fzm-draft-content">
            <div class="fzm-draft-badge"><span aria-hidden="true"></span>Repêchage en cours</div>
            <h2 class="fzm-draft-title">${escapeHTML(headline)}</h2>
            <div class="fzm-draft-stats">
                <div><span>Ronde</span><strong>${round} / ${rounds}</strong></div>
                <div><span>Choix global</span><strong>${state.pick + 1}</strong></div>
            </div>
            <div class="fzm-draft-clock"><span>Temps écoulé</span><strong class="fzd-hero-elapsed">${started ? fzmElapsedClock(Date.now() - started) : '—'}</strong></div>
            <a class="fzm-draft-cta" href="draftActif.html?pool=${encodeURIComponent(state.activeName)}">Aller au repêchage <span aria-hidden="true">→</span></a>
        </div>`;
}

// Avant-saison : décompte en trois cases (jours, heures, minutes) et une seule
// action pleine largeur. Même état que la bannière bureau (fzdHeroState) —
// seul le balisage change, comme fzmDraftHeroHTML pour le repêchage.
function fzmPreseasonHeroHTML(state) {
    const fait = state.draftDone && state.activeName && state.teamName;
    const eyebrow = fait ? 'Repêchage terminé'
        : state.beforeCamp ? 'Avant le camp d’entraînement' : 'Avant le début de la saison';
    const diff = Math.max(0, new Date(state.target + 'T00:00:00Z').getTime() - Date.now());
    const units = [
        ['Jours', Math.floor(diff / 86400000)],
        ['Heures', String(Math.floor((diff % 86400000) / 3600000)).padStart(2, '0')],
        ['Min', String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0')]
    ];
    const cta = fait ? `
        <div class="fzm-pre-ctas">
            <button type="button" class="fzm-pre-cta" data-fzd-recap>Mes joueurs repêchés <span aria-hidden="true">→</span></button>
            <a class="fzm-pre-cta is-ghost" href="classement.html?pool=${encodeURIComponent(state.activeName)}">Classement</a>
        </div>`
        : `<button type="button" class="fzm-pre-cta" data-fz-reglages="equipes">Gérer mon équipe <span aria-hidden="true">→</span></button>`;
    return `
        <div class="fzm-pre-eyebrow">${eyebrow}</div>
        <h2 class="fzm-pre-title">${fait ? 'Votre équipe est au complet' : 'Saison en préparation'}</h2>
        <p class="fzm-pre-sub">${fait ? 'Vos choix sont faits. Place au début de la saison !' : 'La saison approche. Finalisez votre formation !'}</p>
        <div class="fzm-pre-countdown">${units.map(([lbl, val], i) => `
            <div class="fzm-pre-unit${i === units.length - 1 ? ' is-accent' : ''}"><strong>${val}</strong><span>${lbl}</span></div>`).join('')}
        </div>
        ${cta}`;
}

// Actualités avant-saison : cartes issues du même flux que l'accueil bureau.
async function fzmLoadNewsHero() {
    const slot = document.getElementById('fzmNewsHero');
    if (!slot) return;
    const articles = (await fetchNhlNews()).slice(0, 3);
    if (!slot.isConnected || !articles.length) return;
    slot.innerHTML = `<div class="fzm-news-hero-track">${articles.map(a => `
        <a class="fzm-news-hero-card" href="${escapeHTML(a.url)}" target="_blank" rel="noopener noreferrer">
            ${a.image ? `<img src="${escapeHTML(a.image)}" alt="" onerror="this.remove()">` : ''}
            <div class="fzm-news-hero-copy"><span>Actualités</span><h2>${escapeHTML(a.title)}</h2><small>${escapeHTML(a.source || 'LNH')}</small></div>
            <b aria-hidden="true">↗</b>
        </a>`).join('')}</div>
        ${articles.length > 1 ? `<div class="fzm-news-hero-dots">${articles.map((_, i) => `<button type="button" aria-label="Actualité ${i + 1}" aria-pressed="${i === 0}"></button>`).join('')}</div>` : ''}`;
    const track = slot.querySelector('.fzm-news-hero-track');
    const dots = [...slot.querySelectorAll('.fzm-news-hero-dots button')];
    dots.forEach((dot, i) => dot.addEventListener('click', () => track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' })));
    track.addEventListener('scroll', () => {
        const index = Math.round(track.scrollLeft / track.clientWidth);
        dots.forEach((dot, i) => dot.setAttribute('aria-pressed', String(i === index)));
    }, { passive: true });
}

// ============================================================
// HÉROS — rendu par renderHero() (accueil-dash.js), même fonction
// et même contenu que la bannière bureau : voir fzdHeroState/
// fzdHeroHTML. renderMobileHome() lui réserve un conteneur
// (#fzmHeroSlot) plutôt que de reconstruire son propre balisage,
// pour que téléphone et bureau ne puissent jamais diverger.
//
// Le repêchage reste accessible depuis la bannière d'état.
// ============================================================

// Une case de la barre par gérant attendu : on voit d'un coup d'œil combien
// de places restent à pourvoir avant de pouvoir repêcher.
function fzmPreseasonExtras(draftState, activeName) {
    let html = '';
    if (draftState.etat === 'attente' || draftState.etat === 'pret') {
        const ready = draftState.etat === 'pret';
        const max = Math.max(1, draftState.max);
        const inscrits = Math.min(draftState.inscrits, max);
        const segments = Array.from({ length: max }, (_, i) => `<span${i < inscrits ? ' class="is-on"' : ''}></span>`).join('');
        const action = ready
            ? `<a class="fzm-wait-btn is-primary" href="repechage.html?pool=${encodeURIComponent(activeName)}">Démarrer</a>`
            : `<button type="button" class="fzm-wait-btn" data-fzm-inviter="${escapeHTML(activeName)}"><span aria-live="polite">Inviter</span></button>`;
        html += `
            <div class="fzm-wait">
                <div class="fzm-wait-main">
                    <div class="fzm-wait-head">
                        <span class="fzm-wait-title">${ready ? 'Prêt à repêcher' : 'En attente de joueurs'}</span>
                        <span class="fzm-wait-count"><strong>${draftState.inscrits}</strong>/${draftState.max} gérants inscrits</span>
                    </div>
                    <div class="fzm-wait-bar" aria-hidden="true">${segments}</div>
                </div>
                ${action}
            </div>`;
    }

    // « À surveiller » : l'emplacement du panneau partagé (accueil-watch.js),
    // le même ici qu'au repêchage, en saison et au tableau de bord.
    html += '<div class="fzm-slot" data-fz-bloc="surveiller"></div>';
    return html;
}

// ============================================================
// CLASSEMENT — même base que renderMyPoolsList (buildTeamScores),
// mouvement de rang réel via /pool-rank-movement (partagé avec le
// panneau bureau, voir loadDashData dans accueil-dash.js).
// ============================================================
function fzmRankStrip(activeName, movement) {
    const pool = (userData.userPools || []).find(p => p.name === activeName);
    if (!pool) return '';
    const scores = buildTeamScores(pool);
    const claimed = scores.filter(t => t.memberCount > 0);
    const list = claimed.length ? claimed : scores;
    const idx = list.findIndex(t => t.isCurrentUser);
    if (idx < 0) return '';
    const mine = list[idx];

    let gapHTML = '';
    if (list.length > 1) {
        if (idx < list.length - 1) {
            const gap = Math.round(mine.score - list[idx + 1].score);
            gapHTML = `+${gap} pt${gap > 1 ? 's' : ''} sur le ${frOrdinal(idx + 2)}`;
        } else {
            const gap = Math.round(list[0].score - mine.score);
            gapHTML = `-${gap} pt${gap > 1 ? 's' : ''} vs le 1er`;
        }
    }

    let trendHTML = '—';
    const teamRow = movement?.teams?.find(t => t.teamName === mine.teamName);
    if (teamRow && movement.hasSnapshot && teamRow.rankToday != null && teamRow.rankToday !== teamRow.rankNow) {
        const moved = teamRow.rankToday - teamRow.rankNow; // positive = moved up
        trendHTML = `${moved > 0 ? '▲' : '▼'} ${Math.abs(moved)} place${Math.abs(moved) > 1 ? 's' : ''}`;
    }
    const trendCls = trendHTML.startsWith('▲') ? ' is-up' : trendHTML.startsWith('▼') ? ' is-down' : '';

    return `
        <div class="fzm-rank-strip">
            <div>
                <div class="fzm-rank-eyebrow">Mon classement</div>
                <div class="fzm-rank-pos-row">
                    <span class="fzm-rank-pos">${frOrdinal(idx + 1)}</span>
                    <span class="fzm-rank-pts">${Math.round(mine.score)} pts</span>
                </div>
            </div>
            <div class="fzm-rank-side">
                <div class="fzm-rank-trend${trendCls}">${trendHTML}</div>
                <div class="fzm-rank-gap">${gapHTML}</div>
            </div>
        </div>`;
}

// ============================================================
// MATCHS DU JOUR — plus de bande « aujourd'hui seulement » propre au
// téléphone : renderMobileHome pose son emplacement et fzdPlaceCalendar()
// (accueil-dash.js) y déplace le calendrier complet, qui montre les
// mêmes matchs du jour PLUS la semaine, avec le carrousel de vos
// joueurs sous chaque carte (maquette Canvas-12, 1C/1D).
// ============================================================

// ============================================================
// MES JOUEURS CE SOIR — croise mon effectif (activeRosterNames) et
// les matchs du jour (calData) pour couvrir aussi les joueurs pas
// encore commencés (tonight-boxscores les omet, il ne suit que les
// matchs déjà débutés) ; les lignes live/final viennent de
// tonight.players, déjà chargé par loadDashData.
// ============================================================
function fzmPlayersRow(tonight, rosterNames) {
    const day = calData?.days?.find(d => d.date === todayISO());
    const todaysGames = (day && day.games) || [];
    if (!todaysGames.length) return '';

    const gameByAbbrev = {};
    todaysGames.forEach(g => { gameByAbbrev[g.away.abbrev] = g; gameByAbbrev[g.home.abbrev] = g; });

    const tonightByName = {};
    (tonight.players || []).forEach(p => { tonightByName[p.playerName] = p; });

    const tiles = [];
    rosterNames.forEach(name => {
        const info = getPlayerStats(name);
        const abbrev = info?.teamAbbrev;
        if (!abbrev) return;
        const game = gameByAbbrev[abbrev];
        if (!game) return;

        const live = tonightByName[name];
        const meta = info?.position && info.position !== 'N/A' ? `${abbrev} · ${info.position}` : abbrev;

        if (live) {
            const isLiveGame = game.state === 'LIVE' || game.state === 'CRIT';
            const pts = live.fantasyPointsTonight || 0;
            tiles.push({
                name, meta,
                tag: isLiveGame ? 'DIRECT' : 'FINAL',
                tagClass: isLiveGame ? 'is-live' : 'is-final',
                line: `${pts > 0 ? '+' : ''}${pts} pt${Math.abs(pts) > 1 ? 's' : ''}`,
                sortKey: isLiveGame ? 2 : 1,
                pts
            });
        } else if (game.state === 'FUT' || game.state === 'PRE') {
            tiles.push({
                name, meta,
                tag: gameTimeLabel(game.startTimeUTC),
                tagClass: 'is-upcoming',
                line: `${gameTimeLabel(game.startTimeUTC)} vs ${game.away.abbrev === abbrev ? game.home.abbrev : game.away.abbrev}`,
                sortKey: 0,
                pts: 0
            });
        }
    });

    if (!tiles.length) return '';
    tiles.sort((a, b) => b.sortKey - a.sortKey || b.pts - a.pts);

    return `
        <div class="fzm-section" id="fzmPlayers">
            <div class="fzm-section-head"><h2 class="fzm-section-title">Mes joueurs ce soir</h2><button type="button" class="fzm-see-all" data-fz-reglages="equipes">Mes joueurs ›</button></div>
            <div class="fzm-scroll-row">
                ${tiles.map(fzmPlayerTile).join('')}
            </div>
        </div>`;
}

function fzmPlayerTile(t) {
    return `
        <div class="fzm-player-card">
            ${offPlayerFaceHTML(t.name, getPlayerStats(t.name)?.teamAbbrev)}
            <div class="fzm-player-name">${escapeHTML(t.name)}</div>
            <div class="fzm-player-meta">${escapeHTML(t.meta)}</div>
            <span class="fzm-player-tag ${t.tagClass}">${escapeHTML(t.tag)}</span>
            <div class="fzm-player-line">${escapeHTML(t.line)}</div>
        </div>`;
}

// ============================================================
// ACTIVITÉ DE LA LIGUE — mêmes échanges complétés que
// renderActivityFeed (accueil-dash.js), mais avec un "Voir tout"
// repliable (3 par défaut) comme la maquette, plutôt qu'une liste
// bureau figée à 8.
// ============================================================
let fzmActivityFull = [];
let fzmActivityExpanded = false;

async function fzmLoadActivity(activeName) {
    try {
        const res = await fetch(`${BASE_URL}/trades/${encodeURIComponent(activeName)}`, { cache: 'no-store' });
        fzmActivityFull = res.ok ? await res.json() : [];
    } catch (err) {
        console.warn('Could not load mobile activity feed:', err);
        fzmActivityFull = [];
    }
    fzmActivityExpanded = false;
    fzmRenderActivity();
}

function fzmRenderActivity() {
    const wrap = document.getElementById('fzmActivityWrap');
    if (!wrap) return;
    if (!fzmActivityFull.length) {
        wrap.innerHTML = `<p class="fzm-empty">Aucun échange complété dans ce pool.</p>`;
        return;
    }
    const visible = fzmActivityExpanded ? fzmActivityFull.slice(0, 8) : fzmActivityFull.slice(0, 3);
    wrap.innerHTML = `
        <div class="fzm-list-card">${visible.map(fzmActivityRowHTML).join('')}</div>
        ${fzmActivityFull.length > 3 ? `<button type="button" class="fzm-toggle-btn" id="fzmActivityToggle">${fzmActivityExpanded ? 'Réduire' : 'Voir tout'}</button>` : ''}`;
    document.getElementById('fzmActivityToggle')?.addEventListener('click', () => {
        fzmActivityExpanded = !fzmActivityExpanded;
        fzmRenderActivity();
    });
}

function fzmActivityRowHTML(trade) {
    const offering = trade.offering && trade.offering[0];
    const receiving = trade.receiving && trade.receiving[0];
    const dateRaw = trade.completedDate || trade.date;
    const timeLabel = dateRaw ? relativeTimeFr(dateRaw) : '';
    const text = offering && receiving
        ? `Échange complété : <strong>${escapeHTML(offering.name)}</strong> ↔ <strong>${escapeHTML(receiving.name)}</strong> (${escapeHTML(trade.fromTeam)} ⇄ ${escapeHTML(trade.toTeam)}).`
        : `Échange complété entre <strong>${escapeHTML(trade.fromTeam)}</strong> et <strong>${escapeHTML(trade.toTeam)}</strong>.`;
    return `<div class="fzm-list-row fzm-activity-row"><div class="fzm-activity-time">${timeLabel}</div><div class="fzm-activity-text">${text}</div></div>`;
}

// ============================================================
// MOUVEMENTS RÉCENTS — le carrousel est désormais celui du tableau de bord
// (#fzdOffMoves, fzd-off-carousel), déplacé ici par fzdPlaceCalendar()
// comme le calendrier : un seul balisage et un seul rendu pour les quatre
// accueils. Voir renderOffseasonLeague / fzdRendreMouvements, accueil-dash.js.
// ============================================================

// ============================================================
// ACTUALITÉS LNH — même flux NewsAPI que le carrousel d'accueil et
// le panneau hors-saison (fetchNhlNews, accueil.js).
// ============================================================
async function fzmLoadNews() {
    const wrap = document.getElementById('fzmNewsWrap');
    if (!wrap) return;
    const articles = await fetchNhlNews();
    if (!articles.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = articles.slice(0, 2).map(a => `
        <a class="fzm-news-card" href="${escapeHTML(a.url)}" target="_blank" rel="noopener">
            <div class="fzm-news-kicker">${escapeHTML(a.source || 'Actualité')}</div>
            <div class="fzm-news-headline">${escapeHTML(a.title)}</div>
        </a>`).join('');
}

// « Inviter » : le lien de la page Rejoindre, déjà filtrée sur ce pool
// (?q=, lu par equipes.js). La feuille de partage du téléphone quand il en a
// une, sinon le presse-papiers.
async function fzmInviter(bouton) {
    const nom = bouton.dataset.fzmInviter;
    const url = new URL(`rejoindre-pool.html?q=${encodeURIComponent(nom)}`, location.href).href;
    if (navigator.share) {
        try {
            await navigator.share({ title: 'Fantazy', text: `Rejoins mon pool « ${nom} » sur Fantazy !`, url });
            return;
        } catch (err) {
            if (err.name === 'AbortError') return;
        }
    }
    const label = bouton.querySelector('span');
    try {
        await navigator.clipboard.writeText(url);
        label.textContent = 'Lien copié';
    } catch (err) {
        label.textContent = 'Copie impossible';
    }
    clearTimeout(bouton._fzmReset);
    bouton._fzmReset = setTimeout(() => { label.textContent = 'Inviter'; }, 2200);
}

function fzmIcon(paths) {
    return `<span class="fzm-poolchip-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg></span>`;
}

// Les trois raccourcis restent accessibles sous la bannière dans chaque état.
function fzmPoolChips() {
    return `
        <div class="fzm-poolchips">
            <button type="button" class="fzm-poolchip" data-fz-pools>${fzmIcon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>')}<span>Mes pools</span></button>
            <a class="fzm-poolchip" href="creer-pool.html">${fzmIcon('<path d="M12 5v14M5 12h14"/>')}<span>Créer un pool</span></a>
            <a class="fzm-poolchip" href="rejoindre-pool.html">${fzmIcon('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5M15 12H3"/>')}<span>Rejoindre un pool</span></a>
        </div>`;
}

// ============================================================
// ORCHESTRATION — appelé depuis renderDash() (accueil-dash.js)
// avec les tonight-boxscores/rank-movement déjà chargés.
// ============================================================
function renderMobileHome(tonight, movement, activeName) {
    const root = document.getElementById('fzMobileHome');
    if (!root) return;

    // Le calendrier, les mouvements récents et « À surveiller » sont des nœuds
    // PARTAGÉS avec les autres accueils, que fzdPlaceCalendar() déplace dans
    // les emplacements posés plus bas. Il faut les sortir d'ici avant toute
    // réécriture de root.innerHTML, sinon on les effacerait pour de bon.
    fzdRestoreCalendar();

    const poolData = FZPool.data();
    const team = FZPool.team();
    if (!activeName || !poolData || !team) { root.innerHTML = ''; fzdStopHeroTimer('fzmHeroSlot'); return; }

    const draftState = FZPool.draftState(poolData);
    // Même détection d'état que la bannière bureau (fzdHeroState,
    // accueil-dash.js) : un seul calcul, jamais deux réponses différentes
    // pour la même situation.
    const heroState = fzdHeroState(tonight);
    const mode = heroState ? heroState.mode : 'regular';
    const isDraft = mode === 'draft';
    const isPreseason = mode === 'preseason';
    const isLive = mode === 'live';
    // 'draftdone' ne change que la bannière : le corps de l'écran reste celui
    // de la saison régulière. Sans ce rattachement, terminer son repêchage
    // ferait disparaître le classement, les matchs et les joueurs du soir.
    const isRegular = mode === 'regular' || mode === 'draftdone';

    const rosterNames = new Set(activeRosterNames());

    // La bannière elle-même vient de renderHero() (accueil-dash.js), qui la
    // rend dans ce conteneur une fois root.innerHTML posé plus bas — même
    // contenu, même minuteur, que la version bureau.
    root.dataset.mode = mode;
    // La bande « à faire maintenant » n'est plus ici : elle vit dans le
    // panneau de notifications (notifications.js), avec le reste de ce qui
    // réclame une action.
    let html = isPreseason ? '<div class="fzm-news-hero" id="fzmNewsHero"></div>' : '';
    html += '<div class="fz-dash-hero" id="fzmHeroSlot" style="display:none;"></div>';
    html += fzmPoolChips();
    if (isPreseason) html += fzmPreseasonExtras(draftState, activeName);

    if (isRegular || isLive) html += fzmRankStrip(activeName, movement);

    // Le calendrier est posé dans TOUS les modes : c'est le seul endroit d'où
    // il est visible au téléphone (accueil-mobile.css masque celui resté à sa
    // place bureau), et un repêchage ou l'avant-saison sont justement les
    // moments où l'on veut voir arriver le calendrier de la LNH. En saison
    // régulière il remplace en plus l'ancienne bande « En direct et à venir ».
    html += '<div class="fzm-slot" data-fz-bloc="calendrier"></div>';

    // Avant-saison : les actualités sont déjà en tête de page.
    const seasonStarted = fzdSeasonStarted() !== false;
    const showActivity = isRegular || isLive;
    if (showActivity) {
        html += `<div class="fzm-section"><div class="fzm-section-title">Activité de la ligue</div><div id="fzmActivityWrap"></div></div>`;
    }

    // « Mouvements récents » : le carrousel partagé (fzd-off-carousel), suivi
    // des actualités, qui vivaient jusqu'ici dans le même bloc.
    html += '<div class="fzm-slot" data-fz-bloc="mouvements"></div>';
    if (seasonStarted && !isDraft) html += '<div class="fzm-news-list" id="fzmNewsWrap"></div>';
    if (isRegular || isLive || isDraft) html += fzmPlayersRow(tonight, rosterNames);

    root.innerHTML = html;

    // Replacer le calendrier sauvegardé dans le nouveau conteneur mobile.
    fzdPlaceCalendar();
    if (calData) renderCalendar();

    renderHero(tonight, 'fzmHeroSlot');
    if (isPreseason) fzmLoadNewsHero();
    // La bannière « en direct » pointe vers #fzdPlayersList (id bureau) :
    // sur téléphone la liste vit sous #fzmPlayers, donc on intercepte le
    // même bouton plutôt que de bifurquer le contenu de la bannière.
    root.querySelector('.fzd-hero-cta[href="#fzdPlayersList"]')?.addEventListener('click', e => {
        e.preventDefault();
        document.getElementById('fzmPlayers')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    root.querySelector('[data-fzm-inviter]')?.addEventListener('click', e => fzmInviter(e.currentTarget));
    if (showActivity) fzmLoadActivity(activeName);
    fzdRendreMouvements();
    if (isPreseason) fzdRendreSurveiller();
    if (seasonStarted) fzmLoadNews();
}
