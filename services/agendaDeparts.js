/**
 * L'agenda des départs de repêchage prévus, tenu en mémoire.
 *
 * La passe de chaque minute (server.js) relisait les départs prévus dans
 * PostgreSQL à chaque minute, jour et nuit. Sur le plan gratuit de Neon, le
 * calcul s'endort après cinq minutes sans requête et le mois n'en compte que
 * 100 heures : une requête par minute le gardait éveillé en permanence, et le
 * quota tombait vers le milieu du mois — le site avec lui.
 *
 * L'agenda dit seulement à la passe s'il y a lieu de regarder la base. Le
 * départ lui-même se relit et se revalide sous le verrou du pool
 * (routes/pools.js, demarrerRepechagesPrevus) : un agenda en retard sur la
 * base coûte au pire une lecture pour rien, jamais un repêchage de trop.
 *
 * Il se tient à jour de trois façons :
 *   - chaque écriture de pool lui est passée (crochet auPoolMisAJour) — la
 *     création, la date, le départ, la nouvelle saison et le renommage y
 *     passent tous ;
 *   - il se recharge depuis la base au démarrage, après chaque passe qui a
 *     trouvé un départ échu, et chaque nuit, ce qui rattrape une
 *     écriture faite hors du serveur (script, console SQL) ou un pool
 *     supprimé ;
 *   - un départ en échec reste dans l'agenda, et la passe suivante le retente.
 */

'use strict';

const poolOps = require('../lib/poolOps.js');

/** L'instant prévu d'un pool qui attend encore son départ, ou null. */
function instantPrevu(data) {
    if (!data || data.instant === true || poolOps.repechageCommence(data)) return null;
    const instant = Date.parse(data.draftScheduledAt);
    return Number.isFinite(instant) ? instant : null;
}

function creerAgendaDeparts({ lireDepartsPrevus }) {
    /** nom du pool → instant prévu (ms) */
    const prevus = new Map();

    /** Écritures notées pendant un rechargement : elles priment sur la lecture. */
    let notesPendantLecture = null;
    let rechargementEnCours = null;

    function appliquer(nom, data) {
        const instant = instantPrevu(data);
        if (instant === null) prevus.delete(nom);
        else prevus.set(nom, instant);
    }

    /** Un pool vient de changer : son état validé fait foi. */
    function noter(nom, data) {
        appliquer(nom, data);
        if (notesPendantLecture) notesPendantLecture.set(nom, data);
    }

    /**
     * Remplace l'agenda par ce que dit la base.
     *
     * Une écriture validée pendant la lecture peut ne pas y figurer : elle
     * est rejouée par-dessus, sinon un départ fixé à ce moment-là
     * disparaîtrait de l'agenda jusqu'au rechargement suivant.
     */
    function recharger() {
        if (rechargementEnCours) return rechargementEnCours;
        notesPendantLecture = new Map();
        rechargementEnCours = (async () => {
            try {
                const lus = await lireDepartsPrevus();
                const pendant = notesPendantLecture;
                prevus.clear();
                for (const [nom, extrait] of Object.entries(lus || {})) appliquer(nom, extrait);
                for (const [nom, data] of pendant) appliquer(nom, data);
                return prevus.size;
            } finally {
                notesPendantLecture = null;
                rechargementEnCours = null;
            }
        })();
        return rechargementEnCours;
    }

    /** Un départ connu est-il arrivé à son heure ? */
    function echu(maintenant = Date.now()) {
        for (const instant of prevus.values()) {
            if (instant <= maintenant) return true;
        }
        return false;
    }

    /** `{ nom: instant }` — pour les tests et les journaux. */
    function etat() {
        return Object.fromEntries(prevus);
    }

    return { noter, recharger, echu, etat };
}

module.exports = { creerAgendaDeparts, instantPrevu };
