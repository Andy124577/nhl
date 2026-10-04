'use strict';

/**
 * La forme des clubs aux derniers matchs (lib/formeClub.js,
 * services/formeClubs.js) : les meneurs qu'affiche le calendrier sous un
 * match à venir, et la ligne de nos joueurs sur ces mêmes matchs.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { derniersMatchs, lignesDeFeuille, formeDuClub, meneurs } = require('../../lib/formeClub.js');
const { creerFormeClubs, executer, FINAL_RELU_MS } = require('../../services/formeClubs.js');

const patineur = (playerId, nom, goals, assists, position = 'C') =>
    ({ playerId, name: { default: nom }, position, goals, assists, points: goals + assists });

/** Une feuille de match de la LNH, réduite à ce que la forme lit. */
function feuille(away, home, { awayJoueurs = [], homeJoueurs = [], awayGardiens = [], homeGardiens = [] } = {}) {
    return {
        awayTeam: { abbrev: away },
        homeTeam: { abbrev: home },
        playerByGameStats: {
            awayTeam: { forwards: awayJoueurs, defense: [], goalies: awayGardiens },
            homeTeam: { forwards: homeJoueurs, defense: [], goalies: homeGardiens }
        }
    };
}

describe('forme d’un club — calcul', () => {
    test('les derniers matchs terminés, du plus récent au plus ancien', () => {
        const matchs = [
            { id: 1, gameDate: '2026-10-01', gameState: 'OFF' },
            { id: 2, gameDate: '2026-10-03', gameState: 'OFF' },
            { id: 3, gameDate: '2026-10-05', gameState: 'FUT' },
            { id: 4, gameDate: '2026-10-04', gameState: 'FINAL' },
            { id: 5, gameDate: '2026-10-04', gameState: 'LIVE' }
        ];
        assert.deepEqual(derniersMatchs(matchs).map(m => m.id), [4, 2, 1]);
        assert.deepEqual(derniersMatchs(matchs, 2).map(m => m.id), [4, 2]);
        assert.deepEqual(derniersMatchs(null), []);
    });

    test('une feuille : patineurs des deux côtés, gardien au banc écarté', () => {
        const box = feuille('MTL', 'TOR', {
            awayJoueurs: [patineur(1, 'C. Caufield', 2, 0, 'R')],
            awayGardiens: [
                { playerId: 9, name: { default: 'S. Montembeault' }, toi: '00:00', shotsAgainst: 0 },
                { playerId: 10, name: { default: 'J. Dobes' }, toi: '60:00', shotsAgainst: 30, saves: 28, decision: 'W' }
            ]
        });
        const lignes = lignesDeFeuille(box);
        assert.equal(lignes.away.abbrev, 'MTL');
        assert.deepEqual(lignes.away.joueurs.map(j => j.id), [1, 10]);
        assert.deepEqual({ ...lignes.away.joueurs[1] }, { id: 10, nom: 'J. Dobes', pos: 'G', b: 0, a: 0, p: 0, v: 1, arrets: 28, tirs: 30 });
        assert.equal(lignesDeFeuille({}), null, 'sans statistiques de joueurs');
    });

    test('les totaux d’un club sur ses feuilles, de quel côté qu’il ait joué', () => {
        const f1 = lignesDeFeuille(feuille('MTL', 'TOR', { awayJoueurs: [patineur(1, 'A', 1, 1)], homeJoueurs: [patineur(7, 'X', 3, 0)] }));
        const f2 = lignesDeFeuille(feuille('PIT', 'MTL', { homeJoueurs: [patineur(1, 'A', 2, 0), patineur(2, 'B', 0, 1)] }));
        const forme = formeDuClub('MTL', [f1, f2, null]);
        assert.equal(forme.matchs, 2, 'une feuille absente ne compte pas');
        const a = forme.joueurs.find(j => j.id === 1);
        assert.deepEqual({ pj: a.pj, b: a.b, a: a.a, p: a.p }, { pj: 2, b: 3, a: 1, p: 4 });
        assert.equal(forme.joueurs.find(j => j.id === 2).pj, 1);
        assert.ok(!forme.joueurs.some(j => j.id === 7), 'l’adversaire n’est pas compté');
    });

    test('meneurs : égalités départagées, gardiens exclus, personne à zéro', () => {
        const j = (id, b, a, pj = 5, pos = 'C') => ({ id, pos, pj, b, a, p: b + a });
        const { buteur, pointeur } = meneurs([
            j(1, 3, 0), j(2, 3, 2), j(3, 1, 5), j(4, 0, 6, 4), j(5, 0, 9, 5, 'G')
        ]);
        assert.equal(buteur.id, 2, '3 buts chacun : celui qui a aussi des aides');
        assert.equal(pointeur.id, 3, '6 points chacun : celui qui a des buts');
        assert.deepEqual(meneurs([j(1, 0, 0)]), { buteur: null, pointeur: null });
        assert.equal(meneurs([j(1, 2, 0, 5), j(2, 2, 0, 3)]).buteur.id, 2, 'en moins de matchs');
    });
});

describe('forme des clubs — service', () => {
    function monter({ calendriers, feuilles, t = { now: 1_000_000 } }) {
        const lues = [];
        const service = creerFormeClubs({
            calendrierDuClub: async abbrev => calendriers[abbrev] ?? null,
            lireFeuille: async id => { lues.push(id); return feuilles[id] ?? null; },
            saison: () => 20262027,
            nomComplet: id => (id === 1 ? 'Cole Caufield' : null),
            maintenant: () => t.now
        });
        return { service, lues, t };
    }

    const CALENDRIERS = {
        MTL: [{ id: 11, gameDate: '2026-09-29', gameState: 'OFF' }, { id: 12, gameDate: '2026-10-03', gameState: 'OFF' },
            { id: 13, gameDate: '2026-10-06', gameState: 'FUT' }],
        TOR: [{ id: 11, gameDate: '2026-09-29', gameState: 'OFF' }, { id: 14, gameDate: '2026-10-03', gameState: 'FINAL' }]
    };
    const FEUILLES = {
        11: feuille('MTL', 'TOR', { awayJoueurs: [patineur(1, 'C. Caufield', 1, 0, 'R'), patineur(2, 'N. Suzuki', 0, 3)], homeJoueurs: [patineur(8, 'W. Nylander', 2, 1, 'R')] }),
        12: feuille('MTL', 'PIT', { awayJoueurs: [patineur(1, 'C. Caufield', 2, 0, 'R'), patineur(2, 'N. Suzuki', 1, 0)] }),
        14: feuille('OTT', 'TOR', { homeJoueurs: [patineur(8, 'W. Nylander', 0, 0, 'R')] })
    };

    test('meneurs de chaque club, nom complet et photo, et la ligne des joueurs demandés', async () => {
        const { service, lues } = monter({ calendriers: CALENDRIERS, feuilles: FEUILLES });
        const r = await service.lire({ clubs: ['MTL', 'TOR'], joueurs: ['2'] });

        assert.equal(r.clubs.MTL.matchs, 2);
        assert.equal(r.clubs.MTL.buteur.nom, 'Cole Caufield', 'le nom complet du relevé');
        assert.equal(r.clubs.MTL.buteur.photo, 'https://assets.nhle.com/mugs/nhl/20262027/MTL/1.png');
        assert.equal(r.clubs.MTL.pointeur.nom, 'N. Suzuki', 'hors du relevé : le nom de la feuille');
        assert.equal(r.clubs.TOR.buteur.id, 8);
        assert.equal(r.clubs.TOR.buteur.id, r.clubs.TOR.pointeur.id);
        assert.deepEqual({ ...r.joueurs[2] }, { club: 'MTL', matchs: 2, pos: 'C', pj: 2, b: 1, a: 3, p: 4 });
        assert.deepEqual(lues.sort(), [11, 12, 14], 'le match entre deux clubs demandés n’est lu qu’une fois');
    });

    test('une feuille officielle n’est plus relue ; un match FINAL l’est après dix minutes', async () => {
        const { service, lues, t } = monter({ calendriers: CALENDRIERS, feuilles: FEUILLES });
        await service.lire({ clubs: ['TOR'] });
        await service.lire({ clubs: ['TOR'] });
        assert.deepEqual(lues, [14, 11], 'le plus récent d’abord, une fois chacun');
        t.now += FINAL_RELU_MS;
        await service.lire({ clubs: ['TOR'] });
        assert.deepEqual(lues, [14, 11, 14]);
    });

    test('un calendrier qui manque vaut null ; un club sans match, une forme vide', async () => {
        const { service } = monter({ calendriers: { MTL: [] }, feuilles: {} });
        const r = await service.lire({ clubs: ['MTL', 'XYZ'] });
        assert.deepEqual({ ...r.clubs.MTL }, { matchs: 0, buteur: null, pointeur: null });
        assert.equal(r.clubs.XYZ, null);
    });

    test('les tâches s’exécutent quelques-unes à la fois, et une erreur ne fait pas tout tomber', async () => {
        let enCours = 0, pic = 0;
        const tache = v => async () => {
            enCours++; pic = Math.max(pic, enCours);
            await new Promise(r => setImmediate(r));
            enCours--;
            if (v === 3) throw new Error('LNH');
            return v;
        };
        const r = await executer([1, 2, 3, 4, 5, 6].map(tache), 2);
        assert.deepEqual(r, [1, 2, null, 4, 5, 6]);
        assert.equal(pic, 2);
    });
});
