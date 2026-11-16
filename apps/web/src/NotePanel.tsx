// 오른쪽 노트 패널: 노트 정보 (FR-071) · 이 노트를 링크한 노트 = 백링크 (FR-081).
import type { NoteMeta } from '@dn/storage-idb';
import { noteOpenComments } from '@dn/engine-core';
import { Icon } from './Icon';
import { NoteGlyph } from './NoteLook';
import { displayTitle, type Workspace, type WorkspaceState } from './workspace';
import { noteStats } from './ws-model';
import { notePath } from './tree';
import { Outline } from './Outline';
import { RolePanel } from './RolePanel';

const fmt = (t: number) => new Date(t).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function NotePanel({ ws, s, note }: { ws: Workspace; s: WorkspaceState; note: NoteMeta }) {
  const engine = ws.engine;
  const st = engine ? noteStats(engine) : null;
  const links = ws.backlinks();
  const byId = new Map(s.notes.map((n) => [n.id, n]));
  const where = notePath(note, s.notes, s.folders, displayTitle);
  const comments = engine ? noteOpenComments(engine) : [];

  return (
    <aside className="note-panel" aria-label="노트 정보">
      <div className="panel-head">
        <span>노트 정보</span>
        <button className="icon-btn" aria-label="패널 닫기" title="패널 닫기" onClick={() => ws.togglePanel(false)}><Icon name="close" size={14} /></button>
      </div>
      <dl className="info-list">
        <dt>만든 날</dt><dd>{fmt(note.createdAt)}</dd>
        <dt>고친 날</dt><dd>{fmt(note.updatedAt)}</dd>
        {where && <><dt>위치</dt><dd>{where}</dd></>}
        {st && <>
          <dt>블록</dt><dd>{st.blocks.toLocaleString()}개{st.arrows ? ` · 화살표 ${st.arrows.toLocaleString()}개` : ''}</dd>
          <dt>글자</dt><dd>{st.chars.toLocaleString()}자 · {st.words.toLocaleString()}낱말 <small>(공백 제외)</small></dd>
        </>}
      </dl>

      <div className="panel-section"><Icon name="settings" size={14} />페이지</div>
      <div className="panel-page">
        <label className="toggle-row"><span>용지</span>
          <select aria-label="용지" value={s.look.sheet ? (s.look.sheet.landscape ? 'a4l' : 'a4') : 'none'}
            onChange={(e) => ws.setNoteSheet({ size: 'a4', ...(e.target.value === 'a4l' ? { landscape: true } : {}), ...(s.look.sheet?.pages ? { pages: s.look.sheet.pages } : {}) })}>
            {!s.look.sheet && <option value="none" disabled>끝없는 캔버스 (예전 노트)</option>}
            <option value="a4">A4 세로</option>
            <option value="a4l">A4 가로</option>
          </select>
        </label>
        {([['fullWidth', '문서 뷰 전체 폭'], ['smallText', '작은 글자'], ['editLock', '편집 잠금 (풀기 전까지 보기만)']] as const).map(([k, label]) => (
          <label key={k} className="toggle-row">
            <span>{label}</span>
            <input type="checkbox" role="switch" checked={!!s.look.page?.[k]} onChange={(e) => ws.setNotePage({ [k]: e.target.checked })} />
          </label>
        ))}
      </div>

      <RolePanel ws={ws} note={note} />

      <div className="panel-export">
        <button className="btn sm" onClick={() => void ws.exportNote(note.id)}>Markdown 내보내기</button>
        <button className="btn sm" onClick={() => void ws.copyMarkdown(note.id)}>복사</button>
        <button className="btn sm" title="되살릴 수 있는 백업 (하위 노트 · 이미지 포함)" onClick={() => void ws.exportNoteBackup(note.id)}>백업</button>
        <button className="btn sm" onClick={() => ws.openVersions()}>버전 기록</button>
        <button className="btn sm" onClick={() => void ws.exportPng(false)}>PNG</button>
        <button className="btn sm" title="점 · 괘선 · 모눈 배경도 함께" onClick={() => void ws.exportPng(false, true)}>PNG(배경 포함)</button>
      </div>

      <div className="panel-section"><Icon name="info" size={14} />댓글 <span className="count">{comments.length}</span></div>
      {!comments.length && <p className="panel-empty">열린 댓글이 없어요. 블록을 고르고 <kbd>Ctrl+Alt+M</kbd>, 또는 글을 골라 서식 막대의 "댓글".</p>}
      <div className="panel-comments">
        {comments.map(({ blockId, comment: c }) => (
          <button key={c.id} className="panel-comment" onClick={() => {
            const v = ws.view;
            if (!v) return;
            v.focusBlock(blockId);
            const o = v.root.getBoundingClientRect();
            // 블록으로 옮겨 간 뒤에 창을 그 옆에
            setTimeout(() => { const r = v.blockScreenRect(blockId); ws.openComments({ blockId, x: o.left + (r ? r.x + r.w + 12 : 40), y: o.top + (r ? r.y : 40) }); }, 320);
          }}>
            {c.quote && <small>“{c.quote}”</small>}
            <span>{c.text}</span>
          </button>
        ))}
      </div>

      <div className="panel-section"><Icon name="note" size={14} />목차</div>
      <Outline ws={ws} version={s.notes} />

      <div className="panel-section">
        <Icon name="link" size={14} />이 노트를 링크한 노트 <span className="count">{links.length}</span>
      </div>
      {!links.length && <p className="panel-empty">아직 없어요. 다른 노트에서 <kbd>[[</kbd> 또는 <kbd>@</kbd>로 이 노트를 링크하면 여기에 보여요.</p>}
      <div className="backlinks">
        {links.map((l) => {
          const n = byId.get(l.noteId);
          if (!n) return null;
          return (
            <div key={l.noteId} className="backlink">
              <button className="backlink-note" onClick={() => void ws.openHit(l.noteId)}><NoteGlyph icon={n.icon} size={14} />{displayTitle(n)}</button>
              {l.blocks.slice(0, 3).map((b) => (
                <button key={b.id} className="backlink-ctx" title="링크한 자리로 가기" onClick={() => void ws.openHit(l.noteId, b.id)}>
                  {context(b.text, displayTitle(note))}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/** 링크 글자(대상 제목) 앞뒤 문맥 한 줄 — 블록이 길면 링크 주변만 */
function context(text: string, title: string): string {
  const line = text.split('\n').find((l) => l.includes(title)) ?? text.split('\n')[0] ?? '';
  if (line.length <= 90) return line;
  const at = Math.max(0, line.indexOf(title));
  const from = Math.max(0, at - 35);
  return `${from > 0 ? '…' : ''}${line.slice(from, from + 90)}${from + 90 < line.length ? '…' : ''}`;
}
