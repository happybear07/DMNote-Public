// 설정 › 보안 (FR-144 · 145 · 146): 잠금 비밀번호 정하기 · 바꾸기 · 지금 잠그기, 앱 잠금(비활성 시간), 보호 범위 안내.
import { useState } from 'react';
import type { Workspace, WorkspaceState } from './workspace';
import { MIN_PASSWORD } from './ws-lock';
import { UnlockForm } from './LockScreen';

export function SecuritySettings({ ws, s }: { ws: Workspace; s: WorkspaceState }) {
  const [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [old, setOld] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<string | null>) => { setBusy(true); try { setMsg(await fn()); } finally { setBusy(false); } };

  return (
    <section className="security">
      <h3>잠금 비밀번호</h3>
      {s.vault === 'none' ? (
        <>
          <p className="desc">잠금을 쓰려면 이 기기의 잠금 비밀번호를 먼저 정해 주세요. <b>잊으면 잠긴 노트는 누구도 되살릴 수 없어요.</b> 노트 글은 암호화되지만 붙인 그림 · 파일은 암호화되지 않아요.</p>
          <div className="pw-form">
            <input type="password" autoComplete="new-password" placeholder={`새 비밀번호 (${MIN_PASSWORD}자 이상)`} aria-label="새 비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} />
            <input type="password" autoComplete="new-password" placeholder="한 번 더" aria-label="비밀번호 확인" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            <button className="btn primary" disabled={busy || pw.length < MIN_PASSWORD || pw !== pw2}
              onClick={() => void run(async () => { const ok = await ws.setupVault(pw); setPw(''); setPw2(''); return ok ? '잠금 비밀번호를 정했어요.' : '정하지 못했어요.'; })}>비밀번호 정하기</button>
          </div>
          {pw2 && pw !== pw2 && <p className="desc small warn">두 비밀번호가 달라요.</p>}
        </>
      ) : (
        <>
          <p className="desc">지금 {s.vault === 'open' ? <b>풀려 있어요</b> : '잠겨 있어요'}. 잠긴 노트는 이 기기에서 이 비밀번호로만 열려요.</p>
          {s.vault === 'locked' && <UnlockForm ws={ws} label="잠금 비밀번호" />}
          <div className="row-gap">
            {s.vault === 'open' && <button className="btn" onClick={() => void ws.lockVault().then(() => setMsg('잠갔어요. 잠긴 노트를 열 때 비밀번호를 물어봐요.'))}>지금 잠그기</button>}
          </div>
          <h4>비밀번호 바꾸기</h4>
          <div className="pw-form">
            <input type="password" autoComplete="current-password" placeholder="지금 비밀번호" aria-label="지금 비밀번호" value={old} onChange={(e) => setOld(e.target.value)} />
            <input type="password" autoComplete="new-password" placeholder={`새 비밀번호 (${MIN_PASSWORD}자 이상)`} aria-label="새 비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} />
            <button className="btn" disabled={busy || !old || pw.length < MIN_PASSWORD}
              onClick={() => void run(async () => {
                const r = await ws.changeVaultPassword(old, pw);
                if (r === 'ok') { setOld(''); setPw(''); return '비밀번호를 바꿨어요. 잠긴 노트는 그대로예요.'; }
                return r === 'wrong' ? '지금 비밀번호가 맞지 않아요.' : `새 비밀번호는 ${MIN_PASSWORD}자 이상이어야 해요.`;
              })}>바꾸기</button>
          </div>
        </>
      )}
      {msg && <p className="desc small" role="status">{msg}</p>}

      <h3>앱 잠금</h3>
      <label className="check">
        <input type="checkbox" checked={s.appLock.enabled} disabled={s.vault === 'none'} onChange={(e) => void ws.setAppLock(e.target.checked)} />
        앱을 열 때 · 한동안 쓰지 않으면 잠금 화면
      </label>
      <label className="inline">
        비활성 후 잠금
        <select value={s.appLock.minutes} disabled={!s.appLock.enabled} onChange={(e) => void ws.setAppLock(true, Number(e.target.value))} aria-label="비활성 후 잠금 시간">
          {[1, 5, 15, 30, 60].map((m) => <option key={m} value={m}>{m}분</option>)}
        </select>
      </label>
      {s.vault === 'none' && <p className="desc small">잠금 비밀번호를 정하면 켤 수 있어요.</p>}
      <p className="desc small">앱 잠금은 화면을 가리는 잠금이에요. 저장된 내용 자체를 암호화하는 건 노트 · 폴더 잠금이에요.</p>

      <details className="more">
      <summary>무엇이 어떻게 보호되나요</summary>
      <ul className="desc protect">
        <li><b>잠근 노트 · 폴더</b>: 내용 · 버전 기록을 비밀번호에서 만든 열쇠(AES-256)로 암호화해 이 기기에 저장해요. 목록에는 제목만 보이고, 검색 · 할 일 모으기 · 내보내기에서 빠져요.</li>
        <li><b>잠그지 않은 노트</b>: 브라우저 저장소에 그대로 저장돼요 (기기 · 운영체제의 저장 보호에 맡겨요).</li>
        <li><b>종단간 암호화(E2EE) 아님</b>: v1은 서버 동기화가 아직 없고, 생기더라도 v1은 전송 구간 암호화(TLS)만 써요. 잠근 노트만 기기에서 암호화된 채로 오가요.</li>
        <li>운영체제 키체인 · 생체 인증 연동은 앱 형태(네이티브)가 생길 때 지원할 예정이에요.</li>
      </ul>
      </details>
    </section>
  );
}
