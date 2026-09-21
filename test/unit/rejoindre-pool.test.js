/**
 * Le bouton « Rejoindre » de la page rejoindre-pool.html.
 *
 * Il a été mort un temps, sans rien dire : joinClan lisait les alignements
 * dans /draft, or /draft ne renvoie plus qu'un résumé de découverte pour les
 * pools qu'on n'a pas rejoints. `teams` y étant absent,
 * Object.entries(undefined) levait une exception que le catch avalait dans la
 * console — un clic, et rien.
 *
 * Deux moitiés du contrat sont épinglées ici, parce qu'une seule ne protège
 * de rien : ce que le serveur refuse de dire, et la route que le client
 * interroge à la place.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const authz = require('../../lib/authz.js');
const { chargerFonctions } = require('../fixtures/helpers.js');

const POOL = {
    poolMode: 'cumulative',
    maxPlayers: 10,
    teams: {
        'Équipe 1': { members: ['alice'], teams: [] },
        'Équipe 2': { members: [], teams: [] }
    }
};

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
