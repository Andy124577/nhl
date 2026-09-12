'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const evenements = require('../../lib/events.js');

test('une clé de déduplication ne dépend que de faits stables', () => {
    // Si une clé contenait l'heure courante, un réessai produirait une
    // deuxième ligne — donc une deuxième alerte pour le même fait.
    const premiere = evenements.clesActivite.choix(12, 7);
    const seconde = evenements.clesActivite.choix(12, 7);
    assert.equal(premiere, seconde);
    assert.notEqual(premiere, evenements.clesActivite.choix(12, 8));
    assert.notEqual(premiere, evenements.clesActivite.choix(13, 7));
});

test('au renversement du serpentin, les deux tours d une même équipe ont des clés différentes', () => {
    assert.notEqual(
        evenements.clesNotification.votreTour(3, 5),
        evenements.clesNotification.votreTour(3, 6)
    );
});

test('les clés d un échange distinguent la réception du résultat, et le résultat de son issue', () => {
    assert.notEqual(evenements.clesNotification.echangeRecu(42), evenements.clesNotification.echangeResultat(42, 'accepte'));
    assert.notEqual(
        evenements.clesNotification.echangeResultat(42, 'accepte'),
        evenements.clesNotification.echangeResultat(42, 'refuse')
    );
});

test('une révision de semaine produit une clé distincte de la précédente', () => {
    // Une correction officielle crée une révision de plus, jamais une deuxième
    // victoire : les deux doivent pouvoir coexister.
    assert.notEqual(
        evenements.clesActivite.semaineFinalisee(1, '20262027', 3, 1),
        evenements.clesActivite.semaineFinalisee(1, '20262027', 3, 2)
    );
});

test('une clé reste utilisable même quand un nom porte des espaces', () => {
    const cle = evenements.cle('turn', 'Équipe 1', 'Repêchage instantané #2');
    assert.ok(!cle.includes(' '));
    assert.ok(cle.length <= 200, 'la colonne de déduplication est bornée');
});

test('une clé très longue est tronquée sans déborder la colonne', () => {
    const cle = evenements.cle('type', 'x'.repeat(500), 'y'.repeat(500));
    assert.ok(cle.length <= 200);
});

test('chaque notification mène à une destination, et le pool y figure toujours', () => {
    const cas = [
        { type: evenements.NOTIFICATION.VOTRE_TOUR, poolName: 'Ligue', subject: {} },
        { type: evenements.NOTIFICATION.REPECHAGE_DEMARRE, poolName: 'Ligue', subject: {} },
        { type: evenements.NOTIFICATION.ECHANGE_RECU, poolName: 'Ligue', subject: { tradeId: 42 } },
        { type: evenements.NOTIFICATION.ECHANGE_RESULTAT, poolName: 'Ligue', subject: { tradeId: 42 } },
        { type: evenements.NOTIFICATION.NOUVELLE_SEMAINE, poolName: 'Ligue', subject: { weekNumber: 3 } }
    ];

    for (const notification of cas) {
        const cible = evenements.destination(notification);
        assert.equal(cible.pool, 'Ligue',
            'changer de pool doit se faire avant de viser un élément précis');
        assert.match(cible.page, /\.html$/);
        assert.match(evenements.urlDestination(notification), /[?&]pool=Ligue/);
    }
});

test('une offre reçue et son résultat ne mènent pas au même endroit', () => {
    const recue = evenements.urlDestination({
        type: evenements.NOTIFICATION.ECHANGE_RECU, poolName: 'L', subject: { tradeId: 7 }
    });
    const resultat = evenements.urlDestination({
        type: evenements.NOTIFICATION.ECHANGE_RESULTAT, poolName: 'L', subject: { tradeId: 7 }
    });
    assert.match(recue, /vue=recues/);
    assert.match(resultat, /vue=historique/);
    assert.match(recue, /tradeId=7/);
});

test('un type inconnu mène à l accueil plutôt qu à une page inventée', () => {
    const cible = evenements.destination({ type: 'inconnu', poolName: 'L' });
    assert.equal(cible.page, 'index.html');
    assert.equal(evenements.urlDestination(null), 'index.html');
});

test('une destination sans pool ne fabrique pas de paramètre vide', () => {
    const url = evenements.urlDestination({ type: evenements.NOTIFICATION.VOTRE_TOUR, poolName: null, subject: {} });
    assert.equal(url, 'draftActif.html');
});

test('une alerte de tour porte une durée de vie', () => {
    assert.ok(evenements.EXPIRATION_TOUR_MS > 0);
    assert.ok(evenements.EXPIRATION_TOUR_MS <= 48 * 60 * 60 * 1000,
        'la pastille ne doit pas réclamer une action qui n existe plus');
});
