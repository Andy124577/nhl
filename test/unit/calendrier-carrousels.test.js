'use strict';

/**
 * Les carrousels sous chaque match du calendrier (calendrier.js) : les buts
 * d'un match commencé ; d'un match à venir, les meneurs des deux clubs cette
 * saison et leur fiche (GET /day-preview), puis mes joueurs qui y sont.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { chargerModuleNavigateur } = require('../fixtures/helpers.js');

function aujourdhui() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const v = t => parts.find(p => p.type === t).value;
    return `${v('year')}-${v('month')}-${v('day')}`;
}

const JOUR = aujourdhui();
const match = (id, etat, away, home, score = [null, null]) => ({
    id, state: etat, startTimeUTC: `${JOUR}T23:00:00Z`, period: 3, periodType: 'REG', clock: null,
    away: { abbrev: away, score: score[0] }, home: { abbrev: home, score: score[1] }
});
const but = (name, awayScore, homeScore, period, timeInPeriod) => ({
    playerId: 1, name, goalsToDate: 4, headshot: '', teamAbbrev: 'MTL', period, periodType: 'REG',
    timeInPeriod, awayScore, homeScore, assists: [{ name: 'N. Suzuki', assistsToDate: 6 }]
});
const meneur = (id, prenom, nom, club, numero, pos, cat, val) => ({ id, prenom, nom, photo: '', club, numero, pos, cat, val });

function monter({ games, buts = {}, apercu = {}, monEquipe = null, stats = [] }) {
    const elements = new Map();
    const el = id => {
        if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', hidden: false, disabled: false, addEventListener() {} });
        return elements.get(id);
    };
    const ecoutesDoc = {};
    const document = {
        hidden: false,
        getElementById: el,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: (evt, fn) => { ecoutesDoc[evt] = fn; }
    };
    const lectures = [];
    const fetch = async url => {
        lectures.push(url);
        const ok = donnees => ({ ok: true, json: async () => donnees });
        if (url.includes('/schedule/')) return ok({ days: [{ date: JOUR, games }], previousStartDate: null, nextStartDate: null });
        if (url.includes('/day-goals/')) return ok({ date: JOUR, games: buts, live: {} });
        if (url.includes('/day-preview/')) return ok({ date: JOUR, games: apercu });
        if (url.includes('/current-stats')) return ok({ seasonStarted: true, players: stats });
        return { ok: false, json: async () => ({}) };
    };
    const FZPool = monEquipe && { ready: async () => {}, team: () => ({ data: monEquipe }), on() {} };
    const socket = { connected: true, on() {}, emit() {} };
    chargerModuleNavigateur('calendrier.js', {
        document, fetch, URLSearchParams, Promise, CSS: { escape: s => s },
        window: { location: { hostname: 'fantazy.ca', origin: 'https://fantazy.ca', search: '' }, FZPool, fzSocketPartage: () => socket },
        FZPool,
        setInterval: () => 0, clearInterval() {}
    });
    return {
        demarrer: async () => {
            ecoutesDoc.DOMContentLoaded();
            for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
        },
        cartes: () => el('calGames').innerHTML,
        lectures
    };
}

describe('calendrier — carrousels sous les matchs', () => {
    test('match terminé : ses buts, du premier au dernier, avec la marque après chacun', async () => {
        const page = monter({
            games: [match(2026020026, 'OFF', 'MTL', 'PIT', [2, 0])],
            buts: { 2026020026: [but('Cole Caufield', 1, 0, 1, '04:12'), but('Nick Suzuki', 2, 0, 3, '18:40')] }
        });
        await page.demarrer();
        const html = page.cartes();
        assert.match(html, /data-car="buts"/);
        assert.match(html, /Du premier au dernier/);
        assert.ok(html.indexOf('Cole Caufield') < html.indexOf('Nick Suzuki'), 'chronologique');
        assert.match(html, /MTL 1 - PIT 0 <span class="cal-goal-when">1<sup>re<\/sup> · 04:12/);
        assert.match(html, /N\. Suzuki <span class="cal-car-tally">\(6\)<\/span>/, 'l’aide et son total');
    });

    test('mon joueur au pointage, buteur ou passeur : son nom en rouge, reconnu par son numéro', async () => {
        const butDeSuzuki = {
            ...but('Nick Suzuki', 1, 0, 1, '04:12'), playerId: 8480018,
            assists: [{ playerId: 8481540, name: 'C. Caufield', assistsToDate: 2 }, { playerId: 99, name: 'L. Hutson', assistsToDate: 5 }]
        };
        const page = monter({
            games: [match(11, 'OFF', 'MTL', 'PIT', [1, 0])],
            buts: { 11: [butDeSuzuki] },
            monEquipe: { offensive: ['Nick Suzuki', 'Cole Caufield'] },
            stats: [
                { playerId: 8480018, playerName: 'Nick Suzuki', teamAbbrev: 'MTL', position: 'C' },
                { playerId: 8481540, playerName: 'Cole Caufield', teamAbbrev: 'MTL', position: 'R' }
            ]
        });
        await page.demarrer();
        const html = page.cartes();
        assert.match(html, /<span class="cal-car-mine">Nick Suzuki<span class="fz-sk-sr"> \(mon joueur\)<\/span><\/span>/, 'le buteur');
        assert.match(html, /<span class="cal-car-mine">C\. Caufield<span class="fz-sk-sr">/, 'le passeur, nom abrégé par la LNH');
        assert.doesNotMatch(html, /cal-car-mine">L\. Hutson/, 'pas les autres');
    });

    test('match en cours : le but le plus récent d’abord', async () => {
        const page = monter({
            games: [match(7, 'LIVE', 'MTL', 'PIT', [2, 0])],
            buts: { 7: [but('Cole Caufield', 1, 0, 1, '04:12'), but('Nick Suzuki', 2, 0, 2, '18:40')] }
        });
        await page.demarrer();
        const html = page.cartes();
        assert.match(html, /Le plus récent d’abord/);
        assert.ok(html.indexOf('Nick Suzuki') < html.indexOf('Cole Caufield'));
    });

    test('match à venir sans mes joueurs : la fiche des clubs et leurs meneurs, comme à la LNH', async () => {
        const page = monter({
            games: [match(9, 'FUT', 'CAR', 'MTL')],
            apercu: {
                9: {
                    away: { fiche: '1-1-1' }, home: { fiche: '1-0-1' },
                    meneurs: [
                        meneur(8478427, 'Sebastian', 'Aho', 'CAR', 20, 'C', 'goals', 3),
                        meneur(8481540, 'Cole', 'Caufield', 'MTL', 13, 'R', 'goals', 1),
                        meneur(8480018, 'Nick', 'Suzuki', 'MTL', 14, 'C', 'assists', 0),
                        meneur(8478470, 'Sam', 'Montembeault', 'MTL', 35, 'G', 'wins', 2)
                    ]
                }
            }
        });
        await page.demarrer();
        const html = page.cartes();
        assert.match(html, /<span class="cal-team-rec"><span class="fz-sk-sr">Fiche <\/span>1-1-1<\/span>/);
        assert.match(html, /1-0-1/);
        assert.match(html, /data-car="meneurs"/);
        assert.match(html, /Meneurs par équipe/);
        assert.match(html, /<span class="cal-lead-first">Sebastian<\/span>/);
        assert.match(html, /data-player="8478427" data-name="Sebastian Aho">Aho<\/button>/, 'le nom ouvre sa fiche');
        assert.match(html, /CAR • #20 • C/);
        assert.match(html, /<b>3<\/b><span>Buts<\/span>/);
        assert.match(html, /MTL • #13 • AD[\s\S]*<b>1<\/b><span>But<\/span>/, 'le singulier jusqu’à un');
        assert.match(html, /<b>2<\/b><span>Victoires<\/span>/);
        assert.doesNotMatch(html, /Suzuki/, 'un meneur à zéro n’en est pas un');
        assert.doesNotMatch(html, /data-car="miens"/);
        assert.match(html, /<a class="cal-game-box" href="match.html\?id=9">Zone de match<\/a>/);
        assert.equal(page.lectures.filter(u => u.includes('/day-preview/')).length, 1, 'une seule requête, pas de boucle');
    });

    test('match à venir avec mes joueurs : les meneurs, puis mes joueurs et leur saison', async () => {
        const page = monter({
            games: [match(8, 'FUT', 'MTL', 'TOR')],
            monEquipe: { offensive: ['Nick Suzuki'], goalie: ['Sam Montembeault'] },
            stats: [
                { playerId: 8480018, playerName: 'Nick Suzuki', teamAbbrev: 'MTL', position: 'C', headshot: '', points: 4 },
                { playerId: 8478470, playerName: 'Sam Montembeault', teamAbbrev: 'MTL', position: 'G', headshot: '', wins: 1 }
            ],
            apercu: { 8: { away: { fiche: '2-0-0' }, home: { fiche: '0-2-0' }, meneurs: [meneur(1, 'Cole', 'Caufield', 'MTL', 13, 'R', 'goals', 3)] } }
        });
        await page.demarrer();
        const html = page.cartes();
        assert.match(html, /data-car="meneurs"/);
        assert.match(html, /data-car="miens"/);
        assert.ok(html.indexOf('data-car="meneurs"') < html.indexOf('data-car="miens"'), 'les meneurs d’abord');
        assert.match(html, /<span class="cal-lead-first">Nick<\/span>/);
        assert.match(html, /data-name="Nick Suzuki">Suzuki<\/button>/);
        assert.match(html, /MTL • C<\/span>/);
        assert.match(html, /<b>4<\/b><span>Points<\/span>/);
        assert.match(html, /<b>1<\/b><span>Victoire<\/span>/, 'un gardien : ses victoires');
        assert.match(html, /class="cal-game is-mine"/);
    });

    test('match absent de l’aperçu : ni meneurs ni fiche, et une seule requête pour la journée', async () => {
        const page = monter({ games: [match(12, 'FUT', 'MTL', 'TOR'), match(13, 'OFF', 'BOS', 'NYR', [1, 0])] });
        await page.demarrer();
        const html = page.cartes();
        assert.doesNotMatch(html, /data-car="meneurs"/);
        assert.doesNotMatch(html, /cal-team-rec/);
        assert.equal(page.lectures.filter(u => u.includes('/day-preview/')).length, 1);
    });

    test('une journée sans match à venir ne demande pas d’aperçu', async () => {
        const page = monter({ games: [match(14, 'OFF', 'BOS', 'NYR', [1, 0])] });
        await page.demarrer();
        assert.equal(page.lectures.filter(u => u.includes('/day-preview/')).length, 0);
        assert.match(page.cartes(), /<span class="cal-pill">Final<\/span>/);
    });
});
