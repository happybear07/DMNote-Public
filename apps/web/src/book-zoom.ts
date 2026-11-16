// 서재 책 펼치기 (11/11, HOME-DESIGN-REFS R12 — 누른 자리에서 커지며 들어가기): 책 자리의 표지 색 면이 홈 화면 전체로 커지며 종이색이 되고,
// 다 커지면 노트를 연다. 움직임 줄이기 설정이면 바로 연다. 0.24초 — 기다리게 하지 않을 만큼.
export function zoomOpen(from: HTMLElement, run: () => void): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { run(); return; }
  const r = from.getBoundingClientRect();
  const host = (from.closest('.home-page') as HTMLElement | null)?.getBoundingClientRect();
  const to = host ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
  if (!r.width || !to.width) { run(); return; }
  const ghost = document.createElement('div');
  ghost.className = 'book-zoom';
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`,
    background: getComputedStyle(from).backgroundColor,
    transform: `translate(${r.left - to.left}px, ${r.top - to.top}px) scale(${r.width / to.width}, ${r.height / to.height})`,
  });
  document.body.appendChild(ghost);
  void ghost.offsetWidth; // 처음 자리를 그린 뒤에 움직인다
  ghost.classList.add('go');
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    run();
    ghost.classList.add('out');
    setTimeout(() => ghost.remove(), 220);
  };
  ghost.addEventListener('transitionend', (e) => { if (e.propertyName === 'transform') finish(); });
  setTimeout(finish, 400); // 전환이 안 끝나는 브라우저 · 숨은 탭
}
