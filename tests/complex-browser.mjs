import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {deflateSync} from 'node:zlib';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspace,digest} from '../app/workspace.mjs';
import {requireLosslessExport} from '../app/export-check.mjs';
import {initSync,HwpDocument} from '../.build/core/rhwp.js';
import {unzip,zip,crc32} from './zip-fixture.mjs';

const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH||import.meta.url);
const {chromium}=require('playwright');
await mkdir('test-results',{recursive:true});
const root=await mkdtemp(path.resolve('test-results/complex-'));
initSync({module:await readFile('.build/core/rhwp_bg.wasm')});
const blank=await readFile('.cache/rhwp/saved/blank2010.hwp');
function png() {
  const chunk=(name,bytes)=>{const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(bytes.length);crc.writeUInt32BE(crc32(Buffer.concat([type,bytes])));return Buffer.concat([length,type,bytes,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(32);header.writeUInt32BE(32,4);header[8]=8;header[9]=6;
  const pixels=Buffer.alloc(32*(1+32*4));
  for(let y=0;y<32;y++)for(let x=0;x<32;x++){const i=y*129+1+x*4;pixels[i]=20;pixels[i+1]=140;pixels[i+2]=80;pixels[i+3]=255;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
function exportDocument(document,format) {
  const artifact=format==='hwp'?document.exportHwpWithReport():document.exportHwpxWithReport();
  try { requireLosslessExport(JSON.parse(artifact.contentLoss()),format);return Buffer.from(artifact.takeBytes()); }
  finally { artifact.free(); }
}
const original=new HwpDocument(blank),inner=new HwpDocument(blank);
let nestedSource;
try {
  original.createBlankDocument();
  for(let i=0;i<90;i++) {
    const text=i===0?'참여인원: 3명. 보존할 제목.':`본문 ${i}: 구조 분석과 후보 설계를 위한 계산 평가 내용을 보존합니다.`;
    original.insertText(0,i,0,text);original.splitParagraph(0,i,original.getParagraphLength(0,i));
  }
  original.insertPicture(0,1,0,'',png(),2400,2400,32,32,'png','합성 검증 그림');
  original.insertEquation(0,2,0,'x sup 2 + y sup 2 = z sup 2',1000,0);
  original.insertFootnote(0,3,0);original.insertTextInFootnote(0,3,0,0,0,'보존할 각주');
  original.createHeaderFooter(0,true,0);original.insertTextInHeaderFooter(0,true,0,0,0,'보존할 머리말');
  original.createTable(0,4,0,2,2);
  for(const [cell,text] of ['상위 셀','참여인원: 3명','유지할 셀','표 아래 내용'].entries()) original.insertTextInCell(0,4,0,cell,0,0,text);
  inner.createBlankDocument();const created=JSON.parse(inner.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:0,rowCount:1,colCount:2,treatAsChar:true,colWidths:[7000,7000]})));
  inner.insertTextInCell(0,0,created.controlIdx,0,0,0,'참여인원: 3명');inner.insertTextInCell(0,0,created.controlIdx,1,0,0,'중첩 셀 보존');
  const entries=unzip(exportDocument(original,'hwpx'));
  const innerXml=unzip(exportDocument(inner,'hwpx')).get('Contents/section0.xml').toString('utf8');
  const innerTable=innerXml.match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0].replace(/\bid="\d+"/g,match=>`id="${1000+Number(match.match(/\d+/)[0])}"`);
  const section=entries.get('Contents/section0.xml').toString('utf8');
  assert.ok(section.includes('<hp:t>상위 셀</hp:t>'));
  entries.set('Contents/section0.xml',Buffer.from(section.replace('<hp:t>상위 셀</hp:t>',innerTable+'<hp:t>상위 셀</hp:t>')));
  nestedSource=zip(entries);
} finally {original.free();inner.free();}
const files=[];
for(const format of ['hwp','hwpx']) {
  const document=new HwpDocument(nestedSource);
  try { const file=path.join(root,'complex.'+format);await writeFile(file,exportDocument(document,format));files.push(file); }
  finally {document.free();}
}
const broken=unzip(nestedSource);for(const name of broken.keys())if(name.startsWith('BinData/'))broken.delete(name);
const brokenPath=path.join(root,'missing-image.hwpx');await writeFile(brokenPath,zip(broken));files.push(brokenPath);
const data=await createWorkspace(files,path.join(root,'output'));
const manifest=path.join(root,'workspace.json');await writeFile(manifest,JSON.stringify(data));
const port=18869,base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['app/server.mjs'],{env:{...process.env,PORT:String(port),DOCUMENT_MANIFEST:manifest},stdio:['ignore','pipe','pipe']});
let stderr='';child.stderr.on('data',value=>stderr+=value);
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined});
const context=await browser.newContext({viewport:{width:1280,height:1050},acceptDownloads:true});
const report={checks:[],errors:[],externalRequests:[],root};
context.on('page',page=>{page.on('pageerror',error=>report.errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith(base+'/')&&!/^(blob|data):/.test(request.url()))report.externalRequests.push(request.url());});});
const pass=name=>{report.checks.push(name);console.log('PASS',name);};
const ready=page=>page.waitForFunction(()=>window.editorReady,null,{timeout:45000});
const pathToInner=JSON.stringify([{controlIndex:0,cellIndex:0,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}]);
function properties(document) {
  const image=unzip(exportDocument(document,'hwpx'));
  return {
    pageCount:document.pageCount(),section:document.getSectionDef(0),
    picture:document.getPictureProperties(0,1,0),equation:document.getEquationProperties(0,2,0,-1,0),
    footnote:document.getFootnoteInfo(0,3,0),header:document.getHeaderFooter(0,true,0),
    table:document.getTableProperties(0,4,0),nested:document.getTableDimensionsByPath(0,4,pathToInner),
    images:[...image].filter(([name])=>name.startsWith('BinData/')).map(([,bytes])=>digest(bytes)).sort(),
  };
}
async function replace(page) {
  await page.getByRole('button',{name:'찾아 바꾸기',exact:true}).click();const frame=page.frameLocator('#editor iframe');
  await frame.getByRole('textbox',{name:'찾을 내용',exact:true}).fill('참여인원: 3명');
  await frame.getByRole('textbox',{name:'바꿀 내용',exact:true}).fill('참여인원: 7명');
  await frame.getByRole('button',{name:'모두 바꾸기',exact:true}).click();
  await frame.getByText('3개 바꿈',{exact:true}).waitFor();
  await frame.getByRole('button',{name:'찾아 바꾸기 닫기',exact:true}).click();
}
try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup timeout: '+stderr)),10000);child.once('error',reject);child.once('exit',code=>reject(new Error('Server exited '+code+': '+stderr)));child.stdout.once('data',()=>{clearTimeout(timer);resolve();});});
  for(const entry of data.documents.slice(0,2)) {
    const page=await context.newPage();await page.goto(base+'/editor?id='+entry.id);await ready(page);
    await page.getByRole('button',{name:'문서 텍스트 확인',exact:true}).click();await page.locator('#document-text').filter({hasText:'참여인원: 3명'}).waitFor();
    assert.equal((await page.locator('#document-text').innerText()).match(/참여인원: 3명/g).length,3);
    await replace(page);await page.getByRole('button',{name:'결과 파일 저장',exact:true}).click();await page.locator('#delivery[data-revision="1"]').waitFor();
    const sourceBytes=await readFile(entry.source),resultBytes=await readFile(entry.output);assert.equal(digest(sourceBytes),entry.sourceSha256);
    const source=new HwpDocument(sourceBytes),result=new HwpDocument(resultBytes);
    try {
      assert.equal(JSON.parse(result.getTextFileUnicode()),JSON.parse(source.getTextFileUnicode()).replaceAll('참여인원: 3명','참여인원: 7명'));
      const baseline=properties(source);
      assert.deepEqual(baseline.images,[digest(png())]);
      assert.deepEqual(JSON.parse(baseline.nested),{rowCount:1,colCount:2,cellCount:2});
      assert.equal(JSON.parse(baseline.equation).script,'x sup 2 + y sup 2 = z sup 2');
      assert.ok(JSON.parse(baseline.footnote).texts.join('').includes('보존할 각주'));
      assert.equal(JSON.parse(baseline.header).text,'보존할 머리말');
      assert.deepEqual(properties(result),baseline);assert.ok(result.pageCount()>1);
    } finally {source.free();result.free();}
    const receipt=JSON.parse(await readFile(entry.output+'.receipt.json','utf8'));assert.equal(receipt.contentLoss.count,0);
    await page.goto(base+'/editor?id='+entry.id+'&result=1');await ready(page);
    await page.getByRole('button',{name:'문서 텍스트 확인',exact:true}).click();await page.locator('#document-text').filter({hasText:'참여인원: 7명'}).waitFor();
    assert.equal((await page.locator('#document-text').innerText()).match(/참여인원: 7명/g).length,3);
    await page.goto(base+'/?document='+entry.id+'&result=1');await page.waitForFunction(()=>window.previewResult?.pageCount);
    assert.ok(await page.locator('.page').count()>1);await page.screenshot({path:path.join(root,'preview-'+entry.format+'.png')});await page.close();
    pass(entry.format+' long document and nested-table edits preserve image bytes, equation, footnote, header, tables and pagination');
  }
  const entry=data.documents[2],brokenBytes=await readFile(entry.source),brokenDocument=new HwpDocument(brokenBytes);
  const brokenText=JSON.parse(brokenDocument.getTextFileUnicode());
  const artifact=brokenDocument.exportHwpxWithReport();try {assert.equal(JSON.parse(artifact.contentLoss()).count,1);}finally{artifact.free();brokenDocument.free();}
  const rejected=await context.request.post(base+'/document/'+entry.id+'/result',{
    headers:{Origin:base,'Content-Type':'application/octet-stream','X-Output-Revision':'0','X-Expected-Text-Sha256':digest(brokenText),'X-Export-Content-Loss':JSON.stringify({schemaVersion:1,outputFormat:'hwpx',count:0,losses:[]})},data:brokenBytes,
  });
  assert.equal(rejected.status(),422);assert.ok((await rejected.text()).includes('1건의 내용 손실'));
  pass('server independently rejects a false zero-loss report for a missing image payload');
  const page=await context.newPage();await page.goto(base+'/editor?id='+entry.id);await ready(page);await replace(page);
  await page.getByRole('button',{name:'결과 파일 저장',exact:true}).click();await page.getByText(/결과 저장 실패: 내보내기 중 1건의 내용 손실/).waitFor();
  assert.equal((await context.request.get(base+'/documents.json')).ok(),true);
  assert.equal((await (await context.request.get(base+'/documents.json')).json())[2].revision,0);
  await assert.rejects(readFile(entry.output),{code:'ENOENT'});pass('real missing image payload blocks final result saving before any output is published');
  let downloads=0;page.on('download',()=>downloads++);
  await page.locator('#save').click();await page.locator('#delivery').filter({hasText:'저장 실패: 내보내기 중 1건의 내용 손실'}).waitFor();
  assert.equal(downloads,0);pass('manual download also rejects the same lossy export');
  const url=page.url();await page.locator('#back').click();await page.locator('#delivery').filter({hasText:'미리보기 준비 실패: 내보내기 중 1건의 내용 손실'}).waitFor();
  assert.equal(page.url(),url);pass('preview cannot replace the working copy with a lossy export');
  const preserved=await page.evaluate(async()=>{
    const {loadDraft}=await import('/drafts.mjs');const draft=await loadDraft(window.localAutosave.state().draftId);
    return {operations:draft.operations.length,snapshot:Boolean(draft.snapshot),revision:draft.revision};
  });
  assert.ok(preserved.operations>0);assert.equal(preserved.operations,preserved.revision);assert.equal(preserved.snapshot,false);
  pass('failed export keeps the edit journal and never replaces its base with a lossy snapshot');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);pass('complex document workflow has no browser errors or external runtime requests');
} finally {
  await writeFile('test-results/complex-browser.json',JSON.stringify(report,null,2));await browser.close();
  if(!child.killed){child.kill();await new Promise(resolve=>child.once('close',resolve));}
}
