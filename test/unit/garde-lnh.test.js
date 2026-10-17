'use strict';

/**
 * Les pages de la LNH gardées (lib/gardeLNH.js) : l'horaire de la page Scores
 * et les calendriers des clubs. Quand la LNH limite notre adresse (429), on
 * sert la dernière copie au lieu d'une semaine vide, on ne relance pas la
 * salve qui a provoqué la limite, et un cache froid ne part pas en rafale.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { creerGarde, creerFile } = require('../../lib/gardeLNH.js');

function horloge(depart = 1_000_000) {
    let t = depart;
    return { maintenant: () => t, avancer: (ms) => { t += ms; } };
}

/** Un chargeur qui rend, dans l'ordre, les valeurs données ; une Error est levée. */
function chargeur(...valeurs) {
    const appels = { n: 0 };
    const charger = async () => {
        appels.n += 1;
        const v = valeurs.shift();
        if (v instanceof Error) throw v;
        return v;
    };
    return { charger, appels };
}

describe('creerGarde', () => {
    test('une copie fraîche sert sans rappeler la LNH', async () => {
        const h = horloge();
        const garde = creerGarde({ dureeMs: 60_000, horloge: h.maintenant });
        const { charger, appels } = chargeur('semaine', 'autre');
        assert.equal(await garde.lire('2026-10-12', charger), 'semaine');
        h.avancer(59_000);
        assert.equal(await garde.lire('2026-10-12', charger), 'semaine');
        assert.equal(appels.n, 1);
    });

    test('une rafale d’appels simultanés n’en lance qu’un', async () => {
        const garde = creerGarde({ dureeMs: 60_000 });
        let appels = 0;
        const charger = () => { appels += 1; return new Promise(r => setTimeout(() => r('semaine'), 5)); };
        const lus = await Promise.all(Array.from({ length: 10 }, () => garde.lire('BUF|20262027', charger)));
        assert.equal(appels, 1);
        assert.deepEqual(lus, Array(10).fill('semaine'));
    });

    test('un refus sert la dernière copie, même périmée', async () => {
        const h = horloge();
        const garde = creerGarde({ dureeMs: 60_000, horloge: h.maintenant });
        const { charger } = chargeur('vieille', null);
        await garde.lire('k', charger);
        h.avancer(10 * 60_000);
        assert.equal(await garde.lire('k', charger), 'vieille');
    });

    test('une erreur levée compte comme un refus', async () => {
        const h = horloge();
        const garde = creerGarde({ dureeMs: 1000, horloge: h.maintenant });
        const { charger } = chargeur('copie', new Error('HTTP 429'));
        await garde.lire('k', charger);
        h.avancer(2000);
        assert.equal(await garde.lire('k', charger), 'copie');
    });

    test('jamais lue et refusée : null', async () => {
        const garde = creerGarde({ dureeMs: 1000 });
        const { charger } = chargeur(null);
        assert.equal(await garde.lire('k', charger), null);
    });

    test('après un refus, la LNH n’est pas redemandée avant le répit', async () => {
        const h = horloge();
        const garde = creerGarde({ dureeMs: 1000, repitMs: 60_000, horloge: h.maintenant });
        const { charger, appels } = chargeur('copie', null, 'neuve');
        await garde.lire('k', charger);
        h.avancer(2000);
        assert.equal(await garde.lire('k', charger), 'copie');   // refus
        assert.equal(appels.n, 2);
        h.avancer(30_000);
        assert.equal(await garde.lire('k', charger), 'copie');   // dans le répit : aucun appel
        assert.equal(appels.n, 2);
        h.avancer(31_000);
        assert.equal(await garde.lire('k', charger), 'neuve');   // après : on redemande
        assert.equal(appels.n, 3);
    });

    test('une lecture réussie efface le répit', async () => {
        const h = horloge();
        const garde = creerGarde({ dureeMs: 1000, repitMs: 60_000, horloge: h.maintenant });
        const { charger, appels } = chargeur(null, 'a', 'b');
        assert.equal(await garde.lire('k', charger), null);
        h.avancer(61_000);
        assert.equal(await garde.lire('k', charger), 'a');
        h.avancer(2000);
        assert.equal(await garde.lire('k', charger), 'b');
        assert.equal(appels.n, 3);
    });

    test('la fraîcheur peut dépendre de la valeur et de la clé', async () => {
        const h = horloge();
        const vus = [];
        const garde = creerGarde({
            dureeMs: (valeur, cle) => { vus.push([valeur, cle]); return valeur === 'passée' ? 1e9 : 1000; },
            horloge: h.maintenant
        });
        const { charger, appels } = chargeur('passée');
        await garde.lire('2026-09-28', charger);
        h.avancer(10 * 60_000);
        assert.equal(await garde.lire('2026-09-28', charger), 'passée');
        assert.equal(appels.n, 1);
        assert.deepEqual(vus, [['passée', '2026-09-28']]);
    });

    test('les clés ne se mélangent pas', async () => {
        const garde = creerGarde({ dureeMs: 60_000 });
        assert.equal(await garde.lire('BUF', async () => 'b'), 'b');
        assert.equal(await garde.lire('MTL', async () => 'm'), 'm');
        assert.equal(garde.taille(), 2);
    });
});

describe('creerFile', () => {
    test('n travaux à la fois au plus, chacun reçoit son résultat', async () => {
        const file = creerFile(4);
        let actifs = 0, pic = 0;
        const travail = i => file(async () => {
            actifs += 1; pic = Math.max(pic, actifs);
            await new Promise(r => setTimeout(r, 3));
            actifs -= 1;
            return i * 2;
        });
        const resultats = await Promise.all(Array.from({ length: 20 }, (_, i) => travail(i)));
        assert.equal(pic, 4);
        assert.deepEqual(resultats, Array.from({ length: 20 }, (_, i) => i * 2));
    });

    test('un travail qui échoue rejette le sien et libère sa place', async () => {
        const file = creerFile(1);
        const echec = file(async () => { throw new Error('refus'); });
        const suite = file(async () => 'ok');
        await assert.rejects(echec, /refus/);
        assert.equal(await suite, 'ok');
    });
});

describe('la salve du 16 octobre 2026', () => {
    test('deux appelants, 32 clubs, cache froid : 32 appels, 4 à la fois', async () => {
        const garde = creerGarde({ dureeMs: 30 * 60_000 });
        const file = creerFile(4);
        let appels = 0, actifs = 0, pic = 0;
        const lireLNH = async abbrev => {
            appels += 1; actifs += 1; pic = Math.max(pic, actifs);
            await new Promise(r => setTimeout(r, 2));
            actifs -= 1;
            return [{ club: abbrev }];
        };
        const calendrierDuClub = abbrev => garde.lire(`${abbrev}|20262027`, () => file(() => lireLNH(abbrev)));
        const clubs = Array.from({ length: 32 }, (_, i) => `C${i}`);
        // Les colonnes du classement et la forme des clubs, au même moment.
        const [a, b] = await Promise.all([
            Promise.all(clubs.map(calendrierDuClub)),
            Promise.all(clubs.map(calendrierDuClub))
        ]);
        assert.equal(appels, 32, 'chaque club une seule fois');
        assert.equal(pic, 4, 'jamais plus de quatre appels simultanés');
        assert.deepEqual(a, b);
    });
});
