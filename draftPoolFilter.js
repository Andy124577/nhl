/**
 * Filet de sécurité : retire du bassin de repêchage les joueurs retraités
 * ou inactifs, au cas où le fichier nhl_filtered_stats.json en réintroduise
 * (il est régénéré périodiquement à partir d'une liste d'identifiants, et le
 * serveur ne fait que *mettre à jour* les lignes existantes — il n'en enlève
 * jamais).
 *
 * La vraie correction est en amont : `prune_retired_players.js` nettoie le
 * fichier, et `fetchCurrentStatsForPlayer` (server.js) n'accepte plus les
 * stats d'une saison passée. Ceci ne fait que garantir que, quoi qu'il
 * arrive au fichier, ces identifiants n'apparaissent pas dans la liste.
 *
 * Filtre par playerId : aucune collision de noms possible. Garder cette
 * liste alignée avec REMOVE_IDS dans prune_retired_players.js.
 */
(function () {
  "use strict";

  var BANNED_IDS = new Set([
    8469770, // Dennis Wideman — retraité 2017
    8470324, // Josh Gorges — retraité 2018
    8470724, // Kyle Quincey — retraité 2018
    8470594, // Marc-André Fleury — retraité après 2024-25
    8470600, // Ryan Suter — sans contrat / retraité après 2024-25
    8467408  // Matt Walker (retraité) — était étiqueté « Matt Savoie » ; le vrai Savoie (8483512, C, EDM) est dans Top_100_Offensive_Players
  ]);

  function scrubArray(arr) {
    if (!Array.isArray(arr)) return 0;
    var removed = 0;
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i] && BANNED_IDS.has(arr[i].playerId)) {
        arr.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  function scrub() {
    var n = 0;
    if (typeof fullPlayerData !== "undefined") n += scrubArray(fullPlayerData);
    if (typeof goalieData !== "undefined") n += scrubArray(goalieData);
    if (typeof rookiePlayerData !== "undefined") n += scrubArray(rookiePlayerData);
    if (n) console.log("🧹 draftPoolFilter : " + n + " joueur(s) retraité(s) retiré(s) du bassin.");
    return n;
  }

  // Rejoue avant chaque rendu de table : fetchPlayerData() reconstruit les
  // tableaux à chaque appel, donc un scrub unique ne suffirait pas.
  function hook(tries) {
    if (typeof updateTable === "function") {
      var orig = updateTable;
      updateTable = function () {
        scrub();
        return orig.apply(this, arguments);
      };
      return;
    }
    if ((tries || 0) < 40) setTimeout(function () { hook((tries || 0) + 1); }, 150);
  }

  hook(0);
  document.addEventListener("DOMContentLoaded", function () {
    scrub();
    setTimeout(scrub, 800);
  });
})();
