#!/usr/bin/env node
// Package the current engine build as a release archive that `npm run setup` can download instead of compiling Rust.
// The archive holds the Vite studio output, the wasm-bindgen package and the editor SDK of the last `npm run build`,
// plus build-info.json; everything inside is MIT (rhwp, this repository) or OFL/free (bundled web fonts).
// Usage: node scripts/package-build.mjs [--publish]   (publish creates the GitHub release with gh)
import {spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertCurrentBuild, sourceVersion} from './check-build.mjs';

export const archiveName = 'hwp-local-editor-build.tar.gz';
export const releaseTag = version => 'build-' + version.slice(0, 12);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), upstream = path.join(root, '.cache/rhwp');
const publish = process.argv.includes('--publish');
await assertCurrentBuild(root);
const version = await sourceVersion(root), pin = JSON.parse(await readFile(path.join(root, 'upstream.json'), 'utf8'));
const info = JSON.parse(await readFile(path.join(root, '.build/build-info.json'), 'utf8'));
if (info.sourceVersion !== version) throw new Error('build-info.json does not match the current source version.');
const staging = await mkdtemp(path.join(os.tmpdir(), 'hwp-build-package-'));
try {
  // The upstream output folders hold exactly the last build; .build/studio may still carry older hashed assets.
  await cp(path.join(upstream, 'rhwp-studio/dist'), path.join(staging, 'studio'), {recursive: true});
  await rm(path.join(staging, 'studio/samples'), {recursive: true, force: true}); // upstream demo documents are not needed by the local shell
  await cp(path.join(upstream, 'pkg'), path.join(staging, 'core'), {recursive: true});
  await cp(path.join(upstream, 'npm/editor'), path.join(staging, 'sdk'), {recursive: true});
  await writeFile(path.join(staging, 'build-info.json'), JSON.stringify(info));
  const out = path.join(root, 'local/release', releaseTag(version)); await rm(out, {recursive: true, force: true}); await mkdir(out, {recursive: true});
  const archive = path.join(out, archiveName);
  const tar = spawnSync('tar', ['-czf', archive, '-C', staging, 'studio', 'core', 'sdk', 'build-info.json'], {stdio: 'inherit'});
  if (tar.status !== 0) throw new Error('tar failed');
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(archive + '.sha256', digest + '  ' + archiveName + '\n');
  const notes = ['Prebuilt engine for `npm run setup`.', '', '- sourceVersion: `' + version + '`', '- upstream rhwp: ' + pin.repository + ' @ `' + pin.commit + '` (v' + pin.version + ', MIT)',
    '- wasm-bindgen: ' + pin.wasmBindgen, '- contents: studio (Vite build with OFL/free web fonts), core (wasm package), sdk, build-info.json', '- sha256: `' + digest + '`',
    '', 'Licenses: this repository and rhwp are MIT; see NOTICE and licenses/.'].join('\n');
  await writeFile(path.join(out, 'notes.md'), notes + '\n');
  console.log('packaged ' + archive + ' sha256 ' + digest);
  if (publish) {
    const tag = releaseTag(version);
    const create = spawnSync('gh', ['release', 'create', tag, archive, archive + '.sha256', '--title', 'Prebuilt engine ' + tag, '--notes-file', path.join(out, 'notes.md')], {stdio: 'inherit', cwd: root});
    if (create.status !== 0) throw new Error('gh release create failed');
    console.log('published release ' + tag);
  }
} finally {await rm(staging, {recursive: true, force: true});}
