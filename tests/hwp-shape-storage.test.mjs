import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initSync, HwpDocument} from '../.build/core/rhwp.js';
import {shapeStorageWords} from './ole-fixture.mjs';

initSync({module: await readFile('.build/core/rhwp_bg.wasm')});
const blank = await readFile('.cache/rhwp/saved/blank2010.hwp');
const control = (paraIdx, shapeType) => JSON.stringify({sectionIdx: 0, paraIdx, charOffset: 0, width: 30000, height: 10000, treatAsChar: true, shapeType, horzOffset: 0, vertOffset: 0});

// Hancom stores 0x0108_0000 in the SHAPE_COMPONENT word of a rectangle that holds a text box and 0x0008_0000 for a plain
// drawing. Its Quick Look extension refused files whose created text boxes lacked the text box bit.
test('a text box created by the editor stores the Hancom text box bit and a plain rectangle does not', () => {
  const d = new HwpDocument(blank);
  try {
    // Paragraph 0 starts with the section and column controls, so the shapes go into later paragraphs.
    d.createBlankDocument(); d.insertText(0, 0, 0, 'HOST'); d.splitParagraph(0, 0, 'HOST'.length);
    d.insertText(0, 1, 0, 'TWO'); d.splitParagraph(0, 1, 'TWO'.length);
    d.createShapeControl(control(1, 'textbox')); d.insertTextInCell(0, 1, 0, 0, 0, 0, 'BOX');
    d.createShapeControl(control(2, 'rectangle'));
    const words = shapeStorageWords(Buffer.from(d.exportHwp()));
    assert.deepEqual(words.map(v => v.toString(16)), ['1080000', '80000']);
    const reopened = new HwpDocument(d.exportHwp());
    try {assert.deepEqual(shapeStorageWords(Buffer.from(reopened.exportHwp())).map(v => v.toString(16)), ['1080000', '80000']);} finally {reopened.free();}
  } finally {d.free();}
});

// The text box property dialog changes only the model's vertical alignment. The HWP writer used to keep the original
// LIST_HEADER bits, so a new box (stored as centred) saved centred while the editor and HWPX showed it at the top, and a
// changed alignment was lost in HWP only.
test('text box vertical alignment saves to HWP as shown and as changed in the editor', () => {
  const d = new HwpDocument(blank);
  try {
    d.createBlankDocument(); d.insertText(0, 0, 0, 'HOST'); d.splitParagraph(0, 0, 'HOST'.length);
    d.createShapeControl(control(1, 'textbox')); d.insertTextInCell(0, 1, 0, 0, 0, 0, 'BOX');
    const align = doc => JSON.parse(doc.getShapeProperties(0, 1, 0)).tbVerticalAlign;
    assert.equal(align(d), 'Top');
    const reread = bytes => {const r = new HwpDocument(bytes); try {return align(r);} finally {r.free();}};
    assert.equal(reread(d.exportHwp()), 'Top');
    for (const value of ['Bottom', 'Center', 'Top']) {
      d.setShapeProperties(0, 1, 0, JSON.stringify({tbVerticalAlign: value}));
      assert.deepEqual([reread(d.exportHwp()), reread(d.exportHwpx())], [value, value]);
    }
  } finally {d.free();}
});
