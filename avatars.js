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

// Sync version — returns HTML using whatever is already cached (call getAvatarUrl first)
function avatarHtml(username, size = 32) {
    const url = _avatarCache[username];
    return url
        ? `<img src="${url}" class="member-avatar" style="width:${size}px;height:${size}px;min-width:${size}px;border-radius:50%;object-fit:cover;" alt="${(username||'?').charAt(0).toUpperCase()}">`
        : `<img src="Icons/grayUser.png" class="member-avatar member-avatar-default" style="width:${size}px;height:${size}px;min-width:${size}px;border-radius:50%;object-fit:cover;" alt="${(username||'?').charAt(0).toUpperCase()}">`;
}

// Pre-fetch an array of usernames in parallel, then call avatarHtml safely
async function prefetchAvatars(usernames) {
    await Promise.all([...new Set(usernames)].map(u => getAvatarUrl(u)));
}
