/* Installer Fantazy — l'icône sur l'écran d'accueil.
 *
 * Le navigateur proposait l'installation une seule fois, à sa façon : Chrome
 * et Edge montrent leur propre bandeau au début, puis le taisent des mois dès
 * qu'on le ferme ; Safari sur iPhone ne propose jamais rien. Ce fichier
 * reprend la main, avec deux portes :
 *
 *   - « Installer l'application » dans le menu du compte (navbar.js), là tant
 *     que Fantazy peut s'installer sur cet appareil ;
 *   - un rappel au bas de l'écran, sur téléphone et tablette seulement, hors
 *     de la salle de repêchage : à partir de la deuxième visite, au plus une
 *     fois toutes les deux semaines, et plus jamais après trois « Plus tard »
 *     ou une fois l'application installée.
 *
 * Chrome, Edge, Samsung Internet : l'invitation du navigateur
 * (`beforeinstallprompt`) est gardée de côté et ouverte au clic. Sur iPhone et
 * iPad, aucune invitation n'existe : un guide montre le chemin (Partager, puis
 * « Sur l'écran d'accueil »). C'est aussi la condition des alertes « C'est
 * votre tour » sur iPhone (pushNotifications.js), dont la carte y renvoie. */
(function () {
    'use strict';
    if (window.FZInstallation) return;

    const CLE = 'fzInstallation:v1';
    /** Au-delà de ce silence, une nouvelle ouverture compte comme une autre visite. */
    const NOUVELLE_VISITE_MS = 30 * 60 * 1000;
    /** Le rappel ne revient pas avant. */
    const PAUSE_MS = 14 * 24 * 60 * 60 * 1000;
    /** Après autant de « Plus tard », le rappel se tait : le menu suffit. */
    const REFUS_MAX = 3;
    /** Laisser la page se poser avant de parler d'autre chose. */
    const DELAI_PREMIER_MS = 2500;
    /** Déjà montré pendant cette visite : il suit de page en page, sans se faire attendre. */
    const DELAI_SUITE_MS = 400;

    const moi = document.currentScript;
    const ua = navigator.userAgent || '';

    const estIOS = /iPad|iPhone|iPod/.test(ua)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const estAndroid = /Android/i.test(ua);
    // Les navigateurs intégrés aux applications (Facebook, Instagram,
    // Messenger…) n'offrent pas « Sur l'écran d'accueil » : un guide n'y
    // mènerait nulle part.
    const navigateurIntegre = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|LinkedInApp|MicroMessenger|musical_ly|BytedanceWebview|GSA\//.test(ua);
    const estInstallee = () =>
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
        || navigator.standalone === true;

    // ───────────────────────── Mémoire ─────────────────────────
    //
    // { visites, derniereVue, montreLe, visiteMontree, refus, installee }
    // Relue avant chaque écriture : deux onglets ne s'écrasent pas.

    function lire() {
        try { return JSON.parse(localStorage.getItem(CLE) || 'null') || {}; } catch { return {}; }
    }
    function modifier(fn) {
        const etat = lire();
        fn(etat);
        // Stockage bloqué : le compteur de visites reste à zéro, et le
        // rappel ne paraît jamais. Le menu, lui, reste là.
        try { localStorage.setItem(CLE, JSON.stringify(etat)); } catch { /* rien */ }
    }
    function connecte() {
        try { return localStorage.getItem('isLoggedIn') === 'true'; } catch { return false; }
    }

    modifier(etat => {
        const maintenant = Date.now();
        if (!etat.derniereVue || maintenant - etat.derniereVue > NOUVELLE_VISITE_MS) {
            etat.visites = (etat.visites || 0) + 1;
        }
        etat.derniereVue = maintenant;
        if (estInstallee()) etat.installee = true;
    });

    // ───────────────────────── Moyens ─────────────────────────

    let invite = null;

    /**
     * Comment installer ici : 'invite' (l'invitation du navigateur), 'ios'
     * ou 'android' (un guide), ou null — déjà installée, ou rien à proposer.
     */
    function moyen() {
        if (estInstallee()) return null;
        if (invite) return 'invite';
        if (navigateurIntegre) return null;
        if (estIOS) return 'ios';
        if (estAndroid) return 'android';
        return null;
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        // Sans ceci, Chrome montre son propre bandeau une fois, puis plus rien
        // pendant des mois. Gardée de côté, l'invitation s'ouvre à notre clic.
        e.preventDefault();
        invite = e;
        rafraichirMenu();
        planifierRappel();
    });

    window.addEventListener('appinstalled', () => {
        invite = null;
        modifier(etat => { etat.installee = true; });
        retirerRappel();
        rafraichirMenu();
    });

    // ───────────────────────── Le rappel ─────────────────────────

    /**
     * Sur téléphone et tablette, pour une personne connectée qui revient.
     * Le guide Android n'a pas de rappel : sans invitation du navigateur, on
     * ne sait pas si l'application est déjà installée, et l'y pousser serait
     * pire que se taire. Le menu le garde.
     */
    function rappelPermis() {
        const m = moyen();
        if (!(estIOS || estAndroid) || !connecte() || !(m === 'invite' || m === 'ios')) return false;
        // Jamais dans la salle de repêchage : le rappel couvrirait le bouton
        // de choix au moment où chaque seconde compte.
        if (document.body && document.body.classList.contains('fz-draft')) return false;
        const etat = lire();
        if (etat.installee || (etat.refus || 0) >= REFUS_MAX || (etat.visites || 0) < 2) return false;
        if (etat.visiteMontree && etat.visiteMontree === etat.visites) return true;
        return !etat.montreLe || Date.now() - etat.montreLe >= PAUSE_MS;
    }

    let minuterie = null;

    function planifierRappel() {
        if (minuterie || document.querySelector('.fz-installer-rappel') || !rappelPermis()) return;
        const etat = lire();
        const suite = etat.visiteMontree && etat.visiteMontree === etat.visites;
        minuterie = setTimeout(() => {
            minuterie = null;
            if (rappelPermis()) montrerRappel();
        }, suite ? DELAI_SUITE_MS : DELAI_PREMIER_MS);
    }

    /** La barre du bas des téléphones : le rappel se pose juste au-dessus. */
    function hauteurBarreDuBas() {
        const barre = document.querySelector('.bottom-nav');
        if (!barre || getComputedStyle(barre).display === 'none') return 0;
        return Math.ceil(barre.getBoundingClientRect().height);
    }

    function montrerRappel() {
        const m = moyen();
        if (!m || !document.body) return;
        // La pause de deux semaines part du premier affichage, pas de la
        // réponse : un rappel ignoré ne revient pas à la visite suivante.
        modifier(etat => {
            if (etat.visiteMontree !== etat.visites) {
                etat.visiteMontree = etat.visites;
                etat.montreLe = Date.now();
            }
        });

        const el = document.createElement('aside');
        el.className = 'fz-installer-rappel';
        el.setAttribute('aria-label', 'Installer Fantazy');
        el.style.setProperty('--fz-installer-bas', `${hauteurBarreDuBas()}px`);
        el.innerHTML = `
            <img class="fz-installer-icone" src="Icons/app-192.png" alt="" width="44" height="44">
            <div class="fz-installer-txt">
                <strong class="fz-installer-titre">Fantazy sur votre écran d’accueil</strong>
                <span class="fz-installer-sous">${estIOS
                    ? 'En plein écran, avec les alertes « C’est votre tour » sur cet appareil.'
                    : 'En plein écran, ouvert d’un toucher comme une application.'}</span>
            </div>
            <div class="fz-installer-outils">
                <button type="button" class="fz-installer-btn" data-fz-installer="plus-tard">Plus tard</button>
                <button type="button" class="fz-installer-btn is-main" data-fz-installer="rappel">${m === 'invite' ? 'Installer' : 'Comment faire'}</button>
            </div>`;
        document.body.appendChild(el);
    }

    function retirerRappel() {
        if (minuterie) { clearTimeout(minuterie); minuterie = null; }
        document.querySelectorAll('.fz-installer-rappel').forEach(el => el.remove());
    }

    /** « Plus tard » : deux semaines de silence ; au troisième, pour de bon. */
    function remettre() {
        retirerRappel();
        modifier(etat => {
            etat.refus = (etat.refus || 0) + 1;
            etat.montreLe = Date.now();
            etat.visiteMontree = null;
        });
    }

    // ───────────────────────── Installer ─────────────────────────

    const PARTAGER = '<svg class="fz-installer-glyphe" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Partager" role="img"><path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M8 11H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2"/></svg>';

    const GUIDES = {
        ios: {
            etapes: [
                `Touchez le bouton <strong>Partager</strong> ${PARTAGER} du navigateur. Dans Safari, il est au bas de l’écran, ou dans le menu <strong>•••</strong> selon votre version.`,
                'Faites défiler et choisissez <strong>Sur l’écran d’accueil</strong>. Si l’option <strong>Ouvrir en tant qu’app web</strong> paraît, laissez-la activée.',
                'Touchez <strong>Ajouter</strong>, puis ouvrez Fantazy depuis sa nouvelle icône.'
            ],
            note: 'Ouverte depuis l’icône, Fantazy a sa propre session, à part de Safari : connectez-vous-y une fois. Vous pourrez ensuite y activer les alertes.'
        },
        android: {
            etapes: [
                'Ouvrez le menu du navigateur : <strong>⋮</strong> en haut à droite dans Chrome, <strong>≡</strong> en bas dans Samsung Internet.',
                'Choisissez <strong>Installer l’application</strong> ou <strong>Ajouter à l’écran d’accueil</strong>.',
                'Confirmez, puis ouvrez Fantazy depuis sa nouvelle icône.'
            ],
            note: null
        }
    };

    /**
     * Le guide, pour les appareils où le navigateur n'offre rien à ouvrir.
     * Résout vrai si la personne dit l'avoir fait.
     */
    async function ouvrirGuide(type) {
        const guide = GUIDES[type];
        if (!guide || typeof fzModal !== 'function') return false;
        const fait = await fzModal({
            title: 'Installer Fantazy',
            icon: 'download',
            align: 'start',
            bodyHTML: `<ol class="fz-installer-etapes">${guide.etapes.map(e => `<li>${e}</li>`).join('')}</ol>`,
            note: guide.note || undefined,
            confirmLabel: 'C’est fait',
            cancelLabel: 'Plus tard'
        });
        if (fait) modifier(etat => { etat.installee = true; });
        return !!fait;
    }

    /**
     * Ouvre l'installation. L'invitation du navigateur doit partir pendant le
     * clic lui-même : rien n'est attendu avant `prompt()`.
     */
    function installer(depuisRappel) {
        const m = moyen();
        if (!m) return;
        retirerRappel();

        if (m === 'invite') {
            const choix = invite;
            invite = null; // une invitation ne sert qu'une fois
            rafraichirMenu();
            try {
                const ouverte = choix.prompt();
                if (ouverte && typeof ouverte.catch === 'function') ouverte.catch(() => {});
            } catch { return; }
            Promise.resolve(choix.userChoice).then((reponse) => {
                if (reponse && reponse.outcome === 'accepted') modifier(etat => { etat.installee = true; });
                else if (depuisRappel) remettre();
            }).catch(() => {});
            return;
        }

        ouvrirGuide(m).then((fait) => {
            if (!fait && depuisRappel) remettre();
        });
    }

    // ───────────────────────── Le menu du compte ─────────────────────────

    function rafraichirMenu() {
        const visible = !!moyen();
        document.querySelectorAll('[data-fz-installer-menu]').forEach(el => {
            el.style.display = visible ? '' : 'none';
        });
    }

    function fermerMenuCompte() {
        const menu = document.getElementById('userDropdownMenu');
        if (menu) menu.classList.remove('show');
        const bouton = document.getElementById('userAvatarBtn');
        if (bouton) bouton.setAttribute('aria-expanded', 'false');
    }

    document.addEventListener('click', (e) => {
        const cible = e.target.closest && e.target.closest('[data-fz-installer]');
        if (!cible) return;
        const action = cible.dataset.fzInstaller;
        if (action === 'plus-tard') return remettre();
        if (action === 'menu') fermerMenuCompte();
        installer(action === 'rappel');
    });

    // ───────────────────────── Départ ─────────────────────────

    if (moi && moi.src && !document.querySelector('link[data-fz-installer-css]')) {
        const feuille = document.createElement('link');
        feuille.rel = 'stylesheet';
        feuille.href = moi.src.replace(/\.js(\?|$)/, '.css$1');
        feuille.dataset.fzInstallerCss = '';
        document.head.appendChild(feuille);
    }

    window.FZInstallation = {
        /** Vrai si Fantazy peut s'installer sur cet appareil (la carte des alertes s'en sert). */
        possible: () => !!moyen(),
        installer: () => installer(false)
    };

    // Après la barre de navigation : son menu doit exister pour être montré.
    function demarrer() {
        rafraichirMenu();
        planifierRappel();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(demarrer, 0));
    else setTimeout(demarrer, 0);
})();
