/* Shared draft / season watchlist. The data owns both short and full notes. */

/**
 * Le châssis du panneau — celui de « Mouvements récents », à l'identique.
 *
 * Les deux panneaux sont voisins dans le bloc hors-saison et racontent la
 * même chose sous deux angles : ce qui vient d'arriver, ce qui s'en vient.
 * Ils partagent donc les classes .fzd-off-* plutôt que d'entretenir deux
 * jeux de cartes qui finiraient par diverger. Seuls le filtre par équipe et
 * l'étoile des favoris appartiennent en propre à « À surveiller ».
 */
function fzhWatchHTML() {
    // icons.js ne remplit les [data-icon] qu'au DOMContentLoaded ; ce panneau
    // est écrit bien après, il pose donc son SVG lui-même.
    const oeil = typeof getIcon === 'function' ? getIcon('eye', 20) : '';
    return `
        <div class="fzd-off-head">
            <h2 class="fzd-section-title"><span data-icon="eye" aria-hidden="true">${oeil}</span>À surveiller</h2>
            <div class="fzd-off-nav">
                <button type="button" class="fzd-off-nav-btn" data-watch-prev aria-label="Joueurs précédents">‹</button>
                <button type="button" class="fzd-off-nav-btn" data-watch-next aria-label="Joueurs suivants">›</button>
            </div>
        </div>
        <div class="fzh-watch-filter">
            <select aria-label="Filtrer par équipe"></select>
            <span class="fzh-watch-count" data-watch-count role="status"></span>
        </div>
        <div class="fzd-off-track fzh-watch-track"></div>
        <div class="fzd-off-dots" data-watch-dots></div>`;
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

// La trousse ne date pas ses fiches : seule une mise en favori porte une date,
// celle du geste de l'utilisateur. Les autres cartes n'annoncent donc qu'un
// suivi à venir, plutôt qu'une date inventée. Le mot tient dans la pastille
// de la carte, là où « Échange » ou « Blessé » tient sur celles d'à côté.
function fzhWatchKicker(saved) {
    return saved ? 'Suivi' : 'À surveiller';
}

function fzhWatchSince(name) {
    const iso = offWatchFavorites.get(name);
    return iso && typeof dayLabelFr === 'function' ? dayLabelFr(iso) : '';
}

/**
 * Une carte de joueur, sur le gabarit des cartes de mouvement : pastille et
 * date en tête, photo et identité au milieu, le pied que la carte de blessure
 * réserve à ses deux chiffres. L'étoile des favoris prend le coin resté libre.
 *
 * Le pied porte toujours la même chose — la raison de suivre ce joueur, telle
 * que la trousse l'écrit. La mise en favori ne la change pas : elle ne fait
 * qu'ajouter une date en tête, la seule que ces fiches connaissent.
 */
function fzhWatchCardHTML(p, index, id, saved) {
    const club = [p.teamName || p.team, p.position && p.position !== '—' ? p.position : '']
        .filter(Boolean).join(' · ');
    return `
        <article class="fzd-off-card fzh-watch-row${saved ? ' is-saved' : ''}"${id ? ` role="button" tabindex="0" data-watch-index="${index}" aria-label="Voir la fiche de ${escapeHTML(p.name)}"` : ''}>
            <div class="fzd-off-card-top">
                <span class="fzd-off-tag is-watch">${fzhWatchKicker(saved)}</span>
                <span class="fzd-off-card-date">${escapeHTML(fzhWatchSince(p.name))}</span>
                <button type="button" class="fzh-watch-star${saved ? ' is-saved' : ''}" data-fzh-player="${escapeHTML(p.name)}" aria-label="${saved ? 'Retirer' : 'Ajouter'} ${escapeHTML(p.name)} ${saved ? 'des' : 'aux'} favoris" aria-pressed="${saved}">${fzhIcon('star', 15)}</button>
            </div>
            <div class="fzd-off-player">
                ${offPlayerFaceHTML(p.name, p.team, id)}
                <div class="fzd-off-player-info">
                    <div class="fzd-off-card-name fzd-display">${escapeHTML(p.name)}</div>
                    <div class="fzd-off-card-club">${escapeHTML(club)}</div>
                </div>
            </div>
            <div class="fzd-off-card-stats">
                <div class="fzd-off-stat">
                    <span class="fzd-off-stat-lbl">Pourquoi le suivre</span>
                    <span class="fzd-off-stat-val fzh-watch-status" title="${escapeHTML(p.note || '')}">${escapeHTML(p.summary || p.note || 'Surveillance')}</span>
                </div>
            </div>
        </article>`;
}

/** `root` est soit le panneau lui-même, soit l'accueil qui le contient. */
function fzhRenderWatch(root) {
    const panel = root.matches('[data-watch-panel]') ? root : root.querySelector('[data-watch-panel]');
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
        track.innerHTML = shown.length
            ? shown.map((p, i) => fzhWatchCardHTML(p, i, fzhWatchId(p), offWatchFavorites.has(p.name))).join('')
            : '<p class="fzd-off-empty">Aucun joueur à surveiller pour le moment.</p>';
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
            const card = button.closest('.fzh-watch-row');
            card.classList.toggle('is-saved', saved);
            card.querySelector('.fzd-off-tag').textContent = fzhWatchKicker(saved);
            card.querySelector('.fzd-off-card-date').textContent = fzhWatchSince(name);
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
            fzhRenderWatch(panel);
        }).catch(() => {});
    }
}

let fzhCareerData = null;
function fzhOpenWatchCareer(player, id) {
    if (!id) return;
    fzhCareerData = null;
    const request = fzOpenCareerModal(id, player.name, {
        // La trousse dit d'avance si la fiche est celle d'un gardien ; un
        // buteur du calendrier, lui, n'arrive qu'avec un nom, et c'est alors
        // la fiche elle-même qui tranche une fois chargée.
        onData(data) { data.isGoalie = player.kind ? player.kind === 'goalie' : data.position === 'G'; fzhCareerData = data; },
        renderStats: filterCareerStats
    });
    let note = document.getElementById('fzhWatchCareerNote');
    if (!note) {
        note = document.createElement('p'); note.id = 'fzhWatchCareerNote'; note.className = 'fzh-career-note';
        document.getElementById('careerProfileBody').prepend(note);
    }
    note.textContent = player.note || '';
    // Sans note, le filet bleu de la note resterait seul en haut de la fiche.
    note.hidden = !player.note;
    return request;
}

/**
 * La même fiche, ouverte depuis ailleurs qu'« À surveiller » — un buteur du
 * calendrier, par exemple. Il n'y a rien de plus à dire que le nom : la note
 * de la trousse reste vide et la fiche se lit telle quelle.
 */
function fzhOpenPlayerCareer(playerId, name) {
    const id = Number(playerId);
    if (!Number.isInteger(id) || id <= 0) return;
    return fzhOpenWatchCareer({ name, note: '' }, id);
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
