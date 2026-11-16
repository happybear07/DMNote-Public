// 발표 모드 (GAP #21): 캔버스를 화면 가득, 장면(engine-core present.ts)마다 그 상자들에 맞춰 화면을 옮기고 나머지는 옅게.
// → · Space · PageDown · Enter · 누르기 = 다음, ← · PageUp · Backspace = 앞, Home · End, Esc = 끝. 발표 중에는 보기 전용.
// 끝나면 화면 위치 · 고르기 · 보기 전용을 발표 전으로 돌린다. 아래 가운데에 'n / 전체'.
import { unionRects, type Camera, type Id, type Rect } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';

export interface Presenting { stop(): void; go(i: number): void; readonly index: number }

export function startPresent(view: CanvasView, slides: readonly (readonly Id[])[], onEnd?: () => void): Presenting | null {
  if (!slides.length) return null;
  view.endEditing();
  const before: { cam: Camera; ro: boolean; sel: Id[] } = { cam: { ...view.cam }, ro: view.readOnly, sel: view.selectedBlocks };
  view.select([]);
  view.setReadOnly(true);
  view.root.classList.add('dn-present');
  const hud = document.createElement('div');
  hud.className = 'dn-present-hud dn-ui';
  view.root.append(hud);
  let i = 0, alive = true;
  const mark = () => {
    if (!alive) return;
    const on = new Set(slides[i]);
    for (const [id, m] of view.mounted) m.el.classList.toggle('dn-present-on', on.has(id));
  };
  const fit = (animate: boolean) => {
    const r = unionRects(slides[i]!.map((id) => view.engine.blockRect(id)).filter((x): x is Rect => !!x));
    if (!r) return;
    // 장면을 화면에 꽉 차게 — 캔버스 맞추기(fitRect)는 100%를 넘지 않지만 발표는 2배까지 키운다
    const pad = Math.max(48, Math.min(view.size.w, view.size.h) / 10);
    const zoom = Math.max(0.1, Math.min(2, (view.size.w - pad * 2) / Math.max(r.w, 1), (view.size.h - pad * 2) / Math.max(r.h, 1)));
    const c = { x: r.x + r.w / 2 - view.size.w / 2 / zoom, y: r.y + r.h / 2 - view.size.h / 2 / zoom, zoom };
    if (animate) view.animateTo(c, 350); else view.setCamera(c);
  };
  const go = (n: number) => {
    if (!alive) return;
    i = Math.max(0, Math.min(slides.length - 1, n));
    hud.textContent = `${i + 1} / ${slides.length}`;
    fit(true);
    mark();
    setTimeout(mark, 60); // 화면을 옮기며 새로 그려진 상자도
    setTimeout(mark, 420);
  };
  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    const next = k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter';
    const prev = k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace';
    if (!next && !prev && k !== 'Home' && k !== 'End' && k !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (k === 'Escape') stop();
    else go(next ? i + 1 : prev ? i - 1 : k === 'Home' ? 0 : slides.length - 1);
  };
  const onClick = (e: MouseEvent) => { if (!(e.target as Element | null)?.closest?.('a, .dn-ui, iframe')) go(i + 1); };
  const onResize = () => fit(false);
  const ro = new ResizeObserver(onResize);
  ro.observe(view.root);
  window.addEventListener('keydown', onKey, true);
  view.root.addEventListener('click', onClick);
  const stop = () => {
    if (!alive) return;
    alive = false;
    window.removeEventListener('keydown', onKey, true);
    view.root.removeEventListener('click', onClick);
    ro.disconnect();
    hud.remove();
    view.root.classList.remove('dn-present');
    for (const m of view.mounted.values()) m.el.classList.remove('dn-present-on');
    view.setReadOnly(before.ro);
    const back = () => view.animateTo(before.cam, 0); // 장면을 옮기던 애니메이션을 멈추고 바로 제자리로
    back();
    view.select(before.sel.filter((id) => view.engine.getBlock(id)));
    // 화면 가득에서 나오면 캔버스 크기가 바뀌며 가운데를 맞춘다 — 그 뒤에 한 번 더 제자리로
    if (document.fullscreenElement) void document.exitFullscreen().then(() => { back(); setTimeout(back, 60); }, () => {});
    else setTimeout(back, 60);
    onEnd?.();
  };
  // 화면 가득에서 브라우저가 Esc로 먼저 빠져나오면(키가 오지 않는다) 발표도 끝
  const onFs = () => { if (!document.fullscreenElement) { document.removeEventListener('fullscreenchange', onFs); stop(); } };
  void view.root.requestFullscreen?.().then(() => { document.addEventListener('fullscreenchange', onFs); fit(false); }, () => {});
  go(0);
  return { stop, go, get index() { return i; } };
}
