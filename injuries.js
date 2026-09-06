/**
 * BLESSURES — pastille « joueur indisponible » partagée.
 *
 * Une seule source : GET /nhl-injuries (server.js), lui-même alimenté par
 * le rapport d'ESPN — api-web.nhle.com n'en publie aucun. Ce flux ne
 * transporte AUCUN identifiant de joueur de la LNH : le rapprochement
 * avec nos tableaux (qui, eux, ne connaissent que playerId et le nom
 * complet) ne peut donc se faire que sur le nom, d'où l'indexation
 * normalisée ci-dessous plutôt qu'une simple Map nom → blessure.
 *
 * Les tableaux (stats, draftActif, classement) se rendent de façon
 * synchrone alors que la liste des blessés arrive, elle, en asynchrone.
 * Plutôt que de retarder chaque rendu — ou d'aller brancher un rappel
 * dans chacun des six points de rendu concernés, dont deux minifiés —
 * les gabarits posent une ancre vide (.inj-slot) et un MutationObserver
 * la remplit dès que les données sont là. Un tableau re-rendu (tri,
 * recherche, pagination, socket du repêchage) repose donc de nouvelles
 * ancres qui se remplissent toutes seules.
 *
 * Dépendances : aucune. Volontairement — classement.html ne charge ni
 * statsLeaders.js (escapeHTML) ni la même trousse d'icônes que stats.html.
 */

/* ============================================================
   1. ÉTAT + CHARGEMENT
   ============================================================ */

const INJ_CACHE_KEY = 'fzInjuries:v1';
const INJ_CACHE_TTL_MS = 15 * 60 * 1000;

const injState = {
    ready: false,
    byName: new Map(),   // nom normalisé          -> [blessure, …]
    byLoose: new Map(),  // « famille|initiale »   -> [blessure, …]
    list: [],
    lastUpdated: null,
    promise: null
};

function injBaseUrl() {
    // BASE_URL est défini par index.js/classement.js/draftActif.js selon la
    // page ; en son absence, l'origine courante fait l'affaire.
    return (typeof BASE_URL === 'string' && BASE_URL) ? BASE_URL : '';
}

function injReadCache() {
    try {
        const raw = sessionStorage.getItem(INJ_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || (Date.now() - parsed.t) > INJ_CACHE_TTL_MS) return null;
        return parsed.d;
    } catch (_) { return null; }
}

function injWriteCache(payload) {
    try {
        sessionStorage.setItem(INJ_CACHE_KEY, JSON.stringify({ t: Date.now(), d: payload }));
    } catch (_) { /* quota ou navigation privée : le cache n'est qu'un confort */ }
}

/** Charge (une seule fois par page) la liste des blessés. */
function loadInjuries() {
    if (injState.promise) return injState.promise;

    const cached = injReadCache();
    if (cached) {
        injIndex(cached);
        injState.promise = Promise.resolve(injState);
        decorateInjurySlots();
        return injState.promise;
    }

    injState.promise = fetch(`${injBaseUrl()}/nhl-injuries?limit=300`)
        .then(r => r.ok ? r.json() : null)
        .then(payload => {
            if (payload) { injIndex(payload); injWriteCache(payload); }
            decorateInjurySlots();
            return injState;
        })
        .catch(err => {
            // Un rapport de blessures indisponible ne doit jamais empêcher
            // un tableau de s'afficher : on reste simplement « pas prêt »,
            // et les ancres restent vides.
            console.warn('Blessures indisponibles :', err.message);
            return injState;
        });

    return injState.promise;
}

/* ============================================================
   2. INDEXATION ET RAPPROCHEMENT PAR NOM
   ============================================================ */

/**
 * Ramène un nom à sa forme comparable : sans accents, sans ponctuation
 * (Marc-André → « marc andre », O'Reilly → « o reilly ») et sans suffixe
 * générationnel, ESPN et la LNH n'écrivant pas « Jr. » de la même façon.
 */
function injNormalizeName(value) {
    return String(value || '')
        // NFD sépare « é » en « e » + accent combinant, puis les marques
        // combinantes sont RETIRÉES — pas remplacées par une espace.
        //
        // Le filtre [^a-z] plus bas remplace tout le reste par ' ' : en le
        // laissant traiter l'accent, « Bédard » devenait « be dard » et ne
        // pouvait plus être rapproché de « Bedard », l'orthographe sans
        // accent qu'emploie le flux d'ESPN. Ni la clé exacte ni la clé
        // approximative (« dard|c » contre « bedard|c ») ne concordaient,
        // et aucun joueur au nom accentué n'obtenait sa pastille.
        //
        // Même traitement que nameKey() (tools/build_draftkit.js) et que
        // normaliser() (profanity.js), qui retirent les marques de la
        // même façon.
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z]+/g, ' ')
        .replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Clé de repli « nom de famille + initiale du prénom » : rattrape les
 * diminutifs, seule divergence fréquente entre les deux sources
 * (Alex/Alexander Wennberg, Mitch/Mitchell Marner, Matt/Matthew Boldy).
 */
function injLooseKey(normalized) {
    const parts = String(normalized || '').split(' ').filter(Boolean);
    if (parts.length < 2) return null;
    return `${parts[parts.length - 1]}|${parts[0][0]}`;
}

function injPush(map, key, entry) {
    if (!key) return;
    const bucket = map.get(key);
    if (bucket) bucket.push(entry); else map.set(key, [entry]);
}

function injIndex(payload) {
    const list = (payload && payload.injuries) || [];
    injState.list = list;
    injState.lastUpdated = payload ? payload.lastUpdated : null;
    injState.byName.clear();
    injState.byLoose.clear();

    list.forEach(entry => {
        const normalized = injNormalizeName(entry.playerName);
        if (!normalized) return;
        injPush(injState.byName, normalized, entry);
        injPush(injState.byLoose, injLooseKey(normalized), entry);
    });

    injState.ready = true;
}

/**
 * Ramène une valeur d'équipe au code officiel courant. Les fiches
 * statiques portent `teamAbbrevs`, l'historique complet des clubs du
 * joueur (« TOR,MTL ») : c'est le dernier qui est le club actuel, même
 * convention que getTeamLogoPath() ailleurs dans le site.
 */
function injTeamCode(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === 'null' || raw === 'N/A') return '';
    return raw.split(',').pop().trim().toUpperCase();
}

/** Départage un lot d'homonymes : l'équipe tranche, sinon rien. */
function injPickFromBucket(bucket, code) {
    if (!bucket || !bucket.length) return null;
    if (bucket.length === 1) return bucket[0];
    // Deux joueurs blessés portant le même nom, sans équipe pour les
    // distinguer : mieux vaut ne rien afficher qu'accoler une blessure au
    // mauvais joueur.
    return code ? (bucket.find(e => e.team === code) || null) : null;
}

/**
 * Blessure d'un joueur, ou null. `teamAbbrev` est facultatif mais évite
 * les faux positifs sur les homonymes.
 */
function getPlayerInjury(playerName, teamAbbrev) {
    if (!injState.ready) return null;
    const normalized = injNormalizeName(playerName);
    if (!normalized) return null;

    const code = injTeamCode(teamAbbrev);
    const exact = injPickFromBucket(injState.byName.get(normalized), code);
    if (exact) return exact;

    // Sur la clé approximative, on n'accepte le rapprochement que si
    // l'équipe concorde : « martin|j » pourrait sinon coller la blessure
    // d'un Jake Martin à un Josh Martin.
    if (!code) return null;
    const loose = injState.byLoose.get(injLooseKey(normalized));
    const match = injPickFromBucket(loose, code);
    return match && match.team === code ? match : null;
}

/* ============================================================
   3. MISE EN FRANÇAIS
   ============================================================ */

const INJ_TYPE_FR = {
    'Abdomen': 'Abdomen', 'Achilles': 'Tendon d’Achille', 'Ankle': 'Cheville',
    'Arm': 'Bras', 'Back': 'Dos', 'Biceps': 'Biceps', 'Chest': 'Poitrine',
    'Collarbone': 'Clavicule', 'Concussion': 'Commotion cérébrale',
    'Ear': 'Oreille', 'Elbow': 'Coude', 'Eye': 'Œil', 'Face': 'Visage',
    'Finger': 'Doigt', 'Foot': 'Pied', 'Forearm': 'Avant-bras', 'Groin': 'Aine',
    'Hamstring': 'Ischio-jambier', 'Hand': 'Main', 'Head': 'Tête',
    'Heel': 'Talon', 'Hip': 'Hanche', 'Hip Flexor': 'Fléchisseur de la hanche',
    'Illness': 'Maladie', 'Jaw': 'Mâchoire', 'Knee': 'Genou',
    'Kneecap': 'Rotule', 'Leg': 'Jambe', 'Lower Body': 'Bas du corps',
    'Lower Leg': 'Bas de la jambe', 'Neck': 'Cou', 'Nose': 'Nez',
    'Oblique': 'Oblique', 'Personal': 'Raisons personnelles',
    'Quadriceps': 'Quadriceps', 'Ribs': 'Côtes', 'Shoulder': 'Épaule',
    'Sports Hernia': 'Hernie sportive', 'Suspension': 'Suspension',
    'Thumb': 'Pouce', 'Toe': 'Orteil', 'Torso': 'Torse',
    'Undisclosed': 'Non divulguée', 'Upper Body': 'Haut du corps',
    'Wrist': 'Poignet'
};

const INJ_DETAIL_FR = {
    'Bruise': 'contusion', 'Concussion': 'commotion', 'Fracture': 'fracture',
    'Infection': 'infection', 'Laceration': 'lacération', 'Severe': 'grave',
    'Soreness': 'douleurs', 'Sprain': 'entorse', 'Strain': 'élongation',
    'Surgery': 'opération', 'Tear': 'déchirure'
};

const INJ_SIDE_FR = { 'Left': 'gauche', 'Right': 'droit' };

const INJ_STATUS_FALLBACK_FR = {
    'Out': 'Absent', 'Injured Reserve': 'Réserve des blessés',
    'Day-To-Day': 'Au jour le jour', 'Suspension': 'Suspension'
};

function injStatusFr(injury) {
    return injury.statusFr || INJ_STATUS_FALLBACK_FR[injury.status] || injury.status || 'Indisponible';
}

/** « Genou droit (opération) », « Haut du corps », ou '' si rien n'est connu. */
function injNatureFr(injury) {
    if (!injury.injuryType && !injury.injuryDetail) return '';
    // Une suspension arrive avec type === 'Suspension', ce que le statut dit
    // déjà : sans cette sortie, l'infobulle affichait « Suspension —
    // Suspension ».
    if (injury.injuryType === 'Suspension' && injury.status === 'Suspension') return '';
    let nature = INJ_TYPE_FR[injury.injuryType] || injury.injuryType || '';
    const side = INJ_SIDE_FR[injury.injurySide];
    if (nature && side) nature += ` ${side}`;
    const rawDetail = injury.injuryDetail && injury.injuryDetail !== 'Not Specified'
        ? injury.injuryDetail : '';
    // ESPN répète parfois le type dans le détail (type "Concussion", detail
    // "Concussion") : comparer les mots anglais d'origine attrape ce cas,
    // que la comparaison sur les traductions ratait (« commotion cérébrale »
    // et « commotion » ne sont pas la même chaîne).
    const detail = rawDetail && rawDetail.toLowerCase() !== String(injury.injuryType || '').toLowerCase()
        ? (INJ_DETAIL_FR[rawDetail] || rawDetail.toLowerCase())
        : '';
    if (detail && detail !== nature.toLowerCase()) nature += nature ? ` (${detail})` : detail;
    return nature;
}

/* ============================================================
   4. DURÉE
   ============================================================ */

/**
 * « 2026-09-15 » via new Date() serait lu comme minuit UTC, donc rendu la
 * veille dans tout fuseau négatif — le Québec inclus. D'où la
 * construction explicite en heure locale pour les dates seules.
 */
function injParseDate(value) {
    if (!value) return null;
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    if (ymd) return new Date(+ymd[1], +ymd[2] - 1, +ymd[3]);
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
}

function injDayDiff(from, to) {
    const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((b - a) / 86400000);
}

/** Durée lisible : jours en deçà de deux semaines, puis semaines, puis mois. */
function injDurationFr(days) {
    if (days <= 0) return 'aujourd’hui';
    if (days === 1) return '1 jour';
    if (days < 14) return `${days} jours`;
    if (days < 60) {
        const weeks = Math.round(days / 7);
        return `${weeks} semaine${weeks > 1 ? 's' : ''}`;
    }
    if (days < 365) {
        const months = Math.round(days / 30.44);
        return `${months} mois`;
    }
    const years = Math.round(days / 365.25 * 10) / 10;
    return `${String(years).replace('.', ',')} an${years >= 2 ? 's' : ''}`;
}

function injFormatDate(date) {
    try {
        return new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
    } catch (_) {
        return date.toISOString().slice(0, 10);
    }
}

/**
 * Tout ce qui touche au temps pour une blessure :
 *   since / sinceDays  — début de l'absence et son ancienneté
 *   ret / untilDays    — retour annoncé et le délai restant
 *   totalDays          — durée totale annoncée, quand les deux bouts sont connus
 */
function injuryTiming(injury) {
    const now = new Date();
    const since = injParseDate(injury.since);
    const ret = injParseDate(injury.returnDate);
    const out = { since, ret, sinceDays: null, untilDays: null, totalDays: null };
    if (since) out.sinceDays = Math.max(0, injDayDiff(since, now));
    if (ret) out.untilDays = injDayDiff(now, ret);
    if (since && ret) {
        const total = injDayDiff(since, ret);
        if (total > 0) out.totalDays = total;
    }
    return out;
}

/** Phrase courte pour l'infobulle : « absent depuis 7 semaines · retour prévu le … ». */
function injuryTimingSummary(injury) {
    const t = injuryTiming(injury);
    const bits = [];
    if (t.sinceDays !== null) bits.push(`absent depuis ${injDurationFr(t.sinceDays)}`);
    if (t.ret) {
        bits.push(t.untilDays > 0
            ? `retour prévu le ${injFormatDate(t.ret)} (dans ${injDurationFr(t.untilDays)})`
            : `retour prévu le ${injFormatDate(t.ret)}`);
    }
    return bits.join(' · ');
}

/* ============================================================
   5. PASTILLE DANS LES LISTES
   ============================================================ */

const INJ_GLYPHS = {
    // Une suspension n'est pas une blessure : même flux, même pastille,
    // mais un glyphe qui ne raconte pas d'histoire fausse.
    suspension: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.6"/><line x1="6.2" y1="6.2" x2="17.8" y2="17.8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    medical: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9.6 2.6h4.8a1.4 1.4 0 0 1 1.4 1.4v3.8h3.8A1.4 1.4 0 0 1 21 9.2v4.8a1.4 1.4 0 0 1-1.4 1.4h-3.8v3.8a1.4 1.4 0 0 1-1.4 1.4H9.6a1.4 1.4 0 0 1-1.4-1.4v-3.8H4.4A1.4 1.4 0 0 1 3 14V9.2a1.4 1.4 0 0 1 1.4-1.4h3.8V4a1.4 1.4 0 0 1 1.4-1.4Z"/></svg>'
};

function injEscape(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Texte complet de l'infobulle : statut, nature, durée. */
function injuryTooltip(injury) {
    return [injStatusFr(injury), injNatureFr(injury), injuryTimingSummary(injury)]
        .filter(Boolean).join(' — ');
}

/**
 * Ligne unique du bandeau : « Bas du corps · 3 mois ». Le délai est
 * toujours recalculé par rapport à `new Date()` au moment du rendu — la
 * même blessure affiche donc automatiquement moins de temps restant à
 * chaque réouverture de la fiche, et une nouvelle date de retour publiée
 * par ESPN (le cache serveur tourne à 30 min) s'y reflète dès le prochain
 * chargement de /nhl-injuries, sans rien à recalculer à la main ici.
 */
function injuryOneLiner(injury) {
    const nature = injNatureFr(injury) || injStatusFr(injury);
    const t = injuryTiming(injury);
    let delai = '';
    if (t.untilDays !== null) {
        delai = t.untilDays > 0 ? injDurationFr(t.untilDays) : 'retour imminent';
    } else if (t.sinceDays !== null) {
        // Aucune date de retour annoncée : à défaut, depuis combien de temps
        // il est absent reste l'information la plus utile à afficher.
        delai = `absent depuis ${injDurationFr(t.sinceDays)}`;
    }
    return [nature, delai].filter(Boolean).join(' · ');
}

/** Pastille rendue, à poser dans une ancre déjà présente. */
function injuryBadgeMarkup(injury) {
    const glyph = injury.status === 'Suspension' ? INJ_GLYPHS.suspension : INJ_GLYPHS.medical;
    const label = injuryTooltip(injury);
    return `<span class="inj-badge" data-status="${injEscape(injury.status || '')}" `
         + `role="img" title="${injEscape(label)}" aria-label="${injEscape(label)}">${glyph}</span>`;
}

/**
 * À insérer juste après le nom dans un gabarit. Retourne toujours
 * l'ancre, même quand la liste des blessés n'est pas encore chargée —
 * c'est précisément ce qui permet aux tableaux de se rendre sans
 * attendre le réseau.
 */
function injuryBadgeHTML(playerName, teamAbbrev) {
    if (!playerName) return '';
    const code = injTeamCode(teamAbbrev);
    return `<span class="inj-slot" data-inj-name="${injEscape(playerName)}"`
         + `${code ? ` data-inj-team="${code}"` : ''}></span>`;
}

/** Remplit les ancres encore vides. Idempotent : une ancre traitée est marquée. */
function decorateInjurySlots(root) {
    if (!injState.ready) return;
    const scope = root || document;
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll('.inj-slot:not([data-inj-done])').forEach(slot => {
        slot.setAttribute('data-inj-done', '1');
        const injury = getPlayerInjury(slot.getAttribute('data-inj-name'), slot.getAttribute('data-inj-team'));
        if (injury) slot.innerHTML = injuryBadgeMarkup(injury);
    });
}

/* ============================================================
   6. BANDEAU DANS LA FICHE DU JOUEUR
   ============================================================ */

/**
 * Remplit (ou masque) #careerInjuryBanner. Appelé par les trois
 * showCareerStats() une fois la fiche reçue ; si la liste des blessés
 * n'est pas encore là, on la réclame et on repasse.
 */
function renderInjuryBanner(playerName, teamAbbrev, elementId) {
    const banner = document.getElementById(elementId || 'careerInjuryBanner');
    if (!banner) return;

    // Sert aussi de garde-fou au second passage : entre la demande et la
    // réponse, l'utilisateur a pu fermer la fiche et en ouvrir une autre.
    banner.dataset.player = String(playerName || '');

    if (!injState.ready) {
        banner.hidden = true;
        banner.innerHTML = '';
        loadInjuries().then(() => {
            if (banner.dataset.player === String(playerName || '')) {
                renderInjuryBanner(playerName, teamAbbrev, elementId);
            }
        });
        return;
    }

    const injury = getPlayerInjury(playerName, teamAbbrev);
    if (!injury) { banner.hidden = true; banner.innerHTML = ''; return; }

    const glyph = injury.status === 'Suspension' ? INJ_GLYPHS.suspension : INJ_GLYPHS.medical;
    // Le détail complet (statut, nature, dates) reste disponible au survol
    // — seule la ligne visible se réduit à l'essentiel.
    banner.innerHTML = `
        <span class="cmh-inj-icon">${glyph}</span>
        <span class="cmh-inj-line">${injEscape(injuryOneLiner(injury))}</span>`;
    banner.setAttribute('data-status', injury.status || '');
    banner.setAttribute('title', injuryTooltip(injury));
    banner.hidden = false;
}

/* ============================================================
   7. AMORÇAGE
   ============================================================ */

/**
 * Un observateur unique plutôt qu'un rappel dans chaque point de rendu :
 * six tableaux, dont deux dans du code minifié, se reconstruisent au tri,
 * à la recherche, à la pagination et aux événements socket du repêchage.
 * Le travail par salve est borné — seules les ancres non traitées sont
 * relues — et la salve elle-même est groupée sur une frame.
 */
function injWatchDom() {
    if (typeof MutationObserver !== 'function' || !document.body) return;
    let scheduled = 0;
    const observer = new MutationObserver(() => {
        if (scheduled) return;
        // setTimeout plutôt que requestAnimationFrame : rAF ne se déclenche
        // pas dans un onglet qui ne peint pas (arrière-plan, fenêtre
        // réduite). Le repêchage tourne justement souvent dans un onglet
        // laissé de côté — les pastilles doivent y être posées, prêtes,
        // et non attendre que l'onglet revienne au premier plan.
        scheduled = setTimeout(() => { scheduled = 0; decorateInjurySlots(); }, 16);
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// Garde `typeof` : dans un navigateur, document existe toujours et le
// comportement est inchangé ; hors navigateur (tests unitaires), le
// module se charge sans rien démarrer.
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        injWatchDom();
        loadInjuries();
    });
}

/* ────────────────────────────────────────────────────────────────────────
 * Export double — même motif que profanity.js : le navigateur reçoit les
 * fonctions sur window comme avant, et les tests unitaires peuvent faire un
 * require() sans navigateur. Rien d'autre ne change pour la page.
 * ──────────────────────────────────────────────────────────────────────── */
(function () {
    const api = { injState, injNormalizeName, injLooseKey, injTeamCode, injIndex, getPlayerInjury, injStatusFr, injNatureFr, injDurationFr, injDayDiff, injParseDate, injFormatDate, injEscape, injuryTiming, injuryTimingSummary, injuryOneLiner };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;                 // tests (CommonJS)
    } else if (typeof window !== 'undefined') {
        Object.assign(window, api);           // navigateur
    }
})();
