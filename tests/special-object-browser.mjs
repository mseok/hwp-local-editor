import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {deflateSync} from 'node:zlib';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkspace,digest} from '../app/workspace.mjs';
import {initSync,HwpDocument} from '../.build/core/rhwp.js';
import {unzip,crc32} from './zip-fixture.mjs';

const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH||import.meta.url),{chromium}=require('playwright'),json=JSON.stringify;
await mkdir('test-results',{recursive:true});
const root=await mkdtemp(path.resolve('test-results/special-objects-'));
initSync({module:await readFile('.build/core/rhwp_bg.wasm')});
function png(){
  const chunk=(name,bytes)=>{const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(bytes.length);crc.writeUInt32BE(crc32(Buffer.concat([type,bytes])));return Buffer.concat([length,type,bytes,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(32);header.writeUInt32BE(32,4);header[8]=8;header[9]=6;
  const pixels=Buffer.alloc(32*129);for(let y=0;y<32;y++)for(let x=0;x<32;x++){const i=y*129+1+x*4;pixels[i]=20;pixels[i+1]=140;pixels[i+2]=80;pixels[i+3]=255;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
const d=new HwpDocument(await readFile('.cache/rhwp/saved/blank2010.hwp')),files=[];
try{
  d.createBlankDocument();for(let i=0;i<5;i++){d.insertText(0,i,0,'보존할 본문 '+i);d.splitParagraph(0,i,d.getParagraphLength(0,i));}
  d.insertPicture(0,1,0,'',png(),2400,2400,32,32,'png','보존할 그림 설명');
  d.insertEquation(0,2,0,'x sup 2 + y sup 2 = z sup 2',1150,0);
  d.insertFootnote(0,3,0);d.insertTextInFootnote(0,3,0,0,0,'보존할 각주');
  d.createHeaderFooter(0,true,0);d.insertTextInHeaderFooter(0,true,0,0,0,'보존할 머리말');
  d.createTable(0,4,0,1,2);d.insertTextInCell(0,4,0,0,0,0,'보존할 첫 셀');d.insertTextInCell(0,4,0,1,0,0,'보존할 둘째 셀');
  for(const format of ['hwp','hwpx']){const file=path.join(root,'objects.'+format);await writeFile(file,format==='hwp'?d.exportHwp():d.exportHwpx());files.push(file);}
}finally{d.free();}
const workspace=await createWorkspace(files,path.join(root,'output')),manifest=path.join(root,'workspace.json');await writeFile(manifest,json(workspace));
const port=18878,base=`http://127.0.0.1:${port}`,child=spawn(process.execPath,['app/server.mjs'],{env:{...process.env,PORT:String(port),DOCUMENT_MANIFEST:manifest},stdio:['ignore','pipe','pipe']});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined}),context=await browser.newContext({viewport:{width:1280,height:1050}}),report={root,checks:[],errors:[],warnings:[],externalRequests:[]};
context.on('page',p=>{p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(['warning','error'].includes(m.type()))report.warnings.push(m.text());});p.on('request',r=>{if(!r.url().startsWith(base+'/')&&!/^(blob|data):/.test(r.url()))report.externalRequests.push(r.url());});});
const pass=name=>{report.checks.push(name);console.log('PASS',name);},ready=p=>p.waitForFunction(()=>window.editorReady,null,{timeout:45000});
async function selectObject(p,type,double,file){
  const document=new HwpDocument(await readFile(file));let tree;
  try{tree=JSON.parse(document.getPageRenderTree(0));}finally{document.free();}
  const nodes=[];function visit(n){if(n.type===type)nodes.push(n);for(const c of n.children||[])visit(c);}visit(tree);
  assert.equal(nodes.length,1,'The fixture must contain exactly one '+type);
  const canvas=p.frameLocator('#editor iframe').locator('#scroll-container canvas').first(),rect=await canvas.evaluate(el=>{const b=el.getBoundingClientRect();return {width:b.width,height:b.height};}),b=nodes[0].bbox;
  await canvas.click({position:{x:(b.x+b.w/2)*rect.width/tree.bbox.w,y:(b.y+b.h/2)*rect.height/tree.bbox.h},clickCount:double?2:1});
}
async function save(p,revision){await p.getByRole('button',{name:'결과 파일 저장',exact:true}).click();await p.locator(`#delivery[data-revision="${revision}"]`).waitFor();}
const acknowledge=p=>p.waitForFunction(()=>{const revision=localStudio.element.contentWindow.rhwpStudio.localRecovery.read(Number.MAX_SAFE_INTEGER).revision;return revision>0&&revision===Number(document.querySelector('#status').dataset.savedRevision);});
async function command(f,label){await f.locator('#menu-bar').getByText('편집',{exact:true}).click();await f.locator('#menu-bar').getByText(label,{exact:true}).click();}
function outside(d){return {text:d.getTextFileUnicode(true),table:d.getTableProperties(0,4,0),cells:[0,1].map(i=>d.getCellProperties(0,4,0,i)),footnote:d.getFootnoteInfo(0,3,0),header:d.getHeaderFooter(0,true,0),images:[...unzip(Buffer.from(d.exportHwpx()))].filter(([name])=>name.startsWith('BinData/')).map(([,bytes])=>digest(bytes)).sort()};}
function check(source,result,expected){
  const picture=JSON.parse(result.getPictureProperties(0,1,0)),beforePicture=JSON.parse(source.getPictureProperties(0,1,0));assert.equal(picture.width,4252);assert.equal(picture.height,3402);delete picture.width;delete picture.height;delete beforePicture.width;delete beforePicture.height;assert.deepEqual(picture,beforePicture);
  const equation=JSON.parse(result.getEquationProperties(0,2,0,-1,0)),beforeEquation=JSON.parse(source.getEquationProperties(0,2,0,-1,0));for(const [key,value] of Object.entries(expected))assert.equal(equation[key],value,key);for(const key of ['width','height','script','fontSize','color']){delete equation[key];delete beforeEquation[key];}assert.deepEqual(equation,beforeEquation);assert.deepEqual(outside(result),outside(source));
}
try{
  await new Promise((resolve,reject)=>{let stderr='';child.stderr.on('data',v=>stderr+=v);const timer=setTimeout(()=>reject(Error('Server startup timeout: '+stderr)),10000);child.once('error',reject);child.once('exit',code=>reject(Error('Server exited '+code+': '+stderr)));child.stdout.once('data',()=>{clearTimeout(timer);resolve();});});
  for(const entry of workspace.documents){
    const source=new HwpDocument(await readFile(entry.source)),p=await context.newPage(),f=p.frameLocator('#editor iframe');let revision=0;
    async function verify(expected){const bytes=await readFile(entry.output),result=new HwpDocument(bytes);try{check(source,result,expected);assert.equal(result.getSourceFormat(),entry.format);}finally{result.free();}const receipt=JSON.parse(await readFile(entry.output+'.receipt.json'));assert.equal(receipt.contentLoss.count,0);assert.equal(receipt.outputSha256,digest(bytes));assert.equal(digest(await readFile(entry.source)),entry.sourceSha256);}
    try{
      await p.goto(base+'/editor?id='+entry.id);await ready(p);await selectObject(p,'Image',false,entry.source);await f.getByRole('button',{name:'개체 속성',exact:true}).click();
      assert.equal(await f.getByRole('spinbutton',{name:'개체 너비(mm)',exact:true}).count(),1,'Object width needs a named browser control');assert.equal(await f.getByRole('spinbutton',{name:'개체 높이(mm)',exact:true}).count(),1);pass(entry.format+' picture size controls are named');
      await f.getByRole('checkbox',{name:'비율 유지',exact:true}).uncheck();await f.getByRole('spinbutton',{name:'개체 너비(mm)',exact:true}).fill('15');await f.getByRole('spinbutton',{name:'개체 높이(mm)',exact:true}).fill('12');await f.getByRole('button',{name:'설정(D)',exact:true}).click();
      await selectObject(p,'Equation',false,entry.source);await f.getByRole('button',{name:'개체 속성',exact:true}).click();await f.getByRole('button',{name:'수식',exact:true}).click();assert.equal(await f.getByRole('spinbutton',{name:'수식 속성 글자 크기(pt)',exact:true}).inputValue(),'11.5','The separate equation-properties dialog must also preserve fractional font size');await f.getByRole('button',{name:'설정(D)',exact:true}).click();pass(entry.format+' equation properties confirmation retains fractional font size');
      await selectObject(p,'Equation',true,entry.source);assert.equal(await f.getByRole('textbox',{name:'수식 스크립트',exact:true}).count(),1,'Equation script needs a named browser control');assert.equal(await f.getByRole('spinbutton',{name:'수식 글자 크기(pt)',exact:true}).inputValue(),'11.5','Opening an equation must retain fractional font size');
      const script='a sup 2 + b sup 2 = c sup 2';await f.getByRole('textbox',{name:'수식 스크립트',exact:true}).fill(script);await f.getByRole('button',{name:'확인',exact:true}).click();await save(p,++revision);await verify({script,fontSize:1150,color:0});pass(entry.format+' picture resize and script edit preserve original font, image bytes and unrelated content');
      await command(f,'되돌리기');await save(p,++revision);await verify({script:'x sup 2 + y sup 2 = z sup 2',fontSize:1150,color:0});pass(entry.format+' equation undo preserves prior picture resize');
      await command(f,'다시 실행');await acknowledge(p);await p.reload();await ready(p);await save(p,++revision);await verify({script,fontSize:1150,color:0});pass(entry.format+' redo and journal recovery retain both object edits');
      await selectObject(p,'Equation',true,entry.output);await f.getByRole('spinbutton',{name:'수식 글자 크기(pt)',exact:true}).fill('12.5');await f.getByLabel('수식 글자색',{exact:true}).fill('#003366');await f.getByRole('button',{name:'확인',exact:true}).click();await acknowledge(p);await p.reload();await ready(p);await save(p,++revision);await verify({script,fontSize:1250,color:0x663300});pass(entry.format+' fractional equation size and color survive recovery and save');
      await p.goto(base+'/editor?id='+entry.id+'&result=1');await ready(p);await selectObject(p,'Equation',true,entry.output);assert.equal(await f.getByRole('textbox',{name:'수식 스크립트',exact:true}).inputValue(),script);assert.equal(await f.getByRole('spinbutton',{name:'수식 글자 크기(pt)',exact:true}).inputValue(),'12.5');assert.equal(await f.getByLabel('수식 글자색',{exact:true}).inputValue(),'#003366');await f.getByRole('button',{name:'취소',exact:true}).click();await p.screenshot({path:path.join(root,'saved-'+entry.format+'.png')});pass(entry.format+' saved disk result reopens with intended equation properties');
    }finally{source.free();await p.close();}
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.warnings,[]);assert.deepEqual(report.externalRequests,[]);pass('no browser errors, warnings or external requests');
}finally{await writeFile('test-results/special-object-browser.json',json(report,null,2));await browser.close();if(!child.killed){child.kill();await new Promise(resolve=>child.once('close',resolve));}}
