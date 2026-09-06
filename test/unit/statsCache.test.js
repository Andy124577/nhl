'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { CURRENT_SEASON, getStatsRefreshStatus } = require('../../lib/statsCache.js');
const { makeStats, makeSkaterStat } = require('../fixtures/stats.js');

/** Un cache de `n` joueurs, daté de `ageHeures` heures avant `MAINTENANT`. */
const MAINTENANT = new Date('2026-01-15T12:00:00.000Z').getTime();
function cache(n, ageHeures, over = {}) {
    const players = Array.from({ length: n }, (_, i) => makeSkaterStat('Joueur' + i));
    return makeStats(players, {
        lastUpdated: new Date(MAINTENANT - ageHeures * 3600000).toISOString(),
        ...over
    });
}

const ATTENDUS = 800;   // taille type de nhl_filtered_stats.json

describe('getStatsRefreshStatus', () => {
    test('sans cache local, il faut rafraîchir', () => {
        const stats = makeStats([], { lastUpdated: null });
        const r = getStatsRefreshStatus(stats, ATTENDUS, CURRENT_SEASON, MAINTENANT);

        assert.equal(r.needsRefresh, true);
        assert.equal(r.reason, 'no local cache yet');
        assert.equal(r.ageHours, Infinity);
    });

    test('un cache frais, complet et de la bonne saison n\'a rien à faire', () => {
        const r = getStatsRefreshStatus(cache(ATTENDUS, 2), ATTENDUS, CURRENT_SEASON, MAINTENANT);

        assert.equal(r.needsRefresh, false);
        assert.equal(r.cacheIsIncomplete, false);
        assert.equal(r.reason, 'cache is 2.0h old');
    });

    test('au-delà de 24 h, il faut rafraîchir', () => {
        const r = getStatsRefreshStatus(cache(ATTENDUS, 25), ATTENDUS, CURRENT_SEASON, MAINTENANT);

        assert.equal(r.needsRefresh, true);
        assert.equal(r.reason, 'cache is 25.0h old');
    });

    test('la limite est stricte : 24 h passent, 24,1 h non', () => {
        assert.equal(getStatsRefreshStatus(cache(ATTENDUS, 24), ATTENDUS, CURRENT_SEASON, MAINTENANT).needsRefresh, false);
        assert.equal(getStatsRefreshStatus(cache(ATTENDUS, 24.1), ATTENDUS, CURRENT_SEASON, MAINTENANT).needsRefresh, true);
    });

    test('un cache d\'une autre saison est périmé, quel que soit son âge', () => {
        const vieilleSaison = cache(ATTENDUS, 1, { season: 20242025 });
        const r = getStatsRefreshStatus(vieilleSaison, ATTENDUS, CURRENT_SEASON, MAINTENANT);

        assert.equal(r.needsRefresh, true);
        assert.equal(r.reason, 'wrong season (20242025)');
    });

    test('un cache trop maigre est incomplet', () => {
        // Le seuil vaut min(attendus × 0,5 ; 200). Ici : min(400 ; 200) = 200.
        const r = getStatsRefreshStatus(cache(150, 1), ATTENDUS, CURRENT_SEASON, MAINTENANT);

        assert.equal(r.cacheIsIncomplete, true);
        assert.equal(r.needsRefresh, true);
        assert.equal(r.reason, 'incomplete cache (150/800 players)');
    });

    test('« incomplet » l\'emporte sur « périmé » dans le motif', () => {
        // Un cache à la fois vieux, d'une autre saison et maigre : c'est
        // l'incomplétude qui est annoncée, parce que c'est elle qui explique
        // le mieux ce qu'il faut refaire.
        const pire = cache(10, 99, { season: 20242025 });
        const r = getStatsRefreshStatus(pire, ATTENDUS, CURRENT_SEASON, MAINTENANT);

        assert.match(r.reason, /^incomplete cache/);
    });

    test('« pas de cache » l\'emporte sur tout le reste', () => {
        const rien = makeStats([], { lastUpdated: null, season: 20242025 });

        assert.equal(getStatsRefreshStatus(rien, ATTENDUS, CURRENT_SEASON, MAINTENANT).reason, 'no local cache yet');
    });

    test('le seuil bascule sur la moitié quand le total attendu est petit', () => {
        // min(100 × 0,5 ; 200) = 50 : 60 joueurs suffisent, 40 non.
        assert.equal(getStatsRefreshStatus(cache(60, 1), 100, CURRENT_SEASON, MAINTENANT).cacheIsIncomplete, false);
        assert.equal(getStatsRefreshStatus(cache(40, 1), 100, CURRENT_SEASON, MAINTENANT).cacheIsIncomplete, true);
    });

    test('le seuil plafonne à 200 quand le total attendu est grand', () => {
        // min(5000 × 0,5 ; 200) = 200, pas 2500 : un très gros fichier de
        // référence ne doit pas rendre tout cache « incomplet ».
        assert.equal(getStatsRefreshStatus(cache(250, 1), 5000, CURRENT_SEASON, MAINTENANT).cacheIsIncomplete, false);
        assert.equal(getStatsRefreshStatus(cache(199, 1), 5000, CURRENT_SEASON, MAINTENANT).cacheIsIncomplete, true);
    });

    test('le rapport reporte le total attendu et l\'âge calculé', () => {
        const r = getStatsRefreshStatus(cache(ATTENDUS, 5), ATTENDUS, CURRENT_SEASON, MAINTENANT);

        assert.equal(r.expectedPlayerCount, ATTENDUS);
        assert.equal(r.ageHours, 5);
    });

    test('sans saison ni horloge fournies, les valeurs par défaut s\'appliquent', () => {
        // Le serveur n'en passe pas : il appelle getStatsRefreshStatus(stats,
        // loadAllPlayers().length).
        const frais = makeStats(
            Array.from({ length: ATTENDUS }, (_, i) => makeSkaterStat('J' + i)),
            { lastUpdated: new Date().toISOString() }
        );

        assert.equal(getStatsRefreshStatus(frais, ATTENDUS).needsRefresh, false);
    });

    test('la saison en cours est celle que le serveur attend', () => {
        assert.equal(CURRENT_SEASON, 20252026);
    });
});
