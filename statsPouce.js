/* ============================================================
   STATS — BARRE AU POUCE (maquette 2c)
   ------------------------------------------------------------
   « Tous les joueurs » garde la liste en pleine hauteur : la recherche, la
   position, le tri et « Libres » vivent dans une barre collée au bas de
   l'écran, à portée du pouce. Chaque outil ouvre son panneau au-dessus.

   Aucune logique de tri ou de filtre ici : on écrit dans l'état d'index.js
   (statsFilter, statsSort, statsLibres) et on rappelle updateTable(). Les
   pastilles #playerFilter et le champ #searchInput gardent leurs écouteurs
   d'index.js ; ils ont seulement changé de place.

   Le pool actif (activePool.js) dit qui appartient à qui : TOI, LIBRE, et
   le filtre « Libres ». Sans pool repêché, ni pastille ni bouton.
   ============================================================ */
(function () {
    const pouce = document.getElementById('sjPouce');
    if (!pouce) return;

    const pop = document.getElementById('sjPop');
    const popTitre = document.getElementById('sjPopTitre');
    const outils = [...pouce.querySelectorAll('[data-outil]')];
    const libres = document.getElementById('sjLibres');
    const recherche = document.getElementById('searchInput');
    const TITRES = { search: 'Recherche', pos: 'Position', sort: 'Trier par' };
    let ouvert = null;

    // ==================== PANNEAUX ====================

    function ouvrir(nom) {
        ouvert = ouvert === nom ? null : nom;
        pop.hidden = !ouvert;
        popTitre.textContent = TITRES[ouvert] || '';
        pop.querySelectorAll('[data-panneau]').forEach(p => { p.hidden = p.dataset.panneau !== ouvert; });
        outils.forEach(o => o.setAttribute('aria-expanded', String(o.dataset.outil === ouvert)));
        if ('sort' === ouvert) construireTris();
        if ('search' === ouvert) recherche.focus();
        majBarre();
    }
    const fermer = () => { if (ouvert) ouvrir(ouvert); };

    outils.forEach(o => o.addEventListener('click', () => ouvrir(o.dataset.outil)));
    document.addEventListener('click', e => {
        if (ouvert && !pouce.contains(e.target)) fermer();
    });
    document.addEventListener('keydown', e => {
        if ('Escape' !== e.key || !ouvert) return;
        // Échap vide d'abord la recherche (index.js) ; une recherche vide ferme.
        if ('search' === ouvert && recherche.value) return;
        fermer();
        pouce.querySelector(`[data-outil]`).blur();
    });
    // Une position choisie referme le panneau ; index.js a déjà relancé le rendu.
    document.getElementById('playerFilter').addEventListener('click', e => {
        if (e.target.closest('.st-chip')) fermer();
    });
    recherche.addEventListener('keydown', e => {
        if ('Enter' === e.key) { recherche.blur(); fermer(); }
    });

    // ==================== TRI ====================

    // Les libellés longs de la maquette : « Matchs », pas « PJ ».
    const NOMS_TRI = {
        gamesPlayed: 'Matchs', goals: 'Buts', assists: 'Passes', points: 'Points',
        wins: 'Victoires', losses: 'Défaites', otLosses: 'Déf. prol.',
        savePct: '% arrêts', shutouts: 'Blanchissages'
    };
    const colonnesActives = () => 'teams' === statsFilter ? []
        : 'goalies' === statsFilter ? GOALIE_COLUMNS : SKATER_COLUMNS;

    function construireTris() {
        const actif = cleDeTri(colonnesActives());
        document.getElementById('sjTris').innerHTML = colonnesActives()
            .filter(c => c.sort)
            .map(c => `<button type="button" class="st-chip" data-sort="${c.sort}" aria-pressed="${c.sort === actif}">${NOMS_TRI[c.sort] || c.title}</button>`)
            .join('');
    }
    document.getElementById('sjTris').addEventListener('click', e => {
        const b = e.target.closest('[data-sort]');
        if (!b) return;
        fermer();
        if (b.dataset.sort === statsSort) return;
        statsSort = b.dataset.sort;
        updateTable();
    });

    // ==================== LIBRES ====================

    libres.addEventListener('click', () => {
        fermer();
        statsLibres = !statsLibres;
        updateTable();
    });

    // ==================== LA BARRE SUIT LE TABLEAU ====================

    function majBarre() {
        const chip = document.querySelector('#playerFilter .st-chip[aria-pressed="true"]');
        document.getElementById('sjValPos').textContent = `${chip ? chip.textContent : 'Tous'} ▾`;
        const cols = colonnesActives();
        const tri = pouce.querySelector('[data-outil="sort"]');
        tri.disabled = !cols.length;
        document.getElementById('sjValTri').textContent = cols.length
            ? `${NOMS_TRI[cleDeTri(cols)] || 'Points'} ▾` : '—';
        const cherche = !!recherche.value.trim();
        pouce.querySelector('[data-outil="search"]').classList.toggle('is-on', cherche);
        // Les clubs repêchés ne se filtrent pas : « Libres » ne vaut que pour les joueurs.
        libres.disabled = 'teams' === statsFilter;
        libres.setAttribute('aria-pressed', String(statsLibres));
        document.getElementById('sjValLibres').textContent = statsLibres ? 'Oui' : 'Non';
        outils.forEach(o => o.classList.toggle('is-open', o.dataset.outil === ouvert));
    }

    const compte = document.getElementById('sjCompte');
    document.addEventListener('fz:stats-rendu', e => {
        const { total, sorte } = e.detail || {};
        compte.textContent = `${total} ${1 === total ? sorte.replace(/s$/, '') : sorte}`;
        majBarre();
    });
    recherche.addEventListener('input', majBarre);

    // ==================== SAISON : RÉELLE OU PROJETÉE ====================

    const select = document.getElementById('seasonMode');
    const sourceBtn = document.getElementById('sjSourceBtn');
    const sourceMenu = document.getElementById('sjSourceMenu');
    const COCHE = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function majSource() {
        const choisi = select.options[select.selectedIndex];
        document.getElementById('sjSourceLbl').textContent = choisi ? choisi.textContent : '';
        sourceMenu.innerHTML = [...select.options].map(o =>
            `<button type="button" role="menuitemradio" aria-checked="${o.selected}" data-valeur="${o.value}">${o.textContent}${o.selected ? COCHE : ''}</button>`
        ).join('');
    }
    function basculerMenu(ouvrir) {
        sourceMenu.hidden = !ouvrir;
        sourceBtn.setAttribute('aria-expanded', String(ouvrir));
        if (ouvrir) majSource();
    }
    sourceBtn.addEventListener('click', e => { e.stopPropagation(); basculerMenu(sourceMenu.hidden); });
    sourceMenu.addEventListener('click', e => {
        const b = e.target.closest('[data-valeur]');
        if (!b) return;
        basculerMenu(false);
        sourceBtn.focus();
        if (b.dataset.valeur === select.value) return;
        select.value = b.dataset.valeur;
        select.dispatchEvent(new Event('change'));
        majSource();
    });
    document.addEventListener('click', e => {
        if (!sourceMenu.hidden && !e.target.closest('#sjSource')) basculerMenu(false);
    });
    document.addEventListener('keydown', e => {
        if ('Escape' === e.key && !sourceMenu.hidden) { basculerMenu(false); sourceBtn.focus(); }
    });
    // libellerModesSaison (index.js) réécrit les options quand la saison est connue.
    new MutationObserver(majSource).observe(select, { subtree: true, childList: true, characterData: true });
    select.addEventListener('change', majSource);
    majSource();

    // ==================== QUI A QUI DANS LE POOL ACTIF ====================

    const cle = nom => String(nom || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z]/g, '');
    let proprio = null;   // Map clé → 'moi' | 'pris', ou null sans pool repêché

    function lirePool() {
        const P = window.FZPool, choisis = window.fzNomsChoisis;
        const donnees = P && P.data();
        let carte = null;
        if (donnees && 'function' === typeof choisis) {
            const moi = P.team();
            carte = new Map();
            for (const [nom, equipe] of Object.entries(donnees.teams || {})) {
                const qui = moi && moi.name === nom ? 'moi' : 'pris';
                for (const j of choisis(equipe)) carte.set(cle(j), qui);
            }
            if (!carte.size) carte = null;
        }
        const avant = proprio ? JSON.stringify([...proprio]) : '';
        proprio = carte;
        libres.hidden = !proprio;
        if (!proprio && statsLibres) statsLibres = false;
        // Les données arrivent souvent après le premier rendu du tableau.
        if (avant !== (proprio ? JSON.stringify([...proprio]) : '')
            && 'undefined' != typeof fullPlayerData && fullPlayerData.length) updateTable();
    }

    window.fzStatsProprio = nom => (proprio ? proprio.get(cle(nom)) || 'libre' : null);

    if (window.FZPool) {
        FZPool.ready().then(lirePool, () => {});
        FZPool.on(lirePool);
        FZPool.onData(lirePool);
    }
    majBarre();
})();
