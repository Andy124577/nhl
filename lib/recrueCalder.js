'use strict';

/**
 * Recrue au sens du trophée Calder, depuis la fiche /landing de la LNH.
 *
 * Trois règles, pour la saison `saisonId` (ex. 20262027) :
 *   1. pas plus de 25 matchs dans une même saison précédente ;
 *   2. pas 6 matchs ou plus dans chacune de deux saisons précédentes ;
 *   3. moins de 26 ans au 15 septembre de la saison.
 *
 * Seuls les matchs de saison régulière de la LNH comptent. Le règlement parle
 * aussi des « ligues professionnelles majeures », mais la LNH ne compte pas
 * la KHL ni la SHL en pratique (Panarin, Michkov ont été recrues après des
 * saisons complètes en Europe) : les compter écarterait de vraies recrues.
 *
 * La fiche est déjà lue à chaque relevé des statistiques
 * (fetchCurrentStatsForPlayer) : le calcul ne coûte aucun appel de plus.
 */
const MAX_MATCHS_UNE_SAISON = 25;
const SEUIL_SAISON_COMPTEE = 6;
const AGE_LIMITE = 26;

/** Matchs de saison régulière de la LNH par saison, un club échangé additionné. */
function matchsLNHParSaison(seasonTotals) {
    const parSaison = new Map();
    for (const s of seasonTotals || []) {
        if (Number(s.gameTypeId) !== 2 || s.leagueAbbrev !== 'NHL') continue;
        const saison = Number(s.season);
        parSaison.set(saison, (parSaison.get(saison) || 0) + (Number(s.gamesPlayed) || 0));
    }
    return parSaison;
}

/** Vrai si le joueur a 26 ans ou plus au 15 septembre de la saison. */
function tropVieux(birthDate, saisonId) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birthDate || ''));
    if (!m) return false; // âge inconnu : les règles de matchs décident seules
    const anneeDebut = Math.floor(Number(saisonId) / 10000);
    // 26e anniversaire au plus tard le 15 septembre : plus admissible.
    const anniversaire = `${Number(m[1]) + AGE_LIMITE}-${m[2]}-${m[3]}`;
    return anniversaire <= `${anneeDebut}-09-15`;
}

function estRecrueCalder(fiche, saisonId) {
    if (!fiche || !saisonId) return false;
    const saison = Number(saisonId);
    let saisonsComptees = 0;
    for (const [s, matchs] of matchsLNHParSaison(fiche.seasonTotals)) {
        if (s >= saison) continue;
        if (matchs > MAX_MATCHS_UNE_SAISON) return false;
        if (matchs >= SEUIL_SAISON_COMPTEE) saisonsComptees += 1;
    }
    if (saisonsComptees >= 2) return false;
    return !tropVieux(fiche.birthDate, saison);
}

module.exports = { estRecrueCalder, matchsLNHParSaison };
