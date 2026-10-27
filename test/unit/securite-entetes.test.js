'use strict';

/**
 * Les en-têtes de sécurité (lib/securite.js) : CSP et HSTS.
 *
 * Le serveur ne posait que nosniff et SAMEORIGIN : rien n'empêchait un
 * script injecté de charger la suite depuis n'importe quel site.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const securite = require('../../lib/securite.js');

const entete = (liste, nom) => (liste.find(([n]) => n === nom) || [])[1];

test('la politique ferme les scripts étrangers, les connexions sortantes et l encadrement', () => {
    const csp = securite.politiqueDeContenu();
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self' 'unsafe-inline' https:\/\/code\.jquery\.com https:\/\/cdn\.socket\.io https:\/\/cdn\.jsdelivr\.net;/);
    assert.match(csp, /connect-src 'self';/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.match(csp, /base-uri 'self'/);
    assert.match(csp, /report-uri \/csp-report/);
});

test('chaque script externe chargé par une page figure dans script-src', () => {
    const racine = path.join(__dirname, '../..');
    const permis = new Set(securite.DIRECTIVES['script-src'].filter(s => s.startsWith('https://')));
    const manquants = new Set();
    for (const page of fs.readdirSync(racine).filter(n => n.endsWith('.html'))) {
        const html = fs.readFileSync(path.join(racine, page), 'utf8');
        for (const [, src] of html.matchAll(/<script\b[^>]*\bsrc="(https?:\/\/[^"]+)"/g)) {
            const origine = new URL(src).origin;
            if (!permis.has(origine)) manquants.add(`${page} → ${origine}`);
        }
    }
    assert.deepEqual([...manquants], [], 'ajouter l origine à script-src dans lib/securite.js');
});

test('mode : appliquée par défaut, rapport seul, ou retirée', () => {
    assert.equal(securite.modeCsp(undefined), 'enforce');
    assert.equal(securite.modeCsp('REPORT'), 'report');
    assert.equal(securite.modeCsp('off'), 'off');
    assert.equal(securite.modeCsp('nimporte'), 'enforce');

    assert.ok(entete(securite.entetesDeSecurite({}), 'Content-Security-Policy'));
    const rapport = securite.entetesDeSecurite({ mode: 'report' });
    assert.ok(entete(rapport, 'Content-Security-Policy-Report-Only'));
    assert.equal(entete(rapport, 'Content-Security-Policy'), undefined);
    assert.deepEqual(securite.entetesDeSecurite({ mode: 'off' }), []);
});

test('HSTS seulement en production et sur une requête arrivée en HTTPS', () => {
    assert.equal(entete(securite.entetesDeSecurite({ production: true, https: true }), 'Strict-Transport-Security'), 'max-age=31536000');
    assert.equal(entete(securite.entetesDeSecurite({ production: true, https: false }), 'Strict-Transport-Security'), undefined);
    assert.equal(entete(securite.entetesDeSecurite({ production: false, https: true }), 'Strict-Transport-Security'), undefined);
});

test('les rapports se lisent sous leurs deux formes, et rien d autre', () => {
    const ancien = { 'csp-report': { 'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js', 'document-uri': 'https://fantazy.ca/' } };
    const nouveau = [{ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'http://x/y.png', documentURL: 'https://fantazy.ca/stats.html' } }];
    assert.deepEqual(securite.lireRapportCsp(ancien), [{ directive: 'script-src-elem', bloque: 'https://evil.example/x.js', page: 'https://fantazy.ca/' }]);
    assert.deepEqual(securite.lireRapportCsp(nouveau), [{ directive: 'img-src', bloque: 'http://x/y.png', page: 'https://fantazy.ca/stats.html' }]);
    assert.deepEqual(securite.lireRapportCsp({ autre: 1 }), []);
    assert.deepEqual(securite.lireRapportCsp(null), []);
    assert.deepEqual(securite.lireRapportCsp([{ type: 'deprecation', body: {} }]), []);
});
