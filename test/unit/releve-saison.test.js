'use strict';

/**
 * Le relevé nocturne, exact au match près (lib/releveSaison.js), et ce que le
 * direct (lib/pointsEnDirect.js) en fait.
 *
 * Le cas du signalement : le 30 septembre 2026 à minuit (heure de l'Est), le
 * relevé est tombé pendant Vancouver-Edmonton. La fiche d'Evan Bouchard ne
 * comptait pas encore ce match ; le « dernier match » qu'elle montrait, si.
 * Le direct l'a donc cru compté, et ses 5 points (3 buts, 2 aides) ne
 * figuraient nulle part au classement. Ici : ni oubli, ni double compte, quel
 * que soit le moment du relevé.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const R = require('../../lib/releveSaison.js');
const { calculerPointsEnDirect, appliquerAuxJoueurs, pointsApport } = require('../../lib/pointsEnDirect.js');
const vanEdm = require('../fixtures/vanEdm20260929.js');

const { match, boxscore, journaux, BOUCHARD, LANKINEN, JARRY } = vanEdm;
const SAISON = 20262027;
const feuilles = new Map([[match.id, boxscore]]);

/** Le relevé d'un joueur, sous la forme de /current-stats en mémoire. */
function releve(ligne, inclusion, extra = {}) {
    return {
        season: SAISON, seasonStarted: true, format: R.FORMAT_RELEVE,
        players: [{ playerId: BOUCHARD, playerName: 'Evan Bouchard', position: 'D', ...ligne }],
        inclusion: { [BOUCHARD]: inclusion },
        ...extra
    };
}
const total = (stats, direct) => appliquerAuxJoueurs(stats.players, direct)[0].points;

describe('totauxDuJournal', () => {
    test('relevé pendant le match : le match en cours n’est ni compté ni noté', () => {
        // Même si le journal le montrait déjà, avec des stats partielles.
        const partiel = [{ ...journaux[BOUCHARD][0], goals: 2, assists: 1, points: 3 }];
        const { totaux, inclusion } = R.totauxDuJournal(partiel, {
            depuis: '2026-09-29', etats: new Map([[match.id, 'LIVE']])
        });
        assert.deepEqual([totaux.gamesPlayed, totaux.goals, totaux.assists, totaux.points], [0, 0, 0, 0]);
        assert.deepEqual(inclusion, { depuis: '2026-09-29', matchs: [] });
    });

    test('un match fini mais pas encore officiel (FINAL) attend son tour', () => {
        const { totaux, inclusion } = R.totauxDuJournal(journaux[BOUCHARD], {
            depuis: '2026-09-29', etats: new Map([[match.id, 'FINAL']])
        });
        assert.equal(totaux.points, 0);
        assert.deepEqual(inclusion.matchs, []);
    });

    test('relevé après le match officiel : 5 points, et le match est noté', () => {
        const { totaux, inclusion } = R.totauxDuJournal(journaux[BOUCHARD], {
            depuis: '2026-09-29', etats: new Map([[match.id, 'OFF']])
        });
        assert.deepEqual([totaux.gamesPlayed, totaux.goals, totaux.assists, totaux.points], [1, 3, 2, 5]);
        assert.deepEqual(inclusion.matchs, [match.id]);
    });

    test('un match d’avant la fenêtre compte toujours, sans être noté', () => {
        const { totaux, inclusion } = R.totauxDuJournal(journaux[BOUCHARD], { depuis: '2026-09-30' });
        assert.equal(totaux.points, 5);
        assert.deepEqual(inclusion, { depuis: '2026-09-30', matchs: [] });
    });

    test('un état inconnu (LNH muette) : pas compté — le direct s’en chargera', () => {
        const { totaux } = R.totauxDuJournal(journaux[BOUCHARD], { depuis: '2026-09-29' });
        assert.equal(totaux.points, 0);
    });

    test('gardiens : victoire, défaite en prolongation, blanchissage — au barème de saison', () => {
        const etats = new Map([[match.id, 'OFF']]);
        const lankinen = R.totauxDuJournal(journaux[LANKINEN], { depuis: '2026-09-29', etats, gardien: true }).totaux;
        assert.deepEqual([lankinen.gamesPlayed, lankinen.wins, lankinen.otLosses, lankinen.shutouts, lankinen.points], [1, 1, 0, 0, 2]);
        assert.deepEqual([lankinen.goals, lankinen.assists], [1, 0], 'le miroir goals/assists du relevé');
        const jarry = R.totauxDuJournal(journaux[JARRY], { depuis: '2026-09-29', etats, gardien: true }).totaux;
        assert.deepEqual([jarry.otLosses, jarry.points], [1, 1]);
        const blanchi = R.totauxDuJournal([
            { gameId: 1, gameDate: '2026-09-01', decision: 'W', shutouts: 1 },
            { gameId: 2, gameDate: '2026-09-02', decision: 'L', shutouts: 0 }
        ], { depuis: '2026-09-29', gardien: true }).totaux;
        assert.deepEqual([blanchi.wins, blanchi.losses, blanchi.shutouts, blanchi.points], [1, 1, 1, 7]);
    });

    test('lignes vides ou sans identifiant : ignorées', () => {
        const { totaux } = R.totauxDuJournal([null, { gameDate: '2026-09-01', goals: 4 }], { depuis: '2026-09-29' });
        assert.equal(totaux.gamesPlayed, 0);
        assert.equal(R.totauxDuJournal(null, { depuis: '2026-09-29' }).totaux.points, 0);
        assert.deepEqual(R.totauxDuJournal().inclusion.matchs, []);
    });
});

describe('le relevé et le direct, ensemble : ni oubli, ni double compte', () => {
    const OFF = match; // l'état de /score/now au matin du 30

    test('le bug du 30 septembre : l’ancienne règle perdait les 5 points de Bouchard', () => {
        // Relevé d'avant l'inclusion : fiche à zéro, « dernier match » = le match en cours.
        const ancien = {
            season: SAISON, seasonStarted: true,
            players: [{ playerId: BOUCHARD, playerName: 'Evan Bouchard', position: 'D', points: 0, goals: 0, assists: 0 }],
            derniersMatchs: { [BOUCHARD]: match.id }
        };
        const direct = calculerPointsEnDirect({ matchs: [OFF], feuilles, stats: ancien, clubs: {} });
        assert.equal(total(ancien, direct), 0, 'ce que le classement affichait');
    });

    test('relevé pendant le match → le direct compte le match entier : 5', () => {
        const { totaux, inclusion } = R.totauxDuJournal(journaux[BOUCHARD], {
            depuis: '2026-09-29', etats: new Map([[match.id, 'LIVE']])
        });
        const stats = releve(totaux, inclusion);
        const direct = calculerPointsEnDirect({ matchs: [OFF], feuilles, stats, clubs: {} });
        assert.deepEqual(direct.joueurs[BOUCHARD], { b: 3, p: 2 });
        assert.equal(total(stats, direct), 5);
    });

    test('relevé refait le jour même, match officiel → compté au relevé, rien au direct : 5', () => {
        const { totaux, inclusion } = R.totauxDuJournal(journaux[BOUCHARD], {
            depuis: '2026-09-29', etats: new Map([[match.id, 'OFF']])
        });
        const stats = releve(totaux, inclusion);
        const direct = calculerPointsEnDirect({ matchs: [OFF], feuilles, stats, clubs: {} });
        assert.equal(direct.joueurs[BOUCHARD], undefined);
        assert.equal(total(stats, direct), 5);
    });

    test('relevé du lendemain : le match est avant la fenêtre → compté une fois : 5', () => {
        const { totaux, inclusion } = R.totauxDuJournal(journaux[BOUCHARD], { depuis: '2026-09-30' });
        const stats = releve(totaux, inclusion);
        const direct = calculerPointsEnDirect({ matchs: [OFF], feuilles, stats, clubs: {} });
        assert.equal(total(stats, direct), 5);
    });

    test('mises à jour répétées, reconnexions : le même résultat à chaque passage', () => {
        const { totaux, inclusion } = R.totauxDuJournal([], { depuis: '2026-09-29' });
        const stats = releve(totaux, inclusion);
        const passes = Array.from({ length: 5 }, () =>
            calculerPointsEnDirect({ matchs: [OFF, OFF], feuilles, stats, clubs: {} }));
        passes.forEach(p => assert.deepEqual(p.joueurs[BOUCHARD], { b: 3, p: 2 },
            'un match vu deux fois dans la même passe ne compte qu’une fois'));
        assert.equal(total(stats, passes.at(-1)), 5);
    });

    test('correction tardive de la LNH : la feuille corrigée remplace l’ancienne, sans cumul', () => {
        const { totaux, inclusion } = R.totauxDuJournal([], { depuis: '2026-09-29' });
        const stats = releve(totaux, inclusion);
        const corrigee = JSON.parse(JSON.stringify(boxscore));
        const b = corrigee.playerByGameStats.homeTeam.defense.find(p => p.playerId === BOUCHARD);
        b.assists = 1; // une aide retirée après révision
        const direct = calculerPointsEnDirect({ matchs: [OFF], feuilles: new Map([[match.id, corrigee]]), stats, clubs: {} });
        assert.equal(total(stats, direct), 4);
    });
});

describe('inclusionDeFiche (repli sans journal)', () => {
    test('les matchs officiels de la fenêtre que la fiche montre', () => {
        const fiche = { last5Games: [
            { gameId: match.id, gameTypeId: 2, gameDate: '2026-09-29' },
            { gameId: 2026010044, gameTypeId: 1, gameDate: '2026-09-25' },
            { gameId: 2025021300, gameTypeId: 2, gameDate: '2026-04-10' }
        ] };
        assert.deepEqual(R.inclusionDeFiche(fiche, { depuis: '2026-09-29', etats: new Map([[match.id, 'OFF']]) }),
            { depuis: '2026-09-29', matchs: [match.id] });
        assert.deepEqual(R.inclusionDeFiche(fiche, { depuis: '2026-09-29', etats: new Map([[match.id, 'LIVE']]) }).matchs, []);
        assert.deepEqual(R.inclusionDeFiche(null, { depuis: '2026-09-29' }).matchs, []);
        assert.deepEqual(R.inclusionDeFiche({ last5Games: [{ gameId: 1, gameDate: '2026-09-29' }] }, { depuis: '2026-09-29' }).matchs, []);
    });
});

describe('releveDesClubs', () => {
    const jeu = (id, etat, away, home, fin = 'REG', gameDate = '2026-09-29', type = 2) => ({
        id, season: SAISON, gameType: type, gameDate, gameState: etat,
        awayTeam: { abbrev: away[0], score: away[1] }, homeTeam: { abbrev: home[0], score: home[1] },
        periodDescriptor: { periodType: fin }, ...(etat === 'OFF' || etat === 'FINAL' ? { gameOutcome: { lastPeriodType: fin } } : {})
    });
    // Les matchs du 29 septembre, à minuit : trois finis, deux en cours.
    const aMinuit = [
        jeu(2026020001, 'OFF', ['FLA', 1], ['CAR', 0], 'OT'),
        jeu(2026020002, 'OFF', ['MTL', 3], ['TOR', 2]),
        jeu(2026020003, 'FINAL', ['NYR', 0], ['BOS', 3]),
        jeu(2026020004, 'LIVE', ['VAN', 5], ['EDM', 4]),
        jeu(2026020005, 'LIVE', ['CHI', 1], ['VGK', 3])
    ];

    test('premier soir : les matchs finis comptent et sont notés, les autres non', () => {
        const { parClub, inclusion } = R.releveDesClubs({
            base: {}, matchs: aMinuit, depuis: '2026-09-29', saison: SAISON, abbrevs: ['VAN', 'EDM', 'SJS']
        });
        assert.deepEqual(parClub.FLA, { gamesPlayed: 1, wins: 1, losses: 0, otLosses: 0 });
        assert.deepEqual(parClub.CAR, { gamesPlayed: 1, wins: 0, losses: 0, otLosses: 1 });
        assert.deepEqual(parClub.TOR, { gamesPlayed: 1, wins: 0, losses: 1, otLosses: 0 });
        assert.deepEqual(parClub.BOS.wins, 1, 'FINAL suffit pour un club : un résultat ne se corrige pas');
        assert.deepEqual(parClub.VAN, { gamesPlayed: 0, wins: 0, losses: 0, otLosses: 0 });
        assert.deepEqual(parClub.SJS, { gamesPlayed: 0, wins: 0, losses: 0, otLosses: 0 }, 'tous les clubs ont leur fiche');
        assert.deepEqual(inclusion.VAN, { depuis: '2026-09-29', matchs: [] });
        assert.deepEqual(inclusion.CAR.matchs, [2026020001]);
    });

    test('le direct compte ensuite les matchs de la côte Ouest, une seule fois', () => {
        const { inclusion } = R.releveDesClubs({ base: {}, matchs: aMinuit, depuis: '2026-09-29', saison: SAISON });
        const clubs = { format: R.FORMAT_RELEVE, depuis: '2026-09-29', inclusion };
        const auMatin = [
            ...aMinuit.slice(0, 3),
            jeu(2026020004, 'OFF', ['VAN', 6], ['EDM', 5], 'OT'),
            jeu(2026020005, 'OFF', ['CHI', 2], ['VGK', 5])
        ];
        const stats = { season: SAISON, seasonStarted: true, players: [] };
        const direct = calculerPointsEnDirect({ matchs: auMatin, feuilles: new Map(), stats, clubs });
        assert.deepEqual(direct.clubs, { VAN: { v: 1 }, EDM: { dp: 1 }, VGK: { v: 1 } });
    });

    test('la base datée compte tout ce qui précède la fenêtre ; un match d’avant n’est pas recompté', () => {
        const { parClub, inclusion } = R.releveDesClubs({
            base: { EDM: { gamesPlayed: 10, wins: 6, losses: 3, otLosses: 1 } },
            matchs: [jeu(2026020100, 'OFF', ['EDM', 3], ['CGY', 1], 'REG', '2026-10-20'),
                     jeu(2026020090, 'OFF', ['EDM', 1], ['CGY', 4], 'REG', '2026-10-18')],
            depuis: '2026-10-19', saison: SAISON
        });
        assert.deepEqual(parClub.EDM, { gamesPlayed: 11, wins: 7, losses: 3, otLosses: 1 });
        assert.deepEqual(inclusion.EDM.matchs, [2026020100]);
    });

    test('présaison, autre saison, match nul ou en double : ignorés', () => {
        const { parClub } = R.releveDesClubs({
            matchs: [
                jeu(1, 'OFF', ['EDM', 3], ['CGY', 1], 'REG', '2026-09-29', 1),
                { ...jeu(2, 'OFF', ['EDM', 3], ['CGY', 1]), season: 20252026 },
                jeu(3, 'OFF', ['EDM', 2], ['CGY', 2]),
                jeu(4, 'OFF', ['EDM', 3], ['CGY', 1]), jeu(4, 'OFF', ['EDM', 3], ['CGY', 1]),
                null
            ],
            depuis: '2026-09-29', saison: SAISON
        });
        assert.equal(parClub.EDM.wins, 1);
        assert.equal(R.releveDesClubs().parClub && Object.keys(R.releveDesClubs().parClub).length, 0);
    });
});

describe('pointsDesClubs : un club sur une période', () => {
    const jeu = (id, gameDate, etat, away, home, fin = 'REG') => ({
        id, season: SAISON, gameType: 2, gameDate, gameState: etat,
        awayTeam: { abbrev: away[0], score: away[1] }, homeTeam: { abbrev: home[0], score: home[1] },
        gameOutcome: { lastPeriodType: fin }
    });
    const calendrier = [
        jeu(1, '2026-09-29', 'OFF', ['VAN', 6], ['EDM', 5], 'OT'),
        jeu(2, '2026-10-01', 'OFF', ['EDM', 4], ['CGY', 1]),
        jeu(3, '2026-10-03', 'LIVE', ['EDM', 2], ['SEA', 0]),
        jeu(4, '2026-10-02', 'OFF', ['SEA', 3], ['CGY', 2])
    ];

    test('victoire 2, défaite en prolongation 1, match en cours 0, par jour', () => {
        const r = R.pointsDesClubs({ matchs: calendrier, abbrevs: ['EDM'], debut: '2026-09-29', fin: '2026-10-04', saison: SAISON });
        assert.deepEqual(r.EDM, { points: 3, parJour: { '2026-09-29': 1, '2026-10-01': 2 } });
    });

    test('les bornes de période : [début, fin)', () => {
        const r = R.pointsDesClubs({ matchs: calendrier, abbrevs: ['EDM'], debut: '2026-09-30', fin: '2026-10-01', saison: SAISON });
        assert.equal(r.EDM.points, 0);
    });

    test('le direct, plus frais, l’emporte sur le calendrier ; un match qu’il est seul à connaître compte', () => {
        const direct = [
            { id: 3, jour: '2026-10-03', clubs: { EDM: { v: 1 } } },
            { id: 9, jour: '2026-10-03', clubs: { EDM: { dp: 1 } } },
            { id: 10, jour: '2026-09-01', clubs: { EDM: { v: 1 } } }
        ];
        const r = R.pointsDesClubs({ matchs: calendrier, direct, abbrevs: ['EDM', 'SEA'], debut: '2026-10-02', fin: '2026-10-04', saison: SAISON });
        assert.equal(r.EDM.points, 3, 'match 3 fini au direct (2) + match 9 (1) ; le 10 est hors période');
        assert.equal(r.SEA.points, 2, 'SEA : la victoire du 2 ; le match 3 perdu au direct ne vaut rien');
    });

    test('sans rien : zéro', () => {
        assert.deepEqual(R.pointsDesClubs({ abbrevs: ['EDM'] }).EDM, { points: 0, parJour: {} });
        assert.deepEqual(R.pointsDesClubs(), {});
        assert.deepEqual(R.pointsDesClubs({ matchs: [null, { ...calendrier[0], gameType: 1 }, { ...calendrier[1], season: 20252026 }], abbrevs: ['EDM'], saison: SAISON }).EDM.points, 0);
        assert.deepEqual(R.pointsDesClubs({ matchs: [{ ...calendrier[1], awayTeam: { abbrev: 'EDM', score: 2 }, homeTeam: { abbrev: 'CGY', score: 2 } }], abbrevs: ['EDM'] }).EDM.points, 0);
    });
});

describe('petits outils', () => {
    test('decalerJour, debutFenetre, etatsDesMatchs, resultatDuMatch', () => {
        assert.equal(R.decalerJour('2026-10-01', -2), '2026-09-29');
        assert.equal(R.debutFenetre('2026-09-30'), '2026-09-29');
        assert.deepEqual([...R.etatsDesMatchs([[match], null, [{ id: 7, gameState: 'LIVE' }, null]])], [[match.id, 'OFF'], [7, 'LIVE']]);
        assert.deepEqual([...R.etatsDesMatchs()], []);
        assert.deepEqual(R.resultatDuMatch(match), { gagnant: 'VAN', perdant: 'EDM', prolongation: true });
        assert.equal(R.resultatDuMatch({ awayTeam: { abbrev: 'A', score: 1 }, homeTeam: { abbrev: 'B', score: 1 } }), null);
        assert.deepEqual(R.resultatDuMatch({ awayTeam: { abbrev: 'A', score: 1 }, homeTeam: { abbrev: 'B', score: 3 }, periodDescriptor: { periodType: 'SO' } }),
            { gagnant: 'B', perdant: 'A', prolongation: true });
        assert.equal(R.resultatDuMatch({}), null);
    });

    test('pointsApport d’un apport vide : 0', () => {
        assert.equal(pointsApport(null, false), 0);
    });
});
