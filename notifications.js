/* Notifications.
 *
 * La source est le serveur : /api/notifications renvoie des notifications
 * durables, avec leur texte, leur urgence et leur destination déjà décidés
 * (lib/events.js). La cloche, le bandeau et l'accueil racontent donc la même
 * chose et mènent au même endroit — chacun composait son propre texte avant,
 * et deux surfaces pouvaient diverger.
 *
 * L'historique local reste, pour deux raisons précises :
 *
 *   - il porte l'état de lecture déjà acquis. Les identifiants du serveur
 *     reprennent exactement le schéma local (`trade:42`, `turn:pool:3`), donc
 *     une notification déjà vue reste vue au lieu de réapparaître non lue ;
 *   - il permet à la cloche de fonctionner quand le serveur ne répond pas, ou
 *     quand l'historique durable n'est pas disponible (mode fichier).
 *
 * Une seule source à la fois : dès que le serveur répond, les sources dérivées
 * des pools et des échanges se taisent. Deux flux produiraient deux entrées
 * pour le même fait.
 *
 * Seuls un clic sur une notification ou « Tout marquer lu » changent la
 * lecture. Ouvrir le panneau ne marque rien.
 *
 * Le panneau se lit d'un coup d'œil : ce qui attend une réponse d'abord
 * (« À faire »), puis le reste par jour. Chaque ligne tient en quatre
 * éléments — une icône dont la couleur dit l'issue, un titre court, un
 * résumé (les deux équipes d'un échange, sinon une phrase) et le pool. Une
 * notification non lue se reconnaît à son titre gras, son fond teinté et son
 * point rouge ; une lue s'estompe.
 *
 * Ce qui se passe en ce moment (fzToday.js : le tour, un repêchage en cours,
 * le duel de la semaine…) prend les mêmes lignes : en tête d'« À faire » ce
 * qui attend un geste, dans « En ce moment » ce qui décrit la semaine. */
(function () {
    const ICONES = {
        cloche: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>`,
        echange: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h14l-4-4"/><path d="M20 16H6l4 4"/></svg>`,
        cible: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>`,
        depart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
        invitation: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/></svg>`,
        semaine: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`
    };

    // La marque en coin de l'icône : l'issue se lit sans lire le titre.
    const MARQUES = { refuse: '✕', accepte: '✓', attente: '!' };

    const echapper = texte => String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const lienPool = nom => 'pool=' + encodeURIComponent(nom);
    const parId = id => document.getElementById(id);
    const DUREE_POPUP = 8000;

    let compte, cle, elements = [], initialise = false;
    let draftsInitialises = false, echangesInitialises = false;
    // null = pas encore demandé, true = le serveur fait foi, false = repli.
    let serveurDisponible = null;
    // Une réponse claire « pas d'historique durable ici » (mode fichier) ne se
    // redemande pas à chaque évènement : ce serait une requête par clic pour
    // une réponse qui ne changera pas de la session. Un échec réseau, lui,
    // reste réessayable — il n'a rien décidé.
    let serveurEcarte = false;
    let serveurInitialise = false;
    let requeteServeur = null;
    let requete = null, relancer = false, derniereListe = '';
    let erreurReseau = false, erreurStockage = false;
    let migration = new Set();
    let popupIds = [], popupTimer, popupRestant = DUREE_POPUP, popupDebut;
    let popupSurvole = false;
    // « Toutes » ou « Non lues » : le choix tient le temps de la page.
    let filtreNonLues = false;
    // La dernière réponse d'« Aujourd'hui » (fzToday.js), ou null.
    let aujourdhui = null;

    const compteActuel = () => localStorage.getItem('isLoggedIn') === 'true'
        && localStorage.getItem('username') === compte;

    function lireStockage() {
        try {
            const sauvegarde = JSON.parse(localStorage.getItem(cle) || 'null');
            if (sauvegarde?.version !== 1 || !Array.isArray(sauvegarde.items)) return null;
            sauvegarde.items = sauvegarde.items.filter(el => el && typeof el.id === 'string'
                && ['echange', 'repechage', 'semaine', 'invitation'].includes(el.type) && typeof el.pool === 'string'
                && /^(trade|repechage|draftActif|draftFini|classement|index)\.html\?/.test(el.href)
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

    /**
     * Signale au serveur ce qui vient d'être lu.
     *
     * Sans attente : la liste se met à jour localement tout de suite, et une
     * requête perdue se rattrape au prochain chargement — l'état de lecture
     * local reste, et le serveur le recevra plus tard.
     */
    function signalerLecture(ids) {
        if (serveurDisponible !== true) return;
        const serveurIds = ids
            .map(id => (elements.find(el => el.id === id) || {}).serverId)
            .filter(Boolean);
        if (serveurIds.length === 0) return;
        fetch(`${FZPool.BASE_URL}/api/notifications/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: serveurIds })
        }).catch(() => { /* le prochain chargement rattrapera */ });
    }

    function marquerLus(ids) {
        if (!compteActuel()) return;
        fusionnerStockage();
        const selection = new Set(ids);
        elements.forEach(el => { if (selection.has(el.id)) el.read = true; });
        sauvegarder();
        // Mettre les lignes à jour en place préserve le lien en cours d'activation.
        // La ligne garde sa place jusqu'au prochain rendu : la déplacer vers
        // son jour pendant le clic ferait sauter la liste sous le doigt.
        parId('fzNotifList').querySelectorAll('[data-notification-id]').forEach(lien => {
            const el = elements.find(item => item.id === lien.dataset.notificationId);
            lien.classList.toggle('is-unread', !el.read);
            const etat = lien.querySelector('.fz-notif-state');
            if (etat) etat.textContent = el.read ? '' : 'Non lue';
        });
        derniereListe = '';
        majBadge();
        popupIds = popupIds.filter(id => !elements.find(el => el.id === id)?.read);
        if (popupIds.length) rendrePopup();
        else fermerPopup();
        signalerLecture(ids);
    }

    function selectionner(e) {
        if (e.type === 'auxclick' && e.button !== 1) return;
        const lien = e.target.closest('[data-notification-id]');
        if (lien) {
            // Ne pas remplacer l'URL de la popup pendant son clic natif.
            const depuisPopup = lien.id === 'fzNotifToastLink';
            if (depuisPopup) fermerPopup();
            // Une invitation encore en attente s'ouvre sur place, dans sa
            // fenêtre : quitter la page pour y répondre n'apporterait rien.
            const el = elements.find(item => item.id === lien.dataset.notificationId);
            if (e.type === 'click' && el && el.type === 'invitation' && window.FZInvites
                && FZInvites.open(el.pool)) {
                e.preventDefault();
                ouvrirPanneau(false);
            }
            marquerLus([lien.dataset.notificationId]);
        }
    }

    /**
     * Les invitations à rejoindre un pool.
     *
     * Elles vivent dans les données du pool, pas dans l'historique durable :
     * elles s'ajoutent donc à la cloche quelle que soit la source qui fait
     * foi. poolInvites.js les charge et fait surgir leur fenêtre ; ici on ne
     * fait que les ranger — sans aperçu en bas d'écran, la fenêtre suffit.
     *
     * Une invitation acceptée, refusée ou annulée reste lisible, mais cesse
     * de réclamer une réponse.
     */
    function rafraichirInvitations(liste) {
        if (!compteActuel()) return;
        const nouveaux = (liste || []).map(inv => {
            const date = Date.parse(inv.invitedAt);
            return {
                id: `invite:${inv.poolName}:${inv.invitedAt}`,
                type: 'invitation', pool: inv.poolName,
                titre: 'Invitation à un pool',
                detail: `${inv.invitedBy || 'On'} vous invite à le rejoindre.`,
                action: 'Voir l’invitation',
                date: Number.isFinite(date) ? date : Date.now(),
                href: `index.html?invitation=${encodeURIComponent(inv.poolName)}`,
                urgent: true
            };
        });
        const actives = new Set(nouveaux.map(el => el.id));
        elements.filter(el => el.type === 'invitation' && !actives.has(el.id)).forEach(el => {
            el.read = true;
            el.urgent = false;
            el.titre = 'Invitation traitée';
            el.detail = 'Rien à faire de votre côté.';
            el.action = 'Voir mes pools';
            el.href = `index.html?${lienPool(el.pool)}`;
        });
        integrer(nouveaux, false);
    }

    function notificationEchange(echange) {
        // Une proposition peut réunir plusieurs paires : on les nomme toutes.
        const recus = (echange.offering || []).map(p => p && p.name).filter(Boolean).join(', ');
        const donnes = (echange.receiving || []).map(p => p && p.name).filter(Boolean).join(', ');
        const date = echange.date ? new Date(echange.date).getTime() : NaN;
        return {
            id: 'trade:' + echange.id, type: 'echange', pool: echange.draftName,
            titre: "Nouvelle offre d'échange",
            detail: recus && donnes
                ? `${echange.fromTeam} vous offre ${recus} contre ${donnes}. Votre réponse est attendue.`
                : `${echange.fromTeam} vous propose un échange. Votre réponse est attendue.`,
            equipes: echange.fromTeam && echange.toTeam ? [echange.fromTeam, echange.toTeam] : null,
            resolue: false,
            action: 'Voir l’offre',
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
                    titre: 'Repêchage commencé',
                    detail: 'Les équipes choisissent leurs joueurs.',
                    action: 'Rejoindre le repêchage', date: Date.now(),
                    href: `draftActif.html?${lienPool(pool.name)}`, urgent: false
                });
                if (etat.equipeAuTour === pool.teamName) liste.push({
                    id: `turn:${pool.name}:${etat.choixFait}`, type: 'repechage', pool: pool.name,
                    titre: "C'est à votre tour de choisir",
                    detail: `Choix ${etat.choixFait + 1} sur ${etat.choixTotal}. Les autres équipes attendent.`,
                    action: 'Choisir un joueur', date: Date.now(),
                    href: `draftActif.html?${lienPool(pool.name)}`, urgent: true
                });
            } else if (etat.etat === 'pret') {
                liste.push({
                    id: 'ready:' + pool.name, type: 'repechage', pool: pool.name,
                    titre: 'Repêchage prêt à commencer',
                    detail: `${etat.inscrits} participants sur ${etat.max}. Il peut être lancé.`,
                    action: 'Préparer le repêchage', date: Date.now(),
                    href: `repechage.html?${lienPool(pool.name)}`, urgent: false
                });
            }
        });
        return liste;
    }

    function actualiserHistorique() {
        // Quand le serveur fait foi, il a déjà décidé du texte et de l'urgence
        // de chaque entrée : les réécrire ici ferait diverger la cloche du
        // reste du site, ce que ce changement existe justement pour éviter.
        if (serveurDisponible === true) return;
        const pools = new Map(FZPool.mine().map(pool => [pool.name, pool]));
        elements.filter(el => el.type === 'repechage').forEach(el => {
            const pool = pools.get(el.pool);
            if (!pool) { el.urgent = false; return; }
            const etat = FZPool.draftState(pool.data);
            if (etat.etat === 'termine') {
                el.urgent = false;
                el.detail = 'Le repêchage est terminé.';
                el.action = 'Voir les sélections';
                el.href = `draftFini.html?${lienPool(el.pool)}`;
                if (el.id.startsWith('turn:')) el.titre = 'Votre tour de repêchage est terminé';
            } else if (el.id.startsWith('turn:')
                && el.id !== `turn:${pool.name}:${etat.choixFait}`) {
                el.urgent = false;
                el.titre = 'Votre tour de repêchage est terminé';
                el.detail = 'Le repêchage a avancé.';
                el.action = 'Voir les choix';
            } else if (el.id.startsWith('ready:') && etat.etat === 'encours') {
                el.detail = 'Le repêchage a commencé.';
                el.action = 'Rejoindre le repêchage';
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
                // La lecture est monotone : ni le serveur ni un autre onglet ne
                // peuvent « dé-lire » ce qui a été lu ici.
                Object.assign(precedent, el, {
                    date: precedent.date,
                    read: precedent.read === true || el.read === true
                });
            } else {
                const ajout = { ...el, read: el.read === true || migration.has(el.id) };
                elements.push(ajout);
                connus.set(el.id, ajout);
                if (!ajout.read) arrives.push(ajout);
            }
        });
        // Dans la salle de repêchage, les alertes de repêchage de CE pool
        // doublent ce que la salle montre déjà — bandeau de tour, son,
        // vibration. Elles ne surgissent pas en fenêtre et ne gonflent pas la
        // pastille : on les range comme lues. Les autres pools, les échanges
        // et le reste s'annoncent normalement.
        const redondantes = arrives.filter(estDansLaSalle);
        if (redondantes.length) {
            redondantes.forEach(el => { el.read = true; });
            signalerLecture(redondantes.map(el => el.id));
        }
        const aAnnoncer = arrives.filter(el => !el.read);
        actualiserHistorique();
        sauvegarder();
        rendreListe();
        if (redondantes.length) majBadge();
        if (popupIds.length) rendrePopup();
        if (annoncer && aAnnoncer.length) annoncerNouveaux(aAnnoncer);
    }

    /** Alerte de repêchage du pool dont on regarde déjà la salle ? */
    function estDansLaSalle(el) {
        if (!el || el.type !== 'repechage') return false;
        if (!window.location.pathname.includes('draftActif')) return false;
        let salle = null;
        try { salle = localStorage.getItem('draftClan'); } catch (e) { /* stockage bloqué */ }
        salle = salle || (window.FZPool && FZPool.get());
        return !!salle && el.pool === salle;
    }

    function trier(a, b) {
        return Number(a.read) - Number(b.read)
            || Number(!!b.urgent) - Number(!!a.urgent) || b.date - a.date;
    }

    const jour = date => new Date(date).toDateString();
    const estAujourdhui = date => jour(date) === jour(Date.now());

    function horodatage(date) {
        const instant = new Date(date);
        const minutes = Math.max(0, Math.floor((Date.now() - date) / 60000));
        const hier = jour(date) === jour(Date.now() - 86400000);
        const texte = minutes < 1 ? "À l'instant"
            : minutes < 60 ? `${minutes} min`
            : minutes < 1440 ? `${Math.floor(minutes / 60)} h`
            : hier ? 'Hier'
            : instant.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short',
                ...(instant.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
        const complet = instant.toLocaleString('fr-CA', { dateStyle: 'long', timeStyle: 'short' });
        return `<time class="fz-notif-time" datetime="${instant.toISOString()}" title="${echapper(complet)}" aria-label="${echapper(complet)}">${texte}</time>`;
    }

    /** Le repêchage de ce pool se joue-t-il en ce moment ? */
    function repechageEnDirect(nom) {
        try {
            const pool = FZPool.mine().find(p => p.name === nom);
            return !!pool && FZPool.draftState(pool.data).etat === 'encours';
        } catch { return false; }
    }

    /**
     * L'issue d'une notification, qui décide de sa couleur et de sa marque.
     *
     * Elle se lit dans l'identifiant stable (lib/events.js) et dans l'urgence
     * que le serveur a déjà décidée : l'historique enregistré dans ce
     * navigateur la retrouve donc sans migration.
     */
    function ton(el) {
        const id = el.id || '';
        if (id.startsWith('traderes:')) return id.endsWith(':accepte') ? 'accepte' : 'refuse';
        // Une offre reçue attend une réponse tant qu'elle n'est pas traitée,
        // même quand la source dérivée ne la marque pas urgente.
        if (el.urgent || (id.startsWith('trade:') && el.resolue === false)) return 'attente';
        if (id.startsWith('draft:') && repechageEnDirect(el.pool)) return 'direct';
        return 'neutre';
    }

    const actionnable = el => ['attente', 'direct'].includes(ton(el));
    const aFaire = el => !el.read && actionnable(el);

    function icone(el) {
        if (el.type === 'echange') return ICONES.echange;
        if (el.type === 'invitation') return ICONES.invitation;
        if (el.type === 'semaine') return ICONES.semaine;
        if ((el.id || '').startsWith('ready:')) return ICONES.depart;
        return ICONES.cible;
    }

    /** Une teinte stable par pool : deux pools se distinguent sans lire leur nom. */
    function teinte(nom) {
        let somme = 0;
        for (const car of String(nom || '')) somme = (somme * 31 + car.codePointAt(0)) >>> 0;
        return somme % 4;
    }

    /** « Vous » plutôt que le nom de sa propre équipe. */
    function nomEquipe(nom, pool) {
        let moi = null;
        try { moi = (FZPool.mine().find(p => p.name === pool) || {}).teamName; } catch { /* sans pools */ }
        return nom === moi ? 'Vous' : nom;
    }

    function resume(el) {
        if (Array.isArray(el.equipes) && el.equipes.length === 2) {
            const [a, b] = el.equipes.map(nom => echapper(nomEquipe(nom, el.pool)));
            return `<span class="fz-notif-pair"><b>${a}</b><span class="fz-notif-pair-sep" aria-hidden="true">⇄</span><span class="nav-sr-only">et</span><b>${b}</b></span>`;
        }
        return el.detail ? `<span class="fz-notif-detail">${echapper(el.detail)}</span>` : '';
    }

    function contenu(el, dansLaListe) {
        const issue = ton(el);
        const marque = MARQUES[issue];
        return `<span class="fz-notif-icon fz-tone-${issue}" aria-hidden="true">${icone(el)}${marque ? `<span class="fz-notif-mark">${marque}</span>` : ''}</span>
            <span class="fz-notif-txt">
                ${dansLaListe ? `<span class="nav-sr-only fz-notif-state">${el.read ? '' : 'Non lue'}</span>` : ''}
                <span class="fz-notif-top">
                    <span class="fz-notif-heading">
                        <span class="fz-notif-title">${echapper(el.titre)}</span>
                        ${issue === 'direct' ? '<span class="fz-notif-live">En direct</span>' : ''}
                    </span>
                    <span class="fz-notif-when">${el.actuel ? '' : horodatage(el.date)}${dansLaListe ? '<span class="fz-notif-dot" aria-hidden="true"></span>' : ''}</span>
                </span>
                ${resume(el)}
                ${el.pool ? `<span class="fz-notif-pool fz-pool-${teinte(el.pool)}">${echapper(el.pool)}</span>` : ''}
                ${actionnable(el) && el.action ? `<span class="fz-notif-action">${echapper(el.action)} <span aria-hidden="true">→</span></span>` : ''}
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
        const compteur = parId('fzNotifCount');
        compteur.innerHTML = nonLus ? `${nonLus}<span class="nav-sr-only"> non lue${nonLus > 1 ? 's' : ''}</span>` : '';
        compteur.hidden = nonLus === 0;
        // aria-disabled garde le focus clavier sur l'action après activation.
        parId('fzNotifMarkAll').setAttribute('aria-disabled', String(nonLus === 0));
        parId('fzNotifMarkAll').hidden = elements.length === 0;
        // L'aide ne parle que pour signaler un problème : le reste du temps,
        // le panneau se passe d'explication.
        const aide = erreurStockage
            ? 'La lecture ne peut pas être enregistrée dans ce navigateur pour le moment.'
            : erreurReseau ? 'Mise à jour indisponible. Vos notifications sont conservées ; nouvel essai automatique.'
            : '';
        parId('fzNotifHelp').textContent = aide;
        parId('fzNotifHelp').hidden = !aide;
    }

    // fzToday.js classe ses éléments par urgence (lib/priority.js) : jusqu'à
    // l'échange (3), ils attendent un geste ; au-delà — le duel, le résultat
    // de la semaine, les matchs du jour —, ils décrivent la semaine.
    const URGENCE_A_FAIRE = 3;

    /**
     * Les éléments d'« Aujourd'hui », prêts à ranger dans la liste.
     *
     * Plusieurs portent l'identifiant d'une notification (`turn:`, `draft:`,
     * `trade:`, `week:`) : c'est alors la notification elle-même qui monte,
     * avec son état de lecture — jamais deux lignes pour le même fait. Les
     * autres deviennent des lignes sans lecture ni heure (`actuel`). Un
     * élément sans destination (« calendrier indisponible ») n'a rien à
     * ouvrir : il reste dehors.
     */
    function actuels() {
        if (!aujourdhui || !aujourdhui.vedette) return [];
        const connus = new Map(elements.map(el => [el.id, el]));
        return [aujourdhui.vedette, ...(aujourdhui.secondaires || [])]
            .filter(el => el && el.id && el.href)
            .map(el => ({
                aFaire: el.urgence <= URGENCE_A_FAIRE,
                el: connus.get(el.id) || {
                    id: el.id, pool: el.pool, titre: el.titre, detail: el.detail,
                    action: el.action, href: el.href, date: null, read: true, actuel: true,
                    type: /^(turn|draft|ready):/.test(el.id) ? 'repechage'
                        : el.id.startsWith('trade:') ? 'echange' : 'semaine',
                    // Un repêchage en cours se lit « En direct » (ton()), pas « à répondre ».
                    urgent: el.urgence <= URGENCE_A_FAIRE && !el.id.startsWith('draft:')
                }
            }));
    }

    // `actuels` choisit, parmi les éléments d'« Aujourd'hui », ceux du groupe ;
    // ils passent devant les notifications, dans l'ordre du serveur.
    const GROUPES = [
        { cle: 'afaire', titre: 'À faire', garde: aFaire, actuels: a => a.aFaire },
        { cle: 'maintenant', titre: 'En ce moment', garde: () => false, actuels: a => !a.aFaire },
        { cle: 'jour', titre: "Aujourd'hui", garde: el => !aFaire(el) && estAujourdhui(el.date) },
        { cle: 'avant', titre: 'Plus tôt', garde: el => !aFaire(el) && !estAujourdhui(el.date) }
    ];

    // Une ligne d'« Aujourd'hui » n'est pas une notification : un clic n'a
    // rien à marquer lu, d'où un autre attribut que `data-notification-id`.
    const LIGNES = '[data-notification-id],[data-today-id]';
    const cleDeLigne = lien => lien.dataset.notificationId || lien.dataset.todayId;

    function ligne(el) {
        if (el.actuel) {
            return `<li class="fz-notif-entry"><a class="fz-notif-item is-current${el.urgent ? ' is-urgent' : ''}"
            href="${echapper(el.href)}" data-today-id="${echapper(el.id)}">${contenu(el, true)}</a></li>`;
        }
        return `<li class="fz-notif-entry"><a class="fz-notif-item${el.read ? '' : ' is-unread'}${el.urgent ? ' is-urgent' : ''}"
            href="${echapper(el.href)}" data-notification-id="${echapper(el.id)}">${contenu(el, true)}</a></li>`;
    }

    function vide() {
        const [titre, detail] = filtreNonLues && elements.length
            ? ['Vous êtes à jour', 'Aucune notification non lue.']
            : ['Aucune notification', 'Vos invitations, offres d’échange et repêchages apparaîtront ici.'];
        return `<li class="fz-notif-empty"><strong>${titre}</strong><span>${detail}</span></li>`;
    }

    function rendreListe() {
        const liste = parId('fzNotifList');
        if (!liste) return;
        // Ce qui se passe en ce moment ignore le filtre « Non lues » : ce n'est
        // pas de l'historique, et le masquer cacherait un tour qui attend.
        const enCours = actuels();
        const montees = new Set(enCours.map(a => a.el.id));
        const visibles = elements.filter(el => !montees.has(el.id) && (!filtreNonLues || !el.read));
        // « À faire » met l'urgence devant ; les jours suivent l'ordre du temps.
        const html = GROUPES.map(groupe => {
            const membres = [
                ...(groupe.actuels ? enCours.filter(groupe.actuels).map(a => a.el) : []),
                ...visibles.filter(groupe.garde).sort(groupe.cle === 'afaire' ? trier : (a, b) => b.date - a.date)
            ];
            if (!membres.length) return '';
            return `<li class="fz-notif-group${groupe.cle === 'afaire' ? ' is-todo' : ''}">
                <h3 class="fz-notif-group-title" id="fzNotifGroup-${groupe.cle}">${groupe.titre}</h3>
                <ul class="fz-notif-group-list" aria-labelledby="fzNotifGroup-${groupe.cle}">${membres.map(ligne).join('')}</ul></li>`;
        }).join('') || vide();
        if (html !== derniereListe) {
            const focus = document.activeElement?.closest(LIGNES);
            const focusId = focus && liste.contains(focus) ? cleDeLigne(focus) : null;
            const scroll = liste.scrollTop;
            liste.innerHTML = html;
            derniereListe = html;
            if (focusId) [...liste.querySelectorAll(LIGNES)]
                .find(lien => cleDeLigne(lien) === focusId)?.focus({ preventScroll: true });
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
        const precedent = popupIds[0];
        popupIds = [...new Set([...popupIds, ...arrives.sort(trier).map(el => el.id)])];
        // Une urgence passe devant, sauf pendant une interaction : le lien
        // sous le pointeur ou le focus doit rester celui que l'utilisateur vise.
        if (!popupSurvole && !parId('fzNotifToast').contains(document.activeElement)) {
            const parIdentifiant = new Map(elements.map(el => [el.id, el]));
            popupIds.sort((a, b) => Number(!!parIdentifiant.get(b)?.urgent)
                - Number(!!parIdentifiant.get(a)?.urgent));
        }
        rendrePopup();
        parId('fzNotifToast').hidden = document.hidden;
        if (!dejaVisible || popupIds[0] !== precedent) {
            pauserPopup();
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
                        <span class="fz-notif-count" id="fzNotifCount" hidden></span>
                        <button type="button" class="fz-notif-mark-all" id="fzNotifMarkAll" aria-disabled="true">Tout marquer lu</button>
                        <button type="button" class="fz-notif-close" id="fzNotifClose" aria-label="Fermer les notifications">×</button>
                    </div>
                    <div class="fz-notif-toolbar">
                        <div class="fz-notif-tabs" role="group" aria-label="Afficher">
                            <button type="button" class="fz-notif-tab" id="fzNotifTabAll" aria-pressed="true">Toutes</button>
                            <button type="button" class="fz-notif-tab" id="fzNotifTabUnread" aria-pressed="false">Non lues</button>
                        </div>
                        <p class="fz-notif-help" id="fzNotifHelp" hidden></p>
                    </div>
                    <ul class="fz-notif-list" id="fzNotifList"></ul>
                    <div class="fz-notif-foot" data-fz-alertes="reglage" hidden></div>
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
            if (!elements.some(el => !el.read)) return;
            marquerLus(elements.map(el => el.id));
            // Aucun lien n'est en cours d'activation : « À faire » peut se
            // vider tout de suite, et chaque ligne rejoindre son jour.
            rendreListe();
        });
        const filtrer = nonLues => {
            filtreNonLues = nonLues;
            parId('fzNotifTabAll').setAttribute('aria-pressed', String(!nonLues));
            parId('fzNotifTabUnread').setAttribute('aria-pressed', String(nonLues));
            rendreListe();
            parId('fzNotifList').scrollTop = 0;
        };
        parId('fzNotifTabAll').addEventListener('click', () => filtrer(false));
        parId('fzNotifTabUnread').addEventListener('click', () => filtrer(true));
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

    /**
     * « Aujourd'hui » dans la liste (voir actuels()).
     *
     * La bande de priorité vivait sur l'accueil, puis en tête du panneau, dans
     * son propre style. Elle dit la même chose que la cloche — ce qui réclame
     * une action, tous pools confondus — : ses éléments sont donc devenus des
     * lignes de la liste.
     *
     * fzToday.js n'est chargé que sur l'accueil : ailleurs, la liste ne
     * montre que les notifications.
     */
    function brancherAujourdhui() {
        const client = window.FZToday;
        if (!client) return;
        // fzToday.js jette déjà les réponses périmées (pool changé en vol) et
        // garde la dernière en cas d'échec : chaque réponse reçue fait foi.
        client.surReponse(charge => { aujourdhui = charge; rendreListe(); });
        client.demarrer();
    }

    /**
     * La source serveur.
     *
     * Les entrées arrivent prêtes à afficher. En cas d'échec ou
     * d'indisponibilité, `serveurDisponible` passe à false et les sources
     * dérivées reprennent — la cloche continue de fonctionner, simplement sans
     * historique durable.
     */
    async function rafraichirServeur() {
        if (!compteActuel()) return;
        if (serveurEcarte) return;
        if (requeteServeur) return requeteServeur;

        requeteServeur = (async () => {
            try {
                const reponse = await fetch(`${FZPool.BASE_URL}/api/notifications`,
                    { cache: 'no-store', signal: AbortSignal.timeout(15000) });
                if (!reponse.ok) throw new Error('Notifications indisponibles');
                const charge = await reponse.json();
                if (!compteActuel()) return;

                if (!charge || charge.disponible !== true || !Array.isArray(charge.notifications)) {
                    // Réponse claire : il n'y a pas d'historique durable ici.
                    serveurDisponible = false;
                    serveurEcarte = true;
                    return;
                }

                serveurDisponible = true;
                erreurReseau = false;

                const nouveaux = charge.notifications.map(el => ({
                    id: el.id,
                    serverId: el.serverId,
                    type: el.type,
                    pool: el.pool,
                    titre: el.titre,
                    detail: el.detail,
                    action: el.action,
                    equipes: Array.isArray(el.equipes) && el.equipes.length === 2 ? el.equipes : null,
                    date: el.date,
                    href: el.href,
                    urgent: el.urgent === true,
                    resolue: el.resolue === true,
                    read: el.read === true
                }));

                const annoncer = serveurInitialise;
                serveurInitialise = true;
                initialise = true;
                integrer(nouveaux, annoncer);

                // La migration de l'ancien stockage se termine une fois que le
                // serveur a répondu : ses identifiants sont les mêmes, donc les
                // lectures déjà acquises ont été reprises.
                if (migration.size && !erreurStockage) {
                    localStorage.removeItem('fzNotifsVues');
                    migration.clear();
                }
            } catch {
                // Un premier échec ne condamne pas le serveur : on retombe sur
                // les sources dérivées, et on réessaiera au prochain signal.
                if (serveurDisponible === null) serveurDisponible = false;
                if (compteActuel()) { erreurReseau = true; majBadge(); }
            }
        })();

        try { await requeteServeur; } finally { requeteServeur = null; }
    }

    async function rafraichirEchanges() {
        if (!compteActuel()) return;
        // Le serveur porte déjà les offres reçues : deux sources produiraient
        // deux entrées pour la même proposition.
        if (serveurDisponible === true) return;
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
                    el.titre = 'Échange clôturé';
                    el.detail = 'Rien à faire de votre côté.';
                    el.action = 'Voir le suivi';
                    el.equipes = null;
                    el.resolue = true;
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
        // Idem : le serveur porte les alertes de tour et de départ.
        if (serveurDisponible === true) return;
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
            const socket = (window.fzSocketPartage && window.fzSocketPartage()) || window.__fzSocketPool || io(FZPool.BASE_URL);
            const tout = () => { rafraichirServeur(); rafraichirEchanges(); };
            socket.on('tradePending', tout);
            socket.on('tradeUpdated', tout);
            socket.on('poolUpdated', rafraichirServeur);
            socket.on('h2hWeekFinalized', rafraichirServeur);
            socket.on('connect', tout);
        } catch { /* Le sondage et le retour sur l'onglet prennent le relais. */ }
    }

    /**
     * Les alertes sur l'appareil (pushNotifications.js) : leur réglage vit au
     * pied du panneau, et le salon et la salle de repêchage s'en servent. Chargé
     * d'ici pour suivre la cloche sur chaque page sans toucher à chacune.
     */
    function chargerAlertes() {
        // La cloche ne dépend pas des alertes : un échec ici ne l'arrête pas.
        try {
            if (window.FZAlertes || document.querySelector('script[data-fz-alertes-script]')) return;
            const script = document.createElement('script');
            script.src = 'pushNotifications.js?v=20260930b';
            script.defer = true;
            script.dataset.fzAlertesScript = '';
            (document.head || document.body).appendChild(script);
        } catch { /* la cloche continue sans elles */ }
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
        chargerAlertes();
        brancherAujourdhui();
        rendreListe();
        await FZPool.ready();
        if (!compteActuel()) return;
        FZPool.onData(rafraichirDrafts);
        // Le serveur d'abord : sa réponse décide si les sources dérivées
        // doivent parler. Elles suivent, et se taisent d'elles-mêmes si oui.
        await rafraichirServeur();
        rafraichirDrafts();
        rafraichirEchanges();
        if (window.FZInvites) {
            FZInvites.onChange(rafraichirInvitations);
            // Déjà chargées avant nous : la liste ne reviendra qu'au prochain signal.
            if (FZInvites.loaded()) rafraichirInvitations(FZInvites.list());
        }
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
