import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initSync, HwpDocument} from '../.build/core/rhwp.js';
import {hwpRecords} from './ole-fixture.mjs';
import {unzip, zip} from './zip-fixture.mjs';

initSync({module: await readFile('.build/core/rhwp_bg.wasm')});
const blank = await readFile('.cache/rhwp/saved/blank2010.hwp');
const HWPTAG_MEMO_LIST = 0x10 + 77;
const body = para => ({section: 0, para, cellPath: []});
const paragraphText = (d, para) => d.getTextRange(0, para, 0, d.getParagraphLength(0, para));
const memos = d => JSON.parse(d.getMemos()).map(({number, target, start, end, anchorText, text}) => ({number, target, start, end, anchorText, text}));
const CREATED = Date.UTC(2026, 9, 14, 5, 30); // fixed so saved bytes are reproducible
const insert = (d, target, start, end, text) => d.insertMemoEx(JSON.stringify({target, start, end, text, createdAt: CREATED}));

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

// Hancom's own HWP memo layout (upstream sample samples/issue5866/memo_field_hwp5.hwp): every memo starts with a `%%me`
// PARA_TEXT marker even though its CTRL_HEADER is `%unk` with flags 0x8001, the command carries the creation FILETIME,
// and MEMO_LIST groups follow the children of the real last body paragraph. Hancom drew no balloon for memos written
// with a `%unk` text marker and left the balloon empty when the lists hung off an extra empty paragraph.
function memoLayout(bytes) {
  const records = hwpRecords(Buffer.from(bytes));
  const markers = [], headers = [];
  for (const r of records) {
    if (r.tag === 67) for (let k = 0; k + 16 <= r.body.length; k += 2) {
      if (r.body.readUInt16LE(k) === 3 && r.body.readUInt16LE(k + 14) === 3) {
        const id = Buffer.from(r.body.subarray(k + 2, k + 6)).reverse().toString('latin1');
        if (id.includes('me') || id.includes('unk')) markers.push(id);
        k += 14;
      }
    }
    if (r.tag === 71 && r.body.length > 11) {
      const len = r.body.readUInt16LE(9), command = r.body.subarray(11, 11 + len * 2).toString('utf16le');
      if (command.startsWith('MEMO/')) headers.push({id: Buffer.from(r.body.subarray(0, 4)).reverse().toString('latin1'), props: r.body.readUInt32LE(4), command});
    }
  }
  const ends = [];
  for (const r of records) if (r.tag === 67) for (let k = 0; k + 16 <= r.body.length; k += 2) {
    const u = j => r.body.readUInt16LE(k + 2 * j);
    if (u(0) === 4 && u(7) === 4 && u(1) === 0x6d65 && u(2) === 0x0025) {ends.push([u(1), u(2), u(4), u(5), u(6)].map(x => x.toString(16)).join(' ')); k += 14;}
  }
  const firstList = records.findIndex(r => r.tag === HWPTAG_MEMO_LIST);
  const owner = records.slice(0, firstList).findLastIndex(r => r.tag === 66 && r.level === 0);
  const bodyParagraphs = records.filter((r, i) => r.tag === 66 && r.level === 0).length;
  return {markers, ends, headers, lists: records.filter(r => r.tag === HWPTAG_MEMO_LIST).length, ownerIsLastParagraph: owner === records.findLastIndex(r => r.tag === 66 && r.level === 0), bodyParagraphs};
}

test('saved HWP memos use the Hancom layout, also after the file is read back and saved again', () => {
  const {d} = makeDocument();
  try {
    const paragraphs = d.getParagraphCount(0);
    const filetime = (BigInt(CREATED) + 11644473600000n) * 10000n;
    const time = `${filetime & 0xffffffffn}/${filetime >> 32n}`;
    const check = bytes => {
      const layout = memoLayout(bytes);
      assert.deepEqual(layout.markers, ['%%me', '%%me', '%%me']);
      assert.deepEqual(layout.headers.map(h => [h.id, h.props]), [['%unk', 0x8001], ['%unk', 0x8001], ['%unk', 0x8001]]);
      assert.deepEqual(layout.headers.map(h => h.command.split('/').slice(3, 5).join('/')), [time, time, time]);
      assert.equal(layout.ownerIsLastParagraph, true);
      assert.equal(layout.bodyParagraphs, paragraphs, 'no extra paragraph carries the memo lists');
    };
    const first = d.exportHwp(); check(first);
    const reread = reopen(first);
    try {reread.insertText(0, 0, 11, ' 추가'); check(reread.exportHwp());} finally {reread.free();}
  } finally {d.free();}
});

test('a Hancom-made HWP memo keeps its body, author and layout through an edit and an HWP save', async () => {
  const {execFileSync} = await import('node:child_process');
  const source = execFileSync('git', ['-C', '.cache/rhwp', 'show', 'HEAD:samples/issue5866/memo_field_hwp5.hwp'], {maxBuffer: 1 << 26});
  const d = reopen(source);
  try {
    assert.deepEqual(memos(d).map(m => [m.number, m.text]), [[1, '수정']]);
    assert.equal(JSON.parse(d.getMemos())[0].author, 'CDC');
    const paragraphs = d.getParagraphCount(0), original = memoLayout(source);
    assert.equal(d.setMemoText(1, '수정 확인'), true);
    const saved = d.exportHwp(), layout = memoLayout(saved);
    assert.deepEqual(layout.markers, original.markers);
    assert.deepEqual(layout.ends, original.ends, 'the multi-paragraph memo keeps the Hancom memo end marker');
    assert.deepEqual(layout.headers, original.headers);
    assert.equal(layout.ownerIsLastParagraph, true);
    const r = reopen(saved);
    try {
      assert.deepEqual(memos(r).map(m => [m.number, m.text]), [[1, '수정 확인']]);
      assert.equal(r.getParagraphCount(0), paragraphs);
    } finally {r.free();}
  } finally {d.free();}
});

const hancomSample = async () => {
  const {execFileSync} = await import('node:child_process');
  return execFileSync('git', ['-C', '.cache/rhwp', 'show', 'HEAD:samples/issue5866/memo_field_hwp5.hwp'], {maxBuffer: 1 << 26});
};

test('a memo spanning paragraphs is listed with its anchor and can be deleted without touching the text', async () => {
  const d = reopen(await hancomSample());
  try {
    const [memo] = JSON.parse(d.getMemos());
    assert.equal(memo.start, null);
    assert.ok(memo.anchorText.includes('\n') && memo.anchorText.length > 20, 'anchor text spans paragraphs');
    const text = d.getTextFileUnicode(true), paragraphs = d.getParagraphCount(0);
    assert.equal(d.deleteMemo(1), true);
    assert.deepEqual(JSON.parse(d.getMemos()), []);
    assert.equal(d.getTextFileUnicode(true), text);
    const saved = d.exportHwp(), layout = memoLayout(saved);
    assert.deepEqual([layout.markers, layout.ends, layout.headers, layout.lists], [[], [], [], 0]);
    for (const bytes of [saved, d.exportHwpx()]) {
      const r = reopen(bytes);
      try {
        assert.deepEqual(JSON.parse(r.getMemos()), []);
        assert.equal(r.getTextFileUnicode(true), text);
        assert.equal(r.getParagraphCount(0), paragraphs);
      } finally {r.free();}
    }
  } finally {d.free();}
});

test('memos inside a text box are listed, saved and read back in both formats', () => {
  const d = new HwpDocument(blank);
  try {
    d.createBlankDocument(); d.insertText(0, 0, 0, 'HOST'); d.splitParagraph(0, 0, 4);
    d.createShapeControl(JSON.stringify({sectionIdx: 0, paraIdx: 1, charOffset: 0, width: 30000, height: 10000, treatAsChar: true, shapeType: 'textbox', horzOffset: 0, vertOffset: 0}));
    d.insertTextInCell(0, 1, 0, 0, 0, 0, 'BOX 글상자');
    const box = {section: 0, para: 1, cellPath: [[0, 0, 0]]};
    assert.equal(insert(d, box, 0, 3, '글상자 메모'), 1);
    const expected = [{number: 1, target: box, start: 0, end: 3, anchorText: 'BOX', text: '글상자 메모'}];
    assert.deepEqual(memos(d), expected);
    for (const bytes of [d.exportHwp(), d.exportHwpx()]) {
      const r = reopen(bytes);
      try {assert.deepEqual(memos(r), expected);} finally {r.free();}
    }
    assert.deepEqual(memoLayout(d.exportHwp()).markers, ['%%me']);
  } finally {d.free();}
});

test('memos in two sections keep their bodies in HWP and HWPX', () => {
  const base = new HwpDocument(blank);
  let two;
  try {
    base.createBlankDocument(); base.insertText(0, 0, 0, 'SECTION-ONE text');
    const entries = unzip(Buffer.from(base.exportHwpx()));
    const hpf = entries.get('Contents/content.hpf').toString(), header = entries.get('Contents/header.xml').toString(), s0 = entries.get('Contents/section0.xml').toString();
    entries.set('Contents/section1.xml', Buffer.from(s0.replace(/SECTION-ONE/g, 'SECTION-TWO')));
    entries.set('Contents/content.hpf', Buffer.from(hpf.replace(/(<opf:item\b[^>]*id="section0"[^>]*\/>)/, '$1<opf:item id="section1" href="Contents/section1.xml" media-type="application/xml" isEmbeded="0"/>').replace(/(<opf:itemref\b[^>]*idref="section0"[^>]*\/>)/, '$1<opf:itemref idref="section1" linear="yes"/>')));
    entries.set('Contents/header.xml', Buffer.from(header.replace(/secCnt="\d+"/, 'secCnt="2"')));
    two = new HwpDocument(zip(entries));
    assert.equal(insert(two, {section: 0, para: 0, cellPath: []}, 0, 11, '첫 구역 메모'), 1);
    assert.equal(insert(two, {section: 1, para: 0, cellPath: []}, 0, 11, '둘째 구역 메모'), 2);
    const expected = memos(two);
    assert.deepEqual(expected.map(m => [m.target.section, m.anchorText, m.text]), [[0, 'SECTION-ONE', '첫 구역 메모'], [1, 'SECTION-TWO', '둘째 구역 메모']]);
    for (const bytes of [two.exportHwp(), two.exportHwpx()]) {
      const r = reopen(bytes);
      try {assert.deepEqual(memos(r), expected);} finally {r.free();}
    }
    // Hancom reads memo bodies only from the end of the last section; a list left in section 0 showed an empty memo.
    const hwp = Buffer.from(two.exportHwp()), lists = name => hwpRecords(hwp, name).filter(x => x.tag === HWPTAG_MEMO_LIST).map(x => x.body.readUInt32LE(0));
    assert.deepEqual([lists('BodyText/Section0'), lists('BodyText/Section1')], [[], [1, 2]]);
    const r = reopen(two.exportHwp());
    try {r.setMemoText(2, '둘째 구역 고친 메모'); const again = reopen(r.exportHwp()); try {assert.deepEqual(memos(again).map(m => m.text), ['첫 구역 메모', '둘째 구역 고친 메모']);} finally {again.free();}} finally {r.free();}
  } finally {base.free(); two?.free();}
});

// Objects (footnotes, equations, tables) sit in the paragraph text as 8-unit slots between letters. A memo next to an
// object must close before it and open after it, so the object stays outside, and a memo over an object keeps it inside.
function objectParagraph() {
  const d = new HwpDocument(blank);
  d.createBlankDocument();
  d.insertText(0, 0, 0, '첫 문단'); d.splitParagraph(0, 0, 4);
  d.insertText(0, 1, 0, '각주 앞 글자 수식 뒤 표 옆 끝 문장');
  d.insertFootnote(0, 1, 4);
  d.insertEquation(0, 1, 10, 'x+y', 1000, 0);
  d.createTableEx(JSON.stringify({sectionIdx: 0, paraIdx: 1, charOffset: 14, rowCount: 1, colCount: 1, treatAsChar: true}));
  d.insertFootnote(0, 1, d.getParagraphLength(0, 1));
  return d;
}

// Body paragraph text of a saved HWP as tokens: letters, [id] for object and field-begin slots, [/] for field ends.
function bodyTokens(bytes) {
  return hwpRecords(Buffer.from(bytes)).filter(r => r.tag === 67 && r.level === 1).map(r => {
    let out = '';
    for (let k = 0; k + 1 < r.body.length; k += 2) {
      const c = r.body.readUInt16LE(k);
      if (c >= 32) {out += String.fromCharCode(c); continue;}
      if (c === 13) continue;
      out += c === 4 ? '[/]' : `[${Buffer.from(r.body.subarray(k + 2, k + 6)).reverse().toString('latin1').trim()}]`;
      k += 14;
    }
    return out;
  });
}

const paragraphRecords = bytes => hwpRecords(Buffer.from(bytes)).filter(r => r.tag === 67 || r.tag === 68).map(r => r.body.toString('hex'));

test('memos next to and over footnotes, equations and inline tables keep the objects in place in HWP and HWPX', () => {
  const plain = objectParagraph(), d = objectParagraph();
  try {
    const positions = plain.getControlTextPositions(0, 1);
    assert.equal(positions, '[4,10,14,21]');
    assert.equal(insert(d, body(1), 2, 4, '각주 바로 앞'), 1);
    assert.equal(insert(d, body(1), 10, 12, '수식 바로 뒤'), 2);
    assert.equal(insert(d, body(1), 13, 16, '표를 감쌈'), 3);
    assert.equal(insert(d, body(1), 17, 21, '문단 끝, 뒤에 각주'), 4);
    assert.equal(paragraphText(d, 1), paragraphText(plain, 1));
    assert.deepEqual(bodyTokens(d.exportHwp())[1], '각주[%%me] 앞[/][fn] 글자 수식[eqed][%%me] 뒤[/] [%%me]표[tbl] 옆[/] [%%me]끝 문장[/][fn]');
    const expected = memos(d);
    assert.deepEqual(expected.map(m => m.anchorText), [' 앞', ' 뒤', '표 옆', '끝 문장']);
    for (const [name, bytes] of [['HWP', d.exportHwp()], ['HWPX', d.exportHwpx()]]) {
      const r = reopen(bytes);
      try {
        assert.deepEqual(memos(r), expected, name);
        assert.equal(paragraphText(r, 1), paragraphText(plain, 1), name);
        assert.equal(r.getControlTextPositions(0, 1), '[2,4,10,10,13,14,17,21]', name);
        for (const m of expected) r.deleteMemo(m.number);
        assert.equal(r.getControlTextPositions(0, 1), positions, name);
        // With every memo gone, the paragraph text and character shapes are written exactly as for the untouched document.
        assert.deepEqual(paragraphRecords(r.exportHwp()), paragraphRecords(plain.exportHwp()), name);
      } finally {r.free();}
    }
  } finally {plain.free(); d.free();}
});

test('memos that touch an auto number are refused; a memo over one keeps it in place', () => {
  const base = new HwpDocument(blank);
  let d;
  try {
    base.createBlankDocument();
    base.insertText(0, 0, 0, '첫 문단'); base.splitParagraph(0, 0, 4);
    base.insertText(0, 1, 0, '그림 번호 뒤 글자');
    const entries = unzip(Buffer.from(base.exportHwpx()));
    const xml = entries.get('Contents/section0.xml').toString('utf8');
    const autoNum = '<hp:ctrl><hp:autoNum num="1" numType="PICTURE"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar="" supscript="0"/></hp:autoNum></hp:ctrl>';
    entries.set('Contents/section0.xml', Buffer.from(xml.replace('<hp:t>그림 번호 뒤 글자</hp:t>', `<hp:t>그림 </hp:t>${autoNum}<hp:t>번호 뒤 글자</hp:t>`)));
    d = new HwpDocument(zip(entries));
    // The auto number is the placeholder letter at index 3.
    assert.equal(paragraphText(d, 1), '그림  번호 뒤 글자');
    assert.equal(d.getControlTextPositions(0, 1), '[3]');
    const before = Buffer.from(d.exportHwpx());
    for (const [start, end] of [[3, 5], [4, 6], [0, 3], [0, 4]]) assert.throws(() => insert(d, body(1), start, end, 'x'), /자동 번호와 맞닿은/);
    assert.deepEqual(Buffer.from(d.exportHwpx()), before);
    assert.equal(insert(d, body(1), 1, 6, '번호를 감쌈'), 1);
    for (const bytes of [d.exportHwp(), d.exportHwpx()]) {
      const r = reopen(bytes);
      try {
        assert.equal(paragraphText(r, 1), '그림  번호 뒤 글자');
        assert.equal(r.getControlTextPositions(0, 1), '[1,3]');
        assert.deepEqual(memos(r).map(m => [m.start, m.end]), [[1, 6]]);
        r.deleteMemo(1);
        const again = reopen(r.exportHwp());
        try {assert.equal(paragraphText(again, 1), '그림  번호 뒤 글자'); assert.equal(again.getControlTextPositions(0, 1), '[3]');} finally {again.free();}
      } finally {r.free();}
    }
  } finally {base.free(); d?.free();}
});
