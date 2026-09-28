/**
 * Le repêchage dans l'agenda de chacun.
 *
 * Un repêchage à date fixe part sans attendre personne (lib/poolOps.js), et
 * chaque choix a sa limite de temps : il faut y être. Le site ne peut pas
 * sonner sur un téléphone fermé, mais l'agenda du téléphone, lui, le peut.
 * D'où deux sorties pour le même rendez-vous :
 *
 *   - un fichier iCalendar (.ics, RFC 5545), que l'iPhone, le Mac, Outlook et
 *     l'agenda Samsung ouvrent directement, avec ses rappels (VALARM) ;
 *   - un lien « Ajouter à Google Agenda », parce que l'application Google
 *     d'Android n'ouvre pas les fichiers .ics. Ce lien ne sait pas porter de
 *     rappels : Google applique ceux que la personne a réglés par défaut.
 *
 * Pur : ni requête ni base. La route (routes/pools.js) lit le pool et choisit
 * la sortie.
 */

'use strict';

/** Les rappels du fichier .ics, en minutes avant le départ. */
const RAPPELS_MIN = [60, 10];

/** La durée affichée dans l'agenda. Indicative : le repêchage dure ce qu'il dure. */
const DUREE_MS = 60 * 60 * 1000;

/** 20261003T233000Z : un instant UTC au format iCalendar (et Google). */
function horodatage(instant) {
    return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Échappe une valeur TEXT (RFC 5545, 3.3.11). */
function echapperTexte(texte) {
    return String(texte == null ? '' : texte)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

/**
 * Plie une ligne à 75 octets (RFC 5545, 3.1), sans couper un caractère
 * UTF-8 en deux : les accents d'un nom de pool comptent pour deux octets.
 */
function plier(ligne) {
    const morceaux = [];
    let courant = '';
    let octets = 0;
    for (const caractere of ligne) {
        const taille = Buffer.byteLength(caractere, 'utf8');
        // La suite d'une ligne pliée commence par une espace, qui compte.
        const plafond = morceaux.length === 0 ? 75 : 74;
        if (octets + taille > plafond) {
            morceaux.push(courant);
            courant = '';
            octets = 0;
        }
        courant += caractere;
        octets += taille;
    }
    morceaux.push(courant);
    return morceaux.join('\r\n ');
}

/** « dans 1 h », « dans 10 min ». */
function libelleRappel(minutes) {
    return minutes % 60 === 0 ? `dans ${minutes / 60} h` : `dans ${minutes} min`;
}

/**
 * Le texte du rendez-vous, commun aux deux sorties.
 *
 * `limiteMs` : le temps par choix, s'il y en a un — c'est la raison d'être
 * à l'heure, donc la première chose à dire.
 */
function contenu({ nom, url, limiteMs = 0 }) {
    const minutes = Math.round((Number(limiteMs) || 0) / 60000);
    return {
        titre: `Repêchage ${nom} · Fantazy`,
        details: [
            `Le repêchage du pool ${nom} commence.`,
            minutes > 0
                ? `${minutes} minutes par choix : passé ce délai, Fantazy choisit le meilleur joueur disponible pour vous.`
                : null,
            url ? `Rejoindre la salle : ${url}` : null
        ].filter(Boolean).join('\n')
    };
}

/**
 * Le fichier .ics du repêchage.
 *
 * `uid` reste le même d'un téléchargement à l'autre, et SEQUENCE ne fait que
 * croître : réimporter après un changement de date met l'événement à jour
 * dans l'agenda plutôt que d'en créer un deuxième.
 */
function fichierIcs({ nom, date, url = '', uid, limiteMs = 0, maintenant = Date.now(), rappels = RAPPELS_MIN }) {
    const debut = Date.parse(date);
    if (!Number.isFinite(debut)) throw new Error('Date de repêchage invalide.');
    const { titre, details } = contenu({ nom, url, limiteMs });

    const lignes = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Fantazy//Repechage//FR',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${horodatage(maintenant)}`,
        `SEQUENCE:${Math.floor(maintenant / 60000)}`,
        `DTSTART:${horodatage(debut)}`,
        `DTEND:${horodatage(debut + DUREE_MS)}`,
        `SUMMARY:${echapperTexte(titre)}`,
        `DESCRIPTION:${echapperTexte(details)}`,
        ...(url ? [`URL:${url}`, `LOCATION:${echapperTexte(url)}`] : []),
        ...rappels.flatMap(minutes => [
            'BEGIN:VALARM',
            'ACTION:DISPLAY',
            `DESCRIPTION:${echapperTexte(`Repêchage ${nom} ${libelleRappel(minutes)}`)}`,
            `TRIGGER:-PT${minutes}M`,
            'END:VALARM'
        ]),
        'END:VEVENT',
        'END:VCALENDAR'
    ];
    return lignes.map(plier).join('\r\n') + '\r\n';
}

/** Le lien qui ouvre l'événement, prérempli, dans Google Agenda. */
function lienGoogle({ nom, date, url = '', limiteMs = 0 }) {
    const debut = Date.parse(date);
    if (!Number.isFinite(debut)) throw new Error('Date de repêchage invalide.');
    const { titre, details } = contenu({ nom, url, limiteMs });
    const parametres = new URLSearchParams({
        action: 'TEMPLATE',
        text: titre,
        dates: `${horodatage(debut)}/${horodatage(debut + DUREE_MS)}`,
        details,
        ...(url ? { location: url } : {})
    });
    return `https://calendar.google.com/calendar/render?${parametres.toString()}`;
}

/** Un nom de fichier sans surprise : « repechage-les-castors.ics ». */
function nomFichier(nom) {
    const lisible = String(nom || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return `repechage${lisible ? '-' + lisible : ''}.ics`;
}

/**
 * Quelle sortie pour cet appareil : Google sur Android, le fichier ailleurs.
 * `demande` (« google » ou « ics ») l'emporte : c'est un choix de la personne.
 */
function sortiePour(userAgent, demande) {
    if (demande === 'google' || demande === 'ics') return demande;
    return /android/i.test(String(userAgent || '')) ? 'google' : 'ics';
}

module.exports = {
    RAPPELS_MIN,
    DUREE_MS,
    horodatage,
    echapperTexte,
    plier,
    fichierIcs,
    lienGoogle,
    nomFichier,
    sortiePour
};
