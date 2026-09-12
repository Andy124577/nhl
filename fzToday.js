/**
 * « Fantazy Aujourd'hui » côté navigateur.
 *
 * Une seule bande de priorité, alimentée par une seule réponse du serveur
 * (`/api/me/today`), rendue à l'identique par les deux dispositions de
 * l'accueil. Ce qui change par rapport à l'existant :
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

    const echapper = (texte) => String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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

    // ─────────────────────────── Rendu ───────────────────────────

    /** L'icône d'une classe d'urgence. Sobre : la couleur porte déjà le sens. */
    function icone(urgence) {
        if (urgence <= 2) return '🏒';
        if (urgence === 3) return '🔁';
        if (urgence === 4) return '⚔️';
        if (urgence === 5) return '📊';
        return 'ℹ️';
    }

    function ligne(element, principal) {
        const classes = ['fzt-item'];
        if (principal) classes.push('fzt-item--vedette');
        if (element.urgence <= 3) classes.push('fzt-item--urgent');
        if (element.etat === 'indisponible') classes.push('fzt-item--indispo');

        // Le pool est nommé sur chaque ligne : sans lui, « c'est votre tour »
        // ne dit pas dans quelle partie, et suivre le lien ouvrirait le
        // mauvais contexte.
        const pool = element.pool
            ? `<span class="fzt-pool">${echapper(element.pool)}</span>` : '';

        const corps = `
            <span class="fzt-icone" aria-hidden="true">${icone(element.urgence)}</span>
            <span class="fzt-texte">
                <span class="fzt-titre">${echapper(element.titre)}</span>
                ${element.detail ? `<span class="fzt-detail">${echapper(element.detail)}</span>` : ''}
                ${pool}
            </span>
            ${element.action ? `<span class="fzt-action">${echapper(element.action)}</span>` : ''}`;

        return element.href
            ? `<a class="${classes.join(' ')}" href="${echapper(element.href)}" data-fzt-id="${echapper(element.id)}">${corps}</a>`
            : `<div class="${classes.join(' ')}" data-fzt-id="${echapper(element.id)}">${corps}</div>`;
    }

    function videHTML(vide) {
        if (!vide) return '';
        const actions = (vide.actions || [])
            .map(a => `<a class="fzt-vide-action" href="${echapper(a.href)}">${echapper(a.titre)}</a>`)
            .join('');
        return `<div class="fzt-vide">
            <span class="fzt-vide-titre">${echapper(vide.titre)}</span>
            <span class="fzt-vide-detail">${echapper(vide.detail)}</span>
            ${actions ? `<div class="fzt-vide-actions">${actions}</div>` : ''}
        </div>`;
    }

    /**
     * Rend la bande dans un conteneur. Sans réponse, le conteneur reste vide
     * plutôt que d'afficher un squelette qui ne se remplira peut-être jamais.
     */
    function rendre(idConteneur, charge = derniere) {
        const conteneur = document.getElementById(idConteneur);
        if (!conteneur) return;

        if (!charge) { conteneur.innerHTML = ''; conteneur.hidden = true; return; }

        if (!charge.vedette) {
            conteneur.hidden = false;
            conteneur.innerHTML = videHTML(charge.vide);
            return;
        }

        const secondaires = (charge.secondaires || []).map(el => ligne(el, false)).join('');
        conteneur.hidden = false;
        conteneur.innerHTML = `
            <section class="fzt" aria-label="À faire maintenant">
                ${ligne(charge.vedette, true)}
                ${secondaires ? `<div class="fzt-secondaires">${secondaires}</div>` : ''}
            </section>`;
    }

    // ─────────────────────────── Branchements ───────────────────────────

    function brancherSocket(essai = 0) {
        if (!window.__fzSocketPool && typeof io === 'undefined') {
            if (essai < 40) setTimeout(() => brancherSocket(essai + 1), 250);
            return;
        }
        try {
            const socket = window.__fzSocketPool || io(BASE);
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
        /** Charge, puis rend dans les conteneurs présents sur la page. */
        async demarrer(conteneurs = []) {
            if (!connecte()) return null;
            abonnes.add(() => conteneurs.forEach(id => rendre(id)));
            const charge = await charger({ force: true });
            conteneurs.forEach(id => rendre(id));
            brancherSocket();
            demarrerPeriodique();
            return charge;
        },
        charger,
        demander,
        rendre,
        /** S'abonner aux réponses : la bannière d'état s'en sert. */
        surReponse(rappel) { abonnes.add(rappel); return () => abonnes.delete(rappel); },
        /** La dernière réponse connue, ou null. */
        derniere: () => derniere,
        /** L'élément le plus urgent, tous pools confondus. */
        vedette: () => (derniere && derniere.vedette) || null
    };
})();
