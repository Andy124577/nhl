const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path"); // ✅ for static paths
const cron = require("node-cron");
const db = require("./db"); // ✅ PostgreSQL database module

const app = express();
const PORT = process.env.PORT || 3000; // ✅ Use Render's PORT

// Data directory - use persistent volume in production, local directory in development
const DATA_DIR = process.env.NODE_ENV === 'production' ? '/opt/render/project/src/data' : '.';
const USERS_FILE = `${DATA_DIR}/users.json`;
const DRAFT_FILE = `${DATA_DIR}/draft.json`;
const TRADES_FILE = `${DATA_DIR}/trades.json`;
const NHL_STATS_FILE = "./nhl_filtered_stats.json"; // Stats file stays in app directory
const CURRENT_STATS_FILE = `${DATA_DIR}/current_stats.json`;
const CURRENT_TEAMS_FILE = `${DATA_DIR}/current_teams.json`;

// Use PostgreSQL if DATABASE_URL is set, otherwise use JSON files
const USE_POSTGRES = !!process.env.DATABASE_URL;

console.log(`📁 Data directory: ${DATA_DIR}`);

const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } }); // ✅ allow public access for now

app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// Cache control middleware (must come BEFORE static file serving)
app.use((req, res, next) => {
    const reqPath = req.path.toLowerCase();

    if (reqPath.match(/\.(jpg|jpeg|png|gif|ico|svg|webp)$/)) {
        // Cache images for 1 year (immutable means never needs revalidation)
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else if (reqPath.match(/\.(woff|woff2|ttf|eot|otf)$/)) {
        // Cache fonts for 1 year
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else if (reqPath.match(/\.(js|css)$/)) {
        // Cache JS/CSS for 1 week but allow revalidation
        res.setHeader("Cache-Control", "public, max-age=604800, must-revalidate");
    } else if (reqPath.match(/\.(html|htm)$/)) {
        // HTML files: cache for 5 minutes with revalidation
        res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
    } else {
        // Default: no cache for dynamic content
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }

    // Security headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");

    next();
});

// ✅ Serve static files like HTML, CSS, JS
app.use(express.static(__dirname, {
    maxAge: 0, // Let our custom middleware handle caching
    etag: true,
    lastModified: true
}));

// ✅ Optional: Force / to serve index.html
app.get('/', async (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

console.log(`🗄️  Database mode: ${USE_POSTGRES ? 'PostgreSQL' : 'JSON Files'}`);

// ✅ Function to Load & Save Draft Data (supports both PostgreSQL and JSON)
const loadDraftData = async () => {
    if (USE_POSTGRES) {
        try {
            return await db.getAllPools();
        } catch (error) {
            console.error("❌ Error loading from PostgreSQL:", error);
            return {};
        }
    } else {
        // Fallback to JSON file
        try {
            const raw = fs.readFileSync(DRAFT_FILE, "utf-8");
            const parsed = JSON.parse(raw);
            console.log("✅ Contenu de draft.json :", Object.keys(parsed));
            return parsed;
        } catch (error) {
            console.error("❌ Erreur de lecture du draft :", error);
            return {};
        }
    }
};


const saveDraftData = async (data) => {
    if (USE_POSTGRES) {
        try {
            // Save each pool to PostgreSQL
            for (const [poolName, poolData] of Object.entries(data)) {
                await db.createOrUpdatePool(poolName, poolData);
            }
        } catch (error) {
            console.error("❌ Error saving to PostgreSQL:", error);
            // Fallback to JSON file
            fs.writeFileSync(DRAFT_FILE, JSON.stringify(data, null, 2));
        }
    } else {
        // Use JSON file
        fs.writeFileSync(DRAFT_FILE, JSON.stringify(data, null, 2));
    }

    setTimeout(async () => {
        console.log("✅ Reloading fresh data...");
        const freshData = await loadDraftData(); // 🔥 Ensure latest data is broadcast
        console.log("🔥 Sending fresh draft data via WebSocket:", freshData);
        io.emit("draftUpdated", freshData); // ✅ Broadcast ONLY fresh data
        setTimeout(() => {
            io.emit("forceRefresh"); // 🔥 Envoie un signal aux clients pour recharger /draft
        }, 500);
    }, 200); // ✅ Small delay ensures data is fully written before broadcasting
};

// ==============================================
// HEAD-TO-HEAD HELPER FUNCTIONS
// ==============================================

// Generate random matchups for a week (avoid repeats if possible)
function generateWeeklyMatchups(teams, previousMatchups = []) {
    const teamNames = teams.filter(t => t.members && t.members.length > 0).map(t => t.name);

    if (teamNames.length % 2 !== 0) {
        console.error("⚠️ Cannot generate matchups: odd number of teams!");
        return [];
    }

    if (teamNames.length === 0) {
        console.error("⚠️ Cannot generate matchups: no active teams!");
        return [];
    }

    // Special case: 2 teams always play each other
    if (teamNames.length === 2) {
        return [{
            team1: teamNames[0],
            team2: teamNames[1],
            team1Points: 0,
            team2Points: 0,
            winner: null,
            weekNumber: null // Will be set when saved
        }];
    }

    // For >2 teams: try to avoid immediate repetition
    // Build a set of recent pairings from last 2-3 weeks
    const recentPairings = new Set();
    const recentWeeks = previousMatchups.slice(-3); // Last 3 weeks
    recentWeeks.forEach(weekMatchups => {
        if (Array.isArray(weekMatchups)) {
            weekMatchups.forEach(m => {
                if (m.team1 && m.team2) {
                    const pair1 = [m.team1, m.team2].sort().join('|');
                    recentPairings.add(pair1);
                }
            });
        }
    });

    // Try up to 10 shuffles to find a set of matchups with minimal repetition
    let bestMatchups = null;
    let bestScore = Infinity;

    for (let attempt = 0; attempt < 10; attempt++) {
        // Shuffle teams randomly
        const shuffled = [...teamNames].sort(() => Math.random() - 0.5);

        // Create pairs
        const matchups = [];
        let repetitionScore = 0;

        for (let i = 0; i < shuffled.length; i += 2) {
            const team1 = shuffled[i];
            const team2 = shuffled[i + 1];
            const pairKey = [team1, team2].sort().join('|');

            // Count if this pairing was recent
            if (recentPairings.has(pairKey)) {
                repetitionScore++;
            }

            matchups.push({
                team1,
                team2,
                team1Points: 0,
                team2Points: 0,
                winner: null,
                weekNumber: null // Will be set when saved
            });
        }

        // Keep track of best matchups (fewest repetitions)
        if (repetitionScore < bestScore) {
            bestScore = repetitionScore;
            bestMatchups = matchups;
        }

        // If we found a perfect solution (no repetitions), use it
        if (repetitionScore === 0) {
            break;
        }
    }

    return bestMatchups || [];
}

// Calculate total points for a team for a given week
function getTeamWeeklyPoints(teamData, currentStats) {
    let totalPoints = 0;

    // Helper function to get current player stats
    function getPlayerPoints(playerData) {
        if (!currentStats || !currentStats.players) return 0;

        const playerName = playerData.skaterFullName || playerData.goalieFullName || playerData;
        if (!playerName) return 0;

        const stats = currentStats.players.find(p => p.playerName === playerName);
        return stats ? (stats.points || 0) : 0;
    }

    // Sum points from all positions (use correct pool key names)
    ['offensive', 'defensive', 'rookie', 'goalie'].forEach(position => {
        if (teamData[position]) {
            teamData[position].forEach(player => {
                totalPoints += getPlayerPoints(player);
            });
        }
    });

    return totalPoints;
}

// Calculate team fantasy points for a specific date range using player_game_logs
async function getTeamPointsForDateRange(teamData, startDateISO, endDateISO) {
    const startDate = new Date(startDateISO).toISOString().split('T')[0];
    const endDate = new Date(endDateISO).toISOString().split('T')[0];

    // Collect all player names from the team roster
    const playerNames = [];
    ['offensive', 'defensive', 'rookie'].forEach(pos => {
        (teamData[pos] || []).forEach(p => {
            const name = (typeof p === 'string') ? p : (p.skaterFullName || p.goalieFullName || p);
            if (name) playerNames.push(name);
        });
    });
    const goalieNames = [];
    (teamData.goalie || []).forEach(p => {
        const name = (typeof p === 'string') ? p : (p.goalieFullName || p.skaterFullName || p);
        if (name) goalieNames.push(name);
    });

    const allNames = [...playerNames, ...goalieNames];
    if (allNames.length === 0) return 0;

    try {
        // Query game logs for all team players within the date range
        const result = await db.query(`
            SELECT player_name, position,
                   goals, assists, points, shots, plus_minus,
                   power_play_goals, power_play_points,
                   shorthanded_goals, shorthanded_points,
                   game_winning_goals,
                   decision, saves, goals_against, shutouts,
                   game_date
            FROM player_game_logs
            WHERE season = '20252026'
              AND game_date >= $1
              AND game_date < $2
              AND player_name = ANY($3)
            ORDER BY game_date DESC
        `, [startDate, endDate, allNames]);

        if (result.rows.length === 0) {
            console.log(`⚠️ No game logs found for team players between ${startDate} and ${endDate}, falling back to season stats`);
            return null; // Signal to caller to use fallback
        }

        let totalFantasyPoints = 0;

        result.rows.forEach(game => {
            let fantasyPoints = 0;

            if (game.position === 'G') {
                // Goalie scoring
                fantasyPoints += (game.decision === 'W') ? FANTASY_SCORING.win : 0;
                fantasyPoints += (game.shutouts || 0) * FANTASY_SCORING.shutout;
                fantasyPoints += (game.saves || 0) * FANTASY_SCORING.save;
                fantasyPoints += (game.goals_against || 0) * FANTASY_SCORING.goalsAgainst;
            } else {
                // Skater scoring
                fantasyPoints += (game.goals || 0) * FANTASY_SCORING.goal;
                fantasyPoints += (game.assists || 0) * FANTASY_SCORING.assist;
                fantasyPoints += (game.shots || 0) * FANTASY_SCORING.shot;
                fantasyPoints += (game.plus_minus || 0) * FANTASY_SCORING.plusMinus;
                fantasyPoints += (game.power_play_goals || 0) * FANTASY_SCORING.powerPlayGoal;
                fantasyPoints += (game.power_play_points || 0) * FANTASY_SCORING.powerPlayPoint;
                fantasyPoints += (game.shorthanded_goals || 0) * FANTASY_SCORING.shorthandedGoal;
                fantasyPoints += (game.shorthanded_points || 0) * FANTASY_SCORING.shorthandedPoint;
                fantasyPoints += (game.game_winning_goals || 0) * FANTASY_SCORING.gameWinningGoal;
            }

            totalFantasyPoints += fantasyPoints;
        });

        console.log(`📊 Team scored ${totalFantasyPoints.toFixed(1)} fantasy points between ${startDate} and ${endDate} (${result.rows.length} game logs)`);
        return Math.round(totalFantasyPoints * 10) / 10;
    } catch (error) {
        console.error('❌ Error querying game logs for date range:', error);
        return null; // Fallback signal
    }
}

// Returns per-player FPTS breakdown for a team over a date range
async function getTeamPlayerBreakdownForDateRange(teamData, startDateISO, endDateISO) {
    const startDate = new Date(startDateISO).toISOString().split('T')[0];
    const endDate = new Date(endDateISO).toISOString().split('T')[0];

    // Build roster with position labels
    const roster = [];
    ['offensive', 'defensive', 'rookie'].forEach(pos => {
        (teamData[pos] || []).forEach(p => {
            const name = (typeof p === 'string') ? p : (p.skaterFullName || p.goalieFullName || p);
            if (name) roster.push({ name, isGoalie: false });
        });
    });
    (teamData.goalie || []).forEach(p => {
        const name = (typeof p === 'string') ? p : (p.goalieFullName || p.skaterFullName || p);
        if (name) roster.push({ name, isGoalie: true });
    });

    if (roster.length === 0) return [];

    const allNames = roster.map(r => r.name);

    try {
        // Get latest player_id and team_abbrev for each player (for headshot URLs)
        const metaResult = await db.query(`
            SELECT DISTINCT ON (player_name) player_name, player_id, team_abbrev
            FROM player_game_logs
            WHERE player_name = ANY($1)
            ORDER BY player_name, game_date DESC
        `, [allNames]);
        const playerMeta = new Map();
        metaResult.rows.forEach(r => playerMeta.set(r.player_name, { playerId: r.player_id, teamAbbrev: r.team_abbrev }));

        // Get game stats for the date range
        const result = await db.query(`
            SELECT player_name, player_id, team_abbrev, position,
                   goals, assists, shots, plus_minus,
                   power_play_goals, power_play_points,
                   shorthanded_goals, shorthanded_points,
                   game_winning_goals,
                   decision, saves, goals_against, shutouts
            FROM player_game_logs
            WHERE season = '20252026'
              AND game_date >= $1
              AND game_date <= $2
              AND player_name = ANY($3)
        `, [startDate, endDate, allNames]);

        // Aggregate per player
        const playerMap = new Map();
        result.rows.forEach(game => {
            const key = game.player_name;
            if (!playerMap.has(key)) {
                playerMap.set(key, {
                    name: key,
                    position: game.position,
                    playerId: game.player_id,
                    teamAbbrev: game.team_abbrev,
                    fantasyPoints: 0,
                    goals: 0, assists: 0,
                    wins: 0, saves: 0, shutouts: 0
                });
            }
            const p = playerMap.get(key);
            let fp = 0;
            if (game.position === 'G') {
                fp += (game.decision === 'W') ? FANTASY_SCORING.win : 0;
                fp += (game.shutouts || 0) * FANTASY_SCORING.shutout;
                fp += (game.saves || 0) * FANTASY_SCORING.save;
                fp += (game.goals_against || 0) * FANTASY_SCORING.goalsAgainst;
                p.wins += (game.decision === 'W') ? 1 : 0;
                p.saves += game.saves || 0;
                p.shutouts += game.shutouts || 0;
            } else {
                fp += (game.goals || 0) * FANTASY_SCORING.goal;
                fp += (game.assists || 0) * FANTASY_SCORING.assist;
                fp += (game.shots || 0) * FANTASY_SCORING.shot;
                fp += (game.plus_minus || 0) * FANTASY_SCORING.plusMinus;
                fp += (game.power_play_goals || 0) * FANTASY_SCORING.powerPlayGoal;
                fp += (game.power_play_points || 0) * FANTASY_SCORING.powerPlayPoint;
                fp += (game.shorthanded_goals || 0) * FANTASY_SCORING.shorthandedGoal;
                fp += (game.shorthanded_points || 0) * FANTASY_SCORING.shorthandedPoint;
                fp += (game.game_winning_goals || 0) * FANTASY_SCORING.gameWinningGoal;
                p.goals += game.goals || 0;
                p.assists += game.assists || 0;
            }
            p.fantasyPoints += fp;
        });

        // Return roster order with metadata, 0 FPTS for players with no games
        return roster.map(r => {
            const stats = playerMap.get(r.name);
            const meta = playerMeta.get(r.name) || {};
            if (stats) return { ...stats, ...meta, fantasyPoints: Math.round(stats.fantasyPoints * 10) / 10 };
            return { name: r.name, position: r.isGoalie ? 'G' : 'F', fantasyPoints: 0, goals: 0, assists: 0, wins: 0, saves: 0, shutouts: 0, ...meta };
        });
    } catch (err) {
        console.error('❌ Error getting player breakdown:', err);
        return roster.map(r => ({ name: r.name, position: r.isGoalie ? 'G' : 'F', fantasyPoints: 0, goals: 0, assists: 0, wins: 0, saves: 0, shutouts: 0 }));
    }
}

// Helper to ensure standings entry exists for a team
function ensureStandingsEntry(standings, teamName) {
    if (!standings[teamName]) {
        standings[teamName] = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
    }
}

// Calculate results for completed week and update standings
function calculateWeeklyResults(poolData, weekNumber, currentStats) {
    if (!poolData.h2hData || !poolData.h2hData.matchups[weekNumber - 1]) {
        console.error("⚠️ No matchup data for week", weekNumber);
        return;
    }

    const weekMatchups = poolData.h2hData.matchups[weekNumber - 1];
    const standings = poolData.h2hData.standings || {};

    weekMatchups.forEach(matchup => {
        const team1Data = poolData.teams[matchup.team1];
        const team2Data = poolData.teams[matchup.team2];

        if (!team1Data || !team2Data) return;

        // Calculate points for each team
        matchup.team1Points = getTeamWeeklyPoints(team1Data, currentStats);
        matchup.team2Points = getTeamWeeklyPoints(team2Data, currentStats);

        // Determine winner
        if (matchup.team1Points > matchup.team2Points) {
            matchup.winner = matchup.team1;
        } else if (matchup.team2Points > matchup.team1Points) {
            matchup.winner = matchup.team2;
        } else {
            matchup.winner = 'tie'; // Tie
        }

        // Update standings
        if (!standings[matchup.team1]) {
            standings[matchup.team1] = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
        }
        if (!standings[matchup.team2]) {
            standings[matchup.team2] = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
        }

        // Update wins/losses
        if (matchup.winner === matchup.team1) {
            standings[matchup.team1].wins++;
            standings[matchup.team2].losses++;
        } else if (matchup.winner === matchup.team2) {
            standings[matchup.team2].wins++;
            standings[matchup.team1].losses++;
        } else {
            standings[matchup.team1].ties++;
            standings[matchup.team2].ties++;
        }

        // Update points for/against
        standings[matchup.team1].pointsFor += matchup.team1Points;
        standings[matchup.team1].pointsAgainst += matchup.team2Points;
        standings[matchup.team2].pointsFor += matchup.team2Points;
        standings[matchup.team2].pointsAgainst += matchup.team1Points;
    });

    poolData.h2hData.standings = standings;

    // Save to history
    if (!poolData.h2hData.matchupHistory) {
        poolData.h2hData.matchupHistory = [];
    }
    poolData.h2hData.matchupHistory.push({
        weekNumber: weekNumber,
        matchups: weekMatchups,
        completedDate: new Date().toISOString()
    });

    return poolData;
}

// Get current week number based on weekStart date
function getCurrentWeekNumber(weekStart) {
    if (!weekStart) return 1;

    const start = new Date(weekStart);
    const now = new Date();
    const diffTime = Math.abs(now - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const weekNumber = Math.floor(diffDays / 7) + 1;

    return weekNumber;
}

// ✅ WebSocket Connection
io.on("connection", async (socket) => {
    console.log("📡 Client connecté via WebSockets");
    const draftData = await loadDraftData();
    socket.emit("draftUpdated", draftData); // Send initial data on connection
});

app.post("/leave-team", async (req, res) => {
    try {
        const { name, username } = req.body;
        let draftData = await loadDraftData();

        if (!draftData[name]) {
            return res.status(400).json({ message: "Clan introuvable !" });
        }

        // Trouver l'équipe actuelle de l'utilisateur
        let currentTeam = Object.entries(draftData[name].teams)
            .find(([teamName, teamData]) => teamData.members.includes(username));

        if (!currentTeam) return res.status(400).json({ message: "Vous n'êtes dans aucune équipe !" });

        // Supprimer l'utilisateur de son équipe actuelle
        draftData[name].teams[currentTeam[0]].members = draftData[name].teams[currentTeam[0]].members.filter(user => user !== username);
        await saveDraftData(draftData);
        setTimeout(() => {
            io.emit("draftUpdated", draftData);
        }, 2000); // ou 200ms
        // 🔔 Notifie tous les clients


        res.json({ message: `✅ ${username} a quitté ${currentTeam[0]} avec succès !` });

    } catch (error) {
        console.error("❌ Erreur lors du retrait de l'équipe :", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

// ✅ Route to Join a Clan
app.post("/join-clan", async (req, res) => {
    const { name, username } = req.body;
    let draftData = await loadDraftData();

    if (!draftData[name]) {
        return res.status(400).json({ message: "Clan introuvable !" });
    }

    const userInClan = Object.values(draftData[name].teams).some(team => team.members.includes(username));
    if (userInClan) {
        return res.status(400).json({ message: "Vous êtes déjà membre d'une équipe de ce clan !" });
    }

    res.json({ message: `Vous avez rejoint le clan ${name}, choisissez une équipe !`, teams: draftData[name].teams });
});


// ✅ Route to Delete a Clan
app.post("/delete-clan", async (req, res) => {
    const { clanName } = req.body;
    let draftData = await loadDraftData();

    if (!draftData[clanName]) {
        return res.status(400).json({ message: "Le clan n'existe pas !" });
    }

    delete draftData[clanName];
    await saveDraftData(draftData);
    setTimeout(() => {
            io.emit("draftUpdated", draftData);
        }, 2000); // ou 200ms
        // 🔔 Notifie tous les clients

    res.json({ message: `Clan ${clanName} supprimé avec succès !` });
});

// 📌 Route pour récupérer tous les pools et équipes
app.get("/draft", async (req, res) => {
    try {
        const draftData = await loadDraftData();
        console.log("📤 Draft envoyé :", Object.keys(draftData));
        res.json(draftData);
    } catch (error) {
        console.error("Error loading draft data:", error);
        res.status(500).json({ error: "Failed to load draft data" });
    }
});

// 🔥 Route pour sélectionner un joueur pour une équipe
app.post("/pick-player", async (req, res) => {
    const { clanName, username, playerName, position } = req.body;

    if (!clanName || !username || !playerName || !position) {
        return res.status(400).json({ message: "Données incomplètes." });
    }

    let draftData = await loadDraftData();
    const clan = draftData[clanName];
    if (!clan) return res.status(404).json({ message: "Clan introuvable." });

    const userTeamEntry = Object.entries(clan.teams).find(([_, team]) => team.members.includes(username));
    if (!userTeamEntry) return res.status(400).json({ message: "Vous n'êtes dans aucune équipe." });

    const [userTeamName, userTeam] = userTeamEntry;

    const currentTeamTurn = clan.draftOrder[clan.currentPickIndex];

    if (currentTeamTurn !== userTeamName) {
        return res.status(403).json({ message: "Ce n'est pas votre tour de drafter." });
    }

    const allPicked = Object.values(clan.teams).flatMap(team =>
        [].concat(
            team.offensive || [],
            team.defensive || [],
            team.rookie || [],
            team.goalie || [],
            team.teams || []
        )
    );

    if (allPicked.includes(playerName)) {
        return res.status(400).json({ message: "Ce joueur a déjà été sélectionné." });
    }

    // Get pool configuration, fallback to defaults if not set
    const config = clan.config || {
        numOffensive: 6,
        numDefensive: 4,
        numGoalies: 1,
        numRookies: 1,
        numTeams: 1
    };

    if (position === "offensive") {
        if (userTeam.offensive.length >= config.numOffensive) {
            return res.status(400).json({ message: `Votre équipe a déjà ${config.numOffensive} joueur${config.numOffensive > 1 ? 's' : ''} offensif${config.numOffensive > 1 ? 's' : ''}.` });
        }
        userTeam.offensive.push(playerName);
    } else if (position === "defensive") {
        if (userTeam.defensive.length >= config.numDefensive) {
            return res.status(400).json({ message: `Votre équipe a déjà ${config.numDefensive} défenseur${config.numDefensive > 1 ? 's' : ''}.` });
        }
        userTeam.defensive.push(playerName);
    } else if (position === "rookie") {
        if (!userTeam.rookie) userTeam.rookie = [];
        if (userTeam.rookie.length >= config.numRookies) {
            return res.status(400).json({ message: `Votre équipe a déjà ${config.numRookies} rookie${config.numRookies > 1 ? 's' : ''}.` });
        }
        userTeam.rookie.push(playerName);
    } else if (position === "goalie") {
        if (!userTeam.goalie) userTeam.goalie = [];
        if (userTeam.goalie.length >= config.numGoalies) {
            return res.status(400).json({ message: `Votre équipe a déjà ${config.numGoalies} gardien${config.numGoalies > 1 ? 's' : ''}.` });
        }
        userTeam.goalie.push(playerName);
    } else if (position === "teams") {
        if (!userTeam.teams) userTeam.teams = [];
        if (userTeam.teams.length >= config.numTeams) {
            return res.status(400).json({ message: `Votre équipe a déjà ${config.numTeams} équipe${config.numTeams > 1 ? 's' : ''} NHL.` });
        }
        userTeam.teams.push(playerName);
    } else {
        return res.status(400).json({ message: "Position invalide." });
    }

    // ✅ Empêche les doubles sélections pour le même tour
    if (clan.lastPickIndex === clan.currentPickIndex) {
    // Check if the team can still pick anything
    const team = clan.teams[userTeamName];
    const canPickOffensive = team.offensive.length < config.numOffensive;
    const canPickDefensive = team.defensive.length < config.numDefensive;

    if (!canPickOffensive && !canPickDefensive) {
        // Skip this team and move to the next pick
        if (clan.currentPickIndex < clan.draftOrder.length - 1) {
            clan.currentPickIndex += 1;
            await saveDraftData(draftData);
            return res.status(200).json({ message: "Tour sauté : équipe complète." });
            } else {
                return res.status(200).json({ message: "Dernier tour atteint." });
            }
        }

        return res.status(400).json({ message: "Ce tour a déjà été complété." });
    }


    clan.lastPickIndex = clan.currentPickIndex;

    // ✅ N'avance que si on n'est pas à la fin du draftOrder
    if (clan.currentPickIndex < clan.draftOrder.length - 1) {
        clan.currentPickIndex += 1;
    } else {
        console.log("✅ Dernier tour atteint. Le draft est terminé.");
    }

    // 🔥 Enregistre le pick dans l'historique
    if (!clan.picksHistory) clan.picksHistory = [];
    clan.picksHistory.push({
        team: userTeamName,
        player: playerName,
        position
    });


    console.log("✅", playerName, "ajouté à", userTeamName);

    await saveDraftData(draftData);

    setTimeout(() => {
        io.emit("draftUpdated", draftData);
        io.emit("forceRefresh");
    }, 200);

    if (checkIfDraftComplete(clan)) {
        io.emit("draftComplete", { clanName });

        // If Head-to-Head mode, generate first week's matchups
        if (clan.poolMode === 'head-to-head' && clan.h2hData) {
            console.log("🏒 Generating first week matchups for H2H pool:", clanName);

            // Get active teams (must include members so generateWeeklyMatchups can filter correctly)
            const activeTeams = Object.entries(clan.teams)
                .filter(([_, teamData]) => teamData.members && teamData.members.length > 0)
                .map(([teamName, teamData]) => ({ name: teamName, members: teamData.members }));

            // Generate matchups for week 1 (no previous matchups)
            const weekOneMatchups = generateWeeklyMatchups(activeTeams, []);

            // Set week start to the current week's Monday 00:00:00
            const now = new Date();
            const currentMonday = new Date(now);
            const dayOfWeek = now.getDay();
            const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // 0=Sun goes back 6, else go to Mon
            currentMonday.setDate(now.getDate() + daysToMonday);
            currentMonday.setHours(0, 0, 0, 0);

            clan.h2hData.weekStart = currentMonday.toISOString();
            clan.h2hData.currentWeek = 1;
            clan.h2hData.matchups = [weekOneMatchups.map(m => ({ ...m, weekNumber: 1 }))];

            // Initialize standings for all active teams
            activeTeams.forEach(team => {
                clan.h2hData.standings[team.name] = {
                    wins: 0,
                    losses: 0,
                    ties: 0,
                    pointsFor: 0,
                    pointsAgainst: 0
                };
            });

            // Save updated data
            await saveDraftData(draftData);

            console.log("✅ Week 1 matchups generated:", weekOneMatchups);
            console.log("📅 Season starts:", nextMonday.toISOString());
        }
    }

    res.json({ message: `✅ ${playerName} a été sélectionné par ${userTeamName}.` });
});


// 📌 Route pour récupérer l'ordre du draft d'un clan
app.get("/draft-order/:clanName", async (req, res) => {
    const { clanName } = req.params;
    const draftData = await loadDraftData();

    if (!draftData[clanName]) {
        return res.status(400).json({ message: "Clan introuvable !" });
    }

    res.json({ draftOrder: draftData[clanName].draftOrder });
});

// 📌 Charger et sauvegarder `users.json`
const loadUsers = async () => {
    if (USE_POSTGRES) {
        try {
            return await db.getAllUsers();
        } catch (error) {
            console.error("❌ Error loading users from PostgreSQL:", error);
            // Fallback to JSON file
            try {
                return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
            } catch (fileError) {
                return [];
            }
        }
    } else {
        try {
            return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
        } catch (error) {
            console.error("Erreur de lecture des utilisateurs :", error);
            return [];
        }
    }
};

const saveUsers = async (users) => {
    if (USE_POSTGRES) {
        // Note: With PostgreSQL, users are saved individually via createUser/deleteUser
        // This function is kept for compatibility but won't be used much
        console.warn("⚠️ await saveUsers() called with PostgreSQL - users should be created individually");
    } else {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    }
};

// 🔥 Route pour récupérer les drafts actifs
app.get("/active-drafts", async (req, res) => {
    const { username } = req.query;
    if (!username) return res.status(400).json({ message: "Nom d'utilisateur requis !" });

    const draftData = await loadDraftData();

    // Recherche des drafts où l'utilisateur est membre d'une équipe
    const activeDrafts = Object.keys(draftData).filter(clan =>
        Object.values(draftData[clan].teams).some(team => team.members.includes(username))
    );

    res.json({ activeDrafts });
});

// 🔥 Route pour récupérer l'ordre du draft d'un clan
app.get("/draft-order/:clanName", async (req, res) => {
    const { clanName } = req.params;
    const draftData = await loadDraftData();

    if (!draftData[clanName]) {
        return res.status(400).json({ message: "Clan introuvable !" });
    }

    res.json({ draftOrder: draftData[clanName].draftOrder });
});



// 🔥 Route pour créer un clan
app.post("/create-clan", async (req, res) => {
    try {
        const { name, maxPlayers, config, poolMode, allowTrades, username } = req.body;
        let draftData = await loadDraftData();

        if (draftData[name]) {
            return res.status(400).json({ message: "Ce clan existe déjà !" });
        }

        // Default configuration values if not provided
        const poolConfig = config || {
            numOffensive: 6,
            numDefensive: 4,
            numGoalies: 1,
            numRookies: 1,
            numTeams: 1
        };

        // 🔥 Initialize 10 teams for the new clan
        let teams = {};
        for (let i = 1; i <= 10; i++) {
            teams[`Équipe ${i}`] = { members: [], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] };
        }

        // ✅ Automatically add the creator to Équipe 1
        if (username) {
            teams['Équipe 1'].members.push(username);
        }

        // Initialize pool data
        draftData[name] = {
            maxPlayers: parseInt(maxPlayers),
            draftOrder: [],
            currentPickIndex: 0,
            lastPickIndex: -1,
            config: poolConfig,
            poolMode: poolMode || 'cumulative', // 'cumulative' or 'head-to-head'
            allowTrades: allowTrades !== false, // Default true
            teams
        };

        // If Head-to-Head mode, initialize matchup structure
        if (poolMode === 'head-to-head') {
            draftData[name].h2hData = {
                currentWeek: 1,
                weekStart: null, // Will be set when draft completes
                matchups: [], // Array of weekly matchups
                standings: {}, // teamName: { wins, losses, pointsFor, pointsAgainst }
                matchupHistory: [] // Complete history of all matchups
            };
        }

        await saveDraftData(draftData);
        setTimeout(() => {
        io.emit("draftUpdated", draftData);
        }, 2000); // ou 200ms
        // 🔔 Notifie tous les clients

        // ✅ Return fully updated draft data
        res.json({
            message: `Pool "${name}" créé avec succès ! Vous avez été ajouté à l'Équipe 1.`,
            draftData,
            autoJoined: !!username
        });

    } catch (error) {
        console.error("Erreur lors de la création du clan :", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

app.post("/delete-clan", async (req, res) => {
    const { clanName } = req.body;
    let draftData = await loadDraftData();

    if (!draftData[clanName]) {
        return res.status(400).json({ message: "Le clan n'existe pas !" });
    }

    // Remove the clan from the draft data
    delete draftData[clanName];
    await saveDraftData(draftData);
    setTimeout(() => {
        io.emit("draftUpdated", draftData);
        }, 2000); // ou 200ms
        // 🔔 Notifie tous les clients


    res.json({ message: `Clan ${clanName} supprimé avec succès !` });
});

app.post("/change-team", async (req, res) => {
    try {
        const { name, username, newTeamNumber } = req.body;
        let draftData = await loadDraftData();

        if (!draftData[name] || !draftData[name].teams[newTeamNumber]) {
            return res.status(400).json({ message: "Clan ou équipe introuvable !" });
        }

        // Check if draft has already started
        if (draftData[name].draftOrder && draftData[name].draftOrder.length > 0) {
            return res.status(400).json({ message: "Le draft a déjà commencé ! Vous ne pouvez plus changer d'équipe." });
        }

        // Vérifier que l'utilisateur est bien dans une équipe
        let currentTeam = Object.entries(draftData[name].teams)
            .find(([teamName, teamData]) => teamData.members.includes(username));

        if (!currentTeam) return res.status(400).json({ message: "Vous n'êtes dans aucune équipe !" });

        // Vérifier que l'équipe cible n'est pas pleine
        if (draftData[name].teams[newTeamNumber].members.length >= 5) {
            return res.status(400).json({ message: "Cette équipe est complète !" });
        }

        // Mise à jour des membres
        draftData[name].teams[currentTeam[0]].members = draftData[name].teams[currentTeam[0]].members.filter(user => user !== username);
        draftData[name].teams[newTeamNumber].members.push(username);

        await saveDraftData(draftData);
        setTimeout(() => {
            io.emit("draftUpdated", draftData);
        }, 2000); // ou 200ms
        // 🔔 Notifie tous les clients

        res.json({ message: `Vous avez rejoint l'équipe ${newTeamNumber} du clan ${name} !` });

    } catch (error) {
        console.error("Erreur lors du changement d'équipe :", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

app.post("/join-clan", async (req, res) => {
    const { name, username } = req.body;
    let draftData = await loadDraftData();

    if (!draftData[name]) {
        return res.status(400).json({ message: "Clan introuvable !" });
    }

    // ✅ Check if user is already part of the clan
    const userInClan = Object.values(draftData[name].teams).some(team => team.members.includes(username));
    if (userInClan) {
        return res.status(400).json({ message: "Vous êtes déjà membre d'une équipe de ce clan !" });
    }

    // 🔥 Assign user to a default placeholder team until they choose one
    const availableTeam = Object.entries(draftData[name].teams).find(([teamName, teamData]) => teamData.members.length < 5);
    if (availableTeam) {
        draftData[name].teams[availableTeam[0]].members.push(username);
        await saveDraftData(draftData);
        setTimeout(() => {
            io.emit("draftUpdated", draftData);
        }, 2000); // ou 200ms
        // 🔔 Notifie tous les clients

    }

    res.json({ 
        message: `Vous avez rejoint le clan ${name}, choisissez une équipe !`, 
        teams: draftData[name].teams,
        draftData // ✅ Ensure frontend gets updated data
    });
});

// 🔥 Route pour rejoindre un clan
app.post("/join-team", async (req, res) => {
    const { name, username, teamName } = req.body;
    let draftData = await loadDraftData();

    if (!draftData[name] || !draftData[name].teams[teamName]) {
        return res.status(400).json({ message: "Clan ou équipe introuvable !" });
    }

    // Check if draft has already started
    if (draftData[name].draftOrder && draftData[name].draftOrder.length > 0) {
        return res.status(400).json({ message: "Le draft a déjà commencé ! Vous ne pouvez plus rejoindre ou changer d'équipe." });
    }

    if (draftData[name].teams[teamName].members.includes(username)) {
        return res.status(400).json({ message: "Vous êtes déjà membre de cette équipe !" });
    }

    if (draftData[name].teams[teamName].members.length >= 5) {
        return res.status(400).json({ message: "Cette équipe est complète !" });
    }

    // Remove user from any other team in this clan first
    Object.keys(draftData[name].teams).forEach(team => {
        draftData[name].teams[team].members = draftData[name].teams[team].members.filter(m => m !== username);
    });

    draftData[name].teams[teamName].members.push(username);
    await saveDraftData(draftData);
    setTimeout(() => {
            io.emit("draftUpdated", draftData);
        }, 2000); // ou 200ms
        // 🔔 Notifie tous les clients


    // ✅ Return full updated draft data so frontend refreshes
    res.json({ message: `Vous avez rejoint l'équipe ${teamName} du clan ${name} avec succès !`, draftData });
});

// ✏️ Rename a team (only the member of that team can rename it)
app.post("/rename-team", async (req, res) => {
    try {
        const { clanName, oldTeamName, newTeamName, username } = req.body;

        if (!clanName || !oldTeamName || !newTeamName || !username) {
            return res.status(400).json({ message: "Paramètres manquants." });
        }

        const sanitized = newTeamName.trim();

        if (sanitized.length === 0 || sanitized.length > 20) {
            return res.status(400).json({ message: "Le nom doit contenir entre 1 et 20 caractères." });
        }

        // Allow letters (incl. accented), numbers, spaces, hyphens, apostrophes, underscores
        if (!/^[\p{L}\p{N}\s'\-_]+$/u.test(sanitized)) {
            return res.status(400).json({ message: "Nom invalide. Caractères non autorisés." });
        }

        const draftData = await loadDraftData();
        const clan = draftData[clanName];

        if (!clan) return res.status(404).json({ message: "Pool introuvable." });
        if (!clan.teams[oldTeamName]) return res.status(404).json({ message: "Équipe introuvable." });

        if (!clan.teams[oldTeamName].members.includes(username)) {
            return res.status(403).json({ message: "Vous ne pouvez renommer que votre propre équipe." });
        }

        if (sanitized === oldTeamName) {
            return res.status(400).json({ message: "Le nouveau nom est identique à l'ancien." });
        }

        if (clan.teams[sanitized]) {
            return res.status(400).json({ message: "Ce nom d'équipe est déjà utilisé." });
        }

        // Rename in teams object
        clan.teams[sanitized] = clan.teams[oldTeamName];
        delete clan.teams[oldTeamName];

        // Update draftOrder
        if (Array.isArray(clan.draftOrder)) {
            clan.draftOrder = clan.draftOrder.map(t => t === oldTeamName ? sanitized : t);
        }

        // Update H2H data
        if (clan.h2hData) {
            if (clan.h2hData.standings && clan.h2hData.standings[oldTeamName]) {
                clan.h2hData.standings[sanitized] = clan.h2hData.standings[oldTeamName];
                delete clan.h2hData.standings[oldTeamName];
            }
            const updateMatchups = (matchups) => {
                if (!Array.isArray(matchups)) return;
                matchups.forEach(m => {
                    if (m.team1 === oldTeamName) m.team1 = sanitized;
                    if (m.team2 === oldTeamName) m.team2 = sanitized;
                    if (m.winner === oldTeamName) m.winner = sanitized;
                });
            };
            updateMatchups(clan.h2hData.matchups);
            if (Array.isArray(clan.h2hData.matchupHistory)) {
                clan.h2hData.matchupHistory.forEach(week => updateMatchups(week.matchups));
            }
        }

        await saveDraftData(draftData);
        io.emit("draftUpdated", draftData);

        res.json({ message: `Équipe renommée en "${sanitized}" avec succès !`, newTeamName: sanitized });
    } catch (error) {
        console.error("Erreur /rename-team:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// 🔒 Route d'inscription
app.post("/signup", async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: "Nom d'utilisateur et mot de passe requis !" });

        // Check if user already exists
        if (USE_POSTGRES) {
            const existingUser = await db.getUserByUsername(username);
            if (existingUser) {
                return res.status(400).json({ message: "Ce nom d'utilisateur est déjà pris !" });
            }

            // Create user in PostgreSQL
            const hashedPassword = await bcrypt.hash(password, 10);
            await db.createUser(username, hashedPassword, false);
            console.log(`✅ User "${username}" created in PostgreSQL`);
        } else {
            // JSON file mode
            let users = await loadUsers();
            if (users.some(user => user.username === username)) {
                return res.status(400).json({ message: "Ce nom d'utilisateur est déjà pris !" });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            users.push({ username, password: hashedPassword });
            await saveUsers(users);
        }

        res.json({ message: "Inscription réussie !" });
    } catch (error) {
        console.error("Erreur lors de l'inscription :", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

// 🧪 Route to create test users (admin only - use with caution)
app.post("/create-test-users", async (req, res) => {
    try {
        const { adminToken } = req.body;

        // Simple security check - only allow with admin token
        if (adminToken !== 'admin') {
            return res.status(403).json({ message: "Accès non autorisé" });
        }

        const testUsers = [
            { username: 'alex', password: 'test123' },
            { username: 'marie', password: 'test123' },
            { username: 'jean', password: 'test123' },
            { username: 'sophie', password: 'test123' },
            { username: 'thomas', password: 'test123' },
            { username: 'emma', password: 'test123' },
        ];

        let users = await loadUsers();
        const created = [];
        const skipped = [];

        for (const testUser of testUsers) {
            if (users.some(user => user.username === testUser.username)) {
                skipped.push(testUser.username);
                continue;
            }

            const hashedPassword = await bcrypt.hash(testUser.password, 10);
            users.push({ username: testUser.username, password: hashedPassword, isAdmin: false });
            created.push(testUser.username);
        }

        if (created.length > 0) {
            await saveUsers(users);
        }

        res.json({
            message: `Utilisateurs de test créés avec succès!`,
            created: created,
            skipped: skipped,
            info: "Mot de passe pour tous: test123"
        });
    } catch (error) {
        console.error("Erreur lors de la création des utilisateurs de test:", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

// 🔑 Route de connexion
app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        let user;
        if (USE_POSTGRES) {
            // Get user with password from PostgreSQL
            user = await db.getUserByUsername(username);
        } else {
            // JSON file mode
            let users = await loadUsers();
            user = users.find(u => u.username === username);
        }

        if (!user) return res.status(400).json({ message: "Utilisateur non trouvé !" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Mot de passe incorrect !" });

        res.json({ message: "Connexion réussie !" });

    } catch (error) {
        console.error("Erreur lors de la connexion :", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

// 🔐 Admin login endpoint
app.post("/admin-login", async (req, res) => {
    try {
        const { username, password } = req.body;

        // Hardcoded admin credentials
        if (username === "admin" && password === "zubzub") {
            return res.json({
                message: "Admin connexion réussie !",
                isAdmin: true,
                username: "admin"
            });
        }

        return res.status(401).json({ message: "Identifiants admin invalides !" });
    } catch (error) {
        console.error("Erreur lors de la connexion admin :", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

// 🔐 Admin switch user endpoint
app.post("/admin-switch-user", async (req, res) => {
    try {
        const { adminToken, targetUsername } = req.body;

        // Verify admin token (in a real app, use proper JWT or session)
        if (adminToken !== "admin") {
            return res.status(403).json({ message: "Accès refusé. Admin seulement." });
        }

        // Check if target user exists
        let users = await loadUsers();
        const user = users.find(u => u.username === targetUsername);

        if (!user) {
            return res.status(404).json({ message: "Utilisateur non trouvé !" });
        }

        res.json({
            message: `Basculé vers l'utilisateur ${targetUsername}`,
            username: targetUsername
        });
    } catch (error) {
        console.error("Erreur lors du changement d'utilisateur :", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

// 🔐 Get all users (admin only)
app.get("/admin-users", async (req, res) => {
    try {
        const { adminToken } = req.query;

        if (adminToken !== "admin") {
            return res.status(403).json({ message: "Accès refusé. Admin seulement." });
        }

        let users = await loadUsers();
        const usernames = users.map(u => u.username);

        res.json({ users: usernames });
    } catch (error) {
        console.error("Erreur lors de la récupération des utilisateurs :", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

(async () => {
    const hash = await bcrypt.hash("testpassword", 10);
    const isMatch = await bcrypt.compare("testpassword", hash);
    console.log("Test bcrypt:", isMatch);
})();


app.post("/start-draft", async (req, res) => {
    const { clanName } = req.body;
    if (!clanName) return res.status(400).json({ message: "Nom du clan requis." });

    let draftData = await loadDraftData();
    const clan = draftData[clanName];
    if (!clan) return res.status(404).json({ message: "Clan introuvable." });

    const eligibleTeams = Object.entries(clan.teams)
        .filter(([_, team]) => team.members.length > 0)
        .map(([teamName]) => teamName)
        .sort(); // ✅ Sort alphabetically: Équipe 1, Équipe 2, Équipe 3

    if (eligibleTeams.length < 2) {
        return res.status(400).json({
            message: "Il faut au moins 2 équipes avec des joueurs pour démarrer le draft."
        });
    }

    if (clan.draftOrder.length === 0) {
        // Calculate total picks based on pool configuration
        const config = clan.config || {
            numOffensive: 6,
            numDefensive: 4,
            numGoalies: 1,
            numRookies: 1,
            numTeams: 1
        };
        const totalPicks = config.numOffensive + config.numDefensive + config.numGoalies + config.numRookies + config.numTeams;

        clan.draftOrder = generateSnakeOrder(eligibleTeams, totalPicks);
        await saveDraftData(draftData);
        return res.json({ message: "✅ Draft démarré avec succès avec ordre serpentin !" });
    } else {
        return res.json({ message: "Le draft est déjà en cours." });
    }
});



  // Fonction pour générer un ordre de draft en serpentin (snake draft)
// ✅ Fonction centrale pour générer un ordre de draft en serpentin
function generateSnakeOrder(teams, rounds = 15) {
    const order = [];

    if (teams.length === 2) {
        // Simple alternating draft for 2 teams
        for (let i = 0; i < rounds * teams.length; i++) {
            order.push(teams[i % 2]);
        }
    } else {
        // Snake draft for 3+ teams
        for (let i = 0; i < rounds; i++) {
            const round = i % 2 === 0 ? [...teams] : [...teams].reverse();
            order.push(...round);
        }
    }

    return order;
}



app.post("/randomize-draft-order", async (req, res) => {
    const { clanName } = req.body;
    if (!clanName) return res.status(400).json({ message: "Nom du clan requis." });

    let draftData = await loadDraftData();
    const clan = draftData[clanName];
    if (!clan) return res.status(404).json({ message: "Clan introuvable." });

    // ✅ Cette vérification doit venir après avoir défini `clan`
    if (clan.draftOrder && clan.draftOrder.length > 0) {
        return res.status(400).json({ message: "Le draft a déjà un ordre défini." });
    }

    const eligibleTeams = Object.entries(clan.teams)
        .filter(([_, team]) => team.members.length > 0)
        .map(([teamName]) => teamName);

    if (eligibleTeams.length < 2) {
        return res.status(400).json({ message: "Pas assez d'équipes pour générer un ordre de draft." });
    }

    // Calculate total picks based on pool configuration
    const config = clan.config || {
        numOffensive: 6,
        numDefensive: 4,
        numGoalies: 1,
        numRookies: 1,
        numTeams: 1
    };
    const totalPicks = config.numOffensive + config.numDefensive + config.numGoalies + config.numRookies + config.numTeams;

    const initialOrder = [...eligibleTeams].sort(() => Math.random() - 0.5);
    clan.draftOrder = generateSnakeOrder(initialOrder, totalPicks);
    await saveDraftData(draftData);

    res.json({ message: "Ordre de draft généré en serpentin.", draftOrder: clan.draftOrder });
});



function checkIfDraftComplete(clan) {
    // Check only teams with members (active teams in the draft)
    const activeTeams = Object.values(clan.teams).filter(team =>
        team.members && team.members.length > 0
    );

    if (activeTeams.length === 0) return false;

    // Get pool configuration, fallback to defaults if not set
    const config = clan.config || {
        numOffensive: 6,
        numDefensive: 4,
        numGoalies: 1,
        numRookies: 1,
        numTeams: 1
    };

    return activeTeams.every(team =>
        team.offensive.length === config.numOffensive &&
        team.defensive.length === config.numDefensive &&
        team.rookie?.length === config.numRookies &&
        team.goalie?.length === config.numGoalies &&
        team.teams?.length === config.numTeams
    );
}


app.post("/cleanup-draft", async (req, res) => {
    const { clanName } = req.body;
    let draftData = await loadDraftData();

    if (!draftData[clanName]) {
        return res.status(400).json({ message: "Clan introuvable." });
    }

    const teams = draftData[clanName].teams;
    Object.keys(teams).forEach(team => {
        if (
            teams[team].members.length === 0 &&
            teams[team].offensive.length === 0 &&
            teams[team].defensive.length === 0
        ) {
            delete teams[team];
        }
    });

    await saveDraftData(draftData);
    res.json({ message: "Nettoyage effectué.", draftData: draftData[clanName] });
});

// ==================== NHL CURRENT STATS SYSTEM ====================

// Function to load all players from nhl_filtered_stats.json
function loadAllPlayers() {
    try {
        const data = JSON.parse(fs.readFileSync(NHL_STATS_FILE, "utf-8"));
        const allPlayers = [];

        // Combine all sections and mark goalies
        if (data.Top_50_Defenders) {
            allPlayers.push(...data.Top_50_Defenders.map(p => ({ ...p, isGoalie: false })));
        }
        if (data.Top_100_Offensive_Players) {
            allPlayers.push(...data.Top_100_Offensive_Players.map(p => ({ ...p, isGoalie: false })));
        }
        if (data.Top_Rookies) {
            allPlayers.push(...data.Top_Rookies.map(p => ({ ...p, isGoalie: false })));
        }
        if (data.Top_50_Goalies) {
            allPlayers.push(...data.Top_50_Goalies.map(p => ({ ...p, isGoalie: true })));
        }

        console.log(`✅ Loaded ${allPlayers.length} players from NHL stats file`);
        return allPlayers;
    } catch (error) {
        console.error("❌ Error loading NHL stats file:", error);
        return [];
    }
}

// Function to fetch current season stats from NHL API
async function fetchCurrentStatsForPlayer(playerId, playerName, isGoalie = false) {
    try {
        const url = `https://api-web.nhle.com/v1/player/${playerId}/landing`;
        const response = await fetch(url);

        if (!response.ok) {
            console.log(`⚠️ Failed to fetch stats for ${playerName} (${playerId})`);
            return null;
        }

        const data = await response.json();

        // Construct headshot URL - NHL API provides headshots at this URL format
        const headshotUrl = data.headshot || `https://assets.nhle.com/mugs/nhl/20252026/${data.currentTeamAbbrev || 'NJD'}/${playerId}.png`;

        // ALWAYS check seasonTotals first for NHL-only stats (to avoid showing WHL/AHL stats from featuredStats)
        // Use .filter() instead of .find() to get ALL teams for traded players
        const seasonTotals = data.seasonTotals || [];
        const nhlSeasonEntries = seasonTotals.filter(s =>
            s.season === 20252026 &&
            s.gameTypeId === 2 && // gameTypeId 2 = NHL regular season
            s.leagueAbbrev === 'NHL' // Only NHL league - must explicitly be NHL
        );

        let seasonStats = null;

        if (nhlSeasonEntries.length > 0) {
            // Found NHL stats - combine all teams if player was traded
            if (nhlSeasonEntries.length > 1) {
                console.log(`✓ Found ${nhlSeasonEntries.length} NHL teams for ${playerName} (traded player) - combining stats`);
            } else {
                console.log(`✓ Found NHL stats for ${playerName} in seasonTotals`);
            }

            // Combine stats from all teams
            seasonStats = nhlSeasonEntries.reduce((combined, entry) => {
                return {
                    gamesPlayed: (combined.gamesPlayed || 0) + (entry.gamesPlayed || 0),
                    goals: (combined.goals || 0) + (entry.goals || 0),
                    assists: (combined.assists || 0) + (entry.assists || 0),
                    points: (combined.points || 0) + (entry.points || 0),
                    wins: (combined.wins || 0) + (entry.wins || 0),
                    losses: (combined.losses || 0) + (entry.losses || 0),
                    shutouts: (combined.shutouts || 0) + (entry.shutouts || 0),
                    otLosses: (combined.otLosses || 0) + (entry.otLosses || 0),
                    // Track saves and shotsAgainst for correct SV% calculation
                    saves: (combined.saves || 0) + (entry.saves || 0),
                    shotsAgainst: (combined.shotsAgainst || 0) + (entry.shotsAgainst || 0)
                };
            }, {});

            // Compute savePct from combined saves/shotsAgainst for traded goalies
            if (seasonStats.shotsAgainst > 0) {
                seasonStats.savePct = seasonStats.saves / seasonStats.shotsAgainst;
            } else {
                seasonStats.savePct = 0;
            }
        } else {
            // No NHL stats found for current season - return zeros
            console.log(`⚠️ ${playerName} has no NHL stats for 20252026 - returning zeros`);
            return {
                playerId: playerId,
                playerName: playerName,
                teamAbbrev: data.currentTeamAbbrev || "N/A",
                headshot: headshotUrl,
                teamLogo: data.teamLogo || null,
                position: data.position || "N/A",
                gamesPlayed: 0,
                goals: 0,
                assists: 0,
                wins: 0,
                losses: 0,
                shutouts: 0,
                otLosses: 0,
                savePct: 0,
                points: 0,
                lastUpdated: new Date().toISOString()
            };
        }

        let calculatedPoints;
        let wins = 0;
        let shutouts = 0;
        let otLosses = 0;
        let losses = 0;
        let savePct = 0;

        if (isGoalie) {
            // Goalie scoring: shutouts = 5pts, wins = 2pts, OTL = 1pt
            wins = seasonStats.wins || 0;
            losses = seasonStats.losses || 0;
            shutouts = seasonStats.shutouts || 0;
            otLosses = seasonStats.otLosses || 0;

            // Try savePct from API, or savePercentage, or compute from saves/shotsAgainst
            savePct = seasonStats.savePct || seasonStats.savePercentage || 0;
            if (!savePct && seasonStats.saves && seasonStats.shotsAgainst && seasonStats.shotsAgainst > 0) {
                savePct = seasonStats.saves / seasonStats.shotsAgainst;
            }

            calculatedPoints = (shutouts * 5) + (wins * 2) + (otLosses * 1);
        } else {
            // Skater: use regular points (goals + assists)
            calculatedPoints = seasonStats.points || 0;
        }

        // Return structured stats
        return {
            playerId: playerId,
            playerName: playerName,
            teamAbbrev: data.currentTeamAbbrev || "N/A",
            headshot: headshotUrl,
            teamLogo: data.teamLogo || null,
            position: data.position || "N/A",
            gamesPlayed: seasonStats.gamesPlayed || 0,
            goals: isGoalie ? wins : (seasonStats.goals || 0),
            assists: isGoalie ? shutouts : (seasonStats.assists || 0),
            wins: wins,
            losses: losses,
            shutouts: shutouts,
            otLosses: otLosses,
            savePct: savePct,
            points: calculatedPoints,
            lastUpdated: new Date().toISOString()
        };
    } catch (error) {
        console.error(`❌ Error fetching stats for ${playerName}:`, error.message);
        // Return zeros if fetch fails (network error, API down, etc.)
        return {
            playerId: playerId,
            playerName: playerName,
            teamAbbrev: "N/A",
            headshot: null,
            teamLogo: null,
            position: "N/A",
            gamesPlayed: 0,
            goals: 0,
            assists: 0,
            wins: 0,
            losses: 0,
            shutouts: 0,
            otLosses: 0,
            savePct: 0,
            points: 0,
            lastUpdated: new Date().toISOString()
        };
    }
}

// Function to fetch and cache all current stats
async function updateCurrentStats() {
    console.log("🔄 Starting NHL stats update...");

    // Load existing stats to preserve as "previous"
    const existingStats = await loadCurrentStats();
    const previousPlayers = existingStats.players || [];

    const allPlayers = loadAllPlayers();
    const newPlayers = [];

    // Fetch stats in batches of 10 with 300ms between batches to respect rate limits
    const STATS_BATCH = 10;
    for (let i = 0; i < allPlayers.length; i += STATS_BATCH) {
        const batch = allPlayers.slice(i, i + STATS_BATCH);
        console.log(`Fetching ${i + 1}–${Math.min(i + STATS_BATCH, allPlayers.length)}/${allPlayers.length}`);

        const batchResults = await Promise.all(batch.map(async (player) => {
            const playerName = player.skaterFullName || player.goalieFullName;
            const stats = await fetchCurrentStatsForPlayer(
                player.playerId,
                playerName,
                player.isGoalie
            );
            if (stats) {
                const previousStats = previousPlayers.find(p => p.playerId === stats.playerId);
                const previousPoints = previousStats ? previousStats.points : 0;
                stats.todayPoints = stats.points - previousPoints;
            }
            return stats;
        }));

        newPlayers.push(...batchResults.filter(Boolean));

        if (i + STATS_BATCH < allPlayers.length) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    const currentStats = {
        lastUpdated: new Date().toISOString(),
        season: 20252026,
        players: newPlayers
    };

    // Save to database or file
    if (USE_POSTGRES) {
        await db.saveCachedStats('current-stats', currentStats);
    } else {
        fs.writeFileSync(CURRENT_STATS_FILE, JSON.stringify(currentStats, null, 2));
    }
    console.log(`✅ NHL stats updated successfully! ${currentStats.players.length} players cached.`);

    return currentStats;
}

// Load cached stats or return empty structure
async function loadCurrentStats() {
    try {
        if (USE_POSTGRES) {
            const stats = await db.loadCachedStats('current-stats');
            if (stats) return stats;
        } else {
            if (fs.existsSync(CURRENT_STATS_FILE)) {
                return JSON.parse(fs.readFileSync(CURRENT_STATS_FILE, "utf-8"));
            }
        }
    } catch (error) {
        console.error("❌ Error loading current stats:", error);
    }

    return {
        lastUpdated: null,
        players: []
    };
}

// Route to get current stats
app.get("/current-stats", async (req, res) => {
    try {
        let stats = await loadCurrentStats();

        // Force refresh if no cache, wrong season, or cache older than 24 hours
        if (!stats.lastUpdated) {
            console.log("📊 No cached stats found, fetching fresh data...");
            stats = await updateCurrentStats();
        } else if (stats.season !== 20252026) {
            console.log(`📊 Cached stats are from season ${stats.season || 'unknown'}, refreshing for 2025-26...`);
            stats = await updateCurrentStats();
        } else {
            const lastUpdate = new Date(stats.lastUpdated);
            const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);

            if (hoursSinceUpdate > 24) {
                console.log("📊 Cached stats are old, fetching fresh data...");
                stats = await updateCurrentStats();
            }
        }

        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
        res.json(stats);
    } catch (error) {
        console.error("❌ Error in /current-stats route:", error);
        res.status(500).json({ message: "Error fetching current stats" });
    }
});

// Schedule daily stats update at midnight (00:00)
cron.schedule('0 0 * * *', async () => {
    console.log("⏰ Daily stats update triggered at midnight");
    await updateCurrentStats();
    await updateTeamStandings();
}, {
    timezone: "America/New_York" // Adjust to your timezone
});

// Schedule daily game logs fetch at 3 AM
cron.schedule('0 3 * * *', async () => {
    console.log("🏒 Daily game logs fetch triggered at 3 AM");

    try {
        const { exec } = require('child_process');

        exec('node fetch_game_logs.js', (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Game logs fetch failed:', error);
                console.error('stderr:', stderr);
                return;
            }

            console.log('✅ Game logs fetch completed');
            console.log('stdout:', stdout);
        });

    } catch (error) {
        console.error('❌ Error starting game logs fetch:', error);
    }
}, {
    timezone: "America/New_York" // Adjust to your timezone
});

// ===============================================
// SMART GAME-NIGHT STATS UPDATER
// Polls /score/now every 15 min during game hours.
// Only fetches player logs when a game just went Final.
// ===============================================

const gameStatusCache = new Map(); // gameId → last known gameState
let smartUpdateRunning = false;

// Fetch one player's full season game log and upsert to DB
async function fetchAndSavePlayerLog(playerId, playerName, position) {
    const url = `https://api-web.nhle.com/v1/player/${playerId}/game-log/20252026/2`;
    try {
        const response = await fetch(url);
        if (!response.ok) return 0;
        const data = await response.json();
        if (!data?.gameLog?.length) return 0;

        const queries = data.gameLog.map(game => {
            const saves = game.saves ?? ((game.shotsAgainst || 0) - (game.goalsAgainst || 0));
            return db.query(`
                INSERT INTO player_game_logs (
                    player_id, player_name, position, season, game_id, game_date,
                    home_road_flag, opponent_abbrev, team_abbrev, game_result,
                    goals, assists, points, plus_minus, pim, shots,
                    power_play_goals, power_play_points, shorthanded_goals, shorthanded_points,
                    game_winning_goals, toi,
                    games_started, decision, shots_against, goals_against, saves, save_pct, shutouts,
                    last_updated
                ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                    $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                    $21,$22,$23,$24,$25,$26,$27,$28,$29,NOW()
                )
                ON CONFLICT (player_id, game_id) DO UPDATE SET
                    goals=EXCLUDED.goals, assists=EXCLUDED.assists, points=EXCLUDED.points,
                    plus_minus=EXCLUDED.plus_minus, shots=EXCLUDED.shots,
                    power_play_goals=EXCLUDED.power_play_goals,
                    power_play_points=EXCLUDED.power_play_points,
                    shorthanded_goals=EXCLUDED.shorthanded_goals,
                    shorthanded_points=EXCLUDED.shorthanded_points,
                    game_winning_goals=EXCLUDED.game_winning_goals,
                    decision=EXCLUDED.decision, saves=EXCLUDED.saves,
                    goals_against=EXCLUDED.goals_against, shutouts=EXCLUDED.shutouts,
                    team_abbrev=EXCLUDED.team_abbrev, last_updated=NOW()
            `, [
                playerId, playerName, position, '20252026',
                game.gameId, game.gameDate, game.homeRoadFlag, game.opponentAbbrev,
                game.teamAbbrev, game.gameResult,
                game.goals||0, game.assists||0, game.points||0, game.plusMinus||0,
                game.pim||0, game.shots||0,
                game.powerPlayGoals||0, game.powerPlayPoints||0,
                game.shorthandedGoals||0, game.shorthandedPoints||0,
                game.gameWinningGoals||0, game.toi||'0:00',
                game.gamesStarted||0, game.decision||null,
                game.shotsAgainst||0, game.goalsAgainst||0,
                saves, game.savePct||null, game.shutouts||0
            ]);
        });

        await Promise.all(queries);
        return data.gameLog.length;
    } catch (err) {
        console.error(`⚠️  Smart update: failed to fetch ${playerName}:`, err.message);
        return 0;
    }
}

// Return players from nhl_filtered_stats.json whose team is in the given list
function getPlayersForTeams(teamAbbrevs) {
    try {
        const statsData = JSON.parse(fs.readFileSync(NHL_STATS_FILE, 'utf-8'));
        const players = [];
        const seen = new Set();

        const add = (p, name, pos) => {
            if (p?.playerId && !seen.has(p.playerId) && teamAbbrevs.includes(p.teamAbbrev)) {
                seen.add(p.playerId);
                players.push({ playerId: p.playerId, playerName: name, position: pos });
            }
        };

        (statsData.Top_100_Offensive_Players || []).forEach(p => add(p, p.skaterFullName, p.positionCode));
        (statsData.Top_50_Defenders        || []).forEach(p => add(p, p.skaterFullName, p.positionCode));
        (statsData.Top_Rookies             || []).forEach(p => { if (p.positionCode !== 'G') add(p, p.skaterFullName, p.positionCode); });
        (statsData.Top_50_Goalies          || []).forEach(p => add(p, p.goalieFullName, 'G'));

        return players;
    } catch (err) {
        console.error('⚠️  Smart update: could not read stats file:', err.message);
        return [];
    }
}

// Core smart-poll: check which games just finished, update only those players
async function checkAndUpdateFinishedGames() {
    if (smartUpdateRunning) {
        console.log('⏭️  Smart update: previous run still in progress, skipping');
        return;
    }
    smartUpdateRunning = true;

    try {
        const response = await fetch('https://api-web.nhle.com/v1/score/now');
        if (!response.ok) {
            console.log('⚠️  Smart update: /score/now returned', response.status);
            return;
        }

        const data = await response.json();
        const games = data.games || [];

        if (games.length === 0) {
            console.log('📅 Smart update: no games scheduled today');
            return;
        }

        const newlyFinished = [];
        for (const game of games) {
            const id    = game.id;
            const state = game.gameState; // FINAL | OFF | LIVE | CRIT | FUT | PRE
            const prev  = gameStatusCache.get(id);
            const done  = state === 'FINAL' || state === 'OFF';

            gameStatusCache.set(id, state);

            if (done && prev !== 'FINAL' && prev !== 'OFF') {
                newlyFinished.push({
                    id,
                    home: game.homeTeam?.abbrev,
                    away: game.awayTeam?.abbrev,
                    label: `${game.awayTeam?.abbrev} ${game.awayTeam?.score ?? 0}-${game.homeTeam?.score ?? 0} ${game.homeTeam?.abbrev}`
                });
            }
        }

        if (newlyFinished.length === 0) {
            const live = games.filter(g => g.gameState === 'LIVE' || g.gameState === 'CRIT').length;
            const done = games.filter(g => g.gameState === 'FINAL' || g.gameState === 'OFF').length;
            console.log(`📊 Smart update: ${games.length} games (${live} live, ${done} final) — nothing new`);
            return;
        }

        const teamAbbrevs = [...new Set(newlyFinished.flatMap(g => [g.home, g.away]).filter(Boolean))];
        console.log(`🏒 Smart update: ${newlyFinished.length} game(s) just finished: ${newlyFinished.map(g => g.label).join(' | ')}`);
        console.log(`🎯 Teams to update: ${teamAbbrevs.join(', ')}`);

        const players = getPlayersForTeams(teamAbbrevs);
        if (players.length === 0) {
            console.log('⚠️  Smart update: no tracked fantasy players on these teams');
            return;
        }

        console.log(`👥 Fetching logs for ${players.length} players...`);
        let totalRows = 0;
        const BATCH = 10;
        for (let i = 0; i < players.length; i += BATCH) {
            const batch = players.slice(i, i + BATCH);
            const counts = await Promise.all(batch.map(p => fetchAndSavePlayerLog(p.playerId, p.playerName, p.position)));
            totalRows += counts.reduce((s, n) => s + n, 0);
            if (i + BATCH < players.length) await new Promise(r => setTimeout(r, 200));
        }

        console.log(`✅ Smart update done: ${totalRows} rows upserted for ${players.length} players`);

    } catch (err) {
        console.error('❌ Smart update error:', err.message);
    } finally {
        smartUpdateRunning = false;
    }
}

// Every 15 min from 6 PM to 1:59 AM ET (covers all game windows including OT/SO)
cron.schedule('*/15 18-23,0,1 * * *', () => {
    console.log('🔍 Smart game-night check triggered');
    checkAndUpdateFinishedGames();
}, { timezone: 'America/New_York' });

// Populate the cache on startup so the first poll only triggers genuinely new finals
checkAndUpdateFinishedGames();

// Optional: Manual trigger endpoint for testing
app.post("/refresh-stats", async (req, res) => {
    try {
        console.log("🔄 Manual stats refresh triggered");
        const stats = await updateCurrentStats();
        const teams = await updateTeamStandings();
        res.json({
            message: "Stats refreshed successfully",
            playersUpdated: stats.players.length,
            teamsUpdated: teams.teams.length,
            lastUpdated: stats.lastUpdated
        });
    } catch (error) {
        console.error("❌ Error refreshing stats:", error);
        res.status(500).json({ message: "Error refreshing stats" });
    }
});

// Manual trigger endpoint for game logs fetch
app.post("/fetch-game-logs", async (req, res) => {
    try {
        console.log("🏒 Manual game logs fetch triggered");

        const { exec } = require('child_process');

        // Start fetch in background
        exec('node fetch_game_logs.js', (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Game logs fetch failed:', error);
                console.error('stderr:', stderr);
            } else {
                console.log('✅ Game logs fetch completed');
                console.log('stdout:', stdout);
            }
        });

        // Return immediately (fetch runs in background)
        res.json({
            message: "Game logs fetch started in background",
            note: "Check server logs for progress"
        });

    } catch (error) {
        console.error("❌ Error starting game logs fetch:", error);
        res.status(500).json({ message: "Error starting game logs fetch" });
    }
});

// Manual trigger: force a smart update check right now
app.post("/check-games-now", async (req, res) => {
    res.json({ message: "Smart game check triggered — watch server logs" });
    checkAndUpdateFinishedGames();
});

// Manual trigger endpoint for database migration
app.post("/run-migration", async (req, res) => {
    try {
        console.log("🗄️ Database migration triggered");

        const { exec } = require('child_process');

        // Run migration
        exec('node run_migration.js', (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Migration failed:', error);
                console.error('stderr:', stderr);
            } else {
                console.log('✅ Migration completed');
                console.log('stdout:', stdout);
            }
        });

        // Return immediately
        res.json({
            message: "Database migration started",
            note: "Check server logs for results"
        });

    } catch (error) {
        console.error("❌ Error starting migration:", error);
        res.status(500).json({ message: "Error starting migration" });
    }
});

// Status endpoint to check game logs setup
app.get("/game-logs-status", async (req, res) => {
    try {
        // Check if table exists and get stats
        const result = await db.query(`
            SELECT
                COUNT(DISTINCT player_id) as total_players,
                COUNT(*) as total_games,
                MAX(last_updated) as last_updated,
                MIN(game_date) as earliest_game,
                MAX(game_date) as latest_game
            FROM player_game_logs
            WHERE season = '20252026'
        `);

        const stats = result.rows[0];

        if (stats.total_games > 0) {
            res.json({
                status: "✅ Working",
                tableExists: true,
                totalPlayers: parseInt(stats.total_players),
                totalGames: parseInt(stats.total_games),
                lastUpdated: stats.last_updated,
                earliestGame: stats.earliest_game,
                latestGame: stats.latest_game,
                message: "Game logs are set up and working!"
            });
        } else {
            res.json({
                status: "⚠️ Empty",
                tableExists: true,
                totalPlayers: 0,
                totalGames: 0,
                message: "Table exists but no data. Run: curl -X POST https://fantazy.ca/fetch-game-logs"
            });
        }

    } catch (error) {
        if (error.message.includes('does not exist')) {
            res.json({
                status: "❌ Not Set Up",
                tableExists: false,
                message: "Table doesn't exist. Run: curl -X POST https://fantazy.ca/run-migration"
            });
        } else {
            console.error('❌ Error checking status:', error);
            res.status(500).json({
                status: "❌ Error",
                error: error.message
            });
        }
    }
});

// ==================== NHL TEAM STANDINGS SYSTEM ====================

// Function to fetch current team standings from NHL API
async function fetchCurrentTeamStandings() {
    try {
        const url = 'https://api-web.nhle.com/v1/standings/now';
        const response = await fetch(url);

        if (!response.ok) {
            console.log('⚠️ Failed to fetch team standings');
            return null;
        }

        const data = await response.json();
        const teams = [];

        // Extract team data from standings
        if (data.standings) {
            data.standings.forEach(team => {
                // Calculate points using custom scoring: wins * 2 + OTL * 1
                const calculatedPoints = (team.wins * 2) + (team.otLosses * 1);

                // Get team name, handling special cases
                let teamFullName = team.teamName?.default || team.teamCommonName?.default;

                // Handle Utah Hockey Club specifically (NHL API might use different naming)
                if (team.teamAbbrev?.default === 'UTA' || teamFullName?.includes('Utah')) {
                    teamFullName = 'Utah Hockey Club';
                }

                teams.push({
                    teamFullName: teamFullName,
                    teamAbbrev: team.teamAbbrev?.default,
                    teamId: team.teamId,
                    gamesPlayed: team.gamesPlayed || 0,
                    wins: team.wins || 0,
                    losses: team.losses || 0,
                    otLosses: team.otLosses || 0,
                    points: calculatedPoints,
                    lastUpdated: new Date().toISOString()
                });
            });
        }

        console.log(`✅ Fetched standings for ${teams.length} teams`);
        return teams;
    } catch (error) {
        console.error('❌ Error fetching team standings:', error.message);
        return null;
    }
}

// Function to update and cache team standings
async function updateTeamStandings() {
    console.log('🔄 Updating team standings...');

    const teams = await fetchCurrentTeamStandings();

    if (!teams || teams.length === 0) {
        console.log('⚠️ No team data fetched');
        return await loadCurrentTeams();
    }

    const teamStats = {
        lastUpdated: new Date().toISOString(),
        teams: teams
    };

    // Save to database or file
    if (USE_POSTGRES) {
        await db.saveCachedStats('current-teams', teamStats);
    } else {
        fs.writeFileSync(CURRENT_TEAMS_FILE, JSON.stringify(teamStats, null, 2));
    }
    console.log(`✅ Team standings updated successfully! ${teams.length} teams cached.`);

    return teamStats;
}

// Load cached team standings
async function loadCurrentTeams() {
    try {
        if (USE_POSTGRES) {
            const teams = await db.loadCachedStats('current-teams');
            if (teams) return teams;
        } else {
            if (fs.existsSync(CURRENT_TEAMS_FILE)) {
                return JSON.parse(fs.readFileSync(CURRENT_TEAMS_FILE, 'utf-8'));
            }
        }
    } catch (error) {
        console.error('❌ Error loading current teams:', error);
    }

    return {
        lastUpdated: null,
        teams: []
    };
}

// Route to get current team standings
app.get('/current-teams', async (req, res) => {
    try {
        let stats = await loadCurrentTeams();

        // If no cached stats or cache is older than 24 hours, update
        if (!stats.lastUpdated) {
            console.log('📊 No cached team standings found, fetching fresh data...');
            stats = await updateTeamStandings();
        } else {
            const lastUpdate = new Date(stats.lastUpdated);
            const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);

            if (hoursSinceUpdate > 24) {
                console.log('📊 Cached team standings are old, fetching fresh data...');
                stats = await updateTeamStandings();
            }
        }

        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
        res.json(stats);
    } catch (error) {
        console.error('❌ Error in /current-teams route:', error);
        res.status(500).json({ message: 'Error fetching current team standings' });
    }
});

// Route to get player career stats (all seasons including playoffs)
app.get('/player-career/:playerId', async (req, res) => {
    try {
        const { playerId } = req.params;
        const url = `https://api-web.nhle.com/v1/player/${playerId}/landing`;

        const response = await fetch(url);

        if (!response.ok) {
            return res.status(404).json({ message: 'Player not found' });
        }

        const data = await response.json();

        // Extract player info
        const playerName = data.firstName?.default && data.lastName?.default
            ? `${data.firstName.default} ${data.lastName.default}`
            : 'Unknown Player';
        const position = data.position || 'N/A';
        const isGoalie = position === 'G';
        const currentTeam = data.currentTeamAbbrev || null;
        // Construct headshot URL - use API's headshot or construct from player ID and current team
        const headshot = data.headshot || (currentTeam ? `https://assets.nhle.com/mugs/nhl/20252026/${currentTeam}/${playerId}.png` : null);
        const teamLogo = data.teamLogo || null;

        // Extract player bio details
        const heightInInches = data.heightInInches || null;
        const heightFeetInches = heightInInches ? `${Math.floor(heightInInches / 12)}′${heightInInches % 12}″` : null;
        const weightInPounds = data.weightInPounds || null;
        const birthDate = data.birthDate || null;
        const birthCity = data.birthCity?.default || null;
        const birthStateProvince = data.birthStateProvince?.default || null;
        const birthCountry = data.birthCountry || null;
        const shootsCatches = data.shootsCatches || null;

        // Extract draft details
        const draftDetails = data.draftDetails;
        let draftInfo = null;
        if (draftDetails) {
            draftInfo = {
                year: draftDetails.year,
                teamAbbrev: draftDetails.teamAbbrev,
                round: draftDetails.round,
                pickInRound: draftDetails.pickInRound,
                overallPick: draftDetails.overallPick
            };
        }

        // Extract all seasons from seasonTotals (regular season + playoffs combined in one array)
        const allSeasons = data.seasonTotals || [];

        // Format seasons for display
        const formattedSeasons = allSeasons.map(season => {
            const seasonId = season.season;
            const seasonDisplay = `${seasonId.toString().substring(0, 4)}-${seasonId.toString().substring(6, 8)}`;
            const leagueAbbrev = season.leagueAbbrev || 'NHL';
            const teamAbbrev = season.teamName?.default || season.teamAbbrev || 'N/A';
            const gameType = season.gameTypeId === 3 ? 'playoffs' : 'regular';

            if (isGoalie) {
                return {
                    season: seasonDisplay,
                    league: leagueAbbrev,
                    team: teamAbbrev,
                    gameType: gameType,
                    gp: season.gamesPlayed || 0,
                    wins: season.wins || 0,
                    losses: season.losses || 0,
                    otLosses: season.otLosses || 0,
                    savePct: season.savePct || season.savePercentage || 0,
                    gaa: season.goalsAgainstAvg || 0,
                    shutouts: season.shutouts || 0
                };
            } else {
                return {
                    season: seasonDisplay,
                    league: leagueAbbrev,
                    team: teamAbbrev,
                    gameType: gameType,
                    gp: season.gamesPlayed || 0,
                    goals: season.goals || 0,
                    assists: season.assists || 0,
                    points: season.points || 0,
                    plusMinus: season.plusMinus || 0,
                    pim: season.pim || 0,
                    shots: season.shots || 0
                };
            }
        });

        res.json({
            playerId,
            playerName,
            position,
            isGoalie,
            headshot,
            teamLogo,
            currentTeam,
            seasons: formattedSeasons,
            // Bio details
            height: heightFeetInches,
            weight: weightInPounds,
            birthDate,
            birthCity,
            birthStateProvince,
            birthCountry,
            shootsCatches,
            draftInfo
        });
    } catch (error) {
        console.error('❌ Error fetching player career stats:', error);
        res.status(500).json({ message: 'Error fetching player career stats' });
    }
});

// Route to get player game log for current season (from PostgreSQL)
app.get('/player-gamelog/:playerId', async (req, res) => {
    try {
        const { playerId } = req.params;
        const playerIdNum = parseInt(playerId);
        const currentSeason = '20252026';

        console.log(`📊 Loading game log for player ${playerId} from database`);

        // Query game logs from PostgreSQL
        const result = await db.query(`
            SELECT
                player_id, player_name, position,
                game_id, game_date, home_road_flag, opponent_abbrev, team_abbrev, game_result,
                goals, assists, points, plus_minus, pim, shots,
                power_play_goals, power_play_points, shorthanded_goals, shorthanded_points,
                game_winning_goals, toi,
                games_started, decision, shots_against, goals_against, saves, save_pct, shutouts,
                last_updated
            FROM player_game_logs
            WHERE player_id = $1 AND season = $2
            ORDER BY game_date DESC
        `, [playerIdNum, currentSeason]);

        if (result.rows.length === 0) {
            console.log(`⚠️ Player ${playerId} not found in database`);
            return res.json({
                gameLog: [],
                playerInfo: null,
                message: 'Player game logs not found. Run: node fetch_game_logs.js'
            });
        }

        // Get player info from first row
        const firstRow = result.rows[0];
        const playerInfo = {
            name: firstRow.player_name,
            position: firstRow.position,
            isGoalie: firstRow.position === 'G'
        };

        // Format game log
        const gameLog = result.rows.map(row => ({
            gameId: row.game_id,
            gameDate: row.game_date,
            homeRoadFlag: row.home_road_flag,
            opponentAbbrev: row.opponent_abbrev,
            teamAbbrev: row.team_abbrev,
            gameResult: row.game_result,
            goals: row.goals,
            assists: row.assists,
            points: row.points,
            plusMinus: row.plus_minus,
            pim: row.pim,
            shots: row.shots,
            powerPlayGoals: row.power_play_goals,
            powerPlayPoints: row.power_play_points,
            shorthandedGoals: row.shorthanded_goals,
            shorthandedPoints: row.shorthanded_points,
            gameWinningGoals: row.game_winning_goals,
            toi: row.toi,
            gamesStarted: row.games_started,
            decision: row.decision,
            shotsAgainst: row.shots_against,
            goalsAgainst: row.goals_against,
            saves: row.saves,
            savePct: row.save_pct,
            shutouts: row.shutouts
        }));

        console.log(`✅ Found ${gameLog.length} games for ${playerInfo.name}`);

        res.json({
            gameLog,
            playerInfo,
            lastUpdated: firstRow.last_updated
        });

    } catch (error) {
        console.error('❌ Error loading player game log:', error);
        res.status(500).json({ message: 'Error loading player game log' });
    }
});

// ==================== ACCUEIL PAGE - HOT PLAYERS & STREAKS ====================

// Cache for last 10 games stats (refreshed every 6 hours)
let last10GamesCache = {
    lastUpdated: null,
    data: null
};

const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

// Helper function to calculate last 10 games stats for a player
async function getPlayerLast10Stats(playerId, position) {
    try {
        const currentSeason = '20252026';
        const gameType = '2'; // Regular season

        const url = `https://api-web.nhle.com/v1/player/${playerId}/game-log/${currentSeason}/${gameType}`;
        const response = await fetch(url);

        if (!response.ok) {
            return null;
        }

        const data = await response.json();

        if (!data || !data.gameLog || data.gameLog.length === 0) {
            return null;
        }

        // Get last 10 games (or fewer if they haven't played 10 yet)
        const last10Games = data.gameLog.slice(-10);

        if (position === 'G') {
            // Goalie stats
            const gamesPlayed = last10Games.length;
            const wins = last10Games.filter(g => g.decision === 'W').length;
            const losses = last10Games.filter(g => g.decision === 'L').length;
            const otLosses = last10Games.filter(g => g.decision === 'O').length;
            const shutouts = last10Games.reduce((sum, g) => sum + (g.shutouts || 0), 0);
            const totalShotsAgainst = last10Games.reduce((sum, g) => sum + (g.shotsAgainst || 0), 0);
            const totalGoalsAgainst = last10Games.reduce((sum, g) => sum + (g.goalsAgainst || 0), 0);
            const totalSaves = last10Games.reduce((sum, g) => sum + (g.saves || 0), 0);
            const savePct = totalShotsAgainst > 0 ? (totalSaves / totalShotsAgainst) : 0;
            const gaa = gamesPlayed > 0 ? (totalGoalsAgainst / gamesPlayed) : 0;

            return {
                gamesPlayed,
                wins,
                losses,
                otLosses,
                shutouts,
                savePct,
                gaa,
                totalShotsAgainst,
                totalGoalsAgainst
            };
        } else {
            // Skater stats
            const gamesPlayed = last10Games.length;
            const goals = last10Games.reduce((sum, g) => sum + (g.goals || 0), 0);
            const assists = last10Games.reduce((sum, g) => sum + (g.assists || 0), 0);
            const points = last10Games.reduce((sum, g) => sum + (g.points || 0), 0);
            const plusMinus = last10Games.reduce((sum, g) => sum + (g.plusMinus || 0), 0);
            const shots = last10Games.reduce((sum, g) => sum + (g.shots || 0), 0);
            const powerPlayPoints = last10Games.reduce((sum, g) => sum + (g.powerPlayPoints || 0), 0);
            const shorthandedPoints = last10Games.reduce((sum, g) => sum + (g.shorthandedPoints || 0), 0);

            return {
                gamesPlayed,
                goals,
                assists,
                points,
                plusMinus,
                shots,
                powerPlayPoints,
                shorthandedPoints
            };
        }
    } catch (error) {
        console.error(`Error fetching last 10 games for player ${playerId}:`, error.message);
        return null;
    }
}

// Route to get hot players based on last 10 games
app.get('/hot-players-last10', async (req, res) => {
    try {
        // Check if cache is valid
        const now = Date.now();
        if (last10GamesCache.data && last10GamesCache.lastUpdated &&
            (now - last10GamesCache.lastUpdated) < CACHE_DURATION) {
            console.log('✅ Returning cached last 10 games hot players');
            return res.json(last10GamesCache.data);
        }

        console.log('📊 Calculating hot players based on last 10 games...');

        const currentSeason = '20252026';

        // Fetch top skaters and goalies from NHL API
        const skatersUrl = `https://api-web.nhle.com/v1/skater-stats-leaders/${currentSeason}/2?limit=200`;
        const goaliesUrl = `https://api-web.nhle.com/v1/goalie-stats-leaders/${currentSeason}/2?limit=50`;

        const [skatersResponse, goaliesResponse] = await Promise.all([
            fetch(skatersUrl),
            fetch(goaliesUrl)
        ]);

        if (!skatersResponse.ok || !goaliesResponse.ok) {
            throw new Error('Failed to fetch player stats from NHL API');
        }

        const skatersData = await skatersResponse.json();
        const goaliesData = await goaliesResponse.json();

        // Process skaters - get last 10 games stats for top 200 (batched to avoid rate-limiting)
        console.log('📊 Processing skaters...');
        const skaterPlayers = (skatersData.points || []).slice(0, 200);
        const skaters = [];
        const SKATER_BATCH = 20;
        for (let i = 0; i < skaterPlayers.length; i += SKATER_BATCH) {
            const batch = skaterPlayers.slice(i, i + SKATER_BATCH);
            const results = await Promise.all(batch.map(async (player) => {
                const last10Stats = await getPlayerLast10Stats(player.playerId, player.position);
                if (!last10Stats || last10Stats.gamesPlayed < 5) return null;
                return {
                    playerId: player.playerId,
                    playerName: `${player.firstName.default} ${player.lastName.default}`,
                    teamAbbrev: player.teamAbbrev,
                    position: player.positionCode,
                    headshot: player.headshot,
                    isRookie: player.rookieFlag === 'Y',
                    ...last10Stats
                };
            }));
            skaters.push(...results.filter(p => p !== null));
            if (i + SKATER_BATCH < skaterPlayers.length) {
                await new Promise(r => setTimeout(r, 150));
            }
        }

        // Separate forwards and defensemen
        const forwards = skaters.filter(p => ['C', 'L', 'R', 'F'].includes(p.position));
        const defensemen = skaters.filter(p => p.position === 'D');
        const rookies = skaters.filter(p => p.isRookie);

        // Sort forwards by points
        forwards.sort((a, b) => b.points - a.points);

        // Sort defensemen by points
        defensemen.sort((a, b) => b.points - a.points);

        // Sort rookies by points
        rookies.sort((a, b) => b.points - a.points);

        // Get top 5 offensive players (forwards)
        const offensive = forwards.slice(0, 5).map(p => ({
            playerId: p.playerId,
            playerName: p.playerName,
            teamAbbrev: p.teamAbbrev,
            position: p.position,
            headshot: p.headshot,
            gamesPlayedTotal: p.gamesPlayed,
            last10Goals: p.goals,
            last10Assists: p.assists,
            last10Points: p.points
        }));

        // Get top rookie
        const rookie = rookies.length > 0 ? {
            playerId: rookies[0].playerId,
            playerName: rookies[0].playerName,
            teamAbbrev: rookies[0].teamAbbrev,
            position: rookies[0].position,
            headshot: rookies[0].headshot,
            gamesPlayedTotal: rookies[0].gamesPlayed,
            last10Goals: rookies[0].goals,
            last10Assists: rookies[0].assists,
            last10Points: rookies[0].points
        } : null;

        // Get top 3 defensemen
        const topDefensemen = defensemen.slice(0, 3).map(p => ({
            playerId: p.playerId,
            playerName: p.playerName,
            teamAbbrev: p.teamAbbrev,
            position: p.position,
            headshot: p.headshot,
            gamesPlayedTotal: p.gamesPlayed,
            last10Goals: p.goals,
            last10Assists: p.assists,
            last10Points: p.points
        }));

        // Process goalies (batched to avoid rate-limiting)
        console.log('📊 Processing goalies...');
        const goaliePlayers = (goaliesData.savePercentage || []).slice(0, 50);
        const goaliesWithStats = [];
        const GOALIE_BATCH = 15;
        for (let i = 0; i < goaliePlayers.length; i += GOALIE_BATCH) {
            const batch = goaliePlayers.slice(i, i + GOALIE_BATCH);
            const results = await Promise.all(batch.map(async (player) => {
                const last10Stats = await getPlayerLast10Stats(player.playerId, 'G');
                if (!last10Stats || last10Stats.gamesPlayed < 3) return null;
                return {
                    playerId: player.playerId,
                    playerName: `${player.firstName.default} ${player.lastName.default}`,
                    teamAbbrev: player.teamAbbrev,
                    position: 'G',
                    headshot: player.headshot,
                    ...last10Stats
                };
            }));
            goaliesWithStats.push(...results.filter(p => p !== null));
            if (i + GOALIE_BATCH < goaliePlayers.length) {
                await new Promise(r => setTimeout(r, 150));
            }
        }

        // Sort goalies by save percentage
        goaliesWithStats.sort((a, b) => b.savePct - a.savePct);

        // Get top 2 goalies
        const topGoalies = goaliesWithStats.slice(0, 2).map(p => ({
            playerId: p.playerId,
            playerName: p.playerName,
            teamAbbrev: p.teamAbbrev,
            position: 'G',
            headshot: p.headshot,
            gamesPlayedTotal: p.gamesPlayed,
            last10Wins: p.wins,
            last10SavePct: (p.savePct * 100).toFixed(1),
            last10GAA: p.gaa.toFixed(2),
            last10Shutouts: p.shutouts
        }));

        const result = {
            offensive,
            rookie,
            defensemen: topDefensemen,
            goalies: topGoalies,
            teams: [] // Team stats can be fetched separately if needed
        };

        // Update cache
        last10GamesCache = {
            lastUpdated: now,
            data: result
        };

        console.log('✅ Hot players calculation complete');
        res.json(result);

    } catch (error) {
        console.error('❌ Error calculating hot players:', error);

        // Fallback to old endpoint if new one fails
        console.log('⚠️ Falling back to cached stats from nhl_filtered_stats.json');

        try {
            const filteredStatsPath = path.join(__dirname, 'nhl_filtered_stats.json');

            if (!fs.existsSync(filteredStatsPath)) {
                return res.json({
                    offensive: [],
                    rookie: null,
                    defensemen: [],
                    goalies: [],
                    teams: []
                });
            }

            const filteredStats = JSON.parse(fs.readFileSync(filteredStatsPath, 'utf-8'));

            // Use old format as fallback
            const offensivePlayers = filteredStats.Top_100_Offensive_Players || [];
            const offensive = offensivePlayers.slice(0, 5).map(p => ({
                playerId: p.playerId,
                playerName: p.skaterFullName,
                teamAbbrev: p.teamAbbrevs,
                position: p.positionCode,
                headshot: `https://assets.nhle.com/mugs/nhl/20252026/${p.teamAbbrevs}/${p.playerId}.png`,
                gamesPlayedTotal: p.gamesPlayed,
                last10Goals: p.goals,
                last10Assists: p.assists,
                last10Points: p.points
            }));

            const rookiePlayers = filteredStats.Top_Rookies || [];
            const validRookies = rookiePlayers.filter(r =>
                r.gamesPlayed > 0 &&
                r.points > 0 &&
                r.positionCode !== 'G'
            );
            const rookie = validRookies.length > 0 ? {
                playerId: validRookies[0].playerId,
                playerName: validRookies[0].skaterFullName,
                teamAbbrev: validRookies[0].teamAbbrevs,
                position: validRookies[0].positionCode,
                headshot: `https://assets.nhle.com/mugs/nhl/20252026/${validRookies[0].teamAbbrevs}/${validRookies[0].playerId}.png`,
                gamesPlayedTotal: validRookies[0].gamesPlayed,
                last10Goals: validRookies[0].goals,
                last10Assists: validRookies[0].assists,
                last10Points: validRookies[0].points
            } : null;

            const defenderPlayers = filteredStats.Top_50_Defenders || [];
            const defensemen = defenderPlayers.slice(0, 3).map(p => ({
                playerId: p.playerId,
                playerName: p.skaterFullName,
                teamAbbrev: p.teamAbbrevs,
                position: p.positionCode,
                headshot: `https://assets.nhle.com/mugs/nhl/20252026/${p.teamAbbrevs}/${p.playerId}.png`,
                gamesPlayedTotal: p.gamesPlayed,
                last10Goals: p.goals,
                last10Assists: p.assists,
                last10Points: p.points
            }));

            const goaliePlayers = filteredStats.Top_50_Goalies || [];
            const goalies = goaliePlayers.slice(0, 2).map(p => ({
                playerId: p.playerId,
                playerName: p.goalieFullName,
                teamAbbrev: p.teamAbbrevs,
                position: 'G',
                headshot: `https://assets.nhle.com/mugs/nhl/20252026/${p.teamAbbrevs}/${p.playerId}.png`,
                gamesPlayedTotal: p.gamesPlayed || 0,
                last10Wins: p.wins || 0,
                last10SavePct: p.savePct ? (p.savePct * 100).toFixed(1) : '0.0',
                last10GAA: p.goalsAgainstAverage ? p.goalsAgainstAverage.toFixed(2) : '0.00',
                last10Shutouts: p.shutouts || 0
            }));

            res.json({
                offensive,
                rookie,
                defensemen,
                goalies,
                teams: []
            });

        } catch (fallbackError) {
            console.error('❌ Fallback also failed:', fallbackError);
            res.status(500).json({ message: 'Error fetching hot players' });
        }
    }
});

// Route to get hot players using cached stats from nhl_filtered_stats.json
app.get('/hot-players', async (req, res) => {
    try {
        // Load cached filtered stats
        const filteredStatsPath = path.join(__dirname, 'nhl_filtered_stats.json');

        if (!fs.existsSync(filteredStatsPath)) {
            console.error('❌ nhl_filtered_stats.json not found');
            return res.json({
                offensive: [],
                rookie: null,
                defensemen: [],
                goalies: [],
                teams: []
            });
        }

        const filteredStats = JSON.parse(fs.readFileSync(filteredStatsPath, 'utf-8'));

        console.log('📊 Loading hot players from cached stats...');

        // Get top 5 offensive players (already sorted by points in the file)
        const offensivePlayers = filteredStats.Top_100_Offensive_Players || [];
        const offensive = offensivePlayers.slice(0, 5).map(p => ({
            playerId: p.playerId,
            playerName: p.skaterFullName,
            teamAbbrev: p.teamAbbrevs,
            position: p.positionCode,
            headshot: `https://assets.nhle.com/mugs/nhl/20252026/${p.teamAbbrevs}/${p.playerId}.png`,
            gamesPlayedTotal: p.gamesPlayed,
            last10Goals: p.goals,
            last10Assists: p.assists,
            last10Points: p.points
        }));

        // Get top rookie (first one with games played > 0)
        const rookiePlayers = filteredStats.Top_Rookies || [];
        const validRookies = rookiePlayers.filter(r =>
            r.gamesPlayed > 0 &&
            r.points > 0 &&
            r.positionCode !== 'G'
        );
        const rookie = validRookies.length > 0 ? {
            playerId: validRookies[0].playerId,
            playerName: validRookies[0].skaterFullName,
            teamAbbrev: validRookies[0].teamAbbrevs,
            position: validRookies[0].positionCode,
            headshot: `https://assets.nhle.com/mugs/nhl/20252026/${validRookies[0].teamAbbrevs}/${validRookies[0].playerId}.png`,
            gamesPlayedTotal: validRookies[0].gamesPlayed,
            last10Goals: validRookies[0].goals,
            last10Assists: validRookies[0].assists,
            last10Points: validRookies[0].points
        } : null;

        // Get top 3 defensemen (already sorted by points in the file)
        const defenderPlayers = filteredStats.Top_50_Defenders || [];
        const defensemen = defenderPlayers.slice(0, 3).map(p => ({
            playerId: p.playerId,
            playerName: p.skaterFullName,
            teamAbbrev: p.teamAbbrevs,
            position: p.positionCode,
            headshot: `https://assets.nhle.com/mugs/nhl/20252026/${p.teamAbbrevs}/${p.playerId}.png`,
            gamesPlayedTotal: p.gamesPlayed,
            last10Goals: p.goals,
            last10Assists: p.assists,
            last10Points: p.points
        }));

        // Get top 2 goalies by save percentage (already sorted in the file)
        const goaliePlayers = filteredStats.Top_50_Goalies || [];
        const goalies = goaliePlayers.slice(0, 2).map(p => ({
            playerId: p.playerId,
            playerName: p.goalieFullName,
            teamAbbrev: p.teamAbbrevs,
            position: 'G',
            headshot: `https://assets.nhle.com/mugs/nhl/20252026/${p.teamAbbrevs}/${p.playerId}.png`,
            gamesPlayedTotal: p.gamesPlayed,
            last10Wins: p.wins,
            last10SavePct: p.savePct
        }));

        // Get top 2 teams by last 10 games record
        const teams = await getTopTeamsLast10();

        console.log(`✅ Hot players loaded: ${offensive.length} offensive, ${defensemen.length} defensemen, ${goalies.length} goalies, ${teams.length} teams`);

        res.json({
            offensive,
            rookie,
            defensemen,
            goalies,
            teams
        });

    } catch (error) {
        console.error('❌ Error fetching hot players:', error);
        res.status(500).json({ message: 'Error fetching hot players' });
    }
});

// ==================== HOT PLAYERS - TIME RANGE (FANTASY POINTS) ====================

// Caches for different time ranges
let last7DaysCache = { lastUpdated: null, data: null };
let last14DaysCache = { lastUpdated: null, data: null };
let last30DaysCache = { lastUpdated: null, data: null };

// Fantasy scoring rules
const FANTASY_SCORING = {
    goal: 3,
    assist: 2,
    shot: 0.5,
    powerPlayGoal: 1,  // Bonus on top of goal
    powerPlayPoint: 0.5,
    shorthandedGoal: 2, // Bonus on top of goal
    shorthandedPoint: 1,
    gameWinningGoal: 1,
    plusMinus: 0.5,
    // Goalie stats
    win: 5,
    shutout: 3,
    save: 0.2,
    goalsAgainst: -1
};

// Generic function to calculate hot players for any time range
async function calculateHotPlayers(days) {
    const currentSeason = '20252026';
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    // Query all games from specified time range
    const result = await db.query(`
        SELECT
            player_id, player_name, position, team_abbrev,
            goals, assists, points, shots, plus_minus,
            power_play_goals, power_play_points,
            shorthanded_goals, shorthanded_points,
            game_winning_goals,
            games_started, decision, saves, shots_against, goals_against, shutouts,
            game_date
        FROM player_game_logs
        WHERE season = $1 AND game_date >= $2
        ORDER BY game_date DESC
    `, [currentSeason, startDateStr]);

    if (result.rows.length === 0) {
        console.log(`⚠️ No games found in last ${days} days`);
        return {
            topPlayers: [],
            forwards: [],
            defensemen: [],
            goalies: [],
            timeRange: `${days} days`,
            message: `No games in last ${days} days. Run: node fetch_game_logs.js`
        };
    }

    console.log(`📊 Found ${result.rows.length} game entries from last ${days} days`);

    // Group games by player and calculate fantasy points
    const playerStats = new Map();

        result.rows.forEach(game => {
            const playerId = game.player_id;

            if (!playerStats.has(playerId)) {
                playerStats.set(playerId, {
                    playerId,
                    playerName: game.player_name,
                    position: game.position,
                    teamAbbrev: game.team_abbrev,
                    gamesPlayed: 0,
                    totalFantasyPoints: 0,
                    goals: 0,
                    assists: 0,
                    points: 0,
                    shots: 0,
                    wins: 0,
                    shutouts: 0,
                    saves: 0,
                    savePct: 0
                });
            }

            const player = playerStats.get(playerId);
            player.gamesPlayed++;

            // Calculate fantasy points for this game
            let fantasyPoints = 0;

            if (game.position === 'G') {
                // Goalie scoring
                fantasyPoints += (game.decision === 'W') ? FANTASY_SCORING.win : 0;
                fantasyPoints += (game.shutouts || 0) * FANTASY_SCORING.shutout;
                fantasyPoints += (game.saves || 0) * FANTASY_SCORING.save;
                fantasyPoints += (game.goals_against || 0) * FANTASY_SCORING.goalsAgainst;

                player.wins += (game.decision === 'W') ? 1 : 0;
                player.shutouts += game.shutouts || 0;
                player.saves += game.saves || 0;
            } else {
                // Skater scoring
                fantasyPoints += (game.goals || 0) * FANTASY_SCORING.goal;
                fantasyPoints += (game.assists || 0) * FANTASY_SCORING.assist;
                fantasyPoints += (game.shots || 0) * FANTASY_SCORING.shot;
                fantasyPoints += (game.plus_minus || 0) * FANTASY_SCORING.plusMinus;
                fantasyPoints += (game.power_play_goals || 0) * FANTASY_SCORING.powerPlayGoal;
                fantasyPoints += (game.power_play_points || 0) * FANTASY_SCORING.powerPlayPoint;
                fantasyPoints += (game.shorthanded_goals || 0) * FANTASY_SCORING.shorthandedGoal;
                fantasyPoints += (game.shorthanded_points || 0) * FANTASY_SCORING.shorthandedPoint;
                fantasyPoints += (game.game_winning_goals || 0) * FANTASY_SCORING.gameWinningGoal;

                player.goals += game.goals || 0;
                player.assists += game.assists || 0;
                player.points += game.points || 0;
                player.shots += game.shots || 0;
            }

            player.totalFantasyPoints += fantasyPoints;
    });

    // Convert to array and filter out players with < 2 games
        const allPlayers = Array.from(playerStats.values())
            .filter(p => p.gamesPlayed >= 2)
            .map(p => {
                // Calculate per-game average
                p.fantasyPointsPerGame = p.totalFantasyPoints / p.gamesPlayed;
                p.headshot = `https://assets.nhle.com/mugs/nhl/20252026/${p.teamAbbrev}/${p.playerId}.png`;
                p.isHot = p.fantasyPointsPerGame >= 10; // Hot if averaging 10+ fantasy pts per game
                return p;
            });

        // Separate by position
        const forwards = allPlayers
            .filter(p => ['C', 'L', 'R', 'F'].includes(p.position))
            .sort((a, b) => b.totalFantasyPoints - a.totalFantasyPoints);

        const defensemen = allPlayers
            .filter(p => p.position === 'D')
            .sort((a, b) => b.totalFantasyPoints - a.totalFantasyPoints);

        const goalies = allPlayers
            .filter(p => p.position === 'G')
            .sort((a, b) => b.totalFantasyPoints - a.totalFantasyPoints);

        // Get top overall (all positions)
        const topPlayers = allPlayers
            .sort((a, b) => b.totalFantasyPoints - a.totalFantasyPoints)
            .slice(0, 10);

    const responseData = {
        topPlayers,
        forwards: forwards.slice(0, 10),
        defensemen: defensemen.slice(0, 10),
        goalies: goalies.slice(0, 10),
        timeRange: `${days} days`,
        totalGames: result.rows.length,
        uniquePlayers: allPlayers.length
    };

    console.log(`✅ Hot players calculated (${days} days): ${topPlayers.length} top, ${forwards.length} forwards, ${defensemen.length} D, ${goalies.length} G`);

    return responseData;
}

// Endpoints for different time ranges
app.get('/hot-players-last7days', async (req, res) => {
    try {
        const now = Date.now();
        if (last7DaysCache.data && last7DaysCache.lastUpdated &&
            (now - last7DaysCache.lastUpdated) < (15 * 60 * 1000)) {
            return res.json(last7DaysCache.data);
        }
        const data = await calculateHotPlayers(7);
        last7DaysCache = { lastUpdated: now, data };
        res.json(data);
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ message: 'Error fetching hot players' });
    }
});

app.get('/hot-players-last14days', async (req, res) => {
    try {
        const now = Date.now();
        if (last14DaysCache.data && last14DaysCache.lastUpdated &&
            (now - last14DaysCache.lastUpdated) < (15 * 60 * 1000)) {
            return res.json(last14DaysCache.data);
        }
        const data = await calculateHotPlayers(14);
        last14DaysCache = { lastUpdated: now, data };
        res.json(data);
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ message: 'Error fetching hot players' });
    }
});

app.get('/hot-players-last30days', async (req, res) => {
    try {
        const now = Date.now();
        if (last30DaysCache.data && last30DaysCache.lastUpdated &&
            (now - last30DaysCache.lastUpdated) < (15 * 60 * 1000)) {
            return res.json(last30DaysCache.data);
        }
        const data = await calculateHotPlayers(30);
        last30DaysCache = { lastUpdated: now, data };
        res.json(data);
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ message: 'Error fetching hot players' });
    }
});

// Helper function to get top teams by win percentage from cached stats
async function getTopTeamsLast10() {
    try {
        const filteredStatsPath = path.join(__dirname, 'nhl_filtered_stats.json');

        if (!fs.existsSync(filteredStatsPath)) {
            console.error('❌ nhl_filtered_stats.json not found');
            return [];
        }

        const filteredStats = JSON.parse(fs.readFileSync(filteredStatsPath, 'utf-8'));
        const teamsData = filteredStats.Teams || [];

        console.log('📊 Loading top teams from cached stats...');

        // Use top teams by win percentage from cached stats
        const topTeams = teamsData.slice(0, 2).map(team => {
            const teamAbbrev = getTeamAbbreviationFromName(team.teamFullName);
            const winPct = team.gamesPlayed > 0 ? team.wins / team.gamesPlayed : 0;

            return {
                teamName: team.teamFullName,
                teamAbbrev: teamAbbrev,
                logo: `teams/${teamAbbrev}.png`,
                last10Games: team.gamesPlayed,
                last10Wins: team.wins,
                last10Losses: team.losses,
                last10OTLosses: team.otLosses,
                last10Points: team.points,
                winPct: winPct
            };
        });

        console.log(`✅ Top teams loaded: ${topTeams.map(t => `${t.teamName} (${t.last10Wins}-${t.last10Losses}-${t.last10OTLosses})`).join(', ')}`);

        return topTeams;
    } catch (error) {
        console.error('Error getting top teams:', error);
        return [];
    }
}

// Route to get active streaks
app.get('/streaks', async (req, res) => {
    try {
        const stats = await loadCurrentStats();

        if (!stats || !stats.players || stats.players.length === 0) {
            return res.json({
                offensiveStreak: null,
                defensiveStreak: null,
                goalieStreak: null,
                teamStreak: null
            });
        }

        // Use current season performance as proxy for streaks
        // Get top performers by points per game
        const offensivePlayers = stats.players
            .filter(p => p.position && ['C', 'L', 'R', 'LW', 'RW'].includes(p.position) && p.gamesPlayed >= 5)
            .sort((a, b) => {
                const ppgA = a.gamesPlayed > 0 ? a.points / a.gamesPlayed : 0;
                const ppgB = b.gamesPlayed > 0 ? b.points / b.gamesPlayed : 0;
                return ppgB - ppgA;
            });

        const defensivePlayers = stats.players
            .filter(p => p.position === 'D' && p.gamesPlayed >= 5)
            .sort((a, b) => {
                const ppgA = a.gamesPlayed > 0 ? a.points / a.gamesPlayed : 0;
                const ppgB = b.gamesPlayed > 0 ? b.points / b.gamesPlayed : 0;
                return ppgB - ppgA;
            });

        const goalies = stats.players
            .filter(p => p.position === 'G' && p.gamesPlayed >= 3 && p.wins > 0)
            .sort((a, b) => b.wins - a.wins);

        const offensiveStreak = offensivePlayers.length > 0 ? {
            playerName: offensivePlayers[0].playerName,
            teamAbbrev: offensivePlayers[0].teamAbbrev,
            streakLength: Math.min(offensivePlayers[0].gamesPlayed, 10)
        } : null;

        const defensiveStreak = defensivePlayers.length > 0 ? {
            playerName: defensivePlayers[0].playerName,
            teamAbbrev: defensivePlayers[0].teamAbbrev,
            streakLength: Math.min(defensivePlayers[0].gamesPlayed, 8)
        } : null;

        const goalieStreak = goalies.length > 0 ? {
            playerName: goalies[0].playerName,
            teamAbbrev: goalies[0].teamAbbrev,
            streakLength: Math.min(goalies[0].wins, 8)
        } : null;

        // Columbus Blue Jackets has 7-game win streak
        const teamStreak = {
            teamName: "Columbus Blue Jackets",
            streakLength: 7
        };

        res.json({
            offensiveStreak,
            defensiveStreak,
            goalieStreak,
            teamStreak
        });

    } catch (error) {
        console.error('❌ Error fetching streaks:', error);
        res.status(500).json({ message: 'Error fetching streaks' });
    }
});

// Helper function to get team abbreviation from full name
function getTeamAbbreviationFromName(teamName) {
    const specialCases = {
        "Florida Panthers": "FLA",
        "Calgary Flames": "CGY",
        "Montréal Canadiens": "MTL",
        "Nashville Predators": "NSH",
        "St. Louis Blues": "STL",
        "Washington Capitals": "WSH",
        "Toronto Maple Leafs": "TOR",
        "Winnipeg Jets": "WPG",
        "Utah Hockey Club": "UTA",
        "Detroit Red Wings": "DET",
        "Boston Bruins": "BOS",
        "Tampa Bay Lightning": "TBL",
        "New York Rangers": "NYR",
        "New York Islanders": "NYI",
        "New Jersey Devils": "NJD",
        "Pittsburgh Penguins": "PIT",
        "Philadelphia Flyers": "PHI",
        "Columbus Blue Jackets": "CBJ",
        "Carolina Hurricanes": "CAR",
        "Buffalo Sabres": "BUF",
        "Ottawa Senators": "OTT",
        "Edmonton Oilers": "EDM",
        "Vancouver Canucks": "VAN",
        "Seattle Kraken": "SEA",
        "Los Angeles Kings": "LAK",
        "San Jose Sharks": "SJS",
        "Anaheim Ducks": "ANA",
        "Vegas Golden Knights": "VGK",
        "Colorado Avalanche": "COL",
        "Arizona Coyotes": "ARI",
        "Minnesota Wild": "MIN",
        "Dallas Stars": "DAL",
        "Chicago Blackhawks": "CHI"
    };

    return specialCases[teamName] || teamName.split(' ')[0].substring(0, 3).toUpperCase();
}

console.log("✅ NHL current stats system initialized");
console.log("✅ NHL team standings system initialized");
console.log("✅ Accueil hot players & streaks system initialized");

// ==================== TRADE SYSTEM ====================

// Load trades data
const loadTrades = async () => {
    if (USE_POSTGRES) {
        try {
            // Get all trades from PostgreSQL and organize by pool
            const allTrades = await db.getAllTrades();
            const tradesData = {};

            // Organize trades by pool name
            allTrades.forEach(trade => {
                const poolName = trade.poolName || trade.pool_name;
                if (!tradesData[poolName]) {
                    tradesData[poolName] = { completed: [], pending: [] };
                }

                if (trade.status === 'completed') {
                    tradesData[poolName].completed.push(trade);
                } else {
                    tradesData[poolName].pending.push(trade);
                }
            });

            return tradesData;
        } catch (error) {
            console.error("❌ Error loading trades from PostgreSQL:", error);
            // Fallback to JSON file
            try {
                if (fs.existsSync(TRADES_FILE)) {
                    const data = fs.readFileSync(TRADES_FILE, 'utf-8');
                    return JSON.parse(data);
                }
            } catch (fileError) {
                return {};
            }
        }
    } else {
        try {
            if (fs.existsSync(TRADES_FILE)) {
                const data = fs.readFileSync(TRADES_FILE, 'utf-8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error("Error loading trades:", error);
        }
    }
    return {};
};

// Save trades data
const saveTrades = async (tradesData) => {
    if (USE_POSTGRES) {
        try {
            // Note: With PostgreSQL, trades are saved individually via createTrade
            // This is mainly for batch operations
            for (const [poolName, poolTrades] of Object.entries(tradesData)) {
                // Delete existing trades for this pool
                await db.deleteTradesByPoolName(poolName);

                // Save pending trades
                if (poolTrades.pending && Array.isArray(poolTrades.pending)) {
                    for (const trade of poolTrades.pending) {
                        const tradeId = await db.createTrade(poolName, trade);
                        await db.updateTradeStatus(tradeId, 'pending');
                    }
                }

                // Save completed trades
                if (poolTrades.completed && Array.isArray(poolTrades.completed)) {
                    for (const trade of poolTrades.completed) {
                        const tradeId = await db.createTrade(poolName, trade);
                        await db.updateTradeStatus(tradeId, 'completed');
                    }
                }
            }
            console.log("✅ Trades saved successfully to PostgreSQL");
        } catch (error) {
            console.error("❌ Error saving trades to PostgreSQL:", error);
            // Fallback to JSON file
            try {
                fs.writeFileSync(TRADES_FILE, JSON.stringify(tradesData, null, 2));
            } catch (fileError) {
                console.error("Error saving trades to JSON:", fileError);
            }
        }
    } else {
        try {
            fs.writeFileSync(TRADES_FILE, JSON.stringify(tradesData, null, 2));
            console.log("✅ Trades saved successfully");
        } catch (error) {
            console.error("Error saving trades:", error);
        }
    }
};

// Helper: Check if team has a specific player
function teamHasPlayer(team, item) {
    const arrays = {
        'offensive': 'offensive',
        'defensive': 'defensive',
        'goalie': 'goalie',
        'rookie': 'rookie',
        'team': 'teams'
    };

    const arrayName = arrays[item.type];
    if (!team[arrayName]) return false;

    const index = team[arrayName].findIndex(p => {
        const name = p.skaterFullName || p.goalieFullName || p.teamFullName || p;
        return name === item.name;
    });

    return index !== -1;
}

// Helper: Invalidate conflicting pending trades after a trade is accepted
function invalidateConflictingTrades(trades, acceptedTrade, draftData) {
    if (!trades.pending || trades.pending.length === 0) return 0;

    const involvedPlayers = new Set();

    // Collect all player names involved in the accepted trade
    acceptedTrade.offering.forEach(item => {
        involvedPlayers.add(item.name);
    });
    acceptedTrade.receiving.forEach(item => {
        involvedPlayers.add(item.name);
    });

    // Find trades that involve any of these players
    const invalidTrades = [];
    trades.pending.forEach(trade => {
        if (trade.draftName !== acceptedTrade.draftName) return; // Different pool

        let hasConflict = false;

        // Check if any player in this trade was involved in the accepted trade
        trade.offering.forEach(item => {
            if (involvedPlayers.has(item.name)) {
                hasConflict = true;
            }
        });
        trade.receiving.forEach(item => {
            if (involvedPlayers.has(item.name)) {
                hasConflict = true;
            }
        });

        if (hasConflict) {
            invalidTrades.push(trade.id);
        }
    });

    // Remove invalid trades
    if (invalidTrades.length > 0) {
        trades.pending = trades.pending.filter(t => !invalidTrades.includes(t.id));
        console.log(`🗑️ Cancelled ${invalidTrades.length} conflicting trade(s) after trade acceptance`);
    }

    return invalidTrades.length;
}

// Helper: Remove item from team
function removeFromTeam(team, item) {
    const arrays = {
        'offensive': 'offensive',
        'defensive': 'defensive',
        'goalie': 'goalie',
        'rookie': 'rookie',
        'team': 'teams'
    };

    const arrayName = arrays[item.type];
    if (!team[arrayName]) return;

    const index = team[arrayName].findIndex(p => {
        const name = p.skaterFullName || p.goalieFullName || p.teamFullName || p;
        return name === item.name;
    });

    if (index !== -1) {
        team[arrayName].splice(index, 1);
    }
}

// Helper: Add item to team
function addToTeam(team, item) {
    const arrays = {
        'offensive': 'offensive',
        'defensive': 'defensive',
        'goalie': 'goalie',
        'rookie': 'rookie',
        'team': 'teams'
    };

    const arrayName = arrays[item.type];
    if (!team[arrayName]) {
        team[arrayName] = [];
    }

    // Add the full player object to preserve stats
    if (item.playerData) {
        team[arrayName].push(item.playerData);
    } else {
        // Fallback for simple strings (team names, etc.)
        team[arrayName].push(item.name);
    }
}

// Get completed trades for a draft
app.get('/trades/:draftName', async (req, res) => {
    try {
        const { draftName } = req.params;
        const trades = await loadTrades();
        const draftTrades = (trades.completed || []).filter(t => t.draftName === draftName);
        res.json(draftTrades);
    } catch (error) {
        console.error("Error loading trades:", error);
        res.status(500).json({ message: "Error loading trades" });
    }
});

// Get all trades (for completed trades history)
app.get('/trades/all', async (req, res) => {
    try {
        const tradesResult = await db.query(
            'SELECT id, pool_name, trade_data, status, created_at FROM trades ORDER BY created_at DESC'
        );

        const allTrades = tradesResult.rows.map(row => ({
            id: row.id,
            draftName: row.pool_name,
            ...row.trade_data,
            status: row.status
        }));

        res.json(allTrades);
    } catch (error) {
        console.error("Error loading all trades:", error);
        res.status(500).json({ message: "Error loading trades" });
    }
});

// Get completed trades for a user
app.get('/trades/completed/:username', async (req, res) => {
    try {
        const { username } = req.params;

        console.log(`Fetching completed trades for user: ${username}`);

        // Get all completed trades from PostgreSQL
        const tradesResult = await db.query(
            'SELECT id, pool_name, trade_data, created_at FROM trades WHERE status = $1 ORDER BY created_at DESC',
            ['completed']
        );

        console.log(`Total completed trades in DB: ${tradesResult.rows.length}`);

        const userCompletedTrades = [];

        // Filter trades where user is involved (member of fromTeam or toTeam)
        for (const row of tradesResult.rows) {
            const tradeData = row.trade_data;
            const poolName = row.pool_name;

            // Get pool data
            const poolResult = await db.query('SELECT pool_data FROM pools WHERE pool_name = $1', [poolName]);
            if (poolResult.rows.length === 0) {
                console.log(`Pool ${poolName} not found`);
                continue;
            }

            const pool = poolResult.rows[0].pool_data;
            const fromTeam = pool.teams[tradeData.fromTeam];
            const toTeam = pool.teams[tradeData.toTeam];

            if (!fromTeam || !toTeam) {
                console.log(`Teams not found in pool ${poolName}`);
                continue;
            }

            // Check if user is member of either team
            const isInFromTeam = fromTeam.members && fromTeam.members.includes(username);
            const isInToTeam = toTeam.members && toTeam.members.includes(username);

            if (isInFromTeam || isInToTeam) {
                userCompletedTrades.push({
                    id: row.id,
                    draftName: poolName,
                    fromTeam: tradeData.fromTeam,
                    toTeam: tradeData.toTeam,
                    offering: tradeData.offering,
                    receiving: tradeData.receiving,
                    status: 'completed',
                    date: tradeData.date,
                    completedDate: tradeData.completedDate
                });
            }
        }

        console.log(`Found ${userCompletedTrades.length} completed trades for ${username}`);
        res.json(userCompletedTrades);
    } catch (error) {
        console.error("Error loading completed trades:", error);
        res.status(500).json({ message: "Error loading completed trades" });
    }
});

// Get pending trades for a user
app.get('/trades/pending/:username', async (req, res) => {
    try {
        const { username } = req.params;

        console.log(`Checking pending trades for user: ${username}`);

        // Get all pending trades from PostgreSQL
        const tradesResult = await db.query(
            'SELECT id, pool_name, trade_data, created_at FROM trades WHERE status = $1',
            ['pending']
        );

        console.log(`Total pending trades in DB: ${tradesResult.rows.length}`);

        // Filter trades where user is the recipient
        const userPendingTrades = [];

        for (const row of tradesResult.rows) {
            const tradeData = row.trade_data;
            const poolName = row.pool_name;

            // Get pool data
            const poolResult = await db.query('SELECT pool_data FROM pools WHERE pool_name = $1', [poolName]);
            if (poolResult.rows.length === 0) {
                console.log(`Pool ${poolName} not found`);
                continue;
            }

            const pool = poolResult.rows[0].pool_data;
            const targetTeam = pool.teams[tradeData.toTeam];

            if (!targetTeam) {
                console.log(`Team ${tradeData.toTeam} not found in pool ${poolName}`);
                continue;
            }

            const isRecipient = targetTeam.members && targetTeam.members.includes(username);
            console.log(`Trade ${row.id}: ${tradeData.fromTeam} → ${tradeData.toTeam}, User is recipient: ${isRecipient}`);

            if (isRecipient) {
                userPendingTrades.push({
                    id: row.id,
                    draftName: poolName,
                    fromTeam: tradeData.fromTeam,
                    toTeam: tradeData.toTeam,
                    offering: tradeData.offering,
                    receiving: tradeData.receiving,
                    status: 'pending',
                    date: tradeData.date
                });
            }
        }

        console.log(`Found ${userPendingTrades.length} pending trades for ${username}`);
        res.json(userPendingTrades);
    } catch (error) {
        console.error("Error loading pending trades:", error);
        res.status(500).json({ message: "Error loading pending trades" });
    }
});

// Send a trade proposal
app.post('/trade/propose', async (req, res) => {
    try {
        const { draftName, fromTeam, toTeam, offering, receiving } = req.body;

        if (!draftName || !fromTeam || !toTeam || !offering || !receiving) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        // ============================================================
        // VALIDATION: 1-for-1 Position-Locked Trades ONLY
        // ============================================================

        // Validate exactly 1 player offered and 1 received
        if (offering.length !== 1 || receiving.length !== 1) {
            return res.status(400).json({
                message: "❌ Échanges 1-pour-1 seulement! Vous devez échanger exactement 1 joueur contre 1 joueur."
            });
        }

        const offeredPlayer = offering[0];
        const receivedPlayer = receiving[0];

        // Validate position/type match
        if (offeredPlayer.type !== receivedPlayer.type) {
            return res.status(400).json({
                message: `❌ Position invalide! Les joueurs doivent être de la même catégorie.\nVous offrez: ${getPositionLabel(offeredPlayer.type)}\nVous recevez: ${getPositionLabel(receivedPlayer.type)}\n\nÉchanges autorisés:\n• Attaquant ↔ Attaquant\n• Défenseur ↔ Défenseur\n• Gardien ↔ Gardien`
            });
        }

        // Get pool data from PostgreSQL
        const poolResult = await db.query('SELECT pool_data FROM pools WHERE pool_name = $1', [draftName]);
        if (poolResult.rows.length === 0) {
            return res.status(404).json({ message: "Pool not found" });
        }

        const pool = poolResult.rows[0].pool_data;
        if (pool.allowTrades === false) {
            return res.status(403).json({ message: "Les échanges ne sont pas autorisés dans ce pool" });
        }

        // VALIDATION: Check if fromTeam exists and has offered player
        const fromTeamData = pool.teams[fromTeam];
        if (!fromTeamData) {
            return res.status(404).json({ message: "Votre équipe n'a pas été trouvée" });
        }

        const missingPlayers = [];
        offering.forEach(item => {
            if (!teamHasPlayer(fromTeamData, item)) {
                missingPlayers.push(item.name);
            }
        });

        if (missingPlayers.length > 0) {
            return res.status(400).json({
                message: `Vous ne possédez pas: ${missingPlayers.join(', ')}`
            });
        }

        // Insert trade into PostgreSQL
        const tradeData = {
            fromTeam,
            toTeam,
            offering,
            receiving,
            date: new Date().toISOString()
        };

        const insertResult = await db.query(
            `INSERT INTO trades (pool_name, trade_data, status, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             RETURNING id`,
            [draftName, JSON.stringify(tradeData), 'pending']
        );

        const tradeId = insertResult.rows[0].id;

        console.log(`📤 Trade proposed: ${fromTeam} → ${toTeam} (${offeredPlayer.type}: ${offeredPlayer.name} ↔ ${receivedPlayer.name})`);

        res.json({ message: "Trade proposal sent successfully", tradeId });
    } catch (error) {
        console.error("Error sending trade proposal:", error);
        res.status(500).json({ message: "Error sending trade proposal" });
    }
});

// Helper function to get position label for error messages
function getPositionLabel(type) {
    const labels = {
        'offensive': 'Attaquant',
        'defensive': 'Défenseur',
        'goalie': 'Gardien',
        'rookie': 'Rookie',
        'team': 'Équipe NHL'
    };
    return labels[type] || type;
}

// Accept a trade
app.post('/trade/accept', async (req, res) => {
    try {
        const { tradeId } = req.body;
        console.log(`Accepting trade ID: ${tradeId}`);

        // Get trade from PostgreSQL
        const tradeResult = await db.query(
            'SELECT id, pool_name, trade_data, status FROM trades WHERE id = $1',
            [tradeId]
        );

        if (tradeResult.rows.length === 0) {
            return res.status(404).json({ message: "Trade not found" });
        }

        const tradeRow = tradeResult.rows[0];
        if (tradeRow.status !== 'pending') {
            return res.status(400).json({ message: "Trade is no longer pending" });
        }

        const trade = tradeRow.trade_data;
        const poolName = tradeRow.pool_name;

        // Get pool data
        const poolResult = await db.query('SELECT pool_data FROM pools WHERE pool_name = $1', [poolName]);
        if (poolResult.rows.length === 0) {
            return res.status(404).json({ message: "Pool not found" });
        }

        const pool = poolResult.rows[0].pool_data;

        // Check if pool allows trades
        if (pool.allowTrades === false) {
            return res.status(403).json({ message: "Les échanges ne sont pas autorisés dans ce pool" });
        }

        const fromTeam = pool.teams[trade.fromTeam];
        const toTeam = pool.teams[trade.toTeam];

        if (!fromTeam || !toTeam) {
            return res.status(404).json({ message: "Teams not found" });
        }

        // VALIDATION: Check if fromTeam still has all offered players
        const fromMissingPlayers = [];
        trade.offering.forEach(item => {
            if (!teamHasPlayer(fromTeam, item)) {
                fromMissingPlayers.push(item.name);
            }
        });

        if (fromMissingPlayers.length > 0) {
            return res.status(400).json({
                message: `${trade.fromTeam} no longer has: ${fromMissingPlayers.join(', ')}`
            });
        }

        // VALIDATION: Check if toTeam still has all receiving players
        const toMissingPlayers = [];
        trade.receiving.forEach(item => {
            if (!teamHasPlayer(toTeam, item)) {
                toMissingPlayers.push(item.name);
            }
        });

        if (toMissingPlayers.length > 0) {
            return res.status(400).json({
                message: `${trade.toTeam} no longer has: ${toMissingPlayers.join(', ')}`
            });
        }

        // EXECUTE TRADE: Swap players between teams
        trade.offering.forEach(item => {
            removeFromTeam(fromTeam, item);
            addToTeam(toTeam, item);
        });

        trade.receiving.forEach(item => {
            removeFromTeam(toTeam, item);
            addToTeam(fromTeam, item);
        });

        // Update pool in PostgreSQL
        await db.query(
            'UPDATE pools SET pool_data = $1, updated_at = NOW() WHERE pool_name = $2',
            [JSON.stringify(pool), poolName]
        );

        // Mark trade as completed in PostgreSQL
        const updatedTradeData = {
            ...trade,
            status: 'accepted',
            completedDate: new Date().toISOString()
        };

        await db.query(
            'UPDATE trades SET trade_data = $1, status = $2, updated_at = NOW() WHERE id = $3',
            [JSON.stringify(updatedTradeData), 'completed', tradeId]
        );

        // Cancel conflicting trades
        const conflictingTrades = await db.query(
            `SELECT id, trade_data FROM trades
             WHERE pool_name = $1 AND status = 'pending' AND id != $2`,
            [poolName, tradeId]
        );

        let cancelledCount = 0;
        for (const conflictRow of conflictingTrades.rows) {
            const conflictTrade = conflictRow.trade_data;

            // Check if any players in this trade were involved in the accepted trade
            const involvesOfferedPlayers = trade.offering.some(p =>
                conflictTrade.offering.some(cp => cp.name === p.name) ||
                conflictTrade.receiving.some(cp => cp.name === p.name)
            );

            const involvesReceivedPlayers = trade.receiving.some(p =>
                conflictTrade.offering.some(cp => cp.name === p.name) ||
                conflictTrade.receiving.some(cp => cp.name === p.name)
            );

            if (involvesOfferedPlayers || involvesReceivedPlayers) {
                await db.query(
                    'UPDATE trades SET status = $1, updated_at = NOW() WHERE id = $2',
                    ['cancelled', conflictRow.id]
                );
                cancelledCount++;
            }
        }

        console.log(`✅ Trade accepted: ${trade.fromTeam} ↔ ${trade.toTeam} (${cancelledCount} conflicting trades cancelled)`);

        res.json({
            message: "Trade accepted successfully",
            cancelledConflictingTrades: cancelledCount
        });
    } catch (error) {
        console.error("Error accepting trade:", error);
        res.status(500).json({ message: "Error accepting trade" });
    }
});

// Decline a trade
app.post('/trade/decline', async (req, res) => {
    try {
        const { tradeId } = req.body;

        // Update trade status to declined in PostgreSQL
        const result = await db.query(
            'UPDATE trades SET status = $1, updated_at = NOW() WHERE id = $2 AND status = $3',
            ['declined', tradeId, 'pending']
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: "Trade not found or already processed" });
        }

        console.log(`❌ Trade declined: ${tradeId}`);
        res.json({ message: "Trade declined successfully" });
    } catch (error) {
        console.error("Error declining trade:", error);
        res.status(500).json({ message: "Error declining trade" });
    }
});

// ✅ H2H: Finalize current week and advance to next week
app.post('/h2h/finalize-week', async (req, res) => {
    try {
        const { poolName } = req.body;

        if (!poolName) {
            return res.status(400).json({ message: "Pool name required" });
        }

        let draftData = await loadDraftData();
        const clan = draftData[poolName];

        if (!clan) {
            return res.status(404).json({ message: "Pool not found" });
        }

        if (clan.poolMode !== 'head-to-head' || !clan.h2hData) {
            return res.status(400).json({ message: "Pool is not in Head-to-Head mode" });
        }

        const currentWeek = clan.h2hData.currentWeek;
        const weekMatchups = clan.h2hData.matchups[currentWeek - 1];

        if (!weekMatchups || weekMatchups.length === 0) {
            return res.status(400).json({ message: "No matchups found for current week" });
        }

        // Calculate week date window
        const weekStart = new Date(clan.h2hData.weekStart);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        console.log(`📅 Finalizing Week ${currentWeek}: ${weekStart.toISOString().split('T')[0]} to ${weekEnd.toISOString().split('T')[0]}`);

        // Calculate points using date-range (true weekly scoring)
        for (const matchup of weekMatchups) {
            // Try date-range scoring first, fall back to season stats
            let t1pts = await getTeamPointsForDateRange(clan.teams[matchup.team1], weekStart, weekEnd);
            let t2pts = await getTeamPointsForDateRange(clan.teams[matchup.team2], weekStart, weekEnd);

            if (t1pts === null || t2pts === null) {
                console.log(`⚠️ Falling back to season stats for Week ${currentWeek}`);
                const currentStats = await loadCurrentStats();
                if (t1pts === null) t1pts = getTeamWeeklyPoints(clan.teams[matchup.team1], currentStats);
                if (t2pts === null) t2pts = getTeamWeeklyPoints(clan.teams[matchup.team2], currentStats);
            }

            matchup.team1Points = t1pts;
            matchup.team2Points = t2pts;
            matchup.weekNumber = currentWeek;

            // Defensive: ensure standings entries exist
            ensureStandingsEntry(clan.h2hData.standings, matchup.team1);
            ensureStandingsEntry(clan.h2hData.standings, matchup.team2);

            // Determine winner
            if (matchup.team1Points > matchup.team2Points) {
                matchup.winner = matchup.team1;
                clan.h2hData.standings[matchup.team1].wins++;
                clan.h2hData.standings[matchup.team2].losses++;
            } else if (matchup.team2Points > matchup.team1Points) {
                matchup.winner = matchup.team2;
                clan.h2hData.standings[matchup.team2].wins++;
                clan.h2hData.standings[matchup.team1].losses++;
            } else {
                matchup.winner = 'tie';
                clan.h2hData.standings[matchup.team1].ties++;
                clan.h2hData.standings[matchup.team2].ties++;
            }

            // Update points for/against
            clan.h2hData.standings[matchup.team1].pointsFor += matchup.team1Points;
            clan.h2hData.standings[matchup.team1].pointsAgainst += matchup.team2Points;
            clan.h2hData.standings[matchup.team2].pointsFor += matchup.team2Points;
            clan.h2hData.standings[matchup.team2].pointsAgainst += matchup.team1Points;
        }

        // Move completed week to history
        if (!clan.h2hData.matchupHistory) clan.h2hData.matchupHistory = [];
        clan.h2hData.matchupHistory.push({
            weekNumber: currentWeek,
            weekStart: weekStart.toISOString(),
            weekEnd: weekEnd.toISOString(),
            matchups: weekMatchups,
            completedDate: new Date().toISOString()
        });

        // Advance to next week
        clan.h2hData.currentWeek++;

        // Generate new matchups for next week
        const activeTeams = Object.entries(clan.teams)
            .filter(([_, teamData]) => teamData.members && teamData.members.length > 0)
            .map(([teamName, _]) => ({ name: teamName }));

        // Pass all previous matchups for better rotation
        const nextWeekMatchups = generateWeeklyMatchups(activeTeams, clan.h2hData.matchups);

        clan.h2hData.matchups.push(
            nextWeekMatchups.map(m => ({ ...m, weekNumber: clan.h2hData.currentWeek }))
        );

        // Update week start date (add 7 days)
        clan.h2hData.weekStart = weekEnd.toISOString();

        // Save updated data
        await saveDraftData(draftData);

        // Emit socket event to update all clients
        io.emit('h2hWeekFinalized', { poolName, newWeek: clan.h2hData.currentWeek });

        console.log(`✅ H2H Week ${currentWeek} finalized for pool: ${poolName}`);
        console.log(`📅 Advanced to Week ${clan.h2hData.currentWeek}`);

        res.json({
            message: `Week ${currentWeek} finalized successfully`,
            previousWeek: currentWeek,
            currentWeek: clan.h2hData.currentWeek,
            results: weekMatchups,
            standings: clan.h2hData.standings
        });

    } catch (error) {
        console.error("❌ Error finalizing H2H week:", error);
        res.status(500).json({ message: "Error finalizing week" });
    }
});

// ✅ H2H: Get current or upcoming week scores for a pool
app.get('/h2h/current-week-scores', async (req, res) => {
    try {
        const { poolName } = req.query;

        if (!poolName) {
            return res.status(400).json({ message: "poolName query param required" });
        }

        const draftData = await loadDraftData();
        const clan = draftData[poolName];

        if (!clan || clan.poolMode !== 'head-to-head' || !clan.h2hData) {
            return res.status(400).json({ message: "Pool not found or not H2H mode" });
        }

        const currentWeek = clan.h2hData.currentWeek;
        const weekMatchups = clan.h2hData.matchups[currentWeek - 1];

        if (!weekMatchups || weekMatchups.length === 0) {
            // Auto-repair: if the draft is done and teams have rosters, generate matchups now
            const activeTeams = Object.entries(clan.teams)
                .filter(([_, td]) => td.members && td.members.length > 0 &&
                    ((td.offensive || []).length + (td.defensive || []).length + (td.goalie || []).length) > 0)
                .map(([teamName, td]) => ({ name: teamName, members: td.members }));

            if (activeTeams.length >= 2 && activeTeams.length % 2 === 0) {
                console.log(`🔧 Auto-generating matchups for pool ${poolName} (${activeTeams.length} teams)`);

                const previousMatchups = clan.h2hData.matchups || [];
                const newMatchups = generateWeeklyMatchups(activeTeams, previousMatchups);

                if (newMatchups.length > 0) {
                    // Reset weekStart to current week's Monday
                    const now = new Date();
                    const monday = new Date(now);
                    const dayOfWeek = now.getDay();
                    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
                    monday.setDate(now.getDate() + daysToMonday);
                    monday.setHours(0, 0, 0, 0);

                    clan.h2hData.weekStart = monday.toISOString();
                    clan.h2hData.currentWeek = currentWeek;
                    clan.h2hData.matchups[currentWeek - 1] = newMatchups.map(m => ({ ...m, weekNumber: currentWeek }));

                    // Ensure standings entries exist
                    if (!clan.h2hData.standings) clan.h2hData.standings = {};
                    activeTeams.forEach(t => ensureStandingsEntry(clan.h2hData.standings, t.name));

                    const draftData2 = await loadDraftData();
                    draftData2[poolName] = clan;
                    await saveDraftData(draftData2);

                    console.log(`✅ Auto-generated ${newMatchups.length} matchups for week ${currentWeek}, weekStart: ${monday.toISOString()}`);

                    // Fall through to normal response below with new weekMatchups
                    const weekEnd2 = new Date(monday);
                    weekEnd2.setDate(weekEnd2.getDate() + 7);
                    const now2 = new Date();
                    const weekStatus2 = now2 < monday ? 'upcoming' : now2 >= weekEnd2 ? 'completed' : 'ongoing';
                    const displayMatchups2 = newMatchups.map(m => ({
                        team1: m.team1, team2: m.team2, team1Points: 0, team2Points: 0
                    }));
                    return res.json({
                        currentWeek,
                        weekStart: monday.toISOString(),
                        weekEnd: weekEnd2.toISOString(),
                        weekStatus: weekStatus2,
                        matchups: displayMatchups2,
                        standings: clan.h2hData.standings,
                        matchupHistory: clan.h2hData.matchupHistory || []
                    });
                }
            }

            return res.json({
                currentWeek,
                matchups: [],
                weekStart: clan.h2hData.weekStart,
                weekEnd: clan.h2hData.weekStart ? new Date(new Date(clan.h2hData.weekStart).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() : null,
                weekStatus: activeTeams.length < 2 ? 'awaiting_draft_completion' : 'no_matchups'
            });
        }

        // Check if draft has completed and weekStart is set
        if (!clan.h2hData.weekStart) {
            return res.json({
                currentWeek,
                matchups: weekMatchups.map(m => ({
                    team1: m.team1,
                    team2: m.team2,
                    team1Points: 0,
                    team2Points: 0
                })),
                weekStart: null,
                weekEnd: null,
                weekStatus: 'awaiting_draft_completion'
            });
        }

        const weekStart = new Date(clan.h2hData.weekStart);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);
        const now = new Date();

        // Determine week status
        let weekStatus = 'ongoing'; // Default
        let displayMatchups = [];

        if (now < weekStart) {
            // UPCOMING: Season hasn't started yet or this week is in the future
            weekStatus = 'upcoming';
            for (const matchup of weekMatchups) {
                const t1players = await getTeamPlayerBreakdownForDateRange(clan.teams[matchup.team1], weekStart, weekEnd);
                const t2players = await getTeamPlayerBreakdownForDateRange(clan.teams[matchup.team2], weekStart, weekEnd);
                displayMatchups.push({
                    team1: matchup.team1, team2: matchup.team2,
                    team1Points: 0, team2Points: 0,
                    team1Players: t1players, team2Players: t2players
                });
            }
        } else if (now >= weekEnd) {
            // COMPLETED: Week has ended
            weekStatus = 'completed';
            for (const matchup of weekMatchups) {
                const t1players = await getTeamPlayerBreakdownForDateRange(clan.teams[matchup.team1], weekStart, weekEnd);
                const t2players = await getTeamPlayerBreakdownForDateRange(clan.teams[matchup.team2], weekStart, weekEnd);
                let t1pts = t1players.reduce((s, p) => s + p.fantasyPoints, 0);
                let t2pts = t2players.reduce((s, p) => s + p.fantasyPoints, 0);
                if (t1pts === 0 && t2pts === 0) {
                    t1pts = matchup.team1Points || 0;
                    t2pts = matchup.team2Points || 0;
                }
                t1pts = Math.round(t1pts * 10) / 10;
                t2pts = Math.round(t2pts * 10) / 10;
                displayMatchups.push({
                    team1: matchup.team1, team2: matchup.team2,
                    team1Points: t1pts, team2Points: t2pts,
                    team1Players: t1players, team2Players: t2players,
                    winner: matchup.winner
                });
            }
        } else {
            // ONGOING: Live scoring from weekStart to now
            weekStatus = 'ongoing';
            for (const matchup of weekMatchups) {
                const t1players = await getTeamPlayerBreakdownForDateRange(clan.teams[matchup.team1], weekStart, now);
                const t2players = await getTeamPlayerBreakdownForDateRange(clan.teams[matchup.team2], weekStart, now);
                const t1pts = Math.round(t1players.reduce((s, p) => s + p.fantasyPoints, 0) * 10) / 10;
                const t2pts = Math.round(t2players.reduce((s, p) => s + p.fantasyPoints, 0) * 10) / 10;
                displayMatchups.push({
                    team1: matchup.team1, team2: matchup.team2,
                    team1Points: t1pts, team2Points: t2pts,
                    team1Players: t1players, team2Players: t2players
                });
            }
        }

        res.json({
            currentWeek,
            weekStart: weekStart.toISOString(),
            weekEnd: weekEnd.toISOString(),
            weekStatus, // 'upcoming', 'ongoing', or 'completed'
            matchups: displayMatchups,
            standings: clan.h2hData.standings,
            matchupHistory: clan.h2hData.matchupHistory || []
        });

    } catch (error) {
        console.error("❌ Error fetching H2H current week scores:", error);
        res.status(500).json({ message: "Error fetching scores" });
    }
});

// ✅ H2H: Get today's player stats for each matchup
app.get('/h2h/today-scores', async (req, res) => {
    try {
        const { poolName } = req.query;
        if (!poolName) return res.status(400).json({ message: "poolName required" });

        const draftData = await loadDraftData();
        const clan = draftData[poolName];
        if (!clan || clan.poolMode !== 'head-to-head' || !clan.h2hData) {
            return res.status(400).json({ message: "Pool not found or not H2H" });
        }

        const currentWeek = clan.h2hData.currentWeek;
        const weekMatchups = clan.h2hData.matchups[currentWeek - 1];
        if (!weekMatchups || weekMatchups.length === 0) {
            return res.json({ currentWeek, matchups: [], weekStatus: 'no_matchups' });
        }

        // Today: midnight to now
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const now = new Date();

        const displayMatchups = [];
        for (const matchup of weekMatchups) {
            const t1players = await getTeamPlayerBreakdownForDateRange(clan.teams[matchup.team1], todayStart, now);
            const t2players = await getTeamPlayerBreakdownForDateRange(clan.teams[matchup.team2], todayStart, now);
            const t1pts = Math.round(t1players.reduce((s, p) => s + p.fantasyPoints, 0) * 10) / 10;
            const t2pts = Math.round(t2players.reduce((s, p) => s + p.fantasyPoints, 0) * 10) / 10;
            displayMatchups.push({
                team1: matchup.team1, team2: matchup.team2,
                team1Points: t1pts, team2Points: t2pts,
                team1Players: t1players, team2Players: t2players
            });
        }

        res.json({
            currentWeek,
            date: todayStart.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' }),
            matchups: displayMatchups,
            standings: clan.h2hData.standings
        });
    } catch (err) {
        console.error("❌ Error fetching today scores:", err);
        res.status(500).json({ message: "Error fetching today scores" });
    }
});

console.log("✅ Trade system initialized");

// ✅ Auto-check and finalize completed H2H weeks
async function checkAndFinalizeCompletedWeeks() {
    try {
        const draftData = await loadDraftData();
        let updatedAnyPool = false;

        for (const [poolName, clan] of Object.entries(draftData)) {
            // Skip non-H2H pools
            if (clan.poolMode !== 'head-to-head' || !clan.h2hData) {
                continue;
            }

            // Skip pools where draft hasn't completed yet
            if (!clan.h2hData.weekStart) {
                continue;
            }

            const weekStart = new Date(clan.h2hData.weekStart);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 7);

            const now = new Date();

            // Check if current week has ended
            if (now >= weekEnd) {
                console.log(`🔔 Auto-finalizing Week ${clan.h2hData.currentWeek} for pool: ${poolName}`);

                const currentWeek = clan.h2hData.currentWeek;
                const weekMatchups = clan.h2hData.matchups[currentWeek - 1];

                if (!weekMatchups || weekMatchups.length === 0) {
                    console.log(`⚠️ No matchups found for Week ${currentWeek}, skipping...`);
                    continue;
                }

                // Calculate points using date-range (true weekly scoring)
                for (const matchup of weekMatchups) {
                    let t1pts = await getTeamPointsForDateRange(clan.teams[matchup.team1], weekStart, weekEnd);
                    let t2pts = await getTeamPointsForDateRange(clan.teams[matchup.team2], weekStart, weekEnd);

                    if (t1pts === null || t2pts === null) {
                        console.log(`⚠️ Falling back to season stats for auto-finalize Week ${currentWeek}`);
                        const currentStats = await loadCurrentStats();
                        if (t1pts === null) t1pts = getTeamWeeklyPoints(clan.teams[matchup.team1], currentStats);
                        if (t2pts === null) t2pts = getTeamWeeklyPoints(clan.teams[matchup.team2], currentStats);
                    }

                    matchup.team1Points = t1pts;
                    matchup.team2Points = t2pts;
                    matchup.weekNumber = currentWeek;

                    // Defensive: ensure standings entries exist
                    ensureStandingsEntry(clan.h2hData.standings, matchup.team1);
                    ensureStandingsEntry(clan.h2hData.standings, matchup.team2);

                    // Determine winner
                    if (matchup.team1Points > matchup.team2Points) {
                        matchup.winner = matchup.team1;
                        clan.h2hData.standings[matchup.team1].wins++;
                        clan.h2hData.standings[matchup.team2].losses++;
                    } else if (matchup.team2Points > matchup.team1Points) {
                        matchup.winner = matchup.team2;
                        clan.h2hData.standings[matchup.team2].wins++;
                        clan.h2hData.standings[matchup.team1].losses++;
                    } else {
                        matchup.winner = 'tie';
                        clan.h2hData.standings[matchup.team1].ties++;
                        clan.h2hData.standings[matchup.team2].ties++;
                    }

                    // Update points for/against
                    clan.h2hData.standings[matchup.team1].pointsFor += matchup.team1Points;
                    clan.h2hData.standings[matchup.team1].pointsAgainst += matchup.team2Points;
                    clan.h2hData.standings[matchup.team2].pointsFor += matchup.team2Points;
                    clan.h2hData.standings[matchup.team2].pointsAgainst += matchup.team1Points;
                }

                // Move to history
                if (!clan.h2hData.matchupHistory) clan.h2hData.matchupHistory = [];
                clan.h2hData.matchupHistory.push({
                    weekNumber: currentWeek,
                    weekStart: weekStart.toISOString(),
                    weekEnd: weekEnd.toISOString(),
                    matchups: weekMatchups,
                    completedDate: new Date().toISOString()
                });

                // Advance to next week
                clan.h2hData.currentWeek++;

                // Generate new matchups
                const activeTeams = Object.entries(clan.teams)
                    .filter(([_, teamData]) => teamData.members && teamData.members.length > 0)
                    .map(([teamName, _]) => ({ name: teamName }));

                // Pass all previous matchups for better rotation
                const nextWeekMatchups = generateWeeklyMatchups(activeTeams, clan.h2hData.matchups);
                clan.h2hData.matchups.push(
                    nextWeekMatchups.map(m => ({ ...m, weekNumber: clan.h2hData.currentWeek }))
                );

                // Update week start
                clan.h2hData.weekStart = weekEnd.toISOString();

                console.log(`✅ Week ${currentWeek} finalized, advanced to Week ${clan.h2hData.currentWeek}`);

                updatedAnyPool = true;
            }
        }

        // Save if any pool was updated
        if (updatedAnyPool) {
            await saveDraftData(draftData);
            io.emit('h2hWeekAutoFinalized');
            console.log("💾 H2H data saved after auto-finalization");
        }

    } catch (error) {
        console.error("❌ Error in auto-check for completed weeks:", error);
    }
}

// Run check on server startup
console.log("🔍 Checking for completed H2H weeks on startup...");
checkAndFinalizeCompletedWeeks();

// Run check every 6 hours (21600000 ms)
const SIX_HOURS = 6 * 60 * 60 * 1000;
setInterval(() => {
    console.log("🔍 Running periodic check for completed H2H weeks...");
    checkAndFinalizeCompletedWeeks();
}, SIX_HOURS);

console.log("✅ H2H auto-finalization scheduler initialized (checks every 6 hours)");

// ===============================================
// DATA INITIALIZATION FOR PRODUCTION
// ===============================================

/**
 * Initialize data files in persistent volume for production
 * Copies initial JSON files to the volume if they don't exist
 */
function initializeDataFiles() {
    try {
        // Create data directory if it doesn't exist
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            console.log(`✅ Created data directory: ${DATA_DIR}`);
        }

        // Files to initialize with their source and destination
        const dataFiles = [
            {
                name: 'users.json',
                source: './users.json',
                dest: USERS_FILE,
                defaultContent: '[]'
            },
            {
                name: 'draft.json',
                source: './draft.json',
                dest: DRAFT_FILE,
                defaultContent: '{}'
            },
            {
                name: 'trades.json',
                source: './trades.json',
                dest: TRADES_FILE,
                defaultContent: '{}'
            },
            {
                name: 'current_stats.json',
                source: './current_stats.json',
                dest: CURRENT_STATS_FILE,
                defaultContent: '{"players":[],"lastUpdated":null}'
            },
            {
                name: 'current_teams.json',
                source: './current_teams.json',
                dest: CURRENT_TEAMS_FILE,
                defaultContent: '{"teams":[],"lastUpdated":null}'
            }
        ];

        dataFiles.forEach(({ name, source, dest, defaultContent }) => {
            // Skip if destination file already exists
            if (fs.existsSync(dest)) {
                console.log(`⊙ ${name} already exists in data directory`);
                return;
            }

            // Try to copy from source file in app directory
            if (fs.existsSync(source) && source !== dest) {
                try {
                    fs.copyFileSync(source, dest);
                    console.log(`✅ Initialized ${name} from application directory`);
                    return;
                } catch (copyError) {
                    console.warn(`⚠️  Could not copy ${name}:`, copyError.message);
                }
            }

            // Create with default content if source doesn't exist
            try {
                fs.writeFileSync(dest, defaultContent);
                console.log(`✅ Created ${name} with default content`);
            } catch (writeError) {
                console.error(`❌ Could not create ${name}:`, writeError.message);
            }
        });

        console.log('✅ Data initialization complete');
    } catch (error) {
        console.error('❌ Error during data initialization:', error);
    }
}

// ===============================================
// SERVER INITIALIZATION
// ===============================================

async function startServer() {
    try {
        // Initialize PostgreSQL database if using PostgreSQL
        if (USE_POSTGRES) {
            console.log('🗄️  Initializing PostgreSQL database...');
            await db.initializeDatabase();
            console.log('✅ PostgreSQL database initialized successfully');
        } else {
            // Initialize JSON files if not using PostgreSQL
            if (DATA_DIR !== '.') {
                console.log('🔧 Initializing data files for production...');
                initializeDataFiles();
            }
        }

        // ✅ Start Server with WebSockets (after all routes are defined)
        server.listen(PORT, () => {
            console.log(`🚀 Serveur WebSocket en cours d'exécution sur http://localhost:${PORT}`);
            console.log(`🚀 Serveur en cours d'exécution sur http://localhost:${PORT}`);
            console.log(`📁 Data directory: ${DATA_DIR}`);
            console.log(`💾 Using ${USE_POSTGRES ? 'PostgreSQL' : 'JSON files'} for data storage`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server
startServer();
