// 그래프 그리기 (FR-018 — 2026-10-13 다시 그림 · 모양 고르기): 막대 · 꺾은선 · 원(도넛)을 SVG로, 라이브러리 없이.
// 색 · 굵기 · 글자 크기는 SVG 속성으로 직접 준다 — 워드 · 그림 내보내기는 SVG만 떼어 가므로 CSS가 없어도 같은 모양.
// 어두운 테마는 클래스(dn-grid · dn-tick …)로 CSS가 덮는다(canvas.css · theme-dark.css). 범례도 SVG 안에(내보내기에 같이).
// 모양(c.style): 색 묶음 · 계열 색(series.color) · 항목 색 · 값 · 범례 · 눈금선 · 매끈한 선 · 아래 채우기 · 가운데 구멍.
// 막대 · 조각 · 선 · 범례에 data-si(계열 차례) · data-x(항목 이름)를 달아 그래프 창 미리보기에서 눌러 색을 고른다.
import { chartCategories, type ChartContent, type ChartPalette, type ChartStyle } from '@dn/engine-core';
import { svg } from './svg';

/** 색 묶음 — 이웃한 계열끼리 잘 갈리게 차례를 섞어 둔 여덟 색 (막대 · 선 · 도넛 · 범례) */
export const CHART_PALETTES: Record<ChartPalette, { readonly label: string; readonly colors: readonly string[] }> = {
  basic: { label: '기본', colors: ['#3d5fe0', '#14b8a6', '#f59e0b', '#f43f5e', '#8b5cf6', '#0ea5e9', '#84cc16', '#94a3b8'] },
  warm: { label: '따뜻하게', colors: ['#f97316', '#e11d48', '#f59e0b', '#db2777', '#eab308', '#c2410c', '#fb7185', '#a16207'] },
  cool: { label: '시원하게', colors: ['#3b82f6', '#14b8a6', '#6366f1', '#06b6d4', '#8b5cf6', '#10b981', '#0ea5e9', '#64748b'] },
  pastel: { label: '파스텔', colors: ['#93c5fd', '#86efac', '#fcd34d', '#fca5a5', '#c4b5fd', '#67e8f9', '#f9a8d4', '#cbd5e1'] },
  mono: { label: '한 색', colors: ['#4338ca', '#818cf8', '#312e81', '#a5b4fc', '#6366f1', '#c7d2fe', '#3730a3', '#e0e7ff'] },
  gray: { label: '흑백', colors: ['#374151', '#9ca3af', '#1f2937', '#d1d5db', '#6b7280', '#e5e7eb', '#4b5563', '#111827'] },
};
export const CHART_COLORS = CHART_PALETTES.basic.colors;
const INK = { grid: '#ececea', base: '#d4d3cf', tick: '#91908b', label: '#5c5b57', card: '#ffffff' };
const W = 360, H = 220;
const FONT = "'Pretendard Variable', Pretendard, -apple-system, system-ui, 'Malgun Gothic', sans-serif";
type Series = ChartContent['series'];
type Look = Pick<ChartContent, 'series' | 'style'>;

const paletteOf = (c: Pick<ChartContent, 'style'>) => (CHART_PALETTES[c.style?.palette ?? 'basic'] ?? CHART_PALETTES.basic).colors;
/** 켜고 끄는 모양: 적지 않았으면 켬 */
const on = (s: ChartStyle | undefined, k: 'values' | 'legend' | 'grid' | 'smooth' | 'area' | 'hole') => s?.[k] !== false;
/** 계열 색: 계열이 고른 색, 없으면 색 묶음의 si번째 */
export function chartSeriesColor(c: Look, si: number): string {
  const pal = paletteOf(c);
  return c.series[si]?.color ?? pal[si % pal.length]!;
}
/** 항목 색 (원 조각 · 항목마다 다른 색 막대): 항목이 고른 색, 없으면 색 묶음의 i번째(항목 차례) */
export function chartItemColor(c: Look, x: string, i: number): string {
  const pal = paletteOf(c);
  return c.style?.itemColors?.[x] ?? pal[i % pal.length]!;
}
/** 색을 항목마다 고르는 그래프인가 (원 · 계열 하나에 '항목마다 다른 색' 막대) — 아니면 계열마다 */
export const chartColorsByItem = (c: Pick<ChartContent, 'kind' | 'series' | 'style'>) => c.kind === 'pie' || (c.kind === 'bar' && c.series.length === 1 && !!c.style?.vary);

/** 0을 지나는 보기 좋은 눈금 */
function niceTicks(min: number, max: number, n = 4): number[] {
  const lo = Math.min(0, min), hi = Math.max(0, max);
  const span = hi - lo || 1;
  const mag = 10 ** Math.floor(Math.log10(span / n));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(Number(v.toFixed(10)));
  if (out[out.length - 1]! < hi) out.push(out[out.length - 1]! + step);
  return out;
}
/** 눈금 · 값 글자: 만 단위는 '1.2만', 그 밖은 천 단위 쉼표 */
export const fmtNum = (v: number) => (Math.abs(v) >= 10000 ? `${Number((v / 10000).toFixed(1))}만` : Number(v.toFixed(2)).toLocaleString('ko-KR'));
const text = (x: number, y: number, s: string, a: Record<string, string | number> = {}) =>
  svg('text', { x, y, 'font-family': FONT, 'font-size': 10.5, fill: INK.tick, class: 'dn-tick', ...a }, s);
let uid = 0;

export function renderChart(c: ChartContent, el: HTMLElement): void {
  el.replaceChildren();
  el.className = 'dn-chart';
  if (c.title || c.unit) {
    const head = document.createElement('div');
    head.className = 'dn-chart-title';
    head.textContent = c.title ?? '';
    if (c.unit) head.appendChild(Object.assign(document.createElement('small'), { textContent: c.title ? ` · ${c.unit}` : c.unit }));
    el.appendChild(head);
  }
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${c.title ?? '그래프'} — ${c.kind === 'pie' ? '원' : c.kind === 'line' ? '꺾은선' : '막대'} 그래프` });
  const series = c.series.filter((s) => s.points.length);
  if (!series.length) root.appendChild(text(W / 2, H / 2, '데이터가 없어요', { 'text-anchor': 'middle', 'font-size': 12, class: 'dn-chart-empty' }));
  else if (c.kind === 'pie') drawDonut(root, c, series[0]!.points);
  else drawAxes(root, c, series);
  el.appendChild(root);
}

/** 계열이 둘 이상이면 위쪽에 범례 (점 · 이름) */
function legend(root: SVGSVGElement, c: ChartContent, series: Series): number {
  if (series.length < 2 || !on(c.style, 'legend')) return 0;
  let x = 4;
  for (const s of series) {
    const si = c.series.indexOf(s);
    const label = s.name.length > 10 ? `${s.name.slice(0, 9)}…` : s.name;
    root.appendChild(svg('circle', { cx: x + 4, cy: 8, r: 4, fill: chartSeriesColor(c, si), class: 'dn-legend-dot', 'data-si': si }));
    root.appendChild(text(x + 12, 12, label, { fill: INK.label, class: 'dn-legend-text', 'data-si': si }));
    x += 22 + label.length * 9;
  }
  return 20;
}

function drawAxes(root: SVGSVGElement, c: ChartContent, series: Series): void {
  const xs = chartCategories({ categories: c.categories, series });
  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const lo = ticks[0]!, hi = ticks[ticks.length - 1]!;
  const top = 14 + legend(root, c, series);
  const PAD = { l: 12 + Math.max(...ticks.map((t) => fmtNum(t).length)) * 6.2, r: 10, t: top, b: 24 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  for (const t of ticks) {
    if (t === 0) root.appendChild(svg('line', { x1: PAD.l, x2: W - PAD.r, y1: y(t), y2: y(t), stroke: INK.base, 'stroke-width': 1, class: 'dn-base' }));
    else if (on(c.style, 'grid')) root.appendChild(svg('line', { x1: PAD.l, x2: W - PAD.r, y1: y(t), y2: y(t), stroke: INK.grid, 'stroke-width': 1, 'stroke-dasharray': '3 4', class: 'dn-grid' }));
    root.appendChild(text(PAD.l - 8, y(t) + 3.5, fmtNum(t), { 'text-anchor': 'end' }));
  }
  const band = iw / xs.length;
  const every = Math.ceil(xs.length / Math.max(1, Math.floor(iw / 34))); // 항목이 많으면 이름을 건너뛰며
  xs.forEach((x, i) => {
    if (i % every) return;
    const label = x.length > 6 ? `${x.slice(0, 5)}…` : x;
    root.appendChild(text(PAD.l + band * (i + 0.5), H - PAD.b + 15, label, { 'text-anchor': 'middle' }));
  });
  if (c.kind === 'line') drawLines(root, c, series, xs, band, PAD.l, y, ys.every((v) => v >= 0) ? y(Math.max(0, lo)) : null);
  else drawBars(root, c, series, xs, band, PAD.l, y);
}

function drawBars(root: SVGSVGElement, c: ChartContent, series: Series, xs: string[], band: number, x0: number, y: (v: number) => number): void {
  const n = series.length;
  const bw = Math.min(30, (band * 0.68 - (n - 1) * 3) / n), group = bw * n + (n - 1) * 3;
  const vary = n === 1 && c.series.length === 1 && !!c.style?.vary;
  const values = on(c.style, 'values') && xs.length <= 12;
  for (const s of series) {
    const si = c.series.indexOf(s);
    for (const p of s.points) {
      const x = String(p.x), i = xs.indexOf(x);
      const bx = x0 + band * (i + 0.5) - group / 2 + series.indexOf(s) * (bw + 3);
      const yt = y(Math.max(0, p.y)), yb = y(Math.min(0, p.y)), h = Math.max(1, yb - yt);
      const r = Math.min(5, bw / 2, h);
      // 값 쪽 끝만 둥글게 (양수는 위, 음수는 아래)
      const d = p.y >= 0
        ? `M${bx},${yb}V${yt + r}Q${bx},${yt} ${bx + r},${yt}H${bx + bw - r}Q${bx + bw},${yt} ${bx + bw},${yt + r}V${yb}Z`
        : `M${bx},${yt}V${yb - r}Q${bx},${yb} ${bx + r},${yb}H${bx + bw - r}Q${bx + bw},${yb} ${bx + bw},${yb - r}V${yt}Z`;
      const bar = svg('path', { d, fill: vary ? chartItemColor(c, x, i) : chartSeriesColor(c, si), class: 'dn-bar', 'data-si': si, 'data-x': x });
      bar.appendChild(svg('title', {}, `${s.name} · ${x}: ${fmtNum(p.y)}${c.unit ?? ''}`));
      root.appendChild(bar);
      // 값 글자: 계열 하나면 막대가 넉넉할 때, 여럿이면 글자가 막대 폭에 들어갈 때만
      const v = fmtNum(p.y);
      if (values && (n === 1 ? bw >= 14 : v.length * 5.6 <= bw + 3)) {
        root.appendChild(text(bx + bw / 2, p.y >= 0 ? yt - 5 : yb + 12, v, { 'text-anchor': 'middle', fill: INK.label, 'font-weight': 600, 'font-size': n === 1 ? 10 : 9.5, class: 'dn-val' }));
      }
    }
  }
}

/** 단조 3차 곡선 (Fritsch–Carlson) — 점을 지나며 넘쳐 오르내리지 않는 부드러운 선. smooth가 아니면 꺾은 직선 */
function linePath(pts: readonly (readonly [number, number])[], smooth: boolean): string {
  if (!smooth || pts.length < 3) return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('');
  const n = pts.length, dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx.push(pts[i + 1]![0] - pts[i]![0]); m.push((pts[i + 1]![1] - pts[i]![1]) / (dx[i] || 1)); }
  const t = [m[0]!, ...m.slice(1).map((v, i) => (v * m[i]! <= 0 ? 0 : (2 * v * m[i]!) / (v + m[i]!))), m[n - 2]!];
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x1, y1] = pts[i]!, [x2, y2] = pts[i + 1]!, h = dx[i]! / 3;
    d += `C${x1 + h},${y1 + t[i]! * h} ${x2 - h},${y2 - t[i + 1]! * h} ${x2},${y2}`;
  }
  return d;
}

function drawLines(root: SVGSVGElement, c: ChartContent, series: Series, xs: string[], band: number, x0: number, y: (v: number) => number, floor: number | null): void {
  const defs = svg('defs', {});
  root.appendChild(defs);
  const smooth = on(c.style, 'smooth'), area = on(c.style, 'area');
  series.forEach((s, k) => {
    const si = c.series.indexOf(s), color = chartSeriesColor(c, si);
    const pts = s.points.map((p) => [x0 + band * (xs.indexOf(String(p.x)) + 0.5), y(p.y)] as const).sort((a, b) => a[0] - b[0]);
    const d = linePath(pts, smooth);
    // 첫 계열(또는 하나뿐일 때) 아래를 옅은 물결로 — 바닥(0)까지
    if (area && k === 0 && floor !== null && pts.length > 1) {
      const id = `dn-cg${++uid}`;
      const g = svg('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
      g.append(svg('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': series.length > 1 ? 0.14 : 0.22 }), svg('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }));
      defs.appendChild(g);
      root.appendChild(svg('path', { d: `${d}L${pts.at(-1)![0]},${floor}L${pts[0]![0]},${floor}Z`, fill: `url(#${id})`, stroke: 'none' }));
    }
    root.appendChild(svg('path', { d, fill: 'none', stroke: color, 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'dn-line', 'data-si': si }));
    const dots = pts.length <= 16;
    s.points.forEach((p) => {
      const cx = x0 + band * (xs.indexOf(String(p.x)) + 0.5), cy = y(p.y);
      const dot = svg('circle', { cx, cy, r: dots ? 3.2 : 6, fill: dots ? INK.card : 'transparent', stroke: dots ? color : 'none', 'stroke-width': 2, class: dots ? 'dn-dot' : '', 'data-si': si });
      dot.appendChild(svg('title', {}, `${s.name} · ${p.x}: ${fmtNum(p.y)}${c.unit ?? ''}`));
      root.appendChild(dot);
    });
    // 계열이 하나면 마지막 값을 끝에
    const last = pts.at(-1);
    if (series.length === 1 && last && on(c.style, 'values')) {
      const lp = s.points.find((p) => x0 + band * (xs.indexOf(String(p.x)) + 0.5) === last[0])!;
      root.appendChild(text(Math.min(last[0], W - 14), last[1] - 9, fmtNum(lp.y), { 'text-anchor': 'middle', fill: color, 'font-weight': 700, 'font-size': 10.5, class: 'dn-val-line' }));
    }
  });
}

/** 원: 왼쪽 고리(조각 사이 틈 · 가운데 합계, 구멍을 끄면 꽉 찬 원), 오른쪽 범례(이름 · 몫). 범례를 끄면 원이 가운데로 */
function drawDonut(root: SVGSVGElement, c: ChartContent, points: Series[number]['points']): void {
  const xs = chartCategories(c);
  const items = points.map((p) => ({ name: String(p.x), v: Math.max(0, p.y), color: chartItemColor(c, String(p.x), xs.indexOf(String(p.x))) }));
  const total = items.reduce((a, b) => a + b.v, 0);
  const showLegend = on(c.style, 'legend'), values = on(c.style, 'values'), hole = on(c.style, 'hole');
  const cx = showLegend ? 104 : W / 2, cy = H / 2, R = 86, r = hole ? 56 : 0;
  let a0 = -Math.PI / 2;
  const at = (rad: number, a: number) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
  const circle = (rad: number, sweep: number) => `M${cx - rad},${cy}a${rad},${rad} 0 1,${sweep} ${rad * 2},0a${rad},${rad} 0 1,${sweep} ${-rad * 2},0`;
  for (const it of items) {
    if (!total || !it.v) continue;
    const a1 = a0 + (it.v / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d = it.v >= total
      ? `${circle(R, 0)}${r ? circle(r, 1) : ''}Z`
      : r ? `M${at(R, a0)}A${R},${R} 0 ${large} 1 ${at(R, a1)}L${at(r, a1)}A${r},${r} 0 ${large} 0 ${at(r, a0)}Z`
        : `M${cx},${cy}L${at(R, a0)}A${R},${R} 0 ${large} 1 ${at(R, a1)}Z`;
    const path = svg('path', { d, fill: it.color, stroke: INK.card, 'stroke-width': 2, 'stroke-linejoin': 'round', 'fill-rule': 'evenodd', class: 'dn-slice', 'data-x': it.name });
    path.appendChild(svg('title', {}, `${it.name}: ${fmtNum(it.v)}${c.unit ?? ''} (${Math.round((it.v / total) * 100)}%)`));
    root.appendChild(path);
    a0 = a1;
  }
  if (hole && values) {
    root.appendChild(text(cx, cy + 1, fmtNum(total), { 'text-anchor': 'middle', fill: INK.label, 'font-weight': 700, 'font-size': 20, class: 'dn-center' }));
    root.appendChild(text(cx, cy + 18, c.unit ? `합계 (${c.unit})` : '합계', { 'text-anchor': 'middle', 'font-size': 10.5 }));
  }
  if (!showLegend) return;
  // 범례: 많으면 앞 여섯 + 나머지
  const pal = paletteOf(c);
  const shown: { name: string; v: number; color: string; key?: string }[] = items.length > 7
    ? [...items.slice(0, 6).map((it) => ({ ...it, key: it.name })), { name: `그 밖 ${items.length - 6}`, v: items.slice(6).reduce((a, b) => a + b.v, 0), color: pal[7 % pal.length]! }]
    : items.map((it) => ({ ...it, key: it.name }));
  const y0 = cy - (shown.length * 22) / 2 + 11;
  shown.forEach((it, i) => {
    const ly = y0 + i * 22;
    const name = it.name.length > 9 ? `${it.name.slice(0, 8)}…` : it.name;
    const key: Record<string, string> = it.key !== undefined ? { 'data-x': it.key } : {};
    root.appendChild(svg('circle', { cx: 216, cy: ly - 4, r: 4.5, fill: it.color, class: 'dn-legend-dot', ...key }));
    root.appendChild(text(228, ly, name, { fill: INK.label, 'font-size': 11.5, class: 'dn-legend-text', ...key }));
    if (values) root.appendChild(text(352, ly, `${total ? Math.round((it.v / total) * 100) : 0}%`, { 'text-anchor': 'end', fill: INK.label, 'font-weight': 600, 'font-size': 11.5, class: 'dn-legend-text' }));
  });
}
