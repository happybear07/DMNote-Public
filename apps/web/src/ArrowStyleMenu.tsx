// 화살표 메뉴 › 모양 (노트 v6 2단계): 선 · 끝 모양(도착 · 출발) · 굵기 · 경로 · 색. 바꾼 것만 저장하고, "관계 기본 모양으로"는 모양을 비운다.
// 모양은 의미(관계 종류)와 따로 — 관계를 바꿔도 사용자가 고른 모양은 그대로, 학습 라벨에도 섞이지 않는다.
import { useState } from 'react';
import { effectiveStyle, setArrowStyle, type ArrowHead, type ArrowLine, type ArrowRoute, type ArrowStyle } from '@dn/engine-core';
import { TONE_COLORS, type CanvasView } from '@dn/engine-dom';
import type { ReactNode } from 'react';
import { LINE_ICON } from './arrow-icons';
import { svg } from './ToolChoice';

const LINES: [ArrowLine, string, ReactNode][] = (
  [['solid', '실선'], ['dashed', '파선'], ['dotted', '점선'], ['double', '이중선'], ['wavy', '물결'], ['curl', '한 번 감김'], ['spring', '용수철']] as [ArrowLine, string][]
).map(([v, name]) => [v, name, svg(LINE_ICON[v])]);
const HEADS: [ArrowHead, string, string][] = [['triangle', '삼각', '▶'], ['chevron', '꺾쇠', '›'], ['open-triangle', '빈 삼각', '▷'], ['diamond', '마름모', '◆'], ['open-diamond', '빈 마름모', '◇'], ['bar', '막대', '⊣'], ['dot', '점', '●'], ['none', '없음', '—']];
const WIDTHS: [1 | 1.5 | 2, string][] = [[1, '가늘게'], [1.5, '보통'], [2, '굵게']];
const ROUTES: [ArrowRoute, string, string][] = [['straight', '직선', '╱'], ['orthogonal', '꺾은선', '┐'], ['curve', '곡선', '◠'], ['loop', '되돌림', '↺']];
const COLORS: [string, string][] = [['purple', '보라'], ['orange', '주황'], ['green', '초록'], ['blue', '파랑'], ['red', '빨강'], ['brown', '갈색']];

/** inline: 하위 메뉴 판 안에 바로 펼친다(화살표 메뉴 '모양 ▸', DS-016) — 아니면 '모양 ▸' 줄을 눌러 펼치기 */
export function ArrowStyleRows({ view, ids, inline }: { view: CanvasView; ids: string[]; inline?: boolean }) {
  const [toggled, setOpen] = useState(false);
  const open = inline || toggled;
  const [, bump] = useState(0);
  const a = view.engine.getArrow(ids[0]!);
  if (!a) return null;
  const now = effectiveStyle(a);
  const set = (p: Partial<ArrowStyle> | null) => { setArrowStyle(view.engine, ids, p); bump((n) => n + 1); };
  const row = <T,>(label: string, items: [T, string, ReactNode?][], cur: T, key: keyof ArrowStyle) => (
    <div className="align-row arrow-style-row" role="group" aria-label={label}>
      {items.map(([v, name, icon]) => (
        <button key={String(v)} role="menuitemradio" aria-checked={cur === v} className={cur === v ? 'on' : ''} title={`${label} · ${name}`} aria-label={`${label} ${name}`}
          onClick={() => set({ [key]: v } as Partial<ArrowStyle>)}>{icon ?? name}</button>
      ))}
    </div>
  );
  return (
    <>
      {!inline && <button role="menuitem" aria-expanded={open} onClick={() => setOpen((o) => !o)}><span>모양 {open ? '▾' : '▸'}</span><span className="kbd-like">{LINES.find((l) => l[0] === now.line)?.[1]}</span></button>}
      {open && <div className="arrow-style">
        <div className="menu-head">선</div>
        {row('선', LINES, now.line, 'line')}
        <div className="menu-head">끝 모양 (도착)</div>
        {row('도착 끝', HEADS, now.head, 'head')}
        <div className="menu-head">끝 모양 (출발)</div>
        {row('출발 끝', HEADS, now.tail, 'tail')}
        <div className="menu-head">굵기 · 경로</div>
        {row('굵기', WIDTHS, now.width, 'width')}
        {row('경로', ROUTES, now.route, 'route')}
        <div className="menu-head">색</div>
        <div className="swatches" role="group" aria-label="화살표 색">
          <button role="menuitemradio" aria-checked={!a.style?.color} className={`sw none${!a.style?.color ? ' on' : ''}`} title="관계 색" aria-label="관계 색" onClick={() => set({ color: undefined })} />
          {COLORS.map(([k, name]) => (
            <button key={k} role="menuitemradio" aria-checked={a.style?.color === k} className={`sw${a.style?.color === k ? ' on' : ''}`} title={name} aria-label={`${name} 화살표`}
              style={{ background: `var(--dn-rel-${k}, ${TONE_COLORS[k as keyof typeof TONE_COLORS]})` }} onClick={() => set({ color: k })} />
          ))}
        </div>
        <button role="menuitem" disabled={!a.style} onClick={() => set(null)}><span>관계 기본 모양으로</span></button>
      </div>}
    </>
  );
}
