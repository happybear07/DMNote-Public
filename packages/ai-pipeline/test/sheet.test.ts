// 노트형 정리 (docs/research/NOTE-SHEET-PLAN.md NS-11 ~ 16): sheet 정리 · 별점 수치 검사 · 청크 합치기 · 레고 블록 배치(10/29) · 모드 강제 요청.
import { beforeAll, describe, expect, it } from 'vitest';
import { CARD_PAD, DOCK_GAP, Engine, groupName, noteCards, rectsOverlap, setDefaultTextCodec, type Rect, type TextContent, type TextNode, type Vec2 } from '@dn/engine-core';
import { pmCodec } from '@dn/text-pm/headless';
import { applyStructure, balanceColumns, checkStructure, mergeSheet, planApply, renderStructureUser, structureText, type Structure, type StructureSheet } from '../src';
import { fakeTransport } from './fixtures';

beforeAll(() => setDefaultTextCodec(pmCodec));

const TEXT = '# 수면 습관 정리\n30대 직장인 기준.\n## 좋은 점\n- 일찍 잔다\n## 고칠 점\n- 휴대폰을 오래 본다\n## 점수\n규칙성 ★★★☆☆, 수면 시간 4/5\n## 할 일\n- 11시 전에 눕기\n결론적으로 잠들기 전 휴대폰을 줄이자.';
const answer = (over: Partial<StructureSheet> = {}): Structure => ({
  version: 'structure.v2', mode: 'sheet', nodes: [], edges: [], charts: [],
  tables: [{ key: 't1', title: '비교', columns: ['항목', '지금'], rows: [['취침', '12시'], ['기상', '7시']] }],
  sheet: {
    title: '수면 습관 정리', subtitle: '30대 직장인 기준.',
    sections: [
      { title: '좋은 점 · 고칠 점', span: 2, pieces: [{ type: 'compare', left: { label: '좋은 점', items: ['일찍 잔다'] }, right: { label: '고칠 점', items: ['휴대폰을 오래 본다'] } }] },
      { title: '점수', tone: 'yellow', pieces: [{ type: 'rating', rows: [{ label: '규칙성', value: 3, max: 5 }, { label: '수면 시간', value: 4, max: 5 }, { label: '집중', value: 2, max: 5 }] }] },
      { title: '할 일', tone: 'green', pieces: [{ type: 'checklist', items: ['11시 전에 눕기'] }, { type: 'divider', label: '기록' }, { type: 'table', table: 't1' }] },
      { title: '태그', pieces: [{ type: 'chips', items: ['수면', '습관'] }, { type: 'flow', steps: ['씻기', '눕기', '잠'] }] },
    ],
    closing: '결론적으로 잠들기 전 휴대폰을 줄이자.',
    ...over,
  },
});

const texts = (e: Engine) => [...e.contents()].filter((c): c is TextContent => c.type === 'text');
const walk = (n: TextNode, f: (n: TextNode) => void) => { f(n); n.content?.forEach((k) => walk(k, f)); };
const has = (e: Engine, pred: (n: TextNode) => boolean) => texts(e).some((c) => { let ok = false; walk(c.doc as unknown as TextNode, (n) => { if (pred(n)) ok = true; }); return ok; });

describe('sheet 정리 (checkStructure)', () => {
  it('형식이 틀린 조각 · 없는 표를 가리키는 조각만 빼고, 조각이 다 빠진 카드는 카드째 뺀다', () => {
    const raw = answer({
      sections: [
        { title: '점수', pieces: [{ type: 'rating', rows: [{ label: 'x', value: 20 }] }, { type: 'text', md: '남는 글' }] },
        { title: '빈 카드', pieces: [{ type: 'table', table: 'nope' }] },
      ],
    });
    const r = checkStructure(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.mode).toBe('sheet');
    expect(r.value.sheet!.sections.map((s) => s.title)).toEqual(['점수']);
    expect(r.value.sheet!.sections[0]!.pieces.map((p) => p.type)).toEqual(['text']);
    expect(r.dropped.map((d) => d.path)).toEqual(expect.arrayContaining(['/sheet/sections/0/pieces/0', '/sheet/sections/1']));
  });

  it('v1 응답에는 sheet가 없다', () => {
    const r = checkStructure({ version: 'structure.v1', nodes: [], edges: [], charts: [], tables: [], sheet: answer().sheet });
    expect(r.ok && r.value.sheet).toBeFalsy();
  });
});

describe('노트형 파이프라인', () => {
  it('별점은 원문 수치(숫자 · 채운 별 수)일 때만 — 없는 값의 줄은 글로', async () => {
    const plan = await structureText({ text: TEXT }, { transport: fakeTransport(() => answer()) });
    expect(plan.mode).toBe('sheet');
    const rating = plan.sheet!.sections[1]!.pieces[0]!;
    expect(rating.rows!.map((r) => r.label)).toEqual(['규칙성', '수면 시간']);
    expect(rating.md).toBe('- 집중');
  });

  it('mode를 고르면 요청 options.mode로 가고, 사용자 메시지에 requested_mode가 붙는다 (v1은 안 붙음)', async () => {
    const t = fakeTransport(() => answer());
    await structureText({ text: TEXT }, { transport: t, mode: 'diagram' });
    expect(t.requests[0]!.options.mode).toBe('diagram');
    const base = { nonce: 'abcdefghijklmnop', chunkNo: 1, chunkCount: 1, kinds: ['relation'] as const, locale: 'ko', sourceText: '글' };
    expect(renderStructureUser({ ...base, mode: 'sheet' })).toContain('<requested_mode>\nThe user chose the layout for this paste: set "mode" to "sheet"');
    expect(renderStructureUser(base)).not.toContain('requested_mode');
    expect(renderStructureUser({ ...base, mode: 'sheet' }, 'structure.v1')).not.toContain('requested_mode');
  });

  it('청크 합치기: 카드를 차례로 잇고 표 참조는 청크 이름공간으로, 맺음말은 마지막 청크', () => {
    const a = answer().sheet!, b: StructureSheet = { sections: [{ title: '더', pieces: [{ type: 'table', table: 't1' }] }], closing: '끝' };
    const m = mergeSheet(mergeSheet(undefined, a, (k) => `c0:${k}`), b, (k) => `c1:${k}`);
    expect(m.title).toBe('수면 습관 정리');
    expect(m.sections.length).toBe(5);
    expect(m.sections[2]!.pieces[2]!.table).toBe('c0:t1');
    expect(m.sections[4]!.pieces[0]!.table).toBe('c1:t1');
    expect(m.closing).toBe('끝');
  });
});

describe('레고 블록 배치 (10/29 — 카드 격자에서 바꿈)', () => {
  // 상자마다 첫 줄 글 — 제목만 있는 상자(비교 · 표 위)는 앱이 제목 상자로 만든다
  const heads = (e: Engine) => texts(e).map((c) => ((c.doc.content[0] as TextNode | undefined)?.content ?? []).map((k) => k.text ?? '').join(''));
  /** 블록 테두리 안 어느 점이든 가장 가까운 상자까지 이음매 반(십자 자리는 대각선) 안 — 빈 구멍이 없다 */
  const noHoles = (rs: Rect[]) => {
    const u = { x: Math.min(...rs.map((r) => r.x)), y: Math.min(...rs.map((r) => r.y)), r: Math.max(...rs.map((r) => r.x + r.w)), b: Math.max(...rs.map((r) => r.y + r.h)) };
    const far: Vec2[] = [];
    for (let x = u.x; x <= u.r; x += 4) for (let y = u.y; y <= u.b; y += 4) {
      const d = Math.min(...rs.map((r) => Math.hypot(Math.max(r.x - x, 0, x - r.x - r.w), Math.max(r.y - y, 0, y - r.y - r.h))));
      if (d > (DOCK_GAP / 2) * Math.SQRT2 + 0.5) far.push({ x, y });
    }
    return far;
  };

  it('블록 하나에 번호 · 제목 상자, 비교는 나란히 둘, 표는 따로, 머리 · 맺음말은 폭 전체 · 빈틈없이 붙음 · 실행 취소 한 번', async () => {
    const plan = await structureText({ text: TEXT }, { transport: fakeTransport(() => answer()) });
    const e = new Engine();
    const r = applyStructure(e, plan, { x: 0, y: 0 }, { origin: 'claude', provider: 'anthropic' });
    expect(r.ok).toBe(true);
    const bs = [...e.blocks()];
    expect(new Set(bs.map((b) => b.group)).size).toBe(1); // 블록 하나
    expect(bs.every((b) => b.group)).toBe(true);
    expect(noteCards(e).length).toBe(0);
    expect(heads(e)).toEqual(expect.arrayContaining(['1. 좋은 점 · 고칠 점', '2. 점수', '3. 할 일', '4. 태그']));
    expect([...e.contents()].some((c) => c.type === 'divider')).toBe(false); // 구분선 대신 이음매
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(rectsOverlap(bs[i]!, bs[j]!), `${i}·${j} 겹침`).toBe(false);
    expect(noHoles(bs)).toEqual([]);
    // 머리(제목 1)는 맨 위 폭 전체, 맺음말(콜아웃)은 맨 아래 폭 전체
    const right = Math.max(...bs.map((b) => b.x + b.w)), bottom = Math.max(...bs.map((b) => b.y + b.h));
    const top = bs.find((b) => b.y === Math.min(...bs.map((x) => x.y)))!;
    expect(top.w).toBe(right - top.x);
    expect(groupName(e, bs[0]!.group!)).toBe('수면 습관 정리'); // 머리 제목 상자가 블록 이름 (묶음 이름은 비워 문서 소제목이 겹치지 않게)
    expect(e.note.groups![bs[0]!.group!]!.name).toBeUndefined();
    const tail = bs.find((b) => b.y + b.h === bottom)!;
    expect(tail.w).toBe(right - tail.x);
    // 비교: 상자 둘이 나란히 같은 높이
    const pair = bs.filter((b) => texts(e).some((c) => c.blockId === b.id && JSON.stringify(c.doc).includes('휴대폰을 오래 본다') || c.blockId === b.id && JSON.stringify(c.doc).includes('일찍 잔다')));
    expect(pair.length).toBe(2);
    expect(pair[0]!.y).toBe(pair[1]!.y);
    expect(pair[0]!.h).toBe(pair[1]!.h);
    // 단 아래 끝을 맞추려 늘린 상자는 자동 높이 + 최소 높이
    expect(bs.some((b) => b.sizing === 'auto' && (b.minH ?? 0) > 0)).toBe(true);
    expect(has(e, (n) => n.type === 'rating' && n.attrs?.value === 3)).toBe(true);
    expect(has(e, (n) => n.type === 'task_item')).toBe(true);
    expect(has(e, (n) => !!n.marks?.some((m) => m.type === 'chip'))).toBe(true);
    expect([...e.contents()].some((c) => c.type === 'table')).toBe(true);
    e.undo();
    expect([...e.blocks()].length).toBe(0);
    expect(Object.keys(e.note.groups ?? {}).length).toBe(0);
  });

  it('단 나누기: 차례를 지키며 가장 높은 단이 가장 낮게', () => {
    expect(balanceColumns([100, 100, 100, 100], 2, 16)).toEqual({ cuts: [[0, 2], [2, 4]], H: 216 });
    expect(balanceColumns([300, 50, 50, 50, 50], 2, 16)).toEqual({ cuts: [[0, 1], [1, 5]], H: 300 });
    expect(balanceColumns([80], 1, 16)).toEqual({ cuts: [[0, 1]], H: 80 });
  });

  it('A4: 용지 폭 안 · 쪽마다 블록 하나 — 상자는 쪽 경계를 넘지 않고, 다음 블록은 다음 쪽 맨 위', async () => {
    const many = { ...answer().sheet!, closing: undefined, sections: Array.from({ length: 8 }, (_, i) => ({ title: `문단 ${i + 1}`, pieces: [{ type: 'text' as const, md: '가나다라 마바사 아자차카 타파하 '.repeat(6) }] })) };
    const plan = await structureText({ text: TEXT }, { transport: fakeTransport(() => answer(many)) });
    const PAGE = 600, GAP = 40, PAD = 24, stride = PAGE + GAP;
    const room = (y: number) => Math.floor(y / stride) * stride + PAGE - PAD - y;
    const place = (y: number, h: number) => { const i = Math.floor(y / stride), top = i * stride; return y + h > top + PAGE - PAD ? (i + 1) * stride + PAD : y < top + PAD ? top + PAD : y; };
    const p = planApply(null, plan, { x: PAD, y: 100 }, { sheet: { inner: 300, cols: 2, place, room } });
    const xs = p.blocks.map((b) => b.rect);
    expect(Math.min(...xs.map((r) => r.x))).toBe(PAD);
    expect(Math.max(...xs.map((r) => r.x + r.w))).toBeLessThanOrEqual(PAD + 2 * (300 + 2 * CARD_PAD) + 24);
    for (const r of xs) expect(Math.floor(r.y / stride), JSON.stringify(r)).toBe(Math.floor((r.y + r.h - 1) / stride)); // 쪽 경계를 넘지 않음
    expect(p.groups.length).toBeGreaterThanOrEqual(2);
    const byGroup = p.groups.map((g) => p.blocks.filter((b) => b.group === g.key).map((b) => b.rect));
    for (const rs of byGroup) expect(new Set(rs.map((r) => Math.floor(r.y / stride))).size).toBe(1); // 블록 하나 = 쪽 하나
    expect(Math.min(...byGroup[1]!.map((r) => r.y))).toBe(stride + PAD);
    for (const rs of byGroup) expect(noHoles(rs)).toEqual([]);
  });
});
