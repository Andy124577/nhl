/**
 * Filtre de grossièretés — module partagé client et serveur.
 *
 * Appliqué aux noms d'utilisateur, aux noms de pool et aux noms d'équipe.
 * Le serveur reste l'autorité : le client n'appelle ces fonctions que pour
 * répondre tout de suite, sans attendre l'aller-retour.
 *
 * Principe : on ramène le texte à une forme canonique, puis on y cherche
 * une liste de termes. La normalisation défait les contournements
 * ordinaires — accents, chiffres à la place des lettres, séparateurs
 * intercalés, lettres répétées :
 *
 *     « C0nn@rd »   → connard
 *     « f.u.c.k »   → fuck
 *     « MEEERDE »   → merde
 *
 * Aucun filtre de ce genre n'est infaillible : il laissera passer des
 * tournures inventives et pourrait refuser un nom innocent. Il vise les
 * cas manifestes, pas l'exhaustivité.
 */

(function () {
    'use strict';

    /**
     * Termes sans ambiguïté : repérés même collés à autre chose, sur le
     * texte compacté (séparateurs retirés).
     */
    const PARTIELS = [
        // Anglais
        'fuck', 'shit', 'bitch', 'cunt', 'whore', 'slut', 'asshole',
        'dumbass', 'dickhead', 'motherfuck', 'wanker', 'bollocks',
        'bastard', 'nigger', 'nigga', 'faggot', 'pedophil',
        // Français
        'merde', 'salope', 'salaud', 'salopard', 'connard', 'connasse',
        'encule', 'enculer', 'enfoire', 'trouduc', 'couille', 'foutre',
        'chiasse', 'gouine', 'youpin', 'bougnoule', 'pedophile',
        // Sacres québécois
        'tabarnak', 'tabarnac', 'tabarnack', 'calisse', 'kalisse',
        'ciboire', 'sacrament', 'viarge', 'cibole',
        // Haine
        'nazi', 'hitler'
    ];

    /**
     * Termes courts ou ambigus : mot entier uniquement.
     *
     * En sous-chaîne ils frapperaient des mots parfaitement innocents —
     * « con » dans concours, « cul » dans calcul, « ass » dans classe,
     * « bite » dans arbitre, « nique » dans technique, « pute » dans
     * dispute, « cock » dans cocktail.
     */
    const ENTIERS = [
        'con', 'cons', 'conne', 'cul', 'culs', 'pute', 'putes', 'putain',
        'bite', 'bites', 'nique', 'niquer', 'pisse', 'pisser', 'batard',
        'batards', 'tapette', 'pedale', 'negre', 'negresse', 'pd', 'fdp',
        'ntm', 'esti', 'osti', 'ostie', 'criss', 'crisse', 'tabarnouche',
        'ass', 'asses', 'dick', 'dicks', 'cock', 'cocks', 'twat', 'prick',
        'piss', 'crap', 'wank'
    ];

    /** Chiffres et symboles employés à la place des lettres. */
    const SUBSTITUTIONS = {
        '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's',
        '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's',
        '!': 'i', '+': 't', '(': 'c', '€': 'e'
    };

    /**
     * Minuscules, accents retirés, substitutions défaites. Les séparateurs
     * deviennent des espaces mais restent : la recherche par mot entier en
     * a besoin.
     */
    function normaliser(texte) {
        return String(texte || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')       // accents
            .replace(/[0134578@$!+(€]/g, c => SUBSTITUTIONS[c] || c)
            .replace(/[^a-z]+/g, ' ')                  // tout le reste sépare
            .trim();
    }

    /** Séparateurs retirés et lettres répétées ramenées à une seule. */
    function compacter(normalise) {
        return normalise.replace(/ /g, '').replace(/(.)\1+/g, '$1');
    }

    // La liste des termes partiels subit la même compaction que le texte
    // examiné, sans quoi « connard » (→ conard) ne s'y retrouverait pas.
    const PARTIELS_COMPACTES = PARTIELS.map(m => compacter(normaliser(m)));

    /**
     * Vrai si le texte contient une grossièreté.
     * @param {string} texte
     */
    function contientGrossierete(texte) {
        const normalise = normaliser(texte);
        if (!normalise) return false;

        const mots = normalise.split(' ');
        if (mots.some(m => ENTIERS.includes(m))) return true;

        const compacte = compacter(normalise);
        return PARTIELS_COMPACTES.some(m => compacte.includes(m));
    }

    /**
     * Contrôle prêt à l'emploi pour un nom saisi.
     * @returns {{ok: boolean, message?: string}}
     */
    function verifierNom(texte, quoi) {
        if (contientGrossierete(texte)) {
            return {
                ok: false,
                message: `${quoi || 'Ce nom'} contient un terme inapproprié. Choisissez-en un autre.`
            };
        }
        return { ok: true };
    }

    const api = { contientGrossierete, verifierNom, normaliser };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;                 // serveur (CommonJS)
    } else if (typeof window !== 'undefined') {
        Object.assign(window, api);           // navigateur
    }
})();
