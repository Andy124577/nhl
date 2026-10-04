'use strict';

/**
 * Les carrousels sous chaque match du calendrier (calendrier.js) : les buts
 * d'un match commencé ; d'un match à venir, mes joueurs qui y sont avec leurs
 * statistiques, ou, sans eux, les meneurs des deux clubs à leurs derniers
 * matchs.
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
const meneur = (id, nom, b, a) => ({ id, nom, pos: 'R', pj: 2, b, a, p: b + a, photo: '' });

function monter({ games, buts = {}, forme = { clubs: {}, joueurs: {} }, monEquipe = null, stats = [] }) {
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
        if (url.includes('/team-form?')) return ok(forme);
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

    test('match à venir avec mes joueurs : leur saison et leurs derniers matchs', async () => {
        const page = monter({
            games: [match(8, 'FUT', 'MTL', 'TOR')],
            monEquipe: { offensive: ['Nick Suzuki'] },
            stats: [{ playerId: 8480018, playerName: 'Nick Suzuki', teamAbbrev: 'MTL', position: 'C', headshot: '', gamesPlayed: 2, goals: 1, assists: 3, points: 4 }],
            forme: {
                clubs: { MTL: { matchs: 2, buteur: meneur(1, 'Cole Caufield', 3, 0), pointeur: null }, TOR: { matchs: 3, buteur: null, pointeur: null } },
                joueurs: { 8480018: { club: 'MTL', matchs: 2, pos: 'C', pj: 2, b: 1, a: 3, p: 4 } }
            }
        });
        await page.demarrer();
        const html = page.cartes();
        assert.match(html, /data-car="miens"/);
        assert.doesNotMatch(html, /data-car="meneurs"/, 'mes joueurs prennent la place des meneurs');
        assert.match(html, /<div class="is-key"><dt>Pts<\/dt><dd>4<\/dd><\/div>/);
        assert.match(html, /MTL · C/);
        assert.match(html, /<span>2 derniers matchs<\/span><b>1 B · 3 A · 4 Pts<\/b>/);
        const forme = page.lectures.filter(u => u.includes('/team-form?'));
        assert.ok(forme.some(u => /joueurs=8480018/.test(u)), 'ma ligne est demandée');
    });

    test('match à venir sans mes joueurs : buteur et pointeur de chaque club, une seule carte s’ils ne font qu’un', async () => {
        const nylander = meneur(8, 'William Nylander', 2, 1);
        const page = monter({
            games: [match(9, 'FUT', 'MTL', 'TOR')],
            forme: {
                clubs: {
                    MTL: { matchs: 2, buteur: meneur(1, 'Cole Caufield', 3, 0), pointeur: meneur(2, 'Nick Suzuki', 1, 3) },
                    TOR: { matchs: 2, buteur: nylander, pointeur: nylander }
                },
                joueurs: {}
            }
        });
        await page.demarrer();
        const html = page.cartes();
        assert.match(html, /data-car="meneurs"/);
        assert.match(html, /<span class="cal-car-sub">2 derniers matchs<\/span>/);
        assert.match(html, /Meilleur buteur · MTL/);
        assert.match(html, /Meilleur pointeur · MTL/);
        assert.match(html, /Meilleur buteur et pointeur · TOR/);
        assert.equal((html.match(/William Nylander/g) || []).length, 1);
        assert.equal(page.lectures.filter(u => u.includes('/team-form?')).length, 1, 'une seule requête, pas de boucle');
    });

    test('clubs à des nombres de matchs différents : le sous-titre le dit', async () => {
        const page = monter({
            games: [match(10, 'FUT', 'MTL', 'TOR')],
            forme: {
                clubs: {
                    MTL: { matchs: 2, buteur: meneur(1, 'Cole Caufield', 3, 0), pointeur: null },
                    TOR: { matchs: 3, buteur: meneur(8, 'William Nylander', 2, 1), pointeur: null }
                },
                joueurs: {}
            }
        });
        await page.demarrer();
        assert.match(page.cartes(), /Derniers matchs · MTL 2 · TOR 3/);
    });
});
