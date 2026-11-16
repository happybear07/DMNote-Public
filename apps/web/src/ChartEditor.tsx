// 그래프 고치기 (FR-018): 데이터 탭 — 종류(막대 · 꺾은선 · 원) · 제목 · 단위 · 항목(x) × 계열 값 표, 모양 탭 — 색 묶음 · 계열(항목) 색 · 보기.
// 미리보기는 캔버스와 같은 렌더러 — 막대 · 조각 · 선 · 범례를 누르면 그 색을 고른다(값 표 머리의 견본도).
// 스프레드시트에서 복사한 칸(탭 · 줄바꿈)을 붙여넣으면 그 칸부터 채운다. 저장은 실행 취소 한 번.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chartCategories, isChartContent, newId, type ChartContent, type ChartKind, type ChartPalette, type ChartStyle } from '@dn/engine-core';
import { CHART_PALETTES, chartColorsByItem, chartItemColor, chartSeriesColor, renderChart } from '@dn/engine-dom';
import { ChartColorPop } from './ChartColorPop';
import { ChartStyleTab, type LookState } from './ChartStyleTab';
import type { Workspace } from './workspace';
import { Icon } from './Icon';

const KINDS: { kind: ChartKind; label: string }[] = [{ kind: 'bar', label: '막대' }, { kind: 'line', label: '꺾은선' }, { kind: 'pie', label: '원' }];

/** 칸 글자 → 수 ("1,234" · " 5 " · "−3.2" 허용). 비었으면 null, 숫자가 아니면 NaN */
function parseCell(s: string): number | null {
  const t = s.replace(/[,\s]/g, '').replace(/[−–]/g, '-');
  if (!t) return null;
  return /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(t) ? Number(t) : Number.NaN;
}

/** 값 표 — 계열 색(colors)은 열마다, 항목 색(xcolors)은 행마다 따라다닌다(이름을 바꿔도 색은 그 행에) */
interface Grid { xs: string[]; names: string[]; ids: (string | null)[]; values: string[][]; colors: (string | undefined)[]; xcolors: (string | undefined)[] }

function toGrid(c: ChartContent): Grid {
  const xs = chartCategories(c);
  return {
    xs, names: c.series.map((s) => s.name), ids: c.series.map((s) => s.id),
    values: xs.map((x) => c.series.map((s) => { const p = s.points.find((q) => String(q.x) === x); return p ? String(p.y) : ''; })),
    colors: c.series.map((s) => s.color), xcolors: xs.map((x) => c.style?.itemColors?.[x]),
  };
}

/** 기본값과 같은 모양은 적지 않는다 — 아무것도 안 바꾼 그래프는 옛 데이터 그대로 */
const DEFAULT_LOOK: Required<LookState> = { palette: 'basic', vary: false, values: true, legend: true, grid: true, smooth: true, area: true, hole: true };
function leanStyle(look: LookState, itemColors: Record<string, string>): ChartStyle | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(look)) if (v !== undefined && DEFAULT_LOOK[k as keyof LookState] !== v) out[k] = v;
  if (Object.keys(itemColors).length) out.itemColors = itemColors;
  return Object.keys(out).length ? (out as ChartStyle) : undefined;
}

type Pop = { target: 'series' | 'item'; i: number; at: { x: number; y: number } };

export function ChartEditor({ ws, blockId, contentId, tab: firstTab }: { ws: Workspace; blockId: string; contentId: string; tab?: 'style' }) {
  const engine = ws.view?.engine;
  const c0 = engine?.getContent(contentId);
  const start = isChartContent(c0) ? c0 : null;
  const [tab, setTab] = useState<'data' | 'style'>(firstTab === 'style' ? 'style' : 'data');
  const [kind, setKind] = useState<ChartKind>(start?.kind ?? 'bar');
  const [title, setTitle] = useState(start?.title ?? '');
  const [unit, setUnit] = useState(start?.unit ?? '');
  const [g, setG] = useState<Grid>(() => (start ? toGrid(start) : { xs: [], names: [], ids: [], values: [], colors: [], xcolors: [] }));
  const [look, setLook] = useState<LookState>(() => { const { itemColors: _i, ...rest } = start?.style ?? {}; return rest; });
  const [pop, setPop] = useState<Pop | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // 열리면 창으로 포커스 (캔버스 두 번 누르기 · 넣기 메뉴에서 열려도 Esc · Tab이 창에서 동작하게)
  useEffect(() => { box.current?.focus({ preventScroll: true }); }, []);
  const close = () => { ws.closeDialog(); ws.view?.root.focus({ preventScroll: true }); };
  const closePop = useCallback(() => { setPop(null); box.current?.focus({ preventScroll: true }); }, []);

  const bad = useMemo(() => g.values.flatMap((row, r) => row.map((v, s) => (Number.isNaN(parseCell(v)) ? `${r}:${s}` : ''))).filter(Boolean), [g]);
  // 항목 이름은 점을 잇는 열쇠라 겹치면 안 된다 (빈 이름은 "항목 n"으로 채운 뒤 비교)
  const labels = useMemo(() => g.xs.map((x, r) => x.trim() || `항목 ${r + 1}`), [g]);
  const dup = useMemo(() => labels.map((l, r) => labels.indexOf(l) !== r || labels.lastIndexOf(l) !== r), [labels]);
  const data = useMemo(() => {
    const style = leanStyle(look, Object.fromEntries(labels.flatMap((x, r) => (g.xcolors[r] ? [[x, g.xcolors[r]!]] : []))));
    return {
      kind, title: title.trim() || undefined, unit: unit.trim() || undefined, style,
      categories: labels,
      series: g.names.map((name, s) => ({
        id: g.ids[s] ?? newId(), name: name.trim() || `계열 ${s + 1}`,
        points: labels.map((x, r) => ({ x, y: parseCell(g.values[r]?.[s] ?? '') })).filter((p): p is { x: string; y: number } => p.y !== null && !Number.isNaN(p.y)),
        ...(g.colors[s] ? { color: g.colors[s] } : {}),
      })),
    };
  }, [kind, title, unit, g, labels, look]);
  const shown: ChartContent | null = useMemo(() => (start ? { ...start, ...data } : null), [start, data]);
  // 지금 노트에서 이 그래프가 사라지면(실행 취소 · 다른 탭에서 지움) 창을 닫는다
  useEffect(() => { if (!engine || !start) ws.closeDialog(); }, [engine, start, ws]);

  useEffect(() => { if (preview.current && shown) renderChart(shown, preview.current); }, [shown]);

  if (!engine || !start || !shown) return null;
  const itemMode = chartColorsByItem(shown);
  const seriesName = (s: number) => g.names[s]?.trim() || `계열 ${s + 1}`;

  const setCell = (r: number, s: number, v: string) => setG((x) => ({ ...x, values: x.values.map((row, i) => (i === r ? row.map((c, j) => (j === s ? v : c)) : row)) }));
  const setX = (r: number, v: string) => setG((x) => ({ ...x, xs: x.xs.map((c, i) => (i === r ? v : c)) }));
  const setName = (s: number, v: string) => setG((x) => ({ ...x, names: x.names.map((c, i) => (i === s ? v : c)) }));
  const addRow = () => setG((x) => {
    let n = x.xs.length + 1;
    while (x.xs.includes(`항목 ${n}`)) n++;
    return { ...x, xs: [...x.xs, `항목 ${n}`], values: [...x.values, x.names.map(() => '')], xcolors: [...x.xcolors, undefined] };
  });
  const addSeries = () => setG((x) => ({ ...x, names: [...x.names, `계열 ${x.names.length + 1}`], ids: [...x.ids, null], values: x.values.map((row) => [...row, '']), colors: [...x.colors, undefined] }));
  const delRow = (r: number) => setG((x) => ({ ...x, xs: x.xs.filter((_, i) => i !== r), values: x.values.filter((_, i) => i !== r), xcolors: x.xcolors.filter((_, i) => i !== r) }));
  const delSeries = (s: number) => setG((x) => ({ ...x, names: x.names.filter((_, i) => i !== s), ids: x.ids.filter((_, i) => i !== s), values: x.values.map((row) => row.filter((_, j) => j !== s)), colors: x.colors.filter((_, i) => i !== s) }));
  const setColor = (t: Pop['target'], i: number, c: string | null) => setG((x) => (t === 'series'
    ? { ...x, colors: x.colors.map((v, j) => (j === i ? c ?? undefined : v)) }
    : { ...x, xcolors: x.xcolors.map((v, j) => (j === i ? c ?? undefined : v)) }));
  /** 색 묶음을 고르면 하나씩 고른 색은 지운다 — 묶음이 그래프 전체에 바로 보이게 */
  const pickPalette = (p: ChartPalette) => {
    setLook({ ...look, palette: p });
    setG((x) => ({ ...x, colors: x.colors.map(() => undefined), xcolors: x.xcolors.map(() => undefined) }));
  };
  const openFrom = (el: HTMLElement, target: Pop['target'], i: number) => { const r = el.getBoundingClientRect(); setPop({ target, i, at: { x: r.left, y: r.bottom + 6 } }); };
  /** 미리보기에서 막대 · 조각 · 선 · 범례를 누르면 그 색 */
  const pickFromPreview = (e: React.MouseEvent) => {
    const el = (e.target as Element).closest('[data-si], [data-x]');
    if (!el) return;
    const at = { x: e.clientX + 6, y: e.clientY + 6 };
    if (itemMode) { const r = labels.indexOf(el.getAttribute('data-x') ?? ''); if (r >= 0) setPop({ target: 'item', i: r, at }); }
    else if (el.hasAttribute('data-si')) setPop({ target: 'series', i: Number(el.getAttribute('data-si')), at });
  };
  const swatch = (target: Pop['target'], i: number, name: string) => {
    const color = target === 'item' ? chartItemColor(shown, labels[i]!, i) : chartSeriesColor(shown, i);
    return <button type="button" className={`cg-sw${(target === 'item' ? g.xcolors[i] : g.colors[i]) ? ' custom' : ''}`} style={{ background: color }} title="색 바꾸기" aria-label={`${name} 색 바꾸기`} onClick={(e) => openFrom(e.currentTarget, target, i)} />;
  };

  /** 스프레드시트 붙여넣기: (r, col)부터 채운다. col -1 = 항목 이름 열. 모자란 행 · 계열은 늘린다 */
  const pasteGrid = (r0: number, c0: number, text: string): boolean => {
    if (!/[\t\n]/.test(text.trim())) return false;
    const rows = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((l) => l.split('\t'));
    setG((x) => {
      const next: Grid = { xs: [...x.xs], names: [...x.names], ids: [...x.ids], values: x.values.map((row) => [...row]), colors: [...x.colors], xcolors: [...x.xcolors] };
      rows.forEach((cells, i) => {
        const r = r0 + i;
        while (next.xs.length <= r) { next.xs.push(`항목 ${next.xs.length + 1}`); next.values.push(next.names.map(() => '')); next.xcolors.push(undefined); }
        cells.forEach((v, j) => {
          const col = c0 + j;
          if (col < 0) { next.xs[r] = v.trim(); return; }
          while (next.names.length <= col) { next.names.push(`계열 ${next.names.length + 1}`); next.ids.push(null); next.colors.push(undefined); next.values.forEach((row) => row.push('')); }
          next.values[r]![col] = v.trim();
        });
      });
      return next;
    });
    return true;
  };
  const onPaste = (r: number, col: number) => (e: React.ClipboardEvent) => { if (pasteGrid(r, col, e.clipboardData.getData('text/plain'))) e.preventDefault(); };

  const save = () => {
    if (bad.length || dup.some(Boolean)) return;
    const r = engine.transact((tx) => tx.set('content', contentId, { kind: data.kind, title: data.title, unit: data.unit, series: data.series, categories: data.categories, style: data.style }), { origin: 'user', label: '그래프 고치기' });
    if (r.ok) { ws.view?.select([blockId]); close(); }
  };

  const popName = pop ? (pop.target === 'item' ? labels[pop.i] : g.names[pop.i] !== undefined ? seriesName(pop.i) : undefined) : undefined;
  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <div ref={box} tabIndex={-1} className="dialog chart-editor" role="dialog" aria-modal="true" aria-label="그래프 고치기" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }}>
        <div className="tpl-head">
          <h2>그래프 고치기</h2>
          <button className="icon-btn" aria-label="닫기" onClick={close}><Icon name="close" size={14} /></button>
        </div>
        <div className="chart-ed-top">
          <div className="seg" role="radiogroup" aria-label="그래프 종류">
            {KINDS.map((k) => (
              <button key={k.kind} role="radio" aria-checked={kind === k.kind} className={kind === k.kind ? 'on' : ''} onClick={() => setKind(k.kind)}>{k.label}</button>
            ))}
          </div>
          <div className="chart-tabs" role="tablist" aria-label="고칠 것">
            <button role="tab" aria-selected={tab === 'data'} className={tab === 'data' ? 'on' : ''} onClick={() => setTab('data')}>데이터</button>
            <button role="tab" aria-selected={tab === 'style'} className={tab === 'style' ? 'on' : ''} onClick={() => setTab('style')}>모양</button>
          </div>
        </div>
        <div className="chart-ed-body">
          {tab === 'data' ? (
            <div className="chart-ed-form">
              <div className="chart-ed-meta">
                <label>제목<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="그래프 제목" /></label>
                <label>단위<input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="예: 억 원 · %" /></label>
              </div>
              <div className="chart-grid-wrap">
                <table className="chart-grid">
                  <thead>
                    <tr>
                      <th>항목</th>
                      {g.names.map((n, s) => (
                        <th key={s}>
                          <span className="cg-head">
                            {!itemMode && swatch('series', s, seriesName(s))}
                            <input value={n} aria-label={`계열 ${s + 1} 이름`} onChange={(e) => setName(s, e.target.value)} />
                            {g.names.length > 1 && <button className="cg-del" aria-label={`${n} 계열 지우기`} title="계열 지우기" onClick={() => delSeries(s)}><Icon name="close" size={14} /></button>}
                          </span>
                        </th>
                      ))}
                      <th className="cg-add"><button className="btn sm" onClick={addSeries}>＋ 계열</button></th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.xs.map((x, r) => (
                      <tr key={r}>
                        <td>
                          <span className="cg-head">
                            {itemMode && swatch('item', r, labels[r]!)}
                            <input className={dup[r] ? 'bad' : ''} value={x} aria-label={`항목 ${r + 1} 이름`} onChange={(e) => setX(r, e.target.value)} onPaste={onPaste(r, -1)} />
                          </span>
                        </td>
                        {g.names.map((n, s) => (
                          <td key={s}>
                            <input className={Number.isNaN(parseCell(g.values[r]?.[s] ?? '')) ? 'bad' : ''} inputMode="decimal" value={g.values[r]?.[s] ?? ''}
                              aria-label={`${x} · ${n} 값`} onChange={(e) => setCell(r, s, e.target.value)} onPaste={onPaste(r, s)} />
                          </td>
                        ))}
                        <td className="cg-add">{g.xs.length > 1 && <button className="cg-del" aria-label={`${x} 항목 지우기`} title="항목 지우기" onClick={() => delRow(r)}><Icon name="close" size={14} /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn sm" onClick={addRow}>＋ 항목</button>
              <p className="chart-ed-hint">
                {bad.length ? '숫자가 아닌 칸이 있어요 — 빨간 칸을 고쳐 주세요.'
                  : dup.some(Boolean) ? '항목 이름이 겹쳐요 — 빨간 칸을 다른 이름으로 고쳐 주세요.'
                  : kind === 'pie' && g.names.length > 1 ? '원 그래프는 첫 계열만 그려요.'
                    : '빈 칸은 점을 그리지 않아요. 스프레드시트에서 복사한 칸을 붙여넣을 수도 있어요.'}
              </p>
            </div>
          ) : (
            <ChartStyleTab kind={kind} look={look} setLook={setLook} seriesCount={g.names.length} itemMode={itemMode}
              swatches={itemMode
                ? labels.map((x, r) => ({ name: x, color: chartItemColor(shown, x, r), custom: !!g.xcolors[r] }))
                : g.names.map((_, s) => ({ name: seriesName(s), color: chartSeriesColor(shown, s), custom: !!g.colors[s] }))}
              anyCustom={g.colors.some(Boolean) || g.xcolors.some(Boolean)}
              onSwatch={(i, el) => openFrom(el, itemMode ? 'item' : 'series', i)} onPalette={pickPalette} />
          )}
          <div className="chart-ed-preview" aria-label="미리보기 — 눌러서 색 바꾸기" title="막대 · 조각 · 선을 눌러 색 바꾸기"><div ref={preview} onClick={pickFromPreview} /></div>
        </div>
        <div className="dialog-actions">
          <button className="btn" onClick={close}>취소</button>
          <button className="btn primary" disabled={!!bad.length || dup.some(Boolean)} onClick={save}>저장</button>
        </div>
        {pop && popName !== undefined && (
          <ChartColorPop at={pop.at} title={`${pop.target === 'item' ? (kind === 'pie' ? '조각' : '막대') : '계열'} 색 · ${popName}`}
            value={pop.target === 'item' ? g.xcolors[pop.i] : g.colors[pop.i]}
            current={pop.target === 'item' ? chartItemColor(shown, labels[pop.i]!, pop.i) : chartSeriesColor(shown, pop.i)}
            palette={CHART_PALETTES[look.palette ?? 'basic'].colors} onPick={(c) => setColor(pop.target, pop.i, c)} onClose={closePop} />
        )}
      </div>
    </div>
  );
}
