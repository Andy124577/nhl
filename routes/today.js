/**
 * `/api/me/today` — ce qui mérite votre attention, en une réponse.
 *
 * L'accueil faisait une dizaine d'appels, différents selon la disposition, et
 * chaque disposition décidait ensuite de sa propre priorité. Ici le serveur
 * répond une fois, avec un élément principal et au plus trois lignes
 * secondaires, et les deux dispositions affichent la même chose.
 *
 * La réponse est BORNÉE. Pas d'alignements complets, pas d'historique
 * d'activité, pas d'archive de notifications : chacun a sa route, et les
 * charger ici alourdirait la page la plus consultée du site pour des données
 * que personne ne regarde au chargement.
 */

'use strict';

const instantDraft = require('../lib/instantDraft.js');
const authz = require('../lib/authz.js');

function monter(app, ctx) {
    const { auth, store, aujourdhui, presence, logger = console } = ctx;

    function repondreErreur(res, erreur, contexte) {
        if (erreur.name === 'ErreurMetier' || erreur.name === 'ErreurConflit') {
            return res.status(erreur.code || 400).json({ message: erreur.message, ...(erreur.extra || {}) });
        }
        logger.error(`Erreur ${contexte} :`, erreur);
        return res.status(500).json({ message: "Erreur interne du serveur." });
    }

    /**
     * L'état du salon instantané, s'il y en a un.
     *
     * C'est la seule source d'échéance réelle pour un départ de repêchage : le
     * compte à rebours tenu par le serveur. Sans lui, l'accueil n'annonce
     * aucune heure de départ, parce qu'il n'y en a pas.
     */
    async function salonDe(username) {
        if (!presence) return null;
        try {
            const pools = await store.lireTous();
            for (const [nom, enveloppe] of Object.entries(pools)) {
                if (!instantDraft.estPoolInstantane(nom, enveloppe.data)) continue;
                if (instantDraft.repechageCommence(enveloppe.data)) continue;
                if (!authz.estMembre(enveloppe.data, username)) continue;
                const compte = presence.compteEnCours(nom);
                return { pool: nom, compteARebours: compte };
            }
        } catch (erreur) {
            logger.error?.('⚠️ Salon indisponible :', erreur.message);
        }
        return null;
    }

    app.get('/api/me/today', auth.requireAuth, async (req, res) => {
        try {
            const poolActif = typeof req.query.pool === 'string' && req.query.pool.trim()
                ? req.query.pool.trim() : null;
            // Le client annonce ce qu'il affiche déjà : l'élément principal ne
            // doit pas se dérober sous le doigt à chaque rafraîchissement.
            const vedettePrecedente = typeof req.query.current === 'string' && req.query.current.trim()
                ? req.query.current.trim() : null;

            const salon = await salonDe(req.auth.username);
            const charge = await aujourdhui.pourAvecCache(req.auth.username, {
                poolActif, vedettePrecedente, salon
            });

            res.json(charge);
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/me/today');
        }
    });

    return { salonDe };
}

module.exports = { monter };
