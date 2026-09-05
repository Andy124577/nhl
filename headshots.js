/**
 * Résolution des photos de joueurs.
 *
 * Les photos ne sont PAS hébergées par nous : on pointe directement vers le CDN
 * officiel de la LNH. Aucune copie locale n'est conservée ni redistribuée.
 * Voir la note légale dans LICENSE / legal.html.
 */

const HEADSHOT_SEASON = '20252026';

/** Construit l'URL CDN à partir d'un identifiant de joueur et d'une équipe. */
function buildHeadshotUrl(playerId, teamAbbrev) {
    if (!playerId) return null;
    if (teamAbbrev) {
        const abbrev = String(teamAbbrev).split(',').pop().trim();
        if (abbrev && abbrev !== 'null') {
            return `https://assets.nhle.com/mugs/nhl/${HEADSHOT_SEASON}/${abbrev}/${playerId}.png`;
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
