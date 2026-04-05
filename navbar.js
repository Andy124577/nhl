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
        <div class="navbar-desktop navbar-guest">
            <div class="navbar-brand">
                <img src="Icons/fantazy.png" alt="Fantazy" class="navbar-logo">
                <span class="navbar-title">Fantazy</span>
            </div>
            <div class="navbar-guest-actions">
                <button class="theme-toggle-btn" id="themeToggleBtn" onclick="toggleTheme()" title="Changer le thème">
                    <span id="themeIcon">${(localStorage.getItem('theme') || 'dark') === 'dark' ? '☀️' : '🌙'}</span>
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
                        <img src="Icons/fantazy.png" alt="Accueil" class="nav-icon-img">
                        <span class="nav-text">Accueil</span>
                    </a>
                    <a href="pool.html" class="nav-link ${'pool' === currentPage ? 'active' : ''}" id="desktopPoolLink">
                        <img src="Icons/pool.png" alt="Pools" class="nav-icon-img">
                        <span class="nav-text">Pools</span>
                        <span class="notif-badge" id="desktopDraftBadge" style="display: none;"></span>
                    </a>
                    <a href="trade.html" class="nav-link ${'trade' === currentPage ? 'active' : ''}" id="desktopTradeLink">
                        <img src="Icons/echanges.png" alt="Échanges" class="nav-icon-img">
                        <span class="nav-text">Échanges</span>
                        <span class="notif-badge" id="desktopTradeBadge" style="display: none;">0</span>
                    </a>
                    <a href="classement.html" class="nav-link ${'classement' === currentPage ? 'active' : ''}">
                        <img src="Icons/classement.png" alt="Classement" class="nav-icon-img">
                        <span class="nav-text">Classement</span>
                    </a>
                    <a href="index.html" class="nav-link ${'stats' === currentPage ? 'active' : ''}">
                        <img src="Icons/stats.png" alt="Stats" class="nav-icon-img">
                        <span class="nav-text">Stats</span>
                    </a>
                </nav>
            </div>

            <!-- Right: Theme toggle + User Menu -->
            <div class="navbar-right">
                <button class="theme-toggle-btn" id="themeToggleBtn" onclick="toggleTheme()" title="Changer le thème">
                    <span id="themeIcon">${(localStorage.getItem('theme') || 'dark') === 'dark' ? '☀️' : '🌙'}</span>
                </button>
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

        const response = await fetch(`${baseUrl}/trades/pending/${username}`);
        const data = await response.json();

        const count = Array.isArray(data) ? data.length : 0;
        if (response.ok && count > 0) {
            const desktopBadge = document.getElementById('desktopTradeBadge');
            if (desktopBadge) {
                desktopBadge.textContent = count;
                desktopBadge.style.display = 'flex';
            }
            const bottomBadge = document.getElementById('bottomTradeBadge');
            if (bottomBadge) {
                bottomBadge.textContent = count;
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

            // Check if draft is truly complete (all teams have all positions filled per config)
            const config = poolData.config || {
                numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1, numTeams: 1
            };
            const activeTeams = Object.values(poolData.teams || {}).filter(t => t.members && t.members.length > 0);
            const isDraftComplete = activeTeams.length > 0 && activeTeams.every(team =>
                (team.offensive || []).length === config.numOffensive &&
                (team.defensive || []).length === config.numDefensive &&
                (team.rookie || []).length === config.numRookies &&
                (team.goalie || []).length === config.numGoalies &&
                (team.teams || []).length === config.numTeams
            );

            // draftOrder is a flat array of team names on the server
            const hasDraftOrder = Array.isArray(poolData.draftOrder) && poolData.draftOrder.length > 0;
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
