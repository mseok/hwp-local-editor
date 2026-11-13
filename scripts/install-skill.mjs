// Installs skills/hwp-agent-edit (SKILL.md and references/) for Codex and Claude Code. This checkout is the only source of the
// skill: the default copies it, --link links the installed folder to the checkout so the two can never differ.
import {mkdir,readFile,writeFile,realpath,lstat,readdir,copyFile,rm,symlink,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const source=path.join(root,'skills/hwp-agent-edit');
const args=process.argv.slice(2);
if(args.some(arg=>!['--codex-only','--replace','--link'].includes(arg)))throw new Error('Usage: node scripts/install-skill.mjs [--codex-only] [--replace] [--link]');
const replace=args.includes('--replace'),link=args.includes('--link');
const homes=[process.env.CODEX_HOME||path.join(process.env.HOME,'.codex')];
if(!args.includes('--codex-only'))homes.push(path.join(process.env.HOME,'.claude'));
const missing=error=>{if(error.code==='ENOENT')return null;throw error;};
for(const home of homes){
  const directory=path.join(home,'skills/hwp-agent-edit');
  const stat=await lstat(directory).catch(missing);
  if(stat?.isSymbolicLink()){
    const target=await realpath(directory).catch(missing);
    if(target===source){await writeFile(path.join(source,'repository.txt'),root+'\n');console.log('Skill already linked to this checkout: '+directory);continue;}
    if(!replace)throw new Error('An existing skill link points elsewhere ('+(target??'a missing target')+'). Preserve it, or pass --replace.');
    console.log('Replacing skill link that pointed to '+(target??'a missing target'));
    await unlink(directory);
  }else if(stat){
    const pointer=await readFile(path.join(directory,'repository.txt'),'utf8').catch(missing);
    if(pointer===null){if(await readFile(path.join(directory,'SKILL.md')).catch(missing)!==null)throw new Error('Existing skill has no repository pointer.');}
    else if(pointer!==root+'\n'){if(!replace)throw new Error('An existing skill points to another repository ('+pointer.trim()+'). Preserve it and choose its checkout, or pass --replace.');console.log('Replacing skill that pointed to '+pointer.trim());}
    if(link)await rm(directory,{recursive:true});
  }
  if(link){
    await mkdir(path.dirname(directory),{recursive:true});
    await symlink(source,directory,'dir');
    await writeFile(path.join(source,'repository.txt'),root+'\n');
    console.log('Linked skill: '+directory+' -> '+source);
    continue;
  }
  const references=path.join(directory,'references');
  await mkdir(references,{recursive:true});
  await copyFile(path.join(source,'SKILL.md'),path.join(directory,'SKILL.md'));
  const wanted=(await readdir(path.join(source,'references'))).filter(name=>name.endsWith('.md'));
  for(const name of await readdir(references))if(!wanted.includes(name))await rm(path.join(references,name),{recursive:true});
  for(const name of wanted)await copyFile(path.join(source,'references',name),path.join(references,name));
  await writeFile(path.join(directory,'repository.txt'),root+'\n');
  console.log('Installed skill: '+path.join(directory,'SKILL.md'));
}
