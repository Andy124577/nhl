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
   faire — retourner au salon, ou quitter la file.

   Le bouton se branche tout seul sur n'importe quel élément portant
   `data-instant-draft`, pour que les trois pages qui l'affichent
   (Accueil, Mes pools, Rejoindre) n'aient qu'à poser le balisage.
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
    const PREFIXE_INSTANTANE = 'Repêchage instantané #';
    const JOUEURS_PAR_POOL = 4;

    function estPoolInstantane(nom, pool) {
        if (pool && pool.instant === true) return true;
        return typeof nom === 'string' && nom.startsWith(PREFIXE_INSTANTANE);
    }

    /** Les inscrits du pool, dans l'ordre des équipes. */
    const membres = pool => Object.values((pool && pool.teams) || {})
        .flatMap(equipe => (((equipe && equipe.members) || []).slice()));

    const repechageCommence = pool =>
        !!(pool && Array.isArray(pool.draftOrder) && pool.draftOrder.length > 0);

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
                places: placesDuPool(pool)
            };
        }

        const attente = pools
            .filter(([, pool]) => !repechageCommence(pool) &&
                                  membres(pool).length > 0 &&
                                  membres(pool).length < placesDuPool(pool))
            .sort(([nomA, a], [nomB, b]) => {
                const parRemplissage = membres(b).length - membres(a).length;
                if (parRemplissage !== 0) return parRemplissage;
                const dateA = Date.parse(a.createdAt || '') || 0;
                const dateB = Date.parse(b.createdAt || '') || 0;
                if (dateA !== dateB) return dateA - dateB;
                return nomA.localeCompare(nomB, 'fr');
            })[0];

        if (!attente) return { situation: 'vide', nom: null, joueurs: [], places: JOUEURS_PAR_POOL };

        const [nom, pool] = attente;
        return { situation: 'libre', nom, joueurs: membres(pool), places: placesDuPool(pool) };
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

    /** Le panneau qui suit ce bouton, créé au premier rendu. */
    function panneauDe(bouton) {
        const suivant = bouton.nextElementSibling;
        if (suivant && suivant.hasAttribute('data-instant-panel')) return suivant;

        const panneau = document.createElement('div');
        panneau.className = 'fzid';
        panneau.setAttribute('data-instant-panel', '');
        bouton.insertAdjacentElement('afterend', panneau);
        return panneau;
    }

    const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

    /** La phrase qui résume l'état de la file. */
    function resume(etat) {
        const manque = Math.max(0, etat.places - etat.joueurs.length);

        if (etat.situation === 'encours') return 'Ton repêchage instantané est commencé.';

        if (etat.situation === 'inscrit') {
            return manque === 0
                ? 'Le pool est complet, le repêchage part.'
                : `Tu es dans la file. Il manque ${pluriel(manque, 'joueur')}.`;
        }

        if (etat.situation === 'libre') {
            const attendent = etat.joueurs.length > 1 ? 'attendent' : 'attend';
            return `${pluriel(etat.joueurs.length, 'joueur')} ${attendent} déjà. ` +
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
     * Une fois le repêchage parti, quitter n'est plus proposé : le serveur le
     * refuse — l'ordre de sélection nomme les équipes, en retirer une casse le
     * repêchage des trois autres — et un bouton qui répond toujours non ne
     * vaut pas mieux que pas de bouton.
     */
    function actions(etat) {
        if (etat.situation === 'encours') {
            return `<div class="fzid-actions">
                        <a class="fzid-btn is-primary" href="draftActif.html">Retourner au repêchage</a>
                    </div>`;
        }

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

        const panneau = panneauDe(bouton);
        panneau.classList.toggle('is-joined', dedans);
        panneau.innerHTML = `
            <p class="fzid-resume">${echapper(resume(etat))}</p>
            ${etat.joueurs.length ? listeJoueurs(etat) : ''}
            ${actions(etat)}`;
    }

    /** Tous les boutons de la page, à chaque changement de données. */
    function rendre() {
        const boutons = document.querySelectorAll('[data-instant-draft]');
        if (!boutons.length) return;

        // Déconnecté, il n'y a pas de « toi » à situer dans la file : le
        // bouton garde son libellé et emmène à la page de connexion.
        if (!connecte()) return;

        const etat = lireEtat();
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
                alert(resultat.message || 'Impossible de rejoindre un repêchage instantané.');
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
            !window.confirm('Quitter la file du repêchage instantané ? Ta place sera reprise par le prochain joueur.')) {
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
        if (!document.querySelector('[data-instant-draft]')) return;

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
