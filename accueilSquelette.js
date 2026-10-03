/* ============================================================
   SQUELETTE DE L'ACCUEIL D'UN MEMBRE
   ------------------------------------------------------------
   Tant que la disposition de l'accueil n'est pas choisie
   (html.fz-home-pending, posé dans le <head> d'index.html), rien de
   l'accueil ne s'affiche : la page restait noire le temps de lire les
   pools, les statistiques et les matchs du soir. Ce squelette occupe
   l'attente.

   Il prend la forme de la dernière disposition vue par ce navigateur
   (fzAccueilDisposition, notée par fzdRevelerAccueil dans accueil-dash.js) :
   saison, repêchage ou accueil sans pool. Les panneaux reprennent les
   classes de l'accueil chargé (.fzs, .fzs-panel, .fzs-pc, .stories-card)
   et leurs titres réels ; des os prennent la place des données.
   fzdRevelerAccueil() retire le squelette. Styles : accueil-squelette.css.

   Chargé sans defer, juste après son hôte : il se dessine avant le premier
   rendu, comme le reste du <body>.
   ============================================================ */
(function () {
    'use strict';
    const hote = document.getElementById('fzHomeSkeleton');
    if (!hote || !document.documentElement.classList.contains('fz-home-pending')) return;

    const lire = cle => { try { return localStorage.getItem(cle); } catch (e) { return null; } };
    let disposition = lire('fzAccueilDisposition');
    // Le tableau de bord d'avant-saison n'a pas de squelette propre : celui
    // de la saison en a la carrure. Premier passage : on devine au pool.
    if (disposition === 'tableau' || !['saison', 'repechage', 'vide'].includes(disposition)) {
        disposition = lire('activePool') ? 'saison' : 'vide';
    }

    const os = (cls, largeur) => `<span class="fz-bone ${cls}"${largeur ? ` style="--w:${largeur}"` : ''}></span>`;
    const mat = (cls, largeur) => `<span class="fz-bone-flat ${cls}"${largeur ? ` style="--w:${largeur}"` : ''}></span>`;
    const repete = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');

    // ---- Blocs communs ----

    /** « À surveiller » / « Activité de la ligue » : un en-tête, trois lignes. */
    const panneauListe = (titre, cls) => `
        <section class="fzs-panel ask-panel ${cls}" style="--i:4">
            <div class="fzs-head"><h2>${titre}</h2>${mat('ask-link')}</div>
            ${repete(3, i => `
                <div class="ask-row">
                    ${os('ask-row-av is-round')}
                    <span class="ask-row-txt">${os('ask-row-l1', ['62%', '48%', '56%'][i])}${mat('ask-row-l2', ['38%', '30%', '44%'][i])}</span>
                </div>`)}
        </section>`;

    /** Les alignements des 32 clubs : un titre et la grille des tuiles. */
    const panneauAlignements = cls => `
        <section class="fzs-panel ask-panel ask-al ${cls}" style="--i:5">
            <div class="ask-al-head">
                <span>${mat('ask-al-eyebrow')}${os('ask-al-title')}</span>
                ${os('ask-al-go is-round')}
            </div>
            <div class="ask-al-grid">${repete(32, () => '<span class="fz-bone-flat"></span>')}</div>
            ${mat('ask-al-caption')}
        </section>`;

    // ---- Saison ----

    function saison() {
        const puce = largeur => `
            <span class="stories-chip stories-chip-news">
                <span class="stories-chip-thumb"></span>${mat('ask-chip-l', `${largeur}px`)}
            </span>`;
        const carte = i => `
            <div class="fzs-pc ask-pc">
                <div class="fzs-pc-top">${mat('ask-pc-time')}${os('ask-pc-face is-round')}</div>
                <div class="fzs-pc-body">${os('ask-pc-name', `${[78, 92, 70, 86, 74, 96][i]}px`)}${mat('ask-pc-season')}</div>
                <div class="fzs-pc-foot">${mat('ask-pc-foot')}</div>
            </div>`;
        return `
            <section class="home-section stories-section ask-stories">
                <div class="section-container">
                    <div class="stories-picker">
                        <span class="stories-chip">${mat('ask-chip-l', '30px')}</span>
                        ${[176, 160, 184, 168, 150].map(puce).join('')}
                    </div>
                    <div class="stories-card ask-story">
                        <span class="ask-story-cap">${os('ask-story-badge')}${mat('ask-story-src')}${os('ask-story-title')}</span>
                    </div>
                    <div class="ask-track"></div>
                </div>
            </section>
            <div class="ask-season">
                <div class="fzs">
                    <section class="fzs-players fzs-panel ask-panel" style="--i:1">
                        <div class="fzs-head"><h2>Mes joueurs ce soir</h2>${mat('ask-link')}</div>
                        <div class="fzs-player-list">${repete(6, carte)}</div>
                    </section>
                    <section class="fzs-rank fzs-panel ask-panel" style="--i:2">
                        <div class="fzs-head"><h2>Ma position</h2>${mat('ask-link')}</div>
                        ${os('ask-number')}${mat('ask-sub')}
                    </section>
                    <section class="fzs-total fzs-panel ask-panel" style="--i:3">
                        <div class="fzs-head"><h2>Total ce soir</h2></div>
                        ${os('ask-number')}${mat('ask-sub is-long')}
                    </section>
                    ${panneauListe('Activité de la ligue', 'ask-half')}
                    ${panneauAlignements('ask-half')}
                </div>
            </div>`;
    }

    // ---- Repêchage en cours ----

    function repechage() {
        const choix = () => `<span class="ask-pick">${mat('ask-pick-n')}${os('ask-pick-name')}</span>`;
        const joueur = i => `<span class="ask-player">${os('ask-player-av is-round')}<span class="ask-row-txt">${os('ask-row-l1', `${[70, 62, 76, 58, 66, 72][i % 6]}%`)}${mat('ask-row-l2', '34%')}</span></span>`;
        // Attaquants, défenseurs, gardien, recrue, club : les groupes de la fiche.
        const groupe = n => `<div class="ask-picks-group">${mat('ask-picks-label')}<div class="ask-picks-grid">${repete(n, joueur)}</div></div>`;
        return `
            <div class="ask-ticker">${mat('ask-ticker-dot is-round')}${os('ask-ticker-l')}${mat('ask-ticker-r')}</div>
            <div class="ask-draft">
                <section class="fzh-panel ask-panel ask-hero" style="--i:0">
                    <div class="ask-hero-main">
                        ${mat('ask-hero-pill')}
                        ${os('ask-hero-h1')}${os('ask-hero-h1 is-short')}
                        ${mat('ask-hero-sub')}
                        <div class="ask-hero-cta">${os('ask-hero-btn')}<span>${mat('ask-hero-k')}${os('ask-hero-v')}</span></div>
                        ${mat('ask-hero-k')}
                        <div class="ask-hero-order">${repete(6, choix)}</div>
                    </div>
                    <div class="ask-hero-side">
                        <div class="ask-hero-side-head">${os('ask-hero-side-title')}${mat('ask-hero-side-count')}</div>
                        ${repete(4, i => `<div class="ask-row">${os('ask-row-av is-round')}<span class="ask-row-txt">${os('ask-row-l1', `${[64, 52, 70, 58][i]}%`)}${mat('ask-row-l2', '30%')}</span></div>`)}
                    </div>
                </section>
                ${panneauListe('À surveiller', 'ask-half fzh-panel')}
                ${panneauAlignements('ask-half fzh-panel')}
                <section class="fzh-panel ask-panel ask-picks" style="--i:6">
                    <div class="ask-picks-head">${os('ask-al-title is-small')}</div>
                    <div class="ask-picks-tabs">${repete(6, i => mat('ask-tab', `${[96, 92, 70, 104, 76, 98][i]}px`))}</div>
                    ${[6, 4, 1, 1, 1].map(groupe).join('')}
                </section>
            </div>`;
    }

    // ---- Sans pool ----

    function vide() {
        const chemin = `<div class="ask-panel ask-path">${os('ask-path-icon')}<span class="ask-row-txt">${os('ask-row-l1', '46%')}${mat('ask-row-l2', '62%')}</span></div>`;
        return `
            <div class="ask-onboard">
                <div class="ask-intro">
                    ${mat('ask-welcome')}
                    ${os('ask-headline')}${os('ask-headline is-short')}
                    ${mat('ask-lede')}${mat('ask-lede is-short')}
                </div>
                <section class="ask-panel ask-start" style="--i:1">
                    <div class="ask-start-head">${os('ask-path-icon')}<span class="ask-row-txt">${os('ask-start-title')}${mat('ask-row-l2', '54%')}</span></div>
                    <div class="ask-start-well">
                        <span class="ask-seats">${repete(4, () => mat('ask-seat is-round'))}</span>
                        ${os('ask-start-btn')}
                    </div>
                </section>
                <div class="ask-paths" style="--i:2">${chemin}${chemin}</div>
                <div class="ask-features" style="--i:3">${repete(3, () => `<div class="ask-panel ask-feature"><span class="ask-feature-art"></span><span class="ask-feature-copy">${os('ask-row-l1', '58%')}${mat('ask-row-l2', '76%')}</span></div>`)}</div>
            </div>`;
    }

    const contenu = { saison, repechage, vide }[disposition]();
    hote.dataset.disposition = disposition;
    hote.innerHTML = `
        <p class="fz-sk-sr" role="status">Chargement de l’accueil…</p>
        <div class="ask ask-${disposition}" inert>${contenu}</div>`;
})();
