/* ============================================================
   CALENDRIER — une page à part entière
   ------------------------------------------------------------
   Le calendrier vivait dans l'accueil, coincé entre la bannière et
   les panneaux : on le cherchait. Il a maintenant son onglet. Même
   source que l'accueil (GET /schedule/:date, une semaine de la LNH
   par appel, avec les dates de la semaine d'avant et d'après), et
   une chose de plus : repérer les matchs où jouent SES joueurs.

   Tout ce qui est affiché vient de la LNH ou du pool actif. Aucune
   heure ni aucun score n'est deviné : un match sans heure connue dit
   « Heure à confirmer ».
   ============================================================ */
(function () {
    const BASE_URL = window.location.hostname.includes('localhost')
        ? 'http://localhost:3000'
        : window.location.origin;

    const echapper = t => String(t == null ? '' : t)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
    const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
                  'septembre', 'octobre', 'novembre', 'décembre'];

    /** La journée du pool (heure de l'Est), comme le reste du site. */
    function aujourdhui() {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(new Date());
        const v = t => parts.find(p => p.type === t).value;
        return `${v('year')}-${v('month')}-${v('day')}`;
    }

    const dateUTC = iso => new Date(`${iso}T12:00:00Z`);
    const jourLong = iso => {
        const d = dateUTC(iso);
        return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`;
    };
    const joursEntre = (a, b) => Math.round((dateUTC(b) - dateUTC(a)) / 86400000);
    const decaler = (iso, n) => {
        const d = dateUTC(iso);
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
    };

    /**
     * Le lundi de la semaine d'une date.
     *
     * La LNH rend sept jours à partir de la date DEMANDÉE : ouvrir la page un
     * jeudi montrait du jeudi au mercredi. Demander toujours le lundi fixe la
     * semaine du lundi au dimanche, et les flèches avancent d'un lundi à
     * l'autre.
     */
    const lundiDe = iso => decaler(iso, -((dateUTC(iso).getUTCDay() + 6) % 7));

    /**
     * Les sept jours du lundi au dimanche, qu'ils aient des matchs ou non.
     * En bord de calendrier, la LNH peut rendre moins de sept jours ; le jour
     * manquant s'affiche alors vide plutôt que de décaler la semaine.
     */
    function septJours(lundi, jours) {
        const parDate = new Map((jours || []).map(d => [d.date, d]));
        return Array.from({ length: 7 }, (_, i) => {
            const date = decaler(lundi, i);
            return parDate.get(date) || { date, games: [] };
        });
    }

    let semaine = null;      // réponse de /schedule/:date
    let jourChoisi = null;   // ISO
    let mesClubs = new Map(); // abbrev → [noms de mes joueurs]
    let seulementMiens = false;
    let chargement = 0;
    // Le lundi DEMANDÉ, posé avant la réponse : deux clics rapides sur une
    // flèche reculent de deux semaines, pas deux fois de la même.
    let lundiVise = null;

    // ---------------------------------------------------------- données

    async function chargerSemaine(date, { silencieux = false } = {}) {
        const jeton = ++chargement;
        const lundi = lundiDe(date);
        lundiVise = lundi;
        if (!silencieux) {
            document.getElementById('calGames').innerHTML =
                '<div class="cal-loading"><span class="cal-spinner" aria-hidden="true"></span>Chargement du calendrier…</div>';
        }
        try {
            const reponse = await fetch(`${BASE_URL}/schedule/${lundi}`, { cache: 'no-store' });
            const donnees = reponse.ok ? await reponse.json() : null;
            if (jeton !== chargement) return;
            semaine = donnees && Array.isArray(donnees.days) ? donnees : { days: [] };
        } catch (e) {
            if (jeton !== chargement) return;
            semaine = { days: [] };
        }
        // Une semaine vide reste vide : sept jours sans match inventés
        // cacheraient le message « calendrier indisponible ».
        if (semaine.days.length) semaine.days = septJours(lundi, semaine.days);
        const jours = semaine.days.map(d => d.date);
        jourChoisi = jours.includes(date) ? date
            : (jours.includes(jourChoisi) ? jourChoisi : (jours.find(d => d >= date) || jours[0] || date));
        rendre();
    }

    /**
     * Les clubs de mes joueurs dans le pool actif.
     *
     * Le club vient des statistiques de la saison (/current-stats) : un
     * joueur échangé dans la LNH suit son nouveau club, pas celui de la
     * trousse de repêchage.
     */
    async function chargerMesClubs() {
        if (!window.FZPool) return;
        try { await FZPool.ready(); } catch (e) { return; }
        const equipe = FZPool.team();
        if (!equipe || !equipe.data) return;
        const nomDe = p => (typeof p === 'string') ? p : (p && (p.skaterFullName || p.goalieFullName)) || null;
        const noms = ['offensive', 'defensive', 'goalie', 'rookie']
            .flatMap(c => (equipe.data[c] || []).map(nomDe)).filter(Boolean);
        const clubsLNH = (equipe.data.teams || []).map(p => (typeof p === 'string' ? p : p && p.teamFullName)).filter(Boolean);
        if (!noms.length && !clubsLNH.length) return;

        try {
            const reponse = await fetch(`${BASE_URL}/current-stats`, { cache: 'no-store' });
            const stats = reponse.ok ? await reponse.json() : null;
            const parNom = new Map(((stats && stats.players) || []).map(p => [p.playerName, p.teamAbbrev]));
            mesClubs = new Map();
            noms.forEach(nom => {
                const club = parNom.get(nom);
                if (!club) return;
                if (!mesClubs.has(club)) mesClubs.set(club, []);
                mesClubs.get(club).push(nom);
            });
        } catch (e) { /* le filtre reste simplement masqué */ }

        const filtre = document.getElementById('calFilter');
        if (filtre) filtre.hidden = mesClubs.size === 0;
        rendre();
    }

    // ---------------------------------------------------------- rendu

    function libelleSaison() {
        const el = document.getElementById('calSeason');
        if (!el || !semaine) return;
        const debut = semaine.regularSeasonStartDate;
        const auj = aujourdhui();
        if (debut && auj < debut) {
            const n = joursEntre(auj, debut);
            el.textContent = n === 1 ? 'Saison régulière demain'
                : `Saison régulière dans ${n} jours · ${jourLong(debut)}`;
            el.hidden = false;
        } else {
            el.hidden = true;
        }
    }

    function rendreBande() {
        const bande = document.getElementById('calStrip');
        const auj = aujourdhui();
        const jours = (semaine && semaine.days) || [];
        if (!jours.length) { bande.innerHTML = ''; return; }
        bande.innerHTML = jours.map(d => {
            const n = (d.games || []).length;
            const miens = (d.games || []).filter(estAMoi).length;
            const actif = d.date === jourChoisi;
            const date = dateUTC(d.date);
            return `
                <button type="button" role="tab" class="cal-chip${actif ? ' is-active' : ''}${d.date === auj ? ' is-today' : ''}"
                        aria-selected="${actif}" data-jour="${d.date}">
                    <span class="cal-chip-dow">${d.date === auj ? 'Auj.' : JOURS_COURTS[date.getUTCDay()]}</span>
                    <span class="cal-chip-num">${date.getUTCDate()}</span>
                    <span class="cal-chip-count">${n ? `${n} match${n > 1 ? 's' : ''}` : '—'}</span>
                    ${miens ? `<span class="cal-chip-mine" title="${miens} avec mes joueurs">${miens}</span>` : ''}
                </button>`;
        }).join('');
    }

    function estAMoi(match) {
        return mesClubs.has(match.away && match.away.abbrev) || mesClubs.has(match.home && match.home.abbrev);
    }

    function heure(iso) {
        if (!iso) return 'Heure à confirmer';
        return new Date(iso).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
    }

    function periode(m) {
        if (m.periodType === 'SO') return 'Tirs de barrage';
        if (m.periodType === 'OT') return 'Prolongation';
        return m.period ? `${m.period}e période` : 'En cours';
    }

    function statut(m) {
        if (m.state === 'LIVE' || m.state === 'CRIT') {
            const temps = m.clock && m.clock.inIntermission ? 'Entracte' : (m.clock && m.clock.timeRemaining) || '';
            return `<span class="cal-tag is-live"><i aria-hidden="true"></i>En direct</span> ${echapper(periode(m))}${temps ? ` · ${echapper(temps)}` : ''}`;
        }
        if (m.state === 'FINAL' || m.state === 'OFF') {
            const suffixe = m.periodType === 'OT' ? ' (prol.)' : m.periodType === 'SO' ? ' (t.b.)' : '';
            return `<span class="cal-tag">Final${suffixe}</span>`;
        }
        if (m.state === 'PPD') return '<span class="cal-tag">Reporté</span>';
        return `<span class="cal-tag is-soon">${echapper(heure(m.startTimeUTC))}</span>`;
    }

    function carteEquipe(t, gagnant, joue) {
        const abbr = (t && t.abbrev) || '?';
        const score = joue && t && t.score != null ? t.score : '';
        return `
            <div class="cal-team${gagnant ? ' is-winner' : ''}">
                <img src="teams/${echapper(abbr)}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
                <span class="cal-team-abbr">${echapper(abbr)}</span>
                <span class="cal-team-score">${echapper(score)}</span>
            </div>`;
    }

    function carteMatch(m) {
        const joue = !['FUT', 'PRE', 'PPD'].includes(m.state);
        const a = m.away || {}, h = m.home || {};
        const fini = m.state === 'FINAL' || m.state === 'OFF';
        const miens = [...(mesClubs.get(a.abbrev) || []), ...(mesClubs.get(h.abbrev) || [])];
        // La feuille de match n'existe qu'une fois la rondelle au jeu.
        const feuille = joue && m.id
            ? `<a class="cal-game-box" href="match.html?id=${encodeURIComponent(m.id)}">Feuille de match<span aria-hidden="true">›</span></a>`
            : '';
        return `
            <article class="cal-game${miens.length ? ' is-mine' : ''}${m.state === 'LIVE' || m.state === 'CRIT' ? ' is-live' : ''}">
                <div class="cal-game-status">${statut(m)}</div>
                ${carteEquipe(a, fini && a.score > h.score, joue)}
                ${carteEquipe(h, fini && h.score > a.score, joue)}
                ${miens.length ? `<p class="cal-game-mine"><strong>Mes joueurs :</strong> ${miens.map(echapper).join(', ')}</p>` : ''}
                ${feuille}
            </article>`;
    }

    function rendreJour() {
        const titre = document.getElementById('calDayTitle');
        const zone = document.getElementById('calGames');
        const jour = ((semaine && semaine.days) || []).find(d => d.date === jourChoisi);
        titre.textContent = jourChoisi ? jourLong(jourChoisi).replace(/^./, c => c.toUpperCase()) : '';

        let matchs = (jour && jour.games) || [];
        const total = matchs.length;
        if (seulementMiens) matchs = matchs.filter(estAMoi);

        const note = document.getElementById('calMineNote');
        if (note) {
            const n = ((jour && jour.games) || []).filter(estAMoi).length;
            note.textContent = mesClubs.size ? `${n} match${n > 1 ? 's' : ''} avec vos joueurs ce jour-là` : '';
        }

        if (!semaine || !semaine.days.length) {
            zone.innerHTML = '<p class="cal-empty">Le calendrier de la LNH est indisponible pour le moment. Réessayez dans un instant.</p>';
            return;
        }
        if (!total) {
            zone.innerHTML = '<p class="cal-empty">Aucun match cette journée.</p>';
            return;
        }
        if (!matchs.length) {
            zone.innerHTML = '<p class="cal-empty">Aucun de vos joueurs ne joue cette journée.</p>';
            return;
        }
        zone.innerHTML = matchs.map(carteMatch).join('');
    }

    function rendreTitre() {
        const jours = (semaine && semaine.days) || [];
        const titre = document.getElementById('calTitle');
        if (!titre) return;
        if (!jours.length) { titre.textContent = 'Matchs de la semaine'; return; }
        const d1 = dateUTC(jours[0].date), d2 = dateUTC(jours[jours.length - 1].date);
        titre.textContent = d1.getUTCMonth() === d2.getUTCMonth()
            ? `Du ${d1.getUTCDate()} au ${d2.getUTCDate()} ${MOIS[d2.getUTCMonth()]}`
            : `Du ${d1.getUTCDate()} ${MOIS[d1.getUTCMonth()]} au ${d2.getUTCDate()} ${MOIS[d2.getUTCMonth()]}`;
    }

    function rendre() {
        rendreTitre();
        libelleSaison();
        rendreBande();
        rendreJour();
        const champ = document.getElementById('calDate');
        if (champ && jourChoisi) champ.value = jourChoisi;
        document.getElementById('calPrev').disabled = !(semaine && semaine.previousStartDate);
        document.getElementById('calNext').disabled = !(semaine && semaine.nextStartDate);
    }

    // ---------------------------------------------------------- gestes

    function brancher() {
        document.getElementById('calStrip').addEventListener('click', e => {
            const puce = e.target.closest('[data-jour]');
            if (!puce) return;
            jourChoisi = puce.dataset.jour;
            rendreBande();
            rendreJour();
            const champ = document.getElementById('calDate');
            if (champ) champ.value = jourChoisi;
        });
        document.getElementById('calStrip').addEventListener('keydown', e => {
            if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || !semaine) return;
            const jours = semaine.days.map(d => d.date);
            const i = jours.indexOf(jourChoisi) + (e.key === 'ArrowRight' ? 1 : -1);
            if (i < 0 || i >= jours.length) return;
            e.preventDefault();
            jourChoisi = jours[i];
            rendreBande(); rendreJour();
            document.querySelector(`.cal-chip[data-jour="${jourChoisi}"]`)?.focus();
        });
        // D'un lundi à l'autre. Les dates de la LNH ne servent qu'à savoir
        // s'il existe une semaine avant ou après : elles suivent la date
        // demandée, pas le lundi.
        document.getElementById('calPrev').addEventListener('click', () => {
            if (semaine && semaine.previousStartDate) { jourChoisi = null; chargerSemaine(decaler(lundiVise, -7)); }
        });
        document.getElementById('calNext').addEventListener('click', () => {
            if (semaine && semaine.nextStartDate) { jourChoisi = null; chargerSemaine(decaler(lundiVise, 7)); }
        });
        document.getElementById('calToday').addEventListener('click', () => {
            jourChoisi = aujourdhui();
            chargerSemaine(jourChoisi);
        });
        document.getElementById('calDate').addEventListener('change', e => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
                jourChoisi = e.target.value;
                chargerSemaine(e.target.value);
            }
        });
        document.getElementById('calMine').addEventListener('change', e => {
            seulementMiens = e.target.checked;
            rendreJour();
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        brancher();
        const demande = new URLSearchParams(window.location.search).get('date');
        jourChoisi = /^\d{4}-\d{2}-\d{2}$/.test(demande || '') ? demande : aujourdhui();
        chargerSemaine(jourChoisi);
        chargerMesClubs();
        if (window.FZPool && typeof FZPool.on === 'function') FZPool.on(chargerMesClubs);
        // Les scores d'un soir de match bougent : on relit la semaine affichée
        // toutes les 60 secondes, seulement si elle contient aujourd'hui.
        setInterval(() => {
            if (document.hidden || !semaine) return;
            const auj = aujourdhui();
            if (semaine.days.some(d => d.date === auj)) chargerSemaine(jourChoisi || auj, { silencieux: true });
        }, 60000);
    });
})();
