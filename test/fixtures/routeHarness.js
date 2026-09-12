/**
 * Banc d'essai des routes.
 *
 * Les tests précédents découpaient le corps des routes dans server.js avec
 * indexOf() puis les exécutaient dans un vm. Ça marchait tant que le fichier
 * gardait sa forme exacte ; déplacer une route, ou fermer une accolade
 * ailleurs, cassait le test sans que rien ne soit cassé dans le produit.
 *
 * Ici, le VRAI module de routes est monté sur un faux Express, au-dessus du
 * VRAI contrat d'écriture (services/poolStore.js), lui-même posé sur une base
 * simulée en mémoire. Le chemin de code exercé est donc celui de la
 * production — celui qui prend des verrous, écrit le journal dans la
 * transaction, et annule tout sur exception — et non une variante « mode
 * fichier » que personne ne déploie.
 *
 * Ce qui est simulé se limite au moteur de stockage : les lignes vivent dans
 * des tableaux, et le ROLLBACK restaure un instantané.
 */

'use strict';

/** Copie profonde, comme le ferait un aller-retour JSONB. */
const copie = (valeur) => JSON.parse(JSON.stringify(valeur));

/** Faux Express : retient les gestionnaires et sait les rejouer. */
function creerApp() {
    const routes = [];
    const enregistrer = (methode) => (chemin, ...gestionnaires) => {
        routes.push({ methode, chemin, gestionnaires });
    };
    return {
        routes,
        get: enregistrer('GET'),
        post: enregistrer('POST'),
        put: enregistrer('PUT'),
        delete: enregistrer('DELETE'),
        use() {}
    };
}

/** Réponse minimale : statut, corps, en-têtes. */
function creerReponse() {
    return {
        statusCode: 200,
        body: undefined,
        entetes: {},
        headersSent: false,
        status(code) { this.statusCode = code; return this; },
        setHeader(nom, valeur) { this.entetes[nom] = valeur; return this; },
        json(corps) { this.body = corps; this.headersSent = true; return this; },
        send(corps) { this.body = corps; this.headersSent = true; return this; },
        type() { return this; }
    };
}

/** Paramètres d'un chemin déclaré (`/trades/:draftName`) face à un chemin réel. */
function apparier(modele, chemin) {
    const a = modele.split('/').filter(Boolean);
    const b = chemin.split('/').filter(Boolean);
    if (a.length !== b.length) return null;
    const params = {};
    for (let i = 0; i < a.length; i++) {
        if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
        else if (a[i] !== b[i]) return null;
    }
    return params;
}

/**
 * Base simulée, avec des transactions qui annulent vraiment.
 *
 * `withTransaction` prend un instantané de tout l'état avant d'appeler le
 * travail, et le restaure si une exception remonte. C'est ce qui permet de
 * vérifier la propriété qui compte : un refus ne doit laisser ni pool modifié,
 * ni événement, ni notification.
 */
function creerBaseSimulee(poolsInitiaux, users) {
    const etat = {
        pools: new Map(),
        trades: [],
        listings: [],
        activity: [],
        notifications: [],
        operations: new Map(),
        users: users.slice(),
        emissions: [],
        ecritures: []
    };

    let prochainIdPool = 1;
    for (const [nom, data] of Object.entries(poolsInitiaux)) {
        etat.pools.set(nom, { id: prochainIdPool++, name: nom, data: copie(data), revision: 1 });
    }

    let prochainEchange = 1;
    let prochaineAnnonce = 1;

    function instantane() {
        return {
            pools: new Map([...etat.pools].map(([n, p]) => [n, copie(p)])),
            trades: copie(etat.trades),
            listings: copie(etat.listings),
            activity: copie(etat.activity),
            notifications: copie(etat.notifications),
            operations: new Map(etat.operations),
            compteurs: { prochainEchange, prochaineAnnonce, prochainIdPool }
        };
    }

    function restaurer(photo) {
        etat.pools = photo.pools;
        etat.trades = photo.trades;
        etat.listings = photo.listings;
        etat.activity = photo.activity;
        etat.notifications = photo.notifications;
        etat.operations = photo.operations;
        prochainEchange = photo.compteurs.prochainEchange;
        prochaineAnnonce = photo.compteurs.prochaineAnnonce;
        prochainIdPool = photo.compteurs.prochainIdPool;
    }

    /**
     * Le client de transaction. Il ne répond qu'aux deux requêtes que le
     * contrat lui adresse directement ; tout le reste passe par des fonctions
     * nommées, qui le reçoivent et l'ignorent.
     */
    const client = {
        async query(sql, params = []) {
            if (sql.includes('FROM pools') && !sql.includes('WHERE')) {
                return { rows: [...etat.pools.values()].map(p => ({
                    id: p.id, pool_name: p.name, pool_data: p.data, revision: p.revision
                })) };
            }
            if (sql.includes('FROM users WHERE username = ANY')) {
                const noms = params[0] || [];
                return { rows: etat.users.filter(u => noms.includes(u.username))
                    .map(u => ({ id: u.id ?? u.username, username: u.username })) };
            }
            return { rows: [], rowCount: 0 };
        }
    };

    const db = {
        etat,

        async withTransaction(travail) {
            const photo = instantane();
            try {
                return await travail(client);
            } catch (erreur) {
                restaurer(photo);
                throw erreur;
            }
        },

        async advisoryXactLock() { /* un seul « processus » ici */ },

        async lockPool(_client, nom) {
            const pool = etat.pools.get(nom);
            return pool ? { id: pool.id, name: pool.name, data: pool.data, revision: pool.revision } : null;
        },
        async savePoolInTx(_client, nom, data) {
            const pool = etat.pools.get(nom);
            if (!pool) return null;
            pool.data = copie(data);
            pool.revision += 1;
            return { id: pool.id, revision: pool.revision };
        },
        async createPoolInTx(_client, nom, data) {
            if (etat.pools.has(nom)) return null;
            const pool = { id: prochainIdPool++, name: nom, data: copie(data), revision: 1 };
            etat.pools.set(nom, pool);
            return { id: pool.id, revision: 1 };
        },
        async deletePoolInTx(_client, nom) {
            const pool = etat.pools.get(nom);
            if (!pool) return null;
            etat.pools.delete(nom);
            return pool.id;
        },

        async findOperation(_client, operationId, requestHash) {
            const deja = etat.operations.get(operationId);
            if (!deja) return { etat: 'neuve' };
            if (deja.requestHash !== requestHash) return { etat: 'conflit' };
            return { etat: 'rejouee', resultat: deja.result };
        },
        async recordOperation(_client, { operationId, requestHash, result }) {
            if (!etat.operations.has(operationId)) {
                etat.operations.set(operationId, { requestHash, result: copie(result ?? null) });
            }
        },

        async insertActivityInTx(_client, evenement) {
            const existant = etat.activity.find(a => a.dedupKey === evenement.dedupKey);
            if (existant) return { id: existant.id, cree: false };
            const id = etat.activity.length + 1;
            etat.activity.push({ id, ...evenement, subject: copie(evenement.subject || {}) });
            return { id, cree: true };
        },
        async insertNotificationInTx(_client, notification) {
            const doublon = etat.notifications.some(
                n => n.recipientUserId === notification.recipientUserId && n.dedupKey === notification.dedupKey);
            if (doublon) return null;
            const id = etat.notifications.length + 1;
            etat.notifications.push({ id, ...notification, subject: copie(notification.subject || {}) });
            return id;
        },
        async resolveNotificationsInTx(_client, { type, subjectKey, subjectValue }) {
            const touchees = etat.notifications.filter(
                n => n.type === type && !n.resolvedAt &&
                     String(n.subject?.[subjectKey]) === String(subjectValue));
            touchees.forEach(n => { n.resolvedAt = new Date(); });
            return touchees.length;
        },

        async lockTradeInTx(_client, id) {
            const echange = etat.trades.find(t => t.id === Number(id));
            return echange ? { id: echange.id, poolName: echange.poolName, data: echange.data, status: echange.status } : null;
        },
        async createTradeInTx(_client, poolName, tradeData) {
            const id = prochainEchange++;
            etat.trades.push({ id, poolName, data: copie(tradeData), status: 'pending', createdAt: new Date() });
            return id;
        },
        async updateTradeInTx(_client, id, status, tradeData = null) {
            const echange = etat.trades.find(t => t.id === Number(id));
            if (!echange) return false;
            echange.status = status;
            if (tradeData) echange.data = copie(tradeData);
            etat.ecritures.push(status);
            return true;
        },
        async lockPendingTradesInTx(_client, poolName, sauf = null) {
            return etat.trades
                .filter(t => t.poolName === poolName && t.status === 'pending' && t.id !== Number(sauf))
                .sort((a, b) => a.id - b.id)
                .map(t => ({ id: t.id, data: t.data }));
        },
        async removeListingsByPlayerInTx(_client, poolName, playerName) {
            const touchees = etat.listings.filter(
                l => l.poolName === poolName && l.playerName === playerName && l.status === 'active');
            touchees.forEach(l => { l.status = 'removed'; });
            return touchees.map(l => l.id);
        },
        async createListingInTx(_client, poolName, teamName, playerName, category, listedBy) {
            const existe = etat.listings.some(
                l => l.poolName === poolName && l.teamName === teamName &&
                     l.playerName === playerName && l.status === 'active');
            if (existe) return null;
            const id = prochaineAnnonce++;
            etat.listings.push({ id, poolName, teamName, playerName, category, listedBy, status: 'active' });
            return id;
        },
        async removeListingInTx(_client, id, poolName, teamName) {
            const annonce = etat.listings.find(
                l => l.id === Number(id) && l.poolName === poolName &&
                     l.teamName === teamName && l.status === 'active');
            if (!annonce) return false;
            annonce.status = 'removed';
            return true;
        },

        async getTradeListingById(id) {
            const annonce = etat.listings.find(l => l.id === Number(id));
            return annonce ? { ...annonce } : null;
        },
        async getActiveListingsForPool(poolName) {
            return etat.listings.filter(l => l.poolName === poolName && l.status === 'active').map(l => ({ ...l }));
        },
        async getTradesForPools(poolNames, statuts = null) {
            return etat.trades
                .filter(t => poolNames.includes(t.poolName))
                .filter(t => !statuts || statuts.includes(t.status))
                .map(t => ({ id: t.id, poolName: t.poolName, data: t.data, status: t.status,
                             createdAt: t.createdAt, updatedAt: t.createdAt }));
        },

        async query(sql, params = []) {
            if (sql.includes('FROM pools') && sql.includes('WHERE pool_name')) {
                const pool = etat.pools.get(params[0]);
                return { rows: pool ? [{ id: pool.id, pool_name: pool.name, pool_data: pool.data, revision: pool.revision }] : [] };
            }
            return client.query(sql, params);
        },

        async getUserId(username) {
            const u = etat.users.find(x => x.username === username);
            return u ? (u.id ?? username) : null;
        },
        async getUserByUsername(username) {
            return etat.users.find(u => u.username === username) || null;
        },
        async deletePoolDependencies(poolName) {
            etat.trades = etat.trades.filter(t => t.poolName !== poolName);
            etat.listings = etat.listings.filter(l => l.poolName !== poolName);
        },
        async renamePool() { return { ok: true }; },
        async exportNotificationsForUser() { return []; }
    };

    return { db, etat, client };
}

/** Fausse diffusion : retient ce qui a été émis, et dans quel ordre. */
function creerFausseDiffusion(etat) {
    return {
        emissions: etat.emissions,
        poolMisAJour(nom, _data, revision) { etat.emissions.push(['poolMisAJour', 'pool:' + nom, { revision }]); },
        poolAChange(nom, revision) { etat.emissions.push(['poolAChange', 'pool:' + nom, { revision }]); },
        versUtilisateur(username, evenement, charge) { etat.emissions.push([evenement, 'user:' + username, charge]); },
        versPool(nom, evenement, charge) { etat.emissions.push([evenement, 'pool:' + nom, charge]); },
        diffuserJournal() {},
        async resynchroniserUtilisateur() {},
        async resynchroniserPool() {},
        async recalculerSalles() {}
    };
}

/** Faux middleware d'authentification : `req.auth` est fourni par l'appelant. */
function creerFauxAuth() {
    return {
        requireAuth(req, res, next) {
            if (!req.auth) return res.status(401).json({ message: "Vous devez être connecté.", code: 'non_authentifie' });
            next();
        },
        requireAdmin(req, res, next) {
            if (!req.auth) return res.status(401).json({ message: "Vous devez être connecté." });
            if (!req.auth.isAdmin) return res.status(403).json({ message: "Action réservée à l'administration." });
            next();
        },
        identite(req, nomFourni) {
            if (!req.auth) return { ok: false, code: 401, message: "Vous devez être connecté." };
            const fourni = typeof nomFourni === 'string' ? nomFourni.trim() : '';
            if (fourni && fourni !== req.auth.username && !req.auth.isAdmin) {
                return { ok: false, code: 403, message: "Compte différent." };
            }
            return { ok: true, username: req.auth.username, userId: req.auth.userId, isAdmin: req.auth.isAdmin };
        },
        async ouvrirSession() {},
        async fermerSession() {},
        async revoquerTout() {},
        async identifierSocket() { return null; }
    };
}

/**
 * Monte un ou plusieurs modules de routes et renvoie de quoi les appeler.
 *
 * `pools` est l'état initial, sous sa forme réelle `{ nom: donnéesDuPool }`.
 */
function monterRoutes(modules, { pools = {}, users = null, ctxExtra = {} } = {}) {
    const { creerPoolStore } = require('../../services/poolStore.js');

    const comptes = users || ['alice', 'bob', 'carl', 'dora'].map(n => ({ username: n, id: n }));
    const { db, etat } = creerBaseSimulee(pools, comptes);

    const silencieux = { log() {}, warn() {}, error() {} };
    const store = creerPoolStore({ db, usePostgres: true, draftFile: null, logger: silencieux });
    const diffusion = creerFausseDiffusion(etat);
    const auth = creerFauxAuth();
    const app = creerApp();

    const ctx = {
        auth, db, store, diffusion,
        usePostgres: true,
        racine: process.cwd(),
        presence: null,
        logger: silencieux,
        chargerUtilisateurs: async () => comptes,
        sauvegarderUtilisateurs: async () => {},
        uploadPool: { single: () => (req, res, next) => next() },
        uploadAvatar: { single: () => (req, res, next) => next() },
        nettoyerDependances: (nom) => db.deletePoolDependencies(nom),
        renommerPool: async () => [],
        construireCalendrierH2H: async () => {},
        saisonCourante: () => '20262027',
        ...ctxExtra
    };

    for (const module of [].concat(modules)) module.monter(app, ctx);

    /** Appelle une route comme le ferait Express : chaîne de gestionnaires. */
    async function appeler(methode, chemin, { body = {}, query = {}, auth: identite = null } = {}) {
        for (const route of app.routes) {
            if (route.methode !== methode) continue;
            const params = apparier(route.chemin, chemin);
            if (!params) continue;

            const req = { method: methode, body, query, params, auth: identite, headers: {}, path: chemin };
            const res = creerReponse();

            for (const gestionnaire of route.gestionnaires) {
                let suivant = false;
                await gestionnaire(req, res, () => { suivant = true; });
                if (!suivant) break;
            }
            return res;
        }
        throw new Error(`Route absente : ${methode} ${chemin}`);
    }

    const lirePool = (nom) => {
        const pool = etat.pools.get(nom);
        return pool ? pool.data : null;
    };
    const revisionDe = (nom) => {
        const pool = etat.pools.get(nom);
        return pool ? pool.revision : null;
    };

    return {
        app, ctx, store, db, diffusion, auth, etat, appeler, lirePool, revisionDe,
        nettoyer() { /* rien à nettoyer : tout vit en mémoire */ }
    };
}

/** Un pool prêt à l'emploi : deux équipes, repêchage terminé, échanges ouverts. */
function poolTermine(options = {}) {
    return {
        maxPlayers: 4,
        creator: options.creator || 'alice',
        draftOrder: options.draftOrder || ['Équipe 1', 'Équipe 2'],
        currentPickIndex: options.currentPickIndex ?? 0,
        lastPickIndex: -1,
        config: options.config || { numOffensive: 1, numDefensive: 0, numGoalies: 0, numRookies: 0, numTeams: 0 },
        poolMode: options.poolMode || 'cumulative',
        allowTrades: options.allowTrades !== false,
        createdAt: '2026-09-01T00:00:00.000Z',
        teams: options.teams || {
            'Équipe 1': { members: ['alice'], offensive: ['Joueur A'], defensive: [], goalie: [], rookie: [], teams: [] },
            'Équipe 2': { members: ['bob'], offensive: ['Joueur B'], defensive: [], goalie: [], rookie: [], teams: [] }
        }
    };
}

/** Un pool avant le repêchage : équipes vides, aucun ordre tiré. */
function poolNeuf(options = {}) {
    const teams = {};
    for (let i = 1; i <= (options.nbEquipes || 4); i++) {
        teams[`Équipe ${i}`] = { members: [], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] };
    }
    for (const [equipe, membres] of Object.entries(options.membres || { 'Équipe 1': ['alice'] })) {
        teams[equipe] = teams[equipe] || { members: [], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] };
        teams[equipe].members = membres.slice();
    }
    return {
        maxPlayers: options.maxPlayers || 4,
        creator: options.creator || 'alice',
        draftOrder: [],
        currentPickIndex: 0,
        lastPickIndex: -1,
        config: options.config || { numOffensive: 1, numDefensive: 1, numGoalies: 0, numRookies: 0, numTeams: 0 },
        poolMode: options.poolMode || 'cumulative',
        allowTrades: true,
        createdAt: '2026-09-01T00:00:00.000Z',
        teams
    };
}

module.exports = { monterRoutes, poolTermine, poolNeuf, creerReponse, creerApp, creerBaseSimulee };
