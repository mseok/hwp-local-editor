// Memo (Hancom 메모/주석) viewing, editing, insertion, deletion, undo/redo, journal recovery and saved reopening
// through the Studio memo list and 입력 → 메모 넣기, in HWP and HWPX.
import {createRequire} from 'node:module';
import {readFile, writeFile, mkdir, mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspace, digest} from '../app/workspace.mjs';
import {initSync, HwpDocument} from '../.build/core/rhwp.js';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH || import.meta.url), {chromium} = require('playwright');
await mkdir('test-results', {recursive: true});
const root = await mkdtemp(path.resolve('test-results/memo-'));
initSync({module: await readFile('.build/core/rhwp_bg.wasm')});
const json = JSON.stringify, blank = await readFile('.cache/rhwp/saved/blank2010.hwp');
const files = [];
{
  const d = new HwpDocument(blank);
  try {
    d.createBlankDocument();
    d.insertText(0, 0, 0, 'MEMO-ONE anchor'); d.splitParagraph(0, 0, 15);
    d.insertText(0, 1, 0, 'MEMO-TWO anchor'); d.splitParagraph(0, 1, 15);
    d.insertText(0, 2, 0, 'NEW-ANCHOR plain'); d.splitParagraph(0, 2, 16);
    const table = JSON.parse(d.createTable(0, 3, 0, 1, 2));
    d.insertTextInCell(0, table.paraIdx, table.controlIdx, 0, 0, 0, 'CELL-ANCHOR');
    d.insertMemoEx(json({target: {section: 0, para: 0, cellPath: []}, start: 0, end: 8, text: '첫 메모', createdAt: Date.UTC(2026, 9, 14, 5, 30)}));
    d.insertMemoEx(json({target: {section: 0, para: 1, cellPath: []}, start: 0, end: 8, text: '둘째 메모', createdAt: Date.UTC(2026, 9, 14, 5, 30)}));
    for (const format of ['hwp', 'hwpx']) {
      const file = path.join(root, 'memo.' + format);
      await writeFile(file, format === 'hwp' ? d.exportHwp() : d.exportHwpx()); files.push(file);
    }
  } finally {d.free();}
}
const data = await createWorkspace(files, path.join(root, 'output')), manifest = path.join(root, 'workspace.json');
await writeFile(manifest, json(data));
const port = 18874, base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['app/server.mjs'], {env: {...process.env, PORT: String(port), DOCUMENT_MANIFEST: manifest}, stdio: ['ignore', 'pipe', 'pipe']});
let browser;
const report = {root, checks: [], errors: [], warnings: [], externalRequests: []};
const ready = p => p.waitForFunction(() => window.editorReady, null, {timeout: 45000});
const pass = name => {report.checks.push(name); console.log('PASS', name);};
const memoState = doc => JSON.parse(doc.getMemos()).map(({number, start, end, anchorText, text, target}) => ({number, start, end, anchorText, text, cell: target.cellPath.length > 0}));
async function save(page, revision) {await page.getByRole('button', {name: '결과 파일 저장', exact: true}).click(); await page.locator('#delivery[data-revision="' + revision + '"]').waitFor();}
async function menu(frame, title, label) {await frame.locator('#menu-bar .menu-title').filter({hasText: title}).click(); await frame.locator('#menu-bar').getByText(label, {exact: true}).click();}
async function select(page, frame, text) {
  await page.getByRole('button', {name: '찾아 바꾸기', exact: true}).click();
  await frame.getByRole('textbox', {name: '찾을 내용', exact: true}).fill(text);
  await frame.getByRole('button', {name: '다음 찾기', exact: true}).click();
  await frame.getByText('검색 결과 1개', {exact: true}).waitFor();
  await frame.getByRole('button', {name: '찾아 바꾸기 닫기', exact: true}).click();
}
async function openList(frame) {
  await frame.getByRole('button', {name: '메모 목록', exact: true}).click();
  await frame.getByRole('dialog', {name: '메모 목록', exact: true}).waitFor({timeout: 5000});
}
const closeList = frame => frame.getByRole('button', {name: '메모 목록 닫기', exact: true}).click();
async function listed(frame) {
  return frame.getByRole('dialog', {name: '메모 목록', exact: true}).locator('section[role="group"]').evaluateAll(groups => groups.map(g => ({label: g.getAttribute('aria-label'), text: g.querySelector('textarea').value})));
}
try {
  await new Promise((resolve, reject) => {child.stdout.on('data', chunk => {if (String(chunk).includes('http://')) resolve();}); child.stderr.on('data', chunk => process.stderr.write(chunk)); child.on('exit', code => reject(new Error('server exited ' + code)));});
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined});
  const context = await browser.newContext({viewport: {width: 1280, height: 1050}});
  context.on('page', page => {page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => {if (['warning', 'error'].includes(message.type())) report.warnings.push(message.text());}); page.on('request', request => {if (!request.url().startsWith(base)) report.externalRequests.push(request.url());});});
  for (const entry of data.documents) {
    const source = new HwpDocument(await readFile(entry.source)), page = await context.newPage(), frame = page.frameLocator('#editor iframe');
    const text = doc => doc.getTextFileUnicode(true);
    const check = async expected => {
      const saved = new HwpDocument(await readFile(entry.output));
      try {
        assert.deepEqual(memoState(saved), expected);
        assert.equal(text(saved), text(source), 'body and cell text must stay');
        assert.equal(saved.getParagraphCount(0), source.getParagraphCount(0), 'no paragraph may be added or lost');
      } finally {saved.free();}
    };
    const one = {number: 1, start: 0, end: 8, anchorText: 'MEMO-ONE', cell: false};
    const two = {number: 2, start: 0, end: 8, anchorText: 'MEMO-TWO', cell: false};
    const three = {number: 3, start: 0, end: 10, anchorText: 'NEW-ANCHOR', text: '새 메모\n둘째 줄', cell: false};
    const four = {number: 4, start: 0, end: 11, anchorText: 'CELL-ANCHOR', text: '셀 메모', cell: true};
    try {
      await page.goto(base + '/editor?id=' + entry.id); await ready(page);
      await openList(frame);
      assert.deepEqual(await listed(frame), [{label: '메모 1', text: '첫 메모'}, {label: '메모 2', text: '둘째 메모'}]);
      pass(entry.name + ' memo list shows existing memos with their bodies');
      await frame.getByRole('textbox', {name: '메모 1 내용', exact: true}).fill('고친 메모\n두 줄');
      await frame.getByRole('button', {name: '메모 1 저장', exact: true}).click();
      assert.deepEqual((await listed(frame))[0], {label: '메모 1', text: '고친 메모\n두 줄'});
      await closeList(frame);
      await save(page, 1); await check([{...one, text: '고친 메모\n두 줄'}, {...two, text: '둘째 메모'}]);
      pass(entry.name + ' memo body edited in the list is saved with its paragraphs and the other memo intact');
      await select(page, frame, 'NEW-ANCHOR');
      await menu(frame, '입력', '메모 넣기');
      await frame.getByRole('textbox', {name: '메모 내용', exact: true}).fill('새 메모\n둘째 줄');
      await frame.getByRole('dialog', {name: '메모 넣기', exact: true}).getByRole('button', {name: '넣기', exact: true}).click();
      await select(page, frame, 'CELL-ANCHOR');
      await menu(frame, '입력', '메모 넣기');
      await frame.getByRole('textbox', {name: '메모 내용', exact: true}).fill('셀 메모');
      await frame.getByRole('dialog', {name: '메모 넣기', exact: true}).getByRole('button', {name: '넣기', exact: true}).click();
      await save(page, 2); await check([{...one, text: '고친 메모\n두 줄'}, {...two, text: '둘째 메모'}, three, four]);
      pass(entry.name + ' 메모 넣기 adds body and table-cell memos around the selected text');
      await openList(frame);
      await frame.getByRole('button', {name: '메모 2 지우기', exact: true}).click();
      assert.deepEqual((await listed(frame)).map(m => m.label), ['메모 1', '메모 3', '메모 4']);
      await closeList(frame);
      await save(page, 3); await check([{...one, text: '고친 메모\n두 줄'}, three, four]);
      pass(entry.name + ' deleting a memo keeps its anchored text and the other memos');
      await menu(frame, '편집', '되돌리기');
      await save(page, 4); await check([{...one, text: '고친 메모\n두 줄'}, {...two, text: '둘째 메모'}, three, four]);
      await menu(frame, '편집', '다시 실행');
      await save(page, 5); await check([{...one, text: '고친 메모\n두 줄'}, three, four]);
      await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
      await page.reload(); await ready(page);
      await save(page, 6); await check([{...one, text: '고친 메모\n두 줄'}, three, four]);
      pass(entry.name + ' memo deletion undo, redo and journal recovery keep the expected memos');
      await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page);
      await openList(frame);
      assert.deepEqual(await listed(frame), [{label: '메모 1', text: '고친 메모\n두 줄'}, {label: '메모 3', text: '새 메모\n둘째 줄'}, {label: '메모 4', text: '셀 메모'}]);
      await frame.getByRole('textbox', {name: '메모 4 내용', exact: true}).fill('셀 메모 확인');
      await frame.getByRole('button', {name: '메모 4 저장', exact: true}).click();
      await closeList(frame);
      await save(page, 7); await check([{...one, text: '고친 메모\n두 줄'}, three, {...four, text: '셀 메모 확인'}]);
      assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);
      const receipt = JSON.parse(await readFile(entry.output + '.receipt.json'));
      assert.equal(receipt.outputSha256, digest(await readFile(entry.output))); assert.equal(receipt.contentLoss.count, 0);
      pass(entry.name + ' reopened result lists the saved memos, accepts a further edit and keeps source and receipt hashes');
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
