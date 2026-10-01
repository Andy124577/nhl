'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { nomsRepeches, joueursAAjouter, fusionnerReleves } = require('../../lib/joueursRepeches.js');

/** Un pool à une équipe, dans la forme stockée. */
function pool(equipe) {
    return { Pool: { teams: { Rouge: { members: ['a'], ...equipe } } } };
}

/** La liste de suivi (loadAllPlayers) : nhl_filtered_stats.json. */
const SUIVIS = [
    { playerId: 8478402, skaterFullName: 'Connor McDavid', isGoalie: false },
    { playerId: 8482116, skaterFullName: 'Tim Stutzle', isGoalie: false },
    { playerId: 8481546, skaterFullName: 'Egor Chinakhov', isGoalie: false },
    { playerId: 8476883, goalieFullName: 'Andrei Vasilevskiy', isGoalie: true }
];

/** Une trousse réduite : identifiant parfois absent, comme dans draftkit.json. */
const TROUSSE = {
    skaters: [
        { fullName: 'Connor McDavid', playerId: 8478402, team: 'EDM' },
        { fullName: 'Tim Stützle', playerId: 8482116, team: 'OTT' },
        { fullName: 'Yegor Chinakhov', playerId: 8481546, team: 'CBJ' },
        { fullName: 'Alexandre Texier', playerId: null, team: 'MTL' },
        { fullName: 'Jayden Struble', playerId: null, team: 'MTL' },
        { fullName: 'Elias Pettersson', playerId: null, team: 'VAN' }
    ],
    goalies: [
        { fullName: 'Andrei Vasilevskiy', playerId: 8476883, team: 'TBL' },
        { fullName: 'Sergei Murashov', playerId: 8483703, team: 'PIT' },
        { fullName: 'Nikke Kokko', playerId: null, team: 'SEA' }
    ]
};

/** La photo des effectifs de la LNH (nhl_roster_snapshot.json). */
const EFFECTIFS = {
    players: {
        8480074: { name: 'Alexandre Texier', team: 'MTL', pos: 'C' },
        8481064: { name: 'Jayden Struble', team: 'MTL', pos: 'D' },
        8483565: { name: 'Nikke Kokko', team: 'SEA', pos: 'G' },
        8480012: { name: 'Elias Pettersson', team: 'VAN', pos: 'C' },
        8483678: { name: 'Elias Pettersson', team: 'VAN', pos: 'D' }
    }
};

describe('nomsRepeches', () => {
    test('rassemble les quatre cases de joueurs de toutes les équipes de tous les pools', () => {
        const pools = {
            A: { teams: { Rouge: { offensive: ['Connor McDavid'], defensive: ['Jayden Struble'] } } },
            B: { teams: { Bleu: { goalie: ['Andrei Vasilevskiy'], rookie: ['Sergei Murashov'] } } }
        };

        const noms = nomsRepeches(pools);

        assert.deepEqual([...noms.keys()].sort(),
            ['Andrei Vasilevskiy', 'Connor McDavid', 'Jayden Struble', 'Sergei Murashov']);
    });

    test('la case dit le poste ; une recrue reste à déterminer', () => {
        const noms = nomsRepeches(pool({ offensive: ['A'], goalie: ['G'], rookie: ['R'] }));

        assert.equal(noms.get('A'), false);
        assert.equal(noms.get('G'), true);
        assert.equal(noms.get('R'), null);
    });

    test('le banc compte : un joueur de banc peut entrer demain', () => {
        const noms = nomsRepeches(pool({ bench: [{ nom: 'Jayden Struble', categorie: 'defensive' }, 'Sans Case'] }));

        assert.equal(noms.get('Jayden Struble'), false);
        assert.equal(noms.get('Sans Case'), null);
    });

    test('les clubs repêchés ne sont pas des joueurs', () => {
        const noms = nomsRepeches(pool({ teams: ['Montreal Canadiens'] }));

        assert.equal(noms.size, 0);
    });

    test('lit aussi les choix inscrits en objet', () => {
        const noms = nomsRepeches(pool({
            offensive: [{ skaterFullName: 'Connor McDavid' }],
            goalie: [{ goalieFullName: 'Andrei Vasilevskiy' }],
            bench: [{ nom: 'Nikke Kokko', categorie: 'goalie' }, { nom: 42 }]
        }));

        assert.deepEqual([...noms.entries()],
            [['Connor McDavid', false], ['Andrei Vasilevskiy', true], ['Nikke Kokko', true]]);
    });

    test('une recrue repêchée ailleurs comme gardienne est un gardien', () => {
        const pools = {
            A: { teams: { Rouge: { rookie: ['Nikke Kokko'] } } },
            B: { teams: { Bleu: { goalie: ['Nikke Kokko'] } } }
        };

        assert.equal(nomsRepeches(pools).get('Nikke Kokko'), true);
    });

    test('tolère des pools vides, des équipes sans cases et des entrées vides', () => {
        assert.equal(nomsRepeches(null).size, 0);
        assert.equal(nomsRepeches({ A: {} }).size, 0);
        assert.equal(nomsRepeches({ A: { teams: { X: null, Y: { offensive: ['', null, '  '] } } } }).size, 0);
    });
});

describe('joueursAAjouter', () => {
    const ajouter = (equipe, options = {}) =>
        joueursAAjouter(SUIVIS, pool(equipe), { trousse: TROUSSE, effectifs: EFFECTIFS, ...options });

    test('un repêché déjà suivi n\'est pas ajouté', () => {
        assert.deepEqual(ajouter({ offensive: ['Connor McDavid'] }).ajouts, []);
    });

    test('un repêché suivi sous une graphie accentuée n\'est pas ajouté deux fois', () => {
        assert.deepEqual(ajouter({ offensive: ['Tim Stützle'] }).ajouts, []);
    });

    test('un ancien nom du repêchage retrouve le joueur suivi (« Mitchell » / « Mitch » Marner)', () => {
        const suivis = [{ playerId: 8478483, skaterFullName: 'Mitch Marner' }];

        const { ajouts, introuvables } = joueursAAjouter(suivis, pool({ offensive: ['Mitchell Marner'] }));

        assert.deepEqual(ajouts, []);
        assert.deepEqual(introuvables, []);
    });

    test('un repêché suivi sous un autre nom, même identifiant, n\'est pas ajouté deux fois', () => {
        assert.deepEqual(ajouter({ offensive: ['Yegor Chinakhov'] }).ajouts, []);
    });

    test('un repêché hors liste est ajouté sous le nom repêché, avec l\'identifiant de la photo des effectifs', () => {
        const { ajouts } = ajouter({ offensive: ['Alexandre Texier'], defensive: ['Jayden Struble'] });

        assert.deepEqual(ajouts, [
            { playerId: 8480074, skaterFullName: 'Alexandre Texier', isGoalie: false },
            { playerId: 8481064, skaterFullName: 'Jayden Struble', isGoalie: false }
        ]);
    });

    test('une recrue gardienne est relevée en gardienne', () => {
        const { ajouts } = ajouter({ rookie: ['Nikke Kokko'] });

        assert.deepEqual(ajouts, [{ playerId: 8483565, goalieFullName: 'Nikke Kokko', isGoalie: true }]);
    });

    test('l\'identifiant de la trousse fait foi quand elle en a un', () => {
        const suivis = SUIVIS.filter(p => p.goalieFullName !== 'Sergei Murashov');
        const { ajouts } = joueursAAjouter(suivis, pool({ rookie: ['Sergei Murashov'] }), { trousse: TROUSSE });

        assert.deepEqual(ajouts, [{ playerId: 8483703, goalieFullName: 'Sergei Murashov', isGoalie: true }]);
    });

    test('des homonymes que ni le poste ni le club ne départagent restent introuvables', () => {
        const { ajouts, introuvables } = ajouter({ offensive: ['Elias Pettersson'] });

        assert.deepEqual(ajouts, []);
        assert.deepEqual(introuvables, ['Elias Pettersson']);
    });

    test('le poste départage deux homonymes du même club', () => {
        const trousse = { skaters: [], goalies: [] };
        const effectifs = { players: {
            1: { name: 'Jean Double', team: 'MTL', pos: 'C' },
            2: { name: 'Jean Double', team: 'MTL', pos: 'G' }
        } };

        const { ajouts } = joueursAAjouter([], pool({ goalie: ['Jean Double'] }), { trousse, effectifs });

        assert.deepEqual(ajouts, [{ playerId: 2, goalieFullName: 'Jean Double', isGoalie: true }]);
    });

    test('le club de la trousse départage deux homonymes', () => {
        const trousse = { skaters: [{ fullName: 'Jean Double', playerId: null, team: 'BOS' }], goalies: [] };
        const effectifs = { players: {
            1: { name: 'Jean Double', team: 'MTL', pos: 'C' },
            2: { name: 'Jean Double', team: 'BOS', pos: 'C' }
        } };

        const { ajouts } = joueursAAjouter([], pool({ offensive: ['Jean Double'] }), { trousse, effectifs });

        assert.deepEqual(ajouts, [{ playerId: 2, skaterFullName: 'Jean Double', isGoalie: false }]);
    });

    test('hors de la trousse, la photo des effectifs dit si une recrue est gardienne', () => {
        const effectifs = { players: { 9: { name: 'Jean Recrue', team: 'MTL', pos: 'G' }, 10: null } };

        const { ajouts } = joueursAAjouter([], pool({ rookie: ['Jean Recrue'] }), { effectifs });

        assert.deepEqual(ajouts, [{ playerId: 9, goalieFullName: 'Jean Recrue', isGoalie: true }]);
    });

    test('une ligne de relevé (playerName) compte comme suivie', () => {
        const suivis = [{ playerName: 'Alexandre Texier' }];

        const { ajouts, introuvables } = joueursAAjouter(suivis, pool({ offensive: ['Alexandre Texier'] }),
            { trousse: TROUSSE, effectifs: EFFECTIFS });

        assert.deepEqual(ajouts, []);
        assert.deepEqual(introuvables, []);
    });

    test('un joueur hors des effectifs de la LNH est introuvable, sans erreur', () => {
        const { ajouts, introuvables } = ajouter({ offensive: ['Joueur Inconnu'] });

        assert.deepEqual(ajouts, []);
        assert.deepEqual(introuvables, ['Joueur Inconnu']);
    });

    test('sans trousse ni photo des effectifs, tout repêché hors liste est introuvable', () => {
        const { ajouts, introuvables } = joueursAAjouter(SUIVIS, pool({ offensive: ['Alexandre Texier'] }));

        assert.deepEqual(ajouts, []);
        assert.deepEqual(introuvables, ['Alexandre Texier']);
    });

    test('deux graphies du même joueur hors liste ne le font relever qu\'une fois', () => {
        const pools = {
            A: { teams: { Rouge: { offensive: ['Alexandre Texier'] } } },
            B: { teams: { Bleu: { offensive: ['Alexandre  Texier'] } } }
        };

        const { ajouts } = joueursAAjouter(SUIVIS, pools, { trousse: TROUSSE, effectifs: EFFECTIFS });

        assert.equal(ajouts.length, 1);
    });
});

describe('fusionnerReleves', () => {
    const releve = {
        lastUpdated: '2026-10-01T04:00:00.000Z',
        season: 20262027,
        players: [{ playerId: 1, playerName: 'Connor McDavid', points: 3 }],
        inclusion: { 1: { depuis: '2026-09-30', matchs: [] } }
    };

    test('ajoute les nouvelles lignes, et leur inclusion à part', () => {
        const ligne = { playerId: 2, playerName: 'Alexandre Texier', points: 1, inclusion: { depuis: '2026-09-30', matchs: [7] } };

        const { stats, ajoutees } = fusionnerReleves(releve, [ligne]);

        assert.equal(ajoutees, 1);
        assert.deepEqual(stats.players.map(p => p.playerName), ['Connor McDavid', 'Alexandre Texier']);
        assert.equal('inclusion' in stats.players[1], false);
        assert.deepEqual(stats.inclusion[2], { depuis: '2026-09-30', matchs: [7] });
        assert.deepEqual(stats.inclusion[1], releve.inclusion[1]);
        assert.equal(stats.lastUpdated, releve.lastUpdated);
    });

    test('ne recopie pas une ligne déjà présente : une collecte complète a pu passer', () => {
        const { stats, ajoutees } = fusionnerReleves(releve, [{ playerId: 1, playerName: 'Connor McDavid', points: 9 }]);

        assert.equal(ajoutees, 0);
        assert.equal(stats, releve);
    });

    test('ne modifie pas le relevé reçu', () => {
        fusionnerReleves(releve, [{ playerId: 3, playerName: 'Jayden Struble' }]);

        assert.equal(releve.players.length, 1);
        assert.equal(releve.inclusion[3], undefined);
    });

    test('ignore les lignes vides ou sans identifiant, et les doublons du lot', () => {
        const { stats, ajoutees } = fusionnerReleves(releve, [
            null, { playerName: 'Sans Id' }, { playerId: 4, playerName: 'X' }, { playerId: 4, playerName: 'X' }
        ]);

        assert.equal(ajoutees, 1);
        assert.equal(stats.players.length, 2);
    });
});
