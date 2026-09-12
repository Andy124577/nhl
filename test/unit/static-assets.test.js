'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const statiques = require('../../middleware/staticAssets.js');

const racine = path.join(__dirname, '../..');

function servi(chemin) { return statiques.estPublic(chemin).ok; }

test('le code serveur et les données ne sont pas téléchargeables', () => {
    for (const chemin of [
        '/server.js', '/db.js', '/run_migration.js', '/migrate-to-postgres.js',
        '/create-test-users.js', '/fetch_game_logs.js', '/test_suite.js',
        '/users.json', '/draft.json', '/trades.json',
        '/current_stats.json', '/nhl_roster_snapshot.json', '/nhl_transactions.json',
        '/api.py', '/sql.mwb', '/DESIGN.md', '/.env', '/.git/config'
    ]) {
        assert.equal(servi(chemin), false, `${chemin} devrait être refusé`);
    }
});

test('les dossiers privés restent privés, même pour un fichier d apparence anodine', () => {
    for (const chemin of [
        '/migrations/0001_baseline.sql', '/test/unit/authz.test.js',
        '/tools/build_draftkit.js', '/node_modules/express/index.js',
        '/coverage/lcov.info', '/data/draftkit/draftkit-fr.txt',
        '/services/poolStore.js', '/routes/trades.js', '/middleware/auth.js'
    ]) {
        assert.equal(servi(chemin), false, `${chemin} devrait être refusé`);
    }
});

test('lib/ n ouvre que les modules que le navigateur charge vraiment', () => {
    assert.equal(servi('/lib/scoring.js'), true);
    assert.equal(servi('/lib/season.js'), true);
    assert.equal(servi('/lib/instantDraft.js'), false);
    assert.equal(servi('/lib/poolOps.js'), false);
    assert.equal(servi('/lib/session.js'), false, 'surtout pas celui-là');
});

test('les pages, feuilles de style, scripts client et images sont servis', () => {
    for (const chemin of [
        '/index.html', '/classement.html', '/classement.js', '/index.css',
        '/teams/MTL.png', '/Icons/sign.png', '/assets/hero/fantazy-ice-reference.png',
        '/uploads/avatars/abc.png', '/nhl_filtered_stats.json',
        '/draftkit.json', '/draftkit-watchlist.json', '/'
    ]) {
        assert.equal(servi(chemin), true, `${chemin} devrait être servi`);
    }
});

test('les chemins qui tentent de remonter la racine sont refusés, encodés ou non', () => {
    for (const chemin of [
        '/../db.js', '/%2e%2e/db.js', '/..%2Fdb.js', '/lib/../db.js',
        '/teams/../../users.json', '/%2e%2e%2f%2e%2e%2fusers.json'
    ]) {
        assert.equal(servi(chemin), false, `${chemin} devrait être refusé`);
    }
});

test('un segment caché suffit à refuser', () => {
    assert.equal(servi('/.env'), false);
    assert.equal(servi('/.git/HEAD'), false);
    assert.equal(servi('/assets/.secret/x.png'), false);
    assert.equal(servi('/.vs/config.json'), false);
});

test('un octet nul ou une URL indécodable est refusé plutôt qu interprété', () => {
    assert.equal(servi('/index.html\0.png'), false);
    assert.equal(servi('/%E0%A4%A'), false);
});

test('la garde laisse passer les routes applicatives sans extension', () => {
    const garde = statiques.creerGardeStatique();
    const passees = [];
    const appeler = (chemin) => {
        const req = { method: 'GET', path: chemin };
        const res = { status() { return this; }, type() { return this; }, send() { this.envoye = true; return this; } };
        garde(req, res, () => passees.push(chemin));
        return res.envoye !== true;
    };

    assert.equal(appeler('/draft'), true, '/draft est une route, pas un fichier');
    assert.equal(appeler('/trades/all'), true);
    assert.equal(appeler('/uploads/avatars/x.png'), true);
    assert.equal(appeler('/server.js'), false);
    assert.equal(appeler('/users.json'), false);
});

test('une écriture ne passe jamais par la garde de fichiers', () => {
    const garde = statiques.creerGardeStatique();
    let suivant = false;
    garde({ method: 'POST', path: '/server.js' }, {}, () => { suivant = true; });
    assert.equal(suivant, true, 'les routes POST sont traitées ailleurs');
});

test('chaque script chargé par une page du site est effectivement servi', () => {
    // Le vrai risque d'une liste de permis est de refuser quelque chose dont
    // une page a besoin. On lit les pages et on vérifie chaque référence.
    const pages = fs.readdirSync(racine).filter(f => f.endsWith('.html'));
    const manquants = [];

    for (const page of pages) {
        const contenu = fs.readFileSync(path.join(racine, page), 'utf-8');
        for (const trouve of contenu.matchAll(/(?:src|href)="([^"]+)"/g)) {
            const reference = trouve[1];
            if (/^(https?:|mailto:|#|data:|\/socket\.io)/.test(reference)) continue;
            const chemin = '/' + reference.split('?')[0].replace(/^\.?\//, '');
            if (!fs.existsSync(path.join(racine, chemin.slice(1)))) continue;
            if (!servi(chemin)) manquants.push(`${page} → ${chemin}`);
        }
    }

    assert.deepEqual(manquants, [], 'des ressources de page sont refusées par la liste de permis');
});
