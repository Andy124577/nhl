/**
 * Les opérations d'un pool, décidées sans base de données.
 *
 * Chaque fonction reçoit l'état du pool (déjà verrouillé par l'appelant) et le
 * modifie, ou refuse. Aucune ne lit ni n'écrit quoi que ce soit : la
 * persistance appartient au contrat de mutation (services/poolStore.js), et
 * c'est exactement ce qui permet de tester ici les cas qui font mal — le
 * renversement du serpentin, l'équipe pleine, le tour qui n'est pas le vôtre —
 * sans Express, sans Socket.IO et sans Postgres.
 *
 * Convention de retour : `{ ok: true, ... }` ou
 * `{ ok: false, code, message }`, où `code` est un statut HTTP. Les routes
 * n'ont donc aucune règle métier à reproduire, seulement à traduire.
 */

'use strict';

const { generateSnakeOrder, checkIfDraftComplete } = require('./draft.js');
const { equipeDe, estMembre } = require('./authz.js');

/** Quotas par défaut, identiques à ceux de la création de pool. */
const CONFIG_PAR_DEFAUT = {
    numOffensive: 6,
    numDefensive: 4,
    numGoalies: 1,
    numRookies: 1,
    numTeams: 1
};

/** Places par équipe dans un pool ordinaire (équipes partagées autorisées). */
const MEMBRES_PAR_EQUIPE = 5;

/** Position du pool → clé du tableau, et quota correspondant. */
const POSITIONS = {
    offensive: { cle: 'offensive', quota: 'numOffensive', label: 'joueur offensif' },
    defensive: { cle: 'defensive', quota: 'numDefensive', label: 'défenseur' },
    rookie: { cle: 'rookie', quota: 'numRookies', label: 'recrue' },
    goalie: { cle: 'goalie', quota: 'numGoalies', label: 'gardien' },
    teams: { cle: 'teams', quota: 'numTeams', label: 'équipe LNH' }
};

function config(pool) {
    return { ...CONFIG_PAR_DEFAUT, ...((pool && pool.config) || {}) };
}

function repechageCommence(pool) {
    return !!(pool && Array.isArray(pool.draftOrder) && pool.draftOrder.length > 0);
}

/** Toutes les sélections déjà faites, toutes équipes et catégories confondues. */
function joueursChoisis(pool) {
    const nomDe = p => (typeof p === 'string') ? p : (p?.skaterFullName || p?.goalieFullName || p?.teamFullName || p);
    return Object.values((pool && pool.teams) || {}).flatMap(equipe => [
        ...(equipe.offensive || []),
        ...(equipe.defensive || []),
        ...(equipe.rookie || []),
        ...(equipe.goalie || []),
        ...(equipe.teams || [])
    ].map(nomDe));
}

/** Équipes qui participent au repêchage : celles qui ont au moins un membre. */
function equipesEligibles(pool) {
    return Object.entries((pool && pool.teams) || {})
        .filter(([, equipe]) => (equipe?.members || []).length > 0)
        .map(([nom]) => nom);
}

function totalSelections(pool) {
    const c = config(pool);
    return c.numOffensive + c.numDefensive + c.numGoalies + c.numRookies + c.numTeams;
}

/** Cette équipe a-t-elle rempli tous ses quotas ? */
function equipeComplete(pool, nomEquipe) {
    const equipe = pool?.teams?.[nomEquipe];
    if (!equipe) return false;
    const c = config(pool);
    return Object.values(POSITIONS).every(p => (equipe[p.cle] || []).length >= c[p.quota]);
}

// ───────────────────────────── Appartenance ─────────────────────────────

/**
 * Rejoindre une équipe, ou en changer.
 *
 * Le mot de passe du pool est vérifié par l'appelant (il exige bcrypt, qui est
 * asynchrone) ; ici on décide du reste. `dejaMembre` est la raison pour
 * laquelle le mot de passe n'est demandé qu'à l'entrée : quelqu'un qui a déjà
 * franchi la porte ne la repasse pas à chaque changement d'équipe.
 */
function rejoindreEquipe(pool, { username, teamName }) {
    if (!pool?.teams?.[teamName]) {
        return { ok: false, code: 404, message: "Équipe introuvable." };
    }
    if (repechageCommence(pool)) {
        return { ok: false, code: 409, message: "Le repêchage a commencé : les équipes sont figées." };
    }

    const actuelle = equipeDe(pool, username);
    if (actuelle === teamName) {
        return { ok: false, code: 400, message: "Vous êtes déjà membre de cette équipe." };
    }

    const cible = pool.teams[teamName];
    if ((cible.members || []).length >= MEMBRES_PAR_EQUIPE) {
        return { ok: false, code: 409, message: "Cette équipe est complète." };
    }

    for (const equipe of Object.values(pool.teams)) {
        equipe.members = (equipe.members || []).filter(m => m !== username);
    }
    cible.members = cible.members || [];
    cible.members.push(username);

    return { ok: true, teamName, equipePrecedente: actuelle };
}

/**
 * Quitter son équipe.
 *
 * Autorisé même une fois le repêchage lancé : quelqu'un qui s'en va ne doit
 * pas rester prisonnier d'un pool. Ses sélections restent à l'équipe — les
 * effacer fausserait le classement de tout le monde (cf. politique de
 * confidentialité, section 5).
 */
function quitterEquipe(pool, username) {
    const actuelle = equipeDe(pool, username);
    if (!actuelle) {
        return { ok: false, code: 400, message: "Vous n'êtes dans aucune équipe de ce pool." };
    }
    const equipe = pool.teams[actuelle];
    equipe.members = (equipe.members || []).filter(m => m !== username);
    return { ok: true, teamName: actuelle, restants: equipe.members.length };
}

/**
 * Renommer son équipe.
 *
 * Le nom d'une équipe est une clé : il apparaît dans `draftOrder`, dans les
 * duels du tête-à-tête, dans le classement et dans l'historique. Le renommage
 * les suit tous — un seul oubli laisserait une équipe absente de son propre
 * calendrier.
 */
function renommerEquipe(pool, { ancien, nouveau, username, estAdmin = false }) {
    if (!pool?.teams?.[ancien]) {
        return { ok: false, code: 404, message: "Équipe introuvable." };
    }
    if (!estAdmin && !(pool.teams[ancien].members || []).includes(username)) {
        return { ok: false, code: 403, message: "Vous ne pouvez renommer que votre propre équipe." };
    }
    if (nouveau === ancien) {
        return { ok: false, code: 400, message: "Le nouveau nom est identique à l'ancien." };
    }
    if (pool.teams[nouveau]) {
        return { ok: false, code: 409, message: "Ce nom d'équipe est déjà utilisé." };
    }

    pool.teams[nouveau] = pool.teams[ancien];
    delete pool.teams[ancien];

    if (Array.isArray(pool.draftOrder)) {
        pool.draftOrder = pool.draftOrder.map(t => (t === ancien ? nouveau : t));
    }

    if (pool.h2hData) {
        const classement = pool.h2hData.standings;
        if (classement && classement[ancien]) {
            classement[nouveau] = classement[ancien];
            delete classement[ancien];
        }
        const suivre = (duels) => {
            if (!Array.isArray(duels)) return;
            duels.forEach(m => {
                if (!m) return;
                if (m.team1 === ancien) m.team1 = nouveau;
                if (m.team2 === ancien) m.team2 = nouveau;
                if (m.winner === ancien) m.winner = nouveau;
            });
        };
        (pool.h2hData.matchups || []).forEach(suivre);
        (pool.h2hData.matchupHistory || []).forEach(semaine => suivre(semaine && semaine.matchups));
    }

    return { ok: true, teamName: nouveau, ancien };
}

// ───────────────────────────── Repêchage ─────────────────────────────

/**
 * Lancer le repêchage : tirer l'ordre en serpentin et démarrer la pendule.
 *
 * `melanger` est injecté pour que les tests obtiennent un ordre déterministe
 * sans toucher à Math.random globalement.
 */
function demarrerRepechage(pool, { melanger = null } = {}) {
    if (repechageCommence(pool)) {
        return { ok: false, code: 409, message: "Le repêchage est déjà en cours." };
    }

    const eligibles = equipesEligibles(pool).sort();
    if (eligibles.length < 2) {
        return { ok: false, code: 400, message: "Il faut au moins 2 équipes avec des participants pour démarrer." };
    }

    // Aucun choix réel n'a encore eu lieu : ce que `teams` contiendrait vient
    // d'un pool créé avant que le club de la LNH devienne un choix comme un
    // autre. On repart de zéro, sinon leur case serait déjà pleine et le choix
    // correspondant impossible à faire.
    Object.values(pool.teams || {}).forEach(t => { t.teams = []; });

    const ordreInitial = melanger ? melanger([...eligibles]) : eligibles;
    pool.draftOrder = generateSnakeOrder(ordreInitial, totalSelections(pool));
    pool.currentPickIndex = 0;
    pool.lastPickIndex = -1;

    return { ok: true, draftOrder: pool.draftOrder, equipes: eligibles };
}

/**
 * Faire un choix.
 *
 * `tourAttendu` est le garde-fou du renversement de serpentin : au retour du
 * serpentin, la même équipe choisit deux fois de suite, et `lastPickIndex`
 * seul ne distingue pas « deuxième choix légitime » de « requête rejouée ».
 * Le client annonce donc l'indice sur lequel il croit être ; s'il ne
 * correspond plus, le choix est refusé avec un conflit, pas exécuté à
 * l'aveugle sur le tour de quelqu'un d'autre.
 */
function choisirJoueur(pool, { username, playerName, position, tourAttendu = null, maintenant = Date.now(), estAdmin = false }) {
    if (!POSITIONS[position]) {
        return { ok: false, code: 400, message: "Position invalide." };
    }
    if (!repechageCommence(pool)) {
        return { ok: false, code: 409, message: "Le repêchage n'a pas encore commencé." };
    }

    const monEquipe = equipeDe(pool, username);
    if (!monEquipe && !estAdmin) {
        return { ok: false, code: 403, message: "Vous n'êtes dans aucune équipe de ce pool." };
    }

    const indice = pool.currentPickIndex || 0;
    const equipeDuTour = pool.draftOrder[indice];

    if (tourAttendu != null && Number(tourAttendu) !== indice) {
        return {
            ok: false,
            code: 409,
            message: "Le tour a changé depuis l'affichage de votre écran.",
            conflit: { tourActuel: indice, tourAttendu: Number(tourAttendu), equipeDuTour }
        };
    }

    const equipeChoisie = estAdmin && !monEquipe ? equipeDuTour : monEquipe;
    if (equipeDuTour !== equipeChoisie) {
        return { ok: false, code: 403, message: "Ce n'est pas votre tour de choisir.", conflit: { equipeDuTour } };
    }

    if (joueursChoisis(pool).includes(playerName)) {
        return { ok: false, code: 409, message: "Ce joueur a déjà été sélectionné." };
    }

    const equipe = pool.teams[equipeChoisie];
    const meta = POSITIONS[position];
    const quota = config(pool)[meta.quota];
    if (!Array.isArray(equipe[meta.cle])) equipe[meta.cle] = [];

    if (equipe[meta.cle].length >= quota) {
        return {
            ok: false,
            code: 400,
            message: `Votre équipe a déjà ${quota} ${meta.label}${quota > 1 ? 's' : ''}.`
        };
    }

    equipe[meta.cle].push(playerName);

    if (!Array.isArray(pool.picksHistory)) pool.picksHistory = [];
    pool.picksHistory.push({
        team: equipeChoisie,
        player: playerName,
        position,
        pickIndex: indice,
        at: new Date(maintenant).toISOString()
    });

    pool.lastPickIndex = indice;

    const dernier = indice >= pool.draftOrder.length - 1;
    if (!dernier) {
        pool.currentPickIndex = indice + 1;
        pool.turnStartedAt = maintenant;
    }

    return {
        ok: true,
        teamName: equipeChoisie,
        playerName,
        position,
        pickIndex: indice,
        tourSuivant: dernier ? null : pool.draftOrder[pool.currentPickIndex],
        draftComplet: checkIfDraftComplete(pool)
    };
}

/**
 * Sauter un tour qui traîne.
 *
 * Il n'y a pas de limite de temps dans Fantazy : le serveur ne saute jamais un
 * tour de lui-même. Mais une salle figée sur quelqu'un qui a perdu son réseau
 * bloque tout le monde sans recours. Ce recours appartient à la personne qui a
 * créé le pool, ne s'ouvre qu'après un délai, et ne peut pas servir à se
 * sauter soi-même pour repousser son propre choix.
 *
 * Aucune entrée dans `picksHistory` : c'est exactement ainsi que le client
 * reconnaît un tour sauté — son curseur avance sans consommer d'entrée.
 */
function sauterTour(pool, { username, maintenant = Date.now(), delaiMs = 180000, estAdmin = false }) {
    if (!repechageCommence(pool)) {
        return { ok: false, code: 400, message: "Le repêchage n'a pas encore commencé." };
    }
    if ((pool.currentPickIndex || 0) >= pool.draftOrder.length - 1) {
        return { ok: false, code: 400, message: "Dernier tour : il n'y a plus de tour à sauter." };
    }

    const equipeDuTour = pool.draftOrder[pool.currentPickIndex || 0];
    if (!estAdmin && equipeDe(pool, username) === equipeDuTour) {
        return { ok: false, code: 403, message: "Vous ne pouvez pas sauter votre propre tour." };
    }

    const depuis = maintenant - (Number(pool.turnStartedAt) || 0);
    if (!pool.turnStartedAt || depuis < delaiMs) {
        const reste = Math.max(1, Math.ceil((delaiMs - depuis) / 60000));
        return { ok: false, code: 400, message: `Ce tour est trop récent. Réessayez dans ${reste} min.` };
    }

    pool.currentPickIndex = (pool.currentPickIndex || 0) + 1;
    pool.turnStartedAt = maintenant;

    return { ok: true, saute: equipeDuTour, tourSuivant: pool.draftOrder[pool.currentPickIndex] };
}

/** Supprime les équipes vides et jamais utilisées. Sans effet après le départ du repêchage. */
function nettoyerEquipesVides(pool) {
    if (repechageCommence(pool)) {
        return { ok: false, code: 409, message: "Le repêchage a commencé : les équipes ne peuvent plus être retirées." };
    }
    const retirees = [];
    for (const [nom, equipe] of Object.entries(pool.teams || {})) {
        const vide = (equipe.members || []).length === 0 &&
            Object.values(POSITIONS).every(p => (equipe[p.cle] || []).length === 0);
        if (vide) { delete pool.teams[nom]; retirees.push(nom); }
    }
    return { ok: true, retirees };
}

/**
 * Retire une personne de toutes ses équipes, dans tous les pools fournis.
 * Sert à la suppression de compte : on dissocie sans effacer les sélections.
 */
function dissocierPartout(pools, username) {
    const touches = [];
    for (const [nom, pool] of Object.entries(pools || {})) {
        let modifie = false;
        for (const equipe of Object.values((pool && pool.teams) || {})) {
            if ((equipe.members || []).includes(username)) {
                equipe.members = equipe.members.filter(m => m !== username);
                modifie = true;
            }
        }
        if (modifie) touches.push(nom);
    }
    return touches;
}

module.exports = {
    CONFIG_PAR_DEFAUT,
    MEMBRES_PAR_EQUIPE,
    POSITIONS,
    config,
    repechageCommence,
    joueursChoisis,
    equipesEligibles,
    totalSelections,
    equipeComplete,
    rejoindreEquipe,
    quitterEquipe,
    renommerEquipe,
    demarrerRepechage,
    choisirJoueur,
    sauterTour,
    nettoyerEquipesVides,
    dissocierPartout,
    estMembre,
    equipeDe
};
