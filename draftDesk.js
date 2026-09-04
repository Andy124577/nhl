/**
 * Salle de repêchage — mise en page bureau.
 *
 * Sur téléphone, draftActifUI.js range la page en deux onglets
 * (« Aperçu » / « Liste des joueurs ») : la place manque pour montrer
 * les deux à la fois. Au-delà de 769px elle ne manque plus, et les
 * onglets ne faisaient plus que cacher la moitié de ce qu'on veut
 * avoir sous les yeux pendant qu'on repêche.
 *
 * Ce fichier réarrange les cartes déjà présentes dans la page en trois
 * colonnes (voir draftDesk.css) et enrichit les rangées du tableau —
 * portrait agrandi, pastille de position colorée. Il ne calcule rien :
 * aucune donnée de repêchage ne passe par ici, il déplace des nœuds et
 * pose des classes. Les moindres décisions (qui est disponible, à qui
 * est le tour, quels favoris) restent chez draftActif.js,
 * draftFavorites.js et draftApercuExtra.js.
 *
 * Tout est réversible : sous 769px, fzDeskUndo() remet chaque carte à
 * sa place d'origine et les onglets reprennent la main. Redimensionner
 * la fenêtre suffit, sans rechargement.
 */

/* ============================================================
   1. RÉAGENCEMENT DES COLONNES
   ------------------------------------------------------------
   Chaque déplacement note d'où vient le nœud (parent + frère
   suivant) pour pouvoir être défait dans l'ordre inverse.
   ============================================================ */

/** Déplacements en cours, du premier au dernier. */
const fzDeskDeplacements = [];
let fzDeskEnPlace = false;

function fzDeskDeplacer(el, parent, avant) {
    if (!el || !parent || el.parentNode === null) return;
    fzDeskDeplacements.push({ el, parent: el.parentNode, suivant: el.nextSibling });
    if (avant && avant.parentNode === parent) parent.insertBefore(el, avant);
    else parent.appendChild(el);
}

/**
 * Sous-titres de la colonne « Ma progression » : les deux vues y sont
 * empilées (la glace, puis les barres), il faut donc dire laquelle est
 * laquelle. Posés une seule fois — le CSS les cache sous 769px, où la
 * bascule Glace/Liste redevient la règle.
 */
function fzDeskPoserSousTitres() {
    const glace = document.getElementById('progressIceView');
    const liste = document.getElementById('progressListView');
    if (glace && !glace.previousElementSibling?.classList?.contains('fzd-sub-title')) {
        const t = document.createElement('div');
        t.className = 'fzd-sub-title';
        t.textContent = 'Sur la glace';
        glace.parentNode.insertBefore(t, glace);
    }
    if (liste && !liste.previousElementSibling?.classList?.contains('fzd-sub-title')) {
        const t = document.createElement('div');
        t.className = 'fzd-sub-title fzd-sub-title--liste';
        t.textContent = 'Par position';
        liste.parentNode.insertBefore(t, liste);
    }
}

/**
 * Rappel affiché dans « Mes favoris » quand le tour arrive : la carte
 * est alors juste au-dessus du tableau, avec ses boutons de sélection
 * déjà en place (draftFavorites.js).
 */
function fzDeskPoserRappelFavoris() {
    const carte = document.getElementById('favoritesCard');
    if (!carte || carte.querySelector('.fzd-fav-hint')) return;
    const p = document.createElement('p');
    p.className = 'fzd-fav-hint';
    p.textContent = "C'est votre tour — choisissez directement dans vos favoris.";
    const entete = carte.querySelector('.card-header');
    if (entete) entete.insertAdjacentElement('afterend', p);
    else carte.prepend(p);
}

function fzDeskApply() {
    if (fzDeskEnPlace) return;
    const conteneur = document.querySelector('.draft-main-container');
    const centre = document.querySelector('.draft-center');
    const carteListe = document.querySelector('.player-selection-card');
    if (!conteneur || !centre || !carteListe) return;

    let rail = document.getElementById('draftRail');
    if (!rail) {
        rail = document.createElement('div');
        rail.id = 'draftRail';
        rail.className = 'draft-rail';
        conteneur.appendChild(rail);
    }

    // Colonne 3 : ce qui commente le repêchage sans servir à choisir.
    ['suggestionCard', 'selectedPlayerCard', 'recentPicksFeed'].forEach(id => {
        fzDeskDeplacer(document.getElementById(id), rail);
    });

    // Colonne 2 : les favoris juste au-dessus de la liste des joueurs.
    fzDeskDeplacer(document.getElementById('favoritesCard'), centre, carteListe);

    // La colonne de filtres devient une bande au-dessus du tableau.
    const filtres = document.getElementById('listFiltersSidebar');
    if (filtres) {
        const blocPositions = filtres.querySelector('.list-filters-positions')?.closest('.list-filters-block');
        // Doublon des pastilles de catégorie, juste en dessous.
        if (blocPositions) blocPositions.classList.add('fzd-desk-hidden');
        fzDeskDeplacer(filtres, carteListe, carteListe.firstElementChild);
    }

    fzDeskEnPlace = true;
}

function fzDeskUndo() {
    if (!fzDeskEnPlace) return;
    while (fzDeskDeplacements.length) {
        const m = fzDeskDeplacements.pop();
        m.parent.insertBefore(m.el, m.suivant);
    }
    fzDeskEnPlace = false;
}

/* ============================================================
   2. ÉTIQUETTES DE POSITION ET PORTRAIT
   ------------------------------------------------------------
   populateTable() (draftActif.js) écrit déjà le libellé de position
   en toutes lettres dans la cellule du nom. On ne le remplace pas :
   on le garde (caché) comme source de vérité et on ajoute à côté une
   pastille au code court, colorée par position — c'est la couleur
   qui se lit en premier dans une liste de plusieurs centaines de
   lignes. Le libellé complet reste dans le title et l'aria-label,
   la couleur ne porte donc jamais l'information toute seule.
   ============================================================ */

/** Code court et libellé de chaque position. `data-pos` sert de
 *  sélecteur de couleur dans draftDesk.css. */
const FZ_DESK_POSITIONS = {
    C: { pos: 'C', court: 'C', libelle: 'Centre' },
    L: { pos: 'L', court: 'AG', libelle: 'Ailier gauche' },
    R: { pos: 'R', court: 'AD', libelle: 'Ailier droit' },
    D: { pos: 'D', court: 'D', libelle: 'Défenseur' },
    G: { pos: 'G', court: 'G', libelle: 'Gardien' },
    '*': { pos: 'star', court: 'Rec', libelle: 'Recrue' },
    T: { pos: 'T', court: 'Éq', libelle: 'Équipe de la LNH' }
};

/**
 * Position réelle d'une rangée. Le libellé écrit par populateTable()
 * est prioritaire : c'est celui de la catégorie affichée, et lui seul
 * sait qu'un joueur compte comme recrue dans la vue « Recrues ». On ne
 * redescend à la fiche que pour distinguer les trois postes d'attaque,
 * que le libellé réunit sous « Attaquant ».
 */
function fzDeskRowCode(tr) {
    if (tr.dataset && tr.dataset.isgoalie === 'true') return 'G';

    const etiquette = tr.querySelector('.player-pos');
    const libelle = etiquette ? etiquette.textContent.trim() : '';
    if (libelle === 'Défenseur') return 'D';
    if (libelle === 'Gardien') return 'G';
    if (libelle === 'Recrue') return '*';
    if (libelle === 'Équipe de la LNH') return 'T';

    const nom = typeof fzRowPlayerName === 'function' ? fzRowPlayerName(tr) : null;
    const trouve = nom && typeof fzFindRecord === 'function' ? fzFindRecord(nom) : null;
    if (!trouve) return libelle === 'Attaquant' ? 'C' : 'T';
    if (trouve.kind === 'goalie') return 'G';
    if (trouve.kind === 'team') return 'T';
    const brut = trouve.rec.positionCode;
    return FZ_DESK_POSITIONS[brut] ? brut : 'C';
}

/** Abréviation d'équipe affichée sous le nom — celle des statistiques
 *  courantes de préférence, sinon la dernière de la fiche. */
function fzDeskTeamAbbr(nom, trouve) {
    if (!trouve) return '';
    if (trouve.kind === 'team') {
        return typeof getTeamAbbreviation === 'function' ? (getTeamAbbreviation(nom) || '') : '';
    }
    const stats = typeof getCurrentPlayerStats === 'function'
        ? getCurrentPlayerStats(nom, trouve.rec.playerId) : null;
    if (stats && stats.teamAbbrev) return stats.teamAbbrev;
    const brut = trouve.rec.teamAbbrevs;
    if (!brut || brut === 'null') return '';
    return String(brut).split(',').pop().trim();
}

function fzDeskBuildTag(code) {
    const info = FZ_DESK_POSITIONS[code] || FZ_DESK_POSITIONS.C;
    const tag = document.createElement('span');
    tag.className = 'fzd-pos-tag';
    tag.dataset.pos = info.pos;
    tag.textContent = info.court;
    tag.title = info.libelle;
    tag.setAttribute('aria-label', info.libelle);
    return tag;
}

/**
 * Cellule du nom réécrite en deux lignes : le nom, puis l'équipe et la
 * pastille de position. Le contenu d'origine (nom, badge de blessure,
 * libellé de position) est déplacé tel quel dans la première ligne —
 * rien n'est reconstruit, donc rien ne peut diverger de ce que
 * populateTable() a écrit.
 */
function fzDeskDecorateRows() {
    document.querySelectorAll('#playerTable tbody tr').forEach(tr => {
        if (tr.classList.contains('draft-empty-row')) return;
        const cellule = tr.children[1];
        if (!cellule || cellule.querySelector('.fzd-name-main')) return;

        // Les rangées d'équipes LNH n'ont pas de data-playername :
        // fzRowPlayerName() y retombe sur le texte de cette cellule, qui
        // porterait ensuite l'abréviation et la pastille. On fige le nom
        // en data-* AVANT de toucher au contenu.
        const nom = typeof fzRowPlayerName === 'function' ? fzRowPlayerName(tr) : null;
        if (!nom) return;
        if (!tr.dataset.playername) tr.dataset.playername = nom;

        const code = fzDeskRowCode(tr);
        const trouve = typeof fzFindRecord === 'function' ? fzFindRecord(nom) : null;

        const principal = document.createElement('span');
        principal.className = 'fzd-name-main';
        while (cellule.firstChild) principal.appendChild(cellule.firstChild);

        const meta = document.createElement('span');
        meta.className = 'fzd-name-meta';
        const abbrev = fzDeskTeamAbbr(nom, trouve);
        if (abbrev) {
            const equipe = document.createElement('span');
            equipe.className = 'fzd-team-abbr';
            equipe.textContent = abbrev;
            meta.appendChild(equipe);
        }
        meta.appendChild(fzDeskBuildTag(code));

        cellule.classList.add('fzd-name-cell');
        cellule.append(principal, meta);
    });
}

/* ============================================================
   3. MES FAVORIS QUAND LE TOUR ARRIVE
   ------------------------------------------------------------
   Les favoris se posent hors de son tour, à l'étoile de la colonne
   Action (draftFavorites.js). Ce qui manquait, c'est de les
   retrouver au moment où ils servent : la carte est maintenant
   juste au-dessus de la liste, et elle se déplie d'elle-même quand
   le tour arrive plutôt que d'attendre un clic de plus.
   ============================================================ */

/** Choix pour lequel les groupes ont déjà été dépliés — sinon chaque
 *  rafraîchissement rouvrirait ce qu'on vient de replier. */
let fzDeskTourDeplie = null;

function fzDeskFavorisTour() {
    const carte = document.getElementById('favoritesCard');
    if (!carte) return;

    const monTour = typeof isUserTurn === 'function' && isUserTurn()
        && !(typeof checkIfUserTeamIsDone === 'function' && checkIfUserTeamIsDone());
    carte.classList.toggle('is-my-turn', monTour);

    if (!monTour) { fzDeskTourDeplie = null; return; }

    const choix = (typeof draftData !== 'undefined' && draftData) ? draftData.currentPickIndex : null;
    if (fzDeskTourDeplie === choix) return;
    fzDeskTourDeplie = choix;

    carte.querySelectorAll('.favorite-group:not(.is-open)').forEach(bloc => {
        bloc.classList.add('is-open');
        const poignee = bloc.querySelector('.favorite-group-header');
        const corps = bloc.querySelector('.favorite-group-body');
        if (poignee) poignee.setAttribute('aria-expanded', 'true');
        if (corps) corps.hidden = false;
    });
}

/* ============================================================
   4. BASCULE BUREAU / TÉLÉPHONE
   ============================================================ */

function fzDeskEstBureau() {
    return typeof window.fzEstBureau === 'function'
        ? window.fzEstBureau()
        : window.matchMedia('(min-width: 769px)').matches;
}

function fzDeskSync() {
    if (fzDeskEstBureau()) fzDeskApply();
    else fzDeskUndo();
    // Les onglets posent (ou retirent) leurs display en ligne selon le
    // mode : c'est leur propre fonction qui sait lesquels, on la rejoue.
    if (typeof window.fzApplyPanelTabs === 'function') window.fzApplyPanelTabs();
}

/* ============================================================
   5. POINT D'ENTRÉE
   ------------------------------------------------------------
   Ajouté à la liste `rendus` de refreshDraftViews() (draftRefresh.js),
   comme les autres couches d'affichage.
   ============================================================ */

window.fzRefreshDeskUI = function () {
    try { fzDeskDecorateRows(); } catch (e) { console.error('[bureau] rangées :', e); }
    try { fzDeskFavorisTour(); } catch (e) { console.error('[bureau] favoris du tour :', e); }
};

/**
 * Même raison que fzWatchPlayerTable() (draftFavorites.js) : changer de
 * catégorie, chercher ou trier reconstruit `#playerTable tbody` sans
 * repasser par refreshDraftViews(). On observe donc l'effet plutôt que
 * la chaîne d'appels. `childList` sans `subtree` : réécrire une cellule
 * ne mute pas `tbody`, aucune boucle possible.
 */
function fzDeskWatchTable() {
    const corps = document.querySelector('#playerTable tbody');
    if (!corps) return;
    const observateur = new MutationObserver(() => {
        try { fzDeskDecorateRows(); } catch (e) { console.error('[bureau] rangées :', e); }
    });
    observateur.observe(corps, { childList: true });
}

document.addEventListener('DOMContentLoaded', () => {
    try { fzDeskPoserSousTitres(); } catch (e) {}
    try { fzDeskPoserRappelFavoris(); } catch (e) {}
    try { fzDeskSync(); } catch (e) { console.error('[bureau] mise en page :', e); }
    try { fzDeskWatchTable(); } catch (e) {}
    try { window.fzRefreshDeskUI(); } catch (e) {}

    const mq = window.matchMedia('(min-width: 769px)');
    const surChangement = () => {
        try { fzDeskSync(); } catch (e) { console.error('[bureau] mise en page :', e); }
        try { window.fzRefreshDeskUI(); } catch (e) {}
    };
    if (mq.addEventListener) mq.addEventListener('change', surChangement);
    else if (mq.addListener) mq.addListener(surChangement);
});
