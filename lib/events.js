/**
 * Le vocabulaire de l'activité et des notifications.
 *
 * Deux choses vivent ici, et rien d'autre : les types d'événements qu'on sait
 * écrire, et la fabrication des clés de déduplication. Aucune écriture, aucune
 * base — c'est ce qui permet de vérifier en test qu'un réessai produit la même
 * clé, donc une seule ligne, sans monter un Postgres.
 *
 * La clé de déduplication est la pièce maîtresse. Une notification se crée
 * dans la transaction qui change l'état source ; si cette transaction est
 * rejouée (réseau incertain, double clic, redémarrage d'un travail de fond),
 * elle doit retrouver exactement la même clé. Une clé qui contiendrait
 * l'horodatage courant, ou un identifiant aléatoire, produirait une deuxième
 * ligne à chaque réessai — c'est-à-dire une deuxième alerte pour le même fait.
 *
 * Corollaire : la clé se dérive uniquement de faits stables — identifiant de
 * pool, saison, numéro de semaine, indice de choix, identifiant d'échange.
 * Jamais de `Date.now()`.
 */

'use strict';

/** Types d'activité de pool écrits en V1. */
const ACTIVITE = {
    CHOIX: 'pick',
    REPECHAGE_TERMINE: 'draft_complete',
    REPECHAGE_DEMARRE: 'draft_started',
    ANNONCE_OUVERTE: 'listing_activated',
    ANNONCE_RETIREE: 'listing_removed',
    ECHANGE_CONCLU: 'trade_completed',
    SEMAINE_FINALISEE: 'h2h_week_finalized'
};

/** Types de notification écrits en V1. */
const NOTIFICATION = {
    VOTRE_TOUR: 'turn_current',
    REPECHAGE_DEMARRE: 'draft_started',
    ECHANGE_RECU: 'trade_received',
    ECHANGE_RESULTAT: 'trade_result',
    NOUVELLE_SEMAINE: 'week_new'
};

/**
 * Durée de vie d'une alerte « c'est votre tour ».
 *
 * Une alerte de tour périmée doit cesser de paraître actionnable même si
 * personne ne l'a lue : la pastille ne doit pas réclamer indéfiniment une
 * action qui n'existe plus. Elle reste consultable dans l'historique, elle ne
 * compte simplement plus.
 */
const EXPIRATION_TOUR_MS = 24 * 60 * 60 * 1000;

/** Normalise un fragment de clé : pas d'espace, longueur bornée. */
function fragment(valeur) {
    return String(valeur == null ? '' : valeur)
        .normalize('NFKD')
        .replace(/\s+/g, '_')
        .slice(0, 60);
}

/** Assemble une clé de déduplication stable. */
function cle(...parties) {
    return parties.map(fragment).join(':');
}

/**
 * Clés d'activité. Chacune ne dépend que de faits qui ne bougent pas.
 *
 * Le choix est identifié par (pool, indice de tour) : au renversement du
 * serpentin, la même équipe choisit deux fois de suite, mais jamais sur le
 * même indice — c'est ce qui distingue « deuxième choix légitime » de
 * « requête rejouée ».
 */
const clesActivite = {
    choix: (poolId, pickIndex) => cle('pick', poolId, pickIndex),
    repechageTermine: (poolId) => cle('draft_done', poolId),
    repechageDemarre: (poolId) => cle('draft_start', poolId),
    annonceOuverte: (poolId, listingId) => cle('listing_on', poolId, listingId),
    annonceRetiree: (poolId, listingId) => cle('listing_off', poolId, listingId),
    echangeConclu: (poolId, tradeId) => cle('trade_done', poolId, tradeId),
    semaineFinalisee: (poolId, saison, semaine, revision = 1) =>
        cle('week', poolId, saison, semaine, `r${revision}`)
};

/**
 * Clés de notification. Portées par destinataire — la contrainte d'unicité de
 * la table est `(destinataire, clé)`, donc la même clé peut servir à plusieurs
 * personnes pour le même fait.
 */
const clesNotification = {
    votreTour: (poolId, pickIndex) => cle('turn', poolId, pickIndex),
    repechageDemarre: (poolId) => cle('draft_start', poolId),
    echangeRecu: (tradeId) => cle('trade_in', tradeId),
    echangeResultat: (tradeId, statut) => cle('trade_res', tradeId, statut),
    nouvelleSemaine: (poolId, saison, semaine) => cle('week_new', poolId, saison, semaine)
};

/**
 * Destination d'une notification : où elle mène quand on clique.
 *
 * Une seule fonction, côté serveur, partagée par la cloche, le bandeau, la
 * page d'accueil et le fil d'activité. Avant, chaque surface recalculait son
 * lien à sa façon, et deux d'entre elles pouvaient donc mener ailleurs pour la
 * même alerte.
 *
 * Le pool est toujours dans la destination : changer de pool doit se faire
 * AVANT de viser un élément précis, sinon l'écran cible s'ouvre sur le pool
 * précédent.
 */
function destination(notification) {
    const sujet = (notification && notification.subject) || {};
    const pool = notification && notification.poolName;

    switch (notification && notification.type) {
        case NOTIFICATION.VOTRE_TOUR:
        case NOTIFICATION.REPECHAGE_DEMARRE:
            return { page: 'draftActif.html', pool, params: {} };

        case NOTIFICATION.ECHANGE_RECU:
            return { page: 'trade.html', pool, params: { tradeId: sujet.tradeId, vue: 'recues' } };

        case NOTIFICATION.ECHANGE_RESULTAT:
            return { page: 'trade.html', pool, params: { tradeId: sujet.tradeId, vue: 'historique' } };

        case NOTIFICATION.NOUVELLE_SEMAINE:
            return { page: 'classement.html', pool, params: { onglet: 'h2h', semaine: sujet.weekNumber } };

        default:
            return { page: 'index.html', pool, params: {} };
    }
}

/** La destination sous forme d'URL relative, prête à poser dans un lien. */
function urlDestination(notification) {
    const cible = destination(notification);
    const params = new URLSearchParams();
    if (cible.pool) params.set('pool', cible.pool);
    for (const [nom, valeur] of Object.entries(cible.params || {})) {
        if (valeur !== undefined && valeur !== null && valeur !== '') params.set(nom, String(valeur));
    }
    const requete = params.toString();
    return requete ? `${cible.page}?${requete}` : cible.page;
}

module.exports = {
    ACTIVITE,
    NOTIFICATION,
    EXPIRATION_TOUR_MS,
    fragment,
    cle,
    clesActivite,
    clesNotification,
    destination,
    urlDestination
};
