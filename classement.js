// ==================== GLOBAL STATE ====================

const NHL_ABBREV = {
    "Anaheim Ducks": "ANA", "Boston Bruins": "BOS", "Buffalo Sabres": "BUF",
    "Calgary Flames": "CGY", "Carolina Hurricanes": "CAR", "Chicago Blackhawks": "CHI",
    "Colorado Avalanche": "COL", "Columbus Blue Jackets": "CBJ", "Dallas Stars": "DAL",
    "Detroit Red Wings": "DET", "Edmonton Oilers": "EDM", "Florida Panthers": "FLA",
    "Los Angeles Kings": "LAK", "Minnesota Wild": "MIN", "Montréal Canadiens": "MTL",
    "Montreal Canadiens": "MTL", "Nashville Predators": "NSH", "New Jersey Devils": "NJD",
    "New York Islanders": "NYI", "New York Rangers": "NYR", "Ottawa Senators": "OTT",
    "Philadelphia Flyers": "PHI", "Pittsburgh Penguins": "PIT", "San Jose Sharks": "SJS",
    "Seattle Kraken": "SEA", "St. Louis Blues": "STL", "Tampa Bay Lightning": "TBL",
    "Toronto Maple Leafs": "TOR", "Utah Hockey Club": "UTA", "Vancouver Canucks": "VAN",
    "Vegas Golden Knights": "VGK", "Washington Capitals": "WSH", "Winnipeg Jets": "WPG"
};

function getDisplayName(teamKey, members) {
    if (/^Équipe \d+$/.test(teamKey) && members && members.length > 0) {
        const auto = members.join(' et ');
        if (auto.length <= 30) return auto;
    }
    return teamKey;
}

function getTeamLogoHTML(nhlTeams, size = 32) {
    if (!nhlTeams || nhlTeams.length === 0) return '';
    const abbrev = NHL_ABBREV[nhlTeams[0]];
    if (!abbrev) return '';
    return `<img src="teams/${abbrev}.png" alt="${nhlTeams[0]}" title="${nhlTeams[0]}"
        style="width:${size}px;height:${size}px;object-fit:contain;flex-shrink:0;"
        onerror="this.style.display='none'">`;
}

let fullPlayerData = [];
let goalieData = [];
let teamData = [];
let imageList = [];
let currentStats = null;
let currentTeams = null;
let currentCareerData = null;
let allPoolsData = {}; // Store all pools data
let currentPoolName = null; // Track current pool
let currentTeamName = null; // Track current team

const BASE_URL = window.location.hostname.includes('localhost')
    ? 'http://localhost:3000'
    : window.location.origin;

// ==================== NAVIGATION STATE ====================
const VIEW_STATES = {
    POOL_LIST: 'poolList',
    POOL_STANDINGS: 'poolStandings',
    TEAM_ROSTER: 'teamRoster'
};

let currentView = VIEW_STATES.POOL_LIST;
let currentH2HTab = 'matchups'; // 'matchups' | 'standings' | 'history'
let h2hWeekCache = null; // cached full-week matchup data
let h2hPeriod = 'today'; // 'today' | 'week'

// null sortKey = canonical rank order (points, or wins for H2H)
let standingsSortKey = null;
let standingsSortDir = 'desc';

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
    await fetchImageData();

    // Load player data
    const response = await fetch('nhl_filtered_stats.json');
    const data = await response.json();
    fullPlayerData = [...data.Top_50_Defenders, ...data.Top_100_Offensive_Players, ...data.Top_Rookies];
    goalieData = data.Top_50_Goalies;
    teamData = data.Teams;

    // Load current stats
    try {
        const statsResponse = await fetch(`${BASE_URL}/current-stats`, { cache: 'no-store' });
        currentStats = await statsResponse.json();
        console.log(`✅ Current stats loaded: ${currentStats.players.length} players`);
    } catch (error) {
        console.warn('⚠️ Could not load current stats:', error);
    }

    // Load current team standings
    try {
        const teamsResponse = await fetch(`${BASE_URL}/current-teams`, { cache: 'no-store' });
        currentTeams = await teamsResponse.json();
        console.log(`✅ Current team standings loaded: ${currentTeams.teams.length} teams`);
    } catch (error) {
        console.warn('⚠️ Could not load current team standings:', error);
    }

    // Charge le pool actif
    await loadAllUserPools();

    // Changer de pool depuis le rail rejoue le classement sur place.
    FZPool.on(() => loadAllUserPools());
});

// Le rail ne recharge pas la page : le classement se reconstruit seul.
window.FZ_POOL_EN_PLACE = true;

// ==================== DATA LOADING ====================
async function fetchImageData() {
    // Les photos viennent du CDN de la LNH (voir headshots.js) : rien à charger.
}

async function loadAllUserPools() {
    const username = localStorage.getItem('username');
    if (!username) {
        showError('Connexion requise', 'Veuillez vous connecter pour voir vos pools');
        return;
    }

    try {
        await FZPool.ready();
        allPoolsData = FZPool.all();

        const nomActif = FZPool.get();
        const pool = FZPool.mine().find(p => p.name === nomActif);

        if (!pool) {
            showError('Aucun pool actif',
                'Créez un pool ou rejoignez-en un pour suivre un classement.');
            return;
        }

        // Un classement sans effectif n'affiche que des zéros : mieux vaut
        // renvoyer vers le repêchage, qui est ce qui manque réellement.
        if (!FZPool.hasRoster(pool.teamData)) {
            showError('Repêchage à venir',
                `Le classement de « ${pool.name} » s'affichera une fois le repêchage terminé.`);
            return;
        }

        showPoolStandings(pool.name);
    } catch (error) {
        console.error('Error loading pools:', error);
        showError('Erreur', 'Impossible de charger votre pool');
    }
}

// ==================== VIEW RENDERING ====================

// Level 2: Pool Standings View
function showPoolStandings(poolName) {
    currentView = VIEW_STATES.POOL_STANDINGS;
    currentPoolName = poolName;
    currentTeamName = null;
    h2hWeekCache = null; // clear cache when switching pools
    standingsSortKey = null; // reset to canonical rank order for the new pool
    standingsSortDir = 'desc';

    const poolData = allPoolsData[poolName];
    if (!poolData) return;

    // Update UI — show pool image next to pool name in page title
    const poolImg = poolData.imageUrl
        ? `<img src="${poolData.imageUrl}" style="width:32px;height:32px;border-radius:8px;object-fit:cover;vertical-align:middle;margin-right:10px;" onerror="this.style.display='none'" alt="${poolName}">`
        : `<img src="Icons/grayGroup.png" style="width:32px;height:32px;border-radius:8px;object-fit:cover;vertical-align:middle;margin-right:10px;flex-shrink:0;" alt="${poolName}">`;
    document.getElementById('pageTitle').innerHTML = `${poolImg}${poolName}`;
    document.getElementById('breadcrumb').style.display = 'flex';
    document.getElementById('poolBreadcrumb').textContent = poolName;
    document.getElementById('poolBreadcrumb').style.display = 'inline';
    document.getElementById('poolBreadcrumbSep').style.display = 'inline';
    document.getElementById('teamBreadcrumb').style.display = 'none';
    document.getElementById('teamBreadcrumbSep').style.display = 'none';

    // Hide other views
    document.getElementById('poolListView').style.display = 'none';
    document.getElementById('poolStandingsView').style.display = 'block';
    document.getElementById('teamRosterView').style.display = 'none';

    const poolMode = poolData.poolMode || 'cumulative';
    const h2hTabs = document.getElementById('h2hTabs');
    const h2hMatchupsView = document.getElementById('h2hMatchupsView');
    const h2hHistoryView = document.getElementById('h2hHistoryView');

    if (poolMode === 'head-to-head') {
        // Show H2H tabs, default to matchups tab
        h2hTabs.style.display = 'flex';
        currentH2HTab = 'matchups';
        switchH2HTab('matchups');
        loadH2HCurrentWeek(poolName);
    } else {
        // Hide H2H elements for cumulative pools
        h2hTabs.style.display = 'none';
        h2hMatchupsView.style.display = 'none';
        h2hHistoryView.style.display = 'none';

        // Show skeleton initially
        document.getElementById('standingsSkeleton').style.display = 'flex';
        document.getElementById('standingsList').style.display = 'none';

        setTimeout(() => {
            renderPoolStandings(poolData, poolName).catch(console.error);
        }, 100);
    }
}

// Colonnes du tableau de classement, par mode de pool. `sort` doit
// correspondre à une clé numérique présente sur chaque objet `standing`
// construit dans renderPoolStandings (ex.: gamesPlayed, ppg, diff...).
// Les largeurs viennent de min-width en CSS (table-layout: auto) : sous une
// largeur de phone, la table déborde et le conteneur défile plutôt que de
// couper les nombres en plusieurs lignes.
function getStandingsColumns(poolMode) {
    if (poolMode === 'head-to-head') {
        return [
            { label: 'Pos', cls: 'rank-col' },
            { label: 'Participant', cls: 'player-col' },
            { label: 'PJ', sort: 'gamesPlayed', title: 'Parties jouées' },
            { label: 'V', sort: 'wins', title: 'Victoires' },
            { label: 'D', sort: 'losses', title: 'Défaites' },
            { label: 'N', sort: 'ties', title: 'Nuls' },
            { label: 'PTS', sort: 'points', cls: 'points-column', title: 'Points pour' },
            { label: 'Écart', sort: 'diff', title: 'Différentiel (pour - contre)' }
        ];
    }
    return [
        { label: 'Pos', cls: 'rank-col' },
        { label: 'Participant', cls: 'player-col' },
        { label: 'PJ', sort: 'gamesPlayed', title: 'Parties jouées' },
        { label: 'B', sort: 'goals', title: 'Buts' },
        { label: 'A', sort: 'assists', title: 'Passes décisives' },
        { label: 'PTS', sort: 'points', cls: 'points-column', title: 'Points de pool' },
        { label: 'Pts/PJ', sort: 'ppg', title: 'Points par partie jouée' },
        { label: 'Écart', title: 'Écart avec le premier' }
    ];
}

function buildStandingsHead(columns, activeSortKey) {
    const cells = columns.map(c => {
        const classes = [c.cls, c.sort ? 'sortable' : ''].filter(Boolean).join(' ');
        const active = c.sort && c.sort === activeSortKey;
        const caret = active ? `<span class="sort-caret" aria-hidden="true">${standingsSortDir === 'asc' ? '▲' : '▼'}</span>` : '';
        return `<th${classes ? ` class="${classes}${active ? ' is-sorted' : ''}"` : ''}`
            + (c.title ? ` title="${c.title}"` : '')
            + (c.sort ? ` data-sort="${c.sort}" role="button" tabindex="0"` : '')
            + (active ? ` aria-sort="${standingsSortDir === 'asc' ? 'ascending' : 'descending'}"` : '')
            + `>${c.label}${caret}</th>`;
    }).join('');
    return `<thead><tr>${cells}</tr></thead>`;
}

// Le rang réel (1/2/3/…) vient toujours du classement canonique par
// points/victoires, indépendamment de la colonne actuellement triée.
function rankBadgeHTML(rank) {
    let cls = 'normal';
    if (rank === 1) cls = 'gold';
    else if (rank === 2) cls = 'silver';
    else if (rank === 3) cls = 'bronze';
    return `<span class="st-rank-badge ${cls}">${rank}</span>`;
}

// Reclique un en-tête triable : inverse le sens si c'est déjà la colonne
// active, sinon repart en ordre décroissant sur la nouvelle colonne.
function handleStandingsSort(key) {
    if (standingsSortKey === key) {
        standingsSortDir = standingsSortDir === 'desc' ? 'asc' : 'desc';
    } else {
        standingsSortKey = key;
        standingsSortDir = 'desc';
    }
    const poolData = allPoolsData[currentPoolName];
    if (poolData) renderPoolStandings(poolData, currentPoolName).catch(console.error);
}

async function renderPoolStandings(poolData, poolName) {
    const poolMode = poolData.poolMode || 'cumulative';
    const standingsList = document.getElementById('standingsList');

    // Calcule le classement (ordre canonique = rang réel de chaque équipe).
    let standings = [];

    if (poolMode === 'head-to-head') {
        const h2hData = poolData.h2hData || {};
        const h2hStandings = h2hData.standings || {};

        standings = Object.entries(poolData.teams)
            .filter(([teamName, teamData]) => teamData.members && teamData.members.length > 0)
            .map(([teamName, teamData]) => {
                const h2hStats = h2hStandings[teamName] || { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
                const wins = h2hStats.wins || 0, losses = h2hStats.losses || 0, ties = h2hStats.ties || 0;
                const pointsFor = h2hStats.pointsFor || 0, pointsAgainst = h2hStats.pointsAgainst || 0;
                return {
                    teamName,
                    members: teamData.members,
                    nhlTeams: teamData.teams || [],
                    wins, losses, ties,
                    gamesPlayed: wins + losses + ties,
                    pointsFor, pointsAgainst,
                    points: pointsFor,
                    diff: pointsFor - pointsAgainst
                };
            })
            .sort((a, b) => (b.wins - a.wins) || (b.diff - a.diff));
    } else {
        standings = Object.entries(poolData.teams)
            .filter(([teamName, teamData]) => teamData.members && teamData.members.length > 0)
            .map(([teamName, teamData]) => {
                const teamPoints = calculateTeamPoints(teamData);
                return {
                    teamName,
                    members: teamData.members,
                    nhlTeams: teamData.teams || [],
                    ...teamPoints,
                    ppg: teamPoints.gamesPlayed > 0 ? teamPoints.points / teamPoints.gamesPlayed : 0
                };
            })
            .sort((a, b) => b.points - a.points);

        const leaderPoints = standings[0]?.points || 0;
        standings.forEach(s => { s.diff = leaderPoints - s.points; });
    }
    standings.forEach((s, i) => { s.rank = i + 1; });

    const columns = getStandingsColumns(poolMode);

    if (standings.length === 0) {
        standingsList.innerHTML = `
            <div class="standings-table-container">
                <div class="st-empty">
                    <p class="st-empty-title">Aucune équipe complète pour le moment</p>
                    <p class="st-empty-hint">Le classement apparaît une fois les équipes formées.</p>
                </div>
            </div>`;
        document.getElementById('standingsSkeleton').style.display = 'none';
        standingsList.style.display = 'block';
        return;
    }

    // Le tri d'affichage réordonne les rangées ; la colonne Pos garde
    // toujours le rang réel calculé plus haut. Sans tri explicite, l'ordre
    // canonique (déjà départagé par égalité) sert aussi d'indicateur —
    // l'en-tête PTS/Victoires s'affiche donc actif dès le premier rendu.
    const defaultSortKey = poolMode === 'head-to-head' ? 'wins' : 'points';
    const activeSortKey = standingsSortKey || defaultSortKey;
    let displayList = standings;
    if (standingsSortKey) {
        displayList = [...standings].sort((a, b) => {
            const delta = (b[standingsSortKey] || 0) - (a[standingsSortKey] || 0);
            return standingsSortDir === 'asc' ? -delta : delta;
        });
    }

    standingsList.innerHTML = `<div class="standings-table-container"><table id="standingsTable">${buildStandingsHead(columns, activeSortKey)}</table></div>`;
    const table = document.getElementById('standingsTable');

    const tbody = document.createElement('tbody');
    displayList.forEach(standing => {
        const displayName = getDisplayName(standing.teamName, standing.members);
        const logoHTML = getTeamLogoHTML(standing.nhlTeams, 22);

        const tr = document.createElement('tr');
        tr.className = 'is-clickable';
        tr.tabIndex = 0;
        tr.setAttribute('role', 'button');
        tr.setAttribute('aria-label', `Voir l'équipe de ${displayName}`);
        tr.onclick = () => showTeamRoster(poolName, standing.teamName);
        tr.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showTeamRoster(poolName, standing.teamName); }
        };

        const statCells = poolMode === 'head-to-head'
            ? `<td>${standing.gamesPlayed}</td>
               <td>${standing.wins}</td>
               <td>${standing.losses}</td>
               <td>${standing.ties}</td>
               <td class="points-column">${standing.points}</td>
               <td class="st-diff-col">${standing.diff > 0 ? '+' + standing.diff : standing.diff}</td>`
            : `<td>${standing.gamesPlayed}</td>
               <td>${standing.goals}</td>
               <td>${standing.assists}</td>
               <td class="points-column">${standing.points}</td>
               <td>${standing.ppg.toFixed(2)}</td>
               <td class="st-diff-col">${standing.rank === 1 ? '—' : standing.diff}</td>`;

        tr.innerHTML = `
            <td class="rank-col">${rankBadgeHTML(standing.rank)}</td>
            <td class="player-col">
                <div class="st-participant">
                    ${logoHTML}
                    <span class="st-name" title="${displayName}">${displayName}</span>
                </div>
            </td>
            ${statCells}
        `;
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    const n = standings.length;
    const avg = (key) => Math.round(standings.reduce((sum, s) => sum + (s[key] || 0), 0) / n);
    const tfoot = document.createElement('tfoot');
    const avgStatCells = poolMode === 'head-to-head'
        ? `<td>${avg('gamesPlayed')}</td>
           <td>${avg('wins')}</td>
           <td>${avg('losses')}</td>
           <td>${avg('ties')}</td>
           <td class="points-column">${avg('points')}</td>
           <td class="st-diff-col">—</td>`
        : `<td>${avg('gamesPlayed')}</td>
           <td>${avg('goals')}</td>
           <td>${avg('assists')}</td>
           <td class="points-column">${avg('points')}</td>
           <td>${avg('ppg')}</td>
           <td class="st-diff-col">—</td>`;
    tfoot.innerHTML = `
        <tr class="standings-avg-row">
            <td class="rank-col">—</td>
            <td class="player-col standings-avg-label">Moyenne</td>
            ${avgStatCells}
        </tr>
    `;
    table.appendChild(tfoot);

    // Délégation sur le conteneur : reconstruit à chaque tri, un écouteur
    // par <th> fuirait à chaque passe (comme initStatsHeaderSorting).
    standingsList.onclick = (e) => {
        const th = e.target.closest('th[data-sort]');
        if (th) handleStandingsSort(th.dataset.sort);
    };
    standingsList.onkeydown = (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const th = e.target.closest('th[data-sort]');
        if (!th) return;
        e.preventDefault();
        handleStandingsSort(th.dataset.sort);
    };

    document.getElementById('standingsSkeleton').style.display = 'none';
    standingsList.style.display = 'block';
}

// Level 3: Team Roster View
function showTeamRoster(poolName, teamName) {
    currentView = VIEW_STATES.TEAM_ROSTER;
    currentPoolName = poolName;
    currentTeamName = teamName;

    const poolData = allPoolsData[poolName];
    const teamData = poolData.teams[teamName];
    if (!teamData) return;

    // Update UI
    const displayTeamName = getDisplayName(teamName, teamData.members || []);
    document.getElementById('pageTitle').textContent = displayTeamName;
    document.getElementById('breadcrumb').style.display = 'flex';
    document.getElementById('poolBreadcrumb').textContent = poolName;
    document.getElementById('poolBreadcrumb').style.display = 'inline';
    document.getElementById('poolBreadcrumb').onclick = () => showPoolStandings(poolName);
    document.getElementById('poolBreadcrumbSep').style.display = 'inline';
    document.getElementById('teamBreadcrumb').textContent = displayTeamName;
    document.getElementById('teamBreadcrumb').style.display = 'inline';
    document.getElementById('teamBreadcrumbSep').style.display = 'inline';

    // Hide other views
    document.getElementById('poolListView').style.display = 'none';
    document.getElementById('poolStandingsView').style.display = 'none';
    document.getElementById('teamRosterView').style.display = 'block';

    // Show skeleton initially
    document.getElementById('rosterSkeleton').style.display = 'flex';
    document.getElementById('rosterList').style.display = 'none';

    // Render roster after short delay — fetch this team's active for-sale
    // listings first so the toggle starts in the right state on first paint.
    setTimeout(async () => {
        let activeListings = [];
        try {
            const res = await fetch(`${BASE_URL}/trade-listings/${encodeURIComponent(poolName)}`, { cache: 'no-store' });
            if (res.ok) {
                const listings = await res.json();
                activeListings = listings.filter(l => l.teamName === teamName);
            }
        } catch (err) {
            console.warn('Could not load trade listings:', err);
        }
        renderTeamRoster(teamData, activeListings);
    }, 100);
}

// Lists or unlists a player as "open to offers" — a visibility signal
// only; the 1-for-1 same-category trade rule itself is unchanged.
async function toggleForSale(btn) {
    const playerName = btn.dataset.player;
    const category = btn.dataset.category;
    const isListed = btn.classList.contains('is-listed');
    const username = localStorage.getItem('username');
    if (!username) return;

    btn.disabled = true;
    try {
        if (isListed) {
            const res = await fetch(`${BASE_URL}/trade-listings/${btn.dataset.listingId}/remove`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                alert(data.message || 'Impossible de retirer ce joueur de la vente.');
                return;
            }
            btn.classList.remove('is-listed');
            btn.dataset.listingId = '';
        } else {
            const res = await fetch(`${BASE_URL}/trade-listings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    poolName: currentPoolName,
                    teamName: currentTeamName,
                    playerName,
                    category,
                    username
                })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.message || 'Impossible de mettre ce joueur en vente.');
                return;
            }
            btn.classList.add('is-listed');
            btn.dataset.listingId = data.id;
        }
        const label = btn.querySelector('.fst-label');
        if (label) label.textContent = btn.classList.contains('is-listed') ? 'Retirer de la vente' : 'Mettre en vente';
    } catch (err) {
        console.error('Error toggling trade listing:', err);
        alert('Erreur de connexion au serveur.');
    } finally {
        btn.disabled = false;
    }
}

function renderTeamRoster(roster, activeListings = []) {
    const rosterList = document.getElementById('rosterList');
    rosterList.innerHTML = '';

    // Only the roster's own team can list/unlist its players. category
    // matches the vocabulary /trade/propose already validates against.
    const currentUsername = localStorage.getItem('username');
    const isOwner = (roster.members || []).includes(currentUsername);
    const listingByPlayer = {};
    activeListings.forEach(l => { listingByPlayer[l.playerName] = l; });

    const players = [];

    // Add offensive players
    (roster.offensive || []).forEach(playerName => {
        const playerData = fullPlayerData.find(p => p.skaterFullName === playerName);
        if (playerData) {
            const stats = getCurrentPlayerStats(playerName, playerData.playerId);
            players.push({
                name: playerName,
                position: playerData.positionCode || 'F',
                type: 'player',
                category: 'offensive',
                playerId: playerData.playerId,
                stats: stats,
                cached: playerData,
                teamAbbrev: stats?.teamAbbrev || playerData.teamAbbrevs
            });
        }
    });

    // Add defensive players
    (roster.defensive || []).forEach(playerName => {
        const playerData = fullPlayerData.find(p => p.skaterFullName === playerName);
        if (playerData) {
            const stats = getCurrentPlayerStats(playerName, playerData.playerId);
            players.push({
                name: playerName,
                position: playerData.positionCode || 'D',
                type: 'player',
                category: 'defensive',
                playerId: playerData.playerId,
                stats: stats,
                cached: playerData,
                teamAbbrev: stats?.teamAbbrev || playerData.teamAbbrevs
            });
        }
    });

    // Add goalies
    (roster.goalie || []).forEach(playerName => {
        const playerData = goalieData.find(p => p.goalieFullName === playerName);
        if (playerData) {
            const stats = getCurrentPlayerStats(playerName, playerData.playerId);
            players.push({
                name: playerName,
                position: 'G',
                type: 'goalie',
                category: 'goalie',
                playerId: playerData.playerId,
                stats: stats,
                cached: playerData,
                teamAbbrev: stats?.teamAbbrev || playerData.teamAbbrevs
            });
        }
    });

    // Add rookies
    (roster.rookie || []).forEach(playerName => {
        const playerData = fullPlayerData.find(p => p.skaterFullName === playerName);
        if (playerData) {
            const stats = getCurrentPlayerStats(playerName, playerData.playerId);
            players.push({
                name: playerName,
                position: playerData.positionCode || 'R',
                type: 'player',
                category: 'rookie',
                playerId: playerData.playerId,
                stats: stats,
                cached: playerData,
                teamAbbrev: stats?.teamAbbrev || playerData.teamAbbrevs
            });
        }
    });

    // Add teams
    (roster.teams || []).forEach(teamName => {
        const teamInfo = teamData.find(t => t.teamFullName === teamName);
        if (teamInfo) {
            const stats = getCurrentTeamStats(teamName);
            players.push({
                name: teamName,
                position: 'TEAM',
                type: 'team',
                category: 'team',
                stats: stats,
                cached: teamInfo,
                teamAbbrev: stats?.teamAbbrev || teamInfo.teamAbbrevs
            });
        }
    });

    // Render player cards
    players.forEach((player, index) => {
        const card = document.createElement('div');
        card.className = 'roster-card';

        // Only make clickable if it has a playerId (not teams)
        if (player.playerId) {
            card.classList.add('clickable');
            card.onclick = () => showCareerStats(player.playerId, player.name, player.type === 'goalie');
        }

        const pickNumber = index + 1;

        // Get player image
        let imageHTML = '';
        if (player.type === 'team') {
            const teamLogo = `teams/${player.teamAbbrev}.png`;
            imageHTML = `<img src="${teamLogo}" alt="${player.name}" onerror="this.style.display='none'">`;
        } else {
            // Try multiple sources for player headshot
            let headshot = null;

            // 1. Try stats headshot
            if (player.stats?.headshot && !player.stats.headshot.includes('/teams/')) {
                headshot = player.stats.headshot;
            }

            // 2. Try NHL API headshot URL
            if (!headshot && player.playerId) {
                headshot = `https://assets.web.nhl.com/mugs/nhl/latest/${player.playerId}.png`;
            }

            // 3. Try local image list
            if (!headshot) {
                headshot = getMatchingImage(player.name);
            }

            if (headshot) {
                imageHTML = `<img src="${headshot}" alt="${player.name}" class="lazy-image" data-src="${headshot}" onerror="this.style.display='none'; this.nextElementSibling?.style?.display ? (this.nextElementSibling.style.display = 'flex') : null;">`;
            } else {
                imageHTML = `<div class="no-photo">${player.position}</div>`;
            }
        }

        // Calculate points
        let points = 0;
        let gp = 0;
        let stat1 = 0;
        let stat2 = 0;
        let stat1Label = 'B';
        let stat2Label = 'P';

        if (player.type === 'goalie') {
            gp = player.stats?.gamesPlayed || player.cached.gamesPlayed || 0;
            const wins = player.stats?.wins || player.cached.wins || 0;
            const shutouts = player.stats?.shutouts || player.cached.shutouts || 0;
            const otLosses = player.stats?.otLosses || player.cached.otLosses || 0;
            points = 5 * shutouts + 2 * wins + otLosses;
            stat1 = wins;
            stat2 = shutouts;
            stat1Label = 'V';
            stat2Label = 'BL';
        } else if (player.type === 'team') {
            gp = player.stats?.gamesPlayed || player.cached.gamesPlayed || 0;
            const wins = player.stats?.wins || player.cached.wins || 0;
            const otLosses = player.stats?.otLosses || player.cached.otLosses || 0;
            points = 2 * wins + otLosses;
            stat1 = wins;
            stat2 = otLosses;
            stat1Label = 'V';
            stat2Label = 'DP';
        } else {
            gp = player.stats?.gamesPlayed || player.cached.gamesPlayed || 0;
            stat1 = player.stats?.goals || player.cached.goals || 0;
            stat2 = player.stats?.assists || player.cached.assists || 0;
            points = player.stats?.points || player.cached.points || 0;
        }

        // Get team abbreviation for display
        const teamAbbrev = player.teamAbbrev || '';

        // Only the roster's own team sees the list/unlist toggle.
        const existingListing = listingByPlayer[player.name];
        const isListed = !!existingListing;
        const sellToggleHTML = isOwner ? `
                <button type="button" class="for-sale-toggle${isListed ? ' is-listed' : ''}"
                        data-player="${player.name.replace(/"/g, '&quot;')}"
                        data-category="${player.category || ''}"
                        data-listing-id="${isListed ? existingListing.id : ''}"
                        onclick="event.stopPropagation(); toggleForSale(this)">
                    ${typeof getIcon === 'function' ? getIcon('tag', 14) : ''}
                    <span class="fst-label">${isListed ? 'Retirer de la vente' : 'Mettre en vente'}</span>
                </button>` : '';

        card.innerHTML = `
            <div class="pick-number">${pickNumber}</div>
            <div class="player-avatar">
                ${imageHTML}
            </div>
            <div class="roster-info">
                <div class="player-name-row">
                    <span class="player-name">${player.name}</span>
                    <span class="player-team-abbrev">${teamAbbrev}</span>
                    <span class="player-position">${player.position}</span>
                </div>
                <div class="player-stats-grid">
                    <div class="stats-row-top">
                        <span>${gp}</span>
                        <span>${stat1}</span>
                        <span>${stat2}</span>
                        <span>${points}</span>
                    </div>
                    <div class="stats-row-bottom">
                        <span>PJ</span>
                        <span>${stat1Label}</span>
                        <span>${stat2Label}</span>
                        <span>Pts</span>
                    </div>
                </div>
                ${sellToggleHTML}
            </div>
            <div class="roster-points-section">
                <div class="pptsa-value">0</div>
                <div class="pptsa-label">PPtsA</div>
            </div>
            <div class="roster-points-section">
                <div class="ppts-value">${points}</div>
                <div class="ppts-label">PPts</div>
            </div>
            <div class="roster-arrow">›</div>
        `;

        rosterList.appendChild(card);
    });

    // Hide skeleton, show content
    document.getElementById('rosterSkeleton').style.display = 'none';
    rosterList.style.display = 'flex';
}

// ==================== NAVIGATION HELPERS ====================
// Le classement porte sur le pool actif : « revenir en arrière » veut
// dire revenir au classement de ce pool, pas à une liste de pools.
function showPoolList() {
    const username = localStorage.getItem('username');
    if (!username) return;
    loadAllUserPools();
}

// ==================== UTILITY FUNCTIONS ====================
function getMatchingImage(playerName) {
    return resolveHeadshotByName(playerName);
}

function getCurrentPlayerStats(playerName, playerId) {
    if (!currentStats || !currentStats.players) return null;

    // Try to find by playerId first
    if (playerId) {
        const byId = currentStats.players.find(p => p.playerId === playerId);
        if (byId) return byId;
    }

    // Fallback to name match
    return currentStats.players.find(p => p.playerName === playerName);
}

function getCurrentTeamStats(teamName) {
    if (!currentTeams || !currentTeams.teams) return null;
    return currentTeams.teams.find(t => t.teamFullName === teamName);
}

function calculateTeamPoints(roster) {
    let totalGP = 0;
    let totalGoals = 0;
    let totalAssists = 0;
    let totalPoints = 0;

    // Process skaters
    ['offensive', 'defensive', 'rookie'].forEach(position => {
        (roster[position] || []).forEach(playerName => {
            const playerData = fullPlayerData.find(p => p.skaterFullName === playerName);
            if (playerData) {
                const stats = getCurrentPlayerStats(playerName, playerData.playerId);
                totalGP += stats?.gamesPlayed || playerData.gamesPlayed || 0;
                totalGoals += stats?.goals || playerData.goals || 0;
                totalAssists += stats?.assists || playerData.assists || 0;
                totalPoints += stats?.points || playerData.points || 0;
            }
        });
    });

    // Process goalies
    (roster.goalie || []).forEach(playerName => {
        const playerData = goalieData.find(p => p.goalieFullName === playerName);
        if (playerData) {
            const stats = getCurrentPlayerStats(playerName, playerData.playerId);
            const gp = stats?.gamesPlayed || playerData.gamesPlayed || 0;
            const wins = stats?.wins || playerData.wins || 0;
            const shutouts = stats?.shutouts || playerData.shutouts || 0;
            const otLosses = stats?.otLosses || playerData.otLosses || 0;
            const points = 5 * shutouts + 2 * wins + otLosses;

            totalGP += gp;
            totalPoints += points;
        }
    });

    // Process teams
    (roster.teams || []).forEach(teamName => {
        const teamInfo = teamData.find(t => t.teamFullName === teamName);
        if (teamInfo) {
            const stats = getCurrentTeamStats(teamName);
            const gp = stats?.gamesPlayed || teamInfo.gamesPlayed || 0;
            const wins = stats?.wins || teamInfo.wins || 0;
            const otLosses = stats?.otLosses || teamInfo.otLosses || 0;
            const points = 2 * wins + otLosses;

            totalGP += gp;
            totalPoints += points;
        }
    });

    return {
        gamesPlayed: totalGP,
        goals: totalGoals,
        assists: totalAssists,
        points: totalPoints
    };
}

function setH2HPeriod(period) {
    h2hPeriod = period;
    document.getElementById('filterToday').classList.toggle('active', period === 'today');
    document.getElementById('filterWeek').classList.toggle('active', period === 'week');
    if (currentPoolName) renderH2HMatchupsForPeriod(currentPoolName);
}

// ==================== H2H SHARED HELPERS ====================

function playerHeadshot(playerId, teamAbbrev) {
    if (!playerId || !teamAbbrev) return null;
    return `https://assets.nhle.com/mugs/nhl/20252026/${teamAbbrev}/${playerId}.png`;
}

function buildMatchupCardHTML(m, poolName, showRecord) {
    const t1Leading = m.team1Points > m.team2Points;
    const t2Leading = m.team2Points > m.team1Points;
    const standings = (allPoolsData[poolName] && allPoolsData[poolName].h2hData && allPoolsData[poolName].h2hData.standings) || {};

    const recordHTML = (teamName) => {
        if (!showRecord) return '';
        const s = standings[teamName] || { wins: 0, losses: 0, ties: 0 };
        const pts = s.wins * 2 + s.ties;
        return `<div class="h2h-team-record">${s.wins}V-${s.losses}D-${s.ties}N · ${pts}PTS</div>`;
    };

    const t1p = m.team1Players || [];
    const t2p = m.team2Players || [];
    const maxRows = Math.max(t1p.length, t2p.length);
    let playerRowsHTML = '';

    for (let i = 0; i < maxRows; i++) {
        const lp = t1p[i];
        const rp = t2p[i];
        const lpFpts = lp ? lp.fantasyPoints : null;
        const rpFpts = rp ? rp.fantasyPoints : null;
        const lpBetter = lpFpts !== null && rpFpts !== null && lpFpts > rpFpts;
        const rpBetter = lpFpts !== null && rpFpts !== null && rpFpts > lpFpts;

        const lpSub = lp ? (lp.position === 'G'
            ? `${lp.wins}V ${lp.saves}ARR${lp.shutouts ? ' ' + lp.shutouts + 'BL' : ''}`
            : `${lp.goals}B ${lp.assists}A`) : '';
        const rpSub = rp ? (rp.position === 'G'
            ? `${rp.wins}V ${rp.saves}ARR${rp.shutouts ? ' ' + rp.shutouts + 'BL' : ''}`
            : `${rp.goals}B ${rp.assists}A`) : '';

        const lpPhoto = lp ? playerHeadshot(lp.playerId, lp.teamAbbrev) : null;
        const rpPhoto = rp ? playerHeadshot(rp.playerId, rp.teamAbbrev) : null;

        playerRowsHTML += `
            <div class="h2h-player-row">
                <div class="h2h-player-left ${lpBetter ? 'h2h-player-winning' : ''}">
                    ${lpPhoto ? `<img class="h2h-player-photo" src="${lpPhoto}" alt="" onerror="this.style.display='none'">` : '<div class="h2h-player-photo-placeholder"></div>'}
                    <div class="h2h-player-info">
                        <span class="h2h-player-name">${lp ? lp.name : ''}</span>
                        ${lp ? `<span class="h2h-player-sub">${lpSub}</span>` : ''}
                    </div>
                </div>
                <div class="h2h-player-pts-block">
                    <span class="h2h-player-pts ${lpBetter ? 'h2h-pts-leading' : ''}">${lpFpts !== null ? lpFpts.toFixed(1) : '—'}</span>
                    <span class="h2h-player-sep">·</span>
                    <span class="h2h-player-pts ${rpBetter ? 'h2h-pts-leading' : ''}">${rpFpts !== null ? rpFpts.toFixed(1) : '—'}</span>
                </div>
                <div class="h2h-player-right ${rpBetter ? 'h2h-player-winning' : ''}">
                    ${rpPhoto ? `<img class="h2h-player-photo" src="${rpPhoto}" alt="" onerror="this.style.display='none'">` : '<div class="h2h-player-photo-placeholder"></div>'}
                    <div class="h2h-player-info right">
                        <span class="h2h-player-name">${rp ? rp.name : ''}</span>
                        ${rp ? `<span class="h2h-player-sub">${rpSub}</span>` : ''}
                    </div>
                </div>
            </div>`;
    }

    return `
        <div class="h2h-matchup-card">
            <div class="h2h-matchup-header">
                <div class="h2h-header-team ${t1Leading ? 'leading' : ''}">
                    <div class="h2h-header-team-name">${m.team1}</div>
                    ${recordHTML(m.team1)}
                    <div class="h2h-header-score ${t1Leading ? 'leading' : ''}">${m.team1Points.toFixed(1)}</div>
                </div>
                <div class="h2h-header-vs">VS</div>
                <div class="h2h-header-team right ${t2Leading ? 'leading' : ''}">
                    <div class="h2h-header-team-name">${m.team2}</div>
                    ${recordHTML(m.team2)}
                    <div class="h2h-header-score ${t2Leading ? 'leading' : ''}">${m.team2Points.toFixed(1)}</div>
                </div>
            </div>
            <div class="h2h-players-list">
                <div class="h2h-players-header">
                    <span>${m.team1}</span>
                    <span>FPTS</span>
                    <span>${m.team2}</span>
                </div>
                ${playerRowsHTML || '<div class="h2h-no-players">Aucun joueur à afficher</div>'}
            </div>
        </div>`;
}

// Classement tab: full week matchups with photos + records
async function renderH2HStandingsWithMatchups(poolName) {
    const standingsList = document.getElementById('standingsList');
    standingsList.innerHTML = '<div class="h2h-loading">Chargement des duels...</div>';
    standingsList.style.display = 'flex';
    document.getElementById('standingsSkeleton').style.display = 'none';

    try {
        // Use cached data if available, otherwise fetch
        if (!h2hWeekCache || h2hWeekCache.poolName !== poolName) {
            const res = await fetch(`${BASE_URL}/h2h/current-week-scores?poolName=${encodeURIComponent(poolName)}`, { cache: 'no-store' });
            const data = await res.json();
            h2hWeekCache = { poolName, data };
        }
        const data = h2hWeekCache.data;

        if (!data.matchups || data.matchups.length === 0) {
            standingsList.innerHTML = '<div class="h2h-empty">Aucun duel cette semaine</div>';
            return;
        }

        standingsList.innerHTML = data.matchups.map(m => buildMatchupCardHTML(m, poolName, true)).join('');
    } catch (err) {
        console.error('Error loading H2H standings matchups:', err);
        standingsList.innerHTML = '<div class="h2h-empty">Erreur lors du chargement</div>';
    }
}

// ==================== H2H TAB SWITCHING & RENDERING ====================
function switchH2HTab(tab) {
    currentH2HTab = tab;

    // Update tab active states
    document.querySelectorAll('.h2h-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });

    // Show/hide sections
    document.getElementById('h2hMatchupsView').style.display = (tab === 'matchups') ? 'block' : 'none';
    document.getElementById('standingsSkeleton').style.display = 'none';
    document.getElementById('standingsList').style.display = (tab === 'standings') ? 'block' : 'none';
    document.getElementById('h2hHistoryView').style.display = (tab === 'history') ? 'block' : 'none';

    if (tab === 'standings' && currentPoolName) {
        const poolData = allPoolsData[currentPoolName];
        if (poolData) renderPoolStandings(poolData, currentPoolName);
    }

    if (tab === 'history' && currentPoolName) {
        renderH2HHistory(currentPoolName);
    }
}

async function loadH2HCurrentWeek(poolName) {
    // Reset to today filter when entering the tab
    h2hPeriod = 'today';
    document.getElementById('filterToday').classList.add('active');
    document.getElementById('filterWeek').classList.remove('active');

    const weekHeader = document.getElementById('h2hWeekHeader');
    weekHeader.innerHTML = '';

    await renderH2HMatchupsForPeriod(poolName);
}

async function renderH2HMatchupsForPeriod(poolName) {
    const matchupsList = document.getElementById('h2hMatchupsList');
    const weekHeader = document.getElementById('h2hWeekHeader');
    matchupsList.innerHTML = '<div class="h2h-loading">Chargement...</div>';

    try {
        let data;
        if (h2hPeriod === 'today') {
            const res = await fetch(`${BASE_URL}/h2h/today-scores?poolName=${encodeURIComponent(poolName)}`, { cache: 'no-store' });
            if (!res.ok) throw new Error('Failed');
            data = await res.json();

            const today = new Date();
            const dateLabel = today.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
            weekHeader.innerHTML = `
                <div class="h2h-week-label">Semaine ${data.currentWeek} <span class="h2h-week-status status-ongoing">🔴 EN COURS</span></div>
                <div class="h2h-week-dates">Aujourd'hui — ${data.date || dateLabel}</div>`;
        } else {
            // Use cache if available
            if (!h2hWeekCache || h2hWeekCache.poolName !== poolName) {
                const res = await fetch(`${BASE_URL}/h2h/current-week-scores?poolName=${encodeURIComponent(poolName)}`, { cache: 'no-store' });
                if (!res.ok) throw new Error('Failed');
                data = await res.json();
                h2hWeekCache = { poolName, data };
            } else {
                data = h2hWeekCache.data;
            }

            let dateRange = 'Semaine en cours';
            if (data.weekStart && data.weekEnd) {
                const fmt = d => new Date(d).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
                dateRange = `${fmt(data.weekStart)} – ${fmt(data.weekEnd)}`;
            }
            const statusMap = { upcoming: '📅 À VENIR', ongoing: '🔴 EN COURS', completed: '✓ TERMINÉE' };
            const statusClass = { upcoming: 'status-upcoming', ongoing: 'status-ongoing', completed: 'status-completed' };
            const ws = data.weekStatus || 'ongoing';
            weekHeader.innerHTML = `
                <div class="h2h-week-label">Semaine ${data.currentWeek} <span class="h2h-week-status ${statusClass[ws] || ''}">${statusMap[ws] || ''}</span></div>
                <div class="h2h-week-dates">${dateRange}</div>`;
        }

        if (!data.matchups || data.matchups.length === 0) {
            matchupsList.innerHTML = '<div class="h2h-empty">Aucun duel cette semaine</div>';
            return;
        }

        matchupsList.innerHTML = data.matchups.map(m => buildMatchupCardHTML(m, poolName, false)).join('');

    } catch (err) {
        console.error('Error loading H2H matchups:', err);
        matchupsList.innerHTML = '<div class="h2h-empty">Erreur lors du chargement</div>';
    }
}

function renderH2HHistory(poolName) {
    const historyList = document.getElementById('h2hHistoryList');
    const poolData = allPoolsData[poolName];

    if (!poolData || !poolData.h2hData || !poolData.h2hData.matchupHistory || poolData.h2hData.matchupHistory.length === 0) {
        historyList.innerHTML = '<div class="h2h-empty">Aucun historique disponible</div>';
        return;
    }

    const history = [...poolData.h2hData.matchupHistory].reverse(); // Newest first

    historyList.innerHTML = history.map(week => {
        const weekStart = week.weekStart ? new Date(week.weekStart) : null;
        const weekEnd = week.weekEnd ? new Date(week.weekEnd) : null;
        const formatDate = d => d ? d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }) : '';
        const dateRange = weekStart && weekEnd ? `${formatDate(weekStart)} - ${formatDate(weekEnd)}` : '';

        const matchupsHTML = week.matchups.map(m => {
            const isT1Winner = m.winner === m.team1;
            const isT2Winner = m.winner === m.team2;
            const isTie = m.winner === 'tie';
            return `
                <div class="h2h-history-matchup">
                    <span class="h2h-hist-team ${isT1Winner ? 'winner' : ''}">${m.team1}</span>
                    <span class="h2h-hist-score">
                        <span class="${isT1Winner ? 'winner' : ''}">${(m.team1Points || 0).toFixed(1)}</span>
                        <span class="h2h-hist-sep">${isTie ? '=' : '-'}</span>
                        <span class="${isT2Winner ? 'winner' : ''}">${(m.team2Points || 0).toFixed(1)}</span>
                    </span>
                    <span class="h2h-hist-team ${isT2Winner ? 'winner' : ''}">${m.team2}</span>
                </div>
            `;
        }).join('');

        return `
            <div class="h2h-history-week">
                <div class="h2h-history-header" onclick="this.parentElement.classList.toggle('collapsed')">
                    <span class="h2h-history-title">Semaine ${week.weekNumber}</span>
                    <span class="h2h-history-dates">${dateRange}</span>
                    <span class="h2h-history-chevron">&#9660;</span>
                </div>
                <div class="h2h-history-body">
                    ${matchupsHTML}
                </div>
            </div>
        `;
    }).join('');
}

function getTeamMembers(poolName, teamName) {
    const poolData = allPoolsData[poolName];
    if (!poolData || !poolData.teams[teamName]) return '';
    return (poolData.teams[teamName].members || []).join(', ');
}

async function finalizeCurrentWeek() {
    const btn = document.getElementById('h2hFinalizeBtn');
    const poolName = btn.dataset.poolName;
    if (!poolName) return;

    if (!confirm(`Voulez-vous finaliser la semaine en cours pour "${poolName}" ?`)) return;

    btn.disabled = true;
    btn.textContent = 'Finalisation...';

    try {
        const res = await fetch(`${BASE_URL}/h2h/finalize-week`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ poolName })
        });

        const data = await res.json();

        if (!res.ok) {
            alert(data.message || 'Erreur lors de la finalisation');
            return;
        }

        alert(`Semaine ${data.previousWeek} finalisee! Semaine ${data.currentWeek} commencee.`);

        // Reload pool data and refresh
        await loadAllUserPools();
        showPoolStandings(poolName);

    } catch (error) {
        console.error('Error finalizing week:', error);
        alert('Erreur lors de la finalisation');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Finaliser la semaine';
    }
}

function showError(title, message) {
    // Le message remplace ce qui est à l'écran : sans ce ménage, le
    // classement du pool précédent resterait visible sous l'erreur.
    document.getElementById('poolListView').style.display = 'block';
    document.getElementById('poolStandingsView').style.display = 'none';
    document.getElementById('teamRosterView').style.display = 'none';
    document.getElementById('breadcrumb').style.display = 'none';
    document.getElementById('pageTitle').textContent = 'Classement';

    const poolList = document.getElementById('poolList');
    poolList.style.display = 'block';
    poolList.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
            <div style="font-size: 4rem; margin-bottom: 20px;">📊</div>
            <h2 style="font-size: 1.8rem; color: var(--text-main); margin-bottom: 12px;">${title}</h2>
            <p style="font-size: 1.1rem; color: var(--text-secondary);">${message}</p>
        </div>
    `;
    document.getElementById('poolListSkeleton').style.display = 'none';
}

// ==================== CAREER STATS MODAL ====================
async function showCareerStats(playerId, playerName, isGoalie = false) {
    const modal = document.getElementById('careerStatsModal');
    const header = document.getElementById('careerModalHeader');
    const spinner = document.getElementById('loadingSpinner');
    const filters = document.getElementById('careerFilters');
    const statsTable = document.getElementById('careerStatsTable');

    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';

    // Show spinner
    spinner.style.display = 'block';
    header.style.display = 'none';
    filters.style.display = 'none';
    statsTable.innerHTML = '';

    // Reset filters
    document.getElementById('leagueFilter').value = 'nhl';
    document.getElementById('gameTypeFilter').value = 'regular';

    try {
        const response = await fetch(`${BASE_URL}/player-career/${playerId}`);
        if (!response.ok) throw new Error('Failed to fetch career stats');

        const data = await response.json();
        currentCareerData = data;

        // Hide spinner, show content
        spinner.style.display = 'none';
        header.style.display = 'flex';
        filters.style.display = 'flex';

        // Populate header
        document.getElementById('careerPlayerName').textContent = data.playerName;
        document.getElementById('careerPlayerPosition').textContent = data.isGoalie ? '🥅 Gardien de but' : '🏒 ' + (data.position || 'Joueur');

        if (data.currentTeam) {
            const teamLogo = `teams/${data.currentTeam.split(' ').pop()}.png`;
            document.getElementById('careerPlayerTeam').innerHTML = `<img src="${teamLogo}" alt="${data.currentTeam}" style="width: 24px; height: 24px; vertical-align: middle; margin-right: 8px;">${data.currentTeam}`;
        } else {
            document.getElementById('careerPlayerTeam').textContent = '';
        }

        // Populate headshot
        const headshotContainer = document.getElementById('playerHeadshotContainer');
        if (data.headshot) {
            headshotContainer.innerHTML = `<img src="${data.headshot}" alt="${data.playerName}">`;
        } else {
            headshotContainer.innerHTML = '<div class="no-photo">🏒</div>';
        }

        // Populate bio
        document.getElementById('playerHeight').textContent = data.height || '-';
        document.getElementById('playerWeight').textContent = data.weight ? `${data.weight} lb` : '-';

        if (data.birthDate) {
            const birthDate = new Date(data.birthDate);
            const today = new Date();
            let age = today.getFullYear() - birthDate.getFullYear();
            const monthDiff = today.getMonth() - birthDate.getMonth();
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                age--;
            }
            document.getElementById('playerBirthDate').textContent = `${data.birthDate} (Âge: ${age})`;
        } else {
            document.getElementById('playerBirthDate').textContent = '-';
        }

        let birthPlace = '';
        if (data.birthCity) birthPlace += data.birthCity;
        if (data.birthStateProvince) birthPlace += (birthPlace ? ', ' : '') + data.birthStateProvince;
        if (data.birthCountry) birthPlace += (birthPlace ? ', ' : '') + data.birthCountry;
        document.getElementById('playerBirthPlace').textContent = birthPlace || '-';

        document.getElementById('playerShoots').textContent = data.shootsCatches || '-';

        if (data.draftInfo) {
            const draft = data.draftInfo;
            document.getElementById('playerDraft').textContent = `${draft.year}, ${draft.teamAbbrev} (${draft.overallPick}e au total), ${draft.round}e ronde, ${draft.pickInRound}e choix`;
        } else {
            document.getElementById('playerDraft').textContent = 'Non repêché';
        }

        // Render stats table
        filterCareerStats();

    } catch (error) {
        console.error('Error fetching career stats:', error);
        spinner.style.display = 'none';
        statsTable.innerHTML = '<p class="no-stats-message">❌ Erreur lors du chargement des statistiques</p>';
    }
}

function filterCareerStats() {
    if (!currentCareerData) return;

    const leagueFilter = document.getElementById('leagueFilter').value;
    const gameTypeFilter = document.getElementById('gameTypeFilter').value;
    const statsTable = document.getElementById('careerStatsTable');
    const countBadge = document.getElementById('statsCountBadge');

    // Filter seasons
    let filteredSeasons = currentCareerData.seasons.filter(season => {
        const leagueMatch = leagueFilter === 'all' ||
                           (leagueFilter === 'nhl' && season.league === 'NHL') ||
                           (leagueFilter === 'other' && season.league !== 'NHL');
        const gameTypeMatch = gameTypeFilter === 'all' ||
                             (gameTypeFilter === 'regular' && season.gameType === 'regular') ||
                             (gameTypeFilter === 'playoffs' && season.gameType === 'playoffs');
        return leagueMatch && gameTypeMatch;
    });

    countBadge.textContent = `${filteredSeasons.length} saison${filteredSeasons.length > 1 ? 's' : ''} affichée${filteredSeasons.length > 1 ? 's' : ''}`;

    if (filteredSeasons.length === 0) {
        statsTable.innerHTML = '<p class="no-stats-message">Aucune statistique correspondant aux filtres sélectionnés</p>';
        return;
    }

    // Build table
    let html = '<table><thead><tr>';

    if (currentCareerData.isGoalie) {
        html += `
            <th class="season-col">Season</th>
            <th class="league-col">League</th>
            <th class="team-col">Team</th>
            <th>GP</th>
            <th>W</th>
            <th>L</th>
            <th>OTL</th>
            <th>SV%</th>
            <th>GAA</th>
            <th>SO</th>
        `;
    } else {
        html += `
            <th class="season-col">Season</th>
            <th class="league-col">League</th>
            <th class="team-col">Team</th>
            <th>GP</th>
            <th>G</th>
            <th>A</th>
            <th>PTS</th>
            <th>+/-</th>
            <th>PIM</th>
            <th>SOG</th>
        `;
    }

    html += '</tr></thead><tbody>';

    filteredSeasons.forEach(season => {
        html += '<tr>';
        html += `<td class="season-col">${season.season}</td>`;
        html += `<td class="league-col">${season.league}</td>`;
        html += `<td class="team-col">${season.team ? `<img src="teams/${season.team}.png" alt="${season.team}" title="${season.team}" onerror="this.style.opacity='0.3'">` : '-'}</td>`;
        html += `<td>${season.gp}</td>`;

        if (currentCareerData.isGoalie) {
            html += `
                <td>${season.wins}</td>
                <td>${season.losses}</td>
                <td>${season.otLosses}</td>
                <td>${season.savePct ? season.savePct.toFixed(3) : '0.000'}</td>
                <td>${season.gaa ? season.gaa.toFixed(2) : '0.00'}</td>
                <td>${season.shutouts}</td>
            `;
        } else {
            html += `
                <td>${season.goals}</td>
                <td>${season.assists}</td>
                <td>${season.points}</td>
                <td>${season.plusMinus >= 0 ? '+' + season.plusMinus : season.plusMinus}</td>
                <td>${season.pim}</td>
                <td>${season.shots}</td>
            `;
        }

        html += '</tr>';
    });

    // Add career totals for NHL only
    if (leagueFilter === 'nhl' && filteredSeasons.length > 0) {
        const totals = {
            gp: 0, goals: 0, assists: 0, points: 0, plusMinus: 0, pim: 0, shots: 0,
            wins: 0, losses: 0, otLosses: 0, shutouts: 0, gamesForAvg: 0, totalGAA: 0, totalSVPct: 0
        };

        filteredSeasons.forEach(season => {
            totals.gp += season.gp || 0;
            if (currentCareerData.isGoalie) {
                totals.wins += season.wins || 0;
                totals.losses += season.losses || 0;
                totals.otLosses += season.otLosses || 0;
                totals.shutouts += season.shutouts || 0;
                if (season.gaa && season.gp > 0) {
                    totals.totalGAA += season.gaa * season.gp;
                    totals.gamesForAvg += season.gp;
                }
                if (season.savePct) {
                    totals.totalSVPct += season.savePct;
                }
            } else {
                totals.goals += season.goals || 0;
                totals.assists += season.assists || 0;
                totals.points += season.points || 0;
                totals.plusMinus += season.plusMinus || 0;
                totals.pim += season.pim || 0;
                totals.shots += season.shots || 0;
            }
        });

        html += '<tr class="career-totals-row">';
        html += '<td colspan="3" class="career-totals-label">Carrière</td>';
        html += `<td>${totals.gp}</td>`;

        if (currentCareerData.isGoalie) {
            const avgGAA = totals.gamesForAvg > 0 ? (totals.totalGAA / totals.gamesForAvg).toFixed(2) : '0.00';
            const avgSVPct = filteredSeasons.length > 0 ? (totals.totalSVPct / filteredSeasons.length).toFixed(3) : '0.000';
            html += `
                <td>${totals.wins}</td>
                <td>${totals.losses}</td>
                <td>${totals.otLosses}</td>
                <td>${avgSVPct}</td>
                <td>${avgGAA}</td>
                <td>${totals.shutouts}</td>
            `;
        } else {
            html += `
                <td>${totals.goals}</td>
                <td>${totals.assists}</td>
                <td>${totals.points}</td>
                <td>${totals.plusMinus >= 0 ? '+' + totals.plusMinus : totals.plusMinus}</td>
                <td>${totals.pim}</td>
                <td>${totals.shots}</td>
            `;
        }

        html += '</tr>';
    }

    html += '</tbody></table>';
    statsTable.innerHTML = html;
}

function closeCareerModal() {
    document.getElementById('careerStatsModal').style.display = 'none';
    document.body.style.overflow = '';
    currentCareerData = null;
}

// Close modal on outside click
window.onclick = function(event) {
    const modal = document.getElementById('careerStatsModal');
    if (event.target === modal) {
        closeCareerModal();
    }
};
