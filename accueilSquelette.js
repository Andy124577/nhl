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
   saison, repêchage ou accueil sans pool. Les panneaux reprennent la
   charpente de l'accueil chargé et, quand ils ne changent pas, leurs titres
   réels ; des os prennent la place des données.
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

    // ---- Listes des accueils saison et repêchage ----

    const ligne = (i, n) => `
            <div class="ask-row">
                ${os('ask-row-av is-round')}
                <span class="ask-row-txt">${os('ask-row-l1', ['58%', '46%', '52%', '40%', '55%', '48%'][i % 6])}${mat('ask-row-l2', ['36%', '30%', '42%', '34%', '28%', '38%'][i % 6])}</span>
                ${n ? mat('ask-s-pts') : ''}
            </div>`;
    const liste = (titre, n, cls, i) => `
            <section class="ask-panel ask-s-sec ${cls}" style="--i:${i}">
                <div class="ask-s-head">${mat('ask-s-ico')}${titre ? `<h2>${titre}</h2>` : os('ask-s-titre')}</div>
                ${repete(n, k => ligne(k, cls === 'ask-s-mine'))}
            </section>`;

    // ---- Saison ----

    function saison() {
        // Même charpente que l'accueil de saison (accueil-season.js) : ma
        // position, les matchs ce soir, mes joueurs, les meilleurs de la
        // semaine et l'activité de la ligue ; deux colonnes au bureau.
        const rail = (titre, n, cls, i) => `
            <section class="ask-panel ask-s-sec ${cls}" style="--i:${i}">
                <div class="ask-s-head"><h2>${titre}</h2></div>
                <div class="ask-s-rail">${repete(n, () => '<span class="fz-bone-flat ask-s-card"></span>')}</div>
            </section>`;
        return `
            <div class="ask-s">
                <div class="ask-s-col">
                    <div class="ask-panel ask-s-hero" style="--i:0">${os('ask-s-rank')}<span class="ask-row-txt">${mat('ask-row-l2', '40%')}${os('ask-s-big')}${mat('ask-row-l2', '30%')}</span></div>
                    ${liste('Mes joueurs ce soir', 6, 'ask-s-mine', 2)}
                    ${liste('Activité de la ligue', 3, 'ask-s-act', 4)}
                </div>
                <div class="ask-s-col">
                    ${rail('Matchs ce soir', 3, 'ask-s-games', 1)}
                    ${rail('Meilleurs de la semaine', 3, 'ask-s-top', 3)}
                </div>
            </div>`;
    }

    // ---- Repêchage (en cours ou en préparation) ----

    function repechage() {
        // La charpente d'accueil-draft.js : le héros et sa carte, puis deux
        // cartes ; en cartes dès le téléphone. Les titres changent avec
        // l'état du repêchage : des os les remplacent.
        return `
            <div class="ask-s ask-d">
                <div class="ask-s-col">
                    <div class="ask-panel ask-d-hero" style="--i:0">
                        ${mat('ask-d-puce')}${os('ask-d-titre')}${mat('ask-row-l2', '58%')}
                        <div class="ask-d-cases">${repete(4, () => '<span class="fz-bone-flat"></span>')}</div>
                        ${os('ask-d-cta')}
                    </div>
                    ${liste('', 3, 'ask-d-sec', 1)}
                </div>
                <div class="ask-s-col">
                    ${liste('', 2, 'ask-d-sec', 2)}
                    ${liste('', 3, 'ask-d-sec', 3)}
                </div>
            </div>`;
    }

    // ---- Sans pool ----

    function vide() {
        const chemin = `<div class="ask-panel ask-path">${os('ask-path-icon')}<span class="ask-row-txt">${os('ask-row-l1', '70%')}${mat('ask-row-l2', '86%')}</span></div>`;
        return `
            <div class="ask-onboard">
                <div class="ask-intro">
                    ${mat('ask-welcome')}
                    ${os('ask-headline')}${os('ask-headline is-short')}
                    ${mat('ask-lede')}
                </div>
                <section class="ask-panel ask-start" style="--i:1">
                    ${mat('ask-d-puce')}${os('ask-start-title')}${mat('ask-row-l2', '70%')}
                    <span class="ask-seats">${repete(4, () => mat('ask-seat is-round'))}</span>
                    ${os('ask-start-btn')}
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
