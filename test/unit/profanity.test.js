'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { contientGrossierete, verifierNom, normaliser } = require('../../profanity.js');

describe('normaliser', () => {
    test('met en minuscules et retire les accents', () => {
        assert.equal(normaliser('ÉTÉ Français'), 'ete francais');
    });

    test('défait les substitutions de chiffres et de symboles', () => {
        assert.equal(normaliser('C0nn@rd'), 'connard');
        assert.equal(normaliser('5h1t'), 'shit');
        assert.equal(normaliser('b8'), 'bb');
    });

    test('les séparateurs deviennent des espaces mais ne disparaissent pas', () => {
        // La recherche par mot entier en dépend : « con » collé à « cours »
        // n'est pas le même mot que « con » isolé.
        assert.equal(normaliser('f.u.c.k'), 'f u c k');
        assert.equal(normaliser('les--requins'), 'les requins');
    });

    test('rogne les bords', () => {
        assert.equal(normaliser('  Rouge  '), 'rouge');
    });

    test('une entrée vide ou absente rend une chaîne vide', () => {
        assert.equal(normaliser(''), '');
        assert.equal(normaliser(null), '');
        assert.equal(normaliser(undefined), '');
        assert.equal(normaliser('222'), '');
    });

    test('les chiffres qui remplacent une lettre survivent à la normalisation', () => {
        // « 1 » et « 3 » sont des substitutions (i, e) : ils deviennent des
        // lettres AVANT que le reste soit balayé. Seuls les chiffres sans
        // équivalent — ici « 2 » — disparaissent.
        assert.equal(normaliser('123'), 'i e');
    });
});

describe('contientGrossierete', () => {
    test('repère un terme de la liste des mots entiers', () => {
        assert.equal(contientGrossierete('Les Cons'), true);
        assert.equal(contientGrossierete('le cul du monde'), true);
        assert.equal(contientGrossierete('Nique la'), true);
        assert.equal(contientGrossierete('PD'), true);
    });

    test('repère un terme partiel même collé à autre chose', () => {
        assert.equal(contientGrossierete('Wankers United'), true);
        assert.equal(contientGrossierete('Les Fuckers'), true);
    });

    test('résiste aux contournements ordinaires', () => {
        assert.equal(contientGrossierete('C0nn@rd'), true, 'chiffres et symboles');
        assert.equal(contientGrossierete('f.u.c.k'), true, 'séparateurs intercalés');
        assert.equal(contientGrossierete('MEEERDE'), true, 'lettres répétées');
        assert.equal(contientGrossierete('conard'), true, 'orthographe compactée');
    });

    test('repère les sacres québécois', () => {
        assert.equal(contientGrossierete('tabarnak'), true);
        assert.equal(contientGrossierete('Les Calisses'), true);
    });

    test('laisse passer les mots innocents qui CONTIENNENT un terme court', () => {
        // C'est toute la raison d'être de la liste « mots entiers » : en
        // sous-chaîne, ces termes frapperaient des noms parfaitement anodins.
        // Si un jour l'un d'eux passe côté partiel, ce test tombe.
        for (const nom of ['Concours du Nord', 'Le Calcul', 'Arbitre en chef', 'Technique Pure',
            'Dispute Amicale', 'Classe Affaires', 'Cocktail Molotov', 'Assomption', 'pdg']) {
            assert.equal(contientGrossierete(nom), false, `« ${nom} » refusé à tort`);
        }
    });

    test('laisse passer des noms d\'équipe ordinaires', () => {
        for (const nom of ['Les Requins de Laval', 'Les Canadiens', 'Le Grand Bleu',
            'Éric le Rouge', 'Passe-partout', 'Nazem Kadri']) {
            assert.equal(contientGrossierete(nom), false, `« ${nom} » refusé à tort`);
        }
    });

    test('une entrée vide n\'est pas une grossièreté', () => {
        assert.equal(contientGrossierete(''), false);
        assert.equal(contientGrossierete(null), false);
        assert.equal(contientGrossierete(undefined), false);
        assert.equal(contientGrossierete('   '), false);
    });

    test('la casse n\'a aucune importance', () => {
        assert.equal(contientGrossierete('MERDE'), true);
        assert.equal(contientGrossierete('MeRdE'), true);
    });
});

describe('verifierNom', () => {
    test('un nom propre passe, sans message', () => {
        assert.deepEqual(verifierNom('Les Canadiens', 'Ce nom d\'équipe'), { ok: true });
    });

    test('un nom fautif est refusé avec le libellé fourni', () => {
        const r = verifierNom('Les Cons', 'Ce nom de pool');

        assert.equal(r.ok, false);
        assert.match(r.message, /^Ce nom de pool contient un terme inapproprié/);
    });

    test('sans libellé, le message retombe sur « Ce nom »', () => {
        const r = verifierNom('merde');

        assert.equal(r.ok, false);
        assert.match(r.message, /^Ce nom contient un terme inapproprié/);
    });

    test('le message invite à en choisir un autre', () => {
        assert.match(verifierNom('merde').message, /Choisissez-en un autre\.$/);
    });
});
