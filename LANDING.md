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
| C'est quoi ? | « Le pool de hockey sans casse-tête. » + « Pool de hockey LNH · Gratuit » |
| Pour qui ? | « Pour le fun, avec tes amis ou tes collègues, ou contre des inconnus. » |
| Quel problème ça règle ? | « Sans casse-tête » ; « tout est déjà réglé ». |
| Pourquoi ça m'intéresse ? | « Même sans expérience, t'as tes chances. » + le téléphone qui montre un vrai repêchage en direct. |

## 4. Structure : un match en six temps

Chaque section est une période. Le visiteur sait toujours où il est.

| Temps | Section | Message | Fond | Visuel principal |
| --- | --- | --- | --- | --- |
| Mise au jeu | Héros | Le pool de hockey sans casse-tête | Scène sombre, photo de glace (fixe) | Téléphone : la salle de repêchage animée |
| 1re période | Problème | Gérer un pool, ça ne devrait pas être une deuxième job | Papier quadrillé (fixe) | Fichier Excel plein d'erreurs, chat de groupe, 7 tâches faites à la main |
| 2e période | Solution | Fantazy gère. Toi, tu joues. | Surface du thème | Les **mêmes 7 tâches**, chacune réglée ; trois façons de jouer ; trois étapes |
| 3e période | Produit | Tout ce qu'il faut pour une vraie saison | Plateau de diffusion (fixe) | 8 scènes : pool rapide, ton pool, repêchage, ton avantage, classement, tes joueurs, tête-à-tête, échanges ; puis les 32 clubs |
| Reprise | Faits + FAQ | Pas de promesses. Des faits. | Glace blanche (fixe), puis surface du thème | 6 faits vérifiables, le barème complet, 9 questions |
| Prolongation | Action | À toi de faire le premier choix | Brique (fixe) | Trois portes en libre-service |

Les scènes fixes restent identiques dans les deux thèmes, comme l'ancien héros. Les sections de lecture (solution, FAQ) suivent le thème clair ou sombre.

## 5. Les repères visuels d'un message à l'autre

- **Onglet de période** en tête de chaque section (« 1re période — Le problème »), avec une ligne qui se trace et une rondelle qui glisse, reprise de la ligne rouge de la photo du héros.
- **Scorebug** fixe (bas d'écran au téléphone, pastille en bas à gauche au bureau) : période en cours, 6 pastilles de progression cliquables, bouton « Jouer ». Un volet brique le balaie à chaque changement de période.
- **Même biais** à chaque transition de section : la « coupe » d'un habillage télé.
- **Changement de fond franc** d'une section à l'autre (sombre → papier → thème → plateau → glace → brique).
- **Continuité narrative** : les 7 tâches du problème reviennent dans la solution ; le pool d'exemple (Les Glorieux, Pool des boys, Ice Storm MTL, Mon équipe) revient dans le repêchage, le classement, le duel et l'échange.

## 6. Mouvement

Le mouvement montre que la compétition est vivante ; il ne décore pas.

- Téléphone du héros : ton tour → choix confirmé → « encore toi » (l'ordre en serpent) → au suivant.
- Crawl des meilleurs pointeurs 2025–26.
- Chat de groupe qui s'empile, erreurs Excel qui clignotent.
- Tâches qui passent de « à la main » (barré) à « réglé ».
- File du pool rapide qui se remplit, tableau de repêchage révélé dans l'ordre du serpent, totaux du classement qui montent, échange qui passe de « proposé » à « accepté ».

Chaque boucle ne tourne que visible à l'écran et s'arrête quand l'onglet est caché. `prefers-reduced-motion` : tout s'affiche dans son état final.

## 7. Règles tenues

- **Aucun chiffre inventé.** Stats : `current_stats.json` et `current_teams.json` (saison 2025–26). Projections : `draftkit.json`. Les totaux du pool d'exemple sont calculés avec `lib/scoring.js` sur un repêchage en serpent des meilleurs disponibles ; le calcul est décrit sous le classement. Le duel est montré à 0–0, en début de semaine. Les onglets « Blessés », « En feu » de la scène « Tes joueurs » sont des filtres : aucun statut de joueur n'est affiché.
- **Aucun faux témoignage**, aucun nombre d'utilisateurs, aucune presse : il n'y en a pas. La preuve, c'est le produit réel et la transparence (barème complet).
- **Gratuit, sans mise, indépendant de la LNH**, dit clairement.
- **Barème** : la section `#bareme` recopie `lib/scoring.js`. À mettre à jour si le barème change.
- **FAQ** : le texte visible et le `FAQPage` du `<head>` doivent rester identiques.

## 8. SEO

- `<title>` et `meta description` sur la requête « pool de hockey » + simplicité + publics.
- Open Graph (`fr_CA`), URL canonique `https://fantazy.ca/`.
- Données structurées : `WebApplication` (prix 0 $) et `FAQPage`.
- Tout le texte est dans le HTML, pas injecté en JS : lisible par les moteurs et les IA.
- Un seul `<h1>`, une hiérarchie `h2` par période, `h3` par scène.

## 9. Prochaines étapes

1. **Photos réelles.** Il manque des « vrais moments sportifs » : des photos de vos propres soirées de repêchage (amis, bureau, téléphones en main). Pas de photos de matchs de la LNH : elles ne nous appartiennent pas.
2. **Mesurer.** Clics sur « Jouer gratuitement » → inscriptions → premier pool → repêchage terminé.
3. **Image de partage** (`og:image`) dédiée : aujourd'hui, c'est la photo de glace du héros.
4. **Bilingue.** Le texte est en dur en français (voir `PRODUCT.md`, décision ouverte).
5. **Rafraîchir les chiffres** à la prochaine saison : le crawl, le téléphone, le tableau de repêchage, le classement d'exemple et la scène « Ton avantage » citent la saison 2025–26.
