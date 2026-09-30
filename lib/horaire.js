/**
 * L'état des matchs du calendrier : le même que celui de la feuille de match.
 *
 * Le 30 septembre 2026, calendrier.html montrait encore Vancouver-Edmonton
 * « En direct » (5-4, 3e période) le lendemain matin, alors que la feuille du
 * match (match.html) le disait terminé depuis des heures. Deux causes :
 *
 *   - le cache de /schedule/:date se réglait sur la date DEMANDÉE. La page
 *     demande toujours le lundi de la semaine : dès le mercredi, ce lundi
 *     était « loin » d'aujourd'hui, et la semaine en cours restait douze
 *     heures telle qu'on l'avait lue pendant le match ;
 *   - l'horaire de la LNH (/v1/schedule) est lui-même le flux le plus lent :
 *     rien ne le recoupait avec /score/now ni avec la feuille du match.
 *
 * Ici, ce qui règle les deux : une garde courte pour toute semaine qui touche
 * aujourd'hui ou qui dit un match en cours, et une fusion qui fait AVANCER
 * l'état d'un match d'après une source plus fraîche — jamais reculer : les
 * flux de la LNH ne tombent pas en panne ensemble, et une carte terminée ne
 * doit pas repartir en première période. La fin d'un match n'est jamais
 * déduite de l'heure : l'heure ne sert qu'à décider quand aller vérifier.
 *
 * Pur : ni réseau, ni horloge.
 */

'use strict';

const RANG = { FUT: 0, PRE: 0, LIVE: 1, CRIT: 1, FINAL: 2, OFF: 3 };
const EN_COURS = new Set(['LIVE', 'CRIT']);

/**
 * Au-delà, un match « en cours » est revérifié sur sa feuille : trois heures
 * après la mise au jeu, la plupart sont finis, et un flux figé se voit.
 */
const VERIFIER_APRES_MS = 3 * 60 * 60 * 1000;

/** Rang d'un état : à venir, en cours, fini, officiel. Inconnu : à venir. */
function rangEtat(etat) {
    return RANG[etat] ?? 0;
}

function horloge(h) {
    return h ? { timeRemaining: h.timeRemaining || '', inIntermission: !!h.inIntermission } : null;
}

/** Un match brut de /v1/score (now ou d'une journée) → son état frais. */
function etatDeScore(g) {
    if (!g || g.id == null) return null;
    return {
        id: Number(g.id),
        state: g.gameState || '',
        period: (g.periodDescriptor && g.periodDescriptor.number) ?? null,
        periodType: (g.periodDescriptor && g.periodDescriptor.periodType) || null,
        clock: horloge(g.clock),
        away: (g.awayTeam && g.awayTeam.score) ?? null,
        home: (g.homeTeam && g.homeTeam.score) ?? null
    };
}

/** Une feuille de match (lib/boxscore.js, formerFeuille) → son état frais. */
function etatDeFeuille(f) {
    if (!f || f.id == null) return null;
    return {
        id: Number(f.id),
        state: f.state || '',
        period: f.period ?? null,
        periodType: f.periodType || null,
        clock: horloge(f.clock),
        away: (f.away && f.away.score) ?? null,
        home: (f.home && f.home.score) ?? null
    };
}

/** Le plus avancé de deux états frais (le premier à rang égal). */
function plusAvance(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return rangEtat(b.state) > rangEtat(a.state) ? b : a;
}

/**
 * Un match du calendrier ({ id, state, period, periodType, clock, away, home }),
 * avancé par un état plus frais. À rang égal, le plus frais donne le
 * pointage et la période ; à rang inférieur, il est ignoré.
 */
function fusionnerMatch(partie, frais) {
    if (!partie || !frais || rangEtat(frais.state) < rangEtat(partie.state)) return partie;
    return {
        ...partie,
        state: frais.state,
        period: frais.period ?? partie.period,
        periodType: frais.periodType || partie.periodType,
        clock: frais.clock || (EN_COURS.has(frais.state) ? partie.clock : null),
        away: { ...(partie.away || {}), score: frais.away ?? (partie.away && partie.away.score) },
        home: { ...(partie.home || {}), score: frais.home ?? (partie.home && partie.home.score) }
    };
}

/**
 * Un match brut de /v1/score, avancé d'après sa feuille (formerFeuille) :
 * même forme qu'avant, état, pointage, période et issue à jour. Une feuille
 * moins avancée que le match ne change rien.
 */
function avancerMatchBrut(g, feuille) {
    const frais = etatDeFeuille(feuille);
    if (!g || !frais || rangEtat(frais.state) <= rangEtat(g.gameState)) return g;
    const periode = g.periodDescriptor || {};
    return {
        ...g,
        gameState: frais.state,
        awayTeam: { ...(g.awayTeam || {}), score: frais.away ?? (g.awayTeam && g.awayTeam.score) },
        homeTeam: { ...(g.homeTeam || {}), score: frais.home ?? (g.homeTeam && g.homeTeam.score) },
        periodDescriptor: { ...periode, number: frais.period ?? periode.number, periodType: frais.periodType || periode.periodType },
        gameOutcome: feuille.lastPeriodType ? { ...(g.gameOutcome || {}), lastPeriodType: feuille.lastPeriodType } : g.gameOutcome
    };
}

/** Le calendrier (réponse de /schedule/:date), chaque match avancé par `frais` (Map id → état). */
function fusionnerHoraire(horaire, frais) {
    if (!horaire || !Array.isArray(horaire.days) || !frais || !frais.size) return horaire;
    return {
        ...horaire,
        days: horaire.days.map(jour => ({
            ...jour,
            games: (jour.games || []).map(g => fusionnerMatch(g, frais.get(Number(g.id))))
        }))
    };
}

/**
 * Les matchs d'un calendrier encore dits en cours qu'il faut aller vérifier
 * sur leur feuille : absents de `connus` (ce que /score/now vouche), ou
 * commencés depuis plus de VERIFIER_APRES_MS.
 */
function matchsAVerifier(horaire, { connus = new Set(), maintenant = 0 } = {}) {
    const ids = [];
    for (const jour of (horaire && horaire.days) || []) {
        for (const g of jour.games || []) {
            if (!EN_COURS.has(g.state)) continue;
            const debut = Date.parse(g.startTimeUTC);
            const long = Number.isFinite(debut) && maintenant - debut > VERIFIER_APRES_MS;
            if (!connus.has(Number(g.id)) || long) ids.push(Number(g.id));
        }
    }
    return ids;
}

/** Les matchs bruts de /v1/score dits en cours depuis plus de VERIFIER_APRES_MS. */
function brutsAVerifier(games, maintenant) {
    return (games || [])
        .filter(g => g && EN_COURS.has(g.gameState))
        .filter(g => {
            const debut = Date.parse(g.startTimeUTC);
            return Number.isFinite(debut) && maintenant - debut > VERIFIER_APRES_MS;
        })
        .map(g => Number(g.id));
}

/** 'YYYY-MM-DD' décalé de `n` jours. */
function decaler(jour, n) {
    const d = new Date(`${jour}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

/**
 * Durée de garde d'une semaine de calendrier demandée à la date `demande`.
 * Courte si la semaine (demandée ou reçue) touche la veille, le jour ou le
 * lendemain, ou si l'un de ses matchs est dit en cours ; longue sinon.
 */
function dureeGardeHoraire(horaire, { aujourdhui, demande = null, courtMs, longMs }) {
    const veille = decaler(aujourdhui, -1);
    const lendemain = decaler(aujourdhui, 1);
    const jours = ((horaire && horaire.days) || []).map(d => d.date);
    if (demande) jours.push(demande, decaler(demande, 6));
    const touche = jours.some(j => j && j >= veille && j <= lendemain)
        || (demande && demande <= lendemain && decaler(demande, 6) >= veille);
    const enCours = ((horaire && horaire.days) || []).some(d => (d.games || []).some(g => EN_COURS.has(g.state)));
    return touche || enCours ? courtMs : longMs;
}

module.exports = {
    RANG,
    VERIFIER_APRES_MS,
    rangEtat,
    etatDeScore,
    etatDeFeuille,
    plusAvance,
    fusionnerMatch,
    avancerMatchBrut,
    fusionnerHoraire,
    matchsAVerifier,
    brutsAVerifier,
    dureeGardeHoraire
};
