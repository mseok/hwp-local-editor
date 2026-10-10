import {createRequire} from 'node:module';
import {readFile, writeFile, mkdir, mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspace, digest} from '../app/workspace.mjs';
import {initSync, HwpDocument} from '../.build/core/rhwp.js';
import {unzip, zip} from './zip-fixture.mjs';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH || import.meta.url), {chromium} = require('playwright');
await mkdir('test-results', {recursive: true});
const root = await mkdtemp(path.resolve('test-results/nested-continued-'));
initSync({module: await readFile('.build/core/rhwp_bg.wasm')});
const json = JSON.stringify, blank = await readFile('.cache/rhwp/saved/blank2010.hwp');
const rows = 40, files = [];
const cellPath = (row, col) => [{controlIndex: 0, cellIndex: 0, cellParaIndex: 0}, {controlIndex: 0, cellIndex: row * 2 + col, cellParaIndex: 0}];
{
  const outer = new HwpDocument(blank), inner = new HwpDocument(blank);
  try {
    outer.createBlankDocument(); outer.insertText(0, 0, 0, 'BODY-KEEP'); outer.splitParagraph(0, 0, 'BODY-KEEP'.length);
    outer.createTableEx(json({sectionIdx: 0, paraIdx: 1, charOffset: 0, rowCount: 1, colCount: 1, treatAsChar: true, colWidths: [42000]}));
    outer.insertTextInCell(0, 1, 0, 0, 0, 0, 'OUTER-HOST');
    inner.createBlankDocument();
    const created = JSON.parse(inner.createTableEx(json({sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: rows, colCount: 2, treatAsChar: true, colWidths: [20000, 20000], rowHeights: Array(rows).fill(2200)})));
    for (let row = 0; row < rows; row++) {inner.insertTextInCell(0, 0, created.controlIdx, row * 2, 0, 0, 'INNER-' + row + '-A'); inner.insertTextInCell(0, 0, created.controlIdx, row * 2 + 1, 0, 0, 'INNER-' + row + '-B');}
    const innerXml = unzip(Buffer.from(inner.exportHwpx())).get('Contents/section0.xml').toString().match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0].replace(/\bid="\d+"/g, match => `id="${1000 + Number(match.match(/\d+/)[0])}"`);
    const entries = unzip(Buffer.from(outer.exportHwpx())), section = entries.get('Contents/section0.xml').toString();
    entries.set('Contents/section0.xml', Buffer.from(section.replace('<hp:t>OUTER-HOST</hp:t>', innerXml + '<hp:t>OUTER-HOST</hp:t>')));
    const nested = new HwpDocument(zip(entries));
    try {
      assert.equal(nested.getTextInCellByPath(0, 1, json(cellPath(39, 1)), 0, 100), 'INNER-39-B');
      // The engine does not split a nested table across pages: the last rows render below the page bottom.
      const tree = JSON.parse(nested.getPageRenderTree(0));
      let last = null; (function visit(node) {if (node.type === 'TextRun' && node.text === 'INNER-39-B') last = node.bbox; for (const child of node.children || []) visit(child);})(tree);
      assert.equal(nested.pageCount(), 1); assert(last && last.y > tree.bbox.h, 'The fixture must overflow the page inside the nested table');
      for (const format of ['hwp', 'hwpx']) {
        const file = path.join(root, 'nested-continued.' + format);
        await writeFile(file, format === 'hwp' ? nested.exportHwp() : nested.exportHwpx()); files.push(file);
      }
    } finally {nested.free();}
  } finally {outer.free(); inner.free();}
}
const data = await createWorkspace(files, path.join(root, 'output')), manifest = path.join(root, 'workspace.json');
await writeFile(manifest, json(data));
const port = 18875, base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['app/server.mjs'], {env: {...process.env, PORT: String(port), DOCUMENT_MANIFEST: manifest}, stdio: ['ignore', 'pipe', 'pipe']});
let browser;
const report = {root, checks: [], errors: [], warnings: [], externalRequests: []};
const ready = p => p.waitForFunction(() => window.editorReady, null, {timeout: 45000});
const pass = name => {report.checks.push(name); console.log('PASS', name);};
async function save(page, revision) {await page.getByRole('button', {name: '결과 파일 저장', exact: true}).click(); await page.locator('#delivery[data-revision="' + revision + '"]').waitFor();}
async function find(page, frame, text) {
  await page.getByRole('button', {name: '찾아 바꾸기', exact: true}).click();
  await frame.getByRole('textbox', {name: '찾을 내용', exact: true}).fill(text);
  await frame.getByRole('button', {name: '다음 찾기', exact: true}).click();
  await frame.getByText('검색 결과 1개', {exact: true}).waitFor({timeout: 5000});
}
const read = doc => ({
  text: doc.getTextFileUnicode(true), pages: doc.pageCount(), outer: doc.getTableProperties(0, 1, 0), outerCell: doc.getCellProperties(0, 1, 0, 0),
  inner: doc.getTablePropertiesByPath(0, 1, json([{controlIndex: 0, cellIndex: 0, cellParaIndex: 0}])),
  row39B: doc.getTextInCellByPath(0, 1, json(cellPath(39, 1)), 0, 100), row39A: doc.getTextInCellByPath(0, 1, json(cellPath(39, 0)), 0, 100),
  row30A: JSON.parse(doc.getCellCharPropertiesAtByPath(0, 1, json(cellPath(30, 0)), 0)), row30B: doc.getCellCharPropertiesAtByPath(0, 1, json(cellPath(30, 1)), 0),
  row0A: doc.getCellCharPropertiesAtByPath(0, 1, json(cellPath(0, 0)), 0), host: doc.getCellCharPropertiesAtByPath(0, 1, json([{controlIndex: 0, cellIndex: 0, cellParaIndex: 0}]), 1),
});
function verify(source, result, edited) {
  const before = read(source), after = read(result);
  for (const key of ['pages', 'outer', 'outerCell', 'inner', 'row39A', 'row30B', 'row0A', 'host']) assert.equal(after[key], before[key], key + ' must stay untouched');
  assert.equal(after.row39B, edited ? 'INNER-39-EDIT' : 'INNER-39-B');
  assert.equal(after.row30A.bold, edited);
  const strip = props => {const copy = {...props}; delete copy.bold; delete copy.charShapeId; return copy;};
  assert.deepEqual(strip(after.row30A), strip(before.row30A));
  assert.equal(after.text, edited ? before.text.replace('INNER-39-B', 'INNER-39-EDIT') : before.text);
}
try {
  await new Promise((resolve, reject) => {child.stdout.on('data', chunk => {if (String(chunk).includes('http://')) resolve();}); child.stderr.on('data', chunk => process.stderr.write(chunk)); child.on('exit', code => reject(new Error('server exited ' + code)));});
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined});
  const context = await browser.newContext({viewport: {width: 1280, height: 1050}});
  context.on('page', page => {page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => {if (['warning', 'error'].includes(message.type())) report.warnings.push(message.text());}); page.on('request', request => {if (!request.url().startsWith(base)) report.externalRequests.push(request.url());});});
  for (const entry of data.documents) {
    const source = new HwpDocument(await readFile(entry.source)), page = await context.newPage(), frame = page.frameLocator('#editor iframe');
    const check = async edited => {const saved = new HwpDocument(await readFile(entry.output)); try {verify(source, saved, edited);} finally {saved.free();}};
    try {
      await page.goto(base + '/editor?id=' + entry.id); await ready(page);
      await find(page, frame, 'INNER-39-B');
      await frame.getByRole('textbox', {name: '바꿀 내용', exact: true}).fill('INNER-39-EDIT');
      await frame.getByRole('button', {name: '바꾸기', exact: true}).click();
      await frame.getByRole('button', {name: '찾아 바꾸기 닫기', exact: true}).click();
      await find(page, frame, 'INNER-30-A');
      await frame.getByRole('button', {name: '찾아 바꾸기 닫기', exact: true}).click();
      await frame.getByRole('button', {name: '굵게', exact: true}).click();
      await save(page, 1); await check(true);
      pass(entry.name + ' Find replaces a nested row below the page bottom and bolds an on-page row through full paths');
      await frame.locator('#menu-bar').getByText('편집', {exact: true}).click(); await frame.locator('#menu-bar').getByText('되돌리기', {exact: true}).click();
      await frame.locator('#menu-bar').getByText('편집', {exact: true}).click(); await frame.locator('#menu-bar').getByText('되돌리기', {exact: true}).click();
      await save(page, 2); await check(false);
      await frame.locator('#menu-bar').getByText('편집', {exact: true}).click(); await frame.locator('#menu-bar').getByText('다시 실행', {exact: true}).click();
      await frame.locator('#menu-bar').getByText('편집', {exact: true}).click(); await frame.locator('#menu-bar').getByText('다시 실행', {exact: true}).click();
      await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
      await page.reload(); await ready(page); await save(page, 3); await check(true);
      pass(entry.name + ' nested continued-table edits undo, redo and recover through the journal');
      await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page); await check(true);
      assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);
      const receipt = JSON.parse(await readFile(entry.output + '.receipt.json'));
      assert.equal(receipt.outputSha256, digest(await readFile(entry.output))); assert.equal(receipt.contentLoss.count, 0);
      pass(entry.name + ' saved nested continued-table result reopens with source and receipt hashes intact');
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
