'use strict';

/**
 * Les quatre panneaux communs aux accueils — calendrier, compte à rebours
 * hors-saison, « Mouvements récents » et « À surveiller » — n'existent qu'une
 * fois dans index.html. Chaque accueil ouvre un emplacement data-fz-bloc et
 * fzdPlaceCalendar() y déplace le nœud.
 *
 * Ces tests gardent l'invariant : le jour où un accueil se remet à écrire son
 * propre calendrier ou son propre carrousel de mouvements, les deux versions
 * recommencent à diverger — c'est exactement ce que cette mise en commun a
 * défait. Ils lisent les fichiers tels que le navigateur les reçoit, faute de
 * DOM ici.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const racine = path.join(__dirname, '../..');
const lire = f => fs.readFileSync(path.join(racine, f), 'utf8');

const INDEX = lire('index.html');
const ACCUEILS = {
    'accueil-draft.js': lire('accueil-draft.js'),
    'accueil-season.js': lire('accueil-season.js'),
    'accueil-mobile.js': lire('accueil-mobile.js')
};

// Clé d'emplacement → identifiant du nœud partagé, tel que FZD_BLOCS les
// apparie dans accueil-dash.js.
const BLOCS = {
    calendrier: 'fzDashCalendarWrap',
    horssaison: 'fzdOffCount',
    mouvements: 'fzdOffMoves',
    surveiller: 'fzdOffWatch'
};

describe('accueil — blocs partagés', () => {
    test('chaque bloc n’existe qu’une fois dans index.html', () => {
        for (const id of Object.values(BLOCS)) {
            const occurrences = INDEX.split(`id="${id}"`).length - 1;
            assert.equal(occurrences, 1, `#${id} devrait être déclaré une seule fois`);
        }
    });

    test('accueil-dash.js apparie les mêmes clés aux mêmes identifiants', () => {
        const dash = lire('accueil-dash.js');
        for (const [cle, id] of Object.entries(BLOCS)) {
            assert.match(
                dash,
                new RegExp(`cle: '${cle}', id: '${id}'`),
                `FZD_BLOCS devrait apparier ${cle} → #${id}`
            );
        }
    });

    test('« À surveiller » est le panneau du repêchage partout', () => {
        // L'accueil sans pool et l'accueil hors-saison le montrent aussi : le
        // panneau vit dans index.html, avec le balisage que fzhWatchHTML()
        // remplit (accueil-watch.js).
        assert.match(INDEX, /class="fzh-watch fzh-panel" id="fzdOffWatch" data-watch-panel/);
    });

    test('aucun accueil ne réécrit un bloc partagé, chacun ouvre un emplacement', () => {
        // Les classes citées dans un commentaire ne comptent pas : c'est le
        // balisage produit qu'on surveille.
        const classes = source => [...source.matchAll(/class="([^"]*)"/g)]
            .flatMap(m => m[1].split(/\s+/));
        for (const [nom, source] of Object.entries(ACCUEILS)) {
            const posees = new Set(classes(source));
            // Un accueil qui pose un bloc le pose par emplacement, jamais en
            // recopiant le balisage du tableau de bord.
            for (const classe of ['fzd-off-carousel', 'fzd-off-count', 'fz-dash-calendar', 'fzh-watch']) {
                assert.ok(!posees.has(classe), `${nom} ne devrait pas recréer .${classe}`);
            }
            // Un seul panneau [data-watch-panel] existe, dans index.html.
            assert.ok(!source.includes('data-watch-panel'), `${nom} ne devrait pas déclarer un second panneau à surveiller`);
            assert.ok(source.includes('data-fz-bloc='), `${nom} devrait ouvrir au moins un emplacement`);
        }
    });

    test('tout emplacement déclaré porte une clé connue', () => {
        for (const [nom, source] of Object.entries(ACCUEILS)) {
            for (const m of source.matchAll(/data-fz-bloc="([^"]+)"/g)) {
                assert.ok(BLOCS[m[1]], `${nom} déclare un emplacement inconnu : ${m[1]}`);
            }
        }
    });

    test('les emplacements n’ont pas de boîte à eux', () => {
        // Sans display:contents, l'emplacement deviendrait l'enfant de grille
        // et le bloc perdrait sa colonne comme son ordre au téléphone.
        assert.match(lire('accueil-dash.css'), /\[data-fz-bloc\]\s*{\s*display:\s*contents;/);
    });
});
