/**
 * Cadence de rafraîchissement de la salle de repêchage.
 *
 * La page se tenait à jour de trois façons en même temps :
 *   - un sondage `setInterval(loadDraftData, 7000)` ;
 *   - l'événement socket `draftUpdated`, qui porte déjà les données ;
 *   - l'événement socket `forceRefresh`, qui relance `loadDraftData`.
 *
 * Chacune refaisait le rendu complet — tableau des joueurs, progression,
 * ordre, bande de choix — que quelque chose ait changé ou non. Un choix
 * déclenchait donc trois reconstructions en moins d'une seconde, et la
 * dernière effaçait l'animation de révélation avant qu'elle ait fini de
 * jouer. Toutes les sept secondes, la même reconstruction faisait clignoter
 * la liste et recharger les portraits.
 *
 * Le remède tient en une comparaison : on garde une empreinte de ce que la
 * vue affiche réellement, et on ne redessine que si elle a bougé. Les trois
 * sources restent en place — le sondage reste le filet quand la connexion
 * socket tombe — mais deux d'entre elles ne coûtent plus qu'une empreinte.
 *
 * Chargé avant draftActif.js, qui appelle shouldRefreshDraftView().
 */

/** Empreinte du dernier état effectivement rendu. */
let draftViewSignature = null;

/** Premier chargement fait : le voile d'attente ne resservira plus. */
let draftFirstLoadDone = false;

/**
 * Empreinte de ce que la page montre. Volontairement limitée à ces
 * champs : tout ce que la vue affiche en dépend, et rien d'autre ne doit
 * provoquer un redessin.
 *
 * Y ajouter un champ si un nouvel affichage en dépend — sinon il resterait
 * figé jusqu'au prochain choix.
 */
function draftViewSignatureOf(clan) {
  if (!clan) return '';

  const equipes = clan.teams || {};
  const resume = Object.keys(equipes).sort().map(nom => {
    const e = equipes[nom] || {};
    return [
      nom,
      (e.members || []).length,
      (e.offensive || []).length,
      (e.defensive || []).length,
      (e.goalie || []).length,
      (e.rookie || []).length,
      (e.teams || []).length
    ].join(':');
  });

  const historique = clan.picksHistory || [];
  const dernier = historique[historique.length - 1];

  return JSON.stringify({
    i: clan.currentPickIndex,
    o: (clan.draftOrder || []).length,
    h: historique.length,
    d: dernier ? `${dernier.team}|${dernier.player}` : '',
    c: clan.config || null,
    e: resume
  });
}

/**
 * Vrai s'il faut redessiner. Retenir l'empreinte ici plutôt que chez
 * l'appelant : les deux points d'entrée (sondage et socket) peuvent réagir
 * au même changement, et le second doit voir que le premier a déjà fait le
 * travail.
 */
function shouldRefreshDraftView(clan) {
  const signature = draftViewSignatureOf(clan);
  if (signature === draftViewSignature) return false;
  draftViewSignature = signature;
  return true;
}

/* ============================================================
   RENDUS COMMUNS À TOUTES LES VUES
   ============================================================ */

/**
 * updateTable() choisit une branche selon le filtre actif, et trois d'entre
 * elles — Gardiens, Équipes, Mes choix — sortaient par un `return` anticipé.
 * Les rendus placés en fin de fonction (aperçu d'équipe, progression,
 * en-tête, ordre, bande de choix) n'étaient donc joués que pour la vue
 * Joueurs. Résultat : repêcher une équipe ou un gardien ne changeait rien à
 * la carte du tour tant qu'on ne rechargeait pas la page.
 *
 * Ils sont retirés de la queue de updateTable() (draftActif.js) et rejoués
 * ici, après coup, quelle que soit la branche empruntée.
 */
function refreshDraftViews() {
  const rendus = [
    'renderTeamsOverview',
    'updateProgressCounter',
    'updateDraftHeader',
    'renderRecentPicks',
    // Disponibilité des onglets de catégorie (draftActifUI.js) : elle
    // change dès qu'une position se remplit.
    'refreshCategoryTabs',
    // Étoile de la colonne Action + carte « Mes favoris » (draftFavorites.js) :
    // dépendent du tour courant et des choix faits, comme le reste ici.
    'fzRefreshFavoritesUI',
    // Vue "Tous" (draftListePremium.js) : la liste des joueurs déjà pris
    // change à chaque choix, comme le reste de cette liste.
    'fzRefreshPickedList'
  ];
  rendus.forEach(nom => {
    const fn = window[nom];
    if (typeof fn !== 'function') return;
    try { fn(); } catch (e) { console.error('[repêchage] ' + nom + ' :', e); }
  });
}

// Posé au DOMContentLoaded : les scripts `defer` s'exécutent avant, donc
// updateTable() existe déjà, y compris l'habillage que draftActif.js lui
// applique lui-même pour l'état vide du tableau.
document.addEventListener('DOMContentLoaded', () => {
  if (typeof updateTable !== 'function') return;
  const original = updateTable;
  updateTable = function () {
    const resultat = original.apply(this, arguments);
    refreshDraftViews();
    return resultat;
  };
});
