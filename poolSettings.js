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

   pool.html seule — le lien « Pools » de la barre — est l'accueil des
   pools : trois boutons, Créer un pool, Rejoindre un pool, et le pool
   actif sous son nom. Ce dernier mène à la page du pool, qui porte
   toujours un `?onglet=`.

   Les onglets de la page :

     Aperçu   — tout le pool d'un coup d'œil : où en est la saison ou le
                repêchage, toutes les équipes avec leurs points, et le lien
                d'invitation tant qu'il reste des places.
     Équipes  — une personne, une équipe : qui est là, sous quel nom,
                avec quels choix, chaque alignement dépliable. On y renomme
                la sienne. Le menu l'appelle « Mon pool ».
     Règles   — la configuration figée à la création, en lecture seule,
                l'historique des saisons, et pour la personne qui a créé
                le pool, le mot de passe et l'ouverture d'une nouvelle
                saison.
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
        { cle: 'equipes',  titre: 'Équipes' },
        { cle: 'regles',   titre: 'Règles' },
        { cle: 'inviter',  titre: 'Inviter', inviteursSeulement: true },
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
     * Peut-on inviter dans ce pool ? Même règle que le serveur
     * (authz.peutInviter) : la personne qui l'a créé, ou tout membre d'un
     * pool sans mot de passe — celui-ci est déjà ouvert à tous.
     */
    function peutInviter(donnees) {
        if (!donnees) return false;
        return estCreateur(donnees) || (donnees.isMember === true && !donnees.hasPassword);
    }

    /** Le créateur retire toutes les invitations ; un membre, celles qu'il a envoyées. */
    function peutAnnulerInvitation(donnees, invitation) {
        return estCreateur(donnees) || (!!invitation && invitation.invitedBy === utilisateur());
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

    /** La ligne « Repêchage » des Règles : l'état, en un mot. */
    const LIBELLE_REPECHAGE = {
        attente: 'En attente',
        pret:    'Prêt',
        encours: 'En cours',
        termine: 'Terminé'
    };

    /** « 21 oct. 2026 » : la date de création, dans les Règles. */
    function dateCourte(iso) {
        const date = new Date(iso);
        if (!iso || Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    // Les pictogrammes de la page, au trait (même facture que l'accueil).
    const MP_ICONES = {
        groupe:     '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
        ajout:      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
        classement: '<path d="M6 20v-6M12 20V4M18 20v-10"/>',
        echange:    '<path d="M8 7h12m0 0-4-4m4 4-4 4M16 17H4m0 0 4 4m-4-4 4-4"/>',
        cadenas:    '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
        ouvert:     '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.75-1.4"/>',
        calendrier: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
        jour:       '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01"/>',
        horloge:    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        eclair:     '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
        admin:      '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
        hockey:     '<path d="M7 3v13a3 3 0 0 0 3 3h6"/><circle cx="19" cy="19" r="2"/>',
        fleche:     '<path d="M5 12h14M13 6l6 6-6 6"/>',
        droite:     '<path d="m9 6 6 6-6 6"/>',
        bas:        '<path d="m6 9 6 6 6-6"/>',
        copier:     '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        coche:      '<path d="M20 6 9 17l-5-5"/>',
        crayon:     '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
        info:       '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'
    };

    function mpIcone(nom, taille) {
        return `<svg class="mp-ico" width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${MP_ICONES[nom] || ''}</svg>`;
    }

    /** La pastille d'une équipe : ses deux premières lettres, claire pour la sienne. */
    function initiales(nom, mienne, classe) {
        const lettres = String(nom || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?';
        return `<span class="mp-av${mienne ? ' is-mine' : ''}${classe ? ` ${classe}` : ''}" aria-hidden="true">${echapper(lettres)}</span>`;
    }

    /** Une ligne de la fiche des Règles : pictogramme, libellé, valeur. */
    function ligneFait(icon, etiquette, valeur) {
        return `
                <li class="mp-fact"><div class="mp-fact-row">${mpIcone(icon, 19)}<span class="mp-fact-k">${echapper(etiquette)}</span><strong>${echapper(valeur)}</strong></div></li>`;
    }

    // ==================== ÉTAT ====================

    let poolOuvert = null;      // nom du pool affiché, ou null
    let ongletActif = 'apercu';
    let racine = null;          // l'ossature de la page, posée une fois
    // L'équipe à montrer en ouvrant « Équipes » depuis l'aperçu.
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

    /**
     * Règles : la configuration figée à la création, en lecture seule. Pour
     * la personne qui a créé le pool, la ligne « Accès » devient celle du
     * mot de passe (blocAcces).
     */
    function blocRegles(nom, donnees) {
        const etat = FZPool.draftState(donnees);
        const mode = (donnees.poolMode || 'cumulative') === 'head-to-head' ? 'Tête-à-tête' : 'Cumulatif';
        const createur = createurDuPool(donnees);
        const creeLe = dateCourte(donnees.createdAt);
        const cases = casesAlignement(donnees);
        const total = cases.reduce((somme, c) => somme + c.nombre, 0);

        const lignes = [
            ligneFait('classement', 'Pointage', mode),
            ligneFait('groupe', 'Participants', `${etat.inscrits} (max. ${etat.max})`),
            ligneFait('echange', 'Échanges', donnees.allowTrades !== false ? 'Autorisés' : 'Désactivés'),
            blocAcces(nom, donnees),
            ligneFait('calendrier', 'Repêchage', LIBELLE_REPECHAGE[etat.etat]),
            etat.prevuLe && etat.etat !== 'termine' ? ligneFait('horloge', 'Date du repêchage', FZPool.draftDate(etat.prevuLe)) : '',
            donnees.instant === true ? ligneFait('eclair', 'Type', 'Pool rapide') : '',
            createur ? ligneFait('admin', 'Créé par', createur) : '',
            creeLe ? ligneFait('jour', 'Créé le', creeLe) : ''
        ].join('');

        return `
            <div class="ps-pane mp-pane" data-pane="regles">
                <ul class="mp-card mp-facts">${lignes}</ul>

                <header class="mp-sh"><h2>Alignement</h2><span class="mp-sh-hot">${total} choix / équipe</span></header>
                <div class="mp-slots" style="--n:${cases.length}">
                    ${cases.map(c => `
                        <div class="mp-slot mp-pos-${c.cle}"><strong>${c.nombre}</strong><span>${c.tag}</span></div>`).join('')}
                </div>
                <p class="mp-note">${mpIcone('info', 16)}<span>Les règles sont fixées à la création et ne changent plus : les équipes repêchées en dépendent.</span></p>

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

    /**
     * Les groupes d'un alignement, dans l'ordre de la maquette. Le banc
     * n'existe qu'en tête-à-tête ; une catégorie vide disparaît.
     */
    const CATEGORIES = [
        { cle: 'offensive', tag: 'ATT',  classe: 'att',   config: 'numOffensive', defaut: 6 },
        { cle: 'defensive', tag: 'DÉF',  classe: 'def',   config: 'numDefensive', defaut: 4 },
        { cle: 'goalie',    tag: 'GAR',  classe: 'gar',   config: 'numGoalies',   defaut: 1 },
        { cle: 'rookie',    tag: 'REC',  classe: 'rec',   config: 'numRookies',   defaut: 1 },
        { cle: 'teams',     tag: 'ÉQ',   classe: 'eq',    config: 'numTeams',     defaut: 1 },
        { cle: 'bench',     tag: 'BANC', classe: 'banc' }
    ];

    /** Les cases d'un alignement (Règles) : combien de choix par position. */
    function casesAlignement(donnees) {
        const config = donnees.config || {};
        const banc = typeof window.fzQuotaBanc === 'function' ? window.fzQuotaBanc(donnees) : 0;
        return CATEGORIES.map(c => ({
            cle: c.classe,
            tag: c.tag,
            nombre: c.cle === 'bench' ? banc : (config[c.config] != null ? config[c.config] : c.defaut)
        })).filter(c => c.nombre > 0);
    }

    /**
     * Les choix d'une équipe, par position.
     *
     * Une équipe sans son effectif n'est qu'un nom : savoir qui joue dans le
     * pool sert surtout à voir ce que les autres ont pris. Rien avant le
     * repêchage — les listes sont alors toutes vides.
     */
    function blocChoix(equipe) {
        const remplies = CATEGORIES.filter(c => (equipe[c.cle] || []).length > 0);
        if (remplies.length === 0) return '<p class="mp-roster-empty">Aucun choix pour l’instant : l’alignement se remplit au repêchage.</p>';
        return remplies.map(c => `
                    <div class="mp-roster-row">
                        <span class="mp-pos mp-pos-${c.classe}">${c.tag}</span>
                        <span class="mp-roster-names">${(equipe[c.cle] || []).map(echapper).join(' · ')}</span>
                    </div>`).join('');
    }

    /** Les équipes à alignement déplié, d'un redessin à l'autre. */
    let equipesOuvertes = { pool: null, cles: new Set() };

    function blocEquipes(nom, donnees) {
        const createur = createurDuPool(donnees);
        const entrees = equipesTriees(donnees);
        const cleMonEquipe = (entrees.find(e => e.mienne) || {}).cle || null;

        // À la première ouverture, sa propre équipe est dépliée — c'est pour
        // elle qu'on vient. Depuis l'aperçu, c'est l'équipe touchée.
        if (equipesOuvertes.pool !== nom) {
            equipesOuvertes = { pool: nom, cles: new Set(cleMonEquipe ? [cleMonEquipe] : []) };
        }
        if (equipeVisee) equipesOuvertes.cles.add(equipeVisee);

        const cartes = entrees.map(({ cle, equipe, membres, mienne, choix }, i) => {
            const ouverte = equipesOuvertes.cles.has(cle);
            const affiche = nomAffiche(cle, membres);
            const role = mienne ? ' · ton équipe' : (createur && membres.includes(createur) ? ' · admin' : '');
            // Le crayon ne s'affiche que sur sa propre équipe : le serveur
            // refuse tout autre renommage (/rename-team), autant ne pas
            // proposer un geste qui finirait en message d'erreur.
            const crayon = mienne ? `
                            <button type="button" class="mp-edit" data-renommer-equipe="${echapper(cle)}"
                                    title="Renommer mon équipe" aria-label="Renommer mon équipe">${mpIcone('crayon', 16)}</button>` : '';
            return `
                <article class="mp-card mp-team${mienne ? ' is-mine' : ''}${ouverte ? ' is-open' : ''}" data-equipe="${echapper(cle)}">
                    <div class="mp-team-head">
                        ${initiales(affiche, mienne, 'is-lg')}
                        <span class="mp-team-txt">
                            <span class="ps-team-name mp-team-name"><span class="ps-team-label">${echapper(affiche)}</span>${crayon}</span>
                            <span class="mp-team-meta">${echapper(membres.join(', '))}${role}</span>
                        </span>
                        <span class="mp-team-count">${choix} choix</span>
                        <button type="button" class="mp-team-toggle" data-deplier="${echapper(cle)}"
                                aria-expanded="${ouverte}" aria-controls="mpRoster${i}"
                                aria-label="Alignement de ${echapper(affiche)}">${mpIcone('bas', 22)}</button>
                    </div>
                    <div class="mp-roster" id="mpRoster${i}"${ouverte ? '' : ' hidden'}>${blocChoix(equipe)}</div>
                </article>`;
        }).join('');

        return `
            <div class="ps-pane mp-pane" data-pane="equipes">
                <div class="mp-teams">${cartes || '<p class="mp-empty">Aucune équipe pour l’instant.</p>'}</div>
                ${cleMonEquipe ? `<p class="mp-note">${mpIcone('info', 16)}<span>Chaque participant dirige sa propre équipe. Renomme la tienne avec le crayon, à tout moment.</span></p>` : ''}
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
     * Les équipes du pool, une entrée par équipe occupée. Avec les points
     * de la saison : dans l'ordre du classement ; sinon la sienne d'abord,
     * puis par nom.
     */
    function equipesTriees(donnees) {
        const moi = utilisateur();
        const scores = pointsDuPool(poolOuvert);
        const entrees = Object.entries(donnees.teams || {})
            .filter(([, equipe]) => (equipe.members || []).length > 0)
            .map(([cle, equipe]) => {
                const membres = equipe.members || [];
                const score = scores ? scores.get(cle) : null;
                return {
                    cle, equipe, membres,
                    mienne: membres.includes(moi),
                    choix: CATEGORIES.reduce((somme, c) => somme + (equipe[c.cle] || []).length, 0),
                    rang: score ? score.rang : null,
                    points: score ? score.points : null
                };
            });
        return entrees.sort((a, b) => {
            if (a.rang != null && b.rang != null && a.rang !== b.rang) return a.rang - b.rang;
            if (a.mienne !== b.mienne) return a.mienne ? -1 : 1;
            return a.cle.localeCompare(b.cle, 'fr');
        });
    }

    /**
     * Les points de la saison, par équipe : le Total du classement, servi
     * par /pool-rank-movement (déjà lu par l'accueil). Une requête par pool
     * et par visite, seulement une fois le repêchage terminé.
     */
    let points = { pool: null, equipes: null, enCours: false };

    function pointsDuPool(nom) {
        return points.pool === nom ? points.equipes : null;
    }

    function chargerPoints(nom, etat) {
        if (etat.etat !== 'termine' || points.pool === nom) return;
        points = { pool: nom, equipes: null, enCours: true };
        fetch(`${BASE_URL}/pool-rank-movement/${encodeURIComponent(nom)}`)
            .then(reponse => (reponse.ok ? reponse.json() : null))
            .catch(() => null)
            .then(resultat => {
                if (points.pool !== nom) return;
                const parEquipe = new Map(((resultat && resultat.teams) || [])
                    .filter(t => t.rankNow != null)
                    .map(t => [t.teamName, { rang: t.rankNow, points: Number(t.pointsNow) || 0 }]));
                points = { pool: nom, equipes: parEquipe.size ? parEquipe : null, enCours: false };
                if (parEquipe.size && poolOuvert === nom && !saisieEnCours()) rendre();
            });
    }

    const pts = valeur => Math.round(valeur).toLocaleString('fr-CA');
    const ordinal = rang => `${rang}${rang === 1 ? 'er' : 'e'}`;

    /**
     * Où en est le pool, et le prochain geste qui a du sens.
     *
     * Un seul bouton au plus : l'aperçu répond à « qu'est-ce qui se passe
     * dans ce pool ? », pas à « qu'est-ce que je peux y faire ? ».
     */
    function blocEtat(nom, donnees, etat) {
        const lien = page => `${page}?pool=${encodeURIComponent(nom)}`;
        const createur = createurDuPool(donnees);
        const entrees = equipesTriees(donnees);
        const parEquipe = casesAlignement(donnees).reduce((somme, c) => somme + c.nombre, 0);
        const mode = (donnees.poolMode || 'cumulative') === 'head-to-head' ? 'Tête-à-tête' : 'Cumulatif';
        const equipes = `${entrees.length}/${etat.max}`;
        let detail = '';
        let action = '';
        let stats;

        if (etat.etat === 'encours') {
            const auTour = etat.equipeAuTour
                ? nomAffiche(etat.equipeAuTour, ((donnees.teams || {})[etat.equipeAuTour] || {}).members)
                : null;
            const pourcent = etat.choixTotal ? Math.round((etat.choixFait / etat.choixTotal) * 100) : 0;
            detail = `
                <p class="mp-hero-line">Choix <strong>${etat.choixFait + 1}</strong> sur ${etat.choixTotal}${auTour ? ` · au tour de <strong>${echapper(auTour)}</strong>` : ''}</p>
                <div class="mp-progress" role="progressbar" aria-label="Avancement du repêchage"
                     aria-valuenow="${etat.choixFait}" aria-valuemin="0" aria-valuemax="${etat.choixTotal}">
                    <i style="width:${pourcent}%"></i>
                </div>`;
            stats = [[`${etat.choixFait}/${etat.choixTotal}`, 'Choix faits'], [equipes, 'Équipes'], [parEquipe, 'Par équipe'], [mode, 'Pointage']];
            action = `<a class="mp-cta" href="${lien('draftActif.html')}">Ouvrir la salle de repêchage${mpIcone('fleche', 20)}</a>`;
        } else if (etat.etat === 'pret') {
            const depart = etat.prevuLe
                ? `Il commencera tout seul le ${echapper(FZPool.draftDate(etat.prevuLe))}`
                : `Le repêchage peut partir quand ${estCreateur(donnees) ? 'tu le lances' : `${echapper(createur || 'l’administration')} le lance`}`;
            detail = `<p class="mp-hero-line">${etat.inscrits} participant${etat.inscrits > 1 ? 's' : ''} inscrit${etat.inscrits > 1 ? 's' : ''}. ${depart}.</p>`;
            stats = [[equipes, 'Équipes'], [parEquipe, 'Choix'], [mode, 'Pointage'], [donnees.allowTrades !== false ? 'Oui' : 'Non', 'Échanges']];
            if (estCreateur(donnees)) action = `<a class="mp-cta" href="${lien('repechage.html')}">Préparer le repêchage${mpIcone('fleche', 20)}</a>`;
        } else if (etat.etat === 'attente') {
            const raison = donnees.instant === true
                ? 'Le pool rapide part dès qu’il est plein.'
                : (RAISON_ATTENTE[etat.raison] || 'En attente de participants.');
            const prevu = etat.prevuLe ? ` Repêchage prévu le ${echapper(FZPool.draftDate(etat.prevuLe))}.` : '';
            detail = `<p class="mp-hero-line">${raison}${prevu}</p>`;
            stats = [[equipes, 'Équipes'], [parEquipe, 'Choix'], [mode, 'Pointage'], [donnees.allowTrades !== false ? 'Oui' : 'Non', 'Échanges']];
        } else {
            const h2h = donnees.poolMode === 'head-to-head' && donnees.h2hData && donnees.h2hData.currentWeek;
            const moi = entrees.find(e => e.mienne);
            detail = `<p class="mp-hero-line">Repêchage terminé${h2h ? ` · semaine ${echapper(donnees.h2hData.currentWeek)}` : ''}. Les points s’accumulent chaque soir de match.</p>`;
            stats = [
                [moi && moi.rang != null ? ordinal(moi.rang) : '—', 'Ton rang', 'is-hot'],
                [moi && moi.points != null ? pts(moi.points) : '—', 'Points'],
                [equipes, 'Équipes'],
                [parEquipe, 'Choix']
            ];
            action = `<a class="mp-cta" href="${lien('classement.html')}">Voir le classement${mpIcone('fleche', 20)}</a>`;
        }

        return `
            <section class="mp-hero">
                <span class="mp-hero-txt">
                    <span class="mp-pill mp-pill-${etat.etat}">${mpIcone(etat.etat === 'termine' ? 'hockey' : etat.etat === 'encours' ? 'horloge' : 'groupe', 13)}${LIBELLE_ETAT[etat.etat]}</span>
                    ${detail}
                </span>
                <span class="mp-stats">
                    ${stats.map(([valeur, etiquette, classe]) => `
                        <span class="mp-stat"><strong class="${classe || ''}">${echapper(valeur)}</strong><small>${etiquette}</small></span>`).join('')}
                </span>
                ${action}
            </section>`;
    }

    /**
     * L'accès au pool, une ligne des Règles. Pour la personne qui l'a créé :
     * le mot de passe, à relire, copier, changer ou retirer. Pour les
     * autres : un simple fait.
     */
    function blocAcces(nom, donnees) {
        if (!estCreateur(donnees)) {
            return ligneFait(donnees.hasPassword ? 'cadenas' : 'ouvert', 'Accès', donnees.hasPassword ? 'Mot de passe' : 'Libre');
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
            ? `<p class="ps-note">Ce mot de passe a été choisi avant qu’on puisse le relire ici. Choisis-en un nouveau pour le retrouver à tout moment.</p>`
            : '';
        const message = etat && etat.message
            ? `<p class="ps-msg${etat.erreur ? ' is-error' : ''}" role="alert">${echapper(etat.message)}</p>` : '';

        return `
                <li class="mp-fact mp-fact-access">
                    <div class="mp-fact-row">
                        ${mpIcone(aUnMotDePasse ? 'cadenas' : 'ouvert', 19)}
                        <span class="mp-fact-k">Mot de passe</span>
                        ${valeur}
                    </div>
                    <div class="ps-access-tools">${boutons}</div>
                    ${edition}${avis}${message}
                </li>`;
    }

    /** Toutes les équipes du pool, en une ligne chacune : un clic ouvre son alignement. */
    function blocListeEquipes(donnees, etat) {
        const createur = createurDuPool(donnees);
        const entrees = equipesTriees(donnees);
        if (entrees.length === 0) return '';
        const avecPoints = entrees.some(e => e.points != null);

        const lignes = entrees.map(({ cle, membres, mienne, choix, rang, points: total }) => {
            const affiche = nomAffiche(cle, membres);
            return `
                <li>
                    <button type="button" class="mp-row${mienne ? ' is-mine' : ''}" data-voir-equipe="${echapper(cle)}">
                        ${avecPoints ? `<span class="mp-rank${rang === 1 ? ' is-first' : ''}">${rang != null ? rang : '—'}</span>` : ''}
                        ${initiales(affiche, mienne)}
                        <span class="mp-row-txt">
                            <span class="mp-row-name"><span>${echapper(affiche)}</span>${mienne ? '<span class="mp-tag">Toi</span>' : ''}${createur && membres.includes(createur) ? `<span class="mp-admin" title="Admin">${mpIcone('admin', 15)}</span>` : ''}</span>
                            <span class="mp-row-meta">${echapper(membres.join(', '))} · ${choix} choix</span>
                        </span>
                        ${avecPoints ? `<span class="mp-row-pts"><strong>${total != null ? pts(total) : '—'}</strong><small>PTS</small></span>` : ''}
                        ${mpIcone('droite', 20)}
                    </button>
                </li>`;
        }).join('');

        return `
            <header class="mp-sh">${mpIcone('groupe', 22)}<h2>Équipes</h2><span class="mp-sh-count">${entrees.length} / ${etat.max}</span></header>
            <ul class="mp-card mp-rows">${lignes}</ul>`;
    }

    /**
     * Inviter, sous les équipes : le lien de la page Rejoindre, filtrée sur
     * ce pool (comme le bouton Inviter de l'accueil), tant qu'il reste des
     * places. Le pool n'a pas de code : son nom en tient lieu.
     */
    function blocInvitation(nom, donnees, etat) {
        if (!peutInviter(donnees) || etat.commence || etat.inscrits >= etat.max) return '';
        const invitations = (donnees.invitations || []).length;
        const enAttente = invitations ? `${invitations} invitation${invitations > 1 ? 's' : ''} en attente` : 'Inviter un compte';
        return `
            <header class="mp-sh">${mpIcone('ajout', 22)}<h2>Inviter</h2></header>
            <div class="mp-card mp-invite">
                <span class="mp-invite-txt">
                    <small>Lien d’invitation</small>
                    <strong>${echapper(nom)}</strong>
                </span>
                <button type="button" class="mp-copy" id="mpCopierLien">${mpIcone('copier', 18)}<span>Copier</span></button>
            </div>
            <button type="button" class="mp-more" data-aller="inviter">${enAttente}${mpIcone('droite', 18)}</button>`;
    }

    function blocApercu(nom, donnees) {
        const etat = FZPool.draftState(donnees);
        return `
            <div class="ps-pane mp-pane" data-pane="apercu">
                ${blocEtat(nom, donnees, etat)}
                ${blocListeEquipes(donnees, etat)}
                ${blocInvitation(nom, donnees, etat)}
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
                                <span class="ps-invite-meta">Invité ${echapper(ilYa(inv.invitedAt))}${inv.invitedBy && inv.invitedBy !== utilisateur() ? ` par ${echapper(inv.invitedBy)}` : ''}</span>
                            </span>
                            ${peutAnnulerInvitation(donnees, inv) ? `<button type="button" class="ps-link-btn is-danger" data-annuler-invitation="${echapper(inv.username)}">Annuler</button>` : ''}
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
            <header class="mp-head">
                <span class="mp-logo" id="psHeadImg" aria-hidden="true"></span>
                <span class="mp-head-txt">
                    <span class="mp-eyebrow" id="psHeadLabel">Pool actif</span>
                    <h1 class="mp-title" id="psTitre"></h1>
                    <span class="mp-head-sub" id="psHeadSub"></span>
                </span>
            </header>
            <nav class="mp-tabs" id="psTabs" role="tablist" aria-label="Sections du pool"></nav>
            <div class="mp-body" id="psBody" role="tabpanel"></div>`;
        return racine;
    }

    const ICONE_REJOINDRE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/></svg>`;

    /**
     * pool.html seule, sans onglet ni pool demandé, est l'accueil des
     * pools : trois boutons — créer, rejoindre, et le pool actif sous son
     * nom. La page du pool elle-même porte toujours un `?onglet=`.
     */
    function surLAccueil() {
        const params = new URLSearchParams(window.location.search);
        return !params.has('onglet') && !params.has('pool');
    }

    /**
     * L'accueil des pools. Sans aucun pool, le troisième bouton n'aurait
     * rien à ouvrir : il reste les deux premiers. Hors connexion, un seul.
     */
    function rendreAccueil() {
        const cible = hote();
        if (!cible) return;
        racine = null;
        cible.dataset.vue = 'accueil';
        document.title = 'Pools – Fantazy';

        if (localStorage.getItem('isLoggedIn') !== 'true') {
            cible.innerHTML = `
                <section class="pp-empty">
                    <h1 class="pp-title">Connectez-vous</h1>
                    <p>La page du pool montre ses équipes, ses règles et son repêchage aux membres.</p>
                    <div class="pp-empty-actions">
                        <a class="ps-primary" href="login.html">Se connecter</a>
                    </div>
                </section>`;
            return;
        }

        const nom = window.FZPool && FZPool.get();
        const donnees = nom ? donneesDuPool(nom) : null;
        const bouton = (href, visuel, libelle, surtitre) => `
            <a class="pp-hub-btn" href="${href}">
                ${visuel}
                <span class="pp-hub-txt">
                    ${surtitre ? `<span class="pp-hub-eyebrow">${surtitre}</span>` : ''}
                    <span class="pp-hub-label">${libelle}</span>
                </span>
                <span class="pp-hub-chevron" aria-hidden="true">›</span>
            </a>`;

        cible.innerHTML = `
            <section class="pp-hub">
                <h1 class="pp-title">Pools</h1>
                ${donnees ? '' : '<p class="pp-sub">Vous n’êtes dans aucun pool pour l’instant.</p>'}
                <div class="pp-hub-actions">
                    ${bouton('creer-pool.html',
                        `<span class="pp-hub-icon" aria-hidden="true">${icone('plus', 24)}</span>`,
                        'Créer un pool')}
                    ${bouton('rejoindre-pool.html',
                        `<span class="pp-hub-icon">${ICONE_REJOINDRE}</span>`,
                        'Rejoindre un pool')}
                    ${donnees ? bouton(echapper(adresse(nom, 'apercu')),
                        `<img src="${echapper(FZPool.image(donnees))}" class="pp-hub-img" alt=""
                              onerror="this.src='Icons/grayGroup.png'">`,
                        echapper(nom), 'Mon pool') : ''}
                </div>
            </section>`;
    }

    function rendre() {
        if (!hote()) return;
        const donnees = poolOuvert ? donneesDuPool(poolOuvert) : null;
        // Le pool a disparu sous la page — quitté, supprimé, renommé ailleurs.
        if (!donnees) { rendreAccueil(); return; }

        construireCoquille();
        hote().dataset.vue = 'pool';
        const createur = estCreateur(donnees);
        const inviteur = peutInviter(donnees);
        const visibles = ONGLETS.filter(o =>
            (!o.createurSeulement || createur) && (!o.inviteursSeulement || inviteur));
        if (!visibles.some(o => o.cle === ongletActif)) ongletActif = visibles[0].cle;

        const etat = FZPool.draftState(donnees);
        chargerPoints(poolOuvert, etat);
        const mode = (donnees.poolMode || 'cumulative') === 'head-to-head' ? 'Tête-à-tête' : 'Cumulatif';
        const createurNom = createurDuPool(donnees);
        const equipes = Object.values(donnees.teams || {}).filter(t => (t.members || []).length > 0).length;
        document.title = `Mon pool · ${poolOuvert} – Fantazy`;
        document.getElementById('psTitre').textContent = poolOuvert;
        const actif = poolOuvert === FZPool.get();
        const surtitre = document.getElementById('psHeadLabel');
        surtitre.textContent = actif ? 'Pool actif' : 'Pool';
        surtitre.classList.toggle('is-active', actif);
        document.getElementById('psHeadSub').innerHTML =
            (donnees.hasPassword ? `<span class="mp-lock" title="Protégé par mot de passe">${mpIcone('cadenas', 14)}</span>` : '') +
            echapper([
                mode,
                `${equipes}/${etat.max} équipe${etat.max > 1 ? 's' : ''}`,
                createurNom ? `par ${createurNom}` : null
            ].filter(Boolean).join(' · '));
        // La vignette du pool s'il en a une ; sinon sa première lettre.
        const logo = document.getElementById('psHeadImg');
        logo.innerHTML = donnees.imageUrl
            ? `<img src="${echapper(FZPool.image(donnees))}" alt="" onerror="this.remove()">`
            : '';
        logo.dataset.lettre = (String(poolOuvert).match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();

        document.getElementById('psTabs').innerHTML = visibles.map(onglet => `
            <button type="button" class="mp-tab${onglet.cle === ongletActif ? ' is-active' : ''}"
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

        // Les avatars ne servent plus qu'aux invitations (les équipes portent
        // leurs initiales) : on ne les demande que là où ils s'affichent.
        if (ongletActif === 'inviter' && typeof prefetchAvatars === 'function' && !rendre.avatarsDemandes) {
            const noms = (donnees.invitations || []).map(inv => inv.username);
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
     * rechargement, un lien partagé ou le bouton Retour y ramènent. Même
     * l'Aperçu le garde — sans lui, pool.html est l'accueil des pools.
     */
    function allerA(onglet) {
        ongletActif = onglet;
        const url = new URL(window.location.href);
        url.searchParams.set('onglet', onglet);
        history.replaceState(null, '', url.toString());
        rendre();
        // « Mon pool » dans le tiroir du téléphone mène ici sans
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
        document.getElementById('psTabs').querySelectorAll('.mp-tab').forEach(bouton => {
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

        // Déplier un alignement ne redessine rien : la carte bascule sur place.
        corps.querySelectorAll('[data-deplier]').forEach(bouton => {
            const carte = bouton.closest('.mp-team');
            const alignement = carte.querySelector('.mp-roster');
            const basculer = () => {
                const ouverte = !carte.classList.contains('is-open');
                carte.classList.toggle('is-open', ouverte);
                bouton.setAttribute('aria-expanded', String(ouverte));
                alignement.hidden = !ouverte;
                if (ouverte) equipesOuvertes.cles.add(bouton.dataset.deplier);
                else equipesOuvertes.cles.delete(bouton.dataset.deplier);
            };
            bouton.addEventListener('click', basculer);
            // Toute la ligne déplie, sauf le crayon et le champ de renommage.
            carte.querySelector('.mp-team-head').addEventListener('click', e => {
                if (e.target.closest('button, input')) return;
                basculer();
            });
        });

        const copier = document.getElementById('mpCopierLien');
        if (copier) copier.addEventListener('click', () => copierLien(copier));

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

    /**
     * Le lien de la page Rejoindre, filtrée sur ce pool, dans le
     * presse-papiers ; refusé (page non sécurisée, permission), il
     * s'affiche avec son propre bouton Copier.
     */
    async function copierLien(bouton) {
        const lien = new URL(`rejoindre-pool.html?q=${encodeURIComponent(poolOuvert)}`, window.location.href).href;
        try {
            await navigator.clipboard.writeText(lien);
        } catch (erreur) {
            if (typeof fzCopy === 'function') {
                fzCopy({ title: 'Lien d’invitation', message: 'Envoie ce lien : il mène directement à ton pool.', value: lien });
            }
            return;
        }
        bouton.classList.add('is-done');
        bouton.innerHTML = `${mpIcone('coche', 18)}<span>Copié</span>`;
        clearTimeout(bouton._retour);
        bouton._retour = setTimeout(() => {
            bouton.classList.remove('is-done');
            bouton.innerHTML = `${mpIcone('copier', 18)}<span>Copier</span>`;
        }, 1500);
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
            if (action === 'retirer' && !(await fzConfirm({
                type: 'warning',
                icon: 'unlock',
                title: 'Retirer le mot de passe ?',
                message: 'Tout le monde pourra entrer dans le pool tant qu’il reste des places.',
                confirmLabel: 'Retirer'
            }))) {
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
            fzAlert({ type: 'warning', title: 'Nom invalide', message: 'Le nom doit contenir entre 1 et 20 caractères.' });
            return;
        }
        if (!/^[\p{L}\p{N}\s'\-_]+$/u.test(propre)) {
            fzAlert({ type: 'warning', title: 'Nom invalide', message: 'Lettres, chiffres, espaces, tirets et apostrophes seulement.' });
            return;
        }
        if (typeof contientGrossierete === 'function' && contientGrossierete(propre)) {
            fzAlert({ type: 'warning', title: 'Nom refusé', message: "Ce nom d'équipe contient un terme inapproprié. Choisissez-en un autre." });
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
            if (!reponse.ok) {
                fzAlert({ type: 'error', title: 'Renommage impossible', message: resultat.message || 'L’équipe n’a pas pu être renommée.' });
                return;
            }
            // /rename-team diffuse `draftUpdated` : FZPool.refresh() ramène le
            // nouveau nom et rendre() est rappelé par l'abonnement plus bas.
            await FZPool.refresh();
            rendre();
        } catch (erreur) {
            console.error('Erreur /rename-team :', erreur);
            fzAlert({ type: 'error', icon: 'offline', title: 'Connexion impossible', message: 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.' });
        }
    }

    async function ouvrirNouvelleSaison(bouton) {
        const ok = await fzConfirm({
            danger: true,
            icon: 'refresh',
            align: 'start',
            title: 'Ouvrir une nouvelle saison ?',
            bodyHTML: `
                <ul>
                    <li>Le classement final est archivé.</li>
                    <li>Tous les alignements sont vidés.</li>
                    <li>Le prochain repêchage suivra le classement inversé : le dernier choisit en premier.</li>
                </ul>
                <p><strong>Cette action ne peut pas être annulée.</strong></p>`,
            confirmLabel: 'Ouvrir la saison'
        });
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
            fzAlert({ type: 'success', title: 'Nouvelle saison prête', message: resultat.message || 'Le pool est prêt pour son prochain repêchage.' });
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

    /**
     * L'adresse de la page du pool, sur un onglet donné. Toujours avec son
     * `?onglet=` : pool.html seule est l'accueil des pools.
     */
    function adresse(nom, onglet) {
        const params = new URLSearchParams();
        if (nom && window.FZPool && nom !== FZPool.get()) params.set('pool', nom);
        params.set('onglet', ONGLETS_CONNUS.has(onglet) ? onglet : 'apercu');
        return `pool.html?${params}`;
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
     * Démarrage de la page : l'accueil des pools si l'adresse ne demande
     * rien ; sinon le pool actif (activePool.js a déjà appliqué un
     * éventuel `?pool=`), sur l'onglet de l'adresse.
     *
     * La page suit les données en temps réel — une équipe rejointe, un
     * choix fait, une invitation acceptée. On ne redessine pas pendant
     * qu'un champ est en cours de saisie : le contenu s'effacerait sous
     * les doigts.
     */
    async function demarrerPage() {
        if (!hote()) return;
        if (!window.FZPool || localStorage.getItem('isLoggedIn') !== 'true') { rendreAccueil(); return; }
        await FZPool.ready();

        // Le nom du pool actif peut changer sous l'accueil (renommé ailleurs).
        if (surLAccueil()) {
            rendreAccueil();
            FZPool.onData(rendreAccueil);
            return;
        }

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
