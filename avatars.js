// Shared avatar cache and helpers — loaded on pages that display member avatars.
// Exposes: getAvatarUrl(username) → Promise<string>, avatarHtml(username, size) → string

const _avatarCache = {};

async function getAvatarUrl(username) {
    if (_avatarCache[username] !== undefined) return _avatarCache[username];
    try {
        const base = window.location.hostname.includes('localhost') ? 'http://localhost:3000' : window.location.origin;
        const r = await fetch(`${base}/user-profile/${encodeURIComponent(username)}`);
        if (!r.ok) { _avatarCache[username] = ''; return ''; }
        const d = await r.json();
        _avatarCache[username] = d.avatarUrl || '';
        return _avatarCache[username];
    } catch {
        _avatarCache[username] = '';
        return '';
    }
}

// Le nom et l'adresse viennent d'autres comptes : échappés avant d'entrer
// dans le HTML.
function _avatarEsc(texte) {
    // \x22 et \x27 : les guillemets " et ', écrits ainsi pour les outils qui
    // lisent ce fichier sans comprendre les expressions régulières.
    return String(texte == null ? '' : texte).replace(/[&<>\x22\x27]/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

// Sync version — returns HTML using whatever is already cached (call getAvatarUrl first)
function avatarHtml(username, size = 32) {
    const url = _avatarCache[username];
    const initiale = _avatarEsc((username || '?').charAt(0).toUpperCase());
    return url
        ? `<img src="${_avatarEsc(url)}" class="member-avatar" style="width:${size}px;height:${size}px;min-width:${size}px;border-radius:50%;object-fit:cover;" alt="${initiale}">`
        : `<img src="Icons/grayUser.png" class="member-avatar member-avatar-default" style="width:${size}px;height:${size}px;min-width:${size}px;border-radius:50%;object-fit:cover;" alt="${initiale}">`;
}

// Pre-fetch an array of usernames in parallel, then call avatarHtml safely
async function prefetchAvatars(usernames) {
    await Promise.all([...new Set(usernames)].map(u => getAvatarUrl(u)));
}
