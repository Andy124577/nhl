/**
 * Les points de pool marqués depuis le dernier relevé, avant que les totaux
 * ne les comptent.
 *
 * Le classement cumulatif additionne les totaux de saison de /current-stats
 * (fiche de chaque joueur à la LNH) et de /current-teams (classement des
 * clubs). Les deux ne sont relevés qu'une fois par nuit. Ce module calcule,
 * à partir des feuilles de match, ce qui manque encore à ces totaux, et
 * l'applique aux lignes que les pages ont déjà en main.
 *
 *   - un but ou une aide compte dès qu'il est inscrit à la feuille ;
 *   - une victoire, un blanchissage ou une défaite en prolongation d'un
 *     gardien, et la victoire ou la défaite en prolongation d'un club,
 *     comptent au coup de sifflet final — pas avant : un gardien qui mène
 *     2-0 en deuxième n'a encore rien gagné ;
 *   - seuls les matchs de saison régulière comptent, comme dans les totaux.
 *
 * NI OUBLI NI DOUBLE COMPTE. Le relevé note, pour chaque joueur et chaque
 * club, son INCLUSION : { depuis, matchs } — il comprend tous les matchs
 * d'avant la journée `depuis` et, à partir d'elle, exactement ceux de
 * `matchs` (voir lib/releveSaison.js). Un match compte ici si, et seulement
 * si, il n'y est pas. Le soir du 29 septembre 2026, le relevé de minuit a été
 * pris pendant Vancouver-Edmonton : les fiches de la LNH ne comprenaient pas
 * encore ce match, mais le « dernier match » noté le désignait déjà, et les
 * 5 points d'Evan Bouchard (3 buts, 2 aides) n'étaient comptés nulle part
 * jusqu'au relevé suivant. Les relevés d'avant l'inclusion (sans elle) se
 * rabattent encore sur l'ancienne règle, le temps d'être remplacés.
 *
 * Pur : ni réseau, ni horloge. Chargé par le serveur (require) et par le
 * navigateur (window.FZLive), comme lib/scoring.js.
 */

'use strict';

(function () {

const ETATS_COMMENCES = new Set(['LIVE', 'CRIT', 'FINAL', 'OFF']);
const ETATS_FINIS = new Set(['FINAL', 'OFF']);
const SAISON_REGULIERE = 2;

/** Au plus quatre journées à relire : au-delà, un relevé est à refaire. */
const JOURS_MAX = 4;

function bareme() {
    if (typeof module !== 'undefined' && module.exports) return require('./scoring.js');
    return window;
}

const estFini = m => ETATS_FINIS.has(m && m.gameState);

/** 'YYYY-MM-DD' décalé de `n` jours — arithmétique de calendrier, sans fuseau. */
function decalerJour(jour, n) {
    const d = new Date(`${jour}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

/** La journée d'un match, telle que la LNH la date (heure de l'Est). */
function jourDuMatch(m) {
    return m && typeof m.gameDate === 'string' ? m.gameDate.slice(0, 10) : null;
}

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
 * Le match `m` est-il dans un total dont l'inclusion est `inclusion` ?
 * Tout ce qui précède `depuis` y est ; à partir de là, la liste fait foi.
 */
function dejaInclus(m, inclusion) {
    const jour = jourDuMatch(m);
    if (jour && inclusion.depuis && jour < inclusion.depuis) return true;
    return (inclusion.matchs || []).some(id => Number(id) === Number(m.id));
}

/**
 * Le match `m` est-il déjà dans le total de ce joueur ?
 * `inclusion` : notée au relevé (null pour un relevé d'avant elle).
 * Repli : `dernier`, le dernier match de sa fiche (undefined s'il n'est pas
 * noté), puis l'heure du relevé.
 */
function joueurDejaCompte(m, inclusion, dernier, ligne) {
    if (inclusion) return dejaInclus(m, inclusion);
    if (dernier !== undefined) return dernier !== null && Number(m.id) <= Number(dernier);
    return commenceAvant(m, ligne && ligne.lastUpdated);
}

/** Le match `m` est-il déjà dans la fiche du club `abbrev` ? */
function clubDejaCompte(m, abbrev, clubs) {
    const inclusions = clubs && clubs.inclusion;
    if (inclusions) {
        return dejaInclus(m, inclusions[abbrev] || { depuis: clubs.depuis, matchs: [] });
    }
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
 * Ce qu'UN match apporte, à tous ceux qui y ont joué — sans rien savoir des
 * relevés. { joueurs: { [id]: { b, p, v, bl, dp } }, clubs: { [abrév.]: { v, dp } } },
 * lignes non nulles seulement. Le résultat des clubs vient du pointage du
 * match ; le reste, de sa feuille (boxscore de la LNH).
 */
function apportsDuMatch(m, feuille) {
    const sortie = { joueurs: {}, clubs: {} };
    if (!m) return sortie;
    const fini = estFini(m);

    if (fini) {
        const a = m.awayTeam || {}, h = m.homeTeam || {};
        const type = (m.gameOutcome && m.gameOutcome.lastPeriodType)
            || (m.periodDescriptor && m.periodDescriptor.periodType) || 'REG';
        if (a.abbrev && h.abbrev && Number(a.score) !== Number(h.score)) {
            const [gagnant, perdant] = Number(a.score) > Number(h.score) ? [a, h] : [h, a];
            ajouter(sortie.clubs, gagnant.abbrev, 'v', 1);
            if (type === 'OT' || type === 'SO') ajouter(sortie.clubs, perdant.abbrev, 'dp', 1);
        }
    }

    const parCamp = feuille && feuille.playerByGameStats;
    if (!parCamp) return sortie;

    for (const camp of ['awayTeam', 'homeTeam']) {
        const groupe = parCamp[camp] || {};
        for (const p of [...(groupe.forwards || []), ...(groupe.defense || [])]) {
            const id = Number(p.playerId);
            ajouter(sortie.joueurs, id, 'b', Number(p.goals) || 0);
            ajouter(sortie.joueurs, id, 'p', Number(p.assists) || 0);
        }

        if (!fini) continue;
        const gardiens = groupe.goalies || [];
        // Un blanchissage partagé n'est crédité à personne.
        const seul = gardiens.filter(aJoue).length === 1;
        for (const g of gardiens) {
            const id = Number(g.playerId);
            if (g.decision === 'W') {
                ajouter(sortie.joueurs, id, 'v', 1);
                if (seul && Number(g.goalsAgainst) === 0) ajouter(sortie.joueurs, id, 'bl', 1);
            } else if (g.decision === 'O' || g.decision === 'OTL') {
                ajouter(sortie.joueurs, id, 'dp', 1);
            }
        }
    }
    return sortie;
}

/**
 * Ce qui manque aux totaux, d'après les matchs relus.
 *
 *   matchs       : les matchs de /v1/score (now et journées suivies), tels quels ;
 *   feuilles     : Map(id du match → boxscore de la LNH, tel quel) ;
 *   stats        : le relevé de /current-stats en mémoire
 *                  ({ season, seasonStarted, players, inclusion, derniersMatchs }) ;
 *   clubs        : le relevé de /current-teams ({ inclusion, depuis, … }).
 *
 * Renvoie { joueurs: { [playerId]: { b, p, v, bl, dp } },
 *           clubs:   { [abrév.]:   { v, dp } } }
 * — seulement les lignes non nulles.
 */
function calculerPointsEnDirect({ matchs, feuilles, stats, clubs } = {}) {
    const sortie = { joueurs: {}, clubs: {} };
    if (!stats || stats.seasonStarted === false) return sortie;

    const lignes = new Map((stats.players || []).map(p => [Number(p.playerId), p]));
    const inclusions = stats.inclusion || null;
    const derniers = stats.derniersMatchs || null;
    const noteDe = (table, id) => (table && Object.prototype.hasOwnProperty.call(table, id)) ? table[id] : undefined;

    const vus = new Set();
    for (const m of (Array.isArray(matchs) ? matchs : [])) {
        if (!matchAdmissible(m, stats.season) || vus.has(Number(m.id))) continue;
        vus.add(Number(m.id));
        const apports = apportsDuMatch(m, feuilles && feuilles.get(Number(m.id)));

        for (const [abbrev, a] of Object.entries(apports.clubs)) {
            if (clubDejaCompte(m, abbrev, clubs)) continue;
            ajouter(sortie.clubs, abbrev, 'v', a.v || 0);
            ajouter(sortie.clubs, abbrev, 'dp', a.dp || 0);
        }

        for (const [cle, a] of Object.entries(apports.joueurs)) {
            const id = Number(cle);
            if (!lignes.has(id)) continue;
            const inclusion = noteDe(inclusions, id) || null;
            if (joueurDejaCompte(m, inclusion, noteDe(derniers, id), lignes.get(id))) continue;
            for (const champ of ['b', 'p', 'v', 'bl', 'dp']) ajouter(sortie.joueurs, id, champ, a[champ] || 0);
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
 * Les journées à relire pour que rien ne manque : de la plus ancienne
 * inclusion notée (au plus JOURS_MAX jours) jusqu'à aujourd'hui. Sans
 * inclusion, la veille et le jour — le match de la côte Ouest de la veille
 * se termine après minuit.
 */
function joursASuivre({ stats, clubs, aujourdhui } = {}) {
    if (!aujourdhui) return [];
    const plancher = decalerJour(aujourdhui, -(JOURS_MAX - 1));
    let debut = decalerJour(aujourdhui, -1);
    const noter = inclusion => {
        const d = inclusion && inclusion.depuis;
        if (typeof d === 'string' && d < debut) debut = d;
    };
    Object.values((stats && stats.inclusion) || {}).forEach(noter);
    Object.values((clubs && clubs.inclusion) || {}).forEach(noter);
    if (debut < plancher) debut = plancher;

    const jours = [];
    for (let j = debut; j <= aujourdhui; j = decalerJour(j, 1)) jours.push(j);
    return jours;
}

/**
 * Le dernier match de saison régulière d'une fiche de joueur de la LNH
 * (/v1/player/{id}/landing, `last5Games`). N'a plus cours pour les relevés
 * neufs, qui notent leur inclusion ; gardé pour lire les anciens.
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

/* ── Les lignes du soir (/tonight-boxscores) ─────────────────────────── */

/** « 32/37 » → [32, 37]. */
function arretsSurTirs(texte) {
    const [arrets, tirs] = String(texte || '').split('/');
    return [parseInt(arrets || '0', 10) || 0, parseInt(tirs || '0', 10) || 0];
}

/**
 * Une ligne par joueur et par match commencé : la ligne de « Mes joueurs ce
 * soir ». Deux pointages sur chaque ligne, un par mode de pool :
 *
 *   - `pointsTonight` : les points du cumulatif — buts + aides pour un
 *     patineur, et pour un gardien le barème de saison, au final seulement.
 *     Ils sortent d'apportsDuMatch(), la fonction même qui nourrit le
 *     classement en direct : l'accueil et le classement ne peuvent pas
 *     afficher deux nombres pour le même match ;
 *   - `fantasyPointsTonight` : le barème du tête-à-tête, inchangé.
 *
 *   matchs : les matchs commencés de /v1/score/now ;
 *   feuilles : Map(id → boxscore) ;
 *   nomDe(p) : le nom complet d'une ligne de feuille (les effectifs de pool
 *   portent « Connor McDavid », la feuille « C. McDavid »).
 */
function lignesDuSoir({ matchs, feuilles, nomDe = p => (p && p.name && p.name.default) || '' } = {}) {
    const b = bareme();
    const lignes = [];
    for (const game of (Array.isArray(matchs) ? matchs : [])) {
        const box = feuilles && feuilles.get(Number(game.id));
        if (!box) continue;
        const apports = apportsDuMatch(game, box).joueurs;
        const parCamp = box.playerByGameStats || {};
        for (const camp of ['awayTeam', 'homeTeam']) {
            const teamAbbrev = (box[camp] && box[camp].abbrev) || (game[camp] && game[camp].abbrev) || '';
            const groupe = parCamp[camp] || {};
            for (const p of [...(groupe.forwards || []), ...(groupe.defense || [])]) {
                const goals = Number(p.goals) || 0, assists = Number(p.assists) || 0;
                lignes.push({
                    playerId: p.playerId,
                    playerName: nomDe(p),
                    teamAbbrev,
                    position: 'F',
                    goals,
                    assists,
                    points: b.pointsReelsPatineur({ points: p.points, goals, assists }),
                    shots: p.sog || 0,
                    plusMinus: p.plusMinus || 0,
                    toi: p.toi || '',
                    gameId: game.id,
                    gameState: game.gameState,
                    pointsTonight: pointsApport(apports[Number(p.playerId)], false),
                    fantasyPointsTonight: b.skaterFantasyPointsTonight({
                        goals: p.goals, assists: p.assists, shots: p.sog, plusMinus: p.plusMinus
                    })
                });
            }
            for (const g of (groupe.goalies || [])) {
                const decision = g.decision || null;
                const [saves, shotsAgainst] = arretsSurTirs(g.saveShotsAgainst);
                const shutout = (g.goalsAgainst === 0) && decision === 'W';
                lignes.push({
                    playerId: g.playerId,
                    playerName: nomDe(g),
                    teamAbbrev,
                    position: 'G',
                    saves,
                    shotsAgainst,
                    goalsAgainst: g.goalsAgainst || 0,
                    decision,
                    shutout,
                    toi: g.toi || '',
                    gameId: game.id,
                    gameState: game.gameState,
                    pointsTonight: pointsApport(apports[Number(g.playerId)], true),
                    fantasyPointsTonight: b.goalieFantasyPointsTonight({
                        decision, shutout, saves, goalsAgainst: g.goalsAgainst
                    })
                });
            }
        }
    }
    return lignes;
}

const api = {
    JOURS_MAX,
    calculerPointsEnDirect,
    apportsDuMatch,
    matchsASuivre,
    matchAdmissible,
    joursASuivre,
    dejaInclus,
    dernierMatchDeFiche,
    appliquerAuxJoueurs,
    appliquerAuxClubs,
    pointsApport,
    signature,
    lignesDuSoir
};
if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else if (typeof window !== 'undefined') {
    window.FZLive = api;
}

})();
