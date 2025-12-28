let fullPlayerData = [];
let imageList = [];
const BASE_URL = window.location.hostname.includes("localhost")
  ? "http://localhost:3000"
  : "https://goondraft.onrender.com";



document.addEventListener("DOMContentLoaded", async () => {
    const clanName = localStorage.getItem("draftClan");
    if (!clanName) {
        alert("Aucun clan sélectionné.");
        window.location.href = "draft.html";
        return;
    }

    try {
        const statsResponse = await fetch("nhl_filtered_stats.json");
        const statsData = await statsResponse.json();
        fullPlayerData = [...statsData.Top_50_Defenders, ...statsData.Top_100_Offensive_Players];

        const imageResponse = await fetch("images.json");
        imageList = await imageResponse.json();

        const draftResponse = await fetch(`${BASE_URL}/draft`, { cache: "no-store" });
        const draftData = await draftResponse.json();
        const clan = draftData[clanName];

        if (!clan) {
            alert("Clan introuvable.");
            return;
        }

        document.getElementById("clanTitle").textContent = `Draft terminé : ${clanName}`;
        renderTeamLeaderboard(clan.teams);
    } catch (error) {
        console.error("Erreur lors du chargement :", error);
    }
});



function renderTeams(teams) {
    const container = document.getElementById("teamsContainer");
    container.innerHTML = "";

    Object.entries(teams).forEach(([teamName, teamData]) => {
        if (teamData.members.length === 0) return;

        const teamDiv = document.createElement("div");
        teamDiv.className = "team-card";

        const members = teamData.members.join(", ") || "Aucun membre";

        const allPlayers = [...teamData.offensive, ...teamData.defensive];
        let totalPoints = 0;

        const offensiveList = teamData.offensive.map(name => {
            const stats = fullPlayerData.find(p => p.skaterFullName === name);
            const pts = stats?.points ?? "-";
            const ast = stats?.assists ?? "-";
            const g = stats?.goals ?? "-";
            totalPoints += stats?.points ?? 0;
            return `<li>${name} – ${g} G, ${ast} A, ${pts} PTS</li>`;
        }).join("");

        const defensiveList = teamData.defensive.map(name => {
            const stats = fullPlayerData.find(p => p.skaterFullName === name);
            const pts = stats?.points ?? "-";
            const ast = stats?.assists ?? "-";
            const g = stats?.goals ?? "-";
            totalPoints += stats?.points ?? 0;
            return `<li>${name} – ${g} G, ${ast} A, ${pts} PTS</li>`;
        }).join("");

        teamDiv.innerHTML = `
            <div class="team-header">
                <h3>${teamName}</h3>
                <div class="team-points">Total: ${totalPoints} PTS</div>
            </div>
            <p><strong>Membres :</strong> ${members}</p>
            <div class="team-section">
                <h4>🟥 Joueurs offensifs</h4>
                <ul>${offensiveList}</ul>
            </div>
            <div class="team-section">
                <h4>🟦 Défenseurs</h4>
                <ul>${defensiveList}</ul>
            </div>
        `;

        container.appendChild(teamDiv);
    });
}


function renderTeamLeaderboard(teams) {
    const container = document.getElementById("teamStatsContainer");
    container.innerHTML = "";

    const teamStats = Object.entries(teams)
        .filter(([_, team]) => team.members.length > 0)
        .map(([teamName, team]) => {
            const players = [...team.offensive, ...team.defensive];
            let totalPoints = 0, totalGoals = 0, totalAssists = 0, totalGames = 0;

            const playerStats = players.map(name => {
                const stats = fullPlayerData.find(p => p.skaterFullName === name);
                if (!stats) return null;

                totalPoints += stats.points ?? 0;
                totalGoals += stats.goals ?? 0;
                totalAssists += stats.assists ?? 0;
                totalGames += stats.gamesPlayed ?? 0;

                return {
                    name,
                    position: stats.positionCode,
                    team: stats.teamAbbrevs,
                    games: stats.gamesPlayed,
                    goals: stats.goals,
                    assists: stats.assists,
                    points: stats.points,
                    image: getMatchingImage(name)
                };
            }).filter(Boolean);

            return {
                teamName,
                members: team.members,
                totalPoints,
                totalGoals,
                totalAssists,
                totalGames,
                playerStats
            };
        });

    // Sort by total points
    teamStats.sort((a, b) => b.totalPoints - a.totalPoints);

    teamStats.forEach((team, index) => {
        const teamCard = document.createElement("div");
        teamCard.className = "team-card expandable";

        const playerList = team.playerStats.map(p => `
            <div class="player-row">
                <div class="player-photo">
                    ${p.image ? `<img src="${p.image}" class="face" alt="${p.name}">` : ""}
                    <img src="teams/${p.team}.png" class="logo" alt="${p.team}">
                </div>
                <div class="player-info">
                    <strong>${p.name}</strong> (${p.position})<br>
                    GP: ${p.games}, G: ${p.goals}, A: ${p.assists}, PTS: ${p.points}
                </div>
            </div>
        `).join("");

        teamCard.innerHTML = `
            <div class="team-header" onclick="this.nextElementSibling.classList.toggle('expanded')">
                <h3>${index + 1}. ${team.teamName}</h3>
                <div class="team-meta">
                    <p><strong>Membres:</strong> ${team.members.join(", ")}</p>
                    <p><strong>PTS:</strong> ${team.totalPoints} | GP: ${team.totalGames} | G: ${team.totalGoals} | A: ${team.totalAssists}</p>
                </div>
            </div>
            <div class="team-details">
                ${playerList}
            </div>
        `;

        container.appendChild(teamCard);
    });
}



function getMatchingImage(skaterName) {
    const formattedName = skaterName.replace(/\s/g, "_");
    return imageList.find(imagePath => {
        const baseName = imagePath.replace(/^faces\//, "").replace(/_\d{1,2}_\d{1,2}_\d{4}|_away/g, "").replace(".png", "");
        return baseName === formattedName;
    }) || null;
}

