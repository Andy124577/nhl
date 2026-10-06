/**
 * La forme des clubs de la LNH à leurs derniers matchs, pour le calendrier
 * (GET /team-form) : le meilleur buteur et le meilleur pointeur de chaque
 * club demandé, et la ligne des joueurs demandés sur ces mêmes matchs.
 *
 * Deux lectures par club : son calendrier (passé par `calendrierDuClub`, qui
 * a déjà son cache d'une demi-heure) et les feuilles de ses derniers matchs.
 * Une feuille de match officielle (OFF) ne change plus : ses lignes, réduites
 * à ce que la forme additionne, restent en mémoire pour la vie du processus.
 * Un match tout juste fini (FINAL) peut encore être corrigé : il est relu
 * après dix minutes. Un soir de quatorze matchs, la première visite lit une
 * soixantaine de feuilles — quatre à la fois, pour ne pas se faire limiter
 * par la LNH — et les suivantes, aucune.
 *
 * Les feuilles ne passent PAS par services/feuillesBrutes.js : ce cache-là
 * garde les matchs du soir pour le direct des points, et soixante vieilles
 * feuilles l'auraient vidé de celles qu'il relit toutes les vingt secondes.
 */

'use strict';

const { derniersMatchs, lignesDeFeuille, formeDuClub, meneurs } = require('../lib/formeClub.js');

/** Une saison régulière entière, et de la marge. */
const TAILLE_MAX = 1400;
/** Un match FINAL attend sa feuille officielle : relue après dix minutes. */
const FINAL_RELU_MS = 10 * 60 * 1000;
const EN_PARALLELE = 4;

/** Exécute les tâches `n` à la fois ; chaque tâche rend sa valeur ou null. */
async function executer(taches, n) {
    const resultats = new Array(taches.length).fill(null);
    let suivant = 0;
    const ouvrier = async () => {
        while (suivant < taches.length) {
            const i = suivant++;
            try { resultats[i] = await taches[i](); } catch { resultats[i] = null; }
        }
    };
    await Promise.all(Array.from({ length: Math.min(n, taches.length) }, ouvrier));
    return resultats;
}

function creerFormeClubs({
    calendrierDuClub,
    lireFeuille,
    saison,
    nomComplet = () => null,
    photo = (id, abbrev, s) => `https://assets.nhle.com/mugs/nhl/${s}/${abbrev}/${id}.png`,
    maintenant = () => Date.now(),
    enParallele = EN_PARALLELE
}) {
    const lignes = new Map(); // id → { lignes, etat, lu }
    const enVol = new Map();  // id → Promise

    /** Les lignes d'un match terminé, du cache si elles ne peuvent plus changer. */
    async function lignesDuMatch(match) {
        const id = String(match.id);
        const connues = lignes.get(id);
        if (connues && (connues.etat === 'OFF' || maintenant() - connues.lu < FINAL_RELU_MS)) return connues.lignes;
        if (enVol.has(id)) return enVol.get(id);

        const requete = Promise.resolve()
            .then(() => lireFeuille(match.id))
            .then(box => {
                const lues = lignesDeFeuille(box);
                // Une feuille vide n'est pas gardée : la LNH n'a peut-être pas
                // encore fini de l'écrire.
                if (!lues) return connues ? connues.lignes : null;
                lignes.delete(id);
                lignes.set(id, { lignes: lues, etat: match.gameState, lu: maintenant() });
                while (lignes.size > TAILLE_MAX) lignes.delete(lignes.keys().next().value);
                return lues;
            })
            .catch(() => (connues ? connues.lignes : null))
            .finally(() => enVol.delete(id));
        enVol.set(id, requete);
        return requete;
    }

    /**
     * `clubs` : abréviations (MTL, TOR). `joueurs` : numéros de joueur dont on
     * veut aussi la ligne. Un club dont le calendrier manque vaut null — on ne
     * prétend pas qu'il n'a pas de meneur.
     */
    async function lire({ clubs = [], joueurs = [] } = {}) {
        const s = saison();
        const calendriers = await executer(clubs.map(abbrev => () => calendrierDuClub(abbrev, s)), enParallele);

        const derniers = new Map();
        clubs.forEach((abbrev, i) => {
            if (Array.isArray(calendriers[i])) derniers.set(abbrev, derniersMatchs(calendriers[i]));
        });

        // Un match entre deux clubs demandés n'est lu qu'une fois.
        const aLire = new Map();
        for (const matchs of derniers.values()) for (const m of matchs) aLire.set(String(m.id), m);
        const lus = new Map();
        const parties = [...aLire.values()];
        const resultats = await executer(parties.map(m => () => lignesDuMatch(m)), enParallele);
        parties.forEach((m, i) => { if (resultats[i]) lus.set(String(m.id), resultats[i]); });

        const voulus = new Set(joueurs.map(Number));
        const presenter = (j, abbrev) => j && {
            id: j.id,
            nom: nomComplet(j.id) || j.nom,
            pos: j.pos,
            pj: j.pj, b: j.b, a: j.a, p: j.p,
            photo: photo(j.id, abbrev, s)
        };

        const reponse = { clubs: {}, joueurs: {} };
        for (const abbrev of clubs) {
            const matchs = derniers.get(abbrev);
            if (!matchs) { reponse.clubs[abbrev] = null; continue; }
            const forme = formeDuClub(abbrev, matchs.map(m => lus.get(String(m.id))).filter(Boolean));
            const { buteur, pointeur } = meneurs(forme.joueurs);
            reponse.clubs[abbrev] = {
                matchs: forme.matchs,
                buteur: presenter(buteur, abbrev),
                pointeur: presenter(pointeur, abbrev)
            };
            for (const j of forme.joueurs) {
                if (!voulus.has(j.id)) continue;
                const { id: _id, nom: _nom, ...ligne } = j;
                reponse.joueurs[j.id] = { club: abbrev, matchs: forme.matchs, ...ligne };
            }
        }
        return reponse;
    }

    return { lire };
}

module.exports = { creerFormeClubs, executer, TAILLE_MAX, FINAL_RELU_MS };
