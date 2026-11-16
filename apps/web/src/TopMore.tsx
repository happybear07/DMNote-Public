// 위 막대 ⋯ (DS-009): 덜 쓰는 노트 동작을 하나로 — 캔버스 설정 · 발표 · 인쇄 · 내보내기 · 버전 기록. 단축키는 그대로.
// 메뉴 줄은 예전 단추와 같은 클래스(present-btn · export-btn)를 단다 — 다른 곳(시험 · 단축키 안내)이 같은 이름으로 찾는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { CanvasSettings } from './CanvasSettings';
import type { Workspace } from './workspace';

export function TopMore({ ws, fav }: { ws: Workspace; fav: boolean }) {
  const [open, setOpen] = useState(false);
  const [canvas, setCanvas] = useState(false); // 캔버스 설정 창 (알파 10/31)
  const closeCanvas = useCallback(() => setCanvas(false), []);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, [open]);
  const run = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="top-more" ref={ref}>
      <button className={`more-btn${open ? ' on' : ''}`} aria-label="더 보기" title="더 보기 — 발표 · 인쇄 · 내보내기 · 버전 기록"
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="more" size={16} />
      </button>
      {open && (
        <div className="menu top-more-menu" role="menu" aria-label="노트 더 보기">
          {ws.view && <button role="menuitem" className="canvas-settings-btn" onClick={run(() => setCanvas(true))}><span><Icon name="settings" size={14} />캔버스 설정</span></button>}
          <button role="menuitem" className="present-btn" onClick={run(() => ws.present())}><span><Icon name="play" size={14} />발표</span><kbd>Ctrl+Alt+P</kbd></button>
          <button role="menuitem" className="export-btn" onClick={run(() => ws.printNote())}><span><Icon name="download" size={14} />인쇄 · 내보내기</span></button>
          <button role="menuitem" className="summary-btn" onClick={run(() => ws.summarizeNote())}><span><Icon name="sparkle" size={14} />AI로 노트 요약</span></button>
          <button role="menuitem" className="translate-btn" onClick={run(() => ws.translateNote())}><span><Icon name="sparkle" size={14} />AI로 노트 번역</span></button>
          <button role="menuitem" className="draft-btn" onClick={run(() => ws.draftNote())}><span><Icon name="sparkle" size={14} />AI로 초안 쓰기</span></button>
          <button role="menuitem" onClick={run(() => ws.openVersions())}><span><Icon name="pages" size={14} />버전 기록</span></button>
          {/* 좁은 화면에서만 보인다 — 위 막대의 별이 숨을 때 (DS-021) */}
          <button role="menuitem" className="top-more-fav" onClick={run(() => { if (ws.state.currentId) void ws.toggleFavorite(ws.state.currentId); })}><span><Icon name="star" size={14} />{fav ? '즐겨찾기에서 빼기' : '즐겨찾기에 넣기'}</span></button>
        </div>
      )}
      {canvas && ws.view && <CanvasSettings engine={ws.view.engine} onClose={closeCanvas} />}
    </div>
  );
}
