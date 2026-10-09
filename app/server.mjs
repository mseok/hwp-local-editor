import http from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadWorkspace,digest} from './workspace.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const built=path.resolve(root,'../.build');
const port=Number(process.env.PORT ?? 8766);
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('PORT must be between 1024 and 65535.');
let engine;
async function inspect(bytes) {
  if (!engine) {
    engine = await import('../.build/core/rhwp.js');
    engine.initSync({module:await readFile(path.join(built,'core/rhwp_bg.wasm'))});
  }
  let document;
  try {
    document = new engine.HwpDocument(bytes);
    const text = JSON.parse(document.getTextFileUnicode());
    return {format:document.getSourceFormat(),pageCount:document.pageCount(),textSha256:digest(typeof text === 'string' ? text : JSON.stringify(text))};
  } catch { throw Object.assign(new Error('Export could not be reopened by the editing engine.'),{status:422}); }
  finally { document?.free(); }
}
const workspace=await loadWorkspace(process.env.DOCUMENT_MANIFEST,inspect);
let fontConfig={faces:[]};
if(process.env.FONT_CONFIG) fontConfig=JSON.parse(await readFile(process.env.FONT_CONFIG,'utf8'));
const faces=await Promise.all(fontConfig.faces.map(async(face,i)=>{
  if(typeof face.path!=='string'||typeof face.family!=='string') throw new Error('Font records require family and path.');
  return {...face,id:String(i),path:await realpath(face.path),weight:face.weight ?? 400};
}));
const revision=createHash('sha256').update(JSON.stringify(faces)).digest('hex');
const profile={id:'local-fonts',substitutions:{},crispAxisAlignedStrokes:true,condensedRatioPreserveHeight:true,
  centerTrimWrappedSpaces:true,justifyTrimWrappedSpaces:true,centerRestoreNegativeTracking:true,
  centerTrimPositiveTracking:true,bulletPreservePositiveIndent:true,leftPreserveFittingWrapText:true};
const routes=new Map([
  ['/',[root,'index.html']],['/editor',[root,'editor.html']],['/tasks',[root,'tasks.html']],
  ...['viewer.mjs','fonts.mjs','drafts.mjs','editor.mjs','tasks.mjs'].map(name=>['/'+name,[root,name]]),
  ['/rhwp.js',[built,'core/rhwp.js']],['/rhwp_bg.wasm',[built,'core/rhwp_bg.wasm']],
  ['/editor-sdk.js',[built,'sdk/index.js']],['/transport.js',[built,'sdk/transport.js']],
  ['/document-agent-contract.js',[built,'sdk/document-agent-contract.js']],
]);
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json'};
const json=(res,data)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'self'; frame-ancestors 'self'");
  if(!['GET','POST'].includes(req.method)||![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(403).end();return;}
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    const documentRoute=url.pathname.match(/^\/document\/([a-f0-9-]{36})\/(source|result)$/);
    if(req.method==='POST'){
      if(!workspace||!documentRoute||documentRoute[2]!=='result'||req.headers.origin!==`http://${req.headers.host}`||req.headers['content-type']!=='application/octet-stream'){res.writeHead(403).end();return;}
      const chunks=[];let length=0;
      for await(const chunk of req){length+=chunk.length;if(length>128*1024*1024)throw Object.assign(new Error('Export exceeds 128 MiB.'),{status:413});chunks.push(chunk);}
      const receipt=await workspace.save(documentRoute[1],Buffer.concat(chunks),Number(req.headers['x-output-revision']),req.headers['x-expected-text-sha256']);
      return json(res,receipt);
    }
    if(url.pathname==='/documents.json') return json(res,workspace?.list()??[]);
    if(documentRoute&&workspace){
      const output=documentRoute[2]==='result';
      const item=output?await workspace.result(documentRoute[1]):{bytes:await workspace.source(documentRoute[1])};
      res.setHeader('Content-Type','application/octet-stream');
      if(output)res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`);
      res.end(item.bytes);return;
    }
    if(url.pathname==='/native-paint-profile.json') return json(res,profile);
    if(url.pathname==='/local-fonts.json') return json(res,[...new Set(faces.map(f=>f.family))]);
    if(url.pathname==='/font-catalog.json') return json(res,{revision,faces:faces.map(({path,...f})=>f)});
    if(url.pathname.startsWith('/local-font/')){
      const id=url.pathname.slice('/local-font/'.length);
      const face=faces.find(f=>f.id===id);
      if(!face){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',types[path.extname(face.path)]||'application/octet-stream');
      res.end(await readFile(face.path));return;
    }
    let entry=routes.get(url.pathname);
    if(url.pathname.startsWith('/rhwp/')) entry=[path.join(built,'studio'),url.pathname==='/rhwp/'?'index.html':decodeURIComponent(url.pathname.slice(6))];
    if(!entry){res.writeHead(404).end();return;}
    const target=path.resolve(entry[0],entry[1]);
    if(!target.startsWith(path.resolve(entry[0])+path.sep)){res.writeHead(403).end();return;}
    const canonical=await realpath(target);
    if(!canonical.startsWith(await realpath(entry[0])+path.sep)){res.writeHead(403).end();return;}
    res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');
    res.end(await readFile(canonical));
  }catch(error){res.writeHead(error.status??(error.code==='ENOENT'?404:500)).end(error.status?error.message:'Resource unavailable.');}
});
server.listen(port,'127.0.0.1',()=>console.log(`HWP Local Editor: http://127.0.0.1:${port}/editor`));
