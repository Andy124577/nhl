/**
 * Photos de rosters LNH : différentiel quotidien et noms de clubs.
 *
 * diffRosterSnapshots produit le fil des transactions à partir de deux
 * photos successives.
 *
 * Extrait de server.js — le corps des fonctions est inchangé. Le serveur les
 * réimporte en haut de server.js ; les tests unitaires (test/unit/) les
 * chargent directement, ce qui était impossible depuis server.js : le
 * require déclenchait Express, Socket.IO, les tâches cron et le pool
 * Postgres.
 */

'use strict';

/**
 * Nom complet d'un club, pour l'inverse de getTeamAbbreviationFromName plus
 * bas dans ce fichier (nom → code). La case « équipe LNH » du roster porte le
 * même format de nom que celui utilisé partout ailleurs pour cette case —
 * classement, échanges — jamais l'abréviation seule. Recopié plutôt que
 * dérivé de specialCases (bien plus bas) : la sécurité d'une petite table
 * statique en double l'emporte ici sur l'économie d'une seule source, cette
 * route touchant au calcul du classement.
 */
const NHL_CLUB_FULLNAME = {
    ANA: 'Anaheim Ducks', BOS: 'Boston Bruins', BUF: 'Buffalo Sabres',
    CAR: 'Carolina Hurricanes', CBJ: 'Columbus Blue Jackets', CGY: 'Calgary Flames',
    CHI: 'Chicago Blackhawks', COL: 'Colorado Avalanche', DAL: 'Dallas Stars',
    DET: 'Detroit Red Wings', EDM: 'Edmonton Oilers', FLA: 'Florida Panthers',
    LAK: 'Los Angeles Kings', MIN: 'Minnesota Wild', MTL: 'Montréal Canadiens',
    NJD: 'New Jersey Devils', NSH: 'Nashville Predators', NYI: 'New York Islanders',
    NYR: 'New York Rangers', OTT: 'Ottawa Senators', PHI: 'Philadelphia Flyers',
    PIT: 'Pittsburgh Penguins', SEA: 'Seattle Kraken', SJS: 'San Jose Sharks',
    STL: 'St. Louis Blues', TBL: 'Tampa Bay Lightning', TOR: 'Toronto Maple Leafs',
    UTA: 'Utah Hockey Club', VAN: 'Vancouver Canucks', VGK: 'Vegas Golden Knights',
    WPG: 'Winnipeg Jets', WSH: 'Washington Capitals'
};

/**
 * Compare deux photos (cartes id → joueur) et en tire les mouvements.
 *
 * `allowDepartures` doit être faux dès qu'un seul club a manqué à
 * l'appel. Un échange et une signature se prouvent par une *présence*
 * (le joueur est là, sur tel club) et restent donc fiables ; un départ
 * ne se déduit que d'une *absence*, et une absence est exactement ce
 * qu'une requête ratée fabrique. Un joueur passé à un club injoignable
 * paraîtrait autrement avoir quitté la ligue. Les départs manqués
 * ressortent à la première photo complète suivante.
 */
function diffRosterSnapshots(previous, next, dateISO, allowDepartures = true) {
    const moves = [];

    Object.entries(next).forEach(([id, now]) => {
        const before = previous[id];
        if (!before) {
            moves.push({ playerId: id, type: 'signing', player: now, fromTeam: null, toTeam: now.team });
        } else if (before.team !== now.team) {
            // La carte est globale, pas par club : un joueur qui change
            // d'équipe apparaît donc ici en un seul mouvement, jamais en
            // un départ plus une signature.
            moves.push({ playerId: id, type: 'trade', player: now, fromTeam: before.team, toTeam: now.team });
        }
    });

    if (allowDepartures) {
        Object.entries(previous).forEach(([id, before]) => {
            if (!next[id]) {
                moves.push({ playerId: id, type: 'departure', player: before, fromTeam: before.team, toTeam: null });
            }
        });
    }

    return moves.map(m => ({
        // Un joueur ne bouge qu'une fois par jour : date+id+type suffit à
        // dédoublonner si une photo est reprise deux fois dans la journée.
        id: `${dateISO}-${m.playerId}-${m.type}`,
        date: dateISO,
        type: m.type,
        playerId: Number(m.playerId),
        playerName: m.player.name,
        pos: m.player.pos,
        num: m.player.num,
        headshot: m.player.headshot,
        fromTeam: m.fromTeam,
        fromTeamName: m.fromTeam ? (NHL_CLUB_FULLNAME[m.fromTeam] || m.fromTeam) : null,
        toTeam: m.toTeam,
        toTeamName: m.toTeam ? (NHL_CLUB_FULLNAME[m.toTeam] || m.toTeam) : null
    }));
}

// Helper function to get team abbreviation from full name
function getTeamAbbreviationFromName(teamName) {
    const specialCases = {
        "Florida Panthers": "FLA",
        "Calgary Flames": "CGY",
        "Montréal Canadiens": "MTL",
        "Nashville Predators": "NSH",
        "St. Louis Blues": "STL",
        "Washington Capitals": "WSH",
        "Toronto Maple Leafs": "TOR",
        "Winnipeg Jets": "WPG",
        "Utah Hockey Club": "UTA",
        "Detroit Red Wings": "DET",
        "Boston Bruins": "BOS",
        "Tampa Bay Lightning": "TBL",
        "New York Rangers": "NYR",
        "New York Islanders": "NYI",
        "New Jersey Devils": "NJD",
        "Pittsburgh Penguins": "PIT",
        "Philadelphia Flyers": "PHI",
        "Columbus Blue Jackets": "CBJ",
        "Carolina Hurricanes": "CAR",
        "Buffalo Sabres": "BUF",
        "Ottawa Senators": "OTT",
        "Edmonton Oilers": "EDM",
        "Vancouver Canucks": "VAN",
        "Seattle Kraken": "SEA",
        "Los Angeles Kings": "LAK",
        "San Jose Sharks": "SJS",
        "Anaheim Ducks": "ANA",
        "Vegas Golden Knights": "VGK",
        "Colorado Avalanche": "COL",
        "Arizona Coyotes": "ARI",
        "Minnesota Wild": "MIN",
        "Dallas Stars": "DAL",
        "Chicago Blackhawks": "CHI"
    };

    return specialCases[teamName] || teamName.split(' ')[0].substring(0, 3).toUpperCase();
}
module.exports = {
    NHL_CLUB_FULLNAME,
    diffRosterSnapshots,
    getTeamAbbreviationFromName
};
