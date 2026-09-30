'use strict';

/**
 * L'accueil de saison (accueil-season.js) n'a plus deux blocs qui en
 * doublaient d'autres :
 *   - « Matchs du soir » — le Calendrier, juste dessous, donne les mêmes
 *     matchs avec leur état ;
 *   - « Actualités NHL » — le bandeau d'histoires du haut de page les porte
 *     déjà (accueil.js).
 * Le haut de page et le calendrier restent ; l'avant-saison (renderMobileHome,
 * accueil-mobile.js) garde sa disposition. Faute de DOM ici, on lit les
 * fichiers tels que le navigateur les reçoit.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const racine = path.join(__dirname, '../..');
const lire = f => fs.readFileSync(path.join(racine, f), 'utf8');
const SAISON = lire('accueil-season.js');

/** Le corps de renderSeasonHome, commentaires retirés : ce qui est rendu. */
function corpsRendu() {
    const debut = SAISON.indexOf('function renderSeasonHome(');
    const fin = SAISON.indexOf('\n}\n', debut);
    return SAISON.slice(debut, fin).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
}

describe('accueil de saison', () => {
    test('ni « Matchs du soir » ni « Actualités NHL »', () => {
        const rendu = corpsRendu();
        assert.doesNotMatch(rendu, /Actualités NHL/);
        assert.doesNotMatch(rendu, /Matchs du soir|Matchs en direct/);
        assert.doesNotMatch(SAISON, /class="fzs-(scores|news)/);
        assert.doesNotMatch(SAISON, /fzsLoadNews|fzmNewsWrap/);
    });

    test('le calendrier, les panneaux de la soirée et le bandeau du haut restent', () => {
        const rendu = corpsRendu();
        assert.match(rendu, /data-fz-bloc="calendrier"/);
        for (const bloc of ['soiree.joueurs', 'soiree.total', 'soiree.enJeu', 'soiree.repartition']) {
            assert.ok(rendu.includes(bloc), `${bloc} devrait rester`);
        }
        assert.match(lire('accueil.js'), /fetchNhlNews/, 'le bandeau d’histoires lit toujours les actualités');
    });

    test('l’avant-saison garde ses actualités', () => {
        assert.match(lire('accueil-mobile.js'), /id="fzmNewsWrap"/);
    });

    test('les points du soir passent par le barème du pool, jamais par fantasyPointsTonight directement', () => {
        for (const f of ['accueil-season.js', 'accueil-mobile.js']) {
            assert.doesNotMatch(lire(f), /fantasyPointsTonight/, f);
        }
        const dash = lire('accueil-dash.js');
        assert.equal(dash.split('fantasyPointsTonight').length - 1, 1, 'seul fzdPointsCeSoir choisit le barème');
    });
});
