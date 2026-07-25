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

    await loadDraftData();
    renderPoolSelector();
    loadReceivedTrades();
    updateReceivedBadge();
});

// ============================================================
// DATA LOADING
// ============================================================
async function loadDraftData() {
    try {
        const res = await fetch(`${BASE_URL}/draft?timestamp=${Date.now()}`, { cache: 'no-store' });
        draftData = await res.json();
    } catch (err) {
        console.error('Error loading draft data:', err);
    }
}

// ============================================================
// STEP 1: POOL SELECTION
// ============================================================
// ============================================================
// WIZARD PROGRESS (Goal-Gradient Effect)
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

// Jump to a step via the breadcrumb — backward navigation only.
function goToStep(step) {
    if (step >= currentTradeStep) return; // can't jump forward or re-click current

    document.getElementById('step1').classList.toggle('hidden', step !== 1);
    document.getElementById('step2').classList.toggle('hidden', step !== 2);
    document.getElementById('step3').classList.toggle('hidden', step !== 3);
    setTradeProgress(step);

    if (step === 1) renderPoolSelector();
    else if (step === 2) renderTeamGrid();
    else if (step === 3) { renderMyRoster(); renderPartnerRoster(); updateTradeSummary(); }
}

function renderPoolSelector() {
    const container = document.getElementById('poolSelector');
    if (!container || !draftData) return;

    // Hide skeleton, reveal real selector (Doherty Threshold)
    const skeleton = document.getElementById('poolSelectorSkeleton');
    if (skeleton) skeleton.style.display = 'none';
    container.style.display = '';

    // Filter pools where:
    // 1. User is a participant
    // 2. Draft is complete
    const userPools = [];

    Object.entries(draftData).forEach(([poolName, poolData]) => {
        const userTeamEntry = Object.entries(poolData.teams || {}).find(
            ([, td]) => td.members && td.members.includes(currentUsername)
        );

        if (!userTeamEntry) return;

        const [userTeamName, userTeamData] = userTeamEntry;
        const hasRoster = (userTeamData.offensive?.length || 0) +
                          (userTeamData.defensive?.length || 0) +
                          (userTeamData.goalie?.length || 0) > 0;

        const isDraftComplete = poolData.draftComplete ||
                               poolData.isDraftComplete ||
                               poolData.draftStatus === 'completed' ||
                               hasRoster;

        if (isDraftComplete) {
            userPools.push({
                name: poolName,
                data: poolData,
                userTeam: userTeamName,
                teamCount: Object.keys(poolData.teams || {}).length
            });
        }
    });

    if (userPools.length === 0) {
        container.innerHTML = '<p class="empty-msg">Aucun pool actif disponible pour les échanges.<br>Complétez d\'abord un repêchage.</p>';
        return;
    }

    container.innerHTML = userPools.map(pool => {
        const imgUrl = pool.data.imageUrl;
        const iconHtml = imgUrl
            ? `<img src="${imgUrl}" class="pool-card-icon pool-card-icon-img" alt="${pool.name}">`
            : `<div class="pool-card-icon pool-card-icon-letter">${pool.name.charAt(0).toUpperCase()}</div>`;
        return `
        <div class="pool-card" onclick="selectPool('${pool.name}')">
            <div class="pool-card-header">
                ${iconHtml}
                <div class="pool-name">${pool.name}</div>
                <span class="pool-status active">Actif</span>
            </div>
            <div class="pool-info">
                Votre équipe: <strong>${pool.userTeam}</strong><br>
                ${pool.teamCount} équipes dans le pool
            </div>
        </div>
    `;}).join('');
}

// Back navigation preserves prior selections (Jakob's Law) — going back
// to review a step should not wipe out choices already made.
function backToStep1() { goToStep(1); }
function backToStep2() { goToStep(2); }

function selectPool(poolName) {
    // If switching to a different pool, clear downstream selections
    if (selectedPool && selectedPool !== poolName) {
        selectedPartnerTeam = null;
        partnerTeamData = null;
        selectedMyPlayer = null;
        selectedPartnerPlayer = null;
    }

    selectedPool = poolName;
    selectedPoolData = draftData[poolName];

    // Find user's team
    const userTeamEntry = Object.entries(selectedPoolData.teams || {}).find(
        ([, td]) => td.members && td.members.includes(currentUsername)
    );

    if (!userTeamEntry) return;

    myTeamName = userTeamEntry[0];
    myTeamData = userTeamEntry[1];

    // Show step 2
    document.getElementById('step1').classList.add('hidden');
    document.getElementById('step2').classList.remove('hidden');
    setTradeProgress(2);

    renderTeamGrid();
}

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

    // Show step 3
    document.getElementById('step2').classList.add('hidden');
    document.getElementById('step3').classList.remove('hidden');
    setTradeProgress(3);

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
    document.getElementById('step1').classList.add('hidden');
    document.getElementById('step2').classList.add('hidden');
    document.getElementById('step3').classList.add('hidden');
    document.getElementById('tradeProgress').style.display = 'none';
    document.getElementById('tradeSuccessScreen').classList.remove('hidden');
}

// ============================================================
// RESET TRADE
// ============================================================
function resetTrade() {
    selectedPool = null;
    selectedPoolData = null;
    selectedPartnerTeam = null;
    myTeamName = null;
    myTeamData = null;
    partnerTeamData = null;
    selectedMyPlayer = null;
    selectedPartnerPlayer = null;
    myPositionFilter = 'all';
    partnerPositionFilter = 'all';

    // Reset UI
    document.getElementById('tradeSuccessScreen').classList.add('hidden');
    document.getElementById('tradeProgress').style.display = '';
    document.getElementById('step1').classList.remove('hidden');
    document.getElementById('step2').classList.add('hidden');
    document.getElementById('step3').classList.add('hidden');
    setTradeProgress(1);

    renderPoolSelector();
}

// ============================================================
// RECEIVED TRADES
// ============================================================
async function loadReceivedTrades() {
    const container = document.getElementById('receivedTradesContent');
    if (!container) return;

    try {
        const res = await fetch(`${BASE_URL}/trades/pending/${currentUsername}`, { cache: 'no-store' });

        if (!res.ok) {
            console.error('Failed to fetch received trades:', res.status);
            container.innerHTML = '<p class="empty-msg">Erreur lors du chargement des échanges reçus</p>';
            return;
        }

        const trades = await res.json();
        console.log('Received trades for', currentUsername, ':', trades);

        // Update badge
        updateReceivedBadge(trades.length);

        if (!trades || trades.length === 0) {
            container.innerHTML = `
                <div class="empty-msg">
                    <div style="font-size: 3rem; margin-bottom: 16px;">📭</div>
                    <p>Aucune proposition d'échange reçue</p>
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

            return `
                <div class="received-trade-card">
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

        const completedTrades = await res.json();

        if (!completedTrades || completedTrades.length === 0) {
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

function updateReceivedBadge(count) {
    const badge = document.getElementById('receivedTradeBadge');
    if (badge) {
        if (count === undefined) {
            // Fetch count
            fetch(`${BASE_URL}/trades/pending/${currentUsername}`, { cache: 'no-store' })
                .then(res => res.json())
                .then(trades => {
                    const tradeCount = trades.length;
                    badge.textContent = tradeCount;
                    badge.style.display = tradeCount > 0 ? 'inline-block' : 'none';
                })
                .catch(err => console.error('Error fetching received badge count:', err));
        } else {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'inline-block' : 'none';
        }
    }
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
