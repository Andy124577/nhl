'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const instant = require('../../lib/instantDraft.js');
const {
    PREFIXE_INSTANTANE, JOUEURS_PAR_POOL,
    estPoolInstantane, participants, repechageCommence, placesRestantes,
    accepteEncore, estMembre, premiereEquipeLibre, poolEnAttente,
    poolDejaRejoint, poolEnRepechage, prochainNom, deciderPool, creerPool,
    inscrire, doitDemarrer, totalSelections, equipesEligibles
} = instant;

const { makeFullTeam } = require('../fixtures/pool.js');

/** Nom du n-ième pool de la file, tel que prochainNom() le fabrique. */
const nomInstantane = n => `${PREFIXE_INSTANTANE}${n}`;

/**
 * Un pool instantané peuplé de `noms`, une personne par équipe — la
 * répartition que produit la file, puisque chacun repêche pour soi.
 */
function poolAvec(noms, over = {}) {
    const pool = creerPool(noms[0], { now: '2026-01-01T00:00:00.000Z' });
    noms.slice(1).forEach(nom => inscrire(pool, nom));
    return Object.assign(pool, over);
}

/** Le monde tel que le voit deciderPool : un objet nom → pool. */
const monde = (...paires) => Object.fromEntries(paires);

describe('estPoolInstantane', () => {
    test('le drapeau `instant` suffit, quel que soit le nom', () => {
        assert.equal(estPoolInstantane('Pool des amis', { instant: true }), true);
    });

    test('le préfixe suffit, sans le drapeau', () => {
        // Un pool créé avant l'ajout du champ, ou recopié à la main, n'a que
        // son nom pour se déclarer. Le repli évite de le rendre soudain
        // rejoignable par la liste normale.
        assert.equal(estPoolInstantane(nomInstantane(3), {}), true);
    });

    test('un pool ordinaire n\'en est pas un', () => {
        assert.equal(estPoolInstantane('Les Glorieux', { teams: {} }), false);
        assert.equal(estPoolInstantane('Les Glorieux', { instant: false }), false);
    });

    test('un nom qui contient le préfixe sans commencer par lui n\'en est pas un', () => {
        assert.equal(estPoolInstantane(`Mon ${PREFIXE_INSTANTANE}1`, {}), false);
    });

    test('ni nom ni pool ne fait pas planter', () => {
        assert.equal(estPoolInstantane(undefined, undefined), false);
        assert.equal(estPoolInstantane(null, null), false);
    });
});

describe('participants et placesRestantes', () => {
    test('les membres se comptent sur toutes les équipes', () => {
        assert.equal(participants(poolAvec(['a', 'b', 'c'])), 3);
    });

    test('un pool neuf compte son seul créateur', () => {
        assert.equal(participants(creerPool('a')), 1);
        assert.equal(placesRestantes(creerPool('a')), JOUEURS_PAR_POOL - 1);
    });

    test('un pool plein n\'a plus de place', () => {
        assert.equal(placesRestantes(poolAvec(['a', 'b', 'c', 'd'])), 0);
    });

    test('le compte ne descend jamais sous zéro', () => {
        // Cinq membres pour quatre places : arriver à -1 ferait passer le pool
        // pour « en attente » là où placesRestantes > 0 est le test d'entrée.
        const pool = poolAvec(['a', 'b', 'c', 'd']);
        pool.teams['Équipe 5'].members.push('intrus');

        assert.equal(participants(pool), 5);
        assert.equal(placesRestantes(pool), 0);
    });

    test('un pool vide ou absent compte zéro', () => {
        assert.equal(participants(null), 0);
        assert.equal(participants({}), 0);
        assert.equal(participants({ teams: {} }), 0);
    });
});

describe('repechageCommence', () => {
    test('un ordre de sélection non vide veut dire commencé', () => {
        assert.equal(repechageCommence({ draftOrder: ['Équipe 1'] }), true);
    });

    test('un ordre vide, absent ou nul veut dire pas commencé', () => {
        assert.equal(repechageCommence({ draftOrder: [] }), false);
        assert.equal(repechageCommence({}), false);
        assert.equal(repechageCommence(null), false);
    });
});

describe('accepteEncore', () => {
    test('un pool instantané à moitié plein accepte', () => {
        assert.equal(accepteEncore(nomInstantane(1), poolAvec(['a', 'b'])), true);
    });

    test('un pool plein n\'accepte plus', () => {
        assert.equal(accepteEncore(nomInstantane(1), poolAvec(['a', 'b', 'c', 'd'])), false);
    });

    test('un pool dont le repêchage a démarré n\'accepte plus, même avec une place', () => {
        // Le cas de l'énoncé : quelqu'un est parti, ou le repêchage a été
        // lancé à trois. La porte reste fermée — on ne rejoint pas une partie
        // déjà commencée.
        const pool = poolAvec(['a', 'b'], { draftOrder: ['Équipe 1', 'Équipe 2'] });

        assert.equal(placesRestantes(pool) > 0, true);
        assert.equal(accepteEncore(nomInstantane(1), pool), false);
    });

    test('un pool ordinaire n\'entre jamais dans la file', () => {
        const pool = poolAvec(['a']);
        delete pool.instant;

        assert.equal(accepteEncore('Les Glorieux', pool), false);
    });
});

describe('premiereEquipeLibre', () => {
    test('chaque arrivant prend une équipe vide', () => {
        const pool = creerPool('a');
        assert.equal(premiereEquipeLibre(pool), 'Équipe 2');

        inscrire(pool, 'b');
        assert.equal(premiereEquipeLibre(pool), 'Équipe 3');
    });

    test('sans équipe vide, on se rabat sur une équipe non pleine', () => {
        // Ne peut pas arriver à quatre joueurs pour dix équipes, mais refuser
        // une place à quelqu'un que la file vient d'aiguiller ici serait pire
        // que de le mettre en colocation.
        const pool = creerPool('a', { maxPlayers: 60 });
        Object.keys(pool.teams).forEach((nom, i) => {
            pool.teams[nom].members = i === 0 ? ['a'] : [`occupant${i}`];
        });

        assert.equal(premiereEquipeLibre(pool), 'Équipe 1');
    });

    test('toutes les équipes pleines ne renvoie rien', () => {
        const pool = creerPool('a', { maxPlayers: 99 });
        Object.keys(pool.teams).forEach(nom => {
            pool.teams[nom].members = ['m1', 'm2', 'm3', 'm4', 'm5'];
        });

        assert.equal(premiereEquipeLibre(pool), null);
    });
});

describe('poolEnAttente', () => {
    test('sans aucun pool, personne n\'attend', () => {
        assert.equal(poolEnAttente({}), null);
        assert.equal(poolEnAttente(null), null);
    });

    test('le seul pool en attente est choisi', () => {
        const data = monde([nomInstantane(1), poolAvec(['a'])]);
        assert.equal(poolEnAttente(data), nomInstantane(1));
    });

    test('les pools ordinaires sont ignorés, même vides', () => {
        // La file ne doit jamais aiguiller quelqu'un vers la ligue de
        // quelqu'un d'autre : ce serait exactement le « choisir avec qui on
        // joue » que le bouton supprime.
        const ordinaire = poolAvec(['a']);
        delete ordinaire.instant;

        assert.equal(poolEnAttente(monde(['Les Glorieux', ordinaire])), null);
    });

    test('le pool le plus rempli passe devant', () => {
        // La file doit converger : sinon trois pools à moitié pleins
        // attendent chacun leur quatrième joueur, et aucun ne part.
        const data = monde(
            [nomInstantane(1), poolAvec(['a'], { createdAt: '2026-01-01T00:00:00.000Z' })],
            [nomInstantane(2), poolAvec(['b', 'c', 'd'], { createdAt: '2026-01-02T00:00:00.000Z' })]
        );

        assert.equal(poolEnAttente(data), nomInstantane(2));
    });

    test('à remplissage égal, le plus ancien passe devant', () => {
        const data = monde(
            [nomInstantane(2), poolAvec(['b'], { createdAt: '2026-01-02T00:00:00.000Z' })],
            [nomInstantane(1), poolAvec(['a'], { createdAt: '2026-01-01T00:00:00.000Z' })]
        );

        assert.equal(poolEnAttente(data), nomInstantane(1));
    });

    test('sans date exploitable, le nom tranche — jamais l\'ordre des clés', () => {
        // Deux requêtes simultanées lisent les mêmes données : si le choix
        // dépendait de l'ordre d'itération, elles pourraient partir sur deux
        // pools différents et se rater.
        const sansDate = noms => poolAvec(noms, { createdAt: undefined });
        const a = monde([nomInstantane(2), sansDate(['b'])], [nomInstantane(1), sansDate(['a'])]);
        const b = monde([nomInstantane(1), sansDate(['a'])], [nomInstantane(2), sansDate(['b'])]);

        assert.equal(poolEnAttente(a), nomInstantane(1));
        assert.equal(poolEnAttente(b), nomInstantane(1));
    });

    test('les pools pleins et les pools partis sont écartés', () => {
        const data = monde(
            [nomInstantane(1), poolAvec(['a', 'b', 'c', 'd'])],
            [nomInstantane(2), poolAvec(['e', 'f'], { draftOrder: ['Équipe 1'] })],
            [nomInstantane(3), poolAvec(['g'])]
        );

        assert.equal(poolEnAttente(data), nomInstantane(3));
    });
});

describe('prochainNom', () => {
    test('le premier pool porte le numéro 1', () => {
        assert.equal(prochainNom({}), nomInstantane(1));
    });

    test('la numérotation saute ce qui est déjà pris', () => {
        const data = monde([nomInstantane(1), {}], [nomInstantane(2), {}]);
        assert.equal(prochainNom(data), nomInstantane(3));
    });

    test('un trou dans la numérotation est réutilisé', () => {
        // Le pool #2 a été supprimé : rien n'oblige à monter indéfiniment.
        const data = monde([nomInstantane(1), {}], [nomInstantane(3), {}]);
        assert.equal(prochainNom(data), nomInstantane(2));
    });

    test('un pool ordinaire qui porterait ce nom est contourné', () => {
        // Le nom est la clé primaire : réutiliser celui-là écraserait la ligue
        // de quelqu'un d'autre.
        const data = monde([nomInstantane(1), { teams: {} }]);
        assert.equal(prochainNom(data), nomInstantane(2));
    });
});

describe('creerPool', () => {
    test('le créateur est seul, dans Équipe 1', () => {
        const pool = creerPool('alice');

        assert.deepEqual(pool.teams['Équipe 1'].members, ['alice']);
        assert.equal(participants(pool), 1);
        assert.equal(pool.creator, 'alice');
    });

    test('le pool est prêt à repêcher, mais pas démarré', () => {
        const pool = creerPool('alice');

        assert.deepEqual(pool.draftOrder, []);
        assert.equal(pool.currentPickIndex, 0);
        assert.equal(pool.lastPickIndex, -1);
        assert.equal(repechageCommence(pool), false);
    });

    test('dix équipes sont préparées, comme dans un pool normal', () => {
        assert.equal(Object.keys(creerPool('alice').teams).length, instant.EQUIPES_PAR_POOL);
    });

    test('chaque équipe a ses cinq casiers de sélection', () => {
        const equipe = creerPool('alice').teams['Équipe 2'];

        assert.deepEqual(equipe, {
            members: [], offensive: [], defensive: [], goalie: [], rookie: [], teams: []
        });
    });

    test('le pool est marqué instantané et daté', () => {
        const pool = creerPool('alice', { now: '2026-03-04T05:06:07.000Z' });

        assert.equal(pool.instant, true);
        assert.equal(pool.createdAt, '2026-03-04T05:06:07.000Z');
    });

    test('jamais de mot de passe : une file d\'attente ne se protège pas', () => {
        assert.equal('passwordHash' in creerPool('alice'), false);
    });

    test('toujours cumulatif, jamais tête-à-tête', () => {
        // Le H2H exige un nombre pair de participants. La file ne peut pas le
        // promettre — un départ à trois produirait un calendrier impossible.
        assert.equal(creerPool('alice').poolMode, 'cumulative');
    });

    test('la taille par défaut est celle de la file', () => {
        assert.equal(creerPool('alice').maxPlayers, JOUEURS_PAR_POOL);
        assert.equal(creerPool('alice', { maxPlayers: 6 }).maxPlayers, 6);
    });

    test('les quotas par défaut sont ceux d\'un pool normal', () => {
        assert.deepEqual(creerPool('alice').config, {
            numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1, numTeams: 1
        });
    });

    test('deux pools ne partagent aucune structure', () => {
        // Les objets d'équipe sont mutés en place à chaque inscription et à
        // chaque sélection : un littéral partagé lierait deux pools entre eux.
        const a = creerPool('alice');
        const b = creerPool('bob');
        inscrire(a, 'carol');

        assert.deepEqual(b.teams['Équipe 2'].members, []);
        assert.notEqual(a.teams['Équipe 1'], b.teams['Équipe 1']);
    });
});

describe('inscrire', () => {
    test('l\'arrivant reçoit sa propre équipe', () => {
        const pool = creerPool('alice');

        assert.equal(inscrire(pool, 'bob'), 'Équipe 2');
        assert.deepEqual(pool.teams['Équipe 2'].members, ['bob']);
        assert.equal(participants(pool), 2);
    });

    test('un membre déjà inscrit n\'est pas ajouté deux fois', () => {
        // Le double-clic est le geste naturel sur un bouton qui met une
        // seconde à répondre.
        const pool = poolAvec(['alice', 'bob']);

        assert.equal(inscrire(pool, 'bob'), null);
        assert.equal(participants(pool), 2);
    });

    test('un pool plein refuse', () => {
        const pool = poolAvec(['a', 'b', 'c', 'd']);

        assert.equal(inscrire(pool, 'e'), null);
        assert.equal(participants(pool), 4);
    });

    test('un pool en repêchage refuse, même avec une place libre', () => {
        const pool = poolAvec(['a', 'b'], { draftOrder: ['Équipe 1', 'Équipe 2'] });

        assert.equal(inscrire(pool, 'c'), null);
        assert.equal(participants(pool), 2);
    });

    test('un pool absent ne fait pas planter', () => {
        assert.equal(inscrire(null, 'a'), null);
    });
});

describe('doitDemarrer', () => {
    test('le pool complet part', () => {
        assert.equal(doitDemarrer(poolAvec(['a', 'b', 'c', 'd'])), true);
    });

    test('le pool incomplet attend', () => {
        assert.equal(doitDemarrer(poolAvec(['a', 'b', 'c'])), false);
    });

    test('un pool déjà parti ne repart pas', () => {
        // Sans cette garde, un deuxième appel réécrirait draftOrder et
        // renverrait tout le monde au premier tour, sélections perdues.
        const pool = poolAvec(['a', 'b', 'c', 'd'], { draftOrder: ['Équipe 1'] });

        assert.equal(doitDemarrer(pool), false);
    });

    test('un pool absent ne part pas', () => {
        assert.equal(doitDemarrer(null), false);
    });
});

describe('totalSelections et equipesEligibles', () => {
    test('le total suit les quotas du pool', () => {
        assert.equal(totalSelections(creerPool('a')), 13);
    });

    test('sans config, le total retombe sur les quotas par défaut', () => {
        assert.equal(totalSelections({}), 13);
        assert.equal(totalSelections(null), 13);
    });

    test('seules les équipes peuplées repêchent', () => {
        // Dix équipes existent, quatre seulement ont quelqu'un : générer un
        // ordre sur les dix ferait attendre le pool sur des tours fantômes.
        assert.deepEqual(equipesEligibles(poolAvec(['a', 'b', 'c'])),
            ['Équipe 1', 'Équipe 2', 'Équipe 3']);
    });
});

describe('poolDejaRejoint et poolEnRepechage', () => {
    test('on retrouve son pool en attente', () => {
        const data = monde([nomInstantane(1), poolAvec(['alice', 'bob'])]);
        assert.equal(poolDejaRejoint(data, 'bob'), nomInstantane(1));
    });

    test('un inconnu n\'a pas de pool', () => {
        const data = monde([nomInstantane(1), poolAvec(['alice'])]);
        assert.equal(poolDejaRejoint(data, 'zoe'), null);
    });

    test('un pool parti ne compte plus comme « en attente »', () => {
        const data = monde([nomInstantane(1), poolAvec(['alice'], { draftOrder: ['Équipe 1'] })]);
        assert.equal(poolDejaRejoint(data, 'alice'), null);
    });

    test('on retrouve le repêchage qu\'on est en train de faire', () => {
        const data = monde([nomInstantane(1),
            poolAvec(['alice', 'bob', 'c', 'd'], { draftOrder: ['Équipe 1', 'Équipe 2'] })]);

        assert.equal(poolEnRepechage(data, 'alice'), nomInstantane(1));
    });

    test('un repêchage terminé ne retient plus personne', () => {
        // La saison est lancée, il n'y a plus rien à choisir : rien ne doit
        // empêcher d'entrer dans une nouvelle partie.
        const pool = poolAvec(['alice', 'bob'], { draftOrder: ['Équipe 1', 'Équipe 2'] });
        pool.teams['Équipe 1'] = makeFullTeam('A', { members: ['alice'] });
        pool.teams['Équipe 2'] = makeFullTeam('B', { members: ['bob'] });

        assert.equal(poolEnRepechage(monde([nomInstantane(1), pool]), 'alice'), null);
    });

    test('un pool ordinaire en repêchage ne bloque pas la file', () => {
        // La file ne gouverne que ses propres pools : la ligue entre amis de
        // quelqu'un ne doit pas l'empêcher de faire un repêchage instantané.
        const pool = poolAvec(['alice'], { draftOrder: ['Équipe 1'] });
        delete pool.instant;

        assert.equal(poolEnRepechage(monde(['Les Glorieux', pool]), 'alice'), null);
    });
});

describe('deciderPool', () => {
    test('le tout premier joueur ouvre le pool #1', () => {
        assert.deepEqual(deciderPool({}, 'alice'),
            { action: 'creer', nom: nomInstantane(1) });
    });

    test('le suivant rejoint ce même pool', () => {
        const data = monde([nomInstantane(1), poolAvec(['alice'])]);

        assert.deepEqual(deciderPool(data, 'bob'),
            { action: 'rejoindre', nom: nomInstantane(1) });
    });

    test('un pool plein renvoie le suivant sur un pool neuf', () => {
        const data = monde([nomInstantane(1), poolAvec(['a', 'b', 'c', 'd'])]);

        assert.deepEqual(deciderPool(data, 'e'),
            { action: 'creer', nom: nomInstantane(2) });
    });

    test('un pool déjà en repêchage renvoie le suivant sur un pool neuf', () => {
        // Le cas explicite de l'énoncé : le pool précédent repêche, l'arrivant
        // ne s'y greffe pas, il ouvre le suivant.
        const data = monde([nomInstantane(1),
            poolAvec(['a', 'b'], { draftOrder: ['Équipe 1', 'Équipe 2'] })]);

        assert.deepEqual(deciderPool(data, 'c'),
            { action: 'creer', nom: nomInstantane(2) });
    });

    test('les arrivants suivants remplissent le nouveau pool en attente', () => {
        const data = monde(
            [nomInstantane(1), poolAvec(['a', 'b'], { draftOrder: ['Équipe 1'] })],
            [nomInstantane(2), poolAvec(['c'])]
        );

        assert.deepEqual(deciderPool(data, 'd'),
            { action: 'rejoindre', nom: nomInstantane(2) });
    });

    test('recliquer en attente ne crée rien et ne déplace personne', () => {
        const data = monde([nomInstantane(1), poolAvec(['alice', 'bob'])]);

        assert.deepEqual(deciderPool(data, 'bob'),
            { action: 'deja', nom: nomInstantane(1) });
    });

    test('recliquer pendant son repêchage ramène à sa partie', () => {
        // Deux salles de repêchage à la fois, chacune avec son chronomètre,
        // ne peuvent que faire rater des tours.
        const data = monde([nomInstantane(1),
            poolAvec(['alice', 'b', 'c', 'd'], { draftOrder: ['Équipe 1', 'Équipe 2'] })]);

        assert.deepEqual(deciderPool(data, 'alice'),
            { action: 'encours', nom: nomInstantane(1) });
    });

    test('le repêchage en cours l\'emporte sur un pool en attente', () => {
        const data = monde(
            [nomInstantane(1), poolAvec(['alice', 'b', 'c', 'd'], { draftOrder: ['Équipe 1'] })],
            [nomInstantane(2), poolAvec(['e'])]
        );

        assert.deepEqual(deciderPool(data, 'alice'),
            { action: 'encours', nom: nomInstantane(1) });
    });

    test('les ligues ordinaires n\'influencent jamais la décision', () => {
        const ordinaire = poolAvec(['alice']);
        delete ordinaire.instant;

        assert.deepEqual(deciderPool(monde(['Les Glorieux', ordinaire]), 'alice'),
            { action: 'creer', nom: nomInstantane(1) });
    });
});

describe('la file, bout à bout', () => {
    /**
     * Rejoue ce que fait la route sous verrou : décider, puis écrire. C'est
     * la séquence que la concurrence met en danger — deux personnes qui
     * décident sur la même lecture — donc celle qu'il faut vérifier entière.
     */
    function clic(data, username) {
        const decision = deciderPool(data, username);
        if (decision.action === 'creer') {
            data[decision.nom] = creerPool(username, { now: '2026-01-01T00:00:00.000Z' });
        } else if (decision.action === 'rejoindre') {
            inscrire(data[decision.nom], username);
        }
        const pool = data[decision.nom];
        if (doitDemarrer(pool)) pool.draftOrder = equipesEligibles(pool);
        return decision;
    }

    test('quatre joueurs se retrouvent dans le même pool, qui part seul', () => {
        const data = {};
        const actions = ['a', 'b', 'c', 'd'].map(u => clic(data, u));

        assert.deepEqual(actions.map(x => x.nom), Array(4).fill(nomInstantane(1)));
        assert.deepEqual(actions.map(x => x.action),
            ['creer', 'rejoindre', 'rejoindre', 'rejoindre']);
        assert.equal(Object.keys(data).length, 1);
        assert.equal(repechageCommence(data[nomInstantane(1)]), true);
    });

    test('le cinquième ouvre le pool suivant, et les autres l\'y rejoignent', () => {
        const data = {};
        ['a', 'b', 'c', 'd'].forEach(u => clic(data, u));

        assert.equal(clic(data, 'e').nom, nomInstantane(2));
        assert.equal(clic(data, 'f').nom, nomInstantane(2));
        assert.deepEqual(Object.keys(data), [nomInstantane(1), nomInstantane(2)]);
    });

    test('douze joueurs font exactement trois pools pleins', () => {
        const data = {};
        const joueurs = Array.from({ length: 12 }, (_, i) => `j${i}`);
        joueurs.forEach(u => clic(data, u));

        const pools = Object.entries(data);
        assert.equal(pools.length, 3);
        pools.forEach(([, pool]) => {
            assert.equal(participants(pool), JOUEURS_PAR_POOL);
            assert.equal(repechageCommence(pool), true);
        });

        // Personne n'est perdu, personne n'est en double.
        const inscrits = pools.flatMap(([, p]) =>
            Object.values(p.teams).flatMap(e => e.members));
        assert.deepEqual([...inscrits].sort(), [...joueurs].sort());
    });

    test('recliquer sans arrêt n\'ouvre jamais de pool en trop', () => {
        const data = {};
        for (let i = 0; i < 10; i++) clic(data, 'alice');

        assert.equal(Object.keys(data).length, 1);
        assert.equal(participants(data[nomInstantane(1)]), 1);
    });

    test('chacun garde son équipe, personne ne se marche dessus', () => {
        const data = {};
        ['a', 'b', 'c', 'd'].forEach(u => clic(data, u));

        const pool = data[nomInstantane(1)];
        const peuplees = Object.entries(pool.teams).filter(([, e]) => e.members.length);

        assert.equal(peuplees.length, 4);
        peuplees.forEach(([, equipe]) => assert.equal(equipe.members.length, 1));
    });
});
