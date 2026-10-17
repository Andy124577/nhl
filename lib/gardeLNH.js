/**
 * Les pages de la LNH que le serveur garde : l'horaire de la semaine
 * (/schedule, la page Scores) et le calendrier de saison de chaque club.
 *
 * La LNH limite notre adresse (429) dès qu'elle reçoit une salve. Les
 * journaux de Render du 16 octobre 2026 en montrent une demi-douzaine par
 * jour : vingt à quarante refus « calendrier de XXX — HTTP 429 » dans la
 * même seconde, le même club souvent deux fois à la même milliseconde. Le
 * cache d'une demi-heure expirait, et chaque appelant du moment (colonnes du
 * classement, forme des clubs) relançait TOUS les clubs à la fois, sans
 * savoir qu'un autre venait de le faire. Pendant la minute de limite qui
 * suivait, l'horaire de la page Scores était refusé lui aussi, et la page
 * recevait une semaine vide : « Le calendrier de la LNH est indisponible ».
 *
 * D'où, pour toute page gardée ici :
 *   - une copie fraîche sert sans rappeler la LNH ;
 *   - un appel en cours est partagé : une rafale n'en lance qu'un ;
 *   - un refus ne vide rien : la dernière copie sert, même vieille ;
 *   - après un refus, on laisse la LNH tranquille `repitMs` avant de
 *     redemander — la relance immédiate entretenait la limite.
 *
 * Et `creerFile` borne le nombre d'appels simultanés, pour qu'un cache
 * froid ne parte pas en salve.
 */

'use strict';

const REPIT_DEFAUT_MS = 60 * 1000;

/**
 * `dureeMs` : un nombre, ou une fonction (valeur, clé) → ms, quand la
 * fraîcheur dépend de ce qu'on a lu (une semaine en cours se périme vite,
 * une semaine passée non).
 */
function creerGarde({ dureeMs, repitMs = REPIT_DEFAUT_MS, horloge = () => Date.now() } = {}) {
    /** clé → { valeur, lu, refuseLe } — `lu` null tant qu'aucune lecture n'a réussi. */
    const entrees = new Map();
    /** clé → promesse de la lecture en cours. */
    const enVol = new Map();

    const fraicheur = (valeur, cle) => (typeof dureeMs === 'function' ? dureeMs(valeur, cle) : dureeMs);
    const copie = entree => (entree && entree.lu !== null ? entree.valeur : null);

    /**
     * La valeur de `cle` : gardée si fraîche, sinon `charger()`. `charger`
     * rend la valeur, ou null (ou lève) quand la LNH refuse ; on rend alors
     * la dernière copie, ou null s'il n'y en a jamais eu.
     */
    function lire(cle, charger) {
        const entree = entrees.get(cle);
        const maintenant = horloge();
        if (entree && entree.lu !== null && maintenant - entree.lu < fraicheur(entree.valeur, cle)) {
            return Promise.resolve(entree.valeur);
        }
        if (entree && entree.refuseLe !== null && maintenant - entree.refuseLe < repitMs) {
            return Promise.resolve(copie(entree));
        }
        if (enVol.has(cle)) return enVol.get(cle);

        const lecture = Promise.resolve()
            .then(charger)
            .catch(() => null)
            .then(valeur => {
                if (valeur !== null && valeur !== undefined) {
                    entrees.set(cle, { valeur, lu: horloge(), refuseLe: null });
                    return valeur;
                }
                const avant = entrees.get(cle) || { valeur: null, lu: null };
                entrees.set(cle, { ...avant, refuseLe: horloge() });
                return copie(avant);
            })
            .finally(() => enVol.delete(cle));
        enVol.set(cle, lecture);
        return lecture;
    }

    return { lire, oublier: () => entrees.clear(), taille: () => entrees.size };
}

/** Une file : `n` travaux à la fois au plus, les autres attendent leur tour. */
function creerFile(n) {
    let actifs = 0;
    const attente = [];

    function suivant() {
        if (actifs >= n || !attente.length) return;
        actifs += 1;
        const { travail, resoudre, rejeter } = attente.shift();
        Promise.resolve()
            .then(travail)
            .then(resoudre, rejeter)
            .finally(() => { actifs -= 1; suivant(); });
    }

    return travail => new Promise((resoudre, rejeter) => {
        attente.push({ travail, resoudre, rejeter });
        suivant();
    });
}

module.exports = { creerGarde, creerFile, REPIT_DEFAUT_MS };
