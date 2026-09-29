'use strict';

/**
 * Les listes de la salle de repêchage ouvrent la fiche d'un joueur
 * (fzMarquerFiche / fzOuvrirFiche, draftActif.js) : alignement, carrousel,
 * favoris, derniers choix.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chargerFonctions } = require('../fixtures/helpers.js');

/** Un élément minimal : ce que fzMarquerFiche lit et écrit. */
function element() {
    const attributs = {};
    return {
        dataset: {},
        classList: { valeurs: new Set(), add(c) { this.valeurs.add(c); } },
        setAttribute(nom, valeur) { attributs[nom] = valeur; },
        attributs
    };
}

function charger({ fiches = {}, stats = {} } = {}) {
    const ouvertes = [];
    const alertes = [];
    const f = chargerFonctions('draftActif.js', ['fzMarquerFiche', 'fzOuvrirFiche'], {
        window: { FZDraftKit: { nomCanonique: n => (n === 'Mitchell Marner' ? 'Mitch Marner' : n) } },
        fzFindRecord: nom => fiches[nom] || null,
        getCurrentPlayerStats: nom => stats[nom] || null,
        showCareerStats: (id, nom, gardien) => ouvertes.push([id, nom, gardien]),
        showCustomAlert: (message, type) => alertes.push([message, type])
    });
    return { ...f, ouvertes, alertes };
}

test('un joueur est marqué cliquable, un club de la LNH non', () => {
    const { fzMarquerFiche } = charger();
    const joueur = fzMarquerFiche(element(), 'Cale Makar', 'skater');
    assert.equal(joueur.dataset.ficheJoueur, 'Cale Makar');
    assert.equal(joueur.tabIndex, 0);
    assert.equal(joueur.attributs.role, 'button');
    assert.ok(joueur.classList.valeurs.has('fz-fiche'));

    const carte = fzMarquerFiche(element(), 'Cale Makar', null, { focusable: false });
    assert.equal(carte.dataset.ficheJoueur, 'Cale Makar');
    assert.equal(carte.tabIndex, undefined, 'le carrousel garde ses flèches, sans cent arrêts de tabulation');

    const club = fzMarquerFiche(element(), 'Carolina Hurricanes', 'team');
    assert.equal(club.dataset.ficheJoueur, undefined, 'un club n a pas de fiche');
    assert.equal(fzMarquerFiche(element(), '', 'skater').dataset.ficheJoueur, undefined);
});

test('la fiche se retrouve au clic, par le nom, gardien compris', () => {
    const { fzOuvrirFiche, ouvertes, alertes } = charger({
        fiches: {
            'Mitch Marner': { rec: { playerId: 8478483 }, kind: 'skater' },
            'Andrei Vasilevskiy': { rec: { playerId: 8476883 }, kind: 'goalie' },
            'Sans Id': { rec: {}, kind: 'skater' },
            'Carolina Hurricanes': { rec: {}, kind: 'team' }
        },
        stats: { 'Sans Id': { playerId: 8480000 } }
    });

    fzOuvrirFiche('Mitchell Marner');
    fzOuvrirFiche('Andrei Vasilevskiy');
    fzOuvrirFiche('Sans Id');
    fzOuvrirFiche('Carolina Hurricanes');
    assert.deepEqual(ouvertes, [
        [8478483, 'Mitch Marner', false],
        [8476883, 'Andrei Vasilevskiy', true],
        [8480000, 'Sans Id', false]
    ], 'ancien nom ramené à la trousse ; identifiant repris des statistiques au besoin ; club ignoré');

    fzOuvrirFiche('Inconnu');
    assert.deepEqual(alertes, [["La fiche de Inconnu n'est pas disponible.", 'info']]);
});
