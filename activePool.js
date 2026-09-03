/* ============================================================
   CONTEXTE DE POOL ACTIF
   ------------------------------------------------------------
   Un seul pool est « actif » à la fois. Toutes les pages liées à un
   pool — Classement, Échange, Repêchage — s'y rattachent, ce qui évite
   de redemander « quel pool ? » à chaque page. L'Accueil fait exception
   et continue d'agréger l'ensemble des pools.

   Le choix est conservé dans localStorage. Il peut être imposé par
   ?pool=<nom> dans l'URL : c'est ainsi que les notifications amènent
   l'utilisateur dans le bon pool avant d'ouvrir le contenu visé.

   Ce fichier est aussi le seul endroit qui sait lire l'état d'un
   repêchage. La même règle était recopiée dans quatre fichiers.
   ============================================================ */
(function () {
    const BASE_URL = window.location.hostname.includes('localhost')
        ? 'http://localhost:3000'
        : window.location.origin;

    const CLE_ACTIF = 'activePool';
    const CLE_DRAFT = 'draftClan';   // lu tel quel par draftActif.js et draftFini.js

    const CONFIG_DEFAUT = {
        numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1, numTeams: 1
    };

    let tousLesPools = {};   // réponse brute de /draft
    let mesPools = [];       // [{ name, data, teamName, teamData }]
    let actif = null;        // nom du pool actif, ou null
    let chargement = null;   // promesse de premier chargement
    const abonnesChangement = [];   // appelés quand le pool actif change
    const abonnesDonnees = [];      // appelés quand /draft est rafraîchi

    const utilisateur = () => localStorage.getItem('username') || '';

    // ==================== LECTURE DES POOLS ====================

    function equipeDe(poolData, username) {
        const entree = Object.entries(poolData.teams || {}).find(
            ([, equipe]) => Array.isArray(equipe.members) && equipe.members.includes(username)
        );
        return entree ? { teamName: entree[0], teamData: entree[1] } : null;
    }

    /**
     * État du repêchage d'un pool.
     *
     * Renvoie `etat` parmi :
     *   attente  — le pool n'est pas encore plein
     *   pret     — plein, mais le repêchage n'a pas démarré
     *   encours  — draftOrder existe et toutes les sélections ne sont pas faites
     *   termine  — chaque équipe a rempli toutes ses cases
     */
    function etatRepechage(poolData) {
        if (!poolData) return { etat: 'attente', inscrits: 0, max: 0 };

        const config = poolData.config || CONFIG_DEFAUT;
        const equipesActives = Object.values(poolData.teams || {})
            .filter(equipe => (equipe.members || []).length > 0);

        const termine = equipesActives.length > 0 && equipesActives.every(equipe =>
            (equipe.offensive || []).length === config.numOffensive &&
            (equipe.defensive || []).length === config.numDefensive &&
            (equipe.rookie || []).length === config.numRookies &&
            (equipe.goalie || []).length === config.numGoalies &&
            (equipe.teams || []).length === config.numTeams
        );

        const commence = Array.isArray(poolData.draftOrder) && poolData.draftOrder.length > 0;
        const inscrits = Object.values(poolData.teams || {})
            .reduce((somme, equipe) => somme + ((equipe.members || []).length), 0);
        const max = poolData.maxPlayers || 10;

        if (termine) return { etat: 'termine', inscrits, max, commence };

        if (commence) {
            const index = poolData.currentPickIndex || 0;
            return {
                etat: 'encours', inscrits, max, commence,
                equipeAuTour: poolData.draftOrder[index] || null,
                choixFait: index,
                choixTotal: poolData.draftOrder.length
            };
        }

        return { etat: inscrits >= max ? 'pret' : 'attente', inscrits, max, commence };
    }

    /** Un effectif existe-t-il ? Sert à savoir si échanges et classement ont du sens. */
    function aUnEffectif(teamData) {
        if (!teamData) return false;
        return (teamData.offensive || []).length +
               (teamData.defensive || []).length +
               (teamData.goalie || []).length +
               (teamData.rookie || []).length > 0;
    }

    function construireMesPools() {
        const username = utilisateur();
        mesPools = Object.entries(tousLesPools)
            .map(([name, data]) => {
                const equipe = equipeDe(data, username);
                if (!equipe) return null;
                return { name, data, teamName: equipe.teamName, teamData: equipe.teamData };
            })
            .filter(Boolean)
            .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    }

    /**
     * Pool retenu quand rien n'est encore choisi : celui qui réclame une
     * action passe devant, sinon le premier de la liste. Personne n'aime
     * arriver sur un pool endormi quand un repêchage l'attend ailleurs.
     */
    function poolParDefaut() {
        if (mesPools.length === 0) return null;
        const priorite = { encours: 0, pret: 1, termine: 2, attente: 3 };
        const trie = [...mesPools].sort((a, b) => {
            const pa = priorite[etatRepechage(a.data).etat] ?? 9;
            const pb = priorite[etatRepechage(b.data).etat] ?? 9;
            return pa - pb || a.name.localeCompare(b.name, 'fr');
        });
        return trie[0].name;
    }

    function estMembre(nom) {
        return mesPools.some(p => p.name === nom);
    }

    // ==================== CHARGEMENT ====================

    async function chargerDraft() {
        const reponse = await fetch(`${BASE_URL}/draft?timestamp=${Date.now()}`, { cache: 'no-store' });
        tousLesPools = await reponse.json();
        construireMesPools();
    }

    function poolDeLUrl() {
        try {
            const valeur = new URLSearchParams(window.location.search).get('pool');
            return valeur ? decodeURIComponent(valeur) : null;
        } catch { return null; }
    }

    function resoudreActif() {
        const demande = poolDeLUrl();
        if (demande && estMembre(demande)) return demande;

        const memorise = localStorage.getItem(CLE_ACTIF);
        // Un pool quitté ou supprimé ne doit pas rester collé au contexte.
        if (memorise && estMembre(memorise)) return memorise;

        return poolParDefaut();
    }

    function memoriser(nom) {
        if (nom) {
            localStorage.setItem(CLE_ACTIF, nom);
            // draftActif.js et draftFini.js lisent encore cette clé.
            localStorage.setItem(CLE_DRAFT, nom);
        } else {
            localStorage.removeItem(CLE_ACTIF);
        }
    }

    /**
     * Préréglage synchrone, avant tout appel réseau.
     *
     * draftActif.js et draftFini.js lisent `draftClan` dès leur première
     * ligne : attendre /draft pour l'écrire arriverait trop tard, et un
     * lien de notification ouvrirait le repêchage du pool précédent.
     * L'appartenance n'est pas vérifiable ici ; le passage asynchrone
     * corrige au besoin juste après.
     */
    let prereglage = null;
    (function preregler() {
        prereglage = poolDeLUrl() || localStorage.getItem(CLE_ACTIF);
        if (prereglage) {
            localStorage.setItem(CLE_ACTIF, prereglage);
            localStorage.setItem(CLE_DRAFT, prereglage);
        }
    })();

    /** Pages dont le contenu est figé par la valeur lue au chargement. */
    const pageLieeAuDraft = /draftActif|draftFini/.test(window.location.pathname);

    /**
     * Écrans du repêchage lui-même : la salle de sélection et le panneau qui
     * y mène. Une fois le repêchage terminé, ils n'ont plus rien à offrir —
     * la salle ne prend plus de choix, repechage.html n'est qu'un renvoi — et
     * leur lien disparaît des barres de navigation (updateDraftLinkVisibility
     * dans navbar.js). On ferme aussi la porte ici : une URL reste tapable, et
     * un vieux favori ou lien de notification continue d'arriver.
     *
     * draftFini.html n'en fait pas partie : c'est l'archive des sélections,
     * elle n'a de sens qu'une fois le repêchage fini.
     */
    const pageDuRepechage = /repechage\.html|draftActif\.html/.test(window.location.pathname);

    /**
     * Vérifié au chargement seulement, jamais sur une mise à jour temps réel :
     * qui est présent au dernier choix doit voir le repêchage se terminer et
     * son récapitulatif (draftFinPopup.js), pas être éjecté à la seconde où le
     * tableau se complète.
     */
    function fermerLeRepechageSiTermine() {
        if (!pageDuRepechage || !actif) return false;
        const donnees = tousLesPools[actif];
        if (!donnees || etatRepechage(donnees).etat !== 'termine') return false;
        // replace : le bouton Retour ne doit pas ramener sur une porte fermée.
        window.location.replace('index.html');
        return true;
    }

    /**
     * Retire les paramètres de contexte de l'URL.
     *
     * Sans ce ménage, changer de pool sur une page arrivée par
     * ?pool=… reviendrait au pool précédent au premier rechargement :
     * l'URL l'emporte sur ce qui est mémorisé, et c'est voulu.
     */
    function urlSansContexte() {
        const url = new URL(window.location.href);
        url.searchParams.delete('pool');
        url.searchParams.delete('trade');
        return url.toString();
    }

    function initialiser() {
        if (chargement) return chargement;
        chargement = (async () => {
            if (!utilisateur()) { tousLesPools = {}; mesPools = []; actif = null; return API; }
            try {
                await chargerDraft();
            } catch (erreur) {
                console.error('Chargement des pools impossible :', erreur);
            }
            actif = resoudreActif();
            memoriser(actif);

            if (fermerLeRepechageSiTermine()) return API;

            // Le préréglage a pu retenir un pool devenu inaccessible : ces
            // pages-là ont déjà démarré dessus, il faut les relancer.
            if (pageLieeAuDraft && prereglage && prereglage !== actif && actif) {
                if (!sessionStorage.getItem('fzPoolCorrige')) {
                    sessionStorage.setItem('fzPoolCorrige', '1');
                    window.location.reload();
                    return API;
                }
            }
            sessionStorage.removeItem('fzPoolCorrige');
            return API;
        })();
        return chargement;
    }

    // ==================== CHANGEMENT DE POOL ====================

    function notifier() {
        const donnees = API.data();
        abonnesChangement.forEach(fn => {
            try { fn(actif, donnees); } catch (e) { console.error(e); }
        });
        document.dispatchEvent(new CustomEvent('fz:poolchange', {
            detail: { pool: actif, data: donnees }
        }));
        // Compatibilité avec l'ancien évènement jQuery de poolSelector.js.
        if (window.jQuery) jQuery(document).trigger('activePoolChanged', [actif]);
    }

    /**
     * Change le pool actif.
     *
     * Par défaut la page se recharge : la plupart des écrans lisent le pool
     * une seule fois au démarrage, et un rechargement est plus sûr qu'un
     * rafraîchissement partiel approximatif. Les pages capables de se
     * remettre à jour toutes seules posent `window.FZ_POOL_EN_PLACE = true`.
     */
    function definir(nom, options) {
        const opts = options || {};
        if (!nom || nom === actif) return;
        if (!estMembre(nom)) return;

        actif = nom;
        memoriser(actif);

        if (opts.silencieux) return;

        if (opts.url) { window.location.href = opts.url; return; }

        if (window.FZ_POOL_EN_PLACE) {
            // L'URL peut encore désigner l'ancien pool ; la nettoyer évite
            // qu'un simple F5 défasse le choix qu'on vient de faire.
            history.replaceState(null, '', urlSansContexte());
            notifier();
            return;
        }

        window.location.replace(urlSansContexte());
    }

    async function rafraichir() {
        if (!utilisateur()) return;
        try {
            await chargerDraft();
        } catch (erreur) {
            console.error('Rafraîchissement des pools impossible :', erreur);
            return;
        }
        // Le pool actif a pu disparaître entre-temps (départ, suppression).
        if (actif && !estMembre(actif)) {
            actif = poolParDefaut();
            memoriser(actif);
            notifier();
        }
        const donnees = API.data();
        abonnesDonnees.forEach(fn => {
            try { fn(actif, donnees); } catch (e) { console.error(e); }
        });
    }

    // Les mises à jour temps réel du serveur gardent la liste fraîche sans
    // qu'aucune page n'ait à s'en occuper.
    function brancherSocket() {
        if (window.__fzSocketPool) return;

        // socket.io est chargé en bas de page (et peut tarder, voire ne
        // jamais arriver derrière un proxy). Abandonner en silence au
        // premier essai laissait l'Accueil figé sur un tour périmé jusqu'à
        // un rechargement manuel : on réessaie, puis le filet plus bas prend
        // le relais si la bibliothèque ne vient jamais.
        if (typeof io === 'undefined') {
            brancherSocket.essais = (brancherSocket.essais || 0) + 1;
            if (brancherSocket.essais <= 40) setTimeout(brancherSocket, 250);
            return;
        }

        try {
            window.__fzSocketPool = io(BASE_URL);
            window.__fzSocketPool.on('draftUpdated', () => { rafraichir(); });
            // Une coupure (veille du téléphone, changement de réseau) fait
            // manquer les évènements émis pendant l'absence : on resynchronise
            // à la reconnexion, pas seulement au premier branchement.
            let dejaConnecte = false;
            window.__fzSocketPool.on('connect', () => {
                if (dejaConnecte) rafraichir();
                dejaConnecte = true;
            });
        } catch { /* socket indisponible : le filet ci-dessous prend le relais */ }
    }

    /**
     * Filet de sécurité pendant un repêchage.
     *
     * Un choix manqué — socket jamais établi, évènement perdu, onglet en
     * arrière-plan — laissait la page sur un tour périmé jusqu'à ce que
     * l'utilisateur recharge lui-même. La salle de repêchage avait déjà son
     * sondage (7 s, draftActif.js) ; l'Accueil, non. On le pose ici pour que
     * toutes les pages en profitent, et seulement quand il sert : repêchage
     * en cours et onglet visible.
     */
    function filetRepechage() {
        const enRepechage = () => {
            const donnees = API.data();
            return !!donnees && etatRepechage(donnees).etat === 'encours';
        };
        setInterval(() => {
            if (document.hidden || !enRepechage()) return;
            rafraichir();
        }, 20000);
        // Revenir sur l'onglet doit montrer l'état réel, pas celui d'il y a
        // dix minutes.
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && enRepechage()) rafraichir();
        });
    }
    filetRepechage();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(brancherSocket, 0));
    } else {
        setTimeout(brancherSocket, 0);
    }

    // ==================== API PUBLIQUE ====================

    const API = {
        /** Promesse résolue une fois /draft chargé et le pool actif déterminé. */
        ready: initialiser,

        /** Nom du pool actif, ou null si l'utilisateur n'est dans aucun pool. */
        get: () => actif,

        /** Données du pool actif. */
        data: () => (actif ? tousLesPools[actif] : null) || null,

        /** Équipe de l'utilisateur dans le pool actif. */
        team: () => {
            const entree = mesPools.find(p => p.name === actif);
            return entree ? { name: entree.teamName, data: entree.teamData } : null;
        },

        /** Tous les pools dont l'utilisateur est membre. */
        mine: () => mesPools.slice(),

        /** Tous les pools connus, y compris ceux qu'on n'a pas rejoints. */
        all: () => tousLesPools,

        set: definir,
        refresh: rafraichir,

        /** S'abonner au changement de pool actif. */
        on: fn => { if (typeof fn === 'function') abonnesChangement.push(fn); },

        /** S'abonner au rafraîchissement des données (socket, rechargement). */
        onData: fn => { if (typeof fn === 'function') abonnesDonnees.push(fn); },

        // Helpers partagés
        draftState: etatRepechage,
        teamOf: equipeDe,
        hasRoster: aUnEffectif,
        isMember: estMembre,

        /** Vignette d'un pool : son image, sinon l'image générique. */
        image: data => (data && data.imageUrl) ? data.imageUrl : 'Icons/grayGroup.png',

        BASE_URL
    };

    window.FZPool = API;
    initialiser();
})();
