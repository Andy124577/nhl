'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const kit = require('../../tools/build_draftkit.js');
const {
    nameKey, splitName, isRookie, titleCase, editDistance, resolveId, round,
    normTeam, num, int, parseTopPicks, parseLineup, parseInjury, parseNotes,
    parseTeamPage, linkGuides, warnings, resetWarnings,
    ROOKIE_MAX_GAMES, ROOKIE_MAX_AGE
} = kit;

// warnings est un état de module : sans remise à zéro, un cas hériterait des
// avertissements du précédent.
beforeEach(() => { resetWarnings(); });

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'guide-page.txt'), 'utf8').split('\n');
// Fabrique plutôt qu'objet partagé : les analyseurs ne l'écrivent pas
// aujourd'hui, mais un objet de haut niveau passé à quinze cas est
// exactement le motif qui finit par fuir d'un test à l'autre
// (UNIT_TESTS_REVIEW.md §3).
const equipeANA = (over = {}) => ({ abbrev: 'ANA', fullName: 'Anaheim Ducks', kitName: 'ANAHEIM DUCKS', ...over });

describe('nameKey', () => {
    test('retire les accents', () => {
        assert.equal(nameKey('Sébastien Aho'), 'sebastien aho');
        assert.equal(nameKey('Timothée Chalamet'), 'timothee chalamet');
    });

    test('met en minuscules', () => {
        assert.equal(nameKey('CONNOR MCDAVID'), 'connor mcdavid');
    });

    test('les traits d\'union et la ponctuation deviennent une seule espace', () => {
        assert.equal(nameKey('Sandin-Pellikka'), 'sandin pellikka');
        assert.equal(nameKey("K'Andre Miller"), 'k andre miller');
        assert.equal(nameKey('T.J. Oshie'), 't j oshie');
    });

    test('les espaces multiples sont réduites et les bords rognés', () => {
        assert.equal(nameKey('  Nick   Suzuki  '), 'nick suzuki');
    });

    test('une entrée qui n\'est pas une chaîne ne lève pas d\'erreur', () => {
        assert.doesNotThrow(() => nameKey(null));
        assert.doesNotThrow(() => nameKey(42));
        assert.equal(nameKey(42), '42');
    });
});

describe('splitName', () => {
    test('compte les marqueurs de blessure en fin de nom', () => {
        assert.deepEqual(splitName('Brad Marchand °°°'), { name: 'Brad Marchand', injury: 3 });
    });

    test('sans marqueur, la blessure vaut 0', () => {
        assert.deepEqual(splitName('Nick Suzuki'), { name: 'Nick Suzuki', injury: 0 });
    });

    test('un et deux marqueurs', () => {
        assert.equal(splitName('Joueur °').injury, 1);
        assert.equal(splitName('Joueur °°').injury, 2);
    });

    test('l\'espace avant les marqueurs est absorbée', () => {
        assert.equal(splitName('Joueur    °°').name, 'Joueur');
    });

    test('un degré au milieu du nom n\'est pas un marqueur', () => {
        const r = splitName('Jo°ueur');

        assert.equal(r.injury, 0);
        assert.equal(r.name, 'Jo°ueur');
    });
});

describe('isRookie', () => {
    test('une case de matchs vide désigne la recrue la plus certaine', () => {
        // Aucun match dans la LNH l'an dernier : c'est un espoir, pas une
        // donnée manquante à écarter.
        assert.equal(isRookie(null, 19), true);
        assert.equal(isRookie(undefined, 19), true);
    });

    test(`la limite de matchs est ${ROOKIE_MAX_GAMES}, inclusivement`, () => {
        assert.equal(isRookie(27, 20), true);
        assert.equal(isRookie(28, 20), false);
        assert.equal(ROOKIE_MAX_GAMES, 27);
    });

    test(`la limite d'âge est ${ROOKIE_MAX_AGE} ans, inclusivement`, () => {
        assert.equal(isRookie(10, 23), true);
        assert.equal(isRookie(10, 24), false);
        assert.equal(ROOKIE_MAX_AGE, 23);
    });

    test('un vétéran blessé toute une saison n\'est pas une recrue', () => {
        // Le cas pour lequel l'ancien code portait une exception « Tyler
        // Seguin » en dur : peu de matchs, mais 30 ans.
        assert.equal(isRookie(5, 30), false);
    });

    test('sans âge, la recrue ne peut pas être décidée et le cas est signalé', () => {
        assert.equal(isRookie(3, null, 'Joueur Sans Âge'), false);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /Joueur Sans Âge/);
        assert.match(warnings[0], /no age in the kit/);
    });

    test('sans âge ET avec beaucoup de matchs, aucun avertissement n\'est levé', () => {
        // Rien à décider : 60 matchs excluent la recrue quoi qu'il arrive.
        assert.equal(isRookie(60, null, 'Vétéran'), false);
        assert.equal(warnings.length, 0);
    });

    test('sans âge et sans nom, rien n\'est signalé', () => {
        assert.equal(isRookie(3, null), false);
        assert.equal(warnings.length, 0);
    });
});

describe('titleCase', () => {
    test('applique la règle Mc', () => {
        assert.equal(titleCase('MCDAVID'), 'McDavid');
        assert.equal(titleCase('connor mcdavid'), 'Connor McDavid');
    });

    test('capitalise après un trait d\'union', () => {
        assert.equal(titleCase('jean-gabriel pageau'), 'Jean-Gabriel Pageau');
    });

    test('capitalise après une apostrophe, droite ou typographique', () => {
        assert.equal(titleCase("o'reilly"), "O'Reilly");
        assert.equal(titleCase('o’reilly'), 'O’Reilly');
    });

    test('capitalise après un point', () => {
        assert.equal(titleCase('t.j. oshie'), 'T.J. Oshie');
    });

    test('une majuscule initiale accentuée est laissée telle quelle', () => {
        // La règle ne vise que [a-zà-þ] : « É » est déjà en majuscule.
        assert.equal(titleCase('ÉRIC STAAL'), 'Éric Staal');
    });
});

describe('editDistance', () => {
    test('deux chaînes identiques sont à distance 0', () => {
        assert.equal(editDistance('kindel', 'kindel'), 0);
    });

    test('une chaîne vide est à la longueur de l\'autre', () => {
        assert.equal(editDistance('', 'abc'), 3);
        assert.equal(editDistance('abcd', ''), 4);
        assert.equal(editDistance('', ''), 0);
    });

    test('une substitution, une insertion ou une suppression vaut 1', () => {
        assert.equal(editDistance('kindel', 'kindal'), 1, 'substitution');
        assert.equal(editDistance('kindel', 'kindell'), 1, 'insertion');
        assert.equal(editDistance('kindell', 'kindel'), 1, 'suppression');
    });

    test('la distance est symétrique', () => {
        for (const [a, b] of [['pellika', 'pellikka'], ['suzuki', 'susuki'], ['abc', 'xyz'], ['', 'z']]) {
            assert.equal(editDistance(a, b), editDistance(b, a), `${a} / ${b}`);
        }
    });

    test('deux noms sans rapport sont loin', () => {
        assert.ok(editDistance('mcdavid', 'crosby') > 2);
    });
});

describe('round', () => {
    test('null traverse en null, jamais en 0', () => {
        // Une case vide de la trousse doit rester vide : un 0 se lirait comme
        // une vraie projection.
        assert.equal(round(null, 1), null);
        assert.equal(round(undefined, 1), null);
    });

    test('arrondit au nombre de décimales demandé', () => {
        assert.equal(round(1.2345, 2), 1.23);
        assert.equal(round(1.2367, 2), 1.24);
        assert.equal(round(2.5, 0), 3);
    });

    test('zéro reste zéro', () => {
        assert.equal(round(0, 2), 0);
    });
});

describe('num / int', () => {
    test('la virgule décimale française est acceptée', () => {
        assert.equal(num('2,5'), 2.5);
    });

    test('une case vide vaut null', () => {
        assert.equal(num(''), null);
        assert.equal(num(null), null);
        assert.equal(num(undefined), null);
    });

    test('une valeur non numérique vaut null', () => {
        assert.equal(num('n/d'), null);
    });

    test('int arrondit et propage le null', () => {
        assert.equal(int('27,4'), 27);
        assert.equal(int('27,6'), 28);
        assert.equal(int(''), null);
    });
});

describe('normTeam', () => {
    test('corrige les codes de la trousse qui diffèrent de ceux de la LNH', () => {
        assert.equal(normTeam('LA'), 'LAK');
        assert.equal(normTeam('SJ'), 'SJS');
        assert.equal(normTeam('TB'), 'TBL');
        assert.equal(normTeam('NJ'), 'NJD');
        assert.equal(normTeam('WIN'), 'WPG');
    });

    test('ne garde que le dernier club d\'une liste', () => {
        // Un joueur échangé porte « MTL, TOR » : c'est le club actuel qui compte.
        assert.equal(normTeam('MTL, TOR'), 'TOR');
    });

    test('met en majuscules et rogne', () => {
        assert.equal(normTeam(' mtl '), 'MTL');
    });

    test('une valeur absente rend une chaîne vide', () => {
        assert.equal(normTeam(null), '');
        assert.equal(normTeam(undefined), '');
    });
});

describe('resolveId', () => {
    /** L'index que buildIdIndex construit : clé de nom → candidats. */
    function index(entries) {
        return new Map(entries);
    }

    test('un seul candidat est retenu directement', () => {
        const idx = index([['connor mcdavid', [{ id: 8478402, team: 'EDM' }]]]);

        assert.equal(resolveId(idx, 'Connor McDavid', 'EDM'), 8478402);
    });

    test('un nom accentué retrouve une entrée sans accent', () => {
        const idx = index([['sebastien aho', [{ id: 8478427, team: 'CAR' }]]]);

        assert.equal(resolveId(idx, 'Sébastien Aho', 'CAR'), 8478427);
    });

    test('deux homonymes sont départagés par le club', () => {
        const idx = index([['sam montembeault', [
            { id: 1, team: 'MTL' },
            { id: 2, team: 'FLA' }
        ]]]);

        assert.equal(resolveId(idx, 'Sam Montembeault', 'MTL'), 1);
        assert.equal(resolveId(idx, 'Sam Montembeault', 'FLA'), 2);
    });

    test('deux homonymes dans le MÊME club restent non résolus', () => {
        // Mieux vaut aucune photo qu'une photo tirée à pile ou face.
        const idx = index([['sam montembeault', [
            { id: 1, team: 'MTL' },
            { id: 2, team: 'MTL' }
        ]]]);

        assert.equal(resolveId(idx, 'Sam Montembeault', 'MTL'), null);
    });

    test('un homonyme dont aucun ne joue pour le club demandé reste non résolu', () => {
        const idx = index([['sam montembeault', [{ id: 1, team: 'MTL' }, { id: 2, team: 'FLA' }]]]);

        assert.equal(resolveId(idx, 'Sam Montembeault', 'BOS'), null);
    });

    test('un nom inconnu rend null', () => {
        assert.equal(resolveId(index([]), 'Personne', 'MTL'), null);
    });
});

describe('parseTopPicks', () => {
    test('lit un choix de patineur avec sa projection', () => {
        const lignes = ['1. Leo Carlsson (C) - (27B, 36P) 63 pts'];
        const { forwards } = parseTopPicks(lignes, equipeANA());

        assert.equal(forwards.length, 1);
        assert.deepEqual(forwards[0], {
            rank: 1,
            name: 'Leo Carlsson',
            position: 'C',
            positionLabel: 'C',
            projection: { goals: 27, assists: 36, points: 63 }
        });
    });

    test('accepte les en-têtes anglais (G/A) comme les français (B/P)', () => {
        const { forwards } = parseTopPicks(['2. Beckett Sennecke (AD) - (24G, 38A) 62 pts'], equipeANA());

        assert.deepEqual(forwards[0].projection, { goals: 24, assists: 38, points: 62 });
    });

    test('traduit les positions françaises en codes de la LNH', () => {
        const { forwards } = parseTopPicks([
            '1. Un Centre (C) - (10B, 10P) 20 pts',
            '2. Un Ailier Gauche (AG) - (10B, 10P) 20 pts',
            '3. Un Ailier Droit (AD) - (10B, 10P) 20 pts'
        ], equipeANA());

        assert.deepEqual(forwards.map(f => f.position), ['C', 'L', 'R']);
        assert.deepEqual(forwards.map(f => f.positionLabel), ['C', 'AG', 'AD']);
    });

    test('les défenseurs sont rangés à part', () => {
        const { forwards, defensemen } = parseTopPicks([
            '1. Leo Carlsson (C) - (27B, 36P) 63 pts       1. Jackson LaCombe (D) - (10B, 43P) 53 pts'
        ], equipeANA());

        assert.deepEqual(forwards.map(f => f.name), ['Leo Carlsson']);
        assert.deepEqual(defensemen.map(d => d.name), ['Jackson LaCombe']);
    });

    test('un gardien a une projection victoires / blanchissages / défaites en prolongation', () => {
        const { goalies } = parseTopPicks(['1. Lukas Dostal - (27V, 0BL, 4DP) 58 pts'], equipeANA());

        assert.deepEqual(goalies[0], {
            rank: 1,
            name: 'Lukas Dostal',
            position: 'G',
            projection: { wins: 27, shutouts: 0, otLosses: 4, points: 58 }
        });
    });

    test('les choix sont triés par rang, quel que soit l\'ordre des lignes', () => {
        const { forwards } = parseTopPicks([
            '3. Troisieme (C) - (1B, 1P) 3 pts',
            '1. Premier (C) - (1B, 1P) 1 pts',
            '2. Deuxieme (C) - (1B, 1P) 2 pts'
        ], equipeANA());

        assert.deepEqual(forwards.map(f => f.rank), [1, 2, 3]);
    });

    test('une page sans attaquant est signalée', () => {
        parseTopPicks(['du texte sans rapport'], equipeANA());

        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /ANA: no forwards parsed/);
    });

    test('une ligne malformée est ignorée, sans erreur', () => {
        assert.doesNotThrow(() => parseTopPicks(['1. Nom sans parenthèses 63 pts'], equipeANA()));
    });
});

describe('parseInjury', () => {
    test('joueur, nature et statut', () => {
        assert.deepEqual(parseInjury("T. Terry - Hanche - Absent jusqu'en novembre"), {
            player: 'T. Terry',
            issue: 'Hanche',
            status: "Absent jusqu'en novembre"
        });
    });

    test('joueur et statut seulement', () => {
        assert.deepEqual(parseInjury('M. Domi - Indéterminé'), {
            player: 'M. Domi',
            issue: null,
            status: 'Indéterminé'
        });
    });

    test('un statut qui contient lui-même un tiret est recollé', () => {
        const r = parseInjury('X. Joueur - Genou - Absent 4 - 6 semaines');

        assert.equal(r.issue, 'Genou');
        assert.equal(r.status, 'Absent 4 - 6 semaines');
    });

    test('une entrée sans tiret ne garde que le nom', () => {
        assert.deepEqual(parseInjury('Aucune blessure'), {
            player: 'Aucune blessure', issue: null, status: null
        });
    });
});

describe('parseLineup', () => {
    test('trois noms font un trio, deux font une paire de défenseurs', () => {
        const { forwardLines, defensePairs } = parseLineup([
            '               Kreider - Carlssom - Gauthier                      Lacombe - Luneau'
        ]);

        assert.deepEqual(forwardLines, [['Kreider', 'Carlssom', 'Gauthier']]);
        assert.deepEqual(defensePairs, [['Lacombe', 'Luneau']]);
    });

    test('les en-têtes de structure sont écartés', () => {
        const { forwardLines, defensePairs } = parseLineup([
            'ALIGNEMENT PROJETÉ', 'Attaquants', 'Défenseurs', 'Gardiens'
        ]);

        assert.deepEqual(forwardLines, []);
        assert.deepEqual(defensePairs, []);
    });

    test('après l\'en-tête Notes, les colonnes deviennent des blessures', () => {
        const { injuries } = parseLineup([
            '   Kreider - Carlsson - Gauthier',
            '                       Notes / Blessures / Contrats',
            "                       T. Terry - Hanche - Absent jusqu'en novembre"
        ]);

        assert.equal(injuries.length, 1);
        assert.equal(injuries[0].player, 'T. Terry');
    });

    test('l\'en-tête Notes est reconnu même collé à une colonne de l\'alignement', () => {
        // Sur plusieurs pages, -layout n'ouvre pas de gouttière entre la
        // dernière paire de défenseurs et l'en-tête.
        const { defensePairs, injuries } = parseLineup([
            '     Hinds - Jensen        Notes / Blessures / Contrats',
            '     M. Domi - Indéterminé'
        ]);

        assert.deepEqual(defensePairs, [['Hinds', 'Jensen']]);
        assert.equal(injuries.length, 1);
        assert.equal(injuries[0].player, 'M. Domi');
    });

    test('une ligne vide ne produit rien', () => {
        assert.deepEqual(parseLineup(['', '   ']), { forwardLines: [], defensePairs: [], injuries: [] });
    });
});

describe('parseNotes', () => {
    const NOTES = [
        'Valeurs Sûres',
        '',
        'LEO CARLSSON - Après son offre hostile, il devra livrer la marchandise. Tout indique',
        "qu'il sera en mesure de le faire.",
        '',
        'Joueurs à Surveiller',
        '',
        'LUKAS DOSTAL - Fermement établi comme gardien numéro un des Ducks.',
        '',
        'Valeur en Baisse',
        '',
        'ALEX KILLORN - Le vétéran est loin de ses saisons de 60 points.',
        '',
        'Espoirs à Surveiller',
        '',
        'ROGER MCQUEEN - Pourrait se tailler un poste dès cette saison.'
    ];

    test('range chaque note dans sa section', () => {
        const notes = parseNotes(NOTES, equipeANA());

        assert.deepEqual(notes.valeursSures.map(n => n.name), ['Leo Carlsson']);
        assert.deepEqual(notes.joueursASurveiller.map(n => n.name), ['Lukas Dostal']);
        assert.deepEqual(notes.valeurEnBaisse.map(n => n.name), ['Alex Killorn']);
        assert.deepEqual(notes.espoirsASurveiller.map(n => n.name), ['Roger McQueen']);
    });

    test('le nom crié de la trousse est remis en casse de titre', () => {
        // Les pages écrivent « LEO CARLSSON » ; c'est titleCase qui rend le
        // « McQueen » lisible, règle Mc comprise.
        const notes = parseNotes(NOTES, equipeANA());

        assert.equal(notes.valeursSures[0].name, 'Leo Carlsson');
        assert.equal(notes.espoirsASurveiller[0].name, 'Roger McQueen');
    });

    test('les quatre sections existent toujours, même vides', () => {
        const notes = parseNotes([], equipeANA());

        assert.deepEqual(Object.keys(notes).sort(),
            ['espoirsASurveiller', 'joueursASurveiller', 'valeurEnBaisse', 'valeursSures']);
        assert.deepEqual(notes.valeursSures, []);
    });

    test('une note qui déborde sur la ligne suivante est recollée', () => {
        const notes = parseNotes(NOTES, equipeANA());

        assert.match(notes.valeursSures[0].text, /livrer la marchandise\. Tout indique qu'il sera en mesure/);
        assert.ok(!notes.valeursSures[0].text.includes('\n'));
    });

    test('une ligne vide au milieu d\'une section ne coupe pas la note', () => {
        const avecTrou = ['Valeurs Sûres', '', 'UN JOUEUR - début de la note', '', 'suite de la note'];
        const notes = parseNotes(avecTrou, equipeANA());

        assert.equal(notes.valeursSures.length, 1);
        assert.match(notes.valeursSures[0].text, /début de la note suite de la note/);
    });
});

describe('parseTeamPage', () => {
    test('lit une vraie page du guide de bout en bout', () => {
        const guide = parseTeamPage(PAGE, equipeANA());

        assert.equal(guide.team, 'ANA');
        assert.equal(guide.teamName, 'Anaheim Ducks');
        assert.equal(guide.topPicks.forwards[0].name, 'Leo Carlsson');
        assert.equal(guide.topPicks.defensemen[0].name, 'Jackson LaCombe');
        assert.equal(guide.topPicks.goalies[0].name, 'Lukas Dostal');
        assert.ok(guide.lineup.forwardLines.length >= 3, 'les trios sont lus');
        assert.ok(guide.lineup.defensePairs.length >= 3, 'les paires sont lues');
        assert.equal(guide.lineup.injuries[0].player, 'T. Terry');
        assert.equal(guide.notes.valeursSures[0].name, 'Leo Carlsson');
        assert.ok(guide.notes.joueursASurveiller.length >= 1);
    });

    test('une page sans bloc de blessures ne lève pas d\'erreur', () => {
        const sansBlessure = PAGE.filter(l => !l.includes('Notes / Blessures / Contrats') && !l.includes('T. Terry'));

        assert.doesNotThrow(() => parseTeamPage(sansBlessure, equipeANA()));
        assert.deepEqual(parseTeamPage(sansBlessure, equipeANA()).lineup.injuries, []);
    });

    test('une page sans section NOTES rend quatre sections vides', () => {
        const sansNotes = PAGE.slice(0, PAGE.findIndex(l => l.trim() === 'NOTES'));
        const guide = parseTeamPage(sansNotes, equipeANA());

        assert.deepEqual(guide.notes.valeursSures, []);
        assert.deepEqual(guide.notes.espoirsASurveiller, []);
    });
});

describe('linkGuides', () => {
    /** Un guide minimal : une note et un choix, sur une équipe. */
    function guides(nom, abbrev = 'ANA') {
        return {
            [abbrev]: {
                topPicks: { forwards: [{ rank: 1, name: nom }], defensemen: [], goalies: [] },
                notes: { valeursSures: [{ name: nom, text: '' }], joueursASurveiller: [], valeurEnBaisse: [], espoirsASurveiller: [] }
            }
        };
    }
    const joueur = (fullName, lastName, team, over = {}) =>
        ({ fullName, lastName, team, position: 'C', rank: 1, ...over });

    test('un nom complet exact est résolu', () => {
        const g = guides('Leo Carlsson');
        linkGuides(g, [joueur('Leo Carlsson', 'Carlsson', 'ANA')], []);

        assert.equal(g.ANA.topPicks.forwards[0].fullName, 'Leo Carlsson');
        assert.equal(g.ANA.topPicks.forwards[0].playerTeam, 'ANA');
    });

    test('un nom de famille seul est résolu quand il est unique', () => {
        const g = guides('Carlsson');
        linkGuides(g, [joueur('Leo Carlsson', 'Carlsson', 'ANA')], []);

        assert.equal(g.ANA.topPicks.forwards[0].fullName, 'Leo Carlsson');
    });

    test('un nom de famille approchant est accepté DANS la même équipe', () => {
        // « Sandin-Pellika » sur la page contre « Sandin Pellikka » dans la
        // liste : un écart d'une lettre, chez un joueur de l'équipe.
        const g = guides('Sandin-Pellika', 'DET');
        linkGuides(g, [joueur('Axel Sandin Pellikka', 'Sandin Pellikka', 'DET')], []);

        assert.equal(g.DET.topPicks.forwards[0].fullName, 'Axel Sandin Pellikka');
    });

    test('le même nom approchant n\'est PAS accepté à travers les équipes', () => {
        // C'est la moitié dangereuse de la règle : hors de l'équipe, un écart
        // de deux lettres pourrait désigner quelqu'un d'autre.
        const g = guides('Sandin-Pellika', 'DET');
        linkGuides(g, [joueur('Axel Sandin Pellikka', 'Sandin Pellikka', 'BOS')], []);

        assert.equal(g.DET.topPicks.forwards[0].fullName, undefined);
        assert.ok(warnings.some(w => /not found in the player pool/.test(w)));
    });

    test('un nom de famille porté par deux équipes est départagé par l\'équipe de la page', () => {
        const g = guides('Miller', 'VAN');
        linkGuides(g, [
            joueur('J.T. Miller', 'Miller', 'VAN'),
            joueur('Colin Miller', 'Miller', 'NJD')
        ], []);

        assert.equal(g.VAN.topPicks.forwards[0].fullName, 'J.T. Miller');
    });

    test('un joueur trouvé dans une AUTRE équipe est signalé comme désaccord', () => {
        const g = guides('Leo Carlsson');
        linkGuides(g, [joueur('Leo Carlsson', 'Carlsson', 'PHI')], []);

        assert.equal(g.ANA.topPicks.forwards[0].teamConflict, 'PHI');
        assert.ok(warnings.some(w => /the team page lists Leo Carlsson under valeursSures/.test(w)));
    });

    test('un nom introuvable reste non résolu et la note garde son nom brut', () => {
        const g = guides('Personne Inconnue');
        linkGuides(g, [joueur('Leo Carlsson', 'Carlsson', 'ANA')], []);

        const note = g.ANA.notes.valeursSures[0];
        assert.equal(note.fullName, 'Personne Inconnue');
        assert.equal(note.playerTeam, 'ANA');
        assert.equal(note.position, null);
        assert.equal(note.kind, null);
    });

    test('les gardiens sont indexés comme tels', () => {
        const g = guides('Lukas Dostal');
        linkGuides(g, [], [joueur('Lukas Dostal', 'Dostal', 'ANA', { position: 'G' })]);

        assert.equal(g.ANA.notes.valeursSures[0].kind, 'goalie');
        assert.equal(g.ANA.notes.valeursSures[0].position, 'G');
    });
});
