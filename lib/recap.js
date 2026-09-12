/**
 * Le récapitulatif hebdomadaire : ce qu'on peut dire, et ce qu'on ne dira pas.
 *
 * Un récap est un endroit où il est très facile d'inventer. « Joueur de la
 * semaine », « plus grosse remontée », « record de tous les temps » : ces
 * phrases sonnent bien et demandent chacune une donnée précise que le produit
 * n'a pas toujours. Ce module part donc de l'inverse : chaque catégorie
 * déclare ce dont elle a besoin, et se retire d'elle-même quand ça manque.
 *
 * Aucun texte généré, aucun service de rédaction : des gabarits déterministes
 * appliqués à des résultats FINALISÉS. Les mêmes entrées donnent le même récap,
 * ce qui est la seule façon de pouvoir le régénérer sans le changer.
 *
 * Trois refus explicites :
 *
 *   - une semaine partielle ou non finalisée ne participe à aucun record. Un
 *     « meilleur score » calculé sur des feuilles à moitié arrivées serait faux
 *     et impossible à corriger sans tout refaire ;
 *   - « depuis le début du suivi » n'est pas « de tous les temps ». Une seule
 *     semaine finalisée ne fait pas une histoire ;
 *   - un écart entre deux relevés de classement n'est pas un nombre de points
 *     marqués. Il inclut les échanges et les corrections, et se nomme donc
 *     « variation du total du pool ».
 *
 * Pur : aucune base, aucune horloge implicite.
 */

'use strict';

/** Catégories que le récap sait produire. */
const CATEGORIE = {
    RESULTATS: 'resultats',
    MEILLEUR_SCORE: 'meilleur_score',
    DUEL_SERRE: 'duel_serre',
    PLUS_GROS_ECART: 'plus_gros_ecart',
    JOUEUR_SEMAINE: 'joueur_semaine',
    SERIE: 'serie',
    VARIATION_TOTAL: 'variation_total'
};

/** Arrondi à la décimale, comme partout ailleurs. */
const arrondi = (v) => Math.round((Number(v) || 0) * 10) / 10;

/**
 * Les résultats d'une semaine, présentés tels quels.
 *
 * Une égalité reste une égalité : deux meneurs partagent la victoire, et rien
 * ne désigne un vainqueur au hasard. Les scores négatifs passent aussi — ils
 * sont rares mais réels, et un tri qui les traiterait comme zéro se tromperait.
 */
function resultats(semaine) {
    const duels = (semaine && semaine.matchups) || [];
    if (duels.length === 0) return null;

    return {
        categorie: CATEGORIE.RESULTATS,
        duels: duels.map(duel => ({
            team1: duel.team1,
            team2: duel.team2,
            team1Points: arrondi(duel.team1Points),
            team2Points: arrondi(duel.team2Points),
            egalite: duel.winner === 'tie',
            gagnants: duel.winner === 'tie' ? [duel.team1, duel.team2] : [duel.winner]
        }))
    };
}

/**
 * Le meilleur score de la semaine.
 *
 * À égalité, plusieurs équipes le partagent. Désigner « la » meilleure quand
 * deux sont à égalité parfaite serait une préférence inventée.
 */
function meilleurScore(semaine) {
    const scores = pointsParEquipe(semaine);
    if (scores.length === 0) return null;

    const sommet = Math.max(...scores.map(s => s.points));
    const detenteurs = scores.filter(s => s.points === sommet);

    return {
        categorie: CATEGORIE.MEILLEUR_SCORE,
        points: arrondi(sommet),
        equipes: detenteurs.map(s => s.equipe),
        partage: detenteurs.length > 1
    };
}

/** Tous les pointages d'équipe d'une semaine, à plat. */
function pointsParEquipe(semaine) {
    const duels = (semaine && semaine.matchups) || [];
    const scores = [];
    for (const duel of duels) {
        scores.push({ equipe: duel.team1, points: Number(duel.team1Points) || 0 });
        scores.push({ equipe: duel.team2, points: Number(duel.team2Points) || 0 });
    }
    return scores;
}

/** Le duel le plus serré. Une égalité parfaite est l'écart le plus serré possible. */
function duelSerre(semaine) {
    const duels = (semaine && semaine.matchups) || [];
    if (duels.length === 0) return null;

    const avecEcart = duels.map(duel => ({
        duel,
        ecart: Math.abs((Number(duel.team1Points) || 0) - (Number(duel.team2Points) || 0))
    }));
    const minimum = Math.min(...avecEcart.map(e => e.ecart));
    const candidats = avecEcart.filter(e => e.ecart === minimum);

    return {
        categorie: CATEGORIE.DUEL_SERRE,
        ecart: arrondi(minimum),
        egalite: minimum === 0,
        duels: candidats.map(({ duel }) => ({
            team1: duel.team1, team2: duel.team2,
            team1Points: arrondi(duel.team1Points), team2Points: arrondi(duel.team2Points)
        })),
        partage: candidats.length > 1
    };
}

/** Le plus gros écart. Sans objet quand tous les duels sont nuls. */
function plusGrosEcart(semaine) {
    const duels = (semaine && semaine.matchups) || [];
    if (duels.length === 0) return null;

    const avecEcart = duels.map(duel => ({
        duel,
        ecart: Math.abs((Number(duel.team1Points) || 0) - (Number(duel.team2Points) || 0))
    }));
    const maximum = Math.max(...avecEcart.map(e => e.ecart));
    if (maximum === 0) return null;

    const candidats = avecEcart.filter(e => e.ecart === maximum);
    return {
        categorie: CATEGORIE.PLUS_GROS_ECART,
        ecart: arrondi(maximum),
        duels: candidats.map(({ duel }) => ({
            team1: duel.team1, team2: duel.team2,
            team1Points: arrondi(duel.team1Points), team2Points: arrondi(duel.team2Points),
            gagnant: duel.winner === 'tie' ? null : duel.winner
        })),
        partage: candidats.length > 1
    };
}

/**
 * Le joueur de la semaine.
 *
 * Uniquement à partir des contributions FIGÉES au moment de la finalisation.
 * Recalculer depuis les alignements du jour ferait gagner la semaine dernière
 * à un joueur acquis mardi — l'exemple exact du genre d'exploit fabriqué qu'un
 * récap ne doit pas produire. Si la semaine finalisée ne porte pas ce détail,
 * la catégorie se retire.
 */
function joueurDeLaSemaine(semaine) {
    const duels = (semaine && semaine.matchups) || [];
    const contributions = [];
    for (const duel of duels) {
        for (const joueur of [...(duel.team1Top || []), ...(duel.team2Top || [])]) {
            if (joueur && joueur.name) contributions.push(joueur);
        }
    }
    if (contributions.length === 0) return null;

    const sommet = Math.max(...contributions.map(c => Number(c.fantasyPoints) || 0));
    if (sommet <= 0) return null;

    const detenteurs = contributions.filter(c => (Number(c.fantasyPoints) || 0) === sommet);
    return {
        categorie: CATEGORIE.JOUEUR_SEMAINE,
        points: arrondi(sommet),
        joueurs: detenteurs.map(c => ({ name: c.name, equipe: c.team, matchs: c.matchs || null })),
        partage: detenteurs.length > 1
    };
}

/**
 * Séries en cours, à partir de semaines finalisées CONSÉCUTIVES.
 *
 * Deux règles annoncées plutôt que devinées : une série demande des semaines
 * qui se suivent sans trou, et une égalité INTERROMPT une série — elle n'est
 * ni une victoire ni une défaite. Un trou dans l'historique arrête le compte
 * au lieu de sauter par-dessus.
 */
function series(semainesFinalisees, { minimum = 2 } = {}) {
    const triees = [...(semainesFinalisees || [])]
        .filter(s => s && Number.isFinite(Number(s.weekNumber)))
        .sort((a, b) => Number(b.weekNumber) - Number(a.weekNumber));

    if (triees.length < minimum) return null;

    const parEquipe = new Map();
    let attendu = null;

    for (const semaine of triees) {
        const numero = Number(semaine.weekNumber);
        // Un trou arrête tout : on ne saute pas une semaine manquante.
        if (attendu !== null && numero !== attendu) break;
        attendu = numero - 1;

        for (const duel of (semaine.matchups || [])) {
            for (const equipe of [duel.team1, duel.team2]) {
                if (!parEquipe.has(equipe)) parEquipe.set(equipe, { longueur: 0, issue: null, fini: false });
                const suivi = parEquipe.get(equipe);
                if (suivi.fini) continue;

                const issue = duel.winner === 'tie' ? 'tie'
                    : duel.winner === equipe ? 'victoire' : 'defaite';

                // L'égalité interrompt : elle n'est ni gagnée ni perdue.
                if (issue === 'tie') { suivi.fini = true; continue; }
                if (suivi.issue === null) { suivi.issue = issue; suivi.longueur = 1; }
                else if (suivi.issue === issue) suivi.longueur += 1;
                else suivi.fini = true;
            }
        }
    }

    const retenues = [...parEquipe.entries()]
        .filter(([, suivi]) => suivi.issue && suivi.longueur >= minimum)
        .map(([equipe, suivi]) => ({ equipe, issue: suivi.issue, longueur: suivi.longueur }))
        .sort((a, b) => b.longueur - a.longueur || a.equipe.localeCompare(b.equipe, 'fr'));

    if (retenues.length === 0) return null;
    return { categorie: CATEGORIE.SERIE, regleEgalite: 'une égalité interrompt la série', series: retenues };
}

/**
 * La variation du total d'un pool cumulatif entre deux relevés.
 *
 * Le nom compte. Un écart entre deux relevés inclut les échanges et les
 * corrections officielles : ce ne sont PAS des points marqués en match.
 * L'appeler « points de la semaine » serait faux pour toute équipe ayant
 * échangé, et personne ne pourrait s'en apercevoir.
 *
 * Les deux relevés doivent partager saison, base de pointage et identité
 * d'équipe. Sans quoi la soustraction n'a pas de sens, et la catégorie sort.
 */
function variationDuTotal(ouverture, fermeture) {
    if (!ouverture || !fermeture) return null;
    if (ouverture.season !== fermeture.season) return null;
    if (ouverture.scoringBasis !== fermeture.scoringBasis) return null;

    const debut = new Map((ouverture.teams || []).map(t => [t.teamName, t]));
    const lignes = [];

    for (const arrivee of (fermeture.teams || [])) {
        const depart = debut.get(arrivee.teamName);
        // Une équipe absente d'un des deux relevés n'est pas comparable : son
        // rang « avant » n'existe pas, et un rang inventé fausserait tout.
        if (!depart) continue;
        lignes.push({
            teamName: arrivee.teamName,
            rangDebut: depart.rank,
            rangFin: arrivee.rank,
            mouvement: depart.rank - arrivee.rank,
            totalDebut: arrondi(depart.points),
            totalFin: arrondi(arrivee.points),
            variation: arrondi(arrivee.points - depart.points)
        });
    }

    if (lignes.length === 0) return null;

    lignes.sort((a, b) => b.mouvement - a.mouvement || a.teamName.localeCompare(b.teamName, 'fr'));
    const sommet = lignes[0].mouvement;
    const remontees = sommet > 0 ? lignes.filter(l => l.mouvement === sommet) : [];

    return {
        categorie: CATEGORIE.VARIATION_TOTAL,
        libelle: 'variation du total du pool',
        avertissement: 'Inclut les échanges et les corrections officielles : ce ne sont pas des points marqués.',
        periode: { debut: ouverture.date, fin: fermeture.date },
        lignes,
        plusGrosseRemontee: remontees.length > 0
            ? { equipes: remontees.map(l => l.teamName), places: sommet, partage: remontees.length > 1 }
            : null
    };
}

/**
 * Assemble un récap, en n'incluant que les catégories réellement soutenues.
 *
 * `categoriesOmises` dit lesquelles manquent et pourquoi : une catégorie
 * absente sans explication ressemble à un bogue, et une catégorie inventée
 * pour combler est pire que les deux.
 */
function construire({ pool, saison, semaine, mode, semainesFinalisees = [],
                      ouverture = null, fermeture = null, revision = 1, statut = 'final' }) {
    const sections = [];
    const omises = [];

    const ajouter = (categorie, valeur, raison) => {
        if (valeur) sections.push(valeur);
        else omises.push({ categorie, raison });
    };

    if (mode === 'head-to-head') {
        if (!semaine) {
            omises.push({ categorie: CATEGORIE.RESULTATS, raison: 'aucune semaine finalisée' });
        } else {
            ajouter(CATEGORIE.RESULTATS, resultats(semaine), 'aucun duel');
            ajouter(CATEGORIE.MEILLEUR_SCORE, meilleurScore(semaine), 'aucun pointage');
            ajouter(CATEGORIE.DUEL_SERRE, duelSerre(semaine), 'aucun duel');
            ajouter(CATEGORIE.PLUS_GROS_ECART, plusGrosEcart(semaine),
                'tous les duels sont nuls : il n’y a pas d’écart à annoncer');
            ajouter(CATEGORIE.JOUEUR_SEMAINE, joueurDeLaSemaine(semaine),
                'les contributions par joueur n’ont pas été figées à la finalisation');
            ajouter(CATEGORIE.SERIE, series(semainesFinalisees),
                'pas assez de semaines finalisées consécutives');
        }
    } else {
        ajouter(CATEGORIE.VARIATION_TOTAL, variationDuTotal(ouverture, fermeture),
            'pas de relevés comparables (même saison, même base de pointage)');
    }

    return {
        pool,
        saison,
        mode,
        weekNumber: semaine ? Number(semaine.weekNumber) : null,
        periode: semaine ? { debut: semaine.weekStart, fin: semaine.weekEnd } : null,
        revision,
        statut,
        // « Depuis le début du suivi » et « de tous les temps » ne sont pas la
        // même chose : une seule semaine finalisée ne fait pas une histoire.
        portee: semainesFinalisees.length >= 2 ? 'depuis_le_debut_du_suivi' : 'cette_semaine',
        semainesFinalisees: semainesFinalisees.length,
        sections,
        categoriesOmises: omises
    };
}

module.exports = {
    CATEGORIE,
    resultats,
    meilleurScore,
    pointsParEquipe,
    duelSerre,
    plusGrosEcart,
    joueurDeLaSemaine,
    series,
    variationDuTotal,
    construire
};
