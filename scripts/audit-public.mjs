import {execFileSync} from 'node:child_process';
import {readFile,lstat} from 'node:fs/promises';
const files=execFileSync('git',['ls-files','--cached','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
if(!files.length) throw new Error('Stage the intended release files before auditing.');
const allowed=/^(?:app\/[\w.-]+\.(?:mjs|html)|scripts\/[\w.-]+\.mjs|tools\/[\w.-]+\.swift|tests\/[\w.-]+\.mjs|skills\/hwp-agent-edit\/SKILL\.md|overlay\/rhwp-studio\/(?:src\/[\w/.-]+\.ts|public\/exact-layout-fonts\.(?:js|d\.ts))|patches\/rhwp-local\.patch|licenses\/[\w.-]+\.(?:txt|md)|docs\/[\w.-]+\.md|(?:upstream|package|font-config\.example)\.json|README\.md|AGENTS\.md|CLAUDE\.md|LICENSE|NOTICE|\.gitignore|\.gitattributes)$/;
const privatePath=/\/(?:Users\/[a-zA-Z0-9_-]+|Volumes\/[^\s'"`]+)\//;
const token=/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{32,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
for(const name of files){
  if(!allowed.test(name)) throw new Error('Unexpected publication path: '+name);
  const stat=await lstat(name);
  if(!stat.isFile()||stat.size>1024*1024) throw new Error('Non-source or oversized release file: '+name);
  const source=await readFile(name,'utf8');
  if(source.includes('\0')||privatePath.test(source)||token.test(source)) throw new Error('Potential private or binary content: '+name);
  if(/font_metrics_installed|HYGTRE-leader-paint|H2HDRM-cubic-paint|HMKMG-HFT-paint/.test(source)&&!name.startsWith('scripts/')) throw new Error('Local extracted font resource: '+name);
}
console.log(`Public release audit passed: ${files.length} staged source/notice files, no document or font binaries.`);
