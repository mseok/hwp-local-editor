import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createWorkspace,loadWorkspace,digest} from '../app/workspace.mjs';

test('workspace saves independent results and rejects stale, mismatched, or changed inputs',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'hwp-workspace-'));
  try {
    const a=path.join(root,'one.hwp'),b=path.join(root,'two.hwpx');
    await writeFile(a,'source a');await writeFile(b,'source b');
    const data=await createWorkspace([a,b],path.join(root,'out'));
    const manifest=path.join(root,'manifest.json');await writeFile(manifest,JSON.stringify(data));
    const inspect=async bytes=>({format:bytes.toString().includes('hwpx')?'hwpx':'hwp',textSha256:digest(bytes),pageCount:1});
    const work=await loadWorkspace(manifest,inspect),[one,two]=data.documents;
    const payload=Buffer.from('edited hwp'),payload2=Buffer.from('edited hwpx');
    const receipt=await work.save(one.id,payload,0,digest(payload));
    assert.equal(receipt.revision,1);assert.deepEqual(await readFile(a),Buffer.from('source a'));
    assert.deepEqual((await work.result(one.id)).bytes,payload);
    await assert.rejects(work.save(one.id,payload,0,digest(payload)),{status:409});
    await assert.rejects(work.save(two.id,payload,0,digest(payload)),{status:422});
    await assert.rejects(work.save(two.id,payload2,0,digest(payload)),{status:422});
    assert.equal(work.list()[1].revision,0);
    await work.save(two.id,payload2,0,digest(payload2));assert.equal(work.list()[0].revision,1);
    const resumed=await loadWorkspace(manifest,inspect);assert.equal(resumed.list()[1].revision,1);
    assert.deepEqual((await resumed.result(two.id)).bytes,payload2);
    await writeFile(a,'outside change');await assert.rejects(work.source(one.id),{status:409});
    await assert.rejects(work.save(one.id,payload,1,digest(payload)),{status:409});
    await assert.rejects(work.source('not-registered'),{status:404});
  } finally {await rm(root,{recursive:true,force:true});}
});

test('manifest cannot assign an output to another registered source',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'hwp-workspace-'));
  try {
    const a=path.join(root,'a.hwp'),b=path.join(root,'b.hwp');await writeFile(a,'a');await writeFile(b,'b');
    const data=await createWorkspace([a,b],root);data.documents[0].output=data.documents[1].source;
    const manifest=path.join(root,'manifest.json');await writeFile(manifest,JSON.stringify(data));
    await assert.rejects(loadWorkspace(manifest,()=>{}),/separate, unique/);
    assert.equal(await readFile(b,'utf8'),'b');
  } finally {await rm(root,{recursive:true,force:true});}
});

test('registration handles duplicate names and never replaces existing output or symlink',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'hwp-workspace-'));
  try {
    await mkdir(path.join(root,'a'));await mkdir(path.join(root,'b'));
    const a=path.join(root,'a','same.hwp'),b=path.join(root,'b','same.hwp');
    await writeFile(a,'a');await writeFile(b,'b');
    const data=await createWorkspace([a,b],path.join(root,'out'));
    assert.notEqual(data.documents[0].output,data.documents[1].output);
    await symlink(a,data.documents[0].output);
    await assert.rejects(createWorkspace([a],data.directory),/Output already exists/);
    const manifest=path.join(root,'manifest.json');await writeFile(manifest,JSON.stringify(data));
    const work=await loadWorkspace(manifest,async bytes=>({format:'hwp',textSha256:digest(bytes),pageCount:1}));
    await assert.rejects(work.save(data.documents[0].id,Buffer.from('result'),0,digest('result')),{status:409});
    assert.equal(await readFile(a,'utf8'),'a');
  } finally {await rm(root,{recursive:true,force:true});}
});
