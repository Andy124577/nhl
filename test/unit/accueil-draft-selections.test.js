'use strict';

/**
 * Accueil « repêchage en cours » (accueil-draft.js) : le panneau
 * « Alignements » remplace le calendrier de la LNH. Une pastille par équipe
 * du pool, et l'alignement de l'équipe choisie, catégorie par catégorie.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chargerFonctions } = require('../fixtures/helpers.js');

const SOURCE = fs.readFileSync(path.join(__dirname, '../../accueil-draft.js'), 'utf8');

const STATS = {
    'Connor McDavid': { teamAbbrev: 'EDM', position: 'C', playerId: 8478402 },
    'Quinn Hughes': { teamAbbrev: 'VAN', position: 'D', playerId: 8480800 },
    'Kyle Connor': { teamAbbrev: 'WPG', position: 'L', playerId: 8478398 }
};

const {
    fzhLineupTeams, fzhLineupGroups, fzhLineupBodyHTML, fzhLineupTabHTML
} = chargerFonctions(
    'accueil-draft.js',
    ['FZH_POSITIONS', 'fzhLineupTeams', 'fzhLineupGroups', 'fzhClubAbbrev',
     'fzhLineupPlayerHTML', 'fzhLineupBodyHTML', 'fzhLineupTabHTML'],
    {
        escapeHTML: t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
        getPlayerStats: nom => STATS[nom] || null,
        offPlayerFaceHTML: (nom, equipe) => `<span class="fzd-off-face" data-team="${equipe || ''}"></span>`,
        userData: { teamsData: { teams: [{ teamFullName: 'Winnipeg Jets', teamAbbrev: 'WPG' }] } }
    }
);

describe('accueil repêchage — alignements', () => {
    test('le calendrier de la LNH n’a plus d’emplacement pendant le repêchage', () => {
        assert.ok(!SOURCE.includes('data-fz-bloc="calendrier"'));
        assert.ok(!/\brenderCalendar\(\)/.test(SOURCE), 'rien à redessiner : le calendrier reste masqué');
        assert.match(SOURCE, /id="fzhLineups"/);
    });

    test('les équipes suivent l’ordre du premier tour, sans doublon', () => {
        const pool = {
            draftOrder: ['B', 'A', 'C', 'C', 'A', 'B'],
            teams: { A: { members: ['x'] }, B: { members: ['y'] }, C: { members: [] }, D: { members: ['z'] }, E: { members: [] } }
        };
        // D a des membres sans figurer à l'ordre : il vient après. E, vide et
        // hors de l'ordre, ne repêche pas.
        assert.deepEqual([...fzhLineupTeams(pool)], ['B', 'A', 'C', 'D']);
        // Une équipe de l'ordre qui n'existe plus n'a pas d'alignement à montrer.
        assert.deepEqual([...fzhLineupTeams({ draftOrder: ['Z', 'A'], teams: { A: {} } })], ['A']);
    });

    test('les catégories portent la limite du pool et le banc lit ses fiches', () => {
        const groupes = fzhLineupGroups(
            { offensive: ['Connor McDavid'], defensive: [], teams: ['Winnipeg Jets'], bench: [{ nom: 'Kyle Connor' }, 'Quinn Hughes'] },
            { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 0, numTeams: 1 },
            2
        );
        assert.deepEqual([...groupes].map(g => [g.label, g.names.length, g.max]), [
            ['Attaquants', 1, 6], ['Défenseurs', 0, 4], ['Gardiens', 0, 1], ['Équipes LNH', 1, 1], ['Banc', 2, 2]
        ]);
        assert.deepEqual([...groupes.at(-1).names], ['Kyle Connor', 'Quinn Hughes']);
    });

    test('l’alignement montre club et position, et chaque catégorie son compte', () => {
        const html = fzhLineupBodyHTML(fzhLineupGroups(
            { offensive: ['Connor McDavid', 'Kyle Connor'], teams: ['Winnipeg Jets'] },
            { numOffensive: 6, numDefensive: 4, numTeams: 1 }, 0
        ));
        assert.match(html, /Attaquants<span>2 \/ 6<\/span>/);
        assert.match(html, /<strong>Connor McDavid<\/strong><small>EDM · C<\/small>/);
        assert.match(html, /<strong>Kyle Connor<\/strong><small>WPG · AG<\/small>/);
        assert.match(html, /Défenseurs<span>0 \/ 4<\/span><\/p>\s*<p class="fzh-lineup-none">Aucun choix/);
        // Un club : son logo, trouvé par son nom complet.
        assert.match(html, /class="fzh-lineup-player is-club"><span class="fzd-off-face" data-team="WPG">/);
    });

    test('une équipe sans choix le dit, au lieu d’aligner des catégories vides', () => {
        const html = fzhLineupBodyHTML(fzhLineupGroups({}, { numOffensive: 6 }, 0));
        assert.match(html, /Aucun choix pour l’instant/);
        assert.ok(!html.includes('fzh-lineup-group'));
    });

    test('la pastille nomme l’équipe, la mienne et celle qui est au choix', () => {
        const mienne = fzhLineupTabHTML('Les <Glaces>', 2, { pressed: true, mine: true, onClock: true });
        assert.match(mienne, /data-fzh-lineup="2" aria-pressed="true"/);
        assert.match(mienne, /aria-label="Les &lt;Glaces> \(vous\), au choix"/);
        assert.match(mienne, /<span>Les &lt;Glaces><\/span><b aria-hidden="true">Toi<\/b>/);
        assert.match(mienne, /is-on-clock/);

        const autre = fzhLineupTabHTML('B', 0, { pressed: false, mine: false, onClock: false });
        assert.match(autre, /aria-pressed="false" aria-label="B"/);
        assert.ok(!autre.includes('<b ') && !autre.includes('<i '));
    });
});
