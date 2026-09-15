/* Shared draft / season watchlist. The data owns both short and full notes. */
function fzhWatchHTML() {
    return `${fzhHeading('eye', 'À surveiller', '<div class="fzh-watch-filter"><select aria-label="Filtrer par équipe"></select><span data-watch-count role="status"></span></div>')}<div class="fzh-watch-track"></div><div class="fzh-watch-controls"><button type="button" data-watch-prev aria-label="Joueurs précédents">‹</button><div class="fzd-off-dots" data-watch-dots></div><button type="button" data-watch-next aria-label="Joueurs suivants">›</button></div>`;
}

function fzhWatchDots(panel, bind = false) {
    const args = [panel.querySelector('.fzh-watch-track'), panel.querySelector('[data-watch-dots]'), panel.querySelector('[data-watch-prev]'), panel.querySelector('[data-watch-next]')];
    if (bind) bindOffseasonCarousel(...args);
    renderOffseasonDots(...args);
}

function fzhWatchId(p) {
    const pools = typeof FZDraftKit !== 'undefined' ? FZDraftKit.pools() : {};
    const key = name => String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const record = [...(pools.skaters || []), ...(pools.goalies || [])].find(row => key(row.skaterFullName || row.goalieFullName) === key(p.name));
    const stats = typeof getPlayerStats === 'function' ? getPlayerStats(p.name) : null;
    const face = typeof fzdHeadshotByName === 'function' ? fzdHeadshotByName(p.name) : '';
    const id = Number(p.playerId || record?.playerId || stats?.playerId || face?.match(/\/(\d+)\.png(?:\?|$)/)?.[1]);
    return Number.isInteger(id) && id > 0 && !(window.FZ_IDS_ERRONES || []).includes(id) ? id : null;
}

function fzhRenderWatch(root) {
    const panel = root.querySelector('[data-watch-panel]');
    if (!panel) return;
    loadOffWatchFavorites();
    const select = panel.querySelector('select');
    const selected = select.value || 'all';
    const teams = [...new Map(OFFSEASON_WATCHLIST.map(p => [p.team, p.teamName || p.team])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
    select.innerHTML = `<option value="all">Toutes les équipes (${OFFSEASON_WATCHLIST.length})</option>` + teams.map(([team, name]) => `<option value="${escapeHTML(team)}">${escapeHTML(name)}</option>`).join('');
    select.value = teams.some(([team]) => team === selected) ? selected : 'all';
    const render = () => {
        const shown = OFFSEASON_WATCHLIST.filter(p => select.value === 'all' || p.team === select.value);
        panel.querySelector('[data-watch-count]').textContent = `${shown.length} joueur${shown.length === 1 ? '' : 's'}`;
        const track = panel.querySelector('.fzh-watch-track');
        track.classList.toggle('is-empty', !shown.length);
        track.innerHTML = shown.length ? shown.map((p, i) => {
            const id = fzhWatchId(p), saved = offWatchFavorites.has(p.name);
            return `<article class="fzh-watch-row"${id ? ` role="button" tabindex="0" data-watch-index="${i}" aria-label="Voir la fiche de ${escapeHTML(p.name)}"` : ''} title="${escapeHTML(p.note || '')}">${offPlayerFaceHTML(p.name, p.team, id)}<div class="fzh-watch-name"><strong>${escapeHTML(p.name)}</strong><small>${escapeHTML(p.team)} · ${escapeHTML(p.position || '—')}</small></div><span class="fzh-watch-status">${fzhIcon('eye', 17)}<span>${escapeHTML(p.summary || p.note || 'Surveillance')}</span></span><button type="button" class="fzh-watch-star${saved ? ' is-saved' : ''}" data-fzh-player="${escapeHTML(p.name)}" aria-label="${saved ? 'Retirer' : 'Ajouter'} ${escapeHTML(p.name)} ${saved ? 'des' : 'aux'} favoris" aria-pressed="${saved}">${fzhIcon('star', 22)}</button></article>`;
        }).join('') : '<p class="fzh-empty">Aucun joueur à surveiller pour le moment.</p>';
        track.scrollLeft = 0;
        track.querySelectorAll('[data-watch-index]').forEach(card => {
            const open = () => { const p = shown[Number(card.dataset.watchIndex)]; fzhOpenWatchCareer(p, fzhWatchId(p)); };
            card.addEventListener('click', open);
            card.addEventListener('keydown', event => {
                if (event.target !== card || !['Enter', ' '].includes(event.key)) return;
                event.preventDefault(); open();
            });
        });
        track.querySelectorAll('[data-fzh-player]').forEach(button => button.addEventListener('click', event => {
            event.stopPropagation();
            const name = button.dataset.fzhPlayer;
            if (offWatchFavorites.has(name)) offWatchFavorites.delete(name);
            else offWatchFavorites.set(name, new Date().toISOString());
            try { localStorage.setItem(offWatchStorageKey(), JSON.stringify([...offWatchFavorites])); } catch (_) { /* Session remains usable. */ }
            const saved = offWatchFavorites.has(name);
            button.classList.toggle('is-saved', saved);
            button.setAttribute('aria-pressed', String(saved));
            button.setAttribute('aria-label', `${saved ? 'Retirer' : 'Ajouter'} ${name} ${saved ? 'des' : 'aux'} favoris`);
        }));
        fzhWatchDots(panel, true);
    };
    select.onchange = render;
    render();
    // Late data/identity loads must also make the current home usable.
    if (!panel.dataset.watchLoaded && typeof FZDraftKit !== 'undefined') {
        panel.dataset.watchLoaded = '1';
        Promise.all([FZDraftKit.chargerWatchlist(), FZDraftKit.charger()]).then(([list]) => {
            if (!panel.isConnected) return;
            OFFSEASON_WATCHLIST = list;
            fzhRenderWatch(root);
        }).catch(() => {});
    }
}

let fzhCareerData = null;
function fzhOpenWatchCareer(player, id) {
    if (!id) return;
    fzhCareerData = null;
    const request = fzOpenCareerModal(id, player.name, {
        onData(data) { data.isGoalie = player.kind === 'goalie'; fzhCareerData = data; },
        renderStats: filterCareerStats
    });
    let note = document.getElementById('fzhWatchCareerNote');
    if (!note) {
        note = document.createElement('p'); note.id = 'fzhWatchCareerNote'; note.className = 'fzh-career-note';
        document.getElementById('careerProfileBody').prepend(note);
    }
    note.textContent = player.note || '';
    return request;
}

function closeCareerModal() { fzCloseCareerModal(); fzhCareerData = null; }
function filterCareerStats() {
    if (!fzhCareerData) return;
    const league = document.getElementById('leagueFilter').value;
    const type = document.getElementById('gameTypeFilter').value;
    const rows = (fzhCareerData.seasons || []).filter(s => (league === 'all' || (league === 'nhl' ? s.league === 'NHL' : s.league !== 'NHL')) && (type === 'all' || s.gameType === type));
    const columns = [['season', 'Saison'], ['league', 'Ligue'], ['team', 'Équipe'], ['gp', 'MJ'], ...(fzhCareerData.isGoalie ? [['wins', 'V'], ['losses', 'D'], ['otLosses', 'DP'], ['savePct', '% ARR'], ['gaa', 'MBC'], ['shutouts', 'BL']] : [['goals', 'B'], ['assists', 'A'], ['points', 'PTS'], ['plusMinus', '+/−'], ['pim', 'PUN'], ['shots', 'Tirs']])];
    document.getElementById('statsCountBadge').textContent = `${rows.length} saison${rows.length === 1 ? '' : 's'} affichée${rows.length === 1 ? '' : 's'}`;
    const cell = (row, key) => key === 'savePct' && row[key] != null ? Number(row[key]).toFixed(3) : key === 'gaa' && row[key] != null ? Number(row[key]).toFixed(2) : row[key] ?? '—';
    document.getElementById('careerStatsTable').innerHTML = rows.length ? `<table><thead><tr>${columns.map(([key, label]) => `<th scope="col" class="${escapeHTML(key)}-col">${escapeHTML(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(([key]) => `<td class="${escapeHTML(key)}-col">${escapeHTML(String(cell(row, key)))}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="no-stats-message">Aucune statistique correspondant aux filtres sélectionnés.</p>';
}
