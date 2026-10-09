import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalOperationJournal } from '../overlay/rhwp-studio/src/recovery/local-operation-journal.ts';
import { LOCAL_JOURNAL_METHODS } from '../overlay/rhwp-studio/src/recovery/local-journal-methods.ts';
const fake = (offset = 0) => {
  let text = '', next = offset;
  const snapshots = new Map();
  return { insertText: (_s,_p,_o,v) => { text += v; return 'ok'; },
    getText: () => text, exportHwpx: () => new Uint8Array(),
    saveSnapshot: () => { const id = ++next; snapshots.set(id,text); return id; },
    restoreSnapshot: id => { assert.ok(snapshots.has(id)); text=snapshots.get(id); },
    discardSnapshot: id => snapshots.delete(id) };
};
test('only successful mutations are recorded; acknowledgement retains concurrent edits', () => {
  const j=new LocalOperationJournal(()=>{}), doc=j.wrap(fake());j.start();
  doc.getText();doc.exportHwpx();doc.insertText(0,0,0,'A');
  const a=j.read(0);assert.equal(a.operations.length,1);
  doc.insertText(0,0,1,'B');j.acknowledge(a.revision);
  assert.deepEqual(j.read(a.revision).operations.map(o=>o.args[3]),['B']);
});
test('recovery maps undo handles instead of assuming native IDs repeat', () => {
  const j=new LocalOperationJournal(()=>{}), doc=j.wrap(fake(20));j.start();
  doc.insertText(0,0,0,'A');const snapshot=doc.saveSnapshot();doc.insertText(0,0,1,'B');doc.restoreSnapshot(snapshot);doc.discardSnapshot(snapshot);
  const recovered=fake(900);j.replay(recovered,j.read(0).operations);assert.equal(recovered.getText(),'A');
});
test('bad ordering or an unknown replay command is rejected', () => {
  const j=new LocalOperationJournal(()=>{});
  assert.throws(()=>j.replay(fake(),[{seq:2,method:'insertText',args:[]}]),/순서/);
  assert.throws(()=>j.replay(fake(),[{seq:1,method:'free',args:[]}]),/순서/);
});
test('failed mutation blocks a false recovery-saved status', () => {
  const j=new LocalOperationJournal(()=>{});const doc=j.wrap({insertText(){throw new Error('failure');}});j.start();
  assert.throws(()=>doc.insertText(),/failure/);assert.ok(j.read(0).blocked);assert.equal(j.read(0).operations.length,0);
});
test('binary picture payloads are copied before engine call', () => {
  const j=new LocalOperationJournal(()=>{}),doc=j.wrap({insertPictureEx(bytes){bytes[0]=9;}});j.start();
  const bytes=new Uint8Array([1,2]);doc.insertPictureEx(bytes);assert.deepEqual([...j.read(0).operations[0].args[0]],[1,2]);
});
