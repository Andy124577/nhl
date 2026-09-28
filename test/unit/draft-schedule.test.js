'use strict';

/**
 * Repêcher quand on le décide, ou à une date fixée d'avance.
 *
 * Les règles (lib/poolOps.js), les alertes (lib/events.js), puis les routes :
 * la date donnée à la création, la route qui la change, et le départ que le
 * serveur déclenche lui-même à l'heure dite.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const poolOps = require('../../lib/poolOps.js');
const evenements = require('../../lib/events.js');
const authz = require('../../lib/authz.js');
const routesPools = require('../../routes/pools.js');
const { monterRoutes, poolNeuf } = require('../fixtures/routeHarness.js');

const ALICE = { username: 'alice', userId: 'alice', isAdmin: false };
const BOB = { username: 'bob', userId: 'bob', isAdmin: false };

const MAINTENANT = Date.parse('2026-09-27T12:00:00.000Z');
const HEURE = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const deuxEquipes = (options = {}) => poolNeuf({ membres: { 'Équipe 1': ['alice'], 'Équipe 2': ['bob'] }, ...options });

// ───────────────────────────── Lire une date ─────────────────────────────

test('sans date, le repêchage partira quand on le lancera', () => {
    for (const vide of [undefined, null, '']) {
        assert.deepEqual(poolOps.lireDateRepechage(vide, { maintenant: MAINTENANT }), { ok: true, date: null });
    }
});

test('une date illisible est refusée', () => {
    for (const valeur of ['demain soir', 42, {}, '2026-13-45T99:00']) {
        const lu = poolOps.lireDateRepechage(valeur, { maintenant: MAINTENANT });
        assert.equal(lu.ok, false, `« ${valeur} » aurait dû être refusé`);
        assert.equal(lu.code, 400);
    }
});

test('une date passée ou trop lointaine est refusée', () => {
    const passee = poolOps.lireDateRepechage(iso(MAINTENANT - HEURE), { maintenant: MAINTENANT });
    assert.equal(passee.ok, false);
    assert.match(passee.message, /à venir/);

    const lointaine = poolOps.lireDateRepechage(iso(MAINTENANT + poolOps.REPECHAGE_PREVU_MAX_MS + HEURE), { maintenant: MAINTENANT });
    assert.equal(lointaine.ok, false);
    assert.match(lointaine.message, /12 prochains mois/);
});

test("une date à venir est gardée à la minute, et « maintenant » passe malgré une minute de retard", () => {
    const lu = poolOps.lireDateRepechage('2026-10-03T23:30:45.123Z', { maintenant: MAINTENANT });
    assert.deepEqual(lu, { ok: true, date: '2026-10-03T23:30:00.000Z' });

    const justeParti = poolOps.lireDateRepechage(iso(MAINTENANT - 30 * 1000), { maintenant: MAINTENANT });
    assert.equal(justeParti.ok, true, 'le temps de remplir le formulaire ne doit pas le rendre invalide');
});

// ───────────────────────────── Programmer ─────────────────────────────

test('programmer fixe, déplace puis retire la date', () => {
    const pool = deuxEquipes();
    const fixe = poolOps.programmerRepechage(pool, { date: iso(MAINTENANT + HEURE), maintenant: MAINTENANT });
    assert.equal(fixe.ok, true);
    assert.equal(fixe.change, true);
    assert.equal(fixe.avant, null);
    assert.equal(pool.draftScheduledAt, iso(MAINTENANT + HEURE));

    const meme = poolOps.programmerRepechage(pool, { date: iso(MAINTENANT + HEURE), maintenant: MAINTENANT });
    assert.equal(meme.change, false, 'réenregistrer la même date ne change rien');

    pool.draftScheduleMissed = iso(MAINTENANT - HEURE);
    const retire = poolOps.programmerRepechage(pool, { date: null, maintenant: MAINTENANT });
    assert.equal(retire.ok, true);
    assert.equal(retire.avant, iso(MAINTENANT + HEURE));
    assert.equal('draftScheduledAt' in pool, false);
    assert.equal('draftScheduleMissed' in pool, false, 'une décision nouvelle efface la date manquée');
});

test("on ne programme ni un repêchage parti, ni un pool rapide, ni une date invalide", () => {
    const parti = deuxEquipes();
    parti.draftOrder = ['Équipe 1', 'Équipe 2'];
    assert.equal(poolOps.programmerRepechage(parti, { date: iso(MAINTENANT + HEURE), maintenant: MAINTENANT }).code, 409);

    const rapide = { ...deuxEquipes(), instant: true };
    assert.equal(poolOps.programmerRepechage(rapide, { date: iso(MAINTENANT + HEURE), maintenant: MAINTENANT }).code, 400);

    const pool = deuxEquipes();
    const refus = poolOps.programmerRepechage(pool, { date: 'bientôt', maintenant: MAINTENANT });
    assert.equal(refus.ok, false);
    assert.equal('draftScheduledAt' in pool, false);
});

// ───────────────────────────── Départ prévu ─────────────────────────────

test("l'heure prévue n'arrive que pour un repêchage à lancer, daté, et échu", () => {
    const pool = deuxEquipes({});
    assert.equal(poolOps.repechagePrevuEchu(null, MAINTENANT), false);
    assert.equal(poolOps.repechagePrevuEchu(pool, MAINTENANT), false, 'sans date');

    pool.draftScheduledAt = iso(MAINTENANT + HEURE);
    assert.equal(poolOps.repechagePrevuEchu(pool, MAINTENANT), false, 'pas encore');
    assert.equal(poolOps.repechagePrevuEchu(pool, MAINTENANT + HEURE), true, 'à la minute près');

    assert.equal(poolOps.repechagePrevuEchu({ ...pool, instant: true }, MAINTENANT + HEURE), false);
    assert.equal(poolOps.repechagePrevuEchu({ ...pool, draftOrder: ['Équipe 1'] }, MAINTENANT + HEURE), false);
});

test("à l'heure prévue, le repêchage part et la date tombe", () => {
    const pool = deuxEquipes();
    pool.draftScheduledAt = iso(MAINTENANT);

    const resultat = poolOps.demarrerRepechagePrevu(pool, { maintenant: MAINTENANT });
    assert.equal(resultat.ok, true);
    assert.equal(resultat.prevu, iso(MAINTENANT));
    assert.ok(pool.draftOrder.length > 0);
    assert.equal('draftScheduledAt' in pool, false);
});

test("avant l'heure, rien ne part", () => {
    const pool = deuxEquipes();
    pool.draftScheduledAt = iso(MAINTENANT + HEURE);
    const resultat = poolOps.demarrerRepechagePrevu(pool, { maintenant: MAINTENANT });
    assert.equal(resultat.ok, false);
    assert.equal(resultat.code, 409);
    assert.equal(pool.draftOrder.length, 0);
    assert.equal(pool.draftScheduledAt, iso(MAINTENANT + HEURE));
});

test("il manque des équipes à l'heure dite : rien ne part, la date devient manquée", () => {
    const seul = poolNeuf();
    seul.draftScheduledAt = iso(MAINTENANT);
    const resultat = poolOps.demarrerRepechagePrevu(seul, { maintenant: MAINTENANT });
    assert.equal(resultat.ok, false);
    assert.equal(resultat.manque, true);
    assert.equal(resultat.prevu, iso(MAINTENANT));
    assert.equal('draftScheduledAt' in seul, false, 'la date ne doit pas réarmer un départ à la prochaine arrivée');
    assert.equal(seul.draftScheduleMissed, iso(MAINTENANT));

    const impair = poolNeuf({ poolMode: 'head-to-head', membres: { 'Équipe 1': ['alice'], 'Équipe 2': ['bob'], 'Équipe 3': ['carl'] } });
    impair.draftScheduledAt = iso(MAINTENANT);
    assert.equal(poolOps.demarrerRepechagePrevu(impair, { maintenant: MAINTENANT }).manque, true);
});

test('un départ au clic efface aussi la date prévue et la date manquée', () => {
    const pool = deuxEquipes();
    pool.draftScheduledAt = iso(MAINTENANT + HEURE);
    pool.draftScheduleMissed = iso(MAINTENANT - HEURE);
    assert.equal(poolOps.demarrerRepechage(pool).ok, true);
    assert.equal('draftScheduledAt' in pool, false,
        'restée là, elle relancerait le repêchage de la saison suivante dès la remise à zéro');
    assert.equal('draftScheduleMissed' in pool, false);
});

// ───────────────────────────── Alertes ─────────────────────────────

test("la date d'un repêchage se lit à l'heure du pool, en français", () => {
    assert.equal(evenements.dateRepechage('2026-10-04T00:00:00.000Z'), 'samedi 3 octobre à 20 h');
    assert.equal(evenements.dateRepechage('2026-10-04T00:30:00.000Z'), 'samedi 3 octobre à 20 h 30');
    assert.equal(evenements.dateRepechage('pas une date'), null);
});

test('les alertes de date mènent à la salle d’attente et disent quand', () => {
    const prevue = {
        type: evenements.NOTIFICATION.REPECHAGE_PREVU,
        poolName: 'Ligue',
        subject: { poolName: 'Ligue', date: '2026-10-04T00:00:00.000Z' }
    };
    const vue = evenements.vueNotification(prevue);
    assert.equal(vue.titre, 'Date du repêchage fixée');
    assert.equal(vue.detail, 'Le repêchage commencera le samedi 3 octobre à 20 h.');
    assert.equal(vue.type, 'repechage');
    assert.equal(vue.urgent, false);
    assert.equal(vue.href, 'repechage.html?pool=Ligue');
    assert.equal(vue.id, 'draftsched:Ligue:2026-10-04T00:00:00.000Z');

    const sansDate = evenements.presenter({ ...prevue, subject: {} });
    assert.equal(sansDate.detail, 'Le repêchage a maintenant une date.');
    assert.equal(evenements.idClient({ ...prevue, subject: {} }), 'draftsched:Ligue:');

    const manque = {
        type: evenements.NOTIFICATION.REPECHAGE_MANQUE,
        poolName: 'Ligue',
        subject: { poolName: 'Ligue', date: '2026-10-04T00:00:00.000Z', raison: 'Il faut au moins 2 équipes.' }
    };
    const vueManque = evenements.vueNotification(manque);
    assert.match(vueManque.titre, /n'a pas démarré/);
    assert.match(vueManque.detail, /^Il faut au moins 2 équipes\. Lancez-le/);
    assert.equal(vueManque.href, 'repechage.html?pool=Ligue');
    assert.equal(vueManque.id, 'draftmissed:Ligue:2026-10-04T00:00:00.000Z');
    assert.match(evenements.presenter({ ...manque, subject: {} }).detail, /^Il manquait des équipes\./);
    assert.equal(evenements.idClient({ ...manque, subject: {} }), 'draftmissed:Ligue:');
});

test('les clés des alertes de date ne dépendent que du pool et de la date', () => {
    const cles = evenements.clesNotification;
    assert.equal(cles.repechagePrevu(7, '2026-10-04T00:00:00.000Z'), cles.repechagePrevu(7, '2026-10-04T00:00:00.000Z'));
    assert.notEqual(cles.repechagePrevu(7, '2026-10-04T00:00:00.000Z'), cles.repechagePrevu(7, '2026-10-05T00:00:00.000Z'),
        'déplacer la date est un fait nouveau');
    assert.notEqual(cles.repechageManque(7, '2026-10-04T00:00:00.000Z'), cles.repechagePrevu(7, '2026-10-04T00:00:00.000Z'));
});

test('la date prévue fait partie de ce qu’on montre avant d’entrer', () => {
    const pool = deuxEquipes();
    assert.equal(authz.resumePublic('Ligue', pool).draftScheduledAt, null);
    pool.draftScheduledAt = '2026-10-04T00:00:00.000Z';
    assert.equal(authz.resumePublic('Ligue', pool).draftScheduledAt, '2026-10-04T00:00:00.000Z');
});

// ───────────────────────────── Routes ─────────────────────────────

const plusTard = (heures) => iso(Math.floor((Date.now() + heures * HEURE) / 60000) * 60000);

test('créer un pool avec une date la garde ; sans date, rien ; une date passée est refusée', async () => {
    const h = monterRoutes([routesPools], { pools: {} });

    const date = plusTard(48);
    const avec = await h.appeler('POST', '/create-clan', {
        auth: ALICE, body: { name: 'Les Castors', teamName: 'Castors', draftScheduledAt: date }
    });
    assert.equal(avec.statusCode, 200);
    assert.equal(h.lirePool('Les Castors').draftScheduledAt, date);
    assert.equal(avec.body.pool.draftScheduledAt, date);

    const sans = await h.appeler('POST', '/create-clan', { auth: ALICE, body: { name: 'Les Hiboux', teamName: 'Hiboux' } });
    assert.equal(sans.statusCode, 200);
    assert.equal('draftScheduledAt' in h.lirePool('Les Hiboux'), false);

    const passee = await h.appeler('POST', '/create-clan', {
        auth: ALICE, body: { name: 'Les Loutres', teamName: 'Loutres', draftScheduledAt: iso(Date.now() - 2 * HEURE) }
    });
    assert.equal(passee.statusCode, 400);
    assert.equal(h.lirePool('Les Loutres'), null, 'refusé avant toute écriture');
});

test('la date se voit avant de choisir son équipe', async () => {
    const pool = deuxEquipes();
    pool.draftScheduledAt = plusTard(5);
    const h = monterRoutes([routesPools], { pools: { Ligue: pool } });
    const res = await h.appeler('GET', '/pool-teams/Ligue', { auth: null });
    assert.equal(res.body.draftScheduledAt, pool.draftScheduledAt);
});

test('seule la personne qui a créé le pool en choisit la date, et les autres membres sont prévenus une fois', async () => {
    const h = monterRoutes([routesPools], { pools: { Ligue: deuxEquipes() } });
    const date = plusTard(24);

    const intrus = await h.appeler('POST', '/api/pools/Ligue/draft-schedule', { auth: BOB, body: { draftScheduledAt: date } });
    assert.equal(intrus.statusCode, 403);
    assert.equal('draftScheduledAt' in h.lirePool('Ligue'), false);

    const res = await h.appeler('POST', '/api/pools/Ligue/draft-schedule', { auth: ALICE, body: { draftScheduledAt: date } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.draftScheduledAt, date);
    assert.equal(h.lirePool('Ligue').draftScheduledAt, date);
    assert.ok(h.etat.emissions.some(([evenement]) => evenement === 'poolMisAJour'));

    const alertes = () => h.etat.notifications.filter(n => n.type === 'draft_scheduled');
    assert.deepEqual(alertes().map(n => n.recipientUserId), ['bob'], 'on ne se prévient pas soi-même');

    await h.appeler('POST', '/api/pools/Ligue/draft-schedule', { auth: ALICE, body: { draftScheduledAt: date } });
    assert.equal(alertes().length, 1, 'la même date réenregistrée ne sonne pas deux fois');

    const retire = await h.appeler('POST', '/api/pools/Ligue/draft-schedule', { auth: ALICE, body: { draftScheduledAt: null } });
    assert.equal(retire.statusCode, 200);
    assert.equal(retire.body.draftScheduledAt, null);
    assert.equal('draftScheduledAt' in h.lirePool('Ligue'), false);
    assert.equal(alertes().length, 1, 'retirer la date ne prévient personne');

    const invalide = await h.appeler('POST', '/api/pools/Ligue/draft-schedule', { auth: ALICE, body: { draftScheduledAt: 'hier' } });
    assert.equal(invalide.statusCode, 400);
});

test('la date ne se change plus une fois le repêchage parti', async () => {
    const h = monterRoutes([routesPools], { pools: { Ligue: deuxEquipes() } });
    await h.appeler('POST', '/start-draft', { auth: ALICE, body: { clanName: 'Ligue' } });
    const res = await h.appeler('POST', '/api/pools/Ligue/draft-schedule', { auth: ALICE, body: { draftScheduledAt: plusTard(2) } });
    assert.equal(res.statusCode, 409);
});

test("le serveur lance à l'heure dite les repêchages prévus, et seulement eux", async () => {
    const echu = deuxEquipes();
    echu.draftScheduledAt = iso(MAINTENANT - 60 * 1000);
    const futur = deuxEquipes();
    futur.draftScheduledAt = iso(MAINTENANT + HEURE);
    const h = monterRoutes([routesPools], { pools: { Echu: echu, Futur: futur, Libre: deuxEquipes() } });

    const bilan = await h.ctx.demarrerRepechagesPrevus(MAINTENANT);
    assert.deepEqual(bilan.map(b => [b.pool, b.demarre]), [['Echu', true]]);

    const parti = h.lirePool('Echu');
    assert.ok(parti.draftOrder.length > 0);
    assert.equal('draftScheduledAt' in parti, false);
    assert.equal(parti.turnStartedAt, MAINTENANT);
    assert.deepEqual(h.etat.notifications.filter(n => n.type === 'draft_started').map(n => n.recipientUserId).sort(),
        ['alice', 'bob']);
    assert.ok(h.etat.emissions.some(([evenement, salle]) => evenement === 'draftDemarre' && salle === 'pool:Echu'));

    assert.equal(h.lirePool('Futur').draftOrder.length, 0);
    assert.equal(h.lirePool('Libre').draftOrder.length, 0);

    const encore = await h.ctx.demarrerRepechagesPrevus(MAINTENANT);
    assert.deepEqual(encore, [], 'un départ déjà fait ne se refait pas');
});

test("un départ prévu impossible prévient la personne qui a créé le pool, une seule fois", async () => {
    const seul = poolNeuf();
    seul.draftScheduledAt = iso(MAINTENANT);
    const h = monterRoutes([routesPools], { pools: { Seul: seul } });

    const bilan = await h.ctx.demarrerRepechagesPrevus(MAINTENANT);
    assert.deepEqual(bilan.map(b => [b.pool, b.demarre, b.raison]), [['Seul', false, 'manque']]);

    const apres = h.lirePool('Seul');
    assert.equal(apres.draftOrder.length, 0);
    assert.equal(apres.draftScheduleMissed, iso(MAINTENANT));
    assert.equal('draftScheduledAt' in apres, false);

    const alertes = h.etat.notifications.filter(n => n.type === 'draft_schedule_missed');
    assert.deepEqual(alertes.map(n => n.recipientUserId), ['alice']);
    assert.match(alertes[0].subject.raison, /au moins 2 équipes/);

    assert.deepEqual(await h.ctx.demarrerRepechagesPrevus(MAINTENANT + HEURE), [], 'la date manquée ne réarme rien');
});

test("un pool qui a démarré entre la lecture et le verrou n'est pas relancé", async () => {
    const pool = deuxEquipes();
    pool.draftScheduledAt = iso(MAINTENANT);
    const h = monterRoutes([routesPools], { pools: { Ligue: pool } });

    // Le clic « Commencer » arrive pendant le tri des candidats.
    const lireDepartsPrevus = h.store.lireDepartsPrevus;
    let apresClic = null;
    h.store.lireDepartsPrevus = async () => {
        const photo = JSON.parse(JSON.stringify(await lireDepartsPrevus()));
        await h.appeler('POST', '/start-draft', { auth: ALICE, body: { clanName: 'Ligue' } });
        apresClic = h.revisionDe('Ligue');
        return photo;
    };

    const bilan = await h.ctx.demarrerRepechagesPrevus(MAINTENANT);
    assert.deepEqual(bilan.map(b => [b.pool, b.demarre, b.raison]), [['Ligue', false, 'deja']]);
    assert.equal(h.revisionDe('Ligue'), apresClic, 'rien de réécrit');
    assert.equal(h.etat.notifications.filter(n => n.type === 'draft_started').length, 2, 'une seule alerte de départ par membre');
});

test('une panne sur un pool ne retient pas les autres départs', async () => {
    const a = deuxEquipes();
    a.draftScheduledAt = iso(MAINTENANT);
    const b = deuxEquipes();
    b.draftScheduledAt = iso(MAINTENANT);
    const h = monterRoutes([routesPools], { pools: { A: a, B: b } });

    const muter = h.store.muterPool;
    h.store.muterPool = async (nom, options) => {
        if (nom === 'A') throw new Error('base indisponible');
        return muter(nom, options);
    };

    const bilan = await h.ctx.demarrerRepechagesPrevus(MAINTENANT);
    assert.deepEqual(bilan.map(x => [x.pool, x.demarre, x.raison || null]).sort(),
        [['A', false, 'erreur'], ['B', true, null]]);
});
