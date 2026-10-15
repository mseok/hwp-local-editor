// Memo (Hancom 메모/주석) viewing, editing, insertion, deletion, undo/redo, journal recovery and saved reopening
// through the Studio memo list and 입력 → 메모 넣기, in HWP and HWPX, including paragraphs with objects.
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
{
  const d = new HwpDocument(blank);
  try {
    d.createBlankDocument(); d.insertText(0, 0, 0, 'LINK-TARGET plain');
    const file = path.join(root, 'link.hwp'); await writeFile(file, d.exportHwp()); files.push(file);
  } finally {d.free();}
}
{
  // A paragraph with a footnote, an equation, an inline table and a trailing footnote between the letters.
  const d = new HwpDocument(blank);
  try {
    d.createBlankDocument();
    d.insertText(0, 0, 0, '개체 문단'); d.splitParagraph(0, 0, 5);
    d.insertText(0, 1, 0, 'AAA-FOOT BBB-EQ CCC-TBL DDD-TAIL');
    d.insertFootnote(0, 1, 8);
    d.insertEquation(0, 1, 15, 'x+y', 1000, 0);
    d.createTableEx(json({sectionIdx: 0, paraIdx: 1, charOffset: 19, rowCount: 1, colCount: 1, treatAsChar: true}));
    d.insertFootnote(0, 1, d.getParagraphLength(0, 1));
    for (const format of ['hwp', 'hwpx']) {
      const file = path.join(root, 'objects.' + format);
      await writeFile(file, format === 'hwp' ? d.exportHwp() : d.exportHwpx()); files.push(file);
    }
  } finally {d.free();}
}
{
  // Hancom's own memo file (upstream sample): its memo spans paragraphs.
  const {execFileSync} = await import('node:child_process');
  const file = path.join(root, 'memo-hancom.hwp');
  await writeFile(file, execFileSync('git', ['-C', '.cache/rhwp', 'show', 'HEAD:samples/issue5866/memo_field_hwp5.hwp'], {maxBuffer: 1 << 26}));
  files.push(file);
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
  const recovered = page => page.waitForFunction(() => {const revision = localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision; return revision > 0 && revision === Number(document.querySelector('#status').dataset.savedRevision);});
  for (const entry of data.documents.filter(e => e.name === 'link.hwp')) {
    const page = await context.newPage(), frame = page.frameLocator('#editor iframe');
    try {
      await page.goto(base + '/editor?id=' + entry.id); await ready(page);
      await select(page, frame, 'LINK-TARGET');
      await menu(frame, '입력', '하이퍼링크');
      const dialog = frame.getByRole('dialog', {name: '하이퍼링크', exact: true});
      await dialog.getByRole('textbox', {name: '웹 주소', exact: true}).fill('https://example.com/memo-check');
      await dialog.getByRole('button', {name: '넣기', exact: true}).click();
      await recovered(page);
      await page.reload(); await ready(page);
      await save(page, 1);
      const saved = new HwpDocument(await readFile(entry.output));
      try {
        const links = JSON.parse(saved.getHyperlinkContext(json({section: 0, para: 0, cellPath: []}))).links;
        assert.deepEqual(links.map(l => [l.text, l.uri]), [['LINK-TARGET', 'https://example.com/memo-check']]);
      } finally {saved.free();}
      pass('link.hwp a hyperlink inserted before a reload is restored by journal recovery and saved');
    } finally {await page.close();}
  }
  for (const entry of data.documents.filter(e => e.name.startsWith('objects.'))) {
    const source = new HwpDocument(await readFile(entry.source)), page = await context.newPage(), frame = page.frameLocator('#editor iframe');
    try {
      assert.equal(source.getControlTextPositions(0, 1), '[8,15,19,32]');
      await page.goto(base + '/editor?id=' + entry.id); await ready(page);
      for (const [anchor, body] of [['AAA-FOOT', '각주 바로 앞'], ['CCC-TBL', '표를 감쌈'], ['DDD-TAIL', '문단 끝']]) {
        await select(page, frame, anchor);
        await menu(frame, '입력', '메모 넣기');
        await frame.getByRole('textbox', {name: '메모 내용', exact: true}).fill(body);
        await frame.getByRole('dialog', {name: '메모 넣기', exact: true}).getByRole('button', {name: '넣기', exact: true}).click();
      }
      await save(page, 1);
      const saved = new HwpDocument(await readFile(entry.output));
      try {
        assert.deepEqual(memoState(saved).map(m => [m.anchorText, m.start, m.end, m.text]), [['AAA-FOOT', 0, 8, '각주 바로 앞'], ['CCC-TBL', 16, 23, '표를 감쌈'], ['DDD-TAIL', 24, 32, '문단 끝']]);
        assert.equal(saved.getTextFileUnicode(true), source.getTextFileUnicode(true));
        // Memo starts at 0, 16 and 24; the footnotes, equation and table keep their places.
        assert.equal(saved.getControlTextPositions(0, 1), '[0,8,15,16,19,24,32]');
      } finally {saved.free();}
      pass(entry.name + ' memos added next to and over a footnote, an equation and an inline table anchor the selected text');
      await openList(frame);
      for (const n of [1, 2, 3]) await frame.getByRole('button', {name: `메모 ${n} 지우기`, exact: true}).click();
      await frame.getByText('메모가 없습니다.', {exact: true}).waitFor();
      await closeList(frame);
      await save(page, 2);
      const cleared = new HwpDocument(await readFile(entry.output));
      try {
        assert.deepEqual(JSON.parse(cleared.getMemos()), []);
        assert.equal(cleared.getControlTextPositions(0, 1), '[8,15,19,32]');
        assert.equal(cleared.getTextFileUnicode(true), source.getTextFileUnicode(true));
      } finally {cleared.free();}
      assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);
      pass(entry.name + ' deleting those memos leaves the objects and text as they were');
    } finally {source.free(); await page.close();}
  }
  for (const entry of data.documents.filter(e => e.name === 'memo-hancom.hwp')) {
    const source = new HwpDocument(await readFile(entry.source)), page = await context.newPage(), frame = page.frameLocator('#editor iframe');
    try {
      await page.goto(base + '/editor?id=' + entry.id); await ready(page);
      await openList(frame);
      const head = await frame.getByRole('group', {name: '메모 1', exact: true}).locator('p').first().textContent();
      assert.ok(head.includes('(여러 문단)'), head);
      assert.equal(await frame.getByRole('textbox', {name: '메모 1 내용', exact: true}).inputValue(), '수정');
      await frame.getByRole('button', {name: '메모 1 지우기', exact: true}).click();
      await frame.getByText('메모가 없습니다.', {exact: true}).waitFor();
      await closeList(frame);
      await save(page, 1);
      const saved = new HwpDocument(await readFile(entry.output));
      try {
        assert.deepEqual(JSON.parse(saved.getMemos()), []);
        assert.equal(saved.getTextFileUnicode(true), source.getTextFileUnicode(true));
        assert.equal(saved.getParagraphCount(0), source.getParagraphCount(0));
      } finally {saved.free();}
      assert.equal(digest(await readFile(entry.source)), entry.sourceSha256);
      assert.equal(JSON.parse(await readFile(entry.output + '.receipt.json')).contentLoss.count, 0);
      pass('memo-hancom.hwp a Hancom memo spanning paragraphs is deleted from the list and the text stays');
    } finally {source.free(); await page.close();}
  }
  for (const entry of data.documents.filter(e => e.name.startsWith('memo.'))) {
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
      await recovered(page);
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
