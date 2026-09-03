/**
 * Popup « Fin de repêchage » (draftActif).
 *
 * Une fois que toutes les équipes ont terminé leurs sélections, on présente
 * à l'utilisateur un récapitulatif de SES joueurs repêchés : une carte par
 * choix (photo, nom, position, ronde), puis deux actions — voir son
 * classement, partager ses choix.
 *
 * L'ouverture automatique n'a lieu qu'une fois par pool (drapeau
 * localStorage), pour ne pas ré-agresser l'écran à chaque rafraîchissement.
 * `window.fzShowDraftEndPopup()` permet de le rouvrir à la demande.
 *
 * Le fichier est autonome : il ne dépend que des globales déjà exposées par
 * draftActif.js (`draftData`, `getUserTeam`, `isDraftComplete`, …) et de
 * `resolveHeadshotByName` (headshots.js). Tout est gardé par `typeof`.
 *
 * Maquette : Claude Design — « Fin de repechage.dc.html ».
 */
(function () {
  "use strict";

  /* Abréviation LNH -> ville affichée. Copie locale (le même tableau vit
   * dans draftApercuExtra.js mais n'est pas exporté). */
  var VILLES = {
    ANA: "Anaheim", ARI: "Arizona", UTA: "Utah", BOS: "Boston", BUF: "Buffalo",
    CGY: "Calgary", CAR: "Caroline", CHI: "Chicago", COL: "Colorado", CBJ: "Columbus",
    DAL: "Dallas", DET: "Detroit", EDM: "Edmonton", FLA: "Floride", LAK: "Los Angeles",
    MIN: "Minnesota", MTL: "Montréal", NSH: "Nashville", NJD: "New Jersey",
    NYI: "NY Islanders", NYR: "NY Rangers", OTT: "Ottawa", PHI: "Philadelphie",
    PIT: "Pittsburgh", SJS: "San Jose", SEA: "Seattle", STL: "St. Louis",
    TBL: "Tampa Bay", TOR: "Toronto", VAN: "Vancouver", VGK: "Vegas",
    WSH: "Washington", WPG: "Winnipeg"
  };

  var CATEGORIES = ["offensive", "defensive", "rookie", "goalie", "teams"];

  var overlay = null;       // élément racine, construit à la première ouverture
  var lastFocus = null;     // pour rendre le focus à la fermeture
  var seenAutoShow = false; // évite un double auto-affichage dans la même session

  /* ------------------------------------------------------------------ utils */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function clan() {
    if (typeof currentClan !== "undefined" && currentClan) return currentClan;
    try { return localStorage.getItem("draftClan") || ""; } catch (e) { return ""; }
  }

  function draftReady() {
    return typeof draftData !== "undefined" && draftData && draftData.teams;
  }

  function draftComplete() {
    try { return typeof isDraftComplete === "function" && isDraftComplete(); }
    catch (e) { return false; }
  }

  function myTeamName() {
    try { return typeof getUserTeam === "function" ? getUserTeam() : null; }
    catch (e) { return null; }
  }

  function firstAbbrev(raw) {
    if (!raw) return null;
    var a = String(raw).split(",")[0].trim();
    return a && a !== "null" ? a : null;
  }

  function headshot(name) {
    if (typeof resolveHeadshotByName === "function") {
      var u = resolveHeadshotByName(name);
      if (u) return u;
    }
    if (typeof getMatchingImage === "function") return getMatchingImage(name) || null;
    return null;
  }

  function teamLogo(abbrev) {
    if (!abbrev) return null;
    return "teams/" + String(abbrev).split(",").pop().trim() + ".png";
  }

  /* Position réelle du joueur -> pastille courte de la maquette. */
  function posBadge(code, category) {
    switch (code) {
      case "C": return "C";
      case "R": return "AD";
      case "L": return "AG";
      case "D": return "D";
      case "G": return "G";
    }
    if (category === "goalie") return "G";
    if (category === "defensive") return "D";
    if (category === "rookie") return "REC";
    return "ATT";
  }

  /* Le serveur stocke `position` = nom de catégorie ; on tolère aussi les
   * codes bruts au cas où d'anciens pools les auraient enregistrés. */
  function normCategory(p) {
    switch (p) {
      case "offensive": case "defensive": case "goalie": case "rookie": case "teams": return p;
      case "D": return "defensive";
      case "G": return "goalie";
      case "*": return "rookie";
      case "T": return "teams";
      default: return "offensive";
    }
  }

  function findSkater(name) {
    if (typeof fullPlayerData === "undefined" || !Array.isArray(fullPlayerData)) return null;
    return fullPlayerData.find(function (p) { return p.skaterFullName === name; }) || null;
  }
  function findGoalie(name) {
    if (typeof goalieData === "undefined" || !Array.isArray(goalieData)) return null;
    return goalieData.find(function (p) { return p.goalieFullName === name; }) || null;
  }
  function findTeam(name) {
    if (typeof teamData === "undefined" || !Array.isArray(teamData)) return null;
    return teamData.find(function (t) { return t.teamFullName === name; }) || null;
  }

  /* ------------------------------------------------------- collecte des choix */

  /* Renvoie la liste ordonnée des choix de l'utilisateur :
   * { name, category, badge, city, photo, isTeam }. L'ordre vient de
   * picksHistory ; les joueurs absents de l'historique (vieux pools) sont
   * ajoutés ensuite, catégorie par catégorie. */
  function collectPicks() {
    if (!draftReady()) return [];
    var me = myTeamName();
    var team = me && draftData.teams[me];
    if (!team) return [];

    var owned = {};             // nom -> catégorie
    CATEGORIES.forEach(function (cat) {
      var key = cat === "teams" ? "teams" : cat;
      (team[key] || []).forEach(function (n) { if (!(n in owned)) owned[n] = cat; });
    });

    var order = [];
    var placed = {};
    var histo = (draftData.picksHistory && Array.isArray(draftData.picksHistory))
      ? draftData.picksHistory : [];

    histo.forEach(function (entry) {
      if (!entry || entry.team !== me || !entry.player) return;
      if (placed[entry.player]) return;
      placed[entry.player] = true;
      order.push({ name: entry.player, category: owned[entry.player] || normCategory(entry.position) });
    });

    // Reliquat : présents dans l'alignement mais pas dans l'historique.
    CATEGORIES.forEach(function (cat) {
      var key = cat === "teams" ? "teams" : cat;
      (team[key] || []).forEach(function (n) {
        if (placed[n]) return;
        placed[n] = true;
        order.push({ name: n, category: cat });
      });
    });

    return order.map(function (item, i) {
      var out = {
        name: item.name,
        category: item.category,
        round: "R" + (i + 1),
        badge: "",
        city: "",
        photo: null,
        isTeam: false
      };

      var skater = item.category === "teams" ? null : (findSkater(item.name) || findGoalie(item.name));
      if (skater) {
        var code = skater.positionCode || (skater.savePct != null ? "G" : "");
        out.badge = posBadge(code, item.category);
        var ab = firstAbbrev(skater.teamAbbrevs);
        out.city = ab ? (VILLES[ab] || ab) : "";
        out.photo = headshot(item.name);
        return out;
      }

      var tm = findTeam(item.name);
      if (tm || item.category === "teams") {
        out.isTeam = true;
        var abbr = null;
        if (typeof getTeamAbbreviation === "function") {
          try { abbr = getTeamAbbreviation(item.name); } catch (e) {}
        }
        out.badge = abbr || "LNH";
        out.city = "Équipe LNH";
        out.photo = teamLogo(abbr);
        return out;
      }

      // Ni joueur ni équipe reconnus : carte générique.
      out.badge = posBadge(null, item.category);
      out.photo = headshot(item.name);
      return out;
    });
  }

  function totalRounds() {
    if (!draftReady() || !Array.isArray(draftData.draftOrder) || !draftData.draftOrder.length) return 0;
    var teams = new Set(draftData.draftOrder).size || 1;
    return Math.ceil(draftData.draftOrder.length / teams);
  }

  /* ------------------------------------------------------------------ rendu */

  function build() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "draftEndOverlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "fzEndTitle");
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="fz-end-modal">' +
        '<div class="fz-end-head">' +
          '<div class="fz-end-crest" aria-hidden="true">F</div>' +
          '<div class="fz-end-titles">' +
            '<div class="fz-end-eyebrow">Repêchage terminé</div>' +
            '<h2 class="fz-end-title" id="fzEndTitle">Ton équipe est complète</h2>' +
            '<div class="fz-end-sub" id="fzEndSub"></div>' +
          '</div>' +
          '<button type="button" class="fz-end-close" id="fzEndClose" aria-label="Fermer">✕</button>' +
        '</div>' +
        '<div class="fz-end-body">' +
          '<div class="fz-end-body-label">Tes joueurs</div>' +
          '<div class="fz-end-grid" id="fzEndGrid"></div>' +
        '</div>' +
        '<div class="fz-end-foot">' +
          '<button type="button" class="fz-end-btn fz-end-btn--primary" id="fzEndRanking">Voir mon classement</button>' +
          '<button type="button" class="fz-end-btn fz-end-btn--ghost" id="fzEndShare">Partager mes choix</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    overlay.querySelector("#fzEndClose").addEventListener("click", close);
    overlay.querySelector("#fzEndRanking").addEventListener("click", function () {
      window.location.href = "classement.html";
    });
    overlay.querySelector("#fzEndShare").addEventListener("click", sharePicks);

    return overlay;
  }

  function cardHTML(p) {
    var photo = p.photo
      ? '<img src="' + esc(p.photo) + '" alt="" loading="lazy" ' +
        'onerror="this.remove()">'
      : '<span class="fz-end-photo-ph">Photo</span>';
    return '<div class="fz-end-card">' +
        '<div class="fz-end-photo">' + photo +
          '<span class="fz-end-round">' + esc(p.round) + '</span>' +
          '<span class="fz-end-pos">' + esc(p.badge) + '</span>' +
        '</div>' +
        '<div class="fz-end-ident">' +
          '<div class="fz-end-name">' + esc(p.name) + '</div>' +
          '<div class="fz-end-team">' + esc(p.city) + '</div>' +
        '</div>' +
      '</div>';
  }

  function render() {
    build();
    var picks = collectPicks();
    var me = myTeamName() || "";
    var rounds = totalRounds();

    var sub = [];
    if (me) sub.push(me);
    sub.push(picks.length + " choix");
    if (rounds) sub.push("ronde " + rounds + " de " + rounds);
    overlay.querySelector("#fzEndSub").textContent = sub.join(" · ");

    var grid = overlay.querySelector("#fzEndGrid");
    if (!picks.length) {
      grid.innerHTML = '<div class="fz-end-empty">Vous suiviez ce repêchage sans y participer :' +
        ' il n\'y a pas d\'alignement à afficher.</div>';
    } else {
      grid.innerHTML = picks.map(cardHTML).join("");
    }
    return picks;
  }

  function sharePicks() {
    var picks = collectPicks();
    var me = myTeamName() || "Mon équipe";
    var lines = picks.map(function (p, i) {
      return (i + 1) + ". " + p.name + (p.city ? " (" + p.city + ")" : "");
    });
    var text = "Mes choix de repêchage — " + me + " · " + (clan() || "Fantazy") + "\n" + lines.join("\n");

    if (navigator.share) {
      navigator.share({ title: "Mes choix de repêchage", text: text }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        notify("Vos choix ont été copiés dans le presse-papiers.", "success");
      }).catch(function () {
        notify("Impossible de copier automatiquement.", "error");
      });
      return;
    }
    notify("Le partage n'est pas disponible sur cet appareil.", "info");
  }

  function notify(msg, type) {
    if (typeof showCustomAlert === "function") showCustomAlert(msg, type || "info");
    else alert(msg);
  }

  /* ---------------------------------------------------------- ouverture/fermeture */

  function onKeydown(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
  }

  function open() {
    build();
    lastFocus = document.activeElement;
    overlay.hidden = false;
    overlay.classList.add("is-open");
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeydown);
    var focusTarget = overlay.querySelector("#fzEndClose")
      || overlay.querySelector("#fzEndRanking");
    if (focusTarget) setTimeout(function () { focusTarget.focus(); }, 0);
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove("is-open");
    overlay.hidden = true;
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  function seenKey() { return "fzDraftEndSeen_" + (clan() || "default"); }

  function alreadySeen() {
    try { return localStorage.getItem(seenKey()) === "1"; } catch (e) { return false; }
  }
  function markSeen() {
    try { localStorage.setItem(seenKey(), "1"); } catch (e) {}
  }

  /* Auto-affichage : une seule fois par pool, quand le repêchage vient de
   * se terminer et que l'utilisateur a une équipe. */
  function maybeAutoShow() {
    if (seenAutoShow) return;
    if (!draftReady() || !draftComplete()) return;
    // Attendre que les jeux de données joueurs soient chargés, sinon le
    // récapitulatif s'ouvrirait sans photos ni équipes (et ne se rejoue pas).
    if (typeof fullPlayerData === "undefined" || !fullPlayerData.length) return;
    var me = myTeamName();
    if (!me || !draftData.teams[me]) return;
    if (alreadySeen()) { seenAutoShow = true; return; }
    if (overlay && overlay.classList.contains("is-open")) return;

    var picks = render();
    if (!picks.length) { seenAutoShow = true; markSeen(); return; }

    seenAutoShow = true;
    markSeen();
    open();
  }

  /* ------------------------------------------------------------------ liaison */

  // Rejoue après chaque updateTable(), comme les autres modules de draftActif.
  function hookUpdateTable(tries) {
    if (typeof updateTable === "function") {
      var orig = updateTable;
      updateTable = function () {
        orig.apply(this, arguments);
        try { maybeAutoShow(); } catch (e) { console.error("fin de repêchage :", e); }
        try { wireReopenAffordance(); } catch (e) {}
      };
      return;
    }
    if ((tries || 0) < 40) setTimeout(function () { hookUpdateTable((tries || 0) + 1); }, 150);
  }

  document.addEventListener("DOMContentLoaded", function () {
    hookUpdateTable(0);
    setTimeout(function () { try { maybeAutoShow(); } catch (e) {} }, 900);
  });

  // Ouverture manuelle : ignore le drapeau « déjà vu ».
  window.fzShowDraftEndPopup = function () {
    render();
    open();
  };

  /* Le panneau « Repêchage terminé » intégré à la page reste le récap
   * permanent ; on y greffe un bouton pour rouvrir le popup à volonté. */
  function wireReopenAffordance() {
    var panel = document.getElementById("draftDonePanel");
    if (!panel || panel.hidden) return;
    if (panel.querySelector(".fz-end-reopen")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fz-end-btn fz-end-btn--ghost fz-end-reopen";
    btn.style.margin = "12px auto 0";
    btn.style.maxWidth = "260px";
    btn.textContent = "Revoir le récapitulatif";
    btn.addEventListener("click", window.fzShowDraftEndPopup);
    var cta = panel.querySelector(".draft-done-cta");
    if (cta && cta.parentNode) cta.parentNode.insertBefore(btn, cta);
    else panel.appendChild(btn);
  }

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(function () { try { wireReopenAffordance(); } catch (e) {} }, 1000);
  });
})();
