'use strict';

/**
 * Récents (recents.js) : les échanges du pool arrivent en direct. Un filtre
 * « Échanges » les rassemble ; les signaux du serveur (tradePending,
 * tradeUpdated, tradeListingsUpdated) relisent la page ; un échange pas
 * encore vu surgit et s'annonce. Faute de DOM, on lit le fichier tel que le
 * navigateur le reçoit et on éprouve ses fonctions pures.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../../recents.js'), 'utf8');

/**
 * recents.js vit dans une IIFE : chargerFonctions (fixtures/helpers.js) ne
 * lit que les déclarations de haut niveau. On découpe ici les fonctions
 * demandées, de leur ligne `function nom(` jusqu'à l'accolade fermante au
 * même retrait, et on les évalue seules dans un bac à sable.
 */
function chargerFonctions(_fichier, noms, globals = {}) {
    const lignes = SOURCE.split(/\r?\n/);
    const morceaux = noms.map(nom => {
        const debut = lignes.findIndex(l => new RegExp(`^\\s*function ${nom}\\s*\\(`).test(l));
        if (debut < 0) throw new Error(`recents.js : « ${nom} » introuvable`);
        const retrait = lignes[debut].match(/^\s*/)[0];
        const fin = lignes.findIndex((l, i) => i > debut && l === `${retrait}}`);
        return lignes.slice(debut, fin + 1).join('\n');
    });
    const ctx = vm.createContext({ ...globals });
    vm.runInContext(morceaux.join('\n\n'), ctx);
    return vm.runInContext(`({ ${noms.join(', ')} })`, ctx);
}

describe('Récents — échanges en direct', () => {
    test('un filtre « Échanges » entre « Mes joueurs » et « Pool »', () => {
        assert.match(SOURCE, /\['mien', 'Mes joueurs'\],\s*\['echanges', 'Échanges'\],\s*\['pool', 'Pool'\]/);
    });

    test('le filtre garde les échanges conclus et les offres reçues, rien d’autre', () => {
        const { garder } = chargerFonctions('recents.js', ['garder']);
        assert.equal(garder({ cat: 'pool', echange: 'conclu|x|A|B' }, 'echanges'), true);
        assert.equal(garder({ cat: 'mien', mien: true, echange: 'offre|12' }, 'echanges'), true);
        assert.equal(garder({ cat: 'pool', tag: 'En vente' }, 'echanges'), false);
        assert.equal(garder({ cat: 'lnh', match: true }, 'echanges'), false);
        // Les autres filtres ne changent pas.
        assert.equal(garder({ cat: 'pool', echange: 'conclu|x|A|B' }, 'pool'), true);
        assert.equal(garder({ cat: 'pool' }, 'tout'), true);
    });

    test('les signaux d’échange du serveur relisent la page, par la connexion partagée', () => {
        assert.match(SOURCE, /\['tradePending', 'tradeUpdated', 'tradeListingsUpdated'\]\.forEach\(nom => socket\.on\(nom, surSignal\)\)/);
        assert.match(SOURCE, /window\.fzSocketPartage/);
        assert.doesNotMatch(SOURCE, /\bio\(/, 'pas de seconde connexion Socket.IO');
    });

    test('un signal d’un autre pool est ignoré', () => {
        let relu = 0;
        const etat = { pool: 'Ligue A', signal: null };
        const { surSignal } = chargerFonctions('recents.js', ['surSignal'], {
            etat, SIGNAL_MS: 0, charger: () => { relu += 1; },
            setTimeout: fn => { fn(); return 1; }, clearTimeout: () => {},
            document: { hidden: false }
        });
        surSignal({ poolName: 'Ligue B' });
        assert.equal(relu, 0);
        surSignal({ poolName: 'Ligue A' });
        assert.equal(relu, 1);
        surSignal(null); // reconnexion : on relit
        assert.equal(relu, 2);
    });
});
