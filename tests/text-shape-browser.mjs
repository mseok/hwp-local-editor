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
const root = await mkdtemp(path.resolve('test-results/text-shape-'));
initSync({module: await readFile('.build/core/rhwp_bg.wasm')});
const json = JSON.stringify, blank = await readFile('.cache/rhwp/saved/blank2010.hwp');
const innerPath = [{controlIndex: 0, cellIndex: 0, cellParaIndex: 0}, {controlIndex: 0, cellIndex: 0, cellParaIndex: 0}];
const keepPath = [{controlIndex: 0, cellIndex: 0, cellParaIndex: 0}, {controlIndex: 0, cellIndex: 1, cellParaIndex: 0}];
const outerPath = [{controlIndex: 0, cellIndex: 0, cellParaIndex: 0}];
const outerKeepPath = [{controlIndex: 0, cellIndex: 1, cellParaIndex: 0}];
const boxPath = [{controlIndex: 0, cellIndex: 0, cellParaIndex: 0}], boxKeepPath = [{controlIndex: 0, cellIndex: 0, cellParaIndex: 1}];
const files = [];
{
  const owner = new HwpDocument(blank), inner = new HwpDocument(blank);
  try {
    owner.createBlankDocument(); owner.insertText(0, 0, 0, 'BODY-TARGET'); owner.splitParagraph(0, 0, 'BODY-TARGET'.length);
    owner.insertText(0, 1, 0, 'BODY-KEEP'); owner.splitParagraph(0, 1, 'BODY-KEEP'.length);
    owner.createTableEx(json({sectionIdx: 0, paraIdx: 2, charOffset: 0, rowCount: 1, colCount: 2, treatAsChar: true, colWidths: [30000, 12000]}));
    owner.insertTextInCell(0, 2, 0, 0, 0, 0, 'OUTER-TARGET'); owner.insertTextInCell(0, 2, 0, 1, 0, 0, 'OUTER-KEEP');
    inner.createBlankDocument();
    const created = JSON.parse(inner.createTableEx(json({sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: 1, colCount: 2, treatAsChar: true, colWidths: [12000, 12000]})));
    inner.insertTextInCell(0, 0, created.controlIdx, 0, 0, 0, 'INNER-TARGET'); inner.insertTextInCell(0, 0, created.controlIdx, 1, 0, 0, 'INNER-KEEP');
    const innerXml = unzip(Buffer.from(inner.exportHwpx())).get('Contents/section0.xml').toString().match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0].replace(/\bid="\d+"/g, match => `id="${1000 + Number(match.match(/\d+/)[0])}"`);
    const entries = unzip(Buffer.from(owner.exportHwpx())), section = entries.get('Contents/section0.xml').toString();
    assert.ok(section.includes('<hp:t>OUTER-TARGET</hp:t>'));
    entries.set('Contents/section0.xml', Buffer.from(section.replace('<hp:t>OUTER-TARGET</hp:t>', innerXml + '<hp:t>OUTER-TARGET</hp:t>')));
    const nested = new HwpDocument(zip(entries));
    try {
      assert.equal(nested.getTextInCellByPath(0, 2, json(innerPath), 0, 100), 'INNER-TARGET');
      assert.equal(nested.getTextInCellByPath(0, 2, json(keepPath), 0, 100), 'INNER-KEEP');
      for (const format of ['hwp', 'hwpx']) {
        const file = path.join(root, 'text-shape.' + format);
        await writeFile(file, format === 'hwp' ? nested.exportHwp() : nested.exportHwpx()); files.push(file);
      }
    } finally {nested.free();}
  } finally {owner.free(); inner.free();}
}
{
  const owner = new HwpDocument(blank);
  try {
    owner.createBlankDocument(); owner.insertText(0, 0, 0, 'BODY-TARGET'); owner.splitParagraph(0, 0, 'BODY-TARGET'.length);
    owner.insertText(0, 1, 0, 'BODY-KEEP'); owner.splitParagraph(0, 1, 'BODY-KEEP'.length);
    owner.insertText(0, 2, 0, 'HOST-KEEP'); owner.splitParagraph(0, 2, 'HOST-KEEP'.length);
    const shape = JSON.parse(owner.createShapeControl(json({sectionIdx: 0, paraIdx: 2, charOffset: 0, width: 30000, height: 10000, treatAsChar: true, shapeType: 'textbox', horzOffset: 0, vertOffset: 0})));
    assert.equal(shape.paraIdx, 2); assert.equal(shape.controlIdx, 0);
    owner.insertTextInCell(0, 2, 0, 0, 0, 0, 'BOX-TARGET');
    owner.splitParagraphInCell(0, 2, 0, 0, 0, 'BOX-TARGET'.length); owner.insertTextInCell(0, 2, 0, 0, 1, 0, 'BOX-KEEP');
    assert.equal(owner.getTextInCellByPath(0, 2, json(boxPath), 0, 100), 'BOX-TARGET');
    for (const format of ['hwp', 'hwpx']) {
      const file = path.join(root, 'text-shape-box.' + format);
      await writeFile(file, format === 'hwp' ? owner.exportHwp() : owner.exportHwpx()); files.push(file);
    }
  } finally {owner.free();}
}
const data = await createWorkspace(files, path.join(root, 'output')), manifest = path.join(root, 'workspace.json');
await writeFile(manifest, json(data));
const port = 18872, base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['app/server.mjs'], {env: {...process.env, PORT: String(port), DOCUMENT_MANIFEST: manifest}, stdio: ['ignore', 'pipe', 'pipe']});
let browser;
const report = {root, checks: [], errors: [], warnings: [], externalRequests: []};
const ready = p => p.waitForFunction(() => window.editorReady, null, {timeout: 45000});
const pass = name => {report.checks.push(name); console.log('PASS', name);};
async function save(page, revision) {await page.getByRole('button', {name: '결과 파일 저장', exact: true}).click(); await page.locator('#delivery[data-revision="' + revision + '"]').waitFor();}
async function menu(frame, label) {await frame.locator('#menu-bar .menu-title').filter({hasText: '서식'}).click(); await frame.locator('#menu-bar').getByText(label, {exact: true}).click();}
async function editMenu(frame, label) {await frame.locator('#menu-bar').getByText('편집', {exact: true}).click(); await frame.locator('#menu-bar').getByText(label, {exact: true}).click();}
async function select(page, frame, text) {
  await page.getByRole('button', {name: '찾아 바꾸기', exact: true}).click();
  await frame.getByRole('textbox', {name: '찾을 내용', exact: true}).fill(text);
  await frame.getByRole('button', {name: '다음 찾기', exact: true}).click();
  await frame.getByText('검색 결과 1개', {exact: true}).waitFor({timeout: 5000});
  await frame.getByRole('button', {name: '찾아 바꾸기 닫기', exact: true}).click();
}
async function setCharShape(frame, {font, size}) {
  await menu(frame, '글자 모양');
  const dialog = frame.locator('.cs-dialog'), fontSelect = dialog.getByRole('combobox', {name: '글자 모양 글꼴', exact: true});
  await fontSelect.waitFor({timeout: 5000});
  let chosen = null;
  if (font) {
    const current = await fontSelect.inputValue();
    const options = await fontSelect.locator('optgroup[label="웹 글꼴"] option').evaluateAll(elements => elements.map(element => element.value));
    chosen = options.find(value => value && value !== current);
    assert(chosen, 'The dialog must offer a different web font');
    await fontSelect.selectOption(chosen);
  }
  if (size) await dialog.getByRole('spinbutton', {name: '글자 모양 기준 크기(pt)', exact: true}).fill(String(size));
  await dialog.getByRole('button', {name: '설정(D)', exact: true}).click();
  return chosen;
}
async function setLineSpacing(frame, percent) {
  await menu(frame, '문단 모양');
  const dialog = frame.locator('.ps-dialog'), input = dialog.getByRole('spinbutton', {name: '문단 모양 줄 간격', exact: true});
  await input.waitFor({timeout: 5000});
  assert.equal(await dialog.getByRole('combobox', {name: '문단 모양 줄 간격 종류', exact: true}).inputValue(), 'Percent');
  await input.fill(String(percent));
  await dialog.getByRole('button', {name: '설정(D)', exact: true}).click();
}
// Page canvases are recycled after layout changes, so pick the canvas by vertical position.
async function pageCanvas(frame, index) {
  const canvases = frame.locator('#scroll-container canvas');
  const order = await canvases.evaluateAll(elements => elements.map((element, position) => ({position, top: parseFloat(element.style.top)})).sort((a, b) => a.top - b.top).map(entry => entry.position));
  assert(index < order.length, 'The requested page must have a rendered canvas');
  return canvases.nth(order[index]);
}
async function selectBoxText(page, frame, source, text) {
  const texts = [];
  for (let index = 0; index < source.pageCount(); index++) {
    const tree = JSON.parse(source.getPageRenderTree(index));
    (function visit(node, ancestors = []) {if (node.type === 'TextRun' && node.text === text) texts.push({node, tree, index, ancestors}); for (const child of node.children || []) visit(child, [...ancestors, node]);})(tree);
  }
  assert.equal(texts.length, 1);
  const {node, tree, index, ancestors} = texts[0], b = node.bbox;
  assert(ancestors.some(n => n.type === 'TextBox'), 'The target must be rendered inside a text box');
  const canvas = await pageCanvas(frame, index);
  const size = await canvas.evaluate(el => ({width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height}));
  await canvas.dblclick({position: {x: (b.x + b.w / 2) * size.width / tree.bbox.w, y: (b.y + b.h / 2) * size.height / tree.bbox.h}});
  const input = frame.getByRole('textbox', {name: '문서 편집 입력', exact: true});
  await input.press('Home');
  for (let i = 0; i < text.length; i++) await input.press('Shift+ArrowRight');
}
const charKeys = ['fontFamily', 'fontFamilies', 'fontSize', 'charShapeId', 'fontId', 'fontIds', 'borderFillId'];
const paraKeys = ['lineSpacing', 'paraShapeId', 'borderFillId'];
const strip = (props, keys) => {const copy = {...props}; for (const key of keys) delete copy[key]; return copy;};
const readBox = doc => ({
  bodyChar: JSON.parse(doc.getCharPropertiesAt(0, 0, 0)), bodyPara: JSON.parse(doc.getParaPropertiesAt(0, 0)),
  bodyKeepChar: JSON.parse(doc.getCharPropertiesAt(0, 1, 0)), bodyKeepPara: JSON.parse(doc.getParaPropertiesAt(0, 1)),
  hostChar: JSON.parse(doc.getCharPropertiesAt(0, 2, 1)), hostPara: JSON.parse(doc.getParaPropertiesAt(0, 2)),
  boxChar: JSON.parse(doc.getCellCharPropertiesAtByPath(0, 2, json(boxPath), 0)), boxPara: JSON.parse(doc.getCellParaPropertiesAtByPath(0, 2, json(boxPath))),
  boxKeepChar: JSON.parse(doc.getCellCharPropertiesAtByPath(0, 2, json(boxKeepPath), 0)), boxKeepPara: JSON.parse(doc.getCellParaPropertiesAtByPath(0, 2, json(boxKeepPath))),
  shape: doc.getShapeProperties(0, 2, 0), text: doc.getTextFileUnicode(true), pages: doc.pageCount(),
});
function verifyBox(source, result, expected) {
  const before = readBox(source), after = readBox(result);
  assert.equal(after.text, before.text); assert.equal(after.pages, before.pages); assert.equal(after.shape, before.shape);
  for (const key of ['bodyKeepChar', 'hostChar', 'boxKeepChar', 'bodyChar']) assert.deepEqual(after[key], before[key], key + ' must stay untouched');
  for (const key of ['bodyKeepPara', 'hostPara', 'boxKeepPara', 'bodyPara']) assert.deepEqual(after[key], before[key], key + ' must stay untouched');
  assert.deepEqual(strip(after.boxChar, charKeys), strip(before.boxChar, charKeys), 'boxChar must keep its other character properties');
  if (expected.boxChar) {assert.equal(after.boxChar.fontSize, expected.boxChar.fontSize); assert.equal(after.boxChar.fontFamily, expected.boxChar.font); assert.equal(after.boxChar.fontFamilies[0], expected.boxChar.font);}
  else {assert.equal(after.boxChar.fontSize, before.boxChar.fontSize); assert.deepEqual(after.boxChar.fontFamilies, before.boxChar.fontFamilies);}
  assert.deepEqual(strip(after.boxPara, paraKeys), strip(before.boxPara, paraKeys), 'boxPara must keep its other paragraph properties');
  assert.equal(after.boxPara.lineSpacing, expected.boxPara ? expected.boxPara.lineSpacing : before.boxPara.lineSpacing);
}
const read = doc => ({
  bodyChar: JSON.parse(doc.getCharPropertiesAt(0, 0, 0)), bodyPara: JSON.parse(doc.getParaPropertiesAt(0, 0)),
  bodyKeepChar: JSON.parse(doc.getCharPropertiesAt(0, 1, 0)), bodyKeepPara: JSON.parse(doc.getParaPropertiesAt(0, 1)),
  innerChar: JSON.parse(doc.getCellCharPropertiesAtByPath(0, 2, json(innerPath), 0)), innerPara: JSON.parse(doc.getCellParaPropertiesAtByPath(0, 2, json(innerPath))),
  keepChar: JSON.parse(doc.getCellCharPropertiesAtByPath(0, 2, json(keepPath), 0)), keepPara: JSON.parse(doc.getCellParaPropertiesAtByPath(0, 2, json(keepPath))),
  outerChar: JSON.parse(doc.getCellCharPropertiesAtByPath(0, 2, json(outerPath), 1)), outerPara: JSON.parse(doc.getCellParaPropertiesAtByPath(0, 2, json(outerPath))),
  outerKeepChar: JSON.parse(doc.getCellCharPropertiesAtByPath(0, 2, json(outerKeepPath), 0)), outerKeepPara: JSON.parse(doc.getCellParaPropertiesAtByPath(0, 2, json(outerKeepPath))),
  text: doc.getTextFileUnicode(true), pages: doc.pageCount(), table: doc.getTableProperties(0, 2, 0), innerTable: doc.getTablePropertiesByPath(0, 2, json(outerPath)),
});
function verify(source, result, expected) {
  const before = read(source), after = read(result);
  assert.equal(after.text, before.text); assert.equal(after.pages, before.pages); assert.equal(after.table, before.table); assert.equal(after.innerTable, before.innerTable);
  for (const key of ['bodyKeepChar', 'keepChar', 'outerChar', 'outerKeepChar']) assert.deepEqual(after[key], before[key], key + ' must stay untouched');
  for (const key of ['bodyKeepPara', 'keepPara', 'outerPara', 'outerKeepPara']) assert.deepEqual(after[key], before[key], key + ' must stay untouched');
  for (const [key, change] of [['bodyChar', expected.bodyChar], ['innerChar', expected.innerChar]]) {
    assert.deepEqual(strip(after[key], charKeys), strip(before[key], charKeys), key + ' must keep its other character properties');
    if (change) {
      assert.equal(after[key].fontSize, change.fontSize, key + ' size');
      if (change.font) {assert.equal(after[key].fontFamily, change.font, key + ' font'); assert.equal(after[key].fontFamilies[0], change.font, key + ' hangul font');}
      else assert.deepEqual(after[key].fontFamilies, before[key].fontFamilies, key + ' fonts must stay');
    } else {assert.equal(after[key].fontSize, before[key].fontSize); assert.deepEqual(after[key].fontFamilies, before[key].fontFamilies);}
  }
  for (const [key, change] of [['bodyPara', expected.bodyPara], ['innerPara', expected.innerPara]]) {
    assert.deepEqual(strip(after[key], paraKeys), strip(before[key], paraKeys), key + ' must keep its other paragraph properties');
    assert.equal(after[key].lineSpacing, change ? change.lineSpacing : before[key].lineSpacing, key + ' line spacing');
    assert.equal(after[key].lineSpacingType, 'Percent');
  }
}
try {
  await new Promise((resolve, reject) => {child.stdout.on('data', chunk => {if (String(chunk).includes('http://')) resolve();}); child.stderr.on('data', chunk => process.stderr.write(chunk)); child.on('exit', code => reject(new Error('server exited ' + code)));});
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined});
  const context = await browser.newContext({viewport: {width: 1280, height: 1050}});
  context.on('page', page => {page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => {if (['warning', 'error'].includes(message.type())) report.warnings.push(message.text());}); page.on('request', request => {if (!request.url().startsWith(base)) report.externalRequests.push(request.url());});});
  for (const entry of data.documents.filter(e => e.name.startsWith('text-shape-box.'))) {
    const source = new HwpDocument(await readFile(entry.source)), page = await context.newPage(), frame = page.frameLocator('#editor iframe');
    const check = async (expected) => {const saved = new HwpDocument(await readFile(entry.output)); try {verifyBox(source, saved, expected);} finally {saved.free();}};
    try {
      await page.goto(base + '/editor?id=' + entry.id); await ready(page);
      await selectBoxText(page, frame, source, 'BOX-TARGET');
      const font = await setCharShape(frame, {font: true, size: 14});
      await save(page, 1); await check({boxChar: {font, fontSize: 1400}});
      pass(entry.name + ' text-box font and size change through 글자 모양 preserves the host, body and second box paragraph');
      await selectBoxText(page, frame, source, 'BOX-TARGET'); await setLineSpacing(frame, 200);
      await save(page, 2); await check({boxChar: {font, fontSize: 1400}, boxPara: {lineSpacing: 200}});
      pass(entry.name + ' text-box line spacing through 문단 모양 keeps the other box paragraph');
      await editMenu(frame, '되돌리기'); await editMenu(frame, '되돌리기'); await save(page, 3); await check({});
      await editMenu(frame, '다시 실행'); await editMenu(frame, '다시 실행');
      await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
      await page.reload(); await ready(page); await save(page, 4); await check({boxChar: {font, fontSize: 1400}, boxPara: {lineSpacing: 200}});
      await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page); await check({boxChar: {font, fontSize: 1400}, boxPara: {lineSpacing: 200}});
      assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);
      const receipt = JSON.parse(await readFile(entry.output + '.receipt.json'));
      assert.equal(receipt.outputSha256, digest(await readFile(entry.output))); assert.equal(receipt.contentLoss.count, 0);
      pass(entry.name + ' text-box text shape undo, redo, recovery and reopening preserve the target');
    } finally {source.free(); await page.close();}
  }
  for (const entry of data.documents.filter(e => e.name.startsWith('text-shape.'))) {
    const source = new HwpDocument(await readFile(entry.source)), page = await context.newPage(), frame = page.frameLocator('#editor iframe');
    const check = async (expected) => {const saved = new HwpDocument(await readFile(entry.output)); try {verify(source, saved, expected);} finally {saved.free();}};
    try {
      await page.goto(base + '/editor?id=' + entry.id); await ready(page);
      await select(page, frame, 'INNER-TARGET');
      const font = await setCharShape(frame, {font: true, size: 14});
      await save(page, 1); await check({innerChar: {font, fontSize: 1400}});
      pass(entry.name + ' nested-cell font and size change through 글자 모양 preserves other text and properties');
      await select(page, frame, 'INNER-TARGET'); await setLineSpacing(frame, 200);
      await save(page, 2); await check({innerChar: {font, fontSize: 1400}, innerPara: {lineSpacing: 200}});
      pass(entry.name + ' nested-cell line spacing through 문단 모양 preserves enclosing and unrelated paragraphs');
      await select(page, frame, 'BODY-TARGET'); await setCharShape(frame, {size: 12});
      await select(page, frame, 'BODY-TARGET'); await setLineSpacing(frame, 180);
      await save(page, 3);
      const edited = {innerChar: {font, fontSize: 1400}, innerPara: {lineSpacing: 200}, bodyChar: {fontSize: 1200}, bodyPara: {lineSpacing: 180}};
      await check(edited);
      pass(entry.name + ' body size and line spacing changes keep the nested edits and the untouched paragraph');
      await editMenu(frame, '되돌리기'); await editMenu(frame, '되돌리기'); await save(page, 4);
      await check({innerChar: {font, fontSize: 1400}, innerPara: {lineSpacing: 200}});
      await editMenu(frame, '다시 실행'); await editMenu(frame, '다시 실행');
      await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
      await page.reload(); await ready(page); await save(page, 5); await check(edited);
      pass(entry.name + ' text shape undo, redo and journal recovery preserve the target');
      await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page); await check(edited);
      await select(page, frame, 'INNER-TARGET');
      await menu(frame, '글자 모양');
      assert.equal(await frame.locator('.cs-dialog').getByRole('spinbutton', {name: '글자 모양 기준 크기(pt)', exact: true}).inputValue(), '14.0');
      assert.equal(await frame.locator('.cs-dialog').getByRole('combobox', {name: '글자 모양 글꼴', exact: true}).inputValue(), font);
      await frame.locator('.cs-dialog').getByRole('button', {name: '설정(D)', exact: true}).click();
      await save(page, 6); await check(edited);
      assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);
      const receipt = JSON.parse(await readFile(entry.output + '.receipt.json'));
      assert.equal(receipt.outputSha256, digest(await readFile(entry.output))); assert.equal(receipt.contentLoss.count, 0);
      pass(entry.name + ' saved text shape reopens with the dialog values and an unchanged confirmation keeps hashes');
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
