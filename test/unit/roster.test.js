'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { NHL_CLUB_FULLNAME, diffRosterSnapshots, getTeamAbbreviationFromName } = require('../../lib/roster.js');

/** Une entrée de photo de roster, telle que fetchAllRosters la produit. */
function joueur(over = {}) {
    return {
        name: 'Nick Suzuki',
        team: 'MTL',
        pos: 'C',
        num: '14',
        headshot: 'https://assets.nhle.com/mugs/nhl/20252026/MTL/8480018.png',
        ...over
    };
}

const HIER = '2026-01-15';

describe('diffRosterSnapshots', () => {
    test('un joueur qui apparaît est une signature', () => {
        const moves = diffRosterSnapshots({}, { 8480018: joueur() }, HIER);

        assert.equal(moves.length, 1);
        assert.equal(moves[0].type, 'signing');
        assert.equal(moves[0].fromTeam, null);
        assert.equal(moves[0].toTeam, 'MTL');
    });

    test('un changement d\'équipe donne UN mouvement d\'échange, pas un départ plus une signature', () => {
        // La carte est globale : compter deux mouvements ferait apparaître le
        // joueur deux fois dans le fil des transactions du jour.
        const avant = { 8480018: joueur({ team: 'MTL' }) };
        const apres = { 8480018: joueur({ team: 'TOR' }) };

        const moves = diffRosterSnapshots(avant, apres, HIER);

        assert.equal(moves.length, 1);
        assert.equal(moves[0].type, 'trade');
        assert.equal(moves[0].fromTeam, 'MTL');
        assert.equal(moves[0].toTeam, 'TOR');
    });

    test('un joueur qui disparaît est un départ', () => {
        const moves = diffRosterSnapshots({ 8480018: joueur() }, {}, HIER);

        assert.equal(moves.length, 1);
        assert.equal(moves[0].type, 'departure');
        assert.equal(moves[0].fromTeam, 'MTL');
        assert.equal(moves[0].toTeam, null);
    });

    test('avec allowDepartures à faux, le départ disparaît complètement', () => {
        const moves = diffRosterSnapshots({ 8480018: joueur() }, {}, HIER, false);

        assert.deepEqual(moves, []);
    });

    test('allowDepartures à faux ne bloque ni les signatures ni les échanges', () => {
        const avant = { 1: joueur({ team: 'MTL' }), 2: joueur({ name: 'Parti' }) };
        const apres = { 1: joueur({ team: 'TOR' }), 3: joueur({ name: 'Nouveau' }) };

        const types = diffRosterSnapshots(avant, apres, HIER, false).map(m => m.type).sort();

        assert.deepEqual(types, ['signing', 'trade']);
    });

    test('un joueur inchangé ne produit aucun mouvement', () => {
        const photo = { 8480018: joueur() };

        assert.deepEqual(diffRosterSnapshots(photo, { ...photo }, HIER), []);
    });

    test('deux photos vides ne produisent rien', () => {
        assert.deepEqual(diffRosterSnapshots({}, {}, HIER), []);
    });

    test('la toute première photo fait de chacun une signature', () => {
        const apres = { 1: joueur({ name: 'A' }), 2: joueur({ name: 'B', team: 'TOR' }) };
        const moves = diffRosterSnapshots({}, apres, HIER);

        assert.equal(moves.length, 2);
        assert.deepEqual(moves.map(m => m.type), ['signing', 'signing']);
    });

    test('l\'identifiant du mouvement est date-joueur-type, et il est stable', () => {
        // C'est la clé de dédoublonnage : deux relevés dans la même journée ne
        // doivent pas doubler le fil.
        const un = diffRosterSnapshots({}, { 8480018: joueur() }, HIER);
        const deux = diffRosterSnapshots({}, { 8480018: joueur() }, HIER);

        assert.equal(un[0].id, '2026-01-15-8480018-signing');
        assert.equal(un[0].id, deux[0].id);
    });

    test('playerId revient en nombre même si la clé de la photo est une chaîne', () => {
        const moves = diffRosterSnapshots({}, { 8480018: joueur() }, HIER);

        assert.equal(moves[0].playerId, 8480018);
        assert.equal(typeof moves[0].playerId, 'number');
    });

    test('les noms de club sont résolus dans les deux sens', () => {
        const avant = { 1: joueur({ team: 'MTL' }) };
        const apres = { 1: joueur({ team: 'TOR' }) };
        const [move] = diffRosterSnapshots(avant, apres, HIER);

        assert.equal(move.fromTeamName, 'Montréal Canadiens');
        assert.equal(move.toTeamName, 'Toronto Maple Leafs');
    });

    test('un code de club inconnu retombe sur le code lui-même', () => {
        const moves = diffRosterSnapshots({}, { 1: joueur({ team: 'XXX' }) }, HIER);

        assert.equal(moves[0].toTeamName, 'XXX');
    });

    test('un code de club de PROVENANCE inconnu retombe aussi sur le code', () => {
        const moves = diffRosterSnapshots({ 1: joueur({ team: 'ZZZ' }) }, { 1: joueur({ team: 'MTL' }) }, HIER);

        assert.equal(moves[0].fromTeamName, 'ZZZ');
        assert.equal(moves[0].toTeamName, 'Montréal Canadiens');
    });

    test('le mouvement reporte la fiche du joueur', () => {
        const moves = diffRosterSnapshots({}, { 8480018: joueur() }, HIER);

        assert.equal(moves[0].playerName, 'Nick Suzuki');
        assert.equal(moves[0].pos, 'C');
        assert.equal(moves[0].num, '14');
        assert.match(moves[0].headshot, /^https:\/\/assets\.nhle\.com\//);
        assert.equal(moves[0].date, HIER);
    });

    test('un départ garde la fiche de la photo PRÉCÉDENTE', () => {
        // Le joueur n'est plus dans la nouvelle photo : son nom ne peut venir
        // que de l'ancienne.
        const moves = diffRosterSnapshots({ 1: joueur({ name: 'Parti', pos: 'D' }) }, {}, HIER);

        assert.equal(moves[0].playerName, 'Parti');
        assert.equal(moves[0].pos, 'D');
    });

    test('sans quatrième argument, les départs sont comptés', () => {
        assert.equal(diffRosterSnapshots({ 1: joueur() }, {}, HIER).length, 1);
    });

    test('plusieurs mouvements de natures différentes dans la même journée', () => {
        const avant = { 1: joueur({ name: 'Reste' }), 2: joueur({ name: 'Echange', team: 'MTL' }), 3: joueur({ name: 'Parti' }) };
        const apres = { 1: joueur({ name: 'Reste' }), 2: joueur({ name: 'Echange', team: 'BOS' }), 4: joueur({ name: 'Signe' }) };

        const moves = diffRosterSnapshots(avant, apres, HIER);

        assert.deepEqual(moves.map(m => `${m.playerName}:${m.type}`).sort(),
            ['Echange:trade', 'Parti:departure', 'Signe:signing']);
    });
});

describe('NHL_CLUB_FULLNAME', () => {
    test('couvre les 32 clubs', () => {
        assert.equal(Object.keys(NHL_CLUB_FULLNAME).length, 32);
    });

    test('Montréal garde son accent', () => {
        // getTeamAbbreviation() du client indexe sur cette chaîne exacte et les
        // clubs repêchés sont enregistrés sous cette forme.
        assert.equal(NHL_CLUB_FULLNAME.MTL, 'Montréal Canadiens');
    });
});

describe('getTeamAbbreviationFromName', () => {
    test('résout un nom accentué', () => {
        assert.equal(getTeamAbbreviationFromName('Montréal Canadiens'), 'MTL');
    });

    test('résout un nom ponctué', () => {
        // « St. Louis Blues » donnerait « ST. » par la règle générale.
        assert.equal(getTeamAbbreviationFromName('St. Louis Blues'), 'STL');
    });

    test('résout les clubs dont le code ne suit pas la règle générale', () => {
        assert.equal(getTeamAbbreviationFromName('Utah Hockey Club'), 'UTA');
        assert.equal(getTeamAbbreviationFromName('Winnipeg Jets'), 'WPG');
        assert.equal(getTeamAbbreviationFromName('Los Angeles Kings'), 'LAK');
        assert.equal(getTeamAbbreviationFromName('New Jersey Devils'), 'NJD');
        assert.equal(getTeamAbbreviationFromName('Vegas Golden Knights'), 'VGK');
    });

    test('l\'ancien nom d\'Arizona résout encore', () => {
        // Des rosters d'anciennes saisons portent encore ce nom.
        assert.equal(getTeamAbbreviationFromName('Arizona Coyotes'), 'ARI');
    });

    test('un nom inconnu retombe sur les trois premières lettres du premier mot', () => {
        assert.equal(getTeamAbbreviationFromName('Quebec Nordiques'), 'QUE');
        assert.equal(getTeamAbbreviationFromName('hartford whalers'), 'HAR');
    });

    test('une chaîne vide rend une chaîne vide', () => {
        assert.equal(getTeamAbbreviationFromName(''), '');
    });

    test('une valeur nulle lève une erreur', () => {
        // Comportement actuel : la fonction ne se garde pas. Verrouillé pour
        // que l'appelant sache qu'il doit filtrer en amont.
        assert.throws(() => getTeamAbbreviationFromName(null), TypeError);
        assert.throws(() => getTeamAbbreviationFromName(undefined), TypeError);
    });
});
