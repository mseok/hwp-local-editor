#!/usr/bin/env node
// Render the first page of saved HWP/HWPX files through Hancom Office's own Quick Look thumbnail extension (macOS only).
// This is Hancom's parser and renderer without any window, keystroke or Accessibility permission; it is not the print pipeline
// and shows only the first page. Usage: node scripts/native-quicklook.mjs --output <dir> [--size 1600] <files...>
import {spawnSync} from 'node:child_process';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from '../app/workspace.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), files = [];
let output = null, size = 1600;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output') output = path.resolve(args[++i]);
  else if (args[i] === '--size') size = Number(args[++i]);
  else files.push(path.resolve(args[i]));
}
if (!output || files.length === 0) {console.error('Usage: node scripts/native-quicklook.mjs --output <dir> [--size 1600] <files...>'); process.exit(2);}
if (process.platform !== 'darwin') {console.error('This check needs macOS with Hancom Office HWP installed.'); process.exit(2);}
const binary = path.join(root, '.build', 'ql-thumb'), source = path.join(root, 'tools', 'ql-thumb.swift');
async function fresh() {try {const [b, s] = await Promise.all([stat(binary), stat(source)]); return b.mtimeMs >= s.mtimeMs;} catch {return false;}}
if (!(await fresh())) {
  await mkdir(path.dirname(binary), {recursive: true});
  const build = spawnSync('xcrun', ['swiftc', '-O', '-o', binary, source], {stdio: 'inherit'});
  if (build.status !== 0) process.exit(build.status ?? 1);
}
await mkdir(output, {recursive: true});
const results = [];
for (const file of files) {
  const png = path.join(output, path.basename(file) + '.png');
  const run = spawnSync(binary, [file, png, String(size)], {encoding: 'utf8'}), detail = (run.stdout + run.stderr).trim(), ok = run.status === 0;
  results.push({input: file, sha256: digest(await readFile(file)), png: ok ? png : null, size, status: ok ? 'rendered' : 'failed', detail});
  console.log((ok ? 'RENDERED ' : 'FAILED ') + file + ' ' + detail);
}
await writeFile(path.join(output, 'native-quicklook.json'), JSON.stringify({renderedAt: new Date().toISOString(), renderer: 'Hancom Office HWP Quick Look thumbnail extension through QLThumbnailGenerator', firstPageOnly: true, results}, null, 2) + '\n');
process.exit(results.every(r => r.status === 'rendered') ? 0 : 1);
