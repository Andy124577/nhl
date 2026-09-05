/**
 * draftkitData.js — la Trousse de repêchage 2026-2027 comme source de vérité.
 *
 * Le bassin de joueurs, les gardiens, les équipes, les projections, les
 * alignements et les notes de repêchage viennent tous de draftkit.json, produit
 * par tools/build_draftkit.js à partir des documents de la trousse. Aucune API
 * externe (ni ESPN, ni api-web) n'alimente ces listes.
 *
 * DEUX SAISONS, À NE JAMAIS CONFONDRE
 * -----------------------------------
 * Chaque fiche porte `lastSeason` (ce que le joueur a réellement fait) et
 * `projection` (ce que la trousse prévoit pour 2026-2027). Les tableaux du
 * repêchage affichent la PROJECTION : c'est sur elle qu'on repêche. La saison
 * dernière reste accessible (`.lastSeason` sur chaque fiche, ou
 * FZDraftKit.pools('lastSeason')) pour l'afficher comme référence historique,
 * jamais comme prévision.
 *
 * Les listes retournées portent les mêmes noms de champs que l'ancien
 * nhl_filtered_stats.json (skaterFullName, teamAbbrevs, positionCode…), pour
 * que tout le reste de la page de repêchage continue de fonctionner sans
 * réécriture.
 */
(function (global) {
    'use strict';

    var FICHIER = 'draftkit.json?v=20260905a';
    var FICHIER_WATCHLIST = 'draftkit-watchlist.json?v=20260905a';

    var promesse = null;
    var donnees = null;
    var promesseWatchlist = null;
    var listeSurveiller = null;

    // Barème du pool, identique à celui du serveur (server.js) : un gardien
    // vaut shutouts*5 + wins*2 + otLosses, une équipe wins*2 + otLosses. On
    // l'applique aux chiffres PROJETÉS de la trousse.
    function pointsGardien(s) {
        return (s.shutouts || 0) * 5 + (s.wins || 0) * 2 + (s.otLosses || 0);
    }
    function pointsEquipe(s) {
        return (s.wins || 0) * 2 + (s.otLosses || 0);
    }

    /** Clé de rapprochement des noms : sans accent, sans ponctuation. */
    function cleNom(nom) {
        return String(nom || '')
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function charger() {
        if (promesse) return promesse;
        promesse = fetch(FICHIER)
            .then(function (r) {
                if (!r.ok) throw new Error('draftkit.json : HTTP ' + r.status);
                return r.json();
            })
            .then(function (d) {
                donnees = d;
                return d;
            })
            .catch(function (err) {
                // On laisse l'appelant décider : la page de repêchage affiche
                // son message d'erreur, l'accueil masque simplement la section.
                promesse = null;
                throw err;
            });
        return promesse;
    }

    /**
     * Les trois listes du repêchage, dans la forme attendue par draftActif.js
     * et ses modules. `saison` vaut 'projection' (défaut) ou 'lastSeason'.
     */
    function pools(saison) {
        if (!donnees) return { skaters: [], goalies: [], teams: [] };
        var cle = saison === 'lastSeason' ? 'lastSeason' : 'projection';

        var skaters = donnees.skaters.map(function (p) {
            var s = p[cle];
            return {
                playerId: null,                 // rempli par attacherIds()
                skaterFullName: p.fullName,
                teamAbbrevs: p.team,
                positionCode: p.position,
                gamesPlayed: s.gamesPlayed,
                goals: s.goals,
                assists: s.assists,
                points: s.points,
                // Extras de la trousse, utiles à l'affichage et au tri.
                kitRank: p.rank,
                age: p.age,
                isRookie: !!p.rookie,
                salary: p.salary,
                capHit: p.capHit,
                contractYear: p.contractYear,
                injuryFlag: p.injuryFlag,
                statsSeason: cle,
                projection: p.projection,
                lastSeason: p.lastSeason
            };
        });

        var goalies = donnees.goalies.map(function (p) {
            var s = p[cle];
            return {
                playerId: null,
                goalieFullName: p.fullName,
                teamAbbrevs: p.team,
                positionCode: 'G',
                gamesPlayed: s.gamesPlayed,
                wins: s.wins,
                losses: s.losses,
                otLosses: s.otLosses,
                savePct: s.savePct,
                shutouts: s.shutouts,
                goalsAgainstAvg: s.gaa,
                points: pointsGardien(s),
                assists: cle === 'lastSeason' ? s.assists : null,
                kitRank: p.rank,
                age: p.age,
                salary: p.salary,
                capHit: p.capHit,
                contractYear: p.contractYear,
                injuryFlag: p.injuryFlag,
                statsSeason: cle,
                projection: p.projection,
                lastSeason: p.lastSeason
            };
        });

        var teams = donnees.teams.map(function (t) {
            var s = t[cle];
            return {
                teamFullName: t.fullName,
                teamAbbrev: t.abbrev,
                gamesPlayed: s.gamesPlayed,
                wins: s.wins,
                losses: s.losses,
                otLosses: s.otLosses,
                shutouts: s.shutouts,
                points: pointsEquipe(s),
                kitRank: t.rank,
                statsSeason: cle,
                projection: t.projection,
                lastSeason: t.lastSeason
            };
        });

        return { skaters: skaters, goalies: goalies, teams: teams };
    }

    /**
     * Rattache les identifiants LNH aux fiches de la trousse. La trousse n'en
     * contient pas, et ils servent aux photos et à la fiche de carrière : on
     * les récupère par le nom dans les statistiques courantes déjà chargées.
     * Les CHIFFRES affichés restent ceux de la trousse — seul l'identifiant
     * voyage.
     */
    function attacherIds(listes, source) {
        if (!source || !source.length) return 0;
        var parNom = Object.create(null);
        source.forEach(function (e) {
            var nom = e.playerName || e.skaterFullName || e.goalieFullName;
            var id = e.playerId;
            if (nom && id && !parNom[cleNom(nom)]) parNom[cleNom(nom)] = id;
        });

        var n = 0;
        [].concat(listes).forEach(function (liste) {
            (liste || []).forEach(function (fiche) {
                if (fiche.playerId) return;
                var id = parNom[cleNom(fiche.skaterFullName || fiche.goalieFullName)];
                if (id) { fiche.playerId = id; n++; }
            });
        });
        return n;
    }

    /* ------------------------------------------------------------------
       Noms déjà repêchés — la trousse n'écrit pas tous les noms comme la
       LNH. Un choix enregistré avant le passage à la trousse doit continuer
       de trouver sa fiche, sinon il disparaît de l'équipe de son pooler.
       ------------------------------------------------------------------ */
    var ALIAS = {
        'mitchell marner': 'Mitch Marner',
        'utah hockey club': 'Utah Mammoth'
    };

    var indexNoms = null;
    function construireIndex() {
        indexNoms = Object.create(null);
        if (!donnees) return;
        donnees.skaters.forEach(function (p) { indexNoms[cleNom(p.fullName)] = p.fullName; });
        donnees.goalies.forEach(function (p) { indexNoms[cleNom(p.fullName)] = p.fullName; });
        donnees.teams.forEach(function (t) { indexNoms[cleNom(t.fullName)] = t.fullName; });
    }

    /**
     * Nom tel qu'il est écrit dans la trousse, à partir de n'importe quelle
     * variante enregistrée. Rend le nom reçu si rien ne correspond : un choix
     * inconnu reste inconnu plutôt que d'être rapproché du mauvais joueur.
     */
    function nomCanonique(nom) {
        if (!nom || !donnees) return nom;
        if (!indexNoms) construireIndex();
        var cle = cleNom(nom);
        return ALIAS[cle] || indexNoms[cle] || nom;
    }

    /** Fiche de guide d'une équipe : meilleurs choix, trios, notes. */
    function guide(abbrev) {
        return (donnees && donnees.guides && donnees.guides[abbrev]) || null;
    }

    /**
     * « Joueurs à Surveiller » des 32 équipes, déjà mis à plat. Charge le
     * fichier allégé (~28 ko) plutôt que la trousse entière : l'accueil n'a
     * besoin de rien d'autre. Les deux fichiers sortent du même build, donc
     * ils ne peuvent pas diverger. Si la trousse complète est déjà en main
     * (page de repêchage), on s'en sert et on ne redemande rien.
     */
    function chargerWatchlist() {
        if (donnees) return Promise.resolve(donnees.watchlist || []);
        if (promesseWatchlist) return promesseWatchlist;
        promesseWatchlist = fetch(FICHIER_WATCHLIST)
            .then(function (r) {
                if (!r.ok) throw new Error('draftkit-watchlist.json : HTTP ' + r.status);
                return r.json();
            })
            .then(function (d) {
                listeSurveiller = d.watchlist || [];
                return listeSurveiller;
            })
            .catch(function (err) {
                promesseWatchlist = null;
                throw err;
            });
        return promesseWatchlist;
    }

    function watchlist() {
        var liste = (donnees && donnees.watchlist) || listeSurveiller;
        return liste ? liste.slice() : [];
    }

    global.FZDraftKit = {
        charger: charger,
        load: charger,
        pools: pools,
        attacherIds: attacherIds,
        chargerWatchlist: chargerWatchlist,
        nomCanonique: nomCanonique,
        guide: guide,
        watchlist: watchlist,
        get donnees() { return donnees; },
        get saison() { return donnees ? donnees.season : null; }
    };
})(window);
