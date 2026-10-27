/**
 * Les règles d'un compte : le nom d'utilisateur et le mot de passe.
 *
 * Le formulaire d'inscription (signup.html) n'acceptait déjà que lettres,
 * chiffres et « _ », mais `/signup` ne vérifiait que la longueur : un appel
 * direct à la route créait un compte dont le nom portait du HTML, affiché
 * ensuite chez les autres membres d'un pool. La règle vit donc ici, côté
 * serveur, et le formulaire n'en est plus que le reflet.
 *
 * Pur : ni base, ni réseau. Utilisé par /signup, /account/password, la
 * création de compte Google et tools/creer-admin.js.
 */

'use strict';

/** Même règle que le formulaire d'inscription (signup.html). */
const MOTIF_NOM = /^[A-Za-z0-9_]{3,20}$/;

const MOT_DE_PASSE_MIN = 6;

/**
 * bcrypt ignore silencieusement tout ce qui dépasse le 72e OCTET. La limite
 * se comptait en caractères : 40 lettres accentuées font 80 octets, et la fin
 * d'un tel mot de passe n'était jamais vérifiée.
 */
const MOT_DE_PASSE_MAX_OCTETS = 72;

/**
 * Les mots de passe qu'un attaquant essaie en premier : les classiques
 * mondiaux, leurs équivalents québécois et français, et ce qu'un pool de
 * hockey inspire. Comparés sans casse ni accents.
 */
const COURANTS = new Set([
    '123456', '1234567', '12345678', '123456789', '1234567890', '0123456789',
    '111111', '000000', '123123', '654321', '666666', '696969', '121212', '112233',
    'password', 'password1', 'password123', 'passw0rd', 'qwerty', 'qwerty123',
    'qwertyuiop', 'azerty', 'azerty123', 'azertyuiop', 'abc123', 'abcdef',
    'abcd1234', 'iloveyou', 'letmein', 'welcome', 'monkey', 'dragon', 'master',
    'sunshine', 'princess', 'football', 'baseball', 'soccer', 'superman',
    'batman', 'trustno1', 'starwars', 'admin', 'admin123', 'administrator',
    'secret', 'test123', 'testtest', 'changeme', 'motdepasse', 'motdepasse1',
    'bonjour', 'bonjour1', 'soleil', 'chouchou', 'doudou', 'loulou', 'nicolas',
    'marseille', 'jetaime', 'coucou', 'salut', 'quebec', 'montreal', 'canada',
    'hockey', 'hockey1', 'hockey123', 'canadiens', 'habs', 'gohabsgo', 'leafs',
    'bruins', 'oilers', 'nordiques', 'mcdavid', 'crosby', 'gretzky', 'stanley',
    'stanleycup', 'fantazy', 'fantasy', 'pool', 'poolhockey', 'hockeypool'
]);

/** Sans casse ni accents : « Hockey », « HOCKEY » et « hôckey » sont le même essai. */
function reduire(texte) {
    return String(texte == null ? '' : texte)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .trim().toLowerCase();
}

/** Message d'erreur pour un nom refusé, ou null s'il convient. */
function erreurNom(nom) {
    if (!nom) return "Choisissez un nom d'utilisateur.";
    if (nom.length < 3) return "Le nom d'utilisateur doit contenir au moins 3 caractères.";
    if (nom.length > 20) return "Le nom d'utilisateur ne peut pas dépasser 20 caractères.";
    if (!MOTIF_NOM.test(nom)) return "Lettres, chiffres et underscores uniquement.";
    return null;
}

/** Ce mot de passe figure-t-il parmi ceux qu'on essaie en premier ? */
function estCourant(motDePasse) {
    const reduit = reduire(motDePasse);
    if (COURANTS.has(reduit)) return true;
    // Un seul caractère répété : « aaaaaa », « 999999 ».
    return reduit.length > 0 && /^(.)\1*$/u.test(reduit);
}

/**
 * Message d'erreur pour un NOUVEAU mot de passe, ou null s'il convient.
 *
 * Ne s'applique qu'à la création et au changement : un mot de passe déjà
 * enregistré continue d'ouvrir son compte, même s'il ne passerait plus.
 */
function erreurMotDePasse(motDePasse, { username = '' } = {}) {
    if (typeof motDePasse !== 'string' || motDePasse.length === 0) return "Choisissez un mot de passe.";
    if (motDePasse.length < MOT_DE_PASSE_MIN) {
        return `Le mot de passe doit contenir au moins ${MOT_DE_PASSE_MIN} caractères.`;
    }
    if (Buffer.byteLength(motDePasse, 'utf8') > MOT_DE_PASSE_MAX_OCTETS) {
        return "Le mot de passe est trop long : 72 octets au plus (une lettre accentuée en compte deux).";
    }
    if (username && reduire(motDePasse) === reduire(username)) {
        return "Le mot de passe ne doit pas être votre nom d'utilisateur.";
    }
    if (estCourant(motDePasse)) return "Ce mot de passe est trop courant. Choisissez-en un autre.";
    return null;
}

module.exports = {
    MOTIF_NOM,
    MOT_DE_PASSE_MIN,
    MOT_DE_PASSE_MAX_OCTETS,
    erreurNom,
    erreurMotDePasse,
    estCourant
};
