import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspace,digest} from '../app/workspace.mjs';
import {initSync,HwpDocument} from '../.build/core/rhwp.js';
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH||import.meta.url);
const {chromium}=require('playwright');
await mkdir('test-results',{recursive:true});
const root=await mkdtemp(path.resolve('test-results/agent-'));
initSync({module:await readFile('.build/core/rhwp_bg.wasm')});
const blank=await readFile('.cache/rhwp/saved/blank2010.hwp');
const files=[];
for(const format of ['hwp','hwpx']){
  const document=new HwpDocument(blank);
  try{
    document.createBlankDocument();document.insertText(0,0,0,'검증 문서');document.splitParagraph(0,0,5);
    document.insertText(0,1,0,'참여인원: 3명. 유지할 본문.');document.splitParagraph(0,1,17);
    document.createTable(0,2,0,2,2);
    for(const [cell,text] of ['이름','인원','연구진','참여인원: 3명'].entries())document.insertTextInCell(0,2,0,cell,0,0,text);
    const file=path.join(root,'sample.'+format);await writeFile(file,format==='hwp'?document.exportHwp():document.exportHwpx());files.push(file);
  }finally{document.free();}
}
const manifestData=await createWorkspace(files,path.join(root,'output'));
const manifest=path.join(root,'workspace.json');await writeFile(manifest,JSON.stringify(manifestData));
const port=18868,base=`http://127.0.0.1:${port}`;
let child;
async function start(){
  child=spawn(process.execPath,['app/server.mjs'],{env:{...process.env,PORT:String(port),DOCUMENT_MANIFEST:manifest},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',v=>stderr+=v);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Server startup timeout: '+stderr)),10000);
    child.once('error',reject);child.once('exit',code=>reject(new Error('Server exited '+code+': '+stderr)));
    child.stdout.once('data',()=>{clearTimeout(timer);resolve();});
  });
}
async function stop(){if(child&&!child.killed){child.kill();await new Promise(resolve=>child.once('close',resolve));}}
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined});
const context=await browser.newContext({viewport:{width:1280,height:1050}});
const report={checks:[],errors:[],externalRequests:[],root};
context.on('page',page=>{page.on('pageerror',error=>report.errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith(base+'/')&&!/^(blob|data):/.test(request.url()))report.externalRequests.push(request.url());});});
const pass=name=>{report.checks.push(name);console.log('PASS',name);};
const ready=page=>page.waitForFunction(()=>window.editorReady,null,{timeout:45000});
try{
  await start();
  const task=await context.newPage();await task.goto(base+'/tasks');await task.getByText('2개 문서 · 0개 결과 저장됨',{exact:true}).waitFor();pass('registered file list requires no browser upload');
  const a=await context.newPage(),b=await context.newPage(),stale=await context.newPage();
  await Promise.all([a.goto(base+'/editor?id='+manifestData.documents[0].id),b.goto(base+'/editor?id='+manifestData.documents[1].id),stale.goto(base+'/editor?id='+manifestData.documents[0].id)]);
  await Promise.all([ready(a),ready(b),ready(stale)]);
  for(const page of [a,b]){
    await page.getByRole('button',{name:'문서 텍스트 확인',exact:true}).click();await page.locator('#document-text').filter({hasText:'참여인원: 3명'}).waitFor();assert.equal((await page.locator('#document-text').innerText()).match(/참여인원: 3명/g).length,2);
    await page.getByRole('button',{name:'찾아 바꾸기',exact:true}).click();const frame=page.frameLocator('#editor iframe');
    await frame.getByRole('textbox',{name:'찾을 내용',exact:true}).fill('참여인원: 3명');
    await frame.getByRole('textbox',{name:'바꿀 내용',exact:true}).fill('참여인원: 7명');
    await frame.getByRole('button',{name:'모두 바꾸기',exact:true}).click();await frame.getByText('2개 바꿈',{exact:true}).waitFor();
    await frame.getByRole('button',{name:'찾아 바꾸기 닫기',exact:true}).click();
    await page.getByRole('button',{name:'결과 파일 저장',exact:true}).click();await page.locator('#delivery[data-revision="1"]').waitFor();
    await page.getByRole('button',{name:'문서 텍스트 확인',exact:true}).click();
    await page.locator('#document-text').filter({hasText:'참여인원: 7명'}).waitFor();
    assert.equal((await page.locator('#document-text').innerText()).match(/참여인원: 7명/g).length,2);
  }
  pass('HWP and HWPX body/table edits save verified separate results');
  await stale.getByRole('button',{name:'결과 파일 저장',exact:true}).click();await stale.getByText(/결과 저장 실패: Another window saved/).waitFor();pass('stale duplicate tab cannot overwrite newer output');
  for(const entry of manifestData.documents){
    const input=await readFile(entry.source),output=await readFile(entry.output);assert.equal(digest(input),entry.sourceSha256);
    const sourceDocument=new HwpDocument(input),resultDocument=new HwpDocument(output);
    try{
      assert.equal(resultDocument.getSourceFormat(),entry.format);
      assert.equal(JSON.parse(resultDocument.getTextFileUnicode()),JSON.parse(sourceDocument.getTextFileUnicode()).replaceAll('참여인원: 3명','참여인원: 7명'));
      assert.equal(resultDocument.getSectionCount(),sourceDocument.getSectionCount());
      assert.equal(resultDocument.getTableDimensions(0,2,0),sourceDocument.getTableDimensions(0,2,0));
      assert.equal(resultDocument.getTableProperties(0,2,0),sourceDocument.getTableProperties(0,2,0));
      assert.equal(resultDocument.getParaShapeSet(0,1),sourceDocument.getParaShapeSet(0,1));
      assert.equal(resultDocument.getCharShapeSet(0,1,0),sourceDocument.getCharShapeSet(0,1,0));
    }finally{sourceDocument.free();resultDocument.free();}
    const reopened=await context.newPage();await reopened.goto(base+'/editor?id='+entry.id+'&result=1');await ready(reopened);
    await reopened.getByRole('button',{name:'문서 텍스트 확인',exact:true}).click();await reopened.locator('#document-text').filter({hasText:'참여인원: 7명'}).waitFor();assert.equal((await reopened.locator('#document-text').innerText()).match(/참여인원: 7명/g).length,2);
    await reopened.close();
  }
  pass('saved results reopen; original hashes, table dimensions/properties and body styles remain unchanged');
  const blocked=await context.request.post(base+'/document/'+manifestData.documents[0].id+'/result',{headers:{Origin:'https://attacker.example','Content-Type':'application/octet-stream'},data:Buffer.from('bad')});assert.equal(blocked.status(),403);pass('cross-origin result writes are rejected');
  const preview=await context.newPage();await preview.goto(base+'/?document='+manifestData.documents[1].id+'&result=1');await preview.waitForFunction(()=>window.previewResult?.pageCount);assert.equal(await preview.locator('.page').count(),1);pass('saved output renders in browser preview');
  await a.locator('#back').click();await a.waitForFunction(()=>window.previewResult?.pageCount);await a.locator('#edit-button').click();await ready(a);
  assert.equal(new URL(a.url()).searchParams.get('id'),manifestData.documents[0].id);
  await a.getByRole('button',{name:'결과 파일 저장',exact:true}).click();await a.locator('#delivery[data-revision="2"]').waitFor();pass('preview-to-editor round trip keeps the registered result destination');
  await stop();await start();await task.reload();await task.getByText('2개 문서 · 2개 결과 저장됨',{exact:true}).waitFor();pass('task receipts and outputs survive server restart');
  await task.screenshot({path:'test-results/agent-tasks.png'});await preview.screenshot({path:'test-results/agent-result.png'});
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);pass('no browser errors or external runtime requests');
}finally{
  await writeFile('test-results/agent-browser.json',JSON.stringify(report,null,2));await browser.close();await stop();
}
