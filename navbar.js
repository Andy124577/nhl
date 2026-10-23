// ==================== PAGE DETECTION ====================
function getCurrentPage() {
    const n = window.location.pathname;
    if (n.includes('index.html') || n.endsWith('/')) return 'accueil';
    if (n.includes('stats.html')) return 'stats';
    // Toutes les étapes du repêchage partagent le même onglet : la salle de
    // repêchage n'est qu'un écran de plus sous « Repêchage ».
    if (n.includes('repechage.html') || n.includes('draft.html') ||
        n.includes('draftActif.html') || n.includes('draftFini.html')) return 'repechage';
    if (n.includes('classement.html')) return 'classement';
    if (n.includes('trade.html')) return 'trade';
    // Une feuille de match s'ouvre depuis le calendrier : elle en garde l'onglet.
    if (n.includes('calendrier.html') || n.includes('match.html')) return 'calendrier';
    // Créer, rejoindre et la page du pool actif vivent sous le menu
    // « Pools », avec la liste des pools dont on est membre.
    if (n.includes('creer-pool.html') || n.includes('rejoindre-pool.html') ||
        /(^|\/)pool\.html$/.test(n)) return 'pools';
    return '';
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
        updateTradeLinkVisibility();
        updateDraftLinkVisibility();
        updateClassementLinkVisibility();
        // Les pastilles parlent du pool actif : elles le suivent quand il change.
        if (window.FZPool) {
            const majPastilles = () => {
                checkPendingTrades(); checkActiveDrafts();
                updateTradeLinkVisibility(); updateDraftLinkVisibility();
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
    fileText: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>`,
    smartphone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>`,
    sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>`,
    moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.1A8.5 8.5 0 1 1 9.9 3.5a6.6 6.6 0 0 0 10.6 10.6z"/></svg>`
};

// Les 5 sections du site, dans l'ordre affiché partout (barre du haut,
// barre du bas, tiroir des pools) : mêmes silhouettes, seule la couleur
// suit currentColor pour s'accorder au thème et à l'état actif/survol.
const PAGE_ICON = {
    accueil: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>`,
    repechage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>`,
    echanges: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>`,
    classement: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 21V9a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v12"/><path d="M8.5 13h-5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h17a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-5"/><path d="M12 .6l.76 1.95 2.09.12-1.61 1.33.52 2.03L12 4.9l-1.76 1.13.52-2.03-1.61-1.33 2.09-.12z" fill="currentColor" stroke="none"/></svg>`,
    stats: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>`,
    pools: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/></svg>`,
    calendrier: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4.5" width="20" height="15" rx="2.5"/><path d="M6 10.25 7.5 8.75v6.5"/><rect x="15.25" y="8.75" width="3.5" height="6.5" rx="1.75"/><path d="M12 10.5h.01M12 13.5h.01"/></svg>`
};

// La barre du bas (téléphone) : Material Symbols arrondis, en SVG en ligne
// pour ne pas charger une police d'icônes de plus. Chaque onglet a deux
// tracés, contour au repos et plein une fois choisi (navbar.css).
const BARRE_ICON = {
    accueil: ['M220-180h150v-220q0-12.75 8.63-21.38Q387.25-430 400-430h160q12.75 0 21.38 8.62Q590-412.75 590-400v220h150v-390L480-765 220-570v390Zm-60 0v-390q0-14.25 6.38-27 6.37-12.75 17.62-21l260-195q15.68-12 35.84-12Q500-825 516-813l260 195q11.25 8.25 17.63 21 6.37 12.75 6.37 27v390q0 24.75-17.62 42.37Q764.75-120 740-120H560q-12.75 0-21.37-8.63Q530-137.25 530-150v-220H430v220q0 12.75-8.62 21.37Q412.75-120 400-120H220q-24.75 0-42.37-17.63Q160-155.25 160-180Zm320-293Z',
        'M160-180v-390q0-14.25 6.38-27 6.37-12.75 17.62-21l260-195q15.68-12 35.84-12Q500-825 516-813l260 195q11.25 8.25 17.63 21 6.37 12.75 6.37 27v390q0 24.75-17.62 42.37Q764.75-120 740-120H590q-12.75 0-21.37-8.63Q560-137.25 560-150v-220q0-12.75-8.62-21.38Q542.75-400 530-400H430q-12.75 0-21.37 8.62Q400-382.75 400-370v220q0 12.75-8.62 21.37Q382.75-120 370-120H220q-24.75 0-42.37-17.63Q160-155.25 160-180Z'],
    echanges: ['M327-359h163q13 0 21.5-8.5T520-389q0-13-8.5-21.5T490-419H327l63-63q9-9 9-21.5t-9-21.5q-9-9-21.5-9t-21.5 9L232-410q-9 9-9 21t9 21l115 115q9 9 21.5 8.5T390-254q9-9 9-21.5t-9-21.5l-63-62Zm306-174-63 63q-9 9-9 21.5t9 21.5q9 9 21.5 9t21.5-9l115-115q9-9 9-21t-9-21L614-698q-9-9-21.5-9.5T571-699q-9 9-9 22t9 22l62 62H470q-13 0-21.5 8.5T440-563q0 13 8.5 21.5T470-533h163ZM480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-156t86-127Q252-817 325-848.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 82-31.5 155T763-197.5q-54 54.5-127 86T480-80Zm0-60q142 0 241-99.5T820-480q0-142-99-241t-241-99q-141 0-240.5 99T140-480q0 141 99.5 240.5T480-140Zm0-340Z',
        'M327-359h163q13 0 21.5-8.5T520-389q0-13-8.5-21.5T490-419H327l63-63q9-9 9-21.5t-9-21.5q-9-9-21.5-9t-21.5 9L232-410q-9 9-9 21t9 21l115 115q9 9 21.5 8.5T390-254q9-9 9-21.5t-9-21.5l-63-62Zm306-174-63 63q-9 9-9 21.5t9 21.5q9 9 21.5 9t21.5-9l115-115q9-9 9-21t-9-21L614-698q-9-9-21.5-9.5T571-699q-9 9-9 22t9 22l62 62H470q-13 0-21.5 8.5T440-563q0 13 8.5 21.5T470-533h163ZM480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-156t86-127Q252-817 325-848.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 82-31.5 155T763-197.5q-54 54.5-127 86T480-80Z'],
    classement: ['M140-180h187v-360H140v360Zm247 0h186v-600H387v600Zm246 0h187v-280H633v280Zm-553 0v-360q0-24.75 17.63-42.38Q115.25-600 140-600h187v-180q0-24.75 17.63-42.38Q362.25-840 387-840h186q24.75 0 42.38 17.62Q633-804.75 633-780v260h187q24.75 0 42.38 17.62Q880-484.75 880-460v280q0 24.75-17.62 42.37Q844.75-120 820-120H140q-24.75 0-42.37-17.63Q80-155.25 80-180Z',
        'M110-120q-12.75 0-21.37-8.63Q80-137.25 80-150v-420q0-12.75 8.63-21.38Q97.25-600 110-600h150q12.75 0 21.38 8.62Q290-582.75 290-570v420q0 12.75-8.62 21.37Q272.75-120 260-120H110Zm295 0q-12.75 0-21.37-8.63Q375-137.25 375-150v-660q0-12.75 8.63-21.38Q392.25-840 405-840h150q12.75 0 21.38 8.62Q585-822.75 585-810v660q0 12.75-8.62 21.37Q567.75-120 555-120H405Zm295 0q-12.75 0-21.37-8.63Q670-137.25 670-150v-340q0-12.75 8.63-21.38Q687.25-520 700-520h150q12.75 0 21.38 8.62Q880-502.75 880-490v340q0 12.75-8.62 21.37Q862.75-120 850-120H700Z'],
    calendrier: ['M608-365q-14 0-24.5-10.5T573-400v-160q0-14 10.5-24.5T608-595h99q14 0 24.5 10.5T742-560v160q0 14-10.5 24.5T707-365h-99Zm15-50h69v-130h-69v130Zm-355 0h94q10.83 0 17.92 7.12 7.08 7.11 7.08 18 0 10.88-7.08 17.88-7.09 7-17.92 7H253q-14 0-24.5-10.5T218-400v-69q0-14 10.5-24.5T253-504h84v-41h-94q-10.83 0-17.92-7.12-7.08-7.11-7.08-18 0-10.88 7.08-17.88 7.09-7 17.92-7h109q14 0 24.5 10.5T387-560v69q0 14-10.5 24.5T352-456h-84v41ZM140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h150v-50q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v50h260v-50q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v50h150q24 0 42 18t18 42v520q0 24-18 42t-42 18H140Zm10-70h305v-35q0-10.83 7.12-17.92 7.11-7.08 18-7.08 10.88 0 17.88 7.08 7 7.09 7 17.92v35h305v-500H505v35q0 10.83-7.12 17.92-7.11 7.08-18 7.08-10.88 0-17.88-7.08-7-7.09-7-17.92v-35H150v500Zm0 0v-500 500Zm308.5-301.5Q450-540 450-553t8.5-21.5Q467-583 480-583t21.5 8.5Q510-566 510-553t-8.5 21.5Q493-523 480-523t-21.5-8.5Zm0 146Q450-394 450-407t8.5-21.5Q467-437 480-437t21.5 8.5Q510-420 510-407t-8.5 21.5Q493-377 480-377t-21.5-8.5Z',
        'M608-365h99q14 0 24.5-10.5T742-400v-160q0-14-10.5-24.5T707-595h-99q-14 0-24.5 10.5T573-560v160q0 14 10.5 24.5T608-365Zm15-50h69v-130h-69v130Zm-370 50h109q11 0 18-7t7-18q0-11-7-18t-18-7h-94v-41h84q14 0 24.5-10.5T387-491v-69q0-14-10.5-24.5T352-595H243q-11 0-18 7t-7 18q0 11 7 18t18 7h94v41h-84q-14 0-24.5 10.5T218-469v69q0 14 10.5 24.5T253-365ZM140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h150v-50q0-13 8.5-21.5T320-880q13 0 21.5 8.5T350-850v50h260v-50q0-13 8.5-21.5T640-880q13 0 21.5 8.5T670-850v50h150q24 0 42 18t18 42v520q0 24-18 42t-42 18H140Zm361.5-371.5Q510-540 510-553t-8.5-21.5Q493-583 480-583t-21.5 8.5Q450-566 450-553t8.5 21.5Q467-523 480-523t21.5-8.5Zm0 146Q510-394 510-407t-8.5-21.5Q493-437 480-437t-21.5 8.5Q450-420 450-407t8.5 21.5Q467-377 480-377t21.5-8.5ZM498-677q7-7 7-18t-7-18q-7-7-18-7t-18 7q-7 7-7 18t7 18q7 7 18 7t18-7Zm0 430q7-7 7-18t-7-18q-7-7-18-7t-18 7q-7 7-7 18t7 18q7 7 18 7t18-7Z'],
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

// ==================== AVATAR HELPERS ====================
function _buildAvatarInner(username) {
    const av = localStorage.getItem('avatarUrl') || '';
    if (av) return `<img src="${av}" class="user-avatar-img" alt="${username.charAt(0).toUpperCase()}" id="navAvatarImg">`;
    return `<img src="Icons/grayUser.png" class="user-avatar-img" alt="${username.charAt(0).toUpperCase()}" id="navAvatarImg">`;
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
        btn.innerHTML = url
            ? `<img src="${url}" class="user-avatar-img" alt="${username.charAt(0).toUpperCase()}" id="navAvatarImg">`
            : `<img src="Icons/grayUser.png" class="user-avatar-img" alt="${username.charAt(0).toUpperCase()}" id="navAvatarImg">`;
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
// Ordre : Accueil → Pools ▾ → Repêchage (🔴) → Échanges (🔴) → Classement
//         → Scores → Stats
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

    navbar.innerHTML = `
        <!-- Desktop Layout -->
        <div class="navbar-desktop">
            <!-- Left: Logo + Nav Links -->
            <div class="navbar-left">
                <a href="https://fantazy.ca" class="navbar-brand" style="text-decoration:none;">
                    <img src="Icons/fantazy.png" alt="Fantazy" class="navbar-logo">
                </a>

                <nav class="nav-links">
                    <a href="index.html" class="nav-link ${'accueil' === currentPage ? 'active' : ''}">
                        <span class="nav-icon-img" aria-hidden="true">${PAGE_ICON.accueil}</span>
                        <span class="nav-text">Accueil</span>
                    </a>
                    <a href="pool.html" class="nav-link ${'pools' === currentPage ? 'active' : ''}" id="navPoolsBtn">
                        <span class="nav-icon-img" aria-hidden="true">${PAGE_ICON.pools}</span>
                        <span class="nav-text">Pools</span>
                    </a>
                    <a href="repechage.html" class="nav-link ${'repechage' === currentPage ? 'active' : ''}" id="desktopPoolLink">
                        <span class="nav-icon-img" aria-hidden="true">${PAGE_ICON.repechage}</span>
                        <span class="nav-text">Repêchage</span>
                        <span class="notif-badge" id="desktopDraftBadge" style="display: none;"></span>
                    </a>
                    <a href="trade.html" class="nav-link ${'trade' === currentPage ? 'active' : ''}" id="desktopTradeLink">
                        <span class="nav-icon-img" aria-hidden="true">${PAGE_ICON.echanges}</span>
                        <span class="nav-text">Échanges</span>
                        <span class="notif-badge" id="desktopTradeBadge" style="display: none;">0</span>
                    </a>
                    <a href="classement.html" class="nav-link ${'classement' === currentPage ? 'active' : ''}" id="desktopClassementLink">
                        <span class="nav-icon-img" aria-hidden="true">${PAGE_ICON.classement}</span>
                        <span class="nav-text">Classement</span>
                    </a>
                    <a href="calendrier.html" class="nav-link ${'calendrier' === currentPage ? 'active' : ''}">
                        <span class="nav-icon-img" aria-hidden="true">${PAGE_ICON.calendrier}</span>
                        <span class="nav-text">Scores</span>
                    </a>
                    <a href="stats.html" class="nav-link ${'stats' === currentPage ? 'active' : ''}">
                        <span class="nav-icon-img" aria-hidden="true">${PAGE_ICON.stats}</span>
                        <span class="nav-text">Stats</span>
                    </a>
                </nav>
            </div>

            <!-- Right: notifications (injectées par notifications.js) + menu -->
            <!-- Le bouton de thème a rejoint le menu du compte : la cloche
                 et l'avatar suffisent à remplir cette barre. -->
            <div class="navbar-right">
                <div class="user-menu">
                    <button class="user-avatar" id="userAvatarBtn" title="${username}"
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
                                <span class="udh-name">${username}</span>
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
// Accueil → Échanges → Classement → Scores → Stats. Le repêchage n'y est
// plus : pendant le repêchage, l'accueil mène à la salle.
function buildBottomNav(currentPage) {
    const existing = document.querySelector('.bottom-nav');
    if (existing) existing.remove();

    // `data-page` : l'onglet que la page désigne comme actif (getCurrentPage),
    // relu au retour arrière (initToucherBas).
    const onglet = (page, href, libelle, extra = '') => {
        const actif = page === currentPage;
        return `
            <a href="${href}" class="bottom-nav-item${actif ? ' active' : ''}" data-page="${page}"${actif ? ' aria-current="page"' : ''}${extra}>
                <span class="bottom-nav-icon" aria-hidden="true">${iconeBarre(page === 'trade' ? 'echanges' : page)}</span>
                <span class="bottom-nav-label">${libelle}</span>`;
    };
    const html = `
        <nav class="bottom-nav" aria-label="Navigation principale">
            ${onglet('accueil', 'index.html', 'Accueil')}
            </a>
            ${onglet('trade', 'trade.html', 'Échanges', ' id="bottomTradeLink"')}
                <span class="notif-badge" id="bottomTradeBadge" style="display: none;">0</span>
            </a>
            ${onglet('classement', 'classement.html', 'Classement', ' id="bottomClassementLink"')}
            </a>
            ${onglet('calendrier', 'calendrier.html', 'Scores')}
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
        choisir(onglets().find(o => o.dataset.page === currentPage) || null);
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
            btn.innerHTML = `<img src="${d.avatarUrl}" class="user-avatar-img" alt="${username.charAt(0).toUpperCase()}" id="navAvatarImg">`;
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
        setNavBadge(['desktopTradeBadge', 'bottomTradeBadge', 'railTradeBadge'],
                    echanges.length > 0 ? echanges.length : null);
    } catch (error) {
        console.error('Error checking pending trades:', error);
    }
}

// ==================== ONGLETS CONDITIONNELS ====================
/*
 * Trois onglets dépendent de l'état du pool actif — Repêchage, Échanges,
 * Classement — et cet état n'arrive qu'avec /draft, un aller-retour réseau
 * après la construction de la barre. Les afficher puis les retirer laissait
 * voir, le temps d'un battement, un « Classement » qui n'ouvrira pas et un
 * « Repêchage » déjà terminé.
 *
 * On retient donc la dernière réponse connue, par pool, et on l'applique
 * dans la foulée de la construction — même tâche, donc avant le premier
 * rendu. FZPool.ready() la confirme ou la corrige ensuite. Seule la toute
 * première visite sur un pool n'a rien en mémoire ; elle retombe sur
 * l'ancien comportement.
 */
const NAV_ONGLETS_CONDITIONNELS = {
    repechage: ['desktopPoolLink'],
    trade: ['desktopTradeLink', 'bottomTradeLink'],
    classement: ['desktopClassementLink', 'bottomClassementLink']
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
        if (!pool) { setNavBadge(['desktopDraftBadge'], null); return; }

        const etat = FZPool.draftState(pool.data);
        const aSignaler = etat.etat === 'encours' || etat.etat === 'pret';
        // Chaîne vide et non « ! » : la pastille devient un simple point
        // (.notif-badge:empty en CSS) — un repêchage actif n'a rien à
        // compter, contrairement aux échanges en attente.
        setNavBadge(['desktopDraftBadge'], aSignaler ? '' : null);
    } catch (error) {
        console.error('Error checking active drafts:', error);
    }
}

/**
 * Le lien « Repêchage » disparaît des barres de navigation une fois le
 * repêchage du pool actif terminé : la salle ne prend plus de choix et
 * repechage.html n'est plus qu'un panneau indicateur. Les écrans eux-mêmes
 * referment la porte (fermerLeRepechageSiTermine dans activePool.js) — ceci
 * ne fait qu'enlever l'onglet qui y menait.
 *
 * Sans pool actif, le lien reste : c'est par là qu'on rejoint un repêchage.
 */
async function updateDraftLinkVisibility() {
    try {
        // Sans FZPool, rien ne dira jamais d'ouvrir : on montre plutôt que
        // de laisser la mémoire tenir l'onglet fermé indéfiniment.
        if (!window.FZPool) { navAppliquerVisibilite('repechage', true); return; }
        await FZPool.ready();

        const actif = FZPool.get();
        const pool = FZPool.mine().find(p => p.name === actif);
        const visible = !pool || FZPool.draftState(pool.data).etat !== 'termine';

        navRetenirVisibilite('repechage', visible);
    } catch (error) {
        console.error('Error checking draft link visibility:', error);
        navAppliquerVisibilite('repechage', true);
    }
}

/**
 * Le lien « Échanges » n'a rien à faire dans les barres de navigation si le
 * pool actif a désactivé les échanges — la page elle-même refuse déjà d'y
 * bâtir quoi que ce soit (voir trade.js), le lien serait un cul-de-sac.
 *
 * Sans pool, même chose : il n'y a personne avec qui échanger, et
 * trade.html renvoie à l'accueil (activePool.js).
 */
async function updateTradeLinkVisibility() {
    try {
        if (!window.FZPool) { navAppliquerVisibilite('trade', true); return; }
        await FZPool.ready();

        const actif = FZPool.get();
        const pool = FZPool.mine().find(p => p.name === actif);
        const visible = !!pool && pool.data.allowTrades !== false;

        navRetenirVisibilite('trade', visible);
    } catch (error) {
        console.error('Error checking trade link visibility:', error);
        navAppliquerVisibilite('trade', true);
    }
}

/**
 * Le lien « Classement » n'apparaît qu'une fois le repêchage du pool actif
 * terminé — l'inverse exact du lien « Repêchage ».
 *
 * Tant qu'on repêche, les effectifs sont à moitié bâtis : un classement des
 * équipes n'y compterait que les joueurs déjà choisis, et placerait en tête
 * celui qui a simplement repêché le plus tôt dans le tour. Ce n'est pas un
 * classement, c'est le hasard de l'ordre des choix. L'accueil l'annonce déjà
 * pendant le repêchage (« Le classement s'ouvre une fois le repêchage
 * terminé. ») ; ici on retire l'onglet qui y menait, et classement.html
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
