/**
 * La page « Rejoindre un pool » et sa modale « Choisir une équipe ».
 *
 * Deux pannes vécues sont épinglées ici, plus la frontière que la modale a
 * le droit de franchir — et celle qu'elle n'a pas le droit de franchir.
 *
 * 1. Le bouton « Rejoindre » de la liste ne faisait rien. joinClan lisait les
 *    alignements dans /draft, qui ne renvoie qu'un résumé de découverte pour
 *    les pools qu'on n'a pas rejoints : `teams` y étant absent,
 *    Object.entries(undefined) levait une exception avalée par un catch muet.
 *
 * 2. Chaque carte annonçait « 0/5 joueurs », équipes pleines comprises : elle
 *    comptait les noms reçus plutôt que le décompte du serveur, à une époque
 *    où /pool-teams ne livrait aucun nom à un non-membre.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const authz = require('../../lib/authz.js');
const routesPools = require('../../routes/pools.js');
const { monterRoutes, poolNeuf } = require('../fixtures/routeHarness.js');
const { chargerFonctions } = require('../fixtures/helpers.js');

const ALICE = { username: 'alice', userId: 'alice', isAdmin: false };
const CARL = { username: 'carl', userId: 'carl', isAdmin: false };

const POOL = {
    poolMode: 'cumulative',
    maxPlayers: 10,
    teams: {
        'Équipe 1': { members: ['alice'], teams: [] },
        'Équipe 2': { members: [], teams: [] }
    }
};

// ───────────────────────── Ce que chaque route laisse voir ─────────────────

describe('la frontière entre découverte et appartenance', () => {
    test('/pool-teams nomme les coéquipiers à qui n\'est pas encore entré', async () => {
        // On choisit une équipe pour y retrouver quelqu'un. Masquer les noms
        // revenait à faire choisir à l'aveugle.
        const h = monterRoutes([routesPools], { pools: { Ligue: poolNeuf() } });

        for (const [qui, identite] of [['un étranger', CARL], ['un visiteur anonyme', null]]) {
            const res = await h.appeler('GET', '/pool-teams/Ligue', { auth: identite });
            assert.equal(res.statusCode, 200, qui);
            const equipe1 = res.body.teams.find(e => e.name === 'Équipe 1');
            assert.deepEqual(equipe1.members, ['alice'], `${qui} doit voir les noms`);
            assert.equal(equipe1.memberCount, 1);
        }
    });

    test('/pool-teams ne sert que des noms et des places, jamais les choix', async () => {
        // La modale n'a besoin de rien d'autre ; l'ouvrir plus largement
        // ferait fuiter les alignements par une route de découverte.
        const h = monterRoutes([routesPools], { pools: { Ligue: poolNeuf() } });
        const res = await h.appeler('GET', '/pool-teams/Ligue', { auth: CARL });

        for (const equipe of res.body.teams) {
            assert.deepEqual(Object.keys(equipe).sort(),
                ['clubs', 'full', 'memberCount', 'members', 'name']);
        }
        assert.ok(!JSON.stringify(res.body).includes('passwordHash'));
    });

    test('/draft, lui, ne dit toujours rien des alignements à un non-membre', async () => {
        // C'est la frontière qu'on n'a PAS ouverte : /draft porte aussi
        // l'historique des choix et le classement de chaque pool du site.
        const h = monterRoutes([routesPools], { pools: { Ligue: poolNeuf() } });

        const etranger = await h.appeler('GET', '/draft', { auth: CARL });
        assert.equal(etranger.body.Ligue.teams, undefined);
        assert.ok(!JSON.stringify(etranger.body).includes('alice'));

        const membre = await h.appeler('GET', '/draft', { auth: ALICE });
        assert.ok(membre.body.Ligue.teams, 'un membre garde sa vue complète');
    });
});

describe('résumé public d\'un pool', () => {
    test('les alignements ne sortent pas — c\'est une information de membre', () => {
        const resume = authz.resumePublic('Pool test', POOL);
        assert.equal(Object.prototype.hasOwnProperty.call(resume, 'teams'), false);
    });

    test('mais de quoi choisir son équipe reste annoncé', () => {
        const resume = authz.resumePublic('Pool test', POOL);
        assert.deepEqual(resume.teamNames, ['Équipe 1', 'Équipe 2']);
        assert.deepEqual(resume.openTeamNames, ['Équipe 2']);
        assert.equal(resume.occupiedTeamCount, 1);
    });
});

// ───────────────────────────── Le bouton de la liste ────────────────────────

describe('joinClan', () => {
    test('passe par viewClanTeams, seul chemin qui serve un non-membre', () => {
        const vus = [];
        const { joinClan } = chargerFonctions('equipes.js', ['joinClan'], {
            viewClanTeams: nom => { vus.push(nom); return Promise.resolve(); }
        });

        joinClan('Pool test');
        assert.deepEqual(vus, ['Pool test']);
    });

    test('n\'interroge aucune route lui-même', async () => {
        // On compte les appels au lieu d'attendre un jet : l'ancienne version
        // était `async` et enterrait ses propres exceptions dans un catch
        // muet, donc un test qui guette une erreur passerait sur le code
        // cassé. C'est précisément ce silence qui a rendu le bug invisible.
        const routes = [];
        const { joinClan } = chargerFonctions('equipes.js', ['joinClan'], {
            viewClanTeams: () => Promise.resolve(),
            fetch: url => { routes.push(String(url)); return Promise.resolve({ json: () => ({}) }); },
            localStorage: { getItem: () => 'alice' },
            BASE_URL: 'http://exemple.invalide'
        });

        await joinClan('Pool test');
        assert.deepEqual(routes, [], 'le résumé de /draft n\'a pas de quoi remplir la modale');
    });
});

// ───────────────────────────── Le rendu de la modale ────────────────────────

describe('cmPlaces — la rangée de places', () => {
    const { cmPlaces } = chargerFonctions('equipes.js', ['cmPlaces']);

    const puces = html => ({
        prises: (html.match(/cm-seat is-taken/g) || []).length,
        total: (html.match(/class="cm-seat[ "]/g) || []).length
    });

    test('dessine une pastille par place, pleine jusqu\'au décompte', () => {
        assert.deepEqual(puces(cmPlaces(3, 5)), { prises: 3, total: 5 });
        assert.deepEqual(puces(cmPlaces(0, 5)), { prises: 0, total: 5 });
        assert.deepEqual(puces(cmPlaces(5, 5)), { prises: 5, total: 5 });
    });

    test('écrit le décompte en plus de le dessiner', () => {
        // Une forme seule ne dit rien à un lecteur d'écran, et la rangée de
        // pastilles est marquée aria-hidden justement parce que le texte la
        // double.
        assert.match(cmPlaces(3, 5), /3\/5/);
        assert.match(cmPlaces(3, 5), /2 places libres/);
        assert.match(cmPlaces(4, 5), /1 place libre/);
        assert.match(cmPlaces(5, 5), /complète/);
    });

    test('une équipe plus que pleine n\'affiche pas un nombre de places négatif', () => {
        // Le quota a pu baisser après coup ; la carte ne doit pas annoncer
        // « -1 place libre ».
        assert.match(cmPlaces(6, 5), /complète/);
        assert.equal(puces(cmPlaces(6, 5)).total, 5);
    });
});

describe('cmEchapper', () => {
    const { cmEchapper } = chargerFonctions('equipes.js', ['cmEchapper']);

    test('neutralise ce qu\'un nom de pool pourrait refermer', () => {
        assert.equal(cmEchapper('<script>alert(1)</script>'),
            '&lt;script&gt;alert(1)&lt;/script&gt;');
        assert.equal(cmEchapper('Pool d\'Andy'), 'Pool d&#39;Andy');
        assert.equal(cmEchapper('Tom & "Jerry"'), 'Tom &amp; &quot;Jerry&quot;');
    });

    test('un nom absent ne devient pas la chaîne « undefined »', () => {
        assert.equal(cmEchapper(null), '');
        assert.equal(cmEchapper(undefined), '');
    });
});
