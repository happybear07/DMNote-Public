// 13 검색 · 빠른 전환 오버레이 (FR-121 · FR-087). 같은 오버레이의 두 모드:
//   search (Ctrl+Shift+F) — 모든 노트의 블록 글자 · 표 · 그래프 글자에서 찾기 → 노트로 가서 블록 위치로
//   switch (Ctrl+P)       — 노트 이름으로 이동, 빈 입력이면 최근 연 노트
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { NoteGlyph } from './NoteLook';
import type { NoteMeta } from '@dn/storage-idb';
import { displayTitle, type Overlay, type Workspace, type WorkspaceState } from './workspace';
import { nameMatch, recentFirst, type SearchFilter } from './ws-model';
import { notePath } from './tree';
import { BLOCK_KINDS, type BlockKind } from '@dn/search';

const PERIODS = [{ days: 1, label: '오늘' }, { days: 7, label: '최근 7일' }, { days: 30, label: '최근 30일' }, { days: 365, label: '최근 1년' }];

interface Row { key: string; noteId: string; blockId?: string; title: ReactNode; sub?: ReactNode; path: string }

function mark(text: string, ranges: [number, number][]): ReactNode {
  if (!ranges.length) return text;
  const out: ReactNode[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a < at) continue;
    if (a > at) out.push(text.slice(at, a));
    out.push(<mark key={a}>{text.slice(a, b)}</mark>);
    at = b;
  }
  out.push(text.slice(at));
  return out;
}

export function SearchOverlay({ ws, s, mode }: { ws: Workspace; s: WorkspaceState; mode: Exclude<Overlay, 'command'> }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [f, setF] = useState<SearchFilter>({});
  const filtered = !!(f.tagId || f.days || f.folderId || f.kind || f.ai || f.roleId);
  const setFilter = (patch: Partial<SearchFilter>) => setF((cur) => ({ ...cur, ...patch }));
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const path = (n: NoteMeta) => notePath(n, s.notes, s.folders, displayTitle);
  const byId = useMemo(() => new Map(s.notes.map((n) => [n.id, n])), [s.notes]);

  const rows: Row[] = useMemo(() => {
    if (mode === 'switch') {
      const list = q.trim() ? s.notes.filter((n) => nameMatch(n, q)) : recentFirst(s.notes, s.recent);
      return list.slice(0, 50).map((n) => ({ key: n.id, noteId: n.id, title: displayTitle(n), path: path(n) }));
    }
    if (!q.trim() && !filtered) return [];
    const out: Row[] = [];
    for (const h of ws.search(q, f)) {
      const n = byId.get(h.noteId);
      if (!n) continue;
      if (!h.blocks.length) out.push({ key: h.noteId, noteId: h.noteId, title: displayTitle(n), sub: h.inTitle ? '노트 제목' : '', path: path(n) });
      h.blocks.forEach((b, i) => out.push({
        key: `${h.noteId}:${b.id}`, noteId: h.noteId, blockId: b.id,
        title: i === 0 ? displayTitle(n) : '', sub: mark(b.snippet, b.ranges), path: i === 0 ? path(n) : '',
      }));
      if (h.blockCount > h.blocks.length) out.push({ key: `${h.noteId}:more`, noteId: h.noteId, title: '', sub: `… 이 노트에 ${h.blockCount - h.blocks.length}곳 더`, path: '' });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, mode, s.notes, s.folders, s.recent, s.indexing, f]);

  useEffect(() => { setSel(0); }, [q, mode, f]);
  useEffect(() => { listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const go = (r: Row | undefined) => { if (r) void ws.openHit(r.noteId, r.blockId); };

  return (
    <div className="overlay-backdrop" onMouseDown={() => ws.closeOverlay()}>
      <div className="search-box" role="dialog" aria-modal="true" aria-label={mode === 'search' ? '전체 검색' : '빠른 전환'} onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); ws.closeOverlay(); } }}>
        <div className="search-head">
          <span className="search-icon"><Icon name={mode === 'search' ? 'search' : 'goto'} size={16} /></span>
          <input ref={inputRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={mode === 'search' ? '모든 노트에서 검색 (#태그로 좁히기)' : '노트 이름으로 이동'}
            aria-label={mode === 'search' ? '모든 노트에서 검색' : '노트 이름으로 이동'}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, rows.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
              // Shift+Enter: 옆에 열기 (FR-153)
              else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); const r = rows[sel]; if (r) { ws.closeOverlay(); void ws.openSide(r.noteId); } }
              else if (e.key === 'Enter') { e.preventDefault(); go(rows[sel]); }
              else if (e.key === 'Escape') { e.preventDefault(); ws.closeOverlay(); }
            }} />
          <span className="search-modes">
            <button className={mode === 'switch' ? 'on' : ''} onClick={() => ws.openOverlay('switch')} title="Ctrl+P">이름</button>
            <button className={mode === 'search' ? 'on' : ''} onClick={() => ws.openOverlay('search')} title="Ctrl+Shift+F">내용</button>
          </span>
        </div>
        {mode === 'search' && (
          <div className="search-filters" aria-label="검색 필터">
            <select aria-label="태그" value={f.tagId ?? ''} className={f.tagId ? 'on' : ''} onChange={(e) => setFilter({ tagId: e.target.value || undefined })}>
              <option value="">모든 태그</option>
              {s.tags.map((t) => <option key={t.id} value={t.id}>#{t.name}</option>)}
            </select>
            <select aria-label="역할" value={f.roleId ?? ''} className={f.roleId ? 'on' : ''} onChange={(e) => setFilter({ roleId: e.target.value || undefined })}>
              <option value="">모든 역할</option>
              {ws.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <select aria-label="기간" value={f.days ?? ''} className={f.days ? 'on' : ''} onChange={(e) => setFilter({ days: Number(e.target.value) || undefined })}>
              <option value="">모든 기간</option>
              {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
            </select>
            <select aria-label="폴더" value={f.folderId ?? ''} className={f.folderId ? 'on' : ''} onChange={(e) => setFilter({ folderId: e.target.value || undefined })}>
              <option value="">모든 폴더</option>
              {s.folders.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <select aria-label="블록 종류" value={f.kind ?? ''} className={f.kind ? 'on' : ''} onChange={(e) => setFilter({ kind: (e.target.value || undefined) as BlockKind | undefined })}>
              <option value="">모든 블록</option>
              {BLOCK_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
            <label className={`filter-ai${f.ai ? ' on' : ''}`}><input type="checkbox" checked={!!f.ai} onChange={(e) => setFilter({ ai: e.target.checked || undefined })} />AI가 만든 블록만</label>
            {filtered && <button className="link-btn" onClick={() => { setF({}); inputRef.current?.focus(); }}>필터 지우기</button>}
          </div>
        )}
        {s.indexing && mode === 'search' && (
          <div className="search-note">색인 중 {Math.round((s.indexing.done / s.indexing.total) * 100)}% — 결과는 그동안에도 보여 드려요</div>
        )}
        <div className="search-results" ref={listRef} role="listbox" aria-label={mode === 'search' ? '검색 결과' : '노트 목록'} tabIndex={0}>
          {mode === 'switch' && !q.trim() && rows.length > 0 && <div className="search-group">최근 연 노트</div>}
          {rows.map((r, i) => (
            <div key={r.key} role="option" aria-selected={i === sel} className={`search-row${i === sel ? ' on' : ''}${r.title ? '' : ' cont'}`}
              onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); go(r); }}>
              {r.title && <div className="search-title"><span className="search-name"><NoteGlyph icon={s.notes.find((n) => n.id === r.noteId)?.icon} size={14} />{r.title}</span>{r.path && <small>{r.path}</small>}</div>}
              {r.sub && <div className="search-sub">{r.sub}</div>}
            </div>
          ))}
          {(q.trim() || (mode === 'search' && filtered)) && !rows.length && (
            <div className="search-empty"><strong>{q.trim() ? `'${q.trim()}' 검색 결과가 없어요` : '조건에 맞는 노트가 없어요'}</strong><span>{filtered ? '필터를 줄이거나 다른 낱말로 찾아보세요.' : '철자를 확인하거나 다른 낱말로 찾아보세요.'}</span></div>
          )}
          {mode === 'search' && !q.trim() && !filtered && <div className="search-empty"><span>블록 글자 · 접힌 토글 · 표 · 그래프 글자까지 찾아요. 휴지통의 노트는 빠져요.</span></div>}
        </div>
      </div>
    </div>
  );
}
