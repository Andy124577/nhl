'use strict';

/**
 * Récents (lib/recents.js) : seul ce qui touche le pool entre dans le fil.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../../lib/recents.js');

const POOL = {
    teams: {
        'Les Loups': { members: ['andy'], offensive: ['Cole Caufield', { nom: 'Nick Suzuki' }], defensive: ['Lane Hutson'], goalie: [], teams: ['Montréal Canadiens'], bench: [{ nom: 'Juraj Slafkovský' }] },
        'Les Castors': { members: ['bob'], offensive: ['Auston Matthews', 'Cole Caufield'], defensive: [], goalie: [] },
        'Équipe 3': { members: [], offensive: ['Connor McDavid'] }
    }
};

describe('recents — qui possède quel joueur', () => {
    const index = R.indexerJoueursDuPool(POOL, 'Les Loups');

    test('les noms sont comparés sans accents ni casse', () => {
        assert.equal(R.cleNom('Juraj Slafkovský'), 'juraj slafkovsky');
        assert.equal(R.cleNom('Martin St. Louis Jr.'), 'martin st louis');
        assert.ok(index.has('juraj slafkovsky'));
    });

    test('chaînes et objets de la trousse, banc compris', () => {
        assert.equal(index.get('nick suzuki').equipe, 'Les Loups');
        assert.equal(index.get('juraj slafkovsky').mien, true);
        assert.equal(index.get('auston matthews').mien, false);
    });

    test('un joueur sur deux équipes garde la mienne', () => {
        assert.equal(index.get('cole caufield').equipe, 'Les Loups');
        const autre = R.indexerJoueursDuPool(POOL, 'Les Castors');
        assert.equal(autre.get('cole caufield').equipe, 'Les Castors');
    });

    test('une équipe sans membre ne compte pas', () => {
        assert.equal(index.has('connor mcdavid'), false);
    });

    test('un pool vide donne un index vide', () => {
        assert.equal(R.indexerJoueursDuPool(null, null).size, 0);
    });
});

describe('recents — blessures du pool', () => {
    const index = R.indexerJoueursDuPool(POOL, 'Les Loups');
    const blesses = [
        { playerName: 'Lane Hutson', team: 'MTL', status: 'Out', statusFr: 'Absent', injuryType: 'Knee', since: '2026-11-13T18:00:00Z' },
        { playerName: 'Auston Matthews', team: 'TOR', status: 'Injured Reserve', statusFr: 'Réserve des blessés', since: '2026-11-14T02:00:00Z' },
        { playerName: 'Sidney Crosby', team: 'PIT', status: 'Out', since: '2026-11-14T02:00:00Z' },
        { playerName: 'Nick Suzuki', team: 'MTL', status: 'Day-To-Day', since: null },
        { playerName: 'Juraj Slafkovsky', team: 'MTL', status: 'Out', since: '2026-09-01T00:00:00Z' }
    ];
    const liste = R.blessuresDuPool(blesses, index, { aujourdhui: '2026-11-14', nomEquipe: n => `«${n}»` });

    test('seuls les joueurs du pool, du plus récent au plus ancien, sans date en dernier', () => {
        assert.deepEqual(liste.map(b => b.joueur), ['Auston Matthews', 'Lane Hutson', 'Nick Suzuki']);
    });

    test('une blessure trop ancienne n’est plus récente', () => {
        assert.ok(!liste.some(b => b.joueur === 'Juraj Slafkovský'));
    });

    test('le propriétaire et « mien » suivent l’index', () => {
        assert.equal(liste[0].mien, false);
        assert.equal(liste[0].equipe, '«Les Castors»');
        assert.equal(liste[1].mien, true);
        assert.equal(liste[1].nature, 'Knee');
        assert.equal(liste[2].statutFr, 'Day-To-Day');
    });

    test('sans rapport, rien', () => {
        assert.deepEqual(R.blessuresDuPool(null, index), []);
    });
});

describe('recents — mouvements LNH du pool', () => {
    const index = R.indexerJoueursDuPool(POOL, 'Les Loups');
    const journal = { transactions: [
        { type: 'trade', date: '2026-11-12', playerName: 'Auston Matthews', fromTeam: 'TOR', toTeam: 'SEA' },
        { type: 'signing', date: '2026-11-13', playerName: 'Lane Hutson', toTeam: 'MTL' },
        { type: 'trade', date: '2026-10-01', playerName: 'Cole Caufield', fromTeam: 'MTL', toTeam: 'BOS' },
        { type: 'trade', date: '2026-11-13', playerName: 'Inconnu Total', fromTeam: 'MTL', toTeam: 'BOS' },
        { type: 'trade', date: null, playerName: 'Nick Suzuki' }
    ] };
    const liste = R.mouvementsDuPool(journal, index, { aujourdhui: '2026-11-14' });

    test('fenêtre récente, joueurs du pool, plus récents d’abord', () => {
        assert.deepEqual(liste.map(t => t.joueur), ['Lane Hutson', 'Auston Matthews']);
        assert.equal(liste[0].mien, true);
        assert.equal(liste[1].de, 'TOR');
        assert.equal(liste[1].vers, 'SEA');
        assert.equal(liste[1].equipe, 'Les Castors');
    });

    test('sans journal, rien', () => {
        assert.deepEqual(R.mouvementsDuPool(null, index), []);
    });
});

describe('recents — ma soirée', () => {
    const match = (id, away, home, etat, extra = {}) => ({
        id, gameDate: '2026-11-14', gameState: etat, startTimeUTC: `2026-11-15T0${id}:00:00Z`,
        awayTeam: { abbrev: away, score: 2 }, homeTeam: { abbrev: home, score: 3 }, ...extra
    });
    const mesJoueurs = [
        { nom: 'Cole Caufield', playerId: 1, club: 'MTL' },
        { nom: 'Lane Hutson', playerId: 2, club: 'MTL' },
        { nom: 'Ivan Demidov', playerId: 3, club: 'TOR,MTL' },
        { nom: 'Sans Club', playerId: 4, club: '' }
    ];
    const soirees = { joueurs: { 1: { etat: 'LIVE', ppa: 2 }, 2: { etat: 'LIVE', ppa: 0 }, 3: { etat: 'LIVE', ppa: 1 } }, clubs: { MTL: { etat: 'LIVE', ppa: 0 }, NYR: { etat: 'FUT', ppa: 4 } } };

    test('seuls mes matchs, en direct d’abord, avec mes points', () => {
        const liste = R.matchsDeMaSoiree([
            match(3, 'BOS', 'NYR', 'FUT'),
            match(1, 'TOR', 'MTL', 'LIVE', { periodDescriptor: { number: 2, periodType: 'REG' }, clock: { timeRemaining: '12:01', inIntermission: false } }),
            match(2, 'EDM', 'CGY', 'LIVE'),
            match(4, 'VAN', 'SEA', 'OFF', { gameDate: '2026-11-13' })
        ], { mesJoueurs, mesClubs: ['MTL', 'NYR'], soirees, aujourdhui: '2026-11-14' });
        assert.deepEqual(liste.map(m => m.id), [1, 3]);
        const [mtl, nyr] = liste;
        assert.equal(mtl.etat, 'LIVE');
        assert.equal(mtl.periode, 2);
        assert.equal(mtl.horloge, '12:01');
        assert.equal(mtl.points, 3);
        assert.deepEqual(mtl.joueurs.map(j => j.nom), ['Cole Caufield', 'Ivan Demidov', 'Lane Hutson']);
        assert.deepEqual(mtl.clubs, [{ club: 'MTL', points: 0 }]);
        // Match pas commencé : la soirée d'hier ne compte pas.
        assert.equal(nyr.etat, 'FUT');
        assert.equal(nyr.points, 0);
    });

    test('match fini : « FINAL »', () => {
        const [m] = R.matchsDeMaSoiree([match(1, 'TOR', 'MTL', 'OFF')], { mesJoueurs, soirees, aujourdhui: '2026-11-14' });
        assert.equal(m.etat, 'FINAL');
        assert.equal(R.etatDuMatch({ gameState: 'CRIT' }), 'LIVE');
        assert.equal(R.etatDuMatch(null), 'FUT');
    });

    test('rien de mien, entrées incomplètes : liste vide', () => {
        assert.deepEqual(R.matchsDeMaSoiree([null, { id: 9 }, match(1, 'TOR', 'MTL', 'LIVE')], {}), []);
        assert.deepEqual(R.matchsDeMaSoiree(null), []);
    });
});

describe('recents — activité du pool', () => {
    const ev = (type, sujet, t) => ({ type, sujet, occurredAt: `2026-11-14T${t}:00:00Z`, texte: type });

    test('sans les choix de repêchage ni les annonces retirées ou échangées', () => {
        const liste = R.activiteUtile([
            ev('trade_completed', { offering: ['Mitch Marner'], receiving: ['Kirill Kaprizov'] }, '15'),
            ev('listing_removed', { teamName: 'Les Castors', playerName: 'Jason Robertson' }, '14'),
            ev('listing_activated', { teamName: 'Les Castors', playerName: 'Jason Robertson' }, '13'),
            ev('listing_activated', { teamName: 'Les Draveurs', playerName: 'Mitch Marner' }, '12'),
            ev('listing_activated', { teamName: 'Les Loups', playerName: 'Lane Hutson' }, '11'),
            ev('pick', {}, '10'),
            ev('draft_started', {}, '09'),
            { ...ev('h2h_week_finalized', { weekNumber: 7 }, '08'), revisee: true },
            null
        ]);
        assert.deepEqual(liste.map(e => e.genre), ['trade_completed', 'listing_activated', 'h2h_week_finalized']);
        assert.equal(liste[1].sujet.playerName, 'Lane Hutson');
        assert.equal(liste[2].revisee, true);
        assert.deepEqual(R.activiteUtile(null), []);
    });
});

describe('recents — la barre', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../navbar.js'), 'utf8');

    test('Récents prend la place de Mon équipe, avec la pastille des offres', () => {
        const barre = source.slice(source.indexOf('function buildBottomNav'), source.indexOf('BARRE DU BAS : LE TOUCHER'));
        assert.match(barre, /onglet\('recents', 'recents\.html', 'Récents', ' id="bottomRecentsLink"'\)\}\s*<span class="notif-badge" id="bottomTradeBadge"/);
        assert.doesNotMatch(barre, /'Mon équipe'/);
    });

    test('la page existe et charge son script', () => {
        const html = fs.readFileSync(path.join(__dirname, '../../recents.html'), 'utf8');
        assert.match(html, /recents\.js\?v=/);
        assert.match(html, /activePool\.js/);
        assert.match(html, /navbar\.js/);
    });

    test('le classement offre « Mon équipe » à une touche', () => {
        const html = fs.readFileSync(path.join(__dirname, '../../classement.html'), 'utf8');
        assert.match(html, /id="stMonEquipe"/);
    });
});

describe('recents — la route', () => {
    const routesRecents = require('../../routes/recents.js');

    function monter({ activite = [{ id: 1 }], echec = null, usePostgres = true } = {}) {
        const routes = new Map();
        const lectures = { activite: 0 };
        const app = { get: (chemin, ...g) => routes.set(chemin, g.at(-1)) };
        routesRecents.monter(app, {
            auth: { requireAuth: (req, res, next) => next() },
            store: { lire: async nom => (nom === 'P' ? { id: 7, data: POOL } : null) },
            db: {
                getPoolActivity: async (id, { limite }) => { lectures.activite += 1; assert.equal(id, 7); assert.ok(limite > 0); return activite; },
                generationDonnees: () => 1
            },
            usePostgres,
            confianceMs: 60000,
            decrireActivite: () => ({ type: 'trade_completed', occurredAt: '2026-11-14T12:00:00Z', texte: 'x', sujet: { offering: ['Cole Caufield'], receiving: ['Auston Matthews'] } }),
            blessesLNH: async () => { if (echec === 'blesses') throw new Error('ESPN'); return [{ playerName: 'Lane Hutson', team: 'MTL', status: 'Out', since: new Date().toISOString() }]; },
            journalLNH: async () => ({ transactions: [] }),
            soireesEnDirect: async () => ({ joueurs: { 1: { etat: 'LIVE', ppa: 2 } }, clubs: {} }),
            matchsDuJour: async () => [{ id: 5, gameState: 'LIVE', awayTeam: { abbrev: 'TOR', score: 1 }, homeTeam: { abbrev: 'MTL', score: 2 } }],
            ficheReleve: nom => (nom === 'Cole Caufield' ? { playerId: 1, teamAbbrev: 'MTL' } : null),
            logger: { error() {}, warn() {} }
        });
        const appeler = async (pool = 'P', username = 'andy', isAdmin = false) => {
            let corps = null, statut = 200;
            const res = { set() {}, status(c) { statut = c; return this; }, json(b) { corps = b; return this; } };
            await routes.get('/api/pools/:poolName/recents')({ params: { poolName: pool }, auth: { username, isAdmin } }, res);
            return { statut, corps };
        };
        return { appeler, lectures };
    }

    test('assemble ma soirée, les blessés du pool et l’activité', async () => {
        const { appeler } = monter();
        const { statut, corps } = await appeler();
        assert.equal(statut, 200);
        assert.equal(corps.monEquipe, 'Les Loups');
        assert.equal(corps.ceSoir.length, 1);
        assert.equal(corps.ceSoir[0].points, 2);
        assert.deepEqual(corps.blessures.map(b => b.joueur), ['Lane Hutson']);
        assert.equal(corps.pool.length, 1);
        assert.equal(corps.pool[0].joueur, 'Cole Caufield');
        assert.match(corps.pool[0].photo, /\/1\.png$/);
        assert.equal(corps.activiteDisponible, true);
    });

    test('l’activité est gardée tant que rien n’est écrit en base', async () => {
        const { appeler, lectures } = monter();
        await appeler();
        await appeler();
        assert.equal(lectures.activite, 1);
    });

    test('une source en panne ne vide pas les autres', async () => {
        const { corps } = (await monter({ echec: 'blesses' }).appeler());
        assert.deepEqual(corps.blessures, []);
        assert.equal(corps.ceSoir.length, 1);
    });

    test('sans PostgreSQL, pas de fil d’activité, le reste tient', async () => {
        const { corps } = await monter({ usePostgres: false }).appeler();
        assert.equal(corps.activiteDisponible, false);
        assert.deepEqual(corps.pool, []);
    });

    test('pool inconnu : 404 ; non-membre : 403 ; admin : permis', async () => {
        const { appeler } = monter();
        assert.equal((await appeler('X')).statut, 404);
        assert.equal((await appeler('P', 'intrus')).statut, 403);
        const admin = await appeler('P', 'intrus', true);
        assert.equal(admin.statut, 200);
        assert.equal(admin.corps.monEquipe, null);
        assert.deepEqual(admin.corps.ceSoir, []);
    });
});

describe('recents — entrées partielles', () => {
    test('formes d’alignement variées et champs absents', () => {
        const pool = { teams: {
            A: { members: ['a'], offensive: [{ skaterFullName: 'Un Patineur' }, null, ''], goalie: [{ goalieFullName: 'Un Gardien' }], rookie: [{ name: 'Une Recrue' }], defensive: [{ teamFullName: 'Club' }] },
            B: null
        } };
        const index = R.indexerJoueursDuPool(pool, 'A');
        assert.deepEqual([...index.keys()].sort(), ['club', 'un gardien', 'un patineur', 'une recrue']);

        const blesses = R.blessuresDuPool([
            { playerName: 'Un Gardien', status: 'Out', injuryDetail: 'Surgery', returnDate: '2026-12-01', headshot: 'x.png', since: 'pas une date' },
            { playerName: 'Un Patineur' },
            null
        ], index);
        assert.equal(blesses.length, 2);
        assert.equal(blesses[0].photo, 'x.png');
        assert.equal(blesses[0].equipe, 'A');
        assert.equal(blesses[1].statutFr, null);
        assert.equal(blesses[1].club, null);

        const lnh = R.mouvementsDuPool({ transactions: [
            { playerName: 'Une Recrue', date: '2026-11-10', headshot: 'y.png' },
            { playerName: 'Un Gardien', date: '2026-11-10' },
            null
        ] }, index, {});
        assert.equal(lnh.length, 2);
        assert.equal(lnh.find(t => t.joueur === 'Une Recrue').photo, 'y.png');
        assert.equal(lnh[0].genre, null);
        assert.equal(lnh[0].de, null);

        const [m] = R.matchsDeMaSoiree([{
            id: 1, gameState: 'LIVE', periodDescriptor: {}, clock: {},
            awayTeam: { abbrev: 'tor' }, homeTeam: {}
        }], { mesJoueurs: [{ nom: 'Un Gardien', playerId: 9, club: 'TOR' }, { nom: 'Sans', playerId: 8 }], mesClubs: [null, 'xx'] });
        assert.equal(m.visiteur.score, null);
        assert.equal(m.local.abbrev, '');
        assert.equal(m.periode, null);
        assert.equal(m.horloge, null);
        assert.equal(m.debut, null);
        assert.equal(m.points, 0);

        const pool2 = R.activiteUtile([{ type: 'listing_activated', occurredAt: 't' }, { type: 'trade_completed', sujet: {} }]);
        assert.equal(pool2.length, 2);
        assert.equal(pool2[0].texte, '');
        assert.equal(R.cleNom(null), '');
    });
});
