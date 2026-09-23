/**
 * Le duel tête-à-tête à mettre en avant sur l'accueil.
 *
 * L'accueil ne montrait un duel qu'avant l'ouverture de la saison, sous forme
 * de compte à rebours. En saison, rien : il fallait aller au Classement pour
 * savoir contre qui l'on jouait. La règle est maintenant, dans cet ordre :
 *
 *   1. le duel EN COURS, s'il y en a un ;
 *   2. sinon le PROCHAIN (avant-saison, ou semaine pas encore ouverte) ;
 *   3. sinon le DERNIER joué (fin de saison).
 *
 * Et à côté du duel en cours ou à venir, le résultat du précédent, quand il
 * existe : c'est souvent la première chose qu'on veut savoir le lundi.
 *
 * Pur, sans réseau : reçoit les semaines telles que /h2h/season-schedule les
 * renvoie. Chargé tel quel par le navigateur (index.html) et par les tests.
 */

'use strict';

(function () {
    const JOUEES = new Set(['completed', 'pending_finalization']);

    function duelDe(semaine, equipe) {
        return ((semaine && semaine.matchups) || [])
            .find(m => m && (m.team1 === equipe || m.team2 === equipe)) || null;
    }

    /** Le duel vu depuis son équipe : moi d'abord, l'adversaire ensuite. */
    function orienter(semaine, duel, equipe) {
        const moiEnPremier = duel.team1 === equipe;
        const mesPoints = Number(moiEnPremier ? duel.team1Points : duel.team2Points) || 0;
        const sesPoints = Number(moiEnPremier ? duel.team2Points : duel.team1Points) || 0;
        const adversaire = moiEnPremier ? duel.team2 : duel.team1;
        let issue = null;
        if (JOUEES.has(semaine.status)) {
            if (duel.winner === equipe) issue = 'victoire';
            else if (duel.winner && duel.winner !== 'tie' && duel.winner !== 'égalité') issue = 'defaite';
            else if (duel.winner) issue = 'nulle';
            else issue = mesPoints > sesPoints ? 'victoire' : mesPoints < sesPoints ? 'defaite' : 'nulle';
        }
        return {
            semaine: semaine.weekNumber,
            debut: semaine.weekStart || null,
            fin: semaine.weekLastDay || semaine.weekEnd || null,
            statut: semaine.status,
            finalise: semaine.status === 'completed',
            moi: { nom: equipe, points: mesPoints },
            adversaire: { nom: adversaire, points: sesPoints },
            issue
        };
    }

    function duelAAfficher(semaines, equipe) {
        if (!equipe || !Array.isArray(semaines)) return null;
        const miens = semaines
            .map(s => ({ s, d: duelDe(s, equipe) }))
            .filter(x => x.d)
            .sort((a, b) => (a.s.weekNumber || 0) - (b.s.weekNumber || 0));
        if (!miens.length) return null;

        const joues = miens.filter(x => JOUEES.has(x.s.status));
        const dernier = joues.length ? joues[joues.length - 1] : null;
        const enCours = miens.find(x => x.s.status === 'ongoing');
        const prochain = miens.find(x => x.s.status === 'upcoming');

        const principal = enCours || prochain || dernier;
        if (!principal) return null;

        const mode = principal === enCours ? 'encours' : principal === prochain ? 'avenir' : 'termine';
        const precedent = mode !== 'termine' && dernier && dernier.s.weekNumber < principal.s.weekNumber
            ? orienter(dernier.s, dernier.d, equipe)
            : null;

        return { mode, ...orienter(principal.s, principal.d, equipe), precedent };
    }

    const api = { duelAAfficher };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else if (typeof window !== 'undefined') window.FZDuelAccueil = api;
})();
