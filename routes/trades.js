/**
 * Le marché des échanges : proposer, accepter, refuser, annoncer.
 *
 * L'acceptation était la faille la plus grave du site. `/trade/accept` prenait
 * un identifiant d'échange et rien d'autre : personne ne vérifiait que celui
 * qui acceptait était bien le destinataire. N'importe qui pouvait donc accepter
 * l'échange de n'importe qui. Et l'exécution s'étalait sur quatre écritures
 * indépendantes — alignements, statut, propositions concurrentes, annonces —
 * de sorte qu'une panne au milieu laissait un joueur dans deux équipes, ou dans
 * aucune.
 *
 * Ici, une acceptation est UNE transaction : verrou de l'échange, verrou du
 * pool, revalidation complète sous verrou, échange des alignements, annulation
 * des propositions devenues impossibles, retrait des annonces devenues fausses,
 * écriture de l'activité — puis COMMIT, puis seulement la diffusion.
 *
 * Deux acceptations du même échange ne peuvent donc pas produire deux
 * transferts : la seconde trouve un statut qui n'est plus `pending` et
 * s'arrête.
 */

'use strict';

const authz = require('../lib/authz.js');
const evenements = require('../lib/events.js');
const { teamHasPlayer, removeFromTeam, addToTeam, getPositionLabel } = require('../lib/trades.js');
const { checkIfDraftComplete } = require('../lib/draft.js');

/** Catégories échangeables. Un échange se fait toujours catégorie contre même catégorie. */
const CATEGORIES = new Set(['offensive', 'defensive', 'goalie', 'rookie', 'team']);

function monter(app, ctx) {
    const { auth, store, db, diffusion, usePostgres, logger = console } = ctx;
    const { ErreurMetier } = store;

    function repondreErreur(res, erreur, contexte) {
        if (erreur.name === 'ErreurMetier' || erreur.name === 'ErreurConflit') {
            return res.status(erreur.code || 400).json({ message: erreur.message, ...(erreur.extra || {}) });
        }
        logger.error(`Erreur ${contexte} :`, erreur);
        return res.status(500).json({ message: "Erreur interne du serveur." });
    }

    /** Les échanges exigent PostgreSQL : ils vivent dans des tables relationnelles. */
    function exigerPostgres() {
        if (!usePostgres) {
            throw new ErreurMetier(503,
                "Les échanges ne sont pas disponibles en mode fichier : ils exigent PostgreSQL.",
                { code: 'postgres_requis' });
        }
    }

    /** Les membres d'une équipe du pool. */
    const membresDe = (data, nomEquipe) => (data?.teams?.[nomEquipe]?.members || []);

    // ───────────────────────────── Lectures ─────────────────────────────
    //
    // L'ordre de déclaration compte : Express prend la PREMIÈRE route qui
    // correspond. `/trades/:draftName` déclaré avant `/trades/all` capturait
    // « all » comme un nom de pool, et `/trades/all` n'était jamais atteint.
    // Les chemins fixes passent donc devant le paramètre.

    /** Historique complet, limité aux pools dont on est membre. */
    app.get('/trades/all', auth.requireAuth, async (req, res) => {
        try {
            exigerPostgres();
            const pools = await store.lireTous();
            const miens = Object.entries(pools)
                .filter(([, e]) => req.auth.isAdmin || authz.estMembre(e.data, req.auth.username))
                .map(([nom]) => nom);

            const echanges = await db.getTradesForPools(miens);
            res.json(echanges.map(t => ({
                id: t.id,
                draftName: t.poolName,
                ...t.data,
                status: t.status
            })));
        } catch (erreur) {
            repondreErreur(res, erreur, '/trades/all');
        }
    });

    /**
     * Les propositions reçues et en attente de la personne connectée.
     *
     * Le nom d'utilisateur reste dans l'URL pour ne pas casser les appels
     * existants, mais il n'est plus cru : c'est la session qui décide. Demander
     * la liste de quelqu'un d'autre est refusé plutôt qu'ignoré.
     */
    app.get('/trades/pending/:username', auth.requireAuth, async (req, res) => {
        try {
            exigerPostgres();
            const identite = auth.identite(req, req.params.username);
            if (!identite.ok) return res.status(identite.code).json({ message: identite.message });
            const username = req.params.username || req.auth.username;

            const pools = await store.lireTous();
            const miens = Object.entries(pools)
                .filter(([, e]) => authz.estMembre(e.data, username))
                .map(([nom]) => nom);

            // Une seule requête pour tous les pools : la version précédente
            // interrogeait la base une fois par échange trouvé.
            const echanges = await db.getTradesForPools(miens, ['pending']);

            const recues = echanges
                .filter(t => membresDe(pools[t.poolName]?.data, t.data.toTeam).includes(username))
                .map(t => ({
                    id: t.id,
                    draftName: t.poolName,
                    fromTeam: t.data.fromTeam,
                    toTeam: t.data.toTeam,
                    offering: t.data.offering,
                    receiving: t.data.receiving,
                    status: 'pending',
                    date: t.data.date
                }));

            res.json(recues);
        } catch (erreur) {
            repondreErreur(res, erreur, '/trades/pending');
        }
    });

    /** Propositions résolues où la personne est impliquée, d'un côté ou de l'autre. */
    app.get('/trades/completed/:username', auth.requireAuth, async (req, res) => {
        try {
            exigerPostgres();
            const identite = auth.identite(req, req.params.username);
            if (!identite.ok) return res.status(identite.code).json({ message: identite.message });
            const username = req.params.username || req.auth.username;

            const pools = await store.lireTous();
            const miens = Object.entries(pools)
                .filter(([, e]) => authz.estMembre(e.data, username))
                .map(([nom]) => nom);

            const echanges = await db.getTradesForPools(miens, ['completed', 'declined', 'cancelled']);

            const siennes = echanges
                .filter(t => {
                    const data = pools[t.poolName]?.data;
                    return membresDe(data, t.data.fromTeam).includes(username) ||
                           membresDe(data, t.data.toTeam).includes(username);
                })
                .map(t => ({
                    id: t.id,
                    draftName: t.poolName,
                    fromTeam: t.data.fromTeam,
                    toTeam: t.data.toTeam,
                    offering: t.data.offering,
                    receiving: t.data.receiving,
                    status: t.status,
                    date: t.data.date,
                    completedDate: t.data.completedDate || t.updatedAt || t.createdAt
                }));

            res.json(siennes);
        } catch (erreur) {
            repondreErreur(res, erreur, '/trades/completed');
        }
    });

    /** Échanges conclus d'un pool. Réservé à ses membres. */
    app.get('/trades/:draftName', auth.requireAuth, async (req, res) => {
        try {
            exigerPostgres();
            const nom = req.params.draftName;
            const enveloppe = await store.lire(nom);
            if (!enveloppe) return res.status(404).json({ message: "Pool introuvable." });
            if (!req.auth.isAdmin && !authz.estMembre(enveloppe.data, req.auth.username)) {
                return res.status(403).json({ message: "Vous n'êtes pas membre de ce pool." });
            }

            const echanges = await db.getTradesForPools([nom], ['completed']);
            res.json(echanges.map(t => ({ id: t.id, draftName: t.poolName, ...t.data, status: t.status })));
        } catch (erreur) {
            repondreErreur(res, erreur, '/trades/:draftName');
        }
    });

    // ───────────────────────────── Proposer ─────────────────────────────

    app.post('/trade/propose', auth.requireAuth, async (req, res) => {
        try {
            exigerPostgres();
            const { draftName, fromTeam, toTeam, offering, receiving } = req.body || {};
            if (!draftName || !fromTeam || !toTeam || !Array.isArray(offering) || !Array.isArray(receiving)) {
                return res.status(400).json({ message: "Données incomplètes." });
            }
            if (offering.length !== 1 || receiving.length !== 1) {
                return res.status(400).json({
                    message: "Échanges 1 pour 1 seulement : exactement un joueur contre un joueur."
                });
            }

            const offert = offering[0];
            const recu = receiving[0];
            if (!CATEGORIES.has(offert.type) || offert.type !== recu.type) {
                return res.status(400).json({
                    message: `Les deux joueurs doivent être de la même catégorie. ` +
                             `Vous offrez : ${getPositionLabel(offert.type)}, vous recevez : ${getPositionLabel(recu.type)}.`
                });
            }
            if (fromTeam === toTeam) {
                return res.status(400).json({ message: "Une équipe ne peut pas échanger avec elle-même." });
            }

            const { valeur } = await store.transaction(async (tx) => {
                const verrouille = await tx.verrouillerPool(draftName);
                if (!verrouille) throw new ErreurMetier(404, "Pool introuvable.");
                const data = verrouille.data;

                if (data.allowTrades === false) {
                    throw new ErreurMetier(403, "Les échanges ne sont pas autorisés dans ce pool.");
                }
                // Le repêchage doit être fini pour TOUT LE MONDE : sinon on
                // négocierait des joueurs qu'un choix à venir peut encore
                // rendre indisponibles.
                if (!checkIfDraftComplete(data)) {
                    throw new ErreurMetier(403,
                        "Le repêchage de ce pool n'est pas terminé. Les échanges ouvrent une fois tous les choix faits.");
                }
                if (!membresDe(data, fromTeam).includes(req.auth.username)) {
                    throw new ErreurMetier(403, "Vous ne pouvez proposer un échange que depuis votre propre équipe.");
                }
                if (!data.teams[toTeam]) throw new ErreurMetier(404, "Équipe destinataire introuvable.");
                if (membresDe(data, toTeam).length === 0) {
                    throw new ErreurMetier(400, "Cette équipe n'a aucun participant : elle ne peut rien accepter.");
                }

                // Propriété revérifiée sous verrou : l'écran a pu rester ouvert
                // pendant qu'un autre échange changeait ces alignements.
                if (!teamHasPlayer(data.teams[fromTeam], offert)) {
                    throw new ErreurMetier(409, `Vous ne possédez pas ${offert.name}.`);
                }
                if (!teamHasPlayer(data.teams[toTeam], recu)) {
                    throw new ErreurMetier(409, `${toTeam} ne possède pas ${recu.name}.`);
                }

                const tradeData = {
                    fromTeam, toTeam, offering, receiving,
                    proposedBy: req.auth.username,
                    date: new Date().toISOString()
                };
                const tradeId = await db.createTradeInTx(tx.client, draftName, tradeData);

                // Les destinataires sont prévenus dans la MÊME transaction :
                // une notification ne doit pas survivre à un ROLLBACK.
                for (const membre of membresDe(data, toTeam)) {
                    tx.journal.notifier({
                        recipient: membre,
                        poolId: verrouille.id,
                        type: evenements.NOTIFICATION.ECHANGE_RECU,
                        subject: { tradeId, poolName: draftName, fromTeam, toTeam,
                                   offering: offert.name, receiving: recu.name },
                        dedupKey: evenements.clesNotification.echangeRecu(tradeId)
                    });
                }

                return { tradeId, destinataires: membresDe(data, toTeam) };
            }, { scope: 'echange:proposer', userId: req.auth.userId, operationId: req.body?.operationId,
                 requete: { draftName, fromTeam, toTeam, offert: offert.name, recu: recu.name } });

            for (const membre of valeur.destinataires) {
                diffusion.versUtilisateur(membre, 'tradePending', { tradeId: valeur.tradeId, poolName: draftName });
            }
            diffusion.versPool(draftName, 'tradePending', { poolName: draftName });

            logger.log(`📤 Échange proposé : ${fromTeam} → ${toTeam} (${offert.name} ↔ ${recu.name})`);
            res.json({ message: "Proposition envoyée.", tradeId: valeur.tradeId });
        } catch (erreur) {
            repondreErreur(res, erreur, '/trade/propose');
        }
    });

    // ───────────────────────────── Accepter ─────────────────────────────

    /**
     * Accepter un échange.
     *
     * Une seule transaction pour : vérifier que celui qui accepte EST le
     * destinataire, que la proposition est encore en attente, que les deux
     * équipes possèdent encore leurs joueurs, échanger les alignements,
     * annuler les propositions devenues impossibles, retirer les annonces
     * devenues fausses, et écrire l'activité.
     *
     * L'ordre des verrous est fixe — l'échange, puis le pool, puis les autres
     * propositions par identifiant croissant — pour que deux acceptations
     * simultanées attendent au lieu de se bloquer mutuellement.
     */
    app.post('/trade/accept', auth.requireAuth, async (req, res) => {
        try {
            exigerPostgres();
            const tradeId = Number(req.body?.tradeId);
            if (!Number.isInteger(tradeId)) return res.status(400).json({ message: "Identifiant d'échange invalide." });

            const { valeur } = await store.transaction(async (tx) => {
                const echange = await db.lockTradeInTx(tx.client, tradeId);
                if (!echange) throw new ErreurMetier(404, "Proposition introuvable.");
                if (echange.status !== 'pending') {
                    // Réessai d'une acceptation déjà passée : on le dit, on ne
                    // rejoue pas le transfert.
                    throw new ErreurMetier(409, "Cette proposition n'est plus en attente.", { statut: echange.status });
                }

                const verrouille = await tx.verrouillerPool(echange.poolName);
                if (!verrouille) throw new ErreurMetier(404, "Pool introuvable.");
                const data = verrouille.data;
                const trade = echange.data;

                if (data.allowTrades === false) {
                    throw new ErreurMetier(403, "Les échanges ne sont pas autorisés dans ce pool.");
                }

                // LA vérification qui manquait : seul le destinataire accepte.
                if (!membresDe(data, trade.toTeam).includes(req.auth.username) && !req.auth.isAdmin) {
                    throw new ErreurMetier(403, "Seule l'équipe destinataire peut accepter cette proposition.");
                }

                const equipeA = data.teams[trade.fromTeam];
                const equipeB = data.teams[trade.toTeam];
                if (!equipeA || !equipeB) throw new ErreurMetier(404, "Une des équipes n'existe plus.");

                const manquantsA = trade.offering.filter(item => !teamHasPlayer(equipeA, item)).map(i => i.name);
                if (manquantsA.length > 0) {
                    throw new ErreurMetier(409, `${trade.fromTeam} ne possède plus : ${manquantsA.join(', ')}.`);
                }
                const manquantsB = trade.receiving.filter(item => !teamHasPlayer(equipeB, item)).map(i => i.name);
                if (manquantsB.length > 0) {
                    throw new ErreurMetier(409, `${trade.toTeam} ne possède plus : ${manquantsB.join(', ')}.`);
                }
                // Catégorie revérifiée à l'acceptation : la proposition peut
                // dater d'avant un changement de configuration du pool.
                for (let i = 0; i < trade.offering.length; i++) {
                    if (trade.offering[i].type !== trade.receiving[i].type) {
                        throw new ErreurMetier(409, "Les catégories de cette proposition ne correspondent plus.");
                    }
                }

                trade.offering.forEach(item => { removeFromTeam(equipeA, item); addToTeam(equipeB, item); });
                trade.receiving.forEach(item => { removeFromTeam(equipeB, item); addToTeam(equipeA, item); });

                const conclu = {
                    ...trade,
                    status: 'accepted',
                    acceptedBy: req.auth.username,
                    completedDate: new Date().toISOString()
                };
                await db.updateTradeInTx(tx.client, tradeId, 'completed', conclu);

                // Les propositions qui portaient sur un des joueurs échangés
                // ne peuvent plus aboutir : on les annule au lieu de les
                // laisser échouer plus tard, une par une, chez leurs auteurs.
                const joueursTouches = new Set([...trade.offering, ...trade.receiving].map(i => i.name));
                const concurrentes = await db.lockPendingTradesInTx(tx.client, echange.poolName, tradeId);
                let annulees = 0;
                for (const autre of concurrentes) {
                    const noms = [...(autre.data.offering || []), ...(autre.data.receiving || [])].map(i => i.name);
                    if (noms.some(n => joueursTouches.has(n))) {
                        await db.updateTradeInTx(tx.client, autre.id, 'cancelled');
                        annulees++;
                    }
                }

                // Une annonce « disponible » sur un joueur qui vient de changer
                // d'équipe serait activement trompeuse.
                for (const nomJoueur of joueursTouches) {
                    await db.removeListingsByPlayerInTx(tx.client, echange.poolName, nomJoueur);
                }

                await tx.sauvegarderPool(echange.poolName, data);

                tx.journal.evenement({
                    poolId: verrouille.id,
                    type: evenements.ACTIVITE.ECHANGE_CONCLU,
                    actorUserId: req.auth.userId,
                    subject: {
                        tradeId,
                        fromTeam: trade.fromTeam,
                        toTeam: trade.toTeam,
                        offering: trade.offering.map(i => i.name),
                        receiving: trade.receiving.map(i => i.name)
                    },
                    dedupKey: evenements.clesActivite.echangeConclu(verrouille.id, tradeId)
                });

                const impliques = new Set([...membresDe(data, trade.fromTeam), ...membresDe(data, trade.toTeam)]);
                for (const membre of impliques) {
                    tx.journal.notifier({
                        recipient: membre,
                        poolId: verrouille.id,
                        type: evenements.NOTIFICATION.ECHANGE_RESULTAT,
                        subject: { tradeId, poolName: echange.poolName, resultat: 'accepte',
                                   fromTeam: trade.fromTeam, toTeam: trade.toTeam },
                        lieA: evenements.clesActivite.echangeConclu(verrouille.id, tradeId),
                        dedupKey: evenements.clesNotification.echangeResultat(tradeId, 'accepte')
                    });
                }

                // L'offre n'est plus en attente : sa notification cesse de
                // réclamer une action — ce qui est différent de « lue ».
                await db.resolveNotificationsInTx(tx.client, {
                    type: evenements.NOTIFICATION.ECHANGE_RECU,
                    subjectKey: 'tradeId',
                    subjectValue: tradeId
                });

                return { poolName: echange.poolName, annulees, impliques: [...impliques] };
            }, { scope: 'echange:accepter', userId: req.auth.userId,
                 operationId: req.body?.operationId, requete: { tradeId, par: req.auth.username } });

            const frais = await store.lire(valeur.poolName);
            if (frais) diffusion.poolMisAJour(valeur.poolName, frais.data, frais.revision);
            diffusion.versPool(valeur.poolName, 'tradeUpdated', { poolName: valeur.poolName, tradeId });
            diffusion.versPool(valeur.poolName, 'tradeListingsUpdated', { poolName: valeur.poolName });

            logger.log(`✅ Échange accepté (#${tradeId}) — ${valeur.annulees} proposition(s) concurrente(s) annulée(s)`);
            res.json({ message: "Échange accepté.", cancelledConflictingTrades: valeur.annulees });
        } catch (erreur) {
            repondreErreur(res, erreur, '/trade/accept');
        }
    });

    // ───────────────────────────── Refuser ─────────────────────────────

    app.post('/trade/decline', auth.requireAuth, async (req, res) => {
        try {
            exigerPostgres();
            const tradeId = Number(req.body?.tradeId);
            if (!Number.isInteger(tradeId)) return res.status(400).json({ message: "Identifiant d'échange invalide." });

            const { valeur } = await store.transaction(async (tx) => {
                const echange = await db.lockTradeInTx(tx.client, tradeId);
                if (!echange) throw new ErreurMetier(404, "Proposition introuvable.");
                if (echange.status !== 'pending') {
                    throw new ErreurMetier(409, "Cette proposition n'est plus en attente.", { statut: echange.status });
                }

                const verrouille = await tx.verrouillerPool(echange.poolName);
                if (!verrouille) throw new ErreurMetier(404, "Pool introuvable.");
                const trade = echange.data;

                // Le destinataire refuse ; celui qui a proposé retire. Les deux
                // aboutissent au même état, et personne d'autre ne peut le faire.
                const estDestinataire = membresDe(verrouille.data, trade.toTeam).includes(req.auth.username);
                const estAuteur = membresDe(verrouille.data, trade.fromTeam).includes(req.auth.username);
                if (!estDestinataire && !estAuteur && !req.auth.isAdmin) {
                    throw new ErreurMetier(403, "Cette proposition ne vous concerne pas.");
                }

                await db.updateTradeInTx(tx.client, tradeId, 'declined', {
                    ...trade,
                    status: 'declined',
                    declinedBy: req.auth.username,
                    declinedDate: new Date().toISOString()
                });

                const impliques = new Set([
                    ...membresDe(verrouille.data, trade.fromTeam),
                    ...membresDe(verrouille.data, trade.toTeam)
                ]);
                for (const membre of impliques) {
                    tx.journal.notifier({
                        recipient: membre,
                        poolId: verrouille.id,
                        type: evenements.NOTIFICATION.ECHANGE_RESULTAT,
                        subject: { tradeId, poolName: echange.poolName, resultat: 'refuse',
                                   fromTeam: trade.fromTeam, toTeam: trade.toTeam },
                        dedupKey: evenements.clesNotification.echangeResultat(tradeId, 'refuse')
                    });
                }

                await db.resolveNotificationsInTx(tx.client, {
                    type: evenements.NOTIFICATION.ECHANGE_RECU,
                    subjectKey: 'tradeId',
                    subjectValue: tradeId
                });

                return { poolName: echange.poolName, retire: estAuteur && !estDestinataire };
            }, { scope: 'echange:refuser', userId: req.auth.userId });

            diffusion.versPool(valeur.poolName, 'tradeUpdated', { poolName: valeur.poolName, tradeId });
            res.json({ message: valeur.retire ? "Proposition retirée." : "Proposition refusée." });
        } catch (erreur) {
            repondreErreur(res, erreur, '/trade/decline');
        }
    });

    // ───────────────────────────── Annonces ─────────────────────────────

    /**
     * Le marché d'un pool : qui est disponible, chez qui, dans quelle catégorie.
     *
     * Réservé aux membres. Les annonces disent quels joueurs d'un pool sont
     * ouverts aux offres : c'est de l'information de pool, pas de la découverte
     * publique.
     */
    app.get('/trade-listings/:poolName', auth.requireAuth, async (req, res) => {
        try {
            exigerPostgres();
            const nom = req.params.poolName;
            const enveloppe = await store.lire(nom);
            if (!enveloppe) return res.status(404).json({ message: "Pool introuvable." });
            if (!req.auth.isAdmin && !authz.estMembre(enveloppe.data, req.auth.username)) {
                return res.status(403).json({ message: "Vous n'êtes pas membre de ce pool." });
            }

            const annonces = await db.getActiveListingsForPool(nom);
            const monEquipe = authz.equipeDe(enveloppe.data, req.auth.username);

            // Chaque annonce dit si on peut y répondre, et sinon pourquoi.
            // Ouvrir un sélecteur vide et laisser la personne chercher ce qui
            // cloche est la pire des réponses possibles.
            const enrichies = annonces.map(annonce => {
                const mienne = annonce.teamName === monEquipe;
                const echangeables = mienne ? [] : joueursEchangeables(enveloppe.data, monEquipe, annonce.category);
                return {
                    ...annonce,
                    mienne,
                    peutOffrir: !mienne && echangeables.length > 0,
                    raison: mienne ? 'propre_equipe'
                          : echangeables.length === 0 ? 'aucun_joueur_compatible' : null,
                    monOffre: echangeables
                };
            });

            res.json(enrichies);
        } catch (erreur) {
            repondreErreur(res, erreur, '/trade-listings');
        }
    });

    /** Les joueurs d'une équipe dans une catégorie donnée — ce qu'elle peut offrir. */
    function joueursEchangeables(data, nomEquipe, categorie) {
        const cles = { offensive: 'offensive', defensive: 'defensive', goalie: 'goalie', rookie: 'rookie', team: 'teams' };
        const cle = cles[categorie];
        if (!cle || !nomEquipe) return [];
        const equipe = data?.teams?.[nomEquipe];
        if (!equipe) return [];
        return (equipe[cle] || []).map(p =>
            (typeof p === 'string') ? p : (p.skaterFullName || p.goalieFullName || p.teamFullName || String(p))
        );
    }

    app.post('/trade-listings', auth.requireAuth, async (req, res) => {
        try {
            exigerPostgres();
            const { poolName, teamName, playerName, category } = req.body || {};
            if (!poolName || !teamName || !playerName || !category) {
                return res.status(400).json({ message: "Données incomplètes." });
            }
            if (!CATEGORIES.has(category)) return res.status(400).json({ message: "Catégorie invalide." });

            const { valeur } = await store.transaction(async (tx) => {
                const verrouille = await tx.verrouillerPool(poolName);
                if (!verrouille) throw new ErreurMetier(404, "Pool introuvable.");
                const data = verrouille.data;

                if (data.allowTrades === false) {
                    throw new ErreurMetier(403, "Les échanges ne sont pas autorisés dans ce pool.");
                }
                if (!checkIfDraftComplete(data)) {
                    throw new ErreurMetier(403, "Le repêchage de ce pool n'est pas encore terminé.");
                }
                if (!membresDe(data, teamName).includes(req.auth.username)) {
                    throw new ErreurMetier(403, "Vous ne faites pas partie de cette équipe.");
                }
                if (!teamHasPlayer(data.teams[teamName], { type: category, name: playerName })) {
                    throw new ErreurMetier(409, "Vous ne possédez pas ce joueur.");
                }

                const id = await db.createListingInTx(tx.client, poolName, teamName, playerName, category, req.auth.username);
                if (id === null) throw new ErreurMetier(409, "Ce joueur est déjà annoncé.");

                tx.journal.evenement({
                    poolId: verrouille.id,
                    type: evenements.ACTIVITE.ANNONCE_OUVERTE,
                    actorUserId: req.auth.userId,
                    subject: { listingId: id, teamName, playerName, category },
                    dedupKey: evenements.clesActivite.annonceOuverte(verrouille.id, id)
                });

                return { id };
            }, { scope: 'annonce:ouvrir', userId: req.auth.userId });

            diffusion.versPool(poolName, 'tradeListingsUpdated', { poolName });
            res.json({ id: valeur.id, message: "Joueur annoncé comme disponible." });
        } catch (erreur) {
            repondreErreur(res, erreur, '/trade-listings');
        }
    });

    app.post('/trade-listings/:id/remove', auth.requireAuth, async (req, res) => {
        try {
            exigerPostgres();
            const id = Number(req.params.id);
            if (!Number.isInteger(id)) return res.status(400).json({ message: "Identifiant invalide." });

            const annonce = await db.getTradeListingById(id);
            if (!annonce || annonce.status !== 'active') {
                return res.status(404).json({ message: "Annonce introuvable." });
            }

            const { valeur } = await store.transaction(async (tx) => {
                const verrouille = await tx.verrouillerPool(annonce.poolName);
                if (!verrouille) throw new ErreurMetier(404, "Pool introuvable.");
                if (!membresDe(verrouille.data, annonce.teamName).includes(req.auth.username) && !req.auth.isAdmin) {
                    throw new ErreurMetier(403, "Vous ne faites pas partie de cette équipe.");
                }

                const retiree = await db.removeListingInTx(tx.client, id, annonce.poolName, annonce.teamName);
                if (!retiree) throw new ErreurMetier(409, "Annonce déjà retirée.");

                tx.journal.evenement({
                    poolId: verrouille.id,
                    type: evenements.ACTIVITE.ANNONCE_RETIREE,
                    actorUserId: req.auth.userId,
                    subject: { listingId: id, teamName: annonce.teamName, playerName: annonce.playerName },
                    dedupKey: evenements.clesActivite.annonceRetiree(verrouille.id, id)
                });

                return { poolName: annonce.poolName };
            }, { scope: 'annonce:retirer', userId: req.auth.userId });

            diffusion.versPool(valeur.poolName, 'tradeListingsUpdated', { poolName: valeur.poolName });
            res.json({ message: "Joueur retiré du marché." });
        } catch (erreur) {
            repondreErreur(res, erreur, '/trade-listings/remove');
        }
    });

    return { joueursEchangeables, CATEGORIES };
}

module.exports = { monter, CATEGORIES };
