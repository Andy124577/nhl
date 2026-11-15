/**
 * RÉCENTS — ce qui vient d'arriver dans le pool actif, du plus récent au
 * plus ancien.
 *
 * Une seule lecture au serveur pour l'essentiel (/api/pools/:pool/recents :
 * matchs de ma soirée, blessés et mouvements LNH du pool, fil d'activité).
 * Deux lectures que d'autres écrans font déjà sont reprises de leur mémoire
 * (FZMemo, fzReactif.js) : les offres reçues (la pastille de la barre, même
 * clé) et le bilan de la soirée.
 *
 * Pas de sondage permanent : la page se relit à l'ouverture, au retour sur
 * l'onglet, et chaque minute SEULEMENT tant qu'un de mes matchs est en jeu.
 * Les relectures ne touchent pas la base tant que rien n'y a été écrit
 * (routes/recents.js) ; elles ne réveillent donc pas Neon pour rien.
 */
(function () {
    'use strict';

    const BASE = window.location.hostname.includes('localhost') ? 'http://localhost:3000' : '';
    const FRAIS_MS = 30000;
    const DIRECT_MS = 60000;
    const BILAN_MS = 10 * 60 * 1000;
    const CLE_FILTRE = 'fzRecentsFiltre';

    const FILTRES = [
        ['tout', 'Tout'],
        ['mien', 'Mes joueurs'],
        ['pool', 'Pool'],
        ['lnh', 'LNH']
    ];

    const etat = { pool: null, user: null, donnees: null, offres: [], bilan: null, filtre: 'tout', minuteur: null, luA: 0 };

    // ---------- outils ----------
    const esc = v => String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const url = (page, params) => {
        const q = Object.entries(params || {}).filter(([, v]) => v != null && v !== '')
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
        return q ? `${page}?${q}` : page;
    };
    const nomsDe = liste => (liste || []).map(p => (typeof p === 'string' ? p : p && (p.name || p.nom))).filter(Boolean);
    const initiales = nom => String(nom || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(m => m[0]).join('').toUpperCase();
    const pts = n => {
        const v = Math.round((Number(n) || 0) * 10) / 10;
        return `${v > 0 ? '+' : ''}${String(v).replace('.', ',')}`;
    };

    const FUSEAU = 'America/Toronto';
    const fmtJour = new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' });
    const fmtHeure = new Intl.DateTimeFormat('fr-CA', { timeZone: FUSEAU, hour: 'numeric', minute: '2-digit' });
    const fmtDate = new Intl.DateTimeFormat('fr-CA', { timeZone: FUSEAU, weekday: 'long', day: 'numeric', month: 'long' });
    const journee = d => fmtJour.format(d);
    const decaler = (jour, n) => {
        const d = new Date(`${jour}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
    };
    const heure = iso => fmtHeure.format(new Date(iso)).replace(':', ' h ');

    /** « il y a 4 min », « 14 h 12 », ou rien pour une date seule. */
    function quand(entree) {
        if (!entree.moment || entree.dateSeule) return '';
        const ms = Date.now() - Date.parse(entree.moment);
        if (!Number.isFinite(ms)) return '';
        if (ms < 60000) return 'à l’instant';
        if (ms < 3600000) return `il y a ${Math.round(ms / 60000)} min`;
        return heure(entree.moment);
    }

    /** Le groupe d'une entrée : Aujourd’hui, Hier, un jour de la semaine, Plus tôt. */
    function groupeDe(entree, aujourdhui) {
        if (!entree.moment) return { cle: 'z-encours', titre: 'Absences en cours' };
        const jour = entree.jour || journee(new Date(entree.moment));
        if (jour >= aujourdhui) return { cle: `a-${aujourdhui}`, titre: 'Aujourd’hui' };
        if (jour === decaler(aujourdhui, -1)) return { cle: `b-${jour}`, titre: 'Hier' };
        if (jour > decaler(aujourdhui, -7)) {
            const t = fmtDate.format(new Date(`${jour}T12:00:00Z`));
            return { cle: `c-${jour}`, titre: t.charAt(0).toUpperCase() + t.slice(1) };
        }
        return { cle: 'y-avant', titre: 'Plus tôt' };
    }

    // ---------- entrées du fil ----------
    // Chaque entrée : { cat: 'mien'|'pool'|'lnh', mien, moment, face, tag, ton, texte (HTML), fin (HTML), href }

    function faceJoueur(nom, photo, badge) {
        const marque = badge ? `<i class="rc-pastille ${badge[1]}" aria-hidden="true">${badge[0]}</i>` : '';
        return `<span class="rc-face">${esc(initiales(nom))}${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}${marque}</span>`;
    }
    const faceClub = abbrev => `<span class="rc-face is-club"><img src="teams/${esc(abbrev)}.png" alt="" loading="lazy" onerror="this.remove()"><b>${esc(abbrev)}</b></span>`;
    const faceIcone = txt => `<span class="rc-face is-icone">${txt}</span>`;
    const bouton = texte => `<span class="rc-cta">${esc(texte)}</span>`;

    function entreesMatchs(matchs) {
        return (matchs || []).map(m => {
            const score = m.etat === 'FUT' ? `${esc(m.visiteur.abbrev)} – ${esc(m.local.abbrev)}`
                : `${esc(m.visiteur.abbrev)} ${m.visiteur.score ?? 0} – ${m.local.score ?? 0} ${esc(m.local.abbrev)}`;
            const qui = [
                ...m.joueurs.map(j => `${esc(j.nom.split(' ').slice(1).join(' ') || j.nom)}${j.points ? ` <b>${pts(j.points)}</b>` : ''}`),
                ...m.clubs.map(c => `${esc(c.club)} (club)${c.points ? ` <b>${pts(c.points)}</b>` : ''}`)
            ].join(' · ');
            let tag, ton = '';
            if (m.etat === 'LIVE') {
                const per = m.typePeriode === 'OT' ? 'Prolongation' : m.typePeriode === 'SO' ? 'Tirs de barrage'
                    : m.periode ? `${m.periode}${m.periode === 1 ? 're' : 'e'} période` : 'En cours';
                tag = `<span class="rc-direct">En direct · ${m.entracte ? 'Entracte' : esc(per)}${m.horloge && !m.entracte ? ` · ${esc(m.horloge)}` : ''}</span>`;
                ton = 'is-rouge';
            } else if (m.etat === 'FINAL') {
                tag = 'Final'; ton = '';
            } else {
                tag = m.debut ? `Ce soir · ${esc(heure(m.debut))}` : 'Ce soir';
            }
            return {
                cat: 'mien', mien: true, soir: true, moment: m.debut, dateSeule: true, tagHTML: tag, ton,
                face: faceClub(m.etat === 'FUT' ? m.visiteur.abbrev : (m.joueurs.length ? m.visiteur.abbrev : (m.clubs[0] || {}).club || m.visiteur.abbrev)),
                texte: `<strong>${score}</strong>${qui ? `<span class="rc-qui">${qui}</span>` : ''}`,
                fin: m.etat === 'FUT' ? '' : `<span class="rc-pts${m.points > 0 ? ' is-plus' : ''}">${pts(m.points)}<small>tes pts</small></span>`,
                href: m.id ? url('match.html', { id: m.id }) : null
            };
        });
    }

    function entreesBlessures(liste) {
        return (liste || []).map(b => {
            const nature = b.natureFr || '';
            const retour = b.retour ? `, retour prévu ${fmtDate.format(new Date(b.retour)).replace(/^\w+ /, '')}` : '';
            return {
                cat: b.mien ? 'mien' : 'lnh', mien: b.mien, moment: b.moment,
                face: faceJoueur(b.joueur, b.photo, ['+', 'is-rouge']),
                tag: b.mien ? 'Blessure · ton joueur' : `Blessure · ${b.equipe}`, ton: 'is-rouge',
                texte: `<strong>${esc(b.joueur)}</strong> ${b.statut === 'Suspension' ? 'est suspendu' : `: ${esc((b.statutFr || 'absent').toLowerCase())}`}${nature ? ` (${esc(nature.charAt(0).toLowerCase() + nature.slice(1))})` : ''}${esc(retour)}`,
                fin: b.mien ? bouton('Mon équipe') : '',
                href: b.mien ? url('classement.html', { vue: 'equipe' }) : null
            };
        });
    }

    // Les genres du journal LNH (server.js, doRefreshNhlTransactions).
    const GENRES_LNH = { trade: 'Échange LNH', signing: 'Signature', departure: 'Retiré de l’alignement' };

    function entreesLNH(liste) {
        return (liste || []).map(t => {
            const trajet = t.de && t.vers ? `passe de ${esc(t.de)} à ${esc(t.vers)}`
                : t.vers ? `rejoint ${esc(t.vers)}` : t.de ? `quitte ${esc(t.de)}` : 'change de club';
            return {
                cat: t.mien ? 'mien' : 'lnh', mien: t.mien, moment: t.moment, jour: t.jour, dateSeule: true,
                face: faceJoueur(t.joueur, t.photo),
                tag: GENRES_LNH[t.genre] || 'Mouvement LNH', ton: 'is-bleu',
                texte: `<strong>${esc(t.joueur)}</strong> ${trajet}<span class="rc-qui">${t.mien ? 'Dans ton équipe' : `Chez ${esc(t.equipe)}`}</span>`
            };
        });
    }

    function categorieAnnonce(cat) {
        const c = String(cat || '').toLowerCase();
        if (c === 'f' || c.startsWith('off')) return 'F';
        if (c === 'd' || c.startsWith('def')) return 'D';
        if (c === 'g' || c.startsWith('goal')) return 'G';
        if (c === 'r' || c.startsWith('rook')) return 'R';
        if (c === 't' || c.startsWith('team')) return 'T';
        return '';
    }

    function entreesPool(liste, monEquipe) {
        return (liste || []).map(e => {
            const s = e.sujet || {};
            const base = { cat: 'pool', mien: false, moment: e.moment, face: faceJoueur(e.joueur || '', e.photo) };
            switch (e.genre) {
                case 'trade_completed': {
                    const mien = s.fromTeam === monEquipe || s.toTeam === monEquipe;
                    return { ...base, mien, tag: 'Échange conclu', ton: 'is-vert',
                        texte: `<strong>${esc(s.fromTeam)}</strong> envoie ${esc((s.offering || []).join(', '))} à <strong>${esc(s.toTeam)}</strong> contre ${esc((s.receiving || []).join(', '))}` };
                }
                case 'listing_activated': {
                    const mien = s.teamName === monEquipe;
                    const code = categorieAnnonce(s.category);
                    return { ...base, mien, tag: 'En vente', ton: 'is-or',
                        face: code === 'T' ? faceIcone('★') : base.face,
                        texte: mien ? `Tu as mis <strong>${esc(s.playerName)}</strong> sur le marché`
                            : `<strong>${esc(s.teamName)}</strong> met ${esc(s.playerName)} sur le marché`,
                        fin: mien ? '' : bouton('Offrir'),
                        href: mien ? 'trade.html' : url('trade.html', { withTeam: s.teamName, wantPlayer: s.playerName, category: code }) };
                }
                case 'h2h_week_finalized':
                    return { ...base, face: faceIcone(esc(s.weekNumber || '')), tag: e.revisee ? 'Semaine révisée' : 'Semaine finie', ton: '',
                        texte: esc(e.texte), fin: '<span class="rc-fleche" aria-hidden="true">›</span>',
                        href: url('classement.html', { onglet: 'h2h', semaine: s.weekNumber }) };
                case 'draft_complete':
                    return { ...base, face: faceIcone('✓'), tag: 'Repêchage', texte: esc(e.texte) };
                default:
                    return { ...base, face: faceIcone('•'), tag: 'Pool', texte: esc(e.texte) };
            }
        });
    }

    function entreesOffres(offres) {
        return (offres || []).map(t => ({
            cat: 'mien', mien: true, moment: t.date || t.createdAt || null,
            face: faceJoueur(nomsDe(t.offering)[0] || '', null),
            tag: 'Offre reçue', ton: 'is-encre',
            texte: `<strong>${esc(t.fromTeam)}</strong> t’offre ${esc(nomsDe(t.offering).join(', '))} pour ${esc(nomsDe(t.receiving).join(', '))}`,
            fin: bouton('Voir'),
            href: url('trade.html', { trade: t.id })
        }));
    }

    function entreeBilan(b) {
        if (!b || !b.pret || b.vu || !b.jour) return [];
        const rang = b.rang || {};
        const fleche = rang.avant && rang.apres && rang.avant !== rang.apres
            ? `<span class="rc-pts ${rang.apres < rang.avant ? 'is-plus' : 'is-moins'}">${rang.apres < rang.avant ? '▲' : '▼'}${Math.abs(rang.avant - rang.apres)}<small>${rang.apres === 1 ? '1er' : `${rang.apres}e`}</small></span>`
            : '';
        const phrase = typeof rang.phrase === 'string' ? rang.phrase
            : (rang.phrase && typeof rang.phrase.texte === 'string' ? rang.phrase.texte : '');
        return [{
            cat: 'mien', mien: true, moment: `${b.jour}T23:59:00`, jour: b.jour, dateSeule: true,
            face: faceIcone('★'), tag: 'Bilan de ta soirée', ton: '',
            texte: `<strong>${pts(b.total)} pts</strong>${phrase ? ` · ${esc(phrase)}` : ''}`,
            fin: fleche
        }];
    }

    // ---------- rendu ----------
    function toutesLesEntrees() {
        const d = etat.donnees || {};
        return [
            ...entreesMatchs(d.ceSoir),
            ...entreesOffres(etat.offres),
            ...entreeBilan(etat.bilan),
            ...entreesBlessures(d.blessures),
            ...entreesLNH(d.lnh),
            ...entreesPool(d.pool, d.monEquipe)
        ];
    }

    function garder(e, filtre) {
        if (filtre === 'tout') return true;
        if (filtre === 'mien') return e.mien;
        return e.cat === filtre;
    }

    function ligneHTML(e) {
        const balise = e.href ? 'a' : 'div';
        const lien = e.href ? ` href="${esc(e.href)}"` : '';
        const moment = quand(e);
        const tag = e.tagHTML || esc(e.tag);
        return `<li class="${e.mien ? 'is-mien' : ''}"><${balise} class="rc-ligne"${lien}>
            ${e.face}
            <span class="rc-txt">
                <span class="rc-tag ${e.ton || ''}">${tag}${moment ? ` <span class="rc-quand">· ${esc(moment)}</span>` : ''}</span>
                <span class="rc-texte">${e.texte}</span>
            </span>
            ${e.fin || ''}
        </${balise}></li>`;
    }

    function rendreFiltres() {
        const alertes = toutesLesEntrees().filter(e => e.mien && (e.ton === 'is-rouge' || e.tag === 'Offre reçue') && !e.soir).length;
        document.getElementById('rcFiltres').innerHTML = FILTRES.map(([cle, libelle]) =>
            `<button type="button" class="rc-chip" data-filtre="${cle}" aria-pressed="${cle === etat.filtre}">${libelle}${cle === 'mien' && alertes ? `<b>${alertes}</b>` : ''}</button>`
        ).join('');
    }

    function rendre() {
        const fil = document.getElementById('rcFil');
        const d = etat.donnees;
        rendreFiltres();
        if (!d) return;
        const aujourdhui = d.aujourdhui || journee(new Date());
        const entrees = toutesLesEntrees().filter(e => garder(e, etat.filtre));
        const soir = entrees.filter(e => e.soir);
        const reste = entrees.filter(e => !e.soir)
            .sort((a, b) => {
                if (!a.moment || !b.moment) return (a.moment ? -1 : b.moment ? 1 : 0) || (b.mien - a.mien);
                return (Date.parse(b.moment) || 0) - (Date.parse(a.moment) || 0) || (b.mien - a.mien);
            });

        const groupes = [];
        if (soir.length) groupes.push({ titre: 'Ce soir', entrees: soir });
        const parCle = new Map();
        for (const e of reste) {
            const g = groupeDe(e, aujourdhui);
            if (!parCle.has(g.cle)) { parCle.set(g.cle, { titre: g.titre, entrees: [] }); groupes.push(parCle.get(g.cle)); }
            parCle.get(g.cle).entrees.push(e);
        }
        // Les absences sans date (Rotowire) : les miennes d'abord.
        const encours = parCle.get('z-encours');
        if (encours) encours.entrees.sort((a, b) => b.mien - a.mien);

        if (!groupes.length) {
            const vide = {
                tout: 'Rien de neuf dans ton pool pour l’instant.',
                mien: 'Rien de neuf pour tes joueurs.',
                pool: 'Aucun échange ni joueur en vente récemment.',
                lnh: 'Aucune blessure ni mouvement LNH pour les joueurs du pool.'
            }[etat.filtre];
            fil.innerHTML = `<p class="rc-vide">${vide}</p>`;
            return;
        }
        fil.innerHTML = groupes.map(g => `
            <section class="rc-groupe">
                <h2 class="rc-jour">${esc(g.titre)}</h2>
                <ul class="rc-liste">${g.entrees.map(ligneHTML).join('')}</ul>
            </section>`).join('');
        fil.removeAttribute('aria-busy');
    }

    function majFraicheur() {
        const el = document.getElementById('rcMaj');
        if (!el || !etat.luA) return;
        const min = Math.round((Date.now() - etat.luA) / 60000);
        el.textContent = min < 1 ? 'À jour' : `À jour il y a ${min} min`;
        el.hidden = false;
    }

    // ---------- lectures ----------
    async function lireJSON(chemin) {
        const r = await fetch(`${BASE}${chemin}`, { cache: 'no-store', credentials: 'same-origin' });
        if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
        return r.json();
    }

    async function charger({ force = false } = {}) {
        const enc = encodeURIComponent(etat.pool);
        const memo = window.FZMemo;
        const cle = `recents:${etat.pool}`;
        if (force && memo) memo.oublier(cle);
        const principal = memo ? memo.charger(cle, () => lireJSON(`/api/pools/${enc}/recents`), { fraisMs: FRAIS_MS })
            : lireJSON(`/api/pools/${enc}/recents`);
        // Même clé que la pastille de la barre (navbar.js) : déjà en mémoire.
        const offres = (memo ? memo.charger(`nav:echanges:${etat.user}`, () => lireJSON(`/trades/pending/${encodeURIComponent(etat.user)}`), { fraisMs: FRAIS_MS })
            : lireJSON(`/trades/pending/${encodeURIComponent(etat.user)}`)).catch(() => []);
        const bilan = (memo ? memo.charger(`recents:bilan:${etat.pool}`, () => lireJSON(`/api/pools/${enc}/bilan-soiree`), { fraisMs: BILAN_MS })
            : lireJSON(`/api/pools/${enc}/bilan-soiree`)).catch(() => null);

        offres.then(liste => {
            etat.offres = (Array.isArray(liste) ? liste : []).filter(t => t.draftName === etat.pool);
            if (etat.donnees) rendre();
        });
        bilan.then(b => { etat.bilan = b; if (etat.donnees) rendre(); });

        try {
            etat.donnees = await principal;
            etat.luA = Date.now();
            rendre();
            majFraicheur();
        } catch (erreur) {
            if (!etat.donnees) {
                document.getElementById('rcFil').innerHTML = `<p class="rc-vide">Le fil n’a pas pu se charger. <button type="button" class="rc-reessayer" data-reessayer>Réessayer</button></p>`;
            }
        }
        planifier();
    }

    /** Une minute tant qu'un de mes matchs est en jeu ; sinon rien. */
    function planifier() {
        clearTimeout(etat.minuteur);
        const enJeu = ((etat.donnees && etat.donnees.ceSoir) || []).some(m => m.etat === 'LIVE');
        if (!enJeu || document.hidden) return;
        etat.minuteur = setTimeout(() => charger({ force: true }), DIRECT_MS);
    }

    // ---------- démarrage ----------
    function squelette() {
        const os = '<li><div class="rc-ligne is-os"><span class="rc-face"></span><span class="rc-txt"><span></span><span></span></span></div></li>';
        return `<section class="rc-groupe"><h2 class="rc-jour"><span class="rc-os-titre"></span></h2><ul class="rc-liste">${os.repeat(5)}</ul></section>`;
    }

    function sansPool() {
        document.getElementById('rcFiltres').innerHTML = '';
        document.getElementById('rcFil').innerHTML = `<p class="rc-vide">Rejoins ou crée un pool pour suivre ses nouvelles ici.<br><a class="rc-lien" href="index.html">Retour à l’accueil</a></p>`;
    }

    async function demarrer() {
        etat.user = localStorage.getItem('username');
        if (!etat.user || localStorage.getItem('isLoggedIn') !== 'true') { window.location.href = 'login.html'; return; }
        try { const f = sessionStorage.getItem(CLE_FILTRE); if (f && FILTRES.some(([k]) => k === f)) etat.filtre = f; } catch (e) { /* rien */ }
        rendreFiltres();
        document.getElementById('rcFil').innerHTML = squelette();

        if (!window.FZPool) { sansPool(); return; }
        await FZPool.ready();
        etat.pool = FZPool.get();
        if (!etat.pool) { sansPool(); return; }
        const titre = document.getElementById('rcPool');
        if (titre) titre.textContent = etat.pool;
        charger();
    }

    document.addEventListener('click', e => {
        const chip = e.target.closest('[data-filtre]');
        if (chip) {
            etat.filtre = chip.dataset.filtre;
            try { sessionStorage.setItem(CLE_FILTRE, etat.filtre); } catch (err) { /* rien */ }
            rendre();
            return;
        }
        if (e.target.closest('[data-reessayer]')) charger({ force: true });
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { clearTimeout(etat.minuteur); return; }
        if (etat.pool) charger();
    });
    setInterval(majFraicheur, 30000);

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
    else demarrer();

})();
