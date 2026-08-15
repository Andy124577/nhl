/**
 * Confirmation d'un choix de repêchage.
 *
 * Le bouton de chaque rangée appelle `selectPlayer(nom, code)` — c'est le
 * point d'entrée historique, conservé tel quel pour ne pas toucher aux
 * `onclick` produits par draftActif.js. Ce fichier l'intercepte : au lieu
 * d'envoyer le choix directement, il ouvre une fenêtre de confirmation.
 * L'envoi réel reste `commitPlayerPick()`, dans draftActif.js.
 *
 * Un repêchage est irréversible : rien ne permet de rendre un joueur une
 * fois le tour passé. Un clic mal placé dans une liste dense coûtait donc
 * un tour entier.
 */

/** Choix en attente de confirmation, et nom du dernier choix envoyé. */
let pickConfirmEnAttente = null;
let pickConfirmEnvoi = false;
let pickConfirmDernier = null;
let pickConfirmFocusAvant = null;

/** Libellé de la place que le choix vient combler. */
function pickPositionLabel(code) {
  switch (code) {
    case 'D': return 'Défenseur';
    case 'G': return 'Gardien';
    case '*': return 'Recrue';
    case 'T': return 'Équipe de la LNH';
    default: return 'Attaquant';
  }
}

/**
 * Point d'entrée des boutons de la liste. Remplace la fonction du même nom
 * qui envoyait le choix sans demander.
 */
function selectPlayer(nom, code) {
  const overlay = document.getElementById('pickConfirmOverlay');
  // Sans la fenêtre (page partielle, script non chargé), on ne bloque pas le
  // repêchage : le comportement d'origine reprend la main.
  if (!overlay) { commitPlayerPick(nom, code); return; }
  if (pickConfirmEnvoi) return;

  pickConfirmEnAttente = { nom, code };
  remplirPickConfirm(nom, code);

  pickConfirmFocusAvant = document.activeElement;
  overlay.classList.add('show');
  // Le reste de la page passe hors de portée tant que la fenêtre est ouverte :
  // sans ceci, Tab pouvait sortir de la boîte et retomber dans le tableau
  // encore actif derrière elle.
  document.querySelectorAll('.draft-header, .draft-main-container').forEach(el => {
    el.setAttribute('aria-hidden', 'true');
  });
  const valider = document.getElementById('pickConfirmOk');
  if (valider) valider.focus();
}

/** Les deux seuls arrêts du piège de focus : Annuler et Confirmer. */
function pickConfirmFocusables() {
  return [
    document.getElementById('pickConfirmCancel'),
    document.getElementById('pickConfirmOk')
  ].filter(Boolean);
}

/** Renseigne la fenêtre à partir des données déjà chargées par la page. */
function remplirPickConfirm(nom, code) {
  const info = typeof resolvePickInfo === 'function'
    ? resolvePickInfo({ player: nom, position: code })
    : { nom, abbrev: null, logo: null, photo: null, position: code, estEquipe: code === 'T' };

  const zonePhoto = document.getElementById('pickConfirmPhoto');
  if (zonePhoto) {
    zonePhoto.replaceChildren();
    zonePhoto.classList.toggle('is-team', !!info.estEquipe);
    if (info.photo) {
      const img = document.createElement('img');
      img.src = info.photo;
      img.alt = '';
      img.addEventListener('error', () => img.remove());
      zonePhoto.appendChild(img);
    }
  }

  const champNom = document.getElementById('pickConfirmName');
  if (champNom) champNom.textContent = nom;

  const meta = document.getElementById('pickConfirmMeta');
  if (meta) {
    meta.replaceChildren();
    if (info.logo) {
      const pastille = document.createElement('span');
      pastille.className = 'pick-confirm-logo';
      const logo = document.createElement('img');
      logo.src = info.logo;
      logo.alt = '';
      logo.addEventListener('error', () => pastille.remove());
      pastille.appendChild(logo);
      meta.appendChild(pastille);
    }
    const texte = document.createElement('span');
    texte.textContent = [info.abbrev, pickPositionLabel(code)].filter(Boolean).join(' · ');
    meta.appendChild(texte);
  }

  const note = document.getElementById('pickConfirmNote');
  if (note) {
    const donnees = typeof draftData !== 'undefined' && draftData ? draftData : {};
    const index = Number.isInteger(donnees.currentPickIndex) ? donnees.currentPickIndex : 0;
    const nbEquipes = donnees.teams ? Object.keys(donnees.teams).length : 0;
    const ronde = nbEquipes > 0 ? Math.floor(index / nbEquipes) + 1 : 0;
    const repere = ronde ? `ronde ${ronde}, choix ${index + 1}` : `choix ${index + 1}`;
    note.textContent = `Ce choix est définitif et occupera votre ${repere}.`;
  }
}

/** Referme la fenêtre et rend le clavier à la page. */
function fermerPickConfirm() {
  const overlay = document.getElementById('pickConfirmOverlay');
  if (overlay) overlay.classList.remove('show');
  pickConfirmEnAttente = null;

  document.querySelectorAll('.draft-header, .draft-main-container').forEach(el => {
    el.removeAttribute('aria-hidden');
  });

  const valider = document.getElementById('pickConfirmOk');
  if (valider) {
    valider.disabled = false;
    valider.textContent = 'Confirmer';
  }
  if (pickConfirmFocusAvant && typeof pickConfirmFocusAvant.focus === 'function') {
    pickConfirmFocusAvant.focus();
  }
  pickConfirmFocusAvant = null;
}

/** Envoie le choix, une seule fois, puis referme. */
async function confirmerPickConfirm() {
  if (!pickConfirmEnAttente || pickConfirmEnvoi) return;

  const { nom, code } = pickConfirmEnAttente;
  const valider = document.getElementById('pickConfirmOk');

  // Le réseau peut être lent et le bouton rester sous le doigt : sans ce
  // verrou, deux envois partaient et le second échouait bruyamment.
  pickConfirmEnvoi = true;
  pickConfirmDernier = nom;
  if (valider) { valider.disabled = true; valider.textContent = 'Envoi…'; }

  try {
    const succes = await commitPlayerPick(nom, code);
    // Choix envoyé : on ramène sur Aperçu plutôt que de laisser la personne
    // sur le tableau qu'elle vient de quitter pour ce choix.
    if (succes && typeof window.fzOuvrirApercu === 'function') window.fzOuvrirApercu();
  } finally {
    pickConfirmEnvoi = false;
    fermerPickConfirm();
  }
}

/**
 * Résultat de l'envoi. Un succès n'ouvre pas de fenêtre : elle recouvrirait
 * la révélation de la carte, qui est déjà la confirmation visible. Les
 * messages du serveur qui ne nomment pas le joueur (« Tour sauté : équipe
 * complète ») restent affichés — ils expliquent pourquoi le choix n'a pas
 * eu l'effet attendu. Appelée par draftActif.js.
 */
function notifyPickResult(message, type) {
  const attendu = pickConfirmDernier && String(message).includes(pickConfirmDernier);
  if (type === 'success' && attendu) { pickConfirmDernier = null; return; }
  showCustomAlert(message, type);
}

/* ---- Branchements ---- */
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('pickConfirmOverlay');
  if (!overlay) return;

  const annuler = document.getElementById('pickConfirmCancel');
  const valider = document.getElementById('pickConfirmOk');
  if (annuler) annuler.addEventListener('click', fermerPickConfirm);
  if (valider) valider.addEventListener('click', confirmerPickConfirm);

  // Un clic à côté ferme, mais pas un clic dans la fenêtre.
  overlay.addEventListener('click', e => {
    if (e.target === overlay && !pickConfirmEnvoi) fermerPickConfirm();
  });

  document.addEventListener('keydown', e => {
    if (!overlay.classList.contains('show')) return;

    if (e.key === 'Escape' && !pickConfirmEnvoi) { e.preventDefault(); fermerPickConfirm(); return; }

    // Entrée active le bouton qui a le focus, comme n'importe quel bouton
    // natif — pas systématiquement Confirmer. Sans cette distinction, Entrée
    // sur Annuler validait le choix qu'on venait de refuser : le geste
    // d'annulation exécutait l'action irréversible qu'il était censé éviter.
    if (e.key === 'Enter') {
      e.preventDefault();
      if (document.activeElement === annuler) fermerPickConfirm();
      else confirmerPickConfirm();
      return;
    }

    // Piège de focus : Tab et Maj+Tab tournent entre Annuler et Confirmer
    // sans jamais atteindre le tableau resté sous la fenêtre.
    if (e.key === 'Tab') {
      const items = pickConfirmFocusables();
      if (items.length < 2) return;
      const [first, last] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  });
});
