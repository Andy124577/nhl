/* In-season home: shared markup and existing NHL/pool data on every viewport. */
function fzsReset() {
    fzdRestoreCalendar();
    document.getElementById('fzSeasonHome')?.remove();
    document.getElementById('fzDashSection')?.classList.remove('is-season');
    document.body.classList.remove('fz-season-page');
}

function fzsHeading(title, link, label = 'Voir tout', fleche = '→') {
    return `<header class="fzs-head"><h2>${title}</h2>${link ? `<a href="${escapeHTML(link)}">${label} <span aria-hidden="true">${fleche}</span></a>` : ''}</header>`;
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
    const ecart = Math.abs(delta || 0);
    const journee = delta
        ? `<span class="fzs-pos-day ${delta > 0 ? 'fzs-green' : 'fzs-red'}" title="Depuis le début de la journée">${delta > 0 ? '↑' : '↓'} ${ecart} place${ecart > 1 ? 's' : ''} aujourd’hui</span>`
        : '';
    const semaine = fzsSemaineRang(movement?.history, rangActuel ?? (rank >= 0 ? rank + 1 : null), todayISO());
    // Le rang en grand à gauche, mes points et ceux du soir à droite ; dessous,
    // le pool en une bande, la semaine du rang et les trois périodes.
    return `${fzsHeading('Ma position', `classement.html?pool=${encodeURIComponent(activeName)}`, 'Classement', '›')}
            <div class="fzs-pos-top">
                <strong class="fzs-pos-rank">${rank >= 0 ? `${ordinalHTML(rank + 1)}<small>/ ${ranking.length}</small>` : '—'}</strong>
                <div class="fzs-pos-score">
                    ${mine ? `<span class="fzs-pos-pts"><b>${Number(mine.score).toLocaleString('fr-CA')}</b> pts</span>${live}${journee}`
                        : '<span class="fzs-pos-pts">Classement à venir</span>'}
                </div>
            </div>
            ${rank >= 0 ? fzsBandeRangHTML(ranking, rank) : ''}
            ${fzsCourbeRangHTML(semaine, ranking.length)}
            ${fzsPeriodesHTML(fzsValeursPeriodes(activeName, soirMoi))}`;
}

/**
 * Le pool d'un coup d'œil : une barre par équipe, la mienne en rouge, celles
 * qui me devancent plus claires que celles qui me suivent. Au-delà de 12
 * équipes, seuls le premier, le dernier et mon rang gardent leur numéro ;
 * au-delà de 24, la bande serait un peigne illisible et s'efface.
 */
function fzsBandeRangHTML(ranking, rank) {
    const n = ranking.length;
    if (n < 2 || n > 24) return '';
    const esc = escapeHTML;
    const barres = ranking.map((t, i) => {
        const cls = [i === rank ? 'is-me' : i < rank ? 'is-ahead' : '', i === 0 || i === n - 1 ? 'is-end' : '']
            .filter(Boolean).join(' ');
        const dit = `${fzsOrdinal(i + 1)} · ${t.teamName} · ${Number(t.score || 0).toLocaleString('fr-CA')} pts`;
        return `<li${cls ? ` class="${cls}"` : ''} title="${esc(dit)}"><i></i><span>${i + 1}</span></li>`;
    }).join('');
    return `<ol class="fzs-pos-strip${n > 12 ? ' is-dense' : ''}" style="--n:${n}" aria-label="${esc(`${fzsOrdinal(rank + 1)} sur ${n} équipes`)}">${barres}</ol>`;
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
 * Le jour choisi dans la semaine du rang (0 à 6), d'un toucher ou d'un clic :
 * il survit au redessin que provoque chaque point du soir. null : maintenant.
 */
let fzsJourChoisi = null;

/**
 * La semaine du rang : une ligne sur son aire, le 1er rang en haut, un filet
 * par rang. Les points sont des <span> posés en pourcentage sur la colonne
 * de leur jour — nets à toute largeur — ; seuls la ligne et l'aire sont un
 * SVG étiré, d'un trait qui ne s'étire pas. Chaque colonne est un bouton :
 * le survol, le toucher ou le clavier choisit un jour, et la légende dit son
 * rang (fzsChoisirJour).
 */
function fzsCourbeRangHTML(jours, taille) {
    const vus = jours.filter(j => j.rang != null);
    if (vus.length < 2) {
        return `<figure class="fzs-week"><figcaption class="fzs-week-cap"><span>7 derniers jours</span></figcaption>
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
    const f = n => n.toFixed(2);
    // La ligne et son aire s'interrompent sur un soir sans instantané.
    const troncons = [];
    let troncon = [];
    jours.forEach((j, i) => {
        if (j.rang == null) { if (troncon.length) troncons.push(troncon); troncon = []; return; }
        troncon.push([x(i), y(j.rang)]);
    });
    if (troncon.length) troncons.push(troncon);
    const trace = troncons.map(t => t.map(([a, b], k) => `${k ? 'L' : 'M'}${f(a)} ${f(b)}`).join(' ')).join(' ');
    const aire = troncons.filter(t => t.length > 1)
        .map(t => `M${f(t[0][0])} 100 ${t.map(([a, b]) => `L${f(a)} ${f(b)}`).join(' ')} L${f(t[t.length - 1][0])} 100 Z`).join(' ');
    // Un filet par rang tant qu'il y en a peu ; sinon le haut et le bas seulement.
    const filets = bas === haut ? [haut] : bas - haut <= 10
        ? Array.from({ length: bas - haut + 1 }, (_, k) => haut + k) : [haut, bas];

    const jourCourt = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-CA', { weekday: 'short', timeZone: 'UTC' });
    const jourLong = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const rangDe = j => (j.rang == null ? 'aucun relevé' : fzsOrdinal(j.rang));
    const dit = j => `${j.maintenant ? 'Maintenant' : jourLong(j.date)} · ${rangDe(j)}`;
    const legende = j => `${j.maintenant ? 'Aujourd’hui' : jourCourt(j.date)} : ${rangDe(j)}`;
    // Par défaut, le dernier jour relevé — maintenant, presque toujours.
    const dernier = jours.reduce((k, j, i) => (j.rang != null ? i : k), jours.length - 1);
    const choisi = fzsJourChoisi != null && fzsJourChoisi < jours.length ? fzsJourChoisi : dernier;
    const colonnes = jours.map((j, i) => `
        <button type="button" class="fzs-week-col${i === choisi ? ' is-sel' : ''}${j.maintenant ? ' is-now' : ''}"
                style="--i:${i}${j.rang == null ? '' : `;--y:${f(y(j.rang))}`}" data-i="${i}"
                data-cap="${escapeHTML(legende(j))}" aria-label="${escapeHTML(dit(j))}" aria-pressed="${i === choisi}">
            ${j.rang == null ? '' : '<i class="fzs-week-pt"></i>'}
            <span class="fzs-week-day">${j.maintenant ? 'Auj.' : escapeHTML(jourCourt(j.date))}</span>
        </button>`).join('');
    const repere = r => `<span class="fzs-week-tick" style="--y:${f(y(r))}">${fzsOrdinal(r)}</span>`;
    return `<figure class="fzs-week" style="--sel:${choisi}">
        <figcaption class="fzs-week-cap"><span>7 derniers jours · <b class="fzs-week-sel">${escapeHTML(legende(jours[choisi]))}</b></span>${tendance}</figcaption>
        <div class="fzs-week-plot">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                <defs><linearGradient id="fzsWeekFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" class="fzs-week-fill-top"></stop><stop offset="1" class="fzs-week-fill-bottom"></stop>
                </linearGradient></defs>
                ${filets.map(r => `<line class="fzs-week-grid${r === haut || r === bas ? ' is-edge' : ''}" x1="0" x2="100" y1="${f(y(r))}" y2="${f(y(r))}"></line>`).join('')}
                ${aire ? `<path class="fzs-week-area" d="${aire}"></path>` : ''}
                <path class="fzs-week-line" d="${trace}"></path>
            </svg>
            <span class="fzs-week-guide" aria-hidden="true"></span>
            ${repere(haut)}${bas !== haut ? repere(bas) : ''}
            <div class="fzs-week-cols" role="group" aria-label="Mon rang, soir après soir">${colonnes}</div>
        </div>
    </figure>`;
}

/**
 * Choisit un jour de la semaine du rang sans redessiner : la colonne
 * s'allume, le guide s'y place, la légende dit son rang. `garder` : un
 * toucher, un clic ou le clavier, qui reste choisi ; le survol de la souris
 * n'est qu'un aperçu, rendu au jour gardé quand elle sort du tracé.
 */
function fzsChoisirJour(col, garder) {
    const figure = col.closest('.fzs-week');
    if (!figure) return;
    figure.style.setProperty('--sel', col.dataset.i);
    figure.querySelectorAll('.fzs-week-col').forEach(c => {
        c.classList.toggle('is-sel', c === col);
        c.setAttribute('aria-pressed', String(c === col));
    });
    const legende = figure.querySelector('.fzs-week-sel');
    if (legende) legende.textContent = col.dataset.cap;
    if (garder) fzsJourChoisi = Number(col.dataset.i);
}

document.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    const col = e.target.closest?.('.fzs-week-col');
    if (col) fzsChoisirJour(col, false);
});
document.addEventListener('pointerout', e => {
    if (e.pointerType !== 'mouse') return;
    const groupe = e.target.closest?.('.fzs-week-cols');
    if (!groupe || groupe.contains(e.relatedTarget)) return;
    const cols = groupe.querySelectorAll('.fzs-week-col');
    const garde = fzsJourChoisi != null ? cols[fzsJourChoisi] : groupe.querySelector('.fzs-week-col.is-now');
    if (garde) fzsChoisirJour(garde, false);
});
document.addEventListener('click', e => {
    const col = e.target.closest?.('.fzs-week-col');
    if (col) fzsChoisirJour(col, true);
});
document.addEventListener('focusin', e => {
    const col = e.target.closest?.('.fzs-week-col');
    if (col && col.matches(':focus-visible')) fzsChoisirJour(col, true);
});

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

/** Trois tuiles ; une période à zéro s'éteint, pour que l'œil aille aux autres. */
function fzsPeriodesHTML(valeurs) {
    const pts = n => `${n > 0 ? '+' : ''}${Number(n).toLocaleString('fr-CA', { maximumFractionDigits: 1 })}`;
    const cellules = FZS_PERIODES.map(([jours, libelle, titre]) => {
        const v = valeurs ? valeurs[jours] : null;
        return `<div${v === 0 ? ' class="is-zero"' : ''} title="${escapeHTML(titre)}"><dt>${libelle}</dt><dd>${v == null ? '<b>—</b>' : `<b>${pts(v)}</b> pts`}</dd></div>`;
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

/* ---- Ce soir (le total du soir) ----
   Avant les matchs, un total de zéro ne dit rien : le panneau compte à
   rebours jusqu'au premier match, dit combien de mes joueurs jouent et qui
   joue dans quel match. Un soir sans aucun de mes joueurs, il dit quand ils
   rejouent. */

/** « dans 2 h 14 », « dans 12 min », puis « en cours ». */
function fzsDans(iso, maintenant = Date.now()) {
    const min = Math.ceil((Date.parse(iso) - maintenant) / 60000);
    if (!Number.isFinite(min) || min <= 0) return 'en cours';
    if (min < 60) return `dans ${min} min`;
    return `dans ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

/** Le grand compte à rebours : « 2 h 14 », puis « 14:05 » à la seconde pendant la dernière heure. */
function fzsCompte(iso, maintenant = Date.now()) {
    const s = Math.ceil((Date.parse(iso) - maintenant) / 1000);
    if (!Number.isFinite(s) || s <= 0) return 'En cours';
    if (s < 3600) return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    const min = Math.ceil(s / 60);
    return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

/**
 * L'anneau autour de l'heure du match se remplit pendant la dernière heure,
 * comme une minuterie — au moment où le compte passe aux secondes. Plus tôt,
 * il reste vide : seule l'heure s'y lit.
 */
function fzsAnneauPart(iso, maintenant = Date.now()) {
    const reste = Date.parse(iso) - maintenant;
    if (!Number.isFinite(reste)) return 0;
    return Math.min(1, Math.max(0, 1 - reste / (60 * 60 * 1000)));
}

function fzsAnneauHTML(iso) {
    const heure = gameTimeLabel(iso).replace(/ h 00$/, ' h');
    return `<span class="fzs-ce-ring" data-fzs-anneau="${escapeHTML(iso)}" style="--p:${fzsAnneauPart(iso).toFixed(3)}" aria-hidden="true"><span>${escapeHTML(heure)}</span></span>`;
}

/** Un club en pastille ronde : son logo sur un voile de sa couleur, son sigle si le logo manque. */
function fzsClubHTML(abbrev) {
    const esc = escapeHTML;
    const couleur = typeof getTeamColors === 'function' ? getTeamColors(abbrev)[0] : '#3A414D';
    return `<span class="fzs-club" style="--club:${esc(couleur)}" title="${esc(abbrev)}"><img src="teams/${esc(abbrev)}.png" alt="${esc(abbrev)}" loading="lazy" onerror="this.remove()"><span aria-hidden="true">${esc(abbrev)}</span></span>`;
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

/**
 * Les matchs à venir de mes joueurs, du plus proche au plus lointain : une
 * tuile par match, qui ouvre sa feuille de match.
 */
function fzsMatchsHTML(avant, max) {
    const esc = escapeHTML;
    const parMatch = new Map();
    avant.forEach(a => {
        if (!parMatch.has(a.gameId)) parMatch.set(a.gameId, { id: a.gameId, depart: a.depart, away: a.away, home: a.home, joueurs: [] });
        parMatch.get(a.gameId).joueurs.push(a.name.split(' ').slice(1).join(' ') || a.name);
    });
    const matchs = [...parMatch.values()];
    const qui = noms => noms.length > 2 ? `${noms.slice(0, 2).join(', ')} +${noms.length - 2}` : noms.join(', ');
    const reste = matchs.length - max;
    const tuiles = matchs.slice(0, max).map(m => {
        const balise = m.id ? 'a' : 'div';
        const lien = m.id ? ` href="match.html?id=${encodeURIComponent(m.id)}"` : '';
        return `
            <li><${balise} class="fzs-tonight-game"${lien}>
                <time datetime="${esc(m.depart)}">${esc(gameTimeLabel(m.depart))}</time>
                <span class="fzs-tonight-match">${fzsClubHTML(m.away)}<i>@</i>${fzsClubHTML(m.home)}</span>
                <span class="fzs-tonight-who" title="${esc(m.joueurs.join(', '))}"><small>${m.joueurs.length > 1 ? 'Mes joueurs' : 'Mon joueur'}</small><b>${esc(qui(m.joueurs))}</b></span>
            </${balise}></li>`;
    }).join('');
    return `<ul class="fzs-tonight">${tuiles}</ul>
        ${reste > 0 ? `<p class="fzs-tonight-more">+ ${reste} autre${reste > 1 ? 's' : ''} match${reste > 1 ? 's' : ''}</p>` : ''}`;
}

function fzsTotalHTML(soiree) {
    const { lines, avant, names, playing, total } = soiree;
    const esc = escapeHTML;
    const pts = n => Number(n || 0).toLocaleString('fr-CA', { maximumFractionDigits: 2 });
    const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
    const ouvrir = (etat, meta) => `<section class="fzs-total fzs-panel ${etat}">
        <header class="fzs-head"><h2>Ce soir</h2>${meta ? `<span class="fzs-head-meta">${meta}</span>` : ''}</header>`;

    // Avant le premier match : le compte à rebours, et qui joue dans quel match.
    if (!lines.length && avant.length) {
        const matchs = new Set(avant.map(a => a.gameId)).size;
        const depart = avant[0].depart;
        return `${ouvrir('is-before', `${pluriel(avant.length, 'joueur')} · ${pluriel(matchs, 'match')}`)}
            <div class="fzs-ce-main">
                <div class="fzs-ce-lead">
                    <span class="fzs-ce-label" data-parti="Premier match">Premier match dans</span>
                    <strong class="fzs-ce-count" data-fzs-compte="${esc(depart)}">${fzsCompte(depart)}</strong>
                </div>
                ${fzsAnneauHTML(depart)}
            </div>
            ${fzsMatchsHTML(avant, 3)}
        </section>`;
    }

    // Personne ce soir — le calendrier le confirme, ce n'est pas un retard des feuilles.
    const aujourdhui = calData?.days?.find(d => d.date === todayISO());
    if (!lines.length && fzsJoueursDuJour(aujourdhui, names) === 0) {
        const prochain = fzsProchainSoir(names);
        return `${ouvrir('is-off')}
            <div class="fzs-ce-main">
                <div class="fzs-ce-lead">
                    <span class="fzs-ce-label">Aucun de vos joueurs ne joue ce soir</span>
                    <strong class="fzs-ce-count">Relâche</strong>
                </div>
            </div>
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
    const meta = termine ? 'Soirée terminée' : playing ? '<span class="fzs-ce-live"><i></i>En direct</span>' : '';
    const libelle = fzdPoolH2H() ? 'Points fantasy de votre équipe' : 'Points de vos joueurs';
    const detail = fzdPoolH2H() ? 'Barème fantasy du tête-à-tête' : 'Buts + aides, et les points des gardiens';
    return `${ouvrir(termine ? 'is-done' : 'is-live', meta)}
        <div class="fzs-ce-main">
            <div class="fzs-ce-lead" title="${esc(detail)}">
                <span class="fzs-ce-label">${libelle}</span>
                <strong class="fzs-ce-count${total > 0 ? ' is-up' : ''}">${total > 0 ? '+' : ''}${pts(total)} <small>pts</small></strong>
            </div>
        </div>
        ${etats ? `<p class="fzs-total-status">${etats}</p>` : ''}
        ${avant.length ? `<p class="fzs-total-start">Prochain départ <b class="fzs-countdown" data-fzs-depart="${esc(avant[0].depart)}">${fzsDans(avant[0].depart)}</b></p>${fzsMatchsHTML(avant, 2)}` : ''}
    </section>`;
}

/* Le compte à rebours, à la seconde et sans réseau : le grand compte passe
   aux secondes dans la dernière heure, et l'anneau s'y remplit. À la mise
   au jeu, la soirée se relit et son suivi démarre (fzsReglerSuiviSoiree). */
const FZS_COMPTE_MS = 1000;
const FZS_REPERES_COMPTE = '#fzSeasonHome :is([data-fzs-depart], [data-fzs-compte], [data-fzs-anneau])';
let fzsCompteMinuteur = null;

function fzsReglerCompteARebours() {
    const actif = !!document.querySelector(FZS_REPERES_COMPTE);
    if (actif && !fzsCompteMinuteur) fzsCompteMinuteur = setInterval(fzsCompteARebours, FZS_COMPTE_MS);
    else if (!actif && fzsCompteMinuteur) { clearInterval(fzsCompteMinuteur); fzsCompteMinuteur = null; }
}

function fzsCompteARebours() {
    const reperes = document.querySelectorAll(FZS_REPERES_COMPTE);
    if (!reperes.length) { fzsReglerCompteARebours(); return; }
    let commence = false;
    const maintenant = Date.now();
    reperes.forEach(el => {
        const depart = el.getAttribute('data-fzs-depart') || el.getAttribute('data-fzs-compte') || el.getAttribute('data-fzs-anneau');
        const parti = Date.parse(depart) <= maintenant;
        if (parti) commence = true;
        if (el.hasAttribute('data-fzs-depart')) {
            el.textContent = fzsDans(depart, maintenant);
        } else if (el.hasAttribute('data-fzs-compte')) {
            el.textContent = fzsCompte(depart, maintenant);
            const bloc = el.closest('.fzs-ce-main');
            bloc?.classList.toggle('is-started', parti);
            const libelle = bloc?.querySelector('.fzs-ce-label[data-parti]');
            if (libelle && parti) libelle.textContent = libelle.dataset.parti;
        } else {
            el.style.setProperty('--p', fzsAnneauPart(depart, maintenant).toFixed(3));
        }
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
    // De haut en bas : ma position et le total du soir côte à côte, le
    // carrousel des matchs du jour (#storiesSection, accueil.js), mes joueurs
    // ce soir, mon duel en tête-à-tête, les meilleurs joueurs de la LNH
    // (statsTopPlayers.js), À surveiller, les alignements des 32 clubs
    // (fzhLinesHTML, accueil-draft.js) et, tout en bas, les actualités. Le
    // calendrier reste rendu hors de l'écran : son horaire du jour nourrit
    // les joueurs à venir et ses buts du jour, les cartes de but des histoires.
    root.innerHTML = `
        <section class="fzs-rank fzs-panel">${fzsRangHTML(activeName, movement)}</section>
        ${soiree.total}
        <div class="fzs-slot" data-fz-bloc="histoires"></div>
        ${soiree.joueurs}
        ${estH2H ? `<section class="fzs-duel fzs-panel" id="fzsDuel" aria-live="polite">${heading('⚔ &nbsp; Mon duel', `classement.html?pool=${encodeURIComponent(activeName)}&h2h=duel`, 'Voir le duel')}<div class="fzs-duel-body">${empty('Chargement du duel…')}</div></section>` : ''}
        <div class="fzs-slot" data-fz-bloc="meilleurs"></div>
        <div class="fzs-slot" data-fz-bloc="surveiller"></div>
        ${typeof fzhLinesHTML === 'function' ? fzhLinesHTML() : ''}
        <div class="fzs-slot" data-fz-bloc="actualites"></div>`;
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
