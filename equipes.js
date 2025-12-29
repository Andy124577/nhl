const BASE_URL = window.location.hostname.includes("localhost")
  ? "http://localhost:3000"
  : "https://goondraft.onrender.com";

$(document).ready(function() {
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    const username = localStorage.getItem("username");
    const isAdmin = localStorage.getItem("isAdmin") === "true";

    if (!isLoggedIn) {
        alert("⛔ Vous devez être connecté pour accéder à cette page !");
        window.location.href = "login.html"; // 🔄 Redirection vers la page de connexion
    } else {
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
        loadClans(); // 🔄 Charge les clans uniquement si l'utilisateur est connecté
    }
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

// 🔑 Fonction de déconnexion
function logout(event) {
    if (event) event.preventDefault();
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("username");
    localStorage.removeItem("isAdmin");
    localStorage.removeItem("activeUser");
    location.reload();
}

// 🔄 Charge et met à jour la liste des clans
async function loadClans() {
    try {
        const response = await fetch(`${BASE_URL}/draft?timestamp=${new Date().getTime()}`, { cache: "no-store" });
        const freshData = await response.json();

        console.log("📥 Données des clans chargées :", freshData);
        updateUI(freshData);
    } catch (error) {
        console.error("❌ Erreur lors du chargement des clans :", error);
    }
}

// 🏗️ Créer un clan
async function createClan() {
    const clanName = $("#clanName").val();
    const maxPlayers = $("#maxPlayers").val();
    const username = localStorage.getItem("username");

    if (!clanName || !maxPlayers) {
        alert("Veuillez remplir tous les champs !");
        return;
    }

    try {
        await fetch(`${BASE_URL}/create-clan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: clanName, maxPlayers: parseInt(maxPlayers), username })
        });

        console.log("✅ Clan créé avec succès !");
        await loadClans(); // 🔄 Recharge immédiatement les données

    } catch (error) {
        console.error("❌ Erreur lors de la création du clan :", error);
    }
}

// 🔄 Met à jour l'affichage des clans
function updateUI(draftData) {
    $("#clans-list").html("");
    $("#available-clans-list").html("");

    const username = localStorage.getItem("username");

    Object.keys(draftData).forEach(clanName => {
        const clan = draftData[clanName];
        const userInClan = Object.values(clan.teams).some(team => team.members.includes(username));

        if (userInClan) {
            $("#clans-list").append(`<li>${clanName} <button onclick="viewClanTeams('${clanName}')">Consulter</button></li>`);
        } else {
            $("#available-clans-list").append(`<li>${clanName} <button onclick="joinClan('${clanName}')">Rejoindre</button></li>`);
        }
    });
}

// 🔎 Voir les équipes d'un clan
async function viewClanTeams(clanName) {
    try {
        const response = await fetch(`${BASE_URL}/draft?timestamp=${new Date().getTime()}`, { cache: "no-store" });
        const draftData = await response.json();
        const teams = draftData[clanName].teams;
        const username = localStorage.getItem("username");

        let userTeam = null;
        for (const [teamName, teamData] of Object.entries(teams)) {
            if (teamData.members.includes(username)) {
                userTeam = teamName;
                break;
            }
        }

        let teamHTML = `<h3>Équipes de ${clanName}</h3>`;
        for (const [teamName, teamData] of Object.entries(teams)) {
            const isFull = teamData.members.length >= 5;
            const userInTeam = userTeam === teamName;

            teamHTML += `
                <div style="margin-bottom: 15px; padding: 10px; border: 1px solid #ccc; border-radius: 5px;">
                    <strong>${teamName}</strong> - ${teamData.members.length}/5 joueurs ${userInTeam ? "(Vous êtes ici)" : ""}
                    <ul style="margin-top: 5px; padding-left: 20px;">
                        ${teamData.members.map(member => `<li>${member}</li>`).join("")}
                    </ul>
                    ${!userInTeam && !isFull ? `<button onclick="joinTeam('${clanName}', '${teamName}')">Rejoindre</button>` : ""}
                </div>
            `;
        }


        $("#clan-members-content").html(teamHTML);
        $("#clan-members-modal").css("display", "flex");

    } catch (error) {
        console.error("❌ Erreur lors de l'affichage des équipes :", error);
    }
}


// 🔥 Rejoindre un clan
async function joinClan(clanName) {
    const username = localStorage.getItem("username");

    try {
        const response = await fetch(`${BASE_URL}/draft?timestamp=${new Date().getTime()}`, { cache: "no-store" });
        const draftData = await response.json();
        const teams = draftData[clanName].teams;

        // 🔥 Affiche les équipes disponibles pour le clan sélectionné
        let teamHTML = `<h3>Choisissez une équipe dans ${clanName}</h3><ul>`;
        Object.entries(teams).forEach(([teamName, teamData]) => {
            const isFull = teamData.members.length >= 5;
            if (!isFull) {
                teamHTML += `<li>${teamName} - ${teamData.members.length}/5 joueurs 
                    <button onclick="joinTeam('${clanName}', '${teamName}')">Rejoindre cette équipe</button>
                </li>`;
            }
        });

        teamHTML += `</ul><button onclick="closeModal()">Fermer</button>`;
        $("#clan-members-content").html(teamHTML);
        $("#clan-members-modal").css("display", "flex");


        

    } catch (error) {
        console.error("❌ Erreur lors de l'affichage des équipes :", error);
    }
}

// 🔥 Rejoindre une équipe dans un clan
async function joinTeam(clanName, teamName) {
    const username = localStorage.getItem("username");

    try {
        // 🔥 Supprimer l'utilisateur de son ancienne équipe
        await fetch(`${BASE_URL}/leave-team`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: clanName, username })
        });

        console.log(`🚪 ${username} a quitté son ancienne équipe`);

        // 🔥 Ajouter l'utilisateur à la nouvelle équipe
        const joinResponse = await fetch(`${BASE_URL}/join-team`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: clanName, username, teamName })
        });

        const result = await joinResponse.json();
        alert(result.message);

        // 🔄 Recharge les données après l'action
        viewClanTeams(clanName);
        setTimeout(() => {
            location.reload();
        }, 1000);

    } catch (error) {
        console.error("❌ Erreur lors du changement d'équipe :", error);
    }
}

$(document).ready(function() {
    $("#clan-members-modal").click(function(event) {
        if (!$(event.target).closest(".modal-content").length) {
            closeModal();
        }
    });
});

function closeClanModal() {
    $("#clanModal").css("display", "none"); // Hide the modal properly
}

$(document).ready(function() {
    $("#clanModal").hide(); // Explicitly hide the modal on page load
});

function openModal() {
    $("#clan-members-modal").css("display", "block");
}

function closeModal() {
    $("#clan-members-modal").css("display", "none");
}

jQuery('button').on('click',(e)=>{
  jQuery('ul').animate({scrollTop: jQuery('.scrolltome').offset().top}, "slow");
});
