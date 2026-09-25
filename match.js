/* ============================================================
   FEUILLE DE MATCH — match.html?id=<identifiant LNH>
   ------------------------------------------------------------
   Ce que chaque équipe et chaque joueur a fait pendant un match :
   la feuille de pointage (une ligne par joueur), le résumé (buts,
   pénalités, trois étoiles), et à côté le pointage par période, les
   statistiques d'équipe et les duels de la saison.

   Une seule source : GET /game/:id/boxscore (lib/boxscore.js). Rien
   n'est déduit ni complété ici — une valeur que la LNH ne donne pas
   s'affiche « — ». Un match en cours se relit toutes les 30 secondes.

   Les joueurs du pool actif sont marqués d'une étoile, comme au
   calendrier : leur nom vient du pool, leur identifiant de
   /current-stats.
   ============================================================ */
(function () {
    const BASE_URL = window.location.hostname.includes('localhost')
        ? 'http://localhost:3000'
        : window.location.origin;

    const RELECTURE_MS = 30000;

    const echapper = t => String(t == null ? '' : t)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août',
                         'sept.', 'oct.', 'nov.', 'déc.'];

    const POSITIONS = { C: 'C', L: 'AG', R: 'AD', D: 'D', G: 'G' };
    const DECISIONS = { W: 'V', L: 'D', O: 'DP' };

    /** Les infractions telles que la LNH les nomme (`descKey`), en français. */
    const INFRACTIONS = {
        'tripping': 'Faire trébucher',
        'slashing': 'Cinglage',
        'hooking': 'Accrocher',
        'roughing': 'Rudesse',
        'holding': 'Retenue',
        'holding-the-stick': 'Retenir le bâton',
        'high-sticking': 'Bâton élevé',
        'high-sticking-double-minor': 'Bâton élevé (double mineure)',
        'fighting': 'Bagarre',
        'interference': 'Obstruction',
        'interference-goalkeeper': 'Obstruction sur le gardien',
        'cross-checking': 'Double-échec',
        'elbowing': 'Coup de coude',
        'boarding': 'Mise en échec contre la bande',
        'charging': 'Charge',
        'kneeing': 'Coup de genou',
        'spearing': 'Darder',
        'butt-ending': 'Six pouces',
        'clipping': 'Assaut',
        'illegal-check-to-head': 'Coup à la tête',
        'checking-from-behind': 'Mise en échec par derrière',
        'misconduct': 'Inconduite',
        'game-misconduct': 'Inconduite de match',
        'match-penalty': 'Pénalité de match',
        'abuse-of-officials': 'Abus envers les officiels',
        'unsportsmanlike-conduct': 'Conduite antisportive',
        'embellishment': 'Embellissement',
        'instigator': 'Instigateur',
        'instigator-misconduct': 'Instigateur (inconduite)',
        'too-many-men-on-the-ice': 'Trop de joueurs sur la glace',
        'delaying-game': 'Retarder le match',
        'delaying-game-puck-over-glass': 'Retarder le match (rondelle hors jeu)',
        'delaying-game-unsuccessful-challenge': 'Contestation refusée',
        'delaying-game-smothering-puck': 'Retarder le match (rondelle immobilisée)',
        'delaying-game-illegal-play-by-goalie': 'Jeu illégal du gardien',
        'delaying-game-face-off-violation': 'Retarder le match (mise en jeu)',
        'roughing-removing-opponents-helmet': 'Rudesse (casque retiré)',
        'ps-hooking-on-breakaway': 'Accrocher sur une échappée (tir de pénalité)',
        'ps-slash-on-breakaway': 'Cinglage sur une échappée (tir de pénalité)',
        'ps-holding-on-breakaway': 'Retenue sur une échappée (tir de pénalité)',
        'ps-tripping-on-breakaway': 'Faire trébucher sur une échappée (tir de pénalité)'
    };

    /** Les colonnes des patineurs : clé de la ligne, en-tête, sens complet. */
    const COLONNES_PATINEURS = [
        ['position', 'POS', 'Position (C centre, AG ailier gauche, AD ailier droit)'],
        ['goals', 'B', 'Buts'],
        ['assists', 'A', 'Aides'],
        ['points', 'PTS', 'Points'],
        ['plusMinus', '+/−', 'Différentiel'],
        ['sog', 'T', 'Tirs au but'],
        ['pim', 'PUN', 'Minutes de pénalité'],
        ['powerPlayGoals', 'BAN', 'Buts en avantage numérique'],
        ['hits', 'MÉ', 'Mises en échec'],
        ['blockedShots', 'TB', 'Tirs bloqués'],
        ['giveaways', 'REV', 'Revirements'],
        ['takeaways', 'REVP', 'Revirements provoqués'],
        ['shifts', 'PRÉS', 'Présences'],
        ['toi', 'TG', 'Temps de glace']
    ];

    const COLONNES_GARDIENS = [
        ['shotsAgainst', 'TC', 'Tirs contre'],
        ['saves', 'ARR', 'Arrêts'],
        ['goalsAgainst', 'BC', 'Buts contre'],
        ['savePct', '% ARR', 'Pourcentage d’arrêts'],
        ['evenStrength', 'FÉ', 'Arrêts / tirs à forces égales'],
        ['powerPlay', 'AN', 'Arrêts / tirs en désavantage numérique de son équipe'],
        ['shortHanded', 'DN', 'Arrêts / tirs en avantage numérique de son équipe'],
        ['toi', 'TG', 'Temps de glace'],
        ['decision', 'DÉC', 'Décision (V victoire, D défaite, DP défaite en prolongation)']
    ];

    const STATS_EQUIPE = {
        sog: 'Tirs au but',
        faceoffPct: 'Mises en jeu',
        powerPlayPct: 'Avantage numérique',
        pim: 'Minutes de pénalité',
        hits: 'Mises en échec',
        blockedShots: 'Tirs bloqués',
        giveaways: 'Revirements',
        takeaways: 'Revirements provoqués'
    };

    let feuille = null;
    let erreur = null;           // { introuvable } quand la lecture échoue
    let onglet = 'feuille';      // 'feuille' | 'resume'
    let cote = null;             // 'away' | 'home' — choisi une fois la feuille lue
    let mesJoueurs = new Set();  // identifiants LNH des joueurs du pool actif
    let minuterie = null;
    let lecture = 0;

    const gameId = new URLSearchParams(window.location.search).get('id') || '';

    // ---------------------------------------------------------- données

    async function charger({ silencieux = false } = {}) {
        const jeton = ++lecture;
        if (!/^\d{10}$/.test(gameId)) {
            erreur = { introuvable: true };
            return rendre();
        }
        try {
            const reponse = await fetch(`${BASE_URL}/game/${gameId}/boxscore`, { cache: 'no-store' });
            if (jeton !== lecture) return;
            if (reponse.status === 404) { erreur = { introuvable: true }; feuille = null; return rendre(); }
            if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
            feuille = await reponse.json();
            erreur = null;
        } catch (e) {
            if (jeton !== lecture) return;
            // Une relecture ratée pendant un match garde la dernière feuille
            // affichée : mieux vaut 30 secondes de retard qu'une page vide.
            if (silencieux && feuille) return planifier();
            erreur = { introuvable: false };
        }
        rendre();
        planifier();
    }

    function enDirect(f) {
        return !!f && (f.state === 'LIVE' || f.state === 'CRIT');
    }

    /** Relit la feuille pendant le match, et à l'approche de la mise au jeu. */
    function planifier() {
        clearTimeout(minuterie);
        if (!feuille) return;
        const bientot = (feuille.state === 'FUT' || feuille.state === 'PRE')
            && feuille.startTimeUTC && (new Date(feuille.startTimeUTC) - Date.now()) < 10 * 60000;
        if (!enDirect(feuille) && !bientot) return;
        minuterie = setTimeout(() => {
            if (document.hidden) return planifier();
            charger({ silencieux: true });
        }, RELECTURE_MS);
    }

    /** Les identifiants LNH des joueurs de mon équipe dans le pool actif. */
    async function chargerMesJoueurs() {
        if (!window.FZPool) return;
        try { await FZPool.ready(); } catch (e) { return; }
        const equipe = FZPool.team();
        if (!equipe || !equipe.data) { mesJoueurs = new Set(); return rendre(); }
        const nomDe = p => (typeof p === 'string') ? p : (p && (p.skaterFullName || p.goalieFullName)) || null;
        const noms = new Set(['offensive', 'defensive', 'goalie', 'rookie']
            .flatMap(c => (equipe.data[c] || []).map(nomDe)).filter(Boolean));
        if (!noms.size) { mesJoueurs = new Set(); return rendre(); }
        try {
            const reponse = await fetch(`${BASE_URL}/current-stats`, { cache: 'no-store' });
            const stats = reponse.ok ? await reponse.json() : null;
            mesJoueurs = new Set(((stats && stats.players) || [])
                .filter(p => noms.has(p.playerName) && p.playerId)
                .map(p => Number(p.playerId)));
        } catch (e) { /* les étoiles restent simplement absentes */ }
        rendre();
    }

    // ---------------------------------------------------------- couleurs

    /**
     * Une couleur par équipe, lisible sur la carte du thème courant, et
     * distincte de celle de l'adversaire. Le bleu marine d'Edmonton
     * disparaît sur le fond sombre : on passe à sa seconde couleur. Deux
     * clubs presque de la même teinte (Toronto et Tampa Bay) : le club
     * local prend son autre couleur, ou un gris neutre.
     */
    function couleursDuMatch(away, home) {
        const fond = (getComputedStyle(document.documentElement).getPropertyValue('--card') || '').trim() || '#1E1E22';
        const lum = typeof hexLuminance === 'function' ? hexLuminance : () => 0.1;
        const nuance = typeof shadeHex === 'function' ? shadeHex : h => h;
        const paire = typeof getTeamColors === 'function' ? getTeamColors : () => ['#8C8C95', '#8C8C95'];
        const contraste = (a, b) => {
            const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
            return (x + 0.05) / (y + 0.05);
        };
        const sombre = lum(fond) < 0.2;
        const lisible = hex => {
            let c = hex;
            for (let i = 0; i < 8 && contraste(c, fond) < 3; i++) c = nuance(c, sombre ? 0.15 : -0.15);
            return c;
        };
        const ordre = abbr => {
            const [p, s] = paire(abbr);
            return contraste(p, fond) >= 1.6 ? [p, s] : [s, p];
        };
        const ecart = (a, b) => {
            const rgb = h => [1, 3, 5].map(i => parseInt(String(h).slice(i, i + 2), 16) || 0);
            const [x, y] = [rgb(a), rgb(b)];
            return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
        };
        const [a1] = ordre(away);
        const [h1, h2] = ordre(home);
        const A = lisible(a1);
        let H = lisible(h1);
        if (ecart(A, H) < 90) {
            const autre = lisible(h2);
            H = ecart(A, autre) >= 90 ? autre : lisible('#8C8C95');
        }
        return { away: A, home: H };
    }

    // ---------------------------------------------------------- formats

    const dateUTC = iso => new Date(`${iso}T12:00:00Z`);

    function dateLongue(iso) {
        if (!iso) return '';
        const d = dateUTC(iso);
        const texte = d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
        return texte.charAt(0).toUpperCase() + texte.slice(1);
    }

    /** La date en toutes lettres sur grand écran, « 24 sept. » sur téléphone. */
    const jourHTML = iso => `<span class="mt-long">${echapper(dateLongue(iso))}</span><span class="mt-short">${echapper(dateCourte(iso))}</span>`;

    const dateCourte = iso => {
        if (!iso) return '';
        const d = dateUTC(iso);
        return `${d.getUTCDate()} ${MOIS_COURTS[d.getUTCMonth()]}`;
    };

    function heure(iso) {
        if (!iso) return 'Heure à confirmer';
        return new Date(iso).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
    }

    /** « 1re période », « Prolongation », « 2e prolongation », « Tirs de barrage ». */
    function nomPeriode(p) {
        if (p.type === 'SO') return 'Tirs de barrage';
        if (p.type === 'OT') {
            const n = (p.number || 4) - 3;
            return n <= 1 ? 'Prolongation' : `${n}e prolongation`;
        }
        return p.number === 1 ? '1re période' : `${p.number}e période`;
    }

    /** L'en-tête court d'une colonne de période : 1, 2, 3, PR, 2PR, TB. */
    function colonnePeriode(p) {
        if (p.type === 'SO') return 'TB';
        if (p.type === 'OT') {
            const n = (p.number || 4) - 3;
            return n <= 1 ? 'PR' : `${n}PR`;
        }
        return String(p.number);
    }

    const pct = v => v == null ? '—' : `${Math.round(v * 100)} %`;
    const signe = v => v == null ? '—' : v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0';
    const tiret = v => (v == null || v === '') ? '—' : v;

    function logo(abbr, classe = '') {
        return `<img class="${classe}" src="teams/${echapper(abbr)}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
    }

    function joueurHTML(id, nom) {
        const moi = id && mesJoueurs.has(Number(id));
        const etoile = moi ? '<span class="mt-mine" title="Dans votre équipe" aria-label="Dans votre équipe">★</span>' : '';
        if (!id) return `<span class="mt-player-name">${echapper(nom)}</span>${etoile}`;
        return `<button type="button" class="mt-player" data-player="${echapper(id)}" data-name="${echapper(nom)}">${echapper(nom)}</button>${etoile}`;
    }

    // ---------------------------------------------------------- en-tête

    function statutHTML(f) {
        if (enDirect(f)) {
            const c = f.clock || {};
            const p = { number: f.period, type: f.periodType };
            const court = p.type === 'SO' ? 'Tirs de barrage'
                : p.type === 'OT' ? nomPeriode(p)
                : p.number === 1 ? '1re' : `${p.number}e`;
            const quand = c.inIntermission ? `Entracte · ${nomPeriode(p)}`
                : p.type === 'SO' ? court
                : `${court} · ${c.timeRemaining || ''}`;
            return `<span class="mt-pill is-live"><i aria-hidden="true"></i>En direct</span>
                    <span class="mt-when">${echapper(quand)}</span>`;
        }
        if (f.state === 'FINAL' || f.state === 'OFF') {
            const suffixe = f.lastPeriodType === 'OT' ? ' (prol.)' : f.lastPeriodType === 'SO' ? ' (t.b.)' : '';
            return `<span class="mt-pill">Final${suffixe}</span>
                    <span class="mt-when">${jourHTML(f.gameDate)}</span>`;
        }
        if (f.state === 'PPD') {
            return `<span class="mt-pill">Reporté</span><span class="mt-when">${jourHTML(f.gameDate)}</span>`;
        }
        return `<span class="mt-pill is-soon">${echapper(heure(f.startTimeUTC))}</span>
                <span class="mt-when">${jourHTML(f.gameDate)}</span>`;
    }

    /**
     * Les jetons du bandeau d'un club — les mêmes que la fiche du joueur
     * (teamBannerTokens, teamColors.js) : le tableau d'affichage reste sur
     * fond noir dans les deux thèmes, comme elle.
     */
    function bandeau(abbr) {
        if (typeof teamBannerTokens === 'function') return teamBannerTokens(abbr);
        return { surface: '#3a414d', edge: '#8995a8', trim: '#8995a8', crest: null };
    }

    function equipeHTML(f, c, jetons) {
        const t = f[c];
        const src = jetons.crest || `teams/${t.abbrev}.png`;
        return `
            <div class="mt-team is-${c}">
                <img class="mt-logo" src="${echapper(src)}" alt="" onerror="this.style.visibility='hidden'">
                <div class="mt-team-id">
                    <span class="mt-team-name"><span class="mt-long">${echapper(t.name || t.abbrev)}</span><span class="mt-short">${echapper(t.abbrev)}</span></span>
                    ${t.place ? `<span class="mt-team-place">${echapper(t.place)}</span>` : ''}
                    ${t.sog != null ? `<span class="mt-team-sog">Tirs ${t.sog}</span>` : ''}
                </div>
            </div>`;
    }

    function tableauHTML(f) {
        const joue = f.started && f.away.score != null && f.home.score != null;
        const fini = f.state === 'FINAL' || f.state === 'OFF';
        const perd = c => fini && f[c].score < f[c === 'away' ? 'home' : 'away'].score;
        const marque = c => joue ? `<span class="mt-score is-${c}${perd(c) ? ' is-loser' : ''}">${f[c].score}</span>` : '';
        const titre = joue
            ? `${f.away.name || f.away.abbrev} ${f.away.score}, ${f.home.name || f.home.abbrev} ${f.home.score}`
            : `${f.away.name || f.away.abbrev} contre ${f.home.name || f.home.abbrev}`;
        const jetons = { away: bandeau(f.away.abbrev), home: bandeau(f.home.abbrev) };
        // Les couleurs sortent de la table des clubs, le crest d'un chemin
        // bâti sur une abréviation connue : rien du réseau n'entre dans le style.
        const style = ['away', 'home'].map(c => {
            const j = jetons[c];
            return `--${c}-surface:${j.surface};--${c}-edge:${j.edge};--${c}-trim:${j.trim};--${c}-crest:${j.crest ? `url('${j.crest}')` : 'none'}`;
        }).join(';');
        return `
            <section class="mt-board" style="${echapper(style)}" aria-label="${echapper(titre)}">
                ${equipeHTML(f, 'away', jetons.away)}
                <div class="mt-plate${joue ? '' : ' is-pregame'}">
                    ${marque('away')}
                    <div class="mt-status">${statutHTML(f)}</div>
                    ${marque('home')}
                </div>
                ${equipeHTML(f, 'home', jetons.home)}
            </section>`;
    }

    // ---------------------------------------------------------- feuille

    function cellule(ligne, cle) {
        const v = ligne[cle];
        switch (cle) {
            case 'position': return POSITIONS[v] || tiret(v);
            case 'plusMinus': return signe(v);
            case 'savePct': return v == null ? '—' : v.toFixed(3).replace(/^0/, '');
            case 'decision': return v ? (DECISIONS[v] || v) : '—';
            default: return tiret(v);
        }
    }

    /** Un zéro reste lisible mais passe au second plan : l'œil trouve ce qui a compté. */
    const estNul = v => v === 0 || v === '0' || v === '00:00';

    function tableJoueursHTML(titre, lignes, colonnes, { gardiens = false } = {}) {
        if (!lignes.length) return '';
        const entetes = colonnes.map(([, court, long]) =>
            `<th scope="col"><abbr title="${echapper(long)}">${echapper(court)}</abbr></th>`).join('');
        const rangs = lignes.map(l => {
            const absent = gardiens && !l.played;
            const moi = l.playerId && mesJoueurs.has(Number(l.playerId));
            const cellules = colonnes.map(([cle]) => {
                const v = absent && cle !== 'decision' ? null : l[cle];
                const brut = absent ? '—' : cellule(l, cle);
                return `<td class="${estNul(v) ? 'is-zero' : ''}${cle === 'points' ? ' is-key' : ''}">${echapper(brut)}</td>`;
            }).join('');
            return `
                <tr class="${moi ? 'is-mine' : ''}${absent ? ' is-idle' : ''}">
                    <th scope="row"><span class="mt-num">${echapper(tiret(l.number))}</span>${joueurHTML(l.playerId, l.name)}${absent ? '<span class="mt-idle">N’a pas joué</span>' : ''}</th>
                    ${cellules}
                </tr>`;
        }).join('');
        return `
            <div class="mt-scroll" data-scroll="${echapper(titre)}">
                <table class="mt-table">
                    <thead><tr><th scope="col" class="mt-group">${echapper(titre)}</th>${entetes}</tr></thead>
                    <tbody>${rangs}</tbody>
                </table>
            </div>`;
    }

    function feuilleHTML(f) {
        if (!f.players) return '<p class="mt-empty">La feuille de pointage n’est pas disponible pour ce match.</p>';
        const t = f.players[cote] || { forwards: [], defense: [], goalies: [] };
        const parNumero = l => l.slice().sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
        const sansPosition = COLONNES_PATINEURS.filter(([cle]) => cle !== 'position');
        const compteMiens = c => {
            const p = f.players[c];
            return p ? [...p.forwards, ...p.defense, ...p.goalies].filter(l => mesJoueurs.has(Number(l.playerId))).length : 0;
        };
        const bouton = c => {
            const n = compteMiens(c);
            return `<button type="button" class="mt-seg-btn" data-cote="${c}" aria-pressed="${c === cote}">
                        ${logo(f[c].abbrev, 'mt-seg-logo')}<span>${echapper(f[c].name || f[c].abbrev)}</span>
                        ${n ? `<span class="mt-seg-mine" title="${n} de vos joueurs">★ ${n}</span>` : ''}
                    </button>`;
        };
        const tables = tableJoueursHTML('Attaquants', parNumero(t.forwards), COLONNES_PATINEURS)
            + tableJoueursHTML('Défenseurs', parNumero(t.defense), sansPosition)
            + tableJoueursHTML('Gardiens', parNumero(t.goalies), COLONNES_GARDIENS, { gardiens: true });
        const legende = [...COLONNES_PATINEURS, ...COLONNES_GARDIENS.filter(([cle]) => !['toi'].includes(cle))]
            .map(([, court, long]) => `<div><dt>${echapper(court)}</dt><dd>${echapper(long)}</dd></div>`).join('');
        return `
            <div class="mt-seg" role="group" aria-label="Choisir l’équipe">${bouton('away')}${bouton('home')}</div>
            ${tables || '<p class="mt-empty">Aucune ligne de joueur pour cette équipe.</p>'}
            <details class="mt-legend">
                <summary>Légende des colonnes</summary>
                <dl>${legende}</dl>
            </details>`;
    }

    // ---------------------------------------------------------- résumé

    function etoilesHTML(f) {
        if (!f.threeStars.length) return '';
        const ligne = e => e.position === 'G'
            ? [e.savePct != null ? `${e.savePct.toFixed(3).replace(/^0/, '')} % arr.` : '', e.goalsAgainstAverage != null ? `${e.goalsAgainstAverage.toFixed(2)} MBC` : ''].filter(Boolean).join(' · ')
            : [e.goals != null ? `${e.goals} B` : '', e.assists != null ? `${e.assists} A` : ''].filter(Boolean).join(' · ');
        return `
            <section class="mt-block">
                <h3 class="mt-block-title">Trois étoiles</h3>
                <ol class="mt-stars">
                    ${f.threeStars.map(e => `
                        <li class="mt-star">
                            <span class="mt-star-rank" aria-label="${e.star}e étoile">${'★'.repeat(e.star || 1)}</span>
                            <span class="mt-star-photo">${e.headshot ? `<img src="${echapper(e.headshot)}" alt="" onerror="this.remove()">` : ''}${logo(e.teamAbbrev, 'mt-star-team')}</span>
                            <span class="mt-star-name">${joueurHTML(e.playerId, e.name)}</span>
                            <span class="mt-star-line">${echapper(ligne(e))}</span>
                        </li>`).join('')}
                </ol>
            </section>`;
    }

    function situation(b) {
        const tags = [];
        if (b.strength === 'pp') tags.push(['AN', 'Avantage numérique']);
        if (b.strength === 'sh') tags.push(['DN', 'Désavantage numérique']);
        if (b.modifier === 'empty-net' || b.modifier === 'awarded-empty-net') tags.push(['FD', 'Filet désert']);
        if (b.modifier === 'penalty-shot') tags.push(['TP', 'Tir de pénalité']);
        if (b.modifier === 'own-goal') tags.push(['CSC', 'Dans son propre filet']);
        return tags.map(([c, l]) => `<abbr class="mt-tag" title="${l}">${c}</abbr>`).join('');
    }

    function butsHTML(f) {
        if (!f.scoring.length) return '';
        const periodes = f.scoring.map(p => {
            const rangs = p.goals.map(b => {
                const aides = b.assists.length
                    ? b.assists.map(a => `${joueurHTML(a.playerId, a.name)}${a.assistsToDate != null ? ` <span class="mt-count">(${a.assistsToDate})</span>` : ''}`).join(', ')
                    : 'Sans aide';
                return `
                    <li class="mt-event">
                        <span class="mt-event-time">${echapper(b.timeInPeriod)}</span>
                        ${logo(b.teamAbbrev, 'mt-event-logo')}
                        <div class="mt-event-body">
                            <div class="mt-event-main">${joueurHTML(b.playerId, b.name)}${b.goalsToDate != null ? ` <span class="mt-count">(${b.goalsToDate})</span>` : ''}${situation(b)}</div>
                            <div class="mt-event-sub">${aides}</div>
                        </div>
                        ${b.awayScore != null ? `<span class="mt-event-score">${b.awayScore}–${b.homeScore}</span>` : ''}
                    </li>`;
            }).join('');
            return `
                <div class="mt-period">
                    <h4 class="mt-period-title">${echapper(nomPeriode(p))}</h4>
                    ${rangs ? `<ol class="mt-events">${rangs}</ol>` : '<p class="mt-none">Aucun but</p>'}
                </div>`;
        }).join('');
        return `<section class="mt-block"><h3 class="mt-block-title">Buts</h3>${periodes}</section>`;
    }

    function barrageHTML(f) {
        if (!f.shootout.length) return '';
        const resultat = { goal: 'But', save: 'Arrêt', miss: 'Raté' };
        return `
            <section class="mt-block">
                <h3 class="mt-block-title">Tirs de barrage</h3>
                <ol class="mt-events">
                    ${f.shootout.map((t, i) => `
                        <li class="mt-event${t.result === 'goal' ? ' is-goal' : ''}">
                            <span class="mt-event-time">${i + 1}</span>
                            ${logo(t.teamAbbrev, 'mt-event-logo')}
                            <div class="mt-event-body"><div class="mt-event-main">${joueurHTML(t.playerId, t.name)}${t.gameWinner ? '<abbr class="mt-tag" title="But décisif">BD</abbr>' : ''}</div></div>
                            <span class="mt-event-result">${echapper(resultat[t.result] || t.result || '—')}</span>
                        </li>`).join('')}
                </ol>
            </section>`;
    }

    function infraction(p) {
        if (INFRACTIONS[p.descKey]) return INFRACTIONS[p.descKey];
        const brut = String(p.descKey || '').replace(/-/g, ' ');
        return brut ? brut.charAt(0).toUpperCase() + brut.slice(1) : 'Pénalité';
    }

    function penalitesHTML(f) {
        const total = f.penalties.reduce((n, p) => n + p.penalties.length, 0);
        if (!f.penalties.length) return '';
        const periodes = f.penalties.map(p => {
            const rangs = p.penalties.map(x => {
                const qui = x.player || (x.servedBy ? `Banc (purgée par ${x.servedBy})` : 'Banc');
                return `
                    <li class="mt-event">
                        <span class="mt-event-time">${echapper(x.timeInPeriod)}</span>
                        ${logo(x.teamAbbrev, 'mt-event-logo')}
                        <div class="mt-event-body">
                            <div class="mt-event-main">${echapper(qui)}</div>
                            <div class="mt-event-sub">${echapper(infraction(x))}</div>
                        </div>
                        <span class="mt-event-result">${x.duration != null ? `${x.duration} min` : ''}</span>
                    </li>`;
            }).join('');
            return `
                <div class="mt-period">
                    <h4 class="mt-period-title">${echapper(nomPeriode(p))}</h4>
                    ${rangs ? `<ol class="mt-events">${rangs}</ol>` : '<p class="mt-none">Aucune pénalité</p>'}
                </div>`;
        }).join('');
        return `<section class="mt-block"><h3 class="mt-block-title">Pénalités${total ? ` <span class="mt-count">(${total})</span>` : ''}</h3>${periodes}</section>`;
    }

    function resumeHTML(f) {
        const contenu = etoilesHTML(f) + butsHTML(f) + barrageHTML(f) + penalitesHTML(f);
        return contenu || '<p class="mt-empty">Le résumé du match n’est pas encore disponible.</p>';
    }

    // ---------------------------------------------------------- colonne

    function parPeriodeHTML(titre, periodes, totaux, f) {
        if (!periodes.length) return '';
        const ligne = c => `
            <tr>
                <th scope="row">${logo(f[c].abbrev, 'mt-mini-logo')}<span>${echapper(f[c].abbrev)}</span></th>
                ${periodes.map(p => `<td>${tiret(p[c])}</td>`).join('')}
                <td class="is-total">${tiret(totaux[c])}</td>
            </tr>`;
        return `
            <section class="mt-card">
                <h3 class="mt-card-title">${echapper(titre)}</h3>
                <table class="mt-lines">
                    <thead><tr><th scope="col"><span class="mt-sr">Équipe</span></th>${periodes.map(p => `<th scope="col"><abbr title="${echapper(nomPeriode(p))}">${echapper(colonnePeriode(p))}</abbr></th>`).join('')}<th scope="col"><abbr title="Total">T</abbr></th></tr></thead>
                    <tbody>${ligne('away')}${ligne('home')}</tbody>
                </table>
            </section>`;
    }

    function pointageHTML(f) {
        if (!f.linescore) return '';
        return parPeriodeHTML('Pointage', f.linescore.periods, f.linescore.totals, f);
    }

    function tirsHTML(f) {
        // La période de barrage n'a pas de tirs au but : la LNH y met 0-0.
        const periodes = f.shotsByPeriod.filter(p => p.type !== 'SO');
        const somme = c => periodes.every(p => p[c] == null) ? null : periodes.reduce((n, p) => n + (p[c] || 0), 0);
        return parPeriodeHTML('Tirs au but', periodes, { away: somme('away'), home: somme('home') }, f);
    }

    function statsHTML(f) {
        if (!f.teamStats.length) return '';
        const lignes = f.teamStats.map(s => {
            const enPct = s.key === 'faceoffPct' || s.key === 'powerPlayPct';
            const val = v => enPct ? pct(v) : tiret(v);
            const a = Math.max(0, s.away || 0), h = Math.max(0, s.home || 0);
            const parts = a + h > 0 ? [a, h] : [1, 1];
            return `
                <div class="mt-stat${a + h > 0 ? '' : ' is-even'}">
                    <div class="mt-stat-row">
                        <span class="mt-stat-val">${val(s.away)}</span>
                        <span class="mt-stat-lbl">${echapper(STATS_EQUIPE[s.key] || s.key)}</span>
                        <span class="mt-stat-val">${val(s.home)}</span>
                    </div>
                    <div class="mt-stat-bar" style="grid-template-columns:${parts[0]}fr ${parts[1]}fr" aria-hidden="true">
                        <i class="is-away${a ? '' : ' is-nil'}"></i><i class="is-home${h ? '' : ' is-nil'}"></i>
                    </div>
                    ${s.detail ? `<div class="mt-stat-detail"><span>${echapper(s.detail.away)}</span><span>${echapper(s.detail.home)}</span></div>` : ''}
                </div>`;
        }).join('');
        return `
            <section class="mt-card">
                <h3 class="mt-card-title mt-card-title-teams">
                    ${logo(f.away.abbrev, 'mt-mini-logo')}<span>Statistiques du match</span>${logo(f.home.abbrev, 'mt-mini-logo')}
                </h3>
                ${lignes}
            </section>`;
    }

    function serieHTML(f) {
        if (!f.seasonSeries.length) return '';
        const v = f.seasonSeriesWins;
        let bilan = '';
        if (v && v.away != null && v.home != null) {
            bilan = v.away === v.home ? `Égalité ${v.away}-${v.home}`
                : v.away > v.home ? `${f.away.abbrev} mène ${v.away}-${v.home}`
                : `${f.home.abbrev} mène ${v.home}-${v.away}`;
        }
        const carte = m => {
            const joue = ['LIVE', 'CRIT', 'FINAL', 'OFF'].includes(m.state);
            const fini = m.state === 'FINAL' || m.state === 'OFF';
            const suffixe = m.lastPeriodType === 'OT' ? ' (prol.)' : m.lastPeriodType === 'SO' ? ' (t.b.)' : '';
            const statut = fini ? `Final${suffixe}` : joue ? 'En direct' : m.state === 'PPD' ? 'Reporté' : heure(m.startTimeUTC);
            const ce = String(m.id) === String(f.id);
            const rang = c => {
                const perd = fini && m[c].score != null && m[c].score < m[c === 'away' ? 'home' : 'away'].score;
                return `<span class="mt-duel-team${perd ? ' is-loser' : ''}">${logo(m[c].abbrev, 'mt-mini-logo')}<b>${echapper(m[c].abbrev)}</b>${joue && m[c].score != null ? `<span class="mt-duel-score">${m[c].score}</span>` : ''}</span>`;
            };
            const corps = `${rang('away')}${rang('home')}<span class="mt-duel-meta"><span>${echapper(statut)}</span><span>${echapper(dateCourte(m.gameDate))}</span></span>`;
            if (ce) return `<li class="mt-duel is-current" aria-current="page">${corps}<span class="mt-duel-here">Ce match</span></li>`;
            return joue && m.id
                ? `<li><a class="mt-duel" href="match.html?id=${encodeURIComponent(m.id)}">${corps}</a></li>`
                : `<li class="mt-duel">${corps}</li>`;
        };
        return `
            <section class="mt-card">
                <h3 class="mt-card-title mt-card-title-split"><span>Duels cette saison</span>${bilan ? `<span class="mt-card-note">${echapper(bilan)}</span>` : ''}</h3>
                <ol class="mt-duels">${f.seasonSeries.map(carte).join('')}</ol>
            </section>`;
    }

    // ---------------------------------------------------------- rendu

    function erreurHTML() {
        if (erreur.introuvable) {
            return `<div class="mt-empty is-page"><p>Ce match est introuvable.</p><a class="mt-btn" href="calendrier.html">Voir le calendrier</a></div>`;
        }
        return `<div class="mt-empty is-page"><p>La LNH ne répond pas pour le moment. Réessayez dans un instant.</p><button type="button" class="mt-btn" data-action="reessayer">Réessayer</button></div>`;
    }

    /** Les tableaux défilent à l'horizontale : une relecture en direct ne doit pas les ramener au début. */
    function positionsDefilement() {
        const pos = {};
        document.querySelectorAll('#mtRoot [data-scroll]').forEach(el => { pos[el.dataset.scroll] = el.scrollLeft; });
        return pos;
    }

    function rendre() {
        const racine = document.getElementById('mtRoot');
        if (!racine) return;
        if (erreur && !feuille) { racine.innerHTML = erreurHTML(); return; }
        if (!feuille) return;
        const f = feuille;
        if (!cote) cote = 'away';

        const titre = f.started && f.away.score != null
            ? `${f.away.abbrev} ${f.away.score} – ${f.home.score} ${f.home.abbrev}`
            : `${f.away.abbrev} contre ${f.home.abbrev}`;
        document.title = `${titre} · Feuille de match – Fantazy`;

        const retour = document.getElementById('mtBack');
        if (retour && f.gameDate) retour.href = `calendrier.html?date=${encodeURIComponent(f.gameDate)}`;

        const defilement = positionsDefilement();
        const couleurs = couleursDuMatch(f.away.abbrev, f.home.abbrev);
        const rail = pointageHTML(f) + tirsHTML(f) + statsHTML(f) + serieHTML(f);

        let principal;
        if (!f.started) {
            const message = f.state === 'PPD'
                ? 'Ce match a été reporté.'
                : `La feuille de pointage s’ouvrira à la mise au jeu, ${heure(f.startTimeUTC)}.`;
            principal = `<p class="mt-empty">${echapper(message)}</p>`;
        } else {
            const tab = (cle, texte) => `<button type="button" role="tab" id="mtTab-${cle}" class="mt-tab" aria-controls="mtPanel-${cle}" aria-selected="${onglet === cle}" tabindex="${onglet === cle ? 0 : -1}" data-onglet="${cle}">${texte}</button>`;
            principal = `
                <div class="mt-tabs" role="tablist" aria-label="Sections du match">
                    ${tab('feuille', 'Feuille de pointage')}${tab('resume', 'Résumé')}
                </div>
                <section class="mt-panel" role="tabpanel" id="mtPanel-feuille" aria-labelledby="mtTab-feuille"${onglet === 'feuille' ? '' : ' hidden'}>
                    ${feuilleHTML(f)}
                </section>
                <section class="mt-panel" role="tabpanel" id="mtPanel-resume" aria-labelledby="mtTab-resume"${onglet === 'resume' ? '' : ' hidden'}>
                    ${resumeHTML(f)}
                </section>`;
        }

        racine.innerHTML = `
            ${tableauHTML(f)}
            <div class="mt-layout${rail ? '' : ' is-single'}" style="--mt-away:${couleurs.away};--mt-home:${couleurs.home}">
                <div class="mt-main">${principal}</div>
                ${rail ? `<aside class="mt-rail" aria-label="Le match en chiffres">${rail}</aside>` : ''}
            </div>`;

        document.querySelectorAll('#mtRoot [data-scroll]').forEach(el => {
            if (defilement[el.dataset.scroll]) el.scrollLeft = defilement[el.dataset.scroll];
        });
    }

    // ---------------------------------------------------------- fiche joueur

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

    function choisirOnglet(cle, focus) {
        onglet = cle;
        document.querySelectorAll('#mtRoot [data-onglet]').forEach(b => {
            const actif = b.dataset.onglet === cle;
            b.setAttribute('aria-selected', String(actif));
            b.tabIndex = actif ? 0 : -1;
            if (actif && focus) b.focus();
        });
        document.querySelectorAll('#mtRoot .mt-panel').forEach(p => { p.hidden = p.id !== `mtPanel-${cle}`; });
    }

    function brancher() {
        const racine = document.getElementById('mtRoot');
        racine.addEventListener('click', e => {
            const joueur = e.target.closest('[data-player]');
            if (joueur) return ouvrirFiche(joueur);
            const tab = e.target.closest('[data-onglet]');
            if (tab) return choisirOnglet(tab.dataset.onglet, false);
            const seg = e.target.closest('[data-cote]');
            if (seg && seg.dataset.cote !== cote) {
                cote = seg.dataset.cote;
                rendre();
                document.querySelector(`#mtRoot [data-cote="${cote}"]`)?.focus();
                return;
            }
            if (e.target.closest('[data-action="reessayer"]')) {
                racine.innerHTML = '<div class="mt-loading" role="status"><span class="mt-spinner" aria-hidden="true"></span>Chargement de la feuille de match…</div>';
                erreur = null;
                charger();
            }
        });
        racine.addEventListener('keydown', e => {
            if (!e.target.matches('[data-onglet]') || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            e.preventDefault();
            choisirOnglet(onglet === 'feuille' ? 'resume' : 'feuille', true);
        });

        // Revenir d'où l'on vient — l'accueil garde alors son carrousel où il
        // était — plutôt que d'ouvrir le calendrier à neuf.
        const retour = document.getElementById('mtBack');
        let origine = '';
        try { origine = document.referrer ? new URL(document.referrer).origin : ''; } catch (e) { /* referrer illisible */ }
        if (retour && origine === window.location.origin && window.history.length > 1) {
            retour.innerHTML = '<span aria-hidden="true">‹</span> Retour';
            retour.addEventListener('click', e => { e.preventDefault(); window.history.back(); });
        }

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && enDirect(feuille)) charger({ silencieux: true });
        });

        // Le bouton de thème de la barre change --card : les couleurs d'équipe
        // se recalculent pour rester lisibles sur la nouvelle surface.
        new MutationObserver(() => rendre())
            .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    document.addEventListener('DOMContentLoaded', () => {
        brancher();
        charger();
        chargerMesJoueurs();
        if (window.FZPool && typeof FZPool.on === 'function') FZPool.on(chargerMesJoueurs);
    });
})();
