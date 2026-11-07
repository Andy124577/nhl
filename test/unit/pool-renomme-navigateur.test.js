/**
 * Un pool renommé, côté navigateur : ce que le navigateur garde sous l'ancien
 * nom (pool actif, épingles, récents, rangs, favoris) passe au nouveau dès que
 * /draft le révèle (activePool.js, suivreRenommages).
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function charger({ stockage, draft, url = 'http://127.0.0.1/index.html' }) {
    const memoire = new Map(Object.entries(stockage));
    const localStorage = {
        getItem: k => (memoire.has(k) ? memoire.get(k) : null),
        setItem: (k, v) => memoire.set(k, String(v)),
        removeItem: k => memoire.delete(k)
    };
    const lien = new URL(url);
    const window = {
        location: { hostname: lien.hostname, origin: lien.origin, search: lien.search, pathname: lien.pathname, href: url },
        addEventListener() {}
    };
    const contexte = {
        window, localStorage, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, console, URL, URLSearchParams, setTimeout, clearTimeout,
        setInterval: () => 0,
        document: { readyState: 'complete', hidden: false, addEventListener() {} },
        fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(draft), json: async () => draft })
    };
    contexte.globalThis = contexte;
    vm.createContext(contexte);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../activePool.js'), 'utf8'), contexte);
    return { FZPool: window.FZPool, memoire };
}

test('les noms gardés d’avant le renommage passent au nouveau nom', async () => {
    const draft = {
        'Nouveau nom': {
            name: 'Nouveau nom', isMember: true, anciensNoms: ['Ancien nom'],
            teams: { 'Équipe 1': { members: ['andy'] } }
        },
        Autre: { name: 'Autre', isMember: true, teams: { 'Équipe 1': { members: ['andy'] } } }
    };
    const { FZPool, memoire } = charger({
        draft,
        stockage: {
            username: 'andy',
            activePool: 'Ancien nom',
            draftClan: 'Ancien nom',
            fzPoolsEpingles: JSON.stringify(['Ancien nom']),
            fzPoolsRecents: JSON.stringify(['Autre', 'Ancien nom']),
            fzPoolsRangs: JSON.stringify({ 'Ancien nom': { rang: 1, sur: 4 } }),
            'fzFavoris_Ancien nom_andy': JSON.stringify(['Nick Suzuki'])
        }
    });
    await FZPool.ready();

    assert.equal(FZPool.get(), 'Nouveau nom');
    assert.equal(memoire.get('activePool'), 'Nouveau nom');
    assert.equal(memoire.get('draftClan'), 'Nouveau nom');
    assert.deepEqual(JSON.parse(memoire.get('fzPoolsEpingles')), ['Nouveau nom']);
    assert.deepEqual(JSON.parse(memoire.get('fzPoolsRecents')), ['Autre', 'Nouveau nom']);
    assert.deepEqual(Object.keys(JSON.parse(memoire.get('fzPoolsRangs'))), ['Nouveau nom']);
    assert.equal(memoire.get('fzFavoris_Nouveau nom_andy'), JSON.stringify(['Nick Suzuki']));
    assert.equal(memoire.has('fzFavoris_Ancien nom_andy'), false);
});

test('un lien ?pool=ancien nom ouvre le pool renommé', async () => {
    const draft = {
        'Nouveau nom': { name: 'Nouveau nom', isMember: true, anciensNoms: ['Ancien nom'], teams: { 'Équipe 1': { members: ['andy'] } } },
        Autre: { name: 'Autre', isMember: true, teams: { 'Équipe 1': { members: ['andy'] } } }
    };
    const { FZPool } = charger({
        draft,
        url: 'http://127.0.0.1/index.html?pool=Ancien%20nom',
        stockage: { username: 'andy', activePool: 'Autre' }
    });
    await FZPool.ready();
    assert.equal(FZPool.get(), 'Nouveau nom');
});
