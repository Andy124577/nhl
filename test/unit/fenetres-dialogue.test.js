'use strict';

/**
 * Aucune boîte native (alert, confirm, prompt) côté navigateur.
 *
 * Elles affichent « fantazy.ca indique » en titre, ignorent le thème et
 * bloquent la page : tout passe par fzDialog.js (fzAlert, fzConfirm,
 * fzCopy). Ce test lit les fichiers réellement servis au navigateur — la
 * liste de middleware/staticAssets.js — et vérifie aussi que toute page qui
 * s'en sert charge fzDialog.js avant ses propres scripts.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const statiques = require('../../middleware/staticAssets.js');

const racine = path.join(__dirname, '../..');

/** Fichiers .js et .html de la racine que le serveur livre au navigateur. */
function fichiersClient(extension) {
    return fs.readdirSync(racine)
        .filter(nom => nom.endsWith(extension))
        .filter(nom => statiques.estPublic('/' + nom).ok);
}

/** Retire les commentaires : les mentionner dans une explication est permis. */
function sansCommentaires(source, html) {
    let texte = source.replace(/\/\*[\s\S]*?\*\//g, '');
    if (html) texte = texte.replace(/<!--[\s\S]*?-->/g, '');
    return texte.replace(/(^|[\s;{}])\/\/[^\n]*/g, '$1');
}

const APPEL_NATIF = /(^|[^\w.$])(?:window\.)?(alert|confirm|prompt)\s*\(/;

test('aucun script ni page du site n appelle alert, confirm ou prompt', () => {
    const fautifs = [];
    for (const nom of [...fichiersClient('.js'), ...fichiersClient('.html')]) {
        const lignes = sansCommentaires(fs.readFileSync(path.join(racine, nom), 'utf8'), nom.endsWith('.html'))
            .split('\n');
        lignes.forEach((ligne, i) => {
            const trouve = ligne.match(APPEL_NATIF);
            if (trouve) fautifs.push(`${nom}:${i + 1} → ${trouve[2]}()`);
        });
    }
    assert.deepEqual(fautifs, [], 'Utiliser fzAlert / fzConfirm / fzCopy (fzDialog.js)');
});

test('toute page qui ouvre une fenêtre charge fzDialog.js avant ses scripts', () => {
    const UTILISE = /\bfz(?:Alert|Confirm|Copy|Modal|Notice)\s*\(|\bfzDialog\./;
    const oublis = [];

    for (const page of fichiersClient('.html')) {
        const html = fs.readFileSync(path.join(racine, page), 'utf8');
        const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="\/?([^"?]+)(?:\?[^"]*)?"[^>]*>/g)]
            .map(m => ({ src: m[1], position: m.index }));
        const dialogue = scripts.find(s => s.src === 'fzDialog.js');

        for (const script of scripts) {
            const fichier = path.join(racine, script.src);
            if (script.src === 'fzDialog.js' || !fs.existsSync(fichier)) continue;
            if (!UTILISE.test(sansCommentaires(fs.readFileSync(fichier, 'utf8')))) continue;
            if (!dialogue) oublis.push(`${page} : ${script.src} sans fzDialog.js`);
            else if (dialogue.position > script.position) oublis.push(`${page} : fzDialog.js après ${script.src}`);
        }
        if (!/fzDialog\.css/.test(html) && dialogue) oublis.push(`${page} : fzDialog.css manquant`);
    }
    assert.deepEqual(oublis, []);
});

test('fzDialog.js expose les fonctions dont les pages dépendent', () => {
    const source = fs.readFileSync(path.join(racine, 'fzDialog.js'), 'utf8');
    for (const nom of ['fzModal', 'fzAlert', 'fzConfirm', 'fzCopy', 'fzNotice', 'fzDialog']) {
        assert.match(source, new RegExp(`window\\.${nom}\\s*=`), `${nom} manquant`);
    }
});
