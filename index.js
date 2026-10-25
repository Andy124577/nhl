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

/* ==================== TRI : UNE SEULE SAISON ====================
 *
 * Le tri lisait `stats ? stats[cle] : joueur[cle]` — deux saisons dans un
 * même classement. `joueur[cle]` vient de nhl_filtered_stats.json, la liste
 * de repêchage, qui garde volontairement les totaux de l'an passé. Un joueur
 * absent de /current-stats était donc comparé avec ses 100 points de la
 * saison écoulée à des coéquipiers notés sur la saison en cours : il montait
 * en tête d'un tableau par ailleurs à zéro. C'est ce qui rendait le tri par
 * points incompréhensible.
 *
 * La règle est maintenant tranchée une fois pour tout le tableau : si
 * /current-stats a répondu, il fait foi pour tout le monde (zéro compris) ;
 * sinon on retombe en bloc sur la liste locale. Jamais un mélange.
 *
 * Quelle saison /current-stats contient est décidé côté serveur par
 * statsSeasonId() (lib/season.js) : la dernière saison complétée tant que la
 * saison régulière n'a pas commencé. Rien à décider ici.
 */

/** Vrai dès que /current-stats a répondu avec des joueurs. */
function statsCourantesPretes() {
    return !!(currentStats && Array.isArray(currentStats.players) && currentStats.players.length);
}

/* ==================== SAISON AFFICHÉE : RÉELLE OU PROJETÉE ====================
 *
 * Le sélecteur « Saison » bascule tout le tableau d'une source à l'autre,
 * jamais un mélange des deux (même règle que le tri ci-dessus) :
 *   - « stats » : /current-stats, soit la dernière saison complétée tant que
 *     la saison régulière n'a pas commencé, puis la saison en cours dès son
 *     ouverture — le serveur en décide (statsSeasonId, lib/season.js). Le
 *     libellé suit `currentStats.season` : il nomme toujours la saison que
 *     le tableau affiche réellement, sans rien à changer ici chaque automne.
 *   - « projection » : les chiffres projetés de la trousse de repêchage
 *     (draftkitData.js), téléchargée au premier choix seulement — 1 Mo que
 *     la plupart des visites n'ont pas à payer.
 */
let statsMode = "stats";
let projectionPools = null;

function modeProjection() {
    return statsMode === "projection" && !!projectionPools;
}

/** « 2025-26 », depuis 20252026 comme depuis « 2025-2026 ». */
function libelleSaison(saison) {
    const chiffres = String(saison || "").replace(/\D/g, "");
    return chiffres.length === 8 && "function" == typeof seasonLabel ? seasonLabel(chiffres) : "";
}

function libellerModesSaison() {
    const reel = document.querySelector('#seasonMode option[value="stats"]'),
        projete = document.querySelector('#seasonMode option[value="projection"]');
    if (!reel || !projete) return;
    const saison = statsCourantesPretes() ? libelleSaison(currentStats.season) : "";
    // L'année d'abord : sur téléphone, le sélecteur tronque la fin du libellé.
    reel.textContent = saison ? `Stats ${saison}` : "Stats réelles";
    const kit = "undefined" != typeof FZDraftKit ? libelleSaison(FZDraftKit.saison) : "";
    projete.textContent = kit ? `Projetées ${kit}` : "Projections";
}

async function changerModeSaison() {
    const select = document.getElementById("seasonMode");
    statsMode = select.value;
    if ("projection" === statsMode && !projectionPools) {
        showSkeletonLoader();
        try {
            await FZDraftKit.charger();
            const pools = FZDraftKit.pools("projection");
            // La moitié des fiches de la trousse n'ont pas d'identifiant LNH :
            // sans lui, ni photo ni fiche du joueur.
            FZDraftKit.attacherIds([pools.skaters, pools.goalies],
                [...(statsCourantesPretes() ? currentStats.players : []), ...fullPlayerData, ...goalieData]);
            projectionPools = pools;
        } catch (err) {
            console.warn("⚠️ Projections indisponibles :", err);
            select.value = statsMode = "stats";
        }
    }
    libellerModesSaison();
    updateTable();
}

/** En projection, chaque colonne chiffrée le dit dans son infobulle. */
function colonnesDuMode(columns) {
    if (!modeProjection()) return columns;
    return columns.map(c => "rank-col" === c.cls || "player-col" === c.cls ? c : { ...c, title: `${c.title} (projection)` });
}

/** Un nombre, toujours : null, undefined, '' et NaN valent 0. */
function nombreStat(valeur) {
    const n = Number(valeur);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Valeur de tri d'un joueur pour une colonne.
 *
 * `points` chez un gardien n'est pas la colonne `points` de la LNH mais son
 * pointage de pool — même formule que le classement et l'accueil, tirée de
 * lib/scoring.js plutôt que recopiée ici.
 */
function valeurDeTri(ligne, nom, playerId, cle, estGardien) {
    const source = !modeProjection() && statsCourantesPretes()
        ? getCurrentPlayerStats(nom, playerId)
        : ligne;
    if (!source) return 0;
    if (estGardien && cle === "points") {
        return "function" == typeof goaliePoolPoints
            ? nombreStat(goaliePoolPoints(source))
            : 5 * nombreStat(source.shutouts) + 2 * nombreStat(source.wins) + nombreStat(source.otLosses);
    }
    return nombreStat(source[cle]);
}

/**
 * Comparateur décroissant, à égalité le nom par ordre alphabétique.
 *
 * Sans départage, deux joueurs à égalité gardaient l'ordre du fichier de
 * repêchage : l'ordre changeait donc d'une colonne à l'autre sans raison
 * visible. En début de saison, où tout le monde est à zéro, c'était tout le
 * tableau qui paraissait aléatoire.
 */
function comparerParStat(valeurA, valeurB, nomA, nomB) {
    if (valeurB !== valeurA) return valeurB - valeurA;
    return String(nomA || "").localeCompare(String(nomB || ""), "fr");
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
                cache: "no-cache"
            });
            currentStats = await t.json(), console.log(`✅ Current stats loaded: ${currentStats.players.length} players, last updated: ${currentStats.lastUpdated}`)
        } catch (t) {
            console.warn("⚠️ Could not load current stats, using cached data:", t)
        }
        try {
            const t = await fetch(`${BASE_URL}/current-teams`, {
                cache: "no-cache"
            });
            currentTeams = await t.json(), console.log(`✅ Current team standings loaded: ${currentTeams.teams.length} teams, last updated: ${currentTeams.lastUpdated}`)
        } catch (t) {
            console.warn("⚠️ Could not load current team standings, using cached data:", t)
        }
        libellerModesSaison(), updateTable()
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

/* ==================== FILTRES : POSITION, RECHERCHE ET TRI ====================
 *
 * Les pastilles de position (#playerFilter) et les en-têtes triables ont
 * remplacé les sélecteurs « Filtre » et « Trier par » : l'état vit ici
 * plutôt que dans deux <select>. Le tri est partagé entre les tableaux ; une
 * clé qu'un tableau n'a pas (les buts, chez les gardiens) y retombe sur les
 * points, sans être oubliée pour autant au retour aux patineurs.
 */
let statsFilter = "all";
let statsSort = "points";
// La feuille de filtres (statsFiltres.js) : « Agents libres seulement », les
// joueurs que personne n'a dans le pool actif ; et un club de la LNH.
let statsLibres = false;
let statsClub = "";

/** 'moi', 'pris', 'libre', ou null sans pool repêché (statsFiltres.js). */
function proprioJoueur(nom) {
    return "function" == typeof window.fzStatsProprio ? window.fzStatsProprio(nom) : null;
}
function estLibre(nom) {
    return !statsLibres || "libre" === proprioJoueur(nom);
}
/** Le club actuel : le dernier sigle d'un joueur échangé en cours de saison. */
function clubActuel(joueur) {
    return String(clubJoueur(joueur) || "").split(",").pop().trim();
}
function estDuClub(joueur) {
    return !statsClub || clubActuel(joueur) === statsClub;
}

/** La clé de tri d'un tableau : celle choisie si l'une de ses colonnes la porte. */
function cleDeTri(columns) {
    return columns.some(c => c.sort === statsSort) ? statsSort : "points";
}

/** Sans accents ni majuscules : « stutzle » trouve Stützle, « lafreniere » Lafrenière. */
function normaliserRecherche(texte) {
    return String(texte || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Le nom contient la recherche, ou la recherche est le sigle exact du club
 * (« mtl »). `club` est une fonction : le sigle d'un joueur se cherche dans
 * /current-stats, inutile de le faire pour chaque frappe qui n'a pas trois lettres.
 */
function correspondRecherche(recherche, nom, club) {
    if (!recherche) return true;
    if (normaliserRecherche(nom).includes(recherche)) return true;
    if (3 !== recherche.length) return false;
    return String(club() || "").split(",").some(c => normaliserRecherche(c) === recherche);
}

/** Club et position tels que la rangée les affiche : /current-stats d'abord. */
function clubJoueur(joueur) {
    return getCurrentPlayerStats(joueur.skaterFullName || joueur.goalieFullName, joueur.playerId)?.teamAbbrev
        || joueur.teamAbbrevs;
}
function positionJoueur(joueur) {
    return getCurrentPlayerStats(joueur.skaterFullName, joueur.playerId)?.position || joueur.positionCode;
}

function updateTable() {
    const t = statsFilter,
        a = normaliserRecherche(document.getElementById("searchInput").value);
    clearStatsPagination();
    const projete = modeProjection(),
        patineurs = projete ? projectionPools.skaters : fullPlayerData,
        gardiens = projete ? projectionPools.goalies : goalieData,
        clubs = projete ? projectionPools.teams : teamData;
    if ("teams" === t) {
        // Les clubs souffraient du même mélange : un club absent de
        // /current-teams était classé sur ses points de l'an passé.
        const clubsPrets = !projete && !!(currentTeams && currentTeams.teams && currentTeams.teams.length);
        return void populateTeamTable(clubs.filter(c => correspondRecherche(a, c.teamFullName,
            () => c.teamAbbrev || getTeamAbbreviation(c.teamFullName))).sort((t, e) => {
            const a = clubsPrets ? getCurrentTeamStats(t.teamFullName) : t,
                n = clubsPrets ? getCurrentTeamStats(e.teamFullName) : e;
            return comparerParStat(nombreStat(a && a.points), nombreStat(n && n.points),
                t.teamFullName, e.teamFullName)
        }))
    }
    if ("goalies" === t) {
        const e = cleDeTri(GOALIE_COLUMNS);
        return void populateGoalieTable(gardiens.filter(g => estLibre(g.goalieFullName) && estDuClub(g)
            && correspondRecherche(a, g.goalieFullName, () => clubJoueur(g)))
            .sort((t, a) => comparerParStat(
                valeurDeTri(t, t.goalieFullName, t.playerId, e, !0),
                valeurDeTri(a, a.goalieFullName, a.playerId, e, !0),
                t.goalieFullName, a.goalieFullName
            )))
    }
    const e = cleDeTri(SKATER_COLUMNS);
    let n;
    if ("offensive" === t) n = patineurs.filter(j => ["C", "R", "L"].includes(j.positionCode));
    else if ("defensive" === t) n = patineurs.filter(j => "D" === j.positionCode);
    // Centres et ailiers : la position que la rangée affiche, pas celle de la trousse.
    else if (["C", "L", "R"].includes(t)) n = patineurs.filter(j => positionJoueur(j) === t);
    else if ("rookies" === t) n = projete ? patineurs.filter(j => j.isRookie) : rookiePlayerData.slice();
    else n = patineurs.slice();
    if (a) n = n.filter(j => correspondRecherche(a, j.skaterFullName, () => clubJoueur(j)));
    if (statsLibres) n = n.filter(j => estLibre(j.skaterFullName));
    if (statsClub) n = n.filter(estDuClub);
    n.sort((t, a) => comparerParStat(
        valeurDeTri(t, t.skaterFullName, t.playerId, e, !1),
        valeurDeTri(a, a.skaterFullName, a.playerId, e, !1),
        t.skaterFullName, a.skaterFullName
    )), statsFullList = n, statsVisibleCount = STATS_PAGE_SIZE, populatePlayerTable(n)
}

/** Une pastille de position : la seule pressée, et visible dans sa rangée défilante. */
function choisirFiltre(valeur) {
    statsFilter = valeur;
    document.querySelectorAll("#playerFilter .st-chip").forEach(chip => {
        const actif = chip.dataset.filter === valeur;
        chip.setAttribute("aria-pressed", String(actif));
        if (actif) chip.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
}

/** Le ✕ de la recherche n'apparaît qu'avec quelque chose à effacer. */
function synchroniserEffacer() {
    const effacer = document.getElementById("searchClear");
    if (effacer) effacer.hidden = !document.getElementById("searchInput").value;
}

function viderRecherche() {
    document.getElementById("searchInput").value = "";
    synchroniserEffacer();
}

/** Bouton de l'état vide : tout revient à l'ouverture de la page, sauf la saison. */
function reinitialiserFiltres() {
    viderRecherche();
    choisirFiltre("all");
    statsSort = "points";
    statsLibres = false;
    statsClub = "";
    updateTable();
}

function initStatsFilters() {
    const recherche = document.getElementById("searchInput");
    recherche.addEventListener("input", () => { synchroniserEffacer(); updateTable(); });
    // Échap vide le champ, comme le ✕ ; il ne fait rien sur un champ déjà vide.
    recherche.addEventListener("keydown", e => {
        if ("Escape" !== e.key || !recherche.value) return;
        e.preventDefault();
        viderRecherche();
        updateTable();
    });
    document.getElementById("searchClear")?.addEventListener("click", () => {
        viderRecherche();
        updateTable();
        recherche.focus();
    });
    document.getElementById("playerFilter")?.addEventListener("click", e => {
        const chip = e.target.closest(".st-chip");
        if (!chip || chip.dataset.filter === statsFilter) return;
        choisirFiltre(chip.dataset.filter);
        updateTable();
    });
    synchroniserEffacer();
}
/**
 * Colonnes du tableau des patineurs.
 *
 * `sort` est la clé que l'en-tête écrit dans statsSort quand on le touche,
 * puis le rendu est relancé.
 *
 * Abréviations en français (PJ/B/A/PTS) plutôt qu'en anglais : le reste du
 * site est en français, et chacune porte une infobulle — l'utilisateur ne
 * devrait pas avoir à deviner ce que signifie une colonne.
 */
const SKATER_COLUMNS = [
    { label: '#', cls: 'rank-col', title: 'Rang', w: '6%' },
    { label: 'Joueur', cls: 'player-col', w: '50%' },
    { label: 'PJ', sort: 'gamesPlayed', title: 'Parties jouées', w: '11%' },
    { label: 'B', sort: 'goals', title: 'Buts', w: '11%' },
    { label: 'A', sort: 'assists', title: 'Passes décisives', w: '11%' },
    { label: 'PTS', sort: 'points', title: 'Points', cls: 'points-column', w: '11%' }
];

/** Gardiens : chaque colonne chiffrée se trie aussi, PTS étant le pointage de pool. */
const GOALIE_COLUMNS = [
    { label: '#', cls: 'rank-col', title: 'Rang', w: '6%' },
    { label: 'Gardien', cls: 'player-col', w: '38%' },
    { label: 'PJ', sort: 'gamesPlayed', title: 'Parties jouées', w: '8%' },
    { label: 'V', sort: 'wins', title: 'Victoires', w: '7%' },
    { label: 'D', sort: 'losses', title: 'Défaites', w: '7%' },
    { label: 'DP', sort: 'otLosses', title: 'Défaites en prolongation', w: '8%' },
    { label: '%ARR', sort: 'savePct', title: 'Pourcentage d\'arrêts', w: '10%' },
    { label: 'BL', sort: 'shutouts', title: 'Blanchissages', w: '7%' },
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
 * `count`, s'il est donné, suit le libellé de la colonne joueur : « Joueur · 312 ».
 */
function buildTableHead(columns, activeSort, count) {
    // La largeur passe par une variable CSS et non par `width` en ligne : un
    // style en ligne l'emporte sur toute feuille de style, ce qui rendait les
    // ajustements responsive impossibles sans !important.
    const cols = columns
        .map(c => `<col${c.w ? ` style="--col-w:${c.w}"` : ''}>`)
        .join('');
    const cells = columns.map(c => {
        const cls = [c.cls, c.sort ? 'sortable' : ''].filter(Boolean).join(' ');
        const actif = c.sort && c.sort === activeSort;
        const compte = 'player-col' === c.cls && null != count
            ? `<span class="th-count"> · ${count}</span>` : '';
        return `<th${cls ? ` class="${cls}${actif ? ' is-sorted' : ''}"` : ''}`
            + (c.title ? ` title="${c.title}"` : '')
            + (c.sort ? ` data-sort="${c.sort}" role="button" tabindex="0"` : '')
            + (actif ? ' aria-sort="descending"' : '')
            + `>${c.label}${compte}${actif ? '<span class="sort-caret" aria-hidden="true">▼</span>' : ''}</th>`;
    }).join('');
    return `<colgroup>${cols}</colgroup><thead><tr>${cells}</tr></thead>`;
}

/** Vrai dès que la recherche ou une pastille restreint la liste. */
function filtresActifs() {
    return "all" !== statsFilter || statsLibres || !!statsClub || !!document.getElementById("searchInput")?.value.trim();
}

/**
 * Message d'état vide : une recherche infructueuse doit expliquer quoi faire,
 * et offrir la sortie d'un geste quand ce sont les filtres qui ont tout caché.
 */
function buildEmptyState(colspan, message, hint) {
    const sortie = filtresActifs()
        ? '<button type="button" class="table-empty-reset" data-action="reset-filters">Réinitialiser les filtres</button>'
        : '';
    return `<tbody><tr class="table-empty-row"><td colspan="${colspan}">
        <div class="table-empty">
            <p class="table-empty-title">${message}</p>
            ${hint ? `<p class="table-empty-hint">${hint}</p>` : ''}
            ${sortie}
        </div>
    </td></tr></tbody>`;
}

/**
 * Chaque rendu le dit : la feuille de filtres et ses pastilles
 * (statsFiltres.js) suivent le tableau sans relire son contenu.
 */
function annoncerRendu(total, sorte) {
    document.dispatchEvent(new CustomEvent("fz:stats-rendu", { detail: { total, sorte } }));
}

/** Les joueurs de la liste des recrues, pour la pastille « R ». */
let recruesIds = null;
function estRecrue(joueur) {
    if (modeProjection()) return !!joueur.isRookie;
    if (!recruesIds) recruesIds = new Set(rookiePlayerData.map(r => r.playerId));
    return recruesIds.has(joueur.playerId);
}

/** Pastilles après la position : « R » d'une recrue, puis TOI ou LIBRE dans le pool actif. */
function pastillesJoueur(nom, recrue) {
    const proprio = proprioJoueur(nom);
    return (recrue ? '<abbr class="sj-tag sj-tag-recrue" title="Recrue">R</abbr>' : "")
        + ("moi" === proprio ? '<span class="sj-tag sj-tag-moi" title="Dans ton équipe">TOI</span>'
            : "libre" === proprio ? '<span class="sj-tag sj-tag-libre" title="Personne ne l’a dans ce pool">LIBRE</span>' : "");
}

async function populatePlayerTable(t) {
    annoncerRendu(t.length, "joueurs");
    await fetchImageData();
    const e = document.getElementById("playerTable");
    const visible = t.slice(0, statsVisibleCount);
    const sortKey = cleDeTri(SKATER_COLUMNS);

    if (!t.length) {
        const recherche = document.getElementById("searchInput").value.trim();
        e.innerHTML = buildTableHead(colonnesDuMode(SKATER_COLUMNS), sortKey, 0)
            + buildEmptyState(SKATER_COLUMNS.length, 'Aucun joueur trouvé',
                recherche ? 'Vérifiez l\'orthographe, ou cherchez le sigle d\'un club (MTL).' : '');
        renderStatsPagination(0);
        return;
    }

    e.innerHTML = buildTableHead(colonnesDuMode(SKATER_COLUMNS), sortKey, t.length);
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
        // Même source que le tri : `n.gamesPlayed > 0` faisait retomber la
        // ligne sur la liste de repêchage dès qu'un joueur n'avait pas encore
        // joué, si bien que la colonne affichait les points de l'an passé
        // pendant que le tri, lui, comparait des zéros. Les deux lisent
        // désormais la même saison.
        const src = !modeProjection() && statsCourantesPretes() ? n : t;
        const c = nombreStat(src && src.gamesPlayed),
            u = nombreStat(src && src.goals),
            m = nombreStat(src && src.assists),
            h = nombreStat(src && src.points);
        const g = photoJoueur(d, o, a),
            p = n?.position || t.positionCode || "N/A",
            y = document.createElement("tr");
        y.innerHTML = `\n            <td class="rank-col">${index + 1}</td>\n            <td class="player-col"><div class="player-cell">${g}<div class="player-ident"><span class="player-name">${nomJoueurHTML(a)}${injBadge(a, o)}${watchBadge(a, o)}</span>${metaJoueur(o, p, pastillesJoueur(a, estRecrue(t)))}</div></div></td>\n            <td>${c}</td>\n            <td>${u}</td>\n            <td>${m}</td>\n            <td class="points-column">${h}</td>\n        `;
        // Une fiche de la trousse sans identifiant LNH n'a pas de fiche à ouvrir.
        t.playerId && makeRowInteractive(y, () => showCareerStats(t.playerId, t.skaterFullName, !1),
            `Voir la fiche de ${a}`);
        tbody.appendChild(y)
    });
    marquerColonneTriee(e);
    renderStatsPagination(t.length)
}

/**
 * Le nom, et sa forme courte « N. MacKinnon » que le téléphone affiche à la
 * place (stats-premium.css), comme le classement cumulatif.
 */
function nomJoueurHTML(nom) {
    const mots = String(nom || "").split(" ");
    if (mots.length < 2) return nom;
    return `<span class="pn-full">${nom}</span><span class="pn-short">${mots[0][0]}. ${mots.slice(1).join(" ")}</span>`;
}

/**
 * La photo d'une rangée, comme au classement cumulatif (.rr-avatar,
 * classement.css) : visage détouré dans un rond à la couleur du club
 * (.fz-shot, teamLogos.css), initiales dessous. Une photo qui ne charge pas
 * se retire et les découvre. Le club se lit déjà sous le nom : plus de logo
 * en médaillon. data-no-lazy : lazy-load.js poserait un carré gris opaque
 * par-dessus la couleur le temps du chargement.
 */
function photoJoueur(url, club, nom) {
    const couleur = typeof getTeamColors === "function" && club ? getTeamColors(club)[0] : "#3A414D";
    const initiales = String(nom || "").split(/\s+/).filter(Boolean).slice(0, 2).map(m => m[0]).join("").toUpperCase();
    const image = url ? `<img src="${url}" alt="" class="face" loading="lazy" data-no-lazy onerror="this.remove()">` : "";
    return `<span class="player-photo fz-shot" style="--fz-shot-team:${couleur}">${image}<span class="player-initials">${initiales}</span></span>`;
}

/**
 * Pastille de blessure, ou rien. injuries.js est une couche d'agrément :
 * si le script n'a pas chargé, le tableau doit s'afficher quand même
 * plutôt que d'échouer sur une fonction absente.
 */
function injBadge(playerName, teamAbbrev) {
    return typeof injuryBadgeHTML === 'function' ? injuryBadgeHTML(playerName, teamAbbrev) : '';
}

/** Pastille « À surveiller » de la trousse, même principe (draft-watch.js). */
function watchBadge(playerName, teamAbbrev) {
    return typeof watchBadgeHTML === 'function' ? watchBadgeHTML(playerName, teamAbbrev) : '';
}

/**
 * Ligne sous le nom : le club, puis la position en pastille. Mêmes libellés
 * que la salle de repêchage (draftDesk.js) — la LNH écrit « R », un pooler
 * lit « AD », et un même joueur doit se lire pareil d'une page à l'autre.
 */
const POSITIONS_FR = {
    C: ['C', 'Centre'], L: ['AG', 'Ailier gauche'], R: ['AD', 'Ailier droit'],
    D: ['D', 'Défenseur'], G: ['G', 'Gardien']
};

function metaJoueur(equipe, position, extra = "") {
    const pos = POSITIONS_FR[position];
    const club = equipe && "null" !== equipe ? `<span class="player-team">${equipe}</span>` : "";
    const pastille = pos ? `<abbr class="pos-tag" data-pos="${position}" title="${pos[1]}">${pos[0]}</abbr>` : "";
    return club || pastille || extra ? `<span class="player-meta">${club}${pastille}${extra}</span>` : "";
}

/** Le tri se lit dans la colonne entière, pas seulement dans son en-tête. */
function marquerColonneTriee(table) {
    const th = table.querySelector("thead th.is-sorted");
    if (!th) return;
    table.querySelectorAll("tbody tr").forEach(tr => tr.cells[th.cellIndex]?.classList.add("is-sorted-col"));
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
    if (!table) return;

    const trier = (th) => {
        const key = th?.dataset?.sort;
        if (!key || key === statsSort) return;
        statsSort = key;
        updateTable();
    };

    table.addEventListener('click', e => {
        if (e.target.closest('[data-action="reset-filters"]')) { reinitialiserFiltres(); return; }
        trier(e.target.closest('th[data-sort]'));
    });
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
    annoncerRendu(t.length, "gardiens");
    const e = document.getElementById("playerTable");
    const sortKey = cleDeTri(GOALIE_COLUMNS);
    if (!t.length) {
        e.innerHTML = buildTableHead(colonnesDuMode(GOALIE_COLUMNS), sortKey, 0)
            + buildEmptyState(GOALIE_COLUMNS.length, 'Aucun gardien trouvé');
        return;
    }
    e.innerHTML = buildTableHead(colonnesDuMode(GOALIE_COLUMNS), sortKey, t.length);
    const tbody = document.createElement("tbody");
    e.appendChild(tbody);
    t.forEach((t, index) => {
        const a = t.goalieFullName,
            n = getCurrentPlayerStats(a, t.playerId),
            s = getMatchingImage(a),
            l = n?.teamAbbrev ? `teams/${n.teamAbbrev}.png` : getTeamLogoPath(t.teamAbbrevs);
        let o, r, d, i, c, u, m;
        const srcG = !modeProjection() && statsCourantesPretes() ? n : t;
        o = nombreStat(srcG && srcG.gamesPlayed), r = nombreStat(srcG && srcG.wins),
        d = nombreStat(srcG && srcG.losses), i = nombreStat(srcG && srcG.otLosses),
        // Sans partie jouée, ou sans pourcentage connu (0 = donnée absente,
        // voir lib/savePct.js), pas de pourcentage : « — », pas 0.000.
        c = o > 0 && nombreStat(srcG && srcG.savePct) > 0 ? nombreStat(srcG.savePct) : null, u = nombreStat(srcG && srcG.shutouts),
        m = valeurDeTri(t, a, t.playerId, "points", !0);
        const clubG = n?.teamAbbrev || t.teamAbbrevs?.split(",").pop().trim(),
            h = photoJoueur(s || (t.playerId && clubG ? buildHeadshotUrl(t.playerId, clubG) : null), clubG, a),
            g = document.createElement("tr");
        g.innerHTML = `\n            <td class="rank-col">${index + 1}</td>\n            <td class="player-col"><div class="player-cell">${h}<div class="player-ident"><span class="player-name">${nomJoueurHTML(a)}${injBadge(a, n?.teamAbbrev || t.teamAbbrevs?.split(",").pop().trim())}${watchBadge(a, n?.teamAbbrev || t.teamAbbrevs)}</span>${metaJoueur(n?.teamAbbrev || t.teamAbbrevs?.split(",").pop().trim(), "G", pastillesJoueur(a, !1))}</div></div></td>\n            <td>${o}</td>\n            <td>${r}</td>\n            <td>${d}</td>\n            <td>${i}</td>\n            <td>${c != null ? c.toFixed(3) : "—"}</td>\n            <td>${u}</td>\n            <td class="points-column">${m}</td>\n        `;
        t.playerId && makeRowInteractive(g, () => showCareerStats(t.playerId, t.goalieFullName, !0),
            `Voir la fiche de ${a}`);
        tbody.appendChild(g)
    });
    marquerColonneTriee(e)
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
    annoncerRendu(t.length, "équipes");
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
        e.innerHTML = buildTableHead(colonnesDuMode(TEAM_COLUMNS), null, 0)
            + buildEmptyState(TEAM_COLUMNS.length, 'Aucune équipe trouvée');
        return;
    }
    e.innerHTML = buildTableHead(colonnesDuMode(TEAM_COLUMNS), null, t.length);
    const tbody = document.createElement("tbody");
    e.appendChild(tbody);
    t.forEach((t, index) => {
        const a = `teams/${t.teamAbbrev || getTeamAbbreviation(t.teamFullName)}.png`,
            n = getCurrentTeamStats(t.teamFullName);
        let s, l, o, r, d;
        const srcT = !modeProjection() && (currentTeams && currentTeams.teams && currentTeams.teams.length) ? n : t;
        s = nombreStat(srcT && srcT.gamesPlayed), l = nombreStat(srcT && srcT.wins),
        o = nombreStat(srcT && srcT.losses), r = nombreStat(srcT && srcT.otLosses),
        d = nombreStat(srcT && srcT.points) || 2 * l + 1 * r;
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
            t = `\n                <div class="stat-item">\n                    <div class="stat-label">Matchs joués</div>\n                    <div class="stat-value">${l.gamesPlayed||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Victoires</div>\n                    <div class="stat-value">${l.wins||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Défaites</div>\n                    <div class="stat-value">${l.losses||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Prol.</div>\n                    <div class="stat-value">${l.otLosses||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">% Arrêts</div>\n                    <div class="stat-value">${l.savePct ? l.savePct.toFixed(3) : "—"}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Blanchissages</div>\n                    <div class="stat-value">${l.shutouts||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Points</div>\n                    <div class="stat-value">${e}</div>\n                </div>\n            `
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
async function showCareerStats(playerId, playerName, isGoalie = false) {
    currentCareerData = null;
    return fzOpenCareerModal(playerId, playerName, {
        onData(data) { currentCareerData = data; },
        renderStats: filterCareerStats
    });
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
            l += "<tr>", l += `<td class="season-col">${t.season}</td>`, l += `<td class="league-col">${t.league}</td>`, l += `<td class="team-col">${t.team||"-"}</td>`, l += `<td>${t.gp}</td>`, currentCareerData.isGoalie ? l += `\n                <td>${t.wins}</td>\n                <td>${t.losses}</td>\n                <td>${t.otLosses}</td>\n                <td>${t.savePct!=null?t.savePct.toFixed(3):"—"}</td>\n                <td>${t.gaa?t.gaa.toFixed(2):"0.00"}</td>\n                <td>${t.shutouts}</td>\n            ` : l += `\n                <td>${t.goals}</td>\n                <td>${t.assists}</td>\n                <td>${t.points}</td>\n                <td>${t.plusMinus>=0?"+"+t.plusMinus:t.plusMinus}</td>\n                <td>${t.pim}</td>\n                <td>${t.shots}</td>\n            `, l += "</tr>"
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
            // % d'arrêts de carrière : arrêts sur tirs, pas la moyenne des
            // saisons — une saison de 5 parties pesait autant qu'une de 60.
            svSaves: 0,
            svShots: 0
        };
        if (s.forEach(e => {
                t.gp += e.gp || 0, currentCareerData.isGoalie ? (t.wins += e.wins || 0, t.losses += e.losses || 0, t.otLosses += e.otLosses || 0, t.shutouts += e.shutouts || 0, e.gaa && e.gp > 0 && (t.totalGAA += e.gaa * e.gp, t.gamesForAvg += e.gp), e.savePct != null && e.shotsAgainst > 0 && (t.svShots += e.shotsAgainst, t.svSaves += e.savePct * e.shotsAgainst)) : (t.goals += e.goals || 0, t.assists += e.assists || 0, t.points += e.points || 0, t.plusMinus += e.plusMinus || 0, t.pim += e.pim || 0, t.shots += e.shots || 0)
            }), l += '<tr class="career-totals-row">', l += '<td colspan="3" class="career-totals-label">Carrière</td>', l += `<td>${t.gp}</td>`, currentCareerData.isGoalie) {
            const e = t.gamesForAvg > 0 ? (t.totalGAA / t.gamesForAvg).toFixed(2) : "0.00",
                a = t.svShots > 0 ? (t.svSaves / t.svShots).toFixed(3) : "—";
            l += `\n                <td>${t.wins}</td>\n                <td>${t.losses}</td>\n                <td>${t.otLosses}</td>\n                <td>${a}</td>\n                <td>${e}</td>\n                <td>${t.shutouts}</td>\n            `
        } else l += `\n                <td>${t.goals}</td>\n                <td>${t.assists}</td>\n                <td>${t.points}</td>\n                <td>${t.plusMinus>=0?"+"+t.plusMinus:t.plusMinus}</td>\n                <td>${t.pim}</td>\n                <td>${t.shots}</td>\n            `;
        l += "</tr>"
    }
    l += "</tbody></table>", a.innerHTML = l
}

function closeCareerModal() {
    fzCloseCareerModal();
    currentCareerData = null;
}
// Le tableau de stats.html tel qu'il arrive : son vrai en-tête et des rangées
// en os. Repris à chaque relecture (projections) ; le script est différé, la
// page est déjà lue. populatePlayerTable remplace tout le tableau.
const TABLEAU_SQUELETTE = document.getElementById("playerTable")?.innerHTML || "";

function showSkeletonLoader() {
    const table = document.getElementById("playerTable");
    if (table && TABLEAU_SQUELETTE) table.innerHTML = TABLEAU_SQUELETTE;
}

/** Lecture ratée : rien ne viendra remplacer les rangées en os. */
function hideSkeletonLoader() {
    document.querySelector("#playerTable tbody[data-fz-sk]")?.remove();
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
        })).ok ? (localStorage.setItem("username", e), localStorage.setItem("activeUser", e), window.location.reload()) : fzAlert({ type: 'error', title: 'Changement impossible', message: 'Le changement d’utilisateur a échoué.' })
    } catch (t) {
        console.error("Error switching user:", t), fzAlert({ type: 'error', icon: 'offline', title: 'Connexion impossible', message: 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.' })
    }
}

function logout(t) {
    t && t.preventDefault(), localStorage.removeItem("isLoggedIn"), localStorage.removeItem("username"), localStorage.removeItem("isAdmin"), localStorage.removeItem("activeUser"), location.reload()
}
initStatsFilters(), document.getElementById("seasonMode").addEventListener("change", changerModeSaison), "undefined" != typeof FZDraftKit && FZDraftKit.chargerWatchlist().then(libellerModesSaison, () => {}), fetchPlayerData(), $(document).ready(function() {
    const t = "true" === localStorage.getItem("isLoggedIn"),
        e = localStorage.getItem("username"),
        a = "true" === localStorage.getItem("isAdmin");
    t && (a ? ($("#admin-users-link").css("display", "block").html('\n                <div class="admin-dropdown-container">\n                    <a href="#" class="admin-dropdown-toggle" onclick="toggleAdminDropdown(event)">\n                        Utilisateur ▼\n                    </a>\n                    <div class="admin-dropdown-menu" id="adminDropdown">\n                        <div class="admin-dropdown-header">Changer d\'utilisateur</div>\n                        <div id="adminUserList" class="admin-user-list">Chargement...</div>\n                    </div>\n                </div>\n            '), $("#login-link").html(`<a href="#" onclick="logout(event)">Déconnexion (${e})</a>`), loadAdminUsers()) : $("#login-link").html(`<a href="#" onclick="logout(event)">Déconnexion (${e})</a>`))
}), document.addEventListener("click", function(t) {
    const e = document.getElementById("adminDropdown");
    e && !t.target.closest(".admin-dropdown-container") && e.classList.remove("show")
});
