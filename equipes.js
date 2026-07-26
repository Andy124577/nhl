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
        class="cm-team-logo" onerror="this.style.display='none'">`;
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
    const poolPassword = ($("#poolPassword").val() || "").trim();
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

    // Le serveur rejetterait de toute façon, mais autant le dire avant
    // d'envoyer : la même borne y est appliquée.
    if (poolPassword && (poolPassword.length < 4 || poolPassword.length > 72)) {
        alert("Le mot de passe du pool doit contenir entre 4 et 72 caractères.");
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
        // Champ vide = pool ouvert. Le serveur ne hache que si la chaîne
        // est non vide, et ne renvoie jamais l'empreinte.
        password: poolPassword,
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
            $("#poolPassword").val("");
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
            ? `<img src="${draftData[clanName].imageUrl}" class="cm-pool-img" onerror="this.style.display='none'" alt="">`
            : `<img src="Icons/grayGroup.png" class="cm-pool-img" alt="">`;

        const draftBanner = draftStarted
            ? `<div class="cm-banner">Le draft est commencé — le changement d'équipe n'est plus possible.</div>`
            : '';

        let teamHTML = `<h3 class="cm-title">${poolImgTag}<span>Équipes de ${clanName}</span></h3>${draftBanner}`;

        for (const [teamName, teamData] of Object.entries(teams)) {
            const isFull = teamData.members.length >= 5;
            const userInTeam = userTeam === teamName;
            const teamId = teamName.replace(/[^a-zA-Z0-9]/g, '_');
            const displayName = getDisplayName(teamName, teamData.members);
            const logoHTML = getTeamLogoHTML(teamData.teams);
            const membersDisplay = teamData.members.length > 0
                ? `<div class="cm-members">
                     <span class="cm-members-label">Membres</span>
                     <ul class="cm-member-list">
                       ${teamData.members.map(member => `
                         <li class="cm-member">
                           ${typeof avatarHtml === 'function' ? avatarHtml(member, 26) : `<img src="Icons/grayUser.png" class="cm-member-avatar" alt="">`}
                           <span>${member}</span>
                         </li>`).join("")}
                     </ul>
                   </div>`
                : `<div class="cm-empty">Aucun membre pour l'instant</div>`;

            const prefill = (displayName !== teamName && displayName.length <= 20)
                ? displayName
                : teamName;
            // Le renommage tient dans un crayon posé contre le nom : le bloc
            // « Renommer mon équipe » qui le précédait ajoutait une étiquette,
            // un champ et un bouton visibles en permanence sous chaque carte,
            // pour une action qu'on ne fait qu'une fois.
            const renameBtn = userInTeam ? `
                <button type="button" class="cm-rename-pencil"
                        title="Renommer mon équipe" aria-label="Renommer mon équipe"
                        onclick="startRename(this, '${clanName.replace(/'/g, "\\'")}', '${teamName.replace(/'/g, "\\'")}', '${teamId}')">
                    ${typeof getIcon === 'function' ? getIcon('pencil', 14) : '&#9998;'}
                </button>
            ` : '';

            teamHTML += `
                <div class="cm-team${userInTeam ? ' is-mine' : ''}${isFull ? ' is-full' : ''}">
                    <div class="cm-team-head">
                        <strong class="cm-team-name">${logoHTML}<span class="cm-team-label">${displayName}</span>${renameBtn}</strong>
                        <div class="cm-badges">
                            ${userInTeam ? `<span class="cm-badge cm-badge-mine">Votre équipe</span>` : ''}
                            <span class="cm-badge cm-badge-count">${teamData.members.length}/5 joueurs</span>
                        </div>
                    </div>
                    ${membersDisplay}
                    ${buildPicksSection(teamData)}
                    ${!userInTeam && !isFull && !draftStarted ? `<button type="button" class="cm-join-btn" onclick="joinTeam('${clanName}', '${teamName}')">Rejoindre cette équipe</button>` : ''}
                    ${isFull && !userInTeam ? `<div class="cm-full-note">Équipe complète</div>` : ''}
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
/**
 * Bascule le nom de l'équipe en champ de saisie, sur place.
 *
 * Le renommage occupait auparavant un bloc permanent sous chaque carte —
 * étiquette, champ et bouton — pour une action qu'on ne fait qu'une fois.
 * Il tient désormais dans un crayon posé contre le nom.
 *
 * Le champ garde l'identifiant `rename-input-<teamId>` : submitRename() le
 * lit par cet identifiant et n'a pas eu à changer. En cas de succès elle
 * recharge la modale, ce qui rétablit l'affichage normal ; l'annulation est
 * donc le seul retour en arrière à gérer ici.
 */
function startRename(bouton, clanName, teamName, teamId) {
    const titre = bouton.closest('.cm-team-name');
    const libelle = titre && titre.querySelector('.cm-team-label');
    if (!libelle || titre.querySelector('.cm-rename-input')) return;

    const nomAffiche = libelle.textContent.trim();
    // Le nom affiché peut être la liste des membres (« alice et bob ») quand
    // l'équipe porte encore sa clé par défaut : trop long, et ce n'est pas un
    // nom d'équipe. On repart alors de la clé.
    const depart = (nomAffiche !== teamName && nomAffiche.length <= 20)
        ? nomAffiche
        : teamName;

    const champ = document.createElement('input');
    champ.type = 'text';
    champ.id = `rename-input-${teamId}`;
    champ.className = 'cm-rename-input';
    champ.maxLength = 20;
    champ.value = depart;
    champ.placeholder = 'Nouveau nom (max 20)';
    champ.setAttribute('aria-label', "Nouveau nom de l'équipe");

    const annuler = () => {
        champ.remove();
        valider.remove();
        libelle.hidden = false;
        bouton.hidden = false;
    };

    const valider = document.createElement('button');
    valider.type = 'button';
    valider.className = 'cm-rename-ok';
    valider.title = 'Enregistrer';
    valider.setAttribute('aria-label', 'Enregistrer le nom');
    valider.innerHTML = typeof getIcon === 'function' ? getIcon('check', 14) : '✓';
    valider.addEventListener('click', () => submitRename(clanName, teamName, teamId));

    champ.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submitRename(clanName, teamName, teamId); }
        if (e.key === 'Escape') { e.preventDefault(); annuler(); }
    });

    libelle.hidden = true;
    bouton.hidden = true;
    titre.appendChild(champ);
    titre.appendChild(valider);
    champ.focus();
    champ.select();
}

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
        let teamHTML = `<h3 class="cm-title"><span>Choisissez une équipe dans ${clanName}</span></h3>`;

        Object.entries(teams).forEach(([teamName, teamData]) => {
            const isFull = teamData.members.length >= 5;
            const membersDisplay = teamData.members.length > 0
                ? `<div class="cm-members">
                     <span class="cm-members-label">Membres</span>
                     <ul class="cm-member-list">
                       ${teamData.members.map(member => `<li class="cm-member"><span>${member}</span></li>`).join("")}
                     </ul>
                   </div>`
                : `<div class="cm-empty">Aucun membre pour l'instant</div>`;

            teamHTML += `
                <div class="cm-team${isFull ? ' is-full' : ''}">
                    <div class="cm-team-head">
                        <strong class="cm-team-name"><span>${teamName}</span></strong>
                        <div class="cm-badges">
                            <span class="cm-badge cm-badge-count">${teamData.members.length}/5 joueurs</span>
                        </div>
                    </div>
                    ${membersDisplay}
                    ${!isFull ? `<button type="button" class="cm-join-btn" onclick="joinTeam('${clanName}', '${teamName}')">Rejoindre cette équipe</button>` : `<div class="cm-full-note">Équipe complète</div>`}
                </div>
            `;
        });

        $("#clan-members-content").html(teamHTML);
        $("#clan-members-modal").css("display", "flex");


        

    } catch (error) {
        console.error("❌ Erreur lors de l'affichage des équipes :", error);
    }
}

// ============================================================
// MOT DE PASSE DE POOL
// ------------------------------------------------------------
// Le mot de passe n'est jamais conservé côté client : il est saisi,
// envoyé à /join-team, puis oublié. Le serveur le compare à une empreinte
// bcrypt, comme celui d'un compte, et ne renvoie que `hasPassword`.
// ============================================================

/** Bascule l'affichage en clair d'un champ de mot de passe. */
function togglePoolPassword(bouton, champId) {
    const champ = document.getElementById(champId);
    if (!champ) return;
    const enClair = champ.type === 'text';
    champ.type = enClair ? 'password' : 'text';
    bouton.setAttribute('aria-label', enClair ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
    bouton.classList.toggle('is-visible', !enClair);
    champ.focus();
}

/**
 * Ouvre la modale de saisie et résout avec le mot de passe, ou null si
 * l'utilisateur renonce.
 *
 * `erreur` permet de rouvrir la modale après un refus du serveur sans
 * perdre le contexte : c'est le seul endroit qui sait pourquoi ça a échoué.
 */
function demanderMotDePasse(nomPool, erreur) {
    return new Promise(resolve => {
        const modale = document.getElementById('pool-password-modal');
        const champ = document.getElementById('poolPwInput');
        const zoneErreur = document.getElementById('poolPwError');
        const valider = document.getElementById('poolPwOk');
        const annulerBtn = document.getElementById('poolPwCancelBtn');
        const fermer = document.getElementById('poolPwCancel');
        if (!modale || !champ) { resolve(null); return; }

        document.getElementById('poolPwName').textContent = nomPool;
        champ.value = '';
        champ.type = 'password';
        document.getElementById('poolPwToggle').classList.remove('is-visible');
        zoneErreur.hidden = !erreur;
        zoneErreur.textContent = erreur || '';

        const terminer = (valeur) => {
            modale.style.display = 'none';
            valider.removeEventListener('click', surValider);
            annulerBtn.removeEventListener('click', surAnnuler);
            fermer.removeEventListener('click', surAnnuler);
            champ.removeEventListener('keydown', surTouche);
            modale.removeEventListener('click', surFond);
            resolve(valeur);
        };
        const surValider = () => {
            const v = champ.value.trim();
            if (!v) {
                zoneErreur.hidden = false;
                zoneErreur.textContent = 'Entrez le mot de passe du pool.';
                champ.focus();
                return;
            }
            terminer(v);
        };
        const surAnnuler = () => terminer(null);
        const surTouche = e => {
            if (e.key === 'Enter') { e.preventDefault(); surValider(); }
            if (e.key === 'Escape') { e.preventDefault(); surAnnuler(); }
        };
        // Clic sur le fond seulement, pas sur la boîte.
        const surFond = e => { if (e.target === modale) surAnnuler(); };

        valider.addEventListener('click', surValider);
        annulerBtn.addEventListener('click', surAnnuler);
        fermer.addEventListener('click', surAnnuler);
        champ.addEventListener('keydown', surTouche);
        modale.addEventListener('click', surFond);

        modale.style.display = 'flex';
        champ.focus();
    });
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

        // Mot de passe : demandé seulement pour entrer dans un pool protégé
        // où l'on n'est pas encore. Changer d'équipe une fois dedans ne le
        // redemande pas — le serveur applique exactement la même règle.
        const dejaMembre = Object.values(checkData[clanName]?.teams || {})
            .some(equipe => (equipe.members || []).includes(username));
        let motDePasse = null;
        if (checkData[clanName]?.hasPassword && !dejaMembre) {
            motDePasse = await demanderMotDePasse(clanName);
            if (motDePasse === null) return;   // renoncement
        }

        // Remove from current team first (only safe now that we know draft hasn't started)
        await fetch(`${BASE_URL}/leave-team`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: clanName, username })
        });

        console.log(`🚪 ${username} a quitté son ancienne équipe`);

        // 🔥 Ajouter l'utilisateur à la nouvelle équipe
        let joinResponse = await fetch(`${BASE_URL}/join-team`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: clanName, username, teamName, password: motDePasse })
        });
        let result = await joinResponse.json();

        // Mot de passe refusé : on redemande sur place plutôt que de renvoyer
        // l'utilisateur au point de départ. `/leave-team` est sans effet pour
        // qui n'était membre de rien, donc rien n'a été perdu entre-temps.
        while (result.passwordRequired) {
            motDePasse = await demanderMotDePasse(clanName, result.message);
            if (motDePasse === null) return;
            joinResponse = await fetch(`${BASE_URL}/join-team`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: clanName, username, teamName, password: motDePasse })
            });
            result = await joinResponse.json();
        }

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

// Un gestionnaire lié à TOUS les boutons de la page cherchait ici un
// élément `.scrolltome` qui n'existe nulle part dans le projet : chaque
// clic levait « Cannot read properties of undefined (reading 'top') ».
// Retiré — il ne pouvait rien faire d'autre que jeter.

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
