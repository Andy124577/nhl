/* Empty anchors tolerate loading failures and table redraws, like injuries.js. */
function watchBadgeHTML(name, team) {
    return `<span class="watch-slot" data-watch-name="${injEscape(name)}" data-watch-team="${injEscape(injTeamCode(team) || '')}"></span>`;
}
(function () {
    let list = null;
    const key = name => String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    function decorate() {
        if (!list) return;
        document.querySelectorAll('.watch-slot:not([data-watch-done])').forEach(slot => {
            slot.dataset.watchDone = '1';
            const player = list.find(p => key(p.name) === key(slot.dataset.watchName) && (!slot.dataset.watchTeam || p.team === slot.dataset.watchTeam));
            if (!player) return;
            slot.innerHTML = `<span class="draft-watch-badge" title="${injEscape(player.note || '')}" aria-label="À surveiller">${getIcon('eye', 14)}<span>À surveiller</span></span>`;
        });
    }
    document.addEventListener('DOMContentLoaded', () => {
        const table = document.getElementById('playerTable');
        if (!table || typeof FZDraftKit === 'undefined') return;
        new MutationObserver(decorate).observe(table, { childList:true, subtree:true });
        FZDraftKit.chargerWatchlist().then(rows => { list = rows; decorate(); }).catch(() => {});
    });
})();
