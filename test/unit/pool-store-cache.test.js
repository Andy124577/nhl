/**
 * Le cache de `lireTous` et la lecture des départs prévus.
 *
 * Septembre 2026 : le transfert réseau mensuel de la base (Neon, plan
 * gratuit) épuisé, le site coupé. Chaque `lireTous` rapatriait la table
 * `pools` au complet, et le sondage de la salle de repêchage l'appelait
 * toutes les sept secondes par onglet ouvert.
 *
 * Ce qu'on vérifie ici : une lecture sans changement ne sort aucune donnée
 * de pool de la base, une écriture — d'où qu'elle vienne — se voit à la
 * lecture suivante, et un appelant ne peut pas abîmer ce que lira l'autre.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { creerPoolStore } = require('../../services/poolStore.js');

const silencieux = { log() {}, warn() {}, error() {} };

/**
 * Une base qui se comporte comme `pg` sur les lectures de `pools` : des
 * objets neufs à chaque requête, un updated_at en Date. Elle compte les
 * lignes de données de pool qu'elle laisse sortir — c'est ce que Neon
 * facture.
 */
function fausseBase(poolsInitiaux) {
    const lignes = new Map();
    let prochainId = 1;
    let horloge = Date.UTC(2026, 8, 1);
    const tic = () => new Date(horloge += 1000);

    for (const [nom, data] of Object.entries(poolsInitiaux)) {
        lignes.set(nom, { id: prochainId++, data: structuredClone(data), revision: 1, updated_at: tic() });
    }

    const base = {
        lignes,
        donneesSorties: 0,

        /** Écriture « d'ailleurs » : une autre instance, via savePoolInTx. */
        ecrire(nom, data) {
            const ligne = lignes.get(nom);
            ligne.data = structuredClone(data);
            ligne.revision += 1;
            ligne.updated_at = tic();
        },
        /** Écriture qui ne fait pas avancer la revision (createOrUpdatePool). */
        ecrireSansRevision(nom, data) {
            const ligne = lignes.get(nom);
            ligne.data = structuredClone(data);
            ligne.updated_at = tic();
        },
        creer(nom, data) {
            lignes.set(nom, { id: prochainId++, data: structuredClone(data), revision: 1, updated_at: tic() });
        },
        supprimer(nom) { lignes.delete(nom); },
        renommer(ancien, nouveau) {
            const ligne = lignes.get(ancien);
            lignes.delete(ancien);
            lignes.set(nouveau, { ...ligne, updated_at: tic() });
        },

        async query(sql, params = []) {
            const complete = (nom, l) => {
                base.donneesSorties += 1;
                return { id: l.id, pool_name: nom, pool_data: structuredClone(l.data), revision: l.revision, updated_at: new Date(l.updated_at) };
            };
            if (sql.includes('pool_name = ANY')) {
                return { rows: params[0].filter(nom => lignes.has(nom)).map(nom => complete(nom, lignes.get(nom))) };
            }
            if (sql.includes("pool_data->>'draftScheduledAt' IS NOT NULL")) {
                return { rows: [...lignes].filter(([, l]) => l.data.draftScheduledAt != null).map(([nom, l]) => ({
                    pool_name: nom,
                    extrait: { draftScheduledAt: l.data.draftScheduledAt, instant: l.data.instant ?? null, draftOrder: l.data.draftOrder ?? null }
                })) };
            }
            if (sql.includes('FROM pools') && !sql.includes('WHERE')) {
                if (sql.includes('pool_data')) throw new Error(`Lecture complète de la table : ${sql}`);
                return { rows: [...lignes].map(([nom, l]) => ({ id: l.id, pool_name: nom, revision: l.revision, updated_at: new Date(l.updated_at) })) };
            }
            throw new Error(`Requête inattendue : ${sql}`);
        }
    };
    return base;
}

const pool = (extra = {}) => ({ creator: 'alice', draftOrder: [], teams: { Castors: { members: ['alice'] } }, ...extra });

function monter(pools) {
    const db = fausseBase(pools);
    const store = creerPoolStore({ db, usePostgres: true, draftFile: null, logger: silencieux });
    return { db, store };
}

describe('lireTous — cache revalidé', () => {
    test('le premier appel charge tout ; le suivant, sans changement, ne sort aucune donnée de pool', async () => {
        const { db, store } = monter({ A: pool(), B: pool(), C: pool() });

        const premier = await store.lireTous();
        assert.deepEqual(Object.keys(premier).sort(), ['A', 'B', 'C']);
        assert.equal(db.donneesSorties, 3);

        const second = await store.lireTous();
        assert.deepEqual(second, premier);
        assert.equal(db.donneesSorties, 3, 'rien de relu');
    });

    test("une écriture d'une autre instance se voit à la lecture suivante, et seul ce pool est relu", async () => {
        const { db, store } = monter({ A: pool(), B: pool() });
        await store.lireTous();

        db.ecrire('B', pool({ currentPickIndex: 4 }));
        const apres = await store.lireTous();

        assert.equal(apres.B.data.currentPickIndex, 4);
        assert.equal(apres.B.revision, 2);
        assert.equal(apres.A.revision, 1);
        assert.equal(db.donneesSorties, 3, 'A reste en cache, B est relu');
    });

    test('une écriture qui ne touche que updated_at se voit aussi', async () => {
        const { db, store } = monter({ A: pool() });
        await store.lireTous();

        db.ecrireSansRevision('A', pool({ creator: 'bob' }));
        assert.equal((await store.lireTous()).A.data.creator, 'bob');
    });

    test('un pool supprimé puis recréé sous le même nom est relu', async () => {
        const { db, store } = monter({ A: pool({ creator: 'alice' }) });
        await store.lireTous();

        db.supprimer('A');
        db.creer('A', pool({ creator: 'dora' }));
        const apres = await store.lireTous();
        assert.equal(apres.A.data.creator, 'dora');
        assert.equal(apres.A.id, 2);
    });

    test('suppression, création et renommage suivent la table', async () => {
        const { db, store } = monter({ A: pool(), B: pool() });
        await store.lireTous();

        db.supprimer('A');
        db.creer('N', pool());
        db.renommer('B', 'B2');
        assert.deepEqual(Object.keys(await store.lireTous()).sort(), ['B2', 'N']);
    });

    test('un pool supprimé entre les deux requêtes est omis, pas rendu vide', async () => {
        const { db, store } = monter({ A: pool(), B: pool() });
        const requete = db.query.bind(db);
        db.query = async (sql, params) => {
            if (sql.includes('pool_name = ANY')) db.supprimer('B');
            return requete(sql, params);
        };
        assert.deepEqual(Object.keys(await store.lireTous()), ['A']);
    });

    test("ce qu'un appelant modifie ne change pas ce que lira le suivant", async () => {
        const { store } = monter({ A: pool() });
        const lu = await store.lireTous();
        lu.A.data.creator = 'intrus';
        lu.A.data.teams.Castors.members.push('intrus');

        const relu = await store.lireTous();
        assert.equal(relu.A.data.creator, 'alice');
        assert.deepEqual(relu.A.data.teams.Castors.members, ['alice']);
    });

    test('lireDonneesBrutes profite du même cache', async () => {
        const { db, store } = monter({ A: pool() });
        await store.lireTous();
        assert.equal((await store.lireDonneesBrutes()).A.creator, 'alice');
        assert.equal(db.donneesSorties, 1);
    });
});

describe('lireDepartsPrevus', () => {
    test("ne rend que les pools qui portent une date, et seulement l'extrait utile", async () => {
        const { db, store } = monter({
            Prevu: pool({ draftScheduledAt: '2026-10-04T00:00:00.000Z', picksHistory: ['lourd'] }),
            Libre: pool()
        });

        const prevus = await store.lireDepartsPrevus();
        assert.deepEqual(prevus, {
            Prevu: { draftScheduledAt: '2026-10-04T00:00:00.000Z', instant: null, draftOrder: [] }
        });
        assert.equal(db.donneesSorties, 0, 'aucun pool complet');
    });

    test('mode fichier : même forme', async () => {
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'fz-prevus-'));
        const fichier = path.join(dossier, 'draft.json');
        fs.writeFileSync(fichier, JSON.stringify({
            Prevu: pool({ draftScheduledAt: '2026-10-04T00:00:00.000Z', instant: false }),
            Libre: pool()
        }));
        try {
            const store = creerPoolStore({ db: null, usePostgres: false, draftFile: fichier, logger: silencieux });
            assert.deepEqual(await store.lireDepartsPrevus(), {
                Prevu: { draftScheduledAt: '2026-10-04T00:00:00.000Z', instant: false, draftOrder: [] }
            });
        } finally {
            fs.rmSync(dossier, { recursive: true, force: true });
        }
    });
});
