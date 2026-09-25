'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    SLUGS_DFO, urlDFO, normaliser, extraireCombinaisons, lireEffectif, apparier, lireStats, formerAlignement
} = require('../../lib/alignement.js');
const {
    creerAlignements, EquipeInconnue, TTL_TRIOS_MS, RELANCE_APRES_ECHEC_MS
} = require('../../services/alignement.js');

/* ─── Formes exactes des trois sources, réduites ───────────────────────── */

/** Un joueur de Daily Faceoff, aux champs de `combinations.players`. */
function dfo(name, groupIdentifier, positionIdentifier, over = {}) {
    const categories = { f: 'ev', d: 'ev', g: 'ev', pp: 'pp', pk: 'pk', ir: 'oi' };
    const famille = /^[a-z]+/.exec(groupIdentifier)[0];
    return {
        playerId: 1, name, jerseyNumber: null,
        positionIdentifier, groupIdentifier, groupName: groupIdentifier,
        categoryIdentifier: categories[famille] || 'oi',
        injuryStatus: null, gameTimeDecision: false,
        ...over
    };
}

/** Une page d'équipe de Daily Faceoff : le JSON de Next.js dans son HTML. */
function page(players, over = {}) {
    const donnees = {
        props: {
            pageProps: {
                slug: 'montreal-canadiens',
                combinations: {
                    teamAbbreviation: 'MTL',
                    sourceName: 'Training Camp 2026',
                    source: '',
                    updatedAt: '2026-09-24T18:09:28.411Z',
                    players,
                    ...over
                }
            }
        }
    };
    return `<!DOCTYPE html><html><head></head><body><div id="__next"></div>`
        + `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(donnees)}</script></body></html>`;
}

const JOUEURS_MTL = [
    dfo('Chris Kreider', 'f1', 'lw', { jerseyNumber: 22 }),
    dfo('Nick Suzuki', 'f1', 'c', { jerseyNumber: 14 }),
    dfo('Cole Caufield', 'f1', 'rw', { jerseyNumber: 13 }),
    dfo('Zack Bolduc', 'f3', 'lw', { jerseyNumber: 76 }),
    dfo('Ivan Demidov', 'f2', 'rw'),
    dfo('Oliver Kapanen', 'f2', 'c'),
    dfo('Juraj Slafkovsky', 'f2', 'lw', { jerseyNumber: 20 }),
    dfo('Noah Dobson', 'd1', 'rd', { jerseyNumber: 8 }),
    dfo('Mike Matheson', 'd1', 'ld', { jerseyNumber: 8 }),
    dfo('Jacob Fowler', 'g', 'g2', { jerseyNumber: 32 }),
    dfo('Jakub Dobes', 'g', 'g1', { jerseyNumber: 75 }),
    dfo('Nick Suzuki', 'pp1', 'sk2', { jerseyNumber: 14 }),
    dfo('Lane Hutson', 'pp1', 'sk5', { jerseyNumber: 48 }),
    dfo('Phillip Danault', 'pk1', 'sk1', { jerseyNumber: 24 }),
    dfo('Kaiden Guhle', 'ir', 'ir1', { jerseyNumber: 21, injuryStatus: 'out' })
];

/** Un joueur de `/v1/roster/{club}/current`. */
function nhl(id, first, last, num, pos) {
    return {
        id, headshot: `https://assets.nhle.com/mugs/nhl/20262027/MTL/${id}.png`,
        firstName: { default: first }, lastName: { default: last },
        sweaterNumber: num, positionCode: pos
    };
}

const EFFECTIF_MTL = {
    forwards: [
        nhl(8475184, 'Chris', 'Kreider', 22, 'L'),
        nhl(8480018, 'Nick', 'Suzuki', 14, 'C'),
        nhl(8481540, 'Cole', 'Caufield', 13, 'R'),
        nhl(8482737, 'Zachary', 'Bolduc', 76, 'R'),
        nhl(8484984, 'Ivan', 'Demidov', 93, 'R'),
        nhl(8482775, 'Oliver', 'Kapanen', 91, 'C'),
        nhl(8483515, 'Juraj', 'Slafkovský', 20, 'L'),
        nhl(8477018, 'Phillip', 'Danault', 24, 'C'),
        nhl(8484980, 'Florian', 'Xhekaj', 63, 'L')
    ],
    defensemen: [
        nhl(8480865, 'Noah', 'Dobson', 53, 'D'),
        nhl(8476875, 'Mike', 'Matheson', 8, 'D'),
        nhl(8483457, 'Lane', 'Hutson', 48, 'D'),
        nhl(8482110, 'Kaiden', 'Guhle', 21, 'D'),
        nhl(8482964, 'Arber', 'Xhekaj', 72, 'D')
    ],
    goalies: [
        nhl(8482452, 'Jakub', 'Dobes', 75, 'G'),
        nhl(8485477, 'Jacob', 'Fowler', 32, 'G')
    ]
};

const STATS_PATINEURS = {
    data: [
        { playerId: 8480018, skaterFullName: 'Nick Suzuki', gamesPlayed: 82, goals: 29, assists: 72, points: 101, plusMinus: 37, timeOnIcePerGame: 1249.4 },
        { playerId: 8475184, skaterFullName: 'Chris Kreider', gamesPlayed: 75, goals: 22, assists: 28, points: 50, plusMinus: -4, timeOnIcePerGame: 1022.9 },
        { playerId: 8477503, skaterFullName: 'Max Domi', gamesPlayed: 70, goals: 10, assists: 20, points: 30, plusMinus: 0, timeOnIcePerGame: 900 }
    ]
};
const STATS_GARDIENS = {
    data: [
        { playerId: 8482452, goalieFullName: 'Jakub Dobes', gamesPlayed: 43, wins: 29, losses: 10, otLosses: 4, goalsAgainstAverage: 2.77955, savePct: 0.90143, shutouts: 0 }
    ]
};

const SAISON = { seasonId: 20252026, label: '2025-26', hasStarted: false };

/* ─── lib/alignement.js ────────────────────────────────────────────────── */

describe('extraireCombinaisons', () => {
    test('lit le JSON de Next.js et ne garde que ce qui sert', () => {
        const c = extraireCombinaisons(page(JOUEURS_MTL));
        assert.equal(c.updatedAt, '2026-09-24T18:09:28.411Z');
        assert.equal(c.sourceName, 'Training Camp 2026');
        assert.equal(c.sourceUrl, null, 'une source vide n’est pas un lien');
        assert.equal(c.players.length, JOUEURS_MTL.length);
        assert.deepEqual(c.players[0], {
            name: 'Chris Kreider', number: 22, group: 'f1', groupName: 'f1',
            category: 'ev', slot: 'lw', injury: null, gtd: false
        });
        assert.equal(c.players.find(p => p.name === 'Kaiden Guhle').injury, 'out');
    });

    test('le lien de la source n’est gardé que s’il en est un', () => {
        const lien = 'https://x.com/BagleyKSLsports/status/2100641347309113625';
        assert.equal(extraireCombinaisons(page(JOUEURS_MTL, { source: lien })).sourceUrl, lien);
        assert.equal(extraireCombinaisons(page(JOUEURS_MTL, { source: 'Practice report' })).sourceUrl, null);
    });

    test('une page d’une autre forme rend null, jamais une liste vide', () => {
        assert.equal(extraireCombinaisons(''), null);
        assert.equal(extraireCombinaisons(null), null);
        assert.equal(extraireCombinaisons('<html><title>Attention Required! | Cloudflare</title></html>'), null);
        assert.equal(extraireCombinaisons('<script id="__NEXT_DATA__" type="application/json">{pas du json</script>'), null);
        assert.equal(extraireCombinaisons(page([])), null);
        assert.equal(extraireCombinaisons(page([{ name: 'Sans groupe' }])), null);
    });
});

describe('apparier', () => {
    const effectif = lireEffectif(EFFECTIF_MTL);

    test('nom complet, accents compris', () => {
        assert.equal(apparier('Juraj Slafkovsky', 20, effectif).id, 8483515);
        assert.equal(normaliser('Juraj Slafkovský'), normaliser('Juraj Slafkovsky'));
    });

    test('un diminutif retrouve le joueur par son nom de famille et son initiale', () => {
        assert.equal(apparier('Zack Bolduc', null, effectif).id, 8482737);
    });

    test('deux frères du même club se séparent au prénom', () => {
        assert.equal(apparier('Arber Xhekaj', null, effectif).id, 8482964);
        assert.equal(apparier('Florian Xhekaj', null, effectif).id, 8484980);
    });

    test('un homonyme d’une autre initiale n’est pas le même joueur', () => {
        // Un joueur échangé que Daily Faceoff n'a pas encore retiré ne doit
        // pas prendre la photo et le numéro d'un autre Suzuki.
        assert.equal(apparier('Ryan Suzuki', null, effectif), null);
    });

    test('le même numéro suffit quand le prénom diffère', () => {
        const avecTony = [...effectif, { id: 1, firstName: 'Anthony', lastName: 'Deangelo', number: 77, position: 'D' }];
        assert.equal(apparier('Tony DeAngelo', 77, avecTony).id, 1);
        assert.equal(apparier('Tony DeAngelo', null, avecTony), null);
    });

    test('inconnu : null', () => {
        assert.equal(apparier('Alberts Smits', null, effectif), null);
        assert.equal(apparier('', 3, effectif), null);
    });
});

describe('lireStats', () => {
    test('patineurs et gardiens, indexés par identifiant et par nom', () => {
        const s = lireStats(STATS_PATINEURS, STATS_GARDIENS);
        assert.deepEqual(s.parId.get(8480018), { gp: 82, g: 29, a: 72, pts: 101, pm: 37, toi: '20:49' });
        assert.deepEqual(s.parId.get(8482452), { gp: 43, w: 29, l: 10, otl: 4, gaa: 2.77955, svPct: 0.90143, so: 0 });
        assert.deepEqual(s.parNom.get('max domi'), [8477503]);
    });

    test('une réponse vide ne plante pas', () => {
        const s = lireStats(null, {});
        assert.equal(s.parId.size, 0);
    });
});

describe('formerAlignement', () => {
    const effectif = lireEffectif(EFFECTIF_MTL);
    const stats = lireStats(STATS_PATINEURS, STATS_GARDIENS);
    const combinaisons = extraireCombinaisons(page(JOUEURS_MTL));
    const a = formerAlignement({ equipe: 'MTL', combinaisons, effectif, stats, saison: SAISON, genereLe: 'x' });

    test('trios dans l’ordre, positions dans l’ordre AG, C, AD', () => {
        assert.equal(a.lines, true);
        assert.deepEqual(a.forwards.map(g => g.id), ['f1', 'f2', 'f3']);
        assert.deepEqual(a.forwards[1].players.map(p => p.slot), ['lw', 'c', 'rw']);
        assert.deepEqual(a.defense[0].players.map(p => p.slot), ['ld', 'rd']);
        assert.deepEqual(a.goalies.map(p => p.slot), ['g1', 'g2']);
    });

    test('le numéro et la photo viennent de la LNH, pas de Daily Faceoff', () => {
        const dobson = a.defense[0].players.find(p => p.lastName === 'Dobson');
        assert.equal(dobson.number, 53, 'Daily Faceoff lui donnait le 8 de Matheson');
        assert.equal(dobson.id, 8480865);
        assert.match(dobson.headshot, /8480865\.png$/);
        const demidov = a.forwards[1].players.find(p => p.slot === 'rw');
        assert.equal(demidov.number, 93, 'absent chez Daily Faceoff');
    });

    test('le nom officiel remplace le diminutif', () => {
        const bolduc = a.forwards[2].players[0];
        assert.equal(bolduc.name, 'Zachary Bolduc');
        assert.equal(bolduc.lastName, 'Bolduc');
    });

    test('statistiques jointes par identifiant', () => {
        assert.equal(a.forwards[0].players[1].stats.pts, 101);
        assert.equal(a.goalies[0].stats.w, 29);
        assert.equal(a.forwards[1].players[1].stats, null, 'aucune ligne pour Kapanen dans ces données');
    });

    test('unités spéciales, blessés, saison et source', () => {
        assert.deepEqual(a.powerPlay.map(g => g.id), ['pp1']);
        assert.deepEqual(a.penaltyKill[0].players.map(p => p.name), ['Phillip Danault']);
        assert.equal(a.injuries[0].name, 'Kaiden Guhle');
        assert.equal(a.injuries[0].status, 'out');
        assert.deepEqual(a.statsSeason, { id: 20252026, label: '2025-26', started: false });
        assert.equal(a.source.url, urlDFO('MTL'));
        assert.equal(a.source.updatedAt, '2026-09-24T18:09:28.411Z');
        assert.equal(a.stale, false);
        assert.equal(a.roster, null);
    });

    test('un joueur absent de l’effectif prend son identifiant dans les statistiques', () => {
        const c = extraireCombinaisons(page([dfo('Max Domi', 'f1', 'c', { jerseyNumber: 11 })]));
        const domi = formerAlignement({ equipe: 'TOR', combinaisons: c, effectif, stats }).forwards[0].players[0];
        assert.equal(domi.id, 8477503);
        assert.equal(domi.number, 11);
        assert.equal(domi.headshot, 'https://assets.nhle.com/mugs/nhl/latest/8477503.png');
    });

    test('un inconnu partout garde son nom, sans photo ni fiche', () => {
        const c = extraireCombinaisons(page([dfo('Alberts Smits', 'd3', 'ld')]));
        const smits = formerAlignement({ equipe: 'NYR', combinaisons: c, effectif, stats }).defense[0].players[0];
        assert.equal(smits.id, null);
        assert.equal(smits.headshot, null);
        assert.equal(smits.firstName, 'Alberts');
        assert.equal(smits.lastName, 'Smits');
    });

    test('un groupe inconnu n’est pas perdu', () => {
        const c = extraireCombinaisons(page([dfo('Nick Suzuki', 'scr', 'scr1', { groupName: 'Healthy Scratches' })]));
        const autres = formerAlignement({ equipe: 'MTL', combinaisons: c, effectif, stats }).others;
        assert.deepEqual(autres.map(o => [o.id, o.label, o.players.length]), [['scr', 'Healthy Scratches', 1]]);
    });

    test('sans trios : l’effectif officiel, par position et par numéro', () => {
        const r = formerAlignement({ equipe: 'MTL', combinaisons: null, perime: true, effectif, stats });
        assert.equal(r.lines, false);
        assert.equal(r.stale, false, 'rien de périmé à signaler quand il n’y a pas de trios');
        assert.equal(r.source, null);
        assert.deepEqual(r.roster.defense.map(p => p.number), [8, 21, 48, 53, 72]);
        assert.equal(r.roster.goalies.length, 2);
        assert.equal(r.roster.forwards.length, 9);
        assert.equal(r.forwards.length, 0);
    });

    test('toutes les équipes de la LNH ont leur page', () => {
        assert.equal(Object.keys(SLUGS_DFO).length, 32);
        assert.equal(urlDFO('UTA'), 'https://www.dailyfaceoff.com/teams/utah-mammoth/line-combinations');
    });
});

describe('cas limites des sources', () => {
    test('deux homonymes de même initiale : le numéro tranche, sinon personne', () => {
        const effectif = [
            { id: 1, firstName: 'Ryan', lastName: 'Smith', number: 10, position: 'C' },
            { id: 2, firstName: 'Reilly', lastName: 'Smith', number: 19, position: 'R' }
        ];
        assert.equal(apparier('Rob Smith', 19, effectif).id, 2);
        assert.equal(apparier('Rob Smith', 55, effectif), null);
        assert.equal(apparier('Rob Smith', null, effectif), null);
    });

    test('effectif : noms en chaîne, fiches incomplètes, position par défaut', () => {
        const e = lireEffectif({
            forwards: [{ id: 5, firstName: 'Nick', lastName: null, positionCode: 'C' }, { firstName: 'Sans id' }, null],
            defensemen: [{ id: 6, firstName: { fr: 'x' }, lastName: { default: 'Doe' } }],
            goalies: [{ id: 7, firstName: { default: 'Sam' }, lastName: { default: 'Goal' }, sweaterNumber: 35 }]
        });
        assert.deepEqual(e.map(p => [p.id, p.firstName, p.lastName, p.number, p.position, p.headshot]), [
            [5, 'Nick', '', null, 'C', null],
            [6, '', 'Doe', null, 'D', null],
            [7, 'Sam', 'Goal', 35, 'G', null]
        ]);
        assert.deepEqual(lireEffectif(null), []);
    });

    test('combinaisons sans date ni motif, numéros qui ne sont pas des entiers', () => {
        const c = extraireCombinaisons(page(
            [dfo('Nick Suzuki', 'f1', 'c', { jerseyNumber: '14', groupName: null, categoryIdentifier: null, gameTimeDecision: 1 })],
            { updatedAt: null, sourceName: null, source: null }
        ));
        assert.equal(c.updatedAt, null);
        assert.equal(c.sourceName, null);
        assert.deepEqual(c.players[0], {
            name: 'Nick Suzuki', number: null, group: 'f1', groupName: null,
            category: null, slot: 'c', injury: null, gtd: true
        });
        assert.equal(extraireCombinaisons('<script id="__NEXT_DATA__" type="application/json">{}</script>'), null);
    });

    test('statistiques : lignes sans identifiant ignorées, homonymes ambigus', () => {
        const s = lireStats({
            data: [
                { playerId: 1, skaterFullName: 'Sebastian Aho' },
                { playerId: 2, skaterFullName: 'Sebastian Aho' },
                { skaterFullName: 'Sans id' },
                { playerId: 3 },
                null
            ]
        }, { data: [{ goalieFullName: 'Sans id' }, null] });
        assert.deepEqual(s.parNom.get('sebastian aho'), [1, 2]);
        assert.deepEqual(s.parId.get(1), { gp: null, g: null, a: null, pts: null, pm: null, toi: null });
        assert.equal(s.parId.size, 3);

        // Deux Sebastian Aho dans la ligue : aucun des deux n'est choisi.
        const c = extraireCombinaisons(page([dfo('Sebastian Aho', 'f1', 'c'), dfo('Inconnu', 'f1', 'x')]));
        const a = formerAlignement({ equipe: 'CAR', combinaisons: c, effectif: [], stats: s });
        assert.equal(a.forwards[0].players[0].id, null);
        assert.equal(a.forwards[0].players[1].lastName, 'Inconnu', 'un nom d’un seul mot reste le nom de famille');
    });

    test('sans statistiques ni saison, sans trios ni effectif', () => {
        const c = extraireCombinaisons(page(JOUEURS_MTL));
        const a = formerAlignement({ equipe: 'MTL', combinaisons: c, effectif: lireEffectif(EFFECTIF_MTL) });
        assert.equal(a.statsSeason, null);
        assert.equal(a.forwards[0].players[0].stats, null);
        assert.equal(a.generatedAt, null);

        const vide = formerAlignement({ equipe: 'MTL' });
        assert.deepEqual(vide.roster, { forwards: [], defense: [], goalies: [] });

        const sansNumero = formerAlignement({
            equipe: 'MTL',
            effectif: [
                { id: 1, firstName: 'A', lastName: 'B', number: null, position: 'D' },
                { id: 2, firstName: 'C', lastName: 'D', number: 4, position: 'D' },
                { id: 3, firstName: 'E', lastName: 'F', number: null, position: null }
            ]
        });
        assert.deepEqual(sansNumero.roster.defense.map(p => p.id), [2, 1], 'sans numéro, en dernier');
        assert.equal(sansNumero.roster.defense[0].stats, null);
    });
});

/* ─── services/alignement.js ───────────────────────────────────────────── */

const silencieux = { warn() {}, error() {} };

/** `routes` : fragment d'URL → réponse (objet, chaîne HTML, code HTTP ou Error). */
function fauxFetch(routes) {
    const appels = [];
    const fetchImpl = async (url, options = {}) => {
        const cle = Object.keys(routes).find(k => url.includes(k));
        appels.push({ cle: cle || url, headers: options.headers });
        const r = cle ? routes[cle] : 500;
        if (r instanceof Error) throw r;
        if (typeof r === 'number') return { ok: false, status: r, json: async () => ({}), text: async () => '' };
        return { ok: true, status: 200, json: async () => r, text: async () => r };
    };
    const compte = cle => appels.filter(a => a.cle === cle).length;
    return { fetchImpl, appels, compte };
}

function routesMTL(over = {}) {
    return {
        'montreal-canadiens': page(JOUEURS_MTL),
        '/roster/MTL/current': EFFECTIF_MTL,
        'skater/summary': STATS_PATINEURS,
        'goalie/summary': STATS_GARDIENS,
        ...over
    };
}

function fausseBase(depart = {}) {
    const rangees = new Map(Object.entries(depart));
    const ecritures = [];
    return {
        ecritures,
        async loadCachedStats(cle) { return rangees.has(cle) ? { ...rangees.get(cle), lastUpdated: 'x' } : null; },
        async saveCachedStats(cle, donnees) { ecritures.push(cle); rangees.set(cle, donnees); }
    };
}

describe('creerAlignements', () => {
    test('fond les trois sources en un alignement', async () => {
        const { fetchImpl, appels } = fauxFetch(routesMTL());
        const service = creerAlignements({ fetchImpl, logger: silencieux, saison: async () => SAISON });
        const a = await service.lire('mtl');
        assert.equal(a.team, 'MTL');
        assert.equal(a.lines, true);
        assert.equal(a.forwards[0].players[1].stats.pts, 101);
        assert.equal(appels.length, 4);
        const dfoAppel = appels.find(x => x.cle === 'montreal-canadiens');
        assert.match(dfoAppel.headers['User-Agent'], /Mozilla/, 'sans en-têtes de navigateur, Cloudflare refuse');
    });

    test('club inconnu : EquipeInconnue, sans appel réseau', async () => {
        const { fetchImpl, appels } = fauxFetch({});
        const service = creerAlignements({ fetchImpl, logger: silencieux });
        for (const code of ['XYZ', '', null, 'ARI', '__proto__', 'constructor']) {
            await assert.rejects(service.lire(code), EquipeInconnue);
        }
        assert.equal(appels.length, 0);
    });

    test('trios gardés dix minutes, puis relus', async () => {
        let horloge = 1_000_000;
        const { fetchImpl, compte } = fauxFetch(routesMTL());
        const service = creerAlignements({ fetchImpl, logger: silencieux, maintenant: () => horloge, saison: async () => SAISON });
        await service.lire('MTL');
        horloge += TTL_TRIOS_MS - 1;
        await service.lire('MTL');
        assert.equal(compte('montreal-canadiens'), 1);
        assert.equal(compte('skater/summary'), 1, 'statistiques partagées, encore fraîches');
        horloge += 2;
        await service.lire('MTL');
        assert.equal(compte('montreal-canadiens'), 2);
    });

    test('deux lectures simultanées partagent les mêmes requêtes', async () => {
        const { fetchImpl, appels } = fauxFetch(routesMTL());
        const service = creerAlignements({ fetchImpl, logger: silencieux, saison: async () => SAISON });
        await Promise.all([service.lire('MTL'), service.lire('MTL')]);
        assert.equal(appels.length, 4);
    });

    test('Daily Faceoff refuse : derniers trios connus, marqués périmés, puis on attend avant de redemander', async () => {
        let horloge = 1_000_000;
        const routes = routesMTL();
        const { fetchImpl, compte } = fauxFetch(routes);
        const service = creerAlignements({ fetchImpl, logger: silencieux, maintenant: () => horloge, saison: async () => SAISON });
        await service.lire('MTL');

        routes['montreal-canadiens'] = '<html><title>Attention Required! | Cloudflare</title></html>';
        horloge += TTL_TRIOS_MS + 1;
        const a = await service.lire('MTL');
        assert.equal(a.lines, true);
        assert.equal(a.stale, true);
        assert.equal(a.source.updatedAt, '2026-09-24T18:09:28.411Z', 'l’âge réel, pas l’heure de l’échec');
        assert.equal(compte('montreal-canadiens'), 2);

        horloge += RELANCE_APRES_ECHEC_MS - 1;
        await service.lire('MTL');
        assert.equal(compte('montreal-canadiens'), 2, 'pas de nouvelle tentative tout de suite');

        routes['montreal-canadiens'] = page(JOUEURS_MTL);
        horloge += 2;
        const b = await service.lire('MTL');
        assert.equal(b.stale, false);
        assert.equal(compte('montreal-canadiens'), 3);
    });

    test('après un redémarrage, la base sert les derniers trios si Daily Faceoff refuse', async () => {
        const combinaisons = extraireCombinaisons(page(JOUEURS_MTL));
        const db = fausseBase({ lineup_MTL: combinaisons });
        const { fetchImpl } = fauxFetch(routesMTL({ 'montreal-canadiens': 403 }));
        const a = await creerAlignements({ db, fetchImpl, logger: silencieux, saison: async () => SAISON }).lire('MTL');
        assert.equal(a.lines, true);
        assert.equal(a.stale, true);
        assert.equal(a.forwards[0].players[0].name, 'Chris Kreider');
        assert.equal(db.ecritures.length, 0);
    });

    test('la base n’est écrite que quand Daily Faceoff a publié du nouveau', async () => {
        let horloge = 1_000_000;
        const db = fausseBase();
        const routes = routesMTL();
        const { fetchImpl } = fauxFetch(routes);
        const service = creerAlignements({ db, fetchImpl, logger: silencieux, maintenant: () => horloge });
        await service.lire('MTL');
        horloge += TTL_TRIOS_MS + 1;
        await service.lire('MTL');
        assert.deepEqual(db.ecritures, ['lineup_MTL'], 'même heure de mise à jour : rien à réécrire');

        routes['montreal-canadiens'] = page(JOUEURS_MTL, { updatedAt: '2026-09-25T15:00:00.000Z' });
        horloge += TTL_TRIOS_MS + 1;
        await service.lire('MTL');
        assert.equal(db.ecritures.length, 2);
    });

    test('une base en panne ne casse rien : ni à l’écriture, ni à la lecture', async () => {
        const erreurs = [];
        const logger = { warn() {}, error: m => erreurs.push(m) };
        const db = {
            loadCachedStats: async () => { throw new Error('pg down'); },
            saveCachedStats: async () => { throw new Error('pg down'); }
        };
        const ok = fauxFetch(routesMTL());
        const a = await creerAlignements({ db, fetchImpl: ok.fetchImpl, logger }).lire('MTL');
        assert.equal(a.lines, true);

        const refus = fauxFetch(routesMTL({ 'montreal-canadiens': 403 }));
        const b = await creerAlignements({ db, fetchImpl: refus.fetchImpl, logger }).lire('MTL');
        assert.equal(b.lines, false);
        await new Promise(r => setImmediate(r));
        assert.equal(erreurs.length, 2, 'une erreur d’écriture, une de lecture, journalisées');
    });

    test('oublier() vide les caches', async () => {
        const { fetchImpl, appels } = fauxFetch(routesMTL());
        const service = creerAlignements({ fetchImpl, logger: silencieux, saison: async () => SAISON });
        await service.lire('MTL');
        service.oublier();
        await service.lire('MTL');
        assert.equal(appels.length, 8);
    });

    test('ni trios ni base : l’effectif officiel', async () => {
        const { fetchImpl } = fauxFetch(routesMTL({ 'montreal-canadiens': new Error('ECONNRESET') }));
        const a = await creerAlignements({ fetchImpl, logger: silencieux, saison: async () => SAISON }).lire('MTL');
        assert.equal(a.lines, false);
        assert.equal(a.roster.goalies.length, 2);
    });

    test('statistiques en panne ou saison inconnue : l’alignement sort quand même', async () => {
        const { fetchImpl } = fauxFetch(routesMTL({ 'skater/summary': 500 }));
        const a = await creerAlignements({ fetchImpl, logger: silencieux, saison: async () => SAISON }).lire('MTL');
        assert.equal(a.forwards[0].players[0].stats, null);

        const sansSaison = fauxFetch(routesMTL());
        const b = await creerAlignements({
            fetchImpl: sansSaison.fetchImpl, logger: silencieux, saison: async () => { throw new Error('calendrier'); }
        }).lire('MTL');
        assert.equal(b.statsSeason, null);
        assert.equal(sansSaison.compte('skater/summary'), 0);
    });

    test('rien de rien : une erreur, pas un alignement vide', async () => {
        const { fetchImpl } = fauxFetch({ 'montreal-canadiens': 500, '/roster/MTL/current': 500 });
        await assert.rejects(
            creerAlignements({ fetchImpl, logger: silencieux }).lire('MTL'),
            err => !(err instanceof EquipeInconnue)
        );
    });
});
