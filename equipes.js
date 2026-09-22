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
    // Seule la page « Rejoindre un pool » affiche cette liste ; ailleurs,
    // equipes.js n'est chargé que pour ses formulaires et ses modales.
    if (!document.getElementById("available-clans-list")) return;

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
    // L'équipe LNH est de nouveau une position repêchée : la quantité revient
    // du formulaire. L'identité choisie avant le repêchage (repechage.html)
    // ne donne que les couleurs, elle ne remplit pas cette case.
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

    if (typeof contientGrossierete === 'function' && contientGrossierete(clanName)) {
        alert("Ce nom de pool contient un terme inapproprié. Choisissez-en un autre.");
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
                // Le serveur n'accepte l'image que du créateur du pool.
                formData.append('username', username);
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

            // Le pool qu'on vient de nommer devient le contexte courant :
            // c'est celui sur lequel on va travailler, il n'y a pas d'autre
            // candidat évident. Écrit avant la navigation pour que la page
            // suivante le lise dès sa première ligne.
            localStorage.setItem("activePool", clanName);
            localStorage.setItem("draftClan", clanName);
            // Le pool vient de naître : ce qui l'attend, c'est de se remplir
            // puis de repêcher. Ses réglages sont à un engrenage de là, dans
            // le rail (poolNav.js), sur toutes les pages.
            window.location.href = "repechage.html";
        } else {
            const error = await response.json();
            alert(`Erreur lors de la création du pool: ${error.message || 'Erreur inconnue'}`);
        }

    } catch (error) {
        console.error("❌ Erreur lors de la création du clan :", error);
        alert("Erreur de connexion au serveur");
    }
}

/**
 * Un pool né de la file instantanée ?
 *
 * Le prédicat vient d'instantDraft.js ; le repli couvre l'ordre de
 * chargement et suffit pour tout pool créé par la file, qui porte toujours
 * `instant: true`.
 */
function estPoolInstantane(nom, clan) {
    return window.FZInstant
        ? window.FZInstant.estPoolInstantane(nom, clan)
        : !!(clan && clan.instant);
}

// 🔄 Met à jour la liste des pools ouverts
//
// Les pools dont on est déjà membre ne figurent plus ici : ils sont gérés
// par le rail et le panneau de réglages, qui en montrent bien plus que ce
// qu'une ligne de liste permettait. Ne reste que ce qu'on peut rejoindre.
//
// Les pools de repêchage instantané en sont exclus : ce sont des files
// d'attente, pas des ligues qu'on choisit. Les y laisser ouvrirait une
// deuxième porte qui ne tient pas les mêmes promesses — on entrerait par
// /join-team, qui ne lance pas le repêchage quand le pool se remplit, et le
// bouton « Rejoindre un repêchage instantané » cesserait de partir tout
// seul. Le bouton en tête de page est la seule entrée.
function updateUI(draftData) {
    const liste = document.getElementById("available-clans-list");
    if (!liste) return;

    $("#availablePoolsSkeleton").hide();
    $("#available-clans-list").show().html("");

    const username = localStorage.getItem("username");

    Object.keys(draftData).forEach(clanName => {
        const clan = draftData[clanName];
        if (estPoolInstantane(clanName, clan)) return;

        // /draft ne livre plus les alignements des pools qu'on n'a pas
        // rejoints : un résumé de découverte porte les compteurs directement.
        // On garde le calcul depuis `teams` pour les pools dont on EST membre,
        // dont la réponse est complète.
        const userInClan = clan.isMember === true
            || (clan.teams && Object.values(clan.teams).some(team => (team.members || []).includes(username)));

        const activeTeams = clan.teams
            ? Object.values(clan.teams).filter(team => (team.members || []).length > 0).length
            : (clan.occupiedTeamCount || 0);
        const totalParticipants = clan.teams
            ? Object.values(clan.teams).reduce((sum, team) => sum + (team.members || []).length, 0)
            : (clan.participantCount || 0);

        // Get pool configuration
        const config = clan.config || {
            numOffensive: 6,
            numDefensive: 4,
            numGoalies: 1,
            numRookies: 1,
            numTeams: 1
        };

        const totalPicks = clan.totalPicks
            || (config.numOffensive + config.numDefensive + config.numGoalies + config.numRookies + config.numTeams);

        const poolImgHtml = clan.imageUrl
            ? `<img src="${clan.imageUrl}" class="pool-item-img" alt="${clanName}" onerror="this.style.display='none'">`
            : `<img src="Icons/grayGroup.png" class="pool-item-img pool-item-img-placeholder" alt="${clanName}">`;

        const draftStarted = clan.draftStarted === true
            || !!(clan.draftOrder && clan.draftOrder.length > 0);

        if (!userInClan && !draftStarted) {
            // `hasPassword` vient de poolsPublics() côté serveur ; l'empreinte
            // elle-même n'arrive jamais jusqu'ici.
            const protege = !!clan.hasPassword;
            $("#available-clans-list").append(`
                <li data-nom="${clanName.toLowerCase().replace(/"/g, '&quot;')}"
                    data-acces="${protege ? 'protege' : 'ouvert'}">
                    <div class="pool-item-img-wrap">${poolImgHtml}</div>
                    <div class="pool-item-content">
                        <span class="pool-item-name">${clanName}</span>
                        <div class="pool-item-info">
                            <span class="pool-item-badge">👥 ${totalParticipants}/${clan.maxPlayers || 10} participants</span>
                            <span class="pool-item-badge">📋 ${totalPicks} sélections</span>
                            <span class="pool-item-badge">🏒 ${activeTeams} équipes</span>
                            <span class="pool-item-badge pool-acces-badge ${protege ? 'is-protege' : 'is-ouvert'}">
                                ${protege ? '🔒 Mot de passe' : '🔓 Accès libre'}
                            </span>
                        </div>
                    </div>
                    <button class="pool-action-btn secondary" onclick="joinClan('${clanName}')">Rejoindre</button>
                </li>
            `);
        }
    });

    // La liste vient d'être reconstruite : le filtre en cours doit s'y
    // réappliquer, sinon un rafraîchissement socket le ferait oublier.
    filtrerPoolsDisponibles();
}

// ============================================================
// RECHERCHE ET FILTRES DES POOLS DISPONIBLES
// ------------------------------------------------------------
// Tout se passe côté client : /draft renvoie déjà l'ensemble des pools
// ouverts, il n'y a rien à demander de plus au serveur.
// ============================================================

let filtreAcces = 'tous';

function filtrerPoolsDisponibles() {
    const champ = document.getElementById('poolSearchInput');
    const liste = document.getElementById('available-clans-list');
    if (!liste) return;

    // Même normalisation que le filtre de grossièretés : « Éclair » se
    // trouve en tapant « eclair ».
    const reduire = t => (typeof normaliser === 'function')
        ? normaliser(t)
        : String(t || '').toLowerCase();

    const recherche = reduire(champ ? champ.value.trim() : '');
    let visibles = 0;

    liste.querySelectorAll('li').forEach(item => {
        const correspondNom = !recherche || reduire(item.dataset.nom).includes(recherche);
        const correspondAcces = filtreAcces === 'tous' || item.dataset.acces === filtreAcces;
        const montrer = correspondNom && correspondAcces;
        item.hidden = !montrer;
        if (montrer) visibles++;
    });

    const vide = document.getElementById('poolNoResult');
    if (vide) vide.hidden = visibles > 0 || liste.children.length === 0;

    const effacer = document.getElementById('poolSearchClear');
    if (effacer) effacer.hidden = !(champ && champ.value.length);
}

document.addEventListener('DOMContentLoaded', () => {
    const champ = document.getElementById('poolSearchInput');
    if (champ) {
        // Lien « Inviter » de l'accueil (accueil-mobile.js) : la liste
        // arrive déjà filtrée sur le pool de celui qui a invité.
        const demande = new URLSearchParams(location.search).get('q');
        if (demande) { champ.value = demande; filtrerPoolsDisponibles(); }
        champ.addEventListener('input', filtrerPoolsDisponibles);
        // `search` couvre la croix native du champ sur certains navigateurs.
        champ.addEventListener('search', filtrerPoolsDisponibles);
    }

    const effacer = document.getElementById('poolSearchClear');
    if (effacer) {
        effacer.addEventListener('click', () => {
            champ.value = '';
            champ.focus();
            filtrerPoolsDisponibles();
        });
    }

    document.querySelectorAll('.pool-filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            filtreAcces = chip.dataset.acces;
            document.querySelectorAll('.pool-filter-chip').forEach(c => {
                const actif = c === chip;
                c.classList.toggle('is-active', actif);
                c.setAttribute('aria-pressed', String(actif));
            });
            filtrerPoolsDisponibles();
        });
    });
});

// 🔎 Voir les équipes d'un clan
//
// La modale « Choisir une équipe » est un écran de décision : on y vient
// pour savoir où il reste de la place, et avec qui on va jouer. Tout ce qui
// suit sert ces deux questions, dans cet ordre.

/** Places par équipe. Le serveur l'annonce ; ce repli ne sert qu'au cas où. */
const CM_PLACES_PAR_DEFAUT = 5;

/**
 * Échappe un texte destiné à du HTML construit à la main.
 *
 * Les noms de pool et d'équipe sont écrits par les utilisateurs : les coller
 * tels quels dans un gabarit, c'est leur laisser fermer la balise.
 */
function cmEchapper(texte) {
    return String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Le squelette affiché pendant l'aller-retour réseau.
 *
 * La modale ne s'ouvrait qu'une fois la réponse arrivée : sur une connexion
 * lente, le clic restait sans effet visible et on recliquait. Elle s'ouvre
 * maintenant tout de suite, et se remplit ensuite.
 */
function cmSquelette() {
    const carte = `
        <li class="cm-team is-loading">
            <span class="cm-skel cm-skel-name"></span>
            <span class="cm-skel cm-skel-line"></span>
        </li>`;
    return `
        <div class="cm-head">
            <span class="cm-skel cm-skel-img"></span>
            <span class="cm-skel cm-skel-title"></span>
        </div>
        <ul class="cm-teams">${carte.repeat(3)}</ul>`;
}

/**
 * Les places d'une équipe, en pastilles.
 *
 * Un « 3/5 » se lit ; cinq pastilles dont trois pleines se voient. Les deux
 * sont là, parce qu'on balaie une liste d'équipes du regard avant de lire
 * quoi que ce soit — et parce qu'une forme seule ne dit rien à un lecteur
 * d'écran.
 */
function cmPlaces(pris, total) {
    const puces = Array.from({ length: total }, (_, i) =>
        `<span class="cm-seat${i < pris ? ' is-taken' : ''}"></span>`).join('');
    const libres = Math.max(0, total - pris);
    return `
        <div class="cm-seats">
            <span class="cm-seat-dots" aria-hidden="true">${puces}</span>
            <span class="cm-seat-txt">${pris}/${total}</span>
            <span class="cm-seat-free">${libres > 0
                ? `${libres} place${libres > 1 ? 's' : ''} libre${libres > 1 ? 's' : ''}`
                : 'complète'}</span>
        </div>`;
}

async function viewClanTeams(clanName) {
    // On ouvre avant de demander : un clic doit répondre tout de suite.
    $("#clan-members-content").html(cmSquelette());
    $("#clan-members-modal").css("display", "flex");

    try {
        // Route dédiée : elle donne le nom des équipes, qui s'y trouve déjà
        // et combien de places restent. /draft ne livre plus les alignements
        // d'un pool qu'on n'a pas rejoint.
        const response = await fetch(`${BASE_URL}/pool-teams/${encodeURIComponent(clanName)}?t=${Date.now()}`,
            { cache: "no-store" });
        if (!response.ok) throw new Error('Pool introuvable');
        const vue = await response.json();

        const username = localStorage.getItem("username");
        const places = vue.maxParTeam || CM_PLACES_PAR_DEFAUT;
        const draftStarted = vue.draftStarted === true;
        const monEquipe = vue.monEquipe || null;

        const equipes = (vue.teams || []).map(e => {
            const membres = e.members || [];
            // `memberCount` fait foi sur le nombre, `full` sur le quota : le
            // serveur connaît les deux. Compter les noms reçus affichait
            // « 0/5 joueurs » sur une équipe pleine, du temps où ils
            // n'arrivaient pas jusqu'ici.
            const pris = e.memberCount ?? membres.length;
            return {
                nom: e.name,
                membres,
                pris,
                pleine: e.full === true || pris >= places,
                mienne: !!monEquipe && e.name === monEquipe,
                clubs: e.clubs || []
            };
        });

        await Promise.all([
            typeof prefetchAvatars === 'function'
                ? prefetchAvatars(equipes.flatMap(e => e.membres))
                : Promise.resolve(),
            // La carte des joueurs ne sert qu'aux vignettes des choix déjà
            // faits. Sans choix à dessiner, c'est un aller-retour pour rien.
            equipes.some(e => e.clubs.length > 0) ? loadPlayerMap() : Promise.resolve()
        ]);

        // L'ordre porte la décision : la sienne d'abord — c'est souvent pour
        // elle qu'on ouvre —, puis ce qu'on peut rejoindre, et les équipes
        // pleines en fin de liste plutôt qu'intercalées entre deux choix
        // possibles.
        const rang = e => e.mienne ? 0 : (e.pleine ? 2 : 1);
        equipes.sort((a, b) => rang(a) - rang(b));

        const total = equipes.reduce((n, e) => n + e.pris, 0);
        const ouvertes = equipes.filter(e => !e.pleine && !e.mienne).length;

        const etat = !equipes.length
            // Sans équipe du tout, « toutes les équipes sont complètes »
            // se contredirait avec le message affiché juste en dessous.
            ? 'aucune équipe configurée'
            : draftStarted
            ? 'repêchage commencé'
            : ouvertes > 0
            ? `${ouvertes} équipe${ouvertes > 1 ? 's' : ''} ouverte${ouvertes > 1 ? 's' : ''}`
            : 'toutes les équipes sont complètes';

        const poolImg = vue.imageUrl
            ? `<img src="${cmEchapper(vue.imageUrl)}" class="cm-pool-img" alt=""
                    onerror="this.src='Icons/grayGroup.png'">`
            : `<img src="Icons/grayGroup.png" class="cm-pool-img" alt="">`;

        // L'en-tête de la modale dit déjà « Choisir une équipe » ; cette
        // ligne dit dans quel pool, et ce qu'il y reste.
        let html = `
            <div class="cm-head">
                ${poolImg}
                <div class="cm-head-txt">
                    <span class="cm-head-name">${cmEchapper(clanName)}</span>
                    <span class="cm-head-meta">${total} participant${total > 1 ? 's' : ''} · ${etat}</span>
                </div>
            </div>`;

        if (draftStarted) {
            html += `<div class="cm-banner">Le repêchage est commencé — le changement d'équipe n'est plus possible.</div>`;
        }

        if (!equipes.length) {
            html += `<p class="cm-vide">Ce pool n'a aucune équipe configurée.</p>`;
        }

        html += '<ul class="cm-teams">';

        for (const e of equipes) {
            const nomEchappe = cmEchapper(e.nom);
            const teamId = e.nom.replace(/[^a-zA-Z0-9]/g, '_');
            const peutRejoindre = !e.mienne && !e.pleine && !draftStarted;
            const etatClasse = e.mienne ? ' is-mine' : e.pleine ? ' is-full' : peutRejoindre ? ' is-open' : '';

            const badge = e.mienne
                ? `<span class="cm-badge cm-badge-mine">Votre équipe</span>`
                : e.pleine
                ? `<span class="cm-badge cm-badge-full">Complète</span>`
                : '';

            const crayon = e.mienne ? `
                <button type="button" class="cm-rename-pencil"
                        data-cm-rename data-cm-pool="${cmEchapper(clanName)}"
                        data-cm-team="${nomEchappe}" data-cm-id="${teamId}"
                        title="Renommer mon équipe" aria-label="Renommer mon équipe">
                    ${typeof getIcon === 'function' ? getIcon('pencil', 14) : '&#9998;'}
                </button>` : '';

            // Voir qui est déjà là décide du choix plus sûrement que le
            // décompte : on vient rejoindre quelqu'un.
            const membres = e.membres.length
                ? `<ul class="cm-member-list">${e.membres.map(m => `
                       <li class="cm-member${m === username ? ' is-me' : ''}">
                           ${typeof avatarHtml === 'function'
                               ? avatarHtml(m, 24)
                               : `<img src="Icons/grayUser.png" class="cm-member-avatar" alt="">`}
                           <span>${cmEchapper(m)}</span>
                       </li>`).join('')}</ul>`
                : e.pris > 0
                // Repli : un décompte sans les noms vaut mieux qu'une carte
                // qui se contredit, si la réponse arrive incomplète.
                ? `<p class="cm-empty">${e.pris} participant${e.pris > 1 ? 's' : ''}</p>`
                : `<p class="cm-empty">Personne pour l'instant — soyez le premier.</p>`;

            const action = peutRejoindre ? `
                <button type="button" class="cm-join-btn"
                        data-cm-join data-cm-pool="${cmEchapper(clanName)}" data-cm-team="${nomEchappe}">
                    Rejoindre cette équipe
                </button>` : '';

            // « Équipe 3 » ne dit rien de qui joue dedans : tant qu'une équipe
            // porte sa clé par défaut, on montre ses membres à la place — même
            // règle que poolSettings.js et classement.js. La clé reste écrite
            // en dessous, parce que c'est elle qu'on rejoint.
            const titre = getDisplayName(e.nom, e.membres);
            const cle = titre !== e.nom ? `<span class="cm-team-key">${nomEchappe}</span>` : '';

            html += `
                <li class="cm-team${etatClasse}">
                    <div class="cm-team-head">
                        ${getTeamLogoHTML(e.clubs)}
                        <div class="cm-team-id">
                            <strong class="cm-team-name"><span class="cm-team-label">${cmEchapper(titre)}</span>${crayon}</strong>
                            ${cle}
                        </div>
                        ${badge}
                    </div>
                    ${cmPlaces(e.pris, places)}
                    ${membres}
                    ${action}
                </li>`;
        }

        html += '</ul>';

        $("#clan-members-content").html(html);

    } catch (error) {
        // Un échec muet ici ressemble à un bouton mort : la modale s'ouvre et
        // reste vide, sans rien dire. On l'écrit dedans plutôt que de refermer
        // au nez de la personne.
        console.error("❌ Erreur lors de l'affichage des équipes :", error);
        $("#clan-members-content").html(`
            <p class="cm-vide">Impossible d'afficher les équipes de ce pool pour l'instant.
               Réessayez dans un moment.</p>`);
    }
}

// Un seul écouteur pour toute la modale, dont le balisage est reconstruit à
// chaque ouverture. Les attributs `onclick` d'avant collaient les noms dans
// du code : « Pool d'Andy » cassait l'appel sur son apostrophe.
document.addEventListener('click', event => {
    const rejoindre = event.target.closest('[data-cm-join]');
    if (rejoindre) {
        joinTeam(rejoindre.dataset.cmPool, rejoindre.dataset.cmTeam);
        return;
    }
    const renommer = event.target.closest('[data-cm-rename]');
    if (renommer) {
        startRename(renommer, renommer.dataset.cmPool, renommer.dataset.cmTeam, renommer.dataset.cmId);
    }
});


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

    if (typeof contientGrossierete === 'function' && contientGrossierete(newName)) {
        alert("Ce nom d'équipe contient un terme inapproprié. Choisissez-en un autre.");
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
//
// Le choix d'équipe passe par viewClanTeams, qui interroge /pool-teams :
// c'est la seule route qui serve une vue à quelqu'un qui n'est pas encore
// membre — nom des équipes, places prises, lesquelles sont pleines.
//
// Cette fonction lisait auparavant les alignements dans /draft. Depuis que
// /draft ne renvoie qu'un résumé de découverte pour les pools qu'on n'a pas
// rejoints, `teams` y est absent : Object.entries(undefined) levait une
// exception que le catch avalait dans la console, et le bouton
// « Rejoindre » de la liste ne faisait plus rien du tout.
function joinClan(clanName) {
    return viewClanTeams(clanName);
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
        const checkResp = await fetch(`${BASE_URL}/pool-teams/${encodeURIComponent(clanName)}?t=${Date.now()}`,
            { cache: "no-store" });
        const vueEquipes = await checkResp.json();
        if (vueEquipes.draftStarted) {
            alert("Le draft a déjà commencé ! Vous ne pouvez plus changer d'équipe.");
            return;
        }

        // Mot de passe : demandé seulement pour entrer dans un pool protégé
        // où l'on n'est pas encore. Changer d'équipe une fois dedans ne le
        // redemande pas — le serveur applique exactement la même règle.
        const dejaMembre = vueEquipes.isMember === true;
        let motDePasse = null;
        if (vueEquipes.hasPassword && !dejaMembre) {
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

        // On vient d'entrer dans ce pool : il devient le contexte courant,
        // sinon la page rechargerait sur un autre pool que celui qu'on
        // vient de rejoindre.
        localStorage.setItem("activePool", clanName);
        localStorage.setItem("draftClan", clanName);

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

// Le bloc « repêchages actifs » vivait dans l'onglet Repêchage de
// l'ancienne page Pools. Il a été remplacé par repechage.html, qui porte
// sur le seul pool actif : plus rien ne rendait dans #activeDraftsList.

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
