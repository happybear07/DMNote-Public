// 설정 › 알림 (FR-138): 앱 안 알림 · 기기 알림 켜고 끄기, 방해 금지 시간대, 기기 알림 권한 안내 · 시험 알림.
import { useEffect, useState } from 'react';
import type { RemindPrefs } from './reminders';
import type { Workspace } from './workspace';

type Perm = NotificationPermission | 'unsupported';
const perm = (): Perm => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

export function NotifySettings({ ws }: { ws: Workspace }) {
  const [p, setP] = useState<RemindPrefs | null>(null);
  const [permission, setPermission] = useState<Perm>(perm());
  useEffect(() => { void ws.remindPrefs().then(setP); }, [ws]);
  if (!p) return <section><p className="desc">불러오는 중…</p></section>;
  const save = (next: RemindPrefs) => { setP(next); void ws.setRemindPrefs(next); };
  const ask = async () => { if (typeof Notification !== 'undefined') await Notification.requestPermission().catch(() => 'default'); setPermission(perm()); };
  return (
    <>
      <section>
        <h3>알림 받는 곳</h3>
        <p className="desc">글 속 날짜 · 할 일 · 데이터베이스 날짜에 정한 시각이 되면 알려 줘요.</p>
        <label className="toggle-row"><span>앱 안 알림 (화면 아래 안내)</span>
          <input type="checkbox" role="switch" checked={p.inApp} onChange={(e) => save({ ...p, inApp: e.target.checked })} /></label>
        <label className="toggle-row"><span>기기 알림 (앱이 안 보일 때)</span>
          <input type="checkbox" role="switch" checked={p.device} onChange={(e) => save({ ...p, device: e.target.checked })} /></label>
        <p className="desc small" role="status">
          {permission === 'granted' ? '기기 알림: 허용됨'
            : permission === 'denied' ? '기기 알림을 브라우저가 막았어요 — 주소창 왼쪽의 사이트 설정에서 알림을 허용해 주세요.'
              : permission === 'unsupported' ? '이 브라우저는 기기 알림을 지원하지 않아요. 앱 안 알림은 그대로 떠요.'
                : '기기 알림 권한을 아직 정하지 않았어요.'}
        </p>
        {permission === 'default' && p.device && <button className="btn sm" onClick={() => void ask()}>기기 알림 허용</button>}
        <button className="btn sm" onClick={() => ws.testReminder()}>시험 알림</button>
      </section>
      <section>
        <h3>방해 금지</h3>
        <p className="desc">이 시간엔 알리지 않고, 끝나면 놓친 알림을 모아 보여 줘요.</p>
        <label className="toggle-row"><span>방해 금지 시간대 쓰기</span>
          <input type="checkbox" role="switch" checked={!!p.quiet} onChange={(e) => save({ ...p, quiet: e.target.checked ? { from: '22:00', to: '08:00' } : undefined })} /></label>
        {p.quiet && (
          <div className="quiet-row">
            <label>시작<input type="time" value={p.quiet.from} onChange={(e) => save({ ...p, quiet: { ...p.quiet!, from: e.target.value || p.quiet!.from } })} /></label>
            <label>끝<input type="time" value={p.quiet.to} onChange={(e) => save({ ...p, quiet: { ...p.quiet!, to: e.target.value || p.quiet!.to } })} /></label>
          </div>
        )}
      </section>
    </>
  );
}
