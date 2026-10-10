#!/usr/bin/env node
// One-command setup: engine build (downloaded prebuilt, or compiled when a toolchain exists), the hwp-agent-edit skill for
// Codex and Claude Code, and a headless browser MCP server for Claude Code. Safe to rerun; every step is skipped when current.
// Usage: node scripts/setup.mjs [--codex-only] [--no-claude-mcp] [--build] [--replace-skill]
import {spawnSync} from 'node:child_process';
import {access, mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertCurrentBuild, sourceVersion} from './check-build.mjs';
import {defaultOrigins, serverDefinition} from './claude-browser-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), has = flag => args.includes(flag);
for (const arg of args) if (!['--codex-only', '--no-claude-mcp', '--build', '--replace-skill'].includes(arg)) {console.error('Unknown option ' + arg); process.exit(2);}
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const log = message => console.log('[setup] ' + message);
const run = (command, commandArgs, options = {}) => spawnSync(command, commandArgs, {stdio: 'inherit', cwd: root, ...options});
const exists = async file => {try {await access(file); return true;} catch {return false;}};
const which = command => spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {encoding: 'utf8'}).status === 0;

// 1. Node version
const [major, minor] = process.versions.node.split('.').map(Number), [needMajor, needMinor] = pkg.engines.node.replace('>=', '').split('.').map(Number);
if (major < needMajor || (major === needMajor && minor < needMinor)) {console.error('Node.js ' + pkg.engines.node + ' is required; found ' + process.versions.node + '.'); process.exit(1);}
log('Node.js ' + process.versions.node);

// 2. Engine build: current → skip; else prebuilt release; else local build when a toolchain exists
const version = await sourceVersion(root), tag = 'build-' + version.slice(0, 12), archiveName = 'hwp-local-editor-build.tar.gz';
const repository = String(pkg.repository || '').replace(/^github:/, '').replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
async function buildIsCurrent() {try {await assertCurrentBuild(root); return true;} catch {return false;}}
async function downloadPrebuilt() {
  const base = 'https://github.com/' + repository + '/releases/download/' + tag + '/';
  const downloads = path.join(root, '.cache/downloads'); await mkdir(downloads, {recursive: true});
  const fetchFile = async name => {const response = await fetch(base + name, {redirect: 'follow'}); if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + base + name); return Buffer.from(await response.arrayBuffer());};
  log('downloading prebuilt engine ' + tag + ' from ' + repository);
  const [archive, checksum] = await Promise.all([fetchFile(archiveName), fetchFile(archiveName + '.sha256')]);
  const expected = checksum.toString('utf8').trim().split(/\s+/)[0], actual = createHash('sha256').update(archive).digest('hex');
  if (expected !== actual) throw new Error('checksum mismatch for ' + archiveName);
  const file = path.join(downloads, archiveName); await writeFile(file, archive);
  const staging = await mkdtemp(path.join(os.tmpdir(), 'hwp-build-'));
  try {
    if (run('tar', ['-xzf', file, '-C', staging]).status !== 0) throw new Error('tar failed');
    const info = JSON.parse(await readFile(path.join(staging, 'build-info.json'), 'utf8'));
    if (info.sourceVersion !== version) throw new Error('the release archive was built from another source version');
    const target = path.join(root, '.build'), previous = path.join(root, '.cache/build-previous');
    await rm(previous, {recursive: true, force: true});
    if (await exists(target)) await rename(target, previous);
    await rename(staging, target);
    await rm(previous, {recursive: true, force: true});
  } catch (error) {await rm(staging, {recursive: true, force: true}); throw error;}
  await assertCurrentBuild(root);
}
if (await buildIsCurrent() && !has('--build')) log('engine build is current (' + version.slice(0, 12) + ')');
else {
  let done = false;
  if (!has('--build')) {try {await downloadPrebuilt(); done = true; log('prebuilt engine installed');} catch (error) {log('prebuilt engine unavailable: ' + error.message);}}
  if (!done) {
    const toolchain = which(process.env.CARGO_BIN || 'cargo') && which(process.env.WASM_BINDGEN_BIN || 'wasm-bindgen');
    if (!toolchain) {console.error('No prebuilt engine matches this source and no Rust toolchain was found. Install Rust 1.93.1 with the wasm32-unknown-unknown target and wasm-bindgen-cli 0.2.127 (see README), then rerun npm run setup.'); process.exit(1);}
    log('compiling the engine locally (several minutes)');
    if (run('npm', ['run', 'build']).status !== 0) process.exit(1);
  }
}

// 3. Skill for Codex and Claude Code
const skillArgs = []; if (has('--codex-only')) skillArgs.push('--codex-only'); if (has('--replace-skill')) skillArgs.push('--replace');
if (run(process.execPath, [path.join(root, 'scripts/install-skill.mjs'), ...skillArgs]).status !== 0) {console.error('Skill installation failed; rerun with --replace-skill to replace a skill from another checkout.'); process.exit(1);}

// 4. Claude Code: headless browser MCP (Playwright MCP, isolated, loopback-only), registered once at user scope
if (!has('--codex-only') && !has('--no-claude-mcp')) {
  const mcpDir = path.join(root, '.cache/claude-browser'), cli = path.join(mcpDir, 'node_modules/@playwright/mcp/package.json'), wanted = '0.0.83';
  let installed = null; try {installed = JSON.parse(await readFile(cli, 'utf8')).version;} catch {}
  if (installed !== wanted) {
    log('installing @playwright/mcp@' + wanted + ' into .cache/claude-browser');
    if (run('npm', ['install', '--prefix', mcpDir, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', '@playwright/mcp@' + wanted]).status !== 0) process.exit(1);
  } else log('@playwright/mcp@' + wanted + ' present');
  const chromePaths = {darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'], linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'], win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']}[process.platform] || [];
  let channel = null; for (const candidate of chromePaths) if (await exists(candidate)) {channel = 'chrome'; break;}
  if (!channel) {
    log('Google Chrome not found; downloading a Playwright Chromium for the headless session');
    if (run(process.execPath, [path.join(mcpDir, 'node_modules/playwright-core/cli.js'), 'install', 'chromium']).status !== 0) process.exit(1);
  } else log('using the installed Google Chrome (headless, isolated profile)');
  if (!which('claude')) log('claude CLI not found; skipping the MCP registration (run npm run setup again after installing Claude Code)');
  else {
    const definition = serverDefinition(defaultOrigins, undefined, channel || undefined);
    const existing = spawnSync('claude', ['mcp', 'get', 'hwp-browser'], {encoding: 'utf8'});
    if (existing.status === 0) run('claude', ['mcp', 'remove', '-s', 'user', 'hwp-browser'], {stdio: 'ignore'});
    if (run('claude', ['mcp', 'add-json', '-s', 'user', 'hwp-browser', JSON.stringify(definition)]).status !== 0) {console.error('claude mcp add-json failed'); process.exit(1);}
    log('registered the hwp-browser MCP server for Claude Code (user scope, ports ' + defaultOrigins[0].split(':').pop() + '-' + defaultOrigins.at(-1).split(':').pop() + ')');
  }
}

console.log('\nSetup complete. Ask your agent, for example:\n  "hwp-agent-edit 스킬로 ~/Documents/report.hwp 의 2026년을 2027년으로 바꿔줘"\n  "Use the hwp-agent-edit skill to replace 2026 with 2027 in ~/Documents/report.hwp"\nCodex uses its hidden browser; Claude Code uses the registered hwp-browser MCP server (start a new Claude session once).');
