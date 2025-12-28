$(document).ready(function () {
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    const username = localStorage.getItem("username");

    if (isLoggedIn) {
        $("#login-link").html(`<a href="#" onclick="logout()">Déconnexion (${username})</a>`);
    }

    loadActiveDrafts();
});

const BASE_URL = window.location.hostname.includes("localhost")
  ? "http://localhost:3000"
  : "https://goondraft.onrender.com";


function logout() {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("username");
    location.reload();
}

function viewFinishedDraft(clanName) {
    localStorage.setItem("draftClan", clanName);
    window.location.href = "draftFini.html";
}


async function loadActiveDrafts() {
    try {
        const username = localStorage.getItem("username");

        if (!username) {
            alert("Vous devez être connecté !");
            window.location.href = "login.html";
            return;
        }

        // First, fetch all draft data
        const allDraftsResponse = await fetch(`${BASE_URL}/draft`, { cache: "no-store" });
        const allDrafts = await allDraftsResponse.json();

        // Then, fetch only the active drafts for the user
        const response = await fetch(`${BASE_URL}/active-drafts?username=${username}&timestamp=${new Date().getTime()}`, { cache: "no-store" });
        const result = await response.json();

        if (!result.activeDrafts || result.activeDrafts.length === 0) {
            document.getElementById("draftOptions").innerHTML = "<p>Aucun draft actif pour vous.</p>";
            return;
        }

        let draftHTML = "";
        result.activeDrafts.forEach(clanName => {
            const clan = allDrafts[clanName];
            const isDraftComplete = clan && clan.draftOrder.length > 0 &&
                Object.values(clan.teams).every(team =>
                    team.members.length === 0 ||
                    (team.offensive.length >= 10 && team.defensive.length >= 5)
                );

            draftHTML += `
                <div class="draft-card">
                    <h4>${clanName}</h4>
                    <button onclick="${isDraftComplete ? `viewFinishedDraft('${clanName}')` : `joinDraft('${clanName}')`}">
                        ${isDraftComplete ? "Consulter" : "Rejoindre"}
                    </button>
                </div>
            `;
        });

        document.getElementById("draftOptions").innerHTML = draftHTML;

    } catch (error) {
        console.error("❌ Erreur lors du chargement des drafts actifs :", error);
    }
}


async function joinDraft(clanName) {
    try {
        // Vérifie si le draft a déjà un ordre
        const response = await fetch(`${BASE_URL}/draft-order/` + clanName);
        const result = await response.json();

        if (!result.draftOrder || result.draftOrder.length === 0) {
            // Si aucun ordre, on démarre le draft
            const startResponse = await fetch(`${BASE_URL}/start-draft`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clanName })
            });

            const startResult = await startResponse.json();
            console.log("✅ Draft démarré :", startResult.message);
        } else {
            console.log("✅ Ordre de draft déjà existant, pas de démarrage.");
        }

        localStorage.setItem("draftClan", clanName);
        window.location.href = "draftActif.html";
    } catch (error) {
        console.error("Erreur lors de la vérification ou du lancement du draft :", error);
        alert("Erreur lors de la préparation du draft.");
    }
}



async function startDraft(clanName) {
    try {
        const response = await fetch(`${BASE_URL}/start-draft`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clanName })
        });

        const result = await response.json();
        alert(result.message);
    } catch (error) {
        console.error("Erreur lors du démarrage du draft :", error);
        alert("Erreur serveur.");
    }
}
