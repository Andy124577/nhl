# Landing Fantazy — stratégie et structure

La page d'accueil des visiteurs (`index.html`, `<main class="fzl">`, visible avec `html.fz-anon`). Styles : `landing.css`. Mouvement : `landing.js`.

Ce document adapte à Fantazy le processus de landing page utilisé pour CompuSport : même logique (comprendre en 5 secondes → reconnaître son problème → voir la solution → voir le produit en action → avoir confiance → passer à l'action), contenu propre à Fantazy.

## 1. Vision, mission, comment

| | CompuSport | Fantazy |
| --- | --- | --- |
| **Vision** | Empower the fun to play together | Que tout le monde puisse jouer au pool de hockey ensemble. |
| **Mission** | Simplifier la gestion des compétitions, relier organisateurs et joueurs | Rendre le pool de hockey si simple que n'importe qui peut en créer un, y jouer toute une saison et sentir qu'il a ses chances de gagner, même sans expérience. |
| **Comment** | Les outils les plus puissants et simples du marché | Des réglages par défaut prêts à jouer et entièrement modifiables. Un repêchage en direct qui aide les débutants à choisir. Un classement et un suivi des joueurs qui se font tout seuls, avec les vraies stats de la LNH. Gratuit, en français, pensé pour le téléphone. |
| **Produit d'entrée gratuit** | Quick Tournament + FunGame | **Pool rapide** : un clic, 4 gérants, rien à configurer, le repêchage part tout seul. |
| **Dans l'app** | League | **Pool** (vocabulaire québécois, jamais « ligue fantasy ») |
| **Autres sports (carrousel)** | Tous les sports CompuSport | Les **32 clubs de la LNH** : Fantazy ne fait que du hockey ; le carrousel montre que toute la ligue est dans ton pool. |
| **Self-service** | Remplacer « Contactez-nous » | Déjà vrai : aucune porte « contact ». Trois portes en libre-service : Jouer maintenant, Créer mon pool, Rejoindre un pool. |
| **Premium** | Abonnés payants | Fantazy est gratuit (Conditions). Le « premium » devient une **impression** : habillage de diffusion télé, cartes aux couleurs des clubs, tableau des scores. On a l'air d'un pro sans rien payer. |
| **Objectif phase 1** | Plus d'abonnés premium | Plus de comptes créés, puis plus de pools qui passent le repêchage (mesure de succès de `PRODUCT.md`). |

## 2. Persona

Des gens qui font un pool **pour le fun**, avec des **collègues** ou des **amis**, parfois contre des **inconnus**. Ils sont **compétitifs**. Ils veulent :

- un repêchage facile ;
- un suivi facile du classement ;
- un suivi facile de leurs joueurs (blessures, séquences, joueurs en feu) ;
- sentir qu'ils ont leurs chances de gagner, **même sans aucune expérience**, comme beaucoup de joueurs.

Fantazy doit être reconnu pour sa **simplicité** : simple par défaut, modifiable à ta guise.

## 3. Le test des 5 secondes

| Question | Réponse dans le héros |
| --- | --- |
| C'est quoi ? | « Le pool de hockey sans casse-tête. » |
| Pour qui ? | Celui qui veut jouer sans se casser la tête : le bouton « Jouer gratuitement » et le téléphone disent le reste. |
| Quel problème ça règle ? | « Sans casse-tête ». |
| Pourquoi ça m'intéresse ? | Le téléphone qui montre un vrai repêchage en direct ; la première scène : « Même sans expérience, t'as tes chances. » |

## 4. Structure : courte, parce que le produit est simple

Une page qui vend la simplicité ne peut pas être compliquée. Règle : **une idée par bloc, une phrase par idée, un seul bouton**. Tout ajout doit en remplacer un autre.

| Bloc | Contenu | Fond |
| --- | --- | --- |
| Héros | Le titre, **un** bouton « Jouer gratuitement », le téléphone (salle de repêchage animée). Rien d'autre : pas de sur-titre, de paragraphe, de cartes flottantes ni de bandeau défilant. | Bandeau noir et rouge |
| Scènes | 01 Ton avantage (aide au repêchage), 02 Classement (automatique), 03 Échanges. Chacune : étiquette, titre, une phrase, 2-3 pastilles, un visuel. | Corps de la fiche joueur |
| Clubs | Les 32 clubs qui défilent sur deux rangées. | Idem |
| Questions | 4 questions repliées. | Idem |
| Dernier appel | Titre, le même bouton, un lien « Rejoindre un pool » pour les invités. | Bandeau noir et rouge |

Retirés le 23 sept. 2026 (trop de texte, trop d'éléments pour une promesse de simplicité) : la section problème (Excel, chat de groupe, 7 tâches), la section solution (tâches réglées, trois façons de jouer, trois étapes), les scènes pool rapide, ton pool, tableau de repêchage, tes joueurs et tête-à-tête, les 6 faits, le barème complet, 5 des 9 questions, les onglets de période et le scorebug. La barre de navigation, collante, garde « S'inscrire » à portée de main.

## 5. Le bandeau

Le héros et le dernier appel reprennent le haut de la fiche joueur (`career-modal.css`, `.cmh-name-banner`) : un aplat, un filigrane incliné à −13°, rogné, une bande sombre et une bande de couleur en biais à 132°, une trame fine à 24°, un filet de 3 px. Sur la fiche, ce sont les couleurs et l'écusson du club ; ici, **noir et rouge**, avec le mot-symbole Fantazy (`Icons/fantazy.png`) en filigrane. Les jetons sont en tête de `landing.css` (`--fzl-banner`, `--fzl-red`). Les scènes reprennent le fond du corps de la fiche (`#0D1013` et ses deux trames).

Tout reste sombre dans les deux thèmes : ce sont des décors.

## 6. Mouvement

Le mouvement montre que la compétition est vivante ; il ne décore pas.

- Téléphone du héros : ton tour → choix confirmé → « encore toi » (l'ordre en serpent) → au suivant.
- Totaux du classement qui montent, échange qui passe de « proposé » à « accepté », clubs qui défilent.

Chaque boucle ne tourne que visible à l'écran et s'arrête quand l'onglet est caché. `prefers-reduced-motion` : tout s'affiche dans son état final.

## 7. Règles tenues

- **Aucun chiffre inventé.** Stats : `current_stats.json` et `current_teams.json` (saison 2025–26). Projections : `draftkit.json`. Les totaux du pool d'exemple sont calculés avec `lib/scoring.js` sur un repêchage en serpent des meilleurs disponibles, 13 choix par équipe, gardien et club de la LNH compris.
- **Aucun faux témoignage**, aucun nombre d'utilisateurs, aucune presse : il n'y en a pas. La preuve, c'est le produit réel.
- **Gratuit, sans mise** : dans le bouton et la FAQ. **Indépendant de la LNH** : dans le pied de page légal (`navbar.js`).
- **FAQ** : le texte visible et le `FAQPage` du `<head>` doivent rester identiques.

## 8. SEO

- `<title>` et `meta description` sur la requête « pool de hockey » + simplicité + publics.
- Open Graph (`fr_CA`), URL canonique `https://fantazy.ca/`.
- Données structurées : `WebApplication` (prix 0 $) et `FAQPage`.
- Tout le texte est dans le HTML, pas injecté en JS : lisible par les moteurs et les IA.
- Un seul `<h1>`, puis un `h2` par scène, pour les clubs, la FAQ et le dernier appel.

## 9. Prochaines étapes

1. **Photos réelles.** Il manque des « vrais moments sportifs » : des photos de vos propres soirées de repêchage (amis, bureau, téléphones en main). Pas de photos de matchs de la LNH : elles ne nous appartiennent pas.
2. **Mesurer.** Clics sur « Jouer gratuitement » → inscriptions → premier pool → repêchage terminé.
3. **Image de partage** (`og:image`) dédiée : aujourd'hui, c'est l'ancienne photo de glace du héros.
4. **Bilingue.** Le texte est en dur en français (voir `PRODUCT.md`, décision ouverte).
5. **Rafraîchir les chiffres** à la prochaine saison : le téléphone, le classement d'exemple et les scènes « Ton avantage » et « Échanges » citent la saison 2025–26.
