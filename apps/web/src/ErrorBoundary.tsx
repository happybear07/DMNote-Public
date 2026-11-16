import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * 렌더 오류 하나로 앱 전체가 흰 화면이 되지 않게 (배포 QA B). 오류가 나면 React가 App을 내리면서
 * Workspace.dispose()가 돌아 대기 중인 편집은 저장된다 — 여기서는 안내와 다시 열기만 보여 준다.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }

  override componentDidCatch(error: unknown, info: ErrorInfo): void { console.error('[dn] 화면 오류', error, info.componentStack); }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="crash" role="alert">
        <strong>화면을 그리다 문제가 생겼어요</strong>
        <span>노트는 이 기기에 저장돼 있어요. 다시 열면 이어서 쓸 수 있어요.</span>
        <span>같은 문제가 계속되면 다시 연 뒤 설정 › 데이터에서 백업을 내보내 두세요 — 백업 파일로 언제든 되살릴 수 있어요.</span>
        <button className="btn primary" onClick={() => location.reload()}>다시 열기</button>
      </div>
    );
  }
}
