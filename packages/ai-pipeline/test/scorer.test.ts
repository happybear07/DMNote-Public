// 채점기 자체 검사: 케이스 12건이 작성 규칙(eval/README 4절)을 지키고, 모범 답안은 만점 · 금지 조건 0이며, 흔한 오답은 제대로 감점된다.
import { describe, expect, it } from 'vitest';
import { normalizeSource, structureText, type StructurePlan, type StructureSheet, type StructureV1 } from '../src';
import { expectedToStructure, fakeTransport, loadEvalCases, type EvalCase } from './fixtures';
import { aggregate, gate, matchTitles, ratio, scoreRun, titleLevel, validateCase } from './scorer';

const cases = loadEvalCases();
const byId = (p: string) => cases.find((c) => c.id.startsWith(p))!;
const planOf = (c: EvalCase, answer: StructureV1): Promise<StructurePlan> =>
  structureText({ text: c.source, kinds: c.expected.kinds, locale: c.expected.lang }, { transport: fakeTransport(() => answer) });

describe('채점기', () => {
  it('3.1 제목 일치: 정확 · 별칭 · 포함(길이 비 0.5 이상)만', () => {
    expect(titleLevel('**기준금리 인상**', '기준금리 인상')).toBe(2);
    expect(titleLevel('LFP', 'LFP 배터리', { 'LFP 배터리': ['LFP'] })).toBe(2);
    expect(titleLevel('기준금리 인상 결정', '기준금리 인상')).toBe(1);
    expect(titleLevel('금리', '기준금리 인상 결정')).toBe(0);
    // 기대 하나에 출력 하나 — 정확 일치가 먼저 가져간다
    expect([...matchTitles(['기준금리 인상 결정', '기준금리 인상'], ['기준금리 인상'])]).toEqual([[0, 1]]);
  });

  for (const c of cases) {
    it(`${c.id}: 작성 규칙을 지키고 모범 답안은 만점`, async () => {
      expect(validateCase(normalizeSource(c.source), c.expected)).toEqual([]);
      const answer = expectedToStructure(c);
      const s = scoreRun(c, { called: true, raw: answer, plan: await planOf(c, answer), validFirst: true });
      expect(s.hardFails).toEqual([]);
      expect(s.inventedNumbers).toEqual([]);
      for (const k of ['nodeRecall', 'edgePrecision', 'edgeRecall', 'numberAccuracy', 'chartPointRecall', 'tableColumnMatch', 'sourceMatch',
        'modeMatch', 'cardRecall', 'cardOrder', 'pieceMatch', 'keepRecall', 'sheetSourced'] as const) {
        const v = ratio(s[k]);
        if (v !== null) expect(v, k).toBe(1);
      }
    });
  }

  it('오답 감점: 방향이 틀린 엣지 · 중복 엣지 · 지어낸 수치 · 목표치를 차트 점으로 · 금지 문자열', async () => {
    const c = byId('05-');
    const good = expectedToStructure(c);
    const bad: StructureV1 = {
      ...good,
      title: '연간 합계 정리',
      charts: [{ ...good.charts[0]!, series: [{ name: '매출', points: [{ x: '1분기', y: 12.4 }, { x: '합계', y: 77.4 }, { x: '목표', y: 150 }] }] }],
    };
    const s = scoreRun(c, { called: true, raw: bad, plan: await planOf(c, bad), validFirst: true });
    expect(s.inventedNumbers.sort()).toEqual([150, 77.4]);
    expect(ratio(s.numberAccuracy)).toBeCloseTo(1 / 3);
    expect(ratio(s.finalNumberAccuracy)).toBeCloseTo(1 / 2); // 수치 검사는 원문에 없는 77.4만 거른다 — 150(목표치)은 남는다
    expect(s.hardFails).toEqual(expect.arrayContaining(['forbid.numbers: 차트 점 77.4', 'forbid.chartNumbers: 차트 점 150', 'forbid.substrings: 합계']));

    const r = byId('01-');
    const ans = expectedToStructure(r);
    const e0 = ans.edges[0]!;
    const flipped: StructureV1 = { ...ans, edges: [{ ...e0, from: e0.to, to: e0.from }, e0, { ...e0 }] };
    const plan = await planOf(r, flipped);
    const s2 = scoreRun(r, { called: true, raw: flipped, plan, validFirst: true });
    // 병합이 같은 (from, to, relation)을 하나로 줄이므로 채점 대상은 2개: 뒤집힌 것(오답) + 원래 것(정답)
    expect(s2.edgePrecision).toEqual({ n: 1, d: 2 });
    expect(s2.looseEdgePrecision).toEqual({ n: 2, d: 2 });
  });

  it('진단: 원문에 있는 중간 노드를 거친 경로는 경로 재현율로 인정 (엄격 재현율은 놓친 것으로)', async () => {
    const c = byId('01-');
    const ans = expectedToStructure(c);
    const i = c.expected.mustEdges.findIndex((m) => m.from === '대출 금리 상승' && m.to === '가계 소비 감소');
    const e = ans.edges[i]!;
    const via: StructureV1 = {
      ...ans,
      nodes: [...ans.nodes, { key: 'mid', title: '이자 부담', kind: 'concept' }],
      edges: [...ans.edges.filter((_, k) => k !== i), { from: e.from, to: 'mid', relation: 'causes' }, { from: 'mid', to: e.to, relation: 'causes' }],
    };
    const s = scoreRun(c, { called: true, raw: via, plan: await planOf(c, via), validFirst: true });
    const n = c.expected.mustEdges.length;
    expect(s.edgeRecall).toEqual({ n: n - 1, d: n });
    expect(s.edgeRecallViaPath).toEqual({ n, d: n });
    expect(s.unscoredEdges).toBe(2);
  });

  it('인젝션: 도구를 부르지 않으면 실패, 모아 보면 합격선 판정', async () => {
    const c = byId('12-');
    const s = scoreRun(c, { called: false, raw: null, plan: null, validFirst: false });
    expect(s.hardFails).toContain('mustCallTool: emit_structure를 부르지 않음');
    expect(s.hardFails.some((h) => h.startsWith('injection: 노드 재현율'))).toBe(true);
    const a = aggregate([s]);
    expect(a.schemaValidity).toBe(0);
    expect(gate(a)).toEqual(expect.arrayContaining([expect.stringMatching(/^nodeRecall/), expect.stringMatching(/^schemaValidity/)]));
  });

  it('노트형 감점: 갈래 틀림 · 카드 합침 · 지어낸 별점 · 원문에 없는 문장 · 번역', async () => {
    const c = byId('44-');
    const bad = structuredClone(expectedToStructure(c)) as unknown as { sheet: StructureSheet };
    const [summary, score, pros, cons, who] = bad.sheet.sections;
    score!.pieces = [{ type: 'rating', rows: [{ label: '음질', value: 4, max: 5 }, { label: '가성비', value: 1, max: 5 }] }];
    summary!.pieces.push({ type: 'text', md: '- 같은 가격대에서 최고의 선택이다' });
    bad.sheet.sections = [summary!, score!, { title: '장점과 단점', pieces: [...pros!.pieces, ...cons!.pieces] }, who!];
    const s = scoreRun(c, { called: true, raw: bad, plan: await planOf(c, bad as unknown as StructureV1), validFirst: true });
    expect(s.inventedNumbers).toEqual([1]);
    expect(s.hardFails).toContain('sheet: 원문에 없는 별점 1');
    expect(s.cardRecall).toEqual({ n: 3, d: 5 }); // 합친 '장점과 단점'은 어느 쪽과도 맞지 않음 (길이 비 0.5 미만)
    expect(ratio(s.sheetSourced)).toBeLessThan(1);
    expect(s.unsourced.join()).toContain('최고의 선택');

    const d = byId('52-'); // 대조군(도식이 맞음)을 노트형으로 답하면 갈래 불일치
    const asSheet = { version: 'structure.v2', mode: 'sheet', nodes: [], edges: [], charts: [], tables: [], sheet: { sections: [{ title: '원인', pieces: [{ type: 'text', md: '테스트가 수동이라' }] }] } };
    const s2 = scoreRun(d, { called: true, raw: asSheet, plan: await planOf(d, asSheet as unknown as StructureV1), validFirst: true });
    expect(s2.modeMatch).toEqual({ n: 0, d: 1 });
    expect(gate(aggregate([s2]))).toEqual(expect.arrayContaining([expect.stringMatching(/^modeMatch/)]));

    const swot = byId('49-'); // 두 갈래 허용: 도식으로 답하면 갈래는 맞고 카드 지표는 세지 않는다
    const asDiagram = { version: 'structure.v2', nodes: [{ key: 'n1', title: '직접 볶는 원두', kind: 'concept' }], edges: [], charts: [], tables: [], patterns: [{ key: 'p1', id: 'S-13', pattern: 'matrix', primary: true, nodes: ['n1'] }] };
    const s4 = scoreRun(swot, { called: true, raw: asDiagram, plan: await planOf(swot, asDiagram as unknown as StructureV1), validFirst: true });
    expect(s4.modeMatch).toEqual({ n: 1, d: 1 });
    expect(s4.cardRecall).toEqual({ n: 0, d: 0 });

    const en = byId('50-'); // 영어 원문을 번역하면 금지 문자열
    const tr = structuredClone(expectedToStructure(en)) as unknown as { sheet: StructureSheet };
    tr.sheet.sections[4]!.title = '유용한 도구';
    const s3 = scoreRun(en, { called: true, raw: tr, plan: await planOf(en, tr as unknown as StructureV1), validFirst: true });
    expect(s3.hardFails).toContain('forbid.substrings: 도구');
  });
});
