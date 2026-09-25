/**
 * Alignement d'un club de la LNH : ses trios, ses paires de défenseurs, ses
 * gardiens, ses unités spéciales et ses blessés.
 *
 * La LNH ne publie AUCUN trio. Son effectif (`/v1/roster/{club}/current`) dit
 * qui fait partie du club, pas qui joue avec qui. Les trios viennent donc de
 * Daily Faceoff, la référence du milieu : ses pages d'équipe sont refaites
 * après chaque entraînement, chaque période d'échauffement et chaque match,
 * et chacune porte l'heure de sa dernière mise à jour et ce qui l'a motivée
 * (« Training Camp 2026 », un entraînement matinal…).
 *
 * Daily Faceoff n'a pas d'API publique. Ses pages sont rendues par Next.js,
 * qui embarque toutes les données de la page dans une balise
 * `<script id="__NEXT_DATA__">` : c'est ce JSON qui est lu, jamais le HTML
 * affiché. Plus stable qu'un grattage de balises, mais pas garanti : si la
 * page change de forme, `extraireCombinaisons` rend null et le service
 * retombe sur l'effectif officiel.
 *
 * Ses numéros de chandail sont par contre peu fiables — vérifié le 25
 * septembre 2026 : Noah Dobson y portait le 8 (celui de Matheson), Demidov et
 * Kapanen n'en avaient pas. Le numéro, la photo et l'identifiant viennent donc
 * de l'effectif officiel de la LNH, apparié par nom ; Daily Faceoff ne décide
 * que de la place de chacun.
 *
 * Fonctions pures, sans réseau : `services/alignement.js` va chercher les
 * trois sources et garde le résultat en cache.
 */

'use strict';

const URL_DFO = 'https://www.dailyfaceoff.com/teams';

/**
 * Code LNH → page d'équipe de Daily Faceoff.
 *
 * Daily Faceoff a ses propres abréviations (MON, NAS, VEG, LA…) : la
 * correspondance passe par l'adresse de la page, pas par le code.
 */
const SLUGS_DFO = {
    ANA: 'anaheim-ducks', BOS: 'boston-bruins', BUF: 'buffalo-sabres',
    CAR: 'carolina-hurricanes', CBJ: 'columbus-blue-jackets', CGY: 'calgary-flames',
    CHI: 'chicago-blackhawks', COL: 'colorado-avalanche', DAL: 'dallas-stars',
    DET: 'detroit-red-wings', EDM: 'edmonton-oilers', FLA: 'florida-panthers',
    LAK: 'los-angeles-kings', MIN: 'minnesota-wild', MTL: 'montreal-canadiens',
    NJD: 'new-jersey-devils', NSH: 'nashville-predators', NYI: 'new-york-islanders',
    NYR: 'new-york-rangers', OTT: 'ottawa-senators', PHI: 'philadelphia-flyers',
    PIT: 'pittsburgh-penguins', SEA: 'seattle-kraken', SJS: 'san-jose-sharks',
    STL: 'st-louis-blues', TBL: 'tampa-bay-lightning', TOR: 'toronto-maple-leafs',
    UTA: 'utah-mammoth', VAN: 'vancouver-canucks', VGK: 'vegas-golden-knights',
    WPG: 'winnipeg-jets', WSH: 'washington-capitals'
};

function urlDFO(code) {
    return `${URL_DFO}/${SLUGS_DFO[code]}/line-combinations`;
}

/** `{ default, fr }` de la LNH → une chaîne. */
function texte(valeur) {
    if (valeur == null) return '';
    if (typeof valeur === 'string') return valeur;
    return valeur.default || '';
}

/** Un nombre, ou null si la source n'en a pas donné. */
function nombre(valeur) {
    return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : null;
}

/** « Juraj Slafkovský » et « Juraj Slafkovsky » doivent se reconnaître. */
function normaliser(nom) {
    return String(nom || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z]+/g, ' ')
        .trim();
}

/**
 * Les combinaisons d'une page d'équipe de Daily Faceoff, réduites à ce qui
 * sert. Null si la page n'a pas la forme attendue — jamais une liste vide,
 * qu'un appelant prendrait pour un club sans joueurs.
 */
function extraireCombinaisons(html) {
    const bloc = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ''));
    if (!bloc) return null;
    let donnees;
    try { donnees = JSON.parse(bloc[1]); } catch (erreur) { return null; }

    const brut = donnees && donnees.props && donnees.props.pageProps && donnees.props.pageProps.combinations;
    if (!brut || !Array.isArray(brut.players)) return null;

    const players = brut.players
        .filter(p => p && p.name && p.groupIdentifier && p.positionIdentifier)
        .map(p => ({
            name: String(p.name),
            number: Number.isInteger(p.jerseyNumber) ? p.jerseyNumber : null,
            group: String(p.groupIdentifier),
            groupName: p.groupName || null,
            category: p.categoryIdentifier || null,
            slot: String(p.positionIdentifier),
            injury: p.injuryStatus || null,
            gtd: !!p.gameTimeDecision
        }));
    if (!players.length) return null;

    return {
        updatedAt: brut.updatedAt || null,
        sourceName: brut.sourceName || null,
        // `source` est souvent le lien du gazouillis qui a motivé la mise à
        // jour, parfois vide, parfois du texte libre.
        sourceUrl: /^https?:\/\//.test(brut.source || '') ? brut.source : null,
        players
    };
}

/** L'effectif officiel d'un club, à plat. */
function lireEffectif(brut) {
    const liste = [];
    for (const [cle, parDefaut] of [['forwards', null], ['defensemen', 'D'], ['goalies', 'G']]) {
        for (const p of (brut && brut[cle]) || []) {
            if (!p || !p.id) continue;
            liste.push({
                id: p.id,
                firstName: texte(p.firstName),
                lastName: texte(p.lastName),
                number: nombre(p.sweaterNumber),
                position: p.positionCode || parDefaut,
                headshot: p.headshot || null
            });
        }
    }
    return liste;
}

/**
 * Le joueur de l'effectif officiel qui correspond à un nom de Daily Faceoff.
 *
 * Le nom complet d'abord. Sinon le nom de famille, pour les diminutifs :
 * « Zack Bolduc » chez Daily Faceoff, « Zachary Bolduc » à la LNH. Un nom de
 * famille seul ne suffit pas — un joueur échangé que Daily Faceoff n'a pas
 * encore retiré prendrait la photo d'un homonyme — il faut aussi la même
 * initiale ou le même numéro. Deux frères du même club (Arber et Florian
 * Xhekaj) se séparent au nom complet. Dans le doute, null : mieux vaut un
 * joueur sans photo qu'avec celle d'un autre.
 */
function apparier(nom, numero, effectif) {
    const cle = normaliser(nom);
    if (!cle) return null;

    const exacts = effectif.filter(p => normaliser(`${p.firstName} ${p.lastName}`) === cle);
    if (exacts.length === 1) return exacts[0];

    let candidats = effectif.filter(p => {
        const famille = normaliser(p.lastName);
        if (!famille || !(cle === famille || cle.endsWith(` ${famille}`))) return false;
        const initiale = normaliser(p.firstName).charAt(0);
        return initiale === cle.charAt(0) || (numero != null && p.number === numero);
    });
    if (candidats.length > 1 && numero != null) {
        const memeNumero = candidats.filter(p => p.number === numero);
        if (memeNumero.length) candidats = memeNumero;
    }
    return candidats.length === 1 ? candidats[0] : null;
}

/** Secondes → « 18:42 ». */
function minutes(secondes) {
    const s = nombre(secondes);
    if (s == null) return null;
    const total = Math.round(s);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Les statistiques de saison de toute la ligue, indexées par joueur.
 *
 * Par joueur et non par club : un joueur arrivé cet été (Kreider, d'Anaheim)
 * n'a aucune ligne dans les statistiques de son nouveau club.
 */
function lireStats(patineurs, gardiens) {
    const parId = new Map();
    const parNom = new Map();
    const indexer = (nom, id) => {
        const cle = normaliser(nom);
        if (!cle) return;
        if (!parNom.has(cle)) parNom.set(cle, []);
        parNom.get(cle).push(id);
    };

    for (const p of (patineurs && patineurs.data) || []) {
        if (!p || !p.playerId) continue;
        parId.set(p.playerId, {
            gp: nombre(p.gamesPlayed), g: nombre(p.goals), a: nombre(p.assists),
            pts: nombre(p.points), pm: nombre(p.plusMinus), toi: minutes(p.timeOnIcePerGame)
        });
        indexer(p.skaterFullName, p.playerId);
    }
    for (const g of (gardiens && gardiens.data) || []) {
        if (!g || !g.playerId) continue;
        parId.set(g.playerId, {
            gp: nombre(g.gamesPlayed), w: nombre(g.wins), l: nombre(g.losses),
            otl: nombre(g.otLosses), gaa: nombre(g.goalsAgainstAverage),
            svPct: nombre(g.savePct), so: nombre(g.shutouts)
        });
        indexer(g.goalieFullName, g.playerId);
    }
    return { parId, parNom };
}

/** L'identifiant LNH d'un nom absent de l'effectif, s'il est sans ambiguïté. */
function idParNom(stats, nom) {
    if (!stats) return null;
    const ids = stats.parNom.get(normaliser(nom)) || [];
    return ids.length === 1 ? ids[0] : null;
}

/**
 * La photo d'un joueur connu de la LNH mais absent de l'effectif du club —
 * un invité au camp, un échange que la LNH n'a pas encore inscrit. Le
 * répertoire « latest » ne dépend ni de la saison ni du club.
 */
const photoParId = id => `https://assets.nhle.com/mugs/nhl/latest/${id}.png`;

function formerJoueur(entree, effectif, stats) {
    const officiel = apparier(entree.name, entree.number, effectif);
    const id = officiel ? officiel.id : idParNom(stats, entree.name);
    const [prenom, ...reste] = entree.name.split(' ');
    return {
        id: id || null,
        name: officiel ? `${officiel.firstName} ${officiel.lastName}`.trim() : entree.name,
        firstName: officiel ? officiel.firstName : prenom,
        lastName: officiel ? officiel.lastName : (reste.join(' ') || prenom),
        number: officiel && officiel.number != null ? officiel.number : entree.number,
        position: officiel ? officiel.position : null,
        headshot: officiel ? officiel.headshot : (id ? photoParId(id) : null),
        slot: entree.slot,
        status: entree.injury,
        gtd: entree.gtd,
        stats: (id && stats && stats.parId.get(id)) || null
    };
}

/** Joueur de l'effectif officiel, quand il n'y a pas de trios à afficher. */
function formerDepuisEffectif(p, stats) {
    return {
        id: p.id,
        name: `${p.firstName} ${p.lastName}`.trim(),
        firstName: p.firstName,
        lastName: p.lastName,
        number: p.number,
        position: p.position,
        headshot: p.headshot,
        slot: null,
        status: null,
        gtd: false,
        stats: (stats && stats.parId.get(p.id)) || null
    };
}

/** Ordre des places dans un groupe : AG, C, AD ; DG, DD ; g1, g2 ; sk1… */
const RANG_PLACE = { lw: 0, c: 1, rw: 2, ld: 0, rd: 1 };
function rangPlace(place) {
    if (place in RANG_PLACE) return RANG_PLACE[place];
    const n = /(\d+)$/.exec(place);
    return n ? Number(n[1]) : 99;
}

const FAMILLES = [
    ['forwards', /^f(\d+)$/],
    ['defense', /^d(\d+)$/],
    ['powerPlay', /^pp(\d+)$/],
    ['penaltyKill', /^pk(\d+)$/]
];

const parNumero = (a, b) => (a.number ?? 999) - (b.number ?? 999);

/**
 * Ce que `/team-lineup/:club` renvoie.
 *
 * `lines` dit si les trios sont là. Sans eux, `roster` porte l'effectif
 * officiel par position — ce qu'on sait, sans deviner qui joue avec qui.
 * `stale` dit que Daily Faceoff n'a pas répondu et que les trios servis sont
 * ceux de la dernière lecture réussie ; `source.updatedAt` en donne l'âge
 * réel, qu'on n'a pas le droit de rajeunir.
 */
function formerAlignement({ equipe, combinaisons = null, perime = false, effectif = [], stats = null, saison = null, genereLe = null }) {
    const alignement = {
        team: equipe,
        generatedAt: genereLe,
        lines: !!combinaisons,
        stale: !!(combinaisons && perime),
        source: combinaisons ? {
            name: 'Daily Faceoff',
            url: urlDFO(equipe),
            label: combinaisons.sourceName,
            link: combinaisons.sourceUrl,
            updatedAt: combinaisons.updatedAt
        } : null,
        statsSeason: saison && saison.seasonId ? {
            id: saison.seasonId,
            label: saison.label || null,
            started: !!saison.hasStarted
        } : null,
        forwards: [], defense: [], goalies: [], powerPlay: [], penaltyKill: [],
        injuries: [], others: [],
        roster: null
    };

    if (!combinaisons) {
        const joueurs = effectif.map(p => formerDepuisEffectif(p, stats));
        alignement.roster = {
            forwards: joueurs.filter(p => ['C', 'L', 'R'].includes(p.position)).sort(parNumero),
            defense: joueurs.filter(p => p.position === 'D').sort(parNumero),
            goalies: joueurs.filter(p => p.position === 'G').sort(parNumero)
        };
        return alignement;
    }

    const groupes = new Map(); // identifiant → { id, label, category, players }
    for (const entree of combinaisons.players) {
        if (!groupes.has(entree.group)) {
            groupes.set(entree.group, { id: entree.group, label: entree.groupName, category: entree.category, players: [] });
        }
        groupes.get(entree.group).players.push(formerJoueur(entree, effectif, stats));
    }

    for (const groupe of groupes.values()) {
        groupe.players.sort((a, b) => rangPlace(a.slot) - rangPlace(b.slot));
        const famille = FAMILLES.find(([, motif]) => motif.test(groupe.id));
        if (famille) {
            alignement[famille[0]].push({ id: groupe.id, players: groupe.players });
        } else if (groupe.id === 'g') {
            alignement.goalies.push(...groupe.players);
        } else if (groupe.id === 'ir') {
            alignement.injuries.push(...groupe.players);
        } else {
            alignement.others.push({ id: groupe.id, label: groupe.label, players: groupe.players });
        }
    }
    for (const [cle, motif] of FAMILLES) {
        alignement[cle].sort((a, b) => Number(motif.exec(a.id)[1]) - Number(motif.exec(b.id)[1]));
    }
    return alignement;
}

module.exports = {
    URL_DFO,
    SLUGS_DFO,
    urlDFO,
    normaliser,
    extraireCombinaisons,
    lireEffectif,
    apparier,
    lireStats,
    formerAlignement
};
