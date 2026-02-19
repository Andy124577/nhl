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

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    currentUsername = localStorage.getItem('username');

    if (!currentUsername) {
        alert('⛔ Vous devez être connecté pour accéder à cette page !');
        window.location.href = 'login.html';
        return;
    }

    await loadDraftData();
    renderPoolSelector();
    loadTradeHistory();
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
function renderPoolSelector() {
    const container = document.getElementById('poolSelector');
    if (!container || !draftData) return;

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

    container.innerHTML = userPools.map(pool => `
        <div class="pool-card" onclick="selectPool('${pool.name}')">
            <div class="pool-card-header">
                <div class="pool-name">${pool.name}</div>
                <span class="pool-status active">Actif</span>
            </div>
            <div class="pool-info">
                Votre équipe: <strong>${pool.userTeam}</strong><br>
                ${pool.teamCount} équipes dans le pool
            </div>
        </div>
    `).join('');
}

function selectPool(poolName) {
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

        // Calculate team score (simplified)
        const roster = [
            ...(teamData.offensive || []),
            ...(teamData.defensive || []),
            ...(teamData.goalie || [])
        ];

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
    selectedPartnerTeam = teamName;
    partnerTeamData = selectedPoolData.teams[teamName];

    // Show step 3
    document.getElementById('step2').classList.add('hidden');
    document.getElementById('step3').classList.remove('hidden');

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
        ...(myTeamData.offensive || []).map(p => ({ ...p, category: 'F' })),
        ...(myTeamData.defensive || []).map(p => ({ ...p, category: 'D' })),
        ...(myTeamData.goalie || []).map(p => ({ ...p, category: 'G' }))
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

    container.innerHTML = filteredPlayers.map(player => {
        const name = player.skaterFullName || player.goalieFullName || 'Unknown';
        const team = player.teamAbbrevs || player.teamAbbrev || 'N/A';
        const isSelected = selectedMyPlayer && selectedMyPlayer.name === name;
        const isLocked = selectedPartnerPlayer && selectedPartnerPlayer.category !== player.category;

        return `
            <div class="player-card-roster ${isSelected ? 'selected' : ''} ${isLocked ? 'locked' : ''}"
                 onclick="selectMyPlayer('${name}', '${player.category}', ${JSON.stringify(player).replace(/"/g, '&quot;')})">
                <div class="pcr-position ${player.category.toLowerCase()}">${getCategoryLabel(player.category)}</div>
                <div class="pcr-info">
                    <div class="pcr-name">${name}</div>
                    <div class="pcr-team">${team}</div>
                    <div class="pcr-stats">
                        <span class="pcr-stat">${player.goals || 0}B</span>
                        <span class="pcr-stat">${player.assists || 0}A</span>
                        <span class="pcr-stat">${player.points || player.wins || 0}PTS</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderPartnerRoster() {
    const container = document.getElementById('partnerRoster');
    if (!container || !partnerTeamData) return;

    const players = [
        ...(partnerTeamData.offensive || []).map(p => ({ ...p, category: 'F' })),
        ...(partnerTeamData.defensive || []).map(p => ({ ...p, category: 'D' })),
        ...(partnerTeamData.goalie || []).map(p => ({ ...p, category: 'G' }))
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

    container.innerHTML = filteredPlayers.map(player => {
        const name = player.skaterFullName || player.goalieFullName || 'Unknown';
        const team = player.teamAbbrevs || player.teamAbbrev || 'N/A';
        const isSelected = selectedPartnerPlayer && selectedPartnerPlayer.name === name;
        const isLocked = selectedMyPlayer && selectedMyPlayer.category !== player.category;

        return `
            <div class="player-card-roster ${isSelected ? 'selected' : ''} ${isLocked ? 'locked' : ''}"
                 onclick="selectPartnerPlayer('${name}', '${player.category}', ${JSON.stringify(player).replace(/"/g, '&quot;')})">
                <div class="pcr-position ${player.category.toLowerCase()}">${getCategoryLabel(player.category)}</div>
                <div class="pcr-info">
                    <div class="pcr-name">${name}</div>
                    <div class="pcr-team">${team}</div>
                    <div class="pcr-stats">
                        <span class="pcr-stat">${player.goals || 0}B</span>
                        <span class="pcr-stat">${player.assists || 0}A</span>
                        <span class="pcr-stat">${player.points || player.wins || 0}PTS</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================================
// PLAYER SELECTION (1-for-1 Position-Locked)
// ============================================================
function selectMyPlayer(name, category, playerDataStr) {
    const playerData = JSON.parse(playerDataStr.replace(/&quot;/g, '"'));

    // If already selected, deselect
    if (selectedMyPlayer && selectedMyPlayer.name === name) {
        selectedMyPlayer = null;
    } else {
        selectedMyPlayer = {
            name,
            category,
            data: playerData
        };
    }

    // Re-render rosters to show locked/unlocked states
    renderMyRoster();
    renderPartnerRoster();
    updateTradeSummary();
}

function selectPartnerPlayer(name, category, playerDataStr) {
    const playerData = JSON.parse(playerDataStr.replace(/&quot;/g, '"'));

    // Validate position match
    if (selectedMyPlayer && selectedMyPlayer.category !== category) {
        // Show shake animation or error
        alert(`⚠️ Position invalide!\n\nVous devez échanger ${getCategoryLabel(selectedMyPlayer.category)} ↔ ${getCategoryLabel(selectedMyPlayer.category)}`);
        return;
    }

    // If already selected, deselect
    if (selectedPartnerPlayer && selectedPartnerPlayer.name === name) {
        selectedPartnerPlayer = null;
    } else {
        selectedPartnerPlayer = {
            name,
            category,
            data: playerData
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
        return;
    }

    emptyState.classList.add('hidden');
    activeSummary.classList.remove('hidden');

    // Validate position match
    const isValid = selectedMyPlayer.category === selectedPartnerPlayer.category;
    proposeBtn.disabled = !isValid;

    // Render my player
    const myPlayerHTML = `
        <div class="summary-player-photo">
            <img src="https://assets.nhle.com/mugs/nhl/20252026/${selectedMyPlayer.data.playerId || 0}.png"
                 onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><text y=%2250%%25%22 x=%2250%%25%22 text-anchor=%22middle%22 font-size=%2240%22>🏒</text></svg>'">
        </div>
        <div class="summary-player-name">${selectedMyPlayer.name}</div>
        <div class="summary-player-info">
            ${getCategoryLabel(selectedMyPlayer.category)} ·
            ${selectedMyPlayer.data.goals || 0}B ${selectedMyPlayer.data.assists || 0}A ${selectedMyPlayer.data.points || selectedMyPlayer.data.wins || 0}PTS
        </div>
    `;

    // Render partner player
    const partnerPlayerHTML = `
        <div class="summary-player-photo">
            <img src="https://assets.nhle.com/mugs/nhl/20252026/${selectedPartnerPlayer.data.playerId || 0}.png"
                 onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><text y=%2250%%25%22 x=%2250%%25%22 text-anchor=%22middle%22 font-size=%2240%22>🏒</text></svg>'">
        </div>
        <div class="summary-player-name">${selectedPartnerPlayer.name}</div>
        <div class="summary-player-info">
            ${getCategoryLabel(selectedPartnerPlayer.category)} ·
            ${selectedPartnerPlayer.data.goals || 0}B ${selectedPartnerPlayer.data.assists || 0}A ${selectedPartnerPlayer.data.points || selectedPartnerPlayer.data.wins || 0}PTS
        </div>
    `;

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

    const my = selectedMyPlayer.data;
    const partner = selectedPartnerPlayer.data;

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
                <span class="my-val">${my.points || my.wins || 0}</span>
                <span class="partner-val">${partner.points || partner.wins || 0}</span>
            </div>
        </div>
    `;
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
// PROPOSE TRADE
// ============================================================
async function proposeTrade() {
    if (!selectedMyPlayer || !selectedPartnerPlayer) {
        alert('Veuillez sélectionner 1 joueur de chaque côté');
        return;
    }

    if (selectedMyPlayer.category !== selectedPartnerPlayer.category) {
        alert('⚠️ Les joueurs doivent être de la même position!');
        return;
    }

    if (!confirm(`Proposer cet échange?\n\n${myTeamName} offre: ${selectedMyPlayer.name}\n${selectedPartnerTeam} reçoit: ${selectedPartnerPlayer.name}`)) {
        return;
    }

    const proposal = {
        draftName: selectedPool,
        fromTeam: myTeamName,
        toTeam: selectedPartnerTeam,
        offering: [{
            name: selectedMyPlayer.name,
            type: getCategoryType(selectedMyPlayer.category)
        }],
        receiving: [{
            name: selectedPartnerPlayer.name,
            type: getCategoryType(selectedPartnerPlayer.category)
        }],
        status: 'pending',
        date: new Date().toISOString()
    };

    try {
        const res = await fetch(`${BASE_URL}/trade/propose`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(proposal)
        });

        const data = await res.json();

        if (res.ok) {
            alert('✅ Proposition d\'échange envoyée!');
            resetTrade();
        } else {
            alert(`❌ Erreur: ${data.message}`);
        }
    } catch (err) {
        console.error('Error proposing trade:', err);
        alert('Erreur lors de l\'envoi de la proposition');
    }
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
    document.getElementById('step1').classList.remove('hidden');
    document.getElementById('step2').classList.add('hidden');
    document.getElementById('step3').classList.add('hidden');

    renderPoolSelector();
}

// ============================================================
// TRADE HISTORY
// ============================================================
let currentHistoryTab = 'pending';

function switchHistoryTab(tab) {
    currentHistoryTab = tab;

    // Update active tab
    document.querySelectorAll('.history-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });

    loadTradeHistory();
}

async function loadTradeHistory() {
    const container = document.getElementById('historyContent');
    if (!container) return;

    try {
        let trades = [];

        if (currentHistoryTab === 'pending') {
            const res = await fetch(`${BASE_URL}/trades/pending/${currentUsername}`, { cache: 'no-store' });
            trades = await res.json();
            updatePendingBadge(trades.length);
        } else {
            // Load all trades and filter completed
            if (selectedPool) {
                const res = await fetch(`${BASE_URL}/trades/${selectedPool}`, { cache: 'no-store' });
                const allTrades = await res.json();
                trades = allTrades.filter(t => t.status === 'completed');
            }
        }

        if (!trades || trades.length === 0) {
            container.innerHTML = `<p class="empty-msg">Aucun échange ${currentHistoryTab === 'pending' ? 'en attente' : 'complété'}</p>`;
            return;
        }

        container.innerHTML = trades.map(trade => {
            const date = new Date(trade.date);
            const day = date.getDate();
            const month = date.toLocaleDateString('fr-CA', { month: 'short' });

            const isPending = trade.status === 'pending';
            const isForMe = trade.toTeam === myTeamName;

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
                                ${trade.offering[0]?.name} → ${trade.receiving[0]?.name}
                            </div>
                        </div>
                    </div>
                    ${isPending && isForMe ? `
                        <div class="history-actions">
                            <button class="btn-decline" onclick="declineTradeProposal('${trade.id}')">Refuser</button>
                            <button class="btn-accept" onclick="acceptTradeProposal('${trade.id}')">Accepter</button>
                        </div>
                    ` : `
                        <div class="history-status ${trade.status}">${getStatusLabel(trade.status)}</div>
                    `}
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error('Error loading trade history:', err);
        container.innerHTML = '<p class="empty-msg">Erreur lors du chargement</p>';
    }
}

async function acceptTradeProposal(tradeId) {
    if (!confirm('Accepter cet échange?')) return;

    try {
        const res = await fetch(`${BASE_URL}/trade/accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tradeId })
        });

        if (res.ok) {
            alert('✅ Échange accepté!');
            loadTradeHistory();
        } else {
            const data = await res.json();
            alert(`❌ Erreur: ${data.message}`);
        }
    } catch (err) {
        console.error('Error accepting trade:', err);
        alert('Erreur lors de l\'acceptation');
    }
}

async function declineTradeProposal(tradeId) {
    if (!confirm('Refuser cet échange?')) return;

    try {
        const res = await fetch(`${BASE_URL}/trade/decline`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tradeId })
        });

        if (res.ok) {
            alert('Échange refusé');
            loadTradeHistory();
        } else {
            const data = await res.json();
            alert(`❌ Erreur: ${data.message}`);
        }
    } catch (err) {
        console.error('Error declining trade:', err);
        alert('Erreur lors du refus');
    }
}

function updatePendingBadge(count) {
    const badge = document.getElementById('pendingCount');
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
}

// ============================================================
// UTILITIES
// ============================================================
function getCategoryLabel(category) {
    const labels = {
        'F': 'ATT',
        'D': 'DÉF',
        'G': 'GAR'
    };
    return labels[category] || category;
}

function getCategoryType(category) {
    const types = {
        'F': 'offensive',
        'D': 'defensive',
        'G': 'goalie'
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
