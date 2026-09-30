/**
 * Une mémoire de lectures qui ne ressert rien que la base aurait pu changer.
 *
 * Une page ouverte sonde le serveur chaque minute, et chaque sondage relisait
 * en base ce qu'il avait lu la minute d'avant. Sur le plan gratuit de Neon —
 * 100 heures de calcul par mois, mise en veille après cinq minutes sans
 * requête —, une seule page restée ouverte gardait la base éveillée.
 *
 * Une valeur rangée ici ressert tant que :
 *   - le compteur d'écritures de ce processus (db.generationDonnees) n'a pas
 *     bougé — n'importe quelle écriture, dans n'importe quelle table, efface
 *     tout d'un coup, ce qui rend l'oubli d'une invalidation impossible ;
 *   - et que `dureeMs` n'est pas écoulée, pour ce qui change hors de ce
 *     processus (script, console Neon) et que le compteur ne voit pas.
 *
 * Le compteur est lu AVANT le calcul : une écriture qui se termine pendant
 * qu'il attend la base range la valeur sous l'ancien compteur, et elle ne
 * resservira jamais.
 *
 * Sans compteur (`generation` renvoie null) ou sans durée, rien n'est gardé :
 * c'est le comportement d'avant, celui des tests et du mode fichier.
 *
 * Chaque appelant reçoit sa propre copie : modifier ce qu'on a lu ne doit pas
 * modifier ce que lira le suivant.
 */

'use strict';

function creerMemoireLectures({ generation = () => null, dureeMs = 0, max = 500, horloge = () => Date.now() } = {}) {
    /** clé → { generation, le, valeur } — dans l'ordre d'usage, pour la borne. */
    const entrees = new Map();
    /** clé → promesse du calcul en cours, pour qu'une rafale n'en lance qu'un. */
    const enVol = new Map();

    function active() {
        const g = generation();
        return g !== null && g !== undefined && dureeMs > 0;
    }

    async function obtenir(cle, calculer) {
        if (!active()) return calculer();

        const g = generation();
        const entree = entrees.get(cle);
        if (entree && entree.generation === g && horloge() - entree.le < dureeMs) {
            entrees.delete(cle);
            entrees.set(cle, entree);
            return structuredClone(entree.valeur);
        }

        const cleVol = `${g}\u0000${cle}`;
        if (!enVol.has(cleVol)) {
            const promesse = (async () => {
                const instantane = structuredClone(await calculer());
                entrees.delete(cle);
                entrees.set(cle, { generation: g, le: horloge(), valeur: instantane });
                while (entrees.size > max) entrees.delete(entrees.keys().next().value);
                return instantane;
            })();
            enVol.set(cleVol, promesse);
            promesse.then(() => enVol.delete(cleVol), () => enVol.delete(cleVol));
        }
        // Tous les appelants, le premier compris, reçoivent une copie de
        // l'instantané rangé — jamais l'objet que lira le suivant.
        return structuredClone(await enVol.get(cleVol));
    }

    function vider() {
        entrees.clear();
    }

    return { obtenir, vider, taille: () => entrees.size, active };
}

module.exports = { creerMemoireLectures };
