/**
 * Favoris du repêchage.
 *
 * Deux surfaces, une seule source de vérité (localStorage, propre au pool
 * et à la personne — voir fzFavKey) :
 *   - la colonne Action du tableau (#playerTable) : quand le bouton de
 *     sélection n'y est pas (pas votre tour, ou votre équipe est complète),
 *     une étoile à contour prend sa place plutôt que de laisser la cellule
 *     vide — c'est elle qui ajoute ou retire un favori ;
 *   - la carte « Mes favoris », dans l'onglet Aperçu (draftActifUI.js) :
 *     la liste de ce qui a été mis de côté, avec la même étoile pour la
 *     retirer et, si c'est votre tour, un vrai bouton de sélection pour
 *     repêcher directement depuis le raccourci.
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
    const estRecrue = (rec.gamesPlayed <= 27 || rec.playerId == null
        || rec.teamAbbrevs == null || rec.teamAbbrevs === 'null')
        && rec.skaterFullName !== 'Tyler Seguin';
    return estRecrue ? '*' : rec.positionCode;
}

function fzPositionLabel(code) {
    return typeof pickPositionLabel === 'function' ? pickPositionLabel(code) : code;
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
 * Étoile à contour : ajoute ou retire un favori. Utilisée à la fois dans
 * la colonne Action du tableau (à la place du bouton de sélection, hors de
 * son tour) et dans la carte « Mes favoris » (pour en retirer un).
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
   draftActif.js laisse la cellule vide dès que ce n'est pas votre tour
   (ou que votre équipe est complète) : on ne touche jamais à un bouton de
   sélection déjà présent, on ne remplit qu'une cellule vide.
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
        if (cellule.querySelector('button.select-button')) return;
        const nom = fzRowPlayerName(tr);
        if (!nom) return;
        cellule.replaceChildren(fzBuildStarButton(nom));
    });
}

/* ============================================================
   5. CARTE « MES FAVORIS »
   ============================================================ */

function fzBuildFavoriteRow(nom) {
    const trouve = fzFindRecord(nom);
    const row = document.createElement('div');
    row.className = 'favorite-row';
    row.dataset.player = nom;

    if (!trouve) {
        // Fiche introuvable (données changées entre-temps) : on garde la
        // ligne, juste de quoi la retirer plutôt que de la faire disparaître
        // sans explication.
        const info = document.createElement('div');
        info.className = 'favorite-row-info';
        const name = document.createElement('span');
        name.className = 'favorite-row-name';
        name.textContent = nom;
        info.appendChild(name);
        row.appendChild(info);
        const actions = document.createElement('div');
        actions.className = 'favorite-row-actions';
        actions.appendChild(fzBuildStarButton(nom));
        row.appendChild(actions);
        return row;
    }

    const { rec, kind } = trouve;
    const code = fzPositionCode(rec, kind);
    const { photo, logo } = fzPhotoAndLogo(nom, rec, kind);
    const dejaPris = fzPickedSet().has(nom);

    const photoZone = document.createElement('div');
    photoZone.className = 'progress-player-photo favorite-row-photo';
    if (photo) {
        const img = document.createElement('img');
        img.className = 'face';
        img.src = photo;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => img.remove());
        photoZone.appendChild(img);
    } else {
        photoZone.classList.add('no-image');
        photoZone.textContent = nom.split(/\s+/).filter(Boolean).slice(0, 2).map(m => m[0]).join('').toUpperCase();
    }
    if (logo && kind !== 'team') {
        const logoImg = document.createElement('img');
        logoImg.className = 'logo';
        logoImg.src = logo;
        logoImg.alt = '';
        logoImg.loading = 'lazy';
        logoImg.addEventListener('error', () => logoImg.remove());
        photoZone.appendChild(logoImg);
    }
    row.appendChild(photoZone);

    const info = document.createElement('div');
    info.className = 'favorite-row-info';
    const name = document.createElement('span');
    name.className = 'favorite-row-name';
    name.textContent = nom;
    info.appendChild(name);
    const meta = document.createElement('span');
    meta.className = 'favorite-row-pos';
    meta.textContent = dejaPris
        ? 'Déjà repêché'
        : `${fzPositionLabel(code)} · ${fzStatBlurb(rec, kind)}`;
    info.appendChild(meta);
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'favorite-row-actions';
    const peutChoisir = !dejaPris
        && typeof isUserTurn === 'function' && isUserTurn()
        && typeof checkIfUserTeamIsDone === 'function' && !checkIfUserTeamIsDone()
        && !(typeof _isCategoryFull === 'function' && _isCategoryFull(code));
    if (peutChoisir) actions.appendChild(fzBuildSelectButton(nom, code));
    actions.appendChild(fzBuildStarButton(nom));
    row.appendChild(actions);

    row.classList.toggle('is-picked', dejaPris);
    return row;
}

function fzRenderFavoritesCard() {
    const liste = document.getElementById('favoritesList');
    if (!liste) return;
    const vide = document.getElementById('favoritesEmpty');
    const compteur = document.getElementById('favoritesCount');

    const noms = fzGetFavorites();
    if (compteur) {
        compteur.textContent = String(noms.length);
        compteur.hidden = noms.length === 0;
    }
    if (vide) vide.hidden = noms.length > 0;

    liste.replaceChildren();
    noms.forEach(nom => liste.appendChild(fzBuildFavoriteRow(nom)));
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
   (sondage, socket, premier chargement) — la carte « Mes favoris »
   dépend de draftData (déjà repêché ou non), pas de la catégorie
   affichée dans le tableau, donc pas besoin de l'observer ci-dessus.
   ============================================================ */
window.fzRefreshFavoritesUI = function () {
    try { fzRefreshActionColumns(); } catch (e) { console.error('[favoris] colonne action :', e); }
    try { fzRenderFavoritesCard(); } catch (e) { console.error('[favoris] carte :', e); }
};

document.addEventListener('DOMContentLoaded', () => {
    try { fzRenderFavoritesCard(); } catch (e) {}
    try { fzWatchPlayerTable(); } catch (e) {}
});
