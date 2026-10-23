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

   Habillage : maquette « Pool · avant le repêchage » (langage 6b
   Éditorial, repechage.css). Un héros sombre dans les deux thèmes — état,
   mode, début, participants —, le bouton de départ collé au-dessus de la
   barre du bas au téléphone, puis l'invitation, l'ordre du premier tour
   et les réglages en cartes.
   ============================================================ */
(function () {
    const echapper = texte => String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const conteneur = () => document.getElementById('rpContent');

    /** Les pictogrammes de la maquette, au trait, comme ceux de l'accueil. */
    const ICONES = {
        eclair: '<path d="m13 2-9 12h7l-1 8 10-13h-8Z"/>',
        horloge: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        equipe: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20v-1.5a6 6 0 0 1 12 0V20M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4.5V20"/>',
        inviter: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20v-1.5a6 6 0 0 1 12 0V20M19 8v6M16 11h6"/>',
        de: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01" stroke-width="3"/>',
        liste: '<path d="M10 6h10M10 12h10M10 18h10M4.5 6h.01M4.5 12h.01M4.5 18h.01" />',
        tourner: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
        hasard: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
        coche: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
        crosse: '<path d="M15 3 9.6 16.2A2.5 2.5 0 0 1 7.3 18H3v3h5.4a3.5 3.5 0 0 0 3.2-2.1L18 3"/><path d="M15.5 20.5h5"/>',
        lien: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
        crayon: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
        sortie: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
        calendrier: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
        alerte: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
        sablier: '<path d="M6 3h12M6 21h12M7 3v3a5 5 0 0 0 10 0V3M7 21v-3a5 5 0 0 1 10 0v3"/>',
        chevron: '<path d="m9 6 6 6-6 6"/>'
    };
    const ico = (nom, taille = 20) =>
        `<svg class="rp-ico" width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONES[nom] || ''}</svg>`;

    /** L'en-tête d'une carte : pictogramme, titre (HTML de confiance), un mot à droite. */
    function teteCarte(icone, titre, meta, id) {
        return `
            <header class="rp-card-tete">
                ${ico(icone, 22)}
                <h2 id="${id}">${titre}</h2>
                ${meta ? `<span class="rp-card-meta">${meta}</span>` : ''}
            </header>`;
    }

    function rendreVide() {
        conteneur().innerHTML = `
            <div class="fz-empty-pool">
                <h2>Aucun pool actif</h2>
                <p>Le repêchage se déroule dans un pool. Crée le tien ou rejoins une ligue
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
     * Une couleur par équipe, la même partout : sa pastille parmi les
     * participants, sa part de la roue, son rang dans l'ordre. Des teintes
     * qui portent toutes un texte blanc lisible. Vingt, une par place
     * possible : au-delà de dix, la onzième équipe ne reprend plus la
     * couleur de la première.
     */
    const TEINTES = ['#c0392b', '#1f5fbf', '#1e8449', '#7d3c98', '#b35309',
        '#117a8b', '#a93266', '#4d6320', '#34495e', '#8e5a1f',
        '#283593', '#880e4f', '#0277bd', '#86198f', '#00695c',
        '#7b6a00', '#5d4037', '#bf360c', '#be185d', '#455a64'];

    function teinteDe(poolData, nom) {
        const rang = equipesEligibles(poolData).findIndex(([n]) => n === nom);
        return TEINTES[Math.max(0, rang) % TEINTES.length];
    }

    /** « U2 », « LB », « A » : ce qui tient dans une pastille ronde. */
    function initiales(nom) {
        const mots = String(nom || '').trim().split(/[\s._-]+/).filter(Boolean);
        if (!mots.length) return '?';
        if (mots.length > 1) return (mots[0].charAt(0) + mots[1].charAt(0)).toUpperCase();
        const chiffre = mots[0].length > 1 ? mots[0].match(/\d$/) : null;
        return (mots[0].charAt(0) + (chiffre ? chiffre[0] : '')).toUpperCase();
    }

    /** La pastille d'une équipe : les initiales de la personne qui la dirige. */
    function initialesEquipe(poolData, nom) {
        const equipe = (poolData.teams || {})[nom];
        return initiales(((equipe && equipe.members) || [])[0] || nom);
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
            // L'admin du pool est marqué : c'est la seule personne qui peut lancer.
            const admin = !!createur && membres.includes(createur);
            const sous = [qui && qui !== nom ? echapper(qui) : '', admin ? 'admin' : ''].filter(Boolean).join(' · ');
            return `
            <li class="rp-seat${estMoi ? ' is-me' : ''}">
                <span class="rp-seat-ini" style="--c:${teinteDe(pool.data, nom)}" aria-hidden="true">${echapper(initiales(membres[0] || nom))}</span>
                <span class="rp-seat-txt">
                    <span class="rp-seat-nom">${echapper(nom)}</span>
                    ${sous ? `<span class="rp-seat-qui"${admin ? ' title="A créé le pool"' : ''}>${sous}</span>` : ''}
                </span>
                ${estMoi ? '<span class="rp-seat-toi">Toi</span>' : ''}
            </li>`;
        });

        // Les places vides n'ont de sens que là où le pool doit être plein
        // pour partir. Ailleurs, dix pointillés pour cinq inscrits feraient
        // croire qu'il faut attendre les cinq autres.
        const libres = estInstantane(pool) ? Math.max(0, etat.max - etat.inscrits) : 0;
        const vides = Array.from({ length: libres }, () => `
            <li class="rp-seat is-free">
                <span class="rp-seat-ini" aria-hidden="true">+</span>
                <span class="rp-seat-txt"><span class="rp-seat-nom">En attente…</span></span>
            </li>`);

        // Les invitations en attente prennent place à la suite, en
        // pointillé : on voit qui doit encore arriver. La personne qui a créé
        // le pool peut en retirer une ; un membre, celles qu'il a envoyées.
        const gerer = inv => (!!createur && createur === moi) || inv.invitedBy === moi;
        const invites = invitationsEnAttente(pool.data).map(inv => `
            <li class="rp-seat is-invited">
                <span class="rp-seat-ini" aria-hidden="true">${echapper(initiales(inv.username))}</span>
                <span class="rp-seat-txt">
                    <span class="rp-seat-nom">${echapper(inv.username)}</span>
                    <span class="rp-seat-qui">Invitation envoyée${inv.invitedBy && inv.invitedBy !== moi ? ` par ${echapper(inv.invitedBy)}` : ''}</span>
                </span>
                ${gerer(inv) ? `
                <button type="button" class="rp-seat-cancel" data-annuler-invitation="${echapper(inv.username)}"
                        aria-label="Annuler l’invitation de ${echapper(inv.username)}" title="Annuler l’invitation">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4"
                         stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>` : ''}
            </li>`);

        const plein = etat.inscrits >= etat.max;
        return `
            <div class="rp-inscrits">
                <p class="rp-inscrits-tete"><span>Participants</span><span>${etat.inscrits} / ${etat.max}${plein ? ' · complet' : ' max.'}</span></p>
                <ul class="rp-seats" id="rpSeats">${places.concat(invites, vides).join('')}</ul>
            </div>`;
    }

    // ───────────────────────── La roue de l'ordre ─────────────────────────
    //
    // Sans saison précédente, la personne qui a créé le pool peut tirer
    // l'ordre du premier tour à la roue, un rang à la fois, ou tout le reste
    // d'un coup (lib/poolOps.js, tournerRoue). Le serveur tire ; chaque salon
    // joue ensuite la même animation vers l'équipe sortie, à l'arrivée de
    // l'état relu. Ce qui n'est pas tiré l'est au hasard au lancement.

    const ROUE_MS = 4200;

    /**
     * Ce que ce salon a déjà montré de la roue : c'est ce qui dit quoi
     * animer quand l'état change. Pendant l'animation, un redessin
     * l'interromprait : rendre() attend la fin.
     */
    const roue = { pool: null, montrees: null, animation: null, focusApres: false };

    const mouvementReduit = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /** Même lecture que le serveur (poolOps.tirageRoue) : les sorties encore inscrites, puis les autres. */
    function tirageDe(poolData) {
        const inscrites = equipesEligibles(poolData).map(([nom]) => nom);
        const sorties = [];
        for (const nom of (Array.isArray(poolData.tirageOrdre) ? poolData.tirageOrdre : [])) {
            if (inscrites.includes(nom) && !sorties.includes(nom)) sorties.push(nom);
        }
        return { sorties, restantes: inscrites.filter(nom => !sorties.includes(nom)) };
    }

    /**
     * La roue à dessiner. Une seule équipe sortie depuis le dernier dessin :
     * on garde la roue d'avant le tirage, pour la faire tourner jusqu'à elle.
     * Sinon (premier dessin, « tout tirer », une équipe partie), on montre
     * l'état tel quel.
     */
    function etatRoue(pool) {
        const { sorties, restantes } = tirageDe(pool.data);
        const deja = roue.pool === pool.name ? roue.montrees : null;
        const uneDePlus = deja && sorties.length === deja.length + 1 && deja.every((nom, i) => sorties[i] === nom);
        if (uneDePlus && !mouvementReduit()) {
            const cible = sorties[sorties.length - 1];
            return { sorties: deja, segments: [...restantes, cible].sort((a, b) => a.localeCompare(b, 'fr')), cible, apres: sorties };
        }
        if (uneDePlus) annoncerRoue(sorties.length, sorties[sorties.length - 1]);
        roue.pool = pool.name;
        roue.montrees = sorties;
        return { sorties, segments: restantes, cible: null };
    }

    /** Un lecteur d'écran apprend le résultat : hors du contenu redessiné, sinon il se perd. */
    function annoncerRoue(numero, equipe) {
        let zone = document.getElementById('rpRoueAnnonce');
        if (!zone) {
            zone = document.createElement('p');
            zone.id = 'rpRoueAnnonce';
            zone.className = 'rp-sr';
            zone.setAttribute('aria-live', 'polite');
            document.body.appendChild(zone);
        }
        zone.textContent = `Choix ${numero} du premier tour : ${equipe}.`;
    }

    function roueSvg(pool, equipes) {
        const n = equipes.length;
        const R = 100;
        const pas = 360 / n;
        const point = angle => {
            const rad = angle * Math.PI / 180;
            return `${(R * Math.sin(rad)).toFixed(2)} ${(-R * Math.cos(rad)).toFixed(2)}`;
        };
        // Le nom court du moyeu au bord : moins de place quand les parts s'amincissent.
        const taille = n <= 4 ? 15 : n <= 8 ? 12 : n <= 12 ? 10 : 8;
        const lettres = n <= 4 ? 9 : n <= 8 ? 11 : n <= 12 ? 12 : 10;
        const court = nom => (nom.length > lettres ? `${nom.slice(0, lettres - 1)}…` : nom);
        const parts = equipes.map((nom, i) => {
            const teinte = teinteDe(pool.data, nom);
            const forme = n === 1
                ? `<circle r="${R}" class="rp-roue-seg" style="fill:${teinte}"/>`
                : `<path d="M0 0 L${point(i * pas)} A${R} ${R} 0 ${pas > 180 ? 1 : 0} 1 ${point((i + 1) * pas)} Z" class="rp-roue-seg" style="fill:${teinte}"/>`;
            // Le long du rayon, lisible des deux côtés de la roue.
            const milieu = (i + 0.5) * pas;
            const sens = milieu > 180 ? 90 : -90;
            return `${forme}
                <g transform="rotate(${milieu.toFixed(2)}) translate(0 -${R * 0.6}) rotate(${sens})">
                    <text class="rp-roue-txt" text-anchor="middle" dominant-baseline="central" font-size="${taille}">${echapper(court(nom).toUpperCase())}</text>
                </g>`;
        }).join('');
        return `
            <svg class="rp-roue" id="rpRoue" viewBox="-100 -100 200 200" aria-hidden="true">
                <defs>
                    <radialGradient id="rpRoueOmbre">
                        <stop offset="55%" stop-color="#000" stop-opacity="0"/>
                        <stop offset="100%" stop-color="#000" stop-opacity=".25"/>
                    </radialGradient>
                </defs>
                ${parts}
                <circle r="${R}" fill="url(#rpRoueOmbre)"/>
            </svg>`;
    }

    /** Un rang du premier tour : son numéro, la pastille de l'équipe, son nom. `note` : HTML de confiance. */
    function rangee(pool, k, nom, note) {
        return `
            <li class="rp-rang">
                <span class="rp-rang-num">${k + 1}</span>
                <span class="rp-rang-ini" style="--c:${teinteDe(pool.data, nom)}" aria-hidden="true">${echapper(initialesEquipe(pool.data, nom))}</span>
                <span class="rp-order-nom">${echapper(nom)}</span>
                ${note ? `<span class="rp-rang-note">${note}</span>` : ''}
            </li>`;
    }

    function rangeeLibre(k, tourne) {
        return `
            <li class="rp-rang is-libre${tourne ? ' is-tourne' : ''}">
                <span class="rp-rang-num">${k + 1}</span>
                <span class="rp-rang-ini" aria-hidden="true"></span>
                <span class="rp-order-nom">${tourne ? 'La roue tourne…' : 'À tirer'}</span>
            </li>`;
    }

    function blocRoue(pool, jeSuisCreateur) {
        const inscrites = equipesEligibles(pool.data).length;
        if (inscrites < 2) {
            return `
            <section class="rp-card rp-ordre" aria-labelledby="rpRoueTitre">
                ${teteCarte('de', 'Ordre du 1<sup>er</sup> tour', '', 'rpRoueTitre')}
                <p class="rp-card-sub">L’ordre de sélection sera tiré au hasard au démarrage.</p>
            </section>`;
        }
        const e = etatRoue(pool);
        roue.animation = e.cible ? {
            cible: e.cible, segments: e.segments, apres: e.apres, numero: e.sorties.length + 1,
            teinte: teinteDe(pool.data, e.cible), ini: initialesEquipe(pool.data, e.cible)
        } : null;

        const fini = e.segments.length === 0;
        const rangs = [
            ...e.sorties.map((nom, k) => rangee(pool, k, nom, k === 0 ? 'Choisit en premier' : '')),
            ...e.segments.map((_, k) => rangeeLibre(e.sorties.length + k, k === 0 && !!e.cible))
        ].join('');

        // Aux autres, la roue n'apparaît qu'une fois le tirage commencé :
        // une roue que personne ne peut tourner n'annoncerait rien.
        const montrerRoue = !fini && (jeSuisCreateur || e.sorties.length > 0 || e.cible);
        const montrerRangs = e.sorties.length || e.cible || jeSuisCreateur;
        const occupe = e.cible ? ' disabled' : '';
        let actions = '';
        if (jeSuisCreateur && !fini) {
            actions = `
                <div class="rp-roue-actions">
                    <button type="button" class="rp-roue-btn is-main${e.cible ? ' is-tourne' : ''}" id="rpRoueTourner"${occupe}>
                        ${ico('tourner', 20)}<span>${e.cible ? 'Ça tourne…' : 'Tourner la roue'}</span>
                    </button>
                    ${e.segments.length > 1 ? `
                    <button type="button" class="rp-roue-btn" id="rpRoueTout"${occupe}>
                        ${ico('hasard', 20)}<span>${e.sorties.length ? 'Le reste au hasard' : 'Tout au hasard'}</span>
                    </button>` : ''}
                </div>`;
        } else if (fini) {
            actions = `<p class="rp-roue-actions rp-ordre-fixe">${ico('coche', 20)}<span>Ordre fixé</span></p>`;
        }

        const createur = createurDe(pool.data);
        const note = fini
            ? 'L’ordre du premier tour est prêt. Les tours suivants suivent le serpentin.'
            : e.sorties.length === 0
                ? (jeSuisCreateur
                    ? 'Facultatif. Sans tirage, l’ordre sera tiré au hasard au lancement.'
                    : `L’ordre sera tiré au hasard au démarrage, ou à la roue par ${echapper(createur || 'l’admin du pool')}.`)
                : 'Les choix pas encore tirés le seront au hasard au lancement.';
        const meta = montrerRangs ? `${e.sorties.length} sur ${inscrites} tirés` : '';

        return `
            <section class="rp-card rp-ordre" aria-labelledby="rpRoueTitre">
                ${teteCarte('de', 'Ordre du 1<sup>er</sup> tour', meta, 'rpRoueTitre')}
                <p class="rp-card-sub">${note}</p>
                ${montrerRoue ? `
                <div class="rp-roue-zone">
                    ${roueSvg(pool, e.segments)}
                    <span class="rp-roue-moyeu" aria-hidden="true">${ico('crosse', 22)}</span>
                    <span class="rp-roue-pointe" aria-hidden="true"></span>
                </div>` : ''}
                ${montrerRangs ? `<ol class="rp-order rp-order-roue">${rangs}</ol>` : ''}
                ${actions}
            </section>`;
    }

    /** Fait tourner la roue dessinée jusqu'à l'équipe sortie, puis redessine. */
    function jouerRoue() {
        const anim = roue.animation;
        const svg = document.getElementById('rpRoue');
        if (!anim || !svg) {
            if (anim) roue.montrees = anim.apres;
            roue.animation = null;
            return;
        }

        const pas = 360 / anim.segments.length;
        const indice = anim.segments.indexOf(anim.cible);
        // La pointe est en haut : l'équipe visée doit y arriver, pas toujours
        // au centre de sa part, après plusieurs tours complets.
        const decalage = (Math.random() - 0.5) * pas * 0.6;
        const angle = 360 * 5 - ((indice + 0.5) * pas + decalage);

        let fini = false;
        const terminer = () => {
            if (fini) return;
            fini = true;
            annoncerRoue(anim.numero, anim.cible);
            // Le rang qui attendait se remplit sous la roue arrêtée.
            const rang = document.querySelector('.rp-order-roue .is-tourne');
            if (rang) {
                rang.classList.remove('is-libre');
                const nom = rang.querySelector('.rp-order-nom');
                if (nom) nom.textContent = anim.cible;
                const pastille = rang.querySelector('.rp-rang-ini');
                if (pastille) {
                    pastille.style.setProperty('--c', anim.teinte);
                    pastille.textContent = anim.ini;
                }
            }
            setTimeout(() => {
                roue.montrees = anim.apres;
                roue.animation = null;
                rendre();
                if (roue.focusApres) {
                    roue.focusApres = false;
                    (document.getElementById('rpRoueTourner') || document.getElementById('rpStart'))?.focus({ preventScroll: true });
                }
            }, 900);
        };
        svg.addEventListener('transitionend', terminer, { once: true });
        setTimeout(terminer, ROUE_MS + 400); // onglet en arrière-plan : pas de transitionend

        // Deux images : le navigateur doit d'abord peindre la roue au repos.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            svg.style.transition = `transform ${ROUE_MS}ms cubic-bezier(.13,.62,.08,1)`;
            svg.style.transform = `rotate(${angle}deg)`;
        }));
    }

    async function tournerLaRoue(nomPool, tout) {
        const boutons = ['rpRoueTourner', 'rpRoueTout'].map(id => document.getElementById(id)).filter(Boolean);
        boutons.forEach(b => { b.disabled = true; });
        roue.focusApres = !tout;
        try {
            const reponse = await fetch(urlPool(nomPool, '/draft-wheel'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tout: !!tout })
            });
            const corps = await reponse.json().catch(() => ({}));
            if (!reponse.ok) throw new Error(corps.message || 'La roue n’a pas pu tourner.');
        } catch (erreur) {
            roue.focusApres = false;
            boutons.forEach(b => { b.disabled = false; });
            fzAlert({ type: 'error', title: 'Tirage impossible', message: erreur.message || 'Erreur de connexion au serveur.' });
        }
        // L'état relu déclenche l'animation — ici comme chez les autres.
        await FZPool.refresh();
        rendre();
    }

    function blocOrdre(pool, jeSuisCreateur) {
        const ordre = ordreAnnonce(pool.data);
        if (!ordre) return blocRoue(pool, jeSuisCreateur);
        return `
            <section class="rp-card rp-ordre" aria-labelledby="rpOrdreTitre">
                ${teteCarte('liste', 'Ordre du 1<sup>er</sup> tour', 'Classement inversé', 'rpOrdreTitre')}
                <p class="rp-card-sub">Le dernier de la saison passée choisit en premier. Les nouvelles équipes passent après, tirées au sort.</p>
                <ol class="rp-order">
                    ${ordre.map((e, k) => rangee(pool, k, e.nom, e.rang
                        ? `${e.rang}<sup>${e.rang === 1 ? 'er' : 'e'}</sup> la saison passée`
                        : 'Nouvelle équipe')).join('')}
                </ol>
            </section>`;
    }

    /** L'ordre de départ en une ligne, pour la fenêtre « Lancer maintenant ? ». */
    function resumeOrdre(poolData) {
        if (ordreAnnonce(poolData)) return 'Classement inversé de la saison passée';
        const { sorties, restantes } = tirageDe(poolData);
        if (!sorties.length) return 'Au hasard';
        // Une seule équipe pas encore tirée : sa place est déjà la dernière.
        if (restantes.length <= 1) return [...sorties, ...restantes].join(' → ');
        return `${sorties.join(' → ')}, puis au hasard`;
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

    /** La recherche d'invités. Le pool plein, elle s'efface : « complet » le dit déjà. */
    function blocInviter(pool) {
        const r = etatRecherche(pool.name);
        return `
            <section class="rp-card rp-invite" aria-labelledby="rpInviteTitre">
                ${teteCarte('inviter', 'Inviter des joueurs', '', 'rpInviteTitre')}
                <p class="rp-card-sub" id="rpInviteSub">La personne reçoit une notification et entre d’un clic,
                    sans le mot de passe du pool.</p>
                <div class="rp-invite-corps">
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
                       ${r.message ? '' : 'hidden'}>${r.erreur ? '' : ICONE_OK}<span>${echapper(r.message)}</span></p>
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

    // ==================== LE HÉROS ====================

    /** Une tuile du héros : « Mode », « Début ». `valeur`, `sous`, `actions` : HTML de confiance. */
    function tuile({ icone: nom, label, valeur, sous = '', actions = '', classe = '' }) {
        return `
                    <div class="rp-tuile${classe ? ` ${classe}` : ''}">
                        <span class="rp-tuile-label">${ico(nom, 16)}${label}</span>
                        <strong class="rp-tuile-valeur">${valeur}</strong>
                        ${sous ? `<span class="rp-tuile-sous">${sous}</span>` : ''}
                        ${actions ? `<span class="rp-tuile-actions">${actions}</span>` : ''}
                    </div>`;
    }

    // Repêchage automatique (`draftAuto`, choisi à la création) : au départ,
    // le serveur joue tous les tours d'un coup (routes/pools.js,
    // repecherDOffice). Un repêchage daté, lui, part chronométré
    // (poolOps.demarrerRepechage) ; sans date, chacun choisit à son tour.
    function tuileMode(pool, etat) {
        if (pool.data.draftAuto === true) {
            return tuile({ icone: 'eclair', classe: 'is-auto', label: 'Mode', valeur: 'Automatique',
                sous: 'Meilleur joueur projeté, à chaque tour' });
        }
        if (etat.prevuLe) {
            return tuile({ icone: 'horloge', label: 'Mode', valeur: 'Chronométré',
                sous: '3 min par choix, sinon Fantazy prend le meilleur disponible' });
        }
        return tuile({ icone: 'equipe', label: 'Mode', valeur: 'En direct', sous: 'Chacun choisit à son tour' });
    }

    // ==================== DATE DU REPÊCHAGE ====================
    //
    // Deux façons de repêcher, choisies à la création du pool : quand la
    // personne qui l'a créé le décide, ou à une date fixée d'avance — le
    // serveur lance alors le repêchage lui-même à l'heure dite
    // (routes/pools.js, demarrerRepechagesPrevus). Jusqu'au départ, elle peut
    // fixer, déplacer ou retirer la date d'ici.

    function libelleDepart(etat) {
        return etat.prevuLe ? 'Lancer maintenant' : 'Lancer le repêchage';
    }

    function tuileDebut(etat, jeSuisCreateur, createur) {
        if (etat.prevuLe) {
            // « sam. 25 oct., 20 h » : le jour en valeur, l'heure en dessous.
            const court = FZPool.draftDate(etat.prevuLe, { court: true });
            const coupe = court.lastIndexOf(', ');
            const jour = coupe > 0 ? court.slice(0, coupe) : court;
            const heure = coupe > 0 ? court.slice(coupe + 2) : '';
            const delai = FZPool.timeUntil(etat.prevuLe);
            return tuile({
                icone: 'horloge', label: 'Début', valeur: echapper(jour),
                sous: `${heure ? `${echapper(heure)} · ` : ''}<span id="rpDateDelai" data-date="${echapper(etat.prevuLe)}">${echapper(delai || 'Départ imminent…')}</span>`,
                actions: jeSuisCreateur ? `
                            <button type="button" class="rp-tuile-lien" id="rpDateChoisir" aria-label="Modifier la date du repêchage">Modifier</button>
                            <button type="button" class="rp-tuile-lien is-doux" id="rpDateRetirer" aria-label="Retirer la date du repêchage">Retirer</button>` : ''
            });
        }
        if (jeSuisCreateur && etat.manqueLe) {
            return tuile({
                icone: 'alerte', classe: 'is-manque', label: 'Début', valeur: 'Date manquée',
                sous: `Il manquait des équipes le ${echapper(FZPool.draftDate(etat.manqueLe, { court: true }))}.`,
                actions: `<button type="button" class="rp-tuile-lien" id="rpDateChoisir">Nouvelle date${ico('chevron', 15)}</button>`
            });
        }
        if (jeSuisCreateur) {
            return tuile({
                icone: 'horloge', label: 'Début', valeur: 'Quand tu veux',
                actions: `<button type="button" class="rp-tuile-lien" id="rpDateChoisir">Fixer une date${ico('chevron', 15)}</button>`
            });
        }
        return tuile({ icone: 'horloge', label: 'Début', valeur: 'Au lancement',
            sous: `Par ${echapper(createur || 'l’admin du pool')}` });
    }

    /** Mode et début côte à côte ; sous eux, l'agenda et ce qu'il faudra à l'heure dite. */
    function blocTuiles(pool, etat, jeSuisCreateur, createur) {
        // Une seule équipe, ou un nombre impair en tête-à-tête : à l'heure
        // dite, rien ne partira. Mieux vaut le savoir d'avance.
        const condition = !etat.prevuLe ? ''
            : etat.raison === 'deux'
                ? 'Il faudra au moins 2 équipes à cette heure-là, sinon rien ne démarrera.'
                : etat.raison === 'pair'
                    ? 'Il faudra un nombre pair d’équipes à cette heure-là, sinon rien ne démarrera.'
                    : '';
        return `
                <div class="rp-hero-infos">
                    <div class="rp-tuiles">${tuileMode(pool, etat)}${tuileDebut(etat, jeSuisCreateur, createur)}</div>
                    ${etat.prevuLe ? `
                    <button type="button" class="rp-hero-btn" id="rpDateCalendrier">${ico('calendrier', 18)}<span>Ajouter au calendrier</span></button>` : ''}
                    ${condition ? `<p class="rp-hero-note">${ico('alerte', 16)}<span>${condition}</span></p>` : ''}
                </div>`;
    }

    // ==================== RÉGLAGES ====================

    function rangeeReglage({ id = '', attributs = '', classe = '', icone: nom, titre, sous, fin }) {
        return `
                <button type="button" class="rp-row${classe ? ` ${classe}` : ''}"${id ? ` id="${id}"` : ''}${attributs}>
                    <span class="rp-row-ico" aria-hidden="true">${ico(nom, 22)}</span>
                    <span class="rp-row-txt"><strong>${titre}</strong><small>${sous}</small></span>
                    ${fin || ico('chevron', 20)}
                </button>`;
    }

    /**
     * Les alertes de l'appareil (pushNotifications.js remplit leur rangée),
     * le lien à copier, le nom de son équipe — et, dans une file
     * instantanée, la sortie.
     */
    function blocReglages(pool, etat, instantane, moi) {
        const plein = etat.inscrits >= etat.max;
        const mienne = equipesEligibles(pool.data).find(([, equipe]) => (equipe.members || []).includes(moi));
        const lien = instantane ? '' : rangeeReglage({
            id: 'rpInviter', icone: 'lien', titre: 'Lien d’invitation',
            sous: `${plein ? 'Pool complet · ' : ''}Pour un ami qui n’a pas encore de compte`,
            fin: '<span class="rp-row-action" data-rp-copie aria-live="polite">Copier</span>'
        });
        const quitter = instantane ? rangeeReglage({
            id: 'rpQuitter', classe: 'is-danger', icone: 'sortie', titre: 'Quitter la file',
            sous: 'Ta place se libère pour quelqu’un d’autre'
        }) : '';
        return `
            <section class="rp-card rp-reglages" aria-label="Réglages">
                <div data-fz-alertes="carte" hidden></div>
                ${lien}
                ${rangeeReglage({
                    attributs: ' data-fz-reglages="equipes"', icone: 'crayon', titre: 'Renommer mon équipe',
                    sous: mienne ? echapper(mienne[0]) : 'Le nom que tout le pool verra'
                })}
                ${quitter}
            </section>`;
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
        const plein = etat.inscrits >= etat.max;

        let lead;
        if (instantane) {
            const restants = Math.max(0, etat.max - etat.inscrits);
            lead = restants > 0
                ? `Le repêchage démarre tout seul dès que vous êtes ${etat.max}. Il manque ${restants} joueur${restants > 1 ? 's' : ''}.`
                : 'Tout le monde est là : le repêchage va démarrer.';
        } else if (etat.raison === 'deux') {
            lead = 'Il faut au moins 2 équipes pour repêcher. Invite quelqu’un à rejoindre le pool.';
        } else if (etat.raison === 'pair') {
            lead = `Tête-à-tête : les duels se jouent à deux, il faut donc un nombre pair d'équipes (${etat.equipes} pour l'instant).`;
        } else if (etat.prevuLe) {
            lead = jeSuisCreateur
                ? `${etat.equipes} équipes sont prêtes. Le repêchage partira tout seul à l'heure prévue — ou lance-le maintenant.`
                : `${etat.equipes} équipes sont prêtes. Le repêchage commencera tout seul à l'heure prévue.`;
        } else if (jeSuisCreateur) {
            lead = plein
                ? `${etat.equipes} équipes sont prêtes et le pool est complet. Lance quand tu veux.`
                : `${etat.equipes} équipes sont prêtes. Lance maintenant ou attends d’autres participants (jusqu’à ${etat.max}).`;
        } else {
            lead = `${etat.equipes} équipes sont prêtes.`;
        }
        // Les autres ne voient pas la fenêtre de départ : le salon leur dit
        // d'avance qu'ils n'auront rien à faire.
        if (!instantane && !jeSuisCreateur && !etat.raison && pool.data.draftAuto === true) {
            lead += ' Fantazy choisira pour toutes les équipes : pas besoin d’être là.';
        }

        const progression = etat.max > 0 ? Math.round((etat.inscrits / etat.max) * 100) : 0;
        const barre = `
                <div class="rp-progress" role="img" aria-label="${etat.inscrits} participants sur ${etat.max}">
                    <div class="rp-progress-fill" style="width:${progression}%"></div>
                </div>`;

        const depart = !instantane && jeSuisCreateur ? `
            <div class="rp-launch">
                <button type="button" class="rp-launch-btn" id="rpStart"${pret ? '' : ' disabled'}>
                    ${ico('eclair', 22)}<span>${libelleDepart(etat)}</span>
                </button>
            </div>` : '';
        const attente = !instantane && !jeSuisCreateur && pret && !etat.prevuLe
            ? `<p class="rp-wait-admin" role="status">${ico('sablier', 18)}<span>En attente du lancement par ${echapper(createur || "l'admin du pool")}.</span></p>`
            : '';

        // La recherche d'invités : pour qui a créé le pool — ou pour tout
        // membre d'un pool sans mot de passe (authz.peutInviter) —, tant qu'il
        // n'est pas une file instantanée (celle-ci se remplit toute seule).
        const inviterParNom = (jeSuisCreateur || !pool.data.hasPassword) && !instantane && !plein;

        // Une mise à jour temps réel redessine toute la carte : si l'on était
        // en train de taper un nom, le champ reprend focus et curseur.
        const actif = document.activeElement;
        const saisie = actif && actif.id === 'rpInviteQ'
            ? { debut: actif.selectionStart, fin: actif.selectionEnd }
            : null;

        const puce = pret ? (instantane ? 'Complet' : 'Prêt à lancer') : 'En attente';
        conteneur().innerHTML = `
            <div class="rp-salon${depart ? ' has-launch' : ''}">
                <section class="rp-hero" aria-labelledby="rpTitre">
                    <div class="rp-hero-copie">
                        <span class="rp-puce ${pret ? 'is-pret' : 'is-attente'}"><i aria-hidden="true"></i>${puce}</span>
                        <h1 class="rp-title" id="rpTitre">${instantane ? 'Repêchage instantané' : 'Repêchage'}</h1>
                        <p class="rp-lead">${lead}</p>
                    </div>
                    ${instantane ? barre : blocTuiles(pool, etat, jeSuisCreateur, createur)}
                    ${rendreInscrits(pool, etat, createur)}
                    ${attente}
                </section>
                ${depart}
                ${inviterParNom ? blocInviter(pool) : ''}
                ${instantane ? '' : blocOrdre(pool, jeSuisCreateur)}
                ${blocReglages(pool, etat, instantane, moi)}
            </div>`;

        document.getElementById('rpQuitter')?.addEventListener('click', quitterLaFile);
        document.getElementById('rpStart')?.addEventListener('click', () => confirmerDepart(pool, etat));
        document.getElementById('rpDateChoisir')?.addEventListener('click', () => choisirDate(pool));
        document.getElementById('rpDateRetirer')?.addEventListener('click', () => retirerDate(pool));
        document.getElementById('rpDateCalendrier')?.addEventListener('click', () => ajouterAuCalendrier(pool));
        document.getElementById('rpInviter')?.addEventListener('click', () => inviter(pool.name));
        document.getElementById('rpRoueTourner')?.addEventListener('click', () => tournerLaRoue(pool.name, false));
        document.getElementById('rpRoueTout')?.addEventListener('click', () => tournerLaRoue(pool.name, true));
        brancherInvitations(pool);
        if (roue.animation) jouerRoue();

        if (saisie) {
            const champ = document.getElementById('rpInviteQ');
            if (champ) {
                champ.focus({ preventScroll: true });
                try { champ.setSelectionRange(saisie.debut, saisie.fin); } catch { /* type sans sélection */ }
            }
        }
    }

    /** Enregistre la date (ISO) ou la retire (null). Renvoie un message d'erreur, ou null. */
    async function enregistrerDate(nomPool, iso) {
        try {
            const reponse = await fetch(urlPool(nomPool, '/draft-schedule'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ draftScheduledAt: iso })
            });
            const donnees = await reponse.json().catch(() => ({}));
            if (!reponse.ok) return donnees.message || 'La date n’a pas pu être enregistrée.';
        } catch (erreur) {
            return 'La date n’a pas pu être enregistrée. Vérifie ta connexion.';
        }
        await FZPool.refresh();
        rendre();
        return null;
    }

    /** Demain, 20 h : l'heure où un pool entre amis se réunit. */
    function dateParDefaut() {
        const demain = new Date();
        demain.setDate(demain.getDate() + 1);
        demain.setHours(20, 0, 0, 0);
        return demain.toISOString();
    }

    async function choisirDate(pool) {
        const actuelle = pool.data.draftScheduledAt || null;
        const valeur = FZPool.toDateInput(actuelle || dateParDefaut());
        const min = FZPool.toDateInput(new Date(Date.now() + 60000).toISOString());
        const erreur = texte => {
            const zone = document.getElementById('rpDateErreur');
            if (zone) zone.textContent = texte;
            return texte;
        };

        await fzModal({
            type: 'info',
            icon: 'calendar',
            title: actuelle ? 'Changer la date du repêchage' : 'Fixer la date du repêchage',
            bodyHTML: `
                <p>Le repêchage démarrera tout seul à cette heure. Les participants sont prévenus.</p>
                <input type="datetime-local" class="fzd-input rp-date-champ" id="rpDateChamp"
                       value="${echapper(valeur)}" min="${echapper(min)}" aria-label="Date et heure du repêchage">
                <div class="fzd-error" id="rpDateErreur" aria-live="polite"></div>`,
            confirmLabel: 'Enregistrer',
            onSubmit: async () => {
                const champ = document.getElementById('rpDateChamp');
                const iso = FZPool.fromDateInput(champ ? champ.value : '');
                if (!iso) return erreur('Choisis une date et une heure.');
                if (Date.parse(iso) < Date.now()) return erreur('Choisis une date et une heure à venir.');
                const refus = await enregistrerDate(pool.name, iso);
                return refus ? erreur(refus) : null;
            }
        });
    }

    /**
     * Le repêchage dans l'agenda du téléphone, qui sonnera même site fermé
     * (routes/pools.js, /calendar). Deux boutons, parce que l'iPhone ouvre
     * le fichier .ics et que Google Agenda, sur Android, ne l'ouvre pas ; le
     * bon est en premier. Le lien à partager, lui, choisit tout seul selon le
     * téléphone qui l'ouvre : c'est celui qu'on colle dans le groupe.
     */
    async function ajouterAuCalendrier(pool) {
        const lien = new URL(urlPool(pool.name, '/calendar'), window.location.href).href;
        const android = /android/i.test(navigator.userAgent || '');
        const apple = `<a class="rp-btn ${android ? 'secondary' : 'primary'}" href="${echapper(lien)}?app=ics">iPhone, Mac ou Outlook</a>`;
        const google = `<a class="rp-btn ${android ? 'primary' : 'secondary'}" href="${echapper(lien)}?app=google" target="_blank" rel="noopener">Google Agenda</a>`;
        await fzModal({
            type: 'info',
            icon: 'calendar',
            title: 'Ajouter au calendrier',
            bodyHTML: `
                <p>Ton téléphone te rappellera le repêchage 1 heure, puis 10 minutes avant.</p>
                <div class="rp-cal-choix">${android ? google + apple : apple + google}</div>
                <p class="rp-note">Google Agenda utilise tes rappels habituels. Pour prévenir le groupe, envoie ce lien :</p>`,
            copyValue: lien,
            copyLabel: 'Lien du calendrier',
            confirmLabel: 'Fermer',
            cancelLabel: null
        });
    }

    async function retirerDate(pool) {
        const ok = await fzConfirm({
            title: 'Retirer la date ?',
            message: 'Le repêchage ne démarrera plus tout seul : tu le lanceras quand tu voudras.',
            confirmLabel: 'Retirer la date'
        });
        if (!ok) return;
        const refus = await enregistrerDate(pool.name, null);
        if (refus) fzAlert({ type: 'error', title: 'Date inchangée', message: refus });
    }

    // Le compte à rebours avance sans redessiner la carte : un champ de
    // recherche en cours de saisie n'en perd pas le focus. Le départ, lui,
    // arrive par le temps réel — le serveur fait foi, pas cette horloge.
    setInterval(() => {
        const delai = document.getElementById('rpDateDelai');
        if (delai && window.FZPool) delai.textContent = FZPool.timeUntil(delai.dataset.date) || 'Départ imminent…';
    }, 30000);

    /** Le lien « Rejoindre » filtré sur ce pool, dans le presse-papiers. */
    async function inviter(nomPool) {
        const libelle = document.querySelector('#rpInviter [data-rp-copie]');
        const lien = `${window.location.origin}/rejoindre-pool.html?q=${encodeURIComponent(nomPool)}`;
        try {
            await navigator.clipboard.writeText(lien);
            if (libelle) libelle.textContent = 'Copié !';
        } catch (e) {
            // Presse-papiers refusé (page non sécurisée, permission) : le
            // lien s'affiche, sélectionné, avec son propre bouton Copier.
            fzCopy({
                title: 'Lien d’invitation',
                message: 'Envoie ce lien à tes amis : il les mène directement à ton pool.',
                value: lien
            });
        }
        if (libelle) setTimeout(() => { libelle.textContent = 'Copier'; }, 2500);
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
            fzAlert({ type: 'warning', title: 'Action indisponible', message: 'Recharge la page, puis réessaie.' });
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

    function rendreTermine() {
        conteneur().innerHTML = `
            <div class="rp-salon">
                <section class="rp-hero" aria-labelledby="rpTitre">
                    <div class="rp-hero-copie">
                        <span class="rp-puce is-termine"><i aria-hidden="true"></i>Terminé</span>
                        <h1 class="rp-title" id="rpTitre">Repêchage</h1>
                        <p class="rp-lead">Le repêchage de ce pool est terminé. Place à la saison.</p>
                    </div>
                    <div class="rp-hero-actions">
                        <a class="rp-hero-cta is-plein" href="classement.html">Voir le classement</a>
                        <a class="rp-hero-cta" href="draftFini.html">Revoir les sélections</a>
                    </div>
                </section>
            </div>`;
    }

    function rendreOuverture(pool) {
        conteneur().innerHTML = `
            <div class="rp-loading">
                <div class="rp-spinner" aria-hidden="true"></div>
                <p>Ouverture du repêchage de <strong>${echapper(pool.name)}</strong>…</p>
            </div>`;
    }

    /**
     * Le départ se confirme : il ne s'annule pas. La fenêtre redit ce qui va
     * se passer et dans quel ordre on part ; le serveur, lui, tranche au clic.
     */
    async function confirmerDepart(pool, etat) {
        const texte = pool.data.draftAuto === true
            ? 'Fantazy choisit pour toutes les équipes, du premier au dernier tour. Personne n’a besoin d’être là. Ça ne peut pas être annulé.'
            : etat.prevuLe
                ? 'Le repêchage part tout de suite, sans attendre l’heure prévue : 3 minutes par choix. Ça ne peut pas être annulé.'
                : 'Chaque équipe choisit à son tour, dans la salle de repêchage. Ça ne peut pas être annulé.';
        const ok = await fzModal({
            type: 'question',
            title: 'Lancer maintenant ?',
            bodyHTML: `
                <p>${texte}</p>
                <dl class="rp-recap">
                    <div><dt>Équipes</dt><dd>${etat.equipes}</dd></div>
                    <div><dt>Ordre du 1<sup>er</sup> tour</dt><dd>${echapper(resumeOrdre(pool.data))}</dd></div>
                </dl>`,
            confirmLabel: 'Lancer',
            cancelLabel: 'Annuler'
        });
        if (ok) demarrer(pool.name);
    }

    async function demarrer(nomPool) {
        const bouton = document.getElementById('rpStart');
        const libelle = bouton ? bouton.innerHTML : '';
        if (bouton) { bouton.disabled = true; bouton.innerHTML = `${ico('eclair', 22)}<span>Démarrage…</span>`; }

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
                    if (bouton) { bouton.disabled = false; bouton.innerHTML = libelle; }
                    await FZPool.refresh();
                    rendre();
                    return;
                }
                // Repêchage automatique : tout est déjà joué, on va voir le
                // classement, ses choix par-dessus (classement.js, ?recap=1).
                if (donnees.draftComplet) {
                    window.location.href = `classement.html?pool=${encodeURIComponent(nomPool)}&recap=1`;
                    return;
                }
            }

            localStorage.setItem('draftClan', nomPool);
            window.location.href = 'draftActif.html';
        } catch (erreur) {
            console.error('Démarrage du repêchage impossible :', erreur);
            if (bouton) { bouton.disabled = false; bouton.innerHTML = libelle; }
            fzAlert({ type: 'error', title: 'Démarrage impossible', message: 'Le repêchage n’a pas pu être préparé. Vérifie ta connexion et réessaie.' });
        }
    }

    function rendre() {
        if (!conteneur()) return;
        // La roue tourne : le redessin attend qu'elle s'arrête (jouerRoue).
        if (roue.animation && document.getElementById('rpRoue')) return;

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

        if (etat.etat === 'termine') { rendreTermine(); return; }
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
