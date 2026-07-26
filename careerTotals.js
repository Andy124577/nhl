/**
 * Rangée « Carrière » du tableau de carrière — alignement des colonnes.
 *
 * filterCareerStats() écrit, sur les deux pages :
 *     <td colspan="3" class="career-totals-label">Carrière</td>
 * pour couvrir Saison / Ligue / Équipe.
 *
 * Or cette rangée n'est rendue que lorsque le filtre de ligue vaut
 * « NHL seulement » — c'est-à-dire exactement quand career-modal.css masque
 * la colonne Ligue, toutes ses valeurs étant alors identiques. Le libellé
 * couvre donc trois emplacements pour deux colonnes visibles, et chaque
 * statistique de la rangée se décale d'une colonne vers la droite : le total
 * de parties jouées tombait sous l'en-tête « G », les buts sous « A », etc.
 * (+109px mesurés en 1440px).
 *
 * Le colspan est recalculé ici à partir des colonnes réellement visibles.
 * Ce correctif vit à part parce que filterCareerStats() existe en double —
 * dans index.js et dans draftActif.js, ce dernier minifié.
 *
 * Si la colonne Ligue redevient visible (filtre élargi, ou :has() non
 * reconnu par le navigateur), la valeur d'origine est rétablie.
 */

(function () {
    'use strict';

    function ajuster() {
        const table = document.querySelector('#careerStatsTable table');
        if (!table) return;

        const libelle = table.querySelector('.career-totals-label');
        const entete = table.querySelector('thead tr');
        if (!libelle || !entete) return;

        // Le colspan écrit par le JS d'origine, mémorisé avant toute
        // retouche : une fois corrigé, l'attribut ne le porte plus.
        const origine = Number(libelle.dataset.colspanOrigine
            || libelle.getAttribute('colspan') || 1);
        libelle.dataset.colspanOrigine = origine;

        const visibles = Array.from(entete.children)
            .slice(0, origine)
            .filter(th => getComputedStyle(th).display !== 'none')
            .length;

        const cible = String(Math.max(1, visibles));
        // Ne rien écrire quand la valeur est déjà bonne : l'observateur
        // ci-dessous ne surveille pas les attributs, mais autant éviter
        // une écriture inutile à chaque rendu.
        if (libelle.getAttribute('colspan') !== cible) {
            libelle.setAttribute('colspan', cible);
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        const conteneur = document.getElementById('careerStatsTable');
        if (!conteneur) return;

        // Le tableau est reconstruit entièrement à chaque ouverture de la
        // modale et à chaque changement de filtre : on observe l'insertion
        // plutôt que de s'accrocher à un moment précis du rendu.
        new MutationObserver(ajuster).observe(conteneur, {
            childList: true,
            subtree: true
        });

        // Filet de sécurité : un changement de filtre reconstruit le tableau
        // et déclenche déjà l'observateur, mais le coût est nul.
        const filtreLigue = document.getElementById('leagueFilter');
        if (filtreLigue) filtreLigue.addEventListener('change', ajuster);

        ajuster();
    });
})();
