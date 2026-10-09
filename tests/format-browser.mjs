import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile,mkdtemp,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspace,digest} from '../app/workspace.mjs';
import {initSync,HwpDocument} from '../.build/core/rhwp.js';

const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH||import.meta.url);
const {chromium}=require('playwright');
await mkdir('test-results',{recursive:true});
const root=await mkdtemp(path.resolve('test-results/format-'));
initSync({module:await readFile('.build/core/rhwp_bg.wasm')});
const blank=await readFile('.cache/rhwp/saved/blank2010.hwp');
const files=[];
for(const format of ['hwp','hwpx']){
  const document=new HwpDocument(blank);
  try{
    document.createBlankDocument();
    const title='서식 수정 제목',body='보존할 본문';
    document.insertText(0,0,0,title);document.splitParagraph(0,0,title.length);
    document.insertText(0,1,0,body);document.splitParagraph(0,1,body.length);
    document.createTable(0,2,0,2,2);
    document.setTableProperties(0,2,0,JSON.stringify({paddingTop:141,paddingBottom:141,outerLeft:71,outerRight:83,outerTop:47,outerBottom:59,horzOffset:31,vertOffset:41,cellSpacing:29}));
    document.setCellProperties(0,2,0,0,JSON.stringify({applyInnerMargin:true,paddingTop:89,paddingBottom:91,paddingLeft:109,paddingRight:131}));
    for(const [cell,text] of ['기존 셀 A','셀 서식 수정','삭제 대상','보존할 셀 B'].entries())document.insertTextInCell(0,2,0,cell,0,0,text);
    const file=path.join(root,'format.'+format);
    await writeFile(file,format==='hwp'?document.exportHwp():document.exportHwpx());files.push(file);
  }finally{document.free();}
}
const workspace=await createWorkspace(files,path.join(root,'output'));
const manifest=path.join(root,'workspace.json');await writeFile(manifest,JSON.stringify(workspace));
const port=18870,base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['app/server.mjs'],{env:{...process.env,PORT:String(port),DOCUMENT_MANIFEST:manifest},stdio:['ignore','pipe','pipe']});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined});
const context=await browser.newContext({viewport:{width:1280,height:1050}});
const report={root,checks:[],errors:[],externalRequests:[],warnings:[]};
const staleWorker=path.resolve('.build/studio/test-stale-worker.js');
context.on('page',page=>{
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(['warning','error'].includes(message.type()))report.warnings.push(message.text());});
  page.on('request',request=>{if(!request.url().startsWith(base+'/')&&!/^(blob|data):/.test(request.url()))report.externalRequests.push(request.url());});
});
const pass=name=>{report.checks.push(name);console.log('PASS',name);};
const ready=page=>page.waitForFunction(()=>window.editorReady,null,{timeout:45000});
async function select(page,text){
  await page.getByRole('button',{name:'찾아 바꾸기',exact:true}).click();
  const frame=page.frameLocator('#editor iframe');
  await frame.getByRole('textbox',{name:'찾을 내용',exact:true}).fill(text);
  await frame.getByRole('button',{name:'다음 찾기',exact:true}).click();
  await frame.getByRole('button',{name:'찾아 바꾸기 닫기',exact:true}).click();
}
async function insert(page,text,mode){
  await select(page,text);const frame=page.frameLocator('#editor iframe');
  await frame.locator('#menu-bar').getByText('표',{exact:true}).click();
  await frame.getByText('줄/칸 추가하기(I)...',{exact:true}).click();
  await frame.getByRole('radio',{name:mode,exact:true}).check();
  await frame.getByRole('button',{name:'추가',exact:true}).click();
}
async function remove(page,text,mode){
  await select(page,text);const frame=page.frameLocator('#editor iframe');
  await frame.locator('#menu-bar').getByText('표',{exact:true}).click();
  await frame.getByText('줄/칸 지우기(E)...',{exact:true}).click();
  await frame.getByRole('radio',{name:mode,exact:true}).check();
  await frame.getByRole('button',{name:'지우기',exact:true}).click();
}
async function save(page,revision){
  await page.getByRole('button',{name:'결과 파일 저장',exact:true}).click();
  await page.locator(`#delivery[data-revision="${revision}"]`).waitFor();
}
function verifyStyles(document,source){
  const title=JSON.parse(document.getCharShapeSet(0,0,0));
  assert.equal(title.Bold,1);assert.equal(title.Height,1400);
  assert.equal(JSON.parse(document.getParaShapeSet(0,0)).AlignType,3);
  assert.equal(document.getCharShapeSet(0,1,0),source.getCharShapeSet(0,1,0));
  assert.equal(document.getParaShapeSet(0,1),source.getParaShapeSet(0,1));
}
try{
  await new Promise((resolve,reject)=>{
    let stderr='';child.stderr.on('data',v=>stderr+=v);
    const timer=setTimeout(()=>reject(new Error('Server startup timeout: '+stderr)),10000);
    child.once('error',reject);child.once('exit',code=>reject(new Error('Server exited '+code+': '+stderr)));
    child.stdout.once('data',()=>{clearTimeout(timer);resolve();});
  });
  assert.ok(!(await readFile('.build/studio/index.html','utf8')).includes('registerSW.js'));
  await writeFile(staleWorker,`addEventListener('install',()=>self.skipWaiting());addEventListener('activate',e=>e.waitUntil(self.clients.claim()));addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(new Response('<h1>STALE_EDITOR_BUILD</h1>',{headers:{'Content-Type':'text/html'}}));});`);
  const cachedPage=await context.newPage();await cachedPage.goto(base+'/tasks');
  await cachedPage.evaluate(async()=>{
    const registration=await navigator.serviceWorker.register('/rhwp/test-stale-worker.js',{scope:'/rhwp/'});
    const worker=registration.installing||registration.waiting||registration.active;
    if(worker.state!=='activated')await new Promise(resolve=>worker.addEventListener('statechange',()=>{if(worker.state==='activated')resolve();}));
    const frame=document.createElement('iframe');frame.src='/rhwp/stale-frame';frame.id='stale-frame';document.body.append(frame);
  });
  await cachedPage.frameLocator('#stale-frame').getByRole('heading',{name:'STALE_EDITOR_BUILD',exact:true}).waitFor();
  await cachedPage.goto(base+'/editor?id='+workspace.documents[0].id);await ready(cachedPage);
  assert.equal(await cachedPage.evaluate(async()=>(await navigator.serviceWorker.getRegistrations()).some(item=>item.scope===location.origin+'/rhwp/')),false);
  pass('stale upstream service worker retired before document load');await cachedPage.close();
  for(const entry of workspace.documents){
    const page=await context.newPage();await page.goto(base+'/editor?id='+entry.id);await ready(page);
    const frame=page.frameLocator('#editor iframe');
    assert.equal(await frame.getByRole('button',{name:'굵게',exact:true}).count(),1);
    assert.equal(await frame.getByRole('textbox',{name:'글자 크기(pt)',exact:true}).count(),1);
    await select(page,'서식 수정 제목');
    await frame.getByRole('button',{name:'굵게',exact:true}).click();
    await frame.getByRole('textbox',{name:'글자 크기(pt)',exact:true}).fill('14');
    await frame.getByRole('textbox',{name:'글자 크기(pt)',exact:true}).press('Enter');
    await frame.locator('#btn-align-center').click();
    await select(page,'셀 서식 수정');
    await page.screenshot({path:'test-results/format-cell-selection.png'});
    await frame.getByRole('button',{name:'굵게',exact:true}).click();
    await save(page,1);
    const formatted=new HwpDocument(await readFile(entry.output));
    try{assert.equal(JSON.parse(formatted.getCellCharPropertiesAt(0,2,0,1,0,0)).bold,true);}
    finally{formatted.free();}
    await insert(page,'기존 셀 A','위쪽에 줄 추가하기');
    await insert(page,'기존 셀 A','왼쪽에 칸 추가하기');
    const original=new HwpDocument(await readFile(entry.source));
    const originalWidth=JSON.parse(original.getTableProperties(0,2,0)).tableWidth;original.free();
    const widthMm=(originalWidth*25.4/7200).toFixed(1);
    await select(page,'기존 셀 A');
    await frame.locator('#menu-bar').getByText('표',{exact:true}).click();
    await frame.getByText('표/셀 속성',{exact:true}).click();
    await frame.getByRole('button',{name:'기본',exact:true}).click();
    const width=frame.getByRole('spinbutton',{name:'표 너비(mm)',exact:true});
    assert.equal(await width.getAttribute('readonly'),null);
    await width.fill('0');await frame.getByRole('button',{name:'확인',exact:true}).click();
    assert.equal(await width.isVisible(),true);
    await width.fill('0.1');await frame.getByRole('button',{name:'확인',exact:true}).click();
    assert.equal(await width.isVisible(),true);
    await width.fill(widthMm);await frame.getByRole('button',{name:'확인',exact:true}).click();
    await save(page,2);
    const source=new HwpDocument(await readFile(entry.source));
    let result=new HwpDocument(await readFile(entry.output));
    try{
      verifyStyles(result,source);
      assert.ok(Math.abs(JSON.parse(result.getTableProperties(0,2,0)).tableWidth-originalWidth)<30);
      const unchangedTableProps=properties=>{
        const {tableWidth,tableHeight,...rest}=JSON.parse(properties);return rest;
      };
      assert.deepEqual(unchangedTableProps(result.getTableProperties(0,2,0)),unchangedTableProps(source.getTableProperties(0,2,0)));
      const unchangedCellProps=properties=>{const {width,height,...rest}=JSON.parse(properties);return rest;};
      assert.deepEqual(unchangedCellProps(result.getCellProperties(0,2,0,4)),unchangedCellProps(source.getCellProperties(0,2,0,0)));
      for(let cell=0;cell<9;cell++)assert.ok(JSON.parse(result.getCellProperties(0,2,0,cell)).width>=200);
      pass(entry.format+' explicit table width and rejected zero/tiny widths survive saved reopen');
      assert.deepEqual(JSON.parse(result.getTableDimensions(0,2,0)),{rowCount:3,colCount:3,cellCount:9});
      // Added empty cells introduce expected blank lines in the text export.
      const nonempty=text=>text.split('\r\n').filter(Boolean);
      assert.deepEqual(nonempty(JSON.parse(result.getTextFileUnicode())),nonempty(JSON.parse(source.getTextFileUnicode())));
      assert.deepEqual(Array.from({length:9},(_,i)=>result.getTextInCell(0,2,0,i,0,0,100)),['','','','','기존 셀 A','셀 서식 수정','','삭제 대상','보존할 셀 B']);
      const cellStyle=JSON.parse(result.getCellCharPropertiesAt(0,2,0,5,0,0));
      assert.equal(cellStyle.bold,true);assert.equal(cellStyle.fontSize,1000);
      assert.equal(result.getCellCharPropertiesAt(0,2,0,4,0,0),source.getCellCharPropertiesAt(0,2,0,0,0,0));
      pass(entry.format+' character/paragraph formatting and row/column insertion survive saved reopen');
    }finally{result.free();}
    await page.reload();await ready(page);
    await remove(page,'삭제 대상','줄');await remove(page,'셀 서식 수정','칸');await save(page,3);
    result=new HwpDocument(await readFile(entry.output));
    try{
      verifyStyles(result,source);
      assert.deepEqual(JSON.parse(result.getTableDimensions(0,2,0)),{rowCount:2,colCount:2,cellCount:4});
      assert.deepEqual(Array.from({length:4},(_,i)=>result.getTextInCell(0,2,0,i,0,0,100)),['','','','기존 셀 A']);
      const text=JSON.parse(result.getTextFileUnicode());
      assert.ok(text.includes('기존 셀 A'));assert.ok(text.includes('보존할 본문'));
      for(const removed of ['삭제 대상','보존할 셀 B','셀 서식 수정'])assert.ok(!text.includes(removed));
      assert.equal(result.getSourceFormat(),entry.format);
      assert.equal(digest(await readFile(entry.source)),entry.sourceSha256);
      pass(entry.format+' recovered journal, row/column deletion and untouched source verified');
    }finally{source.free();result.free();}
    await page.goto(base+'/editor?id='+entry.id+'&result=1');await ready(page);
    await page.getByRole('button',{name:'문서 텍스트 확인',exact:true}).click();
    await page.locator('#document-text').filter({hasText:'기존 셀 A'}).waitFor();
    await page.screenshot({path:`test-results/format-${entry.format}.png`});await page.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.warnings,[]);assert.deepEqual(report.externalRequests,[]);pass('no browser errors, warnings or external runtime requests');
}finally{
  await unlink(staleWorker).catch(error=>{if(error.code!=='ENOENT')throw error;});
  await writeFile('test-results/format-browser.json',JSON.stringify(report,null,2));await browser.close();
  if(!child.killed){child.kill();await new Promise(resolve=>child.once('close',resolve));}
}
