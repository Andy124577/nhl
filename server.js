const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path"); // ✅ for static paths

const app = express();
const PORT = process.env.PORT || 3000; // ✅ Use Render's PORT
const USERS_FILE = "./users.json";
const DRAFT_FILE = "./draft.json";
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

app.use((req, res, next) => {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    next();
});

app.use((req, res, next) => {
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

// ✅ Route to Create a Clan
app.post("/create-clan", (req, res) => {
    const { name, maxPlayers } = req.body;
    let draftData = loadDraftData();

    if (draftData[name]) {
        return res.status(400).json({ message: "Ce clan existe déjà !" });
    }

    const teams = {};
    for (let i = 1; i <= 10; i++) {
        teams[`Équipe ${i}`] = { members: [], offensive: [], defensive: [] };
    }

    draftData[name] = {
        maxPlayers: parseInt(maxPlayers),
        draftOrder: [],
        currentPickIndex: 0, // ✅ Ajouté ici
        teams
    };

    saveDraftData(draftData);
    setTimeout(() => {
        io.emit("draftUpdated", draftData);
    }, 2000);

    res.json({ message: `Clan ${name} créé avec succès !`, draftData });
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

// ✅ Start Server with WebSockets
server.listen(PORT, () => {
    console.log(`🚀 Serveur WebSocket en cours d'exécution sur http://localhost:${PORT}`);
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

    if (position === "offensive") {
        if (userTeam.offensive.length >= 6) {
            return res.status(400).json({ message: "Votre équipe a déjà 6 joueurs offensifs." });
        }
        userTeam.offensive.push(playerName);
    } else if (position === "defensive") {
        if (userTeam.defensive.length >= 4) {
            return res.status(400).json({ message: "Votre équipe a déjà 4 défenseurs." });
        }
        userTeam.defensive.push(playerName);
    } else if (position === "rookie") {
        if (!userTeam.rookie) userTeam.rookie = [];
        if (userTeam.rookie.length >= 1) {
            return res.status(400).json({ message: "Votre équipe a déjà 1 rookie." });
        }
        userTeam.rookie.push(playerName);
    } else if (position === "goalie") {
        if (!userTeam.goalie) userTeam.goalie = [];
        if (userTeam.goalie.length >= 1) {
            return res.status(400).json({ message: "Votre équipe a déjà un gardien." });
        }
        userTeam.goalie.push(playerName);
    } else if (position === "teams") {
        if (!userTeam.teams) userTeam.teams = [];
        if (userTeam.teams.length >= 1) {
            return res.status(400).json({ message: "Votre équipe a déjà une équipe NHL." });
        }
        userTeam.teams.push(playerName);
    } else {
        return res.status(400).json({ message: "Position invalide." });
    }

    // ✅ Empêche les doubles sélections pour le même tour
    if (clan.lastPickIndex === clan.currentPickIndex) {
    // Check if the team can still pick anything
    const team = clan.teams[userTeamName];
    const canPickOffensive = team.offensive.length < 6;
    const canPickDefensive = team.defensive.length < 4;

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

// 🔥 Lancer le serveur
app.listen(PORT, () => {
    console.log(`🚀 Serveur en cours d'exécution sur http://localhost:${PORT}`);
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
        const { name, maxPlayers } = req.body;
        let draftData = loadDraftData();

        if (draftData[name]) {
            return res.status(400).json({ message: "Ce clan existe déjà !" });
        }

        // 🔥 Initialize 10 teams for the new clan
        let teams = {};
        for (let i = 1; i <= 10; i++) {
            teams[`Équipe ${i}`] = { members: [], offensive: [], defensive: [] };
        }

        draftData[name] = {
            maxPlayers: parseInt(maxPlayers),
            draftOrder: [],
            currentPickIndex: 0,
            lastPickIndex: -1, // ✅ Ajouté ici
            teams
        };


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
        clan.draftOrder = generateSnakeOrder(eligibleTeams, 15); // 10 rounds
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

    const initialOrder = [...eligibleTeams].sort(() => Math.random() - 0.5);
    clan.draftOrder = generateSnakeOrder(initialOrder, 15);
    saveDraftData(draftData);

    res.json({ message: "Ordre de draft généré en serpentin.", draftOrder: clan.draftOrder });
});



function checkIfDraftComplete(clan) {
    return Object.values(clan.teams).every(team =>
        team.members.length > 0 &&
        team.offensive.length === 6 &&
        team.defensive.length === 4 &&
        team.rookie?.length === 1 &&
        team.goalie?.length === 1 &&
        team.teams?.length === 1
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

