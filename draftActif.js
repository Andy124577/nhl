let fullPlayerData = [];
let imageList = [];
let draftData = {};
let goalieData = [];
let teamData = [];
let currentClan = localStorage.getItem("draftClan");
let username = localStorage.getItem("username");

const BASE_URL = window.location.hostname.includes("localhost")
  ? "http://localhost:3000"
  : "https://goondraft.onrender.com";


console.log("🔍 draftClan:", localStorage.getItem("draftClan"));
console.log("🔍 username:", localStorage.getItem("username"));


const socket = io(BASE_URL);

socket.on("draftUpdated", (updatedData) => {
    if (updatedData[currentClan] && updatedData[currentClan].teams) {
        draftData = updatedData[currentClan];
        updateTable();
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
        alert("Vous devez être connecté et avoir un draft actif !");
        window.location.href = "draft.html";
        return;
    }

    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    if (isLoggedIn) {
        $("#login-link").html(`<a href="#" onclick="logout()">Déconnexion (${username})</a>`);
    }

    fetchPlayerData();
    setInterval(loadDraftData, 7000); // rafraîchissement toutes les 7s
});

function logout() {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("username");
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
    const firstTeam = teamAbbrevs.split(",")[0].trim();
    return `teams/${firstTeam}.png`;
}

let currentSortBy = "points"; // Valeur par défaut globale

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
    renderDraftPicks();
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

function renderDraftPicks() {
    const container = $("#draft-picks-container");
    container.empty();

    if (!draftData || !draftData.picksHistory) return;

    draftData.picksHistory.forEach((pick, index) => {
        const playerName = pick.player;
        const teamName = pick.team;
        const positionCode = pick.position;

        const playerData =
            fullPlayerData.find(p => p.skaterFullName === playerName) ||
            goalieData.find(p => p.goalieFullName === playerName) ||
            teamData.find(p => p.teamFullName === playerName);

        const isTeamPick = pick.position === "teams";
        let logoPath = "Icons/default.png";

        if (isTeamPick) {
            const abbrev = getTeamAbbreviation(playerName);
            logoPath = abbrev ? `teams/${abbrev}.png` : "Icons/default.png";
        } else if (playerData?.teamAbbrevs) {
            logoPath = getTeamLogoPath(playerData.teamAbbrevs) || "Icons/default.png";
        }

        const facePath = isTeamPick ? logoPath : getMatchingImage(playerName) || "Icons/default.png";

        const card = `
            <div class="draft-pick-card">
                <div class="pick-number">#${index + 1}</div>
                <div class="top-right">
                    <span class="pos">${positionCode}</span>
                    ${!isTeamPick && logoPath ? `<img src="${logoPath}" alt="Team" class="logo" />` : ""}
                </div>
                <div class="player-photo centered-photo">
                    <img src="${facePath}" alt="${playerName}" class="face" />
                </div>
                <div class="player-name">${playerName}</div>
                <div class="team-name">${teamName}</div>
            </div>
        `;
        container.append(card);
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
        alert(result.message);
        await loadDraftData();
    } catch (error) {
        console.error("Erreur lors de la sélection :", error);
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


$("#availabilityFilter").on("change", updateTable);
$("#searchInput").on("input", updateTable);
$("#playerFilter").on("change", updateTable);
$("#sortBy").on("change", updateTable);
$("#selectedFilter").on("change", renderSelectedPlayers);
