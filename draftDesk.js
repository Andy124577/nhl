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
 *   barre du haut     puce du pool actif (poolNav.js) + navigation, et à
 *                     droite « Votre tour dans N choix »
 *   bande de tour     tuile du tour (C'est votre tour / Au tour de, choix,
 *                     chrono) · carrousel des choix sur tout le reste
 *   rail de gauche    FAVORIS / CHOIX — deux pastilles, une seule vue
 *   colonne centrale  Disponibles / Tous, filtres, liste des joueurs
 *   rail de droite    MON ALIGNEMENT + LIMITES D'ÉQUIPE
 *
 * Les deux rails ont échangé leur contenu. L'alignement ne bouge qu'à mes
 * propres choix — une fois par ronde : il part à droite, seul. Le rail de
 * gauche prend ce qu'on relit en boucle pendant qu'on repêche : la liste
 * de ses favoris, et celle de TOUS les choix du plus récent au plus
 * ancien. Une seule des deux à la fois, choisie par pastille (§1 bis).
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
 * Bande de tour : la tuile du tour à gauche, puis le carrousel des choix
 * sur tout le reste de la largeur, sous la barre du haut.
 *
 * La tuile est propre au bureau (fzDeskRenderTour la remplit) : le
 * bandeau de tour du téléphone (#turn-banner) et son chrono restent dans
 * .draft-header, que draftDesk.css masque ici. Le carrousel, lui, est le
 * même nœud sur les deux mises en page — on le déplace.
 */
function fzDeskMonterBande() {
    const entete = document.querySelector('.draft-header');
    if (!entete) return;

    const bande = fzDeskBoite('fzdStrip', 'fzd-strip', entete);
    if (!document.getElementById('fzdHero')) {
        // Le chrono change chaque seconde : la région annoncée aux lecteurs
        // d'écran est à part, et ne parle qu'au changement de tour.
        bande.insertAdjacentHTML('afterbegin', `
            <div class="fzd-hero" id="fzdHero">
                <div class="fzd-hero-top">
                    <span class="fzd-hero-kicker" id="fzdHeroKicker"></span>
                    <span class="fzd-hero-pick" id="fzdHeroPick"></span>
                </div>
                <div class="fzd-hero-mid">
                    <span class="fzd-hero-team" id="fzdHeroTeam"></span>
                    <span class="fzd-hero-clock" id="fzdHeroClock" hidden></span>
                </div>
                <span class="fzd-hero-label" id="fzdHeroLabel" hidden>Temps écoulé</span>
                <span class="sr-only" id="fzdHeroLive" role="status" aria-live="polite"></span>
            </div>`);
    }
    fzDeskDeplacer(document.querySelector('.recent-picks-card'), bande);
}

/* ---- Pastilles de position ------------------------------------- */

/** Les options de #playerFilter, en pastilles — code court de la maquette. */
const FZD_PASTILLES = [
    { valeur: 'all', court: 'JOU' },
    { valeur: 'offensive', court: 'ATT' },
    { valeur: 'defensive', court: 'DÉF' },
    { valeur: 'goalies', court: 'G' },
    { valeur: 'rookies', court: 'REC' },
    { valeur: 'teams', court: 'ÉQ' }
];

/**
 * Les pastilles remplacent le sélecteur de position sur bureau, sans le
 * remplacer dans le code : un clic écrit sa valeur dans #playerFilter et
 * émet son « change », exactement comme si on l'avait choisi dans la
 * liste. updateTable() et appliquerDisponibilite() (draftActifUI.js) ne
 * savent pas que les pastilles existent.
 */
function fzDeskMonterPastilles(filtres) {
    const select = document.getElementById('playerFilter');
    if (!filtres || !select) return;

    let groupe = document.getElementById('fzdPosChips');
    if (!groupe) {
        groupe = document.createElement('div');
        groupe.id = 'fzdPosChips';
        groupe.className = 'fzd-pos-chips';
        groupe.setAttribute('role', 'group');
        groupe.setAttribute('aria-label', 'Position');
        FZD_PASTILLES.forEach(({ valeur, court }) => {
            const bouton = document.createElement('button');
            bouton.type = 'button';
            bouton.className = 'fzd-pos-chip';
            bouton.dataset.valeur = valeur;
            bouton.textContent = court;
            groupe.appendChild(bouton);
        });
        groupe.addEventListener('click', e => {
            const bouton = e.target.closest('.fzd-pos-chip');
            if (!bouton || bouton.disabled || select.value === bouton.dataset.valeur) return;
            select.value = bouton.dataset.valeur;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        select.addEventListener('change', fzDeskSyncPastilles);
    }

    // Juste après la recherche, comme dans la maquette.
    const recherche = filtres.querySelector('.list-filters-search');
    if (recherche && recherche.nextSibling !== groupe) recherche.after(groupe);
    fzDeskSyncPastilles();
}

/** Reflète #playerFilter : la valeur choisie, et les positions pleines
 *  (option désactivée par appliquerDisponibilite). */
function fzDeskSyncPastilles() {
    const select = document.getElementById('playerFilter');
    if (!select) return;
    document.querySelectorAll('#fzdPosChips .fzd-pos-chip').forEach(bouton => {
        const option = [...select.options].find(o => o.value === bouton.dataset.valeur);
        const actif = select.value === bouton.dataset.valeur;
        bouton.hidden = !option;
        bouton.disabled = !option || option.disabled;
        bouton.classList.toggle('is-active', actif);
        bouton.setAttribute('aria-pressed', String(actif));
        const libelle = option ? option.textContent.trim() : '';
        bouton.setAttribute('aria-label', libelle);
        bouton.title = option && option.disabled ? 'Plus de place à cette position' : libelle;
    });
}

/**
 * Coquille de l'alignement — en-tête « MON ALIGNEMENT », corps qui
 * défile, pied « LIMITES D'ÉQUIPE ». Son contenu est rempli à chaque
 * rafraîchissement par fzDeskRenderRail().
 *
 * DEUX HÔTES, UNE SEULE COQUILLE. Sur bureau elle occupe le rail de
 * DROITE (#draftRail) à elle seule ; sous 1100px, la maquette
 * téléphone en fait l'onglet « Mon équipe », et elle passe dans
 * #lineupCard — la carte qui portait jusqu'ici une simple liste à plat
 * de mes choix, sans les cases vides ni les limites. Les ids sont
 * uniques : on DÉPLACE la coquille quand la fenêtre traverse le seuil
 * plutôt que d'en monter une seconde, ce qui casserait fzDeskRenderRail()
 * (qui les cherche par id) et les compteurs d'onglets qui lisent
 * #fzdRailCount.
 *
 * Elle vivait dans le rail de gauche (#fzSidebar) ; celui-ci porte
 * maintenant les favoris et les choix (§1 bis). Le rail de droite est
 * monté par fzDeskApply() AVANT cet appel — d'où l'ordre, là-bas.
 */
function fzDeskMonterRail() {
    const hote = fzDeskEstBureau() ? document.getElementById('draftRail')
                                   : document.getElementById('lineupCard');
    if (!hote) return null;

    const tete = document.getElementById('fzdRailHead');
    if (!tete) {
        // En queue des deux hôtes : sous « Sauter ce tour » dans le rail,
        // sous l'en-tête de la carte (que draftPhone.css masque).
        // Le titre est un sélecteur : « Mon équipe » par défaut, mais on peut
        // regarder l'alignement de n'importe quelle équipe du pool pendant le
        // repêchage — savoir ce que les autres ont pris décide souvent du
        // prochain choix.
        hote.insertAdjacentHTML('beforeend', `
            <div class="fzd-rail-head" id="fzdRailHead">
                <label class="fzd-rail-title" for="fzdRailTeam" id="fzdRailTitle">Alignement</label>
                <span class="fzd-rail-count" id="fzdRailCount"></span>
            </div>
            <div class="fzd-rail-picker" id="fzdRailPicker">
                <select id="fzdRailTeam" class="fzd-rail-select"></select>
                <button type="button" class="fzd-rail-back" id="fzdRailBack" hidden>Revenir à mon équipe</button>
            </div>
            <div class="fzd-rail-body" id="fzdRosterList"></div>
            <div class="fzd-rail-foot" id="fzdRailFoot">
                <span class="fzd-rail-title">Limites d'équipe</span>
                <div class="fzd-limits" id="fzdLimits"></div>
            </div>`);
        return hote;
    }

    if (tete.parentNode !== hote) {
        hote.append(...[tete,
                        document.getElementById('fzdRailPicker'),
                        document.getElementById('fzdRosterList'),
                        document.getElementById('fzdRailFoot')].filter(Boolean));
    }
    return hote;
}

/** L'équipe dont le rail montre l'alignement ; null = la mienne. */
let fzDeskEquipeVue = null;

/** Les équipes qui repêchent, dans l'ordre du premier tour. */
function fzDeskEquipesDuPool() {
    const donnees = (typeof draftData !== 'undefined' && draftData) ? draftData : {};
    const ordre = Array.isArray(donnees.draftOrder) ? donnees.draftOrder : [];
    const vues = [...new Set(ordre)];
    Object.entries(donnees.teams || {}).forEach(([nom, e]) => {
        if (!vues.includes(nom) && e && (e.members || []).length) vues.push(nom);
    });
    return vues;
}

/** Remplit le sélecteur d'équipe sans perdre le choix en cours. */
function fzDeskRenderSelecteur(me, cible) {
    const select = document.getElementById('fzdRailTeam');
    if (!select) return;
    const equipes = fzDeskEquipesDuPool();
    const cle = equipes.join('|') + '#' + (me || '');
    if (select.dataset.cle !== cle) {
        select.replaceChildren(...equipes.map(nom => {
            const opt = document.createElement('option');
            opt.value = nom;
            opt.textContent = nom === me ? `${nom} (vous)` : nom;
            return opt;
        }));
        select.dataset.cle = cle;
    }
    if (cible) select.value = cible;
    select.setAttribute('aria-label', "Voir l'alignement de l'équipe");

    const autre = !!(cible && me && cible !== me);
    const titre = document.getElementById('fzdRailTitle');
    if (titre) titre.textContent = autre ? 'Alignement adverse' : 'Mon alignement';
    const retour = document.getElementById('fzdRailBack');
    if (retour) retour.hidden = !autre;
    document.getElementById('fzdRailHead')?.classList.toggle('is-other', autre);
    document.getElementById('fzdRailPicker')?.classList.toggle('is-other', autre);
    const pied = document.getElementById('fzdRailFoot');
    if (pied) pied.hidden = autre;

    if (!select.dataset.branche) {
        select.dataset.branche = '1';
        select.addEventListener('change', () => {
            fzDeskEquipeVue = select.value === me ? null : select.value;
            fzDeskRenderRail();
        });
        document.getElementById('fzdRailBack')?.addEventListener('click', () => {
            fzDeskEquipeVue = null;
            fzDeskRenderRail();
        });
    }
}

/* ============================================================
   1 bis. RAIL DE GAUCHE — FAVORIS / CHOIX
   ------------------------------------------------------------
   Une colonne, deux vues, une pastille chacune : « Favoris », les
   joueurs qu'on s'est mis de côté à l'étoile de la liste, et
   « Choix », tout le repêchage à l'envers — le dernier choix en
   haut. Une seule des deux affichée à la fois (patron ARIA tablist,
   comme les onglets de draftActifUI.js).

   Rien n'est calculé ici non plus. Les favoris viennent de
   fzGetFavorites() (draftFavorites.js), leur ordre de valeur de
   fzPointsCandidat() — la même mesure que le favori proposé dans le
   bandeau de tour — et les choix de buildPickSlots()
   (draftPickCards.js), la fonction qui numérote déjà les cartes de la
   bande du haut : c'est elle qui sait qu'un tour sauté décale
   picksHistory, donc qu'un choix ne porte pas son rang d'historique.
   ============================================================ */

const FZD_COTE_VUES = ['favoris', 'choix'];
let fzDeskCoteVue = 'favoris';

/**
 * Monte le panneau dans le rail de poolNav. Bureau seulement : sous
 * 1100px, poolNav.css met .fz-sidebar à display:none et la maquette
 * téléphone garde ses propres cartes (#recentPicksFeed pour les choix,
 * l'étoile du tableau pour les favoris) — rien à déplacer, rien à
 * dupliquer.
 */
function fzDeskMonterCote() {
    if (!fzDeskEstBureau()) return null;
    const hote = document.getElementById('fzSidebar');
    if (!hote) return null;
    hote.classList.add('fz-sidebar--draft');
    if (document.getElementById('fzdSide')) return hote;

    // En tête du rail : ce qui restait du contenu de poolNav (bloc du pool
    // actif, gestion) est masqué par draftDesk.css, mais un rail déjà monté
    // au moment du basculement peut encore le porter.
    hote.insertAdjacentHTML('afterbegin', `
        <div class="fzd-side" id="fzdSide">
            <div class="fzd-side-tabs" id="fzdSideTabs" role="tablist"
                 aria-label="Favoris ou choix du repêchage">
                <button type="button" class="fzd-side-tab is-active" id="fzdSideTabFavoris"
                        role="tab" data-vue="favoris" aria-selected="true"
                        aria-controls="fzdSideFavoris" tabindex="0">
                    <span class="fzd-side-tab-label">Favoris</span>
                    <span class="fzd-side-tab-count" id="fzdSideCountFavoris" hidden></span>
                </button>
                <button type="button" class="fzd-side-tab" id="fzdSideTabChoix"
                        role="tab" data-vue="choix" aria-selected="false"
                        aria-controls="fzdSideChoix" tabindex="-1">
                    <span class="fzd-side-tab-label">Choix</span>
                    <span class="fzd-side-tab-count" id="fzdSideCountChoix" hidden></span>
                </button>
            </div>
            <div class="fzd-side-panel" id="fzdSideFavoris" role="tabpanel"
                 aria-labelledby="fzdSideTabFavoris" tabindex="0"></div>
            <div class="fzd-side-panel" id="fzdSideChoix" role="tabpanel"
                 aria-labelledby="fzdSideTabChoix" tabindex="0" hidden></div>
        </div>`);

    const pistes = document.getElementById('fzdSideTabs');
    pistes.addEventListener('click', e => {
        const pastille = e.target.closest('.fzd-side-tab');
        if (pastille) fzDeskCoteActiver(pastille.dataset.vue, false);
    });
    // Un seul arrêt de tabulation dans la piste (tabindex baladeur), les
    // flèches déplacent le focus et activent la vue visée — même patron que
    // les onglets de draftActifUI.js.
    pistes.addEventListener('keydown', e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const n = FZD_COTE_VUES.length;
        const i = FZD_COTE_VUES.indexOf(fzDeskCoteVue);
        const cible = e.key === 'Home' ? 0
            : e.key === 'End' ? n - 1
            : (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n;
        fzDeskCoteActiver(FZD_COTE_VUES[cible], true);
    });

    fzDeskCoteAppliquer(false);
    return hote;
}

function fzDeskCoteActiver(vue, focus) {
    if (!FZD_COTE_VUES.includes(vue)) return;
    fzDeskCoteVue = vue;
    fzDeskCoteAppliquer(focus);
}

/** Une pastille active, un panneau visible — les deux listes restent
 *  rendues, seul le `hidden` change : basculer ne coûte rien et la vue
 *  cachée est déjà à jour quand on y revient. */
function fzDeskCoteAppliquer(focus) {
    document.querySelectorAll('#fzdSideTabs .fzd-side-tab').forEach(pastille => {
        const actif = pastille.dataset.vue === fzDeskCoteVue;
        pastille.classList.toggle('is-active', actif);
        pastille.setAttribute('aria-selected', String(actif));
        pastille.tabIndex = actif ? 0 : -1;
        if (actif && focus) pastille.focus();
        const panneau = document.getElementById(pastille.getAttribute('aria-controls'));
        if (panneau) panneau.hidden = !actif;
    });
}

/** Message d'attente des deux vues — même habillage que les cartes de
 *  l'aperçu (.no-picks, draftActif-premium.css). */
function fzDeskCoteVide(texte) {
    const p = document.createElement('p');
    p.className = 'no-picks fzd-side-empty';
    p.textContent = texte;
    return p;
}

function fzDeskCoteCompte(id, n) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = n > 0 ? String(n) : '';
    el.hidden = !(n > 0);
}

/* ---- Favoris ---------------------------------------------------- */

/**
 * Mes favoris encore repêchables, du meilleur au moins bon
 * (fzPointsCandidat, draftFavorites.js — la même mesure que le favori
 * proposé dans le bandeau de tour).
 *
 * Un joueur pris par n'importe quelle équipe SORT de la liste : cette
 * colonne sert à choisir le prochain nom, et un favori qu'on ne peut plus
 * repêcher n'y répond plus. La liste ne fait que rétrécir, sans qu'on ait
 * à la nettoyer à la main. Le favori lui-même n'est pas effacé du
 * stockage — c'est un filtre d'affichage, pas un retrait : si le choix est
 * annulé, le nom revient de lui-même.
 *
 * Les positions déjà comblées restent : une liste à consulter n'est pas
 * une suggestion, et voir un attaquant qu'on ne peut plus prendre
 * AUJOURD'HUI reste utile.
 *
 * Une fiche introuvable ne fait pas sauter la ligne : le nom et son étoile
 * suffisent à la retirer, ce qu'un favori escamoté interdirait.
 */
function fzDeskFavoris() {
    const noms = typeof fzGetFavorites === 'function' ? fzGetFavorites() : [];
    const pris = typeof fzPickedSet === 'function' ? fzPickedSet() : new Set();

    const lignes = noms
        .filter(nom => !pris.has(nom))
        .map(nom => {
            const trouve = typeof fzFindRecord === 'function' ? fzFindRecord(nom) : null;
            return {
                nom,
                trouve,
                rec: trouve ? trouve.rec : null,
                kind: trouve ? trouve.kind : null,
                code: trouve && typeof fzPositionCode === 'function'
                    ? fzPositionCode(trouve.rec, trouve.kind) : null
            };
        });

    const valeur = f => (f.rec && typeof fzPointsCandidat === 'function')
        ? fzPointsCandidat(f.rec, f.kind) : -1;
    return lignes.sort((a, b) => valeur(b) - valeur(a));
}

function fzDeskBuildFavori(f) {
    const el = document.createElement('div');
    el.className = 'fzd-fav-row';

    // La même étoile que la colonne Action du tableau : un seul stockage,
    // un seul comportement, et retirer un favori d'ici le retire partout.
    if (typeof fzBuildStarButton === 'function') el.appendChild(fzBuildStarButton(f.nom));

    const pastille = document.createElement('span');
    pastille.className = 'fzd-fav-photo';
    if (f.trouve && typeof fzPhotoAndLogo === 'function') {
        const { photo, logo } = fzPhotoAndLogo(f.nom, f.rec, f.kind);
        const src = f.kind === 'team' ? photo : (photo || logo);
        if (src) {
            const img = document.createElement('img');
            img.src = src; img.alt = ''; img.loading = 'lazy';
            img.addEventListener('error', () => img.remove());
            pastille.appendChild(img);
        }
    }
    el.appendChild(pastille);

    const txt = document.createElement('span');
    txt.className = 'fzd-fav-txt';
    const nom = document.createElement('span');
    nom.className = 'fzd-fav-name';
    nom.textContent = f.nom;
    nom.title = f.nom;
    txt.appendChild(nom);

    const meta = document.createElement('span');
    meta.className = 'fzd-fav-meta';
    if (f.code) meta.appendChild(fzDeskBuildTag(f.code));
    const details = [
        fzDeskAbbrev(f.nom, f.trouve),
        f.rec && typeof fzStatBlurb === 'function' ? fzStatBlurb(f.rec, f.kind) : ''
    ].filter(Boolean).join(' · ');
    if (details) {
        const ligne = document.createElement('span');
        ligne.className = 'fzd-fav-line';
        ligne.textContent = details;
        meta.appendChild(ligne);
    }
    txt.appendChild(meta);
    el.appendChild(txt);

    // Bouton de sélection aux mêmes conditions que la carte Suggestion
    // (fzPeutChoisir, draftApercuExtra.js) : c'est mon tour, mon équipe
    // n'est pas complète, et la position ne l'est pas non plus. Un bouton
    // qui mènerait à un refus du serveur ne doit pas être proposé.
    if (f.code
        && typeof fzPeutChoisir === 'function' && fzPeutChoisir(f.code)
        && typeof fzBuildSelectButton === 'function') {
        const action = document.createElement('span');
        action.className = 'fzd-fav-action';
        action.appendChild(fzBuildSelectButton(f.nom, f.code));
        el.appendChild(action);
    }

    return el;
}

function fzDeskRenderFavoris() {
    const zone = document.getElementById('fzdSideFavoris');
    if (!zone) return;

    const favoris = fzDeskFavoris();
    zone.replaceChildren();
    if (!favoris.length) {
        zone.appendChild(fzDeskCoteVide(
            'Aucun favori. L’étoile de la liste des joueurs en ajoute.'));
    } else {
        favoris.forEach(f => zone.appendChild(fzDeskBuildFavori(f)));
    }
    // La liste ne porte plus que du repêchable : sa longueur EST le
    // chiffre qu'on regarde pendant qu'on repêche.
    fzDeskCoteCompte('fzdSideCountFavoris', favoris.length);
}

/* ---- Choix ------------------------------------------------------ */

/**
 * Tous les tours joués, du plus récent au plus ancien. Même découpage que
 * la bande du haut (buildPickSlots) : un tour par position de draftOrder,
 * donc le numéro affiché est bien « Choix N » du repêchage et non le rang
 * dans picksHistory, que les tours sautés décalent. Les tours sautés sont
 * gardés — sans eux, la suite des numéros ferait des trous inexpliqués.
 */
function fzDeskChoix() {
    const donnees = (typeof draftData !== 'undefined' && draftData) ? draftData : {};
    const historique = Array.isArray(donnees.picksHistory) ? donnees.picksHistory : [];
    const ordre = Array.isArray(donnees.draftOrder) ? donnees.draftOrder : [];
    const index = Number.isInteger(donnees.currentPickIndex) ? donnees.currentPickIndex : 0;
    const tours = (ordre.length && typeof buildPickSlots === 'function')
        ? buildPickSlots(ordre, historique, index)
        // Ordre pas encore généré : au moins les choix déjà faits, comme le
        // repli de renderPickCarousel().
        : (typeof buildPickSlotsFromHistory === 'function'
            ? buildPickSlotsFromHistory(historique)
            : historique.map(pick => ({ equipePool: pick.team, pick, etat: 'done' })));

    const faits = [];
    tours.forEach((tour, i) => {
        if (tour.etat !== 'done' && tour.etat !== 'skipped') return;
        faits.push({
            equipePool: tour.equipePool,
            pick: tour.pick,
            etat: tour.etat,
            numero: i + 1,
            ronde: typeof fzRondeDe === 'function' ? fzRondeDe(i, donnees) : 0
        });
    });
    return faits.reverse();
}

function fzDeskBuildChoix(tour, moi) {
    const aMoi = !!moi && tour.equipePool === moi;
    const el = document.createElement('div');
    el.className = 'fzd-pick-row'
        + (tour.etat === 'skipped' ? ' is-skipped' : '')
        + (aMoi ? ' is-me' : '');

    const numero = document.createElement('span');
    numero.className = 'fzd-pick-num';
    numero.textContent = String(tour.numero);
    numero.title = tour.ronde ? 'Ronde ' + tour.ronde : '';
    el.appendChild(numero);

    const corps = document.createElement('div');
    corps.className = 'fzd-pick-body';

    const proprio = document.createElement('span');
    proprio.className = 'fzd-pick-owner';
    proprio.textContent = aMoi ? 'Vous' : (tour.equipePool || '');
    proprio.title = tour.equipePool || '';
    corps.appendChild(proprio);

    if (tour.pick) {
        const ligne = document.createElement('div');
        ligne.className = 'fzd-pick-player';

        const nomJoueur = tour.pick.player || '';
        const trouve = typeof fzFindRecord === 'function' ? fzFindRecord(nomJoueur) : null;

        const pastille = document.createElement('span');
        pastille.className = 'fzd-pick-photo';
        if (trouve && typeof fzPhotoAndLogo === 'function') {
            const { photo, logo } = fzPhotoAndLogo(nomJoueur, trouve.rec, trouve.kind);
            const src = trouve.kind === 'team' ? photo : (photo || logo);
            if (src) {
                const img = document.createElement('img');
                img.src = src; img.alt = ''; img.loading = 'lazy';
                img.addEventListener('error', () => img.remove());
                pastille.appendChild(img);
            }
        }
        ligne.appendChild(pastille);

        const txt = document.createElement('span');
        txt.className = 'fzd-pick-txt';
        const nom = document.createElement('span');
        nom.className = 'fzd-pick-name';
        nom.textContent = nomJoueur;
        nom.title = nomJoueur;
        txt.appendChild(nom);

        const meta = document.createElement('span');
        meta.className = 'fzd-pick-meta';
        const code = trouve && typeof fzPositionCode === 'function'
            ? fzPositionCode(trouve.rec, trouve.kind) : null;
        if (code) meta.appendChild(fzDeskBuildTag(code));
        const abbrev = fzDeskAbbrev(nomJoueur, trouve);
        if (abbrev) {
            const equipe = document.createElement('span');
            equipe.className = 'fzd-pick-abbr';
            equipe.textContent = abbrev;
            meta.appendChild(equipe);
        }
        txt.appendChild(meta);
        ligne.appendChild(txt);
        corps.appendChild(ligne);
    } else {
        const saute = document.createElement('span');
        saute.className = 'fzd-pick-skip';
        saute.textContent = 'Tour sauté — équipe complète';
        corps.appendChild(saute);
    }

    el.appendChild(corps);
    return el;
}

function fzDeskRenderChoix() {
    const zone = document.getElementById('fzdSideChoix');
    if (!zone) return;

    const moi = typeof getUserTeam === 'function' ? getUserTeam() : null;
    const choix = fzDeskChoix();

    zone.replaceChildren();
    if (!choix.length) {
        zone.appendChild(fzDeskCoteVide('Aucun choix pour l’instant.'));
    } else {
        choix.forEach(tour => zone.appendChild(fzDeskBuildChoix(tour, moi)));
    }
    fzDeskCoteCompte('fzdSideCountChoix', choix.filter(t => t.etat === 'done').length);
}

function fzDeskRenderCote() {
    fzDeskRenderFavoris();
    fzDeskRenderChoix();
}

function fzDeskApply() {
    if (fzDeskEnPlace) return;
    const conteneur = document.querySelector('.draft-main-container');
    const centre = document.querySelector('.draft-center');
    const carteListe = document.querySelector('.player-selection-card');
    if (!conteneur || !centre || !carteListe) return;

    fzDeskMonterBande();

    // Colonne de droite : l'alignement, et rien d'autre que le bouton qui
    // le concerne. « Sauter ce tour » en tête : draftActifUI.js l'avait
    // rangé dans la piste des onglets, qui n'a plus rien à porter ici (les
    // onglets sont masqués sur bureau). Déplacé AVANT la coquille pour
    // arriver en premier — un appendChild qui suit se range derrière lui.
    //
    // Deux cartes de l'aperçu ne montent plus ici : « Derniers choix »
    // (#recentPicksFeed), dont le rail de gauche donne maintenant la liste
    // ENTIÈRE du plus récent au plus ancien (§1 bis), et « Suggestion »
    // (#suggestionCard). Toutes deux restent où elles sont, dans
    // .draft-sidebar, que draftDesk.css masque en bloc sur bureau — la
    // maquette téléphone les garde intactes dans son onglet « Choix ».
    const droite = fzDeskBoite('draftRail', 'draft-rail', conteneur);
    fzDeskDeplacer(document.getElementById('turn-skip-btn'), droite);

    // Après le rail, jamais avant : la coquille de l'alignement s'y range
    // en queue, et fzDeskMonterRail() a besoin qu'il existe.
    fzDeskMonterRail();

    // La colonne de filtres devient la bande de la maquette : recherche,
    // pastilles de position, tri.
    const filtres = document.getElementById('listFiltersSidebar');
    if (filtres) fzDeskDeplacer(filtres, carteListe, carteListe.firstElementChild);
    fzDeskMonterPastilles(filtres);

    // Les onglets « Disponibles / Tous » prennent la place de ceux de la
    // maquette, au-dessus des filtres.
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
    const moi = typeof getUserTeam === 'function' ? getUserTeam() : null;
    const donnees = (typeof draftData !== 'undefined' && draftData) ? draftData : null;
    // L'équipe affichée : la mienne, sauf si on a choisi d'en regarder une autre.
    const me = (fzDeskEquipeVue && donnees && donnees.teams && donnees.teams[fzDeskEquipeVue])
        ? fzDeskEquipeVue : moi;
    const equipe = (me && donnees && donnees.teams && donnees.teams[me]) || {};
    const cfg = (donnees && donnees.config)
        || { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1, numTeams: 1 };
    const historique = (donnees && donnees.picksHistory) || [];

    // Ronde de chacun de mes choix, pour la méta « EDM · R1 » des places.
    // L'indice du tour (pickIndex), pas le rang dans l'historique : un tour
    // sauté décalerait tout ce qui suit.
    const rondes = {};
    historique.forEach((pick, i) => {
        if (!me || pick.team !== me || typeof fzRondeDe !== 'function') return;
        const ronde = fzRondeDe(Number.isInteger(pick.pickIndex) ? pick.pickIndex : i, donnees);
        if (ronde) rondes[pick.player] = ronde;
    });

    const defs = [
        { cle: 'offensive', label: 'Attaquants', court: 'ATT', noms: equipe.offensive || [], max: cfg.numOffensive ?? 6, videCode: 'AT' },
        { cle: 'defensive', label: 'Défenseurs', court: 'DÉF', noms: equipe.defensive || [], max: cfg.numDefensive ?? 4, videCode: 'D' },
        { cle: 'goalie', label: 'Gardiens', court: 'GAR', noms: equipe.goalie || [], max: cfg.numGoalies ?? 1, videCode: 'G' },
        { cle: 'rookie', label: 'Recrues', court: 'REC', noms: equipe.rookie || [], max: cfg.numRookies ?? 1, videCode: 'Rec' },
        { cle: 'team', label: 'Équipes NHL', court: 'ÉQ', noms: equipe.teams || [], max: cfg.numTeams ?? 1, videCode: 'Éq' },
        // Le banc du tête-à-tête : n'importe quelle position, sauf un club.
        { cle: 'bench', label: 'Banc', court: 'BANC', videCode: 'Banc',
          noms: (equipe.bench || []).map(b => (typeof b === 'string' ? b : b && b.nom)).filter(Boolean),
          max: typeof window.fzQuotaBanc === 'function' ? window.fzQuotaBanc(donnees) : 0 }
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

    // Une section par catégorie. Recrues et équipes de la LNH partageaient
    // un seul intertitre (« 2 » pour une recrue et un club) : on lisait
    // « 2 recrues » là où on ne pouvait en choisir qu'une.
    const groupes = defs
        .map(d => ({ label: d.label, have: d.have, of: d.max, slots: d.slots }))
        .filter(g => g.of > 0);

    return { defs, groupes, total, equipeVue: me, moi };
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

    const { defs, groupes, total, equipeVue, moi } = fzDeskRoster();
    fzDeskRenderSelecteur(moi, equipeVue);

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

/* ---- « 76 PJ · 44 B · 86 A » ----
   Sur téléphone, la maquette n'a pas de colonnes de chiffres : les
   trois premières passent sur la ligne de méta, sous le nom. On relit
   ce que populateTable() a déjà écrit dans les cellules et l'en-tête
   qu'elle a posé au-dessus — jamais la fiche du joueur, sinon la vue
   « Gardiens » (PJ · V · D) et la vue « Équipes » n'y retrouveraient
   pas leurs chiffres. draftPhone.css seul la montre ; sur bureau les
   colonnes sont là et la ligne reste masquée. */
const FZ_DESK_STAT_ABBR = {
    'GP': 'PJ', 'G': 'B', 'A': 'A', 'PTS': 'PTS',
    'W': 'V', 'L': 'D', 'OTL': 'DP', 'SV%': 'SV%', 'SO': 'BL',
    'Victoires': 'V', 'Défaites': 'D', 'Points': 'PTS'
};

function fzDeskStatLine(tr, entetes) {
    const morceaux = [];
    for (let i = 2; i < tr.children.length && morceaux.length < 3; i++) {
        const cell = tr.children[i];
        if (cell.classList.contains('points-column')
            || cell.classList.contains('action-column')) break;
        const valeur = cell.textContent.trim();
        if (!valeur) continue;
        const titre = entetes[i] ? entetes[i].textContent.trim() : '';
        const abrege = FZ_DESK_STAT_ABBR[titre] || titre;
        morceaux.push(abrege ? valeur + ' ' + abrege : valeur);
    }
    return morceaux.join(' · ');
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
    // Lu une fois : l'en-tête est le même pour toutes les rangées, et
    // la liste en compte plusieurs centaines.
    const entetes = [...document.querySelectorAll('#playerTable thead th')];
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
        const chiffres = fzDeskStatLine(tr, entetes);
        if (chiffres) {
            const ligne = document.createElement('span');
            ligne.className = 'fzd-name-line';
            ligne.textContent = chiffres;
            meta.appendChild(ligne);
        }

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
   4. LE TOUR — TUILE DE LA BANDE ET PASTILLE DE LA BARRE DU HAUT
   ------------------------------------------------------------
   Deux lectures du même état : la tuile à gauche du carrousel dit
   qui est au bâton (« C'est votre tour » / « Au tour de »), à quel
   choix, et depuis combien de temps ; la pastille de la barre du
   haut dit dans combien de choix vient le mien.

   Rien n'est recalculé : l'équipe au bâton est draftOrder
   [currentPickIndex], le décompte suit picksUntilMyTurn()
   (draftActif.js) et la ronde fzRondeDe() (draftPickCards.js).
   ============================================================ */

/** Durée du « C'est votre tour » qui s'allume (éclair + reflet), après
 *  quoi la tuile ne fait plus que pulser. */
const FZD_ARRIVEE_MS = 4200;

let fzDeskTourPrecedent = null;
let fzDeskMinuteurArrivee = null;
let fzDeskHorloge = null;
let fzDeskAnnonce = '';

function fzDeskEtatTour() {
    const donnees = (typeof draftData !== 'undefined' && draftData) ? draftData : {};
    const ordre = Array.isArray(donnees.draftOrder) ? donnees.draftOrder : [];
    if (!ordre.length) return { etat: 'attente' };

    const total = ordre.length;
    const index = Math.min(Number.isInteger(donnees.currentPickIndex) ? donnees.currentPickIndex : 0, total);
    const fini = index >= total
        || (typeof checkIfAllTeamsAreDone === 'function' && checkIfAllTeamsAreDone());
    if (fini) return { etat: 'fini', total };

    const moi = typeof getUserTeam === 'function' ? getUserTeam() : null;
    const complet = typeof checkIfUserTeamIsDone === 'function' && checkIfUserTeamIsDone();
    const prochain = moi && !complet ? ordre.indexOf(moi, index) : -1;

    return {
        etat: 'enCours',
        total,
        index,
        equipe: ordre[index] || '',
        moi,
        complet,
        monTour: !complet && typeof isUserTurn === 'function' && isUserTurn(),
        avant: prochain >= 0 ? prochain - index : -1,
        ronde: typeof fzRondeDe === 'function'
            ? fzRondeDe(index, donnees)
            : Math.floor(index / (new Set(ordre).size || 1)) + 1,
        depart: Number(donnees.turnStartedAt) || 0
    };
}

/** 0:42, 12:05, 1:03:27 — puis en jours et heures : un tour laissé en
 *  plan tout un week-end ne s'affiche pas en « 4320:00 ». */
function fzDeskFormatHorloge(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const deux = n => String(n).padStart(2, '0');
    const jours = Math.floor(s / 86400);
    const heures = Math.floor(s / 3600) % 24;
    const minutes = Math.floor(s / 60) % 60;
    if (jours) return `${jours} j ${heures} h`;
    if (heures) return `${heures}:${deux(minutes)}:${deux(s % 60)}`;
    return `${minutes}:${deux(s % 60)}`;
}

function fzDeskTicTac() {
    const horloge = document.getElementById('fzdHeroClock');
    const t = fzDeskTourPrecedent;
    if (!horloge || !t || t.etat !== 'enCours' || !t.depart) return;
    horloge.textContent = fzDeskFormatHorloge(Date.now() - t.depart);
}

function fzDeskDemarrerHorloge(actif) {
    if (actif && !fzDeskHorloge) fzDeskHorloge = setInterval(fzDeskTicTac, 1000);
    if (!actif && fzDeskHorloge) { clearInterval(fzDeskHorloge); fzDeskHorloge = null; }
}

function fzDeskEteindreTuile(tuile) {
    clearTimeout(fzDeskMinuteurArrivee);
    tuile.classList.remove('is-arriving');
    tuile.querySelectorAll('.fzd-hero-flash, .fzd-hero-sweep').forEach(el => el.remove());
}

/** Le tour vient de m'arriver : un éclair blanc, un reflet qui balaie la
 *  tuile, puis la pulsation reprend (draftDesk.css, .is-arriving). */
function fzDeskAllumerTuile(tuile) {
    fzDeskEteindreTuile(tuile);
    tuile.insertAdjacentHTML('afterbegin',
        '<span class="fzd-hero-flash" aria-hidden="true"></span>'
        + '<span class="fzd-hero-sweep" aria-hidden="true"></span>');
    tuile.classList.add('is-arriving');
    fzDeskMinuteurArrivee = setTimeout(() => fzDeskEteindreTuile(tuile), FZD_ARRIVEE_MS);
}

function fzDeskRenderTuile(t, precedent) {
    const tuile = document.getElementById('fzdHero');
    if (!tuile) return;
    const kicker = document.getElementById('fzdHeroKicker');
    const choix = document.getElementById('fzdHeroPick');
    const equipe = document.getElementById('fzdHeroTeam');
    const horloge = document.getElementById('fzdHeroClock');
    const legende = document.getElementById('fzdHeroLabel');

    const enCours = t.etat === 'enCours';
    const monTour = enCours && t.monTour;
    tuile.classList.toggle('is-mine', monTour);
    tuile.classList.toggle('is-idle', !enCours);

    if (t.etat === 'attente') {
        kicker.textContent = 'Repêchage';
        choix.textContent = '';
        equipe.textContent = 'Pas commencé';
    } else if (t.etat === 'fini') {
        kicker.textContent = 'Repêchage';
        choix.textContent = `${t.total} choix`;
        equipe.textContent = 'Terminé';
    } else {
        kicker.textContent = monTour ? "C'est votre tour" : 'Au tour de';
        choix.textContent = `Choix ${t.index + 1}/${t.total}${t.ronde ? ' · R' + t.ronde : ''}`;
        equipe.textContent = monTour ? 'Vous' : t.equipe;
    }
    equipe.title = enCours && !monTour ? t.equipe : '';

    const chrono = enCours && !!t.depart;
    horloge.hidden = !chrono;
    legende.hidden = !chrono;

    // L'équipe au bâton change : son nom monte en place. Pas au premier
    // rendu, où rien ne « change ».
    if (enCours && precedent && precedent.etat === 'enCours' && precedent.equipe !== t.equipe) {
        equipe.classList.remove('is-new');
        void equipe.offsetWidth;
        equipe.classList.add('is-new');
    }
    if (monTour && !(precedent && precedent.monTour)) fzDeskAllumerTuile(tuile);
    else if (!monTour) fzDeskEteindreTuile(tuile);

    // Annoncé une fois par tour, jamais à chaque seconde du chrono.
    const annonce = !enCours ? '' : monTour
        ? `C'est votre tour. Choix ${t.index + 1} sur ${t.total}.`
        : `Au tour de ${t.equipe}. Choix ${t.index + 1} sur ${t.total}.`;
    if (annonce !== fzDeskAnnonce) {
        fzDeskAnnonce = annonce;
        const direct = document.getElementById('fzdHeroLive');
        if (direct) direct.textContent = annonce;
    }
}

/** « Votre tour dans N choix », à droite de la barre du haut. */
function fzDeskRenderPastilleNav(t) {
    const droite = document.querySelector('.navbar-desktop .navbar-right');
    if (!droite) return;
    let pastille = document.getElementById('fzdNavTurn');
    if (!pastille) {
        pastille = document.createElement('span');
        pastille.id = 'fzdNavTurn';
        pastille.className = 'fzd-nav-turn';
    }
    // En tête de la rangée, devant la cloche que notifications.js y
    // insère elle aussi en tête — possiblement après nous.
    if (droite.firstElementChild !== pastille) droite.prepend(pastille);

    let texte = '';
    if (t.etat === 'fini') texte = 'Repêchage terminé';
    else if (t.etat === 'enCours' && t.moi) {
        if (t.monTour) texte = "C'est votre tour";
        else if (t.complet) texte = 'Alignement complet';
        else if (t.avant > 0) texte = `Votre tour dans ${t.avant} choix`;
    }
    pastille.textContent = texte;
    pastille.hidden = !texte;
    pastille.classList.toggle('is-mine', t.etat === 'enCours' && !!t.monTour);
}

function fzDeskRenderTour() {
    const t = fzDeskEtatTour();
    const precedent = fzDeskTourPrecedent;
    fzDeskTourPrecedent = t;

    document.body.classList.toggle('fzd-my-turn', t.etat === 'enCours' && !!t.monTour);
    fzDeskRenderTuile(t, precedent);
    fzDeskRenderPastilleNav(t);
    fzDeskTicTac();
    fzDeskDemarrerHorloge(t.etat === 'enCours' && !!t.depart && fzDeskEstBureau());
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
    // La coquille de l'alignement change d'hôte avec le mode.
    try { fzDeskMonterRail(); } catch (e) { console.error('[bureau] alignement :', e); }
    try { fzDeskMonterCote(); } catch (e) { console.error('[bureau] favoris/choix :', e); }
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
    try { fzDeskRenderCote(); } catch (e) { console.error('[bureau] favoris/choix :', e); }
    try { fzDeskRenderTour(); } catch (e) { console.error('[bureau] tour :', e); }
    try { fzDeskSyncPastilles(); } catch (e) { console.error('[bureau] pastilles :', e); }
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
    // La coquille de l'alignement, elle, n'attend plus personne : ses deux
    // hôtes existent déjà à ce moment (#draftRail, monté par fzDeskApply ;
    // #lineupCard, écrit dans le HTML). Seul le panneau favoris/choix
    // dépend du rail de poolNav.
    try { fzDeskMonterRail(); fzDeskRenderRail(); } catch (e) { console.error('[bureau] rail :', e); }

    const monterCote = () => {
        try { fzDeskMonterCote(); fzDeskRenderCote(); }
        catch (e) { console.error('[bureau] favoris/choix :', e); }
    };
    monterCote();
    if (document.getElementById('fzSidebar')) return;
    const observateur = new MutationObserver(() => {
        if (!document.getElementById('fzSidebar')) return;
        observateur.disconnect();
        monterCote();
    });
    observateur.observe(document.body, { childList: true });
}

/**
 * Poser ou retirer une étoile ne passe pas par refreshDraftViews() :
 * fzToggleFavorite() (draftFavorites.js) rappelle directement
 * window.fzRefreshFavoritesUI, qui ne connaît que la colonne Action du
 * tableau et le bandeau de tour. Sans ce relais, la liste du rail restait
 * celle d'avant le clic — y compris quand le clic venait de sa propre
 * étoile.
 *
 * Emballée plutôt que remplacée : la version d'origine garde la main sur
 * ce qu'elle rendait déjà, et refreshDraftViews() n'a rien à savoir de
 * plus (elle relit window[nom] à chaque passage).
 */
function fzDeskBrancherFavoris() {
    const origine = window.fzRefreshFavoritesUI;
    window.fzRefreshFavoritesUI = function () {
        if (typeof origine === 'function') origine.apply(this, arguments);
        try { fzDeskRenderFavoris(); } catch (e) { console.error('[bureau] favoris :', e); }
    };
}

document.addEventListener('DOMContentLoaded', () => {
    document.body.dataset.fzRail = 'page';
    try { fzDeskBrancherFavoris(); } catch (e) {}
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
