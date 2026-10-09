import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, '.cache/claude-browser/node_modules/@playwright/mcp/cli.js');
const version = '0.0.83';
export function browserEnvironment(env) {
  return Object.fromEntries(['PATH', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SystemRoot']
    .filter(key => env[key] !== undefined).map(key => [key, env[key]]));
}
export function browserArguments(origin, executable) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      Number(url.port) < 1024 || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use the registered task origin, http://127.0.0.1:PORT, without a path or credentials.');
  }
  const args = [cli, '--headless', '--isolated', '--block-service-workers', '--no-webmcp',
    '--allowed-origins', url.origin, '--codegen', 'none', '--snapshot-boxes'];
  if (executable) args.push('--executable-path', path.resolve(executable));
  return args;
}
export function browserConfig(origin, executable) {
  browserArguments(origin, executable);
  const args = [fileURLToPath(import.meta.url), '--serve', '--origin', origin];
  if (executable) args.push('--executable-path', path.resolve(executable));
  return {mcpServers: {'hwp-browser': {command: process.execPath, args}}};
}
async function main(args) {
  let origin, executable, output, serve = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--origin') origin = args[++index];
    else if (args[index] === '--executable-path') executable = args[++index];
    else if (args[index] === '--output') output = args[++index];
    else if (args[index] === '--serve') serve = true;
    else throw new Error('Unknown option: ' + args[index]);
  }
  if (!origin || (!serve && !output) || (serve && output)) {
    throw new Error('Usage: node scripts/claude-browser-config.mjs --origin http://127.0.0.1:PORT --output CONFIG.json [--executable-path BROWSER]');
  }
  const browserArgs = browserArguments(origin, executable);
  const installed = JSON.parse(await readFile(path.join(path.dirname(cli), 'package.json')));
  if (installed.version !== version) throw new Error('Install @playwright/mcp@' + version + ' in .cache/claude-browser first.');
  if (executable) await access(path.resolve(executable));
  if (serve) {
    const child = spawn(process.execPath, browserArgs, {stdio: 'inherit', env: browserEnvironment(process.env)});
    process.on('SIGTERM', () => child.kill('SIGTERM'));
    process.on('SIGINT', () => child.kill('SIGINT'));
    child.once('error', error => {console.error(error.message); process.exitCode = 1;});
    child.once('close', (code, signal) => {process.exitCode = code ?? (signal ? 1 : 0);});
  } else {
    const filename = path.resolve(output);
    await mkdir(path.dirname(filename), {recursive: true});
    await writeFile(filename, JSON.stringify(browserConfig(origin, executable), null, 2) + '\n', {flag: 'wx', mode: 0o600});
    console.log(filename);
  }
}
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
