/**
 * « Fantazy Aujourd'hui » côté navigateur.
 *
 * Ce qui réclame l'attention en ce moment, tous pools confondus, lu dans une
 * seule réponse du serveur (`/api/me/today`). Ce module charge et prévient ;
 * il ne dessine rien. notifications.js s'abonne (`surReponse`) et range ces
 * éléments dans la liste de la cloche, comme des lignes ordinaires : ce qui
 * réclame une action se lit à un seul endroit, dans un seul style.
 *
 * Ce qui change par rapport à l'existant :
 *
 *   - la bannière d'état ne regardait que le pool ACTIF. Un tour de repêchage
 *     dans un autre pool était donc invisible tant qu'on n'y basculait pas —
 *     exactement la chose la plus urgente que le site puisse avoir à dire ;
 *   - chaque disposition posait ses propres questions au serveur. Elles lisent
 *     maintenant la même réponse, donc annoncent la même action ;
 *   - l'élément principal ne change plus sous le doigt : le client annonce ce
 *     qu'il affiche déjà, et seul un élément plus urgent le remplace.
 *
 * Trois précautions de fond :
 *
 *   - **une seule requête à la fois.** Une rafale d'évènements socket ne
 *     déclenche pas une rafale de requêtes : elles se regroupent ;
 *   - **rien ne tourne quand l'onglet est caché.** Le rafraîchissement reprend
 *     au retour, avec une lecture immédiate ;
 *   - **une réponse en retard ne s'affiche pas.** Si le pool actif a changé
 *     entre l'envoi et la réponse, celle-ci est jetée : afficher le duel du
 *     pool précédent dans le contexte du nouveau serait pire que rien.
 */
(function () {
    'use strict';

    const BASE = (typeof BASE_URL !== 'undefined' && BASE_URL) ? BASE_URL : '';

    /** Délai de regroupement après une rafale d'évènements. */
    const REGROUPEMENT_MS = 400;

    /** Rafraîchissement de fond, uniquement quand l'onglet est visible. */
    const PERIODE_MS = 60000;

    let derniere = null;          // dernière réponse affichée
    let requeteEnCours = null;
    let minuteurRegroupement = null;
    let minuteurPeriodique = null;
    let jeton = 0;                // identifie la requête en vol
    let vedetteAffichee = null;   // ce que l'écran montre déjà
    const abonnes = new Set();

    const poolActif = () => {
        try { return (window.FZPool && FZPool.get && FZPool.get()) || null; }
        catch { return null; }
    };

    const connecte = () => {
        try { return localStorage.getItem('isLoggedIn') === 'true'; }
        catch { return false; }
    };

    /**
     * Interroge le serveur, au plus une fois à la fois.
     *
     * Le jeton est ce qui distingue « cette réponse concerne l'écran actuel »
     * de « cette réponse est arrivée après un changement de pool ».
     */
    async function charger({ force = false } = {}) {
        if (!connecte()) return null;
        if (requeteEnCours && !force) return requeteEnCours;

        const monJeton = ++jeton;
        const poolDemande = poolActif();

        const params = new URLSearchParams();
        if (poolDemande) params.set('pool', poolDemande);
        if (vedetteAffichee) params.set('current', vedetteAffichee);

        requeteEnCours = (async () => {
            try {
                const reponse = await fetch(`${BASE}/api/me/today?${params}`,
                    { cache: 'no-store', signal: AbortSignal.timeout(15000) });
                if (!reponse.ok) throw new Error('Aujourd hui indisponible');
                const charge = await reponse.json();

                // Réponse périmée : un autre chargement l'a devancée, ou le
                // pool actif a changé entre-temps.
                if (monJeton !== jeton || poolActif() !== poolDemande) return null;

                derniere = charge;
                vedetteAffichee = charge.vedette ? charge.vedette.id : null;
                prevenirAbonnes(charge);
                return charge;
            } catch {
                // On garde la dernière réponse connue : vider l'accueil parce
                // qu'une requête a échoué serait la pire des réactions.
                return null;
            } finally {
                requeteEnCours = null;
            }
        })();

        return requeteEnCours;
    }

    /** Regroupe les demandes rapprochées en une seule requête. */
    function demander() {
        if (minuteurRegroupement) return;
        minuteurRegroupement = setTimeout(() => {
            minuteurRegroupement = null;
            charger();
        }, REGROUPEMENT_MS);
    }

    function prevenirAbonnes(charge) {
        for (const rappel of abonnes) {
            try { rappel(charge); } catch { /* un abonné fautif n'empêche pas les autres */ }
        }
    }

    // ─────────────────────────── Branchements ───────────────────────────

    function brancherSocket(essai = 0) {
        if (!window.__fzSocketPool && typeof io === 'undefined') {
            if (essai < 40) setTimeout(() => brancherSocket(essai + 1), 250);
            return;
        }
        try {
            const socket = (window.fzSocketPartage && window.fzSocketPartage()) || window.__fzSocketPool || io(BASE);
            // Tous ces signaux peuvent changer ce qui mérite l'attention ; ils
            // se regroupent en une requête.
            ['poolUpdated', 'draftUpdated', 'tradePending', 'tradeUpdated',
             'h2hWeekFinalized', 'salonMisAJour', 'draftDemarre', 'recapDisponible']
                .forEach(nom => socket.on(nom, demander));
            socket.on('connect', () => charger({ force: true }));
        } catch { /* le rafraîchissement périodique prend le relais */ }
    }

    function demarrerPeriodique() {
        arreterPeriodique();
        // Rien ne tourne pendant que l'onglet est caché : un accueil invisible
        // n'a aucune raison de consommer du réseau ni de la batterie.
        if (document.visibilityState !== 'visible') return;
        minuteurPeriodique = setInterval(() => charger(), PERIODE_MS);
    }

    function arreterPeriodique() {
        if (minuteurPeriodique) { clearInterval(minuteurPeriodique); minuteurPeriodique = null; }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            charger({ force: true });
            demarrerPeriodique();
        } else {
            arreterPeriodique();
        }
    });

    window.FZToday = {
        /**
         * Premier chargement, puis rafraîchissements (socket, minuteur,
         * retour sur l'onglet). Chaque réponse retenue va aux abonnés.
         */
        async demarrer() {
            if (!connecte()) return null;
            const charge = await charger({ force: true });
            brancherSocket();
            demarrerPeriodique();
            return charge;
        },
        charger,
        demander,
        /** S'abonner aux réponses : la cloche (notifications.js) s'en sert. */
        surReponse(rappel) { abonnes.add(rappel); return () => abonnes.delete(rappel); },
        /** La dernière réponse connue, ou null. */
        derniere: () => derniere,
        /** L'élément le plus urgent, tous pools confondus. */
        vedette: () => (derniere && derniere.vedette) || null
    };
})();
