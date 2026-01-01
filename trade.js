const BASE_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://nhl-draft.onrender.com';

let currentDraft = null;
let currentUsername = null;
let currentTeamName = null;
let draftData = null;
let selectedOffering = [];
let selectedReceiving = [];

// Initialize on page load
$(document).ready(function() {
    currentUsername = localStorage.getItem("username");

    if (!currentUsername) {
        window.location.href = "login.html";
        return;
    }

    loadDrafts();
    checkPendingTrades();

    // Setup WebSocket for real-time updates
    setupWebSocket();
});

// Load available drafts
async function loadDrafts() {
    try {
        const response = await fetch(`${BASE_URL}/draft?timestamp=${new Date().getTime()}`, { cache: "no-store" });
        draftData = await response.json();

        const selector = $("#draftSelector");
        selector.html('<option value="">-- Choisir un pool --</option>');

        Object.keys(draftData).forEach(draftName => {
            const draft = draftData[draftName];
            // Check if user is in this draft
            const userTeam = Object.entries(draft.teams || {}).find(([teamName, teamData]) =>
                teamData.members && teamData.members.includes(currentUsername)
            );

            if (userTeam) {
                selector.append(`<option value="${draftName}">${draftName}</option>`);
            }
        });
    } catch (error) {
        console.error("Error loading drafts:", error);
    }
}

// Load trade history when draft is selected
async function loadTradeHistory() {
    const selectedDraft = $("#draftSelector").val();

    if (!selectedDraft) {
        $("#tradeHistoryList").html('<p class="empty-state">Sélectionnez un pool pour voir l\'historique des échanges</p>');
        $("#sendTradeBtn").prop("disabled", true);
        return;
    }

    currentDraft = selectedDraft;

    // Find user's team in this draft
    const draft = draftData[selectedDraft];
    const userTeam = Object.entries(draft.teams || {}).find(([teamName, teamData]) =>
        teamData.members && teamData.members.includes(currentUsername)
    );

    if (userTeam) {
        currentTeamName = userTeam[0];
        $("#sendTradeBtn").prop("disabled", false);
    }

    // Load completed trades
    try {
        const response = await fetch(`${BASE_URL}/trades/${selectedDraft}`, { cache: "no-store" });
        const trades = await response.json();

        displayTradeHistory(trades);
    } catch (error) {
        console.error("Error loading trade history:", error);
        $("#tradeHistoryList").html('<p class="empty-state">Aucun échange pour ce pool</p>');
    }
}

// Display trade history
function displayTradeHistory(trades) {
    const container = $("#tradeHistoryList");

    if (!trades || trades.length === 0) {
        container.html('<p class="empty-state">Aucun échange complété pour l\'instant</p>');
        return;
    }

    container.html('');
    trades.reverse().forEach(trade => {
        const tradeCard = $(`
            <div class="trade-card">
                <div class="trade-header">
                    <div class="trade-teams">${trade.fromTeam} ↔ ${trade.toTeam}</div>
                    <div class="trade-date">${new Date(trade.date).toLocaleDateString('fr-CA')}</div>
                </div>
                <div class="trade-details">
                    <div class="trade-side">
                        <h4>${trade.fromTeam} a envoyé</h4>
                        <ul class="trade-items">
                            ${trade.offering.map(item => `<li>${item.name} (${item.type})</li>`).join('')}
                        </ul>
                    </div>
                    <div class="trade-arrow">⇄</div>
                    <div class="trade-side">
                        <h4>${trade.toTeam} a envoyé</h4>
                        <ul class="trade-items">
                            ${trade.receiving.map(item => `<li>${item.name} (${item.type})</li>`).join('')}
                        </ul>
                    </div>
                </div>
            </div>
        `);
        container.append(tradeCard);
    });
}

// Open trade modal
function openTradeModal() {
    if (!currentDraft || !currentTeamName) {
        alert("Veuillez sélectionner un pool");
        return;
    }

    selectedOffering = [];
    selectedReceiving = [];

    // Load teams for selection
    loadTeamsForTrade();

    // Load user's roster
    loadUserRoster();

    $("#tradeModal").css("display", "flex");
}

// Close trade modal
function closeTradeModal() {
    $("#tradeModal").css("display", "none");
    $("#targetTeamSelect").val("");
    $("#yourOfferingGrid").html('<p class="empty-state">Vos joueurs apparaîtront ici</p>');
    $("#theirOfferingGrid").html('<p class="empty-state">Sélectionnez d\'abord une équipe</p>');
    $("#selectedOffering").html('');
    $("#selectedReceiving").html('');
    $("#validationMessage").html('');
}

// Load teams for trade selection
function loadTeamsForTrade() {
    const draft = draftData[currentDraft];
    const selector = $("#targetTeamSelect");

    selector.html('<option value="">-- Choisir une équipe --</option>');

    Object.entries(draft.teams || {}).forEach(([teamName, teamData]) => {
        if (teamName !== currentTeamName && teamData.members && teamData.members.length > 0) {
            selector.append(`<option value="${teamName}">${teamName}</option>`);
        }
    });
}

// Load user's roster
function loadUserRoster() {
    const draft = draftData[currentDraft];
    const userTeam = draft.teams[currentTeamName];

    const grid = $("#yourOfferingGrid");
    grid.html('');

    // Add offensive players
    (userTeam.offensive || []).forEach(player => {
        addPlayerToGrid(grid, player, 'offensive');
    });

    // Add defensive players
    (userTeam.defensive || []).forEach(player => {
        addPlayerToGrid(grid, player, 'defensive');
    });

    // Add goalies
    (userTeam.goalies || []).forEach(player => {
        addPlayerToGrid(grid, player, 'goalie');
    });

    // Add rookies
    (userTeam.rookies || []).forEach(player => {
        addPlayerToGrid(grid, player, 'rookie');
    });

    // Add teams
    (userTeam.teams || []).forEach(team => {
        addPlayerToGrid(grid, team, 'team');
    });

    if (grid.children().length === 0) {
        grid.html('<p class="empty-state">Vous n\'avez pas encore de joueurs</p>');
    }
}

// Load target team roster
function loadTeamRoster() {
    const targetTeam = $("#targetTeamSelect").val();

    if (!targetTeam) {
        $("#theirOfferingGrid").html('<p class="empty-state">Sélectionnez d\'abord une équipe</p>');
        return;
    }

    const draft = draftData[currentDraft];
    const team = draft.teams[targetTeam];

    const grid = $("#theirOfferingGrid");
    grid.html('');

    // Add offensive players
    (team.offensive || []).forEach(player => {
        addPlayerToGrid(grid, player, 'offensive', 'receiving');
    });

    // Add defensive players
    (team.defensive || []).forEach(player => {
        addPlayerToGrid(grid, player, 'defensive', 'receiving');
    });

    // Add goalies
    (team.goalies || []).forEach(player => {
        addPlayerToGrid(grid, player, 'goalie', 'receiving');
    });

    // Add rookies
    (team.rookies || []).forEach(player => {
        addPlayerToGrid(grid, player, 'rookie', 'receiving');
    });

    // Add teams
    (team.teams || []).forEach(teamItem => {
        addPlayerToGrid(grid, teamItem, 'team', 'receiving');
    });

    if (grid.children().length === 0) {
        grid.html('<p class="empty-state">Cette équipe n\'a pas encore de joueurs</p>');
    }
}

// Add player to selection grid
function addPlayerToGrid(grid, playerData, type, side = 'offering') {
    const playerName = playerData.skaterFullName || playerData.goalieFullName || playerData.teamFullName || playerData;
    const position = getPositionLabel(type);

    const playerItem = $(`
        <div class="player-item" data-name="${playerName}" data-type="${type}" data-side="${side}">
            <div class="player-name">${playerName}</div>
            <div class="player-position">${position}</div>
        </div>
    `);

    playerItem.click(function() {
        togglePlayerSelection($(this), playerName, type, side);
    });

    grid.append(playerItem);
}

// Toggle player selection
function togglePlayerSelection(element, playerName, type, side) {
    const isSelected = element.hasClass('selected');

    if (isSelected) {
        element.removeClass('selected');
        if (side === 'offering') {
            selectedOffering = selectedOffering.filter(p => p.name !== playerName);
        } else {
            selectedReceiving = selectedReceiving.filter(p => p.name !== playerName);
        }
    } else {
        element.addClass('selected');
        if (side === 'offering') {
            selectedOffering.push({ name: playerName, type: type });
        } else {
            selectedReceiving.push({ name: playerName, type: type });
        }
    }

    updateSelectedDisplay();
    validateTrade();
}

// Update selected items display
function updateSelectedDisplay() {
    // Update offering display
    const offeringContainer = $("#selectedOffering");
    offeringContainer.html('');
    selectedOffering.forEach(item => {
        offeringContainer.append(`<span class="selected-item-badge">${item.name}</span>`);
    });

    // Update receiving display
    const receivingContainer = $("#selectedReceiving");
    receivingContainer.html('');
    selectedReceiving.forEach(item => {
        receivingContainer.append(`<span class="selected-item-badge">${item.name}</span>`);
    });
}

// Validate trade
function validateTrade() {
    const msgContainer = $("#validationMessage");
    msgContainer.removeClass('error success').html('');

    if (selectedOffering.length === 0 || selectedReceiving.length === 0) {
        $("#sendTradeProposalBtn").prop("disabled", true);
        return;
    }

    // Count positions for offering
    const offeringCounts = countPositions(selectedOffering);
    const receivingCounts = countPositions(selectedReceiving);

    // Validate position balance
    const errors = [];

    if (offeringCounts.offensive !== receivingCounts.offensive) {
        errors.push(`Attaquants: ${offeringCounts.offensive} offerts ≠ ${receivingCounts.offensive} reçus`);
    }
    if (offeringCounts.defensive !== receivingCounts.defensive) {
        errors.push(`Défenseurs: ${offeringCounts.defensive} offerts ≠ ${receivingCounts.defensive} reçus`);
    }
    if (offeringCounts.goalie !== receivingCounts.goalie) {
        errors.push(`Gardiens: ${offeringCounts.goalie} offerts ≠ ${receivingCounts.goalie} reçus`);
    }
    if (offeringCounts.rookie !== receivingCounts.rookie) {
        errors.push(`Rookies: ${offeringCounts.rookie} offerts ≠ ${receivingCounts.rookie} reçus`);
    }
    if (offeringCounts.team !== receivingCounts.team) {
        errors.push(`Équipes NHL: ${offeringCounts.team} offertes ≠ ${receivingCounts.team} reçues`);
    }

    if (errors.length > 0) {
        msgContainer.addClass('error').html(`
            <strong>⚠️ Échange invalide:</strong><br>
            ${errors.join('<br>')}
            <br><br>
            <em>Vous devez échanger le même nombre de joueurs par position.</em>
        `);
        $("#sendTradeProposalBtn").prop("disabled", true);
    } else {
        msgContainer.addClass('success').html('✅ Échange valide! Vous pouvez envoyer la proposition.');
        $("#sendTradeProposalBtn").prop("disabled", false);
    }
}

// Count positions in selection
function countPositions(selection) {
    return {
        offensive: selection.filter(p => p.type === 'offensive').length,
        defensive: selection.filter(p => p.type === 'defensive').length,
        goalie: selection.filter(p => p.type === 'goalie').length,
        rookie: selection.filter(p => p.type === 'rookie').length,
        team: selection.filter(p => p.type === 'team').length
    };
}

// Get position label
function getPositionLabel(type) {
    const labels = {
        offensive: 'Attaquant',
        defensive: 'Défenseur',
        goalie: 'Gardien',
        rookie: 'Rookie',
        team: 'Équipe NHL'
    };
    return labels[type] || type;
}

// Send trade proposal
async function sendTradeProposal() {
    const targetTeam = $("#targetTeamSelect").val();

    if (!targetTeam || selectedOffering.length === 0 || selectedReceiving.length === 0) {
        alert("Veuillez sélectionner une équipe et des joueurs à échanger");
        return;
    }

    const tradeProposal = {
        draftName: currentDraft,
        fromTeam: currentTeamName,
        toTeam: targetTeam,
        offering: selectedOffering,
        receiving: selectedReceiving,
        status: 'pending',
        date: new Date().toISOString()
    };

    try {
        const response = await fetch(`${BASE_URL}/trade/propose`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tradeProposal)
        });

        const result = await response.json();

        if (response.ok) {
            alert("✅ Proposition d'échange envoyée!");
            closeTradeModal();
            loadTradeHistory();
        } else {
            alert(`❌ Erreur: ${result.message}`);
        }
    } catch (error) {
        console.error("Error sending trade proposal:", error);
        alert("Erreur lors de l'envoi de la proposition");
    }
}

// Check for pending trades
async function checkPendingTrades() {
    try {
        const response = await fetch(`${BASE_URL}/trades/pending/${currentUsername}`, { cache: "no-store" });
        const pendingTrades = await response.json();

        const badge = $("#trade-badge");
        if (pendingTrades && pendingTrades.length > 0) {
            badge.text(pendingTrades.length).show();
        } else {
            badge.hide();
        }
    } catch (error) {
        console.error("Error checking pending trades:", error);
    }
}

// Setup WebSocket for real-time updates
function setupWebSocket() {
    const socket = io(BASE_URL);

    socket.on('tradeUpdated', () => {
        console.log("Trade updated, reloading...");
        loadTradeHistory();
        checkPendingTrades();
    });

    socket.on('tradePending', () => {
        console.log("New pending trade");
        checkPendingTrades();
    });
}

// Click outside modal to close
$(document).ready(function() {
    $("#tradeModal").click(function(event) {
        if ($(event.target).is("#tradeModal")) {
            closeTradeModal();
        }
    });
});
