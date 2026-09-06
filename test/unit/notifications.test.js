'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createNotificationBrowser } = require('../fixtures/notification-browser.js');

const trade = (id, overrides = {}) => ({
    id, draftName: 'Ligue des amis', fromTeam: 'Les Nordiques', toTeam: 'Canadiens',
    offering: [{ name: 'Nathan MacKinnon' }], receiving: [{ name: 'Nick Suzuki' }],
    date: '2026-09-06T15:55:00Z', ...overrides
});
const findItem = (browser, id) => browser.items().find(item => item.dataset.notificationId === id);
const unread = browser => browser.state().items.filter(item => !item.read).length;
const toastLink = browser => browser.element('fzNotifToast').querySelector('a[data-notification-id]');

describe('notifications — receiving and deliberately reading updates', () => {
    test('an empty inbox shows only the bell and a helpful panel empty state', async () => {
        const browser = await createNotificationBrowser();
        assert.equal(browser.element('fzNotifBadge').hidden, true);
        assert.equal(browser.element('fzNotifBtn').classList.contains('has-unread'), false);
        assert.equal(browser.element('fzNotifToast').hidden, true);
        browser.element('fzNotifBtn').click();
        assert.equal(browser.element('fzNotifPanel').hidden, false);
        assert.equal(browser.items().length, 0);
        assert.match(browser.element('fzNotifList').textContent, /notification|signaler|instant/i);
    });

    test('initial notifications populate the unread badge without a startup popup', async () => {
        const browser = await createNotificationBrowser({ trades: [trade('one'), trade('two')] });
        assert.equal(browser.element('fzNotifBadge').textContent, '2');
        assert.equal(browser.element('fzNotifBadge').hidden, false);
        assert.equal(browser.element('fzNotifToast').hidden, true);
        assert.equal(unread(browser), 2);
    });

    test('opening, hovering, scrolling, and closing the panel do not read anything', async () => {
        const browser = await createNotificationBrowser({ trades: [trade('one'), trade('two')] });
        browser.element('fzNotifBtn').click();
        assert.equal(browser.element('fzNotifBtn').getAttribute('aria-expanded'), 'true');
        browser.dispatch(findItem(browser, 'trade:one'), 'mouseover');
        browser.dispatch(findItem(browser, 'trade:one'), 'pointerenter');
        browser.dispatch(browser.element('fzNotifList'), 'scroll');
        browser.dispatch(browser.document, 'keydown', { key: 'Escape' });
        assert.equal(browser.element('fzNotifPanel').hidden, true);
        assert.equal(browser.document.activeElement, browser.element('fzNotifBtn'));
        assert.equal(unread(browser), 2);
        assert.equal(browser.element('fzNotifBadge').textContent, '2');
    });

    test('clicking a particular notification reads just that item before navigation', async () => {
        const browser = await createNotificationBrowser({ trades: [trade('one'), trade('two')] });
        browser.element('fzNotifBtn').click();
        const item = findItem(browser, 'trade:one');
        const destination = new URL(item.getAttribute('href'), browser.window.location);
        assert.equal(destination.pathname, '/trade.html');
        assert.equal(destination.searchParams.get('pool'), 'Ligue des amis');
        assert.equal(destination.searchParams.get('trade'), 'one');
        item.click();
        // No await: the click must persist read state before the browser follows href.
        assert.equal(browser.state().items.find(entry => entry.id === 'trade:one').read, true);
        assert.equal(browser.state().items.find(entry => entry.id === 'trade:two').read, false);
        assert.equal(browser.element('fzNotifBadge').textContent, '1');
        assert.equal(browser.items().length, 2);
        assert.equal(findItem(browser, 'trade:one').classList.contains('is-unread'), false);
        assert.equal(findItem(browser, 'trade:two').classList.contains('is-unread'), true);
    });

    test('read history survives refresh, navigation, and disappearance from pending trades', async () => {
        const browser = await createNotificationBrowser({ trades: [trade('one'), trade('two')] });
        findItem(browser, 'trade:one').click();
        browser.setTrades([trade('two')]);
        await browser.emit('tradeUpdated');
        assert.equal(browser.items().length, 2);
        assert.equal(browser.state().items.find(entry => entry.id === 'trade:one').read, true);

        const refreshed = await createNotificationBrowser({ storage: browser.storage, trades: [trade('two')] });
        assert.equal(refreshed.items().length, 2);
        assert.equal(unread(refreshed), 1);
        assert.equal(refreshed.element('fzNotifBadge').textContent, '1');
        assert.equal(refreshed.element('fzNotifToast').hidden, true);
    });

    test('the explicit mark-all action clears unread state while retaining the complete inbox', async () => {
        const browser = await createNotificationBrowser({ trades: [trade('one'), trade('two')] });
        browser.element('fzNotifBtn').click();
        browser.element('fzNotifMarkAll').click();
        assert.equal(unread(browser), 0);
        assert.equal(browser.element('fzNotifBadge').hidden, true);
        assert.equal(browser.element('fzNotifBtn').classList.contains('has-unread'), false);
        assert.equal(browser.items().length, 2);
        assert.equal(browser.element('fzNotifMarkAll').getAttribute('aria-disabled'), 'true');

        browser.setTrades([trade('one'), trade('two'), trade('three')]);
        await browser.emit('tradePending');
        assert.equal(unread(browser), 1);
        assert.equal(browser.element('fzNotifBadge').textContent, '1');
        assert.equal(browser.element('fzNotifMarkAll').getAttribute('aria-disabled'), 'false');
    });

    test('a live update changes the badge and gives an actionable, dismissible popup', async () => {
        const browser = await createNotificationBrowser();
        browser.setTrades([trade('new')]);
        await browser.emit('tradePending');
        assert.equal(browser.element('fzNotifBadge').textContent, '1');
        assert.equal(browser.element('fzNotifBadge').hidden, false);
        assert.equal(browser.element('fzNotifToast').hidden, false);
        assert.equal(toastLink(browser).dataset.notificationId, 'trade:new');
        assert.match(browser.element('fzNotifToast').textContent, /change/i);

        browser.element('fzNotifToastDismiss').click();
        assert.equal(browser.element('fzNotifToast').hidden, true);
        assert.equal(unread(browser), 1);
        browser.element('fzNotifBtn').click();
        assert.equal(unread(browser), 1);
    });

    test('popup expiration leaves the notification unread', async () => {
        const browser = await createNotificationBrowser();
        browser.setTrades([trade('new')]);
        await browser.emit('tradePending');
        assert.equal(browser.element('fzNotifToast').hidden, false);
        await browser.advance(20000);
        assert.equal(browser.element('fzNotifToast').hidden, true);
        assert.equal(unread(browser), 1);
        assert.equal(browser.element('fzNotifBadge').textContent, '1');
    });

    test('clicking the popup reads its target and leaves other notifications unread', async () => {
        const browser = await createNotificationBrowser({ trades: [trade('old')] });
        browser.setTrades([trade('old'), trade('new')]);
        await browser.emit('tradePending');
        const link = toastLink(browser);
        assert.equal(new URL(link.getAttribute('href'), browser.window.location).searchParams.get('trade'), 'new');
        link.click();
        assert.equal(browser.state().items.find(entry => entry.id === 'trade:new').read, true);
        assert.equal(browser.state().items.find(entry => entry.id === 'trade:old').read, false);
        assert.equal(browser.element('fzNotifBadge').textContent, '1');
        assert.equal(browser.element('fzNotifToast').hidden, true);
    });

    test('bursts share one popup and duplicate events do not replay dismissed items', async () => {
        const browser = await createNotificationBrowser();
        browser.setTrades([trade('one'), trade('two'), trade('three')]);
        await browser.emit('tradePending');
        assert.equal(browser.document.querySelectorAll('#fzNotifToast').length, 1);
        assert.equal(unread(browser), 3);
        assert.equal(browser.element('fzNotifToast').hidden, false);
        browser.element('fzNotifToastDismiss').click();
        await browser.emit('tradePending');
        await browser.emit('tradeUpdated');
        await browser.emit('connect');
        assert.equal(browser.element('fzNotifToast').hidden, true);
        assert.equal(unread(browser), 3);
        assert.equal(browser.items().length, 3);
    });

    test('the popup inbox action opens the panel without consuming unread items', async () => {
        const browser = await createNotificationBrowser();
        browser.setTrades([trade('one'), trade('two')]);
        await browser.emit('tradePending');
        browser.element('fzNotifToastMore').click();
        assert.equal(browser.element('fzNotifPanel').hidden, false);
        assert.equal(unread(browser), 2);
    });

    test('notification history and read states are isolated by signed-in username', async () => {
        const alice = await createNotificationBrowser({ trades: [trade('shared')] });
        findItem(alice, 'trade:shared').click();
        const bob = await createNotificationBrowser({ username: 'Bob', storage: alice.storage, trades: [trade('shared')] });
        assert.equal(unread(bob), 1);
        const aliceAgain = await createNotificationBrowser({ storage: alice.storage, trades: [trade('shared')] });
        assert.equal(unread(aliceAgain), 0);
        assert.equal(aliceAgain.element('fzNotifBadge').hidden, true);
    });

    test('an unread notification is retained when it disappears from the pending feed', async () => {
        const browser = await createNotificationBrowser({ trades: [trade('withdrawn')] });
        browser.setTrades([]);
        await browser.emit('tradeUpdated');
        assert.equal(browser.items().length, 1);
        assert.equal(unread(browser), 1);
        assert.equal(browser.element('fzNotifBadge').textContent, '1');
    });

    test('corrupt saved history does not prevent new notifications or deliberate reads', async () => {
        const storage = new Map([['fzNotifications:v1:Alice', '{invalid json']]);
        const browser = await createNotificationBrowser({ storage, trades: [trade('one')] });
        assert.equal(browser.element('fzNotifBadge').textContent, '1');
        findItem(browser, 'trade:one').click();
        assert.equal(browser.element('fzNotifBadge').hidden, true);
        assert.equal(unread(browser), 0);
    });

    test('a blocked storage write keeps the notification controls usable', async () => {
        const browser = await createNotificationBrowser({ storageFailure: true, trades: [trade('one')] });
        assert.equal(browser.element('fzNotifBadge').textContent, '1');
        browser.element('fzNotifBtn').click();
        findItem(browser, 'trade:one').click();
        assert.equal(browser.element('fzNotifBadge').hidden, true);
        assert.equal(browser.items().length, 1);
    });

    test('hovering the popup pauses expiration without reading its notification', async () => {
        const browser = await createNotificationBrowser();
        browser.setTrades([trade('new')]);
        await browser.emit('tradePending');
        browser.dispatch(browser.element('fzNotifToast'), 'mouseenter');
        await browser.advance(20000);
        assert.equal(browser.element('fzNotifToast').hidden, false);
        assert.equal(unread(browser), 1);
        browser.dispatch(browser.element('fzNotifToast'), 'mouseleave');
        await browser.advance(8000);
        assert.equal(browser.element('fzNotifToast').hidden, true);
        assert.equal(unread(browser), 1);
    });

    test('keyboard focus pauses popup expiration and dismissing restores a usable focus target', async () => {
        const browser = await createNotificationBrowser();
        browser.setTrades([trade('new')]);
        await browser.emit('tradePending');
        toastLink(browser).focus();
        await browser.advance(20000);
        assert.equal(browser.element('fzNotifToast').hidden, false);
        assert.equal(unread(browser), 1);
        browser.element('fzNotifToastDismiss').click();
        assert.equal(browser.element('fzNotifToast').hidden, true);
        assert.equal(browser.document.activeElement, browser.element('fzNotifBtn'));
        assert.equal(unread(browser), 1);
    });

    test('a hidden tab preserves the popup until the user returns', async () => {
        const browser = await createNotificationBrowser();
        browser.setTrades([trade('new')]);
        await browser.emit('tradePending');
        browser.document.hidden = true;
        browser.dispatch(browser.document, 'visibilitychange');
        await browser.advance(20000);
        assert.equal(browser.element('fzNotifToast').hidden, true);
        browser.document.hidden = false;
        browser.dispatch(browser.document, 'visibilitychange');
        await browser.flush();
        assert.equal(browser.element('fzNotifToast').hidden, false);
        assert.equal(unread(browser), 1);
        await browser.advance(8000);
        assert.equal(browser.element('fzNotifToast').hidden, true);
        assert.equal(unread(browser), 1);
    });

    test('notifications received with the panel open update its contents without another popup', async () => {
        const browser = await createNotificationBrowser();
        browser.element('fzNotifBtn').click();
        browser.setTrades([trade('new')]);
        await browser.emit('tradePending');
        assert.equal(browser.element('fzNotifToast').hidden, true);
        assert.equal(browser.element('fzNotifPanel').hidden, false);
        assert.equal(browser.items().length, 1);
        assert.equal(unread(browser), 1);
    });

    test('cross-tab reads merge without restoring an older unread state', async () => {
        const first = await createNotificationBrowser({ trades: [trade('one'), trade('two')] });
        const second = await createNotificationBrowser({ storage: first.storage, trades: [trade('one'), trade('two')] });
        findItem(first, 'trade:one').click();
        // This tab has not received a storage event yet and still shows both unread.
        assert.equal(second.element('fzNotifBadge').textContent, '2');
        findItem(second, 'trade:two').click();
        assert.equal(unread(second), 0);
        first.dispatch(first.window, 'storage', { key: 'fzNotifications:v1:Alice' });
        assert.equal(first.element('fzNotifBadge').hidden, true);
        assert.equal(first.items().filter(item => item.classList.contains('is-unread')).length, 0);
    });

    test('reading a popup notification in another tab dismisses that popup', async () => {
        const first = await createNotificationBrowser();
        const second = await createNotificationBrowser({ storage: first.storage });
        first.setTrades([trade('new')]);
        await first.emit('tradePending');
        second.dispatch(second.window, 'storage', { key: 'fzNotifications:v1:Alice' });
        findItem(second, 'trade:new').click();
        first.dispatch(first.window, 'storage', { key: 'fzNotifications:v1:Alice' });
        assert.equal(first.element('fzNotifToast').hidden, true);
        assert.equal(first.element('fzNotifBadge').hidden, true);
    });

    test('reading during an in-flight refresh remains read after that response arrives', async () => {
        const browser = await createNotificationBrowser({ trades: [trade('one')] });
        const release = browser.holdNextFetch();
        await browser.emit('tradeUpdated');
        findItem(browser, 'trade:one').click();
        release([trade('one'), trade('two')]);
        await browser.flush();
        assert.equal(browser.state().items.find(item => item.id === 'trade:one').read, true);
        assert.equal(browser.element('fzNotifBadge').textContent, '1');
        assert.equal(toastLink(browser).dataset.notificationId, 'trade:two');
    });

    test('overlapping socket events schedule one follow-up fetch and retain all arrived updates', async () => {
        const browser = await createNotificationBrowser();
        const requestsBefore = browser.requests.length;
        const release = browser.holdNextFetch();
        await browser.emit('tradePending');
        browser.setTrades([trade('one'), trade('two')]);
        await browser.emit('tradePending');
        await browser.emit('tradeUpdated');
        assert.equal(browser.requests.length - requestsBefore, 1);
        release([trade('one')]);
        await browser.flush();
        assert.equal(browser.requests.length - requestsBefore, 2);
        assert.equal(browser.items().length, 2);
        assert.equal(unread(browser), 2);
        assert.equal(browser.document.querySelectorAll('#fzNotifToast').length, 1);
    });

    test('network failures retain notifications and explain that a refresh will be retried', async () => {
        const browser = await createNotificationBrowser({ trades: [trade('one')] });
        browser.failFetch();
        await browser.emit('tradeUpdated');
        assert.equal(browser.items().length, 1);
        assert.equal(unread(browser), 1);
        assert.match(browser.element('fzNotifHelp').textContent, /indisponible|essai|conserv/i);
    });

    test('notifications name the pool, include readable time and status, and safely encode direct links', async () => {
        const pool = 'Amis & rivaux "Elite"';
        const id = 'offer/&?"';
        const browser = await createNotificationBrowser({ trades: [trade(id, { draftName: pool, fromTeam: '<img src=x onerror=alert(1)>' })] });
        const item = browser.items()[0];
        const href = new URL(item.getAttribute('href'), browser.window.location);
        assert.equal(href.searchParams.get('pool'), pool);
        assert.equal(href.searchParams.get('trade'), id);
        assert.match(item.textContent, /Amis & rivaux/);
        assert.match(item.textContent, /[Nn]on lu/);
        assert.ok(item.querySelector('time')?.getAttribute('datetime'));
        assert.ok(item.querySelector('time').textContent.trim());
        assert.equal(item.querySelectorAll('img').length, 0);
    });

    test('a newly actionable draft turn appears promptly with priority and its pool destination', async () => {
        const browser = await createNotificationBrowser({ trades: [trade('old')] });
        browser.setPools([{
            name: 'Pool du bureau', teamName: 'Canadiens',
            data: { etat: 'encours', equipeAuTour: 'Canadiens', choixFait: 3, choixTotal: 20 }
        }]);
        await browser.updatePools();
        const first = browser.items()[0];
        assert.match(first.textContent, /tour/i);
        assert.equal(new URL(first.getAttribute('href'), browser.window.location).searchParams.get('pool'), 'Pool du bureau');
        assert.equal(toastLink(browser).dataset.notificationId, first.dataset.notificationId);
        assert.equal(unread(browser), 3);
        first.click();
        await browser.updatePools();
        assert.equal(unread(browser), 2);
    });
});
