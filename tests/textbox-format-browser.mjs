import {createRequire} from 'node:module';
import {readFile, writeFile, mkdir, mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspace, digest} from '../app/workspace.mjs';
import {initSync, HwpDocument} from '../.build/core/rhwp.js';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH || import.meta.url), {chromium} = require('playwright');
await mkdir('test-results', {recursive: true});
const root = await mkdtemp(path.resolve('test-results/textbox-format-'));
initSync({module: await readFile('.build/core/rhwp_bg.wasm')});
const d = new HwpDocument(await readFile('.cache/rhwp/saved/blank2010.hwp')), files = [], json = JSON.stringify;
try {
  d.createBlankDocument(); d.insertText(0, 0, 0, 'BODY-UNCHANGED'); d.splitParagraph(0, 0, 14);
  d.insertText(0, 1, 0, 'HOST-UNCHANGED');
  d.splitParagraph(0, 1, 'HOST-UNCHANGED'.length);
  const shape = JSON.parse(d.createShapeControl(json({sectionIdx: 0, paraIdx: 1, charOffset: 0, width: 20000, height: 10000, treatAsChar: true, shapeType: 'textbox', horzOffset: 0, vertOffset: 0})));
  assert.equal(shape.paraIdx, 1); assert.equal(shape.controlIdx, 0);
  for (const [i, text] of ['BOX-FIRST', 'BOX-SECOND', 'BOX-UNSELECTED'].entries()) {
    if (i) d.splitParagraphInCell(0, 1, 0, 0, i - 1, d.getCellParagraphLength(0, 1, 0, 0, i - 1));
    d.insertTextInCell(0, 1, 0, 0, i, 0, text);
  }
  const table = JSON.parse(d.createTable(0, 2, 0, 1, 2));
  assert.equal(table.paraIdx, 2); assert.equal(table.controlIdx, 0);
  d.insertTextInCell(0, 2, 0, 0, 0, 0, 'CELL-UNCHANGED');
  assert(JSON.parse(d.getTextFileUnicode(true)).includes('HOST-UNCHANGED'));
  for (const format of ['hwp', 'hwpx']) {const file = path.join(root, 'textbox.' + format); await writeFile(file, format === 'hwp' ? d.exportHwp() : d.exportHwpx()); files.push(file);}
} finally {d.free();}
const data = await createWorkspace(files, path.join(root, 'output')), manifest = path.join(root, 'workspace.json');
await writeFile(manifest, json(data));
const port = 18880, base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['app/server.mjs'], {env: {...process.env, PORT: String(port), DOCUMENT_MANIFEST: manifest}, stdio: ['ignore', 'pipe', 'pipe']});
let browser;
const report = {root, checks: [], errors: [], warnings: [], externalRequests: []};
const ready = p => p.waitForFunction(() => window.editorReady, null, {timeout: 45000});
const pass = name => {report.checks.push(name); console.log('PASS', name);};
async function save(page, revision) {await page.getByRole('button', {name: '결과 파일 저장', exact: true}).click(); await page.locator('#delivery[data-revision="' + revision + '"]').waitFor();}
async function editMenu(frame, label) {await frame.locator('#menu-bar').getByText('편집', {exact: true}).click(); await frame.locator('#menu-bar').getByText(label, {exact: true}).click();}
async function enter(page, source) {
  const tree = JSON.parse(source.getPageRenderTree(0)), texts = [];
  function visit(node) {if (node.type === 'TextRun' && node.text === 'BOX-FIRST') texts.push(node); for (const child of node.children || []) visit(child);}
  visit(tree); assert.equal(texts.length, 1);
  const canvas = page.frameLocator('#editor iframe').locator('#scroll-container canvas').first();
  const size = await canvas.evaluate(el => ({width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height})), b = texts[0].bbox;
  await canvas.dblclick({position: {x: (b.x + b.w / 2) * size.width / tree.bbox.w, y: (b.y + b.h / 2) * size.height / tree.bbox.h}});
}
function verify(source, result, changed, selected = [0]) {
  assert.equal(result.getTextFileUnicode(true), source.getTextFileUnicode(true));
  assert.equal(result.getShapeProperties(0, 1, 0), source.getShapeProperties(0, 1, 0));
  assert.equal(result.getTableProperties(0, 2, 0), source.getTableProperties(0, 2, 0));
  for (const cell of [0, 1]) assert.equal(result.getCellProperties(0, 2, 0, cell), source.getCellProperties(0, 2, 0, cell));
  for (const para of [0, 1]) assert.equal(result.getParaPropertiesAt(0, para), source.getParaPropertiesAt(0, para));
  for (const para of [0, 1, 2]) {
    const p = json([{controlIndex: 0, cellIndex: 0, cellParaIndex: para}]);
    assert.equal(result.getTextInCellByPath(0, 1, p, 0, 100), source.getTextInCellByPath(0, 1, p, 0, 100));
    const before = JSON.parse(source.getCellParaPropertiesAtByPath(0, 1, p)), after = JSON.parse(result.getCellParaPropertiesAtByPath(0, 1, p));
    assert.equal(after.alignment, changed && selected.includes(para) ? 'center' : before.alignment, 'Textbox paragraph ' + para);
    delete before.alignment; delete after.alignment; delete before.paraShapeId; delete after.paraShapeId;
    assert.deepEqual(after, before); assert.equal(result.getCellCharPropertiesAtByPath(0, 1, p, 0), source.getCellCharPropertiesAtByPath(0, 1, p, 0));
  }
}
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined});
  const context = await browser.newContext({viewport: {width: 1280, height: 1050}});
  context.on('page', p => {p.on('pageerror', e => report.errors.push(e.message)); p.on('console', m => {if (['warning', 'error'].includes(m.type())) report.warnings.push(m.text());}); p.on('request', r => {if (!r.url().startsWith(base + '/') && !/^(blob|data):/.test(r.url())) report.externalRequests.push(r.url());});});
  for (const entry of data.documents) {
    const source = new HwpDocument(await readFile(entry.source)), page = await context.newPage(), frame = page.frameLocator('#editor iframe');
    try {
      await page.goto(base + '/editor?id=' + entry.id); await ready(page); await enter(page, source);
      await frame.getByRole('textbox', {name: '문서 편집 입력', exact: true}).press('ArrowRight');
      await frame.getByRole('button', {name: '가운데 정렬', exact: true}).click(); await save(page, 1);
      let result = new HwpDocument(await readFile(entry.output));
      try {verify(source, result, true);} finally {result.free();}
      pass(entry.format + ' textbox caret changes its paragraph alignment only');
      await editMenu(frame, '되돌리기'); await save(page, 2);
      result = new HwpDocument(await readFile(entry.output)); try {verify(source, result, false);} finally {result.free();}
      await editMenu(frame, '다시 실행');
      await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
      await page.reload(); await ready(page); await save(page, 3);
      result = new HwpDocument(await readFile(entry.output)); try {verify(source, result, true);} finally {result.free();}
      pass(entry.format + ' textbox alignment undo, redo and recovery');
      await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page);
      result = new HwpDocument(await readFile(entry.output));
      try {verify(source, result, true); assert.equal(result.getSourceFormat(), entry.format); const receipt = JSON.parse(await readFile(entry.output + '.receipt.json')); assert.equal(receipt.contentLoss.count, 0); assert.equal(receipt.outputSha256, digest(await readFile(entry.output))); assert.equal(receipt.textSha256, digest(JSON.parse(result.getTextFileUnicode(true)))); assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);} finally {result.free();}
      pass(entry.format + ' textbox alignment saved reopening, original and receipt hashes');
      result = new HwpDocument(await readFile(entry.output));
      try {await enter(page, result);} finally {result.free();}
      const input = frame.getByRole('textbox', {name: '문서 편집 입력', exact: true});
      await input.press('Home');
      for (let i = 0; i < 20; i++) await input.press('Shift+ArrowRight');
      await frame.getByRole('button', {name: '가운데 정렬', exact: true}).click(); await save(page, 4);
      result = new HwpDocument(await readFile(entry.output)); try {verify(source, result, true, [0, 1]);} finally {result.free();}
      pass(entry.format + ' selected textbox range formats both paragraphs and preserves the third');
      await editMenu(frame, '되돌리기'); await save(page, 5);
      result = new HwpDocument(await readFile(entry.output)); try {verify(source, result, true);} finally {result.free();}
      await editMenu(frame, '다시 실행');
      await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
      await page.reload(); await ready(page); await save(page, 6);
      result = new HwpDocument(await readFile(entry.output)); try {verify(source, result, true, [0, 1]);} finally {result.free();}
      pass(entry.format + ' multi-paragraph textbox undo, redo and journal replay');
      await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page);
      result = new HwpDocument(await readFile(entry.output));
      try {verify(source, result, true, [0, 1]); assert.equal(digest(await readFile(entry.source)), entry.sourceSha256); const receipt = JSON.parse(await readFile(entry.output + '.receipt.json')); assert.equal(receipt.outputSha256, digest(await readFile(entry.output))); assert.equal(receipt.textSha256, digest(JSON.parse(result.getTextFileUnicode(true)))); assert.equal(receipt.contentLoss.count, 0);} finally {result.free();}
      pass(entry.format + ' multi-paragraph textbox disk reopening and fingerprints');
    } finally {source.free(); await page.close();}
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.warnings, []); assert.deepEqual(report.externalRequests, []); pass('No browser errors, warnings or external requests');
} catch (error) {report.failure = {message: error.message}; throw error;} finally {
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log('REPORT', path.join(root, 'report.json'));
  if (browser) await browser.close();
  if (child.exitCode === null && child.signalCode === null) {const closed = new Promise(resolve => child.once('close', resolve)); child.kill(); await closed;}
}
