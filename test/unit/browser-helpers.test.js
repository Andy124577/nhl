'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { buildHeadshotUrl, resolveHeadshotByName, HEADSHOT_SEASON } = require('../../headshots.js');
const colors = require('../../teamColors.js');
const inj = require('../../injuries.js');
const FZDraftKit = require('../../draftkitData.js');
const { chargerFonctions } = require('../fixtures/helpers.js');

describe('headshots — buildHeadshotUrl', () => {
    test('la saison du CDN est bien celle en cours', () => {
        // Vérifiée à part, en clair : l'URL attendue ci-dessous l'écrit en dur
        // plutôt que d'interpoler la constante du module testé, sans quoi une
        // saison erronée s'écrirait des deux côtés et le test passerait.
        assert.equal(HEADSHOT_SEASON, '20252026');
    });

    test('pointe vers le CDN de la LNH, pas vers une copie locale', () => {
        // Les photos ne sont pas hébergées ni redistribuées : voir LICENSE.
        assert.equal(
            buildHeadshotUrl(8480018, 'MTL'),
            'https://assets.nhle.com/mugs/nhl/20252026/MTL/8480018.png'
        );
    });

    test('sans identifiant, il n\'y a pas d\'URL', () => {
        assert.equal(buildHeadshotUrl(null, 'MTL'), null);
        assert.equal(buildHeadshotUrl(undefined, 'MTL'), null);
        assert.equal(buildHeadshotUrl(0, 'MTL'), null);
    });

    test('sans équipe, on retombe sur la photo « latest »', () => {
        assert.equal(buildHeadshotUrl(8480018), 'https://assets.web.nhl.com/mugs/nhl/latest/8480018.png');
        assert.equal(buildHeadshotUrl(8480018, ''), 'https://assets.web.nhl.com/mugs/nhl/latest/8480018.png');
    });

    test('une chaîne « null » n\'est pas une équipe', () => {
        // teamAbbrevs vaut littéralement « null » dans certaines fiches.
        assert.equal(buildHeadshotUrl(8480018, 'null'), 'https://assets.web.nhl.com/mugs/nhl/latest/8480018.png');
    });

    test('sur un historique de clubs, c\'est le dernier qui compte', () => {
        assert.match(buildHeadshotUrl(8480018, 'TOR,MTL'), /\/MTL\/8480018\.png$/);
    });
});

describe('headshots — resolveHeadshotByName', () => {
    // Les globales que la page fournit ; en Node, ce sont celles du module.
    afterEach(() => {
        delete global.currentStats;
        delete global.fullPlayerData;
        delete global.goalieData;
        delete global.window;
    });

    test('sans aucun jeu de données chargé, rend null', () => {
        assert.equal(resolveHeadshotByName('Nick Suzuki'), null);
    });

    test('sans nom, rend null', () => {
        assert.equal(resolveHeadshotByName(''), null);
        assert.equal(resolveHeadshotByName(null), null);
    });

    test('prend la photo fournie par les statistiques courantes', () => {
        global.currentStats = {
            players: [{ playerName: 'Nick Suzuki', playerId: 8480018, teamAbbrev: 'MTL', headshot: 'https://cdn/x.png' }]
        };

        assert.equal(resolveHeadshotByName('nick suzuki'), 'https://cdn/x.png');
    });

    test('une photo de logo d\'équipe est refusée au profit du CDN', () => {
        // Certaines lignes portent le logo du club en guise de portrait ; le
        // garde vise le segment « /teams/ » de l'URL.
        global.currentStats = {
            players: [{ playerName: 'Nick Suzuki', playerId: 8480018, teamAbbrev: 'MTL', headshot: 'https://x/teams/MTL.png' }]
        };

        assert.match(resolveHeadshotByName('Nick Suzuki'), /assets\.nhle\.com/);
    });

    test('un identifiant connu comme erroné est écarté', () => {
        // Certaines lignes de statistiques portent l'identifiant d'un autre
        // joueur — « Matt Savoie » y désigne un retraité.
        global.window = { FZ_IDS_ERRONES: [8480018] };
        global.currentStats = {
            players: [{ playerName: 'Nick Suzuki', playerId: 8480018, teamAbbrev: 'MTL', headshot: 'https://cdn/x.png' }]
        };

        assert.equal(resolveHeadshotByName('Nick Suzuki'), null);
    });

    test('retombe sur les patineurs puis sur les gardiens', () => {
        global.fullPlayerData = [{ skaterFullName: 'Cole Caufield', playerId: 8481540, teamAbbrevs: 'MTL' }];
        global.goalieData = [{ goalieFullName: 'Sam Montembeault', playerId: 8478470, teamAbbrev: 'MTL' }];

        assert.match(resolveHeadshotByName('Cole Caufield'), /8481540\.png$/);
        assert.match(resolveHeadshotByName('Sam Montembeault'), /8478470\.png$/);
    });

    test('un joueur inconnu rend null', () => {
        global.fullPlayerData = [{ skaterFullName: 'Cole Caufield', playerId: 8481540 }];

        assert.equal(resolveHeadshotByName('Personne'), null);
    });
});

describe('teamColors', () => {
    test('chaque club porte une paire de couleurs hexadécimales', () => {
        for (const [code, paire] of Object.entries(colors.NHL_TEAM_COLORS)) {
            assert.equal(paire.length, 2, `${code} n'a pas deux couleurs`);
            for (const c of paire) assert.match(c, /^#[0-9A-Fa-f]{6}$/, `${code} : ${c}`);
        }
    });

    test('les 32 clubs actuels sont présents', () => {
        const actuels = ['ANA', 'BOS', 'BUF', 'CAR', 'CBJ', 'CGY', 'CHI', 'COL', 'DAL', 'DET',
            'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NJD', 'NSH', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT',
            'SEA', 'SJS', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WPG', 'WSH'];

        for (const code of actuels) {
            assert.ok(colors.NHL_TEAM_COLORS[code], `${code} manquant`);
        }
    });

    test('getTeamColors rend toujours une paire, même sans équipe', () => {
        assert.deepEqual(colors.getTeamColors(''), colors.NHL_TEAM_COLORS_FALLBACK);
        assert.deepEqual(colors.getTeamColors(null), colors.NHL_TEAM_COLORS_FALLBACK);
        assert.deepEqual(colors.getTeamColors('XXX'), colors.NHL_TEAM_COLORS_FALLBACK);
    });

    test('getTeamColors tolère la casse et les espaces', () => {
        assert.deepEqual(colors.getTeamColors(' mtl '), colors.NHL_TEAM_COLORS.MTL);
    });

    test('hexLuminance : le blanc vaut 1, le noir 0', () => {
        assert.equal(colors.hexLuminance('#ffffff'), 1);
        assert.equal(colors.hexLuminance('#000000'), 0);
    });

    test('hexLuminance : la forme à trois chiffres est développée', () => {
        assert.equal(colors.hexLuminance('#fff'), colors.hexLuminance('#ffffff'));
        assert.equal(colors.hexLuminance('#000'), 0);
    });

    test('hexLuminance : une valeur illisible vaut 0', () => {
        assert.equal(colors.hexLuminance('pas une couleur'), 0);
        assert.equal(colors.hexLuminance(''), 0);
    });

    test('hexLuminance suit la courbe sRGB, pas une simple proportion', () => {
        // Un gris moyen (#808080) est à 50 % du canal mais bien en dessous de
        // 50 % de luminance : c'est le coude de la formule WCAG. Sans lui, le
        // choix « texte clair ou sombre » serait faux sur la moitié des clubs.
        const gris = colors.hexLuminance('#808080');

        assert.ok(gris > 0.2 && gris < 0.25, `attendu ~0,216 — obtenu ${gris}`);
    });

    test('hexLuminance sépare l\'or de Nashville du bleu de Toronto', () => {
        assert.ok(colors.hexLuminance(colors.NHL_TEAM_COLORS.NSH[0])
            > colors.hexLuminance(colors.NHL_TEAM_COLORS.TOR[0]));
    });

    test('shadeHex éclaircit et assombrit', () => {
        assert.equal(colors.shadeHex('#808080', 1), '#ffffff');
        assert.equal(colors.shadeHex('#808080', -1), '#000000');
        assert.equal(colors.shadeHex('#808080', 0), '#808080');
    });

    test('shadeHex rend la couleur d\'origine si elle est illisible', () => {
        // « zzz » et non « bidon » : les lettres a-f d'une chaîne quelconque
        // se lisent comme de l'hexadécimal, et parseInt('bidon', 16) rend 11.
        // Le garde ne se déclenche que sur un NaN franc.
        assert.equal(colors.shadeHex('zzz', 0.5), 'zzz');
        assert.equal(colors.mixHex('zzz', '#ffffff', 0.5), 'zzz');
    });

    test('mixHex : 0 rend la première couleur, 1 la seconde', () => {
        assert.equal(colors.mixHex('#000000', '#ffffff', 0), '#000000');
        assert.equal(colors.mixHex('#000000', '#ffffff', 1), '#ffffff');
        assert.equal(colors.mixHex('#000000', '#ffffff', 0.5), '#808080');
    });

    test('mixHex borne le ratio à [0, 1]', () => {
        assert.equal(colors.mixHex('#000000', '#ffffff', 5), '#ffffff');
        assert.equal(colors.mixHex('#000000', '#ffffff', -5), '#000000');
    });
});

describe('injuries — normalisation des noms', () => {
    test('DÉFAUT — un accent laisse une espace au milieu du nom', () => {
        // Comportement ACTUEL, verrouillé parce qu'il est faux.
        //
        // NFD sépare « é » en « e » + accent combinant, puis /[^a-z]+/ remplace
        // l'accent par une ESPACE au lieu de le supprimer. « Bédard » devient
        // donc « be dard » et non « bedard ». Le commentaire de source dit que
        // le filtre « garde la lettre » : il la garde, mais il coupe le mot.
        //
        // Conséquence, couverte par le test de getPlayerInjury plus bas : un
        // joueur dont le nom est accentué d'un côté et pas de l'autre n'est
        // jamais rapproché, ni par la clé exacte ni par la clé approximative.
        //
        // Correctif d'une ligne, le même que nameKey() et profanity.js :
        //     .replace(/[̀-ͯ]/g, '')   avant le filtre [^a-z]
        // Quand il sera appliqué, c'est ce test qui doit changer.
        assert.equal(inj.injNormalizeName('Connor Bédard'), 'connor be dard');
        assert.equal(inj.injNormalizeName('Connor Bedard'), 'connor bedard');
    });

    test('les suffixes de génération sont écartés', () => {
        assert.equal(inj.injNormalizeName('Trevor Zegras Jr'), 'trevor zegras');
        assert.equal(inj.injNormalizeName('Joueur III'), 'joueur');
    });

    test('la ponctuation devient une espace', () => {
        assert.equal(inj.injNormalizeName("K'Andre Miller"), 'k andre miller');
    });

    test('une valeur vide rend une chaîne vide', () => {
        assert.equal(inj.injNormalizeName(null), '');
        assert.equal(inj.injNormalizeName(''), '');
    });

    test('la clé approximative est « famille|initiale »', () => {
        // C'est ce qui rattrape Alex/Alexander Wennberg.
        assert.equal(inj.injLooseKey('alexander wennberg'), 'wennberg|a');
        assert.equal(inj.injLooseKey('alex wennberg'), 'wennberg|a');
    });

    test('un nom d\'un seul mot n\'a pas de clé approximative', () => {
        assert.equal(inj.injLooseKey('wennberg'), null);
        assert.equal(inj.injLooseKey(''), null);
    });

    test('injTeamCode ne garde que le club actuel', () => {
        assert.equal(inj.injTeamCode('TOR,MTL'), 'MTL');
        assert.equal(inj.injTeamCode(' mtl '), 'MTL');
    });

    test('injTeamCode traite « null » et « N/A » comme absents', () => {
        assert.equal(inj.injTeamCode('null'), '');
        assert.equal(inj.injTeamCode('N/A'), '');
        assert.equal(inj.injTeamCode(null), '');
    });
});

describe('injuries — getPlayerInjury', () => {
    const BLESSURE = { playerName: 'Nick Suzuki', team: 'MTL', status: 'Out', type: 'Knee' };

    beforeEach(() => {
        inj.injState.ready = false;
        inj.injState.byName.clear();
        inj.injState.byLoose.clear();
    });

    test('tant que les données ne sont pas là, rend null', () => {
        assert.equal(inj.getPlayerInjury('Nick Suzuki', 'MTL'), null);
    });

    test('trouve un joueur par son nom exact', () => {
        inj.injIndex({ injuries: [BLESSURE] });

        assert.equal(inj.getPlayerInjury('Nick Suzuki', 'MTL'), BLESSURE);
    });

    test('le nom est comparé après normalisation', () => {
        // Casse et ponctuation sont bien absorbées des deux côtés.
        inj.injIndex({ injuries: [{ ...BLESSURE, playerName: "K'ANDRE MILLER", team: 'NYR' }] });

        assert.ok(inj.getPlayerInjury('K\'Andre Miller', 'NYR'));
    });

    test('DÉFAUT — un nom accentué d\'un seul côté n\'est jamais rapproché', () => {
        // La conséquence directe du défaut de injNormalizeName ci-dessus.
        // Le flux d'ESPN écrit les noms sans accent, nos tableaux avec :
        // aucune pastille de blessure ne s'affiche pour ces joueurs-là.
        //   clé exacte        : « connor bedard » ≠ « connor be dard »
        //   clé approximative : « bedard|c »      ≠ « dard|c »
        // Ce test passe au VERT aujourd'hui parce qu'il constate l'échec ; il
        // doit être retourné en même temps que le correctif.
        inj.injIndex({ injuries: [{ playerName: 'Connor Bedard', team: 'CHI' }] });
        assert.equal(inj.getPlayerInjury('Connor Bédard', 'CHI'), null);

        inj.injIndex({ injuries: [{ playerName: 'Connor Bédard', team: 'CHI' }] });
        assert.equal(inj.getPlayerInjury('Connor Bedard', 'CHI'), null);
    });

    test('sans accent des deux côtés, le rapprochement fonctionne', () => {
        inj.injIndex({ injuries: [{ playerName: 'Connor Bedard', team: 'CHI' }] });

        assert.ok(inj.getPlayerInjury('Connor Bedard', 'CHI'));
    });

    test('un diminutif passe par la clé approximative, si l\'équipe concorde', () => {
        inj.injIndex({ injuries: [{ playerName: 'Alexander Wennberg', team: 'SJS' }] });

        assert.ok(inj.getPlayerInjury('Alex Wennberg', 'SJS'));
    });

    test('sans nom, rend null', () => {
        inj.injIndex({ injuries: [BLESSURE] });

        assert.equal(inj.getPlayerInjury('', 'MTL'), null);
        assert.equal(inj.getPlayerInjury(null, 'MTL'), null);
    });

    test('sur la clé approximative, une équipe qui ne concorde PAS ne donne rien', () => {
        // Le cas « Jake Martin / Josh Martin » du commentaire de source : sans
        // ce garde-fou, la blessure de l'un s'afficherait sur l'autre.
        inj.injIndex({ injuries: [{ playerName: 'Jake Martin', team: 'BOS' }] });

        assert.equal(inj.getPlayerInjury('Josh Martin', 'MTL'), null);
    });

    test('sur la clé approximative, sans code d\'équipe, rien non plus', () => {
        inj.injIndex({ injuries: [{ playerName: 'Jake Martin', team: 'BOS' }] });

        assert.equal(inj.getPlayerInjury('Josh Martin'), null);
    });

    test('deux homonymes exacts sont départagés par l\'équipe', () => {
        const a = { playerName: 'Sebastian Aho', team: 'CAR' };
        const b = { playerName: 'Sebastian Aho', team: 'NYI' };
        inj.injIndex({ injuries: [a, b] });

        assert.equal(inj.getPlayerInjury('Sebastian Aho', 'CAR'), a);
        assert.equal(inj.getPlayerInjury('Sebastian Aho', 'NYI'), b);
    });

    test('deux homonymes exacts sans équipe ne donnent rien', () => {
        inj.injIndex({ injuries: [{ playerName: 'Sebastian Aho', team: 'CAR' }, { playerName: 'Sebastian Aho', team: 'NYI' }] });

        assert.equal(inj.getPlayerInjury('Sebastian Aho'), null);
    });

    test('un joueur en bonne santé n\'a pas de blessure', () => {
        inj.injIndex({ injuries: [BLESSURE] });

        assert.equal(inj.getPlayerInjury('Cole Caufield', 'MTL'), null);
    });

    test('une charge vide laisse l\'index prêt mais désert', () => {
        inj.injIndex(null);

        assert.equal(inj.injState.ready, true);
        assert.equal(inj.getPlayerInjury('Nick Suzuki', 'MTL'), null);
    });
});

describe('draftkitData — FZDraftKit', () => {
    test('expose son interface publique', () => {
        for (const cle of ['charger', 'pools', 'nomCanonique', 'guide', 'watchlist', 'attacherIds']) {
            assert.equal(typeof FZDraftKit[cle], 'function', `${cle} manquant`);
        }
    });

    test('sans trousse chargée, nomCanonique rend le nom inchangé', () => {
        // La page de repêchage appelle nomCanonique avant que draftkit.json
        // soit revenu : elle ne doit rien casser d'ici là.
        assert.equal(FZDraftKit.nomCanonique('Nick Suzuki'), 'Nick Suzuki');
        assert.equal(FZDraftKit.nomCanonique(''), '');
    });

    test('sans trousse chargée, guide et watchlist sont vides', () => {
        assert.equal(FZDraftKit.guide('MTL'), null);
        assert.deepEqual(FZDraftKit.watchlist(), []);
        assert.equal(FZDraftKit.donnees, null);
        assert.equal(FZDraftKit.saison, null);
    });

    test('pools rend des listes vides tant que rien n\'est chargé', () => {
        const p = FZDraftKit.pools();

        assert.deepEqual(p.skaters, []);
        assert.deepEqual(p.goalies, []);
        assert.deepEqual(p.teams, []);
    });
});

// ── Scripts de page : fonctions découpées dans la source ────────────────────
// Voir test/fixtures/helpers.js pour le pourquoi de ce chargement.

describe('classement — helpers de tableau', () => {
    const { rankByPeriodPoints, fmtPeriodPts, initialsFromName, formatHofDate, formatHofMonth } =
        chargerFonctions('classement.js',
            ['rankByPeriodPoints', 'fmtPeriodPts', 'initialsFromName', 'formatHofDate', 'formatHofMonth']);

    test('rankByPeriodPoints numérote de 1 à n, du plus fort au plus faible', () => {
        const standings = [{ teamName: 'A' }, { teamName: 'B' }, { teamName: 'C' }];
        const points = new Map([['A', 10], ['B', 50], ['C', 30]]);

        const rangs = rankByPeriodPoints(standings, points);

        assert.equal(rangs.get('B'), 1);
        assert.equal(rangs.get('C'), 2);
        assert.equal(rangs.get('A'), 3);
    });

    test('une équipe sans points de période est classée dernière', () => {
        const standings = [{ teamName: 'Sans' }, { teamName: 'Avec' }];
        const points = new Map([['Avec', 5]]);

        const rangs = rankByPeriodPoints(standings, points);

        assert.equal(rangs.get('Avec'), 1);
        assert.equal(rangs.get('Sans'), 2);
    });

    test('un classement vide rend une table vide', () => {
        assert.equal(rankByPeriodPoints([], new Map()).size, 0);
    });

    test('fmtPeriodPts : rien à afficher devient un tiret cadratin', () => {
        assert.equal(fmtPeriodPts(null), '—');
        assert.equal(fmtPeriodPts(undefined), '—');
    });

    test('fmtPeriodPts : un entier s\'affiche nu, un décimal à une décimale', () => {
        assert.equal(fmtPeriodPts(12), '12');
        assert.equal(fmtPeriodPts(12.34), '12.3');
        assert.equal(fmtPeriodPts(0), '0');
    });

    test('initialsFromName : deux mots donnent deux initiales', () => {
        assert.equal(initialsFromName('Nick Suzuki'), 'NS');
        assert.equal(initialsFromName('  cole   caufield '), 'CC');
    });

    test('initialsFromName : un seul mot donne ses deux premières lettres', () => {
        assert.equal(initialsFromName('Rouge'), 'RO');
    });

    test('initialsFromName : les symboles sont retirés, les accents gardés', () => {
        assert.equal(initialsFromName('Éric'), 'ÉR');
        assert.equal(initialsFromName('!!!'), '');
        assert.equal(initialsFromName(''), '');
    });

    test('formatHofDate rend un jour et un mois abrégé en français', () => {
        assert.equal(formatHofDate('2026-01-15'), '15 janv.');
        assert.equal(formatHofDate(''), '');
    });

    test('formatHofMonth rend le mois en toutes lettres, capitalisé', () => {
        assert.equal(formatHofMonth('2026-01-15'), 'Janvier');
        assert.equal(formatHofMonth(''), '');
    });

    test('les dates du panthéon sont lues en UTC', () => {
        // Sans timeZone: 'UTC', un 1er du mois basculerait au dernier jour du
        // mois précédent pour un lecteur à l'ouest de Greenwich.
        assert.equal(formatHofDate('2026-03-01'), '1 mars');
    });
});

describe('statsLeaders — escapeHTML', () => {
    const { escapeHTML } = chargerFonctions('statsLeaders.js', ['escapeHTML']);

    test('neutralise une charge de script', () => {
        assert.equal(escapeHTML('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    test('échappe les cinq caractères dangereux', () => {
        assert.equal(escapeHTML('&'), '&amp;');
        assert.equal(escapeHTML('<'), '&lt;');
        assert.equal(escapeHTML('>'), '&gt;');
        assert.equal(escapeHTML('"'), '&quot;');
        assert.equal(escapeHTML("'"), '&#39;');
    });

    test('laisse un texte ordinaire intact', () => {
        assert.equal(escapeHTML('Nick Suzuki'), 'Nick Suzuki');
    });

    test('une valeur absente devient une chaîne vide', () => {
        assert.equal(escapeHTML(null), '');
        assert.equal(escapeHTML(undefined), '');
    });
});

describe('statsTopPlayers — topPlayersRangeText', () => {
    const { topPlayersRangeText } = chargerFonctions('statsTopPlayers.js',
        ['TOP_PLAYERS_SIX_MONTHS_DAYS', 'topPlayersRangeText']);

    test('les périodes courtes s\'expriment en jours', () => {
        assert.equal(topPlayersRangeText(7), '7 derniers jours');
        assert.equal(topPlayersRangeText(30), '30 derniers jours');
    });

    test('180 jours s\'expriment en mois', () => {
        assert.equal(topPlayersRangeText(180), '6 derniers mois');
    });
});

describe('trade — catégories', () => {
    const { getCategory, getCategoryLabel, getCategoryType } =
        chargerFonctions('trade.js', ['getCategory', 'getCategoryLabel', 'getCategoryType']);

    test('les cinq types font l\'aller-retour type → catégorie → type', () => {
        for (const type of ['offensive', 'defensive', 'goalie', 'rookie', 'team']) {
            assert.equal(getCategoryType(getCategory(type)), type, type);
        }
    });

    test('chaque catégorie porte son libellé court', () => {
        assert.equal(getCategoryLabel('F'), 'ATT');
        assert.equal(getCategoryLabel('D'), 'DÉF');
        assert.equal(getCategoryLabel('G'), 'GAR');
        assert.equal(getCategoryLabel('R'), 'ROO');
        assert.equal(getCategoryLabel('T'), 'ÉQU');
    });

    test('un type inconnu retombe sur les attaquants', () => {
        assert.equal(getCategory('mascotte'), 'F');
        assert.equal(getCategoryType('Z'), 'offensive');
    });

    test('un libellé inconnu traverse tel quel', () => {
        assert.equal(getCategoryLabel('Z'), 'Z');
    });
});

describe('navbar — getCurrentPage', () => {
    const page = chemin => chargerFonctions('navbar.js', ['getCurrentPage'],
        { window: { location: { pathname: chemin } } }).getCurrentPage();

    test('reconnaît chaque page principale', () => {
        assert.equal(page('/index.html'), 'accueil');
        assert.equal(page('/stats.html'), 'stats');
        assert.equal(page('/classement.html'), 'classement');
        assert.equal(page('/trade.html'), 'trade');
    });

    test('la racine est la page d\'accueil', () => {
        assert.equal(page('/'), 'accueil');
    });

    test('toutes les étapes du repêchage partagent le même onglet', () => {
        for (const p of ['/repechage.html', '/draft.html', '/draftActif.html', '/draftFini.html']) {
            assert.equal(page(p), 'repechage', p);
        }
    });

    test('une page sans onglet rend une chaîne vide', () => {
        assert.equal(page('/conditions.html'), '');
    });
});
