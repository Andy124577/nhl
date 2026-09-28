'use strict';

/**
 * Accueil « repêchage en cours » (accueil-draft.js) : le panneau
 * « Sélections » remplace le calendrier de la LNH. Une pastille par équipe
 * du pool, et les choix de l'équipe choisie, catégorie par catégorie. La
 * carte « Alignements » (maquette « Accueil v2 »), à la place de l'ancien
 * « Mes choix », mène aux trios des 32 clubs de la LNH (onglet
 * « Alignements » de stats.html), chaque tuile à ceux de son club.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chargerFonctions } = require('../fixtures/helpers.js');

const SOURCE = fs.readFileSync(path.join(__dirname, '../../accueil-draft.js'), 'utf8');
const LINEUP = fs.readFileSync(path.join(__dirname, '../../statsLineup.js'), 'utf8');

// Un tableau sur plusieurs lignes n'a pas d'accolades à compter : on le lit
// tel quel dans la source.
const FZH_AL_CLUBS = vm.runInNewContext(SOURCE.match(/^const FZH_AL_CLUBS = (\[[\s\S]*?\n\]);/m)[1]);

const STATS = {
    'Connor McDavid': { teamAbbrev: 'EDM', position: 'C', playerId: 8478402 },
    'Quinn Hughes': { teamAbbrev: 'VAN', position: 'D', playerId: 8480800 },
    'Kyle Connor': { teamAbbrev: 'WPG', position: 'L', playerId: 8478398 }
};

const {
    fzhPicksTeams, fzhPicksGroups, fzhPicksBodyHTML, fzhPicksTabHTML, fzhLinesHTML
} = chargerFonctions(
    'accueil-draft.js',
    ['FZH_POSITIONS', 'fzhPicksTeams', 'fzhPicksGroups', 'fzhClubAbbrev',
     'fzhPicksPlayerHTML', 'fzhPicksBodyHTML', 'fzhPicksTabHTML',
     'fzhIcon', 'FZH_LINES_URL', 'fzhAlTuileHTML', 'fzhLinesHTML'],
    {
        FZH_AL_CLUBS,
        escapeHTML: t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
        getPlayerStats: nom => STATS[nom] || null,
        offPlayerFaceHTML: (nom, equipe) => `<span class="fzd-off-face" data-team="${equipe || ''}"></span>`,
        userData: { teamsData: { teams: [{ teamFullName: 'Winnipeg Jets', teamAbbrev: 'WPG' }] } }
    }
);

describe('accueil repêchage — alignements', () => {
    const tuiles = html => [...html.matchAll(/<a class="fzh-al-club( is-ombre)?" href="([^"]+)" style="([^"]+)"[^>]*>([A-Z]{3})<\/a>/g)]
        .map(m => ({ ombre: !!m[1], href: m[2], style: m[3], code: m[4] }));

    test('« Alignements » remplace « Mes choix »', () => {
        assert.ok(!SOURCE.includes('Mes choix'), 'le compte de mes choix n’a plus sa carte');
        assert.match(SOURCE, /\$\{fzhLinesHTML\(\)\}/);
    });

    test('la carte mène à l’onglet « Alignements » de stats.html', () => {
        const html = fzhLinesHTML();
        assert.match(html, /<section class="fzh-al" aria-labelledby="fzhAlTitre">/);
        assert.match(html, /<a class="fzh-al-lien" href="stats\.html\?onglet=alignements">/);
        assert.match(html, /<span class="fzh-al-sur">32 clubs · LNH<\/span><h2 id="fzhAlTitre">Alignements<\/h2>/);
        assert.match(html, /<span class="fzh-al-fleche" aria-hidden="true">→<\/span>/);
        assert.match(html, /Trios, paires et unités spéciales de chaque équipe/);
        // L'adresse ne sert que si stats.html l'ouvre encore sur cet onglet.
        assert.match(LINEUP, /params\.get\('onglet'\) === 'alignements'/);
    });

    test('trente-deux tuiles, chacune vers l’alignement de son club', () => {
        const liste = tuiles(fzhLinesHTML());
        assert.equal(liste.length, 32);
        assert.equal(new Set(liste.map(t => t.code)).size, 32, 'aucun club en double');
        // Chaque code doit être un club que la page des alignements connaît,
        // sinon ?equipe= retomberait sur le club par défaut.
        const connus = new Set([...LINEUP.match(/const CLUBS = \[([\s\S]*?)\]\s*\.sort/)[1].matchAll(/\['([A-Z]{3})'/g)].map(m => m[1]));
        assert.deepEqual([...liste.map(t => t.code)].sort(), [...connus].sort());
        for (const t of liste) assert.equal(t.href, `stats.html?onglet=alignements&amp;equipe=${t.code}`);
        assert.match(LINEUP, /params\.get\('equipe'\)/);
        assert.match(fzhLinesHTML(), /aria-label="Alignement : Montréal Canadiens" title="Montréal Canadiens">MTL</);
    });

    test('les tuiles portent leurs couleurs, l’arc du survol et le damier du repos', () => {
        const liste = tuiles(fzhLinesHTML());
        const arc = t => Number(t.style.match(/--arc:(-?[\d.]+)px/)[1]);
        const delai = t => Number(t.style.match(/--delai:(\d+)ms/)[1]);
        assert.match(liste[0].style, /^--fond:#F47A38;--encre:#000;/);
        // Huit par rangée : rien aux bords, l'arc le plus haut au centre.
        assert.equal(arc(liste[0]), 0);
        assert.equal(arc(liste[7]), 0);
        assert.ok(arc(liste[3]) < -2.9 && arc(liste[4]) < -2.9);
        // La vague part du coin : un cran par colonne, un par rangée.
        assert.deepEqual([0, 1, 8, 9, 31].map(i => delai(liste[i])), [0, 25, 25, 50, 250]);
        assert.deepEqual(liste.slice(0, 10).map(t => t.ombre), [false, true, false, true, false, true, false, true, true, false]);
    });

    test('la carte partage la rangée d’« À surveiller », le compte à rebours passe plus bas', () => {
        const surveiller = SOURCE.indexOf('data-fz-bloc="surveiller"');
        const carte = SOURCE.indexOf('${fzhLinesHTML()}');
        const horssaison = SOURCE.indexOf('data-fz-bloc="horssaison"');
        assert.ok(surveiller > 0 && surveiller < carte && carte < horssaison);
    });
});

describe('accueil repêchage — sélections', () => {
    test('le calendrier de la LNH n’a plus d’emplacement pendant le repêchage', () => {
        assert.ok(!SOURCE.includes('data-fz-bloc="calendrier"'));
        assert.ok(!/\brenderCalendar\(\)/.test(SOURCE), 'rien à redessiner : le calendrier reste masqué');
        assert.match(SOURCE, /id="fzhPicks"/);
        assert.match(SOURCE, /<span id="fzhPicksTitle">Sélections<\/span>/);
    });

    test('les équipes suivent l’ordre du premier tour, sans doublon', () => {
        const pool = {
            draftOrder: ['B', 'A', 'C', 'C', 'A', 'B'],
            teams: { A: { members: ['x'] }, B: { members: ['y'] }, C: { members: [] }, D: { members: ['z'] }, E: { members: [] } }
        };
        // D a des membres sans figurer à l'ordre : il vient après. E, vide et
        // hors de l'ordre, ne repêche pas.
        assert.deepEqual([...fzhPicksTeams(pool)], ['B', 'A', 'C', 'D']);
        // Une équipe de l'ordre qui n'existe plus n'a pas d'alignement à montrer.
        assert.deepEqual([...fzhPicksTeams({ draftOrder: ['Z', 'A'], teams: { A: {} } })], ['A']);
    });

    test('les catégories portent la limite du pool et le banc lit ses fiches', () => {
        const groupes = fzhPicksGroups(
            { offensive: ['Connor McDavid'], defensive: [], teams: ['Winnipeg Jets'], bench: [{ nom: 'Kyle Connor' }, 'Quinn Hughes'] },
            { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 0, numTeams: 1 },
            2
        );
        assert.deepEqual([...groupes].map(g => [g.label, g.names.length, g.max]), [
            ['Attaquants', 1, 6], ['Défenseurs', 0, 4], ['Gardiens', 0, 1], ['Équipes LNH', 1, 1], ['Banc', 2, 2]
        ]);
        assert.deepEqual([...groupes.at(-1).names], ['Kyle Connor', 'Quinn Hughes']);
    });

    test('les sélections montrent club et position, et chaque catégorie son compte', () => {
        const html = fzhPicksBodyHTML(fzhPicksGroups(
            { offensive: ['Connor McDavid', 'Kyle Connor'], teams: ['Winnipeg Jets'] },
            { numOffensive: 6, numDefensive: 4, numTeams: 1 }, 0
        ));
        assert.match(html, /Attaquants<span>2 \/ 6<\/span>/);
        assert.match(html, /<strong>Connor McDavid<\/strong><small>EDM · C<\/small>/);
        assert.match(html, /<strong>Kyle Connor<\/strong><small>WPG · AG<\/small>/);
        assert.match(html, /Défenseurs<span>0 \/ 4<\/span><\/p>\s*<p class="fzh-picks-none">Aucun choix/);
        // Un club : son logo, trouvé par son nom complet.
        assert.match(html, /class="fzh-picks-player is-club"><span class="fzd-off-face" data-team="WPG">/);
    });

    test('une équipe sans choix le dit, au lieu d’aligner des catégories vides', () => {
        const html = fzhPicksBodyHTML(fzhPicksGroups({}, { numOffensive: 6 }, 0));
        assert.match(html, /Aucun choix pour l’instant/);
        assert.ok(!html.includes('fzh-picks-group'));
    });

    test('la pastille nomme l’équipe, la mienne et celle qui est au choix', () => {
        const mienne = fzhPicksTabHTML('Les <Glaces>', 2, { pressed: true, mine: true, onClock: true });
        assert.match(mienne, /data-fzh-pick="2" aria-pressed="true"/);
        assert.match(mienne, /aria-label="Les &lt;Glaces> \(vous\), au choix"/);
        assert.match(mienne, /<span>Les &lt;Glaces><\/span><b aria-hidden="true">Toi<\/b>/);
        assert.match(mienne, /is-on-clock/);

        const autre = fzhPicksTabHTML('B', 0, { pressed: false, mine: false, onClock: false });
        assert.match(autre, /aria-pressed="false" aria-label="B"/);
        assert.ok(!autre.includes('<b ') && !autre.includes('<i '));
    });
});
