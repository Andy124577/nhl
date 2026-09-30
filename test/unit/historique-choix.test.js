'use strict';

/**
 * Renommer une équipe pendant le repêchage ne doit pas faire croire à la salle
 * que les tours ont été sautés.
 *
 * La bande des choix (draftPickCards.js, buildPickSlots) associe chaque choix
 * de `picksHistory` à sa place dans `draftOrder` par le nom de l'équipe. Le
 * renommage changeait l'ordre sans l'historique : le premier choix de l'équipe
 * renommée ne trouvait plus sa place, et comme la bande avance dans
 * l'historique avec un curseur, TOUS les tours suivants s'affichaient
 * « Tour sauté ».
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const poolOps = require('../../lib/poolOps.js');
const routesPools = require('../../routes/pools.js');
const routesRepechage = require('../../routes/draft.js');
const { monterRoutes, poolNeuf } = require('../fixtures/routeHarness.js');

/** La vraie logique de la bande, chargée telle que le navigateur la reçoit. */
function chargerBande() {
    const contexte = {};
    vm.createContext(contexte);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../draftPickCards.js'), 'utf8'), contexte);
    return contexte.buildPickSlots;
}
const buildPickSlots = chargerBande();

// Array.from : un tableau né dans le contexte vm a son propre prototype, que
// deepStrictEqual refuserait même à contenu égal.
const bande = (data) => Array.from(buildPickSlots(data.draftOrder, data.picksHistory || [], data.currentPickIndex))
    .slice(0, data.currentPickIndex)
    .map(t => (t.etat === 'done' ? t.pick.player : t.etat));

const ALICE = { username: 'alice', userId: 'alice', isAdmin: false };
const BOB = { username: 'bob', userId: 'bob', isAdmin: false };
const CARL = { username: 'carl', userId: 'carl', isAdmin: false };

/** Un repêchage à trois équipes, parti, avec trois choix déjà faits. */
async function repechageEntame() {
    const h = monterRoutes([routesPools, routesRepechage], {
        pools: { Ligue: poolNeuf({
            nbEquipes: 3,
            membres: { 'Équipe 1': ['alice'], 'Équipe 2': ['bob'], 'Équipe 3': ['carl'] },
            config: { numOffensive: 1, numDefensive: 1, numGoalies: 0, numRookies: 0, numTeams: 0 }
        }) }
    });
    await h.appeler('POST', '/start-draft', { auth: ALICE, body: { clanName: 'Ligue' } });
    for (const [indice, qui] of [[0, ALICE], [1, BOB], [2, CARL]]) {
        const res = await h.appeler('POST', '/pick-player', {
            auth: qui, body: { clanName: 'Ligue', playerName: `Joueur ${indice}`, position: 'offensive', expectedPickIndex: indice }
        });
        assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    }
    return h;
}

test('renommer son équipe en plein repêchage garde chaque choix à sa place', async () => {
    const h = await repechageEntame();
    assert.deepEqual(bande(h.lirePool('Ligue')), ['Joueur 0', 'Joueur 1', 'Joueur 2']);

    const res = await h.appeler('POST', '/rename-team', {
        auth: ALICE, body: { clanName: 'Ligue', oldTeamName: 'Équipe 1', newTeamName: 'Les Castors' }
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const data = h.lirePool('Ligue');
    assert.equal(data.picksHistory[0].team, 'Les Castors', 'l’historique suit le nouveau nom');
    assert.deepEqual(bande(data), ['Joueur 0', 'Joueur 1', 'Joueur 2'], 'aucun « Tour sauté »');

    // Et le repêchage continue normalement : Carl rejoue au renversement.
    const suite = await h.appeler('POST', '/pick-player', {
        auth: CARL, body: { clanName: 'Ligue', playerName: 'Joueur 3', position: 'defensive', expectedPickIndex: 3 }
    });
    assert.equal(suite.statusCode, 200);
    assert.deepEqual(bande(h.lirePool('Ligue')), ['Joueur 0', 'Joueur 1', 'Joueur 2', 'Joueur 3']);
});

test('un pool abîmé par l’ancien renommage retrouve ses choix', async () => {
    const h = await repechageEntame();
    const data = h.lirePool('Ligue');

    // Ce que faisait l'ancien renommage : l'équipe et l'ordre changent, pas l'historique.
    data.teams['Les Castors'] = data.teams['Équipe 1'];
    delete data.teams['Équipe 1'];
    data.draftOrder = data.draftOrder.map(t => (t === 'Équipe 1' ? 'Les Castors' : t));
    assert.deepEqual(bande(data), ['skipped', 'skipped', 'skipped'],
        'le symptôme : un seul nom périmé, et tous les tours suivants paraissent sautés');

    assert.deepEqual(poolOps.choixDesalignes(data).map(d => [d.choix.player, d.equipe]), [['Joueur 0', 'Les Castors']]);
    assert.equal(data.picksHistory[0].team, 'Équipe 1', 'choixDesalignes ne modifie rien');

    assert.equal(poolOps.alignerHistoriqueChoix(data), 1);
    assert.deepEqual(bande(data), ['Joueur 0', 'Joueur 1', 'Joueur 2']);
    assert.equal(poolOps.alignerHistoriqueChoix(data), 0, 'une deuxième passe ne trouve plus rien');
});

test('la réparation ne touche que ce qu’elle peut prouver', () => {
    const data = {
        draftOrder: ['A', 'B', 'A', 'B'],
        currentPickIndex: 4,
        teams: { A: { members: ['alice'] }, B: { members: ['bob'] }, C: { members: ['carl'] } },
        picksHistory: [
            { team: 'Ancien', player: 'Joueur 0' },                 // sans pickIndex : on ne sait pas
            { team: 'C', player: 'Joueur 1', pickIndex: 1 },        // C existe encore : pas un nom périmé
            { team: 'A', player: 'Joueur 2', pickIndex: 2 },        // déjà juste
            { team: 'Parti', player: 'Joueur 3', pickIndex: 9 }     // hors de l'ordre
        ]
    };
    assert.deepEqual(poolOps.choixDesalignes(data), []);
    assert.equal(poolOps.alignerHistoriqueChoix(data), 0);
    assert.deepEqual(data.picksHistory.map(c => c.team), ['Ancien', 'C', 'A', 'Parti']);

    assert.deepEqual(poolOps.choixDesalignes({}), []);
    assert.deepEqual(poolOps.choixDesalignes({ draftOrder: ['A'] }), []);
    assert.deepEqual(poolOps.choixDesalignes(null), []);
});

test('un vrai tour sauté reste affiché comme tel', () => {
    // L'équipe B était complète : son tour 1 n'a laissé aucune entrée.
    const data = {
        draftOrder: ['A', 'B', 'A'],
        currentPickIndex: 3,
        teams: { A: { members: ['alice'] }, B: { members: ['bob'] } },
        picksHistory: [
            { team: 'A', player: 'Joueur 0', pickIndex: 0 },
            { team: 'A', player: 'Joueur 2', pickIndex: 2 }
        ]
    };
    assert.equal(poolOps.alignerHistoriqueChoix(data), 0);
    assert.deepEqual(bande(data), ['Joueur 0', 'skipped', 'Joueur 2']);
});
