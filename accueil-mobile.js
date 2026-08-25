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

const POSITION_LABEL_FR = { offensive: 'ATT', defensive: 'DÉF', goalie: 'GAR', rookie: 'REC', teams: 'ÉQ' };

function frOrdinal(n) {
    return n === 1 ? '1er' : `${n}e`;
}

// ============================================================
// COMPTE À REBOURS — avant-saison, ticke chaque seconde tant que
// la carte est affichée. Cible le début du camp ou de la saison
// régulière (calData.preSeasonStartDate/regularSeasonStartDate,
// déjà chargés par initCalendar) : aucune donnée inventée, juste
// une précision heures/min/sec calculée sur une date réelle.
// ============================================================
let fzmCountdownTimer = null;

function fzmStopCountdown() {
    if (fzmCountdownTimer) { clearInterval(fzmCountdownTimer); fzmCountdownTimer = null; }
}

function fzmCountdownParts(targetISO) {
    const diff = Math.max(0, new Date(targetISO + 'T00:00:00Z').getTime() - Date.now());
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return [
        { value: String(d), unit: 'jours' },
        { value: String(h).padStart(2, '0'), unit: 'hrs' },
        { value: String(m).padStart(2, '0'), unit: 'min' },
        { value: String(s).padStart(2, '0'), unit: 'sec' },
    ];
}

function fzmCountdownPartsHTML(target) {
    return fzmCountdownParts(target).map(p => `
        <div class="fzm-cd-part">
            <div class="fzm-cd-val">${p.value}</div>
            <div class="fzm-cd-unit">${p.unit}</div>
        </div>`).join('');
}

function fzmStartCountdownTicker() {
    fzmStopCountdown();
    if (!document.getElementById('fzmCountdown')) return;
    fzmCountdownTimer = setInterval(() => {
        const el = document.getElementById('fzmCountdown');
        if (!el) { fzmStopCountdown(); return; }
        el.innerHTML = fzmCountdownPartsHTML(el.dataset.target);
    }, 1000);
}

function fzmPreseasonHero(calDataRef) {
    const today = todayISO();
    const campStart = calDataRef?.preSeasonStartDate;
    const seasonStart = calDataRef?.regularSeasonStartDate;
    const beforeCamp = !!campStart && today < campStart;
    const target = beforeCamp ? campStart : seasonStart;
    if (!target) return '';

    return `
        <div class="fzm-hero fzm-hero-preseason">
            <div class="fzm-hero-eyebrow">${beforeCamp ? "Avant le camp d'entraînement" : 'Avant le début de la saison régulière'}</div>
            <div class="fzm-countdown" id="fzmCountdown" data-target="${target}">
                ${fzmCountdownPartsHTML(target)}
            </div>
        </div>`;
}

// ============================================================
// REPÊCHAGE EN COURS — ronde/choix réels (draftOrder +
// currentPickIndex), temps d'attente réel depuis turnStartedAt
// (pas un minuteur fictif : ce pool n'a pas de pendule à 90s, juste
// un seuil "sauter le tour" après 3 min, voir SKIP_TURN_AFTER_MS
// côté serveur). "Votre tour dans" compte les choix réels avant le
// mien dans draftOrder plutôt qu'un temps inventé.
// ============================================================
function fzmFormatElapsed(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m > 0 ? `${m} min` : `${s} s`;
}

function fzmPicksUntilMyTurn(draftOrder, currentIndex, myTeamName) {
    for (let i = currentIndex; i < draftOrder.length; i++) {
        if (draftOrder[i] === myTeamName) return i - currentIndex;
    }
    return -1;
}

function fzmDraftHero(poolData, draftState, myTeamName, activeName) {
    const draftOrder = Array.isArray(poolData.draftOrder) ? poolData.draftOrder : [];
    const numTeams = new Set(draftOrder).size || 1;
    const idx = poolData.currentPickIndex || 0;
    const round = Math.floor(idx / numTeams) + 1;
    const pickInRound = (idx % numTeams) + 1;
    const onClockTeam = draftOrder[idx] || '—';

    const started = Number(poolData.turnStartedAt) || 0;
    const elapsedLabel = started ? `· en attente depuis ${fzmFormatElapsed(Date.now() - started)}` : '';

    const away = fzmPicksUntilMyTurn(draftOrder, idx, myTeamName);
    let turnBlock = '';
    if (away === 0) {
        turnBlock = `
            <div class="fzm-hero-divider"></div>
            <div class="fzm-draft-turn-lbl">C'est votre tour</div>
            <a class="fzm-hero-btn" href="draftActif.html?pool=${encodeURIComponent(activeName)}">Repêcher →</a>`;
    } else if (away > 0) {
        turnBlock = `
            <div class="fzm-hero-divider"></div>
            <div class="fzm-draft-turn-lbl">Votre tour dans</div>
            <div class="fzm-draft-turn-val">${away} choix</div>`;
    }

    return `
        <div class="fzm-hero fzm-hero-draft">
            <div class="fzm-draft-top">
                <span class="fzm-hero-eyebrow">Ronde ${round} · Choix ${pickInRound}</span>
                <span class="fzm-draft-elapsed">${escapeHTML(elapsedLabel)}</span>
            </div>
            <div class="fzm-draft-onclock-lbl">Au tour de</div>
            <div class="fzm-hero-headline">${escapeHTML(onClockTeam)}${onClockTeam === myTeamName ? ' (vous)' : ''}</div>
            ${turnBlock}
        </div>`;
}

function fzmDraftPicks(poolData, myTeamName) {
    const draftOrder = Array.isArray(poolData.draftOrder) ? poolData.draftOrder : [];
    const numTeams = new Set(draftOrder).size || 1;
    const idx = poolData.currentPickIndex || 0;
    const history = Array.isArray(poolData.picksHistory) ? poolData.picksHistory : [];

    const upcoming = draftOrder.slice(idx, idx + 3).map((teamName, i) => ({
        pickNum: idx + i + 1, teamName, isNow: i === 0
    }));

    const recent = history.slice(-3).reverse().map((entry, i) => {
        const historyIndex = history.length - 1 - i;
        return {
            ...entry,
            round: Math.floor(historyIndex / numTeams) + 1,
            pickInRound: (historyIndex % numTeams) + 1
        };
    });

    let html = '';
    if (upcoming.length) {
        html += `
            <div class="fzm-section">
                <div class="fzm-section-title">Prochains choix</div>
                <div class="fzm-list-card">
                    ${upcoming.map(u => `
                        <div class="fzm-list-row${u.isNow ? ' is-onclock' : ''}${u.teamName === myTeamName ? ' is-mine' : ''}">
                            <span class="fzm-list-left">Choix ${u.pickNum}</span>
                            <span class="fzm-list-right">${escapeHTML(u.teamName)}${u.teamName === myTeamName ? ' (vous)' : ''}</span>
                        </div>`).join('')}
                </div>
            </div>`;
    }
    if (recent.length) {
        html += `
            <div class="fzm-section">
                <div class="fzm-section-title">Choix récents</div>
                <div class="fzm-list-card">
                    ${recent.map(r => `
                        <div class="fzm-list-row fzm-pick-row">
                            <div>
                                <div class="fzm-pick-player">${escapeHTML(r.player)}</div>
                                <div class="fzm-pick-meta">${POSITION_LABEL_FR[r.position] || ''} · repêché par ${escapeHTML(r.team)}</div>
                            </div>
                            <span class="fzm-pick-num">R${r.round} · C${r.pickInRound}</span>
                        </div>`).join('')}
                </div>
            </div>`;
    }
    return html;
}

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

    html += `
        <div class="fzm-section">
            <div class="fzm-section-title">Joueurs à surveiller</div>
            <div class="fzm-scroll-row">
                ${OFFSEASON_WATCHLIST.length
                    ? OFFSEASON_WATCHLIST.map(w => `
                        <div class="fzm-watch-card">
                            <div class="fzm-watch-name">${escapeHTML(w.name)}</div>
                            <div class="fzm-watch-team">${escapeHTML(w.team)}</div>
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
// MATCHS DU JOUR — réutilise calData (déjà chargé par
// initCalendar) plutôt qu'un nouvel appel réseau : mêmes champs
// que gameCardHTML (accueil-dash.js), présentation en carrousel.
// ============================================================
function fzmGamesRow() {
    const day = calData?.days?.find(d => d.date === todayISO());
    const games = (day && day.games) || [];
    if (!games.length) return '';
    const counts = rosterTeamCounts();
    return `
        <div class="fzm-section" id="fzmGames">
            <div class="fzm-section-title">En direct et à venir</div>
            <div class="fzm-scroll-row">
                ${games.slice(0, 6).map(g => fzmGameCard(g, counts)).join('')}
            </div>
        </div>`;
}

function fzmGameCard(game, counts) {
    const isFinal = game.state === 'FINAL' || game.state === 'OFF';
    const isLive = game.state === 'LIVE' || game.state === 'CRIT';
    const isScheduled = !isFinal && !isLive;
    const count = rosterCountForGame(counts, game);

    const statusHTML = isLive
        ? `<span class="fzm-game-live"><span class="fzm-live-dot"></span>${periodLabel(game.period, game.periodType)} ${escapeHTML(game.clock?.timeRemaining || '')}</span>`
        : isFinal
            ? `<span class="fzm-game-final">Final</span>`
            : `<span class="fzm-game-time">${gameTimeLabel(game.startTimeUTC)}</span>`;

    const row = side => `
        <div class="fzm-game-row">
            <span class="fzm-game-team">${escapeHTML(side.abbrev)}</span>
            <span class="fzm-game-score">${isScheduled ? '—' : (side.score ?? 0)}</span>
        </div>`;

    return `
        <div class="fzm-game-card">
            ${statusHTML}
            ${row(game.away)}
            ${row(game.home)}
            <div class="fzm-game-foot">${count > 0 ? `${count} de vos joueurs` : 'Aucun joueur'}</div>
        </div>`;
}

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
    { key: 'trade', label: 'Échanges' },
    { key: 'signing', label: 'Signatures' },
    { key: 'injury', label: 'Blessés' }
];
let fzmLeagueTab = 'trade';
let fzmLeagueData = null;

function fzmLeagueSectionHTML() {
    return `
        <div class="fzm-section" id="fzmLeagueSection">
            <div class="fzm-section-title">Dans la LNH</div>
            <div class="fzm-tabs" id="fzmLeagueTabs">
                ${FZM_LEAGUE_TABS.map(t => `
                    <button type="button" class="fzm-tab${t.key === fzmLeagueTab ? ' is-active' : ''}" data-tab="${t.key}">
                        ${t.label}<span class="fzm-tab-count" data-count="${t.key}"></span>
                    </button>`).join('')}
            </div>
            <div class="fzm-league-list" id="fzmLeagueWrap"><p class="fzm-empty">Chargement…</p></div>
            <div class="fzm-news-list" id="fzmNewsWrap"></div>
        </div>`;
}

async function fzmLoadLeague() {
    const wrap = document.getElementById('fzmLeagueWrap');
    if (!wrap) return;

    const [tx, inj] = await Promise.all([
        fetch('/nhl-transactions?limit=60').then(r => r.json()).catch(() => null),
        fetch('/nhl-injuries?limit=60').then(r => r.json()).catch(() => null)
    ]);

    const moves = tx?.transactions || [];
    fzmLeagueData = {
        trade: moves.filter(t => t.type === 'trade'),
        signing: moves.filter(t => t.type === 'signing'),
        injury: inj?.injuries || [],
        // Les compteurs viennent du serveur : ils portent sur tout le
        // journal, pas sur les 60 lignes rapatriées ici.
        counts: {
            trade: tx?.counts?.trade || 0,
            signing: tx?.counts?.signing || 0,
            injury: inj?.total || 0
        },
        tracking: !!tx?.tracking
    };

    // Ouvrir sur un onglet qui a quelque chose à montrer plutôt que sur
    // « Échanges » vide un lendemain de journée calme.
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

    fzmRenderLeagueTab();
}

function fzmRenderLeagueTab() {
    const wrap = document.getElementById('fzmLeagueWrap');
    if (!wrap || !fzmLeagueData) return;

    const rows = fzmLeagueData[fzmLeagueTab] || [];
    if (!rows.length) {
        wrap.innerHTML = `<p class="fzm-empty">${fzmLeagueEmptyText()}</p>`;
        return;
    }

    // Même raison qu'au bureau : sur un téléphone, 96 blessés à la file
    // enterrent tout ce qui suit dans l'écran d'accueil.
    const CAP = 8;
    const shown = rows.slice(0, CAP);
    const total = fzmLeagueData.counts?.[fzmLeagueTab] || rows.length;
    const hidden = Math.max(0, total - shown.length);

    wrap.innerHTML = (fzmLeagueTab === 'injury'
        ? shown.map(fzmInjuryRowHTML).join('')
        : shown.map(fzmTxRowHTML).join(''))
        + (hidden ? `<p class="fzm-league-more">et ${hidden} autre${hidden > 1 ? 's' : ''}</p>` : '');
}

function fzmLeagueEmptyText() {
    if (fzmLeagueTab === 'injury') return 'Aucun blessé signalé.';
    // Tant que le serveur n'a pas deux photos d'alignements à comparer, il
    // n'a rien à dire — ce qui n'est pas la même chose qu'une ligue calme.
    if (!fzmLeagueData?.tracking) return 'Le suivi des mouvements démarre à la prochaine mise à jour des alignements.';
    return fzmLeagueTab === 'trade' ? 'Aucun échange récent.' : 'Aucune signature récente.';
}

function fzmLeagueFaceHTML(src, name) {
    return src
        ? `<img class="fzm-league-face" src="${escapeHTML(src)}" alt="" loading="lazy">`
        : `<span class="fzm-league-face fzm-league-face-empty">${escapeHTML((name || '?').charAt(0))}</span>`;
}

function fzmTxRowHTML(t) {
    const route = t.type === 'trade'
        ? `${escapeHTML(t.fromTeam || '?')} → ${escapeHTML(t.toTeam || '?')}`
        : `→ ${escapeHTML(t.toTeam || '?')}`;
    const meta = [t.pos, route].filter(Boolean).join(' · ');
    return `
        <div class="fzm-league-row">
            ${fzmLeagueFaceHTML(t.headshot, t.playerName)}
            <div class="fzm-league-main">
                <div class="fzm-league-name">${escapeHTML(t.playerName)}</div>
                <div class="fzm-league-meta">${meta}</div>
            </div>
            <div class="fzm-league-side">${dayLabelFr(t.date)}</div>
        </div>`;
}

function fzmInjuryRowHTML(i) {
    const detail = [i.injuryType, i.injuryDetail].filter(Boolean).join(' / ');
    const meta = [i.team, detail].filter(Boolean).join(' · ');
    return `
        <div class="fzm-league-row">
            ${fzmLeagueFaceHTML(i.headshot, i.playerName)}
            <div class="fzm-league-main">
                <div class="fzm-league-name">${escapeHTML(i.playerName)}</div>
                <div class="fzm-league-meta">${escapeHTML(meta)}</div>
            </div>
            <div class="fzm-league-side fzm-league-status" data-status="${escapeHTML(i.status || '')}">${escapeHTML(i.statusFr || '')}</div>
        </div>`;
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

    const poolData = FZPool.data();
    const team = FZPool.team();
    if (!activeName || !poolData || !team) { root.innerHTML = ''; fzmStopCountdown(); return; }

    const draftState = FZPool.draftState(poolData);
    const isDraft = draftState.etat === 'encours';
    const today = todayISO();
    const seasonStart = calData?.regularSeasonStartDate;
    const isPreseason = !isDraft && !!seasonStart && today < seasonStart;

    const rosterNames = new Set(activeRosterNames());
    const myLines = (tonight.players || []).filter(p => rosterNames.has(p.playerName));
    const liveCount = myLines.filter(p => {
        const g = (tonight.games || []).find(x => x.id === p.gameId);
        return g && (g.state === 'LIVE' || g.state === 'CRIT');
    }).length;
    const isLive = !isDraft && !isPreseason && liveCount > 0;
    const isRegular = !isDraft && !isPreseason && !isLive;

    let html = '';
    if (isLive) {
        html += `
            <div class="fzm-hero fzm-hero-live">
                <div class="fzm-hero-eyebrow"><span class="fzm-live-dot"></span>En direct</div>
                <div class="fzm-hero-headline">${liveCount} de vos joueurs ${liveCount > 1 ? 'sont' : 'est'} sur la glace en ce moment</div>
                <button type="button" class="fzm-hero-btn" id="fzmWatchLiveBtn">Voir les pointages en direct →</button>
            </div>`;
    }
    if (isDraft) html += fzmDraftHero(poolData, draftState, team.name, activeName);
    if (isPreseason) html += fzmPreseasonHero(calData);

    if (isRegular || isLive) html += fzmRankStrip(activeName, movement);
    if (isRegular || isLive) html += fzmGamesRow();
    if (isRegular || isLive) html += fzmPlayersRow(tonight, rosterNames);

    if (isDraft) {
        html += fzmDraftPicks(poolData, team.name);
        html += `<p class="fzm-note">Le classement s'ouvre une fois le repêchage terminé.</p>`;
    }
    if (isPreseason) html += fzmPreseasonExtras(draftState, activeName);

    const showActivity = isRegular || isLive || isDraft;
    if (showActivity) {
        html += `<div class="fzm-section"><div class="fzm-section-title">Activité de la ligue</div><div id="fzmActivityWrap"></div></div>`;
    }

    html += fzmLeagueSectionHTML();
    html += fzmFooterLinks();

    root.innerHTML = html;

    fzmStopCountdown();
    if (isPreseason) fzmStartCountdownTicker();
    document.getElementById('fzmWatchLiveBtn')?.addEventListener('click', () => {
        document.getElementById('fzmPlayers')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    if (showActivity) fzmLoadActivity(activeName);
    fzmLoadLeague();
    fzmLoadNews();
}
