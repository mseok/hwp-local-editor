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
export const defaultPorts = Array.from({length: 10}, (_, index) => 8766 + index);
export const defaultOrigins = defaultPorts.map(port => 'http://127.0.0.1:' + port);
const channels = ['chrome', 'chromium', 'msedge', 'chrome-beta', 'chrome-canary', 'msedge-beta', 'msedge-dev'];
export function normalizeOrigins(origins) {
  const list = (Array.isArray(origins) ? origins : String(origins).split(';')).map(value => value.trim()).filter(Boolean);
  if (!list.length) throw new Error('Use the registered task origin, http://127.0.0.1:PORT, without a path or credentials.');
  return list.map(origin => {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
        Number(url.port) < 1024 || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Use the registered task origin, http://127.0.0.1:PORT, without a path or credentials.');
    }
    return url.origin;
  });
}
export function browserArguments(origins, executable, channel) {
  const list = normalizeOrigins(origins);
  if (channel && !channels.includes(channel)) throw new Error('Unsupported browser channel: ' + channel);
  const args = [cli, '--headless', '--isolated', '--block-service-workers', '--no-webmcp',
    '--allowed-origins', list.join(';'), '--codegen', 'none', '--snapshot-boxes'];
  if (executable) args.push('--executable-path', path.resolve(executable));
  if (channel) args.push('--browser', channel);
  return args;
}
export function serverDefinition(origins, executable, channel) {
  browserArguments(origins, executable, channel);
  const args = [fileURLToPath(import.meta.url), '--serve', '--origins', normalizeOrigins(origins).join(';')];
  if (executable) args.push('--executable-path', path.resolve(executable));
  if (channel) args.push('--browser', channel);
  return {type: 'stdio', command: process.execPath, args};
}
export function browserConfig(origins, executable, channel) {
  const {command, args} = serverDefinition(origins, executable, channel);
  return {mcpServers: {'hwp-browser': {command, args}}};
}
async function main(args) {
  let origin, executable, output, channel, serve = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--origin' || args[index] === '--origins') origin = args[++index];
    else if (args[index] === '--executable-path') executable = args[++index];
    else if (args[index] === '--browser') channel = args[++index];
    else if (args[index] === '--output') output = args[++index];
    else if (args[index] === '--serve') serve = true;
    else throw new Error('Unknown option: ' + args[index]);
  }
  if (!origin || (!serve && !output) || (serve && output)) {
    throw new Error('Usage: node scripts/claude-browser-config.mjs --origin http://127.0.0.1:PORT[;http://127.0.0.1:PORT2] --output CONFIG.json [--executable-path BROWSER | --browser chrome]');
  }
  const browserArgs = browserArguments(origin, executable, channel);
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
    await writeFile(filename, JSON.stringify(browserConfig(origin, executable, channel), null, 2) + '\n', {flag: 'wx', mode: 0o600});
    console.log(filename);
  }
}
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
