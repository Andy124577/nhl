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
   tout l'accueil (voir fzsActualiserRang). */
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
    return `${fzsHeading('♜ &nbsp; Ma position', `classement.html?pool=${encodeURIComponent(activeName)}`, 'Voir le classement')}
            <strong class="fzs-number">${rank >= 0 ? `${ordinalHTML(rank + 1)} <small>/ ${ranking.length}</small>` : '—'}</strong>
            <p>${mine ? `${Number(mine.score).toLocaleString('fr-CA')} pts ${live}` : 'Classement à venir'}</p>
            ${delta ? `<p class="${delta > 0 ? 'fzs-green' : 'fzs-red'}">${delta > 0 ? '↑ +' : '↓ '}${delta} <span>depuis le début de la journée</span></p>` : ''}
            <div class="fzs-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>`;
}

function fzsActualiserRang() {
    const bloc = document.querySelector('#fzSeasonHome .fzs-rank');
    if (!bloc || !fzsRangContexte) return;
    bloc.innerHTML = fzsRangHTML(fzsRangContexte.activeName, fzsRangContexte.movement);
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
        out.push({ name, info, contre: match.contre, depart: match.g.startTimeUTC, saison });
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
            match: gameLineFor(p, games) || (live ? 'En direct' : 'Final')
        });
    });
    avant.forEach(a => cartes.push({
        rang: 1, tri: Date.parse(a.depart) || 0, live: false, final: false,
        nom: a.name, equipe: a.info.teamAbbrev,
        pos: a.info.position && a.info.position !== 'N/A' ? a.info.position : '',
        saison: a.saison, soir: 0, stats: null,
        match: `Ce soir ${gameTimeLabel(a.depart)} vs ${a.contre}`
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
            ${c.live ? '<span class="fzs-pc-live"><i></i>EN DIRECT</span>' : ''}
        </div>
        <div class="fzs-pc-body">
            <div class="fzs-pc-name"><strong title="${esc(c.nom)}">${esc(court)}</strong><span>${esc(c.pos)}</span></div>
            <div class="fzs-pc-season"><span>Saison ${pts(c.saison)} pts</span>${soir ? `<b class="${c.soir > 0 ? 'is-up' : ''}">${soirLibelle}</b>` : ''}</div>
            ${c.stats ? `<div class="fzs-pc-stats">${c.stats.map(([v, l]) => `<span>${v} <small>${l}</small></span>`).join('')}<span class="${c.soir > 0 ? 'is-up' : ''}">${pts(c.soir)} <small>PTS</small></span></div>` : ''}
        </div>
        <div class="fzs-pc-foot">${esc(c.match)}</div>
    </a>`;
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
        total: `<section class="fzs-total fzs-panel">${fzsHeading('▥ &nbsp; Total ce soir')}<strong class="fzs-number">${pts(total)} pts</strong><p>${fzdPoolH2H() ? 'Points fantasy de votre équipe' : 'Points de vos joueurs (buts + aides, gardiens)'}</p></section>`,
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
    remplacer('.fzs-players', soiree.joueurs);
    remplacer('.fzs-total', soiree.total);
    remplacer('.fzs-breakdown', soiree.repartition);
    fzsReglerSuiviSoiree(tonight);
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
    if (!document.hidden && fzsSoireeMinuteur) fzsRafraichirSoiree();
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
    const esc = escapeHTML;
    const heading = fzsHeading;
    const empty = text => `<p class="fzs-empty">${text}</p>`;
    const estH2H = fzdPoolH2H();
    const soiree = fzsSoireeHTML(tonight, activeName);
    const { lines } = fzsLignesDuSoir(tonight);
    const leader = lines[0];
    const coverName = leader?.playerName || 'Connor McDavid';
    const cover = fzdHeadshotByName(coverName);
    // En saison, deux blocs ont quitté l'accueil : « Matchs du soir » — le
    // calendrier, juste dessous, donne les mêmes matchs avec leur état — et
    // « Actualités NHL », déjà en tête de page (bandeau d'histoires,
    // accueil.js). L'avant-saison garde sa disposition (renderMobileHome).
    root.innerHTML = `
        <section class="fzs-hero fzs-panel">
            <img class="fzs-ice" src="assets/hero/fantazy-ice-reference.png" alt="">
            ${cover ? `<img class="fzs-cover" src="${esc(cover)}" alt="${esc(coverName)}" onerror="this.remove()">` : ''}
            <div class="fzs-hero-copy">${soiree.accroche}</div>
        </section>
        ${estH2H ? `<section class="fzs-duel fzs-panel" id="fzsDuel" aria-live="polite">${heading('⚔ &nbsp; Mon duel', `classement.html?pool=${encodeURIComponent(activeName)}&h2h=duel`, 'Voir le duel')}<div class="fzs-duel-body">${empty('Chargement du duel…')}</div></section>` : ''}
        <section class="fzs-rank fzs-panel">${fzsRangHTML(activeName, movement)}</section>
        ${soiree.joueurs}
        ${soiree.total}
        ${soiree.repartition}
        <div class="fzs-slot" data-fz-bloc="calendrier"></div>
        <div class="fzs-slot" data-fz-bloc="surveiller"></div>
        <div class="fzs-slot" data-fz-bloc="mouvements"></div>`;
    fzdPlaceCalendar();
    renderCalendar();
    // Le bloc « surveiller » devient l'activité de la ligue une fois le
    // repêchage fini : marché, échanges, semaines — il remplace l'ancienne
    // liste d'échanges seule.
    fzdRendreSurveiller();
    fzdRendreMouvements();
    if (estH2H) fzsLoadDuel(root, activeName, FZPool.team().name);
    fzsReglerSuiviSoiree(tonight);
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
