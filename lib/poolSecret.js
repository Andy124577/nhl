/**
 * Le mot de passe d'un pool, lisible par la personne qui l'a créé.
 *
 * L'empreinte bcrypt (`passwordHash`) reste la seule chose qui sert à ouvrir
 * la porte : elle ne se lit pas à l'envers, et c'est voulu. Mais la personne
 * qui a créé le pool doit pouvoir retrouver le mot de passe qu'elle a donné
 * à ses amis sans le réinventer. On en garde donc AUSSI une copie chiffrée
 * (`passwordSecret`), en AES-256-GCM, avec une clé qui ne vit que dans
 * l'environnement du serveur — jamais dans la base ni dans les données du
 * pool. Une copie de la base seule ne suffit pas à lire un mot de passe.
 *
 * Plusieurs clés peuvent coexister : la première chiffre, toutes déchiffrent.
 * Poser POOL_PASSWORD_KEY après coup ne rend donc pas illisibles les mots de
 * passe chiffrés avec la clé de repli.
 *
 * Pur : ni base, ni réseau, ni horloge. La résolution des clés depuis
 * l'environnement est séparée (`clesDepuisEnvironnement`) et reçoit ses
 * lectures de fichier en paramètre.
 */

'use strict';

const crypto = require('crypto');

const VERSION = 'v1';
const LONGUEUR_IV = 12;
const LONGUEUR_TAG = 16;

/** Une clé de 32 octets à partir de n'importe quelle chaîne. */
function deriverCle(materiau, contexte = 'fantazy:pool-password') {
    return crypto.scryptSync(String(materiau), contexte, 32);
}

/**
 * Le coffre : chiffrer et déchiffrer un mot de passe de pool.
 *
 * `cles` : liste de Buffer de 32 octets, la première sert à chiffrer.
 */
function creerCoffre(cles) {
    const liste = (cles || []).filter(c => Buffer.isBuffer(c) && c.length === 32);
    if (liste.length === 0) throw new Error('Coffre des mots de passe de pool : aucune clé valide.');

    function chiffrer(texte) {
        const iv = crypto.randomBytes(LONGUEUR_IV);
        const chiffreur = crypto.createCipheriv('aes-256-gcm', liste[0], iv);
        const corps = Buffer.concat([chiffreur.update(String(texte), 'utf8'), chiffreur.final()]);
        const tag = chiffreur.getAuthTag();
        return `${VERSION}:${Buffer.concat([iv, tag, corps]).toString('base64')}`;
    }

    /** Renvoie le texte clair, ou null si aucune clé ne l'ouvre. */
    function dechiffrer(jeton) {
        if (typeof jeton !== 'string' || !jeton.startsWith(`${VERSION}:`)) return null;
        let brut;
        try { brut = Buffer.from(jeton.slice(VERSION.length + 1), 'base64'); } catch { return null; }
        if (brut.length <= LONGUEUR_IV + LONGUEUR_TAG) return null;
        const iv = brut.subarray(0, LONGUEUR_IV);
        const tag = brut.subarray(LONGUEUR_IV, LONGUEUR_IV + LONGUEUR_TAG);
        const corps = brut.subarray(LONGUEUR_IV + LONGUEUR_TAG);
        for (const cle of liste) {
            try {
                const dechiffreur = crypto.createDecipheriv('aes-256-gcm', cle, iv);
                dechiffreur.setAuthTag(tag);
                return Buffer.concat([dechiffreur.update(corps), dechiffreur.final()]).toString('utf8');
            } catch { /* clé suivante */ }
        }
        return null;
    }

    return { chiffrer, dechiffrer };
}

/**
 * Les clés du serveur, de la plus souhaitable à la moins souhaitable.
 *
 *   1. POOL_PASSWORD_KEY — la vraie clé, posée dans l'environnement ;
 *   2. DATABASE_URL — repli stable en production : l'adresse de la base porte
 *      son mot de passe, et ne se trouve pas dans une copie de la base ;
 *   3. un fichier local généré une fois — mode fichier, développement. Les
 *      pools vivent alors eux aussi sur ce disque.
 */
function clesDepuisEnvironnement(env, { lireFichier, ecrireFichier, cheminFichier } = {}) {
    const cles = [];
    if (env.POOL_PASSWORD_KEY) cles.push(deriverCle(env.POOL_PASSWORD_KEY));
    if (env.DATABASE_URL) cles.push(deriverCle(env.DATABASE_URL, 'fantazy:pool-password:db'));
    if (cles.length > 0) return cles;

    let materiau = null;
    try { materiau = lireFichier ? String(lireFichier(cheminFichier) || '').trim() : null; } catch { materiau = null; }
    if (!materiau) {
        materiau = crypto.randomBytes(32).toString('base64');
        try { if (ecrireFichier) ecrireFichier(cheminFichier, materiau); } catch { /* clé de session seulement */ }
    }
    cles.push(deriverCle(materiau, 'fantazy:pool-password:local'));
    return cles;
}

module.exports = { creerCoffre, clesDepuisEnvironnement, deriverCle };
