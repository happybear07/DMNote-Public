// 내 노트에 질문하기 (FR-116~119): 범위(전체 · 현재 노트 · 폴더 · 태그 · 역할) 안의 노트에서 근거 조각을 찾아 Claude(qa.v1)에 묻고,
// 인용을 눌러 그 노트 · 블록으로, 답을 새 노트 · 현재 노트에 저장(출처 노트 링크 포함, 저장 직후 구조화 제안).
// 이력은 이 창을 연 동안(세션)만 — 최근 6턴을 함께 보낸다. 휴지통 · 잠긴 노트는 늘 뺀다(색인에도 없다).
// 범위가 '전체 노트'면 모든 노트의 블록을 훑지 않고 먼저 좁힌다(2026-10-26, note-scope.ts): 질문에 걸린 역할 · 태그의 노트 →
// 없거나 근거가 안 나오면 요약 카드(제목 · 소제목 · 키워드)에 걸린 노트 → 그래도 없으면 Claude를 부르지 않는다.
import { AiError, aiErrorMessage, type QaAnswer } from '@dn/ai-pipeline';
import type { TextDoc, TextNode } from '@dn/engine-core';
import type { NoteInfo, NoteRole, Passage, ScopeResult } from '@dn/search';
import type { Folder, MetaStore, NoteMeta, Tag } from '@dn/storage-idb';
import { addAiUsage, directOpts } from './ai';
import { folderSubtree, notesInFolders } from './tree';
import { displayTitle } from './ws-model';
import { effectiveRole, roleName } from './note-scope';

export type QaScope = { kind: 'all' } | { kind: 'note'; id: string } | { kind: 'folder'; id: string } | { kind: 'tag'; id: string } | { kind: 'role'; id: string };
/** scope: 이 질문에 실제로 쓴 범위 (전체 노트를 좁혔으면 그 설명) */
export interface QaTurnState { question: string; status: 'running' | 'done' | 'error'; answer?: QaAnswer; error?: string; scope?: string }
export interface QaState { scope: QaScope; turns: QaTurnState[] }

interface Host {
  readonly meta: MetaStore;
  readonly consent: boolean;
  readonly hasKey: boolean;
  readonly qa: QaState | null;
  readonly notes: readonly NoteMeta[];
  readonly folders: readonly Folder[];
  readonly tags: readonly Tag[];
  readonly roles: readonly NoteRole[];
  readonly currentId: string | null;
  passages(question: string, notes: readonly NoteInfo[]): Passage[];
  /** 전체 노트 질문의 범위 단계 (역할 · 태그 → 요약 카드) */
  scopeStages(question: string, notes: readonly NoteInfo[]): ScopeResult[];
  patch(p: { qa: QaState | null }): void;
  toast(t: string, action?: { label: string; run: () => void }): void;
  askConsent(): void;
  askKey(reason: string): void;
  openBlock(noteId: string, blockId: string): Promise<boolean>;
  saveNote(title: string, doc: TextDoc): Promise<void>;
  insertHere(doc: TextDoc): string | null;
  structure(blockId: string): void;
}

export class QaCtl {
  private abort: AbortController | null = null;
  constructor(private readonly h: Host) {}

  open(): void { if (!this.h.qa) this.h.patch({ qa: { scope: this.h.currentId ? { kind: 'note', id: this.h.currentId } : { kind: 'all' }, turns: [] } }); }
  close(): void { this.abort?.abort(); this.h.patch({ qa: null }); }
  setScope(scope: QaScope): void { if (this.h.qa) this.h.patch({ qa: { ...this.h.qa, scope } }); }

  scopeLabel(s: QaScope): string {
    if (s.kind === 'all') return '전체 노트';
    if (s.kind === 'note') { const n = this.h.notes.find((x) => x.id === s.id); return `현재 노트: ${n ? displayTitle(n) : ''}`; }
    if (s.kind === 'folder') return `폴더: ${this.h.folders.find((f) => f.id === s.id)?.name ?? ''}`;
    if (s.kind === 'role') return `역할: ${roleName(this.h.roles, s.id) ?? ''}`;
    return `태그: ${this.h.tags.find((t) => t.id === s.id)?.name ?? ''}`;
  }

  /** 범위 안의 노트 (잠긴 노트 제외) */
  private scopeNotes(s: QaScope): NoteInfo[] {
    let notes = this.h.notes.filter((n) => !n.locked);
    if (s.kind === 'note') notes = notes.filter((n) => n.id === s.id);
    else if (s.kind === 'folder') { const ids = new Set(notesInFolders(this.h.notes, folderSubtree(this.h.folders, s.id))); notes = notes.filter((n) => ids.has(n.id)); }
    else if (s.kind === 'tag') notes = notes.filter((n) => n.tagIds?.includes(s.id));
    else if (s.kind === 'role') notes = notes.filter((n) => effectiveRole(n) === s.id);
    return notes.map((n) => ({ id: n.id, title: displayTitle(n), updatedAt: n.updatedAt }));
  }

  async ask(question: string): Promise<void> {
    const q = question.trim(), st = this.h.qa;
    if (!q || !st || st.turns.some((t) => t.status === 'running')) return;
    if (!this.h.consent) { this.h.askConsent(); return; }
    const opts = await directOpts(this.h.meta);
    if (!opts || !this.h.hasKey) { this.h.askKey('Claude API 키가 있어야 노트에 질문할 수 있어요. 키를 등록한 뒤 다시 물어봐 주세요.'); return; }
    const history = st.turns.filter((t) => t.status === 'done' && t.answer).map((t) => ({ question: t.question, answer: t.answer!.segments.map((x) => x.text).join('') }));
    const turns = [...st.turns, { question: q, status: 'running' as const }];
    this.h.patch({ qa: { ...st, turns } });
    const ac = new AbortController();
    this.abort = ac;
    const set = (t: QaTurnState) => { const cur = this.h.qa; if (cur) this.h.patch({ qa: { ...cur, turns: cur.turns.map((x, i) => (i === turns.length - 1 ? t : x)) } }); };
    try {
      const { passages: found, label } = this.findPassages(q, st.scope);
      const passages = found.map((p) => ({ ref: p.ref, noteTitle: p.noteTitle, text: p.text, updatedAt: p.updatedAt }));
      const { createDirectQa } = await import('@dn/ai-pipeline/direct');
      const answer = await createDirectQa(opts)({ question: q, passages, scope: label, history }, { signal: ac.signal });
      if (answer.model) await addAiUsage(this.h.meta, answer.usage, answer.model).catch(() => {});
      if (!ac.signal.aborted) set({ question: q, status: 'done', answer, scope: label });
    } catch (e) {
      if (ac.signal.aborted) { set({ question: q, status: 'error', error: '질문을 취소했어요.' }); return; }
      set({ question: q, status: 'error', error: e instanceof AiError ? aiErrorMessage(e).text : '답을 받지 못했어요. 다시 시도해 주세요.' });
    }
  }

  /**
   * 근거 찾기. 전체 노트면 범위 단계(역할 · 태그 → 요약 카드)를 차례로 — 앞 단계에서 근거가 나오면 거기서 멈춘다.
   * 어느 단계에도 걸리지 않으면 근거 없음(앱은 Claude를 부르지 않는다). 결과 label = 실제로 쓴 범위
   */
  findPassages(q: string, scope: QaScope): { passages: Passage[]; label: string } {
    const notes = this.scopeNotes(scope);
    if (scope.kind !== 'all') return { passages: this.h.passages(q, notes), label: this.scopeLabel(scope) };
    for (const stage of this.h.scopeStages(q, notes)) {
      const ids = new Set(stage.ids);
      const passages = this.h.passages(q, notes.filter((n) => ids.has(n.id)));
      if (passages.length) return { passages, label: `전체 노트 중 ${stage.label}` };
    }
    return { passages: [], label: '전체 노트 — 질문에 걸리는 역할 · 태그 · 요약 카드가 없음' };
  }

  cancel(): void { this.abort?.abort(); }

  /** 인용 → 그 노트 · 블록. 블록이 없어졌으면 알린다 (FR-117) */
  async openCite(ref: string): Promise<void> {
    const [noteId, blockId] = ref.split('#') as [string, string];
    if (!(await this.h.openBlock(noteId, blockId))) this.h.toast('출처 블록이 없어졌어요 — 지워졌거나 옮겨졌어요.');
  }

  /** 답 → 글 문서 (본문 + 출처: 노트 링크 · 인용문) */
  private answerDoc(t: QaTurnState): TextDoc {
    const a = t.answer!;
    const body = ocrLinesDocLite(a.segments.map((s) => s.text).join('').split('\n'));
    const seen = new Set<string>();
    const items: TextNode[] = [];
    for (const c of a.segments.flatMap((s) => s.cites)) {
      const noteId = c.ref.split('#')[0]!;
      if (seen.has(c.ref)) continue;
      seen.add(c.ref);
      items.push({ type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'note_link', attrs: { id: noteId, title: c.noteTitle } }, { type: 'text', text: ` — "${c.quote.slice(0, 120)}"` }] }] });
    }
    return { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: `Q. ${t.question}`, marks: [{ type: 'strong' }] }] },
      ...body.content,
      ...(items.length ? [{ type: 'paragraph', content: [{ type: 'text', text: '출처', marks: [{ type: 'strong' }] }] }, { type: 'bullet_list', content: items }] as TextNode[] : []),
    ] };
  }

  async saveAsNote(t: QaTurnState): Promise<void> {
    if (!t.answer) return;
    await this.h.saveNote(t.question.slice(0, 60), this.answerDoc(t));
    this.close();
    this.h.toast('답을 새 노트로 저장했어요.');
  }

  insertHere(t: QaTurnState): void {
    if (!t.answer) return;
    const id = this.h.insertHere(this.answerDoc(t));
    if (!id) { this.h.toast('지금 열린 노트가 없어요.'); return; }
    this.h.toast('답을 이 노트에 넣었어요.', { label: '구조화하기', run: () => this.h.structure(id) });
  }
}

/** 답의 줄 → 문단 · 글머리 목록 ("- "로 시작하는 줄) */
function ocrLinesDocLite(lines: readonly string[]): TextDoc {
  const out: TextNode[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const b = /^[-•]\s+(.*)$/.exec(line);
    const para = (text: string): TextNode => ({ type: 'paragraph', content: boldRuns(text) });
    if (b) { const last = out[out.length - 1]; const item: TextNode = { type: 'list_item', content: [para(b[1]!)] }; if (last?.type === 'bullet_list') (last.content as TextNode[]).push(item); else out.push({ type: 'bullet_list', content: [item] }); }
    else out.push(para(line));
  }
  return { type: 'doc', content: out };
}

/** **굵게** → strong 표시 */
function boldRuns(text: string): TextNode[] {
  const out: TextNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let at = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push({ type: 'text', text: text.slice(at, m.index) });
    out.push({ type: 'text', text: m[1]!, marks: [{ type: 'strong' }] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ type: 'text', text: text.slice(at) });
  return out;
}
