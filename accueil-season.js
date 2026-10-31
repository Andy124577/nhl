/* ============================================================
   ACCUEIL DE SAISON — maquette « 6b Éditorial » (Fantazy Accueil Final)
   ------------------------------------------------------------
   De haut en bas : ma position, les matchs ce soir, mes joueurs ce soir,
   mon duel (tête-à-tête seulement), les meilleurs de la semaine,
   l'activité de la ligue, les classements de la semaine par position, les
   alignements des 32 clubs et, tout en bas, À lire.

   Une colonne au téléphone, deux au bureau (accueil-season.css). Les deux
   thèmes passent par les mêmes jetons --s-*.

   Données : rien de neuf côté serveur. Le rang et le total viennent du
   pool (buildTeamScores), la soirée de /tonight-boxscores et du calendrier
   du jour (calData), le direct des matchs du bandeau d'histoires
   (storySlides, accueil.js), la semaine de /hot-players-last7days, la vie
   de la ligue de fzhChargerLigue (accueil-watch.js) et les actualités de
   renderHomeNews (accueil.js), dans l'emplacement « actualites ».
   ============================================================ */
function fzsReset() {
    fzdRestoreCalendar();
    document.getElementById('fzSeasonHome')?.remove();
    document.getElementById('fzDashSection')?.classList.remove('is-season');
    document.body.classList.remove('fz-season-page');
    clearTimeout(fzsDepartMinuteur);
    fzsDepartMinuteur = null;
    clearInterval(fzsTicMinuteur);
    fzsTicMinuteur = null;
}

const fzsOrdinal = n => `${n}${n === 1 ? 're' : 'e'}`;
const fzsPts = n => Number(n || 0).toLocaleString('fr-CA', { maximumFractionDigits: 1 });
const fzsPluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/** Les pictogrammes des en-têtes : un trait, la couleur du texte d'accent. */
const FZS_ICONES = {
    crosse: '<path d="M14 3v11.5a2.5 2.5 0 0 1-2.5 2.5H5"/><path d="M4 21h7"/><circle cx="18.5" cy="19" r="1.6"/>',
    trophee: '<path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>',
    fil: '<path d="M5 5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-6l-4 3.5V15H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="M21 9v8.5L18.5 15"/>',
    rangs: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 5l1.5-1v5M3.8 15.5a1.4 1.4 0 0 1 2.6.6c0 1-2.6 2-2.6 3h2.8"/>',
    trios: '<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 10h17M9.5 4v16M14.5 10v10"/>',
    duel: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M9.5 6.5 13 3h3v3l-3.5 3.5"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>'
};
function fzsIcone(nom, taille = 22) {
    return `<svg class="fzs-ico" width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${FZS_ICONES[nom] || ''}</svg>`;
}

/** L'en-tête d'une section : pictogramme, titre, et une pastille ou un lien à droite. */
function fzsTete(icone, titre, droite = '') {
    return `<header class="fzs-sh">${icone ? fzsIcone(icone) : ''}<h2>${titre}</h2>${droite}</header>`;
}
const fzsPastille = texte => `<span class="fzs-chip">${texte}</span>`;
/** Le lien pleine largeur qui ferme une section. */
const fzsPied = (href, libelle) => `<a class="fzs-foot" href="${escapeHTML(href)}">${libelle}</a>`;

/** « C », « AG », « AD », « D », « G » : la position telle que le site l'écrit. */
function fzsPosition(pos) {
    return { L: 'AG', R: 'AD', LW: 'AG', RW: 'AD', F: 'A' }[pos] || pos || '';
}

/** Une clé de nom qui ignore accents, casse et ponctuation. */
function fzsCle(nom) {
    return String(nom || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fzsCouleurClub(abbrev) {
    return typeof getTeamColors === 'function' ? getTeamColors(abbrev)[0] : '#3A414D';
}

/* ---- Ma position ----
   Le rang et le total vivent avec les points du soir (pointsDirect.js) :
   un but d'un de mes joueurs les fait bouger sur place (fzsActualiserRang).
   Le mouvement du jour vient des instantanés du matin (/pool-rank-movement). */
let fzsRangContexte = null;
function fzsHeroHTML(activeName, movement) {
    const pool = (userData.userPools || []).find(p => p.name === activeName);
    const scores = pool ? buildTeamScores(pool) : [];
    const claimed = scores.filter(t => t.memberCount > 0);
    const ranking = claimed.length ? claimed : scores;
    const rank = ranking.findIndex(t => t.isCurrentUser);
    const mine = ranking[rank];
    const change = movement?.teams?.find(t => t.teamName === FZPool.team().name);
    // Le rang « maintenant » du serveur ignore les points du soir : dès
    // qu'il y en a dans ce pool, c'est le rang affiché qui fait foi.
    const soir = ranking.some(t => t.live);
    const rangActuel = soir && rank >= 0 ? rank + 1 : change?.rankNow;
    const delta = movement?.hasSnapshot && change?.rankToday != null && rangActuel != null ? change.rankToday - rangActuel : null;
    // La pastille s'allume quand elle vient de monter — pas à chaque redessin.
    const avant = fzsRangContexte && fzsRangContexte.activeName === activeName ? fzsRangContexte.live : null;
    const soirMoi = (mine && mine.live) || 0;
    fzsRangContexte = { activeName, movement, live: soirMoi };
    const neuf = avant !== null && soirMoi > avant ? ' is-new' : '';
    const ecart = Math.abs(delta || 0);
    const meta = [
        soirMoi ? `<span class="fzs-hero-live${neuf}"><i></i>+${fzsPts(soirMoi)} ce soir</span>` : '',
        delta ? `<span class="fzs-hero-move ${delta > 0 ? 'is-up' : 'is-down'}" title="Depuis ce matin">${delta > 0 ? '▲' : '▼'} ${fzsPluriel(ecart, 'place')}</span>` : ''
    ].join('');
    const rang = rank + 1;
    return `<a class="fzs-hero" href="classement.html?pool=${encodeURIComponent(activeName)}" aria-label="${escapeHTML(rank >= 0 ? `${rang}${rang === 1 ? 'er' : 'e'} sur ${ranking.length} · voir le classement` : 'Voir le classement')}">
            <span class="fzs-hero-rank${rank >= 0 && rang <= 3 ? ` is-${['or', 'argent', 'bronze'][rang - 1]}` : ''}">${rank >= 0 ? `<b>${rang}<sup>${rang === 1 ? 'er' : 'e'}</sup></b><small>sur ${ranking.length}</small>` : '<b>—</b>'}</span>
            <span class="fzs-hero-main">
                <span class="fzs-hero-pool">${escapeHTML(activeName)}</span>
                <strong class="fzs-hero-pts">${mine ? `${Number(mine.score).toLocaleString('fr-CA')} <small>pts</small>` : 'Classement à venir'}</strong>
                ${meta ? `<span class="fzs-hero-meta">${meta}</span>` : ''}
            </span>
            ${fzsIcone('chevron', 24)}
        </a>`;
}

function fzsActualiserRang() {
    const bloc = document.querySelector('#fzSeasonHome .fzs-hero');
    if (!bloc || !fzsRangContexte) return;
    bloc.outerHTML = fzsHeroHTML(fzsRangContexte.activeName, fzsRangContexte.movement);
}

/* ---- Matchs ce soir ----
   Le calendrier du jour donne tous les matchs, finis compris ; les feuilles
   du soir et le direct du bandeau d'histoires (storySlides, poussé par le
   socket) donnent les pointages les plus frais. Une carte par match. */
const FZS_EN_DIRECT = g => g && ['LIVE', 'CRIT'].includes(g.state);
const FZS_FINI = g => g && ['FINAL', 'OFF'].includes(g.state);

function fzsMatchsDuJour(tonight) {
    const jour = calData?.days?.find(d => d.date === todayISO());
    const parId = new Map();
    const fondre = g => { if (g && g.id != null) parId.set(String(g.id), { ...parId.get(String(g.id)), ...g }); };
    ((jour && jour.games) || []).forEach(fondre);
    ((tonight && tonight.games) || []).forEach(fondre);
    const direct = typeof storySlides !== 'undefined' ? storySlides : [];
    direct.forEach(s => {
        // Un match d'avant-match du bandeau n'ajoute rien de neuf ; un match
        // en direct apporte l'horloge et le pointage du dernier envoi.
        if (s && s.game && (s.type === 'live' || !parId.has(String(s.game.id)))) fondre(s.game);
    });
    const rang = g => (FZS_EN_DIRECT(g) ? 0 : FZS_FINI(g) ? 2 : 1);
    return [...parId.values()]
        .filter(g => g.away?.abbrev && g.home?.abbrev)
        .sort((a, b) => rang(a) - rang(b) || (Date.parse(a.startTimeUTC) || 0) - (Date.parse(b.startTimeUTC) || 0));
}

/** « 2e · 12:41 », « Entracte », « Prol. · 3:10 ». */
function fzsPeriode(g) {
    if (g.clock && g.clock.inIntermission) return 'Entracte';
    const p = g.periodType === 'OT' ? 'Prol.' : g.periodType === 'SO' ? 'TB' : g.period ? fzsOrdinal(g.period) : '';
    // L'horloge du bandeau d'histoires avance entre deux envois du direct.
    const horloge = g.periodType === 'SO' ? ''
        : g._recuLe && typeof storyClockLabel === 'function' ? storyClockLabel(g)
        : (g.clock && g.clock.timeRemaining) || '';
    return [p, horloge].filter(Boolean).join(' · ');
}

function fzsStatutMatch(g) {
    if (FZS_EN_DIRECT(g)) return `En direct${fzsPeriode(g) ? ` · ${fzsPeriode(g)}` : ''}`;
    if (FZS_FINI(g)) return `Final${g.periodType === 'OT' ? ' · Prol.' : g.periodType === 'SO' ? ' · TB' : ''}`;
    return g.startTimeUTC ? `Ce soir · ${gameTimeLabel(g.startTimeUTC)}` : 'Ce soir';
}

function fzsMatchHTML(g) {
    const esc = escapeHTML;
    const live = FZS_EN_DIRECT(g);
    const joue = live || FZS_FINI(g);
    const club = abbrev => `<span class="fzs-game-team"><img src="teams/${esc(abbrev)}.png" alt="" width="36" height="36" loading="lazy" onerror="this.style.visibility='hidden'"><b>${esc(abbrev)}</b></span>`;
    return `<li class="fzs-game${live ? ' is-live' : ''}${FZS_FINI(g) ? ' is-final' : ''}" data-id="${esc(g.id ?? '')}">
            <span class="fzs-game-st">${live ? '<i></i>' : ''}<span>${esc(fzsStatutMatch(g))}</span></span>
            <span class="fzs-game-sc" aria-label="${esc(`${g.away.abbrev} ${joue ? g.away.score ?? 0 : ''} contre ${g.home.abbrev} ${joue ? g.home.score ?? 0 : ''}`)}">
                ${club(g.away.abbrev)}
                <span class="fzs-game-score">${joue ? `<b>${esc(g.away.score ?? 0)}</b><i>–</i><b>${esc(g.home.score ?? 0)}</b>` : '<i>@</i>'}</span>
                ${club(g.home.abbrev)}
            </span>
            ${g.id ? `<a class="fzs-btn" href="match.html?id=${encodeURIComponent(g.id)}">Zone de match</a>` : ''}
        </li>`;
}

function fzsMatchsHTML(tonight) {
    const matchs = fzsMatchsDuJour(tonight);
    return `<section class="fzs-sec fzs-games" aria-labelledby="fzsGamesTitre">
            <header class="fzs-sh is-plain"><h2 id="fzsGamesTitre">Matchs ce soir</h2><a class="fzs-sh-link" href="calendrier.html">Scores</a></header>
            ${matchs.length
                ? `<ul class="fzs-rail fzs-games-list">${matchs.map(fzsMatchHTML).join('')}</ul>`
                : '<p class="fzs-empty">Aucun match de la LNH ce soir.</p>'}
        </section>`;
}

/** Redessine les cartes sur place, sans perdre la position du défilement. */
function fzsActualiserMatchs() {
    const bloc = document.querySelector('#fzSeasonHome .fzs-games');
    if (!bloc) return;
    const defile = bloc.querySelector('.fzs-rail')?.scrollLeft || 0;
    bloc.outerHTML = fzsMatchsHTML(calTonight);
    const rail = document.querySelector('#fzSeasonHome .fzs-games .fzs-rail');
    if (rail && defile) rail.scrollLeft = defile;
    // Un match qui commence pendant que l'accueil est ouvert : la soirée se
    // met à se relire seule.
    fzsReglerSuiviSoiree(calTonight);
    fzsReglerTic();
}

/* L'horloge des matchs en direct, à la seconde : seul le statut change. */
let fzsTicMinuteur = null;
function fzsReglerTic() {
    const live = !!document.querySelector('#fzSeasonHome .fzs-game.is-live');
    if (live && !fzsTicMinuteur) fzsTicMinuteur = setInterval(fzsTic, 1000);
    else if (!live && fzsTicMinuteur) { clearInterval(fzsTicMinuteur); fzsTicMinuteur = null; }
}

function fzsTic() {
    if (document.hidden) return;
    const cartes = document.querySelectorAll('#fzSeasonHome .fzs-game.is-live[data-id]');
    if (!cartes.length) { fzsReglerTic(); return; }
    const parId = new Map(fzsMatchsDuJour(calTonight).map(g => [String(g.id), g]));
    cartes.forEach(carte => {
        const g = parId.get(carte.dataset.id);
        const statut = carte.querySelector('.fzs-game-st span');
        const texte = g && fzsStatutMatch(g);
        if (statut && texte && statut.textContent !== texte) statut.textContent = texte;
    });
}

/* ---- Mes joueurs ce soir ----
   /tonight-boxscores ne suit que les matchs commencés : on croise l'effectif
   avec le calendrier du jour pour ceux qui jouent plus tard. Les points du
   soir passent par le barème du pool (fzdPointsCeSoir, accueil-dash.js). */
function fzsLignesDuSoir(tonight) {
    const names = new Set(activeRosterNames());
    const games = tonight.games || [];
    const lines = (tonight.players || []).filter(p => names.has(p.playerName));
    const total = lines.reduce((n, p) => n + fzdPointsCeSoir(p), 0);
    return { names, games, lines, total };
}

function fzsJoueursAvantMatch(tonight, names) {
    const jour = calData?.days?.find(d => d.date === todayISO());
    const parEquipe = {};
    ((jour && jour.games) || []).filter(g => ['FUT', 'PRE'].includes(g.state)).forEach(g => {
        parEquipe[g.away.abbrev] = g;
        parEquipe[g.home.abbrev] = g;
    });
    const dejaLa = new Set((tonight.players || []).map(p => p.playerName));
    const out = [];
    names.forEach(name => {
        if (dejaLa.has(name)) return;
        const info = getPlayerStats(name);
        const g = info && parEquipe[info.teamAbbrev];
        if (!g) return;
        out.push({ name, info, depart: g.startTimeUTC, away: g.away.abbrev, home: g.home.abbrev });
    });
    return out.sort((a, b) => Date.parse(a.depart) - Date.parse(b.depart));
}

/** Combien de mes joueurs jouent ce jour-là, d'après le calendrier de la semaine (calData). */
function fzsJoueursDuJour(jour, names) {
    const clubs = new Set();
    ((jour && jour.games) || []).forEach(g => { clubs.add(g.away.abbrev); clubs.add(g.home.abbrev); });
    return names.filter(n => clubs.has(getPlayerStats(n)?.teamAbbrev)).length;
}

/** Le prochain soir où l'un de mes joueurs joue, dans la semaine affichée. */
function fzsProchainSoir(names) {
    const auj = todayISO();
    const jour = (calData?.days || []).find(d => d.date > auj && fzsJoueursDuJour(d, names) > 0);
    if (!jour) return null;
    const libelle = jour.date === shiftISO(auj, 1) ? 'demain'
        : new Date(`${jour.date}T12:00:00Z`).toLocaleDateString('fr-CA', { weekday: 'long', timeZone: 'UTC' });
    return { libelle, n: fzsJoueursDuJour(jour, names) };
}

/** « vs WPG » à domicile, « @ VGK » à l'étranger. */
const fzsContre = (club, away, home) => (home === club ? `vs ${away}` : `@ ${home}`);

/**
 * Une ligne par joueur : d'abord ceux qui jouent, puis ceux dont le match
 * approche — le plus proche en tête —, puis ceux dont le match est fini.
 */
function fzsLignesJoueurs(tonight) {
    const { names, games, lines, total } = fzsLignesDuSoir(tonight);
    const avant = fzsJoueursAvantMatch(tonight, names);
    const lignes = lines.map(p => {
        const g = games.find(x => x.id === p.gameId) || {};
        const live = FZS_EN_DIRECT(g);
        const club = p.teamAbbrev;
        const gardien = p.position === 'G';
        const pts = fzdPointsCeSoir(p);
        const match = g.away ? `${g.away.abbrev} @ ${g.home.abbrev}` : club;
        return {
            rang: live ? 0 : 2, tri: -pts, live, nom: p.playerName, club,
            pos: fzsPosition(getPlayerStats(p.playerName)?.position || p.position),
            statut: live ? `${match}${fzsPeriode(g) ? ` · ${fzsPeriode(g)}` : ''}`
                : g.away ? `Final · ${g.away.abbrev} ${g.away.score} – ${g.home.abbrev} ${g.home.score}` : 'Final',
            stat: gardien ? `${p.saves || 0} ARR · ${p.goalsAgainst || 0} BA` : `${p.goals || 0} B · ${p.assists || 0} A`,
            pts: pts > 0 ? `+${fzsPts(pts)}` : '0', marque: pts > 0
        };
    });
    avant.forEach(a => lignes.push({
        rang: 1, tri: Date.parse(a.depart) || 0, live: false, nom: a.name, club: a.info.teamAbbrev,
        pos: fzsPosition(a.info.position !== 'N/A' ? a.info.position : ''),
        statut: `${fzsContre(a.info.teamAbbrev, a.away, a.home)} · ${gameTimeLabel(a.depart)}`,
        stat: '', pts: '—', avenir: true
    }));
    lignes.sort((x, y) => x.rang - y.rang || x.tri - y.tri);
    return { lignes, total, names, joue: lines.length > 0 };
}

/** Un joueur cliquable : sa fiche de carrière s'ouvre (fzhOpenPlayerCareer). */
function fzsAttrsJoueur(nom, id) {
    const pid = id || getPlayerStats(nom)?.playerId;
    return pid ? ` data-fzs-joueur="${escapeHTML(pid)}" data-fzs-nom="${escapeHTML(nom)}" role="button" tabindex="0"` : '';
}

function fzsJoueursHTML(tonight, activeName) {
    const esc = escapeHTML;
    const { lignes, total, names, joue } = fzsLignesJoueurs(tonight);
    const href = fzdMonEffectifHref(activeName, FZPool.team().name);
    let corps;
    if (lignes.length) {
        corps = `<ul class="fzs-list">${lignes.map(l => `
            <li class="fzs-row"${fzsAttrsJoueur(l.nom)}>
                ${offPlayerFaceHTML(l.nom, l.club)}
                <span class="fzs-row-txt">
                    <span class="fzs-row-name">${esc(l.nom)} <small>${esc(l.pos)}</small></span>
                    <span class="fzs-row-sub${l.live ? ' is-live' : ''}">${l.live ? '<i class="fzs-dot"></i>' : ''}${esc(l.statut)}</span>
                </span>
                ${l.stat ? `<span class="fzs-row-stat">${esc(l.stat)}</span>` : ''}
                <span class="fzs-row-pts${l.avenir ? ' is-off' : ''}${l.marque ? ' is-up' : ''}">${esc(l.pts)}</span>
            </li>`).join('')}</ul>`;
    } else {
        const prochain = fzsProchainSoir([...names]);
        corps = `<p class="fzs-empty">Aucun de tes joueurs ne joue ce soir.${prochain ? ` Prochain match ${esc(prochain.libelle)} · ${fzsPluriel(prochain.n, 'joueur')}.` : ''}</p>`;
    }
    const pastille = joue ? fzsPastille(`${total > 0 ? '+' : ''}${fzsPts(total)} pts`)
        : lignes.length ? fzsPastille(fzsPluriel(lignes.length, 'joueur')) : '';
    return `<section class="fzs-sec fzs-mine" aria-label="Mes joueurs ce soir">
            ${fzsTete('crosse', 'Mes joueurs ce soir', pastille)}
            ${corps}
            ${fzsPied(href, 'Mon alignement')}
        </section>`;
}

/* La soirée se relit seule pendant les matchs : à chaque point qui tombe
   (pointsDirect.js le signale, voir fzdActualiserPointsDirect) et, tant
   qu'un match joue, toutes les 30 s. Onglet caché : rien. */
const FZS_SOIREE_MS = 30 * 1000;
let fzsSoireeMinuteur = null;
let fzsSoireeEnVol = false;
let fzsDepartMinuteur = null;

function fzsActualiserSoiree(tonight) {
    const root = document.getElementById('fzSeasonHome');
    if (!root || !fzsRangContexte) return;
    const bloc = root.querySelector('.fzs-mine');
    if (bloc) bloc.outerHTML = fzsJoueursHTML(tonight, fzsRangContexte.activeName);
    fzsActualiserMatchs();
    fzsActualiserClassement();
}

async function fzsRafraichirSoiree() {
    if (fzsSoireeEnVol || document.hidden || !document.getElementById('fzSeasonHome')) return;
    fzsSoireeEnVol = true;
    try {
        const tonight = await fetchTonightBoxscores();
        if (!document.getElementById('fzSeasonHome')) return;
        calTonight = tonight;
        fzsActualiserSoiree(tonight);
    } finally {
        fzsSoireeEnVol = false;
    }
}

/** Un match qui joue, ou qui devrait avoir commencé d'après le calendrier du jour. */
function fzsSoireeEnCours(tonight) {
    if ((tonight?.games || []).some(FZS_EN_DIRECT)) return true;
    const jour = calData?.days.find(d => d.date === todayISO());
    const maintenant = Date.now();
    return (jour?.games || []).some(g => ['FUT', 'PRE', 'LIVE', 'CRIT'].includes(g.state)
        && Date.parse(g.startTimeUTC) <= maintenant
        && !(tonight?.games || []).some(x => x.id === g.id && FZS_FINI(x)));
}

function fzsReglerSuiviSoiree(tonight) {
    const actif = fzsSoireeEnCours(tonight);
    if (actif && !fzsSoireeMinuteur) fzsSoireeMinuteur = setInterval(fzsRafraichirSoiree, FZS_SOIREE_MS);
    else if (!actif && fzsSoireeMinuteur) { clearInterval(fzsSoireeMinuteur); fzsSoireeMinuteur = null; }
    fzsPlanifierDepart();
}

/** À la prochaine mise au jeu, la soirée se relit et son suivi démarre. */
function fzsPlanifierDepart() {
    clearTimeout(fzsDepartMinuteur);
    fzsDepartMinuteur = null;
    const jour = calData?.days?.find(d => d.date === todayISO());
    const maintenant = Date.now();
    const prochain = ((jour && jour.games) || [])
        .map(g => Date.parse(g.startTimeUTC))
        .filter(t => Number.isFinite(t) && t > maintenant)
        .sort((a, b) => a - b)[0];
    if (!prochain) return;
    fzsDepartMinuteur = setTimeout(() => {
        fzsDepartMinuteur = null;
        fzsRafraichirSoiree().then(() => fzsReglerSuiviSoiree(calTonight));
    }, Math.min(prochain - maintenant + 5000, 6 * 60 * 60 * 1000));
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && fzsSoireeMinuteur) fzsRafraichirSoiree();
});

/* ---- La semaine : meilleurs joueurs et classements par position ----
   Une seule lecture de /hot-players-last7days (en cache 15 min au serveur)
   nourrit les deux sections. Les points suivent le barème du pool : au
   cumulatif, buts + aides (et le barème des gardiens) ; en tête-à-tête,
   les points fantasy. */
const FZS_SEMAINE_MS = 10 * 60 * 1000;
let fzsSemaine = { data: null, lu: 0, requete: null };

function fzsChargerSemaine() {
    if (fzsSemaine.data && Date.now() - fzsSemaine.lu < FZS_SEMAINE_MS) return Promise.resolve(fzsSemaine.data);
    if (fzsSemaine.requete) return fzsSemaine.requete;
    fzsSemaine.requete = fetch(`${BASE_URL}/hot-players-last7days`)
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
        .then(data => {
            fzsSemaine = { data, lu: Date.now(), requete: null };
            return data;
        });
    return fzsSemaine.requete;
}

function fzsPointsSemaine(p) {
    if (fzdPoolH2H()) return Math.round(p.totalFantasyPoints || 0);
    return p.position === 'G' ? goaliePoolPoints(p) : (p.points || 0);
}

/** Les joueurs triés au barème du pool, sans ceux qui n'ont rien marqué. */
function fzsTrierSemaine(liste) {
    return (liste || []).map(p => ({ ...p, pts: fzsPointsSemaine(p) }))
        .sort((a, b) => b.pts - a.pts || (b.totalFantasyPoints || 0) - (a.totalFantasyPoints || 0));
}

/** Qui possède quel joueur dans le pool actif : clé de nom → équipe. */
function fzsProprietaires() {
    const equipes = (FZPool.data() || {}).teams || {};
    const map = new Map();
    Object.entries(equipes).forEach(([equipe, td]) => {
        ['offensive', 'defensive', 'goalie', 'rookie'].forEach(cle => (td?.[cle] || []).forEach(nom => map.set(fzsCle(nom), equipe)));
    });
    return map;
}

function fzsLigneStats(p) {
    return p.position === 'G' ? `${p.wins || 0} V · ${p.saves || 0} ARR` : `${p.goals || 0} B · ${p.assists || 0} A`;
}

function fzsMeilleursHTML() {
    return `<section class="fzs-sec fzs-top" aria-label="Meilleurs de la semaine" data-fzs-semaine>
            ${fzsTete('trophee', 'Meilleurs de la semaine', fzsPastille('7 jours'))}
            <ul class="fzs-rail fzs-top-list" aria-busy="true">${'<li class="fzs-top-card is-bone"></li>'.repeat(3)}</ul>
            ${fzsPied('stats.html', 'Voir tous les joueurs')}
        </section>`;
}

function fzsRemplirMeilleurs(data) {
    const bloc = document.querySelector('#fzSeasonHome .fzs-top');
    if (!bloc) return;
    const joueurs = fzsTrierSemaine(data && data.topPlayers).filter(p => p.pts > 0).slice(0, 10);
    if (!joueurs.length) { bloc.hidden = true; return; }
    const esc = escapeHTML;
    const proprios = fzsProprietaires();
    const moi = FZPool.team().name;
    const liste = bloc.querySelector('.fzs-top-list');
    liste.removeAttribute('aria-busy');
    liste.innerHTML = joueurs.map((p, i) => `
        <li class="fzs-top-card" style="--club:${esc(fzsCouleurClub(p.teamAbbrev))}"${fzsAttrsJoueur(p.playerName, p.playerId)}>
            <span class="fzs-top-img">
                <img class="fzs-top-logo" src="teams/${esc(p.teamAbbrev)}.png" alt="" loading="lazy" onerror="this.remove()">
                <img class="fzs-top-mug" src="${esc(p.headshot || '')}" alt="" loading="lazy" onerror="this.remove()">
                <span class="fzs-top-rank">${i + 1}</span>
                ${proprios.get(fzsCle(p.playerName)) === moi ? '<span class="fzs-top-mine">À TOI</span>' : ''}
            </span>
            <span class="fzs-top-body">
                <span class="fzs-top-name">${esc(p.playerName)} <small>${esc(fzsPosition(p.position))}</small></span>
                <span class="fzs-top-line">${esc(fzsLigneStats(p))}</span>
                <strong>${fzsPts(p.pts)}</strong>
            </span>
        </li>`).join('');
}

/* Classements de la semaine : un onglet par position, et le filtre des
   joueurs libres. L'état survit aux redessins de la soirée. */
const FZS_POSITIONS = [['ATT', 'ATT', 'forwards'], ['DEF', 'DÉF', 'defensemen'], ['GAR', 'GAR', 'goalies']];
const fzsClassement = { pos: 'ATT', libres: false, plus: false };

/** Ce soir pour un club : en jeu, final, l'heure et l'adversaire, ou repos. */
function fzsCeSoirClub(club, matchs) {
    const g = matchs.find(m => m.away.abbrev === club || m.home.abbrev === club);
    if (!g) return 'Repos';
    if (FZS_EN_DIRECT(g)) return `${fzsContre(club, g.away.abbrev, g.home.abbrev)} · En jeu`;
    if (FZS_FINI(g)) return `${fzsContre(club, g.away.abbrev, g.home.abbrev)} · Final`;
    return `${fzsContre(club, g.away.abbrev, g.home.abbrev)} · ${g.startTimeUTC ? gameTimeLabel(g.startTimeUTC) : 'ce soir'}`;
}

function fzsClassementHTML() {
    const esc = escapeHTML;
    const etat = fzsClassement;
    const data = fzsSemaine.data;
    const [, , cle] = FZS_POSITIONS.find(([k]) => k === etat.pos);
    const proprios = fzsProprietaires();
    const moi = FZPool.team().name;
    let joueurs = fzsTrierSemaine(data && data[cle]).map(p => ({ ...p, proprio: proprios.get(fzsCle(p.playerName)) || null }));
    if (etat.libres) joueurs = joueurs.filter(p => !p.proprio);
    const visibles = joueurs.slice(0, etat.plus ? 10 : 5);
    const matchs = fzsMatchsDuJour(calTonight);
    const onglets = FZS_POSITIONS.map(([k, libelle]) =>
        `<button type="button" class="fzs-tab" data-fzs-pos="${k}" aria-pressed="${k === etat.pos}">${libelle}</button>`).join('');
    const lignes = !data ? '<p class="fzs-empty">Chargement…</p>'
        : visibles.length ? `<ul class="fzs-list">${visibles.map(p => {
            const mien = p.proprio === moi;
            const qui = p.proprio ? p.proprio : 'Libre';
            return `<li class="fzs-rank-row${mien ? ' is-me' : ''}"${fzsAttrsJoueur(p.playerName, p.playerId)}>
                <span class="fzs-rank-who">
                    <span class="fzd-off-face">${esc(p.playerName.charAt(0))}${p.headshot ? `<img src="${esc(p.headshot)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
                    <span class="fzs-row-txt">
                        <span class="fzs-row-name">${esc(p.playerName)} <small>${esc(fzsPosition(p.position))}</small></span>
                        <span class="fzs-row-sub${mien ? ' is-me' : p.proprio ? '' : ' is-free'}">${esc(mien ? `${qui} · toi` : qui)}</span>
                    </span>
                </span>
                <span class="fzs-rank-tonight">${esc(fzsCeSoirClub(p.teamAbbrev, matchs))}</span>
                <span class="fzs-rank-pts">${fzsPts(p.pts)}</span>
            </li>`;
        }).join('')}</ul>`
        : `<p class="fzs-empty">${etat.libres ? 'Aucun joueur libre à cette position.' : 'Aucun match joué cette semaine.'}</p>`;
    const plus = joueurs.length > 5
        ? `<button type="button" class="fzs-foot" data-fzs-plus aria-expanded="${etat.plus}">${etat.plus ? 'Voir moins' : 'Voir plus'}</button>` : '';
    return `<section class="fzs-sec fzs-ranks" aria-label="Classements de la semaine">
            ${fzsTete('rangs', 'Classements de la semaine')}
            <div class="fzs-tabs" role="group" aria-label="Position">${onglets}</div>
            <button type="button" class="fzs-toggle" data-fzs-libres aria-pressed="${etat.libres}">Joueurs libres seulement<span class="fzs-switch" aria-hidden="true"><i></i></span></button>
            ${visibles.length ? '<div class="fzs-rank-head" aria-hidden="true"><span>Joueurs</span><span>Ce soir</span><span>Pts</span></div>' : ''}
            ${lignes}
            ${plus}
        </section>`;
}

function fzsActualiserClassement() {
    const bloc = document.querySelector('#fzSeasonHome .fzs-ranks');
    if (bloc) bloc.outerHTML = fzsClassementHTML();
}

async function fzsRendreSemaine() {
    const data = await fzsChargerSemaine();
    if (!document.getElementById('fzSeasonHome')) return;
    fzsRemplirMeilleurs(data);
    fzsActualiserClassement();
}

/* ---- Activité de la ligue ----
   Les offres reçues d'abord (userData.pendingTrades, déjà lues), puis le
   marché et le fil du pool (fzhChargerLigue, accueil-watch.js) : trois
   lignes, le reste au marché des échanges. */
function fzsActiviteHTML() {
    return `<section class="fzs-sec fzs-activity" aria-label="Activité de la ligue">
            ${fzsTete('fil', 'Activité de la ligue')}
            <ul class="fzs-list" aria-busy="true">${'<li class="fzs-row is-bone"><span class="fzd-off-face"></span><span class="fzs-row-txt"><span></span><span></span></span></li>'.repeat(3)}</ul>
            ${fzsPied('trade.html', 'Marché et échanges')}
        </section>`;
}

const FZS_FIL = {
    trade_completed: ['Échange conclu', 'is-green'],
    listing_activated: ['En vente', 'is-gold'],
    listing_removed: ['Marché', ''],
    h2h_week_finalized: ['Semaine', ''],
    draft_complete: ['Repêchage', '']
};

function fzsActiviteLigneHTML({ nom, tag, ton, quand, texte, cta, href }) {
    const esc = escapeHTML;
    const balise = href ? 'a' : 'div';
    return `<li><${balise} class="fzs-row fzs-act"${href ? ` href="${esc(href)}"` : ''}>
            ${nom ? offPlayerFaceHTML(nom, '') : `<span class="fzd-off-face is-icon">${fzsIcone('fil', 18)}</span>`}
            <span class="fzs-row-txt">
                <span class="fzs-act-tag ${ton || ''}">${esc(tag)}${quand ? ` · ${esc(quand)}` : ''}</span>
                <span class="fzs-act-text">${esc(texte)}</span>
            </span>
            ${cta ? `<span class="fzs-act-cta">${esc(cta)}</span>` : ''}
        </${balise}></li>`;
}

async function fzsRendreActivite(activeName) {
    const donnees = typeof fzhChargerLigue === 'function' ? await fzhChargerLigue(activeName) : null;
    const bloc = document.querySelector('#fzSeasonHome .fzs-activity');
    if (!bloc) return;
    const quand = iso => (iso && typeof relativeTimeFr === 'function' ? relativeTimeFr(iso) : '');
    const noms = liste => (liste || []).map(p => (typeof p === 'string' ? p : p?.name)).filter(Boolean);
    const offres = (userData.pendingTrades || []).filter(t => t.draftName === activeName).map(t => ({
        nom: noms(t.offering)[0], tag: 'Offre reçue', ton: 'is-ink', quand: quand(t.date),
        texte: `${t.fromTeam} t’offre ${noms(t.offering).join(', ')} pour ${noms(t.receiving).join(', ')}`,
        cta: 'Voir', href: `trade.html?trade=${encodeURIComponent(t.id)}`
    }));
    const marche = ((donnees && donnees.marche) || []).map(a => {
        const code = typeof fzhCodeCategorie === 'function' ? fzhCodeCategorie(a.category) : '';
        return {
            nom: code === 'T' ? '' : a.playerName, tag: 'En vente', ton: 'is-gold', quand: quand(a.createdAt),
            texte: a.mienne ? `Tu as mis ${a.playerName} sur le marché` : `${a.teamName} met ${a.playerName} sur le marché`,
            cta: a.mienne ? 'Voir' : 'Offrir',
            href: a.mienne ? 'trade.html'
                : `trade.html?withTeam=${encodeURIComponent(a.teamName)}&wantPlayer=${encodeURIComponent(a.playerName)}${code ? `&category=${code}` : ''}`
        };
    });
    // Une annonce ouverte est déjà une ligne « En vente » : son entrée de fil la répéterait.
    const fil = ((donnees && donnees.fil) || []).filter(e => e.type !== 'listing_activated').map(e => {
        const [tag, ton] = FZS_FIL[e.type] || ['Pool', ''];
        const sujet = e.sujet || {};
        return { nom: noms(sujet.offering)[0] || sujet.playerName || '', tag, ton, quand: quand(e.moment), texte: e.texte || '' };
    });
    const lignes = [...offres, ...marche, ...fil].slice(0, 3);
    const liste = bloc.querySelector('.fzs-list');
    if (!lignes.length) {
        liste.outerHTML = '<p class="fzs-empty">Rien de neuf dans la ligue. Mets un joueur en vente depuis ton alignement pour lancer les échanges.</p>';
        return;
    }
    liste.removeAttribute('aria-busy');
    liste.innerHTML = lignes.map(fzsActiviteLigneHTML).join('');
}

/* ---- Alignements des 32 clubs ----
   Le choix d'un club ouvre son alignement à l'onglet Alignements des Stats
   (statsLineup.js) ; le dernier club consulté y est retenu, on le marque. */
function fzsAlignementsHTML() {
    const esc = escapeHTML;
    const clubs = typeof FZH_AL_CLUBS !== 'undefined' ? FZH_AL_CLUBS : [];
    const url = typeof FZH_LINES_URL !== 'undefined' ? FZH_LINES_URL : 'stats.html?onglet=alignements';
    let dernier = null;
    try { dernier = localStorage.getItem('fzLineupTeam'); } catch (e) { /* navigation privée */ }
    return `<section class="fzs-sec fzs-lines" aria-labelledby="fzsLinesTitre">
            <header class="fzs-sh">${fzsIcone('trios')}<h2 id="fzsLinesTitre">Alignements</h2>${fzsPastille('32 clubs')}</header>
            <ul class="fzs-lines-grid" aria-label="Choisir un club">${clubs.map(([code, nom]) => `
                <li><a class="fzs-club${code === dernier ? ' is-sel' : ''}" href="${esc(url)}&amp;equipe=${esc(code)}" title="${esc(nom)}" aria-label="Alignement : ${esc(nom)}">
                    <img src="teams/${esc(code)}.png" alt="" width="30" height="30" loading="lazy" onerror="this.style.visibility='hidden'"><span>${esc(code)}</span>
                </a></li>`).join('')}
            </ul>
            ${fzsPied(url, 'Trios, paires et unités spéciales')}
        </section>`;
}

/* ---- Clics délégués : onglets, filtre, « voir plus » et fiches ---- */
document.addEventListener('click', e => {
    const root = document.getElementById('fzSeasonHome');
    if (!root || !root.contains(e.target)) return;
    const pos = e.target.closest('[data-fzs-pos]');
    if (pos) { fzsClassement.pos = pos.dataset.fzsPos; fzsClassement.plus = false; fzsActualiserClassement(); return; }
    if (e.target.closest('[data-fzs-libres]')) { fzsClassement.libres = !fzsClassement.libres; fzsActualiserClassement(); return; }
    if (e.target.closest('[data-fzs-plus]')) {
        fzsClassement.plus = !fzsClassement.plus;
        fzsActualiserClassement();
        if (!fzsClassement.plus) root.querySelector('.fzs-ranks')?.scrollIntoView({ block: 'nearest' });
        return;
    }
    const joueur = e.target.closest('[data-fzs-joueur]');
    if (joueur && !e.target.closest('a') && typeof fzhOpenPlayerCareer === 'function') {
        fzhOpenPlayerCareer(joueur.dataset.fzsJoueur, joueur.dataset.fzsNom);
    }
});
document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const joueur = e.target.closest?.('#fzSeasonHome [data-fzs-joueur]');
    if (!joueur || typeof fzhOpenPlayerCareer !== 'function') return;
    e.preventDefault();
    fzhOpenPlayerCareer(joueur.dataset.fzsJoueur, joueur.dataset.fzsNom);
});

function renderSeasonHome({ tonight, movement, activeName }) {
    const state = fzdHeroState(tonight);
    if (!state || state.mode === 'draft' || fzdSeasonStarted() === false) {
        fzsReset();
        return false;
    }
    fzdRestoreCalendar();
    document.getElementById('fzMobileHome').innerHTML = '';
    fzdStopHeroTimer('fzDashHero');
    fzdStopHeroTimer('fzmHeroSlot');
    const section = document.getElementById('fzDashSection');
    section.classList.add('is-season');
    document.body.classList.add('fz-season-page');
    let root = document.getElementById('fzSeasonHome');
    if (!root) {
        root = document.createElement('div');
        root.id = 'fzSeasonHome';
        root.className = 'fzs';
        section.querySelector('.fz-dash').appendChild(root);
    }
    const estH2H = fzdPoolH2H();
    // Au téléphone, une colonne dans l'ordre de la maquette ; au bureau, deux
    // colonnes (.fzs-col) que la feuille de style aplatit au téléphone. Le
    // bandeau d'histoires (« histoires ») reste caché ici : on ne lui prend
    // que son direct, pour les cartes de match. Le calendrier, lui, n'a pas
    // d'emplacement : son horaire du jour nourrit les matchs et mes joueurs.
    root.innerHTML = `
        <div class="fzs-col fzs-col-a">
            ${fzsHeroHTML(activeName, movement)}
            ${fzsJoueursHTML(tonight, activeName)}
            ${estH2H ? `<section class="fzs-sec fzs-duel" id="fzsDuel" aria-live="polite">${fzsTete('duel', 'Mon duel', `<a class="fzs-sh-link" href="classement.html?pool=${encodeURIComponent(activeName)}&amp;h2h=duel">Voir le duel</a>`)}<div class="fzs-duel-body"><p class="fzs-empty">Chargement du duel…</p></div></section>` : ''}
            ${fzsActiviteHTML()}
        </div>
        <div class="fzs-col fzs-col-b">
            ${fzsMatchsHTML(tonight)}
            ${fzsMeilleursHTML()}
            ${fzsClassementHTML()}
        </div>
        ${fzsAlignementsHTML()}
        <div class="fzs-slot fzs-read" data-fz-bloc="actualites"></div>
        <div class="fzs-slot" data-fz-bloc="histoires" hidden></div>`;
    fzdPlaceCalendar();
    if (estH2H) fzsLoadDuel(root, activeName, FZPool.team().name);
    fzsRendreSemaine();
    fzsRendreActivite(activeName);
    fzsReglerSuiviSoiree(tonight);
    fzsReglerTic();
    return true;
}

/* ---- Mon duel (tête-à-tête) ----
   Le duel en cours, sinon le prochain, sinon le dernier joué — la règle vit
   dans lib/duelAccueil.js. Les points d'une semaine en cours viennent de
   /h2h/current-week-scores : le calendrier, lui, ne les porte qu'une fois la
   semaine finalisée. */
const FZS_MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function fzsJourCourt(iso) {
    if (!iso) return '';
    const [a, m, j] = String(iso).slice(0, 10).split('-').map(Number);
    return a ? `${j} ${FZS_MOIS[m - 1]}` : '';
}

async function fzsLoadDuel(root, activeName, monEquipe) {
    const corps = root.querySelector('#fzsDuel .fzs-duel-body');
    if (!corps || !window.FZDuelAccueil) return;
    const esc = escapeHTML;
    const lire = url => fetch(url, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const cal = await lire(`${BASE_URL}/h2h/season-schedule?poolName=${encodeURIComponent(activeName)}`);
    if (!corps.isConnected) return;

    const equipe = (cal && cal.monEquipe) || monEquipe;
    const duel = cal && cal.status === 'ok' ? FZDuelAccueil.duelAAfficher(cal.weeks, equipe) : null;
    if (!duel) {
        corps.innerHTML = `<p class="fzs-empty">Le calendrier des duels sera prêt une fois le repêchage terminé.</p>`;
        return;
    }

    // Semaine en cours : les points qui bougent.
    if (duel.mode === 'encours') {
        const direct = await lire(`${BASE_URL}/h2h/current-week-scores?poolName=${encodeURIComponent(activeName)}`);
        const carte = direct && (direct.matchups || []).find(m => m.team1 === equipe || m.team2 === equipe);
        if (carte) {
            const premier = carte.team1 === equipe;
            duel.moi.points = Number(premier ? carte.team1Points : carte.team2Points) || 0;
            duel.adversaire.points = Number(premier ? carte.team2Points : carte.team1Points) || 0;
        }
        if (!corps.isConnected) return;
    }

    const pts = fzsPts;
    const statut = duel.mode === 'encours'
        ? `<span class="fzs-tag is-live">En cours</span> Semaine ${duel.semaine} · jusqu’au ${fzsJourCourt(duel.fin)}`
        : duel.mode === 'avenir'
            ? `<span class="fzs-tag">À venir</span> Semaine ${duel.semaine} · dès le ${fzsJourCourt(duel.debut)}`
            : `<span class="fzs-tag">${duel.issue === 'victoire' ? 'Victoire' : duel.issue === 'defaite' ? 'Défaite' : 'Nulle'}</span> Semaine ${duel.semaine}${duel.finalise ? '' : ' · résultat provisoire'}`;
    const menene = duel.mode === 'avenir' ? '' :
        duel.moi.points > duel.adversaire.points ? 'is-ahead'
        : duel.moi.points < duel.adversaire.points ? 'is-behind' : '';
    const precedent = duel.precedent
        ? `<p class="fzs-duel-prev">Semaine ${duel.precedent.semaine} : ${duel.precedent.issue === 'victoire' ? 'victoire' : duel.precedent.issue === 'defaite' ? 'défaite' : 'nulle'}
               ${pts(duel.precedent.moi.points)}–${pts(duel.precedent.adversaire.points)} contre ${esc(duel.precedent.adversaire.nom)}</p>`
        : '';

    corps.innerHTML = `
        <div class="fzs-duel-score ${menene}">
            <div class="fzs-duel-side is-me"><span>${esc(duel.moi.nom)}</span><strong>${duel.mode === 'avenir' ? '—' : pts(duel.moi.points)}</strong></div>
            <span class="fzs-duel-vs" aria-hidden="true">vs</span>
            <div class="fzs-duel-side"><span>${esc(duel.adversaire.nom)}</span><strong>${duel.mode === 'avenir' ? '—' : pts(duel.adversaire.points)}</strong></div>
        </div>
        <p class="fzs-duel-status">${statut}</p>
        ${precedent}`;
}
