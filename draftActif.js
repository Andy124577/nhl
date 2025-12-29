let fullPlayerData = [];
let imageList = [];
let draftData = {};
let goalieData = [];
let teamData = [];
let currentClan = localStorage.getItem("draftClan");
let username = localStorage.getItem("username");
let carouselOffset = 0;
const PICKS_PER_PAGE = 5;

const BASE_URL = window.location.hostname.includes("localhost")
  ? "http://localhost:3000"
  : "https://goondraft.onrender.com";


console.log("🔍 draftClan:", localStorage.getItem("draftClan"));
console.log("🔍 username:", localStorage.getItem("username"));

// Custom Alert Function
function showCustomAlert(message, type = 'info') {
    const overlay = document.getElementById('customAlertOverlay');
    const messageEl = document.getElementById('alertMessage');
    const iconEl = document.getElementById('alertIcon');
    const okButton = document.getElementById('alertOkButton');

    // Set message
    messageEl.textContent = message;

    // Set icon based on type
    iconEl.className = 'custom-alert-icon ' + type;
    switch(type) {
        case 'success':
            iconEl.textContent = '✓';
            break;
        case 'error':
            iconEl.textContent = '✕';
            break;
        case 'warning':
            iconEl.textContent = '⚠';
            break;
        case 'info':
        default:
            iconEl.textContent = 'ℹ';
            break;
    }

    // Show overlay
    overlay.classList.add('show');

    // Handle close
    const closeAlert = () => {
        overlay.classList.remove('show');
        okButton.removeEventListener('click', closeAlert);
        overlay.removeEventListener('click', outsideClickHandler);
    };

    const outsideClickHandler = (e) => {
        if (e.target === overlay) {
            closeAlert();
        }
    };

    okButton.addEventListener('click', closeAlert);
    overlay.addEventListener('click', outsideClickHandler);

    // Allow closing with Enter or Escape key
    const keyHandler = (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
            closeAlert();
            document.removeEventListener('keydown', keyHandler);
        }
    };
    document.addEventListener('keydown', keyHandler);
}


const socket = io(BASE_URL);

socket.on("draftUpdated", (updatedData) => {
    if (updatedData[currentClan] && updatedData[currentClan].teams) {
        draftData = updatedData[currentClan];
        updateTable();
        updateProgressCounter();
        updateDraftHeader();
        renderDraftTimeline();
        renderRecentPicks();
    } else {
        console.warn("❌ WebSocket : données incomplètes pour le clan :", currentClan);
    }
});

socket.on("forceRefresh", () => {
    console.log("🔁 Rafraîchissement forcé reçu");
    setTimeout(loadDraftData, 300); // petit délai pour éviter conflit d’écriture
});

$(document).ready(function () {
    if (!currentClan || !username) {
        showCustomAlert("Vous devez être connecté et avoir un draft actif !", 'error');
        setTimeout(() => {
            window.location.href = "draft.html";
        }, 1500);
        return;
    }

    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
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

    fetchPlayerData();
    setInterval(loadDraftData, 7000); // rafraîchissement toutes les 7s
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
            showCustomAlert('Erreur lors du changement d\'utilisateur', 'error');
        }
    } catch (error) {
        console.error('Error switching user:', error);
        showCustomAlert('Erreur de connexion', 'error');
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

async function fetchPlayerData() {
    try {
        const response = await fetch("nhl_filtered_stats.json");
        const data = await response.json();
        fullPlayerData = [...data.Top_50_Defenders, ...data.Top_100_Offensive_Players, ...data.Top_Rookies];
        goalieData = data.Top_50_Goalies;
        teamData = data.Teams;
        await fetchImageData();
        setTimeout(() => loadDraftData(), 300);
    } catch (error) {
        console.error("Erreur chargement stats joueurs :", error);
    }
}


async function fetchImageData() {
    try {
        const cachedImages = localStorage.getItem("imageList");
        if (cachedImages) {
            imageList = JSON.parse(cachedImages);
            console.log("✅ Images chargées depuis le cache local.");
            return;
        }

        const response = await fetch("images.json", { cache: "no-store" });
        imageList = await response.json();
        localStorage.setItem("imageList", JSON.stringify(imageList));
        console.log("✅ Images chargées depuis le serveur et mises en cache.");
    } catch (error) {
        console.error("❌ Erreur chargement images :", error);
    }
}


let isLoading = false;

async function loadDraftData() {
    if (isLoading) return;
    isLoading = true;

    const loadingElement = document.getElementById("loading");
    if (loadingElement) loadingElement.style.display = "block";

    try {
        const currentClan = localStorage.getItem("draftClan");
        const response = await fetch(`${BASE_URL}/draft`, { cache: "no-store" });
        const data = await response.json();

        if (!data || !data[currentClan]) {
            console.warn("Draft data incomplet ou manquant :", data);
            return;
        }

        draftData = data[currentClan];
        updateTable();
    } catch (error) {
        console.error("❌ Erreur chargement draft :", error);
    } finally {
        if (loadingElement) loadingElement.style.display = "none";
        isLoading = false;
    }
}



function getMatchingImage(skaterName) {
    const formattedName = skaterName.replace(/\s/g, "_");
    return imageList.find(imagePath => {
        const baseName = imagePath.replace(/^faces\//, "").replace(/_\d{1,2}_\d{1,2}_\d{4}|_away/g, "").replace(".png", "");
        return baseName === formattedName;
    }) || null;
}

function getTeamLogoPath(teamAbbrevs) {
    if (!teamAbbrevs || teamAbbrevs === "null") {
        return null;
    }
    const lastTeam = teamAbbrevs.split(",").pop().trim();
    return `teams/${lastTeam}.png`;
}

let currentSortBy = "points"; // Valeur par défaut globale

function populateMyPicksTable(userTeam, searchTerm) {
    const team = draftData.teams[userTeam];
    const tableBody = $("#playerTable tbody");
    tableBody.empty();

    // Set table header for all picks
    $("#tableHeaderRow").html(`
        <th>Photo</th>
        <th>Nom</th>
        <th>Type</th>
        <th>GP</th>
        <th>Stats</th>
        <th>PTS</th>
    `);

    // Collect all picks with their data
    let allPicks = [];

    // Add offensive players
    (team.offensive || []).forEach(name => {
        const player = fullPlayerData.find(p => p.skaterFullName === name);
        if (player && (!searchTerm || name.toLowerCase().includes(searchTerm))) {
            allPicks.push({
                name: name,
                type: "Attaquant",
                typeCode: player.positionCode || "F",
                data: player,
                category: "skater"
            });
        }
    });

    // Add defensive players
    (team.defensive || []).forEach(name => {
        const player = fullPlayerData.find(p => p.skaterFullName === name);
        if (player && (!searchTerm || name.toLowerCase().includes(searchTerm))) {
            allPicks.push({
                name: name,
                type: "Défenseur",
                typeCode: "D",
                data: player,
                category: "skater"
            });
        }
    });

    // Add rookies
    (team.rookie || []).forEach(name => {
        const player = fullPlayerData.find(p => p.skaterFullName === name);
        if (player && (!searchTerm || name.toLowerCase().includes(searchTerm))) {
            allPicks.push({
                name: name,
                type: "Recrue",
                typeCode: "*",
                data: player,
                category: "skater"
            });
        }
    });

    // Add goalies
    (team.goalie || []).forEach(name => {
        const goalie = goalieData.find(g => g.goalieFullName === name);
        if (goalie && (!searchTerm || name.toLowerCase().includes(searchTerm))) {
            allPicks.push({
                name: name,
                type: "Gardien",
                typeCode: "G",
                data: goalie,
                category: "goalie"
            });
        }
    });

    // Add teams
    (team.teams || []).forEach(name => {
        const teamObj = teamData.find(t => t.teamFullName === name);
        if (teamObj && (!searchTerm || name.toLowerCase().includes(searchTerm))) {
            allPicks.push({
                name: name,
                type: "Équipe",
                typeCode: "T",
                data: teamObj,
                category: "team"
            });
        }
    });

    // Display message if no picks
    if (allPicks.length === 0) {
        const message = searchTerm
            ? `<tr><td colspan="6">Aucun choix trouvé pour "${searchTerm}"</td></tr>`
            : `<tr><td colspan="6">Vous n'avez pas encore fait de choix</td></tr>`;
        tableBody.append(message);
        return;
    }

    // Render all picks
    allPicks.forEach(pick => {
        let imagePath = null;
        let logoPath = null;
        let stats = "";

        if (pick.category === "team") {
            const abbrev = getTeamAbbreviation(pick.name);
            imagePath = abbrev ? `teams/${abbrev}.png` : null;
            logoPath = imagePath;
            stats = `W: ${pick.data.wins}, L: ${pick.data.losses}`;
        } else if (pick.category === "goalie") {
            imagePath = getMatchingImage(pick.name);
            logoPath = getTeamLogoPath(pick.data.teamAbbrevs);
            stats = `W: ${pick.data.wins}, SV%: ${pick.data.savePct?.toFixed(3)}`;
        } else {
            imagePath = getMatchingImage(pick.name);
            logoPath = getTeamLogoPath(pick.data.teamAbbrevs);
            stats = `G: ${pick.data.goals}, A: ${pick.data.assists}`;
        }

        const imageHTML = imagePath
            ? `<div class="player-photo">
                    <img src="${imagePath}" alt="${pick.name}" class="face">
                    ${logoPath && pick.category !== "team" ? `<img src="${logoPath}" alt="Team" class="logo">` : ""}
               </div>`
            : "";

        const row = `
            <tr>
                <td>${imageHTML}</td>
                <td><strong>${pick.name}</strong></td>
                <td><span style="background: #ff2e2e; color: white; padding: 2px 6px; border-radius: 3px; font-size: 12px;">${pick.typeCode}</span> ${pick.type}</td>
                <td>${pick.data.gamesPlayed || "-"}</td>
                <td>${stats}</td>
                <td><strong>${pick.data.points || "-"}</strong></td>
            </tr>
        `;
        tableBody.append(row);
    });

    // Update draft status
    const currentTurn = draftData.draftOrder[draftData.currentPickIndex];
    $("#draft-title").text(`Draft : ${currentClan}`);
    $("#draft-status").html(`
        <div>
            <p><strong>Tour actuel :</strong> ${currentTurn}</p>
            <p class="${currentTurn === userTeam ? "your-turn" : "wait-turn"}">
                ${currentTurn === userTeam ? "🎯 C'est votre tour !" : "⏳ Veuillez attendre votre tour."}
            </p>
            <p style="margin-top: 10px;"><strong>Total de vos choix:</strong> ${allPicks.length}</p>
        </div>
    `);

    // Update progress counter
    updateProgressCounter();
}

function updateTable() {
    if (draftData.draftOrder.length === 0 || checkIfUserTeamIsDone()) {
        $("#draft-status").html(`
            <div class="draft-status-box">
                <p style='color:green; font-weight: bold;'>🎉 Le draft est terminé !</p>
                <p>Merci à tous les participants.</p>
            </div>
        `);
        $("#playerTable tbody").empty();

        if (!window.confettiFired) {
            window.confettiFired = true;
            launchConfetti();
        }

        return;
    }

    const filter = $("#playerFilter").val();
    const searchTerm = $("#searchInput").val().toLowerCase();
    const availability = $("#availabilityFilter").val();
    const userTeam = getUserTeam();

    // Special view for "Mes choix" - show ALL picks
    if (availability === "pickedByTeam" && userTeam && draftData.teams[userTeam]) {
        populateMyPicksTable(userTeam, searchTerm);
        return;
    }

    const allPicked = new Set();
    Object.values(draftData.teams).forEach(team => {
        [].concat(
            team.offensive || [],
            team.defensive || [],
            team.rookie || [],
            team.goalie || [],
            team.teams || []
        ).forEach(p => allPicked.add(p));
    });

    const sortSelect = $("#sortBy");
    sortSelect.empty();

    // Ajout des options selon le filtre
    if (filter === "goalies") {
        sortSelect.append(`<option value="points">Points</option>`);
        sortSelect.append(`<option value="gamesPlayed">Games played</option>`);
        sortSelect.append(`<option value="wins">Wins</option>`);
        sortSelect.append(`<option value="Saves %">SV%</option>`);

        $("#tableHeaderRow").html(`
            <th>Photo</th>
            <th>Goalie</th>
            <th>GP</th>
            <th>W</th>
            <th>L</th>
            <th>OTL</th>
            <th>SV%</th>
            <th>SO</th>
            <th>PTS</th>
            <th>Action</th>
        `);

        sortSelect.val(currentSortBy);

        // 🔥 Filtrer les gardiens déjà pris
        let availableGoalies = goalieData.filter(goalie => !allPicked.has(goalie.goalieFullName));

        const sortedGoalies = [...availableGoalies].sort((a, b) => b[currentSortBy] - a[currentSortBy]);
        populateGoalieTable(sortedGoalies);
        return;
    }


   if (filter === "teams") {
        sortSelect.append(`<option value="wins">Wins</option>`);
        sortSelect.append(`<option value="points">Points</option>`);

        $("#tableHeaderRow").html(`
            <th>Logo</th>
            <th>Team</th>
            <th>GP</th>
            <th>Wins</th>
            <th>Losses</th>
            <th>OTL</th>
            <th>Points</th>
            <th>Action</th>
        `);

        // 🔥 Filtrer les équipes déjà sélectionnées
        const availableTeams = teamData.filter(team => !allPicked.has(team.teamFullName));

        const sortedTeams = [...availableTeams].sort((a, b) => b[currentSortBy] - a[currentSortBy]);
        populateTeamTable(sortedTeams);
    return;
}



    if (["offensive", "defensive", "rookies", "all"].includes(filter)) {
        sortSelect.append(`<option value="points">Points</option>`);
        sortSelect.append(`<option value="gamesPlayed">Games played</option>`);
        sortSelect.append(`<option value="goals">Goals</option>`);
        sortSelect.append(`<option value="assists">Assists</option>`);
        

        $("#tableHeaderRow").html(`
            <th>Photo</th>
            <th>Player</th>
            <th>GP</th>
            <th>G</th>
            <th>AST</th>
            <th>PTS</th>
            <th>Action</th>
        `);
    }

    sortSelect.val(currentSortBy);

    let filteredData = [];

    if (filter === "rookies") {
        filteredData = fullPlayerData
            .filter(p =>
                (p.gamesPlayed <= 27 || p.playerId === null || p.teamAbbrevs === null) &&
                p.skaterFullName !== "Tyler Seguin"
            )
            .map(p => ({ ...p, positionCode: "*" }));
    } else if (filter === "all") {
        filteredData = fullPlayerData.map(p => {
            const isRookie = (p.gamesPlayed <= 27 || p.playerId === null || p.teamAbbrevs === null)
                            && p.skaterFullName !== "Tyler Seguin";
            return {
                ...p,
                positionCode: isRookie ? "*" : p.positionCode
            };
        });
    } else {
        filteredData = fullPlayerData;
    }

    if (filter === "offensive") {
        filteredData = filteredData.filter(player => ["C", "R", "L"].includes(player.positionCode));
    } else if (filter === "defensive") {
        filteredData = filteredData.filter(player => player.positionCode === "D");
    }

    if (availability === "available") {
        filteredData = filteredData.filter(player => !allPicked.has(player.skaterFullName));
    } else if (availability === "picked") {
        filteredData = filteredData.filter(player => allPicked.has(player.skaterFullName));
    } else if (availability === "pickedByTeam") {
        if (userTeam && draftData.teams[userTeam]) {
            const team = draftData.teams[userTeam];
            filteredData = filteredData.filter(player =>
                team.offensive.includes(player.skaterFullName) ||
                team.defensive.includes(player.skaterFullName) ||
                team.rookie?.includes(player.skaterFullName) ||
                team.goalie?.includes(player.goalieFullName || player.skaterFullName) ||
                team.teams?.includes(player.teamFullName)
            );
        } else {
            filteredData = [];
        }
    }

    if (searchTerm) {
        filteredData = filteredData.filter(player =>
            player.skaterFullName.toLowerCase().includes(searchTerm)
        );
    }

    filteredData.sort((a, b) => b[currentSortBy] - a[currentSortBy]);

    populateTable(filteredData);
    renderTeamsOverview();
    updateProgressCounter();
    updateDraftHeader();
    renderDraftTimeline();
    renderRecentPicks();
}

$("#sortBy").on("change", function () {
    currentSortBy = $(this).val();
    updateTable();
});



function populateGoalieTable(goalies) {
    const tableBody = $("#playerTable tbody");
    tableBody.empty();

    goalies.forEach(goalie => {
        const name = goalie.goalieFullName;
        const imagePath = getMatchingImage(name);
        const logoPath = getTeamLogoPath(goalie.teamAbbrevs);

        const imageHTML = imagePath && logoPath
            ? `<div class="player-photo">
                    <img src="${imagePath}" alt="${name}" class="face">
                    <img src="${logoPath}" alt="${goalie.teamAbbrevs}" class="logo">
               </div>`
            : "";

        const row = `
            <tr>
                <td>${imageHTML}</td>
                <td>${name}</td>
                <td>${goalie.gamesPlayed}</td>
                <td>${goalie.wins}</td>
                <td>${goalie.losses}</td>
                <td>${goalie.otLosses}</td>
                <td>${goalie.savePct?.toFixed(3)}</td>
                <td>${goalie.shutouts}</td>
                <td>${goalie.points}</td>
                <td>
                ${
                    isUserTurn() && !checkIfUserTeamIsDone()
                    ? `<button class="select-button" onclick="selectPlayer('${name}', 'G')">
                            <img src="Icons/sign.png" alt="Sélectionner" class="select-icon" />
                        </button>`
                    : ""
                }
                </td>
            </tr>
        `;
        tableBody.append(row);
    });
}

function populateTeamTable(teamStats) {
    const tableBody = $("#playerTable tbody");
    tableBody.empty();

    teamStats.forEach(team => {
        const abbrev = getTeamAbbreviation(team.teamFullName);
        const logoPath = `teams/${abbrev}.png`;

        const row = `
            <tr>
                <td><img src="${logoPath}" alt="${team.teamFullName}" class="logo" style="width:40px;"></td>
                <td>${team.teamFullName}</td>
                <td>${team.gamesPlayed}</td>
                <td>${team.wins}</td>
                <td>${team.losses}</td>
                <td>${team.otLosses}</td>
                <td>${team.points}</td>
                <td>
                ${
                    isUserTurn() && !checkIfUserTeamIsDone()
                    ? `<button class="select-button" onclick="selectPlayer('${team.teamFullName}', 'T')">
                            <img src="Icons/sign.png" alt="Sélectionner" class="select-icon" />
                        </button>`
                    : ""
                }
                </td>
            </tr>
        `;
        tableBody.append(row);
    });
}

function getTeamAbbreviation(teamName) {
    const specialCases = {
        "Florida": "FLA",
        "Calgary": "CGY",
        "Montréal": "MTL",
        "Nashville": "NSH",
        "Louis": "STL",
        "Washington": "WSH",
        "Toronto": "TOR",
        "Winnipeg": "WPG",
        "Utah": "UTA",
        "Detroit": "DET"
    };

    const words = teamName.split(" ");
    if (specialCases[words[0]]) {
        return specialCases[words[0]];
    }

    if (words.length === 3) {
        return words.map(w => w[0]).join("").toUpperCase(); // e.g., New Jersey Devils → NJD
    }

    return words[0].substring(0, 3).toUpperCase(); // e.g., Boston Bruins → BOS
}


function getUserTeam() {
    if (!draftData || !draftData.teams) return undefined;
    return Object.entries(draftData.teams).find(([_, team]) => team.members.includes(username))?.[0];
}

function isUserTurn() {
    return draftData.draftOrder[draftData.currentPickIndex] === getUserTeam();
}

function checkIfUserTeamIsDone() {
    const userTeam = getUserTeam();
    if (!userTeam || !draftData.teams[userTeam]) return false;

    const team = draftData.teams[userTeam];
    return (
        team.offensive.length === 10 &&
        team.defensive.length === 5 &&
        team.rookie?.length === 3 &&
        team.goalie?.length === 1 &&
        team.teams?.length === 1
    );
}



function populateTable(playerData) {
    const tableBody = $("#playerTable tbody");
    tableBody.empty();

    if (!draftData || !draftData.draftOrder || !draftData.teams) return;

    if (draftData.draftOrder.length === 0 || checkIfUserTeamIsDone()) {
        $("#draft-status").html(`
            <div class="draft-status-box">
                <p style='color:green; font-weight: bold;'>🎉 Le draft est terminé !</p>
                <p>Merci à tous les participants.</p>
            </div>
        `);
        $("#playerTable tbody").empty();
        return;
    }


    const userTeam = getUserTeam();
    const currentTurn = draftData.draftOrder[draftData.currentPickIndex];

    $("#draft-title").text(`Draft : ${currentClan}`);

    $("#draft-status").html(`
    <div>
        <p><strong>Tour actuel :</strong> ${currentTurn}</p>
        <p class="${currentTurn === userTeam ? "your-turn" : "wait-turn"}">
        ${currentTurn === userTeam ? "🎯 C'est votre tour !" : "⏳ Veuillez attendre votre tour."}
        </p>
    </div>
    `);


    playerData.forEach(player => {

        const skaterName = player.skaterFullName || player.goalieFullName || player.teamFullName;
        const positionCode = player.positionCode || (player.savePct ? "G" : player.teamFullName ? "T" : "R");
        const matchingImage = getMatchingImage(skaterName);
        const logoPath = getTeamLogoPath(player.teamAbbrevs);

        const imageHTML = matchingImage && logoPath
            ? `<div class="player-photo">
                <img src="${matchingImage}" alt="${skaterName}" class="face">
                <img src="${logoPath}" alt="${player.teamAbbrevs}" class="logo">
              </div>`
            : "";

        const row = `
            <tr>
                <td>${imageHTML}</td>
                <td>${skaterName}, ${positionCode}</td>
                <td>${player.gamesPlayed}</td>
                <td>${player.goals ?? "-"}</td>
                <td>${player.assists ?? "-"}</td>
                <td class="points-column">${player.points ?? "-"}</td>
                <td>
                ${
                    isUserTurn() && !checkIfUserTeamIsDone()
                    ? `<button class="select-button" onclick="selectPlayer('${skaterName}', '${positionCode}')">
                            <img src="Icons/sign.png" alt="Sélectionner" class="select-icon" />
                        </button>`
                    : ""
                }
                </td>
            </tr>
        `;
        tableBody.append(row);
    });
}

async function selectPlayer(playerName, positionCode) {
    try {
        let positionType = "offensive"; // par défaut

        if (positionCode === "D") {
            positionType = "defensive";
        } else if (positionCode === "G") {
            positionType = "goalie";
        } else if (positionCode === "*") {
            positionType = "rookie";
        } else if (positionCode === "T") {
            positionType = "teams";
        }

        const response = await fetch(`${BASE_URL}/pick-player`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                clanName: currentClan,
                username,
                playerName,
                position: positionType
            })
        });

        const result = await response.json();

        // Determine alert type based on response status
        const alertType = response.ok ? 'success' : 'error';
        showCustomAlert(result.message, alertType);

        if (response.ok) {
            await loadDraftData();
        }
    } catch (error) {
        console.error("Erreur lors de la sélection :", error);
        showCustomAlert("Une erreur est survenue lors de la sélection", 'error');
    }
}

function renderTeamsOverview() {
    const container = $("#teamsContainer");
    container.empty();

    if (!draftData || !draftData.teams) return;

    const userTeamName = getUserTeam();
    const userTeam = draftData.teams[userTeamName];

    if (!userTeam) return;

    const members = userTeam.members.join(", ") || "Aucun membre";

    const teamBlock = `
        <div class="team-block">
            <h4>${userTeamName}</h4>
            <p><strong>Membres :</strong> ${members}</p>
        </div>
    `;
    container.append(teamBlock);
}

function updateProgressCounter() {
    const userTeam = getUserTeam();
    if (!userTeam || !draftData.teams[userTeam]) return;

    const team = draftData.teams[userTeam];

    // Define requirements
    const requirements = {
        offensive: { current: (team.offensive || []).length, max: 10 },
        defensive: { current: (team.defensive || []).length, max: 5 },
        rookie: { current: (team.rookie || []).length, max: 3 },
        goalie: { current: (team.goalie || []).length, max: 1 },
        team: { current: (team.teams || []).length, max: 1 }
    };

    // Update each progress bar and counter
    Object.keys(requirements).forEach(type => {
        const req = requirements[type];
        const percentage = (req.current / req.max) * 100;

        // Update mini progress bar width
        $(`#mini-progress-${type}`).css('width', `${percentage}%`);

        // Add complete class if done
        if (req.current >= req.max) {
            $(`#mini-progress-${type}`).addClass('complete');
            $(`#count-${type}`).addClass('complete').removeClass('in-progress');
        } else if (req.current > 0) {
            $(`#mini-progress-${type}`).removeClass('complete');
            $(`#count-${type}`).addClass('in-progress').removeClass('complete');
        } else {
            $(`#mini-progress-${type}`).removeClass('complete');
            $(`#count-${type}`).removeClass('complete in-progress');
        }

        // Update counter text
        $(`#count-${type}`).text(`${req.current}/${req.max}`);
    });
}

function updateDraftHeader() {
    if (!draftData || !draftData.draftOrder) return;

    const currentPickIndex = draftData.currentPickIndex || 0;
    const currentPickNumber = currentPickIndex + 1;
    const currentTeam = draftData.draftOrder[currentPickIndex];

    $("#current-pick-number").text(currentPickNumber);
    $("#current-pick-team").text(currentTeam || "");
    $("#draft-clan-name").text(currentClan || "");
}

function renderDraftTimeline() {
    if (!draftData || !draftData.draftOrder) return;

    const timeline = $("#draft-order-timeline");
    timeline.empty();

    const currentPickIndex = draftData.currentPickIndex || 0;
    const startIndex = Math.max(0, currentPickIndex - 2);
    const endIndex = Math.min(draftData.draftOrder.length, currentPickIndex + 8);

    for (let i = startIndex; i < endIndex; i++) {
        const teamName = draftData.draftOrder[i];
        const pickNum = i + 1;

        let itemClass = "timeline-item";
        let status = "";

        if (i < currentPickIndex) {
            itemClass += " completed";
            status = "✓";
        } else if (i === currentPickIndex) {
            itemClass += " current";
            status = "▶";
        }

        const item = `
            <div class="${itemClass}">
                <div class="timeline-pick-num">#${pickNum}</div>
                <div class="timeline-team-name">${teamName}</div>
                ${status ? `<div class="timeline-status">${status}</div>` : ''}
            </div>
        `;
        timeline.append(item);
    }
}

function updateCarouselButtons(totalPicks) {
    const canGoNext = carouselOffset + PICKS_PER_PAGE < totalPicks;
    const canGoPrev = carouselOffset > 0;

    $("#carousel-next").prop("disabled", !canGoNext).css("opacity", canGoNext ? 1 : 0.3);
    $("#carousel-prev").prop("disabled", !canGoPrev).css("opacity", canGoPrev ? 1 : 0.3);
}

function renderRecentPicks() {
    if (!draftData || !draftData.picksHistory) return;

    const carousel = $("#picks-carousel");
    carousel.empty();

    const totalPicks = draftData.picksHistory.length;

    // Ensure offset is valid
    if (carouselOffset < 0) carouselOffset = 0;
    if (carouselOffset >= totalPicks) carouselOffset = Math.max(0, totalPicks - PICKS_PER_PAGE);

    // Get picks for current page
    const startIdx = Math.max(0, totalPicks - PICKS_PER_PAGE - carouselOffset);
    const endIdx = totalPicks - carouselOffset;
    const recentHistory = draftData.picksHistory.slice(startIdx, endIdx).reverse();

    // Update carousel navigation buttons
    updateCarouselButtons(totalPicks);

    recentHistory.forEach((pick, index) => {
        const playerName = pick.player;
        const teamName = pick.team;
        const positionCode = pick.position;

        const playerData = fullPlayerData.find(p => p.skaterFullName === playerName) ||
                          goalieData.find(p => p.goalieFullName === playerName) ||
                          teamData.find(p => p.teamFullName === playerName);

        const imagePath = getMatchingImage(playerName);
        const isTeamPick = positionCode === "teams" || positionCode === "T";

        let positionLabel = positionCode;
        if (!isTeamPick && playerData?.positionCode) {
            positionLabel = playerData.positionCode;
        }

        // Get team logo
        let teamLogo = null;
        if (isTeamPick) {
            const abbrev = getTeamAbbreviation(playerName);
            teamLogo = abbrev ? `teams/${abbrev}.png` : null;
        } else if (playerData?.teamAbbrevs) {
            teamLogo = getTeamLogoPath(playerData.teamAbbrevs);
        }

        // Build image HTML with team logo support
        let imageHTML;
        if (isTeamPick && teamLogo) {
            // For team picks, show team logo as main image
            imageHTML = `<div class="carousel-player-image">
                <img src="${teamLogo}" alt="${playerName}" />
               </div>`;
        } else if (imagePath) {
            // For player picks with image, show player photo + team logo overlay
            imageHTML = `<div class="carousel-player-image">
                <img src="${imagePath}" alt="${playerName}" />
                ${teamLogo ? `<img src="${teamLogo}" alt="Team" class="carousel-team-logo" />` : ''}
               </div>`;
        } else if (teamLogo) {
            // No player image but has team logo
            imageHTML = `<div class="carousel-player-image">
                <div class="carousel-no-image">${positionLabel}</div>
                <img src="${teamLogo}" alt="Team" class="carousel-team-logo" />
               </div>`;
        } else {
            // No image at all
            imageHTML = `<div class="carousel-player-image">
                <div class="carousel-no-image">${positionLabel}</div>
               </div>`;
        }

        // Calculate actual pick number based on position in full history
        const pickNumber = endIdx - index;

        const card = `
            <div class="pick-card">
                <div class="pick-card-number">Pick #${pickNumber}</div>
                <div class="pick-card-image">
                    ${imageHTML}
                </div>
                <div class="pick-card-name">${playerName}</div>
                <div class="pick-card-team">${teamName}</div>
                <div class="pick-card-position">${positionLabel}</div>
            </div>
        `;
        carousel.append(card);
    });
}

function renderSelectedPlayers() {
    const container = $("#selectedPlayersContainer");
    container.empty();

    const userTeam = getUserTeam();
    if (!userTeam || !draftData.teams[userTeam]) return;

    const team = draftData.teams[userTeam];
    const filter = $("#selectedFilter").val();
    const sortBy = $("#selectedSort").val();

    let players = [];

    if (filter === "offensive" || filter === "all") {
        players = players.concat(team.offensive.map(name => ({ name, type: "offensive" })));
    }
    if (filter === "defensive" || filter === "all") {
        players = players.concat(team.defensive.map(name => ({ name, type: "defensive" })));
    }

    if (filter === "goalies" || filter === "all") {
    players = players.concat(team.goalie?.map(name => ({ name, type: "goalie" })) || []);
    }
    if (filter === "rookies" || filter === "all") {
        players = players.concat(team.rookie?.map(name => ({ name, type: "rookie" })) || []);
    }
    if (filter === "teams" || filter === "all") {
        players = players.concat(team.teams?.map(name => ({ name, type: "team" })) || []);
    }

    // Tri : les plus récents en haut
    players.reverse();

    const list = $("<ul class='selected-list'></ul>");
    players.forEach(player => {
    const stats = fullPlayerData.find(p => p.skaterFullName === player.name)
        || goalieData.find(g => g.goalieFullName === player.name)
        || teamData.find(t => t.teamFullName === player.name);

        const points = stats?.points ?? "-";
        const assists = stats?.assists ?? "-";

        const item = `
            <li>
                <strong>${player.name}</strong> (${player.type}) – ${points} pts${player.type === "offensive" || player.type === "defensive" || player.type === "rookie" ? `, ${assists} passes` : ""}
            </li>
        `;
        list.append(item);
    });
    container.append(list);
}

$("#toggleSelectedPlayers").on("click", function () {
    const content = $("#selectedPlayersContent");
    const isVisible = content.is(":visible");

    content.slideToggle(200);
    $(this).text(isVisible ? "+" : "−");
});

$("#toggleTeamsOverview").on("click", function () {
    const content = $("#teamsContainer");
    const isVisible = content.is(":visible");

    content.slideToggle(200);
    $(this).text(isVisible ? "+" : "−");
});

function launchConfetti() {
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 1000 };

    const interval = setInterval(function () {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
            clearInterval(interval);
            document.getElementById("finishButton").style.display = "block"; // 👈 Show the button
            return;
        }

        const particleCount = 50 * (timeLeft / duration);
        confetti(Object.assign({}, defaults, {
            particleCount,
            origin: { x: Math.random(), y: Math.random() - 0.2 }
        }));
    }, 250);
}

function showProgressDetails(category) {
    const detailsList = $("#progressDetailsList");

    if (!category) {
        detailsList.hide();
        return;
    }

    const userTeam = getUserTeam();
    if (!userTeam || !draftData.teams[userTeam]) {
        detailsList.hide();
        return;
    }

    const team = draftData.teams[userTeam];
    let players = [];
    let categoryName = "";

    switch(category) {
        case "offensive":
            players = team.offensive || [];
            categoryName = "Attaquants";
            break;
        case "defensive":
            players = team.defensive || [];
            categoryName = "Défenseurs";
            break;
        case "rookie":
            players = team.rookie || [];
            categoryName = "Recrues";
            break;
        case "goalie":
            players = team.goalie || [];
            categoryName = "Gardien";
            break;
        case "team":
            players = team.teams || [];
            categoryName = "Équipe";
            break;
    }

    if (players.length === 0) {
        detailsList.html(`<div class="no-picks">Aucun ${categoryName.toLowerCase()} sélectionné</div>`);
    } else {
        const playerListHTML = players.map(playerName => {
            const playerData = fullPlayerData.find(p => p.skaterFullName === playerName) ||
                             goalieData.find(g => g.goalieFullName === playerName) ||
                             teamData.find(t => t.teamFullName === playerName);

            const imagePath = getMatchingImage(playerName);
            let logoPath = null;

            if (category === "team") {
                const abbrev = getTeamAbbreviation(playerName);
                logoPath = abbrev ? `teams/${abbrev}.png` : null;
            } else if (playerData?.teamAbbrevs) {
                logoPath = getTeamLogoPath(playerData.teamAbbrevs);
            }

            const imageHTML = imagePath
                ? `<div class="progress-player-photo">
                    <img src="${imagePath}" alt="${playerName}" class="face">
                    ${logoPath && category !== "team" ? `<img src="${logoPath}" alt="Team" class="logo">` : ''}
                   </div>`
                : (logoPath && category === "team"
                    ? `<div class="progress-player-photo"><img src="${logoPath}" alt="${playerName}" class="face"></div>`
                    : `<div class="progress-player-photo no-image">?</div>`);

            return `
                <div class="progress-player-item">
                    ${imageHTML}
                    <div class="progress-player-name">${playerName}</div>
                </div>
            `;
        }).join('');

        detailsList.html(`
            <div class="progress-details-header">${categoryName} sélectionnés (${players.length})</div>
            <div class="progress-players-grid">${playerListHTML}</div>
        `);
    }

    detailsList.show();
}


$("#availabilityFilter").on("change", updateTable);
$("#searchInput").on("input", updateTable);
$("#playerFilter").on("change", updateTable);
$("#sortBy").on("change", updateTable);
$("#selectedFilter").on("change", renderSelectedPlayers);
$("#progressFilter").on("change", function() {
    const category = $(this).val();
    showProgressDetails(category);
});

$("#carousel-prev").on("click", function() {
    if (!$(this).prop("disabled")) {
        carouselOffset = Math.max(0, carouselOffset - PICKS_PER_PAGE);
        renderRecentPicks();
    }
});

$("#carousel-next").on("click", function() {
    if (!$(this).prop("disabled")) {
        carouselOffset += PICKS_PER_PAGE;
        renderRecentPicks();
    }
});
