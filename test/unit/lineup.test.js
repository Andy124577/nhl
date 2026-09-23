'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const lineup = require('../../lib/lineup.js');
const poolOps = require('../../lib/poolOps.js');
const { checkIfDraftComplete } = require('../../lib/draft.js');
const { creerServicePointage } = require('../../services/scoring.js');

function equipe() {
    return {
        members: ['alice'],
        offensive: ['Attaquant A', 'Attaquant B'],
        defensive: ['Défenseur A'],
        goalie: ['Gardien A'],
        rookie: [],
        teams: [],
        bench: [{ nom: 'Attaquant Banc', categorie: 'offensive' }, { nom: 'Gardien Banc', categorie: 'goalie' }]
    };
}

// Midi à Montréal le 14 octobre : le changement vaut à partir du 15.
const MARDI = new Date('2026-10-14T16:00:00Z');

test('le banc n’existe qu’en tête-à-tête, et reste borné', () => {
    assert.equal(lineup.quotaBanc({ poolMode: 'cumulative', config: { numBench: 3 } }), 0);
    assert.equal(lineup.quotaBanc({ poolMode: 'head-to-head', config: { numBench: 3 } }), 3);
    assert.equal(lineup.quotaBanc({ poolMode: 'head-to-head', config: { numBench: 99 } }), lineup.BANC_MAX);
    assert.equal(lineup.quotaBanc({ poolMode: 'head-to-head', config: {} }), 0);
});

test('un joueur du banc remplace un partant de la même catégorie, à partir du lendemain', () => {
    const e = equipe();
    const r = lineup.echangerBanc(e, { entre: 'Attaquant Banc', sort: 'Attaquant B', maintenant: MARDI });
    assert.equal(r.ok, true);
    assert.equal(r.date, '2026-10-15');
    assert.deepEqual(e.offensive, ['Attaquant A', 'Attaquant Banc']);
    assert.deepEqual(e.bench[0], { nom: 'Attaquant B', categorie: 'offensive' });

    // Mardi, l'ancien partant compte encore ; mercredi, le nouveau.
    assert.equal(lineup.partantsLe(e, '2026-10-14').has('Attaquant B'), true);
    assert.equal(lineup.partantsLe(e, '2026-10-14').has('Attaquant Banc'), false);
    assert.equal(lineup.partantsLe(e, '2026-10-15').has('Attaquant Banc'), true);
    assert.equal(lineup.partantsLe(e, '2026-10-15').has('Attaquant B'), false);
});

test('un gardien de banc ne peut pas remplacer un attaquant', () => {
    const e = equipe();
    const r = lineup.echangerBanc(e, { entre: 'Gardien Banc', sort: 'Attaquant A', maintenant: MARDI });
    assert.equal(r.ok, false);
    assert.equal(r.code, 400);
    assert.match(r.message, /Position invalide/);
    assert.deepEqual(e.offensive, ['Attaquant A', 'Attaquant B'], 'rien ne bouge sur un refus');
});

test('défaire un changement le jour même efface l’entrée au lieu d’en empiler une', () => {
    const e = equipe();
    lineup.echangerBanc(e, { entre: 'Attaquant Banc', sort: 'Attaquant B', maintenant: MARDI });
    const retour = lineup.echangerBanc(e, { entre: 'Attaquant B', sort: 'Attaquant Banc', maintenant: MARDI });
    assert.equal(retour.annule, true);
    assert.deepEqual(e.lineupChanges, []);
    assert.deepEqual(e.offensive, ['Attaquant A', 'Attaquant B']);
});

test('la période réunit tous ceux qui ont été partants au moins un jour', () => {
    const e = equipe();
    lineup.echangerBanc(e, { entre: 'Attaquant Banc', sort: 'Attaquant B', maintenant: MARDI });
    const semaine = lineup.partantsDeLaPeriode(e, '2026-10-12', '2026-10-19');
    assert.equal(semaine.has('Attaquant B'), true);
    assert.equal(semaine.has('Attaquant Banc'), true);
    assert.equal(semaine.has('Gardien Banc'), false);
});

// ───────────────────────────── Repêchage ─────────────────────────────

function poolH2H() {
    return {
        poolMode: 'head-to-head',
        creator: 'alice',
        config: { numOffensive: 1, numDefensive: 0, numGoalies: 0, numRookies: 0, numTeams: 0, numBench: 1 },
        draftOrder: ['A', 'B', 'B', 'A'],
        currentPickIndex: 0,
        lastPickIndex: -1,
        teams: {
            A: { members: ['alice'], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] },
            B: { members: ['bob'], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] }
        }
    };
}

test('une catégorie pleine envoie le choix au banc, jusqu’à ce qu’il soit plein', () => {
    const p = poolH2H();
    assert.equal(poolOps.totalSelections(p), 2, 'le banc compte dans les rondes');
    poolOps.choisirJoueur(p, { username: 'alice', playerName: 'J1', position: 'offensive' });
    poolOps.choisirJoueur(p, { username: 'bob', playerName: 'J2', position: 'offensive' });
    const banc = poolOps.choisirJoueur(p, { username: 'bob', playerName: 'J3', position: 'offensive' });
    assert.equal(banc.ok, true);
    assert.equal(banc.banc, true);
    assert.deepEqual(p.teams.B.bench, [{ nom: 'J3', categorie: 'offensive' }]);
    assert.equal(checkIfDraftComplete(p), false, 'A n’a pas encore son banc');

    const fin = poolOps.choisirJoueur(p, { username: 'alice', playerName: 'J4', position: 'offensive' });
    assert.equal(fin.draftComplet, true);

    // Un joueur au banc ne peut plus être repêché par quelqu'un d'autre.
    assert.ok(poolOps.joueursChoisis(p).includes('J3'));
});

test('sans banc, une catégorie pleine reste un refus', () => {
    const p = poolH2H();
    p.config.numBench = 0;
    p.draftOrder = ['A', 'B', 'A'];
    poolOps.choisirJoueur(p, { username: 'alice', playerName: 'J1', position: 'offensive' });
    poolOps.choisirJoueur(p, { username: 'bob', playerName: 'J2', position: 'offensive' });
    const refus = poolOps.choisirJoueur(p, { username: 'alice', playerName: 'J3', position: 'offensive' });
    assert.equal(refus.ok, false);
});

// ───────────────────────────── Pointage ─────────────────────────────

test('un match ne compte que si le joueur était partant ce jour-là', async () => {
    const feuille = (nom, jour, buts) => ({
        player_name: nom, player_id: 1, team_abbrev: 'MTL', position: 'C', season: '20262027',
        game_id: `${jour}-${nom}`, game_date: jour, goals: buts, assists: 0, points: buts, shots: 0,
        plus_minus: 0, power_play_goals: 0, power_play_points: 0, shorthanded_goals: 0,
        shorthanded_points: 0, game_winning_goals: 0, decision: null, saves: 0, goals_against: 0, shutouts: 0
    });
    const lignes = [
        feuille('Attaquant B', '2026-10-13', 1),    // partant : compte
        feuille('Attaquant Banc', '2026-10-13', 3), // au banc : ne compte pas
        feuille('Attaquant Banc', '2026-10-16', 1), // entré le 15 : compte
        feuille('Attaquant B', '2026-10-16', 2)     // sorti le 15 : ne compte pas
    ];
    const db = {
        async query(sql, params) {
            if (sql.includes('COUNT(DISTINCT game_id)')) return { rows: [] };
            const [, debut, fin, noms] = params;
            return { rows: lignes.filter(l => l.game_date >= debut && l.game_date < fin && noms.includes(l.player_name)) };
        }
    };
    const pointage = creerServicePointage({ db, logger: { log() {}, warn() {}, error() {} } });
    const e = equipe();
    e.offensive = ['Attaquant B'];
    e.defensive = []; e.goalie = [];
    e.bench = [{ nom: 'Attaquant Banc', categorie: 'offensive' }];
    lineup.echangerBanc(e, { entre: 'Attaquant Banc', sort: 'Attaquant B', maintenant: MARDI });

    const detail = await pointage.detailEquipe(e, { debut: '2026-10-12', fin: '2026-10-19', saison: '20262027' });
    const buts = Object.fromEntries(detail.map(j => [j.name, j.goals]));
    assert.deepEqual(buts, { 'Attaquant B': 1, 'Attaquant Banc': 1 });
});
