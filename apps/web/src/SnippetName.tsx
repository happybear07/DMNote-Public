// 내 블록 이름 창 (11/03): 저장할 때 — 넣기(＋) 메뉴에 보일 양식 이름, 넣을 때 — 새로 생기는 블록(콘텐츠 묶음) 이름.
// 처음 값은 저장한 이름(고르기 상태라 바로 덮어 쓸 수 있다) · Enter로 확정 · Esc · 취소 · 바깥 누르기로 그만.
import { useState } from 'react';
import { useEscape } from './hooks';
import type { Dialog } from './ws-model';
import type { Workspace } from './workspace';

export function SnippetName({ ws, d }: { ws: Workspace; d: Extract<Dialog, { kind: 'snippet' }> }) {
  const [name, setName] = useState(d.name);
  const back = () => ws.view?.root.focus({ preventScroll: true });
  const close = () => { ws.closeDialog(); back(); };
  useEscape(close);
  const ok = () => {
    if (!name.trim()) return;
    if (d.save) ws.saveSnippet(d.save, name); else if (d.use) ws.useSnippet(d.use, d.at, name);
    back();
  };
  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <form className="dialog snip-name" role="dialog" aria-modal="true" aria-labelledby="snip-name-title" onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); ok(); }}>
        <h2 id="snip-name-title">{d.save ? '내 블록으로 저장' : '내 블록 넣기'}</h2>
        <p>{d.save ? '넣기(＋) 메뉴의 내 블록에 이 이름으로 보여요.' : '넣는 상자들을 이 이름의 블록으로 묶어요. 사이드바 블록 목록에도 이 이름으로 보여요.'}</p>
        <input className="snip-name-input" autoFocus value={name} maxLength={40} aria-label={d.save ? '양식 이름' : '블록 이름'}
          onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.target.value)} />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={close}>취소</button>
          <button type="submit" className="btn primary" disabled={!name.trim()}>{d.save ? '저장' : '넣기'}</button>
        </div>
      </form>
    </div>
  );
}
