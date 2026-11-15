/**
 * Paquets de déploiement (tools/construire.js) : ce qui se regroupe, et
 * surtout ce qui ne doit pas se regrouper.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const c = require('../../tools/construire.js');

const fichiers = els => els.map(e => `${e.genre}:${e.fichier || ''}`);

test('les feuilles et scripts du dépôt sont reconnus, pas les autres', () => {
    const html = `<head>
        <link rel="stylesheet" href="navbar.css?v=1">
        <link rel="stylesheet" href="https://exemple.com/x.css">
        <link rel="stylesheet" href="fonts/polices.css?v=1">
        <!-- <link rel="stylesheet" href="index.css"> -->
        <script defer src="activePool.js?v=2"></script>
        <script src="theme.js"></script>
        <script defer src="vendor/jquery-3.6.0.min.js"></script>
        <script defer src="/socket.io/socket.io.min.js"></script>
        <script defer src="installerApp.js?v=3"></script>
    </head>`;
    assert.deepEqual(fichiers(c.lireElements(html)), [
        'css:navbar.css',
        'coupure:',          // feuille extérieure
        'coupure:',          // feuille d'un dossier (ses url() relatives)
        'js:activePool.js',
        'js:vendor/jquery-3.6.0.min.js',
        'js:node_modules/socket.io/client-dist/socket.io.min.js',
        'js-fixe:',          // lit document.currentScript
        'coupure:'           // </head>
    ]);
});

test('une feuille ne saute ni un <style> ni la fin du <head>', () => {
    const html = `<head>
        <link rel="stylesheet" href="navbar.css">
        <link rel="stylesheet" href="index.css">
        <style>.x{}</style>
        <link rel="stylesheet" href="accueil.css">
    </head><body><link rel="stylesheet" href="landing.css"></body>`;
    const groupes = c.groupesCss(c.lireElements(html)).map(g => g.map(e => e.fichier));
    assert.deepEqual(groupes, [['navbar.css', 'index.css'], ['accueil.css'], ['landing.css']]);
});

test('un script qu on ne regroupe pas coupe la suite, l ordre reste le même', () => {
    const html = `<script defer src="activePool.js"></script>
        <script defer src="navbar.js"></script>
        <script defer src="installerApp.js"></script>
        <script defer src="notifications.js"></script>`;
    const groupes = c.groupesJs(c.lireElements(html)).map(g => g.map(e => e.fichier));
    assert.deepEqual(groupes, [['activePool.js', 'navbar.js'], ['notifications.js']]);
});

test('deux fonctions de même nom ne finissent pas dans le même paquet', () => {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'fz-paquets-'));
    const a = path.join(dossier, 'a.js');
    const b = path.join(dossier, 'b.js');
    const d = path.join(dossier, 'd.js');
    fs.writeFileSync(a, 'function afficher() { return 1; }');
    fs.writeFileSync(b, 'var x = 1; (function () { function afficher() {} })();');
    fs.writeFileSync(d, 'function afficher() { return 2; }');
    const rel = f => path.relative(path.join(__dirname, '../..'), f);
    const parts = c.couperDoublons([a, b, d].map(f => ({ fichier: rel(f) })));
    assert.deepEqual(parts.map(p => p.map(e => path.basename(e.fichier))), [['a.js', 'b.js'], ['d.js']]);
    fs.rmSync(dossier, { recursive: true, force: true });
});

test('commun ou propre à la page : la suite est coupée où la nature change', () => {
    const communs = new Set(['navbar.js', 'activePool.js']);
    const groupe = ['activePool.js', 'navbar.js', 'accueil.js', 'notifications.js'].map(fichier => ({ fichier }));
    const morceaux = c.decouperParPartage(groupe, communs).map(m => m.map(e => e.fichier));
    assert.deepEqual(morceaux, [['activePool.js', 'navbar.js'], ['accueil.js', 'notifications.js']]);
});
