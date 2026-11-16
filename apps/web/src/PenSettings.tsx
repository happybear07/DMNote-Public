// 펜 · 형광펜 설정 창 (필기 막대의 굵기 단추 · 도구 막대 펜/형광펜 두 번 누르기): 굿노트처럼 위에 미리보기 곡선, 아래 종류 · 굵기(밀대 + 숫자).
// 펜 종류 9개(볼펜 · 만년필 · 붓펜 · 연필 · 색연필 · 마커 · 캘리그래피 · 크레용 · 수채) · 형광펜 종류 3개(납작 촉 · 둥근 촉 · 직선).
// 고른 종류는 획에 저장한다 — 연필 · 크레용 같은 질감은 나중에(그때까지 비슷한 선, 이미 그린 획에도 나중 질감이 붙는다).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HL_KINDS, PEN_KINDS, type HlKind, type PenKind } from '@dn/engine-core';
import { HL_ALPHA, HL_WIDTH, outlinePath, paintPath, PEN_WIDTH, readTheme, setInkStyle, shownInk, type CanvasUiState, type CanvasView } from '@dn/engine-dom';
import { svg } from './ToolChoice';

export const PEN_LABEL: Record<PenKind, string> = {
  ball: '볼펜', fountain: '만년필', brush: '붓펜', pencil: '연필', 'colored-pencil': '색연필', marker: '마커', calligraphy: '캘리그래피', crayon: '크레용', watercolor: '수채',
};
export const HL_LABEL: Record<HlKind, string> = { chisel: '납작 촉', round: '둥근 촉', straight: '직선' };
/** 질감 · 동작이 아직 없는 종류 — 창에 '준비 중'을 알린다 */
const LATER: ReadonlySet<string> = new Set(['pencil', 'colored-pencil', 'calligraphy', 'crayon', 'watercolor', 'straight']);

const PEN_ICON: Record<PenKind, ReactNode> = {
  ball: <><path d="M4.5 15.5l1-3.5 7.5-7.5 2.5 2.5L8 14.5z" /><path d="M11.5 6l2.5 2.5" /></>,
  fountain: <><path d="M10 2.5l4.5 6.5L10 17.5 5.5 9z" /><path d="M10 9v4" /></>,
  brush: <><path d="M12.5 3l4.5 4.5-5.5 5.5-4.5-4.5z" /><path d="M7 8.5c-2.2.2-3.5 2.4-3.5 4.6 0 1.6-.6 2.6-1 3.4 3.4 0 6.2-1.4 6.6-4.6" /></>,
  pencil: <><path d="M4.5 15.5l1.5-4.5 7.5-7.5 3 3L9 14z" /><path d="M6 11l3 3M4.5 15.5l1.5-1.5" /></>,
  'colored-pencil': <><path d="M4.5 15.5l1.5-4.5 7.5-7.5 3 3L9 14z" /><path d="M6 11l3 3M11.5 5.5l3 3" /></>,
  marker: <><path d="M6 12.5l6.5-9 4 3-6.5 9z" /><path d="M6 12.5L4 16.5l4-1" /></>,
  calligraphy: <><path d="M5 15.5l7.5-12 3.5 2.5-7.5 12z" /><path d="M5 15.5l3.5 2" /></>,
  crayon: <><path d="M5 15l7-8.5 3 3-8.5 7z" /><path d="M12 6.5l1.5-2.5 2.5 2.5-2.5 1.5M7.5 12l1.5 1.5" /></>,
  watercolor: <path d="M10 3c3.2 4.2 5 6.6 5 9.2a5 5 0 01-10 0c0-2.6 1.8-5 5-9.2z" />,
};
const HL_ICON: Record<HlKind, ReactNode> = {
  chisel: <rect x="3" y="7.5" width="14" height="5" />,
  round: <rect x="3" y="7.5" width="14" height="5" rx="2.5" />,
  straight: <path d="M3 10h14M3 6.5v7M17 6.5v7" />,
};

/** 미리보기: 물결 곡선 하나 — 펜은 외곽선(필압이 가운데서 세지게), 형광펜은 같은 굵기 · 반투명 */
function drawPreview(c: HTMLCanvasElement, hl: boolean, kind: PenKind | HlKind, width: number, color: string): void {
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const pad = Math.max(16, width), n = 48, pts: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = pad + t * (w - pad * 2), y = h / 2 - Math.sin(t * Math.PI * 2) * (h / 2 - pad) * 0.7;
    pts.push(x, y, 0.3 + 0.5 * Math.sin(t * Math.PI), t * 400);
  }
  if (hl) {
    ctx.globalAlpha = HL_ALPHA;
    const p3: number[] = [];
    for (let i = 0; i < pts.length; i += 4) p3.push(pts[i]!, pts[i + 1]!, pts[i + 2]!);
    paintPath(ctx, { x: 0, y: 0, zoom: 1 }, p3, color, width, kind === 'round' ? 'round' : 'butt');
    ctx.globalAlpha = 1;
    return;
  }
  ctx.fillStyle = shownInk(readTheme(c), color); // 어두운 창에서 검정 펜은 밝게 — 캔버스와 같은 규칙 (AT-021)
  ctx.fill(outlinePath(pts, width, kind as PenKind, true));
}

export function PenSettings({ view, ui, onClose }: { view: CanvasView; ui: CanvasUiState; onClose: () => void }) {
  const hl = ui.tool === 'highlighter';
  const ink = ui.ink;
  const kind: PenKind | HlKind = hl ? ink.hl : ink.pen;
  const width = hl ? ink.hlWidth : ink.width;
  const range = hl ? HL_WIDTH : PEN_WIDTH;
  const color = hl ? ink.hlColor : ink.color;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [typed, setTyped] = useState(String(width));
  const [pos, setPos] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null);
  useEffect(() => setTyped(String(width)), [width]);
  useEffect(() => { if (canvas.current) drawPreview(canvas.current, hl, kind, width, color); }, [hl, kind, width, color]);
  // 필기 막대 바로 위에 — 아래 끝을 막대에 붙여 두어 안내 문구가 생겨 길어져도 위로 자란다(막대를 덮지 않게)
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect(), bar = document.querySelector('.ink-bar')?.getBoundingClientRect();
    if (!r) return;
    const left = bar ? bar.left + bar.width / 2 - r.width / 2 : (innerWidth - r.width) / 2;
    const bottom = innerHeight - (bar ? bar.top : innerHeight - 80) + 8;
    setPos({ left: Math.max(8, Math.min(left, innerWidth - r.width - 8)), bottom, maxHeight: innerHeight - bottom - 8 });
  }, [hl]);
  useEffect(() => {
    // 창 밖을 누르면 닫는다 — 굵기 단추 · 도구 막대(펜을 다시 두 번 누르기)는 그쪽이 연다/닫는다
    const down = (e: PointerEvent) => { const t = e.target as Element; if (!box.current?.contains(t) && !t.closest?.('.ink-pen-btn, .toolbar')) onClose(); };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [onClose]);
  const setWidth = (v: number) => { if (Number.isFinite(v)) setInkStyle(view, hl ? { hlWidth: v } : { width: v }); };
  const kinds = (hl ? HL_KINDS : PEN_KINDS) as readonly (PenKind | HlKind)[];
  return createPortal(
    <div ref={box} className="pen-settings" role="dialog" aria-label={hl ? '형광펜 설정' : '펜 설정'} style={pos ?? { visibility: 'hidden' }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); view.root.focus(); } }}>
      <div className="ps-head">{hl ? HL_LABEL[kind as HlKind] : PEN_LABEL[kind as PenKind]}</div>
      <canvas ref={canvas} className="ps-preview" aria-label="미리보기" />
      {LATER.has(kind) && <p className="ps-later">{kind === 'straight' ? '그으면 곧게 펴는 동작은 준비 중이에요 — 지금은 납작 촉처럼 그려요.' : '이 펜의 질감은 준비 중이에요 — 지금은 비슷한 선으로 그리고, 질감이 생기면 이미 쓴 글씨에도 붙어요.'}</p>}
      <div className="ps-title">{hl ? '형광펜 종류' : '펜 종류'}</div>
      <div className={`ps-kinds${hl ? ' hl' : ''}`} role="radiogroup" aria-label={hl ? '형광펜 종류' : '펜 종류'}>
        {kinds.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={k === kind} className={k === kind ? 'on' : ''}
            onClick={() => setInkStyle(view, hl ? { hl: k as HlKind } : { pen: k as PenKind })}>
            {svg(hl ? HL_ICON[k as HlKind] : PEN_ICON[k as PenKind])}<span>{hl ? HL_LABEL[k as HlKind] : PEN_LABEL[k as PenKind]}</span>
          </button>
        ))}
      </div>
      <div className="ps-title">굵기</div>
      <div className="ps-width">
        <input type="range" min={range.min} max={range.max} step={hl ? 1 : 0.5} value={width} aria-label="굵기 밀대" onChange={(e) => setWidth(Number(e.target.value))} />
        <input type="number" className="ps-num" min={range.min} max={range.max} step={hl ? 1 : 0.5} value={typed} aria-label="굵기 (px)"
          onChange={(e) => { setTyped(e.target.value); const v = Number(e.target.value); if (e.target.value !== '' && v >= range.min && v <= range.max) setWidth(v); }}
          onBlur={() => setTyped(String(width))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setWidth(Number(typed)); } }} />
        <span className="ps-unit">px</span>
      </div>
    </div>,
    document.body,
  );
}
