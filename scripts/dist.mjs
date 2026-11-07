#!/usr/bin/env node
// Distribution tool of x-quark/releases. The contract lives in docs/contract.md.
//
//   node dist.mjs publish --app <app> --name <Name> --version <X.Y.Z> --notes <file>
//                         --asset <file>... [--stable <file>=<FixedName>]...
//                         [--manifest <file>]... [--repo <owner/name>] [--dry-run]
//   node dist.mjs check   [--app <app>] [--repo <owner/name>]
//
// `publish` is idempotent: it compares the local files with what is online, refuses any
// change to a published version, uploads what is missing in contract order (version
// release, channel fixed-name files, manifests last), then reads the result back as an
// anonymous user. `check` audits the channels and the catalog.
//
// Single file on purpose: application repositories download it at a pinned commit.
// No dependencies, Node >= 20; writes and authenticated reads go through the GitHub CLI.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_REPO = 'x-quark/releases';
export const SUMS_FILE = 'SHA256SUMS.txt';

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
const SEMVER = '(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)';
const APP_RE = new RegExp(`^${SLUG}$`);
const VERSION_RE = new RegExp(`^${SEMVER}$`);
const VERSION_TAG_RE = new RegExp(`^(${SLUG})-v(${SEMVER})$`);
const ASSET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const USER_AGENT = 'x-quark-dist';

/** Expected failure: reported without a stack trace. */
export class DistError extends Error {}

// --- Names -----------------------------------------------------------------------------

export function versionTag(app, version) {
  return `${app}-v${version}`;
}

export function downloadUrl(repo, tag, name) {
  return `https://github.com/${repo}/releases/download/${tag}/${name}`;
}

/** `<app>-vX.Y.Z` is a version release, `<app>` a channel; anything else is ignored. */
export function parseTag(tag) {
  const match = VERSION_TAG_RE.exec(tag);
  if (match) return { kind: 'version', app: match[1], version: match[2] };
  if (APP_RE.test(tag) && !/-v\d/.test(tag)) return { kind: 'channel', app: tag };
  return { kind: 'other' };
}

export function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

export function assertApp(app) {
  if (typeof app !== 'string' || !APP_RE.test(app) || /-v\d/.test(app)) {
    throw new DistError(
      `identifiant d’application invalide : « ${app ?? ''} » (minuscules, chiffres et tirets, sans segment -v<chiffre>)`,
    );
  }
}

export function assertVersion(version) {
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    throw new DistError(`version invalide : « ${version ?? ''} » (attendu X.Y.Z, sans préversion)`);
  }
}

export function assertAssetName(name) {
  if (!ASSET_RE.test(name)) {
    throw new DistError(`nom de fichier refusé : « ${name} » (lettres, chiffres, « . », « _ » et « - » uniquement)`);
  }
}

// --- Manifests, checksums, catalog -----------------------------------------------------

/** Every `url` value of a parsed manifest, at any depth. */
function collectUrls(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, out);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'url') out.push(item);
      else collectUrls(item, out);
    }
  }
  return out;
}

/**
 * Problems of an update manifest (Tauri static JSON and its x-quark variants): the
 * announced version, a signature per platform, and every `url` being the public
 * download address of a file of the version release.
 */
export function manifestProblems(name, text, { repo, app, version, assetNames }) {
  if (!name.endsWith('.json')) return [`${name} : seuls les manifestes JSON sont pris en charge`];
  if (text.charCodeAt(0) === 0xfeff) return [`${name} : commence par un BOM UTF-8, illisible par les applications`];
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return [`${name} : JSON invalide (${error.message})`];
  }
  const problems = [];
  if (typeof data?.version === 'string' && data.version.replace(/^v/, '') !== version) {
    problems.push(`${name} : annonce la version ${data.version} au lieu de ${version}`);
  }
  if (data?.platforms !== undefined) {
    const entries = data.platforms && typeof data.platforms === 'object' ? Object.entries(data.platforms) : [];
    if (!entries.length) problems.push(`${name} : « platforms » vide`);
    for (const [platform, entry] of entries) {
      if (typeof entry?.signature !== 'string' || !entry.signature.trim()) {
        problems.push(`${name} : signature manquante pour ${platform}`);
      }
    }
  }
  const tag = versionTag(app, version);
  const prefix = downloadUrl(repo, tag, '');
  const urls = collectUrls(data);
  if (!urls.length) problems.push(`${name} : aucune adresse « url »`);
  for (const url of urls) {
    if (typeof url !== 'string' || !url.startsWith(prefix)) {
      problems.push(`${name} : adresse hors de ${tag} : ${String(url)}`);
    } else if (!assetNames.has(url.slice(prefix.length))) {
      problems.push(`${name} : ${url} ne correspond à aucun fichier de ${tag}`);
    }
  }
  return problems;
}

function manifestUrls(text) {
  return collectUrls(JSON.parse(text)).filter((url) => typeof url === 'string');
}

const hex = (digest) => String(digest).replace(/^sha256:/, '');
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function parseSums(text) {
  const sums = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim());
    if (match) sums.set(match[2].trim(), match[1].toLowerCase());
  }
  return sums;
}

/** SHA256SUMS.txt for the given files, sorted by name so that re-runs are identical. */
export function sumsText(files) {
  const lines = files
    .filter((file) => file.name !== SUMS_FILE)
    .sort(byName)
    .map((file) => `${hex(file.digest)}  ${file.name}`);
  return `${lines.join('\n')}\n`;
}

/** Files (local or online, with a `sha256:` digest) that a SHA256SUMS.txt does not cover. */
export function sumsProblems(text, files) {
  const sums = parseSums(text);
  const problems = [];
  for (const file of files) {
    if (file.name === SUMS_FILE) continue;
    const expected = sums.get(file.name);
    if (!expected) problems.push(`${file.name} absent de ${SUMS_FILE}`);
    else if (!file.digest || expected !== hex(file.digest)) problems.push(`empreinte de ${file.name} fausse dans ${SUMS_FILE}`);
  }
  return problems;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every application with a channel must appear in each README with its permanent
 * download link; with `orphans`, no link may target a missing channel.
 */
export function catalogProblems(repo, channels, readmes, { orphans = true } = {}) {
  const pattern = new RegExp(`https://github\\.com/${escapeRegExp(repo)}/releases/download/(${SLUG})/`, 'g');
  const problems = [];
  for (const { name, text } of readmes) {
    const listed = new Set([...text.matchAll(pattern)].map((match) => match[1]));
    for (const app of channels) {
      if (!listed.has(app)) problems.push(`${name} : ${app} absent du catalogue`);
    }
    if (!orphans) continue;
    for (const app of listed) {
      if (!channels.includes(app)) problems.push(`${name} : lien vers un canal inexistant (${app})`);
    }
  }
  return problems;
}

// --- Publication plan (pure) -----------------------------------------------------------

function readLocal(path, name = basename(path)) {
  const full = resolve(path);
  if (!existsSync(full) || !statSync(full).isFile()) throw new DistError(`fichier introuvable : ${path}`);
  assertAssetName(name);
  const bytes = readFileSync(full);
  return { path: full, name, size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
}

function assertUnique(names, where) {
  const seen = new Set();
  for (const name of names) {
    if (seen.has(name)) throw new DistError(`${where} : « ${name} » apparaît deux fois`);
    seen.add(name);
  }
}

/**
 * Validates a publication from its options and local files, without network access.
 * Writes SHA256SUMS.txt into `workDir` when the caller does not provide one.
 */
export function preparePublication(options, workDir) {
  const repo = options.repo ?? DEFAULT_REPO;
  if (!REPO_RE.test(repo)) throw new DistError(`dépôt invalide : ${repo}`);
  assertApp(options.app);
  assertVersion(options.version);
  const name = options.name?.trim();
  if (!name) throw new DistError('--name est obligatoire (nom affiché de l’application)');
  if (!options.notes) throw new DistError('--notes est obligatoire (notes de version en Markdown)');
  if (!existsSync(options.notes)) throw new DistError(`fichier introuvable : ${options.notes}`);
  const notes = readFileSync(options.notes, 'utf8').replace(/\r\n/g, '\n').trim();
  if (!notes) throw new DistError('les notes de version sont vides');

  const assets = (options.assets ?? []).map((path) => readLocal(path));
  const stable = (options.stable ?? []).map((spec) => {
    const at = spec.lastIndexOf('=');
    if (at <= 0 || at === spec.length - 1) throw new DistError(`--stable attend <fichier>=<NomFixe> : ${spec}`);
    const source = readLocal(spec.slice(0, at));
    const fixed = spec.slice(at + 1);
    assertAssetName(fixed);
    if (fixed.includes(options.version)) {
      throw new DistError(`le nom fixe « ${fixed} » contient la version : il doit rester le même d’une version à l’autre`);
    }
    if (!assets.some((asset) => asset.path === source.path)) assets.push(source);
    return { ...source, name: fixed };
  });
  const manifests = (options.manifests ?? []).map((path) => ({ ...readLocal(path), text: readFileSync(path, 'utf8') }));
  if (!stable.length && !manifests.length) {
    throw new DistError('le canal a besoin d’au moins un --stable ou un --manifest');
  }

  let versionFiles = [...assets, ...manifests];
  const sums = versionFiles.find((file) => file.name === SUMS_FILE);
  if (sums) {
    const problems = sumsProblems(readFileSync(sums.path, 'utf8'), versionFiles);
    if (problems.length) throw new DistError(`${SUMS_FILE} fourni incomplet :\n  ${problems.join('\n  ')}`);
  } else {
    const path = join(workDir, SUMS_FILE);
    writeFileSync(path, sumsText(versionFiles));
    versionFiles = [...versionFiles, readLocal(path)];
  }
  assertUnique(versionFiles.map((file) => file.name), 'release de version');
  assertUnique([...stable, ...manifests].map((file) => file.name), 'canal');

  const assetNames = new Set(versionFiles.map((file) => file.name));
  const problems = manifests.flatMap((file) =>
    manifestProblems(file.name, file.text, { repo, app: options.app, version: options.version, assetNames }),
  );
  if (problems.length) throw new DistError(`manifeste refusé :\n  ${problems.join('\n  ')}`);

  return {
    repo,
    app: options.app,
    name,
    version: options.version,
    tag: versionTag(options.app, options.version),
    notes,
    versionFiles,
    stable,
    manifests,
  };
}

export function channelTitle(pub) {
  return `${pub.name} ${pub.version} (dernière version)`;
}

export function channelNotes(pub) {
  const history = `https://github.com/${pub.repo}/releases?q=${pub.app}`;
  const notes = `https://github.com/${pub.repo}/releases/tag/${pub.tag}`;
  const lines = [`**${pub.name} ${pub.version}** · [notes de cette version](${notes}) · [toutes les versions](${history})`];
  if (pub.stable.length) {
    lines.push('', 'Téléchargement permanent, toujours la dernière version :', '');
    for (const file of pub.stable) lines.push(`- [${file.name}](${downloadUrl(pub.repo, pub.app, file.name)})`);
  }
  if (pub.manifests.length) {
    const names = pub.manifests.map((file) => `\`${file.name}\``).join(', ');
    lines.push('', `Canal lu par l’application installée pour ses mises à jour (${names}) : ne pas le supprimer ni le renommer.`);
  }
  return lines.join('\n');
}

const normalizeText = (text) => String(text ?? '').replace(/\r\n/g, '\n').trim();

/**
 * Steps that `publish` must run, in contract order, given every release of the
 * repository; plus blocking problems and warnings. Pure.
 */
export function planPublication(pub, releases) {
  const steps = [];
  const problems = [];
  const warnings = [];

  const newer = releases
    .map((release) => parseTag(release.tag))
    .filter((tag) => tag.kind === 'version' && tag.app === pub.app && compareVersions(tag.version, pub.version) > 0)
    .map((tag) => tag.version)
    .sort(compareVersions);
  if (newer.length) problems.push(`${pub.app} ${newer.at(-1)} est déjà publiée : le canal ne revient jamais en arrière`);

  const version = releases.find((release) => release.tag === pub.tag);
  if (!version) {
    steps.push({ kind: 'create-version', files: pub.versionFiles });
  } else {
    const online = new Map(version.assets.map((asset) => [asset.name, asset]));
    const missing = [];
    for (const file of pub.versionFiles) {
      const asset = online.get(file.name);
      if (!asset) missing.push(file);
      else if (asset.digest !== file.digest) {
        problems.push(`${pub.tag} : ${file.name} est déjà en ligne avec un autre contenu ; une version publiée ne change plus`);
      }
    }
    const unknown = version.assets.filter((asset) => !pub.versionFiles.some((file) => file.name === asset.name));
    if (unknown.length) {
      problems.push(`${pub.tag} contient des fichiers absents de cette publication : ${unknown.map((a) => a.name).join(', ')}`);
    }
    if (missing.length) steps.push({ kind: 'upload-version', files: missing });
    if (version.draft) steps.push({ kind: 'publish-version' });
  }

  const title = channelTitle(pub);
  const body = channelNotes(pub);
  const channel = releases.find((release) => release.tag === pub.app);
  if (!channel) {
    steps.push({ kind: 'create-channel', title, body });
    if (pub.stable.length) steps.push({ kind: 'upload-channel', files: pub.stable });
    if (pub.manifests.length) steps.push({ kind: 'upload-channel', files: pub.manifests });
  } else {
    if (channel.draft) problems.push(`le canal ${pub.app} est un brouillon : à régler à la main avant de publier`);
    const online = new Map(channel.assets.map((asset) => [asset.name, asset]));
    const changed = (files) => files.filter((file) => online.get(file.name)?.digest !== file.digest);
    const stable = changed(pub.stable);
    const manifests = changed(pub.manifests);
    if (stable.length) steps.push({ kind: 'upload-channel', files: stable });
    if (manifests.length) steps.push({ kind: 'upload-channel', files: manifests });
    if (channel.title !== title || normalizeText(channel.body) !== normalizeText(body)) {
      steps.push({ kind: 'edit-channel', title, body });
    }
    const published = new Set([...pub.stable, ...pub.manifests].map((file) => file.name));
    const extra = channel.assets.filter((asset) => !published.has(asset.name)).map((asset) => asset.name);
    if (extra.length) warnings.push(`le canal garde ${extra.join(', ')}, absent de cette publication (laissé en place)`);
  }
  return { steps, problems, warnings };
}

export function describeStep(step, pub) {
  const names = () => step.files.map((file) => file.name).join(', ');
  switch (step.kind) {
    case 'create-version':
      return `créer ${pub.tag} : ${names()}`;
    case 'upload-version':
      return `compléter ${pub.tag} : ${names()}`;
    case 'publish-version':
      return `publier le brouillon ${pub.tag}`;
    case 'create-channel':
      return `créer le canal ${pub.app}`;
    case 'upload-channel':
      return `canal ${pub.app} : ${names()}`;
    case 'edit-channel':
      return `canal ${pub.app} : titre et notes`;
    default:
      throw new DistError(`étape inconnue : ${step.kind}`);
  }
}

/** GitHub CLI arguments of a step; `paths` gives the notes files and the staged files. */
export function ghArgs(step, pub, paths) {
  const repo = ['--repo', pub.repo];
  const files = () => step.files.map((file) => paths.file(file));
  switch (step.kind) {
    case 'create-version':
      return ['release', 'create', pub.tag, ...files(), ...repo, '--title', `${pub.name} ${pub.version}`, '--notes-file', paths.notes, '--latest=false'];
    case 'upload-version':
      return ['release', 'upload', pub.tag, ...files(), ...repo];
    case 'publish-version':
      return ['release', 'edit', pub.tag, ...repo, '--draft=false', '--latest=false'];
    case 'create-channel':
      return ['release', 'create', pub.app, ...repo, '--title', step.title, '--notes-file', paths.channelNotes, '--latest=false'];
    case 'upload-channel':
      return ['release', 'upload', pub.app, ...files(), ...repo, '--clobber'];
    case 'edit-channel':
      return ['release', 'edit', pub.app, ...repo, '--title', step.title, '--notes-file', paths.channelNotes];
    default:
      throw new DistError(`étape inconnue : ${step.kind}`);
  }
}

// --- Audit (pure, with injected reads) -------------------------------------------------

/** Groups releases by application: its channel and its published versions, newest first. */
export function groupByApp(releases) {
  const apps = new Map();
  const entry = (app) => {
    if (!apps.has(app)) apps.set(app, { channel: null, versions: [] });
    return apps.get(app);
  };
  for (const release of releases) {
    const tag = parseTag(release.tag);
    if (tag.kind === 'channel') entry(tag.app).channel = release;
    else if (tag.kind === 'version' && !release.draft && !release.prerelease) {
      entry(tag.app).versions.push({ ...release, version: tag.version });
    }
  }
  for (const value of apps.values()) value.versions.sort((a, b) => compareVersions(b.version, a.version));
  return apps;
}

/**
 * Problems of one application as an anonymous user sees it. `io.text(url)` reads a
 * public file; `io.size(url)` returns the size of a public download, or null.
 */
export async function auditApp(repo, app, { channel, versions }, io) {
  const latest = versions[0];
  if (!latest) return [`aucune release ${app}-vX.Y.Z publiée`];
  const problems = [];
  for (const release of versions) {
    if (!release.assets.some((asset) => asset.name === SUMS_FILE)) {
      problems.push(`${release.tag} : ${SUMS_FILE} absent`);
      continue;
    }
    const text = await io.text(downloadUrl(repo, release.tag, SUMS_FILE));
    for (const problem of sumsProblems(text, release.assets)) problems.push(`${release.tag} : ${problem}`);
  }
  if (!channel) return [...problems, `canal ${app} absent`];
  if (!channel.assets.length) problems.push(`canal ${app} vide`);

  const assetNames = new Set(latest.assets.map((asset) => asset.name));
  const sizes = new Map(latest.assets.map((asset) => [downloadUrl(repo, latest.tag, asset.name), asset.size]));
  for (const asset of channel.assets) {
    const url = downloadUrl(repo, app, asset.name);
    if (!latest.assets.some((file) => file.digest && file.digest === asset.digest)) {
      problems.push(`canal ${app} : ${asset.name} n’est identique à aucun fichier de ${latest.tag}`);
    }
    if (asset.name.endsWith('.json')) {
      const text = await io.text(url);
      const found = manifestProblems(asset.name, text, { repo, app, version: latest.version, assetNames });
      for (const problem of found) problems.push(`canal ${app} : ${problem}`);
      if (found.length) continue;
      for (const target of manifestUrls(text)) {
        if ((await io.size(target)) !== sizes.get(target)) problems.push(`${target} : téléchargement anonyme impossible`);
      }
    } else if ((await io.size(url)) !== asset.size) {
      problems.push(`${url} : téléchargement anonyme impossible`);
    }
  }
  return problems;
}

// --- Input / output --------------------------------------------------------------------

const say = (symbol, text) => console.log(`${symbol} ${text}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function ghStatus() {
  const result = spawnSync('gh', ['auth', 'status', '--hostname', 'github.com'], { encoding: 'utf8' });
  return { available: !result.error, authenticated: !result.error && result.status === 0 };
}

function ghRead(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw new DistError(`gh introuvable : ${result.error.message}`);
  if (result.status !== 0) throw new DistError(`gh ${args.slice(0, 2).join(' ')} : ${result.stderr.trim()}`);
  return result.stdout;
}

function ghRun(args) {
  const result = spawnSync('gh', args, { stdio: 'inherit' });
  if (result.error) throw new DistError(`gh introuvable : ${result.error.message}`);
  if (result.status !== 0) throw new DistError(`gh ${args.slice(0, 2).join(' ')} a échoué (code ${result.status})`);
}

function toRelease(raw) {
  return {
    tag: raw.tag_name,
    title: raw.name ?? '',
    body: raw.body ?? '',
    draft: Boolean(raw.draft),
    prerelease: Boolean(raw.prerelease),
    assets: (raw.assets ?? []).map((asset) => ({ name: asset.name, size: asset.size, digest: asset.digest ?? null })),
  };
}

/** Every release; drafts are only visible through an authenticated `gh`. */
async function listReleases(repo, authenticated) {
  if (authenticated) {
    const pages = JSON.parse(ghRead(['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`]));
    return pages.flat().map(toRelease);
  }
  const releases = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
    });
    if (!response.ok) throw new DistError(`API GitHub ${repo} : HTTP ${response.status}`);
    const batch = await response.json();
    releases.push(...batch.map(toRelease));
    if (batch.length < 100) return releases;
  }
}

async function readPublic(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new DistError(`${url} : HTTP ${response.status}`);
  return response.text();
}

/** Size of a public download, read through a one-byte range request; null if unreachable. */
async function probe(url) {
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-0', 'User-Agent': USER_AGENT } });
    await response.body?.cancel();
    if (response.status === 206) {
      const total = /\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
      return total ? Number(total[1]) : null;
    }
    if (response.status === 200) return Number(response.headers.get('content-length') ?? Number.NaN);
    return null;
  } catch {
    return null;
  }
}

/** The two catalogs: from this clone when the tool runs inside it, otherwise from GitHub. */
async function readCatalog(repo) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const names = ['README.md', 'README.fr.md'];
  if (existsSync(join(root, 'docs', 'contract.md')) && names.every((name) => existsSync(join(root, name)))) {
    return names.map((name) => ({ name, text: readFileSync(join(root, name), 'utf8') }));
  }
  return Promise.all(
    names.map(async (name) => ({ name, text: await readPublic(`https://raw.githubusercontent.com/${repo}/HEAD/${name}`) })),
  );
}

async function readPublicDigest(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new DistError(`${url} : HTTP ${response.status}`);
  return `sha256:${createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')}`;
}

/** Problems of a finished publication, read back anonymously. */
async function verifyOnline(pub) {
  const failures = [];
  const sizes = new Map(pub.versionFiles.map((file) => [downloadUrl(pub.repo, pub.tag, file.name), file.size]));
  for (const file of pub.manifests) {
    const url = downloadUrl(pub.repo, pub.app, file.name);
    try {
      if ((await readPublicDigest(url)) !== file.digest) failures.push(`${url} : contenu différent du manifeste publié`);
    } catch (error) {
      failures.push(error.message);
    }
    for (const target of manifestUrls(file.text)) {
      if ((await probe(target)) !== sizes.get(target)) failures.push(`${target} : téléchargement anonyme impossible`);
    }
  }
  for (const file of pub.stable) {
    const url = downloadUrl(pub.repo, pub.app, file.name);
    if ((await probe(url)) !== file.size) failures.push(`${url} : téléchargement anonyme impossible`);
  }
  return failures;
}

function stage(file, dir) {
  if (basename(file.path) === file.name && !file.path.includes('#')) return file.path;
  const target = join(dir, file.name);
  copyFileSync(file.path, target);
  return target;
}

// --- Commands --------------------------------------------------------------------------

async function publishCommand(options) {
  const workDir = mkdtempSync(join(tmpdir(), 'x-quark-dist-'));
  try {
    const pub = preparePublication(options, workDir);
    const gh = ghStatus();
    if (!options.dryRun && !gh.authenticated) throw new DistError('gh n’est pas connecté : gh auth login');
    say('▶', `${pub.name} ${pub.version} → ${pub.repo}${options.dryRun ? ' (essai à blanc)' : ''}`);

    const plan = planPublication(pub, await listReleases(pub.repo, gh.authenticated));
    for (const warning of plan.warnings) say('!', warning);
    if (plan.problems.length) throw new DistError(plan.problems.join('\n  '));
    if (!plan.steps.length) say('✓', 'tout est déjà en ligne, rien à publier');
    for (const step of plan.steps) say(' ', `à faire : ${describeStep(step, pub)}`);
    if (options.dryRun) {
      say('✓', 'essai à blanc terminé : rien n’a été publié');
      return 0;
    }

    const notes = join(workDir, 'notes.md');
    const channelNotesFile = join(workDir, 'channel.md');
    writeFileSync(notes, pub.notes);
    writeFileSync(channelNotesFile, channelNotes(pub));
    const paths = { notes, channelNotes: channelNotesFile, file: (file) => stage(file, workDir) };
    for (const step of plan.steps) {
      say('▶', describeStep(step, pub));
      ghRun(ghArgs(step, pub, paths));
    }

    let after;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      after = planPublication(pub, await listReleases(pub.repo, true));
      if (!after.steps.length && !after.problems.length) break;
      await sleep(2000 * attempt);
    }
    if (after.steps.length || after.problems.length) {
      const left = [...after.problems, ...after.steps.map((step) => describeStep(step, pub))];
      throw new DistError(`publication incomplète :\n  ${left.join('\n  ')}`);
    }
    let failures = [];
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      failures = await verifyOnline(pub);
      if (!failures.length) break;
      await sleep(2000 * attempt);
    }
    if (failures.length) throw new DistError(`vérification anonyme en échec :\n  ${failures.join('\n  ')}`);

    say('✓', `${pub.name} ${pub.version} ${plan.steps.length ? 'publiée' : 'vérifiée'} dans ${pub.repo}`);
    console.log(`  Version         https://github.com/${pub.repo}/releases/tag/${pub.tag}`);
    for (const file of pub.stable) console.log(`  Téléchargement  ${downloadUrl(pub.repo, pub.app, file.name)}`);
    for (const file of pub.manifests) console.log(`  Mises à jour    ${downloadUrl(pub.repo, pub.app, file.name)}`);
    try {
      const missing = catalogProblems(pub.repo, [pub.app], await readCatalog(pub.repo), { orphans: false });
      if (missing.length) say('!', `à ajouter au catalogue de ${pub.repo} (README.md et README.fr.md, par PR)`);
    } catch {
      say('!', `catalogue de ${pub.repo} illisible : vérifier que ${pub.app} y figure`);
    }
    return 0;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function checkCommand(options) {
  const repo = options.repo ?? DEFAULT_REPO;
  if (!REPO_RE.test(repo)) throw new DistError(`dépôt invalide : ${repo}`);
  if (options.app) assertApp(options.app);
  const apps = groupByApp(await listReleases(repo, ghStatus().authenticated));
  const names = options.app ? [options.app] : [...apps.keys()].sort();
  const io = {
    text: async (url) => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await readPublic(url);
        } catch (error) {
          if (attempt === 3) throw error;
          await sleep(1500 * attempt);
        }
      }
    },
    size: probe,
  };

  let failed = 0;
  for (const app of names) {
    const entry = apps.get(app) ?? { channel: null, versions: [] };
    let problems;
    try {
      problems = await auditApp(repo, app, entry, io);
    } catch (error) {
      problems = [error.message];
    }
    if (problems.length) {
      failed += 1;
      say('✗', app);
      for (const problem of problems) console.log(`  - ${problem}`);
    } else {
      const files = entry.channel.assets.map((asset) => asset.name).join(', ');
      say('✓', `${app} ${entry.versions[0].version} · canal : ${files}`);
    }
  }

  const channels = names.filter((app) => apps.get(app)?.channel);
  const catalog = catalogProblems(repo, channels, await readCatalog(repo), { orphans: !options.app });
  if (catalog.length) {
    failed += 1;
    say('✗', 'catalogue');
    for (const problem of catalog) console.log(`  - ${problem}`);
  } else {
    say('✓', 'catalogue (README.md, README.fr.md)');
  }
  return failed ? 1 : 0;
}

// --- Command line ----------------------------------------------------------------------

const USAGE = `Outil de distribution de x-quark/releases

  node dist.mjs publish --app <app> --name <Nom> --version <X.Y.Z> --notes <notes.md>
                        --asset <fichier>... [--stable <fichier>=<NomFixe>]...
                        [--manifest <fichier>]... [--repo <owner/nom>] [--dry-run]
  node dist.mjs check   [--app <app>] [--repo <owner/nom>]

Contrat : https://github.com/${DEFAULT_REPO}/blob/main/docs/contract.md`;

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, assets: [], stable: [], manifests: [], dryRun: false, help: false };
  const lists = { '--asset': 'assets', '--stable': 'stable', '--manifest': 'manifests' };
  const values = { '--app': 'app', '--name': 'name', '--version': 'version', '--notes': 'notes', '--repo': 'repo' };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (lists[arg] || values[arg]) {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) throw new DistError(`valeur manquante pour ${arg}`);
      i += 1;
      if (lists[arg]) options[lists[arg]].push(value);
      else options[values[arg]] = value;
    } else {
      throw new DistError(`option inconnue : ${arg}`);
    }
  }
  return options;
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help || !options.command || options.command === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (options.command === 'publish') return publishCommand(options);
  if (options.command === 'check') return checkCommand(options);
  throw new DistError(`commande inconnue : ${options.command}`);
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    const self = realpathSync.native(fileURLToPath(import.meta.url));
    return realpathSync.native(process.argv[1]).toLowerCase() === self.toLowerCase();
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof DistError ? `✗ ${error.message}` : error);
      process.exit(1);
    },
  );
}
