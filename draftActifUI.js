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
    // Pas d'entrée « teams » : il n'y a plus d'onglet à éteindre pour cette
    // catégorie, l'identité LNH (repechage.html) ayant remplacé le pick.
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
   favoris, la progression et l'ordre du repêchage (tout ce que la page
   montrait déjà, moins le tableau) ; « Liste des joueurs » est le
   tableau lui-même, avec ses filtres.

   Le bouton « Faire ma sélection » du carrousel (draftPickCards.js)
   bascule directement sur ce second onglet via window.fzOuvrirListeJoueurs,
   exposée en bas de cette fonction.
   ============================================================ */
function initPanelTabs() {
    const conteneur = document.querySelector('.draft-main-container');
    if (!conteneur || document.getElementById('panelTabs')) return;

    const groupes = [
        {
            cle: 'apercu',
            libelle: 'Aperçu',
            els: [
                document.getElementById('favoritesCard'),
                document.querySelector('.progress-card'),
                document.querySelector('.draft-order-card')
            ].filter(Boolean)
        },
        {
            cle: 'joueurs',
            libelle: 'Liste des joueurs',
            els: [document.querySelector('.player-selection-card')].filter(Boolean)
        }
    ].filter(g => g.els.length);
    if (groupes.length < 2) return;

    const strip = document.createElement('div');
    strip.className = 'panel-tabs';
    strip.id = 'panelTabs';
    strip.setAttribute('role', 'tablist');
    strip.setAttribute('aria-label', 'Sections du repêchage');
    conteneur.parentNode.insertBefore(strip, conteneur);

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

    // Point d'entrée du bouton « Faire ma sélection » (draftPickCards.js) :
    // bascule sur le tableau et y ramène le regard — le bandeau d'onglets
    // peut être scrollé hors champ sur un repêchage à l'ordre long.
    window.fzOuvrirListeJoueurs = () => {
        activer('joueurs', false);
        strip.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
}

/* ============================================================
   Initialisation
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    initPositionProgress();
    initCategoryTabs();
    initPanelTabs();
});
