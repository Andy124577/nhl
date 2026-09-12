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
        async creer(utilisateur, empreinte, expireLe, userAgent) {
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
                userAgent: userAgent || null
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
        async creer(utilisateur, empreinte, expireLe, userAgent) {
            const ligne = await db.createSession(utilisateur.id, empreinte, expireLe, userAgent);
            return { ...ligne, username: utilisateur.username, isAdmin: !!utilisateur.isAdmin };
        },
        lire: (empreinte) => db.getSessionByTokenHash(empreinte),
        toucher: (id) => db.touchSession(id),
        revoquer: (empreinte) => db.revokeSession(empreinte),
        revoquerTout: (userId) => db.revokeAllSessionsForUser(userId),
        purger: () => db.purgeExpiredSessions()
    };
}

/**
 * Méthodes qui modifient quelque chose. Ce sont celles qui exigent une origine
 * vérifiée ; une lecture ne change rien et n'a rien à protéger de ce côté.
 */
const METHODES_MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function creerAuth({ db, usePostgres, secure = true, originesAutorisees = [] } = {}) {
    const magasin = usePostgres ? magasinPostgres(db) : magasinMemoire();

    /**
     * Ouvre une session et renvoie l'en-tête Set-Cookie à poser.
     *
     * Le jeton n'est jamais renvoyé dans le corps de la réponse : il ne doit
     * exister que dans le cookie, hors de portée de tout script de la page.
     */
    async function ouvrirSession(res, utilisateur, req) {
        const jeton = session.genererJeton();
        const empreinte = session.empreinteJeton(jeton);
        const expireLe = new Date(Date.now() + session.DUREE_SESSION_MS);

        await magasin.creer(utilisateur, empreinte, expireLe, req && req.headers && req.headers['user-agent']);
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
                avatarUrl: ligne.avatarUrl || ''
            };

            // Sans await : marquer l'activité ne doit pas retarder la réponse,
            // et son échec n'invalide pas une session par ailleurs valable.
            Promise.resolve(magasin.toucher(ligne.id)).catch(() => {});
        } catch (erreur) {
            console.error('⚠️ Résolution de session impossible :', erreur.message);
        }
        next();
    }

    /**
     * Refuse une requête mutante venue d'un autre site.
     *
     * SameSite=Lax bloque déjà le cas courant côté navigateur ; ceci est la
     * serrure qui ne dépend pas du navigateur. Les requêtes non authentifiées
     * passent : sans cookie, il n'y a pas d'autorité à emprunter.
     */
    function csrfGuard(req, res, next) {
        if (!METHODES_MUTANTES.has(req.method)) return next();
        if (!req.auth) return next();

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
        identite,
        identifierSocket,
        ouvrirSession,
        fermerSession,
        revoquerTout,
        purger: () => magasin.purger()
    };
}

module.exports = { creerAuth, magasinMemoire, METHODES_MUTANTES };
