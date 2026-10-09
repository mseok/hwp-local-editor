import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspace,digest} from '../app/workspace.mjs';
import {initSync,HwpDocument} from '../.build/core/rhwp.js';
import {unzip,zip} from './zip-fixture.mjs';

const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH||import.meta.url);
const {chromium}=require('playwright');
await mkdir('test-results',{recursive:true});
const root=await mkdtemp(path.resolve('test-results/nested-'));
initSync({module:await readFile('.build/core/rhwp_bg.wasm')});
const blank=await readFile('.cache/rhwp/saved/blank2010.hwp');
const outer=new HwpDocument(blank),inner=new HwpDocument(blank);
let bytes,innerTable;
try{
  outer.createBlankDocument();outer.insertText(0,0,0,'보존할 본문');outer.splitParagraph(0,0,7);outer.createTable(0,1,0,2,2);
  for(const [i,text] of ['바깥 셀 A','바깥 셀 B','바깥 셀 C','바깥 셀 D'].entries())outer.insertTextInCell(0,1,0,i,0,0,text);
  inner.createBlankDocument();const created=JSON.parse(inner.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:0,rowCount:1,colCount:2,treatAsChar:true,colWidths:[7000,7000]})));
  inner.insertTextInCell(0,0,created.controlIdx,0,0,0,'중첩 셀 보존');inner.insertTextInCell(0,0,created.controlIdx,1,0,0,'중첩 수정 대상');
  const entries=unzip(Buffer.from(outer.exportHwpx()));
  innerTable=unzip(Buffer.from(inner.exportHwpx())).get('Contents/section0.xml').toString().match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0].replace(/\bid="\d+"/g,match=>`id="${1000+Number(match.match(/\d+/)[0])}"`);
  const section=entries.get('Contents/section0.xml').toString();assert.ok(section.includes('<hp:t>바깥 셀 A</hp:t>'));
  entries.set('Contents/section0.xml',Buffer.from(section.replace('<hp:t>바깥 셀 A</hp:t>',innerTable+'<hp:t>바깥 셀 A</hp:t>')));bytes=zip(entries);
}finally{outer.free();inner.free();}
const merged=new HwpDocument(blank),middle=new HwpDocument(blank);
let mergedBytes,flatMergedBytes,mergedControl;
try{
  merged.createBlankDocument();mergedControl=JSON.parse(merged.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:0,rowCount:3,colCount:3,treatAsChar:true,colWidths:[4000,4000,4000]}))).controlIdx;
  for(let cell=0;cell<9;cell++)merged.insertTextInCell(0,0,mergedControl,cell,0,0,'병합 자료'+cell);
  merged.mergeTableCells(0,0,mergedControl,0,0,1,1);flatMergedBytes=merged.exportHwpx();
  const mergedTable=unzip(Buffer.from(flatMergedBytes)).get('Contents/section0.xml').toString().match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0];
  middle.createBlankDocument();const middleControl=JSON.parse(middle.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:0,rowCount:1,colCount:1,treatAsChar:true,colWidths:[16000]}))).controlIdx;middle.insertTextInCell(0,0,middleControl,0,0,0,'중간 표 보존');
  const middleXml=unzip(Buffer.from(middle.exportHwpx())).get('Contents/section0.xml').toString().match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0];
  const entries=unzip(bytes),section=entries.get('Contents/section0.xml').toString();
  entries.set('Contents/section0.xml',Buffer.from(section.replace(innerTable,middleXml.replace('<hp:t>중간 표 보존</hp:t>',mergedTable+'<hp:t>중간 표 보존</hp:t>'))));mergedBytes=zip(entries);
}finally{merged.free();middle.free();}
const files=[];
for(const format of ['hwp','hwpx']){
  const document=new HwpDocument(bytes);
  try{const file=path.join(root,'nested.'+format);await writeFile(file,format==='hwp'?document.exportHwp():document.exportHwpx());files.push(file);}
  finally{document.free();}
}
for(const [name,input] of [['navigation',bytes],['navigation-merged',mergedBytes],['navigation-flat',bytes],['navigation-hidden-columns',bytes]]){
  const document=new HwpDocument(input);
  try{
    if(name==='navigation-merged')document.mergeTableCellsByPath(0,1,JSON.stringify([{controlIndex:0,cellIndex:0,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}]),2,1,2,2);
    if(name==='navigation-hidden-columns'){
      const p=JSON.stringify([{controlIndex:0,cellIndex:0,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}]);
      document.splitTableCellIntoByPath(0,1,p,0,0,1,2,false,false);document.mergeTableCellsByPath(0,1,p,0,0,0,1);
    }
    for(const format of ['hwp','hwpx']){const file=path.join(root,name+'.'+format);await writeFile(file,format==='hwp'?document.exportHwp():document.exportHwpx());files.push(file);}
  }finally{document.free();}
}
const data=await createWorkspace(files,path.join(root,'output'));
const manifest=path.join(root,'workspace.json');await writeFile(manifest,JSON.stringify(data));
const port=18871,base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['app/server.mjs'],{env:{...process.env,PORT:String(port),DOCUMENT_MANIFEST:manifest},stdio:['ignore','pipe','pipe']});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined});
const context=await browser.newContext({viewport:{width:1280,height:1050}});
const report={root,checks:[],errors:[],warnings:[],externalRequests:[]};
context.on('page',page=>{page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(['warning','error'].includes(message.type()))report.warnings.push(message.text());});page.on('request',request=>{if(!request.url().startsWith(base+'/')&&!/^(blob|data):/.test(request.url()))report.externalRequests.push(request.url());});});
const pass=name=>{report.checks.push(name);console.log('PASS',name);};
const ready=page=>page.waitForFunction(()=>window.editorReady,null,{timeout:45000});
const targetPath=JSON.stringify([{controlIndex:0,cellIndex:0,cellParaIndex:0},{controlIndex:0,cellIndex:1,cellParaIndex:0}]);
async function select(page,text){
  await page.getByRole('button',{name:'찾아 바꾸기',exact:true}).click();const frame=page.frameLocator('#editor iframe');
  await frame.getByRole('textbox',{name:'찾을 내용',exact:true}).fill(text);
  await frame.getByRole('textbox',{name:'바꿀 내용',exact:true}).fill('안쪽 셀 수정 완료');
  await frame.getByRole('button',{name:'다음 찾기',exact:true}).click();
  await frame.getByText('검색 결과 1개',{exact:true}).waitFor({timeout:5000});
  await frame.getByRole('button',{name:'찾아 바꾸기 닫기',exact:true}).click();
}
async function save(page,revision){await page.getByRole('button',{name:'결과 파일 저장',exact:true}).click();await page.locator(`#delivery[data-revision="${revision}"]`).waitFor();}
function assertOuterTextFits(document,tablePath=targetPath){
  const outer=JSON.parse(document.getTableCellBboxes(0,1,0))[0];
  const label=JSON.parse(document.getCursorRectByPath(0,1,JSON.stringify([{controlIndex:0,cellIndex:0,cellParaIndex:0}]),5));
  const {x,y}=label;
  assert.ok(x>=outer.x&&x<outer.x+outer.w,'Outer-cell text must wrap inside its own cell after the inner table grows');
  assert.ok(y>outer.y&&y<=outer.y+outer.h,'Outer-cell text must stay inside its vertical cell bounds');
  const inner=JSON.parse(document.getTableCellBboxesByPath(0,1,tablePath));
  assert.ok(inner.every(cell=>cell.x>=outer.x&&cell.x+cell.w<=outer.x+outer.w+0.2&&cell.y>=outer.y&&cell.y+cell.h<=outer.y+outer.h+0.2),'Expanded inner table must remain inside its outer cell');
  assert.ok(!inner.some(cell=>x>=cell.x&&x<cell.x+cell.w&&y>cell.y&&y<cell.y+cell.h),'Outer-cell text must not overlap the expanded inner table');
}
function preserved(source,result){
  assert.equal(result.getTableProperties(0,1,0),source.getTableProperties(0,1,0));
  assert.equal(result.getTableDimensionsByPath(0,1,targetPath),source.getTableDimensionsByPath(0,1,targetPath));
  for(let i=0;i<4;i++){
    const cellPath=JSON.stringify([{controlIndex:0,cellIndex:i,cellParaIndex:0}]);
    assert.equal(result.getCharShapeRunsInCellByPath(0,1,cellPath,0,6),source.getCharShapeRunsInCellByPath(0,1,cellPath,0,6));
  }
}
try{
  await new Promise((resolve,reject)=>{let stderr='';child.stderr.on('data',v=>stderr+=v);const timer=setTimeout(()=>reject(new Error('Server startup timeout: '+stderr)),10000);child.once('error',reject);child.once('exit',code=>reject(new Error('Server exited '+code+': '+stderr)));child.stdout.once('data',()=>{clearTimeout(timer);resolve();});});
  for(const entry of data.documents.filter(entry=>entry.name.startsWith('nested.'))){
    const traversal=new HwpDocument(await readFile(entry.source));
    try{
      const first=JSON.parse(traversal.searchText('중첩',0,0,0,true,true,true,'[]'));
      assert.equal(first.totalMatchCount,2);assert.equal(first.cellPath.at(-1).cellIndex,0);
      const second=JSON.parse(traversal.searchText('중첩',first.sec,first.para,first.charOffset+first.length,true,true,true,JSON.stringify(first.cellPath)));
      assert.equal(second.cellPath.at(-1).cellIndex,1);assert.equal(second.wrapped,false);
      const previous=JSON.parse(traversal.searchText('중첩',second.sec,second.para,second.charOffset,false,true,true,JSON.stringify(second.cellPath)));
      assert.deepEqual(previous.cellPath,first.cellPath);assert.equal(previous.wrapped,false);
      const wrapped=JSON.parse(traversal.searchText('중첩',second.sec,second.para,second.charOffset+second.length,true,true,true,JSON.stringify(second.cellPath)));
      assert.deepEqual(wrapped.cellPath,first.cellPath);assert.equal(wrapped.wrapped,true);
      assert.equal(JSON.parse(traversal.searchText('중첩',0,0,0,true,true,true)).found,false);
      pass(entry.format+' next/previous search traverses equal-offset nested cells and preserves legacy search scope');
    }finally{traversal.free();}
    const properties=new HwpDocument(await readFile(entry.source));
    try{
      const outerProps=properties.getTableProperties(0,1,0);
      const outerCells=Array.from({length:4},(_,i)=>properties.getCellProperties(0,1,0,i));
      assert.throws(()=>properties.setTablePropertiesByPath(0,1,'[]',JSON.stringify({paddingTop:999})));
      assert.throws(()=>properties.setCellPropertiesByPath(0,1,JSON.stringify([{controlIndex:0,cellIndex:99,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}]),0,JSON.stringify({paddingLeft:999})));
      assert.equal(properties.getTableProperties(0,1,0),outerProps);
      const before=JSON.parse(properties.getCellPropertiesByPath(0,1,targetPath,0));
      const border={type:2,width:3,color:'#d02030'};
      properties.setCellPropertiesByPath(0,1,targetPath,0,JSON.stringify({borderFillId:before.borderFillId,borderLeft:before.borderLeft,borderRight:border}));
      assert.deepEqual(JSON.parse(properties.getCellPropertiesByPath(0,1,targetPath,0)).borderRight,border);
      assert.deepEqual(JSON.parse(properties.getCellPropertiesByPath(0,1,targetPath,1)).borderLeft,border);
      properties.setTablePropertiesByPath(0,1,targetPath,JSON.stringify({hasCaption:true,captionDirection:2,captionSpacing:401}));
      const reopened=new HwpDocument(entry.format==='hwp'?properties.exportHwp():properties.exportHwpx());
      try{
        assert.equal(reopened.getTableProperties(0,1,0),outerProps);
        for(let i=0;i<4;i++)assert.equal(reopened.getCellProperties(0,1,0,i),outerCells[i]);
        assert.deepEqual(JSON.parse(reopened.getCellPropertiesByPath(0,1,targetPath,1)).borderLeft,border);
        const caption=JSON.parse(reopened.getTablePropertiesByPath(0,1,targetPath));
        assert.equal(caption.hasCaption,true);assert.equal(caption.captionDirection,2);assert.equal(caption.captionSpacing,401);
        pass(entry.format+' nested properties reject invalid paths; shared border and caption survive export without ancestor changes');
      }finally{reopened.free();}
    }finally{properties.free();}
    const structure=new HwpDocument(await readFile(entry.source));
    try{
      const before=Buffer.from(entry.format==='hwp'?structure.exportHwp():structure.exportHwpx());
      const badPath=JSON.stringify([{controlIndex:0,cellIndex:99,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}]);
      assert.throws(()=>structure.insertTableRowByPath(0,1,'[]',0,true));
      assert.throws(()=>structure.insertTableColumnByPath(0,1,badPath,0,true));
      assert.throws(()=>structure.insertTableRowByPath(0,1,targetPath,65536,true));
      assert.throws(()=>structure.insertTableColumnByPath(0,1,targetPath,2,true));
      assert.throws(()=>structure.deleteTableRowByPath(0,1,targetPath,0));
      assert.throws(()=>structure.deleteTableColumnByPath(0,1,targetPath,2));
      assert.deepEqual(Buffer.from(entry.format==='hwp'?structure.exportHwp():structure.exportHwpx()),before);
      pass(entry.format+' invalid structural paths/indexes and last-row deletion leave export bytes unchanged');
    }finally{structure.free();}
    const nestedMerged=new HwpDocument(mergedBytes),flatMerged=new HwpDocument(flatMergedBytes);
    const mergedPath=[{controlIndex:0,cellIndex:0,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}];
    const mergedJson=JSON.stringify(mergedPath),middlePath=JSON.stringify(mergedPath.slice(0,2));
    try{
      const ancestor=nestedMerged.getTableProperties(0,1,0),parent=nestedMerged.getTablePropertiesByPath(0,1,middlePath);
      const actions=[['insertTableRow',0,true],['insertTableColumn',0,true],['deleteTableRow',1],['deleteTableColumn',1],['deleteTableRow',0],['deleteTableColumn',0],['insertTableRow',1,true],['insertTableColumn',1,true]];
      for(const [index,[method,coordinate,direction]] of actions.entries()){
        nestedMerged[method+'ByPath'](0,1,mergedJson,coordinate,...(direction===undefined?[]:[direction]));
        flatMerged[method](0,0,mergedControl,coordinate,...(direction===undefined?[]:[direction]));
        if(index===1)assert.deepEqual(JSON.parse(nestedMerged.getCellInfoByPath(0,1,mergedJson)),{row:0,col:0,rowSpan:3,colSpan:3});
        assert.equal(nestedMerged.getTableProperties(0,1,0),ancestor);assert.equal(nestedMerged.getTablePropertiesByPath(0,1,middlePath),parent);
      }
      const reopened=new HwpDocument(entry.format==='hwp'?nestedMerged.exportHwp():nestedMerged.exportHwpx());
      const flatReopened=new HwpDocument(entry.format==='hwp'?flatMerged.exportHwp():flatMerged.exportHwpx());
      try{
        assert.equal(reopened.getTablePropertiesByPath(0,1,mergedJson),flatReopened.getTableProperties(0,0,mergedControl));
        const dims=JSON.parse(reopened.getTableDimensionsByPath(0,1,mergedJson));assert.deepEqual(dims,JSON.parse(flatReopened.getTableDimensions(0,0,mergedControl)));
        for(let cell=0;cell<dims.cellCount;cell++){
          const p=structuredClone(mergedPath);p.at(-1).cellIndex=cell;
          assert.equal(reopened.getCellInfoByPath(0,1,JSON.stringify(p)),flatReopened.getCellInfo(0,0,mergedControl,cell));
          assert.equal(reopened.getCellPropertiesByPath(0,1,mergedJson,cell),flatReopened.getCellProperties(0,0,mergedControl,cell));
        }
        const text=JSON.parse(reopened.getTextFileUnicode());assert.ok(text.includes('중간 표 보존'));
        for(const value of ['바깥 셀 A','바깥 셀 B','바깥 셀 C','바깥 셀 D'])assert.ok(text.includes(value));
        assert.deepEqual(text.match(/병합 자료\d+/g).sort(),JSON.parse(flatReopened.getTextFileUnicode()).match(/병합 자료\d+/g).sort());
        const events=JSON.parse(nestedMerged.getEventLog()).events.filter(event=>event.type==='TableStructureChangedByPath');
        assert.equal(events.length,actions.length);for(const event of events){assert.deepEqual(event.cellPath,mergedPath);assert.equal(event.para,1);}
        assert.ok(JSON.parse(flatMerged.getEventLog()).events.some(event=>event.type==='TableRowInserted'));
        pass(entry.format+' three-level merged-table row/column operations match flat reference after export with path-aware events');
      }finally{reopened.free();flatReopened.free();}
    }finally{nestedMerged.free();flatMerged.free();}
    const divided=new HwpDocument(mergedBytes),flatDivided=new HwpDocument(flatMergedBytes);
    try{
      const outerBefore=divided.getTableProperties(0,1,0),middleBefore=divided.getTablePropertiesByPath(0,1,middlePath);
      const before=Buffer.from(entry.format==='hwp'?divided.exportHwp():divided.exportHwpx());
      assert.throws(()=>divided.splitTableCellIntoByPath(0,1,mergedJson,0,0,1,65535,false,true));
      assert.throws(()=>divided.splitTableCellIntoByPath(0,1,mergedJson,0,0,1,65536,false,true));
      assert.throws(()=>divided.mergeTableCellsByPath(0,1,mergedJson,0,0,0,0));
      assert.throws(()=>divided.splitTableCellsInRangeByPath(0,1,mergedJson,0,0,3,3,1,2,false));
      assert.throws(()=>divided.splitTableCellByPath(0,1,'[]',0,0));
      assert.deepEqual(Buffer.from(entry.format==='hwp'?divided.exportHwp():divided.exportHwpx()),before);
      pass(entry.format+' rejected inner splits preserve bytes even when merge-first would mutate before overflow');
      const operations=[['splitTableCell',0,0],['mergeTableCells',0,0,1,1],['splitTableCellInto',0,0,2,2,false,false],['mergeTableCells',0,0,1,1],['splitTableCellInto',0,0,2,3,true,true],['splitTableCellsInRange',0,0,1,1,2,2,false]];
      for(const [method,...args] of operations){divided[method+'ByPath'](0,1,mergedJson,...args);flatDivided[method](0,0,mergedControl,...args);}
      const reopened=new HwpDocument(entry.format==='hwp'?divided.exportHwp():divided.exportHwpx()),reference=new HwpDocument(entry.format==='hwp'?flatDivided.exportHwp():flatDivided.exportHwpx());
      try{
        assert.equal(reopened.getTableProperties(0,1,0),outerBefore);assert.equal(reopened.getTablePropertiesByPath(0,1,middlePath),middleBefore);
        const dims=JSON.parse(reopened.getTableDimensionsByPath(0,1,mergedJson));assert.deepEqual(dims,JSON.parse(reference.getTableDimensions(0,0,mergedControl)));
        assert.equal(reopened.getTablePropertiesByPath(0,1,mergedJson),reference.getTableProperties(0,0,mergedControl));
        for(let cell=0;cell<dims.cellCount;cell++)assert.equal(reopened.getCellPropertiesByPath(0,1,mergedJson,cell),reference.getCellProperties(0,0,mergedControl,cell));
        assert.deepEqual(JSON.parse(reopened.getTextFileUnicode()).match(/병합 자료\d+/g).sort(),JSON.parse(reference.getTextFileUnicode()).match(/병합 자료\d+/g).sort());
        const events=JSON.parse(divided.getEventLog()).events.filter(e=>e.type==='TableStructureChangedByPath');assert.equal(events.length,operations.length);for(const event of events)assert.deepEqual(event.cellPath,mergedPath);
        pass(entry.format+' three-level split, merge and range split match flat reference through export');
      }finally{reopened.free();reference.free();}
    }finally{divided.free();flatDivided.free();}
    const page=await context.newPage();await page.goto(base+'/editor?id='+entry.id);await ready(page);
    const frame=page.frameLocator('#editor iframe');
    await select(page,'중첩 수정 대상');
    await page.getByRole('button',{name:'찾아 바꾸기',exact:true}).click();
    assert.equal(await frame.getByRole('textbox',{name:'바꿀 내용',exact:true}).inputValue(),'안쪽 셀 수정 완료');
    await frame.getByRole('button',{name:'찾아 바꾸기 닫기',exact:true}).click();
    await frame.getByRole('button',{name:'굵게',exact:true}).click();
    await frame.getByRole('textbox',{name:'글자 크기(pt)',exact:true}).fill('12');await frame.getByRole('textbox',{name:'글자 크기(pt)',exact:true}).press('Enter');await save(page,1);
    const source=new HwpDocument(await readFile(entry.source));let result=new HwpDocument(await readFile(entry.output));
    try{
      assert.equal(result.getTextFileUnicode(),source.getTextFileUnicode());preserved(source,result);
      const props=JSON.parse(result.getCellCharPropertiesAtByPath(0,1,targetPath,0));assert.equal(props.bold,true);assert.equal(props.fontSize,1200);
      pass(entry.format+' find-selected nested cell formatting changes only the inner target');
    }finally{result.free();}
    await page.reload();await ready(page);
    await page.getByRole('button',{name:'찾아 바꾸기',exact:true}).click();
    await frame.getByRole('textbox',{name:'찾을 내용',exact:true}).fill('중첩 수정 대상');await frame.getByRole('textbox',{name:'바꿀 내용',exact:true}).fill('안쪽 셀 수정 완료');
    await frame.getByRole('button',{name:'다음 찾기',exact:true}).click();await frame.getByRole('button',{name:'바꾸기',exact:true}).click();await frame.getByRole('button',{name:'찾아 바꾸기 닫기',exact:true}).click();await save(page,2);
    result=new HwpDocument(await readFile(entry.output));
    try{
      assert.equal(JSON.parse(result.getTextFileUnicode()),JSON.parse(source.getTextFileUnicode()).replace('중첩 수정 대상','안쪽 셀 수정 완료'));preserved(source,result);
      const props=JSON.parse(result.getCellCharPropertiesAtByPath(0,1,targetPath,0));assert.equal(props.bold,true);assert.equal(props.fontSize,1200);
      assert.equal(result.getSourceFormat(),entry.format);assert.equal(digest(await readFile(entry.source)),entry.sourceSha256);
      pass(entry.format+' nested single replacement survives recovery and preserves outer text/styles');
    }finally{result.free();source.free();}
    await page.goto(base+'/editor?id='+entry.id+'&result=1');await ready(page);await page.getByRole('button',{name:'문서 텍스트 확인',exact:true}).click();await page.locator('#document-text').filter({hasText:'안쪽 셀 수정 완료'}).waitFor();
    await page.getByText('현재 문서 텍스트',{exact:true}).click();
    await select(page,'안쪽 셀 수정 완료');
    await frame.locator('#menu-bar').getByText('표',{exact:true}).click();
    await frame.getByText('표/셀 속성',{exact:true}).click();
    await frame.getByRole('button',{name:'기본',exact:true}).click();
    const width=frame.getByRole('spinbutton',{name:'표 너비(mm)',exact:true});
    assert.equal(await width.inputValue(),(14000*25.4/7200).toFixed(1));
    await width.fill('42');
    await frame.getByRole('button',{name:'셀',exact:true}).click();
    await frame.getByRole('checkbox',{name:'셀 안쪽 여백 지정',exact:true}).check();
    await frame.getByRole('spinbutton',{name:'셀 안쪽 왼쪽 여백(mm)',exact:true}).fill('1.7');
    await frame.getByRole('button',{name:'표',exact:true}).click();
    await frame.getByRole('spinbutton',{name:'표 안쪽 위쪽 여백(mm)',exact:true}).fill('1.2');
    await frame.getByRole('button',{name:'확인',exact:true}).click();
    await frame.locator('#menu-bar').getByText('편집',{exact:true}).click();
    await frame.getByText('되돌리기',{exact:true}).click();
    await frame.locator('#menu-bar').getByText('표',{exact:true}).click();
    await frame.getByText('표/셀 속성',{exact:true}).click();
    await frame.getByRole('button',{name:'기본',exact:true}).click();
    assert.equal(await width.inputValue(),(14000*25.4/7200).toFixed(1));
    await frame.getByRole('button',{name:'취소',exact:true}).click();
    await frame.locator('#menu-bar').getByText('편집',{exact:true}).click();
    await frame.getByText('다시 실행',{exact:true}).click();
    await frame.locator('#menu-bar').getByText('표',{exact:true}).click();
    await frame.getByText('표/셀 속성',{exact:true}).click();
    await frame.getByRole('button',{name:'기본',exact:true}).click();
    assert.equal(await width.inputValue(),'42.0');
    await frame.getByRole('button',{name:'취소',exact:true}).click();
    await page.waitForFunction(()=>{
      const {changeRevision,savedRevision}=document.querySelector('#status').dataset;
      return Number(changeRevision)>0&&changeRevision===savedRevision;
    });
    await page.reload();await ready(page);await save(page,3);
    const before=new HwpDocument(await readFile(entry.source));result=new HwpDocument(await readFile(entry.output));
    try{
      assert.equal(result.getTableProperties(0,1,0),before.getTableProperties(0,1,0));
      for(let cell=0;cell<4;cell++)assert.equal(result.getCellProperties(0,1,0,cell),before.getCellProperties(0,1,0,cell));
      const innerProps=JSON.parse(result.getTablePropertiesByPath(0,1,targetPath));
      assert.ok(Math.abs(innerProps.tableWidth*25.4/7200-42)<0.01);
      assert.equal(innerProps.paddingTop,Math.round(1.2*7200/25.4));
      const target=JSON.parse(result.getCellPropertiesByPath(0,1,targetPath,1));
      assert.equal(target.applyInnerMargin,true);assert.equal(target.paddingLeft,Math.round(1.7*7200/25.4));
      const unchangedCell=props=>{const {width,height,...rest}=JSON.parse(props);return rest;};
      assert.deepEqual(unchangedCell(result.getCellPropertiesByPath(0,1,targetPath,0)),unchangedCell(before.getCellPropertiesByPath(0,1,targetPath,0)));
      assert.equal(JSON.parse(result.getCellCharPropertiesAtByPath(0,1,targetPath,0)).fontSize,1200);
      assert.equal(digest(await readFile(entry.source)),entry.sourceSha256);
      pass(entry.format+' nested table width and cell/table margins survive journal recovery without ancestor changes');
    }finally{before.free();result.free();}
    await page.goto(base+'/editor?id='+entry.id+'&result=1');await ready(page);
    await page.screenshot({path:path.join(root,entry.format+'.png')});
    await select(page,'안쪽 셀 수정 완료');
    await frame.locator('#menu-bar').getByText('표',{exact:true}).click();
    await frame.getByText('줄/칸 추가하기(I)...',{exact:true}).click();
    await frame.getByRole('radio',{name:'위쪽에 줄 추가하기',exact:true}).check();
    await frame.getByRole('button',{name:'추가',exact:true}).click();
    await frame.locator('#menu-bar').getByText('표',{exact:true}).click();
    await frame.getByText('줄/칸 추가하기(I)...',{exact:true}).click();
    await frame.getByRole('radio',{name:'왼쪽에 칸 추가하기',exact:true}).check();
    await frame.getByRole('button',{name:'추가',exact:true}).click();await save(page,4);
    const original=new HwpDocument(await readFile(entry.source));result=new HwpDocument(await readFile(entry.output));
    try{
      assert.equal(result.getTableProperties(0,1,0),original.getTableProperties(0,1,0));
      assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,1,targetPath)),{rowCount:2,colCount:3,cellCount:6});
      assert.equal(JSON.parse(result.getTextFileUnicode()).split('\r\n').filter(Boolean).join('\n'),JSON.parse(original.getTextFileUnicode()).replace('중첩 수정 대상','안쪽 셀 수정 완료').split('\r\n').filter(Boolean).join('\n'));
      const shifted=JSON.parse(targetPath);shifted.at(-1).cellIndex=5;
      assert.equal(JSON.parse(result.getCellCharPropertiesAtByPath(0,1,JSON.stringify(shifted),0)).fontSize,1200);
      assertOuterTextFits(result);
      pass(entry.format+' consecutive inner row/column insertion retains cursor scope, wraps outer text and preserves outer table');
    }finally{result.free();}
    await page.goto(base+'/editor?id='+entry.id+'&result=1');await ready(page);await select(page,'안쪽 셀 수정 완료');
    await frame.locator('#menu-bar').getByText('표',{exact:true}).click();
    await frame.getByText('줄/칸 지우기(E)...',{exact:true}).click();
    await frame.getByRole('radio',{name:'칸',exact:true}).check();await frame.getByRole('button',{name:'지우기',exact:true}).click();
    // The target was the final cell. The next deletion must stay in this inner table.
    await frame.locator('#menu-bar').getByText('표',{exact:true}).click();
    await frame.getByText('줄/칸 지우기(E)...',{exact:true}).click();
    await frame.getByRole('radio',{name:'줄',exact:true}).check();await frame.getByRole('button',{name:'지우기',exact:true}).click();await save(page,5);
    result=new HwpDocument(await readFile(entry.output));
    try{
      assert.equal(result.getTableProperties(0,1,0),original.getTableProperties(0,1,0));
      const text=JSON.parse(result.getTextFileUnicode());for(const value of ['바깥 셀 A','바깥 셀 B','바깥 셀 C','바깥 셀 D'])assert.ok(text.includes(value));
      assert.ok(!text.includes('중첩 셀 보존'));assert.ok(!text.includes('안쪽 셀 수정 완료'));
      assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,1,targetPath)),{rowCount:1,colCount:2,cellCount:2});
    }finally{result.free();}
    const beforeUndo=await page.locator('#status').getAttribute('data-change-revision');
    await frame.locator('#menu-bar').getByText('편집',{exact:true}).click();await frame.getByText('되돌리기',{exact:true}).click();
    await page.waitForFunction(previous=>{const d=document.querySelector('#status').dataset;return Number(d.changeRevision)>Number(previous)&&d.changeRevision===d.savedRevision;},beforeUndo);
    await page.getByRole('button',{name:'문서 텍스트 확인',exact:true}).click();await page.locator('#document-text').filter({hasText:'중첩 셀 보존'}).waitFor();
    await page.reload();await ready(page);await save(page,6);
    result=new HwpDocument(await readFile(entry.output));
    try{
      assert.equal(result.getTableProperties(0,1,0),original.getTableProperties(0,1,0));
      const text=JSON.parse(result.getTextFileUnicode());assert.ok(text.includes('중첩 셀 보존'));assert.ok(!text.includes('안쪽 셀 수정 완료'));
      assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,1,targetPath)),{rowCount:2,colCount:2,cellCount:4});
      assert.equal(digest(await readFile(entry.source)),entry.sourceSha256);
      pass(entry.format+' inner row/column deletion clamps the cursor; undo/recovery preserves ancestor text');
    }finally{original.free();result.free();}
    await page.goto(base+'/editor?id='+entry.id+'&result=1');await ready(page);await select(page,'중첩 셀 보존');
    await frame.locator('#menu-bar').getByText('표',{exact:true}).click();
    await frame.getByText('셀 나누기',{exact:true}).click();
    await frame.getByRole('spinbutton',{name:'나눌 칸 수',exact:true}).fill('2');
    await frame.getByRole('button',{name:'나누기(D)',exact:true}).click();await save(page,7);
    result=new HwpDocument(await readFile(entry.output));
    try{
      assert.deepEqual(JSON.parse(result.getTableDimensions(0,1,0)),{rowCount:2,colCount:2,cellCount:4},'Nested cell splitting must not split the outer table');
      assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,1,targetPath)),{rowCount:2,colCount:3,cellCount:5});
      const labels=JSON.parse(result.getTextFileUnicode());for(const label of ['바깥 셀 A','바깥 셀 B','바깥 셀 C','바깥 셀 D','중첩 셀 보존'])assert.ok(labels.includes(label));
      pass(entry.format+' inner cell splitting preserves outer table scope');
    }finally{result.free();}
    await page.goto(base+'/editor?id='+entry.id+'&result=1');await ready(page);await select(page,'중첩 셀 보존');
    const input=frame.getByRole('textbox',{name:'문서 편집 입력',exact:true});
    await input.press('F5');await input.press('F5');await input.press('ArrowRight');
    await frame.locator('#menu-bar').getByText('표',{exact:true}).click();await frame.getByText('셀 합치기',{exact:true}).click();await save(page,8);
    result=new HwpDocument(await readFile(entry.output));
    try{
      assert.deepEqual(JSON.parse(result.getTableDimensions(0,1,0)),{rowCount:2,colCount:2,cellCount:4});
      assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,1,targetPath)),{rowCount:2,colCount:3,cellCount:4});
      const selected=JSON.parse(targetPath);selected.at(-1).cellIndex=2;
      assert.deepEqual(JSON.parse(result.getCellInfoByPath(0,1,JSON.stringify(selected))),{row:1,col:0,rowSpan:1,colSpan:2});
    }finally{result.free();}
    const beforeMergeUndo=await page.locator('#status').getAttribute('data-change-revision');
    await frame.locator('#menu-bar').getByText('편집',{exact:true}).click();await frame.getByText('되돌리기',{exact:true}).click();
    await page.waitForFunction(previous=>{const d=document.querySelector('#status').dataset;return Number(d.changeRevision)>Number(previous)&&d.changeRevision===d.savedRevision;},beforeMergeUndo);
    await page.reload();await ready(page);await save(page,9);
    result=new HwpDocument(await readFile(entry.output));
    try{
      assert.deepEqual(JSON.parse(result.getTableDimensions(0,1,0)),{rowCount:2,colCount:2,cellCount:4});
      assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,1,targetPath)),{rowCount:2,colCount:3,cellCount:5});
      assert.equal(digest(await readFile(entry.source)),entry.sourceSha256);
      pass(entry.format+' inner merge and undo survive journal recovery without changing the outer table');
    }finally{result.free();}
    await page.close();
  }
  for(const entry of data.documents.filter(entry=>entry.name.startsWith('navigation'))){
    const deep=entry.name.startsWith('navigation-merged');
    const flat=entry.name.startsWith('navigation-flat');
    const cellPath=[{controlIndex:0,cellIndex:0,cellParaIndex:0},...(!flat?[{controlIndex:0,cellIndex:0,cellParaIndex:0}]:[]),...(deep?[{controlIndex:0,cellIndex:0,cellParaIndex:0}]:[])];
    const pathJson=JSON.stringify(cellPath);
    const source=new HwpDocument(await readFile(entry.source));
    const sourceDimensions=JSON.parse(source.getTableDimensionsByPath(0,1,pathJson));
    const nextMarker='NEXT>'.repeat(8);
    const cellText=(document,index)=>{const p=structuredClone(cellPath);p.at(-1).cellIndex=index;return Array.from({length:document.getCellParagraphCountByPath(0,1,JSON.stringify(p))},(_,para)=>{p.at(-1).cellParaIndex=para;const j=JSON.stringify(p);return document.getTextInCellByPath(0,1,j,0,document.getCellParagraphLengthByPath(0,1,j));}).join('\n');};
    const firstText=cellText(source,0),nextText=cellText(source,1),lastIndex=sourceDimensions.cellCount-1,lastText=cellText(source,lastIndex);
    const page=await context.newPage();await page.goto(base+'/editor?id='+entry.id);await ready(page);
    const frame=page.frameLocator('#editor iframe'),input=frame.getByRole('textbox',{name:'문서 편집 입력',exact:true});
    try{
      await select(page,deep?'병합 자료0':flat?'바깥 셀 A':'중첩 셀 보존');await input.press('Tab');await page.keyboard.insertText(nextMarker);await save(page,1);
      let result=new HwpDocument(await readFile(entry.output));
      try{assert.equal(cellText(result,0),firstText,'Tab must clear the previous find selection');assert.equal(cellText(result,1),nextMarker+nextText);assert.equal(result.getTableProperties(0,1,0),source.getTableProperties(0,1,0));}
      finally{result.free();}
      await select(page,deep?'병합 자료8':flat?'바깥 셀 D':'중첩 수정 대상');await input.press('Tab');await page.keyboard.insertText('ROW>');await input.press('Shift+Tab');await page.keyboard.insertText('<BACK');await save(page,2);
      result=new HwpDocument(await readFile(entry.output));
      try{
        assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,1,pathJson)),{rowCount:sourceDimensions.rowCount+1,colCount:sourceDimensions.colCount,cellCount:sourceDimensions.cellCount+sourceDimensions.colCount},'Last inner cell Tab must append an inner row');
        assert.equal(JSON.parse(result.getTablePropertiesByPath(0,1,pathJson)).tableWidth,JSON.parse(source.getTablePropertiesByPath(0,1,pathJson)).tableWidth,'Added row must preserve the physical width even when columns have only merged-cell evidence');
        assert.equal(cellText(result,0),firstText);assert.equal(cellText(result,lastIndex),(lastIndex===1?nextMarker:'')+lastText+'<BACK');assert.equal(cellText(result,sourceDimensions.cellCount),'ROW>');
        if(flat){assert.equal(result.getTablePropertiesByPath(0,1,targetPath),source.getTablePropertiesByPath(0,1,targetPath));for(let cell=0;cell<2;cell++)assert.equal(result.getCellPropertiesByPath(0,1,targetPath,cell),source.getCellPropertiesByPath(0,1,targetPath,cell));}
        else{assert.equal(result.getTableProperties(0,1,0),source.getTableProperties(0,1,0));for(let cell=0;cell<4;cell++)assert.equal(result.getCellProperties(0,1,0,cell),source.getCellProperties(0,1,0,cell));}
        if(deep)assert.equal(result.getTablePropertiesByPath(0,1,JSON.stringify(cellPath.slice(0,2))),source.getTablePropertiesByPath(0,1,JSON.stringify(cellPath.slice(0,2))));
        assertOuterTextFits(result,flat?targetPath:pathJson);
      }finally{result.free();}
      for(let undo=0;undo<3;undo++){await frame.locator('#menu-bar').getByText('편집',{exact:true}).click();await frame.getByText('되돌리기',{exact:true}).click();}
      await page.waitForFunction(()=>{const d=document.querySelector('#status').dataset;return Number(d.changeRevision)>0&&d.changeRevision===d.savedRevision;});
      await page.reload();await ready(page);await save(page,3);result=new HwpDocument(await readFile(entry.output));
      try{
        assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,1,pathJson)),sourceDimensions);assert.equal(cellText(result,0),firstText);assert.equal(cellText(result,1),nextMarker+nextText);assert.equal(cellText(result,lastIndex),(lastIndex===1?nextMarker:'')+lastText);
        assert.equal(result.getTableProperties(0,1,0),source.getTableProperties(0,1,0));assert.equal(digest(await readFile(entry.source)),entry.sourceSha256);
        assertOuterTextFits(result,flat?targetPath:pathJson);
        pass(entry.format+' '+cellPath.length+'-level Tab traversal, last-cell row insertion and undo survive journal recovery without ancestor changes');
      }finally{result.free();}
    }finally{source.free();await page.close();}
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.warnings,[]);assert.deepEqual(report.externalRequests,[]);pass('no browser errors, warnings or external requests');
}finally{
  await writeFile('test-results/nested-browser.json',JSON.stringify(report,null,2));await browser.close();
  if(!child.killed){child.kill();await new Promise(resolve=>child.once('close',resolve));}
}
