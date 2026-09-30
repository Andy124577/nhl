/**
 * Les matchs en cours, poussés aux pages ouvertes au lieu d'être sondés.
 *
 * Une page qui suit le direct demande `scores:suivre` sur sa connexion
 * Socket.IO et entre dans la salle `scores`. Tant qu'il y a quelqu'un dans la
 * salle, le serveur relève la LNH (le relevé partagé de /live-games) toutes
 * les `intervalleMs`, et ne pousse que ce qui a changé (lib/scoresEnDirect.js).
 * Personne dans la salle : aucun relevé, aucun envoi.
 *
 * Messages :
 *   - `scores:tout`    { games, generatedAt, ageMs } — à l'arrivée, et quand
 *                       la liste des matchs change ;
 *   - `scores:match`   { game, ageMs } — un match dont l'affichage a bougé ;
 *   - `scores:chronos` [{ id, clock, ageMs }] — des horloges arrêtées,
 *                       reparties, ou trop loin de ce que la page affiche.
 *
 * `ageMs` : l'âge du relevé au moment de l'envoi, pour que la page fasse
 * partir son horloge du bon instant.
 *
 * Les données sont publiques (/live-games l'est) : une connexion anonyme
 * peut suivre, comme elle peut appeler la route.
 */

'use strict';

const { comparer } = require('../lib/scoresEnDirect.js');

const SALLE = 'scores';

function creerScoresEnDirect({
    io,
    lire,                       // async () => { games, generatedAt, lu } | null
    intervalleMs = 5000,
    logger = console,
    horloge = () => Date.now(),
    minuterie = { repeter: setInterval, arreter: clearInterval }
}) {
    let minuteur = null;
    let etat = null;            // ce qui a été envoyé, par match
    let enCours = false;

    function abonnes() {
        const salle = io.sockets && io.sockets.adapter && io.sockets.adapter.rooms.get(SALLE);
        return salle ? salle.size : 0;
    }

    async function releve() {
        try {
            return await lire();
        } catch (erreur) {
            logger.error?.('⚠️ Direct indisponible :', erreur.message);
            return null;
        }
    }

    const ageDe = (charge) => Math.max(0, horloge() - (Number(charge && charge.lu) || horloge()));

    function arreter() {
        if (minuteur) minuterie.arreter(minuteur);
        minuteur = null;
        etat = null;
    }

    async function tic() {
        if (enCours) return;
        if (abonnes() === 0) { arreter(); return; }
        enCours = true;
        try {
            const charge = await releve();
            // La LNH ne répond pas : on garde ce que les pages affichent.
            if (!charge) return;
            const diff = comparer(etat, charge.games, horloge());
            etat = diff.etat;
            const ageMs = ageDe(charge);
            if (diff.tout) {
                io.to(SALLE).emit('scores:tout', { games: charge.games, generatedAt: charge.generatedAt, ageMs });
                return;
            }
            for (const game of diff.matchs) io.to(SALLE).emit('scores:match', { game, ageMs });
            if (diff.chronos.length) {
                io.to(SALLE).emit('scores:chronos', diff.chronos.map(c => ({ ...c, ageMs })));
            }
        } finally {
            enCours = false;
        }
    }

    function demarrer() {
        if (minuteur) return;
        minuteur = minuterie.repeter(tic, intervalleMs);
        if (minuteur && typeof minuteur.unref === 'function') minuteur.unref();
    }

    /** Branche les demandes d'une connexion. */
    function brancher(socket) {
        socket.on('scores:suivre', async () => {
            socket.join(SALLE);
            demarrer();
            // L'état complet tout de suite : la page n'attend pas le prochain
            // relevé pour afficher. Le relevé partagé sert s'il est frais.
            const charge = await releve();
            if (charge) {
                socket.emit('scores:tout', { games: charge.games, generatedAt: charge.generatedAt, ageMs: ageDe(charge) });
                // Premier abonné : ce relevé sert de point de départ, sinon
                // le premier passage renverrait le même état complet.
                if (!etat) etat = comparer(null, charge.games, horloge()).etat;
            }
        });
        socket.on('scores:arreter', () => {
            socket.leave(SALLE);
        });
    }

    return { brancher, tic, arreter, abonnes, SALLE };
}

module.exports = { creerScoresEnDirect, SALLE };
