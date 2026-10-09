import { LOCAL_JOURNAL_METHODS } from './local-journal-methods.ts';

export interface LocalOperation {
  seq: number;
  method: string;
  args: unknown[];
  handle?: number;
}

const captures: Record<string, string> = {
  saveSnapshot: 'snapshot', captureDeleteRange: 'delete',
  captureSectionRaw: 'section', capturePictureTransform: 'picture',
};
const handleUses: Record<string, string> = {
  restoreSnapshot: 'snapshot', discardSnapshot: 'snapshot',
  restoreDeleteFragment: 'delete', discardDeleteFragment: 'delete',
  restoreSectionRaw: 'section', discardSectionRaw: 'section',
  swapPictureTransform: 'picture', discardPictureTransform: 'picture',
};

/** Recovery data contains command inputs, never exports or derived page trees. */
export class LocalOperationJournal {
  private enabled = false;
  private seq = 0;
  private operations: LocalOperation[] = [];
  private blocked: string | null = null;
  private nativeHandles = new Map<string, number>();
  readonly metrics = { exports: 0, recordedOperations: 0, overheadMs: 0, maxOverheadMs: 0 };

  constructor(private readonly changed: () => void) {}

  wrap<T extends object>(doc: T): T {
    return new Proxy(doc, {
      get: (target, key) => {
        const value = Reflect.get(target, key, target);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          if (this.enabled && typeof key === 'string' && key.startsWith('export')) this.metrics.exports += 1;
          if (!this.enabled || typeof key !== 'string' || !LOCAL_JOURNAL_METHODS.has(key)) {
            return value.apply(target, args);
          }
          let inputs: unknown[];
          const started = performance.now();
          try { inputs = structuredClone(args); }
          catch { this.blocked = '변경 명령을 기록할 수 없습니다.'; this.changed(); return value.apply(target, args); }
          const use = handleUses[key];
          if (use) {
            const handle = this.nativeHandles.get(`${use}:${inputs[0]}`);
            if (handle === undefined) {
              this.blocked = '실행 취소 복구 기록이 누락되었습니다.';
              this.changed();
              return value.apply(target, args);
            }
            inputs[0] = handle;
          }
          let result: unknown;
          const cloneMs = performance.now() - started;
          try { result = value.apply(target, args); }
          catch (error) {
            this.blocked = '실패한 편집 명령 이후에는 수동 다운로드가 필요합니다.';
            this.changed();
            throw error;
          }
          const entry: LocalOperation = { seq: ++this.seq, method: key, args: inputs };
          const finished = performance.now();
          if (captures[key]) {
            entry.handle = entry.seq;
            this.nativeHandles.set(`${captures[key]}:${result}`, entry.handle);
          }
          this.operations.push(entry);
          this.changed();
          const overhead = cloneMs + performance.now() - finished;
          this.metrics.recordedOperations += 1;
          this.metrics.overheadMs += overhead;
          this.metrics.maxOverheadMs = Math.max(this.metrics.maxOverheadMs, overhead);
          return result;
        };
      },
    });
  }

  start(revision = 0): void {
    if (!Number.isSafeInteger(revision) || revision < 0 || (revision !== 0 && revision !== this.seq)) {
      throw new Error('재생하지 않은 복구 기록에서 이어 쓸 수 없습니다.');
    }
    if (revision === 0) this.nativeHandles.clear();
    this.seq = revision;
    this.operations = [];
    this.blocked = null;
    Object.assign(this.metrics, { exports: 0, recordedOperations: 0, overheadMs: 0, maxOverheadMs: 0 });
    this.enabled = true;
  }

  stop(): void { this.enabled = false; }

  read(after: number): { revision: number; operations: LocalOperation[]; blocked: string | null } {
    return { revision: this.seq, operations: this.operations.filter(op => op.seq > after), blocked: this.blocked };
  }

  acknowledge(revision: number): void {
    this.operations = this.operations.filter(op => op.seq > revision);
  }

  replay(doc: object, operations: LocalOperation[]): void {
    this.enabled = false;
    const handles = new Map<string, number>();
    this.nativeHandles.clear();
    this.seq = 0;
    let previous = 0;
    for (const op of operations) {
      if (op.seq !== ++previous || !LOCAL_JOURNAL_METHODS.has(op.method) || !Array.isArray(op.args)) {
        throw new Error('복구 기록의 순서 또는 명령이 올바르지 않습니다.');
      }
      const method = Reflect.get(doc, op.method);
      if (typeof method !== 'function') throw new Error(`복구 명령을 지원하지 않습니다: ${op.method}`);
      const args = structuredClone(op.args);
      const use = handleUses[op.method];
      if (use) {
        const handle = handles.get(`${use}:${args[0]}`);
        if (handle === undefined) throw new Error('실행 취소 복구 기록이 누락되었습니다.');
        args[0] = handle;
      }
      const result = method.apply(doc, args);
      if (captures[op.method]) {
        if (op.handle !== op.seq) throw new Error('실행 취소 복구 식별자가 올바르지 않습니다.');
        handles.set(`${captures[op.method]}:${op.handle}`, result);
        this.nativeHandles.set(`${captures[op.method]}:${result}`, op.handle);
      }
      this.seq = previous;
    }
  }
}
