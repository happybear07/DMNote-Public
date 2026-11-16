// 오른쪽 클릭 › 글자 모양: 글꼴(지금 글꼴 · 누르면 목록) · 크기(px 숫자 · ▾ 목록) · 글자 색 · 정렬. 바로 적용하고 메뉴는 열어 둔다.
// 글을 고친 채 글자를 골라 두고 열면 글꼴 · 크기 · 글자 색은 고른 글자에만(워드처럼), 아니면 상자 전체.
// 글 편집 중에 연 메뉴면 잘라내기 · 복사 · 붙여넣기 · 모두 선택도 — 에디터의 초점 · 선택은 그대로 둔다.
import { useState } from 'react';
import { boxKind, FONT_BASE_PX, LINE_HEIGHTS, pxOfScale, scaleOfPx, setBlockTextStyle, TEXT_COLOR_NAMES, type TextStylePatch } from '@dn/engine-core';
import { TEXT_COLORS, type CanvasView } from '@dn/engine-dom';
import { fontFamilyAt, fontSizeAt, markColorAt, type TextEditor } from '@dn/text-pm';
import { COLOR_LABEL, ColorPalette } from './ColorPalette';
import { FontPick, PxSize, type FamilyChoice } from './FontControls';

export { COLOR_LABEL };

/** editor: 문서 뷰에서 고치는 글 (없으면 캔버스에서 고치는 글) — 글자를 골랐으면 고른 글자만 */
export function TextStyleMenu({ view, ids, editor }: { view: CanvasView; ids: string[]; editor?: TextEditor }) {
  const [, bump] = useState(0);
  const [list, setList] = useState<'font' | 'size' | null>(null);
  const st = view.engine.getBlock(ids[0]!) ?? { fontScale: undefined, fontFamily: undefined, textColor: undefined, align: undefined, lineHeight: undefined, indent: undefined };
  const set = (p: TextStylePatch) => { setBlockTextStyle(view.engine, ids, p); bump((n) => n + 1); };
  // 고른 글자 (글 편집 중 · 상자 하나 · 글자를 골랐을 때)
  const ed = editor ?? (ids.length === 1 && view.editingId === ids[0] ? view.mounted.get(ids[0]!)?.editor : undefined);
  const sel = ed && !ed.view.state.selection.empty ? ed : undefined;
  // 크기는 px: 상자 기준(제목 17 · 내용 12.5) × 상자 배율 (× 고른 글자 배율)
  const base = FONT_BASE_PX[boxKind(view.engine.contentsOf(ids[0]!)) === 'title' ? 'title' : 'text'];
  const box = st.fontScale ?? 1;
  const mark = sel ? fontSizeAt(sel.view.state) : 1;
  const px = mark === null ? null : pxOfScale(box * mark, base);
  // 글 편집 중이면 적용한 뒤 초점을 글로 (워드처럼 — 크기 칸에 남으면 이어 치는 글 · 모두 선택이 칸에 걸린다)
  const size = (v: number) => {
    if (sel) { sel.exec('fontSize', Math.max(0.5, Math.min(4, v / (base * box)))); bump((n) => n + 1); } else set({ fontScale: scaleOfPx(v, base) });
    ed?.focus();
  };
  const color = sel ? markColorAt(sel.view.state, 'textColor') : st.textColor ?? null;
  const family = sel ? fontFamilyAt(sel.view.state) : st.fontFamily ?? 'sans';
  const font = (f: FamilyChoice) => { if (sel) { sel.exec('fontFamily', f); bump((n) => n + 1); } else set({ fontFamily: f === 'sans' ? null : f }); };
  const paint = (c: string | null) => { if (sel) { sel.exec('textColor', c ?? ''); bump((n) => n + 1); } else set({ textColor: c }); };
  const open = (k: 'font' | 'size') => (v: boolean) => setList(v ? k : null);
  return (
    <>
      <div className="menu-head">{sel ? '고른 글자' : '글자'}</div>
      <div className="fc-row" role="group" aria-label="글꼴 · 글자 크기">
        <FontPick value={family} onPick={font} open={list === 'font'} onOpen={open('font')} />
        <PxSize px={px} base={base} min={pxOfScale(sel ? 0.5 * box : 0.5, base)} max={pxOfScale(sel ? 4 * box : 4, base)} onSet={size} open={list === 'size'} onOpen={open('size')} />
      </div>
      <div className="swatches text-colors" role="group" aria-label="글자 색">
        <button role="menuitemradio" aria-checked={!color} className={`tc none${!color ? ' on' : ''}`} title="기본 글자 색" aria-label="기본 글자 색" onClick={() => paint(null)}>가</button>
        {TEXT_COLOR_NAMES.map((k) => (
          <button key={k} role="menuitemradio" aria-checked={color === k} className={`tc${color === k ? ' on' : ''}`} title={`${COLOR_LABEL[k]} 글자`} aria-label={`${COLOR_LABEL[k]} 글자`}
            style={{ color: `var(--dn-tc-${k}, ${TEXT_COLORS[k]})` }} onClick={() => paint(k)}>가</button>
        ))}
      </div>
      <ColorPalette theme={false} value={color} onPick={paint} />
      <div className="align-row" role="group" aria-label="정렬">
        {([['left', '왼쪽', '⟸'], ['center', '가운데', '≡'], ['right', '오른쪽', '⟹']] as const).map(([a, label, icon]) => (
          <button key={a} role="menuitemradio" aria-checked={(st.align ?? 'left') === a} className={(st.align ?? 'left') === a ? 'on' : ''} title={`${label} 정렬`} aria-label={`${label} 정렬`} onClick={() => set({ align: a })}>
            <span aria-hidden="true">{icon}</span> {label}
          </button>
        ))}
      </div>
      <div className="align-row" role="group" aria-label="줄 간격">
        {LINE_HEIGHTS.map((h) => (
          <button key={h} role="menuitemradio" aria-checked={(st.lineHeight ?? 1) === h} className={(st.lineHeight ?? 1) === h ? 'on' : ''} title={h === 1 ? '줄 간격 기본' : `줄 간격 ${h}`} onClick={() => set({ lineHeight: h })}>
            {h === 1 ? '기본' : h}
          </button>
        ))}
      </div>
      <div className="align-row" role="group" aria-label="들여쓰기">
        <button role="menuitem" disabled={!st.indent} title="내어쓰기" onClick={() => set({ indentStep: -1 })}>⇤ 내어쓰기</button>
        <button role="menuitem" title="들여쓰기" onClick={() => set({ indentStep: 1 })}>들여쓰기 ⇥</button>
      </div>
    </>
  );
}

/** 글 편집 중 메뉴의 편집 줄: 잘라내기 · 복사 · 붙여넣기 · 모두 선택 (초점은 에디터에 둔 채)
 *  target: 붙여넣을 편집 칸 (문서 뷰 — 없으면 캔버스의 그 상자) */
export function EditRow({ view, id, onClose, onToast, target: at }: { view: CanvasView; id: string; onClose: () => void; onToast: (t: string) => void; target?: () => HTMLElement | null }) {
  const cmd = (c: 'cut' | 'copy' | 'selectAll') => () => { document.execCommand(c); if (c !== 'selectAll') onClose(); };
  const paste = async () => {
    onClose();
    const target = at ? at() : view.mounted.get(id)?.el.querySelector<HTMLElement>('.dn-text-editing');
    try {
      const text = await navigator.clipboard.readText();
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      target?.focus();
      target?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch { onToast('브라우저가 클립보드 읽기를 막았어요 — Ctrl+V로 붙여넣어 주세요.'); }
  };
  return (
    <div className="edit-row" role="group" aria-label="편집">
      <button role="menuitem" title="Ctrl+X" onClick={cmd('cut')}>잘라내기</button>
      <button role="menuitem" title="Ctrl+C" onClick={cmd('copy')}>복사</button>
      <button role="menuitem" title="Ctrl+V" onClick={() => void paste()}>붙여넣기</button>
      <button role="menuitem" title="Ctrl+A" onClick={cmd('selectAll')}>모두 선택</button>
    </div>
  );
}
