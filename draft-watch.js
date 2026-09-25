/* Empty anchors tolerate loading failures and table redraws, like injuries.js. */
function watchBadgeHTML(name, team) {
    return `<span class="watch-slot" data-watch-name="${injEscape(name)}" data-watch-team="${injEscape(injTeamCode(team) || '')}"></span>`;
}
(function () {
    let list = null, promise = null;
    const key = name => String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    // The team only breaks ties between namesakes: a player traded since the
    // kit was published keeps his note.
    function find(name, team) {
        const matches = (list || []).filter(p => key(p.name) === key(name));
        return matches.find(p => p.team === injTeamCode(team)) || (matches.length === 1 ? matches[0] : null);
    }
    function load() {
        if (typeof FZDraftKit === 'undefined') return Promise.resolve(null);
        return promise || (promise = FZDraftKit.chargerWatchlist().then(rows => { list = rows; decorate(); return rows; })
            .catch(() => { promise = null; return null; }));
    }
    function decorate() {
        if (!list) return;
        document.querySelectorAll('.watch-slot:not([data-watch-done])').forEach(slot => {
            slot.dataset.watchDone = '1';
            const player = find(slot.dataset.watchName, slot.dataset.watchTeam);
            if (!player) return;
            slot.innerHTML = `<span class="draft-watch-badge" title="${injEscape(player.note || '')}" aria-label="À surveiller">${getIcon('eye', 14)}<span>À surveiller</span></span>`;
        });
    }
    /* Called by careerModal.js once the profile is rendered. */
    window.renderWatchBanner = function (name, team) {
        const banner = document.getElementById('careerWatchBanner');
        if (!banner) return;
        banner.dataset.player = String(name || '');
        const player = list && find(name, team);
        banner.hidden = !player?.note;
        banner.querySelector('p').textContent = player?.note || '';
        // The profile can open before the list arrives, or switch players meanwhile.
        if (!list) load().then(rows => { if (rows && banner.dataset.player === String(name || '')) window.renderWatchBanner(name, team); });
    };
    document.addEventListener('DOMContentLoaded', () => {
        let scheduled = 0;
        new MutationObserver(() => {
            if (!scheduled) scheduled = setTimeout(() => { scheduled = 0; decorate(); }, 16);
        }).observe(document.body, { childList: true, subtree: true });
        load();
    });
})();
