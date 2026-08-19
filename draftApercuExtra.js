/**
 * Compléments de l'onglet Aperçu et de la vue bureau de la Liste des
 * joueurs : suggestion, alignement, derniers choix (texte), sidebar de
 * position avec compteurs, et carte « Joueur sélectionné ».
 *
 * Même règle que draftFavorites.js / draftActifUI.js : aucune logique de
 * repêchage ici, uniquement de la lecture des variables déjà globales de
 * draftActif.js (fullPlayerData, goalieData, draftData, getUserTeam,
 * isUserTurn, checkIfUserTeamIsDone, _isCategoryFull) et des aides déjà
 * posées par draftFavorites.js (fzGetFavorites, fzFindRecord,
 * fzPositionCode, fzPositionLabel, fzGroupKeyFor, fzPhotoAndLogo,
 * fzStatBlurb, fzPickedSet, fzRowPlayerName, fzBuildSelectButton,
 * fzBuildStarButton). Rejoué après chaque rendu réel via la liste `rendus`
 * de refreshDraftViews() (draftRefresh.js).
 */

/* ============================================================
   1. CANDIDATS DISPONIBLES
   ============================================================ */

function fzAllAvailableCandidates() {
    const pris = typeof fzPickedSet === 'function' ? fzPickedSet() : new Set();
    const patineurs = (typeof fullPlayerData !== 'undefined' && Array.isArray(fullPlayerData) ? fullPlayerData : [])
        .filter(p => !pris.has(p.skaterFullName))
        .map(p => ({ nom: p.skaterFullName, rec: p, kind: 'skater' }));
    const gardiens = (typeof goalieData !== 'undefined' && Array.isArray(goalieData) ? goalieData : [])
        .filter(g => !pris.has(g.goalieFullName))
        .map(g => ({ nom: g.goalieFullName, rec: g, kind: 'goalie' }));
    return patineurs.concat(gardiens);
}

/** Groupes de la progression dont le quota de l'équipe n'est pas atteint. */
function fzGroupesManquants() {
    const me = typeof getUserTeam === 'function' ? getUserTeam() : null;
    const cfg = (typeof draftData !== 'undefined' && draftData && draftData.config)
        || { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1 };
    const equipe = (me && typeof draftData !== 'undefined' && draftData && draftData.teams && draftData.teams[me]) || {};
    return {
        offensive: (equipe.offensive || []).length < (cfg.numOffensive ?? 6),
        defensive: (equipe.defensive || []).length < (cfg.numDefensive ?? 4),
        rookie: (equipe.rookie || []).length < (cfg.numRookies ?? 1),
        goalie: (equipe.goalie || []).length < (cfg.numGoalies ?? 1)
    };
}

/* ============================================================
   2. SUGGESTION — meilleur favori libre, priorité à un trou à combler
   ============================================================ */

function fzComputeSuggestion() {
    const favoris = new Set(typeof fzGetFavorites === 'function' ? fzGetFavorites() : []);
    const manquants = fzGroupesManquants();
    const bassin = fzAllAvailableCandidates();
    const favorisDispo = bassin.filter(c => favoris.has(c.nom));
    const base = favorisDispo.length ? favorisDispo : bassin;

    const pointsDe = c => c.kind === 'goalie' ? (c.rec.wins || 0) * 2 : (c.rec.points || 0);
    const score = c => {
        const code = typeof fzPositionCode === 'function' ? fzPositionCode(c.rec, c.kind) : '';
        const groupe = typeof fzGroupKeyFor === 'function' ? fzGroupKeyFor(code, c.kind) : '';
        return (manquants[groupe] ? 1e6 : 0) + pointsDe(c);
    };

    const triés = [...base].sort((a, b) => score(b) - score(a));
    const top = triés[0];
    if (!top) return null;

    const code = typeof fzPositionCode === 'function' ? fzPositionCode(top.rec, top.kind) : '';
    const groupe = typeof fzGroupKeyFor === 'function' ? fzGroupKeyFor(code, top.kind) : '';
    return { nom: top.nom, rec: top.rec, kind: top.kind, code, combleUnTrou: !!manquants[groupe], estFavori: favoris.has(top.nom) };
}

function fzPeutChoisir(code) {
    return typeof isUserTurn === 'function' && isUserTurn()
        && typeof checkIfUserTeamIsDone === 'function' && !checkIfUserTeamIsDone()
        && !(typeof _isCategoryFull === 'function' && _isCategoryFull(code));
}

function fzRenderSuggestionCard() {
    const hote = document.getElementById('suggestionCard');
    if (!hote) return;
    const corps = hote.querySelector('.suggestion-body');
    const vide = hote.querySelector('.suggestion-empty');
    const s = fzComputeSuggestion();

    if (!s) {
        if (corps) corps.hidden = true;
        if (vide) vide.hidden = false;
        return;
    }
    if (vide) vide.hidden = true;
    if (!corps) return;
    corps.hidden = false;
    corps.replaceChildren();

    const { photo } = typeof fzPhotoAndLogo === 'function' ? fzPhotoAndLogo(s.nom, s.rec, s.kind) : {};
    const zonePhoto = document.createElement('div');
    zonePhoto.className = 'suggestion-photo';
    if (photo) {
        const img = document.createElement('img');
        img.src = photo; img.alt = ''; img.loading = 'lazy';
        img.addEventListener('error', () => img.remove());
        zonePhoto.appendChild(img);
    }
    corps.appendChild(zonePhoto);

    const info = document.createElement('div');
    info.className = 'suggestion-info';
    const tag = document.createElement('div');
    tag.className = 'suggestion-tag';
    tag.textContent = s.combleUnTrou ? 'Suggestion — comble un trou'
        : (s.estFavori ? 'Suggestion — meilleur favori libre' : 'Suggestion — meilleur disponible');
    info.appendChild(tag);
    const nom = document.createElement('div');
    nom.className = 'suggestion-name';
    nom.textContent = s.nom;
    info.appendChild(nom);
    const meta = document.createElement('div');
    meta.className = 'suggestion-meta';
    const libellePos = typeof fzPositionLabel === 'function' ? fzPositionLabel(s.code) : s.code;
    const blurb = typeof fzStatBlurb === 'function' ? fzStatBlurb(s.rec, s.kind) : '';
    meta.textContent = [libellePos, blurb].filter(Boolean).join(' · ');
    info.appendChild(meta);
    corps.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'suggestion-actions';
    if (fzPeutChoisir(s.code) && typeof fzBuildSelectButton === 'function') {
        actions.appendChild(fzBuildSelectButton(s.nom, s.code));
    }
    if (typeof fzBuildStarButton === 'function') actions.appendChild(fzBuildStarButton(s.nom));
    corps.appendChild(actions);
}

/* ============================================================
   3. DERNIERS CHOIX — même historique que la vue "Tous", en texte
   ============================================================ */

function fzRenderRecentPicksFeed() {
    const hote = document.getElementById('recentPicksFeed');
    if (!hote) return;
    const liste = hote.querySelector('.recent-feed-list');
    if (!liste) return;

    const historique = (typeof draftData !== 'undefined' && draftData && draftData.picksHistory) || [];
    liste.replaceChildren();

    if (!historique.length) {
        const p = document.createElement('p');
        p.className = 'no-picks';
        p.textContent = 'Aucun choix pour l’instant.';
        liste.appendChild(p);
        return;
    }

    const total = historique.length;
    historique.slice(-3).reverse().forEach((pick, i) => {
        const numero = total - i;
        const rangee = document.createElement('div');
        rangee.className = 'recent-feed-row';
        const slot = document.createElement('span');
        slot.className = 'recent-feed-slot';
        slot.textContent = 'C' + numero;
        rangee.appendChild(slot);
        const texte = document.createElement('span');
        texte.className = 'recent-feed-text';
        const fort = document.createElement('strong');
        fort.textContent = pick.team;
        texte.appendChild(fort);
        texte.appendChild(document.createTextNode(' a repêché ' + pick.player + '.'));
        rangee.appendChild(texte);
        liste.appendChild(rangee);
    });
}

/* ============================================================
   4. MON ALIGNEMENT — bureau seulement (voir CSS)
   ============================================================ */

function fzRenderLineupCard() {
    const hote = document.getElementById('lineupCard');
    if (!hote) return;
    const liste = hote.querySelector('.lineup-list');
    if (!liste) return;

    const me = typeof getUserTeam === 'function' ? getUserTeam() : null;
    const historique = (typeof draftData !== 'undefined' && draftData && draftData.picksHistory) || [];
    const nbEquipes = (typeof draftData !== 'undefined' && draftData && draftData.teams)
        ? Object.keys(draftData.teams).length : 0;

    const mesChoix = historique
        .map((pick, index) => ({ pick, index }))
        .filter(({ pick }) => me && pick.team === me);

    liste.replaceChildren();
    if (!mesChoix.length) {
        const p = document.createElement('p');
        p.className = 'no-picks';
        p.textContent = 'Aucun choix pour l’instant.';
        liste.appendChild(p);
        return;
    }

    mesChoix.forEach(({ pick, index }) => {
        const trouve = typeof fzFindRecord === 'function' ? fzFindRecord(pick.player) : null;
        const rangee = document.createElement('div');
        rangee.className = 'lineup-row';

        const tuile = document.createElement('div');
        tuile.className = 'lineup-tile';
        if (trouve && typeof fzPhotoAndLogo === 'function') {
            const { logo } = fzPhotoAndLogo(pick.player, trouve.rec, trouve.kind);
            if (logo) {
                const img = document.createElement('img');
                img.src = logo; img.alt = '';
                img.addEventListener('error', () => img.remove());
                tuile.appendChild(img);
            }
        }
        rangee.appendChild(tuile);

        const nom = document.createElement('span');
        nom.className = 'lineup-name';
        nom.textContent = pick.player;
        rangee.appendChild(nom);

        const detail = document.createElement('span');
        detail.className = 'lineup-round';
        const code = trouve && typeof fzPositionCode === 'function' ? fzPositionCode(trouve.rec, trouve.kind) : '';
        const ronde = nbEquipes > 0 ? Math.floor(index / nbEquipes) + 1 : 0;
        detail.textContent = [code, ronde ? 'R' + ronde : ''].filter(Boolean).join(' · ');
        rangee.appendChild(detail);

        liste.appendChild(rangee);
    });
}

/* ============================================================
   5. SIDEBAR DE POSITION (bureau, Liste des joueurs) — 250px
   ------------------------------------------------------------
   Reprend les options réelles de #playerFilter, comme initCategoryTabs()
   (draftActifUI.js) : un clic écrit dans le <select> caché et déclenche
   son événement `change`. Ajoute seulement un compteur de joueurs
   disponibles par catégorie, absent des pastilles mobiles.
   ============================================================ */

function fzCountAvailable(valeur) {
    const bassin = fzAllAvailableCandidates();
    if (valeur === 'all') return bassin.length;
    return bassin.filter(c => {
        const code = typeof fzPositionCode === 'function' ? fzPositionCode(c.rec, c.kind) : '';
        if (code === '*') return valeur === 'rookies';
        if (valeur === 'rookies') return false;
        if (valeur === 'goalies') return c.kind === 'goalie';
        if (valeur === 'defensive') return code === 'D';
        if (valeur === 'offensive') return c.kind === 'skater' && code !== 'D';
        return false;
    }).length;
}

function fzRenderPositionSidebar() {
    const hote = document.getElementById('listFiltersSidebar');
    const select = document.getElementById('playerFilter');
    const liste = hote && hote.querySelector('.list-filters-positions');
    if (!hote || !select || !liste) return;

    liste.replaceChildren();
    [...select.options].forEach(option => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'list-filter-position';
        item.dataset.value = option.value;
        item.disabled = option.disabled;
        item.classList.toggle('is-active', option.value === select.value);

        const libelle = document.createElement('span');
        libelle.textContent = option.textContent.trim();
        item.appendChild(libelle);

        const compte = document.createElement('span');
        compte.className = 'list-filter-count';
        compte.textContent = String(fzCountAvailable(option.value));
        item.appendChild(compte);

        item.addEventListener('click', () => {
            if (item.disabled) return;
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        liste.appendChild(item);
    });
}

/* ---- Bascule « Mes favoris seulement » ----
   Filtre posé après coup sur les rangées déjà rendues par updateTable()
   (draftActif.js) — jamais de réécriture de son résultat, même patron que
   fzRefreshActionColumns (draftFavorites.js). */
let fzFavorisSeulement = false;

function fzApplyFavoritesOnlyFilter() {
    const corps = document.querySelector('#playerTable tbody');
    if (!corps) return;
    const favoris = new Set(typeof fzGetFavorites === 'function' ? fzGetFavorites() : []);
    corps.querySelectorAll('tr').forEach(tr => {
        if (tr.classList.contains('draft-empty-row')) return;
        const nom = typeof fzRowPlayerName === 'function' ? fzRowPlayerName(tr) : null;
        const cache = fzFavorisSeulement && nom && !favoris.has(nom);
        tr.classList.toggle('fzd-filtered-out', !!cache);
    });
}

function fzInitFavoritesOnlyToggle() {
    const checkbox = document.getElementById('listFilterFavoritesOnly');
    if (!checkbox) return;
    checkbox.addEventListener('change', () => {
        fzFavorisSeulement = checkbox.checked;
        fzApplyFavoritesOnlyFilter();
    });
}

/* ============================================================
   6. JOUEUR SÉLECTIONNÉ (bureau, Liste des joueurs) — 340px
   ------------------------------------------------------------
   Un clic sur une rangée du tableau l'affiche ici. Sans sélection (ou une
   fois le joueur choisi par quelqu'un d'autre), la suggestion en tient
   lieu — jamais de carte vide alors qu'un choix reste à faire.
   ============================================================ */

let fzJoueurAffiche = null;

function fzRenderSelectedPlayerCard() {
    const hote = document.getElementById('selectedPlayerCard');
    if (!hote) return;
    const corps = hote.querySelector('.selected-player-body');
    const vide = hote.querySelector('.selected-player-empty');
    if (!corps || !vide) return;

    const pris = typeof fzPickedSet === 'function' ? fzPickedSet() : new Set();
    let nom = fzJoueurAffiche;
    if (!nom || pris.has(nom) || !(typeof fzFindRecord === 'function' && fzFindRecord(nom))) {
        const suggestion = fzComputeSuggestion();
        nom = suggestion ? suggestion.nom : null;
        fzJoueurAffiche = nom;
    }

    if (!nom) {
        corps.hidden = true;
        vide.hidden = false;
        return;
    }
    const trouve = fzFindRecord(nom);
    if (!trouve) { corps.hidden = true; vide.hidden = false; return; }
    vide.hidden = true;
    corps.hidden = false;
    corps.replaceChildren();

    const { rec, kind } = trouve;
    const code = typeof fzPositionCode === 'function' ? fzPositionCode(rec, kind) : '';
    const { photo } = typeof fzPhotoAndLogo === 'function' ? fzPhotoAndLogo(nom, rec, kind) : {};

    const entete = document.createElement('div');
    entete.className = 'selected-player-head';
    const zonePhoto = document.createElement('div');
    zonePhoto.className = 'selected-player-photo';
    if (photo) {
        const img = document.createElement('img');
        img.src = photo; img.alt = ''; img.loading = 'lazy';
        img.addEventListener('error', () => img.remove());
        zonePhoto.appendChild(img);
    }
    entete.appendChild(zonePhoto);
    const identite = document.createElement('div');
    identite.className = 'selected-player-ident';
    const titre = document.createElement('div');
    titre.className = 'selected-player-name';
    titre.textContent = nom;
    identite.appendChild(titre);
    const sous = document.createElement('div');
    sous.className = 'selected-player-meta';
    const libellePos = typeof fzPositionLabel === 'function' ? fzPositionLabel(code) : code;
    sous.textContent = [libellePos, typeof fzStatBlurb === 'function' ? fzStatBlurb(rec, kind) : ''].filter(Boolean).join(' · ');
    identite.appendChild(sous);
    entete.appendChild(identite);
    corps.appendChild(entete);

    const actions = document.createElement('div');
    actions.className = 'selected-player-actions';
    if (fzPeutChoisir(code) && typeof fzBuildSelectButton === 'function') {
        actions.appendChild(fzBuildSelectButton(nom, code));
    }
    if (typeof fzBuildStarButton === 'function') actions.appendChild(fzBuildStarButton(nom));
    corps.appendChild(actions);

    // « Il vous manque » : catégories dont le quota n'est pas atteint,
    // valeurs déjà rendues dans #progressCard (draftActif.js) — pas de
    // recalcul, juste une lecture des mêmes compteurs affichés ailleurs.
    const manqueListe = document.createElement('div');
    manqueListe.className = 'selected-player-needs';
    const CATEGORIES = [
        { cle: 'offensive', libelle: 'Attaquants' },
        { cle: 'defensive', libelle: 'Défenseurs' },
        { cle: 'rookie', libelle: 'Recrue' },
        { cle: 'goalie', libelle: 'Gardien' }
    ];
    let auMoinsUn = false;
    CATEGORIES.forEach(cat => {
        const span = document.getElementById('count-' + cat.cle);
        if (!span) return;
        const [fait, total] = span.textContent.split('/').map(n => parseInt(n, 10));
        if (!Number.isFinite(fait) || !Number.isFinite(total) || fait >= total) return;
        auMoinsUn = true;
        const ligne = document.createElement('div');
        ligne.className = 'selected-player-need-row';
        const libelle = document.createElement('span');
        libelle.textContent = cat.libelle;
        ligne.appendChild(libelle);
        const valeur = document.createElement('span');
        valeur.textContent = fait + '/' + total;
        ligne.appendChild(valeur);
        manqueListe.appendChild(ligne);
    });
    if (auMoinsUn) {
        const titreManque = document.createElement('div');
        titreManque.className = 'selected-player-needs-title';
        titreManque.textContent = 'Il vous manque';
        corps.appendChild(titreManque);
        corps.appendChild(manqueListe);
    }
}

/**
 * Survol/focus, jamais clic : chaque rangée porte déjà .clickable-player-row
 * (draftActif.js), avec un gestionnaire de clic délégué sur `document` qui
 * ouvre la modale de carrière (showCareerStats). Un clic ici ouvrirait donc
 * les deux à la fois — la modale par-dessus la carte qu'on vient de remplir.
 * Le survol évite le conflit et reste au clavier via `focusin` (les rangées
 * sont déjà tabindex="0" pour la modale). */
function fzInitSelectedPlayerClicks() {
    const corps = document.querySelector('#playerTable tbody');
    if (!corps) return;
    const survoler = e => {
        const tr = e.target.closest('tr');
        if (!tr || tr.classList.contains('draft-empty-row')) return;
        const nom = typeof fzRowPlayerName === 'function' ? fzRowPlayerName(tr) : null;
        if (!nom || nom === fzJoueurAffiche) return;
        fzJoueurAffiche = nom;
        fzRenderSelectedPlayerCard();
        fzHighlightSelectedRow();
    };
    corps.addEventListener('mouseover', survoler);
    corps.addEventListener('focusin', survoler);
}

function fzHighlightSelectedRow() {
    document.querySelectorAll('#playerTable tbody tr').forEach(tr => {
        const nom = typeof fzRowPlayerName === 'function' ? fzRowPlayerName(tr) : null;
        tr.classList.toggle('fzd-selected-row', !!nom && nom === fzJoueurAffiche);
    });
}

/* ============================================================
   7. POINT D'ENTRÉE
   ============================================================ */

window.fzRefreshApercuExtras = function () {
    try { fzRenderSuggestionCard(); } catch (e) { console.error('[apercu] suggestion :', e); }
    try { fzRenderRecentPicksFeed(); } catch (e) { console.error('[apercu] derniers choix :', e); }
    try { fzRenderLineupCard(); } catch (e) { console.error('[apercu] alignement :', e); }
    try { fzRenderPositionSidebar(); } catch (e) { console.error('[apercu] sidebar position :', e); }
    try { fzApplyFavoritesOnlyFilter(); } catch (e) { console.error('[apercu] filtre favoris :', e); }
    // Rendre d'abord : sans sélection explicite, fzRenderSelectedPlayerCard()
    // retombe sur la suggestion et met fzJoueurAffiche à jour — la rangée à
    // surligner n'est donc connue qu'après cet appel, jamais avant.
    try { fzRenderSelectedPlayerCard(); } catch (e) { console.error('[apercu] joueur sélectionné :', e); }
    try { fzHighlightSelectedRow(); } catch (e) {}
};

document.addEventListener('DOMContentLoaded', () => {
    try { window.fzRefreshApercuExtras(); } catch (e) {}
    try { fzInitFavoritesOnlyToggle(); } catch (e) {}
    try { fzInitSelectedPlayerClicks(); } catch (e) {}
    const select = document.getElementById('playerFilter');
    if (select) select.addEventListener('change', () => { try { fzRenderPositionSidebar(); } catch (e) {} });
});
