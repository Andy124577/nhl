/* ============================================================
   RÉACTIVITÉ — le geste répond tout de suite, partout
   ------------------------------------------------------------
   Chargé sur chaque page de l'application, juste après activePool.js.

   1. Le toucher s'allume au doigt. Sur iPhone, :active ne s'applique
      qu'aux pages qui écoutent `touchstart` : sans cette écoute, un bouton
      ne réagissait qu'au relâchement. Les styles d'appui sont dans
      fzReactif.css.

   2. La page suivante part au toucher. Un lien vers une autre page du site
      est préchargé dès que le doigt se pose (ou que la souris s'attarde) :
      le HTML est déjà là au relâchement. Seulement le HTML, statique et
      gardé cinq minutes par le navigateur (server.js) — aucune requête à
      la base, aucun script exécuté d'avance.

   3. Le retour arrière est instantané. Le navigateur garde la page
      précédente telle quelle (« back/forward cache »), mais une connexion
      Socket.IO ouverte l'en empêche : on la referme en quittant la page et
      on la rouvre au retour, avec une relecture du pool actif.

   4. FZMemo : la mémoire des données déjà vues. Un jour, une semaine, un
      club déjà affichés reviennent tout de suite au lieu de repasser par
      un squelette ; ils se relisent en arrière-plan quand ils ont vieilli.
      Gardée dans l'onglet (sessionStorage) : quitter une page et y revenir
      la retrouve. Toute écriture (POST, PUT, DELETE…) vide cette mémoire :
      après un échange accepté, rien de périmé ne revient.
   ============================================================ */
(function () {
    'use strict';
    if (window.FZMemo) return;

    // ---------- 1. Le toucher s'allume au doigt ----------
    document.addEventListener('touchstart', function () {}, { passive: true });

    // ---------- 4. FZMemo ----------
    const PREFIXE = 'fzMemo:';
    const PLAFOND = 400 * 1024; // une entrée plus grosse reste en mémoire de page seulement
    const page = new Map();     // cle → { data, at }
    const enVol = new Map();    // cle → promesse

    function lireSession(cle) {
        try {
            const brut = sessionStorage.getItem(PREFIXE + cle);
            return brut ? JSON.parse(brut) : null;
        } catch (e) { return null; }
    }

    function ecrireSession(cle, entree) {
        try {
            const brut = JSON.stringify(entree);
            if (brut.length > PLAFOND) return;
            sessionStorage.setItem(PREFIXE + cle, brut);
        } catch (e) {
            // Mémoire de l'onglet pleine : on fait de la place et on oublie.
            vider();
        }
    }

    function vider() {
        page.clear();
        try {
            // L'instantané des pools (activePool.js) suit la même règle.
            sessionStorage.removeItem('fzDraftInstantane');
            for (let i = sessionStorage.length - 1; i >= 0; i--) {
                const k = sessionStorage.key(i);
                if (k && k.indexOf(PREFIXE) === 0) sessionStorage.removeItem(k);
            }
        } catch (e) { /* stockage indisponible */ }
    }

    const FZMemo = {
        /** { data, at } ou null. */
        lire(cle) {
            if (page.has(cle)) return page.get(cle);
            const s = lireSession(cle);
            if (s && 'data' in s) { page.set(cle, s); return s; }
            return null;
        },

        /** La donnée seule, si elle a moins de `ageMax` ms (Infinity par défaut). */
        donnee(cle, ageMax) {
            const e = FZMemo.lire(cle);
            if (!e) return null;
            if (ageMax != null && Date.now() - e.at > ageMax) return null;
            return e.data;
        },

        ecrire(cle, data, { session = true } = {}) {
            const entree = { data, at: Date.now() };
            page.set(cle, entree);
            if (session) ecrireSession(cle, entree);
            return data;
        },

        oublier(cle) {
            page.delete(cle);
            try { sessionStorage.removeItem(PREFIXE + cle); } catch (e) { /* rien */ }
        },

        vider,

        /**
         * Lit `cle` : la mémoire si elle a moins de `fraisMs`, sinon
         * `chargeur()`. Deux demandes de la même clé en même temps n'en font
         * qu'une. Une donnée `undefined` ou `null` n'est pas mémorisée.
         */
        charger(cle, chargeur, { fraisMs = 60000, session = true } = {}) {
            const e = FZMemo.lire(cle);
            if (e && Date.now() - e.at < fraisMs) return Promise.resolve(e.data);
            if (enVol.has(cle)) return enVol.get(cle);
            const p = Promise.resolve().then(chargeur).then(data => {
                enVol.delete(cle);
                if (data != null) FZMemo.ecrire(cle, data, { session });
                return data;
            }, err => { enVol.delete(cle); throw err; });
            enVol.set(cle, p);
            return p;
        },

        /** GET JSON mémorisé ; rejette si la réponse n'est pas 2xx. */
        json(url, options) {
            return FZMemo.charger(url, async () => {
                const r = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            }, options);
        }
    };
    window.FZMemo = FZMemo;

    // Une écriture vers le serveur rend la mémoire suspecte : on l'oublie.
    if (typeof window.fetch === 'function' && !window.fetch.__fzMemo) {
        const origine = window.fetch;
        const enveloppe = function (entree, init) {
            const methode = String((init && init.method) || (entree && entree.method) || 'GET').toUpperCase();
            const p = origine.apply(this, arguments);
            if (methode !== 'GET' && methode !== 'HEAD') {
                vider();
                // Et une deuxième fois à la réponse : une lecture partie
                // pendant l'écriture ne doit pas laisser l'état d'avant.
                p.then(vider, vider);
            }
            return p;
        };
        enveloppe.__fzMemo = true;
        window.fetch = enveloppe;
    }

    // ---------- 2. Préchargement des pages au toucher ----------
    const prechargees = new Set();
    const supporte = (function () {
        try { return document.createElement('link').relList.supports('prefetch'); } catch (e) { return false; }
    })();

    function cibleDe(lien) {
        if (!lien || !lien.href || lien.target === '_blank' || lien.hasAttribute('download')) return null;
        let url;
        try { url = new URL(lien.href, location.href); } catch (e) { return null; }
        if (url.origin !== location.origin) return null;
        if (!/\.html$/i.test(url.pathname)) return null;
        if (url.pathname === location.pathname) return null;
        url.hash = '';
        return url.href;
    }

    function precharger(lien) {
        if (!supporte) return;
        const conn = navigator.connection;
        if (conn && (conn.saveData || /2g/.test(conn.effectiveType || ''))) return;
        const href = cibleDe(lien);
        if (!href || prechargees.has(href)) return;
        prechargees.add(href);
        const l = document.createElement('link');
        l.rel = 'prefetch';
        l.href = href;
        l.as = 'document';
        document.head.appendChild(l);
    }

    document.addEventListener('touchstart', e => {
        precharger(e.target.closest && e.target.closest('a[href]'));
    }, { passive: true, capture: true });
    document.addEventListener('mousedown', e => {
        precharger(e.target.closest && e.target.closest('a[href]'));
    }, { capture: true });
    let survol = null;
    document.addEventListener('mouseover', e => {
        const lien = e.target.closest && e.target.closest('a[href]');
        clearTimeout(survol);
        if (lien) survol = setTimeout(() => precharger(lien), 65);
    }, { passive: true });

    // ---------- 3. Retour arrière instantané ----------
    window.addEventListener('pagehide', e => {
        if (!e.persisted) return;
        const s = window.__fzSocketPool;
        if (s && s.connected) {
            try { s.disconnect(); s.__fzRelancer = true; } catch (err) { /* rien */ }
        }
    });
    window.addEventListener('pageshow', e => {
        if (!e.persisted) return;
        const s = window.__fzSocketPool;
        if (s && s.__fzRelancer) {
            s.__fzRelancer = false;
            // La reconnexion relit les pools (activePool.js, 'connect').
            try { s.connect(); } catch (err) { /* rien */ }
        } else if (window.FZPool && typeof FZPool.refresh === 'function') {
            FZPool.refresh();
        }
    });
})();
