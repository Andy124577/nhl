// Mobile-First Navbar - Bottom Navigation Bar
// Desktop horizontal navbar + Mobile bottom navbar

// Get current page
function getCurrentPage() {
    const path = window.location.pathname;
    if (path.includes('index.html') || path.endsWith('/')) return 'stats';
    if (path.includes('pool.html')) return 'pool';
    if (path.includes('draft.html')) return 'draft';
    if (path.includes('classement.html')) return 'classement';
    if (path.includes('trade.html')) return 'trade';
    return '';
}

// Initialize modern navbar
function initModernNavbar() {
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    const username = localStorage.getItem("username") || "";
    const isAdmin = localStorage.getItem("isAdmin") === "true";
    const currentPage = getCurrentPage();

    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    if (!isLoggedIn) {
        // Show logged-out navbar with login/signup buttons
        buildLoggedOutNavbar();
        return;
    }

    // Build navbar structure
    buildLoggedInNavbar(username, isAdmin, currentPage);

    // Build bottom navigation (mobile)
    buildBottomNav(currentPage);

    // Initialize event listeners
    initializeEventListeners(username, isAdmin);

    // Load pool data
    loadPoolData();

    // Check for pending trades
    checkPendingTrades();
}

// Build logged-out navbar
function buildLoggedOutNavbar() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    const navHTML = `
        <div class="navbar-center">
            <img src="Icons/fantazy.png" alt="Fantazy" class="navbar-logo">
        </div>
        <div class="navbar-right">
            <a href="login.html" class="btn-login">Connexion</a>
            <a href="signup.html" class="btn-signup">Inscription</a>
        </div>
    `;

    navbar.innerHTML = navHTML;
}

// Build logged-in navbar (top bar)
function buildLoggedInNavbar(username, isAdmin, currentPage) {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    const navHTML = `
        <!-- Center: Logo -->
        <div class="navbar-center">
            <img src="Icons/fantazy.png" alt="Fantazy" class="navbar-logo">
        </div>

        <!-- Desktop Navigation (hidden on mobile) -->
        <div class="desktop-nav">
            <a href="index.html" class="desktop-nav-item ${currentPage === 'stats' ? 'active' : ''}">
                Statistiques
            </a>
            <a href="pool.html" class="desktop-nav-item ${currentPage === 'pool' ? 'active' : ''}">
                Pool
            </a>
            <a href="draft.html" class="desktop-nav-item ${currentPage === 'draft' ? 'active' : ''}">
                Draft
            </a>
            <a href="classement.html" class="desktop-nav-item ${currentPage === 'classement' ? 'active' : ''}">
                Classement
            </a>
            <a href="trade.html" class="desktop-nav-item ${currentPage === 'trade' ? 'active' : ''}" id="desktopTradeLink">
                Échanges
                <span class="notif-badge" id="desktopTradeBadge" style="display: none;">0</span>
            </a>
        </div>

        <!-- Desktop Pool Selector -->
        <div class="desktop-pool-selector">
            <label for="desktopPoolSelector">Pool:</label>
            <select id="desktopPoolSelector">
                <option value="">Aucun pool</option>
            </select>
        </div>

        <!-- Right: Pool Badge & User Avatar -->
        <div class="navbar-right">
            <div class="pool-badge" id="poolBadge">Aucun</div>
            <div class="user-menu-dropdown">
                <div class="user-avatar-btn" id="userAvatarBtn">
                    ${username.charAt(0).toUpperCase()}
                </div>
                <div class="user-dropdown-menu" id="userDropdownMenu">
                    <div class="user-dropdown-header">Connecté: ${username}</div>
                    ${isAdmin ? '<div class="user-dropdown-header">Admin</div><div id="adminUsersList"></div>' : ''}
                    <div class="user-dropdown-item logout" onclick="logout()">
                        Déconnexion
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

// Build bottom navigation bar (mobile only)
function buildBottomNav(currentPage) {
    // Remove existing bottom nav if any
    const existingBottomNav = document.querySelector('.bottom-nav');
    if (existingBottomNav) {
        existingBottomNav.remove();
    }

    // Create bottom nav
    const bottomNavHTML = `
        <div class="bottom-nav">
            <a href="index.html" class="bottom-nav-item ${currentPage === 'stats' ? 'active' : ''}">
                <img src="Icons/stats.png" alt="Stats" class="bottom-nav-icon">
                <span class="bottom-nav-label">Statistiques</span>
            </a>
            <a href="pool.html" class="bottom-nav-item ${currentPage === 'pool' ? 'active' : ''}">
                <img src="Icons/pool.png" alt="Pool" class="bottom-nav-icon">
                <span class="bottom-nav-label">Pool</span>
            </a>
            <a href="draft.html" class="bottom-nav-item ${currentPage === 'draft' ? 'active' : ''}">
                <img src="Icons/draft.png" alt="Draft" class="bottom-nav-icon">
                <span class="bottom-nav-label">Draft</span>
            </a>
            <a href="classement.html" class="bottom-nav-item ${currentPage === 'classement' ? 'active' : ''}">
                <img src="Icons/classement.png" alt="Classement" class="bottom-nav-icon">
                <span class="bottom-nav-label">Classement</span>
            </a>
            <a href="trade.html" class="bottom-nav-item ${currentPage === 'trade' ? 'active' : ''}" id="bottomTradeLink">
                <img src="Icons/echanges.png" alt="Échanges" class="bottom-nav-icon">
                <span class="bottom-nav-label">Échanges</span>
                <span class="notif-badge" id="bottomTradeBadge" style="display: none;">0</span>
            </a>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', bottomNavHTML);
}

// Build pool selector modal
function buildPoolSelectorModal() {
    // Remove existing modal if any
    const existingModal = document.querySelector('.pool-selector-modal');
    if (existingModal) {
        existingModal.remove();
    }

    const modalHTML = `
        <div class="pool-selector-modal" id="poolSelectorModal">
            <div class="pool-selector-content">
                <div class="pool-selector-header">
                    <h3>Sélectionner un pool</h3>
                    <button class="pool-selector-close" onclick="closePoolSelector()">&times;</button>
                </div>
                <div id="poolOptionsList">
                    <div class="pool-option">Aucun pool disponible</div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
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

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.user-menu-dropdown')) {
                userDropdownMenu.classList.remove('show');
            }
        });
    }

    // Pool badge click - open pool selector modal
    const poolBadge = document.getElementById('poolBadge');
    if (poolBadge) {
        poolBadge.addEventListener('click', () => {
            openPoolSelector();
        });
    }

    // Build and initialize pool selector modal
    buildPoolSelectorModal();

    // Load admin users if admin
    if (isAdmin) {
        loadAdminUsers();
    }
}

// Open pool selector modal
function openPoolSelector() {
    const modal = document.getElementById('poolSelectorModal');
    if (modal) {
        modal.classList.add('show');
        loadPoolOptions();
    }
}

// Close pool selector modal
function closePoolSelector() {
    const modal = document.getElementById('poolSelectorModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

// Load pool options into modal
function loadPoolOptions() {
    const currentPool = localStorage.getItem('activePool') || '';
    const poolsList = document.getElementById('poolOptionsList');
    if (!poolsList) return;

    // Get pools from the hidden select (populated by poolSelector.js)
    const poolSelector = document.getElementById('activePoolSelector');
    if (!poolSelector) return;

    const options = Array.from(poolSelector.options);

    if (options.length <= 1) {
        poolsList.innerHTML = '<div class="pool-option">Aucun pool disponible</div>';
        return;
    }

    poolsList.innerHTML = options.map(option => {
        if (option.value === '') return '';
        const isActive = option.value === currentPool;
        return `
            <div class="pool-option ${isActive ? 'active' : ''}" onclick="selectPool('${option.value}')">
                ${option.text}
            </div>
        `;
    }).join('');
}

// Select pool from modal
function selectPool(poolName) {
    localStorage.setItem('activePool', poolName);

    // Update all pool selectors
    const selectors = ['activePoolSelector', 'desktopPoolSelector'];
    selectors.forEach(id => {
        const selector = document.getElementById(id);
        if (selector) {
            selector.value = poolName;
        }
    });

    // Update pool badge
    const poolBadge = document.getElementById('poolBadge');
    if (poolBadge) {
        poolBadge.textContent = poolName || 'Aucun';
    }

    // Close modal
    closePoolSelector();

    // Trigger change event for poolSelector.js
    const event = new Event('change');
    const mainSelector = document.getElementById('activePoolSelector');
    if (mainSelector) {
        mainSelector.dispatchEvent(event);
    }

    // Reload page to update content
    window.location.reload();
}

// Load pool data
function loadPoolData() {
    const activePool = localStorage.getItem('activePool') || '';
    const poolBadge = document.getElementById('poolBadge');

    if (poolBadge) {
        poolBadge.textContent = activePool || 'Aucun';
    }

    // Sync desktop selector with hidden activePoolSelector
    const desktopSelector = document.getElementById('desktopPoolSelector');
    const activePoolSelector = document.getElementById('activePoolSelector');

    if (desktopSelector && activePoolSelector) {
        // Copy all options from activePoolSelector to desktopPoolSelector
        desktopSelector.innerHTML = '';
        Array.from(activePoolSelector.options).forEach(option => {
            const newOption = document.createElement('option');
            newOption.value = option.value;
            newOption.textContent = option.text;
            desktopSelector.appendChild(newOption);
        });

        // Set the current value
        desktopSelector.value = activePool;

        desktopSelector.addEventListener('change', (e) => {
            selectPool(e.target.value);
        });
    }

    // Watch for changes in activePoolSelector (when poolSelector.js updates it)
    if (activePoolSelector) {
        const observer = new MutationObserver(() => {
            if (desktopSelector) {
                const currentValue = desktopSelector.value;
                desktopSelector.innerHTML = '';
                Array.from(activePoolSelector.options).forEach(option => {
                    const newOption = document.createElement('option');
                    newOption.value = option.value;
                    newOption.textContent = option.text;
                    desktopSelector.appendChild(newOption);
                });
                desktopSelector.value = currentValue;
            }
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
            const regularUsers = data.users.filter(u => u !== 'admin').slice(0, 4);
            const adminUsersList = document.getElementById('adminUsersList');

            if (adminUsersList && regularUsers.length > 0) {
                adminUsersList.innerHTML = regularUsers.map(username => `
                    <div class="user-dropdown-item" onclick="switchToUser('${username}')">
                        <span class="user-avatar">${username.charAt(0).toUpperCase()}</span>
                        <span class="user-name">${username}</span>
                    </div>
                `).join('');
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

// Check for pending trades
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
            // Update desktop badge
            const desktopBadge = document.getElementById('desktopTradeBadge');
            if (desktopBadge) {
                desktopBadge.textContent = data.count;
                desktopBadge.style.display = 'block';
            }

            // Update mobile badge
            const bottomBadge = document.getElementById('bottomTradeBadge');
            if (bottomBadge) {
                bottomBadge.textContent = data.count;
                bottomBadge.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Error checking pending trades:', error);
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
