import { setHostFontProvider } from './core/local-fonts';
import type { HostFontSnapshot } from './core/host-font-provider';
import { REGISTERED_FONTS } from './core/font-loader';

export async function configureLocalFonts(): Promise<string[]> {
  const response = await fetch('/font-catalog.json');
  if (!response.ok) throw new Error('로컬 글꼴 목록을 읽을 수 없습니다.');
  const snapshot: HostFontSnapshot = await response.json();
  const paintProfileResponse = await fetch('/native-paint-profile.json');
  if (!paintProfileResponse.ok) throw new Error('로컬 글꼴 표시 설정을 읽을 수 없습니다.');
  const { browserPaintFonts = {}, browserPaintFontWeights = {} } = await paintProfileResponse.json() as {
    browserPaintFonts?: Record<string, string>;
    browserPaintFontWeights?: Record<string, string>;
  };
  const provider = {
    async getSnapshot() { return snapshot; },
    async readFace(id: string, revision: string, signal?: AbortSignal) {
      const record = snapshot.faces.find(face => face.id === id);
      if (revision !== snapshot.revision || !record) {
        throw new Error('글꼴 목록이 변경되었습니다.');
      }
      // The compatible cubic program retains the installed metrics and cmap.
      const url = browserPaintFonts[record.family] ?? `/local-font/${encodeURIComponent(id)}`;
      const result = await fetch(url, { signal });
      if (!result.ok) throw new Error('로컬 글꼴을 읽을 수 없습니다.');
      return { bytes: await result.arrayBuffer(), faceIndex: 0 };
    },
    subscribe() { return () => {}; },
  };
  await setHostFontProvider(provider);
  // Canvas's first draw must use loaded glyph fonts, including noncritical headings.
  for (const record of snapshot.faces) {
    const { bytes } = await provider.readFace(record.id, snapshot.revision);
    const face = new FontFace(record.family, bytes, {
      weight: browserPaintFontWeights[record.family] ?? String(record.weight ?? 400), style: record.slant ?? 'normal',
    });
    await face.load();
    document.fonts.add(face);
    // A verified compatible program must not be replaced by the legacy fallback.
    if (browserPaintFonts[record.family]) REGISTERED_FONTS.add(record.family);
  }
  return [...new Set(snapshot.faces.map(face => face.family))];
}
