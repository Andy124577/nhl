/* ============================================================ */
/* ACCUEIL DASHBOARD — "Éditorial calme" (2A bureau / 1A téléphone) */
/* Replaces the old .dash-header / home-tabs / my-rankings /       */
/* activity sections. Loaded after activePool.js and accueil.js:   */
/* classic scripts share one global scope, so userData, FZPool,    */
/* getPlayerStats, buildTeamScores, escapeHTML, BASE_URL,          */
/* loadCurrentStats, loadPendingTrades and draftActionFor below    */
/* are all already defined by the time this file runs.             */
/* ============================================================ */

const FR_DOW = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const FR_DOW_LONG = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const FR_MONTH = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const FR_MONTH_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juill.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/* Nom court d'équipe, en français là où l'usage l'est (Sénateurs, Canadiens).
   /current-teams ne renvoie que le nom complet anglais : cette table est la
   seule source des libellés que la maquette Canvas-12 met sur les cartes de
   match. Le repli shortTeamName() couvre une équipe ajoutée à la ligue avant
   qu'on pense à l'inscrire ici. */
const NHL_TEAM_SHORT = {
    ANA: 'Ducks', ARI: 'Coyotes', BOS: 'Bruins', BUF: 'Sabres', CAR: 'Hurricanes',
    CBJ: 'Blue Jackets', CGY: 'Flames', CHI: 'Blackhawks', COL: 'Avalanche',
    DAL: 'Stars', DET: 'Red Wings', EDM: 'Oilers', FLA: 'Panthers', LAK: 'Kings',
    MIN: 'Wild', MTL: 'Canadiens', NJD: 'Devils', NSH: 'Predators', NYI: 'Islanders',
    NYR: 'Rangers', OTT: 'Sénateurs', PHI: 'Flyers', PIT: 'Penguins', SEA: 'Kraken',
    SJS: 'Sharks', STL: 'Blues', TBL: 'Lightning', TOR: 'Maple Leafs', UTA: 'Mammoth',
    VAN: 'Canucks', VGK: 'Golden Knights', WPG: 'Jets', WSH: 'Capitals'
};

/**
 * La journée du pool, découpée sur l'Est — jamais sur UTC.
 *
 * `toISOString()` rend la journée UTC. À 20 h à Montréal, UTC est déjà au
 * lendemain : le calendrier marquait « Auj » sur le 20 pendant que les matchs
 * du 19 jouaient encore, et la bande des jours sautait une case chaque soir.
 *
 * Les journées de /schedule sont celles que la LNH attribue à ses matchs, et
 * le serveur découpe les siennes sur « America/Toronto » (lib/dates.js). On
 * lit l'heure dans ce fuseau-là pour que « aujourd'hui » désigne la même
 * journée des deux côtés du réseau, quel que soit le fuseau du visiteur.
 */
const FZD_JOUR_POOL = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit'
});

/** La journée du pool d'un instant, en « AAAA-MM-JJ ». */
function poolDayISO(instant) {
    const d = instant instanceof Date ? instant : new Date(instant);
    return isNaN(d) ? null : FZD_JOUR_POOL.format(d);
}

function todayISO() {
    return FZD_JOUR_POOL.format(new Date());
}

/**
 * Ajoute des jours de CALENDRIER à une journée « AAAA-MM-JJ ».
 *
 * L'arithmétique se fait en UTC sur une date sans heure : la veille reste la
 * veille même quand la nuit a duré 23 ou 25 heures.
 */
function shiftISO(iso, days) {
    const d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d)) return null;
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function dowLabel(dateISO) {
    return FR_DOW[new Date(dateISO + 'T00:00:00Z').getUTCDay()];
}

function dayNum(dateISO) {
    return Number(dateISO.slice(8, 10));
}

function gameTimeLabel(iso) {
    return new Date(iso).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function periodLabel(period, periodType) {
    if (periodType === 'SO') return 'TB';
    if (periodType === 'OT') return 'Prol';
    if (period === 1) return '1<sup>re</sup>';
    return `${period}<sup>e</sup>`;
}

function ordinalHTML(n) {
    return n === 1 ? '1<sup>re</sup>' : `${n}<sup>e</sup>`;
}

function relativeTimeFr(dateStr) {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return 'À l’instant';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} h`;
    return `${Math.floor(h / 24)} j`;
}

/**
 * Journée d'un mouvement ou d'un retour de blessure.
 *
 * Tout se compare en journées « AAAA-MM-JJ », jamais en objets Date : une
 * telle chaîne se parse en UTC, et à Montréal minuit UTC tombe la veille à
 * 20 h — le 25 août s'affichait donc « 24 août ». L'ordre lexicographique
 * de ces chaînes est l'ordre chronologique : ni fuseau ni arrondi ne peuvent
 * s'y glisser.
 *
 * « Aujourd'hui » et « Hier » se lisent sur la journée du pool, la même que
 * le calendrier : sinon un visiteur de Vancouver et un de Montréal dataient
 * le même mouvement de deux jours différents.
 *
 * Un horodatage complet (ESPN, avec heure et fuseau) désigne un instant : on
 * le ramène à la journée du pool où il tombe.
 */
function dayLabelFr(iso) {
    if (!iso) return '';
    const jour = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : poolDayISO(iso);
    if (!jour) return '';

    const today = todayISO();
    if (jour === today) return 'Aujourd’hui';
    if (jour === shiftISO(today, -1)) return 'Hier';

    return `${dayNum(jour)} ${FR_MONTH_SHORT[Number(jour.slice(5, 7)) - 1]}`;
}

function countdownLabel(startISO) {
    const diffMs = new Date(startISO) - new Date();
    if (diffMs <= 0) return '0 h 00';
    const totalMin = Math.floor(diffMs / 60000);
    return `${Math.floor(totalMin / 60)} h ${String(totalMin % 60).padStart(2, '0')}`;
}

function teamLogoImg(abbrev) {
    return `<img class="fzd-team-logo" src="teams/${abbrev}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
}

/** All player names on the active pool's roster, flattened. */
function activeRosterNames() {
    const team = FZPool.team();
    if (!team) return [];
    const td = team.data || {};
    return [...(td.offensive || []), ...(td.defensive || []), ...(td.goalie || []), ...(td.rookie || [])];
}

/** Roster names grouped by their current NHL team abbrev, for calendar game-card counts. */
function rosterTeamCounts() {
    const counts = {};
    activeRosterNames().forEach(name => {
        const abbr = getPlayerStats(name)?.teamAbbrev;
        if (abbr) counts[abbr] = (counts[abbr] || 0) + 1;
    });
    return counts;
}

function rosterCountForGame(counts, game) {
    return (counts[game.away.abbrev] || 0) + (counts[game.home.abbrev] || 0);
}

// ============================================================
// CALENDAR — full-season, backed by GET /schedule/:date (paged via
// nextStartDate/previousStartDate) rather than one hardcoded week.
// ============================================================
let calData = null;
let calSelectedDate = null;
let calMonthOpen = false;
let calMonthCursor = null;
// Feuilles de match du soir (GET /tonight-boxscores), posées par renderDash :
// les cartes joueur du calendrier montrent la ligne EN DIRECT quand elle
// existe, et retombent sur les totaux de la saison sinon.
let calTonight = { players: [], games: [] };
// Buts de la journée AFFICHÉE (GET /day-goals/:date), indexés par identifiant
// de match. Chargés à part du calendrier : une semaine de feuilles de
// pointage ne sert à rien quand une seule journée est à l'écran.
//
// `live` vient de la même requête : état, période, horloge et pointage de
// chaque match commencé. L'horaire n'a pas d'horloge du tout (voir
// /day-goals côté serveur) et il ne se recharge pas de la session ; c'est
// donc lui qui fait battre les cartes tant qu'un match joue.
let calGoals = { date: null, games: {}, live: {}, at: 0 };
let calGoalsEnCours = null;
const CAL_GOALS_FRAIS_MS = 30 * 1000;
// abbrev → { name, record }, construit une fois depuis /current-teams.
let nhlTeamIndex = null;

const calIsPhone = () => window.matchMedia('(max-width: 768px)').matches;

async function loadNhlTeams() {
    if (nhlTeamIndex) return;
    nhlTeamIndex = {};
    try {
        const res = await fetch(`${BASE_URL}/current-teams`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        (data.teams || []).forEach(t => {
            if (!t.teamAbbrev) return;
            nhlTeamIndex[t.teamAbbrev] = {
                name: NHL_TEAM_SHORT[t.teamAbbrev] || shortTeamName(t.teamFullName),
                record: `${t.wins || 0}-${t.losses || 0}-${t.otLosses || 0}`
            };
        });
    } catch (err) {
        console.warn('Could not load team standings:', err);
    }
}

function shortTeamName(full) {
    const parts = String(full || '').trim().split(/\s+/);
    if (parts.length <= 1) return parts[0] || '';
    return parts.length > 2 ? parts.slice(-2).join(' ') : parts[parts.length - 1];
}

function teamName(abbrev) {
    return (nhlTeamIndex && nhlTeamIndex[abbrev]?.name) || NHL_TEAM_SHORT[abbrev] || abbrev;
}

function teamRecord(abbrev) {
    return (nhlTeamIndex && nhlTeamIndex[abbrev]?.record) || '';
}

async function fetchSchedule(date) {
    try {
        const res = await fetch(`${BASE_URL}/schedule/${date}`, { cache: 'no-store' });
        if (!res.ok) return { days: [], nextStartDate: null, previousStartDate: null };
        return await res.json();
    } catch (err) {
        console.warn('Could not load schedule:', err);
        return { days: [], nextStartDate: null, previousStartDate: null };
    }
}

/**
 * Les buts de la journée affichée, chargés en arrière-plan.
 *
 * `renderDayGames()` est synchrone et redessine à chaque rafraîchissement du
 * tableau de bord : l'attendre sur le réseau ferait clignoter les cartes.
 * On dessine donc avec ce qu'on a, et le retour de la requête redessine.
 *
 * Trois gardes empêchent la boucle — renderDayGames rappelle cette fonction :
 * la journée déjà en main ne se recharge pas, une requête en vol n'est pas
 * doublée, et une journée dont aucun match n'a commencé n'a rien à demander.
 * Deux cas rouvrent la porte, et pas plus d'une fois par demi-minute : un
 * match EN COURS, dont la feuille grandit encore, et un match commencé dont
 * la marque n'est pas 0-0 alors qu'on n'a aucun de ses buts — la LNH n'avait
 * rien publié la dernière fois, ce n'est pas une réponse à garder.
 */
function chargerButsDuJour(date, games) {
    const commences = games.some(g => ['LIVE', 'CRIT', 'FINAL', 'OFF'].includes(g.state));
    if (!commences) {
        if (calGoals.date !== date) calGoals = { date, games: {}, at: Date.now() };
        return;
    }

    const enDirect = games.some(g => g.state === 'LIVE' || g.state === 'CRIT');
    // Un match commencé, marqué, dont on n'a pas un seul buteur en main : la
    // LNH n'a pas encore publié sa feuille. Sans ce troisième cas, la première
    // réponse vide de la journée valait pour toute la session — aucun match en
    // direct pour rouvrir la porte, et la carte gardait son pointage sans
    // jamais retrouver ses buteurs. Un vrai 0-0 ne compte pas : il n'a rien à
    // attendre.
    const manquant = calGoals.date === date && games.some(g =>
        ['LIVE', 'CRIT', 'FINAL', 'OFF'].includes(g.state)
        && ((g.away?.score ?? 0) + (g.home?.score ?? 0)) > 0
        && !((calGoals.games && calGoals.games[g.id]) || []).length);

    const aJour = calGoals.date === date
        && (!(enDirect || manquant) || Date.now() - calGoals.at < CAL_GOALS_FRAIS_MS);
    if (aJour || calGoalsEnCours === date) return;

    calGoalsEnCours = date;
    // L'ÂGE DE LA FEUILLE SE COMPTE DEPUIS LA DEMANDE, pas depuis la réponse.
    // C'est plus honnête — ce qui revient est au moins aussi vieux que ça —
    // et surtout : le battement du direct rappelle toutes les 30 s, la même
    // durée que la fenêtre de fraîcheur. Datée du retour, la feuille aurait
    // toujours paru fraîche d'un aller-retour réseau au moment du rappel, et
    // le suivi serait passé de trente secondes à une minute.
    const parti = Date.now();
    // Le marqueur ne se libère que s’il est encore le nôtre : une requête
    // partie pour une autre journée a pu le reprendre entre-temps.
    const liberer = () => { if (calGoalsEnCours === date) calGoalsEnCours = null; };
    fetchDayGoals(date).then(data => {
        liberer();
        // L'utilisateur a pu changer de journée pendant la requête : poser
        // ces buts-là les afficherait sous les matchs d'une autre date.
        if (calSelectedDate !== date) return;
        calGoals = { date, games: data.games || {}, live: data.live || {}, at: parti };
        // renderDayGames() ramène la piste des matchs à zéro. Ici le lecteur
        // n'a rien demandé — les buts arrivent d'eux-mêmes — et voir les
        // cartes revenir au premier match serait une main sur l'épaule.
        const piste = document.getElementById('fzdCalGames');
        const garde = piste ? piste.scrollLeft : 0;
        renderDayGames();
        if (piste) piste.scrollLeft = garde;
    }).catch(liberer);
}

async function fetchDayGoals(date) {
    try {
        const res = await fetch(`${BASE_URL}/day-goals/${date}`, { cache: 'no-store' });
        if (!res.ok) return { date, games: {}, live: {} };
        return await res.json();
    } catch (err) {
        console.warn('Could not load day goals:', err);
        return { date, games: {}, live: {} };
    }
}

// ============================================================
// PRÉCHARGEMENT — les requêtes de l'accueil qui n'attendent pas le pool.
//
// L'ouverture se faisait en DEUX VAGUES l'une après l'autre : d'abord le
// pool, les stats, les échanges et la trousse ; ensuite seulement l'horaire,
// les fiches de clubs et les feuilles du soir. Or aucune des trois dernières
// ne lit quoi que ce soit du pool — elles attendaient pour rien. Sur un
// téléphone en 4G vers Render, cet aller-retour de trop se voit.
//
// Elles partent donc avec la première vague, et ceux qui les consomment
// prennent la promesse déjà en vol. UNE SEULE FOIS : `renderDash()` repasse
// à chaque rafraîchissement de FZPool, et resservir éternellement la réponse
// de l'ouverture y figerait les feuilles du soir. Une fois consommée, la
// promesse est retirée et l'appel suivant repart sur le réseau, comme avant.
// ============================================================
let fzdPrecharge = null;

function fzdPrecharger() {
    if (fzdPrecharge) return fzdPrecharge;
    fzdPrecharge = {
        jour: todayISO(),
        horaire: fetchSchedule(todayISO()),
        equipes: loadNhlTeams(),
        tonight: fetchTonightBoxscores()
    };
    return fzdPrecharge;
}

/**
 * La promesse préchargée, ou rien si elle a déjà servi.
 *
 * `jour` garde la journée du pool au moment du départ : une page laissée
 * ouverte jusqu'après minuit à l'Est reprendrait sinon l'horaire de la
 * veille pour celui d'aujourd'hui.
 */
function fzdPrise(cle) {
    if (!fzdPrecharge) return null;
    if (cle !== 'equipes' && fzdPrecharge.jour !== todayISO()) return null;
    const promesse = fzdPrecharge[cle];
    fzdPrecharge[cle] = null;
    return promesse || null;
}

async function initCalendar() {
    const today = todayISO();
    const [schedule] = await Promise.all([
        fzdPrise('horaire') || fetchSchedule(today),
        fzdPrise('equipes') || loadNhlTeams()
    ]);
    calData = schedule;
    calSelectedDate = calData.days.find(d => d.date === today) ? today : (calData.days[0]?.date || today);
    renderCalendar();
    renderOffseasonPanel();
}

function renderCalendar() {
    renderCalRange();
    renderDayStrip();
    renderDayHead();
    renderDayGames();
}

/** « 18 – 24 oct. » : la semaine que /schedule/:date vient de renvoyer. */
function renderCalRange() {
    const el = document.getElementById('fzdCalRange');
    if (!el || !calData || !calData.days.length) return;
    const first = calData.days[0].date;
    const last = calData.days[calData.days.length - 1].date;
    const mon = iso => FR_MONTH_SHORT[Number(iso.slice(5, 7)) - 1];
    el.textContent = mon(first) === mon(last)
        ? `${dayNum(first)} – ${dayNum(last)} ${mon(last)}`
        : `${dayNum(first)} ${mon(first)} – ${dayNum(last)} ${mon(last)}`;
}

function renderDayStrip() {
    const strip = document.getElementById('fzdCalStrip');
    if (!strip || !calData) return;
    const today = todayISO();

    // Keep the day buttons alive across feed refreshes. Replacing a pressed
    // button between pointerdown and click loses the click (and keyboard focus).
    const existing = new Map([...strip.querySelectorAll('.fzd-day-chip')].map(button => [button.dataset.date, button]));
    const buttons = calData.days.map(d => {
        const isToday = d.date === today;
        const isSelected = d.date === calSelectedDate;
        const games = d.games || [];
        const live = games.filter(g => {
            const e = d.date === calGoals.date ? etatDirect(g).state : g.state;
            return e === 'LIVE' || e === 'CRIT';
        }).length;
        // Le mot est dans un <span> à part : au téléphone la case ne fait
        // qu'un septième d'écran, la CSS n'y garde que le chiffre.
        const countLabel = `${games.length} match${games.length > 1 ? 's' : ''}${live ? `, dont ${live} en direct` : ''}`;
        const count = `<span class="fzd-day-chip-count${live ? ' is-live' : ''}" title="${countLabel}">${live ? '<i class="fzd-live-dot" aria-hidden="true"></i>' : ''}<span class="fzd-count-n">${games.length}</span><span class="fzd-count-w"> match${games.length > 1 ? 's' : ''}</span></span>`;
        const button = existing.get(d.date) || document.createElement('button');
        button.type = 'button';
        button.className = `fzd-day-chip${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}`;
        button.dataset.date = d.date;
        button.setAttribute('aria-pressed', String(isSelected));
        button.setAttribute('aria-label', `${FR_DOW_LONG[new Date(d.date + 'T00:00:00Z').getUTCDay()]} ${dayNum(d.date)} ${FR_MONTH[Number(d.date.slice(5, 7)) - 1]} · ${countLabel}`);
        const content = `
                <span class="fzd-day-chip-top">
                    <span class="fzd-day-chip-num">${dayNum(d.date)}</span>
                    <span class="fzd-day-chip-dow">${isToday ? 'Auj' : dowLabel(d.date)}</span>
                </span>
                ${count}
                <span class="fzd-day-chip-month">${FR_MONTH_SHORT[Number(d.date.slice(5, 7)) - 1]}</span>`;
        if (button.innerHTML !== content) button.innerHTML = content;
        if (!existing.has(d.date)) button.addEventListener('click', () => selectCalendarDay(button.dataset.date));
        return button;
    });
    if (buttons.length !== strip.children.length || buttons.some((button, i) => strip.children[i] !== button)) strip.replaceChildren(...buttons);
}

/** « Mercredi 21 octobre · 5 de vos joueurs à l'horaire ». */
function renderDayHead() {
    const el = document.getElementById('fzdCalDayHead');
    if (!el) return;
    const iso = calSelectedDate || todayISO();
    const d = new Date(iso + 'T00:00:00Z');
    const label = `${FR_DOW_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${FR_MONTH[d.getUTCMonth()].toLowerCase()}`;

    const day = calData && calData.days.find(x => x.date === iso);
    const games = (day && day.games) || [];
    const counts = rosterTeamCounts();
    const mine = games.reduce((sum, g) => sum + rosterCountForGame(counts, g), 0);

    el.innerHTML = `
        <span class="fzd-cal-dayname">${escapeHTML(label)}</span>
        ${mine ? `<span class="fzd-cal-daysub">${mine} de vos joueur${mine > 1 ? 's' : ''} à l'horaire</span>` : ''}`;
}

function renderDayGames() {
    const wrap = document.getElementById('fzdCalGames');
    const nav = document.getElementById('fzdCalCarNav');
    if (!wrap || !calData) return;

    const day = calData.days.find(d => d.date === calSelectedDate);
    const games = (day && day.games) || [];

    if (!games.length) {
        wrap.innerHTML = `<p class="fzd-cal-empty">Aucun match cette journée.</p>`;
        if (nav) nav.style.display = 'none';
        return;
    }

    // Tous les matchs de la journée, toujours : ils DÉFILENT (deux cartes par
    // vue au bureau, une au téléphone) au lieu de s'empiler. Plus de repli
    // « Voir les N autres » — le carrousel les atteint tous.
    const counts = rosterTeamCounts();
    chargerButsDuJour(calSelectedDate, games);
    wrap.innerHTML = games.map(g => gameCardHTML(g, counts)).join('');
    wrap.scrollLeft = 0;
    if (nav) nav.style.display = '';

    renderCalGameDots();
    bindPlayerTracks(wrap);
    bindGoalTracks(wrap);
    fzdMajHorloges();
    reglerSuiviDirect();
}

/** Largeur d'un « saut » de carrousel : une carte + le gap de la piste. */
function calGameStep(wrap) {
    const card = wrap.querySelector('.fzd-game-card');
    if (!card) return 0;
    const gap = parseFloat(getComputedStyle(wrap).columnGap || '0') || 0;
    return card.offsetWidth + gap;
}

/** Nombre de cartes visibles d'un coup : deux au bureau, une au téléphone. */
function calGamesPerView(wrap) {
    const step = calGameStep(wrap);
    return step ? Math.max(1, Math.round(wrap.clientWidth / step)) : 1;
}

/**
 * Une puce par PAGE, pas par carte : au bureau douze matchs font six pages de
 * deux, une rangée de douze puces ne voudrait rien dire. Les flèches et les
 * puces disparaissent quand tout tient dans une seule vue.
 */
function renderCalGameDots() {
    const wrap = document.getElementById('fzdCalGames');
    const dots = document.getElementById('fzdCalDots');
    const nav = document.getElementById('fzdCalCarNav');
    if (!wrap || !dots) return;

    const count = wrap.querySelectorAll('.fzd-game-card').length;
    const pages = Math.ceil(count / calGamesPerView(wrap));
    if (nav) nav.style.display = pages > 1 ? '' : 'none';
    dots.innerHTML = pages > 1
        ? Array.from({ length: pages }, (_, i) => `<i class="fzd-cal-dot${i === 0 ? ' is-on' : ''}"></i>`).join('')
        : '';
    updateCalGameDots();
}

// ============================================================
// LE DIRECT — horloge, période et pointage d'un match qui joue.
//
// `calData` est figé pour la session : l'horaire est demandé une fois au
// démarrage, et rien ne le redemande. Une carte « En direct » gardait donc
// la marque et la période du moment où la page s'est ouverte, sans horloge
// — l'horaire de la LNH n'en publie aucune. /day-goals, lui, lit la feuille
// du jour, qui porte les quatre. C'est cette feuille qui fait vivre les
// cartes, et le battement ci-dessous qui la redemande.
// ============================================================
const ETAT_RANG = { FUT: 0, PRE: 0, LIVE: 1, CRIT: 1, FINAL: 2, OFF: 2 };
const CAL_DIRECT_MS = 30 * 1000;
let calDirectTimer = null;
let fzdHorlogeTimer = null;

/** Rang d'un état de match : à venir, en cours, terminé. */
function rangEtat(state) {
    return ETAT_RANG[state] ?? 0;
}

/**
 * Le match tel qu'il est MAINTENANT : l'horaire, corrigé par la feuille du jour.
 *
 * La feuille ne sert qu'à FAIRE AVANCER un match, jamais à le faire reculer.
 * Les deux flux de la LNH ne tombent pas en panne ensemble — on a vu la
 * feuille du jour resservir « à venir » pendant des heures sur un match que
 * l'horaire donnait final. Comparer les rangs avant de recopier coûte une
 * ligne et évite qu'une carte terminée reparte en première période.
 */
function etatDirect(game) {
    const direct = calGoals.live && calGoals.live[game.id];
    if (!direct || rangEtat(direct.state) < rangEtat(game.state)) return game;

    return {
        ...game,
        state: direct.state,
        period: direct.period ?? game.period,
        periodType: direct.periodType || game.periodType,
        clock: direct.clock || game.clock,
        away: { ...game.away, score: direct.away ?? game.away.score },
        home: { ...game.home, score: direct.home ?? game.home.score }
    };
}

/**
 * « 08:23 » à partir d'un nombre de secondes.
 *
 * Minutes sur deux chiffres, comme la LNH les écrit — et surtout : la
 * largeur ne change plus au passage de 10:00 à 09:59. Un chronomètre qui
 * rétrécit d'un caractère en pleine descente décale tout l'en-tête.
 */
function horlogeMMSS(secondes) {
    const s = Math.max(0, Math.floor(secondes));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * La ligne de droite de l'en-tête d'un match en cours : « 2e · 12:34 ».
 *
 * Le chiffre vit dans son propre <span> : le battement ne réécrit que lui,
 * jamais la période autour. `data-fzd-clock` garde les secondes telles que
 * la LNH les a données et `data-fzd-at` l'instant où on les a reçues — le
 * temps restant se RECALCULE à chaque battement au lieu de se décrémenter.
 * Un onglet en arrière-plan, que le navigateur ralentit à un battement par
 * minute, revient ainsi à la bonne seconde au lieu d'avoir pris du retard.
 *
 * Pendant l'entracte, l'horloge de la LNH compte l'attente avant la reprise.
 * « Fin 2e » dit alors la période qui vient de finir, et le décompte, ce
 * qu'on attend — deux informations qu'un simple « 3e · 20:00 » perdrait.
 */
function horlogeHTML(game) {
    const h = game.clock;
    const periode = periodLabel(game.period, game.periodType);
    if (!h) return periode;

    const secondes = Number.isFinite(h.secondsRemaining) ? h.secondsRemaining : null;
    const texte = secondes != null ? horlogeMMSS(secondes) : (h.timeRemaining || '');
    if (!texte) return periode;

    // Une horloge arrêtée — sifflet, fin de période — reste affichée telle
    // quelle : c'est l'heure du match, pas une valeur périmée.
    const avance = h.running && secondes != null ? '1' : '0';
    const pendule = `<span class="fzd-game-clock" data-fzd-clock="${escapeHTML(String(secondes ?? ''))}"`
        + ` data-fzd-at="${Date.now()}" data-fzd-run="${avance}">${escapeHTML(texte)}</span>`;

    return h.inIntermission
        ? `Fin ${periode} · ${pendule}`
        : `${periode} · ${pendule}`;
}

/**
 * Un battement par seconde, partagé par toutes les horloges à l'écran.
 *
 * Un minuteur par carte ferait quatorze réveils par seconde un soir chargé,
 * et autant de fuites à chaque redessin du calendrier. Celui-ci s'arrête de
 * lui-même dès qu'il ne reste plus une seule horloge qui avance.
 */
function fzdTickHorloges() {
    const pendules = document.querySelectorAll('.fzd-game-clock[data-fzd-run="1"]');
    if (!pendules.length) { fzdArreterHorloges(); return; }

    pendules.forEach(el => {
        const base = Number(el.dataset.fzdClock);
        const pose = Number(el.dataset.fzdAt);
        if (!Number.isFinite(base) || !Number.isFinite(pose)) return;

        const restant = Math.max(0, base - Math.floor((Date.now() - pose) / 1000));
        const texte = horlogeMMSS(restant);
        if (el.textContent !== texte) el.textContent = texte;
        // À zéro, la sirène a sonné : plus rien à décompter tant que la
        // prochaine feuille n'a pas dit ce qui suit.
        if (!restant) el.dataset.fzdRun = '0';
    });
}

function fzdArreterHorloges() {
    if (!fzdHorlogeTimer) return;
    clearInterval(fzdHorlogeTimer);
    fzdHorlogeTimer = null;
}

/** Démarre ou arrête le battement selon ce qui est réellement à l'écran. */
function fzdMajHorloges() {
    const besoin = !!document.querySelector('.fzd-game-clock[data-fzd-run="1"]');
    if (besoin && !fzdHorlogeTimer) fzdHorlogeTimer = setInterval(fzdTickHorloges, 1000);
    else if (!besoin) fzdArreterHorloges();
}

/**
 * Le suivi d'une journée qui joue : une feuille fraîche toutes les 30 s.
 *
 * L'horloge locale avance seule entre deux feuilles, mais elle ne sait rien
 * d'un but, d'un arrêt de jeu ou d'une fin de période — d'où le rappel. Il ne
 * part que si un match est VRAIMENT en cours, état fusionné en main : sans
 * ça, un horaire figé sur « LIVE » aurait sondé la LNH jusqu'au lendemain.
 * Onglet caché, on ne demande rien ; en revenant, on demande tout de suite,
 * parce que la carte affiche alors une horloge vieille de tout le détour.
 */
function reglerSuiviDirect() {
    const jour = calData && calData.days.find(d => d.date === calSelectedDate);
    const parties = (jour && jour.games) || [];
    const enDirect = parties.some(g => {
        const e = etatDirect(g).state;
        return e === 'LIVE' || e === 'CRIT';
    });

    if (!enDirect) {
        if (calDirectTimer) { clearInterval(calDirectTimer); calDirectTimer = null; }
        return;
    }
    if (calDirectTimer) return;

    calDirectTimer = setInterval(() => {
        if (document.hidden) return;
        const j = calData && calData.days.find(d => d.date === calSelectedDate);
        chargerButsDuJour(calSelectedDate, (j && j.games) || []);
    }, CAL_DIRECT_MS);
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden || !calData || !calSelectedDate) return;
    const jour = calData.days.find(d => d.date === calSelectedDate);
    if (jour) chargerButsDuJour(calSelectedDate, jour.games || []);
});

function gameCardHTML(gameHoraire, rosterCounts) {
    // Une seule fusion en haut de la carte : le badge, le pointage, l'ordre
    // des buteurs et le compte de vos joueurs doivent tous raconter la même
    // minute du match.
    const game = etatDirect(gameHoraire);
    const isFinal = game.state === 'FINAL' || game.state === 'OFF';
    const isLive = game.state === 'LIVE' || game.state === 'CRIT';
    const isScheduled = !isFinal && !isLive;
    const rosterCount = rosterCountForGame(rosterCounts, game);

    let badge, when = '';
    if (isLive) {
        badge = `<span class="fzd-game-badge is-live"><i class="fzd-live-dot"></i>En direct</span>`;
        when = horlogeHTML(game);
    } else if (isFinal) {
        badge = `<span class="fzd-game-badge is-final">Final</span>`;
    } else {
        badge = `<span class="fzd-game-badge">${gameTimeLabel(game.startTimeUTC)}</span>`;
        // « Dans 1 h 12 » n'a de sens qu'à quelques heures de la mise au jeu :
        // à trois jours de là, countdownLabel écrirait « Dans 74 h 05 ».
        const inMs = new Date(game.startTimeUTC) - Date.now();
        if (inMs > 0 && inMs < 12 * 3600 * 1000) when = `Dans ${countdownLabel(game.startTimeUTC)}`;
    }

    const teamRow = (side, opponent) => {
        const trailing = !isScheduled && (side.score ?? 0) < (opponent.score ?? 0);
        const record = teamRecord(side.abbrev);
        return `
            <div class="fzd-game-row">
                ${teamLogoImg(side.abbrev)}
                <div class="fzd-team-id">
                    <div class="fzd-team-name${trailing ? ' is-trailing' : ''}">${escapeHTML(teamName(side.abbrev))}</div>
                    <div class="fzd-team-rec">${escapeHTML(record || side.abbrev)}</div>
                </div>
                ${isScheduled ? '' : `<div class="fzd-team-score${trailing ? ' is-trailing' : ''}">${side.score ?? 0}</div>`}
            </div>`;
    };

    return `
        <article class="fzd-game-card${isScheduled ? ' is-scheduled' : ''}${isFinal ? ' is-final' : ''}${isLive ? ' is-live' : ''}">
            <header class="fzd-game-head">
                ${badge}
                ${when ? `<span class="fzd-game-when">${when}</span>` : ''}
            </header>
            <div class="fzd-game-teams">
                ${teamRow(game.away, game.home)}
                ${teamRow(game.home, game.away)}
                ${gameGoalsHTML(game, isFinal)}
            </div>
            <div class="fzd-game-roster-count${rosterCount ? ' has-players' : ''}">${rosterCount ? `★ ${rosterCount} de vos joueurs` : 'Aucun de vos joueurs'}</div>
            ${gamePlayersHTML(game)}
        </article>`;
}

/**
 * Les buteurs du match, en carrousel, sous le pointage.
 *
 * L'ORDRE DIT OÙ REGARDER, et il s'inverse quand la sirène sonne :
 *
 *   - match en cours, le plus récent à GAUCHE. Une carte qui suit un match
 *     répond à « qu'est-ce qui vient de se passer » ; la réponse doit être
 *     là où l'œil se pose, sans faire défiler. Chaque but pousse les
 *     précédents vers la droite ;
 *   - match terminé, le premier à GAUCHE. Plus rien n'arrive, la question
 *     devient « comment ça s'est joué » : on relit la feuille dans l'ordre
 *     où elle s'est écrite, du premier but au dernier.
 *
 * La liste arrive du serveur dans l'ordre de la LNH — chronologique — et
 * c'est `slice().reverse()` qui la retourne, jamais `reverse()` seul : la
 * même liste est relue à chaque rendu, et l'inverser sur place la ferait
 * basculer d'un rendu à l'autre.
 *
 * Un match sans but n'affiche rien plutôt qu'un bandeau vide — c'est déjà
 * la règle du carrousel « Vos joueurs » juste en dessous.
 */
function gameGoalsHTML(game, isFinal) {
    const buts = (calGoals.games && calGoals.games[game.id]) || [];
    if (!buts.length) return '';

    const ordonnes = isFinal ? buts : buts.slice().reverse();
    // Le pointage courant s'écrit « visiteur — local », dans l'ordre du
    // tableau d'affichage ; les abréviations viennent du match, pas du but.
    const equipes = { away: game.away?.abbrev || '', home: game.home?.abbrev || '' };

    return `
        <div class="fzd-goals">
            <div class="fzd-goals-head">
                <span class="fzd-goals-title">Buts</span>
                <span class="fzd-goals-sub">${isFinal ? 'Du premier au dernier' : 'Le plus récent d’abord'}</span>
                <span class="fzd-goals-nav">
                    <button type="button" class="fzd-goals-arrow" data-dir="prev" aria-label="But précédent">‹</button>
                    <button type="button" class="fzd-goals-arrow" data-dir="next" aria-label="But suivant">›</button>
                </span>
            </div>
            <div class="fzd-goals-track">${ordonnes.map(b => goalCardHTML(b, equipes)).join('')}</div>
        </div>`;
}

/**
 * Une carte de but : qui a marqué, qui a aidé, et où en était le match.
 *
 * Trois lignes, trois échelles de temps :
 *
 *   Phillip Danault (1)              ← son 1er but DE LA SAISON
 *   Z. Bolduc (1) et A. Texier (1)   ← leurs aides de la saison
 *   MTL 1 - TOR 0 (2e - 00:51)       ← la marque APRÈS ce but
 *
 * Les nombres entre parenthèses ne sont pas décoratifs : ils transforment le
 * carrousel en deux récits à la fois. De gauche à droite sur un match
 * terminé, la marque raconte la soirée — qui menait, quand ça a basculé —
 * et les compteurs racontent la saison de chaque joueur, un but à la fois.
 *
 * L'anneau de la photo porte la couleur du club du buteur. Les buts des deux
 * équipes se suivent dans la même piste : sans lui, il faudrait comparer
 * deux nombres pour savoir qui vient de marquer. Une couleur se lit d'un
 * coup, et elle ne coûte pas une ligne de texte sur une carte qui en a déjà
 * trois.
 *
 * `periodLabel` rend du balisage (« 2<sup>e</sup> ») : c'est la seule pièce
 * ici qui ne passe pas par escapeHTML, et tout ce qui vient de la LNH y passe.
 *
 * La carte entière ouvre la fiche du buteur (voir bindGoalTracks) : un nom
 * qui vient de marquer est la première chose qu'on veut aller voir, et viser
 * le nom seul demanderait de la précision sur une ligne de 11 pixels. La
 * feuille de pointage de la LNH donne l'identifiant du buteur ; sans lui —
 * un vieux match, une réponse incomplète — la carte reste une simple carte
 * plutôt qu'un bouton qui ne mènerait nulle part.
 */
function goalCardHTML(but, equipes) {
    const nom = but.name || '';
    const fiche = Number(but.playerId) > 0 ? Number(but.playerId) : 0;
    const initiales = nom.split(/\s+/).map(m => m[0] || '').join('').slice(0, 2).toUpperCase();
    // getTeamColors vient de teamColors.js, chargé avant ce fichier ; le
    // garde-fou sert aux tests, qui chargent cette fonction toute seule.
    const couleur = typeof getTeamColors === 'function'
        ? getTeamColors(but.teamAbbrev)[0] : '';
    const photo = but.headshot
        ? `<img class="fzd-goal-photo" src="${escapeHTML(but.headshot)}" alt="" loading="lazy" onerror="this.remove()">`
        : `<span class="fzd-goal-photo is-initials">${escapeHTML(initiales)}</span>`;

    const aides = (but.assists || []).filter(a => a.name);
    const aide = aides.length
        ? aides.map(a => escapeHTML(a.name) + compteurHTML(a.assistsToDate)).join(' et ')
        : 'Sans aide';
    const aideTitre = aides.length
        ? aides.map(a => a.assistsToDate ? `${a.name} (${a.assistsToDate})` : a.name).join(' et ')
        : 'Sans aide';

    const marque = but.awayScore != null && but.homeScore != null
        ? `${escapeHTML(equipes.away)} ${escapeHTML(String(but.awayScore))}`
          + ` - ${escapeHTML(equipes.home)} ${escapeHTML(String(but.homeScore))}`
        : '';
    const quand = `${periodLabel(but.period, but.periodType)} - ${escapeHTML(but.timeInPeriod || '')}`;

    const ouvre = fiche
        ? ` role="button" tabindex="0" data-goal-player="${fiche}" data-goal-name="${escapeHTML(nom)}" aria-label="Voir la fiche de ${escapeHTML(nom)}"`
        : '';

    return `
        <div class="fzd-goal-card"${ouvre}${couleur ? ` style="--fzd-goal-team: ${escapeHTML(couleur)}"` : ''}>
            ${photo}
            <div class="fzd-goal-id">
                <div class="fzd-goal-name" title="${escapeHTML(nom)}">${escapeHTML(nom)}${compteurHTML(but.goalsToDate)}</div>
                <div class="fzd-goal-assist" title="${escapeHTML(aideTitre)}">${aide}</div>
                <div class="fzd-goal-score">
                    <span class="fzd-goal-run">${marque}</span>
                    <span class="fzd-goal-when">(${quand})</span>
                </div>
            </div>
        </div>`;
}

/**
 * « (12) » : le total de la saison d'un joueur après ce jeu.
 *
 * Zéro n'arrive pas — un but marqué vaut au moins un — mais un ancien match
 * peut venir sans compteur, et « (0) » se lirait comme une erreur. Absent,
 * rien ne s'affiche.
 */
function compteurHTML(total) {
    return total ? ` <span class="fzd-goal-tally">(${escapeHTML(String(total))})</span>` : '';
}

/**
 * Le carrousel « Vos joueurs » sous chaque match — ce que la maquette
 * Canvas-12 met à la place des meneurs par équipe. Pendant le match la ligne
 * vient de /tonight-boxscores (calTonight) ; sinon ce sont les totaux de la
 * saison de /current-stats. Rien n'est rendu si aucun de vos joueurs n'est
 * dans ce match : mieux vaut pas de bandeau qu'un bandeau vide.
 */
function gamePlayersHTML(game) {
    const abbrevs = [game.away.abbrev, game.home.abbrev];
    const started = ['LIVE', 'CRIT', 'FINAL', 'OFF'].includes(game.state);

    const tonightByName = {};
    (calTonight.players || []).forEach(p => { tonightByName[p.playerName] = p; });

    const rows = [];
    activeRosterNames().forEach(name => {
        const info = getPlayerStats(name);
        if (!info || !abbrevs.includes(info.teamAbbrev)) return;
        // Les feuilles de match ne couvrent que la journée en cours : pour un
        // match d'un autre jour, tonightByName est vide et on retombe tout
        // seul sur les totaux de la saison.
        const live = started ? tonightByName[name] : null;
        rows.push({ name, info, live });
    });
    if (!rows.length) return '';

    const inPlay = rows.filter(r => r.live).length;
    const sub = inPlay ? `${inPlay} en jeu` : 'Totaux de la saison';

    return `
        <footer class="fzd-game-players">
            <div class="fzd-gp-head">
                <span class="fzd-gp-title">Vos joueurs</span>
                <span class="fzd-gp-sub">${sub}</span>
            </div>
            <div class="fzd-gp-track">${rows.map(r => playerCardHTML(r.name, r.info, r.live)).join('')}</div>
            ${rows.length > 1 ? `<div class="fzd-gp-dots" aria-hidden="true">${rows.map((_, i) => `<i class="fzd-gp-dot${i === 0 ? ' is-on' : ''}"></i>`).join('')}</div>` : ''}
        </footer>`;
}

function playerCardHTML(name, info, live) {
    const pos = info.position && info.position !== 'N/A' ? info.position : '';
    let meta, num, label, hot = false;

    if (live) {
        meta = [info.teamAbbrev, pos, live.toi].filter(Boolean).join(' · ');
        if (live.position === 'G') {
            const faced = live.shotsAgainst || ((live.saves || 0) + (live.goalsAgainst || 0));
            num = faced ? (live.saves / faced).toFixed(3).replace(/^0/, '') : '—';
            label = '%Arr';
        } else if ((live.goals || 0) > 0) {
            num = live.goals; label = live.goals > 1 ? 'Buts' : 'But'; hot = true;
        } else if ((live.assists || 0) > 0) {
            num = live.assists; label = 'Pass'; hot = true;
        } else {
            num = live.shots || 0; label = 'Tirs';
        }
    } else {
        meta = [info.teamAbbrev, pos].filter(Boolean).join(' · ');
        if (pos === 'G') { num = info.wins || 0; label = 'Vict'; }
        else { num = info.points || 0; label = 'Pts'; }
    }

    const initials = name.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
    const avatar = info.headshot
        ? `<img class="fzd-gp-photo" src="${escapeHTML(info.headshot)}" alt="" loading="lazy" onerror="this.remove()">`
        : `<span class="fzd-gp-photo is-initials">${escapeHTML(initials)}</span>`;

    return `
        <div class="fzd-gp-card">
            ${avatar}
            <div class="fzd-gp-id">
                <div class="fzd-gp-name">${escapeHTML(name)}</div>
                <div class="fzd-gp-meta">${escapeHTML(meta)}</div>
            </div>
            <div class="fzd-gp-stat">
                <div class="fzd-gp-num${hot ? ' is-hot' : ''}">${escapeHTML(String(num))}</div>
                <div class="fzd-gp-lbl">${escapeHTML(label)}</div>
            </div>
        </div>`;
}

/** Puces du carrousel « Vos joueurs », une piste par carte de match. */
function bindPlayerTracks(root) {
    root.querySelectorAll('.fzd-gp-track').forEach(track => {
        const dots = track.parentElement.querySelector('.fzd-gp-dots');
        if (!dots || !dots.children.length) return;
        track.addEventListener('scroll', () => {
            const card = track.firstElementChild;
            if (!card) return;
            const step = card.offsetWidth + 8;
            const i = Math.min(dots.children.length - 1, Math.round(track.scrollLeft / step));
            Array.from(dots.children).forEach((d, k) => d.classList.toggle('is-on', k === i));
        }, { passive: true });
    });
}

/**
 * Avance ou recule d'UN BUT.
 *
 * Pas d'une page pleine, comme le carrousel des matchs : on vient lire une
 * séquence, et sauter deux buts pour en montrer un troisième perdrait
 * justement ce que l'ordre raconte.
 */
function goalsScroll(track, dir) {
    if (!track) return;
    const carte = track.firstElementChild;
    const gap = parseFloat(getComputedStyle(track).columnGap || '0') || 0;
    const pas = carte ? carte.offsetWidth + gap : track.clientWidth;
    track.scrollBy({ left: dir * pas, behavior: 'smooth' });
}

/**
 * L'état des flèches d'un bloc de buts.
 *
 * Une piste qui tient entière n'a rien à faire défiler : ses flèches ne
 * s'affichent pas du tout, plutôt que de s'afficher mortes. Aux deux bouts,
 * celle qui ne mène nulle part se grise — même `is-off` que les flèches du
 * carrousel des matchs, juste au-dessus.
 */
function majFlechesButs(bloc) {
    const track = bloc.querySelector('.fzd-goals-track');
    if (!track) return;
    const max = track.scrollWidth - track.clientWidth;
    bloc.classList.toggle('has-nav', max > 1);
    bloc.querySelector('[data-dir="prev"]')?.classList.toggle('is-off', track.scrollLeft <= 1);
    bloc.querySelector('[data-dir="next"]')?.classList.toggle('is-off', track.scrollLeft >= max - 1);
}

/**
 * Flèches des buteurs et ouverture de leur fiche : une paire par carte de
 * match, posées à chaque rendu.
 *
 * La fiche est celle qu'ouvre « À surveiller » (accueil-watch.js) — même
 * modale, mêmes filtres, sans la note de la trousse que ce buteur n'a pas.
 * L'écouteur est posé sur la piste et non sur chaque carte : une piste se
 * réécrit à chaque rafraîchissement d'un match en cours, et autant
 * d'écouteurs que de buts marqués finiraient par s'y empiler.
 */
function bindGoalTracks(root) {
    root.querySelectorAll('.fzd-goals').forEach(bloc => {
        const track = bloc.querySelector('.fzd-goals-track');
        if (!track) return;
        bloc.querySelector('[data-dir="prev"]')?.addEventListener('click', () => goalsScroll(track, -1));
        bloc.querySelector('[data-dir="next"]')?.addEventListener('click', () => goalsScroll(track, 1));
        track.addEventListener('scroll', () => majFlechesButs(bloc), { passive: true });
        track.addEventListener('click', event => ouvrirFicheButeur(event.target.closest('[data-goal-player]')));
        track.addEventListener('keydown', event => {
            const carte = event.target.closest?.('[data-goal-player]');
            if (!carte || event.target !== carte || !['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            ouvrirFicheButeur(carte);
        });
        majFlechesButs(bloc);
    });
}

/** La fiche du joueur d'une carte de but, si la LNH a donné son identifiant. */
function ouvrirFicheButeur(carte) {
    if (!carte || typeof fzhOpenPlayerCareer !== 'function') return;
    fzhOpenPlayerCareer(carte.dataset.goalPlayer, carte.dataset.goalName || '');
}

/** Reflète la position du carrousel des matchs : puce active, flèches
 *  grisées aux deux bouts. */
function updateCalGameDots() {
    const wrap = document.getElementById('fzdCalGames');
    const dots = document.getElementById('fzdCalDots');
    if (!wrap) return;

    const page = calGameStep(wrap) * calGamesPerView(wrap);
    if (dots && dots.children.length && page) {
        const i = Math.min(dots.children.length - 1, Math.round(wrap.scrollLeft / page));
        Array.from(dots.children).forEach((d, k) => d.classList.toggle('is-on', k === i));
    }

    const max = wrap.scrollWidth - wrap.clientWidth;
    document.getElementById('fzdCalGamesPrev')?.classList.toggle('is-off', wrap.scrollLeft <= 1);
    document.getElementById('fzdCalGamesNext')?.classList.toggle('is-off', wrap.scrollLeft >= max - 1);
}

/** Avance ou recule d'une page pleine (deux cartes au bureau, une au tél.). */
function calGamesScroll(dir) {
    const wrap = document.getElementById('fzdCalGames');
    if (!wrap) return;
    const page = calGameStep(wrap) * calGamesPerView(wrap);
    wrap.scrollBy({ left: dir * (page || wrap.clientWidth), behavior: 'smooth' });
}

// ============================================================
// BLOCS PARTAGÉS — un seul nœud par panneau, déplacé d'un accueil à l'autre
//
// Le calendrier, le compte à rebours hors-saison, « Mouvements récents » et
// « À surveiller » sont les mêmes quatre panneaux sur les quatre accueils
// (tableau de bord, repêchage, saison, téléphone). Ils existent donc UNE
// seule fois dans index.html et chaque accueil ouvre un emplacement vide
// `data-fz-bloc="<clé>"` où on les déplace : un seul balisage, un seul
// rendu, jamais deux versions du même panneau qui finissent par diverger.
//
// Les emplacements portent display:contents (accueil-dash.css) : c'est le
// nœud déplacé qui devient l'enfant de grille, pas l'emplacement.
// ============================================================
const FZD_BLOCS = [
    { cle: 'calendrier', id: 'fzDashCalendarWrap' },
    { cle: 'horssaison', id: 'fzdOffCount' },
    { cle: 'mouvements', id: 'fzdOffMoves' },
    { cle: 'surveiller', id: 'fzdOffWatch' }
];
let fzdBlocsMaison = null;

/** Où chaque bloc vit dans index.html, relevé avant le premier déplacement. */
function fzdBlocs() {
    if (!fzdBlocsMaison) {
        fzdBlocsMaison = FZD_BLOCS.map(({ cle, id }) => {
            const noeud = document.getElementById(id);
            return noeud && { cle, noeud, parent: noeud.parentElement, avant: noeud.nextElementSibling };
        }).filter(Boolean);
    }
    return fzdBlocsMaison;
}

/**
 * L'emplacement qui réclame ce bloc, s'il y en a un à l'écran.
 *
 * Ceux de la home téléphone ne comptent qu'au téléphone : son balisage reste
 * dans le DOM au bureau, où .fz-mobile-home est masquée (accueil-mobile.css)
 * — un bloc qui y tomberait disparaîtrait de l'écran.
 */
function fzdSlotBloc(cle) {
    return [...document.querySelectorAll(`[data-fz-bloc="${cle}"]`)]
        .find(slot => calIsPhone() || !slot.closest('#fzMobileHome')) || null;
}

/** Place chaque bloc dans l'emplacement de l'accueil affiché, ou le rend. */
function fzdPlaceCalendar() {
    fzdRestoreCalendar();
    fzdBlocs().forEach(({ cle, noeud }) => {
        const slot = fzdSlotBloc(cle);
        if (slot && noeud.parentElement !== slot) slot.appendChild(noeud);
    });
}

/**
 * Ramène les blocs à leur place d'origine. Chaque accueil l'appelle AVANT de
 * réécrire son innerHTML : les nœuds vivent peut-être dans l'emplacement
 * qu'on efface, et la réécriture les supprimerait pour de bon — plus de
 * calendrier ni de mouvements jusqu'au prochain chargement de page.
 */
function fzdRestoreCalendar() {
    // À rebours : chaque bloc se repose devant le suivant, qui doit donc
    // être rentré le premier.
    fzdBlocs().slice().reverse().forEach(({ noeud, parent, avant }) => {
        if (noeud.parentElement === parent && noeud.nextElementSibling === avant) return;
        parent.insertBefore(noeud, avant && avant.parentElement === parent ? avant : null);
    });
}

async function selectCalendarDay(dateStr) {
    if (calData && calData.days.some(d => d.date === dateStr)) {
        calSelectedDate = dateStr;
        renderCalendar();
        return;
    }
    calData = await fetchSchedule(dateStr);
    // A preseason date without games is still the date the user selected.
    calSelectedDate = dateStr;
    renderCalendar();
}

async function calGoPrevWeek() {
    if (!calData || !calData.previousStartDate) return;
    calData = await fetchSchedule(calData.previousStartDate);
    calSelectedDate = calData.days[calData.days.length - 1]?.date || calData.previousStartDate;
    renderCalendar();
}

async function calGoNextWeek() {
    if (!calData || !calData.nextStartDate) return;
    calData = await fetchSchedule(calData.nextStartDate);
    calSelectedDate = calData.days[0]?.date || calData.nextStartDate;
    renderCalendar();
}

// ---- Month picker: replaces the mockup's dead "saison complète" link
// with a real jump-to-any-date panel, still backed by /schedule/:date. ----
function toggleMonthPicker() {
    calMonthOpen = !calMonthOpen;
    const panel = document.getElementById('fzdCalMonth');
    if (!panel) return;
    panel.classList.toggle('is-open', calMonthOpen);
    if (calMonthOpen) {
        const base = new Date((calSelectedDate || todayISO()) + 'T00:00:00Z');
        calMonthCursor = { year: base.getUTCFullYear(), month: base.getUTCMonth() };
        renderMonthGrid();
    }
}

function renderMonthGrid() {
    const grid = document.getElementById('fzdMonthGrid');
    const label = document.getElementById('fzdMonthLabel');
    if (!grid || !calMonthCursor) return;

    const { year, month } = calMonthCursor;
    if (label) label.textContent = `${FR_MONTH[month]} ${year}`;

    const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const today = todayISO();

    let cells = FR_DOW.map(d => `<div class="fzd-month-dow">${d}</div>`).join('');
    for (let i = 0; i < firstDow; i++) cells += `<div class="fzd-month-cell is-empty"></div>`;
    for (let day = 1; day <= daysInMonth; day++) {
        const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cls = ['fzd-month-cell'];
        if (iso === today) cls.push('is-today');
        if (iso === calSelectedDate) cls.push('is-selected');
        cells += `<button type="button" class="${cls.join(' ')}" data-date="${iso}">${day}</button>`;
    }

    grid.innerHTML = cells;
    grid.querySelectorAll('.fzd-month-cell[data-date]').forEach(btn => {
        btn.addEventListener('click', async () => {
            await selectCalendarDay(btn.dataset.date);
            toggleMonthPicker();
        });
    });
}

function monthPrev() {
    calMonthCursor.month -= 1;
    if (calMonthCursor.month < 0) { calMonthCursor.month = 11; calMonthCursor.year -= 1; }
    renderMonthGrid();
}

function monthNext() {
    calMonthCursor.month += 1;
    if (calMonthCursor.month > 11) { calMonthCursor.month = 0; calMonthCursor.year += 1; }
    renderMonthGrid();
}

// ============================================================
// TONIGHT — real per-player live/final stat lines (GET /tonight-boxscores)
// and real rank movement (GET /pool-rank-movement/:poolName).
// ============================================================
async function fetchTonightBoxscores() {
    try {
        const res = await fetch(`${BASE_URL}/tonight-boxscores`, { cache: 'no-store' });
        return res.ok ? await res.json() : { players: [], games: [] };
    } catch (err) {
        console.warn('Could not load tonight boxscores:', err);
        return { players: [], games: [] };
    }
}

async function fetchRankMovement(poolName) {
    try {
        const res = await fetch(`${BASE_URL}/pool-rank-movement/${encodeURIComponent(poolName)}`, { cache: 'no-store' });
        return res.ok ? await res.json() : { hasSnapshot: false, teams: [] };
    } catch (err) {
        console.warn('Could not load rank movement:', err);
        return { hasSnapshot: false, teams: [] };
    }
}

/** Fetches tonight's boxscores + rank movement once; shared by the desktop
 *  live panel and the phone home (renderMobileHome, accueil-mobile.js) so a
 *  page load never fires the same two requests twice. */
async function loadDashData() {
    const team = FZPool.team();
    const activeName = FZPool.get();
    if (!team || !activeName) return null;
    const [tonight, movement] = await Promise.all([
        fzdPrise('tonight') || fetchTonightBoxscores(),
        fetchRankMovement(activeName)
    ]);
    return { tonight, movement, activeName };
}

function renderLivePanel(tonight, movement, activeName) {
    const liveContainer = document.getElementById('fzdLivePanel');
    const playersContainer = document.getElementById('fzdPlayersList');
    if (!liveContainer || !playersContainer) return;

    const rosterNames = new Set(activeRosterNames());
    const myLines = (tonight.players || [])
        .filter(p => rosterNames.has(p.playerName))
        .sort((a, b) => (b.fantasyPointsTonight || 0) - (a.fantasyPointsTonight || 0));

    renderPlayersList(playersContainer, myLines, tonight.games || []);

    if ((tonight.games || []).length > 0) {
        renderLiveActive(liveContainer, myLines, tonight.games, movement, activeName);
    } else {
        renderPregame(liveContainer);
    }
}

function gameLineFor(playerLine, games) {
    const g = games.find(x => x.id === playerLine.gameId);
    if (!g) return '';
    const state = g.state;
    const scoreLine = `${g.away.abbrev} ${g.away.score} – ${g.home.abbrev} ${g.home.score}`;
    if (state === 'LIVE' || state === 'CRIT') {
        return `${scoreLine} · ${periodLabel(g.period, g.periodType)} ${escapeHTML(g.clock?.timeRemaining || '')}`;
    }
    if (state === 'FINAL' || state === 'OFF') return `${scoreLine} · Final`;
    return scoreLine;
}

function renderPlayersList(container, myLines, games) {
    if (!myLines.length) {
        container.innerHTML = `<p class="fzd-players-empty">Aucun de vos joueurs n'est à l'horaire aujourd'hui.</p>`;
        return;
    }

    container.innerHTML = myLines.map(p => {
        const pts = p.fantasyPointsTonight || 0;
        return `
            <div class="fzd-player-row">
                <div class="fzd-player-badge">${teamLogoImg(p.teamAbbrev)}</div>
                <div class="fzd-player-id">
                    <div class="fzd-player-name">${escapeHTML(p.playerName)}</div>
                    <div class="fzd-player-meta">${gameLineFor(p, games)}</div>
                </div>
                <div class="fzd-player-pts${pts === 0 ? ' is-zero' : ''}">${pts > 0 ? '+' : ''}${pts}</div>
            </div>`;
    }).join('');
}

function renderLiveActive(container, myLines, games, movement, activeName) {
    const totalPts = myLines.reduce((s, p) => s + (p.fantasyPointsTonight || 0), 0);
    const playersInAction = myLines.filter(p => {
        const g = games.find(x => x.id === p.gameId);
        return g && (g.state === 'LIVE' || g.state === 'CRIT');
    }).length;
    const gamesInProgress = games.filter(g => g.state === 'LIVE' || g.state === 'CRIT').length;

    let rankHTML = '';
    const teamRow = movement.teams?.find(t => t.teamName === FZPool.team()?.name);
    if (teamRow) {
        if (movement.hasSnapshot && teamRow.rankToday != null && teamRow.rankToday !== teamRow.rankNow) {
            const moved = teamRow.rankToday - teamRow.rankNow; // positive = moved up
            const arrow = moved > 0 ? '▲' : '▼';
            rankHTML = `
                <div class="fzd-live-rank">
                    <span class="fzd-live-rank-move">${arrow} ${Math.abs(moved)} place${Math.abs(moved) > 1 ? 's' : ''}</span>
                    <span> · ${ordinalHTML(teamRow.rankToday)} → ${ordinalHTML(teamRow.rankNow)} dans ${escapeHTML(activeName)}</span>
                </div>`;
        } else {
            rankHTML = `<div class="fzd-live-rank">${ordinalHTML(teamRow.rankNow)} dans ${escapeHTML(activeName)}</div>`;
        }
    }

    container.innerHTML = `
        <div class="fzd-live-head">
            <span class="fzd-live-dot"></span>
            <span class="fzd-live-badge">En direct</span>
            <span class="fzd-live-rule"></span>
            <span class="fzd-live-updated">Mis à jour à l'instant</span>
        </div>
        <div class="fzd-live-hero">
            <div class="fzd-live-score fzd-display">${totalPts > 0 ? '+' : ''}${totalPts}</div>
            <div class="fzd-live-score-lbl fzd-display">pts<br>ce soir</div>
        </div>
        ${rankHTML}
        <div class="fzd-live-stats">
            <div class="fzd-live-stat"><div class="fzd-live-stat-num fzd-display">${playersInAction}</div><div class="fzd-live-stat-lbl">joueurs en action</div></div>
            <div class="fzd-live-stat"><div class="fzd-live-stat-num fzd-display">${gamesInProgress}</div><div class="fzd-live-stat-lbl">matchs en cours</div></div>
        </div>`;
}

function renderPregame(container) {
    const today = calData?.days.find(d => d.date === todayISO());
    const upcoming = (today?.games || []).filter(g => g.state === 'FUT' || g.state === 'PRE');

    if (!upcoming.length) {
        container.innerHTML = `<p class="fzd-live-empty">Aucun match à votre horaire aujourd'hui.</p>`;
        return;
    }

    const counts = rosterTeamCounts();
    const next = upcoming.slice().sort((a, b) => new Date(a.startTimeUTC) - new Date(b.startTimeUTC))[0];
    const rosterPlayersToday = Object.entries(counts)
        .filter(([abbr]) => upcoming.some(g => g.away.abbrev === abbr || g.home.abbrev === abbr))
        .reduce((s, [, n]) => s + n, 0);

    container.innerHTML = `
        <div class="fzd-pregame-lbl">Prochains matchs</div>
        <div class="fzd-pregame-clock fzd-display">${countdownLabel(next.startTimeUTC)}</div>
        <div class="fzd-pregame-sub">Avant la mise au jeu${rosterPlayersToday ? ` · ${rosterPlayersToday} de vos joueurs sont à l'horaire` : ''}</div>
        <div class="fzd-pregame-list">
            ${upcoming.map(g => {
                const count = rosterCountForGame(counts, g);
                return `
                    <div class="fzd-pregame-row">
                        <span class="fzd-pregame-time fzd-display">${gameTimeLabel(g.startTimeUTC)}</span>
                        <span>${g.away.abbrev} – ${g.home.abbrev}</span>
                        <span class="fzd-pregame-sep">·</span>
                        <span class="fzd-pregame-count">${count > 0 ? `${count} joueur${count > 1 ? 's' : ''}` : 'Aucun joueur'}</span>
                    </div>`;
            }).join('')}
        </div>`;
}

// ============================================================
// REPÊCHAGE / ÉCHANGES — quick-action tiles, same logic
// renderPoolGlance used to drive (accueil.js's draftActionFor).
// ============================================================
/**
 * Lien vers la liste de tous les joueurs qu'on a repêchés : classement.html
 * ouvre directement la fiche de l'équipe sur ce paramètre (voir
 * loadAllUserPools dans classement.js). C'est ce que remplace le lien
 * « Repêchage » une fois celui-ci terminé — l'onglet disparaît alors des
 * barres de navigation et ses écrans se referment (navbar.js, activePool.js).
 */
function fzdMonEffectifHref(activeName, teamName) {
    return `classement.html?pool=${encodeURIComponent(activeName)}`
         + `&equipe=${encodeURIComponent(teamName)}`;
}

/* ---- Récapitulatif de repêchage rouvert depuis l'accueil ----
   Le popup est celui de la salle de repêchage (draftFinPopup.js) : même
   cartes, même mise en page. Il y lit des globales que l'accueil n'a pas,
   d'où la source explicite posée ici avant l'ouverture.

   La trousse complète (position, équipe, photo de chaque joueur) n'est
   chargée qu'au premier clic, et une seule fois : la home n'a aucune raison
   de télécharger 1 Mo pour un bouton qu'on ne pressera peut-être jamais —
   elle se contente sinon de draftkit-watchlist.json. */
let fzdBassinJoueurs = null;
let fzdBassinEnCours = null;

function fzdChargerBassinJoueurs() {
    if (fzdBassinJoueurs) return Promise.resolve(fzdBassinJoueurs);
    if (fzdBassinEnCours) return fzdBassinEnCours;
    // Le script de la trousse peut manquer (cache, bloqueur) : sans garde,
    // l'appel lèverait avant même d'entrer dans la chaîne de promesses et le
    // bouton resterait sans effet, au lieu d'ouvrir le récapitulatif dégradé.
    if (typeof FZDraftKit === 'undefined') {
        fzdBassinJoueurs = { skaters: [], goalies: [], teams: [] };
        return Promise.resolve(fzdBassinJoueurs);
    }
    fzdBassinEnCours = FZDraftKit.charger()
        .then(() => {
            // Même bassin que la salle de repêchage : la trousse, projections
            // 2026-2027 comprises. Le récapitulatif doit pouvoir retrouver
            // n'importe quel joueur repêché, y compris les centaines que
            // l'ancien fichier de statistiques ne contenait pas.
            fzdBassinJoueurs = FZDraftKit.pools('projection');
            return fzdBassinJoueurs;
        })
        .catch(err => {
            console.warn('Récapitulatif : bassin de joueurs indisponible', err);
            // Sans photos ni positions, le récapitulatif reste lisible (noms
            // et ordre viennent du pool) : mieux vaut l'ouvrir dégradé que
            // laisser le bouton sans effet.
            fzdBassinJoueurs = { skaters: [], goalies: [], teams: [] };
            return fzdBassinJoueurs;
        })
        .finally(() => { fzdBassinEnCours = null; });
    return fzdBassinEnCours;
}

async function fzdOuvrirRecapRepechage() {
    if (typeof window.fzShowDraftEndPopup !== 'function') return;
    const poolData = FZPool.data();
    const team = FZPool.team();
    const activeName = FZPool.get();
    if (!poolData || !team || !activeName) return;

    const bassin = await fzdChargerBassinJoueurs();
    window.fzSetDraftEndSource({
        draftData: poolData,
        teamName: team.name,
        clanName: activeName,
        complete: FZPool.draftState(poolData).etat === 'termine',
        skaters: bassin.skaters,
        goalies: bassin.goalies,
        teams: bassin.teams,
        // Le résolveur de photos de la salle de repêchage lit des globales
        // que l'accueil n'a pas ; on passe le sien, celui-là même qui donne
        // déjà leur visage aux cartes du carrousel de choix.
        headshot: fzdHeadshotByName
    });
    window.fzShowDraftEndPopup();
}

// La bannière est reconstruite à chaque rendu, et elle existe en double
// (#fzDashHero au bureau, #fzmHeroSlot sur téléphone) : un seul écouteur
// délégué vaut mieux qu'un rebranchement après chaque innerHTML.
document.addEventListener('click', event => {
    const bouton = event.target.closest('[data-fzd-recap]');
    if (!bouton) return;
    event.preventDefault();
    fzdOuvrirRecapRepechage();
});

/** Tous les choix d'une équipe, l'équipe LNH repêchée comprise. */
function fzdNombreDeChoix(teamData) {
    const td = teamData || {};
    return (td.offensive || []).length + (td.defensive || []).length
         + (td.goalie || []).length + (td.rookie || []).length
         + (td.teams || []).length;
}

function draftTileDetail(state, activeName) {
    if (state.etat === 'encours') return `${escapeHTML(activeName)} · choix ${(state.choixFait || 0) + 1}/${state.choixTotal || '—'}`;
    if (state.etat === 'termine') return 'Saison en cours';
    if (state.etat === 'pret') return `${escapeHTML(activeName)} · prêt à démarrer`;
    return `${escapeHTML(activeName)} · en attente de joueurs`;
}

function renderQuickActions() {
    const container = document.getElementById('fzdQuickActions');
    const activeName = FZPool.get();
    const poolData = FZPool.data();
    const team = FZPool.team();
    if (!container || !activeName || !poolData || !team) return;

    const state = FZPool.draftState(poolData);
    const action = draftActionFor({ data: poolData, name: activeName, teamName: team.name, teamData: team.data });
    const draftFallback = { attente: 'En attente de joueurs', termine: 'Terminé' };

    const draftValue = action ? action.label : (draftFallback[state.etat] || '—');
    // Repêchage terminé : repechage.html renverrait maintenant à l'accueil
    // (activePool.js). La tuile mène plutôt là où le repêchage a abouti —
    // l'effectif qu'on en a tiré.
    const draftHref = action ? action.href
        : state.etat === 'termine' ? fzdMonEffectifHref(activeName, team.name)
        : `repechage.html?pool=${encodeURIComponent(activeName)}`;
    const draftLive = action?.kind === 'your-turn';

    const activeTrades = (userData.pendingTrades || []).filter(t => t.draftName === activeName);
    const tradeValue = activeTrades.length ? `${activeTrades.length} offre${activeTrades.length > 1 ? 's' : ''} reçue${activeTrades.length > 1 ? 's' : ''}` : 'Aucune offre en attente';
    const tradeHref = activeTrades.length ? `trade.html?trade=${encodeURIComponent(activeTrades[0].id)}` : 'trade.html';
    const tradeDetail = activeTrades.length ? `${escapeHTML(activeTrades[0].fromTeam || '')} propose un échange` : `${escapeHTML(activeName)} · rien à traiter`;

    container.innerHTML = `
        <div class="fzd-actions-grid">
            <a class="fzd-action-tile${draftLive ? ' is-attention' : ''}" href="${draftHref}">
                <div class="fzd-action-eyebrow">Repêchage</div>
                <div class="fzd-action-value fzd-display">${escapeHTML(draftValue)}</div>
                <div class="fzd-action-detail">${draftTileDetail(state, activeName)}</div>
            </a>
            <a class="fzd-action-tile${activeTrades.length ? ' is-attention' : ''}" href="${tradeHref}">
                <div class="fzd-action-eyebrow">Échanges</div>
                <div class="fzd-action-value fzd-display">${escapeHTML(tradeValue)}</div>
                <div class="fzd-action-detail">${tradeDetail}</div>
            </a>
        </div>`;
}

// ============================================================
// HERO — bannière d'état pleine largeur (Canvas-9, Tour 2 : 2A
// bureau). Repêchage en cours / avant-saison / en direct ; masquée
// en saison régulière normale (fz-dash-live plus bas couvre déjà ce
// cas). Bureau seulement — accueil-mobile.js détecte les 4 mêmes
// états pour son propre écran, indépendamment de celui-ci.
// ============================================================
function fzdFormatElapsed(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m > 0 ? `${m} min` : `${s} s`;
}

/**
 * Prochain duel d'un pool tête-à-tête : contre qui, et à partir de quand.
 *
 * Le calendrier entier est tiré à la fin du repêchage (lib/h2h.js,
 * generateSeasonSchedule) et voyage avec le pool dans /draft — on lit donc
 * ici, sans requête, l'adversaire de n'importe quelle semaine. La semaine N
 * commence `seasonStart + (N-1) × 7 jours` : la même règle que le serveur,
 * pour que les deux ne racontent jamais deux histoires différentes.
 *
 * Renvoie `{ enCours, suivant }` — l'un des deux peut être null (avant le
 * premier duel, ou après le dernier) — ou null si le pool n'est pas en
 * tête-à-tête, si le repêchage n'a rien produit, ou si l'équipe ne figure
 * dans aucune semaine.
 */
function fzdProchainDuel(poolData, teamName) {
    const h2h = poolData && poolData.h2hData;
    if (!poolData || poolData.poolMode !== 'head-to-head' || !h2h || !teamName) return null;

    const debutSaison = h2h.seasonStart || h2h.weekStart;
    const semaines = Array.isArray(h2h.matchups) ? h2h.matchups : [];
    if (!debutSaison || semaines.length === 0) return null;

    const depart = new Date(debutSaison);
    if (Number.isNaN(depart.getTime())) return null;

    const maintenant = Date.now();
    let enCours = null;
    let suivant = null;

    for (let i = 0; i < semaines.length; i++) {
        const duel = (semaines[i] || []).find(m => m && (m.team1 === teamName || m.team2 === teamName));
        if (!duel) continue;   // équipe absente de cette semaine-là

        const debut = new Date(depart);
        debut.setDate(debut.getDate() + i * 7);
        const fin = new Date(debut);
        fin.setDate(fin.getDate() + 7);

        const contre = duel.team1 === teamName ? duel.team2 : duel.team1;

        if (maintenant >= debut.getTime() && maintenant < fin.getTime()) {
            enCours = { semaine: i + 1, adversaire: contre, debut, fin };
        } else if (maintenant < debut.getTime()) {
            suivant = { semaine: i + 1, adversaire: contre, debut, fin };
            break;   // le calendrier est chronologique : le premier à venir suffit
        }
    }

    return (enCours || suivant) ? { enCours, suivant } : null;
}

/**
 * Décompte de la bannière vers un instant précis. Passe des jours/heures aux
 * heures/minutes sous la barre des 24 h : « 0 jour, 03 heures » ne dit rien
 * de plus que « 03 heures, 12 minutes », et beaucoup moins bien.
 */
function fzdDuelCountdownHTML(cible) {
    const diff = Math.max(0, new Date(cible).getTime() - Date.now());
    const j = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);

    const stat = (lbl, val) =>
        `<div class="fzd-hero-stat"><span class="fzd-hero-stat-lbl">${lbl}</span><span class="fzd-hero-stat-val">${val}</span></div>`;
    const sep = '<div class="fzd-hero-stat-sep" aria-hidden="true"></div>';

    return j > 0
        ? stat('Jours', j) + sep + stat('Heures', String(h).padStart(2, '0'))
        : stat('Heures', String(h).padStart(2, '0')) + sep + stat('Minutes', String(m).padStart(2, '0'));
}

function fzdHeroState(tonight) {
    const poolData = FZPool.data();
    const team = FZPool.team();
    const activeName = FZPool.get();
    if (!poolData || !team || !activeName) return null;

    const draftState = FZPool.draftState(poolData);
    const isDraft = draftState.etat === 'encours';
    const draftDone = draftState.etat === 'termine';
    const today = todayISO();
    const seasonStart = calData?.regularSeasonStartDate;
    const isPreseason = !isDraft && !!seasonStart && today < seasonStart;

    if (isDraft) {
        // `myTurn` pilote la bascule de la bannière : neutre quand le tour est
        // à quelqu'un d'autre, rouge de marque quand c'est le vôtre (voir
        // .fz-dash-hero.is-myturn dans accueil-dash.css).
        const ordre = Array.isArray(poolData.draftOrder) ? poolData.draftOrder : [];
        const pick = poolData.currentPickIndex || 0;
        return { mode: 'draft', poolData, team, activeName, pick, myTurn: ordre[pick] === team.name };
    }

    // Pool tête-à-tête, repêchage bouclé : la prochaine échéance n'est plus
    // l'ouverture de la saison mais le duel de la semaine. Il passe donc
    // devant le décompte d'avant-saison — mais derrière « en direct » plus
    // bas : des joueurs sur la glace maintenant priment sur un duel à venir.
    const duel = draftDone ? fzdProchainDuel(poolData, team.name) : null;

    if (isPreseason && !duel) {
        const campStart = calData?.preSeasonStartDate;
        const beforeCamp = !!campStart && today < campStart;
        // `draftDone` ne change pas le décompte, seulement ce vers quoi la
        // bannière renvoie : l'effectif qu'on vient de repêcher plutôt que la
        // gestion d'équipe.
        // Le décompte vise toujours le premier match de la saison régulière :
        // c'est la date qu'on attend. Le camp n'est plus qu'une précision.
        return {
            mode: 'preseason', target: seasonStart, beforeCamp, campStart,
            draftDone, activeName, teamName: team.name
        };
    }

    const rosterNames = new Set(activeRosterNames());
    const myLines = (tonight?.players || []).filter(p => rosterNames.has(p.playerName));
    const liveCount = myLines.filter(p => {
        const g = (tonight?.games || []).find(x => x.id === p.gameId);
        return g && (g.state === 'LIVE' || g.state === 'CRIT');
    }).length;
    if (liveCount > 0) {
        const totalPts = myLines.reduce((s, p) => s + (p.fantasyPointsTonight || 0), 0);
        return { mode: 'live', liveCount, totalPts };
    }

    if (duel) {
        return { mode: 'h2hduel', duel, activeName, teamName: team.name };
    }

    // Repêchage terminé, rien de plus pressant à l'écran : la bannière —
    // autrement masquée — sert de porte vers l'effectif repêché. Placée
    // APRÈS 'live' : des joueurs sur la glace ce soir passent avant.
    if (draftDone) {
        return {
            mode: 'draftdone', activeName, teamName: team.name,
            picks: fzdNombreDeChoix(team.data)
        };
    }

    return { mode: 'regular' };
}

/**
 * Minuit à Montréal le jour `iso`, en millisecondes. Le décompte visait
 * minuit UTC — 20 h la veille à l'Est — et annonçait donc un jour de moins
 * que le titre « Saison régulière dans N jours ».
 */
function fzdMinuitEst(iso) {
    const midi = new Date(`${iso}T12:00:00Z`);
    const nom = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
        .formatToParts(midi).find(p => p.type === 'timeZoneName')?.value || 'GMT-5';
    const m = nom.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    const decalage = m ? `${m[1]}${m[2].padStart(2, '0')}:${m[3] || '00'}` : '-05:00';
    return new Date(`${iso}T00:00:00${decalage}`).getTime();
}

function fzdCountdownStatsHTML(targetISO) {
    const diff = Math.max(0, fzdMinuitEst(targetISO) - Date.now());
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    return `
        <div class="fzd-hero-stat"><span class="fzd-hero-stat-lbl">Jours</span><span class="fzd-hero-stat-val">${d}</span></div>
        <div class="fzd-hero-stat-sep" aria-hidden="true"></div>
        <div class="fzd-hero-stat"><span class="fzd-hero-stat-lbl">Heures</span><span class="fzd-hero-stat-val">${String(h).padStart(2, '0')}</span></div>`;
}

/* Les deux boutons de la bannière une fois le repêchage terminé : le
   récapitulatif en cartes (le même popup qu'à la fin du repêchage, ouvert
   ici sans quitter l'accueil) et, à côté, le classement. Le premier est un
   <button> et non un lien : il n'y a pas de page à ouvrir. */
function fzdCtasRepechageFini(activeName) {
    return `
        <div class="fzd-hero-ctas">
            <button type="button" class="fzd-hero-cta" data-fzd-recap>
                <span class="fzd-hero-cta-bar" aria-hidden="true"></span>
                <span class="fzd-hero-cta-label">Voir mes joueurs repêchés</span>
                <span class="fzd-hero-cta-chev" aria-hidden="true">›</span>
            </button>
            <a class="fzd-hero-cta fzd-hero-cta--ghost" href="classement.html?pool=${encodeURIComponent(activeName)}">
                <span class="fzd-hero-cta-bar" aria-hidden="true"></span>
                <span class="fzd-hero-cta-label">Classement</span>
                <span class="fzd-hero-cta-chev" aria-hidden="true">›</span>
            </a>
        </div>`;
}

function fzdHeroHTML(state, mobile = false) {
    if (mobile && state.mode === 'draft') return fzmDraftHeroHTML(state);
    if (mobile && state.mode === 'preseason') return fzmPreseasonHeroHTML(state);
    if (state.mode === 'draft') {
        const { poolData, team, activeName } = state;
        const draftOrder = Array.isArray(poolData.draftOrder) ? poolData.draftOrder : [];
        const numTeams = new Set(draftOrder).size || 1;
        const idx = poolData.currentPickIndex || 0;
        const round = Math.floor(idx / numTeams) + 1;
        const totalRounds = Math.max(round, Math.round(draftOrder.length / numTeams) || round);
        const started = Number(poolData.turnStartedAt) || 0;
        const elapsed = started ? fzdFormatElapsed(Date.now() - started) : '—';

        let away = -1;
        for (let i = idx; i < draftOrder.length; i++) {
            if (draftOrder[i] === team.name) { away = i - idx; break; }
        }
        const eyebrow = away === 0 ? "C'est votre tour"
            : away > 0 ? `Votre tour dans ${away} choix`
            : 'Repêchage en cours';

        return `
            <span class="fzd-hero-shield" aria-hidden="true">F</span>
            <div class="fzd-hero-copy">
                <div class="fzd-hero-eyebrow">${escapeHTML(eyebrow)}</div>
                <h2 class="fzd-hero-headline">Repêchage en cours</h2>
            </div>
            <div class="fzd-hero-stats">
                <div class="fzd-hero-stat"><span class="fzd-hero-stat-lbl">Ronde</span><span class="fzd-hero-stat-val">${round} / ${totalRounds}</span></div>
                <div class="fzd-hero-stat-sep" aria-hidden="true"></div>
                <div class="fzd-hero-stat"><span class="fzd-hero-stat-lbl">Attente</span><span class="fzd-hero-stat-val fzd-hero-elapsed">${elapsed}</span></div>
            </div>
            <a class="fzd-hero-cta" href="draftActif.html?pool=${encodeURIComponent(activeName)}">
                <span class="fzd-hero-cta-bar" aria-hidden="true"></span>
                <span class="fzd-hero-cta-label">Aller au repêchage</span>
                <span class="fzd-hero-cta-chev" aria-hidden="true">›</span>
            </a>`;
    }

    if (state.mode === 'preseason') {
        // Repêchage terminé : le décompte reste, mais l'action utile n'est
        // plus la gestion d'équipe — c'est de revoir qui on vient de repêcher.
        const fait = state.draftDone && state.activeName && state.teamName;
        return `
            <span class="fzd-hero-shield" aria-hidden="true">F</span>
            <div class="fzd-hero-copy">
                <div class="fzd-hero-eyebrow">${fait ? `Repêchage terminé · ${escapeHTML(fzdLibelleSaison(state.target))}` : escapeHTML(fzdPrecisionCamp(state))}</div>
                <h2 class="fzd-hero-headline">${fait ? 'Votre équipe est au complet' : escapeHTML(fzdLibelleSaison(state.target))}</h2>
            </div>
            <div class="fzd-hero-stats">${fzdCountdownStatsHTML(state.target)}</div>
            ${fait ? fzdCtasRepechageFini(state.activeName) : `
            <button type="button" class="fzd-hero-cta" data-fz-reglages="equipes">
                <span class="fzd-hero-cta-bar" aria-hidden="true"></span>
                <span class="fzd-hero-cta-label">Voir les participants</span>
                <span class="fzd-hero-cta-chev" aria-hidden="true">›</span>
            </button>`}`;
    }

    // Duel de la semaine — pools tête-à-tête, une fois le repêchage bouclé.
    // Le décompte vise le COUP D'ENVOI du prochain duel ; quand la saison
    // n'en a plus, il vise la fin de celui qui se joue.
    if (state.mode === 'h2hduel') {
        const { enCours, suivant } = state.duel;
        const eyebrow = enCours
            ? `Duel en cours contre ${enCours.adversaire}`
            : `Semaine ${suivant.semaine} · à venir`;
        const headline = suivant
            ? `Prochain duel contre ${suivant.adversaire}`
            : `Duel en cours contre ${enCours.adversaire}`;
        const cible = suivant ? suivant.debut : enCours.fin;

        return `
            <span class="fzd-hero-shield" aria-hidden="true">F</span>
            <div class="fzd-hero-copy">
                <div class="fzd-hero-eyebrow">${escapeHTML(eyebrow)}</div>
                <h2 class="fzd-hero-headline">${escapeHTML(headline)}</h2>
            </div>
            <div class="fzd-hero-stats">${fzdDuelCountdownHTML(cible)}</div>
            <a class="fzd-hero-cta" href="classement.html?pool=${encodeURIComponent(state.activeName)}&h2h=calendrier">
                <span class="fzd-hero-cta-bar" aria-hidden="true"></span>
                <span class="fzd-hero-cta-label">Calendrier de la saison</span>
                <span class="fzd-hero-cta-chev" aria-hidden="true">›</span>
            </a>`;
    }

    if (state.mode === 'draftdone') {
        return `
            <span class="fzd-hero-shield" aria-hidden="true">F</span>
            <div class="fzd-hero-copy">
                <div class="fzd-hero-eyebrow">Repêchage terminé</div>
                <h2 class="fzd-hero-headline">Votre équipe est au complet</h2>
            </div>
            <div class="fzd-hero-stats">
                <div class="fzd-hero-stat"><span class="fzd-hero-stat-lbl">Choix</span><span class="fzd-hero-stat-val">${state.picks}</span></div>
            </div>
            ${fzdCtasRepechageFini(state.activeName)}`;
    }

    // 'live'
    return `
        <span class="fzd-hero-shield" aria-hidden="true">F</span>
        <div class="fzd-hero-copy">
            <div class="fzd-hero-eyebrow"><span class="fzd-hero-live-dot" aria-hidden="true"></span>En direct</div>
            <h2 class="fzd-hero-headline">${state.liveCount} de vos joueurs ${state.liveCount > 1 ? 'sont' : 'est'} sur la glace</h2>
        </div>
        <div class="fzd-hero-stats">
            <div class="fzd-hero-stat"><span class="fzd-hero-stat-lbl">Points</span><span class="fzd-hero-stat-val">${state.totalPts > 0 ? '+' : ''}${state.totalPts}</span></div>
            <div class="fzd-hero-stat-sep" aria-hidden="true"></div>
            <div class="fzd-hero-stat"><span class="fzd-hero-stat-lbl">En action</span><span class="fzd-hero-stat-val">${state.liveCount}</span></div>
        </div>
        <a class="fzd-hero-cta" href="#fzdPlayersList">
            <span class="fzd-hero-cta-bar" aria-hidden="true"></span>
            <span class="fzd-hero-cta-label">Voir les pointages</span>
            <span class="fzd-hero-cta-chev" aria-hidden="true">›</span>
        </a>`;
}

// Un minuteur par conteneur : bureau (#fzDashHero) et téléphone
// (#fzmHeroSlot, accueil-mobile.js) rendent chacun leur propre copie de la
// même bannière et tournent chacun leur propre intervalle, sinon rendre
// l'un arrêterait le tic-tac de l'autre.
const fzdHeroTimers = {};

function fzdStopHeroTimer(containerId) {
    if (fzdHeroTimers[containerId]) { clearInterval(fzdHeroTimers[containerId]); delete fzdHeroTimers[containerId]; }
}

/**
 * Rend la bannière d'état dans le conteneur donné. Appelée depuis
 * renderDash() pour #fzDashHero (bureau) et depuis renderMobileHome()
 * (accueil-mobile.js) pour #fzmHeroSlot — même état, même balisage, même
 * contenu des deux côtés ; seul accueil-dash.css les met en page
 * différemment selon la largeur d'écran.
 */
function renderHero(tonight, containerId = 'fzDashHero') {
    const container = document.getElementById(containerId);
    if (!container) return;
    fzdStopHeroTimer(containerId);

    const state = fzdHeroState(tonight);
    if (!state || state.mode === 'regular') {
        container.style.display = 'none';
        container.innerHTML = '';
        container.classList.remove('is-draft', 'is-myturn');
        return;
    }

    container.style.display = 'flex';
    container.dataset.mode = state.mode;
    container.innerHTML = fzdHeroHTML(state, containerId === 'fzmHeroSlot');

    // Bascule neutre → rouge de marque quand le tour devient le vôtre. La
    // lecture forcée du layout entre les deux classes garantit que le calque
    // rouge parte bien de sa position hors-champ : sans elle, le navigateur
    // fond les deux états en un seul calcul et le balayage ne joue pas.
    container.classList.toggle('is-draft', state.mode === 'draft');
    const myTurn = state.mode === 'draft' && !!state.myTurn;
    if (myTurn !== container.classList.contains('is-myturn')) void container.offsetWidth;
    container.classList.toggle('is-myturn', myTurn);

    // Avant-saison et duel de la semaine : un compte à rebours, rien qui
    // s'anime — un rendu complet à la seconde suffit. Un changement de mode
    // (le duel démarre, la saison s'ouvre) repasse par renderHero.
    if (state.mode === 'preseason' || state.mode === 'h2hduel') {
        fzdHeroTimers[containerId] = setInterval(() => {
            const fresh = fzdHeroState(tonight);
            if (!fresh || fresh.mode !== state.mode) { renderHero(tonight, containerId); return; }
            container.innerHTML = fzdHeroHTML(fresh, containerId === 'fzmHeroSlot');
        }, 1000);
        return;
    }

    // Repêchage : seule l'attente avance à la seconde, et on ne retouche que
    // ce texte-là. Reconstruire toute la bannière chaque seconde effaçait le
    // balayage rouge en pleine course. Un vrai changement — tour, choix,
    // mode — repasse par un rendu complet, animation comprise.
    if (state.mode === 'draft') {
        const signature = `${state.pick}|${myTurn ? 1 : 0}`;
        fzdHeroTimers[containerId] = setInterval(() => {
            const fresh = fzdHeroState(tonight);
            if (!fresh || fresh.mode !== 'draft'
                || `${fresh.pick}|${fresh.myTurn ? 1 : 0}` !== signature) {
                renderHero(tonight, containerId);
                return;
            }
            const el = container.querySelector('.fzd-hero-elapsed');
            if (!el) return;
            const started = Number(fresh.poolData.turnStartedAt) || 0;
            const format = containerId === 'fzmHeroSlot' ? fzmElapsedClock : fzdFormatElapsed;
            el.textContent = started ? format(Date.now() - started) : '—';
        }, 1000);
    }
}

// Photo d'un joueur par son nom : picksHistory ne garde que le nom, sans
// identifiant pour viser le CDN de la LNH directement. On la retrouve dans
// les stats déjà chargées (userData.statsData, voir loadCurrentStats dans
// accueil.js). Index construit une fois, reconstruit si la liste change.
const fzdHeadshotByName = (() => {
    let map = null;
    return name => {
        if (!name) return '';
        const players = (typeof userData !== 'undefined' && userData.statsData && userData.statsData.players) || null;
        if (!players) return '';
        if (!map || map._n !== players.length) {
            map = { _n: players.length };
            players.forEach(p => { if (p.playerName) map[p.playerName.trim().toLowerCase()] = p.headshot || ''; });
        }
        return map[name.trim().toLowerCase()] || '';
    };
})();


// ============================================================
// MES POOLS — every pool the user is in, same ranking data
// buildTeamScores already computes for classement.html parity.
// ============================================================
function renderMyPoolsList() {
    const container = document.getElementById('fzdMyPoolsList');
    const countEl = document.getElementById('fzdMyPoolsCount');
    const seeAll = document.getElementById('fzdMyPoolsSeeAll');
    if (!container) return;

    const pools = userData.userPools || [];
    if (countEl) countEl.textContent = pools.length ? `${pools.length} au total` : '';
    if (seeAll) seeAll.textContent = pools.length > 1 ? `Voir les ${pools.length} pools →` : (pools.length === 1 ? 'Voir mon pool →' : '');

    if (!pools.length) {
        container.innerHTML = `<p class="fzd-players-empty">Vous n'êtes dans aucun pool.</p>`;
        return;
    }

    container.innerHTML = pools.slice(0, 3).map(pool => {
        const scores = buildTeamScores(pool);
        const claimed = scores.filter(t => t.memberCount > 0);
        const list = claimed.length ? claimed : scores;
        const idx = list.findIndex(t => t.isCurrentUser);
        const mine = idx >= 0 ? list[idx] : null;
        const trendCls = mine ? (mine.trend === 'up' ? 'fzd-pool-trend-up' : mine.trend === 'down' ? 'fzd-pool-trend-down' : 'fzd-pool-trend-flat') : 'fzd-pool-trend-flat';
        const trendGlyph = mine ? (mine.trend === 'up' ? '▲' : mine.trend === 'down' ? '▼' : '–') : '–';

        return `
            <div class="fzd-pool-row">
                <div class="fzd-pool-icon"></div>
                <div class="fzd-pool-id">
                    <div class="fzd-pool-name">${escapeHTML(pool.name)}</div>
                    <div class="fzd-pool-meta">${mine ? Math.round(mine.score) : 0} pts<span class="fzd-pool-sep"> · </span><span class="${trendCls}">${trendGlyph}</span></div>
                </div>
                <div class="fzd-pool-rank">
                    <div class="fzd-pool-rank-num fzd-display">${idx >= 0 ? idx + 1 : '—'}</div>
                    <div class="fzd-pool-rank-total fzd-display">/${list.length}</div>
                </div>
            </div>`;
    }).join('');
}

// ============================================================
// ACTIVITÉ DE LA LIGUE — real completed trades only (see the plan:
// this app has no waiver-claim feature and no timestamped join log,
// so those mockup item types are dropped rather than invented).
// ============================================================
async function renderActivityFeed() {
    const container = document.getElementById('fzdActivityList');
    const activeName = FZPool.get();
    if (!container || !activeName) return;

    try {
        const res = await fetch(`${BASE_URL}/trades/${encodeURIComponent(activeName)}`, { cache: 'no-store' });
        const trades = res.ok ? await res.json() : [];

        if (!trades.length) {
            container.innerHTML = `<p class="fzd-activity-empty">Aucun échange complété dans ce pool.</p>`;
            return;
        }

        container.innerHTML = trades.slice(0, 8).map(trade => {
            const offering = trade.offering && trade.offering[0];
            const receiving = trade.receiving && trade.receiving[0];
            const dateRaw = trade.completedDate || trade.date;
            const timeLabel = dateRaw ? relativeTimeFr(dateRaw) : '';
            const text = offering && receiving
                ? `Échange complété : <strong>${escapeHTML(offering.name)}</strong> ↔ <strong>${escapeHTML(receiving.name)}</strong> (${escapeHTML(trade.fromTeam)} ⇄ ${escapeHTML(trade.toTeam)}).`
                : `Échange complété entre <strong>${escapeHTML(trade.fromTeam)}</strong> et <strong>${escapeHTML(trade.toTeam)}</strong>.`;
            return `<div class="fzd-activity-row"><div class="fzd-activity-time fzd-display">${timeLabel}</div><div class="fzd-activity-text">${text}</div></div>`;
        }).join('');
    } catch (err) {
        console.warn('Could not load activity feed:', err);
        container.innerHTML = `<p class="fzd-activity-empty">Impossible de charger l'activité.</p>`;
    }
}

// ============================================================
// HORS-SAISON — countdown to camp/season start plus real trade &
// signing headlines. Shown under the calendar only while the coming
// regular season hasn't started (see renderOffseasonPanel); computed
// from the same /schedule/:date response that already backs the
// calendar, which the NHL API keeps pointed at the *next* season's
// dates throughout the off-season (verified: it flips over the day
// after playoffEndDate, so this never fires mid-playoffs).
// ============================================================

// « À surveiller » : la section « Joueurs à Surveiller » des 32 pages
// d'équipe de la Trousse de repêchage 2026-2027, telle quelle. Ce n'est ni
// une liste devinée ni un flux d'API — c'est le texte du document, mis à
// plat par tools/build_draftkit.js dans draftkit.json. Reste vide (section
// masquée) si le fichier ne charge pas.
let OFFSEASON_WATCHLIST = [];

async function loadOffseasonWatchlist() {
    if (typeof FZDraftKit === 'undefined') return;
    try {
        OFFSEASON_WATCHLIST = await FZDraftKit.chargerWatchlist();
    } catch (err) {
        console.warn('⚠️ Trousse de repêchage indisponible :', err);
    }
}

let offseasonNewsLoaded = false;

function renderOffseasonPanel() {
    const panel = document.getElementById('fzDashOffseason');
    if (!panel || !calData) return;

    const today = todayISO();
    const seasonStart = calData.regularSeasonStartDate;
    const hasPool = !!FZPool.get();

    fzdApplyPreseasonLayout(hasPool);

    const horsSaison = !!seasonStart && today < seasonStart;

    // Les trois blocs partagés se remplissent d'abord : ils vivent peut-être
    // déjà dans l'accueil de repêchage, de saison ou du téléphone, où ce
    // panneau-ci n'a plus son mot à dire sur ce qui s'affiche.
    fzdRendreHorsSaison(horsSaison);
    fzdRendreSurveiller();
    fzdRendreMouvements();

    // Sans pool, la LNH est tout ce que cet accueil a à montrer : les
    // mouvements récents et la liste « À surveiller » restent donc à
    // l'écran même une fois la saison commencée. Seul le résumé du haut
    // s'en va — un compte à rebours sans cible et une position sans pool
    // n'ont rien à dire.
    if (!horsSaison && hasPool) {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = '';
    // .fzd-off-summary est une grille : l'attribut `hidden` ne l'emporterait
    // pas sur son propre display.
    panel.querySelector('.fzd-off-summary').style.display = horsSaison ? '' : 'none';

    if (horsSaison) renderOffseasonPosition();
}

/**
 * Le compte à rebours hors-saison — le même bloc sur tous les accueils.
 * Il se retire de lui-même une fois la saison commencée : un décompte sans
 * cible n'a rien à dire, et il n'est plus forcément dans #fzDashOffseason
 * pour disparaître avec lui.
 */
function fzdRendreHorsSaison(horsSaison) {
    const bloc = document.getElementById('fzdOffCount');
    if (!bloc) return;
    bloc.hidden = !horsSaison;
    if (!horsSaison) return;

    const today = todayISO();
    const campStart = calData.preSeasonStartDate;
    const beforeCamp = !!campStart && today < campStart;
    const target = calData.regularSeasonStartDate;
    const days = fzdJoursAvant(target);

    // « Hors-saison » ne disait pas combien de temps : le titre annonce
    // maintenant l'échéance elle-même.
    const titre = document.getElementById('fzdOffTitle');
    const texte = titre && titre.querySelector('[data-fzd-off-title]');
    if (texte) texte.textContent = fzdLibelleSaison(target);
    document.getElementById('fzdOffDays').textContent = `${days} j`;
    document.getElementById('fzdOffSub').textContent = fzdPrecisionCamp({ beforeCamp, campStart });
}

/** Jours pleins d'ici une date ISO (0 le jour même). */
function fzdJoursAvant(dateISO) {
    if (!dateISO) return 0;
    return Math.max(0, Math.ceil((new Date(dateISO + 'T00:00:00Z') - new Date(todayISO() + 'T00:00:00Z')) / 86400000));
}

/** « Saison régulière dans 5 jours », « … demain », « … aujourd'hui ». */
function fzdLibelleSaison(dateISO) {
    if (!dateISO) return 'Saison régulière bientôt';
    const n = fzdJoursAvant(dateISO);
    if (n === 0) return 'Saison régulière aujourd’hui';
    if (n === 1) return 'Saison régulière demain';
    return `Saison régulière dans ${n} jours`;
}

/** La précision du camp, sous le décompte de la saison. */
function fzdPrecisionCamp(state) {
    if (state && state.beforeCamp && state.campStart) {
        const n = fzdJoursAvant(state.campStart);
        return n <= 1 ? 'Camp d’entraînement ' + (n === 0 ? 'aujourd’hui' : 'demain')
                      : `Camp d’entraînement dans ${n} jours`;
    }
    return 'Matchs préparatoires en cours';
}

/**
 * « À surveiller » — le panneau de la home de repêchage (accueil-watch.js),
 * désormais le seul. Son balisage n'est posé qu'une fois : le nœud survit
 * aux changements d'accueil, donc la piste garde son filtre et sa position.
 */
function fzdRendreSurveiller() {
    const panel = document.getElementById('fzdOffWatch');
    if (!panel) return;
    // Avant et pendant le repêchage : les joueurs à surveiller. Après : la
    // vie de la ligue (accueil-watch.js, fzhRenderLigue) — une liste d'espoirs
    // n'aide plus personne une fois les choix faits.
    const vue = (typeof fzhRepechageFini === 'function' && fzhRepechageFini()) ? 'ligue' : 'watch';
    if (panel.dataset.vue !== vue || !panel.firstElementChild) {
        panel.innerHTML = vue === 'ligue' ? fzhLigueHTML() : fzhWatchHTML();
        panel.dataset.vue = vue;
    }
    if (vue === 'ligue') fzhRenderLigue(panel);
    else fzhRenderWatch(panel);
}

/**
 * « Mouvements récents ». Le journal n'est demandé qu'une fois par visite ;
 * ensuite le nœud est déjà rempli et seuls les points du carrousel sont à
 * recompter — il vient de changer de place, donc de largeur.
 */
function fzdRendreMouvements() {
    if (!offseasonNewsLoaded) {
        offseasonNewsLoaded = true;
        loadOffseasonTransactions();
        return;
    }
    renderOffseasonDots();
}

function renderOffseasonPosition() {
    const value = document.getElementById('fzdPositionValue');
    const link = document.getElementById('fzdPositionLink');
    if (!value || !link) return;
    const name = FZPool.get();
    const pool = FZPool.data();
    const ready = name && pool && FZPool.draftState(pool).etat === 'termine';
    const scores = ready ? buildTeamScores({ allTeams: pool.teams }).filter(t => t.memberCount > 0) : [];
    const index = scores.findIndex(t => t.isCurrentUser);
    const started = calData?.regularSeasonStartDate && todayISO() >= calData.regularSeasonStartDate;
    value.textContent = started && index >= 0 ? `${index + 1} / ${scores.length}` : '— / —';
    // Tant que le repêchage n'est pas bouclé, le classement refuse d'ouvrir
    // (activePool.js) : le lien mène alors là où la position se joue encore.
    link.href = ready ? `classement.html?pool=${encodeURIComponent(name)}` : 'repechage.html';
    link.textContent = ready ? 'Voir le classement →' : 'Voir le repêchage →';
    document.getElementById('fzdPositionSub').textContent = 'Classement général';
}

// Mouvements réels déduits des alignements officiels côté serveur
// (/nhl-transactions) plutôt que titres de presse : le journal nomme le
// joueur, les deux clubs et la date en clair, là où un titre NewsAPI
// laissait au lecteur le soin de décoder la phrase — et attrape les
// mouvements discrets dont aucun média ne parle. Les blessés viennent
// d'ESPN (/nhl-injuries), api-web n'en publiant aucun.
let offseasonLeague = null;
let offseasonTab = 'all';
const OFFSEASON_TABS = ['all', 'trade', 'signing', 'injury'];
const OFFSEASON_TAB_LABELS = { all: 'Tout', trade: 'Échanges', signing: 'Signatures', injury: 'Blessés' };
let offseasonCarouselBound = false;

async function loadOffseasonTransactions() {
    const wrap = document.getElementById('fzdOffTransactions');
    if (!wrap) return;

    // On demande tout le journal (TRANSACTIONS_KEEP=250, cap blessés=300) :
    // le carrousel montre chaque onglet en entier, donc chaque liste doit
    // être complète en main — et groupTrades voit ainsi tout l'échange,
    // pas une moitié tronquée par la fenêtre.
    const [tx, inj] = await Promise.all([
        fetch('/nhl-transactions?limit=250').then(r => r.json()).catch(() => null),
        fetch('/nhl-injuries?limit=300').then(r => r.json()).catch(() => null)
    ]);

    const moves = tx?.transactions || [];
    const deals = groupTrades(moves.filter(t => t.type === 'trade'));
    const signings = moves.filter(t => t.type === 'signing');
    const injuries = inj?.injuries || [];

    // « Tout » : les trois flux fondus et retriés du plus récent au plus
    // ancien. Chaque entrée garde sa forme d'origine, `kind` dit quelle
    // carte rendre. Échange → date jour ; signature → date jour ; blessé →
    // `since` (date de déclaration ESPN).
    const stamp = iso => (iso ? new Date(iso).getTime() : 0) || 0;
    const all = [
        ...deals.map(d => ({ kind: 'trade', item: d, ts: stamp(d.date) })),
        ...signings.map(s => ({ kind: 'signing', item: s, ts: stamp(s.date) })),
        ...injuries.map(i => ({ kind: 'injury', item: i, ts: stamp(i.since) }))
    ].sort((a, b) => b.ts - a.ts);

    offseasonLeague = {
        all,
        trade: deals,
        signing: signings,
        injury: injuries,
        counts: {
            // Échanges : un décompte d'opérations (après regroupement). Pour
            // signatures/blessés, le total serveur (peut dépasser la fenêtre
            // demandée). « Tout » : la somme des trois.
            trade: deals.length,
            signing: tx?.counts?.signing || 0,
            injury: inj?.total || 0
        },
        tracking: !!tx?.tracking
    };
    offseasonLeague.counts.all = offseasonLeague.counts.trade
        + offseasonLeague.counts.signing + offseasonLeague.counts.injury;

    // Ouvrir sur un onglet qui a de quoi montrer plutôt que sur un onglet
    // vide un lendemain de journée calme.
    const firstFilled = OFFSEASON_TABS.find(k => offseasonLeague[k].length);
    if (firstFilled && !offseasonLeague[offseasonTab].length) offseasonTab = firstFilled;

    renderOffseasonFilters();
    if (!offseasonCarouselBound) { offseasonCarouselBound = true; bindOffseasonCarousel(); }
    renderOffseasonLeague();
}

// Barre de filtres « Tout / Échanges / Signatures / Blessés » avec compteur,
// re-rendue à chaque changement d'onglet pour l'état actif et les nombres.
function renderOffseasonFilters() {
    const bar = document.getElementById('fzdOffTabs');
    if (!bar || !offseasonLeague) return;
    bar.innerHTML = OFFSEASON_TABS.map(k => {
        const n = offseasonLeague.counts[k] || 0;
        return `<button type="button" class="fzd-off-filter${k === offseasonTab ? ' is-active' : ''}" data-tab="${k}" aria-pressed="${k === offseasonTab}">`
            + `${OFFSEASON_TAB_LABELS[k]}<span class="fzd-off-filter-count">${n}</span></button>`;
    }).join('');
    bar.querySelectorAll('.fzd-off-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab === offseasonTab) return;
            offseasonTab = btn.dataset.tab;
            renderOffseasonFilters();
            renderOffseasonLeague();
        });
    });
}

// Flèches précédent/suivant + points de progression du carrousel. Câblé une
// seule fois (garde offseasonCarouselBound) : le contenu de la piste change,
// pas ses contrôles.
function renderOffseasonLeague() {
    const track = document.getElementById('fzdOffTransactions');
    if (!track || !offseasonLeague) return;

    const rows = offseasonLeague[offseasonTab] || [];
    if (!rows.length) {
        track.classList.add('is-empty');
        track.innerHTML = `<p class="fzd-off-empty">${offseasonEmptyText()}</p>`;
        renderOffseasonDots();
        return;
    }

    track.classList.remove('is-empty');
    track.innerHTML = rows.map(row => offseasonTab === 'all'
        ? offseasonCardHTML(row.kind, row.item)
        : offseasonCardHTML(offseasonTab, row)).join('');
    track.scrollLeft = 0;
    renderOffseasonDots();
}

// Points de progression — un par « page » de défilement (largeur de piste),
// pas un par carte : une centaine de blessés donnerait une centaine de points.
// Regroupe les lignes-joueur d'un même échange (même date + même paire de
// clubs) en une seule opération à deux côtés — « X ⇄ Y : X reçoit…, Y
// reçoit… ». Une opération à trois clubs se scinde en paires, comme sur
// NHL.com. L'ordre d'arrivée (déjà trié du plus récent au plus ancien par
// le serveur) est préservé.
function groupTrades(list) {
    const deals = new Map();
    (list || []).forEach(t => {
        const to = t.toTeam || '?';
        const from = t.fromTeam || '?';
        const [a, b] = [from, to].sort();
        const key = `${t.date}|${a}-${b}`;
        let d = deals.get(key);
        if (!d) { d = { date: t.date, teamA: a, teamB: b, gets: {}, names: {} }; deals.set(key, d); }
        // L'abréviation reste la clé (et la source du logo) ; le nom complet
        // sert d'en-tête de colonne, la carte ayant désormais la place de
        // l'écrire.
        if (t.toTeamName) d.names[to] = t.toTeamName;
        if (t.fromTeamName) d.names[from] = t.fromTeamName;
        (d.gets[to] = d.gets[to] || []).push({ name: t.playerName, pos: t.pos || '' });
    });
    return [...deals.values()];
}

// Une carte de carrousel selon le type de mouvement. `kind` vient soit de
// l'onglet actif, soit de l'entrée fondue de l'onglet « Tout ».
function offseasonCardHTML(kind, item) {
    if (kind === 'trade') return offDealCardHTML(item);
    if (kind === 'signing') return offSigningCardHTML(item);
    return offInjuryCardHTML(item);
}

// Échange : les deux clubs empilés, ce que chacun reçoit dessous, séparés
// par un filet — même lecture qu'avant (dealRowHTML), repliée dans une
// carte de largeur fixe. Le club qui reçoit quelque chose passe en tête :
// sur un échange à sens unique, « Rien en retour » finit en bas.
function offDealCardHTML(d) {
    const sideHTML = team => {
        const club = d.names[team] || team;
        const players = d.gets[team] || [];
        const gets = players.length
            ? players.map(p => `<li class="fzd-off-deal-get">${escapeHTML(p.name)}`
                + `${p.pos ? ` <span class="fzd-off-pos">${escapeHTML(p.pos)}</span>` : ''}</li>`).join('')
            : '<li class="fzd-off-deal-get is-empty">Rien en retour</li>';
        return `
            <div class="fzd-off-deal-side">
                <div class="fzd-off-deal-club">
                    ${teamLogoImg(team)}
                    <span class="fzd-off-deal-club-name">${escapeHTML(club)}</span>
                    <span class="fzd-off-deal-acq">Acquiert</span>
                </div>
                <ul class="fzd-off-deal-gets">${gets}</ul>
            </div>`;
    };
    const [first, second] = [d.teamA, d.teamB]
        .sort((x, y) => (d.gets[y]?.length || 0) - (d.gets[x]?.length || 0));
    return `
        <article class="fzd-off-card is-trade">
            <div class="fzd-off-card-top">
                <span class="fzd-off-tag is-trade">Échange</span>
                <span class="fzd-off-card-date">${dayLabelFr(d.date)}</span>
            </div>
            <div class="fzd-off-deal">
                ${sideHTML(first)}
                <div class="fzd-off-deal-rule" aria-hidden="true"></div>
                ${sideHTML(second)}
            </div>
        </article>`;
}

function offSigningCardHTML(t) {
    const club = [t.toTeamName || t.toTeam || '?', t.pos].filter(Boolean).join(' · ');
    return `
        <article class="fzd-off-card is-signing">
            <div class="fzd-off-card-top">
                <span class="fzd-off-tag is-signing">Signature</span>
                <span class="fzd-off-card-date">${dayLabelFr(t.date)}</span>
            </div>
            <div class="fzd-off-player">
                ${offPlayerFaceHTML(t.playerName, t.toTeam, t.playerId)}
                <div class="fzd-off-player-info">
                    <div class="fzd-off-card-name fzd-display">${escapeHTML(t.playerName)}</div>
                    <div class="fzd-off-card-club">${escapeHTML(club)}</div>
                </div>
            </div>
        </article>`;
}

function offInjuryCardHTML(i) {
    const club = [i.teamName || i.team, i.pos].filter(Boolean).join(' · ');
    const detail = [i.injuryType, i.injuryDetail].filter(Boolean).join(' / ');
    const back = i.returnDate ? dayLabelFr(i.returnDate) : (i.statusFr || '—');
    return `
        <article class="fzd-off-card is-injury">
            <div class="fzd-off-card-top">
                <span class="fzd-off-tag is-injury">Blessé</span>
                <span class="fzd-off-card-date">${dayLabelFr(i.since)}</span>
            </div>
            <div class="fzd-off-player">
                ${offPlayerFaceHTML(i.playerName, i.team, i.playerId, i.headshot)}
                <div class="fzd-off-player-info">
                    <div class="fzd-off-card-name fzd-display">${escapeHTML(i.playerName)}</div>
                    <div class="fzd-off-card-club">${escapeHTML(club)}</div>
                </div>
            </div>
            <div class="fzd-off-card-stats">
                <div class="fzd-off-stat">
                    <span class="fzd-off-stat-lbl">Blessure</span>
                    <span class="fzd-off-stat-val" data-status="${escapeHTML(i.status || '')}">${escapeHTML(detail || i.statusFr || '—')}</span>
                </div>
                <div class="fzd-off-stat">
                    <span class="fzd-off-stat-lbl">Retour</span>
                    <span class="fzd-off-stat-val">${escapeHTML(back)}</span>
                </div>
            </div>
        </article>`;
}

function offseasonEmptyText() {
    if (offseasonTab === 'injury') return 'Aucun blessé signalé.';
    // Tant que le serveur n'a pas deux photos d'alignements à comparer, il n'a
    // rien à dire — ce qui n'est pas la même chose qu'une ligue tranquille.
    if (!offseasonLeague?.tracking) return 'Le suivi des mouvements démarre à la prochaine mise à jour des alignements.';
    if (offseasonTab === 'trade') return 'Aucun échange récent.';
    if (offseasonTab === 'signing') return 'Aucune signature récente.';
    return 'Aucun mouvement récent.';
}

/* Les 70 entrées « Joueurs à Surveiller » des 32 équipes, dans l'ordre du
   document (OFFSEASON_WATCHLIST). Le panneau lui-même vit dans
   accueil-watch.js : ces favoris sont la seule part que le tableau de bord
   garde, parce qu'ils sont propres au membre et non à la trousse. */
const offWatchFavorites = new Map();
let offWatchFavoritesUser = null;

function offPlayerFaceHTML(name, team, playerId, headshot) {
    const stats = getPlayerStats(name);
    const id = playerId || stats?.playerId;
    const season = typeof currentSeasonString === 'function' ? currentSeasonString() : null;
    const fallback = id && season && team
        ? `https://assets.nhle.com/mugs/nhl/${season}/${encodeURIComponent(team)}/${encodeURIComponent(id)}.png`
        : id ? `https://assets.web.nhl.com/mugs/nhl/latest/${encodeURIComponent(id)}.png` : '';
    const src = headshot || fzdHeadshotByName(name) || fallback;
    return `<span class="fzd-off-face">${escapeHTML((name || '?').charAt(0))}${src
        ? `<img src="${escapeHTML(src)}" alt="" loading="lazy" onerror="this.remove()">`
        : team ? `<img src="teams/${escapeHTML(team)}.png" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
}

function offWatchStorageKey() {
    return `fz-watch-favorites:${userData.username || 'guest'}`;
}

function loadOffWatchFavorites() {
    const key = offWatchStorageKey();
    if (offWatchFavoritesUser === key) return;
    offWatchFavoritesUser = key;
    offWatchFavorites.clear();
    try {
        const saved = JSON.parse(localStorage.getItem(key) || '[]');
        if (Array.isArray(saved)) saved.forEach(entry => {
            if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
                offWatchFavorites.set(entry[0], entry[1]);
            }
        });
    } catch (_) { /* Favorites remain available in memory if storage is unavailable. */ }
}

// ============================================================
// ACTUALITÉS LNH — accueil sans pool (#fzDashNews). Même flux que le
// bandeau d'histoires du membre (GET /nhl-news via fetchNhlNews,
// accueil.js), qui lui reste masqué tant qu'aucun pool n'est actif.
// Feuilleté à la main : sur cet écran rien d'autre ne bouge tout seul,
// un défilement automatique y volerait le regard. Une seule requête par
// visite — le journal ne bouge pas à la minute.
// ============================================================
let dashNews = null;
let dashNewsIndex = 0;

async function renderDashNews() {
    const panel = document.getElementById('fzDashNews');
    if (!panel) return;
    if (!dashNews) dashNews = (await fetchNhlNews()).slice(0, 5);
    // Jamais de carte creuse : sans article, la section disparaît plutôt
    // que d'annoncer une actualité qui n'existe pas.
    if (!dashNews.length) { panel.style.display = 'none'; return; }
    panel.style.display = '';
    // renderDash() repasse à chaque rafraîchissement de FZPool : la carte
    // n'est redessinée que la première fois, sinon elle sauterait à la
    // figure du lecteur en plein article.
    if (!panel.firstElementChild) drawDashNews();
}

function drawDashNews() {
    const panel = document.getElementById('fzDashNews');
    if (!panel || !dashNews || !dashNews.length) return;

    dashNewsIndex = (dashNewsIndex + dashNews.length) % dashNews.length;
    const a = dashNews[dashNewsIndex];
    const multiple = dashNews.length > 1;

    panel.innerHTML = `
        <div class="fzd-news-head">
            <h2 class="fzd-section-title" id="fzdNewsTitle">${getIcon('scroll', 16)}Actualités LNH</h2>
            ${multiple ? `<div class="fzd-off-nav">
                <button type="button" class="fzd-off-nav-btn" data-news-step="-1" aria-label="Actualité précédente">‹</button>
                <button type="button" class="fzd-off-nav-btn" data-news-step="1" aria-label="Actualité suivante">›</button>
            </div>` : ''}
        </div>
        <article class="fzd-news-card${a.image ? '' : ' is-flat'}">
            ${a.image ? `<img class="fzd-news-image" src="${escapeHTML(a.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
            <div class="fzd-news-copy">
                <span class="fzd-news-badge">${escapeHTML(a.source || 'LNH')}</span>
                <h3 class="fzd-news-title"><a href="${escapeHTML(a.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(a.title)}</a></h3>
                ${a.description ? `<p class="fzd-news-desc">${escapeHTML(a.description)}</p>` : ''}
                <small class="fzd-news-meta">${escapeHTML(a.source || 'LNH')}${a.publishedAt ? ` · ${escapeHTML(relativeTimeFr(a.publishedAt))}` : ''}</small>
            </div>
        </article>
        ${multiple ? `<div class="fzd-news-dots" role="tablist" aria-label="Actualités">${dashNews.map((_, i) =>
            `<button type="button" class="fzd-off-dot${i === dashNewsIndex ? ' is-active' : ''}" data-news-slide="${i}" aria-label="Actualité ${i + 1} sur ${dashNews.length}" aria-current="${i === dashNewsIndex ? 'true' : 'false'}"></button>`).join('')}</div>` : ''}`;

    panel.querySelectorAll('[data-news-step]').forEach(button => button.addEventListener('click', () => {
        dashNewsIndex += Number(button.dataset.newsStep);
        drawDashNews();
        // Le bouton vient d'être remplacé : on rend le focus à son remplaçant,
        // sinon feuilleter au clavier renvoie au début de la page.
        panel.querySelector(`[data-news-step="${button.dataset.newsStep}"]`)?.focus({ preventScroll: true });
    }));
    panel.querySelectorAll('[data-news-slide]').forEach(dot => dot.addEventListener('click', () => {
        dashNewsIndex = Number(dot.dataset.newsSlide);
        drawDashNews();
        panel.querySelector(`[data-news-slide="${dashNewsIndex}"]`)?.focus({ preventScroll: true });
    }));
}

// ============================================================
// ORCHESTRATION
// ============================================================
function bindCalendarControls() {
    document.getElementById('fzdCalPrev')?.addEventListener('click', calGoPrevWeek);
    document.getElementById('fzdCalNext')?.addEventListener('click', calGoNextWeek);
    document.getElementById('fzdMonthPrevBtn')?.addEventListener('click', monthPrev);
    document.getElementById('fzdMonthNextBtn')?.addEventListener('click', monthNext);

    document.getElementById('fzdCalGamesPrev')?.addEventListener('click', () => calGamesScroll(-1));
    document.getElementById('fzdCalGamesNext')?.addEventListener('click', () => calGamesScroll(1));
    document.getElementById('fzdCalGames')?.addEventListener('scroll', updateCalGameDots, { passive: true });

    // Le carrousel ne montre pas le même nombre de cartes par vue de part et
    // d'autre de 768px, et le calendrier ne vit pas au même endroit dans la
    // page : un redimensionnement doit donc recompter les puces, pas seulement
    // laisser la CSS faire.
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            fzdPlaceCalendar();
            renderCalGameDots();
            // Les cartes de but ne changent pas de largeur, mais la carte de
            // match si : une piste qui tenait entière peut désormais déborder,
            // et ses flèches doivent paraître sans attendre un nouveau rendu.
            document.querySelectorAll('.fzd-goals').forEach(majFlechesButs);
        }, 150);
    });
}

// ============================================================
// ÉTAT VIDE — les trois cartes « En attendant » (Canvas-9)
// ============================================================

/**
 * Déplie une section et amène le regard dessus.
 *
 * Les trois démos de #comment-ca-marche démarrent sur un IntersectionObserver
 * à seuil .2 (voir boucler() dans demos.js) : il ne se déclenche pas tant que
 * la section est en display:none, et se déclenche tout seul une fois qu'elle
 * entre dans le champ. Rien à relancer à la main ici.
 */
function toggleReveal(bouton, cible, ouvrir, classeOuverture) {
    if (!cible) return;
    if (classeOuverture) cible.classList.toggle(classeOuverture, ouvrir);
    else cible.style.display = ouvrir ? '' : 'none';
    bouton.setAttribute('aria-expanded', String(ouvrir));
    if (!ouvrir) return;
    // scrollIntoView est ignoré sur un élément encore masqué : on laisse la
    // mise en page se faire d'abord.
    requestAnimationFrame(() => {
        cible.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

function bindOnboardCards() {
    const how = document.getElementById('fzoHowCard');
    const hiw = document.getElementById('comment-ca-marche');
    how?.addEventListener('click', () => {
        toggleReveal(how, hiw, how.getAttribute('aria-expanded') !== 'true', 'fzo-revealed');
    });

    // Le calendrier, le hors-saison et les actualités sont désormais
    // déroulés d'office sans pool (renderDash) : ils ne tirent que sur
    // /schedule/:date, /nhl-transactions, /nhl-injuries et /nhl-news,
    // aucune donnée de pool. La carte n'a donc plus rien à ouvrir, elle
    // amène le regard.
    const calBtn = document.getElementById('fzoCalCard');
    const calWrap = document.getElementById('fzDashCalendarWrap');
    calBtn?.addEventListener('click', () => {
        calWrap?.scrollIntoView({ behavior: offseasonScrollBehavior(), block: 'start' });
    });

    loadOpenPoolsCount();
}

/**
 * « Ligues ouvertes » : le nombre de pools encore rejoignables.
 *
 * La maquette affiche « 14 pools » en dur ; on compte les vrais, à la même
 * source que rejoindre-pool.html (GET /draft, filtré par loadClans/updateUI).
 * En cas d'échec la carte garde sa phrase générique — pas de chiffre inventé.
 */
async function loadOpenPoolsCount() {
    const cible = document.getElementById('fzoOpenPools');
    if (!cible) return;
    try {
        const res = await fetch(`${BASE_URL}/draft?timestamp=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const clans = await res.json();
        const moi = localStorage.getItem('username');
        const ouverts = Object.entries(clans || {}).filter(([nom, clan]) => {
            const equipes = Object.values(clan?.teams || {});
            if (!equipes.length) return false;
            // Les files de repêchage instantané ne se comptent pas parmi les
            // ligues ouvertes : elles ne se parcourent pas, elles se
            // rejoignent d'un bouton. Même exclusion que updateUI().
            if (window.FZInstant
                ? window.FZInstant.estPoolInstantane(nom, clan)
                : clan.instant) return false;
            // Déjà membre, ou repêchage commencé : plus rejoignable.
            if (equipes.some(e => (e.members || []).includes(moi))) return false;
            return !clan.draftStarted;
        }).length;
        if (!ouverts) {
            cible.textContent = 'Aucune ligue ouverte pour le moment.';
            return;
        }
        cible.textContent = ouverts === 1
            ? '1 pool cherche des joueurs cette semaine.'
            : `${ouverts} pools cherchent des joueurs cette semaine.`;
    } catch (err) {
        console.warn('Could not count open pools:', err);
    }
}

// Avant le coup d'envoi de la saison régulière, le corps du tableau de
// bord (match du soir, joueurs, mes pools, activité) n'a rien de réel à
// montrer : on le retire et on pose à sa place trois raccourcis pools
// entre le calendrier et le panneau hors-saison. Tant que le calendrier
// n'est pas revenu, la date de début est inconnue — on n'affiche alors
// ni l'un ni l'autre plutôt que de faire clignoter le mauvais.
function fzdSeasonStarted() {
    if (!calData) return null;
    const start = calData.regularSeasonStartDate;
    return !start || todayISO() >= start;
}

function fzdApplyPreseasonLayout(hasPool) {
    const started = fzdSeasonStarted();
    const body = document.getElementById('fzDashBody');
    const chips = document.getElementById('fzDashPoolChips');
    if (body) body.style.display = (hasPool && started === true) ? '' : 'none';
    if (chips) chips.style.display = (hasPool && started === false) ? '' : 'none';
}

/**
 * La disposition de l'accueil est choisie : la page peut se montrer.
 *
 * Un membre charge l'accueil en `html.fz-home-pending` (posé dans le <head>
 * d'index.html) : le repêchage et la saison remplacent le tableau de bord
 * par défaut, mais seulement une fois leurs données arrivées. Sans cette
 * attente, le tableau de bord par défaut — et le bandeau d'histoires —
 * s'affichaient une seconde avant d'être remplacés.
 */
function fzdRevelerAccueil() {
    document.documentElement.classList.remove('fz-home-pending');
}

/**
 * Les polices des dispositions de l'accueil, demandées dès le démarrage.
 *
 * Le navigateur ne télécharge une police qu'au premier texte affiché qui
 * s'en sert. Masqué pendant l'attente, l'accueil ne les demandait qu'en se
 * montrant : il s'affichait dans la police de repli, puis changeait de
 * police — et de hauteur — sous les yeux. Barlow Condensed et Oswald
 * portent les homes repêchage et saison ; Archivo, la home téléphone.
 */
const FZD_POLICES = [
    "400 16px 'Barlow Condensed'", "600 16px 'Barlow Condensed'", "700 16px 'Barlow Condensed'",
    "500 16px 'Oswald'", "400 16px 'Barlow'", "700 16px 'Barlow'"
];
let fzdPolices = null;

function fzdChargerPolices() {
    if (fzdPolices) return fzdPolices;
    const liste = window.matchMedia('(max-width: 768px)').matches
        ? [...FZD_POLICES, "700 16px 'Archivo'"] : FZD_POLICES;
    fzdPolices = document.fonts
        ? Promise.all(liste.map(police => document.fonts.load(police).catch(() => null)))
        : Promise.resolve();
    return fzdPolices;
}

/** Attend les polices, jamais plus de `plafondMs` : sur un réseau lent, un
 *  changement de police vaut mieux qu'un accueil qui reste vide. */
function fzdPolicesPretes(plafondMs = 1200) {
    return Promise.race([fzdChargerPolices(), new Promise(r => setTimeout(r, plafondMs))]);
}

async function renderDash() {
    const section = document.getElementById('fzDashSection');
    const hero = document.getElementById('fzDashHero');
    const calWrap = document.getElementById('fzDashCalendarWrap');
    const onboard = document.getElementById('fzDashOnboard');
    const mobileHome = document.getElementById('fzMobileHome');
    const news = document.getElementById('fzDashNews');
    if (!section || !userData.username) { fzdRevelerAccueil(); return; }

    const hasPool = !!FZPool.get();
    section.style.display = 'block';
    // Lu par accueil-mobile.css : sur téléphone, la home mobile remplace le
    // calendrier — mais elle n'existe qu'avec un pool. Sans pool, la carte
    // « Calendrier LNH » de l'état vide doit pouvoir l'ouvrir.
    section.classList.toggle('is-poolless', !hasPool);
    fzdApplyPreseasonLayout(hasPool);
    if (!hasPool && hero) { fzdStopHeroTimer('fzDashHero'); hero.style.display = 'none'; hero.innerHTML = ''; }
    if (calWrap) calWrap.style.display = '';
    // .fz-mobile-home defaults to display:none in CSS (hidden until a pool
    // is active, and force-hidden on desktop via @media min-width:769px) —
    // an explicit 'block' is required here, an empty string would just fall
    // back to that same CSS default instead of overriding it.
    if (mobileHome) mobileHome.style.display = hasPool ? 'block' : 'none';
    if (onboard) onboard.style.display = hasPool ? 'none' : 'flex';
    const welcome = document.getElementById('fzoWelcome');
    if (!hasPool && welcome) welcome.textContent = `Bienvenue, ${userData.username}`;
    // Actualités LNH : dès qu'un pool est actif, le bandeau d'histoires du
    // haut de page (accueil.js) reprend le même flux — le visiteur qui
    // vient de rejoindre un pool ne doit pas le lire deux fois.
    if (news && hasPool) news.style.display = 'none';

    if (!hasPool) {
        // L'état vide est déjà la bonne disposition : ses blocs se remplissent
        // sur place, aucun ne sera remplacé.
        fzdRevelerAccueil();
        if (typeof fzhReset === 'function') fzhReset();
        if (typeof fzsReset === 'function') fzsReset();
        // La home mobile ne rend pas sans pool : les blocs partagés doivent
        // revenir à leur place, sinon ils restent coincés dans ses
        // emplacements — qu'on efface juste après, pour qu'un rendu suivant
        // ne les y renvoie pas.
        fzdRestoreCalendar();
        if (mobileHome) mobileHome.innerHTML = '';
        // L'état vide n'est plus une page d'inscription et rien d'autre : le
        // calendrier LNH, le compte à rebours du camp, les mouvements
        // récents, la liste « À surveiller » et les actualités s'ouvrent
        // d'eux-mêmes sous le panneau d'accueil. Aucun de ces blocs ne lit
        // de données de pool.
        if (!calData) await initCalendar(); else { renderCalendar(); renderOffseasonPanel(); }
        renderDashNews();
        return;
    }

    // Le calendrier et les données du soir ne dépendent pas l'un de l'autre :
    // ils partent ensemble. Les attendre l'un après l'autre allongeait
    // d'autant l'attente avant que la disposition ne soit choisie.
    const dashData = loadDashData();
    try {
        if (!calData) await initCalendar(); else { renderCalendar(); renderOffseasonPanel(); }
        fzdPlaceCalendar();
        renderQuickActions();
        renderMyPoolsList();
        renderActivityFeed();

        const dash = await dashData;
        if (dash) {
            // Les cartes joueur du calendrier lisent calTonight : on le pose AVANT
            // renderMobileHome (qui redessine le calendrier une fois déplacé), pour
            // que les stats en direct arrivent du premier coup.
            calTonight = dash.tonight || { players: [], games: [] };
            if (typeof renderDraftHome === 'function' && renderDraftHome(dash)) return;
            if (typeof renderSeasonHome === 'function' && renderSeasonHome(dash)) return;
            renderHero(dash.tonight);
            renderLivePanel(dash.tonight, dash.movement, dash.activeName);
            renderMobileHome(dash.tonight, dash.movement, dash.activeName);
        } else {
            if (typeof fzhReset === 'function') fzhReset();
            if (typeof fzsReset === 'function') fzsReset();
            renderHero(null);
            renderMobileHome({ players: [], games: [] }, null, FZPool.get());
        }
    } finally {
        // Même en cas d'erreur : un accueil masqué pour de bon serait pire
        // qu'un accueil incomplet.
        await fzdPolicesPretes();
        fzdRevelerAccueil();
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!userData.username) userData.username = localStorage.getItem('username');
    if (!userData.username) { fzdRevelerAccueil(); return; }

    // En parallèle des données : prêtes, en général, avant elles.
    fzdChargerPolices();
    // Horaire, fiches de clubs et feuilles du soir : aucune n'attend le pool.
    // Elles partent donc maintenant, avec lui, au lieu d'après lui.
    fzdPrecharger();
    bindCalendarControls();
    bindOnboardCards();
    // La liste « À surveiller » est chargée ici, avec le reste : elle doit
    // être en main avant renderDash(), qui la rend du premier coup au
    // bureau comme au téléphone.
    try {
        await Promise.all([FZPool.ready(), loadCurrentStats(), loadPendingTrades(), loadOffseasonWatchlist()]);
    } catch (erreur) {
        // renderDash() ne passera pas : rien ne choisirait de disposition.
        fzdRevelerAccueil();
        throw erreur;
    }
    renderDash();
    FZPool.onData(renderDash);
});
