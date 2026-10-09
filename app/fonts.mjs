const localFonts = await (await fetch('/local-fonts.json')).json();
import {bindExactLayoutFonts} from '/rhwp/exact-layout-fonts.js';
const {paintOnlyFaces = [], browserPaintFonts = {}, browserPaintFontWeights = {}, ...paintProfile} = await (await fetch('/native-paint-profile.json')).json();
const metricFonts = localFonts.filter(name => !paintOnlyFaces.includes(name));
export const crispAxisAlignedStrokes = Boolean(paintProfile.crispAxisAlignedStrokes);
export const fontEnvironment = JSON.stringify({
  ...paintProfile,
  substitutions: {
    ...Object.fromEntries(metricFonts.map(name => [name, name])),
    ...paintProfile.substitutions,
  },
  trueTypeFaces: metricFonts,
});

let localFontsReady;
export function initializeLocalFonts() {
  localFontsReady ??= (async () => {
    const catalog = await (await fetch('/font-catalog.json')).json();
    // Use the editor's byte-backed FontFace path and bound decode concurrency.
    for (const record of catalog.faces) {
      const response = await fetch(browserPaintFonts[record.family] ?? `/local-font/${record.id}`);
      if (!response.ok) throw new Error(`로컬 글꼴을 읽지 못했습니다: ${record.family}`);
      const bytes = await response.arrayBuffer();
      const face = new FontFace(record.family, bytes, {weight:browserPaintFontWeights[record.family] ?? String(record.weight)});
      await face.load();
      document.fonts.add(face);
    }
  })();
  return localFontsReady;
}

export async function prepareFonts(doc) {
  await initializeLocalFonts();
  await Promise.all(localFonts.flatMap(name => [400, 700].map(weight => document.fonts.load(`${weight} 12px "${name}"`))));
  doc.setFontEnvironment(fontEnvironment);
  const exactLayoutFonts = await bindExactLayoutFonts(doc);
  return { installedFaces: localFonts.length, exactLayoutFonts };
}

// Match Canvas's minimum device-pixel stroke without changing document geometry.
export function watchThinStrokes(root, enabled) {
  if (!enabled) return () => {};
  const svgs = Array.from(root.querySelectorAll('svg'));
  const strokes = Array.from(root.querySelectorAll('svg line[shape-rendering="crispEdges"]'), line => ({
    line,
    svg: line.ownerSVGElement,
    width: Number(line.getAttribute('stroke-width')),
    x1: Number(line.getAttribute('x1')),
    x2: Number(line.getAttribute('x2')),
    y1: Number(line.getAttribute('y1')),
    y2: Number(line.getAttribute('y2')),
  }));
  const refresh = () => {
    const dpr = window.devicePixelRatio || 1;
    // Reserve a whole device-pixel frame without changing the SVG page geometry.
    for (const svg of svgs) {
      const paper = svg.parentElement;
      if (paper?.classList.contains('paper')) {
        paper.style.minHeight = `${Math.ceil(svg.getBoundingClientRect().height * dpr) / dpr}px`;
      }
    }
    for (const stroke of strokes) {
      const {line, svg, width, x1, x2, y1, y2} = stroke;
      const matrix = line.getScreenCTM();
      const pageMatrix = svg.getScreenCTM();
      let paintWidth = width;
      let px1 = x1, px2 = x2, py1 = y1, py2 = y2;
      if (matrix && Math.abs(matrix.b) < 1e-9 && Math.abs(matrix.c) < 1e-9
          && matrix.a > 0 && matrix.d > 0) {
        const vertical = Math.abs(x2 - x1) < 1e-9;
        const horizontal = Math.abs(y2 - y1) < 1e-9;
        const scale = vertical ? matrix.a : matrix.d;
        if ((vertical || horizontal) && width * scale * dpr < 1) {
          paintWidth = 1 / (scale * dpr);
          const snap = (value, scale, offset) =>
            ((Math.round((value * scale + offset) * dpr - 0.5) + 0.5) / dpr - offset) / scale;
          if (vertical) px1 = px2 = snap(x1, matrix.a, matrix.e - pageMatrix.e);
          else py1 = py2 = snap(y1, matrix.d, matrix.f - pageMatrix.f);
        }
      }
      line.setAttribute('stroke-width', String(paintWidth));
      line.setAttribute('x1', String(px1));
      line.setAttribute('x2', String(px2));
      line.setAttribute('y1', String(py1));
      line.setAttribute('y2', String(py2));
    }
  };
  const observer = new ResizeObserver(refresh);
  for (const svg of svgs) observer.observe(svg);
  window.addEventListener('resize', refresh);
  refresh();
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', refresh);
  };
}
