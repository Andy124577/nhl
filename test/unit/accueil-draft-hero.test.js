'use strict';

/**
 * Héros du repêchage de l'accueil (accueil-draft-hero.js), maquette
 * « Accueil v2 » : quatre états — avant le départ, en attente, prochain, au
 * choix — plus la confirmation d'un choix. Le calcul est pur : ces tests
 * l'appellent sans navigateur.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chargerFonctions } = require('../fixtures/helpers.js');

/** Les valeurs sortent du bac à sable : même contenu, autre prototype. */
const egal = (reel, attendu, message) => assert.deepEqual(JSON.parse(JSON.stringify(reel)), attendu, message);

const lire = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

const echapper = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const H = chargerFonctions('accueil-draft-hero.js', [
    'FZH_HERO_CASES', 'FZH_HERO_POS', 'FZH_HERO_CATEGORIES',
    'fzhHeroPhase', 'fzhHeroRythme', 'fzhHeroAttente', 'fzhHeroDuree', 'fzhHeroChrono',
    'fzhHeroAvantDebut', 'fzhHeroHeure', 'fzhHeroNomCourt', 'fzhHeroNomFamille', 'fzhHeroListe',
    'fzhHeroPris', 'fzhHeroOuvertes', 'fzhHeroCode', 'fzhHeroCategorie', 'fzhHeroCandidats',
    'fzhHeroDetail', 'fzhHeroOrdreAnnonce', 'fzhHeroCases', 'fzhHeroCasesAvant',
    'fzhHeroModele', 'fzhHeroAvant',
    'fzhHeroCasesHTML', 'fzhHeroVisage', 'fzhHeroCandidatHTML', 'fzhHeroPanneauHTML',
    'fzhHeroMetaPanneau', 'fzhHeroBarreHTML', 'fzhHeroHTML'
], { fzhHeroEsc: echapper });

const MAINTENANT = Date.parse('2026-10-03T22:00:00.000Z');
const minutes = n => n * 60000;
const equipeVide = membres => ({ members: membres, offensive: [], defensive: [], goalie: [], rookie: [], teams: [] });

/** Trois équipes, serpentin sur quatre rondes : A B C C B A A B C C B A. */
function poolEnCours({ tour = 0, historique = [], ...reste } = {}) {
    return {
        creator: 'alice',
        config: { numOffensive: 2, numDefensive: 1, numGoalies: 1, numRookies: 0, numTeams: 0 },
        draftOrder: ['A', 'B', 'C', 'C', 'B', 'A', 'A', 'B', 'C', 'C', 'B', 'A'],
        currentPickIndex: tour,
        turnStartedAt: MAINTENANT - minutes(1),
        picksHistory: historique,
        teams: { A: equipeVide(['alice']), B: equipeVide(['bob']), C: equipeVide(['carl']) },
        ...reste
    };
}

const choix = (indice, team, player, ilYa, position = 'offensive') =>
    ({ pickIndex: indice, team, player, position, at: new Date(MAINTENANT - minutes(ilYa)).toISOString() });

describe('héros du repêchage — états', () => {
    test('avant le départ, en attente, prochain, au choix, choix confirmé', () => {
        assert.equal(H.fzhHeroPhase({ draftOrder: [] }, 'A'), 'pre');
        assert.equal(H.fzhHeroPhase(poolEnCours({ tour: 0 }), 'A'), 'onclock');
        assert.equal(H.fzhHeroPhase(poolEnCours({ tour: 0 }), 'B'), 'next');
        assert.equal(H.fzhHeroPhase(poolEnCours({ tour: 0 }), 'C'), 'waiting');
        assert.equal(H.fzhHeroPhase(poolEnCours({ tour: 1, historique: [choix(0, 'A', 'Macklin Celebrini', 2)] }), 'A'), 'done',
            'mon choix vient de passer : on le confirme');
        assert.equal(H.fzhHeroPhase(poolEnCours({ tour: 2, historique: [choix(0, 'A', 'x', 3), choix(1, 'B', 'y', 2)] }), 'A'), 'waiting',
            'un autre a choisi depuis : retour à l’attente');
    });

    test('le serpentin rend la main deux fois de suite : le tour prime sur la confirmation', () => {
        const pool = poolEnCours({ tour: 6, historique: [choix(5, 'A', 'x', 1)] });
        assert.equal(H.fzhHeroPhase(pool, 'A'), 'onclock');
    });

    test('mes choix sont faits, le repêchage continue', () => {
        assert.equal(H.fzhHeroPhase(poolEnCours({ tour: 11 }), 'C'), 'done');
    });
});

describe('héros du repêchage — temps', () => {
    test('le rythme est une médiane, et il en faut deux mesures', () => {
        assert.equal(H.fzhHeroRythme([]), null);
        assert.equal(H.fzhHeroRythme([choix(0, 'A', 'a', 10), choix(1, 'B', 'b', 8)]), null, 'une seule mesure ne dit rien');
        const r = H.fzhHeroRythme([choix(0, 'A', 'a', 70), choix(1, 'B', 'b', 68), choix(2, 'C', 'c', 66), choix(3, 'C', 'd', 6)]);
        assert.equal(r, minutes(2), 'une pause d’une heure ne fait pas le rythme');
    });

    test('l’attente compte ce qui reste du choix en cours, puis un rythme par choix', () => {
        assert.equal(H.fzhHeroAttente({ avant: 3, rythme: null, depuis: 0, maintenant: 0 }), null);
        assert.equal(H.fzhHeroAttente({ avant: 3, rythme: minutes(2), depuis: MAINTENANT - minutes(1), maintenant: MAINTENANT }), minutes(5));
        assert.equal(H.fzhHeroAttente({ avant: 1, rythme: minutes(2), depuis: MAINTENANT - minutes(9), maintenant: MAINTENANT }), 0,
            'un choix qui traîne ne rend pas l’attente négative');
    });

    test('formats : durée, chrono, départ, heure', () => {
        assert.equal(H.fzhHeroDuree(20000), '< 1 min');
        assert.equal(H.fzhHeroDuree(minutes(8)), '~8 min');
        assert.equal(H.fzhHeroDuree(minutes(80)), '~1 h 20');
        assert.equal(H.fzhHeroDuree(minutes(119)), '~2 h');
        assert.equal(H.fzhHeroDuree(NaN), null);
        assert.equal(H.fzhHeroChrono(67000), '1:07');
        assert.equal(H.fzhHeroChrono(3727000), '1:02:07');
        assert.equal(H.fzhHeroAvantDebut(minutes(35)), 'dans 35 min');
        assert.equal(H.fzhHeroAvantDebut(minutes(134)), 'dans 2 h 14');
        assert.equal(H.fzhHeroAvantDebut(minutes(60 * 72)), 'dans 3 jours');
        assert.equal(H.fzhHeroAvantDebut(-1), null, 'l’heure passée ne compte plus');
        const soir = new Date(MAINTENANT); soir.setHours(20, 0, 0, 0);
        assert.equal(H.fzhHeroHeure(soir.toISOString(), soir.getTime() - minutes(60)), '20 h 00');
        const plusTard = new Date(soir.getTime() + minutes(60 * 24 * 3));
        assert.match(H.fzhHeroHeure(plusTard.toISOString(), soir.getTime()), /^.+, 20 h$/);
    });

    test('noms : initiale, famille, liste', () => {
        assert.equal(H.fzhHeroNomCourt('Macklin Celebrini'), 'M. Celebrini');
        assert.equal(H.fzhHeroNomFamille('Pierre-Luc Dubois'), 'Dubois');
        assert.equal(H.fzhHeroNomFamille('Montréal Canadiens', true), 'Montréal Canadiens');
        assert.equal(H.fzhHeroListe(['bob']), 'bob');
        assert.equal(H.fzhHeroListe(['bob', 'carl']), 'bob et carl');
        assert.equal(H.fzhHeroListe(['bob', 'carl', 'dora', 'eve']), 'bob, carl et 2 autres');
    });
});

describe('héros du repêchage — ordre de sélection', () => {
    test('huit cases autour du choix en cours, les faits nommés, le mien annoncé', () => {
        const pool = poolEnCours({
            tour: 4,
            historique: [choix(0, 'A', 'Macklin Celebrini', 9), choix(1, 'B', 'Connor Bedard', 7), choix(3, 'C', 'Leo Carlsson', 3)]
        });
        const cases = H.fzhHeroCases(pool, 'A');
        assert.equal(cases.length, H.FZH_HERO_CASES);
        egal(cases.map(c => c.numero), ['03', '04', '05', '06', '07', '08', '09', '10']);
        egal(cases.slice(0, 2).map(c => c.sous), ['Passé', 'L. Carlsson'], 'un tour sauté n’a pas de joueur');
        assert.equal(cases[2].etat, 'actuel');
        assert.equal(cases[2].sous, 'Choisit…');
        assert.equal(cases[3].nom, 'TOI');
        assert.equal(cases[3].sous, 'Ton tour');
        assert.equal(cases[4].sous, '', 'seul mon prochain tour est annoncé');
    });

    test('avant le départ : les équipes, ou l’ordre du classement inversé s’il est connu', () => {
        const pool = { teams: { Zèbres: equipeVide(['zoe']), Aigles: equipeVide(['alice']), Vide: equipeVide([]) } };
        const libre = H.fzhHeroCasesAvant(pool, 'Aigles');
        egal(libre.map(c => [c.numero, c.nom]), [['', 'TOI'], ['', 'Zèbres']]);
        assert.equal(libre[1].sous, 'zoe');

        pool.saisonsPrecedentes = [{ classement: [{ equipe: 'Aigles', rang: 1 }, { equipe: 'Zèbres', rang: 2 }] }];
        egal(H.fzhHeroCasesAvant(pool, 'Aigles').map(c => [c.numero, c.nom]), [['01', 'Zèbres'], ['02', 'TOI']],
            'le dernier de la saison passée ouvre le bal');
    });
});

describe('héros du repêchage — joueurs proposés', () => {
    const pools = {
        skaters: [
            { skaterFullName: 'Connor McDavid', teamAbbrevs: 'EDM', positionCode: 'C', points: 130, playerId: 1 },
            { skaterFullName: 'Quinn Hughes', teamAbbrevs: 'VAN', positionCode: 'D', points: 90, playerId: 2 },
            { skaterFullName: 'Ivan Demidov', teamAbbrevs: 'MTL', positionCode: 'R', points: 60, isRookie: true, playerId: 3 },
            { skaterFullName: 'Cole Caufield', teamAbbrevs: 'MTL', positionCode: 'R', points: 75, playerId: 4 }
        ],
        goalies: [{ goalieFullName: 'Lukas Dostal', teamAbbrevs: 'ANA', wins: 40, playerId: 5 }],
        teams: [{ teamFullName: 'Montréal Canadiens', teamAbbrev: 'MTL', wins: 50 }]
    };
    const config = { numOffensive: 2, numDefensive: 1, numGoalies: 1, numRookies: 1, numTeams: 1 };

    test('les favoris passent devant, puis les meilleurs disponibles ; les pris sortent', () => {
        const poolData = { config, teams: { A: equipeVide(['alice']), B: { ...equipeVide(['bob']), offensive: ['Connor McDavid'] } } };
        const c = H.fzhHeroCandidats({ pools, poolData, teamName: 'A', favoris: ['Cole Caufield'] });
        egal(c.map(x => x.nom), ['Cole Caufield', 'Quinn Hughes', 'Lukas Dostal']);
        assert.equal(c[0].favori, true);
        assert.equal(c[0].detail, 'AD · 75 pts');
        assert.equal(c[2].detail, 'G · 40 V');
        egal(c.map(x => x.categorie), ['offensive', 'defensive', 'goalie']);
    });

    test('une catégorie pleine ne propose plus rien ; la recrue va chez les recrues', () => {
        const pleine = { ...equipeVide(['alice']), offensive: ['a', 'b'], defensive: ['c'], goalie: ['d'] };
        const c = H.fzhHeroCandidats({ pools, poolData: { config, teams: { A: pleine } }, teamName: 'A' });
        egal(c.map(x => [x.nom, x.categorie, x.code]), [['Ivan Demidov', 'rookie', '*']]);
        assert.equal(c[0].detail, 'Recrue · AD · 60 pts');
    });

    test('une place de banc rouvre les patineurs, jamais le gardien', () => {
        const pleine = { ...equipeVide(['alice']), offensive: ['a', 'b'], defensive: ['c'], goalie: ['d'], rookie: ['e'], teams: ['f'] };
        const c = H.fzhHeroCandidats({ pools, poolData: { config, teams: { A: pleine } }, teamName: 'A', quotaBanc: 2, nombre: 10 });
        assert.ok(c.length > 0);
        assert.ok(!c.some(x => x.categorie === 'goalie'));
    });

    test('les clubs n’arrivent que quand il ne reste qu’eux', () => {
        const presque = { ...equipeVide(['alice']), offensive: ['a', 'b'], defensive: ['c'], goalie: ['d'], rookie: ['e'] };
        const c = H.fzhHeroCandidats({ pools, poolData: { config, teams: { A: presque } }, teamName: 'A' });
        egal(c.map(x => [x.nom, x.categorie, x.estClub]), [['Montréal Canadiens', 'teams', true]]);
        assert.equal(c[0].equipe, 'MTL');
    });

    test('catégories envoyées au serveur, comme la salle de repêchage', () => {
        egal(['C', 'L', 'R', 'D', 'G', '*', 'T'].map(H.fzhHeroCategorie),
            ['offensive', 'offensive', 'offensive', 'defensive', 'goalie', 'rookie', 'teams']);
        const salle = lire('draftActif.js');
        assert.match(salle, /"D"===t\?a="defensive":"G"===t\?a="goalie":"\*"===t\?a="rookie":"T"===t&&\(a="teams"\)/,
            'si la salle change sa correspondance, l’accueil doit suivre');
    });
});

describe('héros du repêchage — modèle', () => {
    const avant = (extra = {}) => ({
        creator: 'alice', draftOrder: [], currentPickIndex: 0,
        config: { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1, numTeams: 1 },
        teams: { Aigles: equipeVide(['alice']), Zèbres: equipeVide(['bob']) },
        ...extra
    });

    test('avant le départ, date fixée : le compte à rebours et ce qui reste à préparer', () => {
        const prevu = new Date(MAINTENANT + minutes(134)).toISOString();
        const m = H.fzhHeroModele({ poolData: avant({ draftScheduledAt: prevu }), poolName: 'Les Boys', teamName: 'Aigles', username: 'alice', maintenant: MAINTENANT, favoris: ['x', 'y'] });
        assert.equal(m.phase, 'pre');
        assert.equal(m.titre, 'Le repêchage commence ');
        egal(m.compteARebours, { iso: prevu, texte: 'dans 2 h 14' });
        assert.equal(m.sousTitre, "L'ordre sera tiré au hasard au départ. Tout est prêt de ton côté ?");
        assert.equal(m.meta, 'Les Boys · 2 participants · 13 rondes');
        assert.equal(m.barreLibelle, 'Repêchage', 'pas « en direct » avant le départ');
        egal(m.panneau.etapes.map(e => [e.titre, e.ok]), [['Ta liste de favoris', true], ['Participants', true], ['Départ', true]]);
        assert.equal(m.panneau.etapes[0].detail, '2 joueurs dans ta liste');
        assert.equal(m.panneau.meta, '3 sur 3');
        assert.equal(m.panneau.etapes[2].action.href, 'repechage.html?pool=Les%20Boys', 'la personne qui a créé le pool organise le départ');
        assert.equal(m.activite, 'bob est inscrit');
    });

    test('avant le départ, sans date, vu par un autre membre', () => {
        const m = H.fzhHeroModele({ poolData: avant({ teams: { Aigles: equipeVide(['alice']) } }), poolName: 'P', teamName: 'Aigles', username: 'alice', maintenant: MAINTENANT });
        assert.equal(m.titre, 'Repêchage en préparation');
        assert.equal(m.compteARebours, null);
        assert.equal(m.temps.valeur, 'Quand tu veux');
        assert.equal(m.panneau.etapes[1].detail, '1 équipe inscrite · il en faut au moins 2');
        assert.equal(m.activite, "Personne d'autre n'est inscrit pour l'instant");

        const autre = H.fzhHeroModele({ poolData: avant(), poolName: 'P', teamName: 'Zèbres', username: 'bob', maintenant: MAINTENANT });
        assert.equal(autre.temps.valeur, 'À confirmer');
        assert.equal(autre.panneau.etapes[2].detail, 'alice le lancera');
        assert.equal(autre.panneau.etapes[2].action, null, 'seule la personne qui a créé le pool le lance');
        assert.equal(autre.panneau.etapes[1].action, null);
    });

    test('après une saison, l’ordre est connu d’avance', () => {
        const pool = avant({ saisonsPrecedentes: [{ classement: [{ equipe: 'Zèbres', rang: 1 }, { equipe: 'Aigles', rang: 2 }] }] });
        const m = H.fzhHeroModele({ poolData: pool, poolName: 'P', teamName: 'Aigles', username: 'alice', maintenant: MAINTENANT });
        assert.match(m.sousTitre, /^Tu choisis en premier\./);
        assert.equal(m.ordreTitre, 'Ordre de sélection');
    });

    test('au choix, dans un repêchage daté : le temps restant avant le choix automatique', () => {
        const pool = poolEnCours({ tour: 0, pickTimeLimitMs: minutes(3) });
        const m = H.fzhHeroModele({ poolData: pool, poolName: 'P', teamName: 'A', username: 'alice', maintenant: MAINTENANT });
        assert.equal(m.temps.libelle, 'Temps restant');
        assert.equal(m.temps.valeur, '2:00', 'une minute sur trois est déjà passée');
        assert.equal(m.temps.rebours, MAINTENANT + minutes(2));
        assert.equal(m.temps.chrono, undefined);
        assert.match(m.sousTitre, /à zéro, Fantazy prend le meilleur joueur disponible\.$/);
        assert.equal(m.barreRebours, MAINTENANT + minutes(2));
        assert.equal(m.barreChrono, undefined);

        const html = H.fzhHeroHTML(m, [], null);
        assert.match(html, new RegExp(`data-fzh-rebours="${MAINTENANT + minutes(2)}">2:00<`));
        assert.doesNotMatch(html, /data-fzh-depuis="\d+">2:00/);
        assert.match(H.fzhHeroBarreHTML(m), /data-fzh-rebours=/);

        const echu = H.fzhHeroModele({ poolData: pool, poolName: 'P', teamName: 'A', username: 'alice', maintenant: MAINTENANT + minutes(5) });
        assert.equal(echu.temps.valeur, '0:00', 'jamais sous zéro');
    });

    test('au choix : le temps écoulé, jamais un compte à rebours, et l’onglet qui le dit', () => {
        const m = H.fzhHeroModele({ poolData: poolEnCours({ tour: 0 }), poolName: 'P', teamName: 'A', username: 'alice', maintenant: MAINTENANT });
        assert.equal(m.phase, 'onclock');
        assert.equal(m.temps.libelle, 'Temps écoulé');
        assert.equal(m.temps.valeur, '1:00');
        assert.equal(m.temps.grand, true);
        assert.equal(m.activite, 'B et C attendent ton choix');
        assert.equal(m.sousTitre, 'Ronde 1, choix 1. Choisis directement ici ou ouvre le repêchage.');
        assert.equal(m.panneau.type, 'choix');
        assert.equal(m.titreOnglet, "(C'est ton tour !) Fantazy");
        assert.equal(m.cta.style, 'blanc');
    });

    test('en attente : une estimation seulement quand le rythme est connu', () => {
        const sans = H.fzhHeroModele({ poolData: poolEnCours({ tour: 0 }), poolName: 'P', teamName: 'C', username: 'carl', maintenant: MAINTENANT });
        assert.equal(sans.phase, 'waiting');
        assert.equal(sans.titre, 'Ton tour dans 2 choix');
        assert.equal(sans.temps.valeur, '2 choix');
        assert.equal(sans.temps.eta, null);

        const historique = [choix(0, 'A', 'a', 9), choix(1, 'B', 'b', 7), choix(2, 'C', 'c', 5), choix(3, 'C', 'd', 3), choix(4, 'B', 'e', 1)];
        const pool = poolEnCours({ tour: 5, historique, turnStartedAt: MAINTENANT - minutes(1) });
        const avec = H.fzhHeroModele({ poolData: pool, poolName: 'P', teamName: 'C', username: 'carl', maintenant: MAINTENANT });
        assert.equal(avec.titre, 'Ton tour dans 3 choix');
        assert.equal(avec.temps.valeur, '~5 min');
        assert.equal(avec.ordreDetail, 'Ronde 2 · choix 6 / 12');
        assert.equal(avec.activite, 'A choisit depuis');
        assert.equal(avec.barreTexte, 'Ton tour dans 3 choix (~5 min)');
    });

    test('prochain : le liseré, et qui choisit en ce moment', () => {
        const m = H.fzhHeroModele({ poolData: poolEnCours({ tour: 0 }), poolName: 'P', teamName: 'B', username: 'bob', maintenant: MAINTENANT });
        assert.equal(m.phase, 'next');
        assert.equal(m.sousTitre, 'A est en train de choisir. Garde ta liste sous la main.');
        assert.equal(m.panneau.suivant, 'A');
        assert.equal(m.titreOnglet, '(Tu es le prochain) Fantazy');
    });

    test('choix confirmé, puis équipe complète', () => {
        const pool = poolEnCours({ tour: 1, historique: [choix(0, 'A', 'Macklin Celebrini', 1)] });
        const m = H.fzhHeroModele({ poolData: pool, poolName: 'P', teamName: 'A', username: 'alice', maintenant: MAINTENANT });
        assert.equal(m.titre, 'Celebrini est à toi');
        assert.equal(m.sousTitre, 'Bon choix. Ton prochain tour arrive dans 4 choix.');
        assert.equal(m.panneau.type, 'equipe');
        assert.equal(m.panneau.meta, '1 / 4 joueurs');

        const fini = H.fzhHeroModele({ poolData: poolEnCours({ tour: 11 }), poolName: 'P', teamName: 'C', username: 'carl', maintenant: MAINTENANT });
        assert.equal(fini.titre, 'Ton équipe est complète');
        assert.equal(fini.temps.valeur, '1');
    });
});

describe('héros du repêchage — rendu', () => {
    const candidats = [
        { nom: 'Lukas Dostal', code: 'G', categorie: 'goalie', favori: true, equipe: 'ANA', detail: 'G · 40 V', estClub: false },
        { nom: 'Beckett Sennecke', code: 'R', categorie: 'offensive', favori: false, equipe: 'ANA', detail: 'AD · 60 pts', estClub: false }
    ];

    test('au choix : choisir, puis confirmer ou annuler', () => {
        const m = H.fzhHeroModele({ poolData: poolEnCours({ tour: 0 }), poolName: 'P', teamName: 'A', username: 'alice', maintenant: MAINTENANT });
        const libre = H.fzhHeroHTML(m, candidats);
        assert.equal((libre.match(/data-fzh-choisir=/g) || []).length, 2);
        assert.match(libre, /<h1 id="fzhHeroTitre">C'est ton tour<\/h1>/);
        assert.match(libre, /data-fzh-depuis="\d+"/, 'le temps écoulé avance sans redessiner');
        assert.match(libre, /Aucune limite de temps/);
        assert.ok(!/Choix auto/i.test(libre), 'Fantazy ne choisit jamais à la place de quelqu’un');

        const attente = H.fzhHeroPanneauHTML(m, candidats, { enAttente: 0 });
        assert.match(attente, /data-fzh-confirmer="0">Confirmer DOSTAL</);
        assert.match(attente, /data-fzh-annuler/);
        assert.equal((attente.match(/data-fzh-choisir=/g) || []).length, 1);

        const envoi = H.fzhHeroPanneauHTML(m, candidats, { enAttente: 0, envoi: true });
        assert.match(envoi, /disabled>Envoi…</);
    });

    test('en attente : le choix probable, étiqueté, et la trousse qui charge', () => {
        const m = H.fzhHeroModele({ poolData: poolEnCours({ tour: 0 }), poolName: 'P', teamName: 'B', username: 'bob', maintenant: MAINTENANT });
        assert.match(H.fzhHeroPanneauHTML(m, null), /Chargement des joueurs/);
        const html = H.fzhHeroPanneauHTML(m, candidats);
        assert.equal((html.match(/fzh-cand-tag">Probable/g) || []).length, 1);
        assert.match(html, /Si A prend Dostal, Sennecke passe en tête\./);
        assert.equal(H.fzhHeroMetaPanneau(m, candidats), 'Selon ta liste');
        assert.equal(H.fzhHeroMetaPanneau(m, [candidats[1]]), 'Meilleurs disponibles');
    });

    test('avant le départ : le compte à rebours vit dans le titre, la barre ne dit pas « en direct »', () => {
        const prevu = new Date(MAINTENANT + minutes(90)).toISOString();
        const m = H.fzhHeroModele({
            poolData: { creator: 'alice', draftOrder: [], draftScheduledAt: prevu, teams: { A: equipeVide(['alice']) } },
            poolName: 'Pool <test>', teamName: 'A', username: 'alice', maintenant: MAINTENANT
        });
        const html = H.fzhHeroHTML(m, null);
        assert.match(html, /Le repêchage commence <span data-fzh-avant="[^"]+">dans 1 h 30<\/span>/);
        assert.match(html, /class="fzh-etapes"/);
        assert.ok(html.includes('Pool &lt;test&gt;'), 'le nom du pool est échappé');
        const barre = H.fzhHeroBarreHTML(m);
        assert.match(barre, /class="fzh-barre is-pre"/);
        assert.match(barre, /fzh-barre-libelle">Repêchage</);
    });
});

describe('héros du repêchage — intégration', () => {
    test('l’accueil du repêchage pose le héros, et plus l’ancien bandeau', () => {
        const accueil = lire('accueil-draft.js');
        assert.match(accueil, /data-fzh-hero/);
        assert.match(accueil, /fzhHeroRendre\(root, \{ poolData, poolName: activeName, teamName: team\.name \}\)/);
        assert.ok(!accueil.includes('fzh-draft'), 'l’ancien bandeau « Repêchage en cours » est parti');
        assert.match(accueil, /state\.mode !== 'predraft'/, 'avant le départ aussi');
    });

    test('le tableau de bord réserve « predraft » à l’accueil du repêchage', () => {
        const dash = lire('accueil-dash.js');
        assert.match(dash, /return \{ mode: 'predraft', poolData, team, activeName \}/);
        assert.match(dash, /state\.mode === 'regular' \|\| state\.mode === 'predraft'/);
    });

    test('index.html charge le héros avant l’accueil qui l’appelle', () => {
        const index = lire('index.html');
        const heros = index.indexOf('accueil-draft-hero.js');
        assert.ok(heros > 0 && heros < index.indexOf('src="accueil-draft.js'));
        assert.match(index, /href="accueil-draft-hero\.css\?v=/);
    });

    test('le choix passe par la même route que la salle, avec le tour attendu', () => {
        const source = lire('accueil-draft-hero.js');
        assert.match(source, /\/pick-player/);
        assert.match(source, /expectedPickIndex: c\.tour/);
        assert.ok(!/\b(alert|confirm|prompt)\(/.test(source.replace(/fz(Alert|Confirm)\(/g, '')), 'pas de boîte native');
    });
});
