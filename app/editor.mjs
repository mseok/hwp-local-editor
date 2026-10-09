import { createStudio } from '/editor-sdk.js';
import { saveDraft, loadDraft, createJournalDraft, appendDraftOperations, saveDraftSnapshot, listDrafts } from '/drafts.mjs';
const status = document.querySelector('#status');
const saveButton = document.querySelector('#save');
const openButton = document.querySelector('#open');
const copies = document.querySelector('#copies');
const resume = document.querySelector('#resume');
let fileName = '문서.hwpx';
let fileFormat = 'hwpx';
let sourceBuffer;
let registeredDocument;
let outputRevision;
const deliverButton = document.querySelector('#deliver');
const delivery = document.querySelector('#delivery');
const replaceButton = document.querySelector('#replace');
const readTextButton = document.querySelector('#read-text');
const query = new URL(location.href).searchParams;
const id = query.get('id');
function draftUrl(draftId) {
  const params = new URLSearchParams({draft:draftId});
  if (registeredDocument) { params.set('id',registeredDocument.id);params.set('revision',String(outputRevision)); }
  return `/editor?${params}`;
}

copies.addEventListener('focus', async () => {
  try {
    const selected = copies.value;
    copies.replaceChildren(new Option('저장된 작업 사본', ''));
    for (const draft of await listDrafts()) {
      const stamp = new Date(draft.updatedAt).toLocaleString('ko-KR');
      copies.add(new Option(`${draft.name} (${stamp})`, draft.id));
    }
    copies.value = selected;
  } catch (error) { status.textContent = `사본 목록을 읽을 수 없습니다: ${error.message}`; }
});
copies.addEventListener('change', () => {
  resume.hidden = !copies.value;
  resume.href = `/editor?draft=${encodeURIComponent(copies.value)}`;
});

try {
  const studio = await createStudio('#editor', {
    studioUrl: new URL('/rhwp/?chrome=embed', location.href).href,
    renderer: 'canvas2d', plugins: ['hwpctrl'],
  });
  window.localStudio = studio;
  window.editorReady = false;
  const recovery = studio.element.contentWindow.rhwpStudio.localRecovery;
  const nativeLoadFile = studio.loadFile.bind(studio);
  let loadQueue = Promise.resolve();
  let changeRevision = 0;
  let savedRevision = 0;
  let documentChanged = false;
  let protectedDocument = false;
  let draftId;
  let documentPages = 0;
  let saveQueue = Promise.resolve();
  let idleTimer;
  let maxTimer;
  let saveFailure = false;
  let journalStarted = false;
  const timerClear = () => { clearTimeout(idleTimer); clearTimeout(maxTimer); idleTimer = maxTimer = undefined; };
  const updateRevision = () => {
    changeRevision = recovery.read(Number.MAX_SAFE_INTEGER).revision;
    status.dataset.changeRevision = String(changeRevision);
    status.dataset.savedRevision = String(savedRevision);
  };
  const savedStatus = () => {
    status.textContent = `${fileName} · ${documentPages}쪽 · 변경 내용 자동 저장됨`;
  };

  async function flushChanges() {
    timerClear();
    const id = draftId;
    const task = saveQueue.catch(() => {}).then(async () => {
      if (!journalStarted || id !== draftId) return;
      const pending = recovery.read(savedRevision);
      if (pending.blocked) throw new Error(pending.blocked);
      if (protectedDocument) throw new Error('보호 문서는 자동 저장하지 않습니다.');
      if (pending.operations.length) {
        const revision = await appendDraftOperations(id, savedRevision, pending.operations);
        if (id !== draftId) return;
        savedRevision = revision;
        recovery.acknowledge(revision);
      }
      saveFailure = false;
      updateRevision();
      // Clean acknowledgement must not hide edits made during a database write.
      if (changeRevision === savedRevision) {
        await studio.notifySaved();
        updateRevision();
        if (changeRevision === savedRevision) savedStatus();
      }
    });
    saveQueue = task;
    try { await task; }
    catch (error) {
      saveFailure = true;
      status.textContent = `자동 저장 실패: ${error.message} 수정본을 다운로드하세요.`;
      throw error;
    }
  }

  function schedule() {
    if (!journalStarted || protectedDocument) return;
    const blocked = recovery.read(Number.MAX_SAFE_INTEGER).blocked;
    if (blocked) {
      saveFailure = true;
      status.textContent = `자동 저장 중단: ${blocked} 수정본을 다운로드하세요.`;
      return;
    }
    updateRevision();
    if (changeRevision === savedRevision) return;
    documentChanged = true;
    status.textContent = `${fileName} · 변경 내용 자동 저장 중…`;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { void flushChanges().catch(() => {}); }, 300);
    if (!maxTimer) maxTimer = setTimeout(() => { void flushChanges().catch(() => {}); }, 1000);
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== studio.element.contentWindow || !window.editorReady) return;
    if (!['local-hwp-journal-changed', 'local-hwp-document-changed'].includes(event.data?.type)) return;
    documentChanged = true;
    if (!journalStarted) changeRevision += 1;
    protectedDocument = event.data.requiresPasswordForSave === true;
    if (protectedDocument) {
      documentChanged = true;
      status.textContent = `${fileName} · 보호 문서는 자동 저장하지 않습니다.`;
      return;
    }
    schedule();
  });
  window.addEventListener('beforeunload', event => {
    if (window.editorReady && (saveFailure || changeRevision !== savedRevision || (protectedDocument && documentChanged))) {
      event.preventDefault(); event.returnValue = '';
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void flushChanges().catch(() => {});
  });

  function load(data, name, draft) {
    const task = loadQueue.catch(() => {}).then(() => loadDocument(data, name, draft));
    loadQueue = task;
    return task;
  }
  // Agent/API file opens use the same document identity and autosave lifecycle as the chooser.
  studio.loadFile = (data, name) => {
    registeredDocument = undefined;outputRevision = undefined;deliverButton.hidden = true;delivery.hidden = true;
    document.querySelector('h1').textContent = 'HWP 패널 편집기';
    return load(data, name);
  };

  async function loadDocument(data, name, draft) {
    await flushChanges();
    if (draft?.engineVersion && draft.operations?.length) {
      if (draft.engineVersion !== recovery.version) throw new Error('복구 기록과 편집기 버전이 다릅니다. 기존 다운로드 파일을 열어주세요.');
      if (draft.revision !== draft.operations.length) throw new Error('복구 기록 일부가 누락되었습니다.');
    }
    const previousReady = window.editorReady;
    let replaced = false;
    window.editorReady = false;
    saveButton.disabled = true;
    openButton.disabled = true;
    deliverButton.disabled = replaceButton.disabled = readTextButton.disabled = true;
    status.textContent = `${name} 읽는 중…`;
    try {
      let result = await nativeLoadFile(data, name, { skipUnsavedGuard: true });
      replaced = true;
      const format = (await studio.commands.context()).sourceFormat;
      if (!['hwp', 'hwpx'].includes(format)) throw new Error('자동 저장은 HWP/HWPX 형식에 지원됩니다.');
      const workingName = /\.(hwp|hwpx)$/i.test(name) ? name : `${name}.${format}`;
      const protectedNext = result.requiresPasswordForSave === true;
      let base = data.slice(0);
      if (draft?.engineVersion && draft.operations?.length) {
        await recovery.replay(draft.operations);
        base = recovery.export(format).bytes.slice().buffer;
        result = await nativeLoadFile(base, name, { skipUnsavedGuard: true });
      }
      fileName = workingName;
      fileFormat = format;
      documentPages = result.pageCount;
      sourceBuffer = base;
      documentChanged = false;
      protectedDocument = protectedNext;
      draftId = crypto.randomUUID();
      savedRevision = changeRevision = 0;
      journalStarted = false;
      saveFailure = false;
      if (!protectedDocument) {
        try {
          await createJournalDraft(workingName, new Uint8Array(base), recovery.version, draftId, Boolean(draft));
          recovery.start();
          journalStarted = true;
          history.replaceState(null, '', draftUrl(draftId));
          savedStatus();
        } catch (error) {
          saveFailure = true;
          status.textContent = `자동 저장을 시작할 수 없습니다: ${error.message} 수동 다운로드는 가능합니다.`;
        }
      } else status.textContent = `${name} · ${documentPages}쪽 · 보호 문서 자동 저장 제외`;
      status.dataset.changeRevision = '0';
      status.dataset.savedRevision = '0';
      window.editorReady = true;
      await studio.notifySaved();
      return result;
    } catch (error) {
      window.editorReady = !replaced && previousReady && await studio.pageCount() > 0;
      if (replaced) { journalStarted = false; saveFailure = true; }
      throw error;
    } finally {
      saveButton.disabled = !window.editorReady;
      deliverButton.disabled = replaceButton.disabled = readTextButton.disabled = !window.editorReady;
      openButton.disabled = false;
    }
  }

  async function persistWorkingCopy() {
    await flushChanges().catch(() => {});
    let bytes;
    if (!documentChanged) bytes = new Uint8Array(sourceBuffer);
    else {
      if (protectedDocument) throw new Error('보호 문서의 암호 유지 저장은 지원하지 않습니다. 원본은 보존됩니다.');
      const exported = recovery.export(fileFormat);
      bytes = exported.bytes;
      await flushChanges().catch(() => {});
      if (journalStarted && !saveFailure) {
        await saveDraftSnapshot(draftId, bytes, exported.revision).catch(error => {
          saveFailure = true;
          console.warn('로컬 사본 저장 실패. 다운로드는 계속합니다.', error);
        });
      }
    }
    if (!journalStarted) {
      try {
        draftId = await saveDraft(fileName, bytes);
        history.replaceState(null, '', draftUrl(draftId));
      } catch { saveFailure = true; }
    }
    return bytes;
  }
  window.localAutosave = { flush: flushChanges, state: () => ({ draftId, changeRevision, savedRevision, saveFailure, journalStarted }) };

  try {
    if (id) {
      const response = await fetch('/documents.json');
      if (!response.ok) throw new Error('작업 목록을 읽지 못했습니다.');
      registeredDocument = (await response.json()).find(item => item.id === id);
      if (!registeredDocument) throw new Error('선택한 문서가 없습니다.');
      outputRevision = query.has('revision') ? Number(query.get('revision')) : registeredDocument.revision;
      if (!Number.isSafeInteger(outputRevision) || outputRevision < 0) throw new Error('잘못된 저장 버전입니다.');
      deliverButton.hidden = false;
      document.querySelector('h1').textContent = registeredDocument.name;
      document.title = registeredDocument.name+' · HWP 패널 편집기';
    }
    if (query.has('draft')) {
      const draft = await loadDraft(query.get('draft'));
      if (!draft) throw new Error('작업 사본이 없습니다.');
      const data = draft.baseBytes instanceof ArrayBuffer ? draft.baseBytes : draft.baseBytes.slice().buffer;
      await load(data, draft.name, draft);
    } else if (id) {
      document.querySelector('#back').href = `/?document=${id}`;
      const response = await fetch(`/document/${id}/${query.has('result')?'result':'source'}`);
      if (!response.ok) throw new Error(await response.text());
      await load(await response.arrayBuffer(), registeredDocument.name);
    } else {
      openButton.disabled = false;
      status.textContent = '편집할 HWP/HWPX 파일을 선택하세요.';
    }
  } catch (error) {
    status.textContent = `파일 열기 실패: ${error.message}`;
    openButton.disabled = false;
  }
  openButton.addEventListener('click', () => document.querySelector('#file').click());
  document.querySelector('#file').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (file) {
      registeredDocument = undefined;outputRevision = undefined;deliverButton.hidden = true;delivery.hidden = true;
      document.querySelector('h1').textContent = 'HWP 패널 편집기';
      try { await load(await file.arrayBuffer(), file.name); }
      catch (error) { status.textContent = `파일 열기 실패: ${error.message}`; }
      finally { event.target.value = ''; }
    }
  });
  async function currentText() {
    const value = await studio.hwpctrl.call('GetTextFile',['UNICODE','']);
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  readTextButton.addEventListener('click',async()=>{
    try {
      document.querySelector('#document-text').textContent = await currentText();
      const panel = document.querySelector('#text-panel');panel.hidden = false;panel.open = true;
    } catch(error) { status.textContent = `텍스트 확인 실패: ${error.message}`; }
  });
  replaceButton.addEventListener('click',async()=>{
    try {
      await studio.commands.execute('edit:find-replace',undefined,{allowDialog:true});
      const dialog = studio.element.contentDocument.querySelector('.find-dialog');
      const inputs = dialog?.querySelectorAll('.find-dialog-input');
      inputs?.[0]?.setAttribute('aria-label','찾을 내용');inputs?.[1]?.setAttribute('aria-label','바꿀 내용');
      dialog?.querySelector('.dialog-close')?.setAttribute('aria-label','찾아 바꾸기 닫기');
    }
    catch(error) { status.textContent = `찾아 바꾸기 실패: ${error.message}`; }
  });
  deliverButton.addEventListener('click',async()=>{
    if (!registeredDocument) return;
    const editorArea = document.querySelector('#editor');
    editorArea.inert = true;
    deliverButton.disabled = saveButton.disabled = openButton.disabled = replaceButton.disabled = readTextButton.disabled = true;
    delivery.hidden = false;delivery.textContent = '결과 파일 검증·저장 중…';
    try {
      const text = await currentText();
      const bytes = await persistWorkingCopy();
      if (await currentText() !== text) throw new Error('저장 도중 문서가 변경되었습니다. 다시 저장하세요.');
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
      const response = await fetch(`/document/${registeredDocument.id}/result`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Output-Revision':String(outputRevision),'X-Expected-Text-Sha256':hash},body:bytes});
      if (!response.ok) throw new Error(await response.text());
      const receipt = await response.json();
      outputRevision = receipt.revision;
      history.replaceState(null,'',draftUrl(draftId));
      delivery.textContent = `결과 저장됨 · ${receipt.pageCount}쪽 · 저장 버전 ${receipt.revision}\n${receipt.path}\n엔진 재열기: 텍스트·형식 일치. 한컴 배치 검수는 별도입니다.`;
      delivery.dataset.revision = String(receipt.revision);
      status.textContent = `${fileName} 결과 파일 저장 완료. 원본은 보존됩니다.`;
    } catch(error) { delivery.textContent = `결과 저장 실패: ${error.message}`; }
    finally { editorArea.inert = false;deliverButton.disabled = saveButton.disabled = openButton.disabled = replaceButton.disabled = readTextButton.disabled = false; }
  });
  document.querySelector('#back').addEventListener('click', async event => {
    if (!window.editorReady) return;
    event.preventDefault();
    try {
      await persistWorkingCopy();
      if (saveFailure) throw new Error('로컬 저장에 실패했습니다. 수정본 다운로드를 사용하세요.');
      const params = new URLSearchParams({draft:draftId});
      if (registeredDocument) {params.set('id',registeredDocument.id);params.set('revision',String(outputRevision));}
      location.href = '/?'+params;
    } catch (error) { status.textContent = `미리보기 준비 실패: ${error.message}`; }
  });
  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    openButton.disabled = true;
    try {
      const bytes = await persistWorkingCopy();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName.replace(/(?:_수정본)?\.(hwp|hwpx)$/i, '_수정본.$1');
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status.textContent = `${link.download} 다운로드를 시작했습니다. 원본은 보존됩니다.`;
    } catch (error) { status.textContent = `저장 실패: ${error.message}`; }
    finally { saveButton.disabled = false; openButton.disabled = false; }
  });
} catch (error) {
  status.textContent = `편집기 초기화 실패: ${error.message}`;
}
