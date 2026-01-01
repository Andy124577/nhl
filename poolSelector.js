// Pool Selector - Common script for all pages
const BASE_URL = window.location.hostname.includes("localhost")
    ? "http://localhost:3000"
    : "https://goondraft.onrender.com";

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

            // Trigger event for other scripts to listen to
            $(document).trigger('activePoolChanged', [selectedPool]);
        });

    } catch (error) {
        console.error("Error loading active pool selector:", error);
    }
}

// Get current active pool
function getActivePool() {
    return localStorage.getItem("activePool");
}
