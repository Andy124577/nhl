'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrations = require('../../lib/migrations.js');

const entree = (fichier, sql) => ({ fichier, sql });

test('les migrations sont ordonnées par numéro, pas par nom de fichier', () => {
    const liste = migrations.ordonner([
        entree('0010_dix.sql', 'x'),
        entree('0002_deux.sql', 'y'),
        entree('0001_un.sql', 'z')
    ]);
    assert.deepEqual(liste.map(m => m.numero), [1, 2, 10]);
});

test('un fichier hors convention est ignoré sans faire échouer le démarrage', () => {
    const liste = migrations.ordonner([
        entree('0001_un.sql', 'a'),
        entree('README.md', 'b'),
        entree('create_player_game_logs.sql', 'c')
    ]);
    assert.deepEqual(liste.map(m => m.fichier), ['0001_un.sql']);
});

test('deux migrations portant le même numéro arrêtent tout', () => {
    assert.throws(
        () => migrations.ordonner([entree('0005_a.sql', 'x'), entree('0005_b.sql', 'y')]),
        /0005/,
        'deux ordres possibles donneraient deux bases différentes à partir du même dépôt'
    );
});

test('seules les migrations non appliquées sont proposées', () => {
    const liste = migrations.ordonner([entree('0001_un.sql', 'a'), entree('0002_deux.sql', 'b')]);
    const plan = migrations.planifier(liste, [
        { numero: 1, fichier: '0001_un.sql', empreinte: migrations.empreinte('a') }
    ]);
    assert.deepEqual(plan.aAppliquer.map(m => m.fichier), ['0002_deux.sql']);
    assert.deepEqual(plan.derives, []);
});

test('rejouer quand tout est appliqué ne propose rien', () => {
    const liste = migrations.ordonner([entree('0001_un.sql', 'a')]);
    const plan = migrations.planifier(liste, [
        { numero: 1, fichier: '0001_un.sql', empreinte: migrations.empreinte('a') }
    ]);
    assert.deepEqual(plan.aAppliquer, []);
    assert.deepEqual(plan.derives, []);
});

test('une migration réécrite après coup est signalée, pas réappliquée en silence', () => {
    const liste = migrations.ordonner([entree('0001_un.sql', 'NOUVEAU')]);
    const plan = migrations.planifier(liste, [
        { numero: 1, fichier: '0001_un.sql', empreinte: migrations.empreinte('ANCIEN') }
    ]);
    assert.deepEqual(plan.aAppliquer, []);
    assert.equal(plan.derives.length, 1);
    assert.equal(plan.derives[0].type, 'empreinte');
});

test('une migration enregistrée en base mais absente du dépôt est signalée', () => {
    const liste = migrations.ordonner([entree('0001_un.sql', 'a')]);
    const plan = migrations.planifier(liste, [
        { numero: 1, fichier: '0001_un.sql', empreinte: migrations.empreinte('a') },
        { numero: 2, fichier: '0002_disparue.sql', empreinte: 'peu importe' }
    ]);
    assert.equal(plan.derives.length, 1);
    assert.equal(plan.derives[0].type, 'manquante');
    assert.match(plan.derives[0].message, /0002_disparue/);
});

test('un registre sans empreinte enregistrée ne déclenche pas de fausse dérive', () => {
    const liste = migrations.ordonner([entree('0001_un.sql', 'a')]);
    const plan = migrations.planifier(liste, [{ numero: 1, fichier: '0001_un.sql', empreinte: null }]);
    assert.deepEqual(plan.derives, []);
});

test('les migrations du dépôt se chargent, se numérotent sans trou et ne détruisent rien', () => {
    const dossier = path.join(__dirname, '../../migrations');
    const fichiers = fs.readdirSync(dossier).filter(f => migrations.MOTIF_NOM.test(f));
    const liste = migrations.ordonner(
        fichiers.map(f => entree(f, fs.readFileSync(path.join(dossier, f), 'utf-8')))
    );

    assert.ok(liste.length >= 7, 'les migrations du plan doivent être présentes');
    liste.forEach((m, i) => assert.equal(m.numero, i + 1, `numéro manquant avant ${m.fichier}`));

    // Les commentaires parlent parfois de ce qu'on a justement retiré ; c'est
    // le SQL exécuté qui compte.
    const sansCommentaires = (sql) => sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

    for (const m of liste) {
        const sql = sansCommentaires(m.sql);
        assert.doesNotMatch(sql, /DROP\s+TABLE/i,
            `${m.fichier} détruit une table : une migration qui efface des données d'utilisateurs n'en est pas une`);
        assert.doesNotMatch(sql, /DROP\s+COLUMN/i, `${m.fichier} supprime une colonne`);
    }

    // Le registre part d'une base vierge : rien n'est appliqué.
    const plan = migrations.planifier(liste, []);
    assert.equal(plan.aAppliquer.length, liste.length);
    assert.deepEqual(plan.derives, []);
});

test('le schéma de base est rejouable : chaque création est conditionnelle', () => {
    const dossier = path.join(__dirname, '../../migrations');
    const sql = fs.readFileSync(path.join(dossier, '0001_baseline.sql'), 'utf-8');
    const creations = [...sql.matchAll(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(IF NOT EXISTS\s+)?/gi)];
    for (const creation of creations) {
        assert.ok(creation[3], `une création sans IF NOT EXISTS dans 0001_baseline.sql : ${creation[0]}`);
    }
});
