import {createRequire} from 'node:module';
import {readFile, writeFile, mkdir, mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspace, digest} from '../app/workspace.mjs';
import {initSync, HwpDocument} from '../.build/core/rhwp.js';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH || import.meta.url), {chromium} = require('playwright');
await mkdir('test-results', {recursive: true});
const root = await mkdtemp(path.resolve('test-results/header-footer-'));
initSync({module: await readFile('.build/core/rhwp_bg.wasm')});
const json = JSON.stringify, blank = await readFile('.cache/rhwp/saved/blank2010.hwp');
const files = [];
{
  const d = new HwpDocument(blank);
  try {
    d.createBlankDocument(); d.insertText(0, 0, 0, 'BODY-KEEP'); d.splitParagraph(0, 0, 'BODY-KEEP'.length); d.insertText(0, 1, 0, 'SECOND-KEEP');
    assert.equal(JSON.parse(d.createHeaderFooter(0, true, 0)).ok, true); d.insertTextInHeaderFooter(0, true, 0, 0, 0, 'HEADER-TARGET 2026');
    assert.equal(JSON.parse(d.createHeaderFooter(0, false, 0)).ok, true); d.insertTextInHeaderFooter(0, false, 0, 0, 0, 'FOOTER-KEEP');
    assert.equal(JSON.parse(d.getHeaderFooter(0, true, 0)).text, 'HEADER-TARGET 2026');
    for (const format of ['hwp', 'hwpx']) {
      const file = path.join(root, 'header-footer.' + format);
      await writeFile(file, format === 'hwp' ? d.exportHwp() : d.exportHwpx()); files.push(file);
    }
  } finally {d.free();}
}
const data = await createWorkspace(files, path.join(root, 'output')), manifest = path.join(root, 'workspace.json');
await writeFile(manifest, json(data));
const port = 18873, base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['app/server.mjs'], {env: {...process.env, PORT: String(port), DOCUMENT_MANIFEST: manifest}, stdio: ['ignore', 'pipe', 'pipe']});
let browser;
const report = {root, checks: [], errors: [], warnings: [], externalRequests: []};
const ready = p => p.waitForFunction(() => window.editorReady, null, {timeout: 45000});
const pass = name => {report.checks.push(name); console.log('PASS', name);};
async function save(page, revision) {await page.getByRole('button', {name: '결과 파일 저장', exact: true}).click(); await page.locator('#delivery[data-revision="' + revision + '"]').waitFor();}
async function menu(frame, title, label) {await frame.locator('#menu-bar .menu-title').filter({hasText: title}).click(); await frame.locator('#menu-bar').getByText(label, {exact: true}).click();}
async function enterHeader(frame) {await frame.getByRole('button', {name: '머리말', exact: true}).click(); await frame.getByRole('button', {name: '머리말/꼬리말 닫기', exact: true}).waitFor({timeout: 5000});}
async function closeHeader(frame) {await frame.getByRole('button', {name: '머리말/꼬리말 닫기', exact: true}).click();}
const read = doc => ({
  header: JSON.parse(doc.getHeaderFooter(0, true, 0)), footer: JSON.parse(doc.getHeaderFooter(0, false, 0)),
  text: doc.getTextFileUnicode(true), pages: doc.pageCount(), pageDef: doc.getPageDef(0),
  bodyChar: doc.getCharPropertiesAt(0, 0, 0), bodyPara: doc.getParaPropertiesAt(0, 0), secondChar: doc.getCharPropertiesAt(0, 1, 0),
  headerChar: doc.getCharPropertiesInHeaderFooter(0, true, 0, 0, 0), headerPara: doc.getParaPropertiesInHf(0, true, 0, 0),
});
function verify(source, result, headerText) {
  const before = read(source), after = read(result);
  assert.equal(after.header.text, headerText);
  assert.deepEqual({...after.header, text: undefined}, {...before.header, text: undefined}, 'header control identity must stay');
  assert.deepEqual(after.footer, before.footer, 'footer must stay untouched');
  for (const key of ['text', 'pages', 'pageDef', 'bodyChar', 'bodyPara', 'secondChar', 'headerChar', 'headerPara']) assert.equal(after[key], before[key], key + ' must stay untouched');
}
try {
  await new Promise((resolve, reject) => {child.stdout.on('data', chunk => {if (String(chunk).includes('http://')) resolve();}); child.stderr.on('data', chunk => process.stderr.write(chunk)); child.on('exit', code => reject(new Error('server exited ' + code)));});
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined});
  const context = await browser.newContext({viewport: {width: 1280, height: 1050}});
  context.on('page', page => {page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => {if (['warning', 'error'].includes(message.type())) report.warnings.push(message.text());}); page.on('request', request => {if (!request.url().startsWith(base)) report.externalRequests.push(request.url());});});
  for (const entry of data.documents) {
    const source = new HwpDocument(await readFile(entry.source)), page = await context.newPage(), frame = page.frameLocator('#editor iframe');
    const check = async (headerText) => {const saved = new HwpDocument(await readFile(entry.output)); try {verify(source, saved, headerText);} finally {saved.free();}};
    const input = frame.getByRole('textbox', {name: '문서 편집 입력', exact: true});
    try {
      await page.goto(base + '/editor?id=' + entry.id); await ready(page);
      await enterHeader(frame);
      await input.press('Home');
      for (let i = 0; i < 'HEADER-TARGET'.length; i++) await input.press('Shift+ArrowRight');
      await input.pressSequentially('HEADER-EDITED');
      await closeHeader(frame);
      await save(page, 1); await check('HEADER-EDITED 2026');
      pass(entry.name + ' header text replaced through 머리말 편집 keeps the footer, body and header formatting');
      let undone = 0;
      for (; undone < 4; undone++) {
        await menu(frame, '편집', '되돌리기');
        await save(page, 2 + undone);
        const saved = new HwpDocument(await readFile(entry.output));
        const text = JSON.parse(saved.getHeaderFooter(0, true, 0)).text; saved.free();
        if (text === 'HEADER-TARGET 2026') break;
      }
      assert(undone < 4, 'The header edit must be undone within a few steps');
      assert(undone <= 1, 'Consecutive header typing must coalesce into at most two undo steps');
      await check('HEADER-TARGET 2026');
      for (let i = 0; i <= undone; i++) await menu(frame, '편집', '다시 실행');
      await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
      await page.reload(); await ready(page); await save(page, 3 + undone); await check('HEADER-EDITED 2026');
      pass(entry.name + ' header edit undo, redo and journal recovery preserve the target');
      await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page); await check('HEADER-EDITED 2026');
      await enterHeader(frame);
      await input.press('End'); await input.pressSequentially(' 확인');
      await closeHeader(frame);
      await save(page, 4 + undone); await check('HEADER-EDITED 2026 확인');
      assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);
      const receipt = JSON.parse(await readFile(entry.output + '.receipt.json'));
      assert.equal(receipt.outputSha256, digest(await readFile(entry.output))); assert.equal(receipt.contentLoss.count, 0);
      pass(entry.name + ' reopened result accepts a further header edit and keeps source and receipt hashes');
    } finally {source.free(); await page.close();}
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.warnings, []); assert.deepEqual(report.externalRequests, []);
  pass('No browser errors, warnings or external requests');
} finally {
  await writeFile(path.join(root, 'report.json'), json(report, null, 2));
  console.log('REPORT', path.join(root, 'report.json'));
  if (browser) await browser.close();
  child.kill();
}
