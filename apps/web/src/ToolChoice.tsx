// 도구 막대의 '고르는 도구' 단추: 누르면 지금 고른 것으로 바로 쓰고, 두 번 누르기 · 오른쪽 클릭 · ↑↓ · Shift+F10으로 종류 메뉴를 연다.
// 선택(필기 뺀 콘텐츠 · 필기만 · 둘 다) · 글 상자(제목 · 내용)가 같은 모양으로 쓴다. 메뉴는 body로 띄운다 — 좁은 화면에서
// 도구 막대가 가로로 스크롤되면(overflow) 막대 안의 메뉴는 잘려 보이지 않는다.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const svg = (icon: ReactNode) => <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>;

export interface Choice<T extends string> { readonly value: T; readonly label: string; readonly hint: string; readonly icon: ReactNode }

/** 고른 종류를 기억하는 저장 칸 — 못 읽거나 모르는 값이면 첫째 */
export function savedChoice<T extends string>(key: string, values: readonly T[]): T {
  try { const v = localStorage.getItem(key); return values.find((x) => x === v) ?? values[0]!; } catch { return values[0]!; }
}
export function saveChoice(key: string, v: string): void {
  try { localStorage.setItem(key, v); } catch { /* 저장 못 해도 이번엔 그대로 */ }
}

export function ToolChoice<T extends string>({ choices, shown, active, cls, name, menuLabel, onUse, onPick }: {
  choices: readonly Choice<T>[];
  /** 단추에 보이는 종류 (도구가 켜져 있으면 그 도구, 아니면 기억한 것) */
  shown: T;
  active: boolean;
  /** 감싸는 칸 · 메뉴에 붙는 이름 (예: 'select' → .select-tool · .select-modes) */
  cls: string;
  /** 단추 이름 (예: '선택' · '글 상자') */
  name: string;
  menuLabel: string;
  onUse(v: T): void;
  onPick(v: T): void;
}) {
  const [menuAt, setMenuAt] = useState<{ left: number; bottom: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = choices.find((c) => c.value === shown) ?? choices[0]!;

  useEffect(() => {
    if (!menuAt) return;
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const close = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuAt(null); };
    const gone = () => setMenuAt(null);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('resize', gone);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('resize', gone); };
  }, [menuAt]);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setMenuAt({ left: Math.max(8, Math.min(r.left, innerWidth - 256)), bottom: innerHeight - r.top + 10 });
  };
  const closeMenu = (refocus: boolean) => { setMenuAt(null); if (refocus) btnRef.current?.focus(); };
  const pick = (v: T) => { setMenuAt(null); onPick(v); };
  // 키보드: 단추에서 ↑ · ↓ · Shift+F10 · 메뉴 키로 열기, 메뉴 안에서 ↑↓ · Home · End로 옮기기, Esc · Tab으로 닫기
  const onBtnKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); openMenu(); }
  };
  const onMenuKey = (e: KeyboardEvent) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
    else if (e.key === 'Tab') closeMenu(false);
  };

  return (
    <span className={`tool-choice ${cls}-tool`}>
      <button ref={btnRef} className={active ? 'on' : ''} title={`${current.label} — 두 번 눌러(↑) ${menuLabel} 바꾸기`} aria-label={`${name}: ${current.label}`} aria-haspopup="menu" aria-expanded={!!menuAt}
        onClick={() => onUse(shown)} onDoubleClick={openMenu} onKeyDown={onBtnKey}
        onContextMenu={(e) => { e.preventDefault(); openMenu(); }}>
        {svg(current.icon)}
      </button>
      {menuAt && createPortal(
        <div ref={menuRef} className={`menu tool-modes ${cls}-modes`} role="menu" aria-label={menuLabel} style={menuAt} onKeyDown={onMenuKey}>
          {choices.map((c) => (
            <button key={c.value} role="menuitemradio" aria-checked={c.value === shown} className={c.value === shown ? 'on' : ''} onClick={() => pick(c.value)}>
              <span className="ti">{svg(c.icon)}</span><span><b>{c.label}</b><small>{c.hint}</small></span>
            </button>
          ))}
        </div>, document.body)}
    </span>
  );
}
