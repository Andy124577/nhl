// Must run before anything else — db.js reads process.env.DATABASE_URL as
// soon as it's required (line ~12 below), so .env has to be loaded first.
require("dotenv").config();

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const bcrypt = require("bcryptjs");
// Filtre de grossieretes, partage avec le navigateur (profanity.js).
const { contientGrossierete } = require("./profanity.js");
const fs = require("fs");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path"); // ✅ for static paths
const cron = require("node-cron");
const db = require("./db"); // ✅ PostgreSQL database module
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

// Logique métier pure, extraite de ce fichier vers lib/ pour être testable
// unitairement (voir UNIT_TESTS.md). Les corps de fonctions sont inchangés.
const { FANTASY_SCORING, goaliePoolPoints, clubPoolPoints, computeTeamSeasonScores,
    getTeamWeeklyPoints, skaterFantasyPointsTonight, goalieFantasyPointsTonight } = require("./lib/scoring.js");
const { generateWeeklyMatchups, ensureStandingsEntry, mondayOfWeek } = require("./lib/h2h.js");
const { generateSnakeOrder, checkIfDraftComplete } = require("./lib/draft.js");
const { teamHasPlayer, removeFromTeam, addToTeam, getPositionLabel } = require("./lib/trades.js");
const { NHL_CLUB_FULLNAME, diffRosterSnapshots, getTeamAbbreviationFromName } = require("./lib/roster.js");
const { getStatsRefreshStatus } = require("./lib/statsCache.js");

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
// Photo quotidienne des 32 alignements + journal des mouvements qu'on en
// déduit (voir la section « TRANSACTIONS LNH » plus bas).
const ROSTER_SNAPSHOT_FILE = `${DATA_DIR}/nhl_roster_snapshot.json`;
const TRANSACTIONS_FILE = `${DATA_DIR}/nhl_transactions.json`;

// Use PostgreSQL if DATABASE_URL is set, otherwise use JSON files
const USE_POSTGRES = !!process.env.DATABASE_URL;

/**
 * Équipes de la LNH valides pour une identité de repêchage (voir
 * /choose-nhl-club). Reprend teamColors.js sans son entrée historique ARI —
 * l'Arizona n'existe plus, remplacée par l'Utah (UTA). Gardée statique
 * plutôt que lue depuis current_teams.json : la validation doit fonctionner
 * même avant le premier rafraîchissement des statistiques.
 */
const NHL_CLUB_CODES = new Set([
    'ANA', 'BOS', 'BUF', 'CAR', 'CBJ', 'CGY', 'CHI', 'COL', 'DAL', 'DET',
    'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NJD', 'NSH', 'NYI', 'NYR', 'OTT',
    'PHI', 'PIT', 'SEA', 'SJS', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK',
    'WPG', 'WSH'
]);


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

// ✅ Serve uploaded images (user avatars, pool images)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Image upload configuration ───────────────────────────────────────────────
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const EXT_MAP = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

function makeStorage(folder) {
    return multer.diskStorage({
        destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads', folder)),
        filename: (req, file, cb) => cb(null, uuidv4() + EXT_MAP[file.mimetype]),
    });
}
function imgFilter(req, file, cb) {
    if (ALLOWED_MIME.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Type de fichier non autorisé. Utilisez JPEG, PNG ou WebP.'), false);
    }
}

const uploadAvatar = multer({ storage: makeStorage('avatars'), fileFilter: imgFilter, limits: { fileSize: 2 * 1024 * 1024 } });
const uploadPool   = multer({ storage: makeStorage('pools'),   fileFilter: imgFilter, limits: { fileSize: 2 * 1024 * 1024 } });
// ──────────────────────────────────────────────────────────────────────────────

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


/**
 * Version publiable des pools : l'empreinte du mot de passe ne quitte
 * jamais le serveur.
 *
 * `/draft` et l'événement socket `draftUpdated` diffusent l'objet complet à
 * tous les clients connectés. Une empreinte bcrypt exposée là serait
 * attaquable hors ligne à volonté, exactement ce que le stockage haché doit
 * empêcher. Elle est donc remplacée par un simple booléen — la seule chose
 * dont l'interface a besoin pour savoir s'il faut demander le mot de passe.
 *
 * La copie est superficielle par pool : seul le premier niveau est
 * réécrit, le reste est partagé avec l'original, ce qui suffit puisque
 * l'empreinte n'y vit qu'à ce niveau.
 */
const poolsPublics = (data) => {
    const publics = {};
    for (const [nom, pool] of Object.entries(data || {})) {
        if (!pool || typeof pool !== "object") { publics[nom] = pool; continue; }
        const { passwordHash, ...reste } = pool;
        publics[nom] = { ...reste, hasPassword: !!passwordHash };
    }
    return publics;
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
        io.emit("draftUpdated", poolsPublics(freshData)); // ✅ Broadcast ONLY fresh data
        setTimeout(() => {
            io.emit("forceRefresh"); // 🔥 Envoie un signal aux clients pour recharger /draft
        }, 500);
    }, 200); // ✅ Small delay ensures data is fully written before broadcasting
};

// ==============================================
// HEAD-TO-HEAD HELPER FUNCTIONS
// ==============================================


// Calculate team fantasy points for a specific date range using player_game_logs
async function getTeamPointsForDateRange(teamData, startDateISO, endDateISO) {
    if (!teamData) return null;
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
            io.emit("draftUpdated", poolsPublics(draftData));
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
            io.emit("draftUpdated", poolsPublics(draftData));
        }, 2000); // ou 200ms
        // 🔔 Notifie tous les clients

    res.json({ message: `Clan ${clanName} supprimé avec succès !` });
});

// 📌 Route pour récupérer tous les pools et équipes
app.get("/draft", async (req, res) => {
    try {
        const draftData = await loadDraftData();
        console.log("📤 Draft envoyé :", Object.keys(draftData));
        res.json(poolsPublics(draftData));
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
            clan.turnStartedAt = Date.now();
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
        clan.turnStartedAt = Date.now();   // la pendule repart pour le tour suivant
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
        io.emit("draftUpdated", poolsPublics(draftData));
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

            clan.h2hData.seasonStart = currentMonday.toISOString(); // Permanent — never changes
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
            console.log("📅 Season starts:", currentMonday.toISOString());
        }
    }

    res.json({ message: `✅ ${playerName} a été sélectionné par ${userTeamName}.` });
});


/* 🔥 Sauter un tour qui traîne — pendule douce.
 *
 * Il n'y a pas de limite de temps dans Fantazy : personne n'est jamais
 * dépossédé de son choix par un chronomètre, et le serveur ne saute jamais
 * un tour de lui-même. Mais une salle figée sur quelqu'un qui a perdu son
 * réseau bloque tout le monde sans recours. Cette route est ce recours :
 * elle appartient à la personne qui a créé le pool, ne s'ouvre qu'après un
 * délai, et ne peut pas servir à se sauter soi-même pour repousser son choix.
 */
const SKIP_TURN_AFTER_MS = 180000;   // 3 minutes, même seuil que côté client

app.post("/skip-turn", async (req, res) => {
    const { clanName, username } = req.body;
    if (!clanName || !username) {
        return res.status(400).json({ message: "Données incomplètes." });
    }

    const draftData = await loadDraftData();
    const clan = draftData[clanName];
    if (!clan) return res.status(404).json({ message: "Pool introuvable." });

    // Le créateur : champ explicite sur les pools récents, premier membre
    // d'Équipe 1 pour ceux créés avant que le champ existe.
    const equipe1 = clan.teams && clan.teams["Équipe 1"];
    const createur = clan.creator || (equipe1 && equipe1.members && equipe1.members[0]) || null;
    if (!createur || createur !== username) {
        return res.status(403).json({ message: "Seule la personne qui a créé le pool peut sauter un tour." });
    }

    if (!Array.isArray(clan.draftOrder) || clan.draftOrder.length === 0) {
        return res.status(400).json({ message: "Le repêchage n'a pas encore commencé." });
    }
    if (clan.currentPickIndex >= clan.draftOrder.length - 1) {
        return res.status(400).json({ message: "Dernier tour : il n'y a plus de tour à sauter." });
    }

    // Se sauter soi-même reviendrait à repousser son propre choix sans
    // conséquence : refusé.
    const equipeDuTour = clan.draftOrder[clan.currentPickIndex];
    const monEquipe = Object.entries(clan.teams || {})
        .find(([, t]) => (t.members || []).includes(username));
    if (monEquipe && monEquipe[0] === equipeDuTour) {
        return res.status(403).json({ message: "Vous ne pouvez pas sauter votre propre tour." });
    }

    const depuis = Date.now() - (Number(clan.turnStartedAt) || 0);
    if (!clan.turnStartedAt || depuis < SKIP_TURN_AFTER_MS) {
        const reste = Math.ceil((SKIP_TURN_AFTER_MS - depuis) / 60000);
        return res.status(400).json({
            message: `Ce tour est trop récent. Réessayez dans ${Math.max(1, reste)} min.`
        });
    }

    // Aucune entrée dans picksHistory : c'est exactement ainsi que le client
    // reconnaît un tour sauté (buildPickSlots avance son curseur sans consommer
    // d'entrée). Le saut se dessine tout seul dans la bande de choix.
    clan.currentPickIndex += 1;
    clan.turnStartedAt = Date.now();
    await saveDraftData(draftData);

    io.emit("draftUpdated", poolsPublics(draftData));
    io.emit("forceRefresh");

    return res.json({ message: `Tour de ${equipeDuTour} sauté.`, skipped: equipeDuTour });
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
        const { name, maxPlayers, config, poolMode, allowTrades, username, password } = req.body;
        let draftData = await loadDraftData();

        if (draftData[name]) {
            return res.status(400).json({ message: "Ce clan existe déjà !" });
        }

        if (contientGrossierete(name)) {
            return res.status(400).json({
                message: "Ce nom de pool contient un terme inapproprié. Choisissez-en un autre."
            });
        }

        // Mot de passe du pool : facultatif, mais traité comme celui d'un
        // compte — même algorithme, même coût, jamais conservé en clair.
        // La borne haute vient de bcrypt, qui ignore silencieusement tout
        // octet au-delà du 72e : mieux vaut refuser que tronquer sans le dire.
        let passwordHash = null;
        if (typeof password === "string" && password.length > 0) {
            if (password.length < 4 || password.length > 72) {
                return res.status(400).json({
                    message: "Le mot de passe du pool doit contenir entre 4 et 72 caractères."
                });
            }
            passwordHash = await bcrypt.hash(password, 10);
        }

        // Default configuration values if not provided
        const poolConfig = config || {
            numOffensive: 6,
            numDefensive: 4,
            numGoalies: 1,
            numRookies: 1,
            numTeams: 1
        };
        // L'équipe LNH est de nouveau un choix du repêchage : la quantité
        // vient donc du formulaire (creer-pool.html), comme les autres
        // positions. Seul le défaut est imposé ici, si l'appelant n'envoie
        // rien — l'identité (/choose-nhl-club) ne remplit plus cette case.
        if (poolConfig.numTeams == null) poolConfig.numTeams = 1;

        // 🔥 Initialize 10 teams for the new clan
        let teams = {};
        for (let i = 1; i <= 10; i++) {
            // nhlClub : l'identité LNH choisie avant le repêchage (voir
            // /choose-nhl-club). null tant que personne n'a choisi.
            teams[`Équipe ${i}`] = { members: [], offensive: [], defensive: [], goalie: [], rookie: [], teams: [], nhlClub: null };
        }

        // ✅ Automatically add the creator to Équipe 1
        if (username) {
            teams['Équipe 1'].members.push(username);
        }

        // Initialize pool data
        draftData[name] = {
            maxPlayers: parseInt(maxPlayers),
            // Qui a créé le pool. Sert au repêchage : cette personne seule peut
            // sauter un tour qui traîne. Les pools créés avant ce champ sont
            // rattrapés côté client par le premier membre d'Équipe 1.
            creator: username || null,
            draftOrder: [],
            currentPickIndex: 0,
            lastPickIndex: -1,
            config: poolConfig,
            poolMode: poolMode || 'cumulative', // 'cumulative' or 'head-to-head'
            allowTrades: allowTrades !== false, // Default true
            teams
        };

        // Absent du pool quand il n'y a pas de mot de passe : poolsPublics()
        // en déduit `hasPassword: false` et l'interface n'en demande pas.
        if (passwordHash) {
            draftData[name].passwordHash = passwordHash;
        }

        // If Head-to-Head mode, initialize matchup structure
        if (poolMode === 'head-to-head') {
            draftData[name].h2hData = {
                currentWeek: 1,
                seasonStart: null, // Permanent start date — set when draft completes, never changes
                weekStart: null,   // Rolling current-week start — advances each week
                matchups: [],
                standings: {},
                matchupHistory: []
            };
        }

        await saveDraftData(draftData);
        setTimeout(() => {
        io.emit("draftUpdated", poolsPublics(draftData));
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
        io.emit("draftUpdated", poolsPublics(draftData));
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
            io.emit("draftUpdated", poolsPublics(draftData));
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
            io.emit("draftUpdated", poolsPublics(draftData));
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
    const { name, username, teamName, password } = req.body;
    let draftData = await loadDraftData();

    if (!draftData[name] || !draftData[name].teams[teamName]) {
        return res.status(400).json({ message: "Clan ou équipe introuvable !" });
    }

    // Mot de passe du pool : exigé pour entrer, pas pour changer d'équipe
    // une fois dedans. Un membre a déjà franchi la porte ; la lui refermer
    // au nez à chaque changement n'ajouterait rien à la sécurité.
    if (draftData[name].passwordHash) {
        const dejaMembre = Object.values(draftData[name].teams)
            .some(equipe => (equipe.members || []).includes(username));

        if (!dejaMembre) {
            if (typeof password !== "string" || password.length === 0) {
                return res.status(401).json({
                    message: "Ce pool est protégé par un mot de passe.",
                    passwordRequired: true
                });
            }
            const correspond = await bcrypt.compare(password, draftData[name].passwordHash);
            if (!correspond) {
                return res.status(401).json({
                    message: "Mot de passe incorrect.",
                    passwordRequired: true
                });
            }
        }
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
            io.emit("draftUpdated", poolsPublics(draftData));
        }, 2000); // ou 200ms
        // 🔔 Notifie tous les clients


    // ✅ Return full updated draft data so frontend refreshes
    res.json({
        message: `Vous avez rejoint l'équipe ${teamName} du clan ${name} avec succès !`,
        draftData: poolsPublics(draftData)
    });
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

        if (contientGrossierete(sanitized)) {
            return res.status(400).json({
                message: "Ce nom d'équipe contient un terme inapproprié. Choisissez-en un autre."
            });
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
        io.emit("draftUpdated", poolsPublics(draftData));

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

        // Le contrôle vit ici et pas seulement dans le formulaire : la route
        // est ouverte, un client n'est pas obligé de passer par la page.
        if (contientGrossierete(username)) {
            return res.status(400).json({
                message: "Ce nom d'utilisateur contient un terme inapproprié. Choisissez-en un autre."
            });
        }

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

        // Include avatarUrl so client can store it in localStorage
        const avatarUrl = USE_POSTGRES ? (user.avatarUrl || '') : (user.avatarUrl || '');
        res.json({ message: "Connexion réussie !", username, avatarUrl });

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

// ─── Droits Loi 25 : portabilité et suppression de compte ─────────────────────
// La politique de confidentialité promet ces droits ; ils doivent être
// réellement exécutables. Les deux routes exigent le mot de passe : ce sont des
// opérations sensibles (l'une expose toutes les données, l'autre les détruit).

/** Vérifie username + mot de passe. Retourne l'utilisateur ou null. */
const authenticateUser = async (username, password) => {
    if (!username || !password) return null;
    let user;
    if (USE_POSTGRES) {
        user = await db.getUserByUsername(username);
    } else {
        const users = await loadUsers();
        user = users.find(u => u.username === username);
    }
    if (!user) return null;
    const isMatch = await bcrypt.compare(password, user.password);
    return isMatch ? user : null;
};

// POST /account/export — portabilité : toutes les données de l'utilisateur.
app.post("/account/export", async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await authenticateUser(username, password);
        if (!user) return res.status(401).json({ message: "Identifiants invalides." });

        const draftData = await loadDraftData();
        const pools = [];
        Object.entries(draftData || {}).forEach(([poolName, poolData]) => {
            Object.entries(poolData.teams || {}).forEach(([teamName, teamData]) => {
                if ((teamData.members || []).includes(username)) {
                    pools.push({
                        pool: poolName,
                        equipe: teamName,
                        joueursRepeches: {
                            offensive: teamData.offensive || [],
                            defensive: teamData.defensive || [],
                            goalie: teamData.goalie || [],
                            team: teamData.team || []
                        }
                    });
                }
            });
        });

        // Le mot de passe (même haché) n'est jamais exporté.
        res.setHeader('Content-Disposition',
            `attachment; filename="fantazy-donnees-${username}.json"`);
        res.json({
            genereLe: new Date().toISOString(),
            compte: {
                nomUtilisateur: user.username,
                photoProfil: user.avatarUrl || null
            },
            pools,
            note: "Export complet des renseignements personnels détenus par Fantazy. "
                + "Le mot de passe n'est conservé que sous forme de empreinte bcrypt "
                + "et n'est pas exportable."
        });
    } catch (error) {
        console.error("Erreur lors de l'export du compte :", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

// POST /account/delete — droit à la suppression.
app.post("/account/delete", async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await authenticateUser(username, password);
        if (!user) return res.status(401).json({ message: "Identifiants invalides." });

        // 1. Dissocier l'utilisateur de tous les pools. On retire l'appartenance
        //    sans effacer les sélections : supprimer une équipe entière fausserait
        //    le classement des autres participants (cf. politique, section 5).
        const draftData = await loadDraftData();
        let poolsTouches = 0;
        Object.values(draftData || {}).forEach(poolData => {
            Object.values(poolData.teams || {}).forEach(teamData => {
                if (Array.isArray(teamData.members) && teamData.members.includes(username)) {
                    teamData.members = teamData.members.filter(m => m !== username);
                    poolsTouches++;
                }
            });
        });
        if (poolsTouches > 0) await saveDraftData(draftData);

        // 2. Supprimer la photo de profil téléversée.
        if (user.avatarUrl && user.avatarUrl.startsWith('/uploads/avatars/')) {
            const avatarPath = path.join(__dirname, user.avatarUrl.replace(/^\//, ''));
            try {
                if (fs.existsSync(avatarPath)) fs.unlinkSync(avatarPath);
            } catch (e) {
                console.warn("⚠️ Photo de profil non supprimée :", e.message);
            }
        }

        // 3. Supprimer le compte.
        if (USE_POSTGRES) {
            await db.deleteUser(username);
        } else {
            const users = await loadUsers();
            await saveUsers(users.filter(u => u.username !== username));
        }

        console.log(`🗑️ Compte supprimé : ${username} (dissocié de ${poolsTouches} équipe(s))`);
        res.json({ message: "Compte supprimé définitivement.", poolsTouches });
    } catch (error) {
        console.error("Erreur lors de la suppression du compte :", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

// ─── Profile picture endpoints ────────────────────────────────────────────────

// GET /user-profile/:username — public profile info (no password)
app.get("/user-profile/:username", async (req, res) => {
    try {
        const { username } = req.params;
        if (USE_POSTGRES) {
            const user = await db.getUserByUsername(username);
            if (!user) return res.status(404).json({ message: "Utilisateur non trouvé." });
            return res.json({ username: user.username, avatarUrl: user.avatarUrl || '' });
        } else {
            const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
            const user = users.find(u => u.username === username);
            if (!user) return res.status(404).json({ message: "Utilisateur non trouvé." });
            return res.json({ username: user.username, avatarUrl: user.avatarUrl || '' });
        }
    } catch (error) {
        console.error("Erreur /user-profile:", error);
        res.status(500).json({ message: "Erreur interne." });
    }
});

// POST /upload/user-avatar — multipart, field "avatar", body param "username"
app.post("/upload/user-avatar", uploadAvatar.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Aucun fichier reçu." });
        const { username } = req.body;
        if (!username) return res.status(400).json({ message: "Nom d'utilisateur requis." });

        const avatarUrl = `/uploads/avatars/${req.file.filename}`;

        if (USE_POSTGRES) {
            const existing = await db.getUserByUsername(username);
            if (!existing) return res.status(404).json({ message: "Utilisateur non trouvé." });
            // Delete old file if it was a local upload
            if (existing.avatarUrl && existing.avatarUrl.startsWith('/uploads/')) {
                const oldPath = path.join(__dirname, existing.avatarUrl);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            await db.updateUserAvatar(username, avatarUrl);
        } else {
            const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
            const idx = users.findIndex(u => u.username === username);
            if (idx === -1) return res.status(404).json({ message: "Utilisateur non trouvé." });
            // Delete old file
            if (users[idx].avatarUrl && users[idx].avatarUrl.startsWith('/uploads/')) {
                const oldPath = path.join(__dirname, users[idx].avatarUrl);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            users[idx].avatarUrl = avatarUrl;
            fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        }

        res.json({ avatarUrl });
    } catch (error) {
        console.error("Erreur upload avatar:", error);
        res.status(500).json({ message: error.message || "Erreur interne." });
    }
});

// POST /upload/pool-image — multipart, field "image", body param "poolName"
app.post("/upload/pool-image", uploadPool.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Aucun fichier reçu." });
        const { poolName } = req.body;
        if (!poolName) return res.status(400).json({ message: "Nom du pool requis." });

        const imageUrl = `/uploads/pools/${req.file.filename}`;
        const draftData = await loadDraftData();
        if (!draftData[poolName]) return res.status(404).json({ message: "Pool non trouvé." });

        // Delete old image if present
        if (draftData[poolName].imageUrl && draftData[poolName].imageUrl.startsWith('/uploads/')) {
            const oldPath = path.join(__dirname, draftData[poolName].imageUrl);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        draftData[poolName].imageUrl = imageUrl;
        await saveDraftData(draftData);

        res.json({ imageUrl });
    } catch (error) {
        console.error("Erreur upload pool image:", error);
        res.status(500).json({ message: error.message || "Erreur interne." });
    }
});

// Multer error handler (file type / size rejections)
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.message?.includes('non autorisé')) {
        return res.status(400).json({ message: err.message });
    }
    next(err);
});

// ──────────────────────────────────────────────────────────────────────────────

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


/* 🔥 Choisir l'identité LNH d'une équipe du pool — avant le repêchage.
 *
 * Chaque équipe du pool porte désormais les couleurs et l'écusson d'un vrai
 * club de la LNH sur toutes ses cartes de choix, du premier tour au dernier.
 * Ce choix doit donc être fait — et connu de tout le monde — avant que
 * l'ordre du repêchage existe : /start-draft refuse de démarrer tant qu'une
 * équipe éligible n'a pas choisi (voir plus bas).
 *
 * Changeable librement avant le début du repêchage ; verrouillé dès que
 * `draftOrder` existe, pour la même raison que les couleurs d'équipe sont
 * figées dans teamColors.js : deux personnes qui regardent la même bande
 * doivent voir la même chose.
 */
app.post("/choose-nhl-club", async (req, res) => {
    const { clanName, username, club } = req.body;
    if (!clanName || !username || !club) {
        return res.status(400).json({ message: "Données incomplètes." });
    }

    const code = String(club).trim().toUpperCase();
    if (!NHL_CLUB_CODES.has(code)) {
        return res.status(400).json({ message: "Équipe LNH invalide." });
    }

    const draftData = await loadDraftData();
    const clan = draftData[clanName];
    if (!clan) return res.status(404).json({ message: "Pool introuvable." });

    if (Array.isArray(clan.draftOrder) && clan.draftOrder.length > 0) {
        return res.status(403).json({ message: "Le repêchage est commencé : l'identité d'équipe ne peut plus changer." });
    }

    const entree = Object.entries(clan.teams || {})
        .find(([, t]) => (t.members || []).includes(username));
    if (!entree) return res.status(400).json({ message: "Vous n'êtes dans aucune équipe de ce pool." });
    const [teamName, team] = entree;

    // Deux équipes du même pool ne peuvent pas porter le même club : la bande
    // perdrait la seule chose qui distingue leurs cartes à l'œil.
    const dejaPrise = Object.entries(clan.teams || {})
        .find(([nom, t]) => nom !== teamName && t.nhlClub === code);
    if (dejaPrise) {
        return res.status(409).json({ message: `${dejaPrise[0]} a déjà choisi cette équipe.` });
    }

    // Identité seulement : couleurs et logo de l'équipe du pool. La case
    // « équipe LNH » du roster (team.teams) se remplit au repêchage, comme
    // toute autre position — choisir son identité ne consomme pas ce pick,
    // et rien n'oblige à repêcher le club dont on porte les couleurs.
    team.nhlClub = code;
    await saveDraftData(draftData);
    io.emit("draftUpdated", poolsPublics(draftData));

    return res.json({ message: `${teamName} portera les couleurs de ${code}.`, team: teamName, club: code });
});

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
        // Chaque équipe éligible doit avoir choisi son identité LNH avant que
        // l'ordre soit tiré — sans quoi la bande démarrerait avec des cartes
        // neutres que plus personne ne pourrait rattacher à une équipe.
        const sansClub = eligibleTeams.filter(nom => !clan.teams[nom].nhlClub);
        if (sansClub.length > 0) {
            return res.status(400).json({
                message: `En attente du choix d'équipe LNH : ${sansClub.join(', ')}.`,
                teamsWithoutClub: sansClub
            });
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

        // Aucun choix réel n'a encore eu lieu : tout ce que team.teams
        // contiendrait vient de l'époque où /choose-nhl-club remplissait
        // lui-même la case du roster. On repart de zéro, sinon ces pools
        // démarreraient avec leur case « équipe LNH » déjà pleine et le pick
        // correspondant serait impossible à faire.
        Object.values(clan.teams || {}).forEach(t => { t.teams = []; });

        clan.draftOrder = generateSnakeOrder(eligibleTeams, totalPicks);
        // Départ de la pendule du premier tour. L'heure vient du serveur pour
        // que les dix écrans comptent la même durée : une horloge locale ferait
        // dire à chacun autre chose, et « ça dure depuis 4 min » ne voudrait
        // plus rien dire.
        clan.turnStartedAt = Date.now();
        await saveDraftData(draftData);
        io.emit("draftUpdated", poolsPublics(draftData));
        return res.json({ message: "✅ Draft démarré avec succès avec ordre serpentin !" });
    } else {
        return res.json({ message: "Le draft est déjà en cours." });
    }
});


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
    res.json({ message: "Nettoyage effectué.", draftData: poolsPublics(draftData)[clanName] });
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
        let response = await fetch(url);

        if (!response.ok) {
            if (response.status === 429) {
                // Rate limited — wait 3 seconds and retry once
                console.log(`⏳ Rate limited on ${playerName}, retrying in 3s...`);
                await new Promise(r => setTimeout(r, 3000));
                response = await fetch(url);
            }
            if (!response.ok) {
                console.log(`⚠️ Failed to fetch stats for ${playerName} (${playerId}) — HTTP ${response.status}`);
                return null;
            }
        }

        const data = await response.json();

        // Construct headshot URL - NHL API provides headshots at this URL format
        const headshotUrl = data.headshot || `https://assets.nhle.com/mugs/nhl/20252026/${data.currentTeamAbbrev || 'NJD'}/${playerId}.png`;

        // Get the most recent NHL regular season — same approach as career modal which works correctly.
        // Never hardcode the season number; always derive it from the data to avoid type/year mismatches.
        const seasonTotals = data.seasonTotals || [];
        const nhlRegularSeasons = seasonTotals
            .filter(s => s.gameTypeId === 2 && s.leagueAbbrev === 'NHL')
            .sort((a, b) => Number(b.season) - Number(a.season));

        const latestSeason = nhlRegularSeasons[0] ? Number(nhlRegularSeasons[0].season) : null;
        console.log(`📋 ${playerName}: latest NHL season found = ${latestSeason}, entries = ${nhlRegularSeasons.length}`);

        // Only the CURRENT season is "current stats". A retired or inactive
        // player's most recent NHL season is an old one — accepting it here
        // wrote their last-active totals into the pool as if they were live
        // (this is how Dennis Wideman's 2016-17 line kept resurfacing).
        // Falls through to the featuredStats branch, then to zeros.
        const CURRENT_SEASON = 20252026;
        const nhlSeasonEntries = latestSeason === CURRENT_SEASON
            ? nhlRegularSeasons.filter(s => Number(s.season) === CURRENT_SEASON)
            : [];
        if (latestSeason && latestSeason !== CURRENT_SEASON) {
            console.log(`↩︎ ${playerName}: latest NHL season ${latestSeason} ≠ ${CURRENT_SEASON} — treating as no current stats`);
        }

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
            // Fallback: try featuredStats (NHL API's explicit current-season stats)
            const featured = data.featuredStats;
            if (featured && Number(featured.season) === 20252026) {
                const sub = isGoalie
                    ? featured.regularSeason?.subSeason
                    : featured.regularSeason?.subSeason;
                if (sub && (sub.gamesPlayed || 0) > 0) {
                    console.log(`✓ Using featuredStats for ${playerName} (seasonTotals filter missed)`);
                    seasonStats = {
                        gamesPlayed: sub.gamesPlayed || 0,
                        goals: sub.goals || sub.wins || 0,
                        assists: sub.assists || sub.losses || 0,
                        points: sub.points || 0,
                        wins: sub.wins || 0,
                        losses: sub.losses || 0,
                        shutouts: sub.shutouts || 0,
                        otLosses: sub.otLosses || 0,
                        saves: sub.saves || 0,
                        shotsAgainst: sub.shotsAgainst || 0,
                        savePct: sub.savePct || sub.savePercentage || 0
                    };
                    if (seasonStats.shotsAgainst > 0) {
                        seasonStats.savePct = seasonStats.saves / seasonStats.shotsAgainst;
                    }
                }
            }

            if (!seasonStats) {
                // No stats found at all - return zeros
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

            // Même ligne que le classement et les deux pages : la formule
            // vit dans lib/scoring.js, plus ici (voir goaliePoolPoints).
            calculatedPoints = goaliePoolPoints({ shutouts, wins, otLosses });
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

    // Fetch stats 3 at a time with 2s between batches — NHL API rate-limits at ~50 req/burst
    const STATS_BATCH = 3;
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
            await new Promise(resolve => setTimeout(resolve, 2000));
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
    // Always update in-memory cache immediately
    memStatsCache = currentStats;
    console.log(`✅ NHL stats updated successfully! ${currentStats.players.length} players in memory.`);

    // Also write stats back into nhl_filtered_stats.json so the frontend fallback is always current.
    // This guarantees correct stats even if the cache system (Postgres/file) fails to load.
    try {
        const statsFileData = JSON.parse(fs.readFileSync(NHL_STATS_FILE, 'utf-8'));
        const statsById = {};
        for (const p of newPlayers) {
            if (p.playerId) statsById[p.playerId] = p;
        }
        const updateSection = (arr, isGoalie) => arr.map(player => {
            const fresh = statsById[player.playerId];
            if (!fresh || fresh.gamesPlayed === 0) return player;
            if (isGoalie) {
                return { ...player, gamesPlayed: fresh.gamesPlayed, wins: fresh.wins, losses: fresh.losses, otLosses: fresh.otLosses, savePct: fresh.savePct, shutouts: fresh.shutouts, points: fresh.points };
            }
            return { ...player, gamesPlayed: fresh.gamesPlayed, goals: fresh.goals, assists: fresh.assists, points: fresh.points };
        });
        statsFileData.Top_100_Offensive_Players = updateSection(statsFileData.Top_100_Offensive_Players || [], false);
        statsFileData.Top_50_Defenders = updateSection(statsFileData.Top_50_Defenders || [], false);
        statsFileData.Top_Rookies = updateSection(statsFileData.Top_Rookies || [], false);
        statsFileData.Top_50_Goalies = updateSection(statsFileData.Top_50_Goalies || [], true);
        fs.writeFileSync(NHL_STATS_FILE, JSON.stringify(statsFileData, null, 4));
        console.log('✅ nhl_filtered_stats.json updated with current season stats.');
    } catch (err) {
        console.error('⚠️ Could not update nhl_filtered_stats.json:', err.message);
    }

    return currentStats;
}

// ── In-memory stats cache (bypasses Postgres entirely) ──────────────────────
// This is the single source of truth for /current-stats. Postgres/file cache
// is kept as a persistence layer but the in-memory object is always served.
let memStatsCache = { lastUpdated: null, season: null, players: [] };
let statsRefreshInProgress = false;

async function loadCurrentStats() {
    // Return in-memory cache if populated
    if (memStatsCache.players.length > 0) return memStatsCache;

    // Cold start: try Postgres, then file
    try {
        if (USE_POSTGRES) {
            const stats = await db.loadCachedStats('current-stats');
            if (stats && stats.players && stats.players.length > 0) {
                memStatsCache = stats;
                return memStatsCache;
            }
        } else if (fs.existsSync(CURRENT_STATS_FILE)) {
            const stats = JSON.parse(fs.readFileSync(CURRENT_STATS_FILE, 'utf-8'));
            if (stats && stats.players && stats.players.length > 0) {
                memStatsCache = stats;
                return memStatsCache;
            }
        }
    } catch (error) {
        console.error("❌ Error loading cached stats:", error);
    }

    return { lastUpdated: null, season: null, players: [] };
}


// Kicks off updateCurrentStats() in the background if a refresh isn't already
// running. Safe to call from the route or at startup — it never blocks.
function triggerBackgroundStatsRefresh(reason) {
    if (statsRefreshInProgress) return;
    console.log(`📊 Background stats refresh triggered: ${reason}`);
    statsRefreshInProgress = true;
    updateCurrentStats()
        .then(() => console.log("✅ Background stats refresh done"))
        .catch(e => console.error("❌ Background stats refresh failed:", e))
        .finally(() => { statsRefreshInProgress = false; });
}

// Route to get current stats
app.get("/current-stats", async (req, res) => {
    try {
        const stats = await loadCurrentStats();
        const { needsRefresh, reason } = getStatsRefreshStatus(stats, loadAllPlayers().length);

        if (!stats.lastUpdated) {
            // Nothing in memory or persistence — block and fetch now (first ever start)
            console.log("📊 No stats in memory, fetching synchronously...");
            const fresh = await updateCurrentStats();
            return res.json(fresh);
        }

        if (needsRefresh) {
            triggerBackgroundStatsRefresh(reason);
        }

        res.set('Cache-Control', 'no-store');
        res.json(stats);
    } catch (error) {
        console.error("❌ Error in /current-stats route:", error);
        res.status(500).json({ message: "Error fetching current stats" });
    }
});

// Snapshot every pool's rank/points "as of this morning", once a day, right
// after stats refresh — this is the baseline /pool-rank-movement diffs the
// live rank against. Must run AFTER updateCurrentStats() (needs fresh season
// totals) and BEFORE that evening's games (so it's a true start-of-day mark).
async function snapshotAllPoolRanks() {
    try {
        const pools = await db.getAllPools();
        const statsData = await loadCurrentStats();
        // Les clubs repêchés comptent dans le classement (2×V + DP) : sans
        // eux, le rang enregistré ici ne correspondrait pas au total que
        // classement.js affiche sur la même ligne.
        const teamsData = await loadCurrentTeams();
        const todayISO = new Date().toISOString().slice(0, 10);
        let rowCount = 0;

        for (const [poolName, poolData] of Object.entries(pools)) {
            const scores = computeTeamSeasonScores(poolData, statsData.players || [], teamsData.teams || []);
            for (const t of scores) {
                await db.query(`
                    INSERT INTO pool_rank_snapshots (pool_name, team_name, rank, points, snapshot_date)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (pool_name, team_name, snapshot_date)
                    DO UPDATE SET rank = EXCLUDED.rank, points = EXCLUDED.points
                `, [poolName, t.teamName, t.rank, t.score, todayISO]);
                rowCount++;
            }
        }
        console.log(`✅ Pool rank snapshot done: ${rowCount} team rows across ${Object.keys(pools).length} pools`);
    } catch (error) {
        console.error('❌ Error snapshotting pool ranks:', error.message);
    }
}

// Schedule daily stats update at midnight (00:00)
cron.schedule('0 0 * * *', async () => {
    console.log("⏰ Daily stats update triggered at midnight");
    await updateCurrentStats();
    await updateTeamStandings();
    await snapshotAllPoolRanks();
    // En dernier : c'est la seule tâche qui tolère d'être sautée (voir la
    // règle tout-ou-rien dans refreshNhlTransactions), les stats du pool
    // passent avant.
    await refreshNhlTransactions();
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

// Populate in-memory stats cache on startup (30s delay to let server fully boot)
setTimeout(async () => {
    console.log("🚀 Startup: loading player stats into memory...");
    try {
        await updateCurrentStats();
        console.log(`✅ Startup stats ready: ${memStatsCache.players.length} players in memory`);
    } catch (e) {
        console.error("❌ Startup stats load failed:", e.message);
    }
}, 30000);

// Debug endpoint — shows raw season data from NHL API for any player
app.get("/debug-player/:id", async (req, res) => {
    try {
        const response = await fetch(`https://api-web.nhle.com/v1/player/${req.params.id}/landing`);
        const data = await response.json();
        const seasons = (data.seasonTotals || []).map(s => ({
            season: s.season,
            seasonType: typeof s.season,
            gameTypeId: s.gameTypeId,
            leagueAbbrev: s.leagueAbbrev,
            gamesPlayed: s.gamesPlayed,
            points: s.points
        }));
        res.json({
            player: `${data.firstName?.default} ${data.lastName?.default}`,
            currentTeam: data.currentTeamAbbrev,
            featuredStatsSeason: data.featuredStats?.season,
            recentSeasons: seasons.filter(s => Number(s.season) >= 20242025)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
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
                // Barème de pool d'un club : formule partagée avec le
                // classement et les pages (lib/scoring.js, clubPoolPoints).
                const calculatedPoints = clubPoolPoints(team);

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

// ============================================================
// LIVE GAMES — real-time scores/periods/events for the home page's
// stories carousel. Same /v1/score/now endpoint the smart-update
// poller already calls internally, just reshaped for the client.
// Short cache only (live data moves fast); any failure returns an
// honest empty list rather than a 500 — the carousel just skips this
// slide type instead of breaking, exactly like "no games today."
// ============================================================
let liveGamesCache = { data: null, fetchedAt: 0 };
const LIVE_GAMES_TTL_MS = 25 * 1000;

app.get('/live-games', async (req, res) => {
    try {
        const now = Date.now();
        if (liveGamesCache.data && (now - liveGamesCache.fetchedAt) < LIVE_GAMES_TTL_MS) {
            return res.json(liveGamesCache.data);
        }

        const response = await fetch('https://api-web.nhle.com/v1/score/now');
        if (!response.ok) {
            return res.json({ games: [], generatedAt: new Date().toISOString() });
        }
        const data = await response.json();
        const allGames = data.games || [];

        const liveGames = allGames
            .filter(g => g.gameState === 'LIVE' || g.gameState === 'CRIT')
            .map(g => {
                // Most recent goals first — a story slide only has room for a
                // few, and "what just happened" matters more than the opener.
                const recentGoals = (g.goals || []).slice(-4).reverse().map(goal => ({
                    team: goal.teamAbbrev,
                    scorer: goal.name?.default || '',
                    assists: (goal.assists || []).map(a => a.name?.default).filter(Boolean),
                    period: goal.periodDescriptor?.number ?? goal.period ?? null,
                    timeInPeriod: goal.timeInPeriod || '',
                    strength: goal.strength || 'ev',
                    awayScore: goal.awayScore,
                    homeScore: goal.homeScore
                }));

                return {
                    id: g.id,
                    state: g.gameState,
                    period: g.periodDescriptor?.number ?? g.period ?? null,
                    periodType: g.periodDescriptor?.periodType || null,
                    clock: g.clock ? {
                        timeRemaining: g.clock.timeRemaining || '',
                        inIntermission: !!g.clock.inIntermission
                    } : null,
                    away: { abbrev: g.awayTeam?.abbrev || '', name: g.awayTeam?.name?.default || '', score: g.awayTeam?.score ?? 0 },
                    home: { abbrev: g.homeTeam?.abbrev || '', name: g.homeTeam?.name?.default || '', score: g.homeTeam?.score ?? 0 },
                    events: recentGoals
                };
            });

        const payload = { games: liveGames, generatedAt: new Date().toISOString() };
        liveGamesCache = { data: payload, fetchedAt: now };
        res.json(payload);
    } catch (error) {
        console.error('❌ Error fetching live games:', error.message);
        res.json({ games: [], generatedAt: new Date().toISOString() });
    }
});

// ============================================================
// SEASON SCHEDULE — powers the homepage's full-season calendar. Proxies
// NHL's own /v1/schedule/{date}, which returns a 7-day "gameWeek" window
// containing that date plus nextStartDate/previousStartDate. The frontend
// just keeps paging with those two dates to browse the whole season instead
// of being stuck on one hardcoded week.
// Cached per requested date: short TTL near "today" (scores move), long TTL
// further out (finished scores and the future schedule barely change).
// ============================================================
const scheduleCache = new Map(); // date -> { data, fetchedAt }
const SCHEDULE_NEAR_TTL_MS = 60 * 1000;
const SCHEDULE_FAR_TTL_MS = 12 * 60 * 60 * 1000;

app.get('/schedule/:date', async (req, res) => {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: 'Invalid date, expected YYYY-MM-DD' });
    }

    try {
        const todayISO = new Date().toISOString().slice(0, 10);
        const daysFromToday = Math.abs((new Date(date) - new Date(todayISO)) / 86400000);
        const ttl = daysFromToday <= 1 ? SCHEDULE_NEAR_TTL_MS : SCHEDULE_FAR_TTL_MS;

        const cached = scheduleCache.get(date);
        if (cached && (Date.now() - cached.fetchedAt) < ttl) {
            return res.json(cached.data);
        }

        const response = await fetch(`https://api-web.nhle.com/v1/schedule/${date}`);
        if (!response.ok) {
            return res.json({ days: [], nextStartDate: null, previousStartDate: null, preSeasonStartDate: null, regularSeasonStartDate: null, regularSeasonEndDate: null });
        }
        const raw = await response.json();

        const days = (raw.gameWeek || []).map(day => ({
            date: day.date,
            dayAbbrev: day.dayAbbrev,
            games: (day.games || []).map(g => ({
                id: g.id,
                state: g.gameState,
                startTimeUTC: g.startTimeUTC,
                period: g.periodDescriptor?.number ?? null,
                periodType: g.periodDescriptor?.periodType || null,
                clock: g.clock ? { timeRemaining: g.clock.timeRemaining || '', inIntermission: !!g.clock.inIntermission } : null,
                away: { abbrev: g.awayTeam?.abbrev || '', score: g.awayTeam?.score ?? null },
                home: { abbrev: g.homeTeam?.abbrev || '', score: g.homeTeam?.score ?? null }
            }))
        }));

        const payload = {
            days,
            nextStartDate: raw.nextStartDate || null,
            previousStartDate: raw.previousStartDate || null,
            preSeasonStartDate: raw.preSeasonStartDate || null,
            regularSeasonStartDate: raw.regularSeasonStartDate || null,
            regularSeasonEndDate: raw.regularSeasonEndDate || null
        };
        scheduleCache.set(date, { data: payload, fetchedAt: Date.now() });
        res.json(payload);
    } catch (error) {
        console.error('❌ Error fetching schedule:', error.message);
        res.json({ days: [], nextStartDate: null, previousStartDate: null, preSeasonStartDate: null, regularSeasonStartDate: null, regularSeasonEndDate: null });
    }
});

// ============================================================
// TONIGHT BOXSCORES — real per-player stat lines for every game that has
// started today, live or final. Deliberately reads NHL's boxscore endpoint
// directly rather than player_game_logs: that table is only written once a
// game goes FINAL (see checkAndUpdateFinishedGames's 15-min poll below), so
// it can't reflect a game still in progress. Boxscore has the current line
// either way. fantasyPointsTonight uses the same FANTASY_SCORING weights as
// getTeamPointsForDateRange, computed here so the client never re-derives
// scoring math itself.
// ============================================================
let tonightBoxscoresCache = { data: null, fetchedAt: 0 };
const TONIGHT_BOXSCORES_TTL_MS = 25 * 1000;


app.get('/tonight-boxscores', async (req, res) => {
    try {
        const now = Date.now();
        if (tonightBoxscoresCache.data && (now - tonightBoxscoresCache.fetchedAt) < TONIGHT_BOXSCORES_TTL_MS) {
            return res.json(tonightBoxscoresCache.data);
        }

        const scoreResponse = await fetch('https://api-web.nhle.com/v1/score/now');
        if (!scoreResponse.ok) return res.json({ players: [], games: [], generatedAt: new Date().toISOString() });
        const scoreData = await scoreResponse.json();
        const startedGames = (scoreData.games || []).filter(g =>
            ['LIVE', 'CRIT', 'FINAL', 'OFF'].includes(g.gameState));

        const boxscores = await Promise.all(startedGames.map(async g => {
            try {
                const res2 = await fetch(`https://api-web.nhle.com/v1/gamecenter/${g.id}/boxscore`);
                if (!res2.ok) return null;
                return await res2.json();
            } catch { return null; }
        }));

        const players = [];
        boxscores.forEach((box, i) => {
            if (!box) return;
            const game = startedGames[i];
            const stats = box.playerByGameStats || {};
            ['awayTeam', 'homeTeam'].forEach(side => {
                const teamAbbrev = box[side]?.abbrev || (side === 'awayTeam' ? game.awayTeam?.abbrev : game.homeTeam?.abbrev) || '';
                const roster = stats[side] || {};
                ['forwards', 'defense'].forEach(group => {
                    (roster[group] || []).forEach(p => {
                        players.push({
                            playerName: p.name?.default || '',
                            teamAbbrev,
                            position: 'F',
                            goals: p.goals || 0,
                            assists: p.assists || 0,
                            shots: p.sog || 0,
                            plusMinus: p.plusMinus || 0,
                            // toi : « 14:22 ». Sert la ligne meta des cartes
                            // joueur du calendrier (voir gamePlayersHTML,
                            // accueil-dash.js) — la seule donnée « en jeu »
                            // que la maquette Canvas-12 demande en plus.
                            toi: p.toi || '',
                            gameId: game.id,
                            gameState: game.gameState,
                            fantasyPointsTonight: skaterFantasyPointsTonight({
                                goals: p.goals, assists: p.assists, shots: p.sog, plusMinus: p.plusMinus
                            })
                        });
                    });
                });
                (roster.goalies || []).forEach(p => {
                    const decision = p.decision || null;
                    const shutout = (p.goalsAgainst === 0) && decision === 'W';
                    players.push({
                        playerName: p.name?.default || '',
                        teamAbbrev,
                        position: 'G',
                        saves: p.saveShotsAgainst ? parseInt((p.saveShotsAgainst.split('/')[0] || '0'), 10) : 0,
                        shotsAgainst: p.saveShotsAgainst ? parseInt((p.saveShotsAgainst.split('/')[1] || '0'), 10) : 0,
                        goalsAgainst: p.goalsAgainst || 0,
                        decision,
                        shutout,
                        toi: p.toi || '',
                        gameId: game.id,
                        gameState: game.gameState,
                        fantasyPointsTonight: goalieFantasyPointsTonight({
                            decision, shutout, saves: p.saveShotsAgainst ? parseInt((p.saveShotsAgainst.split('/')[0] || '0'), 10) : 0,
                            goalsAgainst: p.goalsAgainst
                        })
                    });
                });
            });
        });

        const games = startedGames.map(g => ({
            id: g.id,
            state: g.gameState,
            period: g.periodDescriptor?.number ?? null,
            periodType: g.periodDescriptor?.periodType || null,
            clock: g.clock ? { timeRemaining: g.clock.timeRemaining || '', inIntermission: !!g.clock.inIntermission } : null,
            away: { abbrev: g.awayTeam?.abbrev || '', score: g.awayTeam?.score ?? 0 },
            home: { abbrev: g.homeTeam?.abbrev || '', score: g.homeTeam?.score ?? 0 }
        }));

        const payload = { players, games, generatedAt: new Date().toISOString() };
        tonightBoxscoresCache = { data: payload, fetchedAt: now };
        res.json(payload);
    } catch (error) {
        console.error('❌ Error fetching tonight boxscores:', error.message);
        res.json({ players: [], games: [], generatedAt: new Date().toISOString() });
    }
});

// ============================================================
// POOL RANK MOVEMENT — real "moved up N places since this morning", backed
// by the daily snapshot snapshotAllPoolRanks() writes at midnight (see the
// cron section below). Never fabricated: if no snapshot exists yet for
// today, hasSnapshot is false and the frontend shows the plain current rank
// with no movement badge.
// ============================================================
app.get('/pool-rank-movement/:poolName', async (req, res) => {
    try {
        const { poolName } = req.params;
        const poolResult = await db.query('SELECT pool_data FROM pools WHERE pool_name = $1', [poolName]);
        if (poolResult.rows.length === 0) return res.status(404).json({ message: 'Pool not found' });
        const poolData = poolResult.rows[0].pool_data;

        const statsData = await loadCurrentStats();
        const teamsData = await loadCurrentTeams();
        const liveScores = computeTeamSeasonScores(poolData, statsData.players || [], teamsData.teams || []);

        const todayISO = new Date().toISOString().slice(0, 10);
        const snapResult = await db.query(
            `SELECT team_name, rank, points FROM pool_rank_snapshots WHERE pool_name = $1 AND snapshot_date = $2`,
            [poolName, todayISO]
        );

        if (snapResult.rows.length === 0) {
            return res.json({
                hasSnapshot: false,
                teams: liveScores.map(t => ({ teamName: t.teamName, rankNow: t.rank, pointsNow: t.score }))
            });
        }

        const snapByTeam = new Map(snapResult.rows.map(r => [r.team_name, r]));
        const teams = liveScores.map(t => {
            const snap = snapByTeam.get(t.teamName);
            return {
                teamName: t.teamName,
                rankNow: t.rank,
                pointsNow: t.score,
                rankToday: snap ? snap.rank : null,
                pointsToday: snap ? Number(snap.points) : null
            };
        });

        res.json({ hasSnapshot: true, teams });
    } catch (error) {
        console.error('❌ Error computing pool rank movement:', error.message);
        res.json({ hasSnapshot: false, teams: [] });
    }
});

// ============================================================
// NHL NEWS — real headlines (signings, trades, roster moves) for the
// stories carousel, via NewsAPI.org. Needs NEWSAPI_KEY in .env; with
// no key configured this returns an honest empty list, never an
// invented headline — the same "never fabricate" rule that already
// governs stats extends to news here. Cached for an hour: NewsAPI's
// free tier caps at 100 req/day, so real traffic can't map 1:1 onto
// upstream calls.
// ============================================================
let nhlNewsCache = { data: null, fetchedAt: 0 };
const NHL_NEWS_TTL_MS = 60 * 60 * 1000;

app.get('/nhl-news', async (req, res) => {
    try {
        if (!process.env.NEWSAPI_KEY) {
            return res.json({ articles: [], configured: false });
        }

        const now = Date.now();
        if (nhlNewsCache.data && (now - nhlNewsCache.fetchedAt) < NHL_NEWS_TTL_MS) {
            return res.json(nhlNewsCache.data);
        }

        // qInTitle (headline-only match), not q (full body text) — tested
        // both against live results: q surfaces general hockey content that
        // merely mentions a transaction in passing, while qInTitle returns
        // headlines that are actually about one.
        const query = encodeURIComponent('NHL AND (trade OR signs OR signing OR waived OR contract)');
        // timesofindia.indiatimes.com syndicates so heavily on this query
        // that it was crowding out every other outlet in testing.
        const excludeDomains = encodeURIComponent('timesofindia.indiatimes.com');
        const url = `https://newsapi.org/v2/everything?qInTitle=${query}&excludeDomains=${excludeDomains}&language=en&sortBy=publishedAt&pageSize=20&apiKey=${process.env.NEWSAPI_KEY}`;
        const response = await fetch(url);
        if (!response.ok) {
            console.error('❌ NewsAPI request failed:', response.status);
            return res.json({ articles: [], configured: true });
        }

        // Filtered again here, not just via the request param above: tested
        // live and excludeDomains came back unchanged (same totalResults,
        // same articles) — looks like a paid-tier-only filter that's
        // silently ignored on the free plan. This is the guaranteed path.
        const EXCLUDED_NEWS_DOMAINS = ['timesofindia.indiatimes.com'];

        const data = await response.json();
        const articles = (data.articles || [])
            .filter(a => a.urlToImage && a.title && a.url)
            .filter(a => !EXCLUDED_NEWS_DOMAINS.some(domain => a.url.includes(domain)))
            .slice(0, 10)
            .map(a => ({
                title: a.title,
                description: a.description || '',
                image: a.urlToImage,
                url: a.url,
                source: a.source?.name || 'NHL',
                publishedAt: a.publishedAt
            }));

        const payload = { articles, configured: true };
        nhlNewsCache = { data: payload, fetchedAt: now };
        res.json(payload);
    } catch (error) {
        console.error('❌ Error fetching NHL news:', error.message);
        res.json({ articles: [], configured: !!process.env.NEWSAPI_KEY });
    }
});

// ============================================================
// TRANSACTIONS LNH — échanges, signatures et départs déduits en
// comparant les alignements officiels d'un jour à l'autre.
//
// Aucune API de la LNH n'expose les transactions : vérifié route par
// route contre les deux références communautaires (dword4/nhlapi et
// Zmalski/NHL-API-Reference), ni l'une ni l'autre ne documente quoi que
// ce soit sur les échanges, le ballottage ou les signatures. En
// revanche /v1/roster/{TEAM}/current répond à l'année — hors-saison
// comprise — et chaque joueur y porte un id numérique stable.
// Photographier les 32 alignements chaque nuit et comparer deux photos
// donne donc du mouvement de joueurs réel et structuré, sans grattage
// de page ni donnée inventée :
//
//   présent des deux côtés, équipe différente → échange
//   absent hier, présent aujourd'hui          → signature
//   présent hier, absent aujourd'hui          → départ
//
// Limites assumées, à ne pas maquiller à l'affichage : le montant et la
// durée d'un contrat n'existent nulle part dans cette source, un échange
// de choix au repêchage seuls reste invisible (un choix ne figure sur
// aucun alignement), et rien n'est rétroactif — le journal ne commence
// qu'à la première photo, d'où le drapeau `tracking` renvoyé au client.
// ============================================================
const TRANSACTIONS_KEEP = 250;

// api-web étrangle les rafales : 32 requêtes en parallèle (même par lots
// de 8) reviennent toutes en HTTP 429, et à 400 ms d'intervalle un club
// se faisait encore refuser. Mesuré : en série à 1,2 s l'aller complet
// prend ~40 s et passe. C'est une tâche de nuit, la lenteur ne coûte rien.
const ROSTER_FETCH_DELAY_MS = 1200;
const ROSTER_FETCH_BACKOFF_MS = [0, 5000, 15000, 30000, 60000];
// En deçà, on soupçonne une panne générale plutôt que quelques clubs
// capricieux, et on préfère ne rien enregistrer.
const MIN_TEAMS_FOR_SNAPSHOT = 28;

/**
 * Un alignement, avec reprise sur étranglement. Renvoie la liste des
 * joueurs, ou null si le club reste inaccessible — jamais une liste vide,
 * qu'un appelant pourrait confondre avec un club sans joueurs.
 */
async function fetchOneRoster(code) {
    for (let attempt = 0; attempt < ROSTER_FETCH_BACKOFF_MS.length; attempt++) {
        if (ROSTER_FETCH_BACKOFF_MS[attempt]) {
            await new Promise(resolve => setTimeout(resolve, ROSTER_FETCH_BACKOFF_MS[attempt]));
        }
        try {
            const response = await fetch(`https://api-web.nhle.com/v1/roster/${code}/current`);
            if (response.status === 429) continue; // étranglé : on repasse par le backoff
            if (!response.ok) return null;
            const data = await response.json();
            const roster = [
                ...(data.forwards || []),
                ...(data.defensemen || []),
                ...(data.goalies || [])
            ];
            // Un alignement vide est une réponse anormale, pas un club sans
            // joueurs : le traiter comme un échec plutôt que comme 40 départs.
            return roster.length ? roster : null;
        } catch (error) {
            // Coupure réseau : le backoff nous donne une tentative de plus.
        }
    }
    return null;
}

/**
 * Photographie les alignements, un club à la fois. Renvoie la carte plate
 * id → { name, team, pos, num, headshot }, plus la liste des clubs
 * réellement joints — l'appelant en a besoin pour ne pas confondre
 * « ce joueur est parti » et « ce club n'a pas répondu ».
 */
async function fetchAllRosters() {
    const players = {};
    const fetchedTeams = new Set();
    const failedTeams = [];

    for (const code of NHL_CLUB_CODES) {
        const roster = await fetchOneRoster(code);
        if (!roster) { failedTeams.push(code); continue; }

        fetchedTeams.add(code);
        roster.forEach(p => {
            players[p.id] = {
                name: `${p.firstName?.default || ''} ${p.lastName?.default || ''}`.trim(),
                team: code,
                pos: p.positionCode || null,
                num: p.sweaterNumber || null,
                headshot: p.headshot || null
            };
        });

        await new Promise(resolve => setTimeout(resolve, ROSTER_FETCH_DELAY_MS));
    }

    return { players, fetchedTeams, failedTeams };
}


async function loadRosterSnapshot() {
    try {
        if (USE_POSTGRES) {
            const snap = await db.loadCachedStats('nhl-roster-snapshot');
            if (snap) return snap;
        } else if (fs.existsSync(ROSTER_SNAPSHOT_FILE)) {
            return JSON.parse(fs.readFileSync(ROSTER_SNAPSHOT_FILE, 'utf-8'));
        }
    } catch (error) {
        console.error('❌ Error loading roster snapshot:', error.message);
    }
    return null;
}

async function saveRosterSnapshot(snapshot) {
    if (USE_POSTGRES) {
        await db.saveCachedStats('nhl-roster-snapshot', snapshot);
    } else {
        fs.writeFileSync(ROSTER_SNAPSHOT_FILE, JSON.stringify(snapshot));
    }
}

async function loadNhlTransactions() {
    try {
        if (USE_POSTGRES) {
            const log = await db.loadCachedStats('nhl-transactions');
            if (log) return log;
        } else if (fs.existsSync(TRANSACTIONS_FILE)) {
            return JSON.parse(fs.readFileSync(TRANSACTIONS_FILE, 'utf-8'));
        }
    } catch (error) {
        console.error('❌ Error loading NHL transactions:', error.message);
    }
    return { lastUpdated: null, transactions: [] };
}

async function saveNhlTransactions(log) {
    if (USE_POSTGRES) {
        await db.saveCachedStats('nhl-transactions', log);
    } else {
        fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify(log, null, 2));
    }
}

/**
 * Le journal servi par /nhl-transactions a deux sources : les mouvements
 * détectés chaque nuit par comparaison d'alignements (loadNhlTransactions
 * ci-dessus) ET des échanges saisis à la main, versionnés dans
 * ./nhl_transactions.json. En prod le store est PostgreSQL (cached_stats),
 * jamais ce fichier — rien n'importe les entrées manuelles, donc l'onglet
 * « Échanges » du panneau hors-saison reste vide quel que soit le nombre
 * de redéploiements. Ici, au démarrage : lire le store actif, y réinjecter
 * toute entrée du fichier absente par `id` (même clé de dédoublonnage que
 * doRefreshNhlTransactions), retrier du plus récent au plus ancien pour
 * que la fenêtre ?limit=N les inclue, puis réécrire — mais seulement s'il
 * y a du nouveau, pour ne pas piocher dans la base à chaque boot.
 * Idempotent, et ne touche jamais ce que le cron a écrit.
 */
async function seedCuratedNhlTransactions() {
    let curated;
    try {
        curated = JSON.parse(fs.readFileSync('./nhl_transactions.json', 'utf-8'));
    } catch (error) {
        console.warn('⚠️  Pas de nhl_transactions.json versionné à réinjecter:', error.message);
        return;
    }
    const fromRepo = curated.transactions || [];
    if (!fromRepo.length) return;

    const log = await loadNhlTransactions();
    const existing = log.transactions || [];
    const seen = new Set(existing.map(t => t.id));
    const added = fromRepo.filter(t => t.id && !seen.has(t.id));
    if (!added.length) {
        console.log('⊙ Échanges manuels déjà tous présents dans le journal LNH');
        return;
    }

    const merged = [...existing, ...added]
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    await saveNhlTransactions({ lastUpdated: log.lastUpdated || curated.lastUpdated || null, transactions: merged });
    console.log(`✅ ${added.length} échange(s) manuel(s) réinjecté(s) dans le journal LNH (${merged.length} au total)`);
}

/**
 * Prend une photo, la compare à la précédente, ajoute ce qui est
 * nouveau au journal. Idempotent : rejouable dans la même journée sans
 * dupliquer une transaction.
 */
// La photo de démarrage peut encore tourner quand le cron de minuit se
// déclenche (elle dure ~40 s, davantage si api-web étrangle). Deux
// balayages simultanés, c'est 64 requêtes en même temps et le 429 garanti
// pour les deux. Le second appel se raccroche donc au premier.
let rosterRefreshInFlight = null;

function refreshNhlTransactions() {
    if (rosterRefreshInFlight) {
        console.log('⏳ Photographie déjà en cours — appel rattaché à celle-ci');
        return rosterRefreshInFlight;
    }
    rosterRefreshInFlight = doRefreshNhlTransactions()
        .finally(() => { rosterRefreshInFlight = null; });
    return rosterRefreshInFlight;
}

async function doRefreshNhlTransactions() {
    console.log('🔄 Photographie des alignements LNH...');
    const { players, fetchedTeams, failedTeams } = await fetchAllRosters();

    // Sous ce seuil, ce n'est plus un club capricieux mais une panne
    // (réseau coupé, api-web en carafe) : la photo ne vaut rien.
    if (fetchedTeams.size < MIN_TEAMS_FOR_SNAPSHOT) {
        console.log(`⚠️ ${fetchedTeams.size}/${NHL_CLUB_CODES.size} alignements seulement — photo ignorée`);
        return;
    }

    const complete = failedTeams.length === 0;
    if (!complete) {
        console.log(`⚠️ Clubs injoignables (${failedTeams.join(', ')}) — départs non calculés cette fois`);
    }

    const capturedAt = new Date().toISOString();
    const dateISO = capturedAt.slice(0, 10);
    const previous = await loadRosterSnapshot();

    // Les clubs injoignables gardent leurs joueurs de la photo précédente,
    // sinon la prochaine comparaison les verrait tous « signer » d'un coup.
    // Le `!players[id]` est essentiel : un joueur passé d'un club muet à un
    // club joint est déjà dans la photo neuve, sous sa *nouvelle* équipe —
    // le reporter le renverrait dans son ancienne.
    const snapshotPlayers = { ...players };
    if (!complete && previous?.players) {
        Object.entries(previous.players).forEach(([id, p]) => {
            if (!players[id] && !fetchedTeams.has(p.team)) snapshotPlayers[id] = p;
        });
    }

    if (!previous?.players || !Object.keys(previous.players).length) {
        await saveRosterSnapshot({ capturedAt, players: snapshotPlayers });
        console.log(`✅ Photo de référence enregistrée (${Object.keys(snapshotPlayers).length} joueurs) — le journal démarre à la prochaine photo`);
        return;
    }

    const moves = diffRosterSnapshots(previous.players, snapshotPlayers, dateISO, complete);
    const log = await loadNhlTransactions();
    const known = new Set((log.transactions || []).map(t => t.id));
    const fresh = moves.filter(t => !known.has(t.id));

    await saveNhlTransactions({
        // Toujours retouché, même sans mouvement : `lastUpdated` dit « le
        // journal est à jour », pas « quelque chose a bougé ».
        lastUpdated: capturedAt,
        transactions: [...fresh, ...(log.transactions || [])].slice(0, TRANSACTIONS_KEEP)
    });
    await saveRosterSnapshot({ capturedAt, players: snapshotPlayers });

    console.log(fresh.length
        ? `✅ ${fresh.length} transaction(s) détectée(s) : ${fresh.filter(t => t.type === 'trade').length} échange(s), ${fresh.filter(t => t.type === 'signing').length} signature(s), ${fresh.filter(t => t.type === 'departure').length} départ(s)`
        : '✅ Aucun mouvement depuis la dernière photo');
}

/**
 * Au démarrage : prendre la photo de référence si elle manque, plutôt
 * que d'attendre minuit — le journal ne peut rien détecter tant qu'il
 * n'a pas un premier point de comparaison. Sans effet si une photo
 * existe déjà, le cron de minuit prend alors le relais.
 */
async function seedRosterSnapshotOnStartup() {
    try {
        const existing = await loadRosterSnapshot();
        if (existing?.players && Object.keys(existing.players).length) return;
        console.log('📸 Aucune photo de référence des alignements — capture initiale...');
        await refreshNhlTransactions();
    } catch (error) {
        console.error('❌ Error seeding roster snapshot:', error.message);
    }
}

/**
 * Rejouer la photo à la demande : utile au lendemain d'une grosse
 * journée d'échanges, et seul moyen de reprendre la main si le cron de
 * minuit a sauté. Protégée par un jeton — l'appel déclenche ~40 s de
 * requêtes vers api-web, ça ne se laisse pas ouvert. Sans ADMIN_TOKEN
 * configuré la route reste fermée plutôt que grande ouverte.
 */
app.post('/nhl-transactions/refresh', async (req, res) => {
    const token = process.env.ADMIN_TOKEN;
    if (!token || req.get('x-admin-token') !== token) {
        return res.status(403).json({ message: 'Interdit' });
    }
    try {
        await refreshNhlTransactions();
        const log = await loadNhlTransactions();
        res.json({ ok: true, lastUpdated: log.lastUpdated, total: (log.transactions || []).length });
    } catch (error) {
        console.error('❌ Error refreshing NHL transactions:', error.message);
        res.status(500).json({ ok: false, message: error.message });
    }
});

app.get('/nhl-transactions', async (req, res) => {
    try {
        const log = await loadNhlTransactions();
        const all = log.transactions || [];
        let transactions = all;

        const { type, team } = req.query;
        if (type && type !== 'all') {
            const wanted = new Set(String(type).split(',').map(s => s.trim()));
            transactions = transactions.filter(t => wanted.has(t.type));
        }
        if (team) {
            const code = String(team).toUpperCase();
            transactions = transactions.filter(t => t.fromTeam === code || t.toTeam === code);
        }

        const limit = Math.min(parseInt(req.query.limit, 10) || 50, TRANSACTIONS_KEEP);

        res.json({
            lastUpdated: log.lastUpdated || null,
            // Avant la première photo le journal est vide sans que la ligue
            // soit calme : le client doit pouvoir distinguer « rien à
            // signaler » de « on n'observe pas encore ».
            tracking: !!log.lastUpdated,
            counts: {
                trade: all.filter(t => t.type === 'trade').length,
                signing: all.filter(t => t.type === 'signing').length,
                departure: all.filter(t => t.type === 'departure').length
            },
            transactions: transactions.slice(0, limit)
        });
    } catch (error) {
        console.error('❌ Error serving NHL transactions:', error.message);
        res.json({ lastUpdated: null, tracking: false, counts: { trade: 0, signing: 0, departure: 0 }, transactions: [] });
    }
});

// ============================================================
// BLESSÉS — api-web.nhle.com n'expose aucun rapport de blessures (un
// alignement ne dit pas qui est blessé), mais ESPN en publie un,
// structuré et sans clé : statut, nature, date de retour prévue. Chaque
// entrée porte déjà l'abréviation officielle du club dans
// athlete.team.abbreviation, donc aucune table nom → code n'est
// nécessaire. Caché 30 min.
// ============================================================
const INJURY_STATUS_FR = {
    'Out': 'Absent',
    'Injured Reserve': 'Réserve des blessés',
    'Day-To-Day': 'Au jour le jour',
    'Suspension': 'Suspension'
};

// ESPN n'emploie pas toujours l'abréviation officielle de la LNH (LA au
// lieu de LAK, NJ pour NJD…). Sans cette table, `team` sortirait d'ici
// avec un code que ni NHL_CLUB_FULLNAME, ni /teams/XXX.png, ni les stats
// du jour (teamAbbrev) ne reconnaissent — la ligne perdait son nom de
// club et le rapprochement joueur ↔ blessure côté client échouait.
const ESPN_TO_NHL_ABBREV = {
    LA: 'LAK', NJ: 'NJD', SJ: 'SJS', TB: 'TBL',
    VGS: 'VGK', UTAH: 'UTA', MON: 'MTL', WAS: 'WSH', CLS: 'CBJ'
};

let nhlInjuriesCache = { data: null, fetchedAt: 0 };
const NHL_INJURIES_TTL_MS = 30 * 60 * 1000;

app.get('/nhl-injuries', async (req, res) => {
    try {
        const now = Date.now();
        if (!nhlInjuriesCache.data || (now - nhlInjuriesCache.fetchedAt) >= NHL_INJURIES_TTL_MS) {
            const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries');
            if (!response.ok) {
                console.error('❌ ESPN injuries request failed:', response.status);
                return res.json({ lastUpdated: null, injuries: [], counts: {} });
            }
            const data = await response.json();

            const injuries = [];
            (data.injuries || []).forEach(teamEntry => {
                (teamEntry.injuries || []).forEach(entry => {
                    const athlete = entry.athlete || {};
                    const raw = athlete.team?.abbreviation || null;
                    const code = raw ? (ESPN_TO_NHL_ABBREV[raw.toUpperCase()] || raw.toUpperCase()) : null;
                    if (!code || !athlete.displayName) return;
                    injuries.push({
                        playerName: athlete.displayName,
                        pos: athlete.position?.abbreviation || null,
                        headshot: athlete.headshot?.href || null,
                        team: code,
                        teamName: NHL_CLUB_FULLNAME[code] || teamEntry.displayName || code,
                        status: entry.status || null,
                        statusFr: INJURY_STATUS_FR[entry.status] || entry.status || null,
                        // `type` est la partie du corps (« Knee »), `detail`
                        // la précision (« Surgery ») — les deux peuvent
                        // manquer, d'où le null plutôt qu'une chaîne vide.
                        injuryType: entry.details?.type || null,
                        injuryDetail: entry.details?.detail || null,
                        // « Not Specified » revient très souvent dans `side` :
                        // le laisser passer ferait écrire « Genou (Not
                        // Specified) » au client, d'où le null ici.
                        injurySide: entry.details?.side && entry.details.side !== 'Not Specified'
                            ? entry.details.side : null,
                        returnDate: entry.details?.returnDate || null,
                        since: entry.date || null,
                        comment: entry.longComment || entry.shortComment || null
                    });
                });
            });

            // Les plus récemment déclarés d'abord. Trier par statut puis par
            // nom paraissait plus logique, mais le client n'affiche qu'une
            // poignée de lignes : par ordre alphabétique, cette poignée
            // n'aurait aucun sens (les Anderson, toujours), alors que par
            // date elle répond à « quoi de neuf ». Statut en départage.
            const ORDER = ['Injured Reserve', 'Out', 'Suspension', 'Day-To-Day'];
            injuries.sort((a, b) => {
                const dateDiff = new Date(b.since || 0) - new Date(a.since || 0);
                if (dateDiff) return dateDiff;
                const rank = ORDER.indexOf(a.status) - ORDER.indexOf(b.status);
                return rank !== 0 ? rank : a.playerName.localeCompare(b.playerName);
            });

            nhlInjuriesCache = {
                data: { lastUpdated: new Date().toISOString(), injuries },
                fetchedAt: now
            };
        }

        const payload = nhlInjuriesCache.data;
        let injuries = payload.injuries;

        if (req.query.team) {
            const code = String(req.query.team).toUpperCase();
            injuries = injuries.filter(i => i.team === code);
        }
        if (req.query.status) {
            const wanted = new Set(String(req.query.status).split(',').map(s => s.trim()));
            injuries = injuries.filter(i => wanted.has(i.status));
        }

        const counts = {};
        payload.injuries.forEach(i => { counts[i.status] = (counts[i.status] || 0) + 1; });

        res.json({
            lastUpdated: payload.lastUpdated,
            total: payload.injuries.length,
            counts,
            injuries: injuries.slice(0, Math.min(parseInt(req.query.limit, 10) || 100, 300))
        });
    } catch (error) {
        console.error('❌ Error fetching NHL injuries:', error.message);
        res.json({ lastUpdated: null, total: 0, counts: {}, injuries: [] });
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

// Route to get top-5 stat leaders (points/goals/assists/wins) for the homepage hero.
// Reads the same cached file as /hot-players, which updateCurrentStats() keeps
// patched with live current-season points/goals/assists/wins.
app.get('/stats-leaders', async (req, res) => {
    try {
        const filteredStatsPath = path.join(__dirname, 'nhl_filtered_stats.json');

        if (!fs.existsSync(filteredStatsPath)) {
            console.error('❌ nhl_filtered_stats.json not found');
            return res.json({ forwardsPoints: [], defensePoints: [], goalsLeaders: [], assistsLeaders: [], rookiePoints: [], goalieWins: [] });
        }

        const filteredStats = JSON.parse(fs.readFileSync(filteredStatsPath, 'utf-8'));

        const toSkater = p => ({
            playerId: p.playerId,
            playerName: p.skaterFullName,
            teamAbbrev: p.teamAbbrevs,
            position: p.positionCode,
            headshot: `https://assets.nhle.com/mugs/nhl/20252026/${p.teamAbbrevs}/${p.playerId}.png`,
            gamesPlayed: p.gamesPlayed,
            goals: p.goals,
            assists: p.assists,
            points: p.points
        });
        const toGoalie = p => ({
            playerId: p.playerId,
            playerName: p.goalieFullName,
            teamAbbrev: p.teamAbbrevs,
            position: 'G',
            headshot: `https://assets.nhle.com/mugs/nhl/20252026/${p.teamAbbrevs}/${p.playerId}.png`,
            gamesPlayed: p.gamesPlayed,
            wins: p.wins,
            points: p.points
        });

        const forwards   = (filteredStats.Top_100_Offensive_Players || []).filter(p => p.gamesPlayed > 0);
        const defenders  = (filteredStats.Top_50_Defenders || []).filter(p => p.gamesPlayed > 0);
        const rookies    = (filteredStats.Top_Rookies || []).filter(p => p.gamesPlayed > 0 && p.positionCode !== 'G');
        const goalies    = (filteredStats.Top_50_Goalies || []).filter(p => p.gamesPlayed > 0);
        const allSkaters = [...forwards, ...defenders];

        const top5 = (arr, key) => [...arr].sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(0, 5);

        res.json({
            forwardsPoints: top5(forwards, 'points').map(toSkater),
            defensePoints:  top5(defenders, 'points').map(toSkater),
            goalsLeaders:   top5(allSkaters, 'goals').map(toSkater),
            assistsLeaders: top5(allSkaters, 'assists').map(toSkater),
            rookiePoints:   top5(rookies, 'points').map(toSkater),
            goalieWins:     top5(goalies, 'wins').map(toGoalie)
        });
    } catch (error) {
        console.error('❌ Error fetching stats leaders:', error);
        res.status(500).json({ message: 'Error fetching stats leaders' });
    }
});

// ==================== HOT PLAYERS - TIME RANGE (FANTASY POINTS) ====================

// Caches for different time ranges
let last7DaysCache = { lastUpdated: null, data: null };
let last14DaysCache = { lastUpdated: null, data: null };
let last30DaysCache = { lastUpdated: null, data: null };
let last180DaysCache = { lastUpdated: null, data: null };


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

// 6-month fallback: used by the home page when no games happened in the last 30 days
app.get('/hot-players-last180days', async (req, res) => {
    try {
        const now = Date.now();
        if (last180DaysCache.data && last180DaysCache.lastUpdated &&
            (now - last180DaysCache.lastUpdated) < (15 * 60 * 1000)) {
            return res.json(last180DaysCache.data);
        }
        const data = await calculateHotPlayers(180);
        last180DaysCache = { lastUpdated: now, data };
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
        if (USE_POSTGRES) {
            const tradesResult = await db.query(
                'SELECT id, pool_name, trade_data, status, created_at FROM trades ORDER BY created_at DESC'
            );

            const allTrades = tradesResult.rows.map(row => ({
                id: row.id,
                draftName: row.pool_name,
                ...row.trade_data,
                status: row.status
            }));

            return res.json(allTrades);
        }

        // JSON-file fallback (dev without a database)
        const trades = await loadTrades();
        const allTrades = [...(trades.completed || []), ...(trades.pending || [])]
            .sort((a, b) => new Date(b.date) - new Date(a.date));
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

        if (USE_POSTGRES) {
            // Get completed AND declined trades from PostgreSQL — the
            // Historique tab shows both, muted for declined (see trade.js).
            const tradesResult = await db.query(
                "SELECT id, pool_name, trade_data, status, created_at, updated_at FROM trades WHERE status IN ('completed', 'declined') ORDER BY COALESCE(updated_at, created_at) DESC"
            );

            console.log(`Total completed/declined trades in DB: ${tradesResult.rows.length}`);

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
                        status: row.status,
                        date: tradeData.date,
                        completedDate: tradeData.completedDate || row.updated_at || row.created_at
                    });
                }
            }

            console.log(`Found ${userCompletedTrades.length} completed/declined trades for ${username}`);
            return res.json(userCompletedTrades);
        }

        // JSON-file fallback (dev without a database)
        const trades = await loadTrades();
        const draftData = await loadDraftData();

        const userCompletedTrades = (trades.completed || []).filter(trade => {
            const pool = draftData[trade.draftName];
            const fromTeam = pool?.teams?.[trade.fromTeam];
            const toTeam = pool?.teams?.[trade.toTeam];
            if (!fromTeam || !toTeam) return false;
            return fromTeam.members?.includes(username) || toTeam.members?.includes(username);
        });

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

        if (USE_POSTGRES) {
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
            return res.json(userPendingTrades);
        }

        // JSON-file fallback (dev without a database)
        const trades = await loadTrades();
        const draftData = await loadDraftData();

        const userPendingTrades = (trades.pending || []).filter(trade => {
            const pool = draftData[trade.draftName];
            const targetTeam = pool?.teams?.[trade.toTeam];
            return targetTeam?.members?.includes(username);
        });

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

        // Le repêchage doit être terminé pour TOUTES les équipes avant qu'un
        // échange ait un sens : sinon on négocierait des joueurs qu'un pick
        // à venir pourrait encore rendre indisponibles, ou qu'une équipe
        // n'a même pas fini de sélectionner. Le client bloque déjà l'assistant
        // (voir trade.js), ce contrôle est la version qui ne se contourne pas.
        if (!checkIfDraftComplete(pool)) {
            return res.status(403).json({
                message: "Le repêchage de ce pool n'est pas encore terminé. Les échanges ouvrent une fois tous les choix faits."
            });
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

        // A "for sale" listing on a player who just changed teams would be
        // actively misleading, so it auto-clears here — the one case a
        // listing disappears without the owner manually unlisting it.
        await db.removeTradeListingByPlayer(poolName, trade.offering[0].name);
        await db.removeTradeListingByPlayer(poolName, trade.receiving[0].name);

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

// ============================================================
// TRADE LISTINGS — a member flags one of their own players as open
// to offers. A visibility signal only: it does not change the 1-for-1,
// same-category rule /trade/propose already enforces.
// ============================================================

// Get all active listings for a pool
app.get('/trade-listings/:poolName', async (req, res) => {
    try {
        const { poolName } = req.params;
        const listings = await db.getActiveListingsForPool(poolName);
        res.json(listings);
    } catch (error) {
        console.error("Error loading trade listings:", error);
        res.status(500).json({ message: "Error loading trade listings" });
    }
});

// List a player as open to offers
app.post('/trade-listings', async (req, res) => {
    try {
        const { poolName, teamName, playerName, category, username } = req.body;

        if (!poolName || !teamName || !playerName || !category || !username) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        const poolResult = await db.query('SELECT pool_data FROM pools WHERE pool_name = $1', [poolName]);
        if (poolResult.rows.length === 0) {
            return res.status(404).json({ message: "Pool not found" });
        }

        const pool = poolResult.rows[0].pool_data;
        const teamData = pool.teams[teamName];
        if (!teamData) {
            return res.status(404).json({ message: "Équipe introuvable" });
        }

        if (!teamData.members || !teamData.members.includes(username)) {
            return res.status(403).json({ message: "Vous ne faites pas partie de cette équipe" });
        }

        if (!teamHasPlayer(teamData, { type: category, name: playerName })) {
            return res.status(400).json({ message: "Vous ne possédez pas ce joueur" });
        }

        if (!checkIfDraftComplete(pool)) {
            return res.status(403).json({ message: "Le repêchage de ce pool n'est pas encore terminé." });
        }

        const id = await db.createTradeListing(poolName, teamName, playerName, category, username);
        if (id === null) {
            return res.status(409).json({ message: "Ce joueur est déjà en vente" });
        }

        io.emit('tradeListingsUpdated', { poolName });
        console.log(`🏷️ ${playerName} listed for trade by ${teamName} (${poolName})`);
        res.json({ id, message: "Joueur mis en vente" });
    } catch (error) {
        console.error("Error creating trade listing:", error);
        res.status(500).json({ message: "Error creating trade listing" });
    }
});

// Remove a listing (manual unlist)
app.post('/trade-listings/:id/remove', async (req, res) => {
    try {
        const { id } = req.params;
        const { username } = req.body;

        if (!username) {
            return res.status(400).json({ message: "Missing username" });
        }

        const listing = await db.getTradeListingById(id);
        if (!listing || listing.status !== 'active') {
            return res.status(404).json({ message: "Annonce introuvable" });
        }

        const poolResult = await db.query('SELECT pool_data FROM pools WHERE pool_name = $1', [listing.poolName]);
        if (poolResult.rows.length === 0) {
            return res.status(404).json({ message: "Pool not found" });
        }
        const teamData = poolResult.rows[0].pool_data.teams[listing.teamName];
        if (!teamData || !teamData.members || !teamData.members.includes(username)) {
            return res.status(403).json({ message: "Vous ne faites pas partie de cette équipe" });
        }

        const removed = await db.removeTradeListing(Number(id), listing.poolName, listing.teamName);
        if (!removed) {
            return res.status(404).json({ message: "Annonce déjà retirée" });
        }

        io.emit('tradeListingsUpdated', { poolName: listing.poolName });
        res.json({ message: "Joueur retiré de la vente" });
    } catch (error) {
        console.error("Error removing trade listing:", error);
        res.status(500).json({ message: "Error removing trade listing" });
    }
});

// ============================================================
// POOL LEADERBOARD — best team over a trailing window (7/14/30/90/
// 180/365 days). Reuses getTeamPointsForDateRange's real per-game data,
// with the same season-totals fallback /h2h/finalize-week already uses
// when game logs don't cover the range. Never fabricates a number: a
// team with no data anywhere gets points:null, not a made-up 0.
// ============================================================
const LEADERBOARD_WINDOWS = [1, 7, 14, 30, 90, 180, 365];

app.get('/pool-leaderboard/:poolName', async (req, res) => {
    try {
        const { poolName } = req.params;
        let days = parseInt(req.query.days, 10);
        if (!LEADERBOARD_WINDOWS.includes(days)) days = 7;

        const poolResult = await db.query('SELECT pool_data FROM pools WHERE pool_name = $1', [poolName]);
        if (poolResult.rows.length === 0) {
            return res.status(404).json({ message: "Pool not found" });
        }
        const pool = poolResult.rows[0].pool_data;

        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

        const activeTeams = Object.entries(pool.teams || {})
            .filter(([, teamData]) => (teamData.members || []).length > 0);

        // Le repli sur les totaux de saison s'applique à TOUTES les équipes ou
        // à aucune. Appliqué équipe par équipe, il plaçait dans un même tableau
        // des cumuls d'année à côté de pointages d'une seule période : le
        // classement n'était alors comparable pour personne.
        const pointsParEquipe = await Promise.all(
            activeTeams.map(async ([, teamData]) => getTeamPointsForDateRange(teamData, startDate, endDate))
        );

        let source = 'gameLogs';
        let currentStats = null;
        if (pointsParEquipe.some(p => p === null)) {
            currentStats = await loadCurrentStats();
            source = (currentStats && currentStats.players && currentStats.players.length > 0)
                ? 'seasonFallback'
                : 'none';
        }

        const teams = activeTeams.map(([teamName, teamData], i) => ({
            teamName,
            members: teamData.members || [],
            points: source === 'gameLogs' ? pointsParEquipe[i]
                : source === 'seasonFallback' ? getTeamWeeklyPoints(teamData, currentStats)
                    : null,
            source
        }));

        teams.sort((a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity));
        teams.forEach((t, i) => { t.rank = i + 1; });

        res.json({ poolName, days, generatedAt: new Date().toISOString(), teams });
    } catch (error) {
        console.error("Error building pool leaderboard:", error);
        res.status(500).json({ message: "Error building pool leaderboard" });
    }
});


// ✅ Hall of Fame: best/worst single day, week, and month of fantasy points
// scored by any team in the pool this season, from player_game_logs.
// Same FANTASY_SCORING formula as getTeamPointsForDateRange (used by the
// weekly leaderboard) — NOT the same scale as the cumulative "PPts" column
// on the standings table. NHL-team roster picks aren't included: there's no
// historical game-by-game team-win log, same gap as the leaderboard route.
app.get('/pool-hall-of-fame/:poolName', async (req, res) => {
    try {
        const { poolName } = req.params;
        const poolResult = await db.query('SELECT pool_data FROM pools WHERE pool_name = $1', [poolName]);
        if (poolResult.rows.length === 0) {
            return res.status(404).json({ message: "Pool not found" });
        }
        const pool = poolResult.rows[0].pool_data;

        const activeTeams = Object.entries(pool.teams || {})
            .filter(([, teamData]) => (teamData.members || []).length > 0);

        const teamByPlayer = new Map();
        const teamMeta = new Map();
        activeTeams.forEach(([teamName, teamData]) => {
            teamMeta.set(teamName, { members: teamData.members || [] });
            ['offensive', 'defensive', 'rookie'].forEach(pos => {
                (teamData[pos] || []).forEach(p => {
                    const name = (typeof p === 'string') ? p : (p.skaterFullName || p.goalieFullName || p);
                    if (name) teamByPlayer.set(name, teamName);
                });
            });
            (teamData.goalie || []).forEach(p => {
                const name = (typeof p === 'string') ? p : (p.goalieFullName || p.skaterFullName || p);
                if (name) teamByPlayer.set(name, teamName);
            });
        });

        const empty = { poolName, generatedAt: new Date().toISOString(), bestDay: null, worstDay: null, bestWeek: null, worstWeek: null, bestMonth: null, worstMonth: null };
        const allNames = [...teamByPlayer.keys()];
        if (allNames.length === 0) return res.json(empty);

        const result = await db.query(`
            SELECT player_name, game_date, position,
                   goals, assists, shots, plus_minus,
                   power_play_goals, power_play_points,
                   shorthanded_goals, shorthanded_points,
                   game_winning_goals,
                   decision, saves, goals_against, shutouts
            FROM player_game_logs
            WHERE season = '20252026'
              AND player_name = ANY($1)
        `, [allNames]);

        if (result.rows.length === 0) return res.json(empty);

        // teamName -> 'YYYY-MM-DD' -> fantasy points
        const dailyByTeam = new Map();
        result.rows.forEach(game => {
            const teamName = teamByPlayer.get(game.player_name);
            if (!teamName) return;

            let fp = 0;
            if (game.position === 'G') {
                fp += (game.decision === 'W') ? FANTASY_SCORING.win : 0;
                fp += (game.shutouts || 0) * FANTASY_SCORING.shutout;
                fp += (game.saves || 0) * FANTASY_SCORING.save;
                fp += (game.goals_against || 0) * FANTASY_SCORING.goalsAgainst;
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
            }

            const dateStr = game.game_date.toISOString().slice(0, 10);
            if (!dailyByTeam.has(teamName)) dailyByTeam.set(teamName, new Map());
            const teamDaily = dailyByTeam.get(teamName);
            teamDaily.set(dateStr, (teamDaily.get(dateStr) || 0) + fp);
        });

        // Roll daily totals up into per-team weeks (Mon-start) and months,
        // only for periods where the team actually had a logged game.
        const dayEntries = [];
        const weekTotals = new Map();  // "team|weekStart" -> points
        const monthTotals = new Map(); // "team|YYYY-MM" -> points

        dailyByTeam.forEach((dates, teamName) => {
            dates.forEach((points, dateStr) => {
                dayEntries.push({ teamName, dateStr, points: Math.round(points * 10) / 10 });

                const weekKey = `${teamName}|${mondayOfWeek(dateStr)}`;
                weekTotals.set(weekKey, (weekTotals.get(weekKey) || 0) + points);

                const monthKey = `${teamName}|${dateStr.slice(0, 7)}`;
                monthTotals.set(monthKey, (monthTotals.get(monthKey) || 0) + points);
            });
        });

        const splitEntries = (totals) => [...totals.entries()].map(([key, points]) => {
            const sep = key.lastIndexOf('|');
            return { teamName: key.slice(0, sep), dateStr: key.slice(sep + 1), points: Math.round(points * 10) / 10 };
        });
        const weekEntries = splitEntries(weekTotals);
        const monthEntries = splitEntries(monthTotals).map(e => ({ ...e, dateStr: `${e.dateStr}-01` }));

        const pickBest = (entries) => entries.length ? entries.reduce((a, b) => b.points > a.points ? b : a) : null;
        const pickWorst = (entries) => entries.length ? entries.reduce((a, b) => b.points < a.points ? b : a) : null;
        const toResult = (entry) => !entry ? null : {
            teamName: entry.teamName,
            members: (teamMeta.get(entry.teamName) || {}).members || [],
            points: entry.points,
            date: entry.dateStr
        };

        res.json({
            poolName,
            generatedAt: new Date().toISOString(),
            bestDay: toResult(pickBest(dayEntries)),
            worstDay: toResult(pickWorst(dayEntries)),
            bestWeek: toResult(pickBest(weekEntries)),
            worstWeek: toResult(pickWorst(weekEntries)),
            bestMonth: toResult(pickBest(monthEntries)),
            worstMonth: toResult(pickWorst(monthEntries))
        });
    } catch (error) {
        console.error("Error building pool hall of fame:", error);
        res.status(500).json({ message: "Error building pool hall of fame" });
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
        //
        // Passe préalable : on pointe TOUS les duels avant d'écrire quoi que ce
        // soit. Une semaine se finalise en entier ou pas du tout — un classement
        // à moitié inscrit serait pire que pas de classement, et il n'existe
        // aucun repli valable quand les feuilles de match manquent (voir la note
        // sur les unités plus bas).
        const pointages = [];
        for (const matchup of weekMatchups) {
            const team1Data = clan.teams[matchup.team1];
            const team2Data = clan.teams[matchup.team2];
            if (!team1Data) console.warn(`⚠️ finalize-week: team "${matchup.team1}" not found in pool ${poolName}`);
            if (!team2Data) console.warn(`⚠️ finalize-week: team "${matchup.team2}" not found in pool ${poolName}`);

            const t1pts = await getTeamPointsForDateRange(team1Data, weekStart, weekEnd);
            const t2pts = await getTeamPointsForDateRange(team2Data, weekStart, weekEnd);
            pointages.push({ matchup, t1pts, t2pts });
        }

        // Repli sur les totaux de saison : tout le monde ou personne.
        //
        // Ces totaux sont cumulés depuis le début de l'année, dans une autre
        // unité que le pointage hebdomadaire. Appliqués duel par duel, ils
        // opposaient un cumul de saison au pointage d'une seule semaine dès
        // qu'un seul côté manquait — victoire garantie pour celui-là. Appliqués
        // à tout le monde, la comparaison redevient équitable, ce qui permet à
        // un environnement dépourvu de feuilles de match de fonctionner.
        const valeurs = pointages.flatMap(p => [p.t1pts, p.t2pts]);
        const aucuneFeuille = valeurs.every(v => v === null);
        const feuillesPartielles = !aucuneFeuille && valeurs.some(v => v === null);

        if (feuillesPartielles) {
            const noms = pointages
                .filter(p => p.t1pts === null || p.t2pts === null)
                .map(p => `${p.matchup.team1} / ${p.matchup.team2}`).join(', ');
            console.warn(`⏸️ Week ${currentWeek} non finalisée (${poolName}) : feuilles de match incomplètes — ${noms}`);
            return res.status(503).json({
                message: `Semaine ${currentWeek} non finalisée : les feuilles de match sont incomplètes (${noms}). Elles arrivent par lots ; réessayez plus tard.`,
                weekNumber: currentWeek,
                missing: pointages.filter(p => p.t1pts === null || p.t2pts === null)
                    .map(p => ({ team1: p.matchup.team1, team2: p.matchup.team2 }))
            });
        }

        if (aucuneFeuille) {
            console.warn(`⚠️ Week ${currentWeek} (${poolName}) : aucune feuille de match — repli sur les totaux de saison pour TOUTES les équipes.`);
            const currentStats = await loadCurrentStats();
            for (const p of pointages) {
                p.t1pts = getTeamWeeklyPoints(clan.teams[p.matchup.team1], currentStats);
                p.t2pts = getTeamWeeklyPoints(clan.teams[p.matchup.team2], currentStats);
            }
        }

        for (const { matchup, t1pts, t2pts } of pointages) {
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
            .map(([teamName, teamData]) => ({ name: teamName, members: teamData.members }));

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
                    // Derive the correct weekStart from seasonStart so week N always maps to the
                    // right calendar dates, even after a server restart or missed catch-up.
                    const now = new Date();
                    let monday;
                    if (clan.h2hData.seasonStart) {
                        monday = new Date(clan.h2hData.seasonStart);
                        monday.setDate(monday.getDate() + (currentWeek - 1) * 7);
                    } else {
                        // Fallback for legacy pools without seasonStart
                        monday = new Date(now);
                        const dayOfWeek = now.getDay();
                        monday.setDate(now.getDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek));
                        monday.setHours(0, 0, 0, 0);
                    }

                    clan.h2hData.weekStart = monday.toISOString();
                    clan.h2hData.currentWeek = currentWeek;
                    clan.h2hData.matchups[currentWeek - 1] = newMatchups.map(m => ({ ...m, weekNumber: currentWeek }));

                    if (!clan.h2hData.standings) clan.h2hData.standings = {};
                    activeTeams.forEach(t => ensureStandingsEntry(clan.h2hData.standings, t.name));

                    const draftData2 = await loadDraftData();
                    draftData2[poolName] = clan;
                    await saveDraftData(draftData2);

                    console.log(`✅ Auto-generated ${newMatchups.length} matchups for week ${currentWeek}, weekStart: ${monday.toISOString()}`);

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

            let weekStart = new Date(clan.h2hData.weekStart);
            let weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 7);
            const now = new Date();

            // Backfill ALL missed weeks in a single pass (safety cap: 52 weeks)
            let catchUpCount = 0;
            const MAX_CATCHUP = 52;

            while (now >= weekEnd && catchUpCount < MAX_CATCHUP) {
                const currentWeek = clan.h2hData.currentWeek;
                const weekMatchups = clan.h2hData.matchups[currentWeek - 1];

                if (!weekMatchups || weekMatchups.length === 0) {
                    console.log(`⚠️ No matchups for Week ${currentWeek} in pool ${poolName} — stopping catch-up`);
                    break;
                }

                console.log(`🔔 Auto-finalizing Week ${currentWeek} for pool: ${poolName}`);

                // Passe préalable : pointer tous les duels avant d'écrire.
                // Sans feuilles de match, la semaine n'est PAS finalisée — on
                // sort de la boucle de rattrapage et le prochain passage
                // reprendra la même semaine. Substituer les totaux de saison,
                // comme ici avant, mélangeait deux unités et pouvait opposer un
                // cumul d'année au pointage d'une seule semaine.
                const pointages = [];
                for (const matchup of weekMatchups) {
                    const team1Data = clan.teams[matchup.team1];
                    const team2Data = clan.teams[matchup.team2];
                    if (!team1Data) console.warn(`⚠️ Auto-finalize: team "${matchup.team1}" not found in pool ${poolName}`);
                    if (!team2Data) console.warn(`⚠️ Auto-finalize: team "${matchup.team2}" not found in pool ${poolName}`);

                    const t1pts = await getTeamPointsForDateRange(team1Data, weekStart, weekEnd);
                    const t2pts = await getTeamPointsForDateRange(team2Data, weekStart, weekEnd);
                    pointages.push({ matchup, t1pts, t2pts });
                }

                // Même règle que la route manuelle : repli pour tout le monde
                // ou pour personne. Une semaine à moitié pointée n'est pas
                // finalisée du tout — la boucle la reprendra au prochain
                // passage, quand les feuilles seront arrivées.
                const valeurs = pointages.flatMap(p => [p.t1pts, p.t2pts]);
                const aucuneFeuille = valeurs.every(v => v === null);

                if (!aucuneFeuille && valeurs.some(v => v === null)) {
                    console.warn(`⏸️ Semaine ${currentWeek} de ${poolName} laissée en attente : feuilles de match incomplètes. Reprise au prochain passage.`);
                    break;
                }

                if (aucuneFeuille) {
                    console.warn(`⚠️ Semaine ${currentWeek} de ${poolName} : aucune feuille de match — repli sur les totaux de saison pour TOUTES les équipes.`);
                    const currentStats = await loadCurrentStats();
                    for (const p of pointages) {
                        p.t1pts = getTeamWeeklyPoints(clan.teams[p.matchup.team1], currentStats);
                        p.t2pts = getTeamWeeklyPoints(clan.teams[p.matchup.team2], currentStats);
                    }
                }

                for (const { matchup, t1pts, t2pts } of pointages) {
                    matchup.team1Points = t1pts;
                    matchup.team2Points = t2pts;
                    matchup.weekNumber = currentWeek;

                    ensureStandingsEntry(clan.h2hData.standings, matchup.team1);
                    ensureStandingsEntry(clan.h2hData.standings, matchup.team2);

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

                    clan.h2hData.standings[matchup.team1].pointsFor  += matchup.team1Points;
                    clan.h2hData.standings[matchup.team1].pointsAgainst += matchup.team2Points;
                    clan.h2hData.standings[matchup.team2].pointsFor  += matchup.team2Points;
                    clan.h2hData.standings[matchup.team2].pointsAgainst += matchup.team1Points;
                }

                if (!clan.h2hData.matchupHistory) clan.h2hData.matchupHistory = [];
                clan.h2hData.matchupHistory.push({
                    weekNumber: currentWeek,
                    weekStart: weekStart.toISOString(),
                    weekEnd: weekEnd.toISOString(),
                    matchups: weekMatchups,
                    completedDate: now.toISOString()
                });

                // Generate new matchups before advancing the counter
                const activeTeams = Object.entries(clan.teams)
                    .filter(([_, teamData]) => teamData.members && teamData.members.length > 0)
                    .map(([teamName, teamData]) => ({ name: teamName, members: teamData.members }));
                const nextWeekMatchups = generateWeeklyMatchups(activeTeams, clan.h2hData.matchups);

                clan.h2hData.currentWeek++;
                clan.h2hData.matchups.push(
                    nextWeekMatchups.map(m => ({ ...m, weekNumber: clan.h2hData.currentWeek }))
                );

                // Roll the window forward by exactly 7 days
                weekStart = new Date(weekEnd);
                weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 7);
                clan.h2hData.weekStart = weekStart.toISOString();

                catchUpCount++;
            }

            if (catchUpCount > 0) {
                console.log(`✅ Pool ${poolName}: caught up ${catchUpCount} week(s), now at Week ${clan.h2hData.currentWeek}`);
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
            },
            {
                name: 'nhl_roster_snapshot.json',
                source: './nhl_roster_snapshot.json',
                dest: ROSTER_SNAPSHOT_FILE,
                // Pas de joueurs = pas de photo de référence : la première
                // exécution en prend une et ne déduit rien, plutôt que de
                // traiter 1 300 joueurs comme autant de signatures.
                defaultContent: '{"capturedAt":null,"players":{}}'
            },
            {
                name: 'nhl_transactions.json',
                source: './nhl_transactions.json',
                dest: TRANSACTIONS_FILE,
                defaultContent: '{"transactions":[],"lastUpdated":null}'
            }
        ];

        dataFiles.forEach(({ name, source, dest, defaultContent }) => {
            // Skip if destination file already exists. NB : pour
            // nhl_transactions.json, les échanges manuels ajoutés au fichier
            // versionné après ce premier passage sont réinjectés plus tard
            // par seedCuratedNhlTransactions (qui couvre aussi PostgreSQL).
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

// ──────────────────────────────────────────────────────────────────────────
// TEST-ONLY UTILITIES  (never available in production)
// ──────────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {

    // Set h2hData.weekStart and/or currentWeek directly — used to simulate time passing
    app.post('/test/h2h-set-state', async (req, res) => {
        const { poolName, weekStart, currentWeek, seasonStart } = req.body;
        const draftData = await loadDraftData();
        const clan = draftData[poolName];
        if (!clan || !clan.h2hData)
            return res.status(404).json({ message: 'Pool not found or not H2H' });
        if (weekStart   !== undefined) clan.h2hData.weekStart   = weekStart;
        if (seasonStart !== undefined) clan.h2hData.seasonStart = seasonStart;
        if (currentWeek !== undefined) clan.h2hData.currentWeek = currentWeek;
        await saveDraftData(draftData);
        res.json({ ok: true, weekStart: clan.h2hData.weekStart, seasonStart: clan.h2hData.seasonStart, currentWeek: clan.h2hData.currentWeek });
    });

    // Trigger the auto-finalize check and return new state for all H2H pools
    app.post('/test/h2h-trigger-catchup', async (req, res) => {
        await checkAndFinalizeCompletedWeeks();
        const draftData = await loadDraftData();
        const result = {};
        for (const [name, clan] of Object.entries(draftData)) {
            if (clan.poolMode === 'head-to-head' && clan.h2hData) {
                result[name] = {
                    currentWeek: clan.h2hData.currentWeek,
                    weekStart: clan.h2hData.weekStart,
                    seasonStart: clan.h2hData.seasonStart,
                    historyLength: (clan.h2hData.matchupHistory || []).length,
                    standings: clan.h2hData.standings
                };
            }
        }
        res.json({ ok: true, pools: result });
    });
}

// ===============================================
// SERVER INITIALIZATION
// ===============================================

// Loads the local stats/team cache into memory right away (so the app never
// starts with no data), then checks in the background whether that cache is
// stale and refreshes it from the NHL API if needed. Runs once at boot,
// independent of any client hitting /current-stats or /current-teams first.
async function warmStatsOnStartup() {
    try {
        const stats = await loadCurrentStats();
        if (stats.lastUpdated) {
            console.log(`📊 Local player stats loaded: ${stats.players.length} players (last updated ${stats.lastUpdated})`);
        } else {
            console.log('📊 No local player stats cache found on disk.');
        }

        const { needsRefresh, reason } = getStatsRefreshStatus(stats, loadAllPlayers().length);
        if (needsRefresh) {
            triggerBackgroundStatsRefresh(`startup check — ${reason}`);
        } else {
            console.log(`📊 Local player stats are fresh (${reason}) — no refresh needed.`);
        }
    } catch (error) {
        console.error('❌ Error warming player stats on startup:', error);
    }

    try {
        const teams = await loadCurrentTeams();
        const teamsAgeHours = teams.lastUpdated
            ? (Date.now() - new Date(teams.lastUpdated).getTime()) / 3600000
            : Infinity;

        if (teams.lastUpdated) {
            console.log(`📊 Local team standings loaded: ${teams.teams.length} teams (last updated ${teams.lastUpdated})`);
        } else {
            console.log('📊 No local team standings cache found on disk.');
        }

        if (!teams.lastUpdated || teamsAgeHours > 24) {
            const reason = teams.lastUpdated ? `cache is ${teamsAgeHours.toFixed(1)}h old` : 'no local cache yet';
            console.log(`📊 Background team standings refresh triggered: startup check — ${reason}`);
            updateTeamStandings()
                .then(() => console.log('✅ Background team standings refresh done'))
                .catch(e => console.error('❌ Background team standings refresh failed:', e));
        } else {
            console.log(`📊 Local team standings are fresh (${teamsAgeHours.toFixed(1)}h old) — no refresh needed.`);
        }
    } catch (error) {
        console.error('❌ Error warming team standings on startup:', error);
    }
}

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

        // Réinjecter les échanges saisis à la main dans le journal LNH du
        // store actif (fichier ou PostgreSQL) — voir seedCuratedNhlTransactions.
        // Après l'init du store, avant d'écouter : rapide, et un échec est
        // sans gravité (le cron nocturne reste la source des mouvements réels).
        try {
            await seedCuratedNhlTransactions();
        } catch (error) {
            console.error('❌ Error seeding curated NHL transactions:', error.message);
        }

        // ✅ Start Server with WebSockets (after all routes are defined)
        server.listen(PORT, () => {
            console.log(`🚀 Serveur WebSocket en cours d'exécution sur http://localhost:${PORT}`);
            console.log(`🚀 Serveur en cours d'exécution sur http://localhost:${PORT}`);
            console.log(`📁 Data directory: ${DATA_DIR}`);
            console.log(`💾 Using ${USE_POSTGRES ? 'PostgreSQL' : 'JSON files'} for data storage`);

            // Fire-and-forget: serve local cached data immediately, refresh in
            // the background if stale. Never blocks server startup.
            warmStatsOnStartup();
            seedRosterSnapshotOnStartup();
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server
startServer();
