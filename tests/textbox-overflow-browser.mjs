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
const root = await mkdtemp(path.resolve('test-results/textbox-overflow-'));
initSync({module: await readFile('.build/core/rhwp_bg.wasm')});
const json = JSON.stringify, blank = await readFile('.cache/rhwp/saved/blank2010.hwp');
const boxPath = [{controlIndex: 0, cellIndex: 0, cellParaIndex: 0}, {controlIndex: 0, cellIndex: 0, cellParaIndex: 0}];
const files = [];
function geometry(doc) {
  const tree = JSON.parse(doc.getPageRenderTree(0));
  let rect = null, cell = null, after = null, first = null; const lines = [];
  (function visit(node, ancestors = []) {
    if (node.type === 'TextRun' && node.text === 'BOX-FIRST') {first = node.bbox; rect = ancestors.findLast(n => n.type === 'Rect').bbox; cell = ancestors.filter(n => n.type === 'Cell').at(-1).bbox;}
    if (node.type === 'TextRun' && node.text.startsWith('BOX-')) lines.push({text: node.text, bbox: node.bbox});
    if (node.type === 'TextRun' && node.text === 'AFTER-TABLE') after = node.bbox;
    for (const child of node.children || []) visit(child, [...ancestors, node]);
  })(tree);
  assert(rect && cell && after && first && lines.length === 3, 'fixture geometry');
  return {tree, rect, cell, after, first, lines};
}
{
  const box = new HwpDocument(blank), owner = new HwpDocument(blank);
  try {
    box.createBlankDocument();
    const shape = JSON.parse(box.createShapeControl(json({sectionIdx: 0, paraIdx: 0, charOffset: 0, width: 20000, height: 10000, treatAsChar: true, shapeType: 'textbox', horzOffset: 0, vertOffset: 0})));
    for (const [i, text] of ['BOX-FIRST', 'BOX-SECOND', 'BOX-THIRD'].entries()) {if (i) box.splitParagraphInCell(0, 0, shape.controlIdx, 0, i - 1, box.getCellParagraphLength(0, 0, shape.controlIdx, 0, i - 1)); box.insertTextInCell(0, 0, shape.controlIdx, 0, i, 0, text);}
    const shapeXml = unzip(Buffer.from(box.exportHwpx())).get('Contents/section0.xml').toString().match(/<hp:rect\b[\s\S]*?<\/hp:rect>/)[0];
    owner.createBlankDocument(); owner.insertText(0, 0, 0, 'BODY-KEEP'); owner.splitParagraph(0, 0, 'BODY-KEEP'.length);
    owner.splitParagraph(0, 1, 0); owner.insertText(0, 2, 0, 'AFTER-TABLE');
    owner.createTableEx(json({sectionIdx: 0, paraIdx: 1, charOffset: 0, rowCount: 1, colCount: 2, treatAsChar: true, colWidths: [34000, 8500]}));
    owner.insertTextInCell(0, 1, 0, 0, 0, 0, 'OUTER-0'); owner.insertTextInCell(0, 1, 0, 1, 0, 0, 'OUTER-1');
    const entries = unzip(Buffer.from(owner.exportHwpx())), section = entries.get('Contents/section0.xml').toString();
    entries.set('Contents/section0.xml', Buffer.from(section.replace('<hp:t>OUTER-0</hp:t>', shapeXml + '<hp:t>OUTER-0</hp:t>')));
    const nested = new HwpDocument(zip(entries));
    try {
      assert.equal(nested.getTextInCellByPath(0, 1, json(boxPath), 0, 100), 'BOX-FIRST');
      const g = geometry(nested);
      assert(g.rect.y + g.rect.h > g.cell.y + g.cell.h + 40, 'The text box must overflow its cell vertically');
      assert(g.after.y < g.rect.y + g.rect.h && g.after.y + g.after.h > g.cell.y + g.cell.h, 'The following paragraph must sit inside the overflow band');
      for (const format of ['hwp', 'hwpx']) {
        const file = path.join(root, 'textbox-overflow.' + format);
        await writeFile(file, format === 'hwp' ? nested.exportHwp() : nested.exportHwpx()); files.push(file);
      }
    } finally {nested.free();}
  } finally {box.free(); owner.free();}
}
const data = await createWorkspace(files, path.join(root, 'output')), manifest = path.join(root, 'workspace.json');
await writeFile(manifest, json(data));
const port = 18876, base = 'http://127.0.0.1:' + port;
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
const read = doc => ({
  text: doc.getTextFileUnicode(true), pages: doc.pageCount(), shape: doc.getCellShapePropertiesByPath(0, 1, json([{controlIndex: 0, cellIndex: 0, cellParaIndex: 0}]), 0),
  table: doc.getTableProperties(0, 1, 0), cells: [0, 1].map(i => doc.getCellProperties(0, 1, 0, i)),
  paragraphs: [0, 1, 2].map(i => doc.getTextInCellByPath(0, 1, json([boxPath[0], {...boxPath[1], cellParaIndex: i}]), 0, 100)),
  outer0: doc.getTextInCellByPath(0, 1, json([boxPath[0]]), 0, 100), outer1: doc.getTextInCellByPath(0, 1, json([{controlIndex: 0, cellIndex: 1, cellParaIndex: 0}]), 0, 100),
});
function verify(source, result, typed, target) {
  const before = read(source), after = read(result);
  for (const key of ['pages', 'shape', 'table', 'cells', 'outer0', 'outer1']) assert.deepEqual(after[key], before[key], key + ' must stay untouched');
  for (let i = 0; i < 3; i++) assert.equal(after.paragraphs[i], typed && i === target ? before.paragraphs[i] + typed : before.paragraphs[i], 'box paragraph ' + i);
  assert.equal((after.text.match(/AFTER-TABLE/g) || []).length, 1); assert.equal(after.text.includes('AFTER-TABLE-TYPED'), false, 'the following paragraph must not receive the typed text');
  assert.equal(after.text, typed ? before.text.replace(before.paragraphs[target], before.paragraphs[target] + typed) : before.text);
}
try {
  await new Promise((resolve, reject) => {child.stdout.on('data', chunk => {if (String(chunk).includes('http://')) resolve();}); child.stderr.on('data', chunk => process.stderr.write(chunk)); child.on('exit', code => reject(new Error('server exited ' + code)));});
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined});
  const context = await browser.newContext({viewport: {width: 1280, height: 1050}});
  context.on('page', page => {page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => {if (['warning', 'error'].includes(message.type())) report.warnings.push(message.text());}); page.on('request', request => {if (!request.url().startsWith(base)) report.externalRequests.push(request.url());});});
  for (const entry of data.documents) {
    const source = new HwpDocument(await readFile(entry.source)), page = await context.newPage(), frame = page.frameLocator('#editor iframe');
    let target = 0;
    const check = async typed => {const saved = new HwpDocument(await readFile(entry.output)); try {verify(source, saved, typed, target);} finally {saved.free();}};
    try {
      await page.goto(base + '/editor?id=' + entry.id); await ready(page);
      const g = geometry(source);
      // Click the blank band of the text box that lies below its cell and over the following paragraph.
      // Click the centre of the box line that lies below the cell bottom and closest to the following body paragraph.
      const candidates = g.lines.map((l, index) => ({index, center: l.bbox.y + l.bbox.h / 2})).filter(l => l.center > g.cell.y + g.cell.h + 2);
      assert(candidates.length > 0, 'At least one box line must lie below the cell bottom');
      const chosen = candidates.sort((a, b) => Math.abs(a.center - (g.after.y + g.after.h / 2)) - Math.abs(b.center - (g.after.y + g.after.h / 2)))[0];
      target = chosen.index;
      const point = {x: Math.max(g.rect.x + 20, g.after.x + g.after.w / 2), y: chosen.center};
      assert(point.x < g.rect.x + g.rect.w, 'The click must stay inside the box horizontally');
      assert(point.y > g.cell.y + g.cell.h && point.y < g.rect.y + g.rect.h, 'The click must be below the cell and inside the box');
      console.log('overflow click', entry.name, 'line', target, 'y', point.y.toFixed(1), 'cell bottom', (g.cell.y + g.cell.h).toFixed(1), 'following paragraph band', g.after.y.toFixed(1), (g.after.y + g.after.h).toFixed(1));
      const hit = JSON.parse(source.hitTest(0, point.x, point.y));
      assert.equal(hit.isTextBox, true, 'The engine must resolve the overflow band to the text box');
      assert.equal(hit.cellPath.at(-1).cellParaIndex, target, 'The hit must land on the chosen box line');
      const canvas = await pageCanvas(frame, 0);
      const size = await canvas.evaluate(el => ({width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height}));
      await canvas.click({position: {x: point.x * size.width / g.tree.bbox.w, y: point.y * size.height / g.tree.bbox.h}});
      const input = frame.getByRole('textbox', {name: '문서 편집 입력', exact: true});
      await input.press('End'); await input.pressSequentially('-TYPED');
      await save(page, 1); await check('-TYPED');
      pass(entry.name + ' clicking the text box band that overflows its cell over the next paragraph enters the box line under the click, not the body');
      await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page); await check('-TYPED');
      assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);
      const receipt = JSON.parse(await readFile(entry.output + '.receipt.json'));
      assert.equal(receipt.outputSha256, digest(await readFile(entry.output))); assert.equal(receipt.contentLoss.count, 0);
      pass(entry.name + ' the overflow-band edit reopens with source and receipt hashes intact');
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
