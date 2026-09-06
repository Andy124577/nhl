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

    /** Équipes du pool avec au moins un membre — les seules qui comptent ici. */
    function equipesEligibles(poolData) {
        return Object.entries(poolData.teams || {})
            .filter(([, equipe]) => (equipe.members || []).length > 0)
            .sort(([a], [b]) => a.localeCompare(b, 'fr'));
    }

    /**
     * Écran « Prêt » : le pool est complet, il ne reste qu'à lancer.
     *
     * Il portait avant une étape d'identité — chaque équipe choisissait un
     * club de la LNH, qui habillait ensuite ses cartes dans la salle de
     * repêchage, et le départ restait bloqué tant que tout le monde n'avait
     * pas choisi. L'étape faisait doublon : l'équipe de la LNH se repêche
     * maintenant comme n'importe quelle autre position (config.numTeams),
     * pendant le repêchage. Les cartes retombent sur le club du joueur choisi
     * (voir draftPickCards.js), et plus rien ne retarde le départ.
     */
    function rendrePret(pool, etat) {
        const equipes = equipesEligibles(pool.data);

        conteneur().innerHTML = `
            <article class="rp-card">
                ${entete(pool, 'Prêt', 'pret')}
                <div class="rp-body">
                    <p class="rp-lead">
                        Le pool est complet : ${etat.inscrits} participants sur ${etat.max}.
                    </p>
                    <p class="rp-note">L'ordre de sélection est tiré au hasard au démarrage.</p>

                    <div class="rp-roster-wrap">
                        <h3 class="rp-roster-title">Équipes du pool</h3>
                        <ul class="rp-roster">
                            ${equipes.map(([nom, data]) => `
                                <li class="rp-roster-item">
                                    <span class="rp-roster-team">${echapper(nom)}</span>
                                    <span class="rp-roster-members">${echapper((data.members || []).join(', '))}</span>
                                </li>`).join('')}
                        </ul>
                    </div>

                    <div class="rp-actions">
                        <button type="button" class="rp-btn primary" id="rpStart">
                            Commencer le repêchage
                        </button>
                    </div>
                </div>
            </article>`;

        document.getElementById('rpStart')
            ?.addEventListener('click', () => demarrer(pool.name));
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
                    // Le pool a pu changer entre le rendu et le clic (un membre
                    // parti, par exemple) : le serveur reste la source de
                    // vérité, on relit l'état plutôt que d'insister sur un
                    // départ déjà refusé.
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
