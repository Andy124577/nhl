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

// ============================================================
// HÉROS — rendu par renderHero() (accueil-dash.js), même fonction
// et même contenu que la bannière bureau : voir fzdHeroState/
// fzdHeroHTML. renderMobileHome() lui réserve un conteneur
// (#fzmHeroSlot) plutôt que de reconstruire son propre balisage,
// pour que téléphone et bureau ne puissent jamais diverger.
//
// Le repêchage en cours n'a plus de « Prochains choix » / « Choix
// récents » propres au téléphone : renderMobileHome pose un
// conteneur #fzmDraftBoard et fzdRenderDraftBoard() (accueil-dash.js)
// y rend le même carrousel des choix qu'au bureau.
// ============================================================

function fzmPreseasonExtras(draftState, activeName) {
    let html = '';
    if (draftState.etat === 'attente' || draftState.etat === 'pret') {
        const ready = draftState.etat === 'pret';
        html += `
            <div class="fzm-tile-row">
                <div>
                    <div class="fzm-tile-title">${ready ? 'Prêt à repêcher' : 'En attente de joueurs'}</div>
                    <div class="fzm-tile-sub">${draftState.inscrits}/${draftState.max} gérants inscrits</div>
                </div>
                <a class="fzm-tile-btn" href="repechage.html?pool=${encodeURIComponent(activeName)}">${ready ? 'Démarrer →' : 'Voir →'}</a>
            </div>`;
    }

    // Les « Joueurs à Surveiller » des 32 équipes, dans l'ordre du document
    // (voir OFFSEASON_WATCHLIST, accueil-dash.js). La rangée défile déjà à
    // l'horizontale : les 70 cartes y tiennent sans tronquer la liste.
    html += `
        <div class="fzm-section">
            <div class="fzm-section-title">Joueurs à surveiller</div>
            <div class="fzm-scroll-row">
                ${OFFSEASON_WATCHLIST.length
                    ? OFFSEASON_WATCHLIST.map(w => `
                        <div class="fzm-watch-card">
                            <img class="fzm-watch-logo" src="teams/${escapeHTML(w.team)}.png" alt="" loading="lazy" onerror="this.remove()">
                            <div class="fzm-watch-name">${escapeHTML(w.name)}</div>
                            <div class="fzm-watch-team">${escapeHTML(w.team)}${w.position ? ' · ' + escapeHTML(w.position) : ''}</div>
                            ${w.note ? `<div class="fzm-watch-note">${escapeHTML(w.note)}</div>` : ''}
                        </div>`).join('')
                    : `<p class="fzm-empty">Liste à venir.</p>`}
            </div>
        </div>`;
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
// téléphone : renderMobileHome pose #fzmCalSlot et fzdPlaceCalendar()
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
                line: 'À venir',
                sortKey: 0,
                pts: 0
            });
        }
    });

    if (!tiles.length) return '';
    tiles.sort((a, b) => b.sortKey - a.sortKey || b.pts - a.pts);

    return `
        <div class="fzm-section" id="fzmPlayers">
            <div class="fzm-section-title">Vos joueurs ce soir</div>
            <div class="fzm-scroll-row">
                ${tiles.map(fzmPlayerTile).join('')}
            </div>
        </div>`;
}

function fzmPlayerTile(t) {
    return `
        <div class="fzm-player-card">
            <div class="fzm-player-avatar"></div>
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
// DANS LA LNH — mouvements de joueurs (échanges, signatures) déduits
// des alignements officiels côté serveur (GET /nhl-transactions) et
// blessés du circuit (GET /nhl-injuries), en onglets.
//
// Les actualités NewsAPI restent affichées dessous plutôt que fondues
// dans les onglets : un titre de presse raconte le contexte (le montant,
// la raison) qu'une comparaison d'alignements ne donnera jamais, et
// inversement le journal attrape les mouvements discrets dont personne
// n'écrit. Les deux se complètent, aucun ne remplace l'autre.
// ============================================================
const FZM_LEAGUE_TABS = [
    { key: 'all', label: 'Tout' },
    { key: 'trade', label: 'Échanges' },
    { key: 'signing', label: 'Signatures' },
    { key: 'injury', label: 'Blessés' }
];
let fzmLeagueTab = 'all';
let fzmLeagueData = null;

// Carrousel calqué sur celui du bureau (fzd-off-carousel, index.html /
// renderOffseasonLeague, accueil-dash.js) : en-tête avec flèches, onglets
// filtres, piste de cartes qu'on feuillette au doigt, points dessous.
function fzmLeagueSectionHTML(showNews) {
    return `
        <div class="fzm-section" id="fzmLeagueSection">
            <div class="fzm-league-head">
                <div class="fzm-section-title">Dans la LNH</div>
                <div class="fzm-league-nav">
                    <button type="button" class="fzm-league-nav-btn" id="fzmLeaguePrev" aria-label="Mouvements précédents">‹</button>
                    <button type="button" class="fzm-league-nav-btn" id="fzmLeagueNext" aria-label="Mouvements suivants">›</button>
                </div>
            </div>
            <div class="fzm-tabs" id="fzmLeagueTabs">
                ${FZM_LEAGUE_TABS.map(t => `
                    <button type="button" class="fzm-tab${t.key === fzmLeagueTab ? ' is-active' : ''}" data-tab="${t.key}">
                        ${t.label}<span class="fzm-tab-count" data-count="${t.key}"></span>
                    </button>`).join('')}
            </div>
            <div class="fzm-league-track" id="fzmLeagueTrack"><p class="fzm-empty">Chargement…</p></div>
            <div class="fzm-league-dots" id="fzmLeagueDots"></div>
            ${showNews ? '<div class="fzm-news-list" id="fzmNewsWrap"></div>' : ''}
        </div>`;
}

async function fzmLoadLeague() {
    if (!document.getElementById('fzmLeagueTrack')) return;

    // limit=80 : tout le journal tient dedans, donc groupTrades (défini dans
    // accueil-dash.js, chargé avant) voit chaque échange en entier.
    const [tx, inj] = await Promise.all([
        fetch('/nhl-transactions?limit=80').then(r => r.json()).catch(() => null),
        fetch('/nhl-injuries?limit=60').then(r => r.json()).catch(() => null)
    ]);

    const moves = tx?.transactions || [];
    const deals = groupTrades(moves.filter(t => t.type === 'trade'));
    const signings = moves.filter(t => t.type === 'signing');
    const injuries = inj?.injuries || [];

    // « Tout » : les trois flux fondus et retriés du plus récent au plus
    // ancien, chaque entrée gardant sa forme (`kind` dit quelle carte rendre).
    // Même logique que renderOffseasonLeague (accueil-dash.js).
    const stamp = iso => (iso ? new Date(iso).getTime() : 0) || 0;
    const all = [
        ...deals.map(d => ({ kind: 'trade', item: d, ts: stamp(d.date) })),
        ...signings.map(s => ({ kind: 'signing', item: s, ts: stamp(s.date) })),
        ...injuries.map(i => ({ kind: 'injury', item: i, ts: stamp(i.since) }))
    ].sort((a, b) => b.ts - a.ts);

    fzmLeagueData = {
        all,
        trade: deals,
        signing: signings,
        injury: injuries,
        counts: {
            // Échanges : nombre d'opérations regroupées. Signatures/blessés :
            // total serveur. « Tout » : la somme des trois.
            trade: deals.length,
            signing: tx?.counts?.signing || 0,
            injury: inj?.total || 0
        },
        tracking: !!tx?.tracking
    };
    fzmLeagueData.counts.all = fzmLeagueData.counts.trade
        + fzmLeagueData.counts.signing + fzmLeagueData.counts.injury;

    // Ouvrir sur un onglet qui a quelque chose à montrer plutôt que sur
    // un onglet vide un lendemain de journée calme.
    const firstFilled = FZM_LEAGUE_TABS.find(t => fzmLeagueData[t.key].length);
    if (firstFilled && !fzmLeagueData[fzmLeagueTab].length) fzmLeagueTab = firstFilled.key;

    document.querySelectorAll('#fzmLeagueTabs .fzm-tab-count').forEach(el => {
        const n = fzmLeagueData.counts[el.dataset.count];
        el.textContent = n ? ` ${n}` : '';
    });
    document.querySelectorAll('#fzmLeagueTabs .fzm-tab').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.tab === fzmLeagueTab);
        btn.addEventListener('click', () => {
            fzmLeagueTab = btn.dataset.tab;
            document.querySelectorAll('#fzmLeagueTabs .fzm-tab').forEach(b => b.classList.toggle('is-active', b === btn));
            fzmRenderLeagueTab();
        });
    });

    fzmBindLeagueCarousel();
    fzmRenderLeagueTab();
}

// Flèches précédent/suivant + suivi du défilement. Rebranché à chaque rendu
// de l'accueil (renderMobileHome recrée tout le DOM), mais une seule fois
// par rendu : le contenu de la piste change avec l'onglet, pas ses boutons.
function fzmBindLeagueCarousel() {
    const track = document.getElementById('fzmLeagueTrack');
    const prev = document.getElementById('fzmLeaguePrev');
    const next = document.getElementById('fzmLeagueNext');
    if (!track) return;

    const step = () => {
        const card = track.querySelector('.fzm-off-card');
        return card ? card.getBoundingClientRect().width + 10 : track.clientWidth * 0.9;
    };
    prev?.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
    next?.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }));

    let raf = 0;
    track.addEventListener('scroll', () => {
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; fzmUpdateLeagueCarousel(); });
    });
}

function fzmRenderLeagueTab() {
    const track = document.getElementById('fzmLeagueTrack');
    if (!track || !fzmLeagueData) return;

    const rows = fzmLeagueData[fzmLeagueTab] || [];
    if (!rows.length) {
        track.classList.add('is-empty');
        track.innerHTML = `<p class="fzm-empty">${fzmLeagueEmptyText()}</p>`;
        fzmRenderLeagueDots();
        return;
    }

    track.classList.remove('is-empty');
    track.innerHTML = rows.map(row => fzmLeagueTab === 'all'
        ? fzmOffCardHTML(row.kind, row.item)
        : fzmOffCardHTML(fzmLeagueTab, row)).join('');
    track.scrollLeft = 0;
    fzmRenderLeagueDots();
}

// Un point par « page » de défilement (largeur de piste), pas un par carte :
// une centaine de blessés donnerait une centaine de points.
function fzmRenderLeagueDots() {
    const track = document.getElementById('fzmLeagueTrack');
    const dots = document.getElementById('fzmLeagueDots');
    if (!track || !dots) return;

    const pages = track.classList.contains('is-empty')
        ? 0
        : Math.max(1, Math.round(track.scrollWidth / track.clientWidth));
    if (pages < 2) { dots.innerHTML = ''; fzmUpdateLeagueCarousel(); return; }
    dots.innerHTML = Array.from({ length: pages }, (_, i) =>
        `<button type="button" class="fzm-league-dot" data-page="${i}" aria-label="Page ${i + 1}"></button>`).join('');
    dots.querySelectorAll('.fzm-league-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            track.scrollTo({ left: dot.dataset.page * track.clientWidth, behavior: 'smooth' });
        });
    });
    fzmUpdateLeagueCarousel();
}

// Reflète la position de défilement : point actif + flèches grisées aux bouts.
function fzmUpdateLeagueCarousel() {
    const track = document.getElementById('fzmLeagueTrack');
    const dots = document.getElementById('fzmLeagueDots');
    const prev = document.getElementById('fzmLeaguePrev');
    const next = document.getElementById('fzmLeagueNext');
    if (!track) return;

    const max = track.scrollWidth - track.clientWidth - 1;
    if (prev) prev.disabled = track.scrollLeft <= 0;
    if (next) next.disabled = track.scrollLeft >= max;

    if (dots && dots.children.length) {
        const active = Math.round(track.scrollLeft / track.clientWidth);
        [...dots.children].forEach((d, i) => d.classList.toggle('is-active', i === active));
    }
}

function fzmLeagueEmptyText() {
    if (fzmLeagueTab === 'injury') return 'Aucun blessé signalé.';
    // Tant que le serveur n'a pas deux photos d'alignements à comparer, il
    // n'a rien à dire — ce qui n'est pas la même chose qu'une ligue calme.
    if (!fzmLeagueData?.tracking) return 'Le suivi des mouvements démarre à la prochaine mise à jour des alignements.';
    if (fzmLeagueTab === 'trade') return 'Aucun échange récent.';
    if (fzmLeagueTab === 'signing') return 'Aucune signature récente.';
    return 'Aucun mouvement récent.';
}

// Une carte de carrousel selon le type de mouvement. `kind` vient soit de
// l'onglet actif, soit de l'entrée fondue de l'onglet « Tout ». Calquées sur
// offseasonCardHTML (accueil-dash.js), au jeton et à la police près.
function fzmOffCardHTML(kind, item) {
    if (kind === 'trade') return fzmOffDealCardHTML(item);
    if (kind === 'signing') return fzmOffSigningCardHTML(item);
    return fzmOffInjuryCardHTML(item);
}

function fzmOffLogoHTML(abbr) {
    return `<img src="teams/${escapeHTML(abbr || '')}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
}

// Échange : les deux clubs empilés, ce que chacun reçoit dessous, séparés
// par un filet — même lecture qu'au bureau (offDealCardHTML). Le club qui
// reçoit quelque chose passe en tête ; « Rien en retour » finit en bas.
function fzmOffDealCardHTML(d) {
    const colHTML = team => {
        const club = d.names[team] || team;
        const players = d.gets[team] || [];
        const assets = players.length
            ? players.map(p => `<li class="fzm-deal-asset">${escapeHTML(p.name)}${p.pos ? ` <span class="fzm-deal-pos">${escapeHTML(p.pos)}</span>` : ''}</li>`).join('')
            : '<li class="fzm-deal-asset is-empty">Rien en retour</li>';
        return `
            <section class="fzm-deal-col">
                <div class="fzm-deal-head">
                    <span class="fzm-deal-club">
                        <img class="fzm-deal-logo" src="teams/${escapeHTML(team)}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
                        <span class="fzm-deal-club-abbr" title="${escapeHTML(club)}">${escapeHTML(team)}</span>
                    </span>
                    <span class="fzm-deal-acq">Acquiert</span>
                </div>
                <ul class="fzm-deal-assets">${assets}</ul>
            </section>`;
    };
    const [first, second] = [d.teamA, d.teamB]
        .sort((x, y) => (d.gets[y]?.length || 0) - (d.gets[x]?.length || 0));
    return `
        <article class="fzm-off-card is-trade">
            <div class="fzm-off-card-top">
                <span class="fzm-off-tag is-trade">Échange</span>
                <span class="fzm-off-card-date">${dayLabelFr(d.date)}</span>
            </div>
            <div class="fzm-deal-grid">
                ${colHTML(first)}
                ${colHTML(second)}
            </div>
        </article>`;
}

function fzmOffSigningCardHTML(t) {
    const club = [t.toTeamName || t.toTeam || '?', t.pos].filter(Boolean).join(' · ');
    return `
        <article class="fzm-off-card is-signing">
            <div class="fzm-off-card-top">
                <span class="fzm-off-tag is-signing">Signature</span>
                <span class="fzm-off-card-date">${dayLabelFr(t.date)}</span>
            </div>
            <div class="fzm-off-card-name">${escapeHTML(t.playerName)}</div>
            <div class="fzm-off-card-club">
                ${fzmOffLogoHTML(t.toTeam)}
                <span>${escapeHTML(club)}</span>
            </div>
        </article>`;
}

function fzmOffInjuryCardHTML(i) {
    const club = [i.teamName || i.team, i.pos].filter(Boolean).join(' · ');
    const detail = [i.injuryType, i.injuryDetail].filter(Boolean).join(' / ');
    const back = i.returnDate ? dayLabelFr(i.returnDate) : (i.statusFr || '—');
    return `
        <article class="fzm-off-card is-injury">
            <div class="fzm-off-card-top">
                <span class="fzm-off-tag is-injury">Blessé</span>
                <span class="fzm-off-card-date">${dayLabelFr(i.since)}</span>
            </div>
            <div class="fzm-off-card-name">${escapeHTML(i.playerName)}</div>
            <div class="fzm-off-card-club">
                ${fzmOffLogoHTML(i.team)}
                <span>${escapeHTML(club)}</span>
            </div>
            <div class="fzm-off-card-stats">
                <div class="fzm-off-stat">
                    <span class="fzm-off-stat-lbl">Blessure</span>
                    <span class="fzm-off-stat-val" data-status="${escapeHTML(i.status || '')}">${escapeHTML(detail || i.statusFr || '—')}</span>
                </div>
                <div class="fzm-off-stat">
                    <span class="fzm-off-stat-lbl">Retour</span>
                    <span class="fzm-off-stat-val">${escapeHTML(back)}</span>
                </div>
            </div>
        </article>`;
}

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

// Raccourcis pools — avant le début de la saison régulière seulement,
// posés entre le calendrier et le bloc hors-saison (« Dans la LNH »).
// Pendant du #fzDashPoolChips du bureau : mêmes trois portes que le pied
// de page, qui cède alors sa place plutôt que de les répéter deux fois
// sur le même écran.
function fzmPoolChips() {
    return `
        <div class="fzm-poolchips">
            <a class="fzm-poolchip is-primary" href="mes-pools.html">Mes pools</a>
            <a class="fzm-poolchip" href="creer-pool.html">Créer un pool</a>
            <a class="fzm-poolchip" href="rejoindre-pool.html">Rejoindre un pool</a>
        </div>`;
}

function fzmFooterLinks() {
    return `
        <div class="fzm-footer-links">
            <a href="mes-pools.html">Mes pools</a>
            <span>·</span>
            <a href="creer-pool.html">Créer un pool</a>
            <span>·</span>
            <a href="rejoindre-pool.html">Rejoindre un pool</a>
        </div>`;
}

// ============================================================
// ORCHESTRATION — appelé depuis renderDash() (accueil-dash.js)
// avec les tonight-boxscores/rank-movement déjà chargés.
// ============================================================
function renderMobileHome(tonight, movement, activeName) {
    const root = document.getElementById('fzMobileHome');
    if (!root) return;

    // Le calendrier (#fzDashCalendarWrap) est un nœud PARTAGÉ avec le bureau
    // que fzdPlaceCalendar() déplace dans #fzmCalSlot sur téléphone. Il faut
    // le sortir d'ici avant toute réécriture de root.innerHTML, sinon on
    // l'effacerait pour de bon.
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
    let html = '<div class="fz-dash-hero" id="fzmHeroSlot" style="display:none;"></div>';

    if (isRegular || isLive) html += fzmRankStrip(activeName, movement);

    // Le calendrier est posé dans TOUS les modes : c'est le seul endroit d'où
    // il est visible au téléphone (accueil-mobile.css masque celui resté à sa
    // place bureau), et un repêchage ou l'avant-saison sont justement les
    // moments où l'on veut voir arriver le calendrier de la LNH. En saison
    // régulière il remplace en plus l'ancienne bande « En direct et à venir ».
    html += '<div class="fzm-cal-slot" id="fzmCalSlot"></div>';

    // Saison régulière pas encore commencée : mêmes retraits qu'au bureau
    // (fzdApplyPreseasonLayout) — les raccourcis pools prennent la suite du
    // calendrier, et les actualités de presse quittent « Dans la LNH ».
    const seasonStarted = fzdSeasonStarted() !== false;
    if (!seasonStarted) html += fzmPoolChips();

    if (isRegular || isLive) html += fzmPlayersRow(tonight, rosterNames);

    if (isDraft) html += '<div class="fz-dash-draftboard" id="fzmDraftBoard"></div>';
    if (isPreseason) html += fzmPreseasonExtras(draftState, activeName);

    const showActivity = isRegular || isLive || isDraft;
    if (showActivity) {
        html += `<div class="fzm-section"><div class="fzm-section-title">Activité de la ligue</div><div id="fzmActivityWrap"></div></div>`;
    }

    html += fzmLeagueSectionHTML(seasonStarted);
    if (seasonStarted) html += fzmFooterLinks();

    root.innerHTML = html;

    // root.innerHTML vient d'effacer le calendrier s'il était déjà dans le
    // slot : on le re-déplace ici, puis on le redessine — un seul nœud
    // partagé avec le bureau, jamais un second rendu qui diverge.
    fzdPlaceCalendar();
    if (calData) renderCalendar();

    renderHero(tonight, 'fzmHeroSlot');
    if (isDraft) fzdRenderDraftBoard('fzmDraftBoard', poolData, team, activeName);
    // La bannière « en direct » pointe vers #fzdPlayersList (id bureau) :
    // sur téléphone la liste vit sous #fzmPlayers, donc on intercepte le
    // même bouton plutôt que de bifurquer le contenu de la bannière.
    root.querySelector('.fzd-hero-cta[href="#fzdPlayersList"]')?.addEventListener('click', e => {
        e.preventDefault();
        document.getElementById('fzmPlayers')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    if (showActivity) fzmLoadActivity(activeName);
    fzmLoadLeague();
    if (seasonStarted) fzmLoadNews();
}
