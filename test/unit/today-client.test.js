'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * Le module client d'« Aujourd'hui », exécuté tel quel.
 *
 * Trois propriétés se vérifient ici, et chacune correspond à une façon
 * concrète de rendre l'accueil désagréable :
 *
 *   - une rafale d'évènements ne doit pas déclencher une rafale de requêtes ;
 *   - une réponse arrivée après un changement de pool ne doit pas s'afficher
 *     dans le nouveau contexte ;
 *   - un onglet caché ne doit rien consommer.
 */
function chargerFZToday({ pool = 'Ligue', connecte = true } = {}) {
    const minuteurs = new Map();
    let prochain = 1;
    let horloge = 0;

    const ecouteurs = new Map();
    const sockets = new Map();
    const requetes = [];
    let reponse = { generatedAt: 'x', vedette: null, secondaires: [], vide: null, pools: [] };
    let retard = null;
    let poolActif = pool;

    const document = {
        visibilityState: 'visible',
        addEventListener: (type, fn) => {
            const liste = ecouteurs.get(type) || [];
            liste.push(fn);
            ecouteurs.set(type, liste);
        }
    };

    const socket = { on: (type, fn) => { const l = sockets.get(type) || []; l.push(fn); sockets.set(type, l); } };

    const contexte = {
        window: {},
        document,
        console,
        localStorage: { getItem: (cle) => (cle === 'isLoggedIn' ? (connecte ? 'true' : 'false') : null) },
        BASE_URL: '',
        FZPool: { get: () => poolActif },
        io: () => socket,
        URLSearchParams,
        AbortSignal: { timeout: () => undefined },
        setTimeout: (fn, ms) => { const id = prochain++; minuteurs.set(id, { fn, quand: horloge + ms }); return id; },
        clearTimeout: (id) => minuteurs.delete(id),
        setInterval: (fn, ms) => { const id = prochain++; minuteurs.set(id, { fn, quand: horloge + ms, periodique: ms }); return id; },
        clearInterval: (id) => minuteurs.delete(id),
        fetch: async (url) => {
            requetes.push(String(url));
            if (retard) { const attendu = retard; retard = null; return attendu; }
            return { ok: true, json: async () => JSON.parse(JSON.stringify(reponse)) };
        }
    };
    contexte.window.FZToday = undefined;
    // Au navigateur, window est le global : fzToday.js lit window.FZPool.
    contexte.window.FZPool = contexte.FZPool;
    contexte.window.matchMedia = () => ({ matches: false });

    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '../../fzToday.js'), 'utf8'),
        contexte, { filename: 'fzToday.js' });

    const vider = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

    return {
        FZToday: contexte.window.FZToday,
        requetes,
        setReponse: (r) => { reponse = r; },
        setPool: (p) => { poolActif = p; },
        /** Retient la prochaine réponse : c'est ce qui simule un aller-retour lent. */
        retenir: () => {
            let liberer;
            retard = new Promise(resolve => { liberer = (charge) => resolve({ ok: true, json: async () => charge }); });
            return liberer;
        },
        emettre: async (type) => { for (const fn of sockets.get(type) || []) fn(); await vider(); },
        avancer: async (ms) => {
            horloge += ms;
            for (const [id, m] of [...minuteurs]) {
                if (m.quand <= horloge) {
                    if (m.periodique) m.quand = horloge + m.periodique; else minuteurs.delete(id);
                    m.fn();
                }
            }
            await vider();
        },
        cacherOnglet: async () => {
            document.visibilityState = 'hidden';
            for (const fn of ecouteurs.get('visibilitychange') || []) fn();
            await vider();
        },
        montrerOnglet: async () => {
            document.visibilityState = 'visible';
            for (const fn of ecouteurs.get('visibilitychange') || []) fn();
            await vider();
        },
        vider
    };
}

const vedette = (id, titre) => ({
    id, urgence: 1, pool: 'Ligue', titre, detail: 'détail', action: 'Agir',
    href: 'draftActif.html?pool=Ligue', echeance: null, moment: 1, donnees: null, etat: 'ok'
});

describe('« Aujourd’hui » côté navigateur', () => {

    test('une rafale d’évènements ne produit qu’une requête', async () => {
        const banc = chargerFZToday();
        banc.setReponse({ vedette: vedette('a', 'À vous'), secondaires: [], pools: [] });
        await banc.FZToday.demarrer();
        const avant = banc.requetes.length;

        await banc.emettre('poolUpdated');
        await banc.emettre('tradePending');
        await banc.emettre('tradeUpdated');
        assert.equal(banc.requetes.length, avant, 'les demandes se regroupent avant de partir');

        await banc.avancer(500);
        assert.equal(banc.requetes.length, avant + 1, 'une seule requête pour toute la rafale');
    });

    test('chaque réponse retenue va aux abonnés', async () => {
        const banc = chargerFZToday();
        const recues = [];
        banc.FZToday.surReponse(charge => recues.push(charge.vedette.id));
        banc.setReponse({ vedette: vedette('a', 'À vous'), secondaires: [], pools: [] });
        await banc.FZToday.demarrer();
        assert.deepEqual(recues, ['a']);
        assert.equal(banc.FZToday.vedette().titre, 'À vous');
    });

    test('une réponse arrivée après un changement de pool est jetée', async () => {
        const banc = chargerFZToday({ pool: 'Ligue A' });
        const recues = [];
        banc.FZToday.surReponse(charge => recues.push(charge.vedette.id));
        banc.setReponse({ vedette: vedette('a', 'Duel A'), secondaires: [], pools: [] });
        await banc.FZToday.demarrer();

        // Une réponse pour « Ligue A » revient après qu'on soit passé sur B.
        const liberer = banc.retenir();
        const enVol = banc.FZToday.charger({ force: true });
        banc.setPool('Ligue B');
        liberer({ vedette: vedette('b', 'Duel périmé'), secondaires: [], pools: [] });
        await enVol;
        await banc.vider();

        assert.deepEqual(recues, ['a'], "la réponse périmée n'atteint pas la cloche");
        assert.equal(banc.FZToday.derniere().vedette.id, 'a');
    });

    test('rien ne tourne pendant que l’onglet est caché', async () => {
        const banc = chargerFZToday();
        banc.setReponse({ vedette: vedette('a', 'À vous'), secondaires: [], pools: [] });
        await banc.FZToday.demarrer();

        await banc.cacherOnglet();
        const avant = banc.requetes.length;
        await banc.avancer(200000);
        assert.equal(banc.requetes.length, avant, 'un accueil invisible ne consomme rien');

        await banc.montrerOnglet();
        assert.ok(banc.requetes.length > avant, 'le retour sur l’onglet relit tout de suite');
    });

    test('un échec réseau garde la dernière réponse', async () => {
        const banc = chargerFZToday();
        const recues = [];
        banc.FZToday.surReponse(charge => recues.push(charge.vedette.id));
        banc.setReponse({ vedette: vedette('a', 'À vous'), secondaires: [], pools: [] });
        await banc.FZToday.demarrer();

        const liberer = banc.retenir();
        const enVol = banc.FZToday.charger({ force: true });
        liberer(Promise.reject(new Error('réseau')));
        await enVol.catch(() => {});
        await banc.vider();

        assert.deepEqual(recues, ['a'], 'vider la cloche parce qu’une requête a échoué serait la pire réaction');
        assert.equal(banc.FZToday.derniere().vedette.id, 'a');
    });

    test('sans session, le module ne demande rien', async () => {
        const banc = chargerFZToday({ connecte: false });
        const resultat = await banc.FZToday.demarrer();
        assert.equal(resultat, null);
        assert.equal(banc.requetes.length, 0);
    });
});
