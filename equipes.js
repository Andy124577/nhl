const BASE_URL = window.location.hostname.includes("localhost")
  ? "http://localhost:3000"
  : window.location.origin;

let _playerMap = null; // name → { playerId, teamAbbrevs }

async function loadPlayerMap() {
    if (_playerMap) return _playerMap;
    try {
        const r = await fetch('nhl_filtered_stats.json');
        const d = await r.json();
        _playerMap = {};
        [...(d.Top_100_Offensive_Players||[]), ...(d.Top_50_Defenders||[]), ...(d.Top_Rookies||[])].forEach(p => {
            if (p.skaterFullName) _playerMap[p.skaterFullName] = { playerId: p.playerId, teamAbbrevs: p.teamAbbrevs };
        });
        (d.Top_50_Goalies||[]).forEach(p => {
            if (p.goalieFullName) _playerMap[p.goalieFullName] = { playerId: p.playerId, teamAbbrevs: p.teamAbbrevs };
        });
    } catch(e) { _playerMap = {}; }
    return _playerMap;
}

function playerHeadshotUrl(name) {
    const info = _playerMap && _playerMap[name];
    if (info && info.playerId) return `https://assets.web.nhl.com/mugs/nhl/latest/${info.playerId}.png`;
    return null;
}

function buildPicksSection(teamData) {
    const categories = [
        { key: 'offensive', label: 'Attaquants', isTeam: false },
        { key: 'defensive', label: 'Défenseurs', isTeam: false },
        { key: 'rookie',    label: 'Recrues',    isTeam: false },
        { key: 'goalie',    label: 'Gardien',    isTeam: false },
        { key: 'teams',     label: 'Équipes NHL', isTeam: true },
    ];
    const hasPicks = categories.some(c => (teamData[c.key] || []).length > 0);
    if (!hasPicks) return '';

    let html = '<div class="picks-section">';
    categories.forEach(({ key, label, isTeam }) => {
        const picks = teamData[key] || [];
        if (!picks.length) return;
        html += `<div class="picks-category"><span class="picks-cat-label">${label}</span><div class="picks-players">`;
        picks.forEach(name => {
            if (isTeam) {
                const abbrev = NHL_ABBREV[name];
                const src = abbrev ? `teams/${abbrev}.png` : null;
                html += `<div class="pick-chip" title="${name}">
                    ${src ? `<img src="${src}" class="pick-headshot pick-team-logo" onerror="this.style.display='none'">` : ''}
                    <span class="pick-name">${name}</span>
                </div>`;
            } else {
                const url = playerHeadshotUrl(name);
                html += `<div class="pick-chip" title="${name}">
                    ${url ? `<img src="${url}" class="pick-headshot" onerror="this.style.display='none'">` : ''}
                    <span class="pick-name">${name}</span>
                </div>`;
            }
        });
        html += '</div></div>';
    });
    html += '</div>';
    return html;
}

const NHL_ABBREV = {
    "Anaheim Ducks": "ANA", "Boston Bruins": "BOS", "Buffalo Sabres": "BUF",
    "Calgary Flames": "CGY", "Carolina Hurricanes": "CAR", "Chicago Blackhawks": "CHI",
    "Colorado Avalanche": "COL", "Columbus Blue Jackets": "CBJ", "Dallas Stars": "DAL",
    "Detroit Red Wings": "DET", "Edmonton Oilers": "EDM", "Florida Panthers": "FLA",
    "Los Angeles Kings": "LAK", "Minnesota Wild": "MIN", "Montréal Canadiens": "MTL",
    "Montreal Canadiens": "MTL", "Nashville Predators": "NSH", "New Jersey Devils": "NJD",
    "New York Islanders": "NYI", "New York Rangers": "NYR", "Ottawa Senators": "OTT",
    "Philadelphia Flyers": "PHI", "Pittsburgh Penguins": "PIT", "San Jose Sharks": "SJS",
    "Seattle Kraken": "SEA", "St. Louis Blues": "STL", "Tampa Bay Lightning": "TBL",
    "Toronto Maple Leafs": "TOR", "Utah Hockey Club": "UTA", "Vancouver Canucks": "VAN",
    "Vegas Golden Knights": "VGK", "Washington Capitals": "WSH", "Winnipeg Jets": "WPG"
};

// Returns the display name for a fantasy team.
// If the key is still the default "Équipe X" and members exist,
// use "member1 et member2 et ..." if ≤ 30 chars, otherwise keep the key.
function getDisplayName(teamKey, members) {
    if (/^Équipe \d+$/.test(teamKey) && members && members.length > 0) {
        const auto = members.join(' et ');
        if (auto.length <= 30) return auto;
    }
    return teamKey;
}

// Returns an <img> tag for the first chosen NHL team logo, or empty string.
function getTeamLogoHTML(nhlTeams) {
    if (!nhlTeams || nhlTeams.length === 0) return '';
    const abbrev = NHL_ABBREV[nhlTeams[0]];
    if (!abbrev) return '';
    return `<img src="teams/${abbrev}.png" alt="${nhlTeams[0]}" title="${nhlTeams[0]}"
        style="width:36px;height:36px;object-fit:contain;vertical-align:middle;margin-right:8px;"
        onerror="this.style.display='none'">`;
}

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

// 🔄 Update pool mode warning when mode or max players changes
function updatePoolModeInfo() {
    const mode = $('input[name="poolMode"]:checked').val();
    const maxPlayers = parseInt($("#maxPlayers").val());
    const warning = $("#h2h-warning");

    if (mode === 'head-to-head' && maxPlayers % 2 !== 0) {
        warning.show();
    } else {
        warning.hide();
    }
}

// Listen to changes on max players selector
$(document).ready(function() {
    $("#maxPlayers").on('change', updatePoolModeInfo);
});

// Pool image preview (triggered by file input in pool.html)
function previewPoolImage(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const preview = document.getElementById('poolImgPreview');
    const hint = document.getElementById('poolImgUploadHint');
    if (preview) {
        preview.src = URL.createObjectURL(file);
        preview.style.display = 'block';
        if (hint) hint.style.display = 'none';
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
    const poolMode = $('input[name="poolMode"]:checked').val();
    const allowTrades = $("#allowTrades").is(':checked');
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

    // Validation Head-to-Head: nombre pair de participants
    if (poolMode === 'head-to-head' && maxPlayers % 2 !== 0) {
        alert("⚠️ Le mode Head-to-Head nécessite un nombre pair de participants !\n\nVeuillez choisir 2, 4, 6, 8 ou 10 participants.");
        return;
    }

    const poolConfig = {
        name: clanName,
        maxPlayers: maxPlayers,
        username: username,
        poolMode: poolMode || 'cumulative', // Par défaut cumulatif
        allowTrades: allowTrades !== false, // Par défaut true
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
            const result = await response.json();
            console.log("✅ Pool créé avec succès !");

            // Upload pool image if selected
            const poolImageInput = document.getElementById('poolImageInput');
            if (poolImageInput && poolImageInput.files[0]) {
                const formData = new FormData();
                formData.append('image', poolImageInput.files[0]);
                formData.append('poolName', clanName);
                try {
                    await fetch(`${BASE_URL}/upload/pool-image`, { method: 'POST', body: formData });
                } catch (e) {
                    console.warn('Pool image upload failed:', e);
                }
            }

            // Show success message with auto-join confirmation
            alert(`✅ ${result.message}\n\nVous pouvez maintenant inviter d'autres participants !`);

            // Clear form
            $("#clanName").val("");
            $("#numOffensive").val("6");
            $("#numDefensive").val("4");
            $("#numGoalies").val("1");
            $("#numRookies").val("1");
            $("#numTeams").val("1");
            const poolImgPreview = document.getElementById('poolImgPreview');
            const poolImgHint = document.getElementById('poolImgUploadHint');
            if (poolImgPreview) { poolImgPreview.src = ''; poolImgPreview.style.display = 'none'; }
            if (poolImgHint) poolImgHint.style.display = '';
            if (poolImageInput) poolImageInput.value = '';

            // Reload clans and switch to "Mes pools" tab
            await loadClans();
            showTab('mypools');
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
    // Hide skeleton loaders and show actual content
    $("#myPoolsSkeleton").hide();
    $("#availablePoolsSkeleton").hide();
    $("#clans-list").show();
    $("#available-clans-list").show();

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

        const poolImgHtml = clan.imageUrl
            ? `<img src="${clan.imageUrl}" class="pool-item-img" alt="${clanName}" onerror="this.style.display='none'">`
            : `<img src="Icons/grayGroup.png" class="pool-item-img pool-item-img-placeholder" alt="${clanName}">`;

        const draftStarted = !!(clan.draftOrder && clan.draftOrder.length > 0);

        if (userInClan) {
            $("#clans-list").append(`
                <li>
                    <div class="pool-item-img-wrap">${poolImgHtml}</div>
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
        } else if (!draftStarted) {
            $("#available-clans-list").append(`
                <li>
                    <div class="pool-item-img-wrap">${poolImgHtml}</div>
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
        const draftStarted = !!(draftData[clanName].draftOrder && draftData[clanName].draftOrder.length > 0);

        let userTeam = null;
        for (const [teamName, teamData] of Object.entries(teams)) {
            if (teamData.members.includes(username)) {
                userTeam = teamName;
                break;
            }
        }

        // Pre-fetch avatars and player map in parallel
        const allMembers = Object.values(teams).flatMap(t => t.members || []);
        await Promise.all([
            typeof prefetchAvatars === 'function' ? prefetchAvatars(allMembers) : Promise.resolve(),
            loadPlayerMap()
        ]);

        const poolImgTag = draftData[clanName]?.imageUrl
            ? `<img src="${draftData[clanName].imageUrl}" style="width:36px;height:36px;border-radius:8px;object-fit:cover;margin-right:10px;vertical-align:middle;" onerror="this.style.display='none'" alt="${clanName}">`
            : `<img src="Icons/grayGroup.png" style="width:36px;height:36px;border-radius:8px;object-fit:cover;margin-right:10px;flex-shrink:0;" alt="${clanName}">`;

        const draftBanner = draftStarted
            ? `<div style="margin-bottom:14px;padding:10px 14px;background:#fff3cd;border:1px solid #ffc107;border-radius:8px;color:#856404;font-size:0.9rem;font-weight:600;">🏒 Le draft est commencé — le changement d'équipe n'est plus possible.</div>`
            : '';

        let teamHTML = `<h3 style="margin-bottom:20px;color:var(--text-main,#222);display:flex;align-items:center;">${poolImgTag}Équipes de ${clanName}</h3>${draftBanner}`;

        for (const [teamName, teamData] of Object.entries(teams)) {
            const isFull = teamData.members.length >= 5;
            const userInTeam = userTeam === teamName;
            const teamId = teamName.replace(/[^a-zA-Z0-9]/g, '_');
            const displayName = getDisplayName(teamName, teamData.members);
            const logoHTML = getTeamLogoHTML(teamData.teams);
            const membersDisplay = teamData.members.length > 0
                ? `<div style="margin-top: 8px; padding-left: 12px;">
                     <strong style="font-size: 0.85rem; color: #666;">Membres:</strong>
                     <ul style="margin: 5px 0 0 0; padding-left: 0; list-style: none;">
                       ${teamData.members.map(member => `
                         <li style="display:flex;align-items:center;gap:8px;padding:4px 0;color:#444;font-size:0.9rem;">
                           ${typeof avatarHtml === 'function' ? avatarHtml(member, 28) : `<img src="Icons/grayUser.png" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">`}
                           <span>${member}</span>
                         </li>`).join("")}
                     </ul>
                   </div>`
                : `<div style="margin-top: 8px; color: #999; font-size: 0.85rem; font-style: italic;">Aucun membre pour l'instant</div>`;

            const prefill = (displayName !== teamName && displayName.length <= 20)
                ? displayName
                : teamName;
            const renameSection = userInTeam ? `
                <div id="rename-row-${teamId}" style="margin-top: 12px; display: flex; gap: 8px; align-items: center;">
                    <input id="rename-input-${teamId}" type="text" maxlength="20"
                        value="${prefill.replace(/"/g, '&quot;')}"
                        placeholder="Nouveau nom (max 20)"
                        style="flex: 1; padding: 8px 12px; border: 1px solid #ccc; border-radius: 8px; font-size: 0.9rem; outline: none;"
                        onkeydown="if(event.key==='Enter') submitRename('${clanName.replace(/'/g, "\\'")}', '${teamName.replace(/'/g, "\\'")}', '${teamId}')"
                    />
                    <button onclick="submitRename('${clanName.replace(/'/g, "\\'")}', '${teamName.replace(/'/g, "\\'")}', '${teamId}')"
                        style="padding: 8px 16px; background: #4caf50; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; white-space: nowrap;">
                        ✏️ Renommer
                    </button>
                </div>
            ` : '';

            teamHTML += `
                <div style="margin-bottom: 16px; padding: 16px; border: 2px solid ${userInTeam ? '#4caf50' : (isFull ? '#ddd' : '#ff2e2e')}; border-radius: 10px; background: ${userInTeam ? '#e8f5e9' : (isFull ? '#f5f5f5' : '#fff')};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <strong style="font-size: 1.1rem; color: #222; display: flex; align-items: center;">${logoHTML}${displayName}</strong>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            ${userInTeam ? `<span style="padding: 4px 12px; background: #4caf50; border-radius: 12px; font-size: 0.75rem; font-weight: 600; color: white;">Votre équipe</span>` : ''}
                            <span style="padding: 4px 12px; background: ${isFull ? '#ddd' : '#e3f2fd'}; border-radius: 12px; font-size: 0.85rem; font-weight: 600; color: ${isFull ? '#666' : '#1976d2'};">
                                ${teamData.members.length}/5 joueurs
                            </span>
                        </div>
                    </div>
                    ${membersDisplay}
                    ${buildPicksSection(teamData)}
                    ${renameSection}
                    ${!userInTeam && !isFull && !draftStarted ? `<button style="margin-top: 12px; width: 100%; padding: 10px; background: linear-gradient(135deg, #ff2e2e 0%, #cc2525 100%); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s ease;" onclick="joinTeam('${clanName}', '${teamName}')" onmouseover="this.style.background='linear-gradient(135deg, #ff4040 0%, #d93030 100%)'" onmouseout="this.style.background='linear-gradient(135deg, #ff2e2e 0%, #cc2525 100%)'">Rejoindre cette équipe</button>` : ''}
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


// ✏️ Rename user's team
async function submitRename(clanName, oldTeamName, teamId) {
    const input = document.getElementById(`rename-input-${teamId}`);
    if (!input) return;

    const newName = input.value.trim();

    if (newName.length === 0 || newName.length > 20) {
        alert("Le nom doit contenir entre 1 et 20 caractères.");
        return;
    }

    if (!/^[\p{L}\p{N}\s'\-_]+$/u.test(newName)) {
        alert("Nom invalide. Utilisez uniquement des lettres, chiffres, espaces, tirets ou apostrophes.");
        return;
    }

    const username = localStorage.getItem("username");

    try {
        const response = await fetch(`${BASE_URL}/rename-team`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clanName, oldTeamName, newTeamName: newName, username })
        });

        const result = await response.json();

        if (response.ok) {
            alert(result.message);
            viewClanTeams(clanName);
        } else {
            alert(result.message || "Erreur lors du renommage.");
        }
    } catch (error) {
        console.error("Erreur rename-team:", error);
        alert("Erreur de connexion au serveur.");
    }
}

// 🔥 Rejoindre un clan
async function joinClan(clanName) {
    const username = localStorage.getItem("username");

    try {
        const response = await fetch(`${BASE_URL}/draft?timestamp=${new Date().getTime()}`, { cache: "no-store" });
        const draftData = await response.json();

        if (draftData[clanName].draftOrder && draftData[clanName].draftOrder.length > 0) {
            alert("Ce pool a déjà commencé son draft. Il n'est plus possible de le rejoindre.");
            return;
        }

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
        // Check draft status before touching anything — /leave-team has no draft guard
        // so we must stop here to avoid orphaning the user from their current team.
        const checkResp = await fetch(`${BASE_URL}/draft?timestamp=${new Date().getTime()}`, { cache: "no-store" });
        const checkData = await checkResp.json();
        if (checkData[clanName]?.draftOrder && checkData[clanName].draftOrder.length > 0) {
            alert("Le draft a déjà commencé ! Vous ne pouvez plus changer d'équipe.");
            return;
        }

        // Remove from current team first (only safe now that we know draft hasn't started)
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

// ==================== ACTIVE DRAFTS FUNCTIONALITY ====================

async function loadActiveDrafts() {
    const username = localStorage.getItem("username");
    if (!username) return;

    const container = document.getElementById("activeDraftsList");
    if (!container) return;

    try {
        const response = await fetch(`${BASE_URL}/draft?timestamp=${new Date().getTime()}`, { cache: "no-store" });
        const draftData = await response.json();

        const activeDrafts = [];
        const pendingDrafts = [];

        Object.entries(draftData).forEach(([poolName, poolData]) => {
            // Check if user is in this pool
            const userTeam = Object.entries(poolData.teams || {}).find(([teamName, teamData]) =>
                teamData.members && teamData.members.includes(username)
            );
            if (!userTeam) return;

            // Check if draft is truly complete (all teams have all positions filled per config)
            const config = poolData.config || {
                numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1, numTeams: 1
            };
            const activeTeams = Object.values(poolData.teams || {}).filter(t => t.members && t.members.length > 0);
            const isDraftComplete = activeTeams.length > 0 && activeTeams.every(team =>
                (team.offensive || []).length === config.numOffensive &&
                (team.defensive || []).length === config.numDefensive &&
                (team.rookie || []).length === config.numRookies &&
                (team.goalie || []).length === config.numGoalies &&
                (team.teams || []).length === config.numTeams
            );

            if (isDraftComplete) return; // Skip completed drafts

            // draftOrder is a flat array of team names on the server
            const hasDraftOrder = Array.isArray(poolData.draftOrder) && poolData.draftOrder.length > 0;
            const totalMembers = Object.values(poolData.teams || {}).reduce((sum, t) => sum + (t.members?.length || 0), 0);
            const maxPlayers = poolData.maxPlayers || 10;
            const poolMode = poolData.poolMode || 'cumulative';

            if (hasDraftOrder) {
                // Draft is actively in progress
                const currentPick = poolData.currentPickIndex || 0;
                const totalPicks = poolData.draftOrder.length;
                activeDrafts.push({
                    name: poolName,
                    mode: poolMode,
                    status: 'active',
                    currentPick: currentPick,
                    totalPicks: totalPicks,
                    participants: totalMembers,
                    maxPlayers: maxPlayers
                });
            } else {
                // Pool exists but draft hasn't started
                pendingDrafts.push({
                    name: poolName,
                    mode: poolMode,
                    status: totalMembers >= maxPlayers ? 'ready' : 'waiting',
                    participants: totalMembers,
                    maxPlayers: maxPlayers
                });
            }
        });

        // Update badge count
        const badgeCount = activeDrafts.length + pendingDrafts.filter(d => d.status === 'ready').length;
        const tabBadge = document.getElementById("draftTabBadge");
        if (tabBadge) {
            if (badgeCount > 0) {
                tabBadge.textContent = badgeCount;
                tabBadge.style.display = 'inline-flex';
            } else {
                tabBadge.style.display = 'none';
            }
        }

        // Render drafts
        if (activeDrafts.length === 0 && pendingDrafts.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: #999;">
                    <div style="font-size: 3rem; margin-bottom: 16px;">✅</div>
                    <h3 style="color: #333; margin-bottom: 8px;">Aucun repêchage en cours</h3>
                    <p>Tous vos pools ont terminé leur repêchage, ou aucun n'est prêt à commencer.</p>
                </div>
            `;
            return;
        }

        let html = '';

        // Active drafts first (with red urgent styling)
        activeDrafts.forEach(draft => {
            const progress = draft.totalPicks > 0 ? Math.round((draft.currentPick / draft.totalPicks) * 100) : 0;
            html += `
                <li class="draft-item active-draft">
                    <div class="pool-item-content">
                        <span class="pool-item-name">${draft.name}</span>
                        <div class="pool-item-info">
                            <span class="pool-item-badge draft-active-badge">🎯 En cours</span>
                            <span class="pool-item-badge">${draft.mode === 'head-to-head' ? '⚔️ H2H' : '📊 Cumulatif'}</span>
                            <span class="pool-item-badge">📋 ${draft.currentPick}/${draft.totalPicks} choix</span>
                        </div>
                        <div class="draft-progress-bar">
                            <div class="draft-progress-fill" style="width: ${progress}%;"></div>
                        </div>
                    </div>
                    <button class="pool-action-btn draft-resume-btn" onclick="resumeDraft('${draft.name.replace(/'/g, "\\'")}')">Reprendre</button>
                </li>
            `;
        });

        // Pending drafts
        pendingDrafts.forEach(draft => {
            const isReady = draft.status === 'ready';
            html += `
                <li class="draft-item ${isReady ? 'ready-draft' : 'waiting-draft'}">
                    <div class="pool-item-content">
                        <span class="pool-item-name">${draft.name}</span>
                        <div class="pool-item-info">
                            <span class="pool-item-badge ${isReady ? 'draft-ready-badge' : 'draft-waiting-badge'}">
                                ${isReady ? '✅ Prêt' : '⏳ En attente'}
                            </span>
                            <span class="pool-item-badge">${draft.mode === 'head-to-head' ? '⚔️ H2H' : '📊 Cumulatif'}</span>
                            <span class="pool-item-badge">👥 ${draft.participants}/${draft.maxPlayers}</span>
                        </div>
                    </div>
                    ${isReady
                        ? `<button class="pool-action-btn draft-start-btn" onclick="startDraftFromPool('${draft.name.replace(/'/g, "\\'")}')">Commencer</button>`
                        : `<span class="pool-action-btn secondary draft-waiting-btn">En attente</span>`
                    }
                </li>
            `;
        });

        container.innerHTML = html;

    } catch (error) {
        console.error("Error loading active drafts:", error);
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #999;">
                <div style="font-size: 3rem; margin-bottom: 16px;">❌</div>
                <p>Erreur lors du chargement des repêchages</p>
            </div>
        `;
    }
}

// Load active drafts on page load (for badge count)
$(document).ready(function() {
    loadActiveDrafts();
});

// Start a draft from the pool page
async function startDraftFromPool(poolName) {
    try {
        // Check if draft already has an order
        const response = await fetch(`${BASE_URL}/draft-order/${poolName}`);
        const result = await response.json();

        if (!result.draftOrder || result.draftOrder.length === 0) {
            // No order exists, start the draft
            const startResponse = await fetch(`${BASE_URL}/start-draft`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clanName: poolName })
            });

            const startResult = await startResponse.json();
            console.log("✅ Draft démarré :", startResult.message);
        } else {
            console.log("✅ Ordre de draft déjà existant.");
        }

        // Set pool name in localStorage and redirect to draft page
        localStorage.setItem("draftClan", poolName);
        window.location.href = "draftActif.html";
    } catch (error) {
        console.error("Erreur lors du démarrage du draft :", error);
        alert("Erreur lors de la préparation du draft.");
    }
}

// Resume an existing draft from the pool page
function resumeDraft(poolName) {
    // Set pool name in localStorage and redirect to draft page
    localStorage.setItem("draftClan", poolName);
    window.location.href = "draftActif.html";
}

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
