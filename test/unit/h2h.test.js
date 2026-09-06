'use strict';

const { test, describe, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { generateWeeklyMatchups, generateSeasonSchedule, seasonWeekCount,
    ensureStandingsEntry, mondayOfWeek,
    DEFAULT_SEASON_WEEKS, MAX_SEASON_WEEKS } = require('../../lib/h2h.js');
const { makeMatchup, makeTeamList, makeStanding } = require('../fixtures/pool.js');

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

describe('seasonWeekCount', () => {
    test('compte les semaines entre deux bornes', () => {
        // 2025-10-06 → 2026-04-16 : 192 jours, soit 27.43 semaines.
        assert.equal(seasonWeekCount('2025-10-06', '2026-04-16'), 28);
    });

    test('arrondit au supérieur : une semaine entamée reste une semaine', () => {
        // Huit jours = une semaine pleine plus un jour. Arrondir vers le bas
        // laisserait la dernière équipe sans adversaire ce jour-là.
        assert.equal(seasonWeekCount('2025-10-06', '2025-10-14'), 2);
    });

    test('une saison de sept jours pile tient en une semaine', () => {
        assert.equal(seasonWeekCount('2025-10-06', '2025-10-13'), 1);
    });

    test('sans dates exploitables, on retombe sur la valeur par défaut', () => {
        assert.equal(seasonWeekCount(null, null), DEFAULT_SEASON_WEEKS);
        assert.equal(seasonWeekCount('2025-10-06', null), DEFAULT_SEASON_WEEKS);
        assert.equal(seasonWeekCount('pas-une-date', '2026-04-16'), DEFAULT_SEASON_WEEKS);
    });

    test('une fin antérieure au début ne donne jamais zéro semaine', () => {
        // Zéro semaine, ce serait un pool sans un seul duel. Une vaut mieux.
        assert.equal(seasonWeekCount('2026-04-16', '2025-10-06'), 1);
    });

    test('une date aberrante est bornée par MAX_SEASON_WEEKS', () => {
        assert.equal(seasonWeekCount('2025-10-06', '2099-04-16'), MAX_SEASON_WEEKS);
    });

    test('accepte des Date autant que des chaînes', () => {
        assert.equal(
            seasonWeekCount(new Date('2025-10-06'), new Date('2026-04-16')),
            seasonWeekCount('2025-10-06', '2026-04-16')
        );
    });
});

describe('generateSeasonSchedule', () => {
    test('un nombre impair d\'équipes actives ne produit aucun calendrier', () => {
        muteConsole();

        assert.deepEqual(generateSeasonSchedule(makeTeamList(['A', 'B', 'C']), 4), []);
    });

    test('aucune équipe active ne produit aucun calendrier', () => {
        muteConsole();

        assert.deepEqual(generateSeasonSchedule(makeTeamList(['A', 'B'], []), 4), []);
    });

    test('rend exactement le nombre de semaines demandé', () => {
        const calendrier = generateSeasonSchedule(makeTeamList(['A', 'B', 'C', 'D']), 9);

        assert.equal(calendrier.length, 9);
        calendrier.forEach((semaine, i) => {
            assert.equal(semaine.length, 2, `semaine ${i + 1}`);
            semaine.forEach(duel => assert.equal(duel.weekNumber, i + 1));
        });
    });

    test('chaque équipe joue une fois et une seule par semaine', () => {
        const noms = ['A', 'B', 'C', 'D', 'E', 'F'];
        const calendrier = generateSeasonSchedule(makeTeamList(noms), 12);

        calendrier.forEach((semaine, i) => {
            const engagees = semaine.flatMap(m => [m.team1, m.team2]);
            assert.equal(new Set(engagees).size, noms.length,
                `semaine ${i + 1} : une équipe joue deux fois ou pas du tout`);
        });
    });

    test('un cycle complet fait s\'affronter toutes les paires, une fois chacune', () => {
        // C'est ce que le tirage semaine par semaine ne garantissait pas : il
        // évitait les redites récentes sans jamais promettre un tour complet.
        const noms = ['A', 'B', 'C', 'D', 'E', 'F'];
        const calendrier = generateSeasonSchedule(makeTeamList(noms), noms.length - 1);

        const paires = calendrier.flat().map(m => [m.team1, m.team2].sort().join('|'));

        assert.equal(paires.length, 15);                 // C(6,2)
        assert.equal(new Set(paires).size, 15);          // toutes distinctes
    });

    test('deux équipes s\'affrontent toutes les semaines', () => {
        const calendrier = generateSeasonSchedule(makeTeamList(['A', 'B']), 3);

        assert.equal(calendrier.length, 3);
        calendrier.forEach(semaine => {
            assert.equal(semaine.length, 1);
            assert.deepEqual([semaine[0].team1, semaine[0].team2].sort(), ['A', 'B']);
        });
    });

    test('le second cycle inverse les côtés du « vs »', () => {
        // Sans cela, la même équipe resterait à gauche de toutes les cartes de
        // duel de la saison.
        const noms = ['A', 'B', 'C', 'D'];
        const calendrier = generateSeasonSchedule(makeTeamList(noms), 2 * (noms.length - 1));

        const cle = m => `${m.team1}|${m.team2}`;
        const cycle1 = calendrier.slice(0, 3).flat().map(cle);
        const cycle2 = calendrier.slice(3, 6).flat().map(cle);

        cycle2.forEach(duel => assert.ok(!cycle1.includes(duel),
            `${duel} apparaît à l'identique dans les deux cycles`));

        // Mêmes affiches, côtés échangés.
        const nonOrdonnee = liste => liste.map(d => d.split('|').sort().join('|')).sort();
        assert.deepEqual(nonOrdonnee(cycle2), nonOrdonnee(cycle1));
    });

    test('les duels naissent vierges : aucun point, aucun vainqueur', () => {
        const calendrier = generateSeasonSchedule(makeTeamList(['A', 'B', 'C', 'D']), 2);

        calendrier.flat().forEach(duel => {
            assert.equal(duel.team1Points, 0);
            assert.equal(duel.team2Points, 0);
            assert.equal(duel.winner, null);
        });
    });

    test('les équipes sans membre sont écartées du calendrier', () => {
        const equipes = makeTeamList(['A', 'B', 'C', 'D'], ['A', 'B']);
        const calendrier = generateSeasonSchedule(equipes, 2);

        const engagees = new Set(calendrier.flat().flatMap(m => [m.team1, m.team2]));
        assert.deepEqual([...engagees].sort(), ['A', 'B']);
    });

    test('sans nombre de semaines, la saison prend la longueur par défaut', () => {
        assert.equal(generateSeasonSchedule(makeTeamList(['A', 'B'])).length, DEFAULT_SEASON_WEEKS);
    });

    test('un nombre de semaines absurde est ramené entre 1 et MAX_SEASON_WEEKS', () => {
        const equipes = makeTeamList(['A', 'B']);

        assert.equal(generateSeasonSchedule(equipes, 0).length, DEFAULT_SEASON_WEEKS);  // 0 → défaut
        assert.equal(generateSeasonSchedule(equipes, -5).length, 1);
        assert.equal(generateSeasonSchedule(equipes, 9999).length, MAX_SEASON_WEEKS);
    });

    test('l\'ordre de départ est brassé : deux pools identiques divergent', () => {
        // Le brassage passe par Math.random ; deux graines différentes doivent
        // produire deux calendriers différents, sinon tous les pools d'une même
        // ligue joueraient exactement le même horaire.
        const noms = ['A', 'B', 'C', 'D', 'E', 'F'];
        const cle = c => c.flat().map(m => `${m.team1}|${m.team2}`).join(',');

        mock.method(Math, 'random', tirageSeme(1));
        const premier = cle(generateSeasonSchedule(makeTeamList(noms), 5));
        mock.restoreAll();

        mock.method(Math, 'random', tirageSeme(77));
        const second = cle(generateSeasonSchedule(makeTeamList(noms), 5));

        assert.notEqual(premier, second);
    });
});
