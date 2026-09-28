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
        /** Listes complètes des versions : une ligne par pool du site. */
        listesVersions: 0,

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
            // `lire` : la version toujours, les données seulement si la copie
            // annoncée (id, revision, updated_at) ne correspond plus.
            if (sql.includes('CASE WHEN id = $2')) {
                const [nom, id, revision, maj] = params;
                const l = lignes.get(nom);
                if (!l) return { rows: [] };
                const aJour = id === l.id && revision === l.revision
                    && maj != null && new Date(maj).getTime() === l.updated_at.getTime();
                if (aJour) return { rows: [{ id: l.id, pool_name: nom, revision: l.revision, updated_at: new Date(l.updated_at), pool_data: null }] };
                return { rows: [complete(nom, l)] };
            }
            if (sql.includes("pool_data->>'draftScheduledAt' IS NOT NULL")) {
                return { rows: [...lignes].filter(([, l]) => l.data.draftScheduledAt != null).map(([nom, l]) => ({
                    pool_name: nom,
                    extrait: { draftScheduledAt: l.data.draftScheduledAt, instant: l.data.instant ?? null, draftOrder: l.data.draftOrder ?? null }
                })) };
            }
            // L'empreinte de lireTous : le même texte que PostgreSQL agrège,
            // updated_at rendu comme le magasin le range ici (une Date).
            if (sql.includes('md5(')) {
                const texte = [...lignes]
                    .sort(([, a], [, b]) => a.id - b.id)
                    .map(([nom, l]) => `${l.id}:${l.revision}:${l.updated_at.toISOString()}:${nom}`)
                    .join('\n');
                return { rows: [{ md5: require('crypto').createHash('md5').update(texte, 'utf8').digest('hex') }] };
            }
            if (sql.includes('FROM pools') && !sql.includes('WHERE')) {
                if (sql.includes('pool_data')) throw new Error(`Lecture complète de la table : ${sql}`);
                base.listesVersions += 1;
                return { rows: [...lignes].map(([nom, l]) => ({ id: l.id, pool_name: nom, revision: l.revision, updated_at: new Date(l.updated_at) })) };
            }
            throw new Error(`Requête inattendue : ${sql}`);
        },

        // ── Transactions : ce que muterPool demande à la base ──
        async withTransaction(travail) {
            const photo = new Map([...lignes].map(([nom, l]) => [nom, { ...l, data: structuredClone(l.data) }]));
            try {
                return await travail({ query: async () => ({ rows: [] }) });
            } catch (erreur) {
                lignes.clear();
                for (const [nom, l] of photo) lignes.set(nom, l);
                throw erreur;
            }
        },
        async lockPool(_client, nom) {
            const l = lignes.get(nom);
            if (!l) return null;
            base.donneesSorties += 1;
            return { id: l.id, name: nom, data: structuredClone(l.data), revision: l.revision };
        },
        async savePoolInTx(_client, nom, data) {
            if (!lignes.has(nom)) return null;
            base.ecrire(nom, data);
            const l = lignes.get(nom);
            return { id: l.id, revision: l.revision, updatedAt: new Date(l.updated_at) };
        },
        async createPoolInTx(_client, nom, data) {
            if (lignes.has(nom)) return null;
            base.creer(nom, data);
            const l = lignes.get(nom);
            return { id: l.id, revision: l.revision, updatedAt: new Date(l.updated_at) };
        },
        async deletePoolInTx(_client, nom) {
            const l = lignes.get(nom);
            if (!l) return null;
            lignes.delete(nom);
            return l.id;
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

describe("lireTous — l'empreinte avant la liste", () => {
    test('sans changement, seule l empreinte sort : pas la liste des versions', async () => {
        const { db, store } = monter({ A: pool(), B: pool(), C: pool() });
        await store.lireTous();
        assert.equal(db.listesVersions, 1);

        const relu = await store.lireTous();
        await store.lireTous();
        assert.deepEqual(Object.keys(relu), ['A', 'B', 'C'], "l'ordre de la table est gardé");
        assert.equal(db.listesVersions, 1, 'une ligne par appel, quel que soit le nombre de pools');
    });

    test("les écritures de ce processus ne font pas relire la liste", async () => {
        const { db, store } = monter({ A: pool(), B: pool() });
        await store.lireTous();

        await store.muterPool('A', { appliquer: ({ data }) => { data.currentPickIndex = 5; return { valeur: {} }; } });
        await store.transaction(async (tx) => {
            await tx.creerPool('N', pool({ creator: 'nina' }));
            await tx.supprimerPool('B');
        });

        const apres = await store.lireTous();
        assert.equal(db.listesVersions, 1, 'la copie suit ses propres écritures');
        assert.equal(apres.A.data.currentPickIndex, 5);
        assert.deepEqual(Object.keys(apres), ['N', 'A'], 'le pool créé passe en tête, comme ORDER BY created_at DESC');
    });

    test("une écriture d'ailleurs fait relire la liste, puis on retombe sur l'empreinte", async () => {
        const { db, store } = monter({ A: pool(), B: pool() });
        await store.lireTous();

        db.ecrire('B', pool({ currentPickIndex: 9 }));
        assert.equal((await store.lireTous()).B.data.currentPickIndex, 9);
        assert.equal(db.listesVersions, 2);

        await store.lireTous();
        assert.equal(db.listesVersions, 2, 'de nouveau en phase');
    });

    test("un renommage ou une création d'ailleurs se voient aussi", async () => {
        const { db, store } = monter({ A: pool(), B: pool() });
        await store.lireTous();

        db.renommer('B', 'B2');
        assert.deepEqual(Object.keys(await store.lireTous()).sort(), ['A', 'B2']);

        db.creer('X', pool());
        assert.deepEqual(Object.keys(await store.lireTous()).sort(), ['A', 'B2', 'X']);
        assert.equal(db.listesVersions, 3);
    });

    test('un pool lu seul (lire) avant toute liste ne suffit pas à servir la table', async () => {
        const { db, store } = monter({ A: pool(), B: pool() });
        await store.lire('A');
        assert.deepEqual(Object.keys(await store.lireTous()).sort(), ['A', 'B']);
        assert.equal(db.listesVersions, 1);
    });
});

describe('lire — même cache, un pool à la fois', () => {
    test('le premier appel charge le pool ; le suivant, sans changement, ne sort que sa version', async () => {
        const { db, store } = monter({ A: pool(), B: pool() });

        const premier = await store.lire('A');
        assert.equal(premier.data.creator, 'alice');
        assert.equal(db.donneesSorties, 1);

        const second = await store.lire('A');
        assert.deepEqual(second, premier);
        assert.equal(db.donneesSorties, 1, 'rien de relu');
    });

    test('profite de ce que lireTous a déjà rangé, et inversement', async () => {
        const { db, store } = monter({ A: pool(), B: pool() });
        await store.lireTous();
        await store.lire('B');
        assert.equal(db.donneesSorties, 2, 'lire ne recharge pas ce que lireTous tient');

        db.ecrire('A', pool({ currentPickIndex: 2 }));
        assert.equal((await store.lire('A')).data.currentPickIndex, 2);
        await store.lireTous();
        assert.equal(db.donneesSorties, 3, 'lireTous ne recharge pas ce que lire vient de ranger');
    });

    test("une écriture d'ailleurs, même sans revision, se voit à la lecture suivante", async () => {
        const { db, store } = monter({ A: pool() });
        await store.lire('A');

        db.ecrire('A', pool({ currentPickIndex: 7 }));
        const apres = await store.lire('A');
        assert.equal(apres.data.currentPickIndex, 7);
        assert.equal(apres.revision, 2);

        db.ecrireSansRevision('A', pool({ creator: 'bob' }));
        assert.equal((await store.lire('A')).data.creator, 'bob');
    });

    test('un pool supprimé rend null, et recréé sous le même nom il est relu', async () => {
        const { db, store } = monter({ A: pool({ creator: 'alice' }) });
        await store.lire('A');

        db.supprimer('A');
        assert.equal(await store.lire('A'), null);

        db.creer('A', pool({ creator: 'dora' }));
        const recree = await store.lire('A');
        assert.equal(recree.data.creator, 'dora');
        assert.equal(recree.id, 2);
    });

    test("ce qu'un appelant modifie ne change pas ce que lira le suivant", async () => {
        const { store } = monter({ A: pool() });
        const lu = await store.lire('A');
        lu.data.teams.Castors.members.push('intrus');

        assert.deepEqual((await store.lire('A')).data.teams.Castors.members, ['alice']);
        assert.deepEqual((await store.lireTous()).A.data.teams.Castors.members, ['alice']);
    });
});

describe('écritures du magasin — rangées après le COMMIT', () => {
    test("après une mutation, relire le pool ne le fait pas ressortir de la base", async () => {
        const { db, store } = monter({ A: pool(), B: pool() });
        await store.lireTous();
        const avant = db.donneesSorties;

        const { valeur } = await store.muterPool('A', {
            appliquer: ({ data }) => { data.currentPickIndex = 3; return { valeur: {} }; }
        });
        assert.equal(db.donneesSorties, avant + 1, 'seul le verrou a lu le pool');

        const frais = await store.lire('A');
        assert.equal(frais.data.currentPickIndex, 3);
        assert.equal(frais.revision, valeur.poolRevision);
        assert.equal((await store.lireTous()).A.data.currentPickIndex, 3);
        assert.equal(db.donneesSorties, avant + 1, 'ni lire ni lireTous ne relisent ce qui vient d être écrit');
    });

    test('une mutation annulée ne laisse rien dans le cache', async () => {
        const { db, store } = monter({ A: pool() });
        await store.lire('A');

        await assert.rejects(store.muterPool('A', {
            appliquer: async ({ tx, data }) => {
                data.creator = 'fantome';
                await tx.sauvegarderPool('A', data);
                throw new Error('refus après écriture');
            }
        }));

        assert.equal(db.lignes.get('A').data.creator, 'alice', 'la base est revenue en arrière');
        assert.equal((await store.lire('A')).data.creator, 'alice', 'et le cache ne raconte pas autre chose');
    });

    test('création et suppression suivent la table', async () => {
        const { db, store } = monter({ A: pool() });
        await store.lireTous();

        await store.transaction(async (tx) => {
            await tx.creerPool('N', pool({ creator: 'nina' }));
            await tx.supprimerPool('A');
        });

        const avant = db.donneesSorties;
        assert.equal((await store.lire('N')).data.creator, 'nina');
        assert.equal(await store.lire('A'), null);
        assert.deepEqual(Object.keys(await store.lireTous()), ['N']);
        assert.equal(db.donneesSorties, avant, 'le pool créé sort du cache');
    });

    test('la copie gardée a la forme exacte que PostgreSQL rendrait', async () => {
        const { store } = monter({ A: pool() });

        await store.muterPool('A', {
            appliquer: ({ data }) => {
                // Insérées dans le « désordre » : JSONB range par longueur en
                // octets (Zèbres en fait 7), puis octet par octet. JSON.parse,
                // comme un corps de requête : « __proto__ » y devient une clé.
                data.teams = JSON.parse(
                    '{"Zèbres":{"members":[]},"__proto__":{"members":["piege"]},"Ours":{"members":[]},"Aigles":{"members":[]},"A":{"members":[]}}'
                );
                data.retireALecriture = undefined;
                data.demarreLe = new Date('2026-10-01T00:00:00.000Z');
                return { valeur: {} };
            }
        });

        const { data } = await store.lire('A');
        assert.deepEqual(Object.keys(data.teams), ['A', 'Ours', 'Aigles', 'Zèbres', '__proto__']);
        assert.ok(Object.prototype.hasOwnProperty.call(data.teams, '__proto__'), 'une clé, pas un prototype');
        assert.equal(Object.getPrototypeOf(data.teams), Object.prototype);
        assert.ok(!('retireALecriture' in data), 'undefined ne survit pas à JSON');
        assert.equal(data.demarreLe, '2026-10-01T00:00:00.000Z', 'une date redevient du texte');
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
