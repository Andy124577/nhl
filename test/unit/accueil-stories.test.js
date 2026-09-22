'use strict';

/**
 * Le tableau indicateur des matchs en direct, en haut de l'accueil
 * (#storiesCard, accueil.js) : les aides de chaque but, le sélecteur qui
 * laisse choisir quel match on regarde, et le suivi rapproché qui met le
 * pointage à jour sans attendre un tour de carrousel.
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

const {
    storyAssistsHTML, storyLiveHTML, storyGoalsHTML, storyGoalKey,
    storyPeriodLabel, storyClockLabel, storyPeriodDots
} = chargerFonctions('accueil.js', [
    'STORY_STRENGTH_LABEL', 'STORY_PERIOD_LABEL', 'STORY_NICKNAMES_2_MOTS',
    'storyTeamIdentity', 'storyTeamAccent', 'storyHexToRgb', 'storyTeamVars',
    'storyNomLong', 'storyAssistsHTML', 'storyGoalScore', 'storyGoalKey',
    'storyEnEntracte', 'storyPeriodLabel', 'storyClockLabel', 'storyPeriodDots',
    'storyGoalsHTML', 'storyLiveHTML'
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

/** Les rangées de but d'un tableau rendu (le message « aucun but » exclu). */
const rangees = html => html.split('<div class="sl-goal sl-goal-from-').slice(1);

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

describe('accueil — un but qui tombe en direct', () => {
    test('au premier rendu, aucun but ne clignote', () => {
        // Ouvrir la page en troisième période ne doit pas allumer quatre buts
        // marqués une heure plus tôt.
        const html = storyLiveHTML(matchDeReference());
        assert.ok(!html.includes('is-new'), 'le rendu initial ne marque rien comme neuf');
    });

    test('seul le but nouvellement arrivé est marqué', () => {
        const g = matchDeReference();
        const neuf = new Set([storyGoalKey(g.events[0])]);
        const lignes = rangees(storyGoalsHTML(g, neuf));

        assert.equal(lignes.filter(l => l.startsWith('home is-new')).length, 1);
        assert.equal(lignes.filter(l => l.includes('is-new')).length, 1);
        assert.match(lignes[0], /^home is-new/, 'le but de Toronto porte la couleur du club local');
    });

    test('la rangée porte le camp du marqueur, pour la couleur du flash', () => {
        // Le CSS tire --sl-flash de .sl-goal-from-away / -home : sans cette
        // classe sur la rangée, le but s'allumerait en gris.
        const lignes = rangees(storyLiveHTML(matchDeReference()));
        assert.match(lignes[0], /^home/, 'A. Matthews marque pour le club local');
        assert.match(lignes[1], /^away/, 'C. Caufield marque pour le visiteur');
    });

    test('la clé d’un but ne bouge pas d’un rafraîchissement à l’autre', () => {
        // Elle sert à repérer les buts déjà vus : si elle changeait à chaque
        // passage, toute la liste clignoterait toutes les cinq secondes. Le
        // pointage n'en fait pas partie — il est corrigé après coup quand la
        // LNH révise une attribution.
        const e = matchDeReference().events[0];
        assert.equal(storyGoalKey(e), storyGoalKey({ ...e }));
        assert.equal(storyGoalKey(e), storyGoalKey({ ...e, awayScore: 9, assists: [] }));
        assert.notEqual(storyGoalKey(e), storyGoalKey({ ...e, timeInPeriod: '07:14' }));
        assert.notEqual(storyGoalKey(e), storyGoalKey({ ...e, scorer: 'M. Marner' }));
    });
});

describe('accueil — période et chrono, une seule règle', () => {
    // Le premier rendu et le suivi rapproché lisent les mêmes fonctions : deux
    // copies finiraient par se contredire à l'entracte ou en prolongation.
    test('la période ordinaire s’écrit en ordinal français', () => {
        assert.equal(storyPeriodLabel({ period: 1 }), '1re PÉRIODE');
        assert.equal(storyPeriodLabel({ period: 3 }), '3e PÉRIODE');
    });

    test('la prolongation et les tirs de barrage ont leur nom', () => {
        assert.equal(storyPeriodLabel({ period: 4, periodType: 'OT' }), 'PROLONGATION');
        assert.equal(storyPeriodLabel({ period: 5, periodType: 'SO' }), 'TIRS DE BARRAGE');
    });

    test('l’entracte remplace le chrono par un mot', () => {
        assert.equal(storyClockLabel({ clock: { timeRemaining: '00:00', inIntermission: true } }), 'ENTRACTE');
        assert.equal(storyClockLabel({ clock: { timeRemaining: '12:47', inIntermission: false } }), '12:47');
        assert.equal(storyClockLabel({}), '');
    });

    test('les pastilles marquent la période en cours, trois au minimum', () => {
        assert.equal(storyPeriodDots({ period: 2 }).match(/<i/g).length, 3);
        assert.equal(storyPeriodDots({ period: 2 }).match(/is-on/g).length, 1);
        assert.equal(storyPeriodDots({ period: 4 }).match(/<i/g).length, 4, 'la prolongation ajoute la sienne');
    });

    test('le tableau rendu affiche bien ce que ces règles disent', () => {
        const html = storyLiveHTML({ ...matchDeReference(), period: 4, periodType: 'OT' });
        assert.match(html, /sl-period">PROLONGATION</);
        assert.match(html, /sl-clock">12:47</);
    });
});

describe('accueil — le flux en direct ne ment pas sur ses pannes', () => {
    // C'est la distinction qui empêche un hoquet réseau d'effacer un tableau
    // indicateur bien vivant : « aucun match » et « je n'ai pas pu demander »
    // ne doivent pas se ressembler.
    const charger = reponse => chargerFonctions('accueil.js', ['fetchLiveGames'], {
        BASE_URL: '',
        console: { warn() {} },
        fetch: async () => reponse
    }).fetchLiveGames;

    test('une réponse valide rend la liste des matchs', async () => {
        const f = charger({ ok: true, json: async () => ({ games: [{ id: 1 }] }) });
        assert.deepEqual(await f(), [{ id: 1 }]);
    });

    test('une soirée sans match rend une liste vide, pas null', async () => {
        const f = charger({ ok: true, json: async () => ({ games: [] }) });
        assert.deepEqual(await f(), []);
    });

    test('un statut d’erreur rend null', async () => {
        assert.equal(await charger({ ok: false, status: 503 })(), null);
    });

    test('une requête qui échoue rend null', async () => {
        const f = chargerFonctions('accueil.js', ['fetchLiveGames'], {
            BASE_URL: '',
            console: { warn() {} },
            fetch: async () => { throw new Error('hors ligne'); }
        }).fetchLiveGames;
        assert.equal(await f(), null);
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

    test('la diapo épinglée survit au rafraîchissement, et seulement tant qu’elle est au flux', () => {
        assert.match(ACCUEIL_JS, /const epingle = storyPinnedKey === null \? -1/);
        assert.match(ACCUEIL_JS, /if \(epingle < 0\) storyPinnedKey = null;/);
    });

    test('sans match en direct, le sélecteur propose les actualités', () => {
        assert.match(ACCUEIL_JS, /const jetons = matchs\.length \? matchs : nouvelles;/);
        assert.match(ACCUEIL_JS, /function storyNewsChipHTML\(slide\)/);
    });

    test('une diapo se reconnaît par sa clé, pas par sa position', () => {
        const { storySlideKey } = chargerFonctions('accueil.js', ['storySlideKey'], {});
        assert.equal(storySlideKey({ type: 'live', game: { id: 42 } }), 'live:42');
        assert.equal(storySlideKey({ type: 'news', article: { url: 'https://x/a', title: 'T' } }), 'news:https://x/a');
        assert.equal(storySlideKey(undefined), null);
    });

    test('le choix du membre et le match à l’écran ne s’allument pas pareil', () => {
        // Deux classes distinctes, sans quoi « Auto » et un match brilleraient
        // de la même façon et on ne saurait plus lequel est épinglé.
        assert.match(ACCUEIL_CSS, /\.stories-chip\.is-on\b/);
        assert.match(ACCUEIL_CSS, /\.stories-chip\.is-current\b/);
    });
});

describe('accueil — le suivi rapproché', () => {
    const ACCUEIL_JS = fs.readFileSync(path.join(racine, 'accueil.js'), 'utf8');
    const ACCUEIL_CSS = fs.readFileSync(path.join(racine, 'accueil.css'), 'utf8');
    const SERVER = fs.readFileSync(path.join(racine, 'server.js'), 'utf8');

    test('le pointage ne dépend plus du tour de carrousel', () => {
        // C'était le gros du retard : la carte n'allait rechercher le
        // pointage qu'une fois toutes les diapos passées.
        assert.match(ACCUEIL_JS, /const STORY_LIVE_POLL_MS = 5000;/);
        assert.match(ACCUEIL_JS, /storyLiveTimer = setInterval\(refreshStoryLive, STORY_LIVE_POLL_MS\)/);
    });

    test('le cache serveur de /live-games tient cinq secondes', () => {
        assert.match(SERVER, /const LIVE_GAMES_TTL_MS = 5 \* 1000;/);
    });

    test('/live-games interdit toute remise en cache en aval', () => {
        // Sans ça, un cache de navigateur ou un intermédiaire pourrait
        // resservir un pointage périmé par-dessus un cache déjà court.
        const route = SERVER.slice(SERVER.indexOf("app.get('/live-games'"));
        const corps = route.slice(0, route.indexOf('\n});'));
        assert.equal(corps.match(/Cache-Control', 'no-store'/g).length, 2,
            'les deux sorties — cache chaud et réponse fraîche — doivent le poser');
    });

    test('un onglet caché ne consomme rien', () => {
        assert.match(ACCUEIL_JS, /if \(document\.visibilityState !== 'visible'\) return;/);
        assert.match(ACCUEIL_JS, /document\.addEventListener\('visibilitychange'/);
    });

    test('un match qui commence ou se termine reconstruit les diapos', () => {
        // Rafraîchir les chiffres ne suffirait pas : la liste des diapos et
        // les jetons du sélecteur changent aussi.
        assert.match(ACCUEIL_JS, /if \(avant !== apres\) \{ loadStories\(\); return; \}/);
    });

    test('une panne réseau laisse le tableau indicateur en place', () => {
        assert.match(ACCUEIL_JS, /if \(matchs === null\) return;/);
    });

    test('le flash respecte prefers-reduced-motion', () => {
        const bloc = ACCUEIL_CSS.slice(ACCUEIL_CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
        assert.match(bloc.slice(0, 400), /\.sl-goal\.is-new/);
        assert.match(bloc.slice(0, 400), /animation: none/);
    });

    test('le clignotement s’éteint de lui-même', () => {
        // Sans extinction, la classe restait posée : animée elle ne rejouait
        // pas, mais sous prefers-reduced-motion le dernier but serait resté
        // teinté jusqu'au suivant, comme s'il venait d'être marqué.
        assert.match(ACCUEIL_JS, /const STORY_FLASH_MS = \d+;/);
        assert.match(ACCUEIL_JS, /classList\.remove\('is-new'\)/);
    });

    test('deux buts rapprochés ne s’éteignent pas l’un l’autre', () => {
        // Le compte à rebours du premier but ne doit pas effacer le second :
        // c'est le dernier posé qui nettoie, d'où le jeton.
        assert.match(ACCUEIL_JS, /const jeton = \+\+storyFlashSeq;/);
        assert.match(ACCUEIL_JS, /if \(jeton !== storyFlashSeq\) return;/);
    });
});
