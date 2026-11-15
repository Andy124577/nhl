/**
 * « Récents » : le fil de ce qui vient d'arriver dans un pool.
 *
 * Ce module ne lit rien : il reçoit ce que le serveur a déjà en mémoire (le
 * rapport des blessés, le journal des mouvements LNH, la soirée de chaque
 * joueur, les matchs du jour) et le fil d'activité du pool, et il en garde ce
 * qui touche CE pool. Une blessure ou un échange de la LNH n'entre dans le fil
 * que si le joueur appartient à une équipe du pool : sans ce filtre, les
 * trois cents blessés de la ligue noieraient tout le reste.
 *
 * Pur : ni réseau, ni horloge, ni base. La route (routes/recents.js) fournit
 * la journée et les sources.
 */

'use strict';

/** Les catégories d'un alignement qui portent des joueurs (les clubs à part). */
const CATEGORIES_JOUEURS = ['offensive', 'defensive', 'rookie', 'goalie', 'bench'];

/** Une blessure ou un mouvement plus vieux que ça n'est plus « récent ». */
const JOURS_BLESSURES = 21;
const JOURS_MOUVEMENTS = 14;

/** Au plus autant d'entrées par source : le fil se lit d'un coup d'œil. */
const MAX_PAR_SOURCE = 25;

const ETATS_EN_JEU = new Set(['LIVE', 'CRIT']);
const ETATS_FINIS = new Set(['FINAL', 'OFF']);

/**
 * Nom comparable d'une source à l'autre : sans accents, sans ponctuation, sans
 * suffixe générationnel. Même règle que injuryNameKey (server.js) et
 * injNormalizeName (injuries.js).
 */
function cleNom(valeur) {
    return String(valeur || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z]+/g, ' ')
        .replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Le nom d'une entrée d'alignement : une chaîne, ou un objet de la trousse. */
function nomDe(p) {
    if (typeof p === 'string') return p;
    return (p && (p.nom || p.skaterFullName || p.goalieFullName || p.teamFullName || p.name)) || null;
}

/**
 * Qui possède quel joueur dans le pool : clé de nom → { nom, equipe, mien }.
 * Un joueur sur deux équipes (pool sans exclusivité) garde la mienne d'abord.
 */
function indexerJoueursDuPool(poolData, monEquipe) {
    const index = new Map();
    for (const [equipe, data] of Object.entries((poolData && poolData.teams) || {})) {
        if (!data || !(data.members || []).length) continue;
        for (const cat of CATEGORIES_JOUEURS) {
            for (const p of (data[cat] || [])) {
                const nom = nomDe(p);
                const cle = cleNom(nom);
                if (!cle) continue;
                const mien = equipe === monEquipe;
                if (!index.has(cle) || (mien && !index.get(cle).mien)) {
                    index.set(cle, { nom, equipe, mien });
                }
            }
        }
    }
    return index;
}

/** La journée (AAAA-MM-JJ) d'une date ISO, ou null. */
function journeeDe(valeur) {
    const texte = String(valeur || '');
    return /^\d{4}-\d{2}-\d{2}/.test(texte) ? texte.slice(0, 10) : null;
}

/** Écart en jours entre deux journées AAAA-MM-JJ (b - a). */
function joursEntre(a, b) {
    return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

/**
 * Les blessés qui appartiennent à une équipe du pool, les miens d'abord à
 * date égale. Une blessure sans date (Rotowire) reste : elle est en cours,
 * c'est l'information qui compte ; elle passe après les datées.
 */
function blessuresDuPool(blesses, index, { aujourdhui, nomEquipe = n => n } = {}) {
    const sortie = [];
    for (const b of (blesses || [])) {
        const proprio = index.get(cleNom(b && b.playerName));
        if (!proprio) continue;
        const jour = journeeDe(b.since);
        if (jour && aujourdhui && joursEntre(jour, aujourdhui) > JOURS_BLESSURES) continue;
        sortie.push({
            type: 'blessure',
            moment: b.since || null,
            mien: proprio.mien,
            equipe: nomEquipe(proprio.equipe),
            joueur: proprio.nom,
            club: b.team || null,
            statut: b.status || null,
            statutFr: b.statusFr || b.status || null,
            nature: b.injuryType || null,
            detail: b.injuryDetail || null,
            cote: b.injurySide || null,
            retour: b.returnDate || null,
            photo: b.headshot || null
        });
    }
    const instant = e => (e.moment ? Date.parse(e.moment) || 0 : 0);
    sortie.sort((a, b) => instant(b) - instant(a) || (b.mien - a.mien));
    return sortie.slice(0, MAX_PAR_SOURCE);
}

/**
 * Les mouvements de la LNH (échanges, ballottages, signatures…) qui touchent
 * un joueur du pool, dans la fenêtre récente.
 */
function mouvementsDuPool(journal, index, { aujourdhui, nomEquipe = n => n } = {}) {
    const sortie = [];
    for (const t of ((journal && journal.transactions) || [])) {
        const proprio = index.get(cleNom(t && t.playerName));
        if (!proprio) continue;
        const jour = journeeDe(t.date);
        if (!jour || (aujourdhui && joursEntre(jour, aujourdhui) > JOURS_MOUVEMENTS)) continue;
        sortie.push({
            type: 'lnh',
            genre: t.type || null,
            moment: `${jour}T12:00:00Z`,
            jour,
            mien: proprio.mien,
            equipe: nomEquipe(proprio.equipe),
            joueur: proprio.nom,
            de: t.fromTeam || null,
            vers: t.toTeam || null,
            photo: t.headshot || null
        });
    }
    sortie.sort((a, b) => b.jour.localeCompare(a.jour) || (b.mien - a.mien));
    return sortie.slice(0, MAX_PAR_SOURCE);
}

/** 'LIVE' | 'FINAL' | 'FUT' pour un match de /v1/score. */
function etatDuMatch(m) {
    const etat = m && m.gameState;
    if (ETATS_EN_JEU.has(etat)) return 'LIVE';
    if (ETATS_FINIS.has(etat)) return 'FINAL';
    return 'FUT';
}

/**
 * Les matchs du jour où joue au moins un de mes joueurs ou de mes clubs, avec
 * les points que chacun m'a rapportés ce soir.
 *
 *   mesJoueurs : [{ nom, playerId, club }] — l'identifiant et le club viennent
 *                du relevé (un joueur inconnu du relevé n'est rattaché à
 *                aucun match : on ne devine pas son club) ;
 *   mesClubs   : ['MTL', …] — les clubs repêchés ;
 *   soirees    : { joueurs: { id: { etat, ppa } }, clubs: { ABR: { etat, ppa } } }
 *                (lib/pointsEnDirect.js, soireesDuJour). `ppa` est la soirée
 *                du jour dès que le match du joueur a commencé.
 */
function matchsDeMaSoiree(matchs, { mesJoueurs = [], mesClubs = [], soirees = {}, aujourdhui } = {}) {
    const parClub = new Map();
    for (const j of mesJoueurs) {
        const club = String(j.club || '').split(',').pop().trim().toUpperCase();
        if (!club) continue;
        if (!parClub.has(club)) parClub.set(club, []);
        parClub.get(club).push(j);
    }
    const clubsRepeches = new Set(mesClubs.map(c => String(c || '').toUpperCase()).filter(Boolean));
    const sj = (soirees && soirees.joueurs) || {};
    const sc = (soirees && soirees.clubs) || {};

    const sortie = [];
    for (const m of (matchs || [])) {
        if (!m || !m.awayTeam || !m.homeTeam) continue;
        if (aujourdhui && journeeDe(m.gameDate) && journeeDe(m.gameDate) !== aujourdhui) continue;
        const etat = etatDuMatch(m);
        const commence = etat !== 'FUT';
        const abbrevs = [m.awayTeam.abbrev, m.homeTeam.abbrev].map(a => String(a || '').toUpperCase());
        const joueurs = abbrevs.flatMap(a => parClub.get(a) || []).map(j => {
            const s = sj[j.playerId] || {};
            return { nom: j.nom, points: commence && s.etat && s.etat !== 'FUT' ? (s.ppa || 0) : 0 };
        });
        const clubs = abbrevs.filter(a => clubsRepeches.has(a)).map(a => {
            const s = sc[a] || {};
            return { club: a, points: commence && s.etat && s.etat !== 'FUT' ? (s.ppa || 0) : 0 };
        });
        if (!joueurs.length && !clubs.length) continue;
        const points = [...joueurs, ...clubs].reduce((t, x) => t + (Number(x.points) || 0), 0);
        sortie.push({
            type: 'match',
            id: m.id,
            etat,
            debut: m.startTimeUTC || null,
            periode: (m.periodDescriptor && m.periodDescriptor.number) || null,
            typePeriode: (m.periodDescriptor && m.periodDescriptor.periodType) || null,
            horloge: (m.clock && m.clock.timeRemaining) || null,
            entracte: !!(m.clock && m.clock.inIntermission),
            visiteur: { abbrev: abbrevs[0], score: m.awayTeam.score ?? null },
            local: { abbrev: abbrevs[1], score: m.homeTeam.score ?? null },
            joueurs: joueurs.sort((a, b) => b.points - a.points || a.nom.localeCompare(b.nom, 'fr')),
            clubs,
            points: Math.round(points * 10) / 10
        });
    }
    const rang = e => (e === 'LIVE' ? 0 : e === 'FUT' ? 1 : 2);
    sortie.sort((a, b) => rang(a.etat) - rang(b.etat) || (Date.parse(a.debut || 0) || 0) - (Date.parse(b.debut || 0) || 0));
    return sortie;
}

/**
 * Le fil d'activité du pool, sans ce qui n'est pas une nouvelle : les choix
 * un à un du repêchage (le récapitulatif les montre) et une mise en vente
 * déjà retirée (l'annonce n'existe plus, l'offrir mènerait nulle part).
 */
function activiteUtile(evenements) {
    const liste = (evenements || []).filter(e => e && e.type !== 'pick' && e.type !== 'draft_started');
    const retirees = new Set();
    const echanges = new Set();
    const sortie = [];
    // Du plus récent au plus ancien : un retrait vu avant sa mise en vente
    // l'efface.
    for (const e of liste) {
        const sujet = e.sujet || {};
        const cle = `${sujet.teamName || ''}|${cleNom(sujet.playerName)}`;
        if (e.type === 'listing_removed') { retirees.add(cle); continue; }
        // Un échange conclu retire l'annonce de ses joueurs sans journaliser
        // de retrait (routes/trades.js) : le joueur échangé n'est plus à vendre.
        if (e.type === 'trade_completed') {
            for (const nom of [...(sujet.offering || []), ...(sujet.receiving || [])]) echanges.add(cleNom(nom));
        }
        if (e.type === 'listing_activated' && (retirees.has(cle) || echanges.has(cleNom(sujet.playerName)))) continue;
        sortie.push({ type: 'pool', genre: e.type, moment: e.occurredAt, texte: e.texte || '', sujet, revisee: !!e.revisee });
    }
    return sortie.slice(0, MAX_PAR_SOURCE);
}

module.exports = {
    cleNom,
    indexerJoueursDuPool,
    blessuresDuPool,
    mouvementsDuPool,
    matchsDeMaSoiree,
    activiteUtile,
    etatDuMatch,
    JOURS_BLESSURES,
    JOURS_MOUVEMENTS
};
