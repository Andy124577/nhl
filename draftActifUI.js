/**
 * Couche d'interface du repêchage.
 *
 * Règle de conception : ce fichier ne contient AUCUNE logique de repêchage.
 * Il se contente de piloter des contrôles déjà en place —
 * `#playerFilter`, `#progressFilter`, `showProgressDetails()` — puis laisse
 * draftActif.js faire son travail. Une sélection de joueur, un envoi au
 * serveur ou une mise à jour socket ne passent jamais par ici.
 *
 * C'est ce qui permet d'ajouter les onglets et le dépliage par position
 * sans toucher à draftActif.js, qui est minifié et gère le draft en direct.
 */

/* ============================================================
   0. LARGEUR — bureau ou téléphone
   ------------------------------------------------------------
   Un seul seuil pour toute la salle de repêchage : au-dessus, tout
   est affiché à la fois en trois colonnes (draftDesk.css) ; en
   dessous, les onglets « Aperçu » / « Liste des joueurs » se
   partagent l'écran. draftDesk.js s'y réfère aussi, d'où window.

   1100px, et pas 769 : c'est le seuil auquel poolNav.css sort le
   rail des pools, dont la mise en page bureau reprend la place pour
   y poser l'alignement et les limites d'équipe. Un seuil plus bas
   aurait donné une colonne centrale de 300px entre deux rails.
   ============================================================ */
const FZ_MQ_BUREAU = window.matchMedia('(min-width: 1100px)');
function fzEstBureau() { return FZ_MQ_BUREAU.matches; }
window.fzEstBureau = fzEstBureau;

/* ============================================================
   1. MA LISTE — progression par position, dépliable
   ============================================================ */

/**
 * Chaque ligne de progression devient un bouton. Au clic, le panneau de
 * détails existant (#progressDetailsList) est déplacé juste sous la ligne
 * cliquée, puis rempli par showProgressDetails() — la fonction que le
 * <select> appelait déjà. Rien d'autre ne change.
 */
function initPositionProgress() {
    const lignes = document.querySelectorAll('.progress-line[data-position]');
    const details = document.getElementById('progressDetailsList');
    if (!lignes.length || !details) return;

    let ouverte = null;

    const fermer = () => {
        lignes.forEach(l => {
            l.classList.remove('is-open');
            l.setAttribute('aria-expanded', 'false');
        });
        details.style.display = 'none';
        details.classList.remove('is-inline');
        ouverte = null;
    };

    const ouvrir = (ligne) => {
        const position = ligne.dataset.position;
        // Un second clic sur la même position referme.
        if (ouverte === position) { fermer(); return; }

        fermer();
        ligne.classList.add('is-open');
        ligne.setAttribute('aria-expanded', 'true');

        // Le panneau se place sous la ligne cliquée pour que le dépliage
        // se lise comme une extension de celle-ci.
        ligne.insertAdjacentElement('afterend', details);
        details.classList.add('is-inline');

        // Réutilise la logique existante de draftActif.js.
        if (typeof showProgressDetails === 'function') {
            showProgressDetails(position);
        }
        ouverte = position;
    };

    lignes.forEach(ligne => {
        ligne.addEventListener('click', () => ouvrir(ligne));
        ligne.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrir(ligne); }
        });
    });
}

/* ============================================================
   1bis. GLACE / LISTE — bascule d'affichage de « Ma progression »
   ------------------------------------------------------------
   Mockup Claude Design 3A/3B : deux façons de voir la même progression,
   jamais recalculées ici — seul l'affichage change. « Glace » (par défaut,
   comme dans le mockup) est construite par fzRenderIceProgression()
   (draftApercuExtra.js) ; « Liste » est le bloc de barres déjà en place
   au-dessus, inchangé.

   Sous 1100px seulement : au-delà, la carte « Ma progression » n'est
   plus affichée du tout — l'alignement place par place et les barres de
   limites vivent alors dans le rail de gauche (draftDesk.js).
   ============================================================ */
function initProgressViewToggle() {
    const toggle = document.getElementById('progressViewToggle');
    const vueGlace = document.getElementById('progressIceView');
    const vueListe = document.getElementById('progressListView');
    if (!toggle || !vueGlace || !vueListe) return;

    const activer = (vue) => {
        toggle.querySelectorAll('.progress-view-chip').forEach(chip => {
            chip.classList.toggle('is-active', chip.dataset.view === vue);
        });
        vueGlace.hidden = vue !== 'ice';
        vueListe.hidden = vue !== 'list';
    };

    toggle.querySelectorAll('.progress-view-chip').forEach(chip => {
        chip.addEventListener('click', () => activer(chip.dataset.view));
    });

    activer('ice');
}

/* ============================================================
   2. ONGLETS DE CATÉGORIE
   ============================================================ */

/**
 * Bandeau d'onglets construit à partir des options réelles de
 * #playerFilter : si une option est ajoutée ou retirée côté serveur, les
 * onglets suivent sans retouche. Le clic écrit dans le <select> et déclenche
 * son événement `change`, exactement comme une sélection manuelle.
 */
function initCategoryTabs() {
    const strip = document.getElementById('categoryTabs');
    const select = document.getElementById('playerFilter');
    if (!strip || !select) return;

    // « Onglets » n'est vrai qu'en apparence : les six pastilles ne pilotent
    // pas six panneaux distincts, elles filtrent toutes le même tableau. Le
    // patron ARIA tablist suppose un panneau par onglet ; en poser un ici
    // promettait un modèle clavier (flèches, un seul arrêt de tabulation)
    // que rien ne tenait — d'où role=tablist sans aria-controls ni tabpanel.
    // Un groupe de bascules dit la même chose sans rien devoir de plus.
    strip.setAttribute('role', 'group');
    strip.innerHTML = '';
    [...select.options].forEach(option => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'category-tab';
        tab.dataset.value = option.value;
        tab.setAttribute('aria-pressed', 'false');
        tab.textContent = option.textContent.trim();
        tab.addEventListener('click', () => {
            select.value = option.value;
            // `change` n'est pas émis par une écriture scriptée : on le
            // déclenche pour que le gestionnaire de draftActif.js s'exécute.
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        strip.appendChild(tab);
    });

    const table = document.getElementById('playerTable');

    const refleter = () => {
        strip.querySelectorAll('.category-tab').forEach(t => {
            const actif = t.dataset.value === select.value;
            t.classList.toggle('is-active', actif);
            t.setAttribute('aria-pressed', String(actif));
        });
        appliquerDisponibilite(strip, select);
        // Marque la vue courante sur le tableau. Le nombre et l'ordre des
        // colonnes changent d'une catégorie à l'autre : sans ce repère, une
        // règle CSS ciblant « la 7e colonne » viserait SV% chez les gardiens
        // mais la colonne Action chez les patineurs.
        if (table) {
            [...table.classList]
                .filter(c => c.startsWith('cat-'))
                .forEach(c => table.classList.remove(c));
            table.classList.add('cat-' + select.value);
        }
    };
    select.addEventListener('change', refleter);
    refleter();

    // Rejoué après chaque rendu du tableau : une position se remplit en cours
    // de repêchage, et son onglet doit alors s'éteindre. Appelée par
    // refreshDraftViews() dans draftRefresh.js.
    refreshCategoryTabs = refleter;

    // Le <select> devient redondant une fois les onglets en place.
    select.classList.add('is-replaced');
}

/* ---- Disponibilité des catégories ----
   Une position dont le quota de l'équipe est atteint disparaît de la liste
   (draftActif.js la vide via _isCategoryFull). Son onglet mène donc à un
   tableau vide : on l'éteint plutôt que de laisser cliquer dans le vide. */

/** Code de position que draftActif.js utilise pour chaque onglet. */
const CODES_CATEGORIE = {
    offensive: ['C'],
    defensive: ['D'],
    goalies: ['G'],
    rookies: ['*'],
    // « Équipes » redevient un choix du repêchage : l'identité LNH choisie
    // avant le repêchage (repechage.html) ne sert plus qu'aux couleurs, elle
    // ne remplit plus la case du roster — l'onglet doit donc s'éteindre quand
    // le quota numTeams est atteint, comme les autres.
    teams: ['T'],
    // « Joueurs » réunit les patineurs : il ne s'éteint que lorsque plus
    // aucune de ces positions n'a de place libre.
    all: ['C', 'D', '*']
};

function categorieEpuisee(valeur) {
    const codes = CODES_CATEGORIE[valeur];
    if (!codes || typeof _isCategoryFull !== 'function') return false;
    return codes.every(code => _isCategoryFull(code));
}

function appliquerDisponibilite(strip, select) {
    let premierLibre = null;
    let actifEpuise = false;

    strip.querySelectorAll('.category-tab').forEach(tab => {
        const epuise = categorieEpuisee(tab.dataset.value);
        tab.classList.toggle('is-unavailable', epuise);
        tab.disabled = epuise;
        tab.setAttribute('aria-disabled', String(epuise));
        tab.title = epuise ? 'Plus de place à cette position' : '';

        // Sur téléphone, les pastilles disparaissent et #playerFilter — le
        // même <select> — reprend directement la main : ses options doivent
        // donc porter la même désactivation, sinon on peut y choisir une
        // catégorie déjà pleine sans que rien ne l'explique.
        const option = select.querySelector(`option[value="${tab.dataset.value}"]`);
        if (option) option.disabled = epuise;

        if (!epuise && !premierLibre) premierLibre = tab;
        if (epuise && tab.dataset.value === select.value) actifEpuise = true;
    });

    // La catégorie ouverte vient de se remplir : rester dessus afficherait un
    // tableau vide sans expliquer pourquoi. On bascule sur la première encore
    // ouverte, ce qui remet des joueurs sous les yeux.
    if (actifEpuise && premierLibre) {
        select.value = premierLibre.dataset.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

/** Remplacée par initCategoryTabs() une fois le bandeau construit. */
function refreshCategoryTabs() {}

/* ============================================================
   3. ONGLETS DE SECTION — Aperçu / Liste des joueurs
   ------------------------------------------------------------
   La carte de sélection de joueur n'est plus affichée en permanence à
   côté du suivi : les deux partagent le même espace, un seul visible à
   la fois, choisi par ces onglets — à toutes les tailles d'écran, pas
   seulement sur téléphone comme avant la bascule. « Aperçu » réunit les
   favoris et la progression ; « Liste des joueurs » est le tableau
   lui-même, avec ses filtres.

   Le bouton « Faire ma sélection » du carrousel (draftPickCards.js)
   bascule directement sur ce second onglet via window.fzOuvrirListeJoueurs,
   exposée en bas de cette fonction.
   ============================================================ */
function initPanelTabs() {
    const conteneur = document.querySelector('.draft-main-container');
    const entete = document.querySelector('.draft-header');
    if (!conteneur || document.getElementById('panelTabs')) return;

    const groupes = [
        {
            cle: 'apercu',
            libelle: 'Aperçu',
            // getElementById, pas querySelector('.progress-card') : cette
            // classe est aussi portée par #favoritesCard (habillage partagé),
            // et querySelector se serait arrêté au premier match.
            els: [
                document.getElementById('suggestionCard'),
                document.getElementById('favoritesCard'),
                document.getElementById('progressCard'),
                document.getElementById('lineupCard'),
                document.getElementById('recentPicksFeed')
            ].filter(Boolean)
        },
        {
            cle: 'joueurs',
            libelle: 'Liste des joueurs',
            // Sidebar de position et carte « Joueur sélectionné » (bureau
            // seulement, voir draftActif-premium.css, §11) : rangées avec le
            // tableau plutôt que dans un groupe séparé, un seul onglet en
            // pilote l'affichage.
            els: [
                document.getElementById('listFiltersSidebar'),
                document.querySelector('.player-selection-card'),
                document.getElementById('selectedPlayerCard')
            ].filter(Boolean)
        }
    ].filter(g => g.els.length);
    if (groupes.length < 2) return;

    const strip = document.createElement('div');
    strip.className = 'panel-tabs';
    strip.id = 'panelTabs';
    strip.setAttribute('role', 'tablist');
    strip.setAttribute('aria-label', 'Sections du repêchage');

    // Mockups Claude Design 3A/3B/4A/4B : le contrôle segmenté vit DANS
    // l'en-tête, juste sous le bandeau de tour — jamais en bande pleine
    // largeur au-dessus de .draft-main-container. band est la piste grise
    // avec son padding extérieur (voir draftActif-premium.css, §2) ; strip
    // (toujours #panelTabs, inchangé pour le reste de cette fonction) est
    // la pilule elle-même.
    const band = document.createElement('div');
    band.className = 'panel-tabs-band';
    band.appendChild(strip);
    // Bouton « Sauter ce tour » : vivait dans .draft-live-row (avec le chip
    // de connexion), déplacé ici pour occuper le côté droit du bandeau
    // d'onglets plutôt qu'une ligne à lui tout seul.
    const skipBtn = document.getElementById('turn-skip-btn');
    if (skipBtn) band.appendChild(skipBtn);
    const overallProgress = document.getElementById('draft-overall-progress');
    if (overallProgress) {
        overallProgress.insertAdjacentElement('afterend', band);
    } else if (entete) {
        entete.appendChild(band);
    } else {
        conteneur.parentNode.insertBefore(band, conteneur);
    }

    // Patron ARIA tablist complet, comme avant : chaque onglet ouvre un
    // groupe de panneaux qui lui est propre (aria-controls liste tous les
    // ids du groupe), et un seul arrêt de tabulation dans le bandeau —
    // tabindex baladeur, les flèches déplacent le focus et activent
    // l'onglet visé.
    groupes.forEach(g => {
        g.els.forEach((el, i) => {
            el.setAttribute('role', 'tabpanel');
            if (!el.id) el.id = 'panel-' + g.cle + '-' + i;
        });
    });

    let actif = groupes[0].cle;

    const appliquer = () => {
        // Bureau : les deux groupes sont affichés côte à côte dans la
        // grille à trois colonnes (draftDesk.css) — il n'y a plus de
        // panneau à cacher, et surtout plus de display en ligne à
        // laisser derrière soi si on vient d'un écran étroit. Les
        // classes de mode et le verrou de défilement, tous deux pensés
        // pour l'onglet « Liste des joueurs », tombent avec.
        if (fzEstBureau()) {
            groupes.forEach(g => g.els.forEach(el => {
                el.style.display = '';
                el.removeAttribute('aria-hidden');
            }));
            if (entete) entete.classList.remove('is-liste-joueurs');
            conteneur.classList.remove('mode-apercu', 'mode-joueurs');
            document.documentElement.classList.remove('fz-list-lock');
            document.body.classList.remove('fz-list-lock');
            return;
        }
        groupes.forEach(g => {
            const on = g.cle === actif;
            g.els.forEach(el => {
                el.style.display = on ? '' : 'none';
                el.setAttribute('aria-hidden', String(!on));
            });
        });
        strip.querySelectorAll('.panel-tab').forEach(t => {
            const on = t.dataset.cle === actif;
            t.classList.toggle('is-active', on);
            t.setAttribute('aria-selected', String(on));
            t.tabIndex = on ? 0 : -1;
        });
        // Compteur de choix, ronde et carrousel n'ont plus lieu d'être une
        // fois dans la liste : c'est déjà ce qui y a amené (le bouton
        // « Faire ma sélection »), et ils ne feraient que voler de la
        // hauteur au tableau — voir .draft-header.is-liste-joueurs dans
        // draftActif.css. Le bandeau de tour, lui, reste affiché et collant :
        // c'est en parcourant la liste qu'on a le plus besoin de savoir si
        // c'est encore son tour.
        if (entete) entete.classList.toggle('is-liste-joueurs', actif === 'joueurs');
        // Bureau (draftActif-premium.css, §11) : chaque onglet a sa propre
        // grille (3 colonnes pour la liste, 2 pour l'aperçu) — sans ce repère,
        // la colonne du panneau masqué restait réservée, vide, à côté de
        // l'autre.
        conteneur.classList.toggle('mode-apercu', actif === 'apercu');
        conteneur.classList.toggle('mode-joueurs', actif === 'joueurs');
        // Mockups Claude Design 4A (mobile) / 4B (bureau) : navbar, bandeau
        // de tour, onglets et filtres restent visibles à l'écran — seule la
        // liste défile. Posée sur <body> (voir draftActif-premium.css, §12)
        // plutôt que sur .draft-main-container : elle doit aussi verrouiller
        // le défilement de la page elle-même, qui appartient à <body>.
        //
        // Posée aussi sur <html> : tant que <html> garde son overflow par
        // défaut (visible), le débordement de <body> se PROPAGE au
        // viewport plutôt que de s'y arrêter (CSS Overflow §3) — et la
        // spec dimensionne alors ce viewport sur le MAXIMUM de sa taille
        // réelle et de celle du contenu, au lieu de le rogner. Un contenu
        // large ailleurs sur la page (ex. une bande à défilement horizontal
        // dont la largeur dépend elle-même du viewport) élargit alors
        // <html>/<body> tout entiers, et .draft-main-container grandit
        // d'autant en s'y étirant — repéré au pixel près avec les
        // pastilles de catégorie, mais pas propre à elles. Poser
        // overflow:hidden sur <html> aussi retire la précondition de la
        // propagation ; <body> redevient une boîte de défilement ordinaire.
        document.documentElement.classList.toggle('fz-list-lock', actif === 'joueurs');
        document.body.classList.toggle('fz-list-lock', actif === 'joueurs');
    };

    const activer = (cle, focus) => {
        actif = cle;
        appliquer();
        const tab = strip.querySelector('[data-cle="' + cle + '"]');
        if (focus && tab) tab.focus();
    };

    groupes.forEach((g, i) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'panel-tab';
        tab.dataset.cle = g.cle;
        tab.id = 'tab-' + g.cle;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', g.els.map(el => el.id).join(' '));
        tab.textContent = g.libelle;
        tab.addEventListener('click', () => activer(g.cle, false));
        tab.addEventListener('keydown', e => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            const n = groupes.length;
            const suivant = e.key === 'ArrowLeft' ? (i - 1 + n) % n
                : e.key === 'ArrowRight' ? (i + 1) % n
                : e.key === 'Home' ? 0 : n - 1;
            activer(groupes[suivant].cle, true);
        });
        strip.appendChild(tab);
        g.els.forEach(el => el.setAttribute('aria-labelledby', tab.id));
    });

    appliquer();

    // Rejoué par draftDesk.js quand la fenêtre traverse le seuil : c'est
    // cette fonction qui sait quels panneaux portent un display en ligne,
    // donc elle seule peut le retirer proprement.
    window.fzApplyPanelTabs = appliquer;

    /** Amène un élément sous les yeux sans changer d'onglet — sur bureau,
     *  il n'y a rien à ouvrir, tout est déjà affiché. */
    const amener = (el) => {
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    // Point d'entrée du bouton « Faire ma sélection » (draftPickCards.js) :
    // bascule sur le tableau et y ramène le regard — le bandeau d'onglets
    // peut être scrollé hors champ sur un repêchage à l'ordre long.
    window.fzOuvrirListeJoueurs = () => {
        if (fzEstBureau()) { amener(document.querySelector('.player-selection-card')); return; }
        activer('joueurs', false);
        strip.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    // Symétrique : appelé par draftPickFlow.js une fois un choix confirmé et
    // envoyé, pour ramener sur Aperçu (favoris + progression) plutôt que de
    // laisser la personne sur le tableau qu'elle vient de quitter.
    window.fzOuvrirApercu = () => {
        if (fzEstBureau()) { amener(document.getElementById('progressCard')); return; }
        activer('apercu', false);
        strip.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
}

/* ============================================================
   Initialisation
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    initPositionProgress();
    initProgressViewToggle();
    initCategoryTabs();
    initPanelTabs();
});
