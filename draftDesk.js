/**
 * Salle de repêchage — mise en page bureau.
 *
 * Sur téléphone, draftActifUI.js range la page en deux onglets
 * (« Aperçu » / « Liste des joueurs ») : la place manque pour montrer
 * les deux à la fois. Au-delà de 1100px elle ne manque plus, et les
 * onglets ne faisaient plus que cacher la moitié de ce qu'on veut
 * avoir sous les yeux pendant qu'on repêche.
 *
 * Plan de la maquette (Repechage.dc.html), de haut en bas :
 *
 *   barre du haut     puce du pool actif (poolNav.js) + navigation
 *   bande de tour     chrono · équipe au bâton · carrousel des choix
 *   rail de gauche    MON ALIGNEMENT (défile) + LIMITES D'ÉQUIPE (au bas)
 *   colonne centrale  panneau de tour, filtres, liste des joueurs
 *   rail de droite    suggestion + derniers choix
 *
 * Le rail de gauche est celui de poolNav.js (#fzSidebar) : cette page
 * le reprend à son compte via `document.body.dataset.fzRail = 'page'`,
 * et le sélecteur de pool qui y vivait passe dans la barre du haut.
 *
 * Ce fichier ne calcule aucune donnée de repêchage : il déplace des
 * nœuds, pose des classes, et relit `draftData` exactement comme
 * updateProgressCounter() (draftActif.js) le fait déjà — jamais un
 * second quota. Tout est réversible : sous 1100px, fzDeskUndo() remet
 * chaque carte à sa place et les onglets reprennent la main.
 */

/* Posé avant que poolNav.js ne monte le rail (il attend FZPool.ready(),
   donc au minimum une micro-tâche plus tard). */
if (document.body) document.body.dataset.fzRail = 'page';

/* ============================================================
   1. RÉAGENCEMENT
   ------------------------------------------------------------
   Chaque déplacement note d'où vient le nœud (parent + frère
   suivant) pour pouvoir être défait dans l'ordre inverse.
   ============================================================ */

const fzDeskDeplacements = [];
let fzDeskEnPlace = false;

function fzDeskDeplacer(el, parent, avant) {
    if (!el || !parent || el.parentNode === null) return;
    fzDeskDeplacements.push({ el, parent: el.parentNode, suivant: el.nextSibling });
    if (avant && avant.parentNode === parent) parent.insertBefore(el, avant);
    else parent.appendChild(el);
}

/** Crée un élément une fois pour toutes et le retrouve ensuite par son id. */
function fzDeskBoite(id, classe, parent, avant) {
    let el = document.getElementById(id);
    if (el) return el;
    el = document.createElement('div');
    el.id = id;
    el.className = classe;
    if (avant && avant.parentNode === parent) parent.insertBefore(el, avant);
    else if (parent) parent.appendChild(el);
    return el;
}

/**
 * Bande de tour : le chrono, l'équipe au bâton et le carrousel des
 * choix sur une seule ligne pleine largeur, sous la barre du haut.
 *
 * Les trois blocs existent déjà, dispersés dans .draft-header — on ne
 * fait que les rassembler. #turn-clock et #dop-round sortent du
 * bandeau de tour pour former le bloc chrono de gauche ; le panneau
 * (#turn-banner-hero : « N choix avant vous », ce qui manque, le
 * bouton) part au sommet de la colonne centrale, où la maquette met
 * son bandeau d'alerte.
 */
function fzDeskMonterBande() {
    const entete = document.querySelector('.draft-header');
    const centre = document.querySelector('.draft-center');
    if (!entete) return;

    const bande = fzDeskBoite('fzdStrip', 'fzd-strip', entete);
    const chrono = fzDeskBoite('fzdClock', 'fzd-clock', bande);
    if (!chrono.querySelector('.fzd-clock-label')) {
        const lbl = document.createElement('span');
        lbl.className = 'fzd-clock-label';
        lbl.textContent = 'Temps écoulé';
        chrono.appendChild(lbl);
    }

    fzDeskDeplacer(document.getElementById('dop-round'), chrono);
    fzDeskDeplacer(document.getElementById('turn-clock'), chrono);
    fzDeskDeplacer(document.getElementById('turn-banner'), bande);
    fzDeskDeplacer(document.querySelector('.recent-picks-card'), bande);
    if (centre) {
        fzDeskDeplacer(document.getElementById('turn-banner-hero'), centre, centre.firstElementChild);
    }
}

/**
 * Rail de gauche. Sa coquille (en-tête, corps qui défile, pied) est
 * construite ici ; son contenu est rempli à chaque rafraîchissement
 * par fzDeskRenderRail().
 */
function fzDeskMonterRail() {
    const rail = document.getElementById('fzSidebar');
    if (!rail) return null;
    rail.classList.add('fz-sidebar--draft');

    if (!document.getElementById('fzdRailHead')) {
        rail.insertAdjacentHTML('afterbegin', `
            <div class="fzd-rail-head" id="fzdRailHead">
                <span class="fzd-rail-title">Mon alignement</span>
                <span class="fzd-rail-count" id="fzdRailCount"></span>
            </div>
            <div class="fzd-rail-body" id="fzdRosterList"></div>
            <div class="fzd-rail-foot" id="fzdRailFoot">
                <span class="fzd-rail-title">Limites d'équipe</span>
                <div class="fzd-limits" id="fzdLimits"></div>
            </div>`);
    }
    return rail;
}

function fzDeskApply() {
    if (fzDeskEnPlace) return;
    const conteneur = document.querySelector('.draft-main-container');
    const centre = document.querySelector('.draft-center');
    const carteListe = document.querySelector('.player-selection-card');
    if (!conteneur || !centre || !carteListe) return;

    fzDeskMonterBande();
    fzDeskMonterRail();

    // Colonne de droite : ce qui commente le repêchage sans servir à choisir.
    const droite = fzDeskBoite('draftRail', 'draft-rail', conteneur);
    ['suggestionCard', 'recentPicksFeed'].forEach(id => {
        fzDeskDeplacer(document.getElementById(id), droite);
    });

    // Colonne centrale : les favoris juste au-dessus de la liste.
    fzDeskDeplacer(document.getElementById('favoritesCard'), centre, carteListe);

    // La colonne de filtres devient la bande de la maquette : pastilles
    // de position à gauche, recherche et équipe à droite.
    const filtres = document.getElementById('listFiltersSidebar');
    if (filtres) fzDeskDeplacer(filtres, carteListe, carteListe.firstElementChild);

    // Les onglets « Disponibles / Tous les choix / Mes choix » prennent la
    // place des onglets de la maquette, au-dessus des filtres.
    const onglets = document.getElementById('availabilityTabs');
    if (onglets && filtres) fzDeskDeplacer(onglets, carteListe, filtres);

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
   2. ALIGNEMENT ET LIMITES D'ÉQUIPE
   ------------------------------------------------------------
   Une seule lecture de draftData sert les deux vues du rail : la
   liste des places (remplies ou libres) en haut, les barres de quota
   en bas. Mêmes tableaux et mêmes quotas que updateProgressCounter()
   (draftActif.js) et fzBuildIceSlots() (draftApercuExtra.js) — la
   répartition change, jamais le compte.
   ============================================================ */

function fzDeskRoster() {
    const me = typeof getUserTeam === 'function' ? getUserTeam() : null;
    const donnees = (typeof draftData !== 'undefined' && draftData) ? draftData : null;
    const equipe = (me && donnees && donnees.teams && donnees.teams[me]) || {};
    const cfg = (donnees && donnees.config)
        || { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1, numTeams: 1 };
    const nbEquipes = (donnees && donnees.teams) ? Object.keys(donnees.teams).length : 0;
    const historique = (donnees && donnees.picksHistory) || [];

    // Ronde de chacun de mes choix, pour la méta « EDM · R1 » des places.
    const rondes = {};
    historique.forEach((pick, i) => {
        if (me && pick.team === me && nbEquipes > 0) rondes[pick.player] = Math.floor(i / nbEquipes) + 1;
    });

    const defs = [
        { cle: 'offensive', label: 'Attaquants', court: 'ATT', noms: equipe.offensive || [], max: cfg.numOffensive ?? 6, videCode: 'AT' },
        { cle: 'defensive', label: 'Défenseurs', court: 'DÉF', noms: equipe.defensive || [], max: cfg.numDefensive ?? 4, videCode: 'D' },
        { cle: 'goalie', label: 'Gardiens', court: 'GAR', noms: equipe.goalie || [], max: cfg.numGoalies ?? 1, videCode: 'G' },
        { cle: 'rookie', label: 'Recrues', court: 'REC', noms: equipe.rookie || [], max: cfg.numRookies ?? 1, videCode: 'Rec' },
        { cle: 'team', label: 'Équipes', court: 'ÉQ', noms: equipe.teams || [], max: cfg.numTeams ?? 1, videCode: 'Éq' }
    ].map(d => {
        const slots = [];
        for (let i = 0; i < d.max; i++) {
            const nom = d.noms[i] || null;
            const trouve = nom && typeof fzFindRecord === 'function' ? fzFindRecord(nom) : null;
            const code = trouve && typeof fzPositionCode === 'function'
                ? fzPositionCode(trouve.rec, trouve.kind) : null;
            slots.push({
                nom,
                trouve,
                code: code ? (typeof fzCodeAffiche === 'function' ? fzCodeAffiche(code) : code) : d.videCode,
                ronde: nom ? rondes[nom] : null
            });
        }
        return { ...d, slots, have: Math.min(d.noms.length, d.max) };
    });

    const total = defs.reduce((s, d) => ({ have: s.have + d.have, of: s.of + d.max }), { have: 0, of: 0 });

    // La maquette réunit recrues et équipes sous un seul intertitre : ce
    // sont les deux places « à part » du roster, et séparées elles
    // n'auraient souvent qu'une ligne chacune.
    const parCle = Object.fromEntries(defs.map(d => [d.cle, d]));
    const groupes = [
        { label: 'Attaquants', have: parCle.offensive.have, of: parCle.offensive.max, slots: parCle.offensive.slots },
        { label: 'Défenseurs', have: parCle.defensive.have, of: parCle.defensive.max, slots: parCle.defensive.slots },
        { label: 'Gardiens', have: parCle.goalie.have, of: parCle.goalie.max, slots: parCle.goalie.slots },
        {
            label: 'Recrues · Équipes',
            have: parCle.rookie.have + parCle.team.have,
            of: parCle.rookie.max + parCle.team.max,
            slots: [...parCle.rookie.slots, ...parCle.team.slots]
        }
    ].filter(g => g.of > 0);

    return { defs, groupes, total };
}

/** Abréviation d'équipe d'une fiche — celle des statistiques courantes
 *  de préférence, sinon la dernière de la fiche. */
function fzDeskAbbrev(nom, trouve) {
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

function fzDeskBuildSlot(slot) {
    const el = document.createElement('div');
    el.className = 'fzd-slot' + (slot.nom ? '' : ' is-empty');

    const pastille = document.createElement('span');
    pastille.className = 'fzd-slot-avatar';
    if (slot.trouve && typeof fzPhotoAndLogo === 'function') {
        const { photo, logo } = fzPhotoAndLogo(slot.nom, slot.trouve.rec, slot.trouve.kind);
        const src = slot.trouve.kind === 'team' ? photo : (photo || logo);
        if (src) {
            const img = document.createElement('img');
            img.src = src; img.alt = ''; img.loading = 'lazy';
            img.addEventListener('error', () => img.remove());
            pastille.appendChild(img);
        }
    }
    el.appendChild(pastille);

    const txt = document.createElement('span');
    txt.className = 'fzd-slot-txt';
    const nom = document.createElement('span');
    nom.className = 'fzd-slot-name';
    nom.textContent = slot.nom || 'Libre';
    txt.appendChild(nom);
    const meta = document.createElement('span');
    meta.className = 'fzd-slot-meta';
    meta.textContent = slot.nom
        ? [fzDeskAbbrev(slot.nom, slot.trouve), slot.ronde ? 'R' + slot.ronde : ''].filter(Boolean).join(' · ')
        : 'À combler';
    txt.appendChild(meta);
    el.appendChild(txt);

    const code = document.createElement('span');
    code.className = 'fzd-slot-pos';
    code.textContent = slot.code || '';
    el.appendChild(code);

    return el;
}

function fzDeskRenderRail() {
    const liste = document.getElementById('fzdRosterList');
    const limites = document.getElementById('fzdLimits');
    const compte = document.getElementById('fzdRailCount');
    if (!liste || !limites) return;

    const { defs, groupes, total } = fzDeskRoster();

    if (compte) compte.textContent = total.of > 0 ? `${total.have}/${total.of}` : '';

    liste.replaceChildren();
    groupes.forEach(g => {
        const bloc = document.createElement('div');
        bloc.className = 'fzd-group';

        const entete = document.createElement('div');
        entete.className = 'fzd-group-head';
        const label = document.createElement('span');
        label.className = 'fzd-group-label';
        label.textContent = g.label;
        entete.appendChild(label);
        const n = document.createElement('span');
        n.className = 'fzd-group-count';
        n.textContent = `${g.have}/${g.of}`;
        n.classList.toggle('is-full', g.have >= g.of);
        n.classList.toggle('is-empty', g.have === 0);
        entete.appendChild(n);
        bloc.appendChild(entete);

        const corps = document.createElement('div');
        corps.className = 'fzd-group-slots';
        g.slots.forEach(s => corps.appendChild(fzDeskBuildSlot(s)));
        bloc.appendChild(corps);

        liste.appendChild(bloc);
    });

    limites.replaceChildren();
    [...defs.map(d => ({ court: d.court, have: d.have, of: d.max })),
     { court: 'Total', have: total.have, of: total.of }]
        .filter(l => l.of > 0)
        .forEach(l => {
            const cell = document.createElement('div');
            cell.className = 'fzd-limit';

            const ligne = document.createElement('div');
            ligne.className = 'fzd-limit-line';
            const lbl = document.createElement('span');
            lbl.className = 'fzd-limit-label';
            lbl.textContent = l.court;
            const val = document.createElement('span');
            val.className = 'fzd-limit-value';
            val.textContent = `${l.have}/${l.of}`;
            ligne.append(lbl, val);
            cell.appendChild(ligne);

            const piste = document.createElement('div');
            piste.className = 'fzd-limit-track';
            const barre = document.createElement('div');
            barre.className = 'fzd-limit-fill';
            barre.classList.toggle('is-full', l.have >= l.of);
            barre.style.width = Math.round((l.have / l.of) * 100) + '%';
            piste.appendChild(barre);
            cell.appendChild(piste);

            limites.appendChild(cell);
        });
}

/* ============================================================
   3. RANGÉES DU TABLEAU
   ------------------------------------------------------------
   La maquette sépare le rang du portrait : une colonne RANG étroite,
   puis une colonne JOUEUR qui porte le portrait, le nom, l'équipe et
   la pastille de position.

   Aucune colonne n'est ajoutée pour autant — le rang est déjà rendu
   par le ::before de la première cellule (draftActif.css) : il suffit
   d'en sortir le portrait et de l'emmener dans la cellule du nom.
   Ajouter un vrai <td> aurait décalé toutes les règles qui visent une
   colonne par son rang (#playerTable.cat-goalies td:nth-child(6)…) et
   l'en-tête que updateTable() réécrit à chaque changement de vue.
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
 * Cellule du nom réécrite : portrait, puis le nom et, dessous,
 * l'équipe et la pastille de position. Le contenu d'origine (nom,
 * badge de blessure, libellé de position) est déplacé tel quel dans la
 * première ligne — rien n'est reconstruit, donc rien ne peut diverger
 * de ce que populateTable() a écrit.
 */
function fzDeskDecorateRows() {
    document.querySelectorAll('#playerTable tbody tr').forEach(tr => {
        if (tr.classList.contains('draft-empty-row')) return;
        const photoCell = tr.children[0];
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
        const abbrev = fzDeskAbbrev(nom, trouve);
        if (abbrev) {
            const equipe = document.createElement('span');
            equipe.className = 'fzd-team-abbr';
            equipe.textContent = abbrev;
            meta.appendChild(equipe);
        }
        meta.appendChild(fzDeskBuildTag(code));

        const txt = document.createElement('span');
        txt.className = 'fzd-name-txt';
        txt.append(principal, meta);

        // Le portrait rejoint la colonne JOUEUR ; la première cellule ne
        // garde que son rang. Les rangées d'équipes portent l'écusson en
        // <img> direct, les autres une boîte .player-photo.
        const portrait = photoCell
            ? (photoCell.querySelector('.player-photo') || photoCell.querySelector('img'))
            : null;

        // Le portrait et le texte s'alignent dans une boîte à eux, pas
        // directement dans le <td> : un display:flex posé sur une cellule
        // la sort de la mise en page du tableau et les colonnes ne
        // s'alignent plus d'une rangée à l'autre.
        const inner = document.createElement('div');
        inner.className = 'fzd-name-inner';
        if (portrait) inner.appendChild(portrait);
        inner.appendChild(txt);

        cellule.classList.add('fzd-name-cell');
        cellule.appendChild(inner);
    });
}

/* ============================================================
   4. MES FAVORIS QUAND LE TOUR ARRIVE
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
    document.body.classList.toggle('fzd-my-turn', monTour);

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
   5. BASCULE BUREAU / TÉLÉPHONE
   ============================================================ */

function fzDeskEstBureau() {
    return typeof window.fzEstBureau === 'function'
        ? window.fzEstBureau()
        : window.matchMedia('(min-width: 1100px)').matches;
}

function fzDeskSync() {
    if (fzDeskEstBureau()) fzDeskApply();
    else fzDeskUndo();
    // Les onglets posent (ou retirent) leurs display en ligne selon le
    // mode : c'est leur propre fonction qui sait lesquels, on la rejoue.
    if (typeof window.fzApplyPanelTabs === 'function') window.fzApplyPanelTabs();
}

/* ============================================================
   6. POINT D'ENTRÉE
   ------------------------------------------------------------
   Ajouté à la liste `rendus` de refreshDraftViews() (draftRefresh.js),
   comme les autres couches d'affichage.
   ============================================================ */

window.fzRefreshDeskUI = function () {
    try { fzDeskDecorateRows(); } catch (e) { console.error('[bureau] rangées :', e); }
    try { fzDeskRenderRail(); } catch (e) { console.error('[bureau] rail :', e); }
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

/**
 * poolNav.js construit la puce du pool actif (#fzNavbarPool) au moment
 * où il monte la barre du haut, c'est-à-dire après FZPool.ready() —
 * bien après ce DOMContentLoaded. Le rail, lui, est marqué comme repris
 * par la page dès le chargement du script (en tête de fichier) ; il ne
 * reste qu'à poser sa coquille quand poolNav l'a créé.
 */
function fzDeskWatchRail() {
    if (document.getElementById('fzSidebar')) { fzDeskMonterRail(); fzDeskRenderRail(); return; }
    const observateur = new MutationObserver(() => {
        if (!document.getElementById('fzSidebar')) return;
        observateur.disconnect();
        try { fzDeskMonterRail(); fzDeskRenderRail(); } catch (e) { console.error('[bureau] rail :', e); }
    });
    observateur.observe(document.body, { childList: true });
}

document.addEventListener('DOMContentLoaded', () => {
    document.body.dataset.fzRail = 'page';
    try { fzDeskSync(); } catch (e) { console.error('[bureau] mise en page :', e); }
    try { fzDeskWatchRail(); } catch (e) {}
    try { fzDeskWatchTable(); } catch (e) {}
    try { window.fzRefreshDeskUI(); } catch (e) {}

    const mq = window.matchMedia('(min-width: 1100px)');
    const surChangement = () => {
        try { fzDeskSync(); } catch (e) { console.error('[bureau] mise en page :', e); }
        try { window.fzRefreshDeskUI(); } catch (e) {}
    };
    if (mq.addEventListener) mq.addEventListener('change', surChangement);
    else if (mq.addListener) mq.addListener(surChangement);
});
