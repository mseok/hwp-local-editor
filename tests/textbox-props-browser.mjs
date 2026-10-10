import {createRequire} from 'node:module';
import {readFile, writeFile, mkdir, mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspace, digest} from '../app/workspace.mjs';
import {initSync, HwpDocument} from '../.build/core/rhwp.js';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH || import.meta.url), {chromium} = require('playwright');
await mkdir('test-results', {recursive: true});
const root = await mkdtemp(path.resolve('test-results/textbox-props-'));
initSync({module: await readFile('.build/core/rhwp_bg.wasm')});
const json = JSON.stringify, blank = await readFile('.cache/rhwp/saved/blank2010.hwp');
const boxPath = [{controlIndex: 0, cellIndex: 0, cellParaIndex: 0}];
const files = [];
{
  const d = new HwpDocument(blank);
  try {
    d.createBlankDocument(); d.insertText(0, 0, 0, 'BODY-KEEP'); d.splitParagraph(0, 0, 'BODY-KEEP'.length);
    d.insertText(0, 1, 0, 'HOST-KEEP'); d.splitParagraph(0, 1, 'HOST-KEEP'.length);
    const shape = JSON.parse(d.createShapeControl(json({sectionIdx: 0, paraIdx: 1, charOffset: 0, width: 30000, height: 10000, treatAsChar: true, shapeType: 'textbox', horzOffset: 0, vertOffset: 0})));
    assert.equal(shape.paraIdx, 1); assert.equal(shape.controlIdx, 0);
    d.insertTextInCell(0, 1, 0, 0, 0, 0, 'BOX-TEXT');
    for (const format of ['hwp', 'hwpx']) {
      const file = path.join(root, 'textbox-props.' + format);
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
async function save(page, revision) {await page.getByRole('button', {name: '결과 파일 저장', exact: true}).click(); await page.locator('#delivery[data-revision="' + revision + '"]').waitFor();}
async function editMenu(frame, label) {await frame.locator('#menu-bar').getByText('편집', {exact: true}).click(); await frame.locator('#menu-bar').getByText(label, {exact: true}).click();}
async function pageCanvas(frame, index) {
  const canvases = frame.locator('#scroll-container canvas');
  const order = await canvases.evaluateAll(elements => elements.map((element, position) => ({position, top: parseFloat(element.style.top)})).sort((a, b) => a.top - b.top).map(entry => entry.position));
  return canvases.nth(order[index]);
}
async function selectBox(frame, source) {
  const tree = JSON.parse(source.getPageRenderTree(0));
  let found = null;
  (function visit(node, ancestors = []) {if (node.type === 'TextRun' && node.text === 'BOX-TEXT') found = {node, ancestors}; for (const child of node.children || []) visit(child, [...ancestors, node]);})(tree);
  assert(found, 'The text box text must be rendered');
  const b = found.node.bbox, shape = found.ancestors.findLast(n => n.type === 'Rect').bbox;
  const canvas = await pageCanvas(frame, 0);
  const size = await canvas.evaluate(el => ({width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height}));
  await canvas.click({position: {x: (shape.x + shape.w - 1) * size.width / tree.bbox.w, y: (b.y + b.h / 2) * size.height / tree.bbox.h}});
  assert((await frame.locator('.table-object-layer > div').count()) >= 8, 'The text box must be selected');
}
const colorRef = hex => {const v = hex.replace('#', ''); return (parseInt(v.slice(4, 6), 16) << 16) | (parseInt(v.slice(2, 4), 16) << 8) | parseInt(v.slice(0, 2), 16);};
const changedKeys = ['borderWidth', 'borderColor', 'fillType', 'fillBgColor', 'fillPatColor', 'fillPatType', 'fillAlpha'];
const strip = (props, keys) => {const copy = {...props}; for (const key of keys) delete copy[key]; return copy;};
const read = doc => ({
  shape: JSON.parse(doc.getShapeProperties(0, 1, 0)), text: doc.getTextFileUnicode(true), pages: doc.pageCount(),
  boxChar: doc.getCellCharPropertiesAtByPath(0, 1, json(boxPath), 0), boxPara: doc.getCellParaPropertiesAtByPath(0, 1, json(boxPath)),
  bodyChar: doc.getCharPropertiesAt(0, 0, 0), hostChar: doc.getCharPropertiesAt(0, 1, 1), hostPara: doc.getParaPropertiesAt(0, 1),
});
function verify(source, result, expected) {
  const before = read(source), after = read(result);
  for (const key of ['text', 'pages', 'boxChar', 'boxPara', 'bodyChar', 'hostChar', 'hostPara']) assert.equal(after[key], before[key], key + ' must stay untouched');
  assert.deepEqual(strip(after.shape, changedKeys), strip(before.shape, changedKeys), 'other shape properties must stay untouched');
  if (expected) {
    assert.equal(after.shape.borderWidth, expected.borderWidth); assert.equal(after.shape.borderColor, expected.borderColor);
    assert.equal(after.shape.fillType, 'solid'); assert.equal(after.shape.fillBgColor, expected.fillBgColor);
  } else {
    for (const key of changedKeys) assert.deepEqual(after.shape[key], before.shape[key], key + ' must be restored');
  }
}
try {
  await new Promise((resolve, reject) => {child.stdout.on('data', chunk => {if (String(chunk).includes('http://')) resolve();}); child.stderr.on('data', chunk => process.stderr.write(chunk)); child.on('exit', code => reject(new Error('server exited ' + code)));});
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined});
  const context = await browser.newContext({viewport: {width: 1280, height: 1050}});
  context.on('page', page => {page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => {if (['warning', 'error'].includes(message.type())) report.warnings.push(message.text());}); page.on('request', request => {if (!request.url().startsWith(base)) report.externalRequests.push(request.url());});});
  for (const entry of data.documents) {
    const source = new HwpDocument(await readFile(entry.source)), page = await context.newPage(), frame = page.frameLocator('#editor iframe');
    const expected = {borderWidth: Math.round(0.5 * 7200 / 25.4), borderColor: colorRef('#ff0000'), fillBgColor: colorRef('#ffff00')};
    const check = async (edited) => {const saved = new HwpDocument(await readFile(entry.output)); try {verify(source, saved, edited ? expected : null);} finally {saved.free();}};
    try {
      await page.goto(base + '/editor?id=' + entry.id); await ready(page);
      await selectBox(frame, source);
      await frame.getByRole('button', {name: '개체 속성', exact: true}).click();
      await frame.getByRole('spinbutton', {name: '개체 너비(mm)', exact: true}).waitFor();
      await frame.getByRole('button', {name: '선', exact: true}).click();
      await frame.getByRole('spinbutton', {name: '선 굵기(mm)', exact: true}).fill('0.5');
      await frame.getByLabel('선 색', {exact: true}).fill('#ff0000');
      await frame.getByRole('button', {name: '채우기', exact: true}).click();
      await frame.getByRole('radio', {name: '단색 채우기', exact: true}).check();
      await frame.getByLabel('채우기 면 색', {exact: true}).fill('#ffff00');
      await frame.getByRole('button', {name: '설정(D)', exact: true}).click();
      await save(page, 1); await check(true);
      pass(entry.name + ' text-box line width, line colour and solid fill through 개체 속성 keep the text and other properties');
      await editMenu(frame, '되돌리기'); await save(page, 2); await check(false);
      await editMenu(frame, '다시 실행');
      await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
      await page.reload(); await ready(page); await save(page, 3); await check(true);
      pass(entry.name + ' text-box line and fill undo, redo and journal recovery preserve the target');
      await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page); await check(true);
      const reopened = new HwpDocument(await readFile(entry.output));
      try {await selectBox(frame, reopened);} finally {reopened.free();}
      await frame.getByRole('button', {name: '개체 속성', exact: true}).click();
      await frame.getByRole('button', {name: '선', exact: true}).click();
      assert.equal(Number(await frame.getByRole('spinbutton', {name: '선 굵기(mm)', exact: true}).inputValue()).toFixed(2), '0.50');
      assert.equal(await frame.getByLabel('선 색', {exact: true}).inputValue(), '#ff0000');
      await frame.getByRole('button', {name: '채우기', exact: true}).click();
      assert.equal(await frame.getByRole('radio', {name: '단색 채우기', exact: true}).isChecked(), true);
      assert.equal(await frame.getByLabel('채우기 면 색', {exact: true}).inputValue(), '#ffff00');
      await frame.getByRole('button', {name: '설정(D)', exact: true}).click();
      await save(page, 4); await check(true);
      assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);
      const receipt = JSON.parse(await readFile(entry.output + '.receipt.json'));
      assert.equal(receipt.outputSha256, digest(await readFile(entry.output))); assert.equal(receipt.contentLoss.count, 0);
      pass(entry.name + ' reopened text-box line and fill show in the dialog and an unchanged confirmation keeps hashes');
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
