/**
 * Tableau du repêchage — construction des cartes et défilement.
 *
 * Ce fichier existe pour garder la logique lisible : draftActif.js est
 * minifié, on n'y laisse donc qu'un appel. Tout ce qui touche à l'apparence
 * d'une carte de choix se modifie ici.
 *
 * La bande couvre le repêchage ENTIER, pas seulement les choix déjà faits :
 * un tour par position de `draftData.draftOrder`, du premier au dernier, de
 * gauche à droite. Trois états se suivent donc naturellement — les choix
 * faits, le tour en cours, puis les tours à venir avec l'équipe qui les
 * détient. On voit l'ordre complet dès l'ouverture de la salle.
 *
 * Une carte faite = photo du joueur au centre, équipe de la LNH en haut à
 * droite, équipe du pool qui l'a repêché en bas à gauche, fond aux couleurs
 * (assourdies) de l'équipe du joueur — voir teamColors.js.
 *
 * Le défilement suit l'activité : après chaque choix, la bande se recale sur
 * le tour en cours. Elle se manipule aussi au doigt, en glissant à la souris
 * et par les flèches ‹ ›.
 *
 * Dépendances (globales de draftActif.js, toutes optionnelles ici) :
 * fullPlayerData, goalieData, teamData, draftData, getCurrentPlayerStats,
 * getMatchingImage, getTeamAbbreviation.
 */

/* ============================================================
   1. RÉSOLUTION D'UN CHOIX
   ============================================================ */

/**
 * Rassemble ce qu'il faut afficher pour un choix. Les sources de données du
 * repêchage sont éparpillées (patineurs, gardiens, équipes, statistiques du
 * jour) : cette fonction est le seul endroit qui sait où chercher.
 */
function resolvePickInfo(pick) {
  const nom = pick.player || '';
  const estEquipe = pick.position === 'teams' || pick.position === 'T';

  const chercher = (liste, cle) =>
    Array.isArray(liste) ? liste.find(e => e[cle] === nom) : undefined;

  const fiche =
    (typeof fullPlayerData !== 'undefined' && chercher(fullPlayerData, 'skaterFullName')) ||
    (typeof goalieData !== 'undefined' && chercher(goalieData, 'goalieFullName')) ||
    (typeof teamData !== 'undefined' && chercher(teamData, 'teamFullName')) ||
    null;

  const stats = typeof getCurrentPlayerStats === 'function'
    ? getCurrentPlayerStats(nom, fiche && fiche.playerId)
    : null;

  // Abréviation d'équipe : c'est elle qui commande la couleur ET le logo.
  let abbrev = null;
  if (estEquipe) {
    abbrev = typeof getTeamAbbreviation === 'function' ? getTeamAbbreviation(nom) : null;
  } else if (stats && stats.teamAbbrev) {
    abbrev = stats.teamAbbrev;
  } else if (fiche && fiche.teamAbbrevs && fiche.teamAbbrevs !== 'null') {
    // Un joueur échangé cumule ses équipes ("BOS,NYR") : la dernière est
    // l'actuelle, c'est celle qu'on affiche.
    abbrev = String(fiche.teamAbbrevs).split(',').pop().trim();
  }
  if (abbrev) abbrev = abbrev.toUpperCase();

  const logo = abbrev ? `teams/${abbrev}.png` : null;
  const photo = estEquipe
    ? logo
    : (typeof getMatchingImage === 'function' ? getMatchingImage(nom) : null);

  let position = pick.position || '';
  if (estEquipe) position = 'Équipe';
  else if (fiche && fiche.positionCode) position = fiche.positionCode;

  return { nom, estEquipe, abbrev, logo, photo, position };
}

/* ============================================================
   2. CONSTRUCTION D'UNE CARTE
   ============================================================ */

/**
 * Base sombre du mélange. Les couleurs d'équipe sont vives par nature ; les
 * poser telles quelles donnait une bande criarde qui écrasait le reste de la
 * page. Chaque teinte est donc ramenée vers ce gris bleuté, d'autant plus
 * fort que la couleur d'origine est claire.
 */
const PICK_CARD_BASE = '#151922';
const PICK_CARD_BASE_DEEP = '#0d1016';

/** Dose d'assourdissement : les couleurs claires en reçoivent davantage. */
function pickCardMuteRatio(couleur) {
  return 0.45 + Math.min(0.30, hexLuminance(couleur) * 0.55);
}

/**
 * Une carte du tableau. Construite par le DOM et non par une chaîne HTML : le
 * nom d'équipe du pool est saisi par l'utilisateur, l'insérer via innerHTML
 * ouvrirait une injection de balises.
 *
 * `etat` vaut 'done' (choix fait), 'current' (tour en cours), 'upcoming'
 * (tour à venir) ou 'skipped' (tour sauté, équipe déjà complète).
 */
function buildPickCard(options) {
  const { pick, numero, ronde, equipePool, etat } = options;
  const info = pick ? resolvePickInfo(pick) : null;

  const carte = document.createElement('article');
  carte.className = 'pick-card is-' + etat;

  // Seules les cartes d'un choix fait portent des couleurs d'équipe ; les
  // autres gardent le neutre défini en CSS, faute d'équipe connue.
  if (info) {
    const [couleurA, couleurB] = getTeamColors(info.abbrev);
    carte.style.setProperty('--team-a', mixHex(couleurA, PICK_CARD_BASE, pickCardMuteRatio(couleurA)));
    carte.style.setProperty('--team-b', mixHex(couleurB, PICK_CARD_BASE, pickCardMuteRatio(couleurB) + 0.10));
    carte.style.setProperty('--team-deep', mixHex(couleurA, PICK_CARD_BASE_DEEP, 0.86));
    // Le liseré du bas garde la teinte vive : c'est le seul repère de couleur
    // franche, et il suffit à séparer deux marines voisins.
    carte.style.setProperty('--team-accent', couleurB);
    if (info.abbrev) carte.dataset.team = info.abbrev;
  }

  /* ---- Milieu : la photo, ou le numéro de tour s'il n'y a pas de choix ----
     Posée en couche de fond plutôt qu'en rangée : le portrait peut ainsi
     déborder derrière le nom et le pied, comme sur une carte de collection. */
  const zonePhoto = document.createElement('div');
  zonePhoto.className = 'pick-card-photo';

  if (info && info.estEquipe) zonePhoto.classList.add('is-team');

  if (info && info.photo) {
    const img = document.createElement('img');
    img.className = 'pick-card-photo-img';
    img.src = info.photo;
    img.alt = info.nom;
    img.loading = 'lazy';
    img.draggable = false;
    // Une photo manquante laisserait un vide : on bascule sur les initiales.
    img.addEventListener('error', () => {
      img.remove();
      zonePhoto.classList.add('is-empty');
      zonePhoto.appendChild(buildPickInitials(info.nom));
    });
    zonePhoto.appendChild(img);
  } else if (info) {
    zonePhoto.classList.add('is-empty');
    zonePhoto.appendChild(buildPickInitials(info.nom));
  } else {
    // Tour à venir : le numéro tient lieu d'illustration.
    zonePhoto.classList.add('is-empty');
    const chiffre = document.createElement('span');
    chiffre.className = 'pick-card-slot';
    chiffre.textContent = String(numero);
    zonePhoto.appendChild(chiffre);
  }
  carte.appendChild(zonePhoto);

  /* ---- Haut : identité à gauche, équipe LNH à droite ---- */
  const haut = document.createElement('div');
  haut.className = 'pick-card-head';

  const identite = document.createElement('div');
  identite.className = 'pick-card-id';

  const nom = document.createElement('h4');
  nom.className = 'pick-card-name';
  if (info) {
    nom.textContent = info.nom;
  } else if (etat === 'current') {
    nom.textContent = 'Au tour de';
  } else if (etat === 'skipped') {
    nom.textContent = 'Tour sauté';
  } else {
    nom.textContent = 'À venir';
  }
  identite.appendChild(nom);

  const sousTitre = info ? info.position : (etat === 'skipped' ? 'Équipe complète' : `Choix ${numero}`);
  if (sousTitre) {
    const pos = document.createElement('span');
    pos.className = 'pick-card-pos';
    pos.textContent = sousTitre;
    identite.appendChild(pos);
  }
  haut.appendChild(identite);

  if (info && (info.logo || info.abbrev)) {
    const club = document.createElement('div');
    club.className = 'pick-card-club';
    if (info.logo) {
      // Pastille blanche : beaucoup de logos de la LNH sont à dominante
      // sombre et disparaissaient sur un fond d'équipe lui aussi sombre.
      const pastille = document.createElement('span');
      pastille.className = 'pick-card-logo-chip';
      const logo = document.createElement('img');
      logo.className = 'pick-card-logo';
      logo.src = info.logo;
      logo.alt = info.abbrev || '';
      logo.loading = 'lazy';
      logo.addEventListener('error', () => pastille.remove());
      pastille.appendChild(logo);
      club.appendChild(pastille);
    }
    if (info.abbrev) {
      const code = document.createElement('span');
      code.className = 'pick-card-abbr';
      code.textContent = info.abbrev;
      club.appendChild(code);
    }
    haut.appendChild(club);
  }
  carte.appendChild(haut);

  /* ---- Bas : l'équipe du pool, puis le repère du tour ---- */
  const bas = document.createElement('div');
  bas.className = 'pick-card-foot';

  const pool = document.createElement('span');
  pool.className = 'pick-card-owner';
  pool.textContent = equipePool || '';
  pool.title = equipePool || '';
  bas.appendChild(pool);

  const repere = document.createElement('span');
  repere.className = 'pick-card-meta';
  repere.textContent = ronde ? `R${ronde} · #${numero}` : `#${numero}`;
  bas.appendChild(repere);

  carte.appendChild(bas);

  const etiquette = info
    ? `${info.nom} — ${info.abbrev || '?'} — repêché par ${equipePool}`
    : (etat === 'current' ? `au tour de ${equipePool}` : `à venir — ${equipePool}`);
  carte.setAttribute('aria-label', `Choix ${numero} : ${etiquette}`);
  if (etat === 'current') carte.setAttribute('aria-current', 'true');

  return carte;
}

function buildPickInitials(nom) {
  const span = document.createElement('span');
  span.className = 'pick-card-initials';
  span.textContent = String(nom)
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(m => m[0]).join('').toUpperCase();
  return span;
}

/* ============================================================
   3. LES TOURS DU REPÊCHAGE
   ============================================================ */

/**
 * Associe chaque position de `draftOrder` au choix qui l'a remplie.
 *
 * Les deux listes ne sont PAS forcément alignées : le serveur avance
 * `currentPickIndex` sans rien écrire dans `picksHistory` quand une équipe
 * complète voit son tour sauté. On avance donc un curseur dans l'historique
 * et on ne consomme une entrée que si elle porte bien le nom de l'équipe
 * attendue — sinon le tour est marqué sauté et l'alignement se rattrape tout
 * seul au tour suivant.
 */
function buildPickSlots(ordre, historique, indexCourant) {
  const tours = [];
  let curseur = 0;

  for (let i = 0; i < ordre.length; i++) {
    const equipePool = ordre[i];
    let pick = null;
    let etat = 'upcoming';

    const candidat = historique[curseur];
    const rempli = candidat && candidat.team === equipePool;

    if (i < indexCourant) {
      if (rempli) { pick = candidat; curseur++; etat = 'done'; }
      else etat = 'skipped';
    } else if (i === indexCourant) {
      // Le serveur n'avance plus l'index après le dernier tour : sans ce
      // rattrapage, le choix final resterait affiché « en cours » et la
      // carte clignoterait indéfiniment sur un repêchage terminé. Aucun
      // faux positif possible en cours de route — à ce point, toutes les
      // entrées de l'historique ont déjà été consommées.
      if (rempli) { pick = candidat; curseur++; etat = 'done'; }
      else etat = 'current';
    }

    tours.push({ equipePool, pick, etat });
  }
  return tours;
}

/**
 * Repli quand l'ordre du repêchage n'est pas encore généré : on affiche au
 * moins les choix déjà faits, pour ne pas laisser la bande vide.
 */
function buildPickSlotsFromHistory(historique) {
  return historique.map(pick => ({ equipePool: pick.team, pick, etat: 'done' }));
}

/* ============================================================
   4. RENDU DU CARROUSEL
   ============================================================ */

let pickCarouselSignature = null;

/**
 * Reconstruit la bande. `picks` est l'historique dans l'ordre du repêchage ;
 * l'ordre complet et le tour courant sont lus dans `draftData`.
 *
 * L'affichage est chronologique : le tour 1 à gauche, le dernier à droite.
 * Le choix le plus récent est donc toujours du côté droit de ce qui a déjà
 * été joué, juste avant le tour en cours.
 */
function renderPickCarousel(picks) {
  const bande = document.getElementById('picks-carousel');
  if (!bande) return;

  const historique = Array.isArray(picks) ? picks : [];
  const donnees = typeof draftData !== 'undefined' && draftData ? draftData : {};
  const ordre = Array.isArray(donnees.draftOrder) ? donnees.draftOrder : [];
  const indexCourant = Number.isInteger(donnees.currentPickIndex) ? donnees.currentPickIndex : 0;

  const tours = ordre.length
    ? buildPickSlots(ordre, historique, indexCourant)
    : buildPickSlotsFromHistory(historique);

  if (!tours.length) {
    bande.replaceChildren();
    const vide = document.createElement('p');
    vide.className = 'picks-carousel-empty';
    vide.textContent = "L'ordre du repêchage n'est pas encore généré.";
    bande.appendChild(vide);
    pickCarouselSignature = null;
    updatePickCarouselButtons();
    return;
  }

  // Un rendu identique ne doit pas ramener la bande là où l'utilisateur ne
  // l'a pas laissée : les rafraîchissements socket sont fréquents.
  const signature = `${tours.length}|${indexCourant}|${historique.length}`;
  const premierRendu = pickCarouselSignature === null;
  const inchange = signature === pickCarouselSignature;
  const positionAvant = bande.scrollLeft;

  bande.replaceChildren();

  // Nombre d'équipes du pool : sert à retrouver la ronde, que ni
  // l'historique ni l'ordre ne stockent.
  const nbEquipes = donnees.teams ? Object.keys(donnees.teams).length : 0;

  const fragment = document.createDocumentFragment();
  const cartes = tours.map((tour, i) => {
    const carte = buildPickCard({
      pick: tour.pick,
      numero: i + 1,
      ronde: nbEquipes > 0 ? Math.floor(i / nbEquipes) + 1 : 0,
      equipePool: tour.equipePool,
      etat: tour.etat
    });
    fragment.appendChild(carte);
    return carte;
  });
  bande.appendChild(fragment);

  pickCarouselSignature = signature;
  initPickCarouselScroll();
  revealLastPick(tours, cartes);

  // Au premier rendu on se place sans animation ; ensuite, un choix vient
  // d'être fait et le glissement montre où le repêchage en est rendu.
  if (inchange) bande.scrollLeft = positionAvant;
  else centerPickCarouselOnCurrent(!premierRendu);

  updatePickCarouselButtons();
}

/**
 * Recale la bande sur le tour en cours — c'est ce qui la fait suivre le
 * repêchage sans intervention. La carte est amenée au centre exact de la
 * bande : les choix déjà faits défilent à sa gauche, ceux à venir à sa
 * droite, et le regard n'a jamais à chercher où on en est.
 *
 * Les marges d'amorce en CSS (:before / :after de .picks-carousel) valent
 * une demi-largeur : sans elles, le premier et le dernier tour ne pourraient
 * pas atteindre le centre, faute de course à parcourir.
 */
function centerPickCarouselOnCurrent(anime) {
  const bande = document.getElementById('picks-carousel');
  if (!bande) return;

  const cible = bande.querySelector('.pick-card.is-current')
    || bande.querySelector('.pick-card:last-of-type');
  if (!cible) return;

  const zone = bande.getBoundingClientRect();
  const carte = cible.getBoundingClientRect();
  const ecart = carte.left - zone.left;
  const centre = bande.clientWidth / 2 - carte.width / 2;
  const max = Math.max(0, bande.scrollWidth - bande.clientWidth);
  const gauche = Math.min(max, Math.max(0, bande.scrollLeft + ecart - centre));

  bande.scrollTo({ left: gauche, behavior: anime ? 'smooth' : 'auto' });
}

/* ============================================================
   5. RÉVÉLATION DU DERNIER CHOIX
   ============================================================ */

/** Dernier choix déjà animé, pour ne pas le rejouer à chaque rafraîchissement. */
let pickRevealVu = null;

/**
 * Anime la carte du choix qui vient d'entrer : photo en gris d'abord, avec
 * la position et le logo d'équipe, puis la couleur, puis le nom. Elle se
 * déclenche chez tout le monde, pas seulement chez la personne qui a choisi
 * — c'est ce qui rend la salle vivante.
 *
 * Une seule carte s'anime à la fois, et `will-change` n'est posé que pendant
 * l'animation : sur une bande de plus de cent vignettes, le laisser en
 * permanence ferait exploser le nombre de couches composées.
 */
function revealLastPick(tours, cartes) {
  let dernier = -1;
  for (let i = tours.length - 1; i >= 0; i--) {
    if (tours[i].etat === 'done') { dernier = i; break; }
  }
  if (dernier < 0) { pickRevealVu = null; return; }

  const cle = `${dernier}|${tours[dernier].pick.player}`;
  const premierRendu = pickRevealVu === null;
  const dejaVu = cle === pickRevealVu;
  pickRevealVu = cle;

  // Au chargement de la page, tous les choix sont « nouveaux » : les animer
  // rejouerait le repêchage entier pour rien.
  if (premierRendu || dejaVu) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const carte = cartes[dernier];
  if (!carte) return;

  carte.classList.add('is-revealing');

  // Le nom est la dernière étape : sa fin marque la fin de la séquence.
  const fin = e => {
    if (e.animationName !== 'pickRevealName') return;
    carte.classList.remove('is-revealing');
    carte.removeEventListener('animationend', fin);
  };
  carte.addEventListener('animationend', fin);
  // Filet : si l'animation ne démarre pas (onglet en arrière-plan, élément
  // retiré entre-temps), la classe ne doit pas rester posée.
  setTimeout(() => {
    carte.removeEventListener('animationend', fin);
    carte.classList.remove('is-revealing');
  }, 2000);
}

/* ============================================================
   6. DÉFILEMENT
   ============================================================ */

/** Pas de défilement : une carte plus l'espacement. */
function pickCarouselStep(bande) {
  const carte = bande.querySelector('.pick-card');
  if (!carte) return bande.clientWidth;

  const styles = getComputedStyle(bande);
  const espace = parseFloat(styles.columnGap || styles.gap) || 0;
  const pas = carte.getBoundingClientRect().width + espace;

  // Sur grand écran, avancer d'une seule carte donne l'impression que le
  // bouton ne fait rien : on avance d'un écran, en gardant une carte visible
  // comme point de repère.
  const parEcran = Math.max(1, Math.floor(bande.clientWidth / pas) - 1);
  return pas * parEcran;
}

/** Déplacement d'un cran. `direction` vaut -1 (gauche) ou 1 (droite). */
function scrollPickCarousel(direction) {
  const bande = document.getElementById('picks-carousel');
  if (!bande) return;
  bande.scrollBy({ left: pickCarouselStep(bande) * direction, behavior: 'smooth' });
}

/** Grise les flèches aux extrémités. */
function updatePickCarouselButtons() {
  const bande = document.getElementById('picks-carousel');
  const prev = document.getElementById('carousel-prev');
  const next = document.getElementById('carousel-next');
  if (!bande || !prev || !next) return;

  // Marge d'un pixel : les navigateurs renvoient parfois 0.5px de reste en
  // fin de course, ce qui laisserait la flèche active pour rien.
  const max = bande.scrollWidth - bande.clientWidth;
  prev.disabled = bande.scrollLeft <= 1;
  next.disabled = max <= 0 || bande.scrollLeft >= max - 1;
}

/**
 * Glissement à la souris et flèches du clavier. Appelée à chaque rendu, mais
 * ne s'installe qu'une fois.
 */
function initPickCarouselScroll() {
  const bande = document.getElementById('picks-carousel');
  if (!bande || bande.dataset.scrollReady === '1') return;
  bande.dataset.scrollReady = '1';

  bande.addEventListener('scroll', updatePickCarouselButtons, { passive: true });
  window.addEventListener('resize', updatePickCarouselButtons);

  // Le doigt est déjà géré nativement par overflow-x. Ce bloc n'ajoute que
  // le glisser à la souris, absent des navigateurs de bureau.
  let actif = false;
  let departX = 0;
  let departScroll = 0;
  let distance = 0;

  bande.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    actif = true;
    distance = 0;
    departX = e.clientX;
    departScroll = bande.scrollLeft;
    bande.classList.add('is-dragging');
  });

  bande.addEventListener('pointermove', e => {
    if (!actif) return;
    const delta = e.clientX - departX;
    if (Math.abs(delta) > 3 && !bande.hasPointerCapture(e.pointerId)) {
      // Capture différée : un clic net ne doit pas être avalé.
      bande.setPointerCapture(e.pointerId);
    }
    distance = Math.max(distance, Math.abs(delta));
    bande.scrollLeft = departScroll - delta;
  });

  const relacher = e => {
    if (!actif) return;
    actif = false;
    bande.classList.remove('is-dragging');
    if (e && bande.hasPointerCapture(e.pointerId)) bande.releasePointerCapture(e.pointerId);
  };
  bande.addEventListener('pointerup', relacher);
  bande.addEventListener('pointercancel', relacher);
  bande.addEventListener('lostpointercapture', relacher);

  // Un glissement ne doit pas déclencher le clic de la carte survolée.
  bande.addEventListener('click', e => {
    if (distance > 5) { e.stopPropagation(); e.preventDefault(); distance = 0; }
  }, true);

  // Pas de détournement de la molette verticale : la bande est dans un
  // bandeau collant, donc en permanence sous le curseur. Capturer la molette
  // empêcherait de faire défiler la page. Restent le glissement, les flèches
  // ‹ ›, Maj+molette et le geste latéral du pavé tactile, tous natifs.

  bande.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { e.preventDefault(); scrollPickCarousel(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); scrollPickCarousel(-1); }
  });
}
