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
    "Toronto Maple Leafs": "TOR", "Utah Hockey Club": "UTA", "Utah Mammoth": "UTA", "Vancouver Canucks": "VAN",
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
// Les relevés de minuit tels que reçus. currentStats / currentTeams en sont
// la copie augmentée des points du soir (pointsDirect.js) : c'est elle que
// tout le classement lit.
let currentStatsBase = null;
let currentTeamsBase = null;
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
    // Le temple du squelette (classement.html) : les mêmes tuiles fantômes
    // que renderHallOfFame pose en attendant ses records.
    const templeSquelette = document.getElementById('standingsSkeletonHof');
    if (templeSquelette) templeSquelette.innerHTML = hofChargementHTML();

    await fetchImageData();

    // La trousse de repêchage : la fiche des joueurs repêchés que
    // nhl_filtered_stats.json ne contient pas (voir ficheJoueur). Chargée en
    // parallèle ; sans elle, ces joueurs paraissent quand même.
    const trousse = window.FZDraftKit
        ? FZDraftKit.charger().catch(error => { console.warn('⚠️ Could not load draft kit:', error); })
        : Promise.resolve();

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
        const statsResponse = await fetch(`${BASE_URL}/current-stats`, { cache: 'no-cache' });
        currentStats = currentStatsBase = await statsResponse.json();
        console.log(`✅ Current stats loaded: ${currentStats.players.length} players`);
    } catch (error) {
        console.warn('⚠️ Could not load current stats:', error);
    }

    // Load current team standings
    try {
        const teamsResponse = await fetch(`${BASE_URL}/current-teams`, { cache: 'no-cache' });
        currentTeams = currentTeamsBase = await teamsResponse.json();
        console.log(`✅ Current team standings loaded: ${currentTeams.teams.length} teams`);
    } catch (error) {
        console.warn('⚠️ Could not load current team standings:', error);
    }

    await trousse;
    indexerFiches();

    // Charge le pool actif
    await loadAllUserPools();

    // Changer de pool depuis le rail rejoue le classement sur place.
    FZPool.on(() => loadAllUserPools());

    // Les points du soir : un but d'un joueur du pool fait bouger le
    // classement sur place. En saison seulement — avant, aucun match ne compte.
    if (window.FZPointsDirect && seasonStarted) {
        let premierDirect = true;
        FZPointsDirect.surNouveauReleve(relireRelevesDeMinuit);
        FZPointsDirect.surChangement(() => {
            appliquerPointsDirect();
            rafraichirClassementEnDirect();
            rafraichirFicheEnDirect();
            relireSoireeBientot();
            // Le premier envoi n'est que l'état du moment, que les colonnes
            // de période lues au chargement comptent déjà.
            if (premierDirect) { premierDirect = false; return; }
            relirePeriodesEnDirect();
        });
        FZPointsDirect.suivre();
    }
});

/**
 * Les colonnes 24 h / 7 j / 30 j comptent aussi les matchs en cours : le
 * serveur ajoute à ce que la base contient déjà les points du soir, un match
 * à la fois, sans jamais recompter un match déjà enregistré
 * (services/scoring.js). Elles se relisent quand un point tombe — au plus
 * une fois toutes les PERIODES_DIRECT_MS, et la dernière relecture part
 * toujours : aucun point ne reste en plan.
 */
const PERIODES_DIRECT_MS = 20000;
let periodesMinuteur = null;
let periodesDerniere = 0;
function relirePeriodesEnDirect() {
    if (periodesMinuteur) return;
    const attente = Math.max(0, PERIODES_DIRECT_MS - (Date.now() - periodesDerniere));
    periodesMinuteur = setTimeout(() => {
        periodesMinuteur = null;
        periodesDerniere = Date.now();
        periodPointsCache = null;
        rafraichirClassementEnDirect();
    }, attente);
}

/**
 * La collecte de minuit a tourné pendant que la page était ouverte : ses
 * relevés sont relus avant que le nouveau direct ne s'y ajoute (voir
 * pointsDirect.js). Un échec garde les anciens — mieux qu'un classement vide.
 */
async function relireRelevesDeMinuit() {
    const [stats, clubs] = await Promise.all([
        fetch(`${BASE_URL}/current-stats`, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`${BASE_URL}/current-teams`, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null)
    ]);
    if (stats && Array.isArray(stats.players)) currentStats = currentStatsBase = stats;
    if (clubs && Array.isArray(clubs.teams)) currentTeams = currentTeamsBase = clubs;
    // Les colonnes 24 h / 7 j / 30 j changent de base avec le relevé.
    periodPointsCache = null;
}

/** currentStats / currentTeams = relevés de minuit + points du soir. */
function appliquerPointsDirect() {
    if (!window.FZPointsDirect) return;
    if (currentStatsBase && Array.isArray(currentStatsBase.players)) {
        currentStats = { ...currentStatsBase, players: FZPointsDirect.joueurs(currentStatsBase.players) };
    }
    if (currentTeamsBase && Array.isArray(currentTeamsBase.teams)) {
        currentTeams = { ...currentTeamsBase, teams: FZPointsDirect.clubs(currentTeamsBase.teams) };
    }
}

/**
 * Redessine le classement cumulatif affiché, sans rien relire : les points
 * par période sont en mémoire (periodPointsCache), le tri choisi est gardé.
 * Un classement H2H ne lit pas ces totaux ; la fiche d'une équipe a son
 * propre rafraîchissement (rafraichirFicheEnDirect).
 */
function rafraichirClassementEnDirect() {
    if (currentView !== VIEW_STATES.POOL_STANDINGS || !currentPoolName) return;
    const poolData = allPoolsData[currentPoolName];
    if (!poolData || (poolData.poolMode || 'cumulative') === 'head-to-head') return;
    renderPoolStandings(poolData, currentPoolName).catch(console.error);
}

// Ce que le soir a ajouté au total d'une équipe, en pastille à côté des points.
// Retient la dernière valeur de chaque équipe : la pastille ne s'allume que
// si elle vient de monter.
const pointsSoirAffiches = new Map();
function pointsSoirHTML(standing) {
    const cle = `${currentPoolName}|${standing.teamName}`;
    const avant = pointsSoirAffiches.get(cle);
    const n = standing.enDirect || 0;
    pointsSoirAffiches.set(cle, n);
    if (!n) return '';
    const neuf = avant !== undefined && n > avant ? ' is-new' : '';
    return ` <span class="st-live-pts${neuf}" title="Points marqués ce soir, ajoutés en direct">+${n}</span>`;
}

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
    periodPointsCache = null;

    const poolData = allPoolsData[poolName];
    if (!poolData) return;

    // Update UI — show pool image next to pool name in page title
    setRosterViewMode(false);
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
    document.getElementById('h2hRecentResults').style.display = 'none';
    const bandeH2H = document.getElementById('h2hStandingsStrip');
    bandeH2H.innerHTML = '';
    bandeH2H.style.display = 'none';
    const insightsReset = document.getElementById('standingsInsights');
    insightsReset.classList.remove('is-h2h');
    insightsReset.style.display = '';   // switchH2HTab a pu le masquer pour le pool précédent

    const poolMode = poolData.poolMode || 'cumulative';

    // Sous-titre du pool. Un pool H2H a un mode de ligue et un état de saison
    // à annoncer ; un pool cumulatif n'a que son nom, déjà dans le titre.
    const meta = document.getElementById('poolHeaderMeta');
    if (poolMode === 'head-to-head') {
        const participants = Object.values(poolData.teams || {})
            .filter(td => td.members && td.members.length > 0).length;
        document.getElementById('poolHeaderLine').textContent =
            `Ligue H2H · ${participants} participant${participants > 1 ? 's' : ''}`;
        meta.style.display = 'flex';
    } else {
        meta.style.display = 'none';
    }

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

        // Le squelette, à la taille du pool, le temps de lire les points
        // par période (renderPoolStandings).
        ajusterSqueletteClassement(Object.values(poolData.teams || {})
            .filter(td => td.members && td.members.length > 0).length);
        document.getElementById('standingsSkeleton').style.display = 'block';
        document.getElementById('standingsList').style.display = 'none';

        setTimeout(() => {
            renderPoolStandings(poolData, poolName).catch(console.error);
        }, 100);
    }
}

/**
 * Le squelette prend le nombre de rangées du pool dès qu'il est connu : le
 * classement chargé arrive à la même hauteur, la légende et le temple ne
 * sautent pas. Les rangées ajoutées reprennent les largeurs des premières ;
 * au-delà de 12, le reste est sous la ligne de flottaison.
 */
function ajusterSqueletteClassement(nombre) {
    const voulu = Math.max(1, Math.min(nombre || 7, 12));
    const classeRang = n => (n === 1 ? 'gold' : n === 2 ? 'silver' : n === 3 ? 'bronze' : 'normal');
    document.querySelectorAll('#standingsSkeleton .st-sk-table tbody, #standingsSkeleton .st-sk-list').forEach(hote => {
        const modeles = [...hote.children];
        if (!modeles.length) return;
        while (hote.children.length > voulu) hote.lastElementChild.remove();
        while (hote.children.length < voulu) {
            const i = hote.children.length;
            const rangee = modeles[i % modeles.length].cloneNode(true);
            rangee.style.setProperty('--i', i);
            const badge = rangee.querySelector('.st-rank-badge');
            if (badge) { badge.className = `st-rank-badge ${classeRang(i + 1)}`; badge.textContent = i + 1; }
            const rang = rangee.querySelector('.st-mobile-rank');
            if (rang) rang.textContent = i + 1;
            hote.appendChild(rangee);
        }
    });
}

// Colonnes du tableau de classement, par mode de pool. `sort` doit
// correspondre à une clé numérique présente sur chaque objet `standing`
// construit dans renderPoolStandings (ex.: gamesPlayed, ppg, diff...).
// Les largeurs viennent de min-width en CSS (table-layout: auto) : sous une
// largeur de phone, la table déborde et le conteneur défile plutôt que de
// couper les nombres en plusieurs lignes.
function getStandingsColumns(poolMode) {
    if (poolMode === 'head-to-head') {
        // V/D/N existent en deux versions : trois colonnes triables sur
        // grand écran, une seule « V - D - N » sur téléphone. Les deux sont
        // toujours rendues ; le CSS n'en montre qu'une, ce qui évite de
        // re-rendre la table au redimensionnement.
        return [
            { label: 'Pos', cls: 'rank-col' },
            { label: 'Participant', cls: 'player-col' },
            { label: 'PJ', sort: 'gamesPlayed', title: 'Parties jouées' },
            { label: 'V - D - N', cls: 'st-vdn-col', title: 'Victoires - défaites - nulles' },
            { label: 'V', sort: 'wins', cls: 'st-wlt-col', title: 'Victoires' },
            { label: 'D', sort: 'losses', cls: 'st-wlt-col', title: 'Défaites' },
            { label: 'N', sort: 'ties', cls: 'st-wlt-col', title: 'Nuls' },
            { label: 'Pts marqués', sort: 'points', cls: 'points-column', title: 'Points fantasy marqués dans tous vos duels' },
            { label: 'Écart', sort: 'diff', title: 'Points marqués moins points encaissés' },
            { label: 'Forme', cls: 'st-form-col', title: 'Résultats des 5 dernières semaines, du plus récent au plus ancien' }
        ];
    }
    return [
        { label: 'Pos', cls: 'rank-col' },
        { label: 'Participant', cls: 'player-col' },
        { label: 'PJ', sort: 'gamesPlayed', title: 'Parties jouées' },
        { label: 'B', sort: 'goals', title: 'Buts' },
        { label: 'P', sort: 'assists', title: 'Passes décisives' },
        // Mêmes règles que le Total (buts + passes, gardiens, clubs) : une
        // colonne 30 j égale au Total en début de saison, pas une autre unité.
        { label: '24 h', cls: 'st-period-col', title: 'Points marqués aujourd’hui (depuis minuit, heure de l’Est)' },
        { label: '7 j', cls: 'st-period-col', title: 'Points marqués ces 7 derniers jours — jusqu’à hier tant que le premier match du jour n’est pas commencé' },
        { label: '30 j', cls: 'st-period-col', title: 'Points marqués ces 30 derniers jours' },
        { label: 'Total', sort: 'points', cls: 'points-column', title: 'Points de la saison — ce qui décide du classement' },
        { label: 'Moy./PJ', sort: 'ppg', title: 'Points de la saison par partie jouée' },
        { label: 'Tendance', cls: 'st-evo-col', title: 'Places gagnées ou perdues si l’on classait seulement sur les 7 derniers jours — gardée jusqu’au premier match du jour suivant' }
    ];
}

// ==================== RANG : ÉVOLUTION PAR PÉRIODE ====================
// Le rang (Pos) reste fixé par le total de la saison. Le badge en bout de
// ligne compare ce rang à celui qu'aurait l'équipe si le classement portait
// uniquement sur les points des 7 derniers jours (même formule que le temple
// de la renommée et /pool-leaderboard) : mieux classée sur la semaine que
// sur la saison → ▲, moins bien → ▼. Les trois périodes restent lues pour
// les colonnes 24 h / 7 j / 30 j.
//
// La semaine de la tendance (et de la colonne 7 j) finit à la dernière
// soirée : hier tant qu'aucun match du jour n'est commencé (ancre=soiree,
// routes/records.js). Sans quoi la tendance changeait à minuit, sans un
// match joué. Au premier match du jour, la page se relit (`bascule`).
const STANDINGS_PERIODS = [1, 7, 30];
const TENDANCE_JOURS = 7;
let periodPointsCache = null; // { poolName, promesse → { 1: Map, 7: Map, 30: Map } }
let tendanceMinuteur = null;
const TENDANCE_ATTENTE_MIN_MS = 60 * 1000;
const TENDANCE_ATTENTE_MAX_MS = 30 * 60 * 1000;

const EVO_ARROW_UP = '<svg viewBox="0 0 24 24" width="8" height="8"><path d="M12 4l8 10H4z"></path></svg>';
const EVO_ARROW_DOWN = '<svg viewBox="0 0 24 24" width="8" height="8"><path d="M12 20L4 10h16z"></path></svg>';

/**
 * Les points par période, partagés tant que la lecture court : le premier
 * rendu et celui qu'ouvre l'arrivée du direct partent à quelques
 * millisecondes d'écart, et chacun relisait les trois périodes en base.
 */
function fetchStandingsPeriodPoints(poolName) {
    if (periodPointsCache && periodPointsCache.poolName === poolName) return periodPointsCache.promesse;
    periodPointsCache = { poolName, promesse: lirePointsParPeriode(poolName) };
    return periodPointsCache.promesse;
}

async function lirePointsParPeriode(poolName) {
    const byDays = {};
    let bascule = null;
    await Promise.all(STANDINGS_PERIODS.map(async (days) => {
        const map = new Map();
        const ancre = days === TENDANCE_JOURS ? '&ancre=soiree' : '';
        try {
            const res = await fetch(`${BASE_URL}/pool-leaderboard/${encodeURIComponent(poolName)}?days=${days}${ancre}`, { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                (data.teams || []).forEach(t => map.set(t.teamName, t.points));
                if (ancre && data.bascule) bascule = data.bascule;
            }
        } catch (error) {
            console.warn(`⚠️ Could not load ${days}-day points for rank evolution:`, error);
        }
        byDays[days] = map;
    }));

    periodesDerniere = Date.now();
    planifierBasculeTendance(bascule);
    return byDays;
}

/**
 * Au premier match du jour, la tendance passe à la semaine qui finit
 * aujourd'hui : la page se relit à ce moment-là — au plus tard dans une
 * demi-heure, pour ne pas dépendre d'un minuteur que la veille de l'appareil
 * aurait retardé.
 */
function planifierBasculeTendance(bascule) {
    clearTimeout(tendanceMinuteur);
    tendanceMinuteur = null;
    const instant = Date.parse(bascule);
    if (!Number.isFinite(instant)) return;
    const attente = Math.min(Math.max(instant - Date.now(), TENDANCE_ATTENTE_MIN_MS), TENDANCE_ATTENTE_MAX_MS);
    tendanceMinuteur = setTimeout(() => {
        tendanceMinuteur = null;
        periodPointsCache = null;
        rafraichirClassementEnDirect();
    }, attente);
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
        return `<span class="st-evo st-evo-up" title="A gagné ${move} rang${move > 1 ? 's' : ''} sur 7 jours">${EVO_ARROW_UP}${move}</span>`;
    }
    if (hasData && move < 0) {
        return `<span class="st-evo st-evo-down" title="A perdu ${-move} rang${-move > 1 ? 's' : ''} sur 7 jours">${EVO_ARROW_DOWN}${-move}</span>`;
    }
    const title = hasData ? 'Rang inchangé sur 7 jours' : 'Pas assez de données récentes';
    return `<span class="st-evo st-evo-flat" title="${title}">—</span>`;
}

/**
 * « Où en suis-je ? » — la réponse, avant le tableau.
 *
 * Un tableau de onze colonnes répond à tout sauf à la seule question qu'on
 * se pose en l'ouvrant. Une phrase la donne d'abord : son rang, et ce qui le
 * sépare de la place d'au-dessus (ou d'en dessous, quand on mène).
 */
function standingsSummaryHTML(standings, poolMode) {
    const moi = localStorage.getItem('username');
    const mienne = standings.find(s => (s.members || []).includes(moi));
    if (!mienne) return '';
    const total = standings.length;
    const nom = s => escapeHtmlText(getDisplayName(s.teamName, s.members));
    const ordinal = n => n === 1 ? '1<sup>er</sup>' : `${n}<sup>e</sup>`;
    let detail;
    if (poolMode === 'head-to-head') {
        detail = `Bilan ${mienne.wins} V · ${mienne.losses} D · ${mienne.ties} N, ${fmtH2HPts(mienne.points)} points marqués.`;
    } else if (mienne.rank === 1 && total > 1) {
        const second = standings[1];
        detail = `Vous menez par <strong>${second ? mienne.points - second.points : 0} pts</strong> devant ${second ? nom(second) : '—'}.`;
    } else if (mienne.rank > 1) {
        const devant = standings[mienne.rank - 2];
        const leader = standings[0];
        detail = `<strong>${devant.points - mienne.points} pts</strong> derrière ${nom(devant)}`
            + (mienne.rank > 2 ? ` · ${leader.points - mienne.points} pts du 1<sup>er</sup>` : '') + '.';
    } else {
        detail = 'Seule équipe du pool pour l’instant.';
    }
    return `
        <div class="st-summary" role="status">
            <span class="st-summary-rank fz-display">${ordinal(mienne.rank)}<small> / ${total}</small></span>
            <span class="st-summary-txt"><strong>${nom(mienne)}</strong><span>${detail}</span></span>
        </div>`;
}

/** Comment se lit le tableau — replié, pour ceux qui le demandent. */
function standingsLegendHTML(poolMode) {
    const lignes = poolMode === 'head-to-head'
        ? [
            ['Classement', 'Selon les victoires, puis l’écart. Chaque semaine (lundi au dimanche), vous affrontez une équipe : celle qui marque le plus de points fantasy gagne le duel.'],
            ['V - D - N', 'Victoires, défaites et nulles dans vos duels.'],
            ['Pts marqués', 'Total des points fantasy de vos joueurs pendant vos duels : but 3, passe 2, tir 0,5, avantage numérique et désavantage en bonus ; gardiens : victoire 5, blanchissage 3, arrêt 0,2, but accordé −1.'],
            ['Écart', 'Points marqués moins points encaissés.'],
            ['Forme', 'Vos 5 dernières semaines, la plus récente à gauche.']
        ]
        : [
            ['Total', 'Ce qui décide du classement : les points de la saison. Patineurs : 1 par but et 1 par passe. Gardiens : 2 par victoire, 5 pour une victoire par blanchissage (pas 2 + 5), 1 par défaite en prolongation. Clubs de la LNH : 2 par victoire, 1 par défaite en prolongation.'],
            ['24 h · 7 j · 30 j', 'Les points marqués sur la période — aujourd’hui, 7 jours, 30 jours —, selon les mêmes règles que le Total. Ils ne changent pas le classement : ils montrent qui monte.'],
            ['Tendance', 'Les places qu’une équipe gagnerait (▲) ou perdrait (▼) si l’on classait seulement sur les 7 derniers jours. Elle reste celle de la veille jusqu’au premier match du jour, comme la colonne 7 j.'],
            ['PJ · B · P', 'Parties jouées, buts et passes de tout l’alignement.']
        ];
    return `
        <details class="st-legend">
            <summary>Comment lire ce classement</summary>
            <dl>${lignes.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join('')}</dl>
        </details>`;
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

// ==================== H2H — ONGLET CLASSEMENT ====================
//
// L'onglet Classement d'un pool H2H ne se lit pas comme celui d'un pool
// cumulatif : un total de points n'y dit rien seul, ce qui compte est le
// bilan (V-D-N), la tendance récente et l'échéance suivante. D'où trois
// pièces autour de la table :
//
//   1. une bande de tuiles de contexte (semaine en cours, bilan de chaque
//      participant, points marqués, prochain duel) ;
//   2. une colonne « Forme » dans la table — cinq pastilles disent mieux
//      qu'un différentiel qui monte et qui coule ;
//   3. les derniers résultats en bas, à côté du temple de la renommée.
//
// Rien de tout cela n'a besoin du réseau : le bilan, l'historique et la
// semaine en cours sont déjà dans poolData.h2hData, chargé une fois par
// FZPool. Les tuiles s'affichent donc en même temps que la table.

const H2H_FORM_LENGTH = 5;
const H2H_STRIP_MAX_RECORDS = 4;   // au-delà, la bande devient un défilé

const H2H_FORM_LABEL = { W: 'Victoire', L: 'Défaite', T: 'Nulle' };

const H2H_ICON = {
    calendrier: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`,
    graphique: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V10M12 21V4M19 21v-7"/></svg>`,
    horloge: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>`,
    trophee: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3"/></svg>`
};

/** Issue d'un duel pour une équipe : 'W', 'L', 'T', ou null si non pointé. */
function h2hOutcome(matchup, teamName) {
    if (!matchup || !matchup.winner) return null;
    if (matchup.winner === 'tie') return 'T';
    return matchup.winner === teamName ? 'W' : 'L';
}

/**
 * Les H2H_FORM_LENGTH derniers résultats de chaque équipe, du PLUS RÉCENT
 * au plus ancien — c'est l'ordre d'affichage des pastilles, et il pousse les
 * cases vides d'un début de saison à droite plutôt qu'en tête.
 */
function computeH2HForm(poolData) {
    const formes = new Map();
    const historique = (poolData.h2hData && poolData.h2hData.matchupHistory) || [];

    [...historique]
        .sort((a, b) => (a.weekNumber || 0) - (b.weekNumber || 0))
        .forEach(semaine => (semaine.matchups || []).forEach(duel => {
            [duel.team1, duel.team2].forEach(nom => {
                const issue = h2hOutcome(duel, nom);
                if (!issue) return;
                if (!formes.has(nom)) formes.set(nom, []);
                formes.get(nom).push(issue);
            });
        }));

    formes.forEach((suite, nom) => formes.set(nom, suite.slice(-H2H_FORM_LENGTH).reverse()));
    return formes;
}

function h2hFormDotsHTML(suite) {
    const resultats = suite || [];
    const vides = Math.max(0, H2H_FORM_LENGTH - resultats.length);
    const pastilles = resultats
        .map(r => `<span class="st-form-dot is-${r.toLowerCase()}" title="${H2H_FORM_LABEL[r]}"></span>`)
        .concat(Array.from({ length: vides }, () => `<span class="st-form-dot is-empty" title="Pas encore joué"></span>`))
        .join('');
    const resume = resultats.length
        ? resultats.map(r => H2H_FORM_LABEL[r]).join(', ') + ' (du plus récent au plus ancien)'
        : 'Aucun duel terminé';
    return `<span class="st-form" role="img" aria-label="${escapeAttr(resume)}">${pastilles}</span>`;
}

/** Points de pool : une décimale, mais pas de « ,0 » inutile. */
function fmtH2HPts(valeur) {
    const n = Math.round((Number(valeur) || 0) * 10) / 10;
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Différentiel signé : le « + » d'une équipe positive doit se voir. */
function fmtH2HDiff(valeur) {
    const n = Math.round((Number(valeur) || 0) * 10) / 10;
    return (n > 0 ? '+' : '') + fmtH2HPts(n);
}

/** Pourcentage de victoires façon fiche d'équipe : « .571 », nulle = demie. */
function h2hWinPct(bilan) {
    if (!bilan.gamesPlayed) return '—';
    const pct = (bilan.wins + bilan.ties / 2) / bilan.gamesPlayed;
    return pct.toFixed(3).replace(/^0/, '');
}

function h2hStripCardHTML(icone, libelle, valeur, sous) {
    return `
        <div class="h2h-strip-card">
            <span class="h2h-strip-icon">${icone}</span>
            <span class="h2h-strip-text">
                <span class="h2h-strip-label">${escapeHtmlText(libelle)}</span>
                <span class="h2h-strip-value">${escapeHtmlText(valeur)}</span>
                <span class="h2h-strip-sub">${escapeHtmlText(sous)}</span>
            </span>
        </div>`;
}

/**
 * La bande de contexte au-dessus de la table. `standings` est le classement
 * déjà calculé par renderPoolStandings — le recalculer ici ferait diverger
 * les deux affichages au premier changement de règle de départage.
 */
function renderH2HStandingsStrip(poolName, standings) {
    const bande = document.getElementById('h2hStandingsStrip');
    if (!bande) return;

    const poolData = allPoolsData[poolName];
    const h2h = (poolData && poolData.h2hData) || {};
    if (!standings.length) {
        bande.style.display = 'none';
        return;
    }

    const semaine = h2h.currentWeek || 1;
    const cartes = [];

    const aujourdhui = new Date().toLocaleDateString('fr-CA', {
        weekday: 'long', day: 'numeric', month: 'short'
    });
    cartes.push(h2hStripCardHTML(
        H2H_ICON.calendrier, 'Semaine actuelle', `Semaine ${semaine}`, `Aujourd'hui — ${aujourdhui}`
    ));

    // Bilans : le vôtre d'abord — c'est celui qu'on vient vérifier —, puis
    // les autres par rang. Au-delà de H2H_STRIP_MAX_RECORDS la bande ne dit
    // plus rien d'un coup d'œil ; la table juste dessous les porte tous.
    const mienne = myTeamIn(poolName);
    [...standings]
        .sort((a, b) => {
            if (a.teamName === mienne) return -1;
            if (b.teamName === mienne) return 1;
            return a.rank - b.rank;
        })
        .slice(0, H2H_STRIP_MAX_RECORDS)
        .forEach(equipe => {
            const nom = getDisplayName(equipe.teamName, equipe.members);
            const logo = getTeamLogoHTML(equipe.nhlTeams, 22)
                || `<span class="st-avatar-fallback">${initialsFromName(nom)}</span>`;
            cartes.push(h2hStripCardHTML(
                logo,
                `Bilan ${nom}`,
                `${equipe.wins} - ${equipe.losses} - ${equipe.ties}`,
                h2hWinPct(equipe)
            ));
        });

    const totalPour = standings.reduce((somme, e) => somme + (e.points || 0), 0);
    cartes.push(h2hStripCardHTML(
        H2H_ICON.graphique,
        'Points marqués',
        fmtH2HPts(Math.round(totalPour / standings.length)),
        'Moyenne par équipe'
    ));

    cartes.push(h2hStripCardHTML(H2H_ICON.calendrier, 'Prochain duel', ...h2hNextWeekLabels(h2h, semaine)));

    bande.innerHTML = cartes.join('');
    bande.style.display = 'flex';
}

/**
 * [valeur, sous-titre] de la tuile « Prochain duel ». Les dates se déduisent
 * du lundi de la semaine en cours : le calendrier complet vit derrière
 * /h2h/season-schedule, mais une tuile ne vaut pas un aller-retour réseau.
 */
function h2hNextWeekLabels(h2h, semaineCourante) {
    const suivante = semaineCourante + 1;

    if (h2h.seasonWeeks && suivante > h2h.seasonWeeks) {
        return ['Saison terminée', `${h2h.seasonWeeks} semaines jouées`];
    }
    if (!h2h.weekStart) {
        return [`Semaine ${suivante}`, 'Dates à confirmer'];
    }

    // Jours de calendrier ajoutés en UTC : `setDate` sur une journée lue à
    // minuit UTC travaille dans le fuseau du visiteur et décale la borne.
    const debut = h2hJourUTC(h2h.weekStart);
    if (!debut) return [`Semaine ${suivante}`, 'Dates à confirmer'];
    debut.setUTCDate(debut.getUTCDate() + 7);
    const fin = new Date(debut.getTime());
    fin.setUTCDate(fin.getUTCDate() + 7);
    return [`Semaine ${suivante}`, h2hSchedDateRange(debut, fin)];
}

/**
 * Les dernières semaines finalisées, vues du côté de votre équipe : votre
 * score à gauche, celui de l'adversaire à droite, l'issue en pastille. Sans
 * équipe dans le pool (spectateur), le premier duel de la semaine sert de
 * point de vue — mieux qu'une carte vide.
 */
function renderH2HRecentResults(poolName) {
    const container = document.getElementById('h2hRecentResults');
    if (!container) return;

    const poolData = allPoolsData[poolName];
    const historique = [...(((poolData || {}).h2hData || {}).matchupHistory || [])]
        .sort((a, b) => (b.weekNumber || 0) - (a.weekNumber || 0))
        .slice(0, 3);

    const tete = `
        <div class="fz-card-head">
            <span class="fz-card-icon">${H2H_ICON.horloge}</span>
            <h2 class="fz-card-title">Derniers résultats</h2>
            ${historique.length ? `<button type="button" class="fz-card-link" onclick="switchH2HTab('history')">Voir tout</button>` : ''}
        </div>`;

    if (!historique.length) {
        container.innerHTML = tete + fzEmptyHTML(
            H2H_ICON.horloge,
            'Aucun duel terminé',
            "Les résultats s'afficheront à la fin de la première semaine."
        );
        container.style.display = 'block';
        return;
    }

    const mienne = myTeamIn(poolName);
    // L'historique ne garde que les clés d'équipe : les membres viennent du
    // pool, pour afficher « user1 » là où la table affiche « user1 ».
    const equipes = (poolData && poolData.teams) || {};
    const nomAffiche = (cle) => getDisplayName(cle, (equipes[cle] || {}).members);

    const lignes = historique.map(semaine => {
        const duels = semaine.matchups || [];
        const duel = duels.find(m => m.team1 === mienne || m.team2 === mienne) || duels[0];
        if (!duel) return '';

        // Le point de vue : votre équipe à gauche, faute de quoi team1.
        const inverse = duel.team2 === mienne;
        const nousNom = inverse ? duel.team2 : duel.team1;
        const euxNom = inverse ? duel.team1 : duel.team2;
        const nousPts = inverse ? duel.team2Points : duel.team1Points;
        const euxPts = inverse ? duel.team1Points : duel.team2Points;

        const issue = h2hOutcome(duel, nousNom);
        const badge = { W: 'V', L: 'D', T: 'N' }[issue] || '—';
        const classeIssue = { W: 'is-win', L: 'is-loss', T: 'is-tie' }[issue] || 'is-none';

        const plage = (semaine.weekStart && semaine.weekEnd)
            ? h2hSchedDateRange(semaine.weekStart, semaine.weekEnd) : '';

        return `
            <div class="h2h-res-row">
                <span class="h2h-res-when">
                    <span class="h2h-res-week">Semaine ${semaine.weekNumber}</span>
                    <span class="h2h-res-dates">${escapeHtmlText(plage)}</span>
                </span>
                <span class="h2h-res-score">
                    <span class="h2h-res-side">
                        <span class="h2h-res-pts ${issue === 'W' ? 'is-top' : ''}">${fmtH2HPts(nousPts)}</span>
                        <span class="h2h-res-team" title="${escapeAttr(nomAffiche(nousNom))}">${escapeHtmlText(nomAffiche(nousNom))}</span>
                    </span>
                    <span class="h2h-res-sep">-</span>
                    <span class="h2h-res-side">
                        <span class="h2h-res-pts ${issue === 'L' ? 'is-top' : ''}">${fmtH2HPts(euxPts)}</span>
                        <span class="h2h-res-team" title="${escapeAttr(nomAffiche(euxNom))}">${escapeHtmlText(nomAffiche(euxNom))}</span>
                    </span>
                </span>
                <span class="h2h-res-badge ${classeIssue}">${badge}</span>
            </div>`;
    }).join('');

    container.innerHTML = `${tete}
        <div class="h2h-res-list">${lignes}</div>
        <button type="button" class="h2h-res-more" onclick="switchH2HTab('history')">Voir l'historique complet <span aria-hidden="true">&rarr;</span></button>`;
    container.style.display = 'block';
}

/** État vide d'une carte : une icône fantôme, un constat, ce qui le lèvera. */
function fzEmptyHTML(icone, titre, indice) {
    return `
        <div class="fz-empty">
            <span class="fz-empty-icon">${icone}</span>
            <p class="fz-empty-title">${escapeHtmlText(titre)}</p>
            <p class="fz-empty-hint">${escapeHtmlText(indice)}</p>
        </div>`;
}

/**
 * Le classement d'un pool dans son ordre canonique — le rang réel de chaque
 * équipe : victoires puis différentiel en H2H, points en cumulatif. Lu par
 * la table du classement et par l'en-tête de la fiche d'équipe.
 */
function computeStandings(poolData) {
    const poolMode = poolData.poolMode || 'cumulative';
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
    return standings;
}

/**
 * Numéro du dernier rendu lancé. Le premier rendu attend les points par
 * période ; le direct arrive pendant ce temps et en lance un second, avec les
 * points du soir. Le premier finissait parfois après — ses lectures
 * revenaient plus tard — et réécrivait le tableau avec les totaux de minuit,
 * jusqu'au prochain but. Un rendu dépassé ne touche plus au tableau.
 */
let renduClassement = 0;

async function renderPoolStandings(poolData, poolName) {
    const rendu = ++renduClassement;
    const poolMode = poolData.poolMode || 'cumulative';
    const standingsList = document.getElementById('standingsList');

    const standings = computeStandings(poolData);

    // Bande de contexte H2H : au-dessus de la table, et masquée d'elle-même
    // quand il n'y a pas encore d'équipe complète.
    if (poolMode === 'head-to-head') renderH2HStandingsStrip(poolName, standings);

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
    if (rendu !== renduClassement) return;
    const periodRankByTeam = byDays ? rankByPeriodPoints(standings, byDays[TENDANCE_JOURS]) : null;

    // En H2H la table vit dans une carte titrée — elle n'est plus qu'un bloc
    // parmi d'autres sur l'onglet. En cumulatif elle reste à plat sur la
    // page, avec sa liste téléphone.
    const enH2H = poolMode === 'head-to-head';
    const mobileListHTML = enH2H ? '' : '<div class="st-mobile-list"></div>';
    const tableHTML = `<div class="standings-table-container"><table id="standingsTable">${buildStandingsHead(columns, activeSortKey)}</table></div>`;

    const resumeHTML = standingsSummaryHTML(standings, poolMode);
    const legendeHTML = standingsLegendHTML(poolMode);
    standingsList.innerHTML = enH2H
        ? `${resumeHTML}<section class="fz-card st-card">
               <div class="fz-card-head">
                   <span class="fz-card-icon">${H2H_ICON.graphique}</span>
                   <h2 class="fz-card-title">Classement de la saison</h2>
               </div>
               ${tableHTML}
               ${legendeHTML}
           </section>`
        : `${resumeHTML}${tableHTML}${mobileListHTML}${legendeHTML}`;
    const table = document.getElementById('standingsTable');

    const tbody = document.createElement('tbody');
    const mobileRowsHTML = [];
    // Les pastilles de forme se lisent dans l'historique des semaines
    // finalisées, pas dans le bilan cumulé : une passe pour tout le tableau.
    const h2hForms = enH2H ? computeH2HForm(poolData) : null;
    displayList.forEach(standing => {
        const displayName = getDisplayName(standing.teamName, standing.members);
        const logoHTML = getTeamLogoHTML(standing.nhlTeams, 20);
        const avatarHTML = logoHTML || `<span class="st-avatar-fallback">${initialsFromName(displayName)}</span>`;

        const tr = document.createElement('tr');
        const estMoi = (standing.members || []).includes(localStorage.getItem('username'));
        tr.className = (standing.rank === 1 ? 'is-clickable is-leader' : 'is-clickable') + (estMoi ? ' is-me' : '');
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
            const hasData = byDays[TENDANCE_JOURS].get(standing.teamName) != null;
            evoHTML = evolutionBadgeHTML(move, hasData);
        }

        const soirHTML = enH2H ? '' : pointsSoirHTML(standing);
        const statCells = enH2H
            ? `<td>${standing.gamesPlayed}</td>
               <td class="st-vdn-col">${standing.wins} - ${standing.losses} - ${standing.ties}</td>
               <td class="st-wlt-col">${standing.wins}</td>
               <td class="st-wlt-col">${standing.losses}</td>
               <td class="st-wlt-col">${standing.ties}</td>
               <td class="points-column">${fmtH2HPts(standing.points)}</td>
               <td class="st-diff-col">${fmtH2HDiff(standing.diff)}</td>
               <td class="st-form-col">${h2hFormDotsHTML(h2hForms.get(standing.teamName))}</td>`
            : `<td>${standing.gamesPlayed}</td>
               <td>${standing.goals}</td>
               <td>${standing.assists}</td>
               <td class="st-period-col">${fmtPeriodPts(byDays[1].get(standing.teamName))}</td>
               <td class="st-period-col">${fmtPeriodPts(byDays[7].get(standing.teamName))}</td>
               <td class="st-period-col">${fmtPeriodPts(byDays[30].get(standing.teamName))}</td>
               <td class="points-column">${standing.points}${soirHTML}</td>
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
            // Maquette « Classement » (Claude Design) : rang, rond du club, nom
            // + tendance, PJ puis les points des trois périodes, Pts en gros.
            const mini = (valeur, libelle, cls = '') =>
                `<div class="st-mini${cls}${valeur ? '' : ' is-zero'}"><span class="st-mini-v">${valeur}</span><span class="st-mini-l">${libelle}</span></div>`;
            const per = d => fmtPeriodPts(byDays[d].get(standing.teamName));
            mobileRowsHTML.push(`
                <div class="st-mobile-row is-clickable${estMoi ? ' is-me' : ''}" tabindex="0" role="button" aria-label="Voir l'équipe de ${displayName}" data-team="${standing.teamName.replace(/"/g, '&quot;')}">
                    <span class="st-mobile-rank">${standing.rank}</span>
                    <span class="st-mobile-logo">${getTeamLogoHTML(standing.nhlTeams, 28) || `<span class="st-avatar-fallback">${initialsFromName(displayName)}</span>`}</span>
                    <div class="st-mobile-info">
                        <span class="st-mobile-name"><span class="st-mobile-name-txt" title="${displayName}">${displayName}</span>${evoHTML}</span>
                        <div class="st-mini-row">${mini(standing.gamesPlayed, 'PJ')}${mini(per(1), '1 j', ' has-sep')}${mini(per(7), '7 j')}${mini(per(30), '30 j')}</div>
                    </div>
                    <div class="st-mobile-pts"><span class="st-mobile-pts-v">${standing.points}${soirHTML}</span><span class="st-mini-l">Pts</span></div>
                    <span class="st-mobile-chev" aria-hidden="true">›</span>
                </div>`);
        }
    });
    table.appendChild(tbody);

    if (poolMode !== 'head-to-head') {
        const mobileList = standingsList.querySelector('.st-mobile-list');
        if (mobileList) mobileList.innerHTML = mobileRowsHTML.join('');
    }

    // Ligne « Moyenne » : elle situe une équipe dans le peloton, ce qui n'a
    // de sens que sur un classement cumulatif. En H2H la moyenne d'un bilan
    // V-D-N ne veut rien dire — chaque victoire est la défaite d'un autre.
    if (!enH2H) {
        const n = standings.length;
        const rawAvg = (key) => standings.reduce((sum, s) => sum + (s[key] || 0), 0) / n;
        const avg = (key) => Math.round(rawAvg(key));
        const avgPeriod = (days) => {
            const vals = [...byDays[days].values()].filter(v => v !== null && v !== undefined);
            return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        };
        const tfoot = document.createElement('tfoot');
        tfoot.innerHTML = `
            <tr class="standings-avg-row">
                <td class="rank-col">—</td>
                <td class="player-col standings-avg-label">Moyenne</td>
                <td>${avg('gamesPlayed')}</td>
                <td>${avg('goals')}</td>
                <td>${avg('assists')}</td>
                <td class="st-period-col">${fmtPeriodPts(avgPeriod(1))}</td>
                <td class="st-period-col">${fmtPeriodPts(avgPeriod(7))}</td>
                <td class="st-period-col">${fmtPeriodPts(avgPeriod(30))}</td>
                <td class="points-column">${avg('points')}</td>
                <td>${rawAvg('ppg').toFixed(2)}</td>
                <td class="st-evo-col">—</td>
            </tr>
        `;
        table.appendChild(tfoot);
    }

    // Délégation sur le conteneur : reconstruit à chaque tri/rendu, un
    // écouteur par <th>/.st-mobile-row fuirait à chaque passe
    // (comme initStatsHeaderSorting).
    standingsList.onclick = (e) => {
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

    // En H2H les deux blocs du bas se rangent côte à côte ; en cumulatif le
    // temple de la renommée occupe seul la pleine largeur.
    const insights = document.getElementById('standingsInsights');
    if (insights) insights.classList.toggle('is-h2h', enH2H);

    renderHallOfFame(poolName);
    if (enH2H) renderH2HRecentResults(poolName);
}

// ==================== TEMPLE DE LA RENOMMÉE ====================
// Les records de la saison (meilleure et pire journée, semaine, mois en
// points de pool), calculés côté serveur à partir des vrais matchs — voir
// GET /pool-hall-of-fame.
//
// Une tuile par période. Le record mène — le chiffre en or, l'équipe, la
// date — et le pire suit en une ligne discrète : c'est un temple, pas un
// tableau à deux colonnes de même poids. Chaque nom d'équipe ouvre sa fiche,
// comme une rangée du classement.

const HOF_PERIODES = [
    { cle: 'Day', titre: 'Meilleure journée', date: hofDateJour },
    { cle: 'Week', titre: 'Meilleure semaine', date: hofDateSemaine },
    { cle: 'Month', titre: 'Meilleur mois', date: hofDateMois }
];

/** Une journée AAAA-MM-JJ lue comme date de calendrier (minuit UTC). */
function hofJour(journee) {
    return new Date(journee + 'T00:00:00Z');
}

function hofDecaler(journee, jours) {
    const d = hofJour(journee);
    d.setUTCDate(d.getUTCDate() + jours);
    return d.toISOString().slice(0, 10);
}

/**
 * La période d'un record n'est pas finie : il peut encore tomber. Le serveur
 * compte la semaine et le mois entamés, et une « pire semaine » de trois
 * jours se lisait comme un vrai creux. `journee` est la journée, le lundi ou
 * le 1er du mois que donne /pool-hall-of-fame.
 */
function hofEnCours(cle, journee, aujourdhui) {
    if (!journee || !aujourdhui) return false;
    if (cle === 'Day') return journee === aujourdhui;
    if (cle === 'Week') return journee <= aujourdhui && aujourdhui <= hofDecaler(journee, 6);
    return journee.slice(0, 7) === aujourdhui.slice(0, 7);
}

/** Aujourd'hui en journée locale : « en cours » se juge à l'heure du lecteur. */
function hofAujourdhui() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hofFormat(journee, options) {
    return hofJour(journee).toLocaleDateString('fr-CA', { ...options, timeZone: 'UTC' });
}

/** « sam. 12 oct. » */
function hofDateJour(journee) {
    if (!journee) return '';
    return hofFormat(journee, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** « 6 – 12 oct. », ou « 29 sept. – 5 oct. » à cheval sur deux mois. Le
 *  serveur donne le lundi : la date seule laissait deviner la semaine. */
function hofDateSemaine(lundi) {
    if (!lundi) return '';
    const dimanche = hofDecaler(lundi, 6);
    const memeMois = lundi.slice(0, 7) === dimanche.slice(0, 7);
    const debut = memeMois ? String(hofJour(lundi).getUTCDate()) : hofFormat(lundi, { day: 'numeric', month: 'short' });
    return `${debut} – ${hofFormat(dimanche, { day: 'numeric', month: 'short' })}`;
}

/** « Octobre » */
function hofDateMois(premier) {
    if (!premier) return '';
    const mois = hofFormat(premier, { month: 'long' });
    return mois.charAt(0).toUpperCase() + mois.slice(1);
}

// Icône trophée pleine, reprise de l'ancien tableau.
function trophyIconHTML(cls) {
    return `<svg class="hof-icon ${cls}" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M5 4h14v2h2v3a5 5 0 0 1-5 5h-.26A6 6 0 0 1 13 17.65V20h3v2H8v-2h3v-2.35A6 6 0 0 1 8.26 14H8a5 5 0 0 1-5-5V6h2V4zm0 4H5v1a3 3 0 0 0 2.6 2.97A8.9 8.9 0 0 1 5 8zm14 0a8.9 8.9 0 0 1-2.6 3.97A3 3 0 0 0 19 9V8z"></path></svg>`;
}

/**
 * Le nom d'une équipe du temple : un bouton vers sa fiche si l'équipe est
 * encore dans le pool, du texte sinon. `avecLogo` pour la ligne du record.
 */
function hofEquipeHTML(entry, ctx, cls, avecLogo) {
    const equipe = ctx.equipes[entry.teamName];
    const nom = getDisplayName(entry.teamName, entry.members);
    const logo = avecLogo
        ? `<span class="hof-avatar">${(equipe && getTeamLogoHTML(equipe.teams, 14))
            || `<span class="st-avatar-fallback">${escapeHtmlText(initialsFromName(nom))}</span>`}</span>`
        : '';
    const moi = entry.teamName === ctx.mienne ? '<span class="hof-me">Vous</span>' : '';
    const contenu = `${logo}<span class="hof-team-name">${escapeHtmlText(nom)}</span>${moi}`;
    if (!equipe) return `<span class="${cls}" title="${escapeAttr(nom)}">${contenu}</span>`;
    return `<button type="button" class="${cls} is-link" data-hof-team="${escapeAttr(entry.teamName)}"
                title="Voir l’équipe ${escapeAttr(nom)}">${contenu}</button>`;
}

function hofQuandHTML(entry, periode, ctx, cls) {
    const enCours = hofEnCours(periode.cle, entry.date, ctx.aujourdhui)
        ? '<span class="hof-live">en cours</span>' : '';
    return `<span class="${cls}">${escapeHtmlText(periode.date(entry.date))}${enCours}</span>`;
}

function hofTuileHTML(periode, best, worst, ctx) {
    const record = best
        ? `<div class="hof-record">
                <span class="hof-pts">${fmtPeriodPts(best.points)}<small>pts</small></span>
                <span class="hof-who">
                    ${hofEquipeHTML(best, ctx, 'hof-team', true)}
                    ${hofQuandHTML(best, periode, ctx, 'hof-when')}
                </span>
            </div>`
        : `<div class="hof-record is-empty"><span class="hof-pts">—</span><span class="hof-when">Aucun match encore</span></div>`;
    // Une seule équipe a joué : son meilleur est aussi son pire, inutile de
    // le répéter.
    const memeEntree = best && worst && best.teamName === worst.teamName
        && best.date === worst.date && best.points === worst.points;
    const pire = worst && !memeEntree
        ? `<div class="hof-low">
                <span class="hof-low-label">Pire</span>
                <span class="hof-low-pts">${fmtPeriodPts(worst.points)}<small>pts</small></span>
                ${hofEquipeHTML(worst, ctx, 'hof-low-team', false)}
                ${hofQuandHTML(worst, periode, ctx, 'hof-low-when')}
            </div>`
        : '';
    return `
        <article class="hof-tile">
            <h3 class="hof-tile-label">${trophyIconHTML('is-best')}${periode.titre}</h3>
            ${record}
            ${pire}
        </article>`;
}

function hofTeteHTML(saison) {
    let libelle = 'Saison en cours';
    if (typeof seasonLabel === 'function') {
        try { libelle = `Saison ${seasonLabel(saison || currentSeasonId())}`; } catch (_) { /* libellé générique */ }
    }
    // Les classes fz-* portent l'en-tête de carte du mode H2H ; en cumulatif
    // le titre reste en capitales, la saison en pastille à droite.
    return `
        <div class="hof-head fz-card-head">
            <span class="fz-card-icon">${H2H_ICON.trophee}</span>
            <h2 class="hof-title fz-card-title">Temple de la renommée</h2>
            <span class="hof-season fz-card-note">${escapeHtmlText(libelle)}</span>
        </div>`;
}

/**
 * Trois tuiles fantômes, le temps que /pool-hall-of-fame réponde — et dans
 * le squelette du classement. Les vrais titres restent ; des os prennent la
 * place du record, de l'équipe, de la date et de la ligne « Pire », dans la
 * structure de la tuile chargée (hofTuileHTML) : elle garde sa forme.
 */
function hofChargementHTML() {
    const tuiles = HOF_PERIODES.map(periode => `
        <div class="hof-tile is-loading" aria-hidden="true">
            <span class="hof-tile-label">${trophyIconHTML('is-best')}${periode.titre}</span>
            <div class="hof-record">
                <span class="fz-bone hof-sk-pts"></span>
                <span class="hof-who">
                    <span class="hof-team"><span class="hof-avatar fz-bone"></span><span class="fz-bone hof-sk-name"></span></span>
                    <span class="hof-sk-flat hof-sk-when"></span>
                </span>
            </div>
            <div class="hof-low">
                <span class="hof-low-label">Pire</span>
                <span class="hof-sk-flat hof-sk-low-pts"></span>
                <span class="hof-sk-flat hof-sk-low-team"></span>
                <span class="hof-sk-flat hof-sk-low-when"></span>
            </div>
        </div>`).join('');
    return `${hofTeteHTML(null)}<div class="hof-grid" aria-busy="true">${tuiles}</div>`;
}

function buildHallOfFameHTML(data, poolName) {
    const head = hofTeteHTML(data && data.season);
    if (data && data.seasonStarted === false) {
        return head + fzEmptyHTML(H2H_ICON.trophee,
            "La saison n'est pas commencée",
            "Les records s'écriront au premier match.");
    }
    if (!data || (!data.bestDay && !data.bestWeek && !data.bestMonth)) {
        return head + fzEmptyHTML(H2H_ICON.trophee,
            'Pas encore de records',
            "Il faut au moins un match joué cette saison.");
    }
    const ctx = {
        equipes: (allPoolsData[poolName] && allPoolsData[poolName].teams) || {},
        mienne: myTeamIn(poolName),
        aujourdhui: hofAujourdhui()
    };
    const tuiles = HOF_PERIODES
        .map(p => hofTuileHTML(p, data[`best${p.cle}`], data[`worst${p.cle}`], ctx))
        .join('');
    return `${head}<div class="hof-grid">${tuiles}</div>`;
}

async function renderHallOfFame(poolName) {
    const container = document.getElementById('hallOfFame');
    if (!container) return;

    // Le classement cumulatif se redessine toutes les 20 s pendant les
    // matchs : on garde alors le temple affiché pendant qu'il se relit, les
    // tuiles fantômes ne servent qu'à la première ouverture du pool.
    const dejaAffiche = container.dataset.pool === poolName && container.style.display !== 'none';
    if (!dejaAffiche) {
        container.dataset.pool = poolName;
        container.innerHTML = hofChargementHTML();
        container.style.display = 'block';
    }
    container.onclick = (e) => {
        const bouton = e.target.closest('[data-hof-team]');
        if (bouton) showTeamRoster(poolName, bouton.dataset.hofTeam);
    };

    try {
        const response = await fetch(`${BASE_URL}/pool-hall-of-fame/${encodeURIComponent(poolName)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (currentPoolName !== poolName) return;
        container.innerHTML = buildHallOfFameHTML(data, poolName);
        container.style.display = 'block';
    } catch (error) {
        console.warn('⚠️ Could not load hall of fame:', error);
        // Un rafraîchissement raté laisse les records déjà affichés.
        if (!dejaAffiche && currentPoolName === poolName) container.style.display = 'none';
    }
}

// Level 3: Team Roster View
function showTeamRoster(poolName, teamName) {
    currentView = VIEW_STATES.TEAM_ROSTER;
    document.getElementById('poolHeaderMeta').style.display = 'none';
    currentPoolName = poolName;
    currentTeamName = teamName;

    const poolData = allPoolsData[poolName];
    const teamData = poolData.teams[teamName];
    if (!teamData) return;

    // Update UI — la fiche a son propre en-tête (renderRosterHeader) : le
    // titre commun de la page s'efface le temps qu'elle est affichée.
    setRosterViewMode(true);
    const displayTeamName = getDisplayName(teamName, teamData.members || []);
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

    // Un pool sans échanges n'a rien à mettre en vente : on saute l'appel
    // aux annonces et le bouton disparaît de la fiche. Seule l'équipe
    // elle-même peut mettre ses joueurs en vente.
    const tradesAllowed = poolData.allowTrades !== false;
    rosterSale = {
        poolName,
        teamName,
        canSell: tradesAllowed && (teamData.members || []).includes(localStorage.getItem('username')),
        listings: {},
        players: []
    };
    renderRosterHeader(poolName, teamName);

    // Le squelette, rangée pour rangée, le temps de lire les annonces. Le
    // compte des actifs est connu d'avance : la ligne de l'en-tête est
    // complète dès maintenant.
    const actifs = actifsDeLaFiche(teamData);
    const compteActifs = document.querySelector('#rosterHeader .rh-count');
    if (compteActifs) compteActifs.textContent = `${actifs.length} actif${actifs.length > 1 ? 's' : ''}`;
    const squelette = document.getElementById('rosterSkeleton');
    squelette.innerHTML = rosterSqueletteHTML(actifs);
    squelette.style.display = 'block';
    document.getElementById('rosterList').style.display = 'none';

    // Render roster after short delay — fetch this team's active for-sale
    // listings first so the marks start in the right state on first paint.
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
        // Le sélecteur d'équipe a pu changer de fiche pendant l'appel.
        if (currentView !== VIEW_STATES.TEAM_ROSTER || currentTeamName !== teamName || currentPoolName !== poolName) return;
        renderTeamRoster(teamData, activeListings);
    }, 100);
}

/**
 * Les actifs d'une fiche, dans l'ordre de la liste (renderTeamRoster) :
 * attaquants, défenseurs, gardiens, recrues, puis les clubs. Le type dit
 * quels libellés porte la rangée — une recrue gardienne compte en gardienne.
 */
function actifsDeLaFiche(roster) {
    const actifs = [];
    ['offensive', 'defensive', 'goalie', 'rookie'].forEach(categorie => {
        (roster[categorie] || []).forEach(nom => {
            actifs.push({ nom, type: ficheJoueur(nom, categorie).gardien ? 'goalie' : 'player' });
        });
    });
    (roster.teams || []).forEach(nom => actifs.push({ nom, type: 'team' }));
    return actifs;
}

/**
 * Le squelette de la fiche : une rangée par actif, aux classes de la liste
 * chargée (.roster-row) — rien ne bouge à l'arrivée des données. Le rang et
 * les libellés (PJ, B, P, Pts ; V, BL pour un gardien ; V, DP pour un club)
 * sont les vrais ; des os prennent la place de la photo, du nom, du club et
 * des chiffres. Les longueurs de nom suivent celles des vrais noms.
 */
function rosterSqueletteHTML(actifs) {
    const LIBELLES = { player: ['B', 'P'], goalie: ['V', 'BL'], team: ['V', 'DP'] };
    const os = (cls, largeur) => `<span class="fz-bone ${cls}"${largeur ? ` style="--w:${largeur}px"` : ''}></span>`;
    const stat = (largeur, libelle) => `<div class="rr-stat">${os('rr-sk-v', largeur)}<span class="rr-l">${libelle}</span></div>`;
    const rangees = actifs.map((a, i) => {
        const [l1, l2] = LIBELLES[a.type];
        const nom = Math.max(64, Math.min(150, a.nom.length * 7.5));
        return `
            <div class="roster-row" style="--i:${i}">
                <div class="rr-rank">${i + 1}</div>
                <div class="rr-shot"><div class="rr-avatar fz-bone"></div></div>
                <div class="rr-main">
                    <div class="rr-name-line">${os('rr-sk-name', Math.round(nom))}<span class="rr-sk-meta"></span></div>
                    <div class="rr-stats">${stat(12, 'PJ')}${stat(8, l1)}${stat(8, l2)}${stat(12, 'Pts')}</div>
                </div>
                <div class="rr-soiree"><span class="st-sk-evo rr-sk-evo"></span></div>
                <div class="rr-ppts">${os('rr-sk-pts')}<span class="rr-l">PPts</span></div>
                <span class="rr-chev">›</span>
            </div>`;
    }).join('');
    return `<p class="st-sk-sr" role="status">Chargement des joueurs…</p>
        <div class="roster-rows" inert>${rangees}</div>`;
}

/** La fiche d'équipe remplace le titre commun de la page par le sien. */
function setRosterViewMode(on) {
    document.body.classList.toggle('fz-view-roster', on);
}

const RH_ICON = {
    back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    caret: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'
};
const tagIcon = size => (typeof getIcon === 'function' ? getIcon('tag', size) : '');

/**
 * L'en-tête de la fiche d'équipe. Sur téléphone, le fil d'Ariane (trois
 * liens de 12px) laisse la place à un vrai bouton de retour. Le nom de
 * l'équipe ouvre la liste des équipes du pool — un <select> posé dessus,
 * donc la roulette native du téléphone — et la ligne dessous dit où
 * l'équipe se situe. Le bouton « Mettre en vente » n'existe que sur sa
 * propre équipe : un seul point d'entrée au lieu d'un bouton par rangée.
 */
/** « 3<sup>e</sup> sur 10 · 245 pts » : où l'équipe se situe, ou '' hors classement. */
function sousTitreFiche(poolData, standings, teamName) {
    const moi = standings.find(s => s.teamName === teamName);
    if (!moi) return '';
    const rang = moi.rank === 1 ? '1<sup>er</sup>' : `${moi.rank}<sup>e</sup>`;
    const bilan = (poolData.poolMode || 'cumulative') === 'head-to-head'
        ? `${moi.wins}-${moi.losses}-${moi.ties}`
        : `${Math.round(moi.points).toLocaleString('fr-CA')} pts`;
    return `${rang} sur ${standings.length} · ${bilan}`;
}

function renderRosterHeader(poolName, teamName) {
    const poolData = allPoolsData[poolName];
    const teamData = poolData.teams[teamName];
    const standings = computeStandings(poolData);
    const moi = standings.find(s => s.teamName === teamName);
    const sous = sousTitreFiche(poolData, standings, teamName);

    const picker = moi && standings.length > 1 ? `
        <select class="rh-picker" aria-label="Voir une autre équipe du pool">
            ${standings.map(s => `<option value="${escapeAttr(s.teamName)}"${s.teamName === teamName ? ' selected' : ''}>${s.rank}. ${escapeHtmlText(getDisplayName(s.teamName, s.members))}</option>`).join('')}
        </select>` : '';

    // Une seule rangée — retour, nom, mise en vente — et une ligne dessous
    // qui dit tout le reste : rang, bilan, nombre d'actifs (renderTeamRoster).
    // La grille de .roster-header place chaque morceau (classement.css,
    // classement-premium.css sur téléphone).
    const header = document.getElementById('rosterHeader');
    header.innerHTML = `
        <button type="button" class="rh-back" data-rh-back aria-label="Retour au classement">${RH_ICON.back}</button>
        <div class="rh-title${picker ? ' has-picker' : ''}">
            <h1 class="rh-name">${escapeHtmlText(getDisplayName(teamName, teamData.members || []))}</h1>
            ${picker ? `<span class="rh-caret">${RH_ICON.caret}</span>${picker}` : ''}
        </div>
        ${rosterSale.canSell ? `
        <button type="button" class="rh-sale" data-rh-sale aria-haspopup="dialog" aria-label="Mettre en vente">
            ${tagIcon(14)}<span class="rh-sale-long">Mettre en vente</span><span class="rh-sale-count" hidden></span>
        </button>` : ''}
        <p class="rh-sub"><span class="rh-rank">${sous}</span><span class="rh-count"></span></p>`;

    header.querySelector('[data-rh-back]').addEventListener('click', () => showPoolStandings(poolName));
    const select = header.querySelector('.rh-picker');
    if (select) select.addEventListener('change', () => showTeamRoster(poolName, select.value));
    const vendre = header.querySelector('[data-rh-sale]');
    if (vendre) vendre.addEventListener('click', openSaleSheet);
}

// ==================== MISE EN VENTE ====================
// Mettre un joueur « en vente » le signale aux autres équipes comme
// disponible — un signal seulement ; la règle d'échange 1 pour 1 dans la
// même catégorie ne change pas. Tout passe par un panneau unique, ouvert
// depuis l'en-tête de sa propre équipe ; la liste n'en garde qu'une marque.

/** La fiche affichée : qui peut vendre, les annonces actives, les joueurs. */
let rosterSale = { poolName: null, teamName: null, canSell: false, listings: {}, players: [] };

async function setForSale(player, veutVendre) {
    const username = localStorage.getItem('username');
    if (!username) return false;
    const annonce = rosterSale.listings[player.name];
    try {
        if (!veutVendre) {
            if (!annonce) return true;
            const res = await fetch(`${BASE_URL}/trade-listings/${annonce.id}/remove`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                fzAlert({ type: 'error', title: 'Retrait impossible', message: data.message || 'Impossible de retirer ce joueur de la vente.' });
                return false;
            }
            delete rosterSale.listings[player.name];
        } else {
            if (annonce) return true;
            const res = await fetch(`${BASE_URL}/trade-listings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    poolName: rosterSale.poolName,
                    teamName: rosterSale.teamName,
                    playerName: player.name,
                    category: player.category,
                    username
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                fzAlert({ type: 'error', title: 'Mise en vente impossible', message: data.message || 'Impossible de mettre ce joueur en vente.' });
                return false;
            }
            rosterSale.listings[player.name] = { id: data.id, playerName: player.name };
        }
        return true;
    } catch (err) {
        console.error('Error toggling trade listing:', err);
        fzAlert({ type: 'error', icon: 'offline', title: 'Connexion impossible', message: 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.' });
        return false;
    }
}

/** Les marques « En vente » de la liste et le compteur du bouton d'en-tête. */
function refreshSaleMarks() {
    document.querySelectorAll('#rosterList .roster-row[data-player]').forEach(row => {
        row.classList.toggle('is-for-sale', !!rosterSale.listings[row.dataset.player]);
    });
    const compte = document.querySelector('#rosterHeader .rh-sale-count');
    if (compte) {
        const n = Object.keys(rosterSale.listings).length;
        compte.textContent = n;
        compte.hidden = !n;
        compte.closest('.rh-sale').setAttribute('aria-label', n
            ? `Mettre en vente — ${n} joueur${n > 1 ? 's' : ''} en vente`
            : 'Mettre en vente');
    }
}

/**
 * Le panneau de mise en vente : un interrupteur par joueur, appliqué tout
 * de suite. Feuille qui monte du bas sur téléphone, fenêtre centrée sur
 * grand écran. Échap, le fond ou « Terminé » le ferment.
 */
function openSaleSheet() {
    if (!rosterSale.canSell || document.querySelector('.ss-overlay')) return;
    // Le focus revient au bouton d'en-tête à la fermeture — Safari ne le
    // lui donne pas au clic, activeElement serait le corps de la page.
    const retour = document.querySelector('#rosterHeader [data-rh-sale]');
    const joueurs = rosterSale.players;

    const overlay = document.createElement('div');
    overlay.className = 'ss-overlay';
    overlay.innerHTML = `
        <div class="ss-sheet" role="dialog" aria-modal="true" aria-labelledby="ssTitle" aria-describedby="ssHint">
            <div class="ss-head">
                <h2 class="ss-title" id="ssTitle">Mettre en vente</h2>
                <button type="button" class="ss-close" data-ss-close aria-label="Fermer">${RH_ICON.close}</button>
                <p class="ss-hint" id="ssHint">Les autres équipes voient vos joueurs en vente comme disponibles pour un échange.</p>
            </div>
            <ul class="ss-list">
                ${joueurs.map((j, i) => `
                <li>
                    <label class="ss-row" for="ssSwitch${i}">
                        ${j.avatarHTML}
                        <span class="ss-id">
                            <span class="ss-name">${escapeHtmlText(j.name)}</span>
                            <span class="ss-meta">${escapeHtmlText(j.meta)} · ${j.points} PPts</span>
                        </span>
                        <input type="checkbox" role="switch" class="ss-switch" id="ssSwitch${i}" data-i="${i}"${rosterSale.listings[j.name] ? ' checked' : ''}>
                    </label>
                </li>`).join('')}
            </ul>
            <div class="ss-foot">
                <button type="button" class="ss-done" data-ss-close>Terminé</button>
            </div>
        </div>`;

    const sheet = overlay.querySelector('.ss-sheet');
    const enCours = new Set();
    let ferme = false;

    function fermer() {
        if (ferme) return;
        ferme = true;
        document.documentElement.classList.remove('ss-lock');
        overlay.classList.add('is-leaving');
        const retirer = () => overlay.remove();
        overlay.addEventListener('animationend', e => { if (e.target === sheet) retirer(); });
        setTimeout(retirer, 260);   // mouvement réduit : pas d'animationend
        if (retour && document.contains(retour)) retour.focus({ preventScroll: true });
    }

    overlay.addEventListener('click', e => {
        if (e.target === overlay || e.target.closest('[data-ss-close]')) fermer();
    });

    overlay.addEventListener('change', async e => {
        const sw = e.target.closest('.ss-switch');
        if (!sw) return;
        const i = Number(sw.dataset.i);
        // Un appel à la fois par joueur : un double toucher ne crée pas deux annonces.
        if (enCours.has(i)) { sw.checked = !sw.checked; return; }
        enCours.add(i);
        const rangee = sw.closest('.ss-row');
        rangee.classList.add('is-busy');
        const ok = await setForSale(joueurs[i], sw.checked);
        if (!ok) sw.checked = !sw.checked;
        rangee.classList.remove('is-busy');
        enCours.delete(i);
        refreshSaleMarks();
    });

    overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); fermer(); return; }
        if (e.key !== 'Tab') return;
        // Le focus reste dans le panneau : derrière, rien n'est accessible.
        const liste = [...sheet.querySelectorAll('button, input')];
        const premier = liste[0];
        const dernier = liste[liste.length - 1];
        if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
        else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    });

    document.documentElement.classList.add('ss-lock');
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
        (sheet.querySelector('.ss-switch') || sheet.querySelector('.ss-done')).focus({ preventScroll: true });
    });
}

function renderTeamRoster(roster, activeListings = []) {
    const rosterList = document.getElementById('rosterList');
    rosterList.innerHTML = '';

    // Les annonces actives de l'équipe : une marque « En vente » dans la
    // liste, visible de tous, et l'état de départ du panneau de mise en
    // vente (openSaleSheet), réservé à l'équipe elle-même.
    rosterSale.listings = {};
    rosterSale.players = [];
    activeListings.forEach(l => { rosterSale.listings[l.playerName] = l; });

    const players = [];

    // Chaque choix paraît, case par case — même un joueur que
    // nhl_filtered_stats.json ne connaît pas (voir ficheJoueur). Une recrue
    // gardienne est comptée en gardienne.
    const POSITION_PAR_DEFAUT = { offensive: 'F', defensive: 'D', goalie: 'G', rookie: 'R' };
    ['offensive', 'defensive', 'goalie', 'rookie'].forEach(category => {
        (roster[category] || []).forEach(playerName => {
            const fiche = ficheJoueur(playerName, category);
            const stats = getCurrentPlayerStats(playerName, fiche.playerId);
            players.push({
                name: playerName,
                position: fiche.gardien ? 'G' : (fiche.position || POSITION_PAR_DEFAUT[category]),
                type: fiche.gardien ? 'goalie' : 'player',
                category,
                playerId: fiche.playerId || stats?.playerId || null,
                stats: stats,
                cached: fiche.cache,
                teamAbbrev: stats?.teamAbbrev || fiche.club
            });
        });
    });

    // Add teams
    (roster.teams || []).forEach(teamName => {
        const teamInfo = ficheClub(teamName);
        const stats = getCurrentTeamStats(teamName);
        players.push({
            name: teamName,
            position: 'TEAM',
            type: 'team',
            category: 'team',
            stats: stats,
            // Le relevé de minuit, pour la colonne PJ (statsDeRangee).
            base: getCurrentTeamStats(teamName, currentTeamsBase),
            cached: teamInfo,
            teamAbbrev: stats?.teamAbbrev || NHL_ABBREV[teamName] || ''
        });
    });

    // Meilleur et pire choix du pool, par catégorie : repères des rangées.
    const extremes = extremesDuPool(allPoolsData[currentPoolName]);

    // Liste « comfortable » (Claude Design, Roster Table v2) : une bande
    // continue de rangées de 76px séparées d'un filet, plutôt qu'une carte
    // par joueur. Sur une bande étroite, le prénom se réduit à son initiale
    // — requêtes de conteneur sur .roster-rows (classement.css).
    const bloc = document.createElement('section');
    bloc.className = 'roster-block';
    bloc.setAttribute('aria-label', 'Joueurs actifs');
    // Le compte des actifs va dans la ligne de l'en-tête, plus une ligne à lui.
    const compteActifs = document.querySelector('#rosterHeader .rh-count');
    if (compteActifs) compteActifs.textContent = `${players.length} actif${players.length > 1 ? 's' : ''}`;
    const rangees = document.createElement('div');
    rangees.className = 'roster-rows';
    bloc.appendChild(rangees);
    rosterList.appendChild(bloc);

    players.forEach((player, index) => {
        const row = document.createElement('div');
        row.className = 'roster-row';
        row.dataset.player = player.name;

        // Only make clickable if it has a playerId (not teams)
        if (player.playerId) {
            row.classList.add('clickable');
            row.onclick = () => showCareerStats(player.playerId, player.name, player.type === 'goalie');
        }

        const pickNumber = index + 1;
        const estClub = player.type === 'team';

        // Get player image
        let imageHTML = '';
        if (estClub) {
            const teamLogo = `teams/${player.teamAbbrev}.png`;
            imageHTML = `<img src="${escapeAttr(teamLogo)}" alt="${escapeAttr(player.name)}" onerror="this.style.display='none'">`;
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

            // Sur la couleur du club, comme à l'onglet Alignements. Les
            // initiales restent dessous : une photo qui ne charge pas se
            // retire et les découvre. data-no-lazy : lazy-load.js poserait un
            // carré gris opaque par-dessus la couleur le temps du chargement ;
            // le loading="lazy" du navigateur suffit.
            const initiales = escapeHtmlText(initialsFromName(player.name || ''));
            imageHTML = (headshot
                ? `<img src="${escapeAttr(headshot)}" alt="${escapeAttr(player.name)}" loading="lazy" data-no-lazy onerror="this.remove()">`
                : '') + `<div class="rr-initials">${initiales || escapeHtmlText(player.position)}</div>`;
        }

        const soiree = soireeDe(player);
        const chiffres = statsDeRangee(player, soiree);
        const { points } = chiffres;
        const ppa = ppaDe(soiree);

        // Get team abbreviation for display
        const teamAbbrev = player.teamAbbrev || '';
        // `teamAbbrevs` liste parfois les clubs d'une saison (« TOR,MTL ») :
        // le dernier est l'actuel.
        const club = String(teamAbbrev).split(',').pop().trim();
        const meta = [club, estClub ? 'Équipe' : player.position].filter(Boolean).join(' · ');

        // « N. Kucherov » quand la bande est trop étroite pour le nom complet.
        const mots = player.name.split(' ');
        const nomCourt = !estClub && mots.length > 1 ? `${mots[0][0]}. ${mots.slice(1).join(' ')}` : '';
        const nomHTML = nomCourt
            ? `<span class="rr-name-full">${escapeHtmlText(player.name)}</span><span class="rr-name-short">${escapeHtmlText(nomCourt)}</span>`
            : escapeHtmlText(player.name);

        const avatarHTML = `
            <div class="rr-avatar${estClub ? ' is-club' : ' fz-shot'}"${estClub ? '' : ` style="${clubShotStyle(teamAbbrev)}"`}>
                ${imageHTML}
            </div>`;
        // Le panneau de mise en vente reprend la même photo et la même ligne.
        rosterSale.players.push({ name: player.name, category: player.category, meta, points, avatarHTML });

        // « En vente » : une pastille après le club · position quand la bande
        // a la place, une étiquette sur la photo sinon (classement.css).
        row.innerHTML = `
            <div class="rr-rank">${pickNumber}</div>
            <div class="rr-shot">
                ${avatarHTML}
                <span class="rr-sale-dot" aria-hidden="true">${tagIcon(10)}</span>
            </div>
            <div class="rr-main">
                <div class="rr-name-line">
                    <span class="rr-name">${nomHTML}</span>${estClub ? '' : injBadge(player.name, teamAbbrev)}
                    <span class="rr-meta">${escapeHtmlText(meta)}</span>
                    <span class="rr-sale">En vente</span>
                </div>
                <div class="rr-stats">${statsRangeeHTML(chiffres)}</div>
            </div>
            <div class="rr-soiree">${soireeBadgeHTML(ppa)}</div>
            <div class="rr-ppts${points ? '' : ' is-zero'}"><span class="rr-marks">${marquesHTML(player, points, soiree, extremes)}</span><span class="rr-v">${points}</span><span class="rr-l">PPts</span></div>
            <span class="rr-chev" aria-hidden="true">${player.playerId ? '›' : ''}</span>
        `;

        rangees.appendChild(row);
    });
    rosterAffiche = players;

    refreshSaleMarks();
    renderBenchPanel(rosterList, roster);

    // Hide skeleton, show content
    document.getElementById('rosterSkeleton').style.display = 'none';
    rosterList.style.display = 'flex';

    // La soirée de l'équipe affichée : repères, pastille de la soirée et PJ du soir.
    if (soireeFiche.cle !== cleFicheAffichee()) soireeFiche = { cle: null, joueurs: {}, clubs: {}, bascule: null };
    chargerSoireeFiche();
}

/** Les rangées de la fiche affichée, telles que renderTeamRoster les a bâties. */
let rosterAffiche = [];

/**
 * Les chiffres d'une rangée de fiche : matchs, deux statistiques, points de pool.
 *
 * PJ compte le match du soir dès la mise au jeu : `soiree.mj`, les matchs
 * commencés que le relevé de minuit ne compte pas encore (soireeDe). Un club
 * part alors de son relevé de minuit (`base`) : le direct ajoute déjà à sa
 * fiche les victoires et défaites en prolongation du soir, qui seraient
 * comptées deux fois.
 */
function statsDeRangee(player, soiree) {
    const s = key => seasonStat(player.stats, player.cached, key);
    const mj = (seasonStarted && soiree && soiree.mj) || 0;
    const gp = (soiree && player.type === 'team' && player.base
        ? seasonStat(player.base, player.cached, 'gamesPlayed')
        : s('gamesPlayed')) + mj;
    if (player.type === 'goalie') {
        const wins = s('wins'), shutouts = s('shutouts');
        return { gp, stat1: wins, stat1Label: 'V', stat2: shutouts, stat2Label: 'BL',
            points: goaliePoolPoints({ shutouts, wins, otLosses: s('otLosses') }) };
    }
    if (player.type === 'team') {
        const wins = s('wins'), otLosses = s('otLosses');
        return { gp, stat1: wins, stat1Label: 'V', stat2: otLosses, stat2Label: 'DP',
            points: clubPoolPoints({ wins, otLosses }) };
    }
    return { gp, stat1: s('goals'), stat1Label: 'B', stat2: s('assists'), stat2Label: 'P', points: s('points') };
}

function statsRangeeHTML(chiffres) {
    const { gp, stat1, stat1Label, stat2, stat2Label, points } = chiffres;
    // Un zéro s'efface : l'œil va droit aux joueurs qui ont produit.
    const stat = (valeur, libelle) =>
        `<div class="rr-stat${valeur ? '' : ' is-zero'}"><span class="rr-v">${valeur}</span><span class="rr-l">${libelle}</span></div>`;
    return `${stat(gp, 'PJ')}${stat(stat1, stat1Label)}${stat(stat2, stat2Label)}${stat(points, 'Pts')}`;
}

/**
 * La fiche d'équipe affichée suit les points du soir. Seuls les chiffres de
 * chaque rangée, ses repères et la ligne de rang de l'en-tête sont réécrits :
 * le banc, le panneau de mise en vente et le sélecteur d'équipe restent tels
 * quels, et aucune requête ne part.
 */
function rafraichirFicheEnDirect() {
    if (currentView !== VIEW_STATES.TEAM_ROSTER || !currentPoolName || !currentTeamName) return;
    const poolData = allPoolsData[currentPoolName];
    if (!poolData || !rosterAffiche.length) return;

    const extremes = extremesDuPool(poolData);
    const parNom = new Map(rosterAffiche.map(p => [p.name, p]));
    document.querySelectorAll('#rosterList .roster-row[data-player]').forEach(row => {
        const player = parNom.get(row.dataset.player);
        if (!player) return;
        if (player.type === 'team') {
            player.stats = getCurrentTeamStats(player.name);
            player.base = getCurrentTeamStats(player.name, currentTeamsBase);
        } else {
            player.stats = getCurrentPlayerStats(player.name, player.playerId);
        }
        const soiree = soireeDe(player);
        const chiffres = statsDeRangee(player, soiree);
        const bloc = row.querySelector('.rr-stats');
        if (bloc) bloc.innerHTML = statsRangeeHTML(chiffres);
        const ppts = row.querySelector('.rr-ppts');
        if (ppts) {
            ppts.classList.toggle('is-zero', !chiffres.points);
            ppts.querySelector('.rr-v').textContent = chiffres.points;
        }
        const pastille = row.querySelector('.rr-soiree');
        if (pastille) pastille.innerHTML = soireeBadgeHTML(ppaDe(soiree));
        const marques = row.querySelector('.rr-marks');
        if (marques) marques.innerHTML = marquesHTML(player, chiffres.points, soiree, extremes);
        const vente = rosterSale.players.find(v => v.name === player.name);
        if (vente) vente.points = chiffres.points;
    });

    const sous = document.querySelector('#rosterHeader .rh-rank');
    const texte = sousTitreFiche(poolData, computeStandings(poolData), currentTeamName);
    if (sous && texte) sous.innerHTML = texte;
}

// ==================== SOIRÉE DES JOUEURS (FICHE D'ÉQUIPE) ====================
// Ce que la fiche montre de la soirée de chacun (/live-roster, voir
// soireesDuJour dans lib/pointsEnDirect.js) : un repère s'il joue en ce
// moment ou plus tard aujourd'hui, la pastille des points de sa dernière
// soirée — gardée jusqu'au premier match du lendemain — et PJ, qui compte son
// match dès la mise au jeu. Relue à chaque point qui tombe, et en attendant
// les mises au jeu et les fins de match. Le serveur la tire du calcul du
// direct : aucun appel de plus à la LNH.

let soireeFiche = { cle: null, joueurs: {}, clubs: {}, bascule: null };
let soireeMinuteur = null;
let soireeRelecture = null;
const SOIREE_EN_JEU_MS = 60 * 1000;
const SOIREE_MAX_MS = 30 * 60 * 1000;

const SOIREE_TITRE = 'jusqu’au premier match du jour suivant';

const cleFicheAffichee = () => `${currentPoolName}|${currentTeamName}`;

/** L'abréviation du club d'une rangée (« TOR,MTL » : le dernier est l'actuel). */
function clubDeRangee(player) {
    return String(player.teamAbbrev || '').split(',').pop().trim().toUpperCase();
}

/** La soirée d'une rangée ; undefined tant que celle de l'équipe affichée n'est pas lue. */
function soireeDe(player) {
    if (soireeFiche.cle !== cleFicheAffichee()) return undefined;
    const club = player.type === 'team';
    const table = club ? soireeFiche.clubs : soireeFiche.joueurs;
    const cle = club ? clubDeRangee(player) : player.playerId;
    return (cle && table[cle]) || {};
}

/** Les points de pool de la dernière soirée d'une rangée. */
function ppaDe(soiree) {
    return (seasonStarted && soiree && soiree.ppa) || 0;
}

/**
 * La pastille des points de la dernière soirée, faite comme celle de la
 * tendance du classement (evolutionBadgeHTML) : « +3 » en vert, un trait
 * gris sans point.
 */
function soireeBadgeHTML(ppa) {
    if (ppa > 0) {
        return `<span class="st-evo st-evo-up" title="${ppa} point${ppa > 1 ? 's' : ''} de pool à sa dernière soirée, ${SOIREE_TITRE}">+${ppa}</span>`;
    }
    return `<span class="st-evo st-evo-flat" title="Aucun point à sa dernière soirée, ${SOIREE_TITRE}">—</span>`;
}

async function chargerSoireeFiche() {
    if (!seasonStarted || currentView !== VIEW_STATES.TEAM_ROSTER || !rosterAffiche.length) return;
    const cle = cleFicheAffichee();
    const joueurs = [...new Set(rosterAffiche.filter(p => p.type !== 'team' && p.playerId).map(p => String(p.playerId)))];
    const clubs = [...new Set(rosterAffiche.filter(p => p.type === 'team').map(clubDeRangee).filter(Boolean))];
    try {
        const res = await fetch(`${BASE_URL}/live-roster?joueurs=${joueurs.join(',')}&clubs=${clubs.join(',')}`, { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            // Le sélecteur d'équipe a pu changer de fiche pendant l'appel.
            if (cle !== cleFicheAffichee() || currentView !== VIEW_STATES.TEAM_ROSTER) return;
            soireeFiche = { cle, joueurs: data.joueurs || {}, clubs: data.clubs || {}, bascule: data.bascule || null };
            rafraichirFicheEnDirect();
        }
    } catch (error) {
        console.warn('⚠️ Soirée des joueurs indisponible :', error);
    }
    planifierSoireeFiche();
}

/**
 * La prochaine relecture : chaque minute tant qu'un joueur de la fiche est
 * en jeu (pour la fin de son match), sinon à la prochaine mise au jeu — la
 * sienne, ou le premier match du jour qui efface les pastilles de la veille
 * (`bascule`) — au plus tard dans une demi-heure. Rien sans match à venir,
 * hors de la fiche ou onglet caché.
 */
function planifierSoireeFiche() {
    clearTimeout(soireeMinuteur);
    soireeMinuteur = null;
    if (currentView !== VIEW_STATES.TEAM_ROSTER || document.hidden) return;
    const lignes = [...Object.values(soireeFiche.joueurs), ...Object.values(soireeFiche.clubs)];
    let attente = null;
    if (lignes.some(s => s.etat === 'LIVE')) {
        attente = SOIREE_EN_JEU_MS;
    } else {
        const debuts = [...lignes.filter(s => s.etat === 'FUT').map(s => s.debut), soireeFiche.bascule]
            .map(d => Date.parse(d)).filter(Number.isFinite);
        if (debuts.length) attente = Math.min(Math.max(Math.min(...debuts) - Date.now(), SOIREE_EN_JEU_MS), SOIREE_MAX_MS);
    }
    if (attente !== null) soireeMinuteur = setTimeout(chargerSoireeFiche, attente);
}

/** Un point vient de tomber : la pastille de la soirée le montre, sans relire à chaque envoi. */
function relireSoireeBientot() {
    if (currentView !== VIEW_STATES.TEAM_ROSTER || soireeRelecture) return;
    soireeRelecture = setTimeout(() => {
        soireeRelecture = null;
        chargerSoireeFiche();
    }, 1500);
}

document.addEventListener('visibilitychange', () => {
    if (currentView !== VIEW_STATES.TEAM_ROSTER) return;
    if (document.hidden) planifierSoireeFiche();
    else chargerSoireeFiche();
});

/** Les libellés du meilleur et du pire choix de chaque catégorie de rangée. */
const CHOIX_LIBELLES = {
    offensive: ['Meilleur attaquant', 'Pire attaquant'],
    defensive: ['Meilleur défenseur', 'Pire défenseur'],
    goalie: ['Meilleur gardien', 'Pire gardien'],
    rookie: ['Meilleure recrue', 'Pire recrue'],
    team: ['Meilleure équipe', 'Pire équipe']
};

/** Les points de pool d'un choix, comme sa rangée de fiche les affiche. */
function pointsDuChoix(nom, categorie) {
    if (categorie !== 'teams') return benchSeasonPoints(nom, categorie);
    const stats = getCurrentTeamStats(nom);
    const fiche = ficheClub(nom);
    return clubPoolPoints({ wins: seasonStat(stats, fiche, 'wins'), otLosses: seasonStat(stats, fiche, 'otLosses') });
}

/**
 * Le meilleur et le pire total de chaque catégorie, tous les choix du pool
 * confondus — les partants des équipes du classement ; le banc ne compte
 * pas. Une catégorie où tous sont à égalité n'a ni meilleur ni pire.
 * Clés : celles de `player.category` (offensive … rookie, team).
 */
function extremesDuPool(poolData) {
    const extremes = {};
    const equipes = Object.values((poolData && poolData.teams) || {}).filter(t => (t.members || []).length > 0);
    for (const categorie of ['offensive', 'defensive', 'goalie', 'rookie', 'teams']) {
        const totaux = equipes.flatMap(t => (t[categorie] || []).map(nom => pointsDuChoix(nom, categorie)));
        if (totaux.length < 2) continue;
        const max = Math.max(...totaux), min = Math.min(...totaux);
        if (max > min) extremes[categorie === 'teams' ? 'team' : categorie] = { max, min };
    }
    return extremes;
}

const MARQUES_SVG = {
    enJeu: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#16A34A"/><path d="M6.3 4.8v6.4L11.4 8z" fill="#FFFFFF"/></svg>',
    plusTard: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.1" fill="#FFFFFF" stroke="#111111" stroke-width="1.6"/><path d="M8 4.4V8l2.4 1.6" fill="none" stroke="#111111" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    meilleur: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#2563EB"/><path d="M8 3.4l1.18 2.98 3.19.2-2.47 2.04.8 3.1L8 10l-2.7 1.72.8-3.1-2.47-2.04 3.19-.2z" fill="#FFFFFF"/></svg>',
    pire: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#DC2626"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round"/></svg>'
};

/**
 * Les repères d'une rangée, côte à côte en haut à droite de ses PPts : il
 * joue en ce moment (rond vert) ou plus tard aujourd'hui (horloge), il est
 * le meilleur (étoile) ou le pire (X) choix du pool dans sa catégorie.
 */
function marquesHTML(player, points, soiree, extremes) {
    const marques = [];
    if (seasonStarted && soiree && soiree.etat === 'LIVE') {
        marques.push(['is-live', 'enJeu', 'En jeu en ce moment']);
    } else if (seasonStarted && soiree && soiree.etat === 'FUT') {
        const debut = soiree.debut ? new Date(soiree.debut) : null;
        const heure = debut && !isNaN(debut)
            ? debut.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) : '';
        marques.push(['is-later', 'plusTard', heure ? `Joue aujourd’hui à ${heure}` : 'Joue plus tard aujourd’hui']);
    }
    const extreme = extremes && extremes[player.category];
    const [meilleur, pire] = CHOIX_LIBELLES[player.category] || [];
    if (extreme && points === extreme.max) marques.push(['is-best', 'meilleur', `${meilleur} du pool`]);
    if (extreme && points === extreme.min) marques.push(['is-worst', 'pire', `${pire} du pool`]);
    return marques.map(([classe, icone, titre]) =>
        `<span class="rr-mark ${classe}" role="img" aria-label="${escapeAttr(titre)}" title="${escapeAttr(titre)}">${MARQUES_SVG[icone]}</span>`
    ).join('');
}

// ==================== BANC (TÊTE-À-TÊTE) ====================
// Les joueurs de banc ne marquent rien. On en fait entrer un à la place d'un
// partant de la même position — en cas de blessure, le plus souvent — et le
// changement compte à partir du lendemain (lib/lineup.js, /h2h/lineup/swap).

const BANC_LIBELLES = { offensive: 'Attaquant', defensive: 'Défenseur', goalie: 'Gardien', rookie: 'Recrue' };

/** Le message du dernier changement, affiché au prochain rendu du banc. */
let benchMessageEnAttente = '';

/** Points de la saison d'un joueur, pour choisir qui sort en connaissance de cause. */
function benchSeasonPoints(nom, categorie) {
    const fiche = ficheJoueur(nom, categorie);
    const stats = getCurrentPlayerStats(nom, fiche.playerId);
    if (fiche.gardien) {
        return goaliePoolPoints({
            shutouts: seasonStat(stats, fiche.cache, 'shutouts'),
            wins: seasonStat(stats, fiche.cache, 'wins'),
            otLosses: seasonStat(stats, fiche.cache, 'otLosses')
        });
    }
    return seasonStat(stats, fiche.cache, 'points');
}

function renderBenchPanel(rosterList, roster) {
    const poolData = allPoolsData[currentPoolName];
    const quota = typeof window.fzQuotaBanc === 'function' ? window.fzQuotaBanc(poolData) : 0;
    if (!quota) return;

    const moi = localStorage.getItem('username');
    const mienne = (roster.members || []).includes(moi);
    const banc = (roster.bench || []).map(b => (typeof b === 'string' ? { nom: b, categorie: null } : b));
    const aujourdhui = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const prevus = (roster.lineupChanges || []).filter(c => c.date > aujourdhui);
    const esc = escapeHtmlText;
    const jour = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    const pts = v => (v == null ? '—' : `${v} pts`);

    const lignes = banc.map((b, i) => {
        const partants = roster[b.categorie] || [];
        const choix = mienne && partants.length ? `
            <div class="bench-swap">
                <label class="bench-sr" for="benchSwap-${i}">Remplacer quel partant par ${esc(b.nom)} ?</label>
                <select class="bench-select" id="benchSwap-${i}" data-bench-entre="${escapeAttr(b.nom)}">
                    <option value="">Remplacer…</option>
                    ${partants.map(nom => `<option value="${escapeAttr(nom)}">${esc(nom)} · ${pts(benchSeasonPoints(nom, b.categorie))}</option>`).join('')}
                </select>
                <button type="button" class="bench-go" data-bench-go="${escapeAttr(b.nom)}" disabled>Faire entrer</button>
            </div>` : '';
        return `
            <li class="bench-row">
                <div class="bench-id">
                    <span class="bench-name">${esc(b.nom)}</span>${injBadge(b.nom, '')}
                    <span class="bench-meta">${esc(BANC_LIBELLES[b.categorie] || 'Joueur')} · ${pts(benchSeasonPoints(b.nom, b.categorie))}</span>
                </div>
                ${choix}
            </li>`;
    }).join('');

    const panneau = document.createElement('section');
    panneau.className = 'bench-panel';
    panneau.setAttribute('aria-labelledby', 'benchTitle');
    panneau.innerHTML = `
        <header class="bench-head">
            <h3 class="bench-title" id="benchTitle">Banc · ${banc.length}/${quota}</h3>
            <p class="bench-hint">Les joueurs de banc ne marquent pas. ${mienne
                ? 'Faites-en entrer un à la place d’un partant de la même position : le changement compte dès demain.'
                : 'Seule l’équipe elle-même peut modifier son alignement.'}</p>
        </header>
        ${prevus.length ? `<ul class="bench-pending">${prevus.map(c =>
            `<li><strong>${esc(c.entre)}</strong> remplace ${esc(c.sort)} à partir du ${esc(jour(c.date))}.</li>`).join('')}</ul>` : ''}
        ${banc.length ? `<ul class="bench-list">${lignes}</ul>` : '<p class="bench-empty">Banc vide.</p>'}
        <p class="bench-msg" id="benchMsg" role="status"${benchMessageEnAttente ? '' : ' hidden'}>${esc(benchMessageEnAttente)}</p>`;
    benchMessageEnAttente = '';
    rosterList.appendChild(panneau);

    panneau.querySelectorAll('.bench-select').forEach(select => {
        select.addEventListener('change', () => {
            const bouton = panneau.querySelector(`[data-bench-go="${CSS.escape(select.dataset.benchEntre)}"]`);
            if (bouton) bouton.disabled = !select.value;
        });
    });
    panneau.querySelectorAll('[data-bench-go]').forEach(bouton => {
        bouton.addEventListener('click', () => {
            const entre = bouton.dataset.benchGo;
            const select = panneau.querySelector(`[data-bench-entre="${CSS.escape(entre)}"]`);
            if (select && select.value) faireEntrerDuBanc(entre, select.value, bouton);
        });
    });
}

async function faireEntrerDuBanc(entre, sort, bouton) {
    const message = document.getElementById('benchMsg');
    const dire = (texte, erreur) => {
        if (!message) return;
        message.textContent = texte;
        message.hidden = !texte;
        message.classList.toggle('is-error', !!erreur);
    };
    bouton.disabled = true;
    dire('Changement en cours…', false);
    try {
        const reponse = await fetch(`${BASE_URL}/h2h/lineup/swap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ poolName: currentPoolName, entre, sort })
        });
        const resultat = await reponse.json().catch(() => ({}));
        if (!reponse.ok) { dire(resultat.message || 'Changement impossible.', true); bouton.disabled = false; return; }
        await FZPool.refresh();
        allPoolsData = FZPool.all();
        benchMessageEnAttente = resultat.message || 'Alignement mis à jour.';
        showTeamRoster(currentPoolName, currentTeamName);
    } catch (erreur) {
        console.error('Erreur /h2h/lineup/swap :', erreur);
        dire('Erreur de connexion au serveur.', true);
        bouton.disabled = false;
    }
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

// ==================== FICHES DES CHOIX ====================
// Un choix paraît toujours au classement. Le repêchage puise dans la trousse
// (draftkit.json, plus de mille joueurs) ; nhl_filtered_stats.json, que cette
// page lisait seule, n'en compte qu'environ 550. Un joueur hors de cette
// liste (Alexandre Texier, Jayden Struble…) disparaissait de la fiche de son
// équipe et de son total ; une recrue gardienne aussi (Sergei Murashov),
// cherchée parmi les patineurs seulement. Même chose pour un nom écrit
// autrement (« Tim Stützle » / « Tim Stutzle ») ou un club renommé (« Utah
// Mammoth » / « Utah Hockey Club »).
//
// Les noms se rapprochent sans accent ni ponctuation (cleDeNom, lib/scoring.js,
// la même règle que le classement du serveur).

let fichesIndex = null;

function indexerNoms(liste, champ) {
    const exact = new Map();
    const parCle = new Map();
    (liste || []).forEach(fiche => {
        const nom = fiche && fiche[champ];
        if (!nom) return;
        if (!exact.has(nom)) exact.set(nom, fiche);
        const cle = cleDeNom(nom);
        if (!parCle.has(cle)) parCle.set(cle, fiche);
    });
    return { exact, parCle };
}

function chercherNom(index, nom) {
    if (!nom) return null;
    return index.exact.get(nom) || index.parCle.get(cleDeNom(nom)) || null;
}

/** Les index de noms, une fois les listes chargées. */
function indexerFiches() {
    const kit = (window.FZDraftKit && FZDraftKit.donnees) || null;
    fichesIndex = {
        patineurs: indexerNoms(fullPlayerData, 'skaterFullName'),
        gardiens: indexerNoms(goalieData, 'goalieFullName'),
        kitPatineurs: indexerNoms(kit && kit.skaters, 'fullName'),
        kitGardiens: indexerNoms(kit && kit.goalies, 'fullName'),
        clubs: indexerNoms(teamData, 'teamFullName')
    };
}

/**
 * Ce qu'on sait d'un joueur repêché, sans jamais rendre null :
 * { gardien, playerId, position, club, cache }.
 *
 * Cherché dans nhl_filtered_stats.json, puis dans la trousse, puis dans le
 * relevé de la saison. `cache` (repli de seasonStat) ne vient que du
 * premier : les chiffres de la trousse sont des projections ou ceux de l'an
 * passé, jamais la saison en cours. `categorie` est la case du choix ; une
 * recrue (ou un joueur de banc sans case) peut être un gardien.
 */
function ficheJoueur(nom, categorie) {
    if (!fichesIndex) indexerFiches();
    const patineurPossible = categorie !== 'goalie';
    const gardienPossible = !categorie || categorie === 'goalie' || categorie === 'rookie';

    const patineur = patineurPossible ? chercherNom(fichesIndex.patineurs, nom) : null;
    if (patineur) {
        return { gardien: patineur.positionCode === 'G', playerId: patineur.playerId || null, position: patineur.positionCode || null,
            club: patineur.teamAbbrevs || null, cache: patineur };
    }
    const gardien = gardienPossible ? chercherNom(fichesIndex.gardiens, nom) : null;
    if (gardien) {
        return { gardien: true, playerId: gardien.playerId || null, position: 'G',
            club: gardien.teamAbbrevs || null, cache: gardien };
    }

    const canonique = window.FZDraftKit ? FZDraftKit.nomCanonique(nom) : nom;
    const dansKit = (index) => chercherNom(index, nom) || chercherNom(index, canonique);
    const kitPatineur = patineurPossible ? dansKit(fichesIndex.kitPatineurs) : null;
    const kitGardien = !kitPatineur && gardienPossible ? dansKit(fichesIndex.kitGardiens) : null;
    const ligne = ligneDuReleveParNom(nom);
    const kit = kitPatineur || kitGardien;
    if (kit) {
        return { gardien: !!kitGardien, playerId: kit.playerId || (ligne && ligne.playerId) || null,
            position: kitGardien ? 'G' : (kit.position || null), club: kit.team || null, cache: null };
    }
    if (ligne) {
        return { gardien: ligne.position === 'G', playerId: ligne.playerId || null,
            position: ligne.position || null, club: ligne.teamAbbrev || null, cache: null };
    }
    return { gardien: categorie === 'goalie', playerId: null, position: null, club: null, cache: null };
}

/** La fiche d'un club repêché dans nhl_filtered_stats.json, ou null. */
function ficheClub(nom) {
    if (!fichesIndex) indexerFiches();
    return chercherNom(fichesIndex.clubs, nom)
        || fichesIndex.clubs.parCle.get(CLUBS_RENOMMES[cleDeNom(nom)]) || null;
}

// Le relevé indexé, refait quand il change (les points du soir le remplacent).
let releveIndex = { joueurs: null, parId: null, parNom: null, parCle: null };
function indexDuReleve() {
    const joueurs = currentStats && currentStats.players;
    if (!Array.isArray(joueurs)) return null;
    if (releveIndex.joueurs !== joueurs) {
        // Lignes du relevé dont l'identifiant est celui d'un autre joueur
        // (draftkitData.js) : jamais rapprochées par le nom.
        const errones = new Set(window.FZ_IDS_ERRONES || []);
        const parId = new Map();
        const parNom = new Map();
        const parCle = new Map();
        joueurs.forEach(p => {
            if (p.playerId && !parId.has(Number(p.playerId))) parId.set(Number(p.playerId), p);
            if (!p.playerName || errones.has(Number(p.playerId))) return;
            if (!parNom.has(p.playerName)) parNom.set(p.playerName, p);
            const cle = cleDeNom(p.playerName);
            if (!parCle.has(cle)) parCle.set(cle, p);
        });
        releveIndex = { joueurs, parId, parNom, parCle };
    }
    return releveIndex;
}

function ligneDuReleveParNom(nom) {
    const index = indexDuReleve();
    if (!index || !nom) return null;
    return index.parNom.get(nom) || index.parCle.get(cleDeNom(nom)) || null;
}

function getCurrentPlayerStats(playerName, playerId) {
    const index = indexDuReleve();
    if (!index) return null;

    // Try to find by playerId first
    if (playerId) {
        const byId = index.parId.get(Number(playerId));
        if (byId) return byId;
    }

    // Fallback to name match
    return ligneDuReleveParNom(playerName);
}

/** La fiche d'un club : avec le direct par défaut, ou dans `releve` (currentTeamsBase, celui de minuit). */
function getCurrentTeamStats(teamName, releve = currentTeams) {
    if (!releve || !releve.teams) return null;
    const cle = cleDeNom(teamName);
    const autre = CLUBS_RENOMMES[cle];
    return releve.teams.find(t => t.teamFullName === teamName)
        || releve.teams.find(t => cleDeNom(t.teamFullName) === cle)
        || (autre ? releve.teams.find(t => cleDeNom(t.teamFullName) === autre) : null)
        || null;
}

function calculateTeamPoints(roster) {
    let totalGP = 0;
    let totalGoals = 0;
    let totalAssists = 0;
    let totalPoints = 0;
    // La part du total marquée ce soir (voir appliquerPointsDirect).
    let totalEnDirect = 0;
    const soir = stats => (seasonStarted && stats && stats.pointsEnDirect) || 0;

    // Tous les choix comptent, même hors de nhl_filtered_stats.json (voir
    // ficheJoueur) ; une recrue gardienne est comptée en gardienne.
    ['offensive', 'defensive', 'goalie', 'rookie'].forEach(category => {
        (roster[category] || []).forEach(playerName => {
            const fiche = ficheJoueur(playerName, category);
            const stats = getCurrentPlayerStats(playerName, fiche.playerId);
            totalGP += seasonStat(stats, fiche.cache, 'gamesPlayed');
            if (fiche.gardien) {
                // Formule partagée avec le serveur et la page d'accueil
                // (lib/scoring.js) : recopiée ici, elle finissait par diverger.
                totalPoints += goaliePoolPoints({
                    shutouts: seasonStat(stats, fiche.cache, 'shutouts'),
                    wins: seasonStat(stats, fiche.cache, 'wins'),
                    otLosses: seasonStat(stats, fiche.cache, 'otLosses')
                });
            } else {
                totalGoals += seasonStat(stats, fiche.cache, 'goals');
                totalAssists += seasonStat(stats, fiche.cache, 'assists');
                totalPoints += seasonStat(stats, fiche.cache, 'points');
            }
            totalEnDirect += soir(stats);
        });
    });

    // Process teams
    (roster.teams || []).forEach(teamName => {
        const teamInfo = ficheClub(teamName);
        const stats = getCurrentTeamStats(teamName);
        const gp = seasonStat(stats, teamInfo, 'gamesPlayed');
        const wins = seasonStat(stats, teamInfo, 'wins');
        const otLosses = seasonStat(stats, teamInfo, 'otLosses');
        const points = clubPoolPoints({ wins, otLosses });

        totalGP += gp;
        totalPoints += points;
        totalEnDirect += soir(stats);
    });

    return {
        gamesPlayed: totalGP,
        goals: totalGoals,
        assists: totalAssists,
        points: totalPoints,
        enDirect: totalEnDirect
    };
}

function setH2HPeriod(period) {
    h2hPeriod = period;
    document.getElementById('filterToday').classList.toggle('active', period === 'today');
    document.getElementById('filterWeek').classList.toggle('active', period === 'week');
    if (currentPoolName) renderH2HMatchupsForPeriod(currentPoolName);
}

// ==================== H2H SHARED HELPERS ====================

/**
 * La photo d'un joueur d'alignement, même avant le premier match.
 *
 * `playerId` et `teamAbbrev` viennent des feuilles de match (services/
 * scoring.js) : tant qu'aucun match n'est joué, il n'y a pas de feuille, donc
 * pas d'identifiant — et toute la colonne restait à des pastilles grises.
 * Le repli passe par le nom, résolu dans les jeux de données déjà chargés
 * par la page (nhl_filtered_stats.json et /current-stats), qui portent
 * l'identifiant LNH de tous les joueurs repêchés.
 */
function playerHeadshot(joueur) {
    if (!joueur) return null;
    if (joueur.playerId && joueur.teamAbbrev) {
        // buildHeadshotUrl (headshots.js) tient la saison courante à jour.
        const url = buildHeadshotUrl(joueur.playerId, joueur.teamAbbrev);
        if (url) return url;
    }
    return getMatchingImage(joueur.name) || null;
}

/**
 * La couleur du club derrière une photo de joueur (.fz-shot, teamLogos.css) :
 * le même fond qu'à l'onglet Alignements. `teamAbbrevs` liste parfois les
 * clubs d'une saison (« TOR,MTL ») : le dernier est l'actuel. Club inconnu :
 * le gris ardoise de teamColors.js.
 */
function clubShotStyle(teamAbbrev) {
    const club = String(teamAbbrev || '').split(',').pop().trim();
    const couleur = typeof getTeamColors === 'function' ? getTeamColors(club)[0] : '#3A414D';
    return `--fz-shot-team: ${escapeAttr(couleur)}`;
}

/** Le club d'un joueur d'alignement : sa feuille de match, sinon les stats chargées. */
function clubDuJoueur(joueur) {
    if (joueur.teamAbbrev) return joueur.teamAbbrev;
    const fiche = ficheJoueur(joueur.name, null);
    const stats = getCurrentPlayerStats(joueur.name, joueur.playerId || fiche.playerId);
    if (stats && stats.teamAbbrev) return stats.teamAbbrev;
    return fiche.club;
}

/**
 * La pastille d'un joueur : sa photo, ses initiales dessous.
 *
 * Les initiales sont dans le DOM dès le départ, sous l'image. Une photo qui
 * ne charge pas (joueur sans identifiant, répertoire de saison pas encore
 * publié sur le CDN) se retire et les découvre — là où elle laissait un trou.
 */
function h2hPlayerPhotoHTML(joueur) {
    if (!joueur) return '<span class="h2h-player-photo-wrap is-empty"></span>';
    const initiales = escapeHtmlText(initialsFromName(joueur.name || ''));
    const url = playerHeadshot(joueur);
    const image = url
        ? `<img class="h2h-player-photo" src="${escapeAttr(url)}" alt="" loading="lazy" data-no-lazy onerror="this.remove()">`
        : '';
    // L'image AVANT les initiales : la photo détourée est transparente, les
    // initiales se voyaient à travers. Le CSS les cache tant qu'une image est
    // là (.h2h-player-photo ~ .h2h-player-initials) ; son onerror les découvre.
    return `<span class="h2h-player-photo-wrap fz-shot" style="${clubShotStyle(clubDuJoueur(joueur))}">${image}<span class="h2h-player-initials">${initiales}</span></span>`;
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

    // Chaque colonne est triée du meilleur pointeur au moins bon. Les rangées
    // appariaient avant deux joueurs au hasard de l'ordre de repêchage, et en
    // surlignaient un comme « gagnant » — un duel entre un gardien et un
    // attaquant qui ne voulait rien dire. Les points restent côte à côte ;
    // plus aucune comparaison implicite.
    const parPoints = liste => [...(liste || [])].sort((a, b) => (b.fantasyPoints || 0) - (a.fantasyPoints || 0));
    const t1p = parPoints(m.team1Players);
    const t2p = parPoints(m.team2Players);
    const maxRows = Math.max(t1p.length, t2p.length);
    let playerRowsHTML = '';

    for (let i = 0; i < maxRows; i++) {
        const lp = t1p[i];
        const rp = t2p[i];
        const lpFpts = lp ? lp.fantasyPoints : null;
        const rpFpts = rp ? rp.fantasyPoints : null;
        const lpBetter = false;
        const rpBetter = false;

        const lpSub = lp ? (lp.position === 'G'
            ? `${lp.wins}V ${lp.saves}ARR${lp.shutouts ? ' ' + lp.shutouts + 'BL' : ''}`
            : `${lp.goals}B ${lp.assists}A`) : '';
        const rpSub = rp ? (rp.position === 'G'
            ? `${rp.wins}V ${rp.saves}ARR${rp.shutouts ? ' ' + rp.shutouts + 'BL' : ''}`
            : `${rp.goals}B ${rp.assists}A`) : '';

        playerRowsHTML += `
            <div class="h2h-player-row">
                <div class="h2h-player-left ${lpBetter ? 'h2h-player-winning' : ''}">
                    ${h2hPlayerPhotoHTML(lp)}
                    <div class="h2h-player-info">
                        <span class="h2h-player-name" title="${escapeAttr(lp ? lp.name : '')}">${escapeHtmlText(lp ? lp.name : '')}</span>
                        ${lp ? `<span class="h2h-player-sub">${escapeHtmlText(lpSub)}</span>` : ''}
                    </div>
                </div>
                <div class="h2h-player-pts-block">
                    <span class="h2h-player-pts ${lpBetter ? 'h2h-pts-leading' : ''}">${lpFpts !== null ? lpFpts.toFixed(1) : '—'}</span>
                    <span class="h2h-player-sep">·</span>
                    <span class="h2h-player-pts ${rpBetter ? 'h2h-pts-leading' : ''}">${rpFpts !== null ? rpFpts.toFixed(1) : '—'}</span>
                </div>
                <div class="h2h-player-right ${rpBetter ? 'h2h-player-winning' : ''}">
                    ${h2hPlayerPhotoHTML(rp)}
                    <div class="h2h-player-info right">
                        <span class="h2h-player-name" title="${escapeAttr(rp ? rp.name : '')}">${escapeHtmlText(rp ? rp.name : '')}</span>
                        ${rp ? `<span class="h2h-player-sub">${escapeHtmlText(rpSub)}</span>` : ''}
                    </div>
                </div>
            </div>`;
    }

    // Un nom d'équipe vient d'une saisie : il est échappé, et tronqué par le
    // CSS plutôt que de pousser la carte hors de l'écran sur téléphone.
    const equipes = (allPoolsData[poolName] && allPoolsData[poolName].teams) || {};
    const affiche = cle => getDisplayName(cle, (equipes[cle] && equipes[cle].members) || []);
    const nom1 = escapeHtmlText(affiche(m.team1));
    const nom2 = escapeHtmlText(affiche(m.team2));
    const titre1 = escapeAttr(affiche(m.team1));
    const titre2 = escapeAttr(affiche(m.team2));

    return `
        <div class="h2h-matchup-card">
            <div class="h2h-matchup-header">
                <div class="h2h-header-team ${t1Leading ? 'leading' : ''}">
                    <div class="h2h-header-team-name" title="${titre1}">${nom1}</div>
                    ${recordHTML(m.team1)}
                    <div class="h2h-header-score ${t1Leading ? 'leading' : ''}">${m.team1Points.toFixed(1)}</div>
                </div>
                <div class="h2h-header-vs">VS</div>
                <div class="h2h-header-team right ${t2Leading ? 'leading' : ''}">
                    <div class="h2h-header-team-name" title="${titre2}">${nom2}</div>
                    ${recordHTML(m.team2)}
                    <div class="h2h-header-score ${t2Leading ? 'leading' : ''}">${m.team2Points.toFixed(1)}</div>
                </div>
            </div>
            <div class="h2h-players-list">
                <div class="h2h-players-header">
                    <span title="${titre1}">${nom1}</span>
                    <span>FPTS</span>
                    <span title="${titre2}">${nom2}</span>
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

    // La bande de tuiles et les blocs du bas appartiennent au seul
    // onglet Classement. Sans ce ménage ils restaient affichés sous les
    // duels en cours et sous le calendrier, une fois l'onglet visité.
    const surClassement = tab === 'standings';
    const bande = document.getElementById('h2hStandingsStrip');
    if (bande) bande.style.display = (surClassement && bande.innerHTML.trim()) ? 'flex' : 'none';
    const insights = document.getElementById('standingsInsights');
    if (insights) insights.style.display = surClassement ? '' : 'none';

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

            // L'état vient du serveur. En dur, la bandeau annonçait « EN COURS »
            // sur une semaine 1 qui n'ouvre qu'au premier match de la saison.
            const ws = data.weekStatus || 'ongoing';
            const plage = h2hSchedDateRange(data.weekStart, data.weekEnd);
            const sousTitre = (ws === 'upcoming' && plage)
                ? `Semaine du ${plage} — premier duel à venir`
                : `Aujourd'hui — ${h2hJourLong(data.date) || jourLocalLong()}`;
            weekHeader.innerHTML = `
                <div class="h2h-week-label">Semaine ${data.currentWeek} <span class="h2h-week-status ${H2H_WEEK_STATUS_CLASS[ws] || ''}">${H2H_WEEK_STATUS_LABEL[ws] || ''}</span></div>
                <div class="h2h-week-dates">${escapeHtmlText(sousTitre)}</div>`;
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

            // `weekEnd` est le lundi SUIVANT : la plage recule d'un jour pour
            // se lire « lundi au dimanche », comme partout ailleurs.
            const dateRange = h2hSchedDateRange(data.weekStart, data.weekEnd) || 'Semaine en cours';
            const ws = data.weekStatus || 'ongoing';
            weekHeader.innerHTML = `
                <div class="h2h-week-label">Semaine ${data.currentWeek} <span class="h2h-week-status ${H2H_WEEK_STATUS_CLASS[ws] || ''}">${H2H_WEEK_STATUS_LABEL[ws] || ''}</span></div>
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

/**
 * Les états de semaine que le serveur renvoie (routes/h2h.js,
 * etatDeSemaine). `pending_finalization` en fait partie : une semaine échue
 * dont les feuilles de match ne sont pas toutes arrivées n'est ni en cours ni
 * terminée. Les tables qui l'oubliaient la montraient « À venir ».
 */
const H2H_WEEK_STATUS_LABEL = {
    upcoming: '📅 À VENIR',
    ongoing: '🔴 EN COURS',
    pending_finalization: '⏳ EN ATTENTE',
    completed: '✓ TERMINÉE',
    no_matchups: '—',
    awaiting_draft_completion: '—'
};

const H2H_WEEK_STATUS_CLASS = {
    upcoming: 'status-upcoming',
    ongoing: 'status-ongoing',
    pending_finalization: 'status-awaiting',
    completed: 'status-completed'
};

const H2H_SCHED_STATUS = {
    completed: { label: 'Terminée', cls: 'is-done' },
    ongoing:   { label: 'En cours', cls: 'is-live' },
    pending_finalization: { label: 'En attente', cls: 'is-live' },
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

/**
 * Une borne de semaine, lue comme une JOURNÉE de calendrier.
 *
 * Le serveur envoie `2026-10-13` : une journée, pas un instant. `new Date()`
 * la lisait à minuit UTC, puis `toLocaleDateString` la rendait dans le fuseau
 * du visiteur — à Montréal, le 13 s'affichait « 12 ». Toute la bande de
 * dates du tête-à-tête était donc annoncée un jour trop tôt. On reste en UTC
 * de la lecture au formatage, et la journée écrite est celle qui s'affiche.
 */
function h2hJourUTC(valeur) {
    if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : new Date(valeur.getTime());
    const texte = String(valeur == null ? '' : valeur);
    if (!texte) return null;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(texte) ? new Date(texte + 'T00:00:00Z') : new Date(texte);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * La journée d'aujourd'hui, dans le fuseau du visiteur.
 *
 * Repli quand le serveur n'a pas envoyé sa date. Pas de `timeZone: 'UTC'`
 * ici, contrairement à h2hJourLong : « maintenant » est un instant, et le
 * forcer en UTC ferait passer la soirée de Montréal au lendemain.
 */
function jourLocalLong() {
    return new Date().toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** « dimanche 13 octobre » — même règle, forme longue. */
function h2hJourLong(valeur) {
    const d = h2hJourUTC(valeur);
    return d ? d.toLocaleDateString('fr-CA', {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'
    }) : '';
}

/** « 13 – 19 oct. » : weekEnd est le lundi SUIVANT, on recule d'un jour. */
function h2hSchedDateRange(weekStart, weekEnd) {
    const debut = h2hJourUTC(weekStart);
    const fin = h2hJourUTC(weekEnd);
    if (!debut || !fin) return '';
    fin.setUTCDate(fin.getUTCDate() - 1);
    const jour = d => d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', timeZone: 'UTC' });
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
        // Même règle que le calendrier : bornes lues comme des journées, et
        // `weekEnd` — le lundi SUIVANT — reculé d'un jour pour l'affichage.
        const dateRange = h2hSchedDateRange(week.weekStart, week.weekEnd);

        // Le nom affiché, échappé : la clé brute (« Équipe 3 ») ne dit pas qui
        // jouait, et un nom saisi ne va jamais tel quel dans du HTML.
        const affiche = cle => escapeHtmlText(getDisplayName(cle, (poolData.teams?.[cle]?.members) || []));
        const matchupsHTML = week.matchups.map(m => {
            const isT1Winner = m.winner === m.team1;
            const isT2Winner = m.winner === m.team2;
            const isTie = m.winner === 'tie';
            return `
                <div class="h2h-history-matchup">
                    <span class="h2h-hist-team ${isT1Winner ? 'winner' : ''}">${affiche(m.team1)}</span>
                    <span class="h2h-hist-score">
                        <span class="${isT1Winner ? 'winner' : ''}">${(m.team1Points || 0).toFixed(1)}</span>
                        <span class="h2h-hist-sep">${isTie ? '=' : '-'}</span>
                        <span class="${isT2Winner ? 'winner' : ''}">${(m.team2Points || 0).toFixed(1)}</span>
                    </span>
                    <span class="h2h-hist-team ${isT2Winner ? 'winner' : ''}">${affiche(m.team2)}</span>
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

    const ok = await fzConfirm({
        icon: 'calendar',
        title: 'Finaliser la semaine ?',
        bodyHTML: `<p>Les duels de la semaine en cours de <strong>${fzDialog.escape(poolName)}</strong>
            seront clos et la semaine suivante commencera.</p>`,
        confirmLabel: 'Finaliser'
    });
    if (!ok) return;

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
            fzAlert({ type: 'error', title: 'Finalisation impossible', message: data.message || 'La semaine n’a pas pu être finalisée.' });
            return;
        }

        fzAlert({
            type: 'success',
            title: `Semaine ${data.previousWeek} finalisée`,
            message: `La semaine ${data.currentWeek} est commencée. Bonne chance à tous !`
        });

        // Reload pool data and refresh
        await loadAllUserPools();
        showPoolStandings(poolName);

    } catch (error) {
        console.error('Error finalizing week:', error);
        fzAlert({ type: 'error', icon: 'offline', title: 'Finalisation impossible', message: 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.' });
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
    setRosterViewMode(false);
    document.getElementById('breadcrumb').style.display = 'none';
    document.getElementById('pageTitle').textContent = 'Classement';
    document.getElementById('poolHeaderMeta').style.display = 'none';

    const poolList = document.getElementById('poolList');
    poolList.style.display = 'block';
    poolList.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
            <div style="font-size: 4rem; margin-bottom: 20px;">📊</div>
            <h2 style="font-size: 1.8rem; color: var(--text-main); margin-bottom: 12px;">${title}</h2>
            <p style="font-size: 1.1rem; color: var(--text-secondary);">${message}</p>
        </div>
    `;
}

// ==================== CAREER STATS MODAL ====================
async function showCareerStats(playerId, playerName, isGoalie = false) {
    currentCareerData = null;
    return fzOpenCareerModal(playerId, playerName, {
        onData(data) { currentCareerData = data; },
        renderStats: filterCareerStats
    });
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
                <td>${season.savePct != null ? season.savePct.toFixed(3) : '—'}</td>
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
            wins: 0, losses: 0, otLosses: 0, shutouts: 0, gamesForAvg: 0, totalGAA: 0,
            // % d'arrêts de carrière : arrêts sur tirs, pas la moyenne des
            // saisons — une saison de 5 parties pesait autant qu'une de 60.
            svSaves: 0, svShots: 0
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
                if (season.savePct != null && season.shotsAgainst > 0) {
                    totals.svShots += season.shotsAgainst;
                    totals.svSaves += season.savePct * season.shotsAgainst;
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
            const avgSVPct = totals.svShots > 0 ? (totals.svSaves / totals.svShots).toFixed(3) : '—';
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
    fzCloseCareerModal();
    currentCareerData = null;
}

// Close modal on outside click
window.onclick = function(event) {
    const modal = document.getElementById('careerStatsModal');
    if (event.target === modal) {
        closeCareerModal();
    }
};
