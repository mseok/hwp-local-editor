import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sourceVersion,assertCurrentBuild} from '../scripts/check-build.mjs';

test('startup rejects missing engines, changed patches and a different upstream pin',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'hwp-build-'));
  try {
    await assert.rejects(assertCurrentBuild(root),/missing or stale/);
    for(const directory of ['patches','overlay','.build/core','.build/studio','.build/sdk'])await mkdir(path.join(root,directory),{recursive:true});
    const pin={commit:'pinned',wasmBindgen:'0.2.127'};
    await writeFile(path.join(root,'upstream.json'),JSON.stringify(pin));await writeFile(path.join(root,'patches/rhwp-local.patch'),'patch');
    for(const file of ['core/rhwp.js','core/rhwp_bg.wasm','studio/index.html','sdk/index.js'])await writeFile(path.join(root,'.build',file),'fixture');
    const info={schemaVersion:1,sourceVersion:await sourceVersion(root),upstreamCommit:pin.commit,wasmBindgen:pin.wasmBindgen};
    await writeFile(path.join(root,'.build/build-info.json'),JSON.stringify(info));await assertCurrentBuild(root);
    await writeFile(path.join(root,'patches/rhwp-local.patch'),'updated');await assert.rejects(assertCurrentBuild(root),/missing or stale/);
    await writeFile(path.join(root,'patches/rhwp-local.patch'),'patch');
    await writeFile(path.join(root,'upstream.json'),JSON.stringify({...pin,commit:'other'}));await assert.rejects(assertCurrentBuild(root),/missing or stale/);
    await writeFile(path.join(root,'upstream.json'),JSON.stringify(pin));await rm(path.join(root,'.build/core/rhwp_bg.wasm'));
    await assert.rejects(assertCurrentBuild(root),/missing or stale/);
  } finally {await rm(root,{recursive:true,force:true});}
});
