// 사이드바에서 노트 여러 개를 고른 뒤의 일괄 작업 줄 (FR-079): 폴더로 옮기기 · 태그 달기 · 휴지통.
import { useState } from 'react';
import { Icon } from './Icon';
import type { Workspace, WorkspaceState } from './workspace';

export function BulkBar({ ws, s, ids, onDone }: { ws: Workspace; s: WorkspaceState; ids: string[]; onDone(): void }) {
  const [tagging, setTagging] = useState(false);
  const [name, setName] = useState('');
  return (
    <div className="bulk-bar" role="toolbar" aria-label="선택한 노트">
      <div className="bulk-head">
        <b>{ids.length}개 선택</b>
        <button className="icon-btn" aria-label="선택 해제" title="선택 해제 (Esc)" onClick={onDone}><Icon name="close" size={14} /></button>
      </div>
      <div className="bulk-actions">
        <select aria-label="옮길 곳" value="" onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          void ws.moveNotes(ids, v === '__root' ? undefined : v).then(onDone);
        }}>
          <option value="">옮기기…</option>
          <option value="__root">맨 위 (폴더 밖)</option>
          {s.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        {tagging ? (
          <input className="bulk-tag" autoFocus value={name} placeholder="태그 이름 · Enter" aria-label="달 태그 이름"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { setTagging(false); setName(''); }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter' && name.trim()) { void ws.tagNotes(ids, name.replace(/^#/, '')).then(onDone); setTagging(false); setName(''); }
              if (e.key === 'Escape') { setTagging(false); setName(''); }
            }} />
        ) : (
          <button className="btn sm" onClick={() => setTagging(true)}># 태그</button>
        )}
        <button className="btn sm danger-ghost" onClick={() => void ws.trashMany(ids).then(onDone)}><Icon name="trash" size={14} />휴지통</button>
      </div>
    </div>
  );
}
