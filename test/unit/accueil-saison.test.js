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

    test('de haut en bas, comme la maquette « 6b Éditorial » : position, mes joueurs, activité ; matchs, meilleurs, classements ; alignements, À lire', () => {
        const rendu = corpsRendu();
        const ordre = ['fzsHeroHTML', 'fzsJoueursHTML', 'fzsActiviteHTML', 'fzsMatchsHTML', 'fzsMeilleursHTML', 'fzsClassementHTML', 'fzsAlignementsHTML', 'data-fz-bloc="actualites"']
            .map(cle => rendu.indexOf(cle));
        ordre.forEach((pos, i) => assert.ok(pos >= 0, `bloc ${i} absent`));
        assert.deepEqual([...ordre].sort((x, y) => x - y), ordre, 'les blocs doivent suivre cet ordre');
        // Au téléphone, une seule colonne dans l'ordre de la maquette.
        const css = lire('accueil-season.css');
        const rang = cls => Number(css.match(new RegExp(`\\.fzs \\.${cls} \\{ order: (\\d+); \\}`))[1]);
        const telephone = ['fzs-hero', 'fzs-games', 'fzs-mine', 'fzs-top', 'fzs-activity', 'fzs-ranks', 'fzs-lines', 'fzs-read'].map(rang);
        assert.deepEqual([...telephone].sort((x, y) => x - y), telephone);
        // Les alignements des 32 clubs juste avant À lire.
        assert.equal(rang('fzs-read') - rang('fzs-lines'), 1);
        // Le bandeau d'histoires reste caché : on ne lui prend que son direct.
        assert.match(rendu, /data-fz-bloc="histoires" hidden/);
        assert.doesNotMatch(rendu, /data-fz-bloc="(calendrier|mouvements|meilleurs|surveiller)"/);
        assert.match(lire('accueil.js'), /fetchNhlNews/, 'le bandeau d’histoires lit toujours les actualités');
        assert.doesNotMatch(lire('accueil.js'), /type: 'news', article/);
        assert.match(lire('accueil.js'), /renderHomeNews\(news\)/);
        assert.match(lire('index.html'), /id="fzHomeNewsTitle">À lire</);
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

describe('les sections de la maquette', () => {
    const { chargerFonctions } = require('../fixtures/helpers.js');
    const AUJ = '2026-10-21';

    test('statut d’un match : en direct avec la période, final, ou l’heure', () => {
        const { fzsStatutMatch } = chargerFonctions('accueil-season.js',
            ['fzsOrdinal', 'FZS_EN_DIRECT', 'FZS_FINI', 'fzsPeriode', 'fzsStatutMatch'], { gameTimeLabel: () => '19 h 00' });
        assert.equal(fzsStatutMatch({ state: 'LIVE', period: 2, periodType: 'REG', clock: { timeRemaining: '12:41' } }), 'En direct · 2e · 12:41');
        assert.equal(fzsStatutMatch({ state: 'CRIT', period: 1, clock: { timeRemaining: '00:00', inIntermission: true } }), 'En direct · Entracte');
        assert.equal(fzsStatutMatch({ state: 'LIVE', period: 4, periodType: 'OT', clock: { timeRemaining: '3:10' } }), 'En direct · Prol. · 3:10');
        assert.equal(fzsStatutMatch({ state: 'FINAL', periodType: 'SO' }), 'Final · TB');
        assert.equal(fzsStatutMatch({ state: 'OFF', periodType: 'REG' }), 'Final');
        assert.equal(fzsStatutMatch({ state: 'FUT', startTimeUTC: '2026-10-21T23:00:00Z' }), 'Ce soir · 19 h 00');
    });

    test('les matchs du jour : le calendrier, mis à jour par les feuilles et le direct ; en direct, à venir, puis finis', () => {
        const g = (id, state, start, extra = {}) => ({ id, state, startTimeUTC: start, away: { abbrev: `A${id}`, score: 0 }, home: { abbrev: `H${id}`, score: 0 }, ...extra });
        const storySlides = [{ type: 'live', game: { id: 2, state: 'LIVE', away: { abbrev: 'A2', score: 3 }, home: { abbrev: 'H2', score: 1 } } }];
        const { fzsMatchsDuJour } = chargerFonctions('accueil-season.js', ['FZS_EN_DIRECT', 'FZS_FINI', 'fzsMatchsDuJour'], {
            todayISO: () => AUJ, storySlides,
            calData: { days: [{ date: AUJ, games: [g(1, 'FINAL', '2026-10-21T17:00:00Z'), g(2, 'FUT', '2026-10-21T23:00:00Z'), g(3, 'FUT', '2026-10-22T01:00:00Z'), g(4, 'FUT', '2026-10-21T23:30:00Z')] }] }
        });
        const matchs = fzsMatchsDuJour({ games: [g(1, 'FINAL', undefined, { away: { abbrev: 'A1', score: 2 }, home: { abbrev: 'H1', score: 5 } })] });
        assert.deepEqual(Array.from(matchs, m => m.id), [2, 4, 3, 1]);
        assert.equal(matchs[0].away.score, 3, 'le direct l’emporte sur le calendrier');
        assert.equal(matchs[0].startTimeUTC, '2026-10-21T23:00:00Z', 'l’heure du calendrier reste');
        assert.equal(matchs[3].home.score, 5, 'les feuilles du soir donnent le pointage final');
    });

    test('ce soir pour un club : en jeu, final, l’heure contre l’adversaire, ou repos', () => {
        const { fzsCeSoirClub } = chargerFonctions('accueil-season.js', ['FZS_EN_DIRECT', 'FZS_FINI', 'fzsContre', 'fzsCeSoirClub'], { gameTimeLabel: () => '22 h 30' });
        const matchs = [
            { state: 'LIVE', away: { abbrev: 'TOR' }, home: { abbrev: 'MTL' } },
            { state: 'FUT', startTimeUTC: 'x', away: { abbrev: 'COL' }, home: { abbrev: 'EDM' } },
            { state: 'OFF', away: { abbrev: 'BOS' }, home: { abbrev: 'FLA' } }
        ];
        assert.equal(fzsCeSoirClub('MTL', matchs), 'vs TOR · En jeu');
        assert.equal(fzsCeSoirClub('COL', matchs), '@ EDM · 22 h 30');
        assert.equal(fzsCeSoirClub('EDM', matchs), 'vs COL · 22 h 30');
        assert.equal(fzsCeSoirClub('BOS', matchs), '@ FLA · Final');
        assert.equal(fzsCeSoirClub('TBL', matchs), 'Repos');
    });

    test('la semaine suit le barème du pool : buts + aides au cumulatif, points fantasy en tête-à-tête', () => {
        const joueurs = [
            { playerName: 'A', position: 'C', points: 5, totalFantasyPoints: 20 },
            { playerName: 'B', position: 'C', points: 7, totalFantasyPoints: 18.6 },
            { playerName: 'G', position: 'G', wins: 3, shutouts: 1, totalFantasyPoints: 30 }
        ];
        const charger = h2h => chargerFonctions('accueil-season.js', ['fzsPointsSemaine', 'fzsTrierSemaine'], {
            fzdPoolH2H: () => h2h,
            goaliePoolPoints: g => (g.shutouts || 0) * 5 + ((g.wins || 0) - (g.shutouts || 0)) * 2
        });
        assert.deepEqual(Array.from(charger(false).fzsTrierSemaine(joueurs), p => `${p.playerName}:${p.pts}`), ['G:9', 'B:7', 'A:5']);
        assert.deepEqual(Array.from(charger(true).fzsTrierSemaine(joueurs), p => `${p.playerName}:${p.pts}`), ['G:30', 'A:20', 'B:19']);
    });

    test('positions à la française et noms comparés sans accents', () => {
        const { fzsPosition, fzsCle } = chargerFonctions('accueil-season.js', ['fzsPosition', 'fzsCle']);
        assert.deepEqual(['C', 'L', 'R', 'D', 'G'].map(fzsPosition), ['C', 'AG', 'AD', 'D', 'G']);
        assert.equal(fzsCle('Alexis Lafrenière'), fzsCle('alexis lafreniere'));
    });
});
