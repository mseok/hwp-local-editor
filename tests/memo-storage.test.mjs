import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initSync, HwpDocument} from '../.build/core/rhwp.js';
import {hwpRecords} from './ole-fixture.mjs';
import {unzip} from './zip-fixture.mjs';

initSync({module: await readFile('.build/core/rhwp_bg.wasm')});
const blank = await readFile('.cache/rhwp/saved/blank2010.hwp');
const HWPTAG_MEMO_LIST = 0x10 + 77;
const body = para => ({section: 0, para, cellPath: []});
const paragraphText = (d, para) => d.getTextRange(0, para, 0, d.getParagraphLength(0, para));
const memos = d => JSON.parse(d.getMemos()).map(({number, target, start, end, anchorText, text}) => ({number, target, start, end, anchorText, text}));
const insert = (d, target, start, end, text) => d.insertMemoEx(JSON.stringify({target, start, end, text}));

// Three memos: in the first paragraph (which also holds the section and column controls), in a second
// paragraph with a two-line body, and inside a table cell.
function makeDocument() {
  const d = new HwpDocument(blank);
  d.createBlankDocument();
  d.insertText(0, 0, 0, '첫째 문단 메모 대상'); d.splitParagraph(0, 0, 11);
  d.insertText(0, 1, 0, '둘째 문단'); d.splitParagraph(0, 1, 5);
  const table = JSON.parse(d.createTable(0, 2, 0, 1, 2));
  d.insertTextInCell(0, table.paraIdx, table.controlIdx, 0, 0, 0, '셀 글자');
  const cell = {section: 0, para: table.paraIdx, cellPath: [[table.controlIdx, 0, 0]]};
  assert.equal(insert(d, body(0), 3, 5, '첫 메모'), 1);
  assert.equal(insert(d, body(1), 0, 2, '둘째 메모\n두 번째 줄'), 2);
  assert.equal(insert(d, cell, 0, 1, '셀 메모'), 3);
  return {d, cell};
}

function reopen(bytes) {return new HwpDocument(bytes);}

test('memos are listed with their anchors, and edits change only the memo body', () => {
  const {d, cell} = makeDocument();
  try {
    assert.deepEqual(memos(d), [
      {number: 1, target: body(0), start: 3, end: 5, anchorText: '문단', text: '첫 메모'},
      {number: 2, target: body(1), start: 0, end: 2, anchorText: '둘째', text: '둘째 메모\n두 번째 줄'},
      {number: 3, target: cell, start: 0, end: 1, anchorText: '셀', text: '셀 메모'},
    ]);
    assert.equal(d.setMemoText(1, '고친 메모'), true);
    assert.equal(d.setMemoText(1, '고친 메모'), false, 'same text is not a change');
    assert.equal(memos(d)[0].text, '고친 메모');
    assert.equal(paragraphText(d, 0), '첫째 문단 메모 대상');
    assert.equal(paragraphText(d, 1), '둘째 문단');
  } finally {d.free();}
});

test('overlapping, touching and empty ranges are refused without changing the document', () => {
  const {d} = makeDocument();
  try {
    const before = Buffer.from(d.exportHwpx());
    assert.throws(() => insert(d, body(0), 4, 6, 'x'), /겹치거나 맞닿은/);
    assert.throws(() => insert(d, body(0), 5, 7, 'x'), /겹치거나 맞닿은/);
    assert.throws(() => insert(d, body(0), 7, 7, 'x'), /비어 있지 않은/);
    assert.throws(() => insert(d, body(0), 7, 99, 'x'), /비어 있지 않은/);
    assert.throws(() => d.setMemoText(99, 'x'), /찾을 수 없습니다/);
    assert.deepEqual(Buffer.from(d.exportHwpx()), before);
  } finally {d.free();}
});

for (const [name, exportBytes] of [['HWP', d => d.exportHwp()], ['HWPX', d => d.exportHwpx()]]) {
  test(`memo bodies, anchors and paragraphs survive a saved ${name} round trip`, () => {
    const {d} = makeDocument();
    try {
      d.setMemoText(1, '고친 메모');
      const expected = memos(d), paragraphs = d.getParagraphCount(0);
      const r = reopen(exportBytes(d));
      try {
        assert.deepEqual(memos(r), expected);
        assert.equal(r.getParagraphCount(0), paragraphs, 'the HWP memo tail is not read back as a body paragraph');
        // A body edit forces the section to be written from the model instead of the original stream.
        r.insertText(0, 0, 11, ' 추가');
        const again = reopen(exportBytes(r));
        try {
          assert.deepEqual(memos(again), expected);
          assert.equal(again.getParagraphCount(0), paragraphs);
          assert.equal(paragraphText(again, 0), '첫째 문단 메모 대상 추가');
        } finally {again.free();}
      } finally {r.free();}
    } finally {d.free();}
  });
}

test('memos survive HWP to HWPX to HWP conversion', () => {
  const {d} = makeDocument();
  try {
    const expected = memos(d);
    const fromHwp = reopen(d.exportHwp());
    const asHwpx = reopen(fromHwp.exportHwpx());
    const backToHwp = reopen(asHwpx.exportHwp());
    try {
      for (const doc of [fromHwp, asHwpx, backToHwp]) assert.deepEqual(memos(doc), expected);
    } finally {fromHwp.free(); asHwpx.free(); backToHwp.free();}
  } finally {d.free();}
});

test('saved files carry the Hancom memo storage: MEMO_LIST records in HWP and MEMO fields with bodies in HWPX', () => {
  const {d} = makeDocument();
  try {
    const memoLists = hwpRecords(Buffer.from(d.exportHwp())).filter(r => r.tag === HWPTAG_MEMO_LIST);
    assert.deepEqual(memoLists.map(r => [r.level, r.body.readUInt32LE(0)]), [[1, 1], [1, 2], [1, 3]]);
    const xml = unzip(Buffer.from(d.exportHwpx())).get('Contents/section0.xml').toString('utf8');
    assert.equal((xml.match(/type="MEMO"/g) ?? []).length, 3);
    for (const n of [1, 2, 3]) assert.match(xml, new RegExp(`<hp:integerParam name="Number">${n}</hp:integerParam>`));
    for (const text of ['첫 메모', '둘째 메모', '두 번째 줄', '셀 메모']) assert.ok(xml.includes(`<hp:t>${text}</hp:t>`), text);
  } finally {d.free();}
});

test('deleting a memo keeps the anchored text and the other memos', () => {
  const {d} = makeDocument();
  try {
    assert.equal(d.deleteMemo(2), true);
    assert.deepEqual(memos(d).map(m => m.number), [1, 3]);
    assert.equal(paragraphText(d, 1), '둘째 문단');
    for (const bytes of [d.exportHwp(), d.exportHwpx()]) {
      const r = reopen(bytes);
      try {
        assert.deepEqual(memos(r), memos(d));
        assert.equal(paragraphText(r, 1), '둘째 문단');
      } finally {r.free();}
    }
    assert.throws(() => d.deleteMemo(2), /찾을 수 없습니다/);
  } finally {d.free();}
});
