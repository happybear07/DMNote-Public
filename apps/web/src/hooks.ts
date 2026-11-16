// 여러 화면이 같이 쓰는 작은 React 훅.
import { useEffect, useRef } from 'react';

/** Esc를 누르면 fn — on이 거짓이면 듣지 않는다. fn은 렌더마다 새로 넘겨도 리스너를 다시 달지 않는다 */
export function useEscape(fn: () => void, on = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') ref.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on]);
}
