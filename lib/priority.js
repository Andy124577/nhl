/**
 * « Qu'est-ce qui mérite mon attention maintenant ? »
 *
 * Une seule fonction répond, et les deux dispositions de l'accueil — bureau et
 * téléphone — lisent sa réponse. Avant, chacune choisissait son élément
 * principal séparément : deux écrans côte à côte pouvaient donc annoncer deux
 * priorités différentes au même compte, à la même seconde.
 *
 * L'ordre est déterminé par l'URGENCE, pas par l'ordre dans lequel les
 * fonctionnalités ont été écrites :
 *
 *   1. votre tour de repêchage — quelqu'un attend, tout de suite ;
 *   2. un repêchage en cours, ou un départ confirmé par le serveur ;
 *   3. une offre d'échange qui attend votre réponse ;
 *   4. votre duel de la semaine, en priorité s'il bouge en direct ;
 *   5. un résultat qui vient d'être inscrit, ou un mouvement de rang fiable ;
 *   6. les matchs de vos joueurs, et le reste.
 *
 * À urgence égale : l'échéance réelle la plus proche, puis le pool actif, puis
 * un ordre stable (moment, identifiant). « Stable » n'est pas un détail : sans
 * lui, deux chargements de la même page pourraient inverser deux éléments et
 * faire bouger le bouton sous le doigt.
 *
 * Ce que ce module ne fait pas : inventer une échéance. Un élément sans
 * échéance réelle n'en reçoit pas une — il est simplement classé après ceux
 * qui en ont une.
 *
 * Pur : aucune requête, aucune horloge implicite. `maintenant` est un argument.
 */

'use strict';

/** Les classes d'urgence, de la plus pressante à la moins pressante. */
const URGENCE = {
    VOTRE_TOUR: 1,
    REPECHAGE: 2,
    ECHANGE: 3,
    DUEL: 4,
    RESULTAT: 5,
    INFORMATION: 6
};

/** Une seule vedette, et au plus trois lignes secondaires. */
const MAX_SECONDAIRES = 3;

/**
 * Compare deux éléments : l'urgence d'abord, puis l'échéance, puis le pool
 * actif, puis un ordre stable.
 */
function comparer(a, b, { poolActif = null } = {}) {
    if (a.urgence !== b.urgence) return a.urgence - b.urgence;

    // Une échéance réelle passe devant l'absence d'échéance. Jamais l'inverse,
    // et jamais d'échéance fabriquée pour combler.
    const echeanceA = Number.isFinite(a.echeance) ? a.echeance : null;
    const echeanceB = Number.isFinite(b.echeance) ? b.echeance : null;
    if (echeanceA !== echeanceB) {
        if (echeanceA === null) return 1;
        if (echeanceB === null) return -1;
        return echeanceA - echeanceB;
    }

    if (poolActif) {
        const actifA = a.pool === poolActif ? 0 : 1;
        const actifB = b.pool === poolActif ? 0 : 1;
        if (actifA !== actifB) return actifA - actifB;
    }

    const momentA = Number.isFinite(a.moment) ? a.moment : 0;
    const momentB = Number.isFinite(b.moment) ? b.moment : 0;
    if (momentA !== momentB) return momentB - momentA; // le plus récent d'abord

    return String(a.id).localeCompare(String(b.id));
}

/**
 * Classe les éléments et désigne la vedette.
 *
 * `vedettePrecedente` garde l'élément principal stable pendant qu'on
 * l'utilise : il ne cède la place que si un élément d'urgence STRICTEMENT
 * supérieure arrive. Sans cela, un rafraîchissement en arrière-plan peut
 * remplacer le bouton au moment exact où le doigt descend dessus.
 */
function classer(elements, { poolActif = null, vedettePrecedente = null, maxSecondaires = MAX_SECONDAIRES } = {}) {
    const tries = [...(elements || [])].filter(Boolean).sort((a, b) => comparer(a, b, { poolActif }));

    if (tries.length === 0) {
        return { vedette: null, secondaires: [], total: 0 };
    }

    let vedette = tries[0];

    if (vedettePrecedente) {
        const encorePresente = tries.find(el => el.id === vedettePrecedente);
        if (encorePresente && encorePresente !== vedette && vedette.urgence >= encorePresente.urgence) {
            vedette = encorePresente;
        }
    }

    // Une même chose ne peut pas être à la fois la vedette et une ligne en
    // dessous : l'afficher deux fois donne l'impression de deux actions.
    const secondaires = tries.filter(el => el !== vedette).slice(0, maxSecondaires);

    return { vedette, secondaires, total: tries.length };
}

/**
 * Fabrique un élément de priorité.
 *
 * `echeance` n'est renseignée que quand une vraie échéance existe : un compte
 * à rebours de salon tenu par le serveur, une semaine qui se termine. Le tour
 * de repêchage n'en a pas — Fantazy ne chronomètre personne — et il n'en
 * reçoit donc pas.
 */
function element({ id, urgence, pool = null, titre, detail = '', action = null, href = null,
                   echeance = null, moment = null, donnees = null, etat = 'ok' }) {
    return {
        id: String(id),
        urgence,
        pool,
        titre,
        detail,
        action,
        href,
        echeance: Number.isFinite(echeance) ? echeance : null,
        moment: Number.isFinite(moment) ? moment : null,
        donnees,
        // `etat` porte la franchise de l'élément : `ok`, `indisponible`,
        // `perime`. Vide et en panne ne sont pas la même chose.
        etat
    };
}

/**
 * L'accueil quand il n'y a rien à faire.
 *
 * Chaque cas a son message, parce qu'ils demandent des gestes différents : sans
 * pool, on en rejoint un ; en attente, on patiente ; hors saison, on prépare.
 * Un « rien à afficher » unique laisserait chacun deviner lequel s'applique.
 */
function etatVide({ aDesPools, enAttente, horsSaison }) {
    if (!aDesPools) {
        return {
            cas: 'aucun_pool',
            titre: 'Commencez par un pool',
            detail: 'Rejoignez un repêchage instantané, ou créez votre propre pool.',
            actions: [
                { titre: 'Repêchage instantané', href: 'repechage.html' },
                { titre: 'Créer un pool', href: 'creer-pool.html' },
                { titre: 'Rejoindre un pool', href: 'rejoindre-pool.html' }
            ]
        };
    }
    if (enAttente) {
        return {
            cas: 'salon_attente',
            titre: 'Votre repêchage attend des participants',
            detail: "Le repêchage démarre dès que le salon est complet.",
            actions: [{ titre: 'Voir le salon', href: 'repechage.html' }]
        };
    }
    if (horsSaison) {
        return {
            cas: 'hors_saison',
            titre: 'La saison est terminée',
            detail: 'Préparez votre pool pour la prochaine, ou revoyez la dernière.',
            actions: [{ titre: 'Voir le classement', href: 'classement.html' }]
        };
    }
    return {
        cas: 'rien_a_faire',
        titre: 'Rien ne vous attend',
        detail: 'Tout est à jour. Vos joueurs jouent, vous pouvez souffler.',
        actions: [{ titre: 'Voir le classement', href: 'classement.html' }]
    };
}

module.exports = { URGENCE, MAX_SECONDAIRES, comparer, classer, element, etatVide };
