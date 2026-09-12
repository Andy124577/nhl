#!/usr/bin/env node
/**
 * Taille la clé que la fermeture de `/admin-login` a laissée manquante.
 *
 * Avant, l'administration tenait à un mot de passe écrit dans le dépôt :
 * `admin` / `zubzub`, comparé en dur dans la route. Ce couple est parti avec
 * l'identité serveur, et `/admin-login` exige désormais un vrai compte dont la
 * colonne `is_admin` est vraie. Seulement rien, nulle part, ne mettait jamais
 * cette colonne à vrai : `/signup` crée `is_admin = false`, la migration la
 * déclare `DEFAULT FALSE`, et aucune route ne la modifie. La porte était donc
 * fermée sans clé. C'est ce script qui la taille, et il est le seul chemin —
 * il n'y a volontairement pas de route HTTP pour se promettre administrateur.
 *
 * Le compte est un compte comme un autre : même table, même empreinte bcrypt,
 * même connexion. Seule la colonne le distingue.
 *
 * Usage :
 *   node tools/creer-admin.js <nom>                     mot de passe tiré au sort
 *   node tools/creer-admin.js <nom> --mot-de-passe <m>  mot de passe choisi
 *
 *   node tools/creer-admin.js <nom> --sql                 n'écrit rien, imprime
 *                                                         le SQL à coller dans
 *                                                         la console web de la base
 *
 * Le magasin est choisi comme le serveur le choisit : PostgreSQL si
 * DATABASE_URL est présent, sinon users.json. Sur un compte qui existe déjà,
 * le script promeut sans toucher au mot de passe, à moins qu'on en donne un.
 */

'use strict';

require('dotenv').config();

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { contientGrossierete } = require('../profanity.js');

// Les mêmes règles que `/signup`, pour la même raison : bcrypt ignore
// silencieusement tout octet au-delà du 72e, et un compte créé ici doit
// pouvoir se reconnecter par la porte normale.
const LONGUEUR_MIN = 6;
const LONGUEUR_MAX = 72;
const TOURS_BCRYPT = 10;

const USE_POSTGRES = !!process.env.DATABASE_URL;
const DATA_DIR = process.env.NODE_ENV === 'production' ? '/opt/render/project/src/data' : '.';
const USERS_FILE = path.join(DATA_DIR, 'users.json');

/** Mot de passe tiré au sort : 32 caractères base64url, ~192 bits. */
function motDePasseAleatoire() {
    return crypto.randomBytes(24).toString('base64url');
}

function lireArguments(argv) {
    const positionnels = [];
    let motDePasse = null;
    let sql = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--sql') {
            sql = true;
        } else if (arg === '--mot-de-passe' || arg === '--password') {
            motDePasse = argv[++i];
            if (motDePasse === undefined) throw new Error(`${arg} attend une valeur.`);
        } else if (arg.startsWith('--')) {
            throw new Error(`Option inconnue : ${arg}`);
        } else {
            positionnels.push(arg);
        }
    }

    if (positionnels.length !== 1) {
        throw new Error('Usage : node tools/creer-admin.js <nom> [--mot-de-passe <mot de passe>]');
    }

    return { nom: positionnels[0].trim(), motDePasse, sql };
}

/** Les contrôles de `/signup`, pour ne pas créer par ici un compte qu'il refuserait. */
function valider(nom, motDePasse) {
    if (!nom) throw new Error("Le nom d'utilisateur est vide.");
    if (nom.length > 40) throw new Error("Le nom d'utilisateur ne peut pas dépasser 40 caractères.");
    if (contientGrossierete(nom)) throw new Error("Ce nom d'utilisateur contient un terme inapproprié.");

    if (motDePasse !== null) {
        const taille = Buffer.byteLength(String(motDePasse), 'utf8');
        if (taille < LONGUEUR_MIN || taille > LONGUEUR_MAX) {
            throw new Error(`Le mot de passe doit contenir entre ${LONGUEUR_MIN} et ${LONGUEUR_MAX} octets.`);
        }
    }
}

/** Magasin fichier : users.json, le tableau que `loadUsers` lit au démarrage. */
const magasinFichier = {
    nom: `users.json (${path.resolve(USERS_FILE)})`,
    lire() {
        try {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
        } catch (erreur) {
            if (erreur.code === 'ENOENT') return [];
            throw erreur;
        }
    },
    async creer(nom, empreinte) {
        const utilisateurs = this.lire();
        utilisateurs.push({ username: nom, password: empreinte, isAdmin: true });
        fs.writeFileSync(USERS_FILE, JSON.stringify(utilisateurs, null, 2));
    },
    async promouvoir(nom, empreinte) {
        const utilisateurs = this.lire();
        const compte = utilisateurs.find(u => u.username === nom);
        compte.isAdmin = true;
        if (empreinte) compte.password = empreinte;
        fs.writeFileSync(USERS_FILE, JSON.stringify(utilisateurs, null, 2));
    },
    async lireCompte(nom) {
        const compte = this.lire().find(u => u.username === nom);
        return compte ? { username: compte.username, isAdmin: !!compte.isAdmin } : null;
    },
    async fermer() {}
};

/** Magasin PostgreSQL : la table `users`, celle que `/admin-login` interroge. */
function magasinPostgres() {
    const db = require('../db.js');
    return {
        nom: 'PostgreSQL (table users)',
        async creer(nom, empreinte) {
            await db.createUser(nom, empreinte, true);
        },
        async promouvoir(nom, empreinte) {
            if (empreinte) {
                await db.query('UPDATE users SET is_admin = TRUE, password = $2 WHERE username = $1', [nom, empreinte]);
            } else {
                await db.query('UPDATE users SET is_admin = TRUE WHERE username = $1', [nom]);
            }
        },
        async lireCompte(nom) {
            const compte = await db.getUserByUsername(nom);
            return compte ? { username: compte.username, isAdmin: !!compte.isAdmin } : null;
        },
        fermer: () => db.pool.end()
    };
}

/**
 * Le SQL equivalent, a coller dans la console web de la base.
 *
 * Sortie de secours quand rien ne peut joindre le port 5432 depuis ce poste —
 * pare-feu, reseau d'entreprise, liste d'adresses permises chez l'hebergeur.
 * L'empreinte est calculee ici : le mot de passe en clair ne quitte pas la
 * machine, et le SQL colle ne contient que du bcrypt.
 *
 * `ON CONFLICT` couvre les deux cas d'un coup — creer le compte, ou promouvoir
 * celui qui existe deja sans toucher a son mot de passe.
 */
function imprimerSql(nom, empreinte) {
    const litteral = (valeur) => `'${String(valeur).replace(/'/g, "''")}'`;

    console.log('');
    console.log('-- A coller dans la console SQL de la base (Neon : onglet « SQL Editor »).');
    console.log(`INSERT INTO users (username, password, is_admin)`);
    console.log(`VALUES (${litteral(nom)}, ${litteral(empreinte)}, TRUE)`);
    console.log(`ON CONFLICT (username) DO UPDATE SET is_admin = TRUE, password = EXCLUDED.password;`);
    console.log('');
    console.log('-- Verification : doit renvoyer une ligne avec is_admin = t');
    console.log(`SELECT username, is_admin FROM users WHERE username = ${litteral(nom)};`);
    console.log('');
}

async function principal() {
    const { nom, motDePasse: fourni, sql } = lireArguments(process.argv.slice(2));
    valider(nom, fourni);

    if (sql) {
        const motDePasse = fourni !== null ? fourni : motDePasseAleatoire();
        const empreinte = await bcrypt.hash(String(motDePasse), TOURS_BCRYPT);
        imprimerSql(nom, empreinte);
        if (fourni === null) {
            console.log('   Mot de passe (affiché une seule fois, notez-le maintenant) :');
            console.log(`   ${motDePasse}`);
            console.log('');
        }
        return;
    }

    const magasin = USE_POSTGRES ? magasinPostgres() : magasinFichier;
    console.log(`🗄️  Magasin : ${magasin.nom}`);

    try {
        const existait = !!(await magasin.lireCompte(nom));

        // Sur un compte existant sans mot de passe donné, on promeut et on n'y
        // touche pas : la personne garde celui qu'elle connaît.
        const motDePasse = fourni !== null ? fourni : (existait ? null : motDePasseAleatoire());
        const empreinte = motDePasse !== null ? await bcrypt.hash(String(motDePasse), TOURS_BCRYPT) : null;

        if (existait) {
            await magasin.promouvoir(nom, empreinte);
            console.log(`✅ Compte « ${nom} » promu administrateur.`);
            if (empreinte) console.log('   Mot de passe remplacé.');
            else console.log('   Mot de passe inchangé.');
        } else {
            await magasin.creer(nom, empreinte);
            console.log(`✅ Compte administrateur « ${nom} » créé.`);
        }

        // Relecture. Sans elle, le script annonce un succes sur la foi d'une
        // ecriture qu'il n'a pas verifiee — et c'est justement contre une base
        // distante, ou personne ne peut regarder, qu'on en a besoin.
        const relu = await magasin.lireCompte(nom);
        if (!relu || !relu.isAdmin) {
            throw new Error(
                `Ecriture non confirmee : apres coup, « ${nom} » ${relu ? "n'est pas administrateur" : 'est introuvable'}.`
            );
        }
        console.log('   Relu depuis le magasin : is_admin = true.');

        if (motDePasse !== null && fourni === null) {
            console.log('');
            console.log('   Mot de passe (affiché une seule fois, notez-le maintenant) :');
            console.log(`   ${motDePasse}`);
            console.log('');
            console.log('   Il n\'est écrit nulle part : la base ne garde que son empreinte bcrypt.');
        }
    } finally {
        await magasin.fermer();
    }
}

principal().catch(erreur => {
    console.error(`❌ ${erreur.message}`);
    process.exit(1);
});
