function bindOffseasonCarousel(track = document.getElementById('fzdOffTransactions'), dots = document.getElementById('fzdOffDots'), prev = document.getElementById('fzdOffPrev'), next = document.getElementById('fzdOffNext')) {
    if (!track || track.dataset.carouselBound) return;
    track.dataset.carouselBound = '1';

    const step = () => offseasonPageMetrics(track).step;
    prev?.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: offseasonScrollBehavior() }));
    next?.addEventListener('click', () => track.scrollBy({ left: step(), behavior: offseasonScrollBehavior() }));

    let raf = 0;
    track.addEventListener('scroll', () => {
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; updateOffseasonCarousel(track, dots, prev, next); });
    });
    // One shared resize listener below avoids retaining removed home panels.
    renderOffseasonDots(track, dots, prev, next);
}

function offseasonScrollBehavior() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
}

function offseasonPageMetrics(track) {
    const card = track.querySelector('.fzd-off-card, .fzh-watch-row');
    if (!card || !track.clientWidth || track.classList.contains('is-empty')) return { pages: 0, step: 1 };
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    const cardStep = card.getBoundingClientRect().width + gap;
    const perPage = Math.max(1, Math.floor((track.clientWidth + gap + 1) / cardStep));
    return { pages: Math.ceil(track.children.length / perPage), step: perPage * cardStep };
}

function renderOffseasonDots(track = document.getElementById('fzdOffTransactions'), dots = document.getElementById('fzdOffDots'), prev = document.getElementById('fzdOffPrev'), next = document.getElementById('fzdOffNext')) {
    if (!track || !dots) return;

    const { pages, step } = offseasonPageMetrics(track);
    if (pages < 2) { dots.innerHTML = ''; updateOffseasonCarousel(track, dots, prev, next); return; }
    dots.innerHTML = `<button type="button" class="fzd-off-page-arrow" data-direction="-1" aria-label="Page précédente">‹</button>`
        + Array.from({ length: pages }, (_, i) =>
            `<button type="button" class="fzd-off-dot" data-page="${i}" aria-label="Page ${i + 1} sur ${pages}"></button>`).join('')
        + `<button type="button" class="fzd-off-page-arrow" data-direction="1" aria-label="Page suivante">›</button>`;
    dots.querySelectorAll('.fzd-off-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            track.scrollTo({ left: dot.dataset.page * step, behavior: offseasonScrollBehavior() });
        });
    });
    dots.querySelectorAll('[data-direction]').forEach(button => button.addEventListener('click', () => {
        track.scrollBy({ left: Number(button.dataset.direction) * step, behavior: offseasonScrollBehavior() });
    }));
    updateOffseasonCarousel(track, dots, prev, next);
}

// Reflète la position de défilement : point actif + flèches grisées aux bouts.
function updateOffseasonCarousel(track = document.getElementById('fzdOffTransactions'), dots = document.getElementById('fzdOffDots'), prev = document.getElementById('fzdOffPrev'), next = document.getElementById('fzdOffNext')) {
    if (!track) return;

    const max = track.scrollWidth - track.clientWidth - 1;
    if (prev) prev.disabled = track.scrollLeft <= 0;
    if (next) next.disabled = track.scrollLeft >= max;

    if (dots && dots.children.length) {
        const { pages, step } = offseasonPageMetrics(track);
        const active = track.scrollLeft >= max ? pages - 1 : Math.round(track.scrollLeft / step);
        const start = Math.max(0, Math.min(active - 2, pages - 5));
        dots.querySelectorAll('.fzd-off-dot').forEach((d, i) => {
            d.classList.toggle('is-active', i === active);
            d.setAttribute('aria-current', i === active ? 'page' : 'false');
            d.hidden = i < start || i >= start + 5;
        });
        dots.querySelector('[data-direction="-1"]').disabled = track.scrollLeft <= 0;
        dots.querySelector('[data-direction="1"]').disabled = track.scrollLeft >= max;
    }
}


window.addEventListener('resize', () => {
    clearTimeout(bindOffseasonCarousel._t);
    bindOffseasonCarousel._t = setTimeout(() => {
        renderOffseasonDots();
        document.querySelectorAll('[data-watch-panel]').forEach(panel => fzhWatchDots(panel));
    }, 150);
});
