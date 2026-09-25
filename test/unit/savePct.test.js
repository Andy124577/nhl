'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { savePctFromSeasons } = require('../../lib/savePct.js');

/** Une ligne de seasonTotals de /v1/player/{id}/landing, telle que la LNH l'écrit. */
function saison(over = {}) {
    return {
        gameTypeId: 2, leagueAbbrev: 'NHL', season: 20252026,
        gamesPlayed: 58, shotsAgainst: 1483, goalsAgainst: 132, savePctg: 0.91234,
        ...over
    };
}

describe('savePctFromSeasons', () => {
    test('lit savePctg, le nom que la LNH donne au pourcentage', () => {
        // Le bogue d'origine : on lisait savePct / savePercentage, absents,
        // et chaque gardien de la ligue sortait à 0.
        assert.equal(savePctFromSeasons([saison()]), 0.91234);
    });

    test('savePctg fait foi sur (tirs − buts) / tirs', () => {
        // 1 483 tirs, 132 buts : .911 au calcul, .912 officiel.
        assert.equal(savePctFromSeasons([saison()]).toFixed(3), '0.912');
    });

    test('sans savePctg, se déduit des tirs et des buts accordés', () => {
        const pct = savePctFromSeasons([saison({ savePctg: undefined, shotsAgainst: 1000, goalsAgainst: 90 })]);
        assert.equal(pct, 0.91);
    });

    test('sans savePctg, les arrêts explicites passent avant les buts', () => {
        const pct = savePctFromSeasons([saison({ savePctg: undefined, shotsAgainst: 1000, saves: 920, goalsAgainst: 90 })]);
        assert.equal(pct, 0.92);
    });

    test('un gardien échangé : les clubs pèsent leurs tirs, pas une moyenne simple', () => {
        const pct = savePctFromSeasons([
            saison({ shotsAgainst: 1000, savePctg: 0.920 }),
            saison({ shotsAgainst: 10, savePctg: 0.500 })
        ]);
        // Moyenne simple : .710. Pondérée : (920 + 5) / 1010.
        assert.equal(pct.toFixed(4), (925 / 1010).toFixed(4));
    });

    test('sans tirs sur une des lignes, les parties jouées servent de poids', () => {
        const pct = savePctFromSeasons([
            { gamesPlayed: 30, savePctg: 0.900 },
            { gamesPlayed: 10, savePctg: 0.940 },
            { gamesPlayed: 0, savePctg: 0.800 }
        ]);
        // Une ligne à 0 partie pèse 1 plutôt que de disparaître.
        assert.equal(pct.toFixed(5), ((30 * 0.9 + 10 * 0.94 + 0.8) / 41).toFixed(5));
    });

    test('zéro tir reçu : pas de pourcentage, quoi que dise la ligne', () => {
        assert.equal(savePctFromSeasons([saison({ shotsAgainst: 0, savePctg: 0 })]), null);
    });

    test('rien de lisible rend null, jamais 0', () => {
        assert.equal(savePctFromSeasons([]), null);
        assert.equal(savePctFromSeasons(undefined), null);
        assert.equal(savePctFromSeasons([null, { gamesPlayed: 5 }]), null);
        assert.equal(savePctFromSeasons([{ shotsAgainst: 100 }]), null);
    });
});
