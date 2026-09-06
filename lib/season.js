/**
 * Saison LNH courante — une seule source de vérité.
 *
 * Le numéro de saison (20252026) vivait en dur dans une trentaine d'endroits :
 * server.js, lib/statsCache.js, headshots.js, classement.js… Il fallait le
 * changer à la main chaque automne, et tant qu'on l'oubliait l'application
 * servait les totaux de la saison précédente comme s'ils étaient ceux de
 * l'année en cours : un pool créé et repêché en septembre s'ouvrait sur un
 * classement déjà rempli et un temple de la renommée bâti sur les matchs de
 * l'an passé. Le numéro se déduit maintenant de la date, et le calendrier de
 * la LNH (mêmes champs que /schedule/:date, déjà utilisés par l'accueil)
 * corrige la déduction et dit quand la saison régulière commence et finit.
 *
 * Deux niveaux, volontairement séparés :
 *   - seasonIdForDate() / currentSeasonId() : purs, synchrones, sans réseau.
 *     C'est ce que les requêtes SQL et les URL de l'API consomment.
 *   - getSeasonWindow() : asynchrone, met en cache les dates du calendrier.
 *     C'est ce qui répond à « la saison est-elle commencée ? ».
 */

'use strict';

/**
 * Une saison porte l'année de son ouverture : 20262027 s'ouvre à l'automne
 * 2026 et se termine en juin 2027. Le 1er juillet, tout bascule sur la saison
 * suivante — c'est le jour où la LNH ouvre son marché des joueurs autonomes,
 * donc celui où « la saison passée » cesse d'être la référence courante.
 */
const SEASON_ROLLOVER_MONTH = 7;

/**
 * Dates de repli quand le calendrier de la LNH est injoignable. Volontairement
 * plus hâtives que n'importe quelle ouverture réelle (la plus hâtive de l'ère
 * moderne est le 1er octobre) : déverrouiller les statistiques quelques jours
 * trop tôt ne coûte rien — elles valent zéro tant que rien n'est joué — alors
 * que masquer des matchs réellement disputés se voit tout de suite.
 */
const FALLBACK_PRESEASON_START = '09-15';
const FALLBACK_REGULAR_START = '09-25';
const FALLBACK_REGULAR_END = '04-30';

/** Le calendrier bouge très peu : six heures de cache suffisent largement. */
const SEASON_WINDOW_TTL_MS = 6 * 60 * 60 * 1000;

const NHL_SCHEDULE_URL = 'https://api-web.nhle.com/v1/schedule';

/** 'YYYY-MM-DD' en UTC, comme mondayOfWeek() et l'accueil. */
function toISODate(date) {
    const d = (date instanceof Date) ? date : new Date(date);
    return d.toISOString().slice(0, 10);
}

/** Numéro de saison LNH d'une date donnée : 20262027 (Number). */
function seasonIdForDate(date = new Date()) {
    const iso = toISODate(date);
    const year = Number(iso.slice(0, 4));
    const month = Number(iso.slice(5, 7));
    const opening = month >= SEASON_ROLLOVER_MONTH ? year : year - 1;
    return Number(`${opening}${opening + 1}`);
}

/** '2026-27' — pour l'affichage, jamais pour une requête. */
function seasonLabel(seasonId = currentSeasonId()) {
    const s = String(seasonId);
    return `${s.slice(0, 4)}-${s.slice(6, 8)}`;
}

/**
 * Corrigé par getSeasonWindow() une fois le calendrier lu. Tant qu'il vaut
 * null, currentSeasonId() s'en tient à la règle du 1er juillet — qui donne
 * déjà la bonne réponse toute l'année sauf, éventuellement, pendant une
 * saison décalée (2020-21 s'est terminée en juillet).
 */
let resolvedSeasonId = null;

/** Numéro de la saison en cours. Synchrone : utilisable partout. */
function currentSeasonId(now = new Date()) {
    return resolvedSeasonId !== null ? resolvedSeasonId : seasonIdForDate(now);
}

/** Même chose en chaîne — la colonne `season` de player_game_logs est du texte. */
function currentSeasonString(now = new Date()) {
    return String(currentSeasonId(now));
}

/** Fenêtre approximative, servie quand la LNH ne répond pas. Voir plus haut. */
function fallbackWindow(seasonId) {
    const opening = Number(String(seasonId).slice(0, 4));
    return {
        seasonId,
        preSeasonStartDate: `${opening}-${FALLBACK_PRESEASON_START}`,
        regularSeasonStartDate: `${opening}-${FALLBACK_REGULAR_START}`,
        regularSeasonEndDate: `${opening + 1}-${FALLBACK_REGULAR_END}`,
        source: 'fallback'
    };
}

let windowCache = null; // { window, fetchedAt }

/** Vide le cache du calendrier. Utile aux tests et à un rafraîchissement forcé. */
function resetSeasonWindowCache() {
    windowCache = null;
    resolvedSeasonId = null;
}

/**
 * Dates d'ouverture et de clôture de la saison en cours, d'après le calendrier
 * de la LNH. Retombe sur fallbackWindow() si l'appel échoue ou si la réponse
 * ne porte pas les dates — jamais d'exception : un calendrier indisponible ne
 * doit pas empêcher le reste de l'application de servir.
 */
async function getSeasonWindow({ now = new Date(), fetchImpl, force = false } = {}) {
    if (!force && windowCache && (Date.now() - windowCache.fetchedAt) < SEASON_WINDOW_TTL_MS) {
        return windowCache.window;
    }

    const today = toISODate(now);
    let window = fallbackWindow(seasonIdForDate(now));

    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (doFetch) {
        try {
            const response = await doFetch(`${NHL_SCHEDULE_URL}/${today}`);
            if (response && response.ok) {
                const raw = await response.json();
                if (raw && raw.regularSeasonStartDate) {
                    window = {
                        // Le numéro déduit de l'ouverture réelle prime sur la
                        // règle du 1er juillet : c'est la LNH qui tranche.
                        seasonId: seasonIdForDate(raw.regularSeasonStartDate),
                        preSeasonStartDate: raw.preSeasonStartDate || null,
                        regularSeasonStartDate: raw.regularSeasonStartDate,
                        regularSeasonEndDate: raw.regularSeasonEndDate || null,
                        source: 'nhl'
                    };
                }
            }
        } catch (error) {
            // Repli silencieux : l'appelant reçoit une fenêtre utilisable.
        }
    }

    resolvedSeasonId = window.seasonId;
    windowCache = { window, fetchedAt: Date.now() };
    return window;
}

/**
 * 'offseason' avant le camp, 'preseason' entre le camp et le premier match,
 * 'regular' pendant la saison, 'postseason' après le dernier match du
 * calendrier régulier. Une date manquante ne bloque rien : on la traite comme
 * une borne ouverte.
 */
function seasonPhase(window, now = new Date()) {
    if (!window) return 'unknown';
    const today = toISODate(now);
    const { preSeasonStartDate, regularSeasonStartDate, regularSeasonEndDate } = window;

    if (regularSeasonEndDate && today > regularSeasonEndDate) return 'postseason';
    if (regularSeasonStartDate && today >= regularSeasonStartDate) return 'regular';
    if (preSeasonStartDate && today >= preSeasonStartDate) return 'preseason';
    return 'offseason';
}

/**
 * La saison régulière a-t-elle commencé ? Le seul test qui compte pour décider
 * si une statistique de pool peut être autre chose que zéro. Sans fenêtre, on
 * répond oui : on ne masque pas des données faute de calendrier.
 */
function seasonHasStarted(window, now = new Date()) {
    if (!window || !window.regularSeasonStartDate) return true;
    return toISODate(now) >= window.regularSeasonStartDate;
}

/* ────────────────────────────────────────────────────────────────────────
 * Export double — même motif que lib/scoring.js : le serveur fait un
 * require(), le navigateur reçoit les fonctions sur window (headshots.js et
 * classement.js s'en servent pour ne plus coder la saison en dur).
 * ──────────────────────────────────────────────────────────────────────── */
(function () {
    const api = {
        SEASON_ROLLOVER_MONTH,
        SEASON_WINDOW_TTL_MS,
        seasonIdForDate,
        seasonLabel,
        currentSeasonId,
        currentSeasonString,
        fallbackWindow,
        getSeasonWindow,
        resetSeasonWindowCache,
        seasonPhase,
        seasonHasStarted
    };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;                 // serveur + tests (CommonJS)
    } else if (typeof window !== 'undefined') {
        Object.assign(window, api);           // navigateur
    }
})();
