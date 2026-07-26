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

    strip.innerHTML = '';
    [...select.options].forEach(option => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'category-tab';
        tab.dataset.value = option.value;
        tab.setAttribute('role', 'tab');
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
            t.setAttribute('aria-selected', String(actif));
        });
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

    // Le <select> devient redondant une fois les onglets en place.
    select.classList.add('is-replaced');
}

/* ============================================================
   3. ONGLETS DE PANNEAU (téléphone)
   ============================================================ */

/**
 * Sur téléphone, les trois cartes s'empilent et imposent un long
 * défilement. On les présente en onglets. Au-delà de 1024px la mise en
 * page à deux colonnes reprend et tout est visible en même temps : les
 * onglets se retirent alors d'eux-mêmes.
 */
function initPanelTabs() {
    const conteneur = document.querySelector('.draft-main-container');
    if (!conteneur || document.getElementById('panelTabs')) return;

    const panneaux = [
        { cle: 'joueurs',   libelle: 'Disponible', el: document.querySelector('.player-selection-card') },
        { cle: 'maliste',   libelle: 'Ma liste',   el: document.querySelector('.progress-card') },
        { cle: 'ordre',     libelle: 'Ordre',      el: document.querySelector('.draft-order-card') }
    ].filter(p => p.el);
    if (panneaux.length < 2) return;

    const strip = document.createElement('div');
    strip.className = 'panel-tabs';
    strip.id = 'panelTabs';
    strip.setAttribute('role', 'tablist');
    conteneur.parentNode.insertBefore(strip, conteneur);

    const mq = window.matchMedia('(max-width: 1023px)');
    let actif = panneaux[0].cle;

    const appliquer = () => {
        const enOnglets = mq.matches;
        strip.style.display = enOnglets ? '' : 'none';
        panneaux.forEach(p => {
            // Hors mode onglets, on rend la main au CSS de mise en page.
            p.el.style.display = enOnglets ? (p.cle === actif ? '' : 'none') : '';
        });
        strip.querySelectorAll('.panel-tab').forEach(t => {
            const on = t.dataset.cle === actif;
            t.classList.toggle('is-active', on);
            t.setAttribute('aria-selected', String(on));
        });
    };

    panneaux.forEach(p => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'panel-tab';
        tab.dataset.cle = p.cle;
        tab.setAttribute('role', 'tab');
        tab.textContent = p.libelle;
        tab.addEventListener('click', () => { actif = p.cle; appliquer(); });
        strip.appendChild(tab);
    });

    mq.addEventListener('change', appliquer);
    appliquer();
}

/* ============================================================
   Initialisation
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    initPositionProgress();
    initCategoryTabs();
    initPanelTabs();
});
