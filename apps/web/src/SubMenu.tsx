// 메뉴 안 하위 메뉴 (DS-001): 줄에 마우스를 올리거나 누르면(→ 키도) 옆에 판이 열린다. 한 번에 하나 — 열린 것은 부모가 갖는다.
// 판은 메뉴 DOM 안에 두어 '바깥 누르면 닫기'가 그대로 동작하고, 오른쪽이 모자라면 왼쪽으로 · 아래가 모자라면 위로 붙인다.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function SubMenu({ id, label, open, setOpen, children, hint }: {
  id: string; label: string; open: string | null; setOpen: (v: string | null) => void; children: ReactNode;
  /** 줄 오른쪽 작은 글 (지금 값 · 단축키) */
  hint?: string;
}) {
  const on = open === id;
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: boolean; dy: number }>({ left: false, dy: 0 });
  useLayoutEffect(() => {
    if (!on || !panel.current) return;
    const r = panel.current.getBoundingClientRect();
    setPlace({ left: r.right > innerWidth - 8, dy: Math.min(0, innerHeight - 8 - r.bottom) });
  }, [on]);
  return (
    <div className="menu-sub" onMouseEnter={() => setOpen(id)}>
      <button role="menuitem" aria-haspopup="menu" aria-expanded={on} className={on ? 'open' : ''}
        onClick={() => setOpen(id) /* 누르면 열기만 — 올려서 열린 판을 누르기가 닫지 않게 */}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'Enter') return;
          e.preventDefault();
          setOpen(id);
          requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('button, select, input')?.focus());
        }}>
        <span>{label}</span>
        <span className="menu-sub-end">{hint && <kbd>{hint}</kbd>}<span className="menu-caret" aria-hidden="true" /></span>
      </button>
      {on && (
        <div ref={panel} className={`menu menu-panel${place.left ? ' left' : ''}`} role="menu" aria-label={label} style={{ marginTop: place.dy }}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.stopPropagation(); setOpen(null); } }}>
          {children}
        </div>
      )}
    </div>
  );
}
