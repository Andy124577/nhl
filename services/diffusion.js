/**
 * Socket.IO : qui est connecté, qui reçoit quoi.
 *
 * Avant, la connexion initiale émettait `draftUpdated` avec l'objet complet
 * des pools — sans même passer par le filtre qui retire les empreintes de mots
 * de passe, contrairement à la route HTTP. N'importe quel visiteur ouvrant une
 * page recevait donc l'état de tous les pools du site, empreintes comprises.
 *
 * Désormais :
 *   - une connexion s'identifie avec le MÊME cookie de session que les
 *     requêtes HTTP ; le canal temps réel n'est pas une porte de service ;
 *   - chaque socket entre dans une salle par pool dont il est membre, et dans
 *     une salle personnelle ;
 *   - un message est un SIGNAL DE RAFRAÎCHISSEMENT, pas la vérité. Un client
 *     qui se reconnecte va relire l'état autorisé et sa révision. Si la
 *     validation a réussi mais que la diffusion s'est perdue, l'opération a
 *     quand même eu lieu : le prochain rafraîchissement la retrouve.
 *
 * Les salles se recalculent quand l'appartenance change — invitation, entrée,
 * départ, suppression de compte —, sinon un ancien membre continuerait de
 * recevoir l'état d'un pool qu'il a quitté.
 */

'use strict';

const authz = require('../lib/authz.js');

function creerDiffusion({ io, auth, store, crochets = {}, logger = console }) {

    /** username → Set de sockets. Sert à recalculer les salles d'une personne. */
    const socketsParUtilisateur = new Map();

    const sallePool = (nom) => `pool:${nom}`;
    const salleUtilisateur = (username) => `user:${username}`;

    function suivre(username, socket) {
        if (!username) return;
        if (!socketsParUtilisateur.has(username)) socketsParUtilisateur.set(username, new Set());
        socketsParUtilisateur.get(username).add(socket);
    }

    function oublier(username, socket) {
        const ensemble = socketsParUtilisateur.get(username);
        if (!ensemble) return;
        ensemble.delete(socket);
        if (ensemble.size === 0) socketsParUtilisateur.delete(username);
    }

    /** Les pools dont cette personne est membre, d'après l'état persisté. */
    async function poolsDe(username) {
        if (!username) return [];
        const pools = await store.lireTous();
        return Object.entries(pools)
            .filter(([, enveloppe]) => authz.estMembre(enveloppe.data, username))
            .map(([nom]) => nom);
    }

    /**
     * Remet ce socket dans exactement les salles auxquelles il a droit.
     *
     * Recalcul complet plutôt qu'ajout : c'est le retrait qui compte. Ajouter
     * une salle à l'entrée est facile à faire partout ; enlever celle d'un pool
     * quitté est ce qu'on oublie, et c'est précisément la fuite.
     */
    async function recalculerSalles(socket) {
        const username = socket.data && socket.data.auth && socket.data.auth.username;

        for (const salle of socket.rooms) {
            if (salle !== socket.id && (salle.startsWith('pool:') || salle.startsWith('user:'))) {
                socket.leave(salle);
            }
        }

        if (!username) return [];

        socket.join(salleUtilisateur(username));
        const noms = await poolsDe(username);
        for (const nom of noms) socket.join(sallePool(nom));
        return noms;
    }

    /** Recalcule les salles de tous les sockets d'une personne. */
    async function resynchroniserUtilisateur(username) {
        const ensemble = socketsParUtilisateur.get(username);
        if (!ensemble) return;
        for (const socket of ensemble) {
            try { await recalculerSalles(socket); } catch (erreur) {
                logger.error('⚠️ Recalcul des salles impossible :', erreur.message);
            }
        }
    }

    /** Recalcule les salles de tous les membres d'un pool. */
    async function resynchroniserPool(nomPool, usernames = null) {
        let noms = usernames;
        if (!noms) {
            const enveloppe = await store.lire(nomPool);
            noms = enveloppe ? authz.membresDuPool(enveloppe.data) : [];
        }
        for (const username of noms) await resynchroniserUtilisateur(username);
    }

    function enregistrer() {
        io.on('connection', async (socket) => {
            let identite = null;
            try {
                identite = await auth.identifierSocket(socket.handshake);
            } catch (erreur) {
                logger.error('⚠️ Identification socket impossible :', erreur.message);
            }

            socket.data.auth = identite;

            if (!identite) {
                // Connexion anonyme : elle peut rester ouverte — les pages
                // publiques s'en servent pour savoir qu'elles sont en ligne —
                // mais elle n'entre dans aucune salle et ne reçoit aucun état.
                socket.emit('sessionAnonyme');
                return;
            }

            suivre(identite.username, socket);
            socket.on('disconnect', () => {
                oublier(identite.username, socket);
                if (crochets.auDeconnecte) {
                    Promise.resolve(crochets.auDeconnecte({ socket, username: identite.username }))
                        .catch(erreur => logger.error('⚠️ Déconnexion :', erreur.message));
                }
            });

            try {
                const noms = await recalculerSalles(socket);
                // Un signal, pas un état : le client va relire ce qu'il a le
                // droit de lire. Rien d'autre ne transite ici.
                socket.emit('sessionPrete', { username: identite.username, pools: noms });
                // La présence du salon d'attente se greffe ici : elle a besoin
                // de savoir qu'une personne — et non un onglet de plus — vient
                // d'arriver dans les pools dont elle est membre.
                if (crochets.auConnecte) {
                    await crochets.auConnecte({ socket, username: identite.username, pools: noms });
                }
            } catch (erreur) {
                logger.error('⚠️ Abonnement des salles impossible :', erreur.message);
            }

            // Resynchronisation demandée par le client (changement de pool,
            // retour d'onglet). Recalculée côté serveur : un client ne choisit
            // pas ses salles.
            socket.on('resync', async () => {
                try {
                    const noms = await recalculerSalles(socket);
                    socket.emit('sessionPrete', { username: identite.username, pools: noms });
                } catch (erreur) {
                    logger.error('⚠️ Resync impossible :', erreur.message);
                }
            });
        });
    }

    // ───────────────────────── Émissions ─────────────────────────

    /**
     * Un pool a changé. Les membres reçoivent la vue à laquelle ils ont droit,
     * sous la forme historique `{ nom: pool }` que les pages lisent déjà.
     *
     * Toujours APRÈS le COMMIT. Diffuser avant reviendrait à annoncer un
     * changement qu'un ROLLBACK pourrait encore effacer.
     */
    function poolMisAJour(nomPool, data, revision = null) {
        const vue = authz.vueMembre(nomPool, data, revision);
        io.to(sallePool(nomPool)).emit('draftUpdated', { [nomPool]: vue });
        io.to(sallePool(nomPool)).emit('poolUpdated', { poolName: nomPool, revision });
    }

    /** Signal léger : « relis ce pool ». Sans charge utile. */
    function poolAChange(nomPool, revision = null) {
        io.to(sallePool(nomPool)).emit('poolUpdated', { poolName: nomPool, revision });
    }

    /** Signal adressé à une personne, sur tous ses onglets. */
    function versUtilisateur(username, evenement, charge = {}) {
        if (!username) return;
        io.to(salleUtilisateur(username)).emit(evenement, charge);
    }

    /** Signal adressé aux membres d'un pool. */
    function versPool(nomPool, evenement, charge = {}) {
        io.to(sallePool(nomPool)).emit(evenement, charge);
    }

    /**
     * Diffuse ce que la transaction a accumulé, une fois validée.
     *
     * Le journal porte des intentions de diffusion ; elles sont exécutées ici,
     * après le COMMIT, et jamais avant.
     */
    function diffuserJournal(journal) {
        if (!journal) return;
        for (const { nom, charge } of journal.contenu.diffusions) {
            if (charge && charge.pool) versPool(charge.pool, nom, charge);
            else if (charge && charge.user) versUtilisateur(charge.user, nom, charge);
            else io.emit(nom, charge);
        }
    }

    return {
        enregistrer,
        sallePool,
        salleUtilisateur,
        poolMisAJour,
        poolAChange,
        versUtilisateur,
        versPool,
        diffuserJournal,
        resynchroniserUtilisateur,
        resynchroniserPool,
        recalculerSalles
    };
}

module.exports = { creerDiffusion };
