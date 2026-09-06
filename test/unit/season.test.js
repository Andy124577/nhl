'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
    seasonIdForDate, seasonLabel, currentSeasonId, currentSeasonString,
    fallbackWindow, getSeasonWindow, resetSeasonWindowCache,
    seasonPhase, seasonHasStarted
} = require('../../lib/season.js');

/** Une réponse d'API minimale, comme celle que doFetch reçoit. */
function reponse(body, ok = true) {
    return { ok, json: async () => body };
}

const CALENDRIER_2026 = {
    preSeasonStartDate: '2026-09-20',
    regularSeasonStartDate: '2026-10-07',
    regularSeasonEndDate: '2027-04-16'
};

beforeEach(() => resetSeasonWindowCache());

describe('seasonIdForDate', () => {
    test('une saison porte l\'année de son ouverture', () => {
        assert.equal(seasonIdForDate('2026-10-07'), 20262027);
        assert.equal(seasonIdForDate('2026-12-31'), 20262027);
        assert.equal(seasonIdForDate('2027-04-16'), 20262027);
    });

    test('elle bascule le 1er juillet, pas le 1er janvier', () => {
        // C'est le cœur du bogue corrigé : le 5 septembre 2026, l'application
        // servait encore 20252026, donc les totaux de la saison écoulée.
        assert.equal(seasonIdForDate('2026-06-30'), 20252026);
        assert.equal(seasonIdForDate('2026-07-01'), 20262027);
        assert.equal(seasonIdForDate('2026-09-05'), 20262027);
    });

    test('accepte une Date comme une chaîne ISO', () => {
        assert.equal(seasonIdForDate(new Date('2026-09-05T23:00:00.000Z')), 20262027);
        assert.equal(seasonIdForDate('2026-09-05'), 20262027);
    });

    test('sans argument, elle répond pour aujourd\'hui', () => {
        const maintenant = new Date();
        assert.equal(seasonIdForDate(), seasonIdForDate(maintenant));
    });
});

describe('seasonLabel', () => {
    test('affiche la saison en clair', () => {
        assert.equal(seasonLabel(20262027), '2026-27');
        assert.equal(seasonLabel(19992000), '1999-00');
    });

    test('sans argument, c\'est la saison en cours', () => {
        assert.equal(seasonLabel(), seasonLabel(currentSeasonId()));
    });
});

describe('currentSeasonId / currentSeasonString', () => {
    test('suivent la règle du 1er juillet tant que le calendrier n\'a pas parlé', () => {
        const maintenant = new Date('2026-09-05T12:00:00.000Z');
        assert.equal(currentSeasonId(maintenant), 20262027);
        assert.equal(currentSeasonString(maintenant), '20262027');
    });

    test('la chaîne est bien du texte — la colonne `season` en base en est', () => {
        assert.equal(typeof currentSeasonString(), 'string');
        assert.equal(typeof currentSeasonId(), 'number');
    });

    test('le calendrier corrige la déduction une fois lu', async () => {
        // Une saison décalée (2020-21 s'est terminée en juillet) mettrait la
        // règle du 1er juillet en défaut : c'est la LNH qui tranche.
        await getSeasonWindow({
            now: new Date('2021-07-05T12:00:00.000Z'),
            fetchImpl: async () => reponse({
                preSeasonStartDate: '2021-01-01',
                regularSeasonStartDate: '2021-01-13',
                regularSeasonEndDate: '2021-05-19'
            })
        });
        assert.equal(currentSeasonId(new Date('2021-07-05T12:00:00.000Z')), 20202021);
    });
});

describe('fallbackWindow', () => {
    test('ouvre avant n\'importe quelle ouverture réelle', () => {
        const f = fallbackWindow(20262027);
        assert.equal(f.seasonId, 20262027);
        assert.equal(f.preSeasonStartDate, '2026-09-15');
        assert.equal(f.regularSeasonStartDate, '2026-09-25');
        assert.equal(f.regularSeasonEndDate, '2027-04-30');
        assert.equal(f.source, 'fallback');
        // Mieux vaut déverrouiller trop tôt — les statistiques valent zéro
        // tant que rien n'est joué — que masquer des matchs disputés.
        assert.ok(f.regularSeasonStartDate < '2026-10-01');
    });
});

describe('getSeasonWindow', () => {
    test('reprend les dates du calendrier de la LNH', async () => {
        const w = await getSeasonWindow({
            now: new Date('2026-09-05T12:00:00.000Z'),
            fetchImpl: async () => reponse(CALENDRIER_2026)
        });
        assert.equal(w.source, 'nhl');
        assert.equal(w.seasonId, 20262027);
        assert.equal(w.regularSeasonStartDate, '2026-10-07');
        assert.equal(w.regularSeasonEndDate, '2027-04-16');
    });

    test('interroge le calendrier à la date du jour', async () => {
        let urlDemandee = null;
        await getSeasonWindow({
            now: new Date('2026-09-05T12:00:00.000Z'),
            fetchImpl: async (url) => { urlDemandee = url; return reponse(CALENDRIER_2026); }
        });
        assert.match(urlDemandee, /\/schedule\/2026-09-05$/);
    });

    test('met en cache : un second appel ne rappelle pas la LNH', async () => {
        let appels = 0;
        const fetchImpl = async () => { appels += 1; return reponse(CALENDRIER_2026); };
        await getSeasonWindow({ now: new Date('2026-09-05T12:00:00.000Z'), fetchImpl });
        await getSeasonWindow({ now: new Date('2026-09-05T12:00:00.000Z'), fetchImpl });
        assert.equal(appels, 1);
    });

    test('force: true rappelle malgré le cache', async () => {
        let appels = 0;
        const fetchImpl = async () => { appels += 1; return reponse(CALENDRIER_2026); };
        await getSeasonWindow({ now: new Date('2026-09-05T12:00:00.000Z'), fetchImpl });
        await getSeasonWindow({ now: new Date('2026-09-05T12:00:00.000Z'), fetchImpl, force: true });
        assert.equal(appels, 2);
    });

    test('un calendrier injoignable ne fait pas d\'exception', async () => {
        const w = await getSeasonWindow({
            now: new Date('2026-09-05T12:00:00.000Z'),
            fetchImpl: async () => { throw new Error('réseau coupé'); }
        });
        assert.equal(w.source, 'fallback');
        assert.equal(w.seasonId, 20262027);
    });

    test('une réponse en erreur retombe sur le repli', async () => {
        const w = await getSeasonWindow({
            now: new Date('2026-09-05T12:00:00.000Z'),
            fetchImpl: async () => reponse(null, false)
        });
        assert.equal(w.source, 'fallback');
    });

    test('une réponse sans date d\'ouverture retombe sur le repli', async () => {
        const w = await getSeasonWindow({
            now: new Date('2026-09-05T12:00:00.000Z'),
            fetchImpl: async () => reponse({ days: [] })
        });
        assert.equal(w.source, 'fallback');
    });

    test('sans fetch disponible, le repli suffit', async () => {
        const w = await getSeasonWindow({
            now: new Date('2026-09-05T12:00:00.000Z'),
            fetchImpl: null
        });
        assert.ok(w.regularSeasonStartDate);
    });

    test('les dates absentes de la réponse deviennent null, pas undefined', async () => {
        const w = await getSeasonWindow({
            now: new Date('2026-09-05T12:00:00.000Z'),
            fetchImpl: async () => reponse({ regularSeasonStartDate: '2026-10-07' })
        });
        assert.equal(w.preSeasonStartDate, null);
        assert.equal(w.regularSeasonEndDate, null);
    });
});

describe('seasonPhase', () => {
    const w = { ...CALENDRIER_2026, seasonId: 20262027 };

    test('hors-saison avant le camp', () => {
        assert.equal(seasonPhase(w, new Date('2026-08-01T12:00:00.000Z')), 'offseason');
    });

    test('préparation entre le camp et le premier match', () => {
        assert.equal(seasonPhase(w, new Date('2026-09-25T12:00:00.000Z')), 'preseason');
    });

    test('saison régulière dès le jour de l\'ouverture', () => {
        assert.equal(seasonPhase(w, new Date('2026-10-07T12:00:00.000Z')), 'regular');
        assert.equal(seasonPhase(w, new Date('2027-04-16T12:00:00.000Z')), 'regular');
    });

    test('séries après le dernier match du calendrier', () => {
        assert.equal(seasonPhase(w, new Date('2027-04-17T12:00:00.000Z')), 'postseason');
    });

    test('sans fenêtre, la phase est inconnue', () => {
        assert.equal(seasonPhase(null), 'unknown');
    });

    test('une borne manquante est une borne ouverte', () => {
        const sansCamp = { seasonId: 20262027, regularSeasonStartDate: '2026-10-07' };
        assert.equal(seasonPhase(sansCamp, new Date('2026-09-25T12:00:00.000Z')), 'offseason');
        assert.equal(seasonPhase(sansCamp, new Date('2027-08-01T12:00:00.000Z')), 'regular');
    });
});

describe('seasonHasStarted', () => {
    const w = { ...CALENDRIER_2026, seasonId: 20262027 };

    test('non la veille de l\'ouverture, oui le jour même', () => {
        assert.equal(seasonHasStarted(w, new Date('2026-10-06T23:00:00.000Z')), false);
        assert.equal(seasonHasStarted(w, new Date('2026-10-07T00:00:00.000Z')), true);
    });

    test('reste vrai pendant les séries', () => {
        assert.equal(seasonHasStarted(w, new Date('2027-05-20T12:00:00.000Z')), true);
    });

    test('sans calendrier, on n\'ose pas masquer les statistiques', () => {
        // Le contraire ferait disparaître des matchs réels dès que la LNH ne
        // répond plus : le doute profite à l'affichage.
        assert.equal(seasonHasStarted(null), true);
        assert.equal(seasonHasStarted({ seasonId: 20262027 }), true);
    });
});
