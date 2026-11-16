// 글꼴 · 글자 크기 칸 (알파 10/31): 글꼴은 지금 글꼴만 보이고 누르면 목록, 크기는 px 숫자를 치거나 ▾ 목록에서.
// 블록 메뉴 › 글자 모양(목록이 메뉴 안에서 아래로 펼쳐짐 — 판이 넘치면 스크롤되므로)과 문서 서식 막대(float — 칸 아래에 띄움)가 같이 쓴다.
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { FONT_FAMILY_LABEL, FONT_PX_LIST } from '@dn/engine-core';

export type FamilyChoice = 'sans' | 'serif' | 'mono';
const FAMILIES: readonly FamilyChoice[] = ['sans', 'serif', 'mono'];
const CARET = <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const fmt = (n: number) => String(Math.round(n * 10) / 10);
/** 단추를 눌러도 고치던 글의 초점 · 선택을 그대로 (숫자 칸만 초점을 받는다) */
const keep = (e: MouseEvent) => e.preventDefault();

/** 바깥을 누르면 닫기 (float 목록) */
function useOutside(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [open, ref, close]);
}

/** 글꼴: 지금 글꼴(그 글꼴 모양으로) 하나 — 누르면 고를 수 있는 글꼴 목록. value가 null이면 섞임 */
export function FontPick({ value, onPick, open, onOpen, float, disabled }: {
  value: FamilyChoice | null; onPick: (f: FamilyChoice) => void; open: boolean; onOpen: (v: boolean) => void; float?: boolean; disabled?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useOutside(open && !!float, ref, () => onOpen(false));
  return (
    <span ref={ref} className={`fc-pick${float ? ' float' : ''}`}>
      <button type="button" className={`fc-btn ff-${value ?? 'sans'}`} aria-label={`글꼴: ${value ? FONT_FAMILY_LABEL[value] : '섞임'}`} aria-haspopup="listbox" aria-expanded={open} disabled={disabled}
        title="글꼴 — 눌러서 고르기" onMouseDown={keep} onClick={() => onOpen(!open)}>
        <span>{value ? FONT_FAMILY_LABEL[value] : '—'}</span>{CARET}
      </button>
      {open && (
        <span className="fc-list" role="listbox" aria-label="글꼴">
          {FAMILIES.map((f) => (
            <button key={f} type="button" role="option" aria-selected={f === value} className={`ff-${f}${f === value ? ' on' : ''}`} onMouseDown={keep}
              onClick={() => { onPick(f); onOpen(false); }}>{FONT_FAMILY_LABEL[f]}</button>
          ))}
        </span>
      )}
    </span>
  );
}

/** 글자 크기 (px): 숫자를 치고 Enter · 칸을 떠나면 적용, ▾로 목록. px가 null이면 섞임(빈 칸) */
export function PxSize({ px, base, min, max, onSet, open, onOpen, float, disabled }: {
  px: number | null; base: number; min: number; max: number; onSet: (px: number) => void; open: boolean; onOpen: (v: boolean) => void; float?: boolean; disabled?: boolean;
}) {
  const now = px === null ? '' : fmt(px);
  const [draft, setDraft] = useState(now);
  useEffect(() => setDraft(now), [now]);
  const ref = useRef<HTMLSpanElement>(null);
  useOutside(open && !!float, ref, () => onOpen(false));
  const apply = () => {
    const n = Number(draft.replace(',', '.'));
    if (!draft.trim() || !Number.isFinite(n) || n <= 0) { setDraft(now); return; }
    const v = Math.max(min, Math.min(max, n));
    if (fmt(v) === now) setDraft(now); else onSet(v);
  };
  const sizes = [...new Set([...FONT_PX_LIST, base])].filter((n) => n >= min && n <= max).sort((a, b) => a - b);
  return (
    <span ref={ref} className={`fc-size${float ? ' float' : ''}`}>
      <span className="fc-size-box" aria-disabled={disabled || undefined} title={`글자 크기 (px) — 숫자를 치고 Enter (${fmt(min)} ~ ${fmt(max)}), 기본 ${fmt(base)}px`}>
        <input type="text" inputMode="decimal" aria-label="글자 크기 (px)" placeholder="—" value={draft} disabled={disabled}
          onChange={(e) => setDraft(e.target.value)} onBlur={apply} onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } else if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); onOpen(true); } }} />
        <span className="fc-unit" aria-hidden="true">px</span>
        <button type="button" className="fc-drop" aria-label="글자 크기 목록" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onMouseDown={keep} onClick={() => onOpen(!open)}>{CARET}</button>
      </span>
      {open && (
        <span className="fc-list fc-sizes" role="listbox" aria-label="글자 크기">
          {sizes.map((n) => (
            <button key={n} type="button" role="option" aria-selected={now === fmt(n)} className={now === fmt(n) ? 'on' : ''} onMouseDown={keep} onClick={() => { onSet(n); onOpen(false); }}>
              {fmt(n)}{n === base && <small>기본</small>}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
