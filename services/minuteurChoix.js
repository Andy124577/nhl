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
 * démarrage puis chaque minute, ce qui rattrape aussi un réveil perdu sur une
 * erreur de base.
 */

'use strict';

const { echeanceChoix } = require('../lib/poolOps.js');

/** Un peu après l'échéance : le réveil ne doit pas arriver avant elle. */
const MARGE_MS = 250;

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
        const delai = Math.max(0, echeance - horloge()) + MARGE_MS;
        const poignee = minuterie.planifier(() => declencher(nom, pickIndex, echeance), delai);
        // Un réveil en attente ne doit pas, à lui seul, garder le processus en vie.
        if (poignee && typeof poignee.unref === 'function') poignee.unref();
        armes.set(nom, { echeance, pickIndex, poignee });
        return echeance;
    }

    async function declencher(nom, pickIndex, echeance) {
        const arme = armes.get(nom);
        if (arme && arme.pickIndex === pickIndex && arme.echeance === echeance) armes.delete(nom);
        try {
            await choisir(nom, { pickIndex });
        } catch (erreur) {
            // La transaction est annulée, rien n'est écrit : le prochain
            // rattrapage, dans la minute, réarme ce tour.
            logger.error(`❌ Choix automatique impossible (${nom}) :`, erreur.message);
        }
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

    return { armer, rattraper, arreter, etat };
}

module.exports = { creerMinuteurChoix, MARGE_MS };
