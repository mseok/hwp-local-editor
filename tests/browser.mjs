import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH||import.meta.url);
const {chromium}=require('playwright');
const base=process.env.TEST_URL||'http://127.0.0.1:8766';
const blank=await readFile('.cache/rhwp/saved/blank2010.hwp');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined});
const context=await browser.newContext({viewport:{width:1200,height:950},acceptDownloads:true});
const report={checks:[],errors:[],externalRequests:[]};
const pass=name=>{report.checks.push(name);console.log('PASS',name);};
context.on('page',page=>{page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());page.on('request',r=>{if(!r.url().startsWith(base+'/')&&!/^(blob|data):/.test(r.url()))report.externalRequests.push(r.url());});});
const ready=(p,name)=>p.waitForFunction(name=>window.editorReady&&(!name||document.querySelector('#status').textContent.split(' · ')[0]===name),name,{timeout:45000});
const text=p=>p.evaluate(async()=>new DOMParser().parseFromString(await localStudio.getPageSvg(0),'image/svg+xml').documentElement.textContent.replace(/\s+/g,''));
const edit=async(p,marker)=>{await p.frameLocator('#editor iframe').locator('.document-page-canvas').first().click({position:{x:160,y:110}});await p.keyboard.insertText(marker);await p.waitForFunction(()=>Number(document.querySelector('#status').dataset.changeRevision)>0);await p.evaluate(()=>localAutosave.flush());};
const download=async p=>{const pending=p.waitForEvent('download');await p.locator('#save').click();const file=await pending;return {bytes:await readFile(await file.path()),name:file.suggestedFilename()};};
try{
  const a=await context.newPage();await a.goto(base+'/editor');await a.waitForFunction(()=>window.localStudio);
  const generated=await a.evaluate(async bytes=>{
    const {default:init,HwpDocument}=await import('/rhwp.js');await init({module_or_path:'/rhwp_bg.wasm'});
    const doc=new HwpDocument(new Uint8Array(bytes));doc.createBlankDocument();doc.insertText(0,0,0,'Synthetic public test document');const output=Array.from(doc.exportHwpx());doc.free();return output;
  },Array.from(blank));
  const source=Buffer.from(generated);
  await a.locator('#file').setInputFiles({name:'synthetic.hwpx',mimeType:'application/octet-stream',buffer:source});await ready(a,'synthetic.hwpx');
  assert.deepEqual((await download(a)).bytes,source);pass('unchanged download preserves source bytes');
  await edit(a,'AUTOSAVE_A');assert.ok((await text(a)).includes('AUTOSAVE_A'));
  assert.equal(await a.evaluate(()=>localStudio.element.contentWindow.rhwpStudio.localRecovery.metrics().exports),0);pass('automatic journal save performs no full-document export');
  const before=await text(a),oldId=a.url();await a.reload();await ready(a);assert.equal(await text(a),before);assert.notEqual(a.url(),oldId);pass('journal restores edited text and forks a new working-copy ID');
  const b=await context.newPage();await b.goto(a.url());await ready(b);await edit(a,'ONLY_A');await edit(b,'ONLY_B');
  await Promise.all([a.reload(),b.reload()]);await Promise.all([ready(a),ready(b)]);
  assert.ok((await text(a)).includes('ONLY_A'));assert.ok(!(await text(a)).includes('ONLY_B'));
  assert.ok((await text(b)).includes('ONLY_B'));assert.ok(!(await text(b)).includes('ONLY_A'));pass('two document windows remain independent');
  const exported=await download(a);assert.match(exported.name,/\.hwpx$/);
  const c=await context.newPage();await c.goto(base+'/editor');await c.waitForFunction(()=>window.localStudio);await c.locator('#file').setInputFiles({name:exported.name,mimeType:'application/octet-stream',buffer:exported.bytes});await ready(c,exported.name);assert.equal(await text(c),await text(a));pass('downloaded edited HWPX reopens');
  await c.evaluate(()=>localStudio.commands.execute('edit:undo'));await c.evaluate(()=>localAutosave.flush());
  const preview=await context.newPage();await preview.goto(base+'/?draft='+await a.evaluate(()=>localAutosave.state().draftId));await preview.waitForFunction(()=>window.previewResult?.pageCount);assert.equal(await preview.locator('.page').count(),1);pass('local viewer renders downloaded working-copy snapshot');
  await c.locator('#file').setInputFiles({name:'synthetic.hwp',mimeType:'application/octet-stream',buffer:blank});await ready(c,'synthetic.hwp');await edit(c,'LEGACY_HWP');const legacy=await download(c);assert.match(legacy.name,/\.hwp$/);await c.locator('#file').setInputFiles({name:legacy.name,mimeType:'application/octet-stream',buffer:legacy.bytes});await ready(c,legacy.name);assert.ok((await text(c)).includes('LEGACY_HWP'));pass('edited HWP downloads and reopens as HWP');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);pass('no page errors or external runtime requests');
  await a.screenshot({path:'test-results/public-editor.png'});
}finally{
  await mkdir('test-results',{recursive:true});await writeFile('test-results/browser.json',JSON.stringify(report,null,2));await browser.close();
}
