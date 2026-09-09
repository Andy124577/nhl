/**
 * Repêchage instantané — la file d'attente.
 *
 * « Rejoindre un repêchage instantané » ne demande rien à personne : pas de
 * nom à inventer, pas de code à saisir, pas de pool à choisir dans une liste.
 * Un clic, et on se retrouve dans le premier pool qui attend encore des
 * joueurs — ou dans un pool tout neuf s'il n'y en a aucun.
 *
 * Ce fichier ne contient que la décision, sans lecture ni écriture : « à quel
 * pool cet utilisateur doit-il être rattaché, et faut-il le créer ? ». La
 * route /join-instant-draft (server.js) l'entoure d'un verrou et se charge de
 * persister. Séparés ainsi, les cas limites qui font vraiment mal — deux clics
 * simultanés, un pool qui vient de partir en repêchage, un pool plein — se
 * testent sans Express, sans Socket.IO et sans Postgres (voir
 * test/unit/instant-draft.test.js).
 */

'use strict';

const { checkIfDraftComplete } = require('./draft.js');

/**
 * Préfixe des pools créés par la file. Il sert aussi de repli pour reconnaître
 * un pool instantané : `instant: true` est la marque officielle, mais un pool
 * recopié à la main, ou créé avant ce champ, n'a que son nom pour le dire.
 */
const PREFIXE_INSTANTANE = 'Repêchage instantané #';

/**
 * Taille d'un pool instantané.
 *
 * Quatre, et pas dix : la file ne vaut que si elle se remplit. Un pool à dix
 * places attendrait dix inconnus avant de démarrer, ce qui est exactement
 * l'attente que « instantané » promet d'éviter ; quatre équipes suffisent à
 * faire un repêchage en serpentin qui a du sens. Qui veut plus grand crée son
 * pool normalement (creer-pool.html).
 */
const JOUEURS_PAR_POOL = 4;

/** Nombre d'équipes préparées d'avance, comme dans /create-clan. */
const EQUIPES_PAR_POOL = 10;

/** Quotas de sélection par défaut, identiques à ceux de /create-clan. */
const CONFIG_PAR_DEFAUT = {
    numOffensive: 6,
    numDefensive: 4,
    numGoalies: 1,
    numRookies: 1,
    numTeams: 1
};

/** Ce pool sort-il de la file instantanée ? */
function estPoolInstantane(nom, pool) {
    if (pool && pool.instant === true) return true;
    return typeof nom === 'string' && nom.startsWith(PREFIXE_INSTANTANE);
}

/**
 * Les participants du pool, dans l'ordre des équipes.
 *
 * Le salon d'attente les affiche par leur nom : savoir avec qui on va
 * repêcher est la seule chose qu'on puisse encore vouloir vérifier avant que
 * la file démarre — et la seule qui donne envie d'attendre plutôt que de
 * partir.
 */
function membres(pool) {
    return Object.values((pool && pool.teams) || {})
        .flatMap(equipe => (((equipe && equipe.members) || []).slice()));
}

/** Nombre de participants inscrits, toutes équipes confondues. */
function participants(pool) {
    return membres(pool).length;
}

/**
 * Le repêchage a-t-il démarré ? Même règle que partout ailleurs dans le projet
 * (activePool.js, /join-team) : un ordre de sélection non vide.
 */
function repechageCommence(pool) {
    return !!(pool && Array.isArray(pool.draftOrder) && pool.draftOrder.length > 0);
}

/** Places restantes avant que le pool soit complet. */
function placesRestantes(pool) {
    const max = (pool && pool.maxPlayers) || JOUEURS_PAR_POOL;
    return Math.max(0, max - participants(pool));
}

/**
 * Le pool accepte-t-il encore quelqu'un ?
 *
 * Les deux portes se ferment ensemble : plein, ou déjà en repêchage. C'est ce
 * qui fait qu'un nouvel arrivant repart sur un pool neuf au lieu de s'ajouter
 * à une partie commencée.
 */
function accepteEncore(nom, pool) {
    return estPoolInstantane(nom, pool) && !repechageCommence(pool) && placesRestantes(pool) > 0;
}

/** L'utilisateur figure-t-il déjà dans une des équipes du pool ? */
function estMembre(pool, username) {
    if (!pool || !pool.teams) return false;
    return Object.values(pool.teams)
        .some(equipe => (((equipe && equipe.members) || []).includes(username)));
}

/**
 * Première équipe libre, c'est-à-dire vide.
 *
 * Un pool instantané rassemble des inconnus : chacun repêche pour lui, donc
 * chacun a son équipe. On ne se rabat sur une équipe déjà occupée que s'il
 * n'en reste aucune de vide, pour ne jamais refuser sa place à quelqu'un que
 * la file vient d'aiguiller ici.
 */
function premiereEquipeLibre(pool) {
    const equipes = Object.entries((pool && pool.teams) || {});

    const vide = equipes.find(([, equipe]) => (((equipe && equipe.members) || []).length === 0));
    if (vide) return vide[0];

    const partagee = equipes.find(([, equipe]) => (((equipe && equipe.members) || []).length < 5));
    return partagee ? partagee[0] : null;
}

/**
 * Le pool qui doit accueillir le prochain arrivant, ou null.
 *
 * Quand plusieurs pools attendent — ce qui ne devrait pas durer, mais arrive
 * le temps qu'un pool démarre — on prend le plus rempli : il partira le
 * premier, et la file converge vers un seul pool au lieu d'en garder trois à
 * moitié pleins. À égalité, le plus ancien passe devant, puis le nom, pour que
 * deux requêtes lisant les mêmes données choisissent forcément le même.
 */
function poolEnAttente(draftData) {
    const candidats = Object.entries(draftData || {})
        .filter(([nom, pool]) => accepteEncore(nom, pool));

    if (candidats.length === 0) return null;

    candidats.sort(([nomA, a], [nomB, b]) => {
        const parRemplissage = participants(b) - participants(a);
        if (parRemplissage !== 0) return parRemplissage;

        const dateA = Date.parse(a.createdAt || '') || 0;
        const dateB = Date.parse(b.createdAt || '') || 0;
        if (dateA !== dateB) return dateA - dateB;

        return nomA.localeCompare(nomB, 'fr');
    });

    return candidats[0][0];
}

/**
 * Pool instantané, pas encore parti en repêchage, dont l'utilisateur est déjà
 * membre.
 *
 * Un double-clic, un rafraîchissement ou un retour arrière ne doit ni
 * l'inscrire deux fois ni le déplacer : on le renvoie là où il est déjà.
 */
function poolDejaRejoint(draftData, username) {
    const entree = Object.entries(draftData || {})
        .find(([nom, pool]) => estPoolInstantane(nom, pool) &&
                               !repechageCommence(pool) &&
                               estMembre(pool, username));
    return entree ? entree[0] : null;
}

/**
 * Pool instantané dont l'utilisateur est membre et dont le repêchage est en
 * cours.
 *
 * On ne met personne dans deux salles de repêchage à la fois : le tour de
 * chacun est chronométré, et rater ses choix ici pour aller en faire ailleurs
 * n'a aucun sens. Tant que sa sélection n'est pas finie, un nouveau clic sur
 * « repêchage instantané » le ramène simplement à sa partie. Un repêchage
 * terminé, lui, ne retient plus personne : la file peut le renvoyer ailleurs.
 */
function poolEnRepechage(draftData, username) {
    const entree = Object.entries(draftData || {})
        .find(([nom, pool]) => estPoolInstantane(nom, pool) &&
                               repechageCommence(pool) &&
                               estMembre(pool, username) &&
                               !checkIfDraftComplete(pool));
    return entree ? entree[0] : null;
}

/**
 * Nom libre pour le prochain pool instantané.
 *
 * On numérote à partir du premier entier disponible, en vérifiant contre TOUS
 * les pools et pas seulement les instantanés : le nom est la clé primaire, et
 * un pool créé à la main qui porterait celui-là se ferait écraser.
 */
function prochainNom(draftData) {
    const pris = new Set(Object.keys(draftData || {}));
    let numero = 1;
    while (pris.has(`${PREFIXE_INSTANTANE}${numero}`)) numero++;
    return `${PREFIXE_INSTANTANE}${numero}`;
}

/**
 * Ce qu'il faut faire de cet utilisateur, sans rien modifier.
 *
 * Renvoie `{ action, nom }` où action vaut :
 *   encours   — il repêche déjà dans un pool instantané, on l'y ramène
 *   deja      — il est déjà dans un pool instantané en attente
 *   rejoindre — un pool attend des joueurs, il y entre
 *   creer     — aucun pool ne prend de joueur, il en ouvre un
 */
function deciderPool(draftData, username) {
    const encours = poolEnRepechage(draftData, username);
    if (encours) return { action: 'encours', nom: encours };

    const deja = poolDejaRejoint(draftData, username);
    if (deja) return { action: 'deja', nom: deja };

    const attente = poolEnAttente(draftData);
    if (attente) return { action: 'rejoindre', nom: attente };

    return { action: 'creer', nom: prochainNom(draftData) };
}

/**
 * Un pool instantané tout neuf, son premier joueur déjà installé dans
 * Équipe 1.
 *
 * La forme reproduit celle de /create-clan — mêmes clés, mêmes défauts — pour
 * que le reste du site (repêchage, échanges, classement) n'ait aucune raison
 * de traiter ces pools à part. Trois différences seulement : le drapeau
 * `instant`, la date de création qui ordonne la file, et l'absence de mot de
 * passe — une file d'attente qui demande un mot de passe n'en est plus une.
 */
function creerPool(username, options = {}) {
    const maxPlayers = options.maxPlayers || JOUEURS_PAR_POOL;

    const teams = {};
    for (let i = 1; i <= EQUIPES_PAR_POOL; i++) {
        teams[`Équipe ${i}`] = { members: [], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] };
    }
    teams['Équipe 1'].members.push(username);

    return {
        maxPlayers,
        // Le premier arrivé devient créateur : c'est lui qui pourra sauter un
        // tour qui traîne pendant le repêchage. Personne n'a « fondé » ce pool,
        // mais quelqu'un doit pouvoir débloquer la salle.
        creator: username,
        draftOrder: [],
        currentPickIndex: 0,
        lastPickIndex: -1,
        config: { ...CONFIG_PAR_DEFAUT, ...(options.config || {}) },
        // Cumulatif, jamais tête-à-tête : le mode H2H exige un nombre pair de
        // participants, ce que la file ne peut pas promettre — un pool démarré
        // à trois par un départ produirait un calendrier impossible.
        poolMode: 'cumulative',
        allowTrades: true,
        instant: true,
        createdAt: options.now || new Date().toISOString(),
        teams
    };
}

/**
 * Inscrit l'utilisateur dans le pool et renvoie le nom de son équipe.
 *
 * Renvoie null si rien n'a été fait — déjà membre, plus une seule place, ou
 * repêchage lancé. L'appelant a déjà vérifié sous verrou ; ce deuxième filet
 * ne coûte rien et évite qu'un futur appel moins prudent ne gonfle un pool
 * au-delà de sa taille.
 */
function inscrire(pool, username) {
    if (!pool || estMembre(pool, username)) return null;
    if (repechageCommence(pool) || placesRestantes(pool) === 0) return null;

    const equipe = premiereEquipeLibre(pool);
    if (!equipe) return null;

    pool.teams[equipe].members.push(username);
    return equipe;
}

/**
 * Retire l'utilisateur du pool et renvoie le nom de l'équipe qu'il quitte.
 *
 * Renvoie null si rien n'a été fait — il n'y était pas, ou le repêchage est
 * parti. Une fois l'ordre de sélection tiré, partir laisserait une équipe
 * fantôme à qui son tour reviendrait quand même : à ce stade, la sortie n'est
 * plus une place qu'on libère mais un repêchage qu'on casse pour les trois
 * autres.
 */
function retirer(pool, username) {
    if (!pool || repechageCommence(pool)) return null;

    const entree = Object.entries((pool && pool.teams) || {})
        .find(([, equipe]) => (((equipe && equipe.members) || []).includes(username)));
    if (!entree) return null;

    const [nom, equipe] = entree;
    equipe.members = equipe.members.filter(membre => membre !== username);
    return nom;
}

/** Le pool est-il complet, donc prêt à partir de lui-même ? */
function doitDemarrer(pool) {
    return !!pool && !repechageCommence(pool) && placesRestantes(pool) === 0;
}

/** Total des sélections d'un pool, d'après ses quotas. */
function totalSelections(pool) {
    const config = (pool && pool.config) || CONFIG_PAR_DEFAUT;
    return config.numOffensive + config.numDefensive + config.numGoalies +
           config.numRookies + config.numTeams;
}

/** Équipes qui repêcheront : celles qui ont au moins un membre. */
function equipesEligibles(pool) {
    return Object.entries((pool && pool.teams) || {})
        .filter(([, equipe]) => (((equipe && equipe.members) || []).length > 0))
        .map(([nom]) => nom);
}

module.exports = {
    PREFIXE_INSTANTANE,
    JOUEURS_PAR_POOL,
    EQUIPES_PAR_POOL,
    CONFIG_PAR_DEFAUT,
    estPoolInstantane,
    membres,
    participants,
    repechageCommence,
    placesRestantes,
    accepteEncore,
    estMembre,
    premiereEquipeLibre,
    poolEnAttente,
    poolDejaRejoint,
    poolEnRepechage,
    prochainNom,
    deciderPool,
    creerPool,
    inscrire,
    retirer,
    doitDemarrer,
    totalSelections,
    equipesEligibles
};
