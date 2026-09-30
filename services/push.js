/**
 * Les alertes sur l'appareil : « C'est à votre tour » même quand Fantazy
 * n'est pas ouvert.
 *
 * La notification durable reste la vérité (lib/events.js, écrite dans la
 * transaction du choix). Ce service n'en est qu'un écho : une fois le COMMIT
 * fait, le magasin de pools lui passe les notifications NOUVELLEMENT écrites
 * (services/poolStore.js, `apresCommit`), et il pousse celles qui le méritent
 * vers les navigateurs abonnés. Un réessai qui retombe sur une notification
 * existante n'est pas nouveau : il ne sonne pas une deuxième fois.
 *
 * Seul le tour de repêchage part pour l'instant. C'est la seule alerte dont
 * l'intérêt se compte en minutes — dans un repêchage chronométré, Fantazy
 * choisit à la place de l'équipe à la fin du temps. Le reste attend
 * tranquillement dans la cloche.
 *
 * Rien ici ne retient une réponse HTTP : l'envoi part après la réponse, et un
 * service de push lent ou en panne ne fait qu'un message de journal.
 */

'use strict';

const webPush = require('../lib/webPush.js');
const evenements = require('../lib/events.js');

/** Les types de notification qui partent aussi sur l'appareil. */
const TYPES_POUSSES = new Set([evenements.NOTIFICATION.VOTRE_TOUR]);

/** Un service de push qui ne répond pas en dix secondes ne répondra pas. */
const DELAI_ENVOI_MS = 10 * 1000;

/**
 * Ce que l'appareil affiche pour cette notification, ou null si elle ne part
 * pas.
 *
 * Le texte vient de `evenements.presenter`, comme la cloche : les deux disent
 * la même chose. Seul ajout, le nom du pool — la cloche le montre à côté du
 * texte, une alerte arrive seule, et une personne peut jouer dans plusieurs
 * pools.
 *
 * `tag` est par pool : l'alerte d'un nouveau tour remplace celle du tour
 * précédent au lieu de s'empiler. `ttl` : au-delà, le tour est joué — dans un
 * repêchage chronométré, par Fantazy — et l'alerte serait fausse.
 */
function messageDe(notification) {
    if (!notification || !TYPES_POUSSES.has(notification.type)) return null;
    const sujet = notification.subject || {};
    const pool = notification.poolName || sujet.poolName || null;
    const vue = { ...notification, poolName: pool };
    const texte = evenements.presenter(vue);
    const limiteMs = Number(sujet.limiteMs) || 0;

    return {
        charge: {
            titre: texte.titre,
            corps: pool ? `${pool} · ${texte.detail}` : texte.detail,
            url: evenements.urlDestination(vue),
            tag: `fz-tour:${pool || ''}`,
            urgent: !!texte.urgent
        },
        ttl: Math.ceil((limiteMs > 0 ? limiteMs : evenements.EXPIRATION_TOUR_MS) / 1000),
        urgence: 'high',
        sujet: `tour:${notification.poolId || pool}`
    };
}

/** Le message de l'essai demandé depuis la page (« Envoyer un essai »). */
const MESSAGE_ESSAI = {
    charge: {
        titre: 'Les alertes fonctionnent',
        corps: 'Vous serez averti ici quand ce sera votre tour de repêcher.',
        url: 'index.html',
        tag: 'fz-essai',
        urgent: false
    },
    ttl: 5 * 60,
    urgence: 'high',
    sujet: null
};

function creerServicePush({
    db,
    cles,
    envoyer = (url, options) => fetch(url, options),
    logger = console,
    horloge = () => Date.now()
}) {
    const disponible = !!(db && cles);

    async function abonner(userId, abonnement, userAgent = null) {
        await db.upsertPushSubscription({ userId, ...abonnement, userAgent });
    }

    async function desabonner(userId, endpoint) {
        return db.deletePushSubscription(userId, endpoint);
    }

    /**
     * Un envoi vers un navigateur. Renvoie 'envoye', 'expire' ou 'echec'.
     *
     * 404 et 410 disent que l'abonnement n'existe plus (navigateur désinstallé,
     * alertes retirées dans les réglages) : la ligne part. Un autre refus —
     * 403 d'une clé qui ne correspond plus, 429 d'un service débordé — ne dit
     * rien de définitif : la ligne reste, et le navigateur se réabonnera de
     * lui-même à sa prochaine visite si sa clé a changé.
     */
    async function envoyerUn(abonnement, message, maintenantS) {
        const hote = (() => { try { return new URL(abonnement.endpoint).host; } catch { return '?'; } })();
        try {
            const { url, options } = webPush.requete({
                abonnement,
                charge: message.charge,
                cles,
                maintenantS,
                ttl: message.ttl,
                urgence: message.urgence,
                sujet: message.sujet
            });
            const reponse = await envoyer(url, { ...options, signal: AbortSignal.timeout(DELAI_ENVOI_MS) });
            if (reponse.status === 404 || reponse.status === 410) {
                await db.deletePushSubscriptionByEndpoint(abonnement.endpoint);
                return 'expire';
            }
            if (!reponse.ok) {
                const detail = await Promise.resolve(reponse.text ? reponse.text() : '').catch(() => '');
                logger.warn(`⚠️ Alerte refusée par ${hote} (${reponse.status}) ${String(detail).slice(0, 200)}`);
                return 'echec';
            }
            return 'envoye';
        } catch (erreur) {
            logger.warn(`⚠️ Alerte non envoyée à ${hote} :`, erreur.message);
            return 'echec';
        }
    }

    /** Pousse un message vers tous les navigateurs de ces comptes. */
    async function envoyerA(userIds, message) {
        const bilan = { envoyes: 0, expires: 0, echecs: 0 };
        if (!disponible) return bilan;
        const abonnements = await db.getPushSubscriptionsForUsers([...new Set(userIds)]);
        const maintenantS = Math.floor(horloge() / 1000);
        const issues = await Promise.all(abonnements.map(a => envoyerUn(a, message, maintenantS)));
        for (const issue of issues) {
            if (issue === 'envoye') bilan.envoyes++;
            else if (issue === 'expire') bilan.expires++;
            else bilan.echecs++;
        }
        return bilan;
    }

    /**
     * Après le COMMIT : les notifications nouvellement écrites qui méritent
     * l'appareil.
     *
     * Les membres d'une même équipe reçoivent la même alerte : une seule
     * lecture des abonnements par fait, pas une par personne. Ne rejette
     * jamais — l'opération qui a produit ces notifications a déjà réussi.
     */
    function apresCommit({ notifications } = {}) {
        if (!disponible) return Promise.resolve([]);

        const parFait = new Map();
        for (const notification of notifications || []) {
            if (!notification || !notification.recipientUserId) continue;
            const message = messageDe(notification);
            if (!message) continue;
            const cle = notification.dedupKey || `${notification.type}:${notification.recipientUserId}`;
            if (!parFait.has(cle)) parFait.set(cle, { message, userIds: [] });
            parFait.get(cle).userIds.push(notification.recipientUserId);
        }

        return Promise.all([...parFait.values()].map(({ message, userIds }) => envoyerA(userIds, message)))
            .catch(erreur => {
                logger.error('⚠️ Alertes sur l’appareil impossibles :', erreur.message);
                return [];
            });
    }

    /** L'essai demandé depuis la page : tous les navigateurs de cette personne. */
    async function essai(userId) {
        return envoyerA([userId], MESSAGE_ESSAI);
    }

    return {
        disponible,
        clePublique: disponible ? cles.clePublique : null,
        abonner,
        desabonner,
        envoyerA,
        apresCommit,
        essai
    };
}

module.exports = { creerServicePush, messageDe, TYPES_POUSSES, MESSAGE_ESSAI };
