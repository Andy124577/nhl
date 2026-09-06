/**
 * Chargement des aides du navigateur dans un test Node.
 *
 * Deux cas :
 *
 * 1. Les fichiers qui portent le pied d'export double (profanity.js,
 *    teamColors.js, headshots.js, injuries.js, draftkitData.js) se chargent
 *    d'un simple require(). Rien ici n'est nécessaire pour eux.
 *
 * 2. Les scripts de page — classement.js, navbar.js, trade.js,
 *    statsLeaders.js, statsTopPlayers.js — touchent au DOM dès leur première
 *    ligne (document.addEventListener, $(document).ready). Les charger en
 *    entier hors navigateur est impossible, et leur poser un pied d'export
 *    n'y changerait rien.
 *
 *    chargerFonctions() découpe alors la ou les fonctions demandées dans le
 *    VRAI fichier source — repérage par accolades, comme le ferait un
 *    éditeur — et les évalue seules, dans un bac à sable. Le test porte donc
 *    bien sur le code livré, pas sur une copie.
 *
 *    Limite assumée : si une fonction est renommée ou déplacée, le
 *    chargement échoue avec un message explicite plutôt que de passer à
 *    côté en silence. C'est le compromis retenu pour ne pas remanier cinq
 *    pages livrées au seul profit des tests.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..', '..');

/** Un contexte de navigateur minimal, complété par `globals`. */
function bacASable(globals = {}) {
    return vm.createContext({
        console, Math, Date, JSON, Number, String, Object, Array, Map, Set, RegExp,
        Intl, isNaN, parseInt, parseFloat, Infinity, NaN, undefined,
        window: { location: { pathname: '/' } },
        ...globals
    });
}

/**
 * Évalue un fichier entier dans un bac à sable et rend le contexte.
 * Réservé aux fichiers sans effet de bord au chargement.
 */
function chargerModuleNavigateur(fichier, globals = {}) {
    const p = path.join(RACINE, fichier);
    const ctx = bacASable(globals);
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: p });
    return ctx;
}

/** Fin d'un bloc à partir de sa ligne d'ouverture, par comptage d'accolades. */
function finDuBloc(lignes, depart) {
    let profondeur = 0, commence = false;
    for (let i = depart; i < lignes.length; i++) {
        const ligne = lignes[i];
        let chaine = null, echappe = false;
        for (let c = 0; c < ligne.length; c++) {
            const ch = ligne[c], suivant = ligne[c + 1];
            if (chaine) {
                if (echappe) { echappe = false; continue; }
                if (ch === '\\') { echappe = true; continue; }
                if (ch === chaine) chaine = null;
                continue;
            }
            if (ch === '/' && suivant === '/') break;
            if (ch === '"' || ch === "'" || ch === '`') { chaine = ch; continue; }
            if (ch === '{') { profondeur++; commence = true; }
            else if (ch === '}' && --profondeur === 0 && commence) return i;
        }
    }
    throw new Error(`bloc non refermé à partir de la ligne ${depart + 1}`);
}

/**
 * Découpe des déclarations de haut niveau (`function nom(` ou `const NOM =`)
 * dans un fichier source, les évalue ensemble, et rend un objet
 * { nom: fonction }.
 *
 * @param {string} fichier  chemin relatif à la racine du dépôt
 * @param {string[]} noms   déclarations à extraire, dépendances comprises
 * @param {object} globals  globales supplémentaires du bac à sable
 */
function chargerFonctions(fichier, noms, globals = {}) {
    const p = path.join(RACINE, fichier);
    const lignes = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    const morceaux = [];

    for (const nom of noms) {
        const debut = lignes.findIndex(l =>
            new RegExp(`^(async )?function ${nom}\\s*\\(`).test(l) ||
            new RegExp(`^const ${nom}\\s*=`).test(l));
        if (debut < 0) {
            throw new Error(`${fichier} : « ${nom} » introuvable — renommée ou déplacée ? `
                + 'Le test doit suivre la source, pas l\'inverse.');
        }
        // Une constante tenant sur une ligne n'a pas de bloc à refermer.
        const uneLigne = /^const /.test(lignes[debut]) && /;\s*$/.test(lignes[debut]);
        const fin = uneLigne ? debut : finDuBloc(lignes, debut);
        morceaux.push(lignes.slice(debut, fin + 1).join('\n'));
    }

    const ctx = bacASable(globals);
    vm.runInContext(morceaux.join('\n\n') + `\n;({ ${noms.join(', ')} })`, ctx, { filename: p });
    return vm.runInContext(`({ ${noms.join(', ')} })`, ctx);
}

module.exports = { chargerModuleNavigateur, chargerFonctions };
