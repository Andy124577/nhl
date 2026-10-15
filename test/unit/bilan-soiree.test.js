'use strict';

/**
 * Le bilan de la soirée : la soirée racontée (la plus récente qui soit finie),
 * les cartes de joueurs et de clubs au barème du pool, le mouvement au
 * classement cumulatif et le duel de la semaine en tête-à-tête.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const bilan = require('../../lib/bilanSoiree.js');
const routesSoiree = require('../../routes/soiree.js');
const { creerServicePointage } = require('../../services/scoring.js');
const scoring = require('../../lib/scoring.js');
const dates = require('../../lib/dates.js');
const { teamBannerTokens } = require('../../teamColors.js');

const SAISON = '20262027';
const AUJ = dates.journeeLocale();
const HIER = dates.ajouterJours(AUJ, -1);

function match(id, jour, away, home, scoreAway, scoreHome, etat = 'OFF', type = 'REG') {
    return {
        id, season: Number(SAISON), gameType: 2, gameDate: jour, gameState: etat,
        startTimeUTC: `${jour}T23:00:00Z`,
        awayTeam: { abbrev: away, score: scoreAway }, homeTeam: { abbrev: home, score: scoreHome },
        gameOutcome: { lastPeriodType: type }
    };
}

describe('lib/bilanSoiree — la soirée à raconter', () => {
    test('etatDeLaSoiree : saison régulière du jour seulement, reportés écartés', () => {
        const matchs = [
            match(1, HIER, 'EDM', 'TOR', 2, 4),
            match(2, HIER, 'MTL', 'BOS', 1, 0, 'LIVE'),
            match(3, HIER, 'VAN', 'SEA', 0, 0, 'PPD'),
            { ...match(4, HIER, 'NYR', 'NJD', 3, 1), gameType: 1 },
            match(5, AUJ, 'CHI', 'DAL', 0, 0, 'FUT')
        ];
        assert.deepEqual(bilan.etatDeLaSoiree(matchs, HIER, SAISON), { prevus: 2, finis: 1, enJeu: 1, terminee: false });
        assert.equal(bilan.etatDeLaSoiree(matchs.filter(m => m.id !== 2), HIER, SAISON).terminee, true);
        assert.equal(bilan.etatDeLaSoiree([], HIER).terminee, false, 'une journée sans match n’a pas de bilan');
        assert.equal(bilan.etatDeLaSoiree([{ ...match(6, HIER, 'A', 'B', 1, 0), season: 20252026 }], HIER, SAISON).prevus, 0);
    });

    test('choisirSoiree : aujourd’hui fini d’abord, sinon hier, sinon rien', () => {
        const fini = { terminee: true }, pasFini = { terminee: false };
        assert.equal(bilan.choisirSoiree({ aujourdhui: AUJ, hier: HIER, etatAujourdhui: fini, etatHier: fini }), AUJ);
        assert.equal(bilan.choisirSoiree({ aujourdhui: AUJ, hier: HIER, etatAujourdhui: pasFini, etatHier: fini }), HIER);
        assert.equal(bilan.choisirSoiree({ aujourdhui: AUJ, hier: HIER, etatAujourdhui: pasFini, etatHier: pasFini }), null);
    });

    test('delaiAvantReessai : rien après la soirée du jour, vite pendant les matchs', () => {
        assert.equal(bilan.delaiAvantReessai({ terminee: true, enJeu: 0 }, { terminee: true, enJeu: 0 }), null);
        assert.equal(bilan.delaiAvantReessai({ terminee: false, enJeu: 2 }, { terminee: true, enJeu: 0 }), bilan.REESSAI_EN_JEU_MS);
        assert.equal(bilan.delaiAvantReessai({ terminee: false, enJeu: 0 }, { terminee: false, enJeu: 1 }), bilan.REESSAI_EN_JEU_MS);
        assert.equal(bilan.delaiAvantReessai({ terminee: false, enJeu: 0 }, { terminee: true, enJeu: 0 }), bilan.REESSAI_CALME_MS);
    });
});

describe('lib/bilanSoiree — clubs, rangs, duels', () => {
    test('soireeDuClub : victoire, défaite en prolongation, défaite, pas de match', () => {
        const matchs = [
            match(1, HIER, 'EDM', 'TOR', 2, 4),
            match(2, HIER, 'MTL', 'BOS', 2, 3, 'OFF', 'SO'),
            match(3, HIER, 'VAN', 'SEA', 1, 0, 'LIVE')
        ];
        assert.deepEqual(bilan.soireeDuClub(matchs, 'TOR', HIER, SAISON),
            { issue: 'V', pour: 4, contre: 2, adversaire: 'EDM', domicile: true, prolongation: null, points: 2 });
        assert.deepEqual(bilan.soireeDuClub(matchs, 'edm', HIER, SAISON),
            { issue: 'D', pour: 2, contre: 4, adversaire: 'TOR', domicile: false, prolongation: null, points: 0 });
        const mtl = bilan.soireeDuClub(matchs, 'MTL', HIER, SAISON);
        assert.equal(mtl.issue, 'DP');
        assert.equal(mtl.prolongation, 'SO');
        assert.equal(mtl.points, 1);
        assert.equal(bilan.soireeDuClub(matchs, 'VAN', HIER, SAISON), null, 'un match en cours ne compte pas encore');
        assert.equal(bilan.soireeDuClub(matchs, 'CHI', HIER, SAISON), null);
        assert.equal(bilan.soireeDuClub(matchs, '', HIER, SAISON), null);
    });

    test('rangsDeLaSoiree : avant = total − soirée − suite ; l’égalité garde l’ordre', () => {
        const rangs = bilan.rangsDeLaSoiree([
            { teamName: 'A', total: 50, soiree: 2 },
            { teamName: 'B', total: 48, soiree: 7 },
            { teamName: 'C', total: 47, soiree: 3 }
        ]);
        assert.deepEqual([...rangs.avant], [['A', 1], ['C', 2], ['B', 3]]);
        assert.deepEqual([...rangs.apres], [['A', 1], ['B', 2], ['C', 3]]);

        const egaux = bilan.rangsDeLaSoiree([{ teamName: 'A', total: 10, soiree: 0 }, { teamName: 'B', total: 10, soiree: 0 }]);
        assert.deepEqual([...egaux.avant], [['A', 1], ['B', 2]]);

        // Hier raconté pendant les matchs du jour : B a pris 6 points ce soir,
        // son rang d’hier soir n’en tient pas compte.
        const suite = bilan.rangsDeLaSoiree([
            { teamName: 'B', total: 56, soiree: 0, apres: 6 },
            { teamName: 'A', total: 52, soiree: 0, apres: 0 }
        ]);
        assert.deepEqual([...suite.apres], [['A', 1], ['B', 2]]);
    });

    test('rangsH2H : victoires, puis différentiel, puis ordre du pool', () => {
        const rangs = bilan.rangsH2H(['A', 'B', 'C', 'D'], {
            A: { wins: 1, pointsFor: 10, pointsAgainst: 20 },
            B: { wins: 2, pointsFor: 30, pointsAgainst: 20 },
            C: { wins: 1, pointsFor: 25, pointsAgainst: 20 }
        });
        assert.deepEqual([...rangs], [['B', 1], ['C', 2], ['A', 3], ['D', 4]]);
    });

    test('issueDuDuel, nomAffiche, decisionDuGardien', () => {
        assert.equal(bilan.issueDuDuel(10.04, 10), 'T', 'à la décimale près, comme partout');
        assert.equal(bilan.issueDuDuel(12, 10), 'W');
        assert.equal(bilan.issueDuDuel(8, 10), 'L');
        assert.equal(bilan.nomAffiche('Équipe 2', ['alex', 'sam']), 'alex et sam');
        assert.equal(bilan.nomAffiche('Les Huiles', ['alex']), 'Les Huiles');
        assert.equal(bilan.nomAffiche('Équipe 2', ['un nom vraiment très long', 'un autre encore']), 'Équipe 2');
        assert.equal(bilan.decisionDuGardien({ victoires: 1, blanchissages: 1 }), 'BL');
        assert.equal(bilan.decisionDuGardien({ victoires: 1 }), 'V');
        assert.equal(bilan.decisionDuGardien({ decisions: ['O'] }), 'DP');
        assert.equal(bilan.decisionDuGardien({ decisions: ['L'] }), 'D');
        assert.equal(bilan.decisionDuGardien({}), null);
    });
});

// ─────────────────────────── La route ───────────────────────────

function ligne(joueur, id, abbrev, position, jour, gameId, stats = {}) {
    return {
        player_name: joueur, player_id: id, team_abbrev: abbrev, position, season: SAISON,
        game_id: String(gameId), game_date: jour, goals: 0, assists: 0, points: 0, shots: 0, plus_minus: 0,
        power_play_goals: 0, power_play_points: 0, shorthanded_goals: 0, shorthanded_points: 0,
        game_winning_goals: 0, decision: null, saves: 0, goals_against: 0, shutouts: 0, ...stats
    };
}

// Hier soir : EDM 4 – TOR 2, MTL perd 2-3 en prolongation à BOS.
const MATCHS_HIER = [match(11, HIER, 'TOR', 'EDM', 2, 4), match(12, HIER, 'MTL', 'BOS', 2, 3, 'OFF', 'OT')];
const LIGNES = [
    ligne('Connor McDavid', 8478402, 'EDM', 'C', HIER, 11, { goals: 1, assists: 2, points: 3, shots: 4 }),
    ligne('Evan Bouchard', 8480803, 'EDM', 'D', HIER, 11, { shots: 2 }),
    ligne('Stuart Skinner', 8479973, 'EDM', 'G', HIER, 11, { decision: 'W', saves: 28, goals_against: 2 }),
    ligne('Auston Matthews', 8479318, 'TOR', 'C', HIER, 11, { goals: 2, points: 2, shots: 6 }),
    ligne('Morgan Rielly', 8476853, 'TOR', 'D', HIER, 11, {}),
    ligne('Joseph Woll', 8479361, 'TOR', 'G', HIER, 11, { decision: 'L', saves: 30, goals_against: 4 }),
    ligne('Nick Suzuki', 8480018, 'MTL', 'C', HIER, 12, { assists: 1, points: 1 }),
    ligne('Lane Hutson', 8483457, 'MTL', 'D', HIER, 12, {}),
    ligne('Sam Montembeault', 8478470, 'MTL', 'G', HIER, 12, { decision: 'O', saves: 25, goals_against: 3 })
];
const POINTS_CLUBS = { 'Edmonton Oilers': 2, 'Toronto Maple Leafs': 0, 'Montréal Canadiens': 1 };

function creerDb(lignes) {
    return {
        async query(sql, params) {
            if (sql.includes('COUNT(DISTINCT game_id)')) {
                const [saison, debut, fin] = params;
                const parJour = new Map();
                lignes.filter(l => l.season === saison && l.game_date >= debut && l.game_date < fin).forEach(l => {
                    if (!parJour.has(l.game_date)) parJour.set(l.game_date, new Set());
                    parJour.get(l.game_date).add(l.game_id);
                });
                return { rows: [...parJour].map(([game_date, ids]) => ({ game_date, matchs: ids.size })) };
            }
            const [saison, debut, fin, noms] = params;
            return { rows: lignes.filter(l => l.season === saison && l.game_date >= debut && l.game_date < fin && noms.includes(l.player_name)) };
        }
    };
}

const equipe = (membre, offensive, defensive, goalie, club) =>
    ({ members: [membre], offensive: [offensive], defensive: [defensive], goalie: [goalie], rookie: [], teams: [club] });

function pool(poolMode, extra = {}) {
    return {
        poolMode,
        config: { numOffensive: 1, numDefensive: 1, numGoalies: 1, numRookies: 0, numTeams: 1 },
        teams: {
            'Les Feuilles': equipe('toi', 'Auston Matthews', 'Morgan Rielly', 'Joseph Woll', 'Toronto Maple Leafs'),
            'Les Huiles': equipe('moi', 'Connor McDavid', 'Evan Bouchard', 'Stuart Skinner', 'Edmonton Oilers'),
            ...(poolMode === 'cumulative'
                ? { 'Les Glorieux': equipe('lui', 'Nick Suzuki', 'Lane Hutson', 'Sam Montembeault', 'Montréal Canadiens') }
                : {}),
            'Vide': { members: [], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] }
        },
        ...extra
    };
}

function monter(donnees, {
    matchs = { [HIER]: MATCHS_HIER, [AUJ]: [match(21, AUJ, 'CHI', 'DAL', 0, 0, 'FUT')] },
    lignes = LIGNES,
    calendrier = jour => (jour === HIER ? 2 : 0),
    totaux = [{ teamName: 'Les Feuilles', score: 50 }, { teamName: 'Les Huiles', score: 48 }, { teamName: 'Les Glorieux', score: 47 }],
    usePostgres = true
} = {}) {
    const routes = new Map();
    const app = { get: (chemin, ...gestionnaires) => routes.set(chemin, gestionnaires.at(-1)) };
    const db = creerDb(lignes);
    const resultatsClubs = async ({ clubs, debut, fin }) => Object.fromEntries(clubs.map(nom =>
        [nom, { points: (debut <= HIER && HIER < fin) ? (POINTS_CLUBS[nom] || 0) : 0 }]));
    routesSoiree.monter(app, {
        auth: { requireAuth: (req, res, next) => next() },
        store: { lire: async () => ({ data: donnees }) },
        pointage: creerServicePointage({ db, calendrierDuJour: async j => calendrier(j), resultatsClubs, apportsEnDirect: async () => [] }),
        saisonCourante: () => SAISON,
        fenetreSaison: async () => ({}),
        saisonCommencee: () => true,
        matchsDuJour: async jour => matchs[jour] || [],
        scoresSaison: async () => totaux,
        usePostgres,
        logger: { error() {}, warn() {} }
    });
    return async (query = {}, username = 'moi') => {
        let corps = null, statut = 200;
        const res = { set() {}, status(c) { statut = c; return this; }, json(b) { corps = b; return this; } };
        await routes.get('/api/pools/:poolName/bilan-soiree')({ params: { poolName: 'P' }, query, auth: { username } }, res);
        return { statut, corps };
    };
}

describe('/api/pools/:poolName/bilan-soiree — cumulatif', () => {
    test('raconte hier tant que le jour n’a pas joué : cartes, total, rang', async () => {
        const { statut, corps } = await monter(pool('cumulative'))();
        assert.equal(statut, 200);
        assert.equal(corps.pret, true);
        assert.equal(corps.jour, HIER);
        assert.equal(corps.mode, 'cumulative');
        assert.equal(corps.reessaiMs, bilan.REESSAI_CALME_MS);
        assert.deepEqual(corps.equipe, { cle: 'Les Huiles', nom: 'Les Huiles', logo: 'EDM', ecusson: 'teams/dark/EDM.svg' });

        const parNom = Object.fromEntries(corps.cartes.map(c => [c.nom, c]));
        assert.equal(parNom['Connor McDavid'].points, 3);
        assert.equal(parNom['Connor McDavid'].buts, 1);
        assert.equal(parNom['Connor McDavid'].aides, 2);
        assert.equal(parNom['Connor McDavid'].photo, `https://assets.nhle.com/mugs/nhl/${SAISON}/EDM/8478402.png`);
        const { surface, edge, trim, crest } = teamBannerTokens('EDM');
        assert.deepEqual(parNom['Connor McDavid'].teinte, { surface, edge, trim, crest });
        assert.equal(crest, 'teams/dark/EDM.svg', 'l’écusson lisible sur fond sombre');
        assert.equal(parNom['Evan Bouchard'].points, 0, 'a joué sans marquer : sa carte est là');
        assert.equal(parNom['Stuart Skinner'].decision, 'V');
        assert.equal(parNom['Stuart Skinner'].arrets, 28);
        assert.equal(parNom['Stuart Skinner'].points, 2);
        assert.deepEqual(parNom['Edmonton Oilers'], {
            type: 'club', nom: 'Edmonton Oilers', club: 'EDM', teinte: { surface, edge, trim, crest },
            issue: 'V', pour: 4, contre: 2, adversaire: 'TOR', domicile: true, prolongation: null, points: 2
        });
        assert.deepEqual(corps.cartes.map(c => c.points), [3, 2, 2, 0], 'du meilleur au moins bon');
        assert.equal(corps.total, 7);

        // Avant : Feuilles 48, Glorieux 44, Huiles 41. Après : 50, 48, 47.
        assert.deepEqual(corps.rang, { avant: 3, apres: 2, equipes: 3 });
    });

    test('une défaite en prolongation : 1 point au gardien et au club', async () => {
        const { corps } = await monter(pool('cumulative'))({}, 'lui');
        const parNom = Object.fromEntries(corps.cartes.map(c => [c.nom, c]));
        assert.equal(parNom['Sam Montembeault'].decision, 'DP');
        assert.equal(parNom['Sam Montembeault'].points, 1);
        assert.equal(parNom['Montréal Canadiens'].issue, 'DP');
        assert.equal(parNom['Montréal Canadiens'].points, 1);
        assert.equal(corps.total, 3);
        assert.deepEqual(corps.rang, { avant: 2, apres: 3, equipes: 3 });
    });

    test('déjà vue : la réponse s’arrête là', async () => {
        const { corps } = await monter(pool('cumulative'))({ vus: `${HIER},pas-une-date` });
        assert.deepEqual(corps, { pret: true, vu: true, jour: HIER, reessaiMs: bilan.REESSAI_CALME_MS });
    });

    test('un match d’hier joue encore : pas de bilan, la page revient vite', async () => {
        const matchs = { [HIER]: [MATCHS_HIER[0], { ...MATCHS_HIER[1], gameState: 'LIVE' }], [AUJ]: [] };
        const { corps } = await monter(pool('cumulative'), { matchs })();
        assert.deepEqual(corps, { pret: false, raison: 'matchs', reessaiMs: bilan.REESSAI_EN_JEU_MS });
    });

    test('la soirée du jour finie passe devant celle d’hier', async () => {
        const matchs = { [HIER]: MATCHS_HIER, [AUJ]: [match(21, AUJ, 'CHI', 'DAL', 3, 1)] };
        const { corps } = await monter(pool('cumulative'), { matchs, calendrier: () => 1 })();
        assert.equal(corps.jour, AUJ);
        assert.equal(corps.reessaiMs, null);
        assert.deepEqual(corps.cartes, [], 'aucun joueur de l’équipe n’a joué');
        assert.equal(corps.total, 0);
    });

    test('pendant les matchs du jour, le rang raconté est celui d’hier soir', async () => {
        const matchs = { [HIER]: MATCHS_HIER, [AUJ]: [match(21, AUJ, 'TOR', 'CHI', 1, 0, 'LIVE')] };
        // Matthews marque deux fois ce soir : 54 au Total, mais 52 hier soir.
        const lignes = [...LIGNES, ligne('Auston Matthews', 8479318, 'TOR', 'C', AUJ, 21, { goals: 2, points: 2 })];
        const totaux = [{ teamName: 'Les Feuilles', score: 52 }, { teamName: 'Les Huiles', score: 51 }, { teamName: 'Les Glorieux', score: 47 }];
        const { corps } = await monter(pool('cumulative'), { matchs, lignes, totaux, calendrier: j => (j === HIER ? 2 : 1) })();
        assert.equal(corps.jour, HIER);
        assert.equal(corps.reessaiMs, bilan.REESSAI_EN_JEU_MS);
        // Hier soir : Huiles 51 − 0 = 51 contre Feuilles 52 − 2 = 50.
        assert.deepEqual(corps.rang, { avant: 2, apres: 1, equipes: 3 });
    });

    test('pas d’équipe, repêchage inachevé', async () => {
        assert.equal((await monter(pool('cumulative'))({}, 'inconnu')).statut, 404);
        const incomplet = pool('cumulative');
        incomplet.teams['Les Huiles'].offensive = [];
        assert.deepEqual((await monter(incomplet)()).corps, { pret: false, raison: 'repechage', reessaiMs: null });
    });
});

describe('/api/pools/:poolName/bilan-soiree — tête-à-tête', () => {
    // La saison commence une semaine avant celle d'hier : hier est en semaine 2.
    const semaine = dates.semaineDe(HIER);
    const depart = dates.ajouterJours(semaine.debut, -7);
    const h2hData = {
        seasonStart: depart,
        currentWeek: 2,
        matchups: [
            [{ team1: 'Les Huiles', team2: 'Les Feuilles' }],
            [{ team1: 'Les Feuilles', team2: 'Les Huiles' }]
        ],
        standings: {
            'Les Huiles': { wins: 1, losses: 0, ties: 0, pointsFor: 40, pointsAgainst: 30 },
            'Les Feuilles': { wins: 0, losses: 1, ties: 0, pointsFor: 30, pointsAgainst: 40 }
        },
        matchupHistory: [{ weekNumber: 1, matchups: [{ team1: 'Les Huiles', team2: 'Les Feuilles', team1Points: 40, team2Points: 30, winner: 'Les Huiles' }] }]
    };
    const fantasy = nom => scoring.arrondi(LIGNES.filter(l => l.player_name === nom)
        .reduce((s, l) => s + scoring.pointsFeuilleDeMatch(l), 0));

    test('feuilles de match incomplètes : on attend', async () => {
        const { corps } = await monter(pool('head-to-head', { h2hData }), { calendrier: j => (j === HIER ? 3 : 0) })();
        assert.deepEqual(corps, { pret: false, raison: 'feuilles', jour: HIER, reessaiMs: bilan.REESSAI_EN_JEU_MS });
    });

    test('le duel de la semaine : les deux équipes, leur bilan, la soirée', async () => {
        const { corps } = await monter(pool('head-to-head', { h2hData }))();
        assert.equal(corps.mode, 'head-to-head');
        assert.ok(!corps.cartes.some(c => c.type === 'club'), 'le club ne compte pas en tête-à-tête');
        const nousSoir = fantasy('Connor McDavid') + fantasy('Evan Bouchard') + fantasy('Stuart Skinner');
        const euxSoir = fantasy('Auston Matthews') + fantasy('Morgan Rielly') + fantasy('Joseph Woll');
        assert.equal(corps.total, scoring.arrondi(nousSoir));

        const { duel } = corps;
        assert.equal(duel.semaine, 2);
        assert.equal(duel.jourDeSemaine, dates.nombreDeJours(semaine.debut, HIER) + 1);
        assert.equal(duel.final, HIER === semaine.dernierJour);
        assert.equal(duel.fige, false);
        assert.equal(duel.equipes, 2);
        assert.deepEqual(duel.nous, {
            cle: 'Les Huiles', nom: 'Les Huiles', logo: 'EDM', ecusson: 'teams/dark/EDM.svg', bilan: { v: 1, d: 0, n: 0 }, rang: 1,
            points: scoring.arrondi(nousSoir), soiree: scoring.arrondi(nousSoir)
        });
        assert.equal(duel.eux.cle, 'Les Feuilles');
        assert.equal(duel.eux.logo, 'TOR');
        assert.equal(duel.eux.rang, 2);
        assert.equal(duel.eux.soiree, scoring.arrondi(euxSoir));
        assert.equal(duel.issue, duel.final ? bilan.issueDuDuel(nousSoir, euxSoir) : null);
    });

    test('une semaine close se lit dans son résultat figé', async () => {
        const fige = {
            ...h2hData,
            matchupHistory: [...h2hData.matchupHistory, {
                weekNumber: 2,
                matchups: [{ team1: 'Les Feuilles', team2: 'Les Huiles', team1Points: 61.5, team2Points: 58, winner: 'Les Feuilles' }]
            }]
        };
        const { corps } = await monter(pool('head-to-head', { h2hData: fige }))();
        assert.equal(corps.duel.fige, true);
        assert.equal(corps.duel.final, true);
        assert.equal(corps.duel.nous.points, 58);
        assert.equal(corps.duel.eux.points, 61.5);
        assert.equal(corps.duel.issue, 'L');
    });

    test('sans PostgreSQL, pas de pointage : pas de bilan', async () => {
        const { corps } = await monter(pool('head-to-head', { h2hData }), { usePostgres: false })();
        assert.deepEqual(corps, { pret: false, raison: 'indisponible', reessaiMs: null });
    });
});
