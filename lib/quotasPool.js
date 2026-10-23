/**
 * Combien de joueurs par position un pool peut demander, selon sa taille.
 *
 * Chaque pool repêche dans la même réserve : 32 clubs, une trentaine de
 * gardiens partants, une vingtaine de recrues qui joueront vraiment. Le
 * formulaire laissait demander dix gardiens ou dix clubs par équipe quelle
 * que soit la taille du pool — à dix participants, cent clubs pour trente-deux
 * : le repêchage ne pouvait plus finir. Le maximum d'une position est donc ce
 * que la réserve peut fournir à chaque équipe : OFFRE ÷ participants, arrondi
 * vers le bas, sans dépasser l'ancienne borne du formulaire.
 *
 * Les valeurs par défaut (6 attaquants, 4 défenseurs, 1 gardien, 1 recrue,
 * 1 club) passent à toutes les tailles ; seuls les maximums baissent.
 *
 * Pur : chargé tel quel par le navigateur (creer-pool.html, pour griser le +)
 * et par le serveur (routes/pools.js, qui applique les mêmes bornes).
 */

'use strict';

(function () {
    /** Plafond de participants d'un pool. */
    const PARTICIPANTS_MAX = 20;

    /**
     * Joueurs « utiles » par position, d'après la trousse de repêchage
     * 2026-2027 (draftkit.json), arrondis vers le bas : 252 attaquants
     * projetés à 29 points et plus, 124 défenseurs à 19 et plus, 24 recrues
     * à 10 et plus ; un gardien partant par club (37 sont projetés à 40
     * matchs). À revoir chaque saison, surtout les recrues, dont le nombre
     * change d'une année à l'autre : test/unit/quotas-pool.test.js le
     * vérifie contre la trousse.
     */
    const OFFRE = {
        numOffensive: 240,
        numDefensive: 120,
        numGoalies: 32,
        numRookies: 24,
        numTeams: 32
    };

    /** Les bornes du formulaire avant cette règle : un petit pool les garde. */
    const BORNES = {
        numOffensive: 20,
        numDefensive: 20,
        numGoalies: 10,
        numRookies: 10,
        numTeams: 10
    };

    /** Banc du tête-à-tête, comme lib/lineup.js. */
    const BANC_MAX = 5;

    /**
     * À partir de cette taille, le banc descend à BANC_MAX_GRAND_POOL. Il
     * puise dans les mêmes attaquants, défenseurs et recrues que
     * l'alignement : cinq places de plus par équipe y videraient la réserve.
     */
    const GRAND_POOL = 18;
    const BANC_MAX_GRAND_POOL = 3;

    function participantsBornes(participants) {
        const n = parseInt(participants, 10);
        return Math.min(PARTICIPANTS_MAX, Math.max(2, Number.isFinite(n) ? n : PARTICIPANTS_MAX));
    }

    /** Le maximum de chaque position, banc compris, pour un pool de cette taille. */
    function maximumsPour(participants) {
        const n = participantsBornes(participants);
        const maximums = {};
        for (const cle of Object.keys(OFFRE)) {
            maximums[cle] = Math.min(BORNES[cle], Math.floor(OFFRE[cle] / n));
        }
        maximums.numBench = n >= GRAND_POOL ? BANC_MAX_GRAND_POOL : BANC_MAX;
        return maximums;
    }

    const api = {
        PARTICIPANTS_MAX,
        OFFRE,
        BORNES,
        BANC_MAX,
        GRAND_POOL,
        BANC_MAX_GRAND_POOL,
        maximumsPour
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else if (typeof window !== 'undefined') window.FZQuotas = api;
})();
