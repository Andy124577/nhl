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

// ✅ Serve static files like HTML, CSS, JS
app.use(express.static(__dirname));

// ✅ Optional: Force / to serve index.html
app.get('/', async (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Cache control: cache images/fonts for 1 year, but not HTML/JS/CSS
app.use((req, res, next) => {
    const path = req.path.toLowerCase();
    if (path.match(/\.(jpg|jpeg|png|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
        // Cache images and fonts for 1 year
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
        // Don't cache HTML, JS, CSS files - always fetch fresh
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
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

    // Shuffle teams randomly
    const shuffled = [...teamNames].sort(() => Math.random() - 0.5);

    // Create pairs
    const matchups = [];
    for (let i = 0; i < shuffled.length; i += 2) {
        matchups.push({
            team1: shuffled[i],
            team2: shuffled[i + 1],
            team1Points: 0,
            team2Points: 0,
            winner: null,
            weekNumber: null // Will be set when saved
        });
    }

    return matchups;
}

// Calculate total points for a team for a given week
function getTeamWeeklyPoints(teamData, currentStats) {
    let totalPoints = 0;

    // Helper function to get current player stats
    function getPlayerPoints(playerData) {
        if (!currentStats || !currentStats.players) return 0;

        const playerName = playerData.skaterFullName || playerData.goalieFullName;
        if (!playerName) return 0;

        const stats = currentStats.players.find(p => p.playerName === playerName);
        return stats ? (stats.points || 0) : 0;
    }

    // Sum points from all positions
    ['offensive', 'defensive', 'rookie', 'goalie'].forEach(position => {
        const positionKey = position === 'goalie' ? 'goalies' : position;
        if (teamData[positionKey]) {
            teamData[positionKey].forEach(player => {
                totalPoints += getPlayerPoints(player);
            });
        }
    });

    // Add team points if applicable
    // (Teams don't have individual player stats, skip for now)

    return totalPoints;
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

            // Get active teams
            const activeTeams = Object.entries(clan.teams)
                .filter(([_, teamData]) => teamData.members && teamData.members.length > 0)
                .map(([teamName, _]) => ({ name: teamName }));

            // Generate matchups for week 1
            const weekOneMatchups = generateWeeklyMatchups(activeTeams);

            // Set week start to next Monday 00:00:00
            const now = new Date();
            const nextMonday = new Date(now);
            const dayOfWeek = now.getDay();
            const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
            nextMonday.setDate(now.getDate() + daysUntilMonday);
            nextMonday.setHours(0, 0, 0, 0);

            clan.h2hData.weekStart = nextMonday.toISOString();
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
                    // For percentages, we'll recalculate later if needed
                    savePct: entry.savePct || entry.savePercentage || combined.savePct || 0
                };
            }, {});
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
            savePct = seasonStats.savePct || seasonStats.savePercentage || 0;
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

    // Fetch stats for each player with delay to avoid rate limiting
    for (let i = 0; i < allPlayers.length; i++) {
        const player = allPlayers[i];
        const playerName = player.skaterFullName || player.goalieFullName;
        console.log(`Fetching ${i + 1}/${allPlayers.length}: ${playerName}`);

        const stats = await fetchCurrentStatsForPlayer(
            player.playerId,
            playerName,
            player.isGoalie
        );

        if (stats) {
            // Find previous stats for this player
            const previousStats = previousPlayers.find(p => p.playerId === stats.playerId);
            const previousPoints = previousStats ? previousStats.points : 0;

            // Calculate today's points (difference from previous)
            stats.todayPoints = stats.points - previousPoints;

            newPlayers.push(stats);
        }

        // Add delay between requests (200ms) to avoid rate limiting
        if (i < allPlayers.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }

    const currentStats = {
        lastUpdated: new Date().toISOString(),
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

        // If no cached stats or cache is older than 24 hours, update
        if (!stats.lastUpdated) {
            console.log("📊 No cached stats found, fetching fresh data...");
            stats = await updateCurrentStats();
        } else {
            const lastUpdate = new Date(stats.lastUpdated);
            const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);

            if (hoursSinceUpdate > 24) {
                console.log("📊 Cached stats are old, fetching fresh data...");
                stats = await updateCurrentStats();
            }
        }

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

        // Process skaters - get last 10 games stats for top 200
        console.log('📊 Processing skaters...');
        const skaterPromises = (skatersData.points || []).slice(0, 200).map(async (player) => {
            const last10Stats = await getPlayerLast10Stats(player.playerId, player.position);
            if (!last10Stats || last10Stats.gamesPlayed < 5) return null; // Must have played at least 5 of last 10 games

            return {
                playerId: player.playerId,
                playerName: `${player.firstName.default} ${player.lastName.default}`,
                teamAbbrev: player.teamAbbrev,
                position: player.positionCode,
                headshot: player.headshot,
                isRookie: player.rookieFlag === 'Y',
                ...last10Stats
            };
        });

        const skaters = (await Promise.all(skaterPromises)).filter(p => p !== null);

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

        // Process goalies
        console.log('📊 Processing goalies...');
        const goaliePromises = (goaliesData.savePercentage || []).slice(0, 50).map(async (player) => {
            const last10Stats = await getPlayerLast10Stats(player.playerId, 'G');
            if (!last10Stats || last10Stats.gamesPlayed < 3) return null; // Must have played at least 3 of last 10 games

            return {
                playerId: player.playerId,
                playerName: `${player.firstName.default} ${player.lastName.default}`,
                teamAbbrev: player.teamAbbrev,
                position: 'G',
                headshot: player.headshot,
                ...last10Stats
            };
        });

        const goaliesWithStats = (await Promise.all(goaliePromises)).filter(p => p !== null);

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
        'goalie': 'goalies',
        'rookie': 'rookies',
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
        'goalie': 'goalies',
        'rookie': 'rookies',
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
        'goalie': 'goalies',
        'rookie': 'rookies',
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

// Get pending trades for a user
app.get('/trades/pending/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const trades = await loadTrades();
        const draftData = await loadDraftData();

        // Find all pending trades where user is the recipient
        const userPendingTrades = (trades.pending || []).filter(trade => {
            const draft = draftData[trade.draftName];
            if (!draft) return false;

            const targetTeam = draft.teams[trade.toTeam];
            return targetTeam && targetTeam.members && targetTeam.members.includes(username);
        });

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

        // Check if pool allows trades
        const draftData = await loadDraftData();
        const pool = draftData[draftName];
        if (!pool) {
            return res.status(404).json({ message: "Pool not found" });
        }
        if (pool.allowTrades === false) {
            return res.status(403).json({ message: "Les échanges ne sont pas autorisés dans ce pool" });
        }

        // VALIDATION: Check if fromTeam exists and has all offered players
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

        const trades = await loadTrades();
        if (!trades.pending) trades.pending = [];

        const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const newTrade = {
            id: tradeId,
            draftName,
            fromTeam,
            toTeam,
            offering,
            receiving,
            status: 'pending',
            date: new Date().toISOString()
        };

        trades.pending.push(newTrade);
        await saveTrades(trades);

        // Emit socket event for real-time notification
        io.emit('tradePending');

        console.log(`📤 Trade proposed: ${fromTeam} → ${toTeam}`);

        res.json({ message: "Trade proposal sent successfully", tradeId });
    } catch (error) {
        console.error("Error sending trade proposal:", error);
        res.status(500).json({ message: "Error sending trade proposal" });
    }
});

// Accept a trade
app.post('/trade/accept', async (req, res) => {
    try {
        const { tradeId } = req.body;
        const trades = await loadTrades();
        const draftData = await loadDraftData();

        // Find the trade
        const tradeIndex = trades.pending.findIndex(t => t.id === tradeId);
        if (tradeIndex === -1) {
            return res.status(404).json({ message: "Trade not found" });
        }

        const trade = trades.pending[tradeIndex];
        const draft = draftData[trade.draftName];
        if (!draft) {
            return res.status(404).json({ message: "Draft not found" });
        }

        // Check if pool allows trades
        if (draft.allowTrades === false) {
            return res.status(403).json({ message: "Les échanges ne sont pas autorisés dans ce pool" });
        }

        const fromTeam = draft.teams[trade.fromTeam];
        const toTeam = draft.teams[trade.toTeam];

        if (!fromTeam || !toTeam) {
            return res.status(404).json({ message: "Teams not found" });
        }

        // VALIDATION: Check if fromTeam still has all offered players
        const missingFromOffering = [];
        trade.offering.forEach(item => {
            if (!teamHasPlayer(fromTeam, item)) {
                missingFromOffering.push(item.name);
            }
        });

        // VALIDATION: Check if toTeam still has all receiving players
        const missingFromReceiving = [];
        trade.receiving.forEach(item => {
            if (!teamHasPlayer(toTeam, item)) {
                missingFromReceiving.push(item.name);
            }
        });

        // If any players are missing, reject the trade
        if (missingFromOffering.length > 0 || missingFromReceiving.length > 0) {
            let errorMsg = "❌ Échange invalide: ";
            if (missingFromOffering.length > 0) {
                errorMsg += `${trade.fromTeam} ne possède plus: ${missingFromOffering.join(', ')}. `;
            }
            if (missingFromReceiving.length > 0) {
                errorMsg += `${trade.toTeam} ne possède plus: ${missingFromReceiving.join(', ')}.`;
            }

            // Remove this invalid trade from pending
            trades.pending.splice(tradeIndex, 1);
            await saveTrades(trades);

            console.log(`⚠️ Trade ${tradeId} cancelled: players no longer available`);
            return res.status(400).json({ message: errorMsg });
        }

        // Execute the trade - swap items
        trade.offering.forEach(item => {
            removeFromTeam(fromTeam, item);
            addToTeam(toTeam, item);
        });

        trade.receiving.forEach(item => {
            removeFromTeam(toTeam, item);
            addToTeam(fromTeam, item);
        });

        await saveDraftData(draftData);

        // Move trade from pending to completed
        trades.pending.splice(tradeIndex, 1);
        if (!trades.completed) trades.completed = [];
        trade.status = 'accepted';
        trade.completedDate = new Date().toISOString();
        trades.completed.push(trade);

        // Cancel all other pending trades that involve these players
        const cancelledCount = invalidateConflictingTrades(trades, trade, draftData);

        await saveTrades(trades);

        // Emit socket event
        io.emit('tradeUpdated');

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
        const trades = await loadTrades();

        // Remove from pending
        const tradeIndex = trades.pending.findIndex(t => t.id === tradeId);
        if (tradeIndex === -1) {
            return res.status(404).json({ message: "Trade not found" });
        }

        trades.pending.splice(tradeIndex, 1);
        await saveTrades(trades);

        // Emit socket event
        io.emit('tradeUpdated');

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

        // Get current stats for points calculation
        const currentStats = await loadCurrentStats();

        // Calculate results for the current week
        const currentWeek = clan.h2hData.currentWeek;
        const weekMatchups = clan.h2hData.matchups[currentWeek - 1];

        if (!weekMatchups || weekMatchups.length === 0) {
            return res.status(400).json({ message: "No matchups found for current week" });
        }

        // Calculate points and determine winners for each matchup
        weekMatchups.forEach(matchup => {
            matchup.team1Points = getTeamWeeklyPoints(clan.teams[matchup.team1], currentStats);
            matchup.team2Points = getTeamWeeklyPoints(clan.teams[matchup.team2], currentStats);
            matchup.weekNumber = currentWeek;

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
        });

        // Move completed week to history
        clan.h2hData.matchupHistory.push({
            weekNumber: currentWeek,
            matchups: weekMatchups,
            completedDate: new Date().toISOString()
        });

        // Advance to next week
        clan.h2hData.currentWeek++;

        // Generate new matchups for next week
        const activeTeams = Object.entries(clan.teams)
            .filter(([_, teamData]) => teamData.members && teamData.members.length > 0)
            .map(([teamName, _]) => ({ name: teamName }));

        const nextWeekMatchups = generateWeeklyMatchups(activeTeams);

        // Add new week matchups with week number
        clan.h2hData.matchups.push(
            nextWeekMatchups.map(m => ({ ...m, weekNumber: clan.h2hData.currentWeek }))
        );

        // Update week start date (add 7 days)
        const currentWeekStart = new Date(clan.h2hData.weekStart);
        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
        clan.h2hData.weekStart = currentWeekStart.toISOString();

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

console.log("✅ Trade system initialized");

// ✅ Auto-check and finalize completed H2H weeks
async function checkAndFinalizeCompletedWeeks() {
    try {
        const draftData = await loadDraftData();
        const currentStats = await loadCurrentStats();
        let updatedAnyPool = false;

        for (const [poolName, clan] of Object.entries(draftData)) {
            // Skip non-H2H pools
            if (clan.poolMode !== 'head-to-head' || !clan.h2hData) {
                continue;
            }

            const weekStart = new Date(clan.h2hData.weekStart);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 7); // Add 7 days

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

                // Calculate points and determine winners
                weekMatchups.forEach(matchup => {
                    matchup.team1Points = getTeamWeeklyPoints(clan.teams[matchup.team1], currentStats);
                    matchup.team2Points = getTeamWeeklyPoints(clan.teams[matchup.team2], currentStats);
                    matchup.weekNumber = currentWeek;

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
                });

                // Move to history
                clan.h2hData.matchupHistory.push({
                    weekNumber: currentWeek,
                    matchups: weekMatchups,
                    completedDate: new Date().toISOString()
                });

                // Advance to next week
                clan.h2hData.currentWeek++;

                // Generate new matchups
                const activeTeams = Object.entries(clan.teams)
                    .filter(([_, teamData]) => teamData.members && teamData.members.length > 0)
                    .map(([teamName, _]) => ({ name: teamName }));

                const nextWeekMatchups = generateWeeklyMatchups(activeTeams);
                clan.h2hData.matchups.push(
                    nextWeekMatchups.map(m => ({ ...m, weekNumber: clan.h2hData.currentWeek }))
                );

                // Update week start (add 7 days)
                weekStart.setDate(weekStart.getDate() + 7);
                clan.h2hData.weekStart = weekStart.toISOString();

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
