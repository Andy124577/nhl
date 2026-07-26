/**
 * Logo d'équipe dans le tableau de carrière — utilitaire partagé.
 *
 * Les deux pages produisaient cette cellule différemment et aucune ne
 * l'affichait correctement :
 *   - draftActif.js écrit `teams/${team}.png` où team est le NOM COMPLET
 *     renvoyé par l'API (« Anaheim Ducks ») : le fichier n'existe pas, et
 *     l'image tombait sur son texte alternatif ;
 *   - index.js n'écrit que du texte, sans logo du tout.
 *
 * Ce module normalise l'affichage des deux côtés — logo si un fichier
 * correspond, nom de l'équipe dans tous les cas — sans modifier le rendu
 * d'origine, dont l'un est minifié.
 *
 * Les ligues junior et universitaires (NCAA, LHJMQ…) n'ont pas de logo
 * dans teams/ : l'image est alors retirée et seul le nom subsiste.
 */

(function () {
    'use strict';

    /** Chemin du logo, ou null si le nom ne donne rien d'exploitable. */
    function cheminLogo(nomEquipe) {
        if (!nomEquipe || nomEquipe === '-') return null;
        // getTeamAbbreviation est défini par index.js comme par draftActif.js.
        if (typeof getTeamAbbreviation !== 'function') return null;
        try {
            const abbr = getTeamAbbreviation(nomEquipe);
            return abbr ? 'teams/' + abbr + '.png' : null;
        } catch (e) {
            return null;
        }
    }

    function normaliserCellule(cellule) {
        if (cellule.dataset.logoNormalise) return;

        const img = cellule.querySelector('img');
        // Le nom vient de l'attribut alt/title quand une image est présente,
        // du texte de la cellule sinon.
        const nom = (img && (img.getAttribute('alt') || img.getAttribute('title')))
            || cellule.textContent.trim();

        cellule.dataset.logoNormalise = '1';
        if (!nom || nom === '-') return;

        const chemin = cheminLogo(nom);
        cellule.textContent = '';

        // Nom en clair : seul contenu quand aucun logo n'est disponible.
        // Affiché d'emblée, puis retiré si le logo se charge — la colonne
        // est étroite et « Edmonton Oilers » s'y trouvait tronqué, alors que
        // le logo suffit à identifier l'équipe.
        const texte = document.createElement('span');
        texte.className = 'career-team-name';
        texte.textContent = nom;
        cellule.appendChild(texte);

        if (!chemin) return;

        const logo = document.createElement('img');
        logo.className = 'career-team-logo';
        logo.src = chemin;
        logo.alt = nom;
        logo.title = nom;          // le nom reste accessible au survol
        logo.addEventListener('load', () => texte.remove());
        // Ligue junior ou universitaire sans logo : l'image disparaît et le
        // nom reste.
        logo.addEventListener('error', () => logo.remove());
        cellule.insertBefore(logo, texte);
    }

    function normaliser() {
        document.querySelectorAll('#careerStatsTable td.team-col')
            .forEach(normaliserCellule);
    }

    document.addEventListener('DOMContentLoaded', function () {
        const conteneur = document.getElementById('careerStatsTable');
        if (!conteneur) return;

        // Le tableau est reconstruit à chaque ouverture de modale et à chaque
        // changement de filtre : on observe plutôt que de s'accrocher à un
        // moment précis du rendu.
        new MutationObserver(normaliser).observe(conteneur, {
            childList: true,
            subtree: true
        });
        normaliser();
    });
})();
