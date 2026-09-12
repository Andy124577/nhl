'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createNotificationBrowser } = require('../fixtures/notification-browser.js');

/** Une notification telle que /api/notifications la renvoie. */
function servie(options = {}) {
    return {
        id: options.id || 'trade:42',
        serverId: options.serverId || '7',
        type: options.type || 'echange',
        kind: options.kind || 'trade_received',
        pool: options.pool || 'Ligue',
        titre: options.titre || "Proposition d'échange reçue",
        detail: options.detail || 'Équipe 2 vous offre A contre B. Votre réponse est attendue.',
        action: options.action || 'Examiner la proposition',
        urgent: options.urgent !== false,
        expiree: options.expiree === true,
        resolue: options.resolue === true,
        read: options.read === true,
        date: options.date || Date.now(),
        href: options.href || 'trade.html?pool=Ligue&tradeId=42&vue=recues'
    };
}

const items = (navigateur) => [...navigateur.items()].map(a => a.dataset.notificationId);
const nonLues = (navigateur) => [...navigateur.items()].filter(a => a.classList.contains('is-unread')).length;

describe('la cloche au-dessus des notifications du serveur', () => {

    test('le serveur fournit le texte, l urgence et la destination', async () => {
        const navigateur = await createNotificationBrowser({ serverNotifications: [servie()] });

        assert.deepEqual(items(navigateur), ['trade:42']);
        const lien = navigateur.document.querySelector('a[data-notification-id="trade:42"]');
        assert.equal(lien.getAttribute('href'), 'trade.html?pool=Ligue&tradeId=42&vue=recues');
        assert.match(lien.textContent, /Proposition d'échange reçue/);
    });

    test('les sources dérivées se taisent quand le serveur répond', async () => {
        const navigateur = await createNotificationBrowser({
            serverNotifications: [servie()],
            trades: [{ id: 42, draftName: 'Ligue', fromTeam: 'Équipe 2', date: '2026-11-02T12:00:00Z',
                       offering: [{ name: 'A' }], receiving: [{ name: 'B' }] }]
        });

        // Le même échange existe des deux côtés : il ne doit apparaître
        // qu'une fois, et venir du serveur.
        assert.deepEqual(items(navigateur), ['trade:42']);
        assert.ok(!navigateur.requests.some(url => url.includes('/trades/pending')),
            'la source dérivée ne doit pas être interrogée quand le serveur fait foi');
    });

    test('sans historique durable, la cloche retombe sur ses sources dérivées', async () => {
        const navigateur = await createNotificationBrowser({
            serverNotifications: null,
            trades: [{ id: 9, draftName: 'Ligue', fromTeam: 'Équipe 2', date: '2026-11-02T12:00:00Z',
                       offering: [{ name: 'A' }], receiving: [{ name: 'B' }] }]
        });

        assert.deepEqual(items(navigateur), ['trade:9']);
        assert.ok(navigateur.requests.some(url => url.includes('/trades/pending')));
    });

    test('un serveur qui a dit non n est pas redemandé à chaque évènement', async () => {
        const navigateur = await createNotificationBrowser({ serverNotifications: null });
        const avant = navigateur.requests.filter(u => u.includes('/api/notifications')).length;

        await navigateur.emit('tradePending');
        await navigateur.emit('tradeUpdated');

        const apres = navigateur.requests.filter(u => u.includes('/api/notifications')).length;
        assert.equal(apres, avant, 'une réponse qui ne changera pas ne se redemande pas à chaque clic');
    });

    test('l état de lecture déjà acquis localement est repris, pas perdu', async () => {
        // Première session : la notification arrive et est lue.
        const premier = await createNotificationBrowser({ serverNotifications: [servie()] });
        premier.document.querySelector('a[data-notification-id="trade:42"]').click();
        assert.equal(nonLues(premier), 0);

        // Deuxième session, même navigateur : le serveur la renvoie non lue —
        // par exemple parce que la requête de marquage s'est perdue.
        const second = await createNotificationBrowser({
            storage: premier.storage,
            serverNotifications: [servie({ read: false })]
        });
        assert.equal(nonLues(second), 0,
            'la lecture est monotone : le serveur ne peut pas « dé-lire » ce qui a été lu ici');
    });

    test('une notification déjà lue côté serveur arrive lue', async () => {
        const navigateur = await createNotificationBrowser({ serverNotifications: [servie({ read: true })] });
        assert.equal(nonLues(navigateur), 0);
        assert.equal(navigateur.element('fzNotifBadge').hidden, true, 'la pastille reste cachée à zéro');
    });

    test('un clic signale la lecture au serveur, avec son identifiant de base', async () => {
        const navigateur = await createNotificationBrowser({ serverNotifications: [servie({ serverId: '77' })] });
        navigateur.document.querySelector('a[data-notification-id="trade:42"]').click();
        await navigateur.flush();

        assert.equal(navigateur.lectures.length, 1);
        assert.deepEqual(navigateur.lectures[0].ids, ['77']);
    });

    test('une alerte expirée reste consultable sans réclamer une action', async () => {
        const navigateur = await createNotificationBrowser({
            serverNotifications: [servie({
                id: 'turn:Ligue:3', kind: 'turn_current', type: 'repechage',
                titre: 'Votre tour de repêchage est passé', urgent: false, expiree: true,
                href: 'draftActif.html?pool=Ligue'
            })]
        });

        assert.deepEqual(items(navigateur), ['turn:Ligue:3']);
        const lien = navigateur.document.querySelector('a[data-notification-id="turn:Ligue:3"]');
        assert.ok(!lien.classList.contains('is-urgent'),
            "une alerte périmée ne doit plus paraître actionnable");
    });

    test('une nouvelle notification du serveur déclenche un bandeau, la première charge non', async () => {
        const navigateur = await createNotificationBrowser({ serverNotifications: [servie()] });
        // Au premier chargement, tout est « nouveau » : annoncer chaque entrée
        // ferait une pile de bandeaux à chaque ouverture de page.
        assert.equal(navigateur.element('fzNotifToast').hidden, true);

        navigateur.setServerNotifications([servie(), servie({ id: 'trade:43', serverId: '8' })]);
        await navigateur.emit('poolUpdated');

        assert.equal(navigateur.element('fzNotifToast').hidden, false);
        assert.equal(navigateur.element('fzNotifToastLink').dataset.notificationId, 'trade:43');
    });

    test('un échec réseau conserve la liste et reste réessayable', async () => {
        const navigateur = await createNotificationBrowser({ serverNotifications: [servie()] });
        assert.deepEqual(items(navigateur), ['trade:42']);

        navigateur.failFetch();
        await navigateur.emit('poolUpdated');
        assert.deepEqual(items(navigateur), ['trade:42'], 'un échec ne vide pas la cloche');
    });
});
