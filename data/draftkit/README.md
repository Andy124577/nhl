# Trousse de repêchage 2026-2027 — source de vérité du repêchage

Les documents de ce dossier sont **la** référence pour le bassin de joueurs, les
gardiens, les équipes, les projections, les alignements et les notes de
repêchage. Aucune API externe (ni ESPN, ni api-web.nhle.com) n'alimente ces
listes.

## Fichiers

| Fichier | Contenu |
| --- | --- |
| `draftkit-fr-p.xlsx` | Bassin complet des patineurs — 919 joueurs, saison dernière **et** projections 2026-2027 |
| `draftkit-fr-g.xlsx` | Gardiens — 94, saison dernière et projections |
| `draftkit-fr-t.xlsx` | Équipes — 32, saison dernière et projections |
| `draftkit-fr.pdf` | Les 32 pages d'équipe : meilleurs choix, alignement projeté, blessures, notes |
| `draftkit-fr.txt` | Le texte de `draftkit-fr.pdf`, extrait une fois et versionné |

`draftkit-fr.txt` est versionné pour que la génération n'exige aucun outil PDF.
Pour le refaire après une mise à jour du PDF :

```sh
pdftotext -layout -enc UTF-8 draftkit-fr.pdf draftkit-fr.txt
```

Les `.xlsx` sont lus directement (`tools/xlsx.js` : le format n'est qu'un ZIP de
XML, et `zlib` suffit — aucune dépendance npm ajoutée).

## Génération

```sh
node tools/build_draftkit.js
```

Produit, à la racine :

* `draftkit.json` — la trousse entière (bassin, gardiens, équipes, guides des 32
  équipes, liste « À surveiller »). Lue par la salle de repêchage.
* `draftkit-watchlist.json` — la seule liste « À surveiller ». Lue par l'accueil,
  qui n'a pas besoin du reste.

Le script imprime un avertissement pour chaque nom du guide qu'il n'arrive pas à
rapprocher du bassin. Deux sont attendus et normaux — la trousse discute dans
« Espoirs à Surveiller » deux joueurs que sa propre liste ne contient pas :

```
ANA: espoirsASurveiller note "Roger McQueen" not found in the player pool
TBL: espoirsASurveiller note "Benjamin Rautiainen" not found in the player pool
```

Deux autres signalent une contradiction **entre les documents eux-mêmes** — les
pages d'équipe et les feuilles du bassin sont deux exports distincts, sans doute
séparés par un échange :

```
LAK: the team page lists Hunter Brzustewicz under espoirsASurveiller, but the pool sheet has him on CGY
NSH: the team page lists Luke Evangelista under joueursASurveiller, but the pool sheet has him on NJD
```

Le cas de Luke Evangelista mérite un œil : la page de Nashville le nomme trois
fois (meilleurs choix, premier trio, note « on croit à Nashville »), la page du
New Jersey jamais, mais `draftkit-fr-p.xlsx` l'inscrit à NJD. Le code n'arbitre
pas : la fiche du joueur garde NJD (la feuille du bassin fait foi), la note reste
sur la page où elle a été écrite, et `teamConflict` porte l'autre valeur.
À trancher à la main si la trousse est corrigée en amont.

Tout autre avertissement signale une vraie dérive entre les documents et le
code, et doit être corrigé avant de livrer le JSON régénéré.

## Deux saisons, à ne jamais confondre

Chaque fiche porte deux blocs :

* `lastSeason` — ce que le joueur a **réellement** fait la saison dernière ;
* `projection` — ce que la trousse **prévoit** pour 2026-2027.

Le repêchage affiche la **projection** : c'est sur elle qu'on repêche. La saison
dernière ne sert que de référence historique et ne doit jamais être présentée
comme une prévision. Côté client, `FZDraftKit.pools('projection')` (défaut) et
`FZDraftKit.pools('lastSeason')` rendent les deux, et chaque fiche garde les deux
blocs pour l'affichage comparatif.

## Recrues

La trousse n'a pas de colonne « recrue ». Le drapeau `rookie` est calculé, sur
les deux seuls indices qu'elle donne — les matchs joués **la saison dernière**
et l'âge :

```
rookie = âge <= 23  ET  (aucun match l'an dernier  OU  27 matchs ou moins)
```

Deux pièges, tous deux rencontrés :

* **Une case de matchs vide ne veut pas dire « à écarter »** — elle veut dire
  « aucun match dans la LNH l'an dernier », c'est-à-dire la recrue la plus
  certaine du lot : Gavin McKenna, Ivar Stenberg, Roman Kantserov,
  Sebastian Cossa.
* **Les gardiens comptent aussi.** Jacob Fowler et Sebastian Cossa sont des
  recrues ; l'onglet « Recrues » du repêchage liste patineurs et gardiens
  ensemble, d'où ses colonnes `B/V` et `A/%ARR` (buts/victoires,
  passes/% d'arrêts), la pastille de position indiquant la lecture qui
  s'applique.

L'âge est indispensable : sans lui, le seuil de matchs attrape les vétérans
blessés une saison entière — c'est pour cela que l'ancien code portait une
exception « Tyler Seguin » écrite en dur.

Total actuel : **94 patineurs et 6 gardiens**.

Deux joueurs signalés comme recrues ailleurs sont **absents des trois
documents** et ne peuvent donc pas être ajoutés depuis la trousse :
Viggo Björck (WPG) et Nikita Klepov (ANA).

## Divergences internes aux documents

Sur 448 « meilleurs choix » des pages d'équipe, 436 reprennent exactement la
projection de la feuille du bassin. Les 12 restants diffèrent dans le document
lui-même — par exemple Connor Bedard, 78 points sur la page de Chicago contre 68
dans `draftkit-fr-p.xlsx`. Le code n'arbitre pas : la feuille du bassin fait foi
pour les statistiques d'un joueur (c'est « la liste complète » demandée), et les
chiffres de la page d'équipe restent tels quels dans `guides[].topPicks`, comme
citation du guide.

## Identifiants LNH

La trousse ne porte pas d'identifiant LNH ; l'application en a besoin pour la
photo (CDN de la LNH) et la fiche de carrière. Ils sont résolus **à la
génération** et écrits dans `draftkit.json`, où le diff les rend vérifiables,
plutôt que devinés dans le navigateur à chaque chargement. Deux fichiers sont
lus pour cela — `nhl_filtered_stats.json` et `current_stats.json` — et
uniquement pour les identifiants, jamais pour les statistiques.

Actuellement : **497 des 1013 joueurs** ont un identifiant. Les autres n'ont
pas de photo, ce qui est sans conséquence pour le repêchage.

Trois règles gouvernent la résolution, et chacune répare un vrai dégât :

1. **Correspondance exacte du nom, jamais du seul nom de famille.** Rapprocher
   par le patronyme donnait Ryan Strome → Dylan Strome, Miles Wood → Matthew
   Wood, John Leonard → Ryan Leonard : des joueurs différents.
2. **Un nom ambigu se tranche par le club.** Il existe deux Sam Montembeault
   (MTL et CGY) ; celui de la trousse joue à Montréal. Ce qui reste ambigu
   reste sans identifiant.
3. **Les lignes fausses sont sur liste noire.** `current_stats.json` étiquette
   « Matt Savoie » la ligne 8467408, qui est en réalité celle de Matt Walker,
   retraité. Le vrai Matt Savoie — 22 ans, Edmonton, « Matthew Savoie » au
   registre de la LNH — portait donc le visage et l'identité d'un retraité.
   La liste vit dans `FZ_IDS_ERRONES` (`draftkitData.js`), que `headshots.js`
   et `draftActif.js` consultent aussi pour écarter ces lignes de leurs
   recherches par nom.

`ID_NAME_ALIASES` couvre les cas où la trousse et la LNH n'écrivent pas le même
nom pour la même personne — et **seulement** ceux-là, vérifiés un par un :

| Trousse | LNH |
| --- | --- |
| Matt Savoie | Matthew Savoie |
| Yegor Chinakhov | Egor Chinakhov |
| Benjamin Kindel | Ben Kindel |
| Dmitriy Simashev | Dmitri Simashev |

Un piège à ne pas ajouter : Vancouver aligne **deux** Elias Pettersson, un
attaquant et un défenseur, que la trousse distingue par « Elias-D Pettersson ».
Le défenseur reste volontairement sans identifiant plutôt que d'hériter de
celui de l'attaquant.

## Blessures

Le drapeau `injuryFlag` de chaque fiche vient de la légende de la trousse
(`° Blessure`), et `guides[].lineup.injuries` reprend la case « Notes /
Blessures / Contrats » de chaque page d'équipe. C'est **distinct** du rapport de
blessures en direct (`GET /nhl-injuries`, alimenté par ESPN), qui reste la source
de la pastille « indisponible » : la trousse est une photo prise à sa date de
publication, le rapport suit la saison.
