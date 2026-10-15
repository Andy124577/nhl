/**
 * Le bilan de la soirée : ce que les matchs d'une journée ont rapporté à une
 * équipe de pool, une fois TOUS ces matchs terminés.
 *
 * La fenêtre surgit après le dernier coup de sifflet (bilanSoiree.js côté
 * page) : une carte par joueur qui a joué, le total qui grimpe, puis le
 * mouvement au classement (cumulatif) ou le duel de la semaine (tête-à-tête).
 *
 * La soirée racontée est la plus récente qui soit finie : celle du jour dès
 * que son dernier match est terminé, sinon celle de la veille. Un match de
 * la côte Ouest fini à 1 h appartient à la veille (la LNH date ses matchs) :
 * tant qu'il joue, aucune des deux n'est prête, et la page réessaie.
 *
 * Pur : ni réseau, ni horloge.
 */

'use strict';

const scoring = require('./scoring.js');

const SAISON_REGULIERE = 2;
const ETATS_FINIS = new Set(['FINAL', 'OFF']);
const ETATS_EN_JEU = new Set(['LIVE', 'CRIT']);
/** Un match reporté ou annulé ne se jouera pas ce soir : il ne retient pas le bilan. */
const ETATS_ANNULES = new Set(['PPD', 'CNCL', 'SUSP']);

/** Des matchs se jouent : la page revient voir dans cinq minutes. */
const REESSAI_EN_JEU_MS = 5 * 60 * 1000;
/** Rien ne joue (matinée, après-midi) : une demi-heure suffit. */
const REESSAI_CALME_MS = 30 * 60 * 1000;

const jourDuMatch = m => (m && typeof m.gameDate === 'string' ? m.gameDate.slice(0, 10) : null);

function deLaJournee(m, jour, saison) {
    if (!m || Number(m.gameType) !== SAISON_REGULIERE || jourDuMatch(m) !== jour) return false;
    return !(saison && m.season && Number(m.season) !== Number(saison));
}

/**
 * Où en sont les matchs de saison régulière d'une journée :
 * { prevus, finis, enJeu, terminee } — `terminee` seulement s'il y en avait
 * au moins un et qu'ils sont tous finis. Une journée sans match n'a pas de
 * bilan.
 */
function etatDeLaSoiree(matchs, jour, saison = null) {
    let prevus = 0, finis = 0, enJeu = 0;
    for (const m of Array.isArray(matchs) ? matchs : []) {
        if (!deLaJournee(m, jour, saison) || ETATS_ANNULES.has(m.gameState)) continue;
        prevus += 1;
        if (ETATS_FINIS.has(m.gameState)) finis += 1;
        else if (ETATS_EN_JEU.has(m.gameState)) enJeu += 1;
    }
    return { prevus, finis, enJeu, terminee: prevus > 0 && finis === prevus };
}

/**
 * La soirée à raconter : aujourd'hui si elle est finie, sinon hier si elle
 * l'est, sinon aucune (null).
 */
function choisirSoiree({ aujourdhui, hier, etatAujourdhui, etatHier }) {
    if (etatAujourdhui && etatAujourdhui.terminee) return aujourdhui;
    if (etatHier && etatHier.terminee) return hier;
    return null;
}

/**
 * Quand la page doit redemander : jamais si la soirée du jour est déjà
 * racontable (il n'y en aura pas d'autre avant demain), vite si un match
 * joue, sinon dans une demi-heure.
 */
function delaiAvantReessai(etatAujourdhui, etatHier) {
    if (etatAujourdhui && etatAujourdhui.terminee) return null;
    const enJeu = (etatAujourdhui ? etatAujourdhui.enJeu : 0) + (etatHier ? etatHier.enJeu : 0);
    return enJeu > 0 ? REESSAI_EN_JEU_MS : REESSAI_CALME_MS;
}

/**
 * La soirée d'un club de la LNH repêché : son match fini de la journée, et
 * ce qu'il rapporte au cumulatif (2 par victoire, 1 par défaite en
 * prolongation ou en tirs de barrage). null s'il n'a pas joué.
 */
function soireeDuClub(matchs, abbrev, jour, saison = null) {
    const club = String(abbrev || '').toUpperCase();
    if (!club) return null;
    const m = (Array.isArray(matchs) ? matchs : []).find(x => deLaJournee(x, jour, saison)
        && ETATS_FINIS.has(x.gameState)
        && [x.awayTeam && x.awayTeam.abbrev, x.homeTeam && x.homeTeam.abbrev].includes(club));
    if (!m) return null;

    const domicile = m.homeTeam.abbrev === club;
    const nous = domicile ? m.homeTeam : m.awayTeam;
    const eux = domicile ? m.awayTeam : m.homeTeam;
    const type = (m.gameOutcome && m.gameOutcome.lastPeriodType)
        || (m.periodDescriptor && m.periodDescriptor.periodType) || 'REG';
    const prolongation = type === 'OT' || type === 'SO';
    const pour = Number(nous.score) || 0, contre = Number(eux.score) || 0;

    let issue = 'D';
    if (pour > contre) issue = 'V';
    else if (prolongation) issue = 'DP';
    return {
        issue,
        pour,
        contre,
        adversaire: eux.abbrev || '',
        domicile,
        prolongation: prolongation ? type : null,
        points: scoring.clubPoolPoints({ wins: issue === 'V' ? 1 : 0, otLosses: issue === 'DP' ? 1 : 0 })
    };
}

/**
 * Le rang de chaque équipe avant et après la soirée, au cumulatif.
 *
 *   equipes : dans l'ordre du classement actuel —
 *             [{ teamName, total, soiree, apres }]
 *             total  : le Total affiché (relevés + direct) ;
 *             soiree : les points de la soirée racontée ;
 *             apres  : ceux marqués depuis (la soirée en cours, quand on
 *                      raconte celle d'hier pendant les matchs du jour).
 *
 * « Après » classe le total moins ce qui a suivi la soirée ; « avant »
 * retire en plus la soirée. À égalité, l'ordre actuel est gardé — comme la
 * pastille du classement (rangsAvantSoiree, classement.js) : une égalité ne
 * fait bouger personne sans un point marqué.
 *
 * Renvoie { avant: Map(nom → rang), apres: Map(nom → rang) }.
 */
function rangsDeLaSoiree(equipes) {
    const liste = Array.isArray(equipes) ? equipes : [];
    const classer = valeur => {
        const rangs = new Map();
        liste
            .map((e, ordre) => ({ nom: e.teamName, ordre, v: valeur(e) }))
            .sort((a, b) => (b.v - a.v) || (a.ordre - b.ordre))
            .forEach((e, i) => rangs.set(e.nom, i + 1));
        return rangs;
    };
    const apres = e => (Number(e.total) || 0) - (Number(e.apres) || 0);
    return {
        avant: classer(e => apres(e) - (Number(e.soiree) || 0)),
        apres: classer(apres)
    };
}

/**
 * Le rang de chaque équipe au tête-à-tête : victoires, puis différentiel —
 * computeStandings (classement.js). À égalité parfaite, l'ordre du pool.
 *
 *   equipes   : les noms d'équipe, dans l'ordre du pool ;
 *   standings : h2hData.standings.
 */
function rangsH2H(equipes, standings) {
    const fiche = nom => (standings && standings[nom]) || {};
    const rangs = new Map();
    (Array.isArray(equipes) ? equipes : [])
        .map((nom, ordre) => {
            const s = fiche(nom);
            return { nom, ordre, v: Number(s.wins) || 0, ecart: (Number(s.pointsFor) || 0) - (Number(s.pointsAgainst) || 0) };
        })
        .sort((a, b) => (b.v - a.v) || (b.ecart - a.ecart) || (a.ordre - b.ordre))
        .forEach((e, i) => rangs.set(e.nom, i + 1));
    return rangs;
}

/** 'W', 'L' ou 'T' pour l'équipe qui a `nous` points contre `eux`. */
function issueDuDuel(nous, eux) {
    const a = scoring.arrondi(Number(nous) || 0), b = scoring.arrondi(Number(eux) || 0);
    if (a === b) return 'T';
    return a > b ? 'W' : 'L';
}

/**
 * Le nom qu'une équipe porte à l'écran : « Équipe 3 » laisse place à ses
 * membres (« alex et sam »), comme au classement (getDisplayName).
 */
function nomAffiche(cle, membres) {
    if (/^Équipe \d+$/.test(String(cle)) && Array.isArray(membres) && membres.length > 0) {
        const auto = membres.join(' et ');
        if (auto.length <= 30) return auto;
    }
    return cle;
}

/**
 * La décision d'un gardien pour la soirée : 'BL' (victoire par
 * blanchissage), 'V', 'DP' (défaite en prolongation), 'D', ou null s'il n'a
 * pas de décision connue. `decisions` : celles de ses feuilles de match
 * ('W', 'L', 'O', 'OTL').
 */
function decisionDuGardien({ victoires = 0, blanchissages = 0, decisions = [] } = {}) {
    if (victoires > 0) return blanchissages > 0 ? 'BL' : 'V';
    if (decisions.some(d => d === 'O' || d === 'OTL')) return 'DP';
    if (decisions.some(d => d === 'L')) return 'D';
    return null;
}

module.exports = {
    REESSAI_EN_JEU_MS,
    REESSAI_CALME_MS,
    etatDeLaSoiree,
    choisirSoiree,
    delaiAvantReessai,
    soireeDuClub,
    rangsDeLaSoiree,
    rangsH2H,
    issueDuDuel,
    nomAffiche,
    decisionDuGardien
};
