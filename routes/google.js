/**
 * Connexion et inscription avec Google.
 *
 * Le parcours :
 *
 *   GET  /auth/google            → part chez Google (état + PKCE en cookie)
 *   GET  /auth/google/callback   → revient ; compte connu : session ouverte,
 *                                  sinon identité mise en attente
 *   GET  /auth/google/attente    → ce que la page d'inscription affiche
 *   POST /auth/google/creer      → choisit un nom, crée le compte
 *   POST /auth/google/lier       → rattache Google à un compte existant
 *
 * Le nom d'utilisateur ne vient pas de Google : c'est lui que voient les
 * autres membres des pools, il se choisit. D'où l'étape d'attente entre le
 * retour de Google et la création du compte.
 *
 * Une connexion Google aboutit à la MÊME session que /login : un cookie
 * opaque HttpOnly, et `req.auth` comme seule source d'identité ensuite.
 */

'use strict';

const google = require('../lib/googleAuth.js');
const session = require('../lib/session.js');
const { contientGrossierete } = require('../profanity.js');
const { ECHEC_CONNEXION } = require('./identity.js');

const ATTENTE_EXPIREE = "Votre connexion Google a expiré. Recommencez.";
const NOM_GROSSIER = "Ce nom d'utilisateur contient un terme inapproprié. Choisissez-en un autre.";
const NOM_PRIS = "Ce nom d'utilisateur est déjà pris.";

function monter(app, ctx) {
    const { auth, db, usePostgres, chargerUtilisateurs, sauvegarderUtilisateurs,
            identite, config = {}, secure = true, logger = console } = ctx;
    const fetchHttp = ctx.fetch || globalThis.fetch;
    const { clientId, clientSecret, redirectUri: redirectFixe } = config;

    const actif = () => !!(clientId && clientSecret);

    /**
     * L'adresse de retour déclarée à Google. Elle doit figurer telle quelle
     * dans la console Google Cloud. Déduite de la requête par défaut, pour
     * que le cookie d'état posé sur cet hôte revienne sur ce même hôte
     * (localhost et 127.0.0.1 sont deux sites distincts pour un cookie).
     */
    function redirectUriDe(req) {
        if (redirectFixe) return redirectFixe;
        const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
        return `${proto}://${req.headers.host}/auth/google/callback`;
    }

    const pageDeRetour = (depuis) => (depuis === 'signup' ? '/signup.html' : '/login.html');

    /**
     * Ajoute un Set-Cookie sans écraser ceux déjà posés. `ouvrirSession` pose
     * le sien avec setHeader : on l'appelle donc en premier, puis on ajoute.
     */
    function ajouterCookie(res, valeur) {
        const actuel = res.getHeader('Set-Cookie');
        res.setHeader('Set-Cookie', [...(actuel == null ? [] : [].concat(actuel)), valeur]);
    }

    const effacer = (nom) => google.cookie(nom, '', { maxAge: 0, secure });

    function attenteDe(req) {
        const cookies = session.lireCookies(req.headers && req.headers.cookie);
        return google.lireAttente(cookies[google.COOKIE_ATTENTE], clientSecret);
    }

    async function compteGoogle(sub) {
        if (usePostgres) return db.getUserByGoogleSub(sub);
        const utilisateurs = await chargerUtilisateurs();
        return utilisateurs.find(u => u.googleSub === sub) || null;
    }

    const nomPris = async (nom) => !!(await identite.lireCompte(nom));

    async function connecter(req, res, compte) {
        await auth.ouvrirSession(res, {
            id: await identite.identifiantDe(compte.username),
            username: compte.username,
            isAdmin: !!compte.isAdmin,
            avatarUrl: compte.avatarUrl || ''
        }, req);
    }

    const reponseCompte = (compte, message) => ({
        message,
        username: compte.username,
        avatarUrl: compte.avatarUrl || '',
        isAdmin: !!compte.isAdmin
    });

    // ───────────────────────────── Aller ─────────────────────────────

    /** Les pages masquent le bouton tant que les clés ne sont pas posées. */
    app.get('/auth/google/config', (req, res) => {
        res.json({ enabled: actif() });
    });

    app.get('/auth/google', (req, res) => {
        const depuis = req.query && req.query.depuis === 'signup' ? 'signup' : 'login';
        if (!actif()) return res.redirect(`${pageDeRetour(depuis)}?google=indisponible`);

        const etat = google.aleatoire();
        const { verificateur, defi } = google.genererPkce();
        // base64url n'emploie jamais le point : il sépare sans ambiguïté.
        res.setHeader('Set-Cookie', google.cookie(
            google.COOKIE_ETAT, `${etat}.${verificateur}.${depuis}`,
            { maxAge: google.DUREE_ETAT_S, secure }
        ));
        res.redirect(google.urlAutorisation({ clientId, redirectUri: redirectUriDe(req), etat, defi }));
    });

    // ───────────────────────────── Retour ─────────────────────────────

    app.get('/auth/google/callback', async (req, res) => {
        const cookies = session.lireCookies(req.headers && req.headers.cookie);
        const [etatAttendu, verificateur, depuisBrut] = String(cookies[google.COOKIE_ETAT] || '').split('.');
        const depuis = depuisBrut === 'signup' ? 'signup' : 'login';
        const requete = req.query || {};

        const echec = (code) => {
            ajouterCookie(res, effacer(google.COOKIE_ETAT));
            res.redirect(`${pageDeRetour(depuis)}?google=${code}`);
        };

        if (!actif()) return echec('indisponible');
        if (requete.error) return echec(requete.error === 'access_denied' ? 'annule' : 'erreur');

        // L'état prouve que ce retour conclut un aller parti de CE navigateur.
        // Sans lui, une page tierce pourrait y renvoyer quelqu'un avec le code
        // d'un autre compte et le connecter à l'insu de tous.
        const etatRecu = typeof requete.state === 'string' ? requete.state : '';
        if (!etatAttendu || !verificateur || !session.empreintesEgales(etatRecu, etatAttendu)) {
            return echec('expire');
        }
        const code = typeof requete.code === 'string' ? requete.code : '';
        if (!code) return echec('erreur');

        try {
            const reponse = await fetchHttp(google.URL_JETON, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: google.corpsEchange({ code, clientId, clientSecret, redirectUri: redirectUriDe(req), verificateur }),
                signal: AbortSignal.timeout(10000)
            });
            const jetons = await reponse.json().catch(() => ({}));
            if (!reponse.ok) {
                logger.error('Échange Google refusé :', jetons.error || reponse.status);
                return echec('erreur');
            }

            const profil = google.lireJetonIdentite(jetons.id_token, { clientId });
            if (!profil) {
                logger.error("Jeton d'identité Google refusé (émetteur, audience ou expiration).");
                return echec('erreur');
            }

            const compte = await compteGoogle(profil.sub);
            if (compte) {
                await connecter(req, res, compte);
                ajouterCookie(res, effacer(google.COOKIE_ETAT));
                logger.log(`✅ Connexion Google : ${compte.username}`);
                // login.html recopie la session dans localStorage, que le
                // reste du site lit encore, puis file vers l'accueil.
                return res.redirect('/login.html?google=ok');
            }

            res.setHeader('Set-Cookie', [
                effacer(google.COOKIE_ETAT),
                google.cookie(google.COOKIE_ATTENTE, google.scellerAttente(profil, clientSecret),
                    { maxAge: google.DUREE_ATTENTE_S, secure })
            ]);
            return res.redirect('/signup.html?google=nouveau');
        } catch (erreur) {
            logger.error('Erreur de connexion Google :', erreur);
            return echec('erreur');
        }
    });

    // ───────────────────── Première connexion : le nom ─────────────────────

    app.get('/auth/google/attente', async (req, res) => {
        const profil = attenteDe(req);
        if (!profil) return res.status(404).json({ message: ATTENTE_EXPIREE, code: 'attente_expiree' });

        let suggestion = '';
        try {
            const base = google.nomPropose(profil);
            if (base && !contientGrossierete(base)) suggestion = await google.nomDisponible(base, nomPris);
        } catch { /* la suggestion est un confort : son échec laisse le champ vide */ }

        res.json({ email: profil.email || '', nom: profil.nom || '', suggestion });
    });

    app.post('/auth/google/creer', async (req, res) => {
        try {
            const profil = attenteDe(req);
            if (!profil) return res.status(401).json({ message: ATTENTE_EXPIREE, code: 'attente_expiree' });

            const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
            const invalide = google.erreurNom(username);
            if (invalide) return res.status(400).json({ message: invalide });
            if (contientGrossierete(username)) return res.status(400).json({ message: NOM_GROSSIER });

            // Un double clic, ou un second onglet, a peut-être déjà créé le
            // compte : on connecte à celui-là plutôt que d'en ouvrir un autre.
            let compte = await compteGoogle(profil.sub);
            if (!compte) {
                if (await nomPris(username)) return res.status(409).json({ message: NOM_PRIS });

                // Pas de mot de passe : ce compte ne s'ouvre que par Google.
                if (usePostgres) {
                    await db.createUser(username, null, false, profil.sub);
                } else {
                    const utilisateurs = await chargerUtilisateurs();
                    utilisateurs.push({ username, password: null, isAdmin: false, googleSub: profil.sub });
                    await sauvegarderUtilisateurs(utilisateurs);
                }
                compte = { username, isAdmin: false, avatarUrl: '' };
                logger.log(`✅ Compte créé avec Google : ${username}`);
            }

            await connecter(req, res, compte);
            ajouterCookie(res, effacer(google.COOKIE_ATTENTE));
            res.json(reponseCompte(compte, 'Inscription réussie.'));
        } catch (erreur) {
            // L'index unique a tranché une course entre deux créations.
            if (erreur && erreur.message === 'Username already exists') {
                return res.status(409).json({ message: NOM_PRIS });
            }
            logger.error('Erreur à la création de compte Google :', erreur);
            res.status(500).json({ message: "Erreur interne du serveur." });
        }
    });

    /**
     * Rattacher Google à un compte qui existe déjà.
     *
     * Sans ce chemin, une personne inscrite par mot de passe qui clique
     * « Continuer avec Google » se verrait proposer un second compte, vide.
     * Le mot de passe est exigé : c'est lui qui prouve que le compte est le
     * sien, pas la connexion Google.
     */
    app.post('/auth/google/lier', async (req, res) => {
        try {
            const profil = attenteDe(req);
            if (!profil) return res.status(401).json({ message: ATTENTE_EXPIREE, code: 'attente_expiree' });

            const { username, password } = req.body || {};
            const compte = await identite.verifier(username, password);
            if (!compte) return res.status(401).json({ message: ECHEC_CONNEXION });

            if (compte.googleSub && compte.googleSub !== profil.sub) {
                return res.status(409).json({ message: "Ce compte Fantazy est déjà lié à un autre compte Google." });
            }
            const dejaLie = await compteGoogle(profil.sub);
            if (dejaLie && dejaLie.username !== compte.username) {
                return res.status(409).json({ message: "Ce compte Google est déjà lié à un autre compte Fantazy." });
            }

            if (usePostgres) {
                if (!(await db.linkGoogleAccount(compte.username, profil.sub))) {
                    return res.status(409).json({ message: "Ce compte Fantazy est déjà lié à un autre compte Google." });
                }
            } else {
                const utilisateurs = await chargerUtilisateurs();
                const ligne = utilisateurs.find(u => u.username === compte.username);
                if (ligne) ligne.googleSub = profil.sub;
                await sauvegarderUtilisateurs(utilisateurs);
            }

            await connecter(req, res, compte);
            ajouterCookie(res, effacer(google.COOKIE_ATTENTE));
            logger.log(`🔗 Compte lié à Google : ${compte.username}`);
            res.json(reponseCompte(compte, 'Compte lié à Google.'));
        } catch (erreur) {
            if (erreur && erreur.code === '23505') {
                return res.status(409).json({ message: "Ce compte Google est déjà lié à un autre compte Fantazy." });
            }
            logger.error('Erreur au rattachement Google :', erreur);
            res.status(500).json({ message: "Erreur interne du serveur." });
        }
    });
}

module.exports = { monter };
