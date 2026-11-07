/**
 * Renommer une équipe ou un pool : ce qui garde une copie de son nom.
 *
 * Dans le pool lui-même, le nom d'une équipe est la clé de `teams` et
 * poolOps.renommerEquipe le fait suivre partout (ordre de repêchage, choix,
 * duels…). Mais d'autres lignes en gardent une copie, écrite au moment des
 * faits : les échanges (`fromTeam` / `toTeam`), les annonces d'échange, les
 * relevés de rang quotidiens, les notifications et le fil d'activité, les
 * semaines tête-à-tête finalisées et les bilans hebdomadaires. Restées à
 * l'ancien nom, elles affichaient un nom qui n'existe plus — pire, une offre
 * d'échange en attente devenait invisible pour l'équipe renommée, faute d'y
 * retrouver ses membres.
 *
 * Ce module ne touche à aucune base : il dit seulement, pour une valeur JSON,
 * ce qu'elle devient. db.renameTeamInTx l'applique aux lignes du pool, dans
 * la transaction du renommage.
 */

'use strict';

/**
 * Les champs qui portent un nom d'équipe du pool. Volontairement une liste
 * fermée : un nom d'équipe peut ressembler à autre chose (« MTL », un nom de
 * joueur), et `club` ou `name` ne doivent jamais être réécrits.
 */
const CHAMPS_EQUIPE = new Set([
    'team', 'teamName', 'team1', 'team2', 'winner', 'gagnant', 'gagnants',
    'equipe', 'equipes', 'fromTeam', 'toTeam', 'equipeAuTour', 'equipePrecedente',
    'equipeDuTour', 'adversaire', 'rival'
]);

/**
 * Renvoie `{ valeur, change }` : une copie de `valeur` où l'ancien nom est
 * remplacé par le nouveau — en valeur d'un champ d'équipe (CHAMPS_EQUIPE, y
 * compris dans un tableau de noms) et en clé d'objet (classements, deltas
 * rangés par équipe). `change` dit s'il y avait quelque chose à réécrire :
 * une ligne inchangée n'est pas réécrite.
 */
function remplacerNomEquipe(valeur, ancien, nouveau) {
    let change = false;

    function parcourir(noeud, champEquipe) {
        if (typeof noeud === 'string') {
            if (champEquipe && noeud === ancien) { change = true; return nouveau; }
            return noeud;
        }
        if (Array.isArray(noeud)) return noeud.map(el => parcourir(el, champEquipe));
        if (!noeud || typeof noeud !== 'object') return noeud;

        const sortie = {};
        for (const [cle, enfant] of Object.entries(noeud)) {
            let nouvelleCle = cle;
            if (cle === ancien && !Object.prototype.hasOwnProperty.call(noeud, nouveau)) {
                nouvelleCle = nouveau;
                change = true;
            }
            sortie[nouvelleCle] = parcourir(enfant, CHAMPS_EQUIPE.has(cle));
        }
        return sortie;
    }

    const resultat = parcourir(valeur, false);
    return { valeur: change ? resultat : valeur, change };
}

/**
 * Motif LIKE qui retient les lignes JSONB où le nom apparaît comme chaîne
 * JSON (`"ancien"`). Un simple filtre grossier, pour ne lire que les lignes
 * concernées ; remplacerNomEquipe décide ensuite, champ par champ.
 */
function motifRecherche(ancien) {
    const json = JSON.stringify(String(ancien));
    return '%' + json.replace(/[\\%_]/g, c => '\\' + c) + '%';
}

/** Combien d'anciens noms un pool garde : assez pour quelques renommages de suite. */
const ANCIENS_NOMS_MAX = 5;

/**
 * Renommer un pool : la liste `anciensNoms` qu'il garde ensuite, le plus
 * récent en tête, sans doublon ni le nom actuel. Les navigateurs des membres
 * s'en servent pour remplacer l'ancien nom dans ce qu'ils ont en mémoire
 * (activePool.js) — même hors ligne au moment du renommage.
 */
function noterAncienNom(liste, ancien, nouveau) {
    const avant = Array.isArray(liste) ? liste.filter(n => typeof n === 'string') : [];
    return [ancien, ...avant]
        .filter((n, i, l) => n && n !== nouveau && l.indexOf(n) === i)
        .slice(0, ANCIENS_NOMS_MAX);
}

module.exports = { CHAMPS_EQUIPE, ANCIENS_NOMS_MAX, remplacerNomEquipe, motifRecherche, noterAncienNom };
