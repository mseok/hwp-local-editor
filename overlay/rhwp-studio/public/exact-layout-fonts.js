let catalogPromise;
const faceBytes = new Map();

async function catalog() {
  catalogPromise ??= Promise.all([
    fetch('/font-catalog.json').then(response => {
      if (!response.ok) throw new Error('간격 계산용 글꼴 목록을 읽지 못했습니다.');
      return response.json();
    }),
    fetch('/native-paint-profile.json').then(response => response.json()),
  ]).then(([snapshot, profile]) => ({
    ...snapshot,
    faces: snapshot.faces.filter(face => !(profile.paintOnlyFaces ?? []).includes(face.family)),
  }));
  return catalogPromise;
}

function readFace(snapshot, face) {
  const key = `${snapshot.revision}:${face.id}`;
  if (!faceBytes.has(key)) {
    // Always use the installed source, never a browser-compatible paint copy.
    faceBytes.set(key, fetch(`/local-font/${encodeURIComponent(face.id)}`).then(async response => {
      if (!response.ok) throw new Error(`간격 계산용 글꼴을 읽지 못했습니다: ${face.family}`);
      return new Uint8Array(await response.arrayBuffer());
    }));
  }
  return faceBytes.get(key);
}

export async function bindExactLayoutFonts(doc, isCurrent = () => true) {
  const requests = JSON.parse(doc.getExactFontRequests()).requests;
  const report = { current: true, bound: 0, missing: [], failures: [] };
  if (!requests.length) return report;
  const snapshot = await catalog();
  const bindings = [];
  for (const request of requests) {
    const faces = snapshot.faces.filter(face => face.family === request.family);
    const slant = request.italic ? 'italic' : 'normal';
    const face = faces.find(face => face.weight === request.weight && (face.slant ?? 'normal') === slant)
      ?? faces.find(face => face.weight === request.weight)
      ?? faces.find(face => face.weight === 400);
    if (!face) { report.missing.push(request.family); continue; }
    bindings.push({ request, bytes: await readFace(snapshot, face) });
  }
  // A file switch while bytes load must not mutate the replacement document.
  if (!isCurrent()) return { ...report, current: false };
  doc.beginBatch();
  try {
    for (const { request, bytes } of bindings) {
      try {
        doc.registerExactFontSource(request.charShapeId, request.languageIndex, bytes, 0);
        report.bound += 1;
      } catch (error) {
        report.failures.push({ family: request.family, reason: String(error) });
      }
    }
  } finally { doc.endBatch(); }
  return report;
}
