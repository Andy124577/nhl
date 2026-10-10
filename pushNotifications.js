/* Alertes sur l'appareil — « C'est à votre tour » même quand Fantazy est fermé.
 *
 * Chargé par notifications.js (la cloche), donc sur chaque page qui l'a. Il
 * s'occupe de trois choses :
 *
 *   - l'abonnement de CE navigateur : service worker (sw.js), autorisation,
 *     pushManager, puis remise au serveur (/api/push/subscribe) ;
 *   - le réglage, là où une page pose `data-fz-alertes` : « carte » dans le
 *     salon du repêchage, « reglage » au pied de la cloche, « bande » sous le
 *     carrousel de la salle de repêchage. Une page qui se redessine (le salon,
 *     à chaque signal temps réel) retrouve le sien tout seul.
 *
 * L'autorisation n'est demandée qu'après un clic : un navigateur ne l'accorde
 * pas autrement (Safari), ou la relègue en silence (Chrome).
 *
 * Sur iPhone et iPad, Safari n'offre les alertes qu'à un site ajouté à l'écran
 * d'accueil et ouvert depuis son icône (iOS 16.4 et plus) : le réglage le dit
 * au lieu d'offrir un bouton qui ne ferait rien. */
(function () {
    'use strict';
    if (window.FZAlertes) return;

    const CLE_SYNCHRO = 'fzAlertes:v1';
    const CLE_MASQUEE = 'fzAlertes:bande-masquee';
    // La page reconfirme son abonnement au serveur de temps en temps, pas à
    // chaque ouverture : chaque confirmation est une écriture en base.
    const RESYNCHRO_MS = 7 * 24 * 60 * 60 * 1000;
    // La bande de la salle masquée d'un clic : elle ne revient pas avant.
    const MASQUEE_MS = 30 * 24 * 60 * 60 * 1000;

    const moi = document.currentScript;

    const ICONES = {
        cloche: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
        active: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m9 9.5 2 2 4-4"/>',
        bloquee: '<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
        telephone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>'
    };
    const svg = (nom, taille = 20) =>
        `<svg viewBox="0 0 24 24" width="${taille}" height="${taille}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONES[nom]}</svg>`;

    const echapper = texte => String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    function lire(cle) {
        try { return JSON.parse(localStorage.getItem(cle) || 'null'); } catch { return null; }
    }
    function ecrire(cle, valeur) {
        try {
            if (valeur == null) localStorage.removeItem(cle);
            else localStorage.setItem(cle, JSON.stringify(valeur));
        } catch { /* stockage indisponible : la page redemandera, c'est tout */ }
    }
    function compte() {
        try {
            return localStorage.getItem('isLoggedIn') === 'true' ? localStorage.getItem('username') : null;
        } catch { return null; }
    }
    const base = () => (window.FZPool && window.FZPool.BASE_URL) || '';

    const estIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const estInstallee = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
        || navigator.standalone === true;
    const supporte = () => window.isSecureContext && 'serviceWorker' in navigator
        && 'PushManager' in window && 'Notification' in window;

    /** base64url → octets, pour applicationServerKey. */
    function octets(texte) {
        const b64 = texte.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - texte.length % 4) % 4);
        return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    }
    function base64url(tampon) {
        return btoa(String.fromCharCode(...new Uint8Array(tampon)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    async function appeler(chemin, corps) {
        const reponse = await fetch(`${base()}${chemin}`, {
            method: corps === undefined ? 'GET' : 'POST',
            headers: corps === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: corps === undefined ? undefined : JSON.stringify(corps),
            cache: 'no-store',
            signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(15000) : undefined
        });
        const donnees = await reponse.json().catch(() => ({}));
        return { ok: reponse.ok, statut: reponse.status, donnees };
    }

    // ───────────────────────── État ─────────────────────────
    //
    // chargement → non-supporte | ios-installer | indisponible | refuse | inactif | actif

    let etat = 'chargement';
    let occupe = false;
    let message = null;          // { texte, ton: 'ok' | 'erreur' | '' }
    let clePublique = null;
    const ecouteurs = new Set();

    function changer(nouveau) {
        etat = nouveau;
        rendre();
        for (const fn of ecouteurs) { try { fn(etat); } catch { /* écouteur fautif */ } }
    }

    function dire(texte, ton = '') {
        message = texte ? { texte, ton } : null;
        rendre();
    }

    /** L'enregistrement du service worker s'il existe déjà — sans en créer un. */
    async function enregistrementExistant() {
        try { return (await navigator.serviceWorker.getRegistration('/')) || null; } catch { return null; }
    }

    async function remettreAuServeur(abonnement) {
        const { ok, donnees } = await appeler('/api/push/subscribe', { subscription: abonnement.toJSON() });
        if (!ok) throw new Error(donnees.message || 'Abonnement refusé.');
        ecrire(CLE_SYNCHRO, { compte: compte(), endpoint: abonnement.endpoint, le: Date.now() });
    }

    async function abonner() {
        await navigator.serviceWorker.register('/sw.js');
        // subscribe() exige un service worker ACTIF, pas seulement enregistré.
        const pret = await navigator.serviceWorker.ready;
        const abonnement = await pret.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: octets(clePublique)
        });
        await remettreAuServeur(abonnement);
        return abonnement;
    }

    /**
     * Ce navigateur est-il abonné, pour ce compte et avec la clé actuelle du
     * serveur ? Remet le serveur d'aplomb au passage.
     */
    async function synchroniser() {
        if (Notification.permission === 'denied') return changer('refuse');

        const enregistrement = await enregistrementExistant();
        const abonnement = enregistrement
            ? await enregistrement.pushManager.getSubscription().catch(() => null)
            : null;
        if (!abonnement || Notification.permission !== 'granted') return changer('inactif');

        const deja = lire(CLE_SYNCHRO);

        // Abonné par un autre compte, dans ce même navigateur : c'est à cette
        // personne-ci de choisir. L'ancien abonnement meurt ici ; le serveur
        // retire sa ligne au prochain envoi (410).
        if (deja && deja.compte && deja.compte !== compte()) {
            await abonnement.unsubscribe().catch(() => {});
            ecrire(CLE_SYNCHRO, null);
            return changer('inactif');
        }

        // La clé du serveur a changé : cet abonnement ne recevra plus rien.
        const cle = abonnement.options && abonnement.options.applicationServerKey;
        if (cle && base64url(cle) !== clePublique) {
            await abonnement.unsubscribe().catch(() => {});
            try { await abonner(); return changer('actif'); } catch { return changer('inactif'); }
        }

        changer('actif');
        if (!deja || deja.endpoint !== abonnement.endpoint || Date.now() - (deja.le || 0) > RESYNCHRO_MS) {
            remettreAuServeur(abonnement).catch(() => { /* réessayé à la prochaine visite */ });
        }
    }

    async function demarrer() {
        if (!compte()) return changer('non-supporte');
        if (!supporte()) return changer(estIOS() && !estInstallee() ? 'ios-installer' : 'non-supporte');
        try {
            const { ok, donnees } = await appeler('/api/push/config');
            if (!ok || !donnees.disponible || !donnees.clePublique) return changer('indisponible');
            clePublique = donnees.clePublique;
            await synchroniser();
        } catch {
            changer('indisponible');
        }
    }

    // ───────────────────────── Gestes ─────────────────────────

    /** L'autorisation, en promesse partout (l'ancien Safari prend un rappel). */
    function demanderAutorisation() {
        return new Promise(resolve => {
            const retour = Notification.requestPermission(resolve);
            if (retour && typeof retour.then === 'function') retour.then(resolve, () => resolve('default'));
        });
    }

    /**
     * Activer : appelé depuis un clic, et l'autorisation AVANT tout `await` —
     * Safari n'ouvre la question qu'au cours du geste lui-même.
     */
    async function activer() {
        if (occupe || !clePublique) return false;
        const autorisation = demanderAutorisation();
        occupe = true;
        dire(null);
        try {
            const reponse = await autorisation;
            if (reponse !== 'granted') {
                if (reponse === 'denied') changer('refuse');
                else dire('Autorisation non accordée : rien n’a changé.');
                return false;
            }
            await abonner();
            occupe = false;
            // Le nouvel état le dit déjà (« Alertes activées ») : pas de message en plus.
            changer('actif');
            return true;
        } catch {
            dire('L’abonnement a échoué dans ce navigateur. Réessayez dans un instant, ou essayez un autre navigateur.', 'erreur');
            return false;
        } finally {
            occupe = false;
            rendre();
        }
    }

    async function desactiver() {
        if (occupe) return;
        occupe = true;
        dire(null);
        try {
            const enregistrement = await enregistrementExistant();
            const abonnement = enregistrement && await enregistrement.pushManager.getSubscription().catch(() => null);
            if (abonnement) {
                await appeler('/api/push/unsubscribe', { endpoint: abonnement.endpoint }).catch(() => {});
                await abonnement.unsubscribe().catch(() => {});
            }
            ecrire(CLE_SYNCHRO, null);
            occupe = false;
            changer('inactif');
            dire('Alertes désactivées sur cet appareil.');
        } finally {
            occupe = false;
            rendre();
        }
    }

    async function essayer() {
        if (occupe) return;
        occupe = true;
        dire(null);
        try {
            const { ok, donnees } = await appeler('/api/push/test', {});
            dire(ok ? 'Essai envoyé : l’alerte devrait apparaître dans quelques secondes.'
                    : (donnees.message || 'L’essai n’a pas pu partir.'), ok ? 'ok' : 'erreur');
        } catch {
            dire('L’essai n’a pas pu partir. Vérifiez votre connexion.', 'erreur');
        } finally {
            occupe = false;
            rendre();
        }
    }

    // ───────────────────────── Affichage ─────────────────────────

    function bouton(action, libelle, principal = false) {
        return `<button type="button" class="fz-alertes-btn${principal ? ' is-main' : ''}" data-fz-alertes-action="${action}"${occupe ? ' disabled aria-busy="true"' : ''}>${echapper(libelle)}</button>`;
    }

    /** « Voir comment » : le guide d'installation (installerApp.js), s'il peut servir ici. */
    function boutonGuide(libelle, principal) {
        if (!window.FZInstallation || !window.FZInstallation.possible()) return '';
        return `<button type="button" class="fz-alertes-btn${principal ? ' is-main' : ''}" data-fz-installer="alertes">${echapper(libelle)}</button>`;
    }

    function ligneMessage() {
        return `<p class="fz-alertes-msg${message && message.ton ? ` is-${message.ton}` : ''}" role="status">${message ? echapper(message.texte) : ''}</p>`;
    }

    /** Le salon du repêchage : une carte qui dit l'état et ce qu'on peut y faire. */
    function carte() {
        const vue = {
            inactif: { classe: 'is-inactif', icone: 'cloche', titre: 'Soyez averti à votre tour',
                texte: 'Une alerte sur ce téléphone ou cet ordinateur quand c’est à vous de choisir, même Fantazy fermé.',
                outils: bouton('activer', 'Activer les alertes', true) },
            actif: { classe: 'is-actif', icone: 'active', titre: 'Alertes activées',
                texte: 'Cet appareil vous préviendra quand ce sera votre tour de choisir.',
                outils: bouton('essai', 'Envoyer un essai') + bouton('desactiver', 'Désactiver') },
            refuse: { classe: 'is-bloquee', icone: 'bloquee', titre: 'Alertes bloquées',
                texte: 'Les notifications de Fantazy sont bloquées dans ce navigateur. Autorisez-les dans les réglages du site, puis rechargez la page.',
                outils: '' },
            'ios-installer': { classe: 'is-inactif', icone: 'telephone', titre: 'Alertes sur iPhone et iPad',
                texte: 'Ajoutez d’abord Fantazy à l’écran d’accueil : bouton Partager, puis « Sur l’écran d’accueil ». Ouvrez Fantazy depuis cette icône : vous pourrez alors activer les alertes.',
                outils: boutonGuide('Voir comment', true) }
        }[etat];
        if (!vue) return '';
        return `
            <section class="fz-alertes ${vue.classe}" aria-label="Alertes sur cet appareil">
                <span class="fz-alertes-ico" aria-hidden="true">${svg(vue.icone)}</span>
                <div class="fz-alertes-txt">
                    <span class="fz-alertes-label">Alertes sur cet appareil</span>
                    <strong class="fz-alertes-titre">${vue.titre}</strong>
                    <span class="fz-alertes-sub">${vue.texte}</span>
                </div>
                ${vue.outils ? `<div class="fz-alertes-outils">${vue.outils}</div>` : ''}
                ${ligneMessage()}
            </section>`;
    }

    /** Le pied de la cloche : une ligne, pour activer ou couper sur toutes les pages. */
    function reglage() {
        const vue = {
            inactif: { texte: '<strong>Alertes sur cet appareil</strong> Être averti à votre tour de repêcher.',
                outils: bouton('activer', 'Activer', true) },
            actif: { texte: '<strong>Alertes activées</strong> sur cet appareil.',
                outils: bouton('essai', 'Essai') + bouton('desactiver', 'Désactiver') },
            refuse: { texte: '<strong>Alertes bloquées</strong> dans les réglages de ce navigateur.', outils: '' },
            'ios-installer': { texte: '<strong>Alertes</strong> Ajoutez Fantazy à l’écran d’accueil pour les recevoir.',
                outils: boutonGuide('Comment', true) }
        }[etat];
        if (!vue) return '';
        return `
            <div class="fz-alertes-reglage is-${etat}">
                <span class="fz-alertes-ico" aria-hidden="true">${svg(etat === 'actif' ? 'active' : etat === 'refuse' ? 'bloquee' : 'cloche', 16)}</span>
                <span class="fz-alertes-reglage-txt">${vue.texte}</span>
                ${vue.outils ? `<span class="fz-alertes-outils">${vue.outils}</span>` : ''}
            </div>
            ${ligneMessage()}`;
    }

    const bandeMasquee = () => {
        const le = lire(CLE_MASQUEE);
        return !!le && Date.now() - le < MASQUEE_MS;
    };

    /**
     * La salle de repêchage : une ligne sous le carrousel, seulement tant que
     * les alertes sont coupées — c'est là qu'on attend son tour. Activées,
     * bloquées ou impossibles ici, elle s'efface : la cloche garde le réglage
     * complet. La croix la masque un mois sur cet appareil.
     */
    function bande() {
        if (etat !== 'inactif' || bandeMasquee()) return '';
        const sous = message ? message.texte : 'Être averti à votre tour de repêcher.';
        return `
            <div class="fz-alertes-bande-corps">
                <span class="fz-alertes-ico" aria-hidden="true">${svg('cloche', 16)}</span>
                <span class="fz-alertes-bande-txt"><strong class="fz-alertes-bande-long">Alertes sur cet appareil</strong><strong class="fz-alertes-bande-court">Alertes</strong>
                    <span class="fz-alertes-bande-sous${message && message.ton === 'erreur' ? ' is-erreur' : ''}" role="status">${echapper(sous)}</span></span>
                ${bouton('activer', 'Activer', true)}
                <button type="button" class="fz-alertes-masquer" data-fz-alertes-action="masquer"
                    aria-label="Masquer cette suggestion pendant un mois" title="Masquer">×</button>
            </div>`;
    }

    const RENDUS = { carte, reglage, bande };
    let version = 0;
    let planifie = false;

    /**
     * Redessine au prochain tour de la boucle, pas tout de suite : un clic sur
     * un bouton du réglage ne doit pas le retirer du document pendant que les
     * autres écouteurs de ce clic s'exécutent encore — la cloche se fermerait,
     * croyant le clic venu d'ailleurs.
     */
    function rendre() {
        version++;
        if (planifie) return;
        planifie = true;
        setTimeout(() => { planifie = false; remplirTout(); }, 0);
    }

    function remplirTout() {
        document.querySelectorAll('[data-fz-alertes]').forEach(remplir);
    }

    function remplir(el) {
        if (el.dataset.fzAlertesVersion === String(version)) return;
        el.dataset.fzAlertesVersion = String(version);

        // Le focus revient au bouton équivalent : un redessin ne doit pas le
        // renvoyer en haut de la page.
        const actif = el.contains(document.activeElement) ? document.activeElement : null;
        const action = actif && actif.dataset ? actif.dataset.fzAlertesAction : null;

        const rendu = RENDUS[el.dataset.fzAlertes] || carte;
        const html = rendu();
        el.hidden = !html;
        el.innerHTML = html;

        if (actif) {
            const pareil = (action && el.querySelector(`[data-fz-alertes-action="${action}"]:not([disabled])`))
                || el.querySelector('[data-fz-alertes-action]:not([disabled])');
            if (pareil) pareil.focus({ preventScroll: true });
        }
    }

    document.addEventListener('click', e => {
        const cible = e.target.closest && e.target.closest('[data-fz-alertes-action]');
        if (!cible || cible.disabled) return;
        const action = cible.dataset.fzAlertesAction;
        if (action === 'activer') activer();
        else if (action === 'desactiver') desactiver();
        else if (action === 'essai') essayer();
        else if (action === 'masquer') { ecrire(CLE_MASQUEE, Date.now()); rendre(); }
    });

    // Une page qui redessine son contenu (le salon) remet un emplacement vide.
    new MutationObserver(() => {
        if (document.querySelector('[data-fz-alertes]')) remplirTout();
    }).observe(document.documentElement, { childList: true, subtree: true });

    // ───────────────────────── Salle de repêchage ─────────────────────────

    /**
     * L'alerte du tour de CE pool n'a plus rien à dire une fois dans la salle :
     * elle quitte le centre de notifications.
     */
    async function effacerAlertesDuPool() {
        if (!document.getElementById('turn-banner')) return;
        let pool = null;
        try { pool = localStorage.getItem('draftClan') || localStorage.getItem('activePool'); } catch { /* rien */ }
        if (!pool) return;
        const enregistrement = await enregistrementExistant();
        if (!enregistrement || typeof enregistrement.getNotifications !== 'function') return;
        const alertes = await enregistrement.getNotifications({ tag: `fz-tour:${pool}` }).catch(() => []);
        alertes.forEach(n => n.close());
    }

    // ───────────────────────── Départ ─────────────────────────

    if (moi && moi.src && !document.querySelector('link[data-fz-alertes-css]')) {
        const feuille = document.createElement('link');
        feuille.rel = 'stylesheet';
        feuille.href = moi.src.replace(/\.js(\?|$)/, '.css$1');
        feuille.dataset.fzAlertesCss = '';
        document.head.appendChild(feuille);
    }

    window.FZAlertes = {
        etat: () => etat,
        activer,
        desactiver,
        essayer,
        surChangement(fn) { ecouteurs.add(fn); return () => ecouteurs.delete(fn); }
    };

    function lancer() {
        demarrer().then(() => {
            if (etat === 'actif') effacerAlertesDuPool();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lancer);
    else lancer();
})();
