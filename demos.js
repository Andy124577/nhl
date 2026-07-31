/* ============================================================
   DÉMONSTRATIONS ANIMÉES — accueil
   ------------------------------------------------------------
   Quatre maquettes qui rejouent les écrans réels :

     · la carte héros    → la salle de repêchage (draftActif)
     · étape 1           → le formulaire de création (creer-pool)
     · étape 2           → le tableau de repêchage et « Ma progression »
     · étape 3           → le classement du pool (classement)

   Les libellés sont ceux du site, au caractère près : « 🎯 C'est votre
   tour — sélectionnez un joueur ! », « Créer le pool », « Attaquants
   2/6 ». Une démonstration qui promet autre chose que ce qu'on trouve
   ensuite dessert la page qu'elle illustre.

   Rien ne tourne hors de l'écran, ni quand le système demande moins de
   mouvement : chaque boucle est alors figée sur son état final.
   ============================================================ */
(function () {
    const SANS_MOUVEMENT = window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : { matches: false };

    /**
     * Boucle une suite d'actions datées, uniquement pendant que
     * l'élément est visible.
     *
     * `etapes` : [[instant en ms, action], …]
     * `duree`  : longueur totale du cycle avant reprise au début.
     */
    function boucler(element, etapes, duree, etatFinal) {
        if (!element) return;

        if (SANS_MOUVEMENT.matches) {
            if (etatFinal) etatFinal();
            return;
        }

        let minuteries = [];
        let actif = false;

        const vider = () => { minuteries.forEach(clearTimeout); minuteries = []; };

        const cycle = () => {
            etapes.forEach(([instant, action]) => {
                minuteries.push(setTimeout(action, instant));
            });
            minuteries.push(setTimeout(() => { if (actif) { vider(); cycle(); } }, duree));
        };

        const demarrer = () => { if (!actif) { actif = true; cycle(); } };
        const arreter  = () => { actif = false; vider(); };

        if ('IntersectionObserver' in window) {
            new IntersectionObserver(entrees => {
                entrees.forEach(e => (e.isIntersecting ? demarrer() : arreter()));
            }, { threshold: .2 }).observe(element);
        } else {
            demarrer();
        }

        // Un onglet en arrière-plan n'a personne à convaincre.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) arreter();
        });
    }

    const $ = (racine, sel) => racine && racine.querySelector(sel);

    /** Place le curseur sur un élément, en coordonnées de la maquette. */
    function viser(curseur, cible, decalageX, decalageY) {
        if (!curseur || !cible) return;
        const boite = cible.getBoundingClientRect();
        const cadre = curseur.parentElement.getBoundingClientRect();
        const x = boite.left - cadre.left + (decalageX == null ? boite.width - 14 : decalageX);
        const y = boite.top - cadre.top + (decalageY == null ? boite.height / 2 : decalageY);
        curseur.style.transform = `translate(${x}px, ${y}px)`;
        curseur.classList.add('is-on');
    }

    function cliquer(curseur) {
        if (!curseur) return;
        curseur.classList.add('is-click');
        setTimeout(() => curseur.classList.remove('is-click'), 520);
    }

    // ============================================================
    // CARTE HÉROS — la salle de repêchage
    // ============================================================
    function demoHeros() {
        const carte = document.getElementById('heroCardDraft');
        if (!carte) return;

        const banniere = $(carte, '#demoTurnBanner');
        const compteur = $(carte, '#demoPickCounter');
        const rangees  = [...carte.querySelectorAll('.dm-player')];
        const ligneAtt = $(carte, '[data-cat="off"]');
        const barreAtt = $(ligneAtt, '.dm-bar i');
        const cntAtt   = $(ligneAtt, '.dm-count');

        const CIBLE = rangees[0];
        const TOUR = "🎯 C'est votre tour — sélectionnez un joueur !";
        const ATTENTE = '⏳ Au tour de Ice Storm MTL…';

        const remettre = () => {
            banniere.textContent = TOUR;
            banniere.className = 'dm-banner is-your-turn';
            compteur.textContent = 'Choix 7 / 40';
            rangees.forEach(r => r.className = 'dm-player');
            barreAtt.style.width = '33%';
            cntAtt.textContent = '2/6';
            cntAtt.classList.remove('is-bump');
        };

        remettre();

        boucler(carte, [
            [1200, () => CIBLE.classList.add('is-target')],
            [2100, () => { CIBLE.classList.remove('is-target'); CIBLE.classList.add('is-picked'); }],
            [2900, () => {
                compteur.textContent = 'Choix 8 / 40';
                barreAtt.style.width = '50%';
                cntAtt.textContent = '3/6';
                cntAtt.classList.add('is-bump');
            }],
            [3400, () => CIBLE.classList.add('is-gone')],
            [4100, () => {
                banniere.textContent = ATTENTE;
                banniere.className = 'dm-banner is-waiting';
            }],
            [6600, remettre]
        ], 7600, () => {
            // Sans mouvement : le choix est déjà fait, l'effectif avancé.
            banniere.textContent = TOUR;
            banniere.className = 'dm-banner';
            compteur.textContent = 'Choix 8 / 40';
            barreAtt.style.width = '50%';
            cntAtt.textContent = '3/6';
        });
    }

    // ============================================================
    // ÉTAPE 1 — CRÉER UN POOL
    // ============================================================
    function demoCreation() {
        const demo = document.querySelector('.hiw-create');
        if (!demo) return;

        const champ    = $(demo, '.hiw-input');
        const saisi    = $(demo, '.hiw-typed');
        const jetons   = [...demo.querySelectorAll('.hiw-chip')];
        const bouton   = $(demo, '.hiw-btn');
        const curseur  = $(demo, '.hiw-cursor');

        const NOM = 'Pool des champions';
        let frappe = null;

        const remettre = () => {
            clearInterval(frappe);
            saisi.textContent = '';
            champ.classList.remove('is-focus');
            jetons.forEach(j => j.classList.remove('is-in'));
            bouton.textContent = 'Créer le pool';
            bouton.className = 'hiw-btn';
            curseur.classList.remove('is-on', 'is-click');
        };

        const taper = () => {
            let i = 0;
            frappe = setInterval(() => {
                saisi.textContent = NOM.slice(0, ++i);
                if (i >= NOM.length) clearInterval(frappe);
            }, 62);
        };

        remettre();

        boucler(demo, [
            [300,  () => { viser(curseur, champ, 30, 13); }],
            [700,  () => { champ.classList.add('is-focus'); cliquer(curseur); }],
            [900,  taper],
            // Les jetons reprennent les valeurs par défaut du vrai formulaire.
            [2500, () => jetons[0] && jetons[0].classList.add('is-in')],
            [2700, () => jetons[1] && jetons[1].classList.add('is-in')],
            [2900, () => jetons[2] && jetons[2].classList.add('is-in')],
            [3100, () => jetons[3] && jetons[3].classList.add('is-in')],
            [3300, () => jetons[4] && jetons[4].classList.add('is-in')],
            [3800, () => { champ.classList.remove('is-focus'); viser(curseur, bouton, 40, 14); }],
            [4500, () => { bouton.classList.add('is-press'); cliquer(curseur); }],
            [4800, () => {
                bouton.classList.remove('is-press');
                bouton.classList.add('is-done');
                bouton.textContent = '✓ Pool créé';
            }],
            [6400, remettre]
        ], 7000, () => {
            saisi.textContent = NOM;
            jetons.forEach(j => j.classList.add('is-in'));
            bouton.textContent = '✓ Pool créé';
            bouton.className = 'hiw-btn is-done';
        });
    }

    // ============================================================
    // ÉTAPE 2 — REPÊCHER SON ÉQUIPE
    // ============================================================
    function demoRepechage() {
        const demo = document.querySelector('.hiw-draft');
        if (!demo) return;

        const tour    = $(demo, '.hiw-turn');
        const rangees = [...demo.querySelectorAll('.hiw-row')];
        const barre   = $(demo, '.hiw-bar i');
        const compte  = $(demo, '.hiw-cnt');
        const curseur = $(demo, '.hiw-cursor');

        const CIBLE = rangees[0];

        const remettre = () => {
            tour.textContent = "🎯 C'est votre tour";
            tour.className = 'hiw-turn';
            rangees.forEach(r => r.className = 'hiw-row');
            barre.style.width = '33%';
            compte.textContent = '2/6';
            compte.classList.remove('is-bump');
            curseur.classList.remove('is-on', 'is-click');
        };

        remettre();

        boucler(demo, [
            [600,  () => viser(curseur, CIBLE, null, 12)],
            [1300, () => { CIBLE.classList.add('is-target'); }],
            [1900, () => { cliquer(curseur); CIBLE.classList.remove('is-target'); CIBLE.classList.add('is-picked'); }],
            [2600, () => {
                barre.style.width = '50%';
                compte.textContent = '3/6';
                compte.classList.add('is-bump');
            }],
            [3200, () => { CIBLE.classList.add('is-gone'); curseur.classList.remove('is-on'); }],
            [3900, () => { tour.textContent = '⏳ Au tour de Ice Storm'; tour.className = 'hiw-turn is-waiting'; }],
            [6100, remettre]
        ], 7000, () => {
            barre.style.width = '50%';
            compte.textContent = '3/6';
            CIBLE.className = 'hiw-row is-picked';
        });
    }

    // ============================================================
    // ÉTAPE 3 — COMPÉTITIONNER ET GAGNER
    // ============================================================
    function demoClassement() {
        const demo = document.querySelector('.hiw-rank');
        if (!demo) return;

        const semaine = $(demo, '.hiw-week');
        const mienne  = $(demo, '.hiw-rrow.is-mine');
        const autres  = [...demo.querySelectorAll('.hiw-rrow:not(.is-mine)')];
        const points  = $(mienne, '.hiw-rrow-pts');
        const rang    = $(mienne, '.hiw-pos');
        const gain    = $(demo, '.hiw-gain');

        // Hauteur d'une rangée + l'espace qui la sépare de la suivante :
        // la remontée doit tomber exactement sur la ligne du dessus.
        const pas = () => mienne.offsetHeight + 5;

        const remettre = () => {
            semaine.textContent = 'Semaine 11';
            points.textContent = '147';
            rang.textContent = '3';
            rang.className = 'hiw-pos bronze';
            mienne.style.transform = '';
            autres.forEach(a => a.style.transform = '');
            gain.classList.remove('is-up');
        };

        // Gagner un rang, c'est doubler la rangée juste au-dessus : ce sont
        // les `crans` dernières de `autres` qui descendent, pas les premières.
        const monter = (crans) => {
            mienne.style.transform = `translateY(${-pas() * crans}px)`;
            autres.slice(autres.length - crans).forEach(a => {
                a.style.transform = `translateY(${pas()}px)`;
            });
        };

        remettre();

        boucler(demo, [
            [900,  () => { gain.textContent = '+21'; gain.classList.add('is-up'); }],
            [1300, () => { points.textContent = '168'; }],
            [1800, () => { rang.textContent = '2'; rang.className = 'hiw-pos silver'; monter(1); }],
            [3000, () => { gain.classList.remove('is-up'); }],
            [3200, () => { gain.textContent = '+24'; gain.classList.add('is-up'); }],
            [3600, () => { points.textContent = '192'; }],
            [4100, () => {
                semaine.textContent = 'Semaine 12';
                rang.textContent = '1';
                rang.className = 'hiw-pos gold';
                monter(2);
            }],
            [6300, remettre]
        ], 7200, () => {
            // Sans mouvement, on ne peut pas mesurer une hauteur de rangée
            // avant la mise en page : la remontée se joue donc dans l'ordre
            // du document, ce qui donne le même résultat sans transition.
            semaine.textContent = 'Semaine 12';
            points.textContent = '192';
            rang.textContent = '1';
            rang.className = 'hiw-pos gold';

            const tableau = mienne.parentElement;
            tableau.insertBefore(mienne, tableau.firstElementChild);
            autres.forEach((autre, i) => {
                const badge = autre.querySelector('.hiw-pos');
                badge.textContent = String(i + 2);
                badge.className = 'hiw-pos ' + (i === 0 ? 'silver' : 'bronze');
            });
        });
    }

    // ============================================================
    document.addEventListener('DOMContentLoaded', () => {
        demoHeros();
        demoCreation();
        demoRepechage();
        demoClassement();
    });
})();
