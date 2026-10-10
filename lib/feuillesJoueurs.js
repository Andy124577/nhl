/**
 * Enregistrement des feuilles de match d'un joueur (player_game_logs).
 *
 * Deux chemins écrivent cette table : la collecte de la nuit
 * (fetch_game_logs.js) et la mise à jour des soirs de match (server.js). Tous
 * deux relisent la saison COMPLÈTE d'un joueur à la LNH, et réécrivaient
 * chaque match, un INSERT … ON CONFLICT DO UPDATE par match, même identique :
 * 6,7 millions de mises à jour sur 40 000 lignes, et la base de Neon (plan
 * gratuit, 100 heures de calcul par mois) éveillée le temps de ces milliers
 * d'allers-retours.
 *
 * Ici, une seule requête par joueur, et un match n'est réécrit que si une
 * des colonnes mises à jour a changé (WHERE … IS DISTINCT FROM). Une
 * correction de la LNH, même d'un seul tir, est donc toujours enregistrée ;
 * un match inchangé ne coûte plus rien, et ne compte plus comme une écriture
 * pour la mémoire des lectures (db.ecritureSansEffet).
 *
 * `last_updated` devient « dernière modification » plutôt que « dernière
 * vérification ».
 */

'use strict';

/** Les 29 colonnes, dans l'ordre des valeurs de chaque ligne. */
const COLONNES = [
    'player_id', 'player_name', 'position', 'season', 'game_id', 'game_date',
    'home_road_flag', 'opponent_abbrev', 'team_abbrev', 'game_result',
    'goals', 'assists', 'points', 'plus_minus', 'pim', 'shots',
    'power_play_goals', 'power_play_points', 'shorthanded_goals', 'shorthanded_points',
    'game_winning_goals', 'toi',
    'games_started', 'decision', 'shots_against', 'goals_against', 'saves', 'save_pct', 'shutouts'
];

const INDEX_GAME_ID = COLONNES.indexOf('game_id');

/**
 * Un match présent deux fois dans la même requête ferait échouer tout
 * l'ON CONFLICT (« cannot affect row a second time ») : le dernier gagne.
 */
function sansDoublons(lignes) {
    const parMatch = new Map();
    for (const ligne of lignes) parMatch.set(String(ligne[INDEX_GAME_ID]), ligne);
    return [...parMatch.values()];
}

/**
 * La requête d'enregistrement d'un lot de lignes.
 *
 * `lignes` : tableaux de 29 valeurs, dans l'ordre de COLONNES.
 * `colonnesMaj` : ce qu'un match déjà connu reçoit de la LNH. Chaque chemin
 * garde sa liste : un chemin qui ne calcule pas une colonne ne doit pas
 * écraser ce que l'autre y a mis, sinon les deux la réécriraient à tour de
 * rôle, chaque nuit.
 *
 * Renvoie null s'il n'y a rien à écrire.
 */
function requeteFeuilles(lignes, colonnesMaj) {
    const uniques = sansDoublons(lignes || []);
    if (uniques.length === 0) return null;

    for (const colonne of colonnesMaj) {
        if (!COLONNES.includes(colonne) || colonne === 'player_id' || colonne === 'game_id') {
            throw new Error(`Colonne de mise à jour invalide : ${colonne}`);
        }
    }
    if (colonnesMaj.length === 0) throw new Error('Aucune colonne de mise à jour');

    const values = [];
    const tuples = uniques.map(ligne => {
        if (ligne.length !== COLONNES.length) {
            throw new Error(`Ligne de ${ligne.length} valeurs, ${COLONNES.length} attendues`);
        }
        const marques = ligne.map(valeur => {
            values.push(valeur);
            return `$${values.length}`;
        });
        return `(${marques.join(', ')}, NOW())`;
    });

    const affectations = colonnesMaj.map(c => `${c} = EXCLUDED.${c}`).join(', ');
    const actuelles = colonnesMaj.map(c => `player_game_logs.${c}`).join(', ');
    const nouvelles = colonnesMaj.map(c => `EXCLUDED.${c}`).join(', ');

    const text = `INSERT INTO player_game_logs (${COLONNES.join(', ')}, last_updated)
VALUES ${tuples.join(',\n       ')}
ON CONFLICT (player_id, game_id) DO UPDATE SET ${affectations}, last_updated = NOW()
WHERE (${actuelles}) IS DISTINCT FROM (${nouvelles})`;

    return { text, values };
}

/**
 * Enregistre les feuilles d'un joueur en une requête.
 * Renvoie le nombre de matchs réellement écrits (nouveaux ou modifiés).
 */
async function enregistrerFeuilles(executer, lignes, colonnesMaj) {
    const requete = requeteFeuilles(lignes, colonnesMaj);
    if (!requete) return 0;
    const resultat = await executer(requete.text, requete.values);
    return (resultat && resultat.rowCount) || 0;
}

module.exports = { COLONNES, requeteFeuilles, enregistrerFeuilles, sansDoublons };
