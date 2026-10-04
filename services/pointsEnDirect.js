/**
 * Les points du soir, poussés aux pages qui affichent un classement.
 *
 * Une page qui montre des totaux de pool demande `points:suivre` sur sa
 * connexion Socket.IO et entre dans la salle `points`. Tant qu'il y a
 * quelqu'un dans la salle, le serveur relit les matchs du soir (le relevé
 * partagé de /live-games) et ceux des journées que le relevé de la nuit peut
 * encore ignorer, toutes les `intervalleMs`, en tire ce qui manque encore aux
 * totaux (lib/pointsEnDirect.js), et ne pousse que ce qui a changé. Personne
 * dans la salle : aucun relevé, aucun envoi.
 *
 * Message : `points:direct` { joueurs, clubs, releve, generatedAt } — à
 * l'arrivée, puis à chaque but, aide, victoire ou défaite en prolongation, et
 * quand les relevés de minuit changent (`releve`, voir versionDesReleves).
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

const {
    calculerPointsEnDirect, apportsDuMatch, matchsASuivre, joursASuivre, signature, soireesDuJour, etatDeLaJournee
} = require('../lib/pointsEnDirect.js');

const SALLE = 'points';
const FEUILLE_MAX_MS = 2 * 60 * 1000;
/**
 * Une feuille officielle (OFF) ne bouge presque plus — mais la LNH corrige
 * encore une aide ou un but après coup. Relue toutes les demi-heures tant
 * qu'elle sert, plutôt que figée pour la nuit.
 */
const FEUILLE_OFF_MS = 30 * 60 * 1000;

/** Rang d'un état : à venir, en cours, fini, officiel. Un état ne recule pas. */
const RANG = { FUT: 0, PRE: 0, LIVE: 1, CRIT: 1, FINAL: 2, OFF: 3 };
const rang = m => RANG[m && m.gameState] ?? 0;

/**
 * Les relevés sur lesquels ce direct s'applique. Le direct ne compte que ce
 * que les relevés ne comptent pas encore : une page restée ouverte pendant la
 * collecte de minuit garde ses anciens totaux, alors que le direct, lui,
 * laisse tomber les matchs que le nouveau relevé a pris — les points de la
 * veille disparaissaient de ses totaux jusqu'au rechargement. La page compare
 * cette version à la précédente et relit /current-stats et /current-teams
 * quand elle change (pointsDirect.js). Le nombre de joueurs suit les
 * repêchés ajoutés en cours de journée, comme l'étiquette de /current-stats.
 */
function versionDesReleves(stats, clubs) {
    if (!stats && !clubs) return null;
    return [
        stats && stats.lastUpdated, stats && stats.season, stats && (stats.players || []).length,
        clubs && clubs.lastUpdated
    ].map(v => (v == null ? '' : String(v))).join('|');
}

function creerPointsEnDirect({
    io,
    lireMatchs,                 // async () => [matchs bruts de /v1/score/now] | null
    lireMatchsDuJour = null,    // async (jour) => [matchs bruts de /v1/score/{jour}] | null
    lireFeuille,                // async (id) => boxscore brut | null
    lireReleves,                // () => { stats, clubs } — en mémoire
    aujourdhui = null,          // () => 'YYYY-MM-DD', journée du pool
    intervalleMs = 10000,
    logger = console,
    horloge = () => Date.now(),
    minuterie = { repeter: setInterval, arreter: clearInterval }
}) {
    const feuilles = new Map();         // id → { box, cle, lu }
    let dernier = null;                 // { charge, parMatch, lu }
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
        const garde = officielle ? FEUILLE_OFF_MS : FEUILLE_MAX_MS;
        if (connue && connue.cle === cle && horloge() - connue.lu < garde) return connue.box;
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

    /**
     * Les matchs à considérer : ceux de /score/now, plus ceux des journées
     * qu'un relevé peut encore ignorer (joursASuivre) — la veille surtout,
     * dont le dernier match finit après minuit et dont /score/now ne dit plus
     * rien une fois passé au jour suivant. Un match vu deux fois garde l'état
     * le plus avancé.
     */
    async function matchsDesJours(stats, clubs) {
        const jours = lireMatchsDuJour && aujourdhui
            ? joursASuivre({ stats, clubs, aujourdhui: aujourdhui() })
            : [];
        const listes = await Promise.all([
            Promise.resolve().then(lireMatchs).catch(erreur => {
                logger.warn?.('⚠️ /score/now indisponible :', erreur.message);
                return null;
            }),
            ...jours.map(jour => Promise.resolve(jour).then(lireMatchsDuJour).catch(erreur => {
                logger.warn?.(`⚠️ Matchs du ${jour} indisponibles :`, erreur.message);
                return null;
            }))
        ]);
        if (listes.every(l => !l)) return null;
        const parId = new Map();
        for (const m of listes.flat()) {
            if (!m || m.id == null) continue;
            const connu = parId.get(Number(m.id));
            if (!connu || rang(m) > rang(connu)) parId.set(Number(m.id), m);
        }
        return [...parId.values()];
    }

    async function calculer() {
        const { stats, clubs } = lireReleves() || {};
        const matchs = await matchsDesJours(stats, clubs);
        if (!matchs) return null;
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
        // Ce que chaque match apporte, relevé ou non : les colonnes 24 h, 7 j
        // et 30 j le comparent aux feuilles déjà en base (routes/records.js).
        const parMatch = suivis.map(m => ({
            id: Number(m.id),
            jour: typeof m.gameDate === 'string' ? m.gameDate.slice(0, 10) : null,
            etat: m.gameState,
            ...apportsDuMatch(m, lues.get(Number(m.id)))
        }));
        // La soirée de chacun pour la fiche d'équipe (/live-roster) : tirée
        // des mêmes matchs et des mêmes feuilles, matchs à venir compris.
        const jour = aujourdhui ? aujourdhui() : null;
        const soirees = soireesDuJour({ matchs, feuilles: lues, stats, clubs, aujourdhui: jour });
        // La journée entamée ou non (tendance du classement) : les matchs
        // seuls en décident, relevés lus ou pas.
        const journee = jour ? etatDeLaJournee(matchs, jour, stats && stats.season) : null;
        return {
            charge: { ...points, releve: versionDesReleves(stats, clubs), generatedAt: new Date(horloge()).toISOString() },
            parMatch,
            soirees,
            journee
        };
    }

    /**
     * Le dernier calcul s'il date de moins d'un intervalle, sinon un calcul
     * neuf — partagé par les demandes simultanées. Sert aussi /live-points.
     */
    async function lire() {
        if (dernier && horloge() - dernier.lu < intervalleMs) return dernier.charge;
        if (!enVol) {
            enVol = calculer()
                .then(calcul => {
                    if (calcul) dernier = { ...calcul, lu: horloge() };
                    return dernier ? dernier.charge : null;
                })
                .catch(erreur => {
                    logger.error?.('⚠️ Points en direct indisponibles :', erreur.message);
                    return dernier ? dernier.charge : null;
                })
                .finally(() => { enVol = null; });
        }
        return enVol;
    }

    /**
     * Ce que chaque match suivi apporte à chacun, qu'un relevé le compte ou
     * non : [{ id, jour, etat, joueurs, clubs }]. Même fraîcheur que lire().
     */
    async function lireParMatch() {
        await lire();
        return dernier ? dernier.parMatch : [];
    }

    /**
     * La soirée de chaque joueur et club (lib/pointsEnDirect.js,
     * soireesDuJour) : { joueurs, clubs }. Même fraîcheur que lire().
     */
    async function lireSoirees() {
        await lire();
        return (dernier && dernier.soirees) || { joueurs: {}, clubs: {} };
    }

    /**
     * La journée du pool entamée ou non (lib/pointsEnDirect.js,
     * etatDeLaJournee) : { entamee, bascule }. null tant qu'aucun calcul n'a
     * abouti — on ne sait pas. Même fraîcheur que lire().
     */
    async function lireJournee() {
        await lire();
        return (dernier && dernier.journee) || null;
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

    return { brancher, lire, lireParMatch, lireSoirees, lireJournee, tic, arreter, abonnes, SALLE };
}

module.exports = { creerPointsEnDirect, versionDesReleves, SALLE, FEUILLE_MAX_MS, FEUILLE_OFF_MS };
