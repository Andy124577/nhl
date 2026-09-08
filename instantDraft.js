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

    /** Le bouton pendant l'attente : verrouillé, et il le dit. */
    function occuper(bouton) {
        if (!bouton) return () => {};
        const libelle = bouton.querySelector('[data-instant-label]') || bouton;
        const texteInitial = libelle.textContent;

        bouton.disabled = true;
        bouton.setAttribute('aria-busy', 'true');
        bouton.classList.add('is-loading');
        libelle.textContent = 'Recherche d\'un pool…';

        return () => {
            bouton.disabled = false;
            bouton.removeAttribute('aria-busy');
            bouton.classList.remove('is-loading');
            libelle.textContent = texteInitial;
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

        const username = localStorage.getItem('username');
        if (localStorage.getItem('isLoggedIn') !== 'true' || !username) {
            window.location.href = 'login.html';
            return;
        }

        enCours = true;
        const liberer = occuper(bouton);

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

    // Délégué au document : le balisage peut arriver après ce script
    // (poolNav.js et navbar.js construisent leurs blocs à l'exécution).
    document.addEventListener('click', event => {
        const bouton = event.target.closest('[data-instant-draft]');
        if (!bouton) return;
        event.preventDefault();
        rejoindre(bouton);
    });

    /* --------------------------------------------------------------
       Reconnaître un pool instantané, côté navigateur.

       Miroir volontaire de estPoolInstantane() dans lib/instantDraft.js :
       le module serveur utilise module.exports et require(), il ne peut
       pas être chargé tel quel par une page. Les listes de pools s'en
       servent pour NE PAS afficher ces pools-là — on n'entre pas dans une
       file d'attente en la choisissant dans une liste, et un ajout par la
       porte normale (/join-team) ne déclencherait pas le départ
       automatique promis par le bouton.
       -------------------------------------------------------------- */
    const PREFIXE_INSTANTANE = 'Repêchage instantané #';

    function estPoolInstantane(nom, pool) {
        if (pool && pool.instant === true) return true;
        return typeof nom === 'string' && nom.startsWith(PREFIXE_INSTANTANE);
    }

    window.FZInstant = { estPoolInstantane, PREFIXE_INSTANTANE };

    // Exposé pour un appel direct, comme les autres actions de pool
    // (joinClan, createClan) que le balisage appelle en onclick.
    window.rejoindreRepechageInstantane = rejoindre;
})();
