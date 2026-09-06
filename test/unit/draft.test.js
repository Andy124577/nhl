'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { generateSnakeOrder, checkIfDraftComplete } = require('../../lib/draft.js');
const { makeTeam, makeFullTeam } = require('../fixtures/pool.js');

describe('generateSnakeOrder', () => {
    test('à deux équipes, l\'ordre alterne strictement', () => {
        // Le cas courant de l'application : deux équipes ne serpentent pas,
        // elles alternent — sinon la même équipe choisirait deux fois de suite
        // à chaque changement de tour.
        assert.deepEqual(generateSnakeOrder(['A', 'B'], 3), ['A', 'B', 'A', 'B', 'A', 'B']);
    });

    test('à trois équipes et plus, l\'ordre se renverse à chaque tour', () => {
        assert.deepEqual(
            generateSnakeOrder(['A', 'B', 'C'], 3),
            ['A', 'B', 'C', 'C', 'B', 'A', 'A', 'B', 'C']
        );
    });

    test('le premier tour suit l\'ordre reçu, le deuxième l\'inverse', () => {
        const ordre = generateSnakeOrder(['A', 'B', 'C', 'D'], 2);

        assert.deepEqual(ordre.slice(0, 4), ['A', 'B', 'C', 'D']);
        assert.deepEqual(ordre.slice(4), ['D', 'C', 'B', 'A']);
    });

    test('la longueur vaut toujours équipes × tours, dans les deux branches', () => {
        assert.equal(generateSnakeOrder(['A', 'B'], 15).length, 30);
        assert.equal(generateSnakeOrder(['A', 'B', 'C', 'D', 'E'], 13).length, 65);
    });

    test('zéro tour ne produit aucun choix', () => {
        assert.deepEqual(generateSnakeOrder(['A', 'B', 'C'], 0), []);
        assert.deepEqual(generateSnakeOrder(['A', 'B'], 0), []);
    });

    test('une seule équipe choisit à chaque tour', () => {
        assert.deepEqual(generateSnakeOrder(['A'], 3), ['A', 'A', 'A']);
    });

    test('aucune équipe ne produit aucun choix', () => {
        assert.deepEqual(generateSnakeOrder([], 5), []);
    });

    test('le tableau reçu n\'est jamais modifié', () => {
        // .reverse() travaille en place : appliqué à l'argument, il
        // réordonnerait la liste des équipes du repêchage en cours.
        const teams = ['A', 'B', 'C'];
        generateSnakeOrder(teams, 4);

        assert.deepEqual(teams, ['A', 'B', 'C']);
    });

    test('sans nombre de tours, la valeur par défaut est 15', () => {
        assert.equal(generateSnakeOrder(['A', 'B', 'C'], undefined).length, 45);
        assert.equal(generateSnakeOrder(['A', 'B', 'C']).length, 45);
    });
});

describe('checkIfDraftComplete', () => {
    /** Un clan de deux équipes pleines. */
    function clanComplet(over = {}) {
        return {
            teams: {
                Rouge: makeFullTeam('R'),
                Bleu: makeFullTeam('B', { members: ['b'] })
            },
            ...over
        };
    }

    test('toutes les équipes au quota : le repêchage est terminé', () => {
        assert.equal(checkIfDraftComplete(clanComplet()), true);
    });

    // Une case en moins dans chacune des cinq positions.
    const manques = [
        ['attaquant', 'offensive'],
        ['défenseur', 'defensive'],
        ['recrue', 'rookie'],
        ['gardien', 'goalie'],
        ['équipe LNH', 'teams']
    ];
    for (const [libelle, cle] of manques) {
        test(`un ${libelle} manquant laisse le repêchage ouvert`, () => {
            const clan = clanComplet();
            clan.teams.Bleu[cle] = clan.teams.Bleu[cle].slice(0, -1);

            assert.equal(checkIfDraftComplete(clan), false);
        });
    }

    test('sans équipe active, le repêchage n\'est pas terminé', () => {
        const clan = { teams: {} };

        assert.equal(checkIfDraftComplete(clan), false);
    });

    test('une équipe sans membre est ignorée, même vide', () => {
        const clan = clanComplet();
        clan.teams.Fantome = makeTeam({ members: [] });

        assert.equal(checkIfDraftComplete(clan), true);
    });

    test('sans configuration, le quota par défaut 6/4/1/1/1 s\'applique', () => {
        // Les pools créés avant l'ajout de `config` n'en ont pas.
        const clan = clanComplet();
        assert.equal(clan.config, undefined);

        assert.equal(checkIfDraftComplete(clan), true);
    });

    test('une configuration sur mesure est respectée', () => {
        const clan = {
            config: { numOffensive: 1, numDefensive: 1, numGoalies: 1, numRookies: 0, numTeams: 0 },
            teams: {
                Rouge: makeTeam({ offensive: ['a'], defensive: ['b'], goalie: ['g'], rookie: [], teams: [] })
            }
        };

        assert.equal(checkIfDraftComplete(clan), true);
    });

    test('une case absente vaut « pas terminé » plutôt qu\'une erreur', () => {
        // rookie / goalie / teams sont lus avec ?. — de vieux rosters n'ont
        // pas ces tableaux du tout.
        const clan = clanComplet();
        delete clan.teams.Bleu.rookie;
        delete clan.teams.Bleu.goalie;
        delete clan.teams.Bleu.teams;

        assert.doesNotThrow(() => checkIfDraftComplete(clan));
        assert.equal(checkIfDraftComplete(clan), false);
    });

    test('une équipe AU-DESSUS du quota compte comme non terminée', () => {
        // La comparaison est une égalité stricte : un joueur de trop — un
        // échange mal appliqué, par exemple — laisse le repêchage ouvert.
        const clan = clanComplet();
        clan.teams.Bleu.offensive.push('B-att7');

        assert.equal(checkIfDraftComplete(clan), false);
    });

    test('une seule équipe incomplète suffit à bloquer tout le monde', () => {
        const clan = clanComplet();
        clan.teams.Vert = makeTeam({ members: ['c'] });

        assert.equal(checkIfDraftComplete(clan), false);
    });
});
