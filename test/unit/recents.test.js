'use strict';

/**
 * Récents (lib/recents.js) : seul ce qui touche le pool entre dans le fil.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../../lib/recents.js');
const dates = require('../../lib/dates.js');

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

describe('recents — rapports de match', () => {
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
    const nomsClubs = { TOR: 'Toronto Maple Leafs', MTL: 'Montréal Canadiens', EDM: 'Edmonton Oilers', CGY: 'Calgary Flames' };

    test('tous les matchs commencés du jour, le dernier but en tête', () => {
        const buts = { 2: '2026-11-15T03:30:00Z' };
        const liste = R.rapportsDeMatch([
            match(3, 'BOS', 'NYR', 'FUT'),
            match(1, 'TOR', 'MTL', 'LIVE', { periodDescriptor: { number: 2, periodType: 'REG' }, clock: { timeRemaining: '12:01', inIntermission: false },
                goals: [{ name: { default: 'C. Caufield' }, teamAbbrev: 'MTL', period: 2, timeInPeriod: '07:59' }] }),
            match(2, 'EDM', 'CGY', 'LIVE'),
            match(4, 'VAN', 'SEA', 'OFF', { gameDate: '2026-11-13' })
        ], { mesJoueurs, mesClubs: ['MTL', 'NYR'], soirees, aujourdhui: '2026-11-14', nomsClubs, butDe: id => buts[id] || null });
        // Le but de 03 h 30 passe devant la mise au jeu de 01 h ; le match à venir n'est pas une nouvelle.
        assert.deepEqual(liste.map(m => m.id), [2, 1]);
        const [edm, mtl] = liste;
        assert.equal(edm.mien, false);
        assert.equal(edm.moment, '2026-11-15T03:30:00Z');
        assert.deepEqual(edm.visiteur, { abbrev: 'EDM', ville: 'Edmonton', surnom: 'Oilers', score: 2 });
        assert.equal(mtl.mien, true);
        assert.equal(mtl.moment, mtl.debut);
        assert.equal(mtl.visiteur.surnom, 'Maple Leafs');
        assert.equal(mtl.periode, 2);
        assert.equal(mtl.horloge, '12:01');
        assert.deepEqual(mtl.dernierBut, { nom: 'C. Caufield', club: 'MTL', periode: 2, temps: '07:59' });
        assert.equal(mtl.points, 3);
        assert.deepEqual(mtl.joueurs.map(j => j.nom), ['Cole Caufield', 'Ivan Demidov', 'Lane Hutson']);
        assert.deepEqual(mtl.clubs, [{ club: 'MTL', points: 0 }]);
    });

    test('match fini : « FINAL », clubs inconnus de la table', () => {
        const [m] = R.rapportsDeMatch([match(1, 'TOR', 'XXX', 'OFF', { awayTeam: { abbrev: 'TOR', score: 1, commonName: { default: 'Leafs' }, placeName: { default: 'Toronto' } } })], { mesJoueurs, soirees, aujourdhui: '2026-11-14' });
        assert.equal(m.etat, 'FINAL');
        assert.equal(m.visiteur.surnom, 'Leafs');
        assert.equal(m.local.ville, 'XXX');
        assert.equal(m.dernierBut, null);
        assert.equal(R.etatDuMatch({ gameState: 'CRIT' }), 'LIVE');
        assert.equal(R.etatDuMatch(null), 'FUT');
    });

    test('passé minuit : les matchs d’hier restent, celui en cours compte pour aujourd’hui', () => {
        const liste = R.rapportsDeMatch([
            match(1, 'TOR', 'MTL', 'LIVE', { gameDate: '2026-11-14' }),
            match(2, 'EDM', 'CGY', 'OFF', { gameDate: '2026-11-14' }),
            match(3, 'VAN', 'SEA', 'OFF', { gameDate: '2026-11-13' })
        ], { aujourdhui: '2026-11-15', jours: ['2026-11-15', '2026-11-14'] });
        assert.deepEqual(liste.map(m => [m.id, m.jour]).sort(), [[1, '2026-11-15'], [2, '2026-11-14']]);
        // Sans liste de jours, seul aujourd’hui compte.
        assert.deepEqual(R.rapportsDeMatch([match(1, 'TOR', 'MTL', 'LIVE', { gameDate: '2026-11-14' })], { aujourdhui: '2026-11-15' }), []);
    });

    test('ville et surnom', () => {
        assert.deepEqual(R.villeEtSurnom('Vegas Golden Knights'), { ville: 'Vegas', surnom: 'Golden Knights' });
        assert.deepEqual(R.villeEtSurnom('Utah Mammoth', 'Mammoth'), { ville: 'Utah', surnom: 'Mammoth' });
        assert.deepEqual(R.villeEtSurnom('Kraken'), { ville: 'Kraken', surnom: '' });
        assert.deepEqual(R.villeEtSurnom(''), { ville: '', surnom: '' });
    });

    test('entrées incomplètes : liste vide', () => {
        assert.deepEqual(R.rapportsDeMatch([null, { id: 9 }], {}), []);
        assert.deepEqual(R.rapportsDeMatch(null), []);
    });
});

describe('recents — l’heure des buts', () => {
    const partie = (a, h, id = 1) => ({ id, awayTeam: { score: a }, homeTeam: { score: h } });

    test('un pointage qui change entre deux lectures rapprochées date le but', () => {
        let t = 1_000_000;
        const suivi = R.creerSuiviButs({ horloge: () => t });
        suivi.observer([partie(0, 0)]);
        assert.equal(suivi.butDe(1), null);
        t += 10_000;
        suivi.observer([partie(0, 0)]);
        assert.equal(suivi.butDe(1), null);
        t += 5_000;
        suivi.observer([partie(1, 0)]);
        assert.equal(suivi.butDe(1), new Date(t).toISOString());
        // Le pointage ne bouge plus : le but garde son heure.
        const heureDuBut = suivi.butDe(1);
        t += 30_000;
        suivi.observer([partie(1, 0)]);
        assert.equal(suivi.butDe(1), heureDuBut);
    });

    test('après un long trou de lecture, on ne sait pas quand : pas d’heure inventée', () => {
        let t = 0;
        const suivi = R.creerSuiviButs({ horloge: () => t, ecartMaxMs: 60_000 });
        suivi.observer([partie(1, 0)]);
        t += 10 * 60_000;
        suivi.observer([partie(2, 0)]);
        assert.equal(suivi.butDe(1), null);
    });

    test('borné en taille, entrées incomplètes ignorées', () => {
        const suivi = R.creerSuiviButs({ max: 2 });
        suivi.observer([partie(0, 0, 1), partie(0, 0, 2), partie(0, 0, 3), null, { id: 4 }, { awayTeam: {}, homeTeam: {} }]);
        suivi.observer(null);
        assert.equal(suivi.butDe(1), null);
        assert.equal(suivi.butDe('inconnu'), null);
        const defaut = R.creerSuiviButs();
        defaut.observer([{ id: 5, awayTeam: {}, homeTeam: {} }]);
        assert.equal(defaut.butDe(5), null);
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

    function monter({ activite = [{ id: 1 }], echec = null, usePostgres = true, horloge, jours = [] } = {}) {
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
            matchsDuJour: async jour => (jours.push(jour), jour !== dates.journeeLocale(new Date(Date.now() - 90 * 60000)) ? [] : [{ id: 5, gameState: 'LIVE', awayTeam: { abbrev: 'TOR', score: 1 }, homeTeam: { abbrev: 'MTL', score: 2 } }]),
            butDe: id => (id === 5 ? '2026-11-15T01:00:00.000Z' : null),
            ficheReleve: nom => (nom === 'Cole Caufield' ? { playerId: 1, teamAbbrev: 'MTL' } : null),
            ...(horloge ? { horloge } : {}),
            logger: { error() {}, warn() {} }
        });
        const appeler = async (pool = 'P', username = 'andy', isAdmin = false) => {
            let corps = null, statut = 200;
            const res = { set() {}, status(c) { statut = c; return this; }, json(b) { corps = b; return this; } };
            await routes.get('/api/pools/:poolName/recents')({ params: { poolName: pool }, auth: { username, isAdmin } }, res);
            return { statut, corps };
        };
        return { appeler, lectures, jours };
    }

    test('la journée finit à 1 h 30 ; le matin, les matchs d’hier restent', async () => {
        // 00 h 23 à Montréal : c’est encore samedi soir.
        const nuit = monter({ horloge: () => new Date('2026-11-15T05:23:00Z') });
        assert.equal((await nuit.appeler()).corps.aujourdhui, '2026-11-14');
        assert.deepEqual(nuit.jours, ['2026-11-14']);
        // 9 h : dimanche, et les matchs de samedi restent jusqu’à midi.
        const matin = monter({ horloge: () => new Date('2026-11-15T14:00:00Z') });
        assert.equal((await matin.appeler()).corps.aujourdhui, '2026-11-15');
        assert.deepEqual(matin.jours.sort(), ['2026-11-14', '2026-11-15']);
        // 14 h : seulement dimanche.
        const apresMidi = monter({ horloge: () => new Date('2026-11-15T19:00:00Z') });
        await apresMidi.appeler();
        assert.deepEqual(apresMidi.jours, ['2026-11-15']);
    });

    test('assemble ma soirée, les blessés du pool et l’activité', async () => {
        const { appeler } = monter();
        const { statut, corps } = await appeler();
        assert.equal(statut, 200);
        assert.equal(corps.monEquipe, 'Les Loups');
        assert.equal(corps.matchs.length, 1);
        assert.equal(corps.matchs[0].points, 2);
        assert.equal(corps.matchs[0].moment, '2026-11-15T01:00:00.000Z');
        assert.equal(corps.matchs[0].local.ville, 'Montréal');
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
        assert.equal(corps.matchs.length, 1);
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
        assert.equal(admin.corps.matchs[0].mien, false);
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

        const [m] = R.rapportsDeMatch([{
            id: 1, gameState: 'LIVE', periodDescriptor: {}, clock: {},
            awayTeam: { abbrev: 'tor' }, homeTeam: {},
            goals: [{ firstName: { default: 'Un' }, lastName: { default: 'Gardien' }, periodDescriptor: { number: 3 } }]
        }, { gameState: 'LIVE', awayTeam: {}, homeTeam: {}, goals: [{}] }], { mesJoueurs: [{ nom: 'Un Gardien', playerId: 9, club: 'TOR' }, { nom: 'Sans', playerId: 8 }], mesClubs: [null, 'xx'] });
        assert.equal(m.visiteur.score, null);
        assert.equal(m.local.abbrev, '');
        assert.equal(m.periode, null);
        assert.equal(m.horloge, null);
        assert.equal(m.debut, null);
        assert.equal(m.points, 0);
        assert.deepEqual(m.dernierBut, { nom: 'Un Gardien', club: null, periode: 3, temps: null });

        const pool2 = R.activiteUtile([{ type: 'listing_activated', occurredAt: 't' }, { type: 'trade_completed', sujet: {} }]);
        assert.equal(pool2.length, 2);
        assert.equal(pool2[0].texte, '');
        assert.equal(R.cleNom(null), '');
    });
});
