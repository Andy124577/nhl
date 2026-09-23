/**
 * Le banc du tête-à-tête : qui joue, qui attend, et à partir de quand.
 *
 * Un pool tête-à-tête peut prévoir des joueurs de banc (`config.numBench`).
 * Ils se repêchent comme les autres, mais ne marquent rien tant qu'ils sont
 * sur le banc : ils servent à remplacer un partant blessé ou en panne. On
 * fait entrer un joueur du banc à la place d'un partant de la MÊME catégorie
 * — un défenseur pour un défenseur, un gardien pour un gardien.
 *
 * Un changement compte à partir du LENDEMAIN. Le pointage d'une semaine lit
 * les feuilles de match jour par jour ; si un échange de banc s'appliquait
 * tout de suite à la semaine entière, on pourrait faire entrer, le dimanche
 * soir, le joueur qui a marqué trois buts le mardi. L'alignement du jour J
 * se reconstruit donc à partir de l'alignement courant, en défaisant les
 * changements datés d'après J.
 *
 * Pur : aucune lecture, aucune écriture. Testé dans test/unit/lineup.test.js.
 */

'use strict';

const dates = require('./dates.js');

/** Catégories qu'on peut mettre au banc. Le club de la LNH n'en fait pas partie. */
const CATEGORIES_BANC = ['offensive', 'defensive', 'goalie', 'rookie'];

/** Borne haute du banc, comme le formulaire de création. */
const BANC_MAX = 5;

const LIBELLES = {
    offensive: 'attaquant', defensive: 'défenseur', goalie: 'gardien', rookie: 'recrue'
};

const nomDe = (p) => (typeof p === 'string')
    ? p
    : (p && (p.nom || p.name || p.skaterFullName || p.goalieFullName)) || null;

/** Places de banc du pool. Zéro hors tête-à-tête. */
function quotaBanc(pool) {
    if (!pool || pool.poolMode !== 'head-to-head') return 0;
    const n = parseInt(pool.config && pool.config.numBench, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, BANC_MAX) : 0;
}

/** Le banc d'une équipe, normalisé : `[{ nom, categorie }]`. */
function banc(equipe) {
    return ((equipe && equipe.bench) || [])
        .map(b => ({ nom: nomDe(b), categorie: (b && b.categorie) || null }))
        .filter(b => b.nom);
}

/** Changements triés du plus ancien au plus récent, à date égale dans l'ordre d'écriture. */
function changementsTries(equipe) {
    return ((equipe && equipe.lineupChanges) || [])
        .map((c, i) => ({ ...c, _i: i }))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a._i - b._i));
}

/**
 * Les partants d'une équipe le jour `jour` (ISO) : `Map nom → catégorie`.
 *
 * On part des partants actuels et on défait, du plus récent au plus ancien,
 * chaque changement qui n'était pas encore en vigueur ce jour-là.
 */
function partantsLe(equipe, jour) {
    const partants = new Map();
    for (const c of CATEGORIES_BANC) {
        for (const p of ((equipe && equipe[c]) || [])) {
            const nom = nomDe(p);
            if (nom) partants.set(nom, c);
        }
    }
    const changements = changementsTries(equipe);
    for (let k = changements.length - 1; k >= 0; k--) {
        const c = changements[k];
        if (c.date <= jour) break;
        partants.delete(c.entre);
        if (c.sort) partants.set(c.sort, c.categorie);
    }
    return partants;
}

/**
 * Tous ceux qui ont été partants au moins un jour de `[debut, fin)`, avec
 * leur catégorie. C'est la liste des feuilles de match à lire ; le tri jour
 * par jour se fait ensuite avec `estPartantLe`.
 */
function partantsDeLaPeriode(equipe, debut, fin) {
    const tous = new Map(partantsLe(equipe, debut));
    for (const c of changementsTries(equipe)) {
        if (c.date > debut && c.date < fin && c.entre) tous.set(c.entre, c.categorie);
    }
    return tous;
}

/**
 * Une fonction `(nom, jour) → partant ?` pour une équipe, mémorisée par jour :
 * une semaine compte sept journées, pas une par feuille de match.
 */
function lecteurPartants(equipe) {
    const parJour = new Map();
    return (nom, jour) => {
        if (!parJour.has(jour)) parJour.set(jour, partantsLe(equipe, jour));
        return parJour.get(jour).has(nom);
    };
}

/**
 * Faire entrer un joueur du banc à la place d'un partant.
 *
 * `entre` est sur le banc, `sort` est partant, et les deux sont de la même
 * catégorie. L'alignement courant change tout de suite (c'est lui que la page
 * affiche), mais le changement est daté du lendemain : les matchs d'aujourd'hui
 * comptent encore pour l'ancien partant.
 *
 * Défaire un changement le jour même (remettre le même joueur en place avant
 * qu'il soit en vigueur) efface l'entrée au lieu d'en empiler une seconde.
 */
function echangerBanc(equipe, { entre, sort, maintenant = new Date(), par = null } = {}) {
    if (!equipe) return { ok: false, code: 404, message: "Équipe introuvable." };
    const place = banc(equipe).findIndex(b => b.nom === entre);
    if (place < 0) return { ok: false, code: 404, message: `${entre} n'est pas sur votre banc.` };

    const categorie = banc(equipe)[place].categorie;
    if (!CATEGORIES_BANC.includes(categorie)) {
        return { ok: false, code: 400, message: "Ce joueur de banc n'a pas de position connue." };
    }

    const partants = (equipe[categorie] || []);
    const indice = partants.findIndex(p => nomDe(p) === sort);
    if (indice < 0) {
        const ailleurs = CATEGORIES_BANC.find(c => (equipe[c] || []).some(p => nomDe(p) === sort));
        return ailleurs
            ? { ok: false, code: 400, message: `Position invalide : ${entre} (${LIBELLES[categorie]}) ne peut remplacer qu'un ${LIBELLES[categorie]}.` }
            : { ok: false, code: 404, message: `${sort} n'est pas dans votre alignement de départ.` };
    }

    const date = dates.ajouterJours(dates.journeeLocale(maintenant), 1);

    equipe[categorie][indice] = entre;
    equipe.bench[place] = { nom: sort, categorie };

    if (!Array.isArray(equipe.lineupChanges)) equipe.lineupChanges = [];
    const dernier = equipe.lineupChanges[equipe.lineupChanges.length - 1];
    if (dernier && dernier.date === date && dernier.entre === sort && dernier.sort === entre) {
        equipe.lineupChanges.pop();
        return { ok: true, date, entre, sort, categorie, annule: true };
    }
    equipe.lineupChanges.push({
        date, entre, sort, categorie,
        par, faitLe: new Date(maintenant).toISOString()
    });
    return { ok: true, date, entre, sort, categorie, annule: false };
}

module.exports = {
    CATEGORIES_BANC,
    BANC_MAX,
    quotaBanc,
    banc,
    partantsLe,
    partantsDeLaPeriode,
    lecteurPartants,
    echangerBanc,
    nomDe
};
