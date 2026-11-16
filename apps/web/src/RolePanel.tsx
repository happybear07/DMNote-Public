// 노트 정보 패널의 역할 · 요약 카드 (노트에 묻기 범위 좁히기, 10/26): 역할 고르기(직접 · 추정 표시) · 역할 만들기 · 만든 역할 지우기,
// 이 노트의 최소 요약 md(제목 · 역할 · 태그 · 소제목 · 키워드 — 전체 노트 질문의 범위를 정할 때 이것만 본다).
import { useState } from 'react';
import type { NoteMeta } from '@dn/storage-idb';
import { Icon } from './Icon';
import { roleName } from './note-scope';
import type { Workspace } from './workspace';

export function RolePanel({ ws, note }: { ws: Workspace; note: NoteMeta }) {
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  const [words, setWords] = useState('');
  const [err, setErr] = useState('');
  const roles = ws.roles;
  const custom = roles.find((r) => r.id === note.role && !r.builtin);
  const guessed = !note.role && note.roleGuess ? roleName(roles, note.roleGuess) : undefined;
  const digest = ws.index.card(note.id)?.digest;
  const save = async () => {
    const e = await ws.addNoteRole(name, words.split(/[,，·\s]+/));
    if (e) { setErr(e); return; }
    const id = ws.roles.find((r) => r.name === name.trim())?.id;
    if (id) ws.setNoteRole(id);
    setMaking(false); setName(''); setWords(''); setErr('');
  };
  return (
    <>
      <div className="panel-section"><Icon name="flag" size={14} />역할 · 요약 카드</div>
      <div className="panel-role">
        <label className="toggle-row"><span>역할</span>
          <select aria-label="노트 역할" value={note.role ?? ''} onChange={(e) => { if (e.target.value === '+') setMaking(true); else ws.setNoteRole(e.target.value || null); }}>
            <option value="">{guessed ? `자동 (추정: ${guessed})` : '없음 (자동 추정)'}</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            <option value="+">새 역할 만들기…</option>
          </select>
        </label>
        {custom && <button className="link-btn" onClick={() => void ws.removeNoteRole(custom.id)}>'{custom.name}' 역할 지우기</button>}
        {making && (
          <form className="role-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <input aria-label="역할 이름" placeholder="역할 이름 (예: 거래처 미팅)" value={name} maxLength={30} autoFocus onChange={(e) => setName(e.target.value)} />
            <input aria-label="이 역할을 가리키는 낱말" placeholder="질문에서 가리키는 낱말 (예: 거래처, 견적)" value={words} onChange={(e) => setWords(e.target.value)} />
            {err && <p className="role-err" role="alert">{err}</p>}
            <div className="role-actions">
              <button type="submit" className="btn sm primary">만들고 이 노트에 적용</button>
              <button type="button" className="btn sm" onClick={() => { setMaking(false); setErr(''); }}>취소</button>
            </div>
          </form>
        )}
        <p className="panel-empty">전체 노트에 물으면 질문에 맞는 역할 · #태그 노트부터 찾고, 없으면 아래 요약 카드로 범위를 정해요.</p>
        {digest && <pre className="panel-digest" aria-label="노트 요약 카드">{digest}</pre>}
      </div>
    </>
  );
}
