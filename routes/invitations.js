/**
 * Invitations : l'administration d'un pool fait venir quelqu'un.
 *
 * Deux côtés, deux familles de routes :
 *
 *   - l'administration du pool (la personne qui l'a créé) cherche un compte,
 *     l'invite, et peut annuler ;
 *   - la personne invitée lit ses invitations, les accepte ou les refuse.
 *
 * L'invitation vit dans les données du pool (`pool.invitations`, voir
 * lib/poolOps.js) : elle est écrite sous le même verrou que l'entrée
 * elle-même, suit le pool quand il est renommé, part avec lui quand il est
 * supprimé, et marche en mode fichier comme en PostgreSQL.
 *
 * Accepter une invitation fait entrer SANS le mot de passe du pool : c'est la
 * personne qui l'a choisi qui ouvre la porte.
 *
 * Le signal temps réel `poolInvitation` part vers la salle personnelle de la
 * personne invitée (services/diffusion.js) : c'est lui qui fait surgir la
 * fenêtre d'invitation sans attendre un rechargement. Comme partout, c'est un
 * signal de rafraîchissement ; la vérité reste /api/invitations.
 */

'use strict';

const authz = require('../lib/authz.js');
const poolOps = require('../lib/poolOps.js');
const { refusNomEquipe } = require('./pools.js');

/** Résultats de recherche servis au plus. */
const RESULTATS_MAX = 8;
/** Longueur minimale d'une recherche : en deçà, on listerait tout le site. */
const RECHERCHE_MIN = 2;

function monter(app, ctx) {
    const { auth, store, diffusion, chargerUtilisateurs, logger = console } = ctx;
    const { ErreurMetier } = store;

    function repondreErreur(res, erreur, contexte) {
        if (erreur instanceof ErreurMetier || erreur.name === 'ErreurMetier' || erreur.name === 'ErreurConflit') {
            return res.status(erreur.code || 400).json({ message: erreur.message, ...(erreur.extra || {}) });
        }
        logger.error(`Erreur ${contexte} :`, erreur);
        return res.status(500).json({ message: "Erreur interne du serveur." });
    }

    const refus = (resultat) => new ErreurMetier(resultat.code || 400, resultat.message);

    /** Le pool, et le droit de l'administrer. Lève une erreur métier sinon. */
    async function poolAdministre(req) {
        const enveloppe = await store.lire(req.params.poolName);
        if (!enveloppe) throw new ErreurMetier(404, "Pool introuvable.");
        if (!authz.peutAdministrer(enveloppe.data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
            throw new ErreurMetier(403, "Seule la personne qui a créé le pool peut inviter des participants.");
        }
        return enveloppe;
    }

    /** Les comptes du site, réduits à ce qu'on peut montrer : le nom et l'avatar. */
    async function comptes() {
        const liste = await chargerUtilisateurs();
        return (liste || [])
            .filter(u => u && typeof u.username === 'string' && u.username)
            .map(u => ({ username: u.username, avatarUrl: u.avatarUrl || '' }));
    }

    // ───────────────────────────── Côté administration ─────────────────────────────

    /**
     * Chercher des comptes à inviter.
     *
     * Réservé à l'administration du pool : un annuaire ouvert à tous les
     * comptes du site dirait à n'importe qui quels noms existent. Ce qu'on
     * renvoie reste un nom et un avatar, déjà visibles par tous les membres
     * d'un pool commun.
     *
     * Les noms qui COMMENCENT par la recherche passent devant ceux qui la
     * contiennent, casse et accents ignorés : on tape le début d'un nom.
     */
    app.get('/api/pools/:poolName/invite-search', auth.requireAuth, async (req, res) => {
        try {
            const enveloppe = await poolAdministre(req);
            const q = poolOps.reduireNom(typeof req.query.q === 'string' ? req.query.q.slice(0, 40) : '');
            if (q.length < RECHERCHE_MIN) return res.json({ resultats: [] });

            const data = enveloppe.data;
            const invites = new Set(poolOps.invitationsEnAttente(data).map(inv => inv.username));

            const trouves = (await comptes())
                .filter(c => c.username !== req.auth.username)
                .map(c => ({ ...c, rang: poolOps.reduireNom(c.username).indexOf(q) }))
                .filter(c => c.rang >= 0)
                .sort((a, b) => (a.rang === 0 ? 0 : 1) - (b.rang === 0 ? 0 : 1)
                    || a.username.localeCompare(b.username, 'fr'))
                .slice(0, RESULTATS_MAX);

            res.json({
                resultats: trouves.map(c => ({
                    username: c.username,
                    avatarUrl: c.avatarUrl,
                    statut: authz.estMembre(data, c.username) ? 'membre'
                        : invites.has(c.username) ? 'invite' : null
                }))
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/pools/invite-search');
        }
    });

    /** Inviter une personne. */
    app.post('/api/pools/:poolName/invitations', auth.requireAuth, async (req, res) => {
        try {
            const nom = req.params.poolName;
            const cible = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
            if (!cible) return res.status(400).json({ message: "Personne à inviter requise." });

            await poolAdministre(req);
            const compte = (await comptes()).find(c => c.username === cible);
            if (!compte) return res.status(404).json({ message: "Ce compte n'existe pas." });

            const { valeur } = await store.muterPool(nom, {
                scope: 'pool:inviter',
                userId: req.auth.userId,
                appliquer: async ({ data }) => {
                    if (!authz.peutAdministrer(data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                        throw new ErreurMetier(403, "Seule la personne qui a créé le pool peut inviter des participants.");
                    }
                    const resultat = poolOps.inviter(data, { username: cible, invitedBy: req.auth.username });
                    if (!resultat.ok) throw refus(resultat);
                    return { valeur: { invitation: resultat.invitation } };
                }
            });

            const frais = await store.lire(nom);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);
            diffusion.versUtilisateur(cible, 'poolInvitation', {
                poolName: nom, invitedBy: req.auth.username, action: 'nouvelle'
            });

            logger.log(`✉️ Invitation : ${req.auth.username} invite ${cible} dans ${nom}`);
            res.json({ message: `Invitation envoyée à ${cible}.`, invitation: valeur.invitation });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/pools/invitations');
        }
    });

    /** Annuler une invitation envoyée. */
    app.post('/api/pools/:poolName/invitations/cancel', auth.requireAuth, async (req, res) => {
        try {
            const nom = req.params.poolName;
            const cible = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
            if (!cible) return res.status(400).json({ message: "Invitation à annuler requise." });

            await store.muterPool(nom, {
                scope: 'pool:annuler-invitation',
                userId: req.auth.userId,
                appliquer: async ({ data }) => {
                    if (!authz.peutAdministrer(data, { username: req.auth.username, isAdmin: req.auth.isAdmin })) {
                        throw new ErreurMetier(403, "Seule la personne qui a créé le pool peut annuler une invitation.");
                    }
                    const resultat = poolOps.retirerInvitation(data, cible);
                    if (!resultat.retiree) throw new ErreurMetier(404, "Cette invitation n'existe plus.");
                    return { valeur: {} };
                }
            });

            const frais = await store.lire(nom);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);
            diffusion.versUtilisateur(cible, 'poolInvitation', { poolName: nom, action: 'annulee' });

            res.json({ message: `Invitation de ${cible} annulée.` });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/pools/invitations/cancel');
        }
    });

    // ───────────────────────────── Côté personne invitée ─────────────────────────────

    /**
     * Mes invitations en attente.
     *
     * Une invitation vers un pool dont le repêchage a commencé ne mène plus
     * nulle part : elle n'est pas servie. Un pool complet, lui, peut encore se
     * libérer — l'invitation reste, marquée `complet`.
     *
     * Ce qu'on dit du pool est ce que dit déjà sa fiche de découverte
     * (resumePublic) : de quoi décider d'y entrer, rien de plus.
     */
    app.get('/api/invitations', auth.requireAuth, async (req, res) => {
        try {
            const moi = req.auth.username;
            const pools = await store.lireTous();
            const invitations = [];
            for (const [nom, enveloppe] of Object.entries(pools)) {
                const data = enveloppe.data;
                const invitation = poolOps.invitationPour(data, moi);
                if (!invitation || authz.estMembre(data, moi) || poolOps.repechageCommence(data)) continue;
                invitations.push({
                    poolName: nom,
                    invitedBy: invitation.invitedBy,
                    invitedAt: invitation.invitedAt,
                    imageUrl: data.imageUrl || '',
                    poolMode: data.poolMode || 'cumulative',
                    participantCount: poolOps.nombreParticipants(data),
                    maxPlayers: poolOps.capacite(data),
                    totalPicks: poolOps.totalSelections(data),
                    allowTrades: data.allowTrades !== false,
                    complet: poolOps.nombreParticipants(data) >= poolOps.capacite(data),
                    nomSuggere: poolOps.nomEquipeLibre(data, moi)
                });
            }
            invitations.sort((a, b) => String(b.invitedAt).localeCompare(String(a.invitedAt)));
            res.setHeader('Cache-Control', 'no-store');
            res.json({ invitations });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/invitations');
        }
    });

    /** Accepter : entrer dans le pool avec l'équipe nommée, sans mot de passe. */
    app.post('/api/invitations/accept', auth.requireAuth, async (req, res) => {
        try {
            const nom = typeof req.body?.poolName === 'string' ? req.body.poolName.trim() : '';
            const moi = req.auth.username;
            if (!nom) return res.status(400).json({ message: "Pool requis." });

            const propose = typeof req.body?.teamName === 'string' ? req.body.teamName.trim() : '';
            if (propose) {
                const refusEquipe = refusNomEquipe(propose);
                if (refusEquipe) return res.status(400).json({ message: refusEquipe });
            }

            const { valeur } = await store.muterPool(nom, {
                scope: 'pool:accepter-invitation',
                userId: req.auth.userId,
                appliquer: async ({ data }) => {
                    if (!poolOps.invitationPour(data, moi)) {
                        throw new ErreurMetier(404, "Cette invitation n'existe plus.");
                    }
                    const resultat = poolOps.inscrireParticipant(data, {
                        username: moi,
                        teamName: propose || poolOps.nomEquipeLibre(data, moi)
                    });
                    if (!resultat.ok) throw refus(resultat);
                    return { valeur: { teamName: resultat.teamName } };
                }
            });

            const frais = await store.lire(nom);
            await diffusion.resynchroniserUtilisateur(moi);
            diffusion.poolMisAJour(nom, frais.data, frais.revision);

            logger.log(`✅ Invitation acceptée : ${moi} entre dans ${nom}`);
            res.json({
                message: `Vous avez rejoint ${nom} avec l'équipe « ${valeur.teamName} ».`,
                poolName: nom,
                teamName: valeur.teamName,
                revision: valeur.revision,
                pool: authz.vueMembre(nom, frais.data, frais.revision)
            });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/invitations/accept');
        }
    });

    /** Refuser : l'invitation disparaît, des deux côtés. */
    app.post('/api/invitations/decline', auth.requireAuth, async (req, res) => {
        try {
            const nom = typeof req.body?.poolName === 'string' ? req.body.poolName.trim() : '';
            const moi = req.auth.username;
            if (!nom) return res.status(400).json({ message: "Pool requis." });

            const { valeur } = await store.muterPool(nom, {
                scope: 'pool:refuser-invitation',
                userId: req.auth.userId,
                appliquer: async ({ data }) => {
                    const resultat = poolOps.retirerInvitation(data, moi);
                    // Déjà partie (annulée, acceptée ailleurs) : rien à écrire,
                    // et rien d'anormal — le but est atteint.
                    if (!resultat.retiree) return { sauvegarder: false, valeur: { deja: true } };
                    return { valeur: { deja: false } };
                }
            });

            if (!valeur.deja) {
                const frais = await store.lire(nom);
                diffusion.poolMisAJour(nom, frais.data, frais.revision);
            }
            res.json({ message: "Invitation refusée." });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/invitations/decline');
        }
    });
}

module.exports = { monter, RESULTATS_MAX, RECHERCHE_MIN };
