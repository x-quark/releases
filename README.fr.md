# x-quark releases

[English](./README.md) · **Français**

Téléchargements publics et canaux de mise à jour des applications x-quark. Leur code source est
privé : ce dépôt ne distribue que les installeurs, les signatures et les manifestes de mise à jour.

## Catalogue

| Application | Plateformes | Télécharger | Versions |
| --- | --- | --- | --- |
| **Live** : un regard clair sur vos agents IA, ce qui tourne, ce qui attend votre intervention et ce qui est terminé, avec notifications | Windows 10/11 (x64), Android 8+ | [Live-setup.exe](https://github.com/x-quark/releases/releases/download/live/Live-setup.exe) · [Live-android.apk](https://github.com/x-quark/releases/releases/download/live/Live-android.apk) | [Historique](https://github.com/x-quark/releases/releases?q=live) |
| **Pills** : vos traitements au bon moment : prises en un geste, durées d’action, rappels et historique, synchronisés avec votre compte ChatGPT | Windows 10/11 (x64), Android 8+ | [Pills-setup.exe](https://github.com/x-quark/releases/releases/download/pills/Pills-setup.exe) · [Pills-android.apk](https://github.com/x-quark/releases/releases/download/pills/Pills-android.apk) | [Historique](https://github.com/x-quark/releases/releases?q=pills) |
| **Popcorn** : les envies de films et de séries d’un foyer, de la demande à l’arrivée sur Plex, avec notifications | Windows 10/11 (x64), Android 8+ | [Popcorn-setup.exe](https://github.com/x-quark/releases/releases/download/popcorn/Popcorn-setup.exe) · [Popcorn-android.apk](https://github.com/x-quark/releases/releases/download/popcorn/Popcorn-android.apk) | [Historique](https://github.com/x-quark/releases/releases?q=popcorn) |
| **Rplace** : corrige les erreurs de dictée du texte sélectionné, dans n’importe quelle application Windows | Windows 10/11 (x64) | [Rplace-setup.exe](https://github.com/x-quark/releases/releases/download/rplace/Rplace-setup.exe) | [Historique](https://github.com/x-quark/releases/releases?q=rplace) |
| **x-tools** : utilitaires hors ligne pour le texte, le code, les données et le design, les mêmes sur le Web et dans l’app native | Windows 10/11 (x64), Android 7+ | [x-tools-setup.exe](https://github.com/x-quark/releases/releases/download/x-tools/x-tools-setup.exe) · [x-tools-android.apk](https://github.com/x-quark/releases/releases/download/x-tools/x-tools-android.apk) | [Historique](https://github.com/x-quark/releases/releases?q=x-tools) |

Les liens de téléchargement ne changent jamais : ils donnent toujours la dernière version.

## Organisation des releases

Chaque application, identifiée par un nom court comme `rplace`, publie deux sortes de releases :

| Release | Exemple | Contenu |
| --- | --- | --- |
| Version | `rplace-v1.0.1` | Installeurs, signatures de mise à jour, manifeste, `SHA256SUMS.txt` et notes d’une version. Jamais modifiée une fois publiée. |
| Canal | `rplace` | Release permanente au nom de l’application : les derniers installeurs sous un nom fixe, et le manifeste que les copies installées lisent pour se mettre à jour. |

Le badge *Latest* de GitHub sur ce dépôt ne reflète que la dernière publication, quelle que soit
l’application : ne jamais s’appuyer sur `/releases/latest`.

## Vérifier un téléchargement

Comparer l’empreinte SHA-256 du fichier téléchargé avec la ligne de son installeur versionné dans
le `SHA256SUMS.txt` de la release de version (l’installeur à nom fixe en est une copie exacte) :

```powershell
Get-FileHash .\Rplace-setup.exe -Algorithm SHA256
```

Les installeurs ne sont pas signés par un certificat de signature de code : Windows SmartScreen
peut afficher « Windows a protégé votre ordinateur » (Informations complémentaires, puis Exécuter
quand même). Les mises à jour automatiques sont signées : chaque application vérifie chaque mise à
jour avec sa propre clé publique avant de l’installer, et refuserait un fichier modifié ici.

## Maintenance

- [Contrat de distribution](docs/contract.md) : noms, fichiers, manifestes et règles.
- [Publier une application](docs/publishing.md) : une commande, lancée en local depuis le dépôt de
  l’application.
- [ADR 0001](journal/decisions/0001-shared-public-distribution.md) : pourquoi un dépôt public commun.
- Agents : [AGENTS.md](AGENTS.md).

```bash
node --test                      # tests de l’outil de distribution
node scripts/dist.mjs check      # contrôle anonyme de tous les canaux et de ce catalogue
```

© x-quark. Tous droits réservés. Chaque installeur contient les mentions de ses composants tiers.
