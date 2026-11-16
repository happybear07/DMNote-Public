// 사이드바 항목 우클릭 메뉴: 노트 — 열기 · 하위 노트 · 복제(FR-077) · 이름 바꾸기 · 휴지통, 폴더 — 새 노트 · 이름 바꾸기 · 삭제.
import { useEffect, useRef } from 'react';
import type { IconName } from '@dn/text-pm';
import { Icon } from './Icon';

export interface RowMenuItem { label: string; icon: IconName; run(): void; danger?: boolean }

export function RowMenu({ x, y, items, onClose }: { x: number; y: number; items: RowMenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    ref.current?.querySelector('button')?.focus();
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  // 화면 아래 · 오른쪽 끝에서는 안쪽으로
  const top = Math.min(y, window.innerHeight - items.length * 34 - 16);
  const left = Math.min(x, window.innerWidth - 216);
  return (
    <div ref={ref} className="row-menu" role="menu" style={{ top, left }}
      onKeyDown={(e) => {
        const btns = [...(ref.current?.querySelectorAll('button') ?? [])];
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
      }}>
      {items.map((it) => (
        <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => { onClose(); it.run(); }}>
          <Icon name={it.icon} size={16} />{it.label}
        </button>
      ))}
    </div>
  );
}
