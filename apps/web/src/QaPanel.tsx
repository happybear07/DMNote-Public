// 노트에 묻기 패널 (FR-116~119 · 화면 21 오른쪽 패널): 범위 고르기 · 질문 → 답(인용 번호) · 출처 목록(누르면 그 노트 · 블록으로) ·
// 새 노트로 저장 · 이 노트에 넣기. 근거 없는 답은 접어서 보이고 저장할 수 없다(FR-117 "출처 없는 답변은 제공하지 않음").
import { useEffect, useRef, useState } from 'react';
import type { QaScope, QaState, QaTurnState } from './qa-flow';
import type { Workspace, WorkspaceState } from './workspace';
import { Icon } from './Icon';

const scopeKey = (s: QaScope) => (s.kind === 'all' ? 'all' : `${s.kind}:${s.id}`);
const parseScope = (k: string): QaScope => {
  if (k === 'all') return { kind: 'all' };
  const [kind, id] = k.split(':') as ['note' | 'folder' | 'tag' | 'role', string];
  return { kind, id };
};

function Answer({ ws, t }: { ws: Workspace; t: QaTurnState }) {
  const a = t.answer!;
  const refs: string[] = [];
  const num = (ref: string, quote: string) => { const k = `${ref}|${quote}`; let i = refs.indexOf(k); if (i < 0) { refs.push(k); i = refs.length - 1; } return i + 1; };
  const body = a.segments.map((s, i) => (
    <span key={i}>{s.text}{s.cites.map((c) => {
      const n = num(c.ref, c.quote);
      return <button key={n} className="qa-cite" title={`${c.noteTitle} — "${c.quote}"`} aria-label={`출처 ${n}: ${c.noteTitle}`} onClick={() => void ws.qa.openCite(c.ref)}>{n}</button>;
    })}</span>
  ));
  const sources = a.segments.flatMap((s) => s.cites).filter((c, i, all) => all.findIndex((x) => x.ref === c.ref && x.quote === c.quote) === i);
  const text = a.segments.map((s) => s.text).join('');
  if (!a.grounded && sources.length === 0 && !text.startsWith('노트에서 답을')) {
    return <details className="qa-ungrounded"><summary>노트에서 근거를 찾지 못한 답변</summary><p className="qa-text">{body}</p></details>;
  }
  return (
    <div className="qa-answer">
      <p className="qa-text">{body}</p>
      {sources.length > 0 && (
        <ol className="qa-sources" aria-label="출처">
          {sources.map((c) => (
            <li key={`${c.ref}|${c.quote}`}><button onClick={() => void ws.qa.openCite(c.ref)}><b>{c.noteTitle || '제목 없음'}</b><small>"{c.quote}"</small></button></li>
          ))}
        </ol>
      )}
      {a.grounded && (
        <div className="qa-actions">
          <button className="btn sm" onClick={() => void ws.qa.saveAsNote(t)}>새 노트로 저장</button>
          <button className="btn sm" onClick={() => ws.qa.insertHere(t)}>이 노트에 넣기</button>
        </div>
      )}
    </div>
  );
}

export function QaPanel({ ws, s, qa }: { ws: Workspace; s: WorkspaceState; qa: QaState }) {
  const [q, setQ] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const running = qa.turns.some((t) => t.status === 'running');
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [qa.turns]);
  const submit = () => { if (!q.trim() || running) return; void ws.qa.ask(q); setQ(''); };
  return (
    <aside className="qa-panel" aria-label="노트에 묻기">
      <header>
        <h2>노트에 묻기</h2>
        <button className="x" aria-label="닫기" onClick={() => ws.qa.close()}><Icon name="close" size={14} /></button>
      </header>
      <label className="qa-scope">범위
        <select value={scopeKey(qa.scope)} onChange={(e) => ws.qa.setScope(parseScope(e.target.value))}>
          <option value="all">전체 노트</option>
          {s.currentId && <option value={`note:${s.currentId}`}>현재 노트</option>}
          {s.folders.length > 0 && <optgroup label="폴더">{s.folders.map((f) => <option key={f.id} value={`folder:${f.id}`}>{f.name}</option>)}</optgroup>}
          <optgroup label="역할">{ws.roles.map((r) => <option key={r.id} value={`role:${r.id}`}>{r.name}</option>)}</optgroup>
          {s.tags.length > 0 && <optgroup label="태그">{s.tags.map((t) => <option key={t.id} value={`tag:${t.id}`}>#{t.name}</option>)}</optgroup>}
        </select>
      </label>
      <div className="qa-log" role="log" aria-live="polite">
        {!qa.turns.length && <p className="qa-empty">내 노트에 적힌 내용으로만 답해요. 근거가 된 노트를 눌러 바로 갈 수 있어요.<br />전체 노트에 물으면 질문에 맞는 역할(회의록 등) · #태그 노트부터 찾아요.<br />예: "지난 회의에서 정한 예산은?"</p>}
        {qa.turns.map((t, i) => (
          <div key={i} className="qa-turn">
            <p className="qa-q">{t.question}</p>
            {t.status === 'running' && <p className="qa-wait" role="status"><i />노트에서 찾는 중… <button className="btn sm" onClick={() => ws.qa.cancel()}>취소</button></p>}
            {t.status === 'error' && <p className="qa-err" role="alert">{t.error}</p>}
            {t.status === 'done' && t.scope && <p className="qa-used" title="이 질문에서 근거를 찾은 범위">범위: {t.scope}</p>}
            {t.status === 'done' && t.answer && <Answer ws={ws} t={t} />}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="qa-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea ref={input} rows={2} aria-label="질문" placeholder="노트에 물어보기 (Enter로 보내기 · Shift+Enter 줄바꿈)" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } else if (e.key === 'Escape') ws.qa.close(); }} />
        <button type="submit" className="btn primary" disabled={!q.trim() || running}>묻기</button>
      </form>
      {/* AI와 대화한다는 표시 · 결과 확인 안내 (Anthropic 이용 정책 · Commercial Terms D.3, LEGAL-RISK 2.3.3 · 2.3.6) */}
      <p className="qa-ai-note">AI(Claude)가 노트를 근거로 답해요. 틀릴 수 있으니 출처를 눌러 원문을 확인해 주세요.</p>
    </aside>
  );
}
