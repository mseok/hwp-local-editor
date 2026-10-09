import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,cp,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceVersion as computeSourceVersion} from './check-build.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pin=JSON.parse(await readFile(path.join(root,'upstream.json'),'utf8'));
const upstream=path.join(root,'.cache/rhwp');
const run=(cmd,args,cwd=upstream,env={})=>execFileSync(cmd,args,{cwd,stdio:'inherit',env:{...process.env,...env}});
await mkdir(path.join(root,'.cache'),{recursive:true});
try{await access(path.join(upstream,'.git'));}catch{
  run('git',['clone','--filter=blob:none','--no-checkout',pin.repository,upstream],root);
  run('git',['sparse-checkout','set','src','crates','bindings/Native','tools/rhwp-subsecond','tools/batch-convert','tools/llm_verifier/verdict_protocol','tools/llm_verifier/claim_bind','tools/llm_verifier/criteria_decomp','rhwp-studio','rhwp-shared','npm','assets','scripts','vendor']);
  run('git',['checkout','--detach',pin.commit]);
}
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:upstream,encoding:'utf8'}).trim();
if(head!==pin.commit) throw new Error('Cached upstream revision differs. Move .cache/rhwp aside and rebuild.');
const sourceVersion=await computeSourceVersion(root);
let applied='';try{applied=await readFile(path.join(upstream,'.local-editor-patch'),'utf8');}catch{}
if(applied!==sourceVersion){
  if(applied) throw new Error('Patch changed. Move .cache/rhwp aside before rebuilding.');
  run('git',['apply','--check',path.join(root,'patches/rhwp-local.patch')]);
  run('git',['apply',path.join(root,'patches/rhwp-local.patch')]);
  await cp(path.join(root,'overlay'),upstream,{recursive:true});
  await writeFile(path.join(upstream,'.local-editor-patch'),sourceVersion);
}
await mkdir(path.join(upstream,'saved'),{recursive:true});
const blankPath=path.join(upstream,'saved/blank2010.hwp');
const blank=execFileSync('git',['show',pin.commit+':saved/blank2010.hwp'],{cwd:upstream});
let currentBlank;try{currentBlank=await readFile(blankPath);}catch{}
if(!currentBlank?.equals(blank)) await writeFile(blankPath,blank);
const cargo=process.env.CARGO_BIN||'cargo', bindgen=process.env.WASM_BINDGEN_BIN||'wasm-bindgen';
const bindgenVersion=execFileSync(bindgen,['--version'],{encoding:'utf8'}).trim();
if(bindgenVersion!==`wasm-bindgen ${pin.wasmBindgen}`) throw new Error(`Install wasm-bindgen-cli ${pin.wasmBindgen}.`);
run(cargo,['build','--locked','--lib','--target','wasm32-unknown-unknown','--profile','release-test','--jobs','2']);
const target=process.env.CARGO_TARGET_DIR?path.resolve(process.env.CARGO_TARGET_DIR):path.join(upstream,'target');
run(bindgen,[path.join(target,'wasm32-unknown-unknown/release-test/rhwp.wasm'),'--target','web','--out-dir',path.join(upstream,'pkg'),'--out-name','rhwp']);
for(const name of ['rhwp.js','rhwp_bg.wasm']) await cp(path.join(upstream,'pkg',name),path.join(upstream,'rhwp-studio/public',name));
const wasmHash=createHash('sha256').update(await readFile(path.join(upstream,'pkg/rhwp_bg.wasm'))).digest('hex');
const main=path.join(upstream,'rhwp-studio/src/main.ts');
await writeFile(main,(await readFile(main,'utf8')).replace(/version: 'local-commands-v1:[^']+'/g,`version: 'local-commands-v1:${sourceVersion}:${wasmHash}'`));
run('npm',['ci','--no-audit','--no-fund'],path.join(upstream,'rhwp-studio'));
run('npm',['run','build','--','--base=/rhwp/'],path.join(upstream,'rhwp-studio'),{RHWP_DISABLE_EXTERNAL_WEBFONTS:'1',RHWP_LOCAL_EDITOR:'1'});
await mkdir(path.join(root,'.build'),{recursive:true});
await cp(path.join(upstream,'rhwp-studio/dist'),path.join(root,'.build/studio'),{recursive:true});
await cp(path.join(upstream,'pkg'),path.join(root,'.build/core'),{recursive:true});
await cp(path.join(upstream,'npm/editor'),path.join(root,'.build/sdk'),{recursive:true});
await writeFile(path.join(root,'.build/build-info.json'),JSON.stringify({schemaVersion:1,sourceVersion,upstreamCommit:pin.commit,wasmBindgen:pin.wasmBindgen}));
console.log('Build complete. Run npm start.');
