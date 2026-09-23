/* ============================================================
   LANDING — le mouvement de l'accueil des visiteurs
   ------------------------------------------------------------
   Rien ici n'invente de contenu : le texte et les chiffres sont
   déjà dans le HTML (index.html, <main class="fzl">), tirés des
   vraies stats 2025–26. Ce fichier ne fait que les animer :

     1. révéler les blocs quand ils arrivent à l'écran ;
     2. le scorebug — la période en cours, au défilement ;
     3. la salle de repêchage du téléphone, en boucle ;
     4. la file du pool rapide qui se remplit ;
     5. le compteur du classement ;
     6. l'échange qui passe de « proposé » à « accepté ».

   Le mouvement sert à montrer que la compétition est vivante :
   chaque boucle ne tourne que visible à l'écran, et s'arrête
   quand l'onglet est caché. Mouvement réduit : tout reste dans
   son état final, rien ne boucle.
   ============================================================ */
(function () {
    'use strict';

    function init() {
        const racine = document.getElementById('fzLanding');
        if (!racine) return;
        // Un membre voit son tableau de bord ; la landing est masquée.
        if (document.documentElement.classList.contains('fz-auth')) return;

        const reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const avecObservateur = 'IntersectionObserver' in window;
        const anime = !reduit && avecObservateur;

        // Les états « avant animation » (landing.css) ne s'appliquent qu'avec
        // cette classe : sans JS, ou en mouvement réduit, tout est visible.
        if (anime) racine.classList.add('is-anim');

        reveler(racine, anime);
        scorebug(racine, reduit, avecObservateur);

        const boucles = [
            boucleTelephone(),
            boucleFile(),
            boucleEchange()
        ].filter(Boolean);

        if (anime) {
            boucles.forEach(b => surVisibilite(b.cible, vu => b.vue(vu), 0.3));
            document.addEventListener('visibilitychange', () => boucles.forEach(b => b.actualiser()));
        } else {
            boucles.forEach(b => b.etatFinal());
        }

        compteurClassement(anime);
    }

    /* ------------------------------------------------------------
       Outils
       ------------------------------------------------------------ */
    function surVisibilite(el, rappel, seuil) {
        const io = new IntersectionObserver(entrees => {
            entrees.forEach(e => rappel(e.isIntersecting));
        }, { threshold: seuil || 0 });
        io.observe(el);
        return io;
    }

    /**
     * Une boucle d'étapes [délai, action]. Une seule minuterie en attente à la
     * fois ; `vue()` et l'onglet caché décident si elle tourne. Chaque départ
     * repasse par `reinitialiser`, pour ne jamais reprendre au milieu.
     */
    function creerBoucle(cible, etapes, reinitialiser, etatFinal, nettoyer) {
        let minuterie = null;
        let tourne = false;
        let enVue = false;

        function planifier(i) {
            const [delai, action] = etapes[i];
            minuterie = setTimeout(() => {
                if (!tourne) return;
                action();
                planifier((i + 1) % etapes.length);
            }, delai);
        }
        function demarrer() {
            if (tourne) return;
            tourne = true;
            reinitialiser();
            planifier(0);
        }
        function arreter() {
            tourne = false;
            clearTimeout(minuterie);
            minuterie = null;
            if (nettoyer) nettoyer();
        }
        function actualiser() {
            if (enVue && !document.hidden) demarrer();
            else arreter();
        }
        return {
            cible,
            vue(v) { enVue = v; actualiser(); },
            actualiser,
            etatFinal
        };
    }

    /* ------------------------------------------------------------
       1. Révélations — une fois chacune.
       ------------------------------------------------------------ */
    function reveler(racine, anime) {
        const cibles = racine.querySelectorAll('.fzl-period, .fzl-xls, .fzl-chat, .fzl-swap, .fzl-board-draft');
        if (!anime) {
            cibles.forEach(el => el.classList.add('is-in'));
            return;
        }
        const io = new IntersectionObserver(entrees => {
            entrees.forEach(e => {
                if (!e.isIntersecting) return;
                e.target.classList.add('is-in');
                io.unobserve(e.target);
            });
        }, { threshold: 0.25, rootMargin: '0px 0px -8% 0px' });
        cibles.forEach(el => io.observe(el));
    }

    /* ------------------------------------------------------------
       2. Scorebug — la période en cours.

       La section active est celle qui coupe le milieu de l'écran. Le
       changement passe par un volet brique (landing.css, fzlWipe) ; le
       texte change à mi-course, quand le volet couvre la pastille.
       ------------------------------------------------------------ */
    function scorebug(racine, reduit, avecObservateur) {
        const bug = document.getElementById('fzlBug');
        const periode = document.getElementById('fzlBugPeriod');
        const titre = document.getElementById('fzlBugTitle');
        const cta = document.getElementById('fzlHeroCta');
        if (!bug || !periode || !titre || !avecObservateur) return;

        const pastilles = Array.from(bug.querySelectorAll('[data-pip]'));
        const sections = Array.from(racine.querySelectorAll('[data-period]'));
        let courante = null;
        let piedVisible = false;
        let ctaPasse = false;

        function appliquer(section) {
            periode.textContent = section.dataset.period;
            titre.textContent = section.dataset.title;
            // La FAQ appartient à la même période que les faits.
            const id = section.id === 'questions' ? 'faits' : section.id;
            let avant = true;
            pastilles.forEach(p => {
                const active = p.dataset.pip === id;
                if (active) {
                    p.setAttribute('aria-current', 'step');
                    avant = false;
                } else {
                    p.removeAttribute('aria-current');
                }
                p.classList.toggle('is-past', avant && !active);
            });
            bug.classList.toggle('is-final', section.id === 'a-toi');
        }

        function activer(section) {
            if (section === courante) return;
            const memePeriode = courante && courante.dataset.period === section.dataset.period;
            courante = section;
            if (reduit || memePeriode || !bug.classList.contains('is-shown')) {
                appliquer(section);
                return;
            }
            bug.classList.remove('is-wiping');
            void bug.offsetWidth; // relance l'animation
            bug.classList.add('is-wiping');
            setTimeout(() => appliquer(section), 260);
        }

        const io = new IntersectionObserver(entrees => {
            entrees.forEach(e => { if (e.isIntersecting) activer(e.target); });
        }, { rootMargin: '-50% 0px -50% 0px', threshold: 0 });
        sections.forEach(s => io.observe(s));

        bug.addEventListener('animationend', () => bug.classList.remove('is-wiping'));

        // Visible une fois les boutons du héros dépassés, et caché au-dessus
        // des mentions légales pour ne jamais les recouvrir.
        function montrer() {
            bug.classList.toggle('is-shown', ctaPasse && !piedVisible);
        }
        if (cta) {
            new IntersectionObserver(([e]) => {
                ctaPasse = !e.isIntersecting && e.boundingClientRect.top < 0;
                montrer();
            }).observe(cta);
        }
        // navbar.js ajoute le pied de page au DOMContentLoaded, après nous.
        requestAnimationFrame(() => {
            const pied = document.querySelector('.site-legal-footer');
            if (!pied) return;
            new IntersectionObserver(([e]) => {
                piedVisible = e.isIntersecting;
                montrer();
            }).observe(pied);
        });

        bug.addEventListener('click', e => {
            const lien = e.target.closest('[data-pip]');
            if (!lien) return;
            // Le focus suit le saut, pour les claviers et lecteurs d'écran.
            const cible = document.getElementById(lien.dataset.pip);
            if (cible) {
                cible.setAttribute('tabindex', '-1');
                setTimeout(() => cible.focus({ preventScroll: true }), reduit ? 0 : 500);
            }
        });
    }

    /* ------------------------------------------------------------
       3. Le téléphone — deux choix de suite, grâce au serpent.

       Choix 4 : Celebrini. Puis, l'ordre s'inversant à la ronde 2, la
       même équipe choisit encore (choix 5 : Scheifele). Puis c'est au
       suivant. Mêmes joueurs, mêmes points que le reste de la page.
       ------------------------------------------------------------ */
    function boucleTelephone() {
        const $ = id => document.getElementById(id);
        const ecran = $('fzlPhone');
        if (!ecran) return null;

        const banniere = $('fzlPhBanner');
        const libelle = $('fzlPhLabel');
        const horloge = $('fzlPhClock');
        const bande = $('fzlPhStrip');
        const case4 = $('fzlPhSlot4');
        const case5 = $('fzlPhSlot5');
        const ligne1 = $('fzlPhRow1');
        const ligne2 = $('fzlPhRow2');
        const barre = $('fzlPhBar');
        const compte = $('fzlPhCount');
        const numero = $('fzlPhPick');
        if (!banniere || !libelle || !horloge || !bande || !case4 || !case5 || !ligne1 || !ligne2) return null;

        let secondes = 0;
        let tic = null;

        function ecrireLibelle(texte, sous) {
            libelle.textContent = texte;
            const petit = document.createElement('small');
            petit.textContent = sous;
            libelle.appendChild(petit);
        }
        function afficherHorloge() {
            const m = Math.floor(secondes / 60);
            const s = secondes % 60;
            horloge.textContent = m + ':' + (s < 10 ? '0' : '') + s;
        }
        // Le chrono du vrai repêchage compte le temps écoulé depuis le début
        // du tour (draftActif.js) — il monte, il ne descend pas.
        function chrono(depart) {
            clearInterval(tic);
            secondes = depart;
            afficherHorloge();
            tic = setInterval(() => { secondes += 1; afficherHorloge(); }, 1000);
        }
        function viderCase(carte, no, courante) {
            carte.className = 'fzl-pk is-empty' + (courante ? ' is-current' : '');
            carte.removeAttribute('style');
            carte.textContent = '';
            const n = document.createElement('span');
            n.className = 'fzl-pk-no';
            n.textContent = no;
            carte.appendChild(n);
        }
        function remplirCase(carte, ligne, no) {
            const d = ligne.dataset;
            viderCase(carte, no, false);
            carte.className = 'fzl-pk is-revealing';
            carte.style.setProperty('--c1', d.c1);
            carte.style.setProperty('--c2', d.c2);

            const logo = new Image(18, 18);
            logo.className = 'fzl-pk-logo';
            logo.alt = '';
            logo.src = 'teams/' + d.club + '.png';
            const face = new Image(80, 80);
            face.className = 'fzl-pk-face';
            face.alt = '';
            face.src = d.face;
            face.onerror = () => { face.hidden = true; };
            const nom = document.createElement('span');
            nom.className = 'fzl-pk-name';
            nom.textContent = d.name;
            const meta = document.createElement('span');
            meta.className = 'fzl-pk-meta';
            meta.textContent = d.meta;
            carte.append(logo, face, nom, meta);
        }
        function marquerPris(ligne) {
            ligne.classList.remove('is-pressing', 'is-armed');
            ligne.classList.add('is-taken');
            const bouton = ligne.querySelector('.fzl-ph-pick');
            if (bouton) bouton.textContent = 'Choisi';
        }
        function progression(n) {
            barre.style.setProperty('--p', n / 6);
            compte.textContent = n + '/6';
        }

        function reinitialiser() {
            viderCase(case4, 4, true);
            viderCase(case5, 5, false);
            bande.classList.remove('is-shifted');
            [ligne1, ligne2].forEach(l => {
                l.classList.remove('is-taken', 'is-pressing', 'is-armed');
                const bouton = l.querySelector('.fzl-ph-pick');
                if (bouton) bouton.textContent = 'Repêcher';
            });
            ligne1.classList.add('is-armed');
            banniere.dataset.state = 'turn';
            ecrireLibelle("C'est ton tour", 'Ronde 1 · Choix 4');
            numero.textContent = '4/52';
            progression(0);
            chrono(5);
        }

        const etapes = [
            [2600, () => ligne1.classList.add('is-pressing')],
            [550, () => {
                marquerPris(ligne1);
                remplirCase(case4, ligne1, 4);
                banniere.dataset.state = 'done';
                ecrireLibelle('Choix confirmé', 'Macklin Celebrini · San Jose');
                clearInterval(tic);
                progression(1);
            }],
            [1900, () => {
                banniere.dataset.state = 'turn';
                ecrireLibelle('Encore toi !', "Ronde 2 · l'ordre revient en serpent");
                numero.textContent = '5/52';
                bande.classList.add('is-shifted');
                case5.classList.add('is-current');
                ligne2.classList.add('is-armed');
                chrono(0);
            }],
            [2400, () => ligne2.classList.add('is-pressing')],
            [550, () => {
                marquerPris(ligne2);
                remplirCase(case5, ligne2, 5);
                banniere.dataset.state = 'done';
                ecrireLibelle('Choix confirmé', 'Mark Scheifele · Winnipeg');
                clearInterval(tic);
                progression(2);
            }],
            [2000, () => {
                banniere.dataset.state = 'wait';
                ecrireLibelle('Pool des boys choisit…', 'Ronde 2 · Choix 6');
                numero.textContent = '6/52';
                chrono(0);
            }],
            [3400, reinitialiser]
        ];

        return creerBoucle(ecran, etapes, reinitialiser,
            // Mouvement réduit : l'état de départ dit déjà l'essentiel.
            () => {},
            () => clearInterval(tic));
    }

    /* ------------------------------------------------------------
       4. Pool rapide — la file se remplit, puis le repêchage part.
       ------------------------------------------------------------ */
    function boucleFile() {
        const file = document.getElementById('fzlQueue');
        const nombre = document.getElementById('fzlQueueCount');
        const depart = document.getElementById('fzlQueueGo');
        if (!file || !nombre || !depart) return null;
        const places = Array.from(file.querySelectorAll('.fzl-slot'));

        function remplir(n) {
            file.dataset.filled = String(n);
            places.forEach((p, i) => p.classList.toggle('is-filled', i < n));
            nombre.textContent = n + '/4';
            depart.textContent = n === 4 ? 'Complet · le repêchage commence' : 'En attente de joueurs…';
        }

        const etapes = [
            [1100, () => remplir(2)],
            [900, () => remplir(3)],
            [1000, () => remplir(4)],
            [2800, () => remplir(1)]
        ];
        return creerBoucle(file, etapes, () => remplir(1), () => remplir(4));
    }

    /* ------------------------------------------------------------
       6. L'échange — proposé, puis accepté.
       ------------------------------------------------------------ */
    function boucleEchange() {
        const statut = document.getElementById('fzlTradeStatus');
        if (!statut) return null;
        const etapes = [
            [1800, () => statut.classList.add('is-done')],
            [2600, () => statut.classList.remove('is-done')]
        ];
        return creerBoucle(statut, etapes,
            () => statut.classList.remove('is-done'),
            () => statut.classList.add('is-done'));
    }

    /* ------------------------------------------------------------
       5. Le classement — les totaux montent jusqu'à leur vraie valeur.
       ------------------------------------------------------------ */
    function compteurClassement(anime) {
        const liste = document.getElementById('fzlStandings');
        if (!liste || !anime) return;
        const nombres = Array.from(liste.querySelectorAll('[data-count]'));
        const format = n => n.toLocaleString('fr-CA');
        let fait = false;

        const io = surVisibilite(liste, visible => {
            if (!visible || fait) return;
            fait = true;
            io.disconnect();
            const debut = performance.now();
            const duree = 1400;
            nombres.forEach(el => { el.textContent = format(0); });
            function image(t) {
                const p = Math.min(1, (t - debut) / duree);
                const e = 1 - Math.pow(1 - p, 3);
                nombres.forEach(el => {
                    el.textContent = format(Math.round(Number(el.dataset.count) * e));
                });
                if (p < 1) requestAnimationFrame(image);
            }
            requestAnimationFrame(image);
        }, 0.5);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
