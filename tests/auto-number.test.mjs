import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initSync, HwpDocument} from '../.build/core/rhwp.js';
import {hwpRecords} from './ole-fixture.mjs';

initSync({module: await readFile('.build/core/rhwp_bg.wasm')});
const blank = await readFile('.cache/rhwp/saved/blank2010.hwp');
const text = (d, para) => d.getTextRange(0, para, 0, d.getParagraphLength(0, para));

// Body paragraph text of a saved HWP: letters, [auto] for an auto number slot, [id] for other 8-unit slots.
function bodyTokens(bytes) {
  return hwpRecords(Buffer.from(bytes)).filter(r => r.tag === 67 && r.level === 1).map(r => {
    let out = '';
    for (let k = 0; k + 1 < r.body.length; k += 2) {
      const c = r.body.readUInt16LE(k);
      if (c >= 32) {out += String.fromCharCode(c); continue;}
      if (c === 13) continue;
      out += c === 0x12 ? '[auto]' : `[${Buffer.from(r.body.subarray(k + 2, k + 6)).reverse().toString('latin1').trim()}]`;
      k += 14;
    }
    return out;
  });
}

// InsertPageNum through the web HwpCtrl API puts an auto number at the caret. Its placeholder letter must take the
// control's 8 units; with only one, the number was written at the paragraph end and every save added a space.
test('an auto number inserted at the caret stays where it was put and adds no letter on save', () => {
  const d = new HwpDocument(blank);
  try {
    d.createBlankDocument();
    d.insertText(0, 0, 0, '첫 문단'); d.splitParagraph(0, 0, 4);
    d.insertText(0, 1, 0, '쪽 번호 뒤 글자');
    assert.equal(d.insertAutoNumberAtCursor(0, 1, 2, 'page'), '{"ok":true}');
    assert.equal(text(d, 1), '쪽  번호 뒤 글자');
    assert.equal(d.getControlTextPositions(0, 1), '[2]');
    assert.equal(bodyTokens(d.exportHwp())[1], '쪽 [auto]번호 뒤 글자');
    for (const exportBytes of [x => x.exportHwp(), x => x.exportHwpx()]) {
      const once = new HwpDocument(exportBytes(d));
      try {
        assert.equal(text(once, 1), '쪽  번호 뒤 글자');
        assert.equal(once.getControlTextPositions(0, 1), '[2]');
        once.insertText(0, 0, 4, '.');
        const twice = new HwpDocument(exportBytes(once));
        try {
          assert.equal(text(twice, 1), '쪽  번호 뒤 글자');
          assert.equal(twice.getControlTextPositions(0, 1), '[2]');
        } finally {twice.free();}
      } finally {once.free();}
    }
  } finally {d.free();}
});
