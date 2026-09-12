/**
 * Concurrence réelle, contre un vrai PostgreSQL.
 *
 * Les tests unitaires ne peuvent pas prouver un verrou. Ils s'exécutent dans
 * un seul processus, sur une base simulée dont les « transactions » sont des
 * instantanés en mémoire : ils vérifient la logique, jamais l'isolation. Un
 * verrou oublié y passerait sans rien casser.
 *
 * Ces tests-ci ouvrent des CONNEXIONS SÉPARÉES et les font se rencontrer à des
 * points précis. Pas de `sleep` : une barrière fait attendre chaque partie
 * jusqu'à ce que l'autre soit arrivée, sinon un test « passe » simplement
 * parce que la machine était lente ce jour-là.
 *
 * ┌─ Pour les exécuter ──────────────────────────────────────────────────────┐
 * │ TEST_DATABASE_URL=postgres://…/fantazy_test npm run test:pg              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Sans `TEST_DATABASE_URL`, tout est ignoré : ces tests écrivent et détruisent
 * des données, et les pointer vers une base de développement ou de production
 * effacerait le travail de vraies personnes. La variable doit être distincte
 * de `DATABASE_URL` — le refus est explicite si les deux coïncident.
 */

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const path = require('path');

const URL_TEST = process.env.TEST_DATABASE_URL;
const RAISON = !URL_TEST
    ? 'TEST_DATABASE_URL absent : ces tests écrivent, ils exigent une base jetable'
    : (URL_TEST === process.env.DATABASE_URL
        ? 'TEST_DATABASE_URL est identique à DATABASE_URL : refus d’écrire dans la base applicative'
        : null);

const migrations = require('../../lib/migrations.js');
const { creerPoolStore } = require('../../services/poolStore.js');
const poolOps = require('../../lib/poolOps.js');
const instantDraft = require('../../lib/instantDraft.js');
const { generateSnakeOrder } = require('../../lib/draft.js');

/**
 * Barrière : chaque partie annonce son arrivée et attend l'autre.
 *
 * C'est ce qui remplace les `sleep`. Un test temporel prouve que la machine
 * était lente ; une barrière prouve que les deux transactions étaient bien
 * ouvertes EN MÊME TEMPS au moment décisif.
 */
function creerBarriere(nombre) {
    let arrivees = 0;
    let liberer;
    const pret = new Promise(resolve => { liberer = resolve; });
    return async function attendre() {
        arrivees += 1;
        if (arrivees >= nombre) liberer();
        return pret;
    };
}

describe('concurrence PostgreSQL', { skip: RAISON }, () => {
    let pool;
    let db;
    let store;

    before(async () => {
        // Le module db.js lit DATABASE_URL au chargement : on le pointe vers
        // la base jetable AVANT de le charger.
        process.env.DATABASE_URL = URL_TEST;
        delete require.cache[require.resolve('../../db.js')];
        db = require('../../db.js');
        pool = db.pool;

        await db.runMigrations({ dossier: path.join(__dirname, '../../migrations'), silencieux: true });
        store = creerPoolStore({ db, usePostgres: true, draftFile: null,
                                 logger: { log() {}, warn() {}, error() {} } });

        await nettoyer();
    });

    after(async () => {
        try { await nettoyer(); } finally { if (pool) await pool.end(); }
    });

    /** Efface tout ce que ces tests créent. Rien d'autre. */
    async function nettoyer() {
        await pool.query("DELETE FROM pools WHERE pool_name LIKE 'ZZTest%'");
        await pool.query("DELETE FROM users WHERE username LIKE 'zztest_%'");
        await pool.query("DELETE FROM operations WHERE scope LIKE 'zztest%'");
    }

    async function creerCompte(nom) {
        const r = await pool.query(
            `INSERT INTO users (username, password) VALUES ($1, 'x')
             ON CONFLICT (username) DO UPDATE SET password = 'x' RETURNING id`, [nom]);
        return r.rows[0].id;
    }

    async function creerPool(nom, data) {
        await pool.query('DELETE FROM pools WHERE pool_name = $1', [nom]);
        const r = await pool.query(
            'INSERT INTO pools (pool_name, pool_data, revision) VALUES ($1, $2, 1) RETURNING id',
            [nom, JSON.stringify(data)]);
        return r.rows[0].id;
    }

    const poolEnRepechage = (equipes) => ({
        creator: 'zztest_a',
        poolMode: 'cumulative',
        draftOrder: generateSnakeOrder(equipes, 4),
        currentPickIndex: 0,
        lastPickIndex: -1,
        config: { numOffensive: 2, numDefensive: 2, numGoalies: 0, numRookies: 0, numTeams: 0 },
        createdAt: new Date().toISOString(),
        teams: Object.fromEntries(equipes.map((nom, i) => [nom, {
            members: [`zztest_${String.fromCharCode(97 + i)}`],
            offensive: [], defensive: [], goalie: [], rookie: [], teams: []
        }]))
    });

    // ─────────────────────── Verrou de ligne ───────────────────────

    test('deux écritures simultanées du même pool ne s’écrasent pas', async () => {
        const nom = 'ZZTest lost update';
        await creerPool(nom, { teams: { A: { members: [], offensive: [] } }, marqueurs: [] });

        const barriere = creerBarriere(2);

        // Les deux transactions LISENT avant que l'autre écrive. Sans verrou,
        // la seconde écraserait le marqueur de la première.
        const ecrire = (marqueur) => store.muterPool(nom, {
            scope: 'zztest:lost-update',
            appliquer: async ({ data }) => {
                await barriere();
                data.marqueurs = [...(data.marqueurs || []), marqueur];
                return { valeur: { marqueur } };
            }
        });

        await Promise.all([ecrire('un'), ecrire('deux')]);

        const frais = await store.lire(nom);
        assert.deepEqual(frais.data.marqueurs.sort(), ['deux', 'un'],
            'une écriture a été perdue : le verrou de ligne ne tient pas');
        assert.equal(frais.revision, 3, 'chaque écriture validée fait avancer la révision');
    });

    test('deux pools différents ne se bloquent pas et ne se réécrivent pas', async () => {
        await creerPool('ZZTest A', { teams: {}, valeur: 'A' });
        await creerPool('ZZTest B', { teams: {}, valeur: 'B' });

        const barriere = creerBarriere(2);
        const toucher = (nom, valeur) => store.muterPool(nom, {
            scope: 'zztest:isolation',
            appliquer: async ({ data }) => {
                await barriere();
                data.valeur = valeur;
                return { valeur: {} };
            }
        });

        await Promise.all([toucher('ZZTest A', 'A2'), toucher('ZZTest B', 'B2')]);

        assert.equal((await store.lire('ZZTest A')).data.valeur, 'A2');
        assert.equal((await store.lire('ZZTest B')).data.valeur, 'B2',
            'la sauvegarde d’un pool ne doit jamais réécrire son voisin');
    });

    // ─────────────────────── Choix de repêchage ───────────────────────

    test('deux choix simultanés sur le même tour : un seul passe', async () => {
        const nom = 'ZZTest double pick';
        await creerCompte('zztest_a');
        await creerCompte('zztest_b');
        await creerPool(nom, poolEnRepechage(['E1', 'E2']));

        const barriere = creerBarriere(2);
        const choisir = (joueur) => store.muterPool(nom, {
            scope: 'zztest:pick',
            appliquer: async ({ data }) => {
                await barriere();
                const resultat = poolOps.choisirJoueur(data, {
                    username: 'zztest_a', playerName: joueur, position: 'offensive', tourAttendu: 0
                });
                if (!resultat.ok) throw Object.assign(new Error(resultat.message), { name: 'ErreurMetier' });
                return { valeur: { joueur } };
            }
        });

        const resultats = await Promise.allSettled([choisir('Joueur X'), choisir('Joueur Y')]);
        const passes = resultats.filter(r => r.status === 'fulfilled');
        assert.equal(passes.length, 1, 'le tour 0 ne peut être consommé qu’une fois');

        const frais = await store.lire(nom);
        assert.equal(frais.data.picksHistory.length, 1);
        assert.equal(frais.data.currentPickIndex, 1, 'le tour n’a avancé que d’un cran');
    });

    test('un réessai du même identifiant d’opération ne consomme pas un deuxième tour', async () => {
        const nom = 'ZZTest idempotence';
        await creerCompte('zztest_a');
        const userId = await creerCompte('zztest_b');
        await creerPool(nom, poolEnRepechage(['E1', 'E2']));

        const operationId = 'zztest-op-' + Date.now();
        const requete = { pool: nom, joueur: 'Joueur X' };

        const tenter = () => store.muterPool(nom, {
            scope: 'zztest:idempotence',
            operationId, requete, userId,
            appliquer: async ({ data }) => {
                const resultat = poolOps.choisirJoueur(data, {
                    username: 'zztest_a', playerName: 'Joueur X', position: 'offensive'
                });
                if (!resultat.ok) throw Object.assign(new Error(resultat.message), { name: 'ErreurMetier' });
                return { valeur: { joueur: 'Joueur X' } };
            }
        });

        const premier = await tenter();
        const second = await tenter();

        assert.equal(premier.rejouee, false);
        assert.equal(second.rejouee, true, 'le réessai doit relire son résultat, pas rejouer l’effet');

        const frais = await store.lire(nom);
        assert.equal(frais.data.picksHistory.length, 1);
        assert.equal(frais.data.currentPickIndex, 1);
    });

    test('deux réessais SIMULTANÉS du même identifiant n’exécutent l’effet qu’une fois', async () => {
        const nom = 'ZZTest idempotence concurrente';
        await creerCompte('zztest_a');
        await creerPool(nom, poolEnRepechage(['E1', 'E2']));

        const operationId = 'zztest-op-conc-' + Date.now();
        const requete = { pool: nom, joueur: 'Joueur X' };

        const tenter = () => store.muterPool(nom, {
            scope: 'zztest:idempotence',
            operationId, requete,
            appliquer: async ({ data }) => {
                const resultat = poolOps.choisirJoueur(data, {
                    username: 'zztest_a', playerName: 'Joueur X', position: 'offensive'
                });
                if (!resultat.ok) throw Object.assign(new Error(resultat.message), { name: 'ErreurMetier' });
                return { valeur: { joueur: 'Joueur X' } };
            }
        });

        const resultats = await Promise.allSettled([tenter(), tenter()]);
        const reussis = resultats.filter(r => r.status === 'fulfilled');
        assert.ok(reussis.length >= 1);

        const frais = await store.lire(nom);
        assert.equal(frais.data.picksHistory.length, 1,
            'deux requêtes concurrentes portant le même identifiant ont produit deux choix');
    });

    test('un identifiant recyclé pour une autre demande est refusé', async () => {
        const nom = 'ZZTest recyclage';
        await creerCompte('zztest_a');
        await creerPool(nom, poolEnRepechage(['E1', 'E2']));

        const operationId = 'zztest-op-rec-' + Date.now();
        await store.muterPool(nom, {
            scope: 'zztest:recyclage', operationId, requete: { joueur: 'X' },
            appliquer: async () => ({ sauvegarder: false, valeur: { joueur: 'X' } })
        });

        await assert.rejects(
            () => store.muterPool(nom, {
                scope: 'zztest:recyclage', operationId, requete: { joueur: 'Y' },
                appliquer: async () => ({ sauvegarder: false, valeur: { joueur: 'Y' } })
            }),
            (erreur) => { assert.equal(erreur.code, 409); return true; }
        );
    });

    // ─────────────────────── Annulation ───────────────────────

    test('une exception n’écrit rien : ni pool, ni événement, ni notification', async () => {
        const nom = 'ZZTest rollback';
        const poolId = await creerPool(nom, { teams: {}, valeur: 'intact' });
        const userId = await creerCompte('zztest_a');

        const clePool = 'zztest-dedup-' + Date.now();

        await assert.rejects(() => store.muterPool(nom, {
            scope: 'zztest:rollback',
            appliquer: async ({ data, journal }) => {
                data.valeur = 'modifie';
                journal.evenement({
                    poolId, type: 'pick', actorUserId: userId,
                    subject: { player: 'Fantôme' }, dedupKey: clePool
                });
                journal.notifier({
                    recipient: 'zztest_a', poolId, type: 'turn_current',
                    subject: {}, dedupKey: clePool
                });
                throw new Error('panne injectée entre deux écritures');
            }
        }), /panne injectée/);

        const frais = await store.lire(nom);
        assert.equal(frais.data.valeur, 'intact', 'le pool a été modifié malgré l’annulation');
        assert.equal(frais.revision, 1, 'la révision ne doit pas avoir bougé');

        const evenements = await pool.query('SELECT 1 FROM pool_activity WHERE dedup_key = $1', [clePool]);
        assert.equal(evenements.rowCount, 0, 'un événement a survécu à l’annulation');

        const notifications = await pool.query('SELECT 1 FROM notifications WHERE dedup_key = $1', [clePool]);
        assert.equal(notifications.rowCount, 0, 'une notification a survécu à l’annulation');
    });

    test('une clé de déduplication ne produit qu’une ligne, même sous deux transactions', async () => {
        const nom = 'ZZTest dedup';
        const poolId = await creerPool(nom, { teams: {} });
        await creerCompte('zztest_a');
        const cle = 'zztest-unique-' + Date.now();

        const ecrire = () => store.muterPool(nom, {
            scope: 'zztest:dedup',
            appliquer: async ({ journal }) => {
                journal.evenement({ poolId, type: 'pick', subject: { player: 'X' }, dedupKey: cle });
                journal.notifier({ recipient: 'zztest_a', poolId, type: 'turn_current',
                                   subject: {}, dedupKey: cle });
                return { sauvegarder: false, valeur: {} };
            }
        });

        await Promise.allSettled([ecrire(), ecrire()]);

        const evenements = await pool.query('SELECT COUNT(*)::int AS n FROM pool_activity WHERE dedup_key = $1', [cle]);
        assert.equal(evenements.rows[0].n, 1);

        const notifications = await pool.query(
            'SELECT COUNT(*)::int AS n FROM notifications WHERE dedup_key = $1', [cle]);
        assert.equal(notifications.rows[0].n, 1, 'deux alertes pour le même fait');
    });

    // ─────────────────────── File instantanée ───────────────────────

    test('deux arrivées simultanées dans une file vide ouvrent UN seul salon', async () => {
        await pool.query("DELETE FROM pools WHERE pool_name LIKE 'Repêchage instantané%'");
        await creerCompte('zztest_a');
        await creerCompte('zztest_b');

        const barriere = creerBarriere(2);

        // Le cas qu'aucun verrou de LIGNE ne peut couvrir : il n'y a pas de
        // ligne à verrouiller tant que le salon n'existe pas.
        const rejoindre = (qui) => store.transaction(async (tx) => {
            await tx.verrouConsultatif(store.CLE_VERROU_INSTANTANE);
            await barriere();

            const pools = await tx.listerPools();
            const plat = {};
            for (const [n, e] of Object.entries(pools)) plat[n] = e.data;

            const attente = instantDraft.salonCompatible(plat, { saison: '20262027' });
            if (attente) {
                const verrouille = await tx.verrouillerPool(attente);
                const equipe = instantDraft.inscrire(verrouille.data, qui);
                if (equipe) {
                    await tx.sauvegarderPool(attente, verrouille.data);
                    return { salon: attente, cree: false };
                }
            }
            const nom = instantDraft.prochainNom(plat);
            const data = instantDraft.creerPool(qui, { season: '20262027' });
            const cree = await tx.creerPool(nom, data);
            if (!cree) throw new Error('nom déjà pris');
            return { salon: nom, cree: true };
        }, { scope: 'zztest:instantane' });

        const resultats = await Promise.all([rejoindre('zztest_a'), rejoindre('zztest_b')]);
        const salons = new Set(resultats.map(r => r.valeur.salon));

        assert.equal(salons.size, 1,
            'deux clics simultanés ont ouvert deux salons : la file ne sert plus à rien');

        const frais = await store.lire([...salons][0]);
        assert.equal(instantDraft.participants(frais.data), 2);

        await pool.query("DELETE FROM pools WHERE pool_name LIKE 'Repêchage instantané%'");
    });

    test('la dernière place ne s’attribue qu’une fois', async () => {
        const nom = 'ZZTest derniere place';
        const data = instantDraft.creerPool('zztest_a', { season: '20262027' });
        instantDraft.inscrire(data, 'zztest_b');
        instantDraft.inscrire(data, 'zztest_c');
        data.instant = true;
        await creerPool(nom, data);
        for (const q of ['zztest_a', 'zztest_b', 'zztest_c', 'zztest_d', 'zztest_e']) await creerCompte(q);

        const barriere = creerBarriere(2);
        const entrer = (qui) => store.transaction(async (tx) => {
            await tx.verrouConsultatif(store.CLE_VERROU_INSTANTANE);
            await barriere();
            const verrouille = await tx.verrouillerPool(nom);
            const equipe = instantDraft.inscrire(verrouille.data, qui);
            if (!equipe) return { entre: false };
            await tx.sauvegarderPool(nom, verrouille.data);
            return { entre: true };
        }, { scope: 'zztest:derniere-place' });

        const resultats = await Promise.all([entrer('zztest_d'), entrer('zztest_e')]);
        const entres = resultats.filter(r => r.valeur.entre).length;
        assert.equal(entres, 1, 'la quatrième place a été donnée deux fois');

        const frais = await store.lire(nom);
        assert.equal(instantDraft.participants(frais.data), 4);
    });

    // ─────────────────────── Finalisation ───────────────────────

    test('deux finalisations concurrentes de la même semaine n’en inscrivent qu’une', async () => {
        const nom = 'ZZTest finalisation';
        const poolId = await creerPool(nom, { teams: {}, poolMode: 'head-to-head' });

        const barriere = creerBarriere(2);
        const finaliser = () => store.transaction(async (tx) => {
            await barriere();
            const fige = await db.insertFinalizedWeekInTx(tx.client, {
                poolId, season: '20262027', weekNumber: 1, revision: 1,
                weekStart: '2026-11-02', weekEnd: '2026-11-09',
                scoringVersion: '1.0.0', rosterBasis: 'current_roster',
                results: [{ team1: 'A', team2: 'B', team1Points: 10, team2Points: 5, winner: 'A' }],
                standingsDelta: { A: { wins: 1, losses: 0, ties: 0, pointsFor: 10, pointsAgainst: 5 } }
            });
            if (!fige) throw Object.assign(new Error('déjà finalisée'), { name: 'ErreurMetier' });
            return { fige: true };
        }, { scope: 'zztest:finalisation' });

        const resultats = await Promise.allSettled([finaliser(), finaliser()]);
        const reussies = resultats.filter(r => r.status === 'fulfilled').length;
        assert.equal(reussies, 1, 'la même semaine a été finalisée deux fois');

        const lignes = await pool.query(
            'SELECT COUNT(*)::int AS n FROM h2h_finalized_results WHERE pool_id = $1', [poolId]);
        assert.equal(lignes.rows[0].n, 1);
    });

    test('une correction crée une révision distincte, pas un doublon', async () => {
        const nom = 'ZZTest revision';
        const poolId = await creerPool(nom, { teams: {}, poolMode: 'head-to-head' });

        const ecrire = (revision, points) => store.transaction(async (tx) =>
            db.insertFinalizedWeekInTx(tx.client, {
                poolId, season: '20262027', weekNumber: 1, revision,
                weekStart: '2026-11-02', weekEnd: '2026-11-09',
                scoringVersion: '1.0.0', rosterBasis: 'current_roster',
                results: [{ team1: 'A', team2: 'B', team1Points: points, team2Points: 5 }],
                standingsDelta: {}
            }), { scope: 'zztest:revision' });

        await ecrire(1, 10);
        await ecrire(2, 8);

        const derniere = await db.getFinalizedWeek(null, poolId, '20262027', 1);
        assert.equal(Number(derniere.revision), 2, 'la révision en vigueur est la plus récente');
        assert.equal(derniere.results[0].team1Points, 8);

        const toutes = await pool.query(
            'SELECT COUNT(*)::int AS n FROM h2h_finalized_results WHERE pool_id = $1', [poolId]);
        assert.equal(toutes.rows[0].n, 2, 'les deux révisions coexistent : l’histoire n’est pas effacée');
    });

    // ─────────────────────── Sessions ───────────────────────

    test('une session révoquée ne se résout plus, et la suppression du compte l’emporte', async () => {
        const session = require('../../lib/session.js');
        const userId = await creerCompte('zztest_session');

        const jeton = session.genererJeton();
        const empreinte = session.empreinteJeton(jeton);
        await db.createSession(userId, empreinte, new Date(Date.now() + 3600000), 'test');

        let lue = await db.getSessionByTokenHash(empreinte);
        assert.equal(session.sessionValide(lue), true);

        await db.revokeSession(empreinte);
        lue = await db.getSessionByTokenHash(empreinte);
        assert.equal(session.sessionValide(lue), false, 'une session révoquée reste utilisable');

        // La suppression du compte emporte ses sessions par cascade : un
        // cookie qui traîne dans un navigateur ne peut plus rien ouvrir.
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        assert.equal(await db.getSessionByTokenHash(empreinte), null);
    });

    // ─────────────────────── Registre de migrations ───────────────────────

    test('rejouer les migrations est sans effet', async () => {
        const resultat = await db.runMigrations({
            dossier: path.join(__dirname, '../../migrations'), silencieux: true
        });
        assert.deepEqual(resultat.appliquees, [],
            'une migration déjà appliquée ne doit pas être rejouée');
    });

    test('une dérive du registre arrête le démarrage au lieu de deviner', async () => {
        const ligne = await pool.query('SELECT numero, empreinte FROM schema_migrations ORDER BY numero LIMIT 1');
        const original = ligne.rows[0];

        await pool.query('UPDATE schema_migrations SET empreinte = $1 WHERE numero = $2',
            ['0'.repeat(64), original.numero]);
        try {
            await assert.rejects(
                () => db.runMigrations({ dossier: path.join(__dirname, '../../migrations'), silencieux: true }),
                /[Dd]érive|derive/
            );
        } finally {
            await pool.query('UPDATE schema_migrations SET empreinte = $1 WHERE numero = $2',
                [original.empreinte, original.numero]);
        }
    });
});
