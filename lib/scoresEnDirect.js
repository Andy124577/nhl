/**
 * Ce qui a changé entre deux relevés des matchs en cours, et ce qu'il faut
 * en dire aux pages ouvertes.
 *
 * L'accueil redemandait /live-games toutes les cinq secondes, par onglet :
 * tous les matchs à chaque fois, pour trouver le plus souvent la même chose,
 * à l'horloge près. Le serveur relève maintenant la LNH une fois pour tout le
 * monde et ne pousse que la différence :
 *
 *   - `tout`   : la liste des matchs a changé (un match commence ou finit) ;
 *   - `matchs` : les matchs dont le pointage, la période, l'état ou les buts
 *                ont bougé — le match entier, quelques centaines d'octets ;
 *   - `chronos`: les horloges qui ont fait autre chose que s'écouler — un
 *                arrêt de jeu, une reprise, un entracte. Une horloge qui
 *                tourne, la page la fait avancer elle-même : le serveur ne
 *                la corrige que si l'écart dépasse DERIVE_MAX_S.
 *
 * Pur : ni réseau, ni socket, ni horloge système — le temps est passé en
 * argument.
 */

'use strict';

/** Écart toléré entre l'horloge qu'affiche la page et celle de la LNH. */
const DERIVE_MAX_S = 2;

/** Tout ce qu'une page affiche d'un match, horloge exceptée. */
function signatureContenu(match) {
    if (!match) return '';
    return JSON.stringify([
        match.state, match.period, match.periodType,
        match.away && match.away.score, match.home && match.home.score,
        match.away && match.away.abbrev, match.home && match.home.abbrev,
        match.events || []
    ]);
}

function chronoDe(match) {
    const c = match && match.clock;
    if (!c) return null;
    return {
        secondes: Number.isFinite(c.secondsRemaining) ? c.secondsRemaining : null,
        tourne: typeof c.running === 'boolean' ? c.running : null,
        entracte: !!c.inIntermission,
        texte: c.timeRemaining || ''
    };
}

/**
 * Faut-il envoyer cette horloge ? `envoye` est la dernière horloge envoyée,
 * `envoyeLe` le moment de l'envoi (ms), `maintenant` celui du relevé.
 */
function chronoAEnvoyer(envoye, envoyeLe, actuel, maintenant) {
    if (!actuel) return false;
    if (!envoye) return true;
    if (envoye.tourne !== actuel.tourne || envoye.entracte !== actuel.entracte) return true;
    // Sans « running » exploitable, la page ne sait pas faire avancer
    // l'horloge : chaque changement doit partir.
    if (actuel.tourne !== true || envoye.secondes === null || actuel.secondes === null) {
        return envoye.secondes !== actuel.secondes || envoye.texte !== actuel.texte;
    }
    const attendu = envoye.secondes - (maintenant - envoyeLe) / 1000;
    return Math.abs(attendu - actuel.secondes) > DERIVE_MAX_S;
}

/**
 * Compare le relevé `matchs` à l'état `precedent` (ce qui a été envoyé), et
 * renvoie ce qu'il faut pousser, avec l'état à retenir pour la fois suivante.
 *
 * `precedent` : null, ou Map(id → { contenu, chrono, chronoLe }).
 */
function comparer(precedent, matchs, maintenant) {
    const liste = Array.isArray(matchs) ? matchs : [];
    const ids = liste.map(m => String(m.id));
    const etat = new Map();

    const listeChangee = !precedent ||
        precedent.size !== ids.length ||
        ids.some(id => !precedent.has(id));

    if (listeChangee) {
        for (const m of liste) {
            etat.set(String(m.id), { contenu: signatureContenu(m), chrono: chronoDe(m), chronoLe: maintenant });
        }
        return { tout: true, matchs: [], chronos: [], etat };
    }

    const changes = [];
    const chronos = [];
    for (const m of liste) {
        const id = String(m.id);
        const avant = precedent.get(id);
        const contenu = signatureContenu(m);
        const chrono = chronoDe(m);

        if (contenu !== avant.contenu) {
            // Le match entier part, horloge comprise : elle repart de là.
            changes.push(m);
            etat.set(id, { contenu, chrono, chronoLe: maintenant });
        } else if (chronoAEnvoyer(avant.chrono, avant.chronoLe, chrono, maintenant)) {
            chronos.push({ id: m.id, clock: m.clock });
            etat.set(id, { contenu, chrono, chronoLe: maintenant });
        } else {
            etat.set(id, avant);
        }
    }
    return { tout: false, matchs: changes, chronos, etat };
}

module.exports = { comparer, chronoAEnvoyer, signatureContenu, chronoDe, DERIVE_MAX_S };
