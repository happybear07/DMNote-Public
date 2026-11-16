// 그래프 색 고르기 판 (그래프 창 — 견본 · 미리보기의 막대 · 조각 · 선을 누르면): 지금 색 묶음 여덟 색, 팔레트(무채색 + 색상 10 × 밝기 5),
// 직접 고르기(색상 선택기 · #코드), 기본 색으로. 색은 #rrggbb로만 — SVG 속성에 그대로 들어가 워드 · 그림 내보내기도 같은 색.
// 그래프 창 위에 뜨므로 Esc는 이 판만 닫는다(창은 그대로).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { normalizeTextColor } from '@dn/engine-core';
import { PALETTE } from './ColorPalette';

export function ChartColorPop({ at, place = 'below', title, label, paletteButton, value, current, palette, onPick, onClose }: {
  at: { x: number; y: number };
  /** 판 이름 (화면 낭독기) — 없으면 title */
  label?: string;
  /** 팔레트(60색 · 직접 고르기)를 무지개 고리 단추 뒤에 접어 두기 — 필기 막대 ＋(추천 색 먼저) */
  paletteButton?: boolean;
  /** above: at.y가 판의 아래 끝 (화면 아래 막대에서 위로 띄울 때 — 필기 막대) */
  place?: 'below' | 'above';
  /** 머리 글 — "계열 색 · 매출" */
  title: string;
  /** 직접 고른 색 (없으면 색 묶음 색을 쓰는 중) · 지금 보이는 색 */
  value: string | undefined; current: string;
  palette: readonly string[];
  onPick: (c: string | null) => void; onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState(current);
  const [bad, setBad] = useState(false);
  const [pos, setPos] = useState(at);
  const [open, setOpen] = useState(!paletteButton);
  // 화면 밖으로 나가지 않게
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const y = place === 'above' ? at.y - r.height : at.y;
    setPos({ x: Math.max(8, Math.min(at.x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
    box.current?.focus({ preventScroll: true });
  }, [at.x, at.y, place, open]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', down, true);
    return () => document.removeEventListener('mousedown', down, true);
  }, [onClose]);
  const pickHex = (raw: string) => {
    const c = normalizeTextColor(raw.trim().startsWith('#') ? raw.trim() : `#${raw.trim()}`);
    if (!c?.startsWith('#')) { setBad(true); return; }
    onPick(c.toLowerCase());
    onClose();
  };
  // 색상 선택기는 끄는 동안 input이 계속 오므로 창을 닫을 때(change) 한 번만
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const done = () => pickHex(el.value);
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  });
  const dot = (c: string, key: string) => (
    <button key={key} type="button" className={`cp-dot${current.toLowerCase() === c.toLowerCase() ? ' on' : ''}`} style={{ background: c }} title={c} aria-label={`색 ${c}`} onClick={() => pickHex(c)} />
  );
  return createPortal(
    <div ref={box} tabIndex={-1} className="chart-color-pop color-palette" role="dialog" aria-label={label ?? title} style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      <div className="cp-title">{title}</div>
      <div className="cp-grid" role="group" aria-label={paletteButton ? '추천 색' : '색 묶음'}>{palette.map((c, i) => dot(c, `p${i}`))}</div>
      {paletteButton && (
        <button type="button" className="cp-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="cp-rainbow cp-ring" aria-hidden="true"><i /></span>{open ? '팔레트 접기' : '팔레트에서 고르기'}<span aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
      )}
      {open && (
        <>
          <div className="cp-title">팔레트</div>
          <div className="cp-grid" role="group" aria-label="팔레트">{PALETTE.map((c) => dot(c, c))}</div>
          <div className="cp-custom">
            <label className="cp-picker" title="색상 선택기 — 원하는 색을 직접">
              <input ref={picker} type="color" defaultValue={current} aria-label="색상 선택기" />
            </label>
            <input className={`cp-code${bad ? ' bad' : ''}`} value={code} maxLength={7} spellCheck={false} aria-label="색 코드 (#rrggbb)" aria-invalid={bad}
              onChange={(e) => { setCode(e.target.value); setBad(false); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pickHex(code); } }} />
            <button type="button" className="cp-apply" onClick={() => pickHex(code)}>적용</button>
          </div>
        </>
      )}
      {value && <button type="button" className="cp-more" onClick={() => { onPick(null); onClose(); }}>색 묶음 색으로 되돌리기</button>}
    </div>,
    document.body,
  );
}
