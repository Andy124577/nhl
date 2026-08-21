/**
 * Ma file — liste d'attente personnelle du repêchage.
 *
 * Même patron que draftFavorites.js (stockage localStorage propre au pool
 * et à la personne, réutilise ses fonctions de résolution de fiche —
 * fzFindRecord/fzPositionCode/fzPositionLabel/fzPhotoAndLogo/fzStatBlurb/
 * fzPickedSet, toutes globales une fois draftFavorites.js exécuté), mais
 * une liste ORDONNÉE plutôt qu'un ensemble : l'ordre d'ajout est l'ordre
 * de préférence. Pas de réordonnancement ni de sélection automatique
 * depuis la file — ajouter ou retirer seulement (design Claude « Ma
 * file », artboards 3B/4B : bouton « Ma file (N) »/« Préparer ma file »
 * dans le bandeau de tour, bouton « Ma file » dans la carte « Joueur
 * sélectionné », onglet « Ma file » dans les sous-onglets de l'Aperçu).
 */

/* ============================================================
   1. STOCKAGE
   ============================================================ */

function fzQueueKey() {
    const clan = typeof currentClan !== 'undefined' ? currentClan : '';
    const qui = typeof username !== 'undefined' ? username : '';
    return 'fzFile_' + clan + '_' + qui;
}

function fzGetQueue() {
    try {
        const brut = localStorage.getItem(fzQueueKey());
        const liste = brut ? JSON.parse(brut) : [];
        return Array.isArray(liste) ? liste : [];
    } catch (e) { return []; }
}

function fzSetQueue(liste) {
    try { localStorage.setItem(fzQueueKey(), JSON.stringify(liste)); } catch (e) {}
}

function fzIsQueued(nom) {
    return fzGetQueue().includes(nom);
}

function fzToggleQueue(nom) {
    const liste = fzGetQueue();
    const i = liste.indexOf(nom);
    if (i >= 0) liste.splice(i, 1); else liste.push(nom);
    fzSetQueue(liste);
    if (typeof window.fzRefreshQueueUI === 'function') window.fzRefreshQueueUI();
}

/* ============================================================
   2. BOUTONS
   ============================================================ */

/** Bouton texte « Ma file » — carte « Joueur sélectionné » et bandeau de
 *  tour (celui-ci construit son propre libellé, voir draftActif.js). */
function fzBuildQueueToggleButton(nom) {
    const actif = fzIsQueued(nom);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'queue-toggle-btn';
    btn.classList.toggle('is-active', actif);
    btn.setAttribute('aria-pressed', String(actif));
    btn.title = actif ? 'Retirer de ma file' : 'Ajouter à ma file';
    btn.textContent = 'Ma file';
    btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        fzToggleQueue(nom);
    });
    return btn;
}

/** Bouton « × » — retrait rapide depuis une rangée de la carte « Ma file ». */
function fzBuildQueueRemoveButton(nom) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'favorite-btn queue-remove-btn';
    btn.setAttribute('aria-label', 'Retirer de ma file : ' + nom);
    btn.title = 'Retirer de ma file';
    btn.innerHTML = typeof getIcon === 'function' ? getIcon('x', 15) : '×';
    btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        fzToggleQueue(nom);
    });
    return btn;
}

/* ============================================================
   3. CARTE « MA FILE »
   ------------------------------------------------------------
   Liste plate, dans l'ordre d'ajout (pas de regroupement par position
   comme les favoris : la file est un ordre de préférence, pas un
   inventaire). Mêmes classes .favorite-row* que draftFavorites.js pour
   l'habillage — seul le numéro de rang est propre à la file.
   ============================================================ */

function fzBuildQueueRow(nom, rang) {
    const trouve = typeof fzFindRecord === 'function' ? fzFindRecord(nom) : null;
    const row = document.createElement('div');
    row.className = 'favorite-row queue-row';
    row.dataset.player = nom;

    const rangEl = document.createElement('span');
    rangEl.className = 'queue-row-rank';
    rangEl.textContent = String(rang);
    row.appendChild(rangEl);

    if (!trouve) {
        const info = document.createElement('div');
        info.className = 'favorite-row-info';
        const name = document.createElement('span');
        name.className = 'favorite-row-name';
        name.textContent = nom;
        info.appendChild(name);
        row.appendChild(info);
        const actions = document.createElement('div');
        actions.className = 'favorite-row-actions';
        actions.appendChild(fzBuildQueueRemoveButton(nom));
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
    if (peutChoisir && typeof fzBuildSelectButton === 'function') actions.appendChild(fzBuildSelectButton(nom, code));
    actions.appendChild(fzBuildQueueRemoveButton(nom));
    row.appendChild(actions);

    row.classList.toggle('is-picked', dejaPris);
    return row;
}

function fzRenderQueueCard() {
    const liste = document.getElementById('queueList');
    if (!liste) return;
    const vide = document.getElementById('queueEmpty');
    const compteur = document.getElementById('queueCount');

    const noms = fzGetQueue();
    if (compteur) {
        compteur.textContent = String(noms.length);
        compteur.hidden = noms.length === 0;
    }
    if (vide) vide.hidden = noms.length > 0;

    liste.replaceChildren();
    noms.forEach((nom, i) => liste.appendChild(fzBuildQueueRow(nom, i + 1)));

    const apercuCompteur = document.getElementById('apercuQueueCount');
    if (apercuCompteur) apercuCompteur.textContent = String(noms.length);

    // Bouton « Ma file (N) » du bandeau de tour (draftActif.js) : même
    // décompte, mis à jour ici plutôt que d'exposer refreshTurnAlert (elle
    // vit dans l'IIFE de draftActif.js, hors de portée). Seulement en
    // variante « à vous » — en attente, le bouton dit « Préparer ma file »,
    // jamais un compte.
    const heroBtn = document.getElementById('turn-banner-queue-btn');
    const banniere = document.getElementById('turn-banner');
    if (heroBtn && !heroBtn.hidden && banniere && banniere.classList.contains('your-turn')) {
        heroBtn.textContent = 'Ma file' + (noms.length ? ` (${noms.length})` : '');
    }
}

/* ============================================================
   4. POINT D'ENTRÉE
   ------------------------------------------------------------
   Ajoutée à la liste `rendus` de refreshDraftViews() (draftRefresh.js) —
   même position que fzRefreshFavoritesUI, pour les mêmes raisons (l'état
   « déjà repêché » et le tour courant changent à chaque choix).
   ============================================================ */
window.fzRefreshQueueUI = function () {
    try { fzRenderQueueCard(); } catch (e) { console.error('[file] carte :', e); }
    try { if (typeof fzRenderSelectedPlayerCard === 'function') fzRenderSelectedPlayerCard(); } catch (e) {}
};

document.addEventListener('DOMContentLoaded', () => {
    try { fzRenderQueueCard(); } catch (e) {}
});
