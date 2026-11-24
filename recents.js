/**
 * RÉCENTS — ce qui vient d'arriver dans le pool actif, du plus récent au
 * plus ancien.
 *
 * Une seule lecture au serveur pour l'essentiel (/api/pools/:pool/recents :
 * rapports des matchs du jour, blessés et mouvements LNH du pool, fil
 * d'activité).
 * Deux lectures que d'autres écrans font déjà sont reprises de leur mémoire
 * (FZMemo, fzReactif.js) : les offres reçues (la pastille de la barre, même
 * clé) et le bilan de la soirée.
 *
 * Pas de sondage permanent : la page se relit à l'ouverture, au retour sur
 * l'onglet, et toutes les 15 s SEULEMENT tant qu'un match du jour est en jeu :
 * un but fait alors remonter son match en tête, « il y a 10 secondes ».
 * Les relectures ne touchent pas la base tant que rien n'y a été écrit
 * (routes/recents.js) ; elles ne réveillent donc pas Neon pour rien.
 *
 * Les échanges arrivent en direct : le serveur signale chaque offre et
 * chaque échange conclu à la salle du pool (tradePending, tradeUpdated,
 * routes/trades.js). La page se relit alors ; un échange conclu ou une offre
 * reçue qu'elle n'avait pas encore vu surgit en tête du fil, s'éclaire, et
 * une bulle l'annonce. Sans socket, un relevé toutes les minutes prend le
 * relais tant que la page est ouverte.
 */
(function () {
    'use strict';

    const BASE = window.location.hostname.includes('localhost') ? 'http://localhost:3000' : '';
    const FRAIS_MS = 30000;
    // Un match en jeu : relecture toutes les 15 s, assez pour qu'un but monte
    // en tête « il y a quelques secondes ». La route ne lit que la mémoire du
    // serveur tant que rien n'est écrit en base.
    const DIRECT_MS = 15000;
    // Sans socket (proxy, bibliothèque absente) : les échanges se relisent
    // quand même, à la minute.
    const SANS_SOCKET_MS = 60000;
    // Plusieurs signaux tombent ensemble (tradeUpdated puis
    // tradeListingsUpdated pour un même échange) : une seule relecture.
    const SIGNAL_MS = 400;
    const BULLE_MS = 6000;
    const BILAN_MS = 10 * 60 * 1000;
    const CLE_FILTRE = 'fzRecentsFiltre';

    const FILTRES = [
        ['tout', 'Tout'],
        ['mien', 'Mes joueurs'],
        ['echanges', 'Échanges'],
        ['pool', 'Pool'],
        ['lnh', 'LNH']
    ];

    const etat = {
        pool: null, user: null, donnees: null, offres: [], bilan: null, filtre: 'tout', minuteur: null, luA: 0, butsVus: new Set(),
        // Les échanges déjà montrés : un nouveau venu surgit (is-nouveau) et
        // s'annonce dans une bulle. null avant la première lecture : ce qui
        // est là à l'ouverture de la page n'est pas « nouveau ».
        echangesVus: null, nouveaux: new Map(), offresLues: false, socket: false, signal: null
    };

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
    /** « il y a 10 secondes », « il y a 7 minutes », « il y a 2 h », sinon l'heure. */
    function depuis(iso) {
        const ms = Date.now() - Date.parse(iso);
        if (!Number.isFinite(ms)) return '';
        const s = Math.max(0, Math.round(ms / 1000));
        if (s < 5) return 'à l’instant';
        if (s < 60) return `il y a ${s} secondes`;
        const min = Math.floor(s / 60);
        if (min < 60) return `il y a ${min} minute${min > 1 ? 's' : ''}`;
        const h = Math.floor(min / 60);
        if (h < 12) return `il y a ${h} h`;
        return heure(iso);
    }

    function quand(entree) {
        if (!entree.moment || entree.dateSeule) return '';
        return depuis(entree.moment);
    }
    const quandHTML = (entree, classe = 'rc-quand') => {
        const texte = quand(entree);
        return texte ? `<span class="${classe}" data-moment="${esc(entree.moment)}">${esc(texte)}</span>` : '';
    };

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

    /** « 2 - 14:32 », « Entracte 2 », « Prol. - 3:10 », « Final (Prol.) ». */
    function etatMatch(m) {
        const per = m.typePeriode === 'OT' ? 'Prol.' : m.typePeriode === 'SO' ? 'TB' : (m.periode || '');
        if (m.etat === 'FINAL') return m.typePeriode === 'OT' ? 'Final (Prol.)' : m.typePeriode === 'SO' ? 'Final (TB)' : 'Final';
        if (m.entracte) return `Entracte ${per}`.trim();
        return m.horloge ? `${per} - ${m.horloge}` : `${per}`;
    }

    const ICONE_MATCH = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
    const BUT_RECENT_MS = 2 * 60 * 1000;

    function equipeHTML(t, mene, marque) {
        return `<span class="rc-eq${mene ? ' is-mene' : ''}">
            <img class="rc-eq-logo" src="teams/${esc(t.abbrev)}.png" alt="" width="34" height="34" loading="lazy" onerror="this.style.visibility='hidden'">
            <span class="rc-eq-nom"><b>${esc(t.ville || t.abbrev)}</b>${t.surnom ? `<small>${esc(t.surnom)}</small>` : ''}</span>
            <span class="rc-eq-score${marque ? ' is-but' : ''}">${t.score ?? 0}</span>
        </span>`;
    }

    function entreesMatchs(matchs) {
        return (matchs || []).map(m => {
            const recent = m.but && (Date.now() - Date.parse(m.but)) < BUT_RECENT_MS;
            // L'éclair ne joue qu'une fois par but : la relecture de 15 s redessine la carte.
            const cleBut = `${m.id}|${m.but}`;
            const nouveau = recent && !etat.butsVus.has(cleBut);
            if (nouveau) etat.butsVus.add(cleBut);
            const v = Number(m.visiteur.score) || 0, l = Number(m.local.score) || 0;
            const db = m.dernierBut;
            const marqueur = recent && db && db.club;
            const tag = recent ? '<span class="rc-tag is-rouge rc-but">But !</span>'
                : `<span class="rc-tag${m.etat === 'LIVE' ? ' is-rouge' : ''}">${m.etat === 'LIVE' ? '<span class="rc-direct">En direct</span>' : `${ICONE_MATCH}Rapport de match`}</span>`;
            const qui = [
                ...m.joueurs.map(j => `${esc(j.nom.split(' ').slice(1).join(' ') || j.nom)}${j.points ? ` <b>${pts(j.points)}</b>` : ''}`),
                ...m.clubs.map(c => `${esc(c.club)} (club)${c.points ? ` <b>${pts(c.points)}</b>` : ''}`)
            ].join(' · ');
            const entree = { cat: 'lnh', mien: m.mien, match: true, moment: m.moment, jour: m.jour };
            entree.carte = `<a class="rc-match${nouveau ? ' is-nouveau' : ''}" href="${esc(url('match.html', { id: m.id }))}">
                <span class="rc-match-tete">${tag}${quandHTML(entree)}</span>
                <span class="rc-match-corps">
                    <span class="rc-equipes">
                        ${equipeHTML(m.visiteur, v > l, marqueur === m.visiteur.abbrev)}
                        ${equipeHTML(m.local, l > v, marqueur === m.local.abbrev)}
                    </span>
                    <span class="rc-match-etat${m.etat === 'LIVE' ? ' is-direct' : ''}">${esc(etatMatch(m))}<span class="rc-fleche" aria-hidden="true">›</span></span>
                </span>
                ${db && db.nom && m.etat === 'LIVE' ? `<span class="rc-match-but">Dernier but : <b>${esc(db.nom)}</b>${db.club ? ` (${esc(db.club)})` : ''}${db.periode ? ` · ${db.periode}${db.periode === 1 ? 're' : 'e'}` : ''}${db.temps ? ` · ${esc(db.temps)}` : ''}</span>` : ''}
                ${m.mien ? `<span class="rc-match-moi"><span>${qui || 'Tes joueurs'}</span><span class="rc-pts${m.points > 0 ? ' is-plus' : ''}">${pts(m.points)} <small>tes pts</small></span></span>` : ''}
            </a>`;
            return entree;
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
                    return { ...base, mien, echange: `conclu|${e.moment}|${s.fromTeam}|${s.toTeam}`, tag: 'Échange conclu', ton: 'is-vert',
                        bulle: `${s.fromTeam} envoie ${(s.offering || []).join(', ')} à ${s.toTeam} contre ${(s.receiving || []).join(', ')}`,
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
            echange: `offre|${t.id}`,
            bulle: `${t.fromTeam} t’offre ${nomsDe(t.offering).join(', ')} pour ${nomsDe(t.receiving).join(', ')}`,
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
    function toutesLesEntrees({ sansMatchs = false } = {}) {
        const d = etat.donnees || {};
        return [
            ...(sansMatchs ? [] : entreesMatchs(d.matchs)),
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
        // Échanges : ceux conclus dans le pool, et les offres que j'ai reçues.
        if (filtre === 'echanges') return !!e.echange;
        return e.cat === filtre;  // les matchs sont « LNH », les miens aussi « Mes joueurs »
    }

    /**
     * Repère les échanges que la page n'avait pas encore vus. La première
     * lecture les retient tous sans rien annoncer ; ensuite, chaque nouveau
     * venu surgit dans le fil et s'annonce dans la bulle.
     */
    function reperer() {
        const echanges = toutesLesEntrees({ sansMatchs: true }).filter(e => e.echange);
        if (!etat.echangesVus) {
            etat.echangesVus = new Set(echanges.map(e => e.echange));
            return;
        }
        const neufs = echanges.filter(e => !etat.echangesVus.has(e.echange));
        // Surgit pendant 2,5 s : un second rendu rapproché (les offres après
        // le fil) rejoue l'entrée plutôt que de l'effacer.
        neufs.forEach(e => { etat.echangesVus.add(e.echange); etat.nouveaux.set(e.echange, Date.now() + 2500); });
        if (neufs.length) annoncer(neufs);
    }

    /** La bulle du bas : le plus récent des nouveaux échanges ; la toucher ouvre le filtre Échanges. */
    function annoncer(neufs) {
        let bulle = document.getElementById('rcBulle');
        if (!bulle) {
            bulle = document.createElement('button');
            bulle.type = 'button';
            bulle.id = 'rcBulle';
            bulle.className = 'rc-bulle';
            bulle.setAttribute('data-bulle', '');
            document.body.appendChild(bulle);
        }
        const [premier] = neufs.sort((a, b) => (Date.parse(b.moment) || 0) - (Date.parse(a.moment) || 0));
        const titre = premier.tag === 'Offre reçue' ? 'Nouvelle offre' : 'Nouvel échange';
        const autres = neufs.length > 1 ? ` <small>+${neufs.length - 1}</small>` : '';
        bulle.innerHTML = `<b>${esc(titre)}</b>${autres}<span>${esc(premier.bulle || '')}</span>`;
        bulle.setAttribute('aria-label', `${titre} : ${premier.bulle || ''}. Voir les échanges.`);
        bulle.classList.remove('is-visible');
        void bulle.offsetWidth; // rejoue l'apparition
        bulle.classList.add('is-visible');
        clearTimeout(annoncer.minuteur);
        annoncer.minuteur = setTimeout(() => bulle.classList.remove('is-visible'), BULLE_MS);
    }

    function ligneHTML(e) {
        if (e.carte) return `<li class="rc-li-match${e.mien ? ' is-mien' : ''}">${e.carte}</li>`;
        const balise = e.href ? 'a' : 'div';
        const lien = e.href ? ` href="${esc(e.href)}"` : '';
        const moment = quandHTML(e);
        const tag = e.tagHTML || esc(e.tag);
        // Un échange tout juste arrivé surgit une fois, puis redevient une ligne comme les autres.
        const nouveau = e.echange && (etat.nouveaux.get(e.echange) || 0) > Date.now();
        const classes = [e.mien ? 'is-mien' : '', nouveau ? 'is-nouveau' : ''].filter(Boolean).join(' ');
        return `<li class="${classes}"><${balise} class="rc-ligne"${lien}>
            ${e.face}
            <span class="rc-txt">
                <span class="rc-tag ${e.ton || ''}">${tag}${moment ? ` · ${moment}` : ''}</span>
                <span class="rc-texte">${e.texte}</span>
            </span>
            ${e.fin || ''}
        </${balise}></li>`;
    }

    function rendreFiltres() {
        const alertes = toutesLesEntrees({ sansMatchs: true }).filter(e => e.mien && !e.match && (e.ton === 'is-rouge' || e.tag === 'Offre reçue')).length;
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
        const reste = entrees
            .sort((a, b) => {
                if (!a.moment || !b.moment) return (a.moment ? -1 : b.moment ? 1 : 0) || (b.mien - a.mien);
                return (Date.parse(b.moment) || 0) - (Date.parse(a.moment) || 0) || (b.mien - a.mien);
            });

        const groupes = [];
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
                echanges: 'Aucun échange dans ce pool pour l’instant. Ils apparaîtront ici dès qu’ils seront conclus.',
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

    async function charger({ force = false, direct = false, offres = false } = {}) {
        const enc = encodeURIComponent(etat.pool);
        const memo = window.FZMemo;
        const cle = `recents:${etat.pool}`;
        if (force && memo) memo.oublier(cle);
        // Un signal d'échange : les offres reçues se relisent pour de bon.
        if (offres && memo) memo.oublier(`nav:echanges:${etat.user}`);
        const principal = memo ? memo.charger(cle, () => lireJSON(`/api/pools/${enc}/recents`), { fraisMs: FRAIS_MS })
            : lireJSON(`/api/pools/${enc}/recents`);
        // Pendant le direct, seul le fil principal se relit : les offres et
        // le bilan gardent leur lecture (pas de requête en base toutes les 15 s).
        if (!direct) chargerAnnexes(enc, memo);

        try {
            etat.donnees = await principal;
            etat.luA = Date.now();
            // Les offres reçues arrivent par chargerAnnexes : la première
            // lecture des échanges attend qu'elles soient là (voir plus bas).
            if (etat.echangesVus || etat.offresLues) reperer();
            rendre();
            majFraicheur();
        } catch (erreur) {
            if (!etat.donnees) {
                document.getElementById('rcFil').innerHTML = `<p class="rc-vide">Le fil n’a pas pu se charger. <button type="button" class="rc-reessayer" data-reessayer>Réessayer</button></p>`;
            }
        }
        planifier();
    }

    function chargerAnnexes(enc, memo) {
        // Même clé que la pastille de la barre (navbar.js) : déjà en mémoire.
        const offres = (memo ? memo.charger(`nav:echanges:${etat.user}`, () => lireJSON(`/trades/pending/${encodeURIComponent(etat.user)}`), { fraisMs: FRAIS_MS })
            : lireJSON(`/trades/pending/${encodeURIComponent(etat.user)}`)).catch(() => []);
        const bilan = (memo ? memo.charger(`recents:bilan:${etat.pool}`, () => lireJSON(`/api/pools/${enc}/bilan-soiree`), { fraisMs: BILAN_MS })
            : lireJSON(`/api/pools/${enc}/bilan-soiree`)).catch(() => null);

        offres.then(liste => {
            const avant = etat.offresLues ? etat.offres.map(t => t.id).join(',') : null;
            etat.offres = (Array.isArray(liste) ? liste : []).filter(t => t.draftName === etat.pool);
            etat.offresLues = true;
            // Mêmes offres qu'avant : rien à redessiner (et l'éclair d'un
            // échange qui vient d'arriver n'est pas coupé).
            if (avant === etat.offres.map(t => t.id).join(',')) return;
            if (etat.donnees) { reperer(); rendre(); }
        });
        bilan.then(b => { etat.bilan = b; if (etat.donnees) rendre(); });
    }

    /**
     * Toutes les 15 s tant qu'un match du jour est en jeu ; sans socket, à la
     * minute pour ne pas manquer un échange ; sinon rien.
     */
    function planifier() {
        clearTimeout(etat.minuteur);
        if (document.hidden) return;
        const enJeu = ((etat.donnees && etat.donnees.matchs) || []).some(m => m.etat === 'LIVE');
        if (enJeu) etat.minuteur = setTimeout(() => charger({ force: true, direct: true }), DIRECT_MS);
        else if (!etat.socket) etat.minuteur = setTimeout(() => charger({ force: true, offres: true }), SANS_SOCKET_MS);
    }

    /** Un signal d'échange du serveur : une relecture, regroupée. */
    function surSignal(charge) {
        if (!etat.pool || (charge && charge.poolName && charge.poolName !== etat.pool)) return;
        clearTimeout(etat.signal);
        etat.signal = setTimeout(() => {
            if (document.hidden) return; // le retour sur l'onglet relira tout
            charger({ force: true, offres: true });
        }, SIGNAL_MS);
    }

    /**
     * La connexion partagée de l'onglet (activePool.js). Le serveur y place
     * chaque membre dans la salle de ses pools : tradePending (une offre
     * faite), tradeUpdated (acceptée, refusée, annulée), tradeListingsUpdated
     * (le marché) y arrivent sans qu'on demande rien.
     */
    function brancherSocket(essai = 0) {
        const socket = window.fzSocketPartage && window.fzSocketPartage();
        if (!socket) {
            if (essai < 40) setTimeout(() => brancherSocket(essai + 1), 250);
            return;
        }
        etat.socket = true;
        ['tradePending', 'tradeUpdated', 'tradeListingsUpdated'].forEach(nom => socket.on(nom, surSignal));
        // Une reconnexion (veille, réseau) a pu manquer un échange.
        let connexions = socket.connected ? 1 : 0;
        socket.on('connect', () => {
            connexions += 1;
            if (connexions > 1) surSignal(null);
        });
        planifier();
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
        brancherSocket();
    }

    function choisirFiltre(filtre) {
        etat.filtre = filtre;
        try { sessionStorage.setItem(CLE_FILTRE, etat.filtre); } catch (err) { /* rien */ }
        rendre();
    }

    document.addEventListener('click', e => {
        const chip = e.target.closest('[data-filtre]');
        if (chip) { choisirFiltre(chip.dataset.filtre); return; }
        const bulle = e.target.closest('[data-bulle]');
        if (bulle) {
            bulle.classList.remove('is-visible');
            choisirFiltre('echanges');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        if (e.target.closest('[data-reessayer]')) charger({ force: true });
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { clearTimeout(etat.minuteur); return; }
        if (etat.pool) charger();
    });
    setInterval(majFraicheur, 30000);
    // « il y a 10 secondes » avance sans relire le serveur.
    setInterval(() => {
        if (document.hidden) return;
        document.querySelectorAll('#rcFil [data-moment]').forEach(el => {
            const t = depuis(el.dataset.moment);
            if (t && el.textContent !== t) el.textContent = t;
        });
    }, 5000);

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
    else demarrer();

})();
