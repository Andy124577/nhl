/**
 * Les en-têtes de sécurité des réponses : CSP et HSTS.
 *
 * Content-Security-Policy dit au navigateur d'où une page a le droit de
 * charger ses scripts, ses styles, ses polices, et à qui elle a le droit de
 * parler. Le site en avait besoin d'une : un nom d'utilisateur porteur de
 * HTML s'affichait tel quel dans une page (draftFini.js), et rien
 * n'empêchait le script injecté de charger la suite depuis n'importe où.
 *
 * Les pages vivent encore de `onclick="…"` et de blocs <script> en ligne :
 * 'unsafe-inline' reste donc permis. Ce que la politique ferme quand même —
 * et c'est l'essentiel d'une attaque réelle — : charger un script d'ailleurs
 * que des quatre origines connues, parler à un autre serveur que le nôtre
 * (connect-src), se faire encadrer par un autre site, changer la <base> des
 * liens, ou poster un formulaire ailleurs.
 *
 * Chaque refus du navigateur est rapporté à /csp-report et journalisé : une
 * ressource oubliée ici se voit dans les journaux de Render plutôt que dans
 * une page cassée qu'on ne remarque pas. `CSP_MODE=report` n'applique rien et
 * se contente de rapporter ; `CSP_MODE=off` retire l'en-tête.
 */

'use strict';

const CHEMIN_RAPPORT = '/csp-report';

/** Les origines extérieures que les pages chargent réellement (inventaire du 26 octobre 2026). */
const DIRECTIVES = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", 'https://code.jquery.com', 'https://cdn.socket.io', 'https://cdn.jsdelivr.net'],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
    // Photos des joueurs et logos (assets.nhle.com), images des nouvelles :
    // elles viennent de partout, et une image ne s'exécute pas.
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    // Toutes les données passent par notre serveur, Socket.IO compris.
    'connect-src': ["'self'"],
    'media-src': ["'self'"],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'self'"]
};

/** La politique, prête pour l'en-tête. */
function politiqueDeContenu({ rapport = CHEMIN_RAPPORT } = {}) {
    const parties = Object.entries(DIRECTIVES).map(([nom, sources]) => `${nom} ${sources.join(' ')}`);
    if (rapport) parties.push(`report-uri ${rapport}`, 'report-to csp');
    return parties.join('; ');
}

/** Le mode lu dans l'environnement : 'enforce' (défaut), 'report' ou 'off'. */
function modeCsp(valeur) {
    const mode = String(valeur || '').trim().toLowerCase();
    return mode === 'report' || mode === 'off' ? mode : 'enforce';
}

/**
 * Les en-têtes à poser sur une réponse, en [nom, valeur].
 *
 * HSTS seulement en production ET sur une requête arrivée en HTTPS : le
 * navigateur retient alors de ne plus jamais venir en clair pendant un an.
 * Sans `includeSubDomains` — d'autres sous-domaines du même nom n'ont pas à
 * en dépendre.
 */
function entetesDeSecurite({ production = false, https = false, mode = 'enforce' } = {}) {
    const entetes = [];
    if (mode !== 'off') {
        entetes.push(['Reporting-Endpoints', `csp="${CHEMIN_RAPPORT}"`]);
        entetes.push([mode === 'report' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', politiqueDeContenu()]);
    }
    if (production && https) entetes.push(['Strict-Transport-Security', 'max-age=31536000']);
    return entetes;
}

/**
 * Les refus contenus dans un rapport, quelle que soit sa forme : l'ancienne
 * (`{ "csp-report": { … } }`, report-uri) ou celle de la Reporting API (un
 * tableau de `{ type: "csp-violation", body: { … } }`, report-to).
 */
function lireRapportCsp(corps) {
    const entrees = Array.isArray(corps) ? corps : [corps];
    const sortie = [];
    for (const entree of entrees) {
        if (!entree || typeof entree !== 'object') continue;
        const brut = entree['csp-report'] || (entree.type === 'csp-violation' ? entree.body : null);
        if (!brut || typeof brut !== 'object') continue;
        const texte = (v) => String(v == null ? '' : v).slice(0, 200);
        sortie.push({
            directive: texte(brut['effective-directive'] || brut.effectiveDirective || brut['violated-directive']),
            bloque: texte(brut['blocked-uri'] || brut.blockedURL),
            page: texte(brut['document-uri'] || brut.documentURL)
        });
    }
    return sortie;
}

module.exports = { CHEMIN_RAPPORT, DIRECTIVES, politiqueDeContenu, modeCsp, entetesDeSecurite, lireRapportCsp };
