/**
 * Qui a le droit de faire quoi dans un pool, et ce qu'on publie de ce pool.
 *
 * Deux questions qui étaient répondues par le client jusqu'ici : « c'est bien
 * ton équipe ? » (le corps de la requête le disait) et « peux-tu voir ça ? »
 * (/draft renvoyait tous les pools à tout le monde). Les deux se décident
 * entièrement à partir de l'état persisté, donc sans base ni requête : ce
 * fichier est pur, et testé comme tel.
 *
 * Séparer `resumePublic` de `vueMembre` est le cœur de la deuxième question.
 * Parcourir la liste des pools pour en rejoindre un demande le nom, la taille,
 * le mode, et s'il faut un mot de passe. Ça ne demande pas les alignements,
 * l'historique des choix, le classement tête-à-tête ni la liste des membres.
 */

'use strict';

/** Quotas par défaut, identiques à ceux de la création de pool. */
const QUOTAS_PAR_DEFAUT = {
    numOffensive: 6,
    numDefensive: 4,
    numGoalies: 1,
    numRookies: 1,
    numTeams: 1
};

/** Nom de l'équipe de cette personne dans ce pool, ou null. */
function equipeDe(pool, username) {
    if (!pool || !pool.teams || !username) return null;
    const entree = Object.entries(pool.teams)
        .find(([, equipe]) => Array.isArray(equipe?.members) && equipe.members.includes(username));
    return entree ? entree[0] : null;
}

/** Toutes les personnes inscrites dans ce pool, sans doublon. */
function membresDuPool(pool) {
    const noms = new Set();
    for (const equipe of Object.values((pool && pool.teams) || {})) {
        for (const membre of (equipe?.members || [])) {
            if (membre) noms.add(membre);
        }
    }
    return [...noms];
}

function estMembre(pool, username) {
    return equipeDe(pool, username) !== null;
}

/**
 * Qui a créé ce pool.
 *
 * Champ explicite sur les pools récents ; pour ceux nés avant qu'il existe, le
 * premier membre d'Équipe 1 — la personne que /create-clan y déposait
 * automatiquement. Renvoie null si même ce repli est vide : l'appelant refuse
 * alors l'action au lieu de l'ouvrir à tout le monde.
 */
function createurDuPool(pool) {
    if (!pool || typeof pool !== 'object') return null;
    if (pool.creator) return pool.creator;
    const equipe1 = pool.teams && pool.teams['Équipe 1'];
    return (equipe1 && Array.isArray(equipe1.members) && equipe1.members[0]) || null;
}

function estCreateur(pool, username) {
    const createur = createurDuPool(pool);
    return !!createur && !!username && createur === username;
}

/**
 * Droit d'administration du pool : renommer, reconfigurer, supprimer, lancer
 * le repêchage, sauter un tour.
 *
 * Un administrateur du site en fait partie — il faut bien quelqu'un pour
 * dépanner un pool dont le créateur a supprimé son compte — mais ça reste un
 * droit vérifié côté serveur, jamais un drapeau envoyé par le client.
 */
function peutAdministrer(pool, { username, isAdmin = false } = {}) {
    if (isAdmin) return true;
    return estCreateur(pool, username);
}

/**
 * Ce qu'on montre de ce pool à quelqu'un qui ne l'a pas rejoint.
 *
 * Strictement ce qu'il faut pour choisir d'y entrer. Pas de `teams` détaillé,
 * pas d'alignements, pas d'historique, pas de `h2hData`, et surtout pas
 * `passwordHash` : une empreinte bcrypt diffusée est attaquable hors ligne
 * autant qu'on veut, ce que le stockage haché existe précisément pour empêcher.
 */
function resumePublic(nom, pool) {
    if (!pool || typeof pool !== 'object') return null;

    const equipes = Object.entries(pool.teams || {});
    const occupees = equipes.filter(([, e]) => (e?.members || []).length > 0);
    const config = { ...QUOTAS_PAR_DEFAUT, ...(pool.config || {}) };

    return {
        name: nom,
        isMember: false,
        poolMode: pool.poolMode || 'cumulative',
        hasPassword: !!pool.passwordHash,
        instant: pool.instant === true,
        allowTrades: pool.allowTrades !== false,
        maxPlayers: pool.maxPlayers || null,
        imageUrl: pool.imageUrl || '',
        createdAt: pool.createdAt || null,
        // Les quotas décrivent le format, pas les participants : ils servent à
        // annoncer « 13 sélections » avant d'entrer, et ne révèlent rien.
        config,
        totalPicks: config.numOffensive + config.numDefensive + config.numGoalies +
                    config.numRookies + config.numTeams,
        teamCount: equipes.length,
        occupiedTeamCount: occupees.length,
        participantCount: membresDuPool(pool).length,
        draftStarted: Array.isArray(pool.draftOrder) && pool.draftOrder.length > 0,
        teamNames: equipes.map(([nomEquipe]) => nomEquipe),
        // Le nom des équipes libres suffit à choisir la sienne à l'entrée ;
        // savoir QUI est dans les autres est déjà une information de membre.
        openTeamNames: equipes.filter(([, e]) => (e?.members || []).length === 0).map(([n]) => n)
    };
}

/**
 * Ce qu'on montre à un membre : tout l'état du pool, moins l'empreinte du mot
 * de passe, plus la révision dont il provient.
 *
 * La copie est superficielle : seul le premier niveau est réécrit, ce qui
 * suffit puisque l'empreinte n'y vit qu'à ce niveau.
 */
function vueMembre(nom, pool, revision = null) {
    if (!pool || typeof pool !== 'object') return null;
    const { passwordHash, ...reste } = pool;
    return {
        ...reste,
        name: nom,
        isMember: true,
        hasPassword: !!passwordHash,
        revision: revision == null ? (pool.revision || null) : revision
    };
}

/**
 * Vue d'un ensemble de pools pour une personne donnée : détail pour ceux dont
 * elle est membre, résumé pour les autres.
 *
 * `admin` voit le détail partout — c'est le seul cas où la frontière s'ouvre,
 * et il passe par le même chemin que tout le monde plutôt que par une route à
 * part qu'on oublierait de protéger.
 */
function vuePourUtilisateur(pools, { username = null, isAdmin = false } = {}) {
    const sortie = {};
    for (const [nom, pool] of Object.entries(pools || {})) {
        if (!pool || typeof pool !== 'object') continue;
        sortie[nom] = (isAdmin || estMembre(pool, username))
            ? vueMembre(nom, pool)
            : resumePublic(nom, pool);
    }
    return sortie;
}

module.exports = {
    QUOTAS_PAR_DEFAUT,
    equipeDe,
    membresDuPool,
    estMembre,
    createurDuPool,
    estCreateur,
    peutAdministrer,
    resumePublic,
    vueMembre,
    vuePourUtilisateur
};
