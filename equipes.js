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
    const maxPlayers = parseInt($("#maxPlayers").val());
    const numOffensive = parseInt($("#numOffensive").val());
    const numDefensive = parseInt($("#numDefensive").val());
    const numGoalies = parseInt($("#numGoalies").val());
    const numRookies = parseInt($("#numRookies").val());
    const numTeams = parseInt($("#numTeams").val());
    const username = localStorage.getItem("username");

    if (!clanName || !maxPlayers) {
        alert("Veuillez remplir tous les champs !");
        return;
    }

    // Validation des valeurs
    if (numOffensive < 0 || numDefensive < 0 || numGoalies < 0 || numRookies < 0 || numTeams < 0) {
        alert("Les valeurs de configuration ne peuvent pas être négatives !");
        return;
    }

    const poolConfig = {
        name: clanName,
        maxPlayers: maxPlayers,
        username: username,
        config: {
            numOffensive: numOffensive,
            numDefensive: numDefensive,
            numGoalies: numGoalies,
            numRookies: numRookies,
            numTeams: numTeams
        }
    };

    try {
        const response = await fetch(`${BASE_URL}/create-clan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(poolConfig)
        });

        if (response.ok) {
            console.log("✅ Pool créé avec succès !");
            // Clear form
            $("#clanName").val("");
            $("#numOffensive").val("6");
            $("#numDefensive").val("4");
            $("#numGoalies").val("1");
            $("#numRookies").val("1");
            $("#numTeams").val("1");
            await loadClans(); // 🔄 Recharge immédiatement les données
        } else {
            const error = await response.json();
            alert(`Erreur lors de la création du pool: ${error.message || 'Erreur inconnue'}`);
        }

    } catch (error) {
        console.error("❌ Erreur lors de la création du clan :", error);
        alert("Erreur de connexion au serveur");
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

        // Count active teams
        const activeTeams = Object.values(clan.teams).filter(team => team.members.length > 0).length;
        const totalParticipants = Object.values(clan.teams).reduce((sum, team) => sum + team.members.length, 0);

        // Get pool configuration
        const config = clan.config || {
            numOffensive: 6,
            numDefensive: 4,
            numGoalies: 1,
            numRookies: 1,
            numTeams: 1
        };

        const totalPicks = config.numOffensive + config.numDefensive + config.numGoalies + config.numRookies + config.numTeams;

        if (userInClan) {
            $("#clans-list").append(`
                <li>
                    <div class="pool-item-content">
                        <span class="pool-item-name">${clanName}</span>
                        <div class="pool-item-info">
                            <span class="pool-item-badge">👥 ${totalParticipants} participants</span>
                            <span class="pool-item-badge">📋 ${totalPicks} sélections</span>
                            <span class="pool-item-badge">🏒 ${activeTeams} équipes</span>
                        </div>
                    </div>
                    <button class="pool-action-btn" onclick="viewClanTeams('${clanName}')">Consulter</button>
                </li>
            `);
        } else {
            $("#available-clans-list").append(`
                <li>
                    <div class="pool-item-content">
                        <span class="pool-item-name">${clanName}</span>
                        <div class="pool-item-info">
                            <span class="pool-item-badge">👥 ${totalParticipants}/${clan.maxPlayers || 10} participants</span>
                            <span class="pool-item-badge">📋 ${totalPicks} sélections</span>
                            <span class="pool-item-badge">🏒 ${activeTeams} équipes</span>
                        </div>
                    </div>
                    <button class="pool-action-btn secondary" onclick="joinClan('${clanName}')">Rejoindre</button>
                </li>
            `);
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

        let teamHTML = `<h3 style="margin-bottom: 20px; color: #222;">Équipes de ${clanName}</h3>`;

        for (const [teamName, teamData] of Object.entries(teams)) {
            const isFull = teamData.members.length >= 5;
            const userInTeam = userTeam === teamName;
            const membersDisplay = teamData.members.length > 0
                ? `<div style="margin-top: 8px; padding-left: 12px;">
                     <strong style="font-size: 0.85rem; color: #666;">Membres:</strong>
                     <ul style="margin: 5px 0 0 0; padding-left: 20px; list-style: disc;">
                       ${teamData.members.map(member => `<li style="color: #444; font-size: 0.9rem;">${member}</li>`).join("")}
                     </ul>
                   </div>`
                : `<div style="margin-top: 8px; color: #999; font-size: 0.85rem; font-style: italic;">Aucun membre pour l'instant</div>`;

            teamHTML += `
                <div style="margin-bottom: 16px; padding: 16px; border: 2px solid ${userInTeam ? '#4caf50' : (isFull ? '#ddd' : '#ff2e2e')}; border-radius: 10px; background: ${userInTeam ? '#e8f5e9' : (isFull ? '#f5f5f5' : '#fff')};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <strong style="font-size: 1.1rem; color: #222;">${teamName}</strong>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            ${userInTeam ? `<span style="padding: 4px 12px; background: #4caf50; border-radius: 12px; font-size: 0.75rem; font-weight: 600; color: white;">Votre équipe</span>` : ''}
                            <span style="padding: 4px 12px; background: ${isFull ? '#ddd' : '#e3f2fd'}; border-radius: 12px; font-size: 0.85rem; font-weight: 600; color: ${isFull ? '#666' : '#1976d2'};">
                                ${teamData.members.length}/5 joueurs
                            </span>
                        </div>
                    </div>
                    ${membersDisplay}
                    ${!userInTeam && !isFull ? `<button style="margin-top: 12px; width: 100%; padding: 10px; background: linear-gradient(135deg, #ff2e2e 0%, #cc2525 100%); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s ease;" onclick="joinTeam('${clanName}', '${teamName}')" onmouseover="this.style.background='linear-gradient(135deg, #ff4040 0%, #d93030 100%)'" onmouseout="this.style.background='linear-gradient(135deg, #ff2e2e 0%, #cc2525 100%)'">Rejoindre cette équipe</button>` : ''}
                    ${isFull && !userInTeam ? `<div style="margin-top: 12px; padding: 8px; background: #f8d7da; border-radius: 6px; color: #721c24; text-align: center; font-size: 0.9rem;">Équipe complète</div>` : ''}
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
        let teamHTML = `<h3 style="margin-bottom: 20px; color: #222;">Choisissez une équipe dans ${clanName}</h3>`;

        Object.entries(teams).forEach(([teamName, teamData]) => {
            const isFull = teamData.members.length >= 5;
            const membersDisplay = teamData.members.length > 0
                ? `<div style="margin-top: 8px; padding-left: 12px;">
                     <strong style="font-size: 0.85rem; color: #666;">Membres:</strong>
                     <ul style="margin: 5px 0 0 0; padding-left: 20px; list-style: disc;">
                       ${teamData.members.map(member => `<li style="color: #444; font-size: 0.9rem;">${member}</li>`).join("")}
                     </ul>
                   </div>`
                : `<div style="margin-top: 8px; color: #999; font-size: 0.85rem; font-style: italic;">Aucun membre pour l'instant</div>`;

            teamHTML += `
                <div style="margin-bottom: 16px; padding: 16px; border: 2px solid ${isFull ? '#ddd' : '#ff2e2e'}; border-radius: 10px; background: ${isFull ? '#f5f5f5' : '#fff'};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <strong style="font-size: 1.1rem; color: #222;">${teamName}</strong>
                        <span style="padding: 4px 12px; background: ${isFull ? '#ddd' : '#e3f2fd'}; border-radius: 12px; font-size: 0.85rem; font-weight: 600; color: ${isFull ? '#666' : '#1976d2'};">
                            ${teamData.members.length}/5 joueurs
                        </span>
                    </div>
                    ${membersDisplay}
                    ${!isFull ? `<button style="margin-top: 12px; width: 100%; padding: 10px; background: linear-gradient(135deg, #ff2e2e 0%, #cc2525 100%); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s ease;" onclick="joinTeam('${clanName}', '${teamName}')" onmouseover="this.style.background='linear-gradient(135deg, #ff4040 0%, #d93030 100%)'" onmouseout="this.style.background='linear-gradient(135deg, #ff2e2e 0%, #cc2525 100%)'">Rejoindre cette équipe</button>` : `<div style="margin-top: 12px; padding: 8px; background: #f8d7da; border-radius: 6px; color: #721c24; text-align: center; font-size: 0.9rem;">Équipe complète</div>`}
                </div>
            `;
        });

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

// ==================== TRADE BADGE FUNCTIONALITY ====================

// Update trade notification badge
function updateTradeBadge(count) {
    const badge = $("#trade-badge");

    if (count > 0) {
        badge.text(count).show();
    } else {
        badge.hide();
    }
}

// Check for pending trades on page load
$(document).ready(function() {
    const username = localStorage.getItem("username");
    if (username) {
        // Initial load of trade badge count
        fetch(`${BASE_URL}/trades/pending/${username}`, { cache: "no-store" })
            .then(response => response.json())
            .then(trades => {
                updateTradeBadge(trades.length);
            })
            .catch(error => console.error("Error checking pending trades:", error));
    }
});

// Setup WebSocket for real-time trade updates (if Socket.IO is available)
if (typeof io !== 'undefined') {
    const socket = io(BASE_URL);

    socket.on('tradePending', () => {
        console.log("New trade pending notification received");
        const username = localStorage.getItem("username");
        if (username) {
            fetch(`${BASE_URL}/trades/pending/${username}`, { cache: "no-store" })
                .then(response => response.json())
                .then(trades => {
                    updateTradeBadge(trades.length);
                    // Reload pending trades if on trades tab
                    if ($('#trades-tab').hasClass('active')) {
                        loadPendingTrades();
                    }
                })
                .catch(error => console.error("Error checking pending trades:", error));
        }
    });

    socket.on('tradeUpdated', () => {
        console.log("Trade updated notification received");
        const username = localStorage.getItem("username");
        if (username) {
            fetch(`${BASE_URL}/trades/pending/${username}`, { cache: "no-store" })
                .then(response => response.json())
                .then(trades => {
                    updateTradeBadge(trades.length);
                    // Reload pending trades if on trades tab
                    if ($('#trades-tab').hasClass('active')) {
                        loadPendingTrades();
                    }
                })
                .catch(error => console.error("Error checking pending trades:", error));
        }
    });
}
