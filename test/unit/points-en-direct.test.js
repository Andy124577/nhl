'use strict';

/**
 * Les points du soir (lib/pointsEnDirect.js, services/pointsEnDirect.js) :
 * un but d'un joueur du pool compte tout de suite, une victoire au final, et
 * rien n'est jamais compté deux fois — ni avec le relevé de minuit, ni d'un
 * passage à l'autre.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    calculerPointsEnDirect, appliquerAuxJoueurs, appliquerAuxClubs,
    dernierMatchDeFiche, signature, matchAdmissible
} = require('../../lib/pointsEnDirect.js');
const { creerPointsEnDirect, SALLE, FEUILLE_MAX_MS } = require('../../services/pointsEnDirect.js');

const SAISON = 20262027;
const MCDAVID = 8478402, DRAISAITL = 8477934, SKINNER = 8479973, DEMKO = 8477967, BOESER = 8478444;

function match(id, { etat = 'LIVE', type = 2, away = 0, home = 0, fin = 'REG', debut = '2026-10-15T23:00:00Z', saison = SAISON } = {}) {
    return {
        id, season: saison, gameType: type, gameState: etat, startTimeUTC: debut,
        awayTeam: { abbrev: 'VAN', score: away },
        homeTeam: { abbrev: 'EDM', score: home },
        periodDescriptor: { periodType: fin },
        ...(etat === 'FINAL' || etat === 'OFF' ? { gameOutcome: { lastPeriodType: fin } } : {})
    };
}

function feuille({ away = 0, home = 0, edm = [], van = [], gardiensEdm = [], gardiensVan = [] } = {}) {
    return {
        awayTeam: { abbrev: 'VAN', score: away },
        homeTeam: { abbrev: 'EDM', score: home },
        playerByGameStats: {
            awayTeam: { forwards: van, defense: [], goalies: gardiensVan },
            homeTeam: { forwards: edm, defense: [], goalies: gardiensEdm }
        }
    };
}

const patineur = (playerId, goals = 0, assists = 0) => ({ playerId, goals, assists });
const gardien = (playerId, decision, goalsAgainst, toi = '60:00') => ({ playerId, decision, goalsAgainst, toi });

function releve(derniersMatchs) {
    return {
        season: SAISON, seasonStarted: true, lastUpdated: '2026-10-15T04:00:00Z',
        players: [
            { playerId: MCDAVID, playerName: 'Connor McDavid', position: 'C', goals: 5, assists: 10, points: 15, lastUpdated: '2026-10-15T04:00:00Z' },
            { playerId: DRAISAITL, playerName: 'Leon Draisaitl', position: 'C', goals: 6, assists: 4, points: 10, lastUpdated: '2026-10-15T04:00:00Z' },
            { playerId: BOESER, playerName: 'Brock Boeser', position: 'R', goals: 2, assists: 2, points: 4, lastUpdated: '2026-10-15T04:00:00Z' },
            { playerId: SKINNER, playerName: 'Stuart Skinner', position: 'G', wins: 3, shutouts: 0, otLosses: 1, goals: 3, assists: 0, points: 7, lastUpdated: '2026-10-15T04:00:00Z' },
            { playerId: DEMKO, playerName: 'Thatcher Demko', position: 'G', wins: 2, shutouts: 1, otLosses: 0, goals: 2, assists: 1, points: 9, lastUpdated: '2026-10-15T04:00:00Z' }
        ],
        ...(derniersMatchs ? { derniersMatchs } : {})
    };
}

const DERNIERS = { [MCDAVID]: 2026020010, [DRAISAITL]: 2026020010, [BOESER]: 2026020011, [SKINNER]: 2026020010, [DEMKO]: null };
const CLUBS = { lastUpdated: '2026-10-15T04:00:00Z', matchsComptes: [2026020010, 2026020011] };

describe('ce qui compte ce soir', () => {
    test('un but et une aide comptent dès qu’ils sont inscrits, match en cours', () => {
        const m = match(2026020050, { home: 1 });
        const f = feuille({ home: 1, edm: [patineur(MCDAVID, 0, 1), patineur(DRAISAITL, 1, 0)] });
        const r = calculerPointsEnDirect({ matchs: [m], feuilles: new Map([[m.id, f]]), stats: releve(DERNIERS), clubs: CLUBS });
        assert.deepEqual(r.joueurs, { [MCDAVID]: { p: 1 }, [DRAISAITL]: { b: 1 } });
        assert.deepEqual(r.clubs, {}, 'un club ne gagne qu’au final');
    });

    test('la victoire et le blanchissage d’un gardien attendent le final', () => {
        const f = feuille({ home: 2, gardiensEdm: [gardien(SKINNER, null, 0)] });
        const enCours = calculerPointsEnDirect({ matchs: [match(2026020050, { home: 2 })], feuilles: new Map([[2026020050, f]]), stats: releve(DERNIERS), clubs: CLUBS });
        assert.deepEqual(enCours.joueurs, {});

        const fini = feuille({ home: 2, gardiensEdm: [gardien(SKINNER, 'W', 0)], gardiensVan: [gardien(DEMKO, 'L', 2)] });
        const r = calculerPointsEnDirect({ matchs: [match(2026020050, { etat: 'FINAL', home: 2 })], feuilles: new Map([[2026020050, fini]]), stats: releve(DERNIERS), clubs: CLUBS });
        assert.deepEqual(r.joueurs, { [SKINNER]: { v: 1, bl: 1 } });
        assert.deepEqual(r.clubs, { EDM: { v: 1 } });
    });

    test('défaite en prolongation : un point au gardien et au club perdants', () => {
        const m = match(2026020050, { etat: 'OFF', away: 3, home: 2, fin: 'OT' });
        const f = feuille({ away: 3, home: 2, gardiensEdm: [gardien(SKINNER, 'O', 3)], gardiensVan: [gardien(DEMKO, 'W', 2)] });
        const r = calculerPointsEnDirect({ matchs: [m], feuilles: new Map([[m.id, f]]), stats: releve(DERNIERS), clubs: CLUBS });
        assert.deepEqual(r.joueurs, { [SKINNER]: { dp: 1 }, [DEMKO]: { v: 1 } });
        assert.deepEqual(r.clubs, { VAN: { v: 1 }, EDM: { dp: 1 } });
    });

    test('un blanchissage partagé entre deux gardiens n’est crédité à personne', () => {
        const m = match(2026020050, { etat: 'FINAL', home: 3 });
        const f = feuille({ home: 3, gardiensEdm: [gardien(SKINNER, 'W', 0, '40:00'), gardien(9999999, null, 0, '20:00')] });
        const r = calculerPointsEnDirect({ matchs: [m], feuilles: new Map([[m.id, f]]), stats: releve(DERNIERS), clubs: CLUBS });
        assert.deepEqual(r.joueurs, { [SKINNER]: { v: 1 } });
    });

    test('le réserviste à 00:00 n’empêche pas le blanchissage', () => {
        const m = match(2026020050, { etat: 'FINAL', home: 1 });
        const f = feuille({ home: 1, gardiensEdm: [gardien(SKINNER, 'W', 0), gardien(9999999, null, 0, '00:00')] });
        const r = calculerPointsEnDirect({ matchs: [m], feuilles: new Map([[m.id, f]]), stats: releve(DERNIERS), clubs: CLUBS });
        assert.deepEqual(r.joueurs, { [SKINNER]: { v: 1, bl: 1 } });
    });

    test('présaison, séries d’une autre saison ou saison pas commencée : rien', () => {
        const f = feuille({ home: 1, edm: [patineur(MCDAVID, 1, 0)] });
        const feuilles = new Map([[2026010050, f], [2025020050, f]]);
        const preSaison = calculerPointsEnDirect({ matchs: [match(2026010050, { type: 1, home: 1 })], feuilles, stats: releve(DERNIERS), clubs: CLUBS });
        assert.deepEqual(preSaison, { joueurs: {}, clubs: {} });
        const autreSaison = calculerPointsEnDirect({ matchs: [match(2025020050, { saison: 20252026, home: 1 })], feuilles, stats: releve(DERNIERS), clubs: CLUBS });
        assert.deepEqual(autreSaison.joueurs, {});
        const pasCommencee = calculerPointsEnDirect({ matchs: [match(2026020050, { home: 1 })], feuilles: new Map([[2026020050, f]]), stats: { ...releve(DERNIERS), seasonStarted: false }, clubs: CLUBS });
        assert.deepEqual(pasCommencee.joueurs, {});
    });

    test('un match à venir ne compte pas, même avec une feuille', () => {
        assert.equal(matchAdmissible(match(1, { etat: 'FUT' }), SAISON), false);
        assert.equal(matchAdmissible(match(1, { etat: 'PRE' }), SAISON), false);
        assert.equal(matchAdmissible(match(1, { etat: 'CRIT' }), SAISON), true);
    });

    test('un joueur absent du relevé est ignoré : aucun pool ne peut le compter', () => {
        const m = match(2026020050, { home: 1 });
        const f = feuille({ home: 1, edm: [patineur(1234567, 1, 0)] });
        const r = calculerPointsEnDirect({ matchs: [m], feuilles: new Map([[m.id, f]]), stats: releve(DERNIERS), clubs: CLUBS });
        assert.deepEqual(r.joueurs, {});
    });
});

describe('jamais deux fois', () => {
    test('un match déjà au dernier relevé du joueur n’ajoute rien', () => {
        const m = match(2026020011, { etat: 'OFF', away: 1 });
        const f = feuille({ away: 1, van: [patineur(BOESER, 1, 0)], edm: [patineur(MCDAVID, 0, 0)] });
        const r = calculerPointsEnDirect({ matchs: [m], feuilles: new Map([[m.id, f]]), stats: releve(DERNIERS), clubs: CLUBS });
        assert.deepEqual(r.joueurs, {}, 'Boeser : 2026020011 est son dernier match au relevé');
        assert.deepEqual(r.clubs, {}, 'et le classement des clubs le comprend déjà');
    });

    test('un joueur sans aucun match au relevé : tout ce soir compte', () => {
        const m = match(2026020050, { etat: 'FINAL', away: 1 });
        const f = feuille({ away: 1, gardiensVan: [gardien(DEMKO, 'W', 0)] });
        const r = calculerPointsEnDirect({ matchs: [m], feuilles: new Map([[m.id, f]]), stats: releve(DERNIERS), clubs: CLUBS });
        assert.deepEqual(r.joueurs, { [DEMKO]: { v: 1, bl: 1 } });
    });

    test('relevé d’avant la note : un match commencé avant le relevé est réputé compté', () => {
        const avant = match(2026020050, { home: 1, debut: '2026-10-15T02:00:00Z' });
        const apres = match(2026020051, { home: 1, debut: '2026-10-15T23:00:00Z' });
        const f = feuille({ home: 1, edm: [patineur(MCDAVID, 1, 0)] });
        const feuilles = new Map([[avant.id, f], [apres.id, f]]);
        const r = calculerPointsEnDirect({ matchs: [avant, apres], feuilles, stats: releve(null), clubs: { lastUpdated: '2026-10-15T04:00:00Z' } });
        assert.deepEqual(r.joueurs, { [MCDAVID]: { b: 1 } }, 'seul le match d’après le relevé compte');
    });

    test('un match fini après le relevé des clubs compte, même commencé avant', () => {
        // Match de la côte Ouest, en cours à minuit : le relevé ne le note pas
        // parmi les matchs terminés.
        const m = match(2026020012, { etat: 'OFF', away: 4, home: 1, debut: '2026-10-15T02:00:00Z' });
        const r = calculerPointsEnDirect({ matchs: [m], feuilles: new Map(), stats: releve(DERNIERS), clubs: CLUBS });
        assert.deepEqual(r.clubs, { VAN: { v: 1 } });
    });
});

describe('dernierMatchDeFiche', () => {
    test('le plus récent des cinq derniers matchs de saison régulière', () => {
        assert.equal(dernierMatchDeFiche({ last5Games: [
            { gameId: 2026020031, gameTypeId: 2 }, { gameId: 2026020044, gameTypeId: 2 }, { gameId: 2026010099, gameTypeId: 1 }
        ] }), 2026020044);
    });
    test('aucun match : null', () => {
        assert.equal(dernierMatchDeFiche({ last5Games: [] }), null);
        assert.equal(dernierMatchDeFiche({}), null);
        assert.equal(dernierMatchDeFiche({ last5Games: [{ gameId: 2026010001, gameTypeId: 1 }] }), null);
    });
});

describe('côté page', () => {
    test('un patineur : buts, aides et points montent, pointsEnDirect dit de combien', () => {
        const lignes = releve().players;
        const [mcd, drai] = appliquerAuxJoueurs(lignes, { joueurs: { [MCDAVID]: { b: 1, p: 2 } } });
        assert.deepEqual([mcd.goals, mcd.assists, mcd.points, mcd.pointsEnDirect], [6, 12, 18, 3]);
        assert.equal(drai, lignes[1], 'une ligne intacte reste le même objet');
        assert.equal(lignes[0].points, 15, 'les lignes reçues ne sont pas modifiées');
    });

    test('un gardien : barème des gardiens, et le miroir goals/assists du relevé', () => {
        const lignes = releve().players;
        const skinner = appliquerAuxJoueurs(lignes, { joueurs: { [SKINNER]: { v: 1, bl: 1 } } })[3];
        assert.deepEqual([skinner.wins, skinner.shutouts, skinner.goals, skinner.assists], [4, 1, 4, 1]);
        assert.equal(skinner.points, 1 * 5 + 4 * 2 + 1);
        assert.equal(skinner.pointsEnDirect, 7);
    });

    test('un club : victoires et défaites en prolongation', () => {
        const fiches = [{ teamAbbrev: 'EDM', teamFullName: 'Edmonton Oilers', wins: 5, otLosses: 1, gamesPlayed: 8 },
                        { teamAbbrev: 'VAN', teamFullName: 'Vancouver Canucks', wins: 4, otLosses: 0, gamesPlayed: 8 }];
        const [edm, van] = appliquerAuxClubs(fiches, { clubs: { EDM: { dp: 1 } } });
        assert.deepEqual([edm.wins, edm.otLosses, edm.gamesPlayed, edm.pointsEnDirect], [5, 2, 9, 1]);
        assert.equal(van, fiches[1]);
    });

    test('sans direct : les lignes telles quelles', () => {
        const lignes = releve().players;
        assert.equal(appliquerAuxJoueurs(lignes, null), lignes);
        assert.deepEqual(appliquerAuxClubs(null, { clubs: {} }), []);
    });

    test('la signature ne dépend pas de l’ordre des clés', () => {
        assert.equal(
            signature({ joueurs: { 1: { b: 1 }, 2: { p: 1 } }, clubs: {} }),
            signature({ joueurs: { 2: { p: 1 }, 1: { b: 1 } }, clubs: {}, generatedAt: 'autre' })
        );
        assert.notEqual(signature({ joueurs: { 1: { b: 1 } } }), signature({ joueurs: { 1: { b: 2 } } }));
    });
});

describe('le service', () => {
    function fauxIo() {
        const salle = new Set();
        const envois = [];
        return {
            salle, envois,
            sockets: { adapter: { rooms: { get: (nom) => (nom === SALLE && salle.size ? salle : undefined) } } },
            to: (nom) => ({ emit: (evt, charge) => envois.push({ nom, evt, charge }) })
        };
    }
    function fauxSocket(io, id) {
        const ecoutes = new Map();
        const recus = [];
        return {
            recus,
            on: (evt, fn) => ecoutes.set(evt, fn),
            emit: (evt, charge) => recus.push({ evt, charge }),
            join: () => io.salle.add(id),
            leave: () => io.salle.delete(id),
            declencher: (evt) => ecoutes.get(evt)()
        };
    }
    function fausseMinuterie() {
        const poses = [];
        return { poses, repeter: (fn, ms) => { const p = { fn, ms, arrete: false }; poses.push(p); return p; }, arreter: (p) => { p.arrete = true; } };
    }

    function monter({ io = fauxIo(), matchs, feuilles }) {
        let t = 1_000_000;
        const lectures = [];
        const minuterie = fausseMinuterie();
        const service = creerPointsEnDirect({
            io, minuterie, intervalleMs: 10000, horloge: () => t, logger: { warn() {}, error() {} },
            lireMatchs: async () => matchs(),
            lireFeuille: async (id) => { lectures.push(id); return feuilles(id); },
            lireReleves: () => ({ stats: releve(DERNIERS), clubs: CLUBS })
        });
        return { io, service, minuterie, lectures, avancer: ms => { t += ms; } };
    }

    test('personne ne suit : aucun relevé de la LNH', async () => {
        let releves = 0;
        const { service, minuterie } = monter({ matchs: () => { releves += 1; return []; }, feuilles: () => null });
        await service.tic();
        assert.equal(releves, 0);
        assert.equal(minuterie.poses.length, 0);
    });

    test('suivre : l’état tout de suite, puis seulement quand un point tombe', async () => {
        let jeu = { home: 0, edm: [patineur(MCDAVID)] };
        const m = () => [match(2026020050, { home: jeu.home })];
        const { io, service, minuterie, avancer } = monter({ matchs: m, feuilles: () => feuille(jeu) });
        const socket = fauxSocket(io, 'a');
        service.brancher(socket);
        await socket.declencher('points:suivre');
        assert.equal(socket.recus[0].evt, 'points:direct');
        assert.deepEqual(socket.recus[0].charge.joueurs, {});
        assert.equal(minuterie.poses.length, 1);

        avancer(10000);
        await service.tic();
        assert.deepEqual(io.envois, [], 'rien n’a changé : rien ne part');

        jeu = { home: 1, edm: [patineur(MCDAVID, 1, 0)] };
        avancer(10000);
        await service.tic();
        assert.equal(io.envois.length, 1);
        assert.deepEqual(io.envois[0].charge.joueurs, { [MCDAVID]: { b: 1 } });

        socket.declencher('points:arreter');
        await service.tic();
        assert.equal(minuterie.poses[0].arrete, true, 'plus personne : le relevé s’arrête');
    });

    test('une feuille n’est relue que quand le pointage bouge, ou après FEUILLE_MAX_MS', async () => {
        let home = 0;
        const { io, service, lectures, avancer } = monter({
            matchs: () => [match(2026020050, { home })],
            feuilles: () => feuille({ home, edm: [patineur(MCDAVID, home, 0)] })
        });
        io.salle.add('a');
        await service.tic();
        avancer(10000); await service.tic();
        avancer(10000); await service.tic();
        assert.equal(lectures.length, 1, 'même pointage : la feuille gardée sert');

        home = 1;
        avancer(10000); await service.tic();
        assert.equal(lectures.length, 2, 'un but : la feuille est relue');

        avancer(FEUILLE_MAX_MS); await service.tic();
        assert.equal(lectures.length, 3, 'relue de temps en temps, pour les corrections de la LNH');
    });

    test('une feuille en retard sur le pointage est relue au passage suivant', async () => {
        let feuilleHome = 0;
        const { io, service, lectures, avancer } = monter({
            matchs: () => [match(2026020050, { home: 1 })],
            feuilles: () => feuille({ home: feuilleHome, edm: [patineur(MCDAVID, feuilleHome, 0)] })
        });
        io.salle.add('a');
        await service.tic();
        assert.deepEqual(io.envois[0].charge.joueurs, {}, 'le but n’est pas encore à la feuille');
        feuilleHome = 1;
        avancer(10000); await service.tic();
        assert.equal(lectures.length, 2);
        assert.deepEqual(io.envois.at(-1).charge.joueurs, { [MCDAVID]: { b: 1 } });
    });

    test('une LNH muette ne pousse rien et ne casse rien', async () => {
        const { io, service } = monter({ matchs: () => { throw new Error('LNH indisponible'); }, feuilles: () => null });
        io.salle.add('a');
        await service.tic();
        assert.deepEqual(io.envois, []);
        assert.equal(await service.lire(), null);
    });
});
