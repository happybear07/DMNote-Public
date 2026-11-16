// 노트 설정 (11/03): 노트 안 빈 곳 · 종이를 오른쪽 클릭 — 여기에 넣기 · 용지(A4 세로 · A4 가로 — A4로 고정, 예전 끝없는 캔버스 노트는 A4로 바꾸기) ·
// 이 쪽 방향(쪽마다 가로 · 세로, sheet.ts setPageOrient) · 표지 쪽(만들기 · 그림 붙이기 · 지우기) · 바탕색 · 무늬 · 간격(PaperControls) · 노트 정보.
// 바꾸면 바로 적용(실행 취소 가능).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { contentBottom, coverRect, pageAt, setPageOrient, sheetGeom } from '@dn/engine-core';
import type { CanvasView, InsertMenuRequest } from '@dn/engine-dom';
import { Icon } from './Icon';
import { PaperControls } from './CanvasSettings';
import { BookPalette } from './BookPalette';
import { svg } from './ToolChoice';
import type { Workspace } from './workspace';

const PORTRAIT = svg(<rect x="5" y="2.5" width="10" height="15" rx="1.5" />);
const LANDSCAPE = svg(<rect x="2.5" y="5" width="15" height="10" rx="1.5" />);

export function NoteMenu({ ws, view, req }: { ws: Workspace; view: CanvasView; req: InsertMenuRequest }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: req.x, y: req.y });
  const [, redraw] = useState(0);
  const engine = view.engine;
  useEffect(() => engine.subscribe(() => redraw((k) => k + 1)), [engine]); // 실행 취소 등도 반영
  const close = () => { ws.closeNoteMenu(); view.root.focus({ preventScroll: true }); };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) closeRef.current(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); } };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    box.current?.focus({ preventScroll: true }); // 틀에 초점 — Tab으로 안의 단추로, 마우스로 열면 테두리 없이
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, []);
  // 화면 밖으로 넘치면 안쪽으로
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.max(8, Math.min(req.x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(req.y, innerHeight - r.height - 8)) });
  }, [req]);

  const sheet = engine.note.sheet;
  const kind = !sheet ? 'none' : sheet.landscape ? 'a4l' : 'a4';
  const setKind = (k: 'a4' | 'a4l') => ws.setNoteSheet({ size: 'a4', ...(k === 'a4l' ? { landscape: true } : {}), ...(sheet?.pages ? { pages: sheet.pages } : {}) });
  // 누른 자리가 종이 위면 그 쪽 — 쪽마다 방향을 바꿀 수 있다
  const g = sheet ? sheetGeom(engine.note, contentBottom(engine)) : null;
  const at = req.at, hit = g && at ? pageAt(g, at.y) : null;
  const page = hit && at && hit.i < g!.pages && at.x >= 0 && at.x <= hit.w && at.y >= hit.y && at.y <= hit.y + hit.h ? hit : null;
  const turn = (land: boolean) => { if (page) setPageOrient(engine, page.i, land); };
  const choice = (on: boolean, label: string, icon: ReactNode, run: () => void) => (
    <button type="button" role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={run}>{icon}{label}</button>
  );

  return (
    <div ref={box} className="canvas-settings note-menu" role="dialog" aria-label="노트 설정" tabIndex={-1} style={{ left: pos.x, top: pos.y }}>
      <h3>노트 설정</h3>
      <button type="button" className="nm-row" onClick={() => ws.openInsertMenu({ x: req.x, y: req.y, ...(at ? { at } : {}) })}>
        <Icon name="plus" size={16} />여기에 넣기<kbd>/</kbd>
      </button>
      <div className="cs-title" id="nm-sheet" title="노트 전체를 90도 돌리기">용지</div>
      {kind === 'none' && <p className="cs-desc">예전 끝없는 캔버스 노트예요. A4로 바꾸면 쪽에 맞춰 겹치지 않게 다시 놓아요.</p>}
      <div className="cs-choices two" role="radiogroup" aria-labelledby="nm-sheet">
        {choice(kind === 'a4', 'A4 세로', PORTRAIT, () => setKind('a4'))}
        {choice(kind === 'a4l', 'A4 가로', LANDSCAPE, () => setKind('a4l'))}
      </div>
      {page && <>
        <div className="cs-title" id="nm-page">이 쪽만 ({page.i + 1}쪽)</div>
        <div className="cs-choices two" role="radiogroup" aria-labelledby="nm-page">
          {choice(!page.landscape, '세로', PORTRAIT, () => turn(false))}
          {choice(page.landscape, '가로', LANDSCAPE, () => turn(true))}
        </div>
      </>}
      <div className="cs-title" id="nm-cover" title="그리거나 그림을 붙이면 홈 서재의 책 표지가 돼요">표지 쪽</div>
      {coverRect(engine.note) ? (
        <div className="nm-rows" role="group" aria-labelledby="nm-cover">
          <button type="button" className="nm-row" onClick={() => { close(); ws.addCover(); }}><Icon name="goto" size={16} />표지 쪽으로 가기</button>
          <button type="button" className="nm-row" onClick={() => { close(); ws.pickCoverImage(); }}><Icon name="image" size={16} />표지에 그림 붙이기…</button>
          <button type="button" className="nm-row danger" onClick={() => { close(); ws.removeCover(); }}><Icon name="trash" size={16} />표지 쪽 지우기</button>
        </div>
      ) : (
        <button type="button" className="nm-row" aria-describedby="nm-cover" onClick={() => { close(); ws.addCover(); }}><Icon name="bookmark" size={16} />표지 쪽 만들기</button>
      )}
      <div className="cs-title" id="nm-book" title="홈 서재에서 이 노트 책의 표지 색 — 고르지 않으면 폴더 색">책 표지 색</div>
      <BookPalette inline value={ws.state.notes.find((n) => n.id === engine.note.id)?.bookColor} autoLabel="폴더 색 따르기"
        onPick={(k) => void ws.setNoteColor(engine.note.id, k)} />
      <PaperControls engine={engine} />
      <button type="button" className="nm-row nm-info" onClick={() => { close(); ws.togglePanel(true); }}>
        <Icon name="info" size={16} />노트 정보 · 백링크
      </button>
    </div>
  );
}
