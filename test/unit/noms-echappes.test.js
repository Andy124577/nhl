'use strict';

/**
 * Les noms d'autres comptes entrent échappés dans le HTML.
 *
 * draftFini.js affichait les membres et le nom de chaque équipe tels quels,
 * chez tous les membres du pool : un nom porteur de balisage s'y exécutait.
 * Le serveur refuse désormais ces noms à l'inscription (lib/reglesCompte.js),
 * mais un compte créé avant reste possible — l'affichage échappe donc aussi.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { chargerFonctions } = require('../fixtures/helpers.js');

const PIEGE = '<img src=x onerror=alert(1)>"\'&';
const ATTENDU = '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;';

test('draftFini.js, navbar.js et avatars.js échappent les cinq caractères dangereux', () => {
    assert.equal(chargerFonctions('draftFini.js', ['echapperHtml']).echapperHtml(PIEGE), ATTENDU);
    assert.equal(chargerFonctions('navbar.js', ['_navEsc'])._navEsc(PIEGE), ATTENDU);
    assert.equal(chargerFonctions('avatars.js', ['_avatarEsc'])._avatarEsc(PIEGE), ATTENDU);
});

test('l initiale d un avatar ne peut pas sortir de son attribut', () => {
    const { avatarHtml } = chargerFonctions('avatars.js', ['_avatarCache', '_avatarEsc', 'avatarHtml']);
    const html = avatarHtml('"><b>', 24);
    assert.ok(!html.includes('"">'), html);
    assert.match(html, /alt="&quot;"/);
});

test('draftFini.js n interpole plus de nom d équipe ni de membre sans l échapper', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../draftFini.js'), 'utf8');
    assert.doesNotMatch(source, /onclick="showPlayerDetails\(/, 'le clic passe par un écouteur');
    assert.doesNotMatch(source, /\$\{team\.(members|teamName)/, 'nom ou membres interpolés tels quels');
});

test('equipes.js ne redéfinit plus logout ni switchToUser, ceux de navbar.js', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../equipes.js'), 'utf8');
    assert.doesNotMatch(source, /^(async )?function (logout|switchToUser|loadAdminUsers)\s*\(/m);
});
