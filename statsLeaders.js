/* ============================================================ */
/* STATS LEADERS — "Meneurs de la ligue"                         */
/* Six top-5 boards, one per category, from /stats-leaders.       */
/* Relocated from accueil.js: this used to render as the signed- */
/* in homepage's hero content; the homepage now leads with       */
/* personal content (draft actions, trades) and this league-wide */
/* reference content lives here instead, next to the full player */
/* table it complements. Shown to every visitor, not gated by    */
/* login — this page has never required an account.              */
/* ============================================================ */

const LEADER_CATEGORIES = [
    { key: 'forwardsPoints', title: 'Pointeurs — Attaquants', icon: 'hockey', stat: 'points',  statLabel: 'PTS' },
    { key: 'defensePoints',  title: 'Pointeurs — Défenseurs', icon: 'shield', stat: 'points',  statLabel: 'PTS' },
    { key: 'goalsLeaders',   title: 'Meneurs — Buts',         icon: 'goal',   stat: 'goals',   statLabel: 'BTS' },
    { key: 'assistsLeaders', title: 'Meneurs — Aides',        icon: 'arrows', stat: 'assists', statLabel: 'AST' },
    { key: 'rookiePoints',   title: 'Pointeurs — Recrues',    icon: 'star',   stat: 'points',  statLabel: 'PTS' },
    { key: 'goalieWins',     title: 'Victoires — Gardiens',   icon: 'trophy', stat: 'wins',    statLabel: 'VIC' }
];

document.addEventListener('DOMContentLoaded', loadAndRenderStatsLeaders);

async function loadAndRenderStatsLeaders() {
    const grid = document.getElementById('statsLeadersGrid');
    if (!grid) return;

    try {
        const res = await fetch(`${BASE_URL}/stats-leaders`, { cache: 'no-store' });
        const leaders = res.ok ? await res.json() : null;
        renderStatsLeaders(leaders);
    } catch (err) {
        console.warn('Could not load stats leaders:', err);
        renderStatsLeaders(null);
    }
}

function renderStatsLeaders(leaders) {
    const grid = document.getElementById('statsLeadersGrid');
    if (!grid) return;

    grid.innerHTML = LEADER_CATEGORIES
        .map(cat => buildLeaderCard(cat, (leaders && leaders[cat.key]) || []))
        .join('');

    // The global icon scan only runs once on load; process the freshly-inserted icons.
    if (typeof getIcon === 'function') {
        grid.querySelectorAll('[data-icon]').forEach(el => {
            el.innerHTML = getIcon(el.getAttribute('data-icon'), parseInt(el.getAttribute('data-icon-size') || '20'));
        });
    }
}

function buildLeaderCard(cat, players) {
    const head = `
        <div class="leader-card-head">
            <span class="leader-card-icon" data-icon="${cat.icon}" data-icon-size="15"></span>
            <span class="leader-card-title">${cat.title}</span>
        </div>`;

    if (!players.length) {
        return `<div class="leader-card">${head}<p class="leader-card-empty">Aucune donnée pour le moment</p></div>`;
    }

    const [first, ...rest] = players;
    // showCareerStats fetches everything itself from /player-career/<id> and
    // reads name/isGoalie off that response — only the id is actually used.
    const openCareer = p => `showCareerStats(${p.playerId || 'null'})`;

    return `
    <div class="leader-card">
        ${head}
        <div class="leader-featured" onclick="${openCareer(first)}">
            <img class="leader-featured-photo" src="${first.headshot}" alt="${escapeHTML(first.playerName)}"
                 loading="lazy" onerror="this.style.visibility='hidden'">
            <span class="leader-featured-id">
                <span class="leader-featured-name">${escapeHTML(first.playerName)}</span>
                <span class="leader-featured-meta">${escapeHTML(first.teamAbbrev || '')}</span>
            </span>
            <span class="leader-featured-stat">
                <span class="leader-featured-val">${first[cat.stat] ?? 0}</span>
                <span class="leader-featured-lbl">${cat.statLabel}</span>
            </span>
        </div>
        ${rest.map((p, i) => `
            <div class="leader-row" onclick="${openCareer(p)}">
                <span class="leader-row-rank">${i + 2}</span>
                <span class="leader-row-name">${escapeHTML(p.playerName)}</span>
                <span class="leader-row-team">${escapeHTML(p.teamAbbrev || '')}</span>
                <span class="leader-row-val">${p[cat.stat] ?? 0}</span>
            </div>`).join('')}
    </div>`;
}

function escapeHTML(str) {
    return String(str ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
