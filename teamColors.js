/**
 * Couleurs d'équipe de la LNH.
 *
 * Table statique : chaque équipe possède sa paire de couleurs AVANT que le
 * repêchage commence. Rien n'est tiré au sort ni attribué en cours de route,
 * donc une carte de choix affiche toujours la même couleur d'une session à
 * l'autre, et deux personnes qui regardent le même repêchage voient la même
 * chose.
 *
 * Chaque entrée est [principale, secondaire]. Le dégradé des deux est ce qui
 * distingue les équipes qui partagent un bleu marine (BUF, CBJ, FLA…) : la
 * seconde couleur les sépare visuellement.
 *
 * Fichier autonome (aucune dépendance) : chargé en <script defer> avant
 * draftPickCards.js.
 */

const NHL_TEAM_COLORS = {
  ANA: ['#F47A38', '#B9975B'],
  ARI: ['#8C2633', '#E2D6B5'], // Historique — anciens choix Arizona
  BOS: ['#FFB81C', '#111111'],
  BUF: ['#002654', '#FCB514'],
  CAR: ['#CC0000', '#111111'],
  CBJ: ['#002654', '#CE1126'],
  CGY: ['#D2001C', '#FAAF19'],
  CHI: ['#CF0A2C', '#111111'],
  COL: ['#6F263D', '#236192'],
  DAL: ['#006847', '#8F8F8C'],
  DET: ['#CE1126', '#7A0A16'],
  EDM: ['#041E42', '#FF4C00'],
  FLA: ['#041E42', '#C8102E'],
  LAK: ['#1A1A1A', '#A2AAAD'],
  MIN: ['#154734', '#A6192E'],
  MTL: ['#AF1E2D', '#192168'],
  NJD: ['#CE1126', '#111111'],
  NSH: ['#FFB81C', '#041E42'],
  NYI: ['#00539B', '#F47D30'],
  NYR: ['#0038A8', '#CE1126'],
  OTT: ['#C52032', '#C2912C'],
  PHI: ['#F74902', '#111111'],
  PIT: ['#FCB514', '#111111'],
  SEA: ['#001628', '#99D9D9'],
  SJS: ['#006D75', '#EA7200'],
  STL: ['#002F87', '#FCB514'],
  TBL: ['#002868', '#5F9BE0'],
  TOR: ['#00205B', '#0B4CA1'],
  UTA: ['#71AFE5', '#010101'],
  VAN: ['#00205B', '#00843D'],
  VGK: ['#B4975A', '#333F42'],
  WPG: ['#041E42', '#7B303E'],
  WSH: ['#C8102E', '#041E42']
};

/** Repli quand l'abréviation est inconnue ou absente : gris ardoise neutre. */
const NHL_TEAM_COLORS_FALLBACK = ['#3A414D', '#171A20'];

/**
 * Paire de couleurs d'une équipe. Toujours une paire valide en retour, même
 * pour une abréviation vide ou inconnue : la carte n'a jamais à gérer un cas
 * « pas de couleur ».
 */
function getTeamColors(abbrev) {
  if (!abbrev) return NHL_TEAM_COLORS_FALLBACK;
  return NHL_TEAM_COLORS[String(abbrev).trim().toUpperCase()] || NHL_TEAM_COLORS_FALLBACK;
}

/**
 * Éclaircit (ratio > 0) ou assombrit (ratio < 0) une couleur hexadécimale.
 * Calculé en JS plutôt qu'avec color-mix() en CSS : la fonction CSS n'est pas
 * disponible sur les navigateurs mobiles un peu anciens, et une carte sans
 * fond serait illisible.
 */
function shadeHex(hex, ratio) {
  const clean = String(hex).replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return hex;

  const cible = ratio < 0 ? 0 : 255;
  const force = Math.abs(ratio);
  const canal = decalage => {
    const v = (num >> decalage) & 0xff;
    return Math.round(v + (cible - v) * force);
  };
  const r = canal(16), g = canal(8), b = canal(0);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Mélange deux couleurs. `ratio` est la part de `vers` dans le résultat :
 * 0 rend `depuis` intact, 1 rend `vers`.
 */
function mixHex(depuis, vers, ratio) {
  const lire = hex => {
    const clean = String(hex).replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    return parseInt(full, 16);
  };
  const a = lire(depuis);
  const b = lire(vers);
  if (Number.isNaN(a) || Number.isNaN(b)) return depuis;

  const part = Math.min(1, Math.max(0, ratio));
  const canal = decalage => {
    const va = (a >> decalage) & 0xff;
    const vb = (b >> decalage) & 0xff;
    return Math.round(va + (vb - va) * part);
  };
  return '#' + [canal(16), canal(8), canal(0)]
    .map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Luminance relative (WCAG) — sert à choisir entre texte clair et texte
 * sombre. L'or de Nashville et le bleu marine de Toronto ne peuvent pas
 * porter la même couleur de texte.
 */
function hexLuminance(hex) {
  const clean = String(hex).replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return 0;

  const lin = v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((num >> 16) & 0xff)
       + 0.7152 * lin((num >> 8) & 0xff)
       + 0.0722 * lin(num & 0xff);
}
