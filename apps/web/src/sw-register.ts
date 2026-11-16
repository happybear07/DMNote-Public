// 서비스 워커 등록과 새 버전 알림 (ARCHITECTURE 9.3 · MSG-RECOVER-011). 프로덕션 빌드에서만 — 개발 서버(HMR)와 섞이지 않게.

/**
 * `onUpdate(apply)`: 새 버전을 받아 뒀다. `apply()`를 부르면 새 워커로 바꾸고 다시 연다.
 * 다른 탭이 먼저 바꿨으면 apply는 그냥 다시 연다. 편집 중 강제로 새로 고치지 않는다.
 */
export function registerServiceWorker(onUpdate: (apply: () => void) => void): void {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  let applying = false;
  const hadController = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (applying) location.reload();
    else if (hadController) onUpdate(() => location.reload());
  });
  const ask = (w: ServiceWorker) => onUpdate(() => { applying = true; w.postMessage('skip-waiting'); });
  void sw.register('/sw.js').then((reg) => {
    if (reg.waiting && sw.controller) ask(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && sw.controller) ask(w); });
    });
    // 오래 열어 둔 탭(설치형 앱)도 새 버전을 알아채게 — 다시 보일 때 확인
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update().catch(() => {}); });
  }).catch((err) => console.warn('[dn] 서비스 워커 등록 실패', err));
}
