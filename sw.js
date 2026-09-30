/* Service worker de Fantazy — les alertes sur l'appareil, rien d'autre.
 *
 * Le serveur pousse un message chiffré quand c'est le tour d'une équipe
 * (services/push.js) ; le navigateur réveille ce fichier, qui affiche
 * l'alerte. Un toucher sur l'alerte ramène Fantazy devant, sur la salle de
 * repêchage du bon pool.
 *
 * Volontairement AUCUN gestionnaire `fetch` : ce service worker ne s'interpose
 * jamais entre les pages et le réseau. Pas de cache, pas de page hors ligne —
 * rien qui puisse servir une vieille version du site.
 *
 * Il est à la racine pour que sa portée couvre toutes les pages. Le serveur le
 * sert sans cache (server.js) : une nouvelle version s'installe à la visite
 * suivante. */
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/**
 * Le message : { titre, corps, url, tag, urgent }.
 *
 * Toujours une alerte visible. Les navigateurs l'exigent (userVisibleOnly),
 * et Safari retire l'abonnement d'un site qui reçoit des messages sans rien
 * montrer.
 */
self.addEventListener('push', (event) => {
    let message = {};
    try { message = event.data ? event.data.json() : {}; } catch { message = {}; }

    const options = {
        body: message.corps || '',
        icon: '/Icons/app-192.png',
        badge: '/Icons/badge-96.png',
        lang: 'fr-CA',
        data: { url: message.url || 'index.html' }
    };
    // Même étiquette : l'alerte du tour suivant remplace la précédente au lieu
    // de s'empiler, et sonne quand même (renotify exige une étiquette).
    if (message.tag) {
        options.tag = message.tag;
        options.renotify = true;
    }
    // « C'est votre tour » reste affiché sur un ordinateur jusqu'à ce qu'on y
    // réponde : il attend un geste.
    if (message.urgent) {
        options.requireInteraction = true;
        options.vibrate = [200, 100, 200];
    }

    event.waitUntil(self.registration.showNotification(message.titre || 'Fantazy', options));
});

/**
 * Un toucher sur l'alerte.
 *
 * La destination porte le pool (`draftActif.html?pool=…`, lib/events.js) : la
 * page le choisit avant d'afficher la salle. Une fenêtre déjà sur cette page
 * y est renvoyée — l'adresse de la salle perd son `?pool=` une fois lue, d'où
 * la comparaison sur le chemin seul. Sinon, une nouvelle fenêtre.
 */
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const brute = (event.notification.data && event.notification.data.url) || 'index.html';
    const cible = new URL(brute, self.registration.scope);

    event.waitUntil((async () => {
        const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

        const exacte = fenetres.find(f => f.url === cible.href);
        if (exacte) return exacte.focus();

        const memePage = fenetres.find(f => new URL(f.url).pathname === cible.pathname);
        if (memePage && 'navigate' in memePage) {
            try {
                const ouverte = await memePage.navigate(cible.href);
                if (ouverte) return ouverte.focus();
            } catch { /* fenêtre non contrôlée : on en ouvre une autre */ }
        }

        return self.clients.openWindow(cible.href);
    })());
});

/**
 * Le navigateur a renouvelé l'abonnement de lui-même (Firefox le fait). Le
 * nouveau est remis au serveur avec le cookie de session ; sans session, la
 * page le fera à la prochaine visite (pushNotifications.js).
 */
self.addEventListener('pushsubscriptionchange', (event) => {
    event.waitUntil((async () => {
        const ancienne = event.oldSubscription && event.oldSubscription.options;
        const nouvel = event.newSubscription || (ancienne && ancienne.applicationServerKey
            ? await self.registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: ancienne.applicationServerKey
            })
            : null);
        if (!nouvel) return;
        await fetch('/api/push/subscribe', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: nouvel.toJSON() })
        });
    })().catch(() => { /* rattrapé à la prochaine visite */ }));
});
