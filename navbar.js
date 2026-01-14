// Modern Navbar - Complete Redesign
// Handles mobile slide menu and desktop navigation

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
        // Show navbar even if not logged in (it will be empty or show login state)
        navbar.classList.add('navbar-ready');
        return;
    }

    // Build navbar structure
    buildNavbarStructure(username, isAdmin, currentPage);

    // Initialize event listeners
    initializeEventListeners();

    // Load pool data
    loadPoolSelectors();

    // Set up observers to keep navbar pool selectors in sync
    setupPoolSelectorObservers();

    // Show the navbar now that it's ready
    navbar.classList.add('navbar-ready');
}

// Build navbar HTML structure
function buildNavbarStructure(username, isAdmin, currentPage) {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    // Clear existing content except the base structure
    const navHTML = `
        <!-- Left: Hamburger Menu -->
        <div class="navbar-left">
            <button class="hamburger-menu" id="hamburgerBtn">
                <span></span>
                <span></span>
                <span></span>
            </button>
        </div>

        <!-- Center: Logo & Title -->
        <div class="navbar-center">
            <img src="Icons/williePooler.png" alt="Willie Pooler" class="navbar-logo">
            <span class="navbar-title">Willie Pooler</span>
        </div>

        <!-- Desktop Navigation (hidden on mobile) -->
        <div class="desktop-nav">
            <a href="index.html" class="desktop-nav-item ${currentPage === 'stats' ? 'active' : ''}">
                Stats
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
            <a href="trade.html" class="desktop-nav-item ${currentPage === 'trade' ? 'active' : ''}" id="tradeNavLink">
                Échanges
                <span class="notif-badge" id="tradeNavBadge" style="display: none;">0</span>
            </a>
        </div>

        <!-- Hidden Pool Selector for poolSelector.js to populate -->
        <div style="display: none;">
            <select id="activePoolSelector">
                <option value="">-- Aucun pool --</option>
            </select>
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
            <div class="pool-badge" id="poolBadge" onclick="openSlideMenu()">Aucun</div>
            <div class="user-menu-dropdown">
                <div class="user-avatar-btn" id="userAvatarBtn">
                    ${username.charAt(0).toUpperCase()}
                </div>
                <div class="user-dropdown-menu" id="userDropdownMenu">
                    <div class="user-dropdown-header">Connecté: ${username}</div>
                    ${isAdmin ? buildAdminDropdownItems() : ''}
                    <div class="user-dropdown-item logout" onclick="logout(event)">
                        Déconnexion
                    </div>
                </div>
            </div>
        </div>
    `;

    navbar.innerHTML = navHTML;

    // Build slide menu
    buildSlideMenu(username, isAdmin, currentPage);
}

// Build admin dropdown items for desktop
function buildAdminDropdownItems() {
    return `
        <div class="user-dropdown-header">Admin</div>
        <div id="desktopAdminUsers">
            <div style="padding: 12px 16px; color: #888; font-size: 0.85rem;">Chargement...</div>
        </div>
    `;
}

// Build slide menu
function buildSlideMenu(username, isAdmin, currentPage) {
    const menuHTML = `
        <div class="slide-menu" id="slideMenu">
            <div class="menu-header">
                <h3>Navigation</h3>
            </div>

            <a href="index.html" class="menu-item ${currentPage === 'stats' ? 'active' : ''}">
                <img src="Icons/stats.png" alt="Stats">
                <span>Statistiques</span>
            </a>

            <a href="pool.html" class="menu-item ${currentPage === 'pool' ? 'active' : ''}">
                <img src="Icons/pool.png" alt="Pool">
                <span>Pool</span>
            </a>

            <a href="draft.html" class="menu-item ${currentPage === 'draft' ? 'active' : ''}">
                <img src="Icons/draft.png" alt="Draft">
                <span>Draft</span>
            </a>

            <a href="classement.html" class="menu-item ${currentPage === 'classement' ? 'active' : ''}">
                <img src="Icons/classement.png" alt="Classement">
                <span>Classement</span>
            </a>

            <a href="trade.html" class="menu-item ${currentPage === 'trade' ? 'active' : ''}" id="tradeMenuItem">
                <img src="Icons/echanges.png" alt="Échanges">
                <span>Échanges</span>
                <span class="notif-badge" id="tradeMenuBadge" style="display: none;">0</span>
            </a>

            <div class="menu-pool-section">
                <label for="mobilePoolSelector">Pool actif</label>
                <select id="mobilePoolSelector">
                    <option value="">Aucun pool</option>
                </select>
            </div>

            ${isAdmin ? buildAdminSection() : ''}

            <button class="menu-logout" onclick="logout(event)">
                Déconnexion (${username})
            </button>
        </div>

        <div class="menu-backdrop" id="menuBackdrop"></div>
    `;

    document.body.insertAdjacentHTML('beforeend', menuHTML);

    // Load admin users if admin
    if (isAdmin) {
        loadAdminUsers();
    }
}

// Build admin section for mobile menu
function buildAdminSection() {
    return `
        <div class="menu-admin-section">
            <div class="menu-admin-title">Changer d'utilisateur</div>
            <div id="mobileAdminUsers">
                <div style="text-align: center; color: #888; padding: 10px; font-size: 0.85rem;">Chargement...</div>
            </div>
        </div>
    `;
}

// Initialize event listeners
function initializeEventListeners() {
    // Hamburger menu toggle
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', toggleSlideMenu);
    }

    // User avatar dropdown (desktop)
    const userAvatarBtn = document.getElementById('userAvatarBtn');
    if (userAvatarBtn) {
        userAvatarBtn.addEventListener('click', toggleUserDropdown);
    }

    // Backdrop click
    const backdrop = document.getElementById('menuBackdrop');
    if (backdrop) {
        backdrop.addEventListener('click', closeSlideMenu);
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('userDropdownMenu');
        const avatar = document.getElementById('userAvatarBtn');
        if (dropdown && avatar && !dropdown.contains(e.target) && !avatar.contains(e.target)) {
            dropdown.classList.remove('active');
        }
    });

    // Pool selectors change events
    const desktopSelector = document.getElementById('desktopPoolSelector');
    const mobileSelector = document.getElementById('mobilePoolSelector');

    if (desktopSelector) {
        desktopSelector.addEventListener('change', handlePoolChange);
    }

    if (mobileSelector) {
        mobileSelector.addEventListener('change', (e) => {
            handlePoolChange(e);
            closeSlideMenu();
        });
    }
}

// Toggle slide menu
function toggleSlideMenu() {
    const menu = document.getElementById('slideMenu');
    const backdrop = document.getElementById('menuBackdrop');
    const hamburger = document.getElementById('hamburgerBtn');

    if (menu && backdrop && hamburger) {
        menu.classList.toggle('active');
        backdrop.classList.toggle('active');
        hamburger.classList.toggle('active');

        // Prevent body scroll when menu open
        if (menu.classList.contains('active')) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    }
}

// Open slide menu (for pool badge click)
function openSlideMenu() {
    const menu = document.getElementById('slideMenu');
    const backdrop = document.getElementById('menuBackdrop');
    const hamburger = document.getElementById('hamburgerBtn');

    if (menu && backdrop && hamburger) {
        menu.classList.add('active');
        backdrop.classList.add('active');
        hamburger.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

// Close slide menu
function closeSlideMenu() {
    const menu = document.getElementById('slideMenu');
    const backdrop = document.getElementById('menuBackdrop');
    const hamburger = document.getElementById('hamburgerBtn');

    if (menu && backdrop && hamburger) {
        menu.classList.remove('active');
        backdrop.classList.remove('active');
        hamburger.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Toggle user dropdown (desktop)
function toggleUserDropdown(e) {
    e.stopPropagation();
    const dropdown = document.getElementById('userDropdownMenu');
    if (dropdown) {
        dropdown.classList.toggle('active');
    }
}

// Load pool selectors
function loadPoolSelectors() {
    const desktopSelector = document.getElementById('desktopPoolSelector');
    const mobileSelector = document.getElementById('mobilePoolSelector');

    // If activePoolSelector exists on page, sync with it
    const pageSelector = document.getElementById('activePoolSelector');

    if (pageSelector) {
        // Copy options from page selector
        if (desktopSelector) {
            desktopSelector.innerHTML = pageSelector.innerHTML;
            desktopSelector.value = pageSelector.value;
        }
        if (mobileSelector) {
            mobileSelector.innerHTML = pageSelector.innerHTML;
            mobileSelector.value = pageSelector.value;
        }

        // Update pool badge
        updatePoolBadge(pageSelector.value, pageSelector.options[pageSelector.selectedIndex]?.text);
    }
}

// Sync navbar pool selectors with page pool selector
function syncNavbarPoolSelectors() {
    const desktopSelector = document.getElementById('desktopPoolSelector');
    const mobileSelector = document.getElementById('mobilePoolSelector');
    const pageSelector = document.getElementById('activePoolSelector');

    if (!pageSelector) return;

    // Only sync if page selector has options (more than just the default "Aucun pool")
    if (pageSelector.options.length > 1) {
        if (desktopSelector) {
            desktopSelector.innerHTML = pageSelector.innerHTML;
            desktopSelector.value = pageSelector.value;
        }
        if (mobileSelector) {
            mobileSelector.innerHTML = pageSelector.innerHTML;
            mobileSelector.value = pageSelector.value;
        }

        // Update pool badge
        updatePoolBadge(pageSelector.value, pageSelector.options[pageSelector.selectedIndex]?.text);
    }
}

// Set up observers to watch for pool selector changes
function setupPoolSelectorObservers() {
    const pageSelector = document.getElementById('activePoolSelector');

    if (pageSelector) {
        // Watch for changes to the options in the page selector
        const observer = new MutationObserver(() => {
            syncNavbarPoolSelectors();
        });

        observer.observe(pageSelector, {
            childList: true,
            subtree: true
        });

        // Listen for the change event on page selector
        pageSelector.addEventListener('change', () => {
            syncNavbarPoolSelectors();
        });

        // Listen for custom activePoolChanged event from poolSelector.js
        $(document).on('activePoolChanged', () => {
            syncNavbarPoolSelectors();
        });

        // Use jQuery ready to ensure DOM and scripts are loaded
        $(document).ready(() => {
            syncNavbarPoolSelectors();
            // Also do delayed syncs to catch async pool loading
            setTimeout(syncNavbarPoolSelectors, 500);
            setTimeout(syncNavbarPoolSelectors, 1500);
            setTimeout(syncNavbarPoolSelectors, 3000);
        });
    } else {
        // If no page selector exists, try again after page loads
        $(document).ready(() => {
            const retrySelector = document.getElementById('activePoolSelector');
            if (retrySelector) {
                setupPoolSelectorObservers();
            }
        });
    }
}

// Handle pool change
function handlePoolChange(event) {
    const selectedValue = event.target.value;
    const selectedText = event.target.options[event.target.selectedIndex]?.text;

    // Sync all selectors
    const desktopSelector = document.getElementById('desktopPoolSelector');
    const mobileSelector = document.getElementById('mobilePoolSelector');
    const pageSelector = document.getElementById('activePoolSelector');

    if (desktopSelector && desktopSelector !== event.target) {
        desktopSelector.value = selectedValue;
    }
    if (mobileSelector && mobileSelector !== event.target) {
        mobileSelector.value = selectedValue;
    }
    if (pageSelector && pageSelector !== event.target) {
        pageSelector.value = selectedValue;
        // Trigger change event on page selector
        const changeEvent = new Event('change', { bubbles: true });
        pageSelector.dispatchEvent(changeEvent);
    }

    // Update pool badge
    updatePoolBadge(selectedValue, selectedText);
}

// Update pool badge
function updatePoolBadge(value, text) {
    const badge = document.getElementById('poolBadge');
    if (badge) {
        if (value && text !== '-- Aucun pool --') {
            badge.textContent = text;
            badge.classList.remove('no-pool');
        } else {
            badge.textContent = 'Aucun';
            badge.classList.add('no-pool');
        }
    }
}

// Load admin users
async function loadAdminUsers() {
    try {
        const BASE_URL = window.location.hostname.includes("localhost")
            ? "http://localhost:3000"
            : "https://goondraft.onrender.com";

        const response = await fetch(`${BASE_URL}/admin-users?adminToken=admin`);
        const data = await response.json();

        if (response.ok) {
            const regularUsers = data.users.filter(u => u !== 'admin');

            // Update mobile menu
            const mobileContainer = document.getElementById('mobileAdminUsers');
            if (mobileContainer) {
                if (regularUsers.length === 0) {
                    mobileContainer.innerHTML = '<div style="text-align: center; color: #888; padding: 10px; font-size: 0.85rem;">Aucun utilisateur</div>';
                } else {
                    mobileContainer.innerHTML = regularUsers.map(user => `
                        <a href="#" class="admin-user-item" onclick="switchToUser(event, '${user}')">
                            <div class="admin-user-avatar">${user.charAt(0).toUpperCase()}</div>
                            <div class="admin-user-name">${user}</div>
                        </a>
                    `).join('');
                }
            }

            // Update desktop dropdown
            const desktopContainer = document.getElementById('desktopAdminUsers');
            if (desktopContainer) {
                if (regularUsers.length === 0) {
                    desktopContainer.innerHTML = '<div style="padding: 12px 16px; color: #888; font-size: 0.85rem;">Aucun utilisateur</div>';
                } else {
                    desktopContainer.innerHTML = regularUsers.map(user => `
                        <div class="user-dropdown-item" onclick="switchToUser(event, '${user}')">
                            <div class="admin-user-avatar" style="width: 28px; height: 28px; font-size: 0.8rem;">${user.charAt(0).toUpperCase()}</div>
                            <span>${user}</span>
                        </div>
                    `).join('');
                }
            }
        }
    } catch (error) {
        console.error('Error loading admin users:', error);
    }
}

// Switch to another user (admin only)
async function switchToUser(event, username) {
    event.preventDefault();
    event.stopPropagation();

    try {
        const BASE_URL = window.location.hostname.includes("localhost")
            ? "http://localhost:3000"
            : "https://goondraft.onrender.com";

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
            localStorage.setItem('activeUser', username);
            window.location.reload();
        } else {
            alert('Erreur lors du changement d\'utilisateur');
        }
    } catch (error) {
        console.error('Error switching user:', error);
        alert('Erreur lors du changement d\'utilisateur');
    }
}

// Logout function
function logout(event) {
    event.preventDefault();
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("username");
    localStorage.removeItem("isAdmin");
    localStorage.removeItem("activeUser");
    localStorage.removeItem("activePool");
    window.location.href = "login.html";
}

// Check for pending trades and update badges
async function checkPendingTrades() {
    try {
        const BASE_URL = window.location.hostname.includes("localhost")
            ? "http://localhost:3000"
            : "https://goondraft.onrender.com";

        const username = localStorage.getItem("username");
        const activePool = localStorage.getItem("activePool");

        if (!username || !activePool) return;

        const response = await fetch(`${BASE_URL}/trades`);
        const data = await response.json();

        if (response.ok && data.pending) {
            const myTrades = data.pending.filter(trade =>
                trade.toTeam === username && trade.draftName === activePool
            );

            const count = myTrades.length;

            // Update mobile badge
            const mobileBadge = document.getElementById('tradeMenuBadge');
            if (mobileBadge) {
                if (count > 0) {
                    mobileBadge.textContent = count;
                    mobileBadge.style.display = 'inline-block';
                } else {
                    mobileBadge.style.display = 'none';
                }
            }

            // Update desktop badge
            const desktopBadge = document.getElementById('tradeNavBadge');
            if (desktopBadge) {
                if (count > 0) {
                    desktopBadge.textContent = count;
                    desktopBadge.style.display = 'inline-block';
                } else {
                    desktopBadge.style.display = 'none';
                }
            }
        }
    } catch (error) {
        console.error('Error checking pending trades:', error);
    }
}

// Initialize on document ready
$(document).ready(function() {
    initModernNavbar();
    checkPendingTrades();

    // Check pending trades periodically
    setInterval(checkPendingTrades, 30000); // Every 30 seconds
});
