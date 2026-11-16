// 첫 사용 안내 (FR-148): iPad · iPhone 홈 화면 설치 안내 (D1). 빈 캔버스 안내는 10/29 사용자 요청으로 뺐다 — 노트를 만들 때마다 떠서,
// 처음 실행은 예시 노트(buildSampleNote)로, 샘플 체험 · 템플릿은 명령 팔레트 · 사이드바 · 홈에서.
import type { Workspace } from './workspace';

/** iPad · iPhone 브라우저에서 열었을 때 — 설치하지 않으면 7일 동안 안 쓴 사이 데이터가 지워질 수 있다 */
export function InstallHint({ ws }: { ws: Workspace }) {
  return (
    <div className="install-hint" role="alert">
      <div>
        <strong>홈 화면에 추가해 주세요</strong>
        <span>Safari 아래쪽 <b>공유</b> 버튼 → <b>홈 화면에 추가</b>. 추가하지 않으면 7일 동안 열지 않았을 때 이 기기의 노트가 지워질 수 있어요.</span>
      </div>
      <button className="btn sm" onClick={() => ws.dismissInstallHint()}>이번만 닫기</button>
    </div>
  );
}
