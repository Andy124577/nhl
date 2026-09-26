/**
 * Favoris du repêchage.
 *
 * Deux surfaces, une seule source de vérité (localStorage, propre au pool
 * et à la personne — voir fzFavKey) :
 *   - la colonne Action du tableau (#playerTable) : l'étoile à contour, à
 *     côté du bouton de sélection, qui ajoute ou retire un favori ;
 *   - la vue « Favoris » du rail de gauche (draftDesk.js) : la liste des
 *     favoris encore libres, rangés par fzPointsCandidat().
 *
 * Rien n'est inventé ici : les fiches viennent des mêmes tableaux que le
 * reste de la page (fullPlayerData, goalieData, teamData), déjà chargés
 * par draftActif.js au moment où ce fichier s'exécute.
 *
 * Rejoué après chaque rendu du tableau par draftRefresh.js
 * (window.fzRefreshFavoritesUI, ajoutée à la liste de refreshDraftViews) —
 * pas de logique de repêchage propre ici, uniquement de la lecture et de
 * l'affichage.
 */

/* ============================================================
   1. STOCKAGE
   ============================================================ */

function fzFavKey() {
    const clan = typeof currentClan !== 'undefined' ? currentClan : '';
    const qui = typeof username !== 'undefined' ? username : '';
    return 'fzFavoris_' + clan + '_' + qui;
}

function fzGetFavorites() {
    try {
        const brut = localStorage.getItem(fzFavKey());
        const liste = brut ? JSON.parse(brut) : [];
        return Array.isArray(liste) ? liste : [];
    } catch (e) { return []; }
}

function fzSetFavorites(liste) {
    try { localStorage.setItem(fzFavKey(), JSON.stringify(liste)); } catch (e) {}
}

function fzIsFavorite(nom) {
    return fzGetFavorites().includes(nom);
}

function fzToggleFavorite(nom) {
    const liste = fzGetFavorites();
    const i = liste.indexOf(nom);
    if (i >= 0) liste.splice(i, 1); else liste.push(nom);
    fzSetFavorites(liste);
    if (typeof window.fzRefreshFavoritesUI === 'function') window.fzRefreshFavoritesUI();
}

/* ============================================================
   2. RÉSOLUTION D'UN NOM VERS SA FICHE
   ------------------------------------------------------------
   Même logique de recherche que resolvePickInfo() dans draftPickCards.js,
   étendue au calcul du code de position — dupliquée plutôt que partagée :
   la version de draftActif.js vit à l'intérieur de updateTable(), pas
   accessible de l'extérieur.
   ============================================================ */

function fzFindRecord(nom) {
    if (typeof fullPlayerData !== 'undefined' && Array.isArray(fullPlayerData)) {
        const p = fullPlayerData.find(e => e.skaterFullName === nom);
        if (p) return { rec: p, kind: 'skater' };
    }
    if (typeof goalieData !== 'undefined' && Array.isArray(goalieData)) {
        const g = goalieData.find(e => e.goalieFullName === nom);
        if (g) return { rec: g, kind: 'goalie' };
    }
    if (typeof teamData !== 'undefined' && Array.isArray(teamData)) {
        const t = teamData.find(e => e.teamFullName === nom);
        if (t) return { rec: t, kind: 'team' };
    }
    return null;
}

/** Même seuil de recrue que updateTable() (vue « Recrues »/« Joueurs »). */
function fzPositionCode(rec, kind) {
    if (kind === 'goalie') return 'G';
    if (kind === 'team') return 'T';
    // Le drapeau vient de la trousse (matchs joués la saison dernière + âge,
    // voir tools/build_draftkit.js). L'ancien test devinait la recrue à partir
    // des matchs affichés et d'un playerId manquant : depuis que les chiffres
    // portent la projection 2026-2027 et que l'identifiant LNH n'est plus
    // rattaché qu'à une fiche sur deux, il classait la moitié du bassin comme
    // recrue — d'où un compteur « Recrues » à plusieurs centaines.
    return rec.isRookie === true ? '*' : rec.positionCode;
}

function fzPositionLabel(code) {
    return typeof pickPositionLabel === 'function' ? pickPositionLabel(code) : code;
}

/** Même regroupement que « Ma progression » (progress-card) : la position
 *  telle qu'elle s'y compte. Lu d'ici par draftApercuExtra.js (suggestion,
 *  sidebar de position) et draftDesk.js (alignement du rail). */
function fzGroupKeyFor(code, kind) {
    if (code === '*') return 'rookie';
    if (kind === 'goalie') return 'goalie';
    if (kind === 'team') return 'team';
    if (code === 'D') return 'defensive';
    return 'offensive';
}

function fzPhotoAndLogo(nom, rec, kind) {
    if (kind === 'team') {
        const abbrev = typeof getTeamAbbreviation === 'function' ? getTeamAbbreviation(nom) : null;
        return { photo: abbrev ? `teams/${abbrev}.png` : null, logo: null };
    }
    const stats = typeof getCurrentPlayerStats === 'function' ? getCurrentPlayerStats(nom, rec.playerId) : null;
    const photo = (stats && stats.headshot)
        || (typeof getMatchingImage === 'function' ? getMatchingImage(nom) : null);
    const logo = (stats && stats.teamAbbrev)
        ? `teams/${stats.teamAbbrev}.png`
        : (typeof getTeamLogoPath === 'function' ? getTeamLogoPath(rec.teamAbbrevs) : null);
    return { photo, logo };
}

function fzStatBlurb(rec, kind) {
    if (kind === 'goalie') {
        const sv = rec.savePct != null ? rec.savePct.toFixed(3) : '-';
        return `${rec.wins ?? '-'} V · ${sv} SV%`;
    }
    if (kind === 'team') return `${rec.wins ?? '-'} V · ${rec.losses ?? '-'} D`;
    return `${rec.goals ?? '-'} B · ${rec.assists ?? '-'} A`;
}

/** Tout ce qui a déjà été pris, toutes équipes confondues — comme updateTable(). */
function fzPickedSet() {
    const set = new Set();
    if (typeof draftData !== 'undefined' && draftData && draftData.teams) {
        Object.values(draftData.teams).forEach(e => {
            [].concat(e.offensive || [], e.defensive || [], e.rookie || [], e.goalie || [], e.teams || [])
                .forEach(n => set.add(n));
        });
    }
    return set;
}

/* ============================================================
   3. BOUTONS PARTAGÉS
   ============================================================ */

/**
 * Étoile à contour : ajoute ou retire un favori. Utilisée dans la colonne
 * Action du tableau (à côté du bouton de sélection) et dans la carte
 * Suggestion (draftApercuExtra.js).
 */
function fzBuildStarButton(nom) {
    const actif = fzIsFavorite(nom);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'favorite-btn';
    btn.classList.toggle('is-active', actif);
    btn.setAttribute('aria-pressed', String(actif));
    const libelle = (actif ? 'Retirer des favoris : ' : 'Ajouter aux favoris : ') + nom;
    btn.setAttribute('aria-label', libelle);
    btn.title = actif ? 'Retirer des favoris' : 'Ajouter aux favoris';
    btn.innerHTML = typeof getIcon === 'function' ? getIcon('star', 16) : '★';
    btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        fzToggleFavorite(nom);
    });
    return btn;
}

/** Même bouton, même icône que celui que draftActif.js pose déjà dans le tableau. */
function fzBuildSelectButton(nom, code) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'select-button';
    btn.setAttribute('aria-label', 'Sélectionner ' + nom);
    const img = document.createElement('img');
    img.className = 'select-icon';
    img.src = 'Icons/sign.png';
    img.alt = '';
    btn.appendChild(img);
    btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof selectPlayer === 'function') selectPlayer(nom, code);
    });
    return btn;
}

/* ============================================================
   4. COLONNE ACTION DU TABLEAU
   ------------------------------------------------------------
   draftActif.js met un bouton de sélection dans la cellule quand c'est
   votre tour, et la laisse vide sinon. On ne touche jamais à ce bouton :
   on ajoute l'étoile à côté, quel que soit le tour.

   Elle y était réservée aux tours des autres, ce qui était l'inverse de
   ce qu'il fallait : c'est en parcourant la liste PENDANT son propre
   tour qu'on repère les joueurs qu'on ne prendra pas maintenant mais au
   choix suivant. La mettre partout coûte un bouton de plus par rangée et
   supprime le trou.
   ============================================================ */

/** Nom du joueur porté par une rangée — patineurs/gardiens l'ont en data-*,
 *  les équipes non : leur nom est la 2e cellule (Logo, Nom, GP, …). */
function fzRowPlayerName(tr) {
    if (tr.dataset && tr.dataset.playername) return tr.dataset.playername;
    const cell = tr.children && tr.children[1];
    return cell ? cell.textContent.trim() : null;
}

function fzRefreshActionColumns() {
    document.querySelectorAll('#playerTable tbody tr').forEach(tr => {
        const cellule = tr.querySelector('td.action-column');
        if (!cellule) return;
        const nom = fzRowPlayerName(tr);
        if (!nom) return;
        // Remplacée plutôt qu'ajoutée : cette fonction est rejouée à chaque
        // rafraîchissement, y compris sans reconstruction du tableau — une
        // étoile de plus s'empilerait à chaque passage.
        const etoile = cellule.querySelector('button.favorite-btn');
        // En TETE de cellule : la maquette met l'etoile avant « Repecher »,
        // et l'ordre du DOM est aussi celui du clavier — on tombe donc sur
        // l'etoile avant le bouton qui engage le choix, pas apres.
        if (etoile) etoile.replaceWith(fzBuildStarButton(nom));
        else cellule.prepend(fzBuildStarButton(nom));
    });
}

/* ============================================================
   5. VALEUR D'UN FAVORI
   ------------------------------------------------------------
   Sert à ranger la liste des favoris du rail de gauche
   (fzDeskFavoris, draftDesk.js), du meilleur au moins bon.
   ============================================================ */

/** Même mesure de valeur que fzComputeSuggestion (draftApercuExtra.js) :
 *  les points déjà affichés, victoires × 2 pour un gardien — jamais une
 *  projection inventée. */
function fzPointsCandidat(rec, kind) {
    return kind === 'goalie' ? (rec.wins || 0) * 2 : (rec.points || 0);
}

/* ============================================================
   6. SURVEILLANCE DU TABLEAU
   ------------------------------------------------------------
   `#playerFilter`, `#searchInput`, `#sortBy` et `#availabilityFilter`
   sont liés à updateTable() via $(...).on(...) tout en haut de
   draftActif.js (ligne 1, avant les IIFE qui l'enrichissent plus bas
   dans le même fichier, dont l'ajout de draftRefresh.js). jQuery capture
   la RÉFÉRENCE de updateTable au moment de la liaison — donc la version
   encore nue, sans aucun des enrichissements ajoutés après coup. Changer
   de catégorie, trier ou chercher rafraîchit bien le tableau, mais sans
   jamais passer par refreshDraftViews() ni par ce fichier : les étoiles
   n'apparaissaient donc que dans la vue par défaut (« Joueurs »), la
   seule à avoir déjà traversé une fois le vrai chemin complet (au
   premier chargement, via loadDraftData()).

   Plutôt que d'ajouter encore une couche à cette chaîne d'appels fragile,
   on observe directement l'effet qui nous intéresse : `#playerTable
   tbody` reçoit de nouvelles rangées (populateTable()/populateGoalieTable()/
   populateTeamTable() vident puis remplissent le même nœud, jamais
   remplacé). `childList` sans `subtree` : remplacer le contenu d'une
   cellule .action-column (ce que fzRefreshActionColumns fait) ne mute
   pas `tbody` lui-même, donc aucune boucle. */
function fzWatchPlayerTable() {
    const tbody = document.querySelector('#playerTable tbody');
    if (!tbody) return;
    const observer = new MutationObserver(() => {
        try { fzRefreshActionColumns(); } catch (e) { console.error('[favoris] colonne action :', e); }
    });
    observer.observe(tbody, { childList: true });
}

/* ============================================================
   7. POINT D'ENTRÉE
   ------------------------------------------------------------
   Ajoutée à la liste `rendus` de refreshDraftViews() (draftRefresh.js) :
   rejouée après chaque updateTable() qui passe par le chemin complet
   (sondage, socket, premier chargement).
   ============================================================ */
window.fzRefreshFavoritesUI = function () {
    try { fzRefreshActionColumns(); } catch (e) { console.error('[favoris] colonne action :', e); }
};

document.addEventListener('DOMContentLoaded', () => {
    try { fzWatchPlayerTable(); } catch (e) {}
});
