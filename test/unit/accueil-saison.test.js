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

    test('de haut en bas : joueurs du soir, position et total, À surveiller, alignements des 32 clubs', () => {
        const rendu = corpsRendu();
        const ordre = ['soiree.joueurs', 'fzsRangHTML', 'soiree.total', 'data-fz-bloc="surveiller"', 'fzhLinesHTML']
            .map(cle => rendu.indexOf(cle));
        ordre.forEach((pos, i) => assert.ok(pos >= 0, `bloc ${i} absent`));
        assert.deepEqual([...ordre].sort((x, y) => x - y), ordre, 'les blocs doivent suivre cet ordre');
        // Ce qui a quitté l'accueil de saison.
        assert.doesNotMatch(rendu, /fzs-hero|soiree\.repartition|data-fz-bloc="(calendrier|mouvements)"/);
        assert.match(lire('accueil.js'), /fetchNhlNews/, 'le bandeau d’histoires lit toujours les actualités');
    });

    test('le sélecteur d’histoires précède la carte', () => {
        const index = lire('index.html');
        assert.ok(index.indexOf('id="storiesPicker"') < index.indexOf('id="storiesCard"'));
    });

    test('les buts d’une histoire passent par la carte de but du calendrier', () => {
        const accueil = lire('accueil.js');
        assert.match(accueil, /function storyGoalsBlocHTML/);
        assert.match(accueil, /goalCardHTML\(but, equipes\)/);
        assert.match(accueil, /const buts = storyGoalsBlocHTML\(g\);/);
    });

    test('« Joueurs en jeu » a quitté l’accueil ; les joueurs au match à venir y figurent avec leur heure', () => {
        assert.doesNotMatch(SAISON, /Joueurs en jeu|fzs-playing|soiree\.enJeu/);
        assert.match(SAISON, /fzsJoueursAvantMatch/);
        assert.match(SAISON, /gameTimeLabel\(a\.depart\)/);
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

describe('« Ma position » : la semaine du rang et les points par période', () => {
    const { chargerFonctions } = require('../fixtures/helpers.js');
    const AUJ = '2026-10-06';
    const shiftISO = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

    test('l’instantané du matin J donne le soir de J-1 ; un soir sans instantané reste vide', () => {
        const { fzsSemaineRang } = chargerFonctions('accueil-season.js', ['fzsSemaineRang'], { shiftISO });
        const history = [
            { date: '2026-10-01', rank: 5 },  // soir du 30 sept.
            { date: '2026-10-03', rank: 4 },  // soir du 2 oct.
            { date: '2026-10-06', rank: 3 }   // soir d'hier
        ];
        const semaine = fzsSemaineRang(history, 2, AUJ);
        // Array.from : les tableaux du bac à sable n'ont pas le prototype d'ici.
        assert.deepEqual(Array.from(semaine, j => j.date), ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', AUJ]);
        assert.deepEqual(Array.from(semaine, j => j.rang), [5, null, 4, null, null, 3, 2]);
        assert.equal(semaine.at(-1).maintenant, true);
    });

    test('le compte à rebours : heures et minutes, puis « en cours »', () => {
        const { fzsDans } = chargerFonctions('accueil-season.js', ['fzsDans']);
        const depart = '2026-10-06T23:00:00Z';
        const avant = min => Date.parse(depart) - min * 60000;
        assert.equal(fzsDans(depart, avant(134)), 'dans 2 h 14');
        assert.equal(fzsDans(depart, avant(60)), 'dans 1 h 00');
        assert.equal(fzsDans(depart, avant(12)), 'dans 12 min');
        assert.equal(fzsDans(depart, avant(0.5)), 'dans 1 min');
        assert.equal(fzsDans(depart, avant(-3)), 'en cours');
    });

    test('entre deux lectures, seule une période qui finit aujourd’hui prend les points du soir', () => {
        const fzsPoints = {
            activeName: 'P', live: 2,
            data: { periods: {
                1: { points: 4, dernierJour: '2026-10-05' },
                7: { points: 20, dernierJour: AUJ },
                30: { points: null, dernierJour: AUJ }
            } }
        };
        const FZS_PERIODES = [[1], [7], [30]];
        const { fzsValeursPeriodes } = chargerFonctions('accueil-season.js', ['fzsValeursPeriodes'], { fzsPoints, FZS_PERIODES, todayISO: () => AUJ });
        assert.deepEqual({ ...fzsValeursPeriodes('P', 5) }, { 1: 4, 7: 23, 30: null });
        assert.equal(fzsValeursPeriodes('Autre pool', 5), null);
    });
});

describe('« Total ce soir » avant, pendant et sans matchs', () => {
    const { chargerFonctions } = require('../fixtures/helpers.js');
    const AUJ = '2026-10-06';
    const clubs = { 'Auston Matthews': 'TOR', 'Cole Caufield': 'MTL', 'Connor McDavid': 'EDM' };
    function charger(jours) {
        return chargerFonctions('accueil-season.js', ['fzsDans', 'fzsJoueursDuJour', 'fzsProchainSoir', 'fzsMatchsHTML', 'fzsTotalHTML'], {
            escapeHTML: s => String(s),
            fzsHeading: t => `<h2>${t}</h2>`,
            gameTimeLabel: iso => iso.slice(11, 16),
            teamLogoImg: a => `<img alt="${a}">`,
            getPlayerStats: n => (clubs[n] ? { teamAbbrev: clubs[n] } : null),
            fzdPoolH2H: () => false,
            todayISO: () => AUJ,
            shiftISO: (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10),
            calData: { days: jours }
        });
    }
    const match = (away, home) => ({ games: [{ away: { abbrev: away }, home: { abbrev: home } }] });
    const depart = new Date(Date.now() + 3 * 3600000).toISOString();
    const avant = [
        { name: 'Auston Matthews', gameId: 1, depart, away: 'TOR', home: 'MTL' },
        { name: 'Cole Caufield', gameId: 1, depart, away: 'TOR', home: 'MTL' }
    ];
    const names = Object.keys(clubs);

    test('avant le premier match : qui joue, dans quel match, et dans combien de temps — pas « 0 pts »', () => {
        const { fzsTotalHTML } = charger([{ date: AUJ, ...match('TOR', 'MTL') }]);
        const html = fzsTotalHTML({ lines: [], avant, names, playing: 0, total: 0 });
        assert.match(html, /is-before/);
        assert.match(html, /2 <small>joueurs<\/small>/);
        assert.match(html, /dans 1 match/);
        assert.match(html, new RegExp(`data-fzs-depart="${depart}">dans 3 h 00<`));
        assert.match(html, /Matthews, Caufield/);
        assert.doesNotMatch(html, /0 pts/);
    });

    test('relâche : aucun de mes joueurs ce soir, et le prochain soir où ils jouent', () => {
        const { fzsTotalHTML } = charger([
            { date: AUJ, ...match('BOS', 'FLA') },
            { date: '2026-10-08', ...match('EDM', 'VAN') }
        ]);
        const html = fzsTotalHTML({ lines: [], avant: [], names, playing: 0, total: 0 });
        assert.match(html, /Relâche/);
        assert.match(html, /Prochain match <b>jeudi<\/b> · 1 joueur</);
    });

    test('pendant les matchs : le total et l’état de chacun ; la soirée finie le dit', () => {
        const { fzsTotalHTML } = charger([{ date: AUJ, ...match('TOR', 'MTL') }]);
        const lignes = [{ playerName: 'Auston Matthews' }, { playerName: 'Connor McDavid' }];
        const enCours = fzsTotalHTML({ lines: lignes, avant: avant.slice(1), names, playing: 1, total: 3 });
        assert.match(enCours, /3 pts/);
        assert.match(enCours, /1 en jeu/);
        assert.match(enCours, /1 à venir/);
        assert.match(enCours, /1 terminé</);
        const fini = fzsTotalHTML({ lines: lignes, avant: [], names, playing: 0, total: 4 });
        assert.match(fini, /is-done/);
        assert.match(fini, /Soirée terminée/);
        assert.doesNotMatch(fini, /data-fzs-depart/);
    });
});
