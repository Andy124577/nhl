# Rapport de livraison — releases A à F

Date : 12 septembre 2026. Portée : `FANTAZY_EVOLUTION_PLAN.md`, sections 4 à 12.

Ce document dit ce qui a changé, ce qui a été vérifié, et ce qui ne l'a pas
été. La dernière partie est la plus importante : plusieurs critères
d'acceptation du plan restent **incomplets**, et les marquer comme tels vaut
mieux que de les déclarer atteints.

---

## 1. Ce qui a changé, par release

### Release A — identité et écritures de pool

**Identité.** Une session serveur remplace le nom d'utilisateur envoyé dans le
corps des requêtes. Cookie opaque HttpOnly, `SameSite=Lax`, `Secure` en
production, expiration à 30 jours, inactivité à 14 jours, révocation à la
déconnexion et à la suppression de compte. Seule l'empreinte du jeton est
stockée.

Le contrôle d'origine couvre aussi `/login` et `/signup`, pas seulement les
requêtes déjà authentifiées : sans lui, une page tierce peut poster des
identifiants et connecter la personne au compte de l'attaquant. Le cookie n'y
est pas encore au départ, mais il y sera au retour.

Trois portes ouvertes se sont fermées :

| Avant | Après |
| --- | --- |
| `username` dans le corps faisait foi | `req.auth` vient du cookie ; un nom divergent est refusé |
| `/admin-login` acceptait un mot de passe écrit dans le dépôt | Vérification normale, plus la colonne `is_admin` |
| `?adminToken=admin` ouvrait `/admin-users` et la bascule de compte | Session d'administration exigée |

Fermer `/admin-login` a laissé la serrure sans clé : rien ne mettait jamais
`is_admin` à vrai. `/signup` crée `is_admin = false`, la migration la déclare
`DEFAULT FALSE`, et aucune route ne la modifie — c'est voulu, une route qui
promeut est une route qu'on attaque. La clé se taille hors ligne :

```
node tools/creer-admin.js <nom>                     # mot de passe tiré au sort
node tools/creer-admin.js <nom> --mot-de-passe <m>  # mot de passe choisi
```

Le script écrit dans le magasin que le serveur utilise — PostgreSQL si
`DATABASE_URL` est présent, sinon `users.json`. Sur un compte qui existe déjà,
il promeut sans toucher au mot de passe.

La base de production est externe (voir `render.yaml` : aucune section
`databases`), donc joignable depuis un poste de travail. Le shell Render, qui
est payant, n'est pas nécessaire — on pointe le script sur l'URL de la base le
temps d'une commande :

```
DATABASE_URL='postgresql://…' node tools/creer-admin.js <nom>
```

Le script relit ensuite le compte depuis le magasin et échoue si `is_admin`
n'y est pas : contre une base distante, personne ne peut aller vérifier à la
main.

Si rien ne peut joindre la base depuis le poste — pare-feu, liste d'adresses
permises — `--sql` n'écrit rien et imprime l'ordre à coller dans la console web
de la base. L'empreinte bcrypt est calculée localement : le mot de passe en
clair ne quitte pas la machine.

```
node tools/creer-admin.js <nom> --sql
```

**Portée des données.** `/draft` distingue le résumé de découverte de la vue de
membre. La connexion Socket.IO n'émet plus l'état de tous les pools : chaque
socket entre dans une salle par pool dont il est membre, recalculée à chaque
changement d'appartenance. Nouvelle route `/pool-teams/:poolName` pour choisir
son équipe avant d'entrer, sans nommer les participants.

**Fichiers servis.** `express.static(__dirname)` servait la racine du dépôt.
Une liste de permis la remplace : `server.js`, `db.js`, `users.json`,
`draft.json`, les scripts et les fichiers cachés répondent 404.

**Contrat d'écriture.** Une transaction, un verrou de ligne, une validation
sous verrou, le journal écrit dans la même transaction, COMMIT avant tout
accusé de réception. Plus de repli vers JSON après un échec PostgreSQL — le
chemin d'erreur écrivait dans un fichier puis diffusait un succès.

**Idempotence.** Les choix et les acceptations portent un identifiant
d'opération. Un réessai relit son résultat ; un identifiant recyclé avec une
autre demande est refusé. Le renversement du serpentin est couvert par le
couple (identifiant, tour attendu).

**Échanges.** L'acceptation vérifie que celui qui accepte est le destinataire —
la vérification manquait entièrement. Alignements, statut, propositions
concurrentes et annonces tiennent dans une seule transaction.

**Routes en double.** `/delete-clan`, `/join-clan` et `/draft-order/:clanName`
étaient définies deux fois. `/trades/all` était masquée par
`/trades/:draftName`. Une seule définition chacune, celle qui vérifie les
droits.

### Release B — repêchage instantané

Appariement transactionnel sous `pg_advisory_xact_lock`, relâché par le COMMIT.
Un verrou indisponible renvoie une erreur réessayable au lieu d'un succès
obtenu sans protection.

Salon : états explicites (`waiting`, `starting`, `drafting`, `completed`),
présence tolérante aux onglets multiples et aux coupures brèves (grâce de
60 s), compte à rebours de 10 s tenu par le serveur et **revalidé sous verrou
avant d'écrire**, transfert du rôle de créateur au départ, temps d'attente
affiché sans estimation inventée.

### Release C — pointage et tête-à-tête

`lib/dates.js` : une seule source pour les journées et les semaines. Frontières
sur `America/Toronto`, semaines semi-ouvertes `[lundi, lundi suivant)`,
additions en jours de calendrier. Deux aides comparaient l'une `< fin`, l'autre
`<= fin`.

`lib/scoring.js` : un seul barème pour les feuilles de match. Version de
barème, états de complétude explicites, et un résultat porte saison, mode,
période, base d'alignement et complétude.

Le club de la LNH repêché est **exclu du tête-à-tête et inclus au cumulatif** —
la règle en vigueur, désormais écrite et portée par chaque résultat.

Finalisation : un seul service pour la voie manuelle et le travail de fond. La
substitution par les totaux de saison est retirée. Les résultats sont figés en
base sous `(pool, saison, semaine, révision)`. Une correction crée une révision
et ajuste le classement par la différence.

### Releases D, E, F

Activité et notifications durables, écrites dans la transaction qui change
l'état source. Lue et résolue restent distinctes. `/api/me/today` : une seule
réponse pour les deux dispositions de l'accueil, avec un ordre par urgence
réelle et aucune échéance inventée. Récapitulatifs produits à partir des
résultats figés, chaque catégorie se retirant quand sa donnée manque.

---

## 2. Corrections trouvées en cours de route

Trois défauts découverts pendant l'implémentation, absents du plan :

1. **Tout patineur était pointé comme un gardien** dès que la position manquait
   sur la ligne. Les colonnes de gardien ont un défaut à zéro, pas à `NULL` :
   la détection « a-t-il un champ d'arrêts ? » répondait oui pour tout le monde.
2. **Une date impossible débordait en silence.** `2026-02-31` devenait le
   3 mars, et `2026-13-45` février 2027 — assez pour décaler un calendrier de
   plusieurs mois sans que rien ne le signale.
3. **La révision de pool écrasait la révision de semaine.** Le contrat
   d'écriture posait `revision` sur tout résultat d'opération ; une semaine
   finalisée à la révision 2 en ressortait à 3.

---

## 3. Contrats modifiés

| Route | Changement |
| --- | --- |
| `POST /login`, `/signup`, `/admin-login` | Posent un cookie de session |
| `POST /logout` | Nouvelle. Révoque la session |
| `GET /session` | Nouvelle. Qui est connecté |
| `GET /draft` | Détail aux membres, résumé aux autres |
| `GET /pool-teams/:poolName` | Nouvelle. Équipes sans nommer les participants |
| `GET /admin-users`, `POST /admin-switch-user` | Session d'administration exigée |
| `POST /pick-player`, `/skip-turn` | Acceptent `operationId` et `expectedPickIndex` |
| `POST /trade/accept` | Vérifie le destinataire |
| `GET /trades/all` | Atteignable, limitée aux pools dont on est membre |
| `GET /trade-listings/:poolName` | Enrichie : `peutOffrir`, `raison`, `monOffre` |
| `GET /h2h/matchup` | Nouvelle. Une semaine précise, figée si close |
| `POST /h2h/revise-week` | Nouvelle. Correction par révision |
| `GET /api/me/today` | Nouvelle. Priorité unique |
| `GET /api/notifications`, `/count`, `POST /read`, `/read-all` | Nouvelles |
| `GET /api/pools/:poolName/activity` | Nouvelle. Fil paginé, membres seulement |
| `GET /api/pools/:poolName/recap` | Nouvelle |

Événements Socket.IO ajoutés : `sessionPrete`, `sessionAnonyme`, `poolUpdated`,
`salonMisAJour`, `salonDemarrage`, `salonFerme`, `draftDemarre`, `poolSupprime`,
`poolRenomme`, `recapDisponible`. `draftUpdated` est conservé mais n'est plus
diffusé à tout le monde : il part dans la salle du pool, avec la vue de membre.

---

## 4. Migration

Sept migrations numérotées, avec registre et détection de dérive.

```
npm run migrate -- --etat    # ce qui est en attente, sans rien écrire
npm run migrate              # applique
```

`0001_baseline.sql` décrit le schéma existant en `IF NOT EXISTS` : une base en
service le traverse sans effet. Aucune migration ne détruit de table — un test
le vérifie.

**Ordre recommandé.** Appliquer les migrations d'abord, déployer ensuite. Les
schémas sont additifs, donc l'ancienne version continue de fonctionner
au-dessus. En revanche l'ancien code écrit encore des pools entiers : ne pas
laisser tourner les deux versions en même temps. Un redémarrage bref est plus
simple qu'un déploiement progressif.

**Sauvegarder avant.** Le retour arrière consiste à redéployer l'ancienne
version ; il ne consiste PAS à supprimer les tables, qui portent des
notifications et des résultats figés.

**Variables d'environnement.** `ALLOWED_ORIGINS` (liste séparée par des
virgules) si le site est servi depuis une origine différente de celle du
serveur. Sans elle, l'hôte servi fait foi.

---

## 5. Vérifications réellement exécutées

| Vérification | Résultat |
| --- | --- |
| `npm run test:unit` | **779 passent**, 0 échec, 0 ignoré (515 au départ) |
| `test_suite.js` contre un serveur jetable | 44 passent, 0 échec, 9 ignorés |
| `test_h2h.js` contre un serveur jetable | 51 passent, 0 échec, 5 ignorés |
| `test_teams.js` contre un serveur jetable | 62 passent, 0 échec |
| Parcours de bout en bout, serveur réel | Sessions, portée de `/draft`, tours, idempotence, file instantanée, priorité, révocation |
| Chargement du serveur | Démarre proprement en mode fichier |

Les ignorés le sont faute de PostgreSQL : feuilles de match, échanges,
notifications durables, récaps. Ils se disent ignorés plutôt que d'échouer.

---

## 6. Ce qui n'a PAS été vérifié

Cette section est délibérément explicite. Le plan demande de signaler les
critères non atteints plutôt que de les présenter comme acquis.

### Concurrence PostgreSQL — écrite, non exécutée

`test/pg/concurrency.test.js` couvre les scénarios que le plan exige :
écritures perdues, isolation entre pools, deux choix sur un même tour, réessais
idempotents séquentiels et simultanés, identifiant recyclé, annulation après
panne injectée, déduplication, salon instantané depuis une file vide, dernière
place, double finalisation, révision, révocation de session, suppression en
cascade d'un pool et d'un compte, dérive du registre.

**Aucun PostgreSQL n'est joignable dans cet environnement** (`psql` absent,
Docker indisponible, port 5432 fermé). La suite s'ignore proprement et dit
pourquoi. Elle n'a donc **jamais tourné**.

> Le verrouillage, l'isolation transactionnelle et les contraintes d'unicité
> ne sont pas prouvés. Les tests unitaires vérifient la logique au-dessus d'une
> base simulée ; ils ne peuvent pas prouver un verrou.

À exécuter avant toute mise en service :

```
TEST_DATABASE_URL=postgres://…/fantazy_test npm run test:pg
```

### Deux processus

Le plan demande de tester la file instantanée « à travers deux processus
applicatifs ». Non fait, pour la même raison. Par ailleurs, **la présence du
salon vit en mémoire du processus** : avec plusieurs instances, chacune ne voit
que ses propres sockets. L'état durable est en base et le démarrage est
revalidé sous verrou, donc rien ne se casse — mais un salon peut tarder à
partir. Passer à plusieurs instances demande un adaptateur Socket.IO partagé.

### Accessibilité et mobile

Ce qui a été fait sur les surfaces ajoutées (bande de priorité, marché des
échanges) : éléments natifs, focus visible, cibles d'au moins 44 × 44 pixels,
`prefers-reduced-motion`, mise en page qui se replie sous 480 px, couleur
jamais seule porteuse de sens.

Ce qui n'a **pas** été fait, faute de navigateur dans cet environnement :

- aucune mesure de contraste dans les deux thèmes ;
- aucun essai à 320, 360, 390 et 430 pixels CSS réels ;
- aucun essai sur iOS Safari ni Android Chrome ;
- aucun passage au clavier, au lecteur d'écran, ni au zoom.

> Aucune conformité WCAG n'est revendiquée pour ces écrans.

### Décisions produit encore ouvertes

Conformément à la section 13 du plan, le comportement actuel est **préservé** :

1. **Délai et absence au repêchage instantané.** Le saut réservé au créateur
   après trois minutes reste tel quel. Il ne garantit pas qu'un repêchage entre
   inconnus se termine, et un tour sauté n'a pas de mécanisme de remplissage.
   Ne pas promouvoir le jeu instantané auprès d'inconnus avant d'avoir tranché.
2. **Attribution historique des alignements.** La règle reste
   « alignement courant appliqué à la période », désormais annoncée dans
   `rosterBasis`. Les résultats finalisés sont figés, ce qui protège l'histoire
   close ; les fenêtres glissantes et le temple de la renommée, non.
3. **Rétention.** 180 jours pour les notifications, 365 pour l'activité,
   30 jours pour les sessions et opérations expirées. Chiffres proposés, à
   confirmer avant mise en service.

### Autres réserves

- **Le mode fichier n'est pas à parité.** Échanges, finalisation, notifications
  durables et récaps exigent PostgreSQL et le disent. La liste des sessions y
  vit en mémoire : elles ne survivent pas au redémarrage.
- **Les données de blessures viennent d'ESPN**, pas d'un flux officiel de la
  LNH. Inchangé, et aucune alerte n'en est dérivée.
- **`/api/me/today` n'a pas de mesure de référence.** Le plan demande de
  compter requêtes, octets et latence avant de fixer des budgets. Non fait.
  L'invariant qualitatif tient : aucune requête sortante par joueur, et le
  nombre de requêtes ne grandit pas avec la taille des alignements.
- **Les anciens appels du client passent encore `adminToken`** dans quelques
  pages. Le serveur l'ignore ; c'est du poids mort, pas une faille.

---

## 7. Fichiers ajoutés

```
lib/       authz, dates, events, migrations, poolOps, priority, recap, session
services/  calendrierLNH, diffusion, h2h, poolStore, presence, recap, scoring, today
routes/    draft, h2h, identity, instantDraft, notifications, pools, records,
           today, trades
middleware/ auth, staticAssets
migrations/ 0001 à 0007
test/      fixtures/routeHarness, integration/client, pg/concurrency, 12 suites
racine     fzToday.js, fzToday.css, tradeMarket.css, migrate.js
```

`server.js` passe de 6 922 à 4 128 lignes. Ce qui y reste : les
statistiques de la LNH, les caches, le calendrier, les travaux de fond, et la
composition.
