/* ============================================================
   ACCUEIL — HÉROS DU REPÊCHAGE (maquette « Accueil v2 »)
   ------------------------------------------------------------
   Le haut de l'accueil, du moment où le pool existe jusqu'à la fin du
   repêchage. Un seul bloc, qui change de ton selon où l'on en est :

     pre      — le repêchage n'est pas parti : la date prévue, ce qui reste
                à préparer ;
     waiting  — il est parti, mon tour viendra : où j'en suis, mon choix
                probable ;
     next     — je suis le prochain : liseré rouge, même panneau ;
     onclock  — c'est mon tour : le bloc passe au rouge et je peux choisir
                d'ici, en deux clics (choisir, confirmer) ;
     done     — mon dernier choix vient de passer, ou mon équipe est
                complète.

   La limite de temps par choix n'existe que dans un repêchage à date fixe
   (pickTimeLimitMs, lib/poolOps.js) : à zéro, le serveur choisit à la
   place de l'équipe. Là, on affiche le temps restant ; ailleurs, le temps
   écoulé, jamais un compte à rebours.

   Le calcul (fzhHero*) est pur : il lit l'état du pool et rend un modèle,
   que fzhHeroHTML() met en forme. Les tests l'appellent sans navigateur
   (test/unit/accueil-draft-hero.test.js).
   ============================================================ */

/** Nombre de cases de l'ordre de sélection montrées d'un coup. */
const FZH_HERO_CASES = 8;

/** Libellés courts d'une position, en français. */
const FZH_HERO_POS = { C: 'C', L: 'AG', R: 'AD', D: 'D', G: 'G' };

/** Catégorie du pool → libellé court, pour « Ton équipe ». */
const FZH_HERO_CATEGORIES = { offensive: 'Att.', defensive: 'Déf.', goalie: 'G', rookie: 'Recrue', teams: 'Club' };

/** Le titre de l'onglet avant que le repêchage ne s'en mêle. */
const FZH_HERO_TITRE = typeof document !== 'undefined' ? document.title : '';

// ───────────────────────────── Calculs ─────────────────────────────

/** Où en est cette équipe dans le repêchage de son pool. */
function fzhHeroPhase(poolData, teamName) {
    const ordre = Array.isArray(poolData && poolData.draftOrder) ? poolData.draftOrder : [];
    if (!ordre.length) return 'pre';
    const tour = poolData.currentPickIndex || 0;
    if (ordre[tour] === teamName) return 'onclock';
    const prochain = ordre.indexOf(teamName, tour);
    if (prochain === tour + 1) return 'next';
    if (prochain < 0) return 'done';
    const historique = poolData.picksHistory || [];
    const dernier = historique[historique.length - 1];
    return dernier && dernier.team === teamName && dernier.pickIndex === tour - 1 ? 'done' : 'waiting';
}

/**
 * Durée typique d'un choix dans ce repêchage : la médiane des derniers
 * écarts entre choix horodatés. Il en faut deux au moins — une seule
 * mesure ne dit rien d'un rythme. Une médiane plutôt qu'une moyenne : une
 * pause d'une heure au milieu ne doit pas annoncer une heure par choix.
 */
function fzhHeroRythme(historique) {
    const instants = (historique || [])
        .map(h => Date.parse(h && h.at))
        .filter(Number.isFinite)
        .slice(-9);
    const ecarts = [];
    for (let i = 1; i < instants.length; i++) {
        const ecart = instants[i] - instants[i - 1];
        if (ecart > 0) ecarts.push(ecart);
    }
    if (ecarts.length < 2) return null;
    ecarts.sort((a, b) => a - b);
    const milieu = Math.floor(ecarts.length / 2);
    return ecarts.length % 2 ? ecarts[milieu] : (ecarts[milieu - 1] + ecarts[milieu]) / 2;
}

/**
 * Attente estimée avant mon tour : ce qui reste du choix en cours, puis un
 * rythme par choix d'ici au mien. null quand le rythme n'est pas connu.
 */
function fzhHeroAttente(estimation) {
    const { avant, rythme, depuis, maintenant } = estimation;
    if (!rythme || !(avant > 0)) return null;
    const ecoule = Number.isFinite(depuis) ? Math.max(0, maintenant - depuis) : 0;
    return Math.max(0, rythme - ecoule) + (avant - 1) * rythme;
}

/** « < 1 min », « ~8 min », « ~1 h 20 ». */
function fzhHeroDuree(ms) {
    if (!Number.isFinite(ms)) return null;
    const minutes = Math.round(ms / 60000);
    if (minutes < 1) return '< 1 min';
    if (minutes < 60) return `~${minutes} min`;
    const heures = Math.floor(minutes / 60);
    const reste = Math.round((minutes % 60) / 5) * 5;
    return reste && reste < 60 ? `~${heures} h ${String(reste).padStart(2, '0')}` : `~${heures + (reste === 60 ? 1 : 0)} h`;
}

/** Temps écoulé en « 1:07 », ou « 1:02:07 » passé une heure. */
function fzhHeroChrono(ms) {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** « dans 35 min », « dans 2 h 14 », « dans 3 jours » — null une fois l'heure passée. */
function fzhHeroAvantDebut(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const minutes = Math.ceil(ms / 60000);
    if (minutes < 60) return `dans ${minutes} min`;
    const heures = Math.floor(minutes / 60);
    if (heures < 24) return `dans ${heures} h ${String(minutes % 60).padStart(2, '0')}`;
    const jours = Math.round(heures / 24);
    return `dans ${jours} jour${jours > 1 ? 's' : ''}`;
}

/** L'heure du départ : « 20 h 00 » le jour même, « sam. 4 oct., 20 h » sinon. */
function fzhHeroHeure(iso, maintenant) {
    const instant = Date.parse(iso);
    if (!Number.isFinite(instant)) return '';
    const date = new Date(instant);
    const minutes = String(date.getMinutes()).padStart(2, '0');
    if (date.toDateString() === new Date(maintenant).toDateString()) return `${date.getHours()} h ${minutes}`;
    const jour = date.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });
    return `${jour}, ${date.getHours()} h${minutes === '00' ? '' : ' ' + minutes}`;
}

/** « M. Celebrini » : l'initiale du prénom, pour tenir dans une case. */
function fzhHeroNomCourt(nom) {
    return String(nom || '').replace(/^(\S)\S*\s+/, '$1. ');
}

/** « Celebrini » : le nom de famille, pour les titres. Un club garde son nom entier. */
function fzhHeroNomFamille(nom, estClub) {
    const mots = String(nom || '').trim().split(/\s+/);
    return estClub || mots.length < 2 ? mots.join(' ') : mots.slice(1).join(' ');
}

/** « user2 », « user2 et user1 », « user2, user1 et 3 autres ». */
function fzhHeroListe(noms) {
    if (noms.length <= 2) return noms.join(' et ');
    return `${noms.slice(0, 2).join(', ')} et ${noms.length - 2} autre${noms.length > 3 ? 's' : ''}`;
}

/** Tout ce qui a été pris, par toutes les équipes, banc compris. */
function fzhHeroPris(poolData) {
    const pris = new Set();
    Object.values((poolData && poolData.teams) || {}).forEach(e => {
        ['offensive', 'defensive', 'goalie', 'rookie', 'teams'].forEach(c => (e[c] || []).forEach(n => pris.add(n)));
        (e.bench || []).forEach(b => pris.add(typeof b === 'string' ? b : b && b.nom));
    });
    return pris;
}

/**
 * Les catégories où cette équipe peut encore choisir. Une place de banc
 * libre (tête-à-tête) rouvre celles des patineurs — jamais le gardien ni le
 * club —, comme au serveur (poolOps.choisirJoueur).
 */
function fzhHeroOuvertes(poolData, teamName, quotaBanc) {
    const e = (poolData.teams || {})[teamName] || {};
    const c = { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1, numTeams: 1, ...(poolData.config || {}) };
    const banc = (e.bench || []).length < (quotaBanc || 0);
    return {
        offensive: banc || (e.offensive || []).length < c.numOffensive,
        defensive: banc || (e.defensive || []).length < c.numDefensive,
        rookie: banc || (e.rookie || []).length < c.numRookies,
        goalie: (e.goalie || []).length < c.numGoalies,
        teams: (e.teams || []).length < c.numTeams
    };
}

/** Code de position d'une fiche de la trousse — même règle que la salle (fzPositionCode). */
function fzhHeroCode(rec, kind) {
    if (kind === 'goalie') return 'G';
    if (kind === 'team') return 'T';
    return rec.isRookie === true ? '*' : rec.positionCode;
}

/** Code de position → catégorie envoyée au serveur, comme commitPlayerPick (draftActif.js). */
function fzhHeroCategorie(code) {
    return { D: 'defensive', G: 'goalie', '*': 'rookie', T: 'teams' }[code] || 'offensive';
}

/**
 * Les meilleurs joueurs que cette équipe peut prendre maintenant.
 *
 * Même bassin et même mesure que la carte « Suggestion » de la salle
 * (draftApercuExtra.js) : la projection de la trousse, points pour un
 * patineur, victoires × 2 pour un gardien. Les favoris passent devant — c'est
 * « ta liste » —, complétés au besoin par les meilleurs disponibles. Seules
 * les catégories encore ouvertes comptent : un joueur que le serveur
 * refuserait n'est pas proposé. Les clubs de la LNH n'entrent que quand il
 * ne reste plus qu'eux à choisir.
 */
function fzhHeroCandidats(options) {
    const { pools, poolData, teamName, favoris = [], quotaBanc = 0, nombre = 3 } = options;
    const pris = fzhHeroPris(poolData);
    const ouvertes = fzhHeroOuvertes(poolData, teamName, quotaBanc);
    const joueursOuverts = ouvertes.offensive || ouvertes.defensive || ouvertes.rookie || ouvertes.goalie;
    const fiches = [
        ...((pools && pools.skaters) || []).map(rec => ({ nom: rec.skaterFullName, rec, kind: 'skater' })),
        ...((pools && pools.goalies) || []).map(rec => ({ nom: rec.goalieFullName, rec, kind: 'goalie' })),
        ...(joueursOuverts ? [] : ((pools && pools.teams) || []).map(rec => ({ nom: rec.teamFullName, rec, kind: 'team' })))
    ];
    const listeFavoris = new Set(favoris);
    const valeur = c => (c.kind === 'skater' ? (c.rec.points || 0) : (c.rec.wins || 0) * (c.kind === 'goalie' ? 2 : 1));
    return fiches
        .filter(c => c.nom && !pris.has(c.nom))
        .map(c => {
            const code = fzhHeroCode(c.rec, c.kind);
            return { ...c, code, categorie: fzhHeroCategorie(code), favori: listeFavoris.has(c.nom) };
        })
        .filter(c => ouvertes[c.categorie])
        .sort((a, b) => (Number(b.favori) - Number(a.favori)) || (valeur(b) - valeur(a)) || a.nom.localeCompare(b.nom))
        .slice(0, nombre)
        .map(c => ({
            nom: c.nom,
            code: c.code,
            categorie: c.categorie,
            favori: c.favori,
            equipe: c.kind === 'team' ? (c.rec.teamAbbrev || '') : String(c.rec.teamAbbrevs || '').split(',').pop().trim(),
            playerId: c.rec.playerId || null,
            estClub: c.kind === 'team',
            detail: fzhHeroDetail(c)
        }));
}

/** « AD · 71 pts », « Recrue · C · 38 pts », « G · 34 V », « Club · 48 V ». */
function fzhHeroDetail(c) {
    if (c.kind === 'team') return `Club · ${c.rec.wins ?? '–'} V`;
    if (c.kind === 'goalie') return `G · ${c.rec.wins ?? '–'} V`;
    const pos = FZH_HERO_POS[c.rec.positionCode] || c.rec.positionCode || '';
    return [c.code === '*' ? 'Recrue' : '', pos, `${c.rec.points ?? '–'} pts`].filter(Boolean).join(' · ');
}

/**
 * L'ordre du premier tour, s'il est connu avant le départ : après une
 * saison, le dernier au classement ouvre le bal (poolOps.ordreDeDepart).
 * Sinon null — l'ordre sera tiré au hasard.
 */
function fzhHeroOrdreAnnonce(poolData) {
    const saisons = poolData.saisonsPrecedentes || [];
    const derniere = saisons[saisons.length - 1];
    if (!derniere || !Array.isArray(derniere.classement) || !derniere.classement.length) return null;
    const equipes = poolData.teams || {};
    const restantes = new Set(Object.keys(equipes).filter(n => (equipes[n].members || []).length).sort());
    const ordre = [];
    [...derniere.classement].sort((a, b) => (b.rang || 0) - (a.rang || 0)).forEach(ligne => {
        let nom = restantes.has(ligne.equipe) ? ligne.equipe : null;
        if (!nom && Array.isArray(ligne.membres)) {
            nom = [...restantes].find(n => (equipes[n].members || []).some(m => ligne.membres.includes(m))) || null;
        }
        if (nom) { ordre.push(nom); restantes.delete(nom); }
    });
    return [...ordre, ...restantes];
}

/** Les cases de l'ordre de sélection, deux choix passés compris. */
function fzhHeroCases(poolData, teamName) {
    const ordre = poolData.draftOrder || [];
    const tour = poolData.currentPickIndex || 0;
    const parIndice = new Map((poolData.picksHistory || []).map(h => [h.pickIndex, h.player]));
    const suivantMien = ordre.indexOf(teamName, tour + 1);
    const debut = Math.max(0, Math.min(tour - 2, ordre.length - FZH_HERO_CASES));
    return ordre.slice(debut, debut + FZH_HERO_CASES).map((equipe, i) => {
        const indice = debut + i;
        const mien = equipe === teamName;
        const etat = indice < tour ? 'fait' : indice === tour ? 'actuel' : 'avenir';
        let sous = '';
        if (etat === 'fait') sous = parIndice.has(indice) ? fzhHeroNomCourt(parIndice.get(indice)) : 'Passé';
        else if (etat === 'actuel') sous = mien ? 'Au choix' : 'Choisit…';
        else if (indice === suivantMien) sous = 'Ton tour';
        return { numero: String(indice + 1).padStart(2, '0'), nom: mien ? 'TOI' : equipe, sous, etat, mien };
    });
}

/** Avant le départ : les équipes inscrites, dans l'ordre s'il est connu. */
function fzhHeroCasesAvant(poolData, teamName) {
    const annonce = fzhHeroOrdreAnnonce(poolData);
    const equipes = poolData.teams || {};
    const noms = annonce || Object.keys(equipes).filter(n => (equipes[n].members || []).length).sort((a, b) => a.localeCompare(b, 'fr'));
    return noms.slice(0, FZH_HERO_CASES).map((nom, i) => {
        const membres = (equipes[nom] && equipes[nom].members) || [];
        const mien = nom === teamName;
        return {
            numero: annonce ? String(i + 1).padStart(2, '0') : '',
            nom: mien ? 'TOI' : nom,
            sous: !mien && membres[0] && membres[0] !== nom ? membres[0] : '',
            etat: 'avenir',
            mien
        };
    });
}

/**
 * Le modèle du héros. Tout ce qui s'affiche en sort ; rien n'y est inventé :
 * chaque chiffre vient du pool, et une estimation sans assez de recul cède
 * la place au nombre de choix.
 */
function fzhHeroModele(options) {
    const { poolData, poolName, teamName, username, maintenant = Date.now(), favoris = [] } = options;
    const phase = fzhHeroPhase(poolData, teamName);
    const equipes = poolData.teams || {};
    const inscrites = Object.keys(equipes).filter(n => (equipes[n].members || []).length);
    const participants = [...new Set(inscrites.flatMap(n => equipes[n].members))];
    const c = { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1, numTeams: 1, ...(poolData.config || {}) };
    const banc = typeof window !== 'undefined' && typeof window.fzQuotaBanc === 'function' ? window.fzQuotaBanc(poolData) : 0;
    const rondes = c.numOffensive + c.numDefensive + c.numGoalies + c.numRookies + c.numTeams + banc;
    const salle = `draftActif.html?pool=${encodeURIComponent(poolName)}`;
    const salon = `repechage.html?pool=${encodeURIComponent(poolName)}`;
    const base = {
        phase, poolName,
        meta: `${poolName} · ${participants.length} participant${participants.length > 1 ? 's' : ''} · ${rondes} rondes`,
        barreLibelle: 'Repêchage en direct'
    };

    if (phase === 'pre') return { ...base, ...fzhHeroAvant({ poolData, teamName, username, maintenant, favoris, inscrites, participants, salon }) };

    const ordre = poolData.draftOrder;
    const tour = poolData.currentPickIndex || 0;
    const nbEquipes = new Set(ordre).size || 1;
    const ronde = Math.floor(tour / nbEquipes) + 1;
    const prochain = ordre.indexOf(teamName, tour);
    const avant = prochain < 0 ? null : prochain - tour;
    const auChoix = ordre[tour];
    const depuis = Number(poolData.turnStartedAt) || null;
    const rythme = fzhHeroRythme(poolData.picksHistory);
    const attente = fzhHeroAttente({ avant, rythme, depuis, maintenant });
    const eta = attente == null ? null : { avant, rythme, depuis };
    const tempsTour = attente == null ? (avant ? `${avant} choix` : '—') : fzhHeroDuree(attente);
    const commun = {
        cases: fzhHeroCases(poolData, teamName),
        ordreTitre: 'Ordre de sélection',
        ordreDetail: `Ronde ${ronde} · choix ${tour + 1} / ${ordre.length}`,
        activite: `${auChoix} choisit depuis`,
        depuis,
        cta: { libelle: 'Suivre le repêchage', href: salle, style: 'ghost' },
        temps: { libelle: 'Ton tour dans', valeur: tempsTour, eta },
        panneau: { type: 'probable', titre: 'Ton choix probable', note: 'Classement mis à jour à chaque choix.', salle },
        barreCta: 'Suivre',
        href: salle
    };

    if (phase === 'onclock') {
        const autres = inscrites.filter(n => n !== teamName);
        const limite = Number(poolData.pickTimeLimitMs) || 0;
        const echeance = limite && depuis ? depuis + limite : null;
        return {
            ...base, ...commun,
            puce: "C'est ton tour",
            titre: "C'est ton tour",
            sousTitre: echeance
                ? `Ronde ${ronde}, choix ${tour + 1}. Choisis ici ou dans le repêchage : à zéro, Fantazy prend le meilleur joueur disponible.`
                : `Ronde ${ronde}, choix ${tour + 1}. Choisis directement ici ou ouvre le repêchage.`,
            cta: { libelle: 'Ouvrir le repêchage', href: salle, style: 'blanc' },
            temps: echeance
                ? { libelle: 'Temps restant', rebours: echeance, valeur: fzhHeroChrono(Math.max(0, echeance - maintenant)), grand: true }
                : { libelle: 'Temps écoulé', chrono: depuis, valeur: fzhHeroChrono(depuis ? maintenant - depuis : 0), grand: true },
            activite: autres.length > 2 ? `Les ${autres.length} autres équipes attendent ton choix` : `${fzhHeroListe(autres)} ${autres.length > 1 ? 'attendent' : 'attend'} ton choix`,
            depuis: null,
            panneau: { type: 'choix', titre: 'Choisis en un clic', meta: 'Tes 3 meilleurs disponibles', salle, tour },
            barreTexte: "C'est ton tour",
            ...(echeance ? { barreRebours: echeance } : { barreChrono: depuis }),
            barreCta: 'Choisir',
            titreOnglet: "(C'est ton tour !) Fantazy"
        };
    }

    if (phase === 'next') {
        return {
            ...base, ...commun,
            puce: 'Tu es le prochain',
            titre: 'Tu es le prochain',
            sousTitre: `${auChoix} est en train de choisir. Garde ta liste sous la main.`,
            cta: { libelle: 'Rejoindre le repêchage', href: salle, style: 'plein' },
            panneau: { ...commun.panneau, suivant: auChoix },
            barreTexte: `Tu es le prochain${attente == null ? '' : ` · ${tempsTour}`}`,
            barreCta: 'Rejoindre',
            titreOnglet: '(Tu es le prochain) Fantazy'
        };
    }

    if (phase === 'done') {
        const miens = (poolData.picksHistory || []).filter(h => h.team === teamName);
        const panneau = { type: 'equipe', titre: 'Ton équipe', meta: `${miens.length} / ${rondes} joueurs`, choix: miens.slice(-5).reverse() };
        if (prochain < 0) {
            const restants = ordre.length - tour;
            return {
                ...base, ...commun,
                puce: 'Repêchage en cours',
                titre: 'Ton équipe est complète',
                sousTitre: `Le repêchage se poursuit : encore ${restants} choix.`,
                temps: { libelle: 'Choix restants', valeur: String(restants) },
                panneau,
                barreTexte: 'Ton équipe est complète'
            };
        }
        const dernier = miens[miens.length - 1];
        return {
            ...base, ...commun,
            puce: 'Choix confirmé',
            titre: `${fzhHeroNomFamille(dernier.player, dernier.position === 'teams')} est à toi`,
            sousTitre: `Bon choix. Ton prochain tour arrive dans ${avant} choix.`,
            panneau,
            barreTexte: `Choix confirmé · ton tour dans ${avant} choix`
        };
    }

    return {
        ...base, ...commun,
        puce: 'Repêchage en cours',
        titre: `Ton tour dans ${avant} choix`,
        sousTitre: "Pas d'urgence. C'est le bon moment pour revoir ta liste.",
        barreTexte: `Ton tour dans ${avant} choix${attente == null ? '' : ` (${tempsTour})`}`
    };
}

/** Le modèle d'avant le départ : la date, s'il y en a une, et ce qu'il reste à préparer. */
function fzhHeroAvant(options) {
    const { poolData, teamName, username, maintenant, favoris, inscrites, participants, salon } = options;
    const prevu = poolData.draftScheduledAt || null;
    const restant = prevu ? Date.parse(prevu) - maintenant : NaN;
    const createur = poolData.creator || null;
    const jeSuisCreateur = !!createur && createur === username;
    const annonce = fzhHeroOrdreAnnonce(poolData);
    const rang = annonce ? annonce.indexOf(teamName) + 1 : 0;
    const ordre = rang === 1 ? 'Tu choisis en premier.'
        : rang > 1 ? `Tu choisis au ${rang}e rang.`
        : "L'ordre sera tiré au hasard au départ.";
    const autres = participants.filter(p => p !== username);
    const pair = poolData.poolMode === 'head-to-head';
    const pret = inscrites.length >= 2 && (!pair || inscrites.length % 2 === 0);
    const heure = prevu ? fzhHeroHeure(prevu, maintenant) : '';
    const bientot = prevu ? fzhHeroAvantDebut(restant) : null;

    const liste = favoris.length;
    const etapes = [
        {
            ok: liste > 0,
            titre: 'Ta liste de favoris',
            detail: liste ? `${liste} joueur${liste > 1 ? 's' : ''} dans ta liste` : 'Ajoute les joueurs que tu vises',
            action: { libelle: liste ? 'Modifier' : 'Préparer', href: 'stats.html' }
        },
        {
            ok: pret,
            titre: 'Participants',
            detail: `${inscrites.length} équipe${inscrites.length > 1 ? 's' : ''} inscrite${inscrites.length > 1 ? 's' : ''}`
                + (inscrites.length < 2 ? ' · il en faut au moins 2' : !pret ? ' · il en faut un nombre pair' : ''),
            action: jeSuisCreateur ? { libelle: 'Inviter', href: salon } : null
        },
        {
            ok: !!prevu,
            titre: 'Départ',
            detail: prevu ? `${heure.includes(',') ? heure : `Aujourd'hui, ${heure}`} · automatique`
                : jeSuisCreateur ? 'Fixe une date ou lance-le toi-même'
                : `${createur || 'La personne qui a créé le pool'} le lancera`,
            action: jeSuisCreateur ? { libelle: prevu ? 'Changer' : 'Organiser', href: salon } : null
        }
    ];

    return {
        puce: 'Bientôt',
        titre: prevu ? (bientot ? 'Le repêchage commence ' : 'Le repêchage va commencer') : 'Repêchage en préparation',
        compteARebours: prevu && bientot ? { iso: prevu, texte: bientot } : null,
        sousTitre: `${ordre} Tout est prêt de ton côté ?`,
        cta: { libelle: 'Préparer ma liste', href: 'stats.html', style: 'ghost' },
        temps: { libelle: 'Début', valeur: prevu ? heure : (jeSuisCreateur ? 'Quand tu veux' : 'À confirmer') },
        cases: fzhHeroCasesAvant(poolData, teamName),
        ordreTitre: annonce ? 'Ordre de sélection' : 'Participants',
        ordreDetail: annonce ? 'Ronde 1' : 'Ordre tiré au départ',
        activite: autres.length
            ? `${fzhHeroListe(autres)} ${autres.length > 1 ? 'sont inscrits' : 'est inscrit'}`
            : "Personne d'autre n'est inscrit pour l'instant",
        depuis: null,
        panneau: { type: 'avant', titre: 'Avant le début', meta: `${etapes.filter(e => e.ok).length} sur ${etapes.length}`, etapes },
        barreLibelle: 'Repêchage',
        barreTexte: prevu ? `Commence ${heure.includes(',') ? 'le ' : 'à '}${heure}` : 'En préparation',
        barreCta: 'Préparer',
        href: 'stats.html'
    };
}

// ───────────────────────────── Rendu ─────────────────────────────

function fzhHeroEsc(texte) {
    return typeof escapeHTML === 'function'
        ? escapeHTML(texte)
        : String(texte ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function fzhHeroCasesHTML(cases) {
    return cases.map(k => `<li class="fzh-case is-${k.etat}${k.mien ? ' is-mine' : ''}">
                <span class="fzh-case-num">${fzhHeroEsc(k.numero)}</span>
                <span class="fzh-case-nom">${fzhHeroEsc(k.nom)}</span>
                <span class="fzh-case-sous">${fzhHeroEsc(k.sous)}</span>
            </li>`).join('');
}

function fzhHeroVisage(c) {
    if (typeof offPlayerFaceHTML === 'function' && !c.estClub) return offPlayerFaceHTML(c.nom, c.equipe, c.playerId);
    if (c.estClub && c.equipe) return `<span class="fzd-off-face"><img src="teams/${fzhHeroEsc(c.equipe)}.png" alt="" loading="lazy" onerror="this.remove()"></span>`;
    return `<span class="fzd-off-face">${fzhHeroEsc((c.nom || '?').charAt(0))}</span>`;
}

function fzhHeroCandidatHTML(c, i, options) {
    const { choix = false, enAttente = false, envoi = false } = options || {};
    const ligne = `<div class="fzh-cand-ligne">
                <span class="fzh-cand-rang">${i + 1}</span>
                ${fzhHeroVisage(c)}
                <span class="fzh-cand-txt"><strong>${fzhHeroEsc(c.nom)}</strong><small>${fzhHeroEsc([c.equipe, c.detail].filter(Boolean).join(' · '))}${c.favori ? '<b class="fzh-cand-fav">★<span> Favori</span></b>' : ''}</small></span>
                ${!choix && i === 0 ? '<span class="fzh-cand-tag">Probable</span>' : ''}
                ${choix && !enAttente ? `<button type="button" class="fzh-cand-choisir" data-fzh-choisir="${i}"${envoi ? ' disabled' : ''}>Choisir</button>` : ''}
            </div>`;
    const confirmer = choix && enAttente ? `<div class="fzh-cand-confirmer">
                <button type="button" class="fzh-cand-ok" data-fzh-confirmer="${i}"${envoi ? ' disabled' : ''}>${envoi ? 'Envoi…' : `Confirmer ${fzhHeroEsc(fzhHeroNomFamille(c.nom, c.estClub).toUpperCase())}`}</button>
                <button type="button" class="fzh-cand-annuler" data-fzh-annuler${envoi ? ' disabled' : ''}>Annuler</button>
            </div>` : '';
    return `<li class="fzh-cand${i === 0 && !choix ? ' is-top' : ''}${enAttente ? ' is-pending' : ''}">${ligne}${confirmer}</li>`;
}

/** Le corps du panneau de droite. `candidats` : null tant que la trousse charge. */
function fzhHeroPanneauHTML(modele, candidats, etatChoix) {
    const { enAttente = null, envoi = false } = etatChoix || {};
    const p = modele.panneau;
    if (p.type === 'avant') {
        return `<ul class="fzh-etapes">${p.etapes.map(e => `
                <li class="fzh-etape${e.ok ? ' is-ok' : ''}">
                    <span class="fzh-etape-puce" aria-hidden="true">${e.ok ? '✓' : ''}</span>
                    <span class="fzh-etape-txt"><strong>${fzhHeroEsc(e.titre)}</strong><small>${fzhHeroEsc(e.detail)}</small></span>
                    <span class="fzh-sr">${e.ok ? 'Prêt' : 'À faire'}</span>
                    ${e.action ? `<a class="fzh-etape-action" href="${fzhHeroEsc(e.action.href)}">${fzhHeroEsc(e.action.libelle)}</a>` : ''}
                </li>`).join('')}</ul>`;
    }
    if (p.type === 'equipe') {
        return `<ol class="fzh-equipe">${p.choix.map((h, i) => `
                <li class="${i === 0 ? 'is-new' : ''}"><span>Choix ${h.pickIndex + 1}</span><strong>${fzhHeroEsc(h.player)}</strong><small>${fzhHeroEsc(FZH_HERO_CATEGORIES[h.position] || '')}</small></li>`).join('')}</ol>
            <a class="fzh-panel-lien" href="${fzhHeroEsc(modele.href)}">Voir tout le repêchage →</a>`;
    }
    if (!candidats) return '<p class="fzh-panel-attente">Chargement des joueurs…</p>';
    if (!candidats.length) return `<p class="fzh-panel-attente">Aucun joueur disponible dans tes catégories ouvertes.</p>`;

    const choix = p.type === 'choix';
    const liste = `<ol class="fzh-cands">${candidats.map((c, i) => fzhHeroCandidatHTML(c, i, { choix, enAttente: enAttente === i, envoi })).join('')}</ol>`;
    if (choix) {
        return `${liste}
            <footer class="fzh-panel-pied"><span>Aucune limite de temps : prends le temps qu'il faut.</span><a href="${fzhHeroEsc(p.salle)}">Tous les disponibles →</a></footer>`;
    }
    const aDesFavoris = candidats.some(c => c.favori);
    const note = p.suivant && candidats[1]
        ? `Si ${p.suivant} prend ${fzhHeroNomFamille(candidats[0].nom, candidats[0].estClub)}, ${fzhHeroNomFamille(candidats[1].nom, candidats[1].estClub)} passe en tête.`
        : p.note;
    return `${liste}
            <p class="fzh-panel-note">${fzhHeroEsc(note)}</p>
            <footer class="fzh-panel-pied"><span>${aDesFavoris ? 'Selon tes favoris' : 'Aucun favori : les meilleurs disponibles'}</span><a href="${fzhHeroEsc(p.salle)}">Ma liste →</a></footer>`;
}

function fzhHeroMetaPanneau(modele, candidats) {
    const p = modele.panneau;
    if (p.meta) return p.meta;
    if (!candidats) return '';
    return candidats.some(c => c.favori) ? 'Selon ta liste' : 'Meilleurs disponibles';
}

/** La barre du haut : l'essentiel du héros, qui reste en vue en défilant. */
function fzhHeroBarreHTML(modele) {
    const chrono = modele.barreRebours
        ? ` · <span data-fzh-rebours="${modele.barreRebours}">${fzhHeroChrono(Math.max(0, modele.barreRebours - Date.now()))}</span>`
        : modele.barreChrono ? ` · <span data-fzh-depuis="${modele.barreChrono}">${fzhHeroChrono(Date.now() - modele.barreChrono)}</span>` : '';
    return `<a class="fzh-barre is-${modele.phase}" href="${fzhHeroEsc(modele.href)}">
            <i class="fzh-point" aria-hidden="true"></i>
            <span class="fzh-barre-libelle">${fzhHeroEsc(modele.barreLibelle)}</span>
            <span class="fzh-barre-pool">${fzhHeroEsc(modele.poolName)}</span>
            <span class="fzh-barre-sep" aria-hidden="true">·</span>
            <span class="fzh-barre-texte">${fzhHeroEsc(modele.barreTexte)}${chrono}</span>
            <span class="fzh-barre-cta">${fzhHeroEsc(modele.barreCta)} <span aria-hidden="true">→</span></span>
        </a>`;
}

function fzhHeroHTML(modele, candidats, etatChoix) {
    const t = modele.temps;
    const titre = modele.compteARebours
        ? `${fzhHeroEsc(modele.titre)}<span data-fzh-avant="${fzhHeroEsc(modele.compteARebours.iso)}">${fzhHeroEsc(modele.compteARebours.texte)}</span>`
        : fzhHeroEsc(modele.titre);
    const valeurTemps = t.rebours
        ? `<strong data-fzh-rebours="${t.rebours}">${fzhHeroEsc(t.valeur)}</strong>`
        : t.chrono
        ? `<strong data-fzh-depuis="${t.chrono}">${fzhHeroEsc(t.valeur)}</strong>`
        : t.eta
            ? `<strong data-fzh-eta="${fzhHeroEsc(JSON.stringify(t.eta))}">${fzhHeroEsc(t.valeur)}</strong>`
            : `<strong>${fzhHeroEsc(t.valeur)}</strong>`;
    return `
        <section class="fzh-hero is-${modele.phase}" aria-labelledby="fzhHeroTitre">
            <div class="fzh-hero-grille">
                <div class="fzh-hero-principal">
                    <div class="fzh-hero-haut">
                        <span class="fzh-puce"><i class="fzh-point" aria-hidden="true"></i>${fzhHeroEsc(modele.puce)}</span>
                        <span class="fzh-hero-meta">${fzhHeroEsc(modele.meta)}</span>
                    </div>
                    <div class="fzh-hero-copie">
                        <h1 id="fzhHeroTitre">${titre}</h1>
                        <p>${fzhHeroEsc(modele.sousTitre)}</p>
                    </div>
                    <div class="fzh-hero-actions">
                        <a class="fzh-hero-cta is-${modele.cta.style}" href="${fzhHeroEsc(modele.cta.href)}">${fzhHeroEsc(modele.cta.libelle)} <span aria-hidden="true">→</span></a>
                        <div class="fzh-hero-temps${t.grand ? ' is-grand' : ''}"><span>${fzhHeroEsc(t.libelle)}</span>${valeurTemps}</div>
                    </div>
                    <div class="fzh-hero-ordre">
                        <div class="fzh-hero-ordre-tete"><span>${fzhHeroEsc(modele.ordreTitre)}</span><span>${fzhHeroEsc(modele.ordreDetail)}</span></div>
                        <ol class="fzh-cases">${fzhHeroCasesHTML(modele.cases)}</ol>
                        <p class="fzh-hero-activite"><span>${fzhHeroEsc(modele.activite)}</span>${modele.depuis ? ` <strong data-fzh-depuis="${modele.depuis}">${fzhHeroChrono(Date.now() - modele.depuis)}</strong>` : ''}</p>
                    </div>
                </div>
                <aside class="fzh-hero-panneau" aria-labelledby="fzhHeroPanneauTitre">
                    <header><h2 id="fzhHeroPanneauTitre">${fzhHeroEsc(modele.panneau.titre)}</h2><span data-fzh-panneau-meta>${fzhHeroEsc(fzhHeroMetaPanneau(modele, candidats))}</span></header>
                    <div class="fzh-hero-panneau-corps" data-fzh-panneau aria-live="polite">${fzhHeroPanneauHTML(modele, candidats, etatChoix)}</div>
                </aside>
            </div>
        </section>`;
}

// ───────────────────────────── Vie de la page ─────────────────────────────

/** Le dernier héros posé, pour redessiner son panneau sans tout reconstruire. */
let fzhHeroCourant = null;
let fzhHeroMinuterie = null;

function fzhHeroFavoris(poolName, username) {
    try {
        const liste = JSON.parse(localStorage.getItem('fzFavoris_' + poolName + '_' + username) || '[]');
        return Array.isArray(liste) ? liste : [];
    } catch (_) { return []; }
}

/**
 * Pose la barre et le héros dans `root` (accueil-draft.js), à leurs
 * emplacements. Le panneau de choix se remplit quand la trousse est là.
 */
function fzhHeroRendre(root, pool) {
    const { poolData, poolName, teamName } = pool;
    const username = (typeof userData !== 'undefined' && userData.username) || localStorage.getItem('username') || '';
    const modele = fzhHeroModele({ poolData, poolName, teamName, username, favoris: fzhHeroFavoris(poolName, username) });
    const precedent = fzhHeroCourant;
    // Un choix en attente de confirmation survit à un rafraîchissement du
    // même tour ; au tour suivant, il n'a plus de sens.
    const garder = precedent && precedent.poolName === poolName && modele.phase === 'onclock'
        && precedent.tour === (poolData.currentPickIndex || 0);
    fzhHeroCourant = {
        root, modele, poolData, poolName, teamName,
        tour: poolData.currentPickIndex || 0,
        candidats: garder ? precedent.candidats : null,
        enAttente: garder ? precedent.enAttente : null,
        envoi: false
    };

    const barre = root.querySelector('[data-fzh-barre]');
    const hero = root.querySelector('[data-fzh-hero]');
    if (barre) barre.innerHTML = fzhHeroBarreHTML(modele);
    if (hero) hero.innerHTML = fzhHeroHTML(modele, fzhHeroCourant.candidats, fzhHeroCourant);
    root.classList.toggle('is-onclock', modele.phase === 'onclock');
    fzhHeroMesurerEntete();
    document.title = modele.titreOnglet || FZH_HERO_TITRE;
    fzhHeroDemarrerMinuterie();

    if (['probable', 'choix'].includes(modele.panneau.type) && typeof fzdChargerBassinJoueurs === 'function') {
        const courant = fzhHeroCourant;
        fzdChargerBassinJoueurs().then(pools => {
            if (fzhHeroCourant !== courant) return;
            courant.candidats = fzhHeroCandidats({
                pools, poolData, teamName,
                favoris: fzhHeroFavoris(poolName, username),
                quotaBanc: typeof window.fzQuotaBanc === 'function' ? window.fzQuotaBanc(poolData) : 0
            });
            fzhHeroRendrePanneau();
        });
    }
}

function fzhHeroRendrePanneau() {
    const c = fzhHeroCourant;
    if (!c || !c.root.isConnected) return;
    const corps = c.root.querySelector('[data-fzh-panneau]');
    const meta = c.root.querySelector('[data-fzh-panneau-meta]');
    if (corps) corps.innerHTML = fzhHeroPanneauHTML(c.modele, c.candidats, c);
    if (meta) meta.textContent = fzhHeroMetaPanneau(c.modele, c.candidats);
}

/**
 * La barre se colle sous l'en-tête du site, dont la hauteur change avec la
 * largeur de l'écran : on la mesure plutôt que de la deviner, au rendu et à
 * chaque redimensionnement.
 */
function fzhHeroMesurerEntete() {
    const entete = document.querySelector('.navbar');
    const racine = document.getElementById('fzDraftHome');
    if (entete && racine) racine.style.setProperty('--fzh-nav', `${Math.round(entete.getBoundingClientRect().height)}px`);
    if (!fzhHeroMesurerEntete.branche) {
        fzhHeroMesurerEntete.branche = true;
        window.addEventListener('resize', fzhHeroMesurerEntete, { passive: true });
    }
}

/** Choisir, confirmer, annuler : un seul écouteur, posé une fois sur la racine. */
function fzhHeroBrancher(root) {
    if (root.dataset.fzhHeroBranche) return;
    root.dataset.fzhHeroBranche = '1';
    root.addEventListener('click', e => {
        const c = fzhHeroCourant;
        if (!c || c.envoi) return;
        const choisir = e.target.closest('[data-fzh-choisir]');
        const confirmer = e.target.closest('[data-fzh-confirmer]');
        if (choisir) {
            c.enAttente = Number(choisir.dataset.fzhChoisir);
            fzhHeroRendrePanneau();
            c.root.querySelector('[data-fzh-confirmer]')?.focus({ preventScroll: true });
        } else if (e.target.closest('[data-fzh-annuler]')) {
            const indice = c.enAttente;
            c.enAttente = null;
            fzhHeroRendrePanneau();
            c.root.querySelector(`[data-fzh-choisir="${indice}"]`)?.focus({ preventScroll: true });
        } else if (confirmer) {
            fzhHeroEnvoyerChoix(Number(confirmer.dataset.fzhConfirmer));
        }
    });
}

/**
 * Le choix, envoyé comme la salle de repêchage l'envoie (commitPlayerPick,
 * draftActif.js), avec le tour attendu : si quelqu'un a joué entre-temps,
 * le serveur refuse au lieu de prendre le joueur au mauvais tour.
 */
async function fzhHeroEnvoyerChoix(indice) {
    const c = fzhHeroCourant;
    const candidat = c && c.candidats && c.candidats[indice];
    if (!candidat) return;
    c.envoi = true;
    fzhHeroRendrePanneau();
    let refus = null;
    try {
        const base = (window.FZPool && FZPool.BASE_URL) || '';
        const reponse = await fetch(`${base}/pick-player`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clanName: c.poolName,
                playerName: candidat.nom,
                position: candidat.categorie,
                expectedPickIndex: c.tour
            })
        });
        const donnees = await reponse.json().catch(() => ({}));
        if (!reponse.ok) refus = donnees.message || 'Le choix n’a pas pu être enregistré.';
    } catch (_) {
        refus = 'Le choix n’a pas pu être envoyé. Vérifiez votre connexion et réessayez.';
    }
    if (fzhHeroCourant === c) { c.envoi = false; c.enAttente = null; }
    if (refus) {
        fzhHeroRendrePanneau();
        if (typeof fzAlert === 'function') fzAlert({ type: 'error', title: 'Choix impossible', message: refus });
    }
    // Réussi ou refusé, l'état du pool fait foi : on le relit, et l'accueil
    // se redessine (FZPool.onData → renderDash).
    if (window.FZPool) await FZPool.refresh();
}

/** Les temps qui avancent — écoulé, attente, départ — sans redessiner le héros. */
function fzhHeroDemarrerMinuterie() {
    if (fzhHeroMinuterie) return;
    fzhHeroMinuterie = setInterval(() => {
        const racine = document.getElementById('fzDraftHome');
        if (!racine) { fzhHeroArreter(); return; }
        const maintenant = Date.now();
        racine.querySelectorAll('[data-fzh-depuis]').forEach(el => {
            el.textContent = fzhHeroChrono(maintenant - Number(el.dataset.fzhDepuis));
        });
        // Choix chronométré : à zéro, le serveur choisit et l'état suit.
        racine.querySelectorAll('[data-fzh-rebours]').forEach(el => {
            el.textContent = fzhHeroChrono(Math.max(0, Number(el.dataset.fzhRebours) - maintenant));
        });
        racine.querySelectorAll('[data-fzh-eta]').forEach(el => {
            try {
                const eta = JSON.parse(el.dataset.fzhEta);
                el.textContent = fzhHeroDuree(fzhHeroAttente({ ...eta, maintenant })) || el.textContent;
            } catch (_) { /* valeur figée, rien de grave */ }
        });
        racine.querySelectorAll('[data-fzh-avant]').forEach(el => {
            el.textContent = fzhHeroAvantDebut(Date.parse(el.dataset.fzhAvant) - maintenant) || 'bientôt';
        });
    }, 1000);
}

/** Quitte l'accueil de repêchage : plus de minuterie, le titre de l'onglet revient. */
function fzhHeroArreter() {
    if (fzhHeroMinuterie) { clearInterval(fzhHeroMinuterie); fzhHeroMinuterie = null; }
    fzhHeroCourant = null;
    if (typeof document !== 'undefined') document.title = FZH_HERO_TITRE;
}
