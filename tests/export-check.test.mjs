import test from 'node:test';
import assert from 'node:assert/strict';
import {requireLosslessExport} from '../app/export-check.mjs';

test('only a complete zero-loss report for the requested format permits publication',()=>{
  const report={schemaVersion:1,outputFormat:'hwpx',count:0,losses:[]};
  assert.equal(requireLosslessExport(report,'hwpx'),report);
  for(const invalid of [undefined,{...report,schemaVersion:2},{...report,outputFormat:'hwp'},{...report,losses:[{}]},{...report,count:1}, {...report,count:-1}]) {
    assert.throws(()=>requireLosslessExport(invalid,'hwpx'),/검사를 확인할 수 없습니다/);
  }
  assert.throws(()=>requireLosslessExport({...report,count:1,losses:[{code:'binaryContentEmptied'}]},'hwpx'),/1건의 내용 손실/);
});
