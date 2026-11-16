// 사이드바 태그 (11/09): '#이름'을 파란 글자로 줄줄이 (인스타그램 해시태그처럼) — 누르면 그 태그의 노트가 사이드바 옆 작은 판에, 다시 누르면 닫힘.
// 판은 사이드바 밖에 떠서 목록이 생겼다 사라져도 사이드바가 밀리지 않는다 (두 번 눌러 이름 바꾸기가 빗나가지 않게).
// 두 번 눌러 이름 바꾸기 · 우클릭으로 이름 바꾸기 · 지우기. 태그가 하나도 없으면 섹션째 숨긴다 (붙이는 곳은 노트 위 '# 태그', DS-002).
import { useState, useMemo, type MouseEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { NoteGlyph } from './NoteLook';
import type { ConfirmRequest } from './ConfirmDialog';
import type { RowMenuItem } from './RowMenu';
import { useEscape } from './hooks';
import { displayTitle, type Workspace, type WorkspaceState } from './workspace';
import { tagCounts } from './ws-model';

interface Props {
  ws: Workspace; s: WorkspaceState; confirm: (r: ConfirmRequest) => void; onNavigate?: () => void;
  renaming: string | null; setRenaming: (k: string | null) => void;
  renameInput: (value: string, placeholder: string, commit: (v: string) => void) => ReactNode;
  openMenu: (e: MouseEvent, items: RowMenuItem[]) => void;
}

export function SideTags({ ws, s, confirm, onNavigate, renaming, setRenaming, renameInput, openMenu }: Props) {
  const counts = useMemo(() => tagCounts(s.notes), [s.notes]);
  /** 판 자리: 사이드바 오른쪽, 누른 태그 높이 (화면 밖으로 안 나가게) */
  const [at, setAt] = useState<{ left: number; top: number }>({ left: 248, top: 120 });
  useEscape(() => ws.setTagFilter(null), !!s.tagFilter);
  if (!s.tags.length) return null;
  const pick = (e: MouseEvent, id: string) => {
    const r = e.currentTarget.getBoundingClientRect(), side = e.currentTarget.closest('.sidebar')?.getBoundingClientRect();
    setAt({ left: Math.min((side?.right ?? r.right) + 6, window.innerWidth - 268), top: Math.max(8, Math.min(r.top - 8, window.innerHeight - 320)) });
    ws.setTagFilter(s.tagFilter === id ? null : id);
  };
  const open = !!s.expanded.tags;
  const filterTag = s.tags.find((t) => t.id === s.tagFilter);
  const askDelete = (id: string, name: string) => confirm({
    title: `'#${name}' 태그를 지울까요?`, body: '모든 노트에서 이 태그가 떨어져요. 노트는 지워지지 않아요.', confirmLabel: '태그 삭제', onConfirm: () => void ws.deleteTag(id),
  });
  return (
    <>
      <div className="side-section clickable" onClick={() => ws.setExpanded('tags', !open)}>
        <span><span className={`caret${open ? ' open' : ''}`} />태그</span>
      </div>
      {open && (
        <div className="tag-list" role="list" aria-label="태그">
          {s.tags.map((t) => renaming === t.id ? (
            <span key={t.id} className="tag-item renaming">#{renameInput(t.name, '태그 이름', (v) => void ws.renameTag(t.id, v).then((err) => { if (err) ws.toast(err); }))}</span>
          ) : (
            <button key={t.id} role="listitem" className={`tag-item${s.tagFilter === t.id ? ' active' : ''}`} aria-pressed={s.tagFilter === t.id}
              title={`#${t.name} 태그가 붙은 노트 ${counts.get(t.id) ?? 0}개 · 두 번 눌러 이름 바꾸기`}
              onClick={(e) => pick(e, t.id)} onDoubleClick={() => setRenaming(t.id)}
              onContextMenu={(e) => openMenu(e, [
                { label: '이름 바꾸기', icon: 'pencil', run: () => setRenaming(t.id) },
                { label: '태그 삭제', icon: 'trash', danger: true, run: () => askDelete(t.id, t.name) },
              ])}>
              <span className="tag-name">#{t.name}</span><span className="count">{counts.get(t.id) ?? 0}</span>
            </button>
          ))}
        </div>
      )}
      {filterTag && (
        <nav className="tag-notes" style={at} aria-label={`#${filterTag.name} 태그의 노트`}>
          <div className="filter-bar">
            <span>#{filterTag.name} · {counts.get(filterTag.id) ?? 0}개</span>
            <button aria-label="태그 필터 해제" title="필터 해제" onClick={() => ws.setTagFilter(null)}><Icon name="close" size={14} /></button>
          </div>
          {s.notes.filter((n) => n.tagIds?.includes(filterTag.id)).map((n) => (
            <div key={n.id} className={`note-item${n.id === s.currentId && s.page === 'note' ? ' active' : ''}`} onClick={() => { onNavigate?.(); ws.setTagFilter(null); void ws.openById(n.id); }}>
              <span className="note-icon"><NoteGlyph icon={n.icon} /></span>
              <span className={`note-title${n.title.trim() ? '' : ' auto'}`}>{displayTitle(n)}</span>
            </div>
          ))}
        </nav>
      )}
    </>
  );
}
