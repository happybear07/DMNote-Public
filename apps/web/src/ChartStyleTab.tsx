// 그래프 창 › 모양 탭: 색 묶음 여섯 가지, 계열(원 · 막대마다 다른 색이면 항목) 색 견본, 보기 켜고 끄기.
// 견본을 누르면 ChartColorPop — 그래프 창(ChartEditor)이 띄운다. 고른 모양은 저장할 때 한 번에(실행 취소 한 번).
import type { ChartKind, ChartPalette, ChartStyle } from '@dn/engine-core';
import { CHART_PALETTES } from '@dn/engine-dom';

export type LookState = Omit<ChartStyle, 'itemColors'>;
type Toggle = 'values' | 'legend' | 'grid' | 'vary' | 'smooth' | 'area' | 'hole';

export function ChartStyleTab({ kind, look, setLook, seriesCount, itemMode, swatches, anyCustom, onSwatch, onPalette }: {
  kind: ChartKind; look: LookState; setLook: (l: LookState) => void;
  seriesCount: number;
  /** 색을 항목마다 고르는 중 (원 · 막대마다 다른 색) — 아니면 계열마다 */
  itemMode: boolean;
  swatches: readonly { name: string; color: string; custom: boolean }[];
  anyCustom: boolean;
  onSwatch: (i: number, el: HTMLElement) => void;
  onPalette: (p: ChartPalette) => void;
}) {
  const toggles: { k: Toggle; label: string; def: boolean; when: boolean }[] = [
    { k: 'values', label: kind === 'pie' ? '값 · 몫 글자' : '값 글자', def: true, when: true },
    { k: 'legend', label: '범례', def: true, when: kind === 'pie' || seriesCount > 1 },
    { k: 'grid', label: '눈금선', def: true, when: kind !== 'pie' },
    { k: 'vary', label: '막대마다 다른 색', def: false, when: kind === 'bar' && seriesCount === 1 },
    { k: 'smooth', label: '매끈한 곡선', def: true, when: kind === 'line' },
    { k: 'area', label: '선 아래 채우기', def: true, when: kind === 'line' },
    { k: 'hole', label: '가운데 구멍 (도넛)', def: true, when: kind === 'pie' },
  ];
  const palette = look.palette ?? 'basic';
  return (
    <div className="chart-style">
      <section aria-label="색 묶음">
        <h3>색 묶음</h3>
        <div className="cs-palettes" role="radiogroup" aria-label="색 묶음">
          {(Object.keys(CHART_PALETTES) as ChartPalette[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={palette === k} className={palette === k ? 'on' : ''} onClick={() => onPalette(k)}>
              <span className="cs-pal" aria-hidden="true">{CHART_PALETTES[k].colors.slice(0, 5).map((c) => <i key={c} style={{ background: c }} />)}</span>
              <small>{CHART_PALETTES[k].label}</small>
            </button>
          ))}
        </div>
        {anyCustom && <p className="chart-ed-hint">색 묶음을 고르면 하나씩 바꾼 색은 묶음 색으로 돌아가요.</p>}
      </section>
      <section aria-label="색">
        <h3>{itemMode ? (kind === 'pie' ? '조각 색' : '막대 색') : '계열 색'}</h3>
        <div className="cs-swatches">
          {swatches.map((s, i) => (
            <button key={i} type="button" className="cs-sw" aria-label={`${s.name} 색 바꾸기`} onClick={(e) => onSwatch(i, e.currentTarget)}>
              <i className={s.custom ? 'custom' : ''} style={{ background: s.color }} /><span>{s.name}</span>
            </button>
          ))}
        </div>
        <p className="chart-ed-hint">미리보기에서 {kind === 'pie' ? '조각이나' : kind === 'line' ? '선 · 점이나' : '막대나'} 범례를 눌러도 색을 바꿀 수 있어요.</p>
      </section>
      <section aria-label="보기">
        <h3>보기</h3>
        <div className="cs-toggles">
          {toggles.filter((t) => t.when).map((t) => (
            <label key={t.k}>
              <input type="checkbox" checked={look[t.k] ?? t.def} onChange={(e) => setLook({ ...look, [t.k]: e.target.checked })} />
              <span>{t.label}</span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
