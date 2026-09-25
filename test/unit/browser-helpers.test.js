'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { buildHeadshotUrl, resolveHeadshotByName, headshotSeason } = require('../../headshots.js');
const { seasonIdForDate } = require('../../lib/season.js');
const colors = require('../../teamColors.js');
const inj = require('../../injuries.js');
const FZDraftKit = require('../../draftkitData.js');
const { chargerFonctions } = require('../fixtures/helpers.js');

describe('headshots — buildHeadshotUrl', () => {
    test("la saison du CDN suit la date, elle n'est plus figée", () => {
        // Elle valait 20252026 en dur : passé le 1er juillet suivant, toutes
        // les pages pointaient vers un répertoire périmé du CDN. La règle est
        // réécrite ici plutôt qu'importée du module testé, sinon une règle
        // fausse s'écrirait des deux côtés et le test passerait quand même.
        const maintenant = new Date();
        const an = maintenant.getUTCFullYear();
        const ouverture = (maintenant.getUTCMonth() + 1) >= 7 ? an : an - 1;
        assert.equal(headshotSeason(), `${ouverture}${ouverture + 1}`);
    });

    test('pointe vers le CDN de la LNH, pas vers une copie locale', () => {
        // Les photos ne sont pas hébergées ni redistribuées : voir LICENSE.
        assert.equal(
            buildHeadshotUrl(8480018, 'MTL'),
            `https://assets.nhle.com/mugs/nhl/${seasonIdForDate(new Date())}/MTL/8480018.png`
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

    test('teamBannerTokens : chaque club porte du blanc sur sa surface, avec un filet net', () => {
        for (const code of Object.keys(colors.NHL_TEAM_COLORS)) {
            const t = colors.teamBannerTokens(code);
            assert.ok(colors.hexLuminance(t.surface) <= 0.14, `${code} : surface trop claire (${t.surface})`);
            assert.ok(colors.hexLuminance(t.edge) >= 0.23, `${code} : filet trop sombre (${t.edge})`);
            assert.match(t.trim, /^#[0-9a-f]{6}$/i);
        }
    });

    test('teamBannerTokens : le marine d\'Edmonton gagne un filet visible et son crest clair', () => {
        const edm = colors.teamBannerTokens(' edm ');
        assert.equal(edm.primary, colors.NHL_TEAM_COLORS.EDM[0]);
        assert.equal(edm.crest, 'teams/dark/EDM.svg');
        assert.equal(edm.rgb, '4, 30, 66');
        // Seconde couleur orange, assez claire : c'est elle qui fait le liseré.
        assert.equal(edm.trim, colors.shadeHex(colors.NHL_TEAM_COLORS.EDM[1], 0.2));
    });

    test('teamBannerTokens : un liseré presque noir reprend le filet', () => {
        // Caroline : rouge et noir.
        const car = colors.teamBannerTokens('CAR');
        assert.equal(car.trim, car.edge);
        assert.equal(car.crest, 'teams/CAR.png');
    });

    test('teamBannerTokens : club inconnu ou historique, couleurs neutres et aucun crest', () => {
        const inconnu = colors.teamBannerTokens('XXX');
        assert.equal(inconnu.primary, colors.NHL_TEAM_COLORS_FALLBACK[0]);
        assert.equal(inconnu.crest, null);
        assert.equal(colors.teamBannerTokens('').crest, null);
        assert.equal(colors.teamBannerTokens('ARI').crest, null);
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
    test('un accent est retiré, il ne coupe pas le nom en deux', () => {
        // L'accent combinant laissé par NFD est supprimé avant le filtre
        // [^a-z], qui remplace tout le reste par une espace. Sans cette
        // suppression, « Bédard » devenait « be dard ».
        assert.equal(inj.injNormalizeName('Connor Bédard'), 'connor bedard');
        assert.equal(inj.injNormalizeName('Connor Bedard'), 'connor bedard');
    });

    test('les deux orthographes d\'un nom accentué donnent la même clé', () => {
        // C'est l'invariant qui compte : le flux d'ESPN écrit les noms sans
        // accent, nos tableaux avec. Les deux doivent tomber sur la même clé
        // exacte ET la même clé approximative.
        for (const [accentue, ascii] of [
            ['Connor Bédard', 'Connor Bedard'],
            ['Sam Montembeault', 'Sam Montembeault'],
            ['Timothée Chalamet', 'Timothee Chalamet']
        ]) {
            const a = inj.injNormalizeName(accentue);
            const b = inj.injNormalizeName(ascii);
            assert.equal(a, b, `${accentue} / ${ascii}`);
            assert.equal(inj.injLooseKey(a), inj.injLooseKey(b), `clé approximative : ${accentue}`);
        }
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

    test('un nom accentué d\'un seul côté est rapproché quand même', () => {
        // Le flux d'ESPN écrit « Connor Bedard », nos tableaux « Connor
        // Bédard ». Les deux sens doivent fonctionner, sans quoi aucun joueur
        // au nom accentué n'obtient sa pastille.
        inj.injIndex({ injuries: [{ playerName: 'Connor Bedard', team: 'CHI' }] });
        assert.ok(inj.getPlayerInjury('Connor Bédard', 'CHI'), 'flux ASCII, table accentuée');

        inj.injIndex({ injuries: [{ playerName: 'Connor Bédard', team: 'CHI' }] });
        assert.ok(inj.getPlayerInjury('Connor Bedard', 'CHI'), 'flux accentué, table ASCII');
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

// ── Tri de la page Stats : une seule saison ─────────────────────────────────
describe('stats — tri sur une seule saison', () => {
    // getCurrentPlayerStats et goaliePoolPoints sont fournis par le bac à
    // sable : ce sont les dépendances réelles de valeurOfTri dans la page.
    // `mode` simule le sélecteur « Saison » ; `pools`, la trousse une fois chargée.
    function charger(joueursCourants, mode = 'stats', pools = mode === 'projection' ? { skaters: [], goalies: [], teams: [] } : null) {
        const liste = joueursCourants || [];
        const ctx = {
            statsMode: mode,
            projectionPools: pools,
            currentStats: joueursCourants ? { season: 20252026, players: liste } : null,
            goaliePoolPoints: g => (g.shutouts || 0) * 5 + (g.wins || 0) * 2 + (g.otLosses || 0),
            getCurrentPlayerStats: (nom, id) =>
                liste.find(p => (id && p.playerId === id) || p.playerName === nom) || null
        };
        return chargerFonctions('index.js',
            ['statsCourantesPretes', 'modeProjection', 'nombreStat', 'valeurDeTri', 'comparerParStat'], ctx);
    }

    const LISTE_REPECHAGE = [
        // `points` ici = les totaux de l'an passé, tels que les porte
        // nhl_filtered_stats.json (la liste de repêchage).
        { skaterFullName: 'Vedette Absente', playerId: 1, points: 120, goals: 50 },
        { skaterFullName: 'Joueur Actif', playerId: 2, points: 10, goals: 4 }
    ];

    test('un joueur absent de /current-stats ne remonte plus avec l’an passé', () => {
        // Le bogue : « Vedette Absente » n'est pas dans currentStats, donc
        // l'ancien code lui rendait ses 120 points de la saison écoulée et la
        // plaçait devant un joueur réellement en tête cette saison.
        const courants = [{ playerName: 'Joueur Actif', playerId: 2, points: 10 }];
        const { valeurDeTri, comparerParStat } = charger(courants);

        const absente = valeurDeTri(LISTE_REPECHAGE[0], 'Vedette Absente', 1, 'points', false);
        const actif = valeurDeTri(LISTE_REPECHAGE[1], 'Joueur Actif', 2, 'points', false);

        assert.equal(absente, 0, 'aucun total de la saison précédente ne doit fuiter');
        assert.equal(actif, 10);
        assert.ok(comparerParStat(absente, actif, 'Vedette Absente', 'Joueur Actif') > 0,
            'le joueur réellement en tête doit passer devant');
    });

    test('sans /current-stats, tout le tableau retombe ensemble sur la liste locale', () => {
        // Le repli reste possible — il doit juste valoir pour tout le monde,
        // sinon deux saisons se retrouvent dans le même classement.
        const { valeurDeTri, statsCourantesPretes } = charger(null);
        assert.equal(statsCourantesPretes(), false);
        assert.equal(valeurDeTri(LISTE_REPECHAGE[0], 'Vedette Absente', 1, 'points', false), 120);
        assert.equal(valeurDeTri(LISTE_REPECHAGE[1], 'Joueur Actif', 2, 'points', false), 10);
    });

    test('le tri est numérique, pas alphabétique', () => {
        // '9' > '100' en comparaison de chaînes : la valeur doit être un nombre.
        const courants = [
            { playerName: 'Cent', playerId: 3, points: '100' },
            { playerName: 'Neuf', playerId: 4, points: '9' }
        ];
        const { valeurDeTri, comparerParStat } = charger(courants);
        const cent = valeurDeTri({}, 'Cent', 3, 'points', false);
        const neuf = valeurDeTri({}, 'Neuf', 4, 'points', false);

        assert.equal(cent, 100);
        assert.equal(neuf, 9);
        assert.ok(comparerParStat(cent, neuf, 'Cent', 'Neuf') < 0, '100 doit précéder 9');
    });

    test('une statistique manquante ou illisible vaut zéro, jamais NaN', () => {
        const courants = [
            { playerName: 'Vide', playerId: 5 },
            { playerName: 'Nul', playerId: 6, points: null },
            { playerName: 'Texte', playerId: 7, points: 'n/d' }
        ];
        const { valeurDeTri } = charger(courants);
        for (const [nom, id] of [['Vide', 5], ['Nul', 6], ['Texte', 7]]) {
            const v = valeurDeTri({}, nom, id, 'points', false);
            assert.equal(v, 0, `${nom} doit valoir 0`);
            assert.ok(!Number.isNaN(v));
        }
    });

    test('à égalité, l’ordre est alphabétique — donc stable et prévisible', () => {
        // Avant le premier match, tout le monde est à zéro : sans départage,
        // l'ordre venait du fichier de repêchage et changeait sans raison.
        const { comparerParStat } = charger([]);
        assert.ok(comparerParStat(0, 0, 'Aubin', 'Zidane') < 0);
        assert.ok(comparerParStat(0, 0, 'Zidane', 'Aubin') > 0);
        assert.equal(comparerParStat(0, 0, 'Même', 'Même'), 0);
    });

    test('« points » chez un gardien est son pointage de pool', () => {
        // 2 blanchissages + 10 victoires + 3 défaites en prolongation.
        const courants = [{ playerName: 'Gardien', playerId: 8, shutouts: 2, wins: 10, otLosses: 3, points: 0 }];
        const { valeurDeTri } = charger(courants);
        assert.equal(valeurDeTri({}, 'Gardien', 8, 'points', true), 2 * 5 + 10 * 2 + 3);
    });

    test('en projection, tout le tableau lit la trousse, même quand /current-stats a répondu', () => {
        // Les vrais totaux ne doivent pas se glisser dans un classement projeté.
        const courants = [{ playerName: 'Joueur Actif', playerId: 2, points: 10 }];
        const { valeurDeTri, modeProjection } = charger(courants, 'projection');
        assert.equal(modeProjection(), true);
        assert.equal(valeurDeTri({ points: 95 }, 'Joueur Actif', 2, 'points', false), 95);
        assert.equal(valeurDeTri({ shutouts: 4, wins: 30, otLosses: 5 }, 'Gardien', 8, 'points', true), 4 * 5 + 30 * 2 + 5);
    });

    test('« Projections » choisi mais trousse pas encore chargée : les vrais totaux restent', () => {
        const { valeurDeTri, modeProjection } = charger([{ playerName: 'Joueur Actif', playerId: 2, points: 10 }], 'projection', null);
        assert.equal(modeProjection(), false);
        assert.equal(valeurDeTri({ points: 95 }, 'Joueur Actif', 2, 'points', false), 10);
    });
});

// ─────────── navbar — la liste des comptes de la bascule d'administration ───────────
//
// Elle s'arrêtait à cinq (`slice(0, 5)`) sans le dire : au-delà, un compte
// était simplement introuvable, et rien à l'écran ne laissait deviner qu'il
// existait. La liste porte maintenant tous les comptes et c'est sa hauteur
// qui est bornée, pas son contenu.

/** Le strict nécessaire du DOM pour faire tourner loadAdminUsers. */
function domSimule() {
    const creer = (tag) => ({
        tag, className: '', type: '', src: '', alt: '', textContent: '',
        dataset: {}, attributs: {}, enfants: [], ecouteurs: {},
        setAttribute(n, v) { this.attributs[n] = v; },
        appendChild(e) { this.enfants.push(e); return e; },
        append(...e) { this.enfants.push(...e); },
        replaceChildren(...e) { this.enfants = [...e]; },
        addEventListener(nom, fn) { (this.ecouteurs[nom] = this.ecouteurs[nom] || []).push(fn); }
    });
    const conteneur = creer('div');
    return {
        conteneur,
        document: { createElement: creer, getElementById: () => conteneur }
    };
}

/** Toutes les valeurs de `textContent` de l'arbre, à plat. */
function textes(noeud, sortie = []) {
    if (noeud.textContent) sortie.push(noeud.textContent);
    for (const enfant of noeud.enfants || []) textes(enfant, sortie);
    return sortie;
}

describe("navbar — bascule d'administration", () => {
    const comptes = ['admin', 'fza', 'fzb', 'fzc', 'fzd', 'h2h_alpha',
                     'h2h_beta', 'h2h_charlie', 'h2h_delta', 'jos', 'luc', 'zoe'];

    const executer = async (users, actif) => {
        const dom = domSimule();
        const { loadAdminUsers } = chargerFonctions('navbar.js', ['loadAdminUsers'], {
            document: dom.document,
            window: { location: { hostname: 'fantazy.example', origin: 'https://fantazy.example' } },
            localStorage: { getItem: (c) => (c === 'username' ? actif : null) },
            fetch: async () => ({ ok: true, json: async () => ({ users }) }),
            switchToUser: () => {}
        });
        await loadAdminUsers();
        return dom.conteneur;
    };

    test('tous les comptes sont proposés, pas les cinq premiers', async () => {
        const conteneur = await executer(comptes, 'admin');
        const liste = conteneur.enfants.find(e => e.className === 'admin-users-scroll');

        assert.ok(liste, 'la liste doit vivre dans son propre cadre défilant');
        assert.equal(liste.enfants.length, comptes.length - 1,
            'un seul compte manque à l’appel : celui sous lequel on est déjà');
        assert.ok(liste.enfants.length > 5, 'la troncature à cinq est bien levée');
    });

    test('le compte actif est retiré, celui d administration reste', async () => {
        // Il reste parce que c'est par lui qu'on rentre chez soi après un
        // dépannage : le filtrer, c'était condamner la porte de sortie.
        const conteneur = await executer(comptes, 'fza');
        const liste = conteneur.enfants.find(e => e.className === 'admin-users-scroll');
        const noms = liste.enfants.map(b => b.dataset.username);

        assert.ok(!noms.includes('fza'), 'basculer vers soi-même ne veut rien dire');
        assert.ok(noms.includes('admin'), 'le retour au compte d’administration doit rester offert');
    });

    test('le nombre de comptes est annoncé', async () => {
        const conteneur = await executer(comptes, 'admin');
        const etiquette = conteneur.enfants.find(e => e.className === 'dropdown-label');
        assert.equal(etiquette.textContent, `Changer d'utilisateur (${comptes.length - 1})`);
    });

    test('un nom d utilisateur est du texte, jamais du balisage', async () => {
        // L'ancienne version interpolait le nom dans une chaîne de HTML et
        // dans un `onclick` entre apostrophes : une apostrophe cassait le
        // bouton, et une balise faisait bien pire.
        const piege = `<img src=x onerror=alert(1)>`;
        const apostrophe = `o'brien`;
        const conteneur = await executer(['admin', piege, apostrophe], 'admin');
        const liste = conteneur.enfants.find(e => e.className === 'admin-users-scroll');

        assert.deepEqual(liste.enfants.map(b => b.dataset.username), [piege, apostrophe]);
        assert.ok(textes(liste).includes(piege), 'le nom doit arriver par textContent');
        assert.equal(liste.enfants[1].attributs.onclick, undefined,
            'aucun gestionnaire ne doit être écrit en attribut');
    });
});
// ── accueil ─ la journée du pool ──────────────────────────────────

describe('accueil — todayISO, la journée du pool', () => {
    /**
     * Un `Date` figé à un instant donné.
     *
     * `todayISO()` lit l'heure courante : sans instant fixe, le test ne
     * pourrait pas interroger 20 h un soir de match. Les constructions avec
     * arguments gardent leur sens, seul `new Date()` est détourné.
     */
    function dateFigee(instant) {
        const Vrai = Date;
        return class extends Vrai {
            constructor(...args) { super(...(args.length ? args : [instant])); }
            static now() { return new Vrai(instant).getTime(); }
        };
    }

    const aides = instant => chargerFonctions(
        'accueil-dash.js',
        ['FR_MONTH_SHORT', 'FZD_JOUR_POOL', 'poolDayISO', 'todayISO', 'shiftISO', 'dayNum', 'dayLabelFr'],
        { Date: dateFigee(instant) }
    );

    test('à 20 h un soir de match, la journée est encore celle des matchs en cours', () => {
        // Le bogue d'origine : 20 h 30 à Montréal le 19, c'est déjà le 20 en
        // UTC. La bande des jours marquait « Auj » sur le 20 pendant que les
        // matchs du 19 jouaient, et /schedule était interrogé sur le mauvais
        // jour.
        assert.equal(aides('2026-09-20T00:30:00Z').todayISO(), '2026-09-19');
    });

    test('la journée ne tourne qu’à minuit à l’Est', () => {
        assert.equal(aides('2026-09-20T03:59:00Z').todayISO(), '2026-09-19');
        assert.equal(aides('2026-09-20T04:01:00Z').todayISO(), '2026-09-20');
    });

    test('en hiver aussi, où l’Est est à UTC-5', () => {
        assert.equal(aides('2026-01-15T04:59:00Z').todayISO(), '2026-01-14');
        assert.equal(aides('2026-01-15T05:01:00Z').todayISO(), '2026-01-15');
    });

    test('poolDayISO ramène un horodatage complet à sa journée de pool', () => {
        const { poolDayISO } = aides('2026-09-20T00:30:00Z');

        // Une mise au jeu à 22 h à Vancouver, c'est 1 h du matin à l'Est.
        assert.equal(poolDayISO('2026-09-20T05:00:00Z'), '2026-09-20');
        assert.equal(poolDayISO('2026-09-20T02:00:00Z'), '2026-09-19');
        assert.equal(poolDayISO('pas une date'), null);
    });

    test('shiftISO ajoute des jours de calendrier, pas des tranches de 24 h', () => {
        const { shiftISO } = aides('2026-09-20T00:30:00Z');

        // Nuit du changement d'heure : elle dure 25 heures, la veille du
        // 1er novembre reste le 31 octobre.
        assert.equal(shiftISO('2026-11-01', -1), '2026-10-31');
        assert.equal(shiftISO('2026-03-01', -1), '2026-02-28');
        assert.equal(shiftISO('2026-12-31', 1), '2027-01-01');
    });

    test('« Aujourd’hui » et « Hier » suivent la journée du pool', () => {
        const { dayLabelFr } = aides('2026-09-20T00:30:00Z');

        assert.equal(dayLabelFr('2026-09-19'), 'Aujourd’hui');
        assert.equal(dayLabelFr('2026-09-18'), 'Hier');
        assert.equal(dayLabelFr('2026-09-17'), '17 sept.');
        assert.equal(dayLabelFr(''), '');
        assert.equal(dayLabelFr('n’importe quoi'), '');
    });
});
// ── accueil ─ le carrousel des buteurs ──────────────────────────────

describe('accueil — les buteurs sous chaque match', () => {
    const { escapeHTML } = chargerFonctions('accueil.js', ['escapeHTML']);
    const { getTeamColors } = colors;

    // Trois buts dans l'ordre de la LNH : chronologique, du premier au
    // dernier. Les compteurs et la marque sont ceux d'APRÈS chaque but.
    const BUTS = [
        { name: 'Phillip Danault', teamAbbrev: 'MTL', goalsToDate: 1,
          period: 1, periodType: 'REG', timeInPeriod: '12:19',
          headshot: 'https://cdn/1.png', awayScore: 1, homeScore: 0,
          assists: [{ name: 'Z. Bolduc', assistsToDate: 1 }] },
        { name: 'Auston Matthews', teamAbbrev: 'TOR', goalsToDate: 14,
          period: 2, periodType: 'REG', timeInPeriod: '04:02',
          headshot: '', awayScore: 1, homeScore: 1, assists: [] },
        { name: 'Cole Caufield', teamAbbrev: 'MTL', goalsToDate: 9,
          period: 3, periodType: 'REG', timeInPeriod: '18:47',
          headshot: 'https://cdn/3.png', awayScore: 2, homeScore: 1,
          assists: [{ name: 'N. Suzuki', assistsToDate: 22 },
                    { name: 'M. Matheson', assistsToDate: 8 }] }
    ];

    const MATCH = { id: 2025020321, away: { abbrev: 'MTL' }, home: { abbrev: 'TOR' } };
    const EQUIPES = { away: 'MTL', home: 'TOR' };

    /** Les aides de rendu, avec une feuille de pointage déjà en main. */
    function rendu(buts = BUTS) {
        return chargerFonctions(
            'accueil-dash.js',
            ['periodLabel', 'compteurHTML', 'goalCardHTML', 'gameGoalsHTML'],
            { escapeHTML, getTeamColors, calGoals: { date: '2025-11-15', games: { 2025020321: buts }, at: 0 } }
        );
    }

    /** Les noms des buteurs, dans l'ordre où la piste les pose. */
    const ordre = html => [...html.matchAll(/class="fzd-goal-name"[^>]*>([^<]+)</g)].map(m => m[1].trim());
    /** La marque de chaque carte, dans l'ordre de la piste. */
    const marques = html => [...html.matchAll(/class="fzd-goal-run">([^<]*)</g)].map(m => m[1]);

    test('match en cours : le but le plus récent est à gauche', () => {
        // La carte répond à « qu'est-ce qui vient de se passer » : la réponse
        // doit être sous les yeux, pas à trois cartes de défilement.
        const { gameGoalsHTML } = rendu();

        assert.deepEqual(ordre(gameGoalsHTML(MATCH, false)),
            ['Cole Caufield', 'Auston Matthews', 'Phillip Danault']);
    });

    test('match terminé : l’ordre s’inverse, du premier but au dernier', () => {
        const { gameGoalsHTML } = rendu();

        assert.deepEqual(ordre(gameGoalsHTML(MATCH, true)),
            ['Phillip Danault', 'Auston Matthews', 'Cole Caufield']);
    });

    test('la marque suit le carrousel, but par but', () => {
        // C'est tout l'intérêt de l'ordre : lue de gauche à droite sur un
        // match terminé, la marque raconte comment la soirée a basculé.
        const { gameGoalsHTML } = rendu();

        assert.deepEqual(marques(gameGoalsHTML(MATCH, true)),
            ['MTL 1 - TOR 0', 'MTL 1 - TOR 1', 'MTL 2 - TOR 1']);
        assert.deepEqual(marques(gameGoalsHTML(MATCH, false)),
            ['MTL 2 - TOR 1', 'MTL 1 - TOR 1', 'MTL 1 - TOR 0']);
    });

    test('le mot dit quel ordre est à l’écran', () => {
        const { gameGoalsHTML } = rendu();

        assert.match(gameGoalsHTML(MATCH, false), /Le plus récent d’abord/);
        assert.match(gameGoalsHTML(MATCH, true), /Du premier au dernier/);
    });

    test('relire la feuille ne la retourne pas sur place', () => {
        // `reverse()` seul muterait la liste gardée dans calGoals : le match
        // basculerait d'un ordre à l'autre à chaque rafraîchissement.
        const { gameGoalsHTML } = rendu();

        const un = gameGoalsHTML(MATCH, false);
        gameGoalsHTML(MATCH, true);
        assert.deepEqual(ordre(gameGoalsHTML(MATCH, false)), ordre(un));
    });

    test('un match sans but n’affiche pas de bandeau vide', () => {
        const { gameGoalsHTML } = rendu([]);

        assert.equal(gameGoalsHTML(MATCH, true), '');
        assert.equal(gameGoalsHTML({ id: 999, away: {}, home: {} }, true), '');
    });

    test('la carte porte la photo, le nom, l’aide, la marque et le moment', () => {
        const { goalCardHTML } = rendu();
        const html = goalCardHTML(BUTS[0], EQUIPES);

        assert.match(html, /src="https:\/\/cdn\/1\.png"/);
        assert.match(html, />Phillip Danault/);
        assert.match(html, />Z\. Bolduc/);
        assert.match(html, />MTL 1 - TOR 0</);
        assert.match(html, /\(1<sup>re<\/sup> - 12:19\)/);
    });

    test('le compteur de saison suit chaque nom', () => {
        // « (1) » derrière le buteur, « (1) » derrière le passeur : le
        // premier but de l'un, la première aide de l'autre.
        const { goalCardHTML } = rendu();
        const un = goalCardHTML(BUTS[0], EQUIPES);

        assert.match(un, /Phillip Danault <span class="fzd-goal-tally">\(1\)<\/span>/);
        assert.match(un, /Z\. Bolduc <span class="fzd-goal-tally">\(1\)<\/span>/);
        assert.match(goalCardHTML(BUTS[1], EQUIPES),
            /Auston Matthews <span class="fzd-goal-tally">\(14\)<\/span>/);
    });

    test('plusieurs aides se suivent avec « et », aucune se dit', () => {
        const { goalCardHTML } = rendu();

        assert.match(goalCardHTML(BUTS[2], EQUIPES),
            /N\. Suzuki <span class="fzd-goal-tally">\(22\)<\/span> et M\. Matheson <span class="fzd-goal-tally">\(8\)<\/span>/);
        assert.match(goalCardHTML(BUTS[1], EQUIPES), />Sans aide</);
    });

    test('un compteur absent ne s’écrit pas « (0) »', () => {
        // Les vieux matchs reviennent parfois sans total : mieux vaut rien
        // qu'un zéro, qui se lirait comme une erreur de calcul.
        const { compteurHTML, goalCardHTML } = rendu();

        assert.equal(compteurHTML(null), '');
        assert.equal(compteurHTML(0), '');
        assert.equal(compteurHTML(7), ' <span class="fzd-goal-tally">(7)</span>');

        const sansTotal = goalCardHTML({ ...BUTS[0], goalsToDate: null, assists: [] }, EQUIPES);
        assert.ok(!sansTotal.includes('fzd-goal-tally'), 'aucun compteur ne doit paraître');
    });

    test('sans marque connue, la ligne reste vide plutôt qu’inventée', () => {
        const { goalCardHTML } = rendu();
        const html = goalCardHTML({ ...BUTS[0], awayScore: null, homeScore: null }, EQUIPES);

        assert.match(html, /class="fzd-goal-run"><\/span>/);
        assert.match(html, /\(1<sup>re<\/sup> - 12:19\)/);
    });

    test('le fond de la photo porte la couleur du club du buteur', () => {
        // Les buts des deux équipes se suivent dans la même piste : la
        // couleur est ce qui dit d'un coup d'œil qui vient de marquer.
        const { goalCardHTML } = rendu();

        const un = goalCardHTML(BUTS[0], EQUIPES);
        assert.ok(un.includes('--fz-shot-team: ' + getTeamColors('MTL')[0]));
        assert.match(un, /class="fzd-goal-photo fz-shot"/);
        assert.ok(goalCardHTML(BUTS[1], EQUIPES).includes('--fz-shot-team: ' + getTeamColors('TOR')[0]));
    });

    test('la carte entière ouvre la fiche du buteur', () => {
        // Viser le nom seul demanderait de la précision sur une ligne de 11
        // pixels : c'est la carte qui prend le clic, et le clavier avec elle.
        const { goalCardHTML } = rendu();
        const html = goalCardHTML({ ...BUTS[0], playerId: 8476479 }, EQUIPES);

        assert.match(html, /data-goal-player="8476479"/);
        assert.match(html, /role="button" tabindex="0"/);
        assert.match(html, /data-goal-name="Phillip Danault"/);
        assert.match(html, /aria-label="Voir la fiche de Phillip Danault"/);
    });

    test('sans identifiant, la carte ne promet pas un clic sans effet', () => {
        // Un vieux match revient parfois sans playerId : mieux vaut une carte
        // muette qu'un bouton qui ne mène nulle part.
        const { goalCardHTML } = rendu();
        const html = goalCardHTML(BUTS[0], EQUIPES);

        assert.ok(!html.includes('data-goal-player'), 'aucune fiche à ouvrir');
        assert.ok(!html.includes('role="button"'), 'la carte ne se dit pas bouton');
        assert.ok(!html.includes('tabindex'), 'et ne prend pas le clavier');
    });

    test('la fiche demandée est celle de la carte cliquée', () => {
        const appels = [];
        const { ouvrirFicheButeur } = chargerFonctions('accueil-dash.js', ['ouvrirFicheButeur'],
            { fzhOpenPlayerCareer: (id, nom) => appels.push([id, nom]) });

        ouvrirFicheButeur({ dataset: { goalPlayer: '8476479', goalName: 'Phillip Danault' } });
        // Un clic à côté d'une carte ne trouve rien à ouvrir : closest() rend
        // null, et la fonction doit s'en accommoder sans lever.
        assert.doesNotThrow(() => ouvrirFicheButeur(null));

        assert.deepEqual(appels, [['8476479', 'Phillip Danault']]);
    });

    test('sans photo, les initiales tiennent la place', () => {
        const { goalCardHTML } = rendu();
        const html = goalCardHTML(BUTS[1], EQUIPES);

        assert.match(html, /class="fzd-goal-photo fz-shot is-initials">AM</);
        assert.ok(!html.includes('<img'), 'aucune image ne doit être demandée');
    });

    test('prolongation et tirs de barrage portent leur nom', () => {
        const { goalCardHTML } = rendu();

        assert.match(goalCardHTML({ ...BUTS[0], period: 4, periodType: 'OT' }, EQUIPES), /\(Prol - /);
        assert.match(goalCardHTML({ ...BUTS[0], period: 5, periodType: 'SO' }, EQUIPES), /\(TB - /);
    });

    test('les flèches de navigation accompagnent chaque piste', () => {
        const { gameGoalsHTML } = rendu();
        const html = gameGoalsHTML(MATCH, true);

        assert.match(html, /class="fzd-goals-arrow" data-dir="prev"/);
        assert.match(html, /class="fzd-goals-arrow" data-dir="next"/);
        // Un bouton sans nom ne dit rien à un lecteur d'écran : « ‹ » non plus.
        assert.match(html, /aria-label="But précédent"/);
        assert.match(html, /aria-label="But suivant"/);
    });

    test('la flèche avance d’UN but, pas d’une page', () => {
        // Sauter deux buts pour en montrer un troisième perdrait la séquence
        // que le carrousel est justement là pour raconter.
        const { goalsScroll } = chargerFonctions('accueil-dash.js', ['goalsScroll'],
            { getComputedStyle: () => ({ columnGap: '6px' }) });

        const appels = [];
        const piste = { firstElementChild: { offsetWidth: 204 }, clientWidth: 276, scrollBy: o => appels.push(o) };

        goalsScroll(piste, 1);
        goalsScroll(piste, -1);

        // 204 de carte + 6 de gouttiere : la carte suivante arrive pile au bord.
        assert.deepEqual(appels.map(a => a.left), [210, -210]);
        assert.ok(appels.every(a => a.behavior === 'smooth'), 'le saut doit être animé');
    });

    test('une piste vide ne fait pas défiler le vide', () => {
        const { goalsScroll } = chargerFonctions('accueil-dash.js', ['goalsScroll'],
            { getComputedStyle: () => ({ columnGap: '6px' }) });

        const appels = [];
        // Sans carte, il reste la largeur visible : mieux que zéro, qui
        // laisserait le bouton sans effet.
        goalsScroll({ firstElementChild: null, clientWidth: 276, scrollBy: o => appels.push(o) }, 1);
        assert.deepEqual(appels.map(a => a.left), [276]);

        assert.doesNotThrow(() => goalsScroll(null, 1));
    });

    /** Un bloc de buts en carton-pâte : ce que majFlechesButs touche, rien de plus. */
    function blocFactice(piste) {
        const classes = new Set();
        const bouton = () => {
            const c = new Set();
            return { classList: { toggle: (n, on) => (on ? c.add(n) : c.delete(n)) }, off: () => c.has('is-off') };
        };
        const prev = bouton(), next = bouton();
        return {
            classList: { toggle: (n, on) => (on ? classes.add(n) : classes.delete(n)) },
            querySelector: sel => sel === '.fzd-goals-track' ? piste
                : sel === '[data-dir="prev"]' ? prev
                : sel === '[data-dir="next"]' ? next : null,
            navVisible: () => classes.has('has-nav'), prev, next
        };
    }

    test('une piste qui tient entière n’affiche aucune flèche', () => {
        // Deux boutons morts sous un match à deux buts : autant ne rien mettre.
        const { majFlechesButs } = chargerFonctions('accueil-dash.js', ['majFlechesButs']);
        const bloc = blocFactice({ scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });

        majFlechesButs(bloc);

        assert.equal(bloc.navVisible(), false);
    });

    test('aux deux bouts, la flèche qui ne mène nulle part se grise', () => {
        const { majFlechesButs } = chargerFonctions('accueil-dash.js', ['majFlechesButs']);
        const piste = { scrollWidth: 900, clientWidth: 300, scrollLeft: 0 };
        const bloc = blocFactice(piste);

        majFlechesButs(bloc);
        assert.equal(bloc.navVisible(), true, 'la piste déborde : les flèches servent');
        assert.equal(bloc.prev.off(), true, 'au départ, rien avant');
        assert.equal(bloc.next.off(), false);

        piste.scrollLeft = 300;
        majFlechesButs(bloc);
        assert.equal(bloc.prev.off(), false, 'au milieu, les deux mènent quelque part');
        assert.equal(bloc.next.off(), false);

        piste.scrollLeft = 600;
        majFlechesButs(bloc);
        assert.equal(bloc.next.off(), true, 'au bout, rien après');
    });

    test('un nom venu de la LNH est du texte, jamais du balisage', () => {
        const { goalCardHTML } = rendu();
        const html = goalCardHTML({
            name: '<img src=x onerror=alert(1)>', teamAbbrev: 'MTL', goalsToDate: 1,
            period: 1, periodType: 'REG', timeInPeriod: '01:00',
            headshot: 'x" onerror="alert(1)', awayScore: 1, homeScore: 0,
            assists: [{ name: '<script>', assistsToDate: 1 }]
        }, { away: '"><b>', home: 'TOR' });

        assert.ok(!html.includes('<img src=x'), 'le nom doit être échappé');
        assert.ok(!html.includes('<script>'), 'l’aide doit être échappée');
        assert.ok(!html.includes('onerror="alert(1)"'), 'la photo doit être échappée');
        assert.ok(!html.includes('"><b>'), 'l’abréviation doit être échappée');
    });
});

// ── accueil ─ l'horloge des matchs en cours ─────────────────────────

describe('accueil — le direct sous chaque match', () => {
    const { escapeHTML } = chargerFonctions('accueil.js', ['escapeHTML']);

    // Ce que l'horaire donne : aucune horloge, jamais — vérifié sur
    // /v1/schedule un soir de match en cours. C'est la feuille du jour qui
    // les porte, et elle arrive par /day-goals.
    const HORAIRE = {
        id: 2026010009, state: 'PRE', period: null, periodType: null, clock: null,
        away: { abbrev: 'SJS', score: null }, home: { abbrev: 'ANA', score: null }
    };
    const EN_DIRECT = {
        state: 'LIVE', period: 1, periodType: 'REG',
        clock: { timeRemaining: '08:23', secondsRemaining: 503, running: true, inIntermission: false },
        away: 1, home: 2
    };

    /** Les aides du direct, avec une feuille du jour déjà en main. */
    function rendu(live = { 2026010009: EN_DIRECT }) {
        return chargerFonctions(
            'accueil-dash.js',
            ['ETAT_RANG', 'rangEtat', 'etatDirect', 'horlogeMMSS', 'horlogeHTML', 'periodLabel'],
            { escapeHTML, calGoals: { date: '2026-09-20', games: {}, live, at: 0 } }
        );
    }

    test('la feuille du jour fait avancer un match que l’horaire croit à venir', () => {
        // calData est figé pour la session : sans cette fusion, une carte
        // ouverte avant la mise au jeu restait « PRE », sans marque, jusqu'au
        // prochain rechargement de la page.
        const { etatDirect } = rendu();
        const vu = etatDirect(HORAIRE);

        assert.equal(vu.state, 'LIVE');
        assert.equal(vu.period, 1);
        assert.equal(vu.away.score, 1);
        assert.equal(vu.home.score, 2);
        assert.equal(vu.clock.secondsRemaining, 503);
    });

    test('elle ne le fait jamais RECULER', () => {
        // Les deux flux de la LNH ne tombent pas en panne ensemble : on a vu
        // la feuille du jour resservir « à venir » des heures sur un match que
        // l'horaire donnait final. Une carte terminée ne doit pas repartir en
        // première période.
        const { etatDirect } = rendu({ 2026010009: { ...EN_DIRECT, state: 'FUT', clock: null, away: null, home: null } });
        const fini = { ...HORAIRE, state: 'FINAL', period: 3, periodType: 'REG',
            away: { abbrev: 'SJS', score: 3 }, home: { abbrev: 'ANA', score: 2 } };

        const vu = etatDirect(fini);
        assert.equal(vu.state, 'FINAL');
        assert.equal(vu.period, 3);
        assert.equal(vu.away.score, 3);
    });

    test('un match absent de la feuille garde ce que dit l’horaire', () => {
        const { etatDirect } = rendu({});
        assert.deepEqual(etatDirect(HORAIRE), HORAIRE);
    });

    test('l’en-tête porte la période ET le chronomètre', () => {
        const { etatDirect, horlogeHTML } = rendu();
        const html = horlogeHTML(etatDirect(HORAIRE));

        assert.match(html, /1<sup>re<\/sup> ·/);
        assert.match(html, /class="fzd-game-clock"/);
        assert.match(html, />08:23</);
    });

    test('le chronomètre porte de quoi se recalculer tout seul', () => {
        // Décompter à l'aveugle prendrait du retard dans un onglet ralenti :
        // on garde les secondes de la LNH et l'instant où on les a reçues,
        // et chaque battement refait la soustraction.
        const { etatDirect, horlogeHTML } = rendu();
        const html = horlogeHTML(etatDirect(HORAIRE));

        assert.match(html, /data-fzd-clock="503"/);
        assert.match(html, /data-fzd-run="1"/);
        const pose = Number(html.match(/data-fzd-at="(\d+)"/)[1]);
        assert.ok(Math.abs(Date.now() - pose) < 5000, 'l’instant de pose doit être celui du rendu');
    });

    test('une horloge arrêtée ne bat pas', () => {
        // Sifflet, fin de période : le temps affiché est le bon, il ne doit
        // simplement plus descendre.
        const { horlogeHTML } = rendu();
        const arret = { ...EN_DIRECT, clock: { ...EN_DIRECT.clock, running: false } };

        assert.match(horlogeHTML(arret), /data-fzd-run="0"/);
        assert.match(horlogeHTML(arret), />08:23</);
    });

    test('l’entracte dit la période qui vient de finir', () => {
        // « 3e · 20:00 » ferait croire que la période a commencé. Le décompte
        // de l'entracte dit quand elle commencera.
        const { horlogeHTML } = rendu();
        const pause = { ...EN_DIRECT, period: 2,
            clock: { timeRemaining: '15:00', secondsRemaining: 900, running: true, inIntermission: true } };

        assert.match(horlogeHTML(pause), /^Fin 2<sup>e<\/sup> ·/);
        assert.match(horlogeHTML(pause), />15:00</);
    });

    test('sans horloge du tout, la période reste seule', () => {
        // Un vieux match, une feuille du jour en panne : la carte revient à ce
        // qu'elle affichait avant, pas à un chronomètre vide.
        const { horlogeHTML } = rendu();
        const html = horlogeHTML({ ...EN_DIRECT, clock: null });

        assert.equal(html, '1<sup>re</sup>');
        assert.ok(!html.includes('fzd-game-clock'));
    });

    test('les minutes tiennent sur deux chiffres', () => {
        // 10:00 → 09:59 ne doit pas rétrécir d'un caractère : tout l'en-tête
        // se décalerait à chaque tour de minute.
        const { horlogeMMSS } = rendu();

        assert.equal(horlogeMMSS(600), '10:00');
        assert.equal(horlogeMMSS(599), '09:59');
        assert.equal(horlogeMMSS(503), '08:23');
        assert.equal(horlogeMMSS(0), '00:00');
        assert.equal(horlogeMMSS(-5), '00:00', 'jamais de temps négatif');
    });

    test('le battement recalcule depuis l’instant de pose', () => {
        const pose = Date.now() - 7000;
        const pendules = [
            { textContent: '08:23', dataset: { fzdClock: '503', fzdAt: String(pose), fzdRun: '1' } },
            { textContent: '00:03', dataset: { fzdClock: '3', fzdAt: String(pose), fzdRun: '1' } }
        ];
        const { fzdTickHorloges } = chargerFonctions('accueil-dash.js',
            ['fzdTickHorloges', 'fzdArreterHorloges', 'horlogeMMSS'],
            { fzdHorlogeTimer: 1, document: { querySelectorAll: () => pendules.filter(p => p.dataset.fzdRun === '1') },
              clearInterval: () => {} });

        fzdTickHorloges();

        // Sept secondes passées, sept secondes de moins — pas un battement
        // manqué, même si le navigateur en a sauté.
        assert.equal(pendules[0].textContent, '08:16');
        // Arrivée à zéro, l'horloge s'arrête d'elle-même.
        assert.equal(pendules[1].textContent, '00:00');
        assert.equal(pendules[1].dataset.fzdRun, '0');
    });

    test('plus une seule horloge à l’écran, plus de battement', () => {
        let arrets = 0;
        const { fzdTickHorloges } = chargerFonctions('accueil-dash.js',
            ['fzdTickHorloges', 'fzdArreterHorloges', 'horlogeMMSS'],
            { fzdHorlogeTimer: 1, document: { querySelectorAll: () => [] }, clearInterval: () => { arrets++; } });

        fzdTickHorloges();
        assert.equal(arrets, 1, 'le minuteur doit se couper tout seul');
    });
});
