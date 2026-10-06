/* In-season home: shared markup and existing NHL/pool data on every viewport. */
function fzsReset() {
    fzdRestoreCalendar();
    document.getElementById('fzSeasonHome')?.remove();
    document.getElementById('fzDashSection')?.classList.remove('is-season');
    document.body.classList.remove('fz-season-page');
}

function fzsHeading(title, link, label = 'Voir tout') {
    return `<header class="fzs-head"><h2>${title}</h2>${link ? `<a href="${escapeHTML(link)}">${label} <span aria-hidden="true">→</span></a>` : ''}</header>`;
}

/* ---- Ma position ----
   Le rang et le total vivent avec les points du soir (pointsDirect.js) :
   un but d'un de mes joueurs les fait bouger sur place, sans redessiner
   tout l'accueil (voir fzsActualiserRang). Dessous, la semaine du rang —
   les instantanés du matin (/pool-rank-movement) — et ce que l'équipe a
   marqué sur 24 h, 7 et 30 jours (/pool-my-points). */
let fzsRangContexte = null;
function fzsRangHTML(activeName, movement) {
    const pool = (userData.userPools || []).find(p => p.name === activeName);
    const scores = pool ? buildTeamScores(pool) : [];
    const claimed = scores.filter(t => t.memberCount > 0);
    const ranking = claimed.length ? claimed : scores;
    const rank = ranking.findIndex(t => t.isCurrentUser);
    const mine = ranking[rank];
    const change = movement?.teams?.find(t => t.teamName === FZPool.team().name);
    // Le rang « maintenant » du serveur ignore les points du soir : dès
    // qu'il y en a dans ce pool, c'est le rang affiché qui fait foi. Sans
    // eux, on garde celui du serveur — les égalités s'y départagent pareil
    // que dans l'instantané du matin.
    const soir = ranking.some(t => t.live);
    const rangActuel = soir && rank >= 0 ? rank + 1 : change?.rankNow;
    const delta = movement?.hasSnapshot && change?.rankToday != null && rangActuel != null ? change.rankToday - rangActuel : null;
    // La pastille s'allume quand elle vient de monter — pas à chaque
    // redessin, que le but d'un autre pool suffit à provoquer.
    const avant = fzsRangContexte && fzsRangContexte.activeName === activeName ? fzsRangContexte.live : null;
    const soirMoi = (mine && mine.live) || 0;
    fzsRangContexte = { activeName, movement, live: soirMoi };
    const neuf = avant !== null && soirMoi > avant ? ' is-new' : '';
    const live = soirMoi ? `<b class="fzs-live-pts${neuf}">+${soirMoi.toLocaleString('fr-CA')} ce soir</b>` : '';
    const semaine = fzsSemaineRang(movement?.history, rangActuel ?? (rank >= 0 ? rank + 1 : null), todayISO());
    return `${fzsHeading('♜ &nbsp; Ma position', `classement.html?pool=${encodeURIComponent(activeName)}`, 'Voir le classement')}
            <div class="fzs-rank-main">
                <div class="fzs-rank-now">
                    <strong class="fzs-number">${rank >= 0 ? `${ordinalHTML(rank + 1)} <small>/ ${ranking.length}</small>` : '—'}</strong>
                    <p>${mine ? `${Number(mine.score).toLocaleString('fr-CA')} pts ${live}` : 'Classement à venir'}</p>
                    ${delta ? `<p class="${delta > 0 ? 'fzs-green' : 'fzs-red'}">${delta > 0 ? '↑ +' : '↓ '}${delta} <span>depuis le début de la journée</span></p>` : ''}
                </div>
                ${fzsCourbeRangHTML(semaine, ranking.length)}
            </div>
            ${fzsPeriodesHTML(fzsValeursPeriodes(activeName, soirMoi))}`;
}

function fzsActualiserRang() {
    const bloc = document.querySelector('#fzSeasonHome .fzs-rank');
    if (!bloc || !fzsRangContexte) return;
    bloc.innerHTML = fzsRangHTML(fzsRangContexte.activeName, fzsRangContexte.movement);
    // Le premier point du soir — ou minuit passé : la « dernière soirée »
    // lue tantôt est devenue celle d'hier. Relue au plus aux cinq minutes ;
    // le minuteur de bascule (fzsPlanifierBascule) fait l'essentiel.
    const etat = fzsPoints;
    const perimee = etat && etat.data && Object.values(etat.data.periods || {})
        .some(p => p.dernierJour !== todayISO());
    if (perimee && fzsRangContexte.live > 0 && !etat.enVol && Date.now() - etat.lu > FZS_POINTS_RELIRE_MS) {
        fzsChargerPoints(fzsRangContexte.activeName, { force: true });
    }
}

/**
 * Mon rang au soir de chacun des sept derniers jours, le dernier étant
 * maintenant. L'instantané du matin J fige le soir de J-1 (snapshotAllPoolRanks,
 * server.js). Un soir sans instantané — serveur endormi à minuit, saison pas
 * encore ouverte — reste vide plutôt qu'inventé.
 */
function fzsSemaineRang(history, rangActuel, aujourdhui) {
    const parMatin = new Map((history || []).map(h => [h.date, h.rank]));
    const jours = [];
    for (let i = 6; i >= 1; i--) {
        const soir = shiftISO(aujourdhui, -i);
        jours.push({ date: soir, rang: parMatin.get(shiftISO(soir, 1)) ?? null });
    }
    jours.push({ date: aujourdhui, rang: rangActuel ?? null, maintenant: true });
    return jours;
}

const fzsOrdinal = n => `${n}${n === 1 ? 're' : 'e'}`;

/**
 * La semaine du rang : une ligne, le 1er rang en haut. Les points sont des
 * <span> posés en pourcentage sur la colonne de leur jour — nets à toute
 * largeur — ; seule la ligne est un SVG étiré, d'un trait qui ne s'étire pas.
 * Le survol d'une colonne dit son rang ; la liste masquée le dit aux
 * lecteurs d'écran.
 */
function fzsCourbeRangHTML(jours, taille) {
    const vus = jours.filter(j => j.rang != null);
    const titre = '<figcaption class="fzs-week-cap"><span>7 derniers jours</span>';
    if (vus.length < 2) {
        return `<figure class="fzs-week">${titre}</figcaption>
            <p class="fzs-week-empty">Votre courbe se dessine soir après soir.</p></figure>`;
    }
    const gain = vus[0].rang - vus[vus.length - 1].rang;
    const tendance = gain > 0 ? `<b class="fzs-green">↑ ${gain} place${gain > 1 ? 's' : ''}</b>`
        : gain < 0 ? `<b class="fzs-red">↓ ${-gain} place${gain < -1 ? 's' : ''}</b>`
        : '<b>Stable</b>';
    // Un petit pool tient en entier ; un grand se resserre sur les rangs
    // visités, une place de marge de chaque côté.
    const rangs = vus.map(j => j.rang);
    let haut = 1;
    let bas = Math.max(taille || 1, ...rangs);
    if (bas > 8) {
        haut = Math.max(1, Math.min(...rangs) - 1);
        bas = Math.min(bas, Math.max(...rangs) + 1);
    }
    const y = r => (bas === haut ? 50 : 8 + (r - haut) / (bas - haut) * 84);
    const x = i => (i + 0.5) / jours.length * 100;
    // La ligne s'interrompt sur un soir sans instantané.
    let trace = '';
    let enCours = false;
    jours.forEach((j, i) => {
        if (j.rang == null) { enCours = false; return; }
        trace += `${enCours ? 'L' : 'M'}${x(i).toFixed(2)} ${y(j.rang).toFixed(2)} `;
        enCours = true;
    });
    const jourCourt = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-CA', { weekday: 'short', timeZone: 'UTC' });
    const jourLong = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const dit = j => `${j.maintenant ? 'Maintenant' : jourLong(j.date)} · ${j.rang == null ? 'aucun relevé' : fzsOrdinal(j.rang)}`;
    const colonnes = jours.map((j, i) => `
        <span class="fzs-week-col${i === 0 ? ' is-first' : ''}${j.maintenant ? ' is-now' : ''}" style="--i:${i}${j.rang == null ? '' : `;--y:${y(j.rang).toFixed(2)}`}">
            ${j.rang == null ? '' : '<i class="fzs-week-pt"></i>'}
            <span class="fzs-week-tip">${escapeHTML(dit(j))}</span>
            <span class="fzs-week-day">${j.maintenant ? 'Auj.' : escapeHTML(jourCourt(j.date))}</span>
        </span>`).join('');
    const repere = (r, cote) => `<span class="fzs-week-tick is-${cote}" style="--y:${y(r).toFixed(2)}">${fzsOrdinal(r)}</span>`;
    return `<figure class="fzs-week">${titre}${tendance}</figcaption>
        <div class="fzs-week-plot" aria-hidden="true">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
                <line class="fzs-week-grid" x1="0" x2="100" y1="${y(haut).toFixed(2)}" y2="${y(haut).toFixed(2)}"></line>
                ${bas !== haut ? `<line class="fzs-week-grid" x1="0" x2="100" y1="${y(bas).toFixed(2)}" y2="${y(bas).toFixed(2)}"></line>` : ''}
                <path class="fzs-week-line" d="${trace.trim()}"></path>
            </svg>
            ${repere(haut, 'top')}${bas !== haut ? repere(bas, 'bottom') : ''}
            ${colonnes}
        </div>
        <ul class="fzs-sr">${jours.map(j => `<li>${escapeHTML(dit(j))}</li>`).join('')}</ul>
    </figure>`;
}

/* ---- Mes points sur 24 h, 7 et 30 jours (/pool-my-points) ----
   Lus après le premier rendu : ils ne retardent pas l'accueil. Entre deux
   lectures, une période qui finit aujourd'hui prend les points du soir tombés
   depuis (le direct, pointsDirect.js) — sans requête. */
const FZS_PERIODES = [
    [1, '24 h', 'La dernière soirée de matchs : celle d’hier jusqu’au premier match du jour, puis celle de ce soir'],
    [7, '7 jours', 'Ces 7 derniers jours — jusqu’à hier tant que le premier match du jour n’est pas commencé'],
    [30, '30 jours', 'Ces 30 derniers jours']
];
const FZS_POINTS_FRAIS_MS = 10 * 60 * 1000;
const FZS_POINTS_RELIRE_MS = 5 * 60 * 1000;
let fzsPoints = null; // { activeName, data, lu, jour, live, enVol }
let fzsBasculeMinuteur = null;

function fzsPeriodesHTML(valeurs) {
    const pts = n => `${n > 0 ? '+' : ''}${Number(n).toLocaleString('fr-CA', { maximumFractionDigits: 1 })}`;
    const cellules = FZS_PERIODES.map(([jours, libelle, titre]) => {
        const v = valeurs ? valeurs[jours] : null;
        return `<div title="${escapeHTML(titre)}"><dt>${libelle}</dt><dd>${v == null ? '<b>—</b>' : `<b>${pts(v)}</b> pts`}</dd></div>`;
    });
    return `<dl class="fzs-periods${valeurs ? '' : ' is-loading'}">${cellules.join('')}</dl>`;
}

/** Les trois nombres, à jour du direct ; null tant que rien n'est lu pour ce pool. */
function fzsValeursPeriodes(activeName, live) {
    const etat = fzsPoints;
    if (!etat || etat.activeName !== activeName || !etat.data) return null;
    const auj = todayISO();
    const valeurs = {};
    FZS_PERIODES.forEach(([jours]) => {
        const p = (etat.data.periods || {})[jours];
        valeurs[jours] = !p || p.points == null ? null
            : p.points + (p.dernierJour === auj ? (live || 0) - (etat.live || 0) : 0);
    });
    return valeurs;
}

async function fzsChargerPoints(activeName, { force = false } = {}) {
    const etat = fzsPoints && fzsPoints.activeName === activeName ? fzsPoints : null;
    if (etat && etat.enVol) return;
    if (!force && etat && etat.data && etat.jour === todayISO() && Date.now() - etat.lu < FZS_POINTS_FRAIS_MS) return;
    fzsPoints = { ...(etat || { activeName, data: null, lu: 0, live: 0 }), enVol: true };
    let data = null;
    try {
        const res = await fetch(`${BASE_URL}/pool-my-points/${encodeURIComponent(activeName)}`, { cache: 'no-store' });
        data = res.ok ? await res.json() : null;
    } catch (err) {
        console.warn('Could not load my period points:', err);
    }
    if (!fzsPoints || fzsPoints.activeName !== activeName) return;
    // Un échec garde la lecture précédente ; pas de nouvel essai avant le
    // prochain rendu de l'accueil.
    fzsPoints = data
        ? { activeName, data, lu: Date.now(), jour: todayISO(), live: fzsRangContexte?.live || 0, enVol: false }
        : { ...fzsPoints, lu: Date.now(), enVol: false };
    if (data) fzsPlanifierBascule(data.bascule);
    fzsActualiserRang();
}

/**
 * Au premier match du jour, la dernière soirée devient ce soir et la semaine
 * glisse d'un jour : les points se relisent à cet instant — une fois.
 */
function fzsPlanifierBascule(bascule) {
    clearTimeout(fzsBasculeMinuteur);
    fzsBasculeMinuteur = null;
    const instant = Date.parse(bascule);
    if (!Number.isFinite(instant)) return;
    fzsBasculeMinuteur = setTimeout(() => {
        fzsBasculeMinuteur = null;
        if (fzsRangContexte && document.getElementById('fzSeasonHome')) {
            fzsChargerPoints(fzsRangContexte.activeName, { force: true });
        }
    }, Math.max(instant - Date.now(), 60 * 1000));
}

/* ---- La soirée de mes joueurs ----
   « Mes joueurs ce soir », « Total ce soir » et la
   répartition lisent les MÊMES lignes (/tonight-boxscores), au barème du pool
   (fzdPointsCeSoir, accueil-dash.js). Au cumulatif, ce sont les vrais points :
   3 buts et 2 aides font 5 PTS sur la ligne, 5 au total, et la répartition
   dit 3 + 2 — l'accueil affichait 17, le barème fantasy du tête-à-tête. */
const FZS_EN_DIRECT = g => g && ['LIVE', 'CRIT'].includes(g.state);

function fzsLignesDuSoir(tonight) {
    const names = new Set(activeRosterNames());
    const games = tonight.games || [];
    const jeu = id => FZS_EN_DIRECT(games.find(g => g.id === id));
    const lines = (tonight.players || []).filter(p => names.has(p.playerName))
        .sort((a, b) => Number(jeu(b.gameId)) - Number(jeu(a.gameId)) || fzdPointsCeSoir(b) - fzdPointsCeSoir(a));
    const playing = lines.filter(p => jeu(p.gameId)).length;
    const total = lines.reduce((n, p) => n + fzdPointsCeSoir(p), 0);
    return { names, games, lines, playing, total };
}

/**
 * Mes joueurs dont le match n'a pas commencé : /tonight-boxscores ne suit que
 * les matchs débutés, donc on croise l'effectif avec le calendrier du jour
 * (calData). Chaque entrée porte l'heure de la mise au jeu et les points de
 * la saison du joueur (le barème du pool), en attendant ceux du soir.
 */
function fzsJoueursAvantMatch(tonight, names) {
    const jour = calData?.days?.find(d => d.date === todayISO());
    const parEquipe = {};
    ((jour && jour.games) || []).filter(g => ['FUT', 'PRE'].includes(g.state)).forEach(g => {
        parEquipe[g.away.abbrev] = { g, contre: g.home.abbrev };
        parEquipe[g.home.abbrev] = { g, contre: g.away.abbrev };
    });
    const dejaLa = new Set((tonight.players || []).map(p => p.playerName));
    const out = [];
    names.forEach(name => {
        if (dejaLa.has(name)) return;
        const info = getPlayerStats(name);
        const match = info && parEquipe[info.teamAbbrev];
        if (!match) return;
        const saison = info.position === 'G' ? goaliePoolPoints(info) : (info.points || 0);
        out.push({
            name, info, contre: match.contre, depart: match.g.startTimeUTC, saison,
            gameId: match.g.id, away: match.g.away.abbrev, home: match.g.home.abbrev
        });
    });
    return out.sort((a, b) => Date.parse(a.depart) - Date.parse(b.depart) || b.saison - a.saison);
}

/** Ce que la répartition additionne : ce qui fait le total, au barème du pool. */
function fzsRepartition(lines) {
    const somme = cle => lines.reduce((n, p) => n + (Number(p[cle]) || 0), 0);
    if (fzdPoolH2H()) {
        // Tête-à-tête : le barème fantasy compte aussi les tirs et les arrêts.
        return [['Buts', somme('goals')], ['Aides', somme('assists')], ['Tirs', somme('shots')], ['Arrêts', somme('saves')]];
    }
    const gardiens = lines.filter(p => p.position === 'G').reduce((n, p) => n + fzdPointsCeSoir(p), 0);
    return [['Buts', somme('goals')], ['Aides', somme('assists')], ['Pts gardiens', gardiens]];
}

/** Les points de la saison d'un joueur, au barème du pool. */
function fzsPointsSaison(info) {
    if (!info) return 0;
    return info.position === 'G' ? goaliePoolPoints(info) : (info.points || 0);
}

/**
 * Les cartes du carrousel « Mes joueurs en direct » : d'abord ceux qui jouent
 * (à gauche), puis ceux dont le match approche — le plus proche en tête —,
 * puis ceux dont le match est fini.
 */
function fzsCartes(lines, avant, games) {
    const cartes = [];
    lines.forEach(p => {
        const g = games.find(x => x.id === p.gameId);
        const live = !!FZS_EN_DIRECT(g);
        const gardien = p.position === 'G';
        cartes.push({
            rang: live ? 0 : 2, tri: -fzdPointsCeSoir(p), live, final: !live,
            nom: p.playerName, equipe: p.teamAbbrev,
            pos: getPlayerStats(p.playerName)?.position || p.position,
            saison: fzsPointsSaison(getPlayerStats(p.playerName)),
            soir: fzdPointsCeSoir(p),
            stats: [[gardien ? p.saves : p.goals, gardien ? 'ARR' : 'B'], [gardien ? p.goalsAgainst : p.assists, gardien ? 'BA' : 'A']],
            // gameLineFor rend déjà du HTML (1<sup>re</sup>, horloge échappée).
            matchHTML: gameLineFor(p, games) || (live ? 'En direct' : 'Final')
        });
    });
    avant.forEach(a => cartes.push({
        rang: 1, tri: Date.parse(a.depart) || 0, live: false, final: false,
        nom: a.name, equipe: a.info.teamAbbrev,
        pos: a.info.position && a.info.position !== 'N/A' ? a.info.position : '',
        saison: a.saison, soir: 0, stats: null, heure: gameTimeLabel(a.depart),
        matchHTML: escapeHTML(`Ce soir ${gameTimeLabel(a.depart)} vs ${a.contre}`)
    }));
    return cartes.sort((x, y) => x.rang - y.rang || x.tri - y.tri);
}

/** Une carte : le joueur sur la couleur de son club, le logo du club en filigrane. */
function fzsCarteHTML(c, href) {
    const esc = escapeHTML;
    const couleur = typeof getTeamColors === 'function' ? getTeamColors(c.equipe)[0] : '#3A414D';
    const mots = c.nom.split(' ');
    const court = mots.length > 1 ? `${mots[0][0]}. ${mots.slice(1).join(' ')}` : c.nom;
    const pts = n => Number(n || 0).toLocaleString('fr-CA', { maximumFractionDigits: 2 });
    const soir = c.live || c.final;
    const soirLibelle = c.soir > 0 ? `+${pts(c.soir)} ↑` : '+0';
    return `<a class="fzs-pc${c.live ? ' is-live' : ''}${c.final ? ' is-final' : ''}" href="${esc(href)}" style="--pc-team:${esc(couleur)}">
        <div class="fzs-pc-top">
            <img class="fzs-pc-logo" src="teams/${esc(c.equipe)}.png" alt="" loading="lazy" onerror="this.remove()">
            ${offPlayerFaceHTML(c.nom, c.equipe)}
            ${c.live ? '<span class="fzs-pc-live"><i></i>EN DIRECT</span>' : c.heure ? `<span class="fzs-pc-time">${esc(c.heure)}</span>` : c.final ? '<span class="fzs-pc-time">FINAL</span>' : ''}
        </div>
        <div class="fzs-pc-body">
            <div class="fzs-pc-name"><strong title="${esc(c.nom)}">${esc(court)}</strong><span>${esc(c.pos)}</span></div>
            <div class="fzs-pc-season"><span>Saison ${pts(c.saison)} pts</span>${soir ? `<b class="${c.soir > 0 ? 'is-up' : ''}">${soirLibelle}</b>` : ''}</div>
            ${c.stats ? `<div class="fzs-pc-stats">${c.stats.map(([v, l]) => `<span>${v} <small>${l}</small></span>`).join('')}<span class="${c.soir > 0 ? 'is-up' : ''}">${pts(c.soir)} <small>PTS</small></span></div>` : ''}
        </div>
        <div class="fzs-pc-foot">${c.matchHTML}</div>
    </a>`;
}

/* ---- Total ce soir ----
   Avant les matchs, un total de zéro ne dit rien : le panneau dit plutôt
   combien de mes joueurs jouent, dans combien de temps commence le premier
   match et qui joue dans quel match. Un soir sans aucun de mes joueurs, il
   dit quand ils rejouent. */

/** « dans 2 h 14 », « dans 12 min », puis « en cours ». */
function fzsDans(iso, maintenant = Date.now()) {
    const min = Math.ceil((Date.parse(iso) - maintenant) / 60000);
    if (!Number.isFinite(min) || min <= 0) return 'en cours';
    if (min < 60) return `dans ${min} min`;
    return `dans ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
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

/** Les matchs à venir de mes joueurs, du plus proche au plus lointain. */
function fzsMatchsHTML(avant, max) {
    const esc = escapeHTML;
    const parMatch = new Map();
    avant.forEach(a => {
        if (!parMatch.has(a.gameId)) parMatch.set(a.gameId, { depart: a.depart, away: a.away, home: a.home, joueurs: [] });
        parMatch.get(a.gameId).joueurs.push(a.name.split(' ').slice(1).join(' ') || a.name);
    });
    const matchs = [...parMatch.values()];
    const qui = noms => noms.length > 2 ? `${noms.slice(0, 2).join(', ')} +${noms.length - 2}` : noms.join(', ');
    const reste = matchs.length - max;
    return `<ul class="fzs-tonight">${matchs.slice(0, max).map(m => `
            <li>
                <time datetime="${esc(m.depart)}">${esc(gameTimeLabel(m.depart))}</time>
                <span class="fzs-tonight-match">${teamLogoImg(esc(m.away))}${esc(m.away)}<i>@</i>${esc(m.home)}${teamLogoImg(esc(m.home))}</span>
                <span class="fzs-tonight-who" title="${esc(m.joueurs.join(', '))}">${esc(qui(m.joueurs))}</span>
            </li>`).join('')}</ul>
        ${reste > 0 ? `<p class="fzs-tonight-more">+ ${reste} autre${reste > 1 ? 's' : ''} match${reste > 1 ? 's' : ''}</p>` : ''}`;
}

function fzsTotalHTML(soiree) {
    const { lines, avant, names, playing, total } = soiree;
    const esc = escapeHTML;
    const pts = n => Number(n || 0).toLocaleString('fr-CA', { maximumFractionDigits: 2 });
    const ouvrir = etat => `<section class="fzs-total fzs-panel ${etat}">${fzsHeading('▥ &nbsp; Total ce soir')}`;
    const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

    // Avant le premier match : qui joue, et quand.
    if (!lines.length && avant.length) {
        const matchs = new Set(avant.map(a => a.gameId)).size;
        return `${ouvrir('is-before')}
            <strong class="fzs-number">${avant.length} <small>joueur${avant.length > 1 ? 's' : ''}</small></strong>
            <p>en action ce soir, dans ${pluriel(matchs, 'match')}</p>
            <p class="fzs-total-start">Premier match <b class="fzs-countdown" data-fzs-depart="${esc(avant[0].depart)}">${fzsDans(avant[0].depart)}</b></p>
            ${fzsMatchsHTML(avant, 3)}
        </section>`;
    }

    // Personne ce soir — le calendrier le confirme, ce n'est pas un retard des feuilles.
    const aujourdhui = calData?.days?.find(d => d.date === todayISO());
    if (!lines.length && fzsJoueursDuJour(aujourdhui, names) === 0) {
        const prochain = fzsProchainSoir(names);
        return `${ouvrir('is-off')}
            <strong class="fzs-number">Relâche</strong>
            <p>Aucun de vos joueurs ne joue ce soir.</p>
            ${prochain ? `<p class="fzs-total-start">Prochain match <b>${esc(prochain.libelle)}</b> · ${pluriel(prochain.n, 'joueur')}</p>` : ''}
        </section>`;
    }

    // Les matchs ont commencé : le total, et où en est chacun.
    const finis = lines.length - playing;
    const termine = !playing && !avant.length && lines.length > 0;
    const etats = [
        playing ? `<span class="is-live"><i class="fzs-dot"></i>${playing} en jeu</span>` : '',
        avant.length ? `<span>${avant.length} à venir</span>` : '',
        finis && !termine ? `<span>${pluriel(finis, 'terminé')}</span>` : ''
    ].filter(Boolean).join('');
    return `${ouvrir(termine ? 'is-done' : 'is-live')}
        <strong class="fzs-number">${pts(total)} pts</strong>
        <p>${termine ? 'Soirée terminée · ' : ''}${fzdPoolH2H() ? 'Points fantasy de votre équipe' : 'Points de vos joueurs (buts + aides, gardiens)'}</p>
        ${etats ? `<p class="fzs-total-status">${etats}</p>` : ''}
        ${avant.length ? `<p class="fzs-total-start">Prochain départ <b class="fzs-countdown" data-fzs-depart="${esc(avant[0].depart)}">${fzsDans(avant[0].depart)}</b></p>${fzsMatchsHTML(avant, 2)}` : ''}
    </section>`;
}

/* Le compte à rebours, à la minute près et sans réseau. À la mise au jeu,
   la soirée se relit et son suivi démarre (fzsReglerSuiviSoiree). */
const FZS_COMPTE_MS = 20 * 1000;
let fzsCompteMinuteur = null;

function fzsReglerCompteARebours() {
    const actif = !!document.querySelector('#fzSeasonHome [data-fzs-depart]');
    if (actif && !fzsCompteMinuteur) fzsCompteMinuteur = setInterval(fzsCompteARebours, FZS_COMPTE_MS);
    else if (!actif && fzsCompteMinuteur) { clearInterval(fzsCompteMinuteur); fzsCompteMinuteur = null; }
}

function fzsCompteARebours() {
    const reperes = document.querySelectorAll('#fzSeasonHome [data-fzs-depart]');
    if (!reperes.length) { fzsReglerCompteARebours(); return; }
    let commence = false;
    reperes.forEach(el => {
        const depart = el.getAttribute('data-fzs-depart');
        el.textContent = fzsDans(depart);
        if (Date.parse(depart) <= Date.now()) commence = true;
    });
    if (commence && !fzsSoireeMinuteur) {
        fzsReglerSuiviSoiree(calTonight);
        fzsRafraichirSoiree();
    }
}

/** Les quatre panneaux de la soirée, et la ligne d'accroche de la bannière. */
function fzsSoireeHTML(tonight, activeName) {
    const esc = escapeHTML;
    const { names, games, lines, playing, total } = fzsLignesDuSoir(tonight);
    const avant = fzsJoueursAvantMatch(tonight, names);
    const cartes = fzsCartes(lines, avant, games);
    const href = fzdMonEffectifHref(activeName, FZPool.team().name);
    const empty = text => `<p class="fzs-empty">${text}</p>`;
    const pts = n => Number(n || 0).toLocaleString('fr-CA', { maximumFractionDigits: 2 });
    const repartition = fzsRepartition(lines);
    const max = Math.max(1, ...repartition.map(([, v]) => v));
    return {
        accroche: `<span class="fzs-eyebrow">${playing ? '<i class="fzs-dot"></i> En direct' : 'Votre soirée de hockey'}</span>
                <h1>Soir de hockey</h1><p>${playing ? `${playing} de vos joueurs sont en action ce soir.` : 'Chaque match compte. Suivez votre équipe.'}</p>
                <a class="fzs-cta" href="${esc(href)}">Suivre mes joueurs <span aria-hidden="true">→</span></a>`,
        joueurs: `<section class="fzs-players fzs-panel">${fzsHeading(`${playing ? '<i class="fzs-dot"></i> Mes joueurs en direct' : 'Mes joueurs ce soir'} (${playing || cartes.length})`, href, 'Voir mon équipe')}
            <div class="fzs-player-list">${cartes.length ? cartes.map(c => fzsCarteHTML(c, href)).join('') : empty('Aucun de vos joueurs ne joue aujourd’hui.')}</div>
        </section>`,
        total: fzsTotalHTML({ lines, avant, names: [...names], playing, total }),
        repartition: `<section class="fzs-breakdown fzs-panel">${fzsHeading('Répartition des statistiques · ce soir')}${repartition.map(([label, value]) =>
            `<div class="fzs-stat"><span>${label}</span><b>${pts(value)}</b><div><i style="width:${value / max * 100}%"></i></div></div>`).join('')}</section>`,
        playing
    };
}

/**
 * La soirée redessinée sur place, sans toucher au reste de l'accueil
 * (calendrier, duel, blocs partagés) : les points bougent pendant les matchs.
 */
function fzsActualiserSoiree(tonight) {
    const root = document.getElementById('fzSeasonHome');
    if (!root || !fzsRangContexte) return;
    const soiree = fzsSoireeHTML(tonight, fzsRangContexte.activeName);
    const remplacer = (selecteur, html) => {
        const bloc = root.querySelector(selecteur);
        if (bloc) bloc.outerHTML = html;
    };
    const accroche = root.querySelector('.fzs-hero-copy');
    if (accroche) accroche.innerHTML = soiree.accroche;
    // Le carrousel garde sa position : un rafraîchissement toutes les 30 s
    // ne doit pas ramener au premier joueur celui qui a glissé plus loin.
    const avant = root.querySelector('.fzs-players .fzs-player-list');
    const defile = avant ? avant.scrollLeft : 0;
    remplacer('.fzs-players', soiree.joueurs);
    const apres = root.querySelector('.fzs-players .fzs-player-list');
    if (apres && defile) {
        apres.style.scrollBehavior = 'auto';
        apres.scrollLeft = defile;
        apres.style.scrollBehavior = '';
    }
    remplacer('.fzs-total', soiree.total);
    remplacer('.fzs-breakdown', soiree.repartition);
    fzsReglerSuiviSoiree(tonight);
    fzsReglerCompteARebours();
}

/* Pendant les matchs, la soirée se relit seule : à chaque point qui tombe
   (pointsDirect.js le signale, voir fzdActualiserPointsDirect) et, tant qu'un
   match joue, toutes les 30 s — un tir ou un arrêt, qui compte au
   tête-à-tête, ne fait pas bouger le direct des points. /tonight-boxscores ne
   lit pas la base. Onglet caché : rien. */
const FZS_SOIREE_MS = 30 * 1000;
let fzsSoireeMinuteur = null;
let fzsSoireeEnVol = false;

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
    if ((tonight.games || []).some(FZS_EN_DIRECT)) return true;
    const jour = calData?.days.find(d => d.date === todayISO());
    const maintenant = Date.now();
    return (jour?.games || []).some(g => ['FUT', 'PRE', 'LIVE', 'CRIT'].includes(g.state)
        && Date.parse(g.startTimeUTC) <= maintenant
        && !(tonight.games || []).some(x => x.id === g.id && ['FINAL', 'OFF'].includes(x.state)));
}

function fzsReglerSuiviSoiree(tonight) {
    const actif = fzsSoireeEnCours(tonight);
    if (actif && !fzsSoireeMinuteur) fzsSoireeMinuteur = setInterval(fzsRafraichirSoiree, FZS_SOIREE_MS);
    else if (!actif && fzsSoireeMinuteur) { clearInterval(fzsSoireeMinuteur); fzsSoireeMinuteur = null; }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (fzsSoireeMinuteur) fzsRafraichirSoiree();
    // L'onglet revient : le compte à rebours se remet à l'heure, et des points
    // lus hier ou il y a plus de dix minutes se relisent.
    if (fzsCompteMinuteur) fzsCompteARebours();
    if (fzsRangContexte && document.getElementById('fzSeasonHome')) fzsChargerPoints(fzsRangContexte.activeName);
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
    const heading = fzsHeading;
    const empty = text => `<p class="fzs-empty">${text}</p>`;
    const estH2H = fzdPoolH2H();
    const soiree = fzsSoireeHTML(tonight, activeName);
    // De haut en bas : les histoires du haut de page (accueil.js), mes joueurs
    // ce soir, ma position et le total du soir côte à côte, mon duel en
    // tête-à-tête, À surveiller et les alignements des 32 clubs (fzhLinesHTML,
    // accueil-draft.js). Le calendrier reste rendu
    // hors de l'écran : son horaire du jour nourrit les joueurs à venir et
    // ses buts du jour, les cartes de but des histoires.
    root.innerHTML = `
        ${soiree.joueurs}
        <section class="fzs-rank fzs-panel">${fzsRangHTML(activeName, movement)}</section>
        ${soiree.total}
        ${estH2H ? `<section class="fzs-duel fzs-panel" id="fzsDuel" aria-live="polite">${heading('⚔ &nbsp; Mon duel', `classement.html?pool=${encodeURIComponent(activeName)}&h2h=duel`, 'Voir le duel')}<div class="fzs-duel-body">${empty('Chargement du duel…')}</div></section>` : ''}
        <div class="fzs-slot" data-fz-bloc="surveiller"></div>
        ${typeof fzhLinesHTML === 'function' ? fzhLinesHTML() : ''}`;
    fzdPlaceCalendar();
    renderCalendar();
    // Le bloc « surveiller » devient l'activité de la ligue une fois le
    // repêchage fini : marché, échanges, semaines — il remplace l'ancienne
    // liste d'échanges seule.
    fzdRendreSurveiller();
    if (estH2H) fzsLoadDuel(root, activeName, FZPool.team().name);
    fzsReglerSuiviSoiree(tonight);
    fzsReglerCompteARebours();
    fzsChargerPoints(activeName);
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

    const pts = n => Number(n || 0).toLocaleString('fr-CA', { maximumFractionDigits: 1 });
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
