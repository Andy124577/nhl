/**
 * Présence dans un salon d'attente, et le compte à rebours qui en dépend.
 *
 * Le salon instantané a besoin de deux réponses que Socket.IO seul ne donne
 * pas : « ces quatre personnes sont-elles réellement là ? » et « peut-on
 * partir ? ». Trois pièges les rendent moins évidentes qu'elles n'en ont l'air.
 *
 * 1. Plusieurs onglets appartiennent à une seule personne. Compter les
 *    connexions donnerait quatre participants là où il n'y en a qu'un.
 * 2. Une coupure brève n'est pas un départ. Un téléphone qui verrouille son
 *    écran perd son socket pour quelques secondes ; annuler le repêchage de
 *    tout le monde pour ça serait absurde. D'où un délai de grâce.
 * 3. Le compte à rebours appartient au serveur. Dix écrans qui comptent
 *    chacun de leur côté affichent dix heures différentes, et l'un d'eux
 *    démarrerait la partie avant les autres.
 *
 * L'horloge est injectable : les tests contrôlent le temps au lieu d'attendre.
 *
 * Limite assumée : cette présence vit dans le processus. Avec plusieurs
 * instances Node, chacune ne voit que ses propres sockets. C'est pourquoi
 * l'état durable du salon vit en base et que le démarrage est revalidé sous
 * verrou juste avant d'écrire — la présence accélère, elle ne décide pas
 * seule. Passer à plusieurs instances demande un adaptateur Socket.IO partagé.
 */

'use strict';

/** Une absence plus courte que ça n'est pas un départ. */
const GRACE_RECONNEXION_MS = 60 * 1000;

/** Durée du compte à rebours de démarrage, tenue par le serveur. */
const COMPTE_A_REBOURS_MS = 10 * 1000;

function creerPresence({ maintenant = () => Date.now(), minuterie = setTimeout, annuler = clearTimeout } = {}) {

    /** poolName → Map(username → { connexions:Set, partiDepuis:number|null }) */
    const salons = new Map();

    /** poolName → { finit, minuteur, annulee } */
    const comptes = new Map();

    function salon(nomPool) {
        if (!salons.has(nomPool)) salons.set(nomPool, new Map());
        return salons.get(nomPool);
    }

    /** Une connexion arrive. Efface toute absence en cours pour cette personne. */
    function arrive(nomPool, username, idConnexion) {
        const membres = salon(nomPool);
        if (!membres.has(username)) membres.set(username, { connexions: new Set(), partiDepuis: null });
        const entree = membres.get(username);
        entree.connexions.add(idConnexion);
        entree.partiDepuis = null;
        return entree.connexions.size;
    }

    /**
     * Une connexion part. La personne n'est absente que lorsque sa DERNIÈRE
     * connexion est partie — fermer un onglet sur trois ne la fait pas sortir.
     */
    function part(nomPool, username, idConnexion) {
        const membres = salons.get(nomPool);
        if (!membres) return 0;
        const entree = membres.get(username);
        if (!entree) return 0;

        entree.connexions.delete(idConnexion);
        if (entree.connexions.size === 0) entree.partiDepuis = maintenant();
        return entree.connexions.size;
    }

    /** Retire une personne du salon pour de bon : elle a cliqué « quitter ». */
    function retirer(nomPool, username) {
        const membres = salons.get(nomPool);
        if (membres) membres.delete(username);
    }

    /** Oublie tout un salon : le pool est parti en repêchage, ou a disparu. */
    function oublier(nomPool) {
        salons.delete(nomPool);
        annulerCompte(nomPool);
    }

    /**
     * Cette personne est-elle présente ?
     *
     * Vraie tant qu'elle a une connexion, ou qu'elle est partie depuis moins
     * que le délai de grâce.
     */
    function estPresent(nomPool, username, graceMs = GRACE_RECONNEXION_MS) {
        const membres = salons.get(nomPool);
        const entree = membres && membres.get(username);
        if (!entree) return false;
        if (entree.connexions.size > 0) return true;
        if (entree.partiDepuis == null) return false;
        return (maintenant() - entree.partiDepuis) < graceMs;
    }

    /** État de présence de chaque participant, pour l'affichage du salon. */
    function etatSalon(nomPool, usernames, graceMs = GRACE_RECONNEXION_MS) {
        return (usernames || []).map(username => {
            const membres = salons.get(nomPool);
            const entree = membres && membres.get(username);
            const connecte = !!entree && entree.connexions.size > 0;
            return {
                username,
                connecte,
                // « Revient peut-être » : parti, mais encore dans le délai.
                enAttenteDeRetour: !connecte && estPresent(nomPool, username, graceMs),
                present: connecte || estPresent(nomPool, username, graceMs)
            };
        });
    }

    /** Tout le monde est-il là ? Condition nécessaire au démarrage. */
    function tousPresents(nomPool, usernames, graceMs = GRACE_RECONNEXION_MS) {
        const noms = usernames || [];
        return noms.length > 0 && noms.every(u => estPresent(nomPool, u, graceMs));
    }

    // ───────────────────────── Compte à rebours ─────────────────────────

    function annulerCompte(nomPool) {
        const compte = comptes.get(nomPool);
        if (!compte) return false;
        if (compte.minuteur) annuler(compte.minuteur);
        comptes.delete(nomPool);
        return true;
    }

    /**
     * Lance le compte à rebours de démarrage.
     *
     * `auTerme` est appelé à la fin — et c'est lui qui revalide sous verrou
     * avant d'écrire quoi que ce soit. Le compte à rebours annonce une
     * intention ; il ne démarre rien tout seul. Un départ pendant ces dix
     * secondes l'annule.
     */
    function lancerCompte(nomPool, auTerme, dureeMs = COMPTE_A_REBOURS_MS) {
        annulerCompte(nomPool);
        const finit = maintenant() + dureeMs;
        const minuteur = minuterie(() => {
            comptes.delete(nomPool);
            Promise.resolve().then(auTerme).catch(() => {});
        }, dureeMs);
        if (minuteur && typeof minuteur.unref === 'function') minuteur.unref();
        comptes.set(nomPool, { finit, minuteur });
        return { finit, dureeMs };
    }

    /** Compte à rebours en cours pour ce salon, ou null. */
    function compteEnCours(nomPool) {
        const compte = comptes.get(nomPool);
        if (!compte) return null;
        return { finit: compte.finit, resteMs: Math.max(0, compte.finit - maintenant()) };
    }

    return {
        GRACE_RECONNEXION_MS,
        COMPTE_A_REBOURS_MS,
        arrive,
        part,
        retirer,
        oublier,
        estPresent,
        etatSalon,
        tousPresents,
        lancerCompte,
        annulerCompte,
        compteEnCours
    };
}

module.exports = { creerPresence, GRACE_RECONNEXION_MS, COMPTE_A_REBOURS_MS };
