/**
 * Échanges : présence d'un joueur, transfert entre équipes, annulation.
 *
 * Manipulations de rosters uniquement — la persistance et les routes
 * restent dans server.js.
 *
 * Extrait de server.js — le corps des fonctions est inchangé. Le serveur les
 * réimporte en haut de server.js ; les tests unitaires (test/unit/) les
 * chargent directement, ce qui était impossible depuis server.js : le
 * require déclenchait Express, Socket.IO, les tâches cron et le pool
 * Postgres.
 */

'use strict';

// Helper: Check if team has a specific player
function teamHasPlayer(team, item) {
    const arrays = {
        'offensive': 'offensive',
        'defensive': 'defensive',
        'goalie': 'goalie',
        'rookie': 'rookie',
        'team': 'teams'
    };

    const arrayName = arrays[item.type];
    if (!team[arrayName]) return false;

    const index = team[arrayName].findIndex(p => {
        const name = p.skaterFullName || p.goalieFullName || p.teamFullName || p;
        return name === item.name;
    });

    return index !== -1;
}

// Helper: Remove item from team
function removeFromTeam(team, item) {
    const arrays = {
        'offensive': 'offensive',
        'defensive': 'defensive',
        'goalie': 'goalie',
        'rookie': 'rookie',
        'team': 'teams'
    };

    const arrayName = arrays[item.type];
    if (!team[arrayName]) return;

    const index = team[arrayName].findIndex(p => {
        const name = p.skaterFullName || p.goalieFullName || p.teamFullName || p;
        return name === item.name;
    });

    if (index !== -1) {
        team[arrayName].splice(index, 1);
    }
}

// Helper: Add item to team
function addToTeam(team, item) {
    const arrays = {
        'offensive': 'offensive',
        'defensive': 'defensive',
        'goalie': 'goalie',
        'rookie': 'rookie',
        'team': 'teams'
    };

    const arrayName = arrays[item.type];
    if (!team[arrayName]) {
        team[arrayName] = [];
    }

    // Add the full player object to preserve stats
    if (item.playerData) {
        team[arrayName].push(item.playerData);
    } else {
        // Fallback for simple strings (team names, etc.)
        team[arrayName].push(item.name);
    }
}

// Helper function to get position label for error messages
function getPositionLabel(type) {
    const labels = {
        'offensive': 'Attaquant',
        'defensive': 'Défenseur',
        'goalie': 'Gardien',
        'rookie': 'Rookie',
        'team': 'Équipe NHL'
    };
    return labels[type] || type;
}
// ───────────────────────── Un échange par mois ─────────────────────────
//
// Chaque équipe conclut au plus un échange par mois civil, à l'heure du pool
// (lib/dates.js). Les deux équipes d'un échange conclu ont joué le leur.
// `pool.echangesConclus` garde, par équipe, l'instant de son dernier échange
// conclu : il suit un renommage d'équipe (poolOps.renommerEquipe), ce que ne
// ferait pas un décompte par nom dans la table des échanges.

const { journeeLocale } = require('./dates.js');

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
    'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Le mois civil d'un instant, `AAAA-MM`, dans le fuseau du pool. */
function moisDe(instant) {
    const jour = journeeLocale(instant);
    return jour ? jour.slice(0, 7) : null;
}

/** « 1er octobre » : le jour où l'équipe pourra échanger à nouveau. */
function premierDuMoisSuivant(maintenant) {
    const [, mois] = moisDe(maintenant).split('-').map(Number);
    return `1er ${MOIS[mois % 12]}`;
}

/** L'équipe a-t-elle déjà conclu un échange ce mois-ci ? */
function aEchangeCeMois(pool, nomEquipe, maintenant = Date.now()) {
    const dernier = pool && pool.echangesConclus && pool.echangesConclus[nomEquipe];
    return !!dernier && moisDe(dernier) === moisDe(maintenant);
}

/**
 * Pourquoi cet échange ne peut pas se conclure ce mois-ci, ou null.
 * `moi` : l'équipe de la personne qui agit — le message lui parle d'elle.
 */
function refusEchangeDuMois(pool, { fromTeam, toTeam, moi = null, maintenant = Date.now() }) {
    const prochain = premierDuMoisSuivant(maintenant);
    for (const equipe of [moi, fromTeam, toTeam].filter((e, i, l) => e && l.indexOf(e) === i)) {
        if (!aEchangeCeMois(pool, equipe, maintenant)) continue;
        return equipe === moi
            ? `Votre équipe a déjà conclu son échange du mois. Prochain échange possible le ${prochain}.`
            : `${equipe} a déjà conclu son échange du mois. Prochain échange possible le ${prochain}.`;
    }
    return null;
}

/** Inscrit l'échange conclu au compte du mois des deux équipes. */
function noterEchangeConclu(pool, { fromTeam, toTeam, maintenant = Date.now() }) {
    const quand = new Date(maintenant).toISOString();
    pool.echangesConclus = { ...(pool.echangesConclus || {}), [fromTeam]: quand, [toTeam]: quand };
}

module.exports = {
    teamHasPlayer,
    removeFromTeam,
    addToTeam,
    getPositionLabel,
    moisDe,
    aEchangeCeMois,
    refusEchangeDuMois,
    noterEchangeConclu
};
