'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const priorite = require('../../lib/priority.js');

const el = (id, urgence, extra = {}) => priorite.element({ id, urgence, titre: id, ...extra });

test('un tour de repêchage passe devant tout le reste', () => {
    const { vedette } = priorite.classer([
        el('duel', priorite.URGENCE.DUEL),
        el('echange', priorite.URGENCE.ECHANGE),
        el('tour', priorite.URGENCE.VOTRE_TOUR),
        el('info', priorite.URGENCE.INFORMATION)
    ]);
    assert.equal(vedette.id, 'tour');
});

test('une offre en attente passe devant un duel, un duel devant un résultat', () => {
    const classement = priorite.classer([
        el('resultat', priorite.URGENCE.RESULTAT),
        el('duel', priorite.URGENCE.DUEL),
        el('echange', priorite.URGENCE.ECHANGE)
    ]);
    assert.deepEqual(
        [classement.vedette.id, ...classement.secondaires.map(s => s.id)],
        ['echange', 'duel', 'resultat']
    );
});

test('à urgence égale, l échéance la plus proche gagne', () => {
    const { vedette } = priorite.classer([
        el('tard', priorite.URGENCE.ECHANGE, { echeance: 5000 }),
        el('tot', priorite.URGENCE.ECHANGE, { echeance: 1000 })
    ]);
    assert.equal(vedette.id, 'tot');
});

test('une échéance réelle passe devant une absence d échéance, jamais l inverse', () => {
    // Le repêchage de Fantazy ne chronomètre personne : un tour n'a pas
    // d'échéance, et lui en inventer une pour trier serait un mensonge.
    const { vedette } = priorite.classer([
        el('sans', priorite.URGENCE.ECHANGE),
        el('avec', priorite.URGENCE.ECHANGE, { echeance: 9999 })
    ]);
    assert.equal(vedette.id, 'avec');
});

test('à échéance égale, le pool actif passe devant', () => {
    const { vedette } = priorite.classer([
        el('autre', priorite.URGENCE.DUEL, { pool: 'Autre' }),
        el('mien', priorite.URGENCE.DUEL, { pool: 'Ligue' })
    ], { poolActif: 'Ligue' });
    assert.equal(vedette.id, 'mien');
});

test('le classement est stable : deux appels ne peuvent pas inverser deux éléments', () => {
    const elements = [
        el('b', priorite.URGENCE.DUEL, { moment: 100 }),
        el('a', priorite.URGENCE.DUEL, { moment: 100 }),
        el('c', priorite.URGENCE.DUEL, { moment: 100 })
    ];
    const premier = priorite.classer(elements).secondaires.map(s => s.id);
    const second = priorite.classer([...elements].reverse()).secondaires.map(s => s.id);
    assert.deepEqual(premier, second, 'le bouton ne doit pas bouger sous le doigt');
});

test('le plus récent passe devant à urgence et échéance égales', () => {
    const { vedette } = priorite.classer([
        el('vieux', priorite.URGENCE.RESULTAT, { moment: 1000 }),
        el('neuf', priorite.URGENCE.RESULTAT, { moment: 2000 })
    ]);
    assert.equal(vedette.id, 'neuf');
});

test('la vedette reste stable tant qu aucun élément plus urgent n arrive', () => {
    const elements = [
        el('duelA', priorite.URGENCE.DUEL, { moment: 1000 }),
        el('duelB', priorite.URGENCE.DUEL, { moment: 2000 })
    ];
    // Sans mémoire, duelB gagne. Avec, celui qu'on affiche déjà reste.
    assert.equal(priorite.classer(elements).vedette.id, 'duelB');
    assert.equal(priorite.classer(elements, { vedettePrecedente: 'duelA' }).vedette.id, 'duelA');
});

test('un élément plus urgent déloge la vedette précédente', () => {
    const elements = [
        el('duelA', priorite.URGENCE.DUEL),
        el('tour', priorite.URGENCE.VOTRE_TOUR)
    ];
    assert.equal(priorite.classer(elements, { vedettePrecedente: 'duelA' }).vedette.id, 'tour');
});

test('une vedette précédente disparue ne bloque pas le classement', () => {
    const { vedette } = priorite.classer([el('duel', priorite.URGENCE.DUEL)], { vedettePrecedente: 'parti' });
    assert.equal(vedette.id, 'duel');
});

test('la vedette n apparaît jamais aussi en ligne secondaire', () => {
    const classement = priorite.classer([
        el('a', priorite.URGENCE.VOTRE_TOUR),
        el('b', priorite.URGENCE.DUEL),
        el('c', priorite.URGENCE.RESULTAT)
    ]);
    assert.equal(classement.vedette.id, 'a');
    assert.ok(!classement.secondaires.some(s => s.id === 'a'),
        'la même action affichée deux fois donne l impression de deux choses à faire');
});

test('au plus trois lignes secondaires, mais le total reste connu', () => {
    const elements = ['a', 'b', 'c', 'd', 'e', 'f']
        .map((id, i) => el(id, priorite.URGENCE.INFORMATION, { moment: 100 - i }));
    const classement = priorite.classer(elements);
    assert.equal(classement.secondaires.length, 3);
    assert.equal(classement.total, 6);
});

test('aucun élément donne une vedette nulle, pas un élément vide', () => {
    const classement = priorite.classer([]);
    assert.equal(classement.vedette, null);
    assert.deepEqual(classement.secondaires, []);
});

test('un élément ne reçoit pas d échéance qu on ne lui a pas donnée', () => {
    const sans = priorite.element({ id: 'x', urgence: 1, titre: 'x' });
    assert.equal(sans.echeance, null);
    const mauvaise = priorite.element({ id: 'y', urgence: 1, titre: 'y', echeance: 'bientôt' });
    assert.equal(mauvaise.echeance, null, 'une échéance illisible n en est pas une');
});

test('chaque état vide propose le geste qui lui correspond', () => {
    const sansPool = priorite.etatVide({ aDesPools: false });
    assert.equal(sansPool.cas, 'aucun_pool');
    assert.ok(sansPool.actions.some(a => a.href === 'repechage.html'));

    assert.equal(priorite.etatVide({ aDesPools: true, enAttente: true }).cas, 'salon_attente');
    assert.equal(priorite.etatVide({ aDesPools: true, horsSaison: true }).cas, 'hors_saison');
    assert.equal(priorite.etatVide({ aDesPools: true }).cas, 'rien_a_faire');
});

test('un élément porte son état : vide et en panne ne se disent pas pareil', () => {
    assert.equal(priorite.element({ id: 'a', urgence: 1, titre: 'a' }).etat, 'ok');
    assert.equal(priorite.element({ id: 'b', urgence: 1, titre: 'b', etat: 'indisponible' }).etat, 'indisponible');
});
