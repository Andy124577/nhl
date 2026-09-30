/**
 * Le relevé nocturne des totaux de saison — exact au match près.
 *
 * Les totaux du classement cumulatif sont relevés une fois par nuit : ceux
 * des joueurs dans /current-stats, ceux des clubs dans /current-teams. Entre
 * deux relevés, les points en direct (lib/pointsEnDirect.js) ajoutent ce qui
 * leur manque. Pour ne rien oublier ni rien compter deux fois, il faut savoir
 * EXACTEMENT quels matchs un relevé comprend.
 *
 * L'ancien relevé ne le savait pas. Il lisait les totaux de saison de la
 * fiche d'un joueur (/landing) et devinait les matchs compris d'après le
 * « dernier match » de la même fiche. Le 29 septembre 2026, le relevé de
 * minuit est tombé pendant Vancouver-Edmonton et Chicago-Vegas : les totaux
 * de la fiche ne comprenaient pas encore ces matchs, le dernier match noté,
 * si. Personne ne les comptait plus — ni le relevé, ni le direct — et les
 * points des deux matchs manquaient au classement jusqu'à la nuit suivante.
 *
 * Désormais :
 *
 *   - un joueur est relevé d'après son JOURNAL de matchs (/game-log), une
 *     ligne par match. Les matchs d'avant la fenêtre (la veille et le jour du
 *     relevé) sont tous finis et tous comptés ; dans la fenêtre, seuls les
 *     matchs officiels (OFF) au moment du relevé le sont, et leur liste est
 *     notée ;
 *   - un club est relevé d'après le classement DATÉ de l'avant-veille — qui
 *     comprend tous les matchs jusque-là — plus les matchs finis de la
 *     fenêtre, notés eux aussi.
 *
 * Un match de la fenêtre qui n'est pas dans la liste est compté par le
 * direct ; un match qui y est ne l'est pas. Plus rien à deviner.
 *
 * Pur : ni réseau, ni horloge.
 */

'use strict';

const scoring = require('./scoring.js');

/**
 * Version du format des relevés. Un relevé d'un autre format (sans
 * inclusion) est refait au démarrage : c'est ce qui corrige les totaux
 * enregistrés avant ce module.
 */
const FORMAT_RELEVE = 2;

const SAISON_REGULIERE = 2;
const ETATS_FINIS = new Set(['FINAL', 'OFF']);

/** 'YYYY-MM-DD' décalé de `n` jours. */
function decalerJour(jour, n) {
    const d = new Date(`${jour}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

/**
 * Le premier jour de la fenêtre d'un relevé pris la journée `journee` : la
 * veille. Un match de la veille peut encore se jouer après minuit ; un match
 * de l'avant-veille, non.
 */
function debutFenetre(journee) {
    return decalerJour(journee, -1);
}

/** Map(id du match → état) d'après des listes de matchs de /v1/score. */
function etatsDesMatchs(listes) {
    const etats = new Map();
    for (const liste of listes || []) {
        for (const m of liste || []) {
            if (m && m.id != null) etats.set(Number(m.id), m.gameState);
        }
    }
    return etats;
}

/**
 * Les totaux de saison d'un joueur d'après son journal de matchs de la LNH
 * (/v1/player/{id}/game-log/{saison}/2 → `gameLog`), et leur inclusion.
 *
 *   depuis : premier jour de la fenêtre (debutFenetre) ;
 *   etats  : Map(id → état) des matchs de la fenêtre, lue au relevé ;
 *   gardien : barème des gardiens.
 *
 * Un match de la fenêtre dont l'état est inconnu n'est pas compté : le direct
 * le comptera. Mieux vaut qu'il vienne d'une seule source que de deux.
 */
function totauxDuJournal(journal, { depuis, etats = new Map(), gardien = false } = {}) {
    const retenus = [];
    const inclus = [];
    for (const e of journal || []) {
        if (!e || e.gameId == null) continue;
        const jour = String(e.gameDate || '').slice(0, 10);
        if (jour && depuis && jour < depuis) { retenus.push(e); continue; }
        if (etats.get(Number(e.gameId)) === 'OFF') {
            retenus.push(e);
            inclus.push(Number(e.gameId));
        }
    }

    const somme = champ => retenus.reduce((n, e) => n + (Number(e[champ]) || 0), 0);
    let totaux;
    if (gardien) {
        const wins = retenus.filter(e => e.decision === 'W').length;
        const losses = retenus.filter(e => e.decision === 'L').length;
        const otLosses = retenus.filter(e => e.decision === 'O' || e.decision === 'OTL').length;
        const shutouts = somme('shutouts');
        totaux = {
            gamesPlayed: retenus.length,
            // Même miroir que le relevé par fiche : victoires et blanchissages
            // dans goals/assists.
            goals: wins,
            assists: shutouts,
            wins, losses, otLosses, shutouts,
            points: scoring.goaliePoolPoints({ wins, shutouts, otLosses })
        };
    } else {
        totaux = {
            gamesPlayed: retenus.length,
            goals: somme('goals'),
            assists: somme('assists'),
            points: retenus.reduce((n, e) => n + scoring.pointsReelsPatineur(e), 0),
            wins: 0, losses: 0, otLosses: 0, shutouts: 0
        };
    }
    return { totaux, inclusion: { depuis, matchs: inclus } };
}

/**
 * L'inclusion d'un relevé par fiche (/landing), quand le journal n'a pas pu
 * être lu : les matchs officiels de la fenêtre que la fiche montre. C'est
 * une approximation — la fiche peut montrer un match que ses totaux ne
 * comptent pas encore — réservée à ce repli.
 */
function inclusionDeFiche(fiche, { depuis, etats = new Map() } = {}) {
    const matchs = ((fiche && fiche.last5Games) || [])
        .filter(g => g && (g.gameTypeId === undefined || Number(g.gameTypeId) === SAISON_REGULIERE))
        .filter(g => String(g.gameDate || '').slice(0, 10) >= depuis && etats.get(Number(g.gameId)) === 'OFF')
        .map(g => Number(g.gameId));
    return { depuis, matchs };
}

/** Le résultat d'un match fini, pour chacun des deux clubs. */
function resultatDuMatch(m) {
    const a = m.awayTeam || {}, h = m.homeTeam || {};
    if (!a.abbrev || !h.abbrev || Number(a.score) === Number(h.score)) return null;
    const type = (m.gameOutcome && m.gameOutcome.lastPeriodType)
        || (m.periodDescriptor && m.periodDescriptor.periodType) || 'REG';
    const [gagnant, perdant] = Number(a.score) > Number(h.score) ? [a, h] : [h, a];
    return { gagnant: gagnant.abbrev, perdant: perdant.abbrev, prolongation: type === 'OT' || type === 'SO' };
}

/**
 * Le classement des clubs au relevé, exact au match près.
 *
 *   base   : { [abrév.]: { gamesPlayed, wins, losses, otLosses } } — le
 *            classement daté de la veille de `depuis` (tous les matchs
 *            jusque-là, tous finis). Vide avant le premier match ;
 *   matchs : les matchs de la fenêtre (/v1/score de chaque jour) ;
 *   depuis : premier jour de la fenêtre ;
 *   saison : la saison relevée ;
 *   abbrevs : tous les clubs de la ligue (classement du jour).
 *
 * Renvoie { parClub: { [abrév.]: { gamesPlayed, wins, losses, otLosses } },
 *           inclusion: { [abrév.]: { depuis, matchs } } } — tous les clubs
 * de la base, de la liste et de la fenêtre y figurent, même sans match.
 */
function releveDesClubs({ base = {}, matchs = [], depuis, saison = null, abbrevs = [] } = {}) {
    const parClub = {};
    const inclusion = {};
    const fiche = abbrev => {
        if (!parClub[abbrev]) {
            const b = base[abbrev] || {};
            parClub[abbrev] = {
                gamesPlayed: Number(b.gamesPlayed) || 0,
                wins: Number(b.wins) || 0,
                losses: Number(b.losses) || 0,
                otLosses: Number(b.otLosses) || 0
            };
            inclusion[abbrev] = { depuis, matchs: [] };
        }
        return parClub[abbrev];
    };
    Object.keys(base).forEach(fiche);
    (abbrevs || []).filter(Boolean).forEach(fiche);

    const vus = new Set();
    for (const m of matchs || []) {
        if (!m || vus.has(Number(m.id))) continue;
        if (Number(m.gameType) !== SAISON_REGULIERE) continue;
        if (saison && m.season && Number(m.season) !== Number(saison)) continue;
        const jour = String(m.gameDate || '').slice(0, 10);
        if (depuis && jour && jour < depuis) continue;
        if (!ETATS_FINIS.has(m.gameState)) continue;
        const resultat = resultatDuMatch(m);
        if (!resultat) continue;
        vus.add(Number(m.id));

        const g = fiche(resultat.gagnant), p = fiche(resultat.perdant);
        g.gamesPlayed += 1; g.wins += 1;
        p.gamesPlayed += 1;
        if (resultat.prolongation) p.otLosses += 1; else p.losses += 1;
        inclusion[resultat.gagnant].matchs.push(Number(m.id));
        inclusion[resultat.perdant].matchs.push(Number(m.id));
    }
    return { parClub, inclusion };
}

/**
 * Les points de pool de clubs de la LNH sur une période `[debut, fin)`,
 * match fini par match fini : 2 par victoire, 1 par défaite en prolongation.
 *
 *   matchs : les matchs de ces clubs (calendrier de chaque club, tel quel) ;
 *   direct : les apports du direct ([{ id, jour, clubs }], services/
 *            pointsEnDirect.js) — plus frais que le calendrier pour un match
 *            qui vient de finir ; un match qu'ils connaissent se lit chez eux ;
 *   abbrevs : les clubs demandés.
 *
 * Renvoie { [abrév.]: { points, parJour: { 'YYYY-MM-DD': points } } }.
 */
function pointsDesClubs({ matchs = [], direct = [], abbrevs = [], debut, fin, saison = null } = {}) {
    const dansPeriode = jour => !!jour && (!debut || jour >= debut) && (!fin || jour < fin);
    const parIdDirect = new Map((direct || []).filter(Boolean).map(d => [Number(d.id), d]));
    const sortie = {};
    for (const abbrev of abbrevs) {
        const club = { points: 0, parJour: {} };
        const crediter = (jour, points) => {
            if (!points) return;
            club.points += points;
            club.parJour[jour] = (club.parJour[jour] || 0) + points;
        };
        const vus = new Set();
        for (const m of matchs || []) {
            if (!m || vus.has(Number(m.id))) continue;
            const a = m.awayTeam || {}, h = m.homeTeam || {};
            if (a.abbrev !== abbrev && h.abbrev !== abbrev) continue;
            if (Number(m.gameType) !== SAISON_REGULIERE) continue;
            if (saison && m.season && Number(m.season) !== Number(saison)) continue;
            const jour = String(m.gameDate || '').slice(0, 10);
            if (!dansPeriode(jour)) continue;
            vus.add(Number(m.id));

            const frais = parIdDirect.get(Number(m.id));
            if (frais) {
                const apport = (frais.clubs && frais.clubs[abbrev]) || {};
                crediter(jour, scoring.clubPoolPoints({ wins: apport.v || 0, otLosses: apport.dp || 0 }));
                continue;
            }
            if (!ETATS_FINIS.has(m.gameState)) continue;
            const resultat = resultatDuMatch(m);
            if (!resultat) continue;
            if (resultat.gagnant === abbrev) crediter(jour, scoring.clubPoolPoints({ wins: 1 }));
            else if (resultat.prolongation) crediter(jour, scoring.clubPoolPoints({ otLosses: 1 }));
        }
        // Un match que seul le direct connaît (calendrier en retard).
        for (const d of parIdDirect.values()) {
            if (vus.has(Number(d.id)) || !dansPeriode(d.jour)) continue;
            const apport = d.clubs && d.clubs[abbrev];
            if (apport) crediter(d.jour, scoring.clubPoolPoints({ wins: apport.v || 0, otLosses: apport.dp || 0 }));
        }
        sortie[abbrev] = club;
    }
    return sortie;
}

module.exports = {
    FORMAT_RELEVE,
    pointsDesClubs,
    decalerJour,
    debutFenetre,
    etatsDesMatchs,
    totauxDuJournal,
    inclusionDeFiche,
    resultatDuMatch,
    releveDesClubs
};
