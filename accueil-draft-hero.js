/* ============================================================
   ACCUEIL — HÉROS DU REPÊCHAGE (maquettes « Accueil · repêchage en cours »
   et « Accueil · repêchage en préparation », langage 6b Éditorial)
   ------------------------------------------------------------
   Le haut de l'accueil, du moment où le pool existe jusqu'à la fin du
   repêchage : une carte sombre (le héros), puis des cartes qui changent
   selon où l'on en est :

     pre      — le repêchage n'est pas parti : les participants, « Avant le
                début » (ce qui reste à préparer) et « Pour ta liste » ;
     waiting  — il est parti, mon tour viendra : mon choix probable ;
     next     — je suis le prochain : même carte ;
     onclock  — c'est mon tour : le héros s'allume et je peux choisir d'ici,
                en deux clics (choisir, confirmer) ;
     done     — mon dernier choix vient de passer, ou mon équipe est
                complète.

   Une fois parti, « Ma sélection » (ce qui manque à mon équipe) et
   « Derniers choix » suivent, dans tous les états.

   La limite de temps par choix n'existe que dans un repêchage à date fixe
   (pickTimeLimitMs, lib/poolOps.js) : à zéro, le serveur choisit à la
   place de l'équipe. Là, l'horloge montre le temps restant ; ailleurs, le
   temps écoulé, jamais un compte à rebours.

   Le calcul (fzhHero*) est pur : il lit l'état du pool et rend un modèle,
   que fzhHeroHTML() et ses voisines mettent en forme. Les tests l'appellent
   sans navigateur (test/unit/accueil-draft-hero.test.js).
   ============================================================ */

/** Nombre de cases de l'ordre de sélection : 4 au téléphone, 8 au bureau. */
const FZH_HERO_CASES = 8;

/** Libellés courts d'une position, en français. */
const FZH_HERO_POS = { C: 'C', L: 'AG', R: 'AD', D: 'D', G: 'G' };

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
    const { pools, poolData, teamName, favoris = [], quotaBanc = 0, nombre = 3, favorisDevant = true } = options;
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
        .sort((a, b) => (favorisDevant ? Number(b.favori) - Number(a.favori) : 0) || (valeur(b) - valeur(a)) || a.nom.localeCompare(b.nom))
        .slice(0, nombre)
        .map(c => ({
            nom: c.nom,
            code: c.code,
            categorie: c.categorie,
            favori: c.favori,
            equipe: c.kind === 'team' ? (c.rec.teamAbbrev || '') : String(c.rec.teamAbbrevs || '').split(',').pop().trim(),
            playerId: c.rec.playerId || null,
            estClub: c.kind === 'team',
            detail: fzhHeroDetail(c),
            pos: c.kind === 'team' ? 'ÉQ' : c.kind === 'goalie' ? 'G' : (FZH_HERO_POS[c.rec.positionCode] || c.rec.positionCode || ''),
            recrue: c.code === '*',
            stat: c.kind === 'skater' ? `${c.rec.points ?? '–'} pts` : `${c.rec.wins ?? '–'} V`
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
        else sous = indice === suivantMien ? 'Ton tour' : 'À venir';
        return { numero: String(indice + 1), nom: mien ? 'Toi' : equipe, sous, etat, mien };
    });
}

/** Avant le départ : les équipes inscrites, dans l'ordre s'il est connu. */
function fzhHeroCasesAvant(poolData, teamName) {
    const annonce = fzhHeroOrdreAnnonce(poolData);
    const equipes = poolData.teams || {};
    // Sans ordre connu, mon équipe d'abord, puis les autres par nom.
    const noms = annonce || Object.keys(equipes).filter(n => (equipes[n].members || []).length)
        .sort((a, b) => (Number(b === teamName) - Number(a === teamName)) || a.localeCompare(b, 'fr'));
    return noms.slice(0, FZH_HERO_CASES).map((nom, i) => {
        const membres = (equipes[nom] && equipes[nom].members) || [];
        const mien = nom === teamName;
        return {
            numero: annonce ? String(i + 1) : '',
            nom: mien ? 'Toi' : nom,
            sous: mien ? 'Inscrit' : membres[0] && membres[0] !== nom ? membres[0] : '',
            etat: 'avenir',
            mien
        };
    });
}

/**
 * Ce que l'équipe a déjà, catégorie par catégorie, et ce qui lui manque —
 * « Ma sélection ». Une catégorie que le pool ne demande pas n'apparaît pas ;
 * le banc (tête-à-tête) seulement quand il existe.
 */
function fzhHeroBesoins(poolData, teamName, quotaBanc = 0) {
    const e = (poolData.teams || {})[teamName] || {};
    const c = { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1, numTeams: 1, ...(poolData.config || {}) };
    const cases = [
        ['ATT', (e.offensive || []).length, c.numOffensive],
        ['DÉF', (e.defensive || []).length, c.numDefensive],
        ['GAR', (e.goalie || []).length, c.numGoalies],
        ['REC', (e.rookie || []).length, c.numRookies],
        ['ÉQ', (e.teams || []).length, c.numTeams],
        ['BANC', (e.bench || []).length, quotaBanc]
    ].filter(([, , max]) => max > 0).map(([libelle, n, max]) => ({ libelle, n: Math.min(n, max), max }));
    const manque = cases.filter(k => k.n < k.max).map(k => `${k.max - k.n} ${k.libelle}`);
    return {
        cases,
        total: cases.reduce((s, k) => s + k.n, 0),
        max: cases.reduce((s, k) => s + k.max, 0),
        texte: manque.length ? `Il te manque : ${manque.join(', ')}.` : 'Ton alignement est complet.'
    };
}

/**
 * Les derniers choix du repêchage, du plus récent au plus ancien. La
 * position vient de la fiche du joueur quand on l'a, sinon de sa catégorie.
 */
function fzhHeroDerniers(poolData, teamName, nombre = 3) {
    const fiche = nom => (typeof getPlayerStats === 'function' ? getPlayerStats(nom) : null) || {};
    return (poolData.picksHistory || []).slice(-nombre).reverse().map(h => {
        const club = h.position === 'teams';
        const f = club ? {} : fiche(h.player);
        const pos = club ? 'ÉQ' : h.position === 'goalie' ? 'G'
            : FZH_HERO_POS[f.position] || { defensive: 'D' }[h.position] || (h.position === 'rookie' ? 'REC' : 'ATT');
        return {
            numero: String((h.pickIndex ?? 0) + 1),
            nom: h.player,
            equipe: club ? (typeof fzhClubAbbrev === 'function' ? fzhClubAbbrev(h.player) : '') : (f.teamAbbrev || ''),
            playerId: f.playerId || null,
            estClub: club,
            pos,
            par: h.team === teamName ? 'Toi' : h.team,
            mien: h.team === teamName
        };
    });
}

/**
 * Le modèle du héros. Tout ce qui s'affiche en sort ; rien n'y est inventé :
 * chaque chiffre vient du pool, et une estimation sans assez de recul cède
 * la place au nombre de choix.
 *
 * L'horloge du héros suit toujours le tour en cours : le temps restant d'un
 * choix chronométré, sinon le temps écoulé depuis le début du tour.
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
        phase, poolName, salle,
        meta: `${poolName} · ${participants.length} participant${participants.length > 1 ? 's' : ''} · ${rondes} rondes`
    };

    if (phase === 'pre') return { ...base, ...fzhHeroAvant({ poolData, teamName, username, maintenant, favoris, inscrites, participants, salon }) };

    const ordre = poolData.draftOrder;
    const tour = poolData.currentPickIndex || 0;
    const nbEquipes = new Set(ordre).size || 1;
    const ronde = indice => Math.floor(indice / nbEquipes) + 1;
    const prochain = ordre.indexOf(teamName, tour);
    const avant = prochain < 0 ? null : prochain - tour;
    const auChoix = ordre[tour];
    const depuis = Number(poolData.turnStartedAt) || null;
    const limite = Number(poolData.pickTimeLimitMs) || 0;
    const echeance = limite && depuis ? depuis + limite : null;
    const rythme = fzhHeroRythme(poolData.picksHistory);
    const attente = fzhHeroAttente({ avant, rythme, depuis, maintenant });
    const monTour = prochain < 0 ? '' : `choix ${prochain + 1} · Ronde ${ronde(prochain)}`;
    const commun = {
        cases: fzhHeroCases(poolData, teamName),
        ordreDetail: `Ronde ${ronde(tour)} · choix ${tour + 1} / ${ordre.length}`,
        temps: echeance
            ? { libelle: 'Restant', rebours: echeance, valeur: fzhHeroChrono(Math.max(0, echeance - maintenant)) }
            : { libelle: 'Écoulé', chrono: depuis, valeur: fzhHeroChrono(depuis ? maintenant - depuis : 0) },
        cta: { libelle: 'Suivre le repêchage', href: salle },
        panneau: { type: 'probable', titre: 'Ton choix probable', note: 'Classement mis à jour à chaque choix.', salle }
    };

    if (phase === 'onclock') {
        return {
            ...base, ...commun,
            puce: "C'est ton tour",
            vif: true,
            titre: 'À toi de choisir',
            sousTitre: `Ronde ${ronde(tour)} · Choix ${tour + 1} / ${ordre.length} · ${poolName}`,
            cta: { libelle: 'Ouvrir le repêchage', href: salle },
            panneau: { type: 'choix', titre: 'Choisis en un clic', salle, tour, auto: !!echeance },
            titreOnglet: "(C'est ton tour !) Fantazy"
        };
    }

    if (phase === 'next') {
        return {
            ...base, ...commun,
            puce: 'Tu es le prochain',
            titre: `${auChoix} choisit`,
            sousTitre: `Ton tour : ${monTour}`,
            cta: { libelle: 'Rejoindre le repêchage', href: salle },
            panneau: { ...commun.panneau, suivant: auChoix },
            titreOnglet: '(Tu es le prochain) Fantazy'
        };
    }

    if (phase === 'done') {
        if (prochain < 0) {
            const restants = ordre.length - tour;
            return {
                ...base, ...commun,
                puce: 'Repêchage en cours',
                titre: 'Ton équipe est complète',
                sousTitre: `Le repêchage se poursuit : encore ${restants} choix.`,
                panneau: null
            };
        }
        const miens = (poolData.picksHistory || []).filter(h => h.team === teamName);
        const dernier = miens[miens.length - 1];
        return {
            ...base, ...commun,
            puce: 'Choix confirmé',
            titre: `${fzhHeroNomFamille(dernier.player, dernier.position === 'teams')} est à toi`,
            sousTitre: `Ton prochain tour : ${monTour}`
        };
    }

    return {
        ...base, ...commun,
        puce: 'En attente',
        titre: `${auChoix} choisit`,
        sousTitre: `Ton prochain tour : ${monTour}`,
        // L'attente estimée avance seule (data-fzh-eta) ; sans rythme connu,
        // le nombre de choix d'ici là.
        attente: attente == null
            ? { valeur: `dans ${avant} choix` }
            : { valeur: fzhHeroDuree(attente), eta: { avant, rythme, depuis } }
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
    const pair = poolData.poolMode === 'head-to-head';
    const pret = inscrites.length >= 2 && (!pair || inscrites.length % 2 === 0);
    const heure = prevu ? fzhHeroHeure(prevu, maintenant) : '';
    const bientot = prevu ? fzhHeroAvantDebut(restant) : null;

    // Trois favoris au moins : de quoi choisir même si les deux premiers partent.
    // En repêchage automatique, Fantazy choisit pour tout le monde : pas de liste à préparer.
    const auto = poolData.draftAuto === true;
    const liste = favoris.length;
    const etapes = [
        !auto && {
            ok: liste >= FZH_HERO_LISTE_MIN,
            titre: 'Ta liste de favoris',
            detail: liste >= FZH_HERO_LISTE_MIN ? `${liste} joueurs ajoutés`
                : `Ajoute au moins ${FZH_HERO_LISTE_MIN} joueurs que tu vises (${liste}/${FZH_HERO_LISTE_MIN})`,
            action: liste >= FZH_HERO_LISTE_MIN ? null : { libelle: 'Préparer', href: 'stats.html' }
        },
        {
            ok: pret,
            titre: 'Participants',
            detail: `${inscrites.length} équipe${inscrites.length > 1 ? 's' : ''} inscrite${inscrites.length > 1 ? 's' : ''}`
                + (inscrites.length < 2 ? ' · il en faut au moins 2' : !pret ? ' · il en faut un nombre pair' : ''),
            action: jeSuisCreateur && !pret ? { libelle: 'Inviter', href: salon } : null
        },
        {
            ok: !!prevu,
            titre: 'Départ',
            detail: prevu ? `${heure.includes(',') ? heure : `Aujourd'hui, ${heure}`} · automatique`
                : jeSuisCreateur ? 'Fixe une date ou lance-le toi-même'
                : `${createur || 'Le créateur du pool'} lancera le repêchage`,
            action: jeSuisCreateur ? { libelle: prevu ? 'Changer' : 'Organiser', href: salon } : null
        }
    ].filter(Boolean);

    return {
        puce: 'Bientôt',
        titre: prevu ? (bientot ? 'Le repêchage commence ' : 'Le repêchage va commencer') : 'Repêchage en préparation',
        compteARebours: prevu && bientot ? { iso: prevu, texte: bientot } : null,
        sousTitre: null,
        // La personne qui a créé le pool va droit à l'organisation (mode, début, ordre, lancement).
        cta: jeSuisCreateur ? { libelle: 'Organiser le pool', href: salon }
            : auto ? { libelle: 'Voir les joueurs', href: 'stats.html' } : { libelle: 'Préparer ma liste', href: 'stats.html' },
        temps: { libelle: 'Début', valeur: prevu ? heure : (jeSuisCreateur ? 'Quand tu veux' : 'À confirmer'), avant: true },
        cases: fzhHeroCasesAvant(poolData, teamName),
        ordreTitre: annonce ? 'Ordre de sélection' : 'Participants',
        ordreDetail: annonce ? 'Ronde 1' : 'Ordre tiré au hasard',
        inviter: true,
        panneau: { type: 'avant', titre: 'Avant le début', meta: `${etapes.filter(e => e.ok).length} sur ${etapes.length}`, etapes },
        liste: auto ? null : { titre: 'Pour ta liste', favoris: liste }
    };
}

// ───────────────────────────── Rendu ─────────────────────────────

/** Les pictogrammes des en-têtes, au trait, comme ceux de l'accueil de saison. */
const FZH_HERO_ICONES = {
    eclair: '<path d="m13 2-9 12h7l-1 8 10-13h-8Z"/>',
    equipe: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20v-1.5a6 6 0 0 1 12 0V20M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4.5V20"/>',
    historique: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    liste: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5"/>',
    etoile: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    coche: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    inviter: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20v-1.5a6 6 0 0 1 12 0V20M19 8v6M16 11h6"/>',
    fleche: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>'
};

/** Trois favoris au moins avant le départ (« Avant le début »). */
const FZH_HERO_LISTE_MIN = 3;

function fzhHeroEsc(texte) {
    return typeof escapeHTML === 'function'
        ? escapeHTML(texte)
        : String(texte ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function fzhHeroIcone(nom, taille = 22) {
    return `<svg class="fzs-ico" width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${FZH_HERO_ICONES[nom] || ''}</svg>`;
}

/** L'en-tête d'une carte : pictogramme, titre, et un mot à droite. */
function fzhHeroTete(icone, titre, droite, id) {
    return `<header class="fzs-sh">${fzhHeroIcone(icone)}<h2${id ? ` id="${id}"` : ''}>${fzhHeroEsc(titre)}</h2>${droite ? `<span class="fzh-sh-meta">${fzhHeroEsc(droite)}</span>` : ''}</header>`;
}

function fzhHeroPied(href, libelle) {
    return `<a class="fzs-foot" href="${fzhHeroEsc(href)}">${fzhHeroEsc(libelle)}${fzhHeroIcone('chevron', 18)}</a>`;
}

/** C, AG, AD, D, G, ÉQ : une pastille à la couleur de la position. */
function fzhHeroPos(pos) {
    const cle = { 'ÉQ': 'eq', REC: 'rec', ATT: 'att' }[pos] || String(pos || '').toLowerCase();
    return pos ? `<span class="fzh-pos is-${cle}">${fzhHeroEsc(pos)}</span>` : '';
}

function fzhHeroCasesHTML(cases) {
    return cases.map(k => `<li class="fzh-case is-${k.etat}${k.mien ? ' is-mine' : ''}">
                ${k.numero ? `<span class="fzh-case-num">${fzhHeroEsc(k.numero)}</span>` : ''}
                <span class="fzh-case-nom">${fzhHeroEsc(k.nom)}</span>
                <span class="fzh-case-sous">${fzhHeroEsc(k.sous)}</span>
            </li>`).join('');
}

/** La photo, et le logo du club en médaillon. */
function fzhHeroVisage(c) {
    const photo = typeof offPlayerFaceHTML === 'function' && !c.estClub
        ? offPlayerFaceHTML(c.nom, c.equipe, c.playerId)
        : c.estClub && c.equipe
            ? `<span class="fzd-off-face"><img src="teams/${fzhHeroEsc(c.equipe)}.png" alt="" loading="lazy" onerror="this.remove()"></span>`
            : `<span class="fzd-off-face">${fzhHeroEsc((c.nom || '?').charAt(0))}</span>`;
    const logo = c.equipe && !c.estClub
        ? `<img class="fzh-logo" src="teams/${fzhHeroEsc(c.equipe)}.png" alt="" loading="lazy" onerror="this.remove()">` : '';
    return `<span class="fzh-face">${photo}${logo}</span>`;
}

/** Une ligne de joueur proposé : au choix (Choisir), probable, ou pour la liste (+). */
function fzhHeroCandidatHTML(c, i, options) {
    const { mode = 'probable', enAttente = false, envoi = false } = options || {};
    const choix = mode === 'choix';
    const sous = [c.equipe, c.stat || c.detail, c.recrue ? 'Recrue' : ''].filter(Boolean).join(' · ');
    let action = '';
    if (choix && !enAttente) action = `<button type="button" class="fzh-cand-choisir" data-fzh-choisir="${i}"${envoi ? ' disabled' : ''}>Choisir</button>`;
    else if (mode === 'probable' && i === 0) action = '<span class="fzh-cand-tag">Probable</span>';
    else if (mode === 'liste') {
        action = `<button type="button" class="fzh-cand-fav${c.favori ? ' is-on' : ''}" data-fzh-favori="${fzhHeroEsc(c.nom)}" aria-pressed="${c.favori}" aria-label="${c.favori ? 'Retirer de ma liste' : 'Ajouter à ma liste'} : ${fzhHeroEsc(c.nom)}">${fzhHeroIcone(c.favori ? 'coche' : 'plus', 20)}</button>`;
    }
    const etoile = c.favori && mode !== 'liste' ? ' <b class="fzh-cand-etoile" title="Dans ta liste">★</b>' : '';
    const ligne = `<div class="fzs-row">
                ${fzhHeroVisage(c)}
                <span class="fzs-row-txt"><span class="fzs-row-name">${fzhHeroEsc(c.nom)}${etoile}</span><span class="fzs-row-sub">${fzhHeroPos(c.pos)}${fzhHeroEsc(sous)}</span></span>
                ${action}
            </div>`;
    const confirmer = choix && enAttente ? `<div class="fzh-cand-confirmer">
                <button type="button" class="fzh-cand-ok" data-fzh-confirmer="${i}"${envoi ? ' disabled' : ''}>${envoi ? 'Envoi…' : `Confirmer ${fzhHeroEsc(fzhHeroNomFamille(c.nom, c.estClub).toUpperCase())}`}</button>
                <button type="button" class="fzh-cand-annuler" data-fzh-annuler${envoi ? ' disabled' : ''}>Annuler</button>
            </div>` : '';
    return `<li class="fzh-cand${enAttente ? ' is-pending' : ''}">${ligne}${confirmer}</li>`;
}

function fzhHeroMetaPanneau(modele, candidats) {
    const p = modele.panneau;
    if (p.meta) return p.meta;
    if (!candidats) return '';
    if (candidats.some(c => c.favori)) return 'Selon ta liste';
    return p.type === 'choix' ? 'Selon tes besoins' : 'Meilleurs disponibles';
}

/** Des lignes grises, le temps que la trousse arrive. */
function fzhHeroOsHTML(n) {
    return Array.from({ length: n }, () => '<li class="fzs-row is-bone"><span class="fzd-off-face"></span><span class="fzs-row-txt"><span></span><span></span></span></li>').join('');
}

/** Une étape d'« Avant le début » : faite (coche verte) ou à faire. */
function fzhHeroEtapeHTML(e) {
    const action = e.action ? `<a class="fzh-etape-action" href="${fzhHeroEsc(e.action.href)}">${fzhHeroEsc(e.action.libelle)}${fzhHeroIcone('chevron', 18)}</a>` : '';
    return `<li class="fzs-row fzh-etape${e.ok ? ' is-ok' : ''}">
                <span class="fzh-etape-puce" aria-hidden="true">${e.ok ? fzhHeroIcone('coche', 16) : ''}</span>
                <span class="fzs-row-txt"><span class="fzs-row-name">${fzhHeroEsc(e.titre)}</span><span class="fzh-etape-detail">${fzhHeroEsc(e.detail)}</span></span>
                <span class="fzh-sr">${e.ok ? 'Prêt' : 'À faire'}</span>
                ${action}
            </li>`;
}

/**
 * La carte principale sous le héros : « Choisis en un clic » (mon tour),
 * « Ton choix probable » (en attente) ou « Avant le début » (pas parti).
 * `candidats` : null tant que la trousse charge.
 */
function fzhHeroPanneauHTML(modele, candidats, etatChoix) {
    const { enAttente = null, envoi = false } = etatChoix || {};
    const p = modele.panneau;
    if (!p) return '';
    if (p.type === 'avant') {
        const faits = p.etapes.filter(e => e.ok).length;
        const etapes = p.etapes.map(fzhHeroEtapeHTML).join('');
        return `<section class="fzs-sec fzh-avant" aria-labelledby="fzhPanneauTitre">
            ${fzhHeroTete('liste', p.titre, p.meta, 'fzhPanneauTitre')}
            <div class="fzh-jauge" role="progressbar" aria-valuemin="0" aria-valuemax="${p.etapes.length}" aria-valuenow="${faits}" aria-label="Préparation"><i style="width:${Math.round(faits / p.etapes.length * 100)}%"></i></div>
            <ul class="fzs-list fzh-etapes">${etapes}</ul>
        </section>`;
    }

    const choix = p.type === 'choix';
    let corps;
    if (!candidats) corps = `<ol class="fzs-list fzh-cands" aria-label="Chargement des joueurs">${fzhHeroOsHTML(3)}</ol><p class="fzh-sr">Chargement des joueurs…</p>`;
    else if (!candidats.length) corps = '<p class="fzs-empty">Aucun joueur disponible dans tes catégories ouvertes.</p>';
    else {
        corps = `<ol class="fzs-list fzh-cands">${candidats.map((c, i) => fzhHeroCandidatHTML(c, i, { mode: choix ? 'choix' : 'probable', enAttente: enAttente === i, envoi })).join('')}</ol>`;
        const note = choix
            ? (p.auto ? 'À zéro, Fantazy prend le meilleur joueur disponible.' : '')
            : p.suivant && candidats[1]
                ? `Si ${p.suivant} prend ${fzhHeroNomFamille(candidats[0].nom, candidats[0].estClub)}, ${fzhHeroNomFamille(candidats[1].nom, candidats[1].estClub)} passe en tête.`
                : p.note;
        if (note) corps += `<p class="fzh-note">${fzhHeroEsc(note)}</p>`;
    }
    return `<section class="fzs-sec fzh-choix" aria-labelledby="fzhPanneauTitre">
            ${fzhHeroTete(choix ? 'eclair' : 'etoile', p.titre, fzhHeroMetaPanneau(modele, candidats), 'fzhPanneauTitre')}
            <div aria-live="polite">${corps}</div>
            ${fzhHeroPied(p.salle, choix ? 'Tous les disponibles' : 'Ma liste')}
        </section>`;
}

/** « Pour ta liste » : les meilleurs disponibles, à ajouter d'un clic. */
function fzhHeroListeHTML(modele, candidats) {
    const l = modele.liste;
    if (!l) return '';
    const corps = !candidats
        ? `<ul class="fzs-list fzh-cands">${fzhHeroOsHTML(4)}</ul>`
        : candidats.length
            ? `<ul class="fzs-list fzh-cands">${candidats.map((c, i) => fzhHeroCandidatHTML(c, i, { mode: 'liste' })).join('')}</ul>`
            : '<p class="fzs-empty">Les joueurs arrivent dès que la trousse est prête.</p>';
    return `<section class="fzs-sec fzh-liste" aria-labelledby="fzhListeTitre">
            ${fzhHeroTete('etoile', l.titre, `${l.favoris} favori${l.favoris > 1 ? 's' : ''}`, 'fzhListeTitre')}
            ${corps}
            ${fzhHeroPied('stats.html', 'Tous les joueurs')}
        </section>`;
}

/** « Ma sélection » : où en est mon équipe, catégorie par catégorie. */
function fzhHeroBesoinsHTML(besoins, salle) {
    const cases = besoins.cases.map(k => `<li class="${k.n >= k.max ? 'is-full' : ''}"><span>${fzhHeroEsc(k.libelle)}</span><strong>${k.n}/${k.max}</strong></li>`).join('');
    return `<section class="fzs-sec fzh-besoins" aria-labelledby="fzhBesoinsTitre">
            ${fzhHeroTete('equipe', 'Ma sélection', `${besoins.total} / ${besoins.max}`, 'fzhBesoinsTitre')}
            <ul class="fzh-besoins-grille" style="--n:${besoins.cases.length}">${cases}</ul>
            <p class="fzh-besoins-txt">${fzhHeroEsc(besoins.texte)}</p>
            ${fzhHeroPied(salle, 'Voir mon alignement')}
        </section>`;
}

function fzhHeroDernierHTML(d) {
    return `<li class="fzs-row${d.mien ? ' is-mine' : ''}">
                <span class="fzh-dernier-num">${fzhHeroEsc(d.numero)}</span>
                ${fzhHeroVisage(d)}
                <span class="fzs-row-txt"><span class="fzs-row-name">${fzhHeroEsc(d.nom)}</span><span class="fzs-row-sub">${fzhHeroEsc(d.par)}</span></span>
                ${fzhHeroPos(d.pos)}
            </li>`;
}

/** « Derniers choix » : les trois derniers, le mien en vert. */
function fzhHeroDerniersHTML(derniers) {
    const lignes = derniers.length
        ? `<ol class="fzs-list fzh-derniers">${derniers.map(fzhHeroDernierHTML).join('')}</ol>`
        : '<p class="fzs-empty">Aucun choix pour l’instant.</p>';
    return `<section class="fzs-sec fzh-recents" aria-labelledby="fzhDerniersTitre">
            ${fzhHeroTete('historique', 'Derniers choix', '', 'fzhDerniersTitre')}
            ${lignes}
        </section>`;
}

function fzhHeroHTML(modele) {
    const t = modele.temps;
    const titre = modele.compteARebours
        ? `${fzhHeroEsc(modele.titre)}<span data-fzh-avant="${fzhHeroEsc(modele.compteARebours.iso)}">${fzhHeroEsc(modele.compteARebours.texte)}</span>`
        : fzhHeroEsc(modele.titre);
    const valeur = t.rebours
        ? `<strong data-fzh-rebours="${t.rebours}">${fzhHeroEsc(t.valeur)}</strong>`
        : t.chrono
            ? `<strong data-fzh-depuis="${t.chrono}">${fzhHeroEsc(t.valeur)}</strong>`
            : `<strong>${fzhHeroEsc(t.valeur)}</strong>`;
    const a = modele.attente;
    const sous = modele.sousTitre == null ? fzhHeroEsc(modele.meta)
        : fzhHeroEsc(modele.sousTitre) + (a ? ` · <span${a.eta ? ` data-fzh-eta="${fzhHeroEsc(JSON.stringify(a.eta))}"` : ''}>${fzhHeroEsc(a.valeur)}</span>` : '');
    const n = modele.cases.length;
    const inviter = modele.inviter
        ? `<li class="fzh-case is-inviter" style="--reste:${(4 - n % 4) || 4};--reste-large:${(8 - n % 8) || 8}"><button type="button" data-fzh-inviter="${fzhHeroEsc(modele.poolName)}">${fzhHeroIcone('inviter', 18)}<span>Inviter</span></button></li>` : '';
    return `
        <section class="fzh-hero is-${modele.phase}${modele.vif ? ' is-vif' : ''}" aria-labelledby="fzhHeroTitre">
            <div class="fzh-hero-haut">
                <div class="fzh-hero-copie">
                    <span class="fzh-puce">${modele.vif ? '<i class="fzs-dot" aria-hidden="true"></i>' : modele.phase === 'pre' ? '<i class="fzh-point" aria-hidden="true"></i>' : ''}${fzhHeroEsc(modele.puce)}</span>
                    <h1 id="fzhHeroTitre">${titre}</h1>
                    <p>${sous}</p>
                </div>
                <div class="fzh-horloge${t.avant ? ' is-avant' : ''}">${t.avant ? `<span>${fzhHeroEsc(t.libelle)}</span>${valeur}` : `${valeur}<span>${fzhHeroEsc(t.libelle)}</span>`}</div>
            </div>
            <div class="fzh-ordre">
                ${modele.ordreTitre ? `<div class="fzh-ordre-tete"><span>${fzhHeroEsc(modele.ordreTitre)}</span><span>${fzhHeroEsc(modele.ordreDetail)}</span></div>` : ''}
                <ol class="fzh-cases" aria-label="Ordre de sélection">${fzhHeroCasesHTML(modele.cases)}${inviter}</ol>
            </div>
            <a class="fzh-hero-cta" href="${fzhHeroEsc(modele.cta.href)}">${fzhHeroEsc(modele.cta.libelle)}${fzhHeroIcone('fleche', 20)}</a>
        </section>`;
}

// ───────────────────────────── Vie de la page ─────────────────────────────

/** Le dernier héros posé, pour redessiner ses cartes sans tout reconstruire. */
let fzhHeroCourant = null;
let fzhHeroMinuterie = null;

function fzhHeroCleFavoris(poolName, username) {
    return 'fzFavoris_' + poolName + '_' + username;
}

/** Les favoris de la salle de repêchage (draftFavorites.js) : même clé, même liste. */
function fzhHeroFavoris(poolName, username) {
    try {
        const liste = JSON.parse(localStorage.getItem(fzhHeroCleFavoris(poolName, username)) || '[]');
        return Array.isArray(liste) ? liste : [];
    } catch (_) { return []; }
}

function fzhHeroUtilisateur() {
    return (typeof userData !== 'undefined' && userData.username) || localStorage.getItem('username') || '';
}

/**
 * Pose le héros et ses cartes dans `root` (accueil-draft.js), à leurs
 * emplacements. Les joueurs proposés arrivent quand la trousse est là.
 */
function fzhHeroRendre(root, pool) {
    const { poolData, poolName, teamName } = pool;
    const username = fzhHeroUtilisateur();
    const modele = fzhHeroModele({ poolData, poolName, teamName, username, favoris: fzhHeroFavoris(poolName, username) });
    const precedent = fzhHeroCourant;
    // Un choix en attente de confirmation survit à un rafraîchissement du
    // même tour ; au tour suivant, il n'a plus de sens.
    const garder = precedent && precedent.poolName === poolName && modele.phase === 'onclock'
        && precedent.tour === (poolData.currentPickIndex || 0);
    fzhHeroCourant = {
        root, modele, poolData, poolName, teamName, username,
        tour: poolData.currentPickIndex || 0,
        candidats: garder ? precedent.candidats : null,
        suggestions: null,
        enAttente: garder ? precedent.enAttente : null,
        envoi: false
    };

    const hero = root.querySelector('[data-fzh-hero]');
    if (hero) hero.innerHTML = fzhHeroHTML(modele);
    fzhHeroRendrePanneau();
    document.title = modele.titreOnglet || FZH_HERO_TITRE;
    fzhHeroDemarrerMinuterie();

    const veutCandidats = modele.panneau && ['probable', 'choix'].includes(modele.panneau.type);
    if ((veutCandidats || modele.liste) && typeof fzdChargerBassinJoueurs === 'function') {
        const courant = fzhHeroCourant;
        fzdChargerBassinJoueurs().then(pools => {
            if (fzhHeroCourant !== courant) return;
            courant.pools = pools;
            fzhHeroCalculer(courant);
            fzhHeroRendrePanneau();
        });
    }
}

function fzhHeroCalculer(c) {
    const favoris = fzhHeroFavoris(c.poolName, c.username);
    const quotaBanc = typeof window.fzQuotaBanc === 'function' ? window.fzQuotaBanc(c.poolData) : 0;
    const commun = { pools: c.pools, poolData: c.poolData, teamName: c.teamName, favoris, quotaBanc };
    if (c.modele.panneau && c.modele.panneau.type !== 'avant') c.candidats = fzhHeroCandidats(commun);
    if (c.modele.liste) c.suggestions = fzhHeroCandidats({ ...commun, nombre: 4, favorisDevant: false });
}

function fzhHeroRendrePanneau() {
    const c = fzhHeroCourant;
    if (!c || !c.root.isConnected) return;
    const principal = c.root.querySelector('[data-fzh-panneau]');
    const liste = c.root.querySelector('[data-fzh-liste]');
    if (principal) principal.innerHTML = fzhHeroPanneauHTML(c.modele, c.candidats, c);
    if (liste) liste.innerHTML = fzhHeroListeHTML(c.modele, c.suggestions);
}

/** Ajoute ou retire un favori, puis remet la liste et « Avant le début » à jour. */
function fzhHeroBasculerFavori(nom) {
    const c = fzhHeroCourant;
    if (!c || !nom) return;
    const cle = fzhHeroCleFavoris(c.poolName, c.username);
    const liste = fzhHeroFavoris(c.poolName, c.username);
    const i = liste.indexOf(nom);
    if (i >= 0) liste.splice(i, 1); else liste.push(nom);
    try { localStorage.setItem(cle, JSON.stringify(liste)); } catch (_) { /* navigation privée */ }
    c.modele = fzhHeroModele({ poolData: c.poolData, poolName: c.poolName, teamName: c.teamName, username: c.username, favoris: liste });
    if (c.pools) fzhHeroCalculer(c);
    fzhHeroRendrePanneau();
    c.root.querySelector(`[data-fzh-favori="${CSS.escape(nom)}"]`)?.focus({ preventScroll: true });
}

/** Choisir, confirmer, annuler, favori, inviter : un seul écouteur, posé une fois sur la racine. */
function fzhHeroBrancher(root) {
    if (root.dataset.fzhHeroBranche) return;
    root.dataset.fzhHeroBranche = '1';
    root.addEventListener('click', e => {
        const inviter = e.target.closest('[data-fzh-inviter]');
        if (inviter) {
            // La feuille de partage du téléphone, sinon le presse-papiers (accueil-mobile.js).
            if (typeof fzmInviter === 'function') { inviter.dataset.fzmInviter = inviter.dataset.fzhInviter; fzmInviter(inviter); }
            return;
        }
        const favori = e.target.closest('[data-fzh-favori]');
        if (favori) { fzhHeroBasculerFavori(favori.dataset.fzhFavori); return; }
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

/** Les temps qui avancent — écoulé, restant, attente, départ — sans redessiner le héros. */
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
