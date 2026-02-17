// ==================== PAGE DETECTION ====================
function getCurrentPage() {
    const n = window.location.pathname;
    if (n.includes('accueil.html') || n.endsWith('/')) return 'accueil';
    if (n.includes('index.html')) return 'stats';
    if (n.includes('draft.html') || n.includes('draftActif.html') || n.includes('draftFini.html')) return 'draft';
    if (n.includes('classement.html')) return 'classement';
    if (n.includes('trade.html')) return 'trade';
    if (n.includes('pool.html')) return 'pool';
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
    } else {
        buildLoggedOutNavbar();
    }
}

// ==================== LOGGED OUT NAVBAR ====================
function buildLoggedOutNavbar() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;
    navbar.innerHTML = `
        <div class="navbar-brand">
            <img src="Icons/fantazy.png" alt="Fantazy" class="navbar-logo">
        </div>
        <div class="navbar-actions">
            <a href="login.html" class="btn-login">Connexion</a>
            <a href="signup.html" class="btn-signup">Commencer</a>
        </div>
    `;
}

// ==================== LOGGED IN NAVBAR ====================
// Nav order: Accueil → Pools (🔴 draft) → Échanges (🔴 trades) → Classement → Stats
function buildLoggedInNavbar(username, isAdmin, currentPage) {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    navbar.innerHTML = `
        <!-- Desktop Layout -->
        <div class="navbar-desktop">
            <!-- Left: Logo + Nav Links -->
            <div class="navbar-left">
                <div class="navbar-brand">
                    <img src="Icons/fantazy.png" alt="Fantazy" class="navbar-logo">
                </div>

                <nav class="nav-links">
                    <a href="accueil.html" class="nav-link ${'accueil' === currentPage ? 'active' : ''}">
                        <span class="nav-icon">🏠</span>
                        <span class="nav-text">Accueil</span>
                    </a>
                    <a href="pool.html" class="nav-link ${'pool' === currentPage ? 'active' : ''}" id="desktopPoolLink">
                        <span class="nav-icon">⚙️</span>
                        <span class="nav-text">Pools</span>
                        <span class="notif-badge" id="desktopDraftBadge" style="display: none;"></span>
                    </a>
                    <a href="trade.html" class="nav-link ${'trade' === currentPage ? 'active' : ''}" id="desktopTradeLink">
                        <span class="nav-icon">🔄</span>
                        <span class="nav-text">Échanges</span>
                        <span class="notif-badge" id="desktopTradeBadge" style="display: none;">0</span>
                    </a>
                    <a href="classement.html" class="nav-link ${'classement' === currentPage ? 'active' : ''}">
                        <span class="nav-icon">🏆</span>
                        <span class="nav-text">Classement</span>
                    </a>
                    <a href="index.html" class="nav-link ${'stats' === currentPage ? 'active' : ''}">
                        <span class="nav-icon">📊</span>
                        <span class="nav-text">Stats</span>
                    </a>
                </nav>
            </div>

            <!-- Right: User Menu -->
            <div class="navbar-right">
                <div class="user-menu">
                    <button class="user-avatar" id="userAvatarBtn" title="${username}">
                        ${username.charAt(0).toUpperCase()}
                    </button>
                    <div class="user-dropdown" id="userDropdownMenu">
                        <div class="user-dropdown-header">
                            <div class="user-info">
                                <div class="user-name">${username}</div>
                                ${isAdmin ? '<div class="user-role">Administrateur</div>' : ''}
                            </div>
                        </div>
                        ${isAdmin ? '<div class="dropdown-divider"></div><div id="adminUsersList" class="admin-users-list"></div>' : ''}
                        <div class="dropdown-divider"></div>
                        <button class="dropdown-item logout" onclick="logout()">
                            <span>🚪</span>
                            <span>Déconnexion</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ==================== MOBILE BOTTOM NAV ====================
// Same order: Accueil → Pools → Échanges → Classement → Stats
function buildBottomNav(currentPage) {
    const existing = document.querySelector('.bottom-nav');
    if (existing) existing.remove();

    const html = `
        <nav class="bottom-nav">
            <a href="accueil.html" class="bottom-nav-item ${'accueil' === currentPage ? 'active' : ''}">
                <span class="bottom-nav-icon">🏠</span>
                <span class="bottom-nav-label">Accueil</span>
            </a>
            <a href="pool.html" class="bottom-nav-item ${'pool' === currentPage ? 'active' : ''}" id="bottomPoolLink">
                <span class="bottom-nav-icon">⚙️</span>
                <span class="bottom-nav-label">Pools</span>
                <span class="notif-badge" id="bottomDraftBadge" style="display: none;"></span>
            </a>
            <a href="trade.html" class="bottom-nav-item ${'trade' === currentPage ? 'active' : ''}" id="bottomTradeLink">
                <span class="bottom-nav-icon">🔄</span>
                <span class="bottom-nav-label">Échanges</span>
                <span class="notif-badge" id="bottomTradeBadge" style="display: none;">0</span>
            </a>
            <a href="classement.html" class="bottom-nav-item ${'classement' === currentPage ? 'active' : ''}">
                <span class="bottom-nav-icon">🏆</span>
                <span class="bottom-nav-label">Classement</span>
            </a>
            <a href="index.html" class="bottom-nav-item ${'stats' === currentPage ? 'active' : ''}">
                <span class="bottom-nav-icon">📊</span>
                <span class="bottom-nav-label">Stats</span>
            </a>
        </nav>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

// ==================== EVENT LISTENERS ====================
function initializeEventListeners(username, isAdmin) {
    const avatarBtn = document.getElementById('userAvatarBtn');
    const dropdown = document.getElementById('userDropdownMenu');

    if (avatarBtn && dropdown) {
        avatarBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            dropdown.classList.toggle('show');
        });
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.user-menu')) {
                dropdown.classList.remove('show');
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
                    <div class="admin-section-title">Changer d'utilisateur</div>
                    ${users.map(u => `
                        <button class="dropdown-item" onclick="switchToUser('${u}')">
                            <span class="user-avatar-small">${u.charAt(0).toUpperCase()}</span>
                            <span>${u}</span>
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

// Check for pending trades
async function checkPendingTrades() {
    try {
        const baseUrl = window.location.hostname.includes('localhost') ? 'http://localhost:3000' : window.location.origin;
        const username = localStorage.getItem('username');
        if (!username) return;

        const response = await fetch(`${baseUrl}/pending-trades?username=${username}`);
        const data = await response.json();

        if (response.ok && data.count > 0) {
            const desktopBadge = document.getElementById('desktopTradeBadge');
            if (desktopBadge) {
                desktopBadge.textContent = data.count;
                desktopBadge.style.display = 'flex';
            }
            const bottomBadge = document.getElementById('bottomTradeBadge');
            if (bottomBadge) {
                bottomBadge.textContent = data.count;
                bottomBadge.style.display = 'flex';
            }
        }
    } catch (error) {
        console.error('Error checking pending trades:', error);
    }
}

// Check for active drafts that need user attention
async function checkActiveDrafts() {
    try {
        const baseUrl = window.location.hostname.includes('localhost') ? 'http://localhost:3000' : window.location.origin;
        const username = localStorage.getItem('username');
        if (!username) return;

        const response = await fetch(`${baseUrl}/draft`, { cache: 'no-store' });
        const allPools = await response.json();

        let activeDraftCount = 0;

        Object.entries(allPools).forEach(([poolName, poolData]) => {
            // Check if user is in this pool
            const userTeam = Object.entries(poolData.teams || {}).find(([teamName, teamData]) =>
                teamData.members && teamData.members.includes(username)
            );
            if (!userTeam) return;

            // Check if draft is active (started but not complete)
            const hasRoster = userTeam[1].offensive?.length > 0 ||
                             userTeam[1].defensive?.length > 0 ||
                             userTeam[1].goalie?.length > 0;

            const isDraftComplete = poolData.draftComplete ||
                                   poolData.isDraftComplete ||
                                   poolData.draftStatus === 'completed' ||
                                   poolData.draftStatus === 'done' ||
                                   hasRoster;

            // Draft is active if draftOrder exists but draft is not complete
            const hasDraftOrder = poolData.draftOrder && poolData.draftOrder.order && poolData.draftOrder.order.length > 0;
            const isDraftActive = hasDraftOrder && !isDraftComplete;

            // Also count pools awaiting draft (all teams filled, no draft started)
            const totalMembers = Object.values(poolData.teams || {}).reduce((sum, t) => sum + (t.members?.length || 0), 0);
            const maxPlayers = poolData.maxPlayers || 10;
            const isPoolFull = totalMembers >= maxPlayers;
            const needsDraft = isPoolFull && !isDraftComplete && !hasDraftOrder;

            if (isDraftActive || needsDraft) {
                activeDraftCount++;
            }
        });

        if (activeDraftCount > 0) {
            const desktopBadge = document.getElementById('desktopDraftBadge');
            if (desktopBadge) {
                desktopBadge.textContent = activeDraftCount;
                desktopBadge.style.display = 'flex';
            }
            const bottomBadge = document.getElementById('bottomDraftBadge');
            if (bottomBadge) {
                bottomBadge.textContent = activeDraftCount;
                bottomBadge.style.display = 'flex';
            }
        }
    } catch (error) {
        console.error('Error checking active drafts:', error);
    }
}

// ==================== LOGOUT ====================
function logout() {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('username');
    localStorage.removeItem('isAdmin');
    window.location.href = 'login.html';
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    initModernNavbar();
});
