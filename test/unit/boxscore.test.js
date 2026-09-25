'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { formerFeuille, dureeDeVie, TTL_MS } = require('../../lib/boxscore.js');
const { creerFeuillesDeMatch, MatchIntrouvable, TAILLE_MAX } = require('../../services/feuilleMatch.js');

const P1 = { number: 1, periodType: 'REG', maxRegulationPeriods: 3 };
const P2 = { number: 2, periodType: 'REG', maxRegulationPeriods: 3 };
const SO = { number: 5, periodType: 'SO', maxRegulationPeriods: 3 };

/** Un boxscore réduit, aux formes exactes de l'API gamecenter. */
function boxscore(over = {}) {
    return {
        id: 2026010039,
        season: 20262027,
        gameType: 1,
        gameDate: '2026-09-24',
        startTimeUTC: '2026-09-25T02:00:00Z',
        venue: { default: 'SAP Center at San Jose' },
        gameState: 'FINAL',
        periodDescriptor: { number: 3, periodType: 'REG', maxRegulationPeriods: 3 },
        gameOutcome: { lastPeriodType: 'REG' },
        clock: { timeRemaining: '00:00', secondsRemaining: 0, running: false, inIntermission: false },
        awayTeam: {
            abbrev: 'ANA', score: 0, sog: 21,
            commonName: { default: 'Ducks' },
            placeName: { default: 'Anaheim' },
            placeNameWithPreposition: { default: 'Anaheim', fr: "d'Anaheim" }
        },
        homeTeam: {
            abbrev: 'SJS', score: 10, sog: 27,
            commonName: { default: 'Sharks' },
            placeName: { default: 'San Jose' }
        },
        playerByGameStats: {
            awayTeam: {
                forwards: [{
                    playerId: 8482118, sweaterNumber: 12, name: { default: 'S. Colangelo' }, position: 'R',
                    goals: 0, assists: 0, points: 0, plusMinus: -3, pim: 0, hits: 0, powerPlayGoals: 0,
                    sog: 2, faceoffWinningPctg: 0, toi: '12:08', blockedShots: 0, shifts: 17, giveaways: 2, takeaways: 0
                }],
                defense: [],
                goalies: [
                    {
                        playerId: 8478024, sweaterNumber: 33, name: { default: 'V. Husso' },
                        evenStrengthShotsAgainst: '12/18', powerPlayShotsAgainst: '1/1', shorthandedShotsAgainst: '0/0',
                        saveShotsAgainst: '13/19', savePctg: 0.684211, goalsAgainst: 6, toi: '30:06',
                        decision: 'L', shotsAgainst: 19, saves: 13, starter: false, pim: 0
                    },
                    {
                        playerId: 8477480, sweaterNumber: 1, name: { default: 'E. Comrie' },
                        saveShotsAgainst: '0/0', savePctg: 0, goalsAgainst: 0, toi: '00:00', shotsAgainst: 0, saves: 0
                    }
                ]
            },
            homeTeam: {
                forwards: [{
                    playerId: 8486103, sweaterNumber: 41, name: { default: 'I. Stenberg' }, position: 'L',
                    goals: 3, assists: 1, points: 4, plusMinus: 3, pim: 0, hits: 0, powerPlayGoals: 1,
                    sog: 5, toi: '15:23', blockedShots: 0, shifts: 17, giveaways: 0, takeaways: 1
                }],
                defense: [{
                    playerId: 8482700, sweaterNumber: 5, name: { default: 'N. Allan' }, position: 'D',
                    goals: 0, assists: 1, points: 1, plusMinus: 5, pim: 0, hits: 1, powerPlayGoals: 0,
                    sog: 1, toi: '17:52', blockedShots: 0, shifts: 20, giveaways: 1, takeaways: 0
                }]
                // pas de `goalies` : la liste doit sortir vide, pas planter
            }
        },
        ...over
    };
}

function rightRail(over = {}) {
    return {
        linescore: {
            byPeriod: [
                { periodDescriptor: P1, away: 0, home: 5 },
                { periodDescriptor: P2, away: 0, home: 2 }
            ],
            totals: { away: 0, home: 10 }
        },
        shotsByPeriod: [{ periodDescriptor: P1, away: 5, home: 14 }],
        teamGameStats: [
            { category: 'sog', awayValue: 21, homeValue: 27 },
            { category: 'faceoffWinningPctg', awayValue: 0.48, homeValue: 0.52 },
            { category: 'faceoffWins', awayValue: '24/50', homeValue: '26/50' },
            { category: 'powerPlay', awayValue: '0/4', homeValue: '2/5' },
            { category: 'powerPlayPctg', awayValue: 0, homeValue: 0.4 },
            { category: 'hits', awayValue: 21, homeValue: 14 }
        ],
        seasonSeries: [{
            id: 2026020398, gameType: 2, gameDate: '2026-11-25', startTimeUTC: '2026-11-26T03:00:00Z',
            gameState: 'FUT', awayTeam: { abbrev: 'SJS' }, homeTeam: { abbrev: 'ANA' },
            gameOutcome: { lastPeriodType: 'REG' }
        }],
        seasonSeriesWins: { awayTeamWins: 0, homeTeamWins: 0 },
        ...over
    };
}

function landing(over = {}) {
    return {
        summary: {
            scoring: [
                {
                    periodDescriptor: P1,
                    goals: [{
                        strength: 'pp', playerId: 8486103,
                        firstName: { default: 'Igor' }, lastName: { default: 'Stenberg' },
                        teamAbbrev: { default: 'SJS' }, goalsToDate: 1, awayScore: 0, homeScore: 1,
                        timeInPeriod: '03:55', shotType: 'wrist', goalModifier: 'none',
                        headshot: 'https://assets.nhle.com/mugs/x.png',
                        assists: [{ playerId: 8485402, firstName: { default: 'Michael' }, lastName: { default: 'Misa' }, assistsToDate: 1 }]
                    }, {
                        playerId: 8484994, name: { default: 'I. Chernyshov' }, teamAbbrev: { default: 'SJS' },
                        goalModifier: 'empty-net', timeInPeriod: '19:10'
                    }]
                },
                { periodDescriptor: SO, goals: [{ playerId: 1, name: { default: 'X' } }] }
            ],
            shootout: {
                events: [
                    { playerId: 8478402, firstName: { default: 'Connor' }, lastName: { default: 'McDavid' },
                      teamAbbrev: { default: 'EDM' }, result: 'save', gameWinner: false },
                    { playerId: 8477960, firstName: { default: 'Adrian' }, lastName: { default: 'Kempe' },
                      teamAbbrev: { default: 'LAK' }, result: 'goal', gameWinner: true }
                ]
            },
            penalties: [{
                periodDescriptor: P1,
                penalties: [
                    {
                        timeInPeriod: '06:02', type: 'MIN', duration: 2, teamAbbrev: { default: 'ANA' },
                        descKey: 'holding',
                        committedByPlayer: { firstName: { default: 'Lucas' }, lastName: { default: 'Pettersson' } },
                        drawnBy: { firstName: { default: 'Brett' }, lastName: { default: 'Leason' } }
                    },
                    {
                        timeInPeriod: '12:12', type: 'BEN', duration: 2, teamAbbrev: { default: 'ANA' },
                        descKey: 'too-many-men-on-the-ice', servedBy: { default: 'S. Colangelo' }
                    }
                ]
            }],
            threeStars: [
                { star: 1, playerId: 8486103, teamAbbrev: 'SJS', name: { default: 'I. Stenberg' },
                  sweaterNo: 41, position: 'L', goals: 3, assists: 1, points: 4, headshot: 'h.png' },
                { star: 2, playerId: 8477968, teamAbbrev: 'SJS', name: { default: 'A. Nedeljkovic' },
                  sweaterNo: 33, position: 'G', goalsAgainstAverage: 0, savePctg: 1 }
            ]
        },
        ...over
    };
}

describe('formerFeuille — en-tête', () => {
    test('équipes, marque et tirs, noms en français quand la LNH les donne', () => {
        const f = formerFeuille({ boxscore: boxscore() });
        assert.deepEqual(f.away, { abbrev: 'ANA', name: 'Ducks', place: "d'Anaheim", score: 0, sog: 21 });
        // Sans préposition, le nom de ville simple.
        assert.equal(f.home.place, 'San Jose');
        assert.equal(f.venue, 'SAP Center at San Jose');
        assert.equal(f.state, 'FINAL');
        assert.equal(f.started, true);
        assert.equal(f.period, 3);
        assert.equal(f.periodType, 'REG');
        assert.equal(f.lastPeriodType, 'REG');
        assert.deepEqual(f.clock, { timeRemaining: '00:00', running: false, inIntermission: false });
    });

    test('un match à venir n\'a ni joueurs, ni période, ni horloge — pas des zéros', () => {
        const brut = boxscore({ gameState: 'FUT' });
        delete brut.playerByGameStats;
        delete brut.periodDescriptor;
        delete brut.clock;
        delete brut.gameOutcome;
        brut.awayTeam = { abbrev: 'ANA', commonName: { default: 'Ducks' } };
        const f = formerFeuille({ boxscore: brut });
        assert.equal(f.started, false);
        assert.equal(f.players, null);
        assert.equal(f.period, null);
        assert.equal(f.periodType, null);
        assert.equal(f.clock, null);
        assert.equal(f.lastPeriodType, null);
        assert.equal(f.away.score, null);
        assert.equal(f.away.sog, null);
        assert.equal(f.away.place, '');
    });

    test('sans right-rail ni landing, les sections dépendantes sortent vides', () => {
        const f = formerFeuille({ boxscore: boxscore() });
        assert.equal(f.linescore, null);
        assert.deepEqual(f.shotsByPeriod, []);
        assert.deepEqual(f.teamStats, []);
        assert.deepEqual(f.seasonSeries, []);
        assert.equal(f.seasonSeriesWins, null);
        assert.deepEqual(f.scoring, []);
        assert.deepEqual(f.shootout, []);
        assert.deepEqual(f.penalties, []);
        assert.deepEqual(f.threeStars, []);
    });

    test('refuse une réponse sans boxscore', () => {
        assert.throws(() => formerFeuille({ boxscore: null }), /boxscore manquant/);
        assert.throws(() => formerFeuille({ boxscore: {} }), /boxscore manquant/);
    });
});

describe('formerFeuille — joueurs', () => {
    test('ligne complète d\'un patineur', () => {
        const f = formerFeuille({ boxscore: boxscore() });
        assert.deepEqual(f.players.home.forwards[0], {
            playerId: 8486103, number: 41, name: 'I. Stenberg', position: 'L',
            goals: 3, assists: 1, points: 4, plusMinus: 3, pim: 0, sog: 5, hits: 0,
            blockedShots: 0, powerPlayGoals: 1, giveaways: 0, takeaways: 1, shifts: 17, toi: '15:23'
        });
        assert.equal(f.players.home.defense.length, 1);
        assert.deepEqual(f.players.home.goalies, []);
    });

    test('gardien : fractions par situation, décision et pourcentage', () => {
        const [husso] = formerFeuille({ boxscore: boxscore() }).players.away.goalies;
        assert.equal(husso.savePct, 0.684211);
        assert.equal(husso.evenStrength, '12/18');
        assert.equal(husso.powerPlay, '1/1');
        assert.equal(husso.decision, 'L');
        assert.equal(husso.starter, false);
        assert.equal(husso.played, true);
    });

    test('un gardien habillé qui n\'a pas joué n\'a pas de pourcentage', () => {
        const comrie = formerFeuille({ boxscore: boxscore() }).players.away.goalies[1];
        assert.equal(comrie.played, false);
        assert.equal(comrie.savePct, null);
        assert.equal(comrie.decision, null);
        assert.equal(comrie.starter, null);
        assert.equal(comrie.pim, null);
        assert.equal(comrie.evenStrength, '');
    });

    test('une valeur absente sort null, pas zéro', () => {
        const brut = boxscore();
        brut.playerByGameStats.awayTeam.forwards = [{ playerId: 1, name: { default: 'A. B' } }];
        const [p] = formerFeuille({ boxscore: brut }).players.away.forwards;
        assert.equal(p.goals, null);
        assert.equal(p.number, null);
        assert.equal(p.toi, '');
        assert.equal(p.position, '');
    });
});

describe('formerFeuille — right-rail', () => {
    test('pointage par période et totaux', () => {
        const f = formerFeuille({ boxscore: boxscore(), rightRail: rightRail() });
        assert.deepEqual(f.linescore, {
            periods: [
                { number: 1, type: 'REG', away: 0, home: 5 },
                { number: 2, type: 'REG', away: 0, home: 2 }
            ],
            totals: { away: 0, home: 10 },
            shootout: null
        });
        assert.deepEqual(f.shotsByPeriod, [{ number: 1, type: 'REG', away: 5, home: 14 }]);
    });

    test('tirs de barrage résumés en réussis / tentés', () => {
        const rail = rightRail();
        rail.linescore.shootout = { awayConversions: 1, awayAttempts: 2, homeConversions: 0, homeAttempts: 3 };
        const f = formerFeuille({ boxscore: boxscore(), rightRail: rail });
        assert.deepEqual(f.linescore.shootout, {
            away: { goals: 1, attempts: 2 },
            home: { goals: 0, attempts: 3 }
        });
    });

    test('statistiques d\'équipe : pourcentage et fraction réunis, ordre fixe, absentes omises', () => {
        const { teamStats } = formerFeuille({ boxscore: boxscore(), rightRail: rightRail() });
        assert.deepEqual(teamStats.map(s => s.key), ['sog', 'faceoffPct', 'powerPlayPct', 'hits']);
        assert.deepEqual(teamStats[1], { key: 'faceoffPct', away: 0.48, home: 0.52, detail: { away: '24/50', home: '26/50' } });
        assert.deepEqual(teamStats[2], { key: 'powerPlayPct', away: 0, home: 0.4, detail: { away: '0/4', home: '2/5' } });
        assert.equal(teamStats[0].detail, null);
    });

    test('une fraction sans valeur sort vide plutôt que « undefined »', () => {
        const rail = rightRail({
            teamGameStats: [
                { category: 'powerPlayPctg', awayValue: 0.5, homeValue: 0 },
                { category: 'powerPlay', homeValue: '0/3' }
            ]
        });
        const [pp] = formerFeuille({ boxscore: boxscore(), rightRail: rail }).teamStats;
        assert.deepEqual(pp.detail, { away: '', home: '0/3' });
    });

    test('duels de la saison et victoires de chaque club', () => {
        const f = formerFeuille({ boxscore: boxscore(), rightRail: rightRail() });
        assert.deepEqual(f.seasonSeries, [{
            id: 2026020398, gameType: 2, gameDate: '2026-11-25', startTimeUTC: '2026-11-26T03:00:00Z',
            state: 'FUT', lastPeriodType: 'REG',
            away: { abbrev: 'SJS', score: null }, home: { abbrev: 'ANA', score: null }
        }]);
        assert.deepEqual(f.seasonSeriesWins, { away: 0, home: 0 });
    });

    test('un duel sans détails ne plante pas', () => {
        const f = formerFeuille({ boxscore: boxscore(), rightRail: rightRail({ seasonSeries: [{}], linescore: { byPeriod: null } }) });
        assert.deepEqual(f.seasonSeries[0], {
            id: null, gameType: null, gameDate: '', startTimeUTC: '', state: '', lastPeriodType: null,
            away: { abbrev: '', score: null }, home: { abbrev: '', score: null }
        });
        assert.deepEqual(f.linescore, { periods: [], totals: { away: null, home: null }, shootout: null });
    });
});

describe('formerFeuille — landing', () => {
    test('buts par période, avec aides et situation ; la période de barrage est retirée', () => {
        const { scoring } = formerFeuille({ boxscore: boxscore(), landing: landing() });
        assert.equal(scoring.length, 1);
        const [premier, second] = scoring[0].goals;
        assert.deepEqual(premier, {
            playerId: 8486103, name: 'Igor Stenberg', teamAbbrev: 'SJS', goalsToDate: 1,
            timeInPeriod: '03:55', strength: 'pp', modifier: null, shotType: 'wrist',
            awayScore: 0, homeScore: 1, headshot: 'https://assets.nhle.com/mugs/x.png',
            assists: [{ playerId: 8485402, name: 'Michael Misa', assistsToDate: 1 }]
        });
        // Nom abrégé en repli, force égale par défaut, modificateur conservé.
        assert.equal(second.name, 'I. Chernyshov');
        assert.equal(second.strength, 'ev');
        assert.equal(second.modifier, 'empty-net');
        assert.equal(second.shotType, null);
        assert.equal(second.headshot, '');
        assert.deepEqual(second.assists, []);
    });

    test('tirs de barrage tir par tir', () => {
        const { shootout } = formerFeuille({ boxscore: boxscore(), landing: landing() });
        assert.deepEqual(shootout, [
            { playerId: 8478402, name: 'Connor McDavid', teamAbbrev: 'EDM', result: 'save', gameWinner: false },
            { playerId: 8477960, name: 'Adrian Kempe', teamAbbrev: 'LAK', result: 'goal', gameWinner: true }
        ]);
    });

    test('pénalités : fautif, joueur lésé, et pénalité de banc purgée', () => {
        const [p1] = formerFeuille({ boxscore: boxscore(), landing: landing() }).penalties;
        assert.equal(p1.number, 1);
        assert.deepEqual(p1.penalties[0], {
            timeInPeriod: '06:02', type: 'MIN', duration: 2, teamAbbrev: 'ANA', descKey: 'holding',
            player: 'Lucas Pettersson', servedBy: '', drawnBy: 'Brett Leason'
        });
        assert.equal(p1.penalties[1].player, '');
        assert.equal(p1.penalties[1].servedBy, 'S. Colangelo');
    });

    test('purgée par un joueur nommé en prénom / nom', () => {
        const brut = landing();
        brut.summary.penalties[0].penalties = [{ servedBy: { firstName: { default: 'Kaapo' }, lastName: { default: 'Kakko' } } }];
        const [p] = formerFeuille({ boxscore: boxscore(), landing: brut }).penalties[0].penalties;
        assert.equal(p.servedBy, 'Kaapo Kakko');
        assert.equal(p.duration, null);
        assert.equal(p.descKey, '');
    });

    test('trois étoiles, patineur et gardien', () => {
        const [un, deux] = formerFeuille({ boxscore: boxscore(), landing: landing() }).threeStars;
        assert.deepEqual(un, {
            star: 1, playerId: 8486103, name: 'I. Stenberg', teamAbbrev: 'SJS', position: 'L', number: 41,
            headshot: 'h.png', goals: 3, assists: 1, points: 4, savePct: null, goalsAgainstAverage: null
        });
        assert.equal(deux.position, 'G');
        assert.equal(deux.savePct, 1);
        assert.equal(deux.goalsAgainstAverage, 0);
        assert.equal(deux.goals, null);
        assert.equal(deux.headshot, '');
    });

    test('un landing sans sommaire donne des listes vides', () => {
        const f = formerFeuille({ boxscore: boxscore(), landing: { summary: {} } });
        assert.deepEqual([f.scoring, f.shootout, f.penalties, f.threeStars], [[], [], [], []]);
        const g = formerFeuille({ boxscore: boxscore(), landing: landing({ summary: {
            scoring: [{ periodDescriptor: P1 }], penalties: [{ periodDescriptor: P2 }]
        } }) });
        assert.deepEqual(g.scoring, [{ number: 1, type: 'REG', goals: [] }]);
        assert.deepEqual(g.penalties, [{ number: 2, type: 'REG', penalties: [] }]);
    });
});

describe('dureeDeVie', () => {
    test('courte en direct, longue une fois officiel', () => {
        assert.equal(dureeDeVie('LIVE'), TTL_MS.LIVE);
        assert.equal(dureeDeVie('CRIT'), TTL_MS.CRIT);
        assert.equal(dureeDeVie('FINAL'), TTL_MS.FINAL);
        assert.equal(dureeDeVie('OFF'), TTL_MS.OFF);
        assert.equal(dureeDeVie('FUT'), TTL_MS.AUTRE);
        assert.equal(dureeDeVie(''), TTL_MS.AUTRE);
        assert.ok(dureeDeVie('LIVE') < dureeDeVie('FINAL'));
        assert.ok(dureeDeVie('FINAL') < dureeDeVie('OFF'));
    });
});

// ------------------------------------------------------------------ service

/** Un faux fetch : `routes` associe « id/section » à un corps, un statut ou une erreur. */
function fauxFetch(routes) {
    const appels = [];
    const fetchImpl = async url => {
        const cle = url.replace('https://api-web.nhle.com/v1/gamecenter/', '');
        appels.push(cle);
        const r = routes[cle];
        if (r instanceof Error) throw r;
        if (typeof r === 'number') return { ok: false, status: r, json: async () => ({}) };
        if (r === undefined) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => r };
    };
    return { fetchImpl, appels };
}

const silencieux = { warn() {}, error() {} };
const ID = '2026010039';

function routesCompletes(etat = 'FINAL') {
    return {
        [`${ID}/boxscore`]: boxscore({ gameState: etat }),
        [`${ID}/right-rail`]: rightRail(),
        [`${ID}/landing`]: landing()
    };
}

describe('creerFeuillesDeMatch', () => {
    test('fond les trois réponses', async () => {
        const { fetchImpl, appels } = fauxFetch(routesCompletes());
        const service = creerFeuillesDeMatch({ fetchImpl, logger: silencieux });
        const f = await service.lire(ID);
        assert.equal(f.id, 2026010039);
        assert.equal(f.linescore.totals.home, 10);
        assert.equal(f.threeStars.length, 2);
        assert.deepEqual(appels.sort(), [`${ID}/boxscore`, `${ID}/landing`, `${ID}/right-rail`]);
    });

    test('identifiant mal formé : introuvable, sans appel réseau', async () => {
        const { fetchImpl, appels } = fauxFetch({});
        const service = creerFeuillesDeMatch({ fetchImpl, logger: silencieux });
        for (const id of ['abc', '123', '', null, '2026010039/../x']) {
            await assert.rejects(service.lire(id), MatchIntrouvable);
        }
        assert.equal(appels.length, 0);
    });

    test('match inconnu de la LNH : introuvable', async () => {
        const { fetchImpl } = fauxFetch({ [`${ID}/boxscore`]: 404 });
        const service = creerFeuillesDeMatch({ fetchImpl, logger: silencieux });
        await assert.rejects(service.lire(ID), MatchIntrouvable);
    });

    test('boxscore en panne : erreur, pas une feuille vide', async () => {
        const { fetchImpl } = fauxFetch({ [`${ID}/boxscore`]: 503 });
        const service = creerFeuillesDeMatch({ fetchImpl, logger: silencieux });
        await assert.rejects(service.lire(ID), err => !(err instanceof MatchIntrouvable) && /HTTP 503/.test(err.message));

        const reseau = fauxFetch({ [`${ID}/boxscore`]: new Error('ECONNRESET') });
        const service2 = creerFeuillesDeMatch({ fetchImpl: reseau.fetchImpl, logger: silencieux });
        await assert.rejects(service2.lire(ID), /ECONNRESET/);
    });

    test('right-rail ou landing en panne : la feuille sort quand même', async () => {
        const avertissements = [];
        const logger = { warn: m => avertissements.push(m) };
        const { fetchImpl } = fauxFetch({
            [`${ID}/boxscore`]: boxscore(),
            [`${ID}/right-rail`]: 500,
            [`${ID}/landing`]: new Error('timeout')
        });
        const f = await creerFeuillesDeMatch({ fetchImpl, logger }).lire(ID);
        assert.equal(f.players.home.forwards[0].name, 'I. Stenberg');
        assert.equal(f.linescore, null);
        assert.deepEqual(f.scoring, []);
        assert.equal(avertissements.length, 2);
    });

    test('cache selon l\'état du match', async () => {
        let horloge = 1_000_000;
        const { fetchImpl, appels } = fauxFetch(routesCompletes('LIVE'));
        const service = creerFeuillesDeMatch({ fetchImpl, logger: silencieux, maintenant: () => horloge });
        await service.lire(ID);
        horloge += TTL_MS.LIVE - 1;
        await service.lire(ID);
        assert.equal(appels.length, 3, 'encore frais : aucun appel');
        horloge += 2;
        await service.lire(ID);
        assert.equal(appels.length, 6, 'périmé : relu');

        service.oublier();
        await service.lire(ID);
        assert.equal(appels.length, 9, 'oublié : relu');
    });

    test('deux lectures simultanées partagent la même requête', async () => {
        const { fetchImpl, appels } = fauxFetch(routesCompletes());
        const service = creerFeuillesDeMatch({ fetchImpl, logger: silencieux });
        const [a, b] = await Promise.all([service.lire(ID), service.lire(ID)]);
        assert.equal(a, b);
        assert.equal(appels.length, 3);
    });

    test('le cache garde au plus TAILLE_MAX feuilles, les plus anciennes sortent', async () => {
        const fetchImpl = async url => {
            const id = Number(url.split('/').slice(-2)[0]);
            return { ok: true, status: 200, json: async () => ({ ...boxscore(), id, gameState: 'OFF' }) };
        };
        let appels = 0;
        const compteur = async url => { appels++; return fetchImpl(url); };
        const service = creerFeuillesDeMatch({ fetchImpl: compteur, logger: silencieux });
        for (let i = 0; i <= TAILLE_MAX; i++) await service.lire(String(2026020000 + i));
        appels = 0;
        await service.lire(String(2026020000 + TAILLE_MAX));
        assert.equal(appels, 0, 'la plus récente est restée');
        await service.lire('2026020000');
        assert.equal(appels, 3, 'la plus ancienne est sortie');
    });
});
