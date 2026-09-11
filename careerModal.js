/* Shared player profile presentation. Page adapters retain their existing
 * career tables, game logs and draft confirmation flow. */
(function () {
    'use strict';

    const teams = {
        ANA: 'Anaheim Ducks', ARI: 'Arizona Coyotes', BOS: 'Boston Bruins', BUF: 'Buffalo Sabres',
        CAR: 'Carolina Hurricanes', CBJ: 'Columbus Blue Jackets', CGY: 'Calgary Flames', CHI: 'Chicago Blackhawks',
        COL: 'Colorado Avalanche', DAL: 'Dallas Stars', DET: 'Detroit Red Wings', EDM: 'Edmonton Oilers',
        FLA: 'Florida Panthers', LAK: 'Los Angeles Kings', MIN: 'Minnesota Wild', MTL: 'Montréal Canadiens',
        NJD: 'New Jersey Devils', NSH: 'Nashville Predators', NYI: 'New York Islanders', NYR: 'New York Rangers',
        OTT: 'Ottawa Senators', PHI: 'Philadelphia Flyers', PIT: 'Pittsburgh Penguins', SEA: 'Seattle Kraken',
        SJS: 'San Jose Sharks', STL: 'St. Louis Blues', TBL: 'Tampa Bay Lightning', TOR: 'Toronto Maple Leafs',
        UTA: 'Utah Mammoth', VAN: 'Vancouver Canucks', VGK: 'Vegas Golden Knights', WPG: 'Winnipeg Jets', WSH: 'Washington Capitals'
    };
    const paths = {
        star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
        plus: 'M12 4v16M4 12h16',
        goals: 'M19 5 5 19M5 5l14 14M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10',
        assists: 'M16 21v-2a6 6 0 0 0-12 0v2M10 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M17 3a4 4 0 0 1 0 8M20 21v-2a6 6 0 0 0-3-5.2',
        points: 'M3 14h4v8H3ZM10 9h4v13h-4ZM17 3h4v19h-4Z',
        person: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 22v-3a8 8 0 0 1 16 0v3'
    };
    // La fiche reste sur fond noir dans les deux thèmes. Quatre crests sont en
    // bleu marine plein et s'y effacent : on prend la variante claire, celle que
    // teamLogos.css sert déjà aux <img> de la page.
    const crestsClairs = ['EDM', 'TBL', 'TOR', 'WSH'];
    const crest = code => crestsClairs.includes(code) ? `teams/dark/${code}.svg` : `teams/${code}.png`;
    const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"></path></svg>`;
    const el = id => document.getElementById(id);
    let request = 0, active = null, previousFocus = null, previousOverflow = '';

    function teamCode(value) {
        const name = String(value || '').trim();
        if (teams[name.toUpperCase()]) return name.toUpperCase();
        return Object.keys(teams).find(code => teams[code].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
            === name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()) || '';
    }

    function mount() {
        const modal = el('careerStatsModal');
        if (!modal || el('careerProfileBody')) return;
        modal.innerHTML = `<div class="modal-content career-modal" role="dialog" aria-modal="true" aria-labelledby="careerPlayerName" tabindex="-1">
            <header class="cmh-name-banner" id="careerNameBanner">
                <img class="cmh-banner-logo" id="careerBannerLogo" alt="" hidden>
                <div class="cmh-banner-copy"><div id="careerBannerName">Fiche du joueur</div><div class="cmh-team-caption" id="careerBannerTeam"></div></div>
                <button class="close-modal" type="button" aria-label="Fermer la fiche du joueur">×</button>
            </header>
            <div class="career-profile-body" id="careerProfileBody">
                <div id="careerLoading" class="career-loading" role="status" hidden><div class="cm-skeleton-photo"></div><div class="cm-skeleton-lines"></div><span>Chargement de la fiche du joueur…</span></div>
                <div class="career-modal-header" id="careerModalHeader" hidden>
                    <figure class="cmh-portrait"><div class="cmh-portrait-art" aria-hidden="true"></div><span class="cmh-portrait-number" id="careerArtNumber" aria-hidden="true"></span>
                        <div class="player-headshot-container" id="playerHeadshotContainer"></div>
                        <figcaption><b id="careerJerseyNumber"></b><span id="careerPortraitTeam"></span></figcaption>
                    </figure>
                    <div class="cmh-ident-text"><div class="cmh-position" id="careerPlayerPosition"></div><h2 id="careerPlayerName">Fiche du joueur</h2><span class="cmh-team-badge" id="careerPlayerTeam"></span></div>
                    <div class="cmh-actions" id="careerActions"><button type="button" class="cmh-action" id="careerFavorite">${icon('star')}<span>Ajouter aux favoris</span></button><button type="button" class="cmh-action cmh-action-pick" id="careerPick">${icon('plus')}<span>Choisir ce joueur</span></button></div>
                    <div class="cmh-stats">
                        <div class="cmh-stat-row"><span class="cmh-mini-lbl">Taille / Poids</span><span class="cmh-stat-val"><span id="playerHeight">—</span>, <span id="playerWeight">—</span></span></div>
                        <div class="cmh-stat-row"><span class="cmh-mini-lbl">Né le</span><span class="cmh-stat-val" id="playerBirthDate">—</span></div>
                        <div class="cmh-stat-row"><span class="cmh-mini-lbl">Lieu</span><span class="cmh-stat-val" id="playerBirthPlace">—</span></div>
                        <div class="cmh-stat-row"><span class="cmh-mini-lbl">Repêchage</span><span class="cmh-stat-val" id="playerDraft">—</span></div>
                    </div>
                    <div class="cmh-season-highlight" id="careerSeasonHighlight"></div>
                    <div class="cmh-injury" id="careerInjuryBanner" hidden></div>
                </div>
                <div class="career-filters" id="careerFilters" hidden>
                    <div class="filter-group-career"><label for="viewFilter">Vue</label><select id="viewFilter"><option value="career">Carrière</option></select></div>
                    <div class="filter-group-career"><label for="leagueFilter">Ligue</label><select id="leagueFilter"><option value="nhl">NHL seulement</option><option value="all">Toutes les ligues</option><option value="other">Autres ligues</option></select></div>
                    <div class="filter-group-career"><label for="gameTypeFilter">Type de saison</label><select id="gameTypeFilter"><option value="regular">Saison régulière</option><option value="playoffs">Séries éliminatoires</option><option value="all">Tous</option></select></div>
                </div>
                <div class="stats-count-badge" id="statsCountBadge" role="status"></div>
                <div id="careerStatsTable" tabindex="0" role="region" aria-label="Statistiques du joueur"></div>
            </div>
        </div>`;
        modal.querySelector('.close-modal').addEventListener('click', () => window.closeCareerModal());
        modal.addEventListener('click', event => {
            if (event.target === modal) { event.stopPropagation(); window.closeCareerModal(); }
        });
        modal.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopPropagation(); window.closeCareerModal(); }
            if (event.key !== 'Tab') return;
            const focusable = [...modal.querySelectorAll('button:not(:disabled), select, [tabindex="0"]')].filter(node => node.getClientRects().length);
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        });
        el('leagueFilter').addEventListener('change', () => window.filterCareerStats());
        el('gameTypeFilter').addEventListener('change', () => window.filterCareerStats());
        el('viewFilter').addEventListener('change', () => { if (typeof handleViewChange === 'function') handleViewChange(); });
        el('careerFavorite').addEventListener('click', toggleFavorite);
        el('careerPick').addEventListener('click', () => {
            if (!active || !canPick()) return;
            const data = active;
            const record = typeof fzFindRecord === 'function' ? fzFindRecord(data.playerName) : null;
            const position = record && typeof fzPositionCode === 'function' ? fzPositionCode(record.rec, record.kind) : data.position;
            window.closeCareerModal();
            selectPlayer(data.playerName, position);
        });
        new MutationObserver(decorateTable).observe(el('careerStatsTable'), { childList: true, subtree: true });
    }

    function applyTeam(code) {
        const card = el('careerStatsModal').querySelector('.career-modal');
        const [primary, secondary] = getTeamColors(code);
        // Darken only surfaces carrying white text; lift outline colors so navy
        // and black teams retain the same crisp edges as red and gold teams.
        let surface = shadeHex(primary, -.12);
        while (hexLuminance(surface) > .14) surface = shadeHex(surface, -.1);
        const channels = [1, 3, 5].map(i => parseInt(primary.slice(i, i + 2), 16));
        const boost = 255 / Math.max(...channels, 1);
        let edge = '#' + channels.map(v => Math.round(v * boost).toString(16).padStart(2, '0')).join('');
        while (hexLuminance(edge) < .23) edge = shadeHex(edge, .14);
        const trim = hexLuminance(secondary) < .08 ? edge : shadeHex(secondary, .2);
        const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ');
        const vars = { 'team-primary': primary, 'team-secondary': secondary, 'team-surface': surface,
            'team-edge': edge, 'team-trim': trim, 'team-rgb': rgb(primary), 'team-secondary-rgb': rgb(secondary),
            'team-logo': code && code !== 'ARI' ? `url("${crest(code)}")` : 'none' };
        Object.entries(vars).forEach(([key, value]) => card.style.setProperty(`--${key}`, value));
        card.dataset.team = code || 'neutral';
        const logo = el('careerBannerLogo');
        logo.hidden = !code || code === 'ARI';
        logo.onerror = () => { logo.hidden = true; };
        if (!logo.hidden) logo.src = `teams/${code}.png`;
        else logo.removeAttribute('src');
    }

    function favoriteKey() {
        if (typeof fzFavKey === 'function') return fzFavKey();
        const clan = typeof currentClan !== 'undefined' ? currentClan : (localStorage.getItem('activePool') || '');
        return 'fzFavoris_' + clan + '_' + (localStorage.getItem('username') || '');
    }
    function favorites() {
        try { const list = JSON.parse(localStorage.getItem(favoriteKey()) || '[]'); return Array.isArray(list) ? list : []; }
        catch (_) { return []; }
    }
    function updateFavorite() {
        const selected = active && (typeof fzIsFavorite === 'function' ? fzIsFavorite(active.playerName) : favorites().includes(active.playerName));
        el('careerFavorite').setAttribute('aria-pressed', String(Boolean(selected)));
        el('careerFavorite').querySelector('span').textContent = selected ? 'Retirer des favoris' : 'Ajouter aux favoris';
    }
    function toggleFavorite() {
        if (!active) return;
        if (typeof fzToggleFavorite === 'function') fzToggleFavorite(active.playerName);
        else {
            const list = favorites(), index = list.indexOf(active.playerName);
            if (index < 0) list.push(active.playerName); else list.splice(index, 1);
            try { localStorage.setItem(favoriteKey(), JSON.stringify(list)); }
            catch (_) { el('careerFavorite').querySelector('span').textContent = 'Stockage indisponible'; return; }
        }
        updateFavorite();
    }
    function canPick() {
        return active && typeof selectPlayer === 'function' && typeof isUserTurn === 'function' && isUserTurn()
            && typeof checkIfUserTeamIsDone === 'function' && !checkIfUserTeamIsDone()
            && !(typeof fzPickedSet === 'function' && fzPickedSet().has(active.playerName));
    }

    function seasonDisplay(season) {
        const value = String(season || '');
        return value.length === 8 ? `${value.slice(0, 4)}-${value.slice(6)}` : value;
    }
    function renderSeason(data, playerId) {
        const stats = typeof currentStats !== 'undefined' ? currentStats : null;
        const pool = (stats?.players || []).filter(p => (p.position === 'G') === Boolean(data.isGoalie));
        const current = pool.find(p => String(p.playerId) === String(playerId));
        const latest = (data.seasons || []).filter(s => s.league === 'NHL' && s.gameType === 'regular')
            .sort((a, b) => b.season.localeCompare(a.season))[0];
        const season = seasonDisplay(stats?.season || latest?.season);
        const matching = (data.seasons || []).filter(s => s.league === 'NHL' && s.gameType === 'regular' && s.season === season);
        const fallback = matching.length ? matching.reduce((sum, s) => {
            for (const key of ['goals', 'assists', 'points', 'wins', 'shutouts', 'gp']) sum[key] = (sum[key] || 0) + (s[key] || 0);
            return sum;
        }, {}) : null;
        const values = current || fallback;
        const tiles = data.isGoalie ? [['Victoires', 'wins', 'goals'], ['Blanchissages', 'shutouts', 'assists'], ['Matchs joués', 'gamesPlayed', 'points']]
            : [['Buts', 'goals', 'goals'], ['Aides', 'assists', 'assists'], ['Points', 'points', 'points']];
        const container = el('careerSeasonHighlight');
        container.innerHTML = `<div class="cmh-season-label"><span class="cmh-mini-lbl">${stats?.season ? 'Saison actuelle' : 'Dernière saison NHL'}</span><strong></strong><span>NHL – Saison régulière</span></div>`
            + tiles.map(([label, key, symbol]) => {
                const value = values ? (values[key] ?? (key === 'gamesPlayed' ? values.gp : null) ?? '—') : '—';
                const ranked = current && Number.isFinite(current[key]) ? pool.filter(p => Number.isFinite(p[key])) : [];
                const rank = ranked.filter(p => p[key] > value).length + 1;
                const tied = ranked.filter(p => p[key] === value).length > 1;
                const rankText = ranked.length ? `${tied ? 'Égalité – ' : ''}${rank}${rank === 1 ? 'er' : 'e'}` : 'Rang indisponible';
                return `<div class="cmh-season-tile">${icon(symbol)}<div><span class="cmh-mini-lbl">${label}</span><strong class="cmh-season-val">${value}</strong><span class="cmh-season-rank">${rankText}</span></div></div>`;
            }).join('');
        container.querySelector('.cmh-season-label strong').textContent = season || '—';
        el('careerStatsTable').dataset.season = season;
    }

    function renderProfile(data, playerId) {
        active = data;
        const code = teamCode(data.currentTeam), team = teams[code] || data.currentTeam || 'Sans équipe NHL';
        applyTeam(code);
        for (const id of ['careerPlayerName', 'careerBannerName']) el(id).textContent = data.playerName;
        for (const id of ['careerPlayerTeam', 'careerBannerTeam', 'careerPortraitTeam']) el(id).textContent = team;
        const role = data.isGoalie ? 'Gardien' : data.position === 'D' ? 'Défenseur' : 'Attaquant';
        el('careerPlayerPosition').textContent = `${role}   |   ${data.position || '—'}`;
        const number = data.sweaterNumber ?? data.jerseyNumber;
        el('careerArtNumber').textContent = number ?? '';
        el('careerJerseyNumber').textContent = number != null ? `#${number}` : code;
        const photo = el('playerHeadshotContainer');
        photo.classList.remove('has-photo');
        photo.innerHTML = `<div class="no-photo" role="img" aria-label="Portrait indisponible">${icon('person')}</div>`;
        if (data.headshot) {
            const img = new Image(); img.alt = data.playerName;
            img.setAttribute('data-no-lazy', '');
            img.onload = () => { if (photo.contains(img)) photo.classList.add('has-photo'); };
            img.onerror = () => img.remove();
            photo.appendChild(img);
            img.src = data.headshot;
        }
        el('playerHeight').textContent = data.height || '—';
        el('playerWeight').textContent = data.weight ? `${data.weight} lb` : '—';
        const birth = new Date(data.birthDate + 'T12:00:00'), now = new Date();
        let age = now.getFullYear() - birth.getFullYear();
        if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
        el('playerBirthDate').textContent = data.birthDate ? `${data.birthDate}${Number.isFinite(age) ? ` (${age})` : ''}` : '—';
        el('playerBirthPlace').textContent = [data.birthCity, data.birthStateProvince].filter(Boolean).join(', ') || '—';
        const draft = data.draftInfo;
        el('playerDraft').textContent = draft ? `${draft.year}: Rd ${draft.round}, Ch. ${draft.pickInRound} (${draft.teamAbbrev})` : 'Non repêché';
        el('careerInjuryBanner').hidden = true;
        if (typeof renderInjuryBanner === 'function') renderInjuryBanner(data.playerName, code);
        renderSeason(data, playerId);
        updateFavorite();
        el('careerPick').disabled = !canPick();
        el('careerPick').title = canPick() ? '' : 'Disponible pendant votre tour au repêchage, pour un joueur non sélectionné.';
        if (typeof handleViewChange === 'function' && el('viewFilter').options.length === 1) el('viewFilter').add(new Option('Historique de match', 'gamelog'));
    }

    function decorateTable() {
        const table = el('careerStatsTable').querySelector('table');
        if (!table || table.dataset.premium) return;
        table.dataset.premium = 'true';
        for (const [cls, label] of [['season-col', 'Saison'], ['league-col', 'Ligue'], ['team-col', 'Équipe']]) {
            const th = table.querySelector(`th.${cls}`); if (th) th.textContent = label;
        }
        table.querySelectorAll('th').forEach(th => th.setAttribute('scope', 'col'));
        const season = el('careerStatsTable').dataset.season;
        table.querySelectorAll('tbody tr').forEach(row => {
            row.classList.toggle('current-season', Boolean(season) && row.querySelector('.season-col')?.textContent === season);
        });
    }

    window.fzCareerTeamCode = teamCode;
    window.fzOpenCareerModal = async function (playerId, playerName, adapter) {
        mount();
        const token = ++request, modal = el('careerStatsModal');
        if (modal.style.display !== 'block') { previousFocus = document.activeElement; previousOverflow = document.body.style.overflow; }
        active = null;
        modal.style.display = 'block'; document.body.style.overflow = 'hidden';
        el('careerProfileBody').scrollTop = 0;
        applyTeam('');
        el('careerBannerName').textContent = playerName || 'Fiche du joueur';
        el('careerPlayerName').textContent = playerName || 'Fiche du joueur';
        el('careerBannerTeam').textContent = '';
        el('careerLoading').hidden = false;
        el('careerModalHeader').hidden = true; el('careerFilters').hidden = true;
        el('careerStatsTable').replaceChildren();
        el('viewFilter').value = 'career'; el('leagueFilter').value = 'nhl'; el('gameTypeFilter').value = 'regular';
        el('leagueFilter').parentElement.style.display = ''; el('gameTypeFilter').parentElement.style.display = '';
        modal.querySelector('.close-modal').focus();
        try {
            const data = await fzChargerCarriere(playerId, typeof BASE_URL === 'string' ? BASE_URL : '');
            if (token !== request) return;
            adapter.onData(data);
            renderProfile(data, playerId);
            el('careerModalHeader').hidden = false; el('careerFilters').hidden = false;
            adapter.renderStats();
        } catch (error) {
            if (token !== request) return;
            const message = document.createElement('p'); message.className = 'no-stats-message'; message.setAttribute('role', 'alert');
            message.textContent = error.fzMessage || 'Impossible d’afficher la fiche du joueur. Veuillez réessayer.';
            el('careerStatsTable').replaceChildren(message);
        } finally { if (token === request) el('careerLoading').hidden = true; }
    };
    window.fzCloseCareerModal = function () {
        ++request; active = null;
        el('careerStatsModal').style.display = 'none';
        document.body.style.overflow = previousOverflow;
        if (previousFocus?.isConnected) previousFocus.focus();
    };
    // Defer scripts execute after the markup is parsed, before the existing
    // table-logo/totals observers attach on DOMContentLoaded.
    mount();
})();
