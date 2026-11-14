'use strict';
/* FZMemo (fzReactif.js) : la mémoire d'onglet des données déjà vues. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function charger() {
    const magasin = new Map();
    const sessionStorage = {
        get length() { return magasin.size; },
        key: i => [...magasin.keys()][i] ?? null,
        getItem: k => (magasin.has(k) ? magasin.get(k) : null),
        setItem: (k, v) => magasin.set(k, String(v)),
        removeItem: k => magasin.delete(k)
    };
    const appels = [];
    const ctx = {
        sessionStorage, magasin, appels, Date, JSON, Promise, Map, Set, URL, setTimeout, clearTimeout,
        location: { href: 'http://x/index.html', origin: 'http://x', pathname: '/index.html' },
        navigator: {},
        document: { addEventListener() {}, createElement: () => ({ relList: { supports: () => false } }), head: { appendChild() {} } },
        addEventListener() {},
        fetch: (url, init) => { appels.push([url, init && init.method]); return Promise.resolve({ ok: true, json: async () => ({ url }) }); }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../fzReactif.js'), 'utf8'), ctx);
    return ctx;
}

test('une donnée fraîche resservit sans nouvelle lecture, et deux demandes simultanées n’en font qu’une', async () => {
    const ctx = charger();
    let lectures = 0;
    const chargeur = async () => { lectures += 1; return { n: lectures }; };
    const [a, b] = await Promise.all([ctx.FZMemo.charger('k', chargeur), ctx.FZMemo.charger('k', chargeur)]);
    assert.equal(lectures, 1);
    assert.deepEqual(a, b);
    assert.deepEqual(await ctx.FZMemo.charger('k', chargeur), { n: 1 });
    assert.equal(lectures, 1);
    assert.ok(ctx.magasin.has('fzMemo:k'), 'gardée dans l’onglet');
});

test('une donnée trop vieille est relue', async () => {
    const ctx = charger();
    ctx.FZMemo.ecrire('k', { vieux: true });
    ctx.FZMemo.lire('k').at -= 120000;
    const v = await ctx.FZMemo.charger('k', async () => ({ neuf: true }), { fraisMs: 60000 });
    assert.deepEqual(v, { neuf: true });
    assert.equal(ctx.FZMemo.donnee('k', 1000).neuf, true);
});

test('toute écriture vers le serveur vide la mémoire et l’instantané des pools', async () => {
    const ctx = charger();
    ctx.FZMemo.ecrire('k', 1);
    ctx.sessionStorage.setItem('fzDraftInstantane', '{}');
    ctx.sessionStorage.setItem('autre', 'garde');
    await ctx.fetch('/lecture');
    assert.equal(ctx.FZMemo.donnee('k'), 1, 'un GET ne vide rien');
    await ctx.fetch('/trade/accept', { method: 'POST' });
    assert.equal(ctx.FZMemo.lire('k'), null);
    assert.equal(ctx.sessionStorage.getItem('fzDraftInstantane'), null);
    assert.equal(ctx.sessionStorage.getItem('autre'), 'garde');
});
