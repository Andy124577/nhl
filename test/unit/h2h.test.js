'use strict';

const { test, describe, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
    generateWeeklyMatchups, ensureStandingsEntry, calculateWeeklyResults,
    getCurrentWeekNumber, mondayOfWeek
} = require('../../lib/h2h.js');
const { makeH2HPool, makeTeam, makeMatchup, makeTeamList, makeStanding } = require('../fixtures/pool.js');
const { makeSkaterStat } = require('../fixtures/stats.js');

afterEach(() => { mock.restoreAll(); });

/** Les deux fonctions journalisent sur console.error ; on garde la sortie nette. */
function muteConsole() {
    mock.method(console, 'error', () => {});
}

/**
 * Générateur pseudo-aléatoire à graine, en remplacement de Math.random.
 *
 * Une valeur CONSTANTE ne conviendrait pas : le brassage est un
 * `sort(() => Math.random() - 0.5)`, qu'un comparateur figé laisse
 * inchangé — les dix tentatives donneraient alors le même appariement et la
 * fonction ne pourrait jamais éviter une répétition. Il faut donc un tirage
 * qui varie, mais reproductible d'une exécution à l'autre.
 */
function tirageSeme(graine) {
    let s = graine >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

describe('generateWeeklyMatchups', () => {
    test('un nombre impair d\'équipes actives ne produit aucun appariement', () => {
        muteConsole();

        assert.deepEqual(generateWeeklyMatchups(makeTeamList(['A', 'B', 'C'])), []);
    });

    test('aucune équipe active ne produit aucun appariement', () => {
        muteConsole();

        assert.deepEqual(generateWeeklyMatchups([]), []);
        assert.deepEqual(generateWeeklyMatchups(makeTeamList(['A', 'B'], [])), []);
    });

    test('les équipes sans membre sont retirées AVANT le test de parité', () => {
        // Quatre équipes dont une vide : il en reste trois, donc impair, donc
        // rien. C'est la parité des équipes ACTIVES qui compte.
        muteConsole();
        const teams = makeTeamList(['A', 'B', 'C', 'D'], ['A', 'B', 'C']);

        assert.deepEqual(generateWeeklyMatchups(teams), []);
    });

    test('deux équipes s\'affrontent toujours, sans tirage', () => {
        const m = generateWeeklyMatchups(makeTeamList(['Rouge', 'Bleu']));

        assert.equal(m.length, 1);
        assert.equal(m[0].team1, 'Rouge');
        assert.equal(m[0].team2, 'Bleu');
    });

    test('un appariement neuf part à 0-0, sans vainqueur ni numéro de semaine', () => {
        const [m] = generateWeeklyMatchups(makeTeamList(['Rouge', 'Bleu']));

        assert.equal(m.team1Points, 0);
        assert.equal(m.team2Points, 0);
        assert.equal(m.winner, null);
        assert.equal(m.weekNumber, null);
    });

    test('quatre équipes : chacune joue exactement une fois', () => {
        mock.method(Math, 'random', tirageSeme(42));
        const matchups = generateWeeklyMatchups(makeTeamList(['A', 'B', 'C', 'D']));

        assert.equal(matchups.length, 2);
        const joueuses = matchups.flatMap(m => [m.team1, m.team2]).sort();
        assert.deepEqual(joueuses, ['A', 'B', 'C', 'D']);
    });

    test('six équipes : trois duels, personne contre soi-même', () => {
        mock.method(Math, 'random', tirageSeme(42));
        const matchups = generateWeeklyMatchups(makeTeamList(['A', 'B', 'C', 'D', 'E', 'F']));

        assert.equal(matchups.length, 3);
        assert.deepEqual(matchups.flatMap(m => [m.team1, m.team2]).sort(), ['A', 'B', 'C', 'D', 'E', 'F']);
        for (const m of matchups) assert.notEqual(m.team1, m.team2);
    });

    test('évite de refaire le duel de la semaine passée', () => {
        // A-B et C-D viennent d'être joués : sur quatre équipes il reste deux
        // appariements possibles, la fonction doit en choisir un.
        mock.method(Math, 'random', tirageSeme(42));
        const historique = [[makeMatchup({ team1: 'A', team2: 'B' }), makeMatchup({ team1: 'C', team2: 'D' })]];
        const matchups = generateWeeklyMatchups(makeTeamList(['A', 'B', 'C', 'D']), historique);

        const paires = matchups.map(m => [m.team1, m.team2].sort().join('|')).sort();
        assert.ok(!paires.includes('A|B'), `A|B rejoué : ${paires.join(', ')}`);
        assert.ok(!paires.includes('C|D'), `C|D rejoué : ${paires.join(', ')}`);
    });

    test('quand tous les appariements possibles sont récents, en rend quand même un complet', () => {
        // Sur quatre équipes il n'existe que trois appariements ; les trois
        // dernières semaines les ont tous consommés. Aucune solution parfaite
        // n'existe : c'est la branche « garder le moins mauvais » qui répond,
        // et elle doit rendre un calendrier complet, pas une liste vide.
        mock.method(Math, 'random', tirageSeme(42));
        const historique = [
            [makeMatchup({ team1: 'A', team2: 'B' }), makeMatchup({ team1: 'C', team2: 'D' })],
            [makeMatchup({ team1: 'A', team2: 'C' }), makeMatchup({ team1: 'B', team2: 'D' })],
            [makeMatchup({ team1: 'A', team2: 'D' }), makeMatchup({ team1: 'B', team2: 'C' })]
        ];
        const matchups = generateWeeklyMatchups(makeTeamList(['A', 'B', 'C', 'D']), historique);

        assert.equal(matchups.length, 2);
        assert.deepEqual(matchups.flatMap(m => [m.team1, m.team2]).sort(), ['A', 'B', 'C', 'D']);
    });

    test('ne consulte que les trois dernières semaines de l\'historique', () => {
        // Cinq semaines d'historique dont les trois dernières sont A-C / B-D.
        // Seules celles-là pèsent : le résultat doit les éviter, même si les
        // deux plus anciennes couvrent le reste des appariements.
        mock.method(Math, 'random', tirageSeme(7));
        const vieux = [makeMatchup({ team1: 'A', team2: 'D' }), makeMatchup({ team1: 'B', team2: 'C' })];
        const recent = [makeMatchup({ team1: 'A', team2: 'C' }), makeMatchup({ team1: 'B', team2: 'D' })];
        const historique = [vieux, vieux, recent, recent, recent];

        const matchups = generateWeeklyMatchups(makeTeamList(['A', 'B', 'C', 'D']), historique);
        const paires = matchups.map(m => [m.team1, m.team2].sort().join('|')).sort();

        assert.ok(!paires.includes('A|C'), `A|C rejoué : ${paires.join(', ')}`);
        assert.ok(!paires.includes('B|D'), `B|D rejoué : ${paires.join(', ')}`);
    });

    test('une semaine d\'historique qui n\'est pas un tableau est ignorée', () => {
        mock.method(Math, 'random', tirageSeme(42));
        const matchups = generateWeeklyMatchups(makeTeamList(['A', 'B', 'C', 'D']), [null, undefined, 'bidon']);

        assert.equal(matchups.length, 2);
    });

    test('une entrée d\'historique sans les deux équipes est ignorée', () => {
        mock.method(Math, 'random', tirageSeme(42));
        const historique = [[{ team1: 'A' }, { team2: 'B' }]];

        assert.equal(generateWeeklyMatchups(makeTeamList(['A', 'B', 'C', 'D']), historique).length, 2);
    });

    test('sans historique fourni, le paramètre par défaut suffit', () => {
        mock.method(Math, 'random', tirageSeme(42));

        assert.equal(generateWeeklyMatchups(makeTeamList(['A', 'B', 'C', 'D'])).length, 2);
    });
});

describe('ensureStandingsEntry', () => {
    test('crée une fiche à zéro pour une équipe inconnue', () => {
        const standings = {};
        ensureStandingsEntry(standings, 'Rouge');

        assert.deepEqual(standings.Rouge, makeStanding());
    });

    test('n\'écrase pas une fiche existante', () => {
        const standings = { Rouge: makeStanding({ wins: 5 }) };
        ensureStandingsEntry(standings, 'Rouge');

        assert.equal(standings.Rouge.wins, 5);
    });
});

describe('calculateWeeklyResults', () => {
    /** Un pool de deux équipes, dont les points de semaine sont pilotés ici. */
    function contexte(pointsRouge, pointsBleu) {
        const pool = makeH2HPool({
            teams: {
                Rouge: makeTeam({ offensive: ['JoueurRouge'] }),
                Bleu: makeTeam({ members: ['b'], offensive: ['JoueurBleu'] })
            }
        });
        const stats = {
            players: [
                makeSkaterStat('JoueurRouge', { points: pointsRouge }),
                makeSkaterStat('JoueurBleu', { points: pointsBleu })
            ]
        };
        return { pool, stats };
    }

    test('l\'équipe qui marque le plus gagne', () => {
        const { pool, stats } = contexte(50, 30);
        calculateWeeklyResults(pool, 1, stats);

        assert.equal(pool.h2hData.matchups[0][0].winner, 'Rouge');
        assert.equal(pool.h2hData.standings.Rouge.wins, 1);
        assert.equal(pool.h2hData.standings.Bleu.losses, 1);
    });

    test('le calcul fonctionne dans l\'autre sens aussi', () => {
        const { pool, stats } = contexte(10, 40);
        calculateWeeklyResults(pool, 1, stats);

        assert.equal(pool.h2hData.matchups[0][0].winner, 'Bleu');
        assert.equal(pool.h2hData.standings.Bleu.wins, 1);
        assert.equal(pool.h2hData.standings.Rouge.losses, 1);
    });

    test('à égalité, personne ne gagne et les deux comptent une nulle', () => {
        const { pool, stats } = contexte(25, 25);
        calculateWeeklyResults(pool, 1, stats);

        assert.equal(pool.h2hData.matchups[0][0].winner, 'tie');
        assert.equal(pool.h2hData.standings.Rouge.ties, 1);
        assert.equal(pool.h2hData.standings.Bleu.ties, 1);
        assert.equal(pool.h2hData.standings.Rouge.wins, 0);
        assert.equal(pool.h2hData.standings.Bleu.wins, 0);
    });

    test('les points inscrits sont reportés dans l\'appariement', () => {
        const { pool, stats } = contexte(50, 30);
        calculateWeeklyResults(pool, 1, stats);

        assert.equal(pool.h2hData.matchups[0][0].team1Points, 50);
        assert.equal(pool.h2hData.matchups[0][0].team2Points, 30);
    });

    test('pour et contre sont le miroir l\'un de l\'autre', () => {
        const { pool, stats } = contexte(50, 30);
        calculateWeeklyResults(pool, 1, stats);
        const { Rouge, Bleu } = pool.h2hData.standings;

        assert.equal(Rouge.pointsFor, 50);
        assert.equal(Rouge.pointsAgainst, 30);
        assert.equal(Bleu.pointsFor, 30);
        assert.equal(Bleu.pointsAgainst, 50);
        assert.equal(Rouge.pointsFor, Bleu.pointsAgainst);
    });

    test('les fiches de classement sont créées à la volée', () => {
        const { pool, stats } = contexte(50, 30);
        assert.deepEqual(pool.h2hData.standings, {});

        calculateWeeklyResults(pool, 1, stats);

        assert.deepEqual(Object.keys(pool.h2hData.standings).sort(), ['Bleu', 'Rouge']);
    });

    test('un classement déjà commencé est incrémenté, pas remis à zéro', () => {
        const { pool, stats } = contexte(50, 30);
        pool.h2hData.standings = { Rouge: makeStanding({ wins: 2, pointsFor: 100 }) };

        calculateWeeklyResults(pool, 1, stats);

        assert.equal(pool.h2hData.standings.Rouge.wins, 3);
        assert.equal(pool.h2hData.standings.Rouge.pointsFor, 150);
    });

    test('un classement absent est créé de toutes pièces', () => {
        // Une saison h2h qui n'a encore jamais été finalisée n'a pas de
        // champ standings du tout.
        const { pool, stats } = contexte(50, 30);
        delete pool.h2hData.standings;

        calculateWeeklyResults(pool, 1, stats);

        assert.equal(pool.h2hData.standings.Rouge.wins, 1);
    });

    test('sans données h2h, sort sans rien casser', () => {
        muteConsole();
        const pool = makeH2HPool();
        delete pool.h2hData;

        assert.doesNotThrow(() => calculateWeeklyResults(pool, 1, { players: [] }));
        assert.equal(calculateWeeklyResults(pool, 1, { players: [] }), undefined);
    });

    test('une semaine sans appariement sort sans rien casser', () => {
        muteConsole();
        const { pool, stats } = contexte(10, 10);

        assert.equal(calculateWeeklyResults(pool, 99, stats), undefined);
        assert.deepEqual(pool.h2hData.standings, {});
    });

    test('un appariement nommant une équipe inconnue est sauté', () => {
        const { pool, stats } = contexte(10, 10);
        pool.h2hData.matchups[0] = [makeMatchup({ team1: 'Rouge', team2: 'Disparue' })];

        calculateWeeklyResults(pool, 1, stats);

        assert.deepEqual(pool.h2hData.standings, {});
        assert.equal(pool.h2hData.matchups[0][0].winner, null);
    });

    test('la semaine est archivée dans matchupHistory', () => {
        const { pool, stats } = contexte(50, 30);
        calculateWeeklyResults(pool, 1, stats);

        assert.equal(pool.h2hData.matchupHistory.length, 1);
        assert.equal(pool.h2hData.matchupHistory[0].weekNumber, 1);
        assert.equal(pool.h2hData.matchupHistory[0].matchups[0].winner, 'Rouge');
        assert.ok(pool.h2hData.matchupHistory[0].completedDate);
    });

    test('matchupHistory est créé s\'il manque', () => {
        const { pool, stats } = contexte(50, 30);
        delete pool.h2hData.matchupHistory;

        calculateWeeklyResults(pool, 1, stats);

        assert.equal(pool.h2hData.matchupHistory.length, 1);
    });

    test('rend le pool modifié', () => {
        const { pool, stats } = contexte(50, 30);

        assert.equal(calculateWeeklyResults(pool, 1, stats), pool);
    });

    test('finaliser DEUX FOIS la même semaine compte les résultats en double', () => {
        // Comportement actuel — il n'y a aucune protection contre le double
        // appel. La finalisation automatique tourne toutes les six heures ET
        // une route manuelle existe : ce cas est atteignable en production.
        // Le test le documente ; s'il devient idempotent, c'est lui qui doit
        // changer, sciemment.
        const { pool, stats } = contexte(50, 30);

        calculateWeeklyResults(pool, 1, stats);
        calculateWeeklyResults(pool, 1, stats);

        assert.equal(pool.h2hData.standings.Rouge.wins, 2, 'deux victoires pour un seul duel joué');
        assert.equal(pool.h2hData.standings.Rouge.pointsFor, 100);
        assert.equal(pool.h2hData.matchupHistory.length, 2);
    });
});

describe('getCurrentWeekNumber', () => {
    const debut = '2025-10-06T00:00:00.000Z';

    test('sans date de départ, on est en semaine 1', () => {
        assert.equal(getCurrentWeekNumber(null), 1);
        assert.equal(getCurrentWeekNumber(undefined), 1);
        assert.equal(getCurrentWeekNumber(''), 1);
    });

    test('avant le début de la saison, on est en semaine 1', () => {
        assert.equal(getCurrentWeekNumber(debut, new Date('2025-09-01T00:00:00.000Z')), 1);
    });

    test('le jour même, on est en semaine 1', () => {
        assert.equal(getCurrentWeekNumber(debut, new Date(debut)), 1);
    });

    test('à sept jours pile, on passe en semaine 2', () => {
        assert.equal(getCurrentWeekNumber(debut, new Date('2025-10-13T00:00:00.000Z')), 2);
    });

    test('une minute avant les sept jours, on est encore en semaine 1', () => {
        assert.equal(getCurrentWeekNumber(debut, new Date('2025-10-12T23:59:00.000Z')), 1);
    });

    test('trois semaines et un jour plus tard, on est en semaine 4', () => {
        assert.equal(getCurrentWeekNumber(debut, new Date('2025-10-28T00:00:00.000Z')), 4);
    });

    test('sans horloge fournie, l\'heure courante sert de défaut', () => {
        // Une saison ouverte il y a longtemps : le numéro doit être bien au-delà
        // de 1, quelle que soit la date d'exécution.
        assert.ok(getCurrentWeekNumber('2020-01-06T00:00:00.000Z') > 100);
    });
});

describe('mondayOfWeek', () => {
    test('un lundi se rend lui-même', () => {
        assert.equal(mondayOfWeek('2025-10-06'), '2025-10-06');
    });

    test('du mardi au samedi, on remonte au lundi de la semaine', () => {
        assert.equal(mondayOfWeek('2025-10-07'), '2025-10-06');   // mardi
        assert.equal(mondayOfWeek('2025-10-08'), '2025-10-06');   // mercredi
        assert.equal(mondayOfWeek('2025-10-09'), '2025-10-06');   // jeudi
        assert.equal(mondayOfWeek('2025-10-10'), '2025-10-06');   // vendredi
        assert.equal(mondayOfWeek('2025-10-11'), '2025-10-06');   // samedi
    });

    test('un dimanche remonte de six jours, il n\'avance pas d\'un', () => {
        // Le seul jour où l'arithmétique n'est pas « 1 - jour ». Une mise en
        // œuvre naïve renverrait le 2025-10-13, soit la semaine suivante.
        assert.equal(mondayOfWeek('2025-10-12'), '2025-10-06');
    });

    test('franchit un changement de mois', () => {
        assert.equal(mondayOfWeek('2025-11-01'), '2025-10-27');   // samedi
    });

    test('franchit un changement d\'année', () => {
        assert.equal(mondayOfWeek('2026-01-01'), '2025-12-29');   // jeudi
    });

    test('rend toujours un AAAA-MM-JJ', () => {
        assert.match(mondayOfWeek('2025-10-09'), /^\d{4}-\d{2}-\d{2}$/);
    });

    test('le résultat ne dépend pas du fuseau de la machine', () => {
        // Le serveur tourne en UTC sur Render, le poste de dev à Montréal
        // (UTC-4/-5). Le calcul est fait en UTC de bout en bout : un dimanche
        // reste un dimanche des deux côtés.
        const avant = process.env.TZ;
        try {
            process.env.TZ = 'America/Montreal';
            assert.equal(mondayOfWeek('2025-10-12'), '2025-10-06');
            process.env.TZ = 'UTC';
            assert.equal(mondayOfWeek('2025-10-12'), '2025-10-06');
        } finally {
            if (avant === undefined) delete process.env.TZ; else process.env.TZ = avant;
        }
    });
});
