// 문서 뷰 확대 (워드 상태 줄의 확대 · 쪽 너비 · 한 쪽): 종이 묶음(.dn-doc-page)에 CSS zoom.
// 쪽 나누기(doc-pages)는 그려진 크기를 배율로 나눠 재므로 그대로이고, ⋮⋮ 손잡이 · 놓을 자리 줄은 확대 밖(root)에 화면 좌표로 그린다.
import type { DocView } from './doc-view';

/** 숫자 = 배율, 'width' = 쪽 너비에 맞춤, 'page' = 한 쪽이 다 보이게 */
export type DocZoom = number | 'width' | 'page';
const DOC_ZOOMS: readonly number[] = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const DOC_ZOOM_MIN = 0.25, DOC_ZOOM_MAX = 3;
const GUTTER = 32, MARGIN_Y = 48;

const clamp = (z: number) => Math.round(Math.min(DOC_ZOOM_MAX, Math.max(DOC_ZOOM_MIN, z)) * 100) / 100;

/** 지금 배율 */
function docZoomOf(dv: DocView): number { return Number(dv.page.style.zoom) || 1; }

/** 쪽 너비 · 한 쪽에 맞는 배율 — 보이는 칸(문서 스크롤 칸) 크기 기준 */
function fitDocZoom(dv: DocView, mode: 'width' | 'page'): number {
  const sc = dv.opts.container, z = docZoomOf(dv);
  const w = dv.page.getBoundingClientRect().width / z;
  const sheet = dv.page.querySelector('.dn-doc-sheet')?.getBoundingClientRect();
  const h = sheet?.height ? sheet.height / z : w * Math.SQRT2;
  if (!w || !sc.clientWidth) return 1;
  const byW = (sc.clientWidth - GUTTER) / w;
  return clamp(mode === 'width' ? byW : Math.min(byW, (sc.clientHeight - MARGIN_Y) / h));
}

/** 배율을 정한다 (맞춤이면 지금 칸 크기로 셈). 보던 자리는 그대로 — 화면 위 끝의 문서 지점이 위에 남게. 정한 배율을 돌려준다 */
export function applyDocZoom(dv: DocView, mode: DocZoom): number {
  const z = typeof mode === 'number' ? clamp(mode) : fitDocZoom(dv, mode);
  const old = docZoomOf(dv);
  if (Math.abs(z - old) < 0.005) return old;
  const sc = dv.opts.container, at = sc.scrollTop / old;
  dv.page.style.zoom = z === 1 ? '' : String(z);
  sc.scrollTop = at * z;
  return z;
}

/** 한 단계 크게 · 작게 (DOC_ZOOMS 차례) */
export function stepDocZoom(z: number, dir: 1 | -1): number {
  const next = dir > 0 ? DOC_ZOOMS.find((x) => x > z + 0.005) : [...DOC_ZOOMS].reverse().find((x) => x < z - 0.005);
  return next ?? (dir > 0 ? DOC_ZOOMS.at(-1)! : DOC_ZOOMS[0]!);
}
