export interface ExactLayoutFontDocument {
  getExactFontRequests(): string;
  registerExactFontSource(charShapeId: number, languageIndex: number, bytes: Uint8Array, faceIndex: number): string;
  beginBatch(): string;
  endBatch(): string;
}
export interface ExactLayoutFontReport {
  current: boolean;
  bound: number;
  missing: string[];
  failures: { family: string; reason: string }[];
}
export function bindExactLayoutFonts(doc: ExactLayoutFontDocument, isCurrent?: () => boolean): Promise<ExactLayoutFontReport>;
