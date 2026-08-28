/* ============================================================
   COMPETE · DRAFT · DOMINATE — animation d'accueil (sans pool)
   ------------------------------------------------------------
   Portage JS nu de la maquette Claude Design "Compete Draft
   Dominate.dc.html" (projectId 3cff4323-8774-4865-93ed-faf57f54c9ac).
   Le runtime Claude Design (React + support.js + langage <x-dc>)
   ne tourne pas ici : on rebâtit le même DOM et on rejoue la
   même boucle requestAnimationFrame, avec les mêmes fonctions
   d'accélération et les mêmes constantes que la classe DCLogic
   de la maquette. Seuls changements voulus :
     · plus de cadre iOS (la carte seule, en bandeau responsive) ;
     · textes en français ;
     · message final agrandi / "DOMINER" en rouge, entrée plus
       marquée (voir renderFinale + .cdd-fin-msg dans le CSS).

   Exposé : window.FZCdd = { start, stop }.
     · Anonyme  : la section est visible dès le <head> (html.fz-anon),
       le module démarre tout seul au DOMContentLoaded.
     · Connecté : accueil-dash.js (renderDash) appelle start()/stop()
       selon la présence d'un pool actif.
   La boucle se met en pause hors écran (IntersectionObserver) et
   se fige sur l'image finale si prefers-reduced-motion.
   ============================================================ */
(function () {
    'use strict';

    var LOOP = 11600;                                  // durée d'un cycle (ms)
    var BOUNDS = [[0, 2.2], [2.2, 5.2], [5.2, 11.6]];  // fenêtres des 3 actes (s)
    var ACCENT = '#E42027';
    var SPEED = 1;
    var PULSE_WINNER = true;

    var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    // ---- accélérations (recopiées telles quelles de DCLogic) ----
    function clamp(v, a, b) {
        return Math.max(a === undefined ? 0 : a, Math.min(b === undefined ? 1 : b, v));
    }
    function ease(x) { var t = clamp(x); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function easeOut(x) { var t = clamp(x); return 1 - Math.pow(1 - t, 4); }
    function spring(x) { var t = clamp(x); return 1 - Math.pow(1 - t, 3) + 0.16 * Math.sin(Math.PI * t); }

    var TROPHY_SVG =
        '<svg width="12" height="12" viewBox="0 0 24 24">' +
        '<path d="M6.9 3.6h10.2v4.9a5.1 5.1 0 0 1-10.2 0z" fill="#F0C24B"></path>' +
        '<path d="M6.9 5.1H4.5v1.1c0 1.9 1 3.5 2.4 4.2M17.1 5.1h2.4v1.1c0 1.9-1 3.5-2.4 4.2" stroke="#F0C24B" stroke-width="1.5" fill="none" stroke-linecap="round"></path>' +
        '<path d="M10.9 13.2h2.2v3.4h-2.2z" fill="#D9A62F"></path>' +
        '<path d="M8.6 16.6h6.8l1 2.4H7.6z" fill="#F0C24B"></path>' +
        '<path d="M6.6 19.4h10.8v1.9H6.6z" fill="#D9A62F"></path></svg>';
    var FIN_TROPHY_SVG =
        '<svg width="22" height="22" viewBox="0 0 24 24">' +
        '<path d="M6.9 3.6h10.2v4.9a5.1 5.1 0 0 1-10.2 0z" fill="#F0C24B"></path>' +
        '<path d="M8.4 3.6h8.7v4.9a5.1 5.1 0 0 1-5.6 5.05 5.1 5.1 0 0 0 3.1-5.05z" fill="#D9A62F"></path>' +
        '<path d="M6.9 5.1H4.5v1.1c0 1.9 1 3.5 2.4 4.2M17.1 5.1h2.4v1.1c0 1.9-1 3.5-2.4 4.2" stroke="#F0C24B" stroke-width="1.5" fill="none" stroke-linecap="round"></path>' +
        '<path d="M10.9 13.2h2.2v3.4h-2.2z" fill="#D9A62F"></path>' +
        '<path d="M8.6 16.6h6.8l1 2.4H7.6z" fill="#F0C24B"></path>' +
        '<path d="M6.6 19.4h10.8v1.9H6.6z" fill="#D9A62F"></path></svg>';
    var CHECK_SVG =
        '<svg width="10" height="8" viewBox="0 0 10 8" style="flex-shrink:0">' +
        '<path d="M1 4.2l2.6 2.6L9 1.2" stroke="#fff" stroke-width="1.8" fill="none" ' +
        'stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="11" stroke-dashoffset="11"></path></svg>';
    var REPLAY_SVG =
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#17171A" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"></path><path d="M20.6 4.4v4.4h-4.4"></path></svg>';

    var RIVALS = ['Alex', 'Marc', 'Sam', 'Max', 'Leo', 'Chris', 'Josh', 'Noah', 'Thomas'];
    var CARDS = [
        { num: '#29', name: 'DRAISAITL', pts: '92 PTS' },
        { num: '#8', name: 'MAKAR', pts: '88 PTS' },
        { num: '#86', name: 'KUCHEROV', pts: '96 PTS' },
        { num: '#34', name: 'MATTHEWS', pts: '85 PTS' },
        { num: '#97', name: 'McDAVID', pts: '100 PTS' },
        { num: '#86', name: 'HUGHES', pts: '84 PTS' },
        { num: '#98', name: 'BEDARD', pts: '87 PTS' }
    ];
    var MONTHS = ['SEP', 'OCT', 'NOV', 'DÉC', 'JAN', 'FÉV', 'MAR', 'AVR'];
    var BOARD = [
        { name: 'Alex', from: 26, to: 58 },
        { name: 'Marc', from: 24, to: 54 },
        { name: 'Sam', from: 22, to: 49 },
        { name: 'Max', from: 20, to: 44 },
        { name: 'Leo', from: 18, to: 39 }
    ];
    var PHASE_LABELS = ['AFFRONTE', 'REPÊCHE', 'DOMINE'];

    // ---- état ----
    var mount, root, dom = null, built = false;
    var rafId = null, running = false, enabled = false, visible = true, done = false;
    var startT = 0, pausedAt = 0;
    var msgShown = false, domPulsed = false, pulseTimer = null;

    // ============================================================
    // CONSTRUCTION DU DOM (équivalent des <sc-for> de la maquette)
    // ============================================================
    function build() {
        if (built) return;
        mount = document.getElementById('cddMount');
        if (!mount) return;
        root = document.getElementById('cddSection');

        var avatars = '';
        for (var i = 0; i < RIVALS.length; i++) {
            avatars += '<div class="cdd-av"><span>' + RIVALS[i][0] + '</span></div>';
        }
        var chips = '';
        for (var c = 0; c < 10; c++) {
            chips += '<div class="cdd-chip"><span>' + String(c + 1).padStart(2, '0') + '</span></div>';
        }
        var pcards = '';
        for (var p = 0; p < CARDS.length; p++) {
            pcards += '<div class="cdd-pcard">' +
                '<span class="cdd-pcard-num">' + CARDS[p].num + '</span>' +
                '<span class="cdd-pcard-name">' + CARDS[p].name + '</span>' +
                '<span class="cdd-pcard-pts">' + CARDS[p].pts + '</span></div>';
        }
        var rivalRows =
            '<div class="cdd-rival"><span class="cdd-rival-who">ALEX</span><span class="cdd-rival-player">Makar</span><span class="cdd-rival-taken">PRIS</span></div>' +
            '<div class="cdd-rival"><span class="cdd-rival-who">MARC</span><span class="cdd-rival-player">Draisaitl</span><span class="cdd-rival-taken">PRIS</span></div>';
        var monthTicks = '';
        for (var m = 0; m < MONTHS.length; m++) monthTicks += '<span class="cdd-month-tick">' + MONTHS[m] + '</span>';
        var rankNums = '';
        for (var n = 1; n <= 6; n++) rankNums += '<span class="cdd-rank-num">' + n + '</span>';
        var rankRows = '';
        for (var r = 0; r < 6; r++) {
            rankRows += '<div class="cdd-rank-row"><div class="cdd-rank-inner">' +
                '<span class="cdd-rank-name"></span><span class="cdd-rank-pts"></span>' +
                '<div class="cdd-rank-trophy">' + TROPHY_SVG + '</div></div></div>';
        }
        var phases = '';
        for (var ph = 0; ph < 3; ph++) {
            phases += '<div class="cdd-phase"><div class="cdd-phase-track"><div class="cdd-phase-fill"></div></div>' +
                '<span class="cdd-phase-lbl">' + PHASE_LABELS[ph] + '</span></div>';
        }

        mount.innerHTML =
            '<div class="cdd-eyebrow">Affronte · Repêche · Domine</div>' +
            '<div class="cdd-card">' +
              '<div class="cdd-titles">' +
                '<div class="cdd-title-layer"><div class="cdd-title-word">AFFRONTE</div><div class="cdd-title-sub">Défiez vos rivaux</div></div>' +
                '<div class="cdd-title-layer"><div class="cdd-title-word">REPÊCHE</div><div class="cdd-title-sub">Chaque choix compte</div></div>' +
                '<div class="cdd-title-layer"><div class="cdd-title-word">DOMINE</div><div class="cdd-title-sub">Terminez au sommet</div></div>' +
              '</div>' +
              '<div class="cdd-stage">' +

                '<div class="cdd-scene cdd-s0">' +
                  '<div class="cdd-avatars">' + avatars +
                    '<div class="cdd-you"><span>VOUS</span></div>' +
                  '</div>' +
                  '<div class="cdd-tagline">' +
                    '<span class="cdd-tag-a">10 JOUEURS</span><span class="cdd-tag-dot">·</span><span class="cdd-tag-b">1 GAGNANT</span>' +
                  '</div>' +
                '</div>' +

                '<div class="cdd-scene cdd-s1">' +
                  '<div class="cdd-pickhdr"><span class="cdd-pickhdr-a">ORDRE DE REPÊCHAGE</span><span class="cdd-pickhdr-b">À VOUS</span></div>' +
                  '<div class="cdd-order"><div class="cdd-order-chips">' + chips + '</div><div class="cdd-turnmark"></div></div>' +
                  '<div class="cdd-track-wrap">' +
                    '<div class="cdd-track-frame"></div>' +
                    '<div class="cdd-track">' + pcards + '</div>' +
                    '<div class="cdd-badge-slot">' +
                      '<div class="cdd-badge-pre"><span>REPÊCHER</span></div>' +
                      '<div class="cdd-badge-post"><span>REPÊCHÉ</span>' + CHECK_SVG + '</div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="cdd-rivals">' + rivalRows + '</div>' +
                '</div>' +

                '<div class="cdd-scene cdd-s2">' +
                  '<div class="cdd-season-hdr"><span class="cdd-season-lbl">SAISON</span><span class="cdd-month-label">SEP</span></div>' +
                  '<div class="cdd-season-bar"><div class="cdd-season-fill"></div></div>' +
                  '<div class="cdd-months">' + monthTicks + '</div>' +
                  '<div class="cdd-board">' + rankNums + rankRows + '</div>' +
                '</div>' +

                '<div class="cdd-finale">' +
                  '<div class="cdd-fin-trophy">' + FIN_TROPHY_SVG + '</div>' +
                  '<button class="cdd-replay" type="button" title="Rejouer" aria-label="Rejouer">' + REPLAY_SVG + '</button>' +
                  '<div class="cdd-fin-msg"><div class="cdd-fin-headline">Pensez-vous avoir ce qu’il faut pour <span class="cdd-dom">dominer</span> ?</div></div>' +
                  '<div class="cdd-fin-btns">' +
                    '<a class="cdd-btn cdd-btn-primary" href="creer-pool.html"><span>Créer un pool</span><div class="cdd-swoosh"></div></a>' +
                    '<a class="cdd-btn cdd-btn-ghost" href="rejoindre-pool.html"><span>Rejoindre</span><div class="cdd-swoosh"></div></a>' +
                  '</div>' +
                '</div>' +

              '</div>' +
              '<div class="cdd-phases">' + phases + '</div>' +
            '</div>';

        var q = function (s) { return mount.querySelector(s); };
        var qa = function (s) { return Array.prototype.slice.call(mount.querySelectorAll(s)); };
        dom = {
            titleLayers: qa('.cdd-title-layer'),
            s: qa('.cdd-scene'),                 // [s0, s1, s2]
            avatars: qa('.cdd-av'),
            you: q('.cdd-you'),
            tagline: q('.cdd-tagline'),
            pickB: q('.cdd-pickhdr-b'),
            chips: qa('.cdd-chip'),
            chipSpans: qa('.cdd-chip span'),
            turnmark: q('.cdd-turnmark'),
            track: q('.cdd-track'),
            pcards: qa('.cdd-pcard'),
            pcardPts: qa('.cdd-pcard-pts'),
            badgePre: q('.cdd-badge-pre'),
            badgePost: q('.cdd-badge-post'),
            check: q('.cdd-badge-post path'),
            rivals: qa('.cdd-rival'),
            monthLabel: q('.cdd-month-label'),
            seasonFill: q('.cdd-season-fill'),
            monthTicks: qa('.cdd-month-tick'),
            rankNums: qa('.cdd-rank-num'),
            rankRows: qa('.cdd-rank-row'),
            rankInner: qa('.cdd-rank-inner'),
            rankName: qa('.cdd-rank-name'),
            rankPts: qa('.cdd-rank-pts'),
            rankTrophy: qa('.cdd-rank-trophy'),
            finale: q('.cdd-finale'),
            finTrophy: q('.cdd-fin-trophy'),
            replay: q('.cdd-replay'),
            finMsg: q('.cdd-fin-msg'),
            dom: q('.cdd-dom'),
            finBtns: q('.cdd-fin-btns'),
            swooshA: q('.cdd-btn-primary .cdd-swoosh'),
            swooshB: q('.cdd-btn-ghost .cdd-swoosh'),
            phasesWrap: q('.cdd-phases'),
            phaseFills: qa('.cdd-phase-fill'),
            phaseLbls: qa('.cdd-phase-lbl')
        };

        dom.replay.addEventListener('click', replay);

        if (root && 'IntersectionObserver' in window) {
            new IntersectionObserver(function (entries) {
                visible = entries[0].isIntersecting;
                if (!enabled) return;
                if (visible) play(); else halt();
            }, { threshold: 0.15 }).observe(root);
        }

        built = true;
    }

    // ============================================================
    // RENDU D'UNE IMAGE (équivalent de renderVals + bindings {{}})
    // ============================================================
    function render(t, clockMs) {
        var accent = ACCENT;

        // ---- fondu des scènes ----
        function sc(i) {
            var s = BOUNDS[i][0], e = BOUNDS[i][1];
            var inP = ease((t - s) / 0.3), outP = ease((e - t) / 0.3);
            return { o: inP * outP, ty: (1 - inP) * 7 - (1 - outP) * 7 };
        }

        // ---------- AFFRONTE (0 – 2.2) ----------
        var lt0 = t;
        var closeIn = 1.34 - 0.46 * ease((lt0 - 1.1) / 0.7);
        var breathe = 1 + 0.018 * Math.sin(clockMs / 520);
        for (var i = 0; i < RIVALS.length; i++) {
            var ang = (-90 + i * 40) * Math.PI / 180;
            var cos = Math.cos(ang), sin = Math.sin(ang);
            var pv = clamp((lt0 - (0.22 + i * 0.07)) / 0.28);
            var burst = Math.pow(1 - pv, 2) * 132;
            var a = dom.avatars[i];
            a.style.left = (50 + cos * 34 * closeIn * breathe).toFixed(2) + '%';
            a.style.top = (47 + sin * 32 * closeIn * breathe).toFixed(2) + '%';
            a.style.opacity = clamp(pv * 3).toFixed(2);
            a.style.transform = 'translate(-50%,-50%) translate(' + (cos * burst).toFixed(1) + 'px,' +
                (sin * burst).toFixed(1) + 'px) scale(' + (0.05 + 0.95 * spring(pv)).toFixed(3) + ')';
        }
        var pressure = clamp((lt0 - 1.15) / 0.5);
        dom.you.style.transform = 'translate(-50%,-50%) scale(' + spring(clamp((lt0 - 0.05) / 0.4)).toFixed(3) + ')';
        dom.you.style.boxShadow = '0 0 0 ' +
            (pressure * (4 + 2.6 * (0.5 + 0.5 * Math.sin(clockMs / 300)))).toFixed(2) + 'px ' + accent + '24';
        dom.tagline.style.opacity = clamp((lt0 - 1.6) / 0.35).toFixed(2);

        // ---------- REPÊCHE (2.2 – 5.2) ----------
        var lt1 = t - BOUNDS[1][0];
        var YOUR_PICK = 6;
        var turnPos = YOUR_PICK * ease((lt1 - 0.15) / 0.8);
        var onYou = lt1 > 0.95;
        for (var ci = 0; ci < 10; ci++) {
            var shown = clamp((lt1 - ci * 0.025) / 0.2);
            var isYou = ci === YOUR_PICK;
            var done = ci < Math.round(turnPos);
            var active = Math.abs(ci - turnPos) < 0.5;
            var chip = dom.chips[ci];
            chip.style.background = isYou && onYou ? accent
                : active ? 'rgba(228,32,39,0.12)'
                : done ? '#E8E5E1' : '#F6F4F2';
            dom.chipSpans[ci].style.color = isYou && onYou ? '#fff'
                : done ? 'rgba(23,23,26,0.3)' : 'rgba(23,23,26,0.5)';
            chip.style.opacity = shown.toFixed(2);
        }
        dom.turnmark.style.transform = 'translateX(' + (turnPos * 100).toFixed(2) + '%) scale(' +
            (1 + 0.08 * Math.sin(Math.PI * clamp((lt1 - 0.95) / 0.35))).toFixed(3) + ')';
        dom.turnmark.style.opacity = clamp((lt1 - 0.1) / 0.2).toFixed(2);
        dom.pickB.style.opacity = (onYou ? 0.55 + 0.45 * Math.abs(Math.sin(clockMs / 320)) : 0).toFixed(2);

        var scroll = easeOut((lt1 - 1.2) / 0.95);
        dom.track.style.transform = 'translateX(' + (29 - 168 * scroll).toFixed(2) + '%)';
        var snapP = clamp((lt1 - 2.08) / 0.4);
        var focus = clamp((lt1 - 2.0) / 0.3);
        var landed = lt1 > 2.04;
        var badgeSwap = clamp((lt1 - 2.22) / 0.28);
        for (var di = 0; di < CARDS.length; di++) {
            var isTarget = di === 4;
            var card = dom.pcards[di];
            card.style.left = (di * 42).toFixed(0) + '%';
            card.style.border = isTarget && landed ? '1.5px solid ' + accent : '1px solid rgba(23,23,26,0.12)';
            card.style.opacity = (isTarget ? 1 : 1 - 0.5 * focus).toFixed(2);
            card.style.transform = isTarget ? 'scale(' + (1 + 0.07 * Math.sin(Math.PI * snapP)).toFixed(3) + ')' : 'scale(1)';
            dom.pcardPts[di].style.color = isTarget && landed ? accent : 'rgba(23,23,26,0.45)';
            dom.pcardPts[di].style.opacity = isTarget ? (1 - badgeSwap).toFixed(2) : '1';
        }
        var preOp = clamp((lt1 - 1.9) / 0.25) * (1 - badgeSwap);
        dom.badgePre.style.opacity = preOp.toFixed(2);
        dom.badgePre.style.transform = 'scale(' + (1 - 0.12 * badgeSwap).toFixed(3) + ')';
        dom.badgePost.style.opacity = badgeSwap.toFixed(2);
        dom.badgePost.style.transform = 'scale(' + (0.86 + 0.14 * spring(badgeSwap)).toFixed(3) + ')';
        if (dom.check) dom.check.setAttribute('stroke-dashoffset',
            (11 * (1 - easeOut((lt1 - 2.34) / 0.3))).toFixed(2));
        var rAt = [2.6, 2.82];
        for (var rp = 0; rp < 2; rp++) {
            var pp = ease((lt1 - rAt[rp]) / 0.3);
            dom.rivals[rp].style.opacity = pp.toFixed(2);
            dom.rivals[rp].style.transform = 'translateX(' + ((1 - pp) * 12).toFixed(1) + 'px)';
        }

        // ---------- DOMINE (5.2 – 8.8) + FINALE (8.8 – 11.6) ----------
        var lt2 = t - BOUNDS[2][0];
        var sp = clamp(lt2 / 3.25);
        var monthIdx = Math.min(7, Math.floor(sp * 8));
        dom.monthLabel.textContent = MONTHS[monthIdx];
        for (var mt = 0; mt < MONTHS.length; mt++) {
            dom.monthTicks[mt].style.color = mt <= monthIdx ? 'rgba(23,23,26,0.6)' : 'rgba(23,23,26,0.22)';
        }
        dom.seasonFill.style.transform = 'scaleX(' + sp.toFixed(3) + ')';

        var rowH = 24;
        var youPts = 14 + 50 * ease(sp);
        var field = [{ name: 'VOUS', raw: youPts, isYou: true }];
        for (var bi = 0; bi < BOARD.length; bi++) {
            field.push({ name: BOARD[bi].name, raw: BOARD[bi].from + (BOARD[bi].to - BOARD[bi].from) * sp, isYou: false });
        }
        var soften = function (d) { return clamp(0.5 + d / 2.6); };
        var ranked = field.map(function (aa) {
            var rank = 1;
            for (var k = 0; k < field.length; k++) if (field[k] !== aa) rank += soften(field[k].raw - aa.raw);
            return { name: aa.name, raw: aa.raw, isYou: aa.isYou, rank: rank };
        });
        var youRank = 1;
        for (var yk = 0; yk < ranked.length; yk++) if (ranked[yk].isYou) youRank = ranked[yk].rank;
        var trophy = clamp((1.28 - youRank) / 0.22);
        var pulse = PULSE_WINNER === false ? 0 : 0.5 + 0.5 * Math.sin(clockMs / 320);
        for (var ri = 0; ri < ranked.length; ri++) {
            var rr = ranked[ri];
            var frac = rr.rank - Math.round(rr.rank);
            var xr = (rr.isYou ? -6 : 7) * Math.sin(Math.PI * clamp(Math.abs(frac) * 2));
            var yr = (rr.rank - 1) * rowH;
            var rowEl = dom.rankRows[ri];
            rowEl.style.zIndex = rr.isYou ? 2 : 1;
            rowEl.style.transform = 'translate(' + xr.toFixed(2) + 'px,' + yr.toFixed(2) + 'px)';
            var inner = dom.rankInner[ri];
            inner.style.background = rr.isYou ? accent : '#F4F3F1';
            inner.style.boxShadow = rr.isYou && trophy > 0.05
                ? '0 0 0 ' + (trophy * (2.5 + 3 * pulse)).toFixed(2) + 'px ' + accent + '26' : 'none';
            dom.rankName[ri].textContent = rr.name;
            dom.rankName[ri].style.color = rr.isYou ? '#fff' : '#17171A';
            dom.rankPts[ri].textContent = Math.round(rr.raw);
            dom.rankPts[ri].style.color = rr.isYou ? '#fff' : '#17171A';
            dom.rankTrophy[ri].style.opacity = rr.isYou ? trophy.toFixed(2) : '0';
        }
        for (var rn = 0; rn < 6; rn++) dom.rankNums[rn].style.top = (rn * rowH).toFixed(2) + 'px';

        // ---- FINALE ----
        var lt3 = t - 8.8;
        var finOn = clamp(lt3 / 0.45);
        var travel = ease((lt3 - 0.12) / 0.8);
        dom.finale.style.opacity = finOn.toFixed(3);
        dom.finale.style.pointerEvents = finOn > 0.5 ? 'auto' : 'none';
        dom.finTrophy.style.left = (304 - 298 * travel).toFixed(1) + 'px';
        dom.finTrophy.style.top = (106 - 34 * travel).toFixed(1) + 'px';
        dom.finTrophy.style.transform = 'scale(' + (1 + 3 * travel).toFixed(3) + ')';

        var msgP = clamp((lt3 - 0.6) / 0.4);
        var btnP = clamp((lt3 - 0.9) / 0.4);

        // message final — entrée plus marquée que la maquette : la classe
        // .cdd-in déclenche un keyframe (scale 0.9→1.05→1) une seule fois,
        // puis on laisse le CSS tenir l'état final (fill-mode both).
        if (!msgShown) {
            dom.finMsg.style.opacity = reduced ? '1' : msgP.toFixed(2);
            if (msgP > 0.02) {
                msgShown = true;
                if (!reduced) { dom.finMsg.style.opacity = ''; dom.finMsg.classList.add('cdd-in'); }
            }
        }
        dom.dom.style.setProperty('--cdd-dom-underline', reduced ? '1' : easeOut((lt3 - 1.05) / 0.5).toFixed(3));
        if (!domPulsed && !reduced && lt3 > 1.2) {
            domPulsed = true;
            dom.dom.classList.add('is-pulse');
            pulseTimer = setTimeout(function () { dom.dom.classList.remove('is-pulse'); }, 340);
        }

        dom.finBtns.style.opacity = btnP.toFixed(2);
        dom.finBtns.style.transform = 'translateY(' + ((1 - btnP) * 10).toFixed(1) + 'px)';
        var sweep = function (offset) {
            var phase = clamp(((clockMs + offset) % 2200) / 900, 0, 1);
            return 'translateX(' + (-70 + 300 * phase).toFixed(1) + '%) skewX(-14deg)';
        };
        dom.swooshA.style.transform = btnP > 0.05 ? sweep(0) : 'translateX(-70%) skewX(-14deg)';
        dom.swooshB.style.transform = btnP > 0.05 ? sweep(-260) : 'translateX(-70%) skewX(-14deg)';
        dom.replay.style.opacity = clamp((lt3 - 1.3) / 0.4).toFixed(2);
        dom.replay.style.pointerEvents = lt3 > 1.6 ? 'auto' : 'none';

        // ---- scènes : opacité + glissement ----
        // DOMINE (scène + titre) s'efface sous la finale, comme la maquette
        // qui passe la valeur « dimmed » aux deux via {{ s2.o }}.
        var s0 = sc(0), s1 = sc(1), s2 = sc(2);
        var s2dim = s2.o * (1 - 0.86 * finOn);
        applyScene(dom.s[0], s0.o, s0.ty);
        applyScene(dom.s[1], s1.o, s1.ty);
        applyScene(dom.s[2], s2dim, s2.ty);

        // ---- barre de phases ----
        for (var fp = 0; fp < 3; fp++) {
            var b0 = BOUNDS[fp][0], b1 = BOUNDS[fp][1];
            dom.phaseFills[fp].style.transform = 'scaleX(' + clamp((t - b0) / (b1 - b0)).toFixed(3) + ')';
            var activeP = (t >= b0 && t < b1) || (fp === 2 && t >= BOUNDS[2][1] - 0.01);
            dom.phaseLbls[fp].style.color = activeP ? '#17171A' : 'rgba(23,23,26,0.4)';
        }
        dom.phasesWrap.style.opacity = (1 - finOn).toFixed(3);

        // ---- titres (mêmes fenêtres que les scènes) ----
        applyScene(dom.titleLayers[0], s0.o, s0.ty);
        applyScene(dom.titleLayers[1], s1.o, s1.ty);
        applyScene(dom.titleLayers[2], s2dim, s2.ty);
    }

    function applyScene(el, o, ty) {
        el.style.opacity = (+o).toFixed(3);
        el.style.transform = 'translateY(' + (+ty).toFixed(2) + 'px)';
    }

    // ============================================================
    // BOUCLE / CYCLE DE VIE
    // ============================================================
    function frame(now) {
        if (!running) return;
        var end = LOOP / 1000;
        var t = (now - startT) * SPEED / 1000;
        if (t >= end) {
            // Cycle terminé : une dernière image figée sur la finale, puis
            // on coupe la boucle rAF (pas de relance auto — bouton Rejouer).
            render(end, now);
            running = false;
            rafId = null;
            done = true;
            return;
        }
        render(t, now);
        rafId = requestAnimationFrame(frame);
    }

    function play() {
        if (running || reduced || done) return;
        running = true;
        startT = (window.performance ? performance.now() : Date.now()) - (pausedAt || 0);
        pausedAt = 0;
        rafId = requestAnimationFrame(frame);
    }

    function halt() {
        if (!running) return;
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        pausedAt = (window.performance ? performance.now() : Date.now()) - startT;
    }

    function resetCycle() {
        if (pulseTimer) { clearTimeout(pulseTimer); pulseTimer = null; }
        msgShown = false;
        domPulsed = false;
        done = false;
        pausedAt = 0;
        if (dom) {
            dom.dom.classList.remove('is-pulse');
            dom.finMsg.classList.remove('cdd-in');
            dom.finMsg.style.opacity = '0';
            void dom.finMsg.offsetWidth;   // reflow : rejoue le keyframe
        }
    }

    function replay() {
        resetCycle();
        startT = (window.performance ? performance.now() : Date.now());
        if (reduced) { render(11.4, 0); return; }
        if (enabled && visible && !running) play();
    }

    var API = {
        start: function () {
            build();
            if (!dom) return;
            enabled = true;
            if (reduced) { render(11.4, 0); return; }
            if (visible) play();
        },
        stop: function () {
            enabled = false;
            halt();
        }
    };
    window.FZCdd = API;

    // Anonyme : la section est déjà visible (html.fz-anon) → démarrage seul.
    // Connecté : accueil-dash.js appellera start()/stop() plus tard.
    function boot() {
        var sec = document.getElementById('cddSection');
        if (!sec) return;
        if (getComputedStyle(sec).display !== 'none') API.start();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
