import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,lstat,realpath,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const source=path.join(root,'skills/hwp-agent-edit');
const install=(home,...args)=>spawnSync(process.execPath,[path.join(root,'scripts/install-skill.mjs'),...args],{env:{...process.env,HOME:home,CODEX_HOME:path.join(home,'.codex')},encoding:'utf8'});
const home=()=>mkdtemp(path.join(os.tmpdir(),'hwp-skill-'));

test('copy install carries SKILL.md, every reference and the repository pointer',async()=>{
  const h=await home(); const run=install(h); assert.equal(run.status,0,run.stderr);
  for(const client of ['.codex','.claude']){
    const dir=path.join(h,client,'skills/hwp-agent-edit');
    assert.equal(await readFile(path.join(dir,'SKILL.md'),'utf8'),await readFile(path.join(source,'SKILL.md'),'utf8'));
    const wanted=(await readdir(path.join(source,'references'))).filter(name=>name.endsWith('.md')).sort();
    assert.ok(wanted.length>0); assert.deepEqual((await readdir(path.join(dir,'references'))).sort(),wanted);
    for(const name of wanted)assert.equal(await readFile(path.join(dir,'references',name),'utf8'),await readFile(path.join(source,'references',name),'utf8'));
    assert.equal(await readFile(path.join(dir,'repository.txt'),'utf8'),root+'\n');
  }
});

test('every reference the skill names exists',async()=>{
  const text=await readFile(path.join(source,'SKILL.md'),'utf8');
  const named=[...text.matchAll(/\]\((references\/[\w.-]+\.md)\)/g)].map(match=>match[1]);
  assert.ok(named.length>0); for(const name of named)await lstat(path.join(source,name));
});

test('a linked install points at the checkout and a later plain install leaves it alone',async()=>{
  const h=await home(); const dir=path.join(h,'.codex/skills/hwp-agent-edit');
  assert.equal(install(h,'--codex-only','--link').status,0);
  assert.ok((await lstat(dir)).isSymbolicLink()); assert.equal(await realpath(dir),source);
  const again=install(h,'--codex-only'); assert.equal(again.status,0,again.stderr); assert.match(again.stdout,/already linked/);
  assert.ok((await lstat(dir)).isSymbolicLink());
});

test('a link to another folder is refused without --replace and left as it was',async()=>{
  const h=await home(); const other=path.join(h,'other-skill'); await mkdir(other); await writeFile(path.join(other,'SKILL.md'),'other\n');
  const dir=path.join(h,'.codex/skills/hwp-agent-edit'); await mkdir(path.dirname(dir),{recursive:true}); await symlink(other,dir,'dir');
  const run=install(h,'--codex-only'); assert.notEqual(run.status,0); assert.match(run.stderr,/points elsewhere/);
  assert.equal(await readFile(path.join(other,'SKILL.md'),'utf8'),'other\n');
});
