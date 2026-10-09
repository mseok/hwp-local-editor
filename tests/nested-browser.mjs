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
let bytes;
try{
  outer.createBlankDocument();outer.insertText(0,0,0,'보존할 본문');outer.splitParagraph(0,0,7);outer.createTable(0,1,0,2,2);
  for(const [i,text] of ['바깥 셀 A','바깥 셀 B','바깥 셀 C','바깥 셀 D'].entries())outer.insertTextInCell(0,1,0,i,0,0,text);
  inner.createBlankDocument();const created=JSON.parse(inner.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:0,rowCount:1,colCount:2,treatAsChar:true,colWidths:[7000,7000]})));
  inner.insertTextInCell(0,0,created.controlIdx,0,0,0,'중첩 셀 보존');inner.insertTextInCell(0,0,created.controlIdx,1,0,0,'중첩 수정 대상');
  const entries=unzip(Buffer.from(outer.exportHwpx()));
  const innerTable=unzip(Buffer.from(inner.exportHwpx())).get('Contents/section0.xml').toString().match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0].replace(/\bid="\d+"/g,match=>`id="${1000+Number(match.match(/\d+/)[0])}"`);
  const section=entries.get('Contents/section0.xml').toString();assert.ok(section.includes('<hp:t>바깥 셀 A</hp:t>'));
  entries.set('Contents/section0.xml',Buffer.from(section.replace('<hp:t>바깥 셀 A</hp:t>',innerTable+'<hp:t>바깥 셀 A</hp:t>')));bytes=zip(entries);
}finally{outer.free();inner.free();}
const files=[];
for(const format of ['hwp','hwpx']){
  const document=new HwpDocument(bytes);
  try{const file=path.join(root,'nested.'+format);await writeFile(file,format==='hwp'?document.exportHwp():document.exportHwpx());files.push(file);}
  finally{document.free();}
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
  for(const entry of data.documents){
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
    await page.getByText('현재 문서 텍스트',{exact:true}).click();await page.screenshot({path:path.join(root,entry.format+'.png')});await page.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.warnings,[]);assert.deepEqual(report.externalRequests,[]);pass('no browser errors, warnings or external requests');
}finally{
  await writeFile('test-results/nested-browser.json',JSON.stringify(report,null,2));await browser.close();
  if(!child.killed){child.kill();await new Promise(resolve=>child.once('close',resolve));}
}
