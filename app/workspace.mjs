import {readFile, realpath, mkdir, open, rename, unlink, lstat, link} from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const failure = (status, message) => Object.assign(new Error(message), {status});

export async function createWorkspace(files, outputDirectory) {
  await mkdir(outputDirectory, {recursive:true});
  const directory = await realpath(outputDirectory);
  const documents = [];
  const names = new Set();
  for (const file of files) {
    const source = await realpath(file);
    const format = path.extname(source).slice(1).toLowerCase();
    if (!['hwp','hwpx'].includes(format)) throw new Error('Only HWP/HWPX files can be registered.');
    const name = path.basename(source);
    const stem = path.basename(name,path.extname(name));
    let outputName = `${stem}_수정본.${format}`;
    if (names.has(outputName.toLowerCase())) outputName = `${stem}_${documents.length+1}_수정본.${format}`;
    names.add(outputName.toLowerCase());
    const output = path.join(directory,outputName);
    try { await lstat(output); throw new Error('Output already exists. Select a new output directory.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const bytes = await readFile(source);
    documents.push({id:randomUUID(),name,source,sourceSha256:digest(bytes),format,output});
  }
  if (!documents.length) throw new Error('Register at least one document.');
  return {schemaVersion:1,id:randomUUID(),directory,documents};
}

export async function loadWorkspace(manifest, inspect) {
  if (!manifest) return null;
  const data = JSON.parse(await readFile(manifest,'utf8'));
  if (data.schemaVersion !== 1 || !Array.isArray(data.documents)) throw new Error('Invalid workspace manifest.');
  const directory = await realpath(data.directory);
  const records = new Map();
  const sources = new Set(await Promise.all(data.documents.map(entry=>realpath(entry.source))));
  const outputs = new Set();
  for (const entry of data.documents) {
    if (!/^[a-f0-9-]{36}$/.test(entry.id) || records.has(entry.id)) throw new Error('Invalid document identity.');
    const source = await realpath(entry.source);
    entry.output = path.resolve(entry.output);
    if (path.dirname(entry.output) !== directory || !['hwp','hwpx'].includes(entry.format)) throw new Error('Invalid output destination.');
    if (sources.has(entry.output) || outputs.has(entry.output) || path.extname(entry.output).toLowerCase() !== '.'+entry.format) throw new Error('Output must be a separate, unique file of the source format.');
    outputs.add(entry.output);
    const bytes = await readFile(source);
    if (digest(bytes) !== entry.sourceSha256) throw new Error('Registered source has changed.');
    let receipt = null;
    try {
      const saved = JSON.parse(await readFile(entry.output+'.receipt.json','utf8'));
      if (saved.id !== entry.id || saved.path !== entry.output || saved.sourceSha256 !== entry.sourceSha256 || !Number.isSafeInteger(saved.revision) || saved.revision < 1 || digest(await readFile(entry.output)) !== saved.outputSha256) throw new Error('Saved result receipt does not match this workspace.');
      receipt = saved;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    records.set(entry.id,{...entry,source,revision:receipt?.revision??0,receipt,queue:Promise.resolve()});
  }
  const record = id => {
    const value = records.get(id);
    if (!value) throw failure(404,'Document is not registered.');
    return value;
  };
  async function sourceBytes(entry) {
    const bytes = await readFile(entry.source);
    if (digest(bytes) !== entry.sourceSha256) throw failure(409,'Source changed after registration. Open a new workspace.');
    return bytes;
  }
  return {
    list: () => [...records.values()].map(({id,name,format,revision,receipt}) => ({id,name,format,revision,receipt})),
    source: async id => sourceBytes(record(id)),
    result: async id => {
      const entry = record(id);
      if (!entry.receipt) throw failure(404,'No verified result has been saved.');
      const bytes = await readFile(entry.output);
      if (digest(bytes) !== entry.receipt.outputSha256) throw failure(409,'Saved output changed outside this workspace.');
      return {bytes,name:path.basename(entry.output)};
    },
    save: async (id,bytes,expectedRevision,expectedTextSha256) => {
      const entry = record(id);
      const task = entry.queue.catch(()=>{}).then(async () => {
        if (expectedRevision !== entry.revision) throw failure(409,'Another window saved this document. Reopen its result before saving.');
        if (!/^[a-f0-9]{64}$/.test(expectedTextSha256)) throw failure(400,'Expected text fingerprint is required.');
        await sourceBytes(entry);
        const checked = await inspect(bytes);
        if (checked.format !== entry.format || checked.textSha256 !== expectedTextSha256) throw failure(422,'Export did not preserve the current document text or source format.');
        if (await realpath(directory) !== directory) throw failure(409,'Output directory changed.');
        // Each session owns its outputs; never replace a foreign file or follow a symlink.
        try {
          const stat = await lstat(entry.output);
          if (!entry.receipt || !stat.isFile() || stat.isSymbolicLink() || digest(await readFile(entry.output)) !== entry.receipt.outputSha256) throw failure(409,'Output is not owned by this session.');
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const receipt = {id,revision:entry.revision+1,name:path.basename(entry.output),path:entry.output,sourceSha256:entry.sourceSha256,outputSha256:digest(bytes),textSha256:checked.textSha256,pageCount:checked.pageCount,validation:'engine-reopen-text-and-format',savedAt:new Date().toISOString()};
        const temporary = path.join(directory,`.${entry.id}-${randomUUID()}.tmp`);
        try {
          const handle = await open(temporary,'wx',0o600);
          try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
          if (entry.receipt) await rename(temporary,entry.output);
          // Hard-link publication is atomic and fails if a foreign output appeared.
          else await link(temporary,entry.output);
        } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
        entry.revision = receipt.revision;
        entry.receipt = receipt;
        const receiptPath = entry.output+'.receipt.json';
        const receiptTemporary = temporary+'.receipt';
        const handle = await open(receiptTemporary,'wx',0o600);
        try { await handle.writeFile(JSON.stringify(receipt,null,2));await handle.sync(); }
        finally { await handle.close(); }
        await rename(receiptTemporary,receiptPath);
        return receipt;
      });
      entry.queue = task;
      return task;
    },
  };
}
