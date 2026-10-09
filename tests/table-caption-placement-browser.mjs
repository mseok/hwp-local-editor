import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspace,digest} from '../app/workspace.mjs';
import {initSync,HwpDocument} from '../.build/core/rhwp.js';
import {unzip,zip} from './zip-fixture.mjs';

const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH||import.meta.url),{chromium}=require('playwright'),json=JSON.stringify;
await mkdir('test-results',{recursive:true});
const root=await mkdtemp(path.resolve('test-results/caption-placement-'));
initSync({module:await readFile('.build/core/rhwp_bg.wasm')});
const blank=await readFile('.cache/rhwp/saved/blank2010.hwp'),files=[];
function tableXml(width,label,rows=1){
  const d=new HwpDocument(blank);
  try{
    d.createBlankDocument();
    const r=JSON.parse(d.createTableEx(json({sectionIdx:0,paraIdx:0,charOffset:0,rowCount:rows,colCount:rows===1?1:2,treatAsChar:true,colWidths:rows===1?[width]:[width/2,width/2]})));
    for(let i=0;i<(rows===1?1:rows*2);i++)d.insertTextInCell(0,r.paraIdx,r.controlIdx,i,0,0,label+i);
    if(rows>1){d.setTableProperties(0,r.paraIdx,r.controlIdx,json({hasCaption:true,captionDirection:2,captionWidth:8500,captionSpacing:850}));d.insertTextInCell(0,r.paraIdx,r.controlIdx,65534,0,3,'SIDE-CAPTION');}
    return unzip(Buffer.from(d.exportHwpx())).get('Contents/section0.xml').toString().match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0];
  }finally{d.free();}
}
for(const depth of [1,2,3]){
  let inner=tableXml(20000,'INNER-',4);
  if(depth===3)inner=tableXml(41000,'MIDDLE-').replace('<hp:t>MIDDLE-0</hp:t>',inner+'<hp:t>MIDDLE-0</hp:t>');
  if(depth>1)inner=tableXml(46000,'OUTER-').replace('<hp:t>OUTER-0</hp:t>',inner+'<hp:t>OUTER-0</hp:t>');
  const d=new HwpDocument(blank);let bytes;
  try{
    d.createBlankDocument();d.insertText(0,0,0,'BODY-UNCHANGED');d.splitParagraph(0,0,14);d.insertText(0,1,0,'TABLE-HOST');
    const entries=unzip(Buffer.from(d.exportHwpx()));entries.set('Contents/section0.xml',Buffer.from(entries.get('Contents/section0.xml').toString().replace('<hp:t>TABLE-HOST</hp:t>',inner+'<hp:t>TABLE-HOST</hp:t>')));bytes=zip(entries);
  }finally{d.free();}
  const source=new HwpDocument(bytes);
  try{
    source.applyParaFormat(0,1,json({alignment:'center'}));
    for(let level=1;level<depth;level++)source.applyParaFormatInCellByPath(0,1,json(Array.from({length:level},()=>({controlIndex:0,cellIndex:0,cellParaIndex:0}))),json({alignment:'center'}));
    for(const format of ['hwp','hwpx']){const file=path.join(root,`depth-${depth}.${format}`);await writeFile(file,format==='hwp'?source.exportHwp():source.exportHwpx());files.push(file);}
  }finally{source.free();}
}
const data=await createWorkspace(files,path.join(root,'output')),manifest=path.join(root,'workspace.json');await writeFile(manifest,json(data));
const port=18877,base=`http://127.0.0.1:${port}`,child=spawn(process.execPath,['app/server.mjs'],{env:{...process.env,PORT:String(port),DOCUMENT_MANIFEST:manifest},stdio:['ignore','pipe','pipe']});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined}),context=await browser.newContext({viewport:{width:1280,height:1050}}),report={root,checks:[],geometry:[],errors:[],warnings:[],externalRequests:[]};
context.on('page',p=>{p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(['warning','error'].includes(m.type()))report.warnings.push(m.text());});p.on('request',r=>{if(!r.url().startsWith(base+'/')&&!/^(blob|data):/.test(r.url()))report.externalRequests.push(r.url());});});
const pass=name=>{report.checks.push(name);console.log('PASS',name);},ready=p=>p.waitForFunction(()=>window.editorReady,null,{timeout:45000});
async function select(p){await p.getByRole('button',{name:'찾아 바꾸기',exact:true}).click();const f=p.frameLocator('#editor iframe');await f.getByRole('textbox',{name:'찾을 내용',exact:true}).fill('INNER-0');await f.getByRole('button',{name:'다음 찾기',exact:true}).click();await f.getByText('검색 결과 1개',{exact:true}).waitFor();await f.getByRole('button',{name:'찾아 바꾸기 닫기',exact:true}).click();}
async function command(f,label,menu='표'){await f.locator('#menu-bar').getByText(menu,{exact:true}).click();await f.locator('#menu-bar').getByText(label,{exact:true}).click();}
async function properties(p,f){await select(p);await command(f,'표/셀 속성');await f.getByRole('button',{name:'여백/캡션',exact:true}).click();}
async function save(p,revision){await p.getByRole('button',{name:'결과 파일 저장',exact:true}).click();await p.locator(`#delivery[data-revision="${revision}"]`).waitFor();}
const acknowledge=p=>p.waitForFunction(()=>{const revision=localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision;return revision>0&&revision===Number(document.querySelector('#status').dataset.savedRevision);});
function preserved(source,result,q){
  assert.equal(result.getTextFileUnicode(true),source.getTextFileUnicode(true));
  const omitCaption=props=>{for(const key of ['captionDirection','captionVertAlign','captionSpacing','captionWidth'])delete props[key];return props;};
  assert.deepEqual(omitCaption(JSON.parse(result.getTablePropertiesByPath(0,1,q))),omitCaption(JSON.parse(source.getTablePropertiesByPath(0,1,q))));
  const p=JSON.parse(q),count=JSON.parse(source.getTableDimensionsByPath(0,1,q)).cellCount;
  for(let i=0;i<count;i++){
    assert.equal(result.getCellPropertiesByPath(0,1,q,i),source.getCellPropertiesByPath(0,1,q,i));
    const cell=structuredClone(p);cell.at(-1).cellIndex=i;
    assert.equal(result.getCellCharPropertiesAtByPath(0,1,json(cell),0),source.getCellCharPropertiesAtByPath(0,1,json(cell),0));
    assert.equal(result.getCellParaPropertiesAtByPath(0,1,json(cell)),source.getCellParaPropertiesAtByPath(0,1,json(cell)));
  }
  const caption=structuredClone(p);caption.at(-1).cellIndex=65534;
  assert.equal(result.getCellCharPropertiesAtByPath(0,1,json(caption),3),source.getCellCharPropertiesAtByPath(0,1,json(caption),3));
  assert.equal(result.getCellParaPropertiesAtByPath(0,1,json(caption)),source.getCellParaPropertiesAtByPath(0,1,json(caption)));
  for(let level=1;level<p.length;level++)assert.equal(result.getTablePropertiesByPath(0,1,json(p.slice(0,level))),source.getTablePropertiesByPath(0,1,json(p.slice(0,level))));
}
function geometry(d,q,dir){
  const cells=JSON.parse(d.getTableCellBboxesByPath(0,1,q)),caption=[],host=[];
  assert.equal(cells.length,8,'Caption-bearing nested queries must identify the inner table, not its enclosing table');
  function visit(n){if(n.type==='TextLine'&&n.captionOwner)caption.push(n.bbox);if(n.type==='TextRun'&&/MIDDLE-|OUTER-|TABLE-HOST/.test(n.text))host.push(n);for(const c of n.children||[])visit(c);}
  for(let page=0;page<d.pageCount();page++)visit(JSON.parse(d.getPageRenderTree(page)));
  assert(caption.length>0);
  const box=items=>({left:Math.min(...items.map(c=>c.x)),right:Math.max(...items.map(c=>c.x+c.w)),top:Math.min(...items.map(c=>c.y)),bottom:Math.max(...items.map(c=>c.y+c.h))}),t=box(cells),c=box(caption);
  assert(dir===0?c.right<t.left:c.left>t.right,'The caption must render on the chosen side: '+json({t,c,dir}));
  for(const run of host){const b=run.bbox;assert(b.x+b.w<=c.left+0.2||b.x>=c.right-0.2||b.y+b.h<=c.top+0.2||b.y>=c.bottom-0.2,'Host text must not overlap a side caption: '+json({text:run.text,b,c}));}
  const p=JSON.parse(q);
  if(p.length>1){const parent=JSON.parse(d.getTableCellBboxesByPath(0,1,json(p.slice(0,-1))))[0];assert(c.left>=parent.x-0.2&&c.right<=parent.x+parent.w+0.2&&c.top>=parent.y-0.2&&c.bottom<=parent.y+parent.h+0.2,'Side captions must stay inside the enclosing cell in the roomy fixture');}
  return {t,c};
}
try{
  await new Promise((resolve,reject)=>{let stderr='';child.stderr.on('data',v=>stderr+=v);const timer=setTimeout(()=>reject(Error('Server startup timeout: '+stderr)),10000);child.once('error',reject);child.once('exit',code=>reject(Error('Server exited '+code+': '+stderr)));child.stdout.once('data',()=>{clearTimeout(timer);resolve();});});
  for(const entry of data.documents){
    const depth=Number(entry.name.match(/depth-(\d)/)[1]),q=json(Array.from({length:depth},()=>({controlIndex:0,cellIndex:0,cellParaIndex:0}))),source=new HwpDocument(await readFile(entry.source)),p=await context.newPage(),f=p.frameLocator('#editor iframe');let revision=0;
    try{
      await p.goto(base+'/editor?id='+entry.id);await ready(p);const ys=[];
      for(const dir of [0,1])for(const [sub,alignment] of ['위','가운데','아래'].entries()){
        await properties(p,f);
        if(revision===0){for(const name of ['캡션 위','캡션 아래','캡션 없음'])assert.equal(await f.getByRole('button',{name,exact:true}).count(),1);assert.equal(await f.getByRole('spinbutton',{name:'캡션 너비(mm)',exact:true}).isEnabled(),false);}
        const label='캡션 '+(dir===0?'왼쪽':'오른쪽')+' '+alignment;
        assert.equal(await f.getByRole('button',{name:label,exact:true}).count(),1,'Caption placement needs a named browser control: '+label);
        await f.getByRole('button',{name:label,exact:true}).click();
        assert.equal(await f.getByRole('button',{name:label,exact:true}).getAttribute('aria-pressed'),'true');
        const width=f.getByRole('spinbutton',{name:'캡션 너비(mm)',exact:true}),spacing=f.getByRole('spinbutton',{name:'캡션 간격(mm)',exact:true});
        assert.equal(await width.isEnabled(),true);await width.fill('30');await spacing.fill('3');await f.getByRole('button',{name:'확인',exact:true}).click();await save(p,++revision);
        const result=new HwpDocument(await readFile(entry.output));
        try{const props=JSON.parse(result.getTablePropertiesByPath(0,1,q));assert.equal(props.captionDirection,dir);assert.equal(props.captionVertAlign,sub);assert.equal(props.captionWidth,8504);assert.equal(props.captionSpacing,850);preserved(source,result,q);const g=geometry(result,q,dir);ys.push(g.c.top);report.geometry.push({name:entry.name,dir,sub,...g});assert.equal(digest(await readFile(entry.source)),entry.sourceSha256);const receipt=JSON.parse(await readFile(entry.output+'.receipt.json'));assert.equal(receipt.contentLoss.count,0);assert.equal(receipt.outputSha256,digest(await readFile(entry.output)));}finally{result.free();}
        pass(entry.format+' '+depth+'-level '+label+' keeps geometry/content after save');
      }
      for(const start of [0,3])assert(ys[start]<ys[start+1]&&ys[start+1]<ys[start+2],'Top/center/bottom placement must produce ordered vertical positions: '+json(ys));
      await command(f,'되돌리기','편집');await save(p,++revision);let result=new HwpDocument(await readFile(entry.output));try{assert.equal(JSON.parse(result.getTablePropertiesByPath(0,1,q)).captionVertAlign,1);preserved(source,result,q);}finally{result.free();}
      await command(f,'다시 실행','편집');await acknowledge(p);await p.reload();await ready(p);await save(p,++revision);await p.goto(base+'/editor?id='+entry.id+'&result=1');await ready(p);
      result=new HwpDocument(await readFile(entry.output));try{const props=JSON.parse(result.getTablePropertiesByPath(0,1,q));assert.equal(props.captionDirection,1);assert.equal(props.captionVertAlign,2);preserved(source,result,q);geometry(result,q,1);}finally{result.free();}
      await properties(p,f);assert.equal(await f.getByRole('button',{name:'캡션 오른쪽 아래',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await f.getByRole('spinbutton',{name:'캡션 너비(mm)',exact:true}).inputValue(),'30.0');await f.getByRole('button',{name:'취소',exact:true}).click();
      pass(entry.format+' '+depth+'-level side caption undo/recovery/reopen retains properties');
    }finally{source.free();await p.close();}
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.warnings,[]);assert.deepEqual(report.externalRequests,[]);pass('no browser errors, warnings or external requests');
}finally{await writeFile('test-results/table-caption-placement-browser.json',json(report,null,2));await browser.close();if(!child.killed){child.kill();await new Promise(resolve=>child.once('close',resolve));}}
