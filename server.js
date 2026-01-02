const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path"); // ✅ for static paths
const cron = require("node-cron");

const app = express();
const PORT = process.env.PORT || 3000; // ✅ Use Render's PORT
const USERS_FILE = "./users.json";
const DRAFT_FILE = "./draft.json";
const TRADES_FILE = "./trades.json";
const NHL_STATS_FILE = "./nhl_filtered_stats.json";
const CURRENT_STATS_FILE = "./current_stats.json";
const CURRENT_TEAMS_FILE = "./current_teams.json";
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } }); // ✅ allow public access for now

app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// ✅ Serve static files like HTML, CSS, JS
app.use(express.static(__dirname));

// ✅ Optional: Force / to serve index.html
app.get('/', (req, res) => {
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

// ✅ Function to Load & Save Draft Data
const loadDraftData = () => {
    try {
        const raw = fs.readFileSync(DRAFT_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        console.log("✅ Contenu de draft.json :", Object.keys(parsed));
        return parsed;
    } catch (error) {
        console.error("❌ Erreur de lecture du draft :", error);
        return {};
    }
};


const saveDraftData = (data) => {
    fs.writeFileSync(DRAFT_FILE, JSON.stringify(data, null, 2));

    setTimeout(() => {
        console.log("✅ Reloading fresh data...");
        const freshData = loadDraftData(); // 🔥 Ensure latest JSON is broadcast
        console.log("🔥 Sending fresh draft data via WebSocket:", freshData);
        io.emit("draftUpdated", freshData); // ✅ Broadcast ONLY fresh data
        setTimeout(() => {
    io.emit("forceRefresh"); // 🔥 Envoie un signal aux clients pour recharger /draft
}, 500);
    }, 200); // ✅ Small delay ensures file is fully written before broadcasting
};

// ✅ WebSocket Connection
io.on("connection", (socket) => {
    console.log("📡 Client connecté via WebSockets");
    socket.emit("draftUpdated", loadDraftData()); // Send initial data on connection
});

app.post("/leave-team", async (req, res) => {
    try {
        const { name, username } = req.body;
        let draftData = loadDraftData();

        if (!draftData[name]) {
            return res.status(400).json({ message: "Clan introuvable !" });
        }

        // Trouver l'équipe actuelle de l'utilisateur
        let currentTeam = Object.entries(draftData[name].teams)
            .find(([teamName, teamData]) => teamData.members.includes(username));

        if (!currentTeam) return res.status(400).json({ message: "Vous n'êtes dans aucune équipe !" });

        // Supprimer l'utilisateur de son équipe actuelle
        draftData[name].teams[currentTeam[0]].members = draftData[name].teams[currentTeam[0]].members.filter(user => user !== username);
        saveDraftData(draftData);
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
app.post("/join-clan", (req, res) => {
    const { name, username } = req.body;
    let draftData = loadDraftData();

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
app.post("/delete-clan", (req, res) => {
    const { clanName } = req.body;
    let draftData = loadDraftData();

    if (!draftData[clanName]) {
        return res.status(400).json({ message: "Le clan n'existe pas !" });
    }

    delete draftData[clanName];
    saveDraftData(draftData);
    setTimeout(() => {
            io.emit("draftUpdated", draftData);
        }, 2000); // ou 200ms
        // 🔔 Notifie tous les clients

    res.json({ message: `Clan ${clanName} supprimé avec succès !` });
});

// 📌 Route pour récupérer tous les pools et équipes
app.get("/draft", (req, res) => {
    const draftData = loadDraftData();
    console.log("📤 Draft envoyé :", Object.keys(draftData)); // 👈 Ajoute ceci
    res.json(draftData);
});

// 🔥 Route pour sélectionner un joueur pour une équipe
app.post("/pick-player", (req, res) => {
    const { clanName, username, playerName, position } = req.body;

    if (!clanName || !username || !playerName || !position) {
        return res.status(400).json({ message: "Données incomplètes." });
    }

    let draftData = loadDraftData();
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
            saveDraftData(draftData);
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

    saveDraftData(draftData);

    setTimeout(() => {
        io.emit("draftUpdated", draftData);
        io.emit("forceRefresh");
    }, 200);

    if (checkIfDraftComplete(clan)) {
        io.emit("draftComplete", { clanName });
    }

    res.json({ message: `✅ ${playerName} a été sélectionné par ${userTeamName}.` });
});


// 📌 Route pour récupérer l'ordre du draft d'un clan
app.get("/draft-order/:clanName", (req, res) => {
    const { clanName } = req.params;
    const draftData = loadDraftData();

    if (!draftData[clanName]) {
        return res.status(400).json({ message: "Clan introuvable !" });
    }

    res.json({ draftOrder: draftData[clanName].draftOrder });
});

// 📌 Charger et sauvegarder `users.json`
const loadUsers = () => {
    try {
        return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    } catch (error) {
        console.error("Erreur de lecture des utilisateurs :", error);
        return [];
    }
};
const saveUsers = (users) => fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

// 🔥 Route pour récupérer les drafts actifs
app.get("/active-drafts", (req, res) => {
    const { username } = req.query;
    if (!username) return res.status(400).json({ message: "Nom d'utilisateur requis !" });

    const draftData = loadDraftData();

    // Recherche des drafts où l'utilisateur est membre d'une équipe
    const activeDrafts = Object.keys(draftData).filter(clan =>
        Object.values(draftData[clan].teams).some(team => team.members.includes(username))
    );

    res.json({ activeDrafts });
});

// 🔥 Route pour récupérer l'ordre du draft d'un clan
app.get("/draft-order/:clanName", (req, res) => {
    const { clanName } = req.params;
    const draftData = loadDraftData();

    if (!draftData[clanName]) {
        return res.status(400).json({ message: "Clan introuvable !" });
    }

    res.json({ draftOrder: draftData[clanName].draftOrder });
});



// 🔥 Route pour créer un clan
app.post("/create-clan", async (req, res) => {
    try {
        const { name, maxPlayers, config, poolMode, allowTrades } = req.body;
        let draftData = loadDraftData();

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

        saveDraftData(draftData);
        setTimeout(() => {
        io.emit("draftUpdated", draftData);
        }, 2000); // ou 200ms
        // 🔔 Notifie tous les clients

        // ✅ Return fully updated draft data
        res.json({ message: `Clan ${name} créé avec succès !`, draftData });

    } catch (error) {
        console.error("Erreur lors de la création du clan :", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

app.post("/delete-clan", async (req, res) => {
    const { clanName } = req.body;
    let draftData = loadDraftData();

    if (!draftData[clanName]) {
        return res.status(400).json({ message: "Le clan n'existe pas !" });
    }

    // Remove the clan from the draft data
    delete draftData[clanName];
    saveDraftData(draftData);
    setTimeout(() => {
        io.emit("draftUpdated", draftData);
        }, 2000); // ou 200ms
        // 🔔 Notifie tous les clients


    res.json({ message: `Clan ${clanName} supprimé avec succès !` });
});

app.post("/change-team", async (req, res) => {
    try {
        const { name, username, newTeamNumber } = req.body;
        let draftData = loadDraftData();

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

        saveDraftData(draftData);
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
    let draftData = loadDraftData();

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
        saveDraftData(draftData);
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
    let draftData = loadDraftData();

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
    saveDraftData(draftData);
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

        let users = loadUsers();
        if (users.some(user => user.username === username)) return res.status(400).json({ message: "Ce nom d'utilisateur est déjà pris !" });

        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ username, password: hashedPassword });
        saveUsers(users);

        res.json({ message: "Inscription réussie !" });
    } catch (error) {
        console.error("Erreur lors de l'inscription :", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

// 🔑 Route de connexion
app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        let users = loadUsers();
        const user = users.find(u => u.username === username);

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
        let users = loadUsers();
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

        let users = loadUsers();
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


app.post("/start-draft", (req, res) => {
    const { clanName } = req.body;
    if (!clanName) return res.status(400).json({ message: "Nom du clan requis." });

    let draftData = loadDraftData();
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
        saveDraftData(draftData);
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



app.post("/randomize-draft-order", (req, res) => {
    const { clanName } = req.body;
    if (!clanName) return res.status(400).json({ message: "Nom du clan requis." });

    let draftData = loadDraftData();
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
    saveDraftData(draftData);

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


app.post("/cleanup-draft", (req, res) => {
    const { clanName } = req.body;
    let draftData = loadDraftData();

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

    saveDraftData(draftData);
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

        // Extract current season stats - check for 20252026 season ONLY
        const seasonStats = data.featuredStats?.regularSeason?.subSeason;
        const season = data.featuredStats?.season;

        // If player has stats from wrong season or no stats, return zeros
        if (!seasonStats || season !== 20252026) {
            if (season && season !== 20252026) {
                console.log(`⚠️ ${playerName} has stats from season ${season}, not 20252026 - returning zeros`);
            }
            // Return player with all zeros (injured/hasn't played this season)
            return {
                playerId: playerId,
                playerName: playerName,
                teamAbbrev: data.currentTeamAbbrev || "N/A",
                position: data.position || "N/A",
                gamesPlayed: 0,
                goals: 0,
                assists: 0,
                wins: 0,
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

        if (isGoalie) {
            // Goalie scoring: shutouts = 5pts, wins = 2pts, OTL = 1pt
            wins = seasonStats.wins || 0;
            shutouts = seasonStats.shutouts || 0;
            otLosses = seasonStats.otLosses || 0;
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
            position: data.position || "N/A",
            gamesPlayed: seasonStats.gamesPlayed || 0,
            goals: isGoalie ? wins : (seasonStats.goals || 0),
            assists: isGoalie ? shutouts : (seasonStats.assists || 0),
            wins: wins,
            shutouts: shutouts,
            otLosses: otLosses,
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
            position: "N/A",
            gamesPlayed: 0,
            goals: 0,
            assists: 0,
            wins: 0,
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
    const existingStats = loadCurrentStats();
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

    // Save to file
    fs.writeFileSync(CURRENT_STATS_FILE, JSON.stringify(currentStats, null, 2));
    console.log(`✅ NHL stats updated successfully! ${currentStats.players.length} players cached.`);

    return currentStats;
}

// Load cached stats or return empty structure
function loadCurrentStats() {
    try {
        if (fs.existsSync(CURRENT_STATS_FILE)) {
            return JSON.parse(fs.readFileSync(CURRENT_STATS_FILE, "utf-8"));
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
        let stats = loadCurrentStats();

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

                teams.push({
                    teamFullName: team.teamName?.default || team.teamCommonName?.default,
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
        return loadCurrentTeams();
    }

    const teamStats = {
        lastUpdated: new Date().toISOString(),
        teams: teams
    };

    // Save to file
    fs.writeFileSync(CURRENT_TEAMS_FILE, JSON.stringify(teamStats, null, 2));
    console.log(`✅ Team standings updated successfully! ${teams.length} teams cached.`);

    return teamStats;
}

// Load cached team standings
function loadCurrentTeams() {
    try {
        if (fs.existsSync(CURRENT_TEAMS_FILE)) {
            return JSON.parse(fs.readFileSync(CURRENT_TEAMS_FILE, 'utf-8'));
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
        let stats = loadCurrentTeams();

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

console.log("✅ NHL current stats system initialized");
console.log("✅ NHL team standings system initialized");

// ==================== TRADE SYSTEM ====================

// Load trades data
const loadTrades = () => {
    try {
        if (fs.existsSync(TRADES_FILE)) {
            const data = fs.readFileSync(TRADES_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error("Error loading trades:", error);
    }
    return { completed: [], pending: [] };
};

// Save trades data
const saveTrades = (tradesData) => {
    try {
        fs.writeFileSync(TRADES_FILE, JSON.stringify(tradesData, null, 2));
        console.log("✅ Trades saved successfully");
    } catch (error) {
        console.error("Error saving trades:", error);
    }
};

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
app.get('/trades/:draftName', (req, res) => {
    try {
        const { draftName } = req.params;
        const trades = loadTrades();
        const draftTrades = (trades.completed || []).filter(t => t.draftName === draftName);
        res.json(draftTrades);
    } catch (error) {
        console.error("Error loading trades:", error);
        res.status(500).json({ message: "Error loading trades" });
    }
});

// Get pending trades for a user
app.get('/trades/pending/:username', (req, res) => {
    try {
        const { username } = req.params;
        const trades = loadTrades();
        const draftData = loadDraftData();

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
app.post('/trade/propose', (req, res) => {
    try {
        const { draftName, fromTeam, toTeam, offering, receiving } = req.body;

        if (!draftName || !fromTeam || !toTeam || !offering || !receiving) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        const trades = loadTrades();
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
        saveTrades(trades);

        // Emit socket event for real-time notification
        io.emit('tradePending');

        res.json({ message: "Trade proposal sent successfully", tradeId });
    } catch (error) {
        console.error("Error sending trade proposal:", error);
        res.status(500).json({ message: "Error sending trade proposal" });
    }
});

// Accept a trade
app.post('/trade/accept', (req, res) => {
    try {
        const { tradeId } = req.body;
        const trades = loadTrades();
        const draftData = loadDraftData();

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

        const fromTeam = draft.teams[trade.fromTeam];
        const toTeam = draft.teams[trade.toTeam];

        if (!fromTeam || !toTeam) {
            return res.status(404).json({ message: "Teams not found" });
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

        saveDraftData(draftData);

        // Move trade from pending to completed
        trades.pending.splice(tradeIndex, 1);
        if (!trades.completed) trades.completed = [];
        trade.status = 'accepted';
        trade.completedDate = new Date().toISOString();
        trades.completed.push(trade);
        saveTrades(trades);

        // Emit socket event
        io.emit('tradeUpdated');

        res.json({ message: "Trade accepted successfully" });
    } catch (error) {
        console.error("Error accepting trade:", error);
        res.status(500).json({ message: "Error accepting trade" });
    }
});

// Decline a trade
app.post('/trade/decline', (req, res) => {
    try {
        const { tradeId } = req.body;
        const trades = loadTrades();

        // Remove from pending
        const tradeIndex = trades.pending.findIndex(t => t.id === tradeId);
        if (tradeIndex === -1) {
            return res.status(404).json({ message: "Trade not found" });
        }

        trades.pending.splice(tradeIndex, 1);
        saveTrades(trades);

        // Emit socket event
        io.emit('tradeUpdated');

        res.json({ message: "Trade declined successfully" });
    } catch (error) {
        console.error("Error declining trade:", error);
        res.status(500).json({ message: "Error declining trade" });
    }
});

console.log("✅ Trade system initialized");

// ✅ Start Server with WebSockets (after all routes are defined)
server.listen(PORT, () => {
    console.log(`🚀 Serveur WebSocket en cours d'exécution sur http://localhost:${PORT}`);
    console.log(`🚀 Serveur en cours d'exécution sur http://localhost:${PORT}`);
});
