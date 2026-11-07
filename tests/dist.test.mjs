import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  DistError,
  SUMS_FILE,
  assertApp,
  auditApp,
  catalogProblems,
  channelNotes,
  channelTitle,
  compareVersions,
  downloadUrl,
  ghArgs,
  groupByApp,
  manifestProblems,
  parseArgs,
  parseSums,
  parseTag,
  planPublication,
  preparePublication,
  sumsProblems,
  sumsText,
} from '../scripts/dist.mjs';

const repo = 'x-quark/releases';
const digest = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dist-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name, text) => {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  };
  return { dir, write };
}

function manifest(version, file = `Demo_${version}_x64-setup.exe`, extra = {}) {
  return JSON.stringify({
    version,
    notes: 'Notes',
    pub_date: '2026-11-07T00:00:00Z',
    platforms: { 'windows-x86_64': { signature: 'c2lnbmF0dXJl', url: downloadUrl(repo, `demo-v${version}`, file) } },
    ...extra,
  });
}

/** A valid publication of the fictitious `demo` application, from real temporary files. */
function demo(t, { version = '1.2.0', manifestText, stableName = 'Demo-setup.exe', sums } = {}) {
  const { dir, write } = workspace(t);
  const installer = write(`Demo_${version}_x64-setup.exe`, `installer ${version}`);
  const signature = write(`Demo_${version}_x64-setup.exe.sig`, `signature ${version}`);
  const latest = write('latest.json', manifestText ?? manifest(version));
  const notes = write('notes.md', `Notes ${version}\r\n`);
  const assets = [installer, signature];
  if (sums !== undefined) assets.push(write(SUMS_FILE, sums));
  return preparePublication(
    {
      app: 'demo',
      name: 'Demo',
      version,
      notes,
      assets,
      stable: [`${installer}=${stableName}`],
      manifests: [latest],
    },
    dir,
  );
}

const online = (tag, files, extra = {}) => ({
  tag,
  title: '',
  body: '',
  draft: false,
  prerelease: false,
  assets: files.map(({ name, size, digest: fileDigest }) => ({ name, size, digest: fileDigest })),
  ...extra,
});

/** The releases as they stand once `pub` is fully published. */
const published = (pub) => [
  online(pub.tag, pub.versionFiles, { title: `${pub.name} ${pub.version}` }),
  online(pub.app, [...pub.stable, ...pub.manifests], { title: channelTitle(pub), body: channelNotes(pub) }),
];

test('tags: versions, channels and the rest', () => {
  assert.deepEqual(parseTag('rplace-v1.0.1'), { kind: 'version', app: 'rplace', version: '1.0.1' });
  assert.deepEqual(parseTag('x-tools-v2.10.0'), { kind: 'version', app: 'x-tools', version: '2.10.0' });
  assert.deepEqual(parseTag('x-tools'), { kind: 'channel', app: 'x-tools' });
  assert.equal(parseTag('v1.0.0').kind, 'other');
  assert.equal(parseTag('rplace-v1.0.1-beta.1').kind, 'other');
  assert.equal(parseTag('demo-v2').kind, 'other');
});

test('versions compare numerically', () => {
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.ok(compareVersions('0.9.0', '1.0.0') < 0);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
});

test('application identifiers are lowercase slugs', () => {
  assertApp('x-tools');
  for (const app of ['Rplace', 'r_place', '', 'demo-v2', '-demo', undefined]) {
    assert.throws(() => assertApp(app), DistError, String(app));
  }
});

test('a publication gets a generated SHA256SUMS.txt covering every version file', (t) => {
  const pub = demo(t);
  assert.equal(pub.tag, 'demo-v1.2.0');
  assert.equal(pub.notes, 'Notes 1.2.0');
  assert.deepEqual(
    pub.versionFiles.map((file) => file.name),
    ['Demo_1.2.0_x64-setup.exe', 'Demo_1.2.0_x64-setup.exe.sig', 'latest.json', SUMS_FILE],
  );
  assert.deepEqual(pub.stable.map((file) => file.name), ['Demo-setup.exe']);
  assert.equal(pub.stable[0].digest, digest('installer 1.2.0'));
  const sums = parseSums(sumsText(pub.versionFiles));
  assert.equal(sums.size, 3);
  assert.equal(sums.get('Demo_1.2.0_x64-setup.exe'), digest('installer 1.2.0').slice(7));
});

test('a provided SHA256SUMS.txt must cover every other file', (t) => {
  assert.throws(() => demo(t, { sums: `${'0'.repeat(64)}  latest.json\n` }), /SHA256SUMS\.txt fourni incomplet/);
});

test('fixed names never contain the version', (t) => {
  assert.throws(() => demo(t, { stableName: 'Demo-1.2.0-setup.exe' }), /contient la version/);
});

test('manifests must announce the version and point to the version release', (t) => {
  const elsewhere = manifest('1.2.0', 'x', {
    platforms: { 'windows-x86_64': { signature: 's', url: 'https://api.github.com/repos/x-quark/demo/releases/assets/1' } },
  });
  assert.throws(() => demo(t, { manifestText: elsewhere }), /adresse hors de demo-v1\.2\.0/);
  assert.throws(() => demo(t, { manifestText: manifest('1.1.0') }), /annonce la version 1\.1\.0/);
  assert.throws(() => demo(t, { manifestText: `﻿${manifest('1.2.0')}` }), /BOM/);
});

test('manifest problems: unknown file, missing signature, Android variant', () => {
  const context = { repo, app: 'demo', version: '1.2.0', assetNames: new Set(['Demo.apk']) };
  const android = JSON.stringify({
    version: '1.2.0',
    platforms: { android: { url: downloadUrl(repo, 'demo-v1.2.0', 'Demo.apk'), signature: 's', versionCode: 1002000 } },
  });
  assert.deepEqual(manifestProblems('latest.json', android, context), []);
  const unknown = android.replace('Demo.apk', 'Other.apk');
  assert.match(manifestProblems('latest.json', unknown, context)[0], /ne correspond à aucun fichier/);
  const unsigned = android.replace('"signature":"s"', '"signature":""');
  assert.match(manifestProblems('latest.json', unsigned, context)[0], /signature manquante pour android/);
  assert.match(manifestProblems('latest.yml', 'x', context)[0], /JSON/);
});

test('plan: a first publication creates the version, then the channel, manifests last', (t) => {
  const pub = demo(t);
  const plan = planPublication(pub, []);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(
    plan.steps.map((step) => [step.kind, step.files?.map((file) => file.name)]),
    [
      ['create-version', ['Demo_1.2.0_x64-setup.exe', 'Demo_1.2.0_x64-setup.exe.sig', 'latest.json', SUMS_FILE]],
      ['create-channel', undefined],
      ['upload-channel', ['Demo-setup.exe']],
      ['upload-channel', ['latest.json']],
    ],
  );
});

test('plan: nothing to do once everything is online', (t) => {
  const pub = demo(t);
  assert.deepEqual(planPublication(pub, published(pub)), { steps: [], problems: [], warnings: [] });
});

test('plan: a published version never changes', (t) => {
  const pub = demo(t);
  const releases = published(pub);
  releases[0].assets[0] = { ...releases[0].assets[0], digest: digest('another build') };
  assert.match(planPublication(pub, releases).problems[0], /déjà en ligne avec un autre contenu/);
});

test('plan: the channel never goes back to an older version', (t) => {
  const pub = demo(t);
  const plan = planPublication(pub, [...published(pub), online('demo-v1.10.0', [])]);
  assert.match(plan.problems[0], /1\.10\.0 est déjà publiée/);
});

test('plan: an interrupted publication resumes where it stopped', (t) => {
  const pub = demo(t);
  const draft = online(pub.tag, pub.versionFiles.slice(0, 1), { draft: true });
  assert.deepEqual(
    planPublication(pub, [draft]).steps.map((step) => step.kind),
    ['upload-version', 'publish-version', 'create-channel', 'upload-channel', 'upload-channel'],
  );
});

test('plan: a new version replaces the channel files, then its title and notes', (t) => {
  const previous = demo(t, { version: '1.1.0' });
  const pub = demo(t);
  const plan = planPublication(pub, published(previous));
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(
    plan.steps.map((step) => [step.kind, step.files?.map((file) => file.name)]),
    [
      ['create-version', ['Demo_1.2.0_x64-setup.exe', 'Demo_1.2.0_x64-setup.exe.sig', 'latest.json', SUMS_FILE]],
      ['upload-channel', ['Demo-setup.exe']],
      ['upload-channel', ['latest.json']],
      ['edit-channel', undefined],
    ],
  );
});

test('plan: channel files outside the publication are kept, with a warning', (t) => {
  const pub = demo(t);
  const releases = published(pub);
  releases[1].assets.push({ name: 'Old-name.exe', size: 1, digest: digest('old') });
  const plan = planPublication(pub, releases);
  assert.deepEqual(plan.steps, []);
  assert.match(plan.warnings[0], /Old-name\.exe/);
});

test('gh arguments keep releases out of Latest and replace channel files', (t) => {
  const pub = demo(t);
  const paths = { notes: 'notes.md', channelNotes: 'channel.md', file: (file) => file.name };
  const [create, , upload] = planPublication(pub, []).steps;
  const createArgs = ghArgs(create, pub, paths);
  assert.deepEqual(createArgs.slice(0, 3), ['release', 'create', 'demo-v1.2.0']);
  assert.ok(createArgs.includes('--latest=false'));
  assert.deepEqual(ghArgs(upload, pub, paths), [
    'release', 'upload', 'demo', 'Demo-setup.exe', '--repo', repo, '--clobber',
  ]);
});

test('channel notes link the version, the history and the permanent downloads', (t) => {
  const pub = demo(t);
  const notes = channelNotes(pub);
  assert.match(notes, /releases\/tag\/demo-v1\.2\.0/);
  assert.match(notes, /releases\?q=demo/);
  assert.match(notes, /releases\/download\/demo\/Demo-setup\.exe/);
  assert.equal(channelTitle(pub), 'Demo 1.2.0 (dernière version)');
});

test('checksums: missing and wrong entries are reported', () => {
  const files = [
    { name: 'a.exe', digest: digest('a') },
    { name: 'b.sig', digest: digest('b') },
  ];
  const text = `${digest('a').slice(7)}  a.exe\n${'f'.repeat(64)} *extra.md\n`;
  assert.deepEqual(sumsProblems(text, files), [`b.sig absent de ${SUMS_FILE}`]);
  assert.deepEqual(sumsProblems(text.replace(digest('a').slice(7), '0'.repeat(64)), files.slice(0, 1)), [
    `empreinte de a.exe fausse dans ${SUMS_FILE}`,
  ]);
});

test('catalog: listed channels, missing ones and orphans', () => {
  const readme = (apps) => ({
    name: 'README.md',
    text: apps.map((app) => `[x](${downloadUrl(repo, app, 'X-setup.exe')}) [h](${downloadUrl(repo, `${app}-v1.0.0`, 'x')})`).join('\n'),
  });
  assert.deepEqual(catalogProblems(repo, ['rplace'], [readme(['rplace'])]), []);
  assert.deepEqual(catalogProblems(repo, ['rplace', 'cosmos'], [readme(['rplace'])]), ['README.md : cosmos absent du catalogue']);
  assert.deepEqual(catalogProblems(repo, [], [readme(['gone'])]), ['README.md : lien vers un canal inexistant (gone)']);
  assert.deepEqual(catalogProblems(repo, [], [readme(['gone'])], { orphans: false }), []);
});

test('audit: a healthy channel, then a stale one', async (t) => {
  const pub = demo(t);
  const releases = groupByApp(published(pub)).get('demo');
  const texts = new Map([
    [downloadUrl(repo, pub.tag, SUMS_FILE), sumsText(pub.versionFiles)],
    [downloadUrl(repo, 'demo', 'latest.json'), pub.manifests[0].text],
  ]);
  const sizes = new Map([
    ...pub.versionFiles.map((file) => [downloadUrl(repo, pub.tag, file.name), file.size]),
    ...[...pub.stable, ...pub.manifests].map((file) => [downloadUrl(repo, 'demo', file.name), file.size]),
  ]);
  const io = { text: async (url) => texts.get(url), size: async (url) => sizes.get(url) ?? null };
  assert.deepEqual(await auditApp(repo, 'demo', releases, io), []);

  releases.channel.assets[0] = { ...releases.channel.assets[0], digest: digest('older installer') };
  const problems = await auditApp(repo, 'demo', releases, io);
  assert.match(problems[0], /Demo-setup\.exe n’est identique à aucun fichier de demo-v1\.2\.0/);
});

test('command line options', () => {
  const options = parseArgs(['publish', '--app', 'demo', '--asset', 'a', '--asset', 'b', '--dry-run']);
  assert.equal(options.command, 'publish');
  assert.deepEqual(options.assets, ['a', 'b']);
  assert.equal(options.dryRun, true);
  assert.throws(() => parseArgs(['publish', '--app']), /valeur manquante/);
  assert.throws(() => parseArgs(['publish', '--nope', 'x']), /option inconnue/);
});
