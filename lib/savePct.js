/**
 * Pourcentage d'arrêts d'un gardien, lu dans /v1/player/{id}/landing.
 *
 * La LNH l'écrit `savePctg` — ni `savePct`, ni `savePercentage` — et ne
 * donne jamais le nombre d'arrêts (`saves`) dans `seasonTotals` ni dans
 * `featuredStats` : seulement `shotsAgainst` et `goalsAgainst`. Lire les
 * deux mauvais noms, ou diviser des arrêts absents par les tirs, donnait 0
 * à tous les gardiens de la ligue (vérifié le 25 septembre 2026 :
 * Vasilevskiy affiché à 0.000 pour .912).
 *
 * Plusieurs lignes, c'est un gardien échangé en cours de saison : une par
 * club. Leur moyenne simple mentirait — dix tirs à Utah pèseraient autant
 * que mille à Tampa. Chaque ligne pèse donc ses tirs, ou ses parties jouées
 * quand une ligne n'a pas de tirs (vieilles saisons, ligues mineures).
 *
 * `savePctg` fait foi quand il est là, plutôt que (tirs − buts) / tirs : les
 * buts accordés de la LNH en comptent que le pourcentage ne compte pas
 * (Vasilevskiy 2025-26 : 1 483 tirs, 132 buts, mais .912 et non .911).
 *
 * Fonction pure, partagée par /current-stats et /player-career.
 */

'use strict';

function nombre(valeur) {
    return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : null;
}

/**
 * Le pourcentage d'une ou plusieurs lignes de saison, ou null quand aucune
 * ne permet de le dire — jamais 0, qui se lirait comme un gardien qui n'a
 * rien arrêté.
 */
function savePctFromSeasons(lignes) {
    const lues = [];
    for (const ligne of lignes || []) {
        if (!ligne) continue;
        const tirs = nombre(ligne.shotsAgainst);
        // Zéro tir reçu : le pourcentage n'existe pas, quoi que dise la ligne.
        if (tirs === 0) continue;

        let pct = nombre(ligne.savePctg);
        if (pct == null && tirs != null) {
            const buts = nombre(ligne.goalsAgainst);
            const arrets = nombre(ligne.saves) ?? (buts != null ? tirs - buts : null);
            if (arrets != null) pct = arrets / tirs;
        }
        if (pct != null) lues.push({ pct, tirs, pj: nombre(ligne.gamesPlayed) });
    }

    if (!lues.length) return null;
    if (lues.length === 1) return lues[0].pct;

    const parTirs = lues.every(l => l.tirs != null);
    const poids = l => (parTirs ? l.tirs : (l.pj > 0 ? l.pj : 1));
    const total = lues.reduce((somme, l) => somme + poids(l), 0);
    return lues.reduce((somme, l) => somme + l.pct * poids(l), 0) / total;
}

module.exports = { savePctFromSeasons };
