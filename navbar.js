// Fantasy Pool Navbar - UX Optimized

// Get current page
function getCurrentPage() {
    const path = window.location.pathname;
    if (path.includes('accueil.html') || path.endsWith('/')) return 'accueil';
    if (path.includes('index.html')) return 'stats';
    if (path.includes('draft.html')) return 'draft';
    if (path.includes('classement.html')) return 'classement';
    if (path.includes('trade.html')) return 'trade';
    if (path.includes('pool.html')) return 'pool';
    return '';
}

// Initialize navbar
function initModernNavbar() {
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    const username = localStorage.getItem("username") || "";
    const isAdmin = localStorage.getItem("isAdmin") === "true";
    const currentPage = getCurrentPage();

    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    if (!isLoggedIn) {
        buildLoggedOutNavbar();
        return;
    }

    buildLoggedInNavbar(username, isAdmin, currentPage);
    buildBottomNav(currentPage);
    initializeEventListeners(username, isAdmin);
    loadPoolData();
    checkPendingTrades();
    checkIncompleteActions(); // Zeigarnik Effect
}

// Build logged-out navbar
function buildLoggedOutNavbar() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    const navHTML = `
        <div class="navbar-brand">
            <img src="Icons/fantazy.png" alt="Fantazy" class="navbar-logo">
        </div>
        <div class="navbar-actions">
            <a href="login.html" class="btn-login">Connexion</a>
            <a href="signup.html" class="btn-signup">Commencer</a>
        </div>
    `;

    navbar.innerHTML = navHTML;
}

// Build logged-in navbar - Desktop
function buildLoggedInNavbar(username, isAdmin, currentPage) {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    const activePool = localStorage.getItem('activePool') || '';

    // Zeigarnik Effect - Show alert if no pool selected
    const poolAlertBadge = !activePool ? '<span class="alert-dot" title="Aucun pool sélectionné"></span>' : '';

    const navHTML = `
        <!-- Desktop Layout -->
        <div class="navbar-desktop">
            <!-- Left: Logo + Nav Links -->
            <div class="navbar-left">
                <div class="navbar-brand">
                    <img src="Icons/fantazy.png" alt="Fantazy" class="navbar-logo">
                </div>

                <!-- Hick's Law: Limited to 5 core navigation items -->
                <nav class="nav-links">
                    <a href="accueil.html" class="nav-link ${currentPage === 'accueil' ? 'active' : ''}">
                        <span class="nav-icon">🏠</span>
                        <span class="nav-text">Accueil</span>
                    </a>
                    <a href="index.html" class="nav-link ${currentPage === 'stats' ? 'active' : ''}">
                        <span class="nav-icon">📊</span>
                        <span class="nav-text">Stats</span>
                    </a>
                    <a href="classement.html" class="nav-link ${currentPage === 'classement' ? 'active' : ''}">
                        <span class="nav-icon">🏆</span>
                        <span class="nav-text">Classement</span>
                    </a>
                    <a href="trade.html" class="nav-link ${currentPage === 'trade' ? 'active' : ''}" id="desktopTradeLink">
                        <span class="nav-icon">🔄</span>
                        <span class="nav-text">Échanges</span>
                        <span class="notif-badge" id="desktopTradeBadge" style="display: none;">0</span>
                    </a>
                    <a href="pool.html" class="nav-link ${currentPage === 'pool' ? 'active' : ''}">
                        <span class="nav-icon">⚙️</span>
                        <span class="nav-text">Pools</span>
                    </a>
                </nav>
            </div>

            <!-- Right: Pool Selector + User Menu -->
            <div class="navbar-right">
                <!-- Von Restorff Effect: Highlighted pool selector -->
                <div class="pool-selector-container">
                    ${poolAlertBadge}
                    <label for="desktopPoolSelector">Pool actif:</label>
                    <select id="desktopPoolSelector" class="pool-selector">
                        <option value="">Aucun pool</option>
                    </select>
                </div>

                <!-- User Menu -->
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

        <!-- Hidden selector for poolSelector.js -->
        <select id="activePoolSelector" style="display: none;">
            <option value="">-- Aucun pool --</option>
        </select>
    `;

    navbar.innerHTML = navHTML;
}

// Build bottom navigation bar - Mobile (Fitts's Law: Large touch targets)
function buildBottomNav(currentPage) {
    const existingBottomNav = document.querySelector('.bottom-nav');
    if (existingBottomNav) {
        existingBottomNav.remove();
    }

    const bottomNavHTML = `
        <nav class="bottom-nav">
            <a href="accueil.html" class="bottom-nav-item ${currentPage === 'accueil' ? 'active' : ''}">
                <span class="bottom-nav-icon">🏠</span>
                <span class="bottom-nav-label">Accueil</span>
            </a>
            <a href="index.html" class="bottom-nav-item ${currentPage === 'stats' ? 'active' : ''}">
                <span class="bottom-nav-icon">📊</span>
                <span class="bottom-nav-label">Stats</span>
            </a>
            <a href="classement.html" class="bottom-nav-item ${currentPage === 'classement' ? 'active' : ''}">
                <span class="bottom-nav-icon">🏆</span>
                <span class="bottom-nav-label">Classement</span>
            </a>
            <a href="trade.html" class="bottom-nav-item ${currentPage === 'trade' ? 'active' : ''}" id="bottomTradeLink">
                <span class="bottom-nav-icon">🔄</span>
                <span class="bottom-nav-label">Échanges</span>
                <span class="notif-badge" id="bottomTradeBadge" style="display: none;">0</span>
            </a>
            <a href="pool.html" class="bottom-nav-item ${currentPage === 'pool' ? 'active' : ''}">
                <span class="bottom-nav-icon">⚙️</span>
                <span class="bottom-nav-label">Pools</span>
            </a>
        </nav>
    `;

    document.body.insertAdjacentHTML('beforeend', bottomNavHTML);
}

// Initialize event listeners
function initializeEventListeners(username, isAdmin) {
    // User avatar dropdown toggle
    const userAvatarBtn = document.getElementById('userAvatarBtn');
    const userDropdownMenu = document.getElementById('userDropdownMenu');

    if (userAvatarBtn && userDropdownMenu) {
        userAvatarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            userDropdownMenu.classList.toggle('show');
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.user-menu')) {
                userDropdownMenu.classList.remove('show');
            }
        });
    }

    // Load admin users if admin
    if (isAdmin) {
        loadAdminUsers();
    }
}

// Load pool data
function loadPoolData() {
    const activePool = localStorage.getItem('activePool') || '';
    const desktopSelector = document.getElementById('desktopPoolSelector');
    const activePoolSelector = document.getElementById('activePoolSelector');

    function truncatePoolName(text, maxLength = 20) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
    }

    function syncDesktopSelector() {
        if (!desktopSelector || !activePoolSelector) return;

        const currentActivePool = localStorage.getItem('activePool') || '';

        desktopSelector.innerHTML = '';
        Array.from(activePoolSelector.options).forEach(option => {
            const newOption = document.createElement('option');
            newOption.value = option.value;
            newOption.textContent = truncatePoolName(option.text);
            desktopSelector.appendChild(newOption);
        });

        desktopSelector.value = currentActivePool;
    }

    if (desktopSelector && activePoolSelector) {
        setTimeout(() => {
            syncDesktopSelector();
        }, 100);

        if (!desktopSelector.dataset.listenerAdded) {
            desktopSelector.addEventListener('change', (e) => {
                const selectedPool = e.target.value;

                if (selectedPool) {
                    localStorage.setItem('activePool', selectedPool);
                } else {
                    localStorage.removeItem('activePool');
                }

                if (activePoolSelector) {
                    activePoolSelector.value = selectedPool;
                    const changeEvent = new Event('change', { bubbles: true });
                    activePoolSelector.dispatchEvent(changeEvent);

                    if (typeof $ !== 'undefined') {
                        $(activePoolSelector).val(selectedPool).trigger('change');
                    }
                }

                window.location.reload();
            });

            desktopSelector.dataset.listenerAdded = 'true';
        }
    }

    if (activePoolSelector && desktopSelector) {
        const observer = new MutationObserver(() => {
            syncDesktopSelector();
        });

        observer.observe(activePoolSelector, { childList: true });
    }
}

// Load admin users
async function loadAdminUsers() {
    try {
        const BASE_URL = window.location.hostname.includes("localhost")
            ? "http://localhost:3000"
            : window.location.origin;

        const response = await fetch(`${BASE_URL}/admin-users?adminToken=admin`);
        const data = await response.json();

        if (response.ok) {
            const regularUsers = data.users.filter(u => u !== 'admin').slice(0, 5);
            const adminUsersList = document.getElementById('adminUsersList');

            if (adminUsersList && regularUsers.length > 0) {
                adminUsersList.innerHTML = `
                    <div class="admin-section-title">Changer d'utilisateur</div>
                    ${regularUsers.map(username => `
                        <button class="dropdown-item" onclick="switchToUser('${username}')">
                            <span class="user-avatar-small">${username.charAt(0).toUpperCase()}</span>
                            <span>${username}</span>
                        </button>
                    `).join('')}
                `;
            }
        }
    } catch (error) {
        console.error('Error loading admin users:', error);
    }
}

// Switch to user (admin only)
async function switchToUser(username) {
    try {
        const BASE_URL = window.location.hostname.includes("localhost")
            ? "http://localhost:3000"
            : window.location.origin;

        const response = await fetch(`${BASE_URL}/admin-switch-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                adminToken: 'admin',
                targetUsername: username
            })
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

// Check for pending trades (Zeigarnik Effect - show incomplete tasks)
async function checkPendingTrades() {
    try {
        const BASE_URL = window.location.hostname.includes("localhost")
            ? "http://localhost:3000"
            : window.location.origin;

        const username = localStorage.getItem("username");
        const activePool = localStorage.getItem("activePool");

        if (!username || !activePool) return;

        const response = await fetch(`${BASE_URL}/pending-trades?username=${username}&poolName=${activePool}`);
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

// Check for incomplete actions (Zeigarnik Effect)
function checkIncompleteActions() {
    const activePool = localStorage.getItem('activePool');

    // Show visual indicator if no pool is selected
    if (!activePool) {
        const alertDot = document.querySelector('.alert-dot');
        if (alertDot) {
            alertDot.style.display = 'block';
        }
    }
}

// Logout function
function logout() {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("username");
    localStorage.removeItem("isAdmin");
    localStorage.removeItem("activePool");
    window.location.href = "login.html";
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initModernNavbar();
});
