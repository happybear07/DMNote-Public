// structure.v2 반영 (STRUCTURE-GUIDE 5.7 · 5.12): 노드 종류 · 필드 → 블록, 묶음 → 노트 묶음(이름 · 종류 · 괄호),
// 안쪽 묶음은 바깥에 합치고 이름을 제목 앞에, 묶음 끝 화살표, 기호(⇏ · 극성), 출처 schema = structure.v2, 회의록 모양 배치, 실행 취소 한 번.
import { beforeAll, describe, expect, it } from 'vitest';
import { addStroke, Engine, rectsIntersect, setDefaultTextCodec, strokeBounds } from '@dn/engine-core';
import { pmCodec } from '@dn/text-pm/headless';
import { applyStructure, structureText, type Structure } from '../src';
import { fakeTransport } from './fixtures';

beforeAll(() => setDefaultTextCodec(pmCodec));

const TEXT = '주간 회의. 김 대리는 제목 검색만 먼저 내자고 했다. 이 사원은 본문 검색도 넣자고 했다. 박 팀장은 제목 검색을 먼저 내기로 결정했다. 김 대리가 수요일까지 명세를 쓴다. 10/20 내부 테스트, 10/27 베타 배포.';
const answer = (direction?: 'TB'): Structure => ({
  version: 'structure.v2',
  nodes: [
    { key: 'c1', title: '제목 검색만 먼저', kind: 'claim', speaker: '김 대리' },
    { key: 'c2', title: '본문 검색도 넣기', kind: 'claim', speaker: '이 사원', hedge: true },
    { key: 'k1', title: '제목 검색을 먼저 출시', kind: 'decision', speaker: '박 팀장', emphasis: 'strong' },
    { key: 't1', title: '명세 작성', kind: 'action', owner: '김 대리', due: '수요일' },
    { key: 'e1', title: '내부 테스트', kind: 'event', time: '10/20' },
    { key: 'e2', title: '베타 배포', kind: 'event', time: '10/27' },
  ],
  edges: [
    { from: 'c1', to: 'c2', relation: 'contrasts' },
    { from: 'c2', to: 'k1', relation: 'implies', negated: true },
    { from: 'k1', to: 't1', relation: 'next', sign: '+' },
    { from: 'a1', to: 'a2', relation: 'next' },
  ],
  charts: [], tables: [],
  containers: [
    { key: 'a1', title: '안건 1: 검색 기능 범위', kind: 'agenda', members: ['c1', 'c2', 'k1', 't1'] },
    { key: 'd1', title: '논의', kind: 'column', members: ['c1', 'c2'], parent: 'a1' },
    { key: 'a2', title: '안건 2: 베타 일정', kind: 'agenda', members: ['e1', 'e2'] },
  ],
  patterns: [{ key: 'p1', id: 'S-57', pattern: 'form', primary: true, containers: ['a1', 'a2'], ...(direction ? { direction } : {}) }],
});

async function run(direction?: 'TB') {
  const plan = await structureText({ text: TEXT }, { transport: fakeTransport(() => answer(direction)) });
  const e = new Engine();
  const r = applyStructure(e, plan, { x: 0, y: 0 }, { origin: 'claude', provider: 'anthropic' });
  if (!r.ok) throw new Error(r.reason);
  const byTitle = (t: string) => [...e.blocks()].find((b) => JSON.stringify(e.contentsOf(b.id)).includes(t))!;
  return { e, r, byTitle };
}

describe('AI 반영 — structure.v2', () => {
  it('노드 종류 · 필드가 블록에 (원문 그대로)', async () => {
    const { byTitle } = await run();
    expect(byTitle('제목 검색을 먼저 출시')).toMatchObject({ nodeKind: 'decision', speaker: '박 팀장', emphasis: 'strong' });
    expect(byTitle('명세 작성')).toMatchObject({ nodeKind: 'action', owner: '김 대리', due: '수요일' });
    expect(byTitle('베타 배포')).toMatchObject({ nodeKind: 'event', time: '10/27' });
    expect(byTitle('본문 검색도 넣기').hedge).toBe(true);
    expect(byTitle('명세 작성').ai?.schema).toBe('structure.v2');
  });

  it('묶음 → 노트 묶음 (이름 · 종류), 안쪽 묶음은 바깥에 합치고 이름을 제목 앞에', async () => {
    const { e, byTitle } = await run();
    const g1 = byTitle('명세 작성').group!, g2 = byTitle('베타 배포').group!;
    expect(g1 && g2 && g1 !== g2).toBe(true);
    expect(byTitle('제목 검색만 먼저').group).toBe(g1); // 안쪽 묶음 d1도 바깥 a1에
    expect(e.note.groups?.[g1]).toMatchObject({ name: '안건 1: 검색 기능 범위', kind: 'agenda' });
    expect(e.note.groups?.[g1]?.ai?.schema).toBe('structure.v2');
    expect(JSON.stringify(e.contentsOf(byTitle('제목 검색만 먼저').id))).toContain('논의 · 제목 검색만 먼저');
  });

  it('묶음 끝 화살표 · 기호(⇏ · 극성) · 관계', async () => {
    const { e, byTitle } = await run();
    const arrows = [...e.arrows()];
    const grp = arrows.find((a) => a.from.groupId && a.to.groupId)!;
    expect(grp.from.groupId).toBe(byTitle('명세 작성').group);
    expect(grp.to.groupId).toBe(byTitle('베타 배포').group);
    expect(arrows.find((a) => a.relation === 'implies')?.negated).toBe(true);
    expect(arrows.find((a) => a.relation === 'next' && !a.from.groupId)?.sign).toBe('+');
  });

  it('회의록(S-57 form) 모양: 안건마다 한 줄 — 줄 안은 논의 → 결정 → 할 일 왼→오, 안건 2는 안건 1 아래', async () => {
    const { byTitle } = await run();
    expect(byTitle('제목 검색을 먼저 출시').x).toBeGreaterThan(byTitle('본문 검색도 넣기').x);
    expect(byTitle('명세 작성').x).toBeGreaterThan(byTitle('제목 검색을 먼저 출시').x);
    const row1Bottom = Math.max(...['제목 검색만 먼저', '본문 검색도 넣기', '제목 검색을 먼저 출시', '명세 작성'].map((t) => byTitle(t).y + byTitle(t).h));
    expect(byTitle('내부 테스트').y).toBeGreaterThan(row1Bottom);
    // 원형이 위→아래로 고정이 아닌 form은 판별 방향(TB)이 와도 같은 모양
    const tb = await run('TB');
    expect(tb.byTitle('명세 작성').x - tb.byTitle('제목 검색을 먼저 출시').x).toBe(byTitle('명세 작성').x - byTitle('제목 검색을 먼저 출시').x);
  });

  it('상자 하나짜리 칸(slot)은 칸 이름을 역할로, 레인(lane)은 레인 이름을 담당으로 — 앱 묶음은 둘 이상만', async () => {
    const s: Structure = { version: 'structure.v2', nodes: [{ key: 'i', title: '취소할 수 있는가', kind: 'question' }, { key: 'r', title: '정산 기안', kind: 'step' }], edges: [], charts: [], tables: [],
      containers: [{ key: 's1', kind: 'slot', title: '쟁점', members: ['i'] }, { key: 'l1', kind: 'lane', title: '신청자', members: ['r'] }] };
    const plan = await structureText({ text: '쟁점: 취소할 수 있는가. 신청자가 정산 기안을 올린다.' }, { transport: fakeTransport(() => s) });
    const e = new Engine();
    const r = applyStructure(e, plan, { x: 0, y: 0 });
    if (!r.ok) throw new Error(r.reason);
    const by = (t: string) => [...e.blocks()].find((b) => JSON.stringify(e.contentsOf(b.id)).includes(t))!;
    expect(by('취소할 수 있는가').role).toBe('쟁점');
    expect(by('정산 기안').owner).toBe('신청자');
    expect(e.note.groups ?? {}).toEqual({});
  });

  it('시간축 · 사분면 구조는 모양 묶음(축선 · 십자를 캔버스가 덧그림) — 상자가 이미 칸 묶음에 들면 만들지 않는다', async () => {
    const ev = (k: string, t: string) => ({ key: k, title: t, kind: 'event' as const, time: t });
    const tl: Structure = { version: 'structure.v2', nodes: [ev('a', '2019년'), ev('b', '2020년'), ev('c', '2022년')], edges: [{ from: 'a', to: 'b', relation: 'next' }, { from: 'b', to: 'c', relation: 'next' }], charts: [], tables: [],
      patterns: [{ key: 'p1', id: 'S-04', pattern: 'timeline', primary: true, nodes: ['a', 'b', 'c'], caption: '연혁' }] };
    const plan = await structureText({ text: '2019년 출시, 2020년 유료화, 2022년 해외 진출.' }, { transport: fakeTransport(() => tl) });
    const e = new Engine();
    if (!applyStructure(e, plan, { x: 0, y: 0 }).ok) throw new Error('반영 실패');
    const metas = Object.values(e.note.groups ?? {});
    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({ shape: 'timeline', name: '연혁', bracket: 'none' });
    expect(new Set([...e.blocks()].map((b) => b.group)).size).toBe(1);
    // 사분면 칸이 이미 묶음(상자 둘씩)이면 모양 묶음 없이 칸 묶음만
    const q = (k: string) => ({ key: k, title: k, kind: 'concept' as const });
    const mx: Structure = { version: 'structure.v2', nodes: ['a', 'b', 'c', 'd'].map(q), edges: [], charts: [], tables: [],
      containers: [{ key: 'q1', kind: 'slot', title: '높음', members: ['a', 'b'] }, { key: 'q2', kind: 'slot', title: '낮음', members: ['c', 'd'] }],
      patterns: [{ key: 'p1', id: 'S-13', pattern: 'matrix', primary: true, nodes: ['a', 'b', 'c', 'd'], axis: { x: '긴급도', y: '중요도' } }] };
    const e2 = new Engine();
    applyStructure(e2, await structureText({ text: '할 일을 긴급도와 중요도로 나누면 높음 칸에 a와 b, 낮음 칸에 c와 d가 들어갑니다.' }, { transport: fakeTransport(() => mx) }), { x: 0, y: 0 });
    expect(Object.values(e2.note.groups ?? {}).map((g) => g.shape ?? g.name)).toEqual(['높음', '낮음']);
  });

  it('결과는 자유 필기를 덮지 않는다 — 필기가 있는 자리는 빈 자리 찾기에서 막힌 칸 (교차 검토 B6)', async () => {
    const plan = await structureText({ text: TEXT }, { transport: fakeTransport(() => answer()) });
    const e = new Engine();
    const ink = addStroke(e, { tool: 'pen', color: '#000', width: 3, origin: { x: 40, y: 40 }, points: [0, 0, 0.5, 200, 120, 0.5] });
    if (!ink.ok) throw new Error(ink.reason);
    const r = applyStructure(e, plan, { x: 0, y: 0 });
    if (!r.ok) throw new Error(r.reason);
    const s = strokeBounds(e.getStroke(ink.value!) as never);
    expect([...e.blocks()].some((b) => rectsIntersect(e.blockRect(b.id)!, s))).toBe(false);
  });

  it('실행 취소 한 번에 블록 · 화살표 · 묶음 정보까지 사라진다', async () => {
    const { e } = await run();
    expect(Object.keys(e.note.groups ?? {})).toHaveLength(2);
    e.undo();
    expect([e.blockCount, [...e.arrows()].length, e.note.groups]).toEqual([0, 0, undefined]);
  });
});
