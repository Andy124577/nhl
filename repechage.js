/* ============================================================
   REPÊCHAGE — porte d'entrée du pool actif
   ------------------------------------------------------------
   La page ne demande plus « quel pool ? » : elle ouvre celui qui est
   actif. Un repêchage déjà lancé n'a rien à faire attendre, on entre
   directement dans la salle de repêchage.

   Les notifications arrivent ici avec ?pool=<nom> ; activePool.js a
   déjà basculé le contexte au moment où ce fichier s'exécute.

   Avant que le repêchage puisse commencer, chaque équipe du pool doit
   aussi avoir choisi son identité LNH (voir la section « IDENTITÉ LNH »
   plus bas) : c'est elle qui marquera toutes ses cartes de choix, du
   premier tour au dernier, dans la salle de repêchage.
   ============================================================ */
(function () {
    const echapper = texte => String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const conteneur = () => document.getElementById('rpContent');

    function entete(pool, etiquette, classeEtat) {
        return `
            <header class="rp-head">
                <img src="${echapper(FZPool.image(pool.data))}" class="rp-img" alt=""
                     onerror="this.src='Icons/grayGroup.png'">
                <div class="rp-head-txt">
                    <p class="rp-eyebrow">Repêchage</p>
                    <h1 class="rp-title">${echapper(pool.name)}</h1>
                </div>
                <span class="rp-state rp-state-${classeEtat}">${etiquette}</span>
            </header>`;
    }

    function rendreVide() {
        conteneur().innerHTML = `
            <div class="fz-empty-pool">
                <h2>Aucun pool actif</h2>
                <p>Le repêchage se déroule dans un pool. Créez le vôtre ou rejoignez une ligue
                   ouverte pour commencer.</p>
                <div class="fz-empty-actions">
                    <a class="primary" href="creer-pool.html">Créer un pool</a>
                    <a class="secondary" href="rejoindre-pool.html">Rejoindre un pool</a>
                </div>
            </div>`;
    }

    /** Ce pool sort-il de la file du repêchage instantané ? */
    function estInstantane(pool) {
        return window.FZInstant
            ? window.FZInstant.estPoolInstantane(pool.name, pool.data)
            : pool.data.instant === true;
    }

    /** Qui a créé ce pool — même règle que le serveur (authz.createurDuPool). */
    function createurDe(poolData) {
        if (poolData.creator) return poolData.creator;
        const equipe1 = poolData.teams && poolData.teams['Équipe 1'];
        return (equipe1 && (equipe1.members || [])[0]) || null;
    }

    /** Équipes du pool avec au moins un membre — les seules qui comptent ici. */
    function equipesEligibles(poolData) {
        return Object.entries(poolData.teams || {})
            .filter(([, equipe]) => (equipe.members || []).length > 0)
            .sort(([a], [b]) => a.localeCompare(b, 'fr'));
    }

    /**
     * L'ordre du premier tour, s'il est déjà connu.
     *
     * Après une saison, il ne doit rien au hasard : le dernier au classement
     * choisit en premier (lib/poolOps.js, ordreDeDepart). On l'annonce avant
     * le départ, pour que personne ne le découvre dans la salle.
     */
    function ordreAnnonce(poolData) {
        const saisons = poolData.saisonsPrecedentes || [];
        const derniere = saisons[saisons.length - 1];
        if (!derniere || !Array.isArray(derniere.classement) || !derniere.classement.length) return null;

        const restantes = new Set(equipesEligibles(poolData).map(([nom]) => nom));
        const ordre = [];
        [...derniere.classement].sort((a, b) => (b.rang || 0) - (a.rang || 0)).forEach(ligne => {
            let nom = restantes.has(ligne.equipe) ? ligne.equipe : null;
            if (!nom && Array.isArray(ligne.membres)) {
                nom = [...restantes].find(n => (poolData.teams[n].members || []).some(m => ligne.membres.includes(m))) || null;
            }
            if (nom) { ordre.push({ nom, rang: ligne.rang }); restantes.delete(nom); }
        });
        [...restantes].forEach(nom => ordre.push({ nom, rang: null }));
        return ordre;
    }

    /**
     * Qui est là, équipe par équipe.
     *
     * Une personne, une équipe : la carte porte le nom que chacun a donné à
     * la sienne, et la personne derrière. Dans un pool rapide, les places
     * encore libres sont dessinées en pointillé — la file se remplit sous les
     * yeux, et c'est la seule preuve qu'elle avance.
     */
    function rendreInscrits(pool, etat, createur) {
        const moi = localStorage.getItem('username') || '';
        const equipes = equipesEligibles(pool.data);

        const places = equipes.map(([nom, equipe]) => {
            const membres = equipe.members || [];
            const estMoi = membres.includes(moi);
            const qui = membres.join(', ');
            return `
            <li class="rp-seat${estMoi ? ' is-me' : ''}">
                <span class="rp-seat-ini" aria-hidden="true">${echapper(((membres[0] || nom).charAt(0) || '?').toUpperCase())}</span>
                <span class="rp-seat-txt">
                    <span class="rp-seat-nom">${echapper(nom)}</span>
                    ${qui && qui !== nom ? `<span class="rp-seat-qui">${echapper(qui)}</span>` : ''}
                </span>
                ${estMoi ? '<span class="rp-seat-toi">toi</span>' : ''}
                ${createur && membres.includes(createur) ? '<span class="rp-seat-admin" title="A créé le pool">admin</span>' : ''}
            </li>`;
        });

        // Les places vides n'ont de sens que là où le pool doit être plein
        // pour partir. Ailleurs, dix pointillés pour cinq inscrits feraient
        // croire qu'il faut attendre les cinq autres.
        const libres = estInstantane(pool) ? Math.max(0, etat.max - etat.inscrits) : 0;
        const vides = Array.from({ length: libres }, () => `
            <li class="rp-seat is-free">
                <span class="rp-seat-ini" aria-hidden="true">+</span>
                <span class="rp-seat-nom">En attente…</span>
            </li>`);

        // Les invitations en attente prennent place à la suite, en
        // pointillé : on voit qui doit encore arriver. Seule la personne qui
        // a créé le pool peut en retirer une.
        const gerer = !!createur && createur === moi;
        const invites = invitationsEnAttente(pool.data).map(inv => `
            <li class="rp-seat is-invited">
                <span class="rp-seat-ini" aria-hidden="true">${echapper((inv.username.charAt(0) || '?').toUpperCase())}</span>
                <span class="rp-seat-txt">
                    <span class="rp-seat-nom">${echapper(inv.username)}</span>
                    <span class="rp-seat-qui">Invitation envoyée</span>
                </span>
                ${gerer ? `
                <button type="button" class="rp-seat-cancel" data-annuler-invitation="${echapper(inv.username)}"
                        aria-label="Annuler l’invitation de ${echapper(inv.username)}" title="Annuler l’invitation">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4"
                         stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>` : ''}
            </li>`);

        return `
            <div class="rp-roster-wrap">
                <h3 class="rp-roster-title">Participants · ${etat.inscrits} / ${etat.max} max.</h3>
                <ul class="rp-seats" id="rpSeats">${places.concat(invites, vides).join('')}</ul>
            </div>`;
    }

    function blocOrdre(pool) {
        const ordre = ordreAnnonce(pool.data);
        if (!ordre) {
            return `<p class="rp-note">L'ordre de sélection sera tiré au hasard au démarrage.</p>`;
        }
        return `
            <div class="rp-roster-wrap">
                <h3 class="rp-roster-title">Ordre du 1<sup>er</sup> tour · classement inversé</h3>
                <ol class="rp-order">
                    ${ordre.map(e => `
                        <li><span class="rp-order-nom">${echapper(e.nom)}</span>
                            <span class="rp-order-rang">${e.rang ? `${e.rang}<sup>${e.rang === 1 ? 'er' : 'e'}</sup> la saison passée` : 'nouvelle équipe'}</span></li>`).join('')}
                </ol>
                <p class="rp-note">Le dernier de la saison passée choisit en premier. Les nouvelles équipes passent après, tirées au sort.</p>
            </div>`;
    }

    // ==================== INVITER DES JOUEURS ====================
    //
    // La même recherche que l'onglet « Inviter » de la page du pool
    // (poolSettings.js), posée là où l'on attend ses amis : taper un nom,
    // inviter d'un clic. La personne invitée reçoit une notification et une
    // fenêtre qui la fait entrer sans le mot de passe du pool
    // (poolInvites.js). Le serveur réserve tout cela à la personne qui a
    // créé le pool : les autres gardent le lien à copier.

    /** La recherche en cours : elle survit aux redessins temps réel. */
    let recherche = { pool: null, q: '', resultats: [], charge: false, enCours: false, message: '', erreur: false };
    let minuterieRecherche = null;
    let numeroRecherche = 0;

    const urlPool = (nom, suite) => `${FZPool.BASE_URL}/api/pools/${encodeURIComponent(nom)}${suite}`;
    const icone = (nom, taille) => (typeof getIcon === 'function' ? getIcon(nom, taille || 16) : '');
    const ICONE_LIEN = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>`;
    const ICONE_OK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;

    function invitationsEnAttente(poolData) {
        return (Array.isArray(poolData.invitations) ? poolData.invitations : [])
            .filter(inv => inv && typeof inv.username === 'string' && inv.username)
            .sort((a, b) => String(a.invitedAt).localeCompare(String(b.invitedAt)));
    }

    function etatRecherche(nom) {
        if (recherche.pool !== nom) {
            recherche = { pool: nom, q: '', resultats: [], charge: false, enCours: false, message: '', erreur: false };
        }
        return recherche;
    }

    function avatarDe(username, url) {
        if (url) {
            return `<img src="${echapper(url)}" class="rp-avatar" alt="" onerror="this.src='Icons/grayUser.png'">`;
        }
        return `<span class="rp-avatar rp-avatar-ini" aria-hidden="true">${echapper((username.charAt(0) || '?').toUpperCase())}</span>`;
    }

    function lignesResultats(etat) {
        if (!etat.q || etat.q.trim().length < 2) return '';
        if (!etat.resultats.length) {
            if (etat.enCours) return '<li class="rp-results-empty">Recherche…</li>';
            return etat.charge
                ? `<li class="rp-results-empty">Aucun joueur ne s’appelle « ${echapper(etat.q.trim())} ».</li>`
                : '';
        }
        return etat.resultats.map(r => {
            const action = r.statut === 'membre'
                ? '<span class="rp-result-state">Déjà dans le pool</span>'
                : r.statut === 'invite'
                    ? `<span class="rp-result-state is-sent">${ICONE_OK} Invité</span>`
                    : `<button type="button" class="rp-invite-btn" data-inviter="${echapper(r.username)}">
                           ${icone('send', 14)} Inviter
                       </button>`;
            return `
                <li class="rp-result">
                    ${avatarDe(r.username, r.avatarUrl)}
                    <span class="rp-result-name">${echapper(r.username)}</span>
                    ${action}
                </li>`;
        }).join('');
    }

    function blocInviter(pool, etat) {
        const complet = etat.inscrits >= etat.max;
        const r = etatRecherche(pool.name);

        const corps = complet
            ? `<p class="rp-invite-full">Le pool est complet (${etat.max} participants maximum).</p>`
            : `
                <div class="rp-search${r.enCours ? ' is-busy' : ''}" id="rpSearch">
                    <span class="rp-search-ico" aria-hidden="true">${icone('search', 18)}</span>
                    <input type="search" id="rpInviteQ" class="rp-search-input" maxlength="40"
                           autocomplete="off" autocapitalize="off" spellcheck="false"
                           placeholder="Rechercher un nom d’utilisateur"
                           aria-label="Rechercher un joueur à inviter" aria-describedby="rpInviteSub"
                           aria-controls="rpInviteResults" value="${echapper(r.q)}">
                    <span class="rp-search-spin" aria-hidden="true"></span>
                </div>
                <ul class="rp-results" id="rpInviteResults" aria-live="polite">${lignesResultats(r)}</ul>
                <p class="rp-invite-msg${r.erreur ? ' is-error' : ''}" id="rpInviteMsg" role="status"
                   ${r.message ? '' : 'hidden'}>${r.erreur ? '' : ICONE_OK}<span>${echapper(r.message)}</span></p>`;

        return `
            <section class="rp-invite" aria-labelledby="rpInviteTitre">
                <h3 class="rp-roster-title" id="rpInviteTitre">Inviter des joueurs</h3>
                <p class="rp-invite-sub" id="rpInviteSub">La personne reçoit une notification et entre d’un clic,
                    sans le mot de passe du pool.</p>
                ${corps}
                <div class="rp-invite-alt">
                    <span>Un ami n’a pas encore de compte ?</span>
                    <button type="button" class="rp-link-btn" id="rpInviter">${ICONE_LIEN}<span>Copier le lien d’invitation</span></button>
                </div>
            </section>`;
    }

    /** Redessine la liste et le message seulement : le champ garde son focus. */
    function majResultats() {
        const liste = document.getElementById('rpInviteResults');
        if (liste) liste.innerHTML = lignesResultats(recherche);
        document.getElementById('rpSearch')?.classList.toggle('is-busy', !!recherche.enCours);
        const msg = document.getElementById('rpInviteMsg');
        if (msg) {
            msg.innerHTML = `${recherche.erreur ? '' : ICONE_OK}<span>${echapper(recherche.message || '')}</span>`;
            msg.hidden = !recherche.message;
            msg.classList.toggle('is-error', !!recherche.erreur);
        }
    }

    /** Une frappe relance la recherche un instant plus tard, pas à chaque lettre. */
    function programmerRecherche(nom, valeur) {
        const etat = etatRecherche(nom);
        Object.assign(etat, { q: valeur, message: '', erreur: false });
        clearTimeout(minuterieRecherche);
        if (valeur.trim().length < 2) {
            numeroRecherche++;   // une réponse encore en route ne doit plus s'afficher
            Object.assign(etat, { resultats: [], charge: false, enCours: false });
            majResultats();
            return;
        }
        etat.enCours = true;
        majResultats();
        minuterieRecherche = setTimeout(() => lancerRecherche(nom, valeur), 250);
    }

    async function lancerRecherche(nom, valeur) {
        clearTimeout(minuterieRecherche);
        const q = String(valeur || '').trim();
        if (q.length < 2) return;
        const numero = ++numeroRecherche;
        etatRecherche(nom).enCours = true;
        majResultats();
        try {
            const reponse = await fetch(`${urlPool(nom, '/invite-search')}?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
            const corps = await reponse.json().catch(() => ({}));
            // Une réponse lente ne doit pas écraser celle d'une frappe plus récente.
            if (numero !== numeroRecherche || recherche.pool !== nom) return;
            if (!reponse.ok) throw new Error(corps.message || 'Recherche impossible.');
            Object.assign(recherche, { resultats: corps.resultats || [], charge: true, enCours: false });
        } catch (erreur) {
            if (numero !== numeroRecherche) return;
            Object.assign(recherche, {
                resultats: [], charge: false, enCours: false,
                message: erreur.message || 'Erreur de connexion au serveur.', erreur: true
            });
        }
        majResultats();
    }

    async function inviterCompte(nom, username, bouton) {
        if (bouton) { bouton.disabled = true; bouton.textContent = 'Envoi…'; }
        try {
            const reponse = await fetch(urlPool(nom, '/invitations'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });
            const corps = await reponse.json().catch(() => ({}));
            if (!reponse.ok) throw new Error(corps.message || 'Invitation impossible.');
            Object.assign(etatRecherche(nom), {
                resultats: recherche.resultats.map(r => r.username === username ? { ...r, statut: 'invite' } : r),
                message: corps.message || `Invitation envoyée à ${username}.`,
                erreur: false
            });
            await FZPool.refresh();
        } catch (erreur) {
            Object.assign(etatRecherche(nom), { message: erreur.message || 'Erreur de connexion au serveur.', erreur: true });
        }
        rendre();
        // On invite souvent plusieurs amis d'affilée : le champ reprend la main.
        document.getElementById('rpInviteQ')?.focus({ preventScroll: true });
    }

    async function annulerInvitation(nom, username, bouton) {
        if (bouton) bouton.disabled = true;
        try {
            const reponse = await fetch(urlPool(nom, '/invitations/cancel'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });
            const corps = await reponse.json().catch(() => ({}));
            // 404 : déjà partie (acceptée, refusée) — le but est atteint.
            if (!reponse.ok && reponse.status !== 404) throw new Error(corps.message || 'Annulation impossible.');
            Object.assign(etatRecherche(nom), {
                resultats: recherche.resultats.map(r => r.username === username ? { ...r, statut: null } : r),
                message: `Invitation de ${username} annulée.`,
                erreur: false
            });
            await FZPool.refresh();
        } catch (erreur) {
            if (bouton) bouton.disabled = false;
            fzAlert({ type: 'error', title: 'Annulation impossible', message: erreur.message || 'Erreur de connexion au serveur.' });
            return;
        }
        rendre();
    }

    function brancherInvitations(pool) {
        const champ = document.getElementById('rpInviteQ');
        if (champ) {
            champ.addEventListener('input', () => programmerRecherche(pool.name, champ.value));
            champ.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); lancerRecherche(pool.name, champ.value); }
            });
            // La croix native du champ « search » vide sans événement input
            // sur certains navigateurs.
            champ.addEventListener('search', () => programmerRecherche(pool.name, champ.value));
        }
        document.getElementById('rpInviteResults')?.addEventListener('click', e => {
            const bouton = e.target.closest('[data-inviter]');
            if (bouton && !bouton.disabled) inviterCompte(pool.name, bouton.dataset.inviter, bouton);
        });
        document.getElementById('rpSeats')?.addEventListener('click', e => {
            const bouton = e.target.closest('[data-annuler-invitation]');
            if (bouton && !bouton.disabled) annulerInvitation(pool.name, bouton.dataset.annulerInvitation, bouton);
        });
    }

    /**
     * Le salon d'avant-repêchage : qui est là, et qui peut lancer.
     *
     * `maxPlayers` est un plafond : cinq personnes dans un pool à dix places
     * peuvent repêcher. Le bouton de départ n'apparaît qu'à la personne qui a
     * créé le pool — le serveur refuserait tout autre clic, et un bouton qui
     * finit en « vous n'avez pas le droit » n'a rien à faire à l'écran des
     * autres.
     */
    function rendreSalon(pool, etat) {
        const instantane = estInstantane(pool);
        const createur = createurDe(pool.data);
        const moi = localStorage.getItem('username') || '';
        const jeSuisCreateur = !!createur && createur === moi;
        const pret = etat.etat === 'pret';

        let lead;
        if (instantane) {
            const restants = Math.max(0, etat.max - etat.inscrits);
            lead = restants > 0
                ? `Le repêchage démarre tout seul dès que vous êtes ${etat.max}. Il manque ${restants} joueur${restants > 1 ? 's' : ''}.`
                : 'Tout le monde est là : le repêchage va démarrer.';
        } else if (etat.raison === 'deux') {
            lead = 'Il faut au moins 2 équipes pour repêcher. Invitez quelqu’un à rejoindre le pool.';
        } else if (etat.raison === 'pair') {
            lead = `Tête-à-tête : les duels se jouent à deux, il faut donc un nombre pair d'équipes (${etat.equipes} pour l'instant).`;
        } else if (jeSuisCreateur) {
            lead = `${etat.equipes} équipes sont prêtes. Vous pouvez lancer maintenant ou attendre d'autres participants (jusqu'à ${etat.max}).`;
        } else {
            lead = `${etat.equipes} équipes sont prêtes. ${createur ? echapper(createur) : 'La personne qui a créé le pool'} lancera le repêchage.`;
        }

        const progression = etat.max > 0 ? Math.round((etat.inscrits / etat.max) * 100) : 0;
        const barre = instantane ? `
                    <div class="rp-progress" role="img" aria-label="${etat.inscrits} participants sur ${etat.max}">
                        <div class="rp-progress-fill" style="width:${progression}%"></div>
                    </div>` : '';

        let depart = '';
        if (!instantane) {
            if (jeSuisCreateur) {
                depart = `
                        <button type="button" class="rp-btn primary" id="rpStart"${pret ? '' : ' disabled'}>
                            Commencer le repêchage
                        </button>`;
            } else if (pret) {
                depart = `<p class="rp-wait-admin" role="status">En attente du lancement par ${echapper(createur || "l'admin du pool")}.</p>`;
            }
        }

        // La recherche d'invités : pour qui a créé le pool, tant qu'il n'est
        // pas une file instantanée (celle-ci se remplit toute seule).
        const inviterParNom = jeSuisCreateur && !instantane;
        const lienSeul = !instantane && !inviterParNom
            ? '<button type="button" class="rp-btn secondary" id="rpInviter"><span>Copier le lien d’invitation</span></button>'
            : '';

        // Une mise à jour temps réel redessine toute la carte : si l'on était
        // en train de taper un nom, le champ reprend focus et curseur.
        const actif = document.activeElement;
        const saisie = actif && actif.id === 'rpInviteQ'
            ? { debut: actif.selectionStart, fin: actif.selectionEnd }
            : null;

        conteneur().innerHTML = `
            <article class="rp-card">
                ${entete(pool, pret ? 'Prêt' : 'En attente', pret ? 'pret' : 'attente')}
                <div class="rp-body">
                    <p class="rp-lead">${lead}</p>
                    ${barre}
                    ${rendreInscrits(pool, etat, createur)}
                    ${inviterParNom ? blocInviter(pool, etat) : ''}
                    ${instantane ? '' : blocOrdre(pool)}
                    <div class="rp-actions">
                        ${depart}
                        ${lienSeul}
                        <button type="button" class="rp-btn secondary" data-fz-reglages="equipes">Renommer mon équipe</button>
                        ${instantane
                            ? '<button type="button" class="rp-btn secondary rp-quitter" id="rpQuitter">Quitter la file</button>'
                            : ''}
                    </div>
                </div>
            </article>`;

        document.getElementById('rpQuitter')?.addEventListener('click', quitterLaFile);
        document.getElementById('rpStart')?.addEventListener('click', () => demarrer(pool.name));
        document.getElementById('rpInviter')?.addEventListener('click', () => inviter(pool.name));
        brancherInvitations(pool);

        if (saisie) {
            const champ = document.getElementById('rpInviteQ');
            if (champ) {
                champ.focus({ preventScroll: true });
                try { champ.setSelectionRange(saisie.debut, saisie.fin); } catch { /* type sans sélection */ }
            }
        }
    }

    /** Le lien « Rejoindre » filtré sur ce pool, dans le presse-papiers. */
    async function inviter(nomPool) {
        const bouton = document.getElementById('rpInviter');
        const libelle = bouton && (bouton.querySelector('span') || bouton);
        const lien = `${window.location.origin}/rejoindre-pool.html?q=${encodeURIComponent(nomPool)}`;
        try {
            await navigator.clipboard.writeText(lien);
            if (libelle) libelle.textContent = 'Lien copié !';
        } catch (e) {
            // Presse-papiers refusé (page non sécurisée, permission) : le
            // lien s'affiche, sélectionné, avec son propre bouton Copier.
            fzCopy({
                title: 'Lien d’invitation',
                message: 'Envoyez ce lien à vos amis : il les mène directement à votre pool.',
                value: lien
            });
        }
        if (libelle) setTimeout(() => { libelle.textContent = 'Copier le lien d’invitation'; }, 2500);
    }

    /**
     * Sortie de la file instantanée.
     *
     * Tout se passe dans instantDraft.js : l'appel au serveur, le contexte de
     * pool à nettoyer, la confirmation. Ici on ne décide que de la suite —
     * partir de cette page, qui ne montre plus rien une fois la place rendue.
     */
    async function quitterLaFile() {
        const bouton = document.getElementById('rpQuitter');
        if (!window.FZInstant || typeof window.FZInstant.quitter !== 'function') {
            fzAlert({ type: 'warning', title: 'Action indisponible', message: 'Rechargez la page, puis réessayez.' });
            return;
        }
        if (bouton) { bouton.disabled = true; }

        const parti = await window.FZInstant.quitter();
        if (parti) {
            window.location.replace('rejoindre-pool.html');
            return;
        }
        if (bouton) { bouton.disabled = false; }
        // Refus du serveur (repêchage parti entre-temps) : FZInstant a déjà
        // relu les pools, le rendu suivant montre le bon écran.
        rendre();
    }

    function rendreTermine(pool) {
        conteneur().innerHTML = `
            <article class="rp-card">
                ${entete(pool, 'Terminé', 'termine')}
                <div class="rp-body">
                    <p class="rp-lead">Le repêchage de ce pool est terminé. Place à la saison.</p>
                    <div class="rp-actions">
                        <a class="rp-btn primary" href="classement.html">Voir le classement</a>
                        <a class="rp-btn secondary" href="draftFini.html">Revoir les sélections</a>
                    </div>
                </div>
            </article>`;
    }

    function rendreOuverture(pool) {
        conteneur().innerHTML = `
            <div class="rp-loading">
                <div class="rp-spinner" aria-hidden="true"></div>
                <p>Ouverture du repêchage de <strong>${echapper(pool.name)}</strong>…</p>
            </div>`;
    }

    async function demarrer(nomPool) {
        const bouton = document.getElementById('rpStart');
        if (bouton) { bouton.disabled = true; bouton.textContent = 'Démarrage…'; }

        try {
            // Un ordre peut déjà exister si quelqu'un d'autre vient de lancer
            // le repêchage : on ne le retire pas, on entre simplement.
            const reponse = await fetch(`${FZPool.BASE_URL}/draft-order/${encodeURIComponent(nomPool)}`);
            const resultat = await reponse.json();

            if (!resultat.draftOrder || resultat.draftOrder.length === 0) {
                const depart = await fetch(`${FZPool.BASE_URL}/start-draft`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clanName: nomPool })
                });
                const donnees = await depart.json().catch(() => ({}));
                if (!depart.ok) {
                    // Le pool a pu changer entre le rendu et le clic (un membre
                    // parti, par exemple) : le serveur reste la source de
                    // vérité, on relit l'état plutôt que d'insister sur un
                    // départ déjà refusé.
                    fzAlert({ type: 'error', title: 'Démarrage impossible', message: donnees.message || 'Le repêchage n’a pas pu démarrer.' });
                    if (bouton) { bouton.disabled = false; bouton.textContent = 'Commencer le repêchage'; }
                    await FZPool.refresh();
                    rendre();
                    return;
                }
            }

            localStorage.setItem('draftClan', nomPool);
            window.location.href = 'draftActif.html';
        } catch (erreur) {
            console.error('Démarrage du repêchage impossible :', erreur);
            if (bouton) { bouton.disabled = false; bouton.textContent = 'Commencer le repêchage'; }
            fzAlert({ type: 'error', title: 'Démarrage impossible', message: 'Le repêchage n’a pas pu être préparé. Vérifiez votre connexion et réessayez.' });
        }
    }

    function rendre() {
        if (!conteneur()) return;

        const nom = FZPool.get();
        const pool = FZPool.mine().find(p => p.name === nom);
        if (!pool) { rendreVide(); return; }

        const etat = FZPool.draftState(pool.data);

        if (etat.etat === 'encours') {
            // location.replace : revenir en arrière depuis la salle de
            // repêchage ne doit pas rebondir ici indéfiniment.
            rendreOuverture(pool);
            localStorage.setItem('draftClan', pool.name);
            window.location.replace('draftActif.html');
            return;
        }

        if (etat.etat === 'termine') { rendreTermine(pool); return; }
        rendreSalon(pool, etat);
    }

    // Le pool actif change depuis le rail : la page se remet à jour sans
    // rechargement, et repart vers la salle de repêchage s'il le faut.
    window.FZ_POOL_EN_PLACE = true;

    document.addEventListener('DOMContentLoaded', async () => {
        if (localStorage.getItem('isLoggedIn') !== 'true') {
            window.location.href = 'login.html';
            return;
        }
        await FZPool.ready();
        rendre();
        FZPool.on(rendre);
        FZPool.onData(rendre);
    });
})();
