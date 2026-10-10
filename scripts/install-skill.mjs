import {mkdir,readFile,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const skill=await readFile(path.join(root,'skills/hwp-agent-edit/SKILL.md'),'utf8');
const args=process.argv.slice(2);
if(args.some(arg=>!['--codex-only','--replace'].includes(arg)))throw new Error('Usage: node scripts/install-skill.mjs [--codex-only] [--replace]');
const replace=args.includes('--replace');
const homes=[process.env.CODEX_HOME||path.join(process.env.HOME,'.codex')];
if(!args.includes('--codex-only'))homes.push(path.join(process.env.HOME,'.claude'));
for(const home of homes){
  const directory=path.join(home,'skills/hwp-agent-edit');
  const target=path.join(directory,'SKILL.md');
  try{
    const pointer=await readFile(path.join(directory,'repository.txt'),'utf8');
    if(pointer!==root+'\n'){if(!replace)throw new Error('An existing skill points to another repository ('+pointer.trim()+'). Preserve it and choose its checkout, or pass --replace.');console.log('Replacing skill that pointed to '+pointer.trim());}
  }catch(error){if(error.code!=='ENOENT')throw error;try{await readFile(target);throw new Error('Existing skill has no repository pointer.');}catch(existing){if(existing.code!=='ENOENT')throw existing;}}
  await mkdir(directory,{recursive:true});
  await writeFile(target,skill);
  await writeFile(path.join(directory,'repository.txt'),root+'\n');
  console.log('Installed skill: '+target);
}
