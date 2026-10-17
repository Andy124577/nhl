/* Bilan de la soirée — la fenêtre qui surgit quand le dernier match du soir
 * est terminé.
 *
 * En haut, deux cartes : le total de la soirée, avec la part de chaque
 * joueur en une barre aux couleurs de son club, puis
 *
 *   - cumulatif : la place au classement, et le mouvement de la soirée
 *     (▲ ▼ ou même place) ;
 *   - tête-à-tête : le duel de la semaine, les deux pointages et l'écart.
 *
 * Dessous, ses joueurs qui ont joué, triés par points : une rangée de cartes
 * sur ordinateur, une liste sur téléphone, où la fenêtre devient un panneau
 * qui monte du bas (et se referme en le tirant vers le bas).
 *
 * Le spectacle : les joueurs apparaissent un à un, du meilleur au moins bon ;
 * les points de chacun filent jusqu'au total, qui grimpe, et sa part s'ajoute
 * à la barre. À la fin, le classement passe du rang d'avant la soirée à celui
 * d'après (ou les pointages du duel montent), et l'action reste.
 *
 * Rien ne bouge avant que tout soit prêt : la fenêtre se construit hors de la
 * page, attend ses photos, ses écussons et ses polices (DELAI_CHARGEMENT_MAX_MS
 * au plus, après quoi les initiales prennent la place d'une photo en retard),
 * et seulement alors s'ouvre et joue.
 *
 * Le serveur décide de la soirée (routes/soiree.js) : celle du jour dès son
 * dernier match fini, sinon celle de la veille. La page lui demande au
 * chargement, puis quand il le dit (`reessaiMs`) : toutes les cinq minutes
 * pendant les matchs, toutes les demi-heures sinon, jamais en arrière-plan.
 * Une soirée montrée ne revient pas (localStorage, par pool) ; ?bilan=soiree
 * la rejoue, pour la revoir.
 *
 * Chargé en <script defer> après activePool.js. Aucune dépendance de page :
 * photos, écussons et couleurs de club arrivent prêts du serveur ; les
 * polices (Barlow), la fenêtre les charge elle-même. */
(function () {
    'use strict';
    if (window.FZBilanSoiree) return;

    const BASE_URL = window.location.hostname.includes('localhost')
        ? 'http://localhost:3000'
        : window.location.origin;

    const CLE = 'fzBilanSoiree:v1';        // { [pool]: ['2026-10-14', …] }
    const VUS_MAX = 7;
    /** Laisser la page se poser avant de surgir par-dessus. */
    const DELAI_PREMIER_MS = 1400;
    const REESSAI_MIN_MS = 60 * 1000;
    const REESSAI_MAX_MS = 30 * 60 * 1000;
    /** Une autre fenêtre est ouverte (fiche de joueur, confirmation) : on repasse. */
    const ATTENTE_AUTRE_FENETRE_MS = 15 * 1000;
    /** Durée d'une carte ; plus court au-delà de CARTES_LONGUES, pour ne pas lasser. */
    const DUREE_CARTE_MS = 1750;
    const DUREE_CARTE_RAPIDE_MS = 1250;
    const CARTES_LONGUES = 6;
    /** Photos et polices : au-delà, la fenêtre s'ouvre quand même. */
    const DELAI_CHARGEMENT_MAX_MS = 6000;
    const POLICES_URL = 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700&display=swap';
    const POLICES = ['400 13px Barlow', '500 13px Barlow', '600 15px Barlow', '600 16px "Barlow Condensed"', '700 30px "Barlow Condensed"'];

    const reduit = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const telephone = () => window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
    const forcer = new URLSearchParams(window.location.search).get('bilan') === 'soiree';

    let minuteur = null;
    let derniereVerif = 0;
    let ouverte = false;

    // ───────────────────────── Mémoire ─────────────────────────

    function lireTout() {
        try { return JSON.parse(localStorage.getItem(CLE) || 'null') || {}; } catch { return {}; }
    }
    function lireVus(pool) {
        const liste = lireTout()[pool];
        return Array.isArray(liste) ? liste : [];
    }
    function noterVu(pool, jour) {
        const tout = lireTout();
        tout[pool] = [jour, ...lireVus(pool).filter(j => j !== jour)].slice(0, VUS_MAX);
        try { localStorage.setItem(CLE, JSON.stringify(tout)); } catch { /* stockage bloqué : elle reviendra */ }
    }
    function connecte() {
        try { return localStorage.getItem('isLoggedIn') === 'true' && !!localStorage.getItem('username'); } catch { return false; }
    }

    // ───────────────────────── Quand l'ouvrir ─────────────────────────

    function planifier(ms) {
        clearTimeout(minuteur);
        minuteur = null;
        if (ms == null || document.hidden) return;
        minuteur = setTimeout(verifier, Math.min(Math.max(ms, REESSAI_MIN_MS), REESSAI_MAX_MS));
    }

    function autreFenetreOuverte() {
        if (document.querySelector('.fzd-overlay, #draftEndOverlay.is-open')) return true;
        const carriere = document.getElementById('careerStatsModal');
        return !!carriere && carriere.style.display === 'block';
    }

    async function verifier({ rejouer = false } = {}) {
        clearTimeout(minuteur);
        minuteur = null;
        // En arrière-plan, l'animation jouerait pour personne : le retour à
        // l'onglet relance la vérification (visibilitychange).
        if (ouverte || document.hidden || !connecte() || !window.FZPool) return;
        try { await FZPool.ready(); } catch { return; }
        const pool = FZPool.get();
        const data = FZPool.data();
        if (!pool || !FZPool.team() || !data || FZPool.draftState(data).etat !== 'termine') return;

        derniereVerif = Date.now();
        const vus = rejouer ? [] : lireVus(pool);
        let corps;
        try {
            const res = await fetch(`${BASE_URL}/api/pools/${encodeURIComponent(pool)}/bilan-soiree?vus=${encodeURIComponent(vus.join(','))}`, { cache: 'no-store' });
            if (!res.ok) return;
            corps = await res.json();
        } catch {
            planifier(REESSAI_MAX_MS);
            return;
        }
        // Le pool a changé pendant la lecture : le changement relance sa vérification.
        if (FZPool.get() !== pool) return;
        if (corps && corps.pret && !corps.vu && Array.isArray(corps.cartes)) {
            presenter(corps, pool);
            return;
        }
        planifier(corps && corps.reessaiMs);
    }

    function presenter(corps, pool) {
        if (ouverte) return;
        if (autreFenetreOuverte()) {
            setTimeout(() => { if (!ouverte && FZPool.get() === pool) presenter(corps, pool); }, ATTENTE_AUTRE_FENETRE_MS);
            return;
        }
        ouvrir(corps, pool);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { clearTimeout(minuteur); minuteur = null; return; }
        if (Date.now() - derniereVerif > REESSAI_MIN_MS) verifier();
    });

    // ───────────────────────── Chargement ─────────────────────────

    let policesPretes = null;

    /** Barlow, que toutes les pages ne chargent pas : la feuille, puis les fontes. */
    function polices() {
        if (!policesPretes) {
            policesPretes = new Promise(fini => {
                const lien = document.createElement('link');
                lien.rel = 'stylesheet';
                lien.href = POLICES_URL;
                lien.onload = lien.onerror = () => fini();
                document.head.appendChild(lien);
            }).then(() => (document.fonts && document.fonts.load
                ? Promise.all(POLICES.map(f => document.fonts.load(f).catch(() => null)))
                : null));
        }
        return policesPretes;
    }

    /**
     * Les images de la fenêtre (photos, écussons, logo) chargées et décodées,
     * et ses polices prêtes. Une image en erreur compte comme prête : elle se
     * retire et ses initiales prennent sa place. Les <img> d'un élément hors
     * de la page se chargent déjà : la fenêtre n'y entre qu'une fois prête.
     */
    function charger(racine) {
        const images = [...racine.querySelectorAll('img')].map(img => new Promise(fini => {
            const decoder = () => (img.decode ? img.decode().catch(() => null) : Promise.resolve()).then(() => fini());
            if (img.complete) { decoder(); return; }
            img.addEventListener('load', decoder, { once: true });
            img.addEventListener('error', () => fini(), { once: true });
        }));
        return Promise.race([
            Promise.all([...images, polices()]),
            new Promise(fini => setTimeout(fini, DELAI_CHARGEMENT_MAX_MS))
        ]);
    }

    // ───────────────────────── Format ─────────────────────────

    const echapper = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** Une décimale au tête-à-tête, sans « .0 » inutile. */
    function fmt(v) {
        const n = Math.round((Number(v) || 0) * 10) / 10;
        return Number.isInteger(n) ? String(n) : n.toFixed(1);
    }
    const signe = v => (v > 0 ? `+${fmt(v)}` : v < 0 ? `−${fmt(-v)}` : '0');
    const nombre = v => (v < 0 ? `−${fmt(-v)}` : fmt(v));
    const pluriel = (n, mot) => `${fmt(n)} ${mot}${Math.abs(n) > 1 ? 's' : ''}`;
    const ordinal = n => (n === 1 ? '1<sup>er</sup>' : `${n}<sup>e</sup>`);

    function dateLongue(jour) {
        const d = new Date(`${jour}T12:00:00Z`);
        const texte = d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
        return texte.charAt(0).toUpperCase() + texte.slice(1);
    }

    function initiales(nom) {
        const mots = String(nom || '').trim().split(/\s+/).filter(Boolean);
        if (mots.length >= 2) return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase();
        return String(nom || '').slice(0, 2).toUpperCase();
    }

    /** Deux libellés : le long sur ordinateur, le court sur téléphone. */
    const deuxTailles = (long, court) => `<span class="fzb-long">${long}</span><span class="fzb-short">${court}</span>`;

    const POSTES = { offensive: 'Attaquant', defensive: 'Défenseur', goalie: 'Gardien', rookie: 'Recrue' };
    const DECISIONS = { BL: 'Blanchissage', V: 'Victoire', DP: 'Défaite en prol.', D: 'Défaite' };

    /** Ce qu'une carte a fait de la soirée. Les tirs ne comptent qu'au tête-à-tête. */
    function resultatsDe(carte, enH2H) {
        if (carte.type === 'club') {
            const issue = carte.issue === 'V' ? 'Victoire'
                : carte.issue === 'DP' ? (carte.prolongation === 'SO' ? 'Défaite en t.b.' : 'Défaite en prol.')
                : 'Défaite';
            return [`${issue} ${carte.pour}-${carte.contre} ${carte.domicile ? 'vs' : 'à'} ${carte.adversaire}`];
        }
        if (carte.gardien) {
            return [carte.decision ? DECISIONS[carte.decision] : null, carte.arrets ? pluriel(carte.arrets, 'arrêt') : null].filter(Boolean);
        }
        return [
            carte.buts ? pluriel(carte.buts, 'but') : null,
            carte.aides ? pluriel(carte.aides, 'passe') : null,
            enH2H && carte.tirs ? pluriel(carte.tirs, 'tir') : null
        ].filter(Boolean);
    }

    /**
     * Le filet d'un club : sa seconde couleur (`trim`), comme la « team-accent
     * card » du site (DESIGN.md) — deux clubs au même marine s'y distinguent.
     */
    const filetDe = teinte => (teinte && (teinte.trim || teinte.edge)) || null;

    /** Les couleurs d'une carte : la teinte sombre du club, et son filet. */
    function styleClub(teinte) {
        if (!teinte) return '';
        const decl = [];
        if (teinte.surface) decl.push(`--fzb-surface:${echapper(teinte.surface)}`);
        if (filetDe(teinte)) decl.push(`--fzb-club:${echapper(filetDe(teinte))}`);
        return decl.length ? ` style="${decl.join(';')}"` : '';
    }

    /**
     * Le logo d'une équipe de pool, comme au classement : son premier club,
     * sinon ses initiales. En thème sombre, l'écusson fait pour un fond
     * sombre (le marine d'Edmonton s'y perdait).
     */
    function logoEquipeHTML(equipe, cls) {
        const repli = `<span class="${cls}-initiales">${echapper(initiales(equipe.nom))}</span>`;
        if (!equipe.logo) return `<span class="${cls}">${repli}</span>`;
        const sombre = document.documentElement.getAttribute('data-theme') !== 'light';
        const src = sombre && equipe.ecusson ? equipe.ecusson : `teams/${encodeURIComponent(equipe.logo)}.png`;
        return `<span class="${cls}"><img src="${echapper(src)}" alt="" onerror="this.remove()">${repli}</span>`;
    }

    // ───────────────────────── Cartes ─────────────────────────

    function photoHTML(carte, cls) {
        const repli = `<span class="${cls}-initiales">${echapper(initiales(carte.nom))}</span>`;
        if (carte.type === 'club') {
            const ecusson = carte.teinte && carte.teinte.crest;
            return `<span class="${cls} is-club">${ecusson ? `<img src="${echapper(ecusson)}" alt="" onerror="this.remove()">` : ''}${repli}</span>`;
        }
        // L'image AVANT les initiales : la photo détourée les cache ; si
        // elle ne charge pas, elle se retire et les découvre.
        return `<span class="${cls}">${carte.photo ? `<img src="${echapper(carte.photo)}" alt="" onerror="this.remove()">` : ''}${repli}</span>`;
    }

    function ptsHTML(points) {
        const classe = points > 0 ? 'is-plus' : points < 0 ? 'is-moins' : 'is-zero';
        return `<p class="fzb-card-pts ${classe}"><span class="fzb-card-pts-v">${signe(points)}</span><span class="fzb-card-pts-l">pts</span></p>`;
    }

    /**
     * Une carte de joueur ou de club. Sur ordinateur, la photo sur la teinte
     * du club, puis le nom, le poste et les pastilles ; sur téléphone, une
     * rangée : la vignette, le nom, « poste · résultats », les points.
     */
    function carteHTML(carte, enH2H) {
        const club = carte.type === 'club';
        const ecusson = !club && carte.teinte && carte.teinte.crest
            ? `<img class="fzb-card-crest" src="${echapper(carte.teinte.crest)}" alt="" onerror="this.remove()">` : '';
        const meta = club
            ? 'Club de la LNH'
            : [carte.club, POSTES[carte.categorie] || (carte.gardien ? 'Gardien' : '')].filter(Boolean).join(' · ');
        const resultats = resultatsDe(carte, enH2H);
        const pastilles = resultats.length
            ? `<ul class="fzb-card-stats">${resultats.map(s => `<li>${echapper(s)}</li>`).join('')}</ul>` : '';
        const suite = resultats.length ? `<span class="fzb-card-meta-res"> · ${echapper(resultats.join(' · '))}</span>` : '';
        return `
            <article class="fzb-card${club ? ' is-club' : ''} is-attente" role="listitem"${styleClub(carte.teinte)}>
                <div class="fzb-card-media">${ecusson}${photoHTML(carte, 'fzb-card-photo')}</div>
                <div class="fzb-card-body">
                    <div class="fzb-card-id">
                        <h3 class="fzb-card-name">${echapper(carte.nom)}</h3>
                        <p class="fzb-card-meta">${echapper(meta)}${suite}</p>
                    </div>
                    ${pastilles}
                </div>
                ${ptsHTML(carte.points)}
            </article>`;
    }

    /**
     * Ceux qui ont joué sans marquer : une seule carte, leurs visages côte à
     * côte. Quatre pastilles au plus : trois visages et « +N » au-delà.
     */
    function carteGroupeHTML(cartes) {
        const montres = cartes.length > 4 ? cartes.slice(0, 3) : cartes;
        const visages = montres.map(c => `<span class="fzb-face"${styleClub(c.teinte)}>${photoHTML(c, 'fzb-face-photo')}</span>`).join('');
        const plus = cartes.length > montres.length ? `<span class="fzb-face is-plus">+${cartes.length - montres.length}</span>` : '';
        const titre = cartes.length > 1 ? `${cartes.length} joueurs sans point` : '1 joueur sans point';
        return `
            <article class="fzb-card is-groupe is-attente" role="listitem">
                <div class="fzb-card-media is-faces">${visages}${plus}</div>
                <div class="fzb-card-body">
                    <div class="fzb-card-id">
                        <h3 class="fzb-card-name">${titre}</h3>
                        <p class="fzb-card-meta">${echapper(cartes.map(c => c.nom).join(', '))}</p>
                    </div>
                </div>
                ${ptsHTML(0)}
            </article>`;
    }

    function carteVideHTML() {
        return `
            <article class="fzb-card is-vide is-attente" role="listitem">
                <div class="fzb-card-body">
                    <h3 class="fzb-card-name">Soirée de congé</h3>
                    <p class="fzb-card-meta">Aucun de vos joueurs n’a joué ce soir.</p>
                </div>
            </article>`;
    }

    /**
     * L'ordre de passage, celui de la liste : du plus gros apport au plus
     * petit (le serveur les donne ainsi), ceux qui n'ont rien marqué réunis en
     * une carte à leur place, avant les soirées négatives.
     */
    function etapesDe(corps) {
        const enH2H = corps.mode === 'head-to-head';
        const etape = c => ({ html: carteHTML(c, enH2H), points: c.points, nom: c.nom, couleur: filetDe(c.teinte) });
        const zeros = corps.cartes.filter(c => !c.points);
        const etapes = corps.cartes.filter(c => c.points > 0).map(etape);
        if (zeros.length) etapes.push({ html: carteGroupeHTML(zeros), points: 0 });
        corps.cartes.filter(c => c.points < 0).forEach(c => etapes.push(etape(c)));
        if (!etapes.length) etapes.push({ html: carteVideHTML(), points: 0, vide: true });
        return etapes;
    }

    // ───────────────────────── Les deux cartes du haut ─────────────────────────

    const FLECHE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    const TRIANGLE_HAUT = '<svg viewBox="0 0 24 24" width="9" height="9" aria-hidden="true"><path d="M12 4l9 14H3z" fill="currentColor"/></svg>';
    const TRIANGLE_BAS = '<svg viewBox="0 0 24 24" width="9" height="9" aria-hidden="true"><path d="M12 20L3 6h18z" fill="currentColor"/></svg>';
    const EGAL = '<span aria-hidden="true">=</span>';

    /** Une ligne de mouvement : l'icône ▲ ▼ = dans son rond, puis le texte. */
    function mouvementHTML(sens, texte) {
        const icone = sens > 0 ? TRIANGLE_HAUT : sens < 0 ? TRIANGLE_BAS : EGAL;
        const classe = sens > 0 ? 'is-up' : sens < 0 ? 'is-down' : 'is-flat';
        return `<p class="fzb-move ${classe}"><span class="fzb-move-ico">${icone}</span><span class="fzb-move-txt">${texte}</span></p>`;
    }

    function totalHTML(corps, etapes) {
        const n = corps.cartes.length;
        const joueurs = n ? `${n} joueur${n > 1 ? 's' : ''}` : 'Aucun joueur';
        const positif = etapes.reduce((s, e) => s + Math.max(0, e.points), 0);
        const barre = positif > 0
            ? `<div class="fzb-mix" aria-hidden="true">${etapes.map((e, i) => (e.points > 0
                ? `<i data-etape="${i}" title="${echapper(e.nom)}" style="--fzb-part:${(e.points / positif * 100).toFixed(3)}${e.couleur ? `;--fzb-club:${echapper(e.couleur)}` : ''}"></i>`
                : '')).join('')}</div>`
            : '';
        return `
            <section class="fzb-panel fzb-tally" aria-label="Total de la soirée">
                <div class="fzb-panel-head">
                    <p class="fzb-label">${deuxTailles('Total de la soirée', 'Total')}</p>
                    <p class="fzb-panel-aside">${joueurs}</p>
                </div>
                <p class="fzb-big"><span class="fzb-big-n fzb-tally-n">0</span><span class="fzb-big-unit">pts</span></p>
                ${barre}
            </section>`;
    }

    /**
     * La place au classement (cumulatif). Pendant le spectacle, le rang
     * d'avant la soirée ; à la fin, celui d'après et le mouvement.
     */
    function rangHTML(rang) {
        if (!rang || !rang.avant || !rang.apres) return '';
        const gain = rang.avant - rang.apres;
        const places = n => `${n} place${n > 1 ? 's' : ''}`;
        const etait = ` · était ${ordinal(rang.avant)}`;
        const texte = gain > 0 ? `Gagne ${places(gain)}<span class="fzb-long">${etait}</span>`
            : gain < 0 ? `Perd ${places(-gain)}<span class="fzb-long">${etait}</span>`
            : deuxTailles('Même place qu’avant la soirée', 'Même place');
        return `
            <section class="fzb-panel fzb-rank is-attente" aria-label="Au classement">
                <div class="fzb-panel-head"><p class="fzb-label">${deuxTailles('Au classement', 'Classement')}</p></div>
                <p class="fzb-big"><span class="fzb-big-n fzb-rank-n">${ordinal(rang.avant)}</span>${rang.equipes ? `<span class="fzb-big-unit">sur ${rang.equipes}</span>` : ''}</p>
                ${mouvementHTML(gain, texte)}
            </section>`;
    }

    /** Une équipe du duel : logo, nom, pointage de la semaine (d'avant la soirée, au départ). */
    function duelEquipeHTML(equipe, mene) {
        const depart = Math.round(((Number(equipe.points) || 0) - (Number(equipe.soiree) || 0)) * 10) / 10;
        return `
            <li class="fzb-duel-team${mene ? ' is-lead' : ''}">
                ${logoEquipeHTML(equipe, 'fzb-duel-logo')}
                <span class="fzb-duel-name">${echapper(equipe.nom)}</span>
                <span class="fzb-duel-score" data-de="${depart}" data-a="${Number(equipe.points) || 0}">${nombre(depart)}</span>
            </li>`;
    }

    /** Le duel de la semaine (tête-à-tête) ; l'écart se dévoile à la fin. */
    function duelHTML(duel) {
        if (!duel) return '';
        const ecart = (Number(duel.nous.points) || 0) - (Number(duel.eux.points) || 0);
        const par = fmt(Math.abs(ecart));
        let texte;
        if (duel.final) {
            texte = duel.issue === 'W' ? `Victoire par ${par}` : duel.issue === 'L' ? `Défaite par ${par}` : 'Nulle';
        } else {
            texte = ecart > 0 ? `En avance de ${par}` : ecart < 0 ? `En retard de ${par}` : 'Égalité';
            const reste = 7 - duel.jourDeSemaine;
            if (reste > 0) texte += `<span class="fzb-long"> · encore ${reste} jour${reste > 1 ? 's' : ''}</span>`;
        }
        const sens = duel.final ? (duel.issue === 'W' ? 1 : duel.issue === 'L' ? -1 : 0) : Math.sign(ecart);
        const quand = duel.final ? 'Final' : `Jour ${duel.jourDeSemaine} de 7`;
        return `
            <section class="fzb-panel fzb-duel is-attente" aria-label="Votre duel de la semaine">
                <div class="fzb-panel-head">
                    <p class="fzb-label">${deuxTailles(`Duel · Semaine ${duel.semaine}`, `Duel · Sem. ${duel.semaine}`)}</p>
                    <p class="fzb-panel-aside">${quand}</p>
                </div>
                <ul class="fzb-duel-rows">
                    ${duelEquipeHTML(duel.nous, ecart > 0)}
                    ${duelEquipeHTML(duel.eux, ecart < 0)}
                </ul>
                ${mouvementHTML(sens, texte)}
            </section>`;
    }

    /**
     * Une interpolation image par image, en décélération : `chaque(e, termine)`
     * reçoit l'avancement de 0 à 1. Le départ est l'horodatage de la première
     * image, pas performance.now() : celui d'une image peut le précéder, et
     * un avancement négatif faisait déborder le compteur. Renvoie l'arrêt.
     */
    function interpoler(ms, chaque) {
        let t0 = null, image = null;
        const pas = t => {
            if (t0 === null) t0 = t;
            const p = Math.min(1, Math.max(0, (t - t0) / ms));
            chaque(1 - Math.pow(1 - p, 3), p === 1);
            if (p < 1) image = requestAnimationFrame(pas);
        };
        image = requestAnimationFrame(pas);
        return () => cancelAnimationFrame(image);
    }

    // ───────────────────────── La fenêtre ─────────────────────────

    const ICONE_FERMER = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    const chevron = d => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
    const CHEVRON_GAUCHE = chevron('M15 18l-6-6 6-6');
    const CHEVRON_DROIT = chevron('M9 18l6-6-6-6');

    async function ouvrir(corps, pool) {
        ouverte = true;
        const enH2H = corps.mode === 'head-to-head';
        const etapes = etapesDe(corps);
        const n = corps.cartes.length;

        const lienDetail = enH2H && corps.duel
            ? `classement.html?pool=${encodeURIComponent(pool)}&h2h=matchups&semaine=${corps.duel.semaine}`
            : `classement.html?pool=${encodeURIComponent(pool)}&equipe=${encodeURIComponent(corps.equipe.cle)}`;
        const texteDetail = enH2H && corps.duel ? 'Voir le duel' : 'Voir le classement';

        const overlay = document.createElement('div');
        overlay.className = 'fzb-overlay';
        overlay.innerHTML = `
            <section class="fzb-sheet" role="dialog" aria-modal="true" aria-labelledby="fzbTitre" tabindex="-1">
                <div class="fzb-top">
                    <div class="fzb-grab" aria-hidden="true"><span></span></div>
                    <div class="fzb-progress" aria-hidden="true">${etapes.map(() => '<span class="fzb-seg"><i></i></span>').join('')}</div>
                    <header class="fzb-head">
                        ${logoEquipeHTML(corps.equipe, 'fzb-logo')}
                        <div class="fzb-titles">
                            <p class="fzb-eyebrow">${deuxTailles('Bilan de la soirée', 'Bilan')} · ${echapper(corps.equipe.nom)}</p>
                            <h2 class="fzb-title" id="fzbTitre">${echapper(dateLongue(corps.jour))}</h2>
                        </div>
                        <button type="button" class="fzb-close" data-action="fermer" aria-label="Fermer le bilan">${ICONE_FERMER}</button>
                    </header>
                </div>
                <div class="fzb-body">
                    <div class="fzb-summary">
                        ${totalHTML(corps, etapes)}
                        ${enH2H ? duelHTML(corps.duel) : rangHTML(corps.rang)}
                    </div>
                    <div class="fzb-list-head">
                        <p class="fzb-label" id="fzbJoueurs">Vos joueurs ce soir</p>
                        <button type="button" class="fzb-skip" data-action="passer">Passer <span aria-hidden="true">›</span></button>
                        <p class="fzb-list-aside" hidden>${n ? deuxTailles('Triés par points', `${n} joueur${n > 1 ? 's' : ''}`) : ''}</p>
                    </div>
                    <div class="fzb-rail-wrap">
                        <div class="fzb-rail${etapes[0].vide ? ' is-vide' : ''} is-show" role="list" aria-labelledby="fzbJoueurs" data-action="avancer" title="Touchez pour passer au joueur suivant">
                            ${etapes.map(e => e.html).join('')}
                        </div>
                        <button type="button" class="fzb-rail-btn is-prev" data-action="precedent" aria-label="Joueurs précédents" hidden>${CHEVRON_GAUCHE}</button>
                        <button type="button" class="fzb-rail-btn is-next" data-action="suivant" aria-label="Joueurs suivants" hidden>${CHEVRON_DROIT}</button>
                    </div>
                </div>
                <footer class="fzb-foot">
                    <button type="button" class="fzb-btn-secondary" data-action="fermer">Fermer</button>
                    <a class="fzb-btn-primary fzb-detail" href="${lienDetail}">${texteDetail}${FLECHE}</a>
                </footer>
                <p class="fzb-sr" role="status" aria-live="polite"></p>
            </section>`;

        // Les photos d'abord : la fenêtre n'entre dans la page qu'une fois
        // ses images et ses polices prêtes, pour que rien ne surgisse à moitié.
        await charger(overlay);

        // Pendant le chargement, la page a pu changer de pool, ouvrir une
        // autre fenêtre ou passer en arrière-plan : la soirée n'est pas
        // marquée vue, elle reviendra.
        if (FZPool.get() !== pool) { ouverte = false; verifier(); return; }
        if (autreFenetreOuverte()) { ouverte = false; presenter(corps, pool); return; }
        if (document.hidden) {
            ouverte = false;
            document.addEventListener('visibilitychange', function retour() {
                if (document.hidden) return;
                document.removeEventListener('visibilitychange', retour);
                if (FZPool.get() === pool) presenter(corps, pool);
            });
            return;
        }

        noterVu(pool, corps.jour);
        const focusAvant = document.activeElement;
        document.body.appendChild(overlay);
        document.documentElement.classList.add('fzb-lock');

        const $ = sel => overlay.querySelector(sel);
        const sheet = $('.fzb-sheet');
        const defilant = $('.fzb-body');
        const rail = $('.fzb-rail');
        const cartes = [...rail.children];
        const segments = [...overlay.querySelectorAll('.fzb-seg')];
        const barre = $('.fzb-mix');
        const tally = $('.fzb-tally');
        const tallyN = $('.fzb-tally-n');
        const precedent = $('.fzb-rail-btn.is-prev');
        const suivant = $('.fzb-rail-btn.is-next');

        let total = 0;                  // ce que le compteur affiche
        let arreterCompteur = () => {};
        let avancer = null;             // termine l'attente de la carte en cours
        let fini = false;
        let etapeEnCours = -1;          // l'étape dont les points volent
        const volants = new Map();      // pastille → son animation

        function afficherTotal(v) {
            arreterCompteur();
            total = v;
            tallyN.textContent = nombre(v);
        }

        function animerTotal(cible, ms) {
            arreterCompteur();
            const depart = total;
            if (reduit() || ms <= 0 || depart === cible) { afficherTotal(cible); return; }
            arreterCompteur = interpoler(ms, (e, termine) => {
                total = termine ? cible : depart + (cible - depart) * e;
                tallyN.textContent = nombre(total);
            });
            tally.classList.remove('is-bump');
            void tally.offsetWidth;
            tally.classList.add('is-bump');
        }

        /** La part d'un joueur dans la barre du total. */
        function remplirBarre(i) {
            const part = barre && barre.querySelector(`[data-etape="${i}"]`);
            if (part) part.classList.add('is-on');
        }

        /**
         * Les points de la carte filent jusqu'au total, puis il grimpe et la
         * barre prend sa part. Un vol qui finit après sa carte (passée d'un
         * toucher) ne touche plus au total : il comptait vers celui d'une
         * étape déjà close.
         */
        function envoyerPoints(carte, points, cible, i) {
            const mienne = etapeEnCours;
            const source = carte.querySelector('.fzb-card-pts-v');
            if (!points || !source || reduit() || !source.animate) { animerTotal(cible, 420); remplirBarre(i); return; }
            const de = source.getBoundingClientRect();
            const a = tallyN.getBoundingClientRect();
            const volant = document.createElement('span');
            volant.className = `fzb-fly ${points > 0 ? 'is-plus' : 'is-moins'}`;
            volant.textContent = signe(points);
            volant.style.left = `${de.left + de.width / 2}px`;
            volant.style.top = `${de.top + de.height / 2}px`;
            document.body.appendChild(volant);
            const dx = (a.left + a.width / 2) - (de.left + de.width / 2);
            const dy = (a.top + a.height / 2) - (de.top + de.height / 2);
            const vol = volant.animate([
                { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
                { transform: `translate(calc(-50% + ${dx * 0.35}px), calc(-50% + ${dy * 0.55}px)) scale(1.15)`, opacity: 1, offset: 0.45 },
                { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.55)`, opacity: 0.2 }
            ], { duration: 600, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
            volants.set(volant, vol);
            vol.onfinish = () => {
                volant.remove();
                volants.delete(volant);
                if (!fini && mienne === etapeEnCours) { animerTotal(cible, 420); remplirBarre(i); }
            };
        }

        /** Retirer une pastille n'arrête pas son animation : on l'annule. */
        function viderVolants() {
            volants.forEach((vol, volant) => {
                vol.onfinish = null;
                vol.cancel();
                volant.remove();
            });
            volants.clear();
        }

        function attendre(ms) {
            return new Promise(resoudre => {
                const t = setTimeout(fin, ms);
                function fin() { clearTimeout(t); avancer = null; resoudre(); }
                avancer = fin;
            });
        }

        // ---- La liste ----
        // Toutes les cartes sont dans la page dès l'ouverture, invisibles :
        // la fenêtre a sa taille finale, rien ne saute quand elles
        // apparaissent. La carte du moment est gardée en vue — la rangée
        // glisse sur ordinateur, la liste défile sur téléphone, sous le total
        // qui reste en haut.

        function reveler(carte, anime) {
            if (!carte.classList.contains('is-attente')) return;
            carte.classList.remove('is-attente');
            carte.classList.add(anime && !reduit() ? 'is-entree' : 'is-posee');
        }

        function montrer(carte) {
            const comportement = reduit() ? 'auto' : 'smooth';
            const c = carte.getBoundingClientRect();
            if (rail.scrollWidth > rail.clientWidth + 1) {
                const r = rail.getBoundingClientRect();
                const bord = r.right - (parseFloat(getComputedStyle(rail).paddingRight) || 0);
                if (c.right > bord + 1) rail.scrollBy({ left: c.right - bord, behavior: comportement });
            }
            const b = defilant.getBoundingClientRect();
            if (c.bottom > b.bottom - 12) defilant.scrollBy({ top: c.bottom - b.bottom + 12, behavior: comportement });
        }

        /** Les flèches n'arrivent qu'à la fin : pendant le spectacle, la rangée suit seule. */
        function majFleches() {
            const max = rail.scrollWidth - rail.clientWidth;
            const deborde = max > 1;
            precedent.hidden = suivant.hidden = !deborde || !fini;
            precedent.classList.toggle('is-off', rail.scrollLeft <= 1);
            suivant.classList.toggle('is-off', rail.scrollLeft >= max - 1);
            rail.classList.toggle('has-gauche', deborde && rail.scrollLeft > 1);
            rail.classList.toggle('has-droite', deborde && rail.scrollLeft < max - 1);
        }

        /** Une carte de plus ou de moins, d'une flèche. */
        function feuilleter(sens) {
            const carte = cartes[0];
            const ecart = parseFloat(getComputedStyle(rail).columnGap) || 0;
            const pas = carte ? carte.getBoundingClientRect().width + ecart : rail.clientWidth;
            rail.scrollBy({ left: sens * pas, behavior: reduit() ? 'auto' : 'smooth' });
        }

        async function jouer() {
            const duree = etapes.length > CARTES_LONGUES ? DUREE_CARTE_RAPIDE_MS : DUREE_CARTE_MS;
            sheet.style.setProperty('--fzb-step', `${duree}ms`);
            let cumul = 0;
            for (let i = 0; i < etapes.length; i++) {
                if (fini) return;
                segments.forEach((s, j) => {
                    s.classList.toggle('is-done', j < i);
                    s.classList.toggle('is-active', j === i);
                });
                etapeEnCours = i;
                const etape = etapes[i];
                cumul += etape.points;
                // Le dernier pas retombe exactement sur le total du serveur.
                const cible = i === etapes.length - 1 ? corps.total : cumul;
                const carte = cartes[i];
                reveler(carte, true);
                montrer(carte);
                // Les points partent une fois la carte posée et la liste
                // arrêtée : la pastille part de là où on la voit.
                const envoi = setTimeout(() => { if (!fini) envoyerPoints(carte, etape.points, cible, i); }, reduit() ? 0 : 650);
                await attendre(duree);
                clearTimeout(envoi);
                if (fini) return;
                // Une carte passée d'un toucher : son total tombe sans attendre le vol.
                viderVolants();
                afficherTotal(cible);
                remplirBarre(i);
            }
            conclure();
        }

        /**
         * Les deux pointages du duel montent ensemble jusqu'à leur valeur de
         * fin de soirée. Un onglet en arrière-plan ne dessine aucune image :
         * les valeurs finales tombent quand même, à l'heure prévue.
         */
        function animerDuel(zone) {
            const scores = [...zone.querySelectorAll('.fzb-duel-score')];
            const fin = () => scores.forEach(s => { s.textContent = nombre(Number(s.dataset.a)); });
            if (reduit()) { fin(); return; }
            let arret = () => {};
            setTimeout(() => {
                if (!overlay.isConnected) return;
                arret = interpoler(1100, (e, termine) => scores.forEach(s => {
                    const de = Number(s.dataset.de), a = Number(s.dataset.a);
                    s.textContent = nombre(termine ? a : de + (a - de) * e);
                }));
            }, 200);
            setTimeout(() => { arret(); fin(); }, 200 + 1100 + 250);
        }

        function conclure() {
            if (fini) return;
            fini = true;
            if (avancer) avancer();
            viderVolants();
            // « Passer » : les cartes qui restaient se posent d'un coup.
            cartes.forEach(c => reveler(c, false));
            etapes.forEach((e, i) => remplirBarre(i));
            if (barre) barre.classList.add('is-full');
            afficherTotal(corps.total);
            segments.forEach(s => { s.classList.remove('is-active'); s.classList.add('is-done'); });

            rail.classList.remove('is-show');
            rail.removeAttribute('title');
            delete rail.dataset.action;
            $('.fzb-skip').hidden = true;
            $('.fzb-list-aside').hidden = false;

            // La conclusion : le rang d'après la soirée, ou le duel qui monte.
            const resume = [`Total de la soirée : ${nombre(corps.total)} points.`];
            const rang = $('.fzb-rank');
            if (rang) {
                const r = corps.rang;
                const chiffre = $('.fzb-rank-n');
                if (r.apres !== r.avant) {
                    chiffre.innerHTML = ordinal(r.apres);
                    if (!reduit()) chiffre.classList.add('is-change');
                }
                rang.classList.remove('is-attente');
                const gain = r.avant - r.apres;
                const mouvement = gain > 0 ? `${gain} place${gain > 1 ? 's' : ''} de gagnée${gain > 1 ? 's' : ''}`
                    : gain < 0 ? `${-gain} place${gain < -1 ? 's' : ''} de perdue${gain < -1 ? 's' : ''}`
                    : 'même place';
                resume.push(`Au classement : ${chiffre.textContent}${r.equipes ? ` sur ${r.equipes}` : ''}, ${mouvement}.`);
            }
            const duel = $('.fzb-duel');
            if (duel) {
                duel.classList.remove('is-attente');
                animerDuel(duel);
                resume.push(`${duel.querySelector('.fzb-move-txt').textContent}.`);
            }
            $('.fzb-sr').textContent = resume.join(' ');
            majFleches();

            // « Passer » vient de disparaître sous le doigt ou le clavier : le
            // focus passe à l'action. Sinon il reste sur la fenêtre.
            if (document.activeElement === $('.fzb-skip') || !sheet.contains(document.activeElement)) {
                $('.fzb-detail').focus({ preventScroll: true });
            }
        }

        // ---- Tirer le panneau vers le bas pour le fermer (téléphone) ----

        function glisser() {
            const zone = $('.fzb-top');
            let y0 = null, dy = 0, t0 = 0;
            zone.addEventListener('pointerdown', e => {
                if (!telephone() || e.button !== 0 || e.target.closest('button, a')) return;
                y0 = e.clientY; dy = 0; t0 = performance.now();
                zone.setPointerCapture(e.pointerId);
                sheet.classList.add('is-drag');
            });
            zone.addEventListener('pointermove', e => {
                if (y0 === null) return;
                dy = Math.max(0, e.clientY - y0);
                sheet.style.transform = dy ? `translateY(${dy}px)` : '';
            });
            const lacher = () => {
                if (y0 === null) return;
                y0 = null;
                sheet.classList.remove('is-drag');
                const vitesse = dy / Math.max(1, performance.now() - t0);
                if (dy > 110 || (dy > 30 && vitesse > 0.6)) fermer();
                else sheet.style.transform = '';
            };
            zone.addEventListener('pointerup', lacher);
            zone.addEventListener('pointercancel', lacher);
        }

        function arreter() {
            fini = true;
            if (avancer) avancer();
            viderVolants();
            arreterCompteur();
            document.removeEventListener('keydown', clavier, true);
            window.removeEventListener('resize', majFleches);
        }

        function retirer() {
            overlay.remove();
            document.documentElement.classList.remove('fzb-lock');
            ouverte = false;
        }

        function fermer() {
            if (overlay.classList.contains('is-leaving')) return;
            arreter();
            overlay.classList.add('is-leaving');
            setTimeout(retirer, reduit() ? 0 : 240);
            if (focusAvant && typeof focusAvant.focus === 'function') focusAvant.focus({ preventScroll: true });
        }

        function clavier(e) {
            if (e.key === 'Escape') { e.preventDefault(); fermer(); return; }
            if ((e.key === 'ArrowRight' || e.key === ' ') && !fini && e.target === sheet) {
                e.preventDefault();
                if (avancer) avancer();
                return;
            }
            if (e.key !== 'Tab') return;
            // La touche Tab reste dans la fenêtre.
            const cibles = [...sheet.querySelectorAll('button:not([hidden]), a[href]:not([hidden])')]
                .filter(el => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden' && !el.classList.contains('is-off'));
            if (!cibles.length) return;
            const premier = cibles[0], dernier = cibles[cibles.length - 1];
            if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
            else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
        }

        overlay.addEventListener('click', e => {
            if (e.target === overlay) { fermer(); return; }
            const action = e.target.closest('[data-action]');
            if (!action) return;
            if (action.dataset.action === 'fermer') fermer();
            else if (action.dataset.action === 'passer') conclure();
            else if (action.dataset.action === 'avancer' && avancer) avancer();
            else if (action.dataset.action === 'precedent') feuilleter(-1);
            else if (action.dataset.action === 'suivant') feuilleter(1);
        });
        // La page change : rien à animer, et un retour arrière (cache de
        // navigation) ne doit pas retrouver la fenêtre ouverte.
        $('.fzb-detail').addEventListener('click', () => { arreter(); retirer(); });
        rail.addEventListener('scroll', majFleches, { passive: true });
        document.addEventListener('keydown', clavier, true);
        window.addEventListener('resize', majFleches);
        glisser();

        majFleches();
        sheet.focus({ preventScroll: true });
        jouer();
    }

    // ───────────────────────── Départ ─────────────────────────

    window.FZBilanSoiree = {
        /** Rejoue le bilan de la dernière soirée, même déjà vu. */
        revoir: () => verifier({ rejouer: true })
    };

    function demarrer() {
        setTimeout(() => verifier({ rejouer: forcer }), DELAI_PREMIER_MS);
        if (window.FZPool) FZPool.on(() => { if (!ouverte) verifier(); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
    else demarrer();
})();
