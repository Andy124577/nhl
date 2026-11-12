// ==================== PAGE DETECTION ====================
function getCurrentPage() {
    const n = window.location.pathname;
    if (n.includes('index.html') || n.endsWith('/')) return 'accueil';
    if (n.includes('stats.html')) return 'stats';
    // Toutes les étapes du repêchage partagent le même onglet : la salle de
    // repêchage n'est qu'un écran de plus sous « Repêchage ».
    if (n.includes('repechage.html') || n.includes('draft.html') ||
        n.includes('draftActif.html') || n.includes('draftFini.html')) return 'repechage';
    // « Mon équipe » n'a pas de page à elle : c'est la fiche de son équipe,
    // sur la page du classement (classement.html?vue=equipe, classement.js).
    if (n.includes('classement.html')) {
        return /[?&]vue=equipe(?:&|$)/.test(window.location.search || '') ? 'equipe' : 'classement';
    }
    if (n.includes('trade.html')) return 'trade';
    // Les scores n'ont plus d'onglet : on y arrive par « Matchs ce soir »,
    // à l'accueil. Aucun onglet ne s'allume sur ces deux pages.
    if (n.includes('calendrier.html') || n.includes('match.html')) return 'calendrier';
    // Créer, rejoindre et la page du pool actif vivent sous le menu
    // « Pools », avec la liste des pools dont on est membre.
    if (n.includes('creer-pool.html') || n.includes('rejoindre-pool.html') ||
        /(^|\/)pool\.html$/.test(n)) return 'pools';
    return '';
}

/**
 * L'onglet qu'une page allume. Les échanges s'ouvrent depuis « Mon équipe »
 * (le bouton à côté de « Mettre en vente ») : leur page en garde l'onglet.
 */
function ongletDePage(page) {
    return page === 'trade' ? 'equipe' : page;
}

// La page que les barres tiennent pour courante. Elle peut changer sans
// rechargement : le classement passe d'une fiche à l'autre sur place
// (fzNavActiver).
let _navPage = '';

/**
 * Allume l'onglet d'une page dans les trois menus — barre du bas, barre du
 * haut, tiroir — sans les reconstruire. classement.js s'en sert : la fiche
 * de mon équipe allume « Mon équipe », tout le reste « Classement ».
 */
function fzNavActiver(page) {
    _navPage = page;
    const onglet = ongletDePage(page);
    const marquer = (el, actif, classe) => {
        el.classList.toggle(classe, actif);
        if (actif) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    };
    document.querySelectorAll('.bottom-nav-item[data-page]').forEach(o => marquer(o, o.dataset.page === onglet, 'active'));
    document.querySelectorAll('.navbar .nav-link[data-page]').forEach(o => marquer(o, o.dataset.page === onglet, 'active'));
    document.querySelectorAll('.fzm-nav-lien[data-page]').forEach(o => marquer(o, o.dataset.page === onglet, 'is-on'));
}

// ==================== INITIALIZATION ====================
/**
 * Les deux barres elles-mêmes : rien qui attende le réseau ni un autre
 * script, donc constructibles avant le premier rendu.
 *
 * Une page qui charge navbar.js sans `defer`, juste après <nav class="navbar">
 * (calendrier.html), les obtient pendant l'analyse du HTML : son premier
 * rendu les montre déjà, au lieu d'un contenu nu qui les voit arriver ensuite
 * — on aurait dit que toute la page, barres comprises, se rechargeait.
 * Ailleurs, initModernNavbar s'en charge au DOMContentLoaded.
 */
let _barresConstruites = false;

function construireBarres() {
    if (_barresConstruites || !document.querySelector('.navbar')) return;
    _barresConstruites = true;
    const currentPage = getCurrentPage();
    _navPage = currentPage;

    if (localStorage.getItem('isLoggedIn') !== 'true') { buildLoggedOutNavbar(); return; }

    buildLoggedInNavbar(localStorage.getItem('username') || '', localStorage.getItem('isAdmin') === 'true', currentPage);
    buildBottomNav(currentPage);
    // Avant tout : replier les onglets que le dernier passage savait
    // fermés. Dans la même tâche que la construction, donc jamais peints.
    appliquerVisibiliteMemorisee();
    initToucherBas(currentPage);
}

function initModernNavbar() {
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const username = localStorage.getItem('username') || '';
    const isAdmin = localStorage.getItem('isAdmin') === 'true';

    if (!isLoggedIn) retrouverSession();

    if (!document.querySelector('.navbar')) return;

    construireBarres();

    if (isLoggedIn) {
        initializeEventListeners(username, isAdmin);
        if (isAdmin) verifierBascule();
        checkPendingTrades();
        checkActiveDrafts();
        updateDraftLinkVisibility();
        updateClassementLinkVisibility();
        // Les pastilles parlent du pool actif : elles le suivent quand il change.
        if (window.FZPool) {
            const majPastilles = () => {
                checkPendingTrades(); checkActiveDrafts();
                updateDraftLinkVisibility();
                updateClassementLinkVisibility();
            };
            FZPool.on(majPastilles);
            FZPool.onData(majPastilles);
        }
        // Fetch latest avatar in background and update if changed
        refreshNavbarAvatar(username);
    }
}

// ==================== SESSION RETROUVÉE ====================
/**
 * La session vit dans un cookie HttpOnly de trente jours ; l'interface, elle,
 * lit localStorage pour savoir qui est connecté. Safari (iPhone surtout)
 * efface localStorage d'un site qu'on n'a pas ouvert depuis sept jours, mais
 * garde le cookie posé par le serveur : la page se croyait déconnectée et
 * renvoyait au mot de passe une personne dont la session était intacte.
 *
 * Sans trace locale, on demande donc au serveur. Une session valide est
 * recopiée et la page rechargée, pour que chaque script la relise d'emblée.
 * Un seul rechargement par onglet : si l'écriture ne tient pas (stockage
 * bloqué), la page reste en visiteur au lieu de tourner en boucle.
 */
async function retrouverSession() {
    try {
        const res = await fetch(`${navbarBaseUrl()}/session`, { cache: 'no-store' });
        if (!res.ok) return;
        const session = await res.json();
        if (!session || !session.authenticated || !session.username) return;

        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('username', session.username);
        localStorage.setItem('avatarUrl', session.avatarUrl || '');
        if (session.isAdmin) localStorage.setItem('isAdmin', 'true');
        else localStorage.removeItem('isAdmin');

        if (localStorage.getItem('isLoggedIn') !== 'true') return;
        if (sessionStorage.getItem('fzSessionRetrouvee')) return;
        sessionStorage.setItem('fzSessionRetrouvee', '1');
        location.reload();
    } catch { /* hors ligne ou stockage bloqué : la page reste en visiteur */ }
}

// ==================== ICÔNES ====================
// SVG intégrés plutôt que getIcon() : icons.js n'est pas chargé sur
// classement.html ni draftFini.html, alors que navbar.js tourne partout.
const NAV_ICON = {
    camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
    shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    shieldCheck: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 11.5 11.2 13.7 15.2 9.7"/></svg>`,
    key: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>`,
    fileText: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>`,
    smartphone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>`,
    sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>`,
    moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.1A8.5 8.5 0 1 1 9.9 3.5a6.6 6.6 0 0 0 10.6 10.6z"/></svg>`
};

// Les sections du site, dans l'ordre affiché partout (barre du haut,
// barre du bas, tiroir des pools) : mêmes silhouettes, seule la couleur
// suit currentColor pour s'accorder au thème et à l'état actif/survol.
const PAGE_ICON = {
    accueil: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>`,
    repechage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>`,
    equipe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>`,
    classement: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 21V9a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v12"/><path d="M8.5 13h-5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h17a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-5"/><path d="M12 .6l.76 1.95 2.09.12-1.61 1.33.52 2.03L12 4.9l-1.76 1.13.52-2.03-1.61-1.33 2.09-.12z" fill="currentColor" stroke="none"/></svg>`,
    stats: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>`,
    pools: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/></svg>`
};

// La barre du bas (téléphone) : Material Symbols arrondis, en SVG en ligne
// pour ne pas charger une police d'icônes de plus. Chaque onglet a deux
// tracés, contour au repos et plein une fois choisi (navbar.css).
const BARRE_ICON = {
    accueil: ['M220-180h150v-220q0-12.75 8.63-21.38Q387.25-430 400-430h160q12.75 0 21.38 8.62Q590-412.75 590-400v220h150v-390L480-765 220-570v390Zm-60 0v-390q0-14.25 6.38-27 6.37-12.75 17.62-21l260-195q15.68-12 35.84-12Q500-825 516-813l260 195q11.25 8.25 17.63 21 6.37 12.75 6.37 27v390q0 24.75-17.62 42.37Q764.75-120 740-120H560q-12.75 0-21.37-8.63Q530-137.25 530-150v-220H430v220q0 12.75-8.62 21.37Q412.75-120 400-120H220q-24.75 0-42.37-17.63Q160-155.25 160-180Zm320-293Z',
        'M160-180v-390q0-14.25 6.38-27 6.37-12.75 17.62-21l260-195q15.68-12 35.84-12Q500-825 516-813l260 195q11.25 8.25 17.63 21 6.37 12.75 6.37 27v390q0 24.75-17.62 42.37Q764.75-120 740-120H590q-12.75 0-21.37-8.63Q560-137.25 560-150v-220q0-12.75-8.62-21.38Q542.75-400 530-400H430q-12.75 0-21.37 8.62Q400-382.75 400-370v220q0 12.75-8.62 21.37Q382.75-120 370-120H220q-24.75 0-42.37-17.63Q160-155.25 160-180Z'],
    repechage: ['M80-200v-45q0-17 11.5-28.5T120-285h20v125h-20q-17 0-28.5-11.5T80-200Zm104 40v-125h175l43-94 49 97-46 101q-5 11-15 16t-21 5H184Zm696-40q0 17-11.5 28.5T840-160h-20v-125h20q17 0 28.5 11.5T880-245v45Zm-104 40H591q-11 0-21-5t-15-16L300-740q-10-21 3-40.5t36-19.5q13 0 23 7t15 18l103 225 103-225q5-11 15-18t23-7q23 0 36 19.5t3 40.5L527-447l74 162h175v125Z',
        'M80-200v-45q0-17 11.5-28.5T120-285h20v125h-20q-17 0-28.5-11.5T80-200Zm104 40v-125h175l43-94 49 97-46 101q-5 11-15 16t-21 5H184Zm696-40q0 17-11.5 28.5T840-160h-20v-125h20q17 0 28.5 11.5T880-245v45Zm-104 40H591q-11 0-21-5t-15-16L300-740q-10-21 3-40.5t36-19.5q13 0 23 7t15 18l103 225 103-225q5-11 15-18t23-7q23 0 36 19.5t3 40.5L527-447l74 162h175v125Z'],
    equipe: ['m250-569-63 35q-14 8-29.5 4.5T136-546L67-665q-8-14-4.5-24T79-707l228-133h64q11 0 17.5 6.5T395-816v15q0 38 24 62t62 24q38 0 61.5-24t23.5-62v-15q0-11 6.5-17.5T590-840h64l228 133q13 8 16 18t-4 24l-70 119q-6 13-25 17t-30-3l-62-39v412q0 16-12 27.5T667-120H289q-16 0-27.5-11.5T250-159v-410Zm60-102v491h337v-491l138 77 45-78-187-107h-18q-8 54-47.5 89T481-655q-57 0-97-35t-48-89h-18L131-672l45 78 134-77Zm171 191Z',
        'm250-569-63 35q-14 8-29.5 4.5T136-546L67-665q-8-14-4.5-24T79-707l228-133h64q11 0 17.5 6.5T395-816v15q0 38 24 62t62 24q38 0 61.5-24t23.5-62v-15q0-11 6.5-17.5T590-840h64l228 133q13 8 16 18t-4 24l-70 119q-6 13-25 17t-30-3l-62-39v412q0 16-12 27.5T667-120H289q-16 0-27.5-11.5T250-159v-410Z'],
    classement: ['M140-180h187v-360H140v360Zm247 0h186v-600H387v600Zm246 0h187v-280H633v280Zm-553 0v-360q0-24.75 17.63-42.38Q115.25-600 140-600h187v-180q0-24.75 17.63-42.38Q362.25-840 387-840h186q24.75 0 42.38 17.62Q633-804.75 633-780v260h187q24.75 0 42.38 17.62Q880-484.75 880-460v280q0 24.75-17.62 42.37Q844.75-120 820-120H140q-24.75 0-42.37-17.63Q80-155.25 80-180Z',
        'M110-120q-12.75 0-21.37-8.63Q80-137.25 80-150v-420q0-12.75 8.63-21.38Q97.25-600 110-600h150q12.75 0 21.38 8.62Q290-582.75 290-570v420q0 12.75-8.62 21.37Q272.75-120 260-120H110Zm295 0q-12.75 0-21.37-8.63Q375-137.25 375-150v-660q0-12.75 8.63-21.38Q392.25-840 405-840h150q12.75 0 21.38 8.62Q585-822.75 585-810v660q0 12.75-8.62 21.37Q567.75-120 555-120H405Zm295 0q-12.75 0-21.37-8.63Q670-137.25 670-150v-340q0-12.75 8.63-21.38Q687.25-520 700-520h150q12.75 0 21.38 8.62Q880-502.75 880-490v340q0 12.75-8.62 21.37Q862.75-120 850-120H700Z'],
    stats: ['M292.5-473.38Q284-464.75 284-452v145q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63 12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-145q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62Zm332-215Q616-679.75 616-667v360q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63 12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-360q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62Zm-166 302Q450-377.75 450-365v58q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63 12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-58q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62ZM180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Zm0-600v600-600Zm321.5 289.32q8.5-8.67 8.5-21.5 0-12.82-8.68-21.32-8.67-8.5-21.5-8.5-12.82 0-21.32 8.68-8.5 8.67-8.5 21.5 0 12.82 8.68 21.32 8.67 8.5 21.5 8.5 12.82 0 21.32-8.68Z',
        'M292.5-473.38Q284-464.75 284-452v145q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63 12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-145q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62Zm332-215Q616-679.75 616-667v360q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63 12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-360q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62Zm-166 302Q450-377.75 450-365v58q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63 12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-58q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62ZM180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm321.5-370.68q8.5-8.67 8.5-21.5 0-12.82-8.68-21.32-8.67-8.5-21.5-8.5-12.82 0-21.32 8.68-8.5 8.67-8.5 21.5 0 12.82 8.68 21.32 8.67 8.5 21.5 8.5 12.82 0 21.32-8.68Z']
};

function iconeBarre(cle) {
    const [contour, plein] = BARRE_ICON[cle];
    const svg = (d, c) => `<svg class="${c}" viewBox="0 -960 960 960"><path d="${d}"/></svg>`;
    return svg(contour, 'bn-contour') + svg(plein, 'bn-plein');
}

// ==================== THÈME ====================
// theme.js pose l'attribut sur <html> ; localStorage peut être vide au
// tout premier passage, d'où la lecture des deux.
function _themeIsDark() {
    const actuel = document.documentElement.getAttribute('data-theme')
        || localStorage.getItem('theme')
        || 'dark';
    return actuel === 'dark';
}

function _themeToggleLabel() {
    return _themeIsDark() ? 'Passer au thème clair' : 'Passer au thème sombre';
}

/**
 * Pose le thème choisi, avec le même attribut et la même clé que theme.js.
 *
 * Les icônes suivent l'attribut en CSS : il ne reste ici qu'à tenir à jour
 * ce que lit un lecteur d'écran. Pas d'appel à toggleTheme() : theme.js
 * n'est pas versionné, et une ancienne copie en cache réécrirait l'icône
 * avec un emoji.
 */
function fzSetTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch { /* stockage bloqué : le thème vaut pour la page */ }
    document.querySelectorAll('[data-theme-choice]').forEach(opt =>
        opt.setAttribute('aria-checked', String(opt.dataset.themeChoice === theme)));
    const bouton = document.getElementById('themeToggleBtn');
    if (bouton) {
        bouton.title = _themeToggleLabel();
        bouton.setAttribute('aria-label', _themeToggleLabel());
    }
}

function fzToggleTheme() {
    fzSetTheme(_themeIsDark() ? 'light' : 'dark');
}

/**
 * Échappe un texte pour du HTML. Le nom affiché ici est celui de la session —
 * pendant une bascule d'administration, celui d'un autre compte : il passe
 * par ici comme n'importe quelle donnée reçue.
 */
function _navEsc(texte) {
    // \x22 et \x27 : les guillemets " et ', écrits ainsi pour les outils qui
    // lisent ce fichier sans comprendre les expressions régulières.
    return String(texte == null ? '' : texte).replace(/[&<>\x22\x27]/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

// ==================== AVATAR HELPERS ====================
function _buildAvatarInner(username) {
    const av = localStorage.getItem('avatarUrl') || '';
    const initiale = _navEsc(username.charAt(0).toUpperCase());
    if (av) return `<img src="${_navEsc(av)}" class="user-avatar-img" alt="${initiale}" id="navAvatarImg">`;
    return `<img src="Icons/grayUser.png" class="user-avatar-img" alt="${initiale}" id="navAvatarImg">`;
}

async function refreshNavbarAvatar(username) {
    try {
        const base = window.location.hostname.includes('localhost') ? 'http://localhost:3000' : window.location.origin;
        const r = await fetch(`${base}/user-profile/${encodeURIComponent(username)}`);
        if (!r.ok) return;
        const d = await r.json();
        const url = d.avatarUrl || '';
        localStorage.setItem('avatarUrl', url);
        const btn = document.getElementById('userAvatarBtn');
        if (!btn) return;
        const initiale = _navEsc(username.charAt(0).toUpperCase());
        btn.innerHTML = url
            ? `<img src="${_navEsc(url)}" class="user-avatar-img" alt="${initiale}" id="navAvatarImg">`
            : `<img src="Icons/grayUser.png" class="user-avatar-img" alt="${initiale}" id="navAvatarImg">`;
    } catch { /* silent */ }
}

// ==================== LOGGED OUT NAVBAR ====================
function buildLoggedOutNavbar() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;
    navbar.innerHTML = `
        <div class="navbar-desktop navbar-guest">
            <a href="https://fantazy.ca" class="navbar-brand" style="text-decoration:none;">
                <img src="Icons/fantazy.png" alt="Fantazy" class="navbar-logo">
            </a>
            <div class="navbar-guest-actions">
                <!-- Visiteur : pas de menu de compte où le loger. -->
                <button type="button" class="theme-toggle-btn" id="themeToggleBtn" onclick="fzToggleTheme()"
                        title="${_themeToggleLabel()}" aria-label="${_themeToggleLabel()}">
                    <span class="theme-toggle-icon is-sun" aria-hidden="true">${NAV_ICON.sun}</span>
                    <span class="theme-toggle-icon is-moon" aria-hidden="true">${NAV_ICON.moon}</span>
                </button>
                <a href="login.html" class="btn-nav-login">
                    <span>Connexion</span>
                </a>
                <a href="signup.html" class="btn-nav-signup">
                    <span>S'inscrire</span>
                    <span class="btn-signup-arrow">→</span>
                </a>
            </div>
        </div>
    `;
}

// ==================== LOGGED IN NAVBAR ====================
// Ordre : Accueil → Pools ▾ → Repêchage (🔴) → Mon équipe (🔴) → Classement
//         → Stats
//
// Repêchage tant que le pool actif repêche ; Mon équipe et Classement une
// fois qu'il a fini (onglets conditionnels, plus bas). Les échanges n'ont
// plus de lien ici : ils s'ouvrent depuis Mon équipe, dont la pastille
// compte les offres reçues. Les scores s'ouvrent depuis l'accueil.
//
// « Pools » mène à l'accueil des pools (pool.html) : trois boutons, créer
// un pool, en rejoindre un, ou ouvrir le pool actif sous son nom — ses
// équipes, ses règles, ses invitations (pool.html?onglet=…). Changer de
// pool se fait dans le rail et le tiroir (poolNav.js).
//
// Les pastilles ne comptent que le pool actif : c'est celui que ces liens
// ouvriront. Ce qui se passe dans les autres pools est signalé par la
// cloche de notifications, qui elle sait dire de quel pool il s'agit.
function buildLoggedInNavbar(username, isAdmin, currentPage) {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    // `data-page` : l'onglet que le lien représente, relu par fzNavActiver.
    const ongletActif = ongletDePage(currentPage);
    const lien = (page, href, libelle, extra = '') => {
        const actif = page === ongletActif;
        return `<a href="${href}" class="nav-link${actif ? ' active' : ''}" data-page="${page}"${actif ? ' aria-current="page"' : ''}${extra}>
                        <span class="nav-icon-img" aria-hidden="true">${PAGE_ICON[page]}</span>
                        <span class="nav-text">${libelle}</span>`;
    };

    navbar.innerHTML = `
        <!-- Desktop Layout -->
        <div class="navbar-desktop">
            <!-- Left: Logo + Nav Links -->
            <div class="navbar-left">
                <a href="https://fantazy.ca" class="navbar-brand" style="text-decoration:none;">
                    <img src="Icons/fantazy.png" alt="Fantazy" class="navbar-logo">
                </a>

                <nav class="nav-links">
                    ${lien('accueil', 'index.html', 'Accueil')}
                    </a>
                    ${lien('pools', 'pool.html', 'Pools', ' id="navPoolsBtn"')}
                    </a>
                    ${lien('repechage', 'repechage.html', 'Repêchage', ' id="desktopPoolLink"')}
                        <span class="notif-badge" id="desktopDraftBadge" style="display: none;"></span>
                    </a>
                    ${lien('equipe', 'classement.html?vue=equipe', 'Mon équipe', ' id="desktopEquipeLink"')}
                        <span class="notif-badge" id="desktopTradeBadge" style="display: none;">0</span>
                    </a>
                    ${lien('classement', 'classement.html', 'Classement', ' id="desktopClassementLink"')}
                    </a>
                    ${lien('stats', 'stats.html', 'Stats')}
                    </a>
                </nav>
            </div>

            <!-- Right: notifications (injectées par notifications.js) + menu -->
            <!-- Le bouton de thème a rejoint le menu du compte : la cloche
                 et l'avatar suffisent à remplir cette barre. -->
            <div class="navbar-right">
                <div class="user-menu">
                    <button class="user-avatar" id="userAvatarBtn" title="${_navEsc(username)}"
                            aria-haspopup="true" aria-expanded="false" aria-controls="userDropdownMenu">
                        ${_buildAvatarInner(username)}
                    </button>
                    <div class="user-dropdown" id="userDropdownMenu" role="menu"
                         aria-label="Menu du compte">

                        <!-- Carte de membre : l'avatar s'édite directement ici,
                             plutôt que par une rangée « Changer la photo » séparée. -->
                        <div class="user-dropdown-header">
                            <label class="udh-avatar" title="Changer la photo de profil">
                                ${_buildAvatarInner(username)}
                                <span class="udh-avatar-edit" aria-hidden="true">${NAV_ICON.camera}</span>
                                <input type="file" id="avatarUploadInput"
                                       accept="image/jpeg,image/png,image/webp"
                                       onchange="uploadUserAvatar(this)">
                                <span class="nav-sr-only">Changer la photo de profil</span>
                            </label>
                            <div class="udh-identity">
                                <span class="udh-name">${_navEsc(username)}</span>
                                <span class="udh-role ${isAdmin ? 'is-admin' : ''}">
                                    ${isAdmin ? `${NAV_ICON.shield}<span>Administrateur</span>` : '<span>Membre</span>'}
                                </span>
                            </div>
                        </div>

                        ${isAdmin ? `
                        <div class="dropdown-group">
                            <p class="dropdown-label">Administration</p>
                            <button type="button" class="dropdown-item" role="menuitem" onclick="ouvrirPhotosAdmin()">
                                <span class="dropdown-icon">${NAV_ICON.camera}</span>
                                <span class="dropdown-text">
                                    <span class="dropdown-title">Photos téléversées</span>
                                    <span class="dropdown-hint">Vérifier et retirer</span>
                                </span>
                            </button>
                        </div>
                        <div id="adminUsersList" class="dropdown-group"></div>` : ''}

                        <!-- Caché tant qu'installerApp.js ne sait pas que Fantazy
                             peut s'installer ici : déjà installée, ou navigateur
                             sans moyen de le faire, la rangée n'a rien à offrir. -->
                        <div class="dropdown-group" data-fz-installer-menu style="display: none;">
                            <p class="dropdown-label">Application</p>
                            <button type="button" class="dropdown-item" role="menuitem" data-fz-installer="menu">
                                <span class="dropdown-icon">${NAV_ICON.smartphone}</span>
                                <span class="dropdown-text">
                                    <span class="dropdown-title">Installer l'application</span>
                                    <span class="dropdown-hint">Fantazy en plein écran</span>
                                </span>
                            </button>
                        </div>

                        <!-- Les deux thèmes côte à côte : on voit celui qui est
                             actif, et le menu reste ouvert pendant la bascule. -->
                        <div class="dropdown-group">
                            <p class="dropdown-label" id="themeSwitchLabel">Apparence</p>
                            <div class="theme-switch" role="group" aria-labelledby="themeSwitchLabel">
                                <span class="theme-switch-thumb" aria-hidden="true"></span>
                                <button type="button" class="theme-switch-opt" role="menuitemradio"
                                        data-theme-choice="dark" aria-checked="${_themeIsDark()}" onclick="fzSetTheme('dark')">
                                    ${NAV_ICON.moon}<span>Sombre</span>
                                </button>
                                <button type="button" class="theme-switch-opt" role="menuitemradio"
                                        data-theme-choice="light" aria-checked="${!_themeIsDark()}" onclick="fzSetTheme('light')">
                                    ${NAV_ICON.sun}<span>Clair</span>
                                </button>
                            </div>
                        </div>

                        <!-- Les politiques quittent le pied de page de chaque écran
                             pour se ranger ici : un seul endroit, toujours à portée
                             une fois connecté. L'avis de non-affiliation, lui, reste
                             au pied des pages — il n'a de valeur que visible là où
                             s'affichent les noms et logos d'équipes. -->
                        <div class="dropdown-group">
                            <p class="dropdown-label">Légal</p>
                            <a href="confidentialite.html" class="dropdown-item" role="menuitem">
                                <span class="dropdown-icon">${NAV_ICON.shieldCheck}</span>
                                <span class="dropdown-text">
                                    <span class="dropdown-title">Politique de confidentialité</span>
                                    <span class="dropdown-hint">Ce qu'on collecte, et pourquoi</span>
                                </span>
                            </a>
                            <a href="conditions.html" class="dropdown-item" role="menuitem">
                                <span class="dropdown-icon">${NAV_ICON.fileText}</span>
                                <span class="dropdown-text">
                                    <span class="dropdown-title">Conditions d'utilisation</span>
                                    <span class="dropdown-hint">Les règles du service</span>
                                </span>
                            </a>
                        </div>

                        <div class="dropdown-group">
                            <p class="dropdown-label">Sécurité</p>
                            <button class="dropdown-item" role="menuitem" onclick="changerMotDePasse()">
                                <span class="dropdown-icon">${NAV_ICON.key}</span>
                                <span class="dropdown-text">
                                    <span class="dropdown-title">Changer mon mot de passe</span>
                                    <span class="dropdown-hint">Déconnecte vos autres appareils</span>
                                </span>
                            </button>
                        </div>

                        <div class="dropdown-group">
                            <p class="dropdown-label">Mes données</p>
                            <button class="dropdown-item" role="menuitem" onclick="exportMyData()">
                                <span class="dropdown-icon">${NAV_ICON.download}</span>
                                <span class="dropdown-text">
                                    <span class="dropdown-title">Télécharger mes données</span>
                                    <span class="dropdown-hint">Compte et pools, en JSON</span>
                                </span>
                            </button>
                            <button class="dropdown-item danger" role="menuitem" onclick="deleteMyAccount()">
                                <span class="dropdown-icon">${NAV_ICON.trash}</span>
                                <span class="dropdown-text">
                                    <span class="dropdown-title">Supprimer mon compte</span>
                                    <span class="dropdown-hint">Irréversible</span>
                                </span>
                            </button>
                        </div>

                        <div class="dropdown-footer">
                            <button class="dropdown-item logout" role="menuitem" onclick="logout()">
                                <span class="dropdown-icon">${NAV_ICON.logout}</span>
                                <span class="dropdown-title">Déconnexion</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Sous 1280px, les onglets passent en icônes seules (navbar.css) : leur
    // nom reste lisible au survol et pour les lecteurs d'écran.
    navbar.querySelectorAll('.nav-links .nav-link').forEach(lien => {
        const nom = lien.querySelector('.nav-text')?.textContent.trim();
        if (nom && !lien.title) { lien.title = nom; lien.setAttribute('aria-label', nom); }
    });
}

// ==================== MOBILE BOTTOM NAV ====================
// Cinq onglets (maquette « Fantazy Nav Options », 1b) :
// La barre suit l'état du pool actif (onglets conditionnels, plus bas) :
//   — saison, repêchage terminé : Accueil → Mon équipe → Classement → Stats ;
//   — avant ou pendant le repêchage : Accueil → Repêchage → Stats ;
//   — aucun pool : Accueil → Stats.
// Les échanges s'ouvrent depuis Mon équipe, qui porte la pastille des
// offres reçues ; les scores, depuis « Matchs ce soir » à l'accueil.
function buildBottomNav(currentPage) {
    const existing = document.querySelector('.bottom-nav');
    if (existing) existing.remove();

    // `data-page` : l'onglet que le lien représente, relu au retour arrière
    // (initToucherBas) et par fzNavActiver.
    const ongletActif = ongletDePage(currentPage);
    const onglet = (page, href, libelle, extra = '') => {
        const actif = page === ongletActif;
        return `
            <a href="${href}" class="bottom-nav-item${actif ? ' active' : ''}" data-page="${page}"${actif ? ' aria-current="page"' : ''}${extra}>
                <span class="bottom-nav-icon" aria-hidden="true">${iconeBarre(page)}</span>
                <span class="bottom-nav-label">${libelle}</span>`;
    };
    const html = `
        <nav class="bottom-nav" aria-label="Navigation principale">
            ${onglet('accueil', 'index.html', 'Accueil')}
            </a>
            ${onglet('repechage', 'repechage.html', 'Repêchage', ' id="bottomDraftLink"')}
                <span class="notif-badge" id="bottomDraftBadge" style="display: none;"></span>
            </a>
            ${onglet('equipe', 'classement.html?vue=equipe', 'Mon équipe', ' id="bottomEquipeLink"')}
                <span class="notif-badge" id="bottomTradeBadge" style="display: none;">0</span>
            </a>
            ${onglet('classement', 'classement.html', 'Classement', ' id="bottomClassementLink"')}
            </a>
            ${onglet('stats', 'stats.html', 'Stats')}
            </a>
        </nav>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

// ==================== BARRE DU BAS : LE TOUCHER ====================
/*
 * Maquette « Fantazy Nav Options », 1b « Ligne lumineuse » : pas
 * d'indicateur. L'icône pleine et blanche, qui monte un peu, et le
 * libellé disent seuls l'onglet choisi (navbar.css, « BARRE DU BAS »).
 *
 * Le toucher se voit avant le relâcher : l'onglet s'enfonce et une onde
 * part du doigt dès le pointerdown ; au clic, un tic haptique et l'onglet
 * touché prend tout de suite l'état choisi, sans attendre la page suivante.
 */
function mouvementReduit() {
    return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Un tic sous le doigt. Android a l'API de vibration ; Safari iOS ne l'a
 * pas, mais depuis iOS 18 basculer un <input switch> fait vibrer
 * l'appareil, et c'est la seule voie. Ailleurs, rien ne se passe.
 */
function ticHaptique() {
    try {
        if (navigator.vibrate) { navigator.vibrate(12); return; }
        const etiquette = document.createElement('label');
        etiquette.setAttribute('aria-hidden', 'true');
        etiquette.style.display = 'none';
        const bascule = document.createElement('input');
        bascule.type = 'checkbox';
        bascule.setAttribute('switch', '');
        etiquette.appendChild(bascule);
        document.head.appendChild(etiquette);
        etiquette.click();
        etiquette.remove();
    } catch { /* pas de tic : la couleur et l'onde suffisent */ }
}

/**
 * L'onde du toucher : un disque qui part du doigt et s'étend jusqu'au coin
 * le plus loin de l'onglet. Elle tient tant que le doigt reste posé ; la
 * fonction rendue l'efface. Sans point de contact (clavier), elle part du
 * centre.
 */
function ondeOnglet(onglet, point) {
    if (typeof onglet.animate !== 'function') return () => {};
    let calque = onglet.querySelector('.bottom-nav-waves');
    if (!calque) {
        calque = document.createElement('span');
        calque.className = 'bottom-nav-waves';
        calque.setAttribute('aria-hidden', 'true');
        onglet.prepend(calque);
    }
    const r = onglet.getBoundingClientRect();
    const x = point ? point.clientX - r.left : r.width / 2;
    const y = point ? point.clientY - r.top : r.height / 2;
    const rayon = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));
    const onde = document.createElement('span');
    onde.className = 'bottom-nav-wave';
    onde.style.cssText = `left:${x - rayon}px;top:${y - rayon}px;width:${2 * rayon}px;height:${2 * rayon}px`;
    calque.appendChild(onde);
    // Mouvement réduit : un éclat sur place, sans expansion.
    onde.animate(mouvementReduit()
        ? [{ transform: 'scale(1)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }]
        : [{ transform: 'scale(0)' }, { transform: 'scale(1)' }],
        { duration: mouvementReduit() ? 120 : 480, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'forwards' });
    let effacee = false;
    return () => {
        if (effacee) return;
        effacee = true;
        onde.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: 'ease-out', fill: 'forwards' })
            .onfinish = () => onde.remove();
    };
}

function initToucherBas(currentPage) {
    const nav = document.querySelector('.bottom-nav');
    if (!nav) return;
    const onglets = () => [...nav.querySelectorAll('.bottom-nav-item')];
    const choisir = actif => onglets().forEach(o => {
        o.classList.toggle('active', o === actif);
        if (o === actif) o.setAttribute('aria-current', 'page'); else o.removeAttribute('aria-current');
    });

    let relacher = null;
    const finContact = () => {
        nav.querySelectorAll('.bottom-nav-item.is-pressed').forEach(o => o.classList.remove('is-pressed'));
        if (relacher) { relacher(); relacher = null; }
    };
    nav.addEventListener('pointerdown', e => {
        const onglet = e.target.closest('.bottom-nav-item');
        if (!onglet || e.button !== 0) return;
        finContact();
        onglet.classList.add('is-pressed');
        relacher = ondeOnglet(onglet, e);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => nav.addEventListener(type, finContact));

    nav.addEventListener('click', e => {
        const onglet = e.target.closest('.bottom-nav-item');
        if (!onglet) return;
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        ticHaptique();
        // Au clavier, pas de pointerdown : l'onde part du centre.
        if (e.detail === 0) ondeOnglet(onglet, null)();
        if (!onglet.classList.contains('active')) choisir(onglet);
    });

    // Retour arrière depuis le cache : la page revient avec l'onglet
    // touché encore choisi. On rend l'état à la page.
    window.addEventListener('pageshow', e => {
        if (!e.persisted) return;
        relacher = null;
        nav.querySelectorAll('.bottom-nav-item.is-pressed').forEach(o => o.classList.remove('is-pressed'));
        nav.querySelectorAll('.bottom-nav-wave').forEach(o => o.remove());
        choisir(onglets().find(o => o.dataset.page === ongletDePage(_navPage)) || null);
    });
}

// ==================== USER AVATAR UPLOAD ====================
async function uploadUserAvatar(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const username = localStorage.getItem('username');
    if (!username) return;

    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('username', username);

    const base = window.location.hostname.includes('localhost') ? 'http://localhost:3000' : window.location.origin;

    try {
        const r = await fetch(`${base}/upload/user-avatar`, { method: 'POST', body: formData });
        const d = await r.json();
        if (!r.ok) {
            fzAlert({ type: 'error', title: 'Photo refusée', message: d.message || 'Le téléversement de la photo a échoué.' });
            return;
        }

        localStorage.setItem('avatarUrl', d.avatarUrl);
        // Update navbar avatar immediately
        const btn = document.getElementById('userAvatarBtn');
        if (btn) {
            btn.innerHTML = `<img src="${_navEsc(d.avatarUrl)}" class="user-avatar-img" alt="${_navEsc(username.charAt(0).toUpperCase())}" id="navAvatarImg">`;
        }
        // Close dropdown
        document.getElementById('userDropdownMenu')?.classList.remove('show');
    } catch (e) {
        fzAlert({ type: 'error', icon: 'offline', title: 'Connexion impossible', message: 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.' });
    }
    // Clear the input so the same file can be re-selected
    input.value = '';
}

// ==================== EVENT LISTENERS ====================
function initializeEventListeners(username, isAdmin) {
    const avatarBtn = document.getElementById('userAvatarBtn');
    const dropdown = document.getElementById('userDropdownMenu');

    if (avatarBtn && dropdown) {
        const setOpen = (open) => {
            dropdown.classList.toggle('show', open);
            avatarBtn.setAttribute('aria-expanded', String(open));
        };

        avatarBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            setOpen(!dropdown.classList.contains('show'));
        });

        document.addEventListener('click', function(e) {
            if (!e.target.closest('.user-menu')) setOpen(false);
        });

        // Échap ferme le menu et rend le focus au bouton : sans ça, la
        // navigation au clavier se retrouve coincée en bas de page.
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && dropdown.classList.contains('show')) {
                setOpen(false);
                avatarBtn.focus();
            }
        });
    }

    if (isAdmin) loadAdminUsers();
}

// ==================== ADMIN FUNCTIONS ====================
async function loadAdminUsers() {
    try {
        const baseUrl = window.location.hostname.includes('localhost') ? 'http://localhost:3000' : window.location.origin;
        const response = await fetch(`${baseUrl}/admin-users`);
        const data = await response.json();

        if (response.ok) {
            // Tous les comptes, pas les cinq premiers : une liste tronquée sans
            // le dire laisse chercher un nom qui ne s'affichera jamais. C'est la
            // hauteur du panneau qui borne l'affichage, et il défile.
            //
            // Seul le compte actif est retiré — basculer vers soi-même ne veut
            // rien dire. Le compte d'administration, lui, reste dans la liste :
            // c'est par là qu'on rentre chez soi après un dépannage.
            const actif = localStorage.getItem('username') || '';
            const users = data.users.filter(u => u !== actif);
            const container = document.getElementById('adminUsersList');
            if (container && users.length > 0) {
                const etiquette = document.createElement('p');
                etiquette.className = 'dropdown-label';
                etiquette.textContent = `Changer d'utilisateur (${users.length})`;

                const liste = document.createElement('div');
                liste.className = 'admin-users-scroll';

                // Les noms passent par textContent et par un attribut de
                // données, jamais par une chaîne de HTML ni par un `onclick`
                // interpolé : un nom contenant une apostrophe cassait le
                // bouton, et un nom contenant du balisage faisait pire.
                for (const u of users) {
                    const bouton = document.createElement('button');
                    bouton.className = 'dropdown-item';
                    bouton.type = 'button';
                    bouton.setAttribute('role', 'menuitem');
                    bouton.dataset.username = u;

                    const icone = document.createElement('span');
                    icone.className = 'dropdown-icon';
                    const vignette = document.createElement('img');
                    vignette.src = 'Icons/grayUser.png';
                    vignette.alt = '';
                    vignette.className = 'dropdown-user-thumb';
                    icone.appendChild(vignette);

                    const nom = document.createElement('span');
                    nom.className = 'dropdown-title';
                    nom.textContent = u;

                    bouton.append(icone, nom);
                    bouton.addEventListener('click', () => switchToUser(u));
                    liste.appendChild(bouton);
                }

                container.replaceChildren(etiquette, liste);
            }
        }
    } catch (error) {
        console.error('Error loading admin users:', error);
    }
}

// L'écran des photos téléversées ne sert qu'à l'administration : son code
// (adminPhotos.js) n'est téléchargé qu'au premier clic, pas sur chaque page
// de chaque membre. Changer adminPhotos.js/.css demande d'avancer ce tampon.
const ADMIN_PHOTOS_VERSION = '20260929';
let _adminPhotosChargement = null;

async function ouvrirPhotosAdmin() {
    document.getElementById('userDropdownMenu')?.classList.remove('show');
    document.getElementById('userAvatarBtn')?.setAttribute('aria-expanded', 'false');

    const pilote = await piloteDeLaBascule();
    if (pilote) return proposerRetourPourPhotos(pilote);

    if (!_adminPhotosChargement) {
        _adminPhotosChargement = new Promise((resolve, reject) => {
            const feuille = document.createElement('link');
            feuille.rel = 'stylesheet';
            feuille.href = `adminPhotos.css?v=${ADMIN_PHOTOS_VERSION}`;
            document.head.appendChild(feuille);

            const script = document.createElement('script');
            script.src = `adminPhotos.js?v=${ADMIN_PHOTOS_VERSION}`;
            script.onload = resolve;
            script.onerror = () => { _adminPhotosChargement = null; script.remove(); reject(new Error('adminPhotos.js')); };
            document.head.appendChild(script);
        });
    }
    _adminPhotosChargement
        .then(() => window.fzAdminPhotos.ouvrir())
        .catch(() => fzAlert({ type: 'error', icon: 'offline', title: 'Connexion impossible', message: 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.' }));
}

// ==================== BASCULE D'ADMINISTRATION ====================
// Après « Changer d'utilisateur », la session EST celle du compte visité : le
// serveur lui refuse l'administration (requireBascule, middleware/auth.js)
// pour que le dépannage montre ce que la personne voit vraiment. localStorage
// garde pourtant l'isAdmin du compte d'origine : le menu affichait
// « Administrateur » et des outils que le serveur refusait. /session dit qui
// on est — lue une fois par page, et seulement pour l'administration.
let _sessionAdmin = null;

function lireSessionAdmin() {
    if (!_sessionAdmin) {
        _sessionAdmin = fetch(`${navbarBaseUrl()}/session`, { cache: 'no-store' })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null);
    }
    return _sessionAdmin;
}

/** Le compte administrateur qui pilote la bascule en cours, ou null. */
async function piloteDeLaBascule() {
    const session = await lireSessionAdmin();
    return session && session.authenticated && session.impersonatedBy && !session.isAdmin
        ? session.impersonatedBy
        : null;
}

async function verifierBascule() {
    const pilote = await piloteDeLaBascule();
    if (pilote) {
        const role = document.querySelector('.udh-role');
        if (role) {
            role.classList.remove('is-admin');
            role.innerHTML = `${NAV_ICON.shield}<span></span>`;
            role.querySelector('span').textContent = `Bascule depuis ${pilote}`;
        }
    }

    // Revenu d'une bascule pour vérifier les photos : l'écran se rouvre.
    let rouvrir = false;
    try {
        rouvrir = sessionStorage.getItem('fzOuvrirPhotos') === '1';
        sessionStorage.removeItem('fzOuvrirPhotos');
    } catch { /* stockage indisponible : on n'insiste pas */ }
    const session = await lireSessionAdmin();
    if (rouvrir && session && session.isAdmin) ouvrirPhotosAdmin();
}

/** Les photos se vérifient depuis le compte administrateur : on propose d'y revenir. */
async function proposerRetourPourPhotos(pilote) {
    const visite = localStorage.getItem('username') || '';
    const ok = await fzConfirm({
        title: `Revenir à ${pilote} ?`,
        message: `Vous naviguez en ce moment en tant que ${visite}. Les photos se vérifient depuis votre compte administrateur : on y revient, puis l’écran s’ouvre.`,
        confirmLabel: `Revenir à ${pilote}`,
        icon: 'swap'
    });
    if (!ok) return;
    try { sessionStorage.setItem('fzOuvrirPhotos', '1'); } catch { /* il faudra recliquer */ }
    switchToUser(pilote);
}

async function switchToUser(username) {
    try {
        const baseUrl = window.location.hostname.includes('localhost') ? 'http://localhost:3000' : window.location.origin;
        const response = await fetch(`${baseUrl}/admin-switch-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUsername: username })
        });

        if (response.ok) {
            localStorage.setItem('username', username);
            localStorage.removeItem('avatarUrl');
            window.location.reload();
        } else {
            fzAlert({ type: 'error', title: 'Changement impossible', message: 'Le changement d’utilisateur a échoué.' });
        }
    } catch (error) {
        console.error('Error switching user:', error);
        fzAlert({ type: 'error', icon: 'offline', title: 'Connexion impossible', message: 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.' });
    }
}

// ==================== NOTIFICATION BADGES ====================

/** Affiche ou masque une pastille sur les deux barres à la fois. */
function setNavBadge(ids, valeur) {
    ids.forEach(id => {
        const badge = document.getElementById(id);
        if (!badge) return;
        if (valeur == null) { badge.style.display = 'none'; return; }
        badge.textContent = valeur;
        badge.style.display = 'flex';
    });
}

// Échanges en attente dans le pool actif.
async function checkPendingTrades() {
    try {
        const baseUrl = window.location.hostname.includes('localhost') ? 'http://localhost:3000' : window.location.origin;
        const username = localStorage.getItem('username');
        if (!username) return;

        const response = await fetch(`${baseUrl}/trades/pending/${username}`);
        if (!response.ok) return;
        const data = await response.json();
        if (!Array.isArray(data)) return;

        let echanges = data;
        if (window.FZPool) {
            await FZPool.ready();
            const actif = FZPool.get();
            if (actif) echanges = data.filter(t => t.draftName === actif);
        }

        // Le rail (poolNav.js) se redessine souvent : il relit ce compte à
        // chaque rendu plutôt que de dépendre de l'ordre des mises à jour.
        window.fzEchangesEnAttente = echanges.length;
        // « ficheTradeBadge » : le bouton « Échanges » de la fiche de mon
        // équipe (classement.js), quand elle est à l'écran.
        setNavBadge(['desktopTradeBadge', 'bottomTradeBadge', 'railTradeBadge', 'ficheTradeBadge'],
                    echanges.length > 0 ? echanges.length : null);
    } catch (error) {
        console.error('Error checking pending trades:', error);
    }
}

// ==================== ONGLETS CONDITIONNELS ====================
/*
 * Trois onglets dépendent de l'état du pool actif — Repêchage d'un côté,
 * Mon équipe et Classement de l'autre — et cet état n'arrive qu'avec /draft,
 * un aller-retour réseau après la construction de la barre. Les afficher
 * puis les retirer laissait voir, le temps d'un battement, un « Classement »
 * qui n'ouvrira pas et un « Repêchage » déjà terminé.
 *
 * On retient donc la dernière réponse connue, par pool, et on l'applique
 * dans la foulée de la construction — même tâche, donc avant le premier
 * rendu. FZPool.ready() la confirme ou la corrige ensuite. Seule la toute
 * première visite sur un pool n'a rien en mémoire ; elle retombe sur
 * l'ancien comportement.
 */
const NAV_ONGLETS_CONDITIONNELS = {
    repechage: ['desktopPoolLink', 'bottomDraftLink'],
    // Mon équipe suit Classement : avant la fin du repêchage, la fiche d'une
    // équipe n'est pas plus lisible que le classement.
    classement: ['desktopClassementLink', 'bottomClassementLink', 'desktopEquipeLink', 'bottomEquipeLink']
};

/**
 * La mémoire est par pool : passer d'un pool en plein repêchage à un pool
 * terminé n'a pas les mêmes onglets. activePool.js écrit `activePool` de
 * façon synchrone, avant tout appel réseau, donc la clé est déjà juste ici.
 */
function navCleVisibilite() {
    return `fzNavOnglets:${localStorage.getItem('activePool') || ''}`;
}

function navVisibiliteMemorisee() {
    try { return JSON.parse(localStorage.getItem(navCleVisibilite())) || {}; }
    catch { return {}; }
}

function navAppliquerVisibilite(cle, visible) {
    NAV_ONGLETS_CONDITIONNELS[cle].forEach(id => {
        const lien = document.getElementById(id);
        if (lien) lien.style.display = visible ? '' : 'none';
    });
}

/** Réponse confirmée : on l'applique et on s'en souvient pour la page suivante. */
function navRetenirVisibilite(cle, visible) {
    navAppliquerVisibilite(cle, visible);
    const memoire = navVisibiliteMemorisee();
    if (memoire[cle] === visible) return;
    memoire[cle] = visible;
    try { localStorage.setItem(navCleVisibilite(), JSON.stringify(memoire)); } catch { /* stockage plein ou refusé */ }
}

/**
 * Seuls les onglets connus fermés sont repliés : ce qu'on ignore reste
 * visible. Un onglet montré à tort disparaît une seconde plus tard, alors
 * qu'un onglet caché à tort laisse l'utilisateur sans porte.
 */
function appliquerVisibiliteMemorisee() {
    const memoire = navVisibiliteMemorisee();
    Object.keys(NAV_ONGLETS_CONDITIONNELS).forEach(cle => {
        if (memoire[cle] === false) navAppliquerVisibilite(cle, false);
    });
}

/**
 * Le repêchage du pool actif réclame-t-il une action ?
 *
 * La pastille porte « ! » et non un nombre : le lien mène à un seul
 * repêchage, il n'y a rien à compter. L'état lui-même est calculé par
 * activePool.js, seul endroit à connaître la règle.
 */
async function checkActiveDrafts() {
    try {
        if (!window.FZPool) return;
        await FZPool.ready();

        const actif = FZPool.get();
        const pool = FZPool.mine().find(p => p.name === actif);
        if (!pool) { setNavBadge(['desktopDraftBadge', 'bottomDraftBadge'], null); return; }

        const etat = FZPool.draftState(pool.data);
        const aSignaler = etat.etat === 'encours' || etat.etat === 'pret';
        // Chaîne vide et non « ! » : la pastille devient un simple point
        // (.notif-badge:empty en CSS) — un repêchage actif n'a rien à
        // compter, contrairement aux échanges en attente.
        setNavBadge(['desktopDraftBadge', 'bottomDraftBadge'], aSignaler ? '' : null);
    } catch (error) {
        console.error('Error checking active drafts:', error);
    }
}

/**
 * Le lien « Repêchage » n'est dans les barres que tant que le pool actif
 * repêche : c'est alors la seule chose à y faire, et il prend la place de
 * Mon équipe et de Classement. Une fois le repêchage terminé, la salle ne
 * prend plus de choix et repechage.html n'est plus qu'un panneau indicateur.
 * Les écrans eux-mêmes referment la porte (fermerLeRepechageSiTermine dans
 * activePool.js) — ceci ne fait qu'enlever l'onglet qui y menait.
 *
 * Sans pool, le lien tombe aussi : il n'y a rien à repêcher, l'accueil
 * propose de rejoindre ou de créer un pool.
 */
async function updateDraftLinkVisibility() {
    try {
        if (!window.FZPool) { navAppliquerVisibilite('repechage', true); return; }
        await FZPool.ready();

        const actif = FZPool.get();
        const pool = FZPool.mine().find(p => p.name === actif);
        const visible = !!pool && FZPool.draftState(pool.data).etat !== 'termine';

        navRetenirVisibilite('repechage', visible);
    } catch (error) {
        console.error('Error checking draft link visibility:', error);
        navAppliquerVisibilite('repechage', true);
    }
}

/**
 * Les liens « Mon équipe » et « Classement » n'apparaissent qu'une fois le
 * repêchage du pool actif terminé — l'inverse du lien « Repêchage ».
 *
 * Tant qu'on repêche, les effectifs sont à moitié bâtis : un classement des
 * équipes n'y compterait que les joueurs déjà choisis, et placerait en tête
 * celui qui a simplement repêché le plus tôt dans le tour. Ce n'est pas un
 * classement, c'est le hasard de l'ordre des choix. L'accueil l'annonce déjà
 * pendant le repêchage (« Le classement s'ouvre une fois le repêchage
 * terminé. ») ; ici on retire les onglets qui y menaient, et classement.html
 * referme la porte de son côté (activePool.js) pour les URL tapées.
 *
 * Sans pool, le lien tombe aussi : il n'y a rien à classer, et
 * classement.html renvoie à l'accueil.
 */
async function updateClassementLinkVisibility() {
    try {
        if (!window.FZPool) { navAppliquerVisibilite('classement', true); return; }
        await FZPool.ready();

        const actif = FZPool.get();
        const pool = FZPool.mine().find(p => p.name === actif);
        const visible = !!pool && FZPool.draftState(pool.data).etat === 'termine';

        navRetenirVisibilite('classement', visible);
    } catch (error) {
        console.error('Error checking classement link visibility:', error);
        navAppliquerVisibilite('classement', true);
    }
}

// ==================== LOGOUT ====================
/**
 * Déconnexion.
 *
 * Effacer localStorage ne déconnectait rien : la session vivait dans un cookie
 * que le serveur continuait d'accepter. On la révoque d'abord, et le serveur
 * périme le cookie dans sa réponse. Le nettoyage local suit — il ne fait que
 * remettre l'affichage d'aplomb.
 *
 * Même en cas d'échec réseau, on nettoie et on recharge : rester sur un écran
 * qui se croit connecté serait pire, et le cookie finira par expirer.
 */
async function logout(event) {
    if (event && event.preventDefault) event.preventDefault();
    await retirerAlertesAppareil();
    try {
        await fetch(`${typeof BASE_URL !== 'undefined' ? BASE_URL : ''}/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
    } catch { /* le cookie expirera de lui-même */ }

    ['isLoggedIn', 'username', 'isAdmin', 'activeUser', 'avatarUrl', 'activePool', 'draftClan', 'fzAlertes:v1']
        .forEach(cle => localStorage.removeItem(cle));
    window.location.href = 'index.html';
}

/**
 * Les alertes sur l'appareil suivent le compte, pas le navigateur : après la
 * déconnexion, un appareil partagé ne doit plus annoncer les tours de la
 * personne partie. Le serveur oublie l'abonnement (avant /logout, tant que la
 * session vaut encore), et le navigateur le détruit. Borné : une déconnexion
 * n'attend pas un réseau lent plus d'une seconde et demie.
 */
async function retirerAlertesAppareil() {
    try {
        if (!('serviceWorker' in navigator)) return;
        const enregistrement = await navigator.serviceWorker.getRegistration('/');
        const abonnement = enregistrement && enregistrement.pushManager
            ? await enregistrement.pushManager.getSubscription()
            : null;
        if (!abonnement) return;
        await Promise.race([
            fetch(`${typeof BASE_URL !== 'undefined' ? BASE_URL : ''}/api/push/unsubscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: abonnement.endpoint })
            }).catch(() => {}),
            new Promise(resolve => setTimeout(resolve, 1500))
        ]);
        await abonnement.unsubscribe();
    } catch { /* le service de push répondra 410 au prochain envoi */ }
}


// ==================== DROITS SUR LES DONNÉES (LOI 25) ====================
// Le mot de passe est redemandé : /account/export expose l'ensemble des
// renseignements et /account/delete est irréversible.

function navbarBaseUrl() {
    return window.location.hostname.includes('localhost')
        ? 'http://localhost:3000'
        : window.location.origin;
}

// fzModal(), fzNotice(), fzAlert(), fzConfirm() : fzDialog.js, chargé sur
// toutes les pages avant ce fichier.


/**
 * Faux pour un compte ouvert par Google : il n'a pas de mot de passe, et la
 * confirmation se fait en retapant son nom d'utilisateur. En cas de doute
 * (serveur injoignable), on suppose un mot de passe, le cas le plus courant.
 */
async function compteAMotDePasse() {
    try {
        const res = await fetch(`${navbarBaseUrl()}/session`, { cache: 'no-store' });
        const session = await res.json();
        return session.hasPassword !== false;
    } catch {
        return true;
    }
}

/**
 * Changer son mot de passe (POST /account/password). Le serveur ferme les
 * autres sessions du compte et garde celle-ci ouverte.
 */
async function changerMotDePasse() {
    const username = localStorage.getItem('username');
    if (!username) return;

    if (!(await compteAMotDePasse())) {
        await fzAlert({
            type: 'info',
            icon: 'lock',
            title: 'Connexion avec Google',
            message: "Ce compte se connecte avec Google : il n'a pas de mot de passe à changer."
        });
        return;
    }

    const change = await fzModal({
        title: 'Changer mon mot de passe',
        bodyHTML: `<p>Au moins 6 caractères, et pas un mot de passe trop courant.
            Vos autres appareils seront déconnectés.</p>`,
        confirmLabel: 'Changer',
        icon: 'lock',
        align: 'start',
        fields: [
            { name: 'actuel', type: 'password', label: 'Mot de passe actuel', autocomplete: 'current-password' },
            { name: 'nouveau', type: 'password', label: 'Nouveau mot de passe', autocomplete: 'new-password' },
            { name: 'confirmation', type: 'password', label: 'Confirmer le nouveau mot de passe', autocomplete: 'new-password' }
        ],
        onSubmit: async (valeurs) => {
            if (valeurs.nouveau !== valeurs.confirmation) {
                return 'Les deux nouveaux mots de passe ne correspondent pas.';
            }
            try {
                const res = await fetch(`${navbarBaseUrl()}/account/password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ currentPassword: valeurs.actuel, newPassword: valeurs.nouveau })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) return data.message || 'Changement impossible.';
                return null;
            } catch (err) {
                console.error('Erreur changement de mot de passe :', err);
                return 'Impossible de joindre le serveur.';
            }
        }
    });
    if (!change) return;

    await fzAlert({
        type: 'success',
        title: 'Mot de passe changé',
        message: 'Vos autres appareils ont été déconnectés.'
    });
}

/** Le corps envoyé à /account/export et /account/delete. */
function corpsConfirmation(username, motDePasse, valeur) {
    return motDePasse ? { username, password: valeur } : { username, confirmation: valeur };
}

async function exportMyData() {
    const username = localStorage.getItem('username');
    if (!username) return;
    const motDePasse = await compteAMotDePasse();

    await fzModal({
        title: 'Télécharger mes données',
        bodyHTML: `
            <p>Vous obtiendrez un fichier <strong>JSON</strong> contenant votre compte
            et vos participations aux pools.</p>
            <p>Votre mot de passe n'est jamais inclus dans l'export.</p>
            <p>${motDePasse
                ? 'Confirmez votre mot de passe pour continuer :'
                : "Saisissez votre nom d'utilisateur pour continuer :"}</p>`,
        confirmLabel: 'Télécharger',
        icon: 'download',
        align: 'start',
        password: motDePasse,
        confirmation: !motDePasse,
        onSubmit: async (valeur) => {
            try {
                const res = await fetch(`${navbarBaseUrl()}/account/export`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(corpsConfirmation(username, motDePasse, valeur))
                });
                const data = await res.json();
                if (!res.ok) return data.message || 'Export impossible.';

                const blob = new Blob([JSON.stringify(data, null, 2)],
                    { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `fantazy-donnees-${username}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                return null;
            } catch (err) {
                console.error('Erreur export :', err);
                return 'Impossible de joindre le serveur.';
            }
        }
    });
}

async function deleteMyAccount() {
    const username = localStorage.getItem('username');
    if (!username) return;

    // Étape 1 : avertissement clair, sans champ de saisie. On sépare la prise de
    // décision de la confirmation d'identité pour éviter une suppression réflexe.
    const confirme = await fzModal({
        title: 'Supprimer mon compte',
        bodyHTML: `
            <p>Cette action est <strong>irréversible</strong>. Elle entraîne :</p>
            <ul>
                <li>la suppression de votre compte et de votre photo de profil ;</li>
                <li>votre retrait de tous vos pools.</li>
            </ul>
            <p>Vos sélections passées restent visibles dans l'historique des pools,
            dissociées de votre compte, pour ne pas fausser le classement des autres
            participants.</p>
            <p>Vous pouvez d'abord utiliser <strong>« Télécharger mes données »</strong>
            pour en conserver une copie.</p>`,
        confirmLabel: 'Continuer',
        icon: 'trash',
        align: 'start',
        danger: true
    });
    if (!confirme) return;

    // Étape 2 : confirmation d'identité.
    const motDePasse = await compteAMotDePasse();
    const supprime = await fzModal({
        title: 'Confirmer la suppression',
        bodyHTML: motDePasse
            ? '<p>Saisissez votre mot de passe pour supprimer définitivement votre compte.</p>'
            : "<p>Saisissez votre nom d'utilisateur pour supprimer définitivement votre compte.</p>",
        confirmLabel: 'Supprimer définitivement',
        icon: 'lock',
        danger: true,
        password: motDePasse,
        confirmation: !motDePasse,
        onSubmit: async (valeur) => {
            try {
                const res = await fetch(`${navbarBaseUrl()}/account/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(corpsConfirmation(username, motDePasse, valeur))
                });
                const data = await res.json();
                if (!res.ok) return data.message || 'Suppression impossible.';
                return null;
            } catch (err) {
                console.error('Erreur suppression :', err);
                return 'Impossible de joindre le serveur.';
            }
        }
    });
    if (!supprime) return;

    await fzAlert({
        type: 'success',
        title: 'Compte supprimé',
        message: "Votre compte a été supprimé. Merci d'avoir utilisé Fantazy.",
        confirmLabel: "Retour à l'accueil"
    });
    localStorage.clear();
    window.location.href = 'index.html';
}

// ==================== PIED DE PAGE / MENTIONS LÉGALES ====================
// Avis de non-affiliation : obligatoire pour appuyer l'usage nominatif des
// marques et logos d'équipes. Injecté sur toutes les pages via la navbar —
// il ne protège que là où les noms et logos s'affichent, donc il y reste.
//
// Les liens vers les politiques, eux, n'ont pas à se répéter au bas de
// chaque écran : une fois connecté, le menu du compte les porte. On ne les
// garde ici que pour le visiteur, qui n'a pas ce menu — et pour qui
// l'accueil est souvent le seul point d'entrée vers les politiques.
// (login.html et signup.html gardent les leurs, au moment de la collecte.)
function renderLegalFooter() {
    if (document.querySelector('.site-legal-footer')) return;

    const invite = localStorage.getItem('isLoggedIn') !== 'true';
    const year = new Date().getFullYear();
    const liens = invite
        ? `<a href="confidentialite.html">Politique de confidentialité</a>
           <span aria-hidden="true">·</span>
           <a href="conditions.html">Conditions d'utilisation</a>
           <span aria-hidden="true">·</span>`
        : '';
    const html = `
        <footer class="site-legal-footer">
            <p class="legal-disclaimer">
                Fantazy est un service indépendant, <strong>sans aucune affiliation
                avec la Ligue nationale de hockey</strong>, ses équipes ou l'AJLNH,
                et n'est ni commandité ni approuvé par elles. Les noms d'équipes,
                logos et photographies demeurent la propriété de leurs titulaires
                respectifs et sont utilisés à des fins d'identification seulement.
                Les statistiques proviennent de sources publiques.
            </p>
            <p class="legal-links">
                ${liens}
                <span class="legal-copy">© ${year} Fantazy</span>
            </p>
        </footer>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    surveillerPiedDePage();
}

/**
 * Repousse le pied de page sous la ligne de flottaison.
 *
 * Les mentions légales n'ont pas à accueillir qui arrive : sur les pages
 * courtes — un repêchage en attente, un seul pool — elles se retrouvaient
 * dans le premier écran, juste sous le contenu. On les descend d'autant
 * qu'il manque pour que leur bord supérieur touche le bas de la fenêtre.
 * Sur une page déjà longue, aucune marge n'est ajoutée.
 */
let _ajustePied = false;

function ajusterPiedDePage() {
    const pied = document.querySelector('.site-legal-footer');
    if (!pied) return;

    // Le repêchage actif et les échanges ont un onglet « Aperçu » assez
    // court pour déclencher cette poussée — mais là, on VEUT voir le pied
    // de page tout de suite : le repousser sous la ligne de flottaison le
    // rendait invisible sans faire défiler, ce qui a été signalé comme un
    // problème sur ces deux pages précisément.
    if (document.body.classList.contains('fz-draft') || /\/trade\.html$/i.test(location.pathname)) {
        pied.style.marginTop = '';
        return;
    }

    _ajustePied = true;

    // On rend d'abord la main à la feuille de style : sans ça la marge
    // du passage précédent s'ajouterait à elle-même, et l'écart voulu
    // par le design (48px, 32px sur téléphone) serait perdu.
    pied.style.marginTop = '';
    const base = parseFloat(getComputedStyle(pied).marginTop) || 0;
    const hautDuPied = pied.getBoundingClientRect().top + window.scrollY;
    const manque = Math.ceil(window.innerHeight - hautDuPied);
    const marge = manque > 0 ? `${base + manque}px` : '';

    if (pied.style.marginTop !== marge) pied.style.marginTop = marge;

    requestAnimationFrame(() => { _ajustePied = false; });
}

function surveillerPiedDePage() {
    ajusterPiedDePage();

    // Le contenu arrive après coup presque partout : squelettes remplacés,
    // images chargées, rail latéral monté. La marge doit suivre.
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => {
            if (!_ajustePied) ajusterPiedDePage();
        }).observe(document.body);
    }
    window.addEventListener('resize', ajusterPiedDePage);
    window.addEventListener('load', ajusterPiedDePage);
}

// ==================== INIT ====================
// Sans `defer`, pendant l'analyse : les barres tout de suite. Le reste
// (écouteurs, pastilles, FZPool) attend comme avant que le DOM soit complet.
if (document.readyState === 'loading') construireBarres();
document.addEventListener('DOMContentLoaded', () => {
    initModernNavbar();
    renderLegalFooter();
});
