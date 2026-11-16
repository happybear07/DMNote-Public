// 고른 글 AI 편집 (FR-112 · 작성 도우미): 고른 글 → 할 일(요약 · 자세히 · 다듬기 · 말투 · 이어 쓰기 · 번역) → 미리보기(글이 흘러나옴)
// → 바꾸기 · 아래에 넣기 · 이어서 넣기. 빈 글 상자에서 열면 초안(FR-113) — 주제를 쓰면 그 상자를 채운다.
// 노트 요약 (FR-115): 노트 전체 글 → 요약 · 결정 · 할 일(digest) → 미리보기 → 노트 맨 위 콜아웃. 입력은 늘 노트 전체(자리와 무관).
// 노트 번역 (FR-114): 노트의 글 조각 → 번역 → 새 노트(원본은 그대로). 초안 (FR-113, 명령 팔레트 · ⋯): 주제 → 노트 맨 끝 새 상자.
// 넣기는 엔진 트랜잭션 하나라 실행 취소 한 번이면 원래대로. 고른 뒤 글이 바뀌었으면 위치가 어긋나므로 넣지 않는다.
// AI 전송 동의 · 키 · 잠긴 노트 확인은 구조화와 같다. 원문에 없던 숫자는 미리보기에서 강조만 한다(AI-PROMPTS 12.4).
import { aiErrorMessage, AiError, DIGEST_MAX_CHARS, DRAFT_BRIEF_MAX_CHARS, EDIT_LANGS, EDIT_MAX_CHARS, joinSegments, splitSegments, textLang, TRANSLATE_NOTE_MAX_CHARS, type EditAction, type EditLang, type EditTone } from '@dn/ai-pipeline';
import { applyAiText, deleteEntities, insertTextAtEnd, insertTextAtTop, isTextContent, newId, type Engine, type TextDoc, type TextNode } from '@dn/engine-core';
import type { AiEditRequest } from '@dn/engine-dom';
import type { MetaStore } from '@dn/storage-idb';
import { aiEditSteps, aiSource, keptLabel, markdownToDoc, missingKept, rangeMarkdown, sameDoc } from '@dn/text-pm';
import { addAiUsage, directOpts } from './ai';
import type { NoteSegments } from './translate-note';
import { CHIP_MIN_CHARS } from './ws-model';

/** 노트 Markdown(내보내기와 같은 것) → 요약에 보낼 글: 앞머리(YAML) · 그림(base64 · 첨부 주소)은 뺀다 */
export function digestSource(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n*/, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

const SUMMARY_HEAD = 'AI 요약';
/** 노트 요약이 넣은 'AI 요약' 콜아웃 상자 — 다시 요약하면 입력에서 빼고 새 요약으로 바꾼다 (교차 검토 A12: 요약이 쌓이고 요약을 또 요약했다) */
export function summaryBlocks(engine: Engine): string[] {
  return [...engine.blocks()].filter((b) => {
    if (b.ai?.promptVersion !== 'edit.v1') return false;
    const cs = engine.contentsOf(b.id), c = cs[0];
    const first = c && isTextContent(c) && cs.length === 1 ? c.doc.content?.[0] : undefined;
    return first?.type === 'callout' && first.content?.[0]?.content?.map((t) => t.text ?? '').join('') === SUMMARY_HEAD;
  }).map((b) => b.id);
}

export interface AiEditState {
  /** range: 고른 글 (FR-112) · note: 노트 전체 — 요약(FR-115) · 번역(FR-114) · draft: 초안 (FR-113) */
  kind: 'range' | 'note' | 'draft';
  /** note: 요약인가 번역인가 */
  intent?: 'digest' | 'translate';
  step: 'choose' | 'running' | 'done' | 'error';
  /** 창을 띄울 자리 (client px — 고른 글 아래) */
  x: number;
  y: number;
  /** 고른 글 글자 수 */
  chars: number;
  /** 고른 글의 주 언어 (번역 대상 단추에서 뺀다) */
  lang?: EditLang;
  /** draft: 빈 글 상자를 채우나 (아니면 노트 맨 끝 새 상자) */
  inBox?: boolean;
  action?: EditAction;
  tone?: EditTone;
  target?: EditLang;
  /** 흘러나오는 · 끝난 결과 (Markdown — 노트 번역은 조각 표지 포함) */
  text: string;
  /** 원문에 없던 숫자 */
  newNumbers: readonly string[];
  truncated?: boolean;
  /** 결과를 만든 모델 (넣은 상자의 AI 출처 표시) */
  model?: string;
  error?: string;
  /** 고른 글에서 바꾸면 사라지는 서식 (댓글 표시 · 글자 색 …) — 있으면 '아래에 넣기'를 권한다 */
  lost?: readonly string[];
  /** AI가 빠뜨린 글 속 물건(노트 링크 · 날짜 …) 수 */
  missing?: number;
}

interface Host {
  readonly engine: Engine | null;
  readonly meta: MetaStore;
  readonly consent: boolean;
  readonly hasKey: boolean;
  /** 지금 노트가 잠겼나 (FR-144 — 잠긴 노트는 AI로 보내지 않는다) */
  readonly locked: boolean;
  readonly aiEdit: AiEditState | null;
  patch(p: { aiEdit: AiEditState | null }): void;
  toast(t: string, undo?: boolean): void;
  askConsent(): void;
  askKey(reason: string): void;
  /** 지금 노트의 Markdown (노트 요약 입력) */
  noteSource(): string | null;
  /** 지금 노트의 번역할 조각 (노트 번역 입력) */
  noteSegments(): NoteSegments | null;
  /** 번역한 조각으로 새 노트를 만들어 연다 — 새 노트 제목 · 받지 못한 조각 수 */
  translatedNote(segs: NoteSegments, out: readonly (string | null)[], o: { model?: string; target: EditLang }): Promise<{ title: string; missing: number } | null>;
  /** 글 상자 높이 재기 (폭 w) */
  measure(doc: TextDoc, w: number): number;
  /** 넣은 상자로 화면 옮기기 */
  reveal(blockId: string): void;
}

const top = () => ({ x: Math.max(8, innerWidth / 2 - 220), y: 72 });

export class AiEditCtl {
  private req: AiEditRequest | null = null;
  private selection = '';
  private segs: NoteSegments | null = null;
  /** 고른 글 속 물건 (⟦n⟧ 표지로 보내고 넣을 때 되돌린다) · 창을 연 노트 (다른 노트에 넣지 않게) */
  private keep: readonly TextNode[] = [];
  private noteId: string | null = null;
  private abort: AbortController | null = null;
  private frame = 0;
  /** 동의 · 키 창을 기다리는 할 일 — 창이 끝나면 이어서 보낸다 (교차 검토 A8 · C4: 노트 요약 창이 단추 없이 멈췄다) */
  private pending: { action: EditAction; tone?: EditTone; target?: EditLang } | null = null;
  constructor(private readonly h: Host) {}

  private refuse(): boolean {
    if (!this.h.engine) return true;
    if (this.h.locked) { this.h.toast('잠긴 노트는 AI로 보내지 않아요 — 잠금을 풀고 다시 해 주세요.'); return true; }
    return false;
  }

  private begin(req: AiEditRequest | null, selection: string, st: AiEditState): void {
    this.stop();
    this.req = req;
    this.selection = selection;
    this.segs = null;
    this.keep = [];
    this.pending = null;
    this.noteId = this.h.engine?.note.id ?? null;
    this.h.patch({ aiEdit: st });
  }

  /** 창을 연 노트가 지금도 열려 있나 — 아니면 알리고 넣지 않는다 */
  private here(e: Engine): boolean {
    if (e.note.id === this.noteId) return true;
    this.h.toast('다른 노트로 옮겨서 결과를 넣지 않았어요.');
    this.close();
    return false;
  }

  /** 미리보기 글: 글 속 물건 표지(⟦n⟧)를 그 물건의 글자로 */
  previewText(text: string): string { return this.keep.length ? keptLabel(text, this.keep) : text; }

  /** 고른 글로 창 열기 (말풍선 'AI' · Ctrl+J) — 상자가 비었으면 초안 (FR-113) */
  open(req: AiEditRequest): void {
    if (this.refuse()) return;
    const src = aiSource(req.doc, req), md = src.markdown.trim();
    if (!md) {
      if (rangeMarkdown(req.doc, { from: 0, to: 0 }).trim()) { this.h.toast('고칠 글이 없어요. 글을 고른 뒤 다시 해 주세요.'); return; }
      // 빈 상자는 커서뿐이라 req가 이미 상자 전체(0 ~ 끝)
      this.begin(req, '', { kind: 'draft', inBox: true, step: 'choose', x: req.x, y: req.y, chars: 0, text: '', newNumbers: [] });
      return;
    }
    if (md.length > EDIT_MAX_CHARS) { this.h.toast(`고른 글이 너무 길어요 — ${EDIT_MAX_CHARS.toLocaleString()}자까지 고칠 수 있어요. 나눠서 골라 주세요.`); return; }
    this.begin(req, md, { kind: 'range', step: 'choose', x: req.x, y: req.y, chars: md.length, lang: textLang(md), text: '', newNumbers: [], ...(src.lost.length ? { lost: src.lost } : {}) });
    this.keep = src.keep;
  }

  /** 노트 전체 요약 (FR-115 — 명령 팔레트 · 노트 ⋯): 창을 화면 위쪽 가운데에 열고 바로 보낸다 */
  async openNote(): Promise<void> {
    if (this.refuse()) return;
    const md = digestSource(this.h.noteSource() ?? '');
    if (md.replace(/\s/g, '').length < CHIP_MIN_CHARS) { this.h.toast('요약할 글이 너무 적어요.'); return; }
    if (md.length > DIGEST_MAX_CHARS) { this.h.toast(`노트가 너무 길어요 — ${DIGEST_MAX_CHARS.toLocaleString()}자까지 요약할 수 있어요.`); return; }
    this.begin(null, md, { kind: 'note', intent: 'digest', step: 'choose', ...top(), chars: md.length, text: '', newNumbers: [] });
    await this.run('digest');
  }

  /** 노트 번역 (FR-114): 언어를 고르면 보낸다 — 결과는 새 노트 */
  openTranslate(): void {
    if (this.refuse()) return;
    const segs = this.h.noteSegments();
    const src = segs ? joinSegments(segs.parts) : '';
    if (!segs?.parts.length) { this.h.toast('번역할 글이 없어요.'); return; }
    if (src.length > TRANSLATE_NOTE_MAX_CHARS) { this.h.toast(`노트가 너무 길어요 — ${TRANSLATE_NOTE_MAX_CHARS.toLocaleString()}자까지 번역할 수 있어요. 글을 골라서 번역해 주세요.`); return; }
    this.begin(null, src, { kind: 'note', intent: 'translate', step: 'choose', ...top(), chars: segs.parts.join('\n').length, lang: textLang(segs.parts.join('\n')), text: '', newNumbers: [] });
    this.segs = segs;
  }

  /** 초안 (FR-113 — 명령 팔레트 · 노트 ⋯): 주제를 쓰면 보낸다 — 결과는 노트 맨 끝 새 상자 */
  openDraft(): void {
    if (this.refuse()) return;
    this.begin(null, '', { kind: 'draft', step: 'choose', ...top(), chars: 0, text: '', newNumbers: [] });
  }

  /** 초안 주제로 보내기 */
  async draft(brief: string): Promise<void> {
    const b = brief.trim();
    if (!b || !this.h.aiEdit) return;
    if (b.length > DRAFT_BRIEF_MAX_CHARS) { this.h.toast(`주제는 ${DRAFT_BRIEF_MAX_CHARS.toLocaleString()}자까지 쓸 수 있어요.`); return; }
    this.selection = b;
    this.h.patch({ aiEdit: { ...this.h.aiEdit, chars: b.length } });
    await this.run('draft');
  }

  /** 할 일을 골라 보내기 — 같은 창에서 다시 고르면 새로 보낸다 */
  async run(action: EditAction, tone?: EditTone, target?: EditLang): Promise<void> {
    const cur = this.h.aiEdit;
    if (!this.selection || !cur) return;
    const wait = () => { this.pending = { action, ...(tone ? { tone } : {}), ...(target ? { target } : {}) }; };
    if (!this.h.consent) { wait(); this.h.askConsent(); return; }
    const opts = await directOpts(this.h.meta);
    if (!opts || !this.h.hasKey) { wait(); this.h.askKey('Claude API 키가 있어야 AI로 고칠 수 있어요. 키를 저장하면 이어서 할게요.'); return; }
    this.pending = null;
    this.stop();
    const ac = new AbortController();
    this.abort = ac;
    const { text: _t, newNumbers: _n, truncated: _c, model: _m, error: _e, tone: _o, target: _g, missing: _x, ...rest } = cur;
    const base: AiEditState = { ...rest, step: 'running', action, ...(tone ? { tone } : {}), ...(target ? { target } : {}), text: '', newNumbers: [] };
    this.h.patch({ aiEdit: base });
    let streamed = '';
    try {
      const { createDirectEdit } = await import('@dn/ai-pipeline/direct');
      const r = await createDirectEdit(opts)({ selection: this.selection, action, ...(tone ? { tone } : {}), ...(target ? { target } : {}), locale: 'ko' }, {
        signal: ac.signal,
        // 글 조각마다 다시 그리지 않고 한 화면에 한 번
        onText: (t) => { streamed = t; if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; if (this.abort === ac) this.h.patch({ aiEdit: { ...base, text: streamed } }); }); },
      });
      await addAiUsage(this.h.meta, r.usage, r.model).catch(() => {});
      if (ac.signal.aborted) return;
      if (!r.text || r.text === this.selection) {
        this.h.patch({ aiEdit: { ...base, step: 'error', error: action === 'translate' ? '이미 그 언어로 쓰인 글이에요.' : '바꿀 내용이 없어요. 원문은 그대로예요.' } });
        return;
      }
      const missing = this.keep.length ? missingKept(r.text, this.keep) : 0;
      this.h.patch({ aiEdit: { ...base, step: 'done', text: r.text, newNumbers: r.newNumbers, truncated: r.truncated, model: r.model, ...(missing ? { missing } : {}) } });
    } catch (e) {
      if (ac.signal.aborted || (e instanceof AiError && e.code === 'aborted')) return;
      const err = e instanceof AiError ? aiErrorMessage(e).text.replace('{time}', e.retryAfter ? `${Math.ceil(e.retryAfter / 60)}분` : '잠시') : '결과를 받지 못했어요. 다시 시도해 주세요.';
      this.h.patch({ aiEdit: { ...base, step: 'error', error: err } });
    } finally {
      if (this.abort === ac) this.abort = null;
    }
  }

  private aiMark(st: AiEditState) {
    return { generated: true as const, runId: newId(), promptVersion: 'edit.v1', ...(st.model ? { model: st.model } : {}) };
  }

  /** 노트 요약 넣기: 노트 맨 위에 'AI 요약' 콜아웃 상자 하나 (AI 출처 표시) — 실행 취소 한 번 */
  applyNote(): void {
    const e = this.h.engine, st = this.h.aiEdit;
    if (!e || st?.kind !== 'note' || st.intent !== 'digest' || st.step !== 'done' || !this.here(e)) return;
    const doc: TextDoc = { type: 'doc', content: [{ type: 'callout', attrs: { icon: 'bulb', color: 'purple' }, content: [
      { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'strong' }], text: SUMMARY_HEAD }] },
      ...(markdownToDoc(st.text).content ?? []),
    ] }] };
    // 이전 요약은 지우고 새 요약을 맨 위에 — 한 트랜잭션이라 실행 취소 한 번이면 이전 요약이 돌아온다
    const old = summaryBlocks(e);
    const r = e.transact(() => {
      if (old.length) deleteEntities(e, old);
      const ins = insertTextAtTop(e, doc, (w) => this.h.measure(doc, w), { ai: this.aiMark(st) });
      return ins.ok ? ins.value.blockId : null;
    }, { origin: 'user', label: 'AI 노트 요약' });
    if (!r.ok || !r.value) { this.h.toast('요약을 넣지 못했어요.'); return; }
    this.close();
    this.h.reveal(r.value);
    this.h.toast(old.length ? '이전 요약을 새 요약으로 바꿨어요.' : '노트 맨 위에 요약을 넣었어요.', true);
  }

  /** 노트 번역 → 새 노트 (원본은 그대로) */
  async applyTranslation(): Promise<void> {
    const st = this.h.aiEdit, segs = this.segs;
    if (st?.kind !== 'note' || st.intent !== 'translate' || st.step !== 'done' || !segs || !st.target) return;
    const out = splitSegments(st.text, segs.parts.length, segs.parts);
    if (out.every((x) => x === null)) { this.h.toast('번역 결과를 읽지 못했어요. 다시 해 주세요.'); return; }
    this.close();
    const r = await this.h.translatedNote(segs, out, { ...(st.model ? { model: st.model } : {}), target: st.target });
    if (!r) { this.h.toast('번역한 노트를 만들지 못했어요. 원본은 그대로예요.'); return; }
    this.h.toast(`'${r.title}' 노트를 만들었어요.${r.missing ? ` ${r.missing}개 조각은 원문 그대로예요.` : ''}`);
  }

  /** 초안 넣기: 빈 상자에서 열었으면 그 상자를, 아니면 노트 맨 끝 새 상자 (AI 출처 표시) — 실행 취소 한 번 */
  applyDraft(): void {
    const e = this.h.engine, st = this.h.aiEdit;
    if (!e || st?.kind !== 'draft' || st.step !== 'done' || !this.here(e)) return;
    if (this.req) { this.apply('replace'); return; }
    const doc = markdownToDoc(st.text);
    const r = insertTextAtEnd(e, doc, (w) => this.h.measure(doc, w), { ai: this.aiMark(st), label: 'AI 초안' });
    if (!r.ok) { this.h.toast('초안을 넣지 못했어요.'); return; }
    this.close();
    this.h.reveal(r.value.blockId);
    this.h.toast('노트 맨 끝에 초안을 넣었어요.', true);
  }

  /** 결과 넣기 — replace: 고른 글을 결과로, below: 고른 글이 끝나는 문단 아래에, after: 고른 글 바로 뒤에 이어서. 실행 취소 한 번 */
  apply(how: 'replace' | 'below' | 'after'): void {
    const e = this.h.engine, req = this.req, st = this.h.aiEdit;
    if (!e || !req || st?.step !== 'done' || !this.here(e)) return;
    const c = e.getContent(req.contentId);
    if (!c || !isTextContent(c)) { this.h.toast('고른 글이 있던 상자가 없어졌어요.'); this.close(); return; }
    if (!sameDoc(c.doc, req.doc)) { this.h.toast('고른 뒤 글이 바뀌어서 넣지 않았어요. 다시 골라 주세요.'); return; }
    if (how === 'replace' && st.truncated && st.kind !== 'draft') { this.h.toast('끝이 잘린 결과라 바꾸지 않았어요 — 아래에 넣거나 글을 나눠 다시 해 주세요.'); return; } // 교차 검토 A5
    e.breakUndoMerge();
    const label = st.kind === 'draft' ? 'AI 초안' : how === 'replace' ? 'AI로 고치기' : how === 'after' ? 'AI 이어 쓰기' : 'AI 결과 넣기';
    const r = applyAiText(e, req.contentId, aiEditSteps(c.doc, req, st.text, how, this.keep), this.aiMark(st), label);
    e.breakUndoMerge();
    if (!r.ok) { this.h.toast('결과를 넣지 못했어요.'); return; }
    this.close();
    this.h.toast(st.kind === 'draft' ? '초안을 넣었어요.' : how === 'replace' ? (st.action === 'translate' ? '번역한 글로 바꿨어요.' : 'AI가 고친 글로 바꿨어요.') : how === 'after' ? '이어서 썼어요.' : '고른 글 아래에 넣었어요.', true);
  }

  private stop(): void {
    this.abort?.abort();
    this.abort = null;
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
  }

  /** 동의 · 키 창이 끝난 뒤: 동의 · 저장했으면(ok) 기다리던 할 일을 이어서 보내고, 닫았으면 잊는다 — 이어서 보냈나 */
  resume(ok: boolean): boolean {
    const p = this.pending;
    this.pending = null;
    if (!ok || !p || !this.h.aiEdit) return false;
    void this.run(p.action, p.tone, p.target);
    return true;
  }

  close(): void {
    this.stop();
    this.req = null;
    this.selection = '';
    this.segs = null;
    this.keep = [];
    this.pending = null;
    if (this.h.aiEdit) this.h.patch({ aiEdit: null });
  }
}

/** 번역 대상 단추: 원문 언어를 뺀 나머지 (한국어 글이면 영어가 맨 앞) */
export const targetLangs = (src?: EditLang) => EDIT_LANGS.filter((l) => l.lang !== src);

