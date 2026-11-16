// 테마 (FR-086): 밝게 · 어둡게 · 시스템 따라. html[data-theme]로 CSS 토큰을 바꾼다.
// 첫 그리기 전에 바로 적용하려고 이 기기의 localStorage에도 적어 둔다 (설정 DB는 비동기라 늦다 — 깜빡임 방지).
export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'dn:theme';

const media = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  return pref === 'system' ? (media()?.matches ? 'dark' : 'light') : pref;
}

export function storedTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch { return 'system'; }
}

/** 적용하고 이 기기에 기억. 바뀌었으면 true */
export function applyTheme(pref: ThemePref): boolean {
  try { localStorage.setItem(KEY, pref); } catch { /* 사생활 보호 창 등 — 이번 실행만 */ }
  const next = resolveTheme(pref);
  const root = document.documentElement;
  if (root.dataset.theme === next) return false;
  root.dataset.theme = next;
  return true;
}

/** 시스템 설정이 바뀌면 (pref가 system일 때만) 다시 적용 */
export function watchSystemTheme(onChange: () => void): () => void {
  const m = media();
  if (!m) return () => {};
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
}
