/**
 * Le contrat d'écriture des pools. Un seul.
 *
 * Ce qui existait avant : `saveDraftData()` chargeait TOUS les pools, en
 * modifiait un, puis réécrivait les autres tels qu'ils étaient au chargement.
 * Deux requêtes simultanées sur deux pools différents suffisaient donc à ce
 * que la seconde ressuscite l'ancienne version du pool de la première. Pire,
 * son chemin d'erreur PostgreSQL écrivait dans un fichier JSON puis diffusait
 * un succès : une écriture ratée avait exactement la même forme qu'une
 * réussie.
 *
 * Ici, toute mutation suit la même séquence :
 *
 *   1. une connexion, une transaction ;
 *   2. verrou de la ligne du pool, lecture de l'état réel ;
 *   3. validation de l'identité, des droits, de l'état et des entrées ;
 *   4. application du changement sur CE pool et ses lignes liées ;
 *   5. écriture des événements et notifications dans la MÊME transaction ;
 *   6. COMMIT — et seulement ensuite, l'accusé de réception et la diffusion ;
 *   7. ROLLBACK sinon, avec une vraie erreur. Jamais de repli vers un autre
 *      magasin après un échec PostgreSQL.
 *
 * Toutes les requêtes d'une transaction passent par le client qu'elle fournit.
 * `db.query` prendrait une autre connexion du pool : la requête s'exécuterait
 * hors transaction, sans les verrous pris et sans être annulée par le ROLLBACK.
 *
 * Mode fichier : un adaptateur explicitement mono-processus, sérialisé par une
 * file, avec remplacement atomique du fichier. Il ne prétend pas à la parité
 * transactionnelle — les opérations qui exigent PostgreSQL le disent.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Clé du verrou consultatif de la file instantanée. Inchangée. */
const CLE_VERROU_INSTANTANE = 4815162342;

/** Empreinte stable d'une demande, pour distinguer réessai et identifiant recyclé. */
function empreinteRequete(requete) {
    const stable = JSON.stringify(requete === undefined ? null : requete, Object.keys(requete || {}).sort());
    return crypto.createHash('sha256').update(stable || 'null', 'utf8').digest('hex');
}

/** Erreur métier : refus attendu, pas panne. Porte son code HTTP. */
class ErreurMetier extends Error {
    constructor(code, message, extra = {}) {
        super(message);
        this.name = 'ErreurMetier';
        this.code = code;
        this.extra = extra;
    }
}

/** Refus « votre état est périmé » : le client doit resynchroniser ce pool. */
class ErreurConflit extends ErreurMetier {
    constructor(message, extra = {}) {
        super(409, message, extra);
        this.name = 'ErreurConflit';
    }
}

/**
 * Journal d'une transaction : ce qui sera écrit avec elle, et rien avant.
 *
 * Les événements sont accumulés puis écrits juste avant le COMMIT. Un ROLLBACK
 * ne laisse donc aucune trace — un choix annulé ne produit pas d'entrée
 * « a choisi » dans l'activité du pool.
 */
function creerJournal() {
    const evenements = [];
    const notifications = [];
    const diffusions = [];

    return {
        evenement(entree) { evenements.push(entree); return entree; },
        notifier(entree) { notifications.push(entree); return entree; },
        /** Signal socket à émettre APRÈS le commit, jamais avant. */
        diffuser(nom, charge) { diffusions.push({ nom, charge }); },
        get contenu() { return { evenements, notifications, diffusions }; }
    };
}

function creerPoolStore({ db, usePostgres, draftFile, logger = console }) {

    // ───────────────────────── Mode fichier ─────────────────────────

    /**
     * File d'exécution : une mutation à la fois dans ce processus.
     *
     * Chaque travail s'accroche au précédent, réussi ou non — d'où le même
     * `travail` dans les deux branches. La chaîne conservée est neutralisée
     * pour qu'un rejet n'emporte pas les suivants.
     */
    let file = Promise.resolve();
    function enFile(travail) {
        const resultat = file.then(travail, travail);
        file = resultat.then(() => {}, () => {});
        return resultat;
    }

    /** Remplacement atomique : on écrit à côté, puis on renomme. */
    function ecrireFichierAtomique(chemin, contenu) {
        const temporaire = `${chemin}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(temporaire, contenu);
        fs.renameSync(temporaire, chemin);
    }

    function lireFichier() {
        try {
            return JSON.parse(fs.readFileSync(draftFile, 'utf-8'));
        } catch (erreur) {
            if (erreur.code === 'ENOENT') return {};
            throw erreur;
        }
    }

    /** Révisions du mode fichier : en mémoire, remises à 1 au redémarrage. */
    const revisionsFichier = new Map();
    function revisionFichier(nom) { return revisionsFichier.get(nom) || 1; }
    function avancerRevisionFichier(nom) {
        const suivante = revisionFichier(nom) + 1;
        revisionsFichier.set(nom, suivante);
        return suivante;
    }

    /** Idempotence du mode fichier : en mémoire, donc perdue au redémarrage. */
    const operationsMemoire = new Map();

    // ───────────────────────── Lectures ─────────────────────────

    async function lire(nomPool) {
        if (usePostgres) {
            const resultat = await db.query(
                'SELECT id, pool_name, pool_data, revision FROM pools WHERE pool_name = $1',
                [nomPool]
            );
            if (resultat.rows.length === 0) return null;
            const ligne = resultat.rows[0];
            return { id: ligne.id, name: ligne.pool_name, data: ligne.pool_data, revision: Number(ligne.revision) || 1 };
        }
        const tout = lireFichier();
        if (!tout[nomPool]) return null;
        return { id: null, name: nomPool, data: tout[nomPool], revision: revisionFichier(nomPool) };
    }

    async function lireTous() {
        if (usePostgres) {
            const resultat = await db.query('SELECT id, pool_name, pool_data, revision FROM pools ORDER BY created_at DESC');
            const pools = {};
            for (const ligne of resultat.rows) {
                pools[ligne.pool_name] = {
                    id: ligne.id,
                    name: ligne.pool_name,
                    data: ligne.pool_data,
                    revision: Number(ligne.revision) || 1
                };
            }
            return pools;
        }
        const tout = lireFichier();
        const pools = {};
        for (const [nom, data] of Object.entries(tout)) {
            pools[nom] = { id: null, name: nom, data, revision: revisionFichier(nom) };
        }
        return pools;
    }

    /** Les données brutes, forme historique `{ nom: pool }`. Lecture seule. */
    async function lireDonneesBrutes() {
        const pools = await lireTous();
        const plat = {};
        for (const [nom, enveloppe] of Object.entries(pools)) plat[nom] = enveloppe.data;
        return plat;
    }

    // ───────────────────────── Écritures ─────────────────────────

    /**
     * Transaction PostgreSQL avec ses outils. `travail` reçoit un contexte dont
     * TOUTES les opérations utilisent le même client.
     */
    async function transactionPostgres(travail, options = {}) {
        const journal = creerJournal();

        const resultat = await db.withTransaction(async (client) => {
            const verrouilles = new Map();

            const tx = {
                client,
                journal,
                async verrouConsultatif(cle) { await db.advisoryXactLock(client, cle); },

                async verrouillerPool(nom) {
                    if (verrouilles.has(nom)) return verrouilles.get(nom);
                    const pool = await db.lockPool(client, nom);
                    if (pool) verrouilles.set(nom, pool);
                    return pool;
                },

                /** Verrouille plusieurs pools dans un ordre stable (anti-interblocage). */
                async verrouillerPools(noms) {
                    const tries = [...new Set((noms || []).filter(Boolean))].sort();
                    const sortie = new Map();
                    for (const nom of tries) {
                        const pool = await tx.verrouillerPool(nom);
                        if (pool) sortie.set(nom, pool);
                    }
                    return sortie;
                },

                async sauvegarderPool(nom, data) {
                    const ecrit = await db.savePoolInTx(client, nom, data);
                    if (!ecrit) throw new ErreurMetier(404, `Pool introuvable : ${nom}`);
                    return ecrit;
                },

                async creerPool(nom, data) { return db.createPoolInTx(client, nom, data); },
                async supprimerPool(nom) { return db.deletePoolInTx(client, nom); },

                /**
                 * Tous les pools, lus DANS la transaction.
                 *
                 * La file instantanée doit choisir entre « rejoindre un salon
                 * qui attend » et « en ouvrir un ». Lire cette liste hors
                 * transaction rouvrirait exactement la fenêtre que le verrou
                 * ferme : deux requêtes verraient « aucun salon » et en
                 * créeraient deux.
                 */
                async listerPools() {
                    const r = await client.query('SELECT id, pool_name, pool_data, revision FROM pools');
                    const pools = {};
                    for (const ligne of r.rows) {
                        pools[ligne.pool_name] = {
                            id: ligne.id,
                            name: ligne.pool_name,
                            data: ligne.pool_data,
                            revision: Number(ligne.revision) || 1
                        };
                    }
                    return pools;
                },

                /** Résout des noms de comptes en identifiants, dans la transaction. */
                async identifiants(usernames) {
                    const noms = [...new Set((usernames || []).filter(Boolean))];
                    if (noms.length === 0) return new Map();
                    const r = await client.query('SELECT id, username FROM users WHERE username = ANY($1)', [noms]);
                    return new Map(r.rows.map(x => [x.username, x.id]));
                }
            };

            // Idempotence : un réessai relit son résultat au lieu de rejouer.
            if (options.operationId) {
                const empreinte = empreinteRequete(options.requete);
                const deja = await db.findOperation(client, options.operationId, empreinte);
                if (deja.etat === 'conflit') {
                    throw new ErreurMetier(409,
                        "Cet identifiant d'opération a déjà servi pour une autre demande.",
                        { code: 'operation_recyclee' });
                }
                if (deja.etat === 'rejouee') {
                    return { rejouee: true, valeur: deja.resultat };
                }
            }

            const valeur = await travail(tx);

            await ecrireJournal(client, journal);

            if (options.operationId) {
                await db.recordOperation(client, {
                    operationId: options.operationId,
                    userId: options.userId || null,
                    scope: options.scope || 'inconnu',
                    requestHash: empreinteRequete(options.requete),
                    result: valeur
                });
            }

            return { rejouee: false, valeur };
        });

        return { ...resultat, journal };
    }

    /** Écrit activité et notifications accumulées, dans la transaction en cours. */
    async function ecrireJournal(client, journal) {
        const { evenements, notifications } = journal.contenu;
        if (evenements.length === 0 && notifications.length === 0) return;

        const idsEvenements = new Map();
        for (const evenement of evenements) {
            if (!evenement.poolId) continue;
            const ecrit = await db.insertActivityInTx(client, evenement);
            if (ecrit) idsEvenements.set(evenement.dedupKey, ecrit.id);
        }

        const destinataires = notifications.map(n => n.recipient).filter(Boolean);
        let ids = new Map();
        if (destinataires.length > 0) {
            const r = await client.query('SELECT id, username FROM users WHERE username = ANY($1)', [[...new Set(destinataires)]]);
            ids = new Map(r.rows.map(x => [x.username, x.id]));
        }

        for (const notification of notifications) {
            const destinataireId = notification.recipientUserId || ids.get(notification.recipient);
            if (!destinataireId) continue;
            await db.insertNotificationInTx(client, {
                recipientUserId: destinataireId,
                type: notification.type,
                poolId: notification.poolId || null,
                activityId: notification.lieA ? idsEvenements.get(notification.lieA) || null : null,
                subject: notification.subject || {},
                occurredAt: notification.occurredAt || null,
                expiresAt: notification.expiresAt || null,
                dedupKey: notification.dedupKey
            });
        }
    }

    /**
     * Transaction du mode fichier : sérialisée, avec remplacement atomique.
     *
     * Ce n'est PAS une transaction PostgreSQL et ça ne s'en réclame pas. Un
     * seul processus, un instantané pris en début de travail, une réécriture
     * complète en fin. L'activité et les notifications durables ne sont pas
     * disponibles ici — elles sont ignorées, et le journal le dit une fois.
     */
    async function transactionFichier(travail, options = {}) {
        return enFile(async () => {
            const journal = creerJournal();

            if (options.operationId) {
                const empreinte = empreinteRequete(options.requete);
                const deja = operationsMemoire.get(options.operationId);
                if (deja && deja.empreinte !== empreinte) {
                    throw new ErreurMetier(409,
                        "Cet identifiant d'opération a déjà servi pour une autre demande.",
                        { code: 'operation_recyclee' });
                }
                if (deja) return { rejouee: true, valeur: deja.resultat, journal };
            }

            const avant = lireFichier();
            const travailEnCours = JSON.parse(JSON.stringify(avant));
            const revisionsPrevues = new Map();
            const supprimes = new Set();

            const tx = {
                client: null,
                journal,
                async verrouConsultatif() { /* file mono-processus : déjà exclusif */ },
                async verrouillerPool(nom) {
                    if (!travailEnCours[nom]) return null;
                    return { id: null, name: nom, data: travailEnCours[nom], revision: revisionFichier(nom) };
                },
                async verrouillerPools(noms) {
                    const sortie = new Map();
                    for (const nom of [...new Set((noms || []).filter(Boolean))].sort()) {
                        const pool = await tx.verrouillerPool(nom);
                        if (pool) sortie.set(nom, pool);
                    }
                    return sortie;
                },
                async sauvegarderPool(nom, data) {
                    travailEnCours[nom] = data;
                    supprimes.delete(nom);
                    const suivante = revisionFichier(nom) + 1;
                    revisionsPrevues.set(nom, suivante);
                    return { id: null, revision: suivante };
                },
                async creerPool(nom, data) {
                    if (travailEnCours[nom]) return null;
                    travailEnCours[nom] = data;
                    revisionsPrevues.set(nom, 1);
                    return { id: null, revision: 1 };
                },
                async supprimerPool(nom) {
                    if (!travailEnCours[nom]) return null;
                    delete travailEnCours[nom];
                    supprimes.add(nom);
                    return nom;
                },
                async listerPools() {
                    const pools = {};
                    for (const [nom, data] of Object.entries(travailEnCours)) {
                        pools[nom] = { id: null, name: nom, data, revision: revisionFichier(nom) };
                    }
                    return pools;
                },
                async identifiants() { return new Map(); }
            };

            const valeur = await travail(tx);

            // Réécriture complète : le mode fichier n'a pas d'autre granularité.
            // Atomique par renommage, pour qu'un arrêt brutal ne laisse pas un
            // draft.json tronqué.
            ecrireFichierAtomique(draftFile, JSON.stringify(travailEnCours, null, 2));

            for (const [nom, revision] of revisionsPrevues) revisionsFichier.set(nom, revision);
            for (const nom of supprimes) revisionsFichier.delete(nom);

            const { evenements, notifications } = journal.contenu;
            if (evenements.length > 0 || notifications.length > 0) {
                logger.warn?.('ℹ️ Mode fichier : activité et notifications durables non disponibles (PostgreSQL requis).');
            }

            if (options.operationId) {
                operationsMemoire.set(options.operationId, {
                    empreinte: empreinteRequete(options.requete),
                    resultat: valeur
                });
            }

            return { rejouee: false, valeur, journal };
        });
    }

    /** Point d'entrée unique : la bonne transaction selon le magasin actif. */
    async function transaction(travail, options = {}) {
        return usePostgres ? transactionPostgres(travail, options) : transactionFichier(travail, options);
    }

    /**
     * Mutation d'un pool unique — le cas de loin le plus fréquent.
     *
     * `appliquer` reçoit `{ tx, pool, poolId, revision, data }` et renvoie
     * `{ valeur, sauvegarder }`. Il travaille sur `data`, une copie déjà
     * verrouillée : ce qu'il modifie sera écrit, ce qu'il ne touche pas ne
     * sera pas réécrit à partir d'une lecture périmée.
     */
    async function muterPool(nomPool, { appliquer, operationId, requete, scope, userId, revisionAttendue } = {}) {
        return transaction(async (tx) => {
            const verrouille = await tx.verrouillerPool(nomPool);
            if (!verrouille) throw new ErreurMetier(404, 'Pool introuvable.');

            if (revisionAttendue != null && Number(revisionAttendue) !== verrouille.revision) {
                throw new ErreurConflit(
                    "Ce pool a changé depuis votre dernier chargement. Rafraîchissez avant de réessayer.",
                    { revision: verrouille.revision, revisionAttendue: Number(revisionAttendue) }
                );
            }

            const sortie = await appliquer({
                tx,
                journal: tx.journal,
                pool: verrouille,
                poolId: verrouille.id,
                revision: verrouille.revision,
                data: verrouille.data
            });

            const resultat = sortie || {};
            if (resultat.sauvegarder !== false) {
                const ecrit = await tx.sauvegarderPool(nomPool, verrouille.data);
                return { ...(resultat.valeur || {}), revision: ecrit.revision };
            }
            return { ...(resultat.valeur || {}), revision: verrouille.revision };
        }, { operationId, requete, scope, userId });
    }

    return {
        CLE_VERROU_INSTANTANE,
        ErreurMetier,
        ErreurConflit,
        empreinteRequete,
        lire,
        lireTous,
        lireDonneesBrutes,
        transaction,
        muterPool,
        estPostgres: () => usePostgres
    };
}

module.exports = { creerPoolStore, ErreurMetier, ErreurConflit, empreinteRequete, CLE_VERROU_INSTANTANE };
