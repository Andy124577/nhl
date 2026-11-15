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

/** Surnoms en deux mots : partout ailleurs, le dernier mot du nom complet. */
const SURNOMS_DEUX_MOTS = ['Maple Leafs', 'Blue Jackets', 'Red Wings', 'Golden Knights', 'Hockey Club'];

/** « Montréal » / « Canadiens » d'un club, d'après son nom complet. */
function villeEtSurnom(nomComplet, surnomSource) {
    const complet = String(nomComplet || '').trim();
    const surnom = (surnomSource && String(surnomSource).trim())
        || SURNOMS_DEUX_MOTS.find(n => complet.endsWith(n))
        || complet.split(' ').pop() || '';
    const ville = complet.endsWith(surnom) ? complet.slice(0, complet.length - surnom.length).trim() : complet;
    return { ville: ville || complet || surnom, surnom: ville ? surnom : '' };
}

const texteDe = v => (v && typeof v === 'object' ? (v.default || v.fr || '') : (v || ''));

/** Le dernier but inscrit à la feuille du jour, s'il y en a un. */
function dernierBut(m) {
    const buts = Array.isArray(m && m.goals) ? m.goals : [];
    const b = buts[buts.length - 1];
    if (!b) return null;
    const nom = texteDe(b.name) || [texteDe(b.firstName), texteDe(b.lastName)].filter(Boolean).join(' ');
    return {
        nom: nom || null,
        club: String(texteDe(b.teamAbbrev) || '').toUpperCase() || null,
        periode: (b.periodDescriptor && b.periodDescriptor.number) || b.period || null,
        temps: b.timeInPeriod || null
    };
}

/**
 * Le moment de chaque changement de pointage, vu par ce processus.
 *
 * La LNH ne date pas ses buts à l'horloge murale (seulement au temps de jeu).
 * Le serveur relit les pointages toutes les quelques secondes tant qu'une page
 * suit le direct : un pointage qui change entre deux lectures RAPPROCHÉES date
 * donc le but à quelques secondes près. Après un trou de lecture plus long que
 * `ecartMaxMs` (personne en ligne), on ne sait pas quand le but a eu lieu : on
 * ne l'invente pas, le match garde alors l'heure de sa mise au jeu.
 */
function creerSuiviButs({ horloge = () => Date.now(), ecartMaxMs = 2 * 60 * 1000, max = 64 } = {}) {
    const suivis = new Map(); // id → { marque, vu, but }

    function observer(matchs) {
        const maintenant = horloge();
        for (const m of (matchs || [])) {
            if (!m || m.id == null || !m.awayTeam || !m.homeTeam) continue;
            const id = String(m.id);
            const marque = `${m.awayTeam.score ?? 0}-${m.homeTeam.score ?? 0}`;
            const connu = suivis.get(id);
            if (!connu) {
                suivis.set(id, { marque, vu: maintenant, but: null });
            } else {
                if (connu.marque !== marque) {
                    connu.but = maintenant - connu.vu <= ecartMaxMs ? maintenant : null;
                    connu.marque = marque;
                }
                connu.vu = maintenant;
                suivis.delete(id);
                suivis.set(id, connu);
            }
        }
        while (suivis.size > max) suivis.delete(suivis.keys().next().value);
    }

    /** ISO du dernier but daté de ce match, ou null. */
    function butDe(id) {
        const s = suivis.get(String(id));
        return s && s.but ? new Date(s.but).toISOString() : null;
    }

    return { observer, butDe };
}

/**
 * Les matchs du jour commencés, en « rapports de match » : pointage, période,
 * dernier but, et ce que mes joueurs et mes clubs m'y ont rapporté.
 *
 *   mesJoueurs : [{ nom, playerId, club }] — l'identifiant et le club viennent
 *                du relevé (un joueur inconnu du relevé n'est rattaché à
 *                aucun match : on ne devine pas son club) ;
 *   mesClubs   : ['MTL', …] — les clubs repêchés ;
 *   soirees    : { joueurs: { id: { etat, ppa } }, clubs: { ABR: { etat, ppa } } }
 *                (lib/pointsEnDirect.js, soireesDuJour). `ppa` est la soirée
 *                du jour dès que le match du joueur a commencé ;
 *   butDe      : id → ISO du dernier but (creerSuiviButs) ;
 *   nomsClubs  : ABR → nom complet.
 *
 * `moment` est l'heure du dernier but quand on la connaît, sinon la mise au
 * jeu : un but fait remonter son match en tête du fil.
 */
function rapportsDeMatch(matchs, { mesJoueurs = [], mesClubs = [], soirees = {}, aujourdhui, butDe = () => null, nomsClubs = {} } = {}) {
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
    const cote = t => {
        const abbrev = String(t.abbrev || '').toUpperCase();
        const { ville, surnom } = villeEtSurnom(nomsClubs[abbrev] || texteDe(t.placeName) || abbrev, texteDe(t.commonName) || texteDe(t.name));
        return { abbrev, ville, surnom, score: t.score ?? null };
    };

    const sortie = [];
    for (const m of (matchs || [])) {
        if (!m || !m.awayTeam || !m.homeTeam) continue;
        if (aujourdhui && journeeDe(m.gameDate) && journeeDe(m.gameDate) !== aujourdhui) continue;
        const etat = etatDuMatch(m);
        if (etat === 'FUT') continue;
        const visiteur = cote(m.awayTeam);
        const local = cote(m.homeTeam);
        const abbrevs = [visiteur.abbrev, local.abbrev];
        const joueurs = abbrevs.flatMap(a => parClub.get(a) || []).map(j => {
            const s = sj[j.playerId] || {};
            return { nom: j.nom, points: s.etat && s.etat !== 'FUT' ? (s.ppa || 0) : 0 };
        });
        const clubs = abbrevs.filter(a => clubsRepeches.has(a)).map(a => {
            const s = sc[a] || {};
            return { club: a, points: s.etat && s.etat !== 'FUT' ? (s.ppa || 0) : 0 };
        });
        const points = [...joueurs, ...clubs].reduce((t, x) => t + (Number(x.points) || 0), 0);
        const but = m.id != null ? butDe(m.id) : null;
        sortie.push({
            type: 'match',
            id: m.id,
            etat,
            debut: m.startTimeUTC || null,
            moment: but || m.startTimeUTC || null,
            jour: m.gameDate || aujourdhui || null,
            but,
            dernierBut: dernierBut(m),
            periode: (m.periodDescriptor && m.periodDescriptor.number) || null,
            typePeriode: (m.periodDescriptor && m.periodDescriptor.periodType) || null,
            horloge: (m.clock && m.clock.timeRemaining) || null,
            entracte: !!(m.clock && m.clock.inIntermission),
            visiteur,
            local,
            mien: joueurs.length > 0 || clubs.length > 0,
            joueurs: joueurs.sort((a, b) => b.points - a.points || a.nom.localeCompare(b.nom, 'fr')),
            clubs,
            points: Math.round(points * 10) / 10
        });
    }
    const instant = x => (x.moment ? Date.parse(x.moment) || 0 : 0);
    sortie.sort((a, b) => instant(b) - instant(a));
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
    rapportsDeMatch,
    creerSuiviButs,
    villeEtSurnom,
    activiteUtile,
    etatDuMatch,
    JOURS_BLESSURES,
    JOURS_MOUVEMENTS
};
