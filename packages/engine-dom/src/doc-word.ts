// 문서 뷰를 워드처럼 (FR-088): 누른 자리에 바로 커서 · 상자 경계를 넘는 ↑↓←→ · Enter/Backspace/Delete로 상자 나누기 · 합치기 ·
// Ctrl+Enter 쪽 나눔 · 맨 아래 빈 곳을 누르면 새 문단 · 서식 막대(앱)가 부르는 명령과 켜짐 상태.
// 저장은 그대로 상자 단위(engine-core doc-edit.ts) — 캔버스도 같이 바뀐다. 실행 취소는 캔버스와 같은 하나의 기록.
import {
  appendTextBox, discardIfEmpty, editText, isBlankDoc, isTextContent, mergeTextBoxes, setBlockTextStyle, setPageBreak, splitTextBox,
  type BlockAlign, type DocRoom, type Id, type TextDoc,
} from '@dn/engine-core';
import { appendDocSteps, blankLineCut, docKeymap, pmCodec, renderStatic, TextEditor, type DocKeyHost, type FormatCommand } from '@dn/text-pm';
import type { DocView } from './doc-view';
import { xrefHost } from './caption-view';
import { docUiState, type DocUiState } from './doc-ui';
import { FormatPainter } from './doc-painter';
export type { DocUiState };
import type { AiEditRequest, CanvasNotice, CommentRequest } from './types';
import type { TableSize } from './table-picker';
import { insertBelow, insertWeb } from './doc-insert';

export interface DocWordHost {
  /** 글 상자 높이 재기 (캔버스와 같은 측정) — 나눈 상자가 캔버스에서 겹치지 않게 */
  measure(doc: TextDoc, w: number, kind: 'title' | 'text'): number;
  /** 서식 막대 상태가 바뀔 때 */
  onUi?(s: DocUiState): void;
  /** Ctrl+S (자동 저장이라 알림만) */
  onSave?(): void;
  /** 사진 넣기: 파일을 골라 이 월드 좌표에 */
  insertImage?(at: { x: number; y: number }): void;
  /** 슬래시 메뉴로 블록 넣기 (그래프 · 파일 · 녹음 · 목차 · 데이터베이스 …): 이 월드 좌표에 — 자리는 문서 뷰가 비워 둔다 */
  insertBlock?(kind: string, at: { x: number; y: number }, width?: number): string | null | void;
  /** 알림 (링크 복사 등) */
  onNotice?(code: CanvasNotice): void;
  /** 댓글 창 (FR-132) */
  onComments?(req: CommentRequest): void;
  /** 고른 글 AI 편집 (FR-112) — 말풍선 'AI' (문서 뷰의 Ctrl+J는 양쪽 맞춤) */
  onAiEdit?(req: AiEditRequest): void;
  /** 다른 노트로 옮기기 (/옮기기) */
  onMoveBlocks?(ids: Id[]): void;
  /** 문서에서 못 고치는 것(그래프 · 사진 · 데이터베이스 …)을 두 번 누르면: 캔버스에서 그 블록을 연다 */
  openInCanvas?(blockId: Id): void;
}

type At = { clientX: number; clientY: number } | { pos: number } | 'start' | 'end';

export class DocWord {
  /** 지금 고치는 글 칸. keepEmpty: 캔버스에서 일부러 만든 빈 상자를 그대로 연 것 — 비어 있어도 떠날 때 지우지 않는다.
   *  room: 이 초안 자리를 내느라 내린 아래 상자 — 글 없이 떠나면 되올린다 ('클릭하여 입력', doc-click-type.ts) */
  editor: { contentId: Id; blockId: Id; ed: TextEditor; el: HTMLElement; keepEmpty: boolean; room?: DocRoom | null } | null = null;
  private uiKey = '';

  /** 서식 복사 (워드 붓, doc-painter.ts) */
  readonly painter: FormatPainter;
  constructor(/** @internal */ readonly dv: DocView) {
    this.painter = new FormatPainter(dv.opts.engine, () => this.editor, dv.root, () => this.emit());
  }

  /** @internal */ get engine() { return this.dv.opts.engine; }
  /** @internal */ get host() { return this.dv.opts.word; }

  /** 글 칸 차례 (화면 순서 — 표 · 사진 등은 건너뛴다) */
  private parts(): HTMLElement[] { return [...this.dv.page.querySelectorAll<HTMLElement>('.dn-doc-text[data-part]')]; }
  private partEl(contentId: Id): HTMLElement | null { return this.dv.page.querySelector<HTMLElement>(`.dn-doc-text[data-part="${contentId}"]`); }

  /** keepUndo: 직전 실행 취소 항목과 이어 쓰기 (범위를 지우고 바로 친 글자 — DE-008) */
  open(part: HTMLElement, at: At, opts: { keepUndo?: boolean } = {}): boolean {
    const e = this.engine;
    const c = e.getContent(part.dataset.part!);
    if (!c || !isTextContent(c)) return false;
    // 앞 칸을 닫으면 그 칸 높이가 달라져 누른 칸이 움직일 수 있다 — 누른 좌표를 칸이 움직인 만큼 옮긴다 (DQ-003)
    const r0 = part.getBoundingClientRect();
    this.close(false);
    if (typeof at === 'object' && 'clientX' in at) {
      const r1 = part.getBoundingClientRect();
      at = { clientX: at.clientX + r1.left - r0.left, clientY: at.clientY + r1.top - r0.top };
    }
    if (!opts.keepUndo) e.breakUndoMerge();
    const contentId = c.id;
    const mode = c.role === 'title' ? 'title' : 'body';
    const ed = new TextEditor({
      mount: part, mode, doc: c.doc, overlay: this.dv.root, at,
      onSteps: (steps) => { editText(e, contentId, steps); },
      onUndo: () => { e.undo(); }, onRedo: () => { e.redo(); },
      // Esc: 노션처럼 고치던 블록을 고른 채로 (Delete로 지우기 · Ctrl+C 복사 …). 한 번 더 Esc면 고르기도 풀림
      onEscape: () => { const id = this.editor?.blockId; this.close(); if (id && this.engine.getBlock(id)) this.dv.select?.selectBlock(id); }, onExitNext: () => this.close(),
      onSlashInsert: (kind) => this.insert(kind),
      onPasteUrl: ({ url, view }) => insertWeb(this, url, view),
      unfurl: this.dv.opts.web?.unfurl ? (u) => this.dv.opts.web!.unfurl!(u) : undefined,
      ...(this.dv.opts.noteLinks ? { noteLinks: this.dv.opts.noteLinks } : {}), xrefs: xrefHost(e, (id) => { this.close(); this.dv.focusBlock(id); }),
      ...(this.host ? { keys: docKeymap(this.keyHost(), mode), onUpdate: () => this.emit() } : {}),
      onAiEdit: this.host?.onAiEdit ? ({ from, to, doc, at }) => this.host?.onAiEdit?.({ contentId, from, to, doc, x: at.clientX, y: at.clientY + 6 }) : undefined,
    });
    part.classList.add('dn-doc-editing');
    this.editor = { contentId, blockId: c.blockId, ed, el: part, keepEmpty: isBlankDoc(c.doc) && !e.getBlock(c.blockId)?.draft };
    this.emit();
    return true;
  }

  /** 편집 끝 — render: 그 블록을 정적 그리기로 되돌린다(다시 그리기를 부르는 쪽이 따로 하면 false) */
  close(render = true): void {
    const cur = this.editor;
    if (!cur) return;
    this.editor = null;
    cur.ed.destroy();
    this.engine.breakUndoMerge();
    // 닫은 칸은 바로 정적 글로 되돌린다 — 에디터를 떼면 칸이 비고, 다음 다시 그리기는 엔진이 바뀔 때에야 온다 (DQ-001 · 002)
    const c = this.engine.getContent(cur.contentId);
    cur.el.classList.remove('dn-doc-editing');
    if (c && isTextContent(c) && cur.el.isConnected) renderStatic(c.doc, cur.el);
    const it = this.dv.items.get(cur.blockId);
    if (it) it.sig = [];
    // 글이 없는 새 문단(초안)이거나 글을 다 지운 상자는 캔버스에서도 없앤다 — 캔버스에서 일부러 만든 빈 상자는 건드리지 않는다
    if (c && !cur.keepEmpty) discardIfEmpty(this.engine, cur.contentId, cur.room);
    if (render) this.dv.render();
    this.emit();
  }

  /** 엔진 변경으로 고치던 칸이 없어졌으면(실행 취소 등) 편집을 접는다 */
  check(): void {
    if (this.editor && !this.engine.getContent(this.editor.contentId)) { const cur = this.editor; this.editor = null; cur.ed.destroy(); this.emit(); }
  }

  /** 문서 바탕(글 칸 밖)을 눌렀을 때: 맨 아래면 새 문단(마지막이 빈 글 칸이면 거기로), 사이면 가장 가까운 글 칸 */
  pageDown(ev: MouseEvent): boolean {
    if (!this.host || this.dv.opts.readOnly) return false;
    const parts = this.parts();
    const last = this.dv.page.lastElementChild?.getBoundingClientRect();
    if (!parts.length || !last || ev.clientY > last.bottom) {
      const tail = parts[parts.length - 1];
      const c = tail && this.engine.getContent(tail.dataset.part!);
      if (tail && c && isTextContent(c) && !c.doc.content?.some((n) => n.content?.length) && tail === this.lastItemPart()) return this.open(tail, 'end');
      const r = appendTextBox(this.engine, this.host.measure({ type: 'doc', content: [{ type: 'paragraph' }] }, 600, 'text'));
      return r.ok && this.openNew(r.value.contentId, 'start');
    }
    // 세로로 가장 가까운 글 칸 — 같으면(나란한 컬럼 · 누른 항목 안) 가로로 가까운 쪽
    let best: HTMLElement | null = null, dist = Infinity;
    for (const p of parts) {
      const r = p.getBoundingClientRect();
      const dy = ev.clientY < r.top ? r.top - ev.clientY : ev.clientY > r.bottom ? ev.clientY - r.bottom : 0;
      const dx = ev.clientX < r.left ? r.left - ev.clientX : ev.clientX > r.right ? ev.clientX - r.right : 0;
      if (dy + dx / 1e4 < dist) { dist = dy + dx / 1e4; best = p; }
    }
    if (!best) return false;
    const r = best.getBoundingClientRect();
    return this.open(best, { clientX: Math.min(Math.max(ev.clientX, r.left + 1), r.right - 1), clientY: Math.min(Math.max(ev.clientY, r.top + 1), r.bottom - 1) });
  }

  /** 쪽 보기 '+': 문서 맨 끝에 새 쪽 — 글이 들어오기 전에는 초안(캔버스에 없음, 그냥 떠나면 사라짐) */
  newPage(): void {
    if (!this.host || this.dv.opts.readOnly) return;
    const r = appendTextBox(this.engine, this.host.measure({ type: 'doc', content: [{ type: 'paragraph' }] }, 600, 'text'), true);
    if (r.ok) this.openNew(r.value.contentId, 'start');
  }

  /** 문서 맨 끝 항목의 글 칸 (맨 끝이 표 · 사진이면 없음) */
  private lastItemPart(): HTMLElement | null {
    const items = this.dv.page.querySelectorAll<HTMLElement>('.dn-doc-item');
    const parts = items[items.length - 1]?.querySelectorAll<HTMLElement>('.dn-doc-text[data-part]');
    return parts?.[parts.length - 1] ?? null;
  }

  /** 엔진에 방금 만든 글 칸을 바로 그려 열기. room: 그 초안 자리를 내느라 내린 아래 상자 (글 없이 떠나면 되올림) */
  /** @internal */ openNew(contentId: Id, at: At, room?: DocRoom | null): boolean {
    this.close(false);
    this.dv.render();
    const el = this.partEl(contentId);
    if (!el) return false;
    el.scrollIntoView({ block: 'nearest' });
    if (!this.open(el, at)) return false;
    if (room && this.editor) this.editor.room = room;
    return true;
  }

  private keyHost(): DocKeyHost {
    return {
      move: (dir, x) => {
        const cur = this.editor;
        if (!cur) return false;
        const parts = this.parts(), i = parts.indexOf(cur.el);
        const next = parts[dir === 'up' || dir === 'left' ? i - 1 : i + 1];
        if (i < 0 || !next) return false;
        next.scrollIntoView({ block: 'nearest' });
        const r = next.getBoundingClientRect();
        const at: At = dir === 'left' ? 'end' : dir === 'right' ? 'start' : { clientX: x, clientY: dir === 'up' ? r.bottom - 4 : r.top + 4 };
        // 떠나는 칸은 바로 정적 그리기로 (안 그리면 다음 변경까지 빈 칸) — 같은 블록이면 칸이 새로 그려지므로 다시 찾는다
        const id = next.dataset.part!;
        this.close();
        const el = this.partEl(id);
        return !!el && this.open(el, at);
      },
      split: (cut, tail, pageBreak) => {
        const cur = this.editor, c = cur && this.engine.getContent(cur.contentId), b = cur && this.engine.getBlock(cur.blockId);
        if (!cur || !c || !isTextContent(c) || !b || !this.host) return;
        const kind = c.role === 'title' ? 'title' : 'text';
        let rest: TextDoc;
        try { rest = pmCodec.apply(c.doc, cut).doc; } catch { return; } // 스텝이 맞지 않으면(그사이 원격 변경 등) 나누지 않는다
        this.engine.breakUndoMerge();
        const r = splitTextBox(this.engine, cur.contentId, cut, tail, { h: this.host.measure(tail, b.w, 'text'), curH: this.host.measure(rest, b.w, kind), pageBreak });
        if (r.ok) this.openNew(r.value.contentId, 'start');
      },
      breakBefore: () => { if (this.editor) setPageBreak(this.engine, this.editor.blockId, true); },
      merge: (dir) => this.merge(dir),
      align: (a) => this.setAlign(a),
      // Ctrl+] · Ctrl+[: 글자를 골랐으면 고른 글자만, 아니면 상자 전체
      fontStep: (d) => { if (this.editor && !this.editor.ed.view.state.selection.empty) this.markSize(d > 0 ? 'up' : 'down'); else this.style({ fontStep: d }); },
      indent: (d) => this.indent(d),
      save: () => this.host?.onSave?.(),
      copyFormat: () => { this.painter.pick(false); },
      pasteFormat: () => this.painter.paste(),
    };
  }

  /** 맨 앞 Backspace → 앞 글 칸 끝에 이어 붙이기, 맨 끝 Delete → 다음 글 칸을 여기에. 제목 상자에는 여러 줄을 붙이지 않는다 */
  private merge(dir: 'prev' | 'next'): boolean {
    const cur = this.editor;
    if (!cur) return false;
    const parts = this.parts(), i = parts.indexOf(cur.el);
    const other = parts[dir === 'prev' ? i - 1 : i + 1];
    const e = this.engine;
    const a = e.getContent(cur.contentId), o = other && e.getContent(other.dataset.part!);
    if (!a || !o || !isTextContent(a) || !isTextContent(o)) return false;
    // 빈 칸에서 Backspace → 이 칸을 없애고 앞 글 칸 끝으로 (워드처럼 앞 문장으로) — 바로 앞이 표 · 사진 · 그래프여도 그 앞 글로 (10/29)
    const blank = (a.doc.content ?? []).every((n) => (n.type === 'paragraph' || n.type === 'heading') && !n.content?.length);
    if (dir === 'prev' && blank) {
      e.breakUndoMerge();
      if (!mergeTextBoxes(e, o.id, [], a.id).ok) return false;
      this.close(false);
      this.dv.render();
      const el = this.partEl(o.id);
      return !!el && this.open(el, 'end');
    }
    // 문서 차례에서 바로 이웃한 칸이 글이 아니면(표 · 사진 · 그래프 …) 건너뛰어 합치지 않는다
    const all = [...this.dv.page.querySelectorAll<HTMLElement>('[data-part]')].filter((el) => !el.parentElement?.closest('[data-part]'));
    const near = all[all.indexOf(cur.el) + (dir === 'prev' ? -1 : 1)];
    if (near && near !== other) return true;
    const [into, from] = dir === 'prev' ? [o, a] : [a, o];
    if (into.role === 'title') {
      // 제목 뒤 글이 있는 칸 맨 앞에서 Backspace → 제목 끝으로 옮기기만 (제목 상자에는 여러 줄을 붙이지 않는다)
      if (dir === 'prev') {
        this.close(false);
        const el = this.partEl(into.id);
        return !!el && this.open(el, 'end');
      }
      return false;
    }
    const { steps, caret } = appendDocSteps(into.doc, from.doc);
    e.breakUndoMerge();
    const r = mergeTextBoxes(e, into.id, steps, from.id);
    return r.ok && this.openNew(into.id, { pos: caret });
  }

  // ───────── 서식 막대 (앱) ─────────

  /** 글 서식 · 문단 모양 (굵게 · 제목 단계 · 목록 · 수식 · 구분선 …) */
  format(cmd: FormatCommand, arg?: unknown): void {
    if (cmd === 'link') this.editor?.ed.promptLink(); // 링크는 주소를 물어야 한다 (DQ-004)
    else this.editor?.ed.exec(cmd, arg);
  }

  setAlign(a: BlockAlign): void { this.style({ align: a }); }
  setFontScale(s: number): void { this.style({ fontScale: s }); }
  /** 글꼴: 글자를 골랐으면 고른 글자만, 아니면 상자 전체 */
  setFont(f: 'sans' | 'serif' | 'mono'): void {
    if (this.editor && !this.editor.ed.view.state.selection.empty) this.mark('fontFamily', f); else this.style({ fontFamily: f === 'sans' ? null : f });
  }
  setTextColor(c: string | null): void { this.style({ textColor: c }); }
  /** 고른 글자만 글자 크기 (배율 · 한 칸 위 · 아래, 1이면 지움) */
  markSize(to: number | 'up' | 'down'): void { this.mark('fontSize', to); }
  /** 고른 글자만 글자 색 · 배경 색 (노션처럼) — 비우면 지움 */
  markColor(kind: 'textColor' | 'bgColor', c: string | null): void { this.mark(kind, c ?? ''); }
  private mark(cmd: FormatCommand, arg: unknown): void {
    const cur = this.editor;
    if (!cur) return;
    cur.ed.exec(cmd, arg);
    cur.ed.focus();
    this.emit();
  }

  setLineHeight(h: number): void { this.style({ lineHeight: h }); }
  /** 문서에서 글 칸 누르기: 누른 자리에 편집기를 열고, 각주 번호를 눌렀으면 그 각주 입력 칸까지 */
  openAt(part: HTMLElement, ev: MouseEvent): boolean {
    const fn = (ev.target as Element | null)?.closest?.('.dn-fn');
    const i = fn ? [...part.querySelectorAll('.dn-fn')].indexOf(fn) : -1;
    const ok = this.open(part, { clientX: ev.clientX, clientY: ev.clientY });
    if (ok && i >= 0) requestAnimationFrame(() => this.editor?.el.querySelectorAll('.dn-fn')[i]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    return ok;
  }
  /** 기호 · 이모지 고르기 판 (서식 막대) */
  symbols(kind: 'symbol' | 'emoji' | 'xref'): void { this.editor?.ed.openSymbols(kind); }
  /** 첫 줄 · 문단 앞뒤 간격 (서식 막대 '줄 · 문단') */
  setParagraph(p: { firstLine?: number; spaceBefore?: number; spaceAfter?: number }): void { this.style(p); }

  /** 들여쓰기 · 내어쓰기: 목록 안이면 항목 단계, 밖이면 상자 들여쓰기. 더 내어 쓸 수 없으면 false */
  indent(d: 1 | -1): boolean {
    const cur = this.editor, b = cur && this.engine.getBlock(cur.blockId);
    if (!cur || !b) return false;
    if (['bullet', 'ordered', 'task'].some((k) => cur.ed.isActive(k as FormatCommand))) { cur.ed.exec(d > 0 ? 'indent' : 'outdent'); this.emit(); return true; }
    if (d < 0 && !b.indent) return false;
    this.style({ indentStep: d });
    return true;
  }

  private style(p: Parameters<typeof setBlockTextStyle>[2]): void {
    const cur = this.editor;
    if (!cur) return;
    setBlockTextStyle(this.engine, [cur.blockId], p);
    cur.ed.focus();
    this.emit();
  }

  /** 지금 상자 앞에서 쪽 나눔 켜고 끄기 */
  togglePageBreak(): void {
    const cur = this.editor, b = cur && this.engine.getBlock(cur.blockId);
    if (!cur || !b) return;
    setPageBreak(this.engine, b.id, !b.pageBreak);
    cur.ed.focus();
    this.emit();
  }

  /** 표 · 사진 · 그래프 · 파일 · 녹음 · 목차 · 데이터베이스를 지금 상자 바로 아래에 (doc-insert.ts) */
  insert(kind: string, size?: TableSize): void { insertBelow(this, kind, size); }

  /**
   * 블록 넣기 전 (doc-insert.ts): 글 있는 상자의 빈 줄에 커서가 있으면 그 줄을 없애고, 뒤에 글이 있으면 거기서 상자를 나눈다 —
   * 블록이 빈 줄 자리에 들어가고 빈 줄은 남지 않게 (DQ-028). 바깥 트랜잭션 안에서. 값: 줄을 없앴는지 · 남은 이 상자 높이(측정)
   */
  /** @internal */ takeBlankLine(): { took: boolean; curH?: number } {
    const cur = this.editor, c = cur && this.engine.getContent(cur.contentId), b = cur && this.engine.getBlock(cur.blockId);
    if (!cur || !c || !isTextContent(c) || !b || !this.host) return { took: false };
    const kind = c.role === 'title' ? 'title' : 'text';
    const line = kind === 'title' ? null : blankLineCut(cur.ed.view.state);
    let rest: TextDoc | null = null;
    try { if (line) rest = pmCodec.apply(c.doc, line.cut).doc; } catch { rest = null; } // 스텝이 맞지 않으면 그대로
    if (!line || !rest) return { took: false, curH: this.host.measure(cur.ed.doc, b.w, kind) };
    const curH = this.host.measure(rest, b.w, kind);
    if (isBlankDoc(line.tail)) editText(this.engine, cur.contentId, line.cut);
    else splitTextBox(this.engine, cur.contentId, line.cut, line.tail, { h: this.host.measure(line.tail, b.w, 'text'), curH });
    return { took: true, curH };
  }

  get ui(): DocUiState { return docUiState(this.engine, this.editor, this.painter.mode); }

  /** 상태가 바뀌었을 때만 알린다 (입력마다 부르지만 같으면 조용히) */
  emit(): void {
    const h = this.host?.onUi;
    if (!h) return;
    const s = this.ui;
    const key = JSON.stringify(s);
    if (key === this.uiKey) return;
    this.uiKey = key;
    h(s);
  }
}
