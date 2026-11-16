// 블록 댓글 창 (FR-132): 열린 댓글 · (펼치면) 해결한 댓글, 해결 · 다시 열기 · 지우기, 새 댓글(고른 글에 단 것이면 그 글을 인용으로).
// 블록 옆에 뜨고, 바깥을 누르거나 Esc면 닫힌다. Ctrl+Enter로 달기.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addComment, blockComments, deleteComment, setCommentResolved, type BlockComment } from '@dn/engine-core';
import { commentMarkEdits, type CommentRequest } from '@dn/engine-dom';
import { ago, type Workspace } from './workspace';

export function CommentThread({ ws, req, rev }: { ws: Workspace; req: CommentRequest; rev: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [pos, setPos] = useState({ x: req.x, y: req.y });
  const engine = ws.view?.engine;
  // 엔진이 바뀌면(댓글 달기 · 해결 · 실행 취소 · 다른 탭) 다시 그린다
  const [, bump] = useState(0);
  useEffect(() => engine?.subscribe(() => bump((n) => n + 1)), [engine]);
  const block = engine?.getBlock(req.blockId);
  const list = blockComments(block);
  const open = list.filter((c) => !c.resolved), done = list.filter((c) => c.resolved);
  const close = () => ws.closeComments();
  void rev;

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.max(8, Math.min(req.x, innerWidth - r.width - 8)), y: req.y + r.height > innerHeight - 8 ? Math.max(8, innerHeight - r.height - 8) : req.y });
  }, [req.x, req.y, list.length, showResolved]);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, [req.blockId, req.draft?.anchor]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });
  // 블록이 사라지면 (실행 취소 · 지우기) 닫는다
  useEffect(() => { if (engine && !block) close(); });
  if (!engine || !block) return null;

  const submit = () => {
    if (!text.trim()) return;
    const r = addComment(engine, req.blockId, text, req.draft ? { quote: req.draft.quote, anchor: req.draft.anchor } : {});
    if (r.ok) { setText(''); ws.setCommentDraft(null); }
  };
  const resolve = (c: BlockComment, v: boolean) => setCommentResolved(engine, req.blockId, c.id, v, v ? commentMarkEdits(engine, req.blockId, c.anchor) : []);
  const remove = (c: BlockComment) => deleteComment(engine, req.blockId, c.id, commentMarkEdits(engine, req.blockId, c.anchor));
  const item = (c: BlockComment) => (
    <li key={c.id} className={`cm-item${c.resolved ? ' resolved' : ''}`}>
      {c.quote && <blockquote>{c.quote}</blockquote>}
      <p>{c.text}</p>
      <div className="cm-meta">
        <small>{ago(c.at)}</small>
        <span>
          <button className="cm-act" onClick={() => resolve(c, !c.resolved)}>{c.resolved ? '다시 열기' : '해결'}</button>
          <button className="cm-act danger" aria-label="댓글 지우기" onClick={() => remove(c)}>지우기</button>
        </span>
      </div>
    </li>
  );
  return (
    <div ref={ref} className="menu comment-thread" role="dialog" aria-label="댓글" style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); ws.view?.root.focus({ preventScroll: true }); } }}>
      <div className="cm-head"><b>댓글</b><small>{open.length ? `열린 댓글 ${open.length}개` : '열린 댓글 없음'}</small></div>
      {open.length > 0 && <ul className="cm-list">{open.map(item)}</ul>}
      {done.length > 0 && (
        <button className="cm-toggle" onClick={() => setShowResolved((v) => !v)}>{showResolved ? '해결한 댓글 숨기기' : `해결한 댓글 ${done.length}개 보기`}</button>
      )}
      {showResolved && done.length > 0 && <ul className="cm-list">{done.map(item)}</ul>}
      <div className="cm-new">
        {req.draft?.quote && <blockquote>{req.draft.quote}</blockquote>}
        <textarea ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={req.draft ? '고른 글에 댓글…' : '댓글 달기…'} rows={2}
          aria-label="새 댓글" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }} />
        <div className="cm-new-actions">
          <small>본문과 따로 저장 · 내보내기에 안 나와요</small>
          <button className="btn sm primary" disabled={!text.trim()} onClick={submit}>달기</button>
        </div>
      </div>
    </div>
  );
}
