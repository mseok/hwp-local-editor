import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspace,digest} from '../app/workspace.mjs';
import {initSync,HwpDocument} from '../.build/core/rhwp.js';
import {unzip,zip} from './zip-fixture.mjs';
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH||import.meta.url),{chromium}=require('playwright');
await mkdir('test-results',{recursive:true});const root=await mkdtemp(path.resolve('test-results/table-move-'));
initSync({module:await readFile('.build/core/rhwp_bg.wasm')});const blank=await readFile('.cache/rhwp/saved/blank2010.hwp');
const json=JSON.stringify;
function tableXml(rows,cols,width,label){const d=new HwpDocument(blank);try{d.createBlankDocument();const ci=JSON.parse(d.createTableEx(json({sectionIdx:0,paraIdx:0,charOffset:0,rowCount:rows,colCount:cols,treatAsChar:true,colWidths:Array(cols).fill(width/cols)}))).controlIdx;for(let cell=0;cell<rows*cols;cell++)d.insertTextInCell(0,0,ci,cell,0,0,label+cell);return unzip(Buffer.from(d.exportHwpx())).get('Contents/section0.xml').toString().match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0];}finally{d.free();}}
const files=[];
for(const depth of [2,3]){const d=new HwpDocument(blank);try{
 d.createBlankDocument();d.insertText(0,0,0,'BODY-UNCHANGED');d.splitParagraph(0,0,14);d.createTable(0,1,0,1,2);d.insertTextInCell(0,1,0,0,0,0,'OUTER-0');d.insertTextInCell(0,1,0,1,0,0,'OUTER-1');
 let inner=tableXml(1,2,12000,'INNER-');if(depth===3)inner=tableXml(1,1,16000,'MIDDLE-').replace('<hp:t>MIDDLE-0</hp:t>',inner+'<hp:t>MIDDLE-0</hp:t>');const entries=unzip(Buffer.from(d.exportHwpx()));entries.set('Contents/section0.xml',Buffer.from(entries.get('Contents/section0.xml').toString().replace('<hp:t>OUTER-0</hp:t>',inner+'<hp:t>OUTER-0</hp:t>')));
 const nested=new HwpDocument(zip(entries));try{const p=Array.from({length:depth},()=>({controlIndex:0,cellIndex:0,cellParaIndex:0}));nested.setTablePropertiesByPath(0,1,json(p),json({treatAsChar:false,vertRelTo:'Para',horzRelTo:'Para',vertOffset:2000,horzOffset:300}));for(let level=1;level<depth;level++)nested.setCellPropertiesByPath(0,1,json(p.slice(0,level)),0,json({applyInnerMargin:true,paddingBottom:8000}));for(const format of ['hwp','hwpx']){const f=path.join(root,`depth-${depth}.${format}`);await writeFile(f,format==='hwp'?nested.exportHwp():nested.exportHwpx());files.push(f);}}finally{nested.free();}
}finally{d.free();}}
for(const file of [...files]){
 const depth=Number(path.basename(file).match(/depth-(\d)/)[1]),format=path.extname(file).slice(1),document=new HwpDocument(await readFile(file));
 try{
  const p=Array.from({length:depth},()=>({controlIndex:0,cellIndex:0,cellParaIndex:0}));
  document.setTablePropertiesByPath(0,1,json(p),json({treatAsChar:true,vertOffset:0}));
  const entries=unzip(Buffer.from(document.exportHwpx())),xml=entries.get('Contents/section0.xml').toString();
  const after=tableXml(1,1,10000,'AFTER-INNER').match(/<hp:subList\b[^>]*>(<hp:p\b[\s\S]*?<\/hp:p>)/)[1].replace('AFTER-INNER0','AFTER-INNER');
  const label=depth===2?'OUTER-0':'MIDDLE-0',end=xml.indexOf('</hp:p>',xml.indexOf('<hp:t>'+label+'</hp:t>'))+'</hp:p>'.length;
  entries.set('Contents/section0.xml',Buffer.from(xml.slice(0,end)+after+xml.slice(end)));
  const prepared=new HwpDocument(zip(entries));try{const inline=file.replace('.'+format,'-inline.'+format);await writeFile(inline,exported(prepared,format));files.push(inline);}finally{prepared.free();}
 }finally{document.free();}
}
const data=await createWorkspace(files,path.join(root,'output')),manifest=path.join(root,'workspace.json');await writeFile(manifest,json(data));
const port=18874,base=`http://127.0.0.1:${port}`,child=spawn(process.execPath,['app/server.mjs'],{env:{...process.env,PORT:String(port),DOCUMENT_MANIFEST:manifest},stdio:['ignore','pipe','pipe']});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined}),context=await browser.newContext({viewport:{width:1280,height:1050}}),report={root,checks:[],errors:[],warnings:[],externalRequests:[]};
context.on('page',page=>{page.on('pageerror',error=>report.errors.push(error.message));page.on('console',m=>{if(['warning','error'].includes(m.type()))report.warnings.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(base+'/')&&!/^(blob|data):/.test(r.url()))report.externalRequests.push(r.url());});});
const pass=name=>{report.checks.push(name);console.log('PASS',name);},ready=page=>page.waitForFunction(()=>window.editorReady,null,{timeout:45000}),save=async(page,n)=>{await page.getByRole('button',{name:'결과 파일 저장',exact:true}).click();await page.locator(`#delivery[data-revision="${n}"]`).waitFor();};
async function select(page,text='INNER-1',object=true){await page.getByRole('button',{name:'찾아 바꾸기',exact:true}).click();const f=page.frameLocator('#editor iframe');await f.getByRole('textbox',{name:'찾을 내용',exact:true}).fill(text);await f.getByRole('button',{name:'다음 찾기',exact:true}).click();await f.getByRole('button',{name:'찾아 바꾸기 닫기',exact:true}).click();if(object)await f.getByRole('textbox',{name:'문서 편집 입력',exact:true}).press('Escape');}
async function menu(frame,label){await frame.locator('#menu-bar').getByText('편집',{exact:true}).click();await frame.getByText(label,{exact:true}).click();}
function ancestors(a,b,p){assert.equal(b.getTextFileUnicode(),a.getTextFileUnicode());for(let level=1;level<p.length;level++){const address=json(p.slice(0,level));assert.equal(b.getTablePropertiesByPath(0,1,address),a.getTablePropertiesByPath(0,1,address),'Moving an inner table must not move the outer table');const dims=JSON.parse(a.getTableDimensionsByPath(0,1,address));for(let i=0;i<dims.cellCount;i++)assert.equal(b.getCellPropertiesByPath(0,1,address,i),a.getCellPropertiesByPath(0,1,address,i));}}
function changed(a,b,p,h,v){ancestors(a,b,p);const before=JSON.parse(a.getTablePropertiesByPath(0,1,json(p))),after=JSON.parse(b.getTablePropertiesByPath(0,1,json(p)));assert.deepEqual(after,{...before,horzOffset:before.horzOffset+h,vertOffset:before.vertOffset+v});const dims=JSON.parse(a.getTableDimensionsByPath(0,1,json(p)));for(let i=0;i<dims.cellCount;i++)assert.equal(b.getCellPropertiesByPath(0,1,json(p),i),a.getCellPropertiesByPath(0,1,json(p),i));}
function unchangedGeometry(a,b,p){for(let level=1;level<p.length;level++)assert.deepEqual(JSON.parse(b.getTableCellBboxesByPath(0,1,json(p.slice(0,level)))),JSON.parse(a.getTableCellBboxesByPath(0,1,json(p.slice(0,level)))),'Horizontal top/bottom movement must retain enclosing cell geometry');}
function exported(document,format){return Buffer.from(format==='hwp'?document.exportHwp():document.exportHwpx());}
function nativeChecks(bytes,format,p){
 const document=new HwpDocument(bytes),source=new HwpDocument(bytes);
 try{
  const before=exported(document,format),bad=structuredClone(p);bad[0].cellIndex=99;
  const wrongControl=structuredClone(p);wrongControl.at(-1).controlIndex=99;
  for(const address of [[],bad,wrongControl])assert.throws(()=>document.moveTableOffsetByPath(0,1,json(address),1,1));
  assert.throws(()=>document.moveTableOffsetByPath(99,1,json(p),1,1));
  assert.throws(()=>document.moveTableOffsetByPath(0,99,json(p),1,1));
  assert.throws(()=>document.moveTableOffsetByPath(0,1,'not JSON',1,1));
  assert.deepEqual(exported(document,format),before,'Rejected moves must preserve bytes');
  const result=JSON.parse(document.moveTableOffsetByPath(0,1,json(p),850,600));
  assert.deepEqual(result,{ok:true,ppi:1,ci:0,cellPath:p});changed(source,document,p,850,600);
  assert.deepEqual(JSON.parse(document.getEventLog()).events.at(-1),{type:'TableStructureChangedByPath',section:0,para:1,cellPath:p,operation:'moveTable'});
  const reopened=new HwpDocument(exported(document,format));try{changed(source,reopened,p,850,600);assert.equal(document.getPageRenderTree(0),reopened.getPageRenderTree(0),'Live table geometry must agree with the saved and reopened document');unchangedGeometry(source,document,p);}finally{reopened.free();}
  document.moveTableOffsetByPath(0,1,json(p),-850,-600);changed(source,document,p,0,0);unchangedGeometry(source,document,p);
  pass(format+' '+p.length+'-level native move/reject/event/export/inverse');
  document.insertText(0,0,0,'FLOW-GROWTH '.repeat(60));
  const grown=JSON.parse(document.getTableCellBboxesByPath(0,1,json(p.slice(0,1))))[0],original=JSON.parse(source.getTableCellBboxesByPath(0,1,json(p.slice(0,1))))[0];
  assert(grown.y>original.y,'Growing preceding text must advance the table instead of reusing its old source anchor');assert.equal(grown.h,original.h);
  const grownReopened=new HwpDocument(exported(document,format));try{assert.equal(document.getPageRenderTree(0),grownReopened.getPageRenderTree(0),'Reflowed preceding text must retain its current flow after reopening');}finally{grownReopened.free();}
  pass(format+' '+p.length+'-level preceding-text growth invalidates stale anchor');
 }finally{document.free();source.free();}
 const legacy=new HwpDocument(bytes),delegated=new HwpDocument(bytes);
 try{
  assert.equal(delegated.moveTableOffsetByPath(0,1,json(p.slice(0,1)),850,600),legacy.moveTableOffset(0,1,0,850,600));
  assert.deepEqual(exported(delegated,format),exported(legacy,format),'Flat delegation retains byte-identical legacy behavior');
  const reopened=new HwpDocument(exported(delegated,format));try{assert.equal(delegated.getPageRenderTree(0),reopened.getPageRenderTree(0),'Root-table preview must agree with saved geometry');}finally{reopened.free();}
  pass(format+' '+p.length+'-level flat delegation byte parity');
 }finally{legacy.free();delegated.free();}
}
function inlineChecks(bytes,format,p){
 const document=new HwpDocument(bytes),source=new HwpDocument(bytes);
 try{
  const down=JSON.parse(document.moveTableOffsetByPath(0,1,json(p),0,100000));
  assert.equal(down.cellPath.at(-2).cellParaIndex,1);
  assert.equal(JSON.parse(document.searchAllText('INNER-1',false,true))[0].cellPath.at(-2).cellParaIndex,1);
  const up=JSON.parse(document.moveTableOffsetByPath(0,1,json(down.cellPath),0,-100000));
  assert.deepEqual(up.cellPath,p);changed(source,document,p,0,0);
  const reopened=new HwpDocument(exported(document,format));try{changed(source,reopened,p,0,0);}finally{reopened.free();}
  pass(format+' '+p.length+'-level inline paragraph crossing/inverse/export');
 }finally{document.free();source.free();}
}
try{
 await new Promise((resolve,reject)=>{let stderr='';child.stderr.on('data',v=>stderr+=v);const t=setTimeout(()=>reject(Error('Server startup timeout '+stderr)),10000);child.once('error',reject);child.once('exit',c=>reject(Error('Server exit '+c+': '+stderr)));child.stdout.once('data',()=>{clearTimeout(t);resolve();});});
 for(const entry of data.documents){const depth=Number(entry.name.match(/depth-(\d)/)[1]),p=Array.from({length:depth},()=>({controlIndex:0,cellIndex:0,cellParaIndex:0})),bytes=await readFile(entry.source),source=new HwpDocument(bytes),page=await context.newPage(),frame=page.frameLocator('#editor iframe');
  if(entry.name.includes('-inline')){
   try{
    inlineChecks(bytes,entry.format,p);await page.goto(base+'/editor?id='+entry.id);await ready(page);await select(page);
    const input=frame.getByRole('textbox',{name:'문서 편집 입력',exact:true});for(let i=0;i<3;i++)await input.press('ArrowDown');await save(page,1);
    let result=new HwpDocument(await readFile(entry.output));try{assert.equal(JSON.parse(result.searchAllText('INNER-1',false,true))[0].cellPath.at(-2).cellParaIndex,1);assert.equal(result.getTextRange(0,0,0,14),'BODY-UNCHANGED');}finally{result.free();}
    await menu(frame,'되돌리기');await save(page,2);result=new HwpDocument(await readFile(entry.output));try{changed(source,result,p,0,0);}finally{result.free();}
    const previous=await page.locator('#status').getAttribute('data-change-revision');await menu(frame,'다시 실행');await page.waitForFunction(old=>{const d=document.querySelector('#status').dataset;return Number(d.changeRevision)>Number(old)&&d.changeRevision===d.savedRevision;},previous);
    await page.reload();await ready(page);await save(page,3);await page.goto(base+'/editor?id='+entry.id+'&result=1');await ready(page);
    result=new HwpDocument(await readFile(entry.output));try{const hit=JSON.parse(result.searchAllText('INNER-1',false,true))[0];assert.equal(hit.cellPath.at(-2).cellParaIndex,1);const properties=JSON.parse(result.getTablePropertiesByPath(0,1,json(hit.cellPath)));assert(properties.vertOffset>=0&&properties.vertOffset<850);}finally{result.free();}
    await select(page,'INNER-1',false);await input.press('End');await input.pressSequentially('|REOPENED>');await save(page,4);
    result=new HwpDocument(await readFile(entry.output));try{const text=JSON.parse(result.getTextFileUnicode());assert(text.includes('INNER-1|REOPENED>'));for(const label of ['BODY-UNCHANGED','AFTER-INNER','OUTER-0','OUTER-1'])assert(text.includes(label));assert.equal(digest(await readFile(entry.source)),entry.sourceSha256);assert.equal(JSON.parse(await readFile(entry.output+'.receipt.json')).contentLoss.count,0);}finally{result.free();}
    await menu(frame,'되돌리기');await save(page,5);result=new HwpDocument(await readFile(entry.output));try{assert(!JSON.parse(result.getTextFileUnicode()).includes('REOPENED>'));assert.equal(JSON.parse(result.searchAllText('INNER-1',false,true))[0].cellPath.at(-2).cellParaIndex,1);}finally{result.free();}
    pass(entry.format+' '+depth+'-level inline arrow merge/undo/redo/recovery/reopen/typing');
   }finally{source.free();await page.close();}
   continue;
  }
  nativeChecks(bytes,entry.format,p);
  try{await page.goto(base+'/editor?id='+entry.id);await ready(page);await select(page);await frame.getByRole('textbox',{name:'문서 편집 입력',exact:true}).press('ArrowRight');await save(page,1);let result=new HwpDocument(await readFile(entry.output));try{changed(source,result,p,850,0);unchangedGeometry(source,result,p);}finally{result.free();}
   await menu(frame,'되돌리기');await save(page,2);result=new HwpDocument(await readFile(entry.output));try{changed(source,result,p,0,0);unchangedGeometry(source,result,p);}finally{result.free();}
   let previous=await page.locator('#status').getAttribute('data-change-revision');await menu(frame,'다시 실행');await page.waitForFunction(old=>{const d=document.querySelector('#status').dataset;return Number(d.changeRevision)>Number(old)&&d.changeRevision===d.savedRevision;},previous);const liveSvg=await page.evaluate(()=>window.localStudio.getPageSvg(0));await page.reload();await ready(page);await save(page,3);await page.goto(base+'/editor?id='+entry.id+'&result=1');await ready(page);assert.equal(await page.evaluate(()=>window.localStudio.getPageSvg(0)),liveSvg,'Visible editing preview and reopened saved preview must agree');pass(entry.format+' '+depth+'-level browser live/save/reopen preview parity');await select(page);
   result=new HwpDocument(await readFile(entry.output));let box;try{changed(source,result,p,850,0);box=JSON.parse(result.getTableCellBboxesByPath(0,1,json(p)))[1];}finally{result.free();}
   const canvas=frame.locator('.document-page-canvas').first();await canvas.scrollIntoViewIfNeeded();const bounds=await canvas.boundingBox(),point={x:bounds.x+box.x+box.w/2,y:bounds.y+box.y+box.h/2};await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+8,point.y+8,{steps:4});await page.mouse.up();await save(page,4);
   result=new HwpDocument(await readFile(entry.output));let props;try{ancestors(source,result,p);props=JSON.parse(result.getTablePropertiesByPath(0,1,json(p)));assert.equal(props.horzOffset,300+850+600);assert.equal(props.vertOffset,2000+600);}finally{result.free();}
   await menu(frame,'되돌리기');await save(page,5);result=new HwpDocument(await readFile(entry.output));try{changed(source,result,p,850,0);unchangedGeometry(source,result,p);}finally{result.free();}
   previous=await page.locator('#status').getAttribute('data-change-revision');await menu(frame,'다시 실행');await page.waitForFunction(old=>{const d=document.querySelector('#status').dataset;return Number(d.changeRevision)>Number(old)&&d.changeRevision===d.savedRevision;},previous);await page.reload();await ready(page);await save(page,6);await page.goto(base+'/editor?id='+entry.id+'&result=1');await ready(page);result=new HwpDocument(await readFile(entry.output));try{changed(source,result,p,1450,600);assert.equal(digest(await readFile(entry.source)),entry.sourceSha256);assert.equal(JSON.parse(await readFile(entry.output+'.receipt.json')).contentLoss.count,0);}finally{result.free();}
   pass(entry.format+' '+depth+'-level inner-table arrow/drag/undo/redo/recovery/export preserves ancestors');
   await select(page,'OUTER-1');const input=frame.getByRole('textbox',{name:'문서 편집 입력',exact:true});await input.press('ArrowRight');await input.press('ArrowRight');await save(page,7);
   result=new HwpDocument(await readFile(entry.output));try{assert.equal(JSON.parse(result.getTablePropertiesByPath(0,1,json(p.slice(0,1)))).horzOffset,1700);assert.equal(JSON.parse(result.getTablePropertiesByPath(0,1,json(p))).horzOffset,1750);}finally{result.free();}
   await menu(frame,'되돌리기');await save(page,8);result=new HwpDocument(await readFile(entry.output));try{changed(source,result,p,1450,600);}finally{result.free();}
   pass(entry.format+' '+depth+'-level root arrow coalescing remains reversible');
   await select(page,'OUTER-1');result=new HwpDocument(await readFile(entry.output));try{box=JSON.parse(result.getTableCellBboxesByPath(0,1,json(p.slice(0,1)))).at(-1);}finally{result.free();}
   await canvas.scrollIntoViewIfNeeded();const outerBounds=await canvas.boundingBox(),outerPoint={x:outerBounds.x+box.x+box.w/2,y:outerBounds.y+box.y+box.h/2};await page.mouse.move(outerPoint.x,outerPoint.y);await page.mouse.down();await page.mouse.move(outerPoint.x+8,outerPoint.y+8,{steps:4});await page.mouse.up();await save(page,9);
   result=new HwpDocument(await readFile(entry.output));try{const outer=JSON.parse(result.getTablePropertiesByPath(0,1,json(p.slice(0,1))));assert.equal(outer.horzOffset,600);assert.equal(outer.vertOffset,600);assert.equal(JSON.parse(result.getTablePropertiesByPath(0,1,json(p))).horzOffset,1750);}finally{result.free();}
   await menu(frame,'되돌리기');await save(page,10);result=new HwpDocument(await readFile(entry.output));try{changed(source,result,p,1450,600);}finally{result.free();}
   pass(entry.format+' '+depth+'-level root drag/undo retains inner properties');
  }finally{source.free();await page.close();}
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.warnings,[]);assert.deepEqual(report.externalRequests,[]);pass('no browser errors, warnings or external requests');
}finally{await writeFile('test-results/table-move-browser.json',json(report,null,2));await browser.close();if(!child.killed){child.kill();await new Promise(resolve=>child.once('close',resolve));}}
