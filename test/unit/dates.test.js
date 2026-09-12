'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const dates = require('../../lib/dates.js');

// 2026 : changement d'heure le 8 mars (printemps) et le 1er novembre (automne).
const PRINTEMPS = '2026-03-08';
const AUTOMNE = '2026-11-01';

test('la journée du pool est celle de Toronto, pas celle du serveur', () => {
    // Un match commencé à 22 h à Montréal se termine après minuit UTC. La
    // journée du pool reste celle de la soirée qu'on vient de regarder.
    assert.equal(dates.journeeLocale('2026-11-05T03:30:00Z'), '2026-11-04');
    assert.equal(dates.journeeLocale('2026-11-05T04:30:00Z'), '2026-11-04');
    assert.equal(dates.journeeLocale('2026-11-05T05:30:00Z'), '2026-11-05');
});

test('une semaine est semi-ouverte : chaque journée appartient à exactement une semaine', () => {
    const semaine = dates.semaineDe('2026-11-04');
    assert.equal(semaine.debut, '2026-11-02');
    assert.equal(semaine.fin, '2026-11-09');
    assert.equal(semaine.dernierJour, '2026-11-08');

    assert.equal(dates.dansIntervalle('2026-11-02', semaine.debut, semaine.fin), true);
    assert.equal(dates.dansIntervalle('2026-11-08', semaine.debut, semaine.fin), true);
    assert.equal(dates.dansIntervalle('2026-11-09', semaine.debut, semaine.fin), false,
        'le lundi suivant appartient à la semaine suivante, pas aux deux');
    assert.equal(dates.dansIntervalle('2026-11-01', semaine.debut, semaine.fin), false);
});

test('le dimanche appartient à la semaine du lundi précédent', () => {
    assert.equal(dates.lundiDe('2026-11-01'), '2026-10-26');
    assert.equal(dates.lundiDe('2026-11-02'), '2026-11-02');
    assert.equal(dates.lundiDe('2026-11-08'), '2026-11-02');
});

test('ajouter sept jours reste sept jours de calendrier au changement d heure', () => {
    // La semaine du 26 octobre fait 169 heures : additionner 7 × 24 h
    // aboutirait au 1er novembre, pas au 2.
    assert.equal(dates.ajouterJours('2026-10-26', 7), '2026-11-02');
    assert.equal(dates.ajouterJours('2026-03-02', 7), '2026-03-09');
    assert.equal(dates.ajouterJours('2026-12-28', 7), '2027-01-04');
    assert.equal(dates.ajouterJours('2026-11-02', -7), '2026-10-26');
});

test('minuit local suit le décalage réel, y compris le jour du changement', () => {
    // Avant le retour à l'heure normale : UTC-4. Après : UTC-5.
    assert.equal(dates.minuitLocal('2026-10-31').toISOString(), '2026-10-31T04:00:00.000Z');
    assert.equal(dates.minuitLocal('2026-11-02').toISOString(), '2026-11-02T05:00:00.000Z');
    assert.equal(dates.decalageMinutes(dates.minuitLocal('2026-07-01')), -240);
    assert.equal(dates.decalageMinutes(dates.minuitLocal('2026-01-01')), -300);
});

test('minuit du jour de printemps est correct malgré l heure qui saute', () => {
    // Le 8 mars 2026, 2 h devient 3 h. Minuit existe toujours, à UTC-5.
    const minuit = dates.minuitLocal(PRINTEMPS);
    assert.equal(minuit.toISOString(), '2026-03-08T05:00:00.000Z');
    assert.equal(dates.journeeLocale(minuit), PRINTEMPS);
    // Et le lendemain est bien le 9, pas le 8 à 23 h.
    assert.equal(dates.journeeLocale(dates.minuitLocal('2026-03-09')), '2026-03-09');
});

test('une semaine chevauchant un changement d heure garde ses sept journées', () => {
    for (const journee of [PRINTEMPS, AUTOMNE]) {
        const semaine = dates.semaineDe(journee);
        assert.equal(dates.nombreDeJours(semaine.debut, semaine.fin), 7, `semaine du ${journee}`);
        assert.equal(dates.journeesDe(semaine.debut, semaine.fin).length, 7);
    }
});

test('les semaines numérotées ne dérivent pas au fil de la saison', () => {
    // Vingt-huit semaines depuis octobre traversent les deux changements
    // d'heure. La frontière doit rester un lundi, et le décalage rester nul.
    const depart = '2026-10-05';
    for (let numero = 1; numero <= 28; numero++) {
        const semaine = dates.semaineNumero(depart, numero);
        assert.equal(dates.jourDeSemaine(semaine.debut), 1, `semaine ${numero} ne commence pas un lundi`);
        assert.equal(dates.nombreDeJours(semaine.debut, semaine.fin), 7, `semaine ${numero} ne fait pas 7 jours`);
        assert.equal(dates.numeroDeSemaine(depart, semaine.debut), numero);
        assert.equal(dates.numeroDeSemaine(depart, semaine.dernierJour), numero);
    }
});

test('le numéro de semaine part de 1 et refuse l avant-saison', () => {
    assert.equal(dates.numeroDeSemaine('2026-10-05', '2026-10-05'), 1);
    assert.equal(dates.numeroDeSemaine('2026-10-05', '2026-10-11'), 1);
    assert.equal(dates.numeroDeSemaine('2026-10-05', '2026-10-12'), 2);
    assert.equal(dates.numeroDeSemaine('2026-10-05', '2026-09-28'), null);
});

test('un départ de saison en milieu de semaine est ramené à son lundi', () => {
    // La saison commence un mercredi ; la semaine 1 commence quand même le
    // lundi, sinon les frontières ne seraient plus des lundis.
    const semaine = dates.semaineNumero('2026-10-07', 1);
    assert.equal(semaine.debut, '2026-10-05');
    assert.equal(dates.numeroDeSemaine('2026-10-07', '2026-10-05'), 1);
});

test('une semaine est terminée quand sa borne de fin est atteinte, pas avant', () => {
    const semaine = dates.semaineDe('2026-11-04');
    assert.equal(dates.semaineTerminee(semaine, new Date('2026-11-08T23:00:00-05:00')), false);
    assert.equal(dates.semaineTerminee(semaine, new Date('2026-11-09T00:30:00-05:00')), true);
});

test('une entrée illisible donne null plutôt qu une date inventée', () => {
    assert.equal(dates.journeeLocale('pas une date'), null);
    assert.equal(dates.lundiDe('2026-13-45'), null);
    assert.equal(dates.lundiDe('2026-02-31'), null, 'le 31 février ne doit pas devenir le 3 mars');
    assert.equal(dates.journeeDe('2026-02-30'), null);
    assert.equal(dates.semaineDe(''), null);
    assert.equal(dates.minuitLocal('2026-11'), null);
    assert.equal(dates.ajouterJours(null, 1), null);
    assert.equal(dates.numeroDeSemaine(null, '2026-10-05'), null);
});

test('le nombre de semaines arrondit au supérieur et reste borné', () => {
    // Une saison qui se termine un mercredi se joue quand même cette semaine-là.
    assert.equal(dates.nombreDeSemaines('2026-10-05', '2026-10-12'), 1);
    assert.equal(dates.nombreDeSemaines('2026-10-05', '2026-10-14'), 2);
    assert.equal(dates.nombreDeSemaines('2026-10-05', '2027-04-14'), 28, '191 jours : 27 semaines pleines plus une entamée');
    assert.equal(dates.nombreDeSemaines('2026-10-05', null), 26, 'sans fin connue, un défaut plutôt que zéro');
    assert.equal(dates.nombreDeSemaines('2026-10-05', '2030-01-01'), 40, 'une date aberrante reste bornée');
    assert.equal(dates.nombreDeSemaines('2026-10-05', '2026-09-01'), 1, 'jamais zéro semaine');
});

test('les journées d une période sont énumérées dans l ordre, bornes comprises', () => {
    const journees = dates.journeesDe('2026-10-30', '2026-11-03');
    assert.deepEqual(journees, ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
});

test('une journée déjà au bon format traverse sans être retouchée', () => {
    assert.equal(dates.journeeDe('2026-11-04'), '2026-11-04');
    assert.equal(dates.journeeDe(new Date('2026-11-04T18:00:00Z')), '2026-11-04');
    assert.equal(dates.journeeDe(null), null);
});
