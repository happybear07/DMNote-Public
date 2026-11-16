// 워크스페이스 찾아 바꾸기 층 (FR-123): 지금 노트 · 모든 노트에서 찾기, 하나씩 · 모두 바꾸기, 한 번에 되돌리기.
// 내용 상자 · 제목 상자 · 표 셀을 바꾼다 (노트 제목은 바꾸지 않는다). 층 순서: … → ws-todos → 여기 → workspace.ts
import { isTableContent, isTextContent, type Engine, type Id, type TableContent, type TextDoc } from '@dn/engine-core';
import { readNote } from '@dn/storage-idb';
import { docReplaceSteps, findInDoc, replaceSteps, toNode, type FindOptions } from '@dn/text-pm';
import { TodoLayer } from './ws-todos';
import { firstLine } from './ws-model';
import { collectReminders } from './reminders';

export interface ReplaceHit {
  noteId: Id;
  blockId: Id;
  contentId: Id;
  /** 표 셀이면 행 · 열 */
  cell?: { rowId: Id; colId: Id };
  from: number;
  /** 일치한 곳 앞뒤 문맥 (한 줄) · 그 안의 일치 구간 */
  before: string;
  match: string;
  after: string;
}

export type ReplaceScope = 'note' | 'all';
type Snapshot = Map<Id, { doc?: TextDoc; rows?: TableContent['rows'] }>;

const CONTEXT = 24;

/** 일치한 문단 글자에서 앞뒤 문맥 */
function context(doc: TextDoc, from: number, len: number): Pick<ReplaceHit, 'before' | 'match' | 'after'> {
  const $p = toNode(doc).resolve(from);
  const text = $p.parent.textContent;
  const at = $p.parentOffset;
  const pre = text.slice(Math.max(0, at - CONTEXT), at);
  return { before: (at > CONTEXT ? '…' : '') + pre, match: text.slice(at, at + len), after: text.slice(at + len, at + len + CONTEXT) + (at + len + CONTEXT < text.length ? '…' : '') };
}

export abstract class ReplaceLayer extends TodoLayer {
  /** 일치 목록 (노트 순서 → 블록 위아래 → 문서 순서) */
  async findAll(query: string, scope: ReplaceScope, opts: FindOptions = {}): Promise<ReplaceHit[]> {
    if (!query) return [];
    // 모든 노트에서 찾을 때 잠긴 노트는 뺀다 (FR-144) — 지금 열린 노트 하나는 그대로
    const ids = scope === 'note' ? (this.state.currentId ? [this.state.currentId] : []) : this.state.notes.filter((n) => !n.locked).map((n) => n.id);
    const out: ReplaceHit[] = [];
    for (const id of ids) {
      const e = this.open?.engine.note.id === id ? this.open.engine : await readNote(this.store, id);
      if (e) out.push(...hitsIn(e, query, opts));
      if (out.length > 500) break;
    }
    return out;
  }

  /** 하나만 바꾸기 */
  async replaceOne(hit: ReplaceHit, query: string, replacement: string, opts: FindOptions = {}): Promise<boolean> {
    return (await this.applyToNote(hit.noteId, (e) => applyReplace(e, query, replacement, opts, hit))) > 0;
  }

  /** 모두 바꾸기 — 끝나면 [되돌리기] 토스트 (닫힌 노트까지 한 번에) */
  async replaceAll(query: string, replacement: string, scope: ReplaceScope, opts: FindOptions = {}): Promise<number> {
    const hits = await this.findAll(query, scope, opts);
    const notes = [...new Set(hits.map((h) => h.noteId))];
    const snaps = new Map<Id, Snapshot>();
    let total = 0;
    for (const id of notes) {
      total += await this.applyToNote(id, (e) => {
        snaps.set(id, snapshotOf(e, hits.filter((h) => h.noteId === id)));
        return applyReplace(e, query, replacement, opts);
      });
    }
    if (total) {
      this.toast(`${notes.length > 1 ? `노트 ${notes.length}개에서 ` : ''}${total}곳을 바꿨어요.`, {
        label: '되돌리기', run: () => void this.revertReplace(snaps),
      });
    }
    return total;
  }

  private async revertReplace(snaps: Map<Id, Snapshot>): Promise<void> {
    for (const [id, snap] of snaps) await this.applyToNote(id, (e) => restore(e, snap));
    this.toast('바꾸기를 되돌렸어요.');
  }

  /** 노트 하나에 변경 적용 — 열린 노트는 그 엔진에(실행 취소 가능), 닫힌 노트는 잠금을 잡고 열어 저장(editNote) · 그 뒤 목록을 새로 */
  private async applyToNote(id: Id, fn: (e: Engine) => number): Promise<number> {
    const closed = this.open?.engine.note.id !== id;
    let busy = false;
    try {
      const n = await this.editNote(id, fn, (e) => ({ updatedAt: Date.now(), preview: firstLine(e), reminders: collectReminders(e, { hideText: this.store.isLocked(id) }) }));
      busy = n === 'busy';
      if (busy) this.toast('다른 탭에서 편집 중인 노트는 건너뛰었어요.');
      return typeof n === 'number' ? n : 0;
    } finally { if (closed && !busy) await this.refreshList(); }
  }
}

function hitsIn(e: Engine, query: string, opts: FindOptions): ReplaceHit[] {
  const out: ReplaceHit[] = [];
  const blocks = [...e.blocks()].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const b of blocks) {
    for (const c of e.contentsOf(b.id)) {
      if (isTextContent(c)) {
        for (const m of findInDoc(c.doc, query, opts)) out.push({ noteId: e.note.id, blockId: b.id, contentId: c.id, from: m.from, ...context(c.doc, m.from, m.text.length) });
      } else if (isTableContent(c)) {
        for (const r of c.rows) for (const col of c.columns) {
          const doc = r.cells[col.id];
          if (doc) for (const m of findInDoc(doc, query, opts)) out.push({ noteId: e.note.id, blockId: b.id, contentId: c.id, cell: { rowId: r.id, colId: col.id }, from: m.from, ...context(doc, m.from, m.text.length) });
        }
      }
    }
  }
  return out;
}

/** 바꾸기 — `only`가 있으면 그 일치 하나. 바꾼 곳 수. 트랜잭션 하나라 열린 노트는 실행 취소 한 번에 되돌아간다 */
function applyReplace(e: Engine, query: string, replacement: string, opts: FindOptions, only?: ReplaceHit): number {
  let count = 0;
  const edits: { contentId: Id; steps: unknown[] }[] = [];
  const tables = new Map<Id, TableContent['rows']>();
  for (const c of e.contents()) {
    if (only && c.id !== only.contentId) continue;
    if (isTextContent(c) && !only?.cell) {
      const r = replaceSteps(c.doc, query, replacement, { ...opts, ...(only ? { only: only.from } : {}) });
      if (r) { edits.push({ contentId: c.id, steps: r.steps }); count += r.count; }
    } else if (isTableContent(c)) {
      let changed = false;
      const rows = c.rows.map((row) => {
        if (only?.cell && only.cell.rowId !== row.id) return row;
        const cells = { ...row.cells };
        for (const [colId, doc] of Object.entries(row.cells)) {
          if (only?.cell && only.cell.colId !== colId) continue;
          const r = replaceSteps(doc, query, replacement, { ...opts, ...(only ? { only: only.from } : {}) });
          if (r) { cells[colId] = r.doc; count += r.count; changed = true; }
        }
        return changed ? { ...row, cells } : row;
      });
      if (changed) tables.set(c.id, rows);
    }
  }
  if (!count) return 0;
  e.transact((tx) => {
    for (const ed of edits) tx.text(ed.contentId, ed.steps);
    for (const [id, rows] of tables) tx.set('content', id, { rows });
  }, { origin: 'user', label: '찾아 바꾸기' });
  return count;
}

function snapshotOf(e: Engine, hits: ReplaceHit[]): Snapshot {
  const snap: Snapshot = new Map();
  for (const id of new Set(hits.map((h) => h.contentId))) {
    const c = e.getContent(id);
    if (c && isTextContent(c)) snap.set(id, { doc: c.doc });
    else if (isTableContent(c)) snap.set(id, { rows: c.rows });
  }
  return snap;
}

function restore(e: Engine, snap: Snapshot): number {
  let n = 0;
  const edits: { contentId: Id; steps: unknown[] }[] = [];
  for (const [id, s] of snap) {
    const c = e.getContent(id);
    if (s.doc && c && isTextContent(c)) { const steps = docReplaceSteps(c.doc, s.doc); if (steps.length) { edits.push({ contentId: id, steps }); n++; } }
    if (s.rows && isTableContent(c)) n++;
  }
  if (!n) return 0;
  e.transact((tx) => {
    for (const ed of edits) tx.text(ed.contentId, ed.steps);
    for (const [id, s] of snap) if (s.rows && isTableContent(e.getContent(id))) tx.set('content', id, { rows: s.rows });
  }, { origin: 'user', label: '찾아 바꾸기 되돌리기' });
  return n;
}
