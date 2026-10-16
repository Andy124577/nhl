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
    storyPeriodLabel, storyClockLabel, storyPeriodDots,
    storyPreHTML, storyHeure, storyAvantLabel, storyJourLabel, storyGameChipHTML
} = chargerFonctions('accueil.js', [
    'STORY_STRENGTH_LABEL', 'STORY_PERIOD_LABEL', 'STORY_NICKNAMES_2_MOTS',
    'storyTeamIdentity', 'storyTeamAccent', 'storyHexToRgb', 'storyTeamVars',
    'storyNomLong', 'storyAssistsHTML', 'storyGoalScore', 'storyGoalKey',
    'storyEnEntracte', 'storyPeriodLabel', 'storyClockLabel', 'storyPeriodDots',
    'storyGoalsHTML', 'storyGoalsBlocHTML', 'storyLiveHTML',
    'storyPreHTML', 'storyTopHTML', 'storyFondHTML', 'storyCampHTML',
    'storyLienMatchHTML', 'storyNomComplet', 'storyHeure', 'storyAvantLabel',
    'storyJourLabel', 'storySlideKey', 'storyGameChipHTML'
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
    const charger = reponse => chargerFonctions('accueil.js', ['fetchLiveGames', 'fetchStoryGames'], {
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
        const f = chargerFonctions('accueil.js', ['fetchLiveGames', 'fetchStoryGames'], {
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
        assert.equal(storySlideKey({ type: 'live', game: { id: 42 } }), 'match:42');
        // Même clé avant et après la mise au jeu : un match épinglé à l'avance
        // reste épinglé quand sa carte devient le tableau indicateur.
        assert.equal(storySlideKey({ type: 'pre', game: { id: 42 } }), 'match:42');
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
        // Posé une fois, avant toute sortie : cache chaud, réponse fraîche et
        // panne le portent toutes (le relevé vit dans lireMatchsEnDirect).
        const route = SERVER.slice(SERVER.indexOf("app.get('/live-games'"));
        const corps = route.slice(0, route.indexOf('\n});'));
        const pose = corps.indexOf("res.set('Cache-Control', 'no-store')");
        assert.ok(pose > 0, 'la route pose no-store');
        assert.ok(pose < corps.search(/res\.(json|send)\(/), 'avant la première réponse');
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

describe('accueil — la carte d’avant-match', () => {
    // Un match du jour pas encore commencé : l'heure de la mise au jeu et les
    // deux clubs, sur le dessin du tableau indicateur qu'il deviendra.
    const MIDI = new Date(2026, 9, 15, 12, 0).getTime();
    const SOIR = new Date(2026, 9, 15, 19, 0).toISOString();
    const avantMatch = (extra = {}) => ({
        id: 2026020150,
        state: 'FUT',
        startTimeUTC: SOIR,
        venue: 'Centre Bell',
        away: { abbrev: 'TOR', name: 'Maple Leafs' },
        home: { abbrev: 'MTL', name: 'Canadiens' },
        ...extra
    });

    test('l’heure s’écrit à la française, à l’heure du membre', () => {
        assert.match(storyHeure(SOIR), /^19\sh\s00$/u);
        assert.equal(storyHeure('pas une date'), '');
    });

    test('le temps qui reste, puis « imminente » une fois l’heure passée', () => {
        const depart = new Date(MIDI + (2 * 60 + 14) * 60000).toISOString();
        assert.equal(storyAvantLabel(depart, MIDI), 'dans 2 h 14');
        assert.equal(storyAvantLabel(new Date(MIDI + 60 * 60000).toISOString(), MIDI), 'dans 1 h 00');
        assert.equal(storyAvantLabel(new Date(MIDI + 12 * 60000).toISOString(), MIDI), 'dans 12 min');
        // Une minute entamée compte : 30 secondes, c'est encore « dans 1 min ».
        assert.equal(storyAvantLabel(new Date(MIDI + 30000).toISOString(), MIDI), 'dans 1 min');
        // L'heure est passée, la LNH n'a pas encore lancé le match.
        assert.equal(storyAvantLabel(new Date(MIDI - 5 * 60000).toISOString(), MIDI), 'imminente');
        assert.equal(storyAvantLabel(undefined, MIDI), '');
    });

    test('« Aujourd’hui », ou « Demain » si le flux a basculé sur le lendemain', () => {
        assert.equal(storyJourLabel(SOIR, MIDI), 'Aujourd’hui');
        assert.equal(storyJourLabel(new Date(2026, 9, 16, 19, 0).toISOString(), MIDI), 'Demain');
    });

    test('la carte annonce les deux clubs, l’heure et le temps qui reste', () => {
        const html = storyPreHTML(avantMatch(), MIDI);
        assert.match(html, /class="sl-live sl-pre"/);
        assert.match(html, /sl-name[^"]*">Maple Leafs</, 'le visiteur');
        assert.match(html, /sl-name[^"]*">Canadiens</, 'le club local');
        assert.ok(html.indexOf('Maple Leafs') < html.indexOf('Canadiens'), 'le visiteur à gauche, comme en direct');
        assert.match(html, /<time class="sl-time" datetime="[^"]+">19\sh\s00<\/time>/u);
        assert.match(html, /sl-kick">Mise au jeu</);
        assert.match(html, /sl-until">dans 7 h 00</);
        assert.match(html, /sl-record">2 - 2 - 0</, 'la fiche du club, comme au tableau indicateur');
    });

    test('avant la mise au jeu, ni pointage ni point qui bat', () => {
        // Un « 0 - 0 » se lirait comme un match commencé.
        const html = storyPreHTML(avantMatch(), MIDI);
        assert.ok(!html.includes('sl-score'), 'aucun pointage');
        assert.ok(!html.includes('sl-badge-dot'), 'la pastille ne bat pas');
        assert.ok(!html.includes('En direct'));
        assert.match(html, /class="sl-badge is-pre">Aujourd’hui</);
    });

    test('l’aréna s’affiche quand la LNH la donne, échappée', () => {
        assert.match(storyPreHTML(avantMatch(), MIDI), /class="sl-venue">Centre Bell</);
        assert.ok(!storyPreHTML(avantMatch({ venue: '' }), MIDI).includes('sl-venue'));
        const html = storyPreHTML(avantMatch({ venue: '<b>Aréna</b>' }), MIDI);
        assert.ok(!html.includes('<b>Aréna'));
        assert.match(html, /&lt;b&gt;Aréna/);
    });

    test('le jeton du sélecteur montre l’heure, pas une marque', () => {
        const chip = storyGameChipHTML({ type: 'pre', game: avantMatch() });
        assert.match(chip, /stories-chip-time">19\sh\s00</u);
        assert.ok(!chip.includes('stories-chip-score'));
        assert.match(chip, /data-story-pick="match:2026020150"/);

        const direct = storyGameChipHTML({ type: 'live', game: matchDeReference() });
        assert.match(direct, /stories-chip-score">2<i>-<\/i>3</);
        assert.ok(!direct.includes('stories-chip-time'));
    });
});

describe('accueil — un clic sur un match ouvre sa feuille', () => {
    const lien = html => (html.match(/<a class="sl-open"[^>]*><\/a>/) || [])[0];

    test('la carte d’avant-match mène à match.html', () => {
        const a = lien(storyPreHTML({
            id: 2026020150, startTimeUTC: '2026-10-15T23:00:00Z', venue: '',
            away: { abbrev: 'TOR', name: 'Maple Leafs' }, home: { abbrev: 'MTL', name: 'Canadiens' }
        }));
        assert.ok(a, 'un lien couvre la carte');
        assert.match(a, /href="match\.html\?id=2026020150"/);
        assert.match(a, /aria-label="Feuille de match : Toronto Maple Leafs contre Montreal Canadiens, mise au jeu à /);
    });

    test('le tableau indicateur en direct mène à la même feuille', () => {
        const a = lien(storyLiveHTML(matchDeReference()));
        assert.ok(a, 'un lien couvre la carte');
        assert.match(a, /href="match\.html\?id=2026020123"/);
        assert.match(a, /aria-label="Feuille de match : Montreal Canadiens contre Toronto Maple Leafs"/);
        // L'étiquette ne suit pas le direct : un pointage y serait vite faux.
        assert.ok(!/\d+\s*-\s*\d+/.test(a), 'pas de pointage dans l’étiquette');
    });

    test('le lien est vide et posé après les buts : les buts restent cliquables', () => {
        // Un <a> qui envelopperait la carte contiendrait les boutons du
        // carrousel des buts — interdit, et le clic sur un buteur ouvrirait
        // le match au lieu de sa fiche.
        const html = storyLiveHTML(matchDeReference());
        assert.ok(html.indexOf('class="sl-goals"') < html.indexOf('class="sl-open"'));
        const ACCUEIL_CSS = fs.readFileSync(path.join(racine, 'accueil.css'), 'utf8');
        assert.match(ACCUEIL_CSS, /\.sl-open \{\s*position: absolute; inset: 0; z-index: 1;/);
        assert.match(ACCUEIL_CSS, /\.stories-card\.is-live \.sl-goals \{ position: relative; z-index: 2; \}/);
    });

    test('l’invitation « Feuille de match » n’est pas un second lien', () => {
        const html = storyLiveHTML(matchDeReference());
        assert.match(html, /<span class="sl-cta" aria-hidden="true">Feuille de match/);
        assert.equal(html.split('<a ').length - 1, 1, 'un seul lien par carte');
    });
});

describe('accueil — les matchs du jour arrivent avec le direct', () => {
    const charger = reponse => chargerFonctions('accueil.js', ['fetchStoryGames'], {
        BASE_URL: '',
        console: { warn() {} },
        fetch: async () => reponse
    }).fetchStoryGames;

    // L'objet rendu naît dans le bac à sable : on compare son contenu, pas
    // son prototype, qui n'est pas celui de ce fichier.
    const contenu = valeur => JSON.parse(JSON.stringify(valeur));

    test('une lecture rend les matchs en cours et ceux à venir', async () => {
        const f = charger({ ok: true, json: async () => ({ games: [{ id: 1 }], upcoming: [{ id: 2 }] }) });
        assert.deepEqual(contenu(await f()), { games: [{ id: 1 }], upcoming: [{ id: 2 }] });
    });

    test('un serveur qui n’envoie pas encore `upcoming` rend une liste vide', async () => {
        const f = charger({ ok: true, json: async () => ({ games: [] }) });
        assert.deepEqual(contenu(await f()), { games: [], upcoming: [] });
    });

    test('une panne rend null, comme pour le direct', async () => {
        assert.equal(await charger({ ok: false, status: 503 })(), null);
    });

    test('une heure de mise au jeu passée réveille le suivi du direct', () => {
        // Sans match en cours, rien ne suivait la LNH : la carte d'avant-match
        // serait restée figée jusqu'à un rechargement complet des diapos.
        const maintenant = Date.parse('2026-10-15T23:05:00Z');
        const passee = slides => chargerFonctions('accueil.js', ['storyMiseAuJeuPassee'], { storySlides: slides })
            .storyMiseAuJeuPassee(maintenant);
        assert.equal(passee([{ type: 'pre', game: { startTimeUTC: '2026-10-15T23:00:00Z' } }]), true);
        assert.equal(passee([{ type: 'pre', game: { startTimeUTC: '2026-10-15T23:30:00Z' } }]), false);
        assert.equal(passee([{ type: 'news', article: {} }]), false);

        const ACCUEIL_JS = fs.readFileSync(path.join(racine, 'accueil.js'), 'utf8');
        assert.match(ACCUEIL_JS, /if \(!storySlides\.some\(s => s\.type === 'live'\) && !storyMiseAuJeuPassee\(\)\) return;/);
        assert.match(ACCUEIL_JS, /if \(!storySuiviActif\(\) && storyMiseAuJeuPassee\(\)\) startStoryLivePoll\(\);/);
    });

    test('le serveur joint les matchs à venir à /live-games, panne comprise', () => {
        const SERVER = fs.readFileSync(path.join(racine, 'server.js'), 'utf8');
        assert.match(SERVER, /upcoming: horaireLNH\.matchsAVenir\(allGames\)/);
        const route = SERVER.slice(SERVER.indexOf("app.get('/live-games'"));
        const corps = route.slice(0, route.indexOf('\n});'));
        assert.equal(corps.split('upcoming: []').length - 1, 2, 'les deux réponses de repli portent la liste vide');
    });
});
