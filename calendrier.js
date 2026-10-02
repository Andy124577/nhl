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
    const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juill.', 'août',
                         'sept.', 'oct.', 'nov.', 'déc.'];

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
    let chargement = 0;
    // Le lundi DEMANDÉ, posé avant la réponse : deux clics rapides sur une
    // flèche reculent de deux semaines, pas deux fois de la même.
    let lundiVise = null;

    // ---------------------------------------------------------- données

    async function chargerSemaine(date, { silencieux = false } = {}) {
        const jeton = ++chargement;
        const lundi = lundiDe(date);
        lundiVise = lundi;
        rendreSemaine();
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
            const reponse = await fetch(`${BASE_URL}/current-stats`, { cache: 'no-cache' });
            const stats = reponse.ok ? await reponse.json() : null;
            const parNom = new Map(((stats && stats.players) || []).map(p => [p.playerName, p.teamAbbrev]));
            mesClubs = new Map();
            noms.forEach(nom => {
                const club = parNom.get(nom);
                if (!club) return;
                if (!mesClubs.has(club)) mesClubs.set(club, []);
                mesClubs.get(club).push(nom);
            });
        } catch (e) { /* les matchs restent simplement sans repère */ }

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

    /** « 08:23 » : minutes sur deux chiffres, la largeur ne bouge pas à 9:59. */
    const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

    /**
     * L'horloge d'un match en cours. Une horloge que le direct dit en marche
     * avance seule dans la page (battreHorloges) : le serveur ne la repousse
     * qu'aux arrêts de jeu et aux reprises.
     */
    function horloge(m) {
        const c = m.clock;
        if (!c) return '';
        if (c.inIntermission) return 'Entracte';
        const s = Number.isFinite(c.secondsRemaining) ? c.secondsRemaining : null;
        if (s === null || !m._recuLe) return echapper(c.timeRemaining || '');
        const restant = c.running ? Math.max(0, s - Math.floor((Date.now() - m._recuLe) / 1000)) : s;
        return `<span class="cal-clock" data-cal-s="${s}" data-cal-at="${m._recuLe}" data-cal-run="${c.running ? 1 : 0}">${mmss(restant)}</span>`;
    }

    function statut(m) {
        if (m.state === 'LIVE' || m.state === 'CRIT') {
            const temps = horloge(m);
            return `<span class="cal-tag is-live"><i aria-hidden="true"></i>En direct</span> ${echapper(periode(m))}${temps ? ` · ${temps}` : ''}`;
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

    function carteMatch(horaire) {
        const m = etatAffiche(horaire);
        const joue = !['FUT', 'PRE', 'PPD'].includes(m.state);
        const a = m.away || {}, h = m.home || {};
        const fini = m.state === 'FINAL' || m.state === 'OFF';
        const miens = [...(mesClubs.get(a.abbrev) || []), ...(mesClubs.get(h.abbrev) || [])];
        // La feuille de match n'existe qu'une fois la rondelle au jeu.
        const feuille = joue && m.id
            ? `<a class="cal-game-box" href="match.html?id=${encodeURIComponent(m.id)}">Feuille de match<span aria-hidden="true">›</span></a>`
            : '';
        return `
            <article class="cal-game${miens.length ? ' is-mine' : ''}${m.state === 'LIVE' || m.state === 'CRIT' ? ' is-live' : ''}" data-match="${echapper(m.id)}">
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

        const matchs = (jour && jour.games) || [];

        if (!semaine || !semaine.days.length) {
            zone.innerHTML = '<p class="cal-empty">Le calendrier de la LNH est indisponible pour le moment. Réessayez dans un instant.</p>';
            return;
        }
        if (!matchs.length) {
            zone.innerHTML = '<p class="cal-empty">Aucun match cette journée.</p>';
            return;
        }
        zone.innerHTML = matchs.map(carteMatch).join('');
        reglerHorloges();
    }

    /**
     * « 21 sept. - 27 », ou « 28 sept. - 4 oct. » à cheval sur deux mois.
     * Tirée du lundi demandé, pas des jours reçus : une semaine que la LNH
     * n'a pas pu rendre dit quand même laquelle on regarde.
     */
    function rendreSemaine() {
        const el = document.getElementById('calRange');
        if (!el || !lundiVise) return;
        const d1 = dateUTC(lundiVise), d2 = dateUTC(decaler(lundiVise, 6));
        const debut = `${d1.getUTCDate()} ${MOIS_COURTS[d1.getUTCMonth()]}`;
        el.textContent = d1.getUTCMonth() === d2.getUTCMonth()
            ? `${debut} - ${d2.getUTCDate()}`
            : `${debut} - ${d2.getUTCDate()} ${MOIS_COURTS[d2.getUTCMonth()]}`;
        // Partie vers une autre semaine : la pastille flottante ramène à
        // aujourd'hui. Dans la semaine en cours, elle n'a rien à faire.
        const retour = document.getElementById('calReturn');
        if (retour) retour.hidden = lundiVise === lundiDe(aujourdhui());
    }

    function rendre() {
        rendreSemaine();
        libelleSaison();
        rendreBande();
        rendreJour();
        document.getElementById('calPrev').disabled = !(semaine && semaine.previousStartDate);
        document.getElementById('calNext').disabled = !(semaine && semaine.nextStartDate);
        reglerSuivi();
    }

    // ---------------------------------------------------------- direct
    //
    // Les matchs en cours de la semaine affichée suivent le direct que le
    // serveur pousse (salle `scores`, services/scoresEnDirect.js) : le même
    // relevé de la LNH que l'accueil, fait une fois pour tout le monde. La
    // page relisait toute la semaine chaque minute, matchs ou pas. Un match
    // qui sort de la liste des matchs en cours vient de finir : la semaine est
    // alors relue une fois, pour son état final. Sans socket, ou coupé, la
    // relecture reprend — mais seulement quand un match joue ou aurait dû
    // commencer.

    const RANG_ETAT = { FUT: 0, PRE: 0, PPD: 0, LIVE: 1, CRIT: 1, FINAL: 2, OFF: 2 };
    const rangEtat = e => RANG_ETAT[e] ?? 0;
    const enJeu = m => m && (m.state === 'LIVE' || m.state === 'CRIT');

    let enDirect = new Map();   // id → match de /live-games, avec _recuLe
    let suitScores = false;
    let socketBranche = false;
    let horlogesMinuteur = null;

    function socketPartage() {
        return typeof window.fzSocketPartage === 'function' ? window.fzSocketPartage() : null;
    }

    /**
     * Le match tel qu'il est maintenant : l'horaire, avancé par le direct.
     * Le direct ne fait jamais reculer un match que l'horaire dit plus loin.
     */
    function etatAffiche(m) {
        const d = enDirect.get(String(m.id));
        if (!d || rangEtat(d.state) < rangEtat(m.state)) return m;
        return {
            ...m,
            state: d.state,
            period: d.period ?? m.period,
            periodType: d.periodType || m.periodType,
            clock: d.clock || m.clock,
            _recuLe: d._recuLe,
            away: { ...m.away, score: d.away && d.away.score != null ? d.away.score : m.away && m.away.score },
            home: { ...m.home, score: d.home && d.home.score != null ? d.home.score : m.home && m.home.score }
        };
    }

    const matchsDeLaSemaine = () => ((semaine && semaine.days) || []).flatMap(d => d.games || []);

    function reglerSuivi() {
        const voulu = !document.hidden && matchsDeLaSemaine().some(m => enJeu(etatAffiche(m)));
        if (voulu && !suitScores) suivreScores();
        else if (!voulu && suitScores) arreterScores();
    }

    function suivreScores() {
        const s = socketPartage();
        if (!s) return;
        brancherSocket(s);
        suitScores = true;
        if (s.connected) s.emit('scores:suivre');
    }

    function arreterScores() {
        suitScores = false;
        enDirect = new Map();
        const s = socketPartage();
        if (s && s.connected) s.emit('scores:arreter');
    }

    function brancherSocket(s) {
        if (socketBranche) return;
        socketBranche = true;
        s.on('scores:tout', c => { if (suitScores && c) recevoirTout(c.games, c.ageMs); });
        s.on('scores:match', c => { if (suitScores && c && c.game) recevoirMatch(c.game, c.ageMs); });
        s.on('scores:chronos', liste => { if (suitScores && Array.isArray(liste)) liste.forEach(recevoirChrono); });
        // La salle ne survit pas à une reconnexion : on s'y réabonne, et le
        // serveur renvoie l'état complet.
        s.on('connect', () => { if (suitScores) s.emit('scores:suivre'); });
    }

    const recu = (g, ageMs) => ({ ...g, _recuLe: Date.now() - (Number(ageMs) || 0) });

    /** Tous les matchs en cours. Un match qui n'y est plus vient de finir. */
    function recevoirTout(matchs, ageMs) {
        if (!Array.isArray(matchs)) return;
        const avant = matchsDeLaSemaine().filter(m => enJeu(etatAffiche(m))).map(m => String(m.id));
        enDirect = new Map(matchs.map(g => [String(g.id), recu(g, ageMs)]));
        rendreJour();
        if (avant.some(id => !enDirect.has(id))) {
            chargerSemaine(jourChoisi || aujourdhui(), { silencieux: true });
        } else {
            reglerSuivi();
        }
    }

    /** Un match dont le pointage, la période ou l'état a bougé. */
    function recevoirMatch(g, ageMs) {
        enDirect.set(String(g.id), recu(g, ageMs));
        majCarte(g.id);
    }

    /** Une horloge arrêtée, repartie ou recalée. */
    function recevoirChrono(c) {
        const connu = c && enDirect.get(String(c.id));
        if (!connu || !c.clock) return;
        enDirect.set(String(c.id), recu({ ...connu, clock: c.clock }, c.ageMs));
        majCarte(c.id);
    }

    /** Redessine la seule carte d'un match, s'il est à l'écran. */
    function majCarte(id) {
        const carte = document.querySelector(`.cal-game[data-match="${CSS.escape(String(id))}"]`);
        const m = matchsDeLaSemaine().find(x => String(x.id) === String(id));
        if (!carte || !m) return;
        carte.outerHTML = carteMatch(m);
        reglerHorloges();
    }

    /** Un battement par seconde pour toutes les horloges qui avancent. */
    function battreHorloges() {
        const pendules = document.querySelectorAll('.cal-clock[data-cal-run="1"]');
        if (!pendules.length) { reglerHorloges(); return; }
        pendules.forEach(el => {
            const restant = Math.max(0, Number(el.dataset.calS) - Math.floor((Date.now() - Number(el.dataset.calAt)) / 1000));
            const texte = mmss(restant);
            if (el.textContent !== texte) el.textContent = texte;
            if (!restant) el.dataset.calRun = '0';
        });
    }

    function reglerHorloges() {
        const besoin = !document.hidden && !!document.querySelector('.cal-clock[data-cal-run="1"]');
        if (besoin && !horlogesMinuteur) horlogesMinuteur = setInterval(battreHorloges, 1000);
        else if (!besoin && horlogesMinuteur) { clearInterval(horlogesMinuteur); horlogesMinuteur = null; }
    }

    /**
     * La semaine vaut-elle d'être relue ? Un match en cours que le direct ne
     * couvre pas, ou un match d'hier ou d'aujourd'hui qui aurait dû commencer
     * et que l'horaire dit encore à venir.
     */
    function relectureUtile() {
        if (!semaine) return false;
        const direct = suitScores && !!(socketPartage() && socketPartage().connected);
        const hier = decaler(aujourdhui(), -1);
        const bientot = Date.now() + 60000;
        return semaine.days.some(d => (d.games || []).some(horaire => {
            const m = etatAffiche(horaire);
            if (enJeu(m)) return !direct;
            return (m.state === 'FUT' || m.state === 'PRE') && d.date >= hier
                && Date.parse(m.startTimeUTC) <= bientot;
        }));
    }

    // ---------------------------------------------------------- gestes

    function brancher() {
        document.getElementById('calStrip').addEventListener('click', e => {
            const puce = e.target.closest('[data-jour]');
            if (!puce) return;
            jourChoisi = puce.dataset.jour;
            rendreBande();
            rendreJour();
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
        // La pastille disparaît sous le doigt : le focus passe au jour
        // d'aujourd'hui plutôt que de retomber sur la page.
        document.getElementById('calReturn').addEventListener('click', () => {
            jourChoisi = aujourdhui();
            chargerSemaine(jourChoisi).then(() => document.querySelector('.cal-chip.is-today')?.focus());
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        brancher();
        const demande = new URLSearchParams(window.location.search).get('date');
        jourChoisi = /^\d{4}-\d{2}-\d{2}$/.test(demande || '') ? demande : aujourdhui();
        chargerSemaine(jourChoisi);
        chargerMesClubs();
        if (window.FZPool && typeof FZPool.on === 'function') FZPool.on(chargerMesClubs);
        // Le direct (reglerSuivi) porte les matchs en cours. La semaine n'est
        // relue que pour ce qu'il ne dit pas : un match qui aurait dû
        // commencer, ou tout le direct quand le socket manque.
        setInterval(() => {
            if (document.hidden || !relectureUtile()) return;
            chargerSemaine(jourChoisi || aujourdhui(), { silencieux: true });
        }, 60000);
        // Onglet caché : ni direct ni horloge. Au retour, la semaine du jour
        // est relue — elle a pu finir des matchs pendant l'absence.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (suitScores) arreterScores();
                reglerHorloges();
                return;
            }
            const auj = aujourdhui();
            if (semaine && semaine.days.some(d => d.date === auj)) chargerSemaine(jourChoisi || auj, { silencieux: true });
            else reglerSuivi();
        });
    });
})();
