/**
 * Résolution des photos de joueurs.
 *
 * Les photos ne sont PAS hébergées par nous : on pointe directement vers le CDN
 * officiel de la LNH. Aucune copie locale n'est conservée ni redistribuée.
 * Voir la note légale dans LICENSE / legal.html.
 */

/**
 * Le CDN range les photos par saison. Le numéro était figé ici (20252026) :
 * une fois la saison suivante ouverte, toutes les pages pointaient vers un
 * répertoire périmé. Il vient maintenant de lib/season.js — chargé avant ce
 * fichier dans les pages, require() sous Node. En son absence, on retombe sur
 * la photo « latest », qui n'est pas rangée par saison.
 */
const saisonModule = (typeof module !== 'undefined' && module.exports)
    ? require('./lib/season.js')
    : null;

function headshotSeason() {
    if (saisonModule) return saisonModule.currentSeasonString();
    return (typeof currentSeasonString === 'function') ? currentSeasonString() : null;
}

/** Construit l'URL CDN à partir d'un identifiant de joueur et d'une équipe. */
function buildHeadshotUrl(playerId, teamAbbrev) {
    if (!playerId) return null;
    const saison = headshotSeason();
    if (teamAbbrev && saison) {
        const abbrev = String(teamAbbrev).split(',').pop().trim();
        if (abbrev && abbrev !== 'null') {
            return `https://assets.nhle.com/mugs/nhl/${saison}/${abbrev}/${playerId}.png`;
        }
    }
    return `https://assets.web.nhl.com/mugs/nhl/latest/${playerId}.png`;
}

/**
 * Retrouve la photo d'un joueur à partir de son nom, en fouillant les jeux de
 * données déjà chargés par la page (les globales n'existent pas toutes partout,
 * d'où les gardes `typeof`).
 */
function resolveHeadshotByName(name) {
    if (!name) return null;
    const target = String(name).trim().toLowerCase();

    // 1. Statistiques courantes : contiennent souvent l'URL fournie par l'API.
    //    Quelques lignes y portent l'identifiant d'un autre joueur que celui
    //    qu'elles nomment — « Matt Savoie » y désigne un retraité — et la
    //    recherche par nom leur empruntait alors le visage. Voir
    //    FZ_IDS_ERRONES (draftkitData.js).
    const idsErrones = (typeof window !== 'undefined' && window.FZ_IDS_ERRONES) || [];
    if (typeof currentStats !== 'undefined' && currentStats && currentStats.players) {
        const hit = currentStats.players.find(p => (p.playerName || '').trim().toLowerCase() === target
            && !idsErrones.includes(p.playerId));
        if (hit) {
            if (hit.headshot && !hit.headshot.includes('/teams/')) return hit.headshot;
            const url = buildHeadshotUrl(hit.playerId, hit.teamAbbrev);
            if (url) return url;
        }
    }

    // 2. Patineurs.
    if (typeof fullPlayerData !== 'undefined' && Array.isArray(fullPlayerData)) {
        const hit = fullPlayerData.find(p => (p.skaterFullName || '').trim().toLowerCase() === target);
        if (hit) {
            const url = buildHeadshotUrl(hit.playerId, hit.teamAbbrev || hit.teamAbbrevs);
            if (url) return url;
        }
    }

    // 3. Gardiens.
    if (typeof goalieData !== 'undefined' && Array.isArray(goalieData)) {
        const hit = goalieData.find(p => (p.goalieFullName || '').trim().toLowerCase() === target);
        if (hit) {
            const url = buildHeadshotUrl(hit.playerId, hit.teamAbbrev || hit.teamAbbrevs);
            if (url) return url;
        }
    }

    return null;
}

/**
 * Purge l'ancien cache `imageList` (chemins `faces/...` désormais supprimés).
 * Sans ça, un visiteur déjà venu garderait des liens morts en localStorage.
 */
(function purgeLegacyImageCache() {
    try {
        if (localStorage.getItem('imageList')) localStorage.removeItem('imageList');
    } catch (e) {
        /* localStorage indisponible : rien à purger */
    }
})();

/* ────────────────────────────────────────────────────────────────────────
 * Export double — même motif que profanity.js : le navigateur reçoit les
 * fonctions sur window comme avant, et les tests unitaires peuvent faire un
 * require() sans navigateur. Rien d'autre ne change pour la page.
 * ──────────────────────────────────────────────────────────────────────── */
(function () {
    const api = { headshotSeason, buildHeadshotUrl, resolveHeadshotByName };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;                 // tests (CommonJS)
    } else if (typeof window !== 'undefined') {
        Object.assign(window, api);           // navigateur
    }
})();
