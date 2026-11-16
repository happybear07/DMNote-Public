// 문서 뷰 블록 고르기 (노션 · 워드처럼): 글이 아닌 항목(사진 · 그래프 · 데이터베이스 · 파일 · 목차 · 손그림 …)을 누르면 그 블록,
// 글을 누른 채 다른 항목까지 끌면 사이의 블록 전부, Shift+누르기는 범위 넓히기, 고치는 중 Esc = 그 블록 고르기,
// Ctrl+A 두 번 = 모두, Shift+↑↓ = 위아래로 넓히기. 고른 블록은 Delete · Backspace로 지우고 Ctrl+C · X · V · D로 복사 · 잘라내기 · 붙여넣기 · 복제.
// 모두 실행 취소 한 번 (같은 엔진이라 캔버스도 함께).
import { BLOCK_CLIP_MIME, blockClip, deleteDocBlocks, docText, groupBlocks, insertClipBelow, isBlockClip, isTextContent, ungroupBlocks, type Id } from '@dn/engine-core';
import type { DocView } from './doc-view';

export class DocSelect {
  /** 고른 항목 — 문서 차례의 [anchor, head] 범위 (항목 순번) */
  private anchor = -1;
  private head = -1;
  /** native: 이미 열려 있던 칸에서 누름 — 그 칸 안 끌기 선택은 브라우저 · 편집기에 맡긴다 */
  private drag: { from: number; pmFrom: number | null; text: boolean; ranging: boolean; native: boolean } | null = null;
  private readonly ac = new AbortController();

  constructor(private readonly dv: DocView) {
    const signal = this.ac.signal, root = dv.root;
    root.addEventListener('keydown', (e) => this.onKey(e), { capture: true, signal });
    document.addEventListener('copy', (e) => this.onClip(e, false), { signal });
    document.addEventListener('cut', (e) => this.onClip(e, true), { signal });
    document.addEventListener('paste', (e) => this.onPaste(e), { capture: true, signal });
    window.addEventListener('mousemove', (e) => this.onMove(e), { signal });
    window.addEventListener('mouseup', () => { this.drag = null; this.dv.range.endDrag(); }, { signal });
  }

  get active(): boolean { return this.anchor >= 0; }

  /** 문서 차례의 항목들 (블록 · 손그림) */
  private items(): HTMLElement[] {
    return [...this.dv.page.querySelectorAll<HTMLElement>('.dn-doc-item')];
  }

  private itemAt(t: EventTarget | null): HTMLElement | null {
    return t instanceof Element ? t.closest<HTMLElement>('.dn-doc-item') : null;
  }

  /** 고른 블록 id · 손그림 획 id */
  selected(): { blocks: Id[]; strokes: Id[] } {
    if (!this.active) return { blocks: [], strokes: [] };
    const all = this.items(), lo = Math.min(this.anchor, this.head), hi = Math.max(this.anchor, this.head);
    const els = all.slice(lo, hi + 1);
    return {
      blocks: els.flatMap((el) => (el.dataset.id ? [el.dataset.id] : [])),
      strokes: els.flatMap((el) => (el.dataset.strokes ? el.dataset.strokes.split(',') : [])),
    };
  }

  /** [from, to] 항목을 고른다 (글 편집은 닫는다) */
  select(from: number, to = from): void {
    const n = this.items().length;
    if (!n) return this.clear();
    this.anchor = Math.max(0, Math.min(n - 1, from));
    this.head = Math.max(0, Math.min(n - 1, to));
    if (this.dv.word.editor) this.dv.word.close();
    getSelection()?.removeAllRanges();
    this.paint();
    this.dv.root.focus({ preventScroll: true });
    this.items()[this.head]?.scrollIntoView({ block: 'nearest' });
  }

  /** 이 블록 하나 고르기 */
  selectBlock(id: Id): void {
    const i = this.items().findIndex((el) => el.dataset.id === id);
    if (i >= 0) this.select(i);
  }

  clear(): void {
    if (!this.active) return;
    this.anchor = this.head = -1;
    this.paint();
  }

  /** 다시 그린 뒤에도 고른 표시를 유지 */
  paint(): void {
    const all = this.items(), lo = Math.min(this.anchor, this.head), hi = Math.max(this.anchor, this.head);
    if (this.active && hi >= all.length) { this.anchor = Math.min(this.anchor, all.length - 1); this.head = Math.min(this.head, all.length - 1); }
    all.forEach((el, i) => el.classList.toggle('dn-doc-sel', this.active && i >= lo && i <= hi));
  }

  /**
   * 문서 뷰 mousedown (DocView.onDown이 먼저 부른다). 처리했으면 true.
   * 글 칸이면 끌기만 지켜보고 false — 글 편집은 그대로 열린다.
   */
  down(ev: MouseEvent): boolean {
    const el = this.itemAt(ev.target);
    const all = this.items(), i = el ? all.indexOf(el) : -1;
    if (ev.button !== 0) return false;
    if (i < 0) { this.clear(); return false; }
    // Shift+누르기: 고른 범위(없으면 고치던 칸)에서 여기까지
    const t = ev.target as Element;
    const textPart = t.closest('.dn-doc-text[data-part]');
    // Shift+누르기 글 칸: 글자 범위 (워드처럼). 이미 범위가 있으면 머리만, 고치던 칸이 있으면 그 커서부터
    if (ev.shiftKey && textPart && !textPart.classList.contains('dn-doc-editing')) {
      if (this.dv.range.extendHead(ev.clientX, ev.clientY) || this.dv.range.extendTo(ev.clientX, ev.clientY)) { ev.preventDefault(); this.clear(); return true; }
    }
    if (ev.shiftKey) {
      const curEl = this.dv.word.editor?.el.closest<HTMLElement>('.dn-doc-item');
      const from = this.active ? this.anchor : curEl ? all.indexOf(curEl) : -1;
      if (from >= 0 && from !== i) { ev.preventDefault(); this.select(from, i); return true; }
    }
    const text = t.closest('.dn-doc-text[data-part], .dn-table');
    if (!text) { ev.preventDefault(); this.select(i); return true; }
    this.clear();
    this.drag = { from: i, pmFrom: null, text: !!textPart, ranging: false, native: !!textPart?.classList.contains('dn-doc-editing') };
    return false;
  }

  private onMove(ev: MouseEvent): void {
    const d = this.drag;
    if (!d || !(ev.buttons & 1)) { this.drag = null; return; }
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const el = this.itemAt(hit);
    const all = this.items(), i = el ? all.indexOf(el) : -1;
    // 글 칸에서 시작해 다른 항목으로 넘어가면 글자 범위 (워드처럼). 표에서 시작하면 블록 단위
    if (d.text && (d.ranging || (i >= 0 && i !== d.from))) { d.ranging = this.dv.range.dragTo(ev.clientX, ev.clientY); if (d.ranging) return; }
    if (i >= 0 && i !== d.from) { this.select(d.from, i); return; }
    if (this.active && i === d.from) { this.clear(); }
    // 같은 칸 안: 처음 누른 칸은 편집기가 막 열려 브라우저 끌기 선택이 없다 — 누른 자리 ~ 지금 자리를 직접 고른다
    // 이미 열려 있던 칸이면 브라우저 끌기 선택이 이미 있다 — 같이 고르면 둘이 다퉈 글자가 옮겨진다
    const cur = this.dv.word.editor;
    if (d.native || !cur || this.active || !hit || !cur.el.contains(hit)) return;
    d.pmFrom = cur.ed.dragTo(ev, d.pmFrom ?? undefined);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.dv.opts.readOnly) return;
    // 웹 주소 칸 · 열 이름 칸 같은 입력 칸의 키는 그 칸 몫 — 블록을 고른 채여도 지우기 · Ctrl+A가 블록으로 가지 않게 (DQ-016)
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const mod = e.ctrlKey || e.metaKey;
    if (this.dv.range.active) {
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); getSelection()?.removeAllRanges(); this.select(0, this.items().length - 1); return; }
      if (this.dv.range.key(e)) { e.stopPropagation(); return; }
    }
    if (e.isComposing) return;
    const cur = this.dv.word.editor;
    if (cur && !this.active) {
      const all = this.items(), here = all.indexOf(cur.el.closest<HTMLElement>('.dn-doc-item')!);
      // Ctrl+A: 칸 안을 이미 다 골랐으면 문서 전체 블록
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'a' && cur.ed.allSelected) { e.preventDefault(); e.stopPropagation(); this.select(0, all.length - 1); return; }
      // Shift+↑↓: 칸 끝에서 더 가면 블록 단위로 넓히기
      if (e.shiftKey && !mod && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && here >= 0) {
        const down = e.key === 'ArrowDown';
        if (cur.ed.atEdge(down ? 'down' : 'up') && here + (down ? 1 : -1) >= 0 && here + (down ? 1 : -1) < all.length) {
          e.preventDefault(); e.stopPropagation();
          this.dv.range.extendFromEditor(down ? 'down' : 'up');
        }
      }
      return;
    }
    // 편집기 밖(블록을 고른 채 · 지운 뒤)에서도 실행 취소 · 다시 실행
    if (!cur && mod && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y') && e.target === this.dv.root) {
      e.preventDefault();
      const e2 = this.dv.opts.engine;
      if (e.key.toLowerCase() === 'y' || e.shiftKey) e2.redo(); else e2.undo();
      this.clear();
      return;
    }
    if (!this.active) return;
    const all = this.items();
    if (e.key === 'Escape') { e.preventDefault(); this.clear(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.remove(); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey) { e.preventDefault(); this.dv.handle?.stepSelected(e.key === 'ArrowUp' ? -1 : 1); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const to = Math.max(0, Math.min(all.length - 1, this.head + (e.key === 'ArrowDown' ? 1 : -1)));
      if (e.shiftKey) this.select(this.anchor, to); else this.select(to);
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); this.select(0, all.length - 1); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicate(); return; }
    if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); this.group(!e.shiftKey); return; }
    // Enter: 고른 글 블록을 고치기로 (끝에 커서)
    if (e.key === 'Enter' && this.anchor === this.head) {
      const part = all[this.head]?.querySelector<HTMLElement>('.dn-doc-text[data-part]');
      if (part) { e.preventDefault(); this.clear(); this.dv.word.open(part, 'end'); }
    }
  }

  /** 고른 블록 · 손그림 지우기. 지운 자리 다음 항목을 고른 채로 둔다 */
  remove(): void {
    const { blocks, strokes } = this.selected();
    if (!blocks.length && !strokes.length) return;
    const at = Math.min(this.anchor, this.head);
    this.anchor = this.head = -1;
    deleteDocBlocks(this.dv.opts.engine, blocks, strokes); // 흐름 가운데 단계면 앞뒤를 잇는다 (DE-005)
    this.dv.render();
    if (this.items().length) this.select(Math.min(at, this.items().length - 1));
  }

  duplicate(): void {
    const { blocks } = this.selected();
    if (!blocks.length) return;
    const e = this.dv.opts.engine;
    const r = insertClipBelow(e, blocks[blocks.length - 1]!, blockClip(e, blocks), '블록 복제');
    if (r.ok) this.afterInsert(r.value);
  }

  /** 고른 상자들을 한 블록으로 묶기 (Ctrl+G, 둘 이상) · 풀기 (Ctrl+Shift+G) — 캔버스와 같은 묶음, 실행 취소 한 번 */
  group(on: boolean): void {
    const { blocks } = this.selected();
    const e = this.dv.opts.engine;
    if (on ? blocks.length < 2 : !blocks.some((id) => e.getBlock(id)?.group)) return;
    if (on) groupBlocks(e, blocks); else ungroupBlocks(e, blocks);
    this.afterInsert(blocks);
  }

  private afterInsert(ids: Id[]): void {
    this.dv.render();
    const all = this.items(), idx = ids.map((id) => all.findIndex((el) => el.dataset.id === id)).filter((i) => i >= 0);
    if (idx.length) this.select(Math.min(...idx), Math.max(...idx));
  }

  private onClip(ev: ClipboardEvent, cut: boolean): void {
    if (cut && !this.dv.opts.readOnly && this.dv.range.cut(ev)) return;
    if (!this.active || !this.dv.root.contains(document.activeElement) || !ev.clipboardData) return;
    const { blocks } = this.selected();
    if (!blocks.length) return;
    const e = this.dv.opts.engine;
    ev.preventDefault();
    ev.clipboardData.setData(BLOCK_CLIP_MIME, JSON.stringify(blockClip(e, blocks)));
    ev.clipboardData.setData('text/plain', blocks.flatMap((id) => e.contentsOf(id).filter(isTextContent).map((c) => docText(c.doc))).join('\n\n'));
    if (cut && !this.dv.opts.readOnly) this.remove();
  }

  /** 블록 묶음 붙여넣기: 고른 블록 · 고치던 칸 바로 아래에 (글만 든 클립은 편집기 몫) */
  private onPaste(ev: ClipboardEvent): void {
    if (this.dv.opts.readOnly || !this.dv.root.contains(document.activeElement)) return;
    if (this.dv.range.paste(ev)) { ev.stopPropagation(); return; }
    const raw = ev.clipboardData?.getData(BLOCK_CLIP_MIME);
    if (!raw) return;
    let clip: unknown;
    try { clip = JSON.parse(raw); } catch { return; }
    if (!isBlockClip(clip)) return;
    ev.preventDefault(); ev.stopPropagation();
    const below = this.active ? this.selected().blocks.at(-1) ?? null : this.dv.word.editor?.blockId ?? null;
    const r = insertClipBelow(this.dv.opts.engine, below, clip);
    if (r.ok) this.afterInsert(r.value);
  }

  destroy(): void { this.ac.abort(); }
}
