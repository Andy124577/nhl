/* ============================================================
   CENTRE DE NOTIFICATIONS
   ------------------------------------------------------------
   Chaque notification appartient à un pool et le dit. Le lien porte
   ?pool=<nom> : la page d'arrivée bascule donc le contexte avant
   d'ouvrir le contenu visé, et personne n'a à retrouver à la main
   dans quel pool se trouvait l'échange.

   Rien n'est stocké côté serveur : les éléments sont recomposés à
   partir de /trades/pending et de /draft. Seul l'état « déjà vu »
   est conservé, dans localStorage.
   ============================================================ */
(function () {
    const CLE_VUES = 'fzNotifsVues';

    const ICONES = {
        cloche: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>`,
        echange: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
        cible: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
        depart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`
    };

    const echapper = texte => String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const lienPool = nom => `pool=${encodeURIComponent(nom)}`;

    let elements = [];

    // ==================== ÉTAT « DÉJÀ VU » ====================

    function idsVus() {
        try {
            const brut = JSON.parse(localStorage.getItem(CLE_VUES) || '[]');
            return Array.isArray(brut) ? brut : [];
        } catch { return []; }
    }

    /**
     * N'enregistre que les identifiants encore présents : sans ce ménage,
     * la liste grossirait indéfiniment au fil des saisons.
     */
    function marquerVus(ids) {
        const actuels = new Set(ids);
        const conserves = idsVus().filter(id => actuels.has(id));
        localStorage.setItem(CLE_VUES, JSON.stringify([...new Set([...conserves, ...ids])]));
    }

    // ==================== COLLECTE ====================

    async function echangesEnAttente() {
        const username = localStorage.getItem('username');
        if (!username) return [];
        try {
            const reponse = await fetch(
                `${FZPool.BASE_URL}/trades/pending/${encodeURIComponent(username)}`,
                { cache: 'no-store' });
            if (!reponse.ok) return [];
            const echanges = await reponse.json();
            if (!Array.isArray(echanges)) return [];

            return echanges.map(echange => {
                const recu = (echange.offering || [])[0];
                const donne = (echange.receiving || [])[0];
                return {
                    id: `trade:${echange.id}`,
                    type: 'echange',
                    icone: ICONES.echange,
                    pool: echange.draftName,
                    titre: 'Proposition d\'échange reçue',
                    detail: recu && donne
                        ? `${echange.fromTeam} vous offre ${recu.name} contre ${donne.name}`
                        : `De ${echange.fromTeam}`,
                    date: echange.date ? new Date(echange.date).getTime() : Date.now(),
                    href: `trade.html?${lienPool(echange.draftName)}&trade=${encodeURIComponent(echange.id)}`
                };
            });
        } catch (erreur) {
            console.error('Échanges en attente indisponibles :', erreur);
            return [];
        }
    }

    function repechages() {
        const liste = [];
        FZPool.mine().forEach(pool => {
            const etat = FZPool.draftState(pool.data);

            if (etat.etat === 'encours') {
                const monTour = etat.equipeAuTour === pool.teamName;
                liste.push({
                    id: monTour
                        ? `turn:${pool.name}:${etat.choixFait}`
                        : `draft:${pool.name}`,
                    type: 'repechage',
                    icone: ICONES.cible,
                    pool: pool.name,
                    urgent: monTour,
                    titre: monTour ? 'C\'est à votre tour de choisir' : 'Repêchage en cours',
                    detail: `Choix ${etat.choixFait + 1} sur ${etat.choixTotal}`,
                    date: Date.now(),
                    href: `repechage.html?${lienPool(pool.name)}`
                });
            } else if (etat.etat === 'pret') {
                liste.push({
                    id: `ready:${pool.name}`,
                    type: 'repechage',
                    icone: ICONES.depart,
                    pool: pool.name,
                    titre: 'Repêchage prêt à commencer',
                    detail: `${etat.inscrits}/${etat.max} participants inscrits`,
                    date: Date.now(),
                    href: `repechage.html?${lienPool(pool.name)}`
                });
            }
        });
        return liste;
    }

    async function collecter() {
        const [echanges] = await Promise.all([echangesEnAttente()]);
        // Le tour de repêchage passe devant : c'est le seul élément qui
        // bloque réellement les autres participants.
        const tout = [...repechages(), ...echanges];
        tout.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || b.date - a.date);
        return tout;
    }

    // ==================== RENDU ====================

    function monterCloche() {
        const droite = document.querySelector('.navbar-desktop .navbar-right');
        if (!droite) return false;
        if (document.getElementById('fzNotifWrap')) return true;

        const html = `
            <div class="fz-notif" id="fzNotifWrap">
                <button type="button" class="fz-notif-btn" id="fzNotifBtn"
                        aria-haspopup="true" aria-expanded="false" aria-controls="fzNotifPanel"
                        title="Notifications">
                    ${ICONES.cloche}
                    <span class="fz-notif-badge" id="fzNotifBadge" hidden>0</span>
                </button>
                <div class="fz-notif-panel" id="fzNotifPanel" role="menu" aria-label="Notifications">
                    <div class="fz-notif-head">
                        <span>Notifications</span>
                        <span class="fz-notif-count" id="fzNotifCount"></span>
                    </div>
                    <div class="fz-notif-list" id="fzNotifList"></div>
                </div>
            </div>`;
        droite.insertAdjacentHTML('afterbegin', html);

        const bouton = document.getElementById('fzNotifBtn');
        const panneau = document.getElementById('fzNotifPanel');

        bouton.addEventListener('click', e => {
            e.stopPropagation();
            const ouvert = panneau.classList.toggle('is-open');
            bouton.setAttribute('aria-expanded', String(ouvert));
            if (ouvert) {
                // Ouvrir vaut lecture : le compteur retombe, la liste reste.
                marquerVus(elements.map(el => el.id));
                majBadge();
            }
        });

        document.addEventListener('click', e => {
            if (!e.target.closest('#fzNotifWrap')) {
                panneau.classList.remove('is-open');
                bouton.setAttribute('aria-expanded', 'false');
            }
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && panneau.classList.contains('is-open')) {
                panneau.classList.remove('is-open');
                bouton.setAttribute('aria-expanded', 'false');
                bouton.focus();
            }
        });

        return true;
    }

    function majBadge() {
        const badge = document.getElementById('fzNotifBadge');
        if (!badge) return;
        const vus = new Set(idsVus());
        const nonLus = elements.filter(el => !vus.has(el.id)).length;
        badge.textContent = nonLus > 9 ? '9+' : String(nonLus);
        badge.hidden = nonLus === 0;
        document.getElementById('fzNotifBtn')?.classList.toggle('has-unread', nonLus > 0);
    }

    function rendreListe() {
        const liste = document.getElementById('fzNotifList');
        const compteur = document.getElementById('fzNotifCount');
        if (!liste) return;

        if (elements.length === 0) {
            liste.innerHTML = `
                <div class="fz-notif-empty">
                    <span class="fz-notif-empty-icon">${ICONES.cloche}</span>
                    <p>Rien à signaler pour l'instant.</p>
                </div>`;
            if (compteur) compteur.textContent = '';
            majBadge();
            return;
        }

        const vus = new Set(idsVus());
        if (compteur) compteur.textContent = `${elements.length}`;

        liste.innerHTML = elements.map(el => `
            <a class="fz-notif-item${vus.has(el.id) ? '' : ' is-unread'}${el.urgent ? ' is-urgent' : ''}"
               href="${el.href}" role="menuitem">
                <span class="fz-notif-icon fz-notif-icon-${el.type}">${el.icone}</span>
                <span class="fz-notif-txt">
                    <span class="fz-notif-title">${echapper(el.titre)}</span>
                    <span class="fz-notif-pool">${echapper(el.pool)}</span>
                    <span class="fz-notif-detail">${echapper(el.detail)}</span>
                </span>
            </a>`).join('');

        majBadge();
    }

    async function rafraichir() {
        elements = await collecter();
        rendreListe();
    }

    // ==================== CYCLE DE VIE ====================

    async function demarrer() {
        if (localStorage.getItem('isLoggedIn') !== 'true') return;
        if (!window.FZPool) return;
        await FZPool.ready();
        if (!monterCloche()) return;
        await rafraichir();

        FZPool.onData(() => { rafraichir(); });

        if (typeof io !== 'undefined') {
            try {
                const socket = window.__fzSocketPool || io(FZPool.BASE_URL);
                socket.on('tradePending', () => rafraichir());
                socket.on('tradeUpdated', () => rafraichir());
            } catch { /* socket indisponible */ }
        }
    }

    function attendreNavbar() {
        if (document.querySelector('.navbar-desktop .navbar-right')) { demarrer(); return; }
        const navbar = document.querySelector('.navbar');
        if (!navbar) return;
        const observateur = new MutationObserver(() => {
            if (document.querySelector('.navbar-desktop .navbar-right')) {
                observateur.disconnect();
                demarrer();
            }
        });
        observateur.observe(navbar, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attendreNavbar);
    } else {
        attendreNavbar();
    }
})();
