import {readFile,readdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export async function sourceVersion(root) {
  const hash=createHash('sha256').update(await readFile(path.join(root,'patches/rhwp-local.patch')));
  async function walk(directory) {
    for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const file=path.join(directory,entry.name);hash.update(path.relative(root,file));
      if(entry.isDirectory())await walk(file);else hash.update(await readFile(file));
    }
  }
  await walk(path.join(root,'overlay'));return hash.digest('hex');
}

export async function assertCurrentBuild(root) {
  try {
    const [info,pin,version]=await Promise.all([
      readFile(path.join(root,'.build/build-info.json'),'utf8').then(JSON.parse),
      readFile(path.join(root,'upstream.json'),'utf8').then(JSON.parse),sourceVersion(root),
    ]);
    if(info.schemaVersion!==1 || info.sourceVersion!==version || info.upstreamCommit!==pin.commit || info.wasmBindgen!==pin.wasmBindgen)throw new Error('Stale build.');
    await Promise.all(['core/rhwp.js','core/rhwp_bg.wasm','studio/index.html','sdk/index.js'].map(file=>access(path.join(root,'.build',file))));
  } catch {
    throw new Error('Editor build is missing or stale. Run npm run build before opening files. Preserve any older managed build cache when rebuilding.');
  }
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await assertCurrentBuild(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
  console.log('Editor build matches the current pinned source.');
}
