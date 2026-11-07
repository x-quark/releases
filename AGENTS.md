# AGENTS.md

Ce fichier fait autorité pour tout agent qui travaille dans `x-quark/releases` **ou qui publie une
application x-quark** depuis un autre dépôt.

## 1. Mission

`x-quark/releases` est le point de distribution public des applications x-quark dont le code source
reste privé : installeurs, signatures, empreintes et manifestes de mise à jour. Le dépôt ne contient
que le contrat de distribution, l’outil qui l’applique et les releases.

Il n’héberge ni code produit, ni secret, ni clé privée, ni build de développement.

## 2. Décision de distribution

- Ne jamais rendre public le dépôt d’une application pour distribuer ses binaires.
- Ne jamais créer de dépôt miroir public par application.
- Ne jamais embarquer de jeton GitHub dans une application, ni demander à un utilisateur d’en créer
  un pour recevoir les mises à jour.
- Toute application qui a besoin d’un téléchargement public ou de mises à jour automatiques publie
  ici, selon le contrat.

Justification : [ADR 0001](journal/decisions/0001-shared-public-distribution.md).

## 3. Contrat

Le contrat complet est [docs/contract.md](docs/contract.md). L’essentiel :

- `<app>` : identifiant court et stable, en minuscules (`rplace`, `x-tools`, `cosmos`).
- Release de version `<app>-vX.Y.Z` : tous les fichiers de la version ; jamais modifiée.
- Canal `<app>` : release permanente, fichiers à nom fixe sans numéro de version
  (`Rplace-setup.exe`) et manifeste `latest.json` ; jamais supprimé, renommé ni vidé.
- Les applications lisent `https://github.com/x-quark/releases/releases/download/<app>/latest.json` ;
  les `url` du manifeste visent `…/releases/download/<app>-vX.Y.Z/<fichier>`, jamais
  `api.github.com` ni un dépôt privé.
- Ordre : version complète, puis fichiers à nom fixe, puis manifestes, en dernier.
- Jamais de release « Latest » demandée ; ne jamais utiliser `/releases/latest`.

## 4. Publier

- Toujours passer par `scripts/dist.mjs publish`, téléchargé par le dépôt de l’application à un SHA
  de commit complet de ce dépôt, jamais `main` : [docs/publishing.md](docs/publishing.md).
- Publier en local, sur la machine de Max, avec `gh` connecté. Pas de CI sans demande explicite.
- Ne jamais publier une version sans l’accord explicite de Max pour cette version.
- Toujours essayer d’abord avec `--dry-run`.
- Après une publication : `node scripts/dist.mjs check --app <app>`.
- Première publication : ligne du catalogue dans `README.md` et `README.fr.md`, par PR ici.
- Application qui publiait ailleurs : version de transition publiée aux deux endroits
  ([docs/publishing.md §5](docs/publishing.md#5-migrer-une-application-qui-publiait-ailleurs)).

## 5. Interdits

- Supprimer, renommer, vider ou repasser en brouillon un canal ; supprimer ou déplacer un tag.
- Remplacer ou supprimer un fichier d’une release de version publiée : corriger, c’est publier une
  nouvelle version.
- Faire reculer un canal vers une version plus ancienne.
- Publier un build de développement, ou une version dont les fichiers ne correspondent pas au tag.
- Mettre dans une release ou ses notes un secret, un jeton, un chemin local, une donnée personnelle
  ou un lien vers un dépôt privé.
- Contourner une vérification de l’outil : si le contrat ne convient pas à une application, le dire
  à Max et faire évoluer le contrat par PR.

## 6. Architecture

| Chemin | Rôle |
| --- | --- |
| `scripts/dist.mjs` | Publication et contrôle : un seul fichier, Node ≥ 20, sans dépendance, écritures par `gh` |
| `tests/` | Tests `node:test` de l’outil, sans réseau |
| `docs/contract.md` | Contrat de distribution |
| `docs/publishing.md` | Procédure, migration, incidents |
| `journal/decisions/` | ADR |

L’outil reste un fichier unique : les dépôts d’applications le téléchargent seul. Ses options et ses
sorties restent compatibles ; une évolution ajoute, elle ne renomme pas.

## 7. Langues et Git

- `README.md` anglais canonique et `README.fr.md` français, même structure et mêmes faits.
- Documentation interne en français ; code, commentaires, commits et titres de PR en anglais ;
  messages de l’outil en français.
- Commits en Conventional Commits avec scope : `tool`, `contract`, `catalog`, `repo`.
- `main` n’avance que par PR ; ne jamais merger sans l’accord de Max.

## 8. Vérification

```bash
node --test
node scripts/dist.mjs check
git diff --check
```

Distinguer les tests locaux, sans réseau, du contrôle `check`, qui lit les releases réelles.
