const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const migrations = require('./lib/migrations.js');

// PostgreSQL connection pool
// Use DATABASE_URL from environment (Render will provide this)
// Or fallback to local development config
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Test connection
pool.on('connect', () => {
    console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ Unexpected error on idle PostgreSQL client', err);
});

// =============================================
// REGISTRE DE MIGRATIONS
// =============================================

/**
 * Applique les migrations en attente, dans l'ordre, chacune dans sa propre
 * transaction, et refuse de continuer si la base a derive du depot.
 *
 * Rejouer la commande est sans effet : le registre `schema_migrations` note ce
 * qui a deja ete applique. En revanche une migration reecrite apres coup, ou
 * enregistree en base mais disparue du depot, arrete le demarrage — c'est
 * exactement le moment ou deux deploiements commencent a diverger en silence.
 */
async function runMigrations({ dossier = path.join(__dirname, 'migrations'), silencieux = false } = {}) {
    const log = silencieux ? () => {} : (...args) => console.log(...args);

    const fichiers = fs.readdirSync(dossier).filter(f => migrations.MOTIF_NOM.test(f));
    const surDisque = migrations.ordonner(
        fichiers.map(fichier => ({ fichier, sql: fs.readFileSync(path.join(dossier, fichier), 'utf-8') }))
    );

    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                numero INTEGER PRIMARY KEY,
                fichier VARCHAR(255) NOT NULL,
                empreinte CHAR(64) NOT NULL,
                applique_le TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        const deja = await client.query('SELECT numero, fichier, empreinte FROM schema_migrations ORDER BY numero');
        const { aAppliquer, derives } = migrations.planifier(surDisque, deja.rows);

        if (derives.length > 0) {
            const details = derives.map(d => `  - ${d.message}`).join('\n');
            throw new Error(`Derive du schema detectee :\n${details}`);
        }

        if (aAppliquer.length === 0) {
            log(`✅ Schéma à jour (${deja.rowCount} migration${deja.rowCount > 1 ? 's' : ''} appliquée${deja.rowCount > 1 ? 's' : ''})`);
            return { appliquees: [], total: deja.rowCount };
        }

        const appliquees = [];
        for (const migration of aAppliquer) {
            log(`🔧 Migration ${migration.fichier}...`);
            try {
                await client.query('BEGIN');
                await client.query(migration.sql);
                await client.query(
                    'INSERT INTO schema_migrations (numero, fichier, empreinte) VALUES ($1, $2, $3)',
                    [migration.numero, migration.fichier, migration.empreinte]
                );
                await client.query('COMMIT');
            } catch (erreur) {
                try { await client.query('ROLLBACK'); } catch { /* transaction deja perdue */ }
                throw new Error(`Migration ${migration.fichier} echouee : ${erreur.message}`);
            }
            appliquees.push(migration.fichier);
        }

        log(`✅ ${appliquees.length} migration(s) appliquée(s)`);
        return { appliquees, total: deja.rowCount + appliquees.length };
    } finally {
        client.release();
    }
}

/**
 * Initialisation du schema.
 *
 * Les CREATE TABLE IF NOT EXISTS etales dans cette fonction ont ete deplaces
 * dans migrations/0001_baseline.sql : une base vierge et une base en service
 * suivent maintenant exactement le meme chemin, et ce chemin est enregistre.
 */
async function initializeDatabase() {
    console.log('🔧 Initialisation du schéma...');
    const resultat = await runMigrations();
    console.log('✅ Schéma prêt');
    return resultat;
}

// =============================================
// TRANSACTIONS
// =============================================

/**
 * Une transaction, un client, du debut a la fin.
 *
 * Toute requete d'une transaction doit passer par CE client : `db.query` prend
 * une connexion quelconque du pool, donc une requete faite avec lui au milieu
 * d'un BEGIN s'execute en dehors de la transaction et ne sera ni annulee par
 * un ROLLBACK ni protegee par les verrous pris. C'est une exigence de
 * node-postgres, pas une preference de style :
 * https://node-postgres.com/features/transactions
 *
 * `travail` recoit donc le client et doit s'en servir partout, y compris dans
 * les fonctions qu'il appelle.
 */
async function withTransaction(travail) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const resultat = await travail(client);
        await client.query('COMMIT');
        return resultat;
    } catch (erreur) {
        try { await client.query('ROLLBACK'); } catch { /* transaction deja perdue */ }
        throw erreur;
    } finally {
        client.release();
    }
}

/**
 * Verrou consultatif tenu par la transaction en cours.
 *
 * Contrairement a pg_advisory_lock, il se relache au COMMIT ou au ROLLBACK :
 * impossible d'oublier de le rendre, impossible qu'une exception le laisse
 * pris jusqu'au prochain redemarrage. C'est le verrou qui couvre le cas
 * qu'aucun verrou de ligne ne peut couvrir : « aucun pool ne correspond, il
 * faut en creer un » — on ne verrouille pas une ligne qui n'existe pas encore.
 */
async function advisoryXactLock(client, cle) {
    await client.query('SELECT pg_advisory_xact_lock($1)', [cle]);
}

/**
 * Lit un pool en verrouillant sa ligne jusqu'a la fin de la transaction.
 *
 * Tout ce qui modifie un pool passe par ici : c'est ce qui garantit qu'une
 * lecture-modification-ecriture ne peut pas en ecraser une autre. Renvoie null
 * si le pool n'existe pas — sans creer de ligne, pour qu'un pool supprime ne
 * renaisse pas d'une requete tardive.
 */
async function lockPool(client, poolName) {
    const resultat = await client.query(
        'SELECT id, pool_name, pool_data, revision FROM pools WHERE pool_name = $1 FOR UPDATE',
        [poolName]
    );
    if (resultat.rows.length === 0) return null;
    const ligne = resultat.rows[0];
    return {
        id: ligne.id,
        name: ligne.pool_name,
        data: ligne.pool_data,
        revision: Number(ligne.revision) || 1
    };
}

/**
 * Verrouille plusieurs pools dans un ordre stable.
 *
 * L'ordre est ce qui empeche l'interblocage : deux transactions qui prennent
 * les memes verrous dans le meme ordre attendent, deux transactions qui les
 * prennent en ordre inverse se bloquent mutuellement.
 */
async function lockPools(client, poolNames) {
    const noms = [...new Set((poolNames || []).filter(Boolean))].sort();
    const pools = new Map();
    for (const nom of noms) {
        const verrouille = await lockPool(client, nom);
        if (verrouille) pools.set(nom, verrouille);
    }
    return pools;
}

/**
 * Ecrit un pool deja verrouille et fait avancer sa revision.
 *
 * La revision sert a deux choses : dire a un client que ce qu'il affiche est
 * perime, et permettre a une requete d'annoncer sur quelle version elle a ete
 * calculee. Elle ne remplace pas le verrou — elle le complete.
 */
async function savePoolInTx(client, poolName, poolData) {
    const resultat = await client.query(
        `UPDATE pools
            SET pool_data = $2, revision = revision + 1, updated_at = NOW()
          WHERE pool_name = $1
        RETURNING id, revision`,
        [poolName, JSON.stringify(poolData)]
    );
    if (resultat.rows.length === 0) return null;
    return { id: resultat.rows[0].id, revision: Number(resultat.rows[0].revision) };
}

/** Cree un pool dans la transaction en cours. Renvoie null si le nom est pris. */
async function createPoolInTx(client, poolName, poolData) {
    const resultat = await client.query(
        `INSERT INTO pools (pool_name, pool_data, revision)
         VALUES ($1, $2, 1)
         ON CONFLICT (pool_name) DO NOTHING
         RETURNING id, revision`,
        [poolName, JSON.stringify(poolData)]
    );
    if (resultat.rows.length === 0) return null;
    return { id: resultat.rows[0].id, revision: Number(resultat.rows[0].revision) };
}

async function deletePoolInTx(client, poolName) {
    const resultat = await client.query(
        'DELETE FROM pools WHERE pool_name = $1 RETURNING id',
        [poolName]
    );
    return resultat.rowCount > 0 ? resultat.rows[0].id : null;
}

// =============================================
// USER OPERATIONS
// =============================================

async function getAllUsers() {
    const result = await pool.query('SELECT username, is_admin FROM users ORDER BY username');
    return result.rows.map(row => ({
        username: row.username,
        isAdmin: row.is_admin
    }));
}

async function getUserByUsername(username) {
    const result = await pool.query(
        'SELECT username, password, is_admin, avatar_url FROM users WHERE username = $1',
        [username]
    );
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
        username: row.username,
        password: row.password,
        isAdmin: row.is_admin,
        avatarUrl: row.avatar_url || ''
    };
}

async function updateUserAvatar(username, avatarUrl) {
    await pool.query(
        'UPDATE users SET avatar_url = $1 WHERE username = $2',
        [avatarUrl, username]
    );
}

async function createUser(username, hashedPassword, isAdmin = false) {
    try {
        const result = await pool.query(
            'INSERT INTO users (username, password, is_admin) VALUES ($1, $2, $3) RETURNING username, is_admin',
            [username, hashedPassword, isAdmin]
        );
        return {
            username: result.rows[0].username,
            isAdmin: result.rows[0].is_admin
        };
    } catch (error) {
        if (error.code === '23505') { // Unique violation
            throw new Error('Username already exists');
        }
        throw error;
    }
}

async function deleteUser(username) {
    const result = await pool.query(
        'DELETE FROM users WHERE username = $1 RETURNING username',
        [username]
    );
    return result.rowCount > 0;
}

// =============================================
// POOL/DRAFT OPERATIONS
// =============================================

async function getAllPools() {
    const result = await pool.query('SELECT pool_name, pool_data FROM pools ORDER BY created_at DESC');
    const pools = {};
    result.rows.forEach(row => {
        pools[row.pool_name] = row.pool_data;
    });
    return pools;
}

async function getPoolByName(poolName) {
    const result = await pool.query(
        'SELECT pool_data FROM pools WHERE pool_name = $1',
        [poolName]
    );
    return result.rows.length > 0 ? result.rows[0].pool_data : null;
}

async function createOrUpdatePool(poolName, poolData) {
    const result = await pool.query(`
        INSERT INTO pools (pool_name, pool_data, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (pool_name)
        DO UPDATE SET
            pool_data = $2,
            updated_at = CURRENT_TIMESTAMP
        RETURNING pool_name
    `, [poolName, JSON.stringify(poolData)]);

    return result.rows[0].pool_name;
}

/**
 * Exécute `travail` en exclusion mutuelle sur l'ensemble des instances.
 *
 * Le repêchage instantané doit lire les pools puis en créer un seul si aucun
 * n'attend : entre la lecture et l'écriture, une deuxième requête qui lit les
 * mêmes données créerait un deuxième pool alors qu'une place existait. Une
 * simple file en mémoire suffit tant qu'il n'y a qu'un processus Node ; le
 * verrou consultatif de PostgreSQL couvre le jour où il y en a deux.
 *
 * `pg_advisory_lock` est pris sur une connexion dédiée — il est attaché à la
 * session, donc le libérer depuis une autre connexion du pool ne ferait rien.
 * Il est relâché quoi qu'il arrive : une exception dans `travail` ne doit pas
 * laisser la file bloquée jusqu'au prochain redémarrage.
 */
async function withAdvisoryLock(key, travail) {
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock($1)', [key]);
        return await travail();
    } finally {
        try {
            await client.query('SELECT pg_advisory_unlock($1)', [key]);
        } catch (error) {
            console.error('❌ Impossible de relacher le verrou consultatif:', error);
        }
        client.release();
    }
}

async function deletePool(poolName) {
    const result = await pool.query(
        'DELETE FROM pools WHERE pool_name = $1 RETURNING pool_name',
        [poolName]
    );
    return result.rowCount > 0;
}

/**
 * Renomme un pool partout ou son nom sert de cle.
 *
 * Le nom du pool n'est pas qu'une etiquette : c'est la cle primaire de la
 * table `pools` et la cle etrangere de tout ce qui s'y rattache — echanges,
 * annonces d'echange, releves de classement quotidiens. Le renommer d'un
 * seul cote laisserait ces lignes orphelines : les echanges disparaitraient
 * de la page Echanges et le mouvement de rang de l'accueil repartirait de
 * zero. Les cinq mises a jour tiennent donc dans une seule transaction.
 *
 * `trade_data.draftName` porte une deuxieme copie du nom, lue par
 * /trades/:draftName et par la page d'echange : la colonne seule ne suffit
 * pas.
 */
async function renamePool(oldName, newName) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const existant = await client.query(
            'SELECT 1 FROM pools WHERE pool_name = $1',
            [newName]
        );
        if (existant.rowCount > 0) {
            await client.query('ROLLBACK');
            return { ok: false, raison: 'existe' };
        }

        const renomme = await client.query(
            'UPDATE pools SET pool_name = $1, updated_at = CURRENT_TIMESTAMP WHERE pool_name = $2 RETURNING pool_name',
            [newName, oldName]
        );
        if (renomme.rowCount === 0) {
            await client.query('ROLLBACK');
            return { ok: false, raison: 'introuvable' };
        }

        await client.query(
            `UPDATE trades
                SET pool_name = $1,
                    trade_data = jsonb_set(trade_data, '{draftName}', to_jsonb($1::text), true),
                    updated_at = CURRENT_TIMESTAMP
              WHERE pool_name = $2`,
            [newName, oldName]
        );
        await client.query(
            'UPDATE trade_listings SET pool_name = $1 WHERE pool_name = $2',
            [newName, oldName]
        );
        await client.query(
            'UPDATE pool_rank_snapshots SET pool_name = $1 WHERE pool_name = $2',
            [newName, oldName]
        );

        await client.query('COMMIT');
        return { ok: true };
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* la transaction est deja perdue */ }
        throw error;
    } finally {
        client.release();
    }
}

// =============================================
// TRADE OPERATIONS
// =============================================

async function getAllTrades(poolName = null) {
    let query, params;

    if (poolName) {
        query = 'SELECT id, trade_data, status, created_at FROM trades WHERE pool_name = $1 ORDER BY created_at DESC';
        params = [poolName];
    } else {
        query = 'SELECT id, trade_data, status, created_at FROM trades ORDER BY created_at DESC';
        params = [];
    }

    const result = await pool.query(query, params);
    return result.rows.map(row => ({
        id: row.id,
        ...row.trade_data,
        status: row.status,
        createdAt: row.created_at
    }));
}

async function getPendingTrades(poolName) {
    const result = await pool.query(
        'SELECT id, trade_data FROM trades WHERE pool_name = $1 AND status = $2 ORDER BY created_at DESC',
        [poolName, 'pending']
    );
    return result.rows.map(row => ({
        id: row.id,
        ...row.trade_data
    }));
}

async function getCompletedTrades(poolName) {
    const result = await pool.query(
        'SELECT id, trade_data FROM trades WHERE pool_name = $1 AND status = $2 ORDER BY created_at DESC',
        [poolName, 'completed']
    );
    return result.rows.map(row => ({
        id: row.id,
        ...row.trade_data
    }));
}

async function createTrade(poolName, tradeData) {
    const result = await pool.query(
        'INSERT INTO trades (pool_name, trade_data, status) VALUES ($1, $2, $3) RETURNING id',
        [poolName, JSON.stringify(tradeData), 'pending']
    );
    return result.rows[0].id;
}

async function updateTradeStatus(tradeId, status) {
    const result = await pool.query(
        'UPDATE trades SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id',
        [status, tradeId]
    );
    return result.rowCount > 0;
}

async function deleteTrade(tradeId) {
    const result = await pool.query(
        'DELETE FROM trades WHERE id = $1 RETURNING id',
        [tradeId]
    );
    return result.rowCount > 0;
}

async function deleteTradesByPoolName(poolName) {
    const result = await pool.query(
        'DELETE FROM trades WHERE pool_name = $1',
        [poolName]
    );
    return result.rowCount;
}

// =============================================
// TRADE LISTING OPERATIONS
// =============================================

async function getActiveListingsForPool(poolName) {
    const result = await pool.query(
        `SELECT id, team_name, player_name, category, listed_by, created_at
         FROM trade_listings WHERE pool_name = $1 AND status = 'active'
         ORDER BY created_at DESC`,
        [poolName]
    );
    return result.rows.map(row => ({
        id: row.id,
        teamName: row.team_name,
        playerName: row.player_name,
        category: row.category,
        listedBy: row.listed_by,
        createdAt: row.created_at
    }));
}

async function getTradeListingById(id) {
    const result = await pool.query(
        `SELECT id, pool_name, team_name, player_name, category, listed_by, status
         FROM trade_listings WHERE id = $1`,
        [id]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
        id: row.id,
        poolName: row.pool_name,
        teamName: row.team_name,
        playerName: row.player_name,
        category: row.category,
        listedBy: row.listed_by,
        status: row.status
    };
}

// Returns the new row's id, or null if this player is already listed
// (the partial unique index rejects the insert).
async function createTradeListing(poolName, teamName, playerName, category, listedBy) {
    try {
        const result = await pool.query(
            `INSERT INTO trade_listings (pool_name, team_name, player_name, category, listed_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [poolName, teamName, playerName, category, listedBy]
        );
        return result.rows[0].id;
    } catch (error) {
        if (error.code === '23505') return null; // unique_violation — already listed
        throw error;
    }
}

async function removeTradeListing(id, poolName, teamName) {
    const result = await pool.query(
        `UPDATE trade_listings SET status = 'removed', removed_at = NOW()
         WHERE id = $1 AND pool_name = $2 AND team_name = $3 AND status = 'active'
         RETURNING id`,
        [id, poolName, teamName]
    );
    return result.rowCount > 0;
}

// Auto-expires a listing when its player changes teams via a completed trade.
async function removeTradeListingByPlayer(poolName, playerName) {
    const result = await pool.query(
        `UPDATE trade_listings SET status = 'removed', removed_at = NOW()
         WHERE pool_name = $1 AND player_name = $2 AND status = 'active'
         RETURNING id`,
        [poolName, playerName]
    );
    return result.rowCount;
}

// =============================================
// EXPORTS
// =============================================

// ==================== CACHED STATS FUNCTIONS ====================

// Save or update cached stats
async function saveCachedStats(cacheKey, data) {
    const client = await pool.connect();
    try {
        await client.query(`
            INSERT INTO cached_stats (cache_key, data, last_updated)
            VALUES ($1, $2, NOW())
            ON CONFLICT (cache_key)
            DO UPDATE SET data = $2, last_updated = NOW()
        `, [cacheKey, JSON.stringify(data)]);
        console.log(`✅ Cached stats saved: ${cacheKey}`);
    } catch (error) {
        console.error(`❌ Error saving cached stats for ${cacheKey}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

// Load cached stats
async function loadCachedStats(cacheKey) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT data, last_updated FROM cached_stats WHERE cache_key = $1',
            [cacheKey]
        );

        if (result.rows.length > 0) {
            return {
                ...result.rows[0].data,
                lastUpdated: result.rows[0].last_updated
            };
        }
        return null;
    } catch (error) {
        console.error(`❌ Error loading cached stats for ${cacheKey}:`, error);
        return null;
    } finally {
        client.release();
    }
}

// =============================================
// ECHANGES — OPERATIONS TRANSACTIONNELLES
// =============================================

/**
 * Verrouille une proposition d'echange jusqu'a la fin de la transaction.
 *
 * L'acceptation touchait quatre choses par quatre requetes separees :
 * l'alignement des deux equipes, le statut de l'echange, les propositions
 * concurrentes, et les annonces devenues fausses. Entre deux de ces requetes,
 * une autre acceptation pouvait passer — et le meme joueur changeait deux fois
 * d'equipe. Verrouiller la ligne est le point de depart de la correction.
 */
async function lockTradeInTx(client, tradeId) {
    const resultat = await client.query(
        'SELECT id, pool_name, trade_data, status FROM trades WHERE id = $1 FOR UPDATE',
        [tradeId]
    );
    if (resultat.rows.length === 0) return null;
    const ligne = resultat.rows[0];
    return {
        id: ligne.id,
        poolName: ligne.pool_name,
        data: ligne.trade_data,
        status: ligne.status
    };
}

async function createTradeInTx(client, poolName, tradeData) {
    const resultat = await client.query(
        `INSERT INTO trades (pool_name, trade_data, status, created_at, updated_at)
         VALUES ($1, $2, 'pending', NOW(), NOW())
         RETURNING id`,
        [poolName, JSON.stringify(tradeData)]
    );
    return resultat.rows[0].id;
}

async function updateTradeInTx(client, tradeId, status, tradeData = null) {
    const resultat = tradeData
        ? await client.query(
            'UPDATE trades SET trade_data = $1, status = $2, updated_at = NOW() WHERE id = $3 RETURNING id',
            [JSON.stringify(tradeData), status, tradeId])
        : await client.query(
            'UPDATE trades SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id',
            [status, tradeId]);
    return resultat.rowCount > 0;
}

/**
 * Les autres propositions en attente du meme pool, verrouillees.
 *
 * Verrouillees dans un ordre stable (par id) : deux acceptations simultanees
 * qui les prendraient en ordre inverse se bloqueraient mutuellement.
 */
async function lockPendingTradesInTx(client, poolName, sauf = null) {
    const resultat = await client.query(
        `SELECT id, trade_data FROM trades
          WHERE pool_name = $1 AND status = 'pending' AND ($2::int IS NULL OR id <> $2)
          ORDER BY id
          FOR UPDATE`,
        [poolName, sauf]
    );
    return resultat.rows.map(r => ({ id: r.id, data: r.trade_data }));
}

/** Retire les annonces d'un joueur, dans la transaction en cours. */
async function removeListingsByPlayerInTx(client, poolName, playerName) {
    const resultat = await client.query(
        `UPDATE trade_listings SET status = 'removed', removed_at = NOW()
          WHERE pool_name = $1 AND player_name = $2 AND status = 'active'
        RETURNING id`,
        [poolName, playerName]
    );
    return resultat.rows.map(r => r.id);
}

/** Ouvre une annonce dans la transaction en cours. null si deja annoncee. */
async function createListingInTx(client, poolName, teamName, playerName, category, listedBy) {
    try {
        const resultat = await client.query(
            `INSERT INTO trade_listings (pool_name, team_name, player_name, category, listed_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [poolName, teamName, playerName, category, listedBy]
        );
        return resultat.rows[0].id;
    } catch (erreur) {
        if (erreur.code === '23505') return null;
        throw erreur;
    }
}

async function removeListingInTx(client, id, poolName, teamName) {
    const resultat = await client.query(
        `UPDATE trade_listings SET status = 'removed', removed_at = NOW()
          WHERE id = $1 AND pool_name = $2 AND team_name = $3 AND status = 'active'
        RETURNING id`,
        [id, poolName, teamName]
    );
    return resultat.rowCount > 0;
}

/** Toutes les propositions d'un pool, d'un coup. Evite la boucle par echange. */
async function getTradesForPools(poolNames, statuts = null) {
    if (!poolNames || poolNames.length === 0) return [];
    const params = [poolNames];
    let filtre = '';
    if (statuts && statuts.length > 0) {
        params.push(statuts);
        filtre = 'AND status = ANY($2)';
    }
    const resultat = await pool.query(
        `SELECT id, pool_name, trade_data, status, created_at, updated_at
           FROM trades
          WHERE pool_name = ANY($1) ${filtre}
          ORDER BY COALESCE(updated_at, created_at) DESC`,
        params
    );
    return resultat.rows.map(r => ({
        id: r.id,
        poolName: r.pool_name,
        data: r.trade_data,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at
    }));
}

/** Toutes les annonces actives de plusieurs pools, en une requete. */
async function getActiveListingsForPools(poolNames) {
    if (!poolNames || poolNames.length === 0) return [];
    const resultat = await pool.query(
        `SELECT id, pool_name, team_name, player_name, category, listed_by, created_at
           FROM trade_listings
          WHERE pool_name = ANY($1) AND status = 'active'
          ORDER BY created_at DESC`,
        [poolNames]
    );
    return resultat.rows.map(r => ({
        id: r.id,
        poolName: r.pool_name,
        teamName: r.team_name,
        playerName: r.player_name,
        category: r.category,
        listedBy: r.listed_by,
        createdAt: r.created_at
    }));
}

/** Supprime tout ce qui se rattache au nom d'un pool disparu. */
async function deletePoolDependencies(poolName) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM trades WHERE pool_name = $1', [poolName]);
        await client.query('DELETE FROM trade_listings WHERE pool_name = $1', [poolName]);
        await client.query('DELETE FROM pool_rank_snapshots WHERE pool_name = $1', [poolName]);
        await client.query('COMMIT');
    } catch (erreur) {
        try { await client.query('ROLLBACK'); } catch { /* deja perdue */ }
        throw erreur;
    } finally {
        client.release();
    }
}

// =============================================
// SESSIONS
// =============================================

/**
 * Ouvre une session. Seule l'empreinte du jeton est ecrite : le jeton lui-meme
 * ne vit que dans le cookie du navigateur.
 */
async function createSession(userId, tokenHash, expiresAt, userAgent = null, impersonatedBy = null) {
    const resultat = await pool.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, impersonated_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at, expires_at, impersonated_by`,
        [userId, tokenHash, expiresAt, userAgent ? String(userAgent).slice(0, 500) : null, impersonatedBy]
    );
    return resultat.rows[0];
}

/**
 * Resout une session a partir de l'empreinte de son jeton.
 *
 * La jointure sur `users` est ce qui rend l'identite fiable : un compte
 * supprime n'a plus de ligne, donc plus de session, meme si un cookie traine
 * encore dans un navigateur. `is_admin` vient de la base, jamais du client.
 */
async function getSessionByTokenHash(tokenHash) {
    const resultat = await pool.query(
        `SELECT s.id, s.user_id, s.token_hash, s.created_at, s.last_seen_at,
                s.expires_at, s.revoked_at, s.impersonated_by,
                u.username, u.is_admin, u.avatar_url,
                a.username AS impersonator_username
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           LEFT JOIN users a ON a.id = s.impersonated_by
          WHERE s.token_hash = $1`,
        [tokenHash]
    );
    if (resultat.rows.length === 0) return null;
    const r = resultat.rows[0];
    return {
        id: r.id,
        userId: r.user_id,
        tokenHash: r.token_hash,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
        username: r.username,
        isAdmin: !!r.is_admin,
        avatarUrl: r.avatar_url || '',
        impersonatedBy: r.impersonated_by || null,
        impersonatorUsername: r.impersonator_username || null
    };
}

/**
 * Note qu'une session sert encore.
 *
 * Ecrit au plus une fois par heure : une ecriture a chaque requete ferait de
 * cette table le goulot de toutes les pages, pour une precision dont personne
 * n'a besoin.
 */
async function touchSession(sessionId) {
    await pool.query(
        `UPDATE sessions SET last_seen_at = NOW()
          WHERE id = $1 AND last_seen_at < NOW() - INTERVAL '1 hour'`,
        [sessionId]
    );
}

async function revokeSession(tokenHash) {
    const resultat = await pool.query(
        'UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id',
        [tokenHash]
    );
    return resultat.rowCount > 0;
}

/** Deconnecte partout : changement de mot de passe, suppression de compte. */
async function revokeAllSessionsForUser(userId) {
    const resultat = await pool.query(
        'UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
        [userId]
    );
    return resultat.rowCount;
}

/** Menage : sessions expirees depuis plus de 30 jours, et revoquees anciennes. */
async function purgeExpiredSessions() {
    const resultat = await pool.query(
        `DELETE FROM sessions
          WHERE expires_at < NOW() - INTERVAL '30 days'
             OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '30 days')`
    );
    return resultat.rowCount;
}

// =============================================
// IDENTIFIANTS RELATIONNELS
// =============================================

/** id numerique d'un compte, ou null. Les nouvelles tables s'y rattachent. */
async function getUserId(username) {
    const resultat = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    return resultat.rows.length > 0 ? resultat.rows[0].id : null;
}

async function getUsernamesByIds(ids) {
    if (!ids || ids.length === 0) return new Map();
    const resultat = await pool.query('SELECT id, username FROM users WHERE id = ANY($1)', [ids]);
    return new Map(resultat.rows.map(r => [r.id, r.username]));
}

/** id d'un pool par son nom, ou null. */
async function getPoolId(poolName) {
    const resultat = await pool.query('SELECT id FROM pools WHERE pool_name = $1', [poolName]);
    return resultat.rows.length > 0 ? resultat.rows[0].id : null;
}

// =============================================
// JOURNAL D'OPERATIONS (idempotence)
// =============================================

/**
 * Resultat deja enregistre pour cet identifiant d'operation.
 *
 * Trois reponses possibles : rien (operation neuve), le resultat (meme demande,
 * donc reessai), ou un conflit (meme identifiant, autre demande — ce qui n'est
 * pas un reessai mais un identifiant recycle, et doit etre refuse).
 */
async function findOperation(client, operationId, requestHash) {
    const resultat = await client.query(
        'SELECT operation_id, request_hash, result FROM operations WHERE operation_id = $1',
        [operationId]
    );
    if (resultat.rows.length === 0) return { etat: 'neuve' };
    const ligne = resultat.rows[0];
    if (ligne.request_hash !== requestHash) return { etat: 'conflit' };
    return { etat: 'rejouee', resultat: ligne.result };
}

/**
 * Enregistre le resultat DANS la transaction qui produit l'effet.
 *
 * C'est ce qui rend le reessai sur : soit l'effet et sa trace sont valides
 * ensemble, soit aucun des deux n'existe.
 */
async function recordOperation(client, { operationId, userId, scope, requestHash, result }) {
    await client.query(
        `INSERT INTO operations (operation_id, user_id, scope, request_hash, result)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (operation_id) DO NOTHING`,
        [operationId, userId || null, scope, requestHash, result == null ? null : JSON.stringify(result)]
    );
}

/** Menage : une trace d'operation ne sert plus a rien passe quelques jours. */
async function purgeOldOperations() {
    const resultat = await pool.query(
        "DELETE FROM operations WHERE created_at < NOW() - INTERVAL '7 days'"
    );
    return resultat.rowCount;
}

// =============================================
// ACTIVITE DE POOL ET NOTIFICATIONS
// =============================================

/**
 * Ecrit un evenement d'activite dans la transaction en cours.
 *
 * `dedupKey` est ce qui rend un reessai inoffensif : deux tentatives de la
 * meme operation produisent la meme cle, donc une seule ligne. Renvoie l'id
 * de la ligne — existante ou nouvelle — pour que les notifications s'y
 * rattachent dans les deux cas.
 */
async function insertActivityInTx(client, { poolId, type, actorUserId = null, subject = {}, occurredAt = null, dedupKey }) {
    const resultat = await client.query(
        `INSERT INTO pool_activity (pool_id, type, actor_user_id, subject, occurred_at, dedup_key)
         VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), $6)
         ON CONFLICT (dedup_key) DO NOTHING
         RETURNING id`,
        [poolId, type, actorUserId, JSON.stringify(subject || {}), occurredAt, dedupKey]
    );
    if (resultat.rows.length > 0) return { id: resultat.rows[0].id, cree: true };

    const existant = await client.query('SELECT id FROM pool_activity WHERE dedup_key = $1', [dedupKey]);
    return existant.rows.length > 0 ? { id: existant.rows[0].id, cree: false } : null;
}

/** Notification durable, ecrite dans la meme transaction que sa cause. */
async function insertNotificationInTx(client, { recipientUserId, type, poolId = null, activityId = null, subject = {}, occurredAt = null, expiresAt = null, dedupKey }) {
    const resultat = await client.query(
        `INSERT INTO notifications
             (recipient_user_id, type, pool_id, activity_id, subject, occurred_at, expires_at, dedup_key)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), $7, $8)
         ON CONFLICT (recipient_user_id, dedup_key) DO NOTHING
         RETURNING id`,
        [recipientUserId, type, poolId, activityId, JSON.stringify(subject || {}), occurredAt, expiresAt, dedupKey]
    );
    return resultat.rows.length > 0 ? resultat.rows[0].id : null;
}

/**
 * Page d'activite d'un pool, curseur descendant.
 *
 * Le curseur est `(occurred_at, id)` plutot qu'un OFFSET : une page reste
 * stable meme si des evenements s'ajoutent pendant la lecture.
 */
async function getPoolActivity(poolId, { limite = 20, avantDate = null, avantId = null } = {}) {
    const params = [poolId, Math.min(Math.max(Number(limite) || 20, 1), 100)];
    let filtre = '';
    if (avantDate && avantId) {
        params.push(avantDate, avantId);
        filtre = 'AND (a.occurred_at, a.id) < ($3::timestamptz, $4::bigint)';
    }
    const resultat = await pool.query(
        `SELECT a.id, a.type, a.actor_user_id, a.subject, a.occurred_at, u.username AS actor
           FROM pool_activity a
           LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE a.pool_id = $1 ${filtre}
          ORDER BY a.occurred_at DESC, a.id DESC
          LIMIT $2`,
        params
    );
    return resultat.rows.map(r => ({
        id: String(r.id),
        type: r.type,
        actor: r.actor || null,
        subject: r.subject || {},
        occurredAt: r.occurred_at
    }));
}

/** Notifications d'une personne, les plus recentes d'abord. */
async function getNotificationsForUser(userId, { limite = 50, inclureLues = true } = {}) {
    const params = [userId, Math.min(Math.max(Number(limite) || 50, 1), 200)];
    const filtre = inclureLues ? '' : 'AND n.read_at IS NULL';
    const resultat = await pool.query(
        `SELECT n.id, n.type, n.pool_id, n.subject, n.occurred_at, n.read_at,
                n.resolved_at, n.expires_at, p.pool_name
           FROM notifications n
           LEFT JOIN pools p ON p.id = n.pool_id
          WHERE n.recipient_user_id = $1 ${filtre}
          ORDER BY n.occurred_at DESC, n.id DESC
          LIMIT $2`,
        params
    );
    return resultat.rows.map(r => ({
        id: String(r.id),
        type: r.type,
        poolName: r.pool_name || null,
        subject: r.subject || {},
        occurredAt: r.occurred_at,
        readAt: r.read_at,
        resolvedAt: r.resolved_at,
        expiresAt: r.expires_at
    }));
}

/**
 * Pastille : non-lues encore affichables.
 *
 * Une alerte de tour perimee ne compte plus, meme jamais lue — sinon la
 * pastille reclamerait indefiniment une action qui n'existe plus.
 */
async function countUnreadNotifications(userId) {
    const resultat = await pool.query(
        `SELECT COUNT(*)::int AS total
           FROM notifications
          WHERE recipient_user_id = $1
            AND read_at IS NULL
            AND (expires_at IS NULL OR expires_at > NOW())`,
        [userId]
    );
    return resultat.rows[0].total;
}

/**
 * Marque des notifications comme lues.
 *
 * Lire ne resout rien : `resolved_at` appartient a l'action elle-meme. Lire
 * l'offre d'echange ne la fait pas disparaitre de la liste des choses a faire.
 */
async function markNotificationsRead(userId, ids) {
    if (!ids || ids.length === 0) return 0;
    const resultat = await pool.query(
        `UPDATE notifications SET read_at = NOW()
          WHERE recipient_user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL`,
        [userId, ids.map(String)]
    );
    return resultat.rowCount;
}

async function markAllNotificationsRead(userId) {
    const resultat = await pool.query(
        'UPDATE notifications SET read_at = NOW() WHERE recipient_user_id = $1 AND read_at IS NULL',
        [userId]
    );
    return resultat.rowCount;
}

/**
 * Cloture les notifications dont l'action vient d'aboutir.
 *
 * Appelee dans la transaction qui resout l'action : une offre acceptee cesse
 * d'etre en attente au moment exact ou elle est acceptee, pas au prochain
 * passage d'un nettoyeur.
 */
async function resolveNotificationsInTx(client, { type, subjectKey, subjectValue }) {
    const resultat = await client.query(
        `UPDATE notifications SET resolved_at = NOW()
          WHERE type = $1 AND resolved_at IS NULL AND subject->>$2 = $3`,
        [type, subjectKey, String(subjectValue)]
    );
    return resultat.rowCount;
}

/** Toutes les notifications d'une personne — export Loi 25. */
async function exportNotificationsForUser(userId) {
    const resultat = await pool.query(
        `SELECT n.type, n.subject, n.occurred_at, n.read_at, n.resolved_at, p.pool_name
           FROM notifications n
           LEFT JOIN pools p ON p.id = n.pool_id
          WHERE n.recipient_user_id = $1
          ORDER BY n.occurred_at DESC`,
        [userId]
    );
    return resultat.rows;
}

/**
 * Retention : l'historique est borne.
 *
 * La politique de confidentialite promet de ne pas garder indefiniment ;
 * garder six mois d'alertes de tour ne sert personne et allonge ce qu'une
 * fuite exposerait.
 */
async function purgeOldNotifications(jours = 180) {
    const resultat = await pool.query(
        `DELETE FROM notifications WHERE occurred_at < NOW() - ($1 || ' days')::interval`,
        [String(Math.max(1, Number(jours) || 180))]
    );
    return resultat.rowCount;
}

async function purgeOldActivity(jours = 365) {
    const resultat = await pool.query(
        `DELETE FROM pool_activity WHERE occurred_at < NOW() - ($1 || ' days')::interval`,
        [String(Math.max(1, Number(jours) || 365))]
    );
    return resultat.rowCount;
}

// =============================================
// RESULTATS H2H FINALISES ET RECAPS
// =============================================

/**
 * Ecrit un resultat hebdomadaire fige, dans la transaction qui met a jour le
 * classement. Renvoie null si cette semaine est deja finalisee a cette
 * revision — c'est ainsi qu'un reessai n'ajoute pas une deuxieme victoire.
 */
async function insertFinalizedWeekInTx(client, {
    poolId, season, weekNumber, revision = 1, weekStart, weekEnd,
    scoringVersion, rosterBasis, results, standingsDelta
}) {
    const resultat = await client.query(
        `INSERT INTO h2h_finalized_results
             (pool_id, season, week_number, revision, week_start, week_end,
              scoring_version, roster_basis, results, standings_delta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (pool_id, season, week_number, revision) DO NOTHING
         RETURNING id, revision`,
        [poolId, season, weekNumber, revision, weekStart, weekEnd,
         scoringVersion, rosterBasis, JSON.stringify(results), JSON.stringify(standingsDelta)]
    );
    return resultat.rows.length > 0 ? { id: resultat.rows[0].id, revision } : null;
}

/** Derniere revision en vigueur pour une semaine donnee. */
async function getFinalizedWeek(client, poolId, season, weekNumber) {
    const executeur = client || pool;
    const resultat = await executeur.query(
        `SELECT id, revision, week_start, week_end, scoring_version, roster_basis,
                results, standings_delta, finalized_at, superseded_at
           FROM h2h_finalized_results
          WHERE pool_id = $1 AND season = $2 AND week_number = $3
          ORDER BY revision DESC
          LIMIT 1`,
        [poolId, season, weekNumber]
    );
    return resultat.rows.length > 0 ? resultat.rows[0] : null;
}

async function listFinalizedWeeks(poolId, season) {
    const resultat = await pool.query(
        `SELECT DISTINCT ON (week_number)
                week_number, revision, week_start, week_end, results, finalized_at
           FROM h2h_finalized_results
          WHERE pool_id = $1 AND season = $2
          ORDER BY week_number DESC, revision DESC`,
        [poolId, season]
    );
    return resultat.rows;
}

/** Marque les revisions precedentes comme remplacees. */
async function supersedeFinalizedWeekInTx(client, poolId, season, weekNumber, nouvelleRevision) {
    await client.query(
        `UPDATE h2h_finalized_results SET superseded_at = NOW()
          WHERE pool_id = $1 AND season = $2 AND week_number = $3
            AND revision < $4 AND superseded_at IS NULL`,
        [poolId, season, weekNumber, nouvelleRevision]
    );
}

/** Ecrit ou remplace le recap d'une semaine. Idempotent par construction. */
async function upsertRecap({ poolId, season, weekNumber, resultRevision, poolMode, payload }) {
    const resultat = await pool.query(
        `INSERT INTO weekly_recaps (pool_id, season, week_number, result_revision, pool_mode, payload)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (pool_id, season, week_number)
         DO UPDATE SET result_revision = EXCLUDED.result_revision,
                       pool_mode = EXCLUDED.pool_mode,
                       payload = EXCLUDED.payload,
                       generated_at = NOW()
         RETURNING id, result_revision`,
        [poolId, season, weekNumber, resultRevision, poolMode, JSON.stringify(payload)]
    );
    return resultat.rows[0];
}

async function getRecap(poolId, season, weekNumber) {
    const resultat = await pool.query(
        `SELECT week_number, result_revision, pool_mode, payload, generated_at
           FROM weekly_recaps
          WHERE pool_id = $1 AND season = $2 AND week_number = $3`,
        [poolId, season, weekNumber]
    );
    return resultat.rows.length > 0 ? resultat.rows[0] : null;
}

async function getLatestRecap(poolId, season) {
    const resultat = await pool.query(
        `SELECT week_number, result_revision, pool_mode, payload, generated_at
           FROM weekly_recaps
          WHERE pool_id = $1 AND season = $2
          ORDER BY week_number DESC
          LIMIT 1`,
        [poolId, season]
    );
    return resultat.rows.length > 0 ? resultat.rows[0] : null;
}

// Helper function for direct queries (used by migration and fetch scripts)
const query = (text, params) => pool.query(text, params);

module.exports = {
    pool,
    query, // Export query function for direct database access
    initializeDatabase,
    runMigrations,
    // Transactions
    withTransaction,
    advisoryXactLock,
    lockPool,
    lockPools,
    savePoolInTx,
    createPoolInTx,
    deletePoolInTx,
    // Echanges transactionnels
    lockTradeInTx,
    createTradeInTx,
    updateTradeInTx,
    lockPendingTradesInTx,
    removeListingsByPlayerInTx,
    createListingInTx,
    removeListingInTx,
    getTradesForPools,
    getActiveListingsForPools,
    deletePoolDependencies,
    // Sessions
    createSession,
    getSessionByTokenHash,
    touchSession,
    revokeSession,
    revokeAllSessionsForUser,
    purgeExpiredSessions,
    // Identifiants
    getUserId,
    getUsernamesByIds,
    getPoolId,
    // Idempotence
    findOperation,
    recordOperation,
    purgeOldOperations,
    // Activite et notifications
    insertActivityInTx,
    insertNotificationInTx,
    getPoolActivity,
    getNotificationsForUser,
    countUnreadNotifications,
    markNotificationsRead,
    markAllNotificationsRead,
    resolveNotificationsInTx,
    exportNotificationsForUser,
    purgeOldNotifications,
    purgeOldActivity,
    // H2H fige et recaps
    insertFinalizedWeekInTx,
    getFinalizedWeek,
    listFinalizedWeeks,
    supersedeFinalizedWeekInTx,
    upsertRecap,
    getRecap,
    getLatestRecap,
    // Users
    getAllUsers,
    getUserByUsername,
    createUser,
    deleteUser,
    updateUserAvatar,
    // Pools
    getAllPools,
    getPoolByName,
    createOrUpdatePool,
    deletePool,
    renamePool,
    withAdvisoryLock,
    // Trades
    getAllTrades,
    getPendingTrades,
    getCompletedTrades,
    createTrade,
    updateTradeStatus,
    deleteTrade,
    deleteTradesByPoolName,
    // Trade listings
    getActiveListingsForPool,
    getTradeListingById,
    createTradeListing,
    removeTradeListing,
    removeTradeListingByPlayer,
    // Cached Stats
    saveCachedStats,
    loadCachedStats
};
