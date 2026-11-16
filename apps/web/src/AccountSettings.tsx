// 설정 › 계정 (화면 17-3 일부, FR-094): 로그인 상태 · 로그인 · 로그아웃(노트는 이 기기에 남김, MSG-ACC-001).
import type { ConfirmRequest } from './ConfirmDialog';
import type { Workspace, WorkspaceState } from './workspace';

export function AccountSettings({ ws, s, confirm }: { ws: Workspace; s: WorkspaceState; confirm: (r: ConfirmRequest) => void }) {
  if (!s.account) {
    return (
      <section>
        <p className="desc">로그인하면 여러 기기에서 같은 노트를 쓸 수 있어요. 로그인하지 않아도 이 기기에서는 모든 편집 기능을 쓸 수 있어요.</p>
        {!ws.auth.configured && <p className="desc">동기화 서버가 아직 연결되지 않았어요. 연결되면 여기서 바로 로그인할 수 있어요.</p>}
        <button className="btn primary" onClick={() => ws.auth.open()}>로그인</button>
      </section>
    );
  }
  return (
    <section>
      <div className="row"><span>계정</span><b>{s.account.email}</b></div>
      <p className="desc">로그아웃해도 이 기기의 노트는 그대로 남고, 동기화만 멈춰요.</p>
      <button className="btn" onClick={() => confirm({
        title: '로그아웃할까요?',
        body: '이 기기의 노트는 남겨 둬요. 로그인 없이 계속 쓰고, 동기화만 멈춰요.',
        confirmLabel: '노트 남기고 로그아웃',
        onConfirm: () => void ws.auth.logout(),
      })}>로그아웃</button>
    </section>
  );
}
