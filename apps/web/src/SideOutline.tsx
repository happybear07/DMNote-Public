// 사이드바 '이 노트' (11/09): 지금 노트의 블록(콘텐츠 묶음) ▸ 그 안 콘텐츠, 묶이지 않은 상자는 한 줄 — 누르면 그 자리로.
// 블록 줄: 두 번 눌러 이름 바꾸기 · 우클릭 메뉴(이동 · 이름 · 묶음 풀기) · 접기(기기 설정 treeExpanded의 g:<id>, 기본 펼침).
import type { MouseEvent, ReactNode } from 'react';
import { Icon } from './Icon';
import type { OutlineItem } from './side-outline';
import type { Workspace, WorkspaceState } from './workspace';

interface Props {
  ws: Workspace; s: WorkspaceState; onNavigate?: () => void;
  renaming: string | null; setRenaming: (k: string | null) => void;
  renameInput: (value: string, placeholder: string, commit: (v: string) => void) => ReactNode;
  blockMenu: (e: MouseEvent, gid: string) => void;
}

export function SideOutline({ ws, s, onNavigate, renaming, setRenaming, renameInput, blockMenu }: Props) {
  const { rows, more } = s.outline;
  if (s.page !== 'note' || !rows.length) return null;
  const go = (fn: () => void) => { onNavigate?.(); fn(); };
  const line = (it: OutlineItem, loose: boolean) => (
    <div key={it.id} role="treeitem" className={`note-item box-item${loose ? ' loose' : ''}`} title={it.label} data-id={it.id}
      onClick={() => go(() => ws.focusNoteBox(it.id))}>
      <span className="note-icon"><Icon name={it.icon} size={14} /></span>
      <span className="note-title">{it.label}</span>
    </div>
  );
  return (
    <>
      <div className="side-section"><span>이 노트</span></div>
      <div className="note-blocks side-tree" role="tree" aria-label="이 노트의 블록 · 콘텐츠">
        {rows.map((r) => {
          if (r.kind === 'box') return line(r, true);
          const key = `g:${r.id}`, open = s.expanded[key] !== false;
          return (
            <div key={r.id} role="treeitem" aria-expanded={open}>
              <div className="note-item block-item" title="이 블록으로 이동 · 두 번 눌러 이름 바꾸기"
                onClick={() => go(() => ws.focusNoteBlock(r.id))} onDoubleClick={() => setRenaming(`b:${r.id}`)}
                onContextMenu={(e) => blockMenu(e, r.id)}>
                <span className={`caret${open ? ' open' : ''}`} aria-hidden onClick={(e) => { e.stopPropagation(); ws.setExpanded(key, !open); }} />
                <span className="note-icon block-glyph" aria-hidden><Icon name="block" size={14} /></span>
                {renaming === `b:${r.id}` ? renameInput(r.name, '블록 이름', (v) => ws.renameNoteBlock(r.id, v)) : <span className="note-title">{r.name}</span>}
              </div>
              {open && <div role="group" className="box-items">{r.items.map((it) => line(it, false))}</div>}
            </div>
          );
        })}
        {more > 0 && <div className="tree-empty">…외 {more}개</div>}
      </div>
    </>
  );
}
