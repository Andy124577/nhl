/**
 * Le bilan de la soirée : ce que les matchs d'une journée ont rapporté à une
 * équipe de pool, une fois TOUS ces matchs terminés.
 *
 * La fenêtre surgit après le dernier coup de sifflet (bilanSoiree.js côté
 * page) : une carte par joueur qui a joué, le total qui grimpe, puis le
 * mouvement au classement (cumulatif) ou le duel de la semaine (tête-à-tête).
 *
 * La soirée racontée est la plus récente qui soit finie : celle du jour dès
 * que son dernier match est terminé, sinon celle de la veille. Un match de
 * la côte Ouest fini à 1 h appartient à la veille (la LNH date ses matchs) :
 * tant qu'il joue, aucune des deux n'est prête, et la page réessaie.
 *
 * Pur : ni réseau, ni horloge.
 */

'use strict';

const scoring = require('./scoring.js');

const SAISON_REGULIERE = 2;
const ETATS_FINIS = new Set(['FINAL', 'OFF']);
const ETATS_EN_JEU = new Set(['LIVE', 'CRIT']);
/** Un match reporté ou annulé ne se jouera pas ce soir : il ne retient pas le bilan. */
const ETATS_ANNULES = new Set(['PPD', 'CNCL', 'SUSP']);

/** Des matchs se jouent : la page revient voir dans cinq minutes. */
const REESSAI_EN_JEU_MS = 5 * 60 * 1000;
/** Rien ne joue (matinée, après-midi) : une demi-heure suffit. */
const REESSAI_CALME_MS = 30 * 60 * 1000;

const jourDuMatch = m => (m && typeof m.gameDate === 'string' ? m.gameDate.slice(0, 10) : null);

function deLaJournee(m, jour, saison) {
    if (!m || Number(m.gameType) !== SAISON_REGULIERE || jourDuMatch(m) !== jour) return false;
    return !(saison && m.season && Number(m.season) !== Number(saison));
}

/**
 * Où en sont les matchs de saison régulière d'une journée :
 * { prevus, finis, enJeu, terminee } — `terminee` seulement s'il y en avait
 * au moins un et qu'ils sont tous finis. Une journée sans match n'a pas de
 * bilan.
 */
function etatDeLaSoiree(matchs, jour, saison = null) {
    let prevus = 0, finis = 0, enJeu = 0;
    for (const m of Array.isArray(matchs) ? matchs : []) {
        if (!deLaJournee(m, jour, saison) || ETATS_ANNULES.has(m.gameState)) continue;
        prevus += 1;
        if (ETATS_FINIS.has(m.gameState)) finis += 1;
        else if (ETATS_EN_JEU.has(m.gameState)) enJeu += 1;
    }
    return { prevus, finis, enJeu, terminee: prevus > 0 && finis === prevus };
}

/**
 * La soirée à raconter : aujourd'hui si elle est finie, sinon hier si elle
 * l'est, sinon aucune (null).
 */
function choisirSoiree({ aujourdhui, hier, etatAujourdhui, etatHier }) {
    if (etatAujourdhui && etatAujourdhui.terminee) return aujourdhui;
    if (etatHier && etatHier.terminee) return hier;
    return null;
}

/**
 * Quand la page doit redemander : jamais si la soirée du jour est déjà
 * racontable (il n'y en aura pas d'autre avant demain), vite si un match
 * joue, sinon dans une demi-heure.
 */
function delaiAvantReessai(etatAujourdhui, etatHier) {
    if (etatAujourdhui && etatAujourdhui.terminee) return null;
    const enJeu = (etatAujourdhui ? etatAujourdhui.enJeu : 0) + (etatHier ? etatHier.enJeu : 0);
    return enJeu > 0 ? REESSAI_EN_JEU_MS : REESSAI_CALME_MS;
}

/**
 * La soirée d'un club de la LNH repêché : son match fini de la journée, et
 * ce qu'il rapporte au cumulatif (2 par victoire, 1 par défaite en
 * prolongation ou en tirs de barrage). null s'il n'a pas joué.
 */
function soireeDuClub(matchs, abbrev, jour, saison = null) {
    const club = String(abbrev || '').toUpperCase();
    if (!club) return null;
    const m = (Array.isArray(matchs) ? matchs : []).find(x => deLaJournee(x, jour, saison)
        && ETATS_FINIS.has(x.gameState)
        && [x.awayTeam && x.awayTeam.abbrev, x.homeTeam && x.homeTeam.abbrev].includes(club));
    if (!m) return null;

    const domicile = m.homeTeam.abbrev === club;
    const nous = domicile ? m.homeTeam : m.awayTeam;
    const eux = domicile ? m.awayTeam : m.homeTeam;
    const type = (m.gameOutcome && m.gameOutcome.lastPeriodType)
        || (m.periodDescriptor && m.periodDescriptor.periodType) || 'REG';
    const prolongation = type === 'OT' || type === 'SO';
    const pour = Number(nous.score) || 0, contre = Number(eux.score) || 0;

    let issue = 'D';
    if (pour > contre) issue = 'V';
    else if (prolongation) issue = 'DP';
    return {
        issue,
        pour,
        contre,
        adversaire: eux.abbrev || '',
        domicile,
        prolongation: prolongation ? type : null,
        points: scoring.clubPoolPoints({ wins: issue === 'V' ? 1 : 0, otLosses: issue === 'DP' ? 1 : 0 })
    };
}

/**
 * Le rang de chaque équipe avant et après la soirée, au cumulatif.
 *
 *   equipes : dans l'ordre du classement actuel —
 *             [{ teamName, total, soiree, apres }]
 *             total  : le Total affiché (relevés + direct) ;
 *             soiree : les points de la soirée racontée ;
 *             apres  : ceux marqués depuis (la soirée en cours, quand on
 *                      raconte celle d'hier pendant les matchs du jour).
 *
 * « Après » classe le total moins ce qui a suivi la soirée ; « avant »
 * retire en plus la soirée. À égalité, l'ordre actuel est gardé — comme la
 * pastille du classement (rangsAvantSoiree, classement.js) : une égalité ne
 * fait bouger personne sans un point marqué.
 *
 * Renvoie { avant: Map(nom → rang), apres: Map(nom → rang) }.
 */
function rangsDeLaSoiree(equipes) {
    const liste = Array.isArray(equipes) ? equipes : [];
    const classer = valeur => {
        const rangs = new Map();
        liste
            .map((e, ordre) => ({ nom: e.teamName, ordre, v: valeur(e) }))
            .sort((a, b) => (b.v - a.v) || (a.ordre - b.ordre))
            .forEach((e, i) => rangs.set(e.nom, i + 1));
        return rangs;
    };
    const apres = e => (Number(e.total) || 0) - (Number(e.apres) || 0);
    return {
        avant: classer(e => apres(e) - (Number(e.soiree) || 0)),
        apres: classer(apres)
    };
}

/**
 * Le rang de chaque équipe au tête-à-tête : victoires, puis différentiel —
 * computeStandings (classement.js). À égalité parfaite, l'ordre du pool.
 *
 *   equipes   : les noms d'équipe, dans l'ordre du pool ;
 *   standings : h2hData.standings.
 */
function rangsH2H(equipes, standings) {
    const fiche = nom => (standings && standings[nom]) || {};
    const rangs = new Map();
    (Array.isArray(equipes) ? equipes : [])
        .map((nom, ordre) => {
            const s = fiche(nom);
            return { nom, ordre, v: Number(s.wins) || 0, ecart: (Number(s.pointsFor) || 0) - (Number(s.pointsAgainst) || 0) };
        })
        .sort((a, b) => (b.v - a.v) || (b.ecart - a.ecart) || (a.ordre - b.ordre))
        .forEach((e, i) => rangs.set(e.nom, i + 1));
    return rangs;
}

/** 'W', 'L' ou 'T' pour l'équipe qui a `nous` points contre `eux`. */
function issueDuDuel(nous, eux) {
    const a = scoring.arrondi(Number(nous) || 0), b = scoring.arrondi(Number(eux) || 0);
    if (a === b) return 'T';
    return a > b ? 'W' : 'L';
}

/**
 * Le nom qu'une équipe porte à l'écran : « Équipe 3 » laisse place à ses
 * membres (« alex et sam »), comme au classement (getDisplayName).
 */
function nomAffiche(cle, membres) {
    if (/^Équipe \d+$/.test(String(cle)) && Array.isArray(membres) && membres.length > 0) {
        const auto = membres.join(' et ');
        if (auto.length <= 30) return auto;
    }
    return cle;
}

/**
 * La décision d'un gardien pour la soirée : 'BL' (victoire par
 * blanchissage), 'V', 'DP' (défaite en prolongation), 'D', ou null s'il n'a
 * pas de décision connue. `decisions` : celles de ses feuilles de match
 * ('W', 'L', 'O', 'OTL').
 */
function decisionDuGardien({ victoires = 0, blanchissages = 0, decisions = [] } = {}) {
    if (victoires > 0) return blanchissages > 0 ? 'BL' : 'V';
    if (decisions.some(d => d === 'O' || d === 'OTL')) return 'DP';
    if (decisions.some(d => d === 'L')) return 'D';
    return null;
}

/**
 * Le classement de la soirée elle-même ne veut dire quelque chose que dans un
 * pool assez grand : « meilleure soirée du pool » à deux équipes, c'est
 * gagner à pile ou face. Nombre d'équipes minimum pour dire 1er, 2e, 3e du soir.
 */
const MIN_EQUIPES_RANG_SOIR = { 1: 4, 2: 6, 3: 9 };
/** La phrase courte tient sur une ligne du téléphone : au-delà, le nom cède la place au rang (« le 2e »). */
const PHRASE_COURTE_MAX = 20;

const numTexte = n => {
    const v = scoring.arrondi(Math.abs(Number(n) || 0));
    return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
};
const ptsTexte = n => `${numTexte(n)} pt${scoring.arrondi(Math.abs(Number(n) || 0)) > 1 ? 's' : ''}`;
const rangTexte = n => (n === 1 ? '1er' : `${n}e`);

/**
 * La phrase sous le rang : ce que la soirée a changé dans la course, même
 * quand le rang ne bouge pas. On compare toujours la MÊME équipe avant et
 * après la soirée, et une seule histoire est racontée — la première qui
 * s'applique :
 *
 *   1. des places gagnées ou perdues (et à qui) ;
 *      puis la meilleure soirée du pool, si le pool est assez grand ;
 *   2. en tête : l'avance qui grandit, ou celle qui reste ;
 *   3. une égalité avec l'équipe du dessus ;
 *   4. l'écart avec l'équipe du dessus qui fond ;
 *   5. l'avance sur l'équipe du dessous qui grandit ;
 *   6. le 2e ou 3e rang de la soirée dans le pool, si le pool est assez grand ;
 *   7. aucun joueur n'a joué ;
 *   8. sinon, la distance qui reste avec l'équipe du dessus.
 *
 *   lignes    : [{ teamName, total, soiree, apres }] (rangDeLaSoiree) ;
 *   monEquipe : la clé de l'équipe ;
 *   noms      : Map(clé → nom affiché) ;
 *   joue      : au moins un joueur ou un club a joué.
 *
 * Renvoie { type, sens: 'monte'|'baisse'|'progres'|'stable', court, long }
 * en texte brut, ou null si l'équipe n'est pas au classement.
 */
function phraseDeLaSoiree({ lignes, monEquipe, noms = new Map(), joue = true }) {
    const liste = Array.isArray(lignes) ? lignes : [];
    const rangs = rangsDeLaSoiree(liste);
    const ra = rangs.avant.get(monEquipe), rp = rangs.apres.get(monEquipe);
    if (!ra || !rp) return null;

    const n = liste.length;
    const apres = e => (Number(e.total) || 0) - (Number(e.apres) || 0);
    const avant = e => apres(e) - (Number(e.soiree) || 0);
    const parNom = new Map(liste.map(e => [e.teamName, e]));
    const moi = parNom.get(monEquipe);
    const aRang = (carte, r) => [...carte].find(([, v]) => v === r)?.[0] || null;
    const nom = cle => noms.get(cle) || cle;
    /** La phrase courte avec le nom, ou avec « le 2e » si elle déborde. */
    const court = (modele, cle, r) => {
        const avecNom = modele(nom(cle));
        return avecNom.length <= PHRASE_COURTE_MAX ? avecNom : modele(`le ${rangTexte(r)}`);
    };
    const histoire = (type, sens, court, long = court) => ({ type, sens, court, long });
    const majuscule = s => s.charAt(0).toUpperCase() + s.slice(1);
    const etait = ` · était ${rangTexte(ra)}`;

    // 1. Le rang a bougé : on nomme l'équipe dépassée quand il n'y en a qu'une.
    if (rp < ra) {
        const gain = ra - rp;
        if (gain === 1) {
            // L'équipe qui était devant et qui est maintenant derrière.
            const depassee = liste.map(e => e.teamName)
                .find(t => rangs.avant.get(t) < ra && rangs.apres.get(t) > rp);
            return histoire('depasse', 'monte', court(x => `Dépasse ${x}`, depassee, rangs.apres.get(depassee)), `Tu dépasses ${nom(depassee)}${etait}`);
        }
        return histoire('gagne', 'monte', `Gagne ${gain} places`, `Gagne ${gain} places${etait}`);
    }
    if (rp > ra) {
        const perte = rp - ra;
        if (perte === 1) {
            const devant = liste.map(e => e.teamName)
                .find(t => rangs.avant.get(t) > ra && rangs.apres.get(t) < rp);
            return histoire('depasse-par', 'baisse', court(x => `${majuscule(x)} te dépasse`, devant, rangs.apres.get(devant)), `${nom(devant)} te dépasse${etait}`);
        }
        return histoire('perd', 'baisse', `Perd ${perte} places`, `Perd ${perte} places${etait}`);
    }

    // Le rang de la soirée dans le pool — seulement s'il veut dire quelque
    // chose (MIN_EQUIPES_RANG_SOIR). La meilleure soirée passe devant les
    // écarts ; 2e et 3e viennent après eux.
    const soir = Number(moi.soiree) || 0;
    const rangSoir = soir > 0 ? 1 + liste.filter(e => (Number(e.soiree) || 0) > soir).length : null;
    const rangSoirParlant = Boolean(rangSoir && MIN_EQUIPES_RANG_SOIR[rangSoir] && n >= MIN_EQUIPES_RANG_SOIR[rangSoir]);
    if (rangSoirParlant && rangSoir === 1) {
        return histoire('soir-1', 'progres', '1er du pool ce soir', 'Meilleure soirée du pool');
    }

    const dessus = rp > 1 ? parNom.get(aRang(rangs.apres, rp - 1)) : null;
    const dessous = rp < n ? parNom.get(aRang(rangs.apres, rp + 1)) : null;

    // 2. En tête.
    if (rp === 1 && dessous) {
        const avance0 = avant(moi) - avant(dessous), avance1 = apres(moi) - apres(dessous);
        if (avance1 === 0) return histoire('egalite-tete', 'stable', 'Égalité en tête', `Égalité en tête avec ${nom(dessous.teamName)}`);
        if (avance1 > avance0 && avance0 > 0) {
            return histoire('avance-grandit', 'progres', `Avance : ${numTexte(avance0)} → ${ptsTexte(avance1)}`,
                `Ton avance sur ${nom(dessous.teamName)} passe de ${numTexte(avance0)} à ${ptsTexte(avance1)}`);
        }
        return histoire('en-tete', avance1 > avance0 ? 'progres' : 'stable', `En tête de ${ptsTexte(avance1)}`,
            `En tête, ${ptsTexte(avance1)} devant ${nom(dessous.teamName)}`);
    }

    if (dessus) {
        const ecart0 = avant(dessus) - avant(moi), ecart1 = apres(dessus) - apres(moi);
        // 3. Rejoint au même total (l'ordre actuel le garde derrière).
        if (ecart1 === 0) {
            return histoire('egalite', ecart0 > 0 ? 'progres' : 'stable', court(x => `Égalité avec ${x}`, dessus.teamName, rp - 1),
                `À égalité avec ${nom(dessus.teamName)}`);
        }
        // 4. L'écart avec la même équipe fond.
        if (ecart1 < ecart0) {
            return histoire('rapproche', 'progres', court(x => `+${ptsTexte(ecart0 - ecart1)} sur ${x}`, dessus.teamName, rp - 1),
                `Écart avec ${nom(dessus.teamName)} : ${numTexte(ecart0)} → ${ptsTexte(ecart1)}`);
        }
    }

    // 5. L'avance sur l'équipe du dessous grandit.
    if (dessous) {
        const avance0 = avant(moi) - avant(dessous), avance1 = apres(moi) - apres(dessous);
        if (avance1 > avance0 && avance0 >= 0) {
            return histoire('creuse', 'progres', court(x => `+${ptsTexte(avance1 - avance0)} sur ${x}`, dessous.teamName, rp + 1),
                `Avance sur ${nom(dessous.teamName)} : ${numTexte(avance0)} → ${ptsTexte(avance1)}`);
        }
    }

    // 6. 2e ou 3e soirée du pool.
    if (rangSoirParlant) {
        return histoire(`soir-${rangSoir}`, 'progres', `${rangSoir}e du pool ce soir`, `${rangSoir}e meilleure soirée du pool`);
    }

    // 7. Personne n'a joué.
    if (!joue) return histoire('repos', 'stable', 'Soirée de repos', 'Aucun de tes joueurs n’a joué');

    // 8. La distance qui reste.
    if (dessus) {
        const ecart1 = apres(dessus) - apres(moi);
        return histoire('distance', 'stable', court(x => `À ${ptsTexte(ecart1)} de ${x}`, dessus.teamName, rp - 1),
            `À ${ptsTexte(ecart1)} de ${nom(dessus.teamName)}`);
    }
    return histoire('stable', 'stable', 'Même place', 'Même place qu’avant la soirée');
}

module.exports = {
    phraseDeLaSoiree,
    REESSAI_EN_JEU_MS,
    REESSAI_CALME_MS,
    etatDeLaSoiree,
    choisirSoiree,
    delaiAvantReessai,
    soireeDuClub,
    rangsDeLaSoiree,
    rangsH2H,
    issueDuDuel,
    nomAffiche,
    decisionDuGardien
};
