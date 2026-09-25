/* ============================================================
   REPÊCHAGE INSTANTANÉ — le bouton
   ------------------------------------------------------------
   Un clic, et c'est tout. Pas de nom à trouver, pas de pool à choisir
   dans une liste, pas de code à saisir : le serveur cherche un pool qui
   attend des joueurs, en ouvre un s'il n'y en a pas, et répond où aller.

   Ce fichier ne décide de rien — la file vit côté serveur
   (/join-instant-draft, lib/instantDraft.js), seul endroit qui puisse
   voir les autres joueurs. Ici on se contente de cliquer, d'attendre, et
   d'emmener l'utilisateur au bon endroit.

   Sous le bouton, un panneau montre qui attend déjà : les noms des
   inscrits et les places encore libres. Une file d'attente sans visage ne
   dit pas si elle avance ; celle-ci se remplit sous les yeux, au rythme
   des évènements du socket (FZPool.onData).

   Et quand on est dedans, le bouton ne sert plus à entrer : il se
   verrouille, et le panneau propose les deux seules choses qui restent à
   faire — ouvrir le salon, ou quitter la file. Une fois le repêchage parti,
   le panneau disparaît : il n'y a plus de file à montrer, et le bouton
   verrouillé dit déjà où en est le repêchage.

   Le bouton se branche tout seul sur n'importe quel élément portant
   `data-instant-draft`, pour que les trois pages qui l'affichent
   (Accueil, Mes pools, Rejoindre) n'aient qu'à poser le balisage.

   L'accueil sans pool montre plutôt une carte (`data-instant-card`) :
   les sièges de la file en ronds, et un bouton unique qui change de
   rôle selon l'état. Voir rendreCarte().
   ============================================================ */
(function () {
    const BASE_URL = window.location.hostname.includes('localhost')
        ? 'http://localhost:3000'
        : window.location.origin;

    /**
     * Un seul appel à la fois pour tout l'onglet.
     *
     * Le double-clic est le geste naturel sur un bouton qui ne répond pas
     * dans la seconde, et deux pages peuvent afficher le bouton en même
     * temps. Le serveur sait déjà refuser une deuxième inscription, mais
     * autant ne pas la lui envoyer.
     */
    let enCours = false;

    const echapper = texte => String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const utilisateur = () => localStorage.getItem('username') || '';
    const connecte = () => localStorage.getItem('isLoggedIn') === 'true' && !!utilisateur();

    /* --------------------------------------------------------------
       Reconnaître un pool instantané, côté navigateur.

       Miroir volontaire de lib/instantDraft.js : le module serveur utilise
       module.exports et require(), il ne peut pas être chargé tel quel par
       une page. Les listes de pools s'en servent pour NE PAS afficher ces
       pools-là — on n'entre pas dans une file d'attente en la choisissant
       dans une liste, et un ajout par la porte normale (/join-team) ne
       déclencherait pas le départ automatique promis par le bouton.
       -------------------------------------------------------------- */
    const PREFIXE_INSTANTANE = 'Pool rapide #';
    const PREFIXES_HISTORIQUES = ['Repêchage instantané #'];
    const JOUEURS_PAR_POOL = 4;

    function estPoolInstantane(nom, pool) {
        if (pool && pool.instant === true) return true;
        return typeof nom === 'string' &&
            [PREFIXE_INSTANTANE, ...PREFIXES_HISTORIQUES].some(prefixe => nom.startsWith(prefixe));
    }

    /** Les inscrits du pool, dans l'ordre des équipes. */
    const membres = pool => Object.values((pool && pool.teams) || {})
        .flatMap(equipe => (((equipe && equipe.members) || []).slice()));

    /**
     * Combien attendent dans ce pool.
     *
     * Pour un pool dont on n'est pas membre, /draft ne livre qu'un résumé
     * public : le nombre d'inscrits, jamais leurs noms (lib/authz.js,
     * resumePublic). Compter les noms donnait donc toujours zéro, et la
     * file des autres paraissait vide.
     */
    const inscrits = pool => membres(pool).length || Number(pool && pool.participantCount) || 0;

    const repechageCommence = pool => !!(pool && (pool.draftStarted === true ||
        (Array.isArray(pool.draftOrder) && pool.draftOrder.length > 0)));

    const placesDuPool = pool => (pool && pool.maxPlayers) || JOUEURS_PAR_POOL;

    /**
     * Ce repêchage est-il allé au bout ?
     *
     * Un repêchage terminé ne retient plus personne — le serveur accepte de
     * replacer son monde dans une nouvelle file (poolEnRepechage écarte les
     * pools complets). Sans cette question, le bouton resterait verrouillé
     * pour toujours sur « Repêchage en cours » après la dernière sélection.
     *
     * La règle vit dans FZPool.draftState, qui la partage avec tout le site.
     * Sans lui il n'y a de toute façon aucun pool à lire — la garde n'est là
     * que pour ne pas planter sur une page qui l'aurait oublié.
     */
    const repechageTermine = pool => {
        if (!window.FZPool || typeof window.FZPool.draftState !== 'function') return false;
        return window.FZPool.draftState(pool).etat === 'termine';
    };

    /** Tous les pools connus, ou un objet vide si FZPool n'est pas là. */
    const tousLesPools = () =>
        (window.FZPool && typeof window.FZPool.all === 'function' && window.FZPool.all()) || {};

    /**
     * L'état de la file, tel que cet utilisateur doit le voir.
     *
     * Deux questions, une seule lecture : « suis-je dedans ? » et, sinon,
     * « qui attend en ce moment ? ». Le pool montré à qui n'est pas inscrit
     * est celui que le serveur lui donnerait — le plus rempli, à égalité le
     * plus ancien (poolEnAttente dans lib/instantDraft.js) — pour que les
     * noms affichés soient bien ceux qu'il va rejoindre.
     */
    function lireEtat() {
        const moi = utilisateur();
        const pools = Object.entries(tousLesPools())
            .filter(([nom, pool]) => estPoolInstantane(nom, pool));

        const mien = pools.find(([, pool]) => membres(pool).includes(moi) && !repechageTermine(pool));
        if (mien) {
            const [nom, pool] = mien;
            return {
                situation: repechageCommence(pool) ? 'encours' : 'inscrit',
                nom,
                joueurs: membres(pool),
                nombre: membres(pool).length,
                places: placesDuPool(pool)
            };
        }

        const attente = pools
            .filter(([, pool]) => !repechageCommence(pool) &&
                                  inscrits(pool) > 0 &&
                                  inscrits(pool) < placesDuPool(pool))
            .sort(([nomA, a], [nomB, b]) => {
                const parRemplissage = inscrits(b) - inscrits(a);
                if (parRemplissage !== 0) return parRemplissage;
                const dateA = Date.parse(a.createdAt || '') || 0;
                const dateB = Date.parse(b.createdAt || '') || 0;
                if (dateA !== dateB) return dateA - dateB;
                return nomA.localeCompare(nomB, 'fr');
            })[0];

        if (!attente) return { situation: 'vide', nom: null, joueurs: [], nombre: 0, places: JOUEURS_PAR_POOL };

        // `joueurs` est vide ici : les noms d'un pool dont on n'est pas
        // membre ne sont pas publics. `nombre` dit combien attendent.
        const [nom, pool] = attente;
        return { situation: 'libre', nom, joueurs: membres(pool), nombre: inscrits(pool), places: placesDuPool(pool) };
    }

    /* ==============================================================
       LE PANNEAU
       ============================================================== */

    /** Les textes d'origine du bouton, avant qu'on écrive dedans. */
    const libellesOrigine = new WeakMap();
    const descriptionsOrigine = new WeakMap();

    function libelleDe(bouton) {
        return bouton.querySelector('[data-instant-label]') || bouton;
    }

    function texteOrigine(bouton) {
        if (!libellesOrigine.has(bouton)) {
            libellesOrigine.set(bouton, libelleDe(bouton).textContent);
        }
        return libellesOrigine.get(bouton);
    }

    /**
     * La ligne d'explication sous le titre, quand la page en pose une.
     *
     * Elle promet une file à rejoindre (« on te place avec 3 joueurs ») : la
     * laisser telle quelle sous un bouton verrouillé ferait dire deux choses
     * contraires à la même carte.
     */
    function descriptionDe(bouton) {
        const el = bouton.querySelector('[data-instant-desc]');
        if (!el) return null;
        if (!descriptionsOrigine.has(bouton)) {
            descriptionsOrigine.set(bouton, el.textContent);
        }
        return el;
    }

    /** Le panneau qui suit ce bouton, s'il en existe un. */
    function panneauExistant(bouton) {
        const suivant = bouton.nextElementSibling;
        return suivant && suivant.hasAttribute('data-instant-panel') ? suivant : null;
    }

    /** Le panneau qui suit ce bouton, créé au premier rendu. */
    function panneauDe(bouton) {
        const existant = panneauExistant(bouton);
        if (existant) return existant;

        const panneau = document.createElement('div');
        panneau.className = 'fzid';
        panneau.setAttribute('data-instant-panel', '');
        bouton.insertAdjacentElement('afterend', panneau);
        return panneau;
    }

    const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

    /** La phrase qui résume l'état de la file. */
    function resume(etat) {
        const manque = Math.max(0, etat.places - etat.nombre);

        if (etat.situation === 'inscrit') {
            return manque === 0
                ? 'Le pool est complet, le repêchage part.'
                : `Tu es dans la file. Il manque ${pluriel(manque, 'joueur')}.`;
        }

        if (etat.situation === 'libre') {
            const attendent = etat.nombre > 1 ? 'attendent' : 'attend';
            return `${pluriel(etat.nombre, 'joueur')} ${attendent} déjà. ` +
                   `${pluriel(manque, 'place')} libre${manque > 1 ? 's' : ''}.`;
        }

        return 'Personne n\'attend en ce moment : ton clic ouvre la file.';
    }

    /** Les inscrits, puis les places encore libres. */
    function listeJoueurs(etat) {
        const moi = utilisateur();

        const pris = etat.joueurs.map(nom => `
            <li class="fzid-slot is-taken${nom === moi ? ' is-me' : ''}">
                <span class="fzid-ini" aria-hidden="true">${echapper(nom.charAt(0).toUpperCase())}</span>
                <span class="fzid-nom">${echapper(nom)}</span>
                ${nom === moi ? '<span class="fzid-toi">toi</span>' : ''}
            </li>`);

        const libres = Math.max(0, etat.places - etat.joueurs.length);
        const vides = Array.from({ length: libres }, () => `
            <li class="fzid-slot is-free">
                <span class="fzid-ini" aria-hidden="true">+</span>
                <span class="fzid-nom">En attente…</span>
            </li>`);

        return `<ul class="fzid-list">${pris.concat(vides).join('')}</ul>`;
    }

    /**
     * Les actions offertes à un inscrit.
     *
     * Une fois le repêchage parti il n'y a plus de panneau du tout : quitter
     * n'aurait de toute façon pas de sens — le serveur le refuse, l'ordre de
     * sélection nomme les équipes et en retirer une casse le repêchage des
     * trois autres.
     */
    function actions(etat) {
        if (etat.situation !== 'inscrit') return '';

        return `<div class="fzid-actions">
                    <a class="fzid-btn is-primary" href="repechage.html">Ouvrir le salon</a>
                    <button type="button" class="fzid-btn is-ghost" data-instant-leave>Quitter la file</button>
                </div>`;
    }

    /** Un bouton remis dans l'état que décrit `etat`, panneau compris. */
    function rendreBouton(bouton, etat) {
        const libelle = libelleDe(bouton);
        const origine = texteOrigine(bouton);
        const dedans = etat.situation === 'inscrit' || etat.situation === 'encours';

        // Verrouillé, pas caché : le bouton reste là où l'œil l'a laissé, et
        // dit pourquoi il ne répond plus. Le `disabled` natif suffit à bloquer
        // le clic, souris et clavier compris.
        bouton.disabled = dedans;
        bouton.classList.toggle('is-joined', dedans);
        libelle.textContent = dedans
            ? (etat.situation === 'encours' ? 'Repêchage en cours' : 'Tu es déjà dans la file')
            : origine;

        const description = descriptionDe(bouton);
        if (description) {
            description.textContent = dedans
                ? (etat.situation === 'encours'
                    ? 'Ta salle de repêchage est ouverte.'
                    : 'Ta place est gardée. Tu peux quitter la file ci-dessous.')
                : descriptionsOrigine.get(bouton);
        }

        // Le repêchage est parti : il n'y a plus de file à montrer. Le panneau
        // s'en va au lieu de rester sous le bouton avec une phrase qui répète
        // ce que le bouton verrouillé dit déjà.
        if (etat.situation === 'encours') {
            panneauExistant(bouton)?.remove();
            return;
        }

        const panneau = panneauDe(bouton);
        panneau.classList.toggle('is-joined', dedans);
        panneau.innerHTML = `
            <p class="fzid-resume">${echapper(resume(etat))}</p>
            ${etat.joueurs.length ? listeJoueurs(etat) : ''}
            ${actions(etat)}`;
    }

    /* ==============================================================
       LA CARTE (accueil)

       Quatre sièges qui se remplissent sous les yeux, une ligne qui
       compte, et un seul bouton dont le rôle suit l'état : entrer, sortir,
       ou aller au repêchage. Le balisage vit dans la page
       (`data-instant-card`) ; ici on ne fait que le tenir à jour.
       ============================================================== */

    /** Couleurs des sièges des autres joueurs ; le sien prend l'accent. */
    const COULEURS_SIEGE = ['#2f7d5b', '#5b4a9e', '#c07a1f', '#2b6c9e', '#8a4b6e', '#3d7a80'];

    /** Toujours la même couleur pour le même joueur, d'un rendu à l'autre. */
    function couleurSiege(nom) {
        let h = 0;
        for (const c of String(nom)) h = (h * 31 + c.codePointAt(0)) >>> 0;
        return COULEURS_SIEGE[h % COULEURS_SIEGE.length];
    }

    /** « MaxTremblay » → MT, « jerome_qa » → JQ, « Andy124577 » → AN. */
    function initiales(nom) {
        const mots = String(nom).replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_.-]+/).filter(Boolean);
        return (mots.length > 1 ? mots[0][0] + mots[1][0] : String(nom).slice(0, 2)).toUpperCase();
    }

    /** Siège d'un joueur dont le nom n'est pas public : une silhouette. */
    const SILHOUETTE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="9" r="3.4"/>' +
        '<path d="M5.5 19.5c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5"/></svg>';

    function rendreCarte(carte, etat) {
        const moi = utilisateur();
        const occupes = Math.min(etat.nombre, etat.places);
        const manque = etat.places - occupes;
        const complet = etat.situation === 'encours' || (etat.situation === 'inscrit' && manque === 0);

        // Siège par siège : réécrire toute la rangée à chaque évènement du
        // socket relancerait l'animation des places encore libres.
        const sieges = carte.querySelector('[data-instant-seats]');
        if (sieges) {
            while (sieges.children.length > etat.places) sieges.lastElementChild.remove();
            while (sieges.children.length < etat.places) sieges.appendChild(document.createElement('li'));
            Array.from(sieges.children).forEach((li, i) => {
                const pris = i < occupes;
                const nom = pris ? (etat.joueurs[i] || '') : '';
                const estMoi = !!nom && nom === moi;
                const signature = !pris ? '' : nom ? `${estMoi ? 'moi' : 'nom'}:${nom}` : `anonyme:${i}`;
                if (li.dataset.siege === signature) return;
                li.dataset.siege = signature;

                if (!pris) {
                    li.className = 'fzo-seat is-free';
                    li.removeAttribute('title');
                    li.style.removeProperty('--fzo-seat');
                    li.innerHTML = '<span class="fzo-seat-ring" aria-hidden="true"></span><span class="fzo-sr">Place libre</span>';
                    return;
                }
                li.className = `fzo-seat is-taken${estMoi ? ' is-me' : ''}`;
                if (estMoi) li.style.removeProperty('--fzo-seat');
                else li.style.setProperty('--fzo-seat', nom ? couleurSiege(nom) : COULEURS_SIEGE[i % COULEURS_SIEGE.length]);
                if (nom) li.title = nom; else li.removeAttribute('title');
                li.innerHTML = !nom
                    ? `${SILHOUETTE}<span class="fzo-sr">Joueur en attente</span>`
                    : `<span aria-hidden="true">${estMoi ? 'TOI' : echapper(initiales(nom))}</span>` +
                      `<span class="fzo-sr">${estMoi ? 'Toi' : echapper(nom)}</span>`;
            });
        }

        // Réécrite seulement si elle change : c'est une région `status`,
        // chaque écriture serait relue par un lecteur d'écran.
        const statut = carte.querySelector('[data-instant-status]');
        const texte = complet
            ? 'Complet — le repêchage commence !'
            : `${occupes} / ${etat.places} joueurs · encore ${pluriel(manque, 'place')}`;
        if (statut && statut.textContent !== texte) statut.textContent = texte;

        // Pendant un appel, c'est occuper() qui tient le bouton.
        const bouton = carte.querySelector('[data-instant-action]');
        if (bouton && !bouton.classList.contains('is-loading')) {
            const [action, libelle] = complet
                ? ['aller', 'Aller au repêchage →']
                : etat.situation === 'inscrit'
                    ? ['quitter', 'Quitter']
                    : ['rejoindre', 'Repêcher maintenant'];
            bouton.dataset.instantAction = action;
            if (etat.nom && action === 'aller') bouton.dataset.pool = etat.nom;
            else delete bouton.dataset.pool;
            if (bouton.textContent !== libelle) bouton.textContent = libelle;
        }
    }

    /**
     * Le repêchage est parti : ouvrir le salon de CE pool. repechage.html
     * bascule seul vers la salle de sélection ; encore faut-il qu'il lise le
     * bon pool, d'où les deux clés écrites avant de partir.
     */
    function allerAuRepechage(nomPool) {
        if (nomPool) {
            localStorage.setItem('activePool', nomPool);
            localStorage.setItem('draftClan', nomPool);
        }
        window.location.href = 'repechage.html';
    }

    /** Toutes les cartes et tous les boutons de la page, à chaque changement de données. */
    function rendre() {
        const boutons = document.querySelectorAll('[data-instant-draft]');
        const cartes = document.querySelectorAll('[data-instant-card]');
        if (!boutons.length && !cartes.length) return;

        const etat = lireEtat();
        // La carte montre la file même à qui n'est pas connecté : son bouton
        // l'emmènera à la connexion.
        cartes.forEach(carte => rendreCarte(carte, etat));

        // Déconnecté, il n'y a pas de « toi » à situer dans la file : le
        // bouton garde son libellé et emmène à la page de connexion.
        if (!connecte()) return;
        boutons.forEach(bouton => rendreBouton(bouton, etat));
    }

    /* ==============================================================
       ENTRER, SORTIR
       ============================================================== */

    /** Le bouton pendant l'attente : verrouillé, et il le dit. */
    function occuper(bouton, texte) {
        if (!bouton) return () => {};
        const libelle = libelleDe(bouton);
        texteOrigine(bouton);

        bouton.disabled = true;
        bouton.setAttribute('aria-busy', 'true');
        bouton.classList.add('is-loading');
        libelle.textContent = texte;

        return () => {
            bouton.disabled = false;
            bouton.removeAttribute('aria-busy');
            bouton.classList.remove('is-loading');
            // L'état a pu changer pendant l'appel : c'est le rendu qui décide
            // du libellé, pas le texte qu'on avait mis de côté.
            rendre();
        };
    }

    /**
     * Rejoint — ou ouvre — un repêchage instantané, puis y emmène
     * l'utilisateur.
     *
     * La destination est toujours repechage.html : c'est déjà le salon
     * d'attente du projet. Il montre le compteur de participants en
     * direct et bascule tout seul vers la salle de sélection quand le
     * repêchage démarre, ce qui est exactement ce qu'on veut ici — y
     * compris pour ceux qui attendaient déjà quand le dernier joueur
     * arrive.
     */
    async function rejoindre(bouton) {
        if (enCours) return;

        const username = utilisateur();
        if (!connecte()) {
            window.location.href = 'login.html';
            return;
        }

        enCours = true;
        const liberer = occuper(bouton, 'Recherche d\'un pool…');

        try {
            const reponse = await fetch(`${BASE_URL}/join-instant-draft`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });
            const resultat = await reponse.json().catch(() => ({}));

            if (!reponse.ok) {
                alert(resultat.message || 'Impossible de rejoindre un pool rapide.');
                return;
            }

            // Écrit avant la navigation : repechage.html et draftActif.js
            // lisent ces clés dès leur première ligne, et le pool qu'on
            // vient de rejoindre doit être celui qui s'ouvre.
            localStorage.setItem('activePool', resultat.poolName);
            localStorage.setItem('draftClan', resultat.poolName);

            // replace : le bouton Retour doit ramener d'où l'on vient, pas
            // sur une page qui relancerait la recherche.
            window.location.replace('repechage.html');

        } catch (erreur) {
            console.error('Repêchage instantané impossible :', erreur);
            alert('Erreur de connexion au serveur.');
        } finally {
            enCours = false;
            liberer();
        }
    }

    /**
     * Quitte la file.
     *
     * On y entre en un clic ; il faut pouvoir en sortir de la même façon,
     * sinon le bouton devient un piège — trois joueurs qui ne viennent
     * jamais, et on reste accroché à un pool qu'on n'a pas choisi.
     *
     * Renvoie true si le départ a bien eu lieu, pour que la page qui appelle
     * — le salon d'attente — sache s'il faut s'en aller.
     */
    async function quitter(options) {
        const opts = options || {};
        if (enCours) return false;

        if (!connecte()) {
            window.location.href = 'login.html';
            return false;
        }

        if (opts.confirmer !== false &&
            !window.confirm('Quitter la file du pool rapide ? Ta place sera reprise par le prochain joueur.')) {
            return false;
        }

        enCours = true;
        const liberer = occuper(opts.bouton, 'Sortie de la file…');

        try {
            const reponse = await fetch(`${BASE_URL}/leave-instant-draft`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: utilisateur() })
            });
            const resultat = await reponse.json().catch(() => ({}));

            if (!reponse.ok) {
                alert(resultat.message || 'Impossible de quitter ce repêchage.');
                // Le refus vient presque toujours d'un repêchage parti entre
                // le rendu et le clic : on relit plutôt que d'insister.
                await rafraichirPools();
                return false;
            }

            // Le pool n'est plus le sien : le laisser dans le contexte
            // enverrait draftActif.js sur un repêchage qu'il vient de quitter.
            if (localStorage.getItem('activePool') === resultat.poolName) {
                localStorage.removeItem('activePool');
            }
            if (localStorage.getItem('draftClan') === resultat.poolName) {
                localStorage.removeItem('draftClan');
            }

            await rafraichirPools();
            return true;

        } catch (erreur) {
            console.error('Sortie du repêchage instantané impossible :', erreur);
            alert('Erreur de connexion au serveur.');
            return false;
        } finally {
            enCours = false;
            liberer();
        }
    }

    /** Relit les pools, puis remet les boutons à jour. */
    async function rafraichirPools() {
        if (window.FZPool && typeof window.FZPool.refresh === 'function') {
            try { await window.FZPool.refresh(); } catch { /* le rendu suivant corrigera */ }
        }
        rendre();
    }

    // Délégué au document : le balisage peut arriver après ce script
    // (poolNav.js et navbar.js construisent leurs blocs à l'exécution), et le
    // panneau, lui, est réécrit à chaque rafraîchissement.
    document.addEventListener('click', event => {
        const carte = event.target.closest('[data-instant-action]');
        if (carte) {
            event.preventDefault();
            const action = carte.dataset.instantAction;
            if (action === 'quitter') quitter({ bouton: carte });
            else if (action === 'aller') allerAuRepechage(carte.dataset.pool);
            else rejoindre(carte);
            return;
        }

        const depart = event.target.closest('[data-instant-leave]');
        if (depart) {
            event.preventDefault();
            quitter({ bouton: depart });
            return;
        }

        const bouton = event.target.closest('[data-instant-draft]');
        if (!bouton) return;
        event.preventDefault();
        rejoindre(bouton);
    });

    /**
     * Le panneau suit la file en direct.
     *
     * FZPool recharge /draft à chaque évènement `draftUpdated` du socket —
     * dont ceux qu'émettent /join-instant-draft et /leave-instant-draft. Sans
     * ce branchement, la liste des joueurs resterait figée sur l'état du
     * chargement, et une file qui se remplit ressemblerait à une file morte.
     */
    function brancher() {
        if (!document.querySelector('[data-instant-draft], [data-instant-card]')) return;

        rendre();
        if (window.FZPool && typeof window.FZPool.onData === 'function') {
            window.FZPool.onData(rendre);
            window.FZPool.ready().then(rendre).catch(() => {});
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', brancher);
    } else {
        brancher();
    }

    window.FZInstant = {
        estPoolInstantane,
        PREFIXE_INSTANTANE,
        JOUEURS_PAR_POOL,
        membres,
        etat: lireEtat,
        quitter
    };

    // Exposé pour un appel direct, comme les autres actions de pool
    // (joinClan, createClan) que le balisage appelle en onclick.
    window.rejoindreRepechageInstantane = rejoindre;
})();
