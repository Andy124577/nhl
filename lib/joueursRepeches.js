/**
 * Les joueurs repêchés que la collecte des statistiques ne suit pas.
 *
 * La collecte de minuit (updateCurrentStats, server.js) et les feuilles de
 * match ne relevaient que les joueurs de nhl_filtered_stats.json — environ
 * 550 noms. Le repêchage, lui, puise dans draftkit.json : plus de mille
 * joueurs. Un choix hors de cette liste (Alexandre Texier, Jayden Struble,
 * Maveric Lamoureux…) n'avait donc jamais de ligne dans /current-stats : il
 * disparaissait du classement et n'y marquait rien.
 *
 * Ce module dit qui manque et sous quel identifiant LNH le relever. Fonctions
 * pures : le serveur leur passe les pools, la trousse et la photo des
 * effectifs de la LNH ; les tests aussi.
 */

'use strict';

// La clé de rapprochement du repêchage : sans accent ni ponctuation, et
// ramenée au nom de la trousse (« Mitchell Marner » → « Mitch Marner »).
const { cle: cleNom } = require('./choixAuto.js');

const CATEGORIES = ['offensive', 'defensive', 'goalie', 'rookie'];

function nomDe(p) {
    if (typeof p === 'string') return p.trim() || null;
    const nom = p && (p.skaterFullName || p.goalieFullName || p.nom);
    return typeof nom === 'string' ? (nom.trim() || null) : null;
}

/**
 * Tous les joueurs repêchés, tous pools confondus : nom → gardien (true,
 * false, ou null quand la case ne le dit pas — une recrue peut être l'un ou
 * l'autre). Le banc compte : un joueur de banc peut entrer demain.
 */
function nomsRepeches(pools) {
    const noms = new Map();
    const ajouter = (nom, gardien) => {
        if (!nom) return;
        if (!noms.has(nom) || noms.get(nom) === null) noms.set(nom, gardien);
    };
    for (const pool of Object.values(pools || {})) {
        for (const equipe of Object.values((pool && pool.teams) || {})) {
            if (!equipe) continue;
            for (const categorie of CATEGORIES) {
                const gardien = categorie === 'goalie' ? true : categorie === 'rookie' ? null : false;
                for (const p of equipe[categorie] || []) ajouter(nomDe(p), gardien);
            }
            for (const b of equipe.bench || []) {
                const categorie = b && typeof b === 'object' ? b.categorie : null;
                const gardien = categorie === 'goalie' ? true
                    : (categorie === 'offensive' || categorie === 'defensive') ? false : null;
                ajouter(nomDe(b), gardien);
            }
        }
    }
    return noms;
}

function indexer(entrees) {
    const index = new Map();
    for (const e of entrees) {
        const cle = cleNom(e.nom);
        if (!cle) continue;
        if (!index.has(cle)) index.set(cle, []);
        index.get(cle).push(e);
    }
    return index;
}

/** draftkit.json : la graphie du repêchage, le club, le poste, parfois l'identifiant. */
function indexTrousse(trousse) {
    const entrees = [];
    for (const p of (trousse && trousse.skaters) || []) {
        entrees.push({ nom: p.fullName, id: Number(p.playerId) || null, club: p.team || null, gardien: false });
    }
    for (const p of (trousse && trousse.goalies) || []) {
        entrees.push({ nom: p.fullName, id: Number(p.playerId) || null, club: p.team || null, gardien: true });
    }
    return indexer(entrees);
}

/** La photo quotidienne des 32 effectifs (nhl_roster_snapshot.json) : { players: { id: { name, team, pos } } }. */
function indexEffectifs(effectifs) {
    const entrees = Object.entries((effectifs && effectifs.players) || {}).map(([id, p]) => ({
        nom: p && p.name, id: Number(id) || null, club: (p && p.team) || null, gardien: !!p && p.pos === 'G'
    }));
    return indexer(entrees);
}

/**
 * Un seul candidat sûr, ou null. Le poste puis le club départagent les
 * homonymes ; ce qui reste ambigu n'est pas tiré à pile ou face.
 */
function choisir(candidats, { club = null, gardien = null } = {}) {
    let liste = candidats;
    if (gardien !== null && liste.length > 1) {
        const meme = liste.filter(c => c.gardien === gardien);
        if (meme.length) liste = meme;
    }
    if (club && liste.length > 1) {
        const meme = liste.filter(c => c.club === club);
        if (meme.length) liste = meme;
    }
    // Deux fiches sans identifiant ne sont la même personne que si club et
    // poste concordent aussi.
    const personnes = new Set(liste.map(c => c.id || `${c.club}|${c.gardien}`));
    return liste.length && personnes.size === 1 ? liste[0] : null;
}

/**
 * Les repêchés à ajouter à la collecte.
 *
 * `suivis` : la liste de nhl_filtered_stats.json (loadAllPlayers). Un repêché
 * y est déjà si son nom y figure, à l'accent près, ou si son identifiant LNH
 * y figure sous une autre graphie (Yegor / Egor Chinakhov).
 *
 * Rend { ajouts, introuvables } :
 *   ajouts       : dans la forme de loadAllPlayers (playerId, skaterFullName
 *                  ou goalieFullName, isGoalie), sous le nom repêché — c'est
 *                  lui que le classement cherche dans /current-stats ;
 *   introuvables : les noms sans identifiant LNH sûr — absent des effectifs
 *                  de la LNH, homonymes non départagés. Rien à relever.
 */
function joueursAAjouter(suivis, pools, { trousse = null, effectifs = null } = {}) {
    const suivisCles = new Set();
    const suivisIds = new Set();
    for (const p of suivis || []) {
        const nom = p && (p.skaterFullName || p.goalieFullName || p.playerName);
        if (nom) suivisCles.add(cleNom(nom));
        if (p && p.playerId) suivisIds.add(Number(p.playerId));
    }
    const kit = indexTrousse(trousse);
    const roster = indexEffectifs(effectifs);

    const ajouts = [];
    const introuvables = [];
    const pris = new Set();
    for (const [nom, gardienCase] of nomsRepeches(pools)) {
        const cle = cleNom(nom);
        if (!cle || suivisCles.has(cle)) continue;

        // La trousse donne le club et le poste ; son identifiant, quand elle
        // en a un, fait foi. Sinon, la photo des effectifs de la LNH.
        const repere = choisir(kit.get(cle) || [], { gardien: gardienCase });
        let gardien = gardienCase !== null ? gardienCase : (repere ? repere.gardien : null);
        let id = repere ? repere.id : null;
        if (!id) {
            const candidat = choisir(
                (roster.get(cle) || []).filter(c => c.id),
                { club: repere ? repere.club : null, gardien }
            );
            if (candidat) {
                id = candidat.id;
                if (gardien === null) gardien = candidat.gardien;
            }
        }

        if (!id) { introuvables.push(nom); continue; }
        if (suivisIds.has(id) || pris.has(id)) continue;
        pris.add(id);
        ajouts.push(gardien
            ? { playerId: id, goalieFullName: nom, isGoalie: true }
            : { playerId: id, skaterFullName: nom, isGoalie: false });
    }
    return { ajouts, introuvables };
}

/**
 * Ajoute au relevé en mémoire des lignes relevées à part (les repêchés
 * complétés entre deux collectes). Une ligne dont l'identifiant y est déjà
 * n'est pas recopiée : une collecte complète a pu passer entre-temps.
 * Rend un nouveau relevé ; celui reçu n'est pas modifié.
 */
function fusionnerReleves(stats, lignes) {
    const joueurs = (stats && stats.players) || [];
    const ids = new Set(joueurs.map(p => Number(p.playerId)));
    const inclusion = { ...((stats && stats.inclusion) || {}) };
    const nouvelles = [];
    for (const ligne of lignes || []) {
        if (!ligne || !ligne.playerId || ids.has(Number(ligne.playerId))) continue;
        ids.add(Number(ligne.playerId));
        const { inclusion: inclusionLigne, dernierMatch: _ancien, ...publique } = ligne;
        if (inclusionLigne) inclusion[publique.playerId] = inclusionLigne;
        nouvelles.push(publique);
    }
    if (!nouvelles.length) return { stats, ajoutees: 0 };
    return {
        stats: { ...stats, players: [...joueurs, ...nouvelles], inclusion },
        ajoutees: nouvelles.length
    };
}

module.exports = { nomsRepeches, joueursAAjouter, fusionnerReleves };
