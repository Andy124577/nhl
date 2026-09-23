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


/* ============================================================
   APRÈS LE REPÊCHAGE — LA VIE DE LA LIGUE
   ------------------------------------------------------------
   « À surveiller » sert à préparer un repêchage : une fois les choix
   faits, la liste des espoirs de la LNH n'aide plus personne. Le même
   panneau (même nœud partagé, même châssis de carrousel) raconte alors
   ce qui se passe DANS le pool : les joueurs mis en vente, les échanges
   conclus, les semaines finalisées. Rien n'est inventé — tout vient de
   /trade-listings et du fil d'activité durable (/api/pools/:pool/activity),
   avec les échanges complétés en repli quand ce fil n'existe pas.
   ============================================================ */

/** Le repêchage du pool actif est-il terminé ? */
function fzhRepechageFini() {
    if (!window.FZPool) return false;
    const nom = FZPool.get();
    const pool = nom && (FZPool.mine() || []).find(p => p.name === nom);
    return !!pool && FZPool.draftState(pool.data).etat === 'termine';
}

function fzhLigueHTML() {
    const icone = typeof getIcon === 'function' ? getIcon('users', 20) : '';
    return `
        <div class="fzd-off-head">
            <h2 class="fzd-section-title"><span data-icon="users" aria-hidden="true">${icone}</span>Activité de la ligue</h2>
            <div class="fzd-off-nav">
                <button type="button" class="fzd-off-nav-btn" data-ligue-prev aria-label="Activité précédente">‹</button>
                <button type="button" class="fzd-off-nav-btn" data-ligue-next aria-label="Activité suivante">›</button>
            </div>
        </div>
        <div class="fzh-watch-filter">
            <a class="fzh-ligue-link" href="trade.html">Voir le marché des échanges →</a>
            <span class="fzh-watch-count" data-ligue-count role="status"></span>
        </div>
        <div class="fzd-off-track fzh-ligue-track"><p class="fzd-off-empty">Chargement de l’activité…</p></div>
        <div class="fzd-off-dots" data-ligue-dots></div>`;
}

const FZH_LIGUE_TTL = 60000;
let fzhLigueCache = { pool: null, date: 0, donnees: null, requete: null };

/** Catégorie d'une annonce → code attendu par le préremplissage de trade.html. */
function fzhCodeCategorie(cat) {
    const c = String(cat || '').toLowerCase();
    if (c === 'f' || c.startsWith('off')) return 'F';
    if (c === 'd' || c.startsWith('def')) return 'D';
    if (c === 'g' || c.startsWith('goal')) return 'G';
    if (c === 'r' || c.startsWith('rook')) return 'R';
    if (c === 't' || c.startsWith('team')) return 'T';
    return '';
}

const FZH_LIBELLE_CATEGORIE = { F: 'Attaquant', D: 'Défenseur', G: 'Gardien', R: 'Recrue', T: 'Équipe LNH' };

async function fzhChargerLigue(nomPool) {
    if (!nomPool) return null;
    const frais = fzhLigueCache.pool === nomPool && (Date.now() - fzhLigueCache.date) < FZH_LIGUE_TTL;
    if (frais && fzhLigueCache.donnees) return fzhLigueCache.donnees;
    if (fzhLigueCache.pool === nomPool && fzhLigueCache.requete) return fzhLigueCache.requete;

    const base = (window.FZPool && FZPool.BASE_URL) || '';
    const enc = encodeURIComponent(nomPool);
    const lire = url => fetch(url, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);

    const requete = (async () => {
        const [activite, annonces] = await Promise.all([
            lire(`${base}/api/pools/${enc}/activity?limit=40`),
            lire(`${base}/trade-listings/${enc}`)
        ]);

        let fil = null;
        if (activite && activite.disponible === true && Array.isArray(activite.evenements)) {
            // Les choix du repêchage sont déjà dans le récapitulatif : ils
            // noieraient le reste du fil.
            fil = activite.evenements
                .filter(e => e.type !== 'pick' && e.type !== 'draft_started')
                .map(e => ({ type: e.type, texte: e.texte, moment: e.occurredAt, sujet: e.sujet || {} }));
        } else {
            const echanges = await lire(`${base}/trades/${enc}`);
            fil = (Array.isArray(echanges) ? echanges : []).map(t => ({
                type: 'trade_completed',
                moment: t.completedDate || t.date,
                texte: `${t.fromTeam} et ${t.toTeam} ont conclu un échange : `
                     + `${(t.offering || []).map(p => p.name).join(', ')} contre ${(t.receiving || []).map(p => p.name).join(', ')}.`
            }));
        }

        const donnees = {
            marche: Array.isArray(annonces) ? annonces : [],
            fil: fil.slice(0, 20)
        };
        fzhLigueCache = { pool: nomPool, date: Date.now(), donnees, requete: null };
        return donnees;
    })();
    fzhLigueCache = { ...fzhLigueCache, pool: nomPool, requete };
    return requete;
}

function fzhLigueCarteVente(a) {
    const code = fzhCodeCategorie(a.category);
    const lien = a.mienne
        ? 'trade.html'
        : `trade.html?withTeam=${encodeURIComponent(a.teamName)}&wantPlayer=${encodeURIComponent(a.playerName)}${code ? `&category=${code}` : ''}`;
    const club = [a.teamName, FZH_LIBELLE_CATEGORIE[code] || ''].filter(Boolean).join(' · ');
    return `
        <a class="fzd-off-card fzh-ligue-card is-sale" href="${escapeHTML(lien)}">
            <div class="fzd-off-card-top">
                <span class="fzd-off-tag is-sale">À vendre</span>
                <span class="fzd-off-card-date">${a.createdAt && typeof dayLabelFr === 'function' ? escapeHTML(dayLabelFr(a.createdAt)) : ''}</span>
            </div>
            <div class="fzd-off-player">
                ${typeof offPlayerFaceHTML === 'function' && code !== 'T' ? offPlayerFaceHTML(a.playerName, '', null) : ''}
                <div class="fzd-off-player-info">
                    <div class="fzd-off-card-name fzd-display">${escapeHTML(a.playerName)}</div>
                    <div class="fzd-off-card-club">${escapeHTML(club)}</div>
                </div>
            </div>
            <div class="fzd-off-card-stats">
                <div class="fzd-off-stat">
                    <span class="fzd-off-stat-lbl">${a.mienne ? 'Votre annonce' : 'Intéressé ?'}</span>
                    <span class="fzd-off-stat-val">${a.mienne ? 'En attente d’offres' : 'Faire une offre →'}</span>
                </div>
            </div>
        </a>`;
}

const FZH_LIGUE_TAG = {
    trade_completed: ['Échange', 'is-trade'],
    listing_activated: ['Marché', 'is-sale'],
    listing_removed: ['Marché', 'is-signing'],
    h2h_week_finalized: ['Semaine', 'is-signing'],
    draft_complete: ['Repêchage', 'is-signing']
};

function fzhLigueCarteFil(e) {
    const [tag, classe] = FZH_LIGUE_TAG[e.type] || ['Pool', 'is-signing'];
    return `
        <article class="fzd-off-card fzh-ligue-card">
            <div class="fzd-off-card-top">
                <span class="fzd-off-tag ${classe}">${tag}</span>
                <span class="fzd-off-card-date">${e.moment && typeof dayLabelFr === 'function' ? escapeHTML(dayLabelFr(e.moment)) : ''}</span>
            </div>
            <p class="fzh-ligue-text">${escapeHTML(e.texte || '')}</p>
        </article>`;
}

/** Remplit le panneau avec la vie du pool actif. */
async function fzhRenderLigue(panel) {
    const nom = window.FZPool ? FZPool.get() : null;
    const track = panel.querySelector('.fzh-ligue-track');
    if (!track) return;
    const donnees = await fzhChargerLigue(nom);
    if (!panel.isConnected || panel.dataset.vue !== 'ligue') return;

    const marche = (donnees && donnees.marche) || [];
    // Une annonce ouverte est déjà une carte « À vendre » : son entrée de fil
    // la répéterait.
    const fil = ((donnees && donnees.fil) || []).filter(e => e.type !== 'listing_activated');
    const cartes = [...marche.map(fzhLigueCarteVente), ...fil.map(fzhLigueCarteFil)];

    const compte = panel.querySelector('[data-ligue-count]');
    if (compte) compte.textContent = marche.length
        ? `${marche.length} joueur${marche.length > 1 ? 's' : ''} en vente`
        : '';
    track.classList.toggle('is-empty', !cartes.length);
    track.innerHTML = cartes.length
        ? cartes.join('')
        : '<p class="fzd-off-empty">Rien de neuf dans la ligue pour l’instant. Mettez un joueur en vente depuis votre alignement pour lancer les échanges.</p>';
    track.scrollLeft = 0;

    const args = [track, panel.querySelector('[data-ligue-dots]'), panel.querySelector('[data-ligue-prev]'), panel.querySelector('[data-ligue-next]')];
    // La piste est neuve à chaque bascule de vue : son propre drapeau
    // (carouselBound) évite de la brancher deux fois.
    if (typeof bindOffseasonCarousel === 'function') bindOffseasonCarousel(...args);
    if (typeof renderOffseasonDots === 'function') renderOffseasonDots(...args);
}
