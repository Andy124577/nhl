/**
 * Le choix automatique : ce que Fantazy prend pour une équipe dont le temps
 * de choisir est écoulé (repêchage à date fixe, lib/poolOps.js).
 *
 * La règle est celle de « Ton choix probable » à l'accueil
 * (fzhHeroCandidats, accueil-draft-hero.js) : la projection de la trousse —
 * points pour un patineur, victoires × 2 pour un gardien —, dans une
 * catégorie que l'équipe peut encore remplir, et un club de la LNH seulement
 * quand il ne reste plus que lui. Ce que la personne voyait venir est donc ce
 * qui arrive. Seuls ses favoris n'y entrent pas : ils vivent dans son
 * navigateur (draftFavorites.js), pas sur le serveur.
 *
 * Pur : la trousse arrive en argument, rien n'est lu ici. Un test vérifie que
 * les deux côtés désignent le même joueur (test/unit/choix-chronometre.test.js).
 */

'use strict';

/**
 * Noms écrits autrement que dans la trousse. Un choix enregistré sous
 * l'ancien nom doit rester « pris », sinon le même joueur partirait deux fois.
 * Garder aligné avec ALIAS dans draftkitData.js (un test le vérifie).
 */
const ALIAS = {
    'mitchell marner': 'Mitch Marner',
    'utah hockey club': 'Utah Mammoth'
};

/** Clé de rapprochement des noms, comme cleNom (draftkitData.js) : sans accent ni ponctuation. */
function cleNom(nom) {
    return String(nom || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** La clé d'un nom, après l'avoir ramené à celui de la trousse. */
function cle(nom) {
    const brute = cleNom(nom);
    return ALIAS[brute] ? cleNom(ALIAS[brute]) : brute;
}

/**
 * La trousse, rangée une fois pour toutes du meilleur au moins bon.
 *
 * Même catégorie que la salle (fzPositionCode) : une recrue va chez les
 * recrues, un défenseur en défense, un gardien — recrue ou non — devant le
 * filet, le reste à l'attaque.
 */
function bassinDepuisTrousse(trousse) {
    const t = trousse || {};
    const projection = fiche => (fiche && fiche.projection) || {};
    const fiches = [
        ...(t.skaters || []).map(p => ({
            nom: p.fullName,
            categorie: p.rookie ? 'rookie' : p.position === 'D' ? 'defensive' : 'offensive',
            valeur: projection(p).points || 0
        })),
        ...(t.goalies || []).map(p => ({ nom: p.fullName, categorie: 'goalie', valeur: (projection(p).wins || 0) * 2 })),
        ...(t.teams || []).map(e => ({ nom: e.fullName, categorie: 'teams', valeur: projection(e).wins || 0 }))
    ].filter(f => f.nom);

    return fiches
        .sort((a, b) => (b.valeur - a.valeur) || a.nom.localeCompare(b.nom))
        .map(f => ({ ...f, cle: cle(f.nom) }));
}

/**
 * Le meilleur joueur encore libre, dans une catégorie ouverte.
 *
 * `pris` : tous les noms déjà repêchés, banc compris. `ouvertes` : les
 * catégories où l'équipe peut encore choisir (poolOps.categoriesOuvertes).
 * null s'il n'y a plus rien à prendre.
 */
function meilleurChoix(bassin, { pris = [], ouvertes = {} } = {}) {
    const deja = new Set([...pris].map(cle));
    const joueursOuverts = !!(ouvertes.offensive || ouvertes.defensive || ouvertes.rookie || ouvertes.goalie);
    const fiche = (bassin || []).find(f =>
        ouvertes[f.categorie] &&
        !deja.has(f.cle) &&
        (f.categorie !== 'teams' || !joueursOuverts));
    return fiche ? { nom: fiche.nom, categorie: fiche.categorie } : null;
}

module.exports = { ALIAS, cleNom, cle, bassinDepuisTrousse, meilleurChoix };
