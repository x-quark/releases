# ADR 0001 — Distribuer les applications par un dépôt public commun

- **Statut :** acceptée
- **Date :** 2026-11-07
- **Décideur :** Max

## Contexte

Les dépôts des applications de Max, dans l’organisation x-quark comme dans ses autres
organisations, sont privés. Leurs releases ne sont pas accessibles sans
authentification : pas de lien de téléchargement public, et le plugin de mise à jour de Tauri ne
peut pas lire `latest.json` sans jeton. Des applications ont contourné le problème avec un jeton
GitHub en lecture saisi dans l’application ; d’autres ont envisagé de rendre leur dépôt public ou
de créer chacune un dépôt miroir public.

## Décision

Créer le dépôt public `x-quark/releases`, commun à toutes les applications de Max quelle que soit
l’organisation de leur code source, qui ne contient que les fichiers distribués, le contrat de
distribution et l’outil de publication.

Chaque application y publie une release de version `<app>-vX.Y.Z` et tient à jour son canal `<app>`,
release permanente qui porte ses fichiers à nom fixe et son manifeste de mise à jour. L’outil
`scripts/dist.mjs` applique le contrat ; les dépôts d’applications l’appellent à un SHA de commit
épinglé. La publication reste locale.

## Options évaluées

### Rendre public le dépôt de chaque application

Rejetée : expose le code source, son historique et la documentation interne.

### Un dépôt miroir public par application

Rejetée : multiplie les dépôts, réglages et jetons sans rien apporter de plus qu’un dépôt commun.

### Un dépôt de distribution par organisation

Rejetée par Max : un seul point de distribution, un seul outil et un seul catalogue pour toutes ses
applications.

### Jeton GitHub dans l’application

Rejetée : chaque utilisateur devrait créer un jeton, et un jeton embarqué serait public.

### Adresse `/releases/latest/download`

Rejetée : dans un dépôt partagé, « Latest » désigne une seule release pour tout le dépôt. D’où le
canal par application.

### GitHub Pages ou hébergement externe pour les manifestes

Différée : un service de plus à maintenir, alors que les releases suffisent.

## Conséquences

### Positives

- Liens de téléchargement et mises à jour publics, sans jeton et sans exposer de code
- Une convention, un outil et un contrôle pour toutes les applications
- Chaque application garde sa clé de signature : un fichier modifié ici serait refusé à l’installation

### Négatives

- Le badge « Latest » de GitHub n’a pas de sens dans ce dépôt
- Un canal supprimé coupe les mises à jour de son application jusqu’à sa recréation ; les tags sont
  protégés par une règle du dépôt
- Les releases ne peuvent pas être rendues immuables par GitHub, car le canal est réécrit à chaque
  version : l’immuabilité des versions repose sur l’outil, qui refuse toute modification, et sur les
  signatures
- Les copies installées qui lisaient une autre adresse doivent recevoir une version de transition
  publiée aux deux endroits

## Vérification

Rplace 1.0.1, publiée le 2026-11-07 : téléchargement anonyme du canal identique au build local, puis
mise à jour automatique réelle d’une installation 1.0.0 vers 1.0.1 depuis le canal.
