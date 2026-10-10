/* ============================================================
   CALENDRIER — une page à part entière
   ------------------------------------------------------------
   Le calendrier vivait dans l'accueil, coincé entre la bannière et
   les panneaux : on le cherchait. Il a maintenant son onglet. Même
   source que l'accueil (GET /schedule/:date, une semaine de la LNH
   par appel, avec les dates de la semaine d'avant et d'après), et
   une chose de plus : repérer les matchs où jouent SES joueurs — le
   filtre « Mes joueurs » ne garde qu'eux. Chaque match est une carte
   à la manière de la page des pointages de la LNH : l'heure, les deux
   clubs et leur fiche, puis ses buts une fois commencé ; à venir, les
   meneurs des deux clubs et mes joueurs qui y sont (voir « listes »).

   Tout ce qui est affiché vient de la LNH ou du pool actif. Aucune
   heure ni aucun score n'est deviné : un match sans heure connue dit
   « À confirmer ».
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

    /**
     * Nom court et couleur de chaque club. La couleur est le fond rond de la
     * photo d'un joueur, comme sur la page des pointages de la LNH ; ce sont
     * celles de la maquette, pas de teamColors.js : éclaircies pour se voir
     * sur le fond sombre (le marine de WPG, FLA ou EDM y disparaît).
     */
    const EQUIPES = {
        ANA: ['Ducks', '#f07a38'], BOS: ['Bruins', '#e8a812'], BUF: ['Sabres', '#2f5fb5'],
        CAR: ['Hurricanes', '#d11f30'], CBJ: ['Blue Jackets', '#3a5fa8'], CGY: ['Flames', '#e0302a'],
        CHI: ['Blackhawks', '#d0182e'], COL: ['Avalanche', '#9a3d5a'], DAL: ['Stars', '#16a865'],
        DET: ['Red Wings', '#d1283a'], EDM: ['Oilers', '#ff5a14'], FLA: ['Panthers', '#c8263a'],
        LAK: ['Kings', '#9aa2a6'], MIN: ['Wild', '#2e8a5e'], MTL: ['Canadiens', '#b8283a'],
        NJD: ['Devils', '#c81f30'], NSH: ['Predators', '#f2b01c'], NYI: ['Islanders', '#f07d30'],
        NYR: ['Rangers', '#3a64c8'], OTT: ['Sénateurs', '#c52032'], PHI: ['Flyers', '#f75a10'],
        PIT: ['Penguins', '#e0aa18'], SEA: ['Kraken', '#68a2b9'], SJS: ['Sharks', '#00a3b0'],
        STL: ['Blues', '#3a6fd0'], TBL: ['Lightning', '#3d6fc0'], TOR: ['Maple Leafs', '#3a6fd0'],
        UTA: ['Mammoth', '#6cace4'], VAN: ['Canucks', '#1f9a52'], VGK: ['Golden Knights', '#b4975a'],
        WPG: ['Jets', '#4a78c2'], WSH: ['Capitals', '#c8203a']
    };

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
    let mesClubs = new Map(); // abbrev → [{ nom, stats }] — stats : la ligne de /current-stats
    let saisonCommencee = true;
    let chargement = 0;
    // Le lundi DEMANDÉ, posé avant la réponse : deux clics rapides sur une
    // flèche reculent de deux semaines, pas deux fois de la même.
    let lundiVise = null;

    // « Tous » ou « Mes joueurs », gardé d'une visite à l'autre sur cet
    // appareil. Sans joueurs dans le pool actif, le filtre n'existe pas.
    const CLE_FILTRE = 'fz-cal-filtre';
    let filtre = (() => {
        try { return localStorage.getItem(CLE_FILTRE) === 'miens' ? 'miens' : 'tous'; } catch (e) { return 'tous'; }
    })();
    const filtreActif = () => filtre === 'miens' && mesClubs.size > 0;

    // ---------------------------------------------------------- données

    // Les cartes de match en os de calendrier.html, reprises à chaque semaine
    // qui se charge : le script est différé, la page est déjà lue.
    const CARTES_SQUELETTE = document.getElementById('calGames').innerHTML;

    /**
     * La semaine en os, le temps que /schedule réponde. Ses sept jours sont
     * déjà connus — seul leur compte de matchs attend —, la journée garde son
     * titre, et les cartes de match sont en os. rendre() pose la semaine
     * chargée aux mêmes places.
     */
    function rendreSquelette(lundi, date) {
        const auj = aujourdhui();
        document.getElementById('calStrip').innerHTML = Array.from({ length: 7 }, (_, i) => {
            const jour = decaler(lundi, i);
            return `
                <span class="cal-chip${jour === date ? ' is-active' : ''}${jour === auj ? ' is-today' : ''}" aria-hidden="true">
                    ${jourDeBande(jour)}
                    <span class="fz-bone-flat cal-sk-count"></span>
                </span>`;
        }).join('');
        document.getElementById('calDayTitle').textContent = jourLong(date).replace(/^./, c => c.toUpperCase());
        document.getElementById('calGames').innerHTML = CARTES_SQUELETTE;
    }

    async function chargerSemaine(date, { silencieux = false } = {}) {
        const jeton = ++chargement;
        const lundi = lundiDe(date);
        lundiVise = lundi;
        rendreSemaine();
        if (!silencieux) rendreSquelette(lundi, date);
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
        const nomDe = p => (typeof p === 'string') ? p : (p && (p.skaterFullName || p.goalieFullName)) || null;
        const noms = equipe && equipe.data ? ['offensive', 'defensive', 'goalie', 'rookie']
            .flatMap(c => (equipe.data[c] || []).map(nomDe)).filter(Boolean) : [];
        // Un pool où je n'ai pas de joueurs : ceux du pool d'avant ne
        // doivent pas rester dans le filtre.
        if (!noms.length) {
            if (mesClubs.size) { mesClubs = new Map(); rafraichir(); }
            return;
        }

        try {
            const reponse = await fetch(`${BASE_URL}/current-stats`, { cache: 'no-cache' });
            const stats = reponse.ok ? await reponse.json() : null;
            const parNom = new Map(((stats && stats.players) || []).map(p => [p.playerName, p]));
            // Avant le premier match, /current-stats sert les totaux de l'an
            // passé : la carte du joueur le dit.
            saisonCommencee = !stats || stats.seasonStarted !== false;
            mesClubs = new Map();
            noms.forEach(nom => {
                const ligne = parNom.get(nom);
                const club = ligne && ligne.teamAbbrev;
                if (!club) return;
                if (!mesClubs.has(club)) mesClubs.set(club, []);
                mesClubs.get(club).push({ nom, stats: ligne });
            });
        } catch (e) { /* les matchs restent simplement sans repère */ }

        rafraichir();
    }

    /**
     * Tout redessiner — sauf avant la première semaine : /current-stats peut
     * répondre avant /schedule, et le squelette cédait alors la place à
     * « calendrier indisponible ».
     */
    function rafraichir() {
        if (semaine) rendre();
        else rendreFiltre();
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

    /** « MAR. » (en capitales par calendrier.css), puis le quantième. */
    function jourDeBande(iso) {
        const d = dateUTC(iso);
        return `<span class="cal-chip-dow">${JOURS_COURTS[d.getUTCDay()]}</span>`
            + `<span class="cal-chip-num">${d.getUTCDate()}</span>`;
    }

    const nMatchs = n => `${n} match${n > 1 ? 's' : ''}`;

    /**
     * Les sept jours, chacun dans sa case : l'abréviation, le quantième, le
     * nombre de matchs. Leur compte suit le filtre : sous « Mes joueurs »,
     * chaque jour dit combien de ses matchs ont un de mes joueurs.
     */
    function rendreBande() {
        const bande = document.getElementById('calStrip');
        const auj = aujourdhui();
        const jours = (semaine && semaine.days) || [];
        majRetour();
        if (!jours.length) { bande.innerHTML = ''; return; }
        const miensSeuls = filtreActif();
        bande.innerHTML = jours.map(d => {
            const n = (miensSeuls ? (d.games || []).filter(estAMoi) : (d.games || [])).length;
            const actif = d.date === jourChoisi;
            const etiquette = [d.date === auj ? 'Aujourd’hui' : '', jourLong(d.date),
                n ? nMatchs(n) + (miensSeuls ? ' avec mes joueurs' : '') : 'aucun match'].filter(Boolean).join(', ');
            return `
                <button type="button" role="tab" class="cal-chip${actif ? ' is-active' : ''}${d.date === auj ? ' is-today' : ''}${n ? ' has-games' : ''}"
                        aria-selected="${actif}" aria-label="${etiquette}" data-jour="${d.date}">
                    ${jourDeBande(d.date)}
                    <span class="cal-chip-count">${n || '–'}</span>
                </button>`;
        }).join('');
    }

    /** « Tous | Mes joueurs », seulement quand j'ai des joueurs dans le pool actif. */
    function rendreFiltre() {
        const el = document.getElementById('calFilter');
        el.hidden = !mesClubs.size;
        el.innerHTML = mesClubs.size ? [['tous', 'Tous'], ['miens', 'Mes joueurs']].map(([v, l]) =>
            `<button type="button" data-filtre="${v}" aria-pressed="${filtre === v}">${l}</button>`).join('') : '';
    }

    function estAMoi(match) {
        return mesClubs.has(match.away && match.away.abbrev) || mesClubs.has(match.home && match.home.abbrev);
    }

    /**
     * « 19 h 00 HAE » : l'heure de l'appareil, et son fuseau, comme la LNH.
     * null tant que la LNH n'a pas d'heure lisible.
     */
    function heure(iso) {
        const d = iso ? new Date(iso) : null;
        if (!d || Number.isNaN(d.getTime())) return null;
        return d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
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

    /**
     * La pastille en tête de carte. À venir : l'heure. En cours : « En
     * direct », la période et l'horloge. Fini : « Final », et sa
     * prolongation s'il y en a eu.
     */
    function statut(m) {
        if (m.state === 'LIVE' || m.state === 'CRIT') {
            const quand = [periodeCourte(m.period, m.periodType), horloge(m)].filter(Boolean).join(' · ');
            return '<span class="cal-pill is-live"><i aria-hidden="true"></i>En direct'
                + (quand ? `<span class="cal-when"> · ${quand}</span>` : '') + '</span>';
        }
        if (m.state === 'FINAL' || m.state === 'OFF') {
            const prol = m.periodType === 'OT' || m.periodType === 'SO' ? periodeCourte(null, m.periodType) : '';
            return `<span class="cal-pill">Final${prol ? `<span class="cal-when"> · ${prol}</span>` : ''}</span>`;
        }
        if (m.state === 'PPD') return '<span class="cal-pill is-muted">Reporté</span>';
        const h = heure(m.startTimeUTC);
        return h ? `<span class="cal-pill">${echapper(h)}</span>` : '<span class="cal-pill is-muted">À confirmer</span>';
    }

    /**
     * Le logo du club, son nom et sa fiche dessous, la marque à droite ; le
     * perdant en gris. Les quatre logos marine (EDM, TBL, TOR, WSH) passent à
     * leur variante blanche en thème sombre d'eux-mêmes (teamLogos.css). Un
     * logo manquant garde sa place : les noms restent alignés.
     */
    function carteEquipe(t, issue, joue, fiche) {
        const abbr = (t && t.abbrev) || '?';
        const nom = EQUIPES[abbr] ? EQUIPES[abbr][0] : abbr;
        const score = joue && t && t.score != null ? t.score : '';
        return `
            <div class="cal-team${issue ? ` is-${issue}` : ''}">
                ${EQUIPES[abbr]
                    ? `<img class="cal-team-logo" src="teams/${abbr}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
                    : '<span class="cal-team-logo" aria-hidden="true"></span>'}
                <span class="cal-team-id">
                    <span class="cal-team-name">${echapper(nom)}</span>
                    ${fiche ? `<span class="cal-team-rec"><span class="fz-sk-sr">Fiche </span>${echapper(fiche)}</span>` : ''}
                </span>
                <span class="cal-team-score">${echapper(score)}</span>
            </div>`;
    }

    const aCommence = m => !['FUT', 'PRE', 'PPD'].includes(m.state);

    function carteMatch(horaire) {
        const m = etatAffiche(horaire);
        const joue = aCommence(m);
        const a = m.away || {}, h = m.home || {};
        const fini = m.state === 'FINAL' || m.state === 'OFF';
        const miens = [...(mesClubs.get(a.abbrev) || []), ...(mesClubs.get(h.abbrev) || [])];
        const apercu = joue ? null : apercuDe(m.id);
        // Sous les équipes : les buts d'un match commencé ; d'un match à
        // venir, les meneurs des deux clubs, puis mes joueurs qui y sont.
        const cote = joue
            ? carrouselButs(m, fini) + (miens.length ? `<p class="cal-game-mine"><strong>Mes joueurs</strong> · ${miens.map(j => echapper(j.nom)).join(', ')}</p>` : '')
            : carrouselMeneurs(apercu) + (miens.length ? carrouselMesJoueurs(miens) : '');
        const issue = (moi, autre) => (!fini || moi.score === autre.score ? '' : moi.score > autre.score ? 'gagnant' : 'perdant');
        return `
            <article class="cal-game${miens.length ? ' is-mine' : ''}${m.state === 'LIVE' || m.state === 'CRIT' ? ' is-live' : ''}" data-match="${echapper(m.id)}">
                <div class="cal-game-status">${statut(m)}</div>
                <div class="cal-game-teams">
                    ${carteEquipe(a, issue(a, h), joue, apercu && apercu.away.fiche)}
                    ${carteEquipe(h, issue(h, a), joue, apercu && apercu.home.fiche)}
                </div>
                ${cote ? `<div class="cal-game-side">${cote}</div>` : ''}
                ${m.id ? `<div class="cal-game-foot"><a class="cal-game-box" href="match.html?id=${encodeURIComponent(m.id)}">Zone de match</a></div>` : ''}
            </article>`;
    }

    function rendreJour() {
        const titre = document.getElementById('calDayTitle');
        const zone = document.getElementById('calGames');
        const compte = document.getElementById('calSummary');
        const jour = ((semaine && semaine.days) || []).find(d => d.date === jourChoisi);
        titre.textContent = jourChoisi ? jourLong(jourChoisi).replace(/^./, c => c.toUpperCase()) : '';

        const matchs = (jour && jour.games) || [];
        const affiches = filtreActif() ? matchs.filter(estAMoi) : matchs;

        if (!semaine || !semaine.days.length) {
            compte.textContent = '';
            zone.innerHTML = '<p class="cal-empty">Le calendrier de la LNH est indisponible pour le moment. Réessayez dans un instant.</p>';
            return;
        }
        compte.textContent = !matchs.length ? 'Aucun match'
            : filtreActif() ? `${affiches.length} sur ${nMatchs(matchs.length)}`
            : nMatchs(matchs.length);
        if (!affiches.length) {
            zone.innerHTML = `<p class="cal-empty">${matchs.length ? 'Aucun de vos joueurs ne joue ce jour-là.' : 'Aucun match ce jour-là.'}</p>`;
            return;
        }
        // Avant le dessin : une requête qui part dessine ses carrousels en os.
        chargerButs(jourChoisi);
        chargerApercu(jourChoisi);
        // La journée se redessine aussi sans qu'on l'ait demandé — le direct,
        // des buts ou des meneurs qui arrivent. Chaque carrousel garde alors sa
        // place : voir une piste revenir au premier but sous le pouce serait
        // une main sur l'épaule. Un autre jour n'a aucune piste à retrouver.
        const places = new Map();
        document.querySelectorAll('#calGames .cal-car').forEach(car => {
            const carte = car.closest('[data-match]');
            const piste = car.querySelector('.cal-car-track');
            if (carte && piste && piste.scrollLeft) places.set(`${carte.dataset.match}|${car.dataset.car}`, piste.scrollLeft);
        });
        zone.innerHTML = affiches.map(carteMatch).join('');
        places.forEach((x, cle) => {
            const [id, genre] = cle.split('|');
            const piste = document.querySelector(`.cal-game[data-match="${CSS.escape(id)}"] .cal-car[data-car="${genre}"] .cal-car-track`);
            if (piste) piste.scrollLeft = x;
        });
        reglerHorloges();
        majCarrousels();
    }

    /**
     * « 21 – 27 sept. », ou « 28 sept. – 4 oct. » à cheval sur deux mois.
     * Tirée du lundi demandé, pas des jours reçus : une semaine que la LNH
     * n'a pas pu rendre dit quand même laquelle on regarde.
     */
    function rendreSemaine() {
        const el = document.getElementById('calRange');
        if (!el || !lundiVise) return;
        const d1 = dateUTC(lundiVise), d2 = dateUTC(decaler(lundiVise, 6));
        const fin = `${d2.getUTCDate()} ${MOIS_COURTS[d2.getUTCMonth()]}`;
        el.textContent = d1.getUTCMonth() === d2.getUTCMonth()
            ? `${d1.getUTCDate()} – ${fin}`
            : `${d1.getUTCDate()} ${MOIS_COURTS[d1.getUTCMonth()]} – ${fin}`;
        majRetour();
    }

    /**
     * La pastille flottante « Revenir à aujourd’hui » : dès qu'on regarde un
     * autre jour, de cette semaine ou d'une autre — et pendant qu'une autre
     * semaine se charge, quand aucun jour n'est encore choisi.
     */
    function majRetour() {
        const retour = document.getElementById('calReturn');
        if (retour) retour.hidden = jourChoisi === aujourdhui();
    }

    /** Aujourd'hui : sa journée, et sa semaine si on en était parti. Dans la semaine déjà affichée, rien à relire. */
    function allerAujourdhui() {
        const auj = aujourdhui();
        jourChoisi = auj;
        if (semaine && lundiVise === lundiDe(auj) && semaine.days.some(d => d.date === auj)) {
            rendreBande();
            rendreJour();
            return Promise.resolve();
        }
        return chargerSemaine(auj);
    }

    function rendre() {
        rendreSemaine();
        libelleSaison();
        rendreFiltre();
        rendreBande();
        rendreJour();
        document.getElementById('calPrev').disabled = !(semaine && semaine.previousStartDate);
        document.getElementById('calNext').disabled = !(semaine && semaine.nextStartDate);
        reglerSuivi();
    }

    // ---------------------------------------------------------- listes
    //
    // Sous les équipes de chaque match, un carrousel de cartes :
    //   - match commencé : ses buts (GET /day-goals/:date, la feuille de
    //     pointage de la journée, la même que l'accueil) ;
    //   - match à venir : les meneurs des deux clubs cette saison, avec la
    //     fiche des clubs (GET /day-preview/:date, lib/apercuMatchs.js), puis
    //     mes joueurs qui y sont, avec leur saison (/current-stats).

    let buts = { date: null, games: {}, at: 0 };
    let butsEnVol = null;
    const BUTS_FRAIS_MS = 30 * 1000;

    /**
     * Les buts de la journée affichée. Relus toutes les trente secondes tant
     * qu'un match joue, ou qu'un match marqué n'a encore aucun but publié ;
     * une journée sans match commencé n'a rien à demander.
     */
    function chargerButs(date) {
        const jour = ((semaine && semaine.days) || []).find(d => d.date === date);
        const commences = ((jour && jour.games) || []).map(etatAffiche).filter(aCommence);
        if (!date || !commences.length || butsEnVol === date) return;
        const manquant = buts.date === date && commences.some(m =>
            ((m.away && m.away.score) || 0) + ((m.home && m.home.score) || 0) > 0 && !(buts.games[m.id] || []).length);
        if (buts.date === date && (!(commences.some(enJeu) || manquant) || Date.now() - buts.at < BUTS_FRAIS_MS)) return;

        butsEnVol = date;
        // L'âge se compte depuis la demande : ce qui revient est au moins aussi vieux.
        const parti = Date.now();
        fetch(`${BASE_URL}/day-goals/${date}`, { cache: 'no-store' })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null)
            .then(donnees => {
                if (butsEnVol === date) butsEnVol = null;
                if (jourChoisi !== date) return;
                // Sans réponse, les buts déjà en main restent.
                const games = donnees ? donnees.games || {} : (buts.date === date ? buts.games : {});
                buts = { date, games, at: parti };
                rendreJour();
            });
    }

    // L'aperçu des matchs à venir de la journée affichée : la fiche des deux
    // clubs et leurs meneurs de la saison. Une journée lue se garde une
    // demi-heure dans la page ; une lecture ratée se redemande au rendu
    // suivant, mais pas avant une minute.
    const apercus = new Map(); // date → { games, at, ok }
    let apercuEnVol = null;
    const APERCU_FRAIS_MS = 30 * 60 * 1000;
    const APERCU_PAUSE_MS = 60 * 1000;

    function chargerApercu(date) {
        const jour = ((semaine && semaine.days) || []).find(d => d.date === date);
        const aVenir = ((jour && jour.games) || []).map(etatAffiche).some(m => !aCommence(m));
        if (!date || !aVenir || apercuEnVol === date) return;
        const connu = apercus.get(date);
        if (connu && Date.now() - connu.at < (connu.ok ? APERCU_FRAIS_MS : APERCU_PAUSE_MS)) return;

        apercuEnVol = date;
        fetch(`${BASE_URL}/day-preview/${date}`)
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null)
            .then(donnees => {
                if (apercuEnVol === date) apercuEnVol = null;
                const ok = !!(donnees && donnees.games);
                // Sans réponse, l'aperçu déjà en main reste.
                apercus.set(date, { games: ok ? donnees.games : (connu ? connu.games : {}), at: Date.now(), ok });
                if (jourChoisi === date) rendreJour();
            });
    }

    /** L'aperçu d'un match de la journée affichée ; null tant qu'il n'est pas lu. */
    function apercuDe(id) {
        const connu = apercus.get(jourChoisi);
        return (connu && connu.games[id]) || null;
    }

    const idDe = j => (j && j.stats && j.stats.playerId ? String(j.stats.playerId) : null);

    const POSITIONS = { C: 'C', L: 'AG', R: 'AD', D: 'D', G: 'G' };
    const position = p => POSITIONS[p] || p || '';
    const initiales = nom => String(nom || '').split(/\s+/).map(m => m[0] || '').join('').slice(0, 2).toUpperCase();
    /** « (12) » : le total de la saison après ce jeu ; rien plutôt que « (0) ». */
    const compteur = n => (n ? ` <span class="cal-car-tally">(${echapper(n)})</span>` : '');
    /** « 1 But », « 3 Buts » : le singulier jusqu'à un, à la française. */
    const accorder = (n, [un, plusieurs]) => (Number(n) > 1 ? plusieurs : un);

    /**
     * Photo détourée sur un rond à la couleur de son club, comme à la LNH ;
     * les initiales dessous : une photo que le CDN de la LNH n'a pas laisse
     * voir qui c'est, plutôt qu'un rond vide.
     */
    function photo(url, nom, club) {
        const couleur = EQUIPES[club] ? EQUIPES[club][1] : '';
        return `<span class="cal-car-photo${couleur ? ' has-team' : ''}"${couleur ? ` style="--cal-team: ${couleur}"` : ''} aria-hidden="true">`
            + `<span class="cal-car-initials">${echapper(initiales(nom))}</span>`
            + `${url ? `<img src="${echapper(url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
    }

    const FLECHE = d => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;

    /**
     * Une piste qui défile au pouce : la carte suivante dépasse à droite,
     * c'est ce qui dit qu'elle défile. Dessous, comme à la LNH, ‹ un tiret
     * par carte › — celui de la carte en vue à l'accent. Seulement quand la
     * piste déborde (`has-nav`, majCarrousel).
     */
    function carrousel(genre, titre, sous, cartes, etiquette) {
        if (!cartes.length) return '';
        const navigation = cartes.length > 1 ? `
                <div class="cal-car-pager">
                    <button type="button" class="cal-car-arrow is-off" data-car-dir="-1" aria-label="Précédent">${FLECHE('M15 18l-6-6 6-6')}</button>
                    <span class="cal-car-dots" aria-hidden="true">${cartes.map((_, i) => `<i class="cal-car-dot${i ? '' : ' is-on'}"></i>`).join('')}</span>
                    <button type="button" class="cal-car-arrow" data-car-dir="1" aria-label="Suivant">${FLECHE('M9 18l6-6-6-6')}</button>
                </div>` : '';
        return `
            <section class="cal-car" data-car="${genre}" aria-label="${echapper(etiquette)}">
                <div class="cal-car-head">
                    <span class="cal-car-title">${echapper(titre)}</span>
                    ${sous ? `<span class="cal-car-sub">${echapper(sous)}</span>` : ''}
                </div>
                <div class="cal-car-track" tabindex="0">${cartes.join('')}</div>
                ${navigation}
            </section>`;
    }

    /** Le carrousel en os, le temps que sa requête réponde. */
    function carrouselEnOs(genre, titre) {
        const os = '<div class="cal-car-card cal-lead"><span class="fz-bone is-round cal-car-photo"></span>'
            + '<span class="cal-car-id"><span class="fz-bone-flat cal-sk-first"></span><span class="fz-bone cal-sk-name"></span>'
            + '<span class="fz-bone-flat cal-sk-meta"></span></span></div>';
        return `
            <section class="cal-car" data-car="${genre}" aria-hidden="true">
                <div class="cal-car-head"><span class="cal-car-title">${echapper(titre)}</span></div>
                <div class="cal-car-track">${os}${os}</div>
            </section>`;
    }

    /** « 2<sup>e</sup> », « Prol. », « T.B. » : du balisage, tout le reste est échappé. */
    function periodeCourte(n, type) {
        if (type === 'SO') return 'T.B.';
        if (type === 'OT') return 'Prol.';
        return n === 1 ? '1<sup>re</sup>' : n ? `${Number(n)}<sup>e</sup>` : '';
    }

    /**
     * Les buts d'un match commencé. En cours, le plus récent à gauche — on
     * vient voir ce qui vient d'arriver ; fini, du premier au dernier — on
     * relit comment ça s'est joué. La liste arrive dans l'ordre de la LNH et
     * n'est retournée que sur une copie : elle resert au rendu suivant.
     */
    function carrouselButs(m, fini) {
        const marque = ((m.away && m.away.score) || 0) + ((m.home && m.home.score) || 0);
        if (buts.date !== jourChoisi) return marque > 0 && butsEnVol === jourChoisi ? carrouselEnOs('buts', 'Buts') : '';
        const tous = buts.games[m.id] || [];
        if (!tous.length) return '';
        const ordonnes = fini ? tous : tous.slice().reverse();
        const equipes = { away: (m.away && m.away.abbrev) || '', home: (m.home && m.home.abbrev) || '' };
        const miens = new Set([...mesClubs.values()].flat().map(idDe).filter(Boolean));
        return carrousel('buts', 'Buts', fini ? 'Du premier au dernier' : 'Le plus récent d’abord',
            ordonnes.map(b => carteBut(b, equipes, miens)), 'Buts du match');
    }

    /**
     * Qui a marqué (son total de la saison), qui a aidé, et la marque APRÈS
     * ce but : de gauche à droite, la piste raconte la soirée.
     *
     * Un de mes joueurs, buteur ou passeur, a son nom à l'accent. Reconnu par
     * son numéro : la feuille abrège les passeurs (« N. Suzuki »), le pool
     * porte le nom complet. La couleur ne se lit pas à l'oreille : un mot
     * caché le dit aux lecteurs d'écran.
     *
     * Buteur et passeurs ouvrent leur fiche (ouvrirFiche), quand la feuille
     * donne leur numéro.
     */
    function carteBut(b, equipes, miens = new Set()) {
        const nom = (texte, id) => {
            const affiche = id != null && miens.has(String(id))
                ? `<span class="cal-car-mine">${echapper(texte)}<span class="fz-sk-sr"> (mon joueur)</span></span>`
                : echapper(texte);
            return id != null
                ? `<button type="button" class="cal-player" data-player="${echapper(id)}" data-name="${echapper(texte)}">${affiche}</button>`
                : affiche;
        };
        const aides = (b.assists || []).filter(a => a.name);
        const aide = aides.length ? aides.map(a => nom(a.name, a.playerId) + compteur(a.assistsToDate)).join(' et ') : 'Sans aide';
        const marque = b.awayScore != null && b.homeScore != null
            ? `${echapper(equipes.away)} ${echapper(b.awayScore)} - ${echapper(equipes.home)} ${echapper(b.homeScore)}`
            : '';
        const quand = [periodeCourte(b.period, b.periodType), echapper(b.timeInPeriod || '')].filter(Boolean).join(' · ');
        return `
            <div class="cal-car-card cal-goal">
                ${photo(b.headshot, b.name, b.teamAbbrev)}
                <div class="cal-car-id">
                    <div class="cal-car-name">${nom(b.name, b.playerId)}${compteur(b.goalsToDate)}</div>
                    <div class="cal-car-meta">${aide}</div>
                </div>
                ${marque || quand ? `<div class="cal-goal-run">${marque}${quand ? ` <span class="cal-goal-when">${quand}</span>` : ''}</div>` : ''}
            </div>`;
    }

    /**
     * La carte d'un joueur, à la manière de la LNH : la photo sur la couleur
     * de son club, le prénom, le nom en gras — qui ouvre sa fiche —,
     * « CAR • #20 • C » dessous, et à droite le chiffre qui lui vaut la carte.
     */
    function carteJoueur({ id, prenom, nom, complet, url, club, meta, val, libelle }) {
        const nomAffiche = id
            ? `<button type="button" class="cal-player cal-lead-last" data-player="${echapper(id)}" data-name="${echapper(complet)}">${echapper(nom)}</button>`
            : `<span class="cal-lead-last">${echapper(nom)}</span>`;
        return `
            <div class="cal-car-card cal-lead">
                ${photo(url, complet, club)}
                <div class="cal-car-id">
                    <span class="cal-lead-first">${echapper(prenom) || '&nbsp;'}</span>
                    ${nomAffiche}
                    <span class="cal-lead-meta">${echapper(meta.filter(Boolean).join(' • '))}</span>
                </div>
                <div class="cal-lead-stat"><b>${echapper(val)}</b><span>${accorder(val, libelle)}</span></div>
            </div>`;
    }

    const CATEGORIES = { goals: ['But', 'Buts'], assists: ['Aide', 'Aides'], wins: ['Victoire', 'Victoires'] };

    /**
     * Les meneurs des deux clubs cette saison, ceux de la page des pointages
     * de la LNH : buts, aides et victoires, le visiteur avant le receveur. Un
     * meneur à zéro — avant le premier match — n'en est pas un.
     */
    function carrouselMeneurs(apercu) {
        if (!apercu) return apercuEnVol === jourChoisi ? carrouselEnOs('meneurs', 'Meneurs par équipe') : '';
        const cartes = (apercu.meneurs || []).filter(l => l.val > 0 && CATEGORIES[l.cat]).map(l => carteJoueur({
            id: l.id, prenom: l.prenom, nom: l.nom, complet: `${l.prenom} ${l.nom}`.trim(), url: l.photo, club: l.club,
            meta: [l.club, l.numero != null ? `#${l.numero}` : '', position(l.pos)],
            val: l.val, libelle: CATEGORIES[l.cat]
        }));
        return carrousel('meneurs', 'Meneurs par équipe', '', cartes, 'Meneurs des deux clubs cette saison');
    }

    /**
     * Mes joueurs d'un match à venir, en cartes comme les meneurs : leur
     * saison en un chiffre — les points, les victoires d'un gardien. Avant le
     * premier match de la saison, ce sont ceux de l'an passé : le titre le dit.
     */
    function carrouselMesJoueurs(miens) {
        return carrousel('miens', 'Mes joueurs', saisonCommencee ? '' : 'Saison dernière',
            miens.map(carteMonJoueur), 'Mes joueurs dans ce match');
    }

    function carteMonJoueur({ nom, stats }) {
        const s = stats || {};
        const gardien = s.position === 'G';
        const [premier, ...reste] = String(nom).split(' ');
        return carteJoueur({
            id: s.playerId, prenom: reste.length ? premier : '', nom: reste.length ? reste.join(' ') : premier,
            complet: nom, url: s.headshot, club: s.teamAbbrev, meta: [s.teamAbbrev, position(s.position)],
            val: Number(gardien ? s.wins : s.points) || 0,
            libelle: gardien ? ['Victoire', 'Victoires'] : ['Point', 'Points']
        });
    }

    /** Flèches grisées aux deux bouts, puce de la carte en vue. */
    function majCarrousel(car) {
        const piste = car && car.querySelector('.cal-car-track');
        if (!piste) return;
        const max = piste.scrollWidth - piste.clientWidth;
        car.classList.toggle('has-nav', max > 1);
        car.querySelector('[data-car-dir="-1"]')?.classList.toggle('is-off', piste.scrollLeft <= 1);
        car.querySelector('[data-car-dir="1"]')?.classList.toggle('is-off', piste.scrollLeft >= max - 1);
        const puces = car.querySelectorAll('.cal-car-dot');
        if (!puces.length) return;
        const carte = piste.firstElementChild;
        const pas = carte ? carte.offsetWidth + (parseFloat(getComputedStyle(piste).columnGap) || 0) : 0;
        // Au bout de la piste, la dernière carte ne peut pas venir au bord :
        // c'est quand même elle qu'on regarde.
        const i = piste.scrollLeft >= max - 1 ? puces.length - 1
            : Math.min(puces.length - 1, Math.round(piste.scrollLeft / (pas || 1)));
        puces.forEach((p, k) => p.classList.toggle('is-on', k === i));
    }

    function majCarrousels() {
        document.querySelectorAll('#calGames .cal-car').forEach(majCarrousel);
    }

    /** Une carte à la fois : on lit une suite, pas des pages. */
    function defiler(piste, sens) {
        const carte = piste && piste.firstElementChild;
        if (!carte) return;
        const pas = carte.offsetWidth + (parseFloat(getComputedStyle(piste).columnGap) || 0);
        piste.scrollBy({ left: sens * pas, behavior: 'smooth' });
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
        if (!s) {
            // socket.io se charge en `async` (calendrier.html) : la semaine
            // peut le précéder. On repasse quand il aura pu arriver.
            suivreScores.essais = (suivreScores.essais || 0) + 1;
            if (suivreScores.essais <= 40) setTimeout(reglerSuivi, 250);
            return;
        }
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

    /**
     * Redessine la seule rangée d'un match, s'il est à l'écran — sa piste à
     * la même place. Un pointage qui bouge peut vouloir dire un but : les
     * buts de la journée sont redemandés (chargerButs garde sa cadence).
     */
    function majCarte(id) {
        const selecteur = `.cal-game[data-match="${CSS.escape(String(id))}"]`;
        const carte = document.querySelector(selecteur);
        const m = matchsDeLaSemaine().find(x => String(x.id) === String(id));
        if (!carte || !m) return;
        const piste = carte.querySelector('.cal-car-track');
        const x = piste ? piste.scrollLeft : 0;
        carte.outerHTML = carteMatch(m);
        const neuve = document.querySelector(selecteur);
        if (neuve) {
            const nouvelle = neuve.querySelector('.cal-car-track');
            if (nouvelle && x) nouvelle.scrollLeft = x;
            neuve.querySelectorAll('.cal-car').forEach(majCarrousel);
        }
        reglerHorloges();
        chargerButs(jourChoisi);
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

    // ---------------------------------------------------------- fiche joueur
    //
    // La fiche partagée (careerModal.js), comme sur la feuille de match
    // (match.js) : elle demande à la page de dessiner le tableau de carrière
    // (filterCareerStats) et de la refermer (closeCareerModal).

    let carriere = null;

    window.filterCareerStats = function () {
        if (!carriere) return;
        const ligue = document.getElementById('leagueFilter').value;
        const type = document.getElementById('gameTypeFilter').value;
        const rangs = (carriere.seasons || []).filter(s =>
            (ligue === 'all' || (ligue === 'nhl' ? s.league === 'NHL' : s.league !== 'NHL'))
            && (type === 'all' || s.gameType === type));
        const colonnes = [['season', 'Saison'], ['league', 'Ligue'], ['team', 'Équipe'], ['gp', 'MJ'],
            ...(carriere.isGoalie
                ? [['wins', 'V'], ['losses', 'D'], ['otLosses', 'DP'], ['savePct', '% ARR'], ['gaa', 'MBC'], ['shutouts', 'BL']]
                : [['goals', 'B'], ['assists', 'A'], ['points', 'PTS'], ['plusMinus', '+/−'], ['pim', 'PUN'], ['shots', 'Tirs']])];
        document.getElementById('statsCountBadge').textContent =
            `${rangs.length} saison${rangs.length === 1 ? '' : 's'} affichée${rangs.length === 1 ? '' : 's'}`;
        const valeur = (r, k) => k === 'savePct' && r[k] != null ? Number(r[k]).toFixed(3)
            : k === 'gaa' && r[k] != null ? Number(r[k]).toFixed(2) : (r[k] ?? '—');
        document.getElementById('careerStatsTable').innerHTML = rangs.length
            ? `<table><thead><tr>${colonnes.map(([k, l]) => `<th scope="col" class="${echapper(k)}-col">${echapper(l)}</th>`).join('')}</tr></thead><tbody>${rangs.map(r => `<tr>${colonnes.map(([k]) => `<td class="${echapper(k)}-col">${echapper(String(valeur(r, k)))}</td>`).join('')}</tr>`).join('')}</tbody></table>`
            : '<p class="no-stats-message">Aucune statistique correspondant aux filtres sélectionnés.</p>';
    };

    window.closeCareerModal = function () {
        if (typeof fzCloseCareerModal === 'function') fzCloseCareerModal();
        carriere = null;
    };

    function ouvrirFiche(bouton) {
        const id = Number(bouton.dataset.player);
        if (!Number.isInteger(id) || id <= 0 || typeof fzOpenCareerModal !== 'function') return;
        carriere = null;
        fzOpenCareerModal(id, bouton.dataset.name || '', {
            onData(data) { data.isGoalie = data.position === 'G'; carriere = data; },
            renderStats: window.filterCareerStats
        });
    }

    // ---------------------------------------------------------- gestes

    function brancher() {
        document.getElementById('calStrip').addEventListener('click', e => {
            const puce = e.target.closest('[data-jour]');
            if (!puce) return;
            jourChoisi = puce.dataset.jour;
            rendreBande();
            rendreJour();
            // La bande vient d'être redessinée : au clavier (Entrée), le focus
            // reste sur le jour choisi.
            document.querySelector(`.cal-chip[data-jour="${jourChoisi}"]`)?.focus();
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
        // La pastille est le seul chemin vers aujourd'hui : l'en-tête n'a plus
        // de bouton. Elle disparaît sous le doigt : le focus passe au jour
        // d'aujourd'hui plutôt que de retomber sur la page.
        document.getElementById('calReturn').addEventListener('click', () => {
            allerAujourdhui().then(() => document.querySelector('.cal-chip.is-today')?.focus());
        });
        // Le filtre se redessine à chaque choix : le focus revient au bouton
        // pressé plutôt que de retomber sur la page.
        document.getElementById('calFilter').addEventListener('click', e => {
            const bouton = e.target.closest('[data-filtre]');
            if (!bouton || bouton.dataset.filtre === filtre) return;
            filtre = bouton.dataset.filtre;
            try { localStorage.setItem(CLE_FILTRE, filtre); } catch (err) { /* gardé pour cette visite seulement */ }
            rendreFiltre();
            rendreBande();
            rendreJour();
            document.querySelector(`#calFilter [data-filtre="${filtre}"]`)?.focus();
        });
        // Les carrousels se redessinent avec leur match : leurs écouteurs
        // vivent sur la zone des matchs, qui reste. `scroll` ne remonte pas
        // d'un élément à l'autre, d'où l'écoute à la capture.
        const zone = document.getElementById('calGames');
        zone.addEventListener('click', e => {
            const joueur = e.target.closest && e.target.closest('[data-player]');
            if (joueur) return ouvrirFiche(joueur);
            const fleche = e.target.closest && e.target.closest('[data-car-dir]');
            if (!fleche || fleche.classList.contains('is-off')) return;
            defiler(fleche.closest('.cal-car').querySelector('.cal-car-track'), Number(fleche.dataset.carDir));
        });
        zone.addEventListener('scroll', e => {
            const piste = e.target;
            if (piste.classList && piste.classList.contains('cal-car-track')) majCarrousel(piste.closest('.cal-car'));
        }, { capture: true, passive: true });
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
        // Les buts d'un match qui joue : chargerButs ne demande rien tant
        // qu'aucun match de la journée affichée n'en attend.
        setInterval(() => { if (!document.hidden && jourChoisi) chargerButs(jourChoisi); }, BUTS_FRAIS_MS);
        // Une fenêtre élargie peut faire tenir une piste entière : ses flèches s'en vont.
        if (typeof window.addEventListener === 'function') window.addEventListener('resize', majCarrousels);
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
