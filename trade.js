/* ============================================================ */
/* TRADE PAGE — single-screen builder, multi-pair, 1-for-1 each */
/* ============================================================ */

const BASE_URL = window.location.hostname.includes('localhost')
    ? 'http://localhost:3000'
    : window.location.origin;

// State
let currentUsername = null;
let selectedPool = null;
let selectedPoolData = null;
let selectedPartnerTeam = null;
let myTeamName = null;
let myTeamData = null;
let partnerTeamData = null;
let draftData = null;

// Trade builder state — a "pair" is a fully-matched {give, get} 1-for-1
// swap. Selecting one side while the other already has an unmatched pick
// auto-commits into a pair the instant categories match (see handlePick).
let pairs = [];
let draftGive = null;
let draftGet = null;

// Position + text filters, one set per side
let myPositionFilter = 'all';
let partnerPositionFilter = 'all';
let mySearchTerm = '';
let partnerSearchTerm = '';

// "À vendre" — pool-wide listings, filter chip lives on the partner side
let forSaleListings = [];
let forSaleFilterActive = false;

let teamSwitcherOpen = false;

// Player images & stats
let currentStats = null;

// ============================================================
// IMAGE & STATS HELPERS
// ============================================================
function getMatchingImage(name) {
    return resolveHeadshotByName(name);
}

function getPlayerCurrentStats(name) {
    if (!currentStats || !currentStats.players) return null;
    return currentStats.players.find(p => p.playerName === name) || null;
}

/**
 * Uniform PJ / B / A / Pts columns across every category.
 * Goalies: current-stats already aliases wins→goals and shutouts→assists,
 * but reads clearer pulled from the explicit wins/shutouts fields directly.
 * Team entries carry no individual stats — shown as dashes.
 */
function statColsFor(player) {
    if (player.category === 'T') return { pj: '—', b: '—', a: '—', pts: '—' };
    const stats = getPlayerCurrentStats(player.name);
    if (player.category === 'G') {
        return {
            pj: stats?.gamesPlayed ?? 0,
            b: stats?.wins ?? 0,
            a: stats?.shutouts ?? 0,
            pts: stats?.points ?? 0
        };
    }
    return {
        pj: stats?.gamesPlayed ?? 0,
        b: stats?.goals ?? 0,
        a: stats?.assists ?? 0,
        pts: stats?.points ?? 0
    };
}

function metaFor(player) {
    if (player.category === 'T') return 'Équipe NHL';
    const stats = getPlayerCurrentStats(player.name);
    const abbrev = stats?.teamAbbrev && stats.teamAbbrev !== 'N/A' ? stats.teamAbbrev : '';
    return [getCategoryLabel(player.category), abbrev].filter(Boolean).join(' · ');
}

// ============================================================
// TAB SWITCHING
// ============================================================
let currentTradeTab = 'propose';

function switchTradeTab(tab, { load = true } = {}) {
    currentTradeTab = tab;

    document.querySelectorAll('.trade-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    document.getElementById('proposeTradeSection').classList.toggle('active', tab === 'propose');
    document.getElementById('receivedTradeSection').classList.toggle('active', tab === 'received');
    document.getElementById('historyTradeSection').classList.toggle('active', tab === 'history');

    // Returning to the propose tab from a completed trade should restart the builder
    if (tab === 'propose') {
        const success = document.getElementById('tradeSuccessScreen');
        if (success && !success.classList.contains('hidden')) {
            resetTrade();
        }
    }

    if (load && tab === 'received') {
        loadReceivedTrades();
    }

    if (load && tab === 'history') {
        loadHistory();
    }
}

// ============================================================
// FOR-SALE LISTINGS — players a pool member has flagged as open to
// offers. Folded into the propose builder as a filter + inline badge
// rather than a standalone tab. Same single-letter codes trade.js's own
// getCategory() uses internally.
// ============================================================
async function loadForSaleListings() {
    forSaleListings = [];
    const activePool = FZPool.get();
    if (!activePool) return;
    try {
        const res = await fetch(`${BASE_URL}/trade-listings/${encodeURIComponent(activePool)}`, { cache: 'no-store' });
        forSaleListings = res.ok ? await res.json() : [];
    } catch (err) {
        console.warn('Could not load for-sale listings:', err);
        forSaleListings = [];
    }
    renderForSaleToggle();
    renderPartnerRoster();
}

function partnerForSaleNames() {
    if (!selectedPartnerTeam) return new Set();
    return new Set(
        forSaleListings.filter(l => l.teamName === selectedPartnerTeam).map(l => l.playerName)
    );
}

function renderForSaleToggle() {
    const toggle = document.getElementById('forSaleToggle');
    const countEl = document.getElementById('forSaleCount');
    if (!toggle || !countEl) return;
    const names = partnerForSaleNames();
    countEl.textContent = names.size;
    toggle.classList.toggle('hidden', names.size === 0);
    toggle.classList.toggle('is-active', forSaleFilterActive);
    if (names.size === 0) forSaleFilterActive = false;
}

function toggleForSaleFilter() {
    forSaleFilterActive = !forSaleFilterActive;
    renderForSaleToggle();
    renderPartnerRoster();
}

// ============================================================
// NOTIFICATION SYSTEM
// ============================================================
function showNotification(message, type = 'info') {
    const existing = document.querySelector('.trade-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = `trade-notification trade-notification-${type}`;
    notification.setAttribute('role', type === 'error' ? 'alert' : 'status');
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${typeof getIcon === 'function' ? (type === 'success' ? getIcon('check',18) : type === 'error' ? getIcon('x',18) : getIcon('warning',18)) : ''}</span>
            <span class="notification-message">${message}</span>
        </div>
    `;

    document.body.appendChild(notification);
    setTimeout(() => notification.classList.add('show'), 10);
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

function showLoading(button, text = 'Chargement...') {
    button.disabled = true;
    button.dataset.originalText = button.innerHTML;
    button.innerHTML = `<span class="loading-spinner"></span> ${text}`;
}

function hideLoading(button) {
    button.disabled = false;
    button.innerHTML = button.dataset.originalText || button.innerHTML;
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    currentUsername = localStorage.getItem('username');

    if (!currentUsername) {
        showNotification('⛔ Vous devez être connecté pour accéder à cette page !', 'error');
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
        return;
    }

    const [statsRes] = await Promise.allSettled([
        fetch(`${BASE_URL}/current-stats`, { cache: 'no-store' }).then(r => r.json())
    ]);
    if (statsRes.status === 'fulfilled') currentStats = statsRes.value;

    // FZPool a déjà lu /draft : inutile de le redemander.
    await FZPool.ready();
    draftData = FZPool.all();
    applyActivePool();

    // Une notification conservée peut viser une proposition déjà traitée.
    // Ouvrir et cibler la carte dans l'onglet qui la contient maintenant.
    const cible = new URLSearchParams(window.location.search).get('trade');
    if (cible) {
        switchTradeTab('received', { load: false });
        const recue = await loadReceivedTrades(cible);
        if (recue === false) {
            switchTradeTab('history', { load: false });
            const archivee = await loadHistory(cible);
            if (archivee === false) {
                const message = document.createElement('p');
                message.className = 'history-empty';
                message.setAttribute('role', 'status');
                message.textContent = 'Cet échange n’est plus disponible. Les autres échanges de ce pool restent consultables ci-dessous.';
                document.getElementById('historyTradesContent')?.prepend(message);
            }
        }
    } else {
        await loadReceivedTrades();
    }

    // Changer de pool depuis le rail recompose la page sans rechargement.
    FZPool.on(() => {
        applyActivePool();
        loadReceivedTrades();
        if (currentTradeTab === 'history') loadHistory();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && teamSwitcherOpen) closeTeamSwitcher();
    });
});

// Le rail n'a pas besoin de recharger : l'assistant se reconstruit ici.
window.FZ_POOL_EN_PLACE = true;

/**
 * Amène le générateur d'échange sur le pool actif, avec un partenaire déjà
 * choisi par défaut — il n'y a plus d'étape « choisir un pool » ni
 * « choisir une équipe » séparée : les deux effectifs sont visibles tout
 * de suite et l'équipe partenaire se change depuis le sélecteur du bandeau.
 */
function applyActivePool() {
    const nom = FZPool.get();
    const pool = FZPool.mine().find(p => p.name === nom);
    const builder = document.getElementById('tmBuilder');
    const emptyMsg = document.getElementById('proposeEmptyMsg');

    selectedPool = null;
    selectedPoolData = null;
    myTeamName = null;
    myTeamData = null;
    selectedPartnerTeam = null;
    partnerTeamData = null;
    pairs = [];
    draftGive = null;
    draftGet = null;
    forSaleListings = [];
    forSaleFilterActive = false;
    mySearchTerm = '';
    partnerSearchTerm = '';
    myPositionFilter = 'all';
    partnerPositionFilter = 'all';

    document.getElementById('tradeSuccessScreen').classList.add('hidden');

    const showEmpty = (msg) => {
        builder.classList.add('hidden');
        emptyMsg.style.display = '';
        emptyMsg.textContent = msg;
    };

    if (!pool) {
        showEmpty('Aucun pool actif. Créez un pool ou rejoignez-en un pour échanger.');
        return;
    }

    if (pool.data.allowTrades === false) {
        showEmpty(`Les échanges sont désactivés dans « ${pool.name} ».`);
        return;
    }

    if (FZPool.draftState(pool.data).etat !== 'termine') {
        showEmpty(`Le repêchage de « ${pool.name} » n'est pas terminé. Les échanges ouvriront ensuite.`);
        return;
    }

    selectedPool = pool.name;
    selectedPoolData = pool.data || draftData[pool.name];
    myTeamName = pool.teamName;
    myTeamData = selectedPoolData.teams[myTeamName];

    const partners = availablePartnerTeams();
    if (partners.length === 0) {
        showEmpty('Aucune autre équipe dans ce pool.');
        return;
    }

    builder.classList.remove('hidden');
    emptyMsg.style.display = 'none';

    document.getElementById('myAvatar').textContent = initialsFor(myTeamData, myTeamName);
    document.getElementById('myTeamName').textContent = myTeamName;

    selectPartnerTeam(partners[0].name);
    loadForSaleListings();
    applyPrefillIfPresent();
}

function availablePartnerTeams() {
    if (!selectedPoolData) return [];
    return Object.entries(selectedPoolData.teams || {})
        .filter(([name, data]) => name !== myTeamName && buildRosterPlayers(data).length > 0)
        .map(([name, data]) => ({ name, data }));
}

function initialsFor(teamData, teamName) {
    const source = teamData?.members?.[0] || teamName || '';
    const parts = String(source).trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return String(source).slice(0, 2).toUpperCase() || '--';
}

/**
 * Arriving from a for-sale link or old bookmark:
 * trade.html?withTeam=<team>&wantPlayer=<player>&category=<F|D|G|R|T>
 * switches to that partner and pre-selects their player as the target.
 */
function applyPrefillIfPresent() {
    const params = new URLSearchParams(window.location.search);
    const withTeam = params.get('withTeam');
    const wantPlayer = params.get('wantPlayer');
    const category = params.get('category');
    if (!withTeam || !wantPlayer || !category || !selectedPoolData) return;

    const targetTeamData = selectedPoolData.teams[withTeam];
    if (!targetTeamData) return;

    const partnerPlayers = [
        ...(targetTeamData.offensive || []),
        ...(targetTeamData.defensive || []),
        ...(targetTeamData.goalie || []),
        ...(targetTeamData.rookie || []),
        ...(targetTeamData.teams || [])
    ];
    if (!partnerPlayers.includes(wantPlayer)) return;

    selectPartnerTeam(withTeam);
    handlePartnerPick(wantPlayer, category, null);

    history.replaceState(null, '', 'trade.html');
}

// ============================================================
// DATA LOADING
// ============================================================
async function loadDraftData() {
    await FZPool.refresh();
    draftData = FZPool.all();
    if (selectedPoolData) {
        myTeamData = selectedPoolData.teams[myTeamName];
        partnerTeamData = selectedPoolData.teams[selectedPartnerTeam];
    }
}

// ============================================================
// TEAM SWITCHER (dropdown)
// ============================================================
function toggleTeamSwitcher() {
    teamSwitcherOpen ? closeTeamSwitcher() : openTeamSwitcher();
}

function openTeamSwitcher() {
    if (!selectedPoolData) return;
    teamSwitcherOpen = true;
    renderTeamSwitcherList();
    document.getElementById('teamSwitchDropdown').classList.remove('hidden');
    document.getElementById('teamSwitchCaret').textContent = '▲';
}

function closeTeamSwitcher() {
    teamSwitcherOpen = false;
    const dd = document.getElementById('teamSwitchDropdown');
    if (dd) dd.classList.add('hidden');
    const caret = document.getElementById('teamSwitchCaret');
    if (caret) caret.textContent = '▾';
}

function renderTeamSwitcherList() {
    const list = document.getElementById('teamSwitchList');
    if (!list) return;

    const rows = [
        { name: myTeamName, data: myTeamData, self: true },
        ...availablePartnerTeams()
    ];

    list.innerHTML = rows.map(t => {
        const isCurrent = t.name === selectedPartnerTeam;
        const meta = t.self ? 'Votre équipe' : (t.data?.members?.[0] || 'Sans manager');
        const classes = ['tm-dropdown-row'];
        if (t.self) classes.push('is-self');
        if (isCurrent) classes.push('is-current');
        return `
            <div class="${classes.join(' ')}" data-team="${t.name.replace(/"/g, '&quot;')}">
                <div class="tm-dropdown-row-text">
                    <div class="tm-dropdown-name">${t.name}</div>
                    <div class="tm-dropdown-meta">${meta}</div>
                </div>
                <div class="tm-dropdown-mark">${isCurrent ? '✓' : ''}</div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.tm-dropdown-row:not(.is-self)').forEach(row => {
        row.addEventListener('click', () => {
            selectPartnerTeam(row.dataset.team);
            closeTeamSwitcher();
        });
    });
}

/** Switches the trade partner. Clears any in-progress pairs — they were
 *  built against the previous partner's roster. */
function selectPartnerTeam(teamName) {
    if (!selectedPoolData || !selectedPoolData.teams[teamName]) return;

    selectedPartnerTeam = teamName;
    partnerTeamData = selectedPoolData.teams[teamName];
    pairs = [];
    draftGive = null;
    draftGet = null;
    partnerSearchTerm = '';
    partnerPositionFilter = 'all';
    forSaleFilterActive = false;

    document.getElementById('partnerAvatar').textContent = initialsFor(partnerTeamData, teamName);
    document.getElementById('partnerTeamName').textContent = teamName;
    document.getElementById('partnerTeamTriggerName').textContent = teamName;

    const partnerInput = document.getElementById('partnerSearchInput');
    if (partnerInput) partnerInput.value = '';
    document.querySelectorAll('#partnerPosTabs .pos-tab').forEach(t => t.classList.toggle('active', t.dataset.pos === 'all'));

    renderForSaleToggle();
    renderMyRoster();
    renderPartnerRoster();
    renderBasket();
}

// ============================================================
// ROSTER BUILDING
// ============================================================
function buildRosterPlayers(teamData) {
    if (!teamData) return [];
    const norm = (list, category, type) => (list || []).map(p => {
        if (typeof p === 'string') return { name: p, category, type };
        const name = p.skaterFullName || p.goalieFullName || p.teamFullName || p;
        return { ...p, name, category, type };
    });
    return [
        ...norm(teamData.offensive, 'F', 'offensive'),
        ...norm(teamData.defensive, 'D', 'defensive'),
        ...norm(teamData.goalie, 'G', 'goalie'),
        ...norm(teamData.rookie, 'R', 'rookie'),
        ...norm(teamData.teams, 'T', 'team')
    ];
}

function isGiveSelected(name) {
    return (draftGive && draftGive.name === name) || pairs.some(p => p.give.name === name);
}
function isGetSelected(name) {
    return (draftGet && draftGet.name === name) || pairs.some(p => p.get.name === name);
}
function pairIndexByGive(name) { return pairs.findIndex(p => p.give.name === name); }
function pairIndexByGet(name) { return pairs.findIndex(p => p.get.name === name); }

function renderPlayerRowHTML(player, selected, locked, forSale) {
    const cols = statColsFor(player);
    return `
        <div class="player-card-roster ${selected ? 'selected' : ''} ${locked ? 'locked' : ''}"
             data-player-name="${player.name.replace(/"/g, '&quot;')}"
             data-player-category="${player.category}">
            <div class="pcr-check">${selected ? '✓' : ''}</div>
            <div class="pcr-info">
                <div class="pcr-name">${player.name}${forSale ? '<span class="pcr-forsale-badge">À vendre</span>' : ''}</div>
                <div class="pcr-team">${metaFor(player)}${locked ? ' · position non appariée' : ''}</div>
            </div>
            <div class="pcr-stats">
                <span class="pcr-stat">${cols.pj}</span>
                <span class="pcr-stat">${cols.b}</span>
                <span class="pcr-stat">${cols.a}</span>
                <span class="pcr-stat pcr-pts">${cols.pts}</span>
            </div>
        </div>
    `;
}

function renderMyRoster() {
    const container = document.getElementById('myRoster');
    if (!container || !myTeamData) return;

    let players = buildRosterPlayers(myTeamData);
    if (myPositionFilter !== 'all') players = players.filter(p => p.category === myPositionFilter);
    if (mySearchTerm) {
        const q = mySearchTerm.toLowerCase();
        players = players.filter(p => p.name.toLowerCase().includes(q));
    }

    if (players.length === 0) {
        container.innerHTML = '<p class="empty-msg">Aucun joueur dans cette catégorie</p>';
        return;
    }

    container.innerHTML = players.map(p => {
        const selected = isGiveSelected(p.name);
        const locked = !selected && draftGet != null && draftGet.category !== p.category;
        return renderPlayerRowHTML(p, selected, locked, false);
    }).join('');

    container.querySelectorAll('.player-card-roster:not(.locked)').forEach(card => {
        card.addEventListener('click', () => {
            handleMyPick(card.dataset.playerName, card.dataset.playerCategory);
        });
    });

    updateTabCounts();
}

function renderPartnerRoster() {
    const container = document.getElementById('partnerRoster');
    if (!container || !partnerTeamData) return;

    let players = buildRosterPlayers(partnerTeamData);
    if (partnerPositionFilter !== 'all') players = players.filter(p => p.category === partnerPositionFilter);
    if (partnerSearchTerm) {
        const q = partnerSearchTerm.toLowerCase();
        players = players.filter(p => p.name.toLowerCase().includes(q));
    }
    const forSaleNames = partnerForSaleNames();
    if (forSaleFilterActive) players = players.filter(p => forSaleNames.has(p.name));

    if (players.length === 0) {
        container.innerHTML = '<p class="empty-msg">Aucun joueur dans cette catégorie</p>';
        return;
    }

    container.innerHTML = players.map(p => {
        const selected = isGetSelected(p.name);
        const locked = !selected && draftGive != null && draftGive.category !== p.category;
        return renderPlayerRowHTML(p, selected, locked, forSaleNames.has(p.name));
    }).join('');

    container.querySelectorAll('.player-card-roster:not(.locked)').forEach(card => {
        card.addEventListener('click', () => {
            handlePartnerPick(card.dataset.playerName, card.dataset.playerCategory);
        });
    });

    updateTabCounts();
}

function filterSearch(side, value) {
    if (side === 'my') { mySearchTerm = value; renderMyRoster(); }
    else { partnerSearchTerm = value; renderPartnerRoster(); }
}

function filterPosition(side, position) {
    if (side === 'my') {
        myPositionFilter = position;
        document.querySelectorAll('#myPosTabs .pos-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.pos === position));
        renderMyRoster();
    } else {
        partnerPositionFilter = position;
        document.querySelectorAll('#partnerPosTabs .pos-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.pos === position));
        renderPartnerRoster();
    }
}

// ============================================================
// PICKING — builds 1-for-1 pairs; a fully-matched pick on both sides
// auto-commits into the basket.
// ============================================================
function handleMyPick(name, category, playerData) {
    const existingPair = pairIndexByGive(name);
    if (existingPair !== -1) {
        pairs.splice(existingPair, 1);
    } else if (draftGive && draftGive.name === name) {
        draftGive = null;
    } else {
        if (draftGet && draftGet.category !== category) {
            showNotification(`⚠️ Position invalide ! Vous devez échanger ${getCategoryLabel(draftGet.category)} ↔ ${getCategoryLabel(draftGet.category)}`, 'error');
            return;
        }
        draftGive = { name, category, data: playerData, type: getCategoryType(category) };
        if (draftGet) {
            pairs.push({ give: draftGive, get: draftGet });
            draftGive = null;
            draftGet = null;
        }
    }
    renderMyRoster();
    renderPartnerRoster();
    renderBasket();
}

function handlePartnerPick(name, category, playerData) {
    const existingPair = pairIndexByGet(name);
    if (existingPair !== -1) {
        pairs.splice(existingPair, 1);
    } else if (draftGet && draftGet.name === name) {
        draftGet = null;
    } else {
        if (draftGive && draftGive.category !== category) {
            showNotification(`⚠️ Position invalide ! Vous devez échanger ${getCategoryLabel(draftGive.category)} ↔ ${getCategoryLabel(draftGive.category)}`, 'error');
            return;
        }
        draftGet = { name, category, data: playerData, type: getCategoryType(category) };
        if (draftGive) {
            pairs.push({ give: draftGive, get: draftGet });
            draftGive = null;
            draftGet = null;
        }
    }
    renderMyRoster();
    renderPartnerRoster();
    renderBasket();
}

function removePair(index) {
    pairs.splice(index, 1);
    renderMyRoster();
    renderPartnerRoster();
    renderBasket();
}

// ============================================================
// BASKET / SUMMARY
// ============================================================
function pairValue(player) {
    if (!player || player.category === 'T') return null;
    const stats = getPlayerCurrentStats(player.name);
    if (player.category === 'G') return stats?.wins ?? 0;
    return stats?.points ?? 0;
}

function renderBasket() {
    const emptyState = document.getElementById('tradeEmptyState');
    const basket = document.getElementById('tradeBasket');
    const proposeBtn = document.getElementById('btnProposeTrade');

    if (pairs.length === 0 && !draftGive && !draftGet) {
        emptyState.classList.remove('hidden');
        basket.classList.add('hidden');
        proposeBtn.disabled = true;
        tmSyncMobile();
        return;
    }

    emptyState.classList.add('hidden');
    basket.classList.remove('hidden');

    document.getElementById('tbGiveCount').textContent = pairs.length + (draftGive ? 1 : 0);
    document.getElementById('tbGetCount').textContent = pairs.length + (draftGet ? 1 : 0);

    const rows = pairs.map((pair, idx) => pairRowHTML(pair.give, pair.get, idx)).join('');
    const draftRow = (draftGive || draftGet) ? draftRowHTML() : '';
    document.getElementById('tbPairs').innerHTML = rows + draftRow;

    document.querySelectorAll('.tb-card-remove').forEach(btn => {
        btn.addEventListener('click', () => removePair(parseInt(btn.dataset.pairIdx)));
    });

    const validCount = pairs.length;
    const validRow = document.getElementById('tbValidRow');
    const validText = document.getElementById('tbValidText');
    const hasIncomplete = !!(draftGive || draftGet);
    validRow.classList.toggle('is-invalid', hasIncomplete && validCount === 0);
    validText.textContent = hasIncomplete
        ? 'Sélectionnez le joueur en retour pour compléter la paire'
        : `${validCount} pour ${validCount} · position${validCount > 1 ? 's' : ''} valide${validCount > 1 ? 's' : ''}`;

    let totalGive = 0, totalGet = 0, anyNumeric = false;
    pairs.forEach(p => {
        const gv = pairValue(p.give), gt = pairValue(p.get);
        if (gv != null) { totalGive += gv; anyNumeric = true; }
        if (gt != null) { totalGet += gt; anyNumeric = true; }
    });
    document.getElementById('tbPointsGive').textContent = anyNumeric ? totalGive : '—';
    document.getElementById('tbPointsGet').textContent = anyNumeric ? totalGet : '—';
    const gapEl = document.getElementById('tbGap');
    const gapLine = gapEl.closest('.tb-eq-line');
    if (anyNumeric) {
        const gap = totalGet - totalGive;
        gapEl.textContent = (gap >= 0 ? '+' : '') + gap;
        gapLine.classList.toggle('is-positive', gap >= 0);
    } else {
        gapEl.textContent = '—';
        gapLine.classList.remove('is-positive');
    }

    proposeBtn.disabled = validCount === 0;

    tmSyncMobile();
}

function pairRowHTML(give, get, idx) {
    return `
        <div class="tb-pair-row">
            <div class="tb-card">
                <div class="tb-card-text">
                    <div class="tb-card-name" title="${give.name.replace(/"/g, '&quot;')}">${lastName(give.name)}</div>
                    <div class="tb-card-meta">${metaFor(give)}${pairValue(give) != null ? ' · ' + pairValue(give) + ' pts' : ''}</div>
                </div>
            </div>
            <div class="tb-pair-mid">
                <div class="tb-pair-swap">⇄</div>
                <div class="tb-pair-cat">${getCategoryLabel(give.category)}</div>
            </div>
            <div class="tb-card">
                <div class="tb-card-text">
                    <div class="tb-card-name" title="${get.name.replace(/"/g, '&quot;')}">${lastName(get.name)}</div>
                    <div class="tb-card-meta">${metaFor(get)}${pairValue(get) != null ? ' · ' + pairValue(get) + ' pts' : ''}</div>
                </div>
                <button type="button" class="tb-card-remove" data-pair-idx="${idx}" title="Retirer">×</button>
            </div>
        </div>
    `;
}

function draftRowHTML() {
    const giveCell = draftGive
        ? `<div class="tb-card"><div class="tb-card-text"><div class="tb-card-name" title="${draftGive.name.replace(/"/g, '&quot;')}">${lastName(draftGive.name)}</div><div class="tb-card-meta">${metaFor(draftGive)}</div></div></div>`
        : `<div class="tb-card is-ghost"><div class="tb-card-text"><div class="tb-card-name">Ajouter un joueur</div><div class="tb-card-meta">Depuis la liste</div></div></div>`;
    const getCell = draftGet
        ? `<div class="tb-card"><div class="tb-card-text"><div class="tb-card-name" title="${draftGet.name.replace(/"/g, '&quot;')}">${lastName(draftGet.name)}</div><div class="tb-card-meta">${metaFor(draftGet)}</div></div></div>`
        : `<div class="tb-card is-ghost"><div class="tb-card-text"><div class="tb-card-name">En attente…</div><div class="tb-card-meta">Même position</div></div></div>`;
    return `
        <div class="tb-pair-row">
            ${giveCell}
            <div class="tb-pair-mid">
                <div class="tb-pair-swap is-ghost">⇄</div>
                <div class="tb-pair-cat">${getCategoryLabel((draftGive || draftGet).category)}</div>
            </div>
            ${getCell}
        </div>
    `;
}

function updateTabCounts() {
    const myCount = document.getElementById('tmTabMyCount');
    const partnerCount = document.getElementById('tmTabPartnerCount');
    if (myCount) myCount.textContent = pairs.length + (draftGive ? 1 : 0);
    if (partnerCount) partnerCount.textContent = pairs.length + (draftGet ? 1 : 0);
}

// ============================================================
// STYLED CONFIRM (Aesthetic-Usability — replaces native confirm)
// ============================================================
function showTradeConfirm(detailHtml) {
    return new Promise(resolve => {
        const overlay = document.getElementById('tradeConfirmOverlay');
        const body = document.getElementById('tradeConfirmBody');
        const okBtn = document.getElementById('tradeConfirmOk');
        const cancelBtn = document.getElementById('tradeConfirmCancel');

        if (!overlay || !body || !okBtn || !cancelBtn) {
            resolve(window.confirm('Proposer cet échange ?'));
            return;
        }

        body.innerHTML = detailHtml;
        overlay.classList.add('show');

        const cleanup = (result) => {
            overlay.classList.remove('show');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
            resolve(result);
        };
        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        const onBackdrop = (e) => { if (e.target === overlay) cleanup(false); };
        const onKey = (e) => {
            if (e.key === 'Escape') cleanup(false);
            else if (e.key === 'Enter') cleanup(true);
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        overlay.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
    });
}

// ============================================================
// PROPOSE TRADE — one /trade/propose call per pair (the backend only
// accepts exactly one offering + one receiving player per proposal), sent
// in sequence so a partial failure doesn't leave the rest unsent.
// ============================================================
async function proposeTrade() {
    if (pairs.length === 0) {
        showNotification('Veuillez compléter au moins une paire 1 pour 1', 'error');
        return;
    }

    const rowsHtml = pairs.map(p => `
        <div class="tc-trade-row">
            <div class="tc-side">
                <span class="tc-side-label">${myTeamName} offre</span>
                <strong>${p.give.name}</strong>
            </div>
            <div class="tc-arrow">⇄</div>
            <div class="tc-side">
                <span class="tc-side-label">${selectedPartnerTeam} offre</span>
                <strong>${p.get.name}</strong>
            </div>
        </div>
    `).join('');
    const confirmed = await showTradeConfirm(rowsHtml);
    if (!confirmed) return;

    const proposeBtn = document.getElementById('btnProposeTrade');
    showLoading(proposeBtn, 'Envoi...');

    let succeeded = 0;
    const failures = [];

    for (const pair of pairs) {
        const proposal = {
            draftName: selectedPool,
            fromTeam: myTeamName,
            toTeam: selectedPartnerTeam,
            offering: [{ name: pair.give.name, type: pair.give.type || getCategoryType(pair.give.category) }],
            receiving: [{ name: pair.get.name, type: pair.get.type || getCategoryType(pair.get.category) }],
            status: 'pending',
            date: new Date().toISOString()
        };

        try {
            const res = await fetch(`${BASE_URL}/trade/propose`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(proposal)
            });
            const data = await res.json();
            if (res.ok) succeeded++;
            else failures.push(`${pair.give.name} ⇄ ${pair.get.name} : ${data.message || 'échec'}`);
        } catch (err) {
            console.error('Error proposing trade:', err);
            failures.push(`${pair.give.name} ⇄ ${pair.get.name} : erreur réseau`);
        }
    }

    hideLoading(proposeBtn);

    if (succeeded > 0) {
        loadReceivedTrades();
        updateReceivedBadge();
        showTradeSuccess(succeeded, failures);
    } else {
        showNotification(`❌ ${failures[0] || 'Erreur lors de l\'envoi de la proposition'}`, 'error');
    }
}

// ============================================================
// TRADE SUCCESS SCREEN (Peak-End Rule)
// ============================================================
function showTradeSuccess(succeeded, failures) {
    const detail = document.getElementById('tradeSuccessDetail');
    if (detail) {
        const plural = succeeded > 1 ? 's' : '';
        let html = `<strong>${succeeded}</strong> proposition${plural} envoyée${plural} à <strong>${selectedPartnerTeam}</strong>.<br>En attente de la réponse de l'autre équipe.`;
        if (failures.length) {
            html += `<br><br><span style="color:var(--fzt-accent)">${failures.length} paire${failures.length > 1 ? 's' : ''} n'${failures.length > 1 ? 'ont' : 'a'} pas pu être envoyée${failures.length > 1 ? 's' : ''} : ${failures.join('; ')}</span>`;
        }
        detail.innerHTML = html;
    }
    document.getElementById('tmBuilder').classList.add('hidden');
    document.getElementById('tradeSuccessScreen').classList.remove('hidden');

    pairs = [];
    draftGive = null;
    draftGet = null;
}

// ============================================================
// RESET TRADE
// ============================================================
function resetTrade() {
    pairs = [];
    draftGive = null;
    draftGet = null;

    document.getElementById('tradeSuccessScreen').classList.add('hidden');
    document.getElementById('tmBuilder').classList.remove('hidden');

    renderMyRoster();
    renderPartnerRoster();
    renderBasket();
}

// ============================================================
// RECEIVED TRADES
// ============================================================
function focusTradeTarget(container, idCible) {
    if (!idCible) return false;
    const carte = Array.from(container.querySelectorAll('[data-trade-id]'))
        .find(element => element.dataset.tradeId === String(idCible));
    if (!carte) return false;
    carte.tabIndex = -1;
    carte.focus({ preventScroll: true });
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    carte.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    return true;
}

async function loadReceivedTrades(idCible) {
    const container = document.getElementById('receivedTradesContent');
    if (!container) return;

    try {
        const res = await fetch(`${BASE_URL}/trades/pending/${currentUsername}`, { cache: 'no-store' });

        if (!res.ok) {
            console.error('Failed to fetch received trades:', res.status);
            container.innerHTML = '<p class="empty-msg">Erreur lors du chargement des échanges reçus</p>';
            return;
        }

        const tous = await res.json();
        const poolActif = FZPool.get();
        const trades = Array.isArray(tous)
            ? (poolActif ? tous.filter(t => t.draftName === poolActif) : tous)
            : [];

        updateReceivedBadge(trades.length);

        if (trades.length === 0) {
            container.innerHTML = `<p class="received-empty">Aucune proposition d'échange reçue${poolActif ? ` dans « ${poolActif} »` : ''}</p>`;
            return false;
        }

        container.innerHTML = trades.map(trade => {
            const date = new Date(trade.date);
            const relatif = relativeDate(date);

            const offering = trade.offering[0];
            const receiving = trade.receiving[0];
            const offeringCategory = getCategory(offering.type);
            const receivingCategory = getCategory(receiving.type);

            const estCible = idCible && String(trade.id) === String(idCible);
            const initials = initialsFor(null, trade.fromTeam);

            return `
                <div class="received-trade-card${estCible ? ' is-target' : ''}" data-trade-id="${trade.id}">
                    <div class="trade-card-header">
                        <div class="trade-card-avatar">${initials}</div>
                        <div class="trade-card-info">
                            <div class="trade-card-teams">${trade.fromTeam}</div>
                            <div class="trade-card-date">reçue ${relatif}</div>
                        </div>
                        <div class="trade-card-status">En attente</div>
                    </div>

                    <div class="trade-card-players">
                        <div class="trade-player">
                            <div class="trade-player-label">Vous recevriez</div>
                            <div class="trade-player-box">
                                <div class="trade-player-name">${offering.name}</div>
                                <span class="trade-player-position">${getCategoryLabel(offeringCategory)}</span>
                            </div>
                        </div>

                        <div class="trade-arrow-icon">⇄</div>

                        <div class="trade-player">
                            <div class="trade-player-label">Vous donneriez</div>
                            <div class="trade-player-box">
                                <div class="trade-player-name">${receiving.name}</div>
                                <span class="trade-player-position">${getCategoryLabel(receivingCategory)}</span>
                            </div>
                        </div>
                    </div>

                    <div class="trade-card-actions">
                        <button class="btn-accept-trade" onclick="acceptTradeProposal('${trade.id}')">Accepter</button>
                        <button class="btn-decline-trade" onclick="declineTradeProposal('${trade.id}')">Refuser</button>
                        <button class="btn-counter-trade" onclick="startCounterOffer('${trade.fromTeam.replace(/'/g, "\\'")}')">Contre-offre</button>
                    </div>
                </div>
            `;
        }).join('');

        return focusTradeTarget(container, idCible);

    } catch (err) {
        console.error('Error loading received trades:', err);
        container.innerHTML = '<p class="empty-msg">Erreur lors du chargement des échanges reçus</p>';
    }
}

function relativeDate(date) {
    const diffMs = Date.now() - date.getTime();
    const hours = diffMs / 3600000;
    if (hours < 1) return "à l'instant";
    if (hours < 24) return `il y a ${Math.round(hours)} heure${Math.round(hours) > 1 ? 's' : ''}`;
    const days = Math.round(hours / 24);
    if (days < 30) return `il y a ${days} jour${days > 1 ? 's' : ''}`;
    return date.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Jumps to the propose tab with that team pre-selected as partner —
 *  a fresh proposal to the same team, not a pre-filled negotiation. */
function startCounterOffer(teamName) {
    switchTradeTab('propose');
    if (selectedPoolData && selectedPoolData.teams[teamName]) {
        selectPartnerTeam(teamName);
    }
}

// ============================================================
// HISTORY — completed, declined and cancelled trades for the active pool.
// ============================================================
async function loadHistory(idCible) {
    const container = document.getElementById('historyTradesContent');
    if (!container) return;

    try {
        const res = await fetch(`${BASE_URL}/trades/completed/${currentUsername}`, { cache: 'no-store' });

        if (!res.ok) {
            console.error('Failed to fetch history:', res.status);
            container.innerHTML = '<p class="history-empty">Erreur lors du chargement</p>';
            return;
        }

        const tous = await res.json();
        const poolActif = FZPool.get();
        const trades = Array.isArray(tous)
            ? (poolActif ? tous.filter(t => t.draftName === poolActif) : tous)
            : [];

        if (trades.length === 0) {
            container.innerHTML = '<p class="history-empty">Aucun échange traité pour le moment.</p>';
            return false;
        }

        container.innerHTML = trades.map(trade => {
            const cancelled = trade.status === 'cancelled';
            const declined = trade.status === 'declined' || cancelled;
            const date = new Date(trade.completedDate || trade.date);
            const dateStr = date.toLocaleDateString('fr-CA', { year: 'numeric', month: 'short', day: 'numeric' });
            const offering = trade.offering?.[0];
            const receiving = trade.receiving?.[0];
            const acquiresLbl = declined ? 'Aurait acquis :' : 'Acquiert :';
            const estCible = idCible && String(trade.id) === String(idCible);

            return `
                <div class="history-card${declined ? ' is-declined' : ''}${estCible ? ' is-target' : ''}" data-trade-id="${trade.id}">
                    <div class="history-card-head">
                        <span class="history-card-date">${dateStr}</span>
                        <span class="history-card-status">${cancelled ? 'Annulé' : declined ? 'Refusé' : 'Complété'}</span>
                    </div>
                    <div class="history-card-sides">
                        <div>
                            <div class="history-side-team">
                                <span class="history-side-dot"></span>
                                <span class="history-side-name">${trade.toTeam}</span>
                                <span class="history-side-acquires-lbl">${acquiresLbl}</span>
                            </div>
                            <div class="history-side-player">
                                <span class="history-player-dot"></span>
                                <span class="history-player-name">${offering?.name || '—'} <span>${getCategoryLabel(getCategory(offering?.type))}</span></span>
                            </div>
                        </div>
                        <div class="history-divider"><span class="history-divider-icon">⇄</span></div>
                        <div>
                            <div class="history-side-team">
                                <span class="history-side-dot"></span>
                                <span class="history-side-name">${trade.fromTeam}</span>
                                <span class="history-side-acquires-lbl">${acquiresLbl}</span>
                            </div>
                            <div class="history-side-player">
                                <span class="history-player-dot"></span>
                                <span class="history-player-name">${receiving?.name || '—'} <span>${getCategoryLabel(getCategory(receiving?.type))}</span></span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        return focusTradeTarget(container, idCible);

    } catch (err) {
        console.error('Error loading history:', err);
        container.innerHTML = '<p class="history-empty">Erreur lors du chargement</p>';
    }
}

// La pastille de l'onglet compte les échanges du pool actif, comme la
// liste qu'elle annonce.
function updateReceivedBadge(count) {
    const badge = document.getElementById('receivedTradeBadge');
    if (!badge) return;

    const afficher = n => {
        badge.textContent = n;
        badge.style.display = n > 0 ? 'inline-grid' : 'none';
    };

    if (count !== undefined) { afficher(count); return; }

    fetch(`${BASE_URL}/trades/pending/${currentUsername}`, { cache: 'no-store' })
        .then(res => res.json())
        .then(trades => {
            const poolActif = FZPool.get();
            const liste = Array.isArray(trades)
                ? (poolActif ? trades.filter(t => t.draftName === poolActif) : trades)
                : [];
            afficher(liste.length);
        })
        .catch(err => console.error('Error fetching received badge count:', err));
}

function getCategory(type) {
    const categoryMap = { 'offensive': 'F', 'defensive': 'D', 'goalie': 'G', 'rookie': 'R', 'team': 'T' };
    return categoryMap[type] || 'F';
}

async function acceptTradeProposal(tradeId) {
    if (!confirm('Accepter cet échange? Les joueurs seront échangés immédiatement.')) return;

    const btn = event.target;
    showLoading(btn, 'Acceptation...');

    try {
        const res = await fetch(`${BASE_URL}/trade/accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tradeId })
        });

        const data = await res.json();

        if (res.ok) {
            showNotification('✅ Échange accepté avec succès! Les joueurs ont été échangés.', 'success');
            setTimeout(() => {
                loadReceivedTrades();
                loadDraftData();
                updateReceivedBadge();
            }, 1000);
        } else {
            showNotification(`❌ ${data.message}`, 'error');
            hideLoading(btn);
        }
    } catch (err) {
        console.error('Error accepting trade:', err);
        showNotification('❌ Erreur lors de l\'acceptation de l\'échange', 'error');
        hideLoading(btn);
    }
}

async function declineTradeProposal(tradeId) {
    if (!confirm('Refuser cet échange?')) return;

    const btn = event.target;
    showLoading(btn, 'Refus...');

    try {
        const res = await fetch(`${BASE_URL}/trade/decline`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tradeId })
        });

        if (res.ok) {
            showNotification('Échange refusé', 'info');
            setTimeout(() => {
                loadReceivedTrades();
                updateReceivedBadge();
            }, 500);
        } else {
            const data = await res.json();
            showNotification(`❌ ${data.message}`, 'error');
            hideLoading(btn);
        }
    } catch (err) {
        console.error('Error declining trade:', err);
        showNotification('❌ Erreur lors du refus de l\'échange', 'error');
        hideLoading(btn);
    }
}

// ============================================================
// UTILITIES
// ============================================================
function getCategoryLabel(category) {
    const labels = { 'F': 'ATT', 'D': 'DÉF', 'G': 'GAR', 'R': 'ROO', 'T': 'ÉQU' };
    return labels[category] || category;
}

function getCategoryType(category) {
    const types = { 'F': 'offensive', 'D': 'defensive', 'G': 'goalie', 'R': 'rookie', 'T': 'team' };
    return types[category] || 'offensive';
}

// ============================================================
// MOBILE — segmented Mes joueurs / Leurs joueurs tabs + bottom bar
// ------------------------------------------------------------
// Above 900px the CSS shows both roster columns and the basket at once;
// this only drives which single column is visible below that, and keeps
// the fixed summary bar in sync. No trade logic lives here.
// ============================================================
function tmSwitchRoster(cote) {
    const grille = document.getElementById('tradeGrid3col');
    if (grille) grille.dataset.cote = cote;
    document.querySelectorAll('.tm-tab').forEach(t => {
        const actif = t.dataset.cote === cote;
        t.classList.toggle('is-active', actif);
        t.setAttribute('aria-selected', String(actif));
    });
}

/** « Connor McDavid » → « C. McDavid ». The mobile bar is narrow. */
function tmAbrege(nom) {
    const mots = String(nom || '').trim().split(/\s+/);
    if (mots.length < 2) return nom || '';
    return mots[0].charAt(0) + '. ' + mots.slice(1).join(' ');
}

/** Last name only — the basket's pair cards are narrow (three columns
 *  inside a 400px center panel), same reasoning as tmAbrege above. */
function lastName(nom) {
    const mots = String(nom || '').trim().split(/\s+/);
    return mots[mots.length - 1] || nom || '';
}

function tmJoinNames(list) {
    if (!list.length) return '—';
    return list.map(tmAbrege).join(', ');
}

/** Reflects pairs + in-progress draft in the mobile bottom bar. */
function tmSyncMobile() {
    const giveNames = pairs.map(p => p.give.name).concat(draftGive ? [draftGive.name] : []);
    const getNames = pairs.map(p => p.get.name).concat(draftGet ? [draftGet.name] : []);

    let totalGive = 0, totalGet = 0, anyNumeric = false;
    pairs.forEach(p => {
        const gv = pairValue(p.give), gt = pairValue(p.get);
        if (gv != null) { totalGive += gv; anyNumeric = true; }
        if (gt != null) { totalGet += gt; anyNumeric = true; }
    });

    const giveEl = document.getElementById('tmValGive');
    const getEl = document.getElementById('tmValGet');
    if (giveEl) giveEl.textContent = giveNames.length ? `${tmJoinNames(giveNames)}${anyNumeric ? ' · ' + totalGive + ' pts' : ''}` : '—';
    if (getEl) getEl.textContent = getNames.length ? `${tmJoinNames(getNames)}${anyNumeric ? ' · ' + totalGet + ' pts' : ''}` : '—';

    const cta = document.getElementById('tmCta');
    const source = document.getElementById('btnProposeTrade');
    if (cta && source) {
        cta.disabled = source.disabled;
        cta.classList.toggle('is-ready', !source.disabled);
    }
}

/** Wraps proposeTrade(): avoids double-submit from the fixed bar. */
async function tmProposeTrade() {
    const cta = document.getElementById('tmCta');
    if (cta) cta.disabled = true;
    try {
        await proposeTrade();
    } finally {
        if (cta) {
            const source = document.getElementById('btnProposeTrade');
            cta.disabled = source ? source.disabled : true;
        }
    }
}
