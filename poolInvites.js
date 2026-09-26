/* ============================================================
   INVITATIONS REÇUES — la fenêtre qui surgit
   ------------------------------------------------------------
   La personne qui a créé un pool peut inviter quelqu'un depuis la fiche
   du pool (onglet « Inviter », poolSettings.js). La personne invitée le
   voit de deux façons :

     — une fenêtre, qui s'ouvre d'elle-même la première fois qu'une
       invitation arrive (au chargement, ou en direct par le signal
       `poolInvitation` du serveur) : rejoindre en nommant son équipe,
       refuser, ou remettre à plus tard ;
     — une entrée dans la cloche (notifications.js), qui rouvre la même
       fenêtre tant que l'invitation attend une réponse.

   « Plus tard » ne fait que ranger la fenêtre : l'invitation reste dans
   la cloche, et la fenêtre ne resurgit pas à chaque page.

   Accepter fait entrer sans le mot de passe du pool — c'est la personne
   qui a choisi l'invité qui ouvre la porte.
   ============================================================ */
(function () {
    const BASE_URL = (window.FZPool && FZPool.BASE_URL) ||
        (window.location.hostname.includes('localhost')
            ? 'http://localhost:3000'
            : window.location.origin);

    const echapper = texte => String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const utilisateur = () => localStorage.getItem('username') || '';
    const connecte = () => localStorage.getItem('isLoggedIn') === 'true' && !!utilisateur();

    // La salle de repêchage ne se fait pas couvrir par une fenêtre : un
    // choix à faire dans les secondes qui viennent passe avant. L'invitation
    // attend dans la cloche.
    const surgissementPermis = () => !window.location.pathname.includes('draftActif');

    let invitations = [];
    let chargee = false;
    let requete = null;
    let ouverte = null;          // l'invitation affichée, ou null
    let elementAvant = null;
    const abonnes = [];

    // ==================== DÉJÀ MONTRÉES ====================

    const cleVues = () => 'fzInvitationsVues:' + encodeURIComponent(utilisateur());
    const cleDe = inv => `${inv.poolName}|${inv.invitedAt}`;

    function vues() {
        try {
            const liste = JSON.parse(localStorage.getItem(cleVues()) || '[]');
            return new Set(Array.isArray(liste) ? liste : []);
        } catch { return new Set(); }
    }

    function marquerVue(inv) {
        const ensemble = vues();
        ensemble.add(cleDe(inv));
        try { localStorage.setItem(cleVues(), JSON.stringify([...ensemble].slice(-100))); }
        catch { /* stockage plein ou bloqué : la fenêtre pourra resurgir, rien de grave */ }
    }

    // ==================== CHARGEMENT ====================

    async function charger() {
        if (!connecte()) return;
        if (requete) return requete;
        requete = (async () => {
            try {
                const reponse = await fetch(`${BASE_URL}/api/invitations`, { cache: 'no-store' });
                if (!reponse.ok) return;
                const corps = await reponse.json();
                invitations = Array.isArray(corps.invitations) ? corps.invitations : [];
                chargee = true;
                abonnes.forEach(fn => { try { fn(invitations.slice()); } catch (e) { console.error(e); } });

                // L'invitation affichée a pu être annulée entre-temps.
                if (ouverte && !invitations.some(inv => inv.poolName === ouverte.poolName)) {
                    fermer({ raison: 'retiree' });
                }
                ouvrirDepuisUrl();
                surgirSiNouvelle();
            } catch { /* réseau : on réessaiera au prochain signal */ }
        })();
        try { await requete; } finally { requete = null; }
    }

    function surgirSiNouvelle() {
        if (ouverte || !surgissementPermis()) return;
        const dejaVues = vues();
        const nouvelle = invitations.find(inv => !dejaVues.has(cleDe(inv)));
        if (nouvelle) ouvrir(nouvelle.poolName);
    }

    /** `?invitation=<pool>` : le lien de la cloche, quand la page change. */
    function ouvrirDepuisUrl() {
        let demande = null;
        try { demande = new URLSearchParams(window.location.search).get('invitation'); } catch { /* */ }
        if (!demande) return;
        const url = new URL(window.location.href);
        url.searchParams.delete('invitation');
        history.replaceState(null, '', url.toString());
        if (invitations.some(inv => inv.poolName === demande)) ouvrir(demande);
    }

    // ==================== FENÊTRE ====================

    function construire() {
        if (document.getElementById('piCard')) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div class="pi-scrim" id="piScrim" hidden></div>
            <div class="pi-card" id="piCard" role="dialog" aria-modal="true"
                 aria-labelledby="piTitre" aria-describedby="piFaits" hidden></div>`);
        document.getElementById('piScrim').addEventListener('click', () => fermer({ raison: 'plus-tard' }));
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && ouverte) fermer({ raison: 'plus-tard' });
        });
    }

    function rendre(inv, message, estErreur) {
        const carte = document.getElementById('piCard');
        const mode = inv.poolMode === 'head-to-head' ? 'Tête-à-tête' : 'Cumulatif';
        const faits = [
            mode,
            `${inv.participantCount}/${inv.maxPlayers} participants`,
            inv.totalPicks ? `${inv.totalPicks} choix par équipe` : null
        ].filter(Boolean).join(' · ');
        const autres = invitations.filter(autre => autre.poolName !== inv.poolName).length;
        const image = inv.imageUrl || 'Icons/grayGroup.png';

        carte.innerHTML = `
            <button type="button" class="pi-close" id="piFermer" aria-label="Fermer — répondre plus tard">&times;</button>
            <img src="${echapper(image)}" class="pi-img" alt="" onerror="this.src='Icons/grayGroup.png'">
            <p class="pi-label">Invitation</p>
            <h2 class="pi-title" id="piTitre">
                <strong>${echapper(inv.invitedBy || 'On')}</strong> vous invite à rejoindre
                <strong>${echapper(inv.poolName)}</strong>
            </h2>
            <p class="pi-facts" id="piFaits">${echapper(faits)}</p>
            ${inv.complet ? `
                <p class="pi-note">Ce pool est complet pour l’instant. Vous pourrez entrer si une place se libère.</p>` : `
                <label class="pi-field-label" for="piEquipe">Nom de votre équipe</label>
                <input type="text" id="piEquipe" class="ps-input pi-input" maxlength="20" autocomplete="off"
                       value="${echapper(inv.nomSuggere || utilisateur())}">
                <p class="pi-note">Vous pourrez le changer plus tard. Pas besoin du mot de passe du pool.</p>`}
            <p class="pi-msg${estErreur ? ' is-error' : ''}" id="piMsg" role="alert" ${message ? '' : 'hidden'}>${echapper(message || '')}</p>
            <div class="pi-actions">
                <button type="button" class="ps-primary" id="piAccepter" ${inv.complet ? 'disabled' : ''}>Rejoindre le pool</button>
                <button type="button" class="ps-secondary" id="piRefuser">Refuser</button>
            </div>
            <button type="button" class="pi-later" id="piPlusTard">Plus tard</button>
            ${autres ? `<p class="pi-more">${autres} autre${autres > 1 ? 's' : ''} invitation${autres > 1 ? 's' : ''} en attente dans la cloche</p>` : ''}`;

        document.getElementById('piFermer').addEventListener('click', () => fermer({ raison: 'plus-tard' }));
        document.getElementById('piPlusTard').addEventListener('click', () => fermer({ raison: 'plus-tard' }));
        document.getElementById('piRefuser').addEventListener('click', refuser);
        document.getElementById('piAccepter').addEventListener('click', accepter);
        const champ = document.getElementById('piEquipe');
        if (champ) {
            champ.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); accepter(); }
            });
        }
    }

    function ouvrir(nomPool) {
        const inv = invitations.find(i => i.poolName === nomPool);
        if (!inv) return false;
        construire();
        if (!ouverte) elementAvant = document.activeElement;
        ouverte = inv;
        marquerVue(inv);
        rendre(inv);

        const carte = document.getElementById('piCard');
        document.getElementById('piScrim').hidden = false;
        carte.hidden = false;
        document.body.classList.add('pi-open');
        requestAnimationFrame(() => carte.classList.add('is-open'));
        const premier = document.getElementById('piEquipe') || document.getElementById('piAccepter');
        if (premier) premier.focus({ preventScroll: true });
        return true;
    }

    function fermer({ raison } = {}) {
        const carte = document.getElementById('piCard');
        if (!carte || !ouverte) return;
        ouverte = null;
        carte.classList.remove('is-open');
        document.body.classList.remove('pi-open');
        setTimeout(() => {
            carte.hidden = true;
            document.getElementById('piScrim').hidden = true;
            if (elementAvant && elementAvant.focus && document.contains(elementAvant)) elementAvant.focus();
            // Plusieurs invitations d'un coup : la suivante, une à la fois.
            if (raison !== 'entree') surgirSiNouvelle();
        }, 180);
    }

    function message(texte, estErreur) {
        const cible = document.getElementById('piMsg');
        if (!cible) return;
        cible.textContent = texte;
        cible.hidden = !texte;
        cible.classList.toggle('is-error', !!estErreur);
    }

    function occupe(oui) {
        ['piAccepter', 'piRefuser', 'piPlusTard'].forEach(id => {
            const bouton = document.getElementById(id);
            if (bouton) bouton.disabled = oui || (id === 'piAccepter' && ouverte && ouverte.complet);
        });
    }

    // ==================== RÉPONSES ====================

    async function accepter() {
        const inv = ouverte;
        if (!inv || inv.complet) return;
        const champ = document.getElementById('piEquipe');
        const nom = String(champ ? champ.value : '').trim();

        if (nom.length === 0 || nom.length > 20) { message('Le nom doit contenir entre 1 et 20 caractères.', true); return; }
        if (!/^[\p{L}\p{N}\s'\-_]+$/u.test(nom)) { message('Lettres, chiffres, espaces, tirets et apostrophes seulement.', true); return; }
        if (typeof contientGrossierete === 'function' && contientGrossierete(nom)) {
            message('Ce nom d’équipe contient un terme inapproprié. Choisissez-en un autre.', true);
            return;
        }

        occupe(true);
        const bouton = document.getElementById('piAccepter');
        if (bouton) bouton.textContent = 'Entrée…';
        try {
            const reponse = await fetch(`${BASE_URL}/api/invitations/accept`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ poolName: inv.poolName, teamName: nom })
            });
            const resultat = await reponse.json().catch(() => ({}));
            if (!reponse.ok) {
                message(resultat.message || 'Impossible de rejoindre ce pool.', true);
                if (bouton) bouton.textContent = 'Rejoindre le pool';
                occupe(false);
                if (reponse.status === 404) charger();
                return;
            }
            invitations = invitations.filter(i => i.poolName !== inv.poolName);
            abonnes.forEach(fn => { try { fn(invitations.slice()); } catch (e) { console.error(e); } });
            message(`Bienvenue dans ${inv.poolName} !`, false);
            fermer({ raison: 'entree' });
            // Le nouveau pool devient le pool actif : c'est lui qu'on vient
            // de choisir. FZPool.set recharge la page sur lui.
            if (window.FZPool) {
                await FZPool.refresh();
                if (FZPool.isMember(inv.poolName)) { FZPool.set(inv.poolName); return; }
            }
            window.location.href = `index.html?pool=${encodeURIComponent(inv.poolName)}`;
        } catch {
            message('Erreur de connexion au serveur.', true);
            if (bouton) bouton.textContent = 'Rejoindre le pool';
            occupe(false);
        }
    }

    async function refuser() {
        const inv = ouverte;
        if (!inv) return;
        occupe(true);
        try {
            const reponse = await fetch(`${BASE_URL}/api/invitations/decline`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ poolName: inv.poolName })
            });
            if (!reponse.ok) {
                const resultat = await reponse.json().catch(() => ({}));
                message(resultat.message || 'Impossible de refuser pour le moment.', true);
                occupe(false);
                return;
            }
            invitations = invitations.filter(i => i.poolName !== inv.poolName);
            abonnes.forEach(fn => { try { fn(invitations.slice()); } catch (e) { console.error(e); } });
            fermer({ raison: 'refus' });
        } catch {
            message('Erreur de connexion au serveur.', true);
            occupe(false);
        }
    }

    // ==================== TEMPS RÉEL ====================

    function brancherSocket(essai = 0) {
        // Le canal est ouvert par activePool.js : on s'y greffe plutôt que
        // d'en ouvrir un deuxième.
        const socket = window.__fzSocketPool;
        if (!socket) {
            if (essai < 60) setTimeout(() => brancherSocket(essai + 1), 250);
            return;
        }
        socket.on('poolInvitation', () => charger());
        socket.on('connect', () => { if (chargee) charger(); });
    }

    let dernierRetour = 0;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden || !connecte()) return;
        // Un aller-retour d'onglet toutes les deux secondes ne vaut pas une
        // requête chacun.
        if (Date.now() - dernierRetour < 30000) return;
        dernierRetour = Date.now();
        charger();
    });

    async function demarrer() {
        if (!connecte()) return;
        if (window.FZPool) await FZPool.ready();
        await charger();
        brancherSocket();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
    else demarrer();

    window.FZInvites = {
        /** Les invitations en attente, telles que le serveur les a servies. */
        list: () => invitations.slice(),
        /** Vrai une fois la première réponse du serveur reçue. */
        loaded: () => chargee,
        open: ouvrir,
        refresh: charger,
        /** Appelé après chaque chargement réussi, avec la liste à jour. */
        onChange: fn => { if (typeof fn === 'function') abonnes.push(fn); }
    };
})();
