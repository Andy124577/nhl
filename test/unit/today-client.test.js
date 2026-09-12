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

    const elements = new Map();
    const ecouteurs = new Map();
    const sockets = new Map();
    const requetes = [];
    let reponse = { generatedAt: 'x', vedette: null, secondaires: [], vide: null, pools: [] };
    let retard = null;
    let poolActif = pool;

    const creerElement = (id) => ({
        id, innerHTML: '', hidden: false,
        set innerHTML_(v) { this.innerHTML = v; }
    });

    const document = {
        visibilityState: 'visible',
        getElementById: (id) => {
            if (!elements.has(id)) elements.set(id, creerElement(id));
            return elements.get(id);
        },
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
    contexte.window.matchMedia = () => ({ matches: false });

    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '../../fzToday.js'), 'utf8'),
        contexte, { filename: 'fzToday.js' });

    const vider = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

    return {
        FZToday: contexte.window.FZToday,
        requetes,
        elements,
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
        await banc.FZToday.demarrer(['fzTodayDash']);
        const avant = banc.requetes.length;

        await banc.emettre('poolUpdated');
        await banc.emettre('tradePending');
        await banc.emettre('tradeUpdated');
        assert.equal(banc.requetes.length, avant, 'les demandes se regroupent avant de partir');

        await banc.avancer(500);
        assert.equal(banc.requetes.length, avant + 1, 'une seule requête pour toute la rafale');
    });

    test('une réponse arrivée après un changement de pool est jetée', async () => {
        const banc = chargerFZToday({ pool: 'Ligue A' });
        banc.setReponse({ vedette: vedette('a', 'Duel A'), secondaires: [], pools: [] });
        await banc.FZToday.demarrer(['fzTodayDash']);
        assert.match(banc.elements.get('fzTodayDash').innerHTML, /Duel A/);

        // Une réponse pour « Ligue A » revient après qu'on soit passé sur B.
        const liberer = banc.retenir();
        const enVol = banc.FZToday.charger({ force: true });
        banc.setPool('Ligue B');
        liberer({ vedette: vedette('a', 'Duel A'), secondaires: [], pools: [] });
        await enVol;
        await banc.vider();

        assert.match(banc.elements.get('fzTodayDash').innerHTML, /Duel A/,
            "l'affichage ne bouge pas : la réponse périmée n'a pas été appliquée");
        assert.equal(banc.FZToday.derniere().vedette.id, 'a');
    });

    test('rien ne tourne pendant que l’onglet est caché', async () => {
        const banc = chargerFZToday();
        banc.setReponse({ vedette: vedette('a', 'À vous'), secondaires: [], pools: [] });
        await banc.FZToday.demarrer(['fzTodayDash']);

        await banc.cacherOnglet();
        const avant = banc.requetes.length;
        await banc.avancer(200000);
        assert.equal(banc.requetes.length, avant, 'un accueil invisible ne consomme rien');

        await banc.montrerOnglet();
        assert.ok(banc.requetes.length > avant, 'le retour sur l’onglet relit tout de suite');
    });

    test('la vedette et les lignes secondaires nomment leur pool', async () => {
        const banc = chargerFZToday();
        banc.setReponse({
            vedette: vedette('a', 'À vous de choisir'),
            secondaires: [{ ...vedette('b', 'Duel de la semaine'), urgence: 4, pool: 'Autre Ligue' }],
            pools: []
        });
        await banc.FZToday.demarrer(['fzTodayDash']);

        const html = banc.elements.get('fzTodayDash').innerHTML;
        assert.match(html, /À vous de choisir/);
        assert.match(html, /Duel de la semaine/);
        assert.match(html, /Ligue/);
        assert.match(html, /Autre Ligue/,
            '« c’est votre tour » sans dire dans quelle partie oblige à deviner');
    });

    test('l’état vide propose des gestes plutôt qu’une page blanche', async () => {
        const banc = chargerFZToday();
        banc.setReponse({
            vedette: null, secondaires: [], pools: [],
            vide: {
                cas: 'aucun_pool', titre: 'Commencez par un pool', detail: 'Rejoignez-en un.',
                actions: [{ titre: 'Repêchage instantané', href: 'repechage.html' }]
            }
        });
        await banc.FZToday.demarrer(['fzTodayDash']);

        const html = banc.elements.get('fzTodayDash').innerHTML;
        assert.match(html, /Commencez par un pool/);
        assert.match(html, /repechage\.html/);
    });

    test('un échec réseau garde ce qui est affiché', async () => {
        const banc = chargerFZToday();
        banc.setReponse({ vedette: vedette('a', 'À vous'), secondaires: [], pools: [] });
        await banc.FZToday.demarrer(['fzTodayDash']);
        const avant = banc.elements.get('fzTodayDash').innerHTML;

        const liberer = banc.retenir();
        const enVol = banc.FZToday.charger({ force: true });
        liberer(Promise.reject(new Error('réseau')));
        await enVol.catch(() => {});
        await banc.vider();

        assert.equal(banc.elements.get('fzTodayDash').innerHTML, avant,
            'vider l’accueil parce qu’une requête a échoué serait la pire réaction');
    });

    test('le texte du serveur est échappé avant d’atteindre la page', async () => {
        const banc = chargerFZToday();
        banc.setReponse({
            vedette: { ...vedette('a', '<img src=x onerror=alert(1)>'), pool: '"><script>' },
            secondaires: [], pools: []
        });
        await banc.FZToday.demarrer(['fzTodayDash']);

        const html = banc.elements.get('fzTodayDash').innerHTML;
        assert.ok(!html.includes('<img src=x'), 'un nom de pool est du texte, pas du balisage');
        assert.ok(!html.includes('<script>'));
        assert.match(html, /&lt;img/);
    });

    test('sans session, le module ne demande rien', async () => {
        const banc = chargerFZToday({ connecte: false });
        const resultat = await banc.FZToday.demarrer(['fzTodayDash']);
        assert.equal(resultat, null);
        assert.equal(banc.requetes.length, 0);
    });
});
