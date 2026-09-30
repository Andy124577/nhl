'use strict';

/**
 * Le calendrier et la feuille de match disent la même chose (lib/horaire.js).
 *
 * Le 30 septembre 2026 au matin, calendrier.html montrait encore
 * Vancouver-Edmonton « En direct » (5-4, 3e période) alors que match.html le
 * disait terminé : la semaine, demandée par son lundi, était gardée douze
 * heures telle qu'on l'avait lue pendant le match, et rien ne la recoupait.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const H = require('../../lib/horaire.js');
const { chargerFonctions } = require('../fixtures/helpers.js');

const COURT = 60 * 1000, LONG = 12 * 60 * 60 * 1000;

/** La semaine du 28 septembre telle que le cache la gardait. */
const semaineFigee = () => ({
    days: [
        { date: '2026-09-28', games: [] },
        { date: '2026-09-29', games: [
            { id: 2026020003, state: 'OFF', startTimeUTC: '2026-09-30T00:00:00Z', period: 3, periodType: 'REG', clock: null, away: { abbrev: 'NYR', score: 0 }, home: { abbrev: 'BOS', score: 3 } },
            { id: 2026020004, state: 'LIVE', startTimeUTC: '2026-09-30T02:00:00Z', period: 3, periodType: 'REG', clock: { timeRemaining: '04:12', inIntermission: false }, away: { abbrev: 'VAN', score: 5 }, home: { abbrev: 'EDM', score: 4 } }
        ] },
        { date: '2026-09-30', games: [
            { id: 2026020006, state: 'FUT', startTimeUTC: '2026-09-30T23:00:00Z', period: null, periodType: null, clock: null, away: { abbrev: 'OTT', score: null }, home: { abbrev: 'MTL', score: null } }
        ] }
    ]
});

/** La feuille du match (lib/boxscore.js, formerFeuille), celle de match.html. */
const feuilleOff = { id: 2026020004, state: 'OFF', period: 4, periodType: 'OT', lastPeriodType: 'OT', clock: { timeRemaining: '00:00', inIntermission: false }, away: { score: 6 }, home: { score: 5 } };

describe('la durée de garde d’une semaine', () => {
    test('demandée par son lundi un mercredi : garde courte (c’était douze heures)', () => {
        const ttl = H.dureeGardeHoraire(semaineFigee(), { aujourdhui: '2026-09-30', demande: '2026-09-28', courtMs: COURT, longMs: LONG });
        assert.equal(ttl, COURT);
    });

    test('une semaine lointaine, toute jouée : garde longue', () => {
        const passee = { days: [{ date: '2026-10-12', games: [{ id: 1, state: 'OFF' }] }] };
        assert.equal(H.dureeGardeHoraire(passee, { aujourdhui: '2026-11-30', demande: '2026-10-12', courtMs: COURT, longMs: LONG }), LONG);
    });

    test('un match encore dit en cours, même loin d’aujourd’hui : garde courte', () => {
        const figee = { days: [{ date: '2026-10-12', games: [{ id: 1, state: 'LIVE' }] }] };
        assert.equal(H.dureeGardeHoraire(figee, { aujourdhui: '2026-11-30', demande: '2026-10-12', courtMs: COURT, longMs: LONG }), COURT);
    });

    test('une réponse vide demandée pour la semaine en cours : garde courte', () => {
        assert.equal(H.dureeGardeHoraire({ days: [] }, { aujourdhui: '2026-09-30', demande: '2026-09-28', courtMs: COURT, longMs: LONG }), COURT);
        assert.equal(H.dureeGardeHoraire(null, { aujourdhui: '2026-09-30', courtMs: COURT, longMs: LONG }), LONG);
    });
});

describe('fusionner : un état n’avance que', () => {
    test('le match figé « En direct » devient « Terminé » d’après sa feuille', () => {
        const frais = new Map([[2026020004, H.etatDeFeuille(feuilleOff)]]);
        const fusion = H.fusionnerHoraire(semaineFigee(), frais);
        const m = fusion.days[1].games[1];
        assert.equal(m.state, 'OFF');
        assert.deepEqual([m.away.score, m.home.score, m.period, m.periodType], [6, 5, 4, 'OT']);
        assert.equal(fusion.days[1].games[0].state, 'OFF', 'un match sans source fraîche reste tel quel');
    });

    test('une source en retard ne fait pas reculer un match terminé', () => {
        const terminee = H.fusionnerMatch({ id: 1, state: 'OFF', away: { score: 6 }, home: { score: 5 } },
            { id: 1, state: 'LIVE', away: 5, home: 4 });
        assert.equal(terminee.state, 'OFF');
        assert.equal(terminee.away.score, 6);
    });

    test('à rang égal, la source fraîche donne le pointage et l’horloge', () => {
        const enCours = H.fusionnerMatch({ id: 1, state: 'LIVE', period: 2, clock: null, away: { score: 1 }, home: { score: 0 } },
            H.etatDeScore({ id: 1, gameState: 'CRIT', periodDescriptor: { number: 3, periodType: 'REG' }, clock: { timeRemaining: '01:10' }, awayTeam: { score: 2 }, homeTeam: { score: 2 } }));
        assert.deepEqual([enCours.state, enCours.period, enCours.away.score, enCours.home.score, enCours.clock.timeRemaining], ['CRIT', 3, 2, 2, '01:10']);
    });

    test('un match à venir que /score/now dit commencé passe en direct', () => {
        const m = H.fusionnerMatch({ id: 2, state: 'FUT', away: { score: null }, home: { score: null } },
            H.etatDeScore({ id: 2, gameState: 'LIVE', awayTeam: { score: 0 }, homeTeam: { score: 0 } }));
        assert.equal(m.state, 'LIVE');
        assert.equal(m.away.score, 0);
    });

    test('sans source : l’horaire tel quel', () => {
        const s = semaineFigee();
        assert.equal(H.fusionnerHoraire(s, new Map()), s);
        assert.equal(H.fusionnerHoraire(null, new Map([[1, {}]])), null);
        assert.equal(H.fusionnerMatch(null, {}), null);
        assert.equal(H.etatDeScore(null), null);
        assert.equal(H.etatDeFeuille({}), null);
    });

    test('plusAvance, rangEtat', () => {
        assert.equal(H.plusAvance(null, { state: 'OFF' }).state, 'OFF');
        assert.equal(H.plusAvance({ state: 'LIVE' }, null).state, 'LIVE');
        assert.equal(H.plusAvance({ state: 'LIVE' }, { state: 'FINAL' }).state, 'FINAL');
        assert.equal(H.plusAvance({ state: 'OFF', x: 1 }, { state: 'LIVE' }).x, 1);
        assert.equal(H.plusAvance(null, null), null);
        assert.ok(H.rangEtat('OFF') > H.rangEtat('FINAL'));
        assert.equal(H.rangEtat('PPD'), 0);
    });
});

describe('ce qu’il faut aller vérifier', () => {
    const MAINTENANT = Date.parse('2026-09-30T12:40:00Z');

    test('un match dit en cours que /score/now ne vouche pas', () => {
        assert.deepEqual(H.matchsAVerifier(semaineFigee(), { connus: new Set([2026020006]), maintenant: MAINTENANT }), [2026020004]);
    });

    test('un match en cours que /score/now vouche, commencé il y a une heure : rien à vérifier', () => {
        const s = semaineFigee();
        assert.deepEqual(H.matchsAVerifier(s, { connus: new Set([2026020004]), maintenant: Date.parse('2026-09-30T03:00:00Z') }), []);
    });

    test('… mais au-delà de trois heures, on vérifie quand même : l’heure décide QUAND vérifier, jamais la fin', () => {
        assert.deepEqual(H.matchsAVerifier(semaineFigee(), { connus: new Set([2026020004]), maintenant: MAINTENANT }), [2026020004]);
        const bruts = [
            { id: 2026020004, gameState: 'LIVE', startTimeUTC: '2026-09-30T02:00:00Z' },
            { id: 2026020007, gameState: 'LIVE', startTimeUTC: '2026-09-30T11:00:00Z' },
            { id: 2026020008, gameState: 'OFF', startTimeUTC: '2026-09-29T11:00:00Z' },
            { id: 2026020009, gameState: 'LIVE' }
        ];
        assert.deepEqual(H.brutsAVerifier(bruts, MAINTENANT), [2026020004]);
        assert.deepEqual(H.brutsAVerifier(null, MAINTENANT), []);
        assert.deepEqual(H.matchsAVerifier(null), []);
    });

    test('avancerMatchBrut : un match brut de /score, avancé par sa feuille', () => {
        const brut = { id: 2026020004, gameState: 'LIVE', awayTeam: { abbrev: 'VAN', score: 5 }, homeTeam: { abbrev: 'EDM', score: 4 }, periodDescriptor: { number: 3, periodType: 'REG' } };
        const avance = H.avancerMatchBrut(brut, feuilleOff);
        assert.equal(avance.gameState, 'OFF');
        assert.deepEqual([avance.awayTeam.score, avance.homeTeam.score, avance.awayTeam.abbrev], [6, 5, 'VAN']);
        assert.deepEqual(avance.gameOutcome, { lastPeriodType: 'OT' });
        assert.deepEqual(avance.periodDescriptor, { number: 4, periodType: 'OT' });
        assert.equal(H.avancerMatchBrut(brut, null), brut);
        assert.equal(H.avancerMatchBrut({ ...brut, gameState: 'OFF' }, { ...feuilleOff, state: 'LIVE' }).gameState, 'OFF');
        const sansIssue = H.avancerMatchBrut({ id: 1, gameState: 'LIVE' }, { id: 1, state: 'FINAL', away: { score: 1 }, home: { score: 0 } });
        assert.equal(sansIssue.gameState, 'FINAL');
        assert.equal(sansIssue.gameOutcome, undefined);
    });
});

describe('le calendrier de l’accueil, du lundi au dimanche', () => {
    const { fzdDecalerJour, fzdLundiDe, fzdSemaineLundiDimanche } =
        chargerFonctions('accueil-dash.js', ['fzdDecalerJour', 'fzdLundiDe', 'fzdSemaineLundiDimanche']);

    test('le lundi de chaque jour de la semaine, dimanche compris', () => {
        for (const jour of ['2026-09-28', '2026-09-30', '2026-10-03', '2026-10-04']) {
            assert.equal(fzdLundiDe(jour), '2026-09-28', jour);
        }
        assert.equal(fzdLundiDe('2026-10-05'), '2026-10-05');
        assert.equal(fzdDecalerJour('2026-12-30', 3), '2027-01-02');
    });

    test('sept jours du lundi au dimanche, même si la LNH en rend moins', () => {
        // La LNH rend sept jours à partir de la date demandée ; ici, seulement trois.
        const recu = { days: [{ date: '2026-09-29', games: [{ id: 4 }] }, { date: '2026-09-30', games: [] }, { date: '2026-10-01', games: [] }], nextStartDate: '2026-10-05' };
        const semaine = fzdSemaineLundiDimanche('2026-09-28', recu);
        assert.deepEqual([...semaine.days].map(d => d.date),
            ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
        assert.equal(semaine.days[1].games[0].id, 4);
        assert.equal(semaine.days[0].games.length, 0);
        assert.equal(semaine.lundi, '2026-09-28');
        assert.equal(semaine.nextStartDate, '2026-10-05', 'les dates de la LNH restent : elles disent s’il y a une semaine après');
    });

    test('une réponse vide reste vide (calendrier indisponible)', () => {
        const vide = fzdSemaineLundiDimanche('2026-09-28', { days: [] });
        assert.equal(vide.days.length, 0);
        assert.equal(vide.lundi, '2026-09-28');
        assert.equal(fzdSemaineLundiDimanche('2026-09-28', null).days.length, 0);
    });
});
