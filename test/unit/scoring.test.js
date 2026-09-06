'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    FANTASY_SCORING, goaliePoolPoints, clubPoolPoints, computeTeamSeasonScores,
    getTeamWeeklyPoints, skaterFantasyPointsTonight, goalieFantasyPointsTonight
} = require('../../lib/scoring.js');
const { makePool, makeTeam } = require('../fixtures/pool.js');
const { makeSkaterStat, makeGoalieStat, makeBoxscoreSkater, makeBoxscoreGoalie } = require('../fixtures/stats.js');

describe('FANTASY_SCORING', () => {
    // Un par constante : changer un poids doit faire échouer un test évident,
    // pas vingt totaux calculés.
    test('les poids du barème sont ceux annoncés aux joueurs', () => {
        assert.equal(FANTASY_SCORING.goal, 3);
        assert.equal(FANTASY_SCORING.assist, 2);
        assert.equal(FANTASY_SCORING.shot, 0.5);
        assert.equal(FANTASY_SCORING.plusMinus, 0.5);
        assert.equal(FANTASY_SCORING.powerPlayGoal, 1);
        assert.equal(FANTASY_SCORING.powerPlayPoint, 0.5);
        assert.equal(FANTASY_SCORING.shorthandedGoal, 2);
        assert.equal(FANTASY_SCORING.shorthandedPoint, 1);
        assert.equal(FANTASY_SCORING.gameWinningGoal, 1);
        assert.equal(FANTASY_SCORING.win, 5);
        assert.equal(FANTASY_SCORING.shutout, 3);
        assert.equal(FANTASY_SCORING.save, 0.2);
        assert.equal(FANTASY_SCORING.goalsAgainst, -1);
    });
});

describe('goaliePoolPoints', () => {
    // Source unique de la formule : elle était recopiée dans six fichiers.
    // Chaque poids est affirmé seul, pour qu'une modification fasse tomber un
    // test évident plutôt qu'une douzaine de totaux.
    test('un blanchissage vaut 5', () => {
        assert.equal(goaliePoolPoints({ shutouts: 1 }), 5);
    });

    test('une victoire vaut 2', () => {
        assert.equal(goaliePoolPoints({ wins: 1 }), 2);
    });

    test('une défaite en prolongation vaut 1', () => {
        assert.equal(goaliePoolPoints({ otLosses: 1 }), 1);
    });

    test('une saison complète : 4 BL, 30 V, 6 DP = 86', () => {
        assert.equal(goaliePoolPoints({ shutouts: 4, wins: 30, otLosses: 6 }), 86);
    });

    test('une fiche vide ou absente vaut 0', () => {
        assert.equal(goaliePoolPoints({}), 0);
        assert.equal(goaliePoolPoints(null), 0);
        assert.equal(goaliePoolPoints(undefined), 0);
    });
});

describe('clubPoolPoints', () => {
    test('une victoire vaut 2, une défaite en prolongation 1', () => {
        assert.equal(clubPoolPoints({ wins: 1 }), 2);
        assert.equal(clubPoolPoints({ otLosses: 1 }), 1);
    });

    test('une saison complète : 50 V, 8 DP = 108', () => {
        assert.equal(clubPoolPoints({ wins: 50, otLosses: 8 }), 108);
    });

    test('les défaites en temps réglementaire ne retranchent rien', () => {
        assert.equal(clubPoolPoints({ wins: 10, losses: 40, otLosses: 0 }), 20);
    });

    test('une fiche vide ou absente vaut 0', () => {
        assert.equal(clubPoolPoints({}), 0);
        assert.equal(clubPoolPoints(null), 0);
    });
});

describe('computeTeamSeasonScores', () => {
    test('un gardien vaut blanchissages×5 + victoires×2 + défaites en prolongation', () => {
        const pool = makePool({
            teams: { Rouge: makeTeam({ goalie: ['Hellebuyck'] }) }
        });
        const stats = [makeGoalieStat('Hellebuyck', { shutouts: 4, wins: 30, otLosses: 6 })];

        // 4×5 + 30×2 + 6×1 = 86
        assert.equal(computeTeamSeasonScores(pool, stats)[0].score, 86);
    });

    test('un patineur vaut ses points, sans transformation', () => {
        const pool = makePool({ teams: { Rouge: makeTeam({ offensive: ['McDavid'] }) } });
        const stats = [makeSkaterStat('McDavid', { points: 132 })];

        assert.equal(computeTeamSeasonScores(pool, stats)[0].score, 132);
    });

    test('additionne les quatre cases de joueurs', () => {
        const pool = makePool({
            teams: {
                Rouge: makeTeam({
                    offensive: ['A'], defensive: ['B'], rookie: ['C'], goalie: ['G']
                })
            }
        });
        const stats = [
            makeSkaterStat('A', { points: 10 }),
            makeSkaterStat('B', { points: 20 }),
            makeSkaterStat('C', { points: 5 }),
            makeGoalieStat('G', { shutouts: 1, wins: 2, otLosses: 0 })   // 5 + 4 = 9
        ];

        assert.equal(computeTeamSeasonScores(pool, stats)[0].score, 44);
    });

    test('une équipe sans membre est écartée du classement', () => {
        const pool = makePool({
            teams: {
                Rouge: makeTeam({ offensive: ['McDavid'] }),
                Fantome: makeTeam({ members: [], offensive: ['McDavid'] })
            }
        });
        const rows = computeTeamSeasonScores(pool, [makeSkaterStat('McDavid', { points: 100 })]);

        assert.equal(rows.length, 1);
        assert.equal(rows[0].teamName, 'Rouge');
    });

    test('trie par score décroissant et numérote les rangs à partir de 1', () => {
        const pool = makePool({
            teams: {
                Faible: makeTeam({ offensive: ['Petit'] }),
                Fort: makeTeam({ members: ['b'], offensive: ['Gros'] }),
                Moyen: makeTeam({ members: ['c'], offensive: ['Milieu'] })
            }
        });
        const stats = [
            makeSkaterStat('Petit', { points: 10 }),
            makeSkaterStat('Gros', { points: 90 }),
            makeSkaterStat('Milieu', { points: 50 })
        ];

        assert.deepEqual(
            computeTeamSeasonScores(pool, stats).map(r => [r.teamName, r.rank]),
            [['Fort', 1], ['Moyen', 2], ['Faible', 3]]
        );
    });

    test('deux équipes à égalité reçoivent des rangs 1 et 2, pas 1 et 1', () => {
        // Comportement actuel, verrouillé : le classement affiché n'a pas de
        // notion d'ex aequo. Si ça change un jour, ce test doit changer avec.
        const pool = makePool({
            teams: {
                Rouge: makeTeam({ offensive: ['A'] }),
                Bleu: makeTeam({ members: ['b'], offensive: ['B'] })
            }
        });
        const stats = [makeSkaterStat('A', { points: 50 }), makeSkaterStat('B', { points: 50 })];

        assert.deepEqual(computeTeamSeasonScores(pool, stats).map(r => r.rank), [1, 2]);
    });

    test('accepte un joueur écrit en chaîne, en objet patineur ou en objet gardien', () => {
        const pool = makePool({
            teams: {
                Rouge: makeTeam({
                    offensive: ['Chaine', { skaterFullName: 'Objet' }],
                    goalie: [{ goalieFullName: 'Gardien' }]
                })
            }
        });
        const stats = [
            makeSkaterStat('Chaine', { points: 1 }),
            makeSkaterStat('Objet', { points: 2 }),
            makeGoalieStat('Gardien', { shutouts: 0, wins: 2, otLosses: 0 })   // 4
        ];

        assert.equal(computeTeamSeasonScores(pool, stats)[0].score, 7);
    });

    test('un joueur absent des statistiques vaut 0, jamais NaN', () => {
        // Un seul NaN empoisonne le tri de tout le classement.
        const pool = makePool({ teams: { Rouge: makeTeam({ offensive: ['Inconnu', 'McDavid'] }) } });
        const score = computeTeamSeasonScores(pool, [makeSkaterStat('McDavid', { points: 40 })])[0].score;

        assert.equal(score, 40);
        assert.ok(!Number.isNaN(score));
    });

    test('sans liste de statistiques, tout le monde est à 0', () => {
        const pool = makePool({ teams: { Rouge: makeTeam({ offensive: ['McDavid'] }) } });

        assert.equal(computeTeamSeasonScores(pool, null)[0].score, 0);
        assert.equal(computeTeamSeasonScores(pool, undefined)[0].score, 0);
        assert.equal(computeTeamSeasonScores(pool, [])[0].score, 0);
    });

    test('un pool sans équipes rend une liste vide', () => {
        assert.deepEqual(computeTeamSeasonScores({}, []), []);
    });

    test('une ligne de statistique sans nom est ignorée', () => {
        const pool = makePool({ teams: { Rouge: makeTeam({ offensive: ['McDavid'] }) } });
        const stats = [{ points: 999 }, makeSkaterStat('McDavid', { points: 7 })];

        assert.equal(computeTeamSeasonScores(pool, stats)[0].score, 7);
    });

    test('un joueur repêché par deux équipes compte pour les deux', () => {
        const pool = makePool({
            teams: {
                Rouge: makeTeam({ offensive: ['McDavid'] }),
                Bleu: makeTeam({ members: ['b'], offensive: ['McDavid'] })
            }
        });
        const rows = computeTeamSeasonScores(pool, [makeSkaterStat('McDavid', { points: 100 })]);

        assert.deepEqual(rows.map(r => r.score), [100, 100]);
    });

    test('une ligne de patineur sans points vaut 0', () => {
        const pool = makePool({ teams: { Rouge: makeTeam({ offensive: ['Blesse'] }) } });
        const stats = [{ playerName: 'Blesse', position: 'C' }];   // aucune colonne points

        assert.equal(computeTeamSeasonScores(pool, stats)[0].score, 0);
    });

    test('une équipe dont les cases n\'existent pas encore vaut 0, sans erreur', () => {
        // Une équipe tout juste créée n'a que `members` ; les tableaux
        // arrivent au premier choix.
        const pool = makePool({ teams: { Neuve: { members: ['a'] } } });

        assert.doesNotThrow(() => computeTeamSeasonScores(pool, []));
        assert.equal(computeTeamSeasonScores(pool, [])[0].score, 0);
    });

    test('une équipe sans champ members est écartée, sans erreur', () => {
        const pool = makePool({ teams: { Cassee: { offensive: ['McDavid'] } } });

        assert.deepEqual(computeTeamSeasonScores(pool, []), []);
    });

    test('le club repêché compte pour 2×V + DP', () => {
        // Il ne comptait pour rien, alors que classement.js l'incluait déjà
        // dans le total affiché : le rang enregistré ici et le total de la
        // même ligne pouvaient donc classer deux équipes dans un autre ordre,
        // et les flèches d'évolution annonçaient des mouvements fantômes.
        const pool = makePool({
            teams: { Rouge: makeTeam({ offensive: ['McDavid'], teams: ['Vegas Golden Knights'] }) }
        });
        const stats = [makeSkaterStat('McDavid', { points: 100 })];
        const clubs = [{ teamFullName: 'Vegas Golden Knights', wins: 50, otLosses: 8 }];

        assert.equal(computeTeamSeasonScores(pool, stats, clubs)[0].score, 208);   // 100 + 108
    });

    test('sans fiches de clubs, le club vaut 0 plutôt que de faire échouer le calcul', () => {
        // Le cache de clubs peut être vide au tout début de la saison.
        const pool = makePool({
            teams: { Rouge: makeTeam({ offensive: ['McDavid'], teams: ['Vegas Golden Knights'] }) }
        });
        const stats = [makeSkaterStat('McDavid', { points: 100 })];

        assert.equal(computeTeamSeasonScores(pool, stats)[0].score, 100);
        assert.equal(computeTeamSeasonScores(pool, stats, [])[0].score, 100);
        assert.equal(computeTeamSeasonScores(pool, stats, null)[0].score, 100);
    });

    test('un club inconnu du cache vaut 0', () => {
        const pool = makePool({ teams: { Rouge: makeTeam({ teams: ['Nordiques de Québec'] }) } });
        const clubs = [{ teamFullName: 'Vegas Golden Knights', wins: 50, otLosses: 8 }];

        assert.equal(computeTeamSeasonScores(pool, clubs && [], clubs)[0].score, 0);
    });

    test('un club inscrit en objet est reconnu comme en chaîne', () => {
        const pool = makePool({
            teams: { Rouge: makeTeam({ teams: [{ teamFullName: 'Vegas Golden Knights' }] }) }
        });
        const clubs = [{ teamFullName: 'Vegas Golden Knights', wins: 50, otLosses: 8 }];

        assert.equal(computeTeamSeasonScores(pool, [], clubs)[0].score, 108);
    });

    test('une fiche de club sans nom est ignorée', () => {
        const pool = makePool({ teams: { Rouge: makeTeam({ teams: ['Vegas Golden Knights'] }) } });
        const clubs = [{ wins: 99 }, { teamFullName: 'Vegas Golden Knights', wins: 50, otLosses: 8 }];

        assert.equal(computeTeamSeasonScores(pool, [], clubs)[0].score, 108);
    });

    test('le club peut changer le classement entre deux équipes', () => {
        // La raison d'être du correctif : deux équipes proches aux joueurs,
        // séparées par la valeur de leur club.
        const pool = makePool({
            teams: {
                Rouge: makeTeam({ offensive: ['McDavid'], teams: ['Faible'] }),
                Bleu: makeTeam({ members: ['b'], offensive: ['Makar'], teams: ['Fort'] })
            }
        });
        const stats = [makeSkaterStat('McDavid', { points: 100 }), makeSkaterStat('Makar', { points: 90 })];
        const clubs = [
            { teamFullName: 'Faible', wins: 20, otLosses: 5 },   // 45
            { teamFullName: 'Fort', wins: 55, otLosses: 7 }      // 117
        ];

        assert.deepEqual(computeTeamSeasonScores(pool, stats).map(r => r.teamName), ['Rouge', 'Bleu']);
        assert.deepEqual(computeTeamSeasonScores(pool, stats, clubs).map(r => r.teamName), ['Bleu', 'Rouge']);
    });

    test('un gardien sans aucune statistique de victoire vaut 0', () => {
        const pool = makePool({ teams: { Rouge: makeTeam({ goalie: ['Recrue'] }) } });
        const stats = [makeGoalieStat('Recrue', { wins: 0, shutouts: 0, otLosses: 0 })];

        assert.equal(computeTeamSeasonScores(pool, stats)[0].score, 0);
    });
});

describe('getTeamWeeklyPoints', () => {
    const stats = { players: [makeSkaterStat('McDavid', { points: 70 }), makeSkaterStat('Makar', { points: 50 })] };

    test('sans équipe, rend 0', () => {
        assert.equal(getTeamWeeklyPoints(null, stats), 0);
        assert.equal(getTeamWeeklyPoints(undefined, stats), 0);
    });

    test('sans statistiques, rend 0', () => {
        const team = makeTeam({ offensive: ['McDavid'] });

        assert.equal(getTeamWeeklyPoints(team, null), 0);
        assert.equal(getTeamWeeklyPoints(team, {}), 0);
        assert.equal(getTeamWeeklyPoints(team, { players: undefined }), 0);
    });

    test('additionne attaquants, défenseurs, recrues et gardiens', () => {
        const team = makeTeam({ offensive: ['McDavid'], defensive: ['Makar'] });

        assert.equal(getTeamWeeklyPoints(team, stats), 120);
    });

    test('les choix d\'équipe LNH ne comptent PAS ici', () => {
        // Le pointage de SAISON compte désormais le club (2×V + DP), pas le
        // pointage HEBDOMADAIRE : une semaine est calculée sur les feuilles de
        // match, et il n'existe pas d'historique match par match des victoires
        // d'un club. Écart assumé, verrouillé ici.
        const avecClub = makeTeam({ offensive: ['McDavid'], teams: ['Montréal Canadiens'] });
        const statsAvecClub = {
            players: [...stats.players, { playerName: 'Montréal Canadiens', points: 999 }]
        };

        assert.equal(getTeamWeeklyPoints(avecClub, statsAvecClub), 70);
    });

    test('un gardien vaut la même chose que dans le classement de saison', () => {
        // Les deux fonctions ont l'air de diverger — celle-ci lit `points`,
        // computeTeamSeasonScores recalcule BL×5 + V×2 + DP×1 — mais elles
        // s'accordent, parce que le cache de statistiques pose déjà cette
        // formule dans `points` au moment de la construction
        // (server.js, calculatedPoints). Vérifié sur les 58 gardiens du
        // cache réel : points === BL×5 + V×2 + DP×1, sans exception.
        //
        // C'est cette CONCORDANCE qu'il faut verrouiller : la formule est
        // écrite à trois endroits (le constructeur du cache, ici, et
        // classement.js). Si l'une des trois change seule, ce test tombe.
        const team = makeTeam({ goalie: ['Hellebuyck'] });
        const brut = { shutouts: 4, wins: 30, otLosses: 6 };
        const points = brut.shutouts * 5 + brut.wins * 2 + brut.otLosses;   // 86, comme le cache
        const statsGardien = { players: [makeGoalieStat('Hellebuyck', { ...brut, points })] };

        const hebdo = getTeamWeeklyPoints(team, statsGardien);
        const saison = computeTeamSeasonScores(
            makePool({ teams: { Rouge: team } }), statsGardien.players
        )[0].score;

        assert.equal(hebdo, 86);
        assert.equal(saison, 86);
        assert.equal(hebdo, saison, 'les deux chemins de pointage doivent rester d\'accord');
    });

    test('un joueur inconnu vaut 0', () => {
        assert.equal(getTeamWeeklyPoints(makeTeam({ offensive: ['Personne'] }), stats), 0);
    });

    test('des cases vides valent 0', () => {
        assert.equal(getTeamWeeklyPoints(makeTeam(), stats), 0);
    });

    test('accepte les entrées en objet comme en chaîne', () => {
        const team = makeTeam({
            offensive: [{ skaterFullName: 'McDavid' }],
            goalie: [{ goalieFullName: 'Makar' }]
        });

        assert.equal(getTeamWeeklyPoints(team, stats), 120);
    });

    test('une ligne de statistique sans points vaut 0', () => {
        const team = makeTeam({ offensive: ['Blesse'] });
        const sansPoints = { players: [{ playerName: 'Blesse' }] };

        assert.equal(getTeamWeeklyPoints(team, sansPoints), 0);
    });

    test('une entrée vide dans une case vaut 0, sans erreur', () => {
        const team = makeTeam({ offensive: ['', 'McDavid'] });

        assert.doesNotThrow(() => getTeamWeeklyPoints(team, stats));
        assert.equal(getTeamWeeklyPoints(team, stats), 70);
    });

    test('une entrée nulle dans une case vaut 0, sans faire tomber la semaine', () => {
        // Un roster peut contenir un trou après un échange mal appliqué.
        // Avant la garde `?.`, un seul null faisait échouer le calcul de toute
        // la semaine, pour les deux équipes du duel.
        const team = makeTeam({ offensive: [null, undefined, '', 'McDavid'] });

        assert.doesNotThrow(() => getTeamWeeklyPoints(team, stats));
        assert.equal(getTeamWeeklyPoints(team, stats), 70);
    });
});

describe('skaterFantasyPointsTonight', () => {
    test('un but vaut 3', () => {
        assert.equal(skaterFantasyPointsTonight(makeBoxscoreSkater({ goals: 1 })), 3);
    });

    test('une passe vaut 2', () => {
        assert.equal(skaterFantasyPointsTonight(makeBoxscoreSkater({ assists: 1 })), 2);
    });

    test('un tir vaut 0,5', () => {
        assert.equal(skaterFantasyPointsTonight(makeBoxscoreSkater({ shots: 3 })), 1.5);
    });

    test('le différentiel vaut 0,5 par unité', () => {
        assert.equal(skaterFantasyPointsTonight(makeBoxscoreSkater({ plusMinus: 2 })), 1);
    });

    test('un différentiel négatif retranche', () => {
        // 1 but (3) avec un -3 (-1,5)
        assert.equal(skaterFantasyPointsTonight(makeBoxscoreSkater({ goals: 1, plusMinus: -3 })), 1.5);
    });

    test('une soirée complète : 2 buts, 1 passe, 5 tirs, +2', () => {
        // 6 + 2 + 2,5 + 1
        const s = makeBoxscoreSkater({ goals: 2, assists: 1, shots: 5, plusMinus: 2 });

        assert.equal(skaterFantasyPointsTonight(s), 11.5);
    });

    test('une fiche vide vaut 0', () => {
        assert.equal(skaterFantasyPointsTonight({}), 0);
        assert.equal(skaterFantasyPointsTonight(makeBoxscoreSkater()), 0);
    });

    test('arrondit à une décimale', () => {
        // 7 tirs × 0,5 = 3,5 et un -1 → 3,5 - 0,5 = 3 exactement
        assert.equal(skaterFantasyPointsTonight(makeBoxscoreSkater({ shots: 7, plusMinus: -1 })), 3);
        // 3 tirs et +1 : 1,5 + 0,5
        assert.equal(skaterFantasyPointsTonight(makeBoxscoreSkater({ shots: 3, plusMinus: 1 })), 2);
    });
});

describe('goalieFantasyPointsTonight', () => {
    test('une victoire vaut 5', () => {
        assert.equal(goalieFantasyPointsTonight(makeBoxscoreGoalie({ decision: 'W' })), 5);
    });

    test('une défaite ou une absence de décision ne vaut rien', () => {
        assert.equal(goalieFantasyPointsTonight(makeBoxscoreGoalie({ decision: 'L' })), 0);
        assert.equal(goalieFantasyPointsTonight(makeBoxscoreGoalie({ decision: 'O' })), 0);
        assert.equal(goalieFantasyPointsTonight(makeBoxscoreGoalie({ decision: null })), 0);
    });

    test('un blanchissage vaut 3', () => {
        assert.equal(goalieFantasyPointsTonight(makeBoxscoreGoalie({ shutout: true })), 3);
    });

    test('un arrêt vaut 0,2', () => {
        assert.equal(goalieFantasyPointsTonight(makeBoxscoreGoalie({ saves: 10 })), 2);
    });

    test('un but accordé retranche 1', () => {
        assert.equal(goalieFantasyPointsTonight(makeBoxscoreGoalie({ goalsAgainst: 3 })), -3);
    });

    test('un blanchissage gagné avec 30 arrêts vaut 14', () => {
        // 5 + 3 + 6
        const g = makeBoxscoreGoalie({ decision: 'W', shutout: true, saves: 30, goalsAgainst: 0 });

        assert.equal(goalieFantasyPointsTonight(g), 14);
    });

    test('une fiche vide vaut 0', () => {
        assert.equal(goalieFantasyPointsTonight({}), 0);
    });

    test('arrondit à une décimale', () => {
        // 27 arrêts × 0,2 = 5,4000000000000004 en virgule flottante
        assert.equal(goalieFantasyPointsTonight(makeBoxscoreGoalie({ saves: 27 })), 5.4);
    });
});
