/**
 * Le minuteur des choix : il réveille le serveur quand le temps d'un choix
 * est écoulé, dans un repêchage chronométré (lib/poolOps.js, LIMITE_CHOIX_MS).
 *
 * Un réveil par pool, posé sur l'échéance exacte du tour en cours. Il est
 * (ré)armé chaque fois que le pool change : le serveur diffuse chaque
 * changement, et la diffusion le lui passe (services/diffusion.js,
 * auPoolMisAJour). Un choix fait à temps remplace donc le réveil du tour joué
 * par celui du suivant. Aucune lecture périodique des pools entiers : le
 * minuteur ne coûte presque rien à la base tant qu'aucun repêchage ne tourne.
 *
 * Le réveil n'est qu'un signal : il n'écrit rien lui-même. Il appelle
 * `choisir(nom, { pickIndex })` (routes/draft.js), qui revalide tout sous le
 * verrou du pool — un choix de la dernière seconde, un deuxième réveil ou un
 * redémarrage ne peuvent pas jouer deux fois le même tour.
 *
 * Ce qui vit en mémoire se perd au redémarrage : `rattraper()` relit les
 * repêchages chronométrés en cours (un extrait filtré dans PostgreSQL,
 * poolStore.lireChoixChronometres) et réarme chacun. Le serveur l'appelle au
 * démarrage, chaque nuit, et chaque minute TANT QU'UN TOUR ATTEND
 * (`enCours()`) — pas au-delà : une lecture par minute, jour et nuit,
 * empêchait la base (Neon) de s'endormir, et son plan gratuit ne compte que
 * 100 heures de calcul par mois.
 *
 * Un réveil qui échoue (base qui se réveille, coupure brève) se retente de
 * lui-même : sans lecture de chaque minute hors repêchage, rien d'autre ne le
 * reprendrait.
 */

'use strict';

const { echeanceChoix } = require('../lib/poolOps.js');

/** Un peu après l'échéance : le réveil ne doit pas arriver avant elle. */
const MARGE_MS = 250;

/** Délai avant de retenter un réveil qui a échoué. */
const RELANCE_MS = 30 * 1000;

function creerMinuteurChoix({
    choisir,
    lireEnCours,
    logger = console,
    horloge = () => Date.now(),
    minuterie = { planifier: setTimeout, annuler: clearTimeout }
}) {
    /** nom du pool → { echeance, pickIndex, poignee } */
    const armes = new Map();

    function desarmer(nom) {
        const arme = armes.get(nom);
        if (!arme) return;
        minuterie.annuler(arme.poignee);
        armes.delete(nom);
    }

    /**
     * Pose le réveil du tour en cours, ou le retire s'il n'y a plus rien à
     * attendre. Idempotent : la même échéance ne réarme rien. Renvoie
     * l'échéance, ou null.
     */
    function armer(nom, data) {
        const echeance = data ? echeanceChoix(data) : null;
        if (echeance == null) {
            desarmer(nom);
            return null;
        }
        const pickIndex = data.currentPickIndex || 0;
        const deja = armes.get(nom);
        if (deja && deja.echeance === echeance && deja.pickIndex === pickIndex) return echeance;

        desarmer(nom);
        poser(nom, pickIndex, echeance, Math.max(0, echeance - horloge()) + MARGE_MS);
        return echeance;
    }

    function poser(nom, pickIndex, echeance, delai) {
        const poignee = minuterie.planifier(() => declencher(nom, pickIndex, echeance), delai);
        // Un réveil en attente ne doit pas, à lui seul, garder le processus en vie.
        if (poignee && typeof poignee.unref === 'function') poignee.unref();
        armes.set(nom, { echeance, pickIndex, poignee });
    }

    async function declencher(nom, pickIndex, echeance) {
        const arme = armes.get(nom);
        if (arme && arme.pickIndex === pickIndex && arme.echeance === echeance) armes.delete(nom);
        try {
            await choisir(nom, { pickIndex });
        } catch (erreur) {
            logger.error(`❌ Choix automatique impossible (${nom}) :`, erreur.message);
            // Un pool disparu (supprimé, renommé) n'a plus de tour à jouer
            // sous ce nom : le nouveau nom est armé par sa propre écriture.
            if (erreur && erreur.code === 404) return;
            // La transaction est annulée, rien n'est écrit. Le même tour est
            // retenté, sauf si un changement du pool l'a réarmé entre-temps.
            if (!armes.has(nom)) poser(nom, pickIndex, echeance, RELANCE_MS);
        }
    }

    /** Un tour chronométré attend-il son réveil ? */
    function enCours() {
        return armes.size > 0;
    }

    /** Réarme les repêchages chronométrés en cours, d'après la base. */
    async function rattraper() {
        const enCours = await lireEnCours();
        for (const [nom, extrait] of Object.entries(enCours || {})) armer(nom, extrait);
        return armes.size;
    }

    /** Retire tous les réveils (arrêt du serveur, tests). */
    function arreter() {
        for (const nom of [...armes.keys()]) desarmer(nom);
    }

    /** Ce qui est armé, `{ nom: { echeance, pickIndex } }` — pour les tests. */
    function etat() {
        const vue = {};
        for (const [nom, { echeance, pickIndex }] of armes) vue[nom] = { echeance, pickIndex };
        return vue;
    }

    return { armer, rattraper, arreter, etat, enCours };
}

module.exports = { creerMinuteurChoix, MARGE_MS, RELANCE_MS };
