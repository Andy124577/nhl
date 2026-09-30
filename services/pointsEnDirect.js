/**
 * Les points du soir, poussés aux pages qui affichent un classement.
 *
 * Une page qui montre des totaux de pool demande `points:suivre` sur sa
 * connexion Socket.IO et entre dans la salle `points`. Tant qu'il y a
 * quelqu'un dans la salle, le serveur relit les matchs du soir (le relevé
 * partagé de /live-games) toutes les `intervalleMs`, en tire ce qui manque
 * encore aux totaux de minuit (lib/pointsEnDirect.js), et ne pousse que ce
 * qui a changé. Personne dans la salle : aucun relevé, aucun envoi.
 *
 * Message : `points:direct` { joueurs, clubs, generatedAt } — à l'arrivée,
 * puis à chaque but, aide, victoire ou défaite en prolongation.
 *
 * Aucune lecture de la base : les totaux sont ceux déjà en mémoire, les
 * matchs et les feuilles viennent de la LNH. Une feuille n'est relue que
 * quand le pointage ou l'état de son match bouge (plus une fois toutes les
 * FEUILLE_MAX_MS, pour les corrections de la LNH après coup) — un soir de
 * seize matchs coûte quelques dizaines d'appels, pas des milliers.
 *
 * Les données sont publiques (/live-games l'est) : une connexion anonyme
 * peut suivre.
 */

'use strict';

const { calculerPointsEnDirect, matchsASuivre, signature } = require('../lib/pointsEnDirect.js');

const SALLE = 'points';
const FEUILLE_MAX_MS = 2 * 60 * 1000;

function creerPointsEnDirect({
    io,
    lireMatchs,                 // async () => [matchs bruts de /v1/score/now] | null
    lireFeuille,                // async (id) => boxscore brut | null
    lireReleves,                // () => { stats, clubs } — en mémoire
    intervalleMs = 10000,
    logger = console,
    horloge = () => Date.now(),
    minuterie = { repeter: setInterval, arreter: clearInterval }
}) {
    const feuilles = new Map();         // id → { box, cle, lu }
    let dernier = null;                 // { charge, lu }
    let enVol = null;
    let envoyee = null;                 // signature du dernier envoi à la salle
    let minuteur = null;

    function abonnes() {
        const salle = io && io.sockets && io.sockets.adapter && io.sockets.adapter.rooms.get(SALLE);
        return salle ? salle.size : 0;
    }

    /**
     * La feuille d'un match, relue seulement si son pointage ou son état a
     * bougé. Une feuille en retard sur le pointage (la LNH met à jour
     * /score/now avant le boxscore) n'est pas retenue comme à jour : elle
     * sera relue au passage suivant.
     */
    async function feuilleDe(m) {
        const id = Number(m.id);
        const a = m.awayTeam || {}, h = m.homeTeam || {};
        const cle = [m.gameState, a.score, h.score].join('|');
        const connue = feuilles.get(id);
        const officielle = m.gameState === 'OFF';
        if (connue && connue.cle === cle && (officielle || horloge() - connue.lu < FEUILLE_MAX_MS)) return connue.box;
        try {
            const box = await lireFeuille(id);
            if (!box) return connue ? connue.box : null;
            const aJour = Number(box.awayTeam && box.awayTeam.score) === Number(a.score)
                && Number(box.homeTeam && box.homeTeam.score) === Number(h.score);
            feuilles.set(id, { box, cle: aJour ? cle : null, lu: horloge() });
            return box;
        } catch (erreur) {
            logger.warn?.(`⚠️ Feuille du match ${id} indisponible :`, erreur.message);
            return connue ? connue.box : null;
        }
    }

    async function calculer() {
        const matchs = await lireMatchs();
        if (!matchs) return null;
        const { stats, clubs } = lireReleves() || {};
        const suivis = matchsASuivre(matchs, stats && stats.season);

        // Les matchs sortis du relevé (la LNH passe au jour suivant) : leurs
        // feuilles ne servent plus.
        const ids = new Set(suivis.map(m => Number(m.id)));
        for (const id of feuilles.keys()) if (!ids.has(id)) feuilles.delete(id);

        const lues = new Map();
        await Promise.all(suivis.map(async m => {
            const box = await feuilleDe(m);
            if (box) lues.set(Number(m.id), box);
        }));
        const points = calculerPointsEnDirect({ matchs: suivis, feuilles: lues, stats, clubs });
        return { ...points, generatedAt: new Date(horloge()).toISOString() };
    }

    /**
     * Le dernier calcul s'il date de moins d'un intervalle, sinon un calcul
     * neuf — partagé par les demandes simultanées. Sert aussi /live-points.
     */
    async function lire() {
        if (dernier && horloge() - dernier.lu < intervalleMs) return dernier.charge;
        if (!enVol) {
            enVol = calculer()
                .then(charge => {
                    if (charge) dernier = { charge, lu: horloge() };
                    return charge || (dernier ? dernier.charge : null);
                })
                .catch(erreur => {
                    logger.error?.('⚠️ Points en direct indisponibles :', erreur.message);
                    return dernier ? dernier.charge : null;
                })
                .finally(() => { enVol = null; });
        }
        return enVol;
    }

    function arreter() {
        if (minuteur) minuterie.arreter(minuteur);
        minuteur = null;
        envoyee = null;
    }

    async function tic() {
        if (abonnes() === 0) { arreter(); return; }
        const charge = await lire();
        if (!charge) return;
        const sig = signature(charge);
        if (sig === envoyee) return;
        envoyee = sig;
        io.to(SALLE).emit('points:direct', charge);
    }

    function demarrer() {
        if (minuteur) return;
        minuteur = minuterie.repeter(tic, intervalleMs);
        if (minuteur && typeof minuteur.unref === 'function') minuteur.unref();
    }

    /** Branche les demandes d'une connexion. */
    function brancher(socket) {
        socket.on('points:suivre', async () => {
            socket.join(SALLE);
            demarrer();
            // L'état complet tout de suite : la page n'attend pas le
            // prochain passage pour afficher ses totaux.
            const charge = await lire();
            if (!charge) return;
            socket.emit('points:direct', charge);
            if (envoyee === null) envoyee = signature(charge);
        });
        socket.on('points:arreter', () => {
            socket.leave(SALLE);
        });
    }

    return { brancher, lire, tic, arreter, abonnes, SALLE };
}

module.exports = { creerPointsEnDirect, SALLE, FEUILLE_MAX_MS };
