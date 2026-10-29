/**
 * Les notifications dont l'information est dépassée.
 *
 * Une notification raconte un fait à un moment donné. Quand l'état du pool
 * l'a rattrapée — le repêchage annoncé « commencé » est fini, le tour a été
 * joué, l'offre a reçu sa réponse, une nouvelle semaine a remplacé la
 * précédente —, la garder dans la cloche ne fait que réclamer l'attention
 * pour rien. Elle disparaît donc de la cloche, de la pastille et
 * d'« Aujourd'hui ».
 *
 * Rien n'est effacé ni réécrit : la décision se prend à la lecture, à partir
 * de l'état actuel du pool. C'est ce qui couvre aussi les notifications déjà
 * écrites avant cette règle, sans migration ni écriture de plus sur la base.
 * La rétention (db.purgeOldNotifications) et l'export Loi 25 restent
 * inchangés.
 *
 * Pur : l'état du pool se passe en argument, ce qui se vérifie en test sans
 * Postgres.
 */

'use strict';

const { NOTIFICATION } = require('./events.js');
const authz = require('./authz.js');
const { checkIfDraftComplete } = require('./draft.js');

/** 'attente', 'encours' ou 'termine' — le même découpage que l'accueil. */
function etatRepechage(data) {
    if (!data || !Array.isArray(data.draftOrder) || data.draftOrder.length === 0) return 'attente';
    let termine = false;
    try { termine = checkIfDraftComplete(data); } catch { termine = false; }
    if (termine || (Number(data.currentPickIndex) || 0) >= data.draftOrder.length) return 'termine';
    return 'encours';
}

/**
 * Cette notification est-elle dépassée ?
 *
 * `pool` : les données actuelles du pool de la notification, ou `null` si le
 * pool n'existe plus. `undefined` veut dire « état inconnu » (lecture en
 * échec, notification sans pool) : seules les règles qui n'en dépendent pas
 * s'appliquent alors — dans le doute, on garde.
 */
function estPerimee(notification, pool, { username = null, maintenant = Date.now() } = {}) {
    if (!notification) return true;
    const sujet = notification.subject || {};

    // Réglée par l'action elle-même : tour joué, offre acceptée ou refusée.
    if (notification.resolvedAt) return true;
    if (notification.expiresAt && new Date(notification.expiresAt).getTime() <= maintenant) return true;

    if (pool === undefined) return false;
    // Pool supprimé, ou quitté : plus rien de ce pool ne concerne la personne.
    if (pool === null) return true;
    if (username && !authz.equipeDe(pool, username)) return true;

    const etat = etatRepechage(pool);

    switch (notification.type) {
        // Le tour n'est plus le sien dès que le curseur a bougé.
        case NOTIFICATION.VOTRE_TOUR:
            return etat !== 'encours'
                || (Number(pool.currentPickIndex) || 0) !== Number(sujet.pickIndex);

        // « Fantazy a choisi pour vous » et « Repêchage commencé » parlent
        // d'un repêchage en cours ; une fois fini, l'équipe complète dit tout.
        case NOTIFICATION.CHOIX_AUTO:
            return etat !== 'encours';

        case NOTIFICATION.REPECHAGE_DEMARRE:
            // Le repêchage automatique est un résultat (« terminé, voyez vos
            // choix ») : il reste, jusqu'à ce qu'une nouvelle saison efface
            // ce repêchage-là.
            if (sujet.auto) return etat === 'attente';
            return etat !== 'encours';

        // Une date annoncée cesse de valoir au départ, ou si elle a changé
        // (la nouvelle date a sa propre notification) ou a été retirée.
        case NOTIFICATION.REPECHAGE_PREVU:
            return etat !== 'attente' || pool.draftScheduledAt !== sujet.date;

        // « Le repêchage prévu n'a pas démarré » : réglé dès qu'il part ou
        // qu'une nouvelle date est choisie.
        case NOTIFICATION.REPECHAGE_MANQUE:
            return etat !== 'attente' || !!pool.draftScheduledAt;

        // « Semaine N commencée » : remplacée dès que la semaine suivante
        // commence (ou qu'une nouvelle saison repart à la semaine 1).
        case NOTIFICATION.NOUVELLE_SEMAINE: {
            const courante = pool.h2hData && Number(pool.h2hData.currentWeek);
            return !!courante && courante !== Number(sujet.weekNumber);
        }

        // L'issue d'un échange reste vraie : elle se garde.
        default:
            return false;
    }
}

/**
 * Les notifications encore actuelles, dans leur ordre.
 *
 * `lirePool(nom)` rend les données du pool (ou null s'il n'existe plus) ;
 * chaque pool n'est lu qu'une fois. Une lecture en échec laisse les
 * notifications de ce pool telles quelles plutôt que de les cacher.
 */
async function filtrerActuelles(notifications, { lirePool, username = null, maintenant = Date.now() } = {}) {
    const liste = notifications || [];
    const pools = new Map();
    for (const nom of new Set(liste.map(n => n.poolName).filter(Boolean))) {
        try {
            const enveloppe = await lirePool(nom);
            pools.set(nom, enveloppe && enveloppe.data ? enveloppe.data : null);
        } catch {
            pools.set(nom, undefined);
        }
    }
    return liste.filter(n => !estPerimee(n, n.poolName ? pools.get(n.poolName) : undefined, { username, maintenant }));
}

module.exports = { etatRepechage, estPerimee, filtrerActuelles };
