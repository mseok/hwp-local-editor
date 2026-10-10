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
const root = await mkdtemp(path.resolve('test-results/textbox-format-'));
initSync({module: await readFile('.build/core/rhwp_bg.wasm')});
const d = new HwpDocument(await readFile('.cache/rhwp/saved/blank2010.hwp')), files = [], json = JSON.stringify;
try {
  d.createBlankDocument(); d.insertText(0, 0, 0, 'BODY-UNCHANGED'); d.splitParagraph(0, 0, 14);
  d.insertText(0, 1, 0, 'HOST-UNCHANGED');
  d.splitParagraph(0, 1, 'HOST-UNCHANGED'.length);
  const shape = JSON.parse(d.createShapeControl(json({sectionIdx: 0, paraIdx: 1, charOffset: 0, width: 20000, height: 10000, treatAsChar: true, shapeType: 'textbox', horzOffset: 0, vertOffset: 0})));
  assert.equal(shape.paraIdx, 1); assert.equal(shape.controlIdx, 0);
  d.setShapeProperties(0, 1, 0, json({tbMarginLeft: 284, tbMarginTop: 285, tbMarginRight: 286, tbMarginBottom: 287, outerMarginLeft: 284, outerMarginTop: 285, outerMarginRight: 286, outerMarginBottom: 287}));
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
const shapeXml = unzip(await readFile(files[1])).get('Contents/section0.xml').toString().match(/<hp:rect\b[\s\S]*?<\/hp:rect>/)[0];
for (const depth of [2, 3]) {
  const owner = new HwpDocument(await readFile('.cache/rhwp/saved/blank2010.hwp'));
  try {
    owner.createBlankDocument(); owner.insertText(0, 0, 0, 'BODY-UNCHANGED'); owner.splitParagraph(0, 0, 14);
    owner.insertText(0, 1, 0, 'HOST-UNCHANGED'); owner.splitParagraph(0, 1, 14);
    owner.createTableEx(json({sectionIdx: 0, paraIdx: 1, charOffset: 0, rowCount: 1, colCount: 2, treatAsChar: true, colWidths: [34000, 8500]}));
    for (const cell of [0, 1]) owner.insertTextInCell(0, 1, 0, cell, 0, 0, 'OUTER-' + cell);
    owner.createTable(0, 2, 0, 1, 2); owner.insertTextInCell(0, 2, 0, 0, 0, 0, 'CELL-UNCHANGED');
    let inner = shapeXml;
    if (depth === 3) {
      const middle = new HwpDocument(await readFile('.cache/rhwp/saved/blank2010.hwp'));
      try {
        middle.createBlankDocument();
        const table = JSON.parse(middle.createTableEx(json({sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: 1, colCount: 2, treatAsChar: true, colWidths: [26000, 4000]})));
        for (const cell of [0, 1]) middle.insertTextInCell(0, table.paraIdx, table.controlIdx, cell, 0, 0, 'MIDDLE-' + cell);
        inner = unzip(Buffer.from(middle.exportHwpx())).get('Contents/section0.xml').toString().match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0].replace('<hp:t>MIDDLE-0</hp:t>', shapeXml + '<hp:t>MIDDLE-0</hp:t>');
      } finally {middle.free();}
    }
    const entries = unzip(Buffer.from(owner.exportHwpx()));
    entries.set('Contents/section0.xml', Buffer.from(entries.get('Contents/section0.xml').toString().replace('<hp:t>OUTER-0</hp:t>', inner + '<hp:t>OUTER-0</hp:t>')));
    const nested = new HwpDocument(zip(entries));
    try {
      assert.equal(nested.getTextInCellByPath(0, 1, json(Array.from({length: depth}, () => ({controlIndex: 0, cellIndex: 0, cellParaIndex: 0}))), 0, 100), 'BOX-FIRST');
      assert(JSON.parse(nested.getTextFileUnicode(true)).includes('HOST-UNCHANGED'));
      for (let level = 1; level < depth; level++) nested.applyParaFormatInCellByPath(0, 1, json(Array.from({length: level}, () => ({controlIndex: 0, cellIndex: 0, cellParaIndex: 0}))), json({alignment: 'justify'}));
      for (const format of ['hwp', 'hwpx']) {
        const file = path.join(root, 'depth-' + depth + '.' + format);
        await writeFile(file, format === 'hwp' ? nested.exportHwp() : nested.exportHwpx()); files.push(file);
      }
    } finally {nested.free();}
  } finally {owner.free();}
}
for (const inline of [true, false]) {
  const owner = new HwpDocument(await readFile('.cache/rhwp/saved/blank2010.hwp'));
  try {
    owner.createBlankDocument(); owner.insertText(0, 0, 0, 'BODY-UNCHANGED'); owner.splitParagraph(0, 0, 14);
    owner.insertText(0, 1, 0, 'HOST-UNCHANGED'); owner.splitParagraph(0, 1, 14);
    owner.createTableEx(json({sectionIdx: 0, paraIdx: 1, charOffset: 0, rowCount: 16, colCount: 2, treatAsChar: false, colWidths: [28000, 4000], rowHeights: Array(16).fill(7000)}));
    for (let cell = 0; cell < 32; cell++) {
      owner.insertTextInCell(0, 1, 0, cell, 0, 0, 'OUTER-' + cell);
      for (let para = 1; para < 5; para++) {
        owner.splitParagraphInCell(0, 1, 0, cell, para - 1, owner.getCellParagraphLength(0, 1, 0, cell, para - 1));
        owner.insertTextInCell(0, 1, 0, cell, para, 0, 'LINE-' + cell + '-' + para);
      }
    }
    owner.createTable(0, 2, 0, 1, 2); owner.insertTextInCell(0, 2, 0, 0, 0, 0, 'CELL-UNCHANGED');
    const entries = unzip(Buffer.from(owner.exportHwpx()));
    const shape = inline ? shapeXml : shapeXml.replace('treatAsChar="1"', 'treatAsChar="0"');
    entries.set('Contents/section0.xml', Buffer.from(entries.get('Contents/section0.xml').toString().replace('<hp:t>OUTER-24</hp:t>', shape + '<hp:t>OUTER-24</hp:t>')));
    const continued = new HwpDocument(zip(entries));
    try {
      const address = [{controlIndex: 0, cellIndex: 24, cellParaIndex: 0}, {controlIndex: 0, cellIndex: 0, cellParaIndex: 0}];
      assert.equal(continued.getTextInCellByPath(0, 1, json(address), 0, 100), 'BOX-FIRST');
      assert(continued.pageCount() > 1);
      for (const format of ['hwp', 'hwpx']) {
        const file = path.join(root, 'continued-' + (inline ? 'inline' : 'floating') + '.' + format);
        await writeFile(file, format === 'hwp' ? continued.exportHwp() : continued.exportHwpx()); files.push(file);
      }
    } finally {continued.free();}
  } finally {owner.free();}
}
files.unshift(...files.splice(6));
const guardFiles = [], inside = new HwpDocument(await readFile('.cache/rhwp/saved/blank2010.hwp'));
try {
  inside.createBlankDocument();
  const table = JSON.parse(inside.createTableEx(json({sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: 1, colCount: 2, treatAsChar: true, colWidths: [9000, 9000], rowHeights: [3000]})));
  inside.insertTextInCell(0, table.paraIdx, table.controlIdx, 0, 0, 0, 'INSIDE-TABLE');
  const tableXml = unzip(Buffer.from(inside.exportHwpx())).get('Contents/section0.xml').toString().match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0];
  const entries = unzip(await readFile(path.join(root, 'textbox.hwpx')));
  entries.set('Contents/section0.xml', Buffer.from(entries.get('Contents/section0.xml').toString().replace('<hp:t>BOX-FIRST</hp:t>', tableXml + '<hp:t>BOX-FIRST</hp:t>')));
  const boxed = new HwpDocument(zip(entries));
  try {
    for (const format of ['hwp', 'hwpx']) {
      const file = path.join(root, 'table-in-box.' + format);
      await writeFile(file, format === 'hwp' ? boxed.exportHwp() : boxed.exportHwpx()); guardFiles.push(file);
    }
  } finally {boxed.free();}
} finally {inside.free();}
const data = await createWorkspace([...files, ...guardFiles], path.join(root, 'output')), manifest = path.join(root, 'workspace.json');
await writeFile(manifest, json(data));
const port = 18880, base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['app/server.mjs'], {env: {...process.env, PORT: String(port), DOCUMENT_MANIFEST: manifest}, stdio: ['ignore', 'pipe', 'pipe']});
let browser;
const report = {root, checks: [], errors: [], warnings: [], externalRequests: []};
const ready = p => p.waitForFunction(() => window.editorReady, null, {timeout: 45000});
const pass = name => {report.checks.push(name); console.log('PASS', name);};
async function save(page, revision) {await page.getByRole('button', {name: '결과 파일 저장', exact: true}).click(); await page.locator('#delivery[data-revision="' + revision + '"]').waitFor();}
async function editMenu(frame, label) {await frame.locator('#menu-bar').getByText('편집', {exact: true}).click(); await frame.locator('#menu-bar').getByText(label, {exact: true}).click();}
// Page canvases are recycled after layout changes, so DOM order does not follow page order; pick by vertical position.
async function pageCanvas(frame, index) {
  const canvases = frame.locator('#scroll-container canvas');
  const order = await canvases.evaluateAll(elements => elements.map((element, position) => ({position, top: parseFloat(element.style.top)})).sort((a, b) => a.top - b.top).map(entry => entry.position));
  assert(index < order.length, 'The requested page must have a rendered canvas');
  return canvases.nth(order[index]);
}
async function enter(page, source, text = 'BOX-FIRST', blank = false, border = false) {
  const texts = [];
  for (let index = 0; index < source.pageCount(); index++) {
    const tree = JSON.parse(source.getPageRenderTree(index));
    function visit(node, ancestors = []) {if (node.type === 'TextRun' && node.text === text) texts.push({node, tree, index, ancestors}); for (const child of node.children || []) visit(child, [...ancestors, node]);}
    visit(tree);
  }
  assert.equal(texts.length, 1);
  const {node, tree, index, ancestors} = texts[0], b = node.bbox;
  assert(b.y >= 0 && b.y + b.h <= tree.bbox.h, 'Textbox text must be visible inside its owning page');
  const canvas = await pageCanvas(page.frameLocator('#editor iframe'), index);
  const size = await canvas.evaluate(el => ({width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height}));
  const box = ancestors.findLast(n => n.type === 'TextBox').bbox;
  const shape = ancestors.findLast(n => n.type === 'Rect').bbox;
  const point = {x: border ? shape.x + shape.w + (border === 'outside' ? 1 : -1) : blank ? box.x + box.w - 20 : b.x + b.w / 2, y: b.y + b.h / 2};
  if (blank || border) {
    assert(point.x > b.x + b.w, 'The blank click must be outside the text glyphs');
    // A plain selection click is verified by its handles below; the synthetic cells are shorter than their resized textbox.
    if (border !== 'select') for (const cell of ancestors.filter(n => n.type === 'Cell')) assert(point.x >= cell.bbox.x && point.x <= cell.bbox.x + cell.bbox.w && point.y >= cell.bbox.y && point.y <= cell.bbox.y + cell.bbox.h, 'The blank click must stay inside every enclosing cell');
  }
  const hit = JSON.parse(source.hitTest(index, border ? b.x + b.w / 2 : point.x, point.y));
  assert.equal(hit.isTextBox, true, 'The rendered textbox text must resolve to its own container');
  assert.equal(ancestors.filter(n => n.type === 'Cell').length, hit.cellPath.length - 1, 'The hit must retain every enclosing cell');
  assert.equal(source.getTextInCellByPath(0, hit.parentParaIndex, json(hit.cellPath), 0, 100), text);
  const caret = JSON.parse(source.getCursorRectByPath(0, hit.parentParaIndex, json(hit.cellPath), hit.charOffset));
  assert.equal(caret.pageIndex, index);
  assert(caret.x >= b.x - 1 && caret.x <= b.x + b.w + 1, 'The complete textbox path must resolve its rendered caret');
  const position = {x: point.x * size.width / tree.bbox.w, y: point.y * size.height / tree.bbox.h};
  if (border) {
    assert(point.x > box.x + box.w, 'The border click must be outside the padded textbox');
    await canvas.click({position});
    assert(await page.frameLocator('#editor iframe').locator('.table-object-layer > div').count() >= 8, 'The textbox border must select its object and display handles');
    const controls = JSON.parse(source.getPageControlLayout(index)).controls.filter(c => c.type === 'shape');
    const control = controls.find(c => Math.abs(c.x - shape.x) < 1 && Math.abs(c.y - shape.y) < 1);
    assert(control, 'The visible textbox must expose an object reference');
    assert.deepEqual(control.cellPath || [], hit.cellPath.slice(0, -1), 'The object reference must retain every enclosing cell');
    assert.equal(control.paraIdx, hit.parentParaIndex, 'The object reference must retain its body owner');
  }
  if (border === 'select') return;
  if (border === 'enter') await page.frameLocator('#editor iframe').getByRole('textbox', {name: '문서 편집 입력', exact: true}).press('Enter');
  else await canvas.dblclick({position});
}
function verify(source, result, changed, selected = [0], depth = 1, continued = false, alignment = 'center', shapePatch = {}) {
  assert.equal(result.getTextFileUnicode(true), source.getTextFileUnicode(true));
  const address = Array.from({length: depth}, () => ({controlIndex: 0, cellIndex: 0, cellParaIndex: 0}));
  if (continued) address[0].cellIndex = 24;
  const shapeProps = doc => JSON.parse(depth === 1 ? doc.getShapeProperties(0, 1, 0) : doc.getCellShapePropertiesByPath(0, 1, json(address.slice(0, -1)), 0));
  assert.deepEqual(shapeProps(result), {...shapeProps(source), ...shapePatch});
  for (let level = 1; level < depth; level++) {
    const target = address.slice(0, level);
    assert.equal(result.getTablePropertiesByPath(0, 1, json(target)), source.getTablePropertiesByPath(0, 1, json(target)));
    for (const cell of Array.from({length: continued ? 32 : 2}, (_, index) => index)) {
      assert.equal(result.getCellPropertiesByPath(0, 1, json(target), cell), source.getCellPropertiesByPath(0, 1, json(target), cell));
      for (let para = 0; para < (continued ? 5 : 1); para++) {
        const paragraph = structuredClone(target); paragraph.at(-1).cellIndex = cell; paragraph.at(-1).cellParaIndex = para;
        assert.equal(result.getCellParaPropertiesAtByPath(0, 1, json(paragraph)), source.getCellParaPropertiesAtByPath(0, 1, json(paragraph)));
        assert.equal(result.getCellCharPropertiesAtByPath(0, 1, json(paragraph), 0), source.getCellCharPropertiesAtByPath(0, 1, json(paragraph), 0));
      }
    }
  }
  assert.equal(result.getTableProperties(0, 2, 0), source.getTableProperties(0, 2, 0));
  for (const cell of [0, 1]) assert.equal(result.getCellProperties(0, 2, 0, cell), source.getCellProperties(0, 2, 0, cell));
  for (const para of [0, 1]) assert.equal(result.getParaPropertiesAt(0, para), source.getParaPropertiesAt(0, para));
  for (const para of [0, 1, 2]) {
    const target = structuredClone(address); target.at(-1).cellParaIndex = para;
    const p = json(target);
    assert.equal(result.getTextInCellByPath(0, 1, p, 0, 100), source.getTextInCellByPath(0, 1, p, 0, 100));
    const before = JSON.parse(source.getCellParaPropertiesAtByPath(0, 1, p)), after = JSON.parse(result.getCellParaPropertiesAtByPath(0, 1, p));
    assert.equal(after.alignment, changed && selected.includes(para) ? alignment : before.alignment, 'Textbox paragraph ' + para);
    delete before.alignment; delete after.alignment; delete before.paraShapeId; delete after.paraShapeId;
    assert.deepEqual(after, before); assert.equal(result.getCellCharPropertiesAtByPath(0, 1, p, 0), source.getCellCharPropertiesAtByPath(0, 1, p, 0));
  }
}
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined});
  const context = await browser.newContext({viewport: {width: 1280, height: 1050}});
  context.on('page', p => {p.on('pageerror', e => report.errors.push(e.message)); p.on('console', m => {if (['warning', 'error'].includes(m.type())) report.warnings.push(m.text());}); p.on('request', r => {if (!r.url().startsWith(base + '/') && !/^(blob|data):/.test(r.url())) report.externalRequests.push(r.url());});});
  for (const entry of data.documents.filter(e => !e.name.startsWith('table-in-box.'))) {
    const source = new HwpDocument(await readFile(entry.source)), page = await context.newPage(), frame = page.frameLocator('#editor iframe'), continued = entry.name.startsWith('continued-'), depth = continued ? 2 : Number(entry.source.match(/depth-(\d)/)?.[1] ?? 1);
    const verifyEntry = (changed, selected, alignment) => verify(source, result, changed, selected, depth, continued, alignment);
    let result;
    try {
      await page.goto(base + '/editor?id=' + entry.id); await ready(page); await enter(page, source, 'BOX-FIRST', true);
      await frame.getByRole('textbox', {name: '문서 편집 입력', exact: true}).press('ArrowRight');
      await frame.getByRole('button', {name: '가운데 정렬', exact: true}).click(); await save(page, 1);
      result = new HwpDocument(await readFile(entry.output));
      try {verifyEntry(true);} finally {result.free();}
      pass(entry.name + ' blank-area entry changes its textbox paragraph alignment only');
      await editMenu(frame, '되돌리기'); await save(page, 2);
      result = new HwpDocument(await readFile(entry.output)); try {verifyEntry(false);} finally {result.free();}
      await editMenu(frame, '다시 실행');
      await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
      await page.reload(); await ready(page); await save(page, 3);
      result = new HwpDocument(await readFile(entry.output)); try {verifyEntry(true);} finally {result.free();}
      pass(entry.name + ' textbox alignment undo, redo and recovery');
      await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page);
      result = new HwpDocument(await readFile(entry.output));
      try {verifyEntry(true); assert.equal(result.getSourceFormat(), entry.format); const receipt = JSON.parse(await readFile(entry.output + '.receipt.json')); assert.equal(receipt.contentLoss.count, 0); assert.equal(receipt.outputSha256, digest(await readFile(entry.output))); assert.equal(receipt.textSha256, digest(JSON.parse(result.getTextFileUnicode(true)))); assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);} finally {result.free();}
      pass(entry.name + ' textbox alignment saved reopening, original and receipt hashes');
      result = new HwpDocument(await readFile(entry.output));
      try {await enter(page, result);} finally {result.free();}
      const input = frame.getByRole('textbox', {name: '문서 편집 입력', exact: true});
      await input.press('Home');
      for (let i = 0; i < 20; i++) await input.press('Shift+ArrowRight');
      await frame.getByRole('button', {name: '가운데 정렬', exact: true}).click(); await save(page, 4);
      result = new HwpDocument(await readFile(entry.output)); try {verifyEntry(true, [0, 1]);} finally {result.free();}
      pass(entry.name + ' selected textbox range formats both paragraphs and preserves the third');
      await editMenu(frame, '되돌리기'); await save(page, 5);
      result = new HwpDocument(await readFile(entry.output)); try {verifyEntry(true);} finally {result.free();}
      await editMenu(frame, '다시 실행');
      await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
      await page.reload(); await ready(page); await save(page, 6);
      result = new HwpDocument(await readFile(entry.output)); try {verifyEntry(true, [0, 1]);} finally {result.free();}
      pass(entry.name + ' multi-paragraph textbox undo, redo and journal replay');
      await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page);
      result = new HwpDocument(await readFile(entry.output));
      try {verifyEntry(true, [0, 1]); assert.equal(digest(await readFile(entry.source)), entry.sourceSha256); const receipt = JSON.parse(await readFile(entry.output + '.receipt.json')); assert.equal(receipt.outputSha256, digest(await readFile(entry.output))); assert.equal(receipt.textSha256, digest(JSON.parse(result.getTextFileUnicode(true)))); assert.equal(receipt.contentLoss.count, 0);} finally {result.free();}
      pass(entry.name + ' multi-paragraph textbox disk reopening and fingerprints');
      result = new HwpDocument(await readFile(entry.output));
      try {await enter(page, result, 'BOX-SECOND');} finally {result.free();}
      await input.press('Home'); await input.press('ArrowLeft'); await input.press('Home');
      for (let i = 0; i < 20; i++) await input.press('Shift+ArrowRight');
      await frame.getByRole('button', {name: '왼쪽 정렬', exact: true}).click(); await save(page, 7);
      result = new HwpDocument(await readFile(entry.output)); try {verifyEntry(true, [0, 1], 'left');} finally {result.free();}
      pass(entry.name + ' second-paragraph backward navigation keeps the textbox path');
      await editMenu(frame, '되돌리기'); await save(page, 8);
      result = new HwpDocument(await readFile(entry.output)); try {verifyEntry(true, [0, 1]);} finally {result.free();}
      await editMenu(frame, '다시 실행');
      await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
      await page.reload(); await ready(page); await save(page, 9);
      await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page);
      result = new HwpDocument(await readFile(entry.output));
      try {verifyEntry(true, [0, 1], 'left'); assert.equal(digest(await readFile(entry.source)), entry.sourceSha256); const receipt = JSON.parse(await readFile(entry.output + '.receipt.json')); assert.equal(receipt.outputSha256, digest(await readFile(entry.output))); assert.equal(receipt.contentLoss.count, 0);} finally {result.free();}
      pass(entry.name + ' backward navigation format undo, redo, recovery and disk reopening');
      const baseline = new HwpDocument(await readFile(entry.output));
      const verifyBorder = async (edited, alignment = 'right') => {
        const saved = new HwpDocument(await readFile(entry.output));
        try {verify(baseline, saved, edited, [0], depth, continued, alignment);} finally {saved.free();}
      };
      try {
        await enter(page, baseline, 'BOX-FIRST', false, true);
        await frame.getByRole('button', {name: '오른쪽 정렬', exact: true}).click(); await save(page, 10); await verifyBorder(true);
        pass(entry.name + ' border selection and double-click enter the complete textbox path');
        await editMenu(frame, '되돌리기'); await save(page, 11); await verifyBorder(false);
        await editMenu(frame, '다시 실행');
        await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
        await page.reload(); await ready(page); await save(page, 12); await verifyBorder(true);
        pass(entry.name + ' border-entry formatting supports undo, redo and recovery');
        await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page); await verifyBorder(true);
        assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);
        const receipt = JSON.parse(await readFile(entry.output + '.receipt.json'));
        assert.equal(receipt.outputSha256, digest(await readFile(entry.output))); assert.equal(receipt.contentLoss.count, 0);
        pass(entry.name + ' border-entry formatting survives saved reopening');
        const current = new HwpDocument(await readFile(entry.output));
        try {await enter(page, current, 'BOX-FIRST', false, 'enter');} finally {current.free();}
        await frame.getByRole('button', {name: '가운데 정렬', exact: true}).click(); await save(page, 13); await verifyBorder(true, 'center');
        pass(entry.name + ' Enter from the selected textbox preserves its complete path');
        await editMenu(frame, '되돌리기'); await save(page, 14); await verifyBorder(true);
        await editMenu(frame, '다시 실행');
        await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
        await page.reload(); await ready(page); await save(page, 15); await verifyBorder(true, 'center');
        pass(entry.name + ' Enter-entry formatting supports undo, redo and recovery');
        await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page); await verifyBorder(true, 'center');
        assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);
        const finalReceipt = JSON.parse(await readFile(entry.output + '.receipt.json'));
        assert.equal(finalReceipt.outputSha256, digest(await readFile(entry.output))); assert.equal(finalReceipt.contentLoss.count, 0);
        pass(entry.name + ' Enter-entry formatting survives saved reopening');
        const outside = new HwpDocument(await readFile(entry.output));
        try {await enter(page, outside, 'BOX-FIRST', false, 'outside');} finally {outside.free();}
        await frame.getByRole('button', {name: '오른쪽 정렬', exact: true}).click(); await save(page, 16); await verifyBorder(true);
        pass(entry.name + ' clicks just outside the border retain the textbox object path');
        await editMenu(frame, '되돌리기'); await save(page, 17); await verifyBorder(true, 'center');
        await editMenu(frame, '다시 실행');
        await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
        await page.reload(); await ready(page); await save(page, 18); await verifyBorder(true);
        pass(entry.name + ' outside-border formatting supports undo, redo and recovery');
        await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page); await verifyBorder(true);
        assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);
        const outsideReceipt = JSON.parse(await readFile(entry.output + '.receipt.json'));
        assert.equal(outsideReceipt.outputSha256, digest(await readFile(entry.output))); assert.equal(outsideReceipt.contentLoss.count, 0);
        pass(entry.name + ' outside-border formatting survives saved reopening');
      } finally {baseline.free();}
      const propertyBaseline = new HwpDocument(await readFile(entry.output));
      const shapePatch = {width: Math.round(60 * 7200 / 25.4), height: Math.round(32 * 7200 / 25.4), tbMarginLeft: Math.round(3 * 7200 / 25.4), tbMarginTop: Math.round(2 * 7200 / 25.4), tbMarginRight: Math.round(3 * 7200 / 25.4), tbMarginBottom: Math.round(2 * 7200 / 25.4)};
      const verifyProperties = async (edited = true) => {
        const saved = new HwpDocument(await readFile(entry.output));
        try {verify(propertyBaseline, saved, false, [0], depth, continued, 'right', edited ? shapePatch : {});} finally {saved.free();}
      };
      try {
        await enter(page, propertyBaseline, 'BOX-FIRST', false, 'select');
        await frame.getByRole('button', {name: '개체 속성', exact: true}).click();
        await frame.getByRole('spinbutton', {name: '개체 너비(mm)', exact: true}).waitFor();
        await frame.getByRole('checkbox', {name: '비율 유지', exact: true}).uncheck();
        await frame.getByRole('spinbutton', {name: '개체 너비(mm)', exact: true}).fill('60');
        await frame.getByRole('spinbutton', {name: '개체 높이(mm)', exact: true}).fill('32');
        await frame.getByRole('button', {name: '설정(D)', exact: true}).click(); await save(page, 19);
        const sized = new HwpDocument(await readFile(entry.output));
        try {verify(propertyBaseline, sized, false, [0], depth, continued, 'right', {width: shapePatch.width, height: shapePatch.height});} finally {sized.free();}
        pass(entry.name + ' size-only confirmation preserves undisplayed border and margin precision');
        const current = new HwpDocument(await readFile(entry.output));
        try {await enter(page, current, 'BOX-FIRST', false, 'select');} finally {current.free();}
        await frame.getByRole('button', {name: '개체 속성', exact: true}).click();
        await frame.getByRole('button', {name: '글상자', exact: true}).click();
        for (const [label, value] of [['글상자 왼쪽 여백(mm)', '3'], ['글상자 위쪽 여백(mm)', '2'], ['글상자 오른쪽 여백(mm)', '3'], ['글상자 아래쪽 여백(mm)', '2']]) await frame.getByRole('spinbutton', {name: label, exact: true}).fill(value);
        await frame.getByRole('button', {name: '설정(D)', exact: true}).click(); await save(page, 20); await verifyProperties();
        pass(entry.name + ' textbox size and margins retain all other shape and enclosing properties');
        await editMenu(frame, '되돌리기'); await editMenu(frame, '되돌리기'); await save(page, 21); await verifyProperties(false);
        await editMenu(frame, '다시 실행'); await editMenu(frame, '다시 실행');
        await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
        await page.reload(); await ready(page); await save(page, 22); await verifyProperties();
        pass(entry.name + ' textbox property undo, redo and journal recovery preserve the target');
        await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page); await verifyProperties();
        const reopened = new HwpDocument(await readFile(entry.output));
        try {await enter(page, reopened, 'BOX-FIRST', false, 'select');} finally {reopened.free();}
        await frame.getByRole('button', {name: '개체 속성', exact: true}).click();
        assert.equal(Number(await frame.getByRole('spinbutton', {name: '개체 너비(mm)', exact: true}).inputValue()).toFixed(2), '60.00');
        assert.equal(Number(await frame.getByRole('spinbutton', {name: '개체 높이(mm)', exact: true}).inputValue()).toFixed(2), '32.00');
        await frame.getByRole('button', {name: '글상자', exact: true}).click();
        assert.equal(Number(await frame.getByRole('spinbutton', {name: '글상자 왼쪽 여백(mm)', exact: true}).inputValue()).toFixed(2), '3.00');
        await frame.getByRole('button', {name: '설정(D)', exact: true}).click(); await save(page, 23); await verifyProperties();
        assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);
        const receipt = JSON.parse(await readFile(entry.output + '.receipt.json'));
        assert.equal(receipt.outputSha256, digest(await readFile(entry.output))); assert.equal(receipt.contentLoss.count, 0);
        pass(entry.name + ' saved textbox properties reopen and unchanged confirmation retains source and receipt hashes');
      } finally {propertyBaseline.free();}
    } finally {source.free(); await page.close();}
  }
  for (const entry of data.documents.filter(e => e.name.startsWith('table-in-box.'))) {
    const source = new HwpDocument(await readFile(entry.source)), page = await context.newPage(), frame = page.frameLocator('#editor iframe');
    try {
      const tree = JSON.parse(source.getPageRenderTree(0)), cells = [];
      function visit(node, inBox = false) {const boxed = inBox || node.type === 'TextBox'; if (boxed && node.type === 'Cell') cells.push(node); for (const child of node.children || []) visit(child, boxed);}
      visit(tree); assert.equal(cells.length, 2);
      const box = cells[1].bbox, point = {x: box.x + box.w / 2, y: box.y + box.h / 2};
      const hit = JSON.parse(source.hitTest(0, point.x, point.y));
      assert.equal(hit.isTextBox, undefined, 'An empty table cell inside a textbox must remain a table cell');
      assert.equal(hit.parentParaIndex, 1); assert.equal(hit.cellPath.length, 2); assert.equal(hit.cellPath[1].cellIndex, 1);
      await page.goto(base + '/editor?id=' + entry.id); await ready(page);
      const canvas = await pageCanvas(frame, 0), size = await canvas.evaluate(el => ({width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height}));
      await canvas.click({position: {x: point.x * size.width / tree.bbox.w, y: point.y * size.height / tree.bbox.h}});
      await frame.getByRole('textbox', {name: '문서 편집 입력', exact: true}).pressSequentially('EMPTY-EDIT'); await save(page, 1);
      async function verifyGuard(edited) {
        const result = new HwpDocument(await readFile(entry.output));
        try {
          assert.equal(result.getTextInCellByPath(0, 1, json(hit.cellPath), 0, 100), edited ? 'EMPTY-EDIT' : '');
          assert.equal(JSON.parse(result.getTextFileUnicode(true)).replace('EMPTY-EDIT', ''), JSON.parse(source.getTextFileUnicode(true)));
          assert.equal(result.getShapeProperties(0, 1, 0), source.getShapeProperties(0, 1, 0));
          assert.equal(result.getTablePropertiesByPath(0, 1, json(hit.cellPath)), source.getTablePropertiesByPath(0, 1, json(hit.cellPath)));
          for (const cell of [0, 1]) assert.equal(result.getCellPropertiesByPath(0, 1, json(hit.cellPath), cell), source.getCellPropertiesByPath(0, 1, json(hit.cellPath), cell));
          assert.equal(digest(await readFile(entry.source)), entry.sourceSha256); const receipt = JSON.parse(await readFile(entry.output + '.receipt.json')); assert.equal(receipt.outputSha256, digest(await readFile(entry.output))); assert.equal(receipt.contentLoss.count, 0);
        } finally {result.free();}
      }
      await verifyGuard(true); await editMenu(frame, '되돌리기'); await save(page, 2); await verifyGuard(false);
      await editMenu(frame, '다시 실행');
      await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
      await page.reload(); await ready(page); await save(page, 3); await verifyGuard(true);
      pass(entry.name + ' empty-cell typing undo, redo and journal recovery retain the inner table');
      await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page); await verifyGuard(true);
      pass(entry.name + ' empty-cell typing inside a textbox keeps its nested table path after save and reopening');
    } finally {source.free(); await page.close();}
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.warnings, []); assert.deepEqual(report.externalRequests, []); pass('No browser errors, warnings or external requests');
} catch (error) {report.failure = {message: error.message}; throw error;} finally {
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log('REPORT', path.join(root, 'report.json'));
  if (browser) await browser.close();
  if (child.exitCode === null && child.signalCode === null) {const closed = new Promise(resolve => child.once('close', resolve)); child.kill(); await closed;}
}
