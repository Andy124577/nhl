/* ============================================================
   REPÊCHAGE — porte d'entrée du pool actif
   ------------------------------------------------------------
   La page ne demande plus « quel pool ? » : elle ouvre celui qui est
   actif. Un repêchage déjà lancé n'a rien à faire attendre, on entre
   directement dans la salle de repêchage.

   Les notifications arrivent ici avec ?pool=<nom> ; activePool.js a
   déjà basculé le contexte au moment où ce fichier s'exécute.

   Avant que le repêchage puisse commencer, chaque équipe du pool doit
   aussi avoir choisi son identité LNH (voir la section « IDENTITÉ LNH »
   plus bas) : c'est elle qui marquera toutes ses cartes de choix, du
   premier tour au dernier, dans la salle de repêchage.
   ============================================================ */
(function () {
    const echapper = texte => String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const conteneur = () => document.getElementById('rpContent');

    function entete(pool, etiquette, classeEtat) {
        return `
            <header class="rp-head">
                <img src="${echapper(FZPool.image(pool.data))}" class="rp-img" alt=""
                     onerror="this.src='Icons/grayGroup.png'">
                <div class="rp-head-txt">
                    <p class="rp-eyebrow">Repêchage</p>
                    <h1 class="rp-title">${echapper(pool.name)}</h1>
                </div>
                <span class="rp-state rp-state-${classeEtat}">${etiquette}</span>
            </header>`;
    }

    function rendreVide() {
        conteneur().innerHTML = `
            <div class="fz-empty-pool">
                <h2>Aucun pool actif</h2>
                <p>Le repêchage se déroule dans un pool. Créez le vôtre ou rejoignez une ligue
                   ouverte pour commencer.</p>
                <div class="fz-empty-actions">
                    <a class="primary" href="creer-pool.html">Créer un pool</a>
                    <a class="secondary" href="rejoindre-pool.html">Rejoindre un pool</a>
                </div>
            </div>`;
    }

    function rendreAttente(pool, etat) {
        const restants = Math.max(0, etat.max - etat.inscrits);
        const progression = etat.max > 0 ? Math.round((etat.inscrits / etat.max) * 100) : 0;
        conteneur().innerHTML = `
            <article class="rp-card">
                ${entete(pool, 'En attente', 'attente')}
                <div class="rp-body">
                    <p class="rp-lead">
                        Le repêchage démarrera une fois le pool complet.
                        Il manque ${restants} participant${restants > 1 ? 's' : ''}.
                    </p>
                    <div class="rp-progress" role="img"
                         aria-label="${etat.inscrits} participants sur ${etat.max}">
                        <div class="rp-progress-fill" style="width:${progression}%"></div>
                    </div>
                    <p class="rp-progress-lbl">${etat.inscrits} / ${etat.max} participants</p>
                    <div class="rp-actions">
                        <a class="rp-btn secondary" href="mes-pools.html">Gérer mon équipe</a>
                    </div>
                </div>
            </article>`;
    }

    /* ============================================================
       IDENTITÉ LNH — choix avant le repêchage
       ------------------------------------------------------------
       Chaque carte de la bande de repêchage porte maintenant les
       couleurs et l'écusson d'un vrai club de la LNH — pas celui du
       joueur qu'on y repêche, celui de l'ÉQUIPE DU POOL qui détient le
       tour. Pour que la bande ait un sens dès le premier coup d'œil, ce
       choix doit être fait par tout le monde avant que l'ordre existe :
       le serveur refuse de démarrer tant qu'il en manque un
       (POST /start-draft), et cette section en est la porte d'entrée.

       La liste des 32 clubs vient de /current-teams — la même source
       que le classement — plutôt que d'un nom écrit en dur ici : les
       noms d'équipe changent (Arizona → Utah), autant lire la même
       vérité que le reste du site.
       ============================================================ */

    /** Liste des clubs, résolue une fois puis gardée telle quelle : le pool se
        redessine à chaque choix d'un autre membre (socket), et re-fetcher à
        chaque fois ferait clignoter toute la liste sur un aller-retour réseau
        pendant que tout le monde choisit en même temps. */
    let _clubsCache = null;
    function chargerClubsLNH() {
        if (_clubsCache) return Promise.resolve(_clubsCache);
        return fetch(`${FZPool.BASE_URL}/current-teams`)
            .then(r => r.json())
            .then(donnees => {
                // Mêmes chiffres que le classement : la fiche club porte sa
                // vraie fiche (V-D-DP · PTS), pas un habillage sans contenu —
                // choisir une identité mérite de savoir de quelle équipe il
                // s'agit sur la glace, pas seulement son nom et ses couleurs.
                _clubsCache = (donnees.teams || [])
                    .filter(t => t.teamAbbrev)
                    .map(t => ({
                        code: t.teamAbbrev,
                        nom: t.teamFullName,
                        wins: t.wins ?? null,
                        losses: t.losses ?? null,
                        otLosses: t.otLosses ?? null,
                        points: t.points ?? null
                    }))
                    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
                return _clubsCache;
            });
    }

    /** Fiche V-D-DP · PTS, ou rien si les stats n'ont pas encore été chargées
        pour cette équipe (saison pas encore commencée, par exemple). */
    function ficheClub(club) {
        if (club.wins == null || club.losses == null) return '';
        const dp = club.otLosses != null ? `-${club.otLosses}` : '';
        const pts = club.points != null ? ` · ${club.points} PTS` : '';
        return `${club.wins}-${club.losses}${dp}${pts}`;
    }

    /** Équipes du pool avec au moins un membre — les seules qui comptent ici. */
    function equipesEligibles(poolData) {
        return Object.entries(poolData.teams || {})
            .filter(([, equipe]) => (equipe.members || []).length > 0)
            .sort(([a], [b]) => a.localeCompare(b, 'fr'));
    }

    /** Fond de carte actuel, pour teinter chaque tuile sans jamais casser le
        thème clair : lu une fois, mis en cache par appel de rendu. */
    function fondCarte() {
        return getComputedStyle(document.documentElement).getPropertyValue('--card').trim() || '#161630';
    }

    function tuileClub(club, prisePar, monEquipe, fond) {
        const mienne = prisePar === monEquipe;
        const prise = !!prisePar && !mienne;
        const couleur = (typeof getTeamColors === 'function' ? getTeamColors(club.code) : ['#3A414D'])[0];
        // Mélange calculé en JS, pas en color-mix() CSS : teamColors.js évite
        // délibérément cette fonction, indisponible sur d'assez vieux
        // navigateurs mobiles — voir son commentaire sur shadeHex/mixHex.
        const teinte = (typeof mixHex === 'function') ? mixHex(fond, couleur, 0.16) : couleur;
        return `
            <button type="button" class="nhlclub-tile${mienne ? ' is-mine' : ''}${prise ? ' is-taken' : ''}"
                    data-club="${club.code}" style="--club-a:${couleur};--club-wash:${teinte}"
                    aria-pressed="${mienne}" ${prise ? 'disabled' : ''}
                    title="${echapper(club.nom)}${prise ? ' — déjà choisie par ' + echapper(prisePar) : ''}">
                <img src="teams/${club.code}.png" alt="" class="nhlclub-logo" loading="lazy"
                     onerror="this.style.visibility='hidden'">
                <span class="nhlclub-name">${echapper(club.nom)}</span>
                ${ficheClub(club) ? `<span class="nhlclub-record">${ficheClub(club)}</span>` : ''}
                ${mienne ? '<span class="nhlclub-tile-tag">Votre choix</span>' : ''}
                ${prise ? `<span class="nhlclub-tile-tag">Prise — ${echapper(prisePar)}</span>` : ''}
            </button>`;
    }

    function ligneRoster(nomEquipe, donneesEquipe, clubs) {
        const club = donneesEquipe.nhlClub ? clubs.find(c => c.code === donneesEquipe.nhlClub) : null;
        return `
            <li class="nhlclub-roster-item ${club ? 'is-done' : 'is-pending'}">
                ${club
                    ? `<img src="teams/${club.code}.png" alt="" class="nhlclub-roster-logo">`
                    : '<span class="nhlclub-roster-logo is-empty" aria-hidden="true"></span>'}
                <span class="nhlclub-roster-team">${echapper(nomEquipe)}</span>
                <span class="nhlclub-roster-club">${club ? echapper(club.nom) : 'En attente…'}</span>
            </li>`;
    }

    /** Bloc complet : grille de choix (si mon équipe n'a pas encore choisi) + statut de tout le monde. */
    function blocIdentiteLNH(pool, clubs, monEquipe) {
        const equipes = equipesEligibles(pool.data);
        const monEntree = monEquipe ? equipes.find(([nom]) => nom === monEquipe.name) : null;
        const monClubActuel = monEntree ? monEntree[1].nhlClub : null;

        const grille = monEquipe ? `
            <div class="nhlclub-picker">
                <h2 class="nhlclub-picker-title">
                    ${monClubActuel ? 'Changer votre équipe LNH' : 'Choisissez votre équipe LNH'}
                </h2>
                <p class="nhlclub-picker-sub">
                    Elle habillera toutes vos cartes de choix dans la salle de repêchage — le fond
                    et l'écusson, du premier tour au dernier. Un autre pool que le vôtre a peut-être
                    pris la même équipe : ce n'est pas un problème, seul votre pool doit être unique.
                </p>
                <div class="nhlclub-grid" id="nhlclubGrid">
                    ${(() => {
                        const fond = fondCarte();
                        return clubs.map(c => tuileClub(c, prisePar(c.code, equipes), monEquipe.name, fond)).join('');
                    })()}
                </div>
            </div>` : '';

        const roster = `
            <div class="nhlclub-roster-wrap">
                <h3 class="nhlclub-roster-title">Équipes du pool</h3>
                <ul class="nhlclub-roster">
                    ${equipes.map(([nom, data]) => ligneRoster(nom, data, clubs)).join('')}
                </ul>
            </div>`;

        return grille + roster;

        function prisePar(code, listeEquipes) {
            const trouvee = listeEquipes.find(([, t]) => t.nhlClub === code);
            return trouvee ? trouvee[0] : null;
        }
    }

    async function choisirClub(pool, code) {
        const username = localStorage.getItem('username') || '';
        const grille = document.getElementById('nhlclubGrid');
        if (grille) grille.setAttribute('aria-busy', 'true');
        try {
            const reponse = await fetch(`${FZPool.BASE_URL}/choose-nhl-club`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clanName: pool.name, username, club: code })
            });
            const resultat = await reponse.json().catch(() => ({}));
            if (!reponse.ok) {
                alert(resultat.message || "Impossible de choisir cette équipe.");
                return;
            }
            await FZPool.refresh(); // redessine avec la donnée à jour
        } catch (erreur) {
            console.error('Choix d\'équipe LNH impossible :', erreur);
            alert('Connexion perdue — votre choix n\'a pas été enregistré. Réessayez.');
        } finally {
            if (grille) grille.removeAttribute('aria-busy');
        }
    }

    function rendrePretSquelette(pool) {
        conteneur().innerHTML = `
            <article class="rp-card">
                ${entete(pool, 'Prêt', 'pret')}
                <div class="rp-body">
                    <div class="rp-loading" style="padding:40px 0;">
                        <div class="rp-spinner" aria-hidden="true"></div>
                        <p>Chargement des équipes de la LNH…</p>
                    </div>
                </div>
            </article>`;
    }

    async function rendrePret(pool, etat) {
        // Le squelette de chargement ne paraît qu'au tout premier passage :
        // une fois les clubs en cache, chaque rafraîchissement socket redessine
        // directement, sans clignotement.
        if (!_clubsCache) rendrePretSquelette(pool);

        let clubs;
        try {
            clubs = await chargerClubsLNH();
        } catch (erreur) {
            console.error('Chargement des équipes LNH impossible :', erreur);
            conteneur().innerHTML = `
                <article class="rp-card">
                    ${entete(pool, 'Prêt', 'pret')}
                    <div class="rp-body">
                        <p class="rp-lead">Impossible de charger la liste des équipes de la LNH.</p>
                        <div class="rp-actions">
                            <button type="button" class="rp-btn primary" id="rpRetryClubs">Réessayer</button>
                        </div>
                    </div>
                </article>`;
            document.getElementById('rpRetryClubs')?.addEventListener('click', () => rendrePret(pool, etat));
            return;
        }

        // Le pool a pu changer d'état pendant le chargement (quelqu'un d'autre
        // vient de démarrer le repêchage) : on relit l'état plutôt que d'agir
        // sur une donnée déjà périmée.
        const poolActuel = FZPool.mine().find(p => p.name === pool.name) || pool;
        const etatActuel = FZPool.draftState(poolActuel.data);
        if (etatActuel.etat !== 'pret') { rendre(); return; }

        const monEquipe = FZPool.team();
        const equipes = equipesEligibles(poolActuel.data);
        const tousChoisis = equipes.every(([, t]) => !!t.nhlClub);

        conteneur().innerHTML = `
            <article class="rp-card">
                ${entete(poolActuel, 'Prêt', 'pret')}
                <div class="rp-body">
                    <p class="rp-lead">
                        Le pool est complet : ${etatActuel.inscrits} participants sur ${etatActuel.max}.
                    </p>
                    <p class="rp-note">L'ordre de sélection est tiré au hasard au démarrage.
                       Une fois lancé, le changement d'équipe se ferme pour tout le monde.</p>

                    ${blocIdentiteLNH(poolActuel, clubs, monEquipe)}

                    ${!tousChoisis ? `
                        <p class="warning-message">
                            En attente du choix de ${equipes.filter(([, t]) => !t.nhlClub).length}
                            équipe${equipes.filter(([, t]) => !t.nhlClub).length > 1 ? 's' : ''} avant de pouvoir commencer.
                        </p>` : ''}

                    <div class="rp-actions">
                        <button type="button" class="rp-btn primary" id="rpStart" ${!tousChoisis ? 'disabled' : ''}>
                            Commencer le repêchage
                        </button>
                    </div>
                </div>
            </article>`;

        document.getElementById('nhlclubGrid')?.addEventListener('click', e => {
            const tuile = e.target.closest('.nhlclub-tile');
            if (!tuile || tuile.disabled) return;
            choisirClub(poolActuel, tuile.dataset.club);
        });

        const boutonStart = document.getElementById('rpStart');
        if (boutonStart && tousChoisis) {
            boutonStart.addEventListener('click', () => demarrer(poolActuel.name));
        }
    }

    function rendreTermine(pool) {
        conteneur().innerHTML = `
            <article class="rp-card">
                ${entete(pool, 'Terminé', 'termine')}
                <div class="rp-body">
                    <p class="rp-lead">Le repêchage de ce pool est terminé. Place à la saison.</p>
                    <div class="rp-actions">
                        <a class="rp-btn primary" href="classement.html">Voir le classement</a>
                        <a class="rp-btn secondary" href="draftFini.html">Revoir les sélections</a>
                    </div>
                </div>
            </article>`;
    }

    function rendreOuverture(pool) {
        conteneur().innerHTML = `
            <div class="rp-loading">
                <div class="rp-spinner" aria-hidden="true"></div>
                <p>Ouverture du repêchage de <strong>${echapper(pool.name)}</strong>…</p>
            </div>`;
    }

    async function demarrer(nomPool) {
        const bouton = document.getElementById('rpStart');
        if (bouton) { bouton.disabled = true; bouton.textContent = 'Démarrage…'; }

        try {
            // Un ordre peut déjà exister si quelqu'un d'autre vient de lancer
            // le repêchage : on ne le retire pas, on entre simplement.
            const reponse = await fetch(`${FZPool.BASE_URL}/draft-order/${encodeURIComponent(nomPool)}`);
            const resultat = await reponse.json();

            if (!resultat.draftOrder || resultat.draftOrder.length === 0) {
                const depart = await fetch(`${FZPool.BASE_URL}/start-draft`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clanName: nomPool })
                });
                const donnees = await depart.json().catch(() => ({}));
                if (!depart.ok) {
                    // Une autre équipe a pu changer son choix entre le rendu et
                    // le clic : le serveur reste la source de vérité, on relit
                    // l'état plutôt que d'insister sur un départ déjà refusé.
                    alert(donnees.message || "Impossible de démarrer le repêchage.");
                    if (bouton) { bouton.disabled = false; bouton.textContent = 'Commencer le repêchage'; }
                    await FZPool.refresh();
                    rendre();
                    return;
                }
            }

            localStorage.setItem('draftClan', nomPool);
            window.location.href = 'draftActif.html';
        } catch (erreur) {
            console.error('Démarrage du repêchage impossible :', erreur);
            if (bouton) { bouton.disabled = false; bouton.textContent = 'Commencer le repêchage'; }
            alert('Erreur lors de la préparation du repêchage.');
        }
    }

    function rendre() {
        if (!conteneur()) return;

        const nom = FZPool.get();
        const pool = FZPool.mine().find(p => p.name === nom);
        if (!pool) { rendreVide(); return; }

        const etat = FZPool.draftState(pool.data);

        if (etat.etat === 'encours') {
            // location.replace : revenir en arrière depuis la salle de
            // repêchage ne doit pas rebondir ici indéfiniment.
            rendreOuverture(pool);
            localStorage.setItem('draftClan', pool.name);
            window.location.replace('draftActif.html');
            return;
        }

        if (etat.etat === 'pret') { rendrePret(pool, etat); return; }
        if (etat.etat === 'termine') { rendreTermine(pool); return; }
        rendreAttente(pool, etat);
    }

    // Le pool actif change depuis le rail : la page se remet à jour sans
    // rechargement, et repart vers la salle de repêchage s'il le faut.
    window.FZ_POOL_EN_PLACE = true;

    document.addEventListener('DOMContentLoaded', async () => {
        if (localStorage.getItem('isLoggedIn') !== 'true') {
            window.location.href = 'login.html';
            return;
        }
        await FZPool.ready();
        rendre();
        FZPool.on(rendre);
        FZPool.onData(rendre);
    });
})();
