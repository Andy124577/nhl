'use strict';

const { test, describe, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
    teamHasPlayer, invalidateConflictingTrades, removeFromTeam, addToTeam, getPositionLabel
} = require('../../lib/trades.js');
const { makeTeam } = require('../fixtures/pool.js');

afterEach(() => { mock.restoreAll(); });

/** Un article d'échange tel que les routes le construisent. */
function item(over = {}) {
    return { name: 'McDavid', type: 'offensive', ...over };
}

describe('teamHasPlayer', () => {
    test('trouve le joueur dans la case correspondant à son type', () => {
        assert.equal(teamHasPlayer(makeTeam({ offensive: ['McDavid'] }), item()), true);
        assert.equal(teamHasPlayer(makeTeam({ defensive: ['Makar'] }), item({ name: 'Makar', type: 'defensive' })), true);
        assert.equal(teamHasPlayer(makeTeam({ goalie: ['Price'] }), item({ name: 'Price', type: 'goalie' })), true);
        assert.equal(teamHasPlayer(makeTeam({ rookie: ['Celebrini'] }), item({ name: 'Celebrini', type: 'rookie' })), true);
    });

    test('le type « team » vise la case `teams`', () => {
        // La seule correspondance qui n'est pas l'identité : toutes les autres
        // portent le nom de leur tableau, celle-ci non.
        const equipe = makeTeam({ teams: ['Montréal Canadiens'] });

        assert.equal(teamHasPlayer(equipe, item({ name: 'Montréal Canadiens', type: 'team' })), true);
    });

    test('ne regarde pas les autres cases', () => {
        const equipe = makeTeam({ defensive: ['McDavid'] });

        assert.equal(teamHasPlayer(equipe, item({ type: 'offensive' })), false);
    });

    test('reconnaît une entrée en objet patineur, gardien ou club', () => {
        assert.equal(teamHasPlayer(makeTeam({ offensive: [{ skaterFullName: 'McDavid' }] }), item()), true);
        assert.equal(
            teamHasPlayer(makeTeam({ goalie: [{ goalieFullName: 'Price' }] }), item({ name: 'Price', type: 'goalie' })),
            true
        );
        assert.equal(
            teamHasPlayer(makeTeam({ teams: [{ teamFullName: 'Boston Bruins' }] }), item({ name: 'Boston Bruins', type: 'team' })),
            true
        );
    });

    test('un joueur absent rend faux', () => {
        assert.equal(teamHasPlayer(makeTeam({ offensive: ['Crosby'] }), item()), false);
    });

    test('une case absente rend faux sans lever d\'erreur', () => {
        const equipe = makeTeam();
        delete equipe.offensive;

        assert.doesNotThrow(() => teamHasPlayer(equipe, item()));
        assert.equal(teamHasPlayer(equipe, item()), false);
    });

    test('un type inconnu rend faux', () => {
        assert.equal(teamHasPlayer(makeTeam({ offensive: ['McDavid'] }), item({ type: 'mascotte' })), false);
    });
});

describe('removeFromTeam', () => {
    test('retire exactement une entrée et laisse les autres dans l\'ordre', () => {
        const equipe = makeTeam({ offensive: ['A', 'McDavid', 'B'] });
        removeFromTeam(equipe, item());

        assert.deepEqual(equipe.offensive, ['A', 'B']);
    });

    test('ne retire qu\'une seule occurrence', () => {
        const equipe = makeTeam({ offensive: ['McDavid', 'McDavid'] });
        removeFromTeam(equipe, item());

        assert.deepEqual(equipe.offensive, ['McDavid']);
    });

    test('un joueur absent laisse la case intacte', () => {
        const equipe = makeTeam({ offensive: ['A', 'B'] });
        removeFromTeam(equipe, item());

        assert.deepEqual(equipe.offensive, ['A', 'B']);
    });

    test('une case absente ne lève pas d\'erreur', () => {
        const equipe = makeTeam();
        delete equipe.offensive;

        assert.doesNotThrow(() => removeFromTeam(equipe, item()));
    });

    test('ne touche pas à un homonyme rangé dans une autre case', () => {
        const equipe = makeTeam({ offensive: ['McDavid'], defensive: ['McDavid'] });
        removeFromTeam(equipe, item({ type: 'offensive' }));

        assert.deepEqual(equipe.offensive, []);
        assert.deepEqual(equipe.defensive, ['McDavid']);
    });

    test('retire une entrée en objet', () => {
        const equipe = makeTeam({ offensive: [{ skaterFullName: 'McDavid', points: 100 }] });
        removeFromTeam(equipe, item());

        assert.deepEqual(equipe.offensive, []);
    });
});

describe('addToTeam', () => {
    test('ajoute la fiche complète quand elle est fournie', () => {
        // Le but est de conserver les statistiques : dégrader la fiche en
        // simple chaîne perdrait tout ce que la page affiche.
        const equipe = makeTeam();
        const fiche = { skaterFullName: 'McDavid', points: 132, playerId: 8478402 };
        addToTeam(equipe, item({ playerData: fiche }));

        assert.deepEqual(equipe.offensive, [fiche]);
        assert.equal(equipe.offensive[0].points, 132);
    });

    test('retombe sur le nom quand il n\'y a pas de fiche', () => {
        const equipe = makeTeam();
        addToTeam(equipe, item({ name: 'Boston Bruins', type: 'team' }));

        assert.deepEqual(equipe.teams, ['Boston Bruins']);
    });

    test('crée la case si l\'équipe n\'en a pas', () => {
        const equipe = makeTeam();
        delete equipe.rookie;
        addToTeam(equipe, item({ name: 'Celebrini', type: 'rookie' }));

        assert.deepEqual(equipe.rookie, ['Celebrini']);
    });

    test('ajoute à la fin, sans toucher aux entrées existantes', () => {
        const equipe = makeTeam({ offensive: ['A'] });
        addToTeam(equipe, item());

        assert.deepEqual(equipe.offensive, ['A', 'McDavid']);
    });
});

describe('retrait puis ajout (aller-retour d\'un échange)', () => {
    test('le nombre total de joueurs est conservé et la fiche change de camp', () => {
        const fiche = { skaterFullName: 'McDavid', points: 132 };
        const rouge = makeTeam({ offensive: [fiche, { skaterFullName: 'Autre' }] });
        const bleu = makeTeam({ offensive: [{ skaterFullName: 'Troisieme' }] });
        const avant = rouge.offensive.length + bleu.offensive.length;

        const article = item({ playerData: fiche });
        removeFromTeam(rouge, article);
        addToTeam(bleu, article);

        assert.equal(rouge.offensive.length + bleu.offensive.length, avant);
        assert.equal(teamHasPlayer(rouge, article), false);
        assert.equal(teamHasPlayer(bleu, article), true);
        assert.equal(bleu.offensive.at(-1), fiche, 'la même fiche, pas une copie');
    });
});

describe('invalidateConflictingTrades', () => {
    /** Une proposition d'échange en attente. */
    function trade(id, over = {}) {
        return {
            id,
            draftName: 'PoolA',
            offering: [{ name: 'McDavid', type: 'offensive' }],
            receiving: [{ name: 'Makar', type: 'defensive' }],
            ...over
        };
    }

    test('annule les propositions qui portent sur un joueur échangé', () => {
        mock.method(console, 'log', () => {});
        const trades = { pending: [trade(1), trade(2, { offering: [{ name: 'Crosby' }], receiving: [{ name: 'Autre' }] })] };
        const accepte = trade(9);

        const n = invalidateConflictingTrades(trades, accepte, {});

        assert.equal(n, 1);
        assert.deepEqual(trades.pending.map(t => t.id), [2]);
    });

    test('le conflit compte des deux côtés de la proposition', () => {
        mock.method(console, 'log', () => {});
        const cote1 = trade(1, { offering: [{ name: 'McDavid' }], receiving: [{ name: 'X' }] });
        const cote2 = trade(2, { offering: [{ name: 'Y' }], receiving: [{ name: 'Makar' }] });
        const trades = { pending: [cote1, cote2] };

        assert.equal(invalidateConflictingTrades(trades, trade(9), {}), 2);
        assert.deepEqual(trades.pending, []);
    });

    test('les propositions d\'un AUTRE pool ne sont pas touchées', () => {
        // Le garde-fou qui empêche l'échange d'un pool d'annuler celui du
        // voisin — deux pools peuvent très bien contenir le même joueur.
        const autrePool = trade(2, { draftName: 'PoolB' });
        const trades = { pending: [autrePool] };

        assert.equal(invalidateConflictingTrades(trades, trade(9), {}), 0);
        assert.deepEqual(trades.pending.map(t => t.id), [2]);
    });

    test('sans proposition en attente, il n\'y a rien à annuler', () => {
        assert.equal(invalidateConflictingTrades({ pending: [] }, trade(9), {}), 0);
        assert.equal(invalidateConflictingTrades({}, trade(9), {}), 0);
        assert.equal(invalidateConflictingTrades({ pending: null }, trade(9), {}), 0);
    });

    test('sans joueur commun, rien n\'est retiré', () => {
        const sansRapport = trade(2, { offering: [{ name: 'Crosby' }], receiving: [{ name: 'Hughes' }] });
        const trades = { pending: [sansRapport] };

        assert.equal(invalidateConflictingTrades(trades, trade(9), {}), 0);
        assert.equal(trades.pending.length, 1);
    });

    test('la proposition acceptée est elle-même annulée si elle est encore en attente', () => {
        mock.method(console, 'log', () => {});
        const accepte = trade(1);
        const trades = { pending: [accepte] };

        assert.equal(invalidateConflictingTrades(trades, accepte, {}), 1);
        assert.deepEqual(trades.pending, []);
    });
});

describe('getPositionLabel', () => {
    test('traduit les cinq types connus', () => {
        assert.equal(getPositionLabel('offensive'), 'Attaquant');
        assert.equal(getPositionLabel('defensive'), 'Défenseur');
        assert.equal(getPositionLabel('goalie'), 'Gardien');
        assert.equal(getPositionLabel('rookie'), 'Rookie');
        assert.equal(getPositionLabel('team'), 'Équipe NHL');
    });

    test('laisse passer un type inconnu tel quel', () => {
        assert.equal(getPositionLabel('mascotte'), 'mascotte');
        assert.equal(getPositionLabel(''), '');
        assert.equal(getPositionLabel(undefined), undefined);
    });
});
