/**
 * Les tentatives de mot de passe : combien on en laisse, et à qui.
 *
 * Aucune route ne comptait les échecs : `/login`, `/admin-login`, le
 * rattachement Google et l'entrée dans un pool protégé acceptaient autant
 * d'essais qu'on voulait en envoyer. Avec un minimum de six caractères, un
 * mot de passe faible tombait en quelques milliers de requêtes.
 *
 * Deux compteurs par espace (`connexion`, `pool`) :
 *
 *   - par COMPTE visé (ou par pool) : quelques essais libres, puis une attente
 *     qui double à chaque nouvel échec, plafonnée. C'est la vraie protection,
 *     et elle ne dépend pas de l'adresse : changer d'adresse ne rend aucun
 *     essai. Un nom qui n'existe pas se compte comme un autre — sinon le refus
 *     dirait quels noms existent ;
 *   - par ADRESSE : contre celui qui essaie un mot de passe courant sur tous
 *     les comptes à la fois. Une réussite ne la remet pas à zéro : se
 *     connecter à son propre compte entre deux essais ne doit rien racheter.
 *
 * Une réussite efface le compteur du compte. Un compteur oublié depuis une
 * heure repart de zéro.
 *
 * En mémoire : une seule instance sert le site (Render gratuit). Un
 * redémarrage efface les compteurs, ce qui ne rend que quelques essais.
 */

'use strict';

const MINUTE = 60 * 1000;

/** Ce que chaque espace laisse passer. */
const REGLES = {
    connexion: {
        compte: { libres: 5, attenteMs: MINUTE, plafondMs: 15 * MINUTE },
        adresse: { libres: 30, attenteMs: 15 * MINUTE, plafondMs: 15 * MINUTE }
    },
    // Le mot de passe d'un pool se partage entre amis et tient en 4 caractères :
    // un peu plus d'essais libres, la même attente ensuite.
    pool: {
        compte: { libres: 10, attenteMs: MINUTE, plafondMs: 15 * MINUTE },
        adresse: { libres: 30, attenteMs: 15 * MINUTE, plafondMs: 15 * MINUTE }
    }
};

/** Un compteur sans échec depuis ce délai repart de zéro. */
const OUBLI_MS = 60 * MINUTE;

/** Au-delà, les entrées les plus anciennes partent : la mémoire reste bornée. */
const ENTREES_MAX = 20000;

/** Une clé de compte : sans casse, bornée en longueur. */
function cleCompte(valeur) {
    return String(valeur == null ? '' : valeur).trim().toLowerCase().slice(0, 100);
}

/**
 * L'adresse du client, telle que la voit le premier proxy de confiance.
 *
 * Render ajoute l'adresse qu'il voit à la FIN de X-Forwarded-For sans
 * nettoyer ce que le client y a mis : le début de la liste se falsifie. Render
 * passe par Cloudflare, qui pose CF-Connecting-IP et écrase celui que le
 * client enverrait : c'est celui-là qui fait foi. À défaut (hors Render), le
 * début de X-Forwarded-For, puis l'adresse de la connexion — en sachant que
 * le compteur par compte, lui, ne dépend d'aucune adresse.
 */
function adresseClient(req) {
    const entetes = (req && req.headers) || {};
    const cloudflare = typeof entetes['cf-connecting-ip'] === 'string' ? entetes['cf-connecting-ip'].trim() : '';
    if (cloudflare) return cloudflare;
    const relayee = typeof entetes['x-forwarded-for'] === 'string' ? entetes['x-forwarded-for'].split(',')[0].trim() : '';
    if (relayee) return relayee;
    return (req && (req.ip || (req.socket && req.socket.remoteAddress))) || 'inconnue';
}

function creerLimiteTentatives({ regles = REGLES, horloge = () => Date.now(), max = ENTREES_MAX } = {}) {
    /** clé → { echecs, dernier, bloqueJusqua } */
    const compteurs = new Map();

    function lire(cle) {
        const entree = compteurs.get(cle);
        if (!entree) return null;
        if (horloge() - entree.dernier > OUBLI_MS) {
            compteurs.delete(cle);
            return null;
        }
        return entree;
    }

    function cles(espace, { compte, adresse }) {
        const sortie = [];
        if (compte != null && cleCompte(compte)) sortie.push({ cle: `${espace}|compte|${cleCompte(compte)}`, regle: 'compte' });
        if (adresse) sortie.push({ cle: `${espace}|adresse|${adresse}`, regle: 'adresse' });
        return sortie;
    }

    function regleDe(espace) {
        const regle = regles[espace];
        if (!regle) throw new Error(`Espace de tentatives inconnu : ${espace}`);
        return regle;
    }

    /** Combien de millisecondes attendre avant le prochain essai ; 0 s'il est permis. */
    function attente(espace, qui) {
        regleDe(espace);
        let reste = 0;
        for (const { cle } of cles(espace, qui)) {
            const entree = lire(cle);
            if (entree && entree.bloqueJusqua > horloge()) reste = Math.max(reste, entree.bloqueJusqua - horloge());
        }
        return reste;
    }

    /** Un essai raté : compté pour le compte et pour l'adresse. */
    function echec(espace, qui) {
        const regle = regleDe(espace);
        const maintenant = horloge();
        for (const { cle, regle: type } of cles(espace, qui)) {
            const { libres, attenteMs, plafondMs } = regle[type];
            const entree = lire(cle) || { echecs: 0, dernier: maintenant, bloqueJusqua: 0 };
            entree.echecs += 1;
            entree.dernier = maintenant;
            if (entree.echecs > libres) {
                const duree = Math.min(plafondMs, attenteMs * 2 ** (entree.echecs - libres - 1));
                entree.bloqueJusqua = maintenant + duree;
            }
            compteurs.delete(cle);
            compteurs.set(cle, entree);
        }
        while (compteurs.size > max) compteurs.delete(compteurs.keys().next().value);
    }

    /** Un essai réussi : le compte repart de zéro, pas l'adresse. */
    function reussite(espace, { compte }) {
        regleDe(espace);
        if (compte != null && cleCompte(compte)) compteurs.delete(`${espace}|compte|${cleCompte(compte)}`);
    }

    return { attente, echec, reussite, taille: () => compteurs.size };
}

/** « Trop de tentatives » : la réponse 429, avec le délai à attendre. */
function refuserTropDeTentatives(res, attenteMs) {
    const secondes = Math.max(1, Math.ceil(attenteMs / 1000));
    const minutes = Math.ceil(secondes / 60);
    res.setHeader('Retry-After', String(secondes));
    return res.status(429).json({
        message: `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`,
        code: 'trop_de_tentatives',
        retryAfter: secondes
    });
}

module.exports = { REGLES, OUBLI_MS, creerLimiteTentatives, adresseClient, refuserTropDeTentatives };
