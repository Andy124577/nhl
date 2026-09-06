/**
 * Chargement de la fiche de carrière — et surtout, pourquoi il échoue.
 *
 * Les trois pages qui ouvrent la modale (stats, repêchage actif, classement)
 * enveloppaient le fetch ET tout le rendu qui suit dans un seul try/catch
 * dont la branche d'échec affichait, quoi qu'il arrive :
 *
 *     ❌ Erreur lors du chargement des statistiques
 *
 * Le même écran couvrait donc cinq causes sans rapport : identifiant
 * manquant, joueur inconnu de la LNH, serveur injoignable, API de la LNH
 * en panne ou limitée, et erreur de rendu après une réponse pourtant
 * valide. Impossible de savoir laquelle sans ouvrir la console.
 *
 * Ce module ne change pas le comportement quand tout va bien : il nomme la
 * panne quand ça va mal. Il vit à part parce que showCareerStats() existe
 * en trois exemplaires, dont deux minifiés.
 */

(function (global) {
    'use strict';

    function echec(message, phase) {
        const err = new Error(message);
        err.fzMessage = message;
        err.fzPhase = phase || 'chargement';
        return err;
    }

    /**
     * Récupère la fiche de carrière d'un joueur.
     *
     * Lève une erreur portant `fzMessage` — une phrase montrable telle
     * quelle — plutôt que de laisser l'appelant deviner.
     */
    async function fzChargerCarriere(playerId, baseUrl) {
        // `showCareerStats(${p.playerId || 'null'})` : plusieurs cartes de la
        // page Stats sont générées ainsi, si bien qu'un joueur sans
        // identifiant appelait la modale avec la chaîne « null », que le
        // serveur ne pouvait que refuser.
        if (playerId === null || playerId === undefined || playerId === '' ||
            !/^\d+$/.test(String(playerId).trim())) {
            throw echec("Ce joueur n'a pas d'identifiant LNH : sa fiche de carrière n'est pas disponible.");
        }

        const base = baseUrl || (typeof BASE_URL === 'string' ? BASE_URL : '');

        let reponse;
        try {
            reponse = await fetch(`${base}/player-career/${playerId}`);
        } catch (err) {
            // Cause la plus fréquente en développement : la page est servie
            // depuis un autre port (Live Server) ou par 127.0.0.1, et
            // BASE_URL ne pointe alors pas sur le serveur Node.
            throw echec(`Impossible de joindre le serveur${base ? ` (${base})` : ''}. Vérifiez qu'il est démarré.`);
        }

        if (!reponse.ok) {
            if (reponse.status === 400) {
                throw echec(`Identifiant de joueur invalide (${playerId}).`);
            }
            if (reponse.status === 404) {
                throw echec(`Joueur introuvable dans les données de la LNH (identifiant ${playerId}).`);
            }
            if (reponse.status >= 500) {
                throw echec(`Le serveur n'a pas pu obtenir la fiche auprès de la LNH (erreur ${reponse.status}). Réessayez dans un moment.`);
            }
            throw echec(`Le serveur a répondu ${reponse.status} ${reponse.statusText || ''}`.trim() + '.');
        }

        try {
            return await reponse.json();
        } catch (err) {
            throw echec('La réponse du serveur est illisible.');
        }
    }

    function echapper(texte) {
        return String(texte).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * Traduit n'importe quelle erreur remontée par showCareerStats.
     *
     * Une erreur sans `fzMessage` vient forcément du rendu : la réponse
     * était bonne et c'est l'affichage qui a cédé. Le dire évite d'envoyer
     * chercher une panne réseau qui n'existe pas.
     */
    function fzMessageErreurCarriere(err) {
        if (err && err.fzMessage) return echapper(err.fzMessage);
        const detail = err && err.message ? ` (${err.message})` : '';
        return echapper(`Statistiques reçues, mais leur affichage a échoué${detail}.`);
    }

    global.fzChargerCarriere = fzChargerCarriere;
    global.fzMessageErreurCarriere = fzMessageErreurCarriere;
})(typeof window !== 'undefined' ? window : globalThis);
