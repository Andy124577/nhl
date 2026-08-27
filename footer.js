/**
 * Pied de page commun — injecté sur toutes les pages qui chargent ce script,
 * sur le même principe que navbar.js. Les mentions légales complètes vivent
 * sur conditions.html / confidentialite.html ; ici on ne met qu'un lien vers
 * elles plus la mention de non-affiliation. Un seul fichier à modifier.
 *
 * Ne fait rien si la page fournit déjà son propre <footer class="site-footer">
 * (échappatoire ponctuelle sans toucher ce fichier).
 */
(function () {
    function buildFooter() {
        if (document.querySelector('.site-footer')) return;

        var footer = document.createElement('footer');
        footer.className = 'site-footer';
        footer.innerHTML =
            '<div class="site-footer-inner">' +
                '<p class="site-footer-disclaimer">' +
                    'Fantazy est un service indépendant et gratuit, sans affiliation ' +
                    'avec la LNH/NHL ni l’AJLNH (NHLPA). Les marques et photos citées ' +
                    'demeurent la propriété de leurs titulaires respectifs.' +
                '</p>' +
                '<nav class="site-footer-links" aria-label="Mentions légales">' +
                    '<a href="conditions.html">Conditions d’utilisation</a>' +
                    '<a href="confidentialite.html">Confidentialité</a>' +
                    '<a href="mailto:fantazyhockey@outlook.com">Nous joindre</a>' +
                '</nav>' +
                '<p class="site-footer-copy">© ' + new Date().getFullYear() + ' Fantazy</p>' +
            '</div>';
        document.body.appendChild(footer);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildFooter);
    } else {
        buildFooter();
    }
})();
