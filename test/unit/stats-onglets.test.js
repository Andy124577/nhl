'use strict';

/**
 * La page Joueurs (stats.html) : « Tous les joueurs », « Agents libres » et
 * « Trios LNH ». L'ancien onglet « Meneurs » a rejoint l'accueil de saison
 * (accueil-season.js) ; « Agents libres » montre la même liste que « Tous
 * les joueurs », sans les joueurs pris dans le pool actif ; la position se
 * choisit dans des onglets posés sur la page, plus dans la feuille de filtres.
 * Faute de DOM ici, on lit les fichiers tels que le navigateur les reçoit.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const racine = path.join(__dirname, '../..');
const lire = f => fs.readFileSync(path.join(racine, f), 'utf8');
const STATS = lire('stats.html');

describe('page Joueurs — onglets', () => {
    test('Tous les joueurs, Agents libres, Trios LNH ; plus de Meneurs', () => {
        const onglets = [...STATS.matchAll(/class="stats-subnav-btn[^"]*" data-stats-tab="([^"]+)"/g)].map(m => m[1]);
        assert.deepEqual(onglets, ['tous', 'libres', 'alignements']);
        assert.doesNotMatch(STATS, /data-stats-panel="meneurs"|statsLeadersGrid|statsLeaders\.js/);
    });

    test('« Agents libres » ouvre le panneau de « Tous les joueurs » et active le filtre', () => {
        assert.match(STATS, /var panneau = tab === 'libres' \? 'tous' : tab;/);
        assert.match(STATS, /get\('onglet'\) === 'libres'\) switchStatsTab\('libres'\)/);
        const filtres = lire('statsFiltres.js');
        assert.match(filtres, /addEventListener\('fz:stats-tab'/);
        assert.match(filtres, /statsLibres = voulu;/);
    });

    test('les onglets de position sont sur la page, sous la recherche, et plus dans la feuille', () => {
        const feuille = STATS.slice(STATS.indexOf('id="sjFeuille"'));
        const page = STATS.slice(0, STATS.indexOf('id="sjFeuille"'));
        assert.equal(STATS.split('id="playerFilter"').length - 1, 1);
        assert.ok(page.includes('id="playerFilter"'), 'les onglets de position vivent dans la page');
        assert.ok(page.indexOf('id="searchInput"') < page.indexOf('id="playerFilter"'), 'sous la recherche');
        assert.doesNotMatch(feuille, /data-filter=|id="sjLibres"/, 'la feuille garde seulement les données et le club');
        for (const f of ['all', 'offensive', 'C', 'L', 'R', 'defensive', 'goalies', 'rookies', 'teams']) {
            assert.match(page, new RegExp(`data-filter="${f}"`), `onglet ${f}`);
        }
    });
});
