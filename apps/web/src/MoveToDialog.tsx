// 다른 노트로 옮기기 (GAP #16 — 노션 '옮기기'): 노트 이름으로 찾아 고르면 고른 상자를 그 노트 맨 아래로 (ws-move.ts).
// 빠른 전환(Ctrl+P)과 같은 모양 · 키 — ↑↓ · Enter · Esc, 빈 입력이면 최근 연 노트부터.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NoteMeta } from '@dn/storage-idb';
import { Icon } from './Icon';
import { NoteGlyph } from './NoteLook';
import { notePath } from './tree';
import { displayTitle, type Workspace, type WorkspaceState } from './workspace';
import { nameMatch, recentFirst } from './ws-model';

export function MoveToDialog({ ws, s, ids }: { ws: Workspace; s: WorkspaceState; ids: readonly string[] }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => {
    const ok = (n: NoteMeta) => n.id !== s.currentId && !n.dbRef;
    const list = q.trim() ? s.notes.filter((n) => ok(n) && nameMatch(n, q)) : recentFirst(s.notes, s.recent).filter(ok);
    return list.slice(0, 50);
  }, [q, s.notes, s.recent, s.currentId]);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  const close = () => { ws.closeMoveTo(); ws.view?.root.focus({ preventScroll: true }); };
  const go = (n: NoteMeta | undefined) => { if (n) void ws.moveBlocksTo(n.id, ids); };

  return (
    <div className="overlay-backdrop" onMouseDown={close}>
      <div className="search-box" role="dialog" aria-modal="true" aria-label="다른 노트로 옮기기" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-head">
          <span className="search-icon"><Icon name="goto" size={16} /></span>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`상자 ${ids.length}개를 옮길 노트`} aria-label="옮길 노트 찾기"
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, rows.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); go(rows[sel]); }
              else if (e.key === 'Escape') { e.preventDefault(); close(); }
            }} />
        </div>
        <div className="search-results" ref={listRef} role="listbox" aria-label="옮길 노트" tabIndex={0}>
          {!q.trim() && rows.length > 0 && <div className="search-group">옮길 노트 — 맨 아래에 붙어요</div>}
          {rows.map((n, i) => {
            const path = notePath(n, s.notes, s.folders, displayTitle);
            return (
              <div key={n.id} role="option" aria-selected={i === sel} className={`search-row${i === sel ? ' on' : ''}`}
                onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); go(n); }}>
                <div className="search-title"><span className="search-name"><NoteGlyph icon={n.icon} size={14} />{displayTitle(n)}</span>{path && <small>{path}</small>}</div>
              </div>
            );
          })}
          {!rows.length && <div className="search-empty"><strong>{q.trim() ? `'${q.trim()}' 이름의 노트가 없어요` : '옮길 다른 노트가 없어요'}</strong><span>{q.trim() ? '다른 낱말로 찾아보세요.' : '새 노트를 만든 뒤 옮겨 주세요.'}</span></div>}
        </div>
      </div>
    </div>
  );
}
