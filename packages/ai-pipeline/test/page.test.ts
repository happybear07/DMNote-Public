// A4 용지 노트의 도식형 결과 (FR-109 마지막 기준, page.ts): 용지 안쪽 폭 안 · 가운데 · 쪽 사이 틈에 걸치지 않음 · 원문 아래가 막혔으면 내용 맨 아래.
import { beforeAll, describe, expect, it } from 'vitest';
import { Engine, pageY, setDefaultTextCodec, SHEET_PAD, sheetGeom, type Rect } from '@dn/engine-core';
import { pmCodec } from '@dn/text-pm/headless';
import { planApply, structureText, type PagePlacement } from '../src';
import { paginate } from '../src/page';
import { fakeTransport } from './fixtures';

beforeAll(() => setDefaultTextCodec(pmCodec));

const g = sheetGeom({ sheet: { size: 'a4' } } as never)!;
const page = (after = 5000): PagePlacement => ({ width: g.w - 2 * SHEET_PAD, place: (y, h) => pageY(g, y, h), after });
/** 쪽 사이 틈(아래 여백 ~ 다음 쪽 위 여백)에 걸치는가 */
const straddles = (top: number, bottom: number) => {
  const stride = g.h + g.gap, i = Math.floor(top / stride);
  return bottom > i * stride + g.h - SHEET_PAD + 0.5;
};

// 가로로 긴 사슬 열 개(제목 + 본문) — 끝없는 캔버스면 한 줄로 2,000px 넘게 퍼진다
const TEXT = Array.from({ length: 10 }, (_, i) => `단계 ${i + 1}은 앞 단계의 결과를 받아 다음으로 넘긴다.`).join(' ');
const chain = {
  title: '긴 사슬',
  nodes: Array.from({ length: 10 }, (_, i) => ({ key: `n${i}`, title: `단계 ${i + 1}`, kind: 'step', body: '앞 단계의 결과를 받아 다음으로 넘긴다' })),
  edges: Array.from({ length: 9 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, relation: 'leads-to' })),
  charts: [], tables: [],
};
const planOf = async () => structureText({ text: TEXT }, { transport: fakeTransport(() => chain) });

describe('A4 용지 안 도식 (page.ts)', () => {
  it('끝없는 캔버스면 용지 폭을 넘는 사슬도, 용지가 있으면 용지 안쪽 폭 안 · 가운데에 놓인다', async () => {
    const plan = await planOf();
    const wide = planApply(null, plan, { x: SHEET_PAD, y: 100 });
    expect(wide.bounds.w).toBeGreaterThan(page().width);
    const p = planApply(null, plan, { x: SHEET_PAD, y: 100 }, { page: page() });
    expect(p.bounds.w).toBeLessThanOrEqual(page().width);
    expect(p.bounds.x).toBeGreaterThanOrEqual(SHEET_PAD);
    expect(p.bounds.x + p.bounds.w).toBeLessThanOrEqual(g.w - SHEET_PAD + 0.5);
    expect(Math.abs(p.bounds.x - SHEET_PAD - (page().width - p.bounds.w) / 2)).toBeLessThan(1);
  });

  it('쪽 사이 틈에 걸치는 상자가 없다 (이름표까지) · 서로 겹치지 않는다', async () => {
    const p = planApply(null, await planOf(), { x: SHEET_PAD, y: 900 }, { page: page() });
    for (const b of p.blocks) expect(straddles(b.rect.y - 20, b.rect.y + b.rect.h)).toBe(false);
    const rs = p.blocks.map((b) => b.rect);
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i]!, b = rs[j]!;
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
    }
  });

  it('원문 아래가 막혀 있으면 내용 맨 아래(after)로', async () => {
    const e = new Engine();
    e.transact((tx) => { tx.createBlock({ x: SHEET_PAD, y: 300, w: 400, h: 200 }); }, { origin: 'user' });
    const p = planApply(e, await planOf(), { x: SHEET_PAD, y: 260 }, { page: page(560) });
    expect(Math.min(...p.blocks.map((b) => b.rect.y))).toBeGreaterThanOrEqual(560);
  });

  it('paginate: 틈에 걸친 줄은 다음 쪽 위 여백 아래로, 그 아래 줄도 같은 만큼 내려간다 · 한 줄은 함께', () => {
    const rects = new Map<string, Rect>([
      ['a', { x: 0, y: 1040, w: 100, h: 60 }], ['b', { x: 200, y: 1050, w: 100, h: 40 }], // 같은 줄 — 첫 쪽 아래 여백(1099)에 걸림
      ['c', { x: 0, y: 1200, w: 100, h: 40 }],
    ]);
    paginate(rects, () => 0, (y, h) => pageY(g, y, h));
    const next = g.h + g.gap + SHEET_PAD;
    expect(rects.get('a')!.y).toBe(next);
    expect(rects.get('b')!.y).toBe(next + 10);
    expect(rects.get('c')!.y).toBe(1200 + (next - 1040));
  });
});
