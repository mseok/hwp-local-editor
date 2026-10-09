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
const root=await mkdtemp(path.resolve('test-results/table-split-'));
initSync({module:await readFile('.build/core/rhwp_bg.wasm')});
const blank=await readFile('.cache/rhwp/saved/blank2010.hwp');
function tableXml(rows,cols,width,label){
  const document=new HwpDocument(blank);
  try{
    document.createBlankDocument();const control=JSON.parse(document.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:0,rowCount:rows,colCount:cols,treatAsChar:true,colWidths:Array(cols).fill(width/cols)}))).controlIdx;
    for(let i=0;i<rows*cols;i++)document.insertTextInCell(0,0,control,i,0,0,label+i);
    return unzip(Buffer.from(document.exportHwpx())).get('Contents/section0.xml').toString().match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0];
  }finally{document.free();}
}
function nativeChecks(entry,p,back){
  const document=new HwpDocument(entry.bytes);
  const exportBytes=()=>Buffer.from(entry.format==='hwp'?document.exportHwp():document.exportHwpx());
  try{
    const before=exportBytes();
    const bad=structuredClone(p);bad[0].cellIndex=99;
    for(const [pathValue,row] of [['[]',1],[pathJson(bad),1],[pathJson(p),0],[pathJson(p),3],[pathJson(p),65536]])assert.throws(()=>document.splitTableByPath(0,1,pathValue,row));
    assert.throws(()=>document.mergeTableWithNextByPath(0,1,pathJson(p)));
    assert.deepEqual(exportBytes(),before,'Rejected nested split/join must not change exported bytes');
    document.mergeTableCellsByPath(0,1,pathJson(p),0,0,1,0);
    const merged=exportBytes();assert.throws(()=>document.splitTableByPath(0,1,pathJson(p),1));assert.deepEqual(exportBytes(),merged,'A spanning cell cannot be cut in half');
  }finally{document.free();}
  const divided=new HwpDocument(entry.bytes),source=new HwpDocument(entry.bytes);
  try{
    const styled=structuredClone(p);styled.at(-1).cellIndex=4;
    divided.applyCharFormatInCellByPath(0,1,pathJson(styled),0,7,JSON.stringify({bold:true,fontSize:1200}));
    divided.setTablePropertiesByPath(0,1,pathJson(p),JSON.stringify({hasCaption:true,captionDirection:2,captionSpacing:401}));
    const result=JSON.parse(divided.splitTableByPath(0,1,pathJson(p),2));assert.equal(result.backParaIdx,2);
    assert.deepEqual(JSON.parse(divided.getEventLog()).events.at(-1),{type:"TableStructureChangedByPath",section:0,para:1,cellPath:p,operation:"splitTable"});
    assert.equal(JSON.parse(divided.getTablePropertiesByPath(0,1,pathJson(p))).hasCaption,true);
    assert.equal(JSON.parse(divided.getTablePropertiesByPath(0,1,pathJson(back))).hasCaption,false);
    assert.equal(JSON.parse(divided.getCellCharPropertiesAtByPath(0,1,pathJson(back),0)).bold,true);
    const splitBytes=Buffer.from(entry.format==='hwp'?divided.exportHwp():divided.exportHwpx());
    const blocked=new HwpDocument(splitBytes);
    try{
      const container=pathJson(p.slice(0,-1).map((e,i,a)=>({...e,cellParaIndex:i===a.length-1?1:e.cellParaIndex})));
      blocked.insertTextInCellByPath(0,1,container,0,'DO NOT DROP');
      const before=Buffer.from(entry.format==='hwp'?blocked.exportHwp():blocked.exportHwpx());
      assert.throws(()=>blocked.mergeTableWithNextByPath(0,1,pathJson(p)));assert.deepEqual(Buffer.from(entry.format==='hwp'?blocked.exportHwp():blocked.exportHwpx()),before);
    }finally{blocked.free();}
    divided.mergeTableWithNextByPath(0,1,pathJson(p));
    assert.deepEqual(JSON.parse(divided.getEventLog()).events.at(-1),{type:"TableStructureChangedByPath",section:0,para:1,cellPath:p,operation:"mergeTableWithNext"});
    const reopened=new HwpDocument(entry.format==='hwp'?divided.exportHwp():divided.exportHwpx());
    try{
      unchangedAncestors(source,reopened,p);
      assert.deepEqual(JSON.parse(reopened.getTableDimensionsByPath(0,1,pathJson(p))),{rowCount:3,colCount:2,cellCount:6});
      assert.equal(JSON.parse(reopened.getTablePropertiesByPath(0,1,pathJson(p))).hasCaption,true);
      assert.equal(JSON.parse(reopened.getCellCharPropertiesAtByPath(0,1,pathJson(styled),0)).fontSize,1200);
      for(let cell=0;cell<6;cell++)assert.equal(cellText(reopened,p,cell),'INNER-'+cell);
    }finally{reopened.free();}
  }finally{divided.free();source.free();}
}
const files=[];
for(const depth of [2,3]){
  const document=new HwpDocument(blank);
  try{
    document.createBlankDocument();document.insertText(0,0,0,'BODY-UNCHANGED');document.splitParagraph(0,0,14);document.createTable(0,1,0,1,2);
    document.insertTextInCell(0,1,0,0,0,0,'OUTER-0');document.insertTextInCell(0,1,0,1,0,0,'OUTER-1');
    let inner=tableXml(3,2,12000,'INNER-');
    if(depth===3)inner=tableXml(1,1,16000,'MIDDLE-').replace('<hp:t>MIDDLE-0</hp:t>',inner+'<hp:t>MIDDLE-0</hp:t>');
    const entries=unzip(Buffer.from(document.exportHwpx()));
    entries.set('Contents/section0.xml',Buffer.from(entries.get('Contents/section0.xml').toString().replace('<hp:t>OUTER-0</hp:t>',inner+'<hp:t>OUTER-0</hp:t>')));
    const nested=new HwpDocument(zip(entries));
    try{for(const format of ['hwp','hwpx']){const file=path.join(root,`depth-${depth}.${format}`);await writeFile(file,format==='hwp'?nested.exportHwp():nested.exportHwpx());files.push(file);}}
    finally{nested.free();}
  }finally{document.free();}
}
const data=await createWorkspace(files,path.join(root,'output'));
const manifest=path.join(root,'workspace.json');await writeFile(manifest,JSON.stringify(data));
const port=18872,base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['app/server.mjs'],{env:{...process.env,PORT:String(port),DOCUMENT_MANIFEST:manifest},stdio:['ignore','pipe','pipe']});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined});
const context=await browser.newContext({viewport:{width:1280,height:1050}});
const report={root,checks:[],errors:[],warnings:[],externalRequests:[]};
context.on('page',page=>{page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(['warning','error'].includes(message.type()))report.warnings.push(message.text());});page.on('request',request=>{if(!request.url().startsWith(base+'/')&&!/^(blob|data):/.test(request.url()))report.externalRequests.push(request.url());});});
const pass=name=>{report.checks.push(name);console.log('PASS',name);};
const ready=page=>page.waitForFunction(()=>window.editorReady,null,{timeout:45000});
const save=async(page,revision)=>{await page.getByRole('button',{name:'결과 파일 저장',exact:true}).click();await page.locator(`#delivery[data-revision="${revision}"]`).waitFor();};
async function select(page,text){
  await page.getByRole('button',{name:'찾아 바꾸기',exact:true}).click();const frame=page.frameLocator('#editor iframe');
  await frame.getByRole('textbox',{name:'찾을 내용',exact:true}).fill(text);
  await frame.getByRole('button',{name:'다음 찾기',exact:true}).click();
  await frame.getByText('검색 결과 1개',{exact:true}).waitFor();
  await frame.getByRole('button',{name:'찾아 바꾸기 닫기',exact:true}).click();
}
async function command(frame,label){await frame.locator('#menu-bar').getByText('표',{exact:true}).click();await frame.getByText(label,{exact:true}).click();}
const pathJson=p=>JSON.stringify(p);
function cellText(document,p,index){const cell=structuredClone(p);cell.at(-1).cellIndex=index;return document.getTextInCellByPath(0,1,pathJson(cell),0,document.getCellParagraphLengthByPath(0,1,pathJson(cell)));}
function unchangedAncestors(source,result,p){
  const outside=value=>JSON.parse(value).replace(/\r\n/g,'').replace('FIRST>','').replace('BACK>','').replace(/INNER-[0-5]/g,'');
  assert.equal(outside(result.getTextFileUnicode()),outside(source.getTextFileUnicode()),'Text outside the edited inner table must remain unchanged');
  for(let depth=1;depth<p.length;depth++){
    const ancestor=pathJson(p.slice(0,depth));
    assert.equal(result.getTablePropertiesByPath(0,1,ancestor),source.getTablePropertiesByPath(0,1,ancestor));
    const dims=JSON.parse(source.getTableDimensionsByPath(0,1,ancestor));
    assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,1,ancestor)),dims);
    for(let cell=0;cell<dims.cellCount;cell++)assert.equal(result.getCellPropertiesByPath(0,1,ancestor,cell),source.getCellPropertiesByPath(0,1,ancestor,cell));
  }
}
function insideParent(document,p){
  const parent=JSON.parse(document.getTableCellBboxesByPath(0,1,pathJson(p.slice(0,-1))))[0];
  for(const box of JSON.parse(document.getTableCellBboxesByPath(0,1,pathJson(p))))assert.ok(box.x>=parent.x-0.2&&box.y>=parent.y-0.2&&box.x+box.w<=parent.x+parent.w+0.2&&box.y+box.h<=parent.y+parent.h+0.2,'Split/join must reflow the enclosing cell');
}
try{
  await new Promise((resolve,reject)=>{let stderr='';child.stderr.on('data',v=>stderr+=v);const timer=setTimeout(()=>reject(new Error('Server startup timeout: '+stderr)),10000);child.once('error',reject);child.once('exit',code=>reject(new Error('Server exited '+code+': '+stderr)));child.stdout.once('data',()=>{clearTimeout(timer);resolve();});});
  for(const entry of data.documents){
    const depth=Number(entry.name.match(/depth-(\d)/)[1]);
    const p=Array.from({length:depth},()=>({controlIndex:0,cellIndex:0,cellParaIndex:0}));
    const back=structuredClone(p);back.at(-2).cellParaIndex=2;
    const inputBytes=await readFile(entry.source);
    const source=new HwpDocument(inputBytes);
    const page=await context.newPage();const frame=page.frameLocator('#editor iframe');
    try{
      await page.goto(base+'/editor?id='+entry.id);await ready(page);await select(page,'INNER-4');
      await command(frame,'표 나누기');await save(page,1);
      let result=new HwpDocument(await readFile(entry.output));
      try{
        unchangedAncestors(source,result,p);
        assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,1,pathJson(p))),{rowCount:2,colCount:2,cellCount:4},'Whole-table splitting must act on the selected inner table');
        assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,1,pathJson(back))),{rowCount:1,colCount:2,cellCount:2});
        assert.equal(cellText(result,p,0),'INNER-0');assert.equal(cellText(result,back,0),'INNER-4');insideParent(result,p);insideParent(result,back);
      }finally{result.free();}
      const input=frame.getByRole('textbox',{name:'문서 편집 입력',exact:true});
      await input.pressSequentially('FIRST>');await input.press('Tab');await page.keyboard.insertText('BACK>');await save(page,2);
      result=new HwpDocument(await readFile(entry.output));
      try{assert.equal(cellText(result,back,0),'FIRST>INNER-4','Typing immediately after splitting must target the new inner table');assert.equal(cellText(result,back,1),'BACK>INNER-5','Split must place the cursor in the new inner table');assert.equal(cellText(result,p,1),'INNER-1');}
      finally{result.free();}
      await page.waitForFunction(()=>{const d=document.querySelector('#status').dataset;return Number(d.changeRevision)>0&&d.changeRevision===d.savedRevision;});
      await page.reload();await ready(page);await save(page,3);
      await page.goto(base+'/editor?id='+entry.id+'&result=1');await ready(page);await select(page,'INNER-0');
      // Esc selects the inner table object. It must not fall back to the outer table.
      await input.press('Escape');await command(frame,'표 붙이기');await save(page,4);
      result=new HwpDocument(await readFile(entry.output));
      try{
        unchangedAncestors(source,result,p);assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,1,pathJson(p))),{rowCount:3,colCount:2,cellCount:6});
        assert.equal(cellText(result,p,5),'BACK>INNER-5');assert.throws(()=>result.getTableDimensionsByPath(0,1,pathJson(back)));insideParent(result,p);
      }finally{result.free();}
      const previous=await page.locator('#status').getAttribute('data-change-revision');
      await frame.locator('#menu-bar').getByText('편집',{exact:true}).click();await frame.getByText('되돌리기',{exact:true}).click();
      await page.waitForFunction(old=>{const d=document.querySelector('#status').dataset;return Number(d.changeRevision)>Number(old)&&d.changeRevision===d.savedRevision;},previous);
      await page.reload();await ready(page);await save(page,5);
      result=new HwpDocument(await readFile(entry.output));
      try{
        unchangedAncestors(source,result,p);assert.equal(cellText(result,back,1),'BACK>INNER-5');insideParent(result,p);insideParent(result,back);
        assert.equal(digest(await readFile(entry.source)),entry.sourceSha256);
        const receipt=JSON.parse(await readFile(entry.output+'.receipt.json','utf8'));assert.equal(receipt.contentLoss.count,0);
      }finally{result.free();}
      await page.goto(base+'/editor?id='+entry.id+'&result=1');await ready(page);await select(page,'INNER-0');await command(frame,'표 붙이기');await save(page,6);
      result=new HwpDocument(await readFile(entry.output));
      try{unchangedAncestors(source,result,p);assert.equal(cellText(result,p,4),'FIRST>INNER-4');assert.equal(cellText(result,p,5),'BACK>INNER-5');insideParent(result,p);}
      finally{result.free();}
      pass(entry.format+' '+depth+'-level table split/cursor/cell and object join/undo/recovery/export preserves ancestors');
      nativeChecks({...entry,bytes:inputBytes},p,back);
      pass(entry.format+' '+depth+'-level rejected split/join preserves bytes; caption and moved-cell style survive split/join');
    }finally{source.free();await page.close();}
  }
  for(const format of ['hwp','hwpx']){
    const original=new HwpDocument(blank);
    let control,bytes;
    try{
      original.createBlankDocument();control=JSON.parse(original.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:0,rowCount:3,colCount:2,treatAsChar:true,colWidths:[6000,6000]}))).controlIdx;
      for(let cell=0;cell<6;cell++)original.insertTextInCell(0,0,control,cell,0,0,'FLAT-'+cell);
      bytes=format==='hwp'?original.exportHwp():original.exportHwpx();
    }finally{original.free();}
    const legacy=new HwpDocument(bytes),byPath=new HwpDocument(bytes);
    try{
      const p=JSON.stringify([{controlIndex:control,cellIndex:4,cellParaIndex:0}]);
      assert.equal(legacy.splitTable(0,0,control,2),byPath.splitTableByPath(0,0,p,2));
      for(const index of [0,2])assert.equal(legacy.getTableDimensions(0,index,index===0?control:0),byPath.getTableDimensions(0,index,index===0?control:0));
      assert.equal(legacy.mergeTableWithNext(0,0,control),byPath.mergeTableWithNextByPath(0,0,p));
      const exportBytes=d=>Buffer.from(format==='hwp'?d.exportHwp():d.exportHwpx());
      assert.deepEqual(exportBytes(legacy),exportBytes(byPath));
      pass(format+' flat path delegation retains legacy split/join export bytes');
    }finally{legacy.free();byPath.free();}
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.warnings,[]);assert.deepEqual(report.externalRequests,[]);pass('no browser errors, warnings or external requests');
}finally{
  await writeFile('test-results/table-split-browser.json',JSON.stringify(report,null,2));await browser.close();
  if(!child.killed){child.kill();await new Promise(resolve=>child.once('close',resolve));}
}
