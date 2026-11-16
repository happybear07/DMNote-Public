// 화살표 선 · 새 화살표 모양 아이콘 (20×20 선 그림). 기호 글자(〰 · ➰)는 기기에 따라 컬러 이모지로 그려져 쓰지 않는다.
// 물결 · 한 번 감김 · 용수철은 engine-dom arrow-draw와 같은 식을 작게 — 메뉴에서 본 모양이 캔버스에 그려지는 모양과 같다.
import type { ArrowLine, ArrowStyle } from '@dn/engine-core';
import type { ReactNode } from 'react';
import type { Choice } from './ToolChoice';

const Y = 10, X0 = 3, X1 = 15;
const HEAD = <path d="M13.5 6.8L17 10l-3.5 3.2" />;
/** 가로줄 (X0 → X1)을 따라 f(s) = [뒤로, 위로] 만큼 비튼 점열 → path d */
const bent = (f: (s: number, len: number) => [number, number]) => {
  const len = X1 - X0, pts: string[] = [];
  for (let s = 0; s <= len + 1e-6; s += 0.25) { const [back, up] = f(s, len); pts.push(`${(X0 + s + back).toFixed(2)} ${(Y - up).toFixed(2)}`); }
  return `M${pts.join('L')}`;
};
const ease = (s: number, len: number) => Math.min(1, s / 1.5, (len - s) / 1.5);
const WAVY = bent((s, len) => [0, 1.8 * ease(s, len) * Math.sin((2 * Math.PI * s) / 4)]);
const CURL = bent((s, len) => {
  const a = 2.6, m = len / 2;
  if (Math.abs(s - m) >= a) return [0, 0];
  const th = (Math.PI * (s - m + a)) / a;
  return [a * Math.sin(th), 1.1 * a * (1 - Math.cos(th))];
});
const SPRING = bent((s, len) => { const k = 2.1 * ease(s, len), th = (2 * Math.PI * s) / 3.2; return [-k * Math.sin(th), k - k * Math.cos(th)]; });

export const LINE_ICON: Record<ArrowLine, ReactNode> = {
  solid: <><path d={`M${X0} ${Y}H${X1 + 1}`} />{HEAD}</>,
  dashed: <><path d={`M${X0} ${Y}H${X1 + 1}`} strokeDasharray="2.6 1.8" />{HEAD}</>,
  dotted: <><path d={`M${X0} ${Y}H${X1 + 1}`} strokeDasharray="0.1 2.4" />{HEAD}</>,
  double: <><path d={`M${X0} ${Y - 1.6}H${X1}M${X0} ${Y + 1.6}H${X1}`} />{HEAD}</>,
  wavy: <><path d={WAVY} />{HEAD}</>,
  curl: <><path d={CURL} />{HEAD}</>,
  spring: <><path d={SPRING} />{HEAD}</>,
};

export type ArrowPreset = 'basic' | 'dashed' | 'dotted' | 'wavy' | 'curl' | 'spring' | 'curve' | 'orthogonal';
/** 도구 막대 화살표 단추를 두 번 누르면 고르는 새 화살표 모양 — style 없음 = 관계 기본 */
export const ARROW_PRESETS: readonly (Choice<ArrowPreset> & { readonly style?: ArrowStyle })[] = [
  { value: 'basic', label: '기본 화살표', hint: '관계에 맞는 기본 모양 (A)', icon: LINE_ICON.solid },
  { value: 'dashed', label: '파선 화살표', hint: '짧은 선이 이어진 화살표', icon: LINE_ICON.dashed, style: { line: 'dashed' } },
  { value: 'dotted', label: '점선 화살표', hint: '점이 이어진 화살표', icon: LINE_ICON.dotted, style: { line: 'dotted' } },
  { value: 'wavy', label: '물결 화살표', hint: '구불구불한 화살표', icon: LINE_ICON.wavy, style: { line: 'wavy' } },
  { value: 'curl', label: '한 번 감긴 화살표', hint: '가운데에서 한 바퀴 감김', icon: LINE_ICON.curl, style: { line: 'curl' } },
  { value: 'spring', label: '용수철 화살표', hint: '길게 그을수록 더 많이 감김', icon: LINE_ICON.spring, style: { line: 'spring' } },
  { value: 'curve', label: '곡선 화살표', hint: '둥글게 휘어 이어짐', icon: <><path d="M3 15C5 8 10 5.5 15.5 6.5" /><path d="M12.6 3.9l3.4 2.7-2.7 3.4" /></>, style: { route: 'curve' } },
  { value: 'orthogonal', label: '꺾은선 화살표', hint: '가로 · 세로로 꺾여 이어짐', icon: <><path d="M3 15h6V6h7" /><path d="M13 3l3 3-3 3" /></>, style: { route: 'orthogonal' } },
];
