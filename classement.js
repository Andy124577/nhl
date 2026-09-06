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
let currentH2HTab = 'matchups'; // 'matchups' | 'standings' | 'calendrier' | 'history'
let h2hWeekCache = null; // cached full-week matchup data
let h2hPeriod = 'today'; // 'today' | 'week'

// null sortKey = canonical rank order (points, or wins for H2H)
let standingsSortKey = null;
let standingsSortDir = 'desc';

// La saison régulière est-elle commencée ? Renseigné par /season-window au
// chargement. Optimiste par défaut : si le calendrier ne répond pas, on
// affiche les statistiques plutôt que de masquer des matchs réels.
let seasonStarted = true;

/**
 * Une statistique de la saison EN COURS, jamais celle du repêchage.
 *
 * nhl_filtered_stats.json garde volontairement les totaux de l'an passé —
 * c'est la liste de repêchage, on choisit ses joueurs sur la saison écoulée.
 * Le classement, lui, ne compte que ce qui s'est joué cette saison. L'ancien
 * `stats?.points || cache.points` faisait le contraire dès que le total
 * courant valait 0 : un pool repêché en septembre s'ouvrait avec les 138
 * points de McDavid de l'an dernier. Un joueur présent dans currentStats fait
 * foi, zéro compris ; le cache ne sert que s'il en est absent.
 */
function seasonStat(stats, cached, key) {
    if (!seasonStarted) return 0;
    if (stats) return stats[key] || 0;
    return (cached && cached[key]) || 0;
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
    await fetchImageData();

    // Load player data
    const response = await fetch('nhl_filtered_stats.json');
    const data = await response.json();
    fullPlayerData = [...data.Top_50_Defenders, ...data.Top_100_Offensive_Players, ...data.Top_Rookies];
    goalieData = data.Top_50_Goalies;
    teamData = data.Teams;

    // Avant le premier match, tout vaut zéro : sans ce garde-fou, le
    // classement d'un pool repêché l'été affiche les totaux de l'an passé.
    try {
        const seasonResponse = await fetch(`${BASE_URL}/season-window`, { cache: 'no-store' });
        if (seasonResponse.ok) seasonStarted = (await seasonResponse.json()).hasStarted !== false;
    } catch (error) {
        console.warn('⚠️ Could not resolve season window:', error);
    }

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

        // Un classement pendant un repêchage encore ouvert n'affiche que des
        // effectifs partiels : mieux vaut renvoyer vers le repêchage, qui
        // est ce qui manque réellement, tant qu'il n'est pas terminé.
        const etatRepechage = FZPool.draftState(pool.data).etat;
        if (etatRepechage !== 'termine') {
            const messages = {
                attente: `« ${pool.name} » attend encore des joueurs avant que le repêchage puisse commencer.`,
                pret: `Le repêchage de « ${pool.name} » n'a pas encore commencé.`,
                encours: `Le repêchage de « ${pool.name} » est en cours. Le classement s'affichera une fois terminé.`
            };
            showError('Repêchage à venir',
                messages[etatRepechage] || `Le classement de « ${pool.name} » s'affichera une fois le repêchage terminé.`);
            return;
        }

        showPoolStandings(pool.name);

        // ?equipe=… ouvre directement la fiche d'une équipe. C'est par là
        // qu'arrive « Voir mes joueurs repêchés » (bannière de l'accueil,
        // accueil-dash.js) : une fois le repêchage terminé, c'est ici que
        // vivent les choix qu'on y a faits. Le classement reste dessous, le
        // fil d'Ariane y ramène.
        const equipeDemandee = new URLSearchParams(window.location.search).get('equipe');
        if (equipeDemandee && pool.data.teams && pool.data.teams[equipeDemandee]) {
            showTeamRoster(pool.name, equipeDemandee);
        }
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
    h2hScheduleCache = null; // idem pour le calendrier de saison
    h2hSchedTeam = null;
    standingsSortKey = null; // reset to canonical rank order for the new pool
    standingsSortDir = 'desc';
    standingsPeriod = 7; // reset rank-evolution period for the new pool
    periodPointsCache = null;

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

    // Reset on every pool switch — only the cumulative branch below re-shows
    // it, and a stale record from the previous pool must not linger.
    document.getElementById('hallOfFame').style.display = 'none';
    document.getElementById('recentFormLeaderboard').style.display = 'none';

    const poolMode = poolData.poolMode || 'cumulative';
    const h2hTabs = document.getElementById('h2hTabs');
    const h2hMatchupsView = document.getElementById('h2hMatchupsView');
    const h2hHistoryView = document.getElementById('h2hHistoryView');

    if (poolMode === 'head-to-head') {
        // ?h2h=calendrier ouvre directement le carrousel : c'est la cible du
        // bouton « Calendrier de la saison » de la bannière d'accueil, qui
        // annonce le prochain duel et doit pouvoir montrer les suivants.
        const ongletDemande = new URLSearchParams(window.location.search).get('h2h');
        const onglet = ['matchups', 'standings', 'calendrier', 'history'].includes(ongletDemande)
            ? ongletDemande : 'matchups';

        h2hTabs.style.display = 'flex';
        currentH2HTab = onglet;
        switchH2HTab(onglet);
        if (onglet === 'matchups') loadH2HCurrentWeek(poolName);
    } else {
        // Hide H2H elements for cumulative pools
        h2hTabs.style.display = 'none';
        h2hMatchupsView.style.display = 'none';
        h2hHistoryView.style.display = 'none';
        document.getElementById('h2hScheduleView').style.display = 'none';

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
        { label: 'P', sort: 'assists', title: 'Passes décisives' },
        { label: '1', cls: 'st-period-col', title: 'Points des dernières 24 heures' },
        { label: '7', cls: 'st-period-col', title: 'Points des 7 derniers jours' },
        { label: '30', cls: 'st-period-col', title: 'Points des 30 derniers jours' },
        { label: 'PPts', sort: 'points', cls: 'points-column', title: 'Points de pool' },
        { label: 'PPts/PJ', sort: 'ppg', title: 'Points par partie jouée' },
        { label: 'Rang', cls: 'st-evo-col', title: 'Évolution du rang depuis le début de la période sélectionnée' }
    ];
}

// ==================== RANG : ÉVOLUTION PAR PÉRIODE ====================
// Le rang (Pos) reste fixé par le total de la saison. Le badge en bout de
// ligne compare ce rang à celui qu'aurait l'équipe si le classement portait
// uniquement sur les points marqués pendant la période choisie (1/7/30
// jours, même formule que le temple de la renommée et /pool-leaderboard) :
// mieux classée sur la période que sur la saison → ▲, moins bien → ▼.
const STANDINGS_PERIODS = [1, 7, 30];
let standingsPeriod = 7;
let periodPointsCache = null; // { poolName, byDays: { 1: Map, 7: Map, 30: Map } }

const EVO_ARROW_UP = '<svg viewBox="0 0 24 24" width="8" height="8"><path d="M12 4l8 10H4z"></path></svg>';
const EVO_ARROW_DOWN = '<svg viewBox="0 0 24 24" width="8" height="8"><path d="M12 20L4 10h16z"></path></svg>';

async function fetchStandingsPeriodPoints(poolName) {
    if (periodPointsCache && periodPointsCache.poolName === poolName) return periodPointsCache.byDays;

    const byDays = {};
    await Promise.all(STANDINGS_PERIODS.map(async (days) => {
        const map = new Map();
        try {
            const res = await fetch(`${BASE_URL}/pool-leaderboard/${encodeURIComponent(poolName)}?days=${days}`, { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                (data.teams || []).forEach(t => map.set(t.teamName, t.points));
            }
        } catch (error) {
            console.warn(`⚠️ Could not load ${days}-day points for rank evolution:`, error);
        }
        byDays[days] = map;
    }));

    periodPointsCache = { poolName, byDays };
    return byDays;
}

// Classe les équipes par points marqués pendant la période ; une équipe
// sans donnée (aucun log de match trouvé) reste en fin de classement plutôt
// que d'être exclue, pour que le badge ait toujours un rang à comparer.
function rankByPeriodPoints(standings, pointsMap) {
    const withPts = standings.map(s => ({ teamName: s.teamName, pts: pointsMap.get(s.teamName) }));
    withPts.sort((a, b) => (b.pts ?? -Infinity) - (a.pts ?? -Infinity));
    const rankByTeam = new Map();
    withPts.forEach((t, i) => rankByTeam.set(t.teamName, i + 1));
    return rankByTeam;
}

function fmtPeriodPts(value) {
    if (value === null || value === undefined) return '—';
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function initialsFromName(name) {
    if (!name) return '';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase();
}

function evolutionBadgeHTML(move, hasData) {
    if (hasData && move > 0) {
        return `<span class="st-evo st-evo-up" title="A gagné ${move} rang${move > 1 ? 's' : ''} sur la période">${EVO_ARROW_UP}${move}</span>`;
    }
    if (hasData && move < 0) {
        return `<span class="st-evo st-evo-down" title="A perdu ${-move} rang${-move > 1 ? 's' : ''} sur la période">${EVO_ARROW_DOWN}${-move}</span>`;
    }
    const title = hasData ? 'Rang inchangé sur la période' : 'Pas assez de données récentes';
    return `<span class="st-evo st-evo-flat" title="${title}">—</span>`;
}

function standingsPeriodChipsHTML() {
    return `<div class="st-period-chips" role="group" aria-label="Période pour l'évolution du rang">
        ${STANDINGS_PERIODS.map(d => `<button type="button" class="st-period-chip${d === standingsPeriod ? ' active' : ''}" data-period="${d}">${d}J</button>`).join('')}
    </div>`;
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

    // Points par période (1/7/30j) et rang « période » associé : pas de
    // pendant H2H, qui n'a ni colonnes période ni badge d'évolution.
    const byDays = poolMode === 'head-to-head' ? null : await fetchStandingsPeriodPoints(poolName);
    const periodRankByTeam = byDays ? rankByPeriodPoints(standings, byDays[standingsPeriod]) : null;

    const chipsHTML = poolMode === 'head-to-head' ? '' : standingsPeriodChipsHTML();
    const mobileListHTML = poolMode === 'head-to-head' ? '' : '<div class="st-mobile-list"></div>';
    standingsList.innerHTML = `${chipsHTML}<div class="standings-table-container"><table id="standingsTable">${buildStandingsHead(columns, activeSortKey)}</table></div>${mobileListHTML}`;
    const table = document.getElementById('standingsTable');

    const tbody = document.createElement('tbody');
    const mobileRowsHTML = [];
    displayList.forEach(standing => {
        const displayName = getDisplayName(standing.teamName, standing.members);
        const logoHTML = getTeamLogoHTML(standing.nhlTeams, 20);
        const avatarHTML = logoHTML || `<span class="st-avatar-fallback">${initialsFromName(displayName)}</span>`;

        const tr = document.createElement('tr');
        tr.className = standing.rank === 1 ? 'is-clickable is-leader' : 'is-clickable';
        tr.tabIndex = 0;
        tr.setAttribute('role', 'button');
        tr.setAttribute('aria-label', `Voir l'équipe de ${displayName}`);
        tr.onclick = () => showTeamRoster(poolName, standing.teamName);
        tr.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showTeamRoster(poolName, standing.teamName); }
        };

        let evoHTML = '';
        if (periodRankByTeam) {
            const periodRank = periodRankByTeam.get(standing.teamName);
            const move = periodRank !== undefined ? standing.rank - periodRank : 0;
            const hasData = byDays[standingsPeriod].get(standing.teamName) != null;
            evoHTML = evolutionBadgeHTML(move, hasData);
        }

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
               <td class="st-period-col">${fmtPeriodPts(byDays[1].get(standing.teamName))}</td>
               <td class="st-period-col">${fmtPeriodPts(byDays[7].get(standing.teamName))}</td>
               <td class="st-period-col">${fmtPeriodPts(byDays[30].get(standing.teamName))}</td>
               <td class="points-column">${standing.points}</td>
               <td>${standing.ppg.toFixed(2)}</td>
               <td class="st-evo-col">${evoHTML}</td>`;

        tr.innerHTML = `
            <td class="rank-col">${rankBadgeHTML(standing.rank)}</td>
            <td class="player-col">
                <div class="st-participant">
                    <span class="st-avatar">${avatarHTML}</span>
                    <span class="st-name" title="${displayName}">${displayName}</span>
                </div>
            </td>
            ${statCells}
        `;
        tbody.appendChild(tr);

        if (poolMode !== 'head-to-head') {
            const periodPts = fmtPeriodPts(byDays[standingsPeriod].get(standing.teamName));
            mobileRowsHTML.push(`
                <div class="st-mobile-row is-clickable" tabindex="0" role="button" aria-label="Voir l'équipe de ${displayName}" data-team="${standing.teamName.replace(/"/g, '&quot;')}">
                    <span class="st-mobile-rank">${rankBadgeHTML(standing.rank)}</span>
                    <span class="st-avatar">${avatarHTML}</span>
                    <div class="st-mobile-info">
                        <span class="st-mobile-name" title="${displayName}">${displayName}</span>
                        <span class="st-mobile-sub">${periodPts} pts période</span>
                    </div>
                    <span class="st-mobile-pts">${standing.points}</span>
                    ${evoHTML}
                </div>`);
        }
    });
    table.appendChild(tbody);

    if (poolMode !== 'head-to-head') {
        const mobileList = standingsList.querySelector('.st-mobile-list');
        if (mobileList) mobileList.innerHTML = mobileRowsHTML.join('');
    }

    const n = standings.length;
    const rawAvg = (key) => standings.reduce((sum, s) => sum + (s[key] || 0), 0) / n;
    const avg = (key) => Math.round(rawAvg(key));
    const avgPeriod = (days) => {
        const vals = [...byDays[days].values()].filter(v => v !== null && v !== undefined);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
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
           <td class="st-period-col">${fmtPeriodPts(avgPeriod(1))}</td>
           <td class="st-period-col">${fmtPeriodPts(avgPeriod(7))}</td>
           <td class="st-period-col">${fmtPeriodPts(avgPeriod(30))}</td>
           <td class="points-column">${avg('points')}</td>
           <td>${rawAvg('ppg').toFixed(2)}</td>
           <td class="st-evo-col">—</td>`;
    tfoot.innerHTML = `
        <tr class="standings-avg-row">
            <td class="rank-col">—</td>
            <td class="player-col standings-avg-label">Moyenne</td>
            ${avgStatCells}
        </tr>
    `;
    table.appendChild(tfoot);

    // Délégation sur le conteneur : reconstruit à chaque tri/période/rendu, un
    // écouteur par <th>/.st-period-chip/.st-mobile-row fuirait à chaque passe
    // (comme initStatsHeaderSorting).
    standingsList.onclick = (e) => {
        const chip = e.target.closest('.st-period-chip');
        if (chip) {
            standingsPeriod = Number(chip.dataset.period);
            renderPoolStandings(poolData, poolName).catch(console.error);
            return;
        }
        const th = e.target.closest('th[data-sort]');
        if (th) { handleStandingsSort(th.dataset.sort); return; }
        const mobileRow = e.target.closest('.st-mobile-row');
        if (mobileRow) showTeamRoster(poolName, mobileRow.dataset.team);
    };
    standingsList.onkeydown = (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const th = e.target.closest('th[data-sort]');
        if (th) { e.preventDefault(); handleStandingsSort(th.dataset.sort); return; }
        const mobileRow = e.target.closest('.st-mobile-row');
        if (mobileRow) { e.preventDefault(); showTeamRoster(poolName, mobileRow.dataset.team); }
    };

    document.getElementById('standingsSkeleton').style.display = 'none';
    standingsList.style.display = 'block';

    renderHallOfFame(poolName);
    renderRecentFormLeaderboard(poolName);
}

// ==================== HALL OF FAME ====================
// Season records (best/worst single day, week, month of pool points),
// computed server-side from real game logs — see GET /pool-hall-of-fame.

function formatHofDate(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function formatHofMonth(dateStr) {
    if (!dateStr) return '';
    const month = new Date(dateStr + 'T00:00:00Z').toLocaleDateString('fr-CA', { month: 'long', timeZone: 'UTC' });
    return month.charAt(0).toUpperCase() + month.slice(1);
}

// Icône trophée du mockup ; la variante « pire » la reprend grisée et
// retournée plutôt que d'introduire une deuxième icône.
function trophyIconHTML(cls) {
    return `<svg class="hof-icon ${cls}" viewBox="0 0 24 24" width="18" height="18"><path d="M5 4h14v2h2v3a5 5 0 0 1-5 5h-.26A6 6 0 0 1 13 17.65V20h3v2H8v-2h3v-2.35A6 6 0 0 1 8.26 14H8a5 5 0 0 1-5-5V6h2V4zm0 4H5v1a3 3 0 0 0 2.6 2.97A8.9 8.9 0 0 1 5 8zm14 0a8.9 8.9 0 0 1-2.6 3.97A3 3 0 0 0 19 9V8z"></path></svg>`;
}

function hofCardHTML(entry, kind, label, dateFormatter) {
    const icon = trophyIconHTML(kind === 'worst' ? 'is-worst' : 'is-best');
    if (!entry) {
        return `
            <div class="hof-card hof-card-${kind}">
                ${icon}
                <p class="hof-card-label">${label}</p>
                <p class="hof-empty">Aucune donnée</p>
            </div>`;
    }
    const displayName = getDisplayName(entry.teamName, entry.members);
    return `
        <div class="hof-card hof-card-${kind}">
            ${icon}
            <p class="hof-card-label">${label}</p>
            <p class="hof-card-value">${entry.points}</p>
            <p class="hof-card-name"><span title="${displayName}">${displayName}</span> <span class="hof-card-date">· ${dateFormatter(entry.date)}</span></p>
        </div>`;
}

function buildHallOfFameHTML(data) {
    const head = `
        <div class="hof-head">
            <p class="hof-title">Temple de la renommée</p>
            <span class="hof-subtitle">saison en cours</span>
        </div>`;
    if (data && data.seasonStarted === false) {
        return `${head}<p class="hof-empty">La saison n'est pas commencée : les records s'écriront au premier match.</p>`;
    }
    if (!data || (!data.bestDay && !data.bestWeek && !data.bestMonth)) {
        return `${head}<p class="hof-empty">Pas encore assez de matchs joués cette saison pour établir des records.</p>`;
    }
    // Ordre du mockup : la meilleure semaine sert de carte « héro » (fond
    // sombre), puis meilleurs mois/jour, puis les trois pires en fin de
    // grille — pas un simple appariement best/worst par ligne.
    return `${head}
        <div class="hof-grid">
            ${hofCardHTML(data.bestWeek, 'hero', 'Meilleure semaine', formatHofDate)}
            ${hofCardHTML(data.bestMonth, 'best', 'Meilleur mois', formatHofMonth)}
            ${hofCardHTML(data.bestDay, 'best', 'Meilleure journée', formatHofDate)}
            ${hofCardHTML(data.worstWeek, 'worst', 'Pire semaine', formatHofDate)}
            ${hofCardHTML(data.worstMonth, 'worst', 'Pire mois', formatHofMonth)}
            ${hofCardHTML(data.worstDay, 'worst', 'Pire journée', formatHofDate)}
        </div>`;
}

async function renderHallOfFame(poolName) {
    const container = document.getElementById('hallOfFame');
    if (!container) return;
    try {
        const response = await fetch(`${BASE_URL}/pool-hall-of-fame/${encodeURIComponent(poolName)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        container.innerHTML = buildHallOfFameHTML(data);
        container.style.display = 'block';
    } catch (error) {
        console.warn('⚠️ Could not load hall of fame:', error);
        container.style.display = 'none';
    }
}

// ==================== RECENT FORM (windowed best-team leaderboard) ====================
// Relocated from the old homepage Activity tab (see accueil-dash.js) — that
// was the only place GET /pool-leaderboard was ever surfaced. Same windows,
// same rank/points shape, just re-homed next to the season standings it
// complements.

const RECENT_FORM_WINDOWS = [7, 14, 30, 90, 180, 365];
let recentFormWindow = 7;

function recentFormRankClass(rank) {
    return rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
}

function changeRecentFormWindow(poolName, days) {
    recentFormWindow = days;
    document.querySelectorAll('#recentFormLeaderboard .time-filter').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.days) === days);
    });
    loadRecentFormRows(poolName, days);
}

async function loadRecentFormRows(poolName, days) {
    const list = document.getElementById('recentFormLeaderboardRows');
    if (!list) return;
    try {
        const res = await fetch(`${BASE_URL}/pool-leaderboard/${encodeURIComponent(poolName)}?days=${days}`, { cache: 'no-store' });
        const data = res.ok ? await res.json() : null;
        const teams = (data && data.teams) || [];

        if (!teams.length) {
            list.innerHTML = data && data.seasonStarted === false
                ? `<p class="hof-empty">La saison n'est pas commencée : aucune équipe n'a encore joué.</p>`
                : `<p class="hof-empty">Pas assez de données pour classer les équipes sur cette période.</p>`;
            return;
        }

        // "Real data, just not from the exact window" vs. "nothing at all" —
        // the caption keeps the fallback honest instead of implying precision.
        const sourceLabel = { seasonFallback: '(saison)', none: '' };

        list.innerHTML = teams.map(t => `
            <div class="leaderboard-row">
                <span class="lb-rank ${recentFormRankClass(t.rank)}">${t.rank}</span>
                <span class="lb-team">${t.teamName}</span>
                ${t.points === null
                    ? '<span class="lb-pts">—</span>'
                    : `<span class="lb-pts">${t.points} pts</span><span class="lb-source">${sourceLabel[t.source] || ''}</span>`}
            </div>`).join('');
    } catch (error) {
        console.warn('⚠️ Could not load recent-form leaderboard:', error);
        list.innerHTML = `<p class="hof-empty">Impossible de charger ce classement.</p>`;
    }
}

function renderRecentFormLeaderboard(poolName) {
    const container = document.getElementById('recentFormLeaderboard');
    if (!container) return;

    recentFormWindow = 7;
    container.innerHTML = `
        <div class="recent-form-head">
            <p class="hof-title">Meilleures équipes récentes</p>
            <div class="time-filters">
                ${RECENT_FORM_WINDOWS.map(d => `<button type="button" class="time-filter${d === 7 ? ' active' : ''}" data-days="${d}">${d}J</button>`).join('')}
            </div>
        </div>
        <div class="leaderboard-list" id="recentFormLeaderboardRows"></div>`;

    container.querySelectorAll('.time-filter').forEach(btn => {
        btn.addEventListener('click', () => changeRecentFormWindow(poolName, Number(btn.dataset.days)));
    });

    container.style.display = 'block';
    loadRecentFormRows(poolName, recentFormWindow);
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

    // Un pool sans échanges n'a rien à mettre en vente : on saute l'appel
    // aux annonces et le bouton disparaît de la fiche.
    const tradesAllowed = poolData.allowTrades !== false;

    // Render roster after short delay — fetch this team's active for-sale
    // listings first so the toggle starts in the right state on first paint.
    setTimeout(async () => {
        let activeListings = [];
        if (tradesAllowed) {
            try {
                const res = await fetch(`${BASE_URL}/trade-listings/${encodeURIComponent(poolName)}`, { cache: 'no-store' });
                if (res.ok) {
                    const listings = await res.json();
                    activeListings = listings.filter(l => l.teamName === teamName);
                }
            } catch (err) {
                console.warn('Could not load trade listings:', err);
            }
        }
        renderTeamRoster(teamData, activeListings, tradesAllowed);
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

function renderTeamRoster(roster, activeListings = [], tradesAllowed = true) {
    const rosterList = document.getElementById('rosterList');
    rosterList.innerHTML = '';

    // Only the roster's own team can list/unlist its players, and only when
    // the pool allows trades at all. category matches the vocabulary
    // /trade/propose already validates against.
    const currentUsername = localStorage.getItem('username');
    const isOwner = tradesAllowed && (roster.members || []).includes(currentUsername);
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
            gp = seasonStat(player.stats, player.cached, 'gamesPlayed');
            const wins = seasonStat(player.stats, player.cached, 'wins');
            const shutouts = seasonStat(player.stats, player.cached, 'shutouts');
            const otLosses = seasonStat(player.stats, player.cached, 'otLosses');
            points = goaliePoolPoints({ shutouts, wins, otLosses });
            stat1 = wins;
            stat2 = shutouts;
            stat1Label = 'V';
            stat2Label = 'BL';
        } else if (player.type === 'team') {
            gp = seasonStat(player.stats, player.cached, 'gamesPlayed');
            const wins = seasonStat(player.stats, player.cached, 'wins');
            const otLosses = seasonStat(player.stats, player.cached, 'otLosses');
            points = clubPoolPoints({ wins, otLosses });
            stat1 = wins;
            stat2 = otLosses;
            stat1Label = 'V';
            stat2Label = 'DP';
        } else {
            gp = seasonStat(player.stats, player.cached, 'gamesPlayed');
            stat1 = seasonStat(player.stats, player.cached, 'goals');
            stat2 = seasonStat(player.stats, player.cached, 'assists');
            points = seasonStat(player.stats, player.cached, 'points');
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
                    <span class="player-name">${player.name}</span>${player.type === 'team' ? '' : injBadge(player.name, teamAbbrev)}
                    <span class="player-team-abbrev">${teamAbbrev}</span>
                    <span class="player-position">${player.position}</span>
                    ${sellToggleHTML}
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

/**
 * Pastille de blessure, ou rien. injuries.js est une couche d'agrément :
 * si le script n'a pas chargé, la liste doit s'afficher quand même plutôt
 * que d'échouer sur une fonction absente.
 */
function injBadge(playerName, teamAbbrev) {
    return typeof injuryBadgeHTML === 'function' ? injuryBadgeHTML(playerName, teamAbbrev) : '';
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
                totalGP += seasonStat(stats, playerData, 'gamesPlayed');
                totalGoals += seasonStat(stats, playerData, 'goals');
                totalAssists += seasonStat(stats, playerData, 'assists');
                totalPoints += seasonStat(stats, playerData, 'points');
            }
        });
    });

    // Process goalies
    (roster.goalie || []).forEach(playerName => {
        const playerData = goalieData.find(p => p.goalieFullName === playerName);
        if (playerData) {
            const stats = getCurrentPlayerStats(playerName, playerData.playerId);
            const gp = seasonStat(stats, playerData, 'gamesPlayed');
            const wins = seasonStat(stats, playerData, 'wins');
            const shutouts = seasonStat(stats, playerData, 'shutouts');
            const otLosses = seasonStat(stats, playerData, 'otLosses');
            // Formule partagée avec le serveur et la page d'accueil
            // (lib/scoring.js) : recopiée ici, elle finissait par diverger.
            const points = goaliePoolPoints({ shutouts, wins, otLosses });

            totalGP += gp;
            totalPoints += points;
        }
    });

    // Process teams
    (roster.teams || []).forEach(teamName => {
        const teamInfo = teamData.find(t => t.teamFullName === teamName);
        if (teamInfo) {
            const stats = getCurrentTeamStats(teamName);
            const gp = seasonStat(stats, teamInfo, 'gamesPlayed');
            const wins = seasonStat(stats, teamInfo, 'wins');
            const otLosses = seasonStat(stats, teamInfo, 'otLosses');
            const points = clubPoolPoints({ wins, otLosses });

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
    // buildHeadshotUrl (headshots.js) tient la saison courante à jour.
    return buildHeadshotUrl(playerId, teamAbbrev);
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
    document.getElementById('h2hScheduleView').style.display = (tab === 'calendrier') ? 'block' : 'none';
    document.getElementById('h2hHistoryView').style.display = (tab === 'history') ? 'block' : 'none';

    if (tab === 'standings' && currentPoolName) {
        const poolData = allPoolsData[currentPoolName];
        if (poolData) renderPoolStandings(poolData, currentPoolName);
    }

    if (tab === 'calendrier' && currentPoolName) {
        renderH2HSchedule(currentPoolName);
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

// ==================== H2H — CALENDRIER DE LA SAISON ====================
//
// Le calendrier entier est tiré à la fin du repêchage (lib/h2h.js,
// generateSeasonSchedule) : contre qui on joue en février se sait dès
// octobre. /h2h/season-schedule le sert semaine par semaine, résultats
// compris pour celles déjà finalisées ; le carrousel ci-dessous en fait une
// bande horizontale, ouverte sur la semaine en cours.
//
// Le sélecteur d'équipe part de la vôtre — c'est la question qu'on se pose
// en arrivant — mais donne accès au parcours de n'importe qui : « qui reste
// à affronter au meneur ? » est la deuxième question, et elle se lit dans
// le même carrousel.

let h2hScheduleCache = null;   // { poolName, data }
let h2hSchedTeam = null;       // équipe affichée dans le carrousel

const H2H_SCHED_STATUS = {
    completed: { label: 'Terminée', cls: 'is-done' },
    ongoing:   { label: 'En cours', cls: 'is-live' },
    upcoming:  { label: 'À venir',  cls: 'is-next' }
};

/** Nom de l'équipe de l'utilisateur dans ce pool, ou null s'il n'en a pas. */
function myTeamIn(poolName) {
    const poolData = allPoolsData[poolName];
    const username = localStorage.getItem('username');
    if (!poolData || !username) return null;
    const entree = Object.entries(poolData.teams || {}).find(
        ([, equipe]) => Array.isArray(equipe.members) && equipe.members.includes(username)
    );
    return entree ? entree[0] : null;
}

/** « 13 – 19 oct. » : weekEnd est le lundi SUIVANT, on recule d'un jour. */
function h2hSchedDateRange(weekStart, weekEnd) {
    const debut = new Date(weekStart);
    const fin = new Date(weekEnd);
    fin.setDate(fin.getDate() - 1);
    const jour = d => d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
    return `${jour(debut)} – ${jour(fin)}`;
}

async function renderH2HSchedule(poolName) {
    const track = document.getElementById('h2hSchedTrack');
    const sub = document.getElementById('h2hSchedSub');
    if (!track) return;

    track.innerHTML = '<div class="h2h-loading">Chargement du calendrier...</div>';
    sub.textContent = '';

    try {
        if (!h2hScheduleCache || h2hScheduleCache.poolName !== poolName) {
            const res = await fetch(`${BASE_URL}/h2h/season-schedule?poolName=${encodeURIComponent(poolName)}`, { cache: 'no-store' });
            if (!res.ok) throw new Error('Failed');
            h2hScheduleCache = { poolName, data: await res.json() };
        }
        const data = h2hScheduleCache.data;

        if (data.status === 'awaiting_draft_completion' || !data.weeks || data.weeks.length === 0) {
            track.innerHTML = '<div class="h2h-empty">Le calendrier sera dressé à la fin du repêchage.</div>';
            document.getElementById('h2hSchedTeam').innerHTML = '';
            return;
        }

        // Les avatars des membres donnent un visage à chaque adversaire ; on
        // les précharge une fois pour que avatarHtml(), qui est synchrone,
        // ait de quoi répondre.
        await prefetchAvatars((data.teams || []).flatMap(t => t.members || []));

        remplirSelecteurEquipes(poolName, data);
        dessinerCarrousel(data);

    } catch (err) {
        console.error('Error loading H2H season schedule:', err);
        track.innerHTML = '<div class="h2h-empty">Erreur lors du chargement du calendrier</div>';
    }
}

function remplirSelecteurEquipes(poolName, data) {
    const select = document.getElementById('h2hSchedTeam');
    const mienne = myTeamIn(poolName);

    // Seules les équipes qui figurent au calendrier : une équipe sans membre
    // n'a pas de duel, la proposer ne donnerait qu'une bande vide.
    const auCalendrier = new Set();
    data.weeks.forEach(w => w.matchups.forEach(m => { auCalendrier.add(m.team1); auCalendrier.add(m.team2); }));

    const equipes = (data.teams || []).filter(t => auCalendrier.has(t.name));
    if (!h2hSchedTeam || !auCalendrier.has(h2hSchedTeam)) {
        h2hSchedTeam = (mienne && auCalendrier.has(mienne)) ? mienne : (equipes[0] && equipes[0].name) || null;
    }

    select.innerHTML = equipes.map(t => {
        const nom = getDisplayName(t.name, t.members);
        const suffixe = t.name === mienne ? ' (vous)' : '';
        return `<option value="${escapeAttr(t.name)}"${t.name === h2hSchedTeam ? ' selected' : ''}>${escapeHtmlText(nom + suffixe)}</option>`;
    }).join('');
}

function dessinerCarrousel(data) {
    const track = document.getElementById('h2hSchedTrack');
    const sub = document.getElementById('h2hSchedSub');
    const equipe = h2hSchedTeam;
    const parNom = new Map((data.teams || []).map(t => [t.name, t]));

    let victoires = 0, defaites = 0, nulles = 0, restants = 0;

    const cartes = data.weeks.map(week => {
        const duel = week.matchups.find(m => m.team1 === equipe || m.team2 === equipe);
        if (!duel) return '';

        const premier = duel.team1 === equipe;
        const adversaire = premier ? duel.team2 : duel.team1;
        const mesPts = premier ? duel.team1Points : duel.team2Points;
        const sesPts = premier ? duel.team2Points : duel.team1Points;

        const infoAdv = parNom.get(adversaire);
        const nomAdv = getDisplayName(adversaire, infoAdv && infoAdv.members);
        const membre = (infoAdv && infoAdv.members && infoAdv.members[0]) || '';

        const st = H2H_SCHED_STATUS[week.status] || H2H_SCHED_STATUS.upcoming;
        const estCourante = week.weekNumber === data.currentWeek;
        const joue = week.status === 'completed';
        const enCours = week.status === 'ongoing';

        let issue = '';
        if (joue) {
            if (duel.winner === 'tie') { nulles++; issue = 'tie'; }
            else if (duel.winner === equipe) { victoires++; issue = 'win'; }
            else if (duel.winner) { defaites++; issue = 'loss'; }
            else {
                // Semaine passée sans vainqueur inscrit : le pointage tranche.
                if (mesPts > sesPts) { victoires++; issue = 'win'; }
                else if (sesPts > mesPts) { defaites++; issue = 'loss'; }
                else { nulles++; issue = 'tie'; }
            }
        } else {
            restants++;
        }

        const issueLabel = { win: 'V', loss: 'D', tie: 'N' }[issue] || '';

        // Un pointage ne s'affiche que sur une semaine réellement jouée :
        // « 0.0 – 0.0 » en février se lirait comme un match nul.
        const pointage = (joue || enCours)
            ? `<div class="h2h-sched-score${issue ? ' r-' + issue : ''}">
                   <span class="h2h-sched-pts mine">${mesPts.toFixed(1)}</span>
                   <span class="h2h-sched-dash">–</span>
                   <span class="h2h-sched-pts">${sesPts.toFixed(1)}</span>
               </div>`
            : `<div class="h2h-sched-score is-pending"><span class="h2h-sched-vs">VS</span></div>`;

        return `
            <article class="h2h-sched-card ${st.cls}${estCourante ? ' is-current' : ''}" data-week="${week.weekNumber}">
                <header class="h2h-sched-card-top">
                    <span class="h2h-sched-week">Semaine ${week.weekNumber}</span>
                    <span class="h2h-sched-badge ${st.cls}">${st.label}</span>
                </header>
                <div class="h2h-sched-dates">${h2hSchedDateRange(week.weekStart, week.weekEnd)}</div>
                <div class="h2h-sched-opp">
                    ${avatarHtml(membre, 34)}
                    <div class="h2h-sched-opp-txt">
                        <span class="h2h-sched-opp-lbl">contre</span>
                        <span class="h2h-sched-opp-name" title="${escapeAttr(nomAdv)}">${escapeHtmlText(nomAdv)}</span>
                    </div>
                </div>
                ${pointage}
                ${issueLabel ? `<div class="h2h-sched-result r-${issue}">${issueLabel}</div>` : ''}
            </article>`;
    }).filter(Boolean);

    if (cartes.length === 0) {
        track.innerHTML = '<div class="h2h-empty">Cette équipe n&rsquo;a aucun duel au calendrier.</div>';
        sub.textContent = '';
        return;
    }

    track.innerHTML = cartes.join('');

    const infoMienne = parNom.get(equipe);
    const nomMien = getDisplayName(equipe, infoMienne && infoMienne.members);
    const joues = victoires + defaites + nulles;
    sub.textContent = `${nomMien} · ${cartes.length} duels au calendrier · `
        + `${victoires}V-${defaites}D-${nulles}N sur ${joues} joué${joues > 1 ? 's' : ''} · `
        + `${restants} à venir`;

    centrerSurSemaineCourante(track);
}

/**
 * Ouvre le carrousel sur la semaine en cours plutôt qu'au mois d'octobre.
 * scrollLeft plutôt que scrollIntoView : celui-ci fait aussi défiler la page
 * verticalement, et la bande sauterait sous les yeux à chaque changement
 * d'équipe.
 */
function centrerSurSemaineCourante(track) {
    const carte = track.querySelector('.h2h-sched-card.is-current')
        || track.querySelector('.h2h-sched-card.is-live')
        || track.querySelector('.h2h-sched-card.is-next');
    if (!carte) return;
    track.scrollLeft = Math.max(0, carte.offsetLeft - (track.clientWidth - carte.clientWidth) / 2);
}

function onH2HScheduleTeamChange(teamName) {
    h2hSchedTeam = teamName;
    if (h2hScheduleCache) dessinerCarrousel(h2hScheduleCache.data);
}

/** Défile d'environ une pleine largeur de cartes, bornes comprises. */
function scrollH2HSchedule(sens) {
    const track = document.getElementById('h2hSchedTrack');
    if (!track) return;
    const carte = track.querySelector('.h2h-sched-card');
    const largeur = carte ? carte.clientWidth + 12 : 0;
    const pas = largeur
        ? largeur * Math.max(1, Math.floor(track.clientWidth / largeur))
        : track.clientWidth;
    track.scrollBy({ left: sens * pas, behavior: 'smooth' });
}

/* Échappement — les noms d'équipe sont saisis par les utilisateurs et
   atterrissent aussi bien dans du texte que dans des attributs. */
function escapeHtmlText(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
        const data = await fzChargerCarriere(playerId, BASE_URL);
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

        // Indisponibilité : `currentTeam` est déjà l'abréviation officielle
        // (currentTeamAbbrev côté serveur), ce qui départage les homonymes.
        if (typeof renderInjuryBanner === 'function') renderInjuryBanner(data.playerName, data.currentTeam);

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
        // Le chemin d'erreur ne doit jamais lui-même échouer : si
        // careerFetch.js n'a pas été chargé, on retombe sur l'ancien texte.
        const raison = typeof fzMessageErreurCarriere === 'function'
            ? fzMessageErreurCarriere(error)
            : 'Erreur lors du chargement des statistiques';
        statsTable.innerHTML = `<p class="no-stats-message">❌ ${raison}</p>`;
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
