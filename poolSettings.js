/* ============================================================
   RÉGLAGES DU POOL — le panneau derrière l'engrenage
   ------------------------------------------------------------
   Ce panneau remplace la page « Mes pools ». Celle-ci obligeait à quitter
   l'écran en cours pour lire une règle ou renommer une équipe, et affichait
   côte à côte des choses qui ne se ressemblent pas : la liste des pools (qui
   vit désormais dans le rail, poolNav.js) et les réglages de chacun.

   Ne reste ici que ce qui porte sur un seul pool, à portée de l'engrenage
   posé contre son nom :

     Règles   — la configuration figée à la création, en lecture seule.
     Équipes  — toutes les équipes, leurs noms, leurs membres, leurs choix.
                On y renomme son équipe et on en change tant que le
                repêchage n'a pas démarré.
     Identité — le nom du pool et sa vignette. Réservé à la personne qui a
                créé le pool : c'est le seul onglet que les autres ne
                voient pas.

   Le crayon du rail ouvre directement « Identité », l'engrenage « Règles ».

   Aucune dépendance : ni jQuery, ni equipes.js. Le panneau est chargé sur
   toutes les pages qui portent le rail, et plusieurs d'entre elles n'ont
   ni l'un ni l'autre.
   ============================================================ */
(function () {
    const BASE_URL = (window.FZPool && FZPool.BASE_URL) ||
        (window.location.hostname.includes('localhost')
            ? 'http://localhost:3000'
            : window.location.origin);

    const LIBELLE_ETAT = {
        attente: 'En attente de joueurs',
        pret:    'Prêt à repêcher',
        encours: 'Repêchage en cours',
        termine: 'Saison en cours'
    };

    const ONGLETS = [
        { cle: 'regles',   titre: 'Règles' },
        { cle: 'equipes',  titre: 'Équipes' },
        { cle: 'identite', titre: 'Identité', createurSeulement: true }
    ];

    const echapper = texte => String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const utilisateur = () => localStorage.getItem('username') || '';

    /**
     * Qui a créé ce pool — même règle que le serveur (createurDuPool).
     *
     * Les pools nés avant le champ `creator` n'en ont pas : leur créateur est
     * le premier membre d'Équipe 1, où /create-clan le dépose d'office. Sans
     * ce repli, ces pools-là n'auraient jamais ni engrenage ni crayon, et
     * personne ne pourrait plus les renommer.
     */
    function createurDuPool(donnees) {
        if (!donnees) return null;
        if (donnees.creator) return donnees.creator;
        const equipe1 = donnees.teams && donnees.teams['Équipe 1'];
        return (equipe1 && Array.isArray(equipe1.members) && equipe1.members[0]) || null;
    }

    function estCreateur(donnees) {
        const createur = createurDuPool(donnees);
        return !!createur && createur === utilisateur();
    }

    /**
     * « Équipe 3 » ne dit rien de qui joue dedans : tant que l'équipe porte
     * sa clé par défaut, on montre plutôt ses membres. Même règle que la
     * modale des équipes (getDisplayName, equipes.js).
     */
    function nomAffiche(cle, membres) {
        if (/^Équipe \d+$/.test(cle) && membres && membres.length > 0) {
            const auto = membres.join(' et ');
            if (auto.length <= 30) return auto;
        }
        return cle;
    }

    function icone(nom, taille) {
        return typeof getIcon === 'function' ? getIcon(nom, taille || 16) : '';
    }

    // ==================== ÉTAT ====================

    let poolOuvert = null;      // nom du pool affiché, ou null
    let ongletActif = 'regles';
    let racine = null;          // l'élément du panneau, construit une fois

    function donneesDuPool(nom) {
        if (!window.FZPool) return null;
        const tous = FZPool.all() || {};
        return tous[nom] || null;
    }

    // ==================== FRAGMENTS ====================

    function blocRegles(nom, donnees) {
        const config = donnees.config || {};
        const valeur = (cle, defaut) => (config[cle] != null ? config[cle] : defaut);
        const selections = ['numOffensive', 'numDefensive', 'numGoalies', 'numRookies', 'numTeams']
            .reduce((somme, cle) => somme + (config[cle] || 0), 0);
        const etat = FZPool.draftState(donnees);
        const mode = (donnees.poolMode || 'cumulative') === 'head-to-head'
            ? 'Head-to-Head' : 'Cumulatif';
        const createur = createurDuPool(donnees);

        const ligne = (etiquette, val) =>
            `<li><span>${echapper(etiquette)}</span><strong>${echapper(val)}</strong></li>`;

        return `
            <div class="ps-pane" data-pane="regles">
                <section class="ps-block">
                    <h3 class="ps-block-title">Format</h3>
                    <ul class="ps-facts">
                        ${ligne('Mode de pointage', mode)}
                        ${ligne('Participants', `${etat.inscrits} / ${etat.max}`)}
                        ${ligne('Échanges', donnees.allowTrades !== false ? 'Autorisés' : 'Désactivés')}
                        ${ligne('Accès', donnees.hasPassword ? 'Mot de passe' : 'Libre')}
                        ${ligne('Repêchage', LIBELLE_ETAT[etat.etat])}
                        ${createur ? ligne('Créé par', createur) : ''}
                    </ul>
                </section>

                <section class="ps-block">
                    <h3 class="ps-block-title">Sélections par équipe</h3>
                    <ul class="ps-facts">
                        ${ligne('Attaquants', valeur('numOffensive', 6))}
                        ${ligne('Défenseurs', valeur('numDefensive', 4))}
                        ${ligne('Gardiens', valeur('numGoalies', 1))}
                        ${ligne('Recrues', valeur('numRookies', 1))}
                        ${ligne('Équipes LNH', valeur('numTeams', 1))}
                    </ul>
                    <p class="ps-total"><span>Total</span><strong>${selections} sélections</strong></p>
                </section>

                <p class="ps-note">Les règles sont fixées à la création du pool et ne
                    changent plus : les effectifs déjà repêchés en dépendent.</p>
            </div>`;
    }

    const CATEGORIES = [
        { cle: 'offensive', titre: 'Attaquants' },
        { cle: 'defensive', titre: 'Défenseurs' },
        { cle: 'rookie',    titre: 'Recrues' },
        { cle: 'goalie',    titre: 'Gardiens' },
        { cle: 'teams',     titre: 'Équipes LNH' }
    ];

    /**
     * Les choix d'une équipe, par catégorie.
     *
     * Une équipe sans son effectif n'est qu'un nom : savoir qui joue dans le
     * pool sert surtout à voir ce que les autres ont pris. Rien avant le
     * repêchage — les listes sont alors toutes vides.
     */
    function blocChoix(equipe) {
        const remplies = CATEGORIES.filter(c => (equipe[c.cle] || []).length > 0);
        if (remplies.length === 0) return '';
        return `
            <div class="ps-picks">
                ${remplies.map(c => `
                    <div class="ps-pick-cat">
                        <span class="ps-pick-label">${c.titre}</span>
                        <span class="ps-pick-names">${(equipe[c.cle] || []).map(echapper).join(' · ')}</span>
                    </div>`).join('')}
            </div>`;
    }

    function blocEquipes(nom, donnees) {
        const moi = utilisateur();
        const teams = donnees.teams || {};
        const etat = FZPool.draftState(donnees);
        const repechageCommence = !!etat.commence;

        const monEquipe = Object.entries(teams).find(
            ([, equipe]) => (equipe.members || []).includes(moi)
        );
        const cleMonEquipe = monEquipe ? monEquipe[0] : null;

        // Les équipes vides passent après : ce sont des places libres, pas
        // des adversaires. Elles restent affichées tant qu'on peut encore
        // les rejoindre, et disparaissent une fois le repêchage lancé.
        const entrees = Object.entries(teams)
            .filter(([, equipe]) => (equipe.members || []).length > 0 || !repechageCommence)
            .sort((a, b) => {
                const va = (a[1].members || []).length === 0 ? 1 : 0;
                const vb = (b[1].members || []).length === 0 ? 1 : 0;
                return va - vb;
            });

        const cartes = entrees.map(([cle, equipe]) => {
            const membres = equipe.members || [];
            const estMienne = cle === cleMonEquipe;
            const pleine = membres.length >= 5;
            const affiche = nomAffiche(cle, membres);

            const compte = categorie => (equipe[categorie] || []).length;
            const total = compte('offensive') + compte('defensive') +
                compte('goalie') + compte('rookie') + compte('teams');

            const listeMembres = membres.length
                ? `<ul class="ps-members">${membres.map(membre => `
                        <li>
                            ${typeof avatarHtml === 'function'
                                ? avatarHtml(membre, 24)
                                : '<img src="Icons/grayUser.png" class="ps-member-img" alt="">'}
                            <span>${echapper(membre)}</span>
                        </li>`).join('')}</ul>`
                : '<p class="ps-empty">Place libre</p>';

            // Le crayon ne s'affiche que sur sa propre équipe : le serveur
            // refuse tout autre renommage (/rename-team), autant ne pas
            // proposer un geste qui finirait en message d'erreur.
            const crayon = estMienne ? `
                <button type="button" class="ps-icon-btn" data-renommer-equipe="${echapper(cle)}"
                        title="Renommer mon équipe" aria-label="Renommer mon équipe">
                    ${icone('pencil', 14)}
                </button>` : '';

            const rejoindre = (!estMienne && !pleine && !repechageCommence && cleMonEquipe) ? `
                <button type="button" class="ps-join" data-changer-equipe="${echapper(cle)}">
                    Rejoindre cette équipe
                </button>` : '';

            return `
                <article class="ps-team${estMienne ? ' is-mine' : ''}" data-equipe="${echapper(cle)}">
                    <header class="ps-team-head">
                        <h4 class="ps-team-name">
                            <span class="ps-team-label">${echapper(affiche)}</span>${crayon}
                        </h4>
                        <div class="ps-team-badges">
                            ${estMienne ? '<span class="ps-badge is-mine">Votre équipe</span>' : ''}
                            <span class="ps-badge">${membres.length}/5</span>
                            ${total ? `<span class="ps-badge">${total} choix</span>` : ''}
                        </div>
                    </header>
                    ${listeMembres}
                    ${blocChoix(equipe)}
                    ${rejoindre}
                </article>`;
        }).join('');

        const avis = repechageCommence
            ? `<p class="ps-note">Le repêchage est lancé : on ne change plus d'équipe.
                   Le renommage, lui, reste ouvert.</p>`
            : '';

        return `
            <div class="ps-pane" data-pane="equipes">
                ${avis}
                <div class="ps-teams">${cartes}</div>
            </div>`;
    }

    function blocIdentite(nom, donnees) {
        const image = FZPool.image(donnees);
        return `
            <div class="ps-pane" data-pane="identite">
                <section class="ps-block">
                    <h3 class="ps-block-title">Nom du pool</h3>
                    <div class="ps-field">
                        <input type="text" id="psNomPool" class="ps-input" maxlength="30"
                               value="${echapper(nom)}" aria-label="Nom du pool"
                               placeholder="Nom du pool">
                        <button type="button" class="ps-primary" id="psRenommer">Renommer</button>
                    </div>
                    <p class="ps-note">De 3 à 30 caractères. Les liens partagés vers l'ancien
                        nom cesseront de fonctionner.</p>
                    <p class="ps-msg" id="psMsgNom" role="alert" hidden></p>
                </section>

                <section class="ps-block">
                    <h3 class="ps-block-title">Vignette</h3>
                    <div class="ps-image-row">
                        <img src="${echapper(image)}" class="ps-image-preview" id="psApercuImage" alt=""
                             onerror="this.src='Icons/grayGroup.png'">
                        <div>
                            <label class="ps-secondary" for="psFichierImage">Choisir une image</label>
                            <input type="file" id="psFichierImage" accept="image/*" hidden>
                            <p class="ps-note">JPG, PNG ou WebP. Elle représente le pool
                                partout dans l'application.</p>
                        </div>
                    </div>
                    <p class="ps-msg" id="psMsgImage" role="alert" hidden></p>
                </section>
            </div>`;
    }

    // ==================== RENDU ====================

    function construireCoquille() {
        if (racine) return racine;
        const html = `
            <div class="ps-scrim" id="psScrim" hidden></div>
            <div class="ps-panel" id="psPanel" role="dialog" aria-modal="true"
                 aria-labelledby="psTitre" hidden>
                <header class="ps-head">
                    <img src="Icons/grayGroup.png" class="ps-head-img" id="psHeadImg" alt=""
                         onerror="this.src='Icons/grayGroup.png'">
                    <div class="ps-head-txt">
                        <p class="ps-head-label">Réglages du pool</p>
                        <h2 class="ps-head-name" id="psTitre"></h2>
                    </div>
                    <button type="button" class="ps-close" id="psClose"
                            aria-label="Fermer les réglages">&times;</button>
                </header>
                <nav class="ps-tabs" id="psTabs" role="tablist"></nav>
                <div class="ps-body" id="psBody"></div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        racine = document.getElementById('psPanel');

        document.getElementById('psClose').addEventListener('click', fermer);
        document.getElementById('psScrim').addEventListener('click', fermer);
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && racine && !racine.hidden) fermer();
        });
        return racine;
    }

    function rendre() {
        if (!poolOuvert) return;
        const donnees = donneesDuPool(poolOuvert);
        // Le pool a disparu sous le panneau — quitté, supprimé, renommé
        // ailleurs. Il n'y a plus rien à régler.
        if (!donnees) { fermer(); return; }

        construireCoquille();
        const createur = estCreateur(donnees);
        const visibles = ONGLETS.filter(o => !o.createurSeulement || createur);
        if (!visibles.some(o => o.cle === ongletActif)) ongletActif = visibles[0].cle;

        document.getElementById('psTitre').textContent = poolOuvert;
        document.getElementById('psHeadImg').src = FZPool.image(donnees);

        document.getElementById('psTabs').innerHTML = visibles.map(onglet => `
            <button type="button" class="ps-tab${onglet.cle === ongletActif ? ' is-active' : ''}"
                    role="tab" aria-selected="${onglet.cle === ongletActif}"
                    data-onglet="${onglet.cle}">${onglet.titre}</button>`).join('');

        const corps = document.getElementById('psBody');
        if (ongletActif === 'regles')   corps.innerHTML = blocRegles(poolOuvert, donnees);
        if (ongletActif === 'equipes')  corps.innerHTML = blocEquipes(poolOuvert, donnees);
        if (ongletActif === 'identite') corps.innerHTML = blocIdentite(poolOuvert, donnees);

        brancher(corps, donnees);

        // Les avatars arrivent après coup : on redessine l'onglet une fois le
        // cache rempli, plutôt que de retarder l'ouverture du panneau.
        if (ongletActif === 'equipes' && typeof prefetchAvatars === 'function') {
            const membres = Object.values(donnees.teams || {}).flatMap(t => t.members || []);
            const dejaEnCache = membres.length === 0;
            if (!dejaEnCache && !rendre.avatarsDemandes) {
                rendre.avatarsDemandes = true;
                prefetchAvatars(membres).then(() => {
                    if (poolOuvert && ongletActif === 'equipes') rendre();
                });
            }
        }
    }

    function brancher(corps, donnees) {
        document.getElementById('psTabs').querySelectorAll('.ps-tab').forEach(bouton => {
            bouton.addEventListener('click', () => {
                ongletActif = bouton.dataset.onglet;
                rendre();
            });
        });

        corps.querySelectorAll('[data-renommer-equipe]').forEach(bouton => {
            bouton.addEventListener('click', () => ouvrirRenommageEquipe(bouton));
        });

        corps.querySelectorAll('[data-changer-equipe]').forEach(bouton => {
            bouton.addEventListener('click', () => changerEquipe(bouton.dataset.changerEquipe, bouton));
        });

        const renommer = document.getElementById('psRenommer');
        if (renommer) {
            const champ = document.getElementById('psNomPool');
            renommer.addEventListener('click', () => renommerPool(champ.value));
            champ.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); renommerPool(champ.value); }
            });
        }

        const fichier = document.getElementById('psFichierImage');
        if (fichier) fichier.addEventListener('change', () => televerserImage(fichier));
    }

    function message(id, texte, estErreur) {
        const cible = document.getElementById(id);
        if (!cible) return;
        cible.textContent = texte;
        cible.hidden = !texte;
        cible.classList.toggle('is-error', !!estErreur);
    }

    // ==================== ACTIONS ====================

    /**
     * Le renommage d'équipe se fait sur place, dans le titre de la carte.
     *
     * Un champ toujours visible sous chaque équipe pour un geste qu'on ne
     * fait qu'une fois encombrait la liste : le crayon ne déplie le champ
     * que lorsqu'on le demande.
     */
    function ouvrirRenommageEquipe(bouton) {
        const titre = bouton.closest('.ps-team-name');
        const libelle = titre && titre.querySelector('.ps-team-label');
        if (!libelle || titre.querySelector('.ps-rename-input')) return;

        const cle = bouton.dataset.renommerEquipe;
        const affiche = libelle.textContent.trim();
        // Le nom affiché peut être la liste des membres (« alice et bob »)
        // quand l'équipe porte encore sa clé par défaut : ce n'est pas un nom
        // d'équipe, on repart alors de la clé.
        const depart = (affiche !== cle && affiche.length <= 20) ? affiche : cle;

        const champ = document.createElement('input');
        champ.type = 'text';
        champ.className = 'ps-rename-input';
        champ.maxLength = 20;
        champ.value = depart;
        champ.setAttribute('aria-label', "Nouveau nom de l'équipe");

        const annuler = () => {
            champ.remove();
            valider.remove();
            libelle.hidden = false;
            bouton.hidden = false;
        };

        const valider = document.createElement('button');
        valider.type = 'button';
        valider.className = 'ps-icon-btn is-ok';
        valider.title = 'Enregistrer';
        valider.setAttribute('aria-label', 'Enregistrer le nom');
        valider.innerHTML = icone('check', 14) || '&#10003;';
        valider.addEventListener('click', () => renommerEquipe(cle, champ.value));

        champ.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); renommerEquipe(cle, champ.value); }
            if (e.key === 'Escape') { e.preventDefault(); annuler(); }
        });

        libelle.hidden = true;
        bouton.hidden = true;
        titre.appendChild(champ);
        titre.appendChild(valider);
        champ.focus();
        champ.select();
    }

    async function renommerEquipe(ancienNom, nouveauNom) {
        const propre = String(nouveauNom || '').trim();
        if (propre.length === 0 || propre.length > 20) {
            alert('Le nom doit contenir entre 1 et 20 caractères.');
            return;
        }
        if (!/^[\p{L}\p{N}\s'\-_]+$/u.test(propre)) {
            alert('Nom invalide. Lettres, chiffres, espaces, tirets et apostrophes seulement.');
            return;
        }
        if (typeof contientGrossierete === 'function' && contientGrossierete(propre)) {
            alert("Ce nom d'équipe contient un terme inapproprié. Choisissez-en un autre.");
            return;
        }

        try {
            const reponse = await fetch(`${BASE_URL}/rename-team`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clanName: poolOuvert,
                    oldTeamName: ancienNom,
                    newTeamName: propre,
                    username: utilisateur()
                })
            });
            const resultat = await reponse.json().catch(() => ({}));
            if (!reponse.ok) { alert(resultat.message || 'Renommage impossible.'); return; }
            // /rename-team diffuse `draftUpdated` : FZPool.refresh() ramène le
            // nouveau nom et rendre() est rappelé par l'abonnement plus bas.
            await FZPool.refresh();
            rendre();
        } catch (erreur) {
            console.error('Erreur /rename-team :', erreur);
            alert('Erreur de connexion au serveur.');
        }
    }

    async function changerEquipe(cible, bouton) {
        bouton.disabled = true;
        try {
            const reponse = await fetch(`${BASE_URL}/change-team`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: poolOuvert,
                    username: utilisateur(),
                    newTeamNumber: cible
                })
            });
            const resultat = await reponse.json().catch(() => ({}));
            if (!reponse.ok) { alert(resultat.message || "Changement d'équipe impossible."); return; }
            await FZPool.refresh();
            rendre();
        } catch (erreur) {
            console.error('Erreur /change-team :', erreur);
            alert('Erreur de connexion au serveur.');
        } finally {
            bouton.disabled = false;
        }
    }

    /**
     * Renommer le pool change la clé sous laquelle tout est rangé.
     *
     * L'ancien nom reste écrit dans localStorage et parfois dans l'URL
     * (?pool=…) : les deux sont corrigés avant le rechargement, sans quoi la
     * page rouvrirait sur un pool qui n'existe plus et retomberait sur un
     * autre. Le rechargement lui-même n'est pas négociable — draftActif.js et
     * plusieurs autres lisent le nom une fois, à leur première ligne.
     */
    async function renommerPool(nouveauNom) {
        const propre = String(nouveauNom || '').trim();
        const ancien = poolOuvert;

        if (propre === ancien) { message('psMsgNom', 'Ce nom est déjà celui du pool.', true); return; }
        if (propre.length < 3 || propre.length > 30) {
            message('psMsgNom', 'Le nom doit contenir entre 3 et 30 caractères.', true);
            return;
        }
        if (!/^[\p{L}\p{N}\s'\-_]+$/u.test(propre)) {
            message('psMsgNom', 'Nom invalide. Caractères non autorisés.', true);
            return;
        }
        if (typeof contientGrossierete === 'function' && contientGrossierete(propre)) {
            message('psMsgNom', 'Ce nom contient un terme inapproprié.', true);
            return;
        }

        const bouton = document.getElementById('psRenommer');
        if (bouton) bouton.disabled = true;
        message('psMsgNom', 'Renommage en cours…', false);

        try {
            const reponse = await fetch(`${BASE_URL}/rename-pool`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldName: ancien, newName: propre, username: utilisateur() })
            });
            const resultat = await reponse.json().catch(() => ({}));
            if (!reponse.ok) {
                message('psMsgNom', resultat.message || 'Renommage impossible.', true);
                return;
            }

            const nom = resultat.newName || propre;
            localStorage.setItem('activePool', nom);
            localStorage.setItem('draftClan', nom);

            const url = new URL(window.location.href);
            if (url.searchParams.get('pool') === ancien) url.searchParams.set('pool', nom);
            window.location.replace(url.toString());
        } catch (erreur) {
            console.error('Erreur /rename-pool :', erreur);
            message('psMsgNom', 'Erreur de connexion au serveur.', true);
        } finally {
            if (bouton) bouton.disabled = false;
        }
    }

    async function televerserImage(champ) {
        const fichier = champ.files && champ.files[0];
        if (!fichier) return;
        if (!/^image\//.test(fichier.type)) {
            message('psMsgImage', 'Ce fichier n’est pas une image.', true);
            return;
        }

        message('psMsgImage', 'Envoi en cours…', false);
        const corps = new FormData();
        corps.append('image', fichier);
        corps.append('poolName', poolOuvert);
        corps.append('username', utilisateur());

        try {
            const reponse = await fetch(`${BASE_URL}/upload/pool-image`, { method: 'POST', body: corps });
            const resultat = await reponse.json().catch(() => ({}));
            if (!reponse.ok) {
                message('psMsgImage', resultat.message || 'Envoi impossible.', true);
                return;
            }
            message('psMsgImage', 'Vignette mise à jour.', false);
            const apercu = document.getElementById('psApercuImage');
            if (apercu && resultat.imageUrl) apercu.src = resultat.imageUrl;
            await FZPool.refresh();
            const entete = document.getElementById('psHeadImg');
            if (entete && resultat.imageUrl) entete.src = resultat.imageUrl;
            if (window.FZNav) FZNav.render();
        } catch (erreur) {
            console.error('Erreur /upload/pool-image :', erreur);
            message('psMsgImage', 'Erreur de connexion au serveur.', true);
        } finally {
            champ.value = '';
        }
    }

    // ==================== OUVERTURE / FERMETURE ====================

    let elementAvant = null;

    function ouvrir(nom, onglet) {
        const cible = nom || (window.FZPool && FZPool.get());
        if (!cible || !donneesDuPool(cible)) return;

        poolOuvert = cible;
        ongletActif = onglet || 'regles';
        rendre.avatarsDemandes = false;

        construireCoquille();
        rendre();

        elementAvant = document.activeElement;
        const voile = document.getElementById('psScrim');
        racine.hidden = false;
        voile.hidden = false;
        document.body.classList.add('ps-open');
        requestAnimationFrame(() => racine.classList.add('is-open'));

        const premier = racine.querySelector('.ps-tab, button, input');
        if (premier) premier.focus();
    }

    function fermer() {
        if (!racine || racine.hidden) return;
        poolOuvert = null;
        racine.classList.remove('is-open');
        document.body.classList.remove('ps-open');
        setTimeout(() => {
            racine.hidden = true;
            const voile = document.getElementById('psScrim');
            if (voile) voile.hidden = true;
            if (elementAvant && elementAvant.focus) elementAvant.focus();
        }, 200);
    }

    // Le panneau reste ouvert pendant un repêchage : les données bougent sous
    // lui (une équipe rejointe, un choix fait) et il doit suivre. On ne
    // redessine pas pendant qu'un champ est en cours de saisie — le contenu
    // s'effacerait sous les doigts.
    function abonner() {
        if (!window.FZPool) return;
        FZPool.onData(() => {
            if (!poolOuvert || !racine || racine.hidden) return;
            const actif = document.activeElement;
            if (actif && racine.contains(actif) && actif.tagName === 'INPUT') return;
            rendre();
        });
    }

    /**
     * N'importe quel élément portant `data-fz-reglages="<onglet>"` ouvre le
     * panneau sur cet onglet.
     *
     * L'écoute est posée sur le document, une fois : ces déclencheurs sont
     * dessinés par des scripts qui redessinent leur écran entier (l'accueil,
     * le panneau de repêchage), et rebrancher après chaque rendu se serait
     * oublié quelque part.
     */
    document.addEventListener('click', e => {
        const declencheur = e.target.closest && e.target.closest('[data-fz-reglages]');
        if (!declencheur) return;
        e.preventDefault();
        ouvrir(FZPool.get(), declencheur.dataset.fzReglages || 'regles');
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', abonner);
    } else {
        abonner();
    }

    window.FZPoolSettings = {
        open: ouvrir,
        close: fermer,
        /** Le pool est-il réglable par la personne connectée ? */
        isCreator: nom => estCreateur(donneesDuPool(nom || (window.FZPool && FZPool.get()))),
        creatorOf: nom => createurDuPool(donneesDuPool(nom))
    };
})();
