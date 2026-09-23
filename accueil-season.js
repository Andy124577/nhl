/* In-season home: shared markup and existing NHL/pool data on every viewport. */
function fzsReset() {
    fzdRestoreCalendar();
    document.getElementById('fzSeasonHome')?.remove();
    document.getElementById('fzDashSection')?.classList.remove('is-season');
    document.body.classList.remove('fz-season-page');
}

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
    const names = new Set(activeRosterNames());
    const games = tonight.games || [];
    const scheduled = calData?.days.find(d => d.date === todayISO())?.games || [];
    const allGames = [...games, ...scheduled.filter(g => !games.some(x => x.id === g.id))];
    const live = g => g && ['LIVE', 'CRIT'].includes(g.state);
    const lines = (tonight.players || []).filter(p => names.has(p.playerName))
        .sort((a, b) => Number(live(games.find(g => g.id === b.gameId))) - Number(live(games.find(g => g.id === a.gameId))) || (b.fantasyPointsTonight || 0) - (a.fantasyPointsTonight || 0));
    const playing = lines.filter(p => live(games.find(g => g.id === p.gameId))).length;
    const total = lines.reduce((n, p) => n + (Number(p.fantasyPointsTonight) || 0), 0);
    const href = fzdMonEffectifHref(activeName, FZPool.team().name);
    const pool = (userData.userPools || []).find(p => p.name === activeName);
    const scores = pool ? buildTeamScores(pool) : [];
    const claimed = scores.filter(t => t.memberCount > 0);
    const ranking = claimed.length ? claimed : scores;
    const rank = ranking.findIndex(t => t.isCurrentUser);
    const mine = ranking[rank];
    const change = movement?.teams?.find(t => t.teamName === FZPool.team().name);
    const delta = movement?.hasSnapshot && change?.rankToday != null ? change.rankToday - change.rankNow : null;
    const heading = (title, link, label = 'Voir tout') => `<header class="fzs-head"><h2>${title}</h2>${link ? `<a href="${esc(link)}">${label} <span aria-hidden="true">→</span></a>` : ''}</header>`;
    const empty = text => `<p class="fzs-empty">${text}</p>`;
    const estH2H = (FZPool.data() || {}).poolMode === 'head-to-head';
    const leader = lines[0];
    const coverName = leader?.playerName || 'Connor McDavid';
    const cover = fzdHeadshotByName(coverName);
    root.innerHTML = `
        <section class="fzs-hero fzs-panel">
            <img class="fzs-ice" src="assets/hero/fantazy-ice-reference.png" alt="">
            ${cover ? `<img class="fzs-cover" src="${esc(cover)}" alt="${esc(coverName)}" onerror="this.remove()">` : ''}
            <div class="fzs-hero-copy"><span class="fzs-eyebrow">${playing ? '<i class="fzs-dot"></i> En direct' : 'Votre soirée de hockey'}</span>
                <h1>Soir de hockey</h1><p>${playing ? `${playing} de vos joueurs sont en action ce soir.` : 'Chaque match compte. Suivez votre équipe.'}</p>
                <a class="fzs-cta" href="${esc(href)}">Suivre mes joueurs <span aria-hidden="true">→</span></a>
            </div>
        </section>
        ${estH2H ? `<section class="fzs-duel fzs-panel" id="fzsDuel" aria-live="polite">${heading('⚔ &nbsp; Mon duel', `classement.html?pool=${encodeURIComponent(activeName)}&h2h=duel`, 'Voir le duel')}<div class="fzs-duel-body">${empty('Chargement du duel…')}</div></section>` : ''}
        <section class="fzs-rank fzs-panel">${heading('♜ &nbsp; Ma position', `classement.html?pool=${encodeURIComponent(activeName)}`, 'Voir le classement')}
            <strong class="fzs-number">${rank >= 0 ? `${ordinalHTML(rank + 1)} <small>/ ${ranking.length}</small>` : '—'}</strong>
            <p>${mine ? `${Number(mine.score).toLocaleString('fr-CA')} pts` : 'Classement à venir'}</p>
            ${delta ? `<p class="${delta > 0 ? 'fzs-green' : 'fzs-red'}">${delta > 0 ? '↑ +' : '↓ '}${delta} <span>depuis le début de la journée</span></p>` : ''}
            <div class="fzs-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
        </section>
        <section class="fzs-scores fzs-panel">${heading(`${games.some(live) ? '<i class="fzs-dot"></i> Matchs en direct' : 'Matchs du soir'}`, 'calendrier.html', 'Calendrier complet')}
            <div class="fzs-score-track">${allGames.length ? allGames.map(g => `<article class="fzs-game">${[g.away, g.home].map(t => `<div>${teamLogoImg(t.abbrev)}<span>${esc(t.abbrev)}</span><b>${['FUT', 'PRE'].includes(g.state) ? '—' : t.score ?? '—'}</b></div>`).join('')}<footer><span class="fzs-tag ${live(g) ? 'is-live' : ''}">${live(g) ? 'En direct' : ['OFF', 'FINAL'].includes(g.state) ? 'Final' : 'À venir'}</span> ${live(g) ? `${periodLabel(g.period, g.periodType)} · ${esc(g.clock?.timeRemaining || '')}` : g.startTimeUTC ? gameTimeLabel(g.startTimeUTC) : ''}</footer></article>`).join('') : empty('Aucun match à l’horaire ce soir.')}</div>
        </section>
        <section class="fzs-players fzs-panel">${heading(`${playing ? '<i class="fzs-dot"></i> Mes joueurs en direct' : 'Mes joueurs ce soir'} (${playing || lines.length})`, href, 'Voir mon équipe')}
            <div class="fzs-player-list">${lines.length ? lines.map(p => {
                const g = games.find(g => g.id === p.gameId);
                return `<a class="fzs-player" href="${esc(href)}">${offPlayerFaceHTML(p.playerName, p.teamAbbrev)}<div class="fzs-player-name"><strong>${esc(p.playerName)}</strong><small>${esc(getPlayerStats(p.playerName)?.position || p.position)} · ${esc(p.teamAbbrev)}</small><span class="fzs-tag ${live(g) ? 'is-live' : ''}">${live(g) ? 'En direct' : 'Final'}</span></div><div class="fzs-player-stats"><span><b>${p.position === 'G' ? p.saves : p.goals}</b> ${p.position === 'G' ? 'ARR' : 'B'}</span><span><b>${p.position === 'G' ? p.goalsAgainst : p.assists}</b> ${p.position === 'G' ? 'BA' : 'A'}</span><strong class="fzs-green">${Number(p.fantasyPointsTonight || 0).toLocaleString('fr-CA')} PTS</strong><small>${gameLineFor(p, games)}</small></div>${teamLogoImg(p.teamAbbrev)}</a>`;
            }).join('') : empty('Aucun de vos joueurs n’a commencé son match aujourd’hui.')}</div>
        </section>
        <section class="fzs-total fzs-panel">${heading('▥ &nbsp; Total ce soir')}<strong class="fzs-number">${total.toLocaleString('fr-CA', { maximumFractionDigits: 2 })} pts</strong><p>Points fantasy de votre équipe</p></section>
        <section class="fzs-playing fzs-panel">${heading('♟ &nbsp; Joueurs en jeu', href, 'Voir')}<strong class="fzs-number">${playing} <small>/ ${names.size}</small></strong><div class="fzs-dots" aria-hidden="true">${Array.from({ length: Math.min(names.size, 24) }, (_, i) => `<i class="${i < playing ? 'is-on' : ''}"></i>`).join('')}</div></section>
        <section class="fzs-breakdown fzs-panel">${heading('Répartition des statistiques · ce soir')}${[['Buts', 'goals'], ['Aides', 'assists'], ['Tirs', 'shots'], ['Arrêts', 'saves']].map(([label, key]) => {
            const value = lines.reduce((n, p) => n + (Number(p[key]) || 0), 0);
            const max = Math.max(1, ...['goals', 'assists', 'shots', 'saves'].map(k => lines.reduce((n, p) => n + (Number(p[k]) || 0), 0)));
            return `<div class="fzs-stat"><span>${label}</span><b>${value}</b><div><i style="width:${value / max * 100}%"></i></div></div>`;
        }).join('')}</section>
        <div class="fzs-slot" data-fz-bloc="calendrier"></div>
        <div class="fzs-slot" data-fz-bloc="surveiller"></div>
        <section class="fzs-news fzs-panel">${heading('▤ &nbsp; Actualités NHL')}<div id="fzmNewsWrap">${empty('Chargement des actualités…')}</div></section>
        <div class="fzs-slot" data-fz-bloc="mouvements"></div>`;
    fzdPlaceCalendar();
    renderCalendar();
    // Le bloc « surveiller » devient l'activité de la ligue une fois le
    // repêchage fini : marché, échanges, semaines — il remplace l'ancienne
    // liste d'échanges seule.
    fzdRendreSurveiller();
    fzdRendreMouvements();
    fzsLoadNews(root);
    if (estH2H) fzsLoadDuel(root, activeName, FZPool.team().name);
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

async function fzsLoadNews(root) {
    const slot = root.querySelector('#fzmNewsWrap');
    const articles = await fetchNhlNews();
    if (!slot?.isConnected) return;
    slot.innerHTML = articles.length ? articles.slice(0, 2).map(a => `
        <a class="fzm-news-card" href="${escapeHTML(a.url)}" target="_blank" rel="noopener noreferrer">
            ${a.image ? `<img class="fzs-news-image" src="${escapeHTML(a.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
            <div class="fzm-news-kicker">${escapeHTML(a.source || 'NHL')}</div>
            <div class="fzm-news-headline">${escapeHTML(a.title)}</div>
        </a>`).join('') : '<p class="fzs-empty">Aucune actualité disponible pour le moment.</p>';
}
