// Pool Selector - Common script for all pages
// Note: BASE_URL is expected to be defined by the page-specific script

// Load active pool selector on page load
$(document).ready(function() {
    const username = localStorage.getItem("username");
    if (username) {
        loadActivePoolSelector();
    }
});

// Load pools for the selector
async function loadActivePoolSelector() {
    try {
        const response = await fetch(`${BASE_URL}/draft?timestamp=${new Date().getTime()}`, { cache: "no-store" });
        const draftData = await response.json();
        const username = localStorage.getItem("username");

        const selector = $("#activePoolSelector");
        selector.html('<option value="">-- Aucun pool --</option>');

        // Find pools where user is a member
        Object.keys(draftData).forEach(draftName => {
            const draft = draftData[draftName];
            const userTeam = Object.entries(draft.teams || {}).find(([teamName, teamData]) =>
                teamData.members && teamData.members.includes(username)
            );

            if (userTeam) {
                selector.append(`<option value="${draftName}">${draftName}</option>`);
            }
        });

        // Load previously selected pool
        const activePool = localStorage.getItem("activePool");
        if (activePool) {
            selector.val(activePool);
        }

        // Listen for changes
        selector.on('change', function() {
            const selectedPool = $(this).val();
            if (selectedPool) {
                localStorage.setItem("activePool", selectedPool);
            } else {
                localStorage.removeItem("activePool");
            }

            // Update trade link visibility
            updateTradeLinkVisibility(selectedPool, draftData);

            // Trigger event for other scripts to listen to
            $(document).trigger('activePoolChanged', [selectedPool]);
        });

        // Initial check for trade link visibility
        if (activePool && draftData[activePool]) {
            updateTradeLinkVisibility(activePool, draftData);
        } else {
            updateTradeLinkVisibility(null, draftData);
        }

    } catch (error) {
        console.error("Error loading active pool selector:", error);
    }
}

// Get current active pool
function getActivePool() {
    return localStorage.getItem("activePool");
}

// Update trade link visibility based on pool settings
function updateTradeLinkVisibility(poolName, draftData) {
    const tradeLink = $("#trade-link");

    // If no trade link element exists on this page, skip
    if (tradeLink.length === 0) {
        return;
    }

    // If no pool is selected, hide trade link
    if (!poolName || !draftData || !draftData[poolName]) {
        tradeLink.hide();
        return;
    }

    const pool = draftData[poolName];

    // Check allowTrades setting (default to true for backward compatibility)
    const allowTrades = pool.allowTrades !== false;

    if (allowTrades) {
        tradeLink.show();
    } else {
        tradeLink.hide();
    }
}
