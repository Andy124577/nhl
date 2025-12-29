const BASE_URL = window.location.hostname.includes("localhost")
  ? "http://localhost:3000"
  : "https://goondraft.onrender.com";

$(document).ready(function () {
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    const username = localStorage.getItem("username");
    const isAdmin = localStorage.getItem("isAdmin") === "true";

    if (isLoggedIn) {
        if (isAdmin) {
            // Admin mode - show Utilisateur dropdown and normal logout
            $("#admin-users-link").css('display', 'block').html(`
                <div class="admin-dropdown-container">
                    <a href="#" class="admin-dropdown-toggle" onclick="toggleAdminDropdown(event)">
                        Utilisateur ▼
                    </a>
                    <div class="admin-dropdown-menu" id="adminDropdown">
                        <div class="admin-dropdown-header">Changer d'utilisateur</div>
                        <div id="adminUserList" class="admin-user-list">Chargement...</div>
                    </div>
                </div>
            `);
            $("#login-link").html(`<a href="#" onclick="logout(event)">Déconnexion (${username})</a>`);
            loadAdminUsers();
        } else {
            // Regular user - show normal logout
            $("#login-link").html(`<a href="#" onclick="logout(event)">Déconnexion (${username})</a>`);
        }
    }

    loadActiveDrafts();
});

function toggleAdminDropdown(event) {
    event.preventDefault();
    event.stopPropagation();
    const dropdown = document.getElementById('adminDropdown');
    dropdown.classList.toggle('show');
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('adminDropdown');
    if (dropdown && !event.target.closest('.admin-dropdown-container')) {
        dropdown.classList.remove('show');
    }
});

async function loadAdminUsers() {
    try {
        const response = await fetch(`${BASE_URL}/admin-users?adminToken=admin`);
        const data = await response.json();

        if (response.ok) {
            const regularUsers = data.users.filter(u => u !== 'admin').slice(0, 4);
            const userListEl = document.getElementById('adminUserList');

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
        document.getElementById('adminUserList').innerHTML = '<div class="admin-no-users">Erreur</div>';
    }
}

async function switchToUser(event, username) {
    event.preventDefault();
    event.stopPropagation();

    try {
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
            // Keep isAdmin flag - admin privileges persist across user switches
            window.location.reload();
        } else {
            alert('Erreur lors du changement d\'utilisateur');
        }
    } catch (error) {
        console.error('Error switching user:', error);
        alert('Erreur de connexion');
    }
}

function logout(event) {
    if (event) event.preventDefault();
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("username");
    localStorage.removeItem("isAdmin");
    localStorage.removeItem("activeUser");
    location.reload();
}

function viewFinishedDraft(clanName) {
    localStorage.setItem("draftClan", clanName);
    window.location.href = "draftFini.html";
}


async function loadActiveDrafts() {
    try {
        const username = localStorage.getItem("username");

        if (!username) {
            alert("Vous devez être connecté !");
            window.location.href = "login.html";
            return;
        }

        // First, fetch all draft data
        const allDraftsResponse = await fetch(`${BASE_URL}/draft`, { cache: "no-store" });
        const allDrafts = await allDraftsResponse.json();

        // Then, fetch only the active drafts for the user
        const response = await fetch(`${BASE_URL}/active-drafts?username=${username}&timestamp=${new Date().getTime()}`, { cache: "no-store" });
        const result = await response.json();

        if (!result.activeDrafts || result.activeDrafts.length === 0) {
            document.getElementById("draftOptions").innerHTML = "<p>Aucun draft actif pour vous.</p>";
            return;
        }

        let draftHTML = "";
        result.activeDrafts.forEach(clanName => {
            const clan = allDrafts[clanName];
            const isDraftComplete = clan && clan.draftOrder.length > 0 &&
                Object.values(clan.teams).every(team =>
                    team.members.length === 0 ||
                    (team.offensive.length >= 10 && team.defensive.length >= 5)
                );

            draftHTML += `
                <div class="draft-card">
                    <h4>${clanName}</h4>
                    <button onclick="${isDraftComplete ? `viewFinishedDraft('${clanName}')` : `joinDraft('${clanName}')`}">
                        ${isDraftComplete ? "Consulter" : "Rejoindre"}
                    </button>
                </div>
            `;
        });

        document.getElementById("draftOptions").innerHTML = draftHTML;

    } catch (error) {
        console.error("❌ Erreur lors du chargement des drafts actifs :", error);
    }
}


async function joinDraft(clanName) {
    try {
        // Vérifie si le draft a déjà un ordre
        const response = await fetch(`${BASE_URL}/draft-order/` + clanName);
        const result = await response.json();

        if (!result.draftOrder || result.draftOrder.length === 0) {
            // Si aucun ordre, on démarre le draft
            const startResponse = await fetch(`${BASE_URL}/start-draft`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clanName })
            });

            const startResult = await startResponse.json();
            console.log("✅ Draft démarré :", startResult.message);
        } else {
            console.log("✅ Ordre de draft déjà existant, pas de démarrage.");
        }

        localStorage.setItem("draftClan", clanName);
        window.location.href = "draftActif.html";
    } catch (error) {
        console.error("Erreur lors de la vérification ou du lancement du draft :", error);
        alert("Erreur lors de la préparation du draft.");
    }
}



async function startDraft(clanName) {
    try {
        const response = await fetch(`${BASE_URL}/start-draft`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clanName })
        });

        const result = await response.json();
        alert(result.message);
    } catch (error) {
        console.error("Erreur lors du démarrage du draft :", error);
        alert("Erreur serveur.");
    }
}
