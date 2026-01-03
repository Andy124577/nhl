// Common Navbar Functionality
// Handles admin dropdown, user switching, and logout

// Initialize navbar admin UI on page load
function initializeNavbarAdminUI() {
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    const username = localStorage.getItem("username");
    const isAdmin = localStorage.getItem("isAdmin") === "true";

    if (isLoggedIn) {
        if (isAdmin) {
            // Admin mode - show Utilisateur dropdown with icon
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
            // Regular user - just show logout with icon
            $("#login-link").html(`
                <a href="#" onclick="logout(event)">
                    <img src="Icons/deconnexion.png" alt="Déconnexion" class="nav-icon">
                    <span class="nav-text">Déconnexion (${username})</span>
                </a>
            `);
        }
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
