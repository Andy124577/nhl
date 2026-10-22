/* ============================================================
   ACCUEIL DU REPÊCHAGE — maquettes « repêchage en cours » et « repêchage en
   préparation » (langage 6b Éditorial, comme l'accueil de saison)
   ------------------------------------------------------------
   Le héros et ses cartes viennent d'accueil-draft-hero.js. Au téléphone,
   une colonne de cartes ; au bureau, deux colonnes (accueil-draft.css),
   puis les alignements des 32 clubs et À lire sur toute la largeur.
   ============================================================ */
function fzhReset() {
    if (!document.getElementById('fzDraftHome')) return;
    if (typeof fzhHeroArreter === 'function') fzhHeroArreter();
    fzdRestoreCalendar();
    document.getElementById('fzDraftHome').remove();
    document.getElementById('fzDashSection')?.classList.remove('is-drafting');
    document.body.classList.remove('fz-draft-page');
}

function fzhIcon(name, size = 22) {
    const paths = {
        calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 11h18"/>',
        users: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3ZM17 3a4 4 0 0 1 0 8M19 14a5 5 0 0 1 3 5v2"/>',
        'arrow-right': '<path d="M3 12h18m-7-7 7 7-7 7"/>',
        'chevron-right': '<path d="m9 5 7 7-7 7"/>',
        'chevron-left': '<path d="m15 5-7 7 7 7"/>',
        zap: '<path d="m13 2-9 12h7l-1 8 10-13h-8Z"/>',
        chart: '<path d="M4 20V11M10 20V4M16 20V8M22 20V2"/>'
    };
    const svg = paths[name] ? `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>` : getIcon(name, size);
    return `<span class="fzh-icon" aria-hidden="true">${svg}</span>`;
}

/**
 * L'accueil du repêchage, du pool tout juste créé à la fin des choix. Avant
 * le départ : le héros, « Avant le début » et « Pour ta liste ». Une fois
 * parti : le héros, mon choix (ou mon choix probable), « Ma sélection » et
 * « Derniers choix ».
 */
function renderDraftHome({ tonight, activeName }) {
    const state = fzdHeroState(tonight);
    if (!state || (state.mode !== 'draft' && state.mode !== 'predraft')) { fzhReset(); return false; }
    fzsReset();
    fzdRestoreCalendar();
    fzdStopHeroTimer('fzDashHero');
    fzdStopHeroTimer('fzmHeroSlot');
    document.getElementById('fzMobileHome').innerHTML = '';
    const section = document.getElementById('fzDashSection');
    section.classList.add('is-drafting');
    document.body.classList.add('fz-draft-page');
    let root = document.getElementById('fzDraftHome');
    if (!root) {
        root = document.createElement('div');
        root.id = 'fzDraftHome'; root.className = 'fzs fzh';
        section.querySelector('.fz-dash').appendChild(root);
    }
    const { poolData, team } = state;
    const started = state.mode === 'draft';
    const salle = `draftActif.html?pool=${encodeURIComponent(activeName)}`;
    const banc = typeof window.fzQuotaBanc === 'function' ? window.fzQuotaBanc(poolData) : 0;
    root.innerHTML = `
        <div class="fzs-col fzs-col-a">
            <div class="fzh-hero-place" data-fzh-hero></div>
            <div class="fzh-place" data-fzh-panneau></div>
        </div>
        <div class="fzs-col fzs-col-b">
            ${started
                ? fzhHeroBesoinsHTML(fzhHeroBesoins(poolData, team.name, banc), salle) + fzhHeroDerniersHTML(fzhHeroDerniers(poolData, team.name))
                : '<div class="fzh-place" data-fzh-liste></div>'}
        </div>
        ${typeof fzsAlignementsHTML === 'function' ? fzsAlignementsHTML() : ''}
        <div class="fzs-slot fzs-read" data-fz-bloc="actualites"></div>`;
    fzhHeroBrancher(root);
    fzhHeroRendre(root, { poolData, poolName: activeName, teamName: team.name });
    // Les panneaux partagés arrivent d'index.html : on les met en place avant
    // de les remplir (voir fzdPlaceCalendar, accueil-dash.js). Seul À lire a
    // un emplacement ici ; le calendrier reste masqué à sa place d'origine.
    fzdPlaceCalendar();
    return true;
}

/* ---- Alignements ----
   Un joueur vaut aussi par sa place dans son club : au premier trio et à la
   première vague de l'avantage numérique, il récolte plus de points qu'au
   quatrième trio. La carte (fzsAlignementsHTML, accueil-season.js) mène aux
   alignements des 32 clubs, dans l'onglet « Alignements » de stats.html ;
   chaque tuile ouvre directement celui de son club (?equipe=, statsLineup.js). */
const FZH_LINES_URL = 'stats.html?onglet=alignements';

/** [code, nom, couleur de la tuile, couleur du code] — les couleurs de la maquette. */
const FZH_AL_CLUBS = [
    ['ANA', 'Anaheim Ducks', '#F47A38', '#000'], ['BOS', 'Boston Bruins', '#FFB81C', '#000'],
    ['BUF', 'Buffalo Sabres', '#003087', '#FFB81C'], ['CGY', 'Calgary Flames', '#C8102E', '#F1BE48'],
    ['CAR', 'Caroline Hurricanes', '#CE1126', '#fff'], ['CHI', 'Chicago Blackhawks', '#CF0A2C', '#fff'],
    ['COL', 'Colorado Avalanche', '#6F263D', '#fff'], ['CBJ', 'Columbus Blue Jackets', '#002654', '#fff'],
    ['DAL', 'Dallas Stars', '#006847', '#fff'], ['DET', 'Détroit Red Wings', '#CE1126', '#fff'],
    ['EDM', 'Edmonton Oilers', '#041E42', '#FF7A3D'], ['FLA', 'Floride Panthers', '#C8102E', '#fff'],
    ['LAK', 'Los Angeles Kings', '#111111', '#fff'], ['MIN', 'Minnesota Wild', '#154734', '#DDCBA4'],
    ['MTL', 'Montréal Canadiens', '#AF1E2D', '#fff'], ['NSH', 'Nashville Predators', '#FFB81C', '#041E42'],
    ['NJD', 'New Jersey Devils', '#CE1126', '#000'], ['NYI', 'New York Islanders', '#00539B', '#F47D30'],
    ['NYR', 'New York Rangers', '#0038A8', '#fff'], ['OTT', 'Ottawa Sénateurs', '#C52032', '#fff'],
    ['PHI', 'Philadelphie Flyers', '#F74902', '#000'], ['PIT', 'Pittsburgh Penguins', '#FCB514', '#000'],
    ['SJS', 'San Jose Sharks', '#006D75', '#fff'], ['SEA', 'Seattle Kraken', '#001628', '#99D9D9'],
    ['STL', 'St. Louis Blues', '#002F87', '#FCB514'], ['TBL', 'Tampa Bay Lightning', '#002868', '#fff'],
    ['TOR', 'Toronto Maple Leafs', '#00205B', '#fff'], ['UTA', 'Utah Mammoth', '#71AFE5', '#090909'],
    ['VAN', 'Vancouver Canucks', '#00205B', '#fff'], ['VGK', 'Vegas Golden Knights', '#B4975A', '#333F42'],
    ['WSH', 'Washington Capitals', '#C8102E', '#fff'], ['WPG', 'Winnipeg Jets', '#041E42', '#fff']
];

/** Le sigle d'un club de la LNH repêché comme « équipe ». */
function fzhClubAbbrev(name) {
    const fiches = (userData.teamsData && userData.teamsData.teams) || [];
    return fiches.find(t => t.teamFullName === name)?.teamAbbrev || '';
}
