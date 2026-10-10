/**
 * lib/feuillesJoueurs.js : une requête par joueur, et un match inchangé n'est
 * pas réécrit. Le comportement réel d'ON CONFLICT … WHERE est vérifié contre
 * PostgreSQL dans test/pg/feuilles-joueurs.test.js.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { COLONNES, requeteFeuilles, enregistrerFeuilles, sansDoublons } = require('../../lib/feuillesJoueurs.js');

function ligne(gameId, buts = 0) {
    const valeurs = COLONNES.map(() => 0);
    valeurs[COLONNES.indexOf('player_id')] = 8478402;
    valeurs[COLONNES.indexOf('game_id')] = gameId;
    valeurs[COLONNES.indexOf('goals')] = buts;
    return valeurs;
}

describe('feuilles de match des joueurs', () => {
    test('29 colonnes, la clé comprise', () => {
        assert.equal(COLONNES.length, 29);
        assert.ok(COLONNES.includes('player_id') && COLONNES.includes('game_id'));
    });

    test('toutes les lignes en une requête, paramètres numérotés à la suite', () => {
        const { text, values } = requeteFeuilles([ligne(1), ligne(2), ligne(3)], ['goals', 'assists']);
        assert.equal(values.length, 3 * 29);
        assert.match(text, /\(\$1, \$2, .*\$29, NOW\(\)\)/);
        assert.match(text, /\(\$59, .*\$87, NOW\(\)\)/);
        assert.equal((text.match(/NOW\(\)\)/g) || []).length, 3);
    });

    test('un match connu n’est réécrit que si une colonne mise à jour change', () => {
        const { text } = requeteFeuilles([ligne(1)], ['goals', 'assists']);
        assert.match(text, /ON CONFLICT \(player_id, game_id\) DO UPDATE SET goals = EXCLUDED\.goals, assists = EXCLUDED\.assists, last_updated = NOW\(\)/);
        assert.match(text, /WHERE \(player_game_logs\.goals, player_game_logs\.assists\) IS DISTINCT FROM \(EXCLUDED\.goals, EXCLUDED\.assists\)/);
    });

    test('un match en double : le dernier gagne, une seule fois dans la requête', () => {
        const uniques = sansDoublons([ligne(1, 0), ligne(2), ligne(1, 2)]);
        assert.equal(uniques.length, 2);
        assert.equal(uniques.find(l => l[COLONNES.indexOf('game_id')] === 1)[COLONNES.indexOf('goals')], 2);
        assert.equal(requeteFeuilles([ligne(1), ligne(1)], ['goals']).values.length, 29);
    });

    test('rien à écrire : pas de requête', async () => {
        assert.equal(requeteFeuilles([], ['goals']), null);
        assert.equal(requeteFeuilles(undefined, ['goals']), null);
        let appels = 0;
        assert.equal(await enregistrerFeuilles(async () => { appels += 1; }, [], ['goals']), 0);
        assert.equal(appels, 0);
    });

    test('refuse une colonne inconnue, la clé, ou aucune colonne', () => {
        assert.throws(() => requeteFeuilles([ligne(1)], ['goals; DROP TABLE x']), /invalide/);
        assert.throws(() => requeteFeuilles([ligne(1)], ['game_id']), /invalide/);
        assert.throws(() => requeteFeuilles([ligne(1)], ['player_id']), /invalide/);
        assert.throws(() => requeteFeuilles([ligne(1)], []), /Aucune colonne/);
    });

    test('refuse une ligne qui n’a pas 29 valeurs', () => {
        assert.throws(() => requeteFeuilles([[1, 2, 3, 4, 5]], ['goals']), /29 attendues/);
    });

    test('renvoie le nombre de matchs réellement écrits', async () => {
        const recus = [];
        const ecrits = await enregistrerFeuilles(async (texte, valeurs) => {
            recus.push({ texte, valeurs });
            return { command: 'INSERT', rowCount: 1 };
        }, [ligne(1), ligne(2)], ['goals']);
        assert.equal(ecrits, 1);
        assert.equal(recus.length, 1, 'une seule requête');
        assert.equal(recus[0].valeurs.length, 58);

        assert.equal(await enregistrerFeuilles(async () => ({ command: 'INSERT', rowCount: 0 }), [ligne(1)], ['goals']), 0);
        assert.equal(await enregistrerFeuilles(async () => undefined, [ligne(1)], ['goals']), 0);
    });
});
