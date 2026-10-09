import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {initSync,HwpDocument} from '../.build/core/rhwp.js';
await mkdir('test-results/inputs',{recursive:true});
initSync({module:await readFile('.build/core/rhwp_bg.wasm')});
const blank=await readFile('.cache/rhwp/saved/blank2010.hwp');
for (const format of ['hwp','hwpx']) {
  const document=new HwpDocument(blank);
  try {
    document.createBlankDocument();
    document.insertText(0,0,0,'자동 편집 검증 문서');
    document.splitParagraph(0,0,11);
    document.insertText(0,1,0,'참여인원: 3명. 보존할 본문입니다.');
    document.splitParagraph(0,1,22);
    document.createTable(0,2,0,2,2);
    for (const [cell,text] of ['이름','인원','검증용 연구진','참여인원: 3명'].entries()) document.insertTextInCell(0,2,0,cell,0,0,text);
    await writeFile(`test-results/inputs/검증문서.${format}`,format==='hwp'?document.exportHwp():document.exportHwpx());
  } finally {document.free();}
}
console.log('Created two synthetic HWP/HWPX fixtures with body text and a table.');
