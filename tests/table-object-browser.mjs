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
const root=await mkdtemp(path.resolve('test-results/table-object-'));
initSync({module:await readFile('.build/core/rhwp_bg.wasm')});
const blank=await readFile('.cache/rhwp/saved/blank2010.hwp');
function tableXml(rows,cols,width,label){
  const document=new HwpDocument(blank);
  try{
    document.createBlankDocument();const ci=JSON.parse(document.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:0,rowCount:rows,colCount:cols,treatAsChar:true,colWidths:Array(cols).fill(width/cols)}))).controlIdx;
    for(let cell=0;cell<rows*cols;cell++)document.insertTextInCell(0,0,ci,cell,0,0,label+cell);
    return unzip(Buffer.from(document.exportHwpx())).get('Contents/section0.xml').toString().match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0];
  }finally{document.free();}
}
const files=[];
for(const depth of [2,3]){
  const document=new HwpDocument(blank);
  try{
    document.createBlankDocument();document.insertText(0,0,0,'BODY-UNCHANGED');document.splitParagraph(0,0,14);document.createTable(0,1,0,1,2);
    document.insertTextInCell(0,1,0,0,0,0,'OUTER-0');document.insertTextInCell(0,1,0,1,0,0,'OUTER-1');
    let inner=tableXml(3,2,12000,'INNER-');
    if(depth===3)inner=tableXml(1,1,16000,'MIDDLE-').replace('<hp:t>MIDDLE-0</hp:t>',inner+'<hp:t>MIDDLE-0</hp:t>');
    const entries=unzip(Buffer.from(document.exportHwpx()));entries.set('Contents/section0.xml',Buffer.from(entries.get('Contents/section0.xml').toString().replace('<hp:t>OUTER-0</hp:t>',inner+'<hp:t>OUTER-0</hp:t>')));
    const nested=new HwpDocument(zip(entries));
    try{for(const format of ['hwp','hwpx'])for(const route of ['keyboard','cell-menu','object-menu']){const file=path.join(root,`depth-${depth}-${route}.${format}`);await writeFile(file,format==='hwp'?nested.exportHwp():nested.exportHwpx());files.push(file);}}
    finally{nested.free();}
  }finally{document.free();}
}
for(const format of ['hwp','hwpx'])for(const route of ['keyboard','cell-menu']){
  const document=new HwpDocument(blank);
  try{
    document.createBlankDocument();document.insertText(0,0,0,'BEFORE-FLAT');document.splitParagraph(0,0,11);document.splitParagraph(0,1,0);document.insertText(0,2,0,'AFTER-FLAT');
    document.createTable(0,1,0,1,1);document.insertTextInCell(0,1,0,0,0,0,'FLAT-CELL');
    const file=path.join(root,`flat-${route}.${format}`);await writeFile(file,format==='hwp'?document.exportHwp():document.exportHwpx());files.unshift(file);
  }finally{document.free();}
}
const data=await createWorkspace(files,path.join(root,'output'));
const manifest=path.join(root,'workspace.json');await writeFile(manifest,JSON.stringify(data));
const port=18873,base=`http://127.0.0.1:${port}`;
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
  await frame.getByRole('textbox',{name:'찾을 내용',exact:true}).fill(text);await frame.getByRole('button',{name:'다음 찾기',exact:true}).click();
  await frame.getByText('검색 결과 1개',{exact:true}).waitFor();await frame.getByRole('button',{name:'찾아 바꾸기 닫기',exact:true}).click();
}
async function command(frame,menu,label){await frame.locator('#menu-bar').getByText(menu,{exact:true}).click();await frame.getByText(label,{exact:true}).click();}
const pathJson=p=>JSON.stringify(p);
const clean=text=>JSON.parse(text).replace(/\r\n/g,'');
function unchangedAncestors(source,result,p){
  for(let depth=1;depth<p.length;depth++){
    const ancestor=pathJson(p.slice(0,depth));assert.equal(result.getTablePropertiesByPath(0,1,ancestor),source.getTablePropertiesByPath(0,1,ancestor));
    const dims=JSON.parse(source.getTableDimensionsByPath(0,1,ancestor));assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,1,ancestor)),dims);
    for(let cell=0;cell<dims.cellCount;cell++)assert.equal(result.getCellPropertiesByPath(0,1,ancestor,cell),source.getCellPropertiesByPath(0,1,ancestor,cell));
  }
}
function deletion(source,result,p,prefix=''){
  unchangedAncestors(source,result,p);
  assert.throws(()=>result.getTableDimensionsByPath(0,1,pathJson(p)),'Only the selected inner table must be removed');
  assert.equal(clean(result.getTextFileUnicode()).replace(prefix,''),clean(source.getTextFileUnicode()).replace(/INNER-[0-5]/g,''));
  const host=pathJson(p.slice(0,-1));const text=result.getTextInCellByPath(0,1,host,0,result.getCellParagraphLengthByPath(0,1,host));
  assert.equal(text,prefix+(p.length===2?'OUTER-0':'MIDDLE-0'),'Post-delete typing must stay in the enclosing cell');
}
function nativeChecks(entry,p){
  const document=new HwpDocument(entry.bytes);const host=p.slice(0,-1);const output=()=>Buffer.from(entry.format==='hwp'?document.exportHwp():document.exportHwpx());
  try{
    const before=output(),bad=structuredClone(host);bad[0].cellIndex=99;
    for(const [address,ci] of [[[],0],[bad,0],[host,99],[host,65536]])assert.throws(()=>document.deleteCellTableControlByPath(0,1,pathJson(address),ci));
    assert.deepEqual(output(),before,'Rejected deletion must preserve export bytes');
    document.deleteCellTableControlByPath(0,1,pathJson(host),0);
    const source=new HwpDocument(entry.bytes),result=new HwpDocument(output());
    try{deletion(source,result,p);assert.deepEqual(JSON.parse(document.getEventLog()).events.at(-1),{type:'CellTableDeleted',section:0,para:1,cellPath:host,innerControlIndex:0});}
    finally{source.free();result.free();}
  }finally{document.free();}
}
try{
  await new Promise((resolve,reject)=>{let stderr='';child.stderr.on('data',v=>stderr+=v);const timer=setTimeout(()=>reject(new Error('Server startup timeout: '+stderr)),10000);child.once('error',reject);child.once('exit',code=>reject(new Error('Server exited '+code+': '+stderr)));child.stdout.once('data',()=>{clearTimeout(timer);resolve();});});
  for(const entry of data.documents){
    if(entry.name.startsWith('flat-')){
      const page=await context.newPage(),frame=page.frameLocator('#editor iframe');
      try{
        await page.goto(base+'/editor?id='+entry.id);await ready(page);await select(page,'FLAT-CELL');
        const input=frame.getByRole('textbox',{name:'문서 편집 입력',exact:true}),object=entry.name.includes('keyboard');
        if(object){await input.press('Escape');await input.press('Delete');}else await command(frame,'표','표 지우기');
        await input.pressSequentially('FLAT>');await save(page,1);
        const result=new HwpDocument(await readFile(entry.output));
        try{
          assert.throws(()=>result.getTableDimensions(0,1,0));assert.equal(result.getTextRange(0,0,0,result.getParagraphLength(0,0)),'BEFORE-FLAT');
          assert.equal(result.getTextRange(0,object?2:1,0,result.getParagraphLength(0,object?2:1)),'FLAT>','Flat deletion must retain its existing cursor destination');
          assert.equal(result.getTextRange(0,3,0,result.getParagraphLength(0,3)),'AFTER-FLAT');
          assert.equal(digest(await readFile(entry.source)),entry.sourceSha256);
        }finally{result.free();}
        pass(entry.format+' flat '+(object?'keyboard':'cell-menu')+' deletion retains legacy cursor destination');
      }finally{await page.close();}
      continue;
    }
    const depth=Number(entry.name.match(/depth-(\d)/)[1]),route=entry.name.match(/depth-\d-(.*)\./)[1];
    const p=Array.from({length:depth},()=>({controlIndex:0,cellIndex:0,cellParaIndex:0}));
    const inputBytes=await readFile(entry.source),source=new HwpDocument(inputBytes);const page=await context.newPage();const frame=page.frameLocator('#editor iframe');
    try{
      await page.goto(base+'/editor?id='+entry.id);await ready(page);await select(page,'INNER-4');
      const input=frame.getByRole('textbox',{name:'문서 편집 입력',exact:true});
      if(route!=='cell-menu')await input.press('Escape');
      if(route==='keyboard')await input.press('Delete');else await command(frame,'표','표 지우기');
      await save(page,1);let result=new HwpDocument(await readFile(entry.output));
      try{deletion(source,result,p);}finally{result.free();}
      await input.pressSequentially('HOST>');await save(page,2);result=new HwpDocument(await readFile(entry.output));
      try{deletion(source,result,p,'HOST>');}finally{result.free();}
      await command(frame,'편집','되돌리기');await command(frame,'편집','되돌리기');await save(page,3);
      result=new HwpDocument(await readFile(entry.output));
      try{unchangedAncestors(source,result,p);assert.equal(result.getTextFileUnicode(),source.getTextFileUnicode());assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,1,pathJson(p))),{rowCount:3,colCount:2,cellCount:6});}finally{result.free();}
      await select(page,'INNER-4');if(route!=='cell-menu')await input.press('Escape');
      if(route==='keyboard')await input.press('Backspace');else await command(frame,'표','표 지우기');
      await page.waitForFunction(()=>{const d=document.querySelector('#status').dataset;return Number(d.changeRevision)>0&&d.changeRevision===d.savedRevision;});
      await page.reload();await ready(page);await save(page,4);await page.goto(base+'/editor?id='+entry.id+'&result=1');await ready(page);
      result=new HwpDocument(await readFile(entry.output));
      try{deletion(source,result,p);assert.equal(digest(await readFile(entry.source)),entry.sourceSha256);const receipt=JSON.parse(await readFile(entry.output+'.receipt.json','utf8'));assert.equal(receipt.contentLoss.count,0);}finally{result.free();}
      pass(entry.format+' '+depth+'-level '+route+' delete/type/undo/recovery/export preserves ancestors');
      if(route==='keyboard'){nativeChecks({...entry,bytes:inputBytes},p);pass(entry.format+' '+depth+'-level native deletion validates path and preserves rejected bytes');}
    }finally{source.free();await page.close();}
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.warnings,[]);assert.deepEqual(report.externalRequests,[]);pass('no browser errors, warnings or external requests');
}finally{
  await writeFile('test-results/table-object-browser.json',JSON.stringify(report,null,2));await browser.close();if(!child.killed){child.kill();await new Promise(resolve=>child.once('close',resolve));}
}
