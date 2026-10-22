'use strict';

/**
 * Accueil du repêchage (accueil-draft.js), maquettes « repêchage en cours »
 * et « en préparation » : le héros et ses cartes en deux colonnes, puis les
 * alignements des 32 clubs (fzsAlignementsHTML, accueil-season.js) et À lire.
 * Le calendrier de la LNH n'a pas d'emplacement pendant le repêchage.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chargerFonctions } = require('../fixtures/helpers.js');

const SOURCE = fs.readFileSync(path.join(__dirname, '../../accueil-draft.js'), 'utf8');
const LINEUP = fs.readFileSync(path.join(__dirname, '../../statsLineup.js'), 'utf8');

// Un tableau sur plusieurs lignes n'a pas d'accolades à compter : on le lit
// tel quel dans la source.
const FZH_AL_CLUBS = vm.runInNewContext(SOURCE.match(/^const FZH_AL_CLUBS = (\[[\s\S]*?\n\]);/m)[1]);

describe('accueil repêchage — disposition', () => {
    test('deux colonnes : le héros et sa carte, puis ma sélection et les derniers choix (ou ma liste)', () => {
        const a = SOURCE.indexOf('fzs-col-a'), b = SOURCE.indexOf('fzs-col-b');
        assert.ok(a > 0 && a < b);
        assert.ok(SOURCE.indexOf('data-fzh-hero') > a && SOURCE.indexOf('data-fzh-panneau') < b);
        assert.ok(SOURCE.indexOf('fzhHeroBesoinsHTML') > b && SOURCE.indexOf('data-fzh-liste') > b);
    });

    test('les alignements des 32 clubs passent juste avant À lire', () => {
        const lignes = SOURCE.indexOf('fzsAlignementsHTML()');
        const lire = SOURCE.indexOf('data-fz-bloc="actualites"');
        assert.ok(lignes > 0 && lignes < lire);
    });

    test('le calendrier de la LNH n’a plus d’emplacement pendant le repêchage', () => {
        assert.ok(!SOURCE.includes('data-fz-bloc="calendrier"'));
        assert.ok(!/\brenderCalendar\(\)/.test(SOURCE), 'rien à redessiner : le calendrier reste masqué');
    });
});

describe('accueil repêchage — clubs', () => {
    test('trente-deux clubs, ceux que la page des alignements connaît', () => {
        assert.equal(FZH_AL_CLUBS.length, 32);
        const connus = new Set([...LINEUP.match(/const CLUBS = \[([\s\S]*?)\]\s*\.sort/)[1].matchAll(/\['([A-Z]{3})'/g)].map(m => m[1]));
        assert.deepEqual([...FZH_AL_CLUBS.map(c => c[0])].sort(), [...connus].sort());
        assert.match(LINEUP, /params\.get\('onglet'\) === 'alignements'/);
        assert.match(LINEUP, /params\.get\('equipe'\)/);
    });

    test('un club repêché retrouve son sigle par son nom complet', () => {
        const { fzhClubAbbrev } = chargerFonctions('accueil-draft.js', ['fzhClubAbbrev'], {
            userData: { teamsData: { teams: [{ teamFullName: 'Winnipeg Jets', teamAbbrev: 'WPG' }] } }
        });
        assert.equal(fzhClubAbbrev('Winnipeg Jets'), 'WPG');
        assert.equal(fzhClubAbbrev('Inconnu'), '');
    });
});
