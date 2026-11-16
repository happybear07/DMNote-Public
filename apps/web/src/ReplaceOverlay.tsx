// 찾아 바꾸기 (FR-123, Ctrl+H): 지금 노트 · 모든 노트, 대소문자 구분, 하나씩 · 모두 바꾸기 (되돌리기는 토스트).
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { ReplaceHit, ReplaceScope } from './ws-replace';
import { displayTitle, type Workspace, type WorkspaceState } from './workspace';

export function ReplaceOverlay({ ws, s }: { ws: Workspace; s: WorkspaceState }) {
  const [q, setQ] = useState('');
  const [rep, setRep] = useState('');
  const [scope, setScope] = useState<ReplaceScope>(s.currentId && s.page === 'note' ? 'note' : 'all');
  const [cs, setCs] = useState(false);
  const [hits, setHits] = useState<ReplaceHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);

  // 입력이 멈추면(150ms) 찾는다 · 바꾼 뒤에도 다시
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      void ws.findAll(q, scope, { caseSensitive: cs }).then((h) => { if (alive) setHits(h); });
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [q, scope, cs, tick, ws]);

  const titles = new Map(s.notes.map((n) => [n.id, displayTitle(n)]));
  const notes = new Set(hits.map((h) => h.noteId)).size;
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); setTick((x) => x + 1); } };

  return (
    <div className="overlay-backdrop" onMouseDown={() => ws.closeOverlay()}>
      <div className="search-box replace-box" role="dialog" aria-modal="true" aria-label="찾아 바꾸기" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); ws.closeOverlay(); } }}>
        <div className="replace-fields">
          <label><Icon name="search" size={16} /><input ref={findRef} autoFocus value={q} placeholder="찾을 말" aria-label="찾을 말" onChange={(e) => setQ(e.target.value)} /></label>
          <label><Icon name="pencil" size={16} /><input value={rep} placeholder="바꿀 말 (비우면 지우기)" aria-label="바꿀 말" onChange={(e) => setRep(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && q && hits.length) void run(() => ws.replaceAll(q, rep, scope, { caseSensitive: cs })); }} /></label>
        </div>
        <div className="search-filters">
          <span className="search-modes">
            <button className={scope === 'note' ? 'on' : ''} disabled={!s.currentId} onClick={() => setScope('note')}>지금 노트</button>
            <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>모든 노트</button>
          </span>
          <label className={`filter-ai${cs ? ' on' : ''}`}><input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} />대소문자 구분</label>
          <span className="replace-count">{q ? `${hits.length >= 500 ? '500곳 넘게' : `${hits.length}곳`}${scope === 'all' && notes ? ` · 노트 ${notes}개` : ''}` : ''}</span>
          <button className="btn sm primary" disabled={!q || !hits.length || busy} onClick={() => void run(() => ws.replaceAll(q, rep, scope, { caseSensitive: cs }))}>모두 바꾸기</button>
        </div>
        <div className="search-results" role="listbox">
          {hits.slice(0, 200).map((h, i) => (
            <div key={`${h.noteId}:${h.contentId}:${h.cell?.rowId ?? ''}:${h.cell?.colId ?? ''}:${h.from}:${i}`} className="search-row replace-row">
              <button className="replace-ctx" title="이 자리로 가기" onClick={() => { ws.closeOverlay(); void ws.openHit(h.noteId, h.blockId); }}>
                {scope === 'all' && <small><Icon name="note" size={12} />{titles.get(h.noteId)}{h.cell ? ' · 표' : ''}</small>}
                <span>{h.before}<mark>{h.match}</mark>{rep && <ins>{rep}</ins>}{h.after}</span>
              </button>
              <button className="btn sm" disabled={busy} onClick={() => void run(() => ws.replaceOne(h, q, rep, { caseSensitive: cs }))}>바꾸기</button>
            </div>
          ))}
          {q && !hits.length && <div className="search-empty"><strong>'{q}'을(를) 찾지 못했어요</strong><span>{scope === 'note' ? '모든 노트에서 찾아보세요.' : '철자를 확인해 주세요.'}</span></div>}
          {!q && <div className="search-empty"><span>내용 상자 · 제목 상자 · 표 칸의 글자를 바꿔요. 서식은 그대로 남아요. 모두 바꾼 뒤 알림의 [되돌리기]로 한 번에 되돌릴 수 있어요.</span></div>}
        </div>
      </div>
    </div>
  );
}
