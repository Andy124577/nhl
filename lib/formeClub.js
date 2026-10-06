/**
 * La forme d'un club : ce que ses joueurs ont fait à ses derniers matchs.
 *
 * Le calendrier montre, sous un match à venir où l'on n'a aucun joueur, le
 * meilleur buteur et le meilleur pointeur de chaque club à ses cinq derniers
 * matchs ; sous un match où l'on en a, la forme de nos joueurs sur ces mêmes
 * matchs. Les totaux de la saison ne le disent pas : un joueur à 30 points en
 * janvier peut n'en avoir aucun depuis deux semaines.
 *
 * La source est la feuille de match de la LNH (/gamecenter/{id}/boxscore),
 * qui couvre TOUS les joueurs habillés — la liste de suivi du site n'en
 * compte qu'environ cinq cents, et le meneur d'un club peut ne pas y être.
 *
 * Pur : ni requête ni cache. Le service (services/formeClubs.js) lit les
 * calendriers et les feuilles, et passe ce qu'il a lu.
 */

'use strict';

/** Combien de matchs comptent pour la forme. */
const MATCHS_FORME = 5;

/** Un match dont la feuille ne bougera plus, ou presque. */
const ETATS_FINIS = new Set(['FINAL', 'OFF']);

/**
 * Les `n` derniers matchs terminés d'un club, du plus récent au plus ancien.
 *
 * `matchs` : le calendrier du club (club-schedule-season), déjà réduit à la
 * saison régulière. En début de saison il y en a moins de cinq : la forme se
 * fait sur ceux qui existent, et le dit (`matchs` dans la réponse).
 */
function derniersMatchs(matchs, n = MATCHS_FORME) {
    return (matchs || [])
        .filter(m => m && ETATS_FINIS.has(m.gameState))
        .sort((a, b) => String(b.gameDate).localeCompare(String(a.gameDate)) || Number(b.id) - Number(a.id))
        .slice(0, n);
}

/** Un gardien a joué s'il a fait face à un tir ou passé du temps devant le filet. */
function gardienAJoue(g) {
    return (g.shotsAgainst || 0) > 0 || (g.toi && g.toi !== '00:00' && g.toi !== '0:00');
}

/**
 * Les lignes d'une feuille de match, des deux côtés, réduites à ce que la
 * forme additionne. Un gardien resté au banc n'a pas joué : il n'a pas de
 * ligne. null si la feuille n'a pas de statistiques de joueurs (match pas
 * encore commencé, réponse incomplète).
 */
function lignesDeFeuille(box) {
    const stats = box && box.playerByGameStats;
    if (!stats) return null;
    const cote = cle => {
        const s = stats[cle] || {};
        const patineurs = [...(s.forwards || []), ...(s.defense || [])].map(p => ({
            id: Number(p.playerId),
            nom: (p.name && p.name.default) || '',
            pos: p.position || '',
            b: p.goals || 0,
            a: p.assists || 0,
            p: p.points ?? ((p.goals || 0) + (p.assists || 0))
        }));
        const gardiens = (s.goalies || []).filter(gardienAJoue).map(g => ({
            id: Number(g.playerId),
            nom: (g.name && g.name.default) || '',
            pos: 'G',
            b: g.goals || 0,
            a: g.assists || 0,
            p: g.points ?? ((g.goals || 0) + (g.assists || 0)),
            v: g.decision === 'W' ? 1 : 0,
            arrets: g.saves ?? Math.max(0, (g.shotsAgainst || 0) - (g.goalsAgainst || 0)),
            tirs: g.shotsAgainst || 0
        }));
        return {
            abbrev: (box[cle] && box[cle].abbrev) || '',
            joueurs: [...patineurs, ...gardiens].filter(j => j.id > 0)
        };
    };
    return { away: cote('awayTeam'), home: cote('homeTeam') };
}

/**
 * Les totaux de chaque joueur d'un club sur les feuilles données.
 *
 * `feuilles` : le résultat de lignesDeFeuille() pour chacun des derniers
 * matchs du club. Une feuille absente (la LNH n'a pas répondu) ne compte
 * pas : mieux vaut une forme sur quatre matchs, dite telle, qu'un cinquième
 * match compté à zéro pour tout le monde.
 */
function formeDuClub(abbrev, feuilles) {
    const parJoueur = new Map();
    let matchs = 0;
    for (const f of feuilles || []) {
        const cote = f && (f.away.abbrev === abbrev ? f.away : f.home.abbrev === abbrev ? f.home : null);
        if (!cote) continue;
        matchs++;
        for (const l of cote.joueurs) {
            const t = parJoueur.get(l.id) || { id: l.id, nom: l.nom, pos: l.pos, pj: 0, b: 0, a: 0, p: 0 };
            t.pj++;
            t.b += l.b;
            t.a += l.a;
            t.p += l.p;
            if (l.pos === 'G') {
                t.v = (t.v || 0) + (l.v || 0);
                t.arrets = (t.arrets || 0) + (l.arrets || 0);
                t.tirs = (t.tirs || 0) + (l.tirs || 0);
            }
            parJoueur.set(l.id, t);
        }
    }
    return { matchs, joueurs: [...parJoueur.values()] };
}

function premier(liste, ordre) {
    return liste.length ? liste.slice().sort(ordre)[0] : null;
}

/**
 * Le meilleur buteur et le meilleur pointeur d'un club, gardiens exclus.
 *
 * À égalité : l'autre statistique d'abord (deux buteurs à 3 buts, celui qui a
 * aussi des aides), puis le moins de matchs pour y arriver, puis le numéro
 * de joueur — un ordre stable, pour qu'une carte ne change pas de meneur d'un
 * chargement à l'autre. Personne à zéro : pas de meneur plutôt qu'un nom
 * pris au hasard.
 */
function meneurs(joueurs) {
    const patineurs = (joueurs || []).filter(j => j.pos !== 'G');
    return {
        buteur: premier(patineurs.filter(j => j.b > 0),
            (x, y) => y.b - x.b || y.p - x.p || x.pj - y.pj || x.id - y.id),
        pointeur: premier(patineurs.filter(j => j.p > 0),
            (x, y) => y.p - x.p || y.b - x.b || x.pj - y.pj || x.id - y.id)
    };
}

module.exports = { MATCHS_FORME, ETATS_FINIS, derniersMatchs, lignesDeFeuille, formeDuClub, meneurs };
