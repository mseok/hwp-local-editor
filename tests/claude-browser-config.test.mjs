import test from 'node:test';
import assert from 'node:assert/strict';
import {browserArguments, browserConfig, browserEnvironment} from '../scripts/claude-browser-config.mjs';

test('headless MCP does not attach to a personal browser or reuse its profile', () => {
  const args = browserArguments('http://127.0.0.1:8782', 'browser executable');
  for (const flag of ['--headless', '--isolated', '--block-service-workers', '--no-webmcp']) assert(args.includes(flag));
  assert(!args.includes('--extension')); assert(!args.includes('--cdp-endpoint'));
  assert(!args.includes('--storage-state')); assert(!args.includes('--user-data-dir'));
  assert.equal(args[args.indexOf('--allowed-origins') + 1], 'http://127.0.0.1:8782');
  assert.equal(args[args.indexOf('--executable-path') + 1].split('/').at(-1), 'browser executable');
});
test('configuration rejects external origins, credentials and document paths', () => {
  for (const value of ['https://example.com', 'http://localhost:8782', 'http://127.0.0.1',
    'http://127.0.0.1:8782/tasks', 'http://127.0.0.1:8782/?token=x',
    'http://user:password@127.0.0.1:8782', 'file:///document.hwp']) {
    assert.throws(() => browserArguments(value));
  }
});
test('configuration is session-local and passes paths as separate arguments', () => {
  const config = browserConfig('http://127.0.0.1:8782', 'browser executable');
  const server = config.mcpServers['hwp-browser'];
  assert.equal(Object.keys(config.mcpServers).length, 1);
  assert.equal(server.command, process.execPath);
  assert(server.args.includes('--serve'));
  assert.equal(server.args[server.args.indexOf('--origin') + 1], 'http://127.0.0.1:8782');
  assert.equal(server.args[server.args.indexOf('--executable-path') + 1].split('/').at(-1), 'browser executable');
});
test('browser child receives runtime variables without inherited credentials', () => {
  assert.deepEqual(browserEnvironment({PATH: '/bin', TMPDIR: '/tmp', LANG: 'en_US.UTF-8',
    ANTHROPIC_API_KEY: 'synthetic', GITHUB_TOKEN: 'synthetic', CUSTOM_PASSWORD: 'synthetic', HOME: '/private'}),
  {PATH: '/bin', TMPDIR: '/tmp', LANG: 'en_US.UTF-8'});
});
