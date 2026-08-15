/* ============================================================ */
/* TRADE PAGE — 1-for-1 Position-Locked Trade System           */
/* ============================================================ */

const BASE_URL = window.location.hostname.includes('localhost')
    ? 'http://localhost:3000'
    : window.location.origin;

// State
let currentUsername = null;
let selectedPool = null;
let selectedPoolData = null;
let selectedPartnerTeam = null;
let myTeamName = null;
let myTeamData = null;
let partnerTeamData = null;
let draftData = null;

// Trade Selection State
let selectedMyPlayer = null;
let selectedPartnerPlayer = null;

// Position Filters
let myPositionFilter = 'all';
let partnerPositionFilter = 'all';

// Player images & stats
let imageList = [];
let currentStats = null;

// ============================================================
// IMAGE & STATS HELPERS
// ============================================================
function getMatchingImage(name) {
    return resolveHeadshotByName(name);
}

function getPlayerCurrentStats(name) {
    if (!currentStats || !currentStats.players) return null;
    return currentStats.players.find(p => p.playerName === name) || null;
}

function renderPlayerCardHTML(player, idx, isSelected, isLocked) {
    const name = player.name;
    const isTeam = player.category === 'T';
    const face = !isTeam ? getMatchingImage(name) : null;
    const stats = !isTeam ? getPlayerCurrentStats(name) : null;

    let statsHTML = '';
    if (!isTeam) {
        if (player.category === 'G') {
            const w = stats?.wins ?? 0;
            const svPct = stats?.savePct != null ? stats.savePct.toFixed(3) : '0.000';
            statsHTML = `<span class="pcr-stat">${w}V</span><span class="pcr-stat">${svPct}SV%</span>`;
        } else {
            const g = stats?.goals ?? 0;
            const a = stats?.assists ?? 0;
            const pts = stats?.points ?? 0;
            statsHTML = `<span class="pcr-stat">${g}B</span><span class="pcr-stat">${a}A</span><span class="pcr-stat">${pts}PTS</span>`;
        }
    }

    const faceHTML = face
        ? `<img src="${face}" class="pcr-face" alt="${name}" onerror="this.style.display='none'">`
        : '';

    return `
        <div class="player-card-roster ${isSelected ? 'selected' : ''} ${isLocked ? 'locked' : ''}"
             data-player-idx="${idx}"
             data-player-name="${name.replace(/"/g, '&quot;')}"
             data-player-category="${player.category}">
            ${faceHTML}
            <div class="pcr-position ${player.category.toLowerCase()}">${getCategoryLabel(player.category)}</div>
            <div class="pcr-info">
                <div class="pcr-name">${name}</div>
                ${statsHTML ? `<div class="pcr-stats">${statsHTML}</div>` : ''}
            </div>
        </div>
    `;
}

// ============================================================
// TAB SWITCHING
// ============================================================
let currentTradeTab = 'propose';

function switchTradeTab(tab) {
    currentTradeTab = tab;

    // Update tab buttons
    document.querySelectorAll('.trade-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Update sections
    document.getElementById('proposeTradeSection').classList.toggle('active', tab === 'propose');
    document.getElementById('receivedTradeSection').classList.toggle('active', tab === 'received');

    // Returning to the propose tab from a completed trade should restart the wizard
    if (tab === 'propose') {
        const success = document.getElementById('tradeSuccessScreen');
        if (success && !success.classList.contains('hidden')) {
            resetTrade();
        }
    }

    if (tab === 'received') {
        loadReceivedTrades();
        loadCompletedTrades();
    }
}

// ============================================================
// NOTIFICATION SYSTEM
// ============================================================
function showNotification(message, type = 'info') {
    // Remove existing notification
    const existing = document.querySelector('.trade-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = `trade-notification trade-notification-${type}`;
    // Silent to screen readers otherwise: this is the only feedback a trade
    // proposal, acceptance, decline, or validation error gets, and it
    // auto-dismisses in 4s. 'error' gets the assertive role since it can
    // block the task; success/info are ambient confirmations.
    notification.setAttribute('role', type === 'error' ? 'alert' : 'status');
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${typeof getIcon === 'function' ? (type === 'success' ? getIcon('check',18) : type === 'error' ? getIcon('x',18) : getIcon('warning',18)) : ''}</span>
            <span class="notification-message">${message}</span>
        </div>
    `;

    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => notification.classList.add('show'), 10);

    // Auto remove after 4 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

function showLoading(button, text = 'Chargement...') {
    button.disabled = true;
    button.dataset.originalText = button.innerHTML;
    button.innerHTML = `<span class="loading-spinner"></span> ${text}`;
}

function hideLoading(button) {
    button.disabled = false;
    button.innerHTML = button.dataset.originalText || button.innerHTML;
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    currentUsername = localStorage.getItem('username');

    if (!currentUsername) {
        showNotification('⛔ Vous devez être connecté pour accéder à cette page !', 'error');
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
        return;
    }

    // Load images and current stats in parallel
    const [statsRes] = await Promise.allSettled([
        fetch(`${BASE_URL}/current-stats`, { cache: 'no-store' }).then(r => r.json())
    ]);
    if (statsRes.status === 'fulfilled') currentStats = statsRes.value;

    // FZPool a déjà lu /draft : inutile de le redemander.
    await FZPool.ready();
    draftData = FZPool.all();
    applyActivePool();

    // Une notification d'échange arrive avec ?trade=<id> : l'onglet des
    // échanges reçus s'ouvre alors directement sur la proposition visée.
    // L'onglet d'abord — switchTradeTab recharge la liste, et le ferait
    // sans la cible s'il passait après.
    const cible = new URLSearchParams(window.location.search).get('trade');
    if (cible) switchTradeTab('received');
    await loadReceivedTrades(cible);

    // Changer de pool depuis le rail recompose la page sans rechargement.
    FZPool.on(() => {
        applyActivePool();
        loadReceivedTrades();
        loadCompletedTrades();
    });
});

// Le rail n'a pas besoin de recharger : l'assistant se reconstruit ici.
window.FZ_POOL_EN_PLACE = true;

/**
 * Amène l'assistant sur le pool actif.
 *
 * L'ancienne étape 1 faisait choisir un pool à chaque échange, alors que
 * le contexte est déjà fixé ailleurs. Il ne reste qu'à vérifier que le
 * pool actif permet réellement un échange.
 */
function applyActivePool() {
    const nom = FZPool.get();
    const pool = FZPool.mine().find(p => p.name === nom);
    const grille = document.getElementById('teamGrid');
    const info = document.getElementById('tradePoolInfo');

    // Repartir de l'étape 1 : un échange à moitié construit appartenait au
    // pool précédent et n'a plus de sens ici.
    selectedPool = null;
    selectedPoolData = null;
    myTeamName = null;
    myTeamData = null;
    selectedPartnerTeam = null;
    partnerTeamData = null;
    selectedMyPlayer = null;
    selectedPartnerPlayer = null;

    document.getElementById('tradeSuccessScreen').classList.add('hidden');
    document.getElementById('tradeProgress').style.display = '';
    document.getElementById('stepTeam').classList.remove('hidden');
    document.getElementById('stepTrade').classList.add('hidden');
    setTradeProgress(1);

    if (!pool) {
        if (info) info.textContent = '';
        if (grille) grille.innerHTML =
            '<p class="empty-msg">Aucun pool actif. Créez un pool ou rejoignez-en un pour échanger.</p>';
        return;
    }

    if (pool.data.allowTrades === false) {
        if (info) info.textContent = pool.name;
        if (grille) grille.innerHTML =
            `<p class="empty-msg">Les échanges sont désactivés dans « ${pool.name} ».</p>`;
        return;
    }

    if (FZPool.draftState(pool.data).etat !== 'termine') {
        if (info) info.textContent = pool.name;
        if (grille) grille.innerHTML =
            `<p class="empty-msg">Le repêchage de « ${pool.name} » n'est pas terminé.<br>` +
            'Les échanges ouvriront ensuite.</p>';
        return;
    }

    // FZPool se rafraîchit sur les évènements socket : ses données sont au
    // moins aussi fraîches que le draftData chargé au démarrage.
    selectedPool = pool.name;
    selectedPoolData = pool.data || draftData[pool.name];
    myTeamName = pool.teamName;
    myTeamData = selectedPoolData.teams[pool.teamName];

    if (info) info.textContent = `Pool : ${pool.name} · votre équipe : ${myTeamName}`;
    renderTeamGrid();
    applyPrefillIfPresent();
}

/**
 * Arriving from a "for sale" listing (see accueil.js's Activité de la
 * ligue tab): trade.html?withTeam=<team>&wantPlayer=<player>&category=<F|D|G|R|T>
 * jumps straight to step 2 with that player pre-selected as the target,
 * using the exact same selection functions a real click would call — the
 * user still explicitly picks their own offered player, this only saves
 * the two clicks to get there. A stale link (player already moved on)
 * falls through to the normal team-grid view rather than faking a pick.
 */
function applyPrefillIfPresent() {
    const params = new URLSearchParams(window.location.search);
    const withTeam = params.get('withTeam');
    const wantPlayer = params.get('wantPlayer');
    const category = params.get('category');
    if (!withTeam || !wantPlayer || !category || !selectedPoolData) return;

    const targetTeamData = selectedPoolData.teams[withTeam];
    if (!targetTeamData) return;

    const partnerPlayers = [
        ...(targetTeamData.offensive || []),
        ...(targetTeamData.defensive || []),
        ...(targetTeamData.goalie || []),
        ...(targetTeamData.rookie || []),
        ...(targetTeamData.teams || [])
    ];
    if (!partnerPlayers.includes(wantPlayer)) return;

    selectPartnerTeam(withTeam);
    selectPartnerPlayer(wantPlayer, category, null);

    // Don't replay a since-stale prefill on refresh/back.
    history.replaceState(null, '', 'trade.html');
}

// ============================================================
// DATA LOADING
// ============================================================
// Après un échange accepté, les effectifs ont bougé : on repasse par le
// contexte, qui rafraîchit /draft une seule fois pour toute la page.
async function loadDraftData() {
    await FZPool.refresh();
    draftData = FZPool.all();
}

// ============================================================
// ASSISTANT — deux étapes depuis que le pool est un contexte
// ============================================================
let currentTradeStep = 1;

function setTradeProgress(step) {
    currentTradeStep = step;
    document.querySelectorAll('.tp-step').forEach(el => {
        const s = parseInt(el.dataset.step);
        el.classList.toggle('active', s === step);
        el.classList.toggle('done', s < step);
        // Only completed (earlier) steps are clickable — you can go back but
        // not jump ahead of where you are.
        el.classList.toggle('reachable', s < step);
        const dot = el.querySelector('.tp-dot');
        if (dot) dot.innerHTML = s < step ? '✓' : s;
    });
    document.querySelectorAll('.tp-line').forEach(el => {
        el.classList.toggle('filled', parseInt(el.dataset.line) < step);
    });
}

// Le fil d'Ariane ne sert qu'à revenir en arrière : on ne saute pas
// par-dessus une étape qu'on n'a pas encore franchie.
function goToStep(step) {
    if (step >= currentTradeStep) return;

    document.getElementById('stepTeam').classList.toggle('hidden', step !== 1);
    document.getElementById('stepTrade').classList.toggle('hidden', step !== 2);
    setTradeProgress(step);

    if (step === 1) renderTeamGrid();
    else if (step === 2) { renderMyRoster(); renderPartnerRoster(); updateTradeSummary(); }
}

// Back navigation preserves prior selections (Jakob's Law) — going back
// to review a step should not wipe out choices already made.
function backToTeams() { goToStep(1); }

// ============================================================
// STEP 2: TEAM SELECTION
// ============================================================
function renderTeamGrid() {
    const container = document.getElementById('teamGrid');
    if (!container || !selectedPoolData) return;

    const teams = [];

    Object.entries(selectedPoolData.teams || {}).forEach(([teamName, teamData]) => {
        if (teamName === myTeamName) return; // Exclude user's own team

        const roster = [
            ...(teamData.offensive || []),
            ...(teamData.defensive || []),
            ...(teamData.goalie || []),
            ...(teamData.rookie || []),
            ...(teamData.teams || [])
        ];

        if (roster.length === 0) return; // Skip teams with no players

        teams.push({
            name: teamName,
            manager: teamData.members?.[0] || 'Unknown',
            players: roster.length,
            data: teamData
        });
    });

    if (teams.length === 0) {
        container.innerHTML = '<p class="empty-msg">Aucune autre équipe dans ce pool</p>';
        return;
    }

    container.innerHTML = teams.map(team => `
        <div class="team-card" onclick="selectPartnerTeam('${team.name}')">
            <div class="team-card-name">${team.name}</div>
            <div class="team-card-manager">Manager: ${team.manager}</div>
            <div class="team-card-stats">
                <div class="team-stat">
                    <span class="team-stat-value">${team.players}</span>
                    <span class="team-stat-label">Joueurs</span>
                </div>
            </div>
        </div>
    `).join('');
}

function selectPartnerTeam(teamName) {
    // If switching to a different partner, clear player picks
    if (selectedPartnerTeam && selectedPartnerTeam !== teamName) {
        selectedMyPlayer = null;
        selectedPartnerPlayer = null;
    }

    selectedPartnerTeam = teamName;
    partnerTeamData = selectedPoolData.teams[teamName];

    // Passe à la construction de l'échange
    document.getElementById('stepTeam').classList.add('hidden');
    document.getElementById('stepTrade').classList.remove('hidden');
    setTradeProgress(2);

    document.getElementById('selectedPoolTeamInfo').textContent =
        `Pool: ${selectedPool} · ${myTeamName} ⇄ ${selectedPartnerTeam}`;

    // Load rosters
    document.getElementById('myTeamName').textContent = myTeamName;
    document.getElementById('partnerTeamName').textContent = selectedPartnerTeam;

    renderMyRoster();
    renderPartnerRoster();
}

// ============================================================
// STEP 3: ROSTER RENDERING
// ============================================================
function renderMyRoster() {
    const container = document.getElementById('myRoster');
    if (!container || !myTeamData) return;

    const players = [
        ...(myTeamData.offensive || []).map(p => {
            // Handle both string and object formats
            if (typeof p === 'string') {
                return { name: p, category: 'F', type: 'offensive' };
            }
            return { ...p, name: p.skaterFullName || p.goalieFullName || p, category: 'F', type: 'offensive' };
        }),
        ...(myTeamData.defensive || []).map(p => {
            if (typeof p === 'string') {
                return { name: p, category: 'D', type: 'defensive' };
            }
            return { ...p, name: p.skaterFullName || p.goalieFullName || p, category: 'D', type: 'defensive' };
        }),
        ...(myTeamData.goalie || []).map(p => {
            if (typeof p === 'string') {
                return { name: p, category: 'G', type: 'goalie' };
            }
            return { ...p, name: p.skaterFullName || p.goalieFullName || p, category: 'G', type: 'goalie' };
        }),
        ...(myTeamData.rookie || []).map(p => {
            if (typeof p === 'string') {
                return { name: p, category: 'R', type: 'rookie' };
            }
            return { ...p, name: p.skaterFullName || p.goalieFullName || p, category: 'R', type: 'rookie' };
        }),
        ...(myTeamData.teams || []).map(p => {
            if (typeof p === 'string') {
                return { name: p, category: 'T', type: 'team' };
            }
            return { ...p, name: p.teamFullName || p, category: 'T', type: 'team' };
        })
    ];

    // Apply filter
    let filteredPlayers = players;
    if (myPositionFilter !== 'all') {
        filteredPlayers = players.filter(p => p.category === myPositionFilter);
    }

    if (filteredPlayers.length === 0) {
        container.innerHTML = '<p class="empty-msg">Aucun joueur dans cette catégorie</p>';
        return;
    }

    container.innerHTML = filteredPlayers.map((player, idx) => {
        const isSelected = selectedMyPlayer && selectedMyPlayer.name === player.name;
        const isLocked = selectedPartnerPlayer && selectedPartnerPlayer.category !== player.category;
        return renderPlayerCardHTML(player, idx, isSelected, isLocked);
    }).join('');

    // Add click event listeners
    const myPlayerCards = container.querySelectorAll('.player-card-roster:not(.locked)');
    myPlayerCards.forEach((card, idx) => {
        card.addEventListener('click', () => {
            const playerIdx = parseInt(card.dataset.playerIdx);
            const player = filteredPlayers[playerIdx];
            selectMyPlayer(player.name, player.category, player);
        });
    });
}

function renderPartnerRoster() {
    const container = document.getElementById('partnerRoster');
    if (!container || !partnerTeamData) return;

    const players = [
        ...(partnerTeamData.offensive || []).map(p => {
            if (typeof p === 'string') {
                return { name: p, category: 'F', type: 'offensive' };
            }
            return { ...p, name: p.skaterFullName || p.goalieFullName || p, category: 'F', type: 'offensive' };
        }),
        ...(partnerTeamData.defensive || []).map(p => {
            if (typeof p === 'string') {
                return { name: p, category: 'D', type: 'defensive' };
            }
            return { ...p, name: p.skaterFullName || p.goalieFullName || p, category: 'D', type: 'defensive' };
        }),
        ...(partnerTeamData.goalie || []).map(p => {
            if (typeof p === 'string') {
                return { name: p, category: 'G', type: 'goalie' };
            }
            return { ...p, name: p.skaterFullName || p.goalieFullName || p, category: 'G', type: 'goalie' };
        }),
        ...(partnerTeamData.rookie || []).map(p => {
            if (typeof p === 'string') {
                return { name: p, category: 'R', type: 'rookie' };
            }
            return { ...p, name: p.skaterFullName || p.goalieFullName || p, category: 'R', type: 'rookie' };
        }),
        ...(partnerTeamData.teams || []).map(p => {
            if (typeof p === 'string') {
                return { name: p, category: 'T', type: 'team' };
            }
            return { ...p, name: p.teamFullName || p, category: 'T', type: 'team' };
        })
    ];

    // Apply filter
    let filteredPlayers = players;
    if (partnerPositionFilter !== 'all') {
        filteredPlayers = players.filter(p => p.category === partnerPositionFilter);
    }

    if (filteredPlayers.length === 0) {
        container.innerHTML = '<p class="empty-msg">Aucun joueur dans cette catégorie</p>';
        return;
    }

    container.innerHTML = filteredPlayers.map((player, idx) => {
        const isSelected = selectedPartnerPlayer && selectedPartnerPlayer.name === player.name;
        const isLocked = selectedMyPlayer && selectedMyPlayer.category !== player.category;
        return renderPlayerCardHTML(player, idx, isSelected, isLocked);
    }).join('');

    // Add click event listeners
    const partnerPlayerCards = container.querySelectorAll('.player-card-roster:not(.locked)');
    partnerPlayerCards.forEach((card, idx) => {
        card.addEventListener('click', () => {
            const playerIdx = parseInt(card.dataset.playerIdx);
            const player = filteredPlayers[playerIdx];
            selectPartnerPlayer(player.name, player.category, player);
        });
    });
}

// ============================================================
// PLAYER SELECTION (1-for-1 Position-Locked)
// ============================================================
function selectMyPlayer(name, category, playerData) {
    // If already selected, deselect
    if (selectedMyPlayer && selectedMyPlayer.name === name) {
        selectedMyPlayer = null;
    } else {
        selectedMyPlayer = {
            name,
            category,
            data: playerData,
            type: getCategoryType(category)
        };
    }

    // Re-render rosters to show locked/unlocked states
    renderMyRoster();
    renderPartnerRoster();
    updateTradeSummary();
}

function selectPartnerPlayer(name, category, playerData) {
    // Validate position match
    if (selectedMyPlayer && selectedMyPlayer.category !== category) {
        // Show error message
        showNotification(`⚠️ Position invalide! Vous devez échanger ${getCategoryLabel(selectedMyPlayer.category)} ↔ ${getCategoryLabel(selectedMyPlayer.category)}`, 'error');
        return;
    }

    // If already selected, deselect
    if (selectedPartnerPlayer && selectedPartnerPlayer.name === name) {
        selectedPartnerPlayer = null;
    } else {
        selectedPartnerPlayer = {
            name,
            category,
            data: playerData,
            type: getCategoryType(category)
        };
    }

    // Re-render rosters to show locked/unlocked states
    renderMyRoster();
    renderPartnerRoster();
    updateTradeSummary();
}

// ============================================================
// TRADE SUMMARY UPDATE
// ============================================================
function updateTradeSummary() {
    const emptyState = document.getElementById('tradeEmptyState');
    const activeSummary = document.getElementById('tradeActiveSummary');
    const proposeBtn = document.getElementById('btnProposeTrade');

    if (!selectedMyPlayer || !selectedPartnerPlayer) {
        emptyState.classList.remove('hidden');
        activeSummary.classList.add('hidden');
        proposeBtn.disabled = true;
        proposeBtn.classList.remove('ready');
        tmSyncMobile();
        return;
    }

    emptyState.classList.add('hidden');
    activeSummary.classList.remove('hidden');

    // Validate position match
    const isValid = selectedMyPlayer.category === selectedPartnerPlayer.category;
    proposeBtn.disabled = !isValid;
    // Von Restorff: make the unlock moment pop
    proposeBtn.classList.toggle('ready', isValid);

    // Get real stats from current-stats endpoint
    const myLiveStats = getPlayerCurrentStats(selectedMyPlayer.name);
    const partnerLiveStats = getPlayerCurrentStats(selectedPartnerPlayer.name);

    const buildStats = (category, liveStats) => {
        if (category === 'G') {
            const w = liveStats?.wins ?? 0;
            const sv = liveStats?.savePct != null ? liveStats.savePct.toFixed(3) : '0.000';
            return `${w}V · ${sv}SV%`;
        }
        if (category === 'T') return 'Équipe NHL';
        const g = liveStats?.goals ?? 0;
        const a = liveStats?.assists ?? 0;
        const pts = liveStats?.points ?? 0;
        return `${g}B · ${a}A · ${pts}PTS`;
    };

    const buildSummaryPlayerHTML = (player, liveStats) => {
        const face = getMatchingImage(player.name);
        const teamAbbrev = liveStats?.teamAbbrev || '';
        return `
            <div class="summary-player-photo">
                ${face
                    ? `<img src="${face}" alt="${player.name}" onerror="this.style.display='none'">`
                    : '<div style="width:80px;height:80px;display:flex;align-items:center;justify-content:center;font-size:32px;">🏒</div>'
                }
            </div>
            <div class="summary-player-name">${player.name}</div>
            <div class="summary-player-info">
                ${getCategoryLabel(player.category)}${teamAbbrev ? ' · ' + teamAbbrev : ''}<br>
                ${buildStats(player.category, liveStats)}
            </div>
        `;
    };

    const myPlayerHTML = buildSummaryPlayerHTML(selectedMyPlayer, myLiveStats);
    const partnerPlayerHTML = buildSummaryPlayerHTML(selectedPartnerPlayer, partnerLiveStats);

    document.getElementById('summaryMyPlayer').innerHTML = myPlayerHTML;
    document.getElementById('summaryPartnerPlayer').innerHTML = partnerPlayerHTML;

    // Position match badge
    const matchBadge = document.getElementById('positionMatchBadge');
    if (isValid) {
        matchBadge.className = 'position-match valid';
        matchBadge.textContent = `✓ ${getCategoryLabel(selectedMyPlayer.category)} Match`;
    } else {
        matchBadge.className = 'position-match invalid';
        matchBadge.textContent = '✗ Position Mismatch';
    }

    // Stat comparison
    renderStatComparison();

    // Paniers et barre fixe de la vue telephone.
    tmSyncMobile();
}

function renderStatComparison() {
    const container = document.getElementById('statComparison');
    if (!selectedMyPlayer || !selectedPartnerPlayer) return;

    const my = getPlayerCurrentStats(selectedMyPlayer.name) || {};
    const partner = getPlayerCurrentStats(selectedPartnerPlayer.name) || {};

    // Different stats for goalies vs skaters
    if (selectedMyPlayer.category === 'G') {
        container.innerHTML = `
            <div class="stat-comp-row">
                <span class="stat-comp-label">Victoires</span>
                <div class="stat-comp-values">
                    <span class="my-val">${my.wins || 0}</span>
                    <span class="partner-val">${partner.wins || 0}</span>
                </div>
            </div>
            <div class="stat-comp-row">
                <span class="stat-comp-label">% Arrêts</span>
                <div class="stat-comp-values">
                    <span class="my-val">${(my.savePct || 0).toFixed(3)}</span>
                    <span class="partner-val">${(partner.savePct || 0).toFixed(3)}</span>
                </div>
            </div>
            <div class="stat-comp-row">
                <span class="stat-comp-label">Blanchissages</span>
                <div class="stat-comp-values">
                    <span class="my-val">${my.shutouts || 0}</span>
                    <span class="partner-val">${partner.shutouts || 0}</span>
                </div>
            </div>
            <div class="stat-comp-row">
                <span class="stat-comp-label">Buts Contre</span>
                <div class="stat-comp-values">
                    <span class="my-val">${my.goalsAgainst || 0}</span>
                    <span class="partner-val">${partner.goalsAgainst || 0}</span>
                </div>
            </div>
        `;
    } else if (selectedMyPlayer.category === 'T') {
        container.innerHTML = `
            <div class="stat-comp-row">
                <span class="stat-comp-label">Équipes NHL</span>
                <div class="stat-comp-values">
                    <span class="my-val">—</span>
                    <span class="partner-val">—</span>
                </div>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="stat-comp-row">
                <span class="stat-comp-label">Buts</span>
                <div class="stat-comp-values">
                    <span class="my-val">${my.goals || 0}</span>
                    <span class="partner-val">${partner.goals || 0}</span>
                </div>
            </div>
            <div class="stat-comp-row">
                <span class="stat-comp-label">Passes</span>
                <div class="stat-comp-values">
                    <span class="my-val">${my.assists || 0}</span>
                    <span class="partner-val">${partner.assists || 0}</span>
                </div>
            </div>
            <div class="stat-comp-row">
                <span class="stat-comp-label">Points</span>
                <div class="stat-comp-values">
                    <span class="my-val">${my.points || 0}</span>
                    <span class="partner-val">${partner.points || 0}</span>
                </div>
            </div>
            <div class="stat-comp-row">
                <span class="stat-comp-label">+/-</span>
                <div class="stat-comp-values">
                    <span class="my-val">${my.plusMinus || 0}</span>
                    <span class="partner-val">${partner.plusMinus || 0}</span>
                </div>
            </div>
        `;
    }
}

// ============================================================
// POSITION FILTERING
// ============================================================
function filterPosition(side, position) {
    if (side === 'my') {
        myPositionFilter = position;

        // Update active tab
        document.querySelectorAll('#myRoster').forEach(() => {
            const tabs = document.querySelectorAll('.roster-column:first-child .pos-tab');
            tabs.forEach(tab => {
                tab.classList.toggle('active', tab.dataset.pos === position);
            });
        });

        renderMyRoster();
    } else {
        partnerPositionFilter = position;

        // Update active tab
        const tabs = document.querySelectorAll('.roster-column:last-child .pos-tab');
        tabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.pos === position);
        });

        renderPartnerRoster();
    }
}

// ============================================================
// STYLED CONFIRM (Aesthetic-Usability — replaces native confirm)
// ============================================================
function showTradeConfirm(detailHtml) {
    return new Promise(resolve => {
        const overlay = document.getElementById('tradeConfirmOverlay');
        const body = document.getElementById('tradeConfirmBody');
        const okBtn = document.getElementById('tradeConfirmOk');
        const cancelBtn = document.getElementById('tradeConfirmCancel');

        // Fallback to native confirm if markup is missing
        if (!overlay || !body || !okBtn || !cancelBtn) {
            resolve(window.confirm('Proposer cet échange ?'));
            return;
        }

        body.innerHTML = detailHtml;
        overlay.classList.add('show');

        const cleanup = (result) => {
            overlay.classList.remove('show');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
            resolve(result);
        };
        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        const onBackdrop = (e) => { if (e.target === overlay) cleanup(false); };
        const onKey = (e) => {
            if (e.key === 'Escape') cleanup(false);
            else if (e.key === 'Enter') cleanup(true);
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        overlay.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
    });
}

// ============================================================
// PROPOSE TRADE
// ============================================================
async function proposeTrade() {
    if (!selectedMyPlayer || !selectedPartnerPlayer) {
        showNotification('Veuillez sélectionner 1 joueur de chaque côté', 'error');
        return;
    }

    if (selectedMyPlayer.category !== selectedPartnerPlayer.category) {
        showNotification('⚠️ Les joueurs doivent être de la même position!', 'error');
        return;
    }

    const confirmed = await showTradeConfirm(`
        <div class="tc-trade-row">
            <div class="tc-side">
                <span class="tc-side-label">${myTeamName} offre</span>
                <strong>${selectedMyPlayer.name}</strong>
            </div>
            <div class="tc-arrow">⇄</div>
            <div class="tc-side">
                <span class="tc-side-label">${selectedPartnerTeam} offre</span>
                <strong>${selectedPartnerPlayer.name}</strong>
            </div>
        </div>
    `);
    if (!confirmed) return;

    const proposal = {
        draftName: selectedPool,
        fromTeam: myTeamName,
        toTeam: selectedPartnerTeam,
        offering: [{
            name: selectedMyPlayer.name,
            type: selectedMyPlayer.type || getCategoryType(selectedMyPlayer.category)
        }],
        receiving: [{
            name: selectedPartnerPlayer.name,
            type: selectedPartnerPlayer.type || getCategoryType(selectedPartnerPlayer.category)
        }],
        status: 'pending',
        date: new Date().toISOString()
    };

    const proposeBtn = document.getElementById('btnProposeTrade');
    showLoading(proposeBtn, 'Envoi...');

    try {
        const res = await fetch(`${BASE_URL}/trade/propose`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(proposal)
        });

        const data = await res.json();

        if (res.ok) {
            loadReceivedTrades(); // Refresh received trades
            updateReceivedBadge(); // Update badge count
            showTradeSuccess(); // Peak-End Rule: satisfying final state
        } else {
            showNotification(`❌ ${data.message}`, 'error');
        }
    } catch (err) {
        console.error('Error proposing trade:', err);
        showNotification('❌ Erreur lors de l\'envoi de la proposition', 'error');
    } finally {
        hideLoading(proposeBtn);
    }
}

// ============================================================
// TRADE SUCCESS SCREEN (Peak-End Rule)
// ============================================================
function showTradeSuccess() {
    const detail = document.getElementById('tradeSuccessDetail');
    if (detail) {
        detail.innerHTML = `<strong>${myTeamName}</strong> offre <strong>${selectedMyPlayer.name}</strong> à <strong>${selectedPartnerTeam}</strong> pour <strong>${selectedPartnerPlayer.name}</strong>.<br>En attente de la réponse de l'autre équipe.`;
    }
    document.getElementById('stepTeam').classList.add('hidden');
    document.getElementById('stepTrade').classList.add('hidden');
    document.getElementById('tradeProgress').style.display = 'none';
    document.getElementById('tradeSuccessScreen').classList.remove('hidden');
}

// ============================================================
// RESET TRADE
// ============================================================
function resetTrade() {
    // Le pool, lui, ne se réinitialise pas : il vient du contexte et
    // c'est applyActivePool() qui le remet en place.
    selectedPartnerTeam = null;
    partnerTeamData = null;
    selectedMyPlayer = null;
    selectedPartnerPlayer = null;
    myPositionFilter = 'all';
    partnerPositionFilter = 'all';

    // Reset UI
    document.getElementById('tradeSuccessScreen').classList.add('hidden');
    document.getElementById('tradeProgress').style.display = '';
    document.getElementById('stepTeam').classList.remove('hidden');
    document.getElementById('stepTrade').classList.add('hidden');
    setTradeProgress(1);

    renderTeamGrid();
}

// ============================================================
// RECEIVED TRADES
// ============================================================
/**
 * Échanges reçus dans le pool actif.
 *
 * `idCible` vient du lien d'une notification : la carte correspondante
 * est mise en évidence et amenée à l'écran, pour ne pas avoir à la
 * chercher dans la liste.
 */
async function loadReceivedTrades(idCible) {
    const container = document.getElementById('receivedTradesContent');
    if (!container) return;

    try {
        const res = await fetch(`${BASE_URL}/trades/pending/${currentUsername}`, { cache: 'no-store' });

        if (!res.ok) {
            console.error('Failed to fetch received trades:', res.status);
            container.innerHTML = '<p class="empty-msg">Erreur lors du chargement des échanges reçus</p>';
            return;
        }

        const tous = await res.json();
        const poolActif = FZPool.get();
        const trades = Array.isArray(tous)
            ? (poolActif ? tous.filter(t => t.draftName === poolActif) : tous)
            : [];

        // Update badge
        updateReceivedBadge(trades.length);

        if (trades.length === 0) {
            container.innerHTML = `
                <div class="empty-msg">
                    <div style="font-size: 3rem; margin-bottom: 16px;">📭</div>
                    <p>Aucune proposition d'échange reçue${poolActif ? ` dans « ${poolActif} »` : ''}</p>
                </div>
            `;
            return;
        }

        container.innerHTML = trades.map(trade => {
            const date = new Date(trade.date);
            const formattedDate = date.toLocaleDateString('fr-CA', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            const offering = trade.offering[0];
            const receiving = trade.receiving[0];
            const offeringCategory = getCategory(offering.type);
            const receivingCategory = getCategory(receiving.type);

            const estCible = idCible && String(trade.id) === String(idCible);

            return `
                <div class="received-trade-card${estCible ? ' is-target' : ''}"
                     data-trade-id="${trade.id}">
                    <div class="trade-card-header">
                        <div class="trade-card-info">
                            <div class="trade-card-teams">${trade.fromTeam} → Vous (${trade.toTeam})</div>
                            <div class="trade-card-date">${formattedDate}</div>
                        </div>
                        <div class="trade-card-status">En attente</div>
                    </div>

                    <div class="trade-card-players">
                        <div class="trade-player">
                            <div class="trade-player-label">Vous recevez</div>
                            <div class="trade-player-name">${offering.name}</div>
                            <span class="trade-player-position ${offeringCategory.toLowerCase()}">${getCategoryLabel(offeringCategory)}</span>
                        </div>

                        <div class="trade-arrow-icon">⇄</div>

                        <div class="trade-player">
                            <div class="trade-player-label">Vous donnez</div>
                            <div class="trade-player-name">${receiving.name}</div>
                            <span class="trade-player-position ${receivingCategory.toLowerCase()}">${getCategoryLabel(receivingCategory)}</span>
                        </div>
                    </div>

                    <div class="trade-card-actions">
                        <button class="btn-decline-trade" onclick="declineTradeProposal('${trade.id}')">
                            ❌ Refuser
                        </button>
                        <button class="btn-accept-trade" onclick="acceptTradeProposal('${trade.id}')">
                            ✅ Accepter
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        if (idCible) {
            const carte = container.querySelector(`[data-trade-id="${CSS.escape(String(idCible))}"]`);
            if (carte) carte.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

    } catch (err) {
        console.error('Error loading received trades:', err);
        container.innerHTML = '<p class="empty-msg">Erreur lors du chargement des échanges reçus</p>';
    }
}

async function loadCompletedTrades() {
    const container = document.getElementById('completedTradesContent');
    if (!container) return;

    try {
        // Load completed trades for the current user
        const res = await fetch(`${BASE_URL}/trades/completed/${currentUsername}`, { cache: 'no-store' });

        if (!res.ok) {
            console.error('Failed to fetch completed trades:', res.status);
            container.innerHTML = '<p class="empty-msg">Erreur lors du chargement</p>';
            return;
        }

        // Même cadrage que les échanges reçus : l'historique porte sur le
        // pool actif, pas sur toutes les ligues à la fois.
        const tous = await res.json();
        const poolActif = FZPool.get();
        const completedTrades = Array.isArray(tous)
            ? (poolActif ? tous.filter(t => t.draftName === poolActif) : tous)
            : [];

        if (completedTrades.length === 0) {
            container.innerHTML = '<p class="empty-msg">Aucun échange complété</p>';
            return;
        }

        container.innerHTML = completedTrades.map(trade => {
            const date = new Date(trade.completedDate || trade.date);
            const day = date.getDate();
            const month = date.toLocaleDateString('fr-CA', { month: 'short' });

            return `
                <div class="history-item">
                    <div class="history-date">
                        <div class="history-day">${day}</div>
                        <div class="history-month">${month}</div>
                    </div>
                    <div class="history-trade">
                        <div>
                            <div class="history-team">${trade.fromTeam} ⇄ ${trade.toTeam}</div>
                            <div class="history-players">
                                ${trade.offering[0]?.name} ↔ ${trade.receiving[0]?.name}
                            </div>
                        </div>
                    </div>
                    <div class="history-status completed">✅ Complété</div>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error('Error loading completed trades:', err);
        container.innerHTML = '<p class="empty-msg">Erreur lors du chargement</p>';
    }
}

// La pastille de l'onglet compte les échanges du pool actif, comme la
// liste qu'elle annonce. Sans compte fourni, on refait le même filtrage
// plutôt que d'afficher un total tous pools confondus.
function updateReceivedBadge(count) {
    const badge = document.getElementById('receivedTradeBadge');
    if (!badge) return;

    const afficher = n => {
        badge.textContent = n;
        badge.style.display = n > 0 ? 'inline-block' : 'none';
    };

    if (count !== undefined) { afficher(count); return; }

    fetch(`${BASE_URL}/trades/pending/${currentUsername}`, { cache: 'no-store' })
        .then(res => res.json())
        .then(trades => {
            const poolActif = FZPool.get();
            const liste = Array.isArray(trades)
                ? (poolActif ? trades.filter(t => t.draftName === poolActif) : trades)
                : [];
            afficher(liste.length);
        })
        .catch(err => console.error('Error fetching received badge count:', err));
}

function getCategory(type) {
    const categoryMap = {
        'offensive': 'F',
        'defensive': 'D',
        'goalie': 'G',
        'rookie': 'R',
        'team': 'T'
    };
    return categoryMap[type] || 'F';
}

async function acceptTradeProposal(tradeId) {
    if (!confirm('Accepter cet échange? Les joueurs seront échangés immédiatement.')) return;

    const btn = event.target;
    showLoading(btn, 'Acceptation...');

    try {
        const res = await fetch(`${BASE_URL}/trade/accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tradeId })
        });

        const data = await res.json();

        if (res.ok) {
            showNotification('✅ Échange accepté avec succès! Les joueurs ont été échangés.', 'success');
            setTimeout(() => {
                loadReceivedTrades();
                loadCompletedTrades();
                loadDraftData(); // Refresh draft data to show updated rosters
                updateReceivedBadge();
            }, 1000);
        } else {
            showNotification(`❌ ${data.message}`, 'error');
            hideLoading(btn);
        }
    } catch (err) {
        console.error('Error accepting trade:', err);
        showNotification('❌ Erreur lors de l\'acceptation de l\'échange', 'error');
        hideLoading(btn);
    }
}

async function declineTradeProposal(tradeId) {
    if (!confirm('Refuser cet échange?')) return;

    const btn = event.target;
    showLoading(btn, 'Refus...');

    try {
        const res = await fetch(`${BASE_URL}/trade/decline`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tradeId })
        });

        if (res.ok) {
            showNotification('Échange refusé', 'info');
            setTimeout(() => {
                loadReceivedTrades();
                loadCompletedTrades();
                updateReceivedBadge();
            }, 500);
        } else {
            const data = await res.json();
            showNotification(`❌ ${data.message}`, 'error');
            hideLoading(btn);
        }
    } catch (err) {
        console.error('Error declining trade:', err);
        showNotification('❌ Erreur lors du refus de l\'échange', 'error');
        hideLoading(btn);
    }
}

// ============================================================
// UTILITIES
// ============================================================
function getCategoryLabel(category) {
    const labels = {
        'F': 'ATT',
        'D': 'DÉF',
        'G': 'GAR',
        'R': 'ROO',
        'T': 'ÉQU'
    };
    return labels[category] || category;
}

function getCategoryType(category) {
    const types = {
        'F': 'offensive',
        'D': 'defensive',
        'G': 'goalie',
        'R': 'rookie',
        'T': 'team'
    };
    return types[category] || 'offensive';
}

function getStatusLabel(status) {
    const labels = {
        'pending': 'En attente',
        'completed': 'Complété',
        'rejected': 'Refusé'
    };
    return labels[status] || status;
}

// ============================================================
// VUE TÉLÉPHONE DE L'ÉTAPE 3
// ------------------------------------------------------------
// Sur petit écran, les trois colonnes s'empilaient sur près de
// trois hauteurs d'écran : il fallait défiler jusqu'en bas pour
// voir ce qu'on donnait, et le bouton de proposition était encore
// plus loin. Cette couche présente les deux paniers en tête, un
// seul effectif à la fois, et le bilan avec son bouton en barre
// fixe.
//
// Elle ne contient aucune logique d'échange : la sélection, le
// verrouillage par position et l'envoi restent ceux de
// selectMyPlayer, selectPartnerPlayer et proposeTrade. Tout ce qui
// suit lit l'état et le reflète.
// ============================================================

let tmRosterActif = 'my';

/** Bascule l'effectif affiché. Au-delà de 900px le CSS rend les deux. */
function tmSwitchRoster(cote) {
    tmRosterActif = cote;
    const grille = document.querySelector('.trade-grid-3col');
    if (grille) grille.dataset.cote = cote;
    document.querySelectorAll('.tm-tab').forEach(t => {
        const actif = t.dataset.cote === cote;
        t.classList.toggle('is-active', actif);
        t.setAttribute('aria-selected', String(actif));
    });
}

/** Clic sur un panier : amène l'effectif correspondant sous les yeux. */
function tmFocusRoster(cote) {
    tmSwitchRoster(cote);
    const onglets = document.querySelector('.tm-tabs');
    if (onglets) onglets.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** « Connor McDavid » → « C. McDavid ». Le panier est étroit. */
function tmAbrege(nom) {
    const mots = String(nom || '').trim().split(/\s+/);
    if (mots.length < 2) return nom || '';
    return mots[0].charAt(0) + '. ' + mots.slice(1).join(' ');
}

/**
 * Valeur d'un joueur pour le bilan.
 *
 * Le gabarit affichait une note globale ; le pool n'en produit pas. Les
 * points en tiennent lieu — c'est déjà la mesure sur laquelle le
 * classement repose. Les gardiens n'en marquent pas : leurs victoires
 * jouent le même rôle. Une équipe NHL n'a pas de statistique
 * individuelle : elle reste hors du calcul.
 */
function tmValeur(joueur) {
    if (!joueur) return { valeur: null, unite: '' };
    if (joueur.category === 'T') return { valeur: null, unite: 'ÉQU' };
    const stats = getPlayerCurrentStats(joueur.name);
    if (joueur.category === 'G') return { valeur: stats?.wins ?? 0, unite: 'V' };
    return { valeur: stats?.points ?? 0, unite: 'PTS' };
}

/**
 * Écart relatif entre les deux valeurs, rapporté à leur moyenne.
 *
 * La forme naïve (reçu − donné) / donné explose quand on cède un joueur à
 * zéro point. Rapporter à la moyenne des deux reste défini dès que l'un
 * des deux est non nul, et donne le même écart au signe près selon le
 * côté d'où on regarde.
 */
function tmEquite(donne, recu) {
    if (donne == null || recu == null) return null;
    const moyenne = (donne + recu) / 2;
    if (moyenne === 0) return null;
    return ((recu - donne) / moyenne) * 100;
}

/** Contenu d'un panier : joueur choisi, ou invite à en choisir un. */
function tmRemplirPanier(id, joueur, cote) {
    const slot = document.getElementById(id);
    if (!slot) return;

    if (!joueur) {
        slot.classList.add('is-empty');
        slot.innerHTML = '<span class="tm-slot-empty">'
            + (typeof getIcon === 'function' ? getIcon('plus', 22) : '+')
            + 'Ajouter un joueur</span>';
        return;
    }

    slot.classList.remove('is-empty');
    const stats = getPlayerCurrentStats(joueur.name);
    const face = joueur.category !== 'T' ? getMatchingImage(joueur.name) : null;
    const equipe = stats?.teamAbbrev || '';
    const meta = [equipe, getCategoryLabel(joueur.category)].filter(Boolean).join(' · ');

    slot.innerHTML = `
        <span class="tm-slot-remove" title="Retirer">
            ${typeof getIcon === 'function' ? getIcon('x', 14) : '×'}
        </span>
        ${face
            ? `<img class="tm-slot-face" src="${face}" alt="" onerror="this.remove()">`
            : '<span class="tm-slot-face tm-slot-face-vide"></span>'}
        <span class="tm-slot-name">${tmAbrege(joueur.name)}</span>
        <span class="tm-slot-meta">${meta}</span>
    `;

    // Retirer = re-sélectionner le même joueur, ce que les fonctions
    // existantes interprètent déjà comme une désélection.
    const retirer = slot.querySelector('.tm-slot-remove');
    if (retirer) {
        retirer.addEventListener('click', e => {
            e.stopPropagation();
            if (cote === 'my') selectMyPlayer(joueur.name, joueur.category, joueur.data);
            else selectPartnerPlayer(joueur.name, joueur.category, joueur.data);
        });
    }
}

/** Reflète l'état courant dans les paniers et la barre fixe. */
function tmSyncMobile() {
    tmRemplirPanier('tmSlotGive', selectedMyPlayer, 'my');
    tmRemplirPanier('tmSlotGet', selectedPartnerPlayer, 'partner');

    const donne = tmValeur(selectedMyPlayer);
    const recu = tmValeur(selectedPartnerPlayer);
    const ecrire = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = v.valeur == null ? '—' : `${v.valeur} ${v.unite}`;
    };
    ecrire('tmValGive', donne);
    ecrire('tmValGet', recu);

    const cellEq = document.getElementById('tmValEquity');
    if (cellEq) {
        const eq = tmEquite(donne.valeur, recu.valeur);
        cellEq.textContent = eq == null ? '—'
            : (eq >= 0 ? '+' : '') + eq.toFixed(1) + '%';
        cellEq.classList.toggle('is-positive', eq != null && eq > 0);
        cellEq.classList.toggle('is-negative', eq != null && eq < 0);
    }

    // Le bouton de la barre fixe suit exactement celui de la colonne
    // centrale : une seule condition d'activation, définie ailleurs.
    const source = document.getElementById('btnProposeTrade');
    const cta = document.getElementById('tmCta');
    if (source && cta) {
        cta.disabled = source.disabled;
        cta.classList.toggle('is-ready', source.classList.contains('ready'));
    }
}

/** Enveloppe de proposeTrade() : évite le double envoi depuis la barre. */
async function tmProposeTrade() {
    const cta = document.getElementById('tmCta');
    if (cta) cta.disabled = true;
    try {
        await proposeTrade();
    } finally {
        if (cta) {
            const source = document.getElementById('btnProposeTrade');
            cta.disabled = source ? source.disabled : true;
        }
    }
}
