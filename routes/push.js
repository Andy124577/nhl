/**
 * Alertes sur l'appareil : s'abonner, se désabonner, s'envoyer un essai.
 *
 * L'envoi des vraies alertes ne passe pas par ici : il suit le COMMIT des
 * notifications (services/push.js). Ces routes ne gèrent que le lien entre un
 * navigateur et un compte.
 *
 * Comme les notifications durables, les alertes exigent PostgreSQL : en mode
 * fichier, la configuration répond honnêtement « indisponible » et la page
 * n'offre pas de les activer.
 */

'use strict';

const webPush = require('../lib/webPush.js');

/** Un essai toutes les dix secondes au plus, par personne. */
const INTERVALLE_ESSAI_MS = 10 * 1000;

function monter(app, ctx) {
    const { auth, usePostgres, push, logger = console, horloge = () => Date.now() } = ctx;
    const disponible = !!(usePostgres && push && push.disponible);

    /** username → instant du dernier essai. */
    const derniersEssais = new Map();

    function repondreErreur(res, erreur, contexte) {
        logger.error(`Erreur ${contexte} :`, erreur);
        return res.status(500).json({ message: "Erreur interne du serveur." });
    }

    /**
     * Ce qu'il faut au navigateur pour s'abonner : la clé publique du serveur.
     *
     * Le navigateur la compare aussi à celle de son abonnement existant : si
     * elle a changé, il se réabonne (pushNotifications.js).
     */
    app.get('/api/push/config', auth.requireAuth, (req, res) => {
        if (!disponible) return res.json({ disponible: false });
        res.json({ disponible: true, clePublique: push.clePublique });
    });

    app.post('/api/push/subscribe', auth.requireAuth, async (req, res) => {
        try {
            if (!disponible) return res.status(503).json({ message: "Les alertes ne sont pas disponibles sur ce serveur." });
            const verdict = webPush.validerAbonnement(req.body?.subscription);
            if (!verdict.ok) return res.status(400).json({ message: verdict.message });

            await push.abonner(req.auth.userId, verdict.abonnement, req.headers['user-agent'] || null);
            res.json({ abonne: true });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/push/subscribe');
        }
    });

    /** Retire CE navigateur. Une adresse qui appartient à quelqu'un d'autre n'est pas touchée. */
    app.post('/api/push/unsubscribe', auth.requireAuth, async (req, res) => {
        try {
            if (!disponible) return res.json({ retire: 0 });
            const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
            if (!endpoint || endpoint.length > 2048) return res.status(400).json({ message: "Adresse d’abonnement invalide." });

            res.json({ retire: await push.desabonner(req.auth.userId, endpoint) });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/push/unsubscribe');
        }
    });

    /** « Envoyer un essai » : une alerte sur chaque appareil abonné de la personne. */
    app.post('/api/push/test', auth.requireAuth, async (req, res) => {
        try {
            if (!disponible) return res.status(503).json({ message: "Les alertes ne sont pas disponibles sur ce serveur." });

            const maintenant = horloge();
            const dernier = derniersEssais.get(req.auth.username) || 0;
            if (maintenant - dernier < INTERVALLE_ESSAI_MS) {
                return res.status(429).json({ message: "Un essai vient de partir. Patientez quelques secondes." });
            }
            derniersEssais.set(req.auth.username, maintenant);

            const bilan = await push.essai(req.auth.userId);
            if (bilan.envoyes + bilan.expires + bilan.echecs === 0) {
                return res.status(404).json({ message: "Aucun appareil n’est abonné aux alertes pour ce compte.", ...bilan });
            }
            if (bilan.envoyes === 0) {
                return res.status(502).json({ message: "L’essai n’a pas pu être livré. Réactivez les alertes sur cet appareil.", ...bilan });
            }
            res.json({ message: "Essai envoyé.", ...bilan });
        } catch (erreur) {
            repondreErreur(res, erreur, '/api/push/test');
        }
    });

    return { disponible };
}

module.exports = { monter, INTERVALLE_ESSAI_MS };
