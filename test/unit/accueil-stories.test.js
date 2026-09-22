'use strict';

/**
 * Le tableau indicateur des matchs en direct, en haut de l'accueil
 * (#storiesCard, accueil.js) : les aides de chaque but, et le sélecteur qui
 * laisse choisir quel match on regarde au lieu de subir la rotation.
 *
 * Les aides voyageaient déjà dans le flux — /live-games les met dans
 * `goal.assists` (server.js) — mais la carte les jetait. Ces tests tiennent
 * les deux bouts : que la cellule d'aide existe bel et bien dans la rangée
 * livrée, et qu'un but sans aide le dise au lieu de laisser un trou.
 *
 * Comme les autres tests de scripts de page, ils découpent les fonctions
 * dans le vrai fichier (voir test/fixtures/helpers.js) : c'est le code livré
 * qui est mesuré, pas une copie.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chargerFonctions } = require('../fixtures/helpers.js');

const racine = path.join(__dirname, '../..');

const escapeHTML = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const userData = {
    teamsData: {
        teams: [
            { teamAbbrev: 'MTL', teamFullName: 'Montreal Canadiens', wins: 3, losses: 1, otLosses: 1 },
            { teamAbbrev: 'TOR', teamFullName: 'Toronto Maple Leafs', wins: 2, losses: 2, otLosses: 0 }
        ]
    }
};

const { storyAssistsHTML, storyLiveHTML } = chargerFonctions('accueil.js', [
    'STORY_STRENGTH_LABEL', 'STORY_PERIOD_LABEL', 'STORY_NICKNAMES_2_MOTS',
    'storyTeamIdentity', 'storyTeamAccent', 'storyHexToRgb', 'storyTeamVars',
    'storyNomLong', 'storyAssistsHTML', 'storyGoalScore', 'storyLiveHTML'
], { escapeHTML, userData });

/** Un match en cours plausible, avec les quatre cas d'aide qui existent. */
function matchDeReference() {
    return {
        id: 2026020123,
        state: 'LIVE',
        period: 2,
        periodType: 'REG',
        clock: { timeRemaining: '12:47', inIntermission: false },
        away: { abbrev: 'MTL', name: 'Canadiens', score: 2 },
        home: { abbrev: 'TOR', name: 'Maple Leafs', score: 3 },
        events: [
            { team: 'TOR', scorer: 'A. Matthews', assists: ['W. Nylander', 'M. Marner'], period: 2, timeInPeriod: '07:13', strength: 'pp', awayScore: 2, homeScore: 3 },
            { team: 'MTL', scorer: 'C. Caufield', assists: ['N. Suzuki'], period: 2, timeInPeriod: '03:02', strength: 'ev', awayScore: 2, homeScore: 2 },
            { team: 'TOR', scorer: 'J. Tavares', assists: [], period: 1, timeInPeriod: '15:40', strength: 'sh', awayScore: 1, homeScore: 2 },
            { team: 'MTL', scorer: 'J. Slafkovsky', period: 1, timeInPeriod: '04:11', strength: 'ev', awayScore: 1, homeScore: 1 }
        ]
    };
}

const rangees = html => html.split('<div class="sl-goal">').slice(1);

describe('accueil — les aides sur le tableau indicateur', () => {
    test('les deux aides d’un but sont nommées, dans l’ordre reçu', () => {
        // L'ordre compte : la LNH envoie la première aide d'abord, et la
        // trier autrement ferait mentir la feuille de match.
        const html = storyAssistsHTML({ assists: ['W. Nylander', 'M. Marner'] });
        assert.match(html, /class="sl-goal-assists"/);
        assert.match(html, /W\. Nylander, M\. Marner/);
        assert.ok(html.indexOf('Nylander') < html.indexOf('Marner'));
    });

    test('un but sans aide le dit, il ne laisse pas la cellule vide', () => {
        // « Sans aide » est une vraie information de feuille de match : un
        // blanc se lirait comme une donnée manquante, ce qu'elle n'est pas.
        for (const but of [{ assists: [] }, {}, { assists: null }]) {
            const html = storyAssistsHTML(but);
            assert.match(html, /sl-goal-assists is-none/);
            assert.match(html, /Sans aide/);
        }
    });

    test('un nom vide dans le flux ne devient pas une aide fantôme', () => {
        // goal.assists[].name?.default peut manquer : le serveur filtre déjà,
        // la carte ne doit pas rattraper une virgule orpheline non plus.
        assert.match(storyAssistsHTML({ assists: ['', null, 'N. Suzuki'] }), />N\. Suzuki</);
        assert.match(storyAssistsHTML({ assists: [null, ''] }), /Sans aide/);
    });

    test('les noms passent par escapeHTML', () => {
        const html = storyAssistsHTML({ assists: ['<script>x</script>'] });
        assert.ok(!html.includes('<script>'), 'le nom ne doit pas être injecté tel quel');
        assert.match(html, /&lt;script&gt;/);
    });

    test('chaque rangée de but porte sa cellule d’aide', () => {
        const lignes = rangees(storyLiveHTML(matchDeReference()));
        assert.equal(lignes.length, 4);
        for (const ligne of lignes) {
            assert.match(ligne, /class="sl-goal-assists/, 'chaque but doit afficher son aide');
        }
    });

    test('l’aide se place entre le but et le pointage', () => {
        // Elle prend l'espace resté libre au milieu de la rangée ; posée
        // après le pointage elle pousserait la marque hors de la carte.
        const ligne = rangees(storyLiveHTML(matchDeReference()))[0];
        const ordre = (ligne.match(/class="sl-goal-[a-z]+/g) || []);
        assert.deepEqual(ordre, [
            'class="sl-goal-time',
            'class="sl-goal-team',
            'class="sl-goal-scorer',
            'class="sl-goal-sep',
            'class="sl-goal-tag',
            'class="sl-goal-strength',
            'class="sl-goal-assists',
            'class="sl-goal-score',
            'class="sl-goal-period'
        ]);
    });

    test('l’avantage numérique reste affiché à côté de l’aide', () => {
        // L'aide s'ajoute, elle ne remplace rien : AN/DN étaient là avant.
        const lignes = rangees(storyLiveHTML(matchDeReference()));
        assert.match(lignes[0], /sl-goal-strength">AN</);
        assert.match(lignes[2], /sl-goal-strength">DN</);
        assert.ok(!lignes[1].includes('sl-goal-strength'), 'à forces égales, aucune pastille');
    });

    test('un match sans but garde son message, sans cellule d’aide', () => {
        const html = storyLiveHTML({ ...matchDeReference(), events: [] });
        assert.match(html, /sl-goal-none/);
        assert.ok(!html.includes('sl-goal-assists'));
    });
});

describe('accueil — le sélecteur de match', () => {
    const INDEX = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
    const ACCUEIL_JS = fs.readFileSync(path.join(racine, 'accueil.js'), 'utf8');
    const ACCUEIL_CSS = fs.readFileSync(path.join(racine, 'accueil.css'), 'utf8');

    test('l’emplacement du sélecteur n’existe qu’une fois dans index.html', () => {
        assert.equal(INDEX.split('id="storiesPicker"').length - 1, 1);
    });

    test('le serveur envoie bien les aides que la carte affiche', () => {
        // Le contrat tient en une ligne de server.js : si /live-games cesse
        // de porter `assists`, la carte affiche « Sans aide » partout sans
        // que rien ne casse — c'est ce silence-là que ce test coupe.
        const SERVER = fs.readFileSync(path.join(racine, 'server.js'), 'utf8');
        assert.match(SERVER, /assists:\s*\(goal\.assists \|\| \[\]\)\.map/);
    });

    test('épingler un match arrête la rotation mais pas les mises à jour', () => {
        // Sans ce rafraîchissement, un match épinglé gèlerait sur la marque
        // qu'il avait au moment du clic — pire que la rotation d'origine.
        assert.match(ACCUEIL_JS, /function startStoryPinnedRefresh\(\)/);
        assert.match(ACCUEIL_JS, /storyTimer = setTimeout\(loadStories, STORY_PINNED_REFRESH_MS\)/);
    });

    test('le match épinglé survit au rafraîchissement, et seulement tant qu’il joue', () => {
        assert.match(ACCUEIL_JS, /const epingle = storyPinnedGameId === null \? -1/);
        assert.match(ACCUEIL_JS, /if \(epingle < 0\) storyPinnedGameId = null;/);
    });

    test('le choix du membre et le match à l’écran ne s’allument pas pareil', () => {
        // Deux classes distinctes, sans quoi « Auto » et un match brilleraient
        // de la même façon et on ne saurait plus lequel est épinglé.
        assert.match(ACCUEIL_CSS, /\.stories-chip\.is-on\b/);
        assert.match(ACCUEIL_CSS, /\.stories-chip\.is-current\b/);
    });
});
