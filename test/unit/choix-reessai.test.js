/**
 * Le réessai d'un choix dans la salle de repêchage (commitPlayerPick,
 * draftActif.js) et le contrôle de l'identifiant d'opération côté serveur
 * (services/poolStore.js).
 *
 * Le serveur savait déjà relire le résultat d'un choix rejoué sous le même
 * identifiant ; la salle n'en envoyait aucun. Une réponse perdue en route
 * laissait donc le choix sans garantie de non-répétition.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { chargerFonctions } = require('../fixtures/helpers.js');
const { creerPoolStore } = require('../../services/poolStore.js');

/** Un `fetch` scénarisé : chaque appel consomme une étape ('coupure' ou un statut). */
function faussesReponses(etapes) {
    const envois = [];
    const fetch = async (url, options) => {
        envois.push({ url, corps: JSON.parse(options.body) });
        const etape = etapes.shift();
        if (etape === 'coupure') throw new TypeError('Failed to fetch');
        return {
            ok: etape >= 200 && etape < 300,
            status: etape,
            json: async () => ({ message: `statut ${etape}` })
        };
    };
    return { fetch, envois };
}

function salle(etapes, { tour = 7 } = {}) {
    const { fetch, envois } = faussesReponses(etapes);
    const notes = [];
    let rechargements = 0;
    let compteur = 0;
    const f = chargerFonctions('draftActif.js', ['identifiantOperation', 'envoyerChoix', 'commitPlayerPick'], {
        fetch,
        console: { log() {}, warn() {}, error() {} },
        BASE_URL: '',
        currentClan: 'Les Boys',
        username: 'alice',
        draftData: { currentPickIndex: tour },
        choixEnSuspens: null,
        window: { crypto: { randomUUID: () => `op-${++compteur}` } },
        crypto: { randomUUID: () => `op-${++compteur}` },
        notifyPickResult: (message, type) => notes.push({ message, type }),
        showCustomAlert: (message, type) => notes.push({ message, type, alerte: true }),
        loadDraftData: async () => { rechargements++; }
    });
    return { f, envois, notes, rechargements: () => rechargements };
}

describe('salle de repêchage — envoi d’un choix', () => {
    test('le choix porte le tour affiché et un identifiant d’opération', async () => {
        const s = salle([200]);
        assert.equal(await s.f.commitPlayerPick('Connor McDavid', 'C'), true);

        assert.equal(s.envois.length, 1);
        const corps = s.envois[0].corps;
        assert.equal(corps.position, 'offensive');
        assert.equal(corps.expectedPickIndex, 7);
        assert.equal(typeof corps.operationId, 'string');
        assert.equal(s.rechargements(), 1);
    });

    test('une coupure réseau relance UNE fois, avec le même identifiant', async () => {
        const s = salle(['coupure', 200]);
        assert.equal(await s.f.commitPlayerPick('Cale Makar', 'D'), true);

        assert.equal(s.envois.length, 2);
        assert.equal(s.envois[1].corps.operationId, s.envois[0].corps.operationId);
    });

    test('après deux coupures, un nouveau clic sur le même joueur reprend l’identifiant', async () => {
        const s = salle(['coupure', 'coupure', 200]);
        assert.equal(await s.f.commitPlayerPick('Cale Makar', 'D'), false);
        assert.ok(s.notes.some(n => n.alerte), 'la coupure est annoncée');

        assert.equal(await s.f.commitPlayerPick('Cale Makar', 'D'), true);
        const ids = new Set(s.envois.map(e => e.corps.operationId));
        assert.equal(ids.size, 1, 'un nouvel identifiant aurait pu jouer un deuxième tour');
    });

    test('un autre joueur, ou un choix qui a abouti, prend un nouvel identifiant', async () => {
        const s = salle(['coupure', 'coupure', 200, 200]);
        await s.f.commitPlayerPick('Cale Makar', 'D');
        await s.f.commitPlayerPick('Quinn Hughes', 'D');
        await s.f.commitPlayerPick('Quinn Hughes', 'D');

        const [premier, , hughes, suivant] = s.envois.map(e => e.corps.operationId);
        assert.notEqual(hughes, premier);
        assert.notEqual(suivant, hughes);
    });

    test('un tour changé entre-temps (409) relit le pool sans rien prétendre', async () => {
        const s = salle([409]);
        assert.equal(await s.f.commitPlayerPick('Cale Makar', 'D'), false);
        assert.equal(s.rechargements(), 1);
        assert.equal(s.notes.at(-1).type, 'error');
    });
});

describe('magasin de pools — identifiant d’opération', () => {
    function magasin() {
        const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'fz-op-'));
        const draftFile = path.join(dossier, 'draft.json');
        fs.writeFileSync(draftFile, JSON.stringify({ Test: { teams: {}, marque: 0 } }));
        return creerPoolStore({ db: null, usePostgres: false, draftFile, logger: { log() {}, warn() {}, error() {} } });
    }

    const muter = (store, operationId) => store.muterPool('Test', {
        scope: 'test', operationId, requete: { x: 1 },
        appliquer: async ({ data }) => { data.marque += 1; return { valeur: { ok: true } }; }
    });

    for (const [cas, valeur] of [['un objet', { a: 1 }], ['un nombre', 42], ['plus de 128 caractères', 'x'.repeat(129)]]) {
        test(`${cas} est refusé en 400, sans rien écrire`, async () => {
            const store = magasin();
            await assert.rejects(() => muter(store, valeur), e => e.name === 'ErreurMetier' && e.code === 400);
            assert.equal((await store.lire('Test')).data.marque, 0);
        });
    }

    test('une chaîne valide, ou aucun identifiant, passe', async () => {
        const store = magasin();
        await muter(store, 'op-1');
        await muter(store, 'op-1');   // rejouée : pas d'effet de plus
        await muter(store, undefined);
        assert.equal((await store.lire('Test')).data.marque, 2);
    });
});
