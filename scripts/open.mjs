import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWorkspace} from '../app/workspace.mjs';

const args = process.argv.slice(2);
let output, port = '8766';
const files = [];
for (let index=0;index<args.length;index++) {
  const arg = args[index];
  if (arg === '--output') output = args[++index];
  else if (arg === '--port') port = args[++index];
  else if (arg.startsWith('--')) throw new Error('Unknown option: '+arg);
  else files.push(arg);
}
if (!output || !files.length) throw new Error('Usage: node scripts/open.mjs --output DIRECTORY [--port 8766] FILE.hwp FILE.hwpx ...');
const workspace = await createWorkspace(files,path.resolve(output));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(path.join(root,'local','workspaces'),{recursive:true});
const manifest = path.join(root,'local','workspaces',workspace.id+'.json');
await writeFile(manifest,JSON.stringify(workspace,null,2),{flag:'wx',mode:0o600});
process.env.DOCUMENT_MANIFEST = manifest;
process.env.PORT = port;
console.log(JSON.stringify({workspace:manifest,output:workspace.directory,url:`http://127.0.0.1:${port}/tasks`,documents:workspace.documents.length}));
await import('../app/server.mjs');
