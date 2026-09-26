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
const { seasonIdForDate } = require('./season.js');
const lineup = require('./lineup.js');

/** Quotas par défaut, identiques à ceux de la création de pool. */
const CONFIG_PAR_DEFAUT = {
    numOffensive: 6,
    numDefensive: 4,
    numGoalies: 1,
    numRookies: 1,
    numTeams: 1
};

/**
 * Places par équipe.
 *
 * Une personne, une équipe : on rejoint un pool en nommant la sienne, on n'y
 * choisit plus une case préparée d'avance pour s'y entasser à plusieurs. Les
 * pools créés avant cette règle gardent leurs équipes partagées telles quelles
 * — personne n'en est chassé —, mais on n'y entre plus à deux.
 */
const MEMBRES_PAR_EQUIPE = 1;

/** Plafond de participants quand le pool n'en déclare aucun. */
const PARTICIPANTS_MAX = 10;

/** Longueur maximale d'un nom d'équipe, identique à /rename-team. */
const NOM_EQUIPE_MAX = 20;

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
    const nomDe = p => (typeof p === 'string') ? p : (p?.nom || p?.skaterFullName || p?.goalieFullName || p?.teamFullName || p);
    return Object.values((pool && pool.teams) || {}).flatMap(equipe => [
        ...(equipe.offensive || []),
        ...(equipe.defensive || []),
        ...(equipe.rookie || []),
        ...(equipe.goalie || []),
        ...(equipe.teams || []),
        ...(equipe.bench || [])
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
    return c.numOffensive + c.numDefensive + c.numGoalies + c.numRookies + c.numTeams + lineup.quotaBanc(pool);
}

/** Cette équipe a-t-elle rempli tous ses quotas, banc compris ? */
function equipeComplete(pool, nomEquipe) {
    const equipe = pool?.teams?.[nomEquipe];
    if (!equipe) return false;
    const c = config(pool);
    return Object.values(POSITIONS).every(p => (equipe[p.cle] || []).length >= c[p.quota]) &&
        (equipe.bench || []).length >= lineup.quotaBanc(pool);
}

/** Comparaison de noms insensible à la casse et aux accents, comme les noms de pool. */
function reduireNom(texte) {
    return String(texte == null ? '' : texte).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/** Une équipe sans membre et sans aucun choix : une case préparée d'avance, jamais servie. */
function equipeInutilisee(equipe) {
    if (!equipe) return true;
    if ((equipe.members || []).length > 0) return false;
    return Object.values(POSITIONS).every(p => (equipe[p.cle] || []).length === 0) &&
        (equipe.bench || []).length === 0;
}

function equipeVide(membres = [], { avecBanc = false } = {}) {
    const equipe = { members: [...membres], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] };
    if (avecBanc) equipe.bench = [];
    return equipe;
}

/** Nombre de personnes inscrites, toutes équipes confondues. */
function nombreParticipants(pool) {
    const noms = new Set();
    for (const equipe of Object.values((pool && pool.teams) || {})) {
        for (const m of (equipe?.members || [])) if (m) noms.add(m);
    }
    return noms.size;
}

/** Le plafond de participants du pool. Un plafond, pas un quota à atteindre. */
function capacite(pool) {
    const max = parseInt(pool && pool.maxPlayers, 10);
    return Number.isFinite(max) && max > 0 ? max : PARTICIPANTS_MAX;
}

/** Nom d'équipe déjà porté dans ce pool, à la casse et aux accents près ? */
function nomEquipePris(pool, nom, sauf = null) {
    const cible = reduireNom(nom);
    return Object.keys((pool && pool.teams) || {})
        .some(cle => cle !== sauf && reduireNom(cle) === cible);
}

/**
 * Un nom d'équipe libre à partir d'une base — le nom d'utilisateur, le plus
 * souvent.
 *
 * Sert là où personne ne tape de nom : la file du pool rapide, qui ne demande
 * rien. Les caractères refusés par /rename-team sont retirés, pour que ce
 * nom-là reste renommable comme n'importe quel autre.
 */
function nomEquipeLibre(pool, base) {
    const propre = String(base == null ? '' : base)
        .replace(/[^\p{L}\p{N}\s'\-_]/gu, '')
        .replace(/\s+/g, ' ')
        .trim() || 'Mon équipe';
    const racine = propre.slice(0, NOM_EQUIPE_MAX).trim();
    if (!nomEquipePris(pool, racine)) return racine;
    for (let n = 2; n < 100; n++) {
        const suffixe = ` ${n}`;
        const candidat = racine.slice(0, NOM_EQUIPE_MAX - suffixe.length).trim() + suffixe;
        if (!nomEquipePris(pool, candidat)) return candidat;
    }
    return `${racine.slice(0, NOM_EQUIPE_MAX - 5)} ${Date.now() % 10000}`;
}

// ───────────────────────────── Appartenance ─────────────────────────────

/**
 * Entrer dans un pool en nommant son équipe.
 *
 * Plus de liste d'équipes à choisir : chaque personne arrive avec la sienne.
 * Le pool n'a donc que les équipes de ceux qui sont là, et `maxPlayers` est
 * un plafond — cinq personnes sur dix peuvent très bien repêcher.
 *
 * Les pools créés avant cette règle portent encore dix cases « Équipe N »
 * vides. Elles partent à la première inscription : laissées là, elles
 * s'afficheraient comme des adversaires fantômes au classement.
 */
function inscrireParticipant(pool, { username, teamName }) {
    if (!pool || !username) {
        return { ok: false, code: 400, message: "Pool et participant requis." };
    }
    if (repechageCommence(pool)) {
        return { ok: false, code: 409, message: "Le repêchage a commencé : ce pool n'accepte plus de participants." };
    }
    if (estMembre(pool, username)) {
        return { ok: false, code: 400, message: "Vous êtes déjà dans ce pool." };
    }
    const max = capacite(pool);
    if (nombreParticipants(pool) >= max) {
        return { ok: false, code: 409, message: `Ce pool est complet (${max} participants maximum).` };
    }

    const nom = String(teamName == null ? '' : teamName).trim();
    if (!nom || nom.length > NOM_EQUIPE_MAX) {
        return { ok: false, code: 400, message: `Le nom d'équipe doit contenir entre 1 et ${NOM_EQUIPE_MAX} caractères.` };
    }

    if (!pool.teams) pool.teams = {};
    const homonyme = Object.keys(pool.teams).find(cle => reduireNom(cle) === reduireNom(nom));
    if (homonyme && !equipeInutilisee(pool.teams[homonyme])) {
        return { ok: false, code: 409, message: "Ce nom d'équipe est déjà pris dans ce pool." };
    }

    for (const [cle, equipe] of Object.entries(pool.teams)) {
        if (equipeInutilisee(equipe)) delete pool.teams[cle];
    }
    pool.teams[nom] = equipeVide([username]);
    // Entrée par l'invitation ou par la porte : dans les deux cas, l'invitation
    // a servi. La laisser ferait réapparaître la pastille chez l'administrateur.
    retirerInvitation(pool, username);

    return { ok: true, teamName: nom };
}

// ───────────────────────────── Invitations ─────────────────────────────

/** Invitations en attente au-delà desquelles un pool n'en accepte plus. */
const INVITATIONS_MAX = 30;

/**
 * Les invitations en attente du pool, sans les entrées abîmées.
 *
 * `pool.invitations` : `[{ username, invitedBy, invitedAt }]`. Elles vivent
 * dans les données du pool, pas dans une table à part : elles se déplacent
 * avec lui au renommage, partent avec lui à la suppression, et fonctionnent
 * en mode fichier comme en PostgreSQL.
 */
function invitationsEnAttente(pool) {
    return (Array.isArray(pool && pool.invitations) ? pool.invitations : [])
        .filter(inv => inv && typeof inv.username === 'string' && inv.username);
}

/** L'invitation adressée à cette personne, ou null. */
function invitationPour(pool, username) {
    if (!username) return null;
    return invitationsEnAttente(pool).find(inv => inv.username === username) || null;
}

/**
 * Pourquoi ce pool ne peut plus inviter personne, ou null s'il le peut.
 *
 * Mêmes portes que l'entrée elle-même (inscrireParticipant) : inviter
 * quelqu'un qui ne pourra de toute façon pas entrer ne ferait qu'envoyer une
 * notification sans issue.
 */
function refusInvitation(pool) {
    if (repechageCommence(pool)) {
        return { ok: false, code: 409, message: "Le repêchage a commencé : ce pool n'accepte plus de participants." };
    }
    const max = capacite(pool);
    if (nombreParticipants(pool) >= max) {
        return { ok: false, code: 409, message: `Ce pool est complet (${max} participants maximum).` };
    }
    return null;
}

/** Inviter une personne. Réservé à l'administration du pool — vérifié par l'appelant. */
function inviter(pool, { username, invitedBy, maintenant = Date.now() }) {
    if (!pool || !username) return { ok: false, code: 400, message: "Personne à inviter requise." };
    if (username === invitedBy) return { ok: false, code: 400, message: "Vous êtes déjà dans ce pool." };
    if (estMembre(pool, username)) return { ok: false, code: 409, message: `${username} fait déjà partie du pool.` };
    if (invitationPour(pool, username)) return { ok: false, code: 409, message: `${username} est déjà invité.` };

    const ferme = refusInvitation(pool);
    if (ferme) return ferme;

    const enAttente = invitationsEnAttente(pool);
    if (enAttente.length >= INVITATIONS_MAX) {
        return { ok: false, code: 409, message: `Trop d'invitations en attente (${INVITATIONS_MAX} au maximum). Annulez-en avant d'en envoyer d'autres.` };
    }

    const invitation = { username, invitedBy: invitedBy || null, invitedAt: new Date(maintenant).toISOString() };
    pool.invitations = [...enAttente, invitation];
    return { ok: true, invitation };
}

/** Retirer l'invitation d'une personne. Sans effet si elle n'en a pas. */
function retirerInvitation(pool, username) {
    if (!pool || !Array.isArray(pool.invitations)) return { ok: true, retiree: false };
    const valides = invitationsEnAttente(pool);
    const restantes = valides.filter(inv => inv.username !== username);
    const retiree = restantes.length !== valides.length;
    if (restantes.length > 0) pool.invitations = restantes;
    else delete pool.invitations;
    return { ok: true, retiree };
}

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

    // Avant le repêchage, l'équipe n'existait que par la personne qui l'avait
    // nommée : elle part avec elle et libère son nom.
    let retiree = false;
    if (!repechageCommence(pool) && equipeInutilisee(equipe)) {
        delete pool.teams[actuelle];
        retiree = true;
    }
    return { ok: true, teamName: actuelle, restants: equipe.members.length, retiree };
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
    if (pool.teams[nouveau] || nomEquipePris(pool, nouveau, ancien)) {
        return { ok: false, code: 409, message: "Ce nom d'équipe est déjà utilisé." };
    }

    pool.teams[nouveau] = pool.teams[ancien];
    delete pool.teams[ancien];

    if (Array.isArray(pool.draftOrder)) {
        pool.draftOrder = pool.draftOrder.map(t => (t === ancien ? nouveau : t));
    }

    // Le classement des saisons passées décide de l'ordre du prochain
    // repêchage : il doit suivre l'équipe sous son nouveau nom.
    for (const saison of (pool.saisonsPrecedentes || [])) {
        for (const ligne of (saison?.classement || [])) {
            if (ligne && ligne.equipe === ancien) ligne.equipe = nouveau;
        }
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
    // Le tête-à-tête se joue en duels hebdomadaires : une équipe de trop
    // n'aurait jamais d'adversaire, et le calendrier ne se construirait pas.
    if (pool.poolMode === 'head-to-head' && eligibles.length % 2 !== 0) {
        return {
            ok: false, code: 400,
            message: `Le tête-à-tête se joue en duels : il faut un nombre pair d'équipes (${eligibles.length} inscrites).`
        };
    }

    // Aucun choix réel n'a encore eu lieu : ce que `teams` contiendrait vient
    // d'un pool créé avant que le club de la LNH devienne un choix comme un
    // autre. On repart de zéro, sinon leur case serait déjà pleine et le choix
    // correspondant impossible à faire.
    Object.values(pool.teams || {}).forEach(t => { t.teams = []; });

    const ordreInitial = ordreDeDepart(pool, eligibles, melanger);
    pool.draftOrder = generateSnakeOrder(ordreInitial, totalSelections(pool));
    pool.currentPickIndex = 0;
    pool.lastPickIndex = -1;

    return { ok: true, draftOrder: pool.draftOrder, equipes: eligibles, premiereRonde: ordreInitial };
}

/** Le classement de la dernière saison terminée du pool, ou null. */
function derniereSaison(pool) {
    const saisons = (pool && pool.saisonsPrecedentes) || [];
    return saisons.length ? saisons[saisons.length - 1] : null;
}

/**
 * L'ordre de la première ronde.
 *
 * Après une saison, le dernier au classement choisit en premier, l'avant-
 * dernier ensuite, et ainsi de suite jusqu'au champion : c'est ce qui donne
 * une chance de se refaire. Une équipe arrivée depuis n'a pas de rang — elle
 * passe après les équipes classées, tirée au sort parmi les nouvelles.
 *
 * Une équipe se retrouve par son nom, ou à défaut par ses membres : le nom a
 * pu changer entre-temps sans que ce soit une autre équipe.
 *
 * Sans saison précédente, l'ordre est tiré au hasard par `melanger` — ou,
 * s'il n'est pas fourni, laissé tel quel (les tests en ont besoin).
 */
function ordreDeDepart(pool, eligibles, melanger = null) {
    const brasser = (liste) => (melanger ? melanger([...liste]) : [...liste]);
    const saison = derniereSaison(pool);
    const classement = (saison && Array.isArray(saison.classement)) ? saison.classement : [];
    if (classement.length === 0) return brasser(eligibles);

    const restantes = new Set(eligibles);
    const classees = [];
    const parRang = [...classement].sort((a, b) => (b.rang || 0) - (a.rang || 0));
    for (const ligne of parRang) {
        let equipe = ligne && restantes.has(ligne.equipe) ? ligne.equipe : null;
        if (!equipe && ligne && Array.isArray(ligne.membres) && ligne.membres.length) {
            equipe = [...restantes].find(nom =>
                (pool.teams[nom]?.members || []).some(m => ligne.membres.includes(m))) || null;
        }
        if (equipe) {
            classees.push(equipe);
            restantes.delete(equipe);
        }
    }
    return [...classees, ...brasser([...restantes])];
}

/**
 * Classement final d'un pool tête-à-tête, du premier au dernier.
 *
 * Même règle que la page Classement : deux points par victoire, un par nulle,
 * puis les points marqués pour départager. Une équipe sans fiche (aucun duel
 * finalisé) arrive avec zéro partout plutôt que de disparaître.
 */
function classementFinalH2H(pool) {
    const fiches = (pool && pool.h2hData && pool.h2hData.standings) || {};
    return equipesEligibles(pool)
        .map(equipe => {
            const f = fiches[equipe] || {};
            const wins = f.wins || 0, losses = f.losses || 0, ties = f.ties || 0;
            return {
                equipe,
                points: wins * 2 + ties,
                pointsPour: f.pointsFor || 0,
                fiche: { wins, losses, ties, pointsFor: f.pointsFor || 0, pointsAgainst: f.pointsAgainst || 0 }
            };
        })
        .sort((a, b) => (b.points - a.points) || (b.pointsPour - a.pointsPour) || a.equipe.localeCompare(b.equipe, 'fr'));
}

/**
 * La saison du pool peut-elle être close aujourd'hui ?
 *
 * Seulement hors saison régulière, et seulement pour un repêchage fait lors
 * d'une saison précédente ou d'une saison déjà finie : un pool repêché en
 * septembre ne doit pas pouvoir être vidé la semaine suivante par erreur.
 */
function peutOuvrirNouvelleSaison(pool, { fenetre = null, aujourdhui, saisonCourante } = {}) {
    if (!repechageCommence(pool) || !checkIfDraftComplete(pool)) {
        return { ok: false, code: 409, message: "Le repêchage de cette saison n'est pas terminé." };
    }
    const debut = fenetre && fenetre.regularSeasonStartDate;
    const fin = fenetre && fenetre.regularSeasonEndDate;
    const enSaison = !!debut && aujourdhui >= debut && (!fin || aujourdhui <= fin);
    if (enSaison) {
        return { ok: false, code: 409, message: "La saison régulière est en cours : la nouvelle saison s'ouvrira après la dernière journée." };
    }
    // Les pools repêchés avant ce champ n'ont que leur date de création.
    const saisonDuPool = Number(pool.saisonRepechage) ||
        (pool.createdAt ? seasonIdForDate(pool.createdAt) : null);
    const saisonFinie = !!fin && aujourdhui > fin;
    if (saisonDuPool && saisonCourante && saisonDuPool >= Number(saisonCourante) && !saisonFinie) {
        return { ok: false, code: 409, message: "Ce repêchage a été fait pour la saison qui s'en vient : rien à clore pour l'instant." };
    }
    return { ok: true };
}

/**
 * Tourner la page d'une saison.
 *
 * Le classement final est archivé, les alignements vidés, et les mêmes
 * participants restent dans le pool avec leurs équipes : le prochain
 * repêchage partira de là, dans l'ordre inverse du classement.
 *
 * `classement` est calculé par l'appelant — le cumulatif demande les
 * statistiques de la saison, que ce fichier ne lit pas. Il arrive trié, du
 * premier au dernier.
 */
function nouvelleSaison(pool, { classement, saison = null, maintenant = Date.now() } = {}) {
    if (!repechageCommence(pool) || !checkIfDraftComplete(pool)) {
        return { ok: false, code: 409, message: "La saison ne peut être close qu'une fois le repêchage terminé." };
    }
    if (!Array.isArray(classement) || classement.length === 0) {
        return { ok: false, code: 400, message: "Classement final introuvable." };
    }

    if (!Array.isArray(pool.saisonsPrecedentes)) pool.saisonsPrecedentes = [];
    pool.saisonsPrecedentes.push({
        saison: saison || pool.saisonRepechage || null,
        mode: pool.poolMode || 'cumulative',
        termineeLe: new Date(maintenant).toISOString(),
        classement: classement.map((ligne, i) => ({
            equipe: ligne.equipe,
            membres: [...(pool.teams[ligne.equipe]?.members || ligne.membres || [])],
            rang: i + 1,
            points: ligne.points ?? null,
            fiche: ligne.fiche || null
        }))
    });

    for (const [cle, equipe] of Object.entries(pool.teams || {})) {
        if ((equipe.members || []).length === 0) { delete pool.teams[cle]; continue; }
        pool.teams[cle] = equipeVide(equipe.members, { avecBanc: lineup.quotaBanc(pool) > 0 });
    }

    pool.draftOrder = [];
    pool.currentPickIndex = 0;
    pool.lastPickIndex = -1;
    pool.picksHistory = [];
    delete pool.turnStartedAt;
    delete pool.saisonRepechage;
    if (pool.poolMode === 'head-to-head') {
        pool.h2hData = {
            currentWeek: 1, seasonStart: null, weekStart: null,
            matchups: [], standings: {}, matchupHistory: []
        };
    }

    return { ok: true, archivee: pool.saisonsPrecedentes[pool.saisonsPrecedentes.length - 1] };
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

    // Catégorie pleine : le joueur va au banc s'il reste une place (tête-à-
    // tête seulement, jamais un club de la LNH). Il y garde sa catégorie —
    // c'est elle qui dit quel partant il pourra remplacer.
    let auBanc = false;
    if (equipe[meta.cle].length >= quota) {
        const placesBanc = lineup.quotaBanc(pool) - (equipe.bench || []).length;
        if (position === 'teams' || placesBanc <= 0) {
            return {
                ok: false,
                code: 400,
                message: placesBanc <= 0 && lineup.quotaBanc(pool) > 0
                    ? `Votre équipe a déjà ${quota} ${meta.label}${quota > 1 ? 's' : ''} et votre banc est complet.`
                    : `Votre équipe a déjà ${quota} ${meta.label}${quota > 1 ? 's' : ''}.`
            };
        }
        auBanc = true;
    }

    if (auBanc) {
        if (!Array.isArray(equipe.bench)) equipe.bench = [];
        equipe.bench.push({ nom: playerName, categorie: position });
    } else {
        equipe[meta.cle].push(playerName);
    }

    if (!Array.isArray(pool.picksHistory)) pool.picksHistory = [];
    pool.picksHistory.push({
        team: equipeChoisie,
        player: playerName,
        position,
        ...(auBanc ? { banc: true } : {}),
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
        banc: auBanc,
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
    PARTICIPANTS_MAX,
    NOM_EQUIPE_MAX,
    POSITIONS,
    config,
    repechageCommence,
    joueursChoisis,
    equipesEligibles,
    totalSelections,
    equipeComplete,
    equipeVide,
    equipeInutilisee,
    nombreParticipants,
    capacite,
    nomEquipePris,
    nomEquipeLibre,
    reduireNom,
    inscrireParticipant,
    INVITATIONS_MAX,
    invitationsEnAttente,
    invitationPour,
    refusInvitation,
    inviter,
    retirerInvitation,
    rejoindreEquipe,
    quitterEquipe,
    renommerEquipe,
    demarrerRepechage,
    ordreDeDepart,
    derniereSaison,
    classementFinalH2H,
    peutOuvrirNouvelleSaison,
    nouvelleSaison,
    choisirJoueur,
    sauterTour,
    nettoyerEquipesVides,
    dissocierPartout,
    estMembre,
    equipeDe
};
