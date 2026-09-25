/* ============================================================ */
/* TOP PLAYERS — "Meilleurs joueurs"                             */
/* Relocated from accueil.js: this used to render as the signed- */
/* in homepage's "Meilleurs joueurs" grid; the homepage now leads*/
/* with personal content and this league-wide reference content  */
/* lives here instead, right under "Meneurs de la ligue" — same  */
/* reasoning as statsLeaders.js. Shown to every visitor. Reads    */
/* BASE_URL (index.js) and escapeHTML (statsLeaders.js), both    */
/* loaded before this script.                                    */
/* ============================================================ */

const TOP_PLAYERS_SIX_MONTHS_DAYS = 180;
const TOP_PLAYERS_WINDOWS = [7, 14, 30, TOP_PLAYERS_SIX_MONTHS_DAYS];
let topPlayersRange = 7;
let topPlayersData = null;
/** Réponse de chaque fenêtre, chargée une fois : days → données (ou null). */
const topPlayersCache = new Map();

document.addEventListener('DOMContentLoaded', () => loadTopPlayers());

function topPlayersRangeText(days) {
    return days === TOP_PLAYERS_SIX_MONTHS_DAYS ? '6 derniers mois' : `${days} derniers jours`;
}

function hasTopPlayers(data) {
    return !!(data && Array.isArray(data.topPlayers) && data.topPlayers.length);
}

async function fetchTopPlayers(days) {
    const res = await fetch(`${BASE_URL}/hot-players-last${days}days`);
    return await res.json();
}

/**
 * Charge les quatre fenêtres d'un coup, puis n'offre que celles qui ont
 * quelque chose à montrer.
 *
 * Un onglet « 7J » qui ouvre sur « Aucun joueur trouvé » — en début de
 * saison, ou hors saison — ne sert à rien : il disparaît, et la page ouvre
 * sur la plus courte fenêtre qui a des joueurs. Si aucune n'en a, il n'y a
 * plus d'onglets du tout, seulement une phrase.
 */
async function loadTopPlayers() {
    try {
        const reponses = await Promise.all(TOP_PLAYERS_WINDOWS.map(days =>
            fetchTopPlayers(days).then(data => [days, data]).catch(() => [days, null])));
        reponses.forEach(([days, data]) => topPlayersCache.set(days, data));

        const disponibles = TOP_PLAYERS_WINDOWS.filter(days => hasTopPlayers(topPlayersCache.get(days)));
        document.querySelectorAll('.top-players-section .time-filter').forEach(btn => {
            btn.style.display = disponibles.includes(Number(btn.dataset.days)) ? '' : 'none';
        });
        const filtres = document.querySelector('.top-players-section .time-filters');
        if (filtres) filtres.hidden = disponibles.length < 2;

        if (!disponibles.length) {
            if (reponses.every(([, data]) => data === null)) { renderTopPlayersError(); return; }
            renderTopPlayersVide();
            return;
        }
        selectTopPlayersRange(disponibles[0]);
    } catch (err) {
        console.error('Error loading top players:', err);
        renderTopPlayersError();
    }
}

function selectTopPlayersRange(days) {
    topPlayersRange = days;
    topPlayersData = topPlayersCache.get(days) || null;
    document.querySelectorAll('.top-players-section .time-filter').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.days) === topPlayersRange);
    });
    const label = document.getElementById('timeRangeLabel');
    if (label) label.textContent = topPlayersRangeText(topPlayersRange);
    renderTopPlayers();
}

function changeTimeRange(days) {
    if (topPlayersCache.has(days)) { selectTopPlayersRange(days); return; }
    fetchTopPlayers(days)
        .then(data => { topPlayersCache.set(days, data); selectTopPlayersRange(days); })
        .catch(() => renderTopPlayersError());
}

/** Aucune fenêtre n'a de joueurs : une phrase, pas quatre onglets vides. */
function renderTopPlayersVide() {
    const skeleton = document.getElementById('topPlayersSkeleton');
    const content  = document.getElementById('topPlayersList');
    if (skeleton) skeleton.style.display = 'none';
    const label = document.getElementById('timeRangeLabel');
    if (label) label.textContent = '';
    if (!content) return;
    content.style.display = '';
    content.innerHTML = `<p style="grid-column:1/-1;width:100%;text-align:center;
        padding:48px;color:var(--text-gray);">Pas encore de match joué : les meilleurs joueurs
        apparaîtront après les premières rencontres.</p>`;
}

function renderTopPlayers() {
    const skeleton = document.getElementById('topPlayersSkeleton');
    const content  = document.getElementById('topPlayersList');

    if (skeleton) skeleton.style.display = 'none';
    if (!content) return;

    // Clear the inline display so .players-grid decides the layout — it's a grid
    // on desktop and a horizontal snap-scroller on phones.
    content.style.display = '';

    if (!topPlayersData || !topPlayersData.topPlayers) {
        renderTopPlayersError();
        return;
    }

    const performers = topPlayersData.topPlayers.slice(0, 10);

    if (!performers.length) {
        content.innerHTML = `<p style="grid-column:1/-1;width:100%;text-align:center;
            padding:48px;color:var(--text-gray);">Aucun joueur trouvé dans les ${topPlayersRangeText(topPlayersRange)}</p>`;
        return;
    }

    const rankCls = i => i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'normal';

    content.innerHTML = performers.map((p, i) => {
        const name    = escapeHTML(p.playerName || 'Unknown');
        const team    = escapeHTML(p.teamAbbrev || 'N/A');
        const pos     = p.position || 'F';
        const fantasyPts = Math.round(p.totalFantasyPoints || 0);
        const gamesPlayed = p.gamesPlayed || 0;
        const isHot   = p.isHot || false;

        // Display goals/assists for skaters, wins/saves for goalies
        const goals   = p.goals || 0;
        const assists = p.assists || 0;
        const wins    = p.wins || 0;
        const saves   = p.saves || 0;

        const headshot = p.headshot || buildHeadshotUrl(p.playerId, p.teamAbbrev);

        return `
        <div class="player-card" onclick="showCareerStats(${p.playerId || 'null'})"
             style="animation-delay:${i * 0.07}s">
            <div class="player-rank-badge ${rankCls(i)}">${i + 1}</div>
            ${isHot ? '<span class="hot-streak" title="En feu!">🔥</span>' : ''}
            <div class="player-card-photo fz-shot" style="--fz-shot-team: ${escapeHTML(teamShotColor(p.teamAbbrev))}">
                <img src="${headshot}" alt="${name}"
                     onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display='flex';"
                     loading="lazy">
                <span class="no-photo" style="display:none">🏒</span>
            </div>
            <div class="player-card-name">${name}${typeof injuryBadgeHTML === 'function' ? injuryBadgeHTML(p.playerName, p.teamAbbrev) : ''}</div>
            <div class="player-card-team">${team} · ${gamesPlayed} matchs</div>
            <div class="player-card-stats">
                ${pos === 'G' ? `
                    <div class="pc-stat">
                        <span class="pc-stat-val pts">${fantasyPts}</span>
                        <span class="pc-stat-label">FPTS</span>
                    </div>
                    <div class="pc-stat">
                        <span class="pc-stat-val">${wins}</span>
                        <span class="pc-stat-label">VIC</span>
                    </div>
                    <div class="pc-stat">
                        <span class="pc-stat-val">${saves}</span>
                        <span class="pc-stat-label">ARR</span>
                    </div>
                ` : `
                    <div class="pc-stat">
                        <span class="pc-stat-val pts">${fantasyPts}</span>
                        <span class="pc-stat-label">FPTS</span>
                    </div>
                    <div class="pc-stat">
                        <span class="pc-stat-val">${goals}</span>
                        <span class="pc-stat-label">BTS</span>
                    </div>
                    <div class="pc-stat">
                        <span class="pc-stat-val">${assists}</span>
                        <span class="pc-stat-label">ASS</span>
                    </div>
                `}
            </div>
        </div>`;
    }).join('');
}

function renderTopPlayersError() {
    const skeleton = document.getElementById('topPlayersSkeleton');
    const content  = document.getElementById('topPlayersList');
    if (skeleton) skeleton.style.display = 'none';
    if (!content) return;
    content.style.display = '';
    content.innerHTML = `
        <div class="tp-error">
            <p class="tp-error-title">📊 Aucune donnée disponible</p>
            <p class="tp-error-hint">Les statistiques des joueurs seront disponibles une fois les logs de parties chargés dans la base de données.</p>
            <button class="tp-error-retry" onclick="location.reload()">🔄 Réessayer</button>
        </div>`;
}
