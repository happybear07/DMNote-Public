// 노트 관계 그래프 (FR-083): 노트 = 상자, 노트 링크 = 화살표, 링크가 많을수록 크게. 보기 전용 캔버스(이동 · 확대)에서 상자를 누르면 그 노트로.
// 연결 없는 노트는 기본으로 숨긴다(켜서 보기). 지금 노트는 파란색.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CanvasView } from '@dn/engine-dom';
import { buildGraphEngine } from './graph';
import type { Workspace, WorkspaceState } from './workspace';

export function GraphPage({ ws, s, menu }: { ws: Workspace; s: WorkspaceState; menu?: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [orphans, setOrphans] = useState(false);
  // 노트 목록 · 제목 · 아이콘이 바뀔 때만 다시 만든다
  const key = s.notes.map((n) => `${n.id}:${n.title}:${n.icon ?? ''}:${n.updatedAt}`).join('|');
  const g = useMemo(() => ws.linkGraph(), [ws, key]);
  const shown = useMemo(() => (orphans ? g : { nodes: g.nodes.filter((n) => n.degree > 0), edges: g.edges }), [g, orphans]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const { engine, noteOf } = buildGraphEngine(shown.nodes, shown.edges, s.currentId);
    const view = new CanvasView({ engine, container: el, readOnly: true });
    requestAnimationFrame(() => view.fit());
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    // 누른 채 거의 움직이지 않았을 때만 (끌어서 화면을 옮긴 것은 열기가 아님)
    const onClick = (e: MouseEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      // 캔버스가 포인터를 잡고 있어 click의 target은 캔버스 — 그 자리의 상자를 찾는다
      const b = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.dn-block');
      const id = b?.dataset.id ? noteOf.get(b.dataset.id) : undefined;
      if (id) void ws.openById(id);
    };
    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('click', onClick);
    return () => { el.removeEventListener('pointerdown', onDown, true); el.removeEventListener('click', onClick); view.destroy(); };
  }, [ws, shown, s.currentId]);

  const hidden = g.nodes.length - shown.nodes.length;
  return (
    <div className="graph-page" aria-label="노트 그래프">
      <header className="topbar graph-bar">
        {menu}
        <span className="page-name">노트 그래프</span>
        <small className="graph-count">노트 {shown.nodes.length}개 · 링크 {shown.edges.length}개{hidden ? ` · 연결 없는 노트 ${hidden}개 숨김` : ''}</small>
        <label className="graph-orphans"><input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} />연결 없는 노트도 보기</label>
      </header>
      {!shown.nodes.length && (
        <div className="empty graph-empty">
          <strong>아직 서로 링크한 노트가 없어요</strong>
          <span>글에서 <kbd>[[</kbd> 또는 <kbd>@</kbd>로 다른 노트를 링크하면 여기에 관계가 그려져요.</span>
        </div>
      )}
      <div ref={host} className="graph-host" />
    </div>
  );
}
