/* ============================================================
   ALIGNEMENTS — onglet de stats.html
   ------------------------------------------------------------
   Les trios, les paires, les gardiens, les unités spéciales et
   les blessés d'un club, tels que GET /team-lineup/:club les
   rend (voir lib/alignement.js). Trois façons de les lire :

     - photos    : la photo officielle de la LNH (par défaut) ;
     - chandails : le dos du chandail, nom et numéro, aux
                   couleurs du club (teamColors.js) ;
     - stats     : un tableau, ligne par ligne, avec la saison
                   de chacun.

   Rien n'est chargé tant que l'onglet reste fermé. Le club et
   l'affichage choisis sont retenus d'une visite à l'autre, et
   l'adresse (?onglet=alignements&equipe=MTL) se partage.
   ============================================================ */
(function () {
    const BASE = window.location.hostname.includes('localhost')
        ? 'http://localhost:3000'
        : window.location.origin;

    const echapper = t => String(t == null ? '' : t)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    /**
     * Les 32 clubs, triés par ville. La ville vient en tête du libellé
     * (« Montréal – Canadiens ») pour que l'ordre se lise dans la liste.
     */
    const CLUBS = [
        ['ANA', 'Anaheim', 'Ducks'], ['BOS', 'Boston', 'Bruins'], ['BUF', 'Buffalo', 'Sabres'],
        ['CGY', 'Calgary', 'Flames'], ['CAR', 'Caroline', 'Hurricanes'], ['CHI', 'Chicago', 'Blackhawks'],
        ['COL', 'Colorado', 'Avalanche'], ['CBJ', 'Columbus', 'Blue Jackets'], ['DAL', 'Dallas', 'Stars'],
        ['DET', 'Détroit', 'Red Wings'], ['EDM', 'Edmonton', 'Oilers'], ['FLA', 'Floride', 'Panthers'],
        ['LAK', 'Los Angeles', 'Kings'], ['MIN', 'Minnesota', 'Wild'], ['MTL', 'Montréal', 'Canadiens'],
        ['NSH', 'Nashville', 'Predators'], ['NJD', 'New Jersey', 'Devils'], ['NYI', 'New York', 'Islanders'],
        ['NYR', 'New York', 'Rangers'], ['OTT', 'Ottawa', 'Sénateurs'], ['PHI', 'Philadelphie', 'Flyers'],
        ['PIT', 'Pittsburgh', 'Penguins'], ['SJS', 'San Jose', 'Sharks'], ['SEA', 'Seattle', 'Kraken'],
        ['STL', 'St. Louis', 'Blues'], ['TBL', 'Tampa Bay', 'Lightning'], ['TOR', 'Toronto', 'Maple Leafs'],
        ['UTA', 'Utah', 'Mammoth'], ['VAN', 'Vancouver', 'Canucks'], ['VGK', 'Vegas', 'Golden Knights'],
        ['WSH', 'Washington', 'Capitals'], ['WPG', 'Winnipeg', 'Jets']
    ]
        .sort((a, b) => a[1].localeCompare(b[1], 'fr') || a[2].localeCompare(b[2], 'fr'))
        .map(([code, ville, surnom]) => [code, `${ville} – ${surnom}`]);
    const NOMS = new Map(CLUBS);

    /** Dans l'ordre des boutons ; le premier est l'affichage par défaut. */
    const VUES = ['photos', 'chandails', 'stats'];

    /** Au-delà, un retour sur l'onglet relit l'alignement. */
    const FRAICHEUR_MS = 10 * 60 * 1000;

    /** Statuts de blessure de Daily Faceoff. Un statut inconnu s'affiche tel quel. */
    const STATUTS = {
        out: 'Absent', dtd: 'Jour à jour', 'day-to-day': 'Jour à jour',
        ir: 'Blessé', ltir: 'Blessé long terme', questionable: 'Incertain',
        suspended: 'Suspendu', susp: 'Suspendu'
    };

    const PLACES = {
        lw: 'AG', c: 'C', rw: 'AD', ld: 'DG', rd: 'DD',
        g1: 'Partant', g2: 'Auxiliaire', g3: '3e gardien'
    };

    /** Dos de chandail : épaules, manches tombantes, bas droit. */
    const SILHOUETTE = 'M46 5 Q60 11 74 5 L95 9 Q104 11 107 20 L118 57 L100 63 L94 40 '
        + 'L94 100 L26 100 L26 40 L20 63 L2 57 L13 20 Q16 11 25 9 Z';

    const memoire = {
        lire(cle) { try { return localStorage.getItem(cle); } catch (e) { return null; } },
        ecrire(cle, v) { try { localStorage.setItem(cle, v); } catch (e) { /* navigation privée */ } }
    };

    let club = NOMS.has(memoire.lire('fzLineupTeam')) ? memoire.lire('fzLineupTeam') : 'MTL';
    let vue = VUES.includes(memoire.lire('fzLineupView')) ? memoire.lire('fzLineupView') : VUES[0];
    let donnees = null;
    let luA = 0;
    let jeton = 0;
    let ouvert = false;

    // ---------------------------------------------------------- données

    async function charger({ silencieux = false } = {}) {
        const moi = ++jeton;
        const corps = document.getElementById('luBody');
        if (!silencieux) {
            donnees = null;
            corps.innerHTML = squelette();
            document.getElementById('luSource').innerHTML = '';
        }
        try {
            const reponse = await fetch(`${BASE}/team-lineup/${club}`, { cache: 'no-store' });
            if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
            const lu = await reponse.json();
            if (moi !== jeton) return;
            donnees = lu;
            luA = Date.now();
            rendre();
        } catch (erreur) {
            if (moi !== jeton || (silencieux && donnees)) return;
            corps.innerHTML = `
                <div class="lu-empty">
                    <p>L’alignement est indisponible pour le moment.</p>
                    <button type="button" class="lu-retry" data-lu-retry>Réessayer</button>
                </div>`;
        }
    }

    // ---------------------------------------------------------- aides

    function couleurs(code) {
        const [c1, c2] = typeof getTeamColors === 'function' ? getTeamColors(code) : ['#3A414D', '#171A20'];
        // Chandail clair (or, orange, bleu ciel) : lettres sombres, cernées de
        // blanc. Un contour dans la seconde couleur, souvent noire, empâtait
        // les chiffres sombres au point de fondre « 88 » en une tache.
        const clair = typeof hexLuminance === 'function' && hexLuminance(c1) > 0.3;
        return `--lu-c1:${c1};--lu-c2:${c2};--lu-ink:${clair ? '#16181a' : '#ffffff'};--lu-stroke:${clair ? '#ffffff' : c2}`;
    }

    function initiales(p) {
        return ((p.firstName || '').charAt(0) + (p.lastName || '').charAt(0)).toUpperCase() || '?';
    }

    function depuis(iso) {
        const t = Date.parse(iso || '');
        if (!Number.isFinite(t)) return null;
        const min = Math.round((Date.now() - t) / 60000);
        if (min < 1) return 'à l’instant';
        if (min < 60) return `il y a ${min} min`;
        const h = Math.round(min / 60);
        if (h < 24) return `il y a ${h} h`;
        const j = Math.round(h / 24);
        if (j < 7) return `il y a ${j} jour${j > 1 ? 's' : ''}`;
        return `le ${new Date(t).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    }

    /** Le motif de la dernière mise à jour de Daily Faceoff, en français quand on le reconnaît. */
    function motif(libelle) {
        if (!libelle) return null;
        const hors = /^(\d{4}) Offseason \(Projected\)$/i.exec(libelle);
        if (hors) return `Projection hors saison ${hors[1]}`;
        return libelle
            .replace(/^Training Camp\b/i, 'Camp d’entraînement')
            .replace(/^Morning Skate\b/i, 'Entraînement matinal')
            .replace(/^Line Rushes\b/i, 'Échauffement')
            .replace(/^Practice\b/i, 'Entraînement')
            .replace(/^Preseason\b/i, 'Présaison');
    }

    const rang = (n, feminin) => n === 1 ? (feminin ? '1re' : '1er') : `${n}e`;

    function badges(p) {
        const statut = p.status ? (STATUTS[String(p.status).toLowerCase()] || String(p.status).toUpperCase()) : null;
        return `${statut ? `<span class="lu-badge is-out">${echapper(statut)}</span>` : ''}`
            + `${p.gtd ? '<span class="lu-badge">Incertain</span>' : ''}`;
    }

    /** Un joueur cliquable ouvre sa fiche ; sans identifiant LNH, il ne mène nulle part. */
    function ouvreFiche(p) {
        return p.id
            ? `data-player-id="${echapper(p.id)}" aria-label="${echapper(p.name)}${p.number != null ? `, numéro ${echapper(p.number)}` : ''} — voir la fiche"`
            : '';
    }

    // ---------------------------------------------------------- joueurs

    function chandail(p) {
        const nom = String(p.lastName || p.name || '').toUpperCase();
        const serre = nom.length > 9 ? ' textLength="62" lengthAdjust="spacingAndGlyphs"' : '';
        return `
            <svg class="lu-jersey" viewBox="0 0 120 104" aria-hidden="true" focusable="false">
                <g clip-path="url(#luJerseyClip)">
                    <rect class="lu-j-c1" width="120" height="104"/>
                    <rect class="lu-j-trim" y="42" width="120" height="13"/>
                    <rect class="lu-j-c2" y="44" width="120" height="9"/>
                    <rect class="lu-j-c1" x="26" y="36" width="68" height="22"/>
                    <rect class="lu-j-trim" y="82" width="120" height="12"/>
                    <rect class="lu-j-c2" y="84" width="120" height="8"/>
                    <rect width="120" height="104" fill="url(#luJerseyShade)"/>
                </g>
                <path class="lu-j-inside" d="M47 5 Q60 15 73 5 Q60 9 47 5 Z"/>
                <path class="lu-j-collar" d="M46 5 Q60 11 74 5"/>
                <path class="lu-j-edge" d="${SILHOUETTE}"/>
                <text class="lu-j-name" x="60" y="29"${serre}>${echapper(nom)}</text>
                <text class="lu-j-num" x="60" y="75">${echapper(p.number != null ? p.number : '')}</text>
            </svg>`;
    }

    function photo(p) {
        return `
            <span class="lu-photo fz-shot">
                ${p.headshot
                    ? `<img src="${echapper(p.headshot)}" alt="" loading="lazy" onerror="this.remove()">`
                    : ''}
                <span class="lu-photo-init" aria-hidden="true">${echapper(initiales(p))}</span>
                ${p.number != null ? `<span class="lu-photo-num">${echapper(p.number)}</span>` : ''}
            </span>`;
    }

    function carte(p, etiquette) {
        const balise = p.id ? 'button' : 'div';
        const visuel = vue === 'photos' ? photo(p) : chandail(p);
        // Prénom au-dessus, nom dessous : trois colonnes sur un téléphone ne
        // laissaient à « Matthew Knies » que « MATTHEW KN… ».
        const nom = `<span class="lu-p-first">${echapper(p.firstName)}</span><span class="lu-p-last">${echapper(p.lastName)}</span>`;
        return `
            <${balise} ${balise === 'button' ? 'type="button" ' : ''}class="lu-p${p.status ? ' is-out' : ''}" ${ouvreFiche(p)}>
                ${etiquette ? `<span class="lu-p-slot">${echapper(etiquette)}</span>` : ''}
                ${visuel}
                <span class="lu-p-name">${nom}</span>
                <span class="lu-p-badges">${badges(p)}</span>
            </${balise}>`;
    }

    // ---------------------------------------------------------- sections

    function section(titre, contenu, note) {
        if (!contenu) return '';
        return `
            <section class="lu-sec">
                <h3 class="lu-sec-title">${echapper(titre)}</h3>
                ${note ? `<p class="lu-sec-note">${echapper(note)}</p>` : ''}
                ${contenu}
            </section>`;
    }

    /** Trios et paires : des colonnes (AG, C, AD), une rangée par ligne. */
    function grille(groupes, colonnes, libelle) {
        if (!groupes.length) return '';
        const tetes = colonnes.map(c => `<span class="lu-colhead" title="${echapper(c[1])}">${echapper(c[0])}</span>`).join('');
        const rangees = groupes.map((g, i) => `
            <p class="lu-row-label">${echapper(libelle(i + 1))}</p>
            ${colonnes.map(c => {
                const p = g.players.find(j => j.slot === c[2]);
                return p ? carte(p) : '<span class="lu-p is-empty" aria-hidden="true"></span>';
            }).join('')}`).join('');
        return `<div class="lu-grid" style="--lu-cols:${colonnes.length}">${tetes}${rangees}</div>`;
    }

    /** Unités spéciales, gardiens, blessés : une rangée qui passe à la ligne. */
    function rangee(joueurs, etiquette) {
        if (!joueurs.length) return '';
        return `<div class="lu-row">${joueurs.map(p => carte(p, etiquette ? etiquette(p) : null)).join('')}</div>`;
    }

    function unites(groupes, libelle) {
        if (!groupes.length) return '';
        return groupes.map((g, i) => `
            <p class="lu-row-label">${echapper(libelle(i + 1))}</p>
            ${rangee(g.players)}`).join('');
    }

    // ---------------------------------------------------------- vue « stats »

    const nb = v => (v == null ? '—' : v);
    const pm = v => (v == null ? '—' : (v > 0 ? `+${v}` : String(v)));
    const moy = v => (v == null ? '—' : v.toFixed(2));
    const pct = v => (v == null ? '—' : v.toFixed(3).replace(/^0/, ''));

    const COLONNES_PATINEUR = [
        ['PJ', 'Parties jouées', s => nb(s.gp)],
        ['B', 'Buts', s => nb(s.g)],
        ['A', 'Passes', s => nb(s.a)],
        ['PTS', 'Points', s => nb(s.pts)],
        ['+/-', 'Différentiel', s => pm(s.pm)],
        ['TG', 'Temps de glace moyen', s => nb(s.toi)]
    ];
    const COLONNES_GARDIEN = [
        ['PJ', 'Parties jouées', s => nb(s.gp)],
        ['V', 'Victoires', s => nb(s.w)],
        ['D', 'Défaites', s => nb(s.l)],
        ['DP', 'Défaites en prolongation', s => nb(s.otl)],
        ['MOY', 'Moyenne de buts alloués', s => moy(s.gaa)],
        ['%ARR', 'Pourcentage d’arrêts', s => pct(s.svPct)],
        ['BL', 'Blanchissages', s => nb(s.so)]
    ];

    function ligneStats(p, colonnes, place) {
        const s = p.stats || {};
        const attributs = p.id ? ` class="is-clickable" tabindex="0" ${ouvreFiche(p)}` : '';
        return `
            <tr${attributs}>
                <td class="lu-t-slot">${echapper(place || '')}</td>
                <td class="lu-t-num">${echapper(p.number != null ? p.number : '')}</td>
                <td class="lu-t-name"><span>${echapper(p.name)}</span>${badges(p)}</td>
                ${colonnes.map(c => `<td>${echapper(c[2](s))}</td>`).join('')}
            </tr>`;
    }

    /** `blocs` : [{ titre, joueurs, place(p) }] — un tbody par ligne. */
    function tableau(blocs, colonnes) {
        const utiles = blocs.filter(b => b.joueurs.length);
        if (!utiles.length) return '';
        const largeur = 3 + colonnes.length;
        return `
            <div class="lu-table-wrap">
                <table class="lu-table">
                    <thead><tr>
                        <th class="lu-t-slot" scope="col"><span class="lu-sr">Position</span></th>
                        <th class="lu-t-num" scope="col">#</th>
                        <th class="lu-t-name" scope="col">Joueur</th>
                        ${colonnes.map(c => `<th scope="col" title="${echapper(c[1])}">${echapper(c[0])}</th>`).join('')}
                    </tr></thead>
                    ${utiles.map(b => `
                        <tbody>
                            ${b.titre ? `<tr class="lu-t-group"><th colspan="${largeur}" scope="rowgroup">${echapper(b.titre)}</th></tr>` : ''}
                            ${b.joueurs.map(p => ligneStats(p, colonnes, b.place ? b.place(p) : '')).join('')}
                        </tbody>`).join('')}
                </table>
            </div>`;
    }

    const placeDe = p => PLACES[p.slot] || '';
    const placeOfficielle = p => ({ C: 'C', L: 'AG', R: 'AD', D: 'D', G: 'G' }[p.position] || '');

    function noteSaison() {
        const s = donnees.statsSeason;
        if (!s) return 'Statistiques indisponibles pour le moment.';
        return s.started
            ? `Saison régulière ${s.label}.`
            : `La nouvelle saison n’est pas commencée : statistiques de la saison régulière ${s.label}.`;
    }

    // ---------------------------------------------------------- rendu

    function rendreLignes(a) {
        const parties = [];
        if (vue === 'stats') {
            const note = noteSaison();
            parties.push(section('Trios', tableau(
                a.forwards.map((g, i) => ({ titre: `${rang(i + 1)} trio`, joueurs: g.players, place: placeDe })),
                COLONNES_PATINEUR), note));
            parties.push(section('Paires de défenseurs', tableau(
                a.defense.map((g, i) => ({ titre: `${rang(i + 1, true)} paire`, joueurs: g.players, place: placeDe })),
                COLONNES_PATINEUR)));
            parties.push(section('Gardiens', tableau([{ joueurs: a.goalies, place: placeDe }], COLONNES_GARDIEN)));
            parties.push(section('Avantage numérique', tableau(
                a.powerPlay.map((g, i) => ({ titre: `${rang(i + 1, true)} vague`, joueurs: g.players })),
                COLONNES_PATINEUR)));
            parties.push(section('Désavantage numérique', tableau(
                a.penaltyKill.map((g, i) => ({ titre: `${rang(i + 1, true)} unité`, joueurs: g.players })),
                COLONNES_PATINEUR)));
            parties.push(section('Blessés', tableau([{ joueurs: a.injuries }], COLONNES_PATINEUR)));
            a.others.forEach(o => parties.push(section(o.label || o.id, tableau([{ joueurs: o.players }], COLONNES_PATINEUR))));
        } else {
            parties.push(section('Trios', grille(a.forwards,
                [['AG', 'Ailier gauche', 'lw'], ['C', 'Centre', 'c'], ['AD', 'Ailier droit', 'rw']],
                n => `${rang(n)} trio`)));
            parties.push(section('Paires de défenseurs', grille(a.defense,
                [['Gauche', 'Défenseur gauche', 'ld'], ['Droite', 'Défenseur droit', 'rd']],
                n => `${rang(n, true)} paire`)));
            parties.push(section('Gardiens', rangee(a.goalies, placeDe)));
            parties.push(section('Avantage numérique', unites(a.powerPlay, n => `${rang(n, true)} vague`)));
            parties.push(section('Désavantage numérique', unites(a.penaltyKill, n => `${rang(n, true)} unité`)));
            parties.push(section('Blessés', rangee(a.injuries)));
            a.others.forEach(o => parties.push(section(o.label || o.id, rangee(o.players))));
        }
        return parties.join('');
    }

    function rendreEffectif(a) {
        const r = a.roster || { forwards: [], defense: [], goalies: [] };
        const avis = '<p class="lu-notice">Les trios sont indisponibles pour le moment. Voici l’effectif officiel de la LNH, par position.</p>';
        if (vue === 'stats') {
            return avis
                + section('Attaquants', tableau([{ joueurs: r.forwards, place: placeOfficielle }], COLONNES_PATINEUR), noteSaison())
                + section('Défenseurs', tableau([{ joueurs: r.defense, place: placeOfficielle }], COLONNES_PATINEUR))
                + section('Gardiens', tableau([{ joueurs: r.goalies }], COLONNES_GARDIEN));
        }
        return avis
            + section('Attaquants', rangee(r.forwards, placeOfficielle))
            + section('Défenseurs', rangee(r.defense))
            + section('Gardiens', rangee(r.goalies));
    }

    function rendreSource(a) {
        const el = document.getElementById('luSource');
        if (!a.lines || !a.source) {
            el.innerHTML = 'Source : effectif officiel de la LNH';
            return;
        }
        const s = a.source;
        const quand = depuis(s.updatedAt);
        const titre = s.updatedAt ? new Date(s.updatedAt).toLocaleString('fr-CA', { dateStyle: 'long', timeStyle: 'short' }) : '';
        const morceaux = [
            `Trios : <a href="${echapper(s.url)}" target="_blank" rel="noopener">${echapper(s.name)}</a>`,
            motif(s.label) ? echapper(motif(s.label)) : null,
            quand ? `<time datetime="${echapper(s.updatedAt)}" title="${echapper(titre)}">mis à jour ${echapper(quand)}</time>` : null,
            s.link ? `<a href="${echapper(s.link)}" target="_blank" rel="noopener">voir la source</a>` : null
        ].filter(Boolean);
        el.innerHTML = (a.stale ? '<span class="lu-stale">Daily Faceoff ne répond pas : derniers trios connus.</span> ' : '')
            + morceaux.join(' · ');
    }

    function rendre() {
        if (!donnees) return;
        const corps = document.getElementById('luBody');
        corps.setAttribute('style', couleurs(donnees.team));
        corps.dataset.vue = vue;
        corps.innerHTML = donnees.lines ? rendreLignes(donnees) : rendreEffectif(donnees);
        rendreSource(donnees);
    }

    function squelette() {
        return `<div class="lu-loading" role="status">${'<span class="skeleton lu-skel"></span>'.repeat(6)}<span class="lu-sr">Chargement de l’alignement…</span></div>`;
    }

    // ---------------------------------------------------------- gestes

    function adresse() {
        const params = new URLSearchParams(window.location.search);
        params.set('onglet', 'alignements');
        params.set('equipe', club);
        history.replaceState(null, '', `${window.location.pathname}?${params}`);
    }

    function choisirClub(code) {
        if (!NOMS.has(code)) return;
        club = code;
        memoire.ecrire('fzLineupTeam', code);
        const logo = document.getElementById('luLogo');
        logo.src = `teams/${code}.png`;
        logo.alt = NOMS.get(code);
        document.getElementById('luTeam').value = code;
        adresse();
        charger();
    }

    function choisirVue(nouvelle) {
        if (!VUES.includes(nouvelle)) return;
        vue = nouvelle;
        memoire.ecrire('fzLineupView', vue);
        document.querySelectorAll('[data-lu-view]').forEach(b => {
            const actif = b.dataset.luView === vue;
            b.classList.toggle('is-active', actif);
            b.setAttribute('aria-checked', String(actif));
            b.tabIndex = actif ? 0 : -1;
        });
        rendre();
    }

    function ouvrir() {
        if (!ouvert) {
            ouvert = true;
            choisirClub(club);
        } else {
            adresse();
            if (Date.now() - luA > FRAICHEUR_MS) charger({ silencieux: true });
        }
    }

    function monter() {
        const panneau = document.getElementById('lineupPanel');
        if (!panneau) return;

        // Défs partagées par tous les chandails de la page : une seule
        // découpe, un seul dégradé. Pas de display:none — un clipPath caché
        // ainsi ne découpe plus rien dans certains navigateurs.
        panneau.insertAdjacentHTML('afterbegin', `
            <svg class="lu-defs" width="0" height="0" aria-hidden="true" focusable="false">
                <defs>
                    <clipPath id="luJerseyClip"><path d="${SILHOUETTE}"/></clipPath>
                    <linearGradient id="luJerseyShade" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stop-color="#fff" stop-opacity=".14"/>
                        <stop offset=".45" stop-color="#fff" stop-opacity="0"/>
                        <stop offset="1" stop-color="#000" stop-opacity=".18"/>
                    </linearGradient>
                </defs>
            </svg>`);

        const select = document.getElementById('luTeam');
        select.innerHTML = CLUBS.map(([code, nom]) => `<option value="${code}">${echapper(nom)}</option>`).join('');
        select.value = club;
        select.addEventListener('change', e => choisirClub(e.target.value));

        const vues = document.getElementById('luViews');
        vues.addEventListener('click', e => {
            const b = e.target.closest('[data-lu-view]');
            if (b) choisirVue(b.dataset.luView);
        });
        vues.addEventListener('keydown', e => {
            if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            e.preventDefault();
            const i = (VUES.indexOf(vue) + (e.key === 'ArrowRight' ? 1 : VUES.length - 1)) % VUES.length;
            choisirVue(VUES[i]);
            vues.querySelector(`[data-lu-view="${vue}"]`).focus();
        });
        choisirVue(vue);

        const corps = document.getElementById('luBody');
        const ouvrirFiche = cible => {
            const el = cible.closest('[data-player-id]');
            if (el && typeof window.showCareerStats === 'function') window.showCareerStats(Number(el.dataset.playerId));
        };
        corps.addEventListener('click', e => {
            if (e.target.closest('[data-lu-retry]')) { charger(); return; }
            ouvrirFiche(e.target);
        });
        corps.addEventListener('keydown', e => {
            // Les rangées du tableau ne sont pas des boutons : Entrée et
            // Espace y ouvrent la fiche comme un clic.
            if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-player-id]')) {
                e.preventDefault();
                ouvrirFiche(e.target);
            }
        });

        document.addEventListener('fz:stats-tab', e => {
            if (e.detail === 'alignements') ouvrir();
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && ouvert && Date.now() - luA > FRAICHEUR_MS) charger({ silencieux: true });
        });

        const params = new URLSearchParams(window.location.search);
        const demande = String(params.get('equipe') || '').toUpperCase();
        if (NOMS.has(demande)) club = demande;
        if (params.get('onglet') === 'alignements' && typeof window.switchStatsTab === 'function') {
            window.switchStatsTab('alignements');
        }
    }

    document.addEventListener('DOMContentLoaded', monter);
})();
