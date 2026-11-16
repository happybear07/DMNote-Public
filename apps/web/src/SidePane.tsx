// 옆에 노트 (FR-153): 왼쪽은 지금 노트(고치기), 오른쪽은 참고할 노트(읽기 — 문서 모양). 가운데 막대를 끌거나 ←→로 나눔 비율.
// 오른쪽 블록을 끌어 왼쪽 캔버스에 놓으면 복사. 오른쪽 노트가 다른 곳에서 바뀌면 다시 읽는다. 바꾸기 = 두 노트 자리 바꾸기.
import { useEffect, useRef, useState } from 'react';
import { BLOCK_CLIP_MIME, blockClip } from '@dn/engine-core';
import { DocView } from '@dn/engine-dom';
import { displayTitle, type Workspace, type WorkspaceState } from './workspace';
import { NoteGlyph } from './NoteLook';
import { Icon } from './Icon';

export function SidePane({ ws, s, side }: { ws: Workspace; s: WorkspaceState; side: NonNullable<WorkspaceState['side']> }) {
  const host = useRef<HTMLDivElement>(null);
  const [rev, setRev] = useState(0);
  const [missing, setMissing] = useState(false);
  const meta = s.notes.find((n) => n.id === side.noteId);
  const stamp = meta?.updatedAt;

  useEffect(() => {
    let live = true, doc: DocView | null = null, obs: MutationObserver | null = null;
    const el = host.current;
    void ws.readEngine(side.noteId).then((engine) => {
      if (!live || !el) return;
      setMissing(!engine);
      if (!engine) return;
      el.replaceChildren();
      doc = new DocView({ engine, container: el, readOnly: true, files: { url: (h) => ws.fileUrl(h) }, embeds: ws.embedHost });
      // 블록마다 끌 수 있게 (문서 뷰가 다시 그려도)
      const mark = () => el.querySelectorAll<HTMLElement>('.dn-doc-item:not([draggable])').forEach((it) => { it.draggable = true; it.title = '끌어서 왼쪽 캔버스에 놓으면 복사돼요'; });
      mark();
      obs = new MutationObserver(mark);
      obs.observe(el, { childList: true, subtree: true });
      el.ondragstart = (e) => {
        const item = (e.target as Element | null)?.closest?.<HTMLElement>('.dn-doc-item');
        const id = item?.dataset.id;
        if (!id || !e.dataTransfer || !engine.getBlock(id)) return;
        e.dataTransfer.setData(BLOCK_CLIP_MIME, JSON.stringify(blockClip(engine, [id])));
        e.dataTransfer.setData('text/plain', item!.innerText);
        e.dataTransfer.effectAllowed = 'copy';
      };
    });
    return () => { live = false; obs?.disconnect(); if (el) el.ondragstart = null; doc?.destroy(); };
  }, [ws, side.noteId, stamp, rev]);

  // 가운데 막대: 끌기 · 키보드
  const drag = (e: React.PointerEvent) => {
    const body = (e.currentTarget as HTMLElement).parentElement!;
    const left = body.querySelector<HTMLElement>('.canvas-wrap')!.getBoundingClientRect().left;
    const right = body.querySelector<HTMLElement>('.side-pane')!.getBoundingClientRect().right;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => ws.setSideRatio((ev.clientX - left) / Math.max(1, right - left), false);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); ws.setSideRatio(ws.state.side?.ratio ?? side.ratio, true); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <>
      <div className="split-divider" role="separator" aria-orientation="vertical" aria-label="나눔 비율" aria-valuenow={Math.round(side.ratio * 100)}
        aria-valuemin={30} aria-valuemax={80} tabIndex={0} onPointerDown={drag}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); ws.setSideRatio(side.ratio + (e.key === 'ArrowLeft' ? -0.05 : 0.05), true); } }} />
      <aside className="side-pane" style={{ flex: `${1 - side.ratio} 1 0` }} aria-label="옆에 연 노트">
        <div className="side-head">
          <span className="side-title"><NoteGlyph icon={meta?.icon} size={16} />{meta ? displayTitle(meta) : '노트 없음'}</span>
          <small className="side-hint">읽기 · 블록을 끌어 왼쪽에 복사</small>
          <button className="icon-btn" title="두 노트 자리 바꾸기" aria-label="자리 바꾸기" onClick={() => void ws.swapSide()}>⇄</button>
          <button className="icon-btn" title="다시 읽기" aria-label="다시 읽기" onClick={() => setRev((r) => r + 1)}>↻</button>
          <button className="icon-btn" title="닫기" aria-label="옆 노트 닫기" onClick={() => ws.closeSide()}><Icon name="close" size={14} /></button>
        </div>
        {missing && <p className="side-missing">노트를 읽지 못했어요. 휴지통에 있거나 잠긴 노트일 수 있어요.</p>}
        <div ref={host} className="side-host" />
      </aside>
    </>
  );
}
