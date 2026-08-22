/**
 * Compléments de l'onglet Aperçu et de la vue bureau de la Liste des
 * joueurs : suggestion, alignement, derniers choix (texte), sidebar de
 * position/affichage/équipe avec compteurs, et carte « Joueur sélectionné ».
 *
 * Même règle que draftFavorites.js / draftActifUI.js : aucune logique de
 * repêchage ici, uniquement de la lecture des variables déjà globales de
 * draftActif.js (fullPlayerData, goalieData, draftData, getUserTeam,
 * isUserTurn, checkIfUserTeamIsDone, _isCategoryFull) et des aides déjà
 * posées par draftFavorites.js (fzGetFavorites, fzFindRecord,
 * fzPositionCode, fzPositionLabel, fzGroupKeyFor, fzPhotoAndLogo,
 * fzStatBlurb, fzPickedSet, fzRowPlayerName, fzBuildSelectButton,
 * fzBuildStarButton). Rejoué après chaque rendu réel via la liste `rendus`
 * de refreshDraftViews() (draftRefresh.js).
 */

/* ============================================================
   0. RÉFÉRENCE — villes des équipes LNH
   ------------------------------------------------------------
   Donnée publique fixe (32 clubs), pas une fiche du pool : sert à afficher
   « D · Montréal » plutôt que l'abréviation brute dans les cartes Suggestion
   et Joueur sélectionné, et à peupler le filtre Équipe de la sidebar.
   ============================================================ */
const FZ_VILLES = {
    ANA: 'Anaheim', ARI: 'Arizona', UTA: 'Utah', BOS: 'Boston', BUF: 'Buffalo',
    CGY: 'Calgary', CAR: 'Caroline', CHI: 'Chicago', COL: 'Colorado', CBJ: 'Columbus',
    DAL: 'Dallas', DET: 'Detroit', EDM: 'Edmonton', FLA: 'Floride', LAK: 'Los Angeles',
    MIN: 'Minnesota', MTL: 'Montréal', NSH: 'Nashville', NJD: 'New Jersey',
    NYI: 'NY Islanders', NYR: 'NY Rangers', OTT: 'Ottawa', PHI: 'Philadelphie',
    PIT: 'Pittsburgh', SJS: 'San Jose', SEA: 'Seattle', STL: 'St. Louis',
    TBL: 'Tampa Bay', TOR: 'Toronto', VAN: 'Vancouver', VGK: 'Vegas',
    WSH: 'Washington', WPG: 'Winnipeg'
};

/** Premier code d'équipe d'une fiche — teamAbbrevs porte parfois plusieurs
 *  clubs séparés par virgule (joueur échangé en cours de saison). */
function fzPremierAbbrev(rec) {
    const brut = rec && rec.teamAbbrevs;
    if (!brut) return null;
    return String(brut).split(',')[0].trim() || null;
}

function fzVilleEquipe(rec) {
    const code = fzPremierAbbrev(rec);
    return code ? (FZ_VILLES[code] || code) : null;
}

/* ============================================================
   1. CANDIDATS DISPONIBLES
   ============================================================ */

function fzAllAvailableCandidates() {
    const pris = typeof fzPickedSet === 'function' ? fzPickedSet() : new Set();
    const patineurs = (typeof fullPlayerData !== 'undefined' && Array.isArray(fullPlayerData) ? fullPlayerData : [])
        .filter(p => !pris.has(p.skaterFullName))
        .map(p => ({ nom: p.skaterFullName, rec: p, kind: 'skater' }));
    const gardiens = (typeof goalieData !== 'undefined' && Array.isArray(goalieData) ? goalieData : [])
        .filter(g => !pris.has(g.goalieFullName))
        .map(g => ({ nom: g.goalieFullName, rec: g, kind: 'goalie' }));
    return patineurs.concat(gardiens);
}

/** Groupes de la progression dont le quota de l'équipe n'est pas atteint. */
function fzGroupesManquants() {
    const me = typeof getUserTeam === 'function' ? getUserTeam() : null;
    const cfg = (typeof draftData !== 'undefined' && draftData && draftData.config)
        || { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1 };
    const equipe = (me && typeof draftData !== 'undefined' && draftData && draftData.teams && draftData.teams[me]) || {};
    return {
        offensive: (equipe.offensive || []).length < (cfg.numOffensive ?? 6),
        defensive: (equipe.defensive || []).length < (cfg.numDefensive ?? 4),
        rookie: (equipe.rookie || []).length < (cfg.numRookies ?? 1),
        goalie: (equipe.goalie || []).length < (cfg.numGoalies ?? 1)
    };
}

/** Le seul groupe signalé "manquant" dans l'interface (sidebar de position,
 *  Ma progression) : celui où il manque le plus de joueurs, pas chaque
 *  groupe incomplet — sinon la page serait presque entièrement rouge dès le
 *  premier choix. Retourne null si tous les quotas sont atteints. */
function fzPireGroupe() {
    const me = typeof getUserTeam === 'function' ? getUserTeam() : null;
    const cfg = (typeof draftData !== 'undefined' && draftData && draftData.config)
        || { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1 };
    const equipe = (me && typeof draftData !== 'undefined' && draftData && draftData.teams && draftData.teams[me]) || {};
    const groupes = [
        { cle: 'offensive', ecart: (cfg.numOffensive ?? 6) - (equipe.offensive || []).length },
        { cle: 'defensive', ecart: (cfg.numDefensive ?? 4) - (equipe.defensive || []).length },
        { cle: 'rookie', ecart: (cfg.numRookies ?? 1) - (equipe.rookie || []).length },
        { cle: 'goalie', ecart: (cfg.numGoalies ?? 1) - (equipe.goalie || []).length }
    ];
    let pire = null;
    groupes.forEach(g => { if (g.ecart > 0 && (!pire || g.ecart > pire.ecart)) pire = g; });
    return pire ? pire.cle : null;
}

/** Rang réel d'un joueur parmi les disponibles de son groupe, trié par
 *  points (victoires×2 pour un gardien, comme fzComputeSuggestion) — pas
 *  une projection inventée, un classement sur les points déjà affichés. */
function fzRangDansGroupe(nom, rec, kind, code) {
    const groupe = typeof fzGroupKeyFor === 'function' ? fzGroupKeyFor(code, kind) : null;
    if (!groupe) return null;
    const bassin = fzAllAvailableCandidates().filter(c => {
        const cCode = typeof fzPositionCode === 'function' ? fzPositionCode(c.rec, c.kind) : '';
        return (typeof fzGroupKeyFor === 'function' ? fzGroupKeyFor(cCode, c.kind) : null) === groupe;
    });
    const pointsDe = c => c.kind === 'goalie' ? (c.rec.wins || 0) * 2 : (c.rec.points || 0);
    bassin.sort((a, b) => pointsDe(b) - pointsDe(a));
    const index = bassin.findIndex(c => c.nom === nom);
    return index === -1 ? null : index + 1;
}

function fzOrdinal(n) {
    return n === 1 ? '1er' : n + 'e';
}

/** Élision de "de" devant une voyelle — "d'attaquant" et non "de attaquant". */
function fzDe(mot) {
    return /^[aeiouhàâéèêëîïôöùûü]/i.test(mot) ? `d’${mot}` : `de ${mot}`;
}

/* ============================================================
   2. SUGGESTION — meilleur favori libre, priorité à un trou à combler
   ============================================================ */

function fzComputeSuggestion() {
    const favoris = new Set(typeof fzGetFavorites === 'function' ? fzGetFavorites() : []);
    const manquants = fzGroupesManquants();
    const bassin = fzAllAvailableCandidates();
    const favorisDispo = bassin.filter(c => favoris.has(c.nom));
    const base = favorisDispo.length ? favorisDispo : bassin;

    const pointsDe = c => c.kind === 'goalie' ? (c.rec.wins || 0) * 2 : (c.rec.points || 0);
    const score = c => {
        const code = typeof fzPositionCode === 'function' ? fzPositionCode(c.rec, c.kind) : '';
        const groupe = typeof fzGroupKeyFor === 'function' ? fzGroupKeyFor(code, c.kind) : '';
        return (manquants[groupe] ? 1e6 : 0) + pointsDe(c);
    };

    const triés = [...base].sort((a, b) => score(b) - score(a));
    const top = triés[0];
    if (!top) return null;

    const code = typeof fzPositionCode === 'function' ? fzPositionCode(top.rec, top.kind) : '';
    const groupe = typeof fzGroupKeyFor === 'function' ? fzGroupKeyFor(code, top.kind) : '';
    return { nom: top.nom, rec: top.rec, kind: top.kind, code, combleUnTrou: !!manquants[groupe], estFavori: favoris.has(top.nom) };
}

function fzPeutChoisir(code) {
    return typeof isUserTurn === 'function' && isUserTurn()
        && typeof checkIfUserTeamIsDone === 'function' && !checkIfUserTeamIsDone()
        && !(typeof _isCategoryFull === 'function' && _isCategoryFull(code));
}

/** Ligne "D · Montréal · 62 pts · 3e meilleur défenseur libre" partagée par
 *  Suggestion et Joueur sélectionné — mêmes trois faits, jamais de
 *  projection ou de comparaison inventées. */
function fzLigneMeta(rec, kind, code) {
    const libellePos = typeof fzPositionLabel === 'function' ? fzPositionLabel(code) : code;
    const ville = fzVilleEquipe(rec);
    const blurb = typeof fzStatBlurb === 'function' ? fzStatBlurb(rec, kind) : '';
    return [libellePos, ville, blurb].filter(Boolean).join(' · ');
}

function fzRenderSuggestionCard() {
    const hote = document.getElementById('suggestionCard');
    if (!hote) return;
    const corps = hote.querySelector('.suggestion-body');
    const vide = hote.querySelector('.suggestion-empty');
    const s = fzComputeSuggestion();

    if (!s) {
        if (corps) corps.hidden = true;
        if (vide) vide.hidden = false;
        return;
    }
    if (vide) vide.hidden = true;
    if (!corps) return;
    corps.hidden = false;
    corps.replaceChildren();

    const { photo } = typeof fzPhotoAndLogo === 'function' ? fzPhotoAndLogo(s.nom, s.rec, s.kind) : {};
    const zonePhoto = document.createElement('div');
    zonePhoto.className = 'suggestion-photo';
    if (photo) {
        const img = document.createElement('img');
        img.src = photo; img.alt = ''; img.loading = 'lazy';
        img.addEventListener('error', () => img.remove());
        zonePhoto.appendChild(img);
    }
    corps.appendChild(zonePhoto);

    const info = document.createElement('div');
    info.className = 'suggestion-info';
    const tag = document.createElement('div');
    tag.className = 'suggestion-tag';
    tag.textContent = s.combleUnTrou ? 'Suggestion — comble un trou'
        : (s.estFavori ? 'Suggestion — meilleur favori libre' : 'Suggestion — meilleur disponible');
    info.appendChild(tag);
    const nom = document.createElement('div');
    nom.className = 'suggestion-name';
    nom.textContent = s.nom;
    info.appendChild(nom);
    const meta = document.createElement('div');
    meta.className = 'suggestion-meta';
    const rang = fzRangDansGroupe(s.nom, s.rec, s.kind, s.code);
    const libellePos = typeof fzPositionLabel === 'function' ? fzPositionLabel(s.code) : s.code;
    const ville = fzVilleEquipe(s.rec);
    const rangTexte = rang ? `${fzOrdinal(rang)} ${libellePos.toLowerCase()} libre` : '';
    meta.textContent = [libellePos, ville, rangTexte].filter(Boolean).join(' · ');
    info.appendChild(meta);
    corps.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'suggestion-actions';
    if (fzPeutChoisir(s.code) && typeof fzBuildSelectButton === 'function') {
        actions.appendChild(fzBuildSelectButton(s.nom, s.code));
    }
    if (typeof fzBuildStarButton === 'function') actions.appendChild(fzBuildStarButton(s.nom));
    corps.appendChild(actions);
}

/* ============================================================
   3. DERNIERS CHOIX — même historique que la vue "Tous", en texte
   ============================================================ */

function fzRenderRecentPicksFeed() {
    const hote = document.getElementById('recentPicksFeed');
    if (!hote) return;
    const liste = hote.querySelector('.recent-feed-list');
    if (!liste) return;

    const historique = (typeof draftData !== 'undefined' && draftData && draftData.picksHistory) || [];
    const favoris = new Set(typeof fzGetFavorites === 'function' ? fzGetFavorites() : []);
    liste.replaceChildren();

    if (!historique.length) {
        const p = document.createElement('p');
        p.className = 'no-picks';
        p.textContent = 'Aucun choix pour l’instant.';
        liste.appendChild(p);
        return;
    }

    const total = historique.length;
    historique.slice(-3).reverse().forEach((pick, i) => {
        const numero = total - i;
        const rangee = document.createElement('div');
        rangee.className = 'recent-feed-row';
        const slot = document.createElement('span');
        slot.className = 'recent-feed-slot';
        slot.textContent = 'C' + numero;
        rangee.appendChild(slot);
        const texte = document.createElement('span');
        texte.className = 'recent-feed-text';
        const fort = document.createElement('strong');
        fort.textContent = pick.team;
        texte.appendChild(fort);
        texte.appendChild(document.createTextNode(' a repêché ' + pick.player + '.'));
        if (favoris.has(pick.player)) {
            const retire = document.createElement('span');
            retire.className = 'recent-feed-removed';
            retire.textContent = ' Retiré de vos favoris.';
            texte.appendChild(retire);
        }
        rangee.appendChild(texte);
        liste.appendChild(rangee);
    });
}

/* ============================================================
   4. MON ALIGNEMENT — bureau seulement (voir CSS)
   ============================================================ */

function fzRenderLineupCard() {
    const hote = document.getElementById('lineupCard');
    if (!hote) return;
    const liste = hote.querySelector('.lineup-list');
    if (!liste) return;

    const me = typeof getUserTeam === 'function' ? getUserTeam() : null;
    const historique = (typeof draftData !== 'undefined' && draftData && draftData.picksHistory) || [];
    const nbEquipes = (typeof draftData !== 'undefined' && draftData && draftData.teams)
        ? Object.keys(draftData.teams).length : 0;

    const mesChoix = historique
        .map((pick, index) => ({ pick, index }))
        .filter(({ pick }) => me && pick.team === me);

    liste.replaceChildren();
    if (!mesChoix.length) {
        const p = document.createElement('p');
        p.className = 'no-picks';
        p.textContent = 'Aucun choix pour l’instant.';
        liste.appendChild(p);
        return;
    }

    mesChoix.forEach(({ pick, index }) => {
        const trouve = typeof fzFindRecord === 'function' ? fzFindRecord(pick.player) : null;
        const rangee = document.createElement('div');
        rangee.className = 'lineup-row';

        const tuile = document.createElement('div');
        tuile.className = 'lineup-tile';
        if (trouve && typeof fzPhotoAndLogo === 'function') {
            const { logo } = fzPhotoAndLogo(pick.player, trouve.rec, trouve.kind);
            if (logo) {
                const img = document.createElement('img');
                img.src = logo; img.alt = '';
                img.addEventListener('error', () => img.remove());
                tuile.appendChild(img);
            }
        }
        rangee.appendChild(tuile);

        const nom = document.createElement('span');
        nom.className = 'lineup-name';
        nom.textContent = pick.player;
        rangee.appendChild(nom);

        const detail = document.createElement('span');
        detail.className = 'lineup-round';
        const code = trouve && typeof fzPositionCode === 'function' ? fzPositionCode(trouve.rec, trouve.kind) : '';
        const ronde = nbEquipes > 0 ? Math.floor(index / nbEquipes) + 1 : 0;
        detail.textContent = [code, ronde ? 'R' + ronde : ''].filter(Boolean).join(' · ');
        rangee.appendChild(detail);

        liste.appendChild(rangee);
    });
}

/* ============================================================
   5. MA PROGRESSION — barres en segments discrets
   ------------------------------------------------------------
   draftActif.js pose déjà une largeur en pourcentage sur
   .progress-mini-fill (continu) ; superposé ici par des blocs discrets
   construits à partir du même "fait/total" déjà affiché en texte
   (#count-*) — jamais de nouveau calcul de quota.
   ============================================================ */

function fzRenderSegmentedProgress() {
    const lignes = [...document.querySelectorAll('.progress-line[data-position]')];
    // Une seule catégorie signalée en rouge — celle où il manque le plus de
    // joueurs (fzPireGroupe, même règle que la sidebar de position) —
    // plutôt que chaque ligne incomplète : sinon la carte serait presque
    // entièrement rouge dès le premier choix.
    const pirePosition = fzPireGroupe();

    lignes.forEach(ligne => {
        const position = ligne.dataset.position;
        const span = document.getElementById('count-' + position);
        const barre = ligne.querySelector('.progress-mini-bar');
        if (!span || !barre) return;
        const [fait, total] = span.textContent.split('/').map(n => parseInt(n, 10));
        if (!Number.isFinite(fait) || !Number.isFinite(total) || total <= 0) return;

        let segs = barre.querySelector('.fzd-segments');
        if (!segs) {
            segs = document.createElement('div');
            segs.className = 'fzd-segments';
            barre.appendChild(segs);
        }
        // Reconstruit seulement si le compte de blocs a changé — évite de
        // recréer N nœuds à chaque rafraîchissement (toutes les 7s).
        if (segs.children.length !== total) {
            segs.replaceChildren();
            for (let i = 0; i < total; i++) {
                const bloc = document.createElement('span');
                bloc.className = 'fzd-segment';
                segs.appendChild(bloc);
            }
        }
        [...segs.children].forEach((bloc, i) => bloc.classList.toggle('is-filled', i < fait));
        const urgent = position === pirePosition;
        segs.classList.toggle('is-needed', urgent);
        ligne.classList.toggle('is-needed-line', urgent);
    });
}

/* ============================================================
   5bis. MA PROGRESSION — VUE GLACE
   ------------------------------------------------------------
   Mockup Claude Design 3A/3B : la progression posée sur une patinoire —
   une ligne (AG/C/AD) + 2 défenseurs + 1 gardien sur la glace, le reste
   (surplus d'attaquants/défenseurs, recrue, équipe LNH) sur le banc
   « Réserve ». Toujours au plus 3 attaquants/2 défenseurs/1 gardien sur la
   glace, jamais plus même si la config du pool en demande davantage —
   le surplus part au banc, quelle que soit sa taille.
   ============================================================ */

/** Code à afficher pour une position réelle — L/R traduits en ailier
 *  gauche/droit (vocabulaire de la maquette), '*' en "Recrue" : ce sont des
 *  repères de mise en page sur la glace, pas un second quota. */
function fzCodeAffiche(code) {
    if (code === 'L') return 'AG';
    if (code === 'R') return 'AD';
    if (code === '*') return 'Recrue';
    return code;
}

/** Dernier mot d'un nom complet — assez compact pour une tuile de 54-66px,
 *  même choix que les tuiles de la maquette ("MacKinnon", pas "Nathan
 *  MacKinnon"). */
function fzNomCourt(nom) {
    const morceaux = String(nom).trim().split(/\s+/);
    return morceaux[morceaux.length - 1];
}

/** Réattribue les attaquants déjà repêchés à leur position naturelle
 *  (ailier gauche/centre/ailier droit) quand une place correspondante est
 *  encore libre sur la glace ; le reste part au banc avec son code réel.
 *  Ce n'est jamais un second quota — juste où le joueur atterrit sur le
 *  schéma, à code de position égal. */
function fzRepartirAvants(offensive, iceOffN) {
    const gabarits = iceOffN <= 0 ? []
        : iceOffN === 1 ? ['C']
        : iceOffN === 2 ? ['AG', 'AD']
        : ['AG', 'C', 'AD'];

    const restants = offensive.map(nom => {
        const trouve = typeof fzFindRecord === 'function' ? fzFindRecord(nom) : null;
        const code = trouve && typeof fzPositionCode === 'function' ? fzPositionCode(trouve.rec, trouve.kind) : null;
        return { nom, code };
    });
    const prendre = (code) => {
        const i = restants.findIndex(o => o.code === code);
        if (i === -1) return null;
        return restants.splice(i, 1)[0].nom;
    };

    const glace = gabarits.map(slotCode => ({
        zone: 'forward',
        label: slotCode,
        nom: slotCode === 'AG' ? prendre('L') : slotCode === 'AD' ? prendre('R') : prendre('C')
    }));
    const reserve = restants.map(o => ({ label: 'AT', nom: o.nom }));
    return { glace, reserve };
}

/** Construit les places de la glace (formation fixe) et du banc (le reste
 *  des quotas du pool), à partir des mêmes tableaux/quotas que
 *  updateProgressCounter() (draftActif.js) — jamais un second calcul de
 *  quota, uniquement leur répartition visuelle. */
function fzBuildIceSlots() {
    const me = typeof getUserTeam === 'function' ? getUserTeam() : null;
    const equipe = (me && typeof draftData !== 'undefined' && draftData && draftData.teams && draftData.teams[me]) || {};
    const cfg = (typeof draftData !== 'undefined' && draftData && draftData.config)
        || { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1, numTeams: 1 };

    const offensive = equipe.offensive || [];
    const defensive = equipe.defensive || [];
    const goalie = equipe.goalie || [];
    const rookie = equipe.rookie || [];
    const teams = equipe.teams || [];

    const maxOff = cfg.numOffensive ?? 6;
    const maxDef = cfg.numDefensive ?? 4;
    const maxGoal = cfg.numGoalies ?? 1;
    const maxRookie = cfg.numRookies ?? 1;
    const maxTeam = cfg.numTeams ?? 1;

    const iceOffN = Math.min(3, maxOff);
    const { glace: avantsGlace, reserve: avantsReserve } = fzRepartirAvants(offensive, iceOffN);

    const iceDefN = Math.min(2, maxDef);
    const defenseGlace = [];
    for (let i = 0; i < iceDefN; i++) defenseGlace.push({ zone: 'defense', label: 'D', nom: defensive[i] || null });
    const defenseReserve = [];
    for (let i = iceDefN; i < maxDef; i++) defenseReserve.push({ label: 'D', nom: defensive[i] || null });

    const iceGoalN = Math.min(1, maxGoal);
    const goalieGlace = [];
    for (let i = 0; i < iceGoalN; i++) goalieGlace.push({ zone: 'goalie', label: 'G', nom: goalie[i] || null });
    const goalieReserve = [];
    for (let i = iceGoalN; i < maxGoal; i++) goalieReserve.push({ label: 'G', nom: goalie[i] || null });

    const rookieReserve = [];
    for (let i = 0; i < maxRookie; i++) rookieReserve.push({ label: 'Recrue', nom: rookie[i] || null });

    const teamReserve = [];
    for (let i = 0; i < maxTeam; i++) teamReserve.push({ label: 'Équipe', nom: teams[i] || null, kindHint: 'team' });

    return {
        rink: [...avantsGlace, ...defenseGlace, ...goalieGlace],
        reserve: [...avantsReserve, ...defenseReserve, ...goalieReserve, ...rookieReserve, ...teamReserve]
    };
}

/** Position horizontale (%) d'une place d'attaquant selon son rang parmi
 *  les n places de la ligne — centrée, espacement fixe. */
function fzAvantGauche(i, n) {
    if (n <= 1) return 50;
    if (n === 2) return i === 0 ? 30 : 70;
    return [28, 50, 72][i] ?? 50;
}
function fzDefenseGauche(i, n) {
    if (n <= 1) return 50;
    return i === 0 ? 25 : 75;
}

/** Une tuile de joueur (ou de place libre), glace ou réserve — même patron
 *  que fzRenderLineupCard() : logo d'équipe, jamais une photo (trop petite
 *  ici pour se distinguer). Une place « équipe » (pick LNH, pas un joueur)
 *  affiche l'écusson déjà posé dans `photo` par fzPhotoAndLogo pour ce cas,
 *  jamais de code de position. */
function fzBuildRosterTile(slot, variante) {
    const el = document.createElement('div');
    el.className = 'fzd-tile fzd-tile--' + variante + ' fzd-tile--' + (slot.zone || 'bench');
    const trouve = slot.nom && typeof fzFindRecord === 'function' ? fzFindRecord(slot.nom) : null;
    el.classList.toggle('is-empty', !trouve);

    const box = document.createElement('div');
    box.className = 'fzd-tile-box';
    el.appendChild(box);

    if (trouve) {
        const { rec, kind } = trouve;
        const { photo, logo } = typeof fzPhotoAndLogo === 'function' ? fzPhotoAndLogo(slot.nom, rec, kind) : {};
        const src = kind === 'team' ? photo : logo;
        if (src) {
            const img = document.createElement('img');
            img.src = src; img.alt = '';
            img.addEventListener('error', () => img.remove());
            box.appendChild(img);
        }
        const nomEl = document.createElement('div');
        nomEl.className = 'fzd-tile-name';
        nomEl.textContent = fzNomCourt(slot.nom);
        el.appendChild(nomEl);

        if (kind !== 'team') {
            const code = typeof fzPositionCode === 'function' ? fzPositionCode(rec, kind) : slot.label;
            const codeEl = document.createElement('div');
            codeEl.className = 'fzd-tile-code';
            codeEl.textContent = fzCodeAffiche(code);
            el.appendChild(codeEl);
        }
    } else {
        const lbl = document.createElement('div');
        lbl.className = 'fzd-tile-label';
        lbl.textContent = variante === 'rink' ? 'À combler' : 'Libre';
        el.appendChild(lbl);
        const codeEl = document.createElement('div');
        codeEl.className = 'fzd-tile-code';
        codeEl.textContent = fzCodeAffiche(slot.label);
        el.appendChild(codeEl);
    }
    return el;
}

function fzRenderIceProgression() {
    const rinkHost = document.getElementById('rinkSlots');
    const reserveHost = document.getElementById('progressReserveList');
    if (!rinkHost || !reserveHost) return;
    const { rink, reserve } = fzBuildIceSlots();

    rinkHost.replaceChildren();
    const avants = rink.filter(s => s.zone === 'forward');
    const defense = rink.filter(s => s.zone === 'defense');
    const gardiens = rink.filter(s => s.zone === 'goalie');

    avants.forEach((slot, i) => {
        const el = fzBuildRosterTile(slot, 'rink');
        el.style.left = fzAvantGauche(i, avants.length) + '%';
        el.style.top = '25%';
        rinkHost.appendChild(el);
    });
    defense.forEach((slot, i) => {
        const el = fzBuildRosterTile(slot, 'rink');
        el.style.left = fzDefenseGauche(i, defense.length) + '%';
        el.style.top = '63%';
        rinkHost.appendChild(el);
    });
    gardiens.forEach(slot => {
        const el = fzBuildRosterTile(slot, 'rink');
        el.style.left = '50%';
        el.style.top = '87%';
        rinkHost.appendChild(el);
    });

    reserveHost.replaceChildren();
    reserve.forEach(slot => reserveHost.appendChild(fzBuildRosterTile(slot, 'reserve')));
}

/** « 4 choix sur 13 » dans l'en-tête de la carte — même total que
 *  texteManques()/updateProgressCounter() (draftActif.js), jamais un
 *  second calcul de quota. */
function fzRenderProgressCount() {
    const span = document.getElementById('progressCount');
    if (!span) return;
    const me = typeof getUserTeam === 'function' ? getUserTeam() : null;
    const equipe = (me && typeof draftData !== 'undefined' && draftData && draftData.teams && draftData.teams[me]) || {};
    const cfg = (typeof draftData !== 'undefined' && draftData && draftData.config)
        || { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1, numTeams: 1 };

    const fait = ['offensive', 'defensive', 'rookie', 'goalie', 'teams']
        .reduce((somme, cle) => somme + (equipe[cle] || []).length, 0);
    const total = (cfg.numOffensive ?? 6) + (cfg.numDefensive ?? 4) + (cfg.numRookies ?? 1)
        + (cfg.numGoalies ?? 1) + (cfg.numTeams ?? 1);
    span.textContent = total > 0 ? `${fait} choix sur ${total}` : '';
}

/* ============================================================
   6. SIDEBAR DE POSITION / AFFICHAGE / ÉQUIPE (bureau, Liste des joueurs)
   ------------------------------------------------------------
   Reprend les options réelles de #playerFilter, comme initCategoryTabs()
   (draftActifUI.js) : un clic écrit dans le <select> caché et déclenche
   son événement `change`. Ajoute un compteur de joueurs disponibles par
   catégorie et un repère "manquants", absents des pastilles mobiles.
   ============================================================ */

const FZ_GROUPE_PAR_VALEUR = { offensive: 'offensive', defensive: 'defensive', goalies: 'goalie', rookies: 'rookie' };

function fzCountAvailable(valeur) {
    const bassin = fzAllAvailableCandidates();
    if (valeur === 'all') return bassin.length;
    return bassin.filter(c => {
        const code = typeof fzPositionCode === 'function' ? fzPositionCode(c.rec, c.kind) : '';
        if (code === '*') return valeur === 'rookies';
        if (valeur === 'rookies') return false;
        if (valeur === 'goalies') return c.kind === 'goalie';
        if (valeur === 'defensive') return code === 'D';
        if (valeur === 'offensive') return c.kind === 'skater' && code !== 'D';
        return false;
    }).length;
}

function fzRenderPositionSidebar() {
    const hote = document.getElementById('listFiltersSidebar');
    const select = document.getElementById('playerFilter');
    const liste = hote && hote.querySelector('.list-filters-positions');
    if (!hote || !select || !liste) return;

    const pireGroupe = fzPireGroupe();
    liste.replaceChildren();
    [...select.options].forEach(option => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'list-filter-position';
        item.dataset.value = option.value;
        item.disabled = option.disabled;
        item.classList.toggle('is-active', option.value === select.value);

        const groupe = FZ_GROUPE_PAR_VALEUR[option.value];
        const manque = groupe && groupe === pireGroupe;
        item.classList.toggle('is-needed', !!manque);

        const libelle = document.createElement('span');
        libelle.className = 'list-filter-label';
        libelle.textContent = option.textContent.trim();
        if (manque) {
            const suffixe = document.createElement('span');
            suffixe.className = 'list-filter-needed-tag';
            suffixe.textContent = ' · manquants';
            libelle.appendChild(suffixe);
        }
        item.appendChild(libelle);

        const compte = document.createElement('span');
        compte.className = 'list-filter-count';
        compte.textContent = String(fzCountAvailable(option.value));
        item.appendChild(compte);

        item.addEventListener('click', () => {
            if (item.disabled) return;
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        liste.appendChild(item);
    });
}

/* ---- Résumé "N libres · M pris" (en-tête de la carte principale) ---- */
function fzRenderFiltersSummary() {
    const cible = document.getElementById('filtersHeaderSummary');
    if (!cible) return;
    const libres = fzCountAvailable('all');
    const pris = (typeof draftData !== 'undefined' && draftData && draftData.picksHistory)
        ? draftData.picksHistory.length : 0;
    cible.textContent = `${libres} libres · ${pris} pris`;
}

/* ---- "Trier" en pastilles (bureau), même patron que #categoryTabs ---- */
function fzRenderSortTabs() {
    const strip = document.getElementById('sortTabs');
    const select = document.getElementById('sortBy');
    if (!strip || !select || strip.dataset.built === '1') return;
    strip.dataset.built = '1';
    [...select.options].forEach(option => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'sort-tab';
        tab.dataset.value = option.value;
        tab.textContent = option.textContent.trim();
        tab.classList.toggle('is-active', option.value === select.value);
        tab.addEventListener('click', () => {
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            strip.querySelectorAll('.sort-tab').forEach(t => t.classList.toggle('is-active', t === tab));
        });
        strip.appendChild(tab);
    });
    select.addEventListener('change', () => {
        strip.querySelectorAll('.sort-tab').forEach(t => t.classList.toggle('is-active', t.dataset.value === select.value));
    });
}

/* ---- Miroir de recherche (sidebar bureau ↔ champ réel de la carte) ---- */
function fzInitSearchMirror() {
    const miroir = document.getElementById('listFilterSearch');
    const reel = document.getElementById('searchInput');
    if (!miroir || !reel || miroir.dataset.bound === '1') return;
    miroir.dataset.bound = '1';
    miroir.addEventListener('input', () => {
        if (reel.value === miroir.value) return;
        reel.value = miroir.value;
        reel.dispatchEvent(new Event('input', { bubbles: true }));
        reel.dispatchEvent(new Event('keyup', { bubbles: true }));
    });
    reel.addEventListener('input', () => { if (miroir.value !== reel.value) miroir.value = reel.value; });
}

/* ---- Filtre Équipe : peuplé depuis les fiches réelles, jamais une liste
   inventée — seules les équipes ayant au moins un joueur disponible
   apparaissent. ---- */
function fzPopulateTeamFilter() {
    const select = document.getElementById('listFilterTeam');
    if (!select || select.dataset.built === '1') return;
    const codes = new Set();
    fzAllAvailableCandidates().forEach(c => {
        const code = fzPremierAbbrev(c.rec);
        if (code) codes.add(code);
    });
    if (!codes.size) return; // données pas encore chargées — réessayer au prochain rafraîchissement
    select.dataset.built = '1';
    [...codes].sort((a, b) => (FZ_VILLES[a] || a).localeCompare(FZ_VILLES[b] || b)).forEach(code => {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = FZ_VILLES[code] || code;
        select.appendChild(option);
    });
}

/* ---- Filtres combinés posés sur le tableau déjà rendu : favoris seulement,
   comble un trou, équipe. "Joueurs libres seulement" ne filtre pas ici —
   il pilote #availabilityTabs (Libres/Tous), qui remplace le tableau
   entier (draftListePremium.js). ---- */
let fzFavorisSeulement = false;
let fzBesoinSeulement = false;
let fzEquipeChoisie = '';

function fzApplyListFilters() {
    const corps = document.querySelector('#playerTable tbody');
    if (!corps) return;
    const favoris = new Set(typeof fzGetFavorites === 'function' ? fzGetFavorites() : []);
    const manquants = fzGroupesManquants();
    corps.querySelectorAll('tr').forEach(tr => {
        if (tr.classList.contains('draft-empty-row')) return;
        const nom = typeof fzRowPlayerName === 'function' ? fzRowPlayerName(tr) : null;
        if (!nom) return;

        let cache = false;
        if (fzFavorisSeulement && !favoris.has(nom)) cache = true;

        if (!cache && (fzBesoinSeulement || fzEquipeChoisie)) {
            const trouve = typeof fzFindRecord === 'function' ? fzFindRecord(nom) : null;
            if (trouve) {
                if (!cache && fzBesoinSeulement) {
                    const code = typeof fzPositionCode === 'function' ? fzPositionCode(trouve.rec, trouve.kind) : '';
                    const groupe = typeof fzGroupKeyFor === 'function' ? fzGroupKeyFor(code, trouve.kind) : '';
                    if (!manquants[groupe]) cache = true;
                }
                if (!cache && fzEquipeChoisie && fzPremierAbbrev(trouve.rec) !== fzEquipeChoisie) cache = true;
            }
        }
        tr.classList.toggle('fzd-filtered-out', cache);
    });
}

function fzInitListFilterControls() {
    const favCb = document.getElementById('listFilterFavoritesOnly');
    if (favCb && favCb.dataset.bound !== '1') {
        favCb.dataset.bound = '1';
        favCb.addEventListener('change', () => { fzFavorisSeulement = favCb.checked; fzApplyListFilters(); });
    }
    const needCb = document.getElementById('listFilterNeedsOnly');
    if (needCb && needCb.dataset.bound !== '1') {
        needCb.dataset.bound = '1';
        needCb.addEventListener('change', () => { fzBesoinSeulement = needCb.checked; fzApplyListFilters(); });
    }
    const teamSelect = document.getElementById('listFilterTeam');
    if (teamSelect && teamSelect.dataset.bound !== '1') {
        teamSelect.dataset.bound = '1';
        teamSelect.addEventListener('change', () => { fzEquipeChoisie = teamSelect.value; fzApplyListFilters(); });
    }
    // "Joueurs libres seulement" reflète et pilote #availabilityTabs — pas
    // un filtre distinct : décocher revient à cliquer "Tous" (draftListePremium.js).
    const availCb = document.getElementById('listFilterAvailableOnly');
    const availSelect = document.getElementById('availabilityFilter');
    if (availCb && availSelect && availCb.dataset.bound !== '1') {
        availCb.dataset.bound = '1';
        availCb.addEventListener('change', () => {
            const cible = availCb.checked ? 'available' : 'picked';
            const bouton = document.querySelector(`#availabilityTabs .availability-tab[data-valeur="${cible}"]`);
            if (bouton) bouton.click();
        });
        availSelect.addEventListener('change', () => { availCb.checked = availSelect.value === 'available'; });
    }
}

/* ============================================================
   6bis. PAGINATION VISUELLE — "Charger N joueurs de plus" (4A/4B)
   ------------------------------------------------------------
   populateTable()/populateGoalieTable() (draftActif.js) rendent déjà
   TOUTES les rangées disponibles d'un coup — rien n'est demandé au
   serveur par lots. Cette couche masque les rangées au-delà du lot
   courant sous .fzd-paged-out, même patron que .fzd-filtered-out
   ci-dessus : un filtre visuel de plus, jamais une vraie requête
   supplémentaire. fzLotsAffiches repart à 1 chaque fois que #playerTable
   tbody est reconstruit (fzWatchPlayerTableForExtras, plus bas) : un
   nouveau rendu — changement de catégorie, recherche, tri — recommence
   en haut de la liste plutôt que de garder un lot qui ne correspond
   plus au contenu affiché.
   ============================================================ */
const FZ_TAILLE_LOT = 20;
let fzLotsAffiches = 1;

function fzApplyPagination() {
    const pied = document.getElementById('playerListFooter');
    const corps = document.querySelector('#playerTable tbody');
    if (!pied || !corps) return;

    const lignes = [...corps.querySelectorAll('tr')].filter(tr => !tr.classList.contains('draft-empty-row'));
    if (!lignes.length) { pied.hidden = true; return; }

    const visibles = lignes.filter(tr => !tr.classList.contains('fzd-filtered-out'));
    const limite = FZ_TAILLE_LOT * fzLotsAffiches;
    visibles.forEach((tr, i) => tr.classList.toggle('fzd-paged-out', i >= limite));

    const total = visibles.length;
    const affiches = Math.min(limite, total);
    const bouton = pied.querySelector('.player-list-more');
    const compte = document.getElementById('playerListCount');
    if (bouton) bouton.hidden = affiches >= total;
    if (compte) {
        compte.textContent = affiches < total
            ? `${affiches} de ${total}`
            : `${total} joueur${total > 1 ? 's' : ''} libre${total > 1 ? 's' : ''}`;
    }
    pied.hidden = false;
}

function fzInitPagination() {
    const bouton = document.querySelector('#playerListFooter .player-list-more');
    if (!bouton || bouton.dataset.bound === '1') return;
    bouton.dataset.bound = '1';
    bouton.addEventListener('click', () => {
        fzLotsAffiches += 1;
        fzApplyPagination();
    });
}

/* ============================================================
   8. JOUEUR SÉLECTIONNÉ (bureau, Liste des joueurs) — 340px
   ------------------------------------------------------------
   Un survol sur une rangée du tableau l'affiche ici (jamais un clic : la
   rangée porte déjà un clic délégué vers la modale de carrière, voir plus
   bas). Sans sélection (ou une fois le joueur pris), la suggestion en
   tient lieu — jamais de carte vide alors qu'un choix reste à faire.
   ============================================================ */

let fzJoueurAffiche = null;

/** Une tuile "95 / PTS" — mêmes trois faits que la Suggestion : points (ou
 *  victoires pour un gardien), buts ou passes, rang réel dans le groupe. */
function fzBuildStatTile(valeur, libelle) {
    const tuile = document.createElement('div');
    tuile.className = 'selected-player-tile';
    const num = document.createElement('div');
    num.className = 'selected-player-tile-num';
    num.textContent = valeur;
    tuile.appendChild(num);
    const lbl = document.createElement('div');
    lbl.className = 'selected-player-tile-label';
    lbl.textContent = libelle;
    tuile.appendChild(lbl);
    return tuile;
}

function fzRenderSelectedPlayerCard() {
    const hote = document.getElementById('selectedPlayerCard');
    if (!hote) return;
    const corps = hote.querySelector('.selected-player-body');
    const vide = hote.querySelector('.selected-player-empty');
    if (!corps || !vide) return;

    const pris = typeof fzPickedSet === 'function' ? fzPickedSet() : new Set();
    let nom = fzJoueurAffiche;
    if (!nom || pris.has(nom) || !(typeof fzFindRecord === 'function' && fzFindRecord(nom))) {
        const suggestion = fzComputeSuggestion();
        nom = suggestion ? suggestion.nom : null;
        fzJoueurAffiche = nom;
    }

    if (!nom) {
        corps.hidden = true;
        vide.hidden = false;
        return;
    }
    const trouve = fzFindRecord(nom);
    if (!trouve) { corps.hidden = true; vide.hidden = false; return; }
    vide.hidden = true;
    corps.hidden = false;
    corps.replaceChildren();

    const { rec, kind } = trouve;
    const code = typeof fzPositionCode === 'function' ? fzPositionCode(rec, kind) : '';
    const { photo } = typeof fzPhotoAndLogo === 'function' ? fzPhotoAndLogo(nom, rec, kind) : {};

    const entete = document.createElement('div');
    entete.className = 'selected-player-head';
    const zonePhoto = document.createElement('div');
    zonePhoto.className = 'selected-player-photo';
    if (photo) {
        const img = document.createElement('img');
        img.src = photo; img.alt = ''; img.loading = 'lazy';
        img.addEventListener('error', () => img.remove());
        zonePhoto.appendChild(img);
    }
    entete.appendChild(zonePhoto);
    const identite = document.createElement('div');
    identite.className = 'selected-player-ident';
    const titre = document.createElement('div');
    titre.className = 'selected-player-name';
    titre.textContent = nom;
    identite.appendChild(titre);
    const sous = document.createElement('div');
    sous.className = 'selected-player-meta';
    const libellePos = typeof fzPositionLabel === 'function' ? fzPositionLabel(code) : code;
    const ville = fzVilleEquipe(rec);
    sous.textContent = [libellePos, ville].filter(Boolean).join(' · ');
    identite.appendChild(sous);
    entete.appendChild(identite);
    corps.appendChild(entete);

    // Trois tuiles : points (ou victoires), second repère réel, rang dans
    // le groupe — jamais de projection, seulement ce qui est déjà affiché
    // ailleurs sur la page sous une autre forme.
    const tuiles = document.createElement('div');
    tuiles.className = 'selected-player-tiles';
    if (kind === 'goalie') {
        tuiles.appendChild(fzBuildStatTile(rec.wins ?? '–', 'V'));
        tuiles.appendChild(fzBuildStatTile(rec.savePct != null ? rec.savePct.toFixed(3) : '–', 'SV%'));
    } else {
        tuiles.appendChild(fzBuildStatTile(rec.points ?? '–', 'PTS'));
        tuiles.appendChild(fzBuildStatTile(rec.assists ?? '–', 'A'));
    }
    const rang = fzRangDansGroupe(nom, rec, kind, code);
    tuiles.appendChild(fzBuildStatTile(rang ? fzOrdinal(rang) : '–', `${libellePos.toLowerCase()} libre`));
    corps.appendChild(tuiles);

    const blurb = document.createElement('p');
    blurb.className = 'selected-player-blurb';
    const manquants = fzGroupesManquants();
    const groupe = typeof fzGroupKeyFor === 'function' ? fzGroupKeyFor(code, kind) : '';
    const phrases = [];
    if (manquants[groupe]) phrases.push(`Comble votre poste ${fzDe(libellePos.toLowerCase())}.`);
    const fait = typeof fzStatBlurb === 'function' ? fzStatBlurb(rec, kind) : '';
    if (fait) phrases.push(fait.charAt(0).toUpperCase() + fait.slice(1) + ' cette saison.');
    blurb.textContent = phrases.join(' ');
    if (phrases.length) corps.appendChild(blurb);

    const actions = document.createElement('div');
    actions.className = 'selected-player-actions';
    if (fzPeutChoisir(code) && typeof fzBuildSelectButton === 'function') {
        actions.appendChild(fzBuildSelectButton(nom, code));
    }
    if (typeof fzBuildStarButton === 'function') actions.appendChild(fzBuildStarButton(nom));
    corps.appendChild(actions);

    // « Il vous manque » : catégories dont le quota n'est pas atteint,
    // valeurs déjà rendues dans #progressCard (draftActif.js) — pas de
    // recalcul, juste une lecture des mêmes compteurs affichés ailleurs.
    const manqueListe = document.createElement('div');
    manqueListe.className = 'selected-player-needs';
    const CATEGORIES = [
        { cle: 'offensive', libelle: 'Attaquants' },
        { cle: 'defensive', libelle: 'Défenseurs' },
        { cle: 'rookie', libelle: 'Recrue' },
        { cle: 'goalie', libelle: 'Gardien' }
    ];
    let auMoinsUn = false;
    CATEGORIES.forEach(cat => {
        const span = document.getElementById('count-' + cat.cle);
        if (!span) return;
        const [fait2, total] = span.textContent.split('/').map(n => parseInt(n, 10));
        if (!Number.isFinite(fait2) || !Number.isFinite(total) || fait2 >= total) return;
        auMoinsUn = true;
        const ligne = document.createElement('div');
        ligne.className = 'selected-player-need-row';
        const libelle = document.createElement('span');
        libelle.textContent = cat.libelle;
        ligne.appendChild(libelle);
        const valeur = document.createElement('span');
        valeur.textContent = fait2 + '/' + total;
        ligne.appendChild(valeur);
        manqueListe.appendChild(ligne);
    });
    if (auMoinsUn) {
        const titreManque = document.createElement('div');
        titreManque.className = 'selected-player-needs-title';
        titreManque.textContent = 'Il vous manque';
        corps.appendChild(titreManque);
        corps.appendChild(manqueListe);
    }
}

/**
 * Survol/focus, jamais clic : chaque rangée porte déjà .clickable-player-row
 * (draftActif.js), avec un gestionnaire de clic délégué sur `document` qui
 * ouvre la modale de carrière (showCareerStats). Un clic ici ouvrirait donc
 * les deux à la fois — la modale par-dessus la carte qu'on vient de remplir.
 * Le survol évite le conflit et reste au clavier via `focusin` (les rangées
 * sont déjà tabindex="0" pour la modale). */
function fzInitSelectedPlayerClicks() {
    const corps = document.querySelector('#playerTable tbody');
    if (!corps) return;
    const survoler = e => {
        const tr = e.target.closest('tr');
        if (!tr || tr.classList.contains('draft-empty-row')) return;
        const nom = typeof fzRowPlayerName === 'function' ? fzRowPlayerName(tr) : null;
        if (!nom || nom === fzJoueurAffiche) return;
        fzJoueurAffiche = nom;
        fzRenderSelectedPlayerCard();
        fzHighlightSelectedRow();
    };
    corps.addEventListener('mouseover', survoler);
    corps.addEventListener('focusin', survoler);
}

function fzHighlightSelectedRow() {
    document.querySelectorAll('#playerTable tbody tr').forEach(tr => {
        const nom = typeof fzRowPlayerName === 'function' ? fzRowPlayerName(tr) : null;
        tr.classList.toggle('fzd-selected-row', !!nom && nom === fzJoueurAffiche);
    });
}

/* ============================================================
   9. POINT D'ENTRÉE
   ============================================================ */

window.fzRefreshApercuExtras = function () {
    try { fzRenderSuggestionCard(); } catch (e) { console.error('[apercu] suggestion :', e); }
    try { fzRenderRecentPicksFeed(); } catch (e) { console.error('[apercu] derniers choix :', e); }
    try { fzRenderLineupCard(); } catch (e) { console.error('[apercu] alignement :', e); }
    try { fzRenderSegmentedProgress(); } catch (e) { console.error('[apercu] progression segmentée :', e); }
    try { fzRenderIceProgression(); } catch (e) { console.error('[apercu] progression glace :', e); }
    try { fzRenderProgressCount(); } catch (e) {}
    try { fzRenderPositionSidebar(); } catch (e) { console.error('[apercu] sidebar position :', e); }
    try { fzRenderFiltersSummary(); } catch (e) {}
    try { fzPopulateTeamFilter(); } catch (e) {}
    try { fzApplyListFilters(); } catch (e) { console.error('[apercu] filtres liste :', e); }
    // Après les filtres (juste au-dessus) : la pagination compte et limite
    // les rangées encore visibles APRÈS filtrage, jamais le total brut.
    try { fzApplyPagination(); } catch (e) { console.error('[apercu] pagination :', e); }
    // Rendre d'abord : sans sélection explicite, fzRenderSelectedPlayerCard()
    // retombe sur la suggestion et met fzJoueurAffiche à jour — la rangée à
    // surligner n'est donc connue qu'après cet appel, jamais avant.
    try { fzRenderSelectedPlayerCard(); } catch (e) { console.error('[apercu] joueur sélectionné :', e); }
    try { fzHighlightSelectedRow(); } catch (e) {}
};

/**
 * #playerFilter/#searchInput/#sortBy/#availabilityFilter sont liés à
 * updateTable() via $(...).on(...) tout en haut de draftActif.js — AVANT
 * que draftRefresh.js ne remplace updateTable par une version enrichie qui
 * appelle refreshDraftViews(). jQuery capture la référence nue au moment de
 * la liaison, donc changer de catégorie / chercher / trier reconstruit bien
 * le tableau, mais sans jamais déclencher fzRefreshApercuExtras : les
 * compteurs, filtres et cartes retombées sur la suggestion restaient figés
 * sur leur tout premier rendu. Même remède que fzWatchPlayerTable
 * (draftFavorites.js) : observer directement l'effet qui compte plutôt que
 * d'ajouter une couche de plus à cette chaîne d'appels fragile.
 */
function fzWatchPlayerTableForExtras() {
    const tbody = document.querySelector('#playerTable tbody');
    if (!tbody) return;
    let planifie = false;
    const observer = new MutationObserver(() => {
        // Les tr.fzd-selected-row/.fzd-filtered-out posées par ce fichier
        // sont des mutations d'attribut (classList), jamais childList — cet
        // observateur ne se redéclenche donc pas lui-même.
        if (planifie) return;
        planifie = true;
        // Nouvelles rangées (childList a muté) : un lot qui ne partait pas
        // de 1 laisserait affichées des rangées au-delà de la limite pour
        // le nouveau contenu, ou en cacherait qui devraient l'être.
        fzLotsAffiches = 1;
        requestAnimationFrame(() => {
            planifie = false;
            try { window.fzRefreshApercuExtras(); } catch (e) { console.error('[apercu] rafraîchissement tableau :', e); }
        });
    });
    observer.observe(tbody, { childList: true });
}

document.addEventListener('DOMContentLoaded', () => {
    try { window.fzRefreshApercuExtras(); } catch (e) {}
    try { fzRenderSortTabs(); } catch (e) {}
    try { fzInitSearchMirror(); } catch (e) {}
    try { fzInitListFilterControls(); } catch (e) {}
    try { fzInitPagination(); } catch (e) {}
    try { fzInitSelectedPlayerClicks(); } catch (e) {}
    try { fzWatchPlayerTableForExtras(); } catch (e) {}
});
