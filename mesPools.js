/* ============================================================
   POOLS — créer, rejoindre, gérer
   ------------------------------------------------------------
   Les deux portes d'entrée (créer, rejoindre) sont posées en dur dans
   mes-pools.html, au-dessus : elles ne dépendent d'aucune donnée. Ce
   fichier ne s'occupe que du reste — la liste de ce qu'on a déjà.

   Ce n'est toujours pas un sélecteur de pool actif : celui-là vit dans
   le rail et le tiroir (poolNav.js). Ici on gère ce que le rail ne peut
   pas montrer — votre équipe, son nom, les règles de la ligue.

   La modale des équipes vient d'equipes.js (viewClanTeams) : c'est
   déjà là que vivent le renommage et le changement d'équipe.
   ============================================================ */
(function () {
    const LIBELLE_ETAT = {
        attente: 'En attente de joueurs',
        pret:    'Prêt à repêcher',
        encours: 'Repêchage en cours',
        termine: 'Saison en cours'
    };

    const echapper = texte => String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    /**
     * Le nom d'équipe par défaut (« Équipe 3 ») ne dit rien : on affiche
     * alors les membres, comme le fait déjà la modale des équipes.
     */
    function nomAffiche(teamName, membres) {
        if (/^Équipe \d+$/.test(teamName) && membres && membres.length > 0) {
            const auto = membres.join(' et ');
            if (auto.length <= 30) return auto;
        }
        return teamName;
    }

    function carte(pool, estActif) {
        const etat = FZPool.draftState(pool.data);
        const config = pool.data.config || {};
        const selections = ['numOffensive', 'numDefensive', 'numGoalies', 'numRookies', 'numTeams']
            .reduce((somme, cle) => somme + (config[cle] || 0), 0);
        const mode = (pool.data.poolMode || 'cumulative') === 'head-to-head' ? 'Head-to-Head' : 'Cumulatif';
        const echanges = pool.data.allowTrades !== false;
        const nomEquipe = nomAffiche(pool.teamName, pool.teamData.members);
        const lien = `pool=${encodeURIComponent(pool.name)}`;

        // Le changement d'équipe se ferme avec le repêchage : autant le dire
        // ici plutôt que de laisser découvrir le refus dans la modale.
        const equipeVerrouillee = etat.commence;

        // Les deux liens du pied de carte s'excluent : on repêche, ou on
        // consulte ce qui en est sorti. Chacun mène à une page qui se
        // refermerait d'elle-même au mauvais moment (activePool.js).
        const repechageOuvert = etat.etat !== 'termine';

        return `
            <article class="mp-card${estActif ? ' is-active' : ''}">
                <header class="mp-head">
                    <img src="${echapper(FZPool.image(pool.data))}" class="mp-img" alt=""
                         onerror="this.src='Icons/grayGroup.png'">
                    <div class="mp-head-txt">
                        <h2 class="mp-name">${echapper(pool.name)}</h2>
                        <div class="mp-chips">
                            ${estActif ? '<span class="mp-chip is-current">Pool actif</span>' : ''}
                            <span class="mp-chip mp-state-${etat.etat}">${LIBELLE_ETAT[etat.etat]}</span>
                            <span class="mp-chip">${mode}</span>
                            <span class="mp-chip">${etat.inscrits}/${etat.max} participants</span>
                        </div>
                    </div>
                    ${estActif ? '' : `
                        <button type="button" class="mp-activate" data-activer="${echapper(pool.name)}">
                            Rendre actif
                        </button>`}
                </header>

                <div class="mp-body">
                    <section class="mp-block">
                        <p class="mp-block-label">Mon équipe</p>
                        <p class="mp-team-name">${echapper(nomEquipe)}</p>
                        <p class="mp-team-members">
                            ${(pool.teamData.members || []).map(echapper).join(', ') || 'Aucun membre'}
                        </p>
                        <div class="mp-actions">
                            <button type="button" class="mp-btn" data-gerer="${echapper(pool.name)}">
                                Renommer ou changer d'équipe
                            </button>
                        </div>
                        ${equipeVerrouillee
                            ? '<p class="mp-note">Le repêchage est lancé : le changement d\'équipe est fermé, le renommage reste possible.</p>'
                            : ''}
                    </section>

                    <section class="mp-block">
                        <p class="mp-block-label">Règles de la ligue</p>
                        <ul class="mp-settings">
                            <li><span>Attaquants</span><strong>${config.numOffensive ?? 6}</strong></li>
                            <li><span>Défenseurs</span><strong>${config.numDefensive ?? 4}</strong></li>
                            <li><span>Gardiens</span><strong>${config.numGoalies ?? 1}</strong></li>
                            <li><span>Rookies</span><strong>${config.numRookies ?? 1}</strong></li>
                            <li><span>Équipes LNH</span><strong>${config.numTeams ?? 1}</strong></li>
                            <li><span>Total des sélections</span><strong>${selections}</strong></li>
                            <li><span>Échanges</span><strong>${echanges ? 'Autorisés' : 'Désactivés'}</strong></li>
                            <li><span>Accès</span><strong>${pool.data.hasPassword ? 'Mot de passe' : 'Libre'}</strong></li>
                        </ul>
                        <p class="mp-note">Les règles sont fixées à la création du pool.</p>
                    </section>
                </div>

                <footer class="mp-foot">
                    ${repechageOuvert
                        ? `<a class="mp-link" href="repechage.html?${lien}">Repêchage</a>`
                        : `<a class="mp-link" href="classement.html?${lien}">Classement</a>`}
                    ${echanges ? `<a class="mp-link" href="trade.html?${lien}">Échanges</a>` : ''}
                </footer>
            </article>`;
    }

    // Sans les deux boutons d'usage : ils sont juste au-dessus, dans les
    // cartes d'entrée. Les répéter à 200 pixels d'intervalle ferait douter
    // qu'il s'agisse des mêmes.
    function videHtml() {
        return `
            <div class="fz-empty-pool">
                <h2>Aucun pool pour l'instant</h2>
                <p>Créez votre ligue ou rejoignez-en une ci-dessus pour commencer à repêcher.</p>
            </div>`;
    }

    function rendre() {
        const conteneur = document.getElementById('fzMyPools');
        const squelette = document.getElementById('mesPoolsSkeleton');
        if (!conteneur) return;

        if (squelette) squelette.style.display = 'none';
        // Chaîne vide et non 'block' : .mp-list est une colonne flex avec
        // gouttière, que 'block' écrasait — les fiches se touchaient.
        conteneur.style.display = '';

        const mesPools = FZPool.mine();
        if (mesPools.length === 0) {
            conteneur.innerHTML = videHtml();
            return;
        }

        const actif = FZPool.get();
        // Le titre sépare ce qu'on a déjà des deux cartes d'entrée qui le
        // précèdent : sans lui, la liste passe pour la suite du menu.
        conteneur.innerHTML =
            `<h2 class="mp-list-title">Mes pools<span>${mesPools.length}</span></h2>` +
            mesPools.map(pool => carte(pool, pool.name === actif)).join('');

        conteneur.querySelectorAll('[data-activer]').forEach(bouton => {
            bouton.addEventListener('click', () => FZPool.set(bouton.dataset.activer));
        });

        conteneur.querySelectorAll('[data-gerer]').forEach(bouton => {
            bouton.addEventListener('click', () => {
                if (typeof viewClanTeams === 'function') viewClanTeams(bouton.dataset.gerer);
            });
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        if (localStorage.getItem('isLoggedIn') !== 'true') {
            window.location.href = 'login.html';
            return;
        }
        await FZPool.ready();
        rendre();
        FZPool.onData(rendre);
        FZPool.on(rendre);
    });

    // Le changement de pool actif se voit ici sans quitter la page : le
    // rechargement complet ferait perdre la position dans la liste.
    window.FZ_POOL_EN_PLACE = true;
})();
