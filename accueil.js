// Accueil page - Hot players and streaks display

const BASE_URL = window.location.hostname.includes("localhost")
    ? "http://localhost:3000"
    : window.location.origin;

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    loadHotPlayers();
    loadStreaks();
});

// Load hot players from last 10 games
async function loadHotPlayers() {
    try {
        const response = await fetch(`${BASE_URL}/hot-players`);
        if (!response.ok) throw new Error('Failed to fetch hot players');

        const data = await response.json();

        // Display offensive players
        displayOffensivePlayers(data.offensive || []);

        // Display rookie
        displayRookie(data.rookie || null);

        // Display defensemen
        displayDefensemen(data.defensemen || []);

        // Display goalies
        displayGoalies(data.goalies || []);

        // Display teams
        displayTeams(data.teams || []);

    } catch (error) {
        console.error('Error loading hot players:', error);
        showError('hotOffensivePlayers');
        showError('hotRookie');
        showError('hotDefensemen');
        showError('hotGoalies');
        showError('hotTeams');
    }
}

// Display offensive players
function displayOffensivePlayers(players) {
    const container = document.getElementById('hotOffensivePlayers');

    if (players.length === 0) {
        container.innerHTML = '<p class="loading-spinner">Aucun joueur disponible</p>';
        return;
    }

    container.innerHTML = players.map(player => `
        <div class="player-card" onclick="showPlayerDetails(${player.playerId})">
            <div class="player-header">
                <div class="player-photo">
                    ${player.headshot ? `<img src="${player.headshot}" alt="${player.playerName}">` : '🏒'}
                </div>
                <div class="player-info">
                    <div class="player-name">${player.playerName}</div>
                    <div class="player-team">${player.teamAbbrev || 'N/A'}</div>
                </div>
            </div>
            <div class="player-stats">
                <div class="stat-item">
                    <div class="stat-value">${player.last10Games || 0}</div>
                    <div class="stat-label">Matchs</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${player.last10Goals || 0}</div>
                    <div class="stat-label">Buts</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${player.last10Points || 0}</div>
                    <div class="stat-label">Points</div>
                </div>
            </div>
        </div>
    `).join('');
}

// Display rookie
function displayRookie(player) {
    const container = document.getElementById('hotRookie');

    if (!player) {
        container.innerHTML = '<p class="loading-spinner">Aucune recrue disponible</p>';
        return;
    }

    container.innerHTML = `
        <div class="player-card" onclick="showPlayerDetails(${player.playerId})">
            <div class="player-header">
                <div class="player-photo">
                    ${player.headshot ? `<img src="${player.headshot}" alt="${player.playerName}">` : '⭐'}
                </div>
                <div class="player-info">
                    <div class="player-name">${player.playerName}</div>
                    <div class="player-team">${player.teamAbbrev || 'N/A'}</div>
                </div>
            </div>
            <div class="player-stats">
                <div class="stat-item">
                    <div class="stat-value">${player.last10Games || 0}</div>
                    <div class="stat-label">Matchs</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${player.last10Goals || 0}</div>
                    <div class="stat-label">Buts</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${player.last10Points || 0}</div>
                    <div class="stat-label">Points</div>
                </div>
            </div>
        </div>
    `;
}

// Display defensemen
function displayDefensemen(players) {
    const container = document.getElementById('hotDefensemen');

    if (players.length === 0) {
        container.innerHTML = '<p class="loading-spinner">Aucun défenseur disponible</p>';
        return;
    }

    container.innerHTML = players.map(player => `
        <div class="player-card" onclick="showPlayerDetails(${player.playerId})">
            <div class="player-header">
                <div class="player-photo">
                    ${player.headshot ? `<img src="${player.headshot}" alt="${player.playerName}">` : '🛡️'}
                </div>
                <div class="player-info">
                    <div class="player-name">${player.playerName}</div>
                    <div class="player-team">${player.teamAbbrev || 'N/A'}</div>
                </div>
            </div>
            <div class="player-stats">
                <div class="stat-item">
                    <div class="stat-value">${player.last10Games || 0}</div>
                    <div class="stat-label">Matchs</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${player.last10Goals || 0}</div>
                    <div class="stat-label">Buts</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${player.last10Points || 0}</div>
                    <div class="stat-label">Points</div>
                </div>
            </div>
        </div>
    `).join('');
}

// Display goalies
function displayGoalies(goalies) {
    const container = document.getElementById('hotGoalies');

    if (goalies.length === 0) {
        container.innerHTML = '<p class="loading-spinner">Aucun gardien disponible</p>';
        return;
    }

    container.innerHTML = goalies.map(goalie => `
        <div class="player-card" onclick="showPlayerDetails(${goalie.playerId})">
            <div class="player-header">
                <div class="player-photo">
                    ${goalie.headshot ? `<img src="${goalie.headshot}" alt="${goalie.playerName}">` : '🥅'}
                </div>
                <div class="player-info">
                    <div class="player-name">${goalie.playerName}</div>
                    <div class="player-team">${goalie.teamAbbrev || 'N/A'}</div>
                </div>
            </div>
            <div class="player-stats">
                <div class="stat-item">
                    <div class="stat-value">${goalie.last10Games || 0}</div>
                    <div class="stat-label">Matchs</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${goalie.last10Wins || 0}</div>
                    <div class="stat-label">Victoires</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${goalie.last10SavePct ? (goalie.last10SavePct * 100).toFixed(1) + '%' : '0%'}</div>
                    <div class="stat-label">% Arrêts</div>
                </div>
            </div>
        </div>
    `).join('');
}

// Display teams
function displayTeams(teams) {
    const container = document.getElementById('hotTeams');

    if (teams.length === 0) {
        container.innerHTML = '<p class="loading-spinner">Aucune équipe disponible</p>';
        return;
    }

    container.innerHTML = teams.map(team => `
        <div class="team-card">
            <div class="team-logo">
                ${team.logo ? `<img src="${team.logo}" alt="${team.teamName}">` : '🏆'}
            </div>
            <div class="team-name">${team.teamName}</div>
            <div class="team-record">${team.last10Wins || 0}V - ${team.last10Losses || 0}D</div>
            <div class="team-points">${team.last10Points || 0} points</div>
        </div>
    `).join('');
}

// Load streaks
async function loadStreaks() {
    try {
        const response = await fetch(`${BASE_URL}/streaks`);
        if (!response.ok) throw new Error('Failed to fetch streaks');

        const data = await response.json();

        // Display offensive streak
        displayOffensiveStreak(data.offensiveStreak || null);

        // Display defensive streak
        displayDefensiveStreak(data.defensiveStreak || null);

        // Display goalie streak
        displayGoalieStreak(data.goalieStreak || null);

        // Display team streak
        displayTeamStreak(data.teamStreak || null);

    } catch (error) {
        console.error('Error loading streaks:', error);
        showError('offensiveStreak');
        showError('defensiveStreak');
        showError('goalieStreak');
        showError('teamStreak');
    }
}

// Display offensive streak
function displayOffensiveStreak(streak) {
    const container = document.getElementById('offensiveStreak');

    if (!streak) {
        container.innerHTML = '<div class="streak-icon">⚡</div><h3>Série de points (Attaquant)</h3><p class="loading-spinner">Aucune donnée</p>';
        return;
    }

    container.innerHTML = `
        <div class="streak-icon">⚡</div>
        <h3>Série de points (Attaquant)</h3>
        <div class="streak-player">
            <div class="streak-player-name">${streak.playerName}</div>
            <div class="streak-player-team">${streak.teamAbbrev || 'N/A'}</div>
        </div>
        <div class="streak-number">${streak.streakLength || 0}</div>
        <div class="streak-label">Matchs consécutifs</div>
    `;
}

// Display defensive streak
function displayDefensiveStreak(streak) {
    const container = document.getElementById('defensiveStreak');

    if (!streak) {
        container.innerHTML = '<div class="streak-icon">🛡️</div><h3>Série de points (Défenseur)</h3><p class="loading-spinner">Aucune donnée</p>';
        return;
    }

    container.innerHTML = `
        <div class="streak-icon">🛡️</div>
        <h3>Série de points (Défenseur)</h3>
        <div class="streak-player">
            <div class="streak-player-name">${streak.playerName}</div>
            <div class="streak-player-team">${streak.teamAbbrev || 'N/A'}</div>
        </div>
        <div class="streak-number">${streak.streakLength || 0}</div>
        <div class="streak-label">Matchs consécutifs</div>
    `;
}

// Display goalie streak
function displayGoalieStreak(streak) {
    const container = document.getElementById('goalieStreak');

    if (!streak) {
        container.innerHTML = '<div class="streak-icon">🥅</div><h3>Série de victoires (Gardien)</h3><p class="loading-spinner">Aucune donnée</p>';
        return;
    }

    container.innerHTML = `
        <div class="streak-icon">🥅</div>
        <h3>Série de victoires (Gardien)</h3>
        <div class="streak-player">
            <div class="streak-player-name">${streak.playerName}</div>
            <div class="streak-player-team">${streak.teamAbbrev || 'N/A'}</div>
        </div>
        <div class="streak-number">${streak.streakLength || 0}</div>
        <div class="streak-label">Victoires consécutives</div>
    `;
}

// Display team streak
function displayTeamStreak(streak) {
    const container = document.getElementById('teamStreak');

    if (!streak) {
        container.innerHTML = '<div class="streak-icon">🏆</div><h3>Série de victoires (Équipe)</h3><p class="loading-spinner">Aucune donnée</p>';
        return;
    }

    container.innerHTML = `
        <div class="streak-icon">🏆</div>
        <h3>Série de victoires (Équipe)</h3>
        <div class="streak-player">
            <div class="streak-player-name">${streak.teamName}</div>
        </div>
        <div class="streak-number">${streak.streakLength || 0}</div>
        <div class="streak-label">Victoires consécutives</div>
    `;
}

// Show player details (redirect to stats page with player modal)
function showPlayerDetails(playerId) {
    if (!playerId) return;
    // Store player ID and redirect to stats page
    localStorage.setItem('viewPlayerId', playerId);
    window.location.href = 'index.html';
}

// Show error message
function showError(containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = '<p class="loading-spinner">Erreur de chargement</p>';
    }
}
