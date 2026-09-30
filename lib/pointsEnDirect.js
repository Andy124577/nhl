/**
 * Les points de pool marqués ce soir, avant que les totaux ne les comptent.
 *
 * Le classement cumulatif additionne les totaux de saison de /current-stats
 * (fiche de chaque joueur à la LNH) et de /current-teams (classement des
 * clubs). Les deux ne sont relevés qu'une fois par jour, à minuit : un but
 * marqué à 20 h n'apparaissait au pool que le lendemain. Ce module calcule,
 * à partir des feuilles de match du soir, ce qui manque encore à ces totaux,
 * et l'applique aux lignes que les pages ont déjà en main.
 *
 *   - un but ou une aide compte dès qu'il est inscrit à la feuille ;
 *   - une victoire, un blanchissage ou une défaite en prolongation d'un
 *     gardien, et la victoire ou la défaite en prolongation d'un club,
 *     comptent au coup de sifflet final — pas avant : un gardien qui mène
 *     2-0 en deuxième n'a encore rien gagné ;
 *   - seuls les matchs de saison régulière comptent, comme dans les totaux.
 *
 * Ne jamais compter deux fois. Un match déjà compris dans les totaux
 * n'ajoute rien :
 *   - pour un joueur, le relevé de minuit note le dernier match de sa fiche
 *     (`derniersMatchs`) ; un match plus récent n'y est pas encore. Un
 *     relevé plus ancien, sans cette note, se rabat sur l'heure : un match
 *     commencé avant le relevé est réputé compté — quitte à attendre minuit
 *     pour un match chevauchant, plutôt que de le compter deux fois ;
 *   - pour un club, le relevé du classement note les matchs déjà terminés à
 *     cet instant (`matchsComptes`), avec le même repli sur l'heure.
 *
 * Pur : ni réseau, ni horloge. Chargé par le serveur (require) et par le
 * navigateur (window.FZLive), comme lib/scoring.js.
 */

'use strict';

(function () {

const ETATS_COMMENCES = new Set(['LIVE', 'CRIT', 'FINAL', 'OFF']);
const ETATS_FINIS = new Set(['FINAL', 'OFF']);
const SAISON_REGULIERE = 2;

function bareme() {
    if (typeof module !== 'undefined' && module.exports) return require('./scoring.js');
    return window;
}

const estFini = m => ETATS_FINIS.has(m && m.gameState);

/** Le match compte-t-il au pool ? Saison régulière, commencé, de la bonne saison. */
function matchAdmissible(m, saison) {
    if (!m || !ETATS_COMMENCES.has(m.gameState)) return false;
    if (Number(m.gameType) !== SAISON_REGULIERE) return false;
    if (saison && m.season && Number(m.season) !== Number(saison)) return false;
    return true;
}

/** Commencé avant `instant` (ISO) ? Faux si l'une des deux dates manque. */
function commenceAvant(m, instant) {
    const debut = Date.parse(m && m.startTimeUTC);
    const releve = Date.parse(instant);
    return Number.isFinite(debut) && Number.isFinite(releve) && debut < releve;
}

/**
 * Le match `m` est-il déjà dans le total de ce joueur ?
 * `dernier` : le dernier match de sa fiche au relevé (id, null s'il n'en
 * avait aucun, undefined si le relevé ne le notait pas encore).
 */
function joueurDejaCompte(m, dernier, ligne) {
    if (dernier !== undefined) return dernier !== null && Number(m.id) <= Number(dernier);
    return commenceAvant(m, ligne && ligne.lastUpdated);
}

/** Le match `m` est-il déjà dans le classement des clubs ? */
function clubDejaCompte(m, clubs) {
    if (clubs && Array.isArray(clubs.matchsComptes)) return clubs.matchsComptes.map(Number).includes(Number(m.id));
    return commenceAvant(m, clubs && clubs.lastUpdated);
}

function ajouter(cible, cle, champ, n) {
    if (!n) return;
    const ligne = cible[cle] || (cible[cle] = {});
    ligne[champ] = (ligne[champ] || 0) + n;
}

/** Un gardien a-t-il joué ? Les feuilles listent aussi le réserviste, à 00:00. */
function aJoue(g) {
    const toi = String((g && g.toi) || '');
    return toi !== '' && !/^0?0:00$/.test(toi);
}

/**
 * Ce qui manque aux totaux, d'après les matchs du soir.
 *
 *   matchs       : les matchs de /v1/score/now, tels quels ;
 *   feuilles     : Map(id du match → boxscore de la LNH, tel quel) ;
 *   stats        : le relevé de /current-stats en mémoire
 *                  ({ season, seasonStarted, players, derniersMatchs }) ;
 *   clubs        : le relevé de /current-teams ({ lastUpdated, matchsComptes }).
 *
 * Renvoie { joueurs: { [playerId]: { b, p, v, bl, dp } },
 *           clubs:   { [abrév.]:   { v, dp } } }
 * — seulement les lignes non nulles.
 */
function calculerPointsEnDirect({ matchs, feuilles, stats, clubs } = {}) {
    const sortie = { joueurs: {}, clubs: {} };
    if (!stats || stats.seasonStarted === false) return sortie;

    const lignes = new Map((stats.players || []).map(p => [Number(p.playerId), p]));
    const derniers = stats.derniersMatchs || null;
    const dernierDe = id => (derniers && Object.prototype.hasOwnProperty.call(derniers, id))
        ? derniers[id] : undefined;

    for (const m of (Array.isArray(matchs) ? matchs : [])) {
        if (!matchAdmissible(m, stats.season)) continue;
        const fini = estFini(m);

        // Les clubs : au final seulement.
        if (fini && !clubDejaCompte(m, clubs)) {
            const a = m.awayTeam || {}, h = m.homeTeam || {};
            const type = (m.gameOutcome && m.gameOutcome.lastPeriodType)
                || (m.periodDescriptor && m.periodDescriptor.periodType) || 'REG';
            if (a.abbrev && h.abbrev && Number(a.score) !== Number(h.score)) {
                const [gagnant, perdant] = Number(a.score) > Number(h.score) ? [a, h] : [h, a];
                ajouter(sortie.clubs, gagnant.abbrev, 'v', 1);
                if (type === 'OT' || type === 'SO') ajouter(sortie.clubs, perdant.abbrev, 'dp', 1);
            }
        }

        const feuille = feuilles && feuilles.get(Number(m.id));
        const parCamp = feuille && feuille.playerByGameStats;
        if (!parCamp) continue;

        for (const camp of ['awayTeam', 'homeTeam']) {
            const groupe = parCamp[camp] || {};
            for (const p of [...(groupe.forwards || []), ...(groupe.defense || [])]) {
                const id = Number(p.playerId);
                if (!lignes.has(id) || joueurDejaCompte(m, dernierDe(id), lignes.get(id))) continue;
                ajouter(sortie.joueurs, id, 'b', Number(p.goals) || 0);
                ajouter(sortie.joueurs, id, 'p', Number(p.assists) || 0);
            }

            if (!fini) continue;
            const gardiens = groupe.goalies || [];
            // Un blanchissage partagé n'est crédité à personne.
            const seul = gardiens.filter(aJoue).length === 1;
            for (const g of gardiens) {
                const id = Number(g.playerId);
                if (!lignes.has(id) || joueurDejaCompte(m, dernierDe(id), lignes.get(id))) continue;
                if (g.decision === 'W') {
                    ajouter(sortie.joueurs, id, 'v', 1);
                    if (seul && Number(g.goalsAgainst) === 0) ajouter(sortie.joueurs, id, 'bl', 1);
                } else if (g.decision === 'O' || g.decision === 'OTL') {
                    ajouter(sortie.joueurs, id, 'dp', 1);
                }
            }
        }
    }
    return sortie;
}

/**
 * Les matchs dont la feuille est à relever : commencés, de saison régulière.
 * Le service ne relève que ceux-là, et seulement quand le pointage bouge.
 */
function matchsASuivre(matchs, saison) {
    return (Array.isArray(matchs) ? matchs : []).filter(m => matchAdmissible(m, saison));
}

/**
 * Le dernier match de saison régulière d'une fiche de joueur de la LNH
 * (/v1/player/{id}/landing, `last5Games`), noté au relevé de minuit : tout
 * match plus récent manque encore au total. null si la fiche n'en montre
 * aucun.
 */
function dernierMatchDeFiche(fiche) {
    const ids = ((fiche && fiche.last5Games) || [])
        .filter(g => g && (g.gameTypeId === undefined || Number(g.gameTypeId) === SAISON_REGULIERE))
        .map(g => Number(g.gameId))
        .filter(Number.isFinite);
    return ids.length ? Math.max(...ids) : null;
}

/* ── Côté page : appliquer le direct aux lignes déjà chargées ─────────── */

/** Points de pool d'un apport en direct, pour un joueur. */
function pointsApport(apport, estGardienLigne) {
    if (!apport) return 0;
    if (estGardienLigne) {
        return bareme().goaliePoolPoints({ wins: apport.v || 0, shutouts: apport.bl || 0, otLosses: apport.dp || 0 });
    }
    return (apport.b || 0) + (apport.p || 0);
}

/**
 * Les lignes de /current-stats, augmentées de ce soir. Chaque ligne touchée
 * porte `pointsEnDirect` : ce que le soir lui a ajouté, en points de pool.
 * Les lignes intactes sont rendues telles quelles (même objet).
 */
function appliquerAuxJoueurs(lignes, direct) {
    const apports = direct && direct.joueurs;
    if (!Array.isArray(lignes) || !apports) return lignes || [];
    return lignes.map(l => {
        const a = l && apports[l.playerId];
        if (!a) return l;
        const gardien = l.position === 'G';
        const n = { ...l, pointsEnDirect: pointsApport(a, gardien) };
        if (gardien) {
            n.wins = (l.wins || 0) + (a.v || 0);
            n.shutouts = (l.shutouts || 0) + (a.bl || 0);
            n.otLosses = (l.otLosses || 0) + (a.dp || 0);
            // Le relevé range victoires et blanchissages d'un gardien dans
            // goals/assists (voir fetchCurrentStatsForPlayer) : même miroir.
            n.goals = n.wins;
            n.assists = n.shutouts;
            n.points = bareme().goaliePoolPoints(n);
        } else {
            n.goals = (l.goals || 0) + (a.b || 0);
            n.assists = (l.assists || 0) + (a.p || 0);
            n.points = (l.points || 0) + (a.b || 0) + (a.p || 0);
        }
        return n;
    });
}

/** Les fiches de /current-teams, augmentées des matchs finis ce soir. */
function appliquerAuxClubs(fiches, direct) {
    const apports = direct && direct.clubs;
    if (!Array.isArray(fiches) || !apports) return fiches || [];
    return fiches.map(t => {
        const a = t && apports[String(t.teamAbbrev || '').toUpperCase()];
        if (!a) return t;
        const n = {
            ...t,
            wins: (t.wins || 0) + (a.v || 0),
            otLosses: (t.otLosses || 0) + (a.dp || 0),
            gamesPlayed: (t.gamesPlayed || 0) + (a.v || 0) + (a.dp || 0)
        };
        n.pointsEnDirect = bareme().clubPoolPoints({ wins: a.v || 0, otLosses: a.dp || 0 });
        return n;
    });
}

/** Deux relevés disent-ils la même chose ? Pour ne pousser que les changements. */
function signature(direct) {
    if (!direct) return '';
    const trier = o => Object.keys(o || {}).sort().map(k => [k, o[k].b || 0, o[k].p || 0, o[k].v || 0, o[k].bl || 0, o[k].dp || 0]);
    return JSON.stringify([trier(direct.joueurs), trier(direct.clubs)]);
}

const api = {
    calculerPointsEnDirect,
    matchsASuivre,
    matchAdmissible,
    dernierMatchDeFiche,
    appliquerAuxJoueurs,
    appliquerAuxClubs,
    pointsApport,
    signature
};
if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else if (typeof window !== 'undefined') {
    window.FZLive = api;
}

})();
