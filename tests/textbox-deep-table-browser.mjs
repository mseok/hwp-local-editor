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
const root = await mkdtemp(path.resolve('test-results/textbox-deep-table-'));
initSync({module: await readFile('.build/core/rhwp_bg.wasm')});
const json = JSON.stringify, blank = await readFile('.cache/rhwp/saved/blank2010.hwp');
const outerCell = {controlIndex: 0, cellIndex: 0, cellParaIndex: 0}, boxCell = {controlIndex: 0, cellIndex: 0, cellParaIndex: 0};
const deepPath = [outerCell, boxCell, {controlIndex: 0, cellIndex: 0, cellParaIndex: 0}], deepKeepPath = [outerCell, boxCell, {controlIndex: 0, cellIndex: 1, cellParaIndex: 0}];
const files = [];
{
  const table = new HwpDocument(blank), box = new HwpDocument(blank), owner = new HwpDocument(blank);
  try {
    table.createBlankDocument();
    const inner = JSON.parse(table.createTableEx(json({sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: 1, colCount: 2, treatAsChar: true, colWidths: [10000, 10000], rowHeights: [2500]})));
    table.insertTextInCell(0, 0, inner.controlIdx, 0, 0, 0, 'DEEP-TARGET'); table.insertTextInCell(0, 0, inner.controlIdx, 1, 0, 0, 'DEEP-KEEP');
    const tableXml = unzip(Buffer.from(table.exportHwpx())).get('Contents/section0.xml').toString().match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0].replace(/\bid="\d+"/g, match => `id="${2000 + Number(match.match(/\d+/)[0])}"`);
    box.createBlankDocument();
    const shape = JSON.parse(box.createShapeControl(json({sectionIdx: 0, paraIdx: 0, charOffset: 0, width: 26000, height: 12000, treatAsChar: true, shapeType: 'textbox', horzOffset: 0, vertOffset: 0})));
    box.insertTextInCell(0, 0, shape.controlIdx, 0, 0, 0, 'BOX-TEXT');
    const boxXml = unzip(Buffer.from(box.exportHwpx())).get('Contents/section0.xml').toString().match(/<hp:rect\b[\s\S]*?<\/hp:rect>/)[0].replace('<hp:t>BOX-TEXT</hp:t>', tableXml + '<hp:t>BOX-TEXT</hp:t>');
    owner.createBlankDocument(); owner.insertText(0, 0, 0, 'BODY-KEEP'); owner.splitParagraph(0, 0, 'BODY-KEEP'.length);
    owner.createTableEx(json({sectionIdx: 0, paraIdx: 1, charOffset: 0, rowCount: 1, colCount: 2, treatAsChar: true, colWidths: [34000, 8500], rowHeights: [14000]}));
    owner.insertTextInCell(0, 1, 0, 0, 0, 0, 'OUTER-0'); owner.insertTextInCell(0, 1, 0, 1, 0, 0, 'OUTER-1');
    const entries = unzip(Buffer.from(owner.exportHwpx())), section = entries.get('Contents/section0.xml').toString();
    entries.set('Contents/section0.xml', Buffer.from(section.replace('<hp:t>OUTER-0</hp:t>', boxXml + '<hp:t>OUTER-0</hp:t>')));
    const nested = new HwpDocument(zip(entries));
    try {
      assert.equal(nested.getTextInCellByPath(0, 1, json(deepPath), 0, 100), 'DEEP-TARGET');
      for (const format of ['hwp', 'hwpx']) {
        const file = path.join(root, 'textbox-deep-table.' + format);
        await writeFile(file, format === 'hwp' ? nested.exportHwp() : nested.exportHwpx()); files.push(file);
      }
    } finally {nested.free();}
  } finally {table.free(); box.free(); owner.free();}
}
const data = await createWorkspace(files, path.join(root, 'output')), manifest = path.join(root, 'workspace.json');
await writeFile(manifest, json(data));
const port = 18877, base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['app/server.mjs'], {env: {...process.env, PORT: String(port), DOCUMENT_MANIFEST: manifest}, stdio: ['ignore', 'pipe', 'pipe']});
let browser;
const report = {root, checks: [], errors: [], warnings: [], externalRequests: []};
const ready = p => p.waitForFunction(() => window.editorReady, null, {timeout: 45000});
const pass = name => {report.checks.push(name); console.log('PASS', name);};
async function save(page, revision) {await page.getByRole('button', {name: '결과 파일 저장', exact: true}).click(); await page.locator('#delivery[data-revision="' + revision + '"]').waitFor();}
async function pageCanvas(frame, index) {
  const canvases = frame.locator('#scroll-container canvas');
  const order = await canvases.evaluateAll(elements => elements.map((element, position) => ({position, top: parseFloat(element.style.top)})).sort((a, b) => a.top - b.top).map(entry => entry.position));
  return canvases.nth(order[index]);
}
async function clickText(frame, source, text) {
  const tree = JSON.parse(source.getPageRenderTree(0));
  let found = null; (function visit(node) {if (node.type === 'TextRun' && node.text === text) found = node.bbox; for (const child of node.children || []) visit(child);})(tree);
  assert(found, 'rendered text ' + text);
  const hit = JSON.parse(source.hitTest(0, found.x + found.w / 2, found.y + found.h / 2));
  assert.equal(hit.cellPath.length, 3, 'The hit must carry the three-level path');
  const canvas = await pageCanvas(frame, 0);
  const size = await canvas.evaluate(el => ({width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height}));
  await canvas.click({position: {x: (found.x + found.w / 2) * size.width / tree.bbox.w, y: (found.y + found.h / 2) * size.height / tree.bbox.h}});
}
const read = doc => ({
  text: doc.getTextFileUnicode(true), pages: doc.pageCount(),
  deep: doc.getTextInCellByPath(0, 1, json(deepPath), 0, 100), deepChar: JSON.parse(doc.getCellCharPropertiesAtByPath(0, 1, json(deepPath), 0)),
  deepKeep: doc.getTextInCellByPath(0, 1, json(deepKeepPath), 0, 100), deepKeepChar: doc.getCellCharPropertiesAtByPath(0, 1, json(deepKeepPath), 0),
  boxText: doc.getTextInCellByPath(0, 1, json([outerCell, boxCell]), 0, 100), outer0: doc.getTextInCellByPath(0, 1, json([outerCell]), 0, 100), outer1: doc.getTextInCellByPath(0, 1, json([{controlIndex: 0, cellIndex: 1, cellParaIndex: 0}]), 0, 100),
  shape: doc.getCellShapePropertiesByPath(0, 1, json([outerCell]), 0), table: doc.getTableProperties(0, 1, 0),
});
function verify(source, result, edited) {
  const before = read(source), after = read(result);
  for (const key of ['pages', 'deepKeep', 'deepKeepChar', 'boxText', 'outer0', 'outer1', 'shape', 'table']) assert.deepEqual(after[key], before[key], key + ' must stay untouched');
  assert.equal(after.deep, edited ? 'DEEP-TARGET-TYPED' : 'DEEP-TARGET');
  assert.equal(after.deepChar.bold, edited);
  if (edited) assert.equal(JSON.parse(result.getCellCharPropertiesAtByPath(0, 1, json(deepPath), 10)).bold, true, 'the whole original word stays bold');
  const strip = props => {const copy = {...props}; delete copy.bold; delete copy.charShapeId; return copy;};
  assert.deepEqual(strip(after.deepChar), strip(before.deepChar));
  assert.equal(after.text, edited ? before.text.replace('DEEP-TARGET', 'DEEP-TARGET-TYPED') : before.text);
}
try {
  await new Promise((resolve, reject) => {child.stdout.on('data', chunk => {if (String(chunk).includes('http://')) resolve();}); child.stderr.on('data', chunk => process.stderr.write(chunk)); child.on('exit', code => reject(new Error('server exited ' + code)));});
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined});
  const context = await browser.newContext({viewport: {width: 1280, height: 1050}});
  context.on('page', page => {page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => {if (['warning', 'error'].includes(message.type())) report.warnings.push(message.text());}); page.on('request', request => {if (!request.url().startsWith(base)) report.externalRequests.push(request.url());});});
  for (const entry of data.documents) {
    const source = new HwpDocument(await readFile(entry.source)), page = await context.newPage(), frame = page.frameLocator('#editor iframe');
    const check = async edited => {const saved = new HwpDocument(await readFile(entry.output)); try {verify(source, saved, edited);} finally {saved.free();}};
    const input = frame.getByRole('textbox', {name: '문서 편집 입력', exact: true});
    try {
      await page.goto(base + '/editor?id=' + entry.id); await ready(page);
      // Format first, then type: after typing in this table-shape-table path, keyboard Home/End selection lands in the sibling cell (recorded observation).
      await clickText(frame, source, 'DEEP-TARGET');
      await input.press('Home');
      for (let i = 0; i < 'DEEP-TARGET'.length; i++) await input.press('Shift+ArrowRight');
      await frame.getByRole('button', {name: '굵게', exact: true}).click();
      await input.press('End'); await input.pressSequentially('-TYPED');
      await save(page, 1); await check(true);
      pass(entry.name + ' typing and bold in a table inside a text box inside a table cell keep the three-level path and the surroundings');
      await frame.locator('#menu-bar').getByText('편집', {exact: true}).click(); await frame.locator('#menu-bar').getByText('되돌리기', {exact: true}).click();
      await frame.locator('#menu-bar').getByText('편집', {exact: true}).click(); await frame.locator('#menu-bar').getByText('되돌리기', {exact: true}).click();
      await save(page, 2); await check(false);
      await frame.locator('#menu-bar').getByText('편집', {exact: true}).click(); await frame.locator('#menu-bar').getByText('다시 실행', {exact: true}).click();
      await frame.locator('#menu-bar').getByText('편집', {exact: true}).click(); await frame.locator('#menu-bar').getByText('다시 실행', {exact: true}).click();
      await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
      await page.reload(); await ready(page); await save(page, 3); await check(true);
      pass(entry.name + ' deep-table edits undo, redo and recover through the journal');
      await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page); await check(true);
      assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);
      const receipt = JSON.parse(await readFile(entry.output + '.receipt.json'));
      assert.equal(receipt.outputSha256, digest(await readFile(entry.output))); assert.equal(receipt.contentLoss.count, 0);
      pass(entry.name + ' saved deep-table result reopens with source and receipt hashes intact');
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
