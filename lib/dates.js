/**
 * Le calendrier du pool : journées, semaines, et les pièges entre les deux.
 *
 * Les dates étaient calculées un peu partout, chaque fois un peu autrement.
 * Trois divergences en sortaient, et aucune n'était visible à l'œil :
 *
 *   - une aide comparait `game_date < fin`, une autre `game_date <= fin`. Un
 *     match du lundi comptait donc dans deux semaines, ou dans aucune, selon
 *     la route qui posait la question ;
 *   - une semaine s'ajoutait en additionnant sept fois vingt-quatre heures.
 *     Deux fois par an, ce n'est pas ce que dure une semaine : au changement
 *     d'heure, la semaine fait 167 ou 169 heures, et la frontière glisse d'une
 *     heure — assez pour qu'un match tardif change de semaine ;
 *   - la journée du pool était celle du serveur, pas celle des partisans.
 *
 * Une seule source ici. La règle est simple à énoncer et c'est ce qui compte :
 * les frontières visibles sont celles d'`America/Toronto`, les instants sont
 * conservés en UTC, et une semaine est l'intervalle semi-ouvert
 * `[lundi, lundi suivant)` — chaque journée appartient à exactement une
 * semaine, jamais zéro, jamais deux.
 *
 * Une nuance qui n'en est pas une : un match commencé à 22 h et terminé après
 * minuit garde la date que la LNH lui a donnée. On ne la recalcule pas.
 */

'use strict';

/** Le fuseau qui décide des frontières visibles. */
const FUSEAU = 'America/Toronto';

const FORMAT_DATE = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit'
});

const FORMAT_COMPLET = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

/** Les composantes locales d'un instant, dans le fuseau du pool. */
function composantes(instant) {
    const date = instant instanceof Date ? instant : new Date(instant);
    const parties = {};
    for (const { type, value } of FORMAT_COMPLET.formatToParts(date)) {
        if (type !== 'literal') parties[type] = Number(value);
    }
    return parties;
}

/** La journée locale d'un instant, en `YYYY-MM-DD`. */
function journeeLocale(instant = new Date()) {
    const date = instant instanceof Date ? instant : new Date(instant);
    if (Number.isNaN(date.getTime())) return null;
    return FORMAT_DATE.format(date);
}

/**
 * Décalage du fuseau, en minutes, pour un instant donné.
 *
 * Calculé en comparant l'instant à sa lecture locale : c'est la seule façon
 * de connaître le décalage réel sans table des changements d'heure.
 */
function decalageMinutes(instant) {
    const c = composantes(instant);
    const commeUTC = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
    const date = instant instanceof Date ? instant : new Date(instant);
    return Math.round((commeUTC - date.getTime()) / 60000);
}

/**
 * L'instant UTC correspondant à minuit local d'une journée `YYYY-MM-DD`.
 *
 * Deux passes : on part du décalage approximatif de midi, puis on corrige avec
 * le décalage réel à l'heure trouvée. Les deux passes comptent — le jour du
 * changement d'heure, la première réponse est décalée d'une heure.
 */
function minuitLocal(journee) {
    const parties = decomposer(journee);
    if (!parties) return null;
    const { an, mois, jour } = parties;

    const approximation = new Date(Date.UTC(an, mois - 1, jour, 12, 0, 0));
    const decalage = decalageMinutes(approximation);
    let instant = new Date(Date.UTC(an, mois - 1, jour, 0, 0, 0) - decalage * 60000);

    const corrige = decalageMinutes(instant);
    if (corrige !== decalage) {
        instant = new Date(Date.UTC(an, mois - 1, jour, 0, 0, 0) - corrige * 60000);
    }
    return instant;
}

/**
 * Ajoute des jours de CALENDRIER, pas des multiples de 24 heures.
 *
 * `ajouterJours('2026-11-01', 1)` donne le 2 novembre, que la nuit ait duré
 * 23, 24 ou 25 heures.
 */
function ajouterJours(journee, jours) {
    const parties = decomposer(journee);
    if (!parties || !Number.isFinite(Number(jours))) return null;
    const { an, mois, jour } = parties;
    const deplace = new Date(Date.UTC(an, mois - 1, jour + Number(jours)));
    return deplace.toISOString().slice(0, 10);
}

/**
 * Décompose une journée `YYYY-MM-DD` et REFUSE ce qui n'existe pas.
 *
 * Le format seul ne suffit pas : `Date.UTC(2026, 12, 45)` ne proteste pas, il
 * déborde jusqu'en février 2027. Une date impossible doit donner null, pas une
 * autre date — sinon une saisie fautive produit un calendrier silencieusement
 * décalé de plusieurs mois.
 */
function decomposer(journee) {
    const trouve = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(journee || ''));
    if (!trouve) return null;
    const [, an, mois, jour] = trouve.map(Number);
    if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return null;

    const date = new Date(Date.UTC(an, mois - 1, jour));
    // Aller-retour : le 31 février deviendrait le 2 ou 3 mars, et se trahit ici.
    if (date.getUTCFullYear() !== an || date.getUTCMonth() !== mois - 1 || date.getUTCDate() !== jour) {
        return null;
    }
    return { an, mois, jour, date };
}

/** Jour de la semaine d'une journée locale : 0 = dimanche. */
function jourDeSemaine(journee) {
    const parties = decomposer(journee);
    return parties ? parties.date.getUTCDay() : null;
}

/** Le lundi de la semaine contenant cette journée. */
function lundiDe(journee) {
    const jour = jourDeSemaine(journee);
    if (jour === null) return null;
    return ajouterJours(journee, jour === 0 ? -6 : 1 - jour);
}

/**
 * La semaine contenant cette journée, en intervalle SEMI-OUVERT.
 *
 * `debut` inclus, `fin` exclue : le lundi suivant appartient à la semaine
 * suivante. C'est ce qui garantit qu'aucune journée n'est comptée deux fois,
 * et qu'aucune ne tombe entre deux semaines.
 */
function semaineDe(journee) {
    const debut = lundiDe(journee);
    if (!debut) return null;
    const fin = ajouterJours(debut, 7);
    return {
        debut,
        fin,
        // La veille de la borne, pour les affichages « du lundi au dimanche ».
        dernierJour: ajouterJours(fin, -1),
        debutInstant: minuitLocal(debut),
        finInstant: minuitLocal(fin)
    };
}

/** La n-ième semaine d'une saison qui commence le lundi `depart`. */
function semaineNumero(depart, numero) {
    const lundi = lundiDe(journeeDe(depart));
    if (!lundi || !Number.isFinite(numero) || numero < 1) return null;
    return semaineDe(ajouterJours(lundi, (numero - 1) * 7));
}

/**
 * Le numéro de semaine d'une journée, relatif au départ d'une saison.
 * 1 pour la semaine du départ. null avant le départ.
 */
function numeroDeSemaine(depart, journee) {
    const lundiDepart = lundiDe(journeeDe(depart));
    const lundiCible = lundiDe(journeeDe(journee));
    if (!lundiDepart || !lundiCible) return null;
    const jours = Math.round(
        (Date.parse(lundiCible + 'T00:00:00Z') - Date.parse(lundiDepart + 'T00:00:00Z')) / 86400000
    );
    if (jours < 0) return null;
    return Math.floor(jours / 7) + 1;
}

/** Journée locale d'une valeur qui peut être une date, un instant ou déjà une journée. */
function journeeDe(valeur) {
    if (!valeur) return null;
    if (typeof valeur === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valeur)) {
        return decomposer(valeur) ? valeur : null;
    }
    return journeeLocale(valeur);
}

/**
 * Cette journée tombe-t-elle dans l'intervalle semi-ouvert ?
 *
 * La comparaison se fait sur des chaînes `YYYY-MM-DD`, dont l'ordre
 * lexicographique est l'ordre chronologique : ni fuseau ni arrondi ne peuvent
 * s'y glisser.
 */
function dansIntervalle(journee, debut, fin) {
    const j = journeeDe(journee);
    if (!j) return false;
    if (debut && j < debut) return false;
    if (fin && j >= fin) return false;
    return true;
}

/** Une semaine est-elle terminée, c'est-à-dire sa borne de fin atteinte ? */
function semaineTerminee(semaine, maintenant = new Date()) {
    if (!semaine || !semaine.fin) return false;
    return journeeLocale(maintenant) >= semaine.fin;
}

/** Nombre de journées d'un intervalle semi-ouvert. */
function nombreDeJours(debut, fin) {
    if (!debut || !fin) return 0;
    return Math.max(0, Math.round(
        (Date.parse(fin + 'T00:00:00Z') - Date.parse(debut + 'T00:00:00Z')) / 86400000
    ));
}

/** Les journées d'un intervalle semi-ouvert, dans l'ordre. */
function journeesDe(debut, fin) {
    const journees = [];
    let courante = debut;
    let garde = 0;
    while (courante && courante < fin && garde++ < 400) {
        journees.push(courante);
        courante = ajouterJours(courante, 1);
    }
    return journees;
}

/**
 * Nombre de semaines entre deux journées, arrondi au supérieur.
 *
 * Au supérieur parce qu'une saison qui se termine un mercredi se joue quand
 * même cette semaine-là : mieux vaut une semaine de calendrier jamais atteinte
 * qu'une équipe sans adversaire en fin de parcours.
 */
function nombreDeSemaines(debut, fin, { defaut = 26, maximum = 40 } = {}) {
    const d = lundiDe(journeeDe(debut));
    const f = journeeDe(fin);
    if (!d || !f) return defaut;
    const jours = nombreDeJours(d, f);
    if (jours <= 0) return 1;
    return Math.min(Math.ceil(jours / 7), maximum);
}

module.exports = {
    FUSEAU,
    composantes,
    decomposer,
    journeeLocale,
    journeeDe,
    decalageMinutes,
    minuitLocal,
    ajouterJours,
    jourDeSemaine,
    lundiDe,
    semaineDe,
    semaineNumero,
    numeroDeSemaine,
    dansIntervalle,
    semaineTerminee,
    nombreDeJours,
    journeesDe,
    nombreDeSemaines
};
