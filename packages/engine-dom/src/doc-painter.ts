// 문서 뷰 서식 복사 (워드 붓): 지금 칸의 글자 서식 + 상자 모양(글꼴 · 크기 · 색 · 맞춤 · 줄 · 문단 간격)을 담아 두고,
// 다음에 글자를 고르면 글자 서식을, 그냥 누르면 그 상자 모양을 입힌다. 한 번 누르면 한 번, 두 번 누르면 Esc까지 계속 (워드와 같음).
// Ctrl+Alt+C = 담기, Ctrl+Alt+V = 지금 고른 곳에 바로 입히기 (워드의 Ctrl+Shift+C는 브라우저 개발자 도구 키).
import { setBlockTextStyle, type Block, type Engine, type Id, type TextStylePatch } from '@dn/engine-core';
import { copyMarks, pasteMarks, syncDomSelection, type MarkCopy, type TextEditor } from '@dn/text-pm';

type Cur = { ed: TextEditor; blockId: Id } | null;

/** 상자 모양 — 없는 항목은 null로 담아 받는 쪽도 기본으로 되돌린다 */
function styleOf(b: Block | undefined): TextStylePatch {
  return {
    fontScale: b?.fontScale ?? null, fontFamily: b?.fontFamily ?? null, textColor: b?.textColor ?? null, align: b?.align ?? null,
    lineHeight: b?.lineHeight ?? null, firstLine: b?.firstLine ?? null, spaceBefore: b?.spaceBefore ?? null, spaceAfter: b?.spaceAfter ?? null,
  };
}

export class FormatPainter {
  /** 칠하는 중인 서식 (마우스) · 마지막으로 담은 서식 (Ctrl+Alt+V는 칠하기가 끝나도 이것으로) */
  private copy: { marks: MarkCopy; style: TextStylePatch; sticky: boolean } | null = null;
  private last: { marks: MarkCopy; style: TextStylePatch } | null = null;

  constructor(private readonly engine: Engine, private readonly cur: () => Cur, private readonly root: HTMLElement, private readonly changed: () => void) {}

  /** 칠하는 중: 'once' · 'sticky' · null */
  get mode(): 'once' | 'sticky' | null { return this.copy ? (this.copy.sticky ? 'sticky' : 'once') : null; }

  /** 지금 칸의 서식을 담는다. 이미 칠하는 중이면(같은 단추 다시) 그만 */
  pick(sticky: boolean): boolean {
    const c = this.cur();
    if (this.copy && !sticky) { this.stop(); return true; }
    if (!c) return false;
    this.last = { marks: copyMarks(c.ed.view.state), style: styleOf(this.engine.getBlock(c.blockId)) };
    this.copy = { ...this.last, sticky };
    this.root.classList.add('dn-painting');
    document.addEventListener('keydown', this.onKey, true);
    c.ed.focus();
    this.changed();
    return true;
  }

  /** 문서에서 마우스를 뗀 뒤: 고른 글자면 글자 서식, 그냥 누른 거면 그 상자 모양. 한 번이면 끝 */
  up(): void {
    const c = this.cur();
    if (!this.copy || !c) return;
    syncDomSelection(c.ed.view);
    this.paste();
  }

  /** 담아 둔 서식을 지금 고른 곳에 (Ctrl+Alt+V · 마우스) — 담아 둔 게 없으면 false. 한 번 칠하기였으면 끝 */
  paste(): boolean {
    const ok = this.apply();
    if (ok && this.copy && !this.copy.sticky) this.stop();
    return ok;
  }

  private apply(): boolean {
    const c = this.cur(), cp = this.copy ?? this.last;
    if (!c || !cp) return false;
    const st = c.ed.view.state;
    if (!st.selection.empty) pasteMarks(cp.marks)(st, c.ed.view.dispatch);
    else setBlockTextStyle(this.engine, [c.blockId], cp.style);
    c.ed.focus();
    this.changed();
    return true;
  }

  stop(): void {
    if (!this.copy) return;
    this.copy = null;
    this.root.classList.remove('dn-painting');
    document.removeEventListener('keydown', this.onKey, true);
    this.changed();
  }

  private readonly onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') this.stop(); };
}
