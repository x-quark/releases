# x-quark releases

**English** · [Français](./README.fr.md)

Public downloads and update channels of x-quark applications. Their source code is private: this
repository only distributes installers, signatures and update manifests.

## Catalog

| Application | Platforms | Download | Versions |
| --- | --- | --- | --- |
| **Live**: a clear view of your AI agents, what is running, what needs you and what has finished, with notifications | Windows 10/11 (x64), Android 8+ | [Live-setup.exe](https://github.com/x-quark/releases/releases/download/live/Live-setup.exe) · [Live-android.apk](https://github.com/x-quark/releases/releases/download/live/Live-android.apk) | [History](https://github.com/x-quark/releases/releases?q=live) |
| **Popcorn**: movie and TV wishes of a household, from the request to its arrival on Plex, with notifications | Windows 10/11 (x64), Android 8+ | [Popcorn-setup.exe](https://github.com/x-quark/releases/releases/download/popcorn/Popcorn-setup.exe) · [Popcorn-android.apk](https://github.com/x-quark/releases/releases/download/popcorn/Popcorn-android.apk) | [History](https://github.com/x-quark/releases/releases?q=popcorn) |
| **Rplace**: fixes dictation errors in the selected text of any Windows application | Windows 10/11 (x64) | [Rplace-setup.exe](https://github.com/x-quark/releases/releases/download/rplace/Rplace-setup.exe) | [History](https://github.com/x-quark/releases/releases?q=rplace) |

Download links never change: they always serve the latest version.

## How releases are organized

Each application, identified by a short name such as `rplace`, publishes two kinds of releases:

| Release | Example | Contents |
| --- | --- | --- |
| Version | `rplace-v1.0.1` | Installers, update signatures, manifest, `SHA256SUMS.txt` and notes of one version. Never modified once published. |
| Channel | `rplace` | Permanent release named after the application: the latest installers under fixed names, and the manifest that installed copies read to update themselves. |

The *Latest* badge GitHub shows on this repository only reflects the last publication, whatever the
application: never rely on `/releases/latest`.

## Verifying a download

Compare the SHA-256 of the downloaded file with the line of its versioned installer in the
`SHA256SUMS.txt` of the version release (the fixed-name installer is an exact copy):

```powershell
Get-FileHash .\Rplace-setup.exe -Algorithm SHA256
```

Installers are not signed with a code-signing certificate: Windows SmartScreen may show "Windows
protected your PC" (More info, then Run anyway). Automatic updates are signed: each application
checks every update against its own public key before installing it, so a file altered here would be
rejected.

## Maintainers

- [Distribution contract](docs/contract.md): names, files, manifests and rules (French).
- [Publishing an application](docs/publishing.md): one command, run locally from the application
  repository (French).
- [ADR 0001](journal/decisions/0001-shared-public-distribution.md): why one shared public repository.
- Agents: [AGENTS.md](AGENTS.md).

```bash
node --test                      # tests of the distribution tool
node scripts/dist.mjs check      # audits every channel and this catalog, anonymously
```

© x-quark. All rights reserved. Each installer includes the notices of its third-party components.
