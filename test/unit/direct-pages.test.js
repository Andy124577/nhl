'use strict';

/**
 * Les pages qui suivent le direct : la fiche d'équipe du classement se met à
 * jour sur place, l'accueil montre la saison d'un joueur avec ses points du
 * soir, et le calendrier suit les matchs en cours poussés par le serveur au
 * lieu de relire toute la semaine chaque minute.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const FZLive = require('../../lib/pointsEnDirect.js');
const { goaliePoolPoints, clubPoolPoints } = require('../../lib/scoring.js');
const { chargerFonctions, chargerModuleNavigateur } = require('../fixtures/helpers.js');

// ───────────────────────── Classement : la fiche d'équipe ─────────────────────────

describe('classement — fiche d’équipe en direct', () => {
    const seasonStat = (stats, cached, key) => (stats ? stats[key] || 0 : (cached && cached[key]) || 0);

    test('les chiffres d’une rangée : patineur, gardien, club', () => {
        const { statsDeRangee, statsRangeeHTML } = chargerFonctions('classement.js',
            ['statsDeRangee', 'statsRangeeHTML'], { seasonStat, goaliePoolPoints, clubPoolPoints });

        const patineur = statsDeRangee({ type: 'player', stats: { gamesPlayed: 4, goals: 3, assists: 2, points: 5 } });
        assert.deepEqual({ ...patineur }, { gp: 4, stat1: 3, stat1Label: 'B', stat2: 2, stat2Label: 'P', points: 5 });

        const gardien = statsDeRangee({ type: 'goalie', stats: { gamesPlayed: 3, wins: 2, shutouts: 1, otLosses: 1 } });
        assert.equal(gardien.points, goaliePoolPoints({ wins: 2, shutouts: 1, otLosses: 1 }));
        assert.equal(gardien.stat1Label, 'V');

        const club = statsDeRangee({ type: 'team', stats: { gamesPlayed: 5, wins: 3, otLosses: 1 } });
        assert.equal(club.points, clubPoolPoints({ wins: 3, otLosses: 1 }));
        assert.equal(club.stat2Label, 'DP');

        const html = statsRangeeHTML({ ...patineur, stat2: 0 });
        assert.match(html, /<span class="rr-v">3<\/span><span class="rr-l">B<\/span>/);
        assert.match(html, /rr-stat is-zero"><span class="rr-v">0<\/span><span class="rr-l">P/, 'un zéro s’efface');
    });

    test('le rang de l’équipe dans l’en-tête', () => {
        const { sousTitreFiche } = chargerFonctions('classement.js', ['sousTitreFiche']);
        const standings = [{ teamName: 'A', rank: 1, points: 250.4 }, { teamName: 'B', rank: 2, points: 120 }];
        assert.equal(sousTitreFiche({}, standings, 'A'), '1<sup>er</sup> sur 2 · 250 pts');
        assert.equal(sousTitreFiche({ poolMode: 'head-to-head' }, [{ teamName: 'B', rank: 2, wins: 3, losses: 1, ties: 0 }], 'B'),
            '2<sup>e</sup> sur 1 · 3-1-0');
        assert.equal(sousTitreFiche({}, standings, 'Z'), '');
    });

    function fausseRangee(nom) {
        const classes = new Set(['rr-ppts', 'is-zero']);
        const bloc = { innerHTML: 'avant' };
        const valeur = { textContent: '0' };
        const ppts = {
            classList: { toggle: (c, oui) => (oui ? classes.add(c) : classes.delete(c)) },
            querySelector: () => valeur
        };
        return {
            dataset: { player: nom }, bloc, valeur, classes,
            querySelector: sel => (sel === '.rr-stats' ? bloc : sel === '.rr-ppts' ? ppts : null)
        };
    }

    function monterFiche({ vue = 'teamRoster' } = {}) {
        const rangees = [fausseRangee('Connor McDavid'), fausseRangee('Edmonton Oilers')];
        const entete = { innerHTML: '3<sup>e</sup> sur 4 · 100 pts' };
        let statsMcDavid = { gamesPlayed: 4, goals: 3, assists: 2, points: 5 };
        const rosterSale = { players: [{ name: 'Connor McDavid', points: 5 }] };
        const ctx = {
            seasonStat, goaliePoolPoints, clubPoolPoints, rosterSale,
            currentView: vue, VIEW_STATES: { TEAM_ROSTER: 'teamRoster' },
            currentPoolName: 'Pool', currentTeamName: 'Les Castors',
            allPoolsData: { Pool: { poolMode: 'cumulative' } },
            rosterAffiche: [
                { name: 'Connor McDavid', type: 'player', playerId: 8478402 },
                { name: 'Edmonton Oilers', type: 'team' }
            ],
            getCurrentPlayerStats: () => statsMcDavid,
            getCurrentTeamStats: () => ({ gamesPlayed: 5, wins: 3, otLosses: 1 }),
            computeStandings: () => [{ teamName: 'Les Castors', rank: 2, points: 102 }],
            document: {
                querySelectorAll: () => rangees,
                querySelector: sel => (sel === '#rosterHeader .rh-sub' ? entete : null)
            }
        };
        const f = chargerFonctions('classement.js',
            ['statsDeRangee', 'statsRangeeHTML', 'sousTitreFiche', 'rafraichirFicheEnDirect'], ctx);
        return { ...f, rangees, entete, rosterSale, marquer: s => { statsMcDavid = s; } };
    }

    test('un but : les chiffres de la rangée, ses points de pool et le rang de l’en-tête changent sur place', () => {
        const { rafraichirFicheEnDirect, rangees, entete, rosterSale, marquer } = monterFiche();
        marquer({ gamesPlayed: 4, goals: 4, assists: 2, points: 6, pointsEnDirect: 1 });
        rafraichirFicheEnDirect();

        const [mcdavid, club] = rangees;
        assert.match(mcdavid.bloc.innerHTML, /<span class="rr-v">4<\/span><span class="rr-l">B<\/span>/);
        assert.equal(mcdavid.valeur.textContent, 6);
        assert.ok(!mcdavid.classes.has('is-zero'));
        assert.equal(club.valeur.textContent, clubPoolPoints({ wins: 3, otLosses: 1 }));
        assert.equal(rosterSale.players[0].points, 6, 'le panneau de mise en vente suit aussi');
        assert.equal(entete.innerHTML, '2<sup>e</sup> sur 1 · 102 pts');
    });

    test('hors de la fiche d’équipe : rien n’est touché', () => {
        const { rafraichirFicheEnDirect, rangees } = monterFiche({ vue: 'poolStandings' });
        rafraichirFicheEnDirect();
        assert.equal(rangees[0].bloc.innerHTML, 'avant');
    });
});

// ───────────────────────── Accueil : la saison d'un joueur ─────────────────────────

describe('accueil — la saison d’un joueur avec ses points du soir', () => {
    const MCDAVID = { playerId: 8478402, playerName: 'Connor McDavid', position: 'C', goals: 5, assists: 10, points: 15 };

    function monter(direct) {
        const etat = { direct };
        const userData = { statsData: { seasonStarted: true, players: [MCDAVID] } };
        const FZPointsDirect = {
            charge: () => etat.direct,
            joueurs: lignes => (etat.direct ? FZLive.appliquerAuxJoueurs(lignes, etat.direct) : lignes)
        };
        const { getPlayerStats } = chargerFonctions('accueil.js', ['getPlayerStats'], {
            userData, FZPointsDirect, playerStatsIndex: null, playerStatsSource: null,
            window: { location: { pathname: '/' }, FZPointsDirect }
        });
        return { getPlayerStats, etat, userData };
    }

    test('sans direct : les totaux de minuit', () => {
        const { getPlayerStats } = monter(null);
        assert.equal(getPlayerStats('Connor McDavid').points, 15);
        assert.equal(getPlayerStats('Inconnu'), null);
    });

    test('un but ce soir : la saison le compte, et suit le direct suivant', () => {
        const { getPlayerStats, etat } = monter({ joueurs: { [MCDAVID.playerId]: { b: 1 } }, clubs: {} });
        assert.equal(getPlayerStats('Connor McDavid').points, 16);
        etat.direct = { joueurs: { [MCDAVID.playerId]: { b: 1, p: 1 } }, clubs: {} };
        assert.equal(getPlayerStats('Connor McDavid').points, 17);
    });

    test('des relevés relus remplacent l’index', () => {
        const { getPlayerStats, userData } = monter(null);
        getPlayerStats('Connor McDavid');
        userData.statsData = { seasonStarted: true, players: [{ ...MCDAVID, points: 18 }] };
        assert.equal(getPlayerStats('Connor McDavid').points, 18);
    });
});

// ───────────────────────── Calendrier : les matchs en cours ─────────────────────────

describe('calendrier — les matchs en cours suivent le direct', () => {
    function aujourdhui() {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(new Date());
        const v = t => parts.find(p => p.type === t).value;
        return `${v('year')}-${v('month')}-${v('day')}`;
    }

    const JOUR = aujourdhui();
    const ID = 2026020050;
    const matchHoraire = (etat, away, home) => ({
        id: ID, state: etat, startTimeUTC: `${JOUR}T23:00:00Z`, period: 2, periodType: 'REG',
        clock: { timeRemaining: '12:00', inIntermission: false },
        away: { abbrev: 'VAN', score: away }, home: { abbrev: 'EDM', score: home }
    });
    const matchDirect = (away, home, clock = { timeRemaining: '08:23', secondsRemaining: 503, running: false, inIntermission: false }) => ({
        id: ID, state: 'LIVE', period: 2, periodType: 'REG', clock,
        away: { abbrev: 'VAN', score: away }, home: { abbrev: 'EDM', score: home }, events: []
    });

    function monter({ horaires }) {
        const elements = new Map();
        const el = id => {
            if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', hidden: false, value: '', disabled: false, addEventListener() {} });
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
        const ecoutesSocket = new Map();
        const socket = {
            connected: true, emis: [],
            on: (evt, fn) => ecoutesSocket.set(evt, fn),
            emit(evt) { this.emis.push(evt); }
        };
        const lectures = [];
        const fetch = async url => {
            if (url.includes('/schedule/')) {
                lectures.push(url);
                const games = horaires[Math.min(lectures.length - 1, horaires.length - 1)];
                return { ok: true, json: async () => ({ days: [{ date: JOUR, games: [games] }], previousStartDate: null, nextStartDate: null }) };
            }
            return { ok: false, json: async () => ({}) };
        };
        chargerModuleNavigateur('calendrier.js', {
            document, fetch, URLSearchParams, Promise, CSS: { escape: s => s },
            window: { location: { hostname: 'fantazy.ca', origin: 'https://fantazy.ca', search: '' }, fzSocketPartage: () => socket },
            setInterval: () => 0, clearInterval() {}
        });
        return {
            demarrer: async () => { ecoutesDoc.DOMContentLoaded(); await new Promise(r => setImmediate(r)); },
            pousser: async (evt, charge) => { ecoutesSocket.get(evt)(charge); await new Promise(r => setImmediate(r)); },
            socket, lectures, cartes: () => el('calGames').innerHTML
        };
    }

    test('un match en cours : la page s’abonne au direct, un but s’affiche sans relire la semaine', async () => {
        const page = monter({ horaires: [matchHoraire('LIVE', 1, 0)] });
        await page.demarrer();
        assert.deepEqual(page.socket.emis, ['scores:suivre']);
        assert.match(page.cartes(), /cal-team-score">1</);

        await page.pousser('scores:tout', { games: [matchDirect(2, 0)], ageMs: 0 });
        assert.match(page.cartes(), /cal-team-score">2</, 'le but tombe tout de suite');
        assert.match(page.cartes(), /class="cal-clock"[^>]*>08:23</, 'l’horloge du direct');
        assert.equal(page.lectures.length, 1, 'la semaine n’est pas relue');
    });

    test('un match qui sort de la liste vient de finir : la semaine est relue une fois, et le direct s’arrête', async () => {
        const page = monter({ horaires: [matchHoraire('LIVE', 1, 0), matchHoraire('FINAL', 3, 2)] });
        await page.demarrer();
        await page.pousser('scores:tout', { games: [], ageMs: 0 });
        await new Promise(r => setImmediate(r));
        assert.equal(page.lectures.length, 2);
        assert.match(page.cartes(), /Final/);
        assert.equal(page.socket.emis.at(-1), 'scores:arreter', 'plus rien en cours : plus de direct');
    });

    test('aucun match en cours : pas d’abonnement', async () => {
        const page = monter({ horaires: [matchHoraire('FUT', 0, 0)] });
        await page.demarrer();
        assert.deepEqual(page.socket.emis, []);
    });
});
