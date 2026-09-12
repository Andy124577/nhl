'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { creerPresence } = require('../../services/presence.js');

/** Horloge et minuterie contrôlées : aucun test n'attend réellement. */
function bancDEssai() {
    let horloge = 1000;
    const minuteurs = new Map();
    let prochain = 1;

    const presence = creerPresence({
        maintenant: () => horloge,
        minuterie: (fonction, delai) => {
            const id = prochain++;
            minuteurs.set(id, { fonction, echeance: horloge + delai });
            return id;
        },
        annuler: (id) => minuteurs.delete(id)
    });

    return {
        presence,
        avancer(ms) { horloge += ms; },
        /** Déclenche les minuteurs échus, comme le ferait la boucle d'événements. */
        async declencher() {
            for (const [id, m] of [...minuteurs]) {
                if (m.echeance <= horloge) { minuteurs.delete(id); await m.fonction(); }
            }
        },
        get minuteursActifs() { return minuteurs.size; }
    };
}

test('plusieurs onglets appartiennent à une seule personne', () => {
    const { presence } = bancDEssai();
    presence.arrive('Salon', 'alice', 'socket-1');
    presence.arrive('Salon', 'alice', 'socket-2');
    presence.arrive('Salon', 'alice', 'socket-3');

    assert.equal(presence.part('Salon', 'alice', 'socket-2'), 2);
    assert.equal(presence.estPresent('Salon', 'alice'), true,
        'fermer un onglet sur trois ne fait sortir personne');

    presence.part('Salon', 'alice', 'socket-1');
    presence.part('Salon', 'alice', 'socket-3');
    assert.equal(presence.estPresent('Salon', 'alice'), true, 'le délai de grâce court encore');
});

test('une coupure brève n est pas un départ, une longue en est un', () => {
    const banc = bancDEssai();
    banc.presence.arrive('Salon', 'alice', 'socket-1');
    banc.presence.part('Salon', 'alice', 'socket-1');

    banc.avancer(30000);
    assert.equal(banc.presence.estPresent('Salon', 'alice'), true, 'un téléphone qui verrouille son écran');

    banc.avancer(40000); // total 70 s, au-delà de la grâce de 60 s
    assert.equal(banc.presence.estPresent('Salon', 'alice'), false);
});

test('une reconnexion efface l absence en cours', () => {
    const banc = bancDEssai();
    banc.presence.arrive('Salon', 'alice', 'socket-1');
    banc.presence.part('Salon', 'alice', 'socket-1');
    banc.avancer(50000);
    banc.presence.arrive('Salon', 'alice', 'socket-2');
    banc.avancer(50000);
    assert.equal(banc.presence.estPresent('Salon', 'alice'), true);
});

test('l état du salon distingue connecté, en attente de retour, et absent', () => {
    const banc = bancDEssai();
    banc.presence.arrive('Salon', 'alice', 'socket-1');
    banc.presence.arrive('Salon', 'bob', 'socket-2');
    banc.presence.part('Salon', 'bob', 'socket-2');
    banc.avancer(10000);

    const etat = banc.presence.etatSalon('Salon', ['alice', 'bob', 'carl']);
    assert.deepEqual(etat[0], { username: 'alice', connecte: true, enAttenteDeRetour: false, present: true });
    assert.deepEqual(etat[1], { username: 'bob', connecte: false, enAttenteDeRetour: true, present: true });
    assert.deepEqual(etat[2], { username: 'carl', connecte: false, enAttenteDeRetour: false, present: false });
});

test('« tout le monde est là » exige vraiment tout le monde', () => {
    const banc = bancDEssai();
    ['a', 'b', 'c'].forEach((u, i) => banc.presence.arrive('Salon', u, 'socket-' + i));
    assert.equal(banc.presence.tousPresents('Salon', ['a', 'b', 'c']), true);
    assert.equal(banc.presence.tousPresents('Salon', ['a', 'b', 'c', 'd']), false);
    assert.equal(banc.presence.tousPresents('Salon', []), false, 'un salon vide ne démarre pas');
});

test('le compte à rebours appartient au serveur et n exécute qu à son terme', async () => {
    const banc = bancDEssai();
    let demarrages = 0;

    const compte = banc.presence.lancerCompte('Salon', () => { demarrages++; });
    assert.equal(banc.presence.compteEnCours('Salon').resteMs, 10000);

    banc.avancer(5000);
    await banc.declencher();
    assert.equal(demarrages, 0);
    assert.equal(banc.presence.compteEnCours('Salon').resteMs, 5000);

    banc.avancer(5000);
    await banc.declencher();
    assert.equal(demarrages, 1);
    assert.equal(banc.presence.compteEnCours('Salon'), null);
    assert.ok(compte.finit > 0);
});

test('un départ annule le compte à rebours : on ne démarre pas à trois', async () => {
    const banc = bancDEssai();
    let demarrages = 0;
    banc.presence.lancerCompte('Salon', () => { demarrages++; });

    assert.equal(banc.presence.annulerCompte('Salon'), true);
    banc.avancer(20000);
    await banc.declencher();
    assert.equal(demarrages, 0);
    assert.equal(banc.presence.compteEnCours('Salon'), null);
    assert.equal(banc.presence.annulerCompte('Salon'), false, 'annuler deux fois ne casse rien');
});

test('relancer le compte à rebours remplace le précédent au lieu d en empiler deux', async () => {
    const banc = bancDEssai();
    let demarrages = 0;
    banc.presence.lancerCompte('Salon', () => { demarrages++; });
    banc.presence.lancerCompte('Salon', () => { demarrages++; });
    assert.equal(banc.minuteursActifs, 1);

    banc.avancer(10000);
    await banc.declencher();
    assert.equal(demarrages, 1);
});

test('oublier un salon efface présence et compte à rebours', async () => {
    const banc = bancDEssai();
    let demarrages = 0;
    banc.presence.arrive('Salon', 'alice', 'socket-1');
    banc.presence.lancerCompte('Salon', () => { demarrages++; });

    banc.presence.oublier('Salon');
    assert.equal(banc.presence.estPresent('Salon', 'alice'), false);

    banc.avancer(20000);
    await banc.declencher();
    assert.equal(demarrages, 0);
});

test('retirer une personne la sort du salon sans toucher aux autres', () => {
    const banc = bancDEssai();
    banc.presence.arrive('Salon', 'alice', 'socket-1');
    banc.presence.arrive('Salon', 'bob', 'socket-2');

    banc.presence.retirer('Salon', 'alice');
    assert.equal(banc.presence.estPresent('Salon', 'alice'), false);
    assert.equal(banc.presence.estPresent('Salon', 'bob'), true);
});

test('une personne inconnue du salon n y est jamais présente', () => {
    const { presence } = bancDEssai();
    assert.equal(presence.estPresent('Salon', 'fantome'), false);
    assert.equal(presence.part('Salon', 'fantome', 'socket-1'), 0);
});

test('deux salons ne se mélangent pas', () => {
    const banc = bancDEssai();
    banc.presence.arrive('Salon A', 'alice', 'socket-1');
    assert.equal(banc.presence.estPresent('Salon B', 'alice'), false);
});
