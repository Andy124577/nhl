let fullPlayerData = [],
    rookiePlayerData = [],
    teamData = [],
    imageList = [],
    goalieData = [],
    currentStats = null,
    currentTeams = null;

// Stats table pagination (Miller's Law — avoid dumping 100+ rows at once)
const STATS_PAGE_SIZE = 25;
let statsVisibleCount = STATS_PAGE_SIZE;
let statsFullList = [];
const BASE_URL = window.location.hostname.includes("localhost") ? "http://localhost:3000" : window.location.origin;
const PROV_ABBR = {"Alberta":"AB","British Columbia":"BC","Manitoba":"MB","New Brunswick":"NB","Newfoundland and Labrador":"NL","Northwest Territories":"NT","Nova Scotia":"NS","Nunavut":"NU","Ontario":"ON","Prince Edward Island":"PE","Quebec":"QC","Québec":"QC","Saskatchewan":"SK","Yukon":"YT","Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY","District of Columbia":"DC"};

function getCurrentPlayerStats(t, e) {
    if (!currentStats || !currentStats.players) return null;
    if (e) {
        const t = currentStats.players.find(t => t.playerId === e);
        if (t) return t
    }
    return currentStats.players.find(e => e.playerName === t)
}

function getCurrentTeamStats(t) {
    return currentTeams && currentTeams.teams ? currentTeams.teams.find(e => e.teamFullName === t) : null
}
async function fetchPlayerData() {
    showSkeletonLoader();
    try {
        const t = await fetch("nhl_filtered_stats.json");
        if (!t.ok) throw new Error(`Error: ${t.status} - ${t.statusText}`);
        const e = await t.json();
        fullPlayerData = [...e.Top_50_Defenders, ...e.Top_100_Offensive_Players, ...e.Top_Rookies], rookiePlayerData = e.Top_Rookies || [], teamData = e.Teams, goalieData = e.Top_50_Goalies;
        try {
            const t = await fetch(`${BASE_URL}/current-stats`, {
                cache: "no-store"
            });
            currentStats = await t.json(), console.log(`✅ Current stats loaded: ${currentStats.players.length} players, last updated: ${currentStats.lastUpdated}`)
        } catch (t) {
            console.warn("⚠️ Could not load current stats, using cached data:", t)
        }
        try {
            const t = await fetch(`${BASE_URL}/current-teams`, {
                cache: "no-store"
            });
            currentTeams = await t.json(), console.log(`✅ Current team standings loaded: ${currentTeams.teams.length} teams, last updated: ${currentTeams.lastUpdated}`)
        } catch (t) {
            console.warn("⚠️ Could not load current team standings, using cached data:", t)
        }
        updateTable(), hideSkeletonLoader()
    } catch (t) {
        console.error("Failed to fetch player data:", t), hideSkeletonLoader()
    }
}
async function fetchImageData() {
    // Les photos viennent du CDN de la LNH (voir headshots.js) : rien à charger.
}

function getMatchingImage(t) {
    return resolveHeadshotByName(t)
}

function getTeamLogoPath(t) {
    if (!t || "null" === t) return null;
    return `teams/${t.split(",").pop().trim()}.png`
}

function updateTable() {
    const t = document.getElementById("playerFilter").value,
        e = document.getElementById("sortBy").value,
        a = document.getElementById("searchInput").value.toLowerCase();
    clearStatsPagination();
    if ("teams" === t) {
        return void populateTeamTable([...teamData].sort((t, e) => {
            const a = getCurrentTeamStats(t.teamFullName),
                n = getCurrentTeamStats(e.teamFullName),
                s = a ? a.points : t.points;
            return (n ? n.points : e.points) - s
        }))
    }
    if ("goalies" === t) {
        return void populateGoalieTable([...goalieData].sort((t, a) => {
            const n = getCurrentPlayerStats(t.goalieFullName, t.playerId),
                s = getCurrentPlayerStats(a.goalieFullName, a.playerId);
            let l = 0,
                o = 0;
            return "points" === e ? (l = n ? 5 * n.shutouts + 2 * n.wins + 1 * n.otLosses : t.points || 0, o = s ? 5 * s.shutouts + 2 * s.wins + 1 * s.otLosses : a.points || 0) : (l = n ? n[e] || 0 : t[e] || 0, o = s ? s[e] || 0 : a[e] || 0), o - l
        }))
    }
    let n = fullPlayerData;
    "offensive" === t ? n = n.filter(t => ["C", "R", "L"].includes(t.positionCode)) : "defensive" === t ? n = n.filter(t => "D" === t.positionCode) : "rookies" === t && (n = rookiePlayerData.slice()), a && (n = n.filter(t => t.skaterFullName.toLowerCase().includes(a))), n.sort((t, a) => {
        const n = getCurrentPlayerStats(t.skaterFullName, t.playerId),
            s = getCurrentPlayerStats(a.skaterFullName, a.playerId),
            l = n ? n[e] || 0 : t[e] || 0,
            o = s ? s[e] || 0 : a[e] || 0;
        return o - l
    }), statsFullList = n, statsVisibleCount = STATS_PAGE_SIZE, populatePlayerTable(n)
}
/**
 * Colonnes du tableau des patineurs.
 *
 * `sort` renvoie vers la même clé que le sélecteur « Trier par » : cliquer
 * un en-tête met à jour le sélecteur puis relance le rendu, ce qui évite
 * d'avoir deux états de tri qui divergent.
 *
 * Abréviations en français (PJ/B/A/PTS) plutôt qu'en anglais : le reste du
 * site est en français, et chacune porte une infobulle — l'utilisateur ne
 * devrait pas avoir à deviner ce que signifie une colonne.
 */
const SKATER_COLUMNS = [
    { label: '#', cls: 'rank-col', title: 'Rang', w: '6%' },
    { label: 'Joueur', cls: 'player-col', w: '58%' },
    { label: 'PJ', sort: 'gamesPlayed', title: 'Parties jouées', w: '9%' },
    { label: 'B', sort: 'goals', title: 'Buts', w: '9%' },
    { label: 'A', sort: 'assists', title: 'Passes décisives', w: '9%' },
    { label: 'PTS', sort: 'points', title: 'Points', cls: 'points-column', w: '9%' }
];

/**
 * Construit <colgroup> + <thead>.
 *
 * Les largeurs passent par <colgroup> et non par des règles CSS en
 * nth-child : les précédentes avaient été écrites pour un tableau à six
 * colonnes et désignaient les mauvaises colonnes dès qu'on en ajoutait une.
 * Ici la largeur vit à côté du libellé, dans la même définition.
 * La colonne sans largeur absorbe l'espace restant.
 */
function buildTableHead(columns, activeSort) {
    // La largeur passe par une variable CSS et non par `width` en ligne : un
    // style en ligne l'emporte sur toute feuille de style, ce qui rendait les
    // ajustements responsive impossibles sans !important.
    const cols = columns
        .map(c => `<col${c.w ? ` style="--col-w:${c.w}"` : ''}>`)
        .join('');
    const cells = columns.map(c => {
        const cls = [c.cls, c.sort ? 'sortable' : ''].filter(Boolean).join(' ');
        const actif = c.sort && c.sort === activeSort;
        return `<th${cls ? ` class="${cls}${actif ? ' is-sorted' : ''}"` : ''}`
            + (c.title ? ` title="${c.title}"` : '')
            + (c.sort ? ` data-sort="${c.sort}" role="button" tabindex="0"` : '')
            + (actif ? ' aria-sort="descending"' : '')
            + `>${c.label}${actif ? '<span class="sort-caret" aria-hidden="true">▼</span>' : ''}</th>`;
    }).join('');
    return `<colgroup>${cols}</colgroup><thead><tr>${cells}</tr></thead>`;
}

/** Message d'état vide : une recherche infructueuse doit expliquer quoi faire. */
function buildEmptyState(colspan, message, hint) {
    return `<tbody><tr class="table-empty-row"><td colspan="${colspan}">
        <div class="table-empty">
            <p class="table-empty-title">${message}</p>
            ${hint ? `<p class="table-empty-hint">${hint}</p>` : ''}
        </div>
    </td></tr></tbody>`;
}

async function populatePlayerTable(t) {
    await fetchImageData();
    const e = document.getElementById("playerTable");
    const visible = t.slice(0, statsVisibleCount);
    const sortKey = document.getElementById("sortBy")?.value;

    if (!t.length) {
        e.innerHTML = buildTableHead(SKATER_COLUMNS, sortKey)
            + buildEmptyState(SKATER_COLUMNS.length, 'Aucun joueur ne correspond',
                'Vérifiez l\'orthographe ou effacez la recherche.');
        renderStatsPagination(0);
        return;
    }

    e.innerHTML = buildTableHead(SKATER_COLUMNS, sortKey);
    const tbody = document.createElement("tbody");
    e.appendChild(tbody);
    visible.forEach((t, index) => {
        const a = t.skaterFullName,
            n = getCurrentPlayerStats(a, t.playerId),
            s = getMatchingImage(a),
            l = n?.headshot,
            o = n?.teamAbbrev || t.teamAbbrevs?.split(",").pop().trim(),
            r = t.playerId && o ? buildHeadshotUrl(t.playerId, o) : null,
            d = s || l || r,
            i = n?.teamAbbrev ? `teams/${n.teamAbbrev}.png` : getTeamLogoPath(t.teamAbbrevs);
        let c, u, m, h;
        n && n.gamesPlayed > 0 ? (c = n.gamesPlayed || 0, u = n.goals || 0, m = n.assists || 0, h = n.points || 0) : (c = t.gamesPlayed || 0, u = t.goals || 0, m = t.assists || 0, h = t.points || 0);
        const g = d && i ? `\n            <div class="player-photo">\n                <img src="${d}" alt="" class="face">\n                <img src="${i}" alt="${n?.teamAbbrev||t.teamAbbrevs}" class="logo">\n            </div>\n            ` : "",
            p = n?.position || t.positionCode || "N/A",
            y = document.createElement("tr");
        y.innerHTML = `\n            <td class="rank-col">${index + 1}</td>\n            <td class="player-col"><div class="player-cell">${g}<div class="player-ident"><span class="player-name">${a}${injBadge(a, o)}</span><span class="player-pos">${p}</span></div></div></td>\n            <td>${c}</td>\n            <td>${u}</td>\n            <td>${m}</td>\n            <td class="points-column">${h}</td>\n        `;
        makeRowInteractive(y, () => showCareerStats(t.playerId, t.skaterFullName, !1),
            `Voir la fiche de ${a}`);
        tbody.appendChild(y)
    });
    renderStatsPagination(t.length)
}

/**
 * Pastille de blessure, ou rien. injuries.js est une couche d'agrément :
 * si le script n'a pas chargé, le tableau doit s'afficher quand même
 * plutôt que d'échouer sur une fonction absente.
 */
function injBadge(playerName, teamAbbrev) {
    return typeof injuryBadgeHTML === 'function' ? injuryBadgeHTML(playerName, teamAbbrev) : '';
}

/**
 * Rend une rangée activable à la souris ET au clavier.
 *
 * Un <tr> avec un simple onclick est invisible pour la navigation au
 * clavier : sans tabindex il n'est jamais atteignable, et sans gestion de
 * Entrée/Espace il reste inactivable.
 */
function makeRowInteractive(row, action, label) {
    row.classList.add('is-clickable');
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    if (label) row.setAttribute('aria-label', label);
    row.onclick = action;
    row.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); action(); }
    };
}

/**
 * Tri par clic sur l'en-tête. Délégué sur le tableau parce que le contenu est
 * reconstruit à chaque rendu — un écouteur par <th> fuirait à chaque passe.
 */
function initStatsHeaderSorting() {
    const table = document.getElementById("playerTable");
    const select = document.getElementById("sortBy");
    if (!table || !select) return;

    const trier = (th) => {
        const key = th?.dataset?.sort;
        if (!key) return;
        if (![...select.options].some(o => o.value === key)) return;
        select.value = key;
        updateTable();
    };

    table.addEventListener('click', e => trier(e.target.closest('th[data-sort]')));
    table.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const th = e.target.closest('th[data-sort]');
        if (!th) return;
        e.preventDefault();
        trier(th);
    });
}
document.addEventListener('DOMContentLoaded', initStatsHeaderSorting);

// Stats pagination controls (Miller's Law)
function renderStatsPagination(total) {
    const container = document.getElementById("statsPagination");
    if (!container) return;
    const shown = Math.min(statsVisibleCount, total);
    if (total <= STATS_PAGE_SIZE) {
        container.innerHTML = total > 0
            ? `<div class="stats-page-info">${total} joueur${total > 1 ? 's' : ''}</div>`
            : '';
        return;
    }
    const moreBtn = shown < total
        ? `<button class="stats-show-more" onclick="showMorePlayers()">Voir plus (${total - shown} restant${total - shown > 1 ? 's' : ''})</button>`
        : '';
    container.innerHTML = `
        <div class="stats-page-info">${shown} sur ${total} joueurs</div>
        ${moreBtn}
    `;
}

function showMorePlayers() {
    statsVisibleCount += STATS_PAGE_SIZE;
    populatePlayerTable(statsFullList);
}

function clearStatsPagination() {
    const container = document.getElementById("statsPagination");
    if (container) container.innerHTML = '';
}

function populateGoalieTable(t) {
    const e = document.getElementById("playerTable");
    const GOALIE_COLUMNS = [
        { label: '#', cls: 'rank-col', title: 'Rang', w: '6%' },
        { label: 'Gardien', cls: 'player-col', w: '38%' },
        { label: 'PJ', title: 'Parties jouées', w: '8%' },
        { label: 'V', title: 'Victoires', w: '7%' },
        { label: 'D', title: 'Défaites', w: '7%' },
        { label: 'DP', title: 'Défaites en prolongation', w: '8%' },
        { label: '%ARR', title: 'Pourcentage d\'arrêts', w: '10%' },
        { label: 'BL', title: 'Blanchissages', w: '7%' },
        { label: 'PTS', title: 'Points', cls: 'points-column', w: '9%' }
    ];
    if (!t.length) {
        e.innerHTML = buildTableHead(GOALIE_COLUMNS)
            + buildEmptyState(GOALIE_COLUMNS.length, 'Aucun gardien à afficher');
        return;
    }
    e.innerHTML = buildTableHead(GOALIE_COLUMNS);
    const tbody = document.createElement("tbody");
    e.appendChild(tbody);
    t.forEach((t, index) => {
        const a = t.goalieFullName,
            n = getCurrentPlayerStats(a, t.playerId),
            s = getMatchingImage(a),
            l = n?.teamAbbrev ? `teams/${n.teamAbbrev}.png` : getTeamLogoPath(t.teamAbbrevs);
        let o, r, d, i, c, u, m;
        n && n.gamesPlayed > 0 ? (o = n.gamesPlayed || 0, r = n.wins || 0, d = n.losses || 0, i = n.otLosses || 0, c = n.savePct || 0, u = n.shutouts || 0, m = 5 * u + 2 * r + 1 * i) : (o = t.gamesPlayed || 0, r = t.wins || 0, d = t.losses || 0, i = t.otLosses || 0, c = t.savePct || 0, u = t.shutouts || 0, m = t.points || 0);
        const h = s && l ? `<div class="player-photo">\n                    <img src="${s}" alt="${a}" class="face">\n                    <img src="${l}" alt="${n?.teamAbbrev||t.teamAbbrevs}" class="logo">\n               </div>` : "",
            g = document.createElement("tr");
        g.innerHTML = `\n            <td class="rank-col">${index + 1}</td>\n            <td class="player-col"><div class="player-cell">${h}<div class="player-ident"><span class="player-name">${a}${injBadge(a, n?.teamAbbrev || t.teamAbbrevs?.split(",").pop().trim())}</span></div></div></td>\n            <td>${o}</td>\n            <td>${r}</td>\n            <td>${d}</td>\n            <td>${i}</td>\n            <td>${c?.toFixed(3)}</td>\n            <td>${u}</td>\n            <td class="points-column">${m}</td>\n        `;
        makeRowInteractive(g, () => showCareerStats(t.playerId, t.goalieFullName, !0),
            `Voir la fiche de ${a}`);
        tbody.appendChild(g)
    })
}

function getTeamAbbreviation(t) {
    const e = {
            Florida: "FLA",
            Calgary: "CGY",
            "Montréal": "MTL",
            Nashville: "NSH",
            Louis: "STL",
            Washington: "WSH",
            Toronto: "TOR",
            Winnipeg: "WPG",
            Utah: "UTA",
            Detroit: "DET"
        },
        a = t.split(" ");
    return e[a[0]] ? e[a[0]] : 3 === a.length ? a.map(t => t[0]).join("").toUpperCase() : a[0].substring(0, 3).toUpperCase()
}

function populateTeamTable(t) {
    const e = document.getElementById("playerTable");
    const TEAM_COLUMNS = [
        { label: '#', cls: 'rank-col', title: 'Rang', w: '6%' },
        { label: 'Équipe', cls: 'player-col', w: '44%' },
        { label: 'PJ', title: 'Parties jouées', w: '12%' },
        { label: 'V', title: 'Victoires', w: '12%' },
        { label: 'D', title: 'Défaites', w: '10%' },
        { label: 'DP', title: 'Défaites en prolongation', w: '8%' },
        { label: 'PTS', title: 'Points', cls: 'points-column', w: '8%' }
    ];
    if (!t.length) {
        e.innerHTML = buildTableHead(TEAM_COLUMNS)
            + buildEmptyState(TEAM_COLUMNS.length, 'Aucune équipe à afficher');
        return;
    }
    e.innerHTML = buildTableHead(TEAM_COLUMNS);
    const tbody = document.createElement("tbody");
    e.appendChild(tbody);
    t.forEach((t, index) => {
        const a = `teams/${getTeamAbbreviation(t.teamFullName)}.png`,
            n = getCurrentTeamStats(t.teamFullName);
        let s, l, o, r, d;
        n && n.gamesPlayed > 0 ? (s = n.gamesPlayed || 0, l = n.wins || 0, o = n.losses || 0, r = n.otLosses || 0, d = n.points || 2 * l + 1 * r) : (s = t.gamesPlayed || 0, l = t.wins || 0, o = t.losses || 0, r = t.otLosses || 0, d = t.points || 0);
        const i = document.createElement("tr");
        i.innerHTML = `\n            <td class="rank-col">${index + 1}</td>\n            <td class="player-col"><div class="player-cell"><img src="${a}" alt="" class="team-logo-cell"><div class="player-ident"><span class="player-name">${t.teamFullName}</span></div></div></td>\n            <td>${s}</td>\n            <td>${l}</td>\n            <td>${o}</td>\n            <td>${r}</td>\n            <td class="points-column">${d}</td>\n        `;
        makeRowInteractive(i, () => showLastYearStats(t, "team"),
            `Voir les statistiques de ${t.teamFullName}`);
        tbody.appendChild(i)
    })
}

function showLastYearStats(t, e) {
    const a = document.getElementById("lastYearModal"),
        n = document.getElementById("modalPlayerName"),
        s = document.getElementById("modalStats");
    let l = null,
        o = "";
    if ("player" === e ? (o = t.skaterFullName, l = fullPlayerData.find(t => t.skaterFullName === o)) : "goalie" === e ? (o = t.goalieFullName, l = goalieData.find(t => t.goalieFullName === o)) : "team" === e && (o = t.teamFullName, l = teamData.find(t => t.teamFullName === o)), n.textContent = o, l) {
        let t = "";
        if ("player" === e) t = `\n                <div class="stat-item">\n                    <div class="stat-label">Matchs joués</div>\n                    <div class="stat-value">${l.gamesPlayed||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Buts</div>\n                    <div class="stat-value">${l.goals||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Passes</div>\n                    <div class="stat-value">${l.assists||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Points</div>\n                    <div class="stat-value">${l.points||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">+/-</div>\n                    <div class="stat-value">${l.plusMinus||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">PIM</div>\n                    <div class="stat-value">${l.penaltyMinutes||0}</div>\n                </div>\n            `;
        else if ("goalie" === e) {
            const e = l.points || 0;
            t = `\n                <div class="stat-item">\n                    <div class="stat-label">Matchs joués</div>\n                    <div class="stat-value">${l.gamesPlayed||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Victoires</div>\n                    <div class="stat-value">${l.wins||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Défaites</div>\n                    <div class="stat-value">${l.losses||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Prol.</div>\n                    <div class="stat-value">${l.otLosses||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">% Arrêts</div>\n                    <div class="stat-value">${l.savePct?.toFixed(3)||"0.000"}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Blanchissages</div>\n                    <div class="stat-value">${l.shutouts||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Points</div>\n                    <div class="stat-value">${e}</div>\n                </div>\n            `
        } else "team" === e && (t = `\n                <div class="stat-item">\n                    <div class="stat-label">Matchs joués</div>\n                    <div class="stat-value">${l.gamesPlayed||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Victoires</div>\n                    <div class="stat-value">${l.wins||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Défaites</div>\n                    <div class="stat-value">${l.losses||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Prol.</div>\n                    <div class="stat-value">${l.otLosses||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Points</div>\n                    <div class="stat-value">${l.points||0}</div>\n                </div>\n            `);
        s.innerHTML = t
    } else s.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Aucune statistique disponible</p>';
    a.style.display = "block"
}

function closeLastYearModal() {
    document.getElementById("lastYearModal").style.display = "none"
}
window.onclick = function(t) {
    const e = document.getElementById("lastYearModal"),
        a = document.getElementById("careerStatsModal");
    t.target === e && closeLastYearModal(), t.target === a && closeCareerModal()
};
let currentCareerData = null;
async function showCareerStats(t, e, a = !1) {
    const n = document.getElementById("careerStatsModal"),
        s = document.getElementById("careerModalHeader"),
        l = document.getElementById("careerPlayerName"),
        o = document.getElementById("careerPlayerPosition"),
        r = document.getElementById("careerPlayerTeam"),
        d = document.getElementById("playerHeadshotContainer"),
        i = document.getElementById("careerFilters"),
        c = document.getElementById("careerStatsTable"),
            p = document.getElementById("careerSeasonHighlight"),
            g = document.getElementById("careerNameBanner");
    currentPlayerId = t, n.style.display = "block", document.body.style.overflow = "hidden", showModalSkeleton(), document.getElementById("viewFilter").value = "career", document.getElementById("leagueFilter").value = "nhl", document.getElementById("gameTypeFilter").value = "regular";
    try {
        const a = await fzChargerCarriere(t, BASE_URL);
        if (currentCareerData = a, hideModalSkeleton(), s.style.display = "flex", i.style.display = "flex", l.textContent = a.playerName, o.textContent = a.isGoalie ? "🥅 Gardien de but" : "🏒 " + (a.position || "Joueur"), a.currentTeam) {
            const t = getTeamLogoPath(a.currentTeam);
            r.innerHTML = t ? `<img src="${t}" alt="${a.currentTeam}"> ${a.currentTeam}` : a.currentTeam
        } else r.textContent = "";
        g.style.display = "block";
        const tc = getTeamColors(a.currentTeam);
        g.style.setProperty("--team-primary", tc[0]), g.style.setProperty("--team-secondary", tc[1]);
        // Indisponibilité : `currentTeam` est déjà l'abréviation officielle
        // (currentTeamAbbrev côté serveur), ce qui départage les homonymes.
        if (typeof renderInjuryBanner === "function") renderInjuryBanner(a.playerName, a.currentTeam);
        if (a.headshot ? d.innerHTML = `<img src="${a.headshot}" alt="${a.playerName}">` : d.innerHTML = '<div class="no-photo">🏒</div>', document.getElementById("playerHeight").textContent = a.height || "-", document.getElementById("playerWeight").textContent = a.weight ? `${a.weight} lb` : "-", a.birthDate) {
            const t = new Date(a.birthDate),
                e = new Date;
            let n = e.getFullYear() - t.getFullYear();
            const s = e.getMonth() - t.getMonth();
            (s < 0 || 0 === s && e.getDate() < t.getDate()) && n--, document.getElementById("playerBirthDate").textContent = `${a.birthDate} (${n})`
        } else document.getElementById("playerBirthDate").textContent = "-";
        let n = "";
        if (a.birthCity && (n += a.birthCity), a.birthStateProvince && (n += (n ? ", " : "") + (PROV_ABBR[a.birthStateProvince] || a.birthStateProvince)), document.getElementById("playerBirthPlace").textContent = n || "-", a.draftInfo) {
            const t = a.draftInfo,
                e = `${t.year}: Rd ${t.round}, Ch. ${t.pickInRound} (${t.teamAbbrev})`;
            document.getElementById("playerDraft").textContent = e
        } else document.getElementById("playerDraft").textContent = "Non repêché";
        if (p) {
            const cs = currentStats && currentStats.players ? currentStats.players.find(x => x.playerId === t) : null,
                pool = currentStats && currentStats.players ? currentStats.players.filter(x => (x.position === "G") === a.isGoalie) : [];
            if (cs && pool.length) {
                const rankOf = k => {
                    const sorted = [...pool].sort((x, y) => (y[k] || 0) - (x[k] || 0)),
                        v = cs[k] || 0;
                    let rank = 1;
                    for (let i = 0; i < sorted.length; i++) {
                        if (i > 0 && (sorted[i][k] || 0) !== (sorted[i - 1][k] || 0)) rank = i + 1;
                        if (sorted[i].playerId === cs.playerId) break
                    }
                    const tied = sorted.filter(x => (x[k] || 0) === v).length > 1,
                        ord = n => {
                            const s2 = ["th", "st", "nd", "rd"], v2 = n % 100;
                            return n + (s2[(v2 - 20) % 10] || s2[v2] || s2[0])
                        };
                    return (tied ? "Tied-" : "") + ord(rank)
                }, tiles = a.isGoalie ? [
                    ["W", "wins"],
                    ["SO", "shutouts"],
                    ["GP", "gamesPlayed"]
                ] : [
                    ["G", "goals"],
                    ["A", "assists"],
                    ["PTS", "points"]
                ], ss = String(currentStats.season || ""), sd = 8 === ss.length ? `${ss.slice(0, 4)}-${ss.slice(6, 8)}` : ss;
                p.innerHTML = `<div class="cmh-season-label">Saison ${sd}</div><div class="cmh-season-tiles">` + tiles.map(([lb, k]) => `<div class="cmh-season-tile"><span class="cmh-mini-lbl">${lb}</span><span class="cmh-season-val">${cs[k] || 0}</span><span class="cmh-season-rank">${rankOf(k)}</span></div>`).join("") + "</div>", p.style.display = "block"
            } else p.style.display = "none"
        }
        filterCareerStats();
        const c = document.querySelector(".filter-group-career:has(#leagueFilter)"),
            u = document.querySelector(".filter-group-career:has(#gameTypeFilter)");
        c && (c.style.display = "flex"), u && (u.style.display = "flex")
    } catch (t) {
        console.error("Error fetching career stats:", t), hideModalSkeleton(), s.style.display = "flex", c.innerHTML = `<p class="no-stats-message">❌ ${"function"==typeof fzMessageErreurCarriere?fzMessageErreurCarriere(t):"Erreur lors du chargement des statistiques"}</p>`
    }
}

function filterCareerStats() {
    if (!currentCareerData) return;
    const t = document.getElementById("leagueFilter").value,
        e = document.getElementById("gameTypeFilter").value,
        a = document.getElementById("careerStatsTable"),
        n = document.getElementById("statsCountBadge");
    let s = currentCareerData.seasons.filter(a => {
        const n = "all" === t || "nhl" === t && "NHL" === a.league || "other" === t && "NHL" !== a.league,
            s = "all" === e || "regular" === e && "regular" === a.gameType || "playoffs" === e && "playoffs" === a.gameType;
        return n && s
    });
    if (n.textContent = `${s.length} saison${s.length>1?"s":""} affichée${s.length>1?"s":""}`, 0 === s.length) return void(a.innerHTML = '<p class="no-stats-message">Aucune statistique correspondant aux filtres sélectionnés</p>');
    let l = "<table><thead><tr>";
    if (currentCareerData.isGoalie ? l += '\n            <th class="season-col">Season</th>\n            <th class="league-col">League</th>\n            <th class="team-col">Team</th>\n            <th>GP</th>\n            <th>W</th>\n            <th>L</th>\n            <th>OTL</th>\n            <th>SV%</th>\n            <th>GAA</th>\n            <th>SO</th>\n        ' : l += '\n            <th class="season-col">Season</th>\n            <th class="league-col">League</th>\n            <th class="team-col">Team</th>\n            <th>GP</th>\n            <th>G</th>\n            <th>A</th>\n            <th>PTS</th>\n            <th>+/-</th>\n            <th>PIM</th>\n            <th>SOG</th>\n        ', l += "</tr></thead><tbody>", s.forEach(t => {
            l += "<tr>", l += `<td class="season-col">${t.season}</td>`, l += `<td class="league-col">${t.league}</td>`, l += `<td class="team-col">${t.team||"-"}</td>`, l += `<td>${t.gp}</td>`, currentCareerData.isGoalie ? l += `\n                <td>${t.wins}</td>\n                <td>${t.losses}</td>\n                <td>${t.otLosses}</td>\n                <td>${t.savePct?t.savePct.toFixed(3):"0.000"}</td>\n                <td>${t.gaa?t.gaa.toFixed(2):"0.00"}</td>\n                <td>${t.shutouts}</td>\n            ` : l += `\n                <td>${t.goals}</td>\n                <td>${t.assists}</td>\n                <td>${t.points}</td>\n                <td>${t.plusMinus>=0?"+"+t.plusMinus:t.plusMinus}</td>\n                <td>${t.pim}</td>\n                <td>${t.shots}</td>\n            `, l += "</tr>"
        }), "nhl" === t && s.length > 0) {
        const t = {
            gp: 0,
            goals: 0,
            assists: 0,
            points: 0,
            plusMinus: 0,
            pim: 0,
            shots: 0,
            wins: 0,
            losses: 0,
            otLosses: 0,
            shutouts: 0,
            gamesForAvg: 0,
            totalGAA: 0,
            totalSVPct: 0
        };
        if (s.forEach(e => {
                t.gp += e.gp || 0, currentCareerData.isGoalie ? (t.wins += e.wins || 0, t.losses += e.losses || 0, t.otLosses += e.otLosses || 0, t.shutouts += e.shutouts || 0, e.gaa && e.gp > 0 && (t.totalGAA += e.gaa * e.gp, t.gamesForAvg += e.gp), e.savePct && (t.totalSVPct += e.savePct)) : (t.goals += e.goals || 0, t.assists += e.assists || 0, t.points += e.points || 0, t.plusMinus += e.plusMinus || 0, t.pim += e.pim || 0, t.shots += e.shots || 0)
            }), l += '<tr class="career-totals-row">', l += '<td colspan="3" class="career-totals-label">Carrière</td>', l += `<td>${t.gp}</td>`, currentCareerData.isGoalie) {
            const e = t.gamesForAvg > 0 ? (t.totalGAA / t.gamesForAvg).toFixed(2) : "0.00",
                a = s.length > 0 ? (t.totalSVPct / s.length).toFixed(3) : "0.000";
            l += `\n                <td>${t.wins}</td>\n                <td>${t.losses}</td>\n                <td>${t.otLosses}</td>\n                <td>${a}</td>\n                <td>${e}</td>\n                <td>${t.shutouts}</td>\n            `
        } else l += `\n                <td>${t.goals}</td>\n                <td>${t.assists}</td>\n                <td>${t.points}</td>\n                <td>${t.plusMinus>=0?"+"+t.plusMinus:t.plusMinus}</td>\n                <td>${t.pim}</td>\n                <td>${t.shots}</td>\n            `;
        l += "</tr>"
    }
    l += "</tbody></table>", a.innerHTML = l
}

function closeCareerModal() {
    document.getElementById("careerStatsModal").style.display = "none", document.body.style.overflow = "", currentCareerData = null, currentGameLogData = null
}
let currentGameLogData = null,
    currentPlayerId = null;
async function handleViewChange() {
    const t = document.getElementById("viewFilter").value,
        e = document.querySelector(".filter-group-career:has(#leagueFilter)"),
        a = document.querySelector(".filter-group-career:has(#gameTypeFilter)"),
        n = document.getElementById("statsCountBadge");
    "gamelog" === t ? (e && (e.style.display = "none"), a && (a.style.display = "none"), n.style.display = "block", n.textContent = "Chargement...", await showGameLog(currentPlayerId)) : (e && (e.style.display = "flex"), a && (a.style.display = "flex"), filterCareerStats())
}
async function showGameLog(t) {
    try {
        const e = await fetch(`/player-gamelog/${t}`),
            a = await e.json();
        if (currentGameLogData = a, !a.gameLog || 0 === a.gameLog.length) return document.getElementById("careerStatsTable").innerHTML = '<p style="text-align: center; padding: 20px;">Aucun match joué cette saison.</p>', void(document.getElementById("statsCountBadge").textContent = "0 matchs");
        document.getElementById("statsCountBadge").textContent = `${a.gameLog.length} matchs`, renderGameLogTable(a.gameLog, a.playerInfo.isGoalie)
    } catch (t) {
        console.error("Error fetching game log:", t), document.getElementById("careerStatsTable").innerHTML = '<p style="text-align: center; padding: 20px; color: red;">Erreur lors du chargement des statistiques de match.</p>'
    }
}

function renderGameLogTable(t, e) {
    const a = document.getElementById("careerStatsTable");
    let n = "<table><thead><tr>";
    n += e ? "\n            <th>DATE</th>\n            <th>OPP</th>\n            <th>RÉS</th>\n            <th>DÉC</th>\n            <th>GA</th>\n            <th>SA</th>\n            <th>SV</th>\n            <th>SV%</th>\n            <th>BL</th>\n            <th>PUN</th>\n            <th>TG</th>\n        " : "\n            <th>DATE</th>\n            <th>OPP</th>\n            <th>RÉS</th>\n            <th>B</th>\n            <th>P</th>\n            <th>PTS</th>\n            <th>+/-</th>\n            <th>PUN</th>\n            <th>TIR</th>\n            <th>TG</th>\n            <th>PP</th>\n            <th>SH</th>\n        ", n += "</tr></thead><tbody>", t.forEach((t, a) => {
        const s = a % 2 == 0 ? "even-row" : "odd-row",
            l = "H" === t.homeRoadFlag ? "vs" : "@",
            o = new Date(t.gameDate).toLocaleDateString("fr-CA", {
                month: "2-digit",
                day: "2-digit"
            });
        if (n += `<tr class="${s}">`, n += `<td>${o}</td>`, n += `<td>${l} ${t.opponentAbbrev}</td>`, n += `<td>${t.gameResult||"-"}</td>`, e) {
            const e = t.shotsAgainst || 0,
                a = t.goalsAgainst || 0;
            let s = t.saves || 0;
            e > 0 && (!s || 0 === s) && (s = e - a);
            let l = "-";
            if (e > 0) {
                l = (s / e).toFixed(3)
            }
            n += `<td>${t.decision||"-"}</td>`, n += `<td>${a}</td>`, n += `<td>${e}</td>`, n += `<td>${s}</td>`, n += `<td>${l}</td>`, n += `<td>${t.shutouts||0}</td>`, n += `<td>${t.pim||0}</td>`, n += `<td>${t.toi||"0:00"}</td>`
        } else n += `<td>${t.goals||0}</td>`, n += `<td>${t.assists||0}</td>`, n += `<td>${t.points||0}</td>`, n += `<td>${t.plusMinus>=0?"+":""}${t.plusMinus||0}</td>`, n += `<td>${t.pim||0}</td>`, n += `<td>${t.shots||0}</td>`, n += `<td>${t.toi||"0:00"}</td>`, n += `<td>${t.powerPlayPoints||0}</td>`, n += `<td>${t.shorthandedPoints||0}</td>`;
        n += "</tr>"
    }), n += "</tbody></table>", a.innerHTML = n
}

function showSkeletonLoader() {
    const t = document.getElementById("tableSkeleton"),
        e = document.getElementById("actualTable");
    t && (t.style.display = "block"), e && (e.style.display = "none")
}

function hideSkeletonLoader() {
    const t = document.getElementById("tableSkeleton"),
        e = document.getElementById("actualTable");
    t && (t.style.display = "none"), e && (e.style.display = "block")
}

function showModalSkeleton() {
    const t = document.getElementById("modalSkeleton"),
        e = document.getElementById("careerModalHeader"),
        g = document.getElementById("careerNameBanner"),
        a = document.getElementById("careerFilters"),
        n = document.getElementById("careerStatsTable");
    t && (t.style.display = "block"), e && (e.style.display = "none"), g && (g.style.display = "none"), a && (a.style.display = "none"), n && (n.innerHTML = "")
}

function hideModalSkeleton() {
    const t = document.getElementById("modalSkeleton");
    t && (t.style.display = "none")
}

function toggleAdminDropdown(t) {
    t.preventDefault(), t.stopPropagation();
    document.getElementById("adminDropdown").classList.toggle("show")
}
async function loadAdminUsers() {
    try {
        const t = await fetch(`${BASE_URL}/admin-users?adminToken=admin`),
            e = await t.json();
        if (t.ok) {
            const t = e.users.filter(t => "admin" !== t).slice(0, 4),
                a = document.getElementById("adminUserList");
            0 === t.length ? a.innerHTML = '<div class="admin-no-users">Aucun utilisateur</div>' : a.innerHTML = t.map(t => `\n                    <a href="#" class="admin-dropdown-item" onclick="switchToUser(event, '${t}')">\n                        <span class="user-avatar">${t.charAt(0).toUpperCase()}</span>\n                        <span class="user-name">${t}</span>\n                    </a>\n                `).join("")
        }
    } catch (t) {
        console.error("Error loading users:", t), document.getElementById("adminUserList").innerHTML = '<div class="admin-no-users">Erreur</div>'
    }
}
async function switchToUser(t, e) {
    t.preventDefault(), t.stopPropagation();
    try {
        (await fetch(`${BASE_URL}/admin-switch-user`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                adminToken: "admin",
                targetUsername: e
            })
        })).ok ? (localStorage.setItem("username", e), localStorage.setItem("activeUser", e), window.location.reload()) : alert("Erreur lors du changement d'utilisateur")
    } catch (t) {
        console.error("Error switching user:", t), alert("Erreur de connexion")
    }
}

function logout(t) {
    t && t.preventDefault(), localStorage.removeItem("isLoggedIn"), localStorage.removeItem("username"), localStorage.removeItem("isAdmin"), localStorage.removeItem("activeUser"), location.reload()
}
document.getElementById("searchInput").addEventListener("input", updateTable), document.getElementById("playerFilter").addEventListener("change", updateTable), document.getElementById("sortBy").addEventListener("change", updateTable), fetchPlayerData(), $(document).ready(function() {
    const t = "true" === localStorage.getItem("isLoggedIn"),
        e = localStorage.getItem("username"),
        a = "true" === localStorage.getItem("isAdmin");
    t && (a ? ($("#admin-users-link").css("display", "block").html('\n                <div class="admin-dropdown-container">\n                    <a href="#" class="admin-dropdown-toggle" onclick="toggleAdminDropdown(event)">\n                        Utilisateur ▼\n                    </a>\n                    <div class="admin-dropdown-menu" id="adminDropdown">\n                        <div class="admin-dropdown-header">Changer d\'utilisateur</div>\n                        <div id="adminUserList" class="admin-user-list">Chargement...</div>\n                    </div>\n                </div>\n            '), $("#login-link").html(`<a href="#" onclick="logout(event)">Déconnexion (${e})</a>`), loadAdminUsers()) : $("#login-link").html(`<a href="#" onclick="logout(event)">Déconnexion (${e})</a>`))
}), document.addEventListener("click", function(t) {
    const e = document.getElementById("adminDropdown");
    e && !t.target.closest(".admin-dropdown-container") && e.classList.remove("show")
});