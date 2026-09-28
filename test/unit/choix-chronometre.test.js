'use strict';

/**
 * Trois minutes par choix dans un repêchage à date fixe, puis Fantazy choisit.
 *
 * Les règles (lib/poolOps.js, lib/choixAuto.js), la route qui joue le tour
 * d'office (routes/draft.js), la lecture filtrée qui sert au rattrapage
 * (services/poolStore.js) et le minuteur qui réveille le serveur
 * (services/minuteurChoix.js). Un dernier bloc vérifie que le choix
 * automatique est bien « Ton choix probable » de l'accueil.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const poolOps = require('../../lib/poolOps.js');
const choixAuto = require('../../lib/choixAuto.js');
const evenements = require('../../lib/events.js');
const lineup = require('../../lib/lineup.js');
const routesRepechage = require('../../routes/draft.js');
const { creerMinuteurChoix, MARGE_MS } = require('../../services/minuteurChoix.js');
const { monterRoutes, poolNeuf } = require('../fixtures/routeHarness.js');
const { chargerFonctions } = require('../fixtures/helpers.js');

const ALICE = { username: 'alice', userId: 'alice', isAdmin: false };
const BOB = { username: 'bob', userId: 'bob', isAdmin: false };

const MAINTENANT = Date.parse('2026-10-03T23:30:00.000Z');
const LIMITE = poolOps.LIMITE_CHOIX_MS;

/** Une petite trousse, dans la forme de draftkit.json. */
const TROUSSE = {
    skaters: [
        { fullName: 'Connor McDavid', position: 'C', rookie: false, projection: { points: 135 } },
        { fullName: 'Cale Makar', position: 'D', rookie: false, projection: { points: 95 } },
        { fullName: 'Ivan Demidov', position: 'R', rookie: true, projection: { points: 60 } },
        { fullName: 'Mitch Marner', position: 'R', rookie: false, projection: { points: 100 } },
        { fullName: 'Tim Stützle', position: 'C', rookie: false, projection: { points: 85 } },
        { fullName: 'Quinn Hughes', position: 'D', rookie: false, projection: { points: 80 } }
    ],
    goalies: [
        { fullName: 'Andrei Vasilevskiy', rookie: false, projection: { wins: 38 } },
        { fullName: 'Jacob Fowler', rookie: true, projection: { wins: 20 } }
    ],
    teams: [
        { fullName: 'Carolina Hurricanes', projection: { wins: 54 } },
        { fullName: 'Colorado Avalanche', projection: { wins: 51 } }
    ]
};
const BASSIN = choixAuto.bassinDepuisTrousse(TROUSSE);

const CONFIG = { numOffensive: 1, numDefensive: 1, numGoalies: 1, numRookies: 1, numTeams: 1 };

/** Deux équipes, repêchage daté et parti : Équipe 1 est au bâton depuis `ilYa` ms. */
function poolChronometre({ ilYa = LIMITE, config = CONFIG, ...reste } = {}) {
    const pool = poolNeuf({ membres: { 'Équipe 1': ['alice'], 'Équipe 2': ['bob'] }, nbEquipes: 2, config, ...reste });
    pool.draftScheduledAt = new Date(MAINTENANT).toISOString();
    assert.equal(poolOps.demarrerRepechage(pool).ok, true);
    pool.turnStartedAt = MAINTENANT - ilYa;
    return pool;
}

// ───────────────────────────── La limite ─────────────────────────────

test('un repêchage daté part chronométré, un repêchage au clic non', () => {
    const date = poolChronometre();
    assert.equal(date.pickTimeLimitMs, 3 * 60 * 1000);

    const libre = poolNeuf({ membres: { 'Équipe 1': ['alice'], 'Équipe 2': ['bob'] } });
    libre.pickTimeLimitMs = LIMITE; // reste d'une saison d'avant
    poolOps.demarrerRepechage(libre);
    assert.equal('pickTimeLimitMs' in libre, false);
});

test("l'échéance court depuis le début du tour, et s'éteint une fois le dernier choix joué", () => {
    const pool = poolChronometre({ ilYa: 30 * 1000 });
    assert.equal(poolOps.echeanceChoix(pool), MAINTENANT - 30 * 1000 + LIMITE);

    assert.equal(poolOps.echeanceChoix({ ...pool, pickTimeLimitMs: undefined }), null, 'sans limite');
    assert.equal(poolOps.echeanceChoix({ ...pool, turnStartedAt: undefined }), null, 'sans départ de tour');
    assert.equal(poolOps.echeanceChoix(null), null);

    const fini = { ...pool, currentPickIndex: pool.draftOrder.length - 1, lastPickIndex: pool.draftOrder.length - 1 };
    assert.equal(poolOps.echeanceChoix(fini), null, 'les deux curseurs se sont rejoints');

    const extrait = { pickTimeLimitMs: LIMITE, turnStartedAt: 1000, currentPickIndex: 3, lastPickIndex: 2, draftLength: 10 };
    assert.equal(poolOps.echeanceChoix(extrait), 1000 + LIMITE, "l'extrait de la base suffit");
    assert.equal(poolOps.echeanceChoix({ ...extrait, draftLength: 3 }), null);
    assert.equal(poolOps.echeanceChoix({ ...extrait, lastPickIndex: null, currentPickIndex: 0 }), 1000 + LIMITE);
});

test('une nouvelle saison repart sans limite : la prochaine date décidera', () => {
    const pool = poolChronometre({ config: { numOffensive: 1, numDefensive: 0, numGoalies: 0, numRookies: 0, numTeams: 0 } });
    poolOps.choisirJoueur(pool, { username: 'alice', playerName: 'A', position: 'offensive' });
    poolOps.choisirJoueur(pool, { username: 'bob', playerName: 'B', position: 'offensive' });
    const fin = poolOps.nouvelleSaison(pool, { classement: [{ equipe: 'Équipe 1' }, { equipe: 'Équipe 2' }] });
    assert.equal(fin.ok, true);
    assert.equal('pickTimeLimitMs' in pool, false);
});

test('un repêchage chronométré ne se saute pas : il choisit lui-même', () => {
    const pool = poolChronometre({ ilYa: 10 * 60 * 1000 });
    const saut = poolOps.sauterTour(pool, { username: 'bob', maintenant: MAINTENANT });
    assert.equal(saut.ok, false);
    assert.equal(saut.code, 409);
    assert.match(saut.message, /chronométré/);
    assert.equal(pool.currentPickIndex, 0);
});

// ───────────────────────────── Le choix ─────────────────────────────

test('la trousse se range par projection, chaque fiche dans sa catégorie', () => {
    assert.deepEqual(BASSIN.slice(0, 4).map(f => [f.nom, f.categorie, f.valeur]), [
        ['Connor McDavid', 'offensive', 135],
        ['Mitch Marner', 'offensive', 100],
        ['Cale Makar', 'defensive', 95],
        ['Tim Stützle', 'offensive', 85]
    ]);
    const parNom = Object.fromEntries(BASSIN.map(f => [f.nom, f]));
    assert.equal(parNom['Ivan Demidov'].categorie, 'rookie', 'une recrue va chez les recrues');
    assert.equal(parNom['Jacob Fowler'].categorie, 'goalie', 'un gardien recrue reste devant le filet');
    assert.equal(parNom['Andrei Vasilevskiy'].valeur, 76, 'victoires × 2');
    assert.equal(parNom['Carolina Hurricanes'].categorie, 'teams');
    assert.deepEqual(choixAuto.bassinDepuisTrousse(null), []);
    assert.deepEqual(choixAuto.bassinDepuisTrousse({ skaters: [{ position: 'C' }, { fullName: 'Sans Projection', position: 'C' }] })
        .map(f => [f.nom, f.valeur]), [['Sans Projection', 0]], 'une fiche sans nom est écartée');
});

test('le meilleur libre, dans une catégorie ouverte ; un club seulement en dernier', () => {
    const tout = { offensive: true, defensive: true, rookie: true, goalie: true, teams: true };
    assert.deepEqual(choixAuto.meilleurChoix(BASSIN, { ouvertes: tout }), { nom: 'Connor McDavid', categorie: 'offensive' });

    // Pris sous un autre nom (ancienne écriture, accents) : toujours pris.
    const pris = ['connor mcdavid', 'Mitchell Marner'];
    assert.equal(choixAuto.meilleurChoix(BASSIN, { pris, ouvertes: tout }).nom, 'Cale Makar');
    assert.equal(choixAuto.meilleurChoix(BASSIN, { pris: ['Tim Stutzle'], ouvertes: { offensive: true } }).nom, 'Connor McDavid');
    assert.equal(choixAuto.meilleurChoix(BASSIN, { pris: ['Connor McDavid', 'Mitch Marner', 'Tim Stutzle'], ouvertes: { offensive: true } }), null);

    assert.equal(choixAuto.meilleurChoix(BASSIN, { ouvertes: { goalie: true, teams: true } }).nom, 'Andrei Vasilevskiy',
        'un club attend que les joueurs soient complets');
    assert.equal(choixAuto.meilleurChoix(BASSIN, { ouvertes: { teams: true } }).nom, 'Carolina Hurricanes');
    assert.equal(choixAuto.meilleurChoix(BASSIN, {}), null);
    assert.equal(choixAuto.meilleurChoix(null, { ouvertes: tout }), null);
});

test('les catégories ouvertes suivent les quotas, et le banc ne rouvre que les patineurs', () => {
    const pool = poolChronometre();
    pool.teams['Équipe 1'].offensive = ['X'];
    pool.teams['Équipe 1'].goalie = ['G'];
    assert.deepEqual(poolOps.categoriesOuvertes(pool, 'Équipe 1'),
        { offensive: false, defensive: true, rookie: true, goalie: false, teams: true });

    const h2h = poolChronometre({ poolMode: 'head-to-head', config: { ...CONFIG, numBench: 1 } });
    Object.assign(h2h.teams['Équipe 1'], { offensive: ['X'], defensive: ['Y'], rookie: ['Z'], goalie: ['G'], teams: ['T'] });
    assert.deepEqual(poolOps.categoriesOuvertes(h2h, 'Équipe 1'),
        { offensive: true, defensive: true, rookie: true, goalie: false, teams: false });
    assert.deepEqual(poolOps.categoriesOuvertes(h2h, 'Inconnue'),
        { offensive: true, defensive: true, rookie: true, goalie: true, teams: true });
});

test("à l'échéance, le meilleur disponible est pris pour l'équipe, marqué automatique", () => {
    const pool = poolChronometre();
    const r = poolOps.choisirAutomatiquement(pool, { bassin: BASSIN, pickIndex: 0, maintenant: MAINTENANT });
    assert.equal(r.ok, true);
    assert.equal(r.auto, true);
    assert.equal(r.teamName, 'Équipe 1');
    assert.equal(r.playerName, 'Connor McDavid');
    assert.equal(r.tourSuivant, 'Équipe 2');
    assert.deepEqual(pool.teams['Équipe 1'].offensive, ['Connor McDavid']);
    assert.equal(pool.picksHistory.at(-1).auto, true);
    assert.equal(pool.currentPickIndex, 1);
    assert.equal(pool.turnStartedAt, MAINTENANT, 'le tour suivant a ses trois minutes');

    // Au tour d'Équipe 2, McDavid est pris : c'est Marner.
    pool.turnStartedAt = MAINTENANT - LIMITE;
    assert.equal(poolOps.choisirAutomatiquement(pool, { bassin: BASSIN, maintenant: MAINTENANT }).playerName, 'Mitch Marner');
});

test("avant l'échéance, sur un tour déjà joué, ou sans chronomètre : rien", () => {
    const tot = poolChronometre({ ilYa: LIMITE - 1000 });
    const avant = poolOps.choisirAutomatiquement(tot, { bassin: BASSIN, maintenant: MAINTENANT });
    assert.equal(avant.ok, false);
    assert.equal(avant.echeance, MAINTENANT + 1000);
    assert.equal(tot.currentPickIndex, 0);

    const joue = poolChronometre();
    assert.match(poolOps.choisirAutomatiquement(joue, { bassin: BASSIN, pickIndex: 4, maintenant: MAINTENANT }).message, /déjà été joué/);

    const libre = poolChronometre();
    delete libre.pickTimeLimitMs;
    assert.equal(poolOps.choisirAutomatiquement(libre, { bassin: BASSIN, maintenant: MAINTENANT }).ok, false);

    const complet = poolChronometre({ config: { numOffensive: 1, numDefensive: 0, numGoalies: 0, numRookies: 0, numTeams: 0 } });
    complet.teams['Équipe 1'].offensive = ['A'];
    complet.teams['Équipe 2'].offensive = ['B'];
    assert.equal(poolOps.choisirAutomatiquement(complet, { bassin: BASSIN, maintenant: MAINTENANT }).ok, false,
        'un repêchage complet ne joue plus rien');
});

test("plus rien à prendre : le tour passe, et au dernier tour il est consommé", () => {
    const pool = poolChronometre({ config: { numOffensive: 2, numDefensive: 0, numGoalies: 0, numRookies: 0, numTeams: 0 } });
    const r = poolOps.choisirAutomatiquement(pool, { bassin: [], maintenant: MAINTENANT });
    assert.equal(r.ok, true);
    assert.equal(r.saute, 'Équipe 1');
    assert.equal(r.playerName, undefined);
    assert.equal(pool.currentPickIndex, 1);
    assert.equal(pool.turnStartedAt, MAINTENANT);
    assert.equal((pool.picksHistory || []).length, 0, 'un tour passé ne laisse pas de choix');

    pool.currentPickIndex = pool.draftOrder.length - 1;
    pool.turnStartedAt = MAINTENANT - LIMITE;
    const dernier = poolOps.choisirAutomatiquement(pool, { bassin: [], maintenant: MAINTENANT });
    assert.equal(dernier.ok, true);
    assert.equal(dernier.tourSuivant, null);
    assert.equal(poolOps.echeanceChoix(pool), null, 'le minuteur ne revient pas sur ce tour');
});

// ───────────────────────────── Notifications ─────────────────────────────

test("l'alerte de tour dit la limite, et le choix automatique se raconte", () => {
    const tour = evenements.presenter({ type: evenements.NOTIFICATION.VOTRE_TOUR, subject: { limiteMs: LIMITE } });
    assert.equal(tour.detail, 'Vous avez 3 minutes, sinon Fantazy choisira pour vous.');
    assert.equal(evenements.presenter({ type: evenements.NOTIFICATION.VOTRE_TOUR, subject: {} }).detail,
        'Les autres équipes attendent votre choix.');

    const auto = {
        type: evenements.NOTIFICATION.CHOIX_AUTO,
        poolName: 'Ligue',
        subject: { poolName: 'Ligue', player: 'Connor McDavid', pickIndex: 4 }
    };
    const vue = evenements.vueNotification(auto);
    assert.equal(vue.titre, 'Fantazy a choisi pour vous');
    assert.equal(vue.detail, 'Le temps était écoulé : Connor McDavid rejoint votre équipe.');
    assert.equal(vue.urgent, false);
    assert.equal(vue.href, 'draftActif.html?pool=Ligue');
    assert.equal(vue.id, 'autopick:Ligue:4');
    assert.match(evenements.presenter({ ...auto, subject: {} }).detail, /votre tour est passé/);
    assert.equal(evenements.clesNotification.choixAuto(7, 4), evenements.clesNotification.choixAuto(7, 4));
    assert.notEqual(evenements.clesNotification.choixAuto(7, 4), evenements.clesNotification.votreTour(7, 4));
});

// ───────────────────────────── La route ─────────────────────────────

function banc(pool) {
    return monterRoutes([routesRepechage], { pools: { Ligue: pool }, ctxExtra: { trousse: TROUSSE } });
}

test("le serveur joue le tour échu, prévient l'équipe, et passe la main avec sa limite", async () => {
    const h = banc(poolChronometre());
    const valeur = await h.ctx.choisirAutomatiquement('Ligue', { pickIndex: 0, maintenant: MAINTENANT });
    assert.deepEqual(valeur.fait, true);
    assert.equal(valeur.playerName, 'Connor McDavid');

    const pool = h.lirePool('Ligue');
    assert.deepEqual(pool.teams['Équipe 1'].offensive, ['Connor McDavid']);
    assert.equal(pool.currentPickIndex, 1);

    const alertes = type => h.etat.notifications.filter(n => n.type === type);
    assert.deepEqual(alertes('pick_auto').map(n => [n.recipientUserId, n.subject.player]), [['alice', 'Connor McDavid']]);
    assert.deepEqual(alertes('turn_current').map(n => [n.recipientUserId, n.subject.limiteMs]), [['bob', LIMITE]]);
    const choix = h.etat.activity.filter(a => a.type === 'pick');
    assert.equal(choix.length, 1);
    assert.equal(choix[0].subject.auto, true);
    assert.equal(choix[0].actorUserId, null);
    assert.ok(h.etat.emissions.some(([evenement]) => evenement === 'poolMisAJour'));

    // Le même réveil, rejoué : le tour est joué, rien ne bouge.
    const revision = h.revisionDe('Ligue');
    const encore = await h.ctx.choisirAutomatiquement('Ligue', { pickIndex: 0, maintenant: MAINTENANT });
    assert.equal(encore.fait, false);
    assert.equal(h.revisionDe('Ligue'), revision, 'rien de réécrit');
    assert.equal(alertes('pick_auto').length, 1);
});

test("un réveil en avance n'écrit rien", async () => {
    const h = banc(poolChronometre({ ilYa: 1000 }));
    const revision = h.revisionDe('Ligue');
    const valeur = await h.ctx.choisirAutomatiquement('Ligue', { pickIndex: 0, maintenant: MAINTENANT });
    assert.equal(valeur.fait, false);
    assert.equal(valeur.echeance, MAINTENANT - 1000 + LIMITE);
    assert.equal(h.revisionDe('Ligue'), revision);
    assert.equal(h.etat.notifications.length, 0);
});

test('le dernier choix automatique termine le repêchage comme un autre', async () => {
    const config = { numOffensive: 1, numDefensive: 0, numGoalies: 0, numRookies: 0, numTeams: 0 };
    const pool = poolChronometre({ config });
    const h = banc(pool);
    await h.ctx.choisirAutomatiquement('Ligue', { maintenant: MAINTENANT });
    const apres = await h.ctx.choisirAutomatiquement('Ligue', { maintenant: MAINTENANT + LIMITE });
    assert.equal(apres.draftComplet, true);
    assert.ok(h.etat.activity.some(a => a.type === 'draft_complete'));
    assert.ok(h.etat.emissions.some(([evenement]) => evenement === 'draftComplete'));
});

test('un choix fait à temps reste le choix de la personne, et le minuteur arrive trop tard', async () => {
    const h = banc(poolChronometre({ ilYa: LIMITE - 5000 }));
    const res = await h.appeler('POST', '/pick-player', {
        auth: ALICE, body: { clanName: 'Ligue', playerName: 'Cale Makar', position: 'defensive', expectedPickIndex: 0 }
    });
    assert.equal(res.statusCode, 200);
    const valeur = await h.ctx.choisirAutomatiquement('Ligue', { pickIndex: 0, maintenant: MAINTENANT });
    assert.equal(valeur.fait, false);
    assert.deepEqual(h.lirePool('Ligue').teams['Équipe 1'].defensive, ['Cale Makar']);
    assert.equal(h.etat.notifications.filter(n => n.type === 'pick_auto').length, 0);
    assert.equal(h.etat.notifications.find(n => n.type === 'turn_current').subject.limiteMs, LIMITE);
});

test('/skip-turn refuse un repêchage chronométré, même à la personne qui a créé le pool', async () => {
    const pool = poolChronometre({ ilYa: 10 * 60 * 1000 });
    pool.currentPickIndex = 1; // au tour de bob : alice pourrait le sauter sans chronomètre
    pool.lastPickIndex = 0;
    const h = banc(pool);
    const refus = await h.appeler('POST', '/skip-turn', { auth: ALICE, body: { clanName: 'Ligue' } });
    assert.equal(refus.statusCode, 409);
    assert.match(refus.body.message, /chronométré/);
    assert.equal(h.lirePool('Ligue').currentPickIndex, 1);
});

test('la lecture de rattrapage ne sort que les tours chronométrés en attente', async () => {
    const enCours = poolChronometre();
    const fini = poolChronometre();
    fini.lastPickIndex = fini.currentPickIndex = fini.draftOrder.length - 1;
    const libre = poolNeuf({ membres: { 'Équipe 1': ['alice'], 'Équipe 2': ['bob'] } });
    poolOps.demarrerRepechage(libre);
    const h = monterRoutes([routesRepechage], { pools: { EnCours: enCours, Fini: fini, Libre: libre } });

    const lus = await h.store.lireChoixChronometres();
    assert.deepEqual(Object.keys(lus), ['EnCours']);
    assert.deepEqual(lus.EnCours, {
        pickTimeLimitMs: LIMITE, turnStartedAt: MAINTENANT - LIMITE,
        currentPickIndex: 0, lastPickIndex: -1, draftLength: enCours.draftOrder.length
    });
});

// ───────────────────────────── Le minuteur ─────────────────────────────

function fausseMinuterie() {
    const poses = [];
    return {
        poses,
        planifier(fn, delai) { const p = { fn, delai, annule: false }; poses.push(p); return p; },
        annuler(p) { if (p) p.annule = true; }
    };
}

test('le réveil se pose sur l’échéance, une seule fois, et tombe quand le tour est joué', async () => {
    const minuterie = fausseMinuterie();
    const appels = [];
    const m = creerMinuteurChoix({
        choisir: async (nom, options) => { appels.push([nom, options]); return { fait: true }; },
        lireEnCours: async () => ({}),
        horloge: () => MAINTENANT,
        minuterie
    });

    const pool = poolChronometre({ ilYa: 60 * 1000 });
    assert.equal(m.armer('Ligue', pool), MAINTENANT + 2 * 60 * 1000);
    assert.equal(minuterie.poses.length, 1);
    assert.equal(minuterie.poses[0].delai, 2 * 60 * 1000 + MARGE_MS);

    m.armer('Ligue', pool);
    assert.equal(minuterie.poses.length, 1, 'la même échéance ne réarme rien');

    m.armer('Ligue', { ...pool, currentPickIndex: 1, turnStartedAt: MAINTENANT });
    assert.equal(minuterie.poses[0].annule, true, 'le tour a changé : l’ancien réveil tombe');
    assert.deepEqual(m.etat(), { Ligue: { echeance: MAINTENANT + LIMITE, pickIndex: 1 } });

    await minuterie.poses[1].fn();
    assert.deepEqual(appels, [['Ligue', { pickIndex: 1 }]]);
    assert.deepEqual(m.etat(), {}, 'un réveil tiré est oublié');

    m.armer('Ligue', pool);
    assert.equal(m.armer('Ligue', { ...pool, pickTimeLimitMs: undefined }), null);
    assert.deepEqual(m.etat(), {}, 'plus de limite, plus de réveil');
    assert.equal(m.armer('Autre', null), null);
});

test('une échéance déjà passée se joue tout de suite ; une erreur attend le rattrapage', async () => {
    const minuterie = fausseMinuterie();
    const erreurs = [];
    const m = creerMinuteurChoix({
        choisir: async () => { throw new Error('base indisponible'); },
        lireEnCours: async () => ({ Ligue: { pickTimeLimitMs: LIMITE, turnStartedAt: MAINTENANT - 10 * LIMITE, currentPickIndex: 2, lastPickIndex: 1, draftLength: 8 } }),
        logger: { error: (...args) => erreurs.push(args.join(' ')) },
        horloge: () => MAINTENANT,
        minuterie
    });

    assert.equal(await m.rattraper(), 1);
    assert.equal(minuterie.poses[0].delai, MARGE_MS);
    await minuterie.poses[0].fn();
    assert.equal(erreurs.length, 1);
    assert.match(erreurs[0], /base indisponible/);

    assert.equal(await m.rattraper(), 1, 'le passage suivant réarme le tour');
    m.arreter();
    assert.deepEqual(m.etat(), {});
    assert.equal(minuterie.poses[1].annule, true);
});

test('les vrais minuteurs ne retiennent pas le processus', () => {
    const m = creerMinuteurChoix({ choisir: async () => ({}), lireEnCours: async () => ({}) });
    m.armer('Ligue', poolChronometre({ ilYa: 0 }));
    assert.equal(Object.keys(m.etat()).length, 1);
    m.arreter();
});

// ─────────────────── Le même joueur que « Ton choix probable » ───────────────────

const H = chargerFonctions('accueil-draft-hero.js',
    ['fzhHeroPris', 'fzhHeroOuvertes', 'fzhHeroCode', 'fzhHeroCategorie', 'fzhHeroCandidats', 'fzhHeroDetail', 'FZH_HERO_POS'],
    {});

async function poolsDeLaTrousse() {
    const trousse = JSON.parse(fs.readFileSync(path.join(__dirname, '../../draftkit.json'), 'utf8'));
    const avant = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => trousse });
    try {
        delete require.cache[require.resolve('../../draftkitData.js')];
        const kit = require('../../draftkitData.js');
        await kit.charger();
        return { trousse, pools: kit.pools('projection') };
    } finally {
        globalThis.fetch = avant;
    }
}

for (const [nom, options] of [
    ['cumulatif, quotas par défaut', { config: poolOps.CONFIG_PAR_DEFAUT }],
    ['tête-à-tête avec banc', { poolMode: 'head-to-head', config: { ...poolOps.CONFIG_PAR_DEFAUT, numBench: 2 } }]
]) {
    test(`tout un repêchage automatique suit « Ton choix probable » (${nom})`, async () => {
        const { trousse, pools } = await poolsDeLaTrousse();
        const bassin = choixAuto.bassinDepuisTrousse(trousse);
        const pool = poolNeuf({
            membres: { 'Équipe 1': ['alice'], 'Équipe 2': ['bob'], 'Équipe 3': ['carl'], 'Équipe 4': ['dora'] },
            ...options
        });
        pool.draftScheduledAt = new Date(MAINTENANT).toISOString();
        poolOps.demarrerRepechage(pool);
        pool.turnStartedAt = MAINTENANT;

        let instant = MAINTENANT;
        while (poolOps.echeanceChoix(pool) != null) {
            const equipe = pool.draftOrder[pool.currentPickIndex];
            const [probable] = H.fzhHeroCandidats({ pools, poolData: pool, teamName: equipe, quotaBanc: lineup.quotaBanc(pool), nombre: 1 });
            instant += LIMITE;
            const r = poolOps.choisirAutomatiquement(pool, { bassin, maintenant: instant });
            assert.equal(r.ok, true);
            assert.equal(r.playerName, probable.nom, `choix ${r.pickIndex + 1} (${equipe})`);
            assert.equal(r.position, probable.categorie);
        }
        assert.equal(pool.picksHistory.length, pool.draftOrder.length);
        assert.equal(require('../../lib/draft.js').checkIfDraftComplete(pool), true, 'chaque équipe est complète');
    });
}

test('les noms rapprochés sont les mêmes que dans la salle', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../draftkitData.js'), 'utf8');
    const bloc = source.match(/var ALIAS = \{([\s\S]*?)\};/);
    assert.ok(bloc, 'ALIAS introuvable dans draftkitData.js');
    const alias = Object.fromEntries([...bloc[1].matchAll(/'([^']+)':\s*'([^']+)'/g)].map(m => [m[1], m[2]]));
    assert.deepEqual(alias, choixAuto.ALIAS);
});
