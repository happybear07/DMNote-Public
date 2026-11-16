// undo · redo 스택 (병합 창 · 상한 · 조건부 되돌리기). 엔진은 이 객체를 들고 트랜잭션 실행만 넘긴다.
// 원격 변경(origin 'remote')이 끼어든 뒤의 되돌리기는 undo-guard.ts 규칙으로 연산마다 거른다(SYNC.md 13.7).
import type { Id } from './model';
import { invertAll, type Op } from './ops';
import type { Tx, TxOptions, TxResult } from './tx';
import { applyGuarded, type GuardView } from './undo-guard';

export interface UndoEntry {
  ops: Op[]; label?: string; mergeKey?: string; at: number;
  /** 이 기록을 처음 쓴 때 — 합치기는 여기서 MERGE_SPAN_MS까지 */
  start: number;
  /** 기록할 때의 원격 시점 — 이보다 뒤의 원격 변경이 건드린 콘텐츠는 텍스트 되돌리기를 건너뛴다 */
  tick: number;
}

/** 노트를 연 뒤의 작업을 거의 다 되돌릴 수 있게 (알파 10/31 — 200이면 긴 필기 · 편집에서 앞쪽이 잘렸다) */
const UNDO_LIMIT = 1000;
const MERGE_WINDOW_MS = 1000;
/** 쉬지 않고 이어 친 글자도 이만큼 지나면 다음 기록으로 — 길게 쓴 글이 실행 취소 한 번에 다 사라지지 않게 */
const MERGE_SPAN_MS = 4000;
/** 다 건너뛴 기록은 버리고 다음 것을 — 한 번 누를 때 최대 이만큼 */
const SKIP_EMPTY_MAX = 10;

/** 되돌리기 결과 — 건너뛴 연산이 있으면 알린다(앱: "다른 곳의 변경과 겹쳐 일부만 되돌렸어요") */
export type UndoNotice = (kind: 'undo' | 'redo', skipped: number) => void;

export class History {
  private readonly undoStack: UndoEntry[] = [];
  private readonly redoStack: UndoEntry[] = [];
  private tick = 0;
  private readonly remoteAt = new Map<Id, number>();
  notice: UndoNotice | null = null;

  record(ops: Op[], opts: TxOptions): void {
    if (opts.origin === 'undo' || opts.origin === 'redo') return;
    const undoable = opts.undoable ?? (opts.origin === 'user' || opts.origin === 'text' || opts.origin === 'ai');
    if (!undoable) return;
    const now = Date.now();
    const top = this.undoStack[this.undoStack.length - 1];
    // 사이에 원격 변경이 있었으면 합치지 않는다 (앞뒤 연산의 기준 시점이 달라진다)
    if (opts.mergeKey && top && top.mergeKey === opts.mergeKey && now - top.at < MERGE_WINDOW_MS && now - top.start < MERGE_SPAN_MS && top.tick === this.tick) {
      top.ops.push(...ops);
      top.at = now;
    } else {
      this.undoStack.push({ ops: [...ops], label: opts.label, mergeKey: opts.mergeKey, at: now, start: now, tick: this.tick });
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  /** 원격 트랜잭션이 바꾼 엔티티 — 그 엔티티를 건드리는 다시 실행 기록은 버린다 */
  noteRemote(changed: ReadonlySet<Id>): void {
    this.tick++;
    for (const id of changed) this.remoteAt.set(id, this.tick);
    for (let i = this.redoStack.length - 1; i >= 0; i--) if (this.redoStack[i]!.ops.some((op) => changed.has(op.id))) this.redoStack.splice(i, 1);
  }

  breakMerge(): void { const top = this.undoStack[this.undoStack.length - 1]; if (top) top.mergeKey = undefined; }
  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
  clear(): void { this.undoStack.length = 0; this.redoStack.length = 0; }

  undo(run: Runner, view: Omit<GuardView, 'remoteSince'>): boolean { return this.step('undo', run, view); }
  redo(run: Runner, view: Omit<GuardView, 'remoteSince'>): boolean { return this.step('redo', run, view); }

  private step(kind: 'undo' | 'redo', run: Runner, view: Omit<GuardView, 'remoteSince'>): boolean {
    const from = kind === 'undo' ? this.undoStack : this.redoStack;
    const to = kind === 'undo' ? this.redoStack : this.undoStack;
    for (let n = 0; n < SKIP_EMPTY_MAX; n++) {
      const entry = from.pop();
      if (!entry) return false;
      const ops = kind === 'undo' ? invertAll(entry.ops) : entry.ops;
      const guard: GuardView = { ...view, remoteSince: (id) => (this.remoteAt.get(id) ?? -1) > entry.tick };
      let skipped = 0;
      const r = run((tx) => { skipped = applyGuarded(tx, ops, guard); }, kind, entry.label);
      if (!r.ok) return false;
      if (skipped === ops.length) continue; // 전부 다른 곳 변경과 겹쳤다 — 이 기록은 버리고 다음 것을
      to.push({ ...entry, tick: this.tick });
      if (skipped) this.notice?.(kind, skipped);
      return true;
    }
    return false;
  }
}

export type Runner = (fn: (tx: Tx) => void, origin: 'undo' | 'redo', label?: string) => TxResult<void>;
