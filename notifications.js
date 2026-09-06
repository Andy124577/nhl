/* Notifications : historique et lectures conservés par compte dans ce navigateur.
   Seuls un clic sur une notification ou « Tout marquer comme lu » changent la lecture.
   Les données viennent des services existants de pools et d'échanges. */
(function () {
    const ICONES = {
        cloche: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>`,
        echange: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
        cible: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
        depart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`
    };


    const echapper = texte => String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const lienPool = nom => 'pool=' + encodeURIComponent(nom);
    const parId = id => document.getElementById(id);
    const DUREE_POPUP = 8000;

    let compte, cle, elements = [], initialise = false;
    let draftsInitialises = false, echangesInitialises = false;
    let requete = null, relancer = false, derniereListe = '';
    let erreurReseau = false, erreurStockage = false;
    let migration = new Set();
    let popupIds = [], popupTimer, popupRestant = DUREE_POPUP, popupDebut;
    let popupSurvole = false;

    const compteActuel = () => localStorage.getItem('isLoggedIn') === 'true'
        && localStorage.getItem('username') === compte;

    function lireStockage() {
        try {
            const sauvegarde = JSON.parse(localStorage.getItem(cle) || 'null');
            if (sauvegarde?.version !== 1 || !Array.isArray(sauvegarde.items)) return null;
            sauvegarde.items = sauvegarde.items.filter(el => el && typeof el.id === 'string'
                && ['echange', 'repechage'].includes(el.type) && typeof el.pool === 'string'
                && /^(trade|repechage|draftActif|draftFini)\.html\?/.test(el.href)
                && Number.isFinite(el.date));
            return sauvegarde;
        } catch { return null; }
    }

    // Une lecture est monotone : un onglet ne peut pas annuler celle d'un autre.
    function fusionnerStockage() {
        const sauvegarde = lireStockage();
        if (!sauvegarde) return;
        const connus = new Map(elements.map(el => [el.id, el]));
        sauvegarde.items.forEach(el => {
            if (connus.has(el.id)) {
                connus.get(el.id).read = connus.get(el.id).read === true || el.read === true;
            } else {
                const copie = { ...el, read: el.read === true };
                elements.push(copie);
                connus.set(el.id, copie);
            }
        });
    }

    function sauvegarder() {
        if (!compteActuel()) return;
        fusionnerStockage();
        try {
            localStorage.setItem(cle, JSON.stringify({ version: 1, initialized: initialise, items: elements }));
            erreurStockage = false;
        } catch {
            // Le clic et la navigation restent utilisables si le stockage est plein.
            erreurStockage = true;
        }
    }

    function marquerLus(ids) {
        if (!compteActuel()) return;
        fusionnerStockage();
        const selection = new Set(ids);
        elements.forEach(el => { if (selection.has(el.id)) el.read = true; });
        sauvegarder();
        // Mettre les lignes à jour en place préserve le lien en cours d'activation.
        parId('fzNotifList').querySelectorAll('[data-notification-id]').forEach(lien => {
            const el = elements.find(item => item.id === lien.dataset.notificationId);
            lien.classList.toggle('is-unread', !el.read);
            lien.querySelector('.fz-notif-state').textContent = el.read ? 'Lue' : 'Non lue';
        });
        derniereListe = '';
        majBadge();
        popupIds = popupIds.filter(id => !elements.find(el => el.id === id)?.read);
        if (popupIds.length) rendrePopup();
        else fermerPopup();
    }

    function selectionner(e) {
        if (e.type === 'auxclick' && e.button !== 1) return;
        const lien = e.target.closest('[data-notification-id]');
        if (lien) {
            // Ne pas remplacer l'URL de la popup pendant son clic natif.
            const depuisPopup = lien.id === 'fzNotifToastLink';
            if (depuisPopup) fermerPopup();
            marquerLus([lien.dataset.notificationId]);
        }
    }

    function notificationEchange(echange) {
        const recu = (echange.offering || [])[0];
        const donne = (echange.receiving || [])[0];
        const date = echange.date ? new Date(echange.date).getTime() : NaN;
        return {
            id: 'trade:' + echange.id, type: 'echange', pool: echange.draftName,
            titre: "Proposition d'échange reçue",
            detail: recu && donne
                ? `${echange.fromTeam} vous offre ${recu.name} contre ${donne.name}. Votre réponse est attendue.`
                : `${echange.fromTeam} vous propose un échange. Votre réponse est attendue.`,
            action: 'Examiner la proposition',
            date: Number.isFinite(date) ? date : Date.now(),
            href: `trade.html?${lienPool(echange.draftName)}&trade=${encodeURIComponent(echange.id)}`,
            urgent: false
        };
    }

    function repechages() {
        const liste = [];
        FZPool.mine().forEach(pool => {
            const etat = FZPool.draftState(pool.data);
            if (etat.etat === 'encours') {
                // Évènement « commencé » stable : aucun nouveau message à chaque choix adverse.
                liste.push({
                    id: 'draft:' + pool.name, type: 'repechage', pool: pool.name,
                    titre: 'Le repêchage a commencé',
                    detail: 'Les équipes sélectionnent leurs joueurs. Suivez les choix en direct.',
                    action: 'Ouvrir la salle de repêchage', date: Date.now(),
                    href: `draftActif.html?${lienPool(pool.name)}`, urgent: false
                });
                if (etat.equipeAuTour === pool.teamName) liste.push({
                    id: `turn:${pool.name}:${etat.choixFait}`, type: 'repechage', pool: pool.name,
                    titre: "C'est à votre tour de choisir",
                    detail: `Choix ${etat.choixFait + 1} sur ${etat.choixTotal}. Les autres équipes attendent votre sélection.`,
                    action: 'Choisir un joueur', date: Date.now(),
                    href: `draftActif.html?${lienPool(pool.name)}`, urgent: true
                });
            } else if (etat.etat === 'pret') {
                liste.push({
                    id: 'ready:' + pool.name, type: 'repechage', pool: pool.name,
                    titre: 'Repêchage prêt à commencer',
                    detail: `${etat.inscrits}/${etat.max} participants sont inscrits. Rejoignez votre groupe pour commencer.`,
                    action: 'Préparer le repêchage', date: Date.now(),
                    href: `repechage.html?${lienPool(pool.name)}`, urgent: false
                });
            }
        });
        return liste;
    }

    function actualiserHistorique() {
        const pools = new Map(FZPool.mine().map(pool => [pool.name, pool]));
        elements.filter(el => el.type === 'repechage').forEach(el => {
            const pool = pools.get(el.pool);
            if (!pool) { el.urgent = false; return; }
            const etat = FZPool.draftState(pool.data);
            if (etat.etat === 'termine') {
                el.urgent = false;
                el.detail = 'Ce repêchage est terminé. Retrouvez les sélections de votre pool.';
                el.action = 'Voir les sélections';
                el.href = `draftFini.html?${lienPool(el.pool)}`;
                if (el.id.startsWith('turn:')) el.titre = 'Votre tour de repêchage est terminé';
            } else if (el.id.startsWith('turn:')
                && el.id !== `turn:${pool.name}:${etat.choixFait}`) {
                el.urgent = false;
                el.titre = 'Votre tour de repêchage est terminé';
                el.detail = 'Le repêchage a avancé. Retrouvez les choix dans la salle.';
                el.action = 'Voir les choix';
            } else if (el.id.startsWith('ready:') && etat.etat === 'encours') {
                el.detail = 'Tous les participants ont rejoint le groupe. Le repêchage a maintenant commencé.';
                el.action = 'Ouvrir la salle de repêchage';
                el.href = `draftActif.html?${lienPool(el.pool)}`;
            }
        });
    }

    function integrer(nouveaux, annoncer) {
        fusionnerStockage();
        const connus = new Map(elements.map(el => [el.id, el]));
        const arrives = [];
        nouveaux.forEach(el => {
            const precedent = connus.get(el.id);
            if (precedent) {
                Object.assign(precedent, el, { date: precedent.date, read: precedent.read });
            } else {
                const ajout = { ...el, read: migration.has(el.id) };
                elements.push(ajout);
                connus.set(el.id, ajout);
                if (!ajout.read) arrives.push(ajout);
            }
        });
        actualiserHistorique();
        sauvegarder();
        rendreListe();
        if (annoncer && arrives.length) annoncerNouveaux(arrives);
    }

    function trier(a, b) {
        return Number(a.read) - Number(b.read)
            || Number(!!b.urgent) - Number(!!a.urgent) || b.date - a.date;
    }

    function horodatage(date) {
        const instant = new Date(date);
        const minutes = Math.max(0, Math.floor((Date.now() - date) / 60000));
        const texte = minutes < 1 ? "À l'instant"
            : minutes < 60 ? `Il y a ${minutes} min`
            : minutes < 1440 ? `Il y a ${Math.floor(minutes / 60)} h`
            : instant.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short',
                ...(instant.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
        const complet = instant.toLocaleString('fr-CA', { dateStyle: 'long', timeStyle: 'short' });
        return `<time class="fz-notif-time" datetime="${instant.toISOString()}" title="${echapper(complet)}" aria-label="${echapper(complet)}">${texte}</time>`;
    }

    function contenu(el, afficherEtat) {
        return `<span class="fz-notif-icon fz-notif-icon-${el.type}" aria-hidden="true">${el.type === 'echange' ? ICONES.echange : ICONES.cible}</span>
            <span class="fz-notif-txt">
                <span class="fz-notif-title">${echapper(el.titre)}</span>
                <span class="fz-notif-pool">${echapper(el.pool)}</span>
                <span class="fz-notif-detail">${echapper(el.detail)}</span>
                <span class="fz-notif-meta">${afficherEtat ? `<span class="fz-notif-state">${el.read ? 'Lue' : 'Non lue'}</span>` : ''}${horodatage(el.date)}</span>
                <span class="fz-notif-action">${echapper(el.action)} <span aria-hidden="true">→</span></span>
            </span>`;
    }

    function majBadge() {
        const nonLus = elements.filter(el => !el.read).length;
        const badge = parId('fzNotifBadge');
        badge.textContent = nonLus ? String(nonLus) : '';
        badge.hidden = nonLus === 0;
        const libelle = nonLus === 0 ? 'Notifications'
            : `Notifications, ${nonLus} non lue${nonLus > 1 ? 's' : ''}`;
        parId('fzNotifBtn').setAttribute('aria-label', libelle);
        parId('fzNotifBtn').title = libelle;
        parId('fzNotifBtn').classList.toggle('has-unread', nonLus > 0);
        parId('fzNotifCount').textContent = nonLus ? `${nonLus} non lue${nonLus > 1 ? 's' : ''}` : '';
        // aria-disabled garde le focus clavier sur l'action après activation.
        parId('fzNotifMarkAll').setAttribute('aria-disabled', String(nonLus === 0));
        parId('fzNotifMarkAll').hidden = elements.length === 0;
        parId('fzNotifHelp').textContent = erreurStockage
            ? 'La lecture ne peut pas être enregistrée dans ce navigateur pour le moment.'
            : erreurReseau ? 'Mise à jour indisponible. Vos notifications sont conservées ; nouvel essai automatique.'
            : 'Ouvrir ce panneau ne marque rien comme lu.';
    }

    function rendreListe() {
        const liste = parId('fzNotifList');
        if (!liste) return;
        const html = elements.length ? [...elements].sort(trier).map(el => `
            <li class="fz-notif-entry"><a class="fz-notif-item${el.read ? '' : ' is-unread'}${el.urgent ? ' is-urgent' : ''}"
                href="${echapper(el.href)}" data-notification-id="${echapper(el.id)}">${contenu(el, true)}</a></li>`).join('')
            : `<li class="fz-notif-empty"><span class="fz-notif-empty-icon" aria-hidden="true">${ICONES.cloche}</span>
                <p>Aucune notification pour le moment.</p>
                <p>Vos propositions d’échange et les nouvelles de vos repêchages apparaîtront ici.</p></li>`;
        if (html !== derniereListe) {
            const focus = document.activeElement?.closest('[data-notification-id]');
            const focusId = focus && liste.contains(focus) ? focus.dataset.notificationId : null;
            const scroll = liste.scrollTop;
            liste.innerHTML = html;
            derniereListe = html;
            if (focusId) [...liste.querySelectorAll('[data-notification-id]')]
                .find(lien => lien.dataset.notificationId === focusId)?.focus({ preventScroll: true });
            liste.scrollTop = scroll;
        }
        majBadge();
    }

    function ouvrirPanneau(ouvert, rendreFocus = false) {
        parId('fzNotifPanel').hidden = !ouvert;
        parId('fzNotifPanel').classList.toggle('is-open', ouvert);
        parId('fzNotifBtn').setAttribute('aria-expanded', String(ouvert));
        if (ouvert) {
            fermerPopup();
            rendreListe();
            parId('fzNotifClose').focus({ preventScroll: true });
        } else if (rendreFocus) parId('fzNotifBtn').focus();
    }

    function pauserPopup() {
        if (popupTimer) {
            clearTimeout(popupTimer);
            popupRestant = Math.max(0, popupRestant - (Date.now() - popupDebut));
            popupTimer = null;
        }
    }

    function reprendrePopup() {
        if (!popupIds.length || document.hidden || popupSurvole
            || parId('fzNotifToast').contains(document.activeElement) || popupTimer) return;
        popupDebut = Date.now();
        popupTimer = setTimeout(() => fermerPopup(), popupRestant);
    }

    function fermerPopup() {
        const toast = parId('fzNotifToast');
        const avaitFocus = toast.contains(document.activeElement);
        clearTimeout(popupTimer);
        popupTimer = null;
        popupIds = [];
        popupSurvole = false;
        toast.hidden = true;
        if (avaitFocus) parId('fzNotifBtn').focus({ preventScroll: true });
    }

    function rendrePopup() {
        const el = elements.find(item => item.id === popupIds[0]);
        if (!el) { fermerPopup(); return; }
        const lien = parId('fzNotifToastLink');
        lien.href = el.href;
        lien.dataset.notificationId = el.id;
        lien.innerHTML = contenu(el, false);
        const nombre = popupIds.length - 1;
        parId('fzNotifToastMore').hidden = nombre === 0;
        parId('fzNotifToastMore').textContent = `Voir ${nombre} autre${nombre > 1 ? 's' : ''} notification${nombre > 1 ? 's' : ''}`;
    }

    function annoncerNouveaux(arrives) {
        const texte = arrives.length === 1
            ? `${arrives[0].titre}. ${arrives[0].pool}. ${arrives[0].action}.`
            : `${arrives.length} nouvelles notifications. Ouvrez les notifications pour les consulter.`;
        parId('fzNotifLive').textContent = texte;
        if (!parId('fzNotifPanel').hidden) return;
        // Une seule carte et un accès au reste du groupe, jamais une pile
        // ou une longue file de fenêtres après une rafale d'évènements.
        const dejaVisible = popupIds.length > 0;
        popupIds = [...new Set([...popupIds, ...arrives.sort(trier).map(el => el.id)])];
        rendrePopup();
        parId('fzNotifToast').hidden = document.hidden;
        if (!dejaVisible) {
            popupRestant = DUREE_POPUP;
            reprendrePopup();
        }
    }

    function monterCloche() {
        const droite = document.querySelector('.navbar-desktop .navbar-right');
        if (!droite || parId('fzNotifWrap')) return false;
        droite.insertAdjacentHTML('afterbegin', `
            <div class="fz-notif" id="fzNotifWrap">
                <button type="button" class="fz-notif-btn" id="fzNotifBtn" aria-label="Notifications"
                    aria-expanded="false" aria-controls="fzNotifPanel" title="Notifications">
                    ${ICONES.cloche}<span class="fz-notif-badge" id="fzNotifBadge" aria-hidden="true" hidden></span>
                </button>
                <section class="fz-notif-panel" id="fzNotifPanel" role="region" aria-labelledby="fzNotifTitle" hidden>
                    <div class="fz-notif-head"><h2 id="fzNotifTitle">Notifications</h2>
                        <span class="fz-notif-count" id="fzNotifCount"></span>
                        <button type="button" class="fz-notif-close" id="fzNotifClose" aria-label="Fermer les notifications">×</button>
                    </div>
                    <div class="fz-notif-toolbar">
                        <button type="button" class="fz-notif-mark-all" id="fzNotifMarkAll" aria-disabled="true">Tout marquer comme lu</button>
                        <p class="fz-notif-help" id="fzNotifHelp"></p>
                    </div>
                    <ul class="fz-notif-list" id="fzNotifList"></ul>
                </section>
            </div>`);
        document.body.insertAdjacentHTML('beforeend', `
            <div id="fzNotifLive" class="nav-sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
            <aside class="fz-notif-toast" id="fzNotifToast" aria-label="Nouvelle notification" hidden>
                <div class="fz-notif-toast-top"><span>Nouvelle notification</span>
                    <button type="button" class="fz-notif-dismiss" id="fzNotifToastDismiss" aria-label="Fermer l’aperçu de notification">×</button>
                </div>
                <a class="fz-notif-toast-link" id="fzNotifToastLink" data-notification-id=""></a>
                <button type="button" class="fz-notif-toast-more" id="fzNotifToastMore" hidden></button>
            </aside>`);
        parId('fzNotifBtn').addEventListener('click', () => ouvrirPanneau(parId('fzNotifPanel').hidden));
        parId('fzNotifClose').addEventListener('click', () => ouvrirPanneau(false, true));
        parId('fzNotifMarkAll').addEventListener('click', () => {
            if (elements.some(el => !el.read)) marquerLus(elements.map(el => el.id));
        });
        ['click', 'auxclick'].forEach(type => {
            parId('fzNotifList').addEventListener(type, selectionner);
            parId('fzNotifToastLink').addEventListener(type, selectionner);
        });
        parId('fzNotifToastDismiss').addEventListener('click', fermerPopup);
        parId('fzNotifToastMore').addEventListener('click', () => ouvrirPanneau(true));
        const toast = parId('fzNotifToast');
        toast.addEventListener('mouseenter', () => { popupSurvole = true; pauserPopup(); });
        toast.addEventListener('mouseleave', () => { popupSurvole = false; reprendrePopup(); });
        toast.addEventListener('focusin', pauserPopup);
        toast.addEventListener('focusout', () => setTimeout(reprendrePopup, 0));
        document.addEventListener('click', e => {
            if (!e.target.closest('#fzNotifWrap') && !e.target.closest('#fzNotifToast'))
                ouvrirPanneau(false);
        });
        document.addEventListener('focusin', e => {
            if (!parId('fzNotifPanel').hidden && !e.target.closest('#fzNotifWrap'))
                ouvrirPanneau(false);
        });
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            if (!parId('fzNotifPanel').hidden) ouvrirPanneau(false, true);
            else if (!toast.hidden) fermerPopup();
        });
        return true;
    }

    async function rafraichirEchanges() {
        if (!compteActuel()) return;
        if (requete) { relancer = true; return requete; }
        requete = (async () => {
            try {
                const reponse = await fetch(`${FZPool.BASE_URL}/trades/pending/${encodeURIComponent(compte)}`,
                    { cache: 'no-store', signal: AbortSignal.timeout(15000) });
                if (!reponse.ok) throw new Error('Échanges indisponibles');
                const echanges = await reponse.json();
                if (!Array.isArray(echanges)) throw new Error('Réponse invalide');
                if (!compteActuel()) return;
                const nouveaux = echanges.filter(el => el?.id != null && typeof el.draftName === 'string')
                    .map(notificationEchange);
                const actifs = new Set(nouveaux.map(el => el.id));
                elements.filter(el => el.type === 'echange' && !actifs.has(el.id)).forEach(el => {
                    el.detail = 'Cette proposition ne demande plus de réponse. Consultez son suivi.';
                    el.action = 'Voir le suivi de l’échange';
                });
                erreurReseau = false;
                const annoncer = echangesInitialises;
                echangesInitialises = true;
                initialise = true;
                integrer(nouveaux, annoncer);
                // Terminer la migration seulement après avoir collecté les deux sources.
                if (migration.size && !erreurStockage) {
                    localStorage.removeItem('fzNotifsVues');
                    migration.clear();
                }
            } catch {
                if (compteActuel()) { erreurReseau = true; majBadge(); }
            }
        })();
        try { await requete; } finally {
            requete = null;
            if (relancer) { relancer = false; rafraichirEchanges(); }
        }
    }

    function rafraichirDrafts() {
        if (!compteActuel()) return;
        integrer(repechages(), draftsInitialises);
        draftsInitialises = true;
    }

    function brancherSocket(essai = 0) {
        if (!compteActuel()) return;
        if (!window.__fzSocketPool && typeof io === 'undefined') {
            if (essai < 40) setTimeout(() => brancherSocket(essai + 1), 250);
            return;
        }
        try {
            const socket = window.__fzSocketPool || io(FZPool.BASE_URL);
            socket.on('tradePending', rafraichirEchanges);
            socket.on('tradeUpdated', rafraichirEchanges);
            socket.on('connect', rafraichirEchanges);
        } catch { /* Le sondage et le retour sur l'onglet prennent le relais. */ }
    }

    async function demarrer() {
        compte = localStorage.getItem('username');
        if (!compte || !compteActuel() || !window.FZPool) return;
        cle = 'fzNotifications:v1:' + encodeURIComponent(compte);
        const sauvegarde = lireStockage();
        elements = (sauvegarde?.items || []).map(el => ({ ...el, read: el.read === true }));
        initialise = sauvegarde?.initialized === true;
        draftsInitialises = echangesInitialises = initialise;
        if (!sauvegarde) {
            try {
                const anciens = JSON.parse(localStorage.getItem('fzNotifsVues') || '[]');
                if (Array.isArray(anciens)) migration = new Set(anciens);
            } catch { /* Stockage ancien invalide. */ }
        }
        if (!monterCloche()) return;
        rendreListe();
        await FZPool.ready();
        if (!compteActuel()) return;
        FZPool.onData(rafraichirDrafts);
        rafraichirDrafts();
        rafraichirEchanges();
        brancherSocket();
        window.addEventListener('storage', e => {
            if (!compteActuel()) { fermerPopup(); parId('fzNotifWrap').hidden = true; return; }
            if (e.key !== cle) return;
            const connus = new Set(elements.map(el => el.id));
            fusionnerStockage();
            actualiserHistorique();
            rendreListe();
            popupIds = popupIds.filter(id => !elements.find(el => el.id === id)?.read);
            if (popupIds.length) rendrePopup();
            else fermerPopup();
            const nouveaux = elements.filter(el => !connus.has(el.id) && !el.read);
            if (initialise && nouveaux.length) annoncerNouveaux(nouveaux);
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { pauserPopup(); parId('fzNotifToast').hidden = true; return; }
            if (popupIds.length) { parId('fzNotifToast').hidden = false; reprendrePopup(); }
            rafraichirEchanges();
            FZPool.refresh();
        });
        window.addEventListener('online', () => { rafraichirEchanges(); FZPool.refresh(); });
        window.addEventListener('pageshow', e => {
            if (e.persisted) { fusionnerStockage(); rendreListe(); rafraichirEchanges(); FZPool.refresh(); }
        });
        setInterval(() => {
            if (!document.hidden && compteActuel()) {
                rendreListe();
                rafraichirEchanges();
            }
        }, 30000);
    }

    function attendreNavbar() {
        if (document.querySelector('.navbar-desktop .navbar-right')) { demarrer(); return; }
        const navbar = document.querySelector('.navbar');
        if (!navbar) return;
        const observateur = new MutationObserver(() => {
            if (document.querySelector('.navbar-desktop .navbar-right')) {
                observateur.disconnect();
                demarrer();
            }
        });
        observateur.observe(navbar, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attendreNavbar);
    else attendreNavbar();
})();
