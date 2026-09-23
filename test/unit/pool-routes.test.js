'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const routesPools = require('../../routes/pools.js');
const routesRepechage = require('../../routes/draft.js');
const { monterRoutes, poolNeuf, poolTermine } = require('../fixtures/routeHarness.js');

const ALICE = { username: 'alice', userId: 'alice', isAdmin: false };
const BOB = { username: 'bob', userId: 'bob', isAdmin: false };
const CARL = { username: 'carl', userId: 'carl', isAdmin: false };
const ADMIN = { username: 'admin', userId: 'admin', isAdmin: true };

function banc(pools) {
    return monterRoutes([routesPools, routesRepechage], { pools });
}

// ───────────────────────────── Portée de /draft ─────────────────────────────

test('/draft donne le détail aux membres et un résumé aux autres', async () => {
    const h = banc({ Ligue: poolTermine() });

    const membre = await h.appeler('GET', '/draft', { auth: ALICE });
    assert.equal(membre.body.Ligue.isMember, true);
    assert.ok(membre.body.Ligue.teams);

    const etranger = await h.appeler('GET', '/draft', { auth: CARL });
    assert.equal(etranger.body.Ligue.isMember, false);
    assert.equal(etranger.body.Ligue.teams, undefined);

    const anonyme = await h.appeler('GET', '/draft', { auth: null });
    assert.equal(anonyme.statusCode, 200, 'la découverte reste ouverte');
    assert.equal(anonyme.body.Ligue.teams, undefined);
    assert.ok(!JSON.stringify(anonyme.body).includes('passwordHash'));
});

test("l'ordre de sélection n'est visible que des membres", async () => {
    const h = banc({ Ligue: poolTermine() });
    assert.equal((await h.appeler('GET', '/draft-order/Ligue', { auth: ALICE })).statusCode, 200);
    assert.equal((await h.appeler('GET', '/draft-order/Ligue', { auth: CARL })).statusCode, 403);
    assert.equal((await h.appeler('GET', '/draft-order/Ligue', { auth: null })).statusCode, 401);
});

// ───────────────────────────── Création et suppression ─────────────────────

test('créer un pool inscrit son auteur et refuse un nom déjà pris, accents compris', async () => {
    const h = banc({});
    const res = await h.appeler('POST', '/create-clan', {
        auth: ALICE, body: { name: 'Les Élans', maxPlayers: 4, teamName: 'Les Fusées' }
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(h.lirePool('Les Élans').teams), ['Les Fusées'],
        'une seule équipe à la naissance : celle de la personne qui crée');
    assert.deepEqual(h.lirePool('Les Élans').teams['Les Fusées'].members, ['alice']);
    assert.equal(h.lirePool('Les Élans').creator, 'alice');

    const double = await h.appeler('POST', '/create-clan', { auth: BOB, body: { name: 'les elans', maxPlayers: 4 } });
    assert.equal(double.statusCode, 409, 'deux pools que seul un accent distingue seraient intéléphonables');
});

test('un nom de pool invalide ou grossier est refusé avant toute écriture', async () => {
    const h = banc({});
    for (const nom of ['ab', 'x'.repeat(31), 'nom<script>']) {
        const res = await h.appeler('POST', '/create-clan', { auth: ALICE, body: { name: nom } });
        assert.equal(res.statusCode, 400, `« ${nom} » aurait dû être refusé`);
    }
    assert.equal(h.etat.pools.size, 0);
});

test('seul le créateur supprime son pool, et les lignes rattachées partent avec', async () => {
    const h = banc({ Ligue: poolTermine() });
    h.etat.trades.push({ id: 1, poolName: 'Ligue', status: 'completed', createdAt: new Date(), data: {} });

    assert.equal((await h.appeler('POST', '/delete-clan', { auth: BOB, body: { clanName: 'Ligue' } })).statusCode, 403);
    assert.equal(h.etat.pools.size, 1);

    const res = await h.appeler('POST', '/delete-clan', { auth: ALICE, body: { clanName: 'Ligue' } });
    assert.equal(res.statusCode, 200);
    assert.equal(h.etat.pools.size, 0);
    assert.equal(h.etat.trades.length, 0,
        'un pool recréé sous le même nom hériterait sinon des échanges du précédent');
});

test("l'administration peut dépanner un pool dont le créateur a disparu", async () => {
    const h = banc({ Ligue: poolTermine() });
    assert.equal((await h.appeler('POST', '/delete-clan', { auth: ADMIN, body: { clanName: 'Ligue' } })).statusCode, 200);
});

// ───────────────────────────── Appartenance ─────────────────────────────

test('rejoindre une équipe fait avancer la révision du pool', async () => {
    const h = banc({ Ligue: poolNeuf() });
    const avant = h.revisionDe('Ligue');

    const res = await h.appeler('POST', '/join-team', { auth: BOB, body: { name: 'Ligue', teamName: 'Équipe 2' } });
    assert.equal(res.statusCode, 200);
    assert.equal(h.revisionDe('Ligue'), avant + 1);
    assert.equal(res.body.revision, avant + 1);
});

test('rejoindre sans session est refusé', async () => {
    const h = banc({ Ligue: poolNeuf() });
    assert.equal((await h.appeler('POST', '/join-team', {
        body: { name: 'Ligue', teamName: 'Équipe 2' }
    })).statusCode, 401);
});

test('/join-clan place dans la première équipe libre et reste sans effet la deuxième fois', async () => {
    const h = banc({ Ligue: poolNeuf() });

    const premier = await h.appeler('POST', '/join-clan', { auth: BOB, body: { name: 'Ligue' } });
    assert.equal(premier.statusCode, 200);
    assert.equal(premier.body.deja, undefined);
    const revision = h.revisionDe('Ligue');

    const second = await h.appeler('POST', '/join-clan', { auth: BOB, body: { name: 'Ligue' } });
    assert.equal(second.statusCode, 200);
    assert.equal(h.revisionDe('Ligue'), revision, 'un deuxième clic ne doit rien réécrire');
});

test('quitter une équipe y laisse les sélections', async () => {
    const h = banc({ Ligue: poolTermine() });
    const res = await h.appeler('POST', '/leave-team', { auth: ALICE, body: { name: 'Ligue' } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(h.lirePool('Ligue').teams['Équipe 1'].members, []);
    assert.deepEqual(h.lirePool('Ligue').teams['Équipe 1'].offensive, ['Joueur A']);
});

test('on ne renomme pas l équipe de quelqu un d autre', async () => {
    const h = banc({ Ligue: poolNeuf({ membres: { 'Équipe 1': ['alice'], 'Équipe 2': ['bob'] } }) });
    const vol = await h.appeler('POST', '/rename-team', {
        auth: BOB, body: { clanName: 'Ligue', oldTeamName: 'Équipe 1', newTeamName: 'Volée' }
    });
    assert.equal(vol.statusCode, 403);

    const sienne = await h.appeler('POST', '/rename-team', {
        auth: BOB, body: { clanName: 'Ligue', oldTeamName: 'Équipe 2', newTeamName: 'Les Bleus' }
    });
    assert.equal(sienne.statusCode, 200);
    assert.ok(h.lirePool('Ligue').teams['Les Bleus']);
});

// ───────────────────────────── Départ du repêchage ─────────────────────────

test('seul le créateur lance le repêchage, et une seule fois', async () => {
    const h = banc({ Ligue: poolNeuf({ membres: { 'Équipe 1': ['alice'], 'Équipe 2': ['bob'] } }) });

    assert.equal((await h.appeler('POST', '/start-draft', { auth: BOB, body: { clanName: 'Ligue' } })).statusCode, 403);

    const res = await h.appeler('POST', '/start-draft', { auth: ALICE, body: { clanName: 'Ligue' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.draftOrder.length, 4); // 2 équipes × 2 sélections

    const encore = await h.appeler('POST', '/start-draft', { auth: ALICE, body: { clanName: 'Ligue' } });
    assert.equal(encore.statusCode, 409);
});

test('le départ du repêchage prévient chaque participant une seule fois', async () => {
    const h = banc({ Ligue: poolNeuf({ membres: { 'Équipe 1': ['alice'], 'Équipe 2': ['bob'] } }) });
    await h.appeler('POST', '/start-draft', { auth: ALICE, body: { clanName: 'Ligue' } });

    const alertes = h.etat.notifications.filter(n => n.type === 'draft_started');
    assert.equal(alertes.length, 2);
    assert.deepEqual(alertes.map(a => a.recipientUserId).sort(), ['alice', 'bob']);

    const evenements = h.etat.activity.filter(a => a.type === 'draft_started');
    assert.equal(evenements.length, 1);
});

// ───────────────────────────── Choix ─────────────────────────────

async function poolPret() {
    const h = banc({ Ligue: poolNeuf({
        membres: { 'Équipe 1': ['alice'], 'Équipe 2': ['bob'] },
        config: { numOffensive: 1, numDefensive: 1, numGoalies: 0, numRookies: 0, numTeams: 0 }
    }) });
    await h.appeler('POST', '/start-draft', { auth: ALICE, body: { clanName: 'Ligue' } });
    return h;
}

test('un choix hors tour est refusé et ne laisse aucune trace', async () => {
    const h = await poolPret();
    h.etat.activity.length = 0;

    const res = await h.appeler('POST', '/pick-player', {
        auth: BOB, body: { clanName: 'Ligue', playerName: 'Joueur X', position: 'offensive' }
    });
    assert.equal(res.statusCode, 403);
    assert.equal(h.etat.activity.length, 0, 'un refus ne doit pas produire « a choisi »');
    assert.equal(h.lirePool('Ligue').currentPickIndex, 0);
});

test('un choix écrit son événement et prévient la seule équipe suivante', async () => {
    const h = await poolPret();
    h.etat.notifications.length = 0;

    const res = await h.appeler('POST', '/pick-player', {
        auth: ALICE,
        body: { clanName: 'Ligue', playerName: 'Joueur A', position: 'offensive', expectedPickIndex: 0 }
    });
    assert.equal(res.statusCode, 200);

    const choix = h.etat.activity.filter(a => a.type === 'pick');
    assert.equal(choix.length, 1);
    assert.equal(choix[0].subject.pickIndex, 0);

    const tours = h.etat.notifications.filter(n => n.type === 'turn_current');
    assert.equal(tours.length, 1);
    assert.equal(tours[0].recipientUserId, 'bob');
    assert.ok(tours[0].expiresAt, 'une alerte de tour doit cesser de paraître actionnable');
});

test('un réessai du même identifiant ne consomme pas un deuxième tour', async () => {
    const h = await poolPret();
    const corps = {
        clanName: 'Ligue', playerName: 'Joueur A', position: 'offensive',
        operationId: 'op-1', expectedPickIndex: 0
    };

    const premier = await h.appeler('POST', '/pick-player', { auth: ALICE, body: corps });
    assert.equal(premier.statusCode, 200);

    const rejoue = await h.appeler('POST', '/pick-player', { auth: ALICE, body: corps });
    assert.equal(rejoue.statusCode, 200);
    assert.equal(rejoue.body.rejouee, true);

    assert.equal(h.lirePool('Ligue').picksHistory.length, 1);
    assert.equal(h.lirePool('Ligue').currentPickIndex, 1);
    assert.equal(h.etat.activity.filter(a => a.type === 'pick').length, 1);
});

test('un identifiant d opération recyclé pour une autre demande est refusé', async () => {
    const h = await poolPret();
    await h.appeler('POST', '/pick-player', {
        auth: ALICE, body: { clanName: 'Ligue', playerName: 'Joueur A', position: 'offensive', operationId: 'op-1' }
    });

    const res = await h.appeler('POST', '/pick-player', {
        auth: BOB, body: { clanName: 'Ligue', playerName: 'Joueur B', position: 'offensive', operationId: 'op-1' }
    });
    assert.equal(res.statusCode, 409);
});

test('un écran resté sur un tour périmé reçoit un conflit', async () => {
    const h = await poolPret();
    await h.appeler('POST', '/pick-player', {
        auth: ALICE, body: { clanName: 'Ligue', playerName: 'Joueur A', position: 'offensive' }
    });

    const res = await h.appeler('POST', '/pick-player', {
        auth: BOB, body: { clanName: 'Ligue', playerName: 'Joueur B', position: 'offensive', expectedPickIndex: 0 }
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.conflit.tourActuel, 1);
});

test('le dernier choix marque le repêchage terminé', async () => {
    const h = await poolPret();
    const ordre = h.lirePool('Ligue').draftOrder;
    const clients = { 'Équipe 1': ALICE, 'Équipe 2': BOB };

    let dernier;
    for (let i = 0; i < ordre.length; i++) {
        const position = i < 2 ? 'offensive' : 'defensive';
        dernier = await h.appeler('POST', '/pick-player', {
            auth: clients[ordre[i]],
            body: { clanName: 'Ligue', playerName: `Joueur ${i}`, position, expectedPickIndex: i }
        });
        assert.equal(dernier.statusCode, 200, `choix ${i} : ${JSON.stringify(dernier.body)}`);
    }

    assert.equal(dernier.body.draftComplet, true);
    assert.equal(h.etat.activity.filter(a => a.type === 'draft_complete').length, 1);
});

// ───────────────────────────── Saut de tour ─────────────────────────────

test('sauter un tour est réservé au créateur et refusé sur son propre tour', async () => {
    const h = await poolPret();
    const pool = h.lirePool('Ligue');
    pool.turnStartedAt = Date.now() - 10 * 60 * 1000;
    h.etat.pools.get('Ligue').data = pool;

    assert.equal((await h.appeler('POST', '/skip-turn', { auth: BOB, body: { clanName: 'Ligue' } })).statusCode, 403);

    const premier = pool.draftOrder[0];
    const res = await h.appeler('POST', '/skip-turn', { auth: ALICE, body: { clanName: 'Ligue' } });
    if (premier === 'Équipe 1') {
        assert.equal(res.statusCode, 403, 'alice ne saute pas son propre tour');
    } else {
        assert.equal(res.statusCode, 200);
        assert.equal(h.lirePool('Ligue').picksHistory, undefined,
            'un tour sauté ne consomme pas d entrée d historique');
    }
});

// ───────────────────────── Une personne, une équipe ─────────────────────────

test("rejoindre un pool crée l'équipe au nom choisi, validé comme un renommage", async () => {
    const h = banc({ Ligue: poolNeuf({ nbEquipes: 0, membres: { 'Les Fusées': ['alice'] } }) });

    const grossier = await h.appeler('POST', '/join-team', { auth: BOB, body: { name: 'Ligue', teamName: 'x<script>' } });
    assert.equal(grossier.statusCode, 400);

    const res = await h.appeler('POST', '/join-team', { auth: BOB, body: { name: 'Ligue', teamName: 'Les Castors' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.teamName, 'Les Castors');
    assert.deepEqual(h.lirePool('Ligue').teams['Les Castors'].members, ['bob']);

    const doublon = await h.appeler('POST', '/join-team', { auth: CARL, body: { name: 'Ligue', teamName: 'les castors' } });
    assert.equal(doublon.statusCode, 409);
});

test('un pool plein refuse le participant de trop', async () => {
    const h = banc({ Ligue: poolNeuf({ nbEquipes: 0, maxPlayers: 2, membres: { A: ['alice'], B: ['bob'] } }) });
    const res = await h.appeler('POST', '/join-team', { auth: CARL, body: { name: 'Ligue', teamName: 'Carl' } });
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /complet/);
});

test('/pool-teams annonce le plafond et cache les cases jamais servies', async () => {
    const h = banc({ Ligue: poolNeuf({ nbEquipes: 10, maxPlayers: 8 }) });
    const res = await h.appeler('GET', '/pool-teams/Ligue', { auth: BOB });
    assert.equal(res.body.maxPlayers, 8);
    assert.equal(res.body.participantCount, 1);
    assert.deepEqual(res.body.teams.map(t => t.name), ['Équipe 1']);
    assert.equal(res.body.nomSuggere, 'bob');
});

// ───────────────────────────── Nouvelle saison ─────────────────────────────

test('la nouvelle saison est réservée au créateur et suit le classement inversé au repêchage suivant', async () => {
    const fini = poolTermine({
        teams: {
            Premier: { members: ['alice'], offensive: ['Joueur A'], defensive: [], goalie: [], rookie: [], teams: [] },
            Dernier: { members: ['bob'], offensive: ['Joueur B'], defensive: [], goalie: [], rookie: [], teams: [] }
        },
        draftOrder: ['Premier', 'Dernier']
    });
    fini.saisonRepechage = 20242025;
    const h = monterRoutes([routesPools, routesRepechage], {
        pools: { Ligue: fini },
        ctxExtra: {
            fenetreSaison: async () => ({ regularSeasonStartDate: '2999-10-01', regularSeasonEndDate: '2999-04-15' }),
            scoresSaison: async () => [
                { teamName: 'Premier', score: 80, rank: 1 },
                { teamName: 'Dernier', score: 20, rank: 2 }
            ]
        }
    });

    assert.equal((await h.appeler('POST', '/pool/new-season', { auth: BOB, body: { clanName: 'Ligue' } })).statusCode, 403);

    const res = await h.appeler('POST', '/pool/new-season', { auth: ALICE, body: { clanName: 'Ligue' } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const apres = h.lirePool('Ligue');
    assert.deepEqual(apres.draftOrder, []);
    assert.deepEqual(apres.teams.Premier.offensive, []);

    const depart = await h.appeler('POST', '/start-draft', { auth: ALICE, body: { clanName: 'Ligue' } });
    assert.equal(depart.statusCode, 200);
    assert.equal(h.lirePool('Ligue').draftOrder[0], 'Dernier', 'le dernier choisit en premier');
});

test("jouer son tour éteint son « C'est votre tour » dans la cloche", async () => {
    const h = await poolPret();
    const premier = await h.appeler('POST', '/pick-player', {
        auth: ALICE, body: { clanName: 'Ligue', playerName: 'Joueur A', position: 'offensive', expectedPickIndex: 0 }
    });
    assert.equal(premier.statusCode, 200);
    const tourBob = h.etat.notifications.find(n => n.type === 'turn_current' && n.recipientUserId === 'bob');
    assert.ok(tourBob && !tourBob.resolvedAt, 'le tour de Bob vient de commencer');

    const second = await h.appeler('POST', '/pick-player', {
        auth: BOB, body: { clanName: 'Ligue', playerName: 'Joueur B', position: 'offensive', expectedPickIndex: 1 }
    });
    assert.equal(second.statusCode, 200);
    assert.ok(tourBob.resolvedAt, 'une fois joué, le tour quitte la liste des choses à faire');
    assert.ok(tourBob.readAt, 'et ne compte plus dans la pastille');
});

// ───────────────────────────── Banc (route) ─────────────────────────────

test('on ne gère que son propre banc, et le changement est daté du lendemain', async () => {
    const routesH2H = require('../../routes/h2h.js');
    const fini = {
        poolMode: 'head-to-head', creator: 'alice', maxPlayers: 2,
        config: { numOffensive: 1, numDefensive: 0, numGoalies: 0, numRookies: 0, numTeams: 0, numBench: 1 },
        draftOrder: ['A', 'B', 'B', 'A'], currentPickIndex: 3, lastPickIndex: 3,
        h2hData: { currentWeek: 1, matchups: [], standings: {}, matchupHistory: [] },
        createdAt: '2026-09-01T00:00:00.000Z',
        teams: {
            A: { members: ['alice'], offensive: ['J1'], defensive: [], goalie: [], rookie: [], teams: [], bench: [{ nom: 'J4', categorie: 'offensive' }] },
            B: { members: ['bob'], offensive: ['J2'], defensive: [], goalie: [], rookie: [], teams: [], bench: [{ nom: 'J3', categorie: 'offensive' }] }
        }
    };
    const h = monterRoutes([routesH2H], { pools: { Duels: fini } });

    const volee = await h.appeler('POST', '/h2h/lineup/swap', { auth: ALICE, body: { poolName: 'Duels', entre: 'J3', sort: 'J2' } });
    assert.equal(volee.statusCode, 404, "le banc de Bob n'est pas celui d'Alice");

    const res = await h.appeler('POST', '/h2h/lineup/swap', { auth: ALICE, body: { poolName: 'Duels', entre: 'J4', sort: 'J1' } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const apres = h.lirePool('Duels').teams.A;
    assert.deepEqual(apres.offensive, ['J4']);
    assert.equal(apres.lineupChanges.length, 1);
    const demain = require('../../lib/dates.js').ajouterJours(require('../../lib/dates.js').journeeLocale(), 1);
    assert.equal(apres.lineupChanges[0].date, demain);
});
