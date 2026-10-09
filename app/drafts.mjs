const database = new Promise((resolve, reject) => {
  // A separate database avoids forcing a reload of an older, unsaved editor tab.
  const request = indexedDB.open('hwp-local-panel-recovery', 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
    db.createObjectStore('metadata');
    db.createObjectStore('operations');
  };
  request.onsuccess = () => {
    request.result.onversionchange = () => request.result.close();
    resolve(request.result);
  };
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('로컬 사본 저장소를 열 수 없습니다.'));
});

const complete = tx => new Promise((resolve, reject) => {
  tx.oncomplete = resolve;
  tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('로컬 저장이 취소되었습니다.'));
});
const result = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function saveDraft(name, bytes, id = crypto.randomUUID()) {
  const db = await database;
  const tx = db.transaction(['drafts', 'metadata'], 'readwrite');
  const done = complete(tx);
  tx.objectStore('drafts').put({ id, name, bytes }, id);
  tx.objectStore('metadata').put({ id, name, revision: 0, hasEdits: true, updatedAt: Date.now() }, id);
  tx.objectStore('metadata').put(id, 'current-id');
  await done;
  return id;
}

export async function createJournalDraft(name, bytes, engineVersion, id, recovered = false) {
  const db = await database;
  const tx = db.transaction(['drafts', 'metadata'], 'readwrite');
  const done = complete(tx);
  tx.objectStore('drafts').put({ id, name, bytes }, id);
  tx.objectStore('metadata').put({ id, name, engineVersion, hasEdits: recovered, revision: 0, snapshotRevision: 0, updatedAt: Date.now() }, id);
  // Opening an unchanged source must not replace the user's latest edited copy.
  if (recovered) tx.objectStore('metadata').put(id, 'current-id');
  await done;
}

export async function appendDraftOperations(id, after, operations) {
  if (!operations.length) return after;
  const db = await database;
  const tx = db.transaction(['operations', 'metadata'], 'readwrite');
  const done = complete(tx);
  const store = tx.objectStore('metadata');
  const request = store.get(id);
  request.onsuccess = () => {
    try {
      const meta = request.result;
      if (!meta?.engineVersion || meta.revision !== after || operations.some((op, i) => op.seq !== after + i + 1)) {
        tx.abort();
        return;
      }
      for (const op of operations) tx.objectStore('operations').add(op, [id, op.seq]);
      store.put({ ...meta, hasEdits: true, revision: operations.at(-1).seq, updatedAt: Date.now() }, id);
      store.put(id, 'current-id');
    } catch {
      tx.abort();
    }
  };
  await done;
  return operations.at(-1).seq;
}

export async function saveDraftSnapshot(id, bytes, revision) {
  const db = await database;
  const tx = db.transaction(['drafts', 'metadata'], 'readwrite');
  const done = complete(tx);
  const request = tx.objectStore('metadata').get(id);
  request.onsuccess = () => {
    const meta = request.result;
    if (!meta || revision > meta.revision) { tx.abort(); return; }
    const base = tx.objectStore('drafts').get(id);
    base.onsuccess = () => {
      tx.objectStore('drafts').put({ ...base.result, snapshot: bytes }, id);
      tx.objectStore('metadata').put({ ...meta, snapshotRevision: revision }, id);
    };
  };
  await done;
}

export async function loadDraft(id = 'current') {
  const currentAlias = id === 'current';
  const db = await database;
  const tx = db.transaction(['drafts', 'metadata', 'operations']);
  const done = complete(tx);
  if (id === 'current') id = await result(tx.objectStore('metadata').get('current-id')) ?? 'current';
  const draft = await result(tx.objectStore('drafts').get(id));
  if (!draft) { await done; return loadLegacyDraft(id); }
  const meta = await result(tx.objectStore('metadata').get(id));
  const operations = meta?.engineVersion
    ? await result(tx.objectStore('operations').getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))) : [];
  await done;
  if (currentAlias && !meta?.hasEdits && !meta?.revision) {
    const legacy = await loadLegacyDraft('current');
    if (legacy) return legacy;
  }
  return { ...draft, ...meta, baseBytes: draft.bytes, bytes: draft.snapshot ?? draft.bytes, operations };
}

async function loadLegacyDraft(id) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('hwp-local-panel', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const draft = await result(db.transaction('drafts').objectStore('drafts').get(id));
    return draft && { ...draft, baseBytes: draft.bytes, operations: [] };
  } finally { db.close(); }
}

export async function listDrafts() {
  const db = await database;
  const entries = await result(db.transaction('metadata').objectStore('metadata').getAll());
  return entries.filter(item => item && typeof item === 'object' && item.id).sort((a, b) => b.updatedAt - a.updatedAt);
}
