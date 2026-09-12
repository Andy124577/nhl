/**
 * Notifications et activité de pool — la lecture.
 *
 * L'écriture se fait ailleurs : dans la transaction qui change l'état source
 * (voir services/poolStore.js). Ces routes ne font que lire, et marquer comme
 * lu. Cette séparation est ce qui garantit qu'une notification ne survit pas à
 * un ROLLBACK, et qu'un réessai n'en crée pas une deuxième.
 *
 * Deux distinctions sont tenues fermement, parce que les confondre a une
 * conséquence visible :
 *
 *   - **lue** et **résolue** sont deux choses. Lire la notification d'une offre
 *     ne retire pas l'offre de la liste des choses à faire. La lecture est un
 *     geste de la personne ; la résolution est un fait du monde.
 *   - une alerte **expirée** cesse de compter dans la pastille, même jamais
 *     lue. Sinon la cloche réclame indéfiniment une action qui n'existe plus.
 *
 * La pastille cachée à zéro, la lecture volontaire et les destinations
 * précises que la cloche avait déjà sont conservées ; ce qui change, c'est
 * qu'elles reposent sur des lignes durables au lieu du stockage du navigateur.
 */

'use strict';

const authz = require('../lib/authz.js');
const evenements = require('../lib/events.js');

/** Nombre d'entrées d'activité servies par page. */
const PAGE_ACTIVITE = 20;

function monter(app, ctx) {
    const { auth, store, db, usePostgres, logger = console } = ctx;

    function repondreErreur(res, erreur, contexte) {
        if (erreur.name === 'ErreurMetier' || erreur.name === 'ErreurConflit') {
            return res.status(erreur.code || 400).json({ message: erreur.message, ...(erreur.extra || {}) });
        }
        logger.error(`Erreur ${contexte} :`, erreur);
        return res.status(500).json({ message: "Erreur interne du serveur." });
    }

    /**
     * Les notifications vivent dans une table PostgreSQL.
     *
     * En mode fichier, la route répond honnêtement « indisponible » avec une
     * liste vide plutôt qu'une erreur : la cloche continue de fonctionner sur
     * ses sources dérivées, et sait qu'elle n'a pas d'historique serveur.
     */
    function indisponible(res) {
        return res.json({
            disponible: false,
            raison: 'postgres_requis',
            notifications: [],
            nonLues: 0
        });
    }

    async function identifiant(req) {
        return usePostgres ? db.getUserId(req.auth.username) : req.auth.username;
    }

    // ───────────────────────────── Notifications ─────────────────────────────

    /**
     * Les notifications de la personne connectée.
     *
     * Chaque entrée arrive prête à afficher : titre, détail, action, urgence et
     * destination viennent du serveur (lib/events.js). C'est ce qui fait que la
     * cloche, le bandeau, l'accueil et le fil racontent la même chose et
     * mènent au même endroit — chacun composait son propre texte avant.
     */
    app.get('/api/notifications', auth.requireAuth, async (req, res) => {
        try {
            if (!usePostgres) return indisponible(res);

            const userId = await identifiant(req);
            if (!userId) return indisponible(res);

            const limite = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
            const lignes = await db.getNotificationsForUser(userId, { limite });

            const notifications = lignes.map(evenements.vueNotification);
            const nonLues = lignes.filter(evenements.compteDansPastille).length;

            res.json({
                disponible: true,
                notifications,
                nonLues,
                generatedAt: new Date().toISOString()
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/notifications');
        }
    });

    /** La pastille seule : une requête bornée pour un chiffre. */
    app.get('/api/notifications/count', auth.requireAuth, async (req, res) => {
        try {
            if (!usePostgres) return res.json({ disponible: false, nonLues: 0 });
            const userId = await identifiant(req);
            if (!userId) return res.json({ disponible: false, nonLues: 0 });
            res.json({ disponible: true, nonLues: await db.countUnreadNotifications(userId) });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/notifications/count');
        }
    });

    /**
     * Marque des notifications comme lues.
     *
     * Volontaire : seul un clic sur une notification, ou « tout marquer comme
     * lu », change cet état. Rien ne se marque lu parce qu'un panneau s'est
     * ouvert — c'est la règle que la cloche appliquait déjà, et elle vaut
     * toujours : une liste qui se vide en la regardant fait perdre ce qu'on
     * n'a pas eu le temps de lire.
     *
     * Les identifiants acceptés sont ceux de la base. Un identifiant qui
     * n'appartient pas à la personne connectée est simplement ignoré, puisque
     * la mise à jour est filtrée sur le destinataire.
     */
    app.post('/api/notifications/read', auth.requireAuth, async (req, res) => {
        try {
            if (!usePostgres) return res.json({ disponible: false, marquees: 0 });
            const userId = await identifiant(req);
            if (!userId) return res.json({ disponible: false, marquees: 0 });

            const brut = Array.isArray(req.body?.ids) ? req.body.ids : [];
            const ids = brut
                .map(id => String(id).trim())
                .filter(id => /^\d+$/.test(id))
                .slice(0, 500);

            if (ids.length === 0) return res.json({ disponible: true, marquees: 0 });

            const marquees = await db.markNotificationsRead(userId, ids);
            res.json({ disponible: true, marquees, nonLues: await db.countUnreadNotifications(userId) });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/notifications/read');
        }
    });

    app.post('/api/notifications/read-all', auth.requireAuth, async (req, res) => {
        try {
            if (!usePostgres) return res.json({ disponible: false, marquees: 0 });
            const userId = await identifiant(req);
            if (!userId) return res.json({ disponible: false, marquees: 0 });
            const marquees = await db.markAllNotificationsRead(userId);
            res.json({ disponible: true, marquees, nonLues: 0 });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/notifications/read-all');
        }
    });

    // ───────────────────────────── Activité de pool ─────────────────────────────

    /**
     * Le fil d'activité d'un pool, page par page.
     *
     * Réservé aux membres : l'activité dit qui a choisi qui et quel échange a
     * abouti. Et surtout, elle ne porte JAMAIS le détail d'une offre en
     * attente — une proposition ne concerne que ses deux équipes, jusqu'à ce
     * qu'elle soit conclue.
     *
     * La pagination est par curseur `(moment, identifiant)` plutôt que par
     * décalage : une page reste stable même si un choix s'ajoute pendant la
     * lecture.
     */
    app.get('/api/pools/:poolName/activity', auth.requireAuth, async (req, res) => {
        try {
            const nomPool = req.params.poolName;
            const enveloppe = await store.lire(nomPool);
            if (!enveloppe) return res.status(404).json({ message: "Pool introuvable." });
            if (!req.auth.isAdmin && !authz.estMembre(enveloppe.data, req.auth.username)) {
                return res.status(403).json({ message: "Vous n'êtes pas membre de ce pool." });
            }
            if (!usePostgres) {
                return res.json({ disponible: false, raison: 'postgres_requis', evenements: [], suite: null });
            }

            const limite = Math.min(Math.max(parseInt(req.query.limit, 10) || PAGE_ACTIVITE, 1), 100);
            const avantDate = req.query.before || null;
            const avantId = req.query.beforeId || null;

            const lignes = await db.getPoolActivity(enveloppe.id, { limite: limite + 1, avantDate, avantId });
            const page = lignes.slice(0, limite);
            const encore = lignes.length > limite;

            const dernier = page[page.length - 1];
            res.json({
                disponible: true,
                poolName: nomPool,
                evenements: page.map(decrire),
                suite: encore && dernier
                    ? { before: new Date(dernier.occurredAt).toISOString(), beforeId: dernier.id }
                    : null
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/pools/activity');
        }
    });

    /**
     * Ce qu'un événement d'activité raconte.
     *
     * Court et factuel. Une rafale de choix se regroupe à l'affichage (voir
     * `regrouper`) pour qu'un repêchage de cinquante-deux tours ne chasse pas
     * tout le reste du fil.
     */
    function decrire(evenement) {
        const sujet = evenement.subject || {};
        switch (evenement.type) {
            case evenements.ACTIVITE.CHOIX:
                return { ...base(evenement), texte: `${sujet.team} a choisi ${sujet.player}.`, groupe: 'choix' };
            case evenements.ACTIVITE.REPECHAGE_DEMARRE:
                return { ...base(evenement), texte: 'Le repêchage a commencé.' };
            case evenements.ACTIVITE.REPECHAGE_TERMINE:
                return { ...base(evenement), texte: 'Le repêchage est terminé.' };
            case evenements.ACTIVITE.ECHANGE_CONCLU:
                return {
                    ...base(evenement),
                    texte: `${sujet.fromTeam} et ${sujet.toTeam} ont conclu un échange : ` +
                           `${(sujet.offering || []).join(', ')} contre ${(sujet.receiving || []).join(', ')}.`
                };
            case evenements.ACTIVITE.ANNONCE_OUVERTE:
                return { ...base(evenement), texte: `${sujet.teamName} rend ${sujet.playerName} disponible.` };
            case evenements.ACTIVITE.ANNONCE_RETIREE:
                return { ...base(evenement), texte: `${sujet.teamName} retire ${sujet.playerName} du marché.` };
            case evenements.ACTIVITE.SEMAINE_FINALISEE: {
                const suffixe = sujet.revision > 1 ? ` (résultat révisé, version ${sujet.revision})` : '';
                return { ...base(evenement), texte: `Semaine ${sujet.weekNumber} finalisée${suffixe}.`,
                         revisee: sujet.revision > 1 };
            }
            default:
                return { ...base(evenement), texte: 'Activité du pool.' };
        }
    }

    const base = (evenement) => ({
        id: evenement.id,
        type: evenement.type,
        acteur: evenement.actor || null,
        occurredAt: evenement.occurredAt,
        sujet: evenement.subject || {}
    });

    /**
     * Regroupe une rafale d'événements du même type consécutifs.
     *
     * Pur, et exporté pour que l'aperçu de la page d'accueil applique la même
     * règle que le fil complet : cinquante-deux choix ne doivent pas remplir
     * un aperçu qui compte trois lignes.
     */
    function regrouper(liste, { seuil = 3 } = {}) {
        const sortie = [];
        let courant = null;

        for (const entree of liste || []) {
            if (courant && entree.groupe && courant.groupe === entree.groupe) {
                courant.membres.push(entree);
                continue;
            }
            if (courant) sortie.push(finirGroupe(courant, seuil));
            courant = entree.groupe ? { groupe: entree.groupe, membres: [entree] } : null;
            if (!courant) sortie.push(entree);
        }
        if (courant) sortie.push(finirGroupe(courant, seuil));
        return sortie;
    }

    function finirGroupe(groupe, seuil) {
        if (groupe.membres.length < seuil) return groupe.membres.length === 1
            ? groupe.membres[0]
            : { groupe: groupe.groupe, membres: groupe.membres, texte: null, eclate: true };
        const premier = groupe.membres[0];
        const dernier = groupe.membres[groupe.membres.length - 1];
        return {
            id: premier.id,
            type: premier.type,
            groupe: groupe.groupe,
            nombre: groupe.membres.length,
            occurredAt: premier.occurredAt,
            depuis: dernier.occurredAt,
            texte: `${groupe.membres.length} choix de repêchage.`,
            membres: groupe.membres
        };
    }

    return { decrire, regrouper, PAGE_ACTIVITE };
}

module.exports = { monter, PAGE_ACTIVITE };
