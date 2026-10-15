/* Bilan de la soirée — la fenêtre qui surgit quand le dernier match du soir
 * est terminé.
 *
 * Une carte par joueur de son équipe qui a joué, l'une après l'autre, du plus
 * petit apport au plus gros : ses statistiques de la soirée et ses points,
 * qui filent rejoindre le total au bas de la fenêtre. Puis la conclusion :
 *
 *   - cumulatif : le mouvement au classement pendant la soirée (▲ ▼ ou même
 *     place), et un lien vers sa fiche au classement, qui détaille la soirée
 *     joueur par joueur ;
 *   - tête-à-tête : le duel de la semaine, les deux équipes face à face avec
 *     leur logo, leur bilan et leur pointage, et un lien vers le duel.
 *
 * Le serveur décide de la soirée (routes/soiree.js) : celle du jour dès son
 * dernier match fini, sinon celle de la veille. La page lui demande au
 * chargement, puis quand il le dit (`reessaiMs`) : toutes les cinq minutes
 * pendant les matchs, toutes les demi-heures sinon, jamais en arrière-plan.
 * Une soirée montrée ne revient pas (localStorage, par pool) ; ?bilan=soiree
 * la rejoue, pour la revoir.
 *
 * Chargé en <script defer> après activePool.js. Aucune dépendance de page :
 * photos, écussons et couleurs de club arrivent prêts du serveur. */
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

    const reduit = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
        if (autreFenetreOuverte()) {
            setTimeout(() => { if (!ouverte && FZPool.get() === pool) presenter(corps, pool); }, ATTENTE_AUTRE_FENETRE_MS);
            return;
        }
        noterVu(pool, corps.jour);
        ouvrir(corps, pool);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { clearTimeout(minuteur); minuteur = null; return; }
        if (Date.now() - derniereVerif > REESSAI_MIN_MS) verifier();
    });

    // ───────────────────────── Format ─────────────────────────

    const echapper = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** Une décimale au tête-à-tête, sans « .0 » inutile. */
    function fmt(v) {
        const n = Math.round((Number(v) || 0) * 10) / 10;
        return Number.isInteger(n) ? String(n) : n.toFixed(1);
    }
    const signe = v => (v > 0 ? `+${fmt(v)}` : v < 0 ? `−${fmt(-v)}` : '0');
    const pluriel = (n, mot) => `${fmt(n)} ${mot}${Math.abs(n) > 1 ? 's' : ''}`;
    const ordinal = n => (n === 1 ? '1<sup>er</sup>' : `${n}<sup>e</sup>`);
    const ordinalTexte = n => (n === 1 ? '1er' : `${n}e`);

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

    const POSTES = { offensive: 'Attaquant', defensive: 'Défenseur', goalie: 'Gardien', rookie: 'Recrue' };
    const DECISIONS = { BL: 'Blanchissage', V: 'Victoire', DP: 'Défaite en prol.', D: 'Défaite' };

    /** Les statistiques d'une carte, en pastilles. Les tirs ne comptent qu'au tête-à-tête. */
    function statsDe(carte, enH2H) {
        if (carte.type === 'club') {
            const issue = carte.issue === 'V' ? 'Victoire'
                : carte.issue === 'DP' ? (carte.prolongation === 'SO' ? 'Défaite en t.b.' : 'Défaite en prol.')
                : 'Défaite';
            return [`${issue} ${carte.pour}-${carte.contre}`, `${carte.domicile ? 'contre' : 'à'} ${carte.adversaire}`];
        }
        if (carte.gardien) {
            return [carte.decision ? DECISIONS[carte.decision] : null, carte.arrets ? pluriel(carte.arrets, 'arrêt') : null].filter(Boolean);
        }
        return [pluriel(carte.buts, 'but'), pluriel(carte.aides, 'passe'), enH2H && carte.tirs ? pluriel(carte.tirs, 'tir') : null]
            .filter(Boolean);
    }

    /** Le style de fond d'une carte, aux couleurs de son club. */
    function styleTeinte(teinte) {
        if (!teinte) return '';
        return ` style="--fzb-surface:${echapper(teinte.surface)};--fzb-edge:${echapper(teinte.edge)};--fzb-trim:${echapper(teinte.trim)}"`;
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
            return `<span class="${cls} is-club">${ecusson ? `<img src="${echapper(ecusson)}" alt="" onerror="this.remove()">` : repli}</span>`;
        }
        // L'image AVANT les initiales : la photo détourée les cache ; si
        // elle ne charge pas, elle se retire et les découvre.
        return `<span class="${cls}">${carte.photo ? `<img src="${echapper(carte.photo)}" alt="" onerror="this.remove()">` : ''}${repli}</span>`;
    }

    function carteHTML(carte, enH2H) {
        const ecusson = carte.teinte && carte.teinte.crest
            ? `<img class="fzb-card-crest" src="${echapper(carte.teinte.crest)}" alt="" onerror="this.remove()">` : '';
        const meta = carte.type === 'club'
            ? 'Club de la LNH'
            : [carte.club, POSTES[carte.categorie] || (carte.gardien ? 'Gardien' : '')].filter(Boolean).join(' · ');
        const pastilles = statsDe(carte, enH2H).map(s => `<li>${echapper(s)}</li>`).join('');
        const classePts = carte.points > 0 ? 'is-plus' : carte.points < 0 ? 'is-moins' : 'is-zero';
        return `
            <article class="fzb-card${carte.type === 'club' ? ' is-club' : ''}"${styleTeinte(carte.teinte)}>
                ${ecusson}
                ${photoHTML(carte, 'fzb-card-photo')}
                <div class="fzb-card-info">
                    <h3 class="fzb-card-name">${echapper(carte.nom)}</h3>
                    <p class="fzb-card-meta">${echapper(meta)}</p>
                    <ul class="fzb-card-stats">${pastilles}</ul>
                </div>
                <div class="fzb-card-pts ${classePts}"><span class="fzb-card-pts-v">${signe(carte.points)}</span><span class="fzb-card-pts-l">pts</span></div>
            </article>`;
    }

    /** Ceux qui ont joué sans marquer : une seule carte, leurs visages côte à côte. */
    function carteGroupeHTML(cartes) {
        const visages = cartes.slice(0, 5).map(c => `<span class="fzb-face"${styleTeinte(c.teinte)}>${photoHTML(c, 'fzb-face-photo')}</span>`).join('');
        const noms = cartes.map(c => c.nom).join(', ');
        const titre = cartes.length > 1 ? `${cartes.length} joueurs sans point` : '1 joueur sans point';
        return `
            <article class="fzb-card is-groupe">
                <div class="fzb-faces">${visages}${cartes.length > 5 ? `<span class="fzb-face is-plus">+${cartes.length - 5}</span>` : ''}</div>
                <div class="fzb-card-info">
                    <h3 class="fzb-card-name">${titre}</h3>
                    <p class="fzb-card-meta">${echapper(noms)}</p>
                </div>
                <div class="fzb-card-pts is-zero"><span class="fzb-card-pts-v">0</span><span class="fzb-card-pts-l">pts</span></div>
            </article>`;
    }

    function carteVideHTML() {
        return `
            <article class="fzb-card is-vide">
                <div class="fzb-card-info">
                    <h3 class="fzb-card-name">Soirée de congé</h3>
                    <p class="fzb-card-meta">Aucun de vos joueurs n’a joué ce soir.</p>
                </div>
            </article>`;
    }

    /**
     * L'ordre de passage : ceux qui n'ont rien marqué d'abord, en une carte,
     * puis du plus petit apport au plus gros — la meilleure soirée ferme la
     * marche. Le serveur les donne du meilleur au moins bon.
     */
    function etapesDe(corps) {
        const enH2H = corps.mode === 'head-to-head';
        const zeros = corps.cartes.filter(c => !c.points);
        const marqueurs = corps.cartes.filter(c => c.points).reverse();
        const etapes = [];
        if (zeros.length) etapes.push({ html: carteGroupeHTML(zeros), points: 0 });
        marqueurs.forEach(c => etapes.push({ html: carteHTML(c, enH2H), points: c.points }));
        if (!etapes.length) etapes.push({ html: carteVideHTML(), points: 0 });
        return etapes;
    }

    // ───────────────────────── Conclusion ─────────────────────────

    const FLECHE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    const TRIANGLE_HAUT = '<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><path d="M12 4l8 10H4z" fill="currentColor"/></svg>';
    const TRIANGLE_BAS = '<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><path d="M12 20L4 10h16z" fill="currentColor"/></svg>';

    function rangHTML(rang) {
        if (!rang || !rang.avant || !rang.apres) return '';
        const gain = rang.avant - rang.apres;
        const sur = rang.equipes ? ` sur ${rang.equipes}` : '';
        let classe = 'is-flat', pastille = 'Même place', phrase = `Vous gardez la ${ordinalTexte(rang.apres)} place${sur}.`;
        if (gain > 0) {
            classe = 'is-up';
            pastille = `${TRIANGLE_HAUT}${gain} place${gain > 1 ? 's' : ''}`;
            phrase = `Vous gagnez ${gain} place${gain > 1 ? 's' : ''} : ${ordinalTexte(rang.apres)}${sur}.`;
        } else if (gain < 0) {
            classe = 'is-down';
            pastille = `${TRIANGLE_BAS}${-gain} place${gain < -1 ? 's' : ''}`;
            phrase = `Vous perdez ${-gain} place${gain < -1 ? 's' : ''} : ${ordinalTexte(rang.apres)}${sur}.`;
        }
        const avant = gain !== 0 ? `<span class="fzb-rank-from">${ordinal(rang.avant)}</span><span class="fzb-rank-arrow">${FLECHE}</span>` : '';
        return `
            <section class="fzb-rank ${classe}" aria-label="Mouvement au classement">
                <p class="fzb-label">Au classement</p>
                <div class="fzb-rank-row">
                    ${avant}
                    <span class="fzb-rank-to">${ordinal(rang.apres)}</span>
                    <span class="fzb-rank-badge">${pastille}</span>
                </div>
                <p class="fzb-rank-sub">${phrase}</p>
            </section>`;
    }

    function duelEquipeHTML(equipe, cote, mene) {
        const { v, d, n } = equipe.bilan || { v: 0, d: 0, n: 0 };
        const depart = Math.round(((Number(equipe.points) || 0) - (Number(equipe.soiree) || 0)) * 10) / 10;
        return `
            <div class="fzb-duel-team is-${cote}${mene ? ' is-lead' : ''}">
                ${logoEquipeHTML(equipe, 'fzb-duel-logo')}
                <span class="fzb-duel-name" title="${echapper(equipe.nom)}">${echapper(equipe.nom)}</span>
                <span class="fzb-duel-rec">${v}-${d}-${n}${equipe.rang ? ` · ${ordinal(equipe.rang)}` : ''}</span>
                <span class="fzb-duel-score" data-de="${depart}" data-a="${Number(equipe.points) || 0}">${fmt(depart)}</span>
                <span class="fzb-duel-soir">${signe(equipe.soiree)} ce soir</span>
                ${cote === 'nous' ? '<span class="fzb-duel-you">Vous</span>' : ''}
            </div>`;
    }

    function duelHTML(duel) {
        if (!duel) return '';
        const ecart = (Number(duel.nous.points) || 0) - (Number(duel.eux.points) || 0);
        const ecartTexte = fmt(Math.abs(ecart));
        let etat, classe;
        if (duel.final) {
            [etat, classe] = { W: ['Victoire', 'is-win'], L: ['Défaite', 'is-loss'], T: ['Nulle', 'is-tie'] }[duel.issue] || ['Nulle', 'is-tie'];
            if (duel.issue === 'W' || duel.issue === 'L') etat += ` par ${ecartTexte}`;
        } else if (ecart > 0) {
            etat = `Vous menez par ${ecartTexte}`; classe = 'is-win';
        } else if (ecart < 0) {
            etat = `Vous tirez de l’arrière par ${ecartTexte}`; classe = 'is-loss';
        } else {
            etat = 'Égalité parfaite'; classe = 'is-tie';
        }
        const reste = 7 - duel.jourDeSemaine;
        const quand = duel.final
            ? `Semaine ${duel.semaine} · Résultat final`
            : `Semaine ${duel.semaine} · Jour ${duel.jourDeSemaine} de 7`;
        const suite = !duel.final && reste > 0 ? `<p class="fzb-duel-note">Encore ${reste} jour${reste > 1 ? 's' : ''} au duel.</p>` : '';
        const meneur = ecart > 0 ? 'nous' : ecart < 0 ? 'eux' : null;
        return `
            <section class="fzb-duel" aria-label="Votre duel de la semaine">
                <p class="fzb-label">${quand}</p>
                <div class="fzb-duel-grid">
                    ${duelEquipeHTML(duel.nous, 'nous', meneur === 'nous')}
                    <div class="fzb-duel-vs"><span>VS</span><span class="fzb-duel-caret${meneur ? ` is-${meneur}` : ''}" aria-hidden="true"></span></div>
                    ${duelEquipeHTML(duel.eux, 'eux', meneur === 'eux')}
                </div>
                <p class="fzb-duel-status ${classe}">${etat}</p>
                ${suite}
            </section>`;
    }

    function recapHTML(corps) {
        if (!corps.cartes.length) return '';
        const enH2H = corps.mode === 'head-to-head';
        const lignes = corps.cartes.map(c => `
            <li class="fzb-recap-row"${styleTeinte(c.teinte)}>
                ${photoHTML(c, 'fzb-recap-photo')}
                <span class="fzb-recap-txt">
                    <span class="fzb-recap-name">${echapper(c.nom)}</span>
                    <span class="fzb-recap-line">${echapper(statsDe(c, enH2H).join(' · '))}</span>
                </span>
                <span class="fzb-recap-pts${c.points > 0 ? ' is-plus' : c.points < 0 ? ' is-moins' : ''}">${signe(c.points)}</span>
            </li>`).join('');
        return `
            <section class="fzb-recap" aria-label="Vos joueurs ce soir">
                <p class="fzb-label">Vos joueurs ce soir</p>
                <ul class="fzb-recap-list">${lignes}</ul>
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

    function ouvrir(corps, pool) {
        ouverte = true;
        const enH2H = corps.mode === 'head-to-head';
        const etapes = etapesDe(corps);
        const focusAvant = document.activeElement;

        const lienDetail = enH2H && corps.duel
            ? `classement.html?pool=${encodeURIComponent(pool)}&h2h=matchups&semaine=${corps.duel.semaine}`
            : `classement.html?pool=${encodeURIComponent(pool)}&equipe=${encodeURIComponent(corps.equipe.cle)}`;
        const texteDetail = enH2H && corps.duel ? 'Voir le duel' : 'Voir le détail au classement';

        const overlay = document.createElement('div');
        overlay.className = 'fzb-overlay';
        overlay.innerHTML = `
            <section class="fzb-sheet" role="dialog" aria-modal="true" aria-labelledby="fzbTitre" aria-describedby="fzbEquipe" tabindex="-1">
                <header class="fzb-head">
                    <div class="fzb-progress" aria-hidden="true">${etapes.map(() => '<span class="fzb-seg"><i></i></span>').join('')}</div>
                    <div class="fzb-head-row">
                        ${logoEquipeHTML(corps.equipe, 'fzb-logo')}
                        <div class="fzb-titles">
                            <p class="fzb-eyebrow">Bilan de la soirée</p>
                            <h2 class="fzb-title" id="fzbTitre">${echapper(dateLongue(corps.jour))}</h2>
                            <p class="fzb-team" id="fzbEquipe">${echapper(corps.equipe.nom)}</p>
                        </div>
                        <button type="button" class="fzb-close" data-action="fermer" aria-label="Fermer le bilan">${ICONE_FERMER}</button>
                    </div>
                </header>
                <div class="fzb-body">
                    <div class="fzb-stage" data-action="avancer" title="Touchez pour passer à la carte suivante"></div>
                    <div class="fzb-finale" hidden></div>
                </div>
                <div class="fzb-tally">
                    <span class="fzb-tally-label">Total de la soirée</span>
                    <span class="fzb-tally-value"><span class="fzb-tally-n">0</span><small>pts</small></span>
                </div>
                <footer class="fzb-foot">
                    <button type="button" class="fzb-btn-text fzb-skip" data-action="passer">Passer <span aria-hidden="true">›</span></button>
                    <a class="fzb-btn-primary fzb-detail" href="${lienDetail}" hidden>${texteDetail}</a>
                    <button type="button" class="fzb-btn-secondary fzb-done" data-action="fermer" hidden>Fermer</button>
                </footer>
                <p class="fzb-sr" role="status" aria-live="polite"></p>
            </section>`;
        document.body.appendChild(overlay);
        document.documentElement.classList.add('fzb-lock');

        const $ = sel => overlay.querySelector(sel);
        const sheet = $('.fzb-sheet');
        const stage = $('.fzb-stage');
        const segments = [...overlay.querySelectorAll('.fzb-seg')];
        const tallyN = $('.fzb-tally-n');
        const tally = $('.fzb-tally');

        let total = 0;                  // ce que le compteur affiche
        let arreterCompteur = () => {};
        let avancer = null;             // termine l'attente de la carte en cours
        let fini = false;
        let etapeEnCours = -1;          // l'étape dont les points volent
        const volants = new Map();      // pastille → son animation

        function afficherTotal(v) {
            arreterCompteur();
            total = v;
            tallyN.textContent = fmt(v);
        }

        function animerTotal(cible, ms) {
            arreterCompteur();
            const depart = total;
            if (reduit() || ms <= 0 || depart === cible) { afficherTotal(cible); return; }
            arreterCompteur = interpoler(ms, (e, termine) => {
                total = termine ? cible : depart + (cible - depart) * e;
                tallyN.textContent = fmt(total);
            });
            tally.classList.remove('is-bump');
            void tally.offsetWidth;
            tally.classList.add('is-bump');
        }

        /**
         * Les points de la carte filent jusqu'au total, puis il grimpe. Un vol
         * qui finit après sa carte (passée d'un toucher) ne touche plus au
         * total : il comptait vers celui d'une étape déjà close.
         */
        function envoyerPoints(carte, points, cible) {
            const mienne = etapeEnCours;
            const source = carte.querySelector('.fzb-card-pts-v');
            if (!points || !source || reduit() || !source.animate) { animerTotal(cible, 420); return; }
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
                { transform: `translate(calc(-50% + ${dx * 0.55}px), calc(-50% + ${dy * 0.35}px)) scale(1.15)`, opacity: 1, offset: 0.45 },
                { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.55)`, opacity: 0.2 }
            ], { duration: 560, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
            volants.set(volant, vol);
            vol.onfinish = () => {
                volant.remove();
                volants.delete(volant);
                if (!fini && mienne === etapeEnCours) animerTotal(cible, 420);
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

        function poserCarte(html) {
            const ancienne = stage.querySelector('.fzb-card:not(.is-leaving)');
            if (ancienne) {
                ancienne.classList.add('is-leaving');
                setTimeout(() => ancienne.remove(), reduit() ? 0 : 360);
            }
            const gabarit = document.createElement('template');
            gabarit.innerHTML = html.trim();
            const carte = gabarit.content.firstElementChild;
            carte.classList.add('is-entering');
            stage.appendChild(carte);
            return carte;
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
                const carte = poserCarte(etape.html);
                const envoi = setTimeout(() => { if (!fini) envoyerPoints(carte, etape.points, cible); }, reduit() ? 0 : 520);
                await attendre(duree);
                clearTimeout(envoi);
                if (fini) return;
                // Une carte passée d'un toucher : son total tombe sans attendre le vol.
                viderVolants();
                afficherTotal(cible);
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
            const fin = () => scores.forEach(s => { s.textContent = fmt(Number(s.dataset.a)); });
            if (reduit()) { fin(); return; }
            let arret = () => {};
            setTimeout(() => {
                if (!overlay.isConnected) return;
                arret = interpoler(1100, (e, termine) => scores.forEach(s => {
                    const de = Number(s.dataset.de), a = Number(s.dataset.a);
                    s.textContent = fmt(termine ? a : de + (a - de) * e);
                }));
            }, 350);
            setTimeout(() => { arret(); fin(); }, 350 + 1100 + 250);
        }

        function conclure() {
            if (fini) return;
            fini = true;
            if (avancer) avancer();
            viderVolants();
            afficherTotal(corps.total);
            segments.forEach(s => { s.classList.remove('is-active'); s.classList.add('is-done'); });

            const finale = $('.fzb-finale');
            finale.innerHTML = (enH2H ? duelHTML(corps.duel) : rangHTML(corps.rang)) + recapHTML(corps);
            stage.hidden = true;
            finale.hidden = false;
            $('.fzb-skip').hidden = true;
            $('.fzb-detail').hidden = false;
            $('.fzb-done').hidden = false;
            if (enH2H) animerDuel(finale);

            const resume = [`Total de la soirée : ${fmt(corps.total)} points.`];
            if (!enH2H && corps.rang && corps.rang.apres) {
                const r = finale.querySelector('.fzb-rank-sub');
                if (r) resume.push(r.textContent);
            }
            if (enH2H && corps.duel) {
                const s = finale.querySelector('.fzb-duel-status');
                if (s) resume.push(s.textContent);
            }
            $('.fzb-sr').textContent = resume.join(' ');
            // « Passer » vient de disparaître sous le doigt ou le clavier : le
            // focus passe à l'action. Sinon il reste sur la fenêtre.
            const skip = $('.fzb-skip');
            if (document.activeElement === skip || sheet.contains(document.activeElement) === false) {
                $('.fzb-detail').focus({ preventScroll: true });
            }
        }

        function arreter() {
            fini = true;
            if (avancer) avancer();
            viderVolants();
            arreterCompteur();
            document.removeEventListener('keydown', clavier, true);
        }

        function retirer() {
            overlay.remove();
            document.documentElement.classList.remove('fzb-lock');
            ouverte = false;
        }

        function fermer() {
            arreter();
            overlay.classList.add('is-leaving');
            setTimeout(retirer, reduit() ? 0 : 200);
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
                .filter(el => el.offsetParent !== null);
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
        });
        // La page change : rien à animer, et un retour arrière (cache de
        // navigation) ne doit pas retrouver la fenêtre ouverte.
        $('.fzb-detail').addEventListener('click', () => { arreter(); retirer(); });
        document.addEventListener('keydown', clavier, true);

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
