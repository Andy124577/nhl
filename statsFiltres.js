/* ============================================================
   STATS — FEUILLE DE FILTRES (maquette 2b)
   ------------------------------------------------------------
   « Tous les joueurs » : la recherche et un bouton « Filtres » sur une
   ligne, les filtres actifs dessous en pastilles retirables. Le bouton
   ouvre une feuille : données (réelles ou projetées), position, agents
   libres et club de la LNH. Chaque choix s'applique tout de suite.

   Aucune logique de tri ou de filtre ici : on écrit dans l'état d'index.js
   (statsFilter, statsLibres, statsClub, #seasonMode) et on rappelle
   updateTable(). Les pastilles #playerFilter et le champ #searchInput
   gardent leurs écouteurs d'index.js ; ils ont seulement changé de place.

   Le pool actif (activePool.js) dit qui appartient à qui : TOI, LIBRE, et
   « Agents libres seulement ». Sans pool repêché, ni pastille ni option.
   ============================================================ */
(function () {
    const feuille = document.getElementById('sjFeuille');
    if (!feuille) return;

    const bouton = document.getElementById('sjFiltresBtn');
    const badge = document.getElementById('sjBadge');
    const actifs = document.getElementById('sjActifs');
    const select = document.getElementById('seasonMode');
    const libres = document.getElementById('sjLibres');
    const libresLigne = document.getElementById('sjLibresLigne');
    const clubs = document.getElementById('sjClubs');
    const voir = document.getElementById('sjVoir');
    const corps = feuille.querySelector('.sj-feuille-corps');
    let dernierTotal = null, derniereSorte = 'joueurs';

    // ==================== OUVRIR, FERMER ====================

    function ouvrir() {
        construireClubs();
        majFeuille();
        feuille.hidden = false;
        bouton.setAttribute('aria-expanded', 'true');
        document.body.classList.add('sj-feuille-ouverte');
        requestAnimationFrame(() => feuille.classList.add('is-ouverte'));
        corps.querySelector('button:not([tabindex="-1"])').focus();
    }
    function fermer() {
        if (feuille.hidden) return;
        feuille.classList.remove('is-ouverte');
        bouton.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('sj-feuille-ouverte');
        feuille.hidden = true;
        bouton.focus();
    }
    bouton.addEventListener('click', ouvrir);
    feuille.addEventListener('click', e => { if (e.target.closest('[data-fermer]')) fermer(); });
    document.addEventListener('keydown', e => {
        if (feuille.hidden) return;
        if ('Escape' === e.key) { e.preventDefault(); fermer(); return; }
        // Le focus reste dans la feuille, comme dans toute fenêtre modale.
        if ('Tab' !== e.key) return;
        const cibles = [...corps.querySelectorAll('button, input')].filter(el => !el.disabled && el.offsetParent);
        const premier = cibles[0], dernier = cibles[cibles.length - 1];
        if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
        else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    });

    // ==================== DONNÉES : RÉELLES OU PROJETÉES ====================

    // Libellés courts dans la feuille ; le libellé complet coiffe le titre.
    const COURT = { stats: 'Stats', projection: 'Projetées' };

    function choisirSaison(valeur) {
        if (valeur === select.value) return;
        select.value = valeur;
        select.dispatchEvent(new Event('change'));
        majTout();
    }
    document.getElementById('sjDonnees').addEventListener('click', e => {
        const b = e.target.closest('[data-valeur]');
        if (b) choisirSaison(b.dataset.valeur);
    });

    // ==================== CLUBS ====================

    function listeClubs() {
        const sigles = new Set();
        for (const j of [...(fullPlayerData || []), ...(goalieData || [])]) {
            const c = clubActuel(j);
            if (/^[A-Z]{3}$/.test(c)) sigles.add(c);
        }
        return [...sigles].sort();
    }
    function construireClubs() {
        clubs.innerHTML = listeClubs().map(c =>
            `<button type="button" class="sj-club" data-club="${c}" aria-pressed="${c === statsClub}">`
            + `<img src="teams/${c}.png" alt="" width="24" height="24" loading="lazy">${c}</button>`
        ).join('');
    }
    clubs.addEventListener('click', e => {
        const b = e.target.closest('[data-club]');
        if (!b) return;
        statsClub = b.dataset.club === statsClub ? '' : b.dataset.club;
        clubs.querySelectorAll('[data-club]').forEach(x =>
            x.setAttribute('aria-pressed', String(x.dataset.club === statsClub)));
        updateTable();
    });

    // ==================== AGENTS LIBRES ====================

    libres.addEventListener('change', () => {
        statsLibres = libres.checked;
        updateTable();
    });

    // ==================== RÉINITIALISER ====================

    function toutEffacer() {
        if ('projection' === select.value) choisirSaison('stats');
        statsClub = '';
        // index.js : recherche, position, tri, agents libres.
        reinitialiserFiltres();
        construireClubs();
    }
    document.getElementById('sjReset').addEventListener('click', toutEffacer);

    // ==================== FILTRES ACTIFS ====================

    const CROIX = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

    function filtresActifsListe() {
        const liste = [];
        const chip = document.querySelector(`#playerFilter .st-chip[data-filter="${statsFilter}"]`);
        if ('all' !== statsFilter && chip) liste.push({ cle: 'pos', libelle: chip.textContent });
        if (statsClub) liste.push({ cle: 'club', libelle: statsClub });
        if (statsLibres) liste.push({ cle: 'libres', libelle: 'Agents libres' });
        if ('projection' === select.value) liste.push({ cle: 'saison', libelle: 'Projetées' });
        return liste;
    }
    actifs.addEventListener('click', e => {
        const b = e.target.closest('[data-retirer]');
        if (!b) return;
        const cle = b.dataset.retirer;
        if ('tout' === cle) { toutEffacer(); return; }
        if ('pos' === cle) choisirFiltre('all');
        if ('club' === cle) statsClub = '';
        if ('libres' === cle) statsLibres = false;
        if ('saison' === cle) { choisirSaison('stats'); return; }
        updateTable();
    });

    // ==================== TOUT SUIT LE TABLEAU ====================

    function majFeuille() {
        document.getElementById('sjDonnees').innerHTML = [...select.options].map(o =>
            `<button type="button" role="radio" data-valeur="${o.value}" aria-checked="${o.selected}">${COURT[o.value] || o.textContent}</button>`
        ).join('');
        libres.checked = statsLibres;
        // Les clubs repêchés ne se filtrent pas : l'option ne vaut que pour les joueurs.
        libres.disabled = 'teams' === statsFilter;
        if (null != dernierTotal) {
            voir.textContent = `Voir ${dernierTotal} ${1 === dernierTotal ? derniereSorte.replace(/s$/, '') : derniereSorte}`;
        }
    }

    function majTout() {
        const choisi = select.options[select.selectedIndex];
        document.getElementById('sjSaison').textContent = choisi ? choisi.textContent : '';
        const liste = filtresActifsListe();
        badge.hidden = !liste.length;
        badge.textContent = liste.length;
        bouton.classList.toggle('is-actif', !!liste.length);
        actifs.hidden = !liste.length;
        actifs.innerHTML = liste.map(f =>
            `<button type="button" class="sj-actif" data-retirer="${f.cle}" aria-label="Retirer le filtre ${f.libelle}">${f.libelle}${CROIX}</button>`
        ).join('') + (liste.length ? '<button type="button" class="sj-lien" data-retirer="tout">Tout effacer</button>' : '');
        majFeuille();
    }

    document.addEventListener('fz:stats-rendu', e => {
        dernierTotal = e.detail ? e.detail.total : null;
        derniereSorte = (e.detail && e.detail.sorte) || 'joueurs';
        majTout();
    });
    // libellerModesSaison (index.js) réécrit les options quand la saison est connue.
    new MutationObserver(majTout).observe(select, { subtree: true, childList: true, characterData: true });
    select.addEventListener('change', majTout);

    // ==================== QUI A QUI DANS LE POOL ACTIF ====================

    // Ramenée à la graphie de la trousse : un choix enregistré « Zack Bolduc »
    // reste le « Zachary Bolduc » du tableau (ALIAS, draftkitData.js).
    const canonique = nom => (window.FZDraftKit ? FZDraftKit.nomCanonique(nom) : nom);
    const cle = nom => String(canonique(nom) || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
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
        libresLigne.hidden = !proprio;
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
    majTout();
})();
