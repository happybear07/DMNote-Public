// 로그인 창 (화면 17 · 17-4 · 17-5 · 17-6, MSG-AUTH · MSG-ACC-012): 처음 → 메일 확인 → (만료) · (삭제 예약).
// 어느 단계에서도 "로그인 없이 계속"(닫기 · Esc)으로 나갈 수 있다 — 로그인은 막는 단계가 아니다(FR-094 · E5).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LoginState } from './account';
import type { Workspace } from './workspace';
import { useEscape } from './hooks';
import { Icon } from './Icon';

const ICON: Record<LoginState['step'], ReactNode> = {
  start: <span aria-hidden="true">🐻</span>,
  sent: <svg viewBox="0 0 24 18" width="24" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M1 1h22v16H1zM1 1l11 9 11-9" /></svg>,
  expired: <svg viewBox="0 0 24 22" width="24" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d="M12 2l11 18H1zM12 8v5M12 16v.5" /></svg>,
  deletion: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" /></svg>,
};

export function LoginDialog({ ws, login }: { ws: Workspace; login: LoginState }) {
  const auth = ws.auth;
  const [email, setEmail] = useState(login.email);
  const [now, setNow] = useState(Date.now());
  const first = useRef<HTMLElement | null>(null);
  useEffect(() => { setEmail(login.email); }, [login.email, login.step]);
  useEffect(() => { first.current?.focus(); }, [login.step]);
  // 다시 보내기: 60초 뒤에 열린다 (남은 초 표시)
  useEffect(() => {
    if (!login.resendAt || login.resendAt <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [login.resendAt]);
  useEscape(() => auth.close(), login.step !== 'deletion');
  const off = !auth.configured;
  const wait = login.resendAt ? Math.max(0, Math.ceil((login.resendAt - now) / 1000)) : 0;
  const date = login.deleteAt ? new Date(login.deleteAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) : '';
  const ref = (el: HTMLElement | null) => { first.current = el; };

  return (
    <div className="dialog-backdrop" onMouseDown={() => login.step !== 'deletion' && auth.close()}>
      <div className={`dialog login-dialog step-${login.step}`} role="dialog" aria-modal="true" aria-labelledby="login-title" onMouseDown={(e) => e.stopPropagation()}>
        {login.step !== 'deletion' && <button className="x" aria-label="닫기 (로그인 없이 계속)" onClick={() => auth.close()}><Icon name="close" size={14} /></button>}
        <div className="login-icon">{ICON[login.step]}</div>
        {login.step === 'start' && (
          <>
            <h2 id="login-title">DamianNote에 로그인</h2>
            <p className="login-sub">로그인하면 여러 기기에서 같은 노트를 쓸 수 있어요.<br />로그인하지 않아도 이 기기에서는 모든 편집 기능을 쓸 수 있어요.</p>
            {off && <p className="login-note" role="note">동기화 서버가 아직 연결되지 않았어요. 지금은 로그인 없이 이 기기에서 쓸 수 있어요.</p>}
            <button className="login-btn" disabled={off} onClick={() => auth.oauth('google')}><b className="g">G</b> Google로 계속하기</button>
            <button className="login-btn apple" disabled={off} onClick={() => auth.oauth('apple')}> Apple로 계속하기</button>
            <div className="login-or"><span>또는 이메일로</span></div>
            <form noValidate onSubmit={(e) => { e.preventDefault(); void auth.sendLink(email); }}>
              <label className="login-label" htmlFor="login-email">이메일</label>
              <input id="login-email" ref={ref} className="login-input" type="email" autoComplete="email" placeholder="you@example.com" value={email} disabled={off}
                aria-invalid={!!login.error} aria-describedby={login.error ? 'login-err' : undefined} onChange={(e) => setEmail(e.target.value)} />
              {login.error && <p id="login-err" className="login-err" role="alert">{login.error}</p>}
              <button type="submit" className="login-btn primary" disabled={off || login.busy || !email.trim()}>{login.busy ? '보내는 중…' : '로그인 링크 받기'}</button>
            </form>
            <p className="login-hint">비밀번호 없이, 메일로 받은 링크를 누르면 바로 로그인돼요.</p>
            <button className="login-skip" onClick={() => auth.close()}>
              <span><b>로그인 없이 이 기기에서만 쓰기</b><small>노트는 이 기기에만 저장돼요. 나중에 언제든 로그인할 수 있어요.</small></span><span aria-hidden="true">›</span>
            </button>
          </>
        )}
        {login.step === 'sent' && (
          <>
            <h2 id="login-title">메일을 확인해 주세요</h2>
            <p className="login-sub"><b>{login.email}</b>으로 로그인 링크를 보냈어요.<br />메일의 링크를 열면 로그인돼요.</p>
            <p className="login-box"><i />이 창은 열어 두세요 — 링크를 열면 자동으로 이어져요</p>
            <button className="login-btn" ref={ref} disabled={wait > 0 || login.busy} onClick={() => void auth.sendLink(login.email)}>{wait > 0 ? `다시 보내기 (${wait}초 후)` : '다시 보내기'}</button>
            {login.error && <p className="login-err" role="alert">{login.error}</p>}
            <button className="login-link" onClick={() => auth.restart()}>다른 방법으로 로그인</button>
            <p className="login-hint">메일이 보이지 않으면 스팸함을 확인해 주세요.<br />링크는 한 번만, 잠깐 동안 쓸 수 있어요.</p>
          </>
        )}
        {login.step === 'expired' && (
          <>
            <h2 id="login-title">로그인 링크가 만료됐어요</h2>
            <p className="login-sub">로그인 링크는 잠깐 동안, 한 번만 쓸 수 있어요.<br />새 링크를 받아 주세요.</p>
            {login.email && <p className="login-box warn"><i />{login.email} 으로 새 링크를 보내요</p>}
            {login.email
              ? <button className="login-btn primary" ref={ref} disabled={login.busy} onClick={() => void auth.sendLink(login.email)}>새 링크 받기</button>
              : <button className="login-btn primary" ref={ref} onClick={() => auth.restart()}>새 링크 받기</button>}
            {login.error && <p className="login-err" role="alert">{login.error}</p>}
            <button className="login-link" onClick={() => auth.restart()}>다른 방법으로 로그인</button>
            <p className="login-hint">로그인하지 않아도 이 기기에서는 모든 편집 기능을 쓸 수 있어요.</p>
          </>
        )}
        {login.step === 'deletion' && (
          <>
            <h2 id="login-title">계정 삭제가 예약돼 있어요</h2>
            <p className="login-sub"><b>{date}</b>에 계정과 서버의 노트가 삭제될 예정이에요.<br />삭제를 취소하고 계속 쓸까요?</p>
            <p className="login-box note"><i />이 기기의 노트는 어느 쪽을 골라도 그대로 남아요</p>
            <button className="login-btn primary" ref={ref} disabled={login.busy} onClick={() => void auth.cancelDeletion()}>삭제 취소하고 계속 쓰기</button>
            <button className="login-btn" onClick={() => void auth.keepDeletion()}>그대로 두고 로그아웃</button>
            {login.error && <p className="login-err" role="alert">{login.error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
