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
const { echeanceChoix } = require('../lib/poolOps.js');

/** Clé du verrou consultatif de la file instantanée. Inchangée. */
const CLE_VERROU_INSTANTANE = 4815162342;

/** Empreinte stable d'une demande, pour distinguer réessai et identifiant recyclé. */
function empreinteRequete(requete) {
    const stable = JSON.stringify(requete === undefined ? null : requete, Object.keys(requete || {}).sort());
    return crypto.createHash('sha256').update(stable || 'null', 'utf8').digest('hex');
}

/** Ordre des clés d'un objet JSONB : par longueur en octets, puis octet par octet. */
function ordreJsonb(a, b) {
    const ea = Buffer.from(a, 'utf8');
    const eb = Buffer.from(b, 'utf8');
    return ea.length - eb.length || Buffer.compare(ea, eb);
}

function rangerCommeJsonb(valeur) {
    if (Array.isArray(valeur)) return valeur.map(rangerCommeJsonb);
    if (valeur === null || typeof valeur !== 'object') return valeur;
    const sortie = {};
    for (const cle of Object.keys(valeur).sort(ordreJsonb)) {
        // Une équipe peut s'appeler « __proto__ » : une affectation changerait
        // le prototype au lieu de créer la clé, comme JSON.parse le fait.
        Object.defineProperty(sortie, cle, {
            value: rangerCommeJsonb(valeur[cle]), enumerable: true, writable: true, configurable: true
        });
    }
    return sortie;
}

/**
 * Ce que PostgreSQL rendra de `valeur` une fois écrite dans une colonne JSONB.
 *
 * JSON.stringify fixe le contenu (plus de `undefined`, des dates en texte) ;
 * JSONB, lui, ne garde pas l'ordre des clés. Une copie gardée après écriture
 * doit être identique à une relecture, ordre des clés compris : sinon l'ordre
 * des équipes d'un pool changerait selon qu'il sort du cache ou de la base.
 */
function commeJsonb(valeur) {
    return rangerCommeJsonb(JSON.parse(JSON.stringify(valeur)));
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
    const resolutions = [];

    return {
        evenement(entree) { evenements.push(entree); return entree; },
        notifier(entree) { notifications.push(entree); return entree; },
        /** Clôt, dans la même transaction, les notifications de cette clé. */
        resoudre(dedupKey) { if (dedupKey) resolutions.push(dedupKey); },
        /** Signal socket à émettre APRÈS le commit, jamais avant. */
        diffuser(nom, charge) { diffusions.push({ nom, charge }); },
        get contenu() { return { evenements, notifications, diffusions, resolutions }; }
    };
}

/**
 * `confianceMs` : combien de temps la copie en mémoire des pools peut
 * resservir SANS demander sa version à la base. Seulement quand ce processus
 * est le seul à écrire (une seule instance) — server.js décide. Voir
 * `copieDeConfiance` plus bas.
 */
function creerPoolStore({ db, usePostgres, draftFile, logger = console, confianceMs = 0, horloge = () => Date.now() }) {

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

    /**
     * Copie en mémoire de la table `pools`, pour `lire` et `lireTous`.
     *
     * `lireTous` rapatriait la table entière — les données complètes de
     * chaque pool — à chaque appel : le sondage de la salle de repêchage,
     * chaque connexion socket, l'accueil du jour. C'est ce qui a épuisé le
     * transfert réseau mensuel de la base (Neon, septembre 2026). Désormais
     * un appel ne demande que la version de chaque ligne, et ne recharge que
     * les pools qui ont bougé. `lire` fait de même pour un seul pool : chaque
     * connexion socket relisait en entier chacun des pools de la personne.
     *
     * La copie ne fait jamais foi : elle est revalidée à CHAQUE appel. Une
     * écriture d'une autre instance ou d'un script se voit donc dès la
     * lecture suivante. La version d'une ligne tient en trois valeurs : son
     * id (un pool supprimé puis recréé sous le même nom), sa revision (que
     * fait avancer savePoolInTx) et updated_at (que posent aussi les
     * écritures qui ne passent pas par ce magasin — createOrUpdatePool,
     * renamePool).
     *
     * Une écriture de ce magasin range ce qu'elle vient d'écrire, après le
     * COMMIT : sans ça, la relecture qui suit chaque mutation ressortait de la
     * base le pool qu'on venait d'y mettre.
     *
     * Chaque appelant reçoit sa propre copie : modifier ce qu'on a lu ne
     * doit pas modifier ce que lira le suivant. La base rendait des objets
     * neufs à chaque requête ; le cache fait de même.
     */
    const copiesPools = new Map();
    function versionLigne(ligne) {
        const maj = ligne.updated_at instanceof Date ? ligne.updated_at.getTime() : (ligne.updated_at ?? '');
        return `${ligne.id}:${Number(ligne.revision) || 1}:${maj}`;
    }

    /**
     * Confiance dans la copie, quand ce processus est seul à écrire.
     *
     * Même revalidée par sa seule version, chaque lecture était une requête :
     * une page ouverte qui sondait chaque minute réveillait Neon chaque
     * minute. Avec une seule instance, toute écriture de pool passe par ce
     * processus — par ce magasin, ou par db.js, dont le compteur d'écritures
     * (db.generationDonnees) avance à chaque écriture, quelle qu'elle soit.
     * Tant qu'il n'a pas bougé depuis la dernière vérification, rien n'a pu
     * changer : la copie ressert sans requête.
     *
     * Ce que le compteur ne voit pas — un script, la console Neon — se voit au
     * plus tard après `confianceMs`, ou au redémarrage.
     *
     * `verifiee` : { generation, le } de la dernière confirmation par la base,
     * pour toute la table (lireTous) ou pour une copie (lire, écriture).
     */
    const generationActuelle = typeof db?.generationDonnees === 'function'
        ? () => db.generationDonnees()
        : () => null;
    let tableVerifiee = null;

    function encoreValable(verif, generation) {
        return confianceMs > 0 && generation !== null && !!verif &&
            verif.generation === generation && horloge() - verif.le < confianceMs;
    }

    function copieDeConfiance(copie, generation) {
        return !!copie && (encoreValable(tableVerifiee, generation) || encoreValable(copie.verifiee, generation));
    }

    /** Range une ligne lue (ou écrite) et renvoie la copie gardée. */
    function garderCopie(ligne, data, generation = generationActuelle()) {
        const copie = {
            version: versionLigne(ligne),
            id: ligne.id,
            revision: Number(ligne.revision) || 1,
            updatedAt: ligne.updated_at ?? null,
            data,
            verifiee: { generation, le: horloge() }
        };
        copiesPools.set(ligne.pool_name, copie);
        empreinteMemo = null;
        return copie;
    }

    function oublierCopie(nom) {
        if (copiesPools.delete(nom)) empreinteMemo = null;
    }

    /**
     * Empreinte de la table entière, calculée par PostgreSQL : une ligne de
     * 32 caractères, quel que soit le nombre de pools.
     *
     * La liste des versions que lireTous comparait coûtait une ligne par pool
     * et par appel — connexion socket, déconnexion, /draft sur huit pages —,
     * donc un transfert qui grandissait avec le nombre de pools du site et
     * non avec ceux de la personne. Elle ne sert plus que lorsque l'empreinte
     * ne correspond pas à celle de la copie.
     *
     * Même texte, octet pour octet, que empreinteLocale() : id, revision,
     * updated_at en texte, nom — une ligne par pool, triées par id.
     */
    const SQL_EMPREINTE = `SELECT md5(COALESCE(string_agg(
            id || ':' || revision || ':' || COALESCE(updated_at::text, '') || ':' || pool_name,
            E'\\n' ORDER BY id), '')) AS md5
        FROM pools`;

    const texteMaj = (valeur) => valeur instanceof Date ? valeur.toISOString() : (valeur ?? '');

    let empreinteMemo = null;
    function empreinteLocale() {
        if (empreinteMemo === null) {
            const lignes = [...copiesPools]
                .sort(([, a], [, b]) => a.id - b.id)
                .map(([nom, copie]) => `${copie.id}:${copie.revision}:${texteMaj(copie.updatedAt)}:${nom}`);
            empreinteMemo = crypto.createHash('md5').update(lignes.join('\n'), 'utf8').digest('hex');
        }
        return empreinteMemo;
    }

    /** Noms dans l'ordre de la dernière liste complète (created_at décroissant). */
    let ordrePools = null;

    /** Tous les pools depuis la copie, dans l'ordre de la table. */
    function servirTous() {
        const connus = new Set(ordrePools);
        // Créés par ce processus depuis la dernière liste : les plus récents
        // en tête, comme le ORDER BY created_at DESC qu'ils auraient reçu.
        const nouveaux = [...copiesPools.keys()].filter(nom => !connus.has(nom)).reverse();
        const pools = {};
        for (const nom of [...nouveaux, ...ordrePools]) {
            const copie = copiesPools.get(nom);
            // Supprimé depuis la dernière liste.
            if (!copie) continue;
            pools[nom] = { id: copie.id, name: nom, data: structuredClone(copie.data), revision: copie.revision };
        }
        return pools;
    }

    // ───────────────────────── Lectures ─────────────────────────

    async function lire(nomPool) {
        if (usePostgres) {
            // Compteur lu AVANT la requête : une écriture terminée pendant
            // qu'elle attend fera relire la fois suivante.
            const generation = generationActuelle();
            const copie = copiesPools.get(nomPool);
            if (copieDeConfiance(copie, generation)) {
                return { id: copie.id, name: nomPool, data: structuredClone(copie.data), revision: copie.revision };
            }
            // Une seule requête : la version de la ligne toujours, ses données
            // seulement si la copie ne lui correspond plus. Un pool qui n'a
            // pas bougé ne fait sortir de la base que sa version.
            const resultat = await db.query(
                `SELECT id, pool_name, revision, updated_at::text AS updated_at,
                        CASE WHEN id = $2 AND revision = $3 AND updated_at::text = $4
                             THEN NULL ELSE pool_data END AS pool_data
                   FROM pools WHERE pool_name = $1`,
                [nomPool, copie ? copie.id : null, copie ? copie.revision : null, copie ? copie.updatedAt : null]
            );
            if (resultat.rows.length === 0) {
                oublierCopie(nomPool);
                return null;
            }
            const ligne = resultat.rows[0];
            // Données absentes = la base a confirmé la copie lue avant la requête.
            let source;
            if (ligne.pool_data != null) {
                source = garderCopie(ligne, ligne.pool_data, generation);
            } else {
                source = copie;
                source.verifiee = { generation, le: horloge() };
            }
            return { id: source.id, name: ligne.pool_name, data: structuredClone(source.data), revision: source.revision };
        }
        const tout = lireFichier();
        if (!tout[nomPool]) return null;
        return { id: null, name: nomPool, data: tout[nomPool], revision: revisionFichier(nomPool) };
    }

    async function lireTous() {
        if (usePostgres) {
            // Rien d'écrit depuis la dernière vérification : la copie EST la
            // table, sans même demander l'empreinte (voir copieDeConfiance).
            const generation = generationActuelle();
            if (ordrePools && encoreValable(tableVerifiee, generation)) return servirTous();

            // L'empreinte d'abord. Si elle correspond, la copie EST la table :
            // rien d'autre ne sort. Les écritures de ce processus rangent leur
            // résultat dans la copie, donc elles ne la font pas diverger ;
            // seule une écriture d'ailleurs (script, autre instance, renommage)
            // oblige à relire la liste des versions.
            const empreinte = await db.query(SQL_EMPREINTE);
            if (ordrePools && empreinte.rows[0]?.md5 === empreinteLocale()) {
                tableVerifiee = { generation, le: horloge() };
                return servirTous();
            }

            const versions = await db.query('SELECT id, pool_name, revision, updated_at::text AS updated_at FROM pools ORDER BY created_at DESC');
            const aRecharger = versions.rows
                .filter(ligne => copiesPools.get(ligne.pool_name)?.version !== versionLigne(ligne))
                .map(ligne => ligne.pool_name);
            if (aRecharger.length > 0) {
                const frais = await db.query(
                    'SELECT id, pool_name, pool_data, revision, updated_at::text AS updated_at FROM pools WHERE pool_name = ANY($1)',
                    [aRecharger]
                );
                // La version gardée est celle de la ligne relue, pas celle
                // annoncée juste avant : si le pool a bougé entre les deux
                // requêtes, données et revision restent appariées.
                for (const ligne of frais.rows) garderCopie(ligne, ligne.pool_data, generation);
            }

            const presents = new Set(versions.rows.map(ligne => ligne.pool_name));
            for (const nom of [...copiesPools.keys()]) {
                if (!presents.has(nom)) oublierCopie(nom);
            }
            // Un pool supprimé ou renommé entre les deux requêtes n'a pas de
            // copie : servirTous() l'omet.
            ordrePools = versions.rows.map(ligne => ligne.pool_name);
            tableVerifiee = { generation, le: horloge() };
            return servirTous();
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

    /**
     * Les pools qui attendent un départ à heure fixe, `{ nom: extrait }`.
     *
     * L'extrait ne porte que ce qu'examine poolOps.repechagePrevuEchu : la
     * date, le mode rapide, l'ordre de sélection. Cette lecture tourne chaque
     * minute, jour et nuit ; lire les pools entiers y coûtait à lui seul plus
     * que le transfert réseau mensuel du plan gratuit de la base. Le filtre
     * s'applique dans PostgreSQL : un soir sans départ prévu, rien ne sort.
     *
     * L'ordre de sélection reste court ici : un départ le remplit et retire
     * la date du même coup (poolOps.demarrerRepechage).
     */
    async function lireDepartsPrevus() {
        if (usePostgres) {
            const resultat = await db.query(
                `SELECT pool_name,
                        jsonb_build_object(
                            'draftScheduledAt', pool_data->'draftScheduledAt',
                            'instant', pool_data->'instant',
                            'draftOrder', pool_data->'draftOrder'
                        ) AS extrait
                   FROM pools
                  WHERE pool_data->>'draftScheduledAt' IS NOT NULL
                  ORDER BY created_at DESC`
            );
            const prevus = {};
            for (const ligne of resultat.rows) prevus[ligne.pool_name] = ligne.extrait;
            return prevus;
        }
        const prevus = {};
        for (const [nom, data] of Object.entries(lireFichier())) {
            if (data && data.draftScheduledAt != null) {
                prevus[nom] = { draftScheduledAt: data.draftScheduledAt, instant: data.instant ?? null, draftOrder: data.draftOrder ?? null };
            }
        }
        return prevus;
    }

    /**
     * Les repêchages chronométrés dont un tour attend, `{ nom: extrait }`.
     *
     * Le minuteur des choix s'en sert au démarrage du serveur et, par
     * sécurité, une fois par minute (services/minuteurChoix.js). Même
     * contrainte que lireDepartsPrevus : l'extrait ne porte que ce qu'examine
     * poolOps.echeanceChoix, l'ordre réduit à sa longueur, et le filtre
     * s'applique dans PostgreSQL — un repêchage terminé garde sa limite, mais
     * ses deux curseurs se sont rejoints et il ne sort plus.
     *
     * Les CASE gardent les conversions à l'abri : PostgreSQL n'évalue pas les
     * conditions d'un WHERE dans l'ordre écrit.
     */
    async function lireChoixChronometres() {
        if (usePostgres) {
            const resultat = await db.query(
                `SELECT pool_name, extrait FROM (
                    SELECT pool_name,
                           jsonb_build_object(
                               'pickTimeLimitMs', pool_data->'pickTimeLimitMs',
                               'turnStartedAt', pool_data->'turnStartedAt',
                               'currentPickIndex', pool_data->'currentPickIndex',
                               'lastPickIndex', pool_data->'lastPickIndex',
                               'draftLength', CASE WHEN jsonb_typeof(pool_data->'draftOrder') = 'array'
                                                   THEN jsonb_array_length(pool_data->'draftOrder') ELSE 0 END
                           ) AS extrait,
                           CASE WHEN jsonb_typeof(pool_data->'currentPickIndex') = 'number'
                                THEN (pool_data->>'currentPickIndex')::numeric ELSE 0 END AS tour,
                           CASE WHEN jsonb_typeof(pool_data->'lastPickIndex') = 'number'
                                THEN (pool_data->>'lastPickIndex')::numeric ELSE -1 END AS joue
                      FROM pools
                     WHERE pool_data ? 'pickTimeLimitMs'
                 ) AS chronometres
                 WHERE joue < tour`
            );
            const enCours = {};
            for (const ligne of resultat.rows) {
                if (echeanceChoix(ligne.extrait) != null) enCours[ligne.pool_name] = ligne.extrait;
            }
            return enCours;
        }
        const enCours = {};
        for (const [nom, data] of Object.entries(lireFichier())) {
            if (data && echeanceChoix(data) != null) {
                enCours[nom] = {
                    pickTimeLimitMs: data.pickTimeLimitMs,
                    turnStartedAt: data.turnStartedAt,
                    currentPickIndex: data.currentPickIndex,
                    lastPickIndex: data.lastPickIndex,
                    draftLength: data.draftOrder.length
                };
            }
        }
        return enCours;
    }

    // ───────────────────────── Écritures ─────────────────────────

    /**
     * Transaction PostgreSQL avec ses outils. `travail` reçoit un contexte dont
     * TOUTES les opérations utilisent le même client.
     */
    async function transactionPostgres(travail, options = {}) {
        const journal = creerJournal();
        // Ce que la transaction a écrit : `null` pour un pool supprimé. Rangé
        // dans la copie après le COMMIT seulement — un ROLLBACK ne laisse rien.
        const ecrits = new Map();

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
                    ecrits.set(nom, { ...ecrit, data: commeJsonb(data) });
                    return ecrit;
                },

                async creerPool(nom, data) {
                    const cree = await db.createPoolInTx(client, nom, data);
                    if (cree) ecrits.set(nom, { ...cree, data: commeJsonb(data) });
                    return cree;
                },
                async supprimerPool(nom) {
                    const id = await db.deletePoolInTx(client, nom);
                    if (id != null) ecrits.set(nom, null);
                    return id;
                },

                /**
                 * Les salons de la file instantanée qui concernent cette
                 * personne, lus DANS la transaction.
                 *
                 * La file doit choisir entre « rejoindre un salon qui attend »
                 * et « en ouvrir un ». Lire hors transaction rouvrirait
                 * exactement la fenêtre que le verrou ferme : deux requêtes
                 * verraient « aucun salon » et en créeraient deux.
                 *
                 * Cette lecture rapatriait la table entière — tous les pools,
                 * données complètes — à chaque clic. Elle ne rend plus que ce
                 * que la file examine : les pools instantanés (marque
                 * `instant`, ou nom préfixé) qui attendent encore, et ceux déjà
                 * partis dont la personne est membre. Un repêchage terminé
                 * reste parmi ces derniers : c'est lib/draft.js qui le dit
                 * terminé, pas une requête.
                 *
                 * « Parti » a le même sens que repechageCommence() : un
                 * draftOrder qui est un tableau non vide. Pas `->0 IS NULL` :
                 * sur un scalaire JSONB (`draftOrder: null`), `->0` rend le
                 * scalaire lui-même, pas NULL (vérifié sur PostgreSQL 17).
                 */
                async salonsInstantanes({ username, prefixes }) {
                    const r = await client.query(
                        `SELECT id, pool_name, pool_data, revision
                           FROM pools
                          WHERE (pool_data->'instant' = 'true'::jsonb OR pool_name ^@ ANY($2::text[]))
                            AND (NOT COALESCE(jsonb_typeof(pool_data->'draftOrder') = 'array'
                                              AND pool_data->'draftOrder' <> '[]'::jsonb, false)
                                 OR jsonb_path_exists(pool_data, '$.teams.*.members[*] ? (@ == $u)',
                                                      jsonb_build_object('u', $1::text), true))`,
                        [username, prefixes]
                    );
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

                /**
                 * Les noms pris qui commencent par `prefixe`, lus dans la
                 * transaction. Seuls ceux-là peuvent entrer en collision avec
                 * le prochain « Pool rapide #N » : pas besoin des autres.
                 */
                async nomsPris(prefixe) {
                    const r = await client.query('SELECT pool_name FROM pools WHERE pool_name ^@ $1', [prefixe]);
                    return r.rows.map(ligne => ligne.pool_name);
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

        for (const [nom, ecrit] of ecrits) {
            if (ecrit === null) oublierCopie(nom);
            else garderCopie({ pool_name: nom, id: ecrit.id, revision: ecrit.revision, updated_at: ecrit.updatedAt }, ecrit.data);
        }

        return { ...resultat, journal };
    }

    /** Écrit activité et notifications accumulées, dans la transaction en cours. */
    async function ecrireJournal(client, journal) {
        const { evenements, notifications, resolutions } = journal.contenu;
        if (resolutions.length > 0 && typeof db.resolveNotificationsByKeyInTx === 'function') {
            await db.resolveNotificationsByKeyInTx(client, resolutions);
        }
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
                // Mode fichier : tout est déjà en mémoire, rien ne sort d'une
                // base. Rendre tous les pools reste juste — la file les filtre
                // elle-même — et évite de dupliquer ici le filtre de la requête.
                async salonsInstantanes() {
                    const pools = {};
                    for (const [nom, data] of Object.entries(travailEnCours)) {
                        pools[nom] = { id: null, name: nom, data, revision: revisionFichier(nom) };
                    }
                    return pools;
                },
                async nomsPris(prefixe) {
                    return Object.keys(travailEnCours).filter(nom => nom.startsWith(prefixe));
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
            const valeur = resultat.valeur || {};

            const revisionPool = resultat.sauvegarder !== false
                ? (await tx.sauvegarderPool(nomPool, verrouille.data)).revision
                : verrouille.revision;

            // `poolRevision` est toujours la revision du POOL. `revision` reste
            // la ou l'operation l'a mise si elle en porte une : une revision de
            // semaine finalisee et une revision de pool sont deux nombres
            // differents, et l'une ecrasait silencieusement l'autre.
            return {
                ...valeur,
                poolRevision: revisionPool,
                revision: valeur.revision !== undefined ? valeur.revision : revisionPool
            };
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
        lireDepartsPrevus,
        lireChoixChronometres,
        transaction,
        muterPool,
        estPostgres: () => usePostgres
    };
}

module.exports = { creerPoolStore, ErreurMetier, ErreurConflit, empreinteRequete, CLE_VERROU_INSTANTANE };
