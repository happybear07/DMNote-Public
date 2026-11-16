// 내 페이지 '이어서 쓰기' (11/11, HOME-DESIGN-REFS R1 · 3.5a): 지금 노트(마지막에 보던 노트)를 쪽 그림 · 폴더 경로 · 제목 · 고친 때 ·
// 첫 줄 · 블록 칩 · 할 일 진행 줄로 보여 준다. 그림 · 제목을 누르면 그 노트로, 블록 칩은 그 블록으로. 열린 노트가 없으면 숨긴다.
import { Icon } from './Icon';
import { NoteThumb } from './NoteThumb';
import { folderNames } from './tree';
import { ago, displayTitle, type Workspace, type WorkspaceState } from './workspace';

export function ContinueCard({ ws, s }: { ws: Workspace; s: WorkspaceState }) {
  const n = s.currentId ? s.notes.find((x) => x.id === s.currentId) : undefined;
  if (!n) return null;
  const view = ws.view;
  const engine = view && view.engine.note.id === n.id ? view.engine : null;
  const byId = new Map(s.folders.map((f) => [f.id, f]));
  const path = folderNames(n.folderId ? byId.get(n.folderId) : undefined, byId);
  const title = displayTitle(n);
  const chips = s.outline.rows.filter((r) => r.kind === 'block').slice(0, 4);
  const open = () => void ws.openById(n.id);
  const { done, total } = s.todos;
  return (
    <section className="card wide cont-card" aria-label="이어서 쓰기">
      <h2>이어서 쓰기</h2>
      <div className="cont-body">
        <button className="cont-thumb" onClick={open} tabIndex={-1} aria-hidden>
          {n.locked ? <Icon name="eyeOff" size={20} /> : engine && view ? <NoteThumb engine={engine} view={view} /> : null}
        </button>
        <div className="cont-info">
          {path.length > 0 && <p className="cont-path"><Icon name="folder" size={12} />{path.join(' · ')}</p>}
          <button className="cont-title" onClick={open}>{title}</button>
          <p className="cont-meta">{ago(n.updatedAt)} 고침 · 상자 {n.stats?.blocks ?? 0}개</p>
          {n.preview && !n.locked && n.preview !== title && <p className="cont-preview">{n.preview}</p>}
          {chips.length > 0 && (
            <div className="cont-chips">
              {chips.map((b) => b.kind === 'block' && <button key={b.id} className="cont-chip" onClick={() => void ws.openNoteBlock(n.id, b.id)}>{b.name}</button>)}
            </div>
          )}
          {total > 0 && (
            <div className="cont-progress" role="img" aria-label={`할 일 ${total}개 중 ${done}개 끝냄`}>
              <span className="cont-bar"><i style={{ width: `${Math.round((done / total) * 100)}%` }} /></span>
              <span>할 일 {done} / {total}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
