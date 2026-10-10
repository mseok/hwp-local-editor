#!/usr/bin/env node
// Compare Hancom-printed PDFs with the staged manifest: page counts and the expected edit text per page (macOS, PDFKit).
// Usage: node scripts/native-print-compare.mjs --manifest <manifest.json>
// Manifest inputs carry {input, plannedPdf, browserPageCount, expectedTokens: [{text, page?}]}; paths are repository-relative.
import {spawnSync} from 'node:child_process';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from '../app/workspace.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), args = process.argv.slice(2);
const manifestPath = args[args.indexOf('--manifest') + 1];
if (args.indexOf('--manifest') < 0 || !manifestPath) {console.error('Usage: node scripts/native-print-compare.mjs --manifest <manifest.json>'); process.exit(2);}
if (process.platform !== 'darwin') {console.error('This comparison needs macOS (PDFKit).'); process.exit(2);}
const binary = path.join(root, '.build', 'pdf-pages'), source = path.join(root, 'tools', 'pdf-pages.swift');
async function fresh() {try {const [b, s] = await Promise.all([stat(binary), stat(source)]); return b.mtimeMs >= s.mtimeMs;} catch {return false;}}
if (!(await fresh())) {await mkdir(path.dirname(binary), {recursive: true}); const build = spawnSync('xcrun', ['swiftc', '-O', '-o', binary, source], {stdio: 'inherit'}); if (build.status !== 0) process.exit(build.status ?? 1);}
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')), results = [];
for (const item of manifest.inputs) {
  const pdf = path.resolve(root, item.plannedPdf), name = path.basename(item.input), entry = {input: item.input, pdf: item.plannedPdf, status: 'missing', problems: []};
  try {await stat(pdf);} catch {results.push(entry); console.log('MISSING  ' + name + ' (' + item.plannedPdf + ')'); continue;}
  const pagesDir = path.join(path.dirname(pdf), 'pages', name), run = spawnSync(binary, [pdf, pagesDir], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  if (run.status !== 0) {entry.status = 'unreadable'; entry.problems.push((run.stdout + run.stderr).trim()); results.push(entry); console.log('UNREADABLE ' + name); continue;}
  const info = JSON.parse(run.stdout);
  entry.pdfSha256 = digest(await readFile(pdf)); entry.pageCount = info.pageCount; entry.browserPageCount = item.browserPageCount; entry.pages = info.pages.map(p => p.png);
  if (item.browserPageCount !== undefined && info.pageCount !== item.browserPageCount) entry.problems.push('page count ' + info.pageCount + ' differs from browser ' + item.browserPageCount);
  for (const token of item.expectedTokens || []) {
    const pages = token.page ? [info.pages[token.page - 1]].filter(Boolean) : info.pages;
    const text = pages.map(p => p.text.replace(/\s+/g, '')).join('\n');
    if (!text.includes(token.text.replace(/\s+/g, ''))) entry.problems.push('text "' + token.text + '" not found' + (token.page ? ' on page ' + token.page : ''));
  }
  entry.status = entry.problems.length ? 'differs' : 'matches'; results.push(entry);
  console.log((entry.status === 'matches' ? 'MATCHES  ' : 'DIFFERS  ') + name + ' pages ' + info.pageCount + (entry.problems.length ? ' | ' + entry.problems.join('; ') : ''));
}
const report = path.join(path.dirname(path.resolve(root, manifest.inputs[0].plannedPdf)), 'comparison.json');
await mkdir(path.dirname(report), {recursive: true});
await writeFile(report, JSON.stringify({comparedAt: new Date().toISOString(), manifest: path.relative(root, path.resolve(manifestPath)), method: 'PDFKit page count and text search per page; rendered pages beside the browser pages for visual review', results}, null, 2) + '\n');
console.log('REPORT ' + path.relative(root, report));
process.exit(results.every(r => r.status === 'matches') ? 0 : 1);
