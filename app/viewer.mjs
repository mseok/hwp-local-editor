import init, { HwpDocument, version } from '/rhwp.js';
import { saveDraft, loadDraft } from '/drafts.mjs';

const status = document.querySelector('#status');
const retryButton = document.querySelector('#retry');
retryButton.addEventListener('click', () => location.reload());
try {
const { prepareFonts, initializeLocalFonts, fontEnvironment, crispAxisAlignedStrokes, watchThinStrokes } = await import('/fonts.mjs');
const pages = document.querySelector('#pages');
const select = document.querySelector('#documents');
const native = document.querySelector('#native');
const nativeButton = document.querySelector('#native-button');
const previewButton = document.querySelector('#preview-button');
const ctx = document.createElement('canvas').getContext('2d');
globalThis.measureTextWidth = (font, text) => {
  ctx.font = font;
  return ctx.measureText(text).width;
};
const localFonts = await (await fetch('/local-fonts.json')).json();
await initializeLocalFonts();
await init({ module_or_path: '/rhwp_bg.wasm' });
let activeDocument;
let loaded;
let disposeThinStrokes = () => {};
window.previewResult = null;

function showPreview() {
  native.style.display = 'none';
  pages.style.display = 'block';
  nativeButton.hidden = false;
  previewButton.hidden = true;
}

function safeSvg(svg, pageIndex) {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) throw new Error('SVG 문서를 해석할 수 없습니다.');
  parsed.querySelectorAll('script,foreignObject').forEach(node => node.remove());
  // Inline SVGs share the host document's ID space, including clip paths.
  const ids = new Map();
  for (const node of parsed.querySelectorAll('[id]')) {
    const id = node.id;
    const scopedId = `page-${pageIndex}-${id}`;
    ids.set(id, scopedId);
    node.id = scopedId;
  }
  for (const node of parsed.querySelectorAll('*')) {
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.startsWith('on') || ((attr.localName === 'href') && !attr.value.startsWith('data:') && !attr.value.startsWith('#'))) node.removeAttribute(attr.name);
      else {
        let value = attr.value.replace(/url\(\s*['"]?#([^\s)'" ]+)['"]?\s*\)/g, (match, id) => ids.has(id) ? `url(#${ids.get(id)})` : match);
        if (attr.localName === 'href' && value.startsWith('#') && ids.has(value.slice(1))) value = `#${ids.get(value.slice(1))}`;
        node.setAttributeNS(attr.namespaceURI, attr.name, value);
      }
    }
  }
  return document.importNode(parsed.documentElement, true);
}

async function render(bytes, info) {
  showPreview();
  const previousResult = window.previewResult;
  const previousSelection = select.value;
  let candidate;
  status.textContent = `${info.name} 읽는 중…`;
  window.previewResult = null;
  await new Promise(resolve => requestAnimationFrame(resolve));
  try {
    candidate = HwpDocument.openWithFontEnvironment(bytes, fontEnvironment);
    const fontResult = await prepareFonts(candidate, bytes);
    const count = candidate.pageCount();
    const started = performance.now();
    const rendered = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const section = document.createElement('section');
      section.className = 'page';
      const label = document.createElement('p');
      label.className = 'page-label';
      label.textContent = `${i + 1} / ${count}`;
      const paper = document.createElement('div');
      paper.className = 'paper';
      paper.append(safeSvg(candidate.renderPageSvg(i), i));
      section.append(label, paper);
      rendered.append(section);
    }
    await document.fonts.ready;
    activeDocument?.free();
    activeDocument = candidate;
    candidate = undefined;
    loaded = info;
    disposeThinStrokes();
    pages.replaceChildren(rendered);
    disposeThinStrokes = watchThinStrokes(pages, crispAxisAlignedStrokes);
    select.querySelector('[value="local-draft"]')?.remove();
    if (!info.id) {
      const option = new Option(`작업 사본: ${info.name}`, 'local-draft', true, true);
      option.disabled = true;
      select.append(option);
    }
    const editButton = document.querySelector('#edit-button');
    const query = new URL(location.href).searchParams;
    const params = new URLSearchParams(info.id ? {id:info.id} : {draft:info.draftId || 'current'});
    if (!info.id && query.has('id')) {params.set('id',query.get('id'));params.set('revision',query.get('revision')??'0');}
    if (info.id && query.has('result')) params.set('result','1');
    editButton.href = '/editor?'+params;
    const elapsedMs = Math.round(performance.now() - started);
    window.previewResult = { id: info.id, name: info.name, pageCount: count, nativePages: info.nativePages, elapsedMs, rendererVersion: version(), imageCount: pages.querySelectorAll('image').length, localFontCount: localFonts.length, fontResult };
    const comparison = info.nativePages ? ` / 기존 한컴 PDF ${info.nativePages}쪽` : '';
    status.textContent = `${info.name} · 미리보기 ${count}쪽${comparison}`;
    nativeButton.disabled = !info.hasPdf;
    return true;
  } catch (error) {
    candidate?.free();
    window.previewResult = previousResult ?? { error: String(error), name: info.name };
    select.value = loaded?.id ?? previousSelection;
    status.textContent = `파일 열기 실패: ${error.message ?? error}${loaded ? ' · 기존 문서를 유지했습니다.' : ''}`;
    nativeButton.disabled = !loaded?.hasPdf;
    return false;
  }
}

window.loadDocument = async id => {
  const info = documents.find(item => item.id === id);
  if (!info) throw new Error('문서가 목록에 없습니다.');
  select.value = id;
  const response = await fetch(`/document/${id}/${new URL(location.href).searchParams.has('result')?'result':'source'}`);
  if (!response.ok) throw new Error('원본을 읽을 수 없습니다.');
  await render(new Uint8Array(await response.arrayBuffer()), info);
  return window.previewResult;
};
const documents = await (await fetch('/documents.json')).json();
for (const info of documents) {
  const option = document.createElement('option');
  option.value = info.id;
  option.textContent = info.name;
  select.append(option);
}
select.addEventListener('change', () => window.loadDocument(select.value));
document.querySelector('#file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const bytes = await file.arrayBuffer();
    if (await render(new Uint8Array(bytes), { name: file.name })) {
      const id = await saveDraft(file.name, bytes);
      loaded.draftId = id;
      document.querySelector('#edit-button').href = `/editor?draft=${id}`;
    }
  } finally {
    event.target.value = '';
  }
});
nativeButton.addEventListener('click', () => {
  native.src = `/document/${loaded.id}/pdf`;
  native.style.display = 'block';
  pages.style.display = 'none';
  nativeButton.hidden = true;
  previewButton.hidden = false;
});
previewButton.addEventListener('click', showPreview);
const query = new URL(location.href).searchParams;
if (query.has('draft')) {
  const draft = await loadDraft(query.get('draft'));
  if (draft) await render(new Uint8Array(draft.bytes), { name: draft.name, draftId: draft.id || query.get('draft') });
  else status.textContent = '작업 사본이 없습니다. 파일을 선택하세요.';
} else if (documents.length) await window.loadDocument(query.get('document') || documents[0].id);
else status.textContent = '미리볼 HWP/HWPX 파일을 선택하세요.';
} catch (error) {
  status.textContent = `미리보기를 준비하지 못했습니다: ${error.message ?? error}`;
  retryButton.hidden = false;
}
