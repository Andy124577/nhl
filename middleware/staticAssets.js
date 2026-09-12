/**
 * Ce que le serveur a le droit de livrer au navigateur.
 *
 * `express.static(__dirname)` servait la racine du dépôt entière. Tout ce qui
 * s'y trouve était donc téléchargeable : `server.js`, `db.js`, `users.json` et
 * ses empreintes de mots de passe, `draft.json` avec tous les pools, les
 * scripts de migration, les notes internes — et `.env`, si le fichier existe
 * là où le processus tourne.
 *
 * Le remplacement n'essaie pas de deviner ce qui est sensible : il liste ce
 * qui est public, et refuse le reste. Une règle qui énumère les interdits
 * oublie toujours le fichier ajouté demain ; une règle qui énumère les permis
 * refuse ce fichier par défaut, ce qui est le bon défaut.
 *
 * La décision est une fonction pure — `estPublic(chemin)` — donc testable sans
 * serveur, y compris pour les chemins tordus (`..`, `%2e%2e`, `.env`,
 * `lib/../db.js`).
 */

'use strict';

const path = require('path');

/** Extensions livrables. Tout le reste est refusé, y compris sans extension. */
const EXT_PUBLIQUES = new Set([
    '.html', '.css', '.js', '.mjs', '.map',
    '.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.ico',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.json', '.txt'
]);

/**
 * Dossiers publics, servis récursivement dans la limite de EXT_PUBLIQUES.
 *
 * `uploads` garde son propre montage dans server.js (photos de profil et
 * images de pool) ; il figure ici pour que la garde ne le bloque pas.
 */
const DOSSIERS_PUBLICS = new Set(['icons', 'assets', 'teams', 'uploads', 'lib']);

/**
 * Fichiers JSON servis tels quels au navigateur.
 *
 * Ce sont des données de référence de la LNH et la trousse de repêchage :
 * rien de personnel, rien de spécifique à un pool. Tous les autres JSON de la
 * racine — pools, comptes, échanges, instantanés d'alignements — passent par
 * une route authentifiée ou ne sortent pas.
 */
const JSON_PUBLICS = new Set([
    'nhl_filtered_stats.json',
    'draftkit.json',
    'draftkit-watchlist.json'
]);

/**
 * Fichiers .js de la racine qui sont du code serveur.
 *
 * La racine mélange le script client (`classement.js`) et le script serveur
 * (`server.js`) ; seule cette liste les sépare. Un fichier serveur ajouté plus
 * tard et oublié ici serait servi — d'où le contrôle de dernier recours dans
 * `estPublic` : tout ce qui ressemble à un outil (`test_`, `migrate`, `fetch_`)
 * est refusé même absent de la liste.
 */
const JS_SERVEUR = new Set([
    'server.js',
    'db.js',
    'create-test-users.js',
    'migrate-to-postgres.js',
    'run_migration.js',
    'fetch_game_logs.js',
    'find_rookie_ids_v2.js',
    'update_rookie_ids.js',
    'prune_retired_players.js',
    'test_suite.js',
    'test_h2h.js',
    'test_teams.js'
]);

/** Préfixes d'outils serveur, filet pour les fichiers ajoutés après coup. */
const PREFIXES_OUTILS = ['test_', 'migrate', 'migration', 'fetch_', 'seed_', 'run_'];

/** Modules de lib/ chargés par le navigateur. Les autres restent serveur. */
const LIB_PUBLIQUE = new Set(['scoring.js', 'season.js']);

/**
 * Normalise une URL en chemin relatif, ou renvoie null si le chemin sort de la
 * racine.
 *
 * Le décodage se fait AVANT la vérification : `%2e%2e%2f` doit être reconnu
 * comme `../`, pas traité comme un nom de fichier exotique.
 */
function normaliser(urlPath) {
    let brut = String(urlPath || '');
    try { brut = decodeURIComponent(brut); } catch { return null; }

    if (brut.includes('\0')) return null;

    // Séparateurs Windows ramenés à la forme URL avant analyse.
    brut = brut.replace(/\\/g, '/').replace(/^\/+/, '');

    const question = brut.indexOf('?');
    if (question >= 0) brut = brut.slice(0, question);

    if (brut === '') return '';

    const normalise = path.posix.normalize(brut);
    if (normalise === '.' || normalise === '/') return '';
    if (normalise.startsWith('../') || normalise === '..') return null;
    if (normalise.startsWith('/')) return null;

    return normalise;
}

/**
 * Ce chemin peut-il être livré ?
 *
 * Renvoie `{ ok, raison }` — la raison sert aux tests et aux journaux, jamais
 * à la réponse HTTP : dire à un visiteur pourquoi un fichier est refusé, c'est
 * lui décrire l'arborescence.
 */
function estPublic(urlPath) {
    const chemin = normaliser(urlPath);
    if (chemin === null) return { ok: false, raison: 'hors_racine' };
    if (chemin === '') return { ok: true, raison: 'index' };

    const segments = chemin.split('/');

    // Aucun segment caché : .env, .git, .vs, .codebuddy…
    if (segments.some(s => s.startsWith('.'))) return { ok: false, raison: 'cache' };

    const fichier = segments[segments.length - 1];
    const extension = path.posix.extname(fichier).toLowerCase();
    if (!EXT_PUBLIQUES.has(extension)) return { ok: false, raison: 'extension' };

    if (segments.length > 1) {
        const racine = segments[0].toLowerCase();
        if (!DOSSIERS_PUBLICS.has(racine)) return { ok: false, raison: 'dossier_prive' };
        if (racine === 'lib' && !LIB_PUBLIQUE.has(fichier)) return { ok: false, raison: 'lib_privee' };
        return { ok: true, raison: 'dossier_public' };
    }

    const nom = fichier.toLowerCase();
    if (extension === '.json') {
        return JSON_PUBLICS.has(nom) ? { ok: true, raison: 'json_public' } : { ok: false, raison: 'json_prive' };
    }
    if (extension === '.js' || extension === '.mjs') {
        if (JS_SERVEUR.has(nom)) return { ok: false, raison: 'js_serveur' };
        if (PREFIXES_OUTILS.some(p => nom.startsWith(p))) return { ok: false, raison: 'outil' };
        return { ok: true, raison: 'js_client' };
    }
    if (extension === '.txt') return { ok: false, raison: 'txt_prive' };

    return { ok: true, raison: 'fichier_public' };
}

/**
 * Garde placée AVANT express.static : ce qui n'est pas public n'atteint jamais
 * le service de fichiers.
 *
 * Les chemins refusés répondent 404 et non 403 : un 403 confirmerait que le
 * fichier existe.
 */
function creerGardeStatique({ ignorer = [] } = {}) {
    const prefixesIgnores = ['/uploads', '/socket.io', ...ignorer];

    return function gardeStatique(req, res, next) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (prefixesIgnores.some(p => req.path.startsWith(p))) return next();

        const verdict = estPublic(req.path);
        if (verdict.ok) return next();

        // Une route applicative peut porter le même chemin qu'un fichier refusé
        // (par exemple /draft) : on laisse passer ce qui n'a pas d'extension de
        // fichier, ce sont les routes, pas des fichiers.
        if (verdict.raison === 'extension' && !path.posix.extname(req.path)) return next();

        res.status(404).type('text/plain').send('Not found');
    };
}

module.exports = {
    EXT_PUBLIQUES,
    DOSSIERS_PUBLICS,
    JSON_PUBLICS,
    JS_SERVEUR,
    LIB_PUBLIQUE,
    normaliser,
    estPublic,
    creerGardeStatique
};
