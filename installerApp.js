/* Le panneau du bas — deux invitations, jamais en même temps :
 *
 *   - « Activer les alertes ? » : votre tour au repêchage et les offres
 *     d'échange, même Fantazy fermé (pushNotifications.js fait le travail) ;
 *   - « Fantazy sur votre écran d'accueil » : installer l'application.
 *
 * Règles communes : une personne connectée, hors salle de repêchage, jamais
 * par-dessus une fenêtre ouverte, au plus UNE invitation par visite (elle
 * suit de page en page pendant la visite), et trois jours au moins entre deux
 * invitations différentes. Rien quand c'est déjà fait, ni quand le navigateur
 * a bloqué les alertes (la cloche explique comment les débloquer). On le
 * glisse vers le bas, ou « Plus tard ».
 *
 * Les alertes passent d'abord — elles marchent sans installer — sauf sur
 * iPhone et iPad : Safari ne les offre qu'à Fantazy ouvert depuis l'écran
 * d'accueil. Là, l'installation vient d'abord, et les alertes sont proposées
 * dès la première ouverture depuis l'icône.
 *
 * La fenêtre d'autorisation du navigateur ne s'ouvre qu'au toucher
 * d'« Activer » : un refus y est définitif, et Chrome fait taire les sites
 * dont on refuse trop souvent la demande.
 *
 * Alertes : à partir de la deuxième visite ; après un « Plus tard », une
 * semaine, puis un mois, puis plus jamais (la cloche garde le réglage). Une
 * occasion (une offre d'échange qu'on vient d'envoyer) peut la devancer.
 *
 * Installer, sur téléphone et tablette : à partir de la deuxième visite, au
 * plus une fois toutes les deux semaines, plus jamais après trois « Plus
 * tard ». Aussi, toujours, « Installer l'application » dans le menu du
 * compte. Chrome, Edge, Samsung Internet : l'invitation du navigateur
 * (`beforeinstallprompt`) est gardée de côté et ouverte au clic. Sur iPhone,
 * aucune invitation n'existe : un guide montre le chemin (Partager, puis
 * « Sur l'écran d'accueil »). */
(function () {
    'use strict';
    if (window.FZInstallation) return;

    const CLE = 'fzInstallation:v1';
    /** L'invitation aux alertes : { montreLe, visiteMontree, refus }. */
    const CLE_ALERTES = 'fzInvites:alertes:v1';
    /** L'invitation de la visite en cours, toutes sortes confondues : { visite, type, le }. */
    const CLE_VISITE = 'fzInvites:visite:v1';
    /** Au-delà de ce silence, une nouvelle ouverture compte comme une autre visite. */
    const NOUVELLE_VISITE_MS = 30 * 60 * 1000;
    /** Le rappel ne revient pas avant. */
    const PAUSE_MS = 14 * 24 * 60 * 60 * 1000;
    /** Après autant de « Plus tard », le rappel se tait : le menu suffit. */
    const REFUS_MAX = 3;
    const JOUR_MS = 24 * 60 * 60 * 1000;
    /** Alertes : silence après un affichage, selon le nombre de « Plus tard » déjà dits. */
    const PAUSE_ALERTES_MS = refus => (refus >= 2 ? 30 : 7) * JOUR_MS;
    /** Une occasion peut devancer la pause, pas reparler le jour même. */
    const PAUSE_OCCASION_MS = JOUR_MS;
    /** Entre deux invitations différentes. */
    const ESPACEMENT_MS = 3 * JOUR_MS;
    /** Laisser la page se poser avant de parler d'autre chose. */
    const DELAI_PREMIER_MS = 3000;
    /** Les alertes répondent après un aller-retour au serveur : on ne les attend pas plus. */
    const ATTENTE_ALERTES_MS = 8000;
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

    function lire(cle = CLE) {
        try { return JSON.parse(localStorage.getItem(cle) || 'null') || {}; } catch { return {}; }
    }
    function modifier(fn, cle = CLE) {
        const etat = lire(cle);
        fn(etat);
        // Stockage bloqué : le compteur de visites reste à zéro, et le
        // panneau ne paraît jamais. Le menu et la cloche, eux, restent là.
        try { localStorage.setItem(cle, JSON.stringify(etat)); } catch { /* rien */ }
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
        planifier();
    });

    window.addEventListener('appinstalled', () => {
        invite = null;
        modifier(etat => { etat.installee = true; });
        retirer('installer');
        rafraichirMenu();
    });

    // ───────────────────────── Le panneau ─────────────────────────

    const estTelephoneOuTablette = estIOS || estAndroid;
    const alertes = () => window.FZAlertes || null;
    const etatAlertes = () => (alertes() ? alertes().etat() : null);

    /** L'invitation déjà montrée pendant CETTE visite, s'il y en a une. */
    function inviteDeLaVisite() {
        const v = lire(CLE_VISITE);
        return v.visite && v.visite === (lire().visites || 0) ? v.type : null;
    }
    /** Elle a eu sa réponse (ou a été fermée) : elle ne suit plus de page en page. */
    const inviteRepondue = () => !!lire(CLE_VISITE).repondue;
    /** La dernière invitation montrée, d'une autre sorte que `type`, il y a moins de trois jours. */
    function tropTotApres(type) {
        const v = lire(CLE_VISITE);
        return !!v.type && v.type !== type && !!v.le && Date.now() - v.le < ESPACEMENT_MS;
    }

    /** Ce qui empêche toute invitation, quelle qu'elle soit. */
    function silence() {
        if (!connecte() || !document.body) return true;
        // Jamais dans la salle de repêchage : le panneau couvrirait le bouton
        // de choix au moment où chaque seconde compte. Sa bande s'en charge.
        if (document.body.classList.contains('fz-draft')) return true;
        // Jamais par-dessus une fenêtre ouverte (fzDialog).
        if (document.documentElement.classList.contains('fzd-lock')) return true;
        return document.visibilityState === 'hidden';
    }

    /**
     * Les alertes : coupées ici, mais possibles (ni bloquées, ni iPhone hors
     * de l'écran d'accueil, ni serveur sans clé).
     */
    function alertesPermises(occasion = false) {
        if (silence() || etatAlertes() !== 'inactif') return false;
        const etat = lire(CLE_ALERTES);
        if ((etat.refus || 0) >= REFUS_MAX) return false;
        const deLaVisite = inviteDeLaVisite();
        if (deLaVisite) return deLaVisite === 'alertes' && !inviteRepondue();
        if (!occasion) {
            // Ouverte depuis l'icône, Fantazy n'a que cette raison d'exister
            // sur iPhone : les alertes dès la première ouverture.
            if ((lire().visites || 0) < 2 && !estInstallee()) return false;
            if (tropTotApres('alertes')) return false;
        }
        if (!etat.montreLe) return true;
        const pause = occasion ? PAUSE_OCCASION_MS : PAUSE_ALERTES_MS(etat.refus || 0);
        return Date.now() - etat.montreLe >= pause;
    }

    /**
     * Installer : sur téléphone et tablette, pour une personne qui revient.
     * Le guide Android n'a pas de rappel : sans invitation du navigateur, on
     * ne sait pas si l'application est déjà installée, et l'y pousser serait
     * pire que se taire. Le menu le garde.
     */
    function installerPermis() {
        const m = moyen();
        if (silence() || !estTelephoneOuTablette || !(m === 'invite' || m === 'ios')) return false;
        const etat = lire();
        if (etat.installee || (etat.refus || 0) >= REFUS_MAX || (etat.visites || 0) < 2) return false;
        const deLaVisite = inviteDeLaVisite();
        if (deLaVisite) return deLaVisite === 'installer' && !inviteRepondue();
        if (tropTotApres('installer')) return false;
        return !etat.montreLe || Date.now() - etat.montreLe >= PAUSE_MS;
    }

    /** Laquelle montrer, s'il y en a une : les alertes d'abord, elles servent tout de suite. */
    function choisir() {
        if (document.querySelector('.fz-invite')) return null;
        if (alertesPermises()) return 'alertes';
        if (installerPermis()) return 'installer';
        return null;
    }

    let minuterie = null;
    let attenteFinie = false;

    function planifier() {
        if (minuterie || document.querySelector('.fz-invite') || silence()) return;
        const suite = !!inviteDeLaVisite();
        // L'état des alertes n'est pas encore connu : on attend sa réponse
        // (événement « fz:alertes »), ou la fin de l'attente.
        const alertesEnRoute = !attenteFinie && (!alertes() || etatAlertes() === 'chargement');
        if (alertesEnRoute && !suite) return;
        minuterie = setTimeout(() => {
            minuterie = null;
            const type = choisir();
            if (type) montrer(type);
        }, suite ? DELAI_SUITE_MS : DELAI_PREMIER_MS);
    }

    /** La barre du bas des téléphones : le panneau se pose juste au-dessus. */
    function hauteurBarreDuBas() {
        const barre = document.querySelector('.bottom-nav');
        if (!barre || getComputedStyle(barre).display === 'none') return 0;
        return Math.ceil(barre.getBoundingClientRect().height);
    }

    const CLOCHE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
    const COCHE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>';

    const echapper = texte => String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    /** Le contenu de chaque invitation. */
    function contenu(type, occasion) {
        if (type === 'alertes') {
            const equipe = occasion && occasion.equipe;
            return {
                etiquette: 'Activer les alertes',
                icone: `<span class="fz-invite-ico" aria-hidden="true">${CLOCHE}</span>`,
                titre: equipe ? 'Être averti de sa réponse ?' : 'Activer les alertes ?',
                sous: equipe
                    ? `Une alerte dès que ${echapper(equipe)} répond, même Fantazy fermé.`
                    : 'Votre tour au repêchage et les offres d’échange, même Fantazy fermé.',
                principal: 'Activer'
            };
        }
        return {
            etiquette: 'Installer Fantazy',
            icone: '<img class="fz-installer-icone" src="Icons/app-192.png" alt="" width="44" height="44">',
            titre: 'Fantazy sur votre écran d’accueil',
            sous: estIOS
                ? 'En plein écran, et c’est ce qui permet les alertes sur iPhone.'
                : 'En plein écran, ouvert d’un toucher comme une application.',
            principal: moyen() === 'invite' ? 'Installer' : 'Comment faire'
        };
    }

    function montrer(type, occasion = null) {
        if (!document.body || document.querySelector('.fz-invite')) return;
        // La pause part du premier affichage, pas de la réponse : une
        // invitation ignorée ne revient pas à la visite suivante.
        const visites = lire().visites || 0;
        const premiere = inviteDeLaVisite() !== type;
        if (premiere) {
            modifier(etat => { etat.visite = visites; etat.type = type; etat.le = Date.now(); etat.repondue = false; }, CLE_VISITE);
            modifier(etat => { etat.visiteMontree = visites; etat.montreLe = Date.now(); },
                type === 'alertes' ? CLE_ALERTES : CLE);
        }

        const c = contenu(type, occasion);
        const el = document.createElement('aside');
        el.className = `fz-invite fz-installer-rappel fz-invite--${type}`;
        el.dataset.fzInviteType = type;
        el.setAttribute('aria-label', c.etiquette);
        el.style.setProperty('--fz-installer-bas', `${hauteurBarreDuBas()}px`);
        el.innerHTML = `
            ${c.icone}
            <div class="fz-installer-txt">
                <strong class="fz-installer-titre">${c.titre}</strong>
                <span class="fz-installer-sous" role="status">${c.sous}</span>
            </div>
            <div class="fz-installer-outils">
                <button type="button" class="fz-installer-btn" data-fz-invite="plus-tard">Plus tard</button>
                <button type="button" class="fz-installer-btn is-main" data-fz-invite="${type === 'alertes' ? 'activer' : 'installer'}">${c.principal}</button>
            </div>`;
        if (!premiere) el.classList.add('is-suite');
        document.body.appendChild(el);
        brancherGlisser(el);
    }

    /** Retire le panneau, en glissant vers le bas. */
    function retirer(type) {
        if (minuterie) { clearTimeout(minuterie); minuterie = null; }
        if (document.querySelector('.fz-invite')) modifier(etat => { etat.repondue = true; }, CLE_VISITE);
        document.querySelectorAll('.fz-invite').forEach(el => {
            if (type && el.dataset.fzInviteType !== type) return;
            if (el.classList.contains('is-sortie')) return;
            el.classList.add('is-sortie');
            el.style.transform = '';
            const fin = () => el.remove();
            el.addEventListener('animationend', fin, { once: true });
            setTimeout(fin, 400);
        });
    }

    /**
     * « Plus tard » : on retient le refus. Alertes : une semaine, puis un
     * mois, puis plus jamais. Installer : deux semaines ; au troisième, pour
     * de bon.
     */
    function remettre(type) {
        retirer(type);
        modifier(etat => {
            etat.refus = (etat.refus || 0) + 1;
            etat.montreLe = Date.now();
            etat.visiteMontree = null;
        }, type === 'alertes' ? CLE_ALERTES : CLE);
        // Plus rien d'autre pendant cette visite : un refus n'appelle pas une autre question.
    }

    /** Glisser le panneau vers le bas vaut « Plus tard ». */
    function brancherGlisser(el) {
        let depart = null;
        let ecart = 0;
        el.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' || e.target.closest('button')) return;
            depart = e.clientY;
            ecart = 0;
            el.classList.add('is-glisse');
            try { el.setPointerCapture(e.pointerId); } catch { /* rien */ }
        });
        el.addEventListener('pointermove', (e) => {
            if (depart == null) return;
            ecart = Math.max(0, e.clientY - depart);
            el.style.transform = `translateY(${ecart}px)`;
        });
        const lacher = () => {
            if (depart == null) return;
            depart = null;
            el.classList.remove('is-glisse');
            if (ecart > 56) remettre(el.dataset.fzInviteType);
            else el.style.transform = '';
        };
        el.addEventListener('pointerup', lacher);
        el.addEventListener('pointercancel', lacher);
    }

    /**
     * « Activer » : la fenêtre du navigateur s'ouvre pendant le toucher même
     * (FZAlertes.activer la demande avant tout `await`).
     */
    async function activerAlertes(el) {
        const a = alertes();
        if (!a) return;
        const enCours = a.activer();
        const boutons = el.querySelectorAll('button');
        boutons.forEach(b => { b.disabled = true; });
        el.setAttribute('aria-busy', 'true');
        const reussi = await enCours.catch(() => false);
        el.removeAttribute('aria-busy');

        if (reussi) {
            el.classList.add('is-fait');
            el.querySelector('.fz-invite-ico').innerHTML = COCHE;
            el.querySelector('.fz-installer-titre').textContent = 'Alertes activées';
            el.querySelector('.fz-installer-sous').textContent = 'Cet appareil vous préviendra. Le réglage est dans la cloche.';
            el.querySelector('.fz-installer-outils').remove();
            setTimeout(() => retirer('alertes'), 2200);
            return;
        }
        if (a.etat() === 'refuse') {
            // Bloquées dans le navigateur : plus de question, la cloche dit comment les débloquer.
            modifier(etat => { etat.refus = REFUS_MAX; }, CLE_ALERTES);
            retirer('alertes');
            return;
        }
        if (a.etat() !== 'inactif') { retirer('alertes'); return; }
        // Fenêtre du navigateur fermée sans répondre, ou échec de l'abonnement.
        el.querySelector('.fz-installer-sous').textContent =
            'Ça n’a pas fonctionné cette fois. Vous pourrez réessayer depuis la cloche.';
        boutons.forEach(b => { b.disabled = false; });
        const principal = el.querySelector('[data-fz-invite="activer"]');
        if (principal) principal.remove();
        const plusTard = el.querySelector('[data-fz-invite="plus-tard"]');
        if (plusTard) plusTard.textContent = 'Fermer';
    }

    document.addEventListener('fz:alertes', (e) => {
        const etat = e.detail && e.detail.etat;
        // Activées ou bloquées ailleurs (la cloche, un autre onglet) : le panneau n'a plus rien à dire.
        if (etat && etat !== 'inactif' && etat !== 'chargement') {
            const ouvert = document.querySelector('.fz-invite--alertes:not(.is-fait)');
            if (ouvert) retirer('alertes');
        }
        planifier();
    });

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
        retirer('installer');

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
                else if (depuisRappel) remettre('installer');
            }).catch(() => {});
            return;
        }

        ouvrirGuide(m).then((fait) => {
            if (!fait && depuisRappel) remettre('installer');
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
        const panneau = e.target.closest && e.target.closest('[data-fz-invite]');
        if (panneau && !panneau.disabled) {
            const el = panneau.closest('.fz-invite');
            const type = el && el.dataset.fzInviteType;
            const action = panneau.dataset.fzInvite;
            if (action === 'plus-tard') return el.classList.contains('is-fait') ? retirer(type) : remettre(type);
            if (action === 'activer') return activerAlertes(el);
            if (action === 'installer') return installer(true);
            return;
        }
        const cible = e.target.closest && e.target.closest('[data-fz-installer]');
        if (!cible) return;
        const action = cible.dataset.fzInstaller;
        if (action === 'menu') fermerMenuCompte();
        installer(false);
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

    window.FZInvites = {
        /**
         * Un moment qui donne une raison de proposer les alertes, comme une
         * offre d'échange qu'on vient d'envoyer (`{ equipe }`). Devance la
         * pause habituelle, jamais un refus définitif ni l'invitation déjà
         * montrée pendant cette visite.
         */
        occasion(type, details = {}) {
            if (type !== 'echange' || !alertesPermises(true)) return false;
            if (minuterie) { clearTimeout(minuterie); minuterie = null; }
            setTimeout(() => {
                if (alertesPermises(true) && !document.querySelector('.fz-invite')) montrer('alertes', details);
            }, 700);
            return true;
        }
    };

    // Après la barre de navigation : son menu doit exister pour être montré.
    function demarrer() {
        rafraichirMenu();
        planifier();
        // Les alertes n'ont pas répondu à temps (ou cette page ne les charge
        // pas) : on décide sans elles.
        setTimeout(() => { attenteFinie = true; planifier(); }, ATTENTE_ALERTES_MS);
    }
    // Une fenêtre qui se ferme, un onglet qui revient : l'occasion se représente.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') planifier(); });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(demarrer, 0));
    else setTimeout(demarrer, 0);
})();
