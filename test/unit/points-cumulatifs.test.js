'use strict';

/**
 * Un pool cumulatif compte les vrais points du hockey : buts + aides.
 *
 * Le signalement : Evan Bouchard, 3 buts et 2 aides le 29 septembre 2026,
 * affiché à 17 points dans « Mes joueurs ce soir » — le barème fantasy du
 * tête-à-tête (tirs et différentiel compris). Il en vaut 5, partout : sur sa
 * ligne, au « Total ce soir », dans la répartition, au classement en direct et
 * dans les colonnes 24 h / 7 j / 30 j. Le tête-à-tête, lui, garde ses points
 * fantasy.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const scoring = require('../../lib/scoring.js');
const { lignesDuSoir, calculerPointsEnDirect, apportsDuMatch } = require('../../lib/pointsEnDirect.js');
const { creerServicePointage } = require('../../services/scoring.js');
const { chargerFonctions } = require('../fixtures/helpers.js');
const vanEdm = require('../fixtures/vanEdm20260929.js');

const { match, boxscore, BOUCHARD, MCDAVID, LANKINEN, JARRY } = vanEdm;
const feuilles = new Map([[match.id, boxscore]]);
const SAISON = 20262027;

describe('le barème du cumulatif', () => {
    test('3 buts et 2 aides : 5 points — pas 17', () => {
        const ligne = { position: 'D', goals: 3, assists: 2, shots: 6, plus_minus: 2 };
        assert.equal(scoring.pointsCumulatifsFeuille(ligne), 5);
        assert.equal(scoring.pointsFeuilleDeMatch(ligne), 17, 'le barème fantasy, lui, ne change pas');
    });

    test('le champ points fait foi quand la source le porte ; sinon buts + aides', () => {
        assert.equal(scoring.pointsReelsPatineur({ goals: 3, assists: 2, points: 5 }), 5);
        assert.equal(scoring.pointsReelsPatineur({ goals: 3, assists: 2 }), 5);
        assert.equal(scoring.pointsReelsPatineur({ goals: 0, assists: 0, points: 0 }), 0);
        assert.equal(scoring.pointsReelsPatineur(null), 0);
    });

    test('un gardien : victoire 2, blanchissage 5, défaite en prolongation 1', () => {
        assert.equal(scoring.pointsCumulatifsGardien({ decision: 'W', shutouts: 0 }), 2);
        assert.equal(scoring.pointsCumulatifsGardien({ decision: 'W', shutouts: 1 }), 7);
        assert.equal(scoring.pointsCumulatifsGardien({ decision: 'W', shutout: true }), 7);
        assert.equal(scoring.pointsCumulatifsGardien({ decision: 'O' }), 1);
        assert.equal(scoring.pointsCumulatifsGardien({ decision: 'OTL' }), 1);
        assert.equal(scoring.pointsCumulatifsGardien({ decision: 'L' }), 0);
        assert.equal(scoring.pointsCumulatifsGardien(null), 0);
        assert.equal(scoring.pointsCumulatifsFeuille({ position: 'G', decision: 'W', shutouts: 0 }), 2);
    });

    test('le barème suit le mode : fantasy au tête-à-tête, vrais points ailleurs', () => {
        const ligne = { position: 'C', goals: 3, assists: 2, shots: 6, plus_minus: 2 };
        assert.equal(scoring.pointsFeuilleSelonMode(ligne, 'head-to-head'), 17);
        assert.equal(scoring.pointsFeuilleSelonMode(ligne, 'cumulative'), 5);
        assert.equal(scoring.pointsFeuilleSelonMode(ligne, undefined), 5, 'un pool sans mode est cumulatif');
    });
});

describe('les lignes du soir (/tonight-boxscores), sur le vrai match', () => {
    const nomDe = p => ({ [BOUCHARD]: 'Evan Bouchard', [MCDAVID]: 'Connor McDavid' }[p.playerId] || p.name.default);
    const lignes = lignesDuSoir({ matchs: [match], feuilles, nomDe });
    const bouchard = lignes.find(l => l.playerId === BOUCHARD);

    test('Bouchard : 5 points au cumulatif, 17 au tête-à-tête', () => {
        assert.equal(bouchard.playerName, 'Evan Bouchard');
        assert.deepEqual([bouchard.goals, bouchard.assists, bouchard.points], [3, 2, 5]);
        assert.equal(bouchard.pointsTonight, 5);
        assert.equal(bouchard.fantasyPointsTonight, 17);
        assert.equal(bouchard.teamAbbrev, 'EDM');
    });

    test('les gardiens au final : Lankinen gagne (2), Jarry perd en prolongation (1)', () => {
        const lankinen = lignes.find(l => l.playerId === LANKINEN);
        const jarry = lignes.find(l => l.playerId === JARRY);
        assert.equal(lankinen.pointsTonight, 2);
        assert.equal(jarry.pointsTonight, 1);
        assert.deepEqual([lankinen.saves, lankinen.shotsAgainst], [32, 37]);
    });

    test('un gardien qui mène en deuxième n’a encore rien gagné', () => {
        const enCours = { ...match, gameState: 'LIVE', gameOutcome: undefined };
        const boxEnCours = JSON.parse(JSON.stringify(boxscore));
        boxEnCours.playerByGameStats.awayTeam.goalies.forEach(g => { g.decision = 'W'; });
        const l = lignesDuSoir({ matchs: [enCours], feuilles: new Map([[match.id, boxEnCours]]) })
            .find(x => x.playerId === LANKINEN);
        assert.equal(l.pointsTonight, 0);
        const b = lignesDuSoir({ matchs: [enCours], feuilles: new Map([[match.id, boxEnCours]]) })
            .find(x => x.playerId === BOUCHARD);
        assert.equal(b.pointsTonight, 5, 'buts et aides comptent dès qu’ils sont inscrits');
    });

    test('la ligne du soir et le classement en direct disent le même nombre', () => {
        const stats = {
            season: SAISON, seasonStarted: true,
            players: lignes.map(l => ({ playerId: l.playerId, playerName: l.playerName, position: l.position === 'G' ? 'G' : 'D' })),
            inclusion: Object.fromEntries(lignes.map(l => [l.playerId, { depuis: '2026-09-29', matchs: [] }]))
        };
        const direct = calculerPointsEnDirect({ matchs: [match], feuilles, stats, clubs: { inclusion: {}, depuis: '2026-09-29' } });
        const { pointsApport } = require('../../lib/pointsEnDirect.js');
        for (const l of lignes) {
            assert.equal(pointsApport(direct.joueurs[l.playerId], l.position === 'G'), l.pointsTonight,
                `${l.playerName} : même pointage à l’accueil et au classement`);
        }
    });

    test('un match sans feuille ne donne pas de ligne', () => {
        assert.deepEqual(lignesDuSoir({ matchs: [match], feuilles: new Map() }), []);
        assert.deepEqual(lignesDuSoir({}), []);
    });

    test('noms par défaut : ceux de la feuille', () => {
        assert.equal(lignesDuSoir({ matchs: [match], feuilles }).find(l => l.playerId === BOUCHARD).playerName, 'E. Bouchard');
    });
});

describe('l’accueil : ligne, total et répartition s’accordent', () => {
    const lignes = lignesDuSoir({ matchs: [match], feuilles, nomDe: p => ({ [BOUCHARD]: 'Evan Bouchard', [LANKINEN]: 'Kevin Lankinen' }[p.playerId] || '') });

    function charger(poolMode) {
        const globals = {
            window: {},
            FZPool: { data: () => ({ poolMode }) }
        };
        globals.window.FZPool = globals.FZPool;
        const dash = chargerFonctions('accueil-dash.js', ['fzdPoolH2H', 'fzdPointsCeSoir'], globals);
        return {
            ...dash,
            ...chargerFonctions('accueil-season.js', ['FZS_EN_DIRECT', 'fzsRepartition', 'fzsLignesDuSoir'], {
                ...globals,
                ...dash,
                activeRosterNames: () => ['Evan Bouchard', 'Kevin Lankinen']
            })
        };
    }

    test('cumulatif : 5 PTS pour Bouchard, total 7 (Bouchard 5 + Lankinen 2), répartition 3 + 2 + 2', () => {
        const { fzdPointsCeSoir, fzsLignesDuSoir, fzsRepartition } = charger('cumulative');
        const bouchard = lignes.find(l => l.playerId === BOUCHARD);
        assert.equal(fzdPointsCeSoir(bouchard), 5);

        const soir = fzsLignesDuSoir({ players: lignes, games: [{ id: match.id, state: 'OFF' }] });
        assert.equal(soir.lines.length, 2);
        assert.equal(soir.total, 7);
        const repartition = Object.fromEntries(fzsRepartition(soir.lines));
        assert.deepEqual(repartition, { 'Buts': 3, 'Aides': 2, 'Pts gardiens': 2 });
        assert.equal(Object.values(repartition).reduce((a, b) => a + b, 0), soir.total,
            'la répartition explique le total, sans reste');
        assert.equal(soir.lines.reduce((n, l) => n + fzdPointsCeSoir(l), 0), soir.total);
    });

    test('tête-à-tête : les points fantasy, et la répartition garde tirs et arrêts', () => {
        const { fzdPointsCeSoir, fzsLignesDuSoir, fzsRepartition } = charger('head-to-head');
        const bouchard = lignes.find(l => l.playerId === BOUCHARD);
        assert.equal(fzdPointsCeSoir(bouchard), 17);
        const soir = fzsLignesDuSoir({ players: lignes, games: [] });
        assert.deepEqual([...fzsRepartition(soir.lines)].map(([label]) => label), ['Buts', 'Aides', 'Tirs', 'Arrêts']);
    });

    test('une ligne absente vaut 0', () => {
        const { fzdPointsCeSoir } = charger('cumulative');
        assert.equal(fzdPointsCeSoir(null), 0);
    });
});

describe('les colonnes 24 h / 7 j / 30 j d’un pool cumulatif', () => {
    const NOM = 'Evan Bouchard';

    /** La base : les feuilles de match déjà ingérées. */
    function creerDb(lignes) {
        return {
            async query(sql, params) {
                if (sql.includes('COUNT(DISTINCT game_id)')) return { rows: [] };
                const [saison, debut, fin, noms] = params;
                return { rows: lignes.filter(l => l.season === saison && l.game_date >= debut && l.game_date < fin && noms.includes(l.player_name)) };
            }
        };
    }
    const feuille = (jour, gameId, stats) => ({
        player_name: NOM, player_id: BOUCHARD, team_abbrev: 'EDM', position: 'D', season: String(SAISON),
        game_id: String(gameId), game_date: jour, goals: 0, assists: 0, points: 0, shots: 0, plus_minus: 0,
        power_play_goals: 0, power_play_points: 0, shorthanded_goals: 0, shorthanded_points: 0,
        game_winning_goals: 0, decision: null, saves: 0, goals_against: 0, shutouts: 0, ...stats
    });
    const equipe = { members: ['moi'], offensive: [], defensive: [NOM], goalie: [], rookie: [], teams: ['Edmonton Oilers'] };

    /** Aujourd'hui : le 30 septembre ; le match du 29 est déjà en base. */
    const enBase = [
        feuille('2026-09-10', 2025021999, { goals: 9, assists: 9, points: 18 }), // hors saison demandée plus bas
        feuille('2026-09-29', 2026020004, { goals: 3, assists: 2, points: 5, shots: 6, plus_minus: 2 })
    ];
    // Ce soir : un match en cours que la base n'a pas encore, et le match du
    // 29 que le direct suit encore (déjà en base — à ne pas recompter).
    const direct = [
        { id: 2026020004, jour: '2026-09-29', etat: 'OFF', joueurs: { [BOUCHARD]: { b: 3, p: 2 } }, clubs: { VAN: { v: 1 }, EDM: { dp: 1 } } },
        { id: 2026020007, jour: '2026-09-30', etat: 'LIVE', joueurs: { [BOUCHARD]: { b: 1 } }, clubs: {} }
    ];

    function service({ clubs = { 'Edmonton Oilers': { points: 1 } } } = {}) {
        return creerServicePointage({
            db: creerDb(enBase), calendrierDuJour: async () => 0,
            apportsEnDirect: async () => direct,
            resultatsClubs: async () => clubs,
            idDuJoueur: () => BOUCHARD
        });
    }
    const periode = (debut) => ({ debut, fin: '2026-10-01', saison: String(SAISON), mode: 'cumulative' });

    test('24 h (aujourd’hui) : le but du match en cours, pas encore en base', async () => {
        const r = await service({ clubs: { 'Edmonton Oilers': { points: 0 } } }).pointsEquipe(equipe, periode('2026-09-30'));
        assert.equal(r.points, 1);
        assert.equal(r.detail.joueurs[0].enDirect, 1);
    });

    test('7 j : le match du 29 (en base, 5 points) + le but de ce soir + la DP du club — rien deux fois', async () => {
        const r = await service().pointsEquipe(equipe, periode('2026-09-24'));
        assert.equal(r.detail.joueurs[0].points, 6, '5 en base + 1 ce soir : le 29 n’est pas recompté depuis le direct');
        assert.equal(r.detail.club.points, 1);
        assert.equal(r.points, 7);
    });

    test('30 j : même chose — la saison a deux jours, 30 j égale le Total', async () => {
        const r = await service().pointsEquipe(equipe, periode('2026-09-01'));
        assert.equal(r.detail.joueurs[0].points, 24, 'y compris la ligne du 10 septembre, dans la fenêtre');
    });

    test('le tête-à-tête ne compte ni le direct ni le club, et garde les points fantasy', async () => {
        const r = await service().pointsEquipe(equipe, { ...periode('2026-09-29'), mode: 'head-to-head' });
        assert.equal(r.points, 17);
        assert.equal(r.detail.club.inclus, false);
    });

    test('un direct qui tombe ne fait pas tomber la période', async () => {
        const pointage = creerServicePointage({
            db: creerDb(enBase), calendrierDuJour: async () => 0,
            apportsEnDirect: async () => { throw new Error('LNH indisponible'); },
            resultatsClubs: async () => ({ 'Edmonton Oilers': { points: 0 } }),
            logger: { error() {} }
        });
        const r = await pointage.pointsEquipe(equipe, periode('2026-09-29'));
        assert.equal(r.points, 5);
    });
});

describe('apportsDuMatch : un match, tous ceux qui y ont joué', () => {
    test('le vrai match : Bouchard 3 + 2, Vancouver gagne en prolongation', () => {
        const a = apportsDuMatch(match, boxscore);
        assert.deepEqual(a.joueurs[BOUCHARD], { b: 3, p: 2 });
        assert.deepEqual(a.clubs, { VAN: { v: 1 }, EDM: { dp: 1 } });
        assert.deepEqual(a.joueurs[LANKINEN], { v: 1 });
        assert.deepEqual(a.joueurs[JARRY], { dp: 1 });
    });

    test('sans match : rien', () => {
        assert.deepEqual(apportsDuMatch(null, boxscore), { joueurs: {}, clubs: {} });
    });
});
