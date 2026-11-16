// 카메라 이동 애니메이션.
import type { Camera } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';

/** 카메라 이동 애니메이션. 줌은 로그 공간에서 보간해야 확대 · 축소 속도가 일정하게 보인다. */
export function animateTo(view: CanvasView, target: Camera, ms = 250): void {
  cancelAnimationFrame(view.anim);
  const from = view.cam;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || ms <= 0) { view.setCamera(target); return; }
  const t0 = performance.now();
  // 화면 중심이 직선으로 움직이도록 중심점을 보간한 뒤 좌상단으로 되돌린다. 중심은 시작할 때 한 번 —
  // 도중에 화면 크기가 바뀌어도(노트를 연 직후 둘레가 바뀜) 대상이 가운데에 오게 프레임마다 지금 크기로 되돌린다
  const cx = from.x + view.size.w / from.zoom / 2, cy = from.y + view.size.h / from.zoom / 2;
  const tx = target.x + view.size.w / target.zoom / 2, ty = target.y + view.size.h / target.zoom / 2;
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms);
    const k = 1 - (1 - t) ** 3; // ease-out cubic
    const zoom = t < 1 ? Math.exp(Math.log(from.zoom) + (Math.log(target.zoom) - Math.log(from.zoom)) * k) : target.zoom;
    const mx = cx + (tx - cx) * k, my = cy + (ty - cy) * k;
    view.applyCamera({ x: mx - view.size.w / zoom / 2, y: my - view.size.h / zoom / 2, zoom });
    if (t < 1) view.anim = requestAnimationFrame(step);
  };
  view.anim = requestAnimationFrame(step);
}
