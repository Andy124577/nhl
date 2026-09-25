/**
 * Connexion avec Google, côté page — partagé par login.html et signup.html.
 *
 * Le parcours vit sur le serveur (routes/google.js). Ces pages ne font que
 * partir vers /auth/google, dire pourquoi un retour a échoué, et recopier le
 * compte dans localStorage, que le reste du site lit encore pour savoir qui
 * est connecté.
 */
(function () {
    const BASE = window.location.hostname.includes('localhost')
        ? 'http://localhost:3000'
        : window.location.origin;

    /** Motifs de retour posés par le serveur dans `?google=`. */
    const MESSAGES = {
        annule: "Connexion Google annulée.",
        expire: "La connexion Google a expiré. Réessayez.",
        erreur: "La connexion avec Google a échoué. Réessayez.",
        indisponible: "La connexion Google n'est pas disponible pour le moment."
    };

    /**
     * Lit `?google=…`. Un message est retiré de l'adresse aussitôt lu : un
     * rafraîchissement ne doit pas le rejouer. `nouveau` reste, lui : c'est
     * l'étape du choix du nom, qu'un rafraîchissement doit retrouver.
     */
    function codeRetour() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('google');
        if (code && code !== 'nouveau') {
            params.delete('google');
            const reste = params.toString();
            history.replaceState(null, '', window.location.pathname + (reste ? '?' + reste : '') + window.location.hash);
        }
        return code;
    }

    function preparerBouton(depuis) {
        const bloc = document.getElementById('googleBlock');
        const bouton = document.getElementById('googleBtn');
        if (!bloc || !bouton) return;
        const libelle = bouton.querySelector('.btn-google-label');
        const texteInitial = libelle ? libelle.textContent : '';

        bouton.href = `${BASE}/auth/google${depuis === 'signup' ? '?depuis=signup' : ''}`;
        bouton.addEventListener('click', () => {
            bouton.classList.add('is-loading');
            bouton.setAttribute('aria-busy', 'true');
            if (libelle) libelle.textContent = 'Redirection vers Google…';
        });
        // Retour arrière depuis Google : la page revient du cache telle
        // qu'on l'a quittée, bouton en attente compris.
        window.addEventListener('pageshow', (e) => {
            if (!e.persisted) return;
            bouton.classList.remove('is-loading');
            bouton.removeAttribute('aria-busy');
            if (libelle) libelle.textContent = texteInitial;
        });

        // Tant que les clés Google ne sont pas posées sur le serveur, le
        // bouton ne mènerait qu'à un message d'erreur : on le retire.
        fetch(`${BASE}/auth/google/config`)
            .then(r => r.json())
            .then(c => { if (!c.enabled) bloc.hidden = true; })
            .catch(() => {});
    }

    function memoriser(compte) {
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('username', compte.username);
        localStorage.setItem('avatarUrl', compte.avatarUrl || '');
        if (compte.isAdmin) localStorage.setItem('isAdmin', 'true');
        else localStorage.removeItem('isAdmin');
    }

    window.fzGoogle = { BASE, MESSAGES, codeRetour, preparerBouton, memoriser };
})();
