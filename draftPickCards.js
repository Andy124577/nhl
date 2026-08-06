/**
 * Carrousel des derniers choix — construction des cartes et défilement.
 *
 * Ce fichier existe pour garder la logique lisible : draftActif.js est
 * minifié, on n'y laisse donc qu'un appel. Tout ce qui touche à l'apparence
 * d'une carte de choix se modifie ici.
 *
 * Une carte = un choix. Photo du joueur au centre, équipe de la LNH en haut
 * à droite, nom de l'équipe du pool qui l'a repêché en bas à gauche, et le
 * fond prend les couleurs de l'équipe du joueur (voir teamColors.js).
 *
 * Le carrousel défile horizontalement : au doigt sur téléphone, en glissant à
 * la souris sur ordinateur, et par les flèches ‹ › dans les deux cas. Tout
 * l'historique est rendu — le plus récent en premier — au lieu d'être paginé
 * cinq par cinq.
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

  return { nom, estEquipe, abbrev, logo, photo, position, proprietaire: pick.team || '' };
}

/** Initiales de repli quand aucune photo n'est disponible. */
function pickInitials(nom) {
  return String(nom)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(m => m[0])
    .join('')
    .toUpperCase();
}

/* ============================================================
   2. CONSTRUCTION D'UNE CARTE
   ============================================================ */

/**
 * Une carte de choix. Construite par le DOM et non par une chaîne HTML : le
 * nom d'équipe du pool est saisi par l'utilisateur, l'insérer via innerHTML
 * ouvrirait une injection de balises.
 */
function buildPickCard(pick, numero, ronde) {
  const info = resolvePickInfo(pick);
  const [couleurA, couleurB] = getTeamColors(info.abbrev);

  // Les couleurs claires (l'or de Boston, le bleu ciel d'Utah) sont
  // assombries avant d'être posées en fond : le texte blanc doit rester
  // lisible sur les 32 équipes sans avoir à changer de couleur d'encre.
  const fondA = hexLuminance(couleurA) > 0.42 ? shadeHex(couleurA, -0.42) : couleurA;
  const fondB = hexLuminance(couleurB) > 0.55 ? shadeHex(couleurB, -0.34) : couleurB;

  const carte = document.createElement('article');
  carte.className = 'pick-card';
  carte.style.setProperty('--team-a', fondA);
  carte.style.setProperty('--team-b', fondB);
  carte.style.setProperty('--team-deep', shadeHex(fondA, -0.62));
  carte.style.setProperty('--team-accent', couleurB); // teinte vive conservée pour les liserés
  if (info.abbrev) carte.dataset.team = info.abbrev;

  const sheen = document.createElement('div');
  sheen.className = 'pick-card-sheen';
  carte.appendChild(sheen);

  /* ---- Haut : identité à gauche, équipe LNH à droite ---- */
  const haut = document.createElement('div');
  haut.className = 'pick-card-head';

  const identite = document.createElement('div');
  identite.className = 'pick-card-id';

  const nom = document.createElement('h4');
  nom.className = 'pick-card-name';
  nom.textContent = info.nom;
  identite.appendChild(nom);

  if (info.position) {
    const pos = document.createElement('span');
    pos.className = 'pick-card-pos';
    pos.textContent = info.position;
    identite.appendChild(pos);
  }
  haut.appendChild(identite);

  const club = document.createElement('div');
  club.className = 'pick-card-club';
  if (info.logo) {
    const logo = document.createElement('img');
    logo.className = 'pick-card-logo';
    logo.src = info.logo;
    logo.alt = info.abbrev || '';
    logo.loading = 'lazy';
    logo.addEventListener('error', () => logo.remove());
    club.appendChild(logo);
  }
  if (info.abbrev) {
    const code = document.createElement('span');
    code.className = 'pick-card-abbr';
    code.textContent = info.abbrev;
    club.appendChild(code);
  }
  haut.appendChild(club);
  carte.appendChild(haut);

  /* ---- Milieu : la photo ---- */
  const zonePhoto = document.createElement('div');
  zonePhoto.className = 'pick-card-photo';
  if (info.estEquipe) zonePhoto.classList.add('is-team');

  if (info.photo) {
    const img = document.createElement('img');
    img.className = 'pick-card-photo-img';
    img.src = info.photo;
    img.alt = info.nom;
    img.loading = 'lazy';
    img.draggable = false;
    // Une photo manquante laisserait un rond vide : on bascule sur les
    // initiales, comme si aucune photo n'avait été trouvée.
    img.addEventListener('error', () => {
      img.remove();
      zonePhoto.appendChild(buildPickInitials(info.nom));
    });
    zonePhoto.appendChild(img);
  } else {
    zonePhoto.appendChild(buildPickInitials(info.nom));
  }
  carte.appendChild(zonePhoto);

  /* ---- Bas : pool à gauche, repère du choix à droite ---- */
  const bas = document.createElement('div');
  bas.className = 'pick-card-foot';

  const pool = document.createElement('span');
  pool.className = 'pick-card-owner';
  pool.textContent = info.proprietaire;
  pool.title = info.proprietaire;
  bas.appendChild(pool);

  const repere = document.createElement('span');
  repere.className = 'pick-card-meta';
  repere.textContent = ronde ? `R${ronde} · #${numero}` : `#${numero}`;
  bas.appendChild(repere);

  carte.appendChild(bas);

  const etiquette = [info.nom, info.abbrev, info.proprietaire].filter(Boolean).join(' — ');
  carte.setAttribute('aria-label', `Choix ${numero} : ${etiquette}`);

  return carte;
}

function buildPickInitials(nom) {
  const span = document.createElement('span');
  span.className = 'pick-card-initials';
  span.textContent = pickInitials(nom);
  return span;
}

/* ============================================================
   3. RENDU DU CARROUSEL
   ============================================================ */

let pickCarouselCount = -1;

/**
 * Reconstruit la bande. `picks` est l'historique dans l'ordre du repêchage ;
 * l'affichage l'inverse pour montrer le choix le plus récent en premier.
 */
function renderPickCarousel(picks) {
  const bande = document.getElementById('picks-carousel');
  if (!bande) return;

  const liste = Array.isArray(picks) ? picks : [];
  const nouveauChoix = liste.length !== pickCarouselCount;
  const positionAvant = bande.scrollLeft;

  bande.replaceChildren();

  if (!liste.length) {
    const vide = document.createElement('p');
    vide.className = 'picks-carousel-empty';
    vide.textContent = 'Aucun choix pour le moment.';
    bande.appendChild(vide);
    pickCarouselCount = 0;
    updatePickCarouselButtons();
    return;
  }

  // Nombre d'équipes du pool : sert à retrouver la ronde, que
  // l'historique ne stocke pas.
  const nbEquipes = (typeof draftData !== 'undefined' && draftData && draftData.teams)
    ? Object.keys(draftData.teams).length
    : 0;

  const fragment = document.createDocumentFragment();
  for (let i = liste.length - 1; i >= 0; i--) {
    const ronde = nbEquipes > 0 ? Math.floor(i / nbEquipes) + 1 : 0;
    fragment.appendChild(buildPickCard(liste[i], i + 1, ronde));
  }
  bande.appendChild(fragment);

  pickCarouselCount = liste.length;
  initPickCarouselScroll();

  // Un nouveau choix ramène au début, là où il vient d'apparaître ; un simple
  // rafraîchissement (même nombre de choix) laisse la position tranquille.
  if (nouveauChoix) bande.scrollLeft = 0;
  else bande.scrollLeft = positionAvant;

  updatePickCarouselButtons();
}

/* ============================================================
   4. DÉFILEMENT
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
  const debut = bande.scrollLeft <= 1;
  const fin = bande.scrollLeft >= max - 1;

  prev.disabled = debut;
  next.disabled = fin || max <= 0;
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
