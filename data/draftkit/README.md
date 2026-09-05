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

## Divergences internes aux documents

Sur 448 « meilleurs choix » des pages d'équipe, 436 reprennent exactement la
projection de la feuille du bassin. Les 12 restants diffèrent dans le document
lui-même — par exemple Connor Bedard, 78 points sur la page de Chicago contre 68
dans `draftkit-fr-p.xlsx`. Le code n'arbitre pas : la feuille du bassin fait foi
pour les statistiques d'un joueur (c'est « la liste complète » demandée), et les
chiffres de la page d'équipe restent tels quels dans `guides[].topPicks`, comme
citation du guide.

## Blessures

Le drapeau `injuryFlag` de chaque fiche vient de la légende de la trousse
(`° Blessure`), et `guides[].lineup.injuries` reprend la case « Notes /
Blessures / Contrats » de chaque page d'équipe. C'est **distinct** du rapport de
blessures en direct (`GET /nhl-injuries`, alimenté par ESPN), qui reste la source
de la pastille « indisponible » : la trousse est une photo prise à sa date de
publication, le rapport suit la saison.
