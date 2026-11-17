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

    /**
     * Le côté d'une équipe dans la carte Versus : points de la semaine, buts,
     * aides et matchs joués de ses joueurs, plus ce soir.
     *
     *   joueurs : le détail de /h2h/current-week-scores (team1Players…), qui
     *             ne compte que les feuilles déjà en base ;
     *   soir    : les lignes de /tonight-boxscores de cette équipe, chacune
     *             avec `pts` (au barème du tête-à-tête) et `enCours` (match
     *             pas encore fini).
     *
     * Un match en cours n'est jamais en base : il s'ajoute au total. Un match
     * fini y entre dans le quart d'heure (collecte des soirs de match) ; il
     * n'est donc compté que dans « ce soir », pas deux fois dans le total.
     */
    function coteVersus(points, joueurs, soir) {
        const base = { buts: 0, aides: 0, pj: 0 };
        (joueurs || []).forEach(j => {
            base.buts += Number(j.goals) || 0;
            base.aides += Number(j.assists) || 0;
            base.pj += Number(j.matchs) || 0;
        });
        let enCours = 0;
        let ceSoir = 0;
        (soir || []).forEach(l => {
            const pts = Number(l.pts) || 0;
            ceSoir += pts;
            if (!l.enCours) return;
            enCours += pts;
            base.buts += Number(l.goals) || 0;
            base.aides += Number(l.assists) || 0;
            base.pj += 1;
        });
        const arrondi = n => Math.round(n * 10) / 10;
        return { points: arrondi((Number(points) || 0) + enCours), ceSoir: arrondi(ceSoir), ...base };
    }

    /* ---- Chances de gagner ----
       Une projection simple, refaite à chaque redessin de la carte :

         points d'aujourd'hui + ce que chaque joueur devrait encore marquer
         = son rythme par match × ses matchs restants cette semaine.

       Le rythme vient de ses statistiques de saison, au barème du
       tête-à-tête ; tôt dans la saison, il est tiré vers la moyenne de sa
       position (quelques matchs ne disent pas grand-chose). Un blessé absent
       ne joue plus ; « au jour le jour » compte à moitié. Un gardien ne joue
       que sa part des matchs de son club. Un match en cours ne compte que
       pour le temps qu'il reste.

       L'écart final suit à peu près une courbe en cloche autour de l'écart
       projeté ; la chance de gagner est la part de la courbe du bon côté. */

    const TIRS_PAR_MATCH = { F: 2.3, D: 1.7 };   // ×0,5 pt ; la saison n'a pas les tirs
    const RYTHME_POSITION = { F: 2.6, D: 2.0, G: 4.5 };
    const MATCHS_DE_POIDS = 8;                    // le poids de la moyenne de position

    /** Points attendus par match de son club, et leur variance. */
    function rythmeJoueur(stats, matchsDuClub) {
        if (!stats) return { moyenne: 0, variance: 0 };
        const pj = Number(stats.gamesPlayed) || 0;
        if (stats.position === 'G') {
            const sv = Number(stats.savePct) > 0.5 ? Number(stats.savePct) : 0.9;
            const tirs = 27;
            const parDepart = pj
                ? 5 * (stats.wins || 0) / pj + 3 * (stats.shutouts || 0) / pj + 0.2 * tirs * sv - tirs * (1 - sv)
                : RYTHME_POSITION.G;
            const parDepartLisse = (pj * parDepart + MATCHS_DE_POIDS * RYTHME_POSITION.G) / (pj + MATCHS_DE_POIDS);
            const club = Number(matchsDuClub) || 0;
            const part = club > 0 ? Math.min(0.9, Math.max(0.15, pj / club)) : 0.55;
            const moyenne = part * parDepartLisse;
            // Un départ varie d'environ 6 points (la victoire, les buts accordés).
            const variance = part * (36 + parDepartLisse * parDepartLisse) - moyenne * moyenne;
            return { moyenne, variance: Math.max(variance, 1) };
        }
        const pos = stats.position === 'D' ? 'D' : 'F';
        const parMatch = pj
            ? (3 * (stats.goals || 0) + 2 * (stats.assists || 0)) / pj * 1.1 + 0.5 * TIRS_PAR_MATCH[pos]
            : RYTHME_POSITION[pos];
        const moyenne = (pj * parMatch + MATCHS_DE_POIDS * RYTHME_POSITION[pos]) / (pj + MATCHS_DE_POIDS);
        // Un match varie beaucoup (0 à 15 points) ; les soirées d'une même équipe
        // se ressemblent un peu, d'où une variance plus large que le rythme seul.
        return { moyenne, variance: 3.5 * moyenne + 1 };
    }

    /** Ce qui compte d'une blessure : 0 (absent), 0,5 (au jour le jour) ou 1. */
    function disponibilite(blessure) {
        if (!blessure) return 1;
        const statut = String(blessure.status || '').toLowerCase();
        if (statut.includes('day')) return 0.5;
        return 0;
    }

    /** La part d'un match qu'il reste à jouer (1 avant, 0 fini). */
    function partRestante(match) {
        if (!match) return 0;
        if (['FUT', 'PRE'].includes(match.state)) return 1;
        if (!['LIVE', 'CRIT'].includes(match.state)) return 0;
        const periode = Number(match.period) || 1;
        if (periode > 3) return 0.05;
        const [m, s] = String((match.clock && match.clock.timeRemaining) || '20:00').split(':').map(Number);
        const reste = (match.clock && match.clock.inIntermission ? 0 : (m || 0) + (s || 0) / 60) + (3 - periode) * 20;
        return Math.max(0.03, Math.min(1, reste / 60));
    }

    /** La fonction de répartition de la loi normale (approximation d'Abramowitz et Stegun). */
    function phi(z) {
        const t = 1 / (1 + 0.2316419 * Math.abs(z));
        const d = 0.3989423 * Math.exp(-z * z / 2);
        const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
        return z > 0 ? 1 - p : p;
    }

    /**
     * Les chances de chaque côté, en pourcentages entiers qui font 100.
     *   cote : { points, joueurs: [{ moyenne, variance, matchs }] }
     *          `matchs` : les matchs restants, déjà pondérés (blessure,
     *          match en cours).
     * Renvoie aussi les points projetés et les matchs restants de chacun.
     */
    function chancesVersus(moi, lui) {
        const projeter = cote => (cote.joueurs || []).reduce((acc, j) => {
            const n = Number(j.matchs) || 0;
            acc.attendu += n * (j.moyenne || 0);
            acc.variance += n * (j.variance || 0);
            acc.matchs += n;
            return acc;
        }, { attendu: 0, variance: 0, matchs: 0 });
        const a = projeter(moi);
        const b = projeter(lui);
        const ecart = (Number(moi.points) || 0) + a.attendu - (Number(lui.points) || 0) - b.attendu;
        const variance = a.variance + b.variance;
        let p;
        if (variance < 0.5) p = ecart > 0 ? 1 : ecart < 0 ? 0 : 0.5;  // plus rien à jouer
        else p = Math.min(0.99, Math.max(0.01, phi(ecart / Math.sqrt(variance))));
        const pct = Math.round(p * 100);
        return {
            moi: pct, lui: 100 - pct,
            projetes: { moi: (Number(moi.points) || 0) + a.attendu, lui: (Number(lui.points) || 0) + b.attendu },
            matchsRestants: { moi: a.matchs, lui: b.matchs }
        };
    }

    const api = { duelAAfficher, coteVersus, rythmeJoueur, disponibilite, partRestante, chancesVersus };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else if (typeof window !== 'undefined') window.FZDuelAccueil = api;
})();
