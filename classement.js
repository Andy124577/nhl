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
let currentH2HTab = 'standings'; // 'standings' | 'matchups' | 'calendrier' | 'history' | 'records' ('equipe' = la fiche)
// Le pool dont les duels sont déjà chargés : l'onglet Duels ne se lit qu'à la première visite.
let h2hDuelsCharges = null;
let h2hWeekCache = null; // cached full-week matchup data
let h2hPeriod = 'today'; // 'today' | 'week'
// Semaine affichée en mode « Semaine » ; null = la semaine en cours.
let h2hSemaineVue = null;
// Jeton de rendu des duels : une réponse arrivée après un changement de pool
// ou de semaine est jetée au lieu d'écraser l'écran courant.
let h2hRenduDuels = 0;
// ?onglet=h2h&semaine=N (lib/events.js, services/today.js) : lu une seule fois,
// à l'arrivée. Un changement de pool ensuite ne doit pas le rejouer.
let h2hDemandeUrl = (() => {
    const p = new URLSearchParams(window.location.search);
    const semaine = Number(p.get('semaine'));
    return {
        onglet: p.get('h2h') || (p.get('onglet') === 'h2h' || semaine > 0 ? 'matchups' : null),
        semaine: Number.isInteger(semaine) && semaine > 0 ? semaine : null
    };
})();


// La période du classement cumulatif : 'saison' (le vrai classement), ou
// 1, 7, 30 jours — la liste se range alors sur les points de la période.
// Gardée au retour d'une fiche d'équipe, remise à la saison au changement
// de pool.
let standingsPeriode = 'saison';

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
/**
 * Pool H2H : toucher « Classement » dans les barres quand on y est déjà
 * (sur la fiche d'une équipe, par exemple) ramène au classement sur place,
 * sans recharger — les données sont déjà là. Le clic des barres (navbar.js)
 * a déjà joué son onde ; on retient seulement la navigation.
 */
document.addEventListener('click', e => {
    const lien = e.target.closest('.bottom-nav a[data-page="classement"], .navbar a[data-page="classement"]');
    if (!lien || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const poolName = currentPoolName;
    if (!poolName || !allPoolsData[poolName] || !estPoolH2H(poolName)) return;
    e.preventDefault();
    if (currentView !== VIEW_STATES.POOL_STANDINGS || currentH2HTab !== 'standings') {
        h2hDemandeUrl = { onglet: 'standings', semaine: null };
        showPoolStandings(poolName);
    }
    window.scrollTo(0, 0);
});

document.addEventListener('DOMContentLoaded', async () => {
    // Le temple du squelette (classement.html) : les mêmes tuiles fantômes
    // que renderHallOfFame pose en attendant ses records.
    const templeSquelette = document.getElementById('standingsSkeletonHof');
    if (templeSquelette) templeSquelette.innerHTML = hofChargementHTML();

    // La trousse de repêchage : la fiche des joueurs repêchés que
    // nhl_filtered_stats.json ne contient pas (voir ficheJoueur). Sans elle,
    // ces joueurs paraissent quand même.
    const trousse = window.FZDraftKit
        ? FZDraftKit.charger().catch(error => { console.warn('⚠️ Could not load draft kit:', error); })
        : Promise.resolve();

    // Les colonnes 1 j / 7 j / 30 j d'un pool cumulatif : demandées dès que
    // le pool actif est connu, pendant que le reste se charge.
    if (window.FZPool) {
        FZPool.ready().then(() => {
            const nom = FZPool.get();
            const pool = nom && FZPool.all()[nom];
            if (pool && (pool.poolMode || 'cumulative') !== 'head-to-head') fetchStandingsPeriodPoints(nom);
        }).catch(() => {});
    }

    // Tout part en même temps : ces lectures ne dépendent pas l'une de
    // l'autre, et les enchaîner faisait attendre le classement cinq
    // allers-retours de suite.
    const lireJson = (url, options) => fetch(url, options).then(r => (r.ok ? r.json() : null));
    const [fiches, fenetre, stats, clubs] = await Promise.all([
        lireJson('nhl_filtered_stats.json').catch(error => { console.warn('⚠️ Could not load player list:', error); return null; }),
        // Avant le premier match, tout vaut zéro : sans ce garde-fou, le
        // classement d'un pool repêché l'été affiche les totaux de l'an passé.
        lireJson(`${BASE_URL}/season-window`, { cache: 'no-store' }).catch(error => { console.warn('⚠️ Could not resolve season window:', error); return null; }),
        lireJson(`${BASE_URL}/current-stats`, { cache: 'no-cache' }).catch(error => { console.warn('⚠️ Could not load current stats:', error); return null; }),
        lireJson(`${BASE_URL}/current-teams`, { cache: 'no-cache' }).catch(error => { console.warn('⚠️ Could not load current team standings:', error); return null; })
    ]);

    if (fiches) {
        fullPlayerData = [...fiches.Top_50_Defenders, ...fiches.Top_100_Offensive_Players, ...fiches.Top_Rookies];
        goalieData = fiches.Top_50_Goalies;
        teamData = fiches.Teams;
    }
    if (fenetre) seasonStarted = fenetre.hasStarted !== false;
    if (stats && Array.isArray(stats.players)) {
        currentStats = currentStatsBase = stats;
        console.log(`✅ Current stats loaded: ${currentStats.players.length} players`);
    }
    if (clubs && Array.isArray(clubs.teams)) {
        currentTeams = currentTeamsBase = clubs;
        console.log(`✅ Current team standings loaded: ${currentTeams.teams.length} teams`);
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

        // Lus avant showPoolStandings, qui remet l'adresse à « classement ».
        //
        // ?vue=equipe : l'onglet « Mon équipe » (navbar.js). Il ouvre la
        // fiche de mon équipe dans le pool actif, quel que soit ce pool —
        // changer de pool depuis le rail y reste.
        //
        // ?equipe=… ouvre directement la fiche d'une équipe. C'est par là
        // qu'arrive « Voir mes joueurs repêchés » (bannière de l'accueil,
        // accueil-dash.js) : une fois le repêchage terminé, c'est ici que
        // vivent les choix qu'on y a faits. Le classement reste dessous, le
        // fil d'Ariane y ramène.
        const demande = new URLSearchParams(window.location.search);
        const equipes = pool.data.teams || {};
        const equipeDemandee = demande.get('vue') === 'equipe' ? pool.teamName : demande.get('equipe');

        showPoolStandings(pool.name);
        if (equipeDemandee && equipes[equipeDemandee]) {
            showTeamRoster(pool.name, equipeDemandee);
        }

        ouvrirRecapitulatifDemande(pool);
    } catch (error) {
        console.error('Error loading pools:', error);
        showError('Erreur', 'Impossible de charger votre pool');
    }
}

/**
 * ?recap=1 : le récapitulatif « Ton équipe est complète » (draftFinPopup.js)
 * par-dessus le classement. C'est ici qu'arrive un repêchage automatique —
 * lancé depuis repechage.js ou ouvert depuis sa notification — qui se joue
 * en une requête, sans passer par la salle de repêchage qui le montre
 * d'habitude au dernier choix. Le paramètre est retiré aussitôt : ni un
 * rechargement ni un changement de pool ne le rouvrent.
 */
function ouvrirRecapitulatifDemande(pool) {
    const url = new URL(window.location.href);
    if (url.searchParams.get('recap') !== '1') return;
    url.searchParams.delete('recap');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);

    const equipe = FZPool.team();
    if (!equipe || typeof window.fzShowDraftEndPopup !== 'function') return;

    // Le bassin complet de la trousse, comme la salle de repêchage :
    // nhl_filtered_stats.json (fullPlayerData) n'en contient qu'une partie.
    const bassin = window.FZDraftKit ? FZDraftKit.pools('projection') : { skaters: [], goalies: [], teams: [] };
    window.fzSetDraftEndSource({
        draftData: pool.data,
        teamName: equipe.name,
        clanName: pool.name,
        complete: true,
        skaters: bassin.skaters,
        goalies: bassin.goalies,
        teams: bassin.teams,
        // Les statistiques courantes d'abord ; un joueur qu'elles ne
        // connaissent pas encore (une recrue sans match) prend
        // l'identifiant de la trousse.
        headshot: nom => {
            const fiche = bassin.skaters.find(p => p.skaterFullName === nom)
                || bassin.goalies.find(g => g.goalieFullName === nom);
            return resolveHeadshotByName(nom) || (fiche ? buildHeadshotUrl(fiche.playerId, fiche.teamAbbrevs) : null);
        }
    });
    window.fzShowDraftEndPopup();
}

// ==================== VIEW RENDERING ====================

/** Cette équipe du pool est-elle la mienne ? */
function estMonEquipe(poolName, teamName) {
    const equipe = ((allPoolsData[poolName] || {}).teams || {})[teamName];
    return !!equipe && (equipe.members || []).includes(localStorage.getItem('username'));
}

/**
 * L'adresse et les barres de navigation suivent la vue affichée.
 *
 * La fiche de mon équipe a sa propre adresse (?vue=equipe) : qu'on y arrive
 * par le bouton « Mon équipe » du classement, en touchant sa rangée ou par
 * un lien de l'accueil, c'est le même écran. Toutes les vues allument
 * « Classement » (ongletDePage, navbar.js).
 *
 * replaceState et non pushState : passer d'une vue à l'autre n'ajoutait
 * aucune entrée d'historique, le retour arrière du navigateur ne change pas.
 *
 * @param {'equipe'|'fiche'|'classement'} vue
 */
function suivreVue(vue) {
    document.body.classList.remove('fz-vue-equipe-attente');
    try {
        const url = new URL(window.location.href);
        const avant = url.search;
        if (vue === 'equipe') {
            url.searchParams.set('vue', 'equipe');
            url.searchParams.delete('equipe');
        } else {
            url.searchParams.delete('vue');
            // De retour au classement, ?equipe=… ne dit plus rien : laissé là,
            // un changement de pool rouvrirait l'équipe du même nom.
            if (vue === 'classement') url.searchParams.delete('equipe');
        }
        if (url.search !== avant) history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    } catch { /* adresse illisible : les barres suivent quand même */ }
    if (typeof fzNavActiver === 'function') fzNavActiver(vue === 'equipe' ? 'equipe' : 'classement');
}

/** Un pool H2H : « Mon équipe », « Classement » et « Duels » y sont des onglets en haut de la page. */
function estPoolH2H(poolName) {
    return ((allPoolsData[poolName] || {}).poolMode || 'cumulative') === 'head-to-head';
}

/**
 * « Mon équipe », en haut du classement : la fiche de son équipe à une
 * touche, sans recharger. L'onglet du même nom a laissé sa place à Récents
 * dans les barres (navbar.js) ; ?vue=equipe ouvre toujours la même fiche.
 * Un pool H2H a l'onglet « Mon équipe » en haut de la page : le bouton y
 * ferait doublon.
 */
function afficherBoutonMonEquipe(poolName) {
    const bouton = document.getElementById('stMonEquipe');
    if (!bouton) return;
    const equipes = (allPoolsData[poolName] || {}).teams || {};
    const mienne = Object.keys(equipes).find(nom => estMonEquipe(poolName, nom)) || null;
    bouton.hidden = !mienne || estPoolH2H(poolName);
    bouton.onclick = mienne ? () => { showTeamRoster(poolName, mienne); window.scrollTo(0, 0); } : null;
}

// Level 2: Pool Standings View
function showPoolStandings(poolName) {
    if (poolName !== currentPoolName) standingsPeriode = 'saison';
    currentView = VIEW_STATES.POOL_STANDINGS;
    currentPoolName = poolName;
    currentTeamName = null;
    h2hWeekCache = null; // clear cache when switching pools
    h2hScheduleCache = null; // idem pour le calendrier de saison
    h2hSchedTeam = null;
    periodPointsCache = null;

    const poolData = allPoolsData[poolName];
    if (!poolData) return;
    suivreVue('classement');
    afficherBoutonMonEquipe(poolName);

    // Le titre de la maquette : « Classement » en surtitre, le nom du pool
    // dessous. L'image du pool est déjà dans la pastille du haut (téléphone)
    // et dans le rail (bureau). La fraîcheur des totaux, à droite, vient du
    // rendu cumulatif (renderPoolStandings) ; un pool H2H n'en a pas.
    setRosterViewMode(false);
    document.getElementById('pageTitle').innerHTML =
        `<span class="st-titre-sur">Classement</span><span class="st-titre-nom">${escapeHtmlText(poolName)}</span>`;
    majFraicheur('');
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
    const bandeH2H = document.getElementById('h2hStandingsStrip');
    bandeH2H.innerHTML = '';
    bandeH2H.style.display = 'none';
    document.getElementById('h2hRaccourcis').style.display = 'none';
    if (poolName !== h2hDuelsCharges) h2hDuelsCharges = null;
    const insightsReset = document.getElementById('standingsInsights');
    insightsReset.classList.remove('is-h2h');
    insightsReset.style.display = '';   // switchH2HTab a pu le masquer pour le pool précédent

    const poolMode = poolData.poolMode || 'cumulative';
    document.body.classList.toggle('fz-pool-h2h', poolMode === 'head-to-head');

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
        //
        // Sans demande, la page s'ouvre sur le classement — c'est l'onglet
        // Classement des barres. « duel » (accueil, bannière du duel) est un
        // autre nom de l'onglet Duels.
        const demande = h2hDemandeUrl;
        h2hDemandeUrl = { onglet: null, semaine: null };
        const voulu = demande.onglet === 'duel' ? 'matchups' : demande.onglet;
        const onglet = ['matchups', 'standings', 'calendrier', 'history', 'records'].includes(voulu)
            ? voulu : 'standings';

        h2hTabs.style.display = '';
        currentH2HTab = onglet;
        if (onglet === 'matchups') {
            h2hDuelsCharges = poolName;
            loadH2HCurrentWeek(poolName, demande.semaine);
        }
        switchH2HTab(onglet);
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
    const hote = document.querySelector('#standingsSkeleton .st-sk-list');
    const modeles = hote ? [...hote.children] : [];
    if (!modeles.length) return;
    while (hote.children.length > voulu) hote.lastElementChild.remove();
    while (hote.children.length < voulu) {
        const i = hote.children.length;
        const rangee = modeles[i % modeles.length].cloneNode(true);
        rangee.style.setProperty('--i', i);
        const rang = rangee.querySelector('.st-rang');
        if (rang) rang.textContent = i + 1;
        hote.appendChild(rangee);
    }
}


// ==================== RANG : MOUVEMENT DE LA SOIRÉE ====================
// Le rang (Pos) est fixé par le total de la saison. La pastille à côté du
// nom dit combien de places l'équipe a gagnées (▲) ou perdues (▼) pendant
// la dernière soirée : son rang au total, comparé à celui qu'elle avait
// avant les points de cette soirée (total − colonne 1 j).
//
// La dernière soirée, c'est hier tant qu'aucun match du jour n'est commencé
// (ancre=soiree, routes/records.js) : le matin, on voit le mouvement de la
// veille. À la première mise au jeu, la page se relit (`bascule`) : la
// soirée devient celle du jour, personne n'a encore de point, la pastille
// repart à « — » et suit ensuite le direct. Même ancre pour 1 j et 7 j.
const STANDINGS_PERIODS = [1, 7, 30];
const PERIODES_ANCREES = new Set([1, 7]);
let periodPointsCache = null; // { poolName, promesse, valeur → { 1: Map, 7: Map, 30: Map } | null, precedente }
let dernieresPeriodes = { poolName: null, valeur: null };
let tendanceMinuteur = null;
const TENDANCE_ATTENTE_MIN_MS = 60 * 1000;
const TENDANCE_ATTENTE_MAX_MS = 30 * 60 * 1000;

const EVO_ARROW_UP = '<svg viewBox="0 0 24 24" width="8" height="8"><path d="M12 4l8 10H4z"></path></svg>';
const EVO_ARROW_DOWN = '<svg viewBox="0 0 24 24" width="8" height="8"><path d="M12 20L4 10h16z"></path></svg>';

/**
 * Les points par période, partagés tant que la lecture court : le premier
 * rendu et celui qu'ouvre l'arrivée du direct partent à quelques
 * millisecondes d'écart, et chacun relisait les trois périodes en base.
 *
 * Le classement ne les attend plus : il se dessine avec les totaux, et se
 * redessine quand elles arrivent (`valeur`).
 */
let periodesMemoVu = false;
function fetchStandingsPeriodPoints(poolName) {
    if (periodPointsCache && periodPointsCache.poolName === poolName) return periodPointsCache;
    // Une relecture (un but, la bascule) garde l'affichage précédent du même
    // pool jusqu'à sa réponse : pas de cases qui clignotent à chaque point.
    // Revenir au classement dans les trois minutes reprend les colonnes déjà
    // lues dans l'onglet (FZMemo) : rien à attendre, et quatre lectures de
    // moins pour la base. Au premier dessin seulement : une relecture en
    // direct (un but) ou la bascule de la soirée veulent la base.
    const premiere = !periodesMemoVu;
    periodesMemoVu = true;
    const memo = premiere && window.FZMemo ? FZMemo.lire(`cl:periodes:${poolName}`) : null;
    const memorisees = memo ? periodesDepuisMemo(memo.data) : null;
    if (memorisees && Date.now() - memo.at < 3 * 60 * 1000) {
        dernieresPeriodes = { poolName, valeur: memorisees };
        planifierBasculeTendance(memo.data.bascule);
        periodPointsCache = { poolName, valeur: memorisees, precedente: null, promesse: Promise.resolve(memorisees) };
        return periodPointsCache;
    }
    const precedente = dernieresPeriodes.poolName === poolName ? dernieresPeriodes.valeur : memorisees;
    const entree = { poolName, valeur: null, precedente, promesse: null };
    entree.promesse = lirePointsParPeriode(poolName).then(byDays => {
        entree.valeur = byDays;
        dernieresPeriodes = { poolName, valeur: byDays };
        if (periodPointsCache === entree) rafraichirClassementEnDirect();
        return byDays;
    });
    periodPointsCache = entree;
    return entree;
}

async function lirePointsParPeriode(poolName) {
    const byDays = {};
    let bascule = null;
    await Promise.all(STANDINGS_PERIODS.map(async (days) => {
        const map = new Map();
        const ancre = PERIODES_ANCREES.has(days) ? '&ancre=soiree' : '';
        try {
            const res = await fetch(`${BASE_URL}/pool-leaderboard/${encodeURIComponent(poolName)}?days=${days}${ancre}`, { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                (data.teams || []).forEach(t => map.set(t.teamName, t.points));
                if (ancre && data.bascule) bascule = data.bascule;
                // La soirée que compte « 1 j » : hier, ou aujourd'hui une fois
                // le premier match commencé. L'onglet le dit (libelleSoiree).
                if (days === 1 && data.periode) byDays.jourSoiree = data.periode.dernierJour || null;
            }
        } catch (error) {
            console.warn(`⚠️ Could not load ${days}-day points for rank evolution:`, error);
        }
        byDays[days] = map;
    }));

    periodesDerniere = Date.now();
    planifierBasculeTendance(bascule);
    if (window.FZMemo && STANDINGS_PERIODS.every(d => byDays[d] && byDays[d].size)) {
        FZMemo.ecrire(`cl:periodes:${poolName}`, periodesVersMemo(byDays, bascule));
    }
    return byDays;
}

/** Les Map de lirePointsParPeriode, en JSON pour FZMemo, et retour. */
function periodesVersMemo(byDays, bascule) {
    const jours = {};
    STANDINGS_PERIODS.forEach(d => { jours[d] = [...byDays[d].entries()]; });
    return { jours, jourSoiree: byDays.jourSoiree || null, bascule: bascule || null };
}

function periodesDepuisMemo(m) {
    if (!m || !m.jours) return null;
    const byDays = {};
    for (const d of STANDINGS_PERIODS) {
        if (!Array.isArray(m.jours[d])) return null;
        byDays[d] = new Map(m.jours[d]);
    }
    byDays.jourSoiree = m.jourSoiree || null;
    return byDays;
}

/**
 * Au premier match du jour, la dernière soirée devient celle du jour (1 j,
 * 7 j et la pastille) : la page se relit à ce moment-là — au plus tard dans
 * une demi-heure, pour ne pas dépendre d'un minuteur que la veille de
 * l'appareil aurait retardé.
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

/**
 * Le rang de chaque équipe AVANT la dernière soirée : classée sur son total
 * moins ses points de la soirée. `standings` arrive dans l'ordre du
 * classement actuel ; à égalité, cet ordre est gardé, pour qu'une égalité
 * ne fasse pas bouger une pastille sans un point marqué.
 *
 * Une équipe dont la soirée est inconnue (null) est classée comme si elle
 * n'avait rien marqué, mais n'a pas de rang d'avant : sa pastille dit « — »
 * plutôt qu'un mouvement inventé. Sans aucune soirée connue, aucun rang.
 */
function rangsAvantSoiree(standings, pointsSoiree) {
    const rangs = new Map();
    if (!pointsSoiree || pointsSoiree.size === 0) return rangs;
    const connue = v => v !== null && v !== undefined;
    standings
        .map((s, ordre) => {
            const soiree = pointsSoiree.get(s.teamName);
            return { teamName: s.teamName, ordre, connue: connue(soiree), avant: (Number(s.points) || 0) - (connue(soiree) ? soiree : 0) };
        })
        .sort((a, b) => (b.avant - a.avant) || (a.ordre - b.ordre))
        .forEach((t, i) => { if (t.connue) rangs.set(t.teamName, i + 1); });
    return rangs;
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
        return `<span class="st-evo st-evo-up" title="A gagné ${move} place${move > 1 ? 's' : ''} pendant la dernière soirée">${EVO_ARROW_UP}${move}</span>`;
    }
    if (hasData && move < 0) {
        return `<span class="st-evo st-evo-down" title="A perdu ${-move} place${-move > 1 ? 's' : ''} pendant la dernière soirée">${EVO_ARROW_DOWN}${-move}</span>`;
    }
    const title = hasData ? 'Aucune place gagnée ni perdue pendant la dernière soirée' : 'Mouvement de la soirée pas encore connu';
    return `<span class="st-evo st-evo-flat" title="${title}">—</span>`;
}


/** Comment se lit le tableau — replié, pour ceux qui le demandent. */
function standingsLegendHTML(poolMode) {
    const lignes = poolMode === 'head-to-head'
        ? [
            ['Classement', 'Selon les victoires, puis le différentiel. Chaque semaine (lundi au dimanche), vous affrontez une équipe : celle qui marque le plus de points fantasy gagne le duel.'],
            ['V-D-N', 'Victoires, défaites et nulles dans vos duels.'],
            ['%V', 'Pourcentage de victoires : une nulle compte pour une demie.'],
            ['Écart', 'Duels de retard sur le premier : (ses victoires moins les vôtres, plus vos défaites moins les siennes) divisé par deux.'],
            ['PP · PC', 'Points fantasy marqués (pour) et encaissés (contre) dans tous vos duels : but 3, passe 2, tir 0,5, avantage numérique et désavantage en bonus ; gardiens : victoire 5, blanchissage 3, arrêt 0,2, but accordé −1.'],
            ['Diff.', 'Points pour moins points contre.'],
            ['Séquence · 5 derniers', 'Résultats de suite (V2 = deux victoires de suite) et vos 5 dernières semaines, la plus récente à gauche.']
        ]
        : [
            ['Pts', 'Ce qui décide du classement : les points de la saison. Patineurs : 1 par but et 1 par passe. Gardiens : 2 par victoire, 5 pour une victoire par blanchissage (pas 2 + 5), 1 par défaite en prolongation. Clubs de la LNH : 2 par victoire, 1 par défaite en prolongation.'],
            ['1 j · 7 j · 30 j', 'Les points marqués sur la période — la dernière soirée, 7 jours, 30 jours —, selon les mêmes règles que les Pts. La dernière soirée est celle d’hier jusqu’au premier match du jour.'],
            ['▲ ▼', 'La pastille à côté du nom : les places gagnées (▲) ou perdues (▼) au classement pendant la dernière soirée. Le matin, c’est le mouvement d’hier ; à la première mise au jeu, elle repart à zéro et suit la soirée en direct.'],
            ['PJ', 'Parties jouées par tout l’alignement.']
        ];
    return `
        <details class="st-legend">
            <summary>Comment lire ce classement</summary>
            <dl>${lignes.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join('')}</dl>
        </details>`;
}

// ==================== CLASSEMENT CUMULATIF (maquette « Classement ») ====================
// Une carte, une rangée par équipe : rang (or, argent, bronze sur le
// podium), logo du club, nom et mouvement de la soirée, PJ puis les points
// des trois périodes, le total en gros et l'écart au premier. Au-dessus, la
// période : la saison, ou les points d'une période — la liste se range
// alors sur eux, le rang et l'écart aussi. La pastille ▲▼ ne parle que de
// la saison : elle s'efface sur une période.

const ST_PERIODES = [
    { cle: 'saison', libelle: 'Saison' },
    { cle: 1, libelle: 'Hier' },
    { cle: 7, libelle: '7 jours' },
    { cle: 30, libelle: '30 jours' }
];

const ST_ICONE = {
    chevron: '<svg class="st-ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6"/></svg>',
    bas: '<svg class="st-ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>',
    aide: '<svg class="st-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/></svg>'
};

/** « Hier », ou « Ce soir » une fois la soirée du jour commencée : 1 j suit la dernière soirée. */
function libelleSoiree(byDays) {
    return byDays && byDays.jourSoiree && byDays.jourSoiree === hofAujourdhui() ? 'Ce soir' : 'Hier';
}

function ongletsPeriodeHTML(periode, byDays) {
    const boutons = ST_PERIODES.map(p => {
        const actif = p.cle === periode;
        const libelle = p.cle === 1 ? libelleSoiree(byDays) : p.libelle;
        return `<button type="button" class="st-periode${actif ? ' is-on' : ''}" aria-pressed="${actif}" data-st-periode="${p.cle}">${libelle}</button>`;
    }).join('');
    return `<div class="st-periodes" role="group" aria-label="Période du classement">${boutons}</div>`;
}

/**
 * Les équipes dans l'ordre de la période : la saison telle quelle (son rang
 * réel), ou les points de la période, la saison départageant les égalités.
 * Une équipe sans chiffre connu (null) passe derrière. Tant que les
 * périodes ne sont pas lues, l'ordre reste celui de la saison.
 */
function classementDePeriode(standings, periode, byDays) {
    if (periode === 'saison' || !byDays || !byDays[periode]) {
        return standings.map(s => ({ s, rang: s.rank, valeur: periode === 'saison' ? s.points : null }));
    }
    const carte = byDays[periode];
    const lignes = standings.map(s => ({ s, valeur: carte.has(s.teamName) ? carte.get(s.teamName) : null }));
    lignes.sort((a, b) => ((b.valeur ?? -Infinity) - (a.valeur ?? -Infinity)) || (a.s.rank - b.s.rank));
    lignes.forEach((l, i) => { l.rang = i + 1; });
    return lignes;
}

/** « En tête », « −37 du 1er », « À égalité » ; '' tant que la période n'est pas lue. */
function ecartDuPremier(ligne, tete, enAttente) {
    if (enAttente) return '';
    if (ligne.rang === 1) return 'En tête';
    if (ligne.valeur === null || ligne.valeur === undefined || tete === null || tete === undefined) return '—';
    const ecart = tete - ligne.valeur;
    return ecart > 0 ? `−${fmtPeriodPts(ecart)} du 1<sup>er</sup>` : 'À égalité';
}

function rangeeClassementHTML(ligne, ctx) {
    const s = ligne.s;
    const nom = getDisplayName(s.teamName, s.members);
    const estMoi = (s.members || []).includes(ctx.moi);
    const saison = ctx.periode === 'saison';
    // Le relevé du soir est noté à chaque rendu, période ou non : revenir à
    // la saison n'allume la pastille que si elle a vraiment monté.
    const soirHTML = pointsSoirHTML(s);

    const avant = ctx.rangAvant.get(s.teamName);
    const evoHTML = !saison ? ''
        : ctx.byDays
            ? evolutionBadgeHTML(avant !== undefined ? avant - s.rank : 0, avant !== undefined)
            : '<span class="st-evo st-evo-flat is-loading" aria-hidden="true">·</span>';
    const per = d => (ctx.byDays ? fmtPeriodPts(ctx.byDays[d].get(s.teamName)) : '·');
    const chiffres = [['PJ', 'pj', s.gamesPlayed], ['1 j', 1, per(1)], ['7 j', 7, per(7)], ['30 j', 30, per(30)]]
        .map(([libelle, cle, valeur]) => `<span class="st-chiffre${cle === ctx.periode ? ' is-on' : ''}${valeur === 0 || valeur === '0' ? ' is-zero' : ''}">`
            + `<b>${valeur}</b><small>${libelle}</small></span>`)
        .join('');

    const total = saison ? fmtPeriodPts(s.points) : (ctx.enAttente ? '·' : fmtPeriodPts(ligne.valeur));
    const ecart = ecartDuPremier(ligne, ctx.tete, ctx.enAttente);
    const podium = ['', 'is-or', 'is-argent', 'is-bronze'][ligne.rang] || '';
    const logo = getTeamLogoHTML(s.nhlTeams, 42) || `<span class="st-avatar-fallback">${escapeHtmlText(initialsFromName(nom))}</span>`;

    return `
        <div class="st-rangee is-clickable${estMoi ? ' is-me' : ''}" tabindex="0" role="button"
             aria-label="Voir l'équipe de ${escapeAttr(nom)}" data-team="${escapeAttr(s.teamName)}">
            <span class="st-rang ${podium}">${ligne.rang}</span>
            <span class="st-logo">${logo}</span>
            <span class="st-centre">
                <span class="st-nom-ligne"><span class="st-nom" title="${escapeAttr(nom)}">${escapeHtmlText(nom)}</span>${estMoi ? '<span class="st-toi">Toi</span>' : ''}${evoHTML}</span>
                <span class="st-chiffres">${chiffres}</span>
            </span>
            <span class="st-total"><span class="st-total-v">${total}${saison ? soirHTML : ''}</span>${ecart ? `<span class="st-ecart${ligne.rang === 1 ? ' is-tete' : ''}">${ecart}</span>` : ''}</span>
            ${ST_ICONE.chevron}
        </div>`;
}

/** Comment se lit la liste — replié au pied de la carte, pour qui le demande. */
function aideClassementHTML() {
    const lignes = [
        ['Pts', 'Les points de la saison : c’est eux qui font le classement. Patineurs : 1 par but et 1 par passe. Gardiens : 2 par victoire, 5 pour une victoire par blanchissage (pas 2 + 5), 1 par défaite en prolongation. Clubs de la LNH : 2 par victoire, 1 par défaite en prolongation.'],
        ['Saison · Hier · 7 · 30 jours', 'Range la liste sur les points de la période. Le rang et l’écart suivent ; à égalité, la saison départage.'],
        ['1 j · 7 j · 30 j', 'Les points de la dernière soirée, des 7 et des 30 derniers jours, selon les mêmes règles. La dernière soirée est celle d’hier jusqu’au premier match du jour.'],
        ['Écart', 'Les points derrière le premier, pour la période choisie.'],
        ['▲ ▼', 'Les places gagnées ou perdues au classement de la saison pendant la dernière soirée. Le matin, c’est le mouvement d’hier ; à la première mise au jeu, la pastille repart à zéro et suit la soirée en direct.'],
        ['PJ', 'Parties jouées par tout l’alignement de l’équipe cette saison.']
    ];
    return `
        <details class="st-aide">
            <summary>${ST_ICONE.aide}<span>Comment lire ce classement</span>${ST_ICONE.bas}</summary>
            <dl>${lignes.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join('')}</dl>
        </details>`;
}

/**
 * « ce matin 6 h », « hier 23 h », « sam. 18 oct., 6 h » : l'heure d'un
 * relevé, dite comme on la dirait.
 */
function quandReleve(iso, maintenant = new Date()) {
    const instant = Date.parse(iso);
    if (!Number.isFinite(instant)) return '';
    const d = new Date(instant);
    const heure = `${d.getHours()} h${d.getMinutes() ? ` ${String(d.getMinutes()).padStart(2, '0')}` : ''}`;
    const jour = x => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
    const hier = new Date(maintenant);
    hier.setDate(hier.getDate() - 1);
    if (jour(d) === jour(maintenant)) {
        return `${d.getHours() < 12 ? 'ce matin' : d.getHours() < 18 ? 'cet après-midi' : 'ce soir'} ${heure}`;
    }
    if (jour(d) === jour(hier)) return `hier ${heure}`;
    return `${d.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' })}, ${heure}`;
}

/**
 * La fraîcheur des totaux, à droite du titre : l'heure du dernier relevé de
 * la LNH (/current-stats), ou « En direct » quand les matchs du soir s'y
 * ajoutent déjà (pointsDirect.js).
 */
function fraicheurClassementHTML(standings) {
    if (standings.some(s => (s.enDirect || 0) > 0)) {
        return '<span class="st-maj-direct"><i aria-hidden="true"></i>En direct</span>';
    }
    const quand = quandReleve(currentStatsBase && currentStatsBase.lastUpdated);
    return quand ? `À jour · ${quand}` : '';
}

function majFraicheur(html) {
    const zone = document.getElementById('stMaj');
    if (!zone) return;
    zone.innerHTML = html;
    zone.hidden = !html;
}

/** Choisir une période : la liste se redessine, le focus reste sur l'onglet. */
function choisirPeriodeClassement(cle) {
    const periode = cle === 'saison' ? 'saison' : Number(cle);
    if (periode === standingsPeriode || !ST_PERIODES.some(p => p.cle === periode)) return;
    standingsPeriode = periode;
    const poolData = allPoolsData[currentPoolName];
    if (poolData) renderPoolStandings(poolData, currentPoolName).catch(console.error);
}




// ==================== H2H — ONGLET CLASSEMENT ====================
//
// L'onglet Classement d'un pool H2H se lit comme une fiche de ligue (maquette
// « A · Fiche », inspirée d'ESPN) : une table pleine largeur, V-D-N, %V et
// l'écart au premier ; sur bureau, s'y ajoutent les points pour et contre, le
// différentiel, la séquence et les 5 dernières semaines. Au-dessus, des
// raccourcis ronds (Calendrier, Historique, Records, Échanges) ; dessous, le
// temple de la renommée et les derniers résultats.
//
// Rien de tout cela n'a besoin du réseau : le bilan et l'historique sont déjà
// dans poolData.h2hData, chargé une fois par FZPool.

const H2H_FORM_LENGTH = 5;

const H2H_FORM_LABEL = { W: 'Victoire', L: 'Défaite', T: 'Nulle' };

const H2H_ICON = {
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

/** Les colonnes de la fiche H2H ; `bureau` = cachée sur téléphone. */
const H2H_COLONNES = [
    { libelle: '#', cls: 'hf-rang' },
    { libelle: 'Équipe', cls: 'hf-equipe' },
    { libelle: 'V-D-N', cls: 'hf-num', titre: 'Victoires - défaites - nulles' },
    { libelle: '%V', cls: 'hf-num', titre: 'Pourcentage de victoires' },
    { libelle: 'Écart', cls: 'hf-num', titre: 'Duels de retard sur le premier' },
    { libelle: 'PP', cls: 'hf-num hf-bureau', titre: 'Points pour' },
    { libelle: 'PC', cls: 'hf-num hf-bureau', titre: 'Points contre' },
    { libelle: 'Diff.', cls: 'hf-num hf-bureau', titre: 'Points pour moins points contre' },
    { libelle: 'Séquence', cls: 'hf-num hf-bureau', titre: 'Résultats de suite' },
    { libelle: '5 derniers', cls: 'hf-forme hf-bureau', titre: 'Les 5 dernières semaines, la plus récente à gauche' }
];

/**
 * Duels de retard sur le premier, à la façon des ligues : la moitié de
 * l'écart en victoires plus l'écart en défaites. « – » pour le premier.
 */
function h2hEcartDuPremier(equipe, tete) {
    if (!tete || equipe === tete) return '–';
    const ecart = ((tete.wins - equipe.wins) + (equipe.losses - tete.losses)) / 2;
    return ecart <= 0 ? '–' : String(ecart).replace('.', ',');
}

/** « V2 », « D1 », « N1 » : la suite en cours, lue dans la forme (la plus récente d'abord). */
function h2hSequence(suite) {
    if (!suite || !suite.length) return '–';
    let n = 0;
    while (n < suite.length && suite[n] === suite[0]) n++;
    return { W: 'V', L: 'D', T: 'N' }[suite[0]] + n;
}

/** Les rangées de la fiche H2H, dans l'ordre du classement. */
function rangeesFicheH2H(poolData, standings) {
    const moi = localStorage.getItem('username');
    const formes = computeH2HForm(poolData);
    const tete = standings[0];
    return standings.map(e => {
        const nom = getDisplayName(e.teamName, e.members);
        const logo = getTeamLogoHTML(e.nhlTeams, 30) || `<span class="st-avatar-fallback">${initialsFromName(nom)}</span>`;
        const proprio = (e.members || []).join(', ');
        const mienne = (e.members || []).includes(moi);
        const forme = formes.get(e.teamName);
        const sequence = h2hSequence(forme);
        const diff = Math.round((e.diff || 0) * 10) / 10;
        return `
            <tr class="h2h-fiche-rangee${mienne ? ' is-me' : ''}" data-team="${escapeAttr(e.teamName)}" tabindex="0" role="button" aria-label="Voir l'équipe ${escapeAttr(nom)}">
                <td class="hf-rang">${e.rank}</td>
                <td class="hf-equipe"><span class="hf-club">
                    <span class="hf-logo">${logo}</span>
                    <span class="hf-noms"><span class="hf-nom">${escapeHtmlText(nom)}${mienne ? '<span class="hf-toi">Toi</span>' : ''}</span>${proprio && proprio !== nom ? `<span class="hf-proprio">${escapeHtmlText(proprio)}</span>` : ''}</span>
                </span></td>
                <td class="hf-num">${e.wins}-${e.losses}-${e.ties}</td>
                <td class="hf-num">${h2hWinPct(e).replace('.', ',')}</td>
                <td class="hf-num${e === tete ? ' hf-mute' : ''}">${h2hEcartDuPremier(e, tete)}</td>
                <td class="hf-num hf-bureau">${fmtH2HPts(e.pointsFor).replace('.', ',')}</td>
                <td class="hf-num hf-bureau hf-mute">${fmtH2HPts(e.pointsAgainst).replace('.', ',')}</td>
                <td class="hf-num hf-bureau ${diff > 0 ? 'hf-plus' : diff < 0 ? 'hf-moins' : ''}">${diff < 0 ? '−' + fmtH2HPts(-diff).replace('.', ',') : fmtH2HDiff(diff).replace('.', ',')}</td>
                <td class="hf-num hf-bureau ${sequence[0] === 'V' ? 'hf-plus' : sequence[0] === 'D' ? 'hf-moins' : ''}">${sequence}</td>
                <td class="hf-forme hf-bureau">${h2hFormeHTML(forme)}</td>
            </tr>`;
    }).join('');
}

/** Les 5 dernières semaines en lettres V/D/N, la plus récente à gauche. */
function h2hFormeHTML(suite) {
    const resultats = suite || [];
    if (!resultats.length) return '<span class="hf-mute">–</span>';
    const lettre = { W: 'V', L: 'D', T: 'N' };
    return `<span class="hf-pastilles" role="img" aria-label="${escapeAttr(resultats.map(r => H2H_FORM_LABEL[r]).join(', ') + ' (du plus récent au plus ancien)')}">${
        resultats.map(r => `<i class="is-${r.toLowerCase()}">${lettre[r]}</i>`).join('')}</span>`;
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
 * Le rendu ne lit plus rien : les points par période arrivent à part et le
 * redemandent (fetchStandingsPeriodPoints). Un rendu lent ne peut donc plus
 * finir après un plus récent et réécrire les totaux de minuit.
 */
async function renderPoolStandings(poolData, poolName) {
    const poolMode = poolData.poolMode || 'cumulative';
    const standingsList = document.getElementById('standingsList');

    const standings = computeStandings(poolData);

    if (standings.length === 0) {
        standingsList.innerHTML = `
            <div class="st-empty">
                <p class="st-empty-title">Aucune équipe complète pour le moment</p>
                <p class="st-empty-hint">Le classement apparaît une fois les équipes formées.</p>
            </div>`;
        document.getElementById('standingsSkeleton').style.display = 'none';
        standingsList.style.display = 'block';
        return;
    }

    const enH2H = poolMode === 'head-to-head';

    // Points par période (1/7/30j) et mouvement de la soirée : pas de
    // pendant H2H, qui n'a ni colonnes période ni pastille. Pas attendus :
    // tant qu'ils courent, les cases restent en attente, et leur arrivée
    // redessine la liste (fetchStandingsPeriodPoints).
    const periodes = enH2H ? null : fetchStandingsPeriodPoints(poolName);
    const byDays = periodes ? (periodes.valeur || periodes.precedente) : null;

    if (enH2H) {
        // Maquette « Fiche » (style ESPN) : une table pleine largeur, une
        // rangée par équipe, sans carte autour. Les colonnes du bureau
        // (PP, PC, Diff., Séquence, 5 derniers) sont toujours rendues ; le
        // CSS les cache sur téléphone (classementH2H.css).
        standingsList.innerHTML = `<table class="h2h-fiche">
                <thead><tr>${H2H_COLONNES.map(c => `<th class="${c.cls}"${c.titre ? ` title="${escapeAttr(c.titre)}"` : ''}>${c.libelle}</th>`).join('')}</tr></thead>
                <tbody>${rangeesFicheH2H(poolData, standings)}</tbody>
            </table>
            ${standingsLegendHTML(poolMode)}`;
    } else {
        // Une seule liste, sur téléphone comme sur bureau — maquette
        // « Classement » (rangeeClassementHTML). Le direct la redessine toutes
        // les 20 s pendant les matchs : le focus revient à la même rangée, au
        // même onglet, et la légende ouverte le reste.
        const actif = standingsList.contains(document.activeElement) ? document.activeElement : null;
        const focusEquipe = actif && actif.dataset ? actif.dataset.team : null;
        const focusPeriode = actif && actif.dataset ? actif.dataset.stPeriode : null;
        const aideOuverte = !!standingsList.querySelector('.st-aide[open]');

        const periode = standingsPeriode;
        const lignes = classementDePeriode(standings, periode, byDays);
        const ctx = {
            periode,
            byDays,
            moi: localStorage.getItem('username'),
            rangAvant: rangsAvantSoiree(standings, byDays && byDays[1]),
            enAttente: periode !== 'saison' && !byDays,
            tete: lignes.length ? lignes[0].valeur : null
        };
        standingsList.innerHTML = `
            ${ongletsPeriodeHTML(periode, byDays)}
            <section class="st-carte" aria-label="Classement du pool">
                <div class="st-rangees">${lignes.map(l => rangeeClassementHTML(l, ctx)).join('')}</div>
                ${aideClassementHTML()}
            </section>`;
        if (aideOuverte) standingsList.querySelector('.st-aide').open = true;
        const cible = focusEquipe
            ? [...standingsList.querySelectorAll('.st-rangee')].find(r => r.dataset.team === focusEquipe)
            : focusPeriode ? standingsList.querySelector(`[data-st-periode="${focusPeriode}"]`) : null;
        if (cible) cible.focus({ preventScroll: true });

        majFraicheur(fraicheurClassementHTML(standings));
    }

    // Délégation sur le conteneur : reconstruit à chaque tri/rendu, un
    // écouteur par <th>/.st-rangee fuirait à chaque passe
    // (comme initStatsHeaderSorting).
    standingsList.onclick = (e) => {
        const onglet = e.target.closest('[data-st-periode]');
        if (onglet) { choisirPeriodeClassement(onglet.dataset.stPeriode); return; }
        const rangee = e.target.closest('.st-rangee, .h2h-fiche-rangee');
        if (rangee) showTeamRoster(poolName, rangee.dataset.team);
    };
    standingsList.onkeydown = (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const rangee = e.target.closest('.st-rangee, .h2h-fiche-rangee');
        if (rangee) { e.preventDefault(); showTeamRoster(poolName, rangee.dataset.team); }
    };

    document.getElementById('standingsSkeleton').style.display = 'none';
    standingsList.style.display = 'block';

    // En H2H le temple de la renommée a son propre raccourci « Records » et
    // ne s'affiche que là, seul ; en cumulatif il suit le classement.
    if (!enH2H) renderHallOfFame(poolName);
}

// ==================== TEMPLE DE LA RENOMMÉE ====================
// Les records de la saison (meilleure et pire journée, semaine, mois en
// points de pool), calculés côté serveur à partir des vrais matchs — voir
// GET /pool-hall-of-fame.
//
// Maquette « Classement » : une carte en or pour le record choisi — le
// chiffre, l'équipe, la date, et le pire en une ligne dessous —, puis la
// liste des trois périodes, qui choisit celle de la carte. C'est un temple,
// pas un tableau à deux colonnes de même poids. Les noms d'équipe de la
// carte ouvrent leur fiche, comme une rangée du classement.

const HOF_PERIODES = [
    { cle: 'Day', titre: 'Meilleure journée', date: hofDateJour, icone: 'jour' },
    { cle: 'Week', titre: 'Meilleure semaine', date: hofDateSemaine, icone: 'semaine' },
    { cle: 'Month', titre: 'Meilleur mois', date: hofDateMois, icone: 'mois' }
];

/** Le record montré dans la carte : une période par pool, la journée d'abord. */
let hofEtat = { poolName: null, data: null, choix: 0 };

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

// Les pictogrammes du temple, au trait — la médaille de la carte, une
// période par rangée (journée, semaine, mois).
const HOF_TRAITS = {
    medaille: '<circle cx="12" cy="9" r="6"/><path d="M8.6 13.8 7 22l5-3 5 3-1.6-8.2"/>',
    jour: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><rect x="7" y="13" width="4" height="4" rx="1" fill="currentColor" stroke="none"/>',
    semaine: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M7 15.5h10"/>',
    mois: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" stroke-width="2.6"/>'
};

function hofIcone(nom, taille = 20) {
    return `<svg class="hof-ico" viewBox="0 0 24 24" width="${taille}" height="${taille}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${HOF_TRAITS[nom] || ''}</svg>`;
}

// Icône trophée pleine, reprise de l'ancien tableau.
function trophyIconHTML(cls) {
    return `<svg class="hof-icon ${cls}" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M5 4h14v2h2v3a5 5 0 0 1-5 5h-.26A6 6 0 0 1 13 17.65V20h3v2H8v-2h3v-2.35A6 6 0 0 1 8.26 14H8a5 5 0 0 1-5-5V6h2V4zm0 4H5v1a3 3 0 0 0 2.6 2.97A8.9 8.9 0 0 1 5 8zm14 0a8.9 8.9 0 0 1-2.6 3.97A3 3 0 0 0 19 9V8z"></path></svg>`;
}

/** Une seule équipe a joué : son meilleur est aussi son pire, inutile de le répéter. */
function hofMemeEntree(best, worst) {
    return !!(best && worst && best.teamName === worst.teamName
        && best.date === worst.date && best.points === worst.points);
}

/** Le logo du club de l'équipe, ou ses initiales. */
function hofLogoHTML(entry, ctx, taille) {
    const equipe = ctx.equipes[entry.teamName];
    const nom = getDisplayName(entry.teamName, entry.members);
    return `<span class="hof-logo">${(equipe && getTeamLogoHTML(equipe.teams, taille))
        || `<span class="st-avatar-fallback">${escapeHtmlText(initialsFromName(nom))}</span>`}</span>`;
}

/**
 * Le nom d'une équipe du temple : un bouton vers sa fiche si l'équipe est
 * encore dans le pool, du texte sinon. `taille` : celle du logo, ou rien.
 */
function hofEquipeHTML(entry, ctx, cls, taille) {
    const equipe = ctx.equipes[entry.teamName];
    const nom = getDisplayName(entry.teamName, entry.members);
    const moi = entry.teamName === ctx.mienne ? '<span class="hof-toi">Toi</span>' : '';
    const contenu = `${taille ? hofLogoHTML(entry, ctx, taille) : ''}<span class="hof-nom">${escapeHtmlText(nom)}</span>${moi}`;
    if (!equipe) return `<span class="${cls}" title="${escapeAttr(nom)}">${contenu}</span>`;
    return `<button type="button" class="${cls} is-link" data-hof-team="${escapeAttr(entry.teamName)}"
                title="Voir l’équipe ${escapeAttr(nom)}">${contenu}</button>`;
}

/** La date d'un record ; « en cours » si sa période n'est pas finie (le record peut encore tomber). */
function hofQuandHTML(entry, periode, ctx, cls, marquer = true) {
    const enCours = marquer && hofEnCours(periode.cle, entry.date, ctx.aujourdhui)
        ? '<span class="hof-live">en cours</span>' : '';
    return `<span class="${cls}">${escapeHtmlText(periode.date(entry.date))}${enCours}</span>`;
}

/** La carte en or : le record de la période choisie, le pire dessous. */
function hofVedetteHTML(periode, best, worst, ctx) {
    const enCours = best && hofEnCours(periode.cle, best.date, ctx.aujourdhui);
    const haut = `
        <div class="hof-vedette-haut">
            <span class="hof-puce">${hofIcone('medaille', 14)}${periode.titre}</span>
            ${enCours ? '<span class="hof-direct"><i aria-hidden="true"></i>En cours</span>' : ''}
        </div>`;
    if (!best) {
        return `
        <article class="hof-vedette is-vide">${haut}
            <div class="hof-record"><span class="hof-gros">—</span><span class="hof-qui"><span class="hof-quand">Aucun match encore</span></span></div>
        </article>`;
    }
    const pire = worst && !hofMemeEntree(best, worst) ? `
            <div class="hof-pire">
                <span class="hof-pire-l">Pire</span>
                <span class="hof-pire-pts">${fmtPeriodPts(worst.points)}<small>pts</small></span>
                ${hofEquipeHTML(worst, ctx, 'hof-pire-equipe', 18)}
                ${hofQuandHTML(worst, periode, ctx, 'hof-pire-quand')}
            </div>` : '';
    return `
        <article class="hof-vedette">${haut}
            <div class="hof-record">
                <span class="hof-gros">${fmtPeriodPts(best.points)}<small>pts</small></span>
                <span class="hof-qui">
                    ${hofEquipeHTML(best, ctx, 'hof-equipe', 24)}
                    ${hofQuandHTML(best, periode, ctx, 'hof-quand', false)}
                </span>
            </div>${pire}
        </article>`;
}

/** Une période dans la liste : son record et son pire, et le choix de la carte. */
function hofRangeeHTML(periode, best, worst, ctx, i, choisi) {
    const direct = [best, worst].some(e => e && hofEnCours(periode.cle, e.date, ctx.aujourdhui));
    const ligne = (cle, e, cls) => `
                    <span class="hof-k${cls}">${cle}</span>
                    <span class="hof-v${cls}">${fmtPeriodPts(e.points)}</span>
                    <span class="hof-e${cls}">${hofLogoHTML(e, ctx, 14)}<span class="hof-e-txt">${escapeHtmlText(getDisplayName(e.teamName, e.members))} · ${escapeHtmlText(periode.date(e.date))}</span></span>`;
    const grille = best
        ? ligne('Top', best, '') + (worst && !hofMemeEntree(best, worst) ? ligne('Pire', worst, ' is-pire') : '')
        : '<span class="hof-k">Top</span><span class="hof-v">—</span><span class="hof-e"><span class="hof-e-txt">Aucun match encore</span></span>';
    return `
            <button type="button" class="hof-rangee${choisi ? ' is-on' : ''}" data-hof-choix="${i}" aria-pressed="${choisi}">
                <span class="hof-rangee-ico">${hofIcone(periode.icone, 20)}</span>
                <span class="hof-rangee-txt">
                    <span class="hof-rangee-titre">${periode.titre}${direct ? '<i class="hof-point" aria-hidden="true"></i><span class="st-sk-sr">, en cours</span>' : ''}</span>
                    <span class="hof-grille">${grille}</span>
                </span>
                ${ST_ICONE.chevron}
            </button>`;
}

function hofTeteHTML(saison) {
    let libelle = 'Saison en cours';
    if (typeof seasonLabel === 'function') {
        try { libelle = seasonLabel(saison || currentSeasonId()); } catch (_) { /* libellé générique */ }
    }
    return `
        <div class="hof-tete">
            ${trophyIconHTML('hof-trophee')}
            <h2 class="hof-title">Temple de la renommée</h2>
            <span class="hof-saison" title="Records de la saison ${escapeAttr(libelle)}">${escapeHtmlText(libelle)}</span>
        </div>`;
}

/**
 * Le temple fantôme, le temps que /pool-hall-of-fame réponde — et dans le
 * squelette du classement. Les vrais titres restent ; des os prennent la
 * place des chiffres, des équipes et des dates, dans la structure du temple
 * chargé (buildHallOfFameHTML) : il garde sa forme.
 */
function hofChargementHTML() {
    const rangees = HOF_PERIODES.map(periode => `
            <div class="hof-rangee is-loading" aria-hidden="true">
                <span class="hof-rangee-ico">${hofIcone(periode.icone, 20)}</span>
                <span class="hof-rangee-txt">
                    <span class="hof-rangee-titre">${periode.titre}</span>
                    <span class="hof-grille">
                        <span class="hof-k">Top</span><span class="fz-bone hof-sk-v"></span><span class="fz-bone-flat hof-sk-e"></span>
                        <span class="hof-k is-pire">Pire</span><span class="fz-bone-flat hof-sk-v"></span><span class="fz-bone-flat hof-sk-e is-court"></span>
                    </span>
                </span>
            </div>`).join('');
    return `${hofTeteHTML(null)}
        <div class="hof-corps" aria-busy="true">
            <div class="hof-vedette is-loading" aria-hidden="true">
                <div class="hof-vedette-haut"><span class="hof-puce">${hofIcone('medaille', 14)}${HOF_PERIODES[0].titre}</span></div>
                <div class="hof-record"><span class="fz-bone hof-sk-gros"></span><span class="hof-qui"><span class="fz-bone hof-sk-nom"></span><span class="fz-bone-flat hof-sk-quand"></span></span></div>
                <div class="hof-pire"><span class="hof-pire-l">Pire</span><span class="fz-bone-flat hof-sk-pire"></span></div>
            </div>
            <div class="hof-liste">${rangees}</div>
        </div>`;
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
    const choix = hofEtat.poolName === poolName && HOF_PERIODES[hofEtat.choix] ? hofEtat.choix : 0;
    const p = HOF_PERIODES[choix];
    const liste = HOF_PERIODES
        .map((q, i) => hofRangeeHTML(q, data[`best${q.cle}`], data[`worst${q.cle}`], ctx, i, i === choix))
        .join('');
    return `${head}
        <div class="hof-corps">
            ${hofVedetteHTML(p, data[`best${p.cle}`], data[`worst${p.cle}`], ctx)}
            <div class="hof-liste" role="group" aria-label="Records de la saison">${liste}</div>
        </div>`;
}

/** Redessine le temple en mémoire ; le focus revient au bouton équivalent. */
function dessinerTemple(container, poolName) {
    const actif = container.contains(document.activeElement) ? document.activeElement : null;
    const choix = actif && actif.dataset ? actif.dataset.hofChoix : undefined;
    const equipe = actif && actif.dataset ? actif.dataset.hofTeam : undefined;
    container.innerHTML = buildHallOfFameHTML(hofEtat.data, poolName);
    const cible = choix !== undefined
        ? container.querySelector(`[data-hof-choix="${choix}"]`)
        : equipe !== undefined
            ? [...container.querySelectorAll('[data-hof-team]')].find(b => b.dataset.hofTeam === equipe)
            : null;
    if (cible) cible.focus({ preventScroll: true });
}

/** Une rangée de la liste choisit le record de la carte en or. */
function choisirRecordTemple(poolName, choix) {
    if (hofEtat.poolName !== poolName || !hofEtat.data || !HOF_PERIODES[choix] || choix === hofEtat.choix) return;
    hofEtat.choix = choix;
    const container = document.getElementById('hallOfFame');
    if (container) dessinerTemple(container, poolName);
}

async function renderHallOfFame(poolName) {
    const container = document.getElementById('hallOfFame');
    if (!container) return;
    if (hofEtat.poolName !== poolName) hofEtat = { poolName, data: null, choix: 0 };

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
        const rangee = e.target.closest('[data-hof-choix]');
        if (rangee) { choisirRecordTemple(poolName, Number(rangee.dataset.hofChoix)); return; }
        const bouton = e.target.closest('[data-hof-team]');
        if (bouton) showTeamRoster(poolName, bouton.dataset.hofTeam);
    };

    try {
        const response = await fetch(`${BASE_URL}/pool-hall-of-fame/${encodeURIComponent(poolName)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (currentPoolName !== poolName) return;
        hofEtat.data = data;
        dessinerTemple(container, poolName);
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
    const mienne = estMonEquipe(poolName, teamName);
    suivreVue(mienne ? 'equipe' : 'fiche');
    // Pool H2H : les onglets du haut restent, « Mon équipe » allumé sur la
    // mienne, « Classement » sur celle d'un autre (on y arrive par sa rangée).
    const h2hTabs = document.getElementById('h2hTabs');
    document.body.classList.toggle('fz-pool-h2h', estPoolH2H(poolName));
    if (estPoolH2H(poolName)) {
        h2hTabs.style.display = '';
        allumerOngletH2H(mienne ? 'equipe' : 'standings');
    } else {
        h2hTabs.style.display = 'none';
    }

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

    // Un pool sans échanges n'a rien à mettre en vente ni à proposer : on
    // saute l'appel aux annonces et les boutons disparaissent de la fiche.
    // Seule l'équipe elle-même peut mettre ses joueurs en vente.
    const tradesAllowed = poolData.allowTrades !== false;
    rosterSale = {
        poolName,
        teamName,
        mienne,
        echanges: tradesAllowed,
        canSell: tradesAllowed && mienne,
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
    swap: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>',
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
 * l'équipe se situe.
 *
 * Les actions suivent l'équipe affichée (actionsFicheHTML) :
 *   — la mienne, c'est l'onglet « Mon équipe » : « Mettre en vente » (un
 *     seul point d'entrée au lieu d'un bouton par rangée) et, à côté,
 *     « Échanges », la porte de la page des échanges, avec le nombre
 *     d'offres reçues. Pas de retour : les onglets du bas font le chemin ;
 *   — celle d'un autre : « Proposer un échange », qui ouvre le générateur
 *     sur cette équipe.
 * Un pool sans échanges n'a aucun de ces boutons.
 */
function actionsFicheHTML(teamName) {
    if (!rosterSale.echanges) return '';
    if (rosterSale.mienne) {
        const enAttente = Number(window.fzEchangesEnAttente) || 0;
        return `
        <div class="rh-actions">
            <button type="button" class="rh-act rh-sale" data-rh-sale aria-haspopup="dialog" aria-label="Mettre en vente">
                ${tagIcon(16)}<span class="rh-sale-long">Mettre en vente</span><span class="rh-sale-count" hidden></span>
            </button>
            <a class="rh-act rh-trade" href="trade.html" data-rh-trade>
                ${RH_ICON.swap}<span>Échanges</span><span class="rh-trade-count" id="ficheTradeBadge"${enAttente ? '' : ' style="display:none"'}>${enAttente || ''}</span>
            </a>
        </div>`;
    }
    // Sans équipe à soi dans ce pool, rien à offrir en retour.
    const moi = localStorage.getItem('username');
    const equipes = (allPoolsData[rosterSale.poolName] || {}).teams || {};
    if (!Object.values(equipes).some(e => (e.members || []).includes(moi))) return '';
    return `
        <div class="rh-actions">
            <a class="rh-act rh-offer" href="trade.html?withTeam=${encodeURIComponent(teamName)}">
                ${RH_ICON.swap}<span>Proposer un échange</span>
            </a>
        </div>`;
}

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

    // Le nom, une ligne dessous qui dit tout le reste — rang, bilan, nombre
    // d'actifs (renderTeamRoster) — puis les actions. La grille de
    // .roster-header place chaque morceau (classement.css,
    // classement-premium.css sur téléphone).
    const header = document.getElementById('rosterHeader');
    header.classList.toggle('is-mine', rosterSale.mienne);
    // Dans un pool H2H, ma fiche est l'onglet « Mon équipe » : un écran de
    // départ, pas une page sous le classement, donc pas de retour.
    const sansRetour = rosterSale.mienne && estPoolH2H(poolName);
    header.innerHTML = `
        ${sansRetour ? '' : `<button type="button" class="rh-back" data-rh-back aria-label="Retour au classement">${RH_ICON.back}</button>`}
        <div class="rh-title${picker ? ' has-picker' : ''}">
            <h1 class="rh-name">${escapeHtmlText(getDisplayName(teamName, teamData.members || []))}</h1>
            ${picker ? `<span class="rh-caret">${RH_ICON.caret}</span>${picker}` : ''}
        </div>
        <p class="rh-sub"><span class="rh-rank">${sous}</span><span class="rh-count"></span></p>
        ${actionsFicheHTML(teamName)}`;

    const retour = header.querySelector('[data-rh-back]');
    if (retour) retour.addEventListener('click', () => showPoolStandings(poolName));
    const select = header.querySelector('.rh-picker');
    if (select) select.addEventListener('change', () => showTeamRoster(poolName, select.value));
    const vendre = header.querySelector('[data-rh-sale]');
    if (vendre) vendre.addEventListener('click', openSaleSheet);
    // Des offres attendent : la page s'ouvre sur « Reçus ». Le compte arrive
    // après le rendu (navbar.js, checkPendingTrades), d'où la lecture au clic.
    const echanges = header.querySelector('[data-rh-trade]');
    if (echanges) echanges.addEventListener('click', () => {
        echanges.href = Number(window.fzEchangesEnAttente) > 0 ? 'trade.html?onglet=recus' : 'trade.html';
    });
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

const POSITION_PAR_DEFAUT = { offensive: 'F', defensive: 'D', goalie: 'G', rookie: 'R' };

/**
 * Un choix de la fiche, tel que ses rangées le lisent. Chaque choix paraît —
 * même un joueur que nhl_filtered_stats.json ne connaît pas (voir
 * ficheJoueur). Une recrue gardienne est comptée en gardienne.
 */
function joueurDeFiche(playerName, category) {
    const fiche = ficheJoueur(playerName, category);
    const stats = getCurrentPlayerStats(playerName, fiche.playerId);
    return {
        name: playerName,
        position: fiche.gardien ? 'G' : (fiche.position || POSITION_PAR_DEFAUT[category] || 'F'),
        type: fiche.gardien ? 'goalie' : 'player',
        category,
        playerId: fiche.playerId || stats?.playerId || null,
        stats: stats,
        cached: fiche.cache,
        teamAbbrev: stats?.teamAbbrev || fiche.club
    };
}

/**
 * Une rangée de la fiche d'équipe (partant, club ou joueur de banc), et ce
 * que le panneau de mise en vente en reprend.
 */
function rangeeFiche(player, numero, extremes) {
    const row = document.createElement('div');
    row.className = 'roster-row';
    row.dataset.player = player.name;

    const alignable = alignementFiche.modifiable && LIB_POSTE[player.category];
    if (alignable) {
        row.classList.add('clickable');
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', `Modifier l’alignement : ${player.name}`);
        row.onclick = () => ouvrirAlignement(player.name);
        row.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrirAlignement(player.name); } };
    } else if (player.playerId) {
        row.classList.add('clickable');
        row.onclick = () => showCareerStats(player.playerId, player.name, player.type === 'goalie');
    }
    if (player.banc) row.classList.add('is-banc');
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
    const demain = changementDemain(player.name);
    alignementFiche.joueurs.set(player.name, { ...player, meta, points, avatarHTML: null });

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

    alignementFiche.joueurs.get(player.name).avatarHTML = avatarHTML;

    // « En vente » : une pastille après le club · position quand la bande
    // a la place, une étiquette sur la photo sinon (classement.css).
    row.innerHTML = `
        <div class="rr-rank">${player.banc ? '' : numero}</div>
        <div class="rr-shot">
            ${avatarHTML}
            <span class="rr-sale-dot" aria-hidden="true">${tagIcon(10)}</span>
        </div>
        <div class="rr-main">
            <div class="rr-name-line">
                <span class="rr-name">${nomHTML}</span>${estClub ? '' : injBadge(player.name, teamAbbrev)}
                <span class="rr-meta">${escapeHtmlText(meta)}</span>
                <span class="rr-sale">En vente</span>${demain ? `<span class="rr-demain">${demain}</span>` : ''}
            </div>
            <div class="rr-stats">${statsRangeeHTML(chiffres)}</div>
        </div>
        <div class="rr-soiree">${soireeBadgeHTML(ppa)}</div>
        <div class="rr-ppts${points ? '' : ' is-zero'}"><span class="rr-marks">${player.banc ? '' : marquesHTML(player, points, soiree, extremes)}</span><span class="rr-v">${points}</span><span class="rr-l">PPts</span></div>
        <span class="rr-chev" aria-hidden="true">${alignable || player.playerId ? '›' : ''}</span>
    `;

    return { row, vente: { name: player.name, category: player.category, meta, points, avatarHTML } };
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
    ['offensive', 'defensive', 'goalie', 'rookie'].forEach(category => {
        (roster[category] || []).forEach(playerName => players.push(joueurDeFiche(playerName, category)));
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

    // Pool tête-à-tête avec banc : toucher un joueur de mon équipe ouvre
    // « Modifier l'alignement » (ouvrirAlignement) ; sinon, sa fiche carrière.
    const quotaBanc = typeof window.fzQuotaBanc === 'function' ? window.fzQuotaBanc(allPoolsData[currentPoolName]) : 0;
    alignementFiche = { roster, quota: quotaBanc, modifiable: !!quotaBanc && rosterSale.mienne, joueurs: new Map() };

    players.forEach((player, index) => {
        const { row, vente } = rangeeFiche(player, index + 1, extremes);
        rosterSale.players.push(vente);
        rangees.appendChild(row);
    });
    const bancJoueurs = quotaBanc
        ? (roster.bench || []).map(b => (typeof b === 'string' ? { nom: b, categorie: null } : b))
            .map(b => ({ ...joueurDeFiche(b.nom, b.categorie), banc: true }))
        : [];
    rosterAffiche = [...players, ...bancJoueurs];

    refreshSaleMarks();
    if (quotaBanc) renderBancFiche(rosterList, roster, bancJoueurs);

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
        if (marques) marques.innerHTML = player.banc ? '' : marquesHTML(player, chiffres.points, soiree, extremes);
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

/** Le court d'un poste, comme au face-à-face des duels. */
const LIB_POSTE = { offensive: 'ATT', defensive: 'DÉF', goalie: 'GAR', rookie: 'REC' };

/** La fiche affichée, pour « Modifier l'alignement » : son alignement et ses rangées. */
let alignementFiche = { roster: null, quota: 0, modifiable: false, joueurs: new Map() };

/** Les changements pas encore en vigueur (datés de demain ou après). */
function changementsPrevus(roster) {
    const aujourdhui = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    return ((roster && roster.lineupChanges) || []).filter(c => c.date > aujourdhui);
}

/** « Entre demain » / « Sort demain » : un changement fait aujourd'hui compte dès demain. */
function changementDemain(nom) {
    const prevus = changementsPrevus(alignementFiche.roster);
    // Le dernier changement qui le touche dit où il sera demain.
    for (let i = prevus.length - 1; i >= 0; i--) {
        if (prevus[i].entre === nom) return 'Entre demain';
        if (prevus[i].sort === nom) return 'Sort demain';
    }
    return '';
}

/**
 * Le banc, sous les partants : les mêmes rangées, sans rang. Sur ma fiche,
 * toucher une rangée (partant ou banc) ouvre « Modifier l'alignement ».
 */
function renderBancFiche(rosterList, roster, bancJoueurs) {
    const { quota, modifiable } = alignementFiche;
    const esc = escapeHtmlText;
    const jour = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    const prevus = changementsPrevus(roster);

    const bloc = document.createElement('section');
    bloc.className = 'roster-block bench-block';
    bloc.setAttribute('aria-labelledby', 'benchTitle');
    bloc.innerHTML = `
        <header class="bench-head">
            <h3 class="bench-title" id="benchTitle">Banc <span>${bancJoueurs.length}/${quota}</span></h3>
            <p class="bench-hint">${modifiable
                ? 'Touchez un joueur pour le faire entrer ou le mettre au banc. Le banc ne marque pas ; un changement compte dès demain.'
                : 'Le banc ne marque pas. Seule l’équipe elle-même peut modifier son alignement.'}</p>
        </header>
        <p class="bench-msg" id="benchMsg" role="status"${benchMessageEnAttente ? '' : ' hidden'}>${esc(benchMessageEnAttente)}</p>
        ${prevus.length ? `<ul class="bench-pending">${prevus.map(c =>
            `<li><strong>${esc(c.entre)}</strong> remplace ${esc(c.sort)} à partir du ${esc(jour(c.date))}.</li>`).join('')}</ul>` : ''}`;
    benchMessageEnAttente = '';
    if (bancJoueurs.length) {
        const rangees = document.createElement('div');
        rangees.className = 'roster-rows';
        bancJoueurs.forEach(j => rangees.appendChild(rangeeFiche(j, 0, null).row));
        bloc.appendChild(rangees);
    } else {
        bloc.insertAdjacentHTML('beforeend', '<p class="bench-empty">Banc vide.</p>');
    }
    rosterList.appendChild(bloc);
}

/**
 * « Modifier l'alignement » (façon Edit Lineup d'ESPN) : le joueur touché et
 * ceux de la même position avec qui il peut changer de place. Un partant
 * touché : les joueurs de banc de sa position, prêts à entrer. Un joueur de
 * banc touché : les partants de sa position, prêts à sortir. Toucher une
 * cible fait le changement (/h2h/lineup/swap), qui compte dès demain.
 * Feuille du bas sur téléphone, fenêtre centrée sur grand écran (.ss-*).
 */
function ouvrirAlignement(nom) {
    const { roster, modifiable, joueurs } = alignementFiche;
    const choisi = joueurs.get(nom);
    if (!modifiable || !choisi || !roster || document.querySelector('.ss-overlay')) return;
    const retour = document.activeElement;
    const categorie = choisi.category;
    const banc = (roster.bench || []).map(b => (typeof b === 'string' ? { nom: b, categorie: null } : b));
    const partants = (roster[categorie] || []).map(n => joueurs.get(n)).filter(Boolean);
    const bancPoste = banc.filter(b => b.categorie === categorie).map(b => joueurs.get(b.nom)).filter(Boolean);
    const surBanc = !!choisi.banc;
    const esc = escapeHtmlText;
    const pts = j => (j.points == null ? '—' : j.points);

    const rangee = (j, cible) => {
        const pastille = j.banc ? 'BANC' : LIB_POSTE[categorie];
        const demain = changementDemain(j.name);
        const action = cible
            ? (surBanc ? `Faire entrer ${choisi.name} à la place de ${j.name}` : `Faire entrer ${j.name} à la place de ${choisi.name}`)
            : '';
        const contenu = `
            <span class="al-pastille${j === choisi ? ' is-choisi' : ''}${j.banc ? ' is-banc' : ''}">${pastille}</span>
            ${j.avatarHTML}
            <span class="ss-id">
                <span class="ss-name">${esc(j.name)}</span>
                <span class="ss-meta">${esc(j.meta)}${demain ? ` · <em>${demain}</em>` : ''}</span>
            </span>
            <span class="al-pts"><b>${pts(j)}</b></span>`;
        return cible
            ? `<li><button type="button" class="ss-row al-row is-cible" data-al-cible="${escapeAttr(j.name)}" aria-label="${escapeAttr(action)}">${contenu}</button></li>`
            : `<li><div class="ss-row al-row is-choisi">${contenu}</div></li>`;
    };
    const vide = texte => `<li class="al-vide">${texte}</li>`;
    const libelle = { offensive: 'attaquant', defensive: 'défenseur', goalie: 'gardien', rookie: 'recrue' }[categorie];

    const sectionPartants = surBanc
        ? (partants.length ? partants.map(j => rangee(j, true)).join('') : vide('Aucun partant à cette position.'))
        : rangee(choisi, false);
    const sectionBanc = surBanc
        ? rangee(choisi, false)
        : (bancPoste.length ? bancPoste.map(j => rangee(j, true)).join('') : vide(`Aucun ${libelle} sur le banc.`));

    const overlay = document.createElement('div');
    overlay.className = 'ss-overlay al-overlay';
    overlay.innerHTML = `
        <div class="ss-sheet al-sheet" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="alTitle" aria-describedby="alHint">
            <div class="ss-head">
                <h2 class="ss-title" id="alTitle">Modifier l’alignement</h2>
                <button type="button" class="ss-close" data-ss-close aria-label="Fermer">${RH_ICON.close}</button>
                <p class="ss-hint" id="alHint">${surBanc
                    ? `Choisissez le partant qui laisse sa place à ${esc(choisi.name)}.`
                    : `Choisissez le joueur de banc qui entre à la place de ${esc(choisi.name)}.`} Le changement compte dès demain.</p>
            </div>
            <div class="al-corps">
                <div class="al-section"><span>Partants</span><span>PPts</span></div>
                <ul class="ss-list al-list">${sectionPartants}</ul>
                <div class="al-section"><span>Banc</span><span>PPts</span></div>
                <ul class="ss-list al-list">${sectionBanc}</ul>
            </div>
            <p class="al-msg" role="status" hidden></p>
            ${choisi.playerId ? `<div class="ss-foot al-foot">
                <button type="button" class="al-fiche" data-al-fiche>Voir la fiche de ${esc(nomCourtJoueur(choisi.name))}</button>
            </div>` : ''}
        </div>`;

    const sheet = overlay.querySelector('.ss-sheet');
    const message = overlay.querySelector('.al-msg');
    let ferme = false;
    let occupe = false;

    function fermer() {
        if (ferme) return;
        ferme = true;
        document.documentElement.classList.remove('ss-lock');
        overlay.classList.add('is-leaving');
        const retirer = () => overlay.remove();
        overlay.addEventListener('animationend', e => { if (e.target === sheet) retirer(); });
        setTimeout(retirer, 260);
        if (retour && document.contains(retour) && retour.focus) retour.focus({ preventScroll: true });
    }

    overlay.addEventListener('click', async e => {
        if (e.target === overlay || e.target.closest('[data-ss-close]')) { fermer(); return; }
        if (e.target.closest('[data-al-fiche]')) {
            fermer();
            showCareerStats(choisi.playerId, choisi.name, choisi.type === 'goalie');
            return;
        }
        const cible = e.target.closest('[data-al-cible]');
        if (!cible || occupe) return;
        occupe = true;
        const autre = cible.dataset.alCible;
        const [entre, sort] = surBanc ? [choisi.name, autre] : [autre, choisi.name];
        cible.classList.add('is-busy');
        sheet.querySelectorAll('[data-al-cible]').forEach(b => { b.disabled = true; });
        message.hidden = false;
        message.classList.remove('is-error');
        message.textContent = 'Changement en cours…';
        const resultat = await faireEntrerDuBanc(entre, sort);
        if (resultat.ok) { fermer(); return; }
        occupe = false;
        cible.classList.remove('is-busy');
        sheet.querySelectorAll('[data-al-cible]').forEach(b => { b.disabled = false; });
        message.classList.add('is-error');
        message.textContent = resultat.message;
    });

    overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); fermer(); return; }
        if (e.key !== 'Tab') return;
        const liste = [...sheet.querySelectorAll('button:not(:disabled)')];
        const premier = liste[0];
        const dernier = liste[liste.length - 1];
        if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
        else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    });

    document.documentElement.classList.add('ss-lock');
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
        // Le panneau lui-même : pas d'anneau de focus sur une cible au toucher.
        sheet.focus({ preventScroll: true });
    });
}

/**
 * Fait entrer `entre` (au banc) à la place de `sort` (partant). En cas de
 * succès, la fiche se redessine avec le message du serveur.
 * Renvoie { ok, message }.
 */
async function faireEntrerDuBanc(entre, sort) {
    try {
        const reponse = await fetch(`${BASE_URL}/h2h/lineup/swap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ poolName: currentPoolName, entre, sort })
        });
        const resultat = await reponse.json().catch(() => ({}));
        if (!reponse.ok) return { ok: false, message: resultat.message || 'Changement impossible.' };
        await FZPool.refresh();
        allPoolsData = FZPool.all();
        benchMessageEnAttente = resultat.message || 'Alignement mis à jour.';
        showTeamRoster(currentPoolName, currentTeamName);
        return { ok: true };
    } catch (erreur) {
        console.error('Erreur /h2h/lineup/swap :', erreur);
        return { ok: false, message: 'Erreur de connexion au serveur.' };
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
    // « Aujourd'hui » et « Semaine » ramènent à la semaine en cours.
    h2hSemaineVue = null;
    document.getElementById('filterToday').classList.toggle('active', period === 'today');
    document.getElementById('filterWeek').classList.toggle('active', period === 'week');
    if (currentPoolName) renderH2HMatchupsForPeriod(currentPoolName);
}

/** Semaine en cours du pool, et nombre de semaines au calendrier. */
function h2hBornesSemaines(poolName) {
    const h2h = (allPoolsData[poolName] && allPoolsData[poolName].h2hData) || {};
    const enCours = Number(h2h.currentWeek) || 1;
    const total = Math.max(enCours, (h2h.matchups || []).length);
    return { enCours, total };
}

/** Flèches ‹ › du mode « Semaine » : une semaine passée, en cours ou à venir. */
function naviguerSemaineH2H(sens) {
    if (!currentPoolName) return;
    const { enCours, total } = h2hBornesSemaines(currentPoolName);
    const cible = Math.min(total, Math.max(1, (h2hSemaineVue || enCours) + sens));
    h2hPeriod = 'week';
    h2hSemaineVue = cible === enCours ? null : cible;
    document.getElementById('filterToday').classList.remove('active');
    document.getElementById('filterWeek').classList.add('active');
    renderH2HMatchupsForPeriod(currentPoolName);
}

// ==================== H2H SHARED HELPERS ====================

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

/** Les postes du face-à-face, dans l'ordre de la fiche d'équipe. */
const H2H_POSTES = Object.entries({
    offensive: ['ATT', 'att', 'Attaquants'],
    defensive: ['DÉF', 'def', 'Défenseurs'],
    goalie: ['GAR', 'gar', 'Gardiens'],
    rookie: ['REC', 'rec', 'Recrues']
}).map(([cle, [court, classe, titre]]) => ({ cle, court, classe, titre }));

/** « Nick Suzuki » → « N. Suzuki » : deux colonnes côte à côte sur un téléphone. */
function nomCourtJoueur(nom) {
    const parts = String(nom || '').trim().split(/\s+/);
    return parts.length < 2 ? (nom || '') : `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

/**
 * La photo d'un joueur, ronde, sur la couleur de son club (.fz-shot) ; ses
 * initiales dessous si elle ne charge pas. Même ordre de sources que la
 * fiche d'équipe : le relevé, la LNH par identifiant, puis la liste locale.
 */
function photoJoueurHTML(nom, playerId, teamAbbrev, classe = '') {
    let photo = null;
    try {
        const stats = getCurrentPlayerStats(nom, playerId);
        if (stats && stats.headshot && !stats.headshot.includes('/teams/')) photo = stats.headshot;
        if (!playerId && stats) playerId = stats.playerId;
    } catch (_) { /* relevé pas encore lu */ }
    if (!photo && playerId) photo = `https://assets.web.nhl.com/mugs/nhl/latest/${playerId}.png`;
    if (!photo) photo = getMatchingImage(nom);
    const initiales = escapeHtmlText(initialsFromName(nom || ''));
    const img = photo ? `<img src="${escapeAttr(photo)}" alt="" loading="lazy" data-no-lazy onerror="this.remove()">` : '';
    return `<span class="fz-photo fz-shot ${classe}" style="${clubShotStyle(teamAbbrev)}">${img}<span>${initiales}</span></span>`;
}

/**
 * Une moitié de rangée du face-à-face : photo, nom et club, et ses points
 * de la période sous le nom. Le côté droit est en miroir (photo au bord).
 */
function h2hCelluleJoueur(j, cote, gagne) {
    if (!j) return `<div class="fa-j fa-${cote} is-vide"><span class="fa-photo-vide" aria-hidden="true"></span><div class="fa-qui"><span class="fa-pts">–</span></div></div>`;
    let abrev = j.teamAbbrev || null;
    if (!abrev) { try { abrev = clubDuJoueur(j); } catch (_) { abrev = null; } }
    abrev = abrev ? String(abrev).split(',').pop().trim() : null;
    if (!/^[A-Z]{2,3}$/.test(abrev || '')) abrev = null;
    const club = abrev ? `<img class="fa-club" src="teams/${abrev}.png" alt="" onerror="this.remove()">` : '';
    const direct = Number(j.enDirect) > 0
        ? `<small class="fa-direct">+${fmtH2HPts(j.enDirect).replace('.', ',')} en direct</small>` : '';
    return `
        <div class="fa-j fa-${cote}">
            ${photoJoueurHTML(j.name, j.playerId, abrev, 'fa-photo')}
            <div class="fa-qui">
                <span class="fa-nomj">${cote === 'd' ? club : ''}<b title="${escapeAttr(j.name)}">${escapeHtmlText(nomCourtJoueur(j.name))}</b>${cote === 'g' ? club : ''}</span>
                <span class="fa-pts${gagne ? ' is-devant' : ''}">${fmtH2HPts(j.fantasyPoints).replace('.', ',')}<small> FPts</small></span>${direct}
            </div>
        </div>`;
}

/**
 * Les rangées du face-à-face, poste par poste comme le « Matchup » d'ESPN :
 * mes attaquants contre ses attaquants, du meilleur pointeur au moins bon,
 * le poste au centre. Une semaine figée n'a gardé que les trois meilleurs
 * pointeurs, sans leur poste : ils s'apparient par rang.
 */
function h2hRangeesFaceAFace(gauche, droite, fige) {
    const parPoints = liste => [...(liste || [])].sort((a, b) => (b.fantasyPoints || 0) - (a.fantasyPoints || 0));
    const groupes = fige
        ? [{ court: 'TOP', classe: 'eq', titre: 'Meilleurs pointeurs', g: parPoints(gauche), d: parPoints(droite) }]
        : H2H_POSTES.map(p => ({ ...p,
            g: parPoints((gauche || []).filter(j => j.categorie === p.cle)),
            d: parPoints((droite || []).filter(j => j.categorie === p.cle)) }))
            .concat([{ court: '—', classe: 'eq', titre: 'Autres',
                g: parPoints((gauche || []).filter(j => !H2H_POSTES.some(p => p.cle === j.categorie))),
                d: parPoints((droite || []).filter(j => !H2H_POSTES.some(p => p.cle === j.categorie))) }]);
    let html = '';
    groupes.forEach(gr => {
        const n = Math.max(gr.g.length, gr.d.length);
        for (let i = 0; i < n; i++) {
            const l = gr.g[i], r = gr.d[i];
            const pl = l ? l.fantasyPoints || 0 : -1, pr = r ? r.fantasyPoints || 0 : -1;
            html += `
            <div class="fa-rangee">
                ${h2hCelluleJoueur(l, 'g', pl > pr)}
                <span class="fa-poste is-${gr.classe}" title="${gr.titre}">${gr.court}</span>
                ${h2hCelluleJoueur(r, 'd', pr > pl)}
            </div>`;
        }
    });
    return html;
}

/**
 * Un duel, face à face (maquette « Duels », style Matchup d'ESPN) : les deux
 * équipes et leur pointage en haut, une barre de l'avance, puis les joueurs
 * des deux équipes côte à côte, poste par poste. Mon équipe est toujours à
 * gauche.
 */
function buildMatchupCardHTML(m, poolName, showRecord) {
    const moi = localStorage.getItem('username');
    const equipes = (allPoolsData[poolName] && allPoolsData[poolName].teams) || {};
    const estMienne = cle => ((equipes[cle] && equipes[cle].members) || []).includes(moi);
    const inverse = estMienne(m.team2) && !estMienne(m.team1);
    const fige = !m.team1Players && !m.team2Players && !!(m.team1Top || m.team2Top);
    const cote = n => ({
        cle: m[`team${n}`],
        points: Number(m[`team${n}Points`]) || 0,
        joueurs: fige ? m[`team${n}Top`] : m[`team${n}Players`]
    });
    const [g, d] = inverse ? [cote(2), cote(1)] : [cote(1), cote(2)];
    const standings = (allPoolsData[poolName] && allPoolsData[poolName].h2hData && allPoolsData[poolName].h2hData.standings) || {};

    const entete = (e, sens) => {
        const membres = (equipes[e.cle] && equipes[e.cle].members) || [];
        const nom = getDisplayName(e.cle, membres);
        const logo = getTeamLogoHTML((equipes[e.cle] || {}).teams, 44) || `<span class="st-avatar-fallback">${initialsFromName(nom)}</span>`;
        const b = standings[e.cle];
        const bilan = showRecord && b ? `<span class="fa-bilan">${b.wins || 0}-${b.losses || 0}-${b.ties || 0}</span>` : '';
        const devant = e.points > (e === g ? d.points : g.points);
        return `
            <div class="fa-equipe fa-${sens}">
                <span class="fa-logo">${logo}</span>
                <span class="fa-txt">
                    <span class="fa-score${devant ? ' is-devant' : ''}">${fmtH2HPts(e.points).replace('.', ',')}</span>
                    <span class="fa-nom" title="${escapeAttr(nom)}">${escapeHtmlText(nom)}${estMienne(e.cle) ? '<span class="hf-toi">Toi</span>' : ''}</span>
                    ${bilan}
                </span>
            </div>`;
    };

    const total = g.points + d.points;
    const part = total > 0 ? Math.round(g.points / total * 100) : 50;
    const ecart = Math.round(Math.abs(g.points - d.points) * 10) / 10;
    const meneur = g.points === d.points ? null : (g.points > d.points ? g : d);
    const nomDe = e => getDisplayName(e.cle, (equipes[e.cle] && equipes[e.cle].members) || []);
    const phrase = !meneur ? 'Égalité'
        : `${escapeHtmlText(meneur === g && estMienne(g.cle) ? 'Tu mènes' : nomDe(meneur) + ' mène')} par ${fmtH2HPts(ecart).replace('.', ',')}`;

    // Les chances de gagner (remplirChancesDuels) se posent sous la barre une
    // fois l'horaire de la semaine lu ; d'ici là, la phrase de l'avance.
    const cotes = !fige && h2hCotesSemaine
        ? { g: g.cle, d: d.cle, gp: g.points, dp: d.points, mien: estMienne(g.cle) } : null;
    const rangees = h2hRangeesFaceAFace(g.joueurs, d.joueurs, fige);
    return `
        <section class="fa-duel${estMienne(g.cle) ? ' is-mien' : ''}">
            <div class="fa-tete">
                ${entete(g, 'g')}
                <span class="fa-vs">VS</span>
                ${entete(d, 'd')}
            </div>
            <div class="fa-barre" role="img" aria-label="${escapeAttr(phrase.replace(/<[^>]+>/g, ''))}">
                <span class="fa-barre-g" style="width:${part}%"></span>
            </div>
            <p class="fa-phrase"${cotes ? ` data-cotes="${escapeAttr(JSON.stringify(cotes))}"` : ''}>${phrase}</p>
            <div class="fa-liste">
                ${rangees || '<div class="h2h-no-players">Aucun joueur à afficher</div>'}
            </div>
            ${fige && rangees ? '<div class="h2h-no-players">Résultat final : les 3 meilleurs pointeurs de chaque équipe.</div>' : ''}
        </section>`;
}

// ==================== CHANCES DE GAGNER (DUELS) ====================
// Le même calcul que la carte Versus de l'accueil (lib/duelAccueil.js) :
// points actuels + rythme de chaque partant × ses matchs restants d'ici la
// fin de la semaine (horaire LNH), un blessé absent ne jouant plus. Refait à
// chaque rendu des duels ; l'horaire est gardé cinq minutes.

/** Bornes de la semaine affichée, quand ses chances ont un sens ; null sinon. */
let h2hCotesSemaine = null;
let h2hHoraireCotes = { jour: null, at: 0, jours: null, promesse: null };
const H2H_HORAIRE_MS = 5 * 60 * 1000;

function jourEstISO() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function chargerHoraireCotes() {
    const jour = jourEstISO();
    const h = h2hHoraireCotes;
    if (h.jour === jour && h.jours && Date.now() - h.at < H2H_HORAIRE_MS) return Promise.resolve(h.jours);
    if (h.promesse) return h.promesse;
    h.promesse = fetch(`${BASE_URL}/schedule/${jour}`)
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
        .then(data => {
            const jours = ((data && data.days) || []).map(d => ({ date: d.date, games: (d.games || []).map(g => ({
                id: g.id, state: g.gameState || g.state, period: g.period, clock: g.clock,
                away: g.awayTeam ? g.awayTeam.abbrev : g.away && g.away.abbrev,
                home: g.homeTeam ? g.homeTeam.abbrev : g.home && g.home.abbrev })) }));
            h2hHoraireCotes = { jour, at: Date.now(), jours: jours.length ? jours : null, promesse: null };
            return h2hHoraireCotes.jours;
        });
    return h.promesse;
}

/** Les chances de chaque côté d'un duel, ou null s'il manque de quoi les calculer. */
function chancesDuel(poolName, cotes) {
    const D = window.FZDuelAccueil;
    const jours = h2hHoraireCotes.jours;
    if (!D || !jours || !h2hCotesSemaine) return null;
    const auj = jourEstISO();
    const { debut, fin } = h2hCotesSemaine;
    // Matchs restants par club, d'aujourd'hui jusqu'au dimanche (fin exclue).
    const restants = {};
    jours.forEach(jour => {
        if (jour.date < auj || jour.date >= fin || (debut && jour.date < debut)) return;
        jour.games.forEach(g => {
            const part = jour.date === auj ? D.partRestante(g) : 1;
            [g.away, g.home].forEach(c => { if (c) restants[c] = (restants[c] || 0) + part; });
        });
    });
    const clubs = new Map(((currentTeams && currentTeams.teams) || []).filter(t => t.teamAbbrev).map(t => [t.teamAbbrev, t]));
    const equipes = (allPoolsData[poolName] && allPoolsData[poolName].teams) || {};
    const partants = cle => {
        const td = equipes[cle] || {};
        return ['offensive', 'defensive', 'goalie', 'rookie'].flatMap(cat => (td[cat] || []).map(nom => {
            const st = getCurrentPlayerStats(nom, ficheJoueur(nom, cat).playerId);
            if (!st || !st.teamAbbrev) return { moyenne: 0, variance: 0, matchs: 0 };
            const club = String(st.teamAbbrev).split(',').pop().trim();
            const rythme = D.rythmeJoueur(st, (clubs.get(club) || {}).gamesPlayed);
            const blessure = typeof getPlayerInjury === 'function' ? getPlayerInjury(nom, club) : null;
            return { ...rythme, matchs: (restants[club] || 0) * D.disponibilite(blessure) };
        }));
    };
    // Vue « Aujourd'hui » : la carte montre les points du jour, mais les
    // chances se jouent sur le total de la semaine.
    let gp = cotes.gp, dp = cotes.dp;
    if (h2hPeriod === 'today') {
        const semaine = h2hWeekCache && h2hWeekCache.poolName === poolName ? h2hWeekCache.data : null;
        const duel = semaine && (semaine.matchups || []).find(m => [m.team1, m.team2].includes(cotes.g) && [m.team1, m.team2].includes(cotes.d));
        if (!duel) return null;
        const pts = cle => Number(duel.team1 === cle ? duel.team1Points : duel.team2Points) || 0;
        gp = pts(cotes.g); dp = pts(cotes.d);
    }
    return D.chancesVersus({ points: gp, joueurs: partants(cotes.g) }, { points: dp, joueurs: partants(cotes.d) });
}

/** La ligne sous la barre : « 62 % · Chances de gagner · 38 % ». */
function ligneChancesHTML(chances, mien) {
    const g = chances.moi, d = chances.lui;
    return `<span class="fa-cote${g >= d ? ' is-fav' : ''}">${g}&nbsp;%</span>`
        + `<span class="fa-cote-lib">${mien ? 'Tes chances de gagner' : 'Chances de gagner'}</span>`
        + `<span class="fa-cote${d >= g ? ' is-fav' : ''}">${d}&nbsp;%</span>`;
}

/** Pose les chances sous chaque barre de duel affichée ; relancé quand l'horaire ou les blessés arrivent. */
function remplirChancesDuels(poolName) {
    const poser = () => {
        if (currentPoolName !== poolName) return;
        document.querySelectorAll('#h2hMatchupsList .fa-phrase[data-cotes]').forEach(el => {
            let cotes;
            try { cotes = JSON.parse(el.dataset.cotes); } catch (_) { return; }
            const chances = chancesDuel(poolName, cotes);
            if (!chances) return;
            el.classList.add('fa-cotes');
            el.innerHTML = ligneChancesHTML(chances, cotes.mien);
            el.setAttribute('aria-label', `Chances de gagner : ${chances.moi} % contre ${chances.lui} %`);
        });
    };
    poser();
    chargerHoraireCotes().then(poser);
    if (h2hPeriod === 'today' && !(h2hWeekCache && h2hWeekCache.poolName === poolName)) {
        fetch(`${BASE_URL}/h2h/current-week-scores?poolName=${encodeURIComponent(poolName)}`, { cache: 'no-store' })
            .then(r => (r.ok ? r.json() : null))
            .then(data => { if (data) { h2hWeekCache = { poolName, data }; poser(); } })
            .catch(() => {});
    }
    if (typeof loadInjuries === 'function') Promise.resolve(loadInjuries()).then(poser, () => {});
}

/** Un autre duel de la semaine : une ligne de pointage qui s'ouvre sur le face-à-face. */
function h2hDuelRepliHTML(m, poolName) {
    const equipes = (allPoolsData[poolName] && allPoolsData[poolName].teams) || {};
    const ligne = n => {
        const cle = m[`team${n}`];
        const nom = getDisplayName(cle, (equipes[cle] && equipes[cle].members) || []);
        const logo = getTeamLogoHTML((equipes[cle] || {}).teams, 24) || '';
        return { nom, logo, pts: Number(m[`team${n}Points`]) || 0 };
    };
    const a = ligne(1), b = ligne(2);
    return `
        <details class="fa-autre">
            <summary>
                <span class="fa-autre-eq">${a.logo}<span>${escapeHtmlText(a.nom)}</span></span>
                <span class="fa-autre-sc"><b class="${a.pts > b.pts ? 'is-devant' : ''}">${fmtH2HPts(a.pts).replace('.', ',')}</b><em>–</em><b class="${b.pts > a.pts ? 'is-devant' : ''}">${fmtH2HPts(b.pts).replace('.', ',')}</b></span>
                <span class="fa-autre-eq fa-d"><span>${escapeHtmlText(b.nom)}</span>${b.logo}</span>
            </summary>
            ${buildMatchupCardHTML(m, poolName, true)}
        </details>`;
}


// ==================== H2H TAB SWITCHING & RENDERING ====================
/** Les vues reliées par les raccourcis ronds, toutes sous l'onglet Classement. */
const H2H_VUES_CLASSEMENT = ['standings', 'calendrier', 'history', 'records'];

/** Allume l'onglet du haut et le raccourci rond de la vue affichée. */
function allumerOngletH2H(tab) {
    const allume = H2H_VUES_CLASSEMENT.includes(tab) ? 'standings' : tab;
    document.querySelectorAll('#h2hRaccourcis .h2h-hub-btn[data-vue]').forEach(b => {
        const actif = b.dataset.vue === tab;
        b.classList.toggle('is-on', actif);
        if (actif) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('#h2hTabs .h2h-seg-btn').forEach(t => {
        const actif = t.dataset.tab === allume;
        t.classList.toggle('active', actif);
        t.setAttribute('aria-selected', actif ? 'true' : 'false');
    });
}

/**
 * Les onglets d'un pool H2H : « Mon équipe » (la fiche de mon équipe),
 * « Classement » (avec ses raccourcis Classement, Historique et Records) et
 * « Duels ».
 * Tout se change sur place : la fiche et le classement sont deux vues de la
 * même page.
 */
function switchH2HTab(tab) {
    const poolName = currentPoolName;
    if (!poolName) return;

    if (tab === 'equipe') {
        const equipes = (allPoolsData[poolName] || {}).teams || {};
        const mienne = Object.keys(equipes).find(nom => estMonEquipe(poolName, nom));
        if (mienne) { showTeamRoster(poolName, mienne); window.scrollTo(0, 0); }
        return;
    }
    // Depuis une fiche : on revient au classement, ouvert sur l'onglet voulu.
    if (currentView !== VIEW_STATES.POOL_STANDINGS) {
        h2hDemandeUrl = { onglet: tab, semaine: null };
        showPoolStandings(poolName);
        window.scrollTo(0, 0);
        return;
    }

    currentH2HTab = tab;
    allumerOngletH2H(tab);

    // Show/hide sections
    document.getElementById('h2hMatchupsView').style.display = (tab === 'matchups') ? 'block' : 'none';
    document.getElementById('standingsSkeleton').style.display = 'none';
    document.getElementById('standingsList').style.display = (tab === 'standings') ? 'block' : 'none';
    document.getElementById('h2hScheduleView').style.display = (tab === 'calendrier') ? 'block' : 'none';
    document.getElementById('h2hHistoryView').style.display = (tab === 'history') ? 'block' : 'none';

    // Les raccourcis suivent toutes les vues de l'onglet Classement ; le
    // temple de la renommée ne s'affiche que seul, sous « Records ».
    document.getElementById('h2hRaccourcis').style.display = H2H_VUES_CLASSEMENT.includes(tab) ? '' : 'none';
    const insights = document.getElementById('standingsInsights');
    if (insights) {
        insights.style.display = (tab === 'records') ? '' : 'none';
        insights.classList.add('is-h2h');
    }

    if (tab === 'standings') {
        const poolData = allPoolsData[poolName];
        if (poolData) renderPoolStandings(poolData, poolName);
    }
    if (tab === 'matchups' && h2hDuelsCharges !== poolName) {
        h2hDuelsCharges = poolName;
        loadH2HCurrentWeek(poolName);
    }
    if (tab === 'calendrier') renderH2HSchedule(poolName);
    if (tab === 'history') renderH2HHistory(poolName);
    if (tab === 'records') renderHallOfFame(poolName);
}

async function loadH2HCurrentWeek(poolName, semaine = null) {
    // Arrivée sur l'onglet : « Aujourd'hui », sauf si un lien vise une
    // semaine précise (notification « nouvelle semaine », accueil).
    const { enCours } = h2hBornesSemaines(poolName);
    h2hPeriod = semaine ? 'week' : 'today';
    h2hSemaineVue = semaine && semaine !== enCours ? semaine : null;
    document.getElementById('filterToday').classList.toggle('active', h2hPeriod === 'today');
    document.getElementById('filterWeek').classList.toggle('active', h2hPeriod === 'week');

    const weekHeader = document.getElementById('h2hWeekHeader');
    weekHeader.innerHTML = '';

    await renderH2HMatchupsForPeriod(poolName);
}

async function renderH2HMatchupsForPeriod(poolName) {
    const matchupsList = document.getElementById('h2hMatchupsList');
    const weekHeader = document.getElementById('h2hWeekHeader');
    const jeton = ++h2hRenduDuels;
    const perime = () => jeton !== h2hRenduDuels || currentPoolName !== poolName;
    matchupsList.innerHTML = '<div class="h2h-loading">Chargement...</div>';

    try {
        let data;
        let recap = null;
        if (h2hPeriod === 'today') {
            const res = await fetch(`${BASE_URL}/h2h/today-scores?poolName=${encodeURIComponent(poolName)}`, { cache: 'no-store' });
            if (!res.ok) throw new Error('Failed');
            data = await res.json();
            if (perime()) return;

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
        } else if (h2hSemaineVue) {
            // Une autre semaine que la courante : /h2h/matchup la sert figée
            // si elle est close (un échange de mardi ne la réécrit pas),
            // provisoire sinon. Le récap n'existe que pour une semaine close.
            const semaine = h2hSemaineVue;
            const q = `poolName=${encodeURIComponent(poolName)}&week=${semaine}`;
            const res = await fetch(`${BASE_URL}/h2h/matchup?${q}`, { cache: 'no-store' });
            if (!res.ok) throw new Error('Failed');
            data = await res.json();
            if (data.fige) recap = await lireRecapH2H(poolName, semaine);
            if (perime()) return;
            weekHeader.innerHTML = h2hEnteteSemaineHTML(poolName, data.weekNumber, data);
        } else {
            // Use cache if available
            if (!h2hWeekCache || h2hWeekCache.poolName !== poolName) {
                const res = await fetch(`${BASE_URL}/h2h/current-week-scores?poolName=${encodeURIComponent(poolName)}`, { cache: 'no-store' });
                if (!res.ok) throw new Error('Failed');
                data = await res.json();
                if (perime()) return;
                h2hWeekCache = { poolName, data };
            } else {
                data = h2hWeekCache.data;
            }
            weekHeader.innerHTML = h2hEnteteSemaineHTML(poolName, data.currentWeek, data);
        }

        if (!data.matchups || data.matchups.length === 0) {
            matchupsList.innerHTML = '<div class="h2h-empty">Aucun duel cette semaine</div>';
            return;
        }

        // Mon duel d'abord, ouvert ; les autres en lignes de pointage qui
        // s'ouvrent sur leur face-à-face.
        const moi = localStorage.getItem('username');
        const equipes = (allPoolsData[poolName] && allPoolsData[poolName].teams) || {};
        const mien = m => [m.team1, m.team2].some(c => ((equipes[c] && equipes[c].members) || []).includes(moi));
        const premier = data.matchups.find(mien) || data.matchups[0];
        const autres = data.matchups.filter(m => m !== premier);
        // Les chances de gagner : seulement pour la semaine en cours (ou
        // celle qui s'ouvre), jamais pour un résultat figé.
        const ws = data.weekStatus || 'ongoing';
        h2hCotesSemaine = !h2hSemaineVue && ['ongoing', 'upcoming'].includes(ws) && data.weekEnd
            ? { debut: String(data.weekStart || '').slice(0, 10), fin: String(data.weekEnd).slice(0, 10) } : null;
        matchupsList.innerHTML = (recap ? h2hFaitsSaillantsHTML(recap, poolName) : '')
            + buildMatchupCardHTML(premier, poolName, true)
            + (autres.length ? `<h3 class="fa-autres-titre">Autres duels</h3>${autres.map(m => h2hDuelRepliHTML(m, poolName)).join('')}` : '');
        if (h2hCotesSemaine) remplirChancesDuels(poolName);

    } catch (err) {
        if (perime()) return;
        console.error('Error loading H2H matchups:', err);
        matchupsList.innerHTML = '<div class="h2h-empty">Erreur lors du chargement</div>';
    }
}

/**
 * En-tête du mode « Semaine » : ‹ Semaine N [état] › et ses dates.
 * `weekEnd` est le lundi SUIVANT : la plage recule d'un jour pour se lire
 * « lundi au dimanche », comme partout ailleurs.
 */
function h2hEnteteSemaineHTML(poolName, numero, data) {
    const { total } = h2hBornesSemaines(poolName);
    const ws = data.weekStatus || 'ongoing';
    const plage = h2hSchedDateRange(data.weekStart, data.weekEnd) || 'Semaine en cours';
    const corrige = data.fige && Number(data.revision) > 1 ? ' · résultat corrigé' : '';
    const fleche = (sens, etiquette, inactif) => `<button type="button" class="h2h-week-nav"
        onclick="naviguerSemaineH2H(${sens})" aria-label="${etiquette}"${inactif ? ' disabled' : ''}>${sens < 0 ? '‹' : '›'}</button>`;
    return `
        <div class="h2h-week-nav-row">
            ${fleche(-1, 'Semaine précédente', numero <= 1)}
            <div>
                <div class="h2h-week-label">Semaine ${numero} <span class="h2h-week-status ${H2H_WEEK_STATUS_CLASS[ws] || ''}">${H2H_WEEK_STATUS_LABEL[ws] || ''}</span></div>
                <div class="h2h-week-dates">${escapeHtmlText(plage + corrige)}</div>
            </div>
            ${fleche(1, 'Semaine suivante', numero >= total)}
        </div>`;
}

/** Le récap figé d'une semaine close (routes/records.js), ou null. */
async function lireRecapH2H(poolName, semaine) {
    try {
        const res = await fetch(`${BASE_URL}/api/pools/${encodeURIComponent(poolName)}/recap?week=${semaine}`, { cache: 'no-store' });
        if (!res.ok) return null;
        const corps = await res.json();
        return corps && corps.recap && Number(corps.weekNumber) === Number(semaine) ? corps.recap : null;
    } catch (_) {
        return null;
    }
}

/**
 * Faits saillants d'une semaine close, tirés du récap (lib/recap.js). Chaque
 * catégorie absente du récap est simplement absente ici : le serveur l'a
 * retirée faute de donnée fiable, et rien ne la remplace.
 */
function h2hFaitsSaillantsHTML(recap, poolName) {
    const equipes = (allPoolsData[poolName] && allPoolsData[poolName].teams) || {};
    const nom = cle => escapeHtmlText(getDisplayName(cle, (equipes[cle] && equipes[cle].members) || []));
    const pts = v => fmtH2HPts(v);
    const duel = d => `${nom(d.team1)} ${pts(d.team1Points)} – ${pts(d.team2Points)} ${nom(d.team2)}`;
    const lignes = [];

    for (const section of recap.sections || []) {
        switch (section.categorie) {
            case 'meilleur_score':
                lignes.push(['Meilleur score', `${section.equipes.map(nom).join(', ')} · ${pts(section.points)}`]);
                break;
            case 'duel_serre':
                lignes.push([section.egalite ? 'Égalité parfaite' : 'Duel le plus serré', section.duels.map(duel).join('<br>')]);
                break;
            case 'plus_gros_ecart':
                lignes.push(['Plus gros écart', `${section.duels.map(duel).join('<br>')} (${pts(section.ecart)})`]);
                break;
            case 'joueur_semaine':
                lignes.push(['Joueur de la semaine', section.joueurs
                    .map(j => `${escapeHtmlText(j.name)}${j.equipe ? ` (${nom(j.equipe)})` : ''}`)
                    .join(', ') + ` · ${pts(section.points)}`]);
                break;
            case 'serie':
                lignes.push(['Séries en cours', section.series.slice(0, 3)
                    .map(x => `${nom(x.equipe)} : ${x.longueur} ${x.issue === 'victoire' ? 'victoires' : 'défaites'}`)
                    .join('<br>')]);
                break;
        }
    }
    if (lignes.length === 0) return '';

    return `
        <section class="h2h-recap" aria-label="Faits saillants de la semaine">
            <h3 class="h2h-recap-title">Faits saillants</h3>
            <dl class="h2h-recap-list">
                ${lignes.map(([cle, valeur]) => `<div class="h2h-recap-row"><dt>${cle}</dt><dd>${valeur}</dd></div>`).join('')}
            </dl>
        </section>`;
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
    document.body.classList.remove('fz-vue-equipe-attente');
    document.getElementById('breadcrumb').style.display = 'none';
    document.getElementById('pageTitle').textContent = 'Classement';
    majFraicheur('');
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
