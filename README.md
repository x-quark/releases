# Téléchargements x-quark

Installeurs et mises à jour des applications x-quark. Le code source des applications est
privé : ce dépôt ne contient que les versions publiées.

| Application | Plateforme | Télécharger | Versions |
| --- | --- | --- | --- |
| **Rplace** — corrige vos erreurs de dictée en un raccourci, dans n’importe quelle application. | Windows 10/11 | [Rplace-setup.exe](https://github.com/x-quark/releases/releases/download/rplace/Rplace-setup.exe) | [Historique](https://github.com/x-quark/releases/releases?q=rplace) |

Les liens « Télécharger » donnent toujours la dernière version.

## Organisation

Pour chaque application, identifiée par un nom court (`rplace`…) :

| Release | Contenu |
| --- | --- |
| `app-vX.Y.Z` | Une par version : installeur(s), signature de mise à jour (`.sig`), empreintes `SHA256SUMS.txt`, notes de version. |
| `app` | Le **canal** de l’application, permanent : l’installeur de la dernière version sous un nom fixe, et `latest.json` que l’application installée consulte pour se mettre à jour. |

Adresse lue par les applications : `https://github.com/x-quark/releases/releases/download/<app>/latest.json`.
Elle ne doit jamais changer : les versions installées la gardent.

## Sécurité

Chaque application vérifie ses mises à jour avec sa propre clé publique (signature minisign) :
un fichier modifié ou remplacé ici serait refusé par les installations existantes. Ce dépôt ne
contient ni code source ni clé.

## Publier

Depuis le dépôt de l’application, en local, avec son script de release (aucun workflow ici) :
il crée la release `app-vX.Y.Z`, puis met à jour le canal `app` (dernier installeur et
`latest.json`) une fois les fichiers en ligne.
