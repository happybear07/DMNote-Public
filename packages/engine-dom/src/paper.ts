// 캔버스 배경 (FR-041): 점 · 괘선 · 모눈 · 무지. 노트마다 저장(note.paper), 간격은 월드 px.
// 점은 화면에서 16~32px 간격을 유지(확대 · 축소에 맞춰 2배씩), 괘선 · 모눈은 종이처럼 월드 간격 그대로 — 너무 촘촘해지면 2배씩 건너뛴다.
import { DEFAULT_PAPER, type Camera, type Paper, type Rect } from '@dn/engine-core';

/** 캔버스 바탕색 (캔버스 설정, note.paper.color): 캔버스 칸에 data-paper를 달면 앱 CSS가 그 안의 색 토큰(--card · --text · --dn-grid …)을
 *  바꾼다 — 상자 · 글 · 2D 그리기가 함께 따라간다. 바뀌었으면 true (2D 색을 다시 읽게) */
export function applyPaperColor(root: HTMLElement, color: string | undefined): boolean {
  const next = color ?? '';
  if ((root.dataset.paper ?? '') === next) return false;
  if (next) root.dataset.paper = next; else delete root.dataset.paper;
  return true;
}

/** cam: 화면 변환(PNG 내보내기는 zoom 1 · 원점 0) · area: 칠할 월드 영역 */
export function drawPaper(ctx: CanvasRenderingContext2D, cam: Camera, area: Rect, paper: Paper | undefined, color: string): void {
  const p = paper ?? DEFAULT_PAPER;
  if (p.kind === 'none') return;
  const z = cam.zoom;
  const sx = (x: number) => (x - cam.x) * z, sy = (y: number) => (y - cam.y) * z;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (p.kind === 'dots') {
    let step = Math.max(8, p.gap);
    while (step * z < 16) step *= 2;
    while (step * z > 32 && step / 2 >= 4) step /= 2;
    const r = Math.max(0.8, Math.min(1.4, z));
    for (let x = Math.floor(area.x / step) * step; x <= area.x + area.w; x += step) {
      for (let y = Math.floor(area.y / step) * step; y <= area.y + area.h; y += step) ctx.fillRect(sx(x) - r / 2, sy(y) - r / 2, r, r);
    }
    return;
  }
  let step = Math.max(8, p.gap);
  while (step * z < 8) step *= 2;
  ctx.lineWidth = 1;
  ctx.globalAlpha = p.kind === 'grid' ? 0.55 : 0.8;
  ctx.beginPath();
  for (let y = Math.floor(area.y / step) * step; y <= area.y + area.h; y += step) {
    const yy = Math.round(sy(y)) + 0.5;
    ctx.moveTo(sx(area.x), yy); ctx.lineTo(sx(area.x + area.w), yy);
  }
  if (p.kind === 'grid') {
    for (let x = Math.floor(area.x / step) * step; x <= area.x + area.w; x += step) {
      const xx = Math.round(sx(x)) + 0.5;
      ctx.moveTo(xx, sy(area.y)); ctx.lineTo(xx, sy(area.y + area.h));
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}
