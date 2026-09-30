'use strict';

/**
 * Alertes sur l'appareil (services/push.js, routes/push.js) : « C'est à votre
 * tour » doit partir vers les navigateurs abonnés de l'équipe qui prend la
 * main — une fois par tour, jamais pour un réessai ni pour un refus — et se
 * lire à l'arrivée.
 *
 * Aucun réseau : les services de push sont remplacés par une fonction qui
 * retient les envois, et chaque navigateur par sa paire de clés
 * (test/fixtures/navigateurPush.js).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const webPush = require('../../lib/webPush.js');
const evenements = require('../../lib/events.js');
const { creerServicePush, messageDe } = require('../../services/push.js');
const routesPush = require('../../routes/push.js');
const routesPools = require('../../routes/pools.js');
const routesRepechage = require('../../routes/draft.js');
const { monterRoutes, poolNeuf } = require('../fixtures/routeHarness.js');
const { navigateur, lire, verifierVapid } = require('../fixtures/navigateurPush.js');

const ALICE = { username: 'alice', userId: 'alice', isAdmin: false };
const BOB = { username: 'bob', userId: 'bob', isAdmin: false };

const CLES = webPush.clesDepuisEnvironnement({ VAPID_PRIVATE_KEY: 'secret de test' });
const silencieux = { log() {}, warn() {}, error() {} };

/** La table des abonnements, en mémoire. */
function baseAbonnements() {
    const lignes = [];
    return {
        lignes,
        lectures: 0,
        async upsertPushSubscription({ userId, endpoint, p256dh, auth, userAgent }) {
            const i = lignes.findIndex(l => l.endpoint === endpoint);
            const ligne = { userId, endpoint, p256dh, auth, userAgent };
            if (i >= 0) lignes[i] = ligne; else lignes.push(ligne);
        },
        async deletePushSubscription(userId, endpoint) {
            const i = lignes.findIndex(l => l.endpoint === endpoint && l.userId === userId);
            if (i < 0) return 0;
            lignes.splice(i, 1);
            return 1;
        },
        async deletePushSubscriptionByEndpoint(endpoint) {
            const i = lignes.findIndex(l => l.endpoint === endpoint);
            if (i >= 0) lignes.splice(i, 1);
            return i >= 0 ? 1 : 0;
        },
        async getPushSubscriptionsForUsers(ids) {
            this.lectures++;
            return lignes.filter(l => ids.includes(l.userId))
                .map(({ userId, endpoint, p256dh, auth }) => ({ userId, endpoint, p256dh, auth }));
        }
    };
}

/**
 * Le service, branché sur une base en mémoire et un faux réseau.
 * `reponses` : statut à renvoyer par adresse (201 par défaut).
 */
function banc({ cles = CLES, reponses = {} } = {}) {
    const db = baseAbonnements();
    const envois = [];
    const journal = [];
    const service = creerServicePush({
        db,
        cles,
        logger: { log() {}, warn: (...m) => journal.push(m.join(' ')), error: (...m) => journal.push(m.join(' ')) },
        horloge: () => 1_800_000_000_000,
        envoyer: async (url, options) => {
            envois.push({ url, options });
            const reponse = reponses[url];
            if (reponse instanceof Error) throw reponse;
            const statut = reponse || 201;
            return { status: statut, ok: statut >= 200 && statut < 300, text: async () => 'détail' };
        }
    });
    function abonner(userId, appareil) {
        db.lignes.push({ userId, ...appareil.abonnement });
        return appareil;
    }
    return { db, envois, journal, service, abonner };
}

const tour = (options = {}) => ({
    type: evenements.NOTIFICATION.VOTRE_TOUR,
    poolId: 7,
    recipientUserId: options.pour || 'alice',
    subject: { poolName: 'Ligue des Rois', teamName: 'Équipe 1', pickIndex: options.pickIndex ?? 3, ...(options.subject || {}) },
    expiresAt: new Date(Date.now() + evenements.EXPIRATION_TOUR_MS),
    dedupKey: evenements.clesNotification.votreTour(7, options.pickIndex ?? 3)
});

// ───────────────────────────── Le message ─────────────────────────────

test('le message dit la même chose que la cloche, avec le pool, et mène à la salle', () => {
    const message = messageDe(tour());
    const cloche = evenements.presenter(tour());

    assert.equal(message.charge.titre, cloche.titre);
    assert.equal(message.charge.corps, `Ligue des Rois · ${cloche.detail}`, 'une alerte arrive seule : le pool est dans le texte');
    assert.equal(message.charge.url, 'draftActif.html?pool=Ligue+des+Rois');
    assert.equal(message.charge.url, evenements.urlDestination({ ...tour(), poolName: 'Ligue des Rois' }), 'la destination de la cloche');
    assert.equal(message.charge.tag, 'fz-tour:Ligue des Rois', 'le tour suivant remplace le précédent');
    assert.equal(message.charge.urgent, true);
    assert.equal(message.urgence, 'high', 'réveille un téléphone en économie d’énergie');
});

test('une alerte de tour ne survit pas à son tour', () => {
    assert.equal(messageDe(tour({ subject: { limiteMs: 180000 } })).ttl, 180,
        'chronométré : au-delà, Fantazy a choisi — l’alerte serait fausse');
    assert.equal(messageDe(tour()).ttl, evenements.EXPIRATION_TOUR_MS / 1000, 'sinon, la durée de l’alerte dans la cloche');
    assert.match(messageDe(tour({ subject: { limiteMs: 180000 } })).charge.corps, /3 minutes/);
});

test('seul le tour de repêchage part sur l’appareil', () => {
    for (const type of Object.values(evenements.NOTIFICATION)) {
        if (type === evenements.NOTIFICATION.VOTRE_TOUR) continue;
        assert.equal(messageDe({ ...tour(), type }), null, type);
    }
});

// ───────────────────────────── L'envoi ─────────────────────────────

test('chaque navigateur abonné de l’équipe reçoit une alerte qu’il est seul à pouvoir lire', async () => {
    const h = banc();
    const telephone = h.abonner('alice', navigateur());
    const ordinateur = h.abonner('alice', navigateur({ endpoint: 'https://web.push.apple.com/QGuQyavXutnMH2Ro5nU' }));
    const coequipier = h.abonner('carl', navigateur());
    h.abonner('bob', navigateur());

    await h.service.apresCommit({ notifications: [tour({ pour: 'alice' }), tour({ pour: 'carl' })] });

    assert.equal(h.db.lectures, 1, 'une lecture des abonnements par fait, pas une par membre');
    assert.deepEqual(h.envois.map(e => e.url).sort(),
        [telephone, ordinateur, coequipier].map(a => a.abonnement.endpoint).sort(), 'pas Bob : ce n’est pas son tour');

    for (const [appareil, envoi] of [[telephone, h.envois.find(e => e.url === telephone.abonnement.endpoint)],
                                     [ordinateur, h.envois.find(e => e.url === ordinateur.abonnement.endpoint)]]) {
        assert.equal(lire(appareil, envoi).titre, "C'est à votre tour de choisir");
        const vapid = verifierVapid(envoi.options.headers.Authorization);
        assert.equal(vapid.valide, true);
        assert.equal(vapid.cle, CLES.clePublique);
        assert.equal(vapid.charge.aud, new URL(envoi.url).origin);
        assert.equal(envoi.options.headers.Urgency, 'high');
        assert.equal(envoi.options.headers.Topic, webPush.sujetCourt('tour:7'));
    }
});

test('un abonnement disparu (404, 410) est oublié ; un autre refus ne l’est pas', async () => {
    const parti = navigateur();
    const refuse = navigateur();
    const coupe = navigateur();
    const h = banc({ reponses: {
        [parti.abonnement.endpoint]: 410,
        [refuse.abonnement.endpoint]: 403,
        [coupe.abonnement.endpoint]: new Error('ECONNRESET')
    } });
    for (const appareil of [parti, refuse, coupe]) h.abonner('alice', appareil);

    const [bilan] = await h.service.apresCommit({ notifications: [tour()] });

    assert.deepEqual(bilan, { envoyes: 0, expires: 1, echecs: 2 });
    assert.deepEqual(h.db.lignes.map(l => l.endpoint).sort(),
        [refuse.abonnement.endpoint, coupe.abonnement.endpoint].sort(),
        'une clé qui ne correspond plus se répare au retour du navigateur, pas en effaçant');
    assert.ok(h.journal.some(ligne => /403/.test(ligne)), 'le refus se voit dans les journaux');
});

test('sans clé, rien ne part et rien ne casse', async () => {
    const h = banc({ cles: null });
    h.abonner('alice', navigateur());
    assert.equal(h.service.disponible, false);
    assert.equal(h.service.clePublique, null);
    assert.deepEqual(await h.service.apresCommit({ notifications: [tour()] }), []);
    assert.equal(h.envois.length, 0);
});

test('une panne de la base pendant l’envoi ne remonte pas jusqu’à l’opération', async () => {
    const h = banc();
    h.db.getPushSubscriptionsForUsers = async () => { throw new Error('connexion perdue'); };
    assert.deepEqual(await h.service.apresCommit({ notifications: [tour()] }), []);
    assert.ok(h.journal.some(ligne => /connexion perdue/.test(ligne)));
});

// ───────────────────────────── Les routes ─────────────────────────────

function routes({ push, usePostgres = true } = {}) {
    return monterRoutes(routesPush, { ctxExtra: { push, usePostgres, horloge: () => maintenant } });
}
let maintenant = 1_800_000_000_000;

test('la configuration donne la clé publique, ou dit honnêtement que les alertes sont indisponibles', async () => {
    const h = banc();
    const disponible = await routes({ push: h.service }).appeler('GET', '/api/push/config', { auth: ALICE });
    assert.deepEqual(disponible.body, { disponible: true, clePublique: CLES.clePublique });

    const sansCle = await routes({ push: banc({ cles: null }).service }).appeler('GET', '/api/push/config', { auth: ALICE });
    assert.deepEqual(sansCle.body, { disponible: false });

    const modeFichier = await routes({ push: h.service, usePostgres: false }).appeler('GET', '/api/push/config', { auth: ALICE });
    assert.deepEqual(modeFichier.body, { disponible: false }, 'les abonnements vivent dans PostgreSQL');

    assert.equal((await routes({ push: h.service }).appeler('GET', '/api/push/config')).statusCode, 401);
});

test('s’abonner rattache CE navigateur au compte connecté, et rien d’autre', async () => {
    const h = banc();
    const r = routes({ push: h.service });
    const appareil = navigateur();
    const corps = { subscription: { endpoint: appareil.abonnement.endpoint, keys: { p256dh: appareil.abonnement.p256dh, auth: appareil.abonnement.auth } } };

    const res = await r.appeler('POST', '/api/push/subscribe', { auth: ALICE, body: corps, headers: { 'user-agent': 'Safari iPhone' } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(h.db.lignes, [{ userId: 'alice', ...appareil.abonnement, userAgent: 'Safari iPhone' }]);

    // Même navigateur, autre compte : l'abonnement change de mains, il ne se dédouble pas.
    await r.appeler('POST', '/api/push/subscribe', { auth: BOB, body: corps });
    assert.deepEqual(h.db.lignes.map(l => l.userId), ['bob']);

    assert.equal((await r.appeler('POST', '/api/push/subscribe', { body: corps })).statusCode, 401);
});

test('une adresse hors des services de push connus est refusée', async () => {
    const h = banc();
    const r = routes({ push: h.service });
    const appareil = navigateur();
    for (const endpoint of ['https://10.0.0.5/admin', 'http://fcm.googleapis.com/fcm/send/a', 'https://evil.example/push']) {
        const res = await r.appeler('POST', '/api/push/subscribe', {
            auth: ALICE,
            body: { subscription: { endpoint, keys: { p256dh: appareil.abonnement.p256dh, auth: appareil.abonnement.auth } } }
        });
        assert.equal(res.statusCode, 400, endpoint);
    }
    assert.equal((await r.appeler('POST', '/api/push/subscribe', { auth: ALICE, body: {} })).statusCode, 400);
    assert.equal(h.db.lignes.length, 0);
});

test('se désabonner ne retire que son propre navigateur', async () => {
    const h = banc();
    const r = routes({ push: h.service });
    const deBob = h.abonner('bob', navigateur());

    const tentative = await r.appeler('POST', '/api/push/unsubscribe', { auth: ALICE, body: { endpoint: deBob.abonnement.endpoint } });
    assert.equal(tentative.body.retire, 0);
    assert.equal(h.db.lignes.length, 1, 'l’adresse de Bob ne suffit pas à couper ses alertes');

    const lui = await r.appeler('POST', '/api/push/unsubscribe', { auth: BOB, body: { endpoint: deBob.abonnement.endpoint } });
    assert.equal(lui.body.retire, 1);
    assert.equal(h.db.lignes.length, 0);
});

test('l’essai part vers ses propres appareils, et pas en rafale', async () => {
    const h = banc();
    const r = routes({ push: h.service });

    maintenant += 60_000;
    const rien = await r.appeler('POST', '/api/push/test', { auth: ALICE });
    assert.equal(rien.statusCode, 404, 'aucun appareil abonné : on le dit');

    const appareil = h.abonner('alice', navigateur());
    h.abonner('bob', navigateur());
    maintenant += 60_000;
    const essai = await r.appeler('POST', '/api/push/test', { auth: ALICE });
    assert.equal(essai.statusCode, 200);
    assert.equal(essai.body.envoyes, 1);
    assert.equal(h.envois.length, 1, 'pas les appareils de Bob');
    assert.equal(lire(appareil, h.envois[0]).titre, 'Les alertes fonctionnent');

    maintenant += 2_000;
    assert.equal((await r.appeler('POST', '/api/push/test', { auth: ALICE })).statusCode, 429);
});

// ───────────────────── Du repêchage jusqu'à l'appareil ─────────────────────

/**
 * Le vrai repêchage, le vrai magasin, le vrai service d'alertes : seuls la
 * base et le réseau sont simulés. Trois équipes, deux choix chacune : l'ordre
 * est en serpentin (1, 2, 3, 3, 2, 1), donc l'équipe 3 choisit deux fois de
 * suite au renversement.
 */
function repechage() {
    const h = banc();
    const attente = [];
    const routes = monterRoutes([routesPools, routesRepechage], {
        pools: { Ligue: poolNeuf({
            nbEquipes: 3,
            membres: { 'Équipe 1': ['alice'], 'Équipe 2': ['bob'], 'Équipe 3': ['carl'] },
            config: { numOffensive: 1, numDefensive: 1, numGoalies: 0, numRookies: 0, numTeams: 0 }
        }) },
        apresCommit: (suite) => { const p = h.service.apresCommit(suite); attente.push(p); return p; }
    });
    const appareils = {
        alice: h.abonner('alice', navigateur()),
        bob: h.abonner('bob', navigateur()),
        carl: h.abonner('carl', navigateur())
    };
    /** Ce que chaque appareil a reçu depuis le dernier appel. */
    async function recus() {
        await new Promise(resolve => setImmediate(resolve));
        await Promise.all(attente.splice(0));
        const envois = h.envois.splice(0);
        const vue = { total: envois.length };
        for (const [nom, appareil] of Object.entries(appareils)) {
            vue[nom] = envois.filter(e => e.url === appareil.abonnement.endpoint).map(e => lire(appareil, e));
        }
        return vue;
    }
    return { ...routes, recus };
}

const COMPTES = { alice: ALICE, bob: BOB, carl: { username: 'carl', userId: 'carl', isAdmin: false } };

/** Joue le choix numéro `indice` pour l'équipe dont c'est le tour. */
async function jouer(r, indice, extra = {}) {
    const pool = r.lirePool('Ligue');
    const qui = pool.teams[pool.draftOrder[indice]].members[0];
    return r.appeler('POST', '/pick-player', {
        auth: COMPTES[qui],
        body: {
            clanName: 'Ligue',
            playerName: `Joueur ${indice}`,
            position: indice < 3 ? 'offensive' : 'defensive',
            expectedPickIndex: indice,
            ...extra
        }
    });
}

test('le départ du repêchage alerte l’équipe qui ouvre le bal, et elle seule', async () => {
    const r = repechage();
    const res = await r.appeler('POST', '/start-draft', { auth: ALICE, body: { clanName: 'Ligue' } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(r.lirePool('Ligue').draftOrder, ['Équipe 1', 'Équipe 2', 'Équipe 3', 'Équipe 3', 'Équipe 2', 'Équipe 1']);

    const recus = await r.recus();
    assert.equal(recus.total, 1, '« Repêchage commencé » reste dans la cloche');
    assert.equal(recus.alice[0].titre, "C'est à votre tour de choisir");
    assert.equal(recus.alice[0].url, 'draftActif.html?pool=Ligue');

    const cloche = r.etat.notifications.filter(n => n.type === evenements.NOTIFICATION.VOTRE_TOUR);
    assert.deepEqual(cloche.map(n => [n.recipientUserId, n.subject.pickIndex]), [['alice', 0]],
        'la cloche et l’appareil annoncent le même tour');
});

test('chaque choix alerte l’équipe suivante — une fois, même au renversement du serpentin', async () => {
    const r = repechage();
    await r.appeler('POST', '/start-draft', { auth: ALICE, body: { clanName: 'Ligue' } });
    await r.recus();

    assert.equal((await jouer(r, 0, { operationId: 'op-alice-0' })).statusCode, 200);
    let recus = await r.recus();
    assert.equal(recus.total, 1);
    assert.equal(recus.bob.length, 1, 'Bob prend la main');
    assert.match(recus.bob[0].corps, /^Ligue · /);

    // Réseau incertain : le même choix est renvoyé. Il ne sonne pas deux fois.
    const rejoue = await jouer(r, 0, { operationId: 'op-alice-0' });
    assert.equal(rejoue.body.rejouee, true);
    assert.equal((await r.recus()).total, 0);

    // Un choix refusé (pas son tour) ne sonne pas non plus.
    const horsTour = await r.appeler('POST', '/pick-player', {
        auth: ALICE, body: { clanName: 'Ligue', playerName: 'Joueur X', position: 'defensive', expectedPickIndex: 1 }
    });
    assert.equal(horsTour.statusCode, 403);
    assert.equal((await r.recus()).total, 0);

    assert.equal((await jouer(r, 1)).statusCode, 200);
    recus = await r.recus();
    assert.equal(recus.carl.length, 1);

    // Renversement : Carl choisit, et c'est encore lui. Un nouveau tour, une nouvelle alerte.
    assert.equal((await jouer(r, 2)).statusCode, 200);
    recus = await r.recus();
    assert.equal(recus.total, 1);
    assert.equal(recus.carl.length, 1);
    assert.equal(recus.carl[0].tag, 'fz-tour:Ligue', 'elle remplace l’alerte du tour précédent sur l’appareil');
});

test('le dernier choix n’alerte personne', async () => {
    const r = repechage();
    await r.appeler('POST', '/start-draft', { auth: ALICE, body: { clanName: 'Ligue' } });
    await r.recus();
    for (let indice = 0; indice < 6; indice++) {
        const res = await jouer(r, indice);
        assert.equal(res.statusCode, 200, JSON.stringify(res.body));
        assert.equal((await r.recus()).total, indice < 5 ? 1 : 0, `choix ${indice}`);
    }
});

test('le magasin ne transmet que les notifications que la transaction a créées', async () => {
    const transmises = [];
    const r = monterRoutes([], {
        pools: { Ligue: poolNeuf({ membres: { 'Équipe 1': ['alice'] } }) },
        apresCommit: ({ notifications }) => { transmises.push(notifications); }
    });
    const ecrire = () => r.store.muterPool('Ligue', {
        appliquer: async ({ journal, poolId }) => {
            journal.notifier({ ...tour(), recipientUserId: undefined, recipient: 'alice', poolId });
            return { sauvegarder: false };
        }
    });

    await ecrire();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(transmises.length, 1);
    assert.equal(transmises[0][0].recipientUserId, 'alice', 'le destinataire arrive résolu');

    // La même clé, écrite une deuxième fois : la ligne existe, rien de neuf ne sonne.
    await ecrire();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(transmises.length, 1);

    // Une transaction annulée ne transmet rien.
    await assert.rejects(r.store.muterPool('Ligue', {
        appliquer: async ({ journal, poolId }) => {
            journal.notifier({ ...tour({ pickIndex: 9 }), recipientUserId: undefined, recipient: 'alice', poolId });
            throw new Error('refus');
        }
    }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(transmises.length, 1);
});
