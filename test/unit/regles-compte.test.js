'use strict';

/**
 * Les règles d'un compte (lib/reglesCompte.js).
 *
 * `/signup` ne vérifiait que la longueur du nom : un appel direct créait un
 * compte dont le nom portait du HTML. Et la limite de 72 du mot de passe se
 * comptait en caractères alors que bcrypt compte en octets.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const regles = require('../../lib/reglesCompte.js');

test('un nom porteur de HTML, d espaces ou de ponctuation est refusé', () => {
    for (const nom of ['<img src=x onerror=alert(1)>', 'pas bon', 'jean-luc', "o'neil", 'é_accent', 'ab', 'a'.repeat(21)]) {
        assert.ok(regles.erreurNom(nom), `« ${nom} » aurait dû être refusé`);
    }
    for (const nom of ['abc', 'Mum33', 'binner_12', 'A'.repeat(20)]) {
        assert.equal(regles.erreurNom(nom), null, `« ${nom} » aurait dû passer`);
    }
});

test('la limite de 72 se compte en octets : 40 lettres accentuées sont refusées', () => {
    const accentue = 'é'.repeat(40);
    assert.equal(accentue.length, 40);
    assert.equal(Buffer.byteLength(accentue), 80);
    assert.match(regles.erreurMotDePasse(accentue), /72 octets/);
    assert.equal(regles.erreurMotDePasse('Zq8!' + 'x'.repeat(68)), null, '72 octets tout juste');
});

test('un mot de passe trop court, courant ou égal au nom est refusé', () => {
    assert.match(regles.erreurMotDePasse('k7!q'), /au moins 6/);
    assert.match(regles.erreurMotDePasse('Bilbo42', { username: 'bilbo42' }), /nom d'utilisateur/);
    for (const courant of ['123456', 'password', 'Azerty', 'HOCKEY', 'Canadiens', 'motdepasse', 'aaaaaaa', '9999999']) {
        assert.match(regles.erreurMotDePasse(courant), /trop courant/, courant);
    }
    assert.equal(regles.erreurMotDePasse('Rondelle-Bleue-27'), null);
    assert.ok(regles.erreurMotDePasse(123456), 'un nombre n est pas un mot de passe');
    assert.ok(regles.erreurMotDePasse(''));
});

test('les comparaisons ignorent la casse et les accents', () => {
    assert.equal(regles.estCourant('HÔCKEY'), true);
    assert.equal(regles.estCourant('Montréal'), true);
    assert.equal(regles.estCourant('Bonhomme7'), false);
});
