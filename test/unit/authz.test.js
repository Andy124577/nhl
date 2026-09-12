'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const authz = require('../../lib/authz.js');

function pool(options = {}) {
    return {
        // `??` ne convient pas ici : un test veut justement passer null.
        passwordHash: 'passwordHash' in options ? options.passwordHash : '$2b$10$empreinte',
        creator: options.creator,
        poolMode: options.poolMode || 'cumulative',
        maxPlayers: 4,
        imageUrl: '/uploads/pools/x.png',
        createdAt: '2026-09-01T00:00:00.000Z',
        config: { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1, numTeams: 1 },
        draftOrder: options.draftOrder || [],
        picksHistory: [{ team: 'Équipe 1', player: 'Joueur A', position: 'offensive' }],
        h2hData: { standings: { 'Équipe 1': { wins: 3 } } },
        teams: options.teams || {
            'Équipe 1': { members: ['alice'], offensive: ['Joueur A'], defensive: [], goalie: [], rookie: [], teams: [] },
            'Équipe 2': { members: ['bob'], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] },
            'Équipe 3': { members: [], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] }
        }
    };
}

test('le résumé public ne laisse fuir ni empreinte, ni alignement, ni membres', () => {
    const resume = authz.resumePublic('Ligue', pool({ creator: 'alice' }));

    assert.equal(resume.hasPassword, true);
    assert.equal(resume.passwordHash, undefined,
        'une empreinte bcrypt diffusée est attaquable hors ligne autant qu on veut');
    assert.equal(resume.teams, undefined);
    assert.equal(resume.picksHistory, undefined);
    assert.equal(resume.h2hData, undefined);
    assert.equal(resume.creator, undefined);

    const texte = JSON.stringify(resume);
    assert.ok(!texte.includes('alice'), 'aucun nom de participant dans un résumé de découverte');
    assert.ok(!texte.includes('Joueur A'), 'aucun joueur repêché dans un résumé de découverte');
});

test('le résumé public porte ce qu il faut pour choisir d entrer, et rien de plus', () => {
    const resume = authz.resumePublic('Ligue', pool({ creator: 'alice' }));
    assert.equal(resume.participantCount, 2);
    assert.equal(resume.occupiedTeamCount, 2);
    assert.equal(resume.teamCount, 3);
    assert.deepEqual(resume.openTeamNames, ['Équipe 3']);
    assert.equal(resume.totalPicks, 13);
    assert.equal(resume.draftStarted, false);
    assert.equal(resume.isMember, false);
});

test('un pool sans mot de passe le dit, sans porter de champ vide', () => {
    const resume = authz.resumePublic('Ligue', pool({ passwordHash: null }));
    assert.equal(resume.hasPassword, false);
});

test('la vue de membre montre tout sauf l empreinte', () => {
    const vue = authz.vueMembre('Ligue', pool({ creator: 'alice' }), 7);
    assert.equal(vue.passwordHash, undefined);
    assert.equal(vue.hasPassword, true);
    assert.equal(vue.isMember, true);
    assert.equal(vue.revision, 7);
    assert.ok(vue.teams['Équipe 1'].offensive.includes('Joueur A'));
    assert.equal(vue.h2hData.standings['Équipe 1'].wins, 3);
});

test('une vue d ensemble donne le détail aux membres et le résumé aux autres', () => {
    const pools = { Ligue: pool({ creator: 'alice' }) };

    const cotéAlice = authz.vuePourUtilisateur(pools, { username: 'alice' });
    assert.equal(cotéAlice.Ligue.isMember, true);
    assert.ok(cotéAlice.Ligue.teams);

    const cotéCarl = authz.vuePourUtilisateur(pools, { username: 'carl' });
    assert.equal(cotéCarl.Ligue.isMember, false);
    assert.equal(cotéCarl.Ligue.teams, undefined);

    const cotéAnonyme = authz.vuePourUtilisateur(pools, {});
    assert.equal(cotéAnonyme.Ligue.teams, undefined);
});

test('l administration voit le détail partout, par le même chemin que tout le monde', () => {
    const vue = authz.vuePourUtilisateur({ Ligue: pool({ creator: 'alice' }) },
        { username: 'admin', isAdmin: true });
    assert.equal(vue.Ligue.isMember, true);
    assert.ok(vue.Ligue.teams);
    assert.equal(vue.Ligue.passwordHash, undefined, "même l'administration ne reçoit pas l'empreinte");
});

test('le créateur se déduit du premier membre d Équipe 1 quand le champ manque', () => {
    const ancien = pool({ creator: undefined });
    assert.equal(authz.createurDuPool(ancien), 'alice');
    assert.equal(authz.peutAdministrer(ancien, { username: 'alice' }), true);
    assert.equal(authz.peutAdministrer(ancien, { username: 'bob' }), false);
});

test('un pool sans créateur identifiable refuse l action au lieu de l ouvrir à tous', () => {
    const orphelin = pool({
        creator: undefined,
        teams: { 'Équipe 1': { members: [] }, 'Équipe 2': { members: ['bob'] } }
    });
    assert.equal(authz.createurDuPool(orphelin), null);
    assert.equal(authz.peutAdministrer(orphelin, { username: 'bob' }), false);
    assert.equal(authz.peutAdministrer(orphelin, { username: 'admin', isAdmin: true }), true,
        "il faut bien quelqu'un pour dépanner un pool dont le créateur a disparu");
});

test('appartenance et équipe se lisent sur l état, jamais sur ce que le client annonce', () => {
    const p = pool({ creator: 'alice' });
    assert.equal(authz.equipeDe(p, 'bob'), 'Équipe 2');
    assert.equal(authz.equipeDe(p, 'carl'), null);
    assert.equal(authz.estMembre(p, 'carl'), false);
    assert.deepEqual(authz.membresDuPool(p).sort(), ['alice', 'bob']);
});

test('un pool illisible ne produit ni vue ni résumé', () => {
    assert.equal(authz.resumePublic('X', null), null);
    assert.equal(authz.vueMembre('X', undefined), null);
    assert.equal(authz.equipeDe(null, 'alice'), null);
    assert.deepEqual(authz.membresDuPool(null), []);
});
