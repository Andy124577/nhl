/**
 * Feuille de match — ce que la page match.html affiche d'un match de la LNH.
 *
 * La LNH répartit un match sur trois réponses de `gamecenter/{id}` :
 *
 *   - `boxscore`   : l'en-tête (équipes, marque, horloge) et la ligne de
 *                    chaque joueur. Seule réponse indispensable ;
 *   - `right-rail` : le pointage et les tirs par période, les statistiques
 *                    d'équipe et les duels de la saison entre les deux clubs ;
 *   - `landing`    : le récit — buts avec leurs aides, tirs de barrage,
 *                    pénalités et trois étoiles.
 *
 * Ce module les fond en une seule réponse, sans rien inventer : une valeur
 * que la LNH ne donne pas sort `null` (ou une liste vide), jamais zéro. Un
 * match à venir n'a pas de feuille de joueurs, et `players: null` le dit ;
 * un tableau de zéros ferait croire à un match joué sans un tir.
 *
 * Fonctions pures, sans réseau : le service `services/feuilleMatch.js` va
 * chercher les réponses et garde le résultat en cache le temps que dicte
 * `dureeDeVie`.
 */

'use strict';

/** États d'un match commencé : il a une feuille de joueurs. */
const ETATS_JOUES = new Set(['LIVE', 'CRIT', 'FINAL', 'OFF']);

/**
 * Combien de temps garder une feuille, selon l'état du match.
 *
 *   - en cours : quelques secondes, la page se relit toutes les trente ;
 *   - FINAL    : la sirène vient de sonner, la LNH corrige encore les
 *                statistiques (une aide ajoutée, un tir retiré) ;
 *   - OFF      : officiel, ne bougera plus ;
 *   - à venir  : l'alignement et l'heure peuvent changer.
 */
const TTL_MS = {
    LIVE: 20 * 1000,
    CRIT: 20 * 1000,
    FINAL: 2 * 60 * 1000,
    OFF: 6 * 60 * 60 * 1000,
    AUTRE: 5 * 60 * 1000
};

function dureeDeVie(etat) {
    return TTL_MS[etat] || TTL_MS.AUTRE;
}

/** `{ default, fr }` de la LNH → la version française si elle existe. */
function texte(valeur) {
    if (valeur == null) return '';
    if (typeof valeur === 'string') return valeur;
    return valeur.fr || valeur.default || '';
}

/** Un nombre, ou null si la LNH n'en a pas donné. */
function nombre(valeur) {
    return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : null;
}

function periode(descripteur) {
    return {
        number: nombre(descripteur?.number),
        type: descripteur?.periodType || 'REG'
    };
}

function equipe(brute) {
    return {
        abbrev: brute?.abbrev || '',
        name: texte(brute?.commonName),
        place: texte(brute?.placeNameWithPreposition) || texte(brute?.placeName),
        score: nombre(brute?.score),
        sog: nombre(brute?.sog)
    };
}

/** « 12:08 » tel quel ; une chaîne vide si absente. */
function temps(valeur) {
    return typeof valeur === 'string' ? valeur : '';
}

function patineur(p) {
    return {
        playerId: nombre(p.playerId),
        number: nombre(p.sweaterNumber),
        name: texte(p.name),
        position: p.position || '',
        goals: nombre(p.goals),
        assists: nombre(p.assists),
        points: nombre(p.points),
        plusMinus: nombre(p.plusMinus),
        pim: nombre(p.pim),
        sog: nombre(p.sog),
        hits: nombre(p.hits),
        blockedShots: nombre(p.blockedShots),
        powerPlayGoals: nombre(p.powerPlayGoals),
        giveaways: nombre(p.giveaways),
        takeaways: nombre(p.takeaways),
        shifts: nombre(p.shifts),
        toi: temps(p.toi)
    };
}

/**
 * Un gardien habillé qui n'a pas joué une seconde a quand même sa ligne — la
 * LNH la donne, avec « 00:00 » au temps de glace. `played` le dit, pour que
 * la page n'affiche pas « .000 » comme s'il avait tout laissé passer.
 */
function gardien(g) {
    const tirs = nombre(g.shotsAgainst);
    const toi = temps(g.toi);
    return {
        playerId: nombre(g.playerId),
        number: nombre(g.sweaterNumber),
        name: texte(g.name),
        shotsAgainst: tirs,
        saves: nombre(g.saves),
        goalsAgainst: nombre(g.goalsAgainst),
        savePct: tirs ? nombre(g.savePctg) : null,
        evenStrength: temps(g.evenStrengthShotsAgainst),
        powerPlay: temps(g.powerPlayShotsAgainst),
        shortHanded: temps(g.shorthandedShotsAgainst),
        pim: nombre(g.pim),
        toi,
        decision: g.decision || null,
        starter: typeof g.starter === 'boolean' ? g.starter : null,
        played: !!toi && toi !== '00:00'
    };
}

function alignement(cote) {
    return {
        forwards: (cote?.forwards || []).map(patineur),
        defense: (cote?.defense || []).map(patineur),
        goalies: (cote?.goalies || []).map(gardien)
    };
}

function joueurs(boxscore) {
    const stats = boxscore?.playerByGameStats;
    if (!stats) return null;
    return { away: alignement(stats.awayTeam), home: alignement(stats.homeTeam) };
}

function parPeriode(liste) {
    return (liste || []).map(p => ({
        ...periode(p.periodDescriptor),
        away: nombre(p.away),
        home: nombre(p.home)
    }));
}

function pointage(rail) {
    const ligne = rail?.linescore;
    if (!ligne) return null;
    const tb = ligne.shootout;
    return {
        periods: parPeriode(ligne.byPeriod),
        totals: { away: nombre(ligne.totals?.away), home: nombre(ligne.totals?.home) },
        shootout: tb ? {
            away: { goals: nombre(tb.awayConversions), attempts: nombre(tb.awayAttempts) },
            home: { goals: nombre(tb.homeConversions), attempts: nombre(tb.homeAttempts) }
        } : null
    };
}

/**
 * Les statistiques d'équipe, dans l'ordre où la page les montre.
 *
 * La LNH donne les pourcentages et leurs fractions en deux catégories
 * séparées (`powerPlayPctg` 0,4 et `powerPlay` « 2/5 ») ; ils sont réunis
 * ici en une ligne, la fraction en `detail`. Une catégorie absente est
 * omise plutôt que remplie de zéros.
 */
const STATS_EQUIPE = [
    { key: 'sog', value: 'sog' },
    { key: 'faceoffPct', value: 'faceoffWinningPctg', detail: 'faceoffWins' },
    { key: 'powerPlayPct', value: 'powerPlayPctg', detail: 'powerPlay' },
    { key: 'pim', value: 'pim' },
    { key: 'hits', value: 'hits' },
    { key: 'blockedShots', value: 'blockedShots' },
    { key: 'giveaways', value: 'giveaways' },
    { key: 'takeaways', value: 'takeaways' }
];

function statsEquipe(rail) {
    const parCle = new Map((rail?.teamGameStats || []).map(s => [s.category, s]));
    const lignes = [];
    for (const def of STATS_EQUIPE) {
        const s = parCle.get(def.value);
        if (!s) continue;
        const detail = def.detail && parCle.get(def.detail);
        lignes.push({
            key: def.key,
            away: nombre(Number(s.awayValue)),
            home: nombre(Number(s.homeValue)),
            detail: detail ? { away: String(detail.awayValue ?? ''), home: String(detail.homeValue ?? '') } : null
        });
    }
    return lignes;
}

function serie(rail) {
    return (rail?.seasonSeries || []).map(m => ({
        id: nombre(m.id),
        gameType: nombre(m.gameType),
        gameDate: m.gameDate || '',
        startTimeUTC: m.startTimeUTC || '',
        state: m.gameState || '',
        lastPeriodType: m.gameOutcome?.lastPeriodType || null,
        away: { abbrev: m.awayTeam?.abbrev || '', score: nombre(m.awayTeam?.score) },
        home: { abbrev: m.homeTeam?.abbrev || '', score: nombre(m.homeTeam?.score) }
    }));
}

function nomComplet(joueur) {
    return [texte(joueur?.firstName), texte(joueur?.lastName)].filter(Boolean).join(' ')
        || texte(joueur?.name);
}

function but(b) {
    return {
        playerId: nombre(b.playerId),
        name: nomComplet(b),
        teamAbbrev: texte(b.teamAbbrev),
        goalsToDate: nombre(b.goalsToDate),
        timeInPeriod: temps(b.timeInPeriod),
        strength: b.strength || 'ev',
        modifier: b.goalModifier && b.goalModifier !== 'none' ? b.goalModifier : null,
        shotType: b.shotType || null,
        awayScore: nombre(b.awayScore),
        homeScore: nombre(b.homeScore),
        headshot: b.headshot || '',
        assists: (b.assists || []).map(a => ({
            playerId: nombre(a.playerId),
            name: nomComplet(a),
            assistsToDate: nombre(a.assistsToDate)
        }))
    };
}

/**
 * Les buts par période. Celle des tirs de barrage est retirée : la LNH y
 * range le seul but décisif, déjà compté par `shootout`, qui donne toute la
 * séance tir par tir.
 */
function buts(landing) {
    return (landing?.summary?.scoring || [])
        .filter(p => p.periodDescriptor?.periodType !== 'SO')
        .map(p => ({ ...periode(p.periodDescriptor), goals: (p.goals || []).map(but) }));
}

function tirsDeBarrage(landing) {
    return (landing?.summary?.shootout?.events || []).map(t => ({
        playerId: nombre(t.playerId),
        name: nomComplet(t),
        teamAbbrev: texte(t.teamAbbrev),
        result: t.result || '',
        gameWinner: !!t.gameWinner
    }));
}

/**
 * Une pénalité de banc (trop de joueurs sur la glace) n'a pas de fautif,
 * seulement un joueur qui la purge : `player` reste vide, `servedBy` le nomme.
 */
function penalite(p) {
    return {
        timeInPeriod: temps(p.timeInPeriod),
        type: p.type || '',
        duration: nombre(p.duration),
        teamAbbrev: texte(p.teamAbbrev),
        descKey: p.descKey || '',
        player: p.committedByPlayer ? nomComplet(p.committedByPlayer) : '',
        servedBy: p.servedBy ? (texte(p.servedBy) || nomComplet(p.servedBy)) : '',
        drawnBy: p.drawnBy ? nomComplet(p.drawnBy) : ''
    };
}

function penalites(landing) {
    return (landing?.summary?.penalties || [])
        .map(p => ({ ...periode(p.periodDescriptor), penalties: (p.penalties || []).map(penalite) }));
}

function etoiles(landing) {
    return (landing?.summary?.threeStars || []).map(e => ({
        star: nombre(e.star),
        playerId: nombre(e.playerId),
        name: texte(e.name),
        teamAbbrev: texte(e.teamAbbrev),
        position: e.position || '',
        number: nombre(e.sweaterNo),
        headshot: e.headshot || '',
        goals: nombre(e.goals),
        assists: nombre(e.assists),
        points: nombre(e.points),
        savePct: nombre(e.savePctg),
        goalsAgainstAverage: nombre(e.goalsAgainstAverage)
    }));
}

/**
 * Fond les trois réponses de la LNH. Seul `boxscore` est requis ; sans
 * `rightRail` ni `landing`, les sections qui en dépendent sortent vides.
 */
function formerFeuille({ boxscore, rightRail = null, landing = null }) {
    if (!boxscore || !boxscore.id) throw new Error('feuille de match : boxscore manquant');
    const etat = boxscore.gameState || '';
    const horloge = boxscore.clock;
    return {
        id: boxscore.id,
        season: nombre(boxscore.season),
        gameType: nombre(boxscore.gameType),
        gameDate: boxscore.gameDate || '',
        startTimeUTC: boxscore.startTimeUTC || '',
        venue: texte(boxscore.venue),
        state: etat,
        started: ETATS_JOUES.has(etat),
        ...periodeCourante(boxscore),
        lastPeriodType: boxscore.gameOutcome?.lastPeriodType || null,
        clock: horloge ? {
            timeRemaining: temps(horloge.timeRemaining),
            running: !!horloge.running,
            inIntermission: !!horloge.inIntermission
        } : null,
        away: equipe(boxscore.awayTeam),
        home: equipe(boxscore.homeTeam),
        players: joueurs(boxscore),
        linescore: pointage(rightRail),
        shotsByPeriod: parPeriode(rightRail?.shotsByPeriod),
        teamStats: statsEquipe(rightRail),
        seasonSeries: serie(rightRail),
        seasonSeriesWins: rightRail?.seasonSeriesWins ? {
            away: nombre(rightRail.seasonSeriesWins.awayTeamWins),
            home: nombre(rightRail.seasonSeriesWins.homeTeamWins)
        } : null,
        scoring: buts(landing),
        shootout: tirsDeBarrage(landing),
        penalties: penalites(landing),
        threeStars: etoiles(landing)
    };
}

function periodeCourante(boxscore) {
    const p = periode(boxscore.periodDescriptor);
    return { period: p.number, periodType: boxscore.periodDescriptor ? p.type : null };
}

module.exports = { formerFeuille, dureeDeVie, ETATS_JOUES, TTL_MS };
