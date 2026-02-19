/* ============================================================ */
/* TRADE PAGE — Complete drag-drop trade interface             */
/* ============================================================ */

const BASE_URL = window.location.hostname.includes('localhost')
    ? 'http://localhost:3000'
    : window.location.origin;

// State
let currentUsername = null;
let currentDraft = null;
let currentTeamName = null;
let partnerTeamName = null;
let draftData = null;
let statsData = null;
let offeringPlayers = []; // Players I'm offering
let receivingPlayers = []; // Players I'm receiving

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

    // Setup tab navigation
    setupTabNavigation();

    // Setup reset and send buttons
    document.getElementById('resetBtn')?.addEventListener('click', resetTrade);
    document.getElementById('sendTradeBtn')?.addEventListener('click', sendTradeProposal);

    // Setup partner selector
    document.getElementById('partnerSelect')?.addEventListener('change', onPartnerSelect);

    // Load data
    await Promise.all([loadDraftData(), loadStats()]);

    // Load initial state
    loadPendingTrades();
    loadTradeHistory();

    // Setup WebSocket for live updates
    setupWebSocket();
});

// ============================================================
// TAB NAVIGATION
// ============================================================
function setupTabNavigation() {
    const tabs = document.querySelectorAll('.trade-tab');
    const panels = document.querySelectorAll('.tab-panel');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;

            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update active panel
            panels.forEach(p => p.classList.remove('active'));
            document.getElementById(`${targetTab}Tab`)?.classList.add('active');

            // Load data for tab
            if (targetTab === 'proposals') {
                loadPendingTrades();
            } else if (targetTab === 'history') {
                loadTradeHistory();
            }
        });
    });
}

// ============================================================
// DATA LOADING
// ============================================================
async function loadDraftData() {
    try {
        const res = await fetch(`${BASE_URL}/draft?timestamp=${Date.now()}`, { cache: 'no-store' });
        draftData = await res.json();

        // Find current user's pool and team
        const activePool = getActivePool();
        if (!activePool) return;

        currentDraft = activePool;
        const pool = draftData[activePool];
        if (!pool) return;

        // Find user's team
        const userTeamEntry = Object.entries(pool.teams || {}).find(
            ([, td]) => td.members && td.members.includes(currentUsername)
        );

        if (userTeamEntry) {
            currentTeamName = userTeamEntry[0];
            populatePartnerSelect();
        }

    } catch (err) {
        console.error('Error loading draft data:', err);
    }
}

async function loadStats() {
    try {
        const res = await fetch(`${BASE_URL}/stats`);
        statsData = await res.json();
    } catch (err) {
        console.error('Error loading stats:', err);
    }
}

function getActivePool() {
    // Try to get from navbar or localStorage
    return localStorage.getItem('activePool') || null;
}

// ============================================================
// PARTNER SELECTION
// ============================================================
function populatePartnerSelect() {
    const select = document.getElementById('partnerSelect');
    if (!select || !draftData || !currentDraft) return;

    const pool = draftData[currentDraft];
    select.innerHTML = '<option value="">-- Choisir une équipe --</option>';

    Object.entries(pool.teams || {}).forEach(([teamName, teamData]) => {
        if (teamName !== currentTeamName && teamData.members && teamData.members.length > 0) {
            select.innerHTML += `<option value="${teamName}">${teamName}</option>`;
        }
    });
}

function onPartnerSelect(e) {
    partnerTeamName = e.target.value;

    if (!partnerTeamName) {
        document.getElementById('tradeGrid').style.display = 'none';
        document.getElementById('tradeActionsHeader').style.display = 'none';
        return;
    }

    // Show trade interface
    document.getElementById('tradeGrid').style.display = 'grid';
    document.getElementById('tradeActionsHeader').style.display = 'flex';

    // Reset trade state
    offeringPlayers = [];
    receivingPlayers = [];

    // Load rosters
    loadMyRoster();
    loadPartnerRoster();

    // Update badges
    document.getElementById('myTeamBadge').textContent = currentTeamName;
    document.getElementById('partnerTeamBadge').textContent = partnerTeamName;

    updateUI();
}

// ============================================================
// ROSTER LOADING
// ============================================================
function loadMyRoster() {
    const container = document.getElementById('myRoster');
    if (!container || !currentDraft || !currentTeamName) return;

    const team = draftData[currentDraft].teams[currentTeamName];
    container.innerHTML = '';

    const players = [
        ...(team.offensive || []).map(p => ({ ...p, position: 'ATT' })),
        ...(team.defensive || []).map(p => ({ ...p, position: 'DEF' })),
        ...(team.goalie || []).map(p => ({ ...p, position: 'G' }))
    ];

    if (players.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:24px 12px;">Aucun joueur</p>';
        return;
    }

    players.forEach(player => {
        const card = createPlayerCard(player, 'my');
        container.appendChild(card);
    });

    updateTeamCount('myTeamCount', players.length);
}

function loadPartnerRoster() {
    const container = document.getElementById('partnerRoster');
    if (!container || !currentDraft || !partnerTeamName) return;

    const team = draftData[currentDraft].teams[partnerTeamName];
    container.innerHTML = '';

    const players = [
        ...(team.offensive || []).map(p => ({ ...p, position: 'ATT' })),
        ...(team.defensive || []).map(p => ({ ...p, position: 'DEF' })),
        ...(team.goalie || []).map(p => ({ ...p, position: 'G' }))
    ];

    if (players.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:24px 12px;">Aucun joueur</p>';
        return;
    }

    players.forEach(player => {
        const card = createPlayerCard(player, 'partner');
        container.appendChild(card);
    });

    updateTeamCount('partnerTeamCount', players.length);
}

function updateTeamCount(elementId, count) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = `${count} joueur${count !== 1 ? 's' : ''}`;
    }
}

// ============================================================
// PLAYER CARD CREATION
// ============================================================
function createPlayerCard(player, side) {
    const name = player.skaterFullName || player.goalieFullName || 'Unknown';
    const position = player.position || 'N/A';
    const stats = getPlayerStats(name);
    const points = stats.points || 0;

    const card = document.createElement('div');
    card.className = 'player-card-trade';
    card.draggable = true;
    card.dataset.playerName = name;
    card.dataset.side = side;
    card.dataset.position = position;
    card.dataset.points = points;

    card.innerHTML = `
        <div class="pct-position ${position.toLowerCase()}">${position}</div>
        <div class="pct-info">
            <div class="pct-name">${name}</div>
            <div class="pct-stats">
                ${stats.goals || 0}B · ${stats.assists || 0}A · ${stats.points || 0}PTS
            </div>
        </div>
        <div class="pct-value">${points} <span style="opacity:.6;font-size:.7em">PTS</span></div>
    `;

    // Drag events
    card.addEventListener('dragstart', (e) => onDragStart(e, player, side));
    card.addEventListener('dragend', (e) => onDragEnd(e));

    return card;
}

function getPlayerStats(playerName) {
    if (!statsData) return { goals: 0, assists: 0, points: 0 };

    const allPlayers = [
        ...(statsData.Top_Offensive || []),
        ...(statsData.Top_Defensive || []),
        ...(statsData.Top_Rookies || []),
        ...(statsData.Top_Goalies || [])
    ];

    const found = allPlayers.find(p => {
        const name = p.skaterFullName || p.goalieFullName ||
                     `${p.firstName || ''} ${p.lastName || ''}`.trim();
        return name === playerName;
    });

    if (found) {
        return {
            goals: found.goals || 0,
            assists: found.assists || 0,
            points: found.points || found.wins || 0
        };
    }

    return { goals: 0, assists: 0, points: 0 };
}

// ============================================================
// DRAG AND DROP
// ============================================================
function onDragStart(e, player, side) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({
        player,
        side,
        name: player.skaterFullName || player.goalieFullName || 'Unknown',
        position: player.position || 'N/A'
    }));

    e.currentTarget.classList.add('dragging');
}

function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
}

// Setup drop zones
document.addEventListener('DOMContentLoaded', () => {
    const offeringZone = document.getElementById('offeringDropZone');
    const receivingZone = document.getElementById('receivingDropZone');

    [offeringZone, receivingZone].forEach(zone => {
        if (!zone) return;

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', (e) => {
            if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget)) {
                zone.classList.remove('drag-over');
            }
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');

            const data = JSON.parse(e.dataTransfer.getData('application/json'));
            const targetSide = zone.dataset.side;

            // Validate drop: my players → offering, partner players → receiving
            if ((data.side === 'my' && targetSide === 'offering') ||
                (data.side === 'partner' && targetSide === 'receiving')) {
                addPlayerToDropZone(data, targetSide);
            }
        });
    });
});

function addPlayerToDropZone(data, side) {
    const player = {
        name: data.name,
        position: data.position,
        player: data.player
    };

    // Check if already added
    const list = side === 'offering' ? offeringPlayers : receivingPlayers;
    if (list.find(p => p.name === player.name)) return;

    // Add to list
    if (side === 'offering') {
        offeringPlayers.push(player);
    } else {
        receivingPlayers.push(player);
    }

    // Mark original card as in-trade
    const originalCard = document.querySelector(
        `.player-card-trade[data-player-name="${player.name}"][data-side="${data.side}"]`
    );
    if (originalCard) {
        originalCard.classList.add('in-trade');
    }

    updateUI();
}

function removePlayerFromDropZone(playerName, side) {
    if (side === 'offering') {
        offeringPlayers = offeringPlayers.filter(p => p.name !== playerName);
    } else {
        receivingPlayers = receivingPlayers.filter(p => p.name !== playerName);
    }

    // Unmark original card
    const originalCard = document.querySelector(
        `.player-card-trade[data-player-name="${playerName}"].in-trade`
    );
    if (originalCard) {
        originalCard.classList.remove('in-trade');
    }

    updateUI();
}

// ============================================================
// UI UPDATE
// ============================================================
function updateUI() {
    updateDropZone('offering', offeringPlayers);
    updateDropZone('receiving', receivingPlayers);
    updateValueBars();
    updateTradeBalance();
    updateStatComparison();
    updateSendButton();
}

function updateDropZone(side, players) {
    const zone = document.getElementById(side === 'offering' ? 'offeringDropZone' : 'receivingDropZone');
    const countEl = document.getElementById(side === 'offering' ? 'offeringCount' : 'receivingCount');

    if (!zone) return;

    // Update count
    if (countEl) countEl.textContent = players.length;

    // Clear existing chips
    zone.querySelectorAll('.dropped-player-chip').forEach(chip => chip.remove());

    // Show/hide placeholder
    const placeholder = zone.querySelector('.dz-placeholder');
    if (placeholder) {
        placeholder.style.display = players.length === 0 ? 'flex' : 'none';
    }

    // Add player chips
    players.forEach(player => {
        const chip = document.createElement('div');
        chip.className = 'dropped-player-chip';
        chip.innerHTML = `
            <span class="dpc-position ${player.position.toLowerCase()}">${player.position}</span>
            <span class="dpc-name">${player.name}</span>
            <button class="dpc-remove" onclick="removePlayerFromDropZone('${player.name}', '${side}')">×</button>
        `;
        zone.appendChild(chip);
    });
}

function updateValueBars() {
    const offeringValue = offeringPlayers.reduce((sum, p) => {
        const stats = getPlayerStats(p.name);
        return sum + (stats.points || 0);
    }, 0);

    const receivingValue = receivingPlayers.reduce((sum, p) => {
        const stats = getPlayerStats(p.name);
        return sum + (stats.points || 0);
    }, 0);

    const offeringEl = document.getElementById('offeringValue');
    const receivingEl = document.getElementById('receivingValue');

    if (offeringEl) offeringEl.textContent = `${offeringValue} PTS`;
    if (receivingEl) receivingEl.textContent = `${receivingValue} PTS`;
}

function updateTradeBalance() {
    const balance = document.getElementById('tradeBalance');
    if (!balance) return;

    const offeringValue = offeringPlayers.reduce((sum, p) => {
        const stats = getPlayerStats(p.name);
        return sum + (stats.points || 0);
    }, 0);

    const receivingValue = receivingPlayers.reduce((sum, p) => {
        const stats = getPlayerStats(p.name);
        return sum + (stats.points || 0);
    }, 0);

    const diff = Math.abs(offeringValue - receivingValue);
    const diffPercent = offeringValue > 0 ? (diff / offeringValue) * 100 : 0;

    const statusEl = balance.querySelector('.balance-status');
    if (!statusEl) return;

    if (diffPercent < 15) {
        balance.classList.remove('unbalanced');
        balance.classList.add('balanced');
        statusEl.textContent = 'Équilibré';
    } else {
        balance.classList.remove('balanced');
        balance.classList.add('unbalanced');
        statusEl.textContent = `Déséquilibré (${diff} PTS)`;
    }
}

function updateStatComparison() {
    const statComp = document.getElementById('statComparison');
    if (!statComp) return;

    if (offeringPlayers.length === 0 && receivingPlayers.length === 0) {
        statComp.style.display = 'none';
        return;
    }

    statComp.style.display = 'block';

    // Calculate totals
    const offeringStats = offeringPlayers.reduce((acc, p) => {
        const stats = getPlayerStats(p.name);
        return {
            goals: acc.goals + (stats.goals || 0),
            assists: acc.assists + (stats.assists || 0),
            points: acc.points + (stats.points || 0)
        };
    }, { goals: 0, assists: 0, points: 0 });

    const receivingStats = receivingPlayers.reduce((acc, p) => {
        const stats = getPlayerStats(p.name);
        return {
            goals: acc.goals + (stats.goals || 0),
            assists: acc.assists + (stats.assists || 0),
            points: acc.points + (stats.points || 0)
        };
    }, { goals: 0, assists: 0, points: 0 });

    // Update bars
    updateStatBar('goals', offeringStats.goals, receivingStats.goals);
    updateStatBar('assists', offeringStats.assists, receivingStats.assists);
    updateStatBar('pts', offeringStats.points, receivingStats.points);
}

function updateStatBar(stat, offerVal, receiveVal) {
    const total = offerVal + receiveVal;
    const offerPercent = total > 0 ? (offerVal / total) * 50 : 0; // Max 50% each side
    const receivePercent = total > 0 ? (receiveVal / total) * 50 : 0;

    const offerBar = document.getElementById(`${stat}OfferBar`);
    const receiveBar = document.getElementById(`${stat}ReceiveBar`);
    const offerValEl = document.getElementById(`${stat}OfferVal`);
    const receiveValEl = document.getElementById(`${stat}ReceiveVal`);

    if (offerBar) offerBar.style.width = `${offerPercent}%`;
    if (receiveBar) receiveBar.style.width = `${receivePercent}%`;
    if (offerValEl) offerValEl.textContent = offerVal;
    if (receiveValEl) receiveValEl.textContent = receiveVal;
}

function updateSendButton() {
    const btn = document.getElementById('sendTradeBtn');
    if (!btn) return;

    const isValid = offeringPlayers.length > 0 && receivingPlayers.length > 0;
    btn.disabled = !isValid;
}

// ============================================================
// TRADE ACTIONS
// ============================================================
function resetTrade() {
    offeringPlayers = [];
    receivingPlayers = [];

    // Remove in-trade class from all cards
    document.querySelectorAll('.player-card-trade.in-trade').forEach(card => {
        card.classList.remove('in-trade');
    });

    updateUI();
}

async function sendTradeProposal() {
    if (offeringPlayers.length === 0 || receivingPlayers.length === 0) {
        alert('Veuillez ajouter des joueurs à l\'échange');
        return;
    }

    if (!confirm(`Envoyer cette proposition d'échange à ${partnerTeamName}?`)) {
        return;
    }

    const proposal = {
        draftName: currentDraft,
        fromTeam: currentTeamName,
        toTeam: partnerTeamName,
        offering: offeringPlayers.map(p => ({
            name: p.name,
            type: getTypeFromPosition(p.position)
        })),
        receiving: receivingPlayers.map(p => ({
            name: p.name,
            type: getTypeFromPosition(p.position)
        })),
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
            document.getElementById('partnerSelect').value = '';
            document.getElementById('tradeGrid').style.display = 'none';
            document.getElementById('tradeActionsHeader').style.display = 'none';
        } else {
            alert(`❌ Erreur: ${data.message}`);
        }
    } catch (err) {
        console.error('Error sending trade:', err);
        alert('Erreur lors de l\'envoi de la proposition');
    }
}

function getTypeFromPosition(position) {
    const map = {
        'ATT': 'offensive',
        'DEF': 'defensive',
        'G': 'goalie'
    };
    return map[position] || 'offensive';
}

// ============================================================
// PENDING TRADES
// ============================================================
async function loadPendingTrades() {
    const container = document.getElementById('proposalsList');
    if (!container) return;

    try {
        const res = await fetch(`${BASE_URL}/trades/pending/${currentUsername}`, {
            cache: 'no-store'
        });
        const proposals = await res.json();

        if (!proposals || proposals.length === 0) {
            container.innerHTML = '<p class="empty-msg">Aucune proposition en attente</p>';
            updateProposalBadge(0);
            return;
        }

        container.innerHTML = '';
        proposals.forEach(proposal => {
            const card = createProposalCard(proposal);
            container.appendChild(card);
        });

        updateProposalBadge(proposals.length);

    } catch (err) {
        console.error('Error loading pending trades:', err);
        container.innerHTML = '<p class="empty-msg">Erreur lors du chargement</p>';
    }
}

function createProposalCard(proposal) {
    const card = document.createElement('div');
    card.className = 'proposal-card';

    const date = new Date(proposal.date);
    const dateStr = date.toLocaleDateString('fr-CA', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    card.innerHTML = `
        <div class="prop-header">
            <div class="prop-teams">
                <span class="prop-from">${proposal.fromTeam}</span>
                <span class="prop-arrow">→</span>
                <span class="prop-to">Vous (${proposal.toTeam})</span>
            </div>
            <div class="prop-date">${dateStr}</div>
        </div>
        <div class="prop-body">
            <div class="prop-side">
                <div class="prop-side-title">Ils offrent</div>
                <div class="prop-players">
                    ${proposal.offering.map(p => `
                        <div class="prop-player">
                            <span class="pp-position">${getPositionFromType(p.type)}</span>
                            <span class="pp-name">${p.name}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="prop-exchange">⇄</div>
            <div class="prop-side">
                <div class="prop-side-title">Vous envoyez</div>
                <div class="prop-players">
                    ${proposal.receiving.map(p => `
                        <div class="prop-player">
                            <span class="pp-position">${getPositionFromType(p.type)}</span>
                            <span class="pp-name">${p.name}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        <div class="prop-actions">
            <button class="prop-decline" onclick="declineProposal('${proposal.id}')">❌ Refuser</button>
            <button class="prop-accept" onclick="acceptProposal('${proposal.id}')">✅ Accepter</button>
        </div>
    `;

    return card;
}

async function acceptProposal(proposalId) {
    if (!confirm('Accepter cet échange?')) return;

    try {
        const res = await fetch(`${BASE_URL}/trade/accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tradeId: proposalId })
        });

        const data = await res.json();

        if (res.ok) {
            alert('✅ Échange accepté!');
            loadPendingTrades();
            loadTradeHistory();
        } else {
            alert(`❌ Erreur: ${data.message}`);
        }
    } catch (err) {
        console.error('Error accepting trade:', err);
        alert('Erreur lors de l\'acceptation');
    }
}

async function declineProposal(proposalId) {
    if (!confirm('Refuser cet échange?')) return;

    try {
        const res = await fetch(`${BASE_URL}/trade/decline`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tradeId: proposalId })
        });

        const data = await res.json();

        if (res.ok) {
            alert('Échange refusé');
            loadPendingTrades();
        } else {
            alert(`❌ Erreur: ${data.message}`);
        }
    } catch (err) {
        console.error('Error declining trade:', err);
        alert('Erreur lors du refus');
    }
}

function updateProposalBadge(count) {
    const badge = document.getElementById('proposalsBadge');
    if (!badge) return;

    if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

function getPositionFromType(type) {
    const map = {
        'offensive': 'ATT',
        'defensive': 'DEF',
        'goalie': 'G'
    };
    return map[type] || 'N/A';
}

// ============================================================
// TRADE HISTORY
// ============================================================
async function loadTradeHistory() {
    const container = document.getElementById('historyTimeline');
    if (!container || !currentDraft) return;

    try {
        const res = await fetch(`${BASE_URL}/trades/${currentDraft}`, {
            cache: 'no-store'
        });
        const trades = await res.json();

        if (!trades || trades.length === 0) {
            container.innerHTML = '<p class="empty-msg">Aucun échange complété</p>';
            return;
        }

        container.innerHTML = '';

        // Sort by date descending
        trades.sort((a, b) => new Date(b.date) - new Date(a.date));

        trades.forEach(trade => {
            const item = createHistoryItem(trade);
            container.appendChild(item);
        });

    } catch (err) {
        console.error('Error loading trade history:', err);
        container.innerHTML = '<p class="empty-msg">Erreur lors du chargement</p>';
    }
}

function createHistoryItem(trade) {
    const item = document.createElement('div');
    item.className = 'history-item';

    const date = new Date(trade.date);
    const day = date.getDate();
    const month = date.toLocaleDateString('fr-CA', { month: 'short' });

    const isUserInvolved =
        trade.fromTeam === currentTeamName ||
        trade.toTeam === currentTeamName;

    const status = trade.status || 'completed';
    const statusClass = status === 'completed' ? 'status-completed' : 'status-declined';
    const statusLabel = status === 'completed' ? 'Complété' : 'Refusé';

    item.innerHTML = `
        <div class="history-date">
            <div class="history-day">${day}</div>
            <div class="history-month">${month}</div>
        </div>
        <div class="history-content">
            <div class="history-teams">
                <span class="${trade.fromTeam === currentTeamName ? 'user-team' : ''}">${trade.fromTeam}</span>
                <span class="history-arrow">⇄</span>
                <span class="${trade.toTeam === currentTeamName ? 'user-team' : ''}">${trade.toTeam}</span>
            </div>
            <div class="history-players">
                <div class="hp-side">
                    ${trade.offering.slice(0, 3).map(p => `<span>${p.name}</span>`).join(', ')}
                    ${trade.offering.length > 3 ? ` +${trade.offering.length - 3}` : ''}
                </div>
                <div class="hp-arrow">→</div>
                <div class="hp-side">
                    ${trade.receiving.slice(0, 3).map(p => `<span>${p.name}</span>`).join(', ')}
                    ${trade.receiving.length > 3 ? ` +${trade.receiving.length - 3}` : ''}
                </div>
            </div>
        </div>
        <div class="history-status ${statusClass}">${statusLabel}</div>
    `;

    if (isUserInvolved) {
        item.classList.add('user-involved');
    }

    return item;
}

// ============================================================
// WEBSOCKET
// ============================================================
function setupWebSocket() {
    if (typeof io === 'undefined') return;

    const socket = io(BASE_URL);

    socket.on('tradeUpdated', () => {
        console.log('Trade updated, reloading...');
        loadPendingTrades();
        loadTradeHistory();
    });

    socket.on('tradePending', () => {
        console.log('New pending trade');
        loadPendingTrades();
    });
}
