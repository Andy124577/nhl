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
    // Les trois écrans de gestion tiennent sous le même onglet « Pools » :
    // on y crée, on y rejoint, on y règle — c'est une seule destination.
    if (n.includes('mes-pools.html') || n.includes('creer-pool.html') ||
        n.includes('rejoindre-pool.html')) return 'pools';
    return '';
}

// ==================== INITIALIZATION ====================
function initModernNavbar() {
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const username = localStorage.getItem('username') || '';
    const isAdmin = localStorage.getItem('isAdmin') === 'true';
    const currentPage = getCurrentPage();

    if (!document.querySelector('.navbar')) return;

    if (isLoggedIn) {
        buildLoggedInNavbar(username, isAdmin, currentPage);
        buildBottomNav(currentPage);
        initializeEventListeners(username, isAdmin);
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
    } else {
        buildLoggedOutNavbar();
    }
}

// ==================== ICÔNES ====================
// SVG intégrés plutôt que getIcon() : icons.js n'est pas chargé sur
// classement.html ni draftFini.html, alors que navbar.js tourne partout.
const NAV_ICON = {
    camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
    shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`
};

// Les 6 sections du site, dans l'ordre affiché partout (barre du haut,
// barre du bas, tiroir des pools) : mêmes silhouettes, seule la couleur
// suit currentColor pour s'accorder au thème et à l'état actif/survol.
const PAGE_ICON = {
    accueil: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>`,
    pools: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
    repechage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>`,
    echanges: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>`,
    classement: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg>`,
    stats: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>`
};

// ==================== THÈME ====================
// theme.js pose l'attribut sur <html> ; localStorage peut être vide au
// tout premier passage, d'où la lecture des deux.
function _themeIsDark() {
    const actuel = document.documentElement.getAttribute('data-theme')
        || localStorage.getItem('theme')
        || 'dark';
    return actuel === 'dark';
}

/**
 * Bascule le thème depuis le menu du compte.
 *
 * toggleTheme() (theme.js) s'occupe déjà de l'attribut, du stockage et de
 * l'icône #themeIcon ; il reste à réaccorder le libellé, qui annonce le
 * thème vers lequel on va et non celui qu'on quitte.
 */
function toggleThemeFromMenu() {
    toggleTheme();
    const titre = document.getElementById('themeMenuTitle');
    if (titre) titre.textContent = _themeIsDark() ? 'Thème clair' : 'Thème sombre';
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
                <button class="theme-toggle-btn" id="themeToggleBtn" onclick="toggleTheme()" title="Changer le thème">
                    <span id="themeIcon">${_themeIsDark() ? '☀️' : '🌙'}</span>
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
// Ordre : Accueil → Pools → Repêchage (🔴) → Échanges (🔴) → Classement → Stats
//
// « Pools » est le seul lien que rien ne masque jamais : Repêchage disparaît
// une fois le repêchage terminé et Échanges quand le pool les interdit, si
// bien qu'on pouvait se retrouver sans aucun chemin vers ses pools depuis la
// barre. Il mène à mes-pools.html, d'où l'on crée, rejoint et règle.
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
                    <a href="mes-pools.html" class="nav-link ${'pools' === currentPage ? 'active' : ''}">
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

                        ${isAdmin ? '<div id="adminUsersList" class="dropdown-group"></div>' : ''}

                        <div class="dropdown-group">
                            <p class="dropdown-label">Apparence</p>
                            <button class="dropdown-item" role="menuitem" onclick="toggleThemeFromMenu()">
                                <span class="dropdown-icon" id="themeIcon">${_themeIsDark() ? '☀️' : '🌙'}</span>
                                <span class="dropdown-text">
                                    <span class="dropdown-title" id="themeMenuTitle">${_themeIsDark() ? 'Thème clair' : 'Thème sombre'}</span>
                                    <span class="dropdown-hint">Basculer l'affichage</span>
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
}

// ==================== MOBILE BOTTOM NAV ====================
// Même ordre que la barre du haut :
// Accueil → Pools → Repêchage → Échanges → Classement → Stats
function buildBottomNav(currentPage) {
    const existing = document.querySelector('.bottom-nav');
    if (existing) existing.remove();

    const html = `
        <nav class="bottom-nav">
            <a href="index.html" class="bottom-nav-item ${'accueil' === currentPage ? 'active' : ''}">
                <span class="bottom-nav-icon">${PAGE_ICON.accueil}</span>
                <span class="bottom-nav-label">Accueil</span>
            </a>
            <a href="mes-pools.html" class="bottom-nav-item ${'pools' === currentPage ? 'active' : ''}">
                <span class="bottom-nav-icon">${PAGE_ICON.pools}</span>
                <span class="bottom-nav-label">Pools</span>
            </a>
            <a href="repechage.html" class="bottom-nav-item ${'repechage' === currentPage ? 'active' : ''}" id="bottomPoolLink">
                <span class="bottom-nav-icon">${PAGE_ICON.repechage}</span>
                <span class="bottom-nav-label">Repêchage</span>
                <span class="notif-badge" id="bottomDraftBadge" style="display: none;"></span>
            </a>
            <a href="trade.html" class="bottom-nav-item ${'trade' === currentPage ? 'active' : ''}" id="bottomTradeLink">
                <span class="bottom-nav-icon">${PAGE_ICON.echanges}</span>
                <span class="bottom-nav-label">Échanges</span>
                <span class="notif-badge" id="bottomTradeBadge" style="display: none;">0</span>
            </a>
            <a href="classement.html" class="bottom-nav-item ${'classement' === currentPage ? 'active' : ''}" id="bottomClassementLink">
                <span class="bottom-nav-icon">${PAGE_ICON.classement}</span>
                <span class="bottom-nav-label">Classement</span>
            </a>
            <a href="stats.html" class="bottom-nav-item ${'stats' === currentPage ? 'active' : ''}">
                <span class="bottom-nav-icon">${PAGE_ICON.stats}</span>
                <span class="bottom-nav-label">Stats</span>
            </a>
        </nav>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
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
        if (!r.ok) { alert(d.message || 'Erreur lors du téléversement.'); return; }

        localStorage.setItem('avatarUrl', d.avatarUrl);
        // Update navbar avatar immediately
        const btn = document.getElementById('userAvatarBtn');
        if (btn) {
            btn.innerHTML = `<img src="${d.avatarUrl}" class="user-avatar-img" alt="${username.charAt(0).toUpperCase()}" id="navAvatarImg">`;
        }
        // Close dropdown
        document.getElementById('userDropdownMenu')?.classList.remove('show');
    } catch (e) {
        alert('Erreur de connexion au serveur.');
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
        const response = await fetch(`${baseUrl}/admin-users?adminToken=admin`);
        const data = await response.json();

        if (response.ok) {
            const users = data.users.filter(u => u !== 'admin').slice(0, 5);
            const container = document.getElementById('adminUsersList');
            if (container && users.length > 0) {
                container.innerHTML = `
                    <p class="dropdown-label">Changer d'utilisateur</p>
                    ${users.map(u => `
                        <button class="dropdown-item" role="menuitem" onclick="switchToUser('${u}')">
                            <span class="dropdown-icon">
                                <img src="Icons/grayUser.png" alt="" class="dropdown-user-thumb">
                            </span>
                            <span class="dropdown-title">${u}</span>
                        </button>
                    `).join('')}
                `;
            }
        }
    } catch (error) {
        console.error('Error loading admin users:', error);
    }
}

async function switchToUser(username) {
    try {
        const baseUrl = window.location.hostname.includes('localhost') ? 'http://localhost:3000' : window.location.origin;
        const response = await fetch(`${baseUrl}/admin-switch-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminToken: 'admin', targetUsername: username })
        });

        if (response.ok) {
            localStorage.setItem('username', username);
            localStorage.removeItem('avatarUrl');
            window.location.reload();
        } else {
            alert('Erreur lors du changement d\'utilisateur');
        }
    } catch (error) {
        console.error('Error switching user:', error);
        alert('Erreur de connexion au serveur');
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

        setNavBadge(['desktopTradeBadge', 'bottomTradeBadge'],
                    echanges.length > 0 ? echanges.length : null);
    } catch (error) {
        console.error('Error checking pending trades:', error);
    }
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
        if (!window.FZPool) return;
        await FZPool.ready();

        const actif = FZPool.get();
        const pool = FZPool.mine().find(p => p.name === actif);
        const visible = !pool || FZPool.draftState(pool.data).etat !== 'termine';

        ['desktopPoolLink', 'bottomPoolLink'].forEach(id => {
            const lien = document.getElementById(id);
            if (lien) lien.style.display = visible ? '' : 'none';
        });
    } catch (error) {
        console.error('Error checking draft link visibility:', error);
    }
}

/**
 * Le lien « Échanges » n'a rien à faire dans les barres de navigation si le
 * pool actif a désactivé les échanges — la page elle-même refuse déjà d'y
 * bâtir quoi que ce soit (voir trade.js), le lien serait un cul-de-sac.
 */
async function updateTradeLinkVisibility() {
    try {
        if (!window.FZPool) return;
        await FZPool.ready();

        const actif = FZPool.get();
        const pool = FZPool.mine().find(p => p.name === actif);
        const visible = !pool || pool.data.allowTrades !== false;

        ['desktopTradeLink', 'bottomTradeLink'].forEach(id => {
            const lien = document.getElementById(id);
            if (lien) lien.style.display = visible ? '' : 'none';
        });
    } catch (error) {
        console.error('Error checking trade link visibility:', error);
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
 * Sans pool actif, le lien reste : la page sert alors de liste de pools,
 * comme pour « Repêchage ».
 */
async function updateClassementLinkVisibility() {
    try {
        if (!window.FZPool) return;
        await FZPool.ready();

        const actif = FZPool.get();
        const pool = FZPool.mine().find(p => p.name === actif);
        const visible = !pool || FZPool.draftState(pool.data).etat === 'termine';

        ['desktopClassementLink', 'bottomClassementLink'].forEach(id => {
            const lien = document.getElementById(id);
            if (lien) lien.style.display = visible ? '' : 'none';
        });
    } catch (error) {
        console.error('Error checking classement link visibility:', error);
    }
}

// ==================== LOGOUT ====================
function logout() {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('username');
    localStorage.removeItem('isAdmin');
    localStorage.removeItem('avatarUrl');
    window.location.href = 'index.html';
}

// ==================== DROITS SUR LES DONNÉES (LOI 25) ====================
// Le mot de passe est redemandé : /account/export expose l'ensemble des
// renseignements et /account/delete est irréversible.

function navbarBaseUrl() {
    return window.location.hostname.includes('localhost')
        ? 'http://localhost:3000'
        : window.location.origin;
}

/**
 * Modale générique, en remplacement de prompt()/confirm()/alert().
 *
 * Retourne une promesse :
 *   - champ mot de passe  -> la valeur saisie, ou null si annulé
 *   - sans champ          -> true si confirmé, null si annulé
 *
 * `onSubmit` permet de garder la modale ouverte et d'y afficher une erreur
 * (ex. mauvais mot de passe) : retourner une chaîne = message d'erreur.
 */
function fzModal({ title, bodyHTML, confirmLabel = 'Confirmer', cancelLabel = 'Annuler',
                   danger = false, password = false, onSubmit = null }) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'fz-modal';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = `
            <div class="fz-modal-card">
                <div class="fz-modal-header ${danger ? 'danger' : ''}">
                    <h3>${title}</h3>
                </div>
                <div class="fz-modal-body">
                    ${bodyHTML || ''}
                    ${password ? `
                        <input type="password" class="fz-modal-input"
                               autocomplete="current-password"
                               placeholder="Votre mot de passe">
                        <div class="fz-modal-error" aria-live="polite"></div>` : ''}
                </div>
                <div class="fz-modal-footer">
                    <button class="fz-modal-btn secondary" data-act="cancel">${cancelLabel}</button>
                    <button class="fz-modal-btn ${danger ? 'danger' : ''}" data-act="ok">${confirmLabel}</button>
                </div>
            </div>`;

        const previousFocus = document.activeElement;
        document.body.appendChild(overlay);

        const input = overlay.querySelector('.fz-modal-input');
        const errorBox = overlay.querySelector('.fz-modal-error');
        const okBtn = overlay.querySelector('[data-act="ok"]');
        (input || okBtn).focus();

        const close = value => {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            if (previousFocus && previousFocus.focus) previousFocus.focus();
            resolve(value);
        };

        const submit = async () => {
            const value = password ? (input.value || '') : true;
            if (password && !value) {
                errorBox.textContent = 'Veuillez saisir votre mot de passe.';
                return;
            }
            if (!onSubmit) return close(value);

            okBtn.disabled = true;
            const previousLabel = okBtn.textContent;
            okBtn.textContent = 'Un instant…';
            const error = await onSubmit(value);
            okBtn.disabled = false;
            okBtn.textContent = previousLabel;

            if (error) {
                if (errorBox) errorBox.textContent = error;
                if (input) { input.value = ''; input.focus(); }
                return;
            }
            close(value);
        };

        function onKey(e) {
            if (e.key === 'Escape') close(null);
            if (e.key === 'Enter' && overlay.contains(document.activeElement)) submit();
        }

        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
        overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
        okBtn.addEventListener('click', submit);
    });
}

/** Message simple, en remplacement de alert(). */
function fzNotice(title, bodyHTML, danger = false) {
    return fzModal({
        title, bodyHTML, danger,
        confirmLabel: 'OK',
        cancelLabel: 'Fermer'
    });
}

async function exportMyData() {
    const username = localStorage.getItem('username');
    if (!username) return;

    await fzModal({
        title: 'Télécharger mes données',
        bodyHTML: `
            <p>Vous obtiendrez un fichier <strong>JSON</strong> contenant votre compte
            et vos participations aux pools.</p>
            <p>Votre mot de passe n'est jamais inclus dans l'export.</p>
            <p>Confirmez votre mot de passe pour continuer :</p>`,
        confirmLabel: 'Télécharger',
        password: true,
        onSubmit: async (motDePasse) => {
            try {
                const res = await fetch(`${navbarBaseUrl()}/account/export`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password: motDePasse })
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
        danger: true
    });
    if (!confirme) return;

    // Étape 2 : confirmation d'identité.
    const supprime = await fzModal({
        title: 'Confirmer la suppression',
        bodyHTML: '<p>Saisissez votre mot de passe pour supprimer définitivement votre compte.</p>',
        confirmLabel: 'Supprimer définitivement',
        danger: true,
        password: true,
        onSubmit: async (motDePasse) => {
            try {
                const res = await fetch(`${navbarBaseUrl()}/account/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password: motDePasse })
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

    await fzNotice('Compte supprimé',
        "<p>Votre compte a été supprimé. Merci d'avoir utilisé Fantazy.</p>");
    localStorage.clear();
    window.location.href = 'index.html';
}

// ==================== PIED DE PAGE / MENTIONS LÉGALES ====================
// Avis de non-affiliation : obligatoire pour appuyer l'usage nominatif des
// marques et logos d'équipes. Injecté sur toutes les pages via la navbar.
function renderLegalFooter() {
    if (document.querySelector('.site-legal-footer')) return;

    const year = new Date().getFullYear();
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
                <a href="confidentialite.html">Politique de confidentialité</a>
                <span aria-hidden="true">·</span>
                <a href="conditions.html">Conditions d'utilisation</a>
                <span aria-hidden="true">·</span>
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
document.addEventListener('DOMContentLoaded', () => {
    initModernNavbar();
    renderLegalFooter();
});
