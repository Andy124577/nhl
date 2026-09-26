/* ============================================================
   PAGE DU POOL — pool.html, ouverte d'un clic sur le pool actif
   ------------------------------------------------------------
   La liste des pools vit dans le rail (poolNav.js) ; tout ce qui porte
   sur UN pool vit sur sa page, à un clic de son nom. C'était d'abord une
   fenêtre posée par-dessus l'écran en cours ; une page se partage, se
   garde en favori, et a la place de tout montrer — chaque équipe avec
   son effectif complet.

   Ce fichier est chargé sur toutes les pages qui portent le rail. Ailleurs
   que sur pool.html, il ne dessine rien : il dit seulement qui a créé le
   pool (isCreator) et mène à la page du pool depuis n'importe quel
   bouton `data-fz-reglages="<onglet>"`.

   Les onglets de la page :

     Aperçu   — tout le pool d'un coup d'œil : où en est le repêchage, le
                format, l'accès, toutes les équipes. La personne qui a créé
                le pool y relit et change son mot de passe.
     Participants — une personne, une équipe : qui est là, sous quel nom,
                avec quels choix. On y renomme la sienne.
     Règles   — la configuration figée à la création, en lecture seule,
                l'historique des saisons, et pour la personne qui a créé
                le pool, l'ouverture d'une nouvelle saison.
     Inviter  — chercher un compte et l'inviter ; les invitations en
                attente. Réservé à la personne qui a créé le pool.
     Identité — le nom du pool et sa vignette. Réservé à la personne qui a
                créé le pool.

   Aucune dépendance : ni jQuery, ni equipes.js. Ce fichier est chargé sur
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
        { cle: 'apercu',   titre: 'Aperçu' },
        { cle: 'equipes',  titre: 'Participants' },
        { cle: 'regles',   titre: 'Règles' },
        { cle: 'inviter',  titre: 'Inviter', createurSeulement: true },
        { cle: 'identite', titre: 'Identité', createurSeulement: true }
    ];

    /** Ce qui retient encore un pool qui n'a pas commencé à repêcher. */
    const RAISON_ATTENTE = {
        deux: 'Il faut au moins deux équipes pour repêcher.',
        pair: 'Le tête-à-tête demande un nombre pair d’équipes.'
    };

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

    function dateLongue(iso) {
        const date = new Date(iso);
        if (!iso || Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function ilYa(iso) {
        const ecart = Date.now() - new Date(iso).getTime();
        if (!Number.isFinite(ecart)) return '';
        const minutes = Math.max(0, Math.floor(ecart / 60000));
        if (minutes < 1) return 'à l’instant';
        if (minutes < 60) return `il y a ${minutes} min`;
        const heures = Math.floor(minutes / 60);
        if (heures < 24) return `il y a ${heures} h`;
        return `il y a ${Math.floor(heures / 24)} j`;
    }

    /** Avatar d'un compte : la photo servie par le serveur, sinon celle du cache. */
    function avatar(username, taille, url) {
        if (url) {
            return `<img src="${echapper(url)}" class="member-avatar" alt=""
                         style="width:${taille}px;height:${taille}px;min-width:${taille}px;border-radius:50%;object-fit:cover;"
                         onerror="this.src='Icons/grayUser.png'">`;
        }
        return typeof avatarHtml === 'function'
            ? avatarHtml(username, taille)
            : `<img src="Icons/grayUser.png" class="ps-member-img" alt="">`;
    }

    // ==================== ÉTAT ====================

    let poolOuvert = null;      // nom du pool affiché, ou null
    let ongletActif = 'apercu';
    let racine = null;          // l'ossature de la page, posée une fois
    // L'équipe à montrer en ouvrant « Participants » depuis l'aperçu.
    let equipeVisee = null;

    /**
     * Le mot de passe relu, pour la seule personne qui a créé le pool.
     *
     * Jamais demandé à l'ouverture : il ne quitte le serveur que sur un clic
     * « Afficher », et s'oublie en quittant la page. La page se
     * redessine à chaque mise à jour temps réel ; sans cet état, le mot de
     * passe se recacherait sous les yeux de qui vient de l'afficher.
     */
    let mdp = null;   // { pool, hasPassword, recuperable, password, visible, edition, message, erreur }

    /** La recherche en cours dans « Inviter » : elle survit aux redessins. */
    let recherche = { pool: null, q: '', resultats: [], message: '', erreur: false };
    let minuterieRecherche = null;
    let numeroRecherche = 0;

    function donneesDuPool(nom) {
        if (!window.FZPool) return null;
        const tous = FZPool.all() || {};
        return tous[nom] || null;
    }

    // ==================== FRAGMENTS ====================

    function blocRegles(nom, donnees) {
        const config = donnees.config || {};
        const valeur = (cle, defaut) => (config[cle] != null ? config[cle] : defaut);
        const banc = typeof window.fzQuotaBanc === 'function' ? window.fzQuotaBanc(donnees) : 0;
        const selections = ['numOffensive', 'numDefensive', 'numGoalies', 'numRookies', 'numTeams']
            .reduce((somme, cle) => somme + (config[cle] || 0), 0) + banc;
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
                        ${ligne('Participants', `${etat.inscrits} (max. ${etat.max})`)}
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
                        ${banc ? ligne('Banc (tête-à-tête)', banc) : ''}
                    </ul>
                    <p class="ps-total"><span>Total</span><strong>${selections} sélections</strong></p>
                </section>

                <p class="ps-note">Les règles sont fixées à la création du pool et ne
                    changent plus : les effectifs déjà repêchés en dépendent.</p>

                ${blocSaisons(donnees)}
                ${estCreateur(donnees) && etat.etat === 'termine' ? blocNouvelleSaison() : ''}
            </div>`;
    }

    /** Le classement final des saisons passées, la plus récente d'abord. */
    function blocSaisons(donnees) {
        const saisons = (donnees.saisonsPrecedentes || []).slice().reverse();
        if (!saisons.length) return '';
        const etiquette = (id) => {
            const t = String(id || '');
            return t.length === 8 ? `${t.slice(0, 4)}-${t.slice(6, 8)}` : 'Saison passée';
        };
        return `
                <section class="ps-block">
                    <h3 class="ps-block-title">Saisons passées</h3>
                    ${saisons.map(saison => `
                        <p class="ps-season-name">${echapper(etiquette(saison.saison))}</p>
                        <ol class="ps-season-rank">
                            ${(saison.classement || []).map(l => `
                                <li><span>${echapper(l.equipe)}</span>${l.points != null ? `<strong>${echapper(Math.round(l.points))} pts</strong>` : ''}</li>`).join('')}
                        </ol>`).join('')}
                </section>`;
    }

    /**
     * Tourner la page. Le serveur décide si c'est permis (hors saison
     * régulière, repêchage d'une saison précédente) : ce bloc ne fait que
     * poser la question, et dire clairement ce qui va se passer.
     */
    function blocNouvelleSaison() {
        return `
                <section class="ps-block ps-block-season">
                    <h3 class="ps-block-title">Nouvelle saison</h3>
                    <p class="ps-note">Le classement final est archivé, les alignements sont vidés et
                        tout le monde garde sa place et son nom d'équipe. Au prochain repêchage,
                        <strong>le dernier au classement choisit en premier</strong>.</p>
                    <button type="button" class="ps-primary" id="psNouvelleSaison">Ouvrir une nouvelle saison</button>
                    <p class="ps-msg" id="psMsgSaison" role="alert" hidden></p>
                </section>`;
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

        // Une personne, une équipe : seules comptent les équipes de ceux qui
        // sont là. La sienne d'abord — c'est pour elle qu'on ouvre l'onglet.
        const createur = createurDuPool(donnees);
        const entrees = Object.entries(teams)
            .filter(([, equipe]) => (equipe.members || []).length > 0)
            .sort((a, b) => (a[0] === cleMonEquipe ? -1 : b[0] === cleMonEquipe ? 1 : a[0].localeCompare(b[0], 'fr')));

        const cartes = entrees.map(([cle, equipe]) => {
            const membres = equipe.members || [];
            const estMienne = cle === cleMonEquipe;
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

            return `
                <article class="ps-team${estMienne ? ' is-mine' : ''}" data-equipe="${echapper(cle)}">
                    <header class="ps-team-head">
                        <h4 class="ps-team-name">
                            <span class="ps-team-label">${echapper(affiche)}</span>${crayon}
                        </h4>
                        <div class="ps-team-badges">
                            ${estMienne ? '<span class="ps-badge is-mine">Votre équipe</span>' : ''}
                            ${createur && membres.includes(createur) ? '<span class="ps-badge">Admin</span>' : ''}
                            ${total ? `<span class="ps-badge">${total} choix</span>` : ''}
                        </div>
                    </header>
                    ${listeMembres}
                    ${blocChoix(equipe)}
                </article>`;
        }).join('');

        const avis = `<p class="ps-note">Chaque participant dirige sa propre équipe.
                   ${cleMonEquipe ? 'Renommez la vôtre avec le crayon, à tout moment.' : ''}
                   ${repechageCommence ? '' : `${entrees.length} équipe${entrees.length > 1 ? 's' : ''} inscrite${entrees.length > 1 ? 's' : ''} sur ${etat.max} au maximum.`}</p>`;

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

    /**
     * Où en est le pool, et le prochain geste qui a du sens.
     *
     * Un seul bouton au plus : l'aperçu répond à « qu'est-ce qui se passe
     * dans ce pool ? », pas à « qu'est-ce que je peux y faire ? ».
     */
    function blocEtat(nom, donnees, etat) {
        const lien = page => `${page}?pool=${encodeURIComponent(nom)}`;
        const createur = createurDuPool(donnees);
        let detail = '';
        let action = '';

        if (etat.etat === 'encours') {
            const auTour = etat.equipeAuTour
                ? nomAffiche(etat.equipeAuTour, ((donnees.teams || {})[etat.equipeAuTour] || {}).members)
                : null;
            const pourcent = etat.choixTotal ? Math.round((etat.choixFait / etat.choixTotal) * 100) : 0;
            detail = `
                <p class="ps-state-line">Choix <strong>${etat.choixFait + 1}</strong> sur ${etat.choixTotal}${auTour ? ` · au tour de <strong>${echapper(auTour)}</strong>` : ''}</p>
                <div class="ps-progress" role="progressbar" aria-label="Avancement du repêchage"
                     aria-valuenow="${etat.choixFait}" aria-valuemin="0" aria-valuemax="${etat.choixTotal}">
                    <i style="width:${pourcent}%"></i>
                </div>`;
            action = `<a class="ps-primary" href="${lien('draftActif.html')}">Ouvrir la salle de repêchage</a>`;
        } else if (etat.etat === 'pret') {
            detail = `<p class="ps-state-line">${etat.inscrits} participant${etat.inscrits > 1 ? 's' : ''} inscrit${etat.inscrits > 1 ? 's' : ''}. Le repêchage peut partir quand ${estCreateur(donnees) ? 'vous le lancez' : `${echapper(createur || 'l’administration')} le lance`}.</p>`;
            if (estCreateur(donnees)) action = `<a class="ps-primary" href="${lien('repechage.html')}">Préparer le repêchage</a>`;
        } else if (etat.etat === 'attente') {
            const raison = donnees.instant === true
                ? 'Le pool rapide part dès qu’il est plein.'
                : (RAISON_ATTENTE[etat.raison] || 'En attente de participants.');
            detail = `<p class="ps-state-line">${raison}</p>`;
        } else {
            const h2h = donnees.poolMode === 'head-to-head' && donnees.h2hData && donnees.h2hData.currentWeek;
            detail = `<p class="ps-state-line">Repêchage terminé${h2h ? ` · semaine ${echapper(donnees.h2hData.currentWeek)}` : ''}. Les points s’accumulent chaque soir de match.</p>`;
            action = `<a class="ps-primary" href="${lien('classement.html')}">Voir le classement</a>`;
        }

        return `
            <section class="ps-state-card">
                <span class="ps-state ps-state-${etat.etat}">${LIBELLE_ETAT[etat.etat]}</span>
                ${detail}
                ${action ? `<div class="ps-state-actions">${action}</div>` : ''}
            </section>`;
    }

    /**
     * L'accès au pool. Pour la personne qui l'a créé : le mot de passe, à
     * relire, copier, changer ou retirer. Pour les autres : un simple fait.
     */
    function blocAcces(nom, donnees) {
        if (!estCreateur(donnees)) {
            return `
                <li><span>Accès</span><strong>${donnees.hasPassword ? 'Protégé par mot de passe' : 'Libre'}</strong></li>`;
        }

        const etat = mdp && mdp.pool === nom ? mdp : null;
        const aUnMotDePasse = etat ? etat.hasPassword : !!donnees.hasPassword;
        let valeur;
        let boutons = '';

        if (!aUnMotDePasse) {
            valeur = '<strong>Libre</strong>';
            boutons = `<button type="button" class="ps-link-btn" data-mdp="editer">Ajouter un mot de passe</button>`;
        } else if (etat && etat.visible && etat.recuperable) {
            valeur = `<code class="ps-secret" id="psMotDePasse">${echapper(etat.password)}</code>`;
            boutons = `
                <button type="button" class="ps-link-btn" data-mdp="copier">Copier</button>
                <button type="button" class="ps-link-btn" data-mdp="cacher">Masquer</button>
                <button type="button" class="ps-link-btn" data-mdp="editer">Changer</button>`;
        } else if (etat && !etat.recuperable) {
            valeur = '<strong>Mot de passe</strong>';
            boutons = `<button type="button" class="ps-link-btn" data-mdp="editer">Choisir un nouveau</button>`;
        } else {
            valeur = '<code class="ps-secret is-masked" aria-label="Mot de passe masqué">••••••••</code>';
            boutons = `
                <button type="button" class="ps-link-btn" data-mdp="afficher">${icone('eye', 14)} Afficher</button>
                <button type="button" class="ps-link-btn" data-mdp="editer">Changer</button>`;
        }

        const edition = etat && etat.edition ? `
                <div class="ps-field ps-mdp-edit">
                    <input type="text" id="psNouveauMdp" class="ps-input" maxlength="72" autocomplete="off"
                           spellcheck="false" placeholder="Nouveau mot de passe" aria-label="Nouveau mot de passe du pool">
                    <button type="button" class="ps-primary" data-mdp="enregistrer">Enregistrer</button>
                </div>
                <p class="ps-note">De 4 à 72 caractères. Les membres déjà inscrits ne le repassent jamais.
                    ${aUnMotDePasse ? '<button type="button" class="ps-link-btn is-danger" data-mdp="retirer">Retirer le mot de passe</button>' : ''}</p>` : '';

        const avis = etat && etat.hasPassword && !etat.recuperable && !etat.edition
            ? `<p class="ps-note">Ce mot de passe a été choisi avant qu’on puisse le relire ici. Choisissez-en un nouveau pour le retrouver à tout moment.</p>`
            : '';
        const message = etat && etat.message
            ? `<p class="ps-msg${etat.erreur ? ' is-error' : ''}" role="alert">${echapper(etat.message)}</p>` : '';

        return `
                <li class="ps-fact-access">
                    <div class="ps-access-row">
                        <span>Mot de passe</span>
                        ${valeur}
                    </div>
                    <div class="ps-access-tools">${boutons}</div>
                    ${edition}${avis}${message}
                </li>`;
    }

    /** Toutes les équipes du pool, en une ligne chacune. */
    function blocListeEquipes(donnees) {
        const moi = utilisateur();
        const createur = createurDuPool(donnees);
        const config = donnees.config || {};
        const parEquipe = ['numOffensive', 'numDefensive', 'numGoalies', 'numRookies', 'numTeams']
            .reduce((somme, cle) => somme + (config[cle] || 0), 0) +
            (typeof window.fzQuotaBanc === 'function' ? window.fzQuotaBanc(donnees) : 0);

        const entrees = Object.entries(donnees.teams || {})
            .filter(([, equipe]) => (equipe.members || []).length > 0)
            .sort((a, b) => {
                const aMoi = (a[1].members || []).includes(moi);
                const bMoi = (b[1].members || []).includes(moi);
                return aMoi !== bMoi ? (aMoi ? -1 : 1) : a[0].localeCompare(b[0], 'fr');
            });

        if (entrees.length === 0) return '';

        const lignes = entrees.map(([cle, equipe]) => {
            const membres = equipe.members || [];
            const choix = ['offensive', 'defensive', 'goalie', 'rookie', 'teams', 'bench']
                .reduce((somme, c) => somme + (equipe[c] || []).length, 0);
            const mienne = membres.includes(moi);
            return `
                <li>
                    <button type="button" class="ps-team-row${mienne ? ' is-mine' : ''}" data-voir-equipe="${echapper(cle)}">
                        ${avatar(membres[0], 30)}
                        <span class="ps-team-row-txt">
                            <span class="ps-team-row-name">${echapper(nomAffiche(cle, membres))}</span>
                            <span class="ps-team-row-meta">${echapper(membres.join(', '))}</span>
                        </span>
                        <span class="ps-team-row-badges">
                            ${mienne ? '<span class="ps-badge is-mine">Vous</span>' : ''}
                            ${createur && membres.includes(createur) ? '<span class="ps-badge">Admin</span>' : ''}
                            ${parEquipe ? `<span class="ps-team-row-count">${choix}/${parEquipe}</span>` : ''}
                        </span>
                    </button>
                </li>`;
        }).join('');

        return `
            <section class="ps-block">
                <h3 class="ps-block-title">Équipes (${entrees.length})</h3>
                <ul class="ps-team-rows">${lignes}</ul>
            </section>`;
    }

    function blocApercu(nom, donnees) {
        const etat = FZPool.draftState(donnees);
        const config = donnees.config || {};
        const banc = typeof window.fzQuotaBanc === 'function' ? window.fzQuotaBanc(donnees) : 0;
        const selections = ['numOffensive', 'numDefensive', 'numGoalies', 'numRookies', 'numTeams']
            .reduce((somme, cle) => somme + (config[cle] || 0), 0) + banc;
        const mode = (donnees.poolMode || 'cumulative') === 'head-to-head' ? 'Tête-à-tête' : 'Cumulatif';
        const createur = createurDuPool(donnees);
        const creeLe = dateLongue(donnees.createdAt);
        const ligne = (etiquette, val) =>
            `<li><span>${echapper(etiquette)}</span><strong>${echapper(val)}</strong></li>`;

        const tuile = (valeur, etiquette) => `
            <div class="ps-tile"><strong>${echapper(valeur)}</strong><span>${echapper(etiquette)}</span></div>`;

        const invitations = (donnees.invitations || []).length;
        const rappelInvitations = estCreateur(donnees) && invitations > 0 ? `
            <button type="button" class="ps-callout" data-aller="inviter">
                <span>${invitations} invitation${invitations > 1 ? 's' : ''} en attente</span>
                <span aria-hidden="true">→</span>
            </button>` : '';

        // Deux colonnes sur un écran large : ce qui se passe et qui joue à
        // gauche, la fiche du pool à droite. Une seule colonne sur téléphone,
        // dans cet ordre.
        return `
            <div class="ps-pane ps-apercu" data-pane="apercu">
                <div class="ps-col-main">
                    ${blocEtat(nom, donnees, etat)}

                    <div class="ps-tiles">
                        ${tuile(`${etat.inscrits}/${etat.max}`, 'Participants')}
                        ${tuile(selections, 'Choix par équipe')}
                        ${tuile(mode, 'Pointage')}
                        ${tuile(donnees.allowTrades !== false ? 'Ouverts' : 'Fermés', 'Échanges')}
                    </div>

                    ${blocListeEquipes(donnees)}
                </div>

                <aside class="ps-col-side">
                    ${rappelInvitations}
                    <section class="ps-block">
                        <h3 class="ps-block-title">Le pool</h3>
                        <ul class="ps-facts">
                            ${createur ? ligne('Créé par', createur) : ''}
                            ${creeLe ? ligne('Créé le', creeLe) : ''}
                            ${donnees.instant === true ? ligne('Type', 'Pool rapide') : ''}
                            ${blocAcces(nom, donnees)}
                        </ul>
                    </section>
                </aside>
            </div>`;
    }

    /**
     * Inviter : chercher un compte, l'inviter, voir qui attend encore.
     *
     * La personne invitée reçoit une notification et une fenêtre qui lui
     * permet d'entrer d'un clic — sans le mot de passe du pool.
     */
    function blocInviter(nom, donnees) {
        const etat = FZPool.draftState(donnees);
        const enAttente = (donnees.invitations || []).slice()
            .sort((a, b) => String(b.invitedAt).localeCompare(String(a.invitedAt)));
        const ferme = etat.commence
            ? 'Le repêchage a commencé : ce pool n’accepte plus de participants.'
            : etat.inscrits >= etat.max
                ? `Ce pool est complet (${etat.max} participants maximum).`
                : null;

        const recherchePropre = recherche.pool === nom ? recherche : { q: '', resultats: [], message: '' };

        const chercher = ferme ? `<p class="ps-note">${echapper(ferme)}</p>` : `
                <label class="ps-search" for="psInviteQ">
                    ${icone('search', 16)}
                    <input type="search" id="psInviteQ" class="ps-search-input" maxlength="40"
                           autocomplete="off" spellcheck="false" placeholder="Nom d’utilisateur"
                           value="${echapper(recherchePropre.q)}">
                </label>
                <ul class="ps-results" id="psInviteResults">${lignesResultats(recherchePropre)}</ul>
                <p class="ps-msg${recherchePropre.erreur ? ' is-error' : ''}" id="psMsgInvite" role="status"
                   ${recherchePropre.message ? '' : 'hidden'}>${echapper(recherchePropre.message)}</p>
                <p class="ps-note">La personne reçoit une notification et entre d’un clic, sans le mot de passe du pool.</p>`;

        const attente = enAttente.length ? `
                <ul class="ps-invites">
                    ${enAttente.map(inv => `
                        <li>
                            ${avatar(inv.username, 28)}
                            <span class="ps-invite-txt">
                                <span class="ps-invite-name">${echapper(inv.username)}</span>
                                <span class="ps-invite-meta">Invité ${echapper(ilYa(inv.invitedAt))}</span>
                            </span>
                            <button type="button" class="ps-link-btn is-danger" data-annuler-invitation="${echapper(inv.username)}">Annuler</button>
                        </li>`).join('')}
                </ul>`
            : '<p class="ps-empty">Aucune invitation en attente.</p>';

        return `
            <div class="ps-pane" data-pane="inviter">
                <section class="ps-block">
                    <h3 class="ps-block-title">Inviter quelqu’un</h3>
                    ${chercher}
                </section>
                <section class="ps-block">
                    <h3 class="ps-block-title">En attente${enAttente.length ? ` (${enAttente.length})` : ''}</h3>
                    ${attente}
                </section>
            </div>`;
    }

    function lignesResultats(etat) {
        if (!etat.q || etat.q.trim().length < 2) return '';
        if (!etat.resultats.length) {
            return etat.charge ? '<li class="ps-results-empty">Aucun compte ne porte ce nom.</li>' : '';
        }
        return etat.resultats.map(r => {
            const bouton = r.statut === 'membre'
                ? '<span class="ps-result-state">Déjà dans le pool</span>'
                : r.statut === 'invite'
                    ? '<span class="ps-result-state is-sent">Invitation envoyée</span>'
                    : `<button type="button" class="ps-invite-btn" data-inviter="${echapper(r.username)}">${icone('send', 14)} Inviter</button>`;
            return `
                <li>
                    ${avatar(r.username, 30, r.avatarUrl)}
                    <span class="ps-result-name">${echapper(r.username)}</span>
                    ${bouton}
                </li>`;
        }).join('');
    }

    // ==================== RENDU ====================

    /** L'hôte de la page du pool, ou null ailleurs. */
    const hote = () => document.getElementById('fzPoolPage');

    /** Pose l'ossature de la page, une fois : en-tête, onglets, contenu. */
    function construireCoquille() {
        if (racine) return racine;
        racine = hote();
        if (!racine) return null;
        racine.innerHTML = `
            <header class="pp-hero">
                <img src="Icons/grayGroup.png" class="pp-hero-img" id="psHeadImg" alt=""
                     onerror="this.src='Icons/grayGroup.png'">
                <div class="pp-hero-txt">
                    <p class="pp-eyebrow" id="psHeadLabel">Pool actif</p>
                    <h1 class="pp-title" id="psTitre"></h1>
                    <p class="pp-sub" id="psHeadSub"></p>
                </div>
            </header>
            <nav class="ps-tabs pp-tabs" id="psTabs" role="tablist" aria-label="Sections du pool"></nav>
            <div class="pp-body" id="psBody" role="tabpanel"></div>`;
        return racine;
    }

    /** Sans pool à montrer : pas connecté, ou membre d'aucun pool. */
    function rendreVide() {
        const cible = hote();
        if (!cible) return;
        racine = null;
        const connecte = localStorage.getItem('isLoggedIn') === 'true';
        document.title = 'Mon pool – Fantazy';
        cible.innerHTML = connecte ? `
            <section class="pp-empty">
                <img src="Icons/grayGroup.png" alt="" class="pp-empty-img">
                <h1 class="pp-title">Aucun pool pour l’instant</h1>
                <p>Créez votre ligue et invitez vos amis, ou joignez-vous à un pool ouvert.</p>
                <div class="pp-empty-actions">
                    <a class="ps-primary" href="creer-pool.html">Créer un pool</a>
                    <a class="ps-secondary" href="rejoindre-pool.html">Rejoindre un pool</a>
                </div>
            </section>` : `
            <section class="pp-empty">
                <h1 class="pp-title">Connectez-vous</h1>
                <p>La page du pool montre ses équipes, ses règles et son repêchage aux membres.</p>
                <div class="pp-empty-actions">
                    <a class="ps-primary" href="login.html">Se connecter</a>
                </div>
            </section>`;
    }

    function rendre() {
        if (!hote()) return;
        const donnees = poolOuvert ? donneesDuPool(poolOuvert) : null;
        // Le pool a disparu sous la page — quitté, supprimé, renommé ailleurs.
        if (!donnees) { rendreVide(); return; }

        construireCoquille();
        const createur = estCreateur(donnees);
        const visibles = ONGLETS.filter(o => !o.createurSeulement || createur);
        if (!visibles.some(o => o.cle === ongletActif)) ongletActif = visibles[0].cle;

        const etat = FZPool.draftState(donnees);
        const mode = (donnees.poolMode || 'cumulative') === 'head-to-head' ? 'Tête-à-tête' : 'Cumulatif';
        const createurNom = createurDuPool(donnees);
        document.title = `${poolOuvert} – Fantazy`;
        document.getElementById('psTitre').textContent = poolOuvert;
        document.getElementById('psHeadLabel').textContent =
            poolOuvert === FZPool.get() ? 'Pool actif' : 'Pool';
        document.getElementById('psHeadSub').textContent = [
            mode,
            `${etat.inscrits} participant${etat.inscrits > 1 ? 's' : ''} sur ${etat.max}`,
            createurNom ? `créé par ${createurNom}` : null
        ].filter(Boolean).join(' · ');
        document.getElementById('psHeadImg').src = FZPool.image(donnees);

        document.getElementById('psTabs').innerHTML = visibles.map(onglet => `
            <button type="button" class="ps-tab${onglet.cle === ongletActif ? ' is-active' : ''}"
                    role="tab" aria-selected="${onglet.cle === ongletActif}"
                    data-onglet="${onglet.cle}">${onglet.titre}</button>`).join('');

        const corps = document.getElementById('psBody');
        const defilement = window.scrollY;
        if (ongletActif === 'apercu')   corps.innerHTML = blocApercu(poolOuvert, donnees);
        if (ongletActif === 'regles')   corps.innerHTML = blocRegles(poolOuvert, donnees);
        if (ongletActif === 'equipes')  corps.innerHTML = blocEquipes(poolOuvert, donnees);
        if (ongletActif === 'inviter')  corps.innerHTML = blocInviter(poolOuvert, donnees);
        if (ongletActif === 'identite') corps.innerHTML = blocIdentite(poolOuvert, donnees);
        // Une mise à jour temps réel redessine l'onglet : elle ne doit pas
        // ramener en haut quelqu'un qui lisait la dixième équipe.
        if (rendre.ongletPrecedent === ongletActif) window.scrollTo(0, defilement);
        rendre.ongletPrecedent = ongletActif;

        brancher(corps, donnees);

        if (ongletActif === 'equipes' && equipeVisee) {
            const cible = [...corps.querySelectorAll('[data-equipe]')]
                .find(carte => carte.dataset.equipe === equipeVisee);
            equipeVisee = null;
            if (cible) {
                cible.classList.add('is-focus');
                cible.scrollIntoView({ block: 'center' });
            }
        }

        // Les avatars arrivent après coup : on redessine l'onglet une fois le
        // cache rempli, plutôt que de retarder l'affichage de la page.
        if (typeof prefetchAvatars === 'function' && !rendre.avatarsDemandes) {
            const noms = [
                ...Object.values(donnees.teams || {}).flatMap(t => t.members || []),
                ...(donnees.invitations || []).map(inv => inv.username)
            ];
            if (noms.length > 0) {
                rendre.avatarsDemandes = true;
                prefetchAvatars(noms).then(() => { if (poolOuvert && !saisieEnCours()) rendre(); });
            }
        }
    }

    /** Un champ de la page a le focus : la redessiner effacerait la saisie. */
    function saisieEnCours() {
        const actif = document.activeElement;
        return !!(actif && racine && racine.contains(actif) && actif.tagName === 'INPUT');
    }

    /**
     * Changer d'onglet. L'onglet vit dans l'adresse (`?onglet=`) : un
     * rechargement, un lien partagé ou le bouton Retour y ramènent.
     */
    function allerA(onglet) {
        ongletActif = onglet;
        const url = new URL(window.location.href);
        if (onglet === 'apercu') url.searchParams.delete('onglet');
        else url.searchParams.set('onglet', onglet);
        history.replaceState(null, '', url.toString());
        rendre();
        // « Participants » dans le tiroir du téléphone mène ici sans
        // rechargement : le tiroir se referme, et le rail suit l'onglet.
        if (window.FZNav) { FZNav.closeDrawer(); FZNav.render(); }
        // Un autre onglet se lit depuis son début — sauf pour aller montrer
        // une équipe, dont rendre() amène lui-même la carte à l'écran.
        const onglets = document.getElementById('psTabs');
        if (!equipeVisee && onglets && onglets.getBoundingClientRect().top < 0) {
            onglets.scrollIntoView({ block: 'start' });
        }
    }

    function brancher(corps, donnees) {
        document.getElementById('psTabs').querySelectorAll('.ps-tab').forEach(bouton => {
            bouton.addEventListener('click', () => allerA(bouton.dataset.onglet));
        });

        corps.querySelectorAll('[data-aller]').forEach(bouton => {
            bouton.addEventListener('click', () => allerA(bouton.dataset.aller));
        });

        corps.querySelectorAll('[data-voir-equipe]').forEach(bouton => {
            bouton.addEventListener('click', () => {
                equipeVisee = bouton.dataset.voirEquipe;
                allerA('equipes');
            });
        });

        corps.querySelectorAll('[data-mdp]').forEach(bouton => {
            bouton.addEventListener('click', () => actionMotDePasse(bouton.dataset.mdp, bouton));
        });
        const nouveauMdp = document.getElementById('psNouveauMdp');
        if (nouveauMdp) {
            nouveauMdp.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); actionMotDePasse('enregistrer'); }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); actionMotDePasse('fermer-edition'); }
            });
        }

        const champRecherche = document.getElementById('psInviteQ');
        if (champRecherche) {
            champRecherche.addEventListener('input', () => programmerRecherche(champRecherche.value));
            champRecherche.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); lancerRecherche(champRecherche.value); }
            });
        }
        brancherResultats(corps);

        corps.querySelectorAll('[data-annuler-invitation]').forEach(bouton => {
            bouton.addEventListener('click', () => annulerInvitation(bouton.dataset.annulerInvitation, bouton));
        });

        corps.querySelectorAll('[data-renommer-equipe]').forEach(bouton => {
            bouton.addEventListener('click', () => ouvrirRenommageEquipe(bouton));
        });

        const saison = document.getElementById('psNouvelleSaison');
        if (saison) saison.addEventListener('click', () => ouvrirNouvelleSaison(saison));

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

    const urlPool = suite => `${BASE_URL}/api/pools/${encodeURIComponent(poolOuvert)}${suite}`;

    async function lireJson(reponse) {
        return reponse.json().catch(() => ({}));
    }

    /**
     * Le mot de passe du pool : afficher, masquer, copier, changer, retirer.
     *
     * « Afficher » est le seul geste qui le fait sortir du serveur. Il reste
     * ensuite en mémoire, le temps qu'on reste sur la page.
     */
    async function actionMotDePasse(action, bouton) {
        const nom = poolOuvert;
        const donnees = donneesDuPool(nom);
        if (!nom || !donnees) return;
        const etat = (mdp && mdp.pool === nom) ? mdp : (mdp = {
            pool: nom, hasPassword: !!donnees.hasPassword, recuperable: true,
            password: null, visible: false, edition: false, message: '', erreur: false
        });
        etat.message = '';
        etat.erreur = false;

        if (action === 'afficher') {
            if (bouton) bouton.disabled = true;
            try {
                const reponse = await fetch(urlPool('/password'), { cache: 'no-store' });
                const resultat = await lireJson(reponse);
                if (!reponse.ok) throw new Error(resultat.message || 'Lecture impossible.');
                Object.assign(etat, {
                    hasPassword: !!resultat.hasPassword,
                    recuperable: !!resultat.recuperable,
                    password: resultat.password,
                    visible: !!resultat.recuperable
                });
            } catch (erreur) {
                etat.message = erreur.message || 'Erreur de connexion au serveur.';
                etat.erreur = true;
            }
            if (poolOuvert === nom) rendre();
            return;
        }

        if (action === 'cacher') { etat.visible = false; rendre(); return; }

        if (action === 'copier') {
            try {
                await navigator.clipboard.writeText(etat.password || '');
                etat.message = 'Mot de passe copié.';
            } catch {
                etat.message = 'Copie impossible : sélectionnez le mot de passe pour le copier.';
                etat.erreur = true;
            }
            rendre();
            return;
        }

        if (action === 'editer') {
            etat.edition = !etat.edition;
            rendre();
            const champ = document.getElementById('psNouveauMdp');
            if (champ) champ.focus();
            return;
        }

        if (action === 'fermer-edition') { etat.edition = false; rendre(); return; }

        if (action === 'enregistrer' || action === 'retirer') {
            const champ = document.getElementById('psNouveauMdp');
            const valeur = action === 'retirer' ? '' : (champ ? champ.value : '');
            if (action === 'enregistrer' && (valeur.length < 4 || valeur.length > 72)) {
                etat.message = 'Le mot de passe doit contenir entre 4 et 72 caractères.';
                etat.erreur = true;
                rendre();
                const encore = document.getElementById('psNouveauMdp');
                if (encore) { encore.value = valeur; encore.focus(); }
                return;
            }
            if (action === 'retirer' && !window.confirm('Retirer le mot de passe ?\n\nTout le monde pourra entrer dans le pool tant qu’il reste des places.')) {
                return;
            }
            try {
                const reponse = await fetch(urlPool('/password'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: valeur })
                });
                const resultat = await lireJson(reponse);
                if (!reponse.ok) throw new Error(resultat.message || 'Enregistrement impossible.');
                Object.assign(etat, {
                    hasPassword: !!resultat.hasPassword,
                    recuperable: resultat.hasPassword ? !!resultat.recuperable : true,
                    password: resultat.hasPassword ? valeur : null,
                    visible: !!resultat.hasPassword,
                    edition: false,
                    message: resultat.message || ''
                });
                // Le blur qui suit l'enregistrement ne doit pas laisser le
                // champ bloquer le redessin que le rafraîchissement demande.
                if (document.activeElement && racine.contains(document.activeElement)) document.activeElement.blur();
                await FZPool.refresh();
            } catch (erreur) {
                etat.message = erreur.message || 'Erreur de connexion au serveur.';
                etat.erreur = true;
            }
            if (poolOuvert === nom) rendre();
        }
    }

    /** Une frappe relance la recherche un instant plus tard, pas à chaque lettre. */
    function programmerRecherche(valeur) {
        recherche = { ...recherche, pool: poolOuvert, q: valeur, message: '', erreur: false };
        clearTimeout(minuterieRecherche);
        if (valeur.trim().length < 2) {
            recherche.resultats = [];
            recherche.charge = false;
            majResultats();
            return;
        }
        minuterieRecherche = setTimeout(() => lancerRecherche(valeur), 250);
    }

    async function lancerRecherche(valeur) {
        clearTimeout(minuterieRecherche);
        const q = String(valeur || '').trim();
        const nom = poolOuvert;
        if (!nom || q.length < 2) return;
        const numero = ++numeroRecherche;
        try {
            const reponse = await fetch(`${urlPool('/invite-search')}?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
            const resultat = await lireJson(reponse);
            // Une réponse lente ne doit pas écraser celle d'une frappe plus récente.
            if (numero !== numeroRecherche || poolOuvert !== nom) return;
            if (!reponse.ok) throw new Error(resultat.message || 'Recherche impossible.');
            recherche = { ...recherche, pool: nom, resultats: resultat.resultats || [], charge: true, message: '', erreur: false };
        } catch (erreur) {
            if (numero !== numeroRecherche) return;
            recherche = { ...recherche, pool: nom, resultats: [], charge: false, message: erreur.message || 'Erreur de connexion au serveur.', erreur: true };
        }
        majResultats();
    }

    /** Redessine la seule liste des résultats : le champ garde son focus. */
    function majResultats() {
        const liste = document.getElementById('psInviteResults');
        if (!liste) return;
        liste.innerHTML = lignesResultats(recherche);
        brancherResultats(liste);
        const msg = document.getElementById('psMsgInvite');
        if (msg) {
            msg.textContent = recherche.message || '';
            msg.hidden = !recherche.message;
            msg.classList.toggle('is-error', !!recherche.erreur);
        }
    }

    function brancherResultats(racineListe) {
        racineListe.querySelectorAll('[data-inviter]').forEach(bouton => {
            bouton.addEventListener('click', () => inviterCompte(bouton.dataset.inviter, bouton));
        });
    }

    async function inviterCompte(username, bouton) {
        const nom = poolOuvert;
        if (bouton) { bouton.disabled = true; bouton.textContent = 'Envoi…'; }
        try {
            const reponse = await fetch(urlPool('/invitations'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });
            const resultat = await lireJson(reponse);
            if (!reponse.ok) throw new Error(resultat.message || 'Invitation impossible.');
            recherche = {
                ...recherche,
                resultats: recherche.resultats.map(r => r.username === username ? { ...r, statut: 'invite' } : r),
                message: resultat.message || `Invitation envoyée à ${username}.`,
                erreur: false
            };
            if (typeof getAvatarUrl === 'function') getAvatarUrl(username);
            await FZPool.refresh();
        } catch (erreur) {
            recherche = { ...recherche, message: erreur.message || 'Erreur de connexion au serveur.', erreur: true };
        }
        if (poolOuvert !== nom) return;
        rendre();
        // On invite souvent plusieurs amis d'affilée : le champ reprend la main.
        const champ = document.getElementById('psInviteQ');
        if (champ) champ.focus({ preventScroll: true });
    }

    async function annulerInvitation(username, bouton) {
        const nom = poolOuvert;
        if (bouton) bouton.disabled = true;
        try {
            const reponse = await fetch(urlPool('/invitations/cancel'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });
            const resultat = await lireJson(reponse);
            if (!reponse.ok && reponse.status !== 404) throw new Error(resultat.message || 'Annulation impossible.');
            recherche = {
                ...recherche,
                resultats: recherche.resultats.map(r => r.username === username ? { ...r, statut: null } : r),
                message: '', erreur: false
            };
            await FZPool.refresh();
        } catch (erreur) {
            recherche = { ...recherche, pool: nom, message: erreur.message || 'Erreur de connexion au serveur.', erreur: true };
        }
        if (poolOuvert === nom) rendre();
    }

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

    async function ouvrirNouvelleSaison(bouton) {
        const ok = window.confirm(
            'Ouvrir une nouvelle saison ?\n\n' +
            '• Le classement final est archivé.\n' +
            '• Tous les alignements sont vidés.\n' +
            '• Le prochain repêchage suivra le classement inversé : le dernier choisit en premier.\n\n' +
            'Cette action ne peut pas être annulée.');
        if (!ok) return;

        bouton.disabled = true;
        message('psMsgSaison', 'Ouverture de la nouvelle saison…', false);
        try {
            const reponse = await fetch(`${BASE_URL}/pool/new-season`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clanName: poolOuvert })
            });
            const resultat = await reponse.json().catch(() => ({}));
            if (!reponse.ok) {
                message('psMsgSaison', resultat.message || 'Impossible d’ouvrir une nouvelle saison.', true);
                return;
            }
            await FZPool.refresh();
            rendre();
            if (window.FZNav) FZNav.render();
            alert(resultat.message || 'Nouvelle saison prête.');
        } catch (erreur) {
            console.error('Erreur /pool/new-season :', erreur);
            message('psMsgSaison', 'Erreur de connexion au serveur.', true);
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

    // ==================== PAGE ====================

    const ONGLETS_CONNUS = new Set(ONGLETS.map(o => o.cle));

    /** L'adresse de la page du pool, sur un onglet donné. */
    function adresse(nom, onglet) {
        const params = new URLSearchParams();
        if (nom && window.FZPool && nom !== FZPool.get()) params.set('pool', nom);
        if (onglet && onglet !== 'apercu') params.set('onglet', onglet);
        const requete = params.toString();
        return requete ? `pool.html?${requete}` : 'pool.html';
    }

    /**
     * Mener à la page du pool, sur cet onglet. Déjà dessus : changer
     * d'onglet sur place, sans rechargement.
     */
    function ouvrir(nom, onglet) {
        const cible = nom || (window.FZPool && FZPool.get());
        if (hote() && (!cible || cible === poolOuvert)) {
            allerA(ONGLETS_CONNUS.has(onglet) ? onglet : 'apercu');
            return;
        }
        window.location.href = adresse(cible, onglet);
    }

    /**
     * Démarrage de la page : le pool actif (activePool.js a déjà appliqué un
     * éventuel `?pool=`), l'onglet de l'adresse.
     *
     * La page suit les données en temps réel — une équipe rejointe, un
     * choix fait, une invitation acceptée. On ne redessine pas pendant
     * qu'un champ est en cours de saisie : le contenu s'effacerait sous
     * les doigts.
     */
    async function demarrerPage() {
        if (!hote()) return;
        if (!window.FZPool || localStorage.getItem('isLoggedIn') !== 'true') { rendreVide(); return; }
        await FZPool.ready();

        poolOuvert = FZPool.get();
        const demande = new URLSearchParams(window.location.search).get('onglet');
        ongletActif = ONGLETS_CONNUS.has(demande) ? demande : 'apercu';
        rendre();

        FZPool.onData(() => {
            if (saisieEnCours()) return;
            // Le pool actif a pu changer sous nous (départ, suppression).
            poolOuvert = FZPool.get();
            rendre();
        });
    }

    /**
     * N'importe quel élément portant `data-fz-reglages="<onglet>"` mène à
     * la page du pool, sur cet onglet.
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
        ouvrir(window.FZPool && FZPool.get(), declencheur.dataset.fzReglages || 'apercu');
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', demarrerPage);
    } else {
        demarrerPage();
    }

    window.FZPoolSettings = {
        /** Mène à la page du pool (ou change d'onglet si on y est déjà). */
        open: ouvrir,
        /** L'adresse de la page du pool, pour un lien. */
        url: adresse,
        /** Le pool est-il réglable par la personne connectée ? */
        isCreator: nom => estCreateur(donneesDuPool(nom || (window.FZPool && FZPool.get()))),
        creatorOf: nom => createurDuPool(donneesDuPool(nom))
    };
})();
