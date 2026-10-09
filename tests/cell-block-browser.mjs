import {createRequire} from 'node:module';
import {readFile, mkdir, writeFile, mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspace, digest} from '../app/workspace.mjs';
import {initSync, HwpDocument} from '../.build/core/rhwp.js';
import {unzip, zip} from './zip-fixture.mjs';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH || import.meta.url);
const {chromium} = require('playwright');
await mkdir('test-results', {recursive: true});
const root = await mkdtemp(path.resolve('test-results/cell-block-'));
initSync({module: await readFile('.build/core/rhwp_bg.wasm')});
const blank = await readFile('.cache/rhwp/saved/blank2010.hwp'), json = JSON.stringify;
function tableXml(width, label, inner = false) {
  const d = new HwpDocument(blank);
  try {
    d.createBlankDocument();
    const count = inner ? 3 : 2;
    const colWidths = inner ? Array(count).fill(width / count) : [width * 0.8, width * 0.2];
    const r = JSON.parse(d.createTableEx(json({sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: 1, colCount: count, treatAsChar: true, colWidths})));
    for (let cell = 0; cell < count; cell++) {
      const text = label + cell;
      d.insertTextInCell(0, r.paraIdx, r.controlIdx, cell, 0, 0, text);
      if (inner && cell !== 1) {
        d.splitParagraphInCell(0, r.paraIdx, r.controlIdx, cell, 0, text.length);
        d.insertTextInCell(0, r.paraIdx, r.controlIdx, cell, 1, 0, label + cell + '-SECOND');
      }
    }
    return unzip(Buffer.from(d.exportHwpx())).get('Contents/section0.xml').toString().match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0];
  } finally {d.free();}
}
const files = [];
for (const depth of [3, 2, 1]) {
  const d = new HwpDocument(blank);
  try {
    d.createBlankDocument(); d.insertText(0, 0, 0, 'BODY-UNCHANGED'); d.splitParagraph(0, 0, 14);
    d.createTableEx(json({sectionIdx: 0, paraIdx: 1, charOffset: 0, rowCount: 1, colCount: 2, treatAsChar: true, colWidths: [34000, 8500]}));
    for (let i = 0; i < 2; i++) d.insertTextInCell(0, 1, 0, i, 0, 0, 'OUTER-' + i);
    let inner = tableXml(depth === 1 ? 30000 : 21000, 'INNER-', true);
    if (depth === 3) inner = tableXml(30000, 'MIDDLE-').replace('<hp:t>MIDDLE-0</hp:t>', inner + '<hp:t>MIDDLE-0</hp:t>');
    const entries = unzip(Buffer.from(d.exportHwpx()));
    let xml = entries.get('Contents/section0.xml').toString();
    xml = depth === 1 ? xml.replace(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/, inner) : xml.replace('<hp:t>OUTER-0</hp:t>', inner + '<hp:t>OUTER-0</hp:t>');
    entries.set('Contents/section0.xml', Buffer.from(xml));
    const native = new HwpDocument(zip(entries));
    try {
      for (let level = depth - 1; level > 0; level--) {
        const host = Array.from({length: level}, () => ({controlIndex: 0, cellIndex: 0, cellParaIndex: 0}));
        native.applyParaFormatInCellByPath(0, 1, json(host), json({alignment: 'justify'}));
      }
      for (const format of ['hwp', 'hwpx']) {
        const file = path.join(root, 'depth-' + depth + '.' + format);
        await writeFile(file, format === 'hwp' ? native.exportHwp() : native.exportHwpx()); files.push(file);
      }
    } finally {native.free();}
  } finally {d.free();}
}
const data = await createWorkspace(files, path.join(root, 'output')), manifest = path.join(root, 'workspace.json');
await writeFile(manifest, json(data));
const port = 18879, base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['app/server.mjs'], {env: {...process.env, PORT: String(port), DOCUMENT_MANIFEST: manifest}, stdio: ['ignore', 'pipe', 'pipe']});
let browser;
const report = {root, checks: [], errors: [], warnings: [], externalRequests: []};
const pass = name => {report.checks.push(name); console.log('PASS', name);};
const ready = p => p.waitForFunction(() => window.editorReady, null, {timeout: 45000});
async function save(p, revision) {await p.getByRole('button', {name: '결과 파일 저장', exact: true}).click(); await p.locator('#delivery[data-revision="' + revision + '"]').waitFor();}
async function command(frame, label) {await frame.locator('#menu-bar').getByText('편집', {exact: true}).click(); await frame.locator('#menu-bar').getByText(label, {exact: true}).click();}
async function select(page) {
  await page.getByRole('button', {name: '찾아 바꾸기', exact: true}).click();
  const f = page.frameLocator('#editor iframe');
  await f.getByRole('textbox', {name: '찾을 내용', exact: true}).fill('INNER-0');
  await f.getByRole('button', {name: '다음 찾기', exact: true}).click();
  await f.getByText('검색 결과 2개', {exact: true}).waitFor();
  await f.getByRole('button', {name: '찾아 바꾸기 닫기', exact: true}).click();
  const input = f.getByRole('textbox', {name: '문서 편집 입력', exact: true});
  await input.press('F5'); await input.press('F5'); await input.press('ArrowRight');
}
function verify(source, result, address, aligned) {
  assert.equal(result.getTextFileUnicode(true), source.getTextFileUnicode(true));
  assert.equal(result.getParaPropertiesAt(0, 0), source.getParaPropertiesAt(0, 0));
  for (let depth = 1; depth <= address.length; depth++) {
    const table = json(address.slice(0, depth));
    assert.equal(result.getTablePropertiesByPath(0, 1, table), source.getTablePropertiesByPath(0, 1, table));
    const count = JSON.parse(source.getTableDimensionsByPath(0, 1, table)).cellCount;
    for (let cell = 0; cell < count; cell++) {
      assert.equal(result.getCellPropertiesByPath(0, 1, table, cell), source.getCellPropertiesByPath(0, 1, table, cell));
      const q = structuredClone(address.slice(0, depth)); q.at(-1).cellIndex = cell;
      const paragraphs = source.getCellParagraphCountByPath(0, 1, json(q));
      assert.equal(result.getCellParagraphCountByPath(0, 1, json(q)), paragraphs);
      for (let para = 0; para < paragraphs; para++) {
        q.at(-1).cellParaIndex = para; const target = json(q);
        const before = JSON.parse(source.getCellParaPropertiesAtByPath(0, 1, target)), after = JSON.parse(result.getCellParaPropertiesAtByPath(0, 1, target));
        assert.equal(after.alignment, aligned && depth === address.length && cell < 2 ? 'center' : before.alignment, 'Selected paragraph alignment at ' + target);
        delete before.alignment; delete after.alignment; delete before.paraShapeId; delete after.paraShapeId;
        assert.deepEqual(after, before, 'Other paragraph properties must remain intact');
        assert.equal(result.getCellCharPropertiesAtByPath(0, 1, target, 0), source.getCellCharPropertiesAtByPath(0, 1, target, 0));
      }
    }
  }
}
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined});
  const context = await browser.newContext({viewport: {width: 1280, height: 1050}});
  context.on('page', p => {
    p.on('pageerror', e => report.errors.push(e.message));
    p.on('console', m => {if (['warning', 'error'].includes(m.type())) report.warnings.push(m.text());});
    p.on('request', r => {if (!r.url().startsWith(base + '/') && !/^(blob|data):/.test(r.url())) report.externalRequests.push(r.url());});
  });
  for (const entry of data.documents) {
    const depth = Number(entry.name.match(/depth-(\d)/)[1]), address = Array.from({length: depth}, () => ({controlIndex: 0, cellIndex: 0, cellParaIndex: 0}));
    const source = new HwpDocument(await readFile(entry.source)), page = await context.newPage(), frame = page.frameLocator('#editor iframe');
    try {
      await page.goto(base + '/editor?id=' + entry.id); await ready(page); await select(page);
      await frame.getByRole('button', {name: '가운데 정렬', exact: true}).click(); await save(page, 1);
      let result = new HwpDocument(await readFile(entry.output));
      try {verify(source, result, address, true);} finally {result.free();}
      pass(entry.name + ' selected cells include every paragraph and preserve unselected cells');
      await command(frame, '되돌리기'); await save(page, 2);
      result = new HwpDocument(await readFile(entry.output));
      try {verify(source, result, address, false);} finally {result.free();}
      await command(frame, '다시 실행');
      await page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
      await page.reload(); await ready(page); await save(page, 3);
      result = new HwpDocument(await readFile(entry.output));
      try {verify(source, result, address, true);} finally {result.free();}
      pass(entry.name + ' undo, redo and journal replay preserve the full cell paths');
      await page.goto(base + '/editor?id=' + entry.id + '&result=1'); await ready(page);
      result = new HwpDocument(await readFile(entry.output));
      try {
        verify(source, result, address, true);
        assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);
        const receipt = JSON.parse(await readFile(entry.output + '.receipt.json'));
        assert.equal(receipt.contentLoss.count, 0); assert.equal(receipt.outputSha256, digest(await readFile(entry.output)));
        assert.equal(receipt.textSha256, digest(JSON.parse(result.getTextFileUnicode(true))));
      } finally {result.free();}
      pass(entry.name + ' saved result reopening, original and receipt hashes');
    } finally {source.free(); await page.close();}
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.warnings, []); assert.deepEqual(report.externalRequests, []);
  pass('No browser errors, warnings or external requests');
} finally {
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log('REPORT', path.join(root, 'report.json'));
  if (browser) await browser.close();
  if (child.exitCode === null && child.signalCode === null) {const closed = new Promise(resolve => child.once('close', resolve)); child.kill(); await closed;}
}
