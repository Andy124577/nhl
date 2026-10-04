/* ============================================================
   CALENDRIER — une page à part entière
   ------------------------------------------------------------
   Le calendrier vivait dans l'accueil, coincé entre la bannière et
   les panneaux : on le cherchait. Il a maintenant son onglet. Même
   source que l'accueil (GET /schedule/:date, une semaine de la LNH
   par appel, avec les dates de la semaine d'avant et d'après), et
   une chose de plus : repérer les matchs où jouent SES joueurs — le
   filtre « Mes joueurs » ne garde qu'eux. À côté de chaque match, une
   liste : ses buts une fois commencé ; à venir, mes joueurs qui y
   sont, ou les meneurs des deux clubs à leurs cinq derniers matchs
   (voir « listes »).

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
     * Nom court et couleur de chaque club. Les couleurs sont celles de la
     * maquette, pas de teamColors.js : éclaircies pour qu'un filet de 3px
     * se voie sur le fond sombre (le marine de WPG, FLA ou EDM y disparaît).
     */
    const EQUIPES = {
        ANA: ['Ducks', '#f07a38'], BOS: ['Bruins', '#e8a812'], BUF: ['Sabres', '#2f5fb5'],
        CAR: ['Hurricanes', '#d11f30'], CBJ: ['Blue Jackets', '#3a5fa8'], CGY: ['Flames', '#e0302a'],
        CHI: ['Blackhawks', '#d0182e'], COL: ['Avalanche', '#9a3d5a'], DAL: ['Stars', '#16a865'],
        DET: ['Red Wings', '#d1283a'], EDM: ['Oilers', '#ff5a14'], FLA: ['Panthers', '#c8263a'],
        LAK: ['Kings', '#9aa2a6'], MIN: ['Wild', '#2e8a5e'], MTL: ['Canadiens', '#b8283a'],
        NJD: ['Devils', '#c81f30'], NSH: ['Predators', '#f2b01c'], NYI: ['Islanders', '#f07d30'],
        NYR: ['Rangers', '#3a64c8'], OTT: ['Senators', '#c52032'], PHI: ['Flyers', '#f75a10'],
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
                    <span class="cal-chip-dot"></span>
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

    /** « dim. » au bureau, « d » au téléphone (calendrier.css), puis le quantième. */
    function jourDeBande(iso) {
        const d = dateUTC(iso);
        const court = JOURS_COURTS[d.getUTCDay()];
        return `<span class="cal-chip-dow"><span class="cal-chip-long">${court}</span><span class="cal-chip-short">${court[0]}</span></span>`
            + `<span class="cal-chip-num">${d.getUTCDate()}</span>`;
    }

    const nMatchs = n => `${n} match${n > 1 ? 's' : ''}`;

    /**
     * Les sept jours. Leur compte suit le filtre : sous « Mes joueurs »,
     * chaque jour dit combien de ses matchs ont un de mes joueurs.
     */
    function rendreBande() {
        const bande = document.getElementById('calStrip');
        const auj = aujourdhui();
        const jours = (semaine && semaine.days) || [];
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
                    <span class="cal-chip-count">${n ? nMatchs(n) : '—'}</span>
                    <span class="cal-chip-dot"></span>
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

    /** « 19 h 00 » ; null tant que la LNH n'a pas d'heure lisible. */
    function heure(iso) {
        const d = iso ? new Date(iso) : null;
        if (!d || Number.isNaN(d.getTime())) return null;
        return d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
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
     * La colonne de l'heure. À venir : l'heure. En cours : « En direct », la
     * période et l'horloge. Fini : « Final », et sa prolongation s'il y en a eu.
     */
    function statut(m) {
        if (m.state === 'LIVE' || m.state === 'CRIT') {
            const quand = [periodeCourte(m.period, m.periodType), horloge(m)].filter(Boolean).join(' · ');
            return '<span class="cal-live"><i aria-hidden="true"></i>En direct</span>'
                + (quand ? `<span class="cal-when">${quand}</span>` : '');
        }
        if (m.state === 'FINAL' || m.state === 'OFF') {
            const prol = m.periodType === 'OT' || m.periodType === 'SO' ? periodeCourte(null, m.periodType) : '';
            return `<span class="cal-time">Final</span>${prol ? `<span class="cal-when">${prol}</span>` : ''}`;
        }
        if (m.state === 'PPD') return '<span class="cal-time is-muted">Reporté</span>';
        const h = heure(m.startTimeUTC);
        return h ? `<span class="cal-time">${echapper(h)}</span>` : '<span class="cal-time is-muted">À confirmer</span>';
    }

    /** Le filet à la couleur du club, le sigle, le nom, la marque ; le perdant en gris. */
    function carteEquipe(t, issue, joue) {
        const abbr = (t && t.abbrev) || '?';
        const [nom, couleur] = EQUIPES[abbr] || ['', ''];
        const score = joue && t && t.score != null ? t.score : '';
        return `
            <div class="cal-team${issue ? ` is-${issue}` : ''}"${couleur ? ` style="--cal-team: ${couleur}"` : ''}>
                <span class="cal-team-bar" aria-hidden="true"></span>
                <span class="cal-team-abbr">${echapper(abbr)}</span>
                <span class="cal-team-name">${echapper(nom)}</span>
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
        // La feuille de match n'existe qu'une fois la rondelle au jeu.
        const feuille = joue && m.id
            ? `<a class="cal-game-box" href="match.html?id=${encodeURIComponent(m.id)}">Feuille de match<span aria-hidden="true">›</span></a>`
            : '';
        // À côté des équipes : les buts d'un match commencé ; d'un match à
        // venir, mes joueurs qui y sont — ou, sans eux, les meneurs des deux
        // clubs à leurs derniers matchs.
        const cote = (joue ? listeButs(m, fini)
            : miens.length ? listeMesJoueurs(miens)
            : listeMeneurs(m))
            + (joue && miens.length ? `<p class="cal-game-mine"><strong>Mes joueurs</strong> · ${miens.map(j => echapper(j.nom)).join(', ')}</p>` : '');
        const issue = (moi, autre) => (!fini || moi.score === autre.score ? '' : moi.score > autre.score ? 'gagnant' : 'perdant');
        return `
            <article class="cal-game${miens.length ? ' is-mine' : ''}${m.state === 'LIVE' || m.state === 'CRIT' ? ' is-live' : ''}" data-match="${echapper(m.id)}">
                <div class="cal-game-status">${statut(m)}</div>
                <div class="cal-game-teams">
                    ${carteEquipe(a, issue(a, h), joue)}
                    ${carteEquipe(h, issue(h, a), joue)}
                </div>
                ${cote ? `<div class="cal-game-side">${cote}</div>` : ''}
                ${feuille}
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
        // Avant le dessin : une requête qui part dessine ses listes en os.
        chargerButs(jourChoisi);
        chargerForme(affiches);
        zone.innerHTML = affiches.map(carteMatch).join('');
        reglerHorloges();
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
    // À côté de chaque match, une rangée par joueur :
    //   - match commencé : ses buts (GET /day-goals/:date, la feuille de
    //     pointage de la journée, la même que l'accueil) ;
    //   - match à venir où j'ai des joueurs : eux, avec leur saison
    //     (/current-stats) et leurs derniers matchs ;
    //   - match à venir sans eux : le meilleur buteur et le meilleur pointeur
    //     de chaque club à ses cinq derniers matchs.
    // Les deux derniers lisent GET /team-form (services/formeClubs.js).

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

    const formeClubs = new Map();     // abrév. → { matchs, buteur, pointeur }
    const formeJoueurs = new Map();   // playerId → sa ligne aux derniers matchs de son club
    const formeDemandee = new Set();  // clubs, et joueurs (« j:<id> »), déjà demandés
    const formeEnVol = new Set();     // clubs et joueurs de la requête en cours
    let formePause = 0;

    const idDe = j => (j && j.stats && j.stats.playerId ? String(j.stats.playerId) : null);

    /**
     * La forme des clubs des matchs à venir de la journée, et celle de mes
     * joueurs qui y jouent — une requête pour tout ce qui manque. Un joueur se
     * lit dans la forme de son club : son club repart avec lui. Une réponse
     * manquée se redemande au rendu suivant, mais pas avant une minute.
     */
    function chargerForme(matchs) {
        if (Date.now() < formePause) return;
        const clubs = new Set();
        const ids = new Map(); // id → club
        matchs.map(etatAffiche).filter(m => !aCommence(m)).forEach(m => {
            [m.away && m.away.abbrev, m.home && m.home.abbrev].forEach(club => {
                if (!club) return;
                if (!formeDemandee.has(club)) clubs.add(club);
                (mesClubs.get(club) || []).forEach(j => {
                    const id = idDe(j);
                    if (id && !formeDemandee.has(`j:${id}`)) { ids.set(id, club); clubs.add(club); }
                });
            });
        });
        if (!clubs.size) return;

        const listeClubs = [...clubs];
        const listeIds = [...ids.keys()];
        listeClubs.forEach(c => { formeDemandee.add(c); formeEnVol.add(c); });
        listeIds.forEach(id => { formeDemandee.add(`j:${id}`); formeEnVol.add(`j:${id}`); });
        const params = new URLSearchParams({ clubs: listeClubs.join(',') });
        if (listeIds.length) params.set('joueurs', listeIds.join(','));
        fetch(`${BASE_URL}/team-form?${params}`)
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null)
            .then(donnees => {
                const recus = (donnees && donnees.clubs) || {};
                const rates = new Set();
                listeClubs.forEach(c => {
                    formeEnVol.delete(c);
                    if (recus[c]) formeClubs.set(c, recus[c]);
                    else { formeDemandee.delete(c); rates.add(c); }
                });
                listeIds.forEach(id => {
                    formeEnVol.delete(`j:${id}`);
                    if (rates.has(ids.get(id))) formeDemandee.delete(`j:${id}`);
                });
                Object.entries((donnees && donnees.joueurs) || {}).forEach(([id, l]) => formeJoueurs.set(String(id), l));
                if (rates.size) formePause = Date.now() + 60 * 1000;
                rendreJour();
            });
    }

    const POSITIONS = { C: 'C', L: 'AG', R: 'AD', D: 'D', G: 'G' };
    const position = p => POSITIONS[p] || p || '';
    const initiales = nom => String(nom || '').split(/\s+/).map(m => m[0] || '').join('').slice(0, 2).toUpperCase();
    const pourcentage = x => (Number(x) > 0 ? Number(x).toFixed(3).replace(/^0/, '') : '—');
    const derniers = n => (n === 1 ? 'Dernier match' : `${n} derniers matchs`);
    /** « (12) » : le total de la saison après ce jeu ; rien plutôt que « (0) ». */
    const compteur = n => (n ? ` <span class="cal-car-tally">(${echapper(n)})</span>` : '');

    /**
     * Photo détourée sur un rond neutre, les initiales dessous : une photo
     * que le CDN de la LNH n'a pas laisse voir qui c'est, plutôt qu'un rond
     * vide.
     */
    function photo(url, nom) {
        return '<span class="cal-car-photo" aria-hidden="true">'
            + `<span class="cal-car-initials">${echapper(initiales(nom))}</span>`
            + `${url ? `<img src="${echapper(url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
    }

    /** Les chiffres d'une rangée, valeur sur libellé ; ceux de `cles` à l'accent. */
    function chiffres(cases, cles) {
        return `<dl class="cal-pl-stats">${cases.map(([l, v]) =>
            `<div${cles.includes(l) ? ' class="is-key"' : ''}><dt>${l}</dt><dd>${echapper(v ?? 0)}</dd></div>`).join('')}</dl>`;
    }

    /** Une liste de rangées, son titre discret au-dessus quand elle en a un. */
    function liste(genre, titre, sous, rangees, etiquette) {
        if (!rangees.length) return '';
        const tete = titre
            ? `<div class="cal-car-head"><span class="cal-car-title">${echapper(titre)}</span>${sous ? `<span class="cal-car-sub">${echapper(sous)}</span>` : ''}</div>`
            : '';
        return `
            <section class="cal-car" data-car="${genre}" aria-label="${echapper(etiquette)}">
                ${tete}
                <div class="cal-car-list">${rangees.join('')}</div>
            </section>`;
    }

    /** La liste en os, le temps que sa requête réponde. */
    function listeEnOs(genre, titre) {
        const os = '<div class="cal-car-card"><span class="fz-bone is-round cal-car-photo"></span>'
            + '<span class="cal-car-id"><span class="fz-bone cal-sk-name"></span><span class="fz-bone-flat cal-sk-meta"></span></span></div>';
        return `
            <section class="cal-car" data-car="${genre}" aria-hidden="true">
                <div class="cal-car-head"><span class="cal-car-title">${echapper(titre)}</span></div>
                <div class="cal-car-list">${os}${os}</div>
            </section>`;
    }

    /** « 2<sup>e</sup> », « Prol. », « T.B. » : du balisage, tout le reste est échappé. */
    function periodeCourte(n, type) {
        if (type === 'SO') return 'T.B.';
        if (type === 'OT') return 'Prol.';
        return n === 1 ? '1<sup>re</sup>' : n ? `${Number(n)}<sup>e</sup>` : '';
    }

    /**
     * Les buts d'un match commencé. En cours, le plus récent en haut — on
     * vient voir ce qui vient d'arriver ; fini, du premier au dernier — on
     * relit comment ça s'est joué. La liste arrive dans l'ordre de la LNH et
     * n'est retournée que sur une copie : elle resert au rendu suivant.
     */
    function listeButs(m, fini) {
        const marque = ((m.away && m.away.score) || 0) + ((m.home && m.home.score) || 0);
        if (buts.date !== jourChoisi) return marque > 0 && butsEnVol === jourChoisi ? listeEnOs('buts', 'Buts') : '';
        const tous = buts.games[m.id] || [];
        if (!tous.length) return '';
        const ordonnes = fini ? tous : tous.slice().reverse();
        const equipes = { away: (m.away && m.away.abbrev) || '', home: (m.home && m.home.abbrev) || '' };
        const miens = new Set([...mesClubs.values()].flat().map(idDe).filter(Boolean));
        return liste('buts', 'Buts', fini ? 'Du premier au dernier' : 'Le plus récent d’abord',
            ordonnes.map(b => carteBut(b, equipes, miens)), 'Buts du match');
    }

    /**
     * Qui a marqué (son total de la saison), qui a aidé, et la marque APRÈS
     * ce but : de haut en bas, la liste raconte la soirée.
     *
     * Un de mes joueurs, buteur ou passeur, a son nom à l'accent. Reconnu par
     * son numéro : la feuille abrège les passeurs (« N. Suzuki »), le pool
     * porte le nom complet. La couleur ne se lit pas à l'oreille : un mot
     * caché le dit aux lecteurs d'écran.
     */
    function carteBut(b, equipes, miens = new Set()) {
        const nom = (texte, id) => (id != null && miens.has(String(id))
            ? `<span class="cal-car-mine">${echapper(texte)}<span class="fz-sk-sr"> (mon joueur)</span></span>`
            : echapper(texte));
        const aides = (b.assists || []).filter(a => a.name);
        const aide = aides.length ? aides.map(a => nom(a.name, a.playerId) + compteur(a.assistsToDate)).join(' et ') : 'Sans aide';
        const marque = b.awayScore != null && b.homeScore != null
            ? `${echapper(equipes.away)} ${echapper(b.awayScore)} - ${echapper(equipes.home)} ${echapper(b.homeScore)}`
            : '';
        const quand = [periodeCourte(b.period, b.periodType), echapper(b.timeInPeriod || '')].filter(Boolean).join(' · ');
        return `
            <div class="cal-car-card">
                ${photo(b.headshot, b.name)}
                <div class="cal-car-id">
                    <div class="cal-car-name">${nom(b.name, b.playerId)}${compteur(b.goalsToDate)}</div>
                    <div class="cal-car-meta">${aide}</div>
                </div>
                ${marque || quand ? `<div class="cal-goal-run">${marque}${quand ? ` <span class="cal-goal-when">${quand}</span>` : ''}</div>` : ''}
            </div>`;
    }

    /**
     * Mes joueurs du match, sans titre : leur rangée dit déjà tout. Avant le
     * premier match de la saison, les chiffres sont ceux de l'an passé, et
     * le titre revient pour le dire.
     */
    function listeMesJoueurs(miens) {
        return liste('miens', saisonCommencee ? '' : 'Mes joueurs', 'Saison dernière',
            miens.map(carteMonJoueur), 'Mes joueurs dans ce match');
    }

    /** Ma rangée de joueur : sa saison en quatre chiffres, sa forme dessous. */
    function carteMonJoueur({ nom, stats }) {
        const s = stats || {};
        const club = s.teamAbbrev || '';
        const gardien = s.position === 'G';
        const cases = gardien
            ? [['PJ', s.gamesPlayed], ['V', s.wins], ['BL', s.shutouts], ['%Arr', pourcentage(s.savePct)]]
            : [['PJ', s.gamesPlayed], ['B', s.goals], ['A', s.assists], ['Pts', s.points]];
        return `
            <div class="cal-car-card">
                ${photo(s.headshot, nom)}
                <div class="cal-car-id">
                    <div class="cal-car-name">${echapper(nom)}</div>
                    <div class="cal-car-meta">${echapper([club, position(s.position)].filter(Boolean).join(' · '))}</div>
                </div>
                ${chiffres(cases, [gardien ? 'V' : 'Pts'])}
                ${ligneForme(s, club, gardien)}
            </div>`;
    }

    /** « 5 derniers matchs · 2 B · 1 A · 3 Pts », ou ce qu'on en sait. */
    function ligneForme(s, club, gardien) {
        const id = s.playerId ? String(s.playerId) : null;
        const f = formeClubs.get(club);
        if (!id || !f || formeEnVol.has(`j:${id}`)) {
            return formeEnVol.has(club) || formeEnVol.has(`j:${id}`) ? '<span class="fz-bone-flat cal-sk-form"></span>' : '';
        }
        if (!f.matchs || !formeDemandee.has(`j:${id}`)) return '';
        const l = formeJoueurs.get(id);
        if (!l) {
            return `<p class="cal-pl-form"><span>${derniers(f.matchs)}</span><b>Pas joué</b></p>`;
        }
        const texte = gardien
            ? `${l.v || 0} V · ${l.tirs ? pourcentage(l.arrets / l.tirs) : '—'}`
            : `${l.b} B · ${l.a} A · ${l.p} Pts`;
        const sur = l.pj < f.matchs ? ` en ${l.pj} PJ` : '';
        return `<p class="cal-pl-form"><span>${derniers(f.matchs)}</span><b>${texte}${sur}</b></p>`;
    }

    /**
     * Le meilleur buteur et le meilleur pointeur de chaque club — une rangée
     * par meneur, une seule quand c'est le même joueur.
     */
    function listeMeneurs(m) {
        const clubs = [m.away && m.away.abbrev, m.home && m.home.abbrev].filter(Boolean);
        if (clubs.some(c => !formeClubs.has(c) && formeEnVol.has(c))) return listeEnOs('meneurs', 'Meneurs');
        const formes = clubs.map(c => [c, formeClubs.get(c)]).filter(([, f]) => f);
        if (!formes.length) return '';

        const rangees = [];
        formes.forEach(([club, { buteur, pointeur }]) => {
            if (buteur && pointeur && buteur.id === pointeur.id) rangees.push(carteMeneur(buteur, club, 'les-deux'));
            else {
                if (buteur) rangees.push(carteMeneur(buteur, club, 'buteur'));
                if (pointeur) rangees.push(carteMeneur(pointeur, club, 'pointeur'));
            }
        });
        if (!rangees.length) {
            const aucun = formes.every(([, f]) => !f.matchs);
            return `
                <section class="cal-car" data-car="meneurs">
                    <div class="cal-car-head"><span class="cal-car-title">Meneurs</span></div>
                    <p class="cal-car-empty">${aucun ? 'Aucun match joué cette saison.' : 'Aucun point aux derniers matchs.'}</p>
                </section>`;
        }
        const n = formes.map(([, f]) => f.matchs);
        const sous = n.every(x => x === n[0]) ? derniers(n[0])
            : `Derniers matchs · ${formes.map(([c, f]) => `${c} ${f.matchs}`).join(' · ')}`;
        return liste('meneurs', 'Meneurs', sous, rangees, 'Meneurs des deux clubs');
    }

    const ROLES = { buteur: 'Meilleur buteur', pointeur: 'Meilleur pointeur', 'les-deux': 'Meilleur buteur et pointeur' };
    const CLES_ROLE = { buteur: ['B'], pointeur: ['Pts'], 'les-deux': ['B', 'Pts'] };

    /** La rangée d'un meneur : ses chiffres aux derniers matchs, celui qui lui vaut sa place à l'accent. */
    function carteMeneur(j, club, role) {
        return `
            <div class="cal-car-card">
                ${photo(j.photo, j.nom)}
                <div class="cal-car-id">
                    <div class="cal-car-name">${echapper(j.nom)}</div>
                    <div class="cal-car-meta">${ROLES[role]} · ${echapper([club, position(j.pos)].filter(Boolean).join(' · '))}</div>
                </div>
                ${chiffres([['PJ', j.pj], ['B', j.b], ['A', j.a], ['Pts', j.p]], CLES_ROLE[role])}
            </div>`;
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
     * Redessine la seule rangée d'un match, s'il est à l'écran. Un pointage
     * qui bouge peut vouloir dire un but : les buts de la journée sont
     * redemandés (chargerButs garde sa cadence).
     */
    function majCarte(id) {
        const carte = document.querySelector(`.cal-game[data-match="${CSS.escape(String(id))}"]`);
        const m = matchsDeLaSemaine().find(x => String(x.id) === String(id));
        if (!carte || !m) return;
        carte.outerHTML = carteMatch(m);
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
        // Aujourd'hui : sa journée, et sa semaine si on en était parti. Dans
        // la semaine déjà affichée, rien à relire.
        document.getElementById('calToday').addEventListener('click', () => {
            const auj = aujourdhui();
            jourChoisi = auj;
            if (semaine && lundiVise === lundiDe(auj) && semaine.days.some(d => d.date === auj)) {
                rendreBande();
                rendreJour();
            } else {
                chargerSemaine(auj);
            }
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
