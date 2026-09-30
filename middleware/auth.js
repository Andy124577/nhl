/**
 * Identité serveur : la frontière que le corps de la requête ne franchit plus.
 *
 * Avant : /login vérifiait le mot de passe puis renvoyait le nom d'utilisateur,
 * que le navigateur rangeait dans localStorage et recollait dans chaque
 * requête. N'importe qui pouvait donc écrire `username: "quelqu'un d'autre"`
 * et repêcher à sa place. Après : le serveur ouvre une session, le navigateur
 * ne porte qu'un cookie opaque HttpOnly, et `req.auth` est la seule source
 * d'identité que les routes ont le droit de lire.
 *
 * Le nom d'utilisateur continue de circuler dans les corps de requête — des
 * dizaines d'appels client l'envoient — mais il n'est plus cru. Il est comparé
 * à la session, et une divergence est refusée plutôt qu'ignorée : c'est la
 * différence entre « ce champ ne sert plus » et « ce champ servait à mentir ».
 *
 * Deux magasins de sessions. PostgreSQL en service : les sessions survivent au
 * redémarrage et se révoquent. Mode fichier (développement) : un magasin en
 * mémoire, mono-processus, annoncé comme tel — il ne prétend ni durer ni se
 * partager entre instances.
 */

'use strict';

const crypto = require('crypto');
const session = require('../lib/session.js');

/**
 * Magasin de sessions en mémoire, pour le mode fichier.
 *
 * Volontairement pauvre : pas de persistance, pas de partage entre processus.
 * Le mode fichier sert à développer sur un poste ; prétendre le contraire
 * serait la seule chose pire que ne pas l'avoir.
 */
function magasinMemoire() {
    const parEmpreinte = new Map();

    return {
        type: 'memoire',
        async creer(utilisateur, empreinte, expireLe, userAgent, bascule) {
            const ligne = {
                id: crypto.randomUUID(),
                userId: utilisateur.id || utilisateur.username,
                username: utilisateur.username,
                isAdmin: !!utilisateur.isAdmin,
                avatarUrl: utilisateur.avatarUrl || '',
                tokenHash: empreinte,
                createdAt: new Date(),
                lastSeenAt: new Date(),
                expiresAt: expireLe,
                revokedAt: null,
                userAgent: userAgent || null,
                impersonatedBy: (bascule && bascule.impersonatedBy) || null,
                impersonatorUsername: (bascule && bascule.impersonatorUsername) || null
            };
            parEmpreinte.set(empreinte, ligne);
            return ligne;
        },
        async lire(empreinte) {
            return parEmpreinte.get(empreinte) || null;
        },
        async toucher(id) {
            for (const ligne of parEmpreinte.values()) {
                if (ligne.id === id) { ligne.lastSeenAt = new Date(); return; }
            }
        },
        async revoquer(empreinte) {
            const ligne = parEmpreinte.get(empreinte);
            if (!ligne || ligne.revokedAt) return false;
            ligne.revokedAt = new Date();
            return true;
        },
        async revoquerTout(userId) {
            let n = 0;
            for (const ligne of parEmpreinte.values()) {
                if (ligne.userId === userId && !ligne.revokedAt) { ligne.revokedAt = new Date(); n++; }
            }
            return n;
        },
        async purger() {
            const maintenant = Date.now();
            let n = 0;
            for (const [cle, ligne] of parEmpreinte) {
                if (new Date(ligne.expiresAt).getTime() < maintenant) { parEmpreinte.delete(cle); n++; }
            }
            return n;
        }
    };
}

/** Magasin PostgreSQL : durable, révocable, partagé entre instances. */
function magasinPostgres(db) {
    return {
        type: 'postgres',
        async creer(utilisateur, empreinte, expireLe, userAgent, bascule) {
            const ligne = await db.createSession(
                utilisateur.id, empreinte, expireLe, userAgent,
                (bascule && bascule.impersonatedBy) || null
            );
            return {
                ...ligne,
                username: utilisateur.username,
                isAdmin: !!utilisateur.isAdmin,
                impersonatorUsername: (bascule && bascule.impersonatorUsername) || null
            };
        },
        lire: (empreinte) => db.getSessionByTokenHash(empreinte),
        toucher: (id) => db.touchSession(id),
        revoquer: (empreinte) => db.revokeSession(empreinte),
        revoquerTout: (userId) => db.revokeAllSessionsForUser(userId),
        purger: () => db.purgeExpiredSessions()
    };
}

/**
 * Durée pendant laquelle une session lue en base est resservie de mémoire, par
 * défaut. server.js l'allonge quand il est seul à écrire (MEMOIRE_CONFIANCE_MIN) :
 * tout ce qui change une session passe alors par ce magasin et l'efface.
 */
const DUREE_MEMOIRE_SESSION_MS = 60 * 1000;
/** Au-delà, la plus ancienne entrée part : la mémoire reste bornée. */
const MEMOIRE_SESSIONS_MAX = 5000;
/** Même seuil que db.touchSession : `last_seen_at` s'écrit une fois toutes les six heures au plus. */
const TOUCHER_APRES_MS = 6 * 60 * 60 * 1000;

/**
 * Une mémoire courte devant le magasin PostgreSQL.
 *
 * Chaque requête qui portait le cookie relisait sa session en base (deux
 * jointures) puis tentait d'écrire `last_seen_at` : chaque sondage, chaque
 * onglet, chaque connexion socket. C'était la requête la plus fréquente du
 * site, et Neon facture ce qui sort de la base (septembre 2026).
 *
 * Une session lue est resservie pendant `dureeMs`. Ce qui la change passe par
 * ce magasin — déconnexion, déconnexion partout, nouvelle photo de profil — et
 * l'efface aussitôt. Ce qui la change par la bande (un script qui promeut un
 * compte administrateur) se voit au plus tard au bout de ce délai.
 *
 * Le compteur de générations ferme la course « lecture partie avant une
 * révocation, revenue après » : une lecture ne se range que si rien n'a été
 * effacé pendant qu'elle attendait la base.
 */
function avecMemoireCourte(magasin, {
    dureeMs = DUREE_MEMOIRE_SESSION_MS,
    max = MEMOIRE_SESSIONS_MAX,
    maintenant = () => Date.now()
} = {}) {
    const memoire = new Map(); // empreinte → { ligne, lueLe }
    let generation = 0;

    function effacerSi(predicat) {
        generation += 1;
        for (const [empreinte, entree] of memoire) {
            if (predicat(entree.ligne, empreinte)) memoire.delete(empreinte);
        }
    }

    return {
        ...magasin,

        async lire(empreinte) {
            const entree = memoire.get(empreinte);
            if (entree && maintenant() - entree.lueLe < dureeMs) return entree.ligne;

            const avant = generation;
            const ligne = await magasin.lire(empreinte);
            if (generation === avant) {
                memoire.delete(empreinte);
                if (memoire.size >= max) memoire.delete(memoire.keys().next().value);
                memoire.set(empreinte, { ligne, lueLe: maintenant() });
            }
            return ligne;
        },

        /**
         * N'écrit que si la dernière visite connue a plus d'une heure. La base
         * posait déjà cette condition, mais seulement après l'aller-retour.
         */
        async toucher(id, ligne) {
            const vu = ligne && ligne.lastSeenAt ? new Date(ligne.lastSeenAt).getTime() : 0;
            if (maintenant() - vu < TOUCHER_APRES_MS) return;
            // La visite est notée en mémoire avant l'écriture : les requêtes de
            // la même seconde ne la réécrivent pas chacune.
            const vuLe = new Date(maintenant());
            for (const entree of memoire.values()) {
                if (entree.ligne && entree.ligne.id === id) entree.ligne = { ...entree.ligne, lastSeenAt: vuLe };
            }
            await magasin.toucher(id);
        },

        async revoquer(empreinte) {
            const resultat = await magasin.revoquer(empreinte);
            effacerSi((_, cle) => cle === empreinte);
            return resultat;
        },

        async revoquerTout(userId) {
            const resultat = await magasin.revoquerTout(userId);
            effacerSi(ligne => ligne && String(ligne.userId) === String(userId));
            return resultat;
        },

        /** Le compte a changé (photo, droits) : ses sessions seront relues. */
        oublierUtilisateur(username) {
            effacerSi(ligne => ligne && ligne.username === username);
        }
    };
}

/**
 * Méthodes qui modifient quelque chose. Ce sont celles qui exigent une origine
 * vérifiée ; une lecture ne change rien et n'a rien à protéger de ce côté.
 */
const METHODES_MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function creerAuth({ db, usePostgres, secure = true, originesAutorisees = [], memoireSessions = {} } = {}) {
    const magasin = usePostgres ? avecMemoireCourte(magasinPostgres(db), memoireSessions) : magasinMemoire();

    /**
     * Ouvre une session et renvoie l'en-tête Set-Cookie à poser.
     *
     * Le jeton n'est jamais renvoyé dans le corps de la réponse : il ne doit
     * exister que dans le cookie, hors de portée de tout script de la page.
     */
    async function ouvrirSession(res, utilisateur, req, bascule = null) {
        const jeton = session.genererJeton();
        const empreinte = session.empreinteJeton(jeton);
        const expireLe = new Date(Date.now() + session.DUREE_SESSION_MS);

        await magasin.creer(
            utilisateur, empreinte, expireLe,
            req && req.headers && req.headers['user-agent'],
            bascule
        );
        res.setHeader('Set-Cookie', session.cookieSession(jeton, { secure }));
        return { expiresAt: expireLe };
    }

    /** Ferme la session portée par cette requête, et efface le cookie. */
    async function fermerSession(req, res) {
        const cookies = session.lireCookies(req.headers && req.headers.cookie);
        const jeton = cookies[session.NOM_COOKIE];
        let revoquee = false;
        if (jeton) revoquee = await magasin.revoquer(session.empreinteJeton(jeton));
        res.setHeader('Set-Cookie', session.cookieEfface({ secure }));
        return revoquee;
    }

    /** Déconnecte un compte partout — suppression de compte, incident. */
    async function revoquerTout(userId) {
        return magasin.revoquerTout(userId);
    }

    /**
     * Résout la session de chaque requête. N'échoue jamais : une session
     * absente ou invalide laisse simplement `req.auth` à null, et c'est
     * `requireAuth` qui décide si ça bloque.
     */
    async function sessionMiddleware(req, res, next) {
        req.auth = null;
        try {
            const cookies = session.lireCookies(req.headers && req.headers.cookie);
            const jeton = cookies[session.NOM_COOKIE];
            if (!jeton) return next();

            const ligne = await magasin.lire(session.empreinteJeton(jeton));
            if (!session.sessionValide(ligne)) return next();

            req.auth = {
                sessionId: ligne.id,
                userId: ligne.userId,
                username: ligne.username,
                isAdmin: !!ligne.isAdmin,
                avatarUrl: ligne.avatarUrl || '',
                // Renseignes seulement sur une session ouverte par bascule.
                // `isAdmin` reste celui de la personne visee : l'interet du
                // depannage est de voir ce qu'elle voit, pas de garder ses
                // propres pouvoirs en main.
                impersonatedBy: ligne.impersonatedBy || null,
                impersonatorUsername: ligne.impersonatorUsername || null
            };

            // Sans await : marquer l'activité ne doit pas retarder la réponse,
            // et son échec n'invalide pas une session par ailleurs valable.
            Promise.resolve(magasin.toucher(ligne.id, ligne)).catch(() => {});
        } catch (erreur) {
            console.error('⚠️ Résolution de session impossible :', erreur.message);
        }
        next();
    }

    /**
     * Refuse une requête mutante venue d'un autre site.
     *
     * SameSite=Lax bloque déjà le cas courant côté navigateur ; ceci est la
     * serrure qui ne dépend pas du navigateur.
     *
     * Une requête qui n'annonce AUCUNE origine passe : un client non
     * navigateur n'en envoie pas, et aucun cookie ne s'y attache tout seul.
     * Une requête qui en annonce une doit être chez elle.
     */
    function csrfGuard(req, res, next) {
        if (!METHODES_MUTANTES.has(req.method)) return next();

        // Le contrôle s'applique AUSSI aux requêtes non authentifiées.
        // `/login` en est la raison : une page tierce qui poste des
        // identifiants connectera la personne au compte de l'attaquant, et
        // tout ce qu'elle fera ensuite ira dans ce compte. Le cookie n'y est
        // pas encore, mais il y sera au retour.
        const permis = session.origineAutorisee({
            origin: req.headers.origin,
            referer: req.headers.referer,
            host: req.headers.host,
            autorisees: originesAutorisees
        });

        if (!permis) {
            return res.status(403).json({
                message: "Origine non autorisée pour une requête authentifiée.",
                code: 'origine_refusee'
            });
        }
        next();
    }

    /** Porte fermée : il faut une session. */
    function requireAuth(req, res, next) {
        if (!req.auth) {
            return res.status(401).json({
                message: "Vous devez être connecté pour faire cette action.",
                code: 'non_authentifie'
            });
        }
        next();
    }

    /** Administration du site. `is_admin` vient de la base, jamais du client. */
    function requireAdmin(req, res, next) {
        if (!req.auth) {
            return res.status(401).json({ message: "Vous devez être connecté.", code: 'non_authentifie' });
        }
        if (!req.auth.isAdmin) {
            return res.status(403).json({ message: "Action réservée à l'administration.", code: 'non_admin' });
        }
        next();
    }

    /**
     * Le poste de pilotage de la bascule — et rien de plus.
     *
     * Ouvre trois choses à une session ouverte par bascule : lister les
     * comptes, basculer encore, revenir chez soi. Volontairement séparée de
     * `requireAdmin` : une session de bascule n'est PAS une session
     * d'administration. Si elle l'était, l'administration verrait partout des
     * boutons que la personne dépannée n'a pas, et le dépannage mentirait sur
     * ce qu'elle vit. Toute future route d'administration reste donc derrière
     * `requireAdmin`, qui ne connaît que la colonne `is_admin`.
     */
    function requireBascule(req, res, next) {
        if (!req.auth) {
            return res.status(401).json({ message: "Vous devez être connecté.", code: 'non_authentifie' });
        }
        if (!req.auth.isAdmin && !req.auth.impersonatedBy) {
            return res.status(403).json({ message: "Action réservée à l'administration.", code: 'non_admin' });
        }
        next();
    }

    /**
     * L'identité à utiliser, à partir de la session — et rien d'autre.
     *
     * Si la requête porte aussi un nom d'utilisateur (des dizaines d'appels
     * client en envoient encore), il doit correspondre. Une divergence est
     * refusée plutôt qu'ignorée : c'est le signal qu'un client essaie d'agir
     * au nom de quelqu'un d'autre, ou qu'un onglet resté ouvert travaille sous
     * une ancienne identité — les deux méritent une erreur claire.
     */
    function identite(req, nomFourni) {
        if (!req.auth) return { ok: false, code: 401, message: "Vous devez être connecté." };
        const fourni = typeof nomFourni === 'string' ? nomFourni.trim() : '';
        if (fourni && fourni !== req.auth.username && !req.auth.isAdmin) {
            return {
                ok: false,
                code: 403,
                message: "Cette action ne correspond pas au compte connecté. Reconnectez-vous."
            };
        }
        return { ok: true, username: req.auth.username, userId: req.auth.userId, isAdmin: req.auth.isAdmin };
    }

    /**
     * Identité d'une connexion Socket.IO, lue au même endroit que celle des
     * requêtes HTTP. Une session est une session : le canal temps réel ne peut
     * pas être la porte de service.
     */
    async function identifierSocket(handshake) {
        try {
            const cookies = session.lireCookies(handshake && handshake.headers && handshake.headers.cookie);
            const jeton = cookies[session.NOM_COOKIE];
            if (!jeton) return null;
            const ligne = await magasin.lire(session.empreinteJeton(jeton));
            if (!session.sessionValide(ligne)) return null;
            return {
                userId: ligne.userId,
                username: ligne.username,
                isAdmin: !!ligne.isAdmin
            };
        } catch (erreur) {
            console.error('⚠️ Identification socket impossible :', erreur.message);
            return null;
        }
    }

    return {
        magasin,
        sessionMiddleware,
        csrfGuard,
        requireAuth,
        requireAdmin,
        requireBascule,
        identite,
        identifierSocket,
        ouvrirSession,
        fermerSession,
        revoquerTout,
        /** À appeler quand une colonne de `users` lue par la session change. */
        oublierUtilisateur: (username) => { if (magasin.oublierUtilisateur) magasin.oublierUtilisateur(username); },
        purger: () => magasin.purger()
    };
}

module.exports = { creerAuth, magasinMemoire, avecMemoireCourte, METHODES_MUTANTES };
