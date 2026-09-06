'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chargerFonctions } = require('../fixtures/helpers.js');

// Execute the actual route callbacks without starting the server, scheduling
// background jobs, or connecting to the production database.
function tradeRoute(route, db, emissions) {
    const source = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
    const start = source.indexOf(`app.post('${route}',`);
    assert.ok(start >= 0, `Route missing: ${route}`);
    const end = source.indexOf('\n});', start) + 4;
    let callback;
    vm.runInNewContext(source.slice(start, end), {
        app: { post(_path, handler) { callback = handler; } },
        db,
        io: { emit(...args) { emissions.push(args); } },
        console: { log() {}, error() {} },
        checkIfDraftComplete: () => true,
        teamHasPlayer: () => true,
        removeFromTeam() {},
        addToTeam() {}
    });
    return callback;
}

function response() {
    return {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

test('proposals notify connected users only after successful persistence, without trade details', async () => {
    for (const fail of [false, true]) {
        const emissions = [];
        let persisted = false;
        const db = {
            async query(sql) {
                if (sql.startsWith('SELECT pool_data')) {
                    return { rows: [{ pool_data: { teams: { Sender: {} } } }] };
                }
                assert.match(sql, /INSERT INTO trades/);
                assert.equal(emissions.length, 0);
                if (fail) throw new Error('Database unavailable');
                persisted = true;
                return { rows: [{ id: 42 }] };
            }
        };
        const handler = tradeRoute('/trade/propose', db, emissions);
        const res = response();
        await handler({ body: {
            draftName: 'Pool', fromTeam: 'Sender', toTeam: 'Recipient',
            offering: [{ name: 'Player A', type: 'offensive' }],
            receiving: [{ name: 'Player B', type: 'offensive' }]
        } }, res);
        assert.equal(persisted, !fail);
        assert.equal(res.statusCode, fail ? 500 : 200);
        assert.deepEqual(emissions, fail ? [] : [['tradePending']]);
    }
});

test('declining an already processed proposal emits no false update', async () => {
    for (const rowCount of [0, 1]) {
        const emissions = [];
        const db = { async query() { return { rowCount }; } };
        const handler = tradeRoute('/trade/decline', db, emissions);
        const res = response();
        await handler({ body: { tradeId: 42 } }, res);
        assert.equal(res.statusCode, rowCount ? 200 : 404);
        assert.deepEqual(emissions, rowCount ? [['tradeUpdated']] : []);
    }
});

test('acceptance refreshes notifications after both acceptance and conflict cancellation are persisted', async () => {
    const emissions = [];
    const writes = [];
    const trade = {
        fromTeam: 'Sender', toTeam: 'Recipient',
        offering: [{ name: 'Player A', type: 'offensive' }],
        receiving: [{ name: 'Player B', type: 'offensive' }]
    };
    const db = {
        async query(sql, params) {
            if (sql.startsWith('SELECT id, pool_name')) {
                return { rows: [{ id: 42, pool_name: 'Pool', status: 'pending', trade_data: trade }] };
            }
            if (sql.startsWith('SELECT pool_data')) {
                return { rows: [{ pool_data: { teams: { Sender: {}, Recipient: {} } } }] };
            }
            if (sql.startsWith('SELECT id, trade_data')) {
                return { rows: [{ id: 43, trade_data: trade }] };
            }
            assert.equal(emissions.length, 0, 'An update arrived before every trade write finished');
            if (sql.startsWith('UPDATE trades SET trade_data')) writes.push(params[1]);
            if (sql.startsWith('UPDATE trades SET status')) writes.push(params[0]);
            return { rows: [] };
        },
        async removeTradeListingByPlayer() {}
    };
    const handler = tradeRoute('/trade/accept', db, emissions);
    const res = response();
    await handler({ body: { tradeId: 42 } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(writes, ['completed', 'cancelled']);
    assert.deepEqual(emissions, [['tradeUpdated']]);
    assert.equal(res.body.cancelledConflictingTrades, 1);
});

test('archived notification destinations focus the correct card and respect reduced motion', async () => {
    for (const status of ['completed', 'declined', 'cancelled']) {
        const focused = [];
        const scrolled = [];
        const container = {
            html: '',
            set innerHTML(value) { this.html = value; },
            get innerHTML() { return this.html; },
            querySelectorAll() {
                return Array.from(this.html.matchAll(/data-trade-id="([^"]+)"/g), match => ({
                    dataset: { tradeId: match[1] },
                    focus() { focused.push(match[1]); },
                    scrollIntoView(options) { scrolled.push(options.behavior); }
                }));
            }
        };
        const trade = {
            id: 42, draftName: 'Pool', fromTeam: 'Sender', toTeam: 'Recipient', status,
            date: '2026-09-01T12:00:00Z',
            offering: [{ name: 'Player A', type: 'offensive' }],
            receiving: [{ name: 'Player B', type: 'offensive' }]
        };
        const { loadHistory } = chargerFonctions('trade.js', [
            'loadHistory', 'focusTradeTarget', 'getCategory', 'getCategoryLabel'
        ], {
            BASE_URL: '', currentUsername: 'recipient',
            document: { getElementById: () => container },
            window: { matchMedia: () => ({ matches: true }) },
            FZPool: { get: () => 'Pool' },
            fetch: async () => ({ ok: true, json: async () => [
                { ...trade, id: 99, draftName: 'Other pool' },
                { ...trade, id: 41 }, trade
            ] })
        });
        assert.equal(await loadHistory('42'), true);
        assert.deepEqual(focused, ['42']);
        assert.deepEqual(scrolled, ['auto']);
        assert.doesNotMatch(container.html, /data-trade-id="99"/);
        assert.match(container.html, status === 'completed' ? /Complété/ : status === 'declined' ? /Refusé/ : /Annulé/);
        focused.length = 0;
        assert.equal(await loadHistory('missing'), false);
        assert.deepEqual(focused, []);
    }
});
