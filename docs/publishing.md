# Publier une application

La publication se fait en local, sur la machine de Max, depuis le dépôt de l’application : le
pipeline de l’application construit et signe, puis `dist.mjs publish` publie ici. Aucun workflow
GitHub Actions n’est nécessaire.

## 1. Prérequis

- Node.js 20 ou plus récent.
- GitHub CLI connecté avec un droit d’écriture sur `x-quark/releases` : `gh auth status`.
- Les fichiers de la version, construits et signés par le pipeline de l’application.
- L’accord explicite de Max pour publier cette version : une publication est publique et ne se
  retire pas proprement.

## 2. Récupérer l’outil, épinglé

Les dépôts d’applications ne copient pas l’outil : leur script de release le télécharge au moment
de publier, à un **SHA de commit complet** de ce dépôt, jamais `main`. Dernier SHA de l’outil :

```bash
gh api "repos/x-quark/releases/commits?path=scripts/dist.mjs&per_page=1" --jq ".[0].sha"
```

PowerShell :

```powershell
$distRef = '<SHA complet>'
$dist = Join-Path ([IO.Path]::GetTempPath()) "x-quark-dist-$distRef.mjs"
if (-not (Test-Path $dist)) {
    Invoke-WebRequest "https://raw.githubusercontent.com/x-quark/releases/$distRef/scripts/dist.mjs" -OutFile $dist
}
node $dist publish --app <app> ...
```

Node :

```js
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIST_REF = '<SHA complet>';
const dist = join(tmpdir(), `x-quark-dist-${DIST_REF}.mjs`);
if (!existsSync(dist)) {
  const response = await fetch(`https://raw.githubusercontent.com/x-quark/releases/${DIST_REF}/scripts/dist.mjs`);
  if (!response.ok) throw new Error(`dist.mjs : HTTP ${response.status}`);
  writeFileSync(dist, Buffer.from(await response.arrayBuffer()));
}
const { status } = spawnSync(process.execPath, [dist, 'publish', '--app', '<app>' /* … */], { stdio: 'inherit' });
if (status !== 0) process.exit(status ?? 1);
```

Changer de version de l’outil = changer ce SHA dans une PR de l’application, après lecture du diff
de `scripts/dist.mjs`.

## 3. Publier

```bash
node dist.mjs publish --app rplace --name Rplace --version 1.0.1 \
  --notes notes.md \
  --asset Rplace_1.0.1_x64-setup.exe --asset Rplace_1.0.1_x64-setup.exe.sig \
  --stable Rplace_1.0.1_x64-setup.exe=Rplace-setup.exe \
  --manifest latest.json
```

| Option | Rôle |
| --- | --- |
| `--app` | Identifiant de l’application (contrat §1) |
| `--name` | Nom affiché dans les titres des releases |
| `--version` | Version publiée, `X.Y.Z` |
| `--notes` | Notes de la version, Markdown en français |
| `--asset` | Fichier de la release de version ; répétable |
| `--stable` | `fichier=NomFixe` : copie du fichier dans le canal sous un nom fixe ; le fichier rejoint aussi la release de version ; répétable |
| `--manifest` | Manifeste de mise à jour, dans la release de version et dans le canal, envoyé en dernier ; répétable |
| `--dry-run` | Affiche ce qui serait fait, sans rien écrire |
| `--repo` | Dépôt de distribution, `x-quark/releases` par défaut |

L’outil :

1. vérifie les fichiers locaux, les noms, les manifestes et `SHA256SUMS.txt`, qu’il génère s’il
   n’est pas fourni ;
2. compare avec ce qui est en ligne, et refuse toute différence avec une version déjà publiée ou
   toute version plus ancienne que la dernière publiée ;
3. publie ce qui manque, dans l’ordre du contrat ;
4. relit le résultat comme un utilisateur anonyme : manifestes identiques, fichiers à nom fixe et
   adresses des manifestes téléchargeables ;
5. signale si l’application manque au catalogue.

Il est idempotent : après une interruption, relancer la même commande termine la publication ; si
tout est déjà en ligne, il ne fait rien.

## 4. Première publication d’une application

1. Choisir `<app>` et les noms fixes (contrat §1 et §3) : ils ne changeront plus.
2. Mise à jour automatique, si l’application en a une : créer sa clé, la sauvegarder, mettre la clé
   publique et l’endpoint `https://github.com/x-quark/releases/releases/download/<app>/latest.json`
   dans sa configuration.
3. Générer le manifeste avec les adresses de la release de version (contrat §4).
4. Ajouter le lien de téléchargement permanent aux README de l’application.
5. Essai : `dist.mjs publish … --dry-run`.
6. Publication, avec l’accord de Max.
7. PR dans ce dépôt : ligne du catalogue dans `README.md` et `README.fr.md`.
8. `node scripts/dist.mjs check --app <app>`.

## 5. Migrer une application qui publiait ailleurs

Les copies déjà installées interrogent toujours l’ancienne adresse. La première version qui lit le
canal, dite version de transition, se publie donc aux deux endroits : à l’ancien emplacement pour
que les installations existantes la reçoivent, puis ici. Les versions suivantes ne se publient plus
qu’ici.

Une application qui demandait un jeton GitHub pour se mettre à jour n’en a plus besoin : retirer ce
réglage, et le jeton déjà enregistré, dans la version de transition ou la suivante.

## 6. Vérifier

```bash
node scripts/dist.mjs check                 # tous les canaux et le catalogue
node scripts/dist.mjs check --app rplace    # une application
```

Pour chaque application : version la plus récente, `SHA256SUMS.txt` de chaque version, fichiers du
canal identiques à des fichiers de la dernière version, manifestes valides, téléchargements
anonymes, présence au catalogue. Le contrôle passe par `gh` s’il est connecté (brouillons visibles),
sinon par l’API publique.

## 7. Sessions cloud et CI

Une session cloud ou une CI n’a ni la clé de signature ni de droit d’écriture sur ce dépôt : elle
prépare le code et peut lancer `--dry-run`, la publication reste locale.

Si un workflow de publication devenait nécessaire, avec l’accord de Max : déclenchement manuel
uniquement, et jeton à droits fins `RELEASE_TOKEN` avec « Contents : lecture et écriture » sur
`x-quark/releases`, car le jeton par défaut d’Actions ne peut pas écrire dans un autre dépôt.

## 8. Incidents

| Situation | Que faire |
| --- | --- |
| Publication interrompue | Relancer la même commande |
| Fichier faux dans une version publiée | Publier une nouvelle version ; ne jamais remplacer le fichier |
| Canal supprimé par erreur | Relancer la publication de la dernière version : le canal est recréé sur son tag, protégé |
| Manifeste refusé par l’outil | Corriger sa génération dans le dépôt de l’application |
| Clé de mise à jour perdue | Nouvelle clé et nouvelle version ; les installations existantes se réinstallent à la main |
