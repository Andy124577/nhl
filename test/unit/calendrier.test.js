'use strict';

/**
 * Le repêchage dans l'agenda : le fichier .ics et ses rappels, le lien Google
 * Agenda, et la route qui choisit l'un ou l'autre selon l'appareil
 * (lib/calendrier.js, routes/pools.js).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const calendrier = require('../../lib/calendrier.js');
const poolOps = require('../../lib/poolOps.js');
const routesPools = require('../../routes/pools.js');
const { monterRoutes, poolNeuf } = require('../fixtures/routeHarness.js');

const DATE = '2026-10-03T23:30:00.000Z';
const MAINTENANT = Date.parse('2026-09-28T12:00:00.000Z');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36';

const rendezVous = (extra = {}) => ({
    nom: 'Les Castors', date: DATE, url: 'https://fantazy.ca/draftActif.html?pool=Les%20Castors',
    uid: 'repechage-pool-7@fantazy.ca', limiteMs: poolOps.LIMITE_CHOIX_MS, maintenant: MAINTENANT, ...extra
});

/** Les lignes logiques d'un .ics, dépliées (RFC 5545, 3.1). */
const deplier = ics => ics.replace(/\r\n /g, '').split('\r\n').filter(Boolean);

// ───────────────────────────── Le format ─────────────────────────────

test('un instant se lit en UTC, à la seconde', () => {
    assert.equal(calendrier.horodatage(DATE), '20261003T233000Z');
    assert.equal(calendrier.horodatage(Date.parse('2026-01-02T03:04:05.678Z')), '20260102T030405Z');
});

test('le texte échappe ce que le format réserve', () => {
    assert.equal(calendrier.echapperTexte('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
    assert.equal(calendrier.echapperTexte(null), '');
});

test('une longue ligne se plie à 75 octets sans couper un accent', () => {
    const courte = 'SUMMARY:court';
    assert.equal(calendrier.plier(courte), courte);

    const longue = 'DESCRIPTION:' + 'é'.repeat(100);
    const pliee = calendrier.plier(longue);
    const morceaux = pliee.split('\r\n');
    assert.ok(morceaux.length > 1);
    morceaux.forEach((m, i) => {
        assert.ok(Buffer.byteLength(m, 'utf8') <= 75, `morceau ${i} trop long`);
        if (i > 0) assert.equal(m[0], ' ', 'une suite commence par une espace');
    });
    assert.equal(pliee.replace(/\r\n /g, ''), longue, 'déplier rend la ligne entière');
    assert.ok(!pliee.includes('�'));
});

test('le fichier porte le rendez-vous, deux rappels et la limite de temps', () => {
    const ics = calendrier.fichierIcs(rendezVous());
    assert.ok(ics.endsWith('\r\n'));
    assert.ok(!/[^\r]\n/.test(ics), 'fins de ligne CRLF seulement');
    ics.split('\r\n').forEach(l => assert.ok(Buffer.byteLength(l, 'utf8') <= 75));

    const lignes = deplier(ics);
    assert.equal(lignes[0], 'BEGIN:VCALENDAR');
    assert.equal(lignes.at(-1), 'END:VCALENDAR');
    assert.ok(lignes.includes('UID:repechage-pool-7@fantazy.ca'));
    assert.ok(lignes.includes('DTSTART:20261003T233000Z'));
    assert.ok(lignes.includes('DTEND:20261004T003000Z'));
    assert.ok(lignes.includes('DTSTAMP:20260928T120000Z'));
    assert.ok(lignes.includes(`SEQUENCE:${Math.floor(MAINTENANT / 60000)}`));
    assert.ok(lignes.includes('SUMMARY:Repêchage Les Castors · Fantazy'));
    assert.ok(lignes.includes('URL:https://fantazy.ca/draftActif.html?pool=Les%20Castors'));

    const description = lignes.find(l => l.startsWith('DESCRIPTION:Le repêchage'));
    assert.match(description, /3 minutes par choix : passé ce délai\\, Fantazy choisit/);
    assert.match(description, /\\nRejoindre la salle : https:\/\/fantazy\.ca/);

    assert.deepEqual(lignes.filter(l => l.startsWith('TRIGGER:')), ['TRIGGER:-PT60M', 'TRIGGER:-PT10M']);
    assert.ok(lignes.includes('DESCRIPTION:Repêchage Les Castors dans 1 h'));
    assert.ok(lignes.includes('DESCRIPTION:Repêchage Les Castors dans 10 min'));
    assert.equal(lignes.filter(l => l === 'BEGIN:VALARM').length, 2);
});

test('sans limite ni lien, le fichier le tait ; une date illisible est refusée', () => {
    const lignes = deplier(calendrier.fichierIcs(rendezVous({ limiteMs: 0, url: '', rappels: [] })));
    assert.equal(lignes.find(l => l.startsWith('DESCRIPTION:')), 'DESCRIPTION:Le repêchage du pool Les Castors commence.');
    assert.ok(!lignes.some(l => l.startsWith('URL:') || l.startsWith('LOCATION:') || l === 'BEGIN:VALARM'));
    assert.throws(() => calendrier.fichierIcs(rendezVous({ date: 'bientôt' })), /invalide/);
    assert.ok(deplier(calendrier.fichierIcs({ nom: 'X', date: DATE, uid: 'u' })).some(l => l.startsWith('DTSTAMP:')));
});

test('le lien Google préremplit le même rendez-vous', () => {
    const lien = new URL(calendrier.lienGoogle(rendezVous()));
    assert.equal(lien.origin + lien.pathname, 'https://calendar.google.com/calendar/render');
    assert.equal(lien.searchParams.get('action'), 'TEMPLATE');
    assert.equal(lien.searchParams.get('text'), 'Repêchage Les Castors · Fantazy');
    assert.equal(lien.searchParams.get('dates'), '20261003T233000Z/20261004T003000Z');
    assert.match(lien.searchParams.get('details'), /3 minutes par choix/);
    assert.equal(lien.searchParams.get('location'), 'https://fantazy.ca/draftActif.html?pool=Les%20Castors');

    const sansLien = new URL(calendrier.lienGoogle({ nom: 'X', date: DATE }));
    assert.equal(sansLien.searchParams.has('location'), false);
    assert.throws(() => calendrier.lienGoogle({ nom: 'X', date: '' }), /invalide/);
});

test('le nom du fichier reste lisible et sûr', () => {
    assert.equal(calendrier.nomFichier('Les Castors de l’Érablière !'), 'repechage-les-castors-de-l-erabliere.ics');
    assert.equal(calendrier.nomFichier('###'), 'repechage.ics');
    assert.equal(calendrier.nomFichier(null), 'repechage.ics');
});

test("Google sur Android, le fichier ailleurs, sauf choix contraire", () => {
    assert.equal(calendrier.sortiePour(ANDROID), 'google');
    assert.equal(calendrier.sortiePour(IPHONE), 'ics');
    assert.equal(calendrier.sortiePour(undefined), 'ics');
    assert.equal(calendrier.sortiePour(ANDROID, 'ics'), 'ics');
    assert.equal(calendrier.sortiePour(IPHONE, 'google'), 'google');
    assert.equal(calendrier.sortiePour(IPHONE, 'autre'), 'ics');
});

// ───────────────────────────── La route ─────────────────────────────

function banc() {
    const date = poolNeuf();
    date.draftScheduledAt = DATE;
    const rapide = { ...poolNeuf(), instant: true, draftScheduledAt: DATE };
    return monterRoutes([routesPools], { pools: { 'Les Castors': date, Libre: poolNeuf(), Rapide: rapide } });
}

/** Appelle la route avec les en-têtes d'un appareil. */
const appeler = (h, nom, headers, query = {}) =>
    h.appeler('GET', `/api/pools/${encodeURIComponent(nom)}/calendar`, { headers, query });

test('sur iPhone, le lien donne le fichier .ics, sans session', async () => {
    const h = banc();
    const route = h.app.routes.find(r => r.chemin === '/api/pools/:poolName/calendar');
    assert.equal(route.gestionnaires.length, 1, 'aucune session demandée');

    const res = await appeler(h, 'Les Castors', { 'user-agent': IPHONE, host: 'fantazy.ca', 'x-forwarded-proto': 'https' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.entetes['Content-Type'], 'text/calendar; charset=utf-8');
    assert.equal(res.entetes['Content-Disposition'], 'inline; filename="repechage-les-castors.ics"');
    const lignes = deplier(res.body);
    assert.ok(lignes.includes('DTSTART:20261003T233000Z'));
    assert.ok(lignes.includes('URL:https://fantazy.ca/draftActif.html?pool=Les%20Castors'));
    assert.ok(lignes.some(l => /^UID:repechage-pool-\d+@fantazy\.ca$/.test(l)));
});

test('sur Android, le lien ouvre Google Agenda ; ?app=ics garde le fichier', async () => {
    const h = banc();
    const google = await appeler(h, 'Les Castors', { 'user-agent': ANDROID, host: 'fantazy.ca' });
    assert.equal(google.statusCode, 302);
    assert.match(google.entetes.Location, /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);

    const fichier = await appeler(h, 'Les Castors', { 'user-agent': ANDROID, host: 'localhost:3000' }, { app: 'ics' });
    assert.equal(fichier.statusCode, 200);
    assert.ok(deplier(fichier.body).some(l => /^UID:repechage-pool-\d+@localhost$/.test(l)), 'le port ne va pas dans l’identifiant');
    assert.ok(deplier(fichier.body).includes('URL:http://localhost:3000/draftActif.html?pool=Les%20Castors'));
});

test('pas de date, pool rapide ou pool inconnu : rien à ajouter', async () => {
    const h = banc();
    for (const nom of ['Libre', 'Rapide', 'Inconnu']) {
        const res = await appeler(h, nom, { 'user-agent': IPHONE, host: 'fantazy.ca' });
        assert.equal(res.statusCode, 404, nom);
        assert.match(res.body.message, /pas de date/);
    }
});
