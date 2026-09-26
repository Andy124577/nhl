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
        // La redirection attend la fermeture : sinon la fenêtre disparaîtrait
        // avant d'avoir été lue.
        fzAlert({
            type: 'warning',
            icon: 'user',
            title: 'Connexion requise',
            message: 'Connectez-vous pour créer ou rejoindre un pool.',
            confirmLabel: 'Se connecter',
            dismissible: false
        }).then(() => { window.location.href = "login.html"; });
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
            fzAlert({ type: 'error', title: 'Changement impossible', message: 'Le changement d’utilisateur a échoué.' });
        }
    } catch (error) {
        console.error('Error switching user:', error);
        fzAlert({ type: 'error', icon: 'offline', title: 'Connexion impossible', message: 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.' });
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
    $("#benchGroup").toggle(mode === 'head-to-head');

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
    const teamName = ($("#teamName").val() || "").trim();
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
    const numBench = poolMode === 'head-to-head'
        ? Math.min(5, Math.max(0, parseInt($("#numBench").val(), 10) || 0)) : 0;
    const allowTrades = $("#allowTrades").is(':checked');
    const poolPassword = ($("#poolPassword").val() || "").trim();
    const username = localStorage.getItem("username");

    // Un refus de formulaire : la fenêtre dit quoi corriger, puis rend la
    // main au champ fautif.
    const refuser = async (title, message, champ) => {
        await fzAlert({ type: 'warning', title, message, confirmLabel: 'Corriger' });
        if (champ) $(champ).trigger('focus');
    };

    if (!clanName || !maxPlayers) {
        return refuser('Formulaire incomplet', 'Donnez un nom au pool et choisissez le nombre maximum de participants.',
            clanName ? '#maxPlayers' : '#clanName');
    }

    if (!teamName) {
        return refuser('Nom d’équipe manquant', 'Donnez un nom à votre équipe.', '#teamName');
    }
    if (teamName.length > 20 || !/^[\p{L}\p{N}\s'\-_]+$/u.test(teamName)) {
        return refuser('Nom d’équipe invalide',
            'De 1 à 20 caractères : lettres, chiffres, espaces, tirets ou apostrophes.', '#teamName');
    }
    if (typeof contientGrossierete === 'function' && contientGrossierete(teamName)) {
        return refuser('Nom d’équipe refusé', 'Ce nom contient un terme inapproprié. Choisissez-en un autre.', '#teamName');
    }

    // Validation des valeurs
    if (numOffensive < 0 || numDefensive < 0 || numGoalies < 0 || numRookies < 0 || numTeams < 0) {
        return refuser('Configuration invalide', 'Le nombre de joueurs par position ne peut pas être négatif.');
    }

    if (typeof contientGrossierete === 'function' && contientGrossierete(clanName)) {
        return refuser('Nom de pool refusé', 'Ce nom contient un terme inapproprié. Choisissez-en un autre.', '#clanName');
    }

    // Le serveur rejetterait de toute façon, mais autant le dire avant
    // d'envoyer : la même borne y est appliquée.
    if (poolPassword && (poolPassword.length < 4 || poolPassword.length > 72)) {
        return refuser('Mot de passe trop court', 'Le mot de passe du pool doit contenir entre 4 et 72 caractères.', '#poolPassword');
    }

    // Head-to-Head : le plafond reste pair, pour qu'un pool plein puisse
    // toujours partir. Le serveur vérifie la parité des équipes au départ.
    if (poolMode === 'head-to-head' && maxPlayers % 2 !== 0) {
        return refuser('Nombre pair requis',
            'En tête-à-tête, les duels se jouent à deux : choisissez un maximum pair (2, 4, 6, 8 ou 10).', '#maxPlayers');
    }

    const poolConfig = {
        name: clanName,
        teamName,
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
            numTeams: numTeams,
            ...(numBench > 0 ? { numBench } : {})
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

            // La suite logique est d'inviter : la page du repêchage, où
            // l'on arrive en fermant, porte la recherche de participants.
            const esc = fzDialog.escape;
            await fzAlert({
                type: 'success',
                title: 'Votre pool est créé !',
                bodyHTML: `<p><strong>${esc(clanName)}</strong> est prêt. Vous y participez avec
                    l’équipe <strong>${esc(teamName)}</strong>.</p>`,
                note: {
                    icon: 'users',
                    title: 'Prochaine étape',
                    text: 'Invitez vos amis : le repêchage pourra commencer dès qu’il y aura 2 équipes.'
                },
                confirmLabel: 'Inviter des participants'
            });

            // Clear form
            $("#clanName").val("");
            $("#teamName").val("");
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
            fzAlert({
                type: 'error',
                title: 'Création impossible',
                message: error.message || 'Le pool n’a pas pu être créé. Réessayez dans un instant.'
            });
        }

    } catch (error) {
        console.error("❌ Erreur lors de la création du clan :", error);
        fzAlert({ type: 'error', icon: 'offline', title: 'Connexion impossible', message: 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.' });
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
            const plafond = clan.maxPlayers || 10;
            const plein = totalParticipants >= plafond;
            const nomEchappe = cmEchapper(clanName);
            $("#available-clans-list").append(`
                <li data-nom="${nomEchappe.toLowerCase()}"
                    data-acces="${protege ? 'protege' : 'ouvert'}">
                    <div class="pool-item-img-wrap">${poolImgHtml}</div>
                    <div class="pool-item-content">
                        <span class="pool-item-name">${nomEchappe}</span>
                        <div class="pool-item-info">
                            <span class="pool-item-badge">👥 ${totalParticipants}/${plafond} participants</span>
                            <span class="pool-item-badge">📋 ${totalPicks} sélections</span>
                            <span class="pool-item-badge pool-acces-badge ${protege ? 'is-protege' : 'is-ouvert'}">
                                ${protege ? '🔒 Mot de passe' : '🔓 Accès libre'}
                            </span>
                        </div>
                    </div>
                    <button class="pool-action-btn secondary" data-rejoindre-pool="${nomEchappe}"${plein ? ' disabled' : ''}>
                        ${plein ? 'Complet' : 'Rejoindre'}
                    </button>
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

// Un seul écouteur pour la liste, reconstruite à chaque rafraîchissement.
// L'ancien `onclick="joinClan('…')"` collait le nom dans du code : « Pool
// d'Andy » cassait l'appel sur son apostrophe.
document.addEventListener('click', event => {
    const bouton = event.target.closest && event.target.closest('[data-rejoindre-pool]');
    if (bouton && !bouton.disabled) joinClan(bouton.dataset.rejoindrePool);
});

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
        champ.addEventListener('keydown', e => {
            if (e.key === 'Escape' && champ.value) { e.preventDefault(); viderRecherchePools(); }
        });
    }

    const effacer = document.getElementById('poolSearchClear');
    if (effacer) {
        effacer.addEventListener('click', () => {
            viderRecherchePools();
            champ.focus();
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

// 🔎 Rejoindre un pool
//
// La modale « Rejoindre le pool » est un écran de décision : on y vient pour
// savoir s'il reste de la place, et avec qui on va jouer. Tout ce qui suit
// sert ces deux questions, dans cet ordre.

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
 * Les places du pool, en pastilles : une par participant possible.
 *
 * Un « 3/10 » se lit ; dix pastilles dont trois pleines se voient. Les deux
 * sont là, parce qu'on balaie la modale du regard avant de lire quoi que ce
 * soit — et parce qu'une forme seule ne dit rien à un lecteur d'écran.
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

/**
 * Le nom d'équipe tapé à l'entrée, validé comme le serveur le fera
 * (routes/pools.js, refusNomEquipe). Renvoie un message, ou null.
 */
function cmValiderNomEquipe(nom) {
    const propre = String(nom == null ? '' : nom).trim();
    if (!propre || propre.length > 20) return "Le nom d'équipe doit contenir entre 1 et 20 caractères.";
    if (!/^[\p{L}\p{N}\s'\-_]+$/u.test(propre)) return "Lettres, chiffres, espaces, tirets et apostrophes seulement.";
    if (typeof contientGrossierete === 'function' && contientGrossierete(propre)) {
        return "Ce nom d'équipe contient un terme inapproprié. Choisissez-en un autre.";
    }
    return null;
}

/**
 * La modale « Rejoindre le pool ».
 *
 * Une personne, une équipe : on n'y choisit plus une case à partager, on
 * nomme la sienne. La modale montre donc ce qui aide à décider d'entrer —
 * qui est déjà là, combien de places restent sous le plafond, le format —
 * puis un seul champ : le nom de son équipe (et le mot de passe si le pool
 * en demande un).
 */
async function viewClanTeams(clanName) {
    // On ouvre avant de demander : un clic doit répondre tout de suite.
    $("#clan-members-content").html(cmSquelette());
    $("#clan-members-modal").css("display", "flex");

    try {
        const response = await fetch(`${BASE_URL}/pool-teams/${encodeURIComponent(clanName)}?t=${Date.now()}`,
            { cache: "no-store" });
        if (!response.ok) throw new Error('Pool introuvable');
        const vue = await response.json();

        const username = localStorage.getItem("username");
        const equipes = (vue.teams || []).filter(e => (e.memberCount ?? (e.members || []).length) > 0);
        const inscrits = vue.participantCount ?? equipes.reduce((n, e) => n + (e.memberCount || 0), 0);
        const max = vue.maxPlayers || 10;
        const plein = inscrits >= max;
        const draftStarted = vue.draftStarted === true;

        if (typeof prefetchAvatars === 'function') {
            await prefetchAvatars(equipes.flatMap(e => e.members || [])).catch(() => {});
        }

        const poolImg = vue.imageUrl
            ? `<img src="${cmEchapper(vue.imageUrl)}" class="cm-pool-img" alt=""
                    onerror="this.src='Icons/grayGroup.png'">`
            : `<img src="Icons/grayGroup.png" class="cm-pool-img" alt="">`;
        const mode = vue.poolMode === 'head-to-head' ? 'Tête-à-tête' : 'Cumulatif';

        let html = `
            <div class="cm-head">
                ${poolImg}
                <div class="cm-head-txt">
                    <span class="cm-head-name">${cmEchapper(clanName)}</span>
                    <span class="cm-head-meta">${mode}${vue.totalPicks ? ` · ${vue.totalPicks} sélections` : ''}${vue.creator ? ` · créé par ${cmEchapper(vue.creator)}` : ''}</span>
                </div>
            </div>
            ${cmPlaces(inscrits, max)}`;

        html += `<h3 class="cm-sub">Déjà inscrits</h3>`;
        html += equipes.length
            ? `<ul class="cm-teams">${equipes.map(e => `
                    <li class="cm-team">
                        <div class="cm-team-head">
                            ${getTeamLogoHTML(e.clubs || [])}
                            <div class="cm-team-id">
                                <strong class="cm-team-name"><span class="cm-team-label">${cmEchapper(getDisplayName(e.name, e.members))}</span></strong>
                            </div>
                        </div>
                        <ul class="cm-member-list">${(e.members || []).map(m => `
                            <li class="cm-member${m === username ? ' is-me' : ''}">
                                ${typeof avatarHtml === 'function'
                                    ? avatarHtml(m, 24)
                                    : `<img src="Icons/grayUser.png" class="cm-member-avatar" alt="">`}
                                <span>${cmEchapper(m)}</span>
                            </li>`).join('')}</ul>
                    </li>`).join('')}</ul>`
            : `<p class="cm-empty">Personne pour l'instant — soyez le premier.</p>`;

        if (draftStarted) {
            html += `<div class="cm-banner">Le repêchage de ce pool est commencé : il n'accepte plus de participants.</div>`;
        } else if (plein) {
            html += `<div class="cm-banner">Ce pool est complet (${max} participants maximum).</div>`;
        } else {
            const suggestion = vue.nomSuggere || (username || '').slice(0, 20);
            html += `
                <form class="cm-join-form" id="cmJoinForm" novalidate>
                    <label for="cmTeamName" class="cm-join-label">Nom de ton équipe</label>
                    <input type="text" id="cmTeamName" class="cm-join-input" maxlength="20" autocomplete="off"
                           value="${cmEchapper(suggestion)}" placeholder="Ex: Les Castors" required>
                    <p class="cm-join-hint">C'est le nom que les autres verront au repêchage et au classement. Modifiable plus tard.</p>
                    ${vue.hasPassword ? `
                        <label for="cmPassword" class="cm-join-label">Mot de passe du pool</label>
                        <input type="password" id="cmPassword" class="cm-join-input" maxlength="72" autocomplete="off"
                               placeholder="Demandez-le à ${cmEchapper(vue.creator || 'la personne qui a créé le pool')}">` : ''}
                    <p class="cm-join-error" id="cmJoinError" role="alert" hidden></p>
                    <button type="submit" class="cm-join-btn" id="cmJoinBtn">Rejoindre le pool</button>
                </form>`;
        }

        $("#clan-members-content").html(html);

        const formulaire = document.getElementById('cmJoinForm');
        if (formulaire) {
            formulaire.addEventListener('submit', (e) => {
                e.preventDefault();
                joinTeam(clanName, document.getElementById('cmTeamName').value, !!vue.hasPassword);
            });
            const champ = document.getElementById('cmTeamName');
            champ.focus();
            champ.select();
        }

    } catch (error) {
        // Un échec muet ici ressemble à un bouton mort : la modale s'ouvre et
        // reste vide, sans rien dire. On l'écrit dedans plutôt que de refermer
        // au nez de la personne.
        console.error("❌ Erreur lors de l'affichage du pool :", error);
        $("#clan-members-content").html(`
            <p class="cm-vide">Impossible d'afficher ce pool pour l'instant.
               Réessayez dans un moment.</p>`);
    }
}

// 🔥 Rejoindre un clan
//
// La modale passe par /pool-teams : c'est la seule route qui serve une vue à
// quelqu'un qui n'est pas encore membre — qui est inscrit, et combien de
// places restent.
//
// Cette fonction lisait auparavant les alignements dans /draft. Depuis que
// /draft ne renvoie qu'un résumé de découverte pour les pools qu'on n'a pas
// rejoints, `teams` y est absent : Object.entries(undefined) levait une
// exception que le catch avalait dans la console, et le bouton
// « Rejoindre » de la liste ne faisait plus rien du tout.
function joinClan(clanName) {
    return viewClanTeams(clanName);
}

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
 * La recherche a servi : on la vide, et on retire `?q=` de l'adresse, sinon
 * le prochain chargement remettrait le nom tapé dans le champ.
 */
function viderRecherchePools() {
    const champ = document.getElementById('poolSearchInput');
    if (champ) champ.value = '';
    const url = new URL(window.location.href);
    if (url.searchParams.has('q')) {
        url.searchParams.delete('q');
        window.history.replaceState(null, '', url.toString());
    }
    if (typeof filtrerPoolsDisponibles === 'function') filtrerPoolsDisponibles();
}

// 🔥 Entrer dans un pool avec son équipe
//
// Le mot de passe n'est jamais conservé côté client : il est saisi, envoyé à
// /join-team, puis oublié. Le serveur le compare à une empreinte bcrypt,
// comme celui d'un compte, et ne renvoie que `hasPassword`.
async function joinTeam(clanName, teamName, avecMotDePasse) {
    const erreur = document.getElementById('cmJoinError');
    const bouton = document.getElementById('cmJoinBtn');
    const dire = (texte) => {
        if (!erreur) { if (texte) fzAlert({ type: 'warning', title: 'Impossible de rejoindre', message: texte }); return; }
        erreur.textContent = texte || '';
        erreur.hidden = !texte;
    };

    const nom = String(teamName || '').trim();
    const refus = cmValiderNomEquipe(nom);
    if (refus) { dire(refus); document.getElementById('cmTeamName')?.focus(); return; }

    const motDePasse = avecMotDePasse ? (document.getElementById('cmPassword')?.value || '').trim() : null;
    if (avecMotDePasse && !motDePasse) {
        dire('Entrez le mot de passe du pool.');
        document.getElementById('cmPassword')?.focus();
        return;
    }

    dire('');
    if (bouton) { bouton.disabled = true; bouton.textContent = 'Inscription…'; }

    try {
        const reponse = await fetch(`${BASE_URL}/join-team`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: clanName, teamName: nom, password: motDePasse })
        });
        const resultat = await reponse.json().catch(() => ({}));

        if (!reponse.ok) {
            dire(resultat.message || "Impossible de rejoindre ce pool.");
            if (resultat.passwordRequired) document.getElementById('cmPassword')?.focus();
            return;
        }

        // On vient d'entrer dans ce pool : il devient le contexte courant, et
        // la suite se passe dans son salon d'attente.
        localStorage.setItem("activePool", clanName);
        localStorage.setItem("draftClan", clanName);
        viderRecherchePools();
        closeModal();
        window.location.href = "repechage.html";
    } catch (error) {
        console.error("❌ Erreur lors de l'inscription :", error);
        dire("Erreur de connexion au serveur.");
    } finally {
        if (bouton) { bouton.disabled = false; bouton.textContent = 'Rejoindre le pool'; }
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
