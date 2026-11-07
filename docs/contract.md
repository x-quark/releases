# Contrat de distribution

Ce contrat s’applique à toute application distribuée par `x-quark/releases`, que son code source
vive dans l’organisation `x-quark` ou dans une autre organisation de Max. Les copies installées des
applications en dépendent : une adresse publiée ne change plus.

`scripts/dist.mjs` l’applique et le vérifie ; ce document en est la référence.

## 1. Identifiant d’application

`<app>` identifie l’application dans les noms de releases et les adresses : minuscules, chiffres et
tirets (`rplace`, `x-tools`, `cosmos`), sans segment `-v<chiffre>`. Par défaut, c’est le nom du dépôt
source. Il est unique dans ce dépôt, toutes organisations confondues : en cas de doublon, en convenir
avec Max avant la première publication. Il ne change jamais.

## 2. Release de version `<app>-vX.Y.Z`

| Élément | Règle |
| --- | --- |
| Tag | `<app>-vX.Y.Z`, version SemVer stable, sans préversion |
| Titre | `<Nom> X.Y.Z` |
| Notes | Section de la version dans le journal des versions de l’application, en français |
| Fichiers | Installeurs et paquets sous leur nom versionné, signatures de mise à jour (`.sig`), manifestes, `SHA256SUMS.txt` |
| Latest | Jamais demandé (`--latest=false`) |

`SHA256SUMS.txt` couvre tous les autres fichiers de la release ; l’outil le génère s’il n’est pas
fourni. Une release de version publiée ne change plus : un fichier faux se corrige en publiant une
nouvelle version.

## 3. Canal `<app>`

| Élément | Règle |
| --- | --- |
| Tag | `<app>`, créé à la première publication ; jamais supprimé, renommé ni déplacé |
| Titre | `<Nom> X.Y.Z (dernière version)` |
| Fichiers à nom fixe | Copies exactes de fichiers de la dernière version, sans numéro de version dans le nom |
| Manifestes | Copies exactes des manifestes de la dernière version |
| Notes | Générées : liens vers la version, l’historique et les téléchargements permanents |

Noms fixes recommandés : `<Nom>-setup.exe` pour l’installeur Windows, `<Nom>-android.apk` pour
Android. Un nom fixe est un lien permanent : il se choisit une fois. Un fichier du canal qui ne fait
plus partie des publications reste en place, pour ne casser aucun lien.

Adresses permanentes :

| Usage | Adresse |
| --- | --- |
| Téléchargement | `https://github.com/x-quark/releases/releases/download/<app>/<NomFixe>` |
| Mises à jour | `https://github.com/x-quark/releases/releases/download/<app>/latest.json` |
| Historique | `https://github.com/x-quark/releases/releases?q=<app>` |

## 4. Manifeste de mise à jour

Format statique du plugin de mise à jour de Tauri (`version`, `notes`, `pub_date`, `platforms`),
JSON UTF-8 sans BOM. Une application peut y ajouter ses propres champs, par exemple `versionCode`
pour Android.

- `version` est la version publiée.
- Chaque plateforme porte sa `signature` : le contenu du fichier `.sig`.
- Chaque `url` est l’adresse publique d’un fichier de la release de version :
  `https://github.com/x-quark/releases/releases/download/<app>-vX.Y.Z/<fichier>`.

Interdits dans un manifeste : une adresse `api.github.com` (60 requêtes par heure sans jeton), une
adresse de dépôt privé, une adresse vers le canal ou vers une autre version.

## 5. Signature et clés

- Chaque application a sa propre clé de mise à jour (minisign).
- La clé publique est dans la configuration de l’application ; la clé privée reste hors de tout
  dépôt, sur la machine de publication, et doit être sauvegardée : la perdre arrête les mises à jour
  de toutes les installations.
- Aucune application n’embarque ni ne demande de jeton GitHub pour se mettre à jour.
- L’application vérifie la signature avant d’installer : un fichier modifié dans ce dépôt serait
  refusé.

## 6. Ordre de publication

1. Release de version complète, `SHA256SUMS.txt` compris.
2. Fichiers à nom fixe du canal.
3. Manifestes du canal, en dernier : ils n’annoncent jamais un fichier absent.
4. Titre et notes du canal.

Un canal ne revient jamais à une version plus ancienne. Le remplacement d’un fichier du canal le rend
indisponible quelques secondes : une application traite un échec de lecture du manifeste comme
« pas de mise à jour » et réessaie plus tard, sans afficher d’erreur.

## 7. Dans le dépôt de l’application

- Tag `vX.Y.Z` (ou le préfixe propre au dépôt) sur le commit publié.
- Journal des versions, dont la section de la version sert de notes.
- Lien de téléchargement permanent dans `README.md` et `README.fr.md`.
- Endpoint du canal et clé publique dans la configuration de mise à jour.
- Une archive privée des builds dans le dépôt de l’application est permise, jamais à la place de la
  distribution publique.

## 8. Catalogue

Toute application qui a un canal a sa ligne dans le catalogue de `README.md` et de `README.fr.md`,
avec son lien de téléchargement permanent. `node scripts/dist.mjs check` le vérifie.

## 9. Évolution du contrat

Un changement de ce contrat passe par une PR de ce dépôt, avec l’accord de Max, et reste compatible
avec les applications déjà installées : il ajoute, il ne déplace pas d’adresse. Les options de
`scripts/dist.mjs` suivent la même règle.
