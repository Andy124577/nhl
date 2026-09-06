/* ============================================================
   NAVIGATION DES POOLS — barre latérale et tiroir mobile
   ------------------------------------------------------------
   Le choix du pool vivait auparavant sur chaque page : une liste sur
   Classement, une étape 1 sur Échange, un onglet sur Pools. Il vit
   désormais à un seul endroit, et le reste du site suit.

   Ordinateur : rail fixe à gauche, sous la barre du haut.
   Téléphone  : tiroir ouvert par le bouton ☰ de la barre du haut,
                la barre d'onglets du bas gardant la navigation de page.

   Aucun sélecteur de pool n'est dupliqué : les deux surfaces sont
   rendues par les mêmes fonctions et se ferment l'une l'autre.
   ============================================================ */
(function () {
    const ICONES = {
        menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
        fermer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
        chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
        check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
        reglages: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
        plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16m8-8H4"/></svg>`,
        entrer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/></svg>`,
        accueil: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>`,
        repechage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>`,
        echanges: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>`,
        classement: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg>`,
        stats: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>`
    };

    const LIBELLE_ETAT = {
        attente: 'En attente de joueurs',
        pret:    'Prêt à repêcher',
        encours: 'Repêchage en cours',
        termine: 'Saison en cours'
    };

    const LIENS_PAGE = [
        { href: 'index.html',      cle: 'accueil',    texte: 'Accueil',    icone: 'accueil' },
        { href: 'repechage.html',  cle: 'repechage',  texte: 'Repêchage',  icone: 'repechage' },
        { href: 'trade.html',      cle: 'trade',      texte: 'Échanges',   icone: 'echanges' },
        { href: 'classement.html', cle: 'classement', texte: 'Classement', icone: 'classement' },
        { href: 'stats.html',      cle: 'stats',      texte: 'Stats',      icone: 'stats' }
    ];

    const LIENS_GESTION = [
        { href: 'mes-pools.html',      icone: 'reglages', titre: 'Mes pools',        detail: 'Équipe, nom, paramètres' },
        { href: 'creer-pool.html',     icone: 'plus',     titre: 'Créer un pool',    detail: 'Nouvelle ligue' },
        { href: 'rejoindre-pool.html', icone: 'entrer',   titre: 'Rejoindre un pool', detail: 'Ligues ouvertes' }
    ];

    const echapper = texte => String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    function pageCourante() {
        const chemin = window.location.pathname;
        if (chemin.includes('mes-pools')) return 'mespools';
        if (chemin.includes('creer-pool')) return 'creer';
        if (chemin.includes('rejoindre-pool')) return 'rejoindre';
        if (chemin.includes('repechage') || chemin.includes('draftActif') ||
            chemin.includes('draftFini') || chemin.includes('draft.html')) return 'repechage';
        if (chemin.includes('classement')) return 'classement';
        if (chemin.includes('trade')) return 'trade';
        if (chemin.includes('stats')) return 'stats';
        if (chemin.includes('index.html') || chemin.endsWith('/')) return 'accueil';
        return '';
    }

    // ==================== FRAGMENTS ====================

    function vignette(pool, classe) {
        const src = FZPool.image(pool && pool.data);
        return `<img src="${echapper(src)}" class="${classe}" alt=""
                     onerror="this.src='Icons/grayGroup.png'">`;
    }

    /** Bloc « pool actif » : le bouton d'ouverture et la liste des pools. */
    function blocPool(suffixe) {
        const actif = FZPool.get();
        const mesPools = FZPool.mine();

        if (mesPools.length === 0) {
            return `
                <div class="fz-pool-block">
                    <p class="fz-rail-label">Pool actif</p>
                    <div class="fz-pool-empty">
                        <p>Vous n'êtes dans aucun pool pour l'instant.</p>
                        <a class="fz-pool-empty-cta" href="creer-pool.html">Créer un pool</a>
                        <a class="fz-pool-empty-link" href="rejoindre-pool.html">ou rejoindre une ligue ouverte</a>
                    </div>
                </div>`;
        }

        const courant = mesPools.find(p => p.name === actif) || mesPools[0];
        const etat = FZPool.draftState(courant.data);

        const options = mesPools.map(pool => {
            const e = FZPool.draftState(pool.data);
            const choisi = pool.name === actif;
            return `
                <li>
                    <button type="button" class="fz-pool-option${choisi ? ' is-active' : ''}"
                            data-pool="${echapper(pool.name)}"
                            ${choisi ? 'aria-current="true"' : ''}>
                        ${vignette(pool, 'fz-pool-option-img')}
                        <span class="fz-pool-option-txt">
                            <span class="fz-pool-option-name">${echapper(pool.name)}</span>
                            <span class="fz-pool-option-meta">${echapper(pool.teamName)} · ${LIBELLE_ETAT[e.etat]}</span>
                        </span>
                        <span class="fz-pool-option-check">${ICONES.check}</span>
                    </button>
                </li>`;
        }).join('');

        return `
            <div class="fz-pool-block">
                <p class="fz-rail-label">Pool actif</p>
                <button type="button" class="fz-active-pool" id="fzActiveBtn${suffixe}"
                        aria-expanded="false" aria-controls="fzPoolList${suffixe}">
                    ${vignette(courant, 'fz-active-pool-img')}
                    <span class="fz-active-pool-txt">
                        <span class="fz-active-pool-name">${echapper(courant.name)}</span>
                        <span class="fz-active-pool-meta">${echapper(courant.teamName)}</span>
                    </span>
                    <span class="fz-chevron">${ICONES.chevron}</span>
                </button>
                <span class="fz-pool-state fz-state-${etat.etat}">${LIBELLE_ETAT[etat.etat]}</span>
                <ul class="fz-pool-list" id="fzPoolList${suffixe}" hidden>${options}</ul>
            </div>`;
    }

    function blocGestion() {
        const page = pageCourante();
        const cleParHref = { 'mes-pools.html': 'mespools', 'creer-pool.html': 'creer', 'rejoindre-pool.html': 'rejoindre' };
        return `
            <nav class="fz-rail-nav" aria-label="Gestion des pools">
                <p class="fz-rail-label">Gestion</p>
                ${LIENS_GESTION.map(lien => `
                    <a href="${lien.href}" class="fz-rail-link${cleParHref[lien.href] === page ? ' is-active' : ''}">
                        <span class="fz-rail-icon">${ICONES[lien.icone]}</span>
                        <span class="fz-rail-txt">
                            <span class="fz-rail-title">${lien.titre}</span>
                            <span class="fz-rail-detail">${lien.detail}</span>
                        </span>
                    </a>`).join('')}
            </nav>`;
    }

    function blocPages() {
        const page = pageCourante();
        const donneesActif = FZPool.data();
        // Trois liens tombent selon l'état du pool actif :
        //   — « Échanges », si le pool les a coupés : la page refuserait d'y
        //     afficher quoi que ce soit (voir trade.js) ;
        //   — « Repêchage », une fois celui-ci terminé : ses écrans se
        //     referment d'eux-mêmes (fermerLeRepechageSiTermine, activePool.js)
        //     et la barre principale enlève déjà l'onglet (navbar.js) ;
        //   — « Classement », tant qu'il ne l'est pas : classer des effectifs
        //     à moitié repêchés ne mesure que l'ordre des choix
        //     (updateClassementLinkVisibility, navbar.js).
        const repechageFini = !!donneesActif
            && FZPool.draftState(donneesActif).etat === 'termine';
        const liens = LIENS_PAGE.filter(lien => {
            if (lien.cle === 'trade' && donneesActif && donneesActif.allowTrades === false) return false;
            if (lien.cle === 'repechage' && repechageFini) return false;
            if (lien.cle === 'classement' && donneesActif && !repechageFini) return false;
            return true;
        });
        return `
            <nav class="fz-drawer-pages" aria-label="Pages">
                <p class="fz-rail-label">Naviguer</p>
                ${liens.map(lien => `
                    <a href="${lien.href}" class="fz-drawer-page${lien.cle === page ? ' is-active' : ''}">
                        <span class="fz-drawer-page-img">${ICONES[lien.icone]}</span>
                        <span>${lien.texte}</span>
                    </a>`).join('')}
            </nav>`;
    }

    // ==================== MONTAGE ====================

    function monterBarreLaterale() {
        let rail = document.getElementById('fzSidebar');
        if (!rail) {
            rail = document.createElement('aside');
            rail.className = 'fz-sidebar';
            rail.id = 'fzSidebar';
            rail.setAttribute('aria-label', 'Navigation des pools');
            document.body.appendChild(rail);
        }
        // Une page peut reprendre le rail à son compte : le repêchage en
        // direct y met l'alignement et les limites d'équipe, et renvoie le
        // sélecteur de pool dans la barre du haut (la puce #fzNavbarPool,
        // déjà construite plus bas par montrerPucePool). Sans ce garde-fou,
        // la moindre mise à jour temps réel de FZPool rappellerait cette
        // fonction et effacerait le contenu que la page y a posé.
        if (document.body.dataset.fzRail !== 'page') {
            rail.innerHTML = blocPool('Rail') + blocGestion();
            brancherBlocPool(rail, 'Rail');
        }
        document.body.classList.add('fz-has-sidebar');
    }

    function monterTiroir() {
        let tiroir = document.getElementById('fzDrawer');
        if (!tiroir) {
            const html = `
                <div class="fz-drawer-scrim" id="fzDrawerScrim" hidden></div>
                <div class="fz-drawer" id="fzDrawer" role="dialog" aria-modal="true"
                     aria-label="Menu des pools" hidden>
                    <div class="fz-drawer-head">
                        <span class="fz-drawer-title">Mes pools</span>
                        <button type="button" class="fz-drawer-close" id="fzDrawerClose"
                                aria-label="Fermer le menu">${ICONES.fermer}</button>
                    </div>
                    <div class="fz-drawer-body" id="fzDrawerBody"></div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', html);
            tiroir = document.getElementById('fzDrawer');

            document.getElementById('fzDrawerClose').addEventListener('click', fermerTiroir);
            document.getElementById('fzDrawerScrim').addEventListener('click', fermerTiroir);
            document.addEventListener('keydown', e => {
                if (e.key === 'Escape' && !tiroir.hidden) fermerTiroir();
            });
        }

        const corps = document.getElementById('fzDrawerBody');
        corps.innerHTML = blocPool('Drawer') + blocGestion() + blocPages();
        brancherBlocPool(corps, 'Drawer');
    }

    function monterHamburger() {
        const gauche = document.querySelector('.navbar-desktop .navbar-left');
        if (!gauche || document.getElementById('fzBurger')) return;
        const bouton = document.createElement('button');
        bouton.type = 'button';
        bouton.className = 'fz-burger';
        bouton.id = 'fzBurger';
        bouton.setAttribute('aria-label', 'Ouvrir le menu des pools');
        bouton.setAttribute('aria-expanded', 'false');
        bouton.innerHTML = ICONES.menu;
        bouton.addEventListener('click', ouvrirTiroir);
        gauche.insertBefore(bouton, gauche.firstChild);
    }

    /**
     * Puce « pool actif » qui remplace le logo dans la barre du haut sous
     * 769px (le CSS s'en charge, voir poolNav.css) : sans pool, un bouton
     * « Rejoindre un pool » à la place.
     */
    function montrerPucePool() {
        const marque = document.querySelector('.navbar-desktop .navbar-brand');
        if (!marque) return;

        let puce = document.getElementById('fzNavbarPool');
        if (!puce) {
            puce = document.createElement('a');
            puce.id = 'fzNavbarPool';
            marque.insertAdjacentElement('afterend', puce);
        }

        const actif = FZPool.get();
        const courant = FZPool.mine().find(p => p.name === actif);

        if (!courant) {
            puce.href = 'rejoindre-pool.html';
            puce.className = 'fz-navbar-pool fz-navbar-pool-empty';
            puce.onclick = null;
            puce.innerHTML = `<span>Rejoindre un pool</span>`;
            return;
        }

        puce.href = '#';
        puce.className = 'fz-navbar-pool';
        puce.innerHTML = vignette(courant, 'fz-navbar-pool-img') +
            `<span class="fz-navbar-pool-name">${echapper(courant.name)}</span>`;
        puce.onclick = e => { e.preventDefault(); ouvrirTiroir(); };
    }

    // ==================== INTERACTIONS ====================

    function brancherBlocPool(racine, suffixe) {
        const bouton = racine.querySelector(`#fzActiveBtn${suffixe}`);
        const liste = racine.querySelector(`#fzPoolList${suffixe}`);
        if (!bouton || !liste) return;

        bouton.addEventListener('click', e => {
            e.stopPropagation();
            const ouvert = !liste.hidden;
            liste.hidden = ouvert;
            bouton.setAttribute('aria-expanded', String(!ouvert));
            bouton.classList.toggle('is-open', !ouvert);
        });

        liste.querySelectorAll('.fz-pool-option').forEach(option => {
            option.addEventListener('click', () => {
                const nom = option.dataset.pool;
                if (nom === FZPool.get()) { fermerListes(); return; }
                option.classList.add('is-loading');
                FZPool.set(nom);
            });
        });
    }

    function fermerListes() {
        document.querySelectorAll('.fz-pool-list').forEach(liste => {
            liste.hidden = true;
            const bouton = liste.parentElement.querySelector('.fz-active-pool');
            if (bouton) {
                bouton.setAttribute('aria-expanded', 'false');
                bouton.classList.remove('is-open');
            }
        });
    }

    /** Une liste ouverte ne doit pas se faire effacer sous les doigts. */
    function listeOuverte() {
        return [...document.querySelectorAll('.fz-pool-list')].some(l => !l.hidden);
    }

    // Un clic ailleurs referme la liste : elle recouvre le contenu du rail.
    // Posé une seule fois — le rail, lui, se reconstruit à chaque mise à jour.
    document.addEventListener('click', e => {
        if (!listeOuverte()) return;
        if (e.target.closest('.fz-pool-block')) return;
        fermerListes();
    });

    let elementAvantTiroir = null;

    function ouvrirTiroir() {
        const tiroir = document.getElementById('fzDrawer');
        const voile = document.getElementById('fzDrawerScrim');
        if (!tiroir) return;
        elementAvantTiroir = document.activeElement;
        tiroir.hidden = false;
        voile.hidden = false;
        document.body.classList.add('fz-drawer-open');
        const burger = document.getElementById('fzBurger');
        if (burger) burger.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(() => tiroir.classList.add('is-open'));
        const premier = tiroir.querySelector('button, a');
        if (premier) premier.focus();
    }

    function fermerTiroir() {
        const tiroir = document.getElementById('fzDrawer');
        const voile = document.getElementById('fzDrawerScrim');
        if (!tiroir || tiroir.hidden) return;
        tiroir.classList.remove('is-open');
        document.body.classList.remove('fz-drawer-open');
        const burger = document.getElementById('fzBurger');
        if (burger) burger.setAttribute('aria-expanded', 'false');
        // Attendre la fin de la glissade avant de retirer de l'ordre de tabulation.
        setTimeout(() => {
            tiroir.hidden = true;
            voile.hidden = true;
            if (elementAvantTiroir && elementAvantTiroir.focus) elementAvantTiroir.focus();
        }, 220);
    }

    // ==================== CYCLE DE VIE ====================

    /**
     * Bandeau de contexte : sous 1100px le rail disparaît, et une page de
     * classement ou d'échange ne dirait plus sur quel pool elle porte.
     * Toute page qui en veut un pose `<div data-fz-context></div>`.
     */
    function monterBandeaux() {
        const actif = FZPool.get();
        document.querySelectorAll('[data-fz-context]').forEach(hote => {
            if (!actif) { hote.innerHTML = ''; return; }
            const pool = FZPool.mine().find(p => p.name === actif);
            if (!pool) { hote.innerHTML = ''; return; }
            hote.innerHTML = `
                <div class="fz-context-bar">
                    ${vignette(pool, 'fz-context-img')}
                    <span class="fz-context-txt">
                        <span class="fz-context-label">Pool actif</span>
                        <span class="fz-context-name">${echapper(pool.name)}</span>
                    </span>
                    <button type="button" class="fz-context-switch">Changer</button>
                </div>`;
            hote.querySelector('.fz-context-switch').addEventListener('click', ouvrirTiroir);
        });
    }

    function rendre() {
        if (localStorage.getItem('isLoggedIn') !== 'true') return;
        monterBarreLaterale();
        monterTiroir();
        monterHamburger();
        monterBandeaux();
        montrerPucePool();
    }

    async function demarrer() {
        if (localStorage.getItem('isLoggedIn') !== 'true') return;
        await FZPool.ready();
        rendre();
        // Le rail reflète l'état des repêchages : il doit suivre les mises
        // à jour temps réel. Sauf pendant qu'on s'en sert — reconstruire le
        // menu sous le curseur ferait rater le clic.
        FZPool.onData(() => {
            const tiroir = document.getElementById('fzDrawer');
            if (listeOuverte() || (tiroir && !tiroir.hidden)) return;
            rendre();
        });
        // Sur les pages qui se remettent à jour sans recharger, le tiroir
        // resterait ouvert par-dessus le contenu qu'on vient de demander.
        FZPool.on(() => { fermerListes(); fermerTiroir(); rendre(); });
    }

    function attendreNavbar() {
        if (document.querySelector('.navbar-desktop .navbar-left')) { demarrer(); return; }
        // navbar.js peut n'avoir pas encore construit son contenu selon
        // l'ordre des scripts de la page.
        const observateur = new MutationObserver(() => {
            if (document.querySelector('.navbar-desktop .navbar-left')) {
                observateur.disconnect();
                demarrer();
            }
        });
        const navbar = document.querySelector('.navbar');
        if (navbar) observateur.observe(navbar, { childList: true, subtree: true });
        else demarrer();   // page sans navbar : le rail suffit
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attendreNavbar);
    } else {
        attendreNavbar();
    }

    window.FZNav = { render: rendre, openDrawer: ouvrirTiroir, closeDrawer: fermerTiroir };
})();
