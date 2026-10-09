import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspace,digest} from '../app/workspace.mjs';
import {initSync,HwpDocument} from '../.build/core/rhwp.js';
import {unzip,zip} from './zip-fixture.mjs';
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH||import.meta.url),{chromium}=require('playwright');
await mkdir('test-results',{recursive:true});const root=await mkdtemp(path.resolve('test-results/table-transpose-'));
initSync({module:await readFile('.build/core/rhwp_bg.wasm')});const blank=await readFile('.cache/rhwp/saved/blank2010.hwp'),json=JSON.stringify;
function tableXml(rows,cols,width,label){const d=new HwpDocument(blank);try{d.createBlankDocument();const r=JSON.parse(d.createTableEx(json({sectionIdx:0,paraIdx:0,charOffset:0,rowCount:rows,colCount:cols,treatAsChar:true,colWidths:Array(cols).fill(width/cols)})));for(let i=0;i<rows*cols;i++)d.insertTextInCell(0,r.paraIdx,r.controlIdx,i,0,0,label+i);return unzip(Buffer.from(d.exportHwpx())).get('Contents/section0.xml').toString().match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0];}finally{d.free();}}
const files=[];
for(const depth of [2,3]){const d=new HwpDocument(blank);try{
  d.createBlankDocument();d.insertText(0,0,0,'BODY-UNCHANGED');d.splitParagraph(0,0,14);d.createTable(0,1,0,1,2);d.insertTextInCell(0,1,0,0,0,0,'OUTER-0');d.insertTextInCell(0,1,0,1,0,0,'OUTER-1');
  let inner=tableXml(3,2,16000,'INNER-').replace('</hp:tbl>','<hp:cellzoneList><hp:cellzone startRowAddr="0" startColAddr="0" endRowAddr="1" endColAddr="0" borderFillIDRef="1"/></hp:cellzoneList></hp:tbl>');
  if(depth===3)inner=tableXml(1,1,20000,'MIDDLE-').replace('<hp:t>MIDDLE-0</hp:t>',inner+'<hp:t>MIDDLE-0</hp:t>');
  const entries=unzip(Buffer.from(d.exportHwpx()));entries.set('Contents/section0.xml',Buffer.from(entries.get('Contents/section0.xml').toString().replace('<hp:t>OUTER-0</hp:t>',inner+'<hp:t>OUTER-0</hp:t>')));
  const nested=new HwpDocument(zip(entries));try{const p=Array.from({length:depth},()=>({controlIndex:0,cellIndex:0,cellParaIndex:0}));for(let i=0;i<6;i++){const cell=p.map((e,j)=>({...e,cellIndex:j===depth-1?i:e.cellIndex}));nested.applyCharFormatInCellByPath(0,1,json(cell),0,7,json({bold:i%2===1,fontSize:1000+i*100}));nested.setCellPropertiesByPath(0,1,json(p),i,json({applyInnerMargin:true,paddingLeft:100+i*20,paddingTop:100+i*10}));}for(const format of ['hwp','hwpx'])for(const route of ['whole','range','recovered-copy','overflow']){const file=path.join(root,`depth-${depth}-${route}.${format}`);await writeFile(file,format==='hwp'?nested.exportHwp():nested.exportHwpx());files.push(file);}}finally{nested.free();}
}finally{d.free();}}
const data=await createWorkspace(files,path.join(root,'output')),manifest=path.join(root,'workspace.json');await writeFile(manifest,json(data));
const port=18875,base=`http://127.0.0.1:${port}`,child=spawn(process.execPath,['app/server.mjs'],{env:{...process.env,PORT:String(port),DOCUMENT_MANIFEST:manifest},stdio:['ignore','pipe','pipe']});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined}),context=await browser.newContext({viewport:{width:1280,height:1050}}),report={root,checks:[],errors:[],warnings:[],externalRequests:[]};
context.on('page',page=>{page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(['warning','error'].includes(m.type()))report.warnings.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(base+'/')&&!/^(blob|data):/.test(r.url()))report.externalRequests.push(r.url());});});
const pass=name=>{report.checks.push(name);console.log('PASS',name);};
const ready=p=>p.waitForFunction(()=>window.editorReady,null,{timeout:45000});
const save=async(p,revision)=>{await p.getByRole('button',{name:'결과 파일 저장',exact:true}).click();await p.locator(`#delivery[data-revision="${revision}"]`).waitFor();};
const acknowledge=p=>p.waitForFunction(()=>{const d=document.querySelector('#status').dataset,revision=localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision;return revision>0&&revision===Number(d.savedRevision);});
async function select(page,text){await page.getByRole('button',{name:'찾아 바꾸기',exact:true}).click();const f=page.frameLocator('#editor iframe');await f.getByRole('textbox',{name:'찾을 내용',exact:true}).fill(text);await f.getByRole('button',{name:'다음 찾기',exact:true}).click();await f.getByText('검색 결과 1개',{exact:true}).waitFor();await f.getByRole('button',{name:'찾아 바꾸기 닫기',exact:true}).click();}
async function command(f,label,menu='표'){await f.locator('#menu-bar').getByText(menu,{exact:true}).click();await f.locator('#menu-bar').getByText(label,{exact:true}).click();}
const cellPath=(p,cell)=>p.map((e,i)=>({...e,cellIndex:i===p.length-1?cell:e.cellIndex}));
const cellText=(d,p,cell)=>{const a=json(cellPath(p,cell));return d.getTextInCellByPath(0,1,a,0,d.getCellParagraphLengthByPath(0,1,a));};
function ancestors(source,result,p,ppi=1){for(let depth=1;depth<p.length;depth++){const a=json(p.slice(0,depth));assert.equal(result.getTablePropertiesByPath(0,ppi,a),source.getTablePropertiesByPath(0,1,a));const dims=JSON.parse(source.getTableDimensionsByPath(0,1,a));assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,ppi,a)),dims);for(let i=0;i<dims.cellCount;i++)assert.equal(result.getCellPropertiesByPath(0,ppi,a,i),source.getCellPropertiesByPath(0,1,a,i));}}
function hostTextFits(document){
  function visit(node,cell){
    if(node.type==='Cell')cell=node;
    if(node.type==='TextRun'&&node.text&&cell&&cell.children.some(child=>child.type==='Table')){
      const b=node.bbox,c=cell.bbox;
      assert(b.x>=c.x-0.2&&b.x+b.w<=c.x+c.w+0.2&&b.y>=c.y-0.2&&b.y+b.h<=c.y+c.h+0.2,'Rendered cell text must remain inside its enclosing border: '+node.text);
      for(const table of cell.children.filter(child=>child.type==='Table')){
        const t=table.bbox;
        assert(b.x+b.w<=t.x+0.2||b.x>=t.x+t.w-0.2||b.y+b.h<=t.y+0.2||b.y>=t.y+t.h-0.2,'Host text must not overlap its inline table: '+node.text);
      }
    }
    for(const child of node.children||[])visit(child,cell);
  }
  for(let page=0;page<document.pageCount();page++)visit(JSON.parse(document.getPageRenderTree(page)),null);
}
function check(source,result,p,route){
  const outer=JSON.parse(result.searchAllText('OUTER-1',false,true))[0];ancestors(source,result,p,outer.para);
  if(route==='overflow'){
    const hits=JSON.parse(result.searchAllText('INNER-0',false,true));assert.equal(hits.length,2);const hit=hits.find(item=>item.cellContext);assert(hit,'Overflow must paste a new body table');
    const q=[{controlIndex:hit.cellContext.ctrlIdx,cellIndex:0,cellParaIndex:0}];assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,hit.para,json(q))),{rowCount:2,colCount:1,cellCount:2});
    for(let i=0;i<2;i++){q[0].cellIndex=i;assert.equal(result.getTextInCellByPath(0,hit.para,json(q),0,7),'INNER-'+i);assert.equal(result.getCellCharPropertiesAtByPath(0,hit.para,json(q),0),source.getCellCharPropertiesAtByPath(0,1,json(cellPath(p,i)),0));}
    for(let i=0;i<6;i++){const a=json(cellPath(p,i));assert.equal(result.getTextInCellByPath(0,outer.para,a,0,7),'INNER-'+i);assert.equal(result.getCellPropertiesByPath(0,outer.para,json(p),i),source.getCellPropertiesByPath(0,1,json(p),i));}return;
  }
  const order=route==='whole'?[0,2,4,1,3,5]:[0,1,0,3,1,5];assert.deepEqual(JSON.parse(result.getTableDimensionsByPath(0,1,json(p))),{rowCount:route==='whole'?2:3,colCount:route==='whole'?3:2,cellCount:6});
  for(let i=0;i<6;i++){assert.equal(cellText(result,p,i),'INNER-'+order[i]);assert.equal(result.getCellCharPropertiesAtByPath(0,1,json(cellPath(p,i)),0),source.getCellCharPropertiesAtByPath(0,1,json(cellPath(p,order[i])),0));const actual=JSON.parse(result.getCellPropertiesByPath(0,1,json(p),i)),expected=JSON.parse(source.getCellPropertiesByPath(0,1,json(p),route==='whole'?order[i]:i));delete actual.width;delete expected.width;delete actual.height;delete expected.height;assert.deepEqual(actual,expected);}
  if(route==='whole'){const xml=unzip(Buffer.from(result.exportHwpx())).get('Contents/section0.xml').toString();assert.match(xml,/<hp:cellzone startRowAddr="0" startColAddr="0" endRowAddr="0" endColAddr="1" borderFillIDRef="1"\/>/,'Transpose must preserve and transpose the cell-zone range');}
  hostTextFits(result);
  for(const label of ['BODY-UNCHANGED','OUTER-0','OUTER-1',...(p.length===3?['MIDDLE-0']:[])])assert.equal(JSON.parse(result.getTextFileUnicode()).split(label).length,2);
}
function nativeChecks(entry,p){const d=new HwpDocument(entry.bytes),bytes=()=>Buffer.from(entry.format==='hwp'?d.exportHwp():d.exportHwpx());try{
  const before=bytes(),bad=structuredClone(p);bad[0].cellIndex=99;assert.equal(JSON.parse(d.getTableTransposeClipboardInfo()),null);
  for(const a of ['[]',json(bad)]){assert.throws(()=>d.copyTableCellsTransposedByPath(0,1,a,0,0,0,1));assert.throws(()=>d.transposeTableCellsInPlaceByPath(0,1,a));}
  assert.throws(()=>d.copyTableCellsTransposedByPath(0,1,json(p),0,0,65536,1));assert.deepEqual(bytes(),before);
  d.copyTableCellsTransposedByPath(0,1,json(p),0,0,0,1);assert.deepEqual(JSON.parse(d.getTableTransposeClipboardInfo()),{ok:true,sourceRows:1,sourceCols:2,targetRows:2,targetCols:1});assert.throws(()=>d.pasteTableCellsTransposedByPath(0,1,json(p),2,0));assert.deepEqual(bytes(),before);
  assert.throws(()=>d.pasteTableCellsTransposedByPath(0,1,json(p),65536,0));assert.deepEqual(bytes(),before);
  d.mergeTableCellsByPath(0,1,json(p),0,0,1,0);const merged=bytes();assert.throws(()=>d.transposeTableCellsInPlaceByPath(0,1,json(p)));assert.throws(()=>d.copyTableCellsTransposedByPath(0,1,json(p),0,0,1,0));assert.deepEqual(bytes(),merged);
}finally{d.free();}}
function flatChecks(format){const seed=new HwpDocument(blank);try{seed.createBlankDocument();const r=JSON.parse(seed.createTable(0,0,0,2,3)),p=json([{controlIndex:r.controlIdx,cellIndex:0,cellParaIndex:0}]),ppi=r.paraIdx;for(let i=0;i<6;i++)seed.insertTextInCell(0,ppi,r.controlIdx,i,0,0,'FLAT-'+i);const bytes=format==='hwp'?seed.exportHwp():seed.exportHwpx();
  for(const operation of ['whole','range']){const legacy=new HwpDocument(bytes),full=new HwpDocument(bytes);try{const ci=JSON.parse(p)[0].controlIndex;legacy.copyTableCellsTransposed(0,ppi,ci,0,0,0,1);full.copyTableCellsTransposedByPath(0,ppi,p,0,0,0,1);if(operation==='whole'){legacy.transposeTableCellsInPlace(0,ppi,ci);full.transposeTableCellsInPlaceByPath(0,ppi,p);}else{legacy.pasteTableCellsTransposed(0,ppi,ci,0,2);full.pasteTableCellsTransposedByPath(0,ppi,p,0,2);}assert.deepEqual(Buffer.from(format==='hwp'?full.exportHwp():full.exportHwpx()),Buffer.from(format==='hwp'?legacy.exportHwp():legacy.exportHwpx()));}finally{legacy.free();full.free();}}
}finally{seed.free();}}
try{for(const entry of data.documents){const depth=Number(entry.name.match(/depth-(\d)/)[1]),route=entry.name.match(/depth-\d-(.*)\./)[1],p=Array.from({length:depth},()=>({controlIndex:0,cellIndex:0,cellParaIndex:0}));const inputBytes=await readFile(entry.source),source=new HwpDocument(inputBytes),page=await context.newPage(),frame=page.frameLocator('#editor iframe');
  try{
    await page.goto(base+'/editor?id='+entry.id);await ready(page);await select(page,'INNER-0');const input=frame.getByRole('textbox',{name:'문서 편집 입력',exact:true});await input.press('F5');await input.press('F5');await input.press(route==='whole'?'F5':'ArrowRight');await command(frame,'행/열 바꿈 복사');
    assert.equal((await page.evaluate(()=>localStudio.commands.context())).hasTableTransposeClipboard,true,'The selected nested table must populate the transpose clipboard');
    if(route==='whole'){await acknowledge(page);const guard=await page.evaluate(()=>{const saved=Number(document.querySelector('#status').dataset.savedRevision);const result=localStudio.element.contentWindow.rhwpStudio.automation.execute('table:transpose-copy');const revision=localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision;const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return {ok:result.ok,saved,revision,prevented:event.defaultPrevented};});assert.equal(guard.ok,true);assert(guard.revision>guard.saved);assert.equal(guard.prevented,true,'Unacknowledged native edits must block unload before the queued host message');}
    if(route==='recovered-copy'){await acknowledge(page);await page.reload();await ready(page);}
    if(route!=='whole')await select(page,route==='overflow'?'INNER-4':'INNER-2');await command(frame,'행/열 바꿈 붙여넣기');await save(page,1);
    let result=new HwpDocument(await readFile(entry.output));try{check(source,result,p,route);}finally{result.free();}
    if(route!=='overflow'){await input.pressSequentially('X>');await save(page,2);result=new HwpDocument(await readFile(entry.output));try{assert.equal(cellText(result,p,route==='whole'?0:2),'X>INNER-0');ancestors(source,result,p);}finally{result.free();}await command(frame,'되돌리기','편집');await command(frame,'되돌리기','편집');await save(page,3);result=new HwpDocument(await readFile(entry.output));try{assert.equal(result.getTextFileUnicode(),source.getTextFileUnicode());ancestors(source,result,p);}finally{result.free();}await command(frame,'다시 실행','편집');}
    if(route!=='overflow'){await save(page,4);result=new HwpDocument(await readFile(entry.output));try{check(source,result,p,route);}finally{result.free();}}
    await acknowledge(page);await page.reload();await ready(page);await save(page,route==='overflow'?2:5);await page.goto(base+'/editor?id='+entry.id+'&result=1');await ready(page);result=new HwpDocument(await readFile(entry.output));try{check(source,result,p,route);assert.equal(digest(await readFile(entry.source)),entry.sourceSha256);assert.equal(JSON.parse(await readFile(entry.output+'.receipt.json')).contentLoss.count,0);}finally{result.free();}
    pass(entry.format+' '+depth+'-level '+route+' transpose/typing/undo/recovery/save preserves content and scope');
    if(route==='whole'){nativeChecks({...entry,bytes:inputBytes},p);pass(entry.format+' '+depth+'-level native rejected transpose preserves bytes');}
  }finally{source.free();await page.close();}
}for(const format of ['hwp','hwpx']){flatChecks(format);pass(format+' one-level full-path transpose preserves legacy export bytes');}assert.deepEqual(report.errors,[]);assert.deepEqual(report.warnings,[]);assert.deepEqual(report.externalRequests,[]);pass('no browser errors, warnings or external requests');
}finally{await writeFile('test-results/table-transpose-browser.json',json(report,null,2));await browser.close();if(!child.killed){child.kill();await new Promise(resolve=>child.once('close',resolve));}}
