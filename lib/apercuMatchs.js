/**
 * L'aperçu des matchs à venir d'une journée, pour les cartes du calendrier
 * (GET /day-preview/:date) : la fiche de chaque club (« 1-1-1 ») et les
 * meneurs que la LNH met elle-même sur sa page des pointages — buts, aides,
 * victoires, un par club.
 *
 * Tiré de /v1/score/{jour} : la LNH n'y met la fiche et les meneurs que sur
 * un match à venir. Un match commencé n'en a plus ; il n'a pas d'aperçu.
 *
 * Pur : ni réseau, ni horloge.
 */

'use strict';

const A_VENIR = new Set(['FUT', 'PRE']);
const CATEGORIES = new Set(['goals', 'assists', 'wins']);

/** `{ default: 'Aho' }` ou 'Aho' : le texte, ou ''. */
const texte = v => String((v && typeof v === 'object' ? v.default : v) || '');

/**
 * Un meneur tel que la carte l'affiche. Une catégorie inconnue ou une valeur
 * illisible ne fait pas de carte : mieux vaut une carte de moins qu'un
 * « NaN Buts ».
 */
function meneur(l) {
    if (!l || !CATEGORIES.has(l.category)) return null;
    const val = Number(l.value);
    if (l.value == null || !Number.isFinite(val)) return null;
    return {
        id: l.id ?? null,
        prenom: texte(l.firstName),
        nom: texte(l.lastName),
        photo: l.headshot || '',
        club: l.teamAbbrev || '',
        numero: l.sweaterNumber ?? null,
        pos: l.position || '',
        cat: l.category,
        val
    };
}

/**
 * Les matchs bruts d'une journée → { [id]: { away, home, meneurs } }, pour
 * les seuls matchs à venir. Les meneurs gardent l'ordre de la LNH : buts,
 * aides, victoires, le visiteur avant le receveur.
 */
function apercuDeScore(games) {
    const apercu = {};
    for (const g of Array.isArray(games) ? games : []) {
        if (!g || g.id == null || !A_VENIR.has(g.gameState)) continue;
        apercu[g.id] = {
            away: { fiche: g.awayTeam?.record || null },
            home: { fiche: g.homeTeam?.record || null },
            meneurs: (Array.isArray(g.teamLeaders) ? g.teamLeaders : []).map(meneur).filter(Boolean)
        };
    }
    return apercu;
}

module.exports = { apercuDeScore, meneur };
