// Common Navbar Functionality
// Handles admin dropdown, user switching, logout, and mobile menu

// Initialize navbar admin UI on page load
function initializeNavbarAdminUI() {
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    const username = localStorage.getItem("username");
    const isAdmin = localStorage.getItem("isAdmin") === "true";

    if (isLoggedIn) {
        if (isAdmin) {
            // Admin mode - show Utilisateur dropdown with icon (desktop only)
            $("#admin-users-link").css('display', 'block').html(`
                <div class="admin-dropdown-container">
                    <a href="#" class="admin-dropdown-toggle" onclick="toggleAdminDropdown(event)">
                        <img src="Icons/utilisateur.png" alt="Utilisateur" class="nav-icon">
                        <span class="nav-text">Utilisateur ▼</span>
                    </a>
                    <div class="admin-dropdown-menu" id="adminDropdown">
                        <div class="admin-dropdown-header">Changer d'utilisateur</div>
                        <div id="adminUserList" class="admin-user-list">Chargement...</div>
                    </div>
                </div>
            `);
            $("#login-link").html(`
                <a href="#" onclick="logout(event)">
                    <img src="Icons/deconnexion.png" alt="Déconnexion" class="nav-icon">
                    <span class="nav-text">Déconnexion (${username})</span>
                </a>
            `);
            loadAdminUsers();
        } else {
            // Regular user - just show logout with icon (desktop only)
            $("#login-link").html(`
                <a href="#" onclick="logout(event)">
                    <img src="Icons/deconnexion.png" alt="Déconnexion" class="nav-icon">
                    <span class="nav-text">Déconnexion (${username})</span>
                </a>
            `);
        }

        // Initialize mobile menu
        initializeMobileMenu();
    }
}

// Initialize mobile menu
function initializeMobileMenu() {
    // Create mobile menu elements if they don't exist
    if (!document.getElementById('mobileMenuBtn')) {
        // Add hamburger button after the navbar ul
        const navbar = document.querySelector('.navbar');
        const hamburger = document.createElement('button');
        hamburger.id = 'mobileMenuBtn';
        hamburger.className = 'mobile-menu-btn';
        hamburger.innerHTML = '<span></span><span></span><span></span>';
        hamburger.onclick = toggleMobileMenu;
        navbar.appendChild(hamburger);
    }

    if (!document.getElementById('mobileMenuOverlay')) {
        // Create mobile menu overlay
        const overlay = document.createElement('div');
        overlay.id = 'mobileMenuOverlay';
        overlay.className = 'mobile-menu-overlay';
        document.body.appendChild(overlay);

        // Create backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'mobileMenuBackdrop';
        backdrop.className = 'mobile-menu-backdrop';
        backdrop.onclick = closeMobileMenu;
        document.body.appendChild(backdrop);
    }

    // Load mobile menu content
    loadMobileMenuContent();
}

// Load mobile menu content
function loadMobileMenuContent() {
    const username = localStorage.getItem("username");
    const isAdmin = localStorage.getItem("isAdmin") === "true";
    const overlay = document.getElementById('mobileMenuOverlay');

    if (!overlay) return;

    let menuHTML = '';

    // Pool selector section
    menuHTML += `
        <div class="mobile-menu-section">
            <h3>Pool Actif</h3>
            <label for="mobilePoolSelector">Sélectionner un pool</label>
            <select id="mobilePoolSelector" onchange="handleMobilePoolChange(this)">
                <option value="">-- Aucun pool --</option>
            </select>
        </div>
    `;

    // Admin user switching section
    if (isAdmin) {
        menuHTML += `
            <div class="mobile-menu-section">
                <h3>Changer d'utilisateur</h3>
                <div id="mobileUserList">Chargement...</div>
            </div>
        `;
    }

    // Logout section
    menuHTML += `
        <div class="mobile-menu-section">
            <button class="mobile-logout-btn" onclick="logout(event)">
                <span>Déconnexion${username ? ' (' + username + ')' : ''}</span>
            </button>
        </div>
    `;

    overlay.innerHTML = menuHTML;

    // Load pools into mobile selector
    loadMobilePoolSelector();

    // Load admin users if admin
    if (isAdmin) {
        loadMobileAdminUsers();
    }
}

// Load pools into mobile selector
function loadMobilePoolSelector() {
    const mobileSelector = document.getElementById('mobilePoolSelector');
    const desktopSelector = document.getElementById('activePoolSelector');

    if (mobileSelector && desktopSelector) {
        // Copy options from desktop selector
        mobileSelector.innerHTML = desktopSelector.innerHTML;
        mobileSelector.value = desktopSelector.value;
    }
}

// Handle pool change from mobile menu
function handleMobilePoolChange(select) {
    const desktopSelector = document.getElementById('activePoolSelector');
    if (desktopSelector) {
        desktopSelector.value = select.value;
        // Trigger change event on desktop selector
        const event = new Event('change', { bubbles: true });
        desktopSelector.dispatchEvent(event);
    }
    closeMobileMenu();
}

// Load admin users into mobile menu
async function loadMobileAdminUsers() {
    try {
        const BASE_URL = window.location.hostname.includes("localhost")
            ? "http://localhost:3000"
            : "https://goondraft.onrender.com";

        const response = await fetch(`${BASE_URL}/admin-users?adminToken=admin`);
        const data = await response.json();

        if (response.ok) {
            const regularUsers = data.users.filter(u => u !== 'admin').slice(0, 4);
            const userListEl = document.getElementById('mobileUserList');

            if (!userListEl) return;

            if (regularUsers.length === 0) {
                userListEl.innerHTML = '<div style="text-align: center; color: #999; padding: 10px;">Aucun utilisateur</div>';
            } else {
                userListEl.innerHTML = regularUsers.map(username => `
                    <a href="#" class="mobile-user-item" onclick="switchToUser(event, '${username}')">
                        <span class="user-avatar">${username.charAt(0).toUpperCase()}</span>
                        <span class="user-name">${username}</span>
                    </a>
                `).join('');
            }
        }
    } catch (error) {
        console.error('Error loading mobile users:', error);
        const userListEl = document.getElementById('mobileUserList');
        if (userListEl) {
            userListEl.innerHTML = '<div style="text-align: center; color: #999; padding: 10px;">Erreur</div>';
        }
    }
}

// Toggle mobile menu
function toggleMobileMenu() {
    const btn = document.getElementById('mobileMenuBtn');
    const overlay = document.getElementById('mobileMenuOverlay');
    const backdrop = document.getElementById('mobileMenuBackdrop');

    if (btn && overlay && backdrop) {
        btn.classList.toggle('active');
        overlay.classList.toggle('active');
        backdrop.classList.toggle('active');

        // Prevent body scroll when menu is open
        if (overlay.classList.contains('active')) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    }
}

// Close mobile menu
function closeMobileMenu() {
    const btn = document.getElementById('mobileMenuBtn');
    const overlay = document.getElementById('mobileMenuOverlay');
    const backdrop = document.getElementById('mobileMenuBackdrop');

    if (btn && overlay && backdrop) {
        btn.classList.remove('active');
        overlay.classList.remove('active');
        backdrop.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Toggle admin dropdown
function toggleAdminDropdown(event) {
    event.preventDefault();
    event.stopPropagation();
    const dropdown = document.getElementById('adminDropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('adminDropdown');
    if (dropdown && !event.target.closest('.admin-dropdown-container')) {
        dropdown.classList.remove('show');
    }
});

// Load admin users list
async function loadAdminUsers() {
    try {
        const BASE_URL = window.location.hostname.includes("localhost")
            ? "http://localhost:3000"
            : "https://goondraft.onrender.com";

        const response = await fetch(`${BASE_URL}/admin-users?adminToken=admin`);
        const data = await response.json();

        if (response.ok) {
            const regularUsers = data.users.filter(u => u !== 'admin').slice(0, 4);
            const userListEl = document.getElementById('adminUserList');

            if (!userListEl) return;

            if (regularUsers.length === 0) {
                userListEl.innerHTML = '<div class="admin-no-users">Aucun utilisateur</div>';
            } else {
                userListEl.innerHTML = regularUsers.map(username => `
                    <a href="#" class="admin-dropdown-item" onclick="switchToUser(event, '${username}')">
                        <span class="user-avatar">${username.charAt(0).toUpperCase()}</span>
                        <span class="user-name">${username}</span>
                    </a>
                `).join('');
            }
        }
    } catch (error) {
        console.error('Error loading users:', error);
        const userListEl = document.getElementById('adminUserList');
        if (userListEl) {
            userListEl.innerHTML = '<div class="admin-no-users">Erreur</div>';
        }
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

// Initialize on document ready
$(document).ready(function() {
    initializeNavbarAdminUI();
});
