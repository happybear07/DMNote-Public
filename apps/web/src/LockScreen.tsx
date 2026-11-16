// 잠금 화면 (FR-145): 앱 전체를 가린다 — 뒤의 노트 내용은 보이지 않는다. 잠긴 노트 풀기 (FR-144)는 같은 입력 칸을 노트 자리에.
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { Workspace } from './workspace';

export function UnlockForm({ ws, label }: { ws: Workspace; label: string }) {
  const [pw, setPw] = useState('');
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const submit = async () => {
    if (!pw || busy) return;
    setBusy(true);
    const ok = await ws.unlockVault(pw);
    setBusy(false);
    if (!ok) { setWrong(true); setPw(''); input.current?.focus(); }
  };
  return (
    <form className="unlock-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <input ref={input} type="password" autoComplete="current-password" placeholder="잠금 비밀번호" aria-label={label} value={pw}
        onChange={(e) => { setPw(e.target.value); setWrong(false); }} aria-invalid={wrong} />
      <button className="btn primary" type="submit" disabled={!pw || busy}>{busy ? '확인 중…' : '풀기'}</button>
      {wrong && <p className="unlock-wrong" role="alert">비밀번호가 맞지 않아요.</p>}
    </form>
  );
}

/** 앱 잠금 화면 — 전체를 덮는다 */
export function LockScreen({ ws }: { ws: Workspace }) {
  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="잠금 화면">
      <div className="lock-card">
        <span className="lock-icon"><Icon name="eyeOff" size={28} /></span>
        <h2>DamianNote가 잠겨 있어요</h2>
        <p>잠금 비밀번호를 넣으면 이어서 쓸 수 있어요.</p>
        <UnlockForm ws={ws} label="잠금 비밀번호" />
      </div>
    </div>
  );
}

/** 잠긴 노트를 열려고 할 때 노트 자리에 */
export function NoteUnlock({ ws, title }: { ws: Workspace; title: string }) {
  return (
    <div className="note-unlock" role="region" aria-label="잠긴 노트">
      <span className="lock-icon"><Icon name="eyeOff" size={24} /></span>
      <h2>{title || '제목 없음'}</h2>
      <p>잠긴 노트예요. 잠금 비밀번호로 풀면 열려요.</p>
      <UnlockForm ws={ws} label="잠긴 노트 비밀번호" />
    </div>
  );
}
