// 가져오기 미리보기 (FR-127): 무엇을 몇 개 만드는지 · 경고 · 대상 폴더 · 붙일 태그 · 같은 노트가 있을 때 → 실행 · 진행률 · 중단.
import { useState } from 'react';
import { Icon } from './Icon';
import { pickFiles } from './pick-files';
import type { ImportOptions } from './ws-model';
import type { Workspace, WorkspaceState } from './workspace';

/** 파일 · 폴더 고르기 창을 띄워 가져오기를 시작한다 */
export function pickImportFiles(ws: Workspace, folder = false): void {
  void pickFiles('.zip,.json,.md,.markdown,.txt,.docx,.csv', { multiple: true, folder }).then((f) => { if (f) void ws.prepareImport(f); });
}

/** 동기화 파일 고르기 (FR-096) */
export function pickSyncFile(ws: Workspace): void {
  void pickFiles('.json,application/json').then((f) => { if (f?.[0]) void ws.importSyncFile(f[0]); });
}

export function ImportDialog({ ws, s }: { ws: Workspace; s: WorkspaceState }) {
  const plan = ws.importPlan;
  const [target, setTarget] = useState('__new');
  const [tag, setTag] = useState('');
  const [conflict, setConflict] = useState<ImportOptions['conflict']>(plan?.kind === 'backup' ? 'skip' : 'copy');
  if (!plan) return null;
  const run = s.importRun;
  const conflicts = plan.notes.filter((n) => n.conflictId).length;
  const dirs = new Set(plan.notes.map((n) => n.dir.join('/')).filter(Boolean)).size + plan.folders.length;
  const tags = new Set(plan.notes.flatMap((n) => n.tags)).size;
  const close = () => { if (!run) ws.closeDialog(); };

  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <div className="dialog import-dialog" role="dialog" aria-modal="true" aria-label="가져오기" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
        <h2>{plan.heading ?? (plan.kind === 'backup' ? 'DamianNote 백업 되살리기' : plan.source.startsWith('노션') ? '노션 가져오기' : 'Markdown 가져오기')}</h2>
        <p className="import-src">{plan.source}</p>
        <div className="import-stats">
          <span><b>{plan.notes.length.toLocaleString()}</b>노트</span>
          <span><b>{dirs.toLocaleString()}</b>폴더</span>
          <span><b>{tags.toLocaleString()}</b>태그</span>
          {plan.templates.length > 0 && <span><b>{plan.templates.length}</b>템플릿</span>}
        </div>
        <ul className="import-list" aria-label="가져올 노트">
          {plan.notes.slice(0, 8).map((n) => (
            <li key={n.id}><Icon name="note" size={14} />{[...n.dir, n.title].join(' / ')}{n.conflictId && <em>이미 있음</em>}</li>
          ))}
          {plan.notes.length > 8 && <li className="more">… 외 {plan.notes.length - 8}개</li>}
        </ul>
        {plan.warnings.map((w) => <p key={w} className="import-warn"><Icon name="alert" size={14} />{w}</p>)}

        {!run ? (
          <>
            <label className="import-field">넣을 곳
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="__new">새 폴더 '가져온 노트 (오늘 날짜)'</option>
                <option value="">맨 위 (폴더 밖)</option>
                {s.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="import-field">모두에 붙일 태그
              <input value={tag} placeholder="예: 옵시디언 (비워 두면 안 붙임)" onChange={(e) => setTag(e.target.value.replace(/^#/, ''))} />
            </label>
            {conflicts > 0 && (
              <fieldset className="import-field">
                <legend>같은 노트가 이미 {conflicts}개 있어요</legend>
                <label><input type="radio" checked={conflict === 'skip'} onChange={() => setConflict('skip')} />건너뛰기</label>
                <label><input type="radio" checked={conflict === 'copy'} onChange={() => setConflict('copy')} />사본으로 추가</label>
                {plan.kind === 'markdown' && <label><input type="radio" checked={conflict === 'merge'} onChange={() => setConflict('merge')} />기존 노트에 합치기</label>}
                {plan.kind === 'backup' && <label><input type="radio" checked={conflict === 'replace'} onChange={() => setConflict('replace')} />백업 내용으로 바꾸기</label>}
              </fieldset>
            )}
            <p className="import-note">가져온 뒤 알림의 [되돌리기]나 설정 › 데이터에서 이번 가져오기를 한 번에 휴지통으로 보낼 수 있어요.</p>
            <div className="dialog-actions">
              <button className="btn" onClick={close}>취소</button>
              <button className="btn primary" disabled={!plan.notes.length} onClick={() => void ws.runImport({ target, conflict, ...(tag.trim() ? { tag: tag.trim() } : {}) })}>
                {plan.notes.length.toLocaleString()}개 가져오기
              </button>
            </div>
          </>
        ) : (
          <div className="import-progress" role="status">
            <div className="bar"><div style={{ width: `${Math.round((run.done / Math.max(1, run.total)) * 100)}%` }} /></div>
            <span>{run.done.toLocaleString()} / {run.total.toLocaleString()}</span>
            <button className="btn sm" onClick={() => ws.cancelImport()}>중단</button>
          </div>
        )}
      </div>
    </div>
  );
}
