/**
 * Le service de pointage : une seule porte vers « combien vaut cette équipe
 * sur cette période ».
 *
 * Trois surfaces posaient la même question et obtenaient trois réponses :
 * la finalisation hebdomadaire, le détail par joueur du centre des duels, et
 * le classement. Elles recopiaient le barème, et deux d'entre elles ne
 * fermaient même pas la semaine au même endroit — `game_date < fin` d'un côté,
 * `game_date <= fin` de l'autre. Un match du lundi comptait donc deux fois,
 * ou pas du tout, selon qui demandait.
 *
 * Ici, une seule fonction interroge les feuilles de match, une seule applique
 * le barème (lib/scoring.js), et un seul module décide des frontières de
 * semaine (lib/dates.js).
 *
 * Ce que le service refuse de faire :
 *
 *   - renvoyer zéro quand il n'a rien trouvé. L'absence de lignes ne distingue
 *     pas « n'a pas joué » de « pas encore ingéré », et confondre les deux est
 *     ce qui faisait finaliser des semaines sur des feuilles manquantes ;
 *   - remplacer une semaine manquante par les totaux de saison. Ces totaux sont
 *     cumulés depuis octobre : les opposer à une semaine, c'est comparer deux
 *     unités différentes ;
 *   - inclure le club de la LNH repêché dans un pointage hebdomadaire sans le
 *     dire. La règle du produit est que le club compte au cumulatif et pas en
 *     tête-à-tête ; elle est désormais écrite, portée par chaque résultat, et
 *     la même sur toutes les surfaces.
 */

'use strict';

const scoring = require('../lib/scoring.js');
const dates = require('../lib/dates.js');

/**
 * Le club de la LNH repêché compte-t-il dans un pointage de tête-à-tête ?
 *
 * Non, et c'est la règle en vigueur — pas un oubli. Les aides hebdomadaires
 * n'ont jamais collecté la catégorie `teams` ; le classement cumulatif, lui,
 * la compte. Les deux modes sont différents et doivent le rester : « cohérent »
 * veut dire que le même mode, la même période et la même base d'alignement
 * donnent le même score, pas que le tête-à-tête égale le cumulatif.
 *
 * Ce qui change : la règle est nommée, elle voyage avec le résultat, et chaque
 * surface la lit au lieu de la deviner.
 */
const CLUB_DANS_H2H = false;

/** Base d'alignement utilisée par le pointage hebdomadaire. */
const BASE_ALIGNEMENT = {
    /**
     * Alignement courant appliqué à la période.
     *
     * C'est la règle du produit aujourd'hui : on prend l'alignement tel qu'il
     * est au moment du calcul. Elle a une conséquence qu'il faut assumer — un
     * échange conclu mardi change ce que la semaine dernière aurait valu. C'est
     * précisément pour cela qu'un résultat finalisé est FIGÉ en base : une fois
     * la semaine close, plus aucun échange ne la réécrit.
     */
    COURANT: 'current_roster',
    /** Alignement figé au moment de la finalisation. */
    FIGE: 'frozen_at_finalization'
};

/** Les noms d'un alignement, catégorie par catégorie. */
function alignementDe(teamData) {
    const nomDe = (p) => (typeof p === 'string')
        ? p
        : (p && (p.skaterFullName || p.goalieFullName || p.teamFullName)) || null;

    const patineurs = [];
    for (const categorie of ['offensive', 'defensive', 'rookie']) {
        for (const joueur of (teamData?.[categorie] || [])) {
            const nom = nomDe(joueur);
            if (nom) patineurs.push({ nom, categorie, gardien: false });
        }
    }
    const gardiens = (teamData?.goalie || []).map(nomDe).filter(Boolean)
        .map(nom => ({ nom, categorie: 'goalie', gardien: true }));
    const clubs = (teamData?.teams || []).map(nomDe).filter(Boolean);

    return { patineurs, gardiens, clubs, joueurs: [...patineurs, ...gardiens] };
}

function creerServicePointage({ db, calendrierDuJour = null, logger = console }) {

    /**
     * Les feuilles de match d'une liste de joueurs sur un intervalle
     * SEMI-OUVERT `[debut, fin)`.
     *
     * Une seule requête pour toute l'équipe : la version précédente en faisait
     * une par joueur sur certaines surfaces, ce qui faisait grandir le nombre
     * de requêtes avec la taille des alignements.
     */
    async function feuilles({ noms, debut, fin, saison }) {
        if (!noms || noms.length === 0) return [];
        const resultat = await db.query(`
            SELECT player_name, player_id, team_abbrev, position, game_id, game_date,
                   goals, assists, points, shots, plus_minus,
                   power_play_goals, power_play_points,
                   shorthanded_goals, shorthanded_points, game_winning_goals,
                   decision, saves, goals_against, shutouts
              FROM player_game_logs
             WHERE season = $1
               AND game_date >= $2
               AND game_date <  $3
               AND player_name = ANY($4)
             ORDER BY game_date ASC
        `, [saison, debut, fin, noms]);
        return resultat.rows;
    }

    /**
     * L'état de l'ingestion sur une période.
     *
     * Compter les lignes reçues pour décider si elles sont toutes là serait
     * circulaire. On compare donc à ce que le calendrier de la LNH annonçait :
     * autant de matchs prévus, autant de matchs dont on a au moins une feuille.
     *
     * Sans calendrier disponible, on ne prétend pas savoir. `unavailable`
     * plutôt qu'un zéro qui aurait l'air d'un résultat.
     */
    async function etatIngestion({ debut, fin, saison }) {
        const journees = dates.journeesDe(debut, fin);
        if (journees.length === 0) {
            return { completude: scoring.COMPLETUDE.SANS_OBJET, attendus: 0, recus: 0, journees: [] };
        }

        const resultat = await db.query(`
            SELECT game_date, COUNT(DISTINCT game_id)::int AS matchs
              FROM player_game_logs
             WHERE season = $1 AND game_date >= $2 AND game_date < $3
             GROUP BY game_date
        `, [saison, debut, fin]);

        const recusParJour = new Map(
            resultat.rows.map(r => [dates.journeeDe(r.game_date), r.matchs])
        );

        const detail = [];
        let attendus = 0;
        let recus = 0;
        let calendrierConnu = true;

        for (const journee of journees) {
            const recuJour = recusParJour.get(journee) || 0;
            let prevuJour = null;
            if (calendrierDuJour) {
                try { prevuJour = await calendrierDuJour(journee); }
                catch (erreur) {
                    logger.error?.('⚠️ Calendrier du jour indisponible :', erreur.message);
                    prevuJour = null;
                }
            }
            if (prevuJour == null) calendrierConnu = false;
            else attendus += prevuJour;
            recus += recuJour;
            detail.push({ journee, prevus: prevuJour, recus: recuJour });
        }

        const completude = calendrierConnu
            ? scoring.completudeDe({ attendus, recus })
            : scoring.completudeDe({ attendus: null, recus });

        return { completude, attendus: calendrierConnu ? attendus : null, recus, journees: detail };
    }

    /**
     * Le détail par joueur d'une équipe sur une période.
     *
     * Chaque joueur est présent, même sans match : la différence entre « zéro
     * point » et « aucune donnée » est portée par `matchs`, pas devinée par
     * l'affichage.
     */
    async function detailEquipe(teamData, { debut, fin, saison }) {
        const alignement = alignementDe(teamData);
        if (alignement.joueurs.length === 0) return [];

        const noms = alignement.joueurs.map(j => j.nom);
        const lignes = await feuilles({ noms, debut, fin, saison });

        // Une passe pour les métadonnées d'affichage : identifiant LNH et club
        // les plus récents, pour la photo et l'écusson.
        const meta = new Map();
        for (const ligne of lignes) {
            meta.set(ligne.player_name, { playerId: ligne.player_id, teamAbbrev: ligne.team_abbrev });
        }

        const cumul = new Map();
        for (const ligne of lignes) {
            const cle = ligne.player_name;
            if (!cumul.has(cle)) {
                cumul.set(cle, {
                    fantasyPoints: 0, matchs: 0,
                    goals: 0, assists: 0, shots: 0,
                    wins: 0, saves: 0, shutouts: 0
                });
            }
            const total = cumul.get(cle);
            total.fantasyPoints += scoring.pointsFeuilleDeMatch(ligne);
            total.matchs += 1;
            if (scoring.estGardien(ligne)) {
                total.wins += ligne.decision === 'W' ? 1 : 0;
                total.saves += ligne.saves || 0;
                total.shutouts += ligne.shutouts || 0;
            } else {
                total.goals += ligne.goals || 0;
                total.assists += ligne.assists || 0;
                total.shots += ligne.shots || 0;
            }
        }

        return alignement.joueurs.map(joueur => {
            const total = cumul.get(joueur.nom);
            const infos = meta.get(joueur.nom) || {};
            return {
                name: joueur.nom,
                categorie: joueur.categorie,
                position: joueur.gardien ? 'G' : 'S',
                playerId: infos.playerId || null,
                teamAbbrev: infos.teamAbbrev || null,
                fantasyPoints: total ? scoring.arrondi(total.fantasyPoints) : 0,
                matchs: total ? total.matchs : 0,
                goals: total ? total.goals : 0,
                assists: total ? total.assists : 0,
                shots: total ? total.shots : 0,
                wins: total ? total.wins : 0,
                saves: total ? total.saves : 0,
                shutouts: total ? total.shutouts : 0
            };
        });
    }

    /**
     * Le pointage d'une équipe sur une période, avec tout ce qui permet de le
     * comparer à un autre.
     *
     * Renvoie toujours un résultat, jamais un nombre nu : l'appelant doit voir
     * la complétude avant de s'en servir pour finaliser quoi que ce soit.
     */
    async function pointsEquipe(teamData, { debut, fin, saison, mode = 'head-to-head',
                                            baseAlignement = BASE_ALIGNEMENT.COURANT,
                                            ingestion = null }) {
        const alignement = alignementDe(teamData);

        if (alignement.joueurs.length === 0) {
            return scoring.resultatPointage({
                points: null, saison, mode, baseAlignement,
                periode: { debut, fin },
                completude: scoring.COMPLETUDE.SANS_OBJET,
                detail: { joueurs: [], club: composanteClub(alignement, mode) }
            });
        }

        const joueurs = await detailEquipe(teamData, { debut, fin, saison });
        const total = joueurs.reduce((somme, j) => somme + j.fantasyPoints, 0);
        const etat = ingestion || await etatIngestion({ debut, fin, saison });

        return scoring.resultatPointage({
            points: total,
            saison, mode, baseAlignement,
            periode: { debut, fin },
            completude: etat.completude,
            matchsAttendus: etat.attendus,
            matchsRecus: etat.recus,
            detail: { joueurs, club: composanteClub(alignement, mode) }
        });
    }

    /**
     * La composante « club de la LNH » du pointage, annoncée explicitement.
     *
     * En tête-à-tête elle vaut zéro et le dit : `inclus: false`, avec la raison.
     * L'omettre en silence sur une surface et la compter sur une autre est
     * exactement ce qui produisait deux totaux pour la même équipe.
     */
    function composanteClub(alignement, mode) {
        const enH2H = mode === 'head-to-head';
        return {
            clubs: alignement.clubs,
            inclus: enH2H ? CLUB_DANS_H2H : true,
            points: 0,
            raison: enH2H && !CLUB_DANS_H2H
                ? 'Le club repêché compte au classement cumulatif, pas dans un duel hebdomadaire.'
                : null
        };
    }

    /** Le pointage des deux équipes d'un duel, sur la même période exactement. */
    async function pointsDuel(duel, teams, contexte) {
        const ingestion = await etatIngestion(contexte);
        const [t1, t2] = await Promise.all([
            pointsEquipe(teams[duel.team1], { ...contexte, ingestion }),
            pointsEquipe(teams[duel.team2], { ...contexte, ingestion })
        ]);
        return { team1: duel.team1, team2: duel.team2, t1, t2, ingestion };
    }

    return {
        CLUB_DANS_H2H,
        BASE_ALIGNEMENT,
        alignementDe,
        feuilles,
        etatIngestion,
        detailEquipe,
        pointsEquipe,
        pointsDuel,
        composanteClub
    };
}

module.exports = { creerServicePointage, CLUB_DANS_H2H, BASE_ALIGNEMENT, alignementDe };
